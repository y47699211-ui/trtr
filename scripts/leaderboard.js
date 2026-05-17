/* ============================================================
   HEXON BETA — Online leaderboards
   ============================================================
   The board is hosted in a public JSONBlob bin and polled every
   60 seconds while the player is in the app. When the player
   finishes a run we push their best score back to the bin so
   the rest of the network can see it the next time they refresh.

   Network failures are silent: if the device is offline we just
   show the local "me" row and a small "no internet" hint.
   Nothing in this module ever produces synthetic players any
   more — the previous fake leaderboard generator has been
   removed entirely.
   ============================================================ */
"use strict";

/* JSONBlob bin used as the shared scoreboard.
   Created with `POST https://jsonblob.com/api/jsonBlob` returning
   { version, updatedAt, entries: [] }.  The bin allows anonymous
   GET / PUT so no API key is required from the client. */
const LB_BLOB_ID    = "019e3720-95bb-7271-8a39-00d17ccda7ea";
const LB_BLOB_URL   = "https://jsonblob.com/api/jsonBlob/" + LB_BLOB_ID;
const LB_REFRESH_MS = 60_000;   // poll cadence (the user asked for 1m)
const LB_MAX_ENTRIES = 100;     // cap to keep the bin small

/* In-memory cache so repeated renders don't re-fetch. `failureStreak`
   tracks consecutive failed pulls so a single flaky retry doesn't
   instantly flip the UI to the "no internet" state — that was the
   root of the "one phone shows ratings, the other says offline"
   complaint when both phones had working internet but one's first
   request happened to time out. */
const lbCache = { entries: [], updatedAt: 0, online: false, error: null, lastFetchAt: 0, failureStreak: 0 };
let   lbTimer = null;

/* Thin wrapper around the shared netFetchJSON helper (util.js).
   Kept as a function so existing call sites stay tidy. */
function _lbFetchJSON(url, init){
  return netFetchJSON(url, init);
}

/* Parse the bin and normalise into
   [{name,id,score,at,level,xp,admin}]. We accept both the v1
   schema (object with .entries) and a bare-array schema (older
   bins) so the code keeps working if the bin is manually edited. */
function _lbParseRemote(data){
  let entries;
  if (data && Array.isArray(data.entries))      entries = data.entries;
  else if (Array.isArray(data))                  entries = data;
  else                                            entries = [];
  return entries
    .filter(e => e && typeof e === "object")
    .map(e => ({
      name:  String(e.name || "").slice(0, 24),
      id:    String(e.id   || ""),
      score: Math.max(0, Math.floor(Number(e.score) || 0)),
      at:    Number(e.at)  || 0,
      level: Math.max(1, Math.floor(Number(e.level) || 1)),
      xp:    Math.max(0, Math.floor(Number(e.xp) || 0)),
      admin: !!e.admin,
    }))
    .filter(e => e.id && e.score > 0);
}

/* Extract the public-banner copy + the player's friends-only ranks
   from a leaderboard payload. Returns null if the bin doesn't have
   the new shape so older code paths keep working. */
function _lbExtractMeta(data){
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const meta = data.meta && typeof data.meta === "object" ? data.meta : null;
  if (!meta) return null;
  return {
    banner: meta.banner && typeof meta.banner === "object"
      ? { text: String(meta.banner.text || "").slice(0, 280), ts: Number(meta.banner.ts) || 0, lang: String(meta.banner.lang || "").slice(0, 4) }
      : null,
  };
}

/* Compute the score / level / xp values we want to publish for
   the local player. Honours the admin grant overrides (set from
   the admin panel) so an admin can "promote" themselves into the
   global rating without playing. */
function _myPublishedStats(){
  const grants = (state && state.adminGrants) || { levelOverride:0, bestOverride:0 };
  const natural = state.stats || { best:0, xp:0 };
  /* levelInfo() returns { lvl, xpIn, xpFor } — see scripts/state.js.
     Use the canonical `lvl` field; fall back to 1 only when the
     helper is absent (loading-order paranoia). */
  const li = (typeof levelInfo === "function") ? levelInfo(natural.xp || 0) : { lvl: 1 };
  const score = Math.max(natural.best || 0, grants.bestOverride  || 0);
  const level = Math.max(li.lvl   || 1,     grants.levelOverride || 0);
  return { score, level, xp: natural.xp || 0 };
}

