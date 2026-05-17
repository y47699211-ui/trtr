/* ============================================================
   HEXON BETA — Profile persistence + crypto helpers
   ============================================================
   Two responsibilities live here:

     1. Bridge wrappers around window.AndroidHexon (the Java side
        defined in MainActivity.java). They expose:
          - hasStoragePermission()  / requestStoragePermission()
          - saveProfile(name, json) / loadProfile(name)
          - listProfiles()          / profileExists(name)
        In a regular browser (no bridge) every call returns a sane
        no-op so the same JS works on desktop too.

     2. Two small crypto helpers used by the login flow and the
        admin activation codes:
          - sha256Hex(str)          — SHA-256, lower-case hex
          - hmacSha256Hex(key, str) — HMAC-SHA256, lower-case hex
        Both run on the standard `crypto.subtle` API that ships
        in every Android WebView since API 28. We don't rely on
        any node-only library.
   ============================================================ */
"use strict";

/* ---------- Android bridge wrapper ---------- */
const HexBridge = {
  available(){ return !!(typeof window !== "undefined" && window.AndroidHexon); },
  hasPermission(){
    try { return this.available() && !!window.AndroidHexon.hasStoragePermission(); }
    catch { return false; }
  },
  requestPermission(){
    try { if(this.available()) window.AndroidHexon.requestStoragePermission(); }
    catch {}
  },
  saveProfile(name, json){
    try { return this.available() && !!window.AndroidHexon.saveProfile(name||"", json||""); }
    catch { return false; }
  },
  loadProfile(name){
    try { return this.available() ? (window.AndroidHexon.loadProfile(name||"") || "") : ""; }
    catch { return ""; }
  },
  listProfiles(){
    try {
      if(!this.available()) return [];
      const raw = window.AndroidHexon.listProfiles() || "[]";
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  },
  profileExists(name){
    try { return this.available() && !!window.AndroidHexon.profileExists(name||""); }
    catch { return false; }
  }
};

/* ---------- Crypto helpers ----------
   `crypto.subtle` returns ArrayBuffers; we always render them as
   lower-case hex because that's what the activation-code format
   uses on the wire. */
async function _digest(algoOrKey, data){
  const enc = new TextEncoder();
  if(typeof algoOrKey === "string"){
    const buf = await crypto.subtle.digest(algoOrKey, enc.encode(data));
    return _hex(buf);
  } else {
    const buf = await crypto.subtle.sign("HMAC", algoOrKey, enc.encode(data));
    return _hex(buf);
  }
}
function _hex(buf){
  const b = new Uint8Array(buf);
  let s = "";
  for(let i=0;i<b.length;i++) s += b[i].toString(16).padStart(2,"0");
  return s;
}
async function sha256Hex(str){
  return _digest("SHA-256", String(str||""));
}
async function hmacSha256Hex(secret, message){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(String(secret||"")),
    { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  return _digest(key, String(message||""));
}

/* ---------- Profile file <-> state ----------
   The disk file is the *source of truth* on Android. localStorage
   is kept as a fast read-cache and a fallback for non-Android
   environments. Schema:

     { version: 1,
       nickname: "...",
       passwordHash: "<sha-256 hex>",
       state: <the full saveState() blob>,
       savedAt: <epoch ms> }

   No plaintext password is ever stored — we only keep the hash. */
const PROFILE_FILE_VERSION = 1;

function safeProfileName(name){
  return String(name||"").toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,40);
}

async function buildProfileBlob(nickname, passwordHash){
  /* The saveState helper in storage.js builds the same shape used
     by localStorage. We piggy-back on it so disk and localStorage
     stay byte-for-byte identical. */
  const stateBlob = (typeof buildStateSnapshot === "function")
    ? buildStateSnapshot()
    : (typeof state === "object" ? state : {});
  return {
    version: PROFILE_FILE_VERSION,
    nickname: nickname,
    passwordHash: passwordHash,
    savedAt: Date.now(),
    state: stateBlob
  };
}

/* Per-nickname browser fallback. Lets non-Android web players also
   keep separate accounts on the same browser and enforces the
   password check on re-login. The key is salted with the safe-name
   so different player nicks never collide. */
const PROFILE_LS_PREFIX = "hexon.beta.profile.";
function profileLsKey(nick){ return PROFILE_LS_PREFIX + safeProfileName(nick); }

async function saveProfileToDisk(){
  const nick = state && state.profile && state.profile.nickname;
  const pwh  = state && state.profile && state.profile.passwordHash;
  if(!nick || !pwh) return false;
  const blob = await buildProfileBlob(nick, pwh);
  const json = JSON.stringify(blob);
  let wrote = false;
  /* Primary: Android disk (survives uninstall). */
  if(HexBridge.available() && HexBridge.hasPermission()){
    wrote = !!HexBridge.saveProfile(safeProfileName(nick), json) || wrote;
  }
  /* Fallback: browser localStorage so the in-browser flow can still
     verify the password on the next login. */
  try { localStorage.setItem(profileLsKey(nick), json); wrote = true; } catch {}
  return wrote;
}

function loadProfileFromDisk(nickname){
  /* Disk first (Android), then localStorage (web). Both branches return
     the parsed profile blob or null. */
  if(HexBridge.available()){
    const raw = HexBridge.loadProfile(safeProfileName(nickname));
    if(raw){ try { return JSON.parse(raw); } catch {} }
  }
  try {
    const raw = localStorage.getItem(profileLsKey(nickname));
    if(raw){ return JSON.parse(raw); }
  } catch {}
  return null;
}

/* ---------- Admin credentials ----------
   The admin role is gated by a fixed nickname + password pair so an
   arbitrary user can't pick the "admin" handle on first registration.
   The login flow in ui.js compares the incoming password's SHA-256
   hash against ADMIN_PASSWORD_HASH; the plaintext only lives in
   `ADMIN_PASSWORD` below for documentation. Both values are public —
   this is *not* a security boundary, only a convenience gate so
   normal players don't accidentally end up in the admin screen. */
const ADMIN_NICKNAME = "admin";
const ADMIN_PASSWORD = "hexon-admin-2025";
/* SHA-256("hexon-admin-2025") — pre-computed so we don't pay the
   crypto.subtle cost at boot, and so the plaintext can be rotated in
   one place if it ever moves. */
const ADMIN_PASSWORD_HASH = "05209a907afbebe33e669ffc7e6122a59e711f1d139ae195ab3ac881664974a8";

/* ---------- Activation codes ----------
   Two wire formats are supported:

     HX2-<TARGETID12>-<AMOUNT>-<MAXUSES>-<NONCE>-<SIG10>   (new)
     HX1-<TARGETID12>-<AMOUNT>-<NONCE>-<SIG10>             (legacy)

   HX2 lets the admin cap how many times a single code can be
   redeemed (1..9999). HX1 stays around so codes minted before
   this feature shipped keep working as a single-use code.

   In both formats TARGETID12 is the player ID with dashes stripped,
   AMOUNT is the HEX delta as a base-10 integer, NONCE is a 6-char
   random base-32 string, and SIG10 is the first 10 hex chars of
   HMAC-SHA256(ACTIVATION_SECRET, "<VER>|TARGET|AMOUNT|[USES|]NONCE").
   The shared secret is a constant; this is *not* meant to defend
   against a determined attacker who decompiles the APK, only to
   keep casual cheaters from forging codes. */
const ACTIVATION_SECRET = "hex0n_beta_v1_activation_secret_2025";
/* Sentinel for "unlimited" max-uses in the UI. Encoded as 9999 on
   the wire so the signature payload stays a finite base-10 integer. */
const ACTIVATION_UNLIMITED = 9999;

function _b32nonce(len){
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; const r = new Uint32Array(len);
  if(crypto && crypto.getRandomValues) crypto.getRandomValues(r);
  else for(let i=0;i<len;i++) r[i] = Math.floor(Math.random()*0xffffffff);
  for(let i=0;i<len;i++) s += A[r[i] % A.length];
  return s;
}
function _strip(s){ return String(s||"").replace(/-/g,"").toUpperCase(); }
function _clampMaxUses(n){
  const v = Math.floor(Number(n) || 1);
  if(!isFinite(v) || v < 1) return 1;
  if(v > ACTIVATION_UNLIMITED) return ACTIVATION_UNLIMITED;
  return v;
}

async function makeActivationCode(targetId, amount, maxUses){
  const tid   = _strip(targetId);
  const amt   = Math.max(0, Math.floor(Number(amount)||0));
  const uses  = _clampMaxUses(maxUses);
  const nonce = _b32nonce(6);
  /* Backwards-compat: maxUses=1 keeps emitting an HX1 single-use
     code so existing clients (without this update) still accept it.
     Any other cap forces the new HX2 envelope. */
  if(uses === 1){
    const msg = "HX1|" + tid + "|" + amt + "|" + nonce;
    const sig = (await hmacSha256Hex(ACTIVATION_SECRET, msg)).slice(0, 10).toUpperCase();
    return "HX1-" + tid + "-" + amt + "-" + nonce + "-" + sig;
  }
  const msg = "HX2|" + tid + "|" + amt + "|" + uses + "|" + nonce;
  const sig = (await hmacSha256Hex(ACTIVATION_SECRET, msg)).slice(0, 10).toUpperCase();
  return "HX2-" + tid + "-" + amt + "-" + uses + "-" + nonce + "-" + sig;
}

/* { ok:true, amount, maxUses, used, remaining } on success,
   { ok:false, reason:".." } on failure. */
async function verifyActivationCode(code, myId){
  const parts = String(code||"").trim().toUpperCase().split("-");
  let ver, tid, amtStr, usesStr, nonce, sig;
  if(parts.length === 6 && parts[0] === "HX2"){
    [ver, tid, amtStr, usesStr, nonce, sig] = parts;
  } else if(parts.length === 5 && parts[0] === "HX1"){
    [ver, tid, amtStr, nonce, sig] = parts;
    usesStr = "1";
  } else {
    return { ok:false, reason:"format" };
  }
  if(_strip(myId) !== tid) return { ok:false, reason:"wrong-id" };
  const amt = parseInt(amtStr, 10);
  if(!isFinite(amt) || amt <= 0 || amt > 10000000) return { ok:false, reason:"amount" };
  const maxUses = parseInt(usesStr, 10);
  if(!isFinite(maxUses) || maxUses < 1 || maxUses > ACTIVATION_UNLIMITED) return { ok:false, reason:"amount" };
  const msg = (ver === "HX2")
    ? ("HX2|" + tid + "|" + amt + "|" + maxUses + "|" + nonce)
    : ("HX1|" + tid + "|" + amt + "|" + nonce);
  const calc = (await hmacSha256Hex(ACTIVATION_SECRET, msg)).slice(0, 10).toUpperCase();
  if(calc !== sig) return { ok:false, reason:"bad-sig" };
  /* Per-nonce usage counter. A code is rejected once it hits maxUses.
     The legacy `usedActivationCodes` array stays in sync (full nonces
     are pushed onto it on the final redeem) so older code paths that
     read it for "have I seen this nonce?" still see consumed codes. */
  if(!state.usedActivationCodes) state.usedActivationCodes = [];
  if(!state.activationUsage || typeof state.activationUsage !== "object"){
    state.activationUsage = {};
    /* Migrate older single-use array: any nonce already on it counts
       as a fully-consumed HX1 redemption. */
    for(const n of state.usedActivationCodes){
      state.activationUsage[n] = 1;
    }
  }
  const used = state.activationUsage[nonce] | 0;
  if(used >= maxUses) return { ok:false, reason:"used" };
  state.activationUsage[nonce] = used + 1;
  const remaining = maxUses - (used + 1);
  if(remaining === 0 && state.usedActivationCodes.indexOf(nonce) < 0){
    state.usedActivationCodes.push(nonce);
  }
  return { ok:true, amount: amt, maxUses, used: used + 1, remaining, nonce };
}