/* Merge the remote list with the local "me" record so the
   current player is always shown even before the first POST
   round-trips. The remote copy of "me" wins if it has a higher
   score (e.g. the player set a record on another device). */
function _lbMergeMe(remote){
  const out = (remote || []).map(e => Object.assign({}, e, { me: e.id === state.profile.id }));
  const myId    = state.profile.id;
  const myName  = state.profile.nickname || "";
  const me      = _myPublishedStats();
  const amAdmin = (typeof isAdminUser === "function") && isAdminUser();
  if (myId && me.score > 0){
    const idx = out.findIndex(e => e.id === myId);
    if (idx < 0){
      out.push({ name: myName || "—", id: myId, score: me.score, at: Date.now(), level: me.level, xp: me.xp, admin: amAdmin, me: true });
    } else if (out[idx].score < me.score){
      out[idx] = { name: myName || out[idx].name, id: myId, score: me.score, at: Date.now(), level: me.level, xp: me.xp, admin: amAdmin, me: true };
    } else {
      /* score didn't change — still refresh level/xp so the
         right-hand badges update when the admin promotes us. */
      out[idx].level = Math.max(out[idx].level || 1, me.level);
      out[idx].xp    = Math.max(out[idx].xp || 0,    me.xp);
      out[idx].admin = amAdmin || !!out[idx].admin;
    }
  }
  out.sort((a, b) => (b.score | 0) - (a.score | 0));
  return out;
}

/* Find the local player's rank (1-based). Returns 0 if they're
   not on the board yet. Used by the menu pill and profile screen. */
function myGlobalRank(){
  const list = state.leaderboards || [];
  const id   = state.profile && state.profile.id;
  if (!id) return 0;
  const idx = list.findIndex(e => e.id === id);
  return idx < 0 ? 0 : (idx + 1);
}

/* GET — refresh the cache from the server. Called by the polling
   timer and by renderLeaderboards() on first paint. */
async function fetchLeaderboard(){
  lbCache.lastFetchAt = Date.now();
  let meta = null;
  try {
    const data = await _lbFetchJSON(LB_BLOB_URL, { method: "GET", headers: { "Accept": "application/json" } });
    const parsed = _lbParseRemote(data);
    parsed.sort((a, b) => (b.score | 0) - (a.score | 0));
    lbCache.entries  = parsed.slice(0, LB_MAX_ENTRIES);
    lbCache.updatedAt = data && data.updatedAt ? Number(data.updatedAt) : Date.now();
    lbCache.online   = true;
    lbCache.error    = null;
    lbCache.failureStreak = 0;
    meta = _lbExtractMeta(data);
  } catch (e) {
    /* Only flip to offline after two failed retries (the wrapper
       itself already retries twice). Treating the very first miss
       as "no internet" was what made one phone show ratings while
       a second phone on the same WiFi blanked out. */
    lbCache.failureStreak = (lbCache.failureStreak | 0) + 1;
    lbCache.error  = String((e && e.message) || e);
    if (lbCache.failureStreak >= 2) lbCache.online = false;
  }
  /* Keep state.leaderboards in sync so other modules (e.g. the
     menu badge) read the latest list. */
  state.leaderboards = _lbMergeMe(lbCache.entries);

  /* Mirror the shared "update banner" the admin published. Only
     replace the cached copy if the remote stamp is newer than
     what we already have to avoid flicker on slow re-paints. */
  if (meta && meta.banner){
    if (!state.meta) state.meta = { banner:{ text:"", ts:0, lang:"" }, rating:{ entries:[], updatedAt:0 }, friends:[] };
    if ((meta.banner.ts | 0) >= (state.meta.banner.ts | 0)){
      state.meta.banner = meta.banner;
    }
  }
  if (!state.meta) state.meta = { banner:{ text:"", ts:0, lang:"" }, rating:{ entries:[], updatedAt:0 }, friends:[] };
  state.meta.rating.entries   = (state.leaderboards || []).slice(0, 30);
  state.meta.rating.updatedAt = lbCache.updatedAt;
  saveState();

  if (typeof currentScreen !== "undefined" && currentScreen === "leaderboards"){
    _lbPaint(); // repaint live without scrolling
  }
  if (typeof renderMenuBanner === "function") renderMenuBanner();
  if (typeof renderMenuRank   === "function") renderMenuRank();
}

/* PUT — push the player's best score into the shared bin. We
   read-modify-write because the bin has no server-side merge.
   This is racy across players but for a casual game leaderboard
   that's acceptable. */
async function submitLeaderboardScore(force){
  const myId   = state.profile && state.profile.id;
  const myName = state.profile && state.profile.nickname;
  const meStat = _myPublishedStats();
  if (!myId || !myName || meStat.score <= 0) return;
  const amAdmin = (typeof isAdminUser === "function") && isAdminUser();
  try {
    const data    = await _lbFetchJSON(LB_BLOB_URL, { method: "GET" });
    const entries = _lbParseRemote(data);
    const oldMeta = _lbExtractMeta(data) || {};
    const idx     = entries.findIndex(e => e.id === myId);
    const mine    = {
      name:  myName.slice(0, 24),
      id:    myId,
      score: meStat.score,
      at:    Date.now(),
      level: meStat.level,
      xp:    meStat.xp,
      admin: amAdmin,
    };
    if (idx < 0)                                  entries.push(mine);
    else if (entries[idx].score < mine.score)     entries[idx] = mine;
    else if (force || entries[idx].level !== mine.level || entries[idx].xp !== mine.xp || entries[idx].admin !== mine.admin){
      /* score didn't change but level/xp/admin did — patch in
         place so other clients see the promotion. */
      entries[idx] = Object.assign({}, entries[idx], mine);
    }
    else                                          return; // nothing new to write
    entries.sort((a, b) => (b.score | 0) - (a.score | 0));
    const body = {
      version:   1,
      updatedAt: Date.now(),
      entries:   entries.slice(0, LB_MAX_ENTRIES),
      meta:      { banner: (oldMeta.banner || (state.meta && state.meta.banner) || { text:"", ts:0, lang:"" }) },
    };
    await _lbFetchJSON(LB_BLOB_URL, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    lbCache.entries    = body.entries;
    lbCache.updatedAt  = body.updatedAt;
    lbCache.online     = true;
    state.leaderboards = _lbMergeMe(lbCache.entries);
  } catch {
    /* silent — we'll retry on the next 60s tick or game-over */
  }
}

/* Admin-only: publish the "update banner" text to the shared bin so
   every player sees it on their next poll. Body is also kept in
   state.meta.banner for instant local feedback. */
async function adminPublishBanner(text, lang){
  if (!(typeof isAdminUser === "function") || !isAdminUser()) return false;
  const banner = {
    text: String(text || "").slice(0, 280),
    ts:   Date.now(),
    lang: String(lang || (state.settings && state.settings.lang) || "uk").slice(0, 4),
  };
  if (!state.meta) state.meta = { banner:{ text:"", ts:0, lang:"" }, rating:{ entries:[], updatedAt:0 }, friends:[] };
  state.meta.banner = banner;
  if (!state.adminGrants) state.adminGrants = { levelOverride:0, bestOverride:0, history:[] };
  state.adminGrants.history.unshift({ kind:"banner", at: banner.ts, text: banner.text });
  if (state.adminGrants.history.length > 20) state.adminGrants.history.length = 20;
  saveState();
  if (typeof renderMenuBanner === "function") renderMenuBanner();
  try {
    const data    = await _lbFetchJSON(LB_BLOB_URL, { method: "GET" });
    const entries = _lbParseRemote(data);
    const body = {
      version:   1,
      updatedAt: Date.now(),
      entries:   entries.slice(0, LB_MAX_ENTRIES),
      meta:      { banner },
    };
    await _lbFetchJSON(LB_BLOB_URL, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    return true;
  } catch {
    return false;
  }
}

/* Hook called from game.js when a run finishes. Fire-and-forget
   submit + immediate local merge so the user sees their fresh
   record without waiting for the next poll. */
function updateLeaderboardsForMe(){
  state.leaderboards = _lbMergeMe(lbCache.entries);
  if (typeof navigator === "undefined" || navigator.onLine !== false){
    submitLeaderboardScore();
  }
}

function ensureLeaderboards(){
  state.leaderboards = _lbMergeMe(lbCache.entries);
}

/* Painter — split out of renderLeaderboards so fetchLeaderboard()
   can repaint without going through the i18n re-render. */
function _lbPaint(){
  const tbl = $("#lb-table");
  if (!tbl) return;
  tbl.innerHTML = "";
  const headers = [
    { k: "lb.rank",  cls: "" },
    { k: "lb.name",  cls: "" },
    { k: "lb.id",    cls: "col-id" },
    { k: "lb.score", cls: "" },
  ];
  headers.forEach(h => {
    const hd = document.createElement("div");
    hd.className   = "hd " + h.cls;
    hd.textContent = t(h.k);
    tbl.appendChild(hd);
  });
  const list = state.leaderboards || [];
  if (list.length === 0){
    const empty = document.createElement("div");
    empty.style.gridColumn = "1 / -1";
    empty.style.padding    = "22px";
    empty.style.textAlign  = "center";
    empty.style.color      = "var(--fg-dim)";
    /* Only show the "no internet" copy when we really have nothing
       to show AND the network failed. Without this check, a phone
       that had a successful pull earlier in the session would still
       flicker to the "no internet" message during a transient miss
       even though it has perfectly good cached entries to display. */
    empty.textContent = (lbCache.online === false && lbCache.failureStreak >= 2)
      ? (t("lb.offline") || "Немає інтернету — рекорди недоступні")
      : (t("lb.empty")   || "Ще немає жодного рекорду");
    tbl.appendChild(empty);
    return;
  }
  list.slice(0, 50).forEach((row, i) => {
    const me = row.me;
    const rk = document.createElement("div");
    rk.className   = "rk" + (me ? " me" : "");
    rk.textContent = "#" + (i + 1);
    const nm = document.createElement("div");
    nm.className   = (me ? "me" : "");
    nm.textContent = (me ? "[" + (t("common.you") || "you") + "] " : "") + (row.name || "—");
    const id = document.createElement("div");
    id.className   = "col-id " + (me ? "me" : "");
    id.style.fontFamily = "'JetBrains Mono', monospace";
    id.style.fontSize   = "12px";
    id.style.color      = "var(--fg-dim)";
    id.textContent = row.id || "—";
    const sc = document.createElement("div");
    sc.className   = "sc" + (me ? " me" : "");
    sc.textContent = (row.score || 0).toLocaleString();
    tbl.appendChild(rk);
    tbl.appendChild(nm);
    tbl.appendChild(id);
    tbl.appendChild(sc);
  });
}

function renderLeaderboards(){
  ensureLeaderboards();
  _lbPaint();
  /* If the cache is older than the refresh interval, kick a
     background fetch so the table self-heals when the user
     opens the screen after a long pause. */
  if (Date.now() - lbCache.lastFetchAt > LB_REFRESH_MS / 2){
    fetchLeaderboard();
  }
}

/* Start / stop the polling timer. Called from enterApp() once
   the user is logged in. */
function startLeaderboardPolling(){
  if (lbTimer) clearInterval(lbTimer);
  fetchLeaderboard();
  lbTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    fetchLeaderboard();
  }, LB_REFRESH_MS);
}
function stopLeaderboardPolling(){
  if (lbTimer){ clearInterval(lbTimer); lbTimer = null; }
}

