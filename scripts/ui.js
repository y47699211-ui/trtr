/* ============================================================
   HEXON BETA — UI: login, menu, screens, settings, dropdowns
   ============================================================ */
"use strict";

/* ---------- Login / Profile setup ---------- */
function showLogin() {
  $("#login-screen").style.display = "";
  $("#app").style.display = "none";
}
function showApp() {
  $("#login-screen").style.display = "none";
  $("#app").style.display = "flex";
}
function registerLoginDay() {
  const key = todayKey();
  state.profile.loginDays = state.profile.loginDays || [];
  if (!state.profile.loginDays.includes(key)) {
    state.profile.loginDays.push(key);
  }
  state.profile.lastLoginDay = Date.now();
  evaluateAchievements();
}

let loginLangDD = null;
let setLangDD = null;
let currentScreen = "menu";

/* ---------- Device profile ---------- */
const DEVICE_OPTIONS = ["pc", "laptop", "tablet", "phone"];

function detectDevice() {
  const w = window.innerWidth;
  const ua = (navigator.userAgent || "").toLowerCase();
  const touch = matchMedia("(pointer: coarse)").matches;
  if (/ipad|tablet|playbook|silk/.test(ua) || (touch && w >= 720)) return "tablet";
  if (/iphone|ipod|android.*mobile|mobile/.test(ua) || (touch && w < 720)) return "phone";
  if (w >= 1280) return "pc";
  return "laptop";
}

function effectiveDevice() {
  const v = state.settings.device || "auto";
  return v === "auto" ? detectDevice() : v;
}

function applyDeviceProfile(device, opts) {
  const final = device === "auto" ? detectDevice() : device;
  document.documentElement.setAttribute("data-device", final);
  document.documentElement.setAttribute("data-device-setting", device);
  if (opts && opts.toast) {
    toast(t("toast.device", { device: t("device." + final) }), "info");
  }
}

/* Resize is fired *constantly* by mobile keyboards, address-bar
   shrinks, and orientation flicks. Debouncing through rAF keeps the
   layout reflow cost down to one per repaint and stops the layout
   from “thrashing” while the user is dragging a piece. */
let _resizeRaf = 0;
function onResizeMaybeApplyDevice() {
  if ((state.settings.device || "auto") !== "auto") return;
  if (_resizeRaf) return;
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = 0;
    applyDeviceProfile("auto");
  });
}

function init() {
  const persisted = loadState();
  if (persisted) {
    Object.assign(state.profile, persisted.profile || {});
    Object.assign(state.stats, persisted.stats || {});
    Object.assign(state.settings, persisted.settings || {});
    state.hidden = Object.assign({}, state.hidden, persisted.hidden || {});
    state.dailyTasks = persisted.dailyTasks || state.dailyTasks;
    state.achievements = new Set(persisted.achievements || []);
    state.leaderboards = persisted.leaderboards || [];
    if (persisted.wallet) state.wallet = Object.assign(state.wallet || { coins:0, lastDailyClaim:0 }, persisted.wallet);
    if (persisted.skins)  state.skins  = Object.assign(state.skins  || { equipped:"default", unlocked:["default"] }, persisted.skins);
    if (Array.isArray(persisted.usedActivationCodes)) state.usedActivationCodes = persisted.usedActivationCodes;
    if (persisted.activations) state.activations = Object.assign(state.activations || { redeemed:0, totalReceived:0, generated:0 }, persisted.activations);
    /* Newer feature blobs — battlepass / seasonal / mastery / customSkins /
       marketplace. All are independently shaped so missing fields just fall
       back to the in-memory defaults defined at the top of state.js. */
    if (persisted.battlepass)  state.battlepass  = Object.assign(state.battlepass,  persisted.battlepass);
    if (persisted.seasonal)    state.seasonal    = Object.assign(state.seasonal,    persisted.seasonal);
    if (persisted.mastery)     state.mastery     = persisted.mastery;
    if (persisted.customSkins) state.customSkins = Object.assign(state.customSkins, persisted.customSkins);
    if (persisted.marketplace) state.marketplace = Object.assign(state.marketplace, persisted.marketplace);
  }
  /* Make seasonal + custom SKINS visible to the renderer as early as
     possible — this lets the saved equipped-skin id resolve correctly
     even if the user picked a custom or seasonal one before the
     editor or season screen has been opened in this session. */
  if (typeof ensureSeasonalRegistered === "function") ensureSeasonalRegistered();
  if (typeof rehydrateCustomSkins  === "function") rehydrateCustomSkins();
  if (typeof ensureBattlePass      === "function") ensureBattlePass();
  if (typeof ensureMarketplace     === "function") ensureMarketplace();

  /* Resurrect a permanent player ID from a dedicated key. This survives
     "Reset all" (which clears the main state) so the ID truly never
     changes for the lifetime of the install. */
  const perma = (typeof loadPermanentPlayerId === "function") ? loadPermanentPlayerId() : "";
  if (perma && !state.profile.id) state.profile.id = perma;
  if (!state.profile.id) state.profile.id = genId();
  if (typeof savePermanentPlayerId === "function") savePermanentPlayerId(state.profile.id);

  // theme & lang
  document.documentElement.setAttribute("data-theme", state.settings.theme || "dark");
  applyDeviceProfile(state.settings.device || "auto");
  if (typeof applySkinAccent === "function") applySkinAccent();
  window.addEventListener("resize", onResizeMaybeApplyDevice, { passive: true });

  // Build login lang dropdown
  loginLangDD = buildLangDropdown($("#login-lang-dropdown"), {
    value: state.settings.lang || "uk",
    onChange: (code) => {
      state.settings.lang = code;
      applyI18n();
      saveState();
    },
  });

  // Apply i18n
  applyI18n();

  // Build the device picker on the login screen. Each chip pins a
  // layout density; the "remember" toggle controls whether the choice
  // is restored next time we hit the login screen.
  setupLoginDevicePicker();

  // bind login
  const nickInput = $("#nickname-input");
  const pwdInput  = $("#password-input");
  const nickCount = $("#nick-count");
  const errBox    = $("#login-error");
  const permBox   = $("#login-perm");
  const pwToggle  = $("#password-toggle");

  if (state.profile.nickname) {
    nickInput.value = state.profile.nickname;
    nickCount.textContent = state.profile.nickname.length + "/20";
  }
  nickInput.addEventListener("input", () => {
    nickCount.textContent = nickInput.value.length + "/20";
    hideLoginError();
  });
  pwdInput.addEventListener("input", () => hideLoginError());
  pwToggle.addEventListener("click", () => {
    pwdInput.type = pwdInput.type === "password" ? "text" : "password";
    pwToggle.textContent = pwdInput.type === "password"
      ? t("login.show") || "show"
      : t("login.hide") || "hide";
  });

  // Permission UX: only show the file-access banner if we're inside the
  // Android WebView and the user hasn't granted it yet. Browser players
  // never see it.
  refreshLoginPermBanner();
  const permBtn = $("#login-perm-grant");
  if (permBtn) permBtn.addEventListener("click", () => {
    if (typeof HexBridge !== "undefined") {
      HexBridge.requestPermission();
      // Re-check on focus — when the user returns from settings the page
      // gets focus again.
      setTimeout(refreshLoginPermBanner, 250);
    }
  });
  window.addEventListener("focus", refreshLoginPermBanner);

  $("#login-confirm").addEventListener("click", handleLoginConfirm);
  nickInput.addEventListener("keydown", e => { if (e.key === "Enter") pwdInput.focus(); });
  pwdInput.addEventListener("keydown", e => { if (e.key === "Enter") handleLoginConfirm(); });

  // auto-resume if already registered AND we have a password hash (legacy
  // saves without one fall through to the login screen so the player can
  // set a password the first time they open the new build).
  if (state.profile.nickname && state.profile.id && state.profile.passwordHash) {
    registerLoginDay();
    enterApp();
  } else {
    showLogin();
  }
}

function showLoginError(msg){
  const box = document.getElementById("login-error");
  if(!box) return;
  box.textContent = msg;
  box.hidden = false;
}
function hideLoginError(){
  const box = document.getElementById("login-error");
  if(box) box.hidden = true;
}
function refreshLoginPermBanner(){
  const banner = document.getElementById("login-perm");
  if(!banner) return;
  const onAndroid = typeof HexBridge !== "undefined" && HexBridge.available && HexBridge.available();
  const hasPerm   = onAndroid && HexBridge.hasPermission && HexBridge.hasPermission();
  banner.hidden = !onAndroid || hasPerm;
}

/* Login / register flow ----------------------------------------------
   - If a profile file already exists for `nickname` on disk, we *must*
     match its password hash. On success we replace the in-memory state
     with the loaded blob and continue.
   - Otherwise we treat the form as a new registration: the nickname
     becomes ours, the new password hash is stored, and `state` is
     written back to disk on the next saveState().
   - Empty nicknames or empty passwords are rejected — both are required. */
async function handleLoginConfirm(){
  const nickInput = document.getElementById("nickname-input");
  const pwdInput  = document.getElementById("password-input");
  const name = (nickInput.value || "").trim();
  const pwd  = (pwdInput.value  || "").trim();
  if(!name){ showLoginError(t("login.err.no-name") || "Введіть нік"); return; }
  if(pwd.length < 4){ showLoginError(t("login.err.weak-pass") || "Пароль мін. 4 символи"); return; }

  const pwHash   = await sha256Hex(pwd);

  /* Admin gate. The literal nickname "admin" is reserved — nobody
     except the actual admin can claim it. Any other login attempt with
     this nick (case-insensitive) is rejected with a "reserved" message,
     and no profile is created. Even the password input is treated as
     blind — we never tell the user whether it was "close". The check
     runs BEFORE we touch the disk so a stale on-disk profile cannot be
     used to bypass it. */
  if (typeof ADMIN_NICKNAME === "string" && name.toLowerCase() === ADMIN_NICKNAME){
    if (pwHash !== ADMIN_PASSWORD_HASH){
      showLoginError(t("login.err.nick-reserved") || "Цей нікнейм зарезервовано");
      return;
    }
  }

  /* Try loading a saved profile for this nickname first. On Android the
     disk bridge is consulted; in the browser this falls back to the
     per-nickname localStorage cache built by saveProfileToDisk.
     The lookup is case-insensitive because safeProfileName() lowercases
     the lookup key — so "Alex" and "alex" resolve to the same profile. */
  let loaded = (typeof loadProfileFromDisk === "function")
    ? loadProfileFromDisk(name) : null;
  /* Reject the login if a profile exists and the password hash
     doesn't match. We require the saved profile to actually carry
     a password hash — legacy saves without one fall through to the
     "first time" branch so the player can set a fresh password. */
  if (loaded && loaded.passwordHash && loaded.passwordHash !== pwHash){
    showLoginError(t("login.err.bad-pass") || "Невірний пароль");
    /* Briefly highlight the password field to make the failure
       feel obvious — the toast-style errors are easy to miss on
       small screens. */
    pwdInput.focus();
    pwdInput.select && pwdInput.select();
    return;
  }
  let isReturning = false;
  if (loaded && loaded.state){
    /* Restore everything from disk and continue. The disk blob's state
       carries its own profile.id so we don't generate a new one. */
    applyLoadedSnapshot(loaded.state);
    state.profile.nickname = name.slice(0, 20);
    state.profile.passwordHash = pwHash;
    if (!state.profile.id) state.profile.id = genId();
    isReturning = true;
  } else {
    /* Fresh registration on this device. We deliberately mint a NEW
       HEXON ID rather than reusing whatever was left over in state,
       so different accounts always have different IDs. The
       per-nickname profile cache is the new "permanent" anchor. */
    state.profile.nickname = name.slice(0, 20);
    state.profile.passwordHash = pwHash;
    state.profile.id = genId();
    state.profile.registeredAt = Date.now();
    state.profile.lastLoginDay = 0;
    state.profile.loginDays = [];
    /* Also reset wallet / skins / stats so the fresh account doesn't
       inherit the previously-active account's progress. */
    if (state.wallet) { state.wallet.coins = 0; state.wallet.lastDailyClaim = 0; }
    if (state.skins)  { state.skins.equipped = "default"; state.skins.unlocked = ["default"]; }
    if (state.achievements) state.achievements = new Set();
    state.usedActivationCodes = [];
  }
  if (typeof savePermanentPlayerId === "function") savePermanentPlayerId(state.profile.id);
  registerLoginDay();
  saveState();
  enterApp();
  if (isReturning){
    toast(
      t("toast.welcome-back", { name: state.profile.nickname }) ||
      ("З поверненням, " + state.profile.nickname + "!"),
      "success"
    );
  } else {
    toast(t("toast.welcome", { name: state.profile.nickname }), "success");
  }
}

/* Copy fields from a saved snapshot into the live state. We don't just
   replace `state` because other modules hold a direct reference to it. */
function applyLoadedSnapshot(snap){
  if(!snap || typeof snap !== "object") return;
  const k = ["profile","stats","settings","hidden","dailyTasks","leaderboards","wallet","skins","usedActivationCodes","activationUsage","activations","battlepass","seasonal","mastery","customSkins","marketplace"];
  k.forEach(key => { if(snap[key] !== undefined) state[key] = snap[key]; });
  state.achievements = new Set(Array.isArray(snap.achievements) ? snap.achievements : []);
  state.run = null;
}

function setupLoginDevicePicker() {
  const grid = $("#login-device-grid");
  if (!grid) return;
  // If "remember" is OFF we treat the saved device as "auto" for the
  // purposes of the picker so the user makes a fresh choice each time.
  const initial = (state.settings.rememberDevice === false) ? "auto" : (state.settings.device || "auto");
  paintDeviceGrid(grid, initial, (code) => {
    state.settings.device = code;
    applyDeviceProfile(code);
    saveState();
    paintDeviceGrid(grid, code);
  });
  const rememberBtn = $("#login-remember");
  if (rememberBtn) {
    const sync = () => rememberBtn.classList.toggle("on", !!state.settings.rememberDevice);
    sync();
    rememberBtn.addEventListener("click", () => {
      state.settings.rememberDevice = !state.settings.rememberDevice;
      sync();
      saveState();
    });
  }
}

function paintDeviceGrid(grid, selected, onPick) {
  const items = [
    { code: "pc",     i18n: "device.pc",     icon: "i-monitor"   },
    { code: "laptop", i18n: "device.laptop", icon: "i-laptop"    },
    { code: "tablet", i18n: "device.tablet", icon: "i-tablet"    },
    { code: "phone",  i18n: "device.phone",  icon: "i-smartphone" },
    { code: "auto",   i18n: "login.detect",  icon: "i-bolt"      },
  ];
  if (onPick) grid.innerHTML = "";
  if (onPick || !grid.children.length) {
    grid.innerHTML = items.map(it => (
      '<button class="device-card" data-dev="' + it.code + '" type="button">' +
      '<svg class="ic-svg"><use href="#' + it.icon + '"/></svg>' +
      '<span data-i18n="' + it.i18n + '">' + t(it.i18n) + '</span>' +
      '</button>'
    )).join("");
    grid.querySelectorAll(".device-card").forEach(btn => {
      btn.addEventListener("click", () => onPick && onPick(btn.dataset.dev));
    });
  }
  grid.querySelectorAll(".device-card").forEach(btn => {
    btn.classList.toggle("on", btn.dataset.dev === selected);
  });
}

function enterApp() {
  showApp();
  buildBoardDom();
  startGame();
  bindAppEvents();
  if (typeof initShopWiring === "function") initShopWiring();
  if (typeof renderWallet === "function") renderWallet();
  refreshAllUI();
  // Stats avg uses totalScoreFromGames — backfill if missing
  if (typeof state.stats.totalScoreFromGames !== "number") {
    state.stats.totalScoreFromGames = (state.stats.best || 0); // best-effort
  }
  /* Kick off online leaderboard polling. The first GET runs
     immediately so the table is warm by the time the player
     opens the rankings screen, and subsequent GETs happen every
     60 seconds while the tab is visible (see leaderboard.js). */
  if (typeof startLeaderboardPolling === "function") startLeaderboardPolling();
  /* Submit our cached best score to the shared bin in case the
     last run never made it (e.g. the player closed the app while
     offline). Fire-and-forget. */
  if (typeof submitLeaderboardScore === "function") submitLeaderboardScore();
  /* Same idea for tournaments — start polling once per session so
     the cache reflects the latest admin-published events while the
     player is on the menu, and stays warm if they open the screen. */
  if (typeof startTournamentsPolling === "function") startTournamentsPolling();
  /* And the same for the marketplace — without polling, listings
     created on phone A never appeared on phone B, which is exactly
     the bug "інші гравці виставили в ринок нету" describes. */
  if (typeof startMarketplacePolling === "function") startMarketplacePolling();
  // Start at the menu screen by default.
  go("menu");
}

/* Commit an abandoned run into the cross-run stats and discard
   state.run. Called when the player navigates away from the
   game screen without finishing the run. Records (best score,
   total games, achievements, etc.) are preserved — only the
   in-progress board/tray is dropped so the next visit to the
   game screen rolls a fresh layout with the currently equipped
   skin's palette. */
function commitAbandonedRunIfAny(){
  const r = state.run;
  if (!r) return;
  /* Only count it as a played game if the user actually placed
     anything — otherwise a "Play → Menu" tap shouldn't bump the
     games counter. */
  if (r.placedThisRun > 0){
    state.stats.games          = (state.stats.games || 0) + 1;
    state.stats.totalTimeMs    = (state.stats.totalTimeMs || 0) + (Date.now() - r.startedAt);
    state.stats.totalScoreFromGames = (state.stats.totalScoreFromGames || 0) + r.score;
    if (r.score > (state.stats.best || 0)) state.stats.best = r.score;
    if (typeof bumpDailyTask === "function") bumpDailyTask("games", 1);
    if (typeof evaluateAchievements === "function") evaluateAchievements();
    if (typeof updateLeaderboardsForMe === "function") updateLeaderboardsForMe();
  }
  state.run = null;
  saveState();
}

/* ---------- Screen navigation ----------
   Replaces the old tab system. Each navigable area (menu, game,
   settings, tasks, stats, profile, leaderboards, achievements)
   is its own full-viewport screen. */
function go(screen) {
  /* The Admin screen is locked to the admin user. If anyone else
     navigates there (e.g. via stale URL state or a debug call) we
     silently redirect them back to the menu. */
  if (screen === "admin" && !(typeof isAdminUser === "function" && isAdminUser())){
    screen = "menu";
  }
  const target = document.querySelector('[data-screen="' + screen + '"]');
  if (!target) return;

  /* Leaving the game screen always discards the active run so
     the next time the player taps "Play" they get a fresh
     board that uses whatever skin/palette they've just picked
     in the Shop. The best score and stats are preserved by
     commitAbandonedRunIfAny() above. The game-over modal
     already nukes state.run via endGame()+startGame(), so this
     only fires when the player navigates away mid-run. */
  if (currentScreen === "game" && screen !== "game" && state.run){
    commitAbandonedRunIfAny();
  }
  /* Entering the game screen with no active run starts a fresh
     one. This is what makes the freshly-equipped skin colors
     show up without forcing a full page reload. */
  if (screen === "game" && !state.run && typeof startGame === "function"){
    startGame();
  }

  $$(".screen").forEach(s => s.classList.toggle("active", s.dataset.screen === screen));
  currentScreen = screen;
  // refresh data when entering a section
  if (screen === "menu") renderMenu();
  if (screen === "stats") renderStats();
  if (screen === "profile") renderProfile();
  if (screen === "tasks") renderTasks();
  if (screen === "leaderboards") renderLeaderboards();
  if (screen === "achievements") renderAchievements();
  if (screen === "shop" && typeof renderShop === "function") renderShop();
  if (screen === "season" && typeof renderSeasonal === "function") renderSeasonal();
  if (screen === "admin" && typeof renderAdminScreen === "function") renderAdminScreen();
  if (screen === "tournaments" && typeof renderTournaments === "function") renderTournaments();
  if (typeof renderWallet === "function") renderWallet();
  if (screen === "game") updateHUD();
}

/* Backwards-compatible alias used by older callers (e.g. game over modal). */
function activateTab(name) { go(name); }

/* ---------- Menu ---------- */
function renderMenu() {
  const name = state.profile.nickname || "Player";
  const { lvl } = levelInfo(state.stats.xp || 0);
  $("#menu-avatar").textContent = name.slice(0, 1).toUpperCase();
  $("#menu-name").textContent = name;
  $("#menu-level").textContent = lvl;
  $("#menu-best").textContent = (state.stats.best || 0).toLocaleString();
  $("#menu-card-best").textContent = (state.stats.best || 0).toLocaleString();
  $("#menu-card-level").textContent = lvl;
  /* Permanent player ID printed under the user pill (e.g. "ID HX-AB3C4-DE5F6"). */
  const idEl = $("#menu-player-id");
  if (idEl) idEl.textContent = "ID " + (state.profile.id || "—");
  /* Shop header coin amount mirrors the HUD pill. */
  const head = document.getElementById("shop-head-amount");
  if (head && typeof getCoins === "function") head.textContent = (typeof formatCoins === "function") ? formatCoins(getCoins()) : String(getCoins());
  /* Admin menu tile is hidden for everyone except the admin user. */
  const admTile = document.getElementById("menu-admin");
  if (admTile){
    const showAdm = (typeof isAdminUser === "function") && isAdminUser();
    admTile.classList.toggle("hidden", !showAdm);
  }
  /* Seasonal banner — always visible (the season rotates monthly so
     there's always *something* live). We just refresh the name. */
  const seasonNameEl = document.getElementById("menu-season-name");
  if (seasonNameEl && typeof seasonName === "function"){
    seasonNameEl.textContent = seasonName();
  }
  /* Update notice + global rank below the user pill. */
  renderMenuBanner();
  renderMenuRank();
}

/* Render the admin-published "what's new" banner above the Play
   card. Empty banners stay hidden. Dismissed banners are remembered
   in localStorage so they don't keep popping up after the user
   closed them. */
function renderMenuBanner(){
  const root = document.getElementById("menu-update-banner");
  const txt  = document.getElementById("menu-update-text");
  if (!root || !txt) return;
  const b = (state.meta && state.meta.banner) || { text:"", ts:0 };
  const dismissedKey = "hexon.banner.dismissed";
  const dismissedTs  = Number(localStorage.getItem(dismissedKey) || 0);
  const visible = !!(b.text && b.text.trim()) && (b.ts | 0) > dismissedTs;
  root.classList.toggle("hidden", !visible);
  if (!visible) return;
  txt.textContent = b.text;
  /* Bind once; the close button writes the timestamp so the same
     banner doesn't reappear until the admin updates the copy. */
  const close = document.getElementById("menu-update-close");
  if (close && !close.dataset.bound){
    close.dataset.bound = "1";
    close.addEventListener("click", () => {
      try { localStorage.setItem(dismissedKey, String(b.ts || Date.now())); } catch {}
      root.classList.add("hidden");
    });
  }
}

/* Show the player's current global rank as a chip next to their
   menu best-score line, so they always know "where they stand" on
   the menu without opening the leaderboard screen. */
/* ---------- Boost / feature tooltips ----------
   Lightweight one-shot tooltip system for guiding the player to new
   features (daily, combo, market, tournaments). The first time we
   call showBoostHint("id", "...") it injects a floating bubble next
   to the host node. Dismissing it sets state.boostHints.seen[id]
   so the same hint doesn't pop again.

   Pass `force=true` to bypass the dismissal check (e.g. for an
   in-app "Show tips" debug toggle). */
function showBoostHint(id, host, opts){
  if (!host) return;
  if (!state.boostHints) state.boostHints = { seen:{} };
  if (!state.boostHints.seen) state.boostHints.seen = {};
  const force = !!(opts && opts.force);
  if (state.boostHints.seen[id] && !force) return;
  /* Don't double-bind if a previous render already attached one. */
  if (host.querySelector(":scope > .boost-hint")) return;
  const text = t("boost.hint." + id) || (opts && opts.text) || "";
  if (!text) return;
  const tip = document.createElement("div");
  tip.className = "boost-hint glass";
  tip.innerHTML =
    '<div class="boost-hint-body">' + text + '</div>' +
    '<button class="boost-hint-close" type="button" aria-label="dismiss">' +
    '  <svg class="ic-svg"><use href="#i-x"/></svg>' +
    '</button>';
  /* Ensure the host establishes a positioning context. */
  const cs = (host.style && host.style.position) || getComputedStyle(host).position;
  if (cs === "static" || !cs) host.style.position = "relative";
  host.appendChild(tip);
  tip.querySelector(".boost-hint-close").addEventListener("click", () => {
    state.boostHints.seen[id] = Date.now();
    saveState();
    tip.classList.add("fade-out");
    setTimeout(() => tip.remove(), 180);
  });
}

function renderMenuRank(){
  const host = document.getElementById("menu-player-id");
  if (!host) return;
  const rank = (typeof myGlobalRank === "function") ? myGlobalRank() : 0;
  /* Strip the previous rank pill so we don't accumulate. */
  let rankEl = document.getElementById("menu-player-rank");
  if (!rankEl){
    rankEl = document.createElement("span");
    rankEl.id = "menu-player-rank";
    rankEl.className = "menu-rank-pill mono";
    host.appendChild(document.createTextNode(" "));
    host.appendChild(rankEl);
  }
  if (rank > 0){
    rankEl.textContent = "#" + rank;
    rankEl.classList.remove("hidden");
  } else {
    rankEl.classList.add("hidden");
  }
}

/* ---------- Admin screen ----------
   Built dynamically each time the screen is entered so it always sees
   the latest activation-code counters. The screen exposes three quick
   actions (grant 100k HEX, unlock all skins, copy own ID) and a code
   generator that binds an amount to a specific player ID. */
/* Quick-pick amounts used by the admin generator. Surfaced as buttons
   right above the amount input so the admin doesn't have to retype the
   most common values. */
const ADMIN_QUICK_AMOUNTS = [1000, 10000, 100000, 1000000];
/* Quick-pick max-uses chips. The "∞" chip maps to ACTIVATION_UNLIMITED
   on the wire so the encoded payload stays a finite integer. */
const ADMIN_QUICK_USES = [
  { v: 1,    label: "1" },
  { v: 5,    label: "5" },
  { v: 10,   label: "10" },
  { v: 50,   label: "50" },
  { v: 9999, label: "∞" },
];

function renderAdminScreen(){
  /* Refresh the top stat row from state. */
  const gen = document.getElementById("admin-stat-generated");
  const act = document.getElementById("admin-stat-activated");
  const hex = document.getElementById("admin-stat-hex");
  const fmt = (typeof formatCoins === "function") ? formatCoins : String;
  if (gen) gen.textContent = fmt((typeof generatedCodesCount === "function") ? generatedCodesCount() : 0);
  if (act) act.textContent = fmt((typeof redeemedCodesCount === "function") ? redeemedCodesCount() : 0);
  if (hex) hex.textContent = fmt((typeof redeemedCodesTotal === "function") ? redeemedCodesTotal() : 0);

  const panel = document.getElementById("admin-screen-panel");
  if (!panel) return;

  /* Make sure the activations container has a history slot. Older saves
     created before this version won't have one. */
  if (!state.activations) state.activations = { redeemed:0, totalReceived:0, generated:0, history:[] };
  if (!Array.isArray(state.activations.history)) state.activations.history = [];

  const quickPicks = ADMIN_QUICK_AMOUNTS.map(n =>
    '<button class="admin-quick" data-amt="' + n + '" type="button">' + fmt(n) + '</button>'
  ).join("");
  const quickUses = ADMIN_QUICK_USES.map(u =>
    '<button class="admin-quick admin-quick-uses" data-uses="' + u.v + '" type="button">' + u.label + '</button>'
  ).join("");

  panel.innerHTML =
    '<div class="admin-card">' +
      '<div class="admin-card-head">'+
        '<svg class="ic-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4z"/><path d="M9 12l2 2 4-4"/></svg>'+
        '<b data-i18n="admin.title">Admin Panel</b>'+
        '<span class="admin-id" id="admin-id-chip" title="' + (state.profile.id||'') + '">'+(state.profile.id||'')+'</span>'+
      '</div>'+
      '<div class="admin-actions">'+
        '<button class="btn btn-primary" id="admin-grant-100k" data-i18n="admin.act.grant">+100 000 HEX</button>'+
        '<button class="btn btn-primary" id="admin-unlock-all" data-i18n="admin.act.unlock">Unlock all skins</button>'+
        '<button class="btn btn-ghost"   id="admin-copy-id"   data-i18n="admin.act.copy">Copy ID</button>'+
        '<button class="btn btn-ghost admin-reset" id="admin-reset-counters" data-i18n="admin.act.reset">Reset counters</button>'+
        '<button class="btn btn-ghost"   id="admin-go-tournaments" data-i18n="admin.act.tournaments">Tournaments</button>'+
      '</div>'+
      /* Promote yourself in the global rating (level + best score
         overrides). Pushed to the JSONBlob via submitLeaderboardScore. */
      '<div class="admin-gen">'+
        '<div class="admin-gen-head"><b data-i18n="admin.grant.title">Grant rating boost</b></div>'+
        '<div class="admin-gen-field">'+
          '<label data-i18n="admin.grant.level">Level override</label>'+
          '<div class="admin-gen-row">'+
            '<input type="number" id="admin-grant-level" min="0" max="999" value="' + ((state.adminGrants && state.adminGrants.levelOverride) || 0) + '">'+
            '<input type="number" id="admin-grant-best"  min="0" placeholder="Best score" value="' + ((state.adminGrants && state.adminGrants.bestOverride) || 0) + '">'+
            '<button class="btn btn-primary" id="admin-grant-push" data-i18n="admin.grant.push">Publish</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      /* Update banner editor — text shown above every player\'s Play
         card. Empty text clears the banner globally. */
      '<div class="admin-gen">'+
        '<div class="admin-gen-head"><b data-i18n="admin.banner.title">Update banner</b></div>'+
        '<div class="admin-gen-field">'+
          '<textarea id="admin-banner-text" rows="2" maxlength="280" placeholder="Що нового у грі — коротко">' +
            (((state.meta && state.meta.banner && state.meta.banner.text) || "").replace(/</g,"&lt;")) +
          '</textarea>'+
          '<div class="admin-gen-row">'+
            '<button class="btn btn-primary" id="admin-banner-publish" data-i18n="admin.banner.publish">Publish</button>'+
            '<button class="btn btn-ghost"   id="admin-banner-clear"   data-i18n="admin.banner.clear">Clear</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="admin-gen">'+
        '<div class="admin-gen-head"><b data-i18n="admin.gen.title">Activation code generator</b></div>'+
        '<div class="admin-gen-field">'+
          '<label data-i18n="admin.gen.target">Target HEXON ID</label>'+
          '<div class="admin-gen-row">'+
            '<input type="text" id="admin-gen-id"   placeholder="HX-XXXXX-XXXXX" autocomplete="off" spellcheck="false">'+
            '<button class="btn btn-ghost" id="admin-gen-fillself" type="button" data-i18n="admin.gen.fillself">Use my ID</button>'+
          '</div>'+
        '</div>'+
        '<div class="admin-gen-field">'+
          '<label data-i18n="admin.gen.amount">Amount (HEX)</label>'+
          '<div class="admin-gen-row">'+
            '<input type="number" id="admin-gen-amt" placeholder="HEX" min="1" max="10000000" value="10000">'+
          '</div>'+
          '<div class="admin-quick-row">' + quickPicks + '</div>'+
        '</div>'+
        '<div class="admin-gen-field">'+
          '<label data-i18n="admin.gen.uses">Max uses</label>'+
          '<div class="admin-gen-row">'+
            '<input type="number" id="admin-gen-uses" placeholder="1" min="1" max="9999" value="1">'+
            '<span class="admin-gen-uses-hint" data-i18n="admin.gen.uses.hint">1 = single-use</span>'+
          '</div>'+
          '<div class="admin-quick-row">' + quickUses + '</div>'+
        '</div>'+
        '<div class="admin-gen-row">'+
          '<button class="btn btn-primary" id="admin-gen-btn"  data-i18n="admin.gen.btn">Generate</button>'+
          '<button class="btn btn-ghost"   id="admin-gen-copy" data-i18n="admin.gen.copy" disabled>Copy</button>'+
        '</div>'+
        '<div class="admin-gen-out mono" id="admin-gen-out">—</div>'+
      '</div>'+
      '<div class="admin-history">'+
        '<div class="admin-history-head">'+
          '<b data-i18n="admin.history.title">Recent codes</b>'+
          '<button class="admin-history-clear" id="admin-history-clear" type="button" data-i18n="admin.history.clear">Clear history</button>'+
        '</div>'+
        '<div class="admin-history-list" id="admin-history-list"></div>'+
      '</div>'+
    '</div>';

  if (typeof applyI18n === "function") applyI18n();
  renderAdminHistory();

  document.getElementById("admin-grant-100k").addEventListener("click", () => {
    if (typeof addCoins === "function") addCoins(100000);
    if (typeof renderWallet === "function") renderWallet();
    toast("ADMIN: +100 000 HEX", "success");
  });
  document.getElementById("admin-unlock-all").addEventListener("click", () => {
    if (typeof SHOP_SKIN_ORDER !== "undefined" && typeof unlockSkin === "function"){
      SHOP_SKIN_ORDER.forEach(id => unlockSkin(id));
      saveState();
    }
    toast(t("admin.toast.unlocked") || "ADMIN: all skins unlocked", "success");
  });
  document.getElementById("admin-copy-id").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(state.profile.id || ""); toast(t("profile.copied") || "ID copied", "success"); }
    catch { toast(state.profile.id || "", "info"); }
  });
  document.getElementById("admin-reset-counters").addEventListener("click", () => {
    /* Reset only the admin-facing counters; the player's redeem totals
       stay untouched on purpose (that's a separate idea of "my codes"). */
    state.activations = { redeemed:0, totalReceived:0, generated:0, history:[] };
    saveState();
    renderAdminScreen();
    if (typeof renderShop === "function") renderShop();
    toast(t("admin.act.reset.ok") || "Counters reset", "success");
  });

  const genIdInput = document.getElementById("admin-gen-id");
  const genAmtInput = document.getElementById("admin-gen-amt");
  const genUsesInput = document.getElementById("admin-gen-uses");
  const genBtn  = document.getElementById("admin-gen-btn");
  const genOut  = document.getElementById("admin-gen-out");
  const genCopy = document.getElementById("admin-gen-copy");
  const fillSelf = document.getElementById("admin-gen-fillself");

  if (fillSelf) fillSelf.addEventListener("click", () => {
    genIdInput.value = state.profile.id || "";
    genIdInput.focus();
  });

  /* Quick-pick chips. The amount and max-uses pickers share the
     `.admin-quick` class but live in separate `.admin-quick-row`
     blocks so highlighting only fires within the same row. */
  panel.querySelectorAll(".admin-quick-row").forEach(row => {
    row.querySelectorAll(".admin-quick").forEach(b => {
      b.addEventListener("click", () => {
        const isUses = b.classList.contains("admin-quick-uses");
        if (isUses){
          const u = parseInt(b.dataset.uses || "1", 10) || 1;
          if (u >= 1) genUsesInput.value = String(u);
          updateUsesHint();
        } else {
          const v = parseInt(b.dataset.amt || "0", 10) || 0;
          if (v > 0) genAmtInput.value = String(v);
        }
        row.querySelectorAll(".admin-quick").forEach(x => x.classList.toggle("on", x === b));
      });
    });
  });

  /* Live hint next to the max-uses input. The admin types "1" and sees
     "single-use"; types "50" and sees "50 redemptions"; picks the ∞
     chip and sees "unlimited". Updates on every keystroke so the
     consequence of the cap is obvious before they hit Generate. */
  const hintEl = panel.querySelector(".admin-gen-uses-hint");
  function updateUsesHint(){
    if (!hintEl) return;
    const raw = parseInt(genUsesInput.value, 10);
    const u = Math.max(1, Math.min(9999, isFinite(raw) ? raw : 1));
    if (u >= 9999){
      hintEl.textContent = "∞ · " + (t("admin.gen.uses.unlimited") || "unlimited");
    } else if (u === 1){
      hintEl.textContent = t("admin.gen.uses.single") || "1 = single-use";
    } else {
      const tmpl = t("admin.gen.uses.many") || "×\u202f{n} redemptions";
      hintEl.textContent = tmpl.replace("{n}", u);
    }
  }
  if (genUsesInput){
    genUsesInput.addEventListener("input", updateUsesHint);
    /* Clamp out-of-range input on blur so the wire format never sees
       a value outside 1..9999. */
    genUsesInput.addEventListener("blur", () => {
      const raw = parseInt(genUsesInput.value, 10);
      const u = Math.max(1, Math.min(9999, isFinite(raw) ? raw : 1));
      genUsesInput.value = String(u);
      updateUsesHint();
      refreshGenBtnState();
    });
    updateUsesHint();
  }

  /* Reactive Generate button. The admin must fill ID + Amount + Uses
     before the code can be produced — disabling the button (with the
     hint label morphing to "Fill: ...") is friendlier than a toast
     fired after the click. */
  function refreshGenBtnState(){
    if (!genBtn) return;
    const idOk   = !!(genIdInput.value || "").trim();
    const amtOk  = (parseInt(genAmtInput.value, 10)  || 0) > 0;
    const usesOk = (parseInt(genUsesInput.value, 10) || 0) >= 1;
    const ready  = idOk && amtOk && usesOk;
    genBtn.disabled = !ready;
    genBtn.classList.toggle("is-ready", ready);
  }
  genIdInput  && genIdInput.addEventListener("input", refreshGenBtnState);
  genAmtInput && genAmtInput.addEventListener("input", refreshGenBtnState);
  genUsesInput && genUsesInput.addEventListener("input", refreshGenBtnState);
  fillSelf    && fillSelf.addEventListener("click", () => requestAnimationFrame(refreshGenBtnState));
  panel.querySelectorAll(".admin-quick").forEach(b => b.addEventListener("click", () => requestAnimationFrame(refreshGenBtnState)));
  refreshGenBtnState();

  genBtn.addEventListener("click", async () => {
    const id   = (genIdInput.value || "").trim();
    const amt  = parseInt(genAmtInput.value, 10) || 0;
    const uses = Math.max(1, Math.min(9999, parseInt(genUsesInput.value, 10) || 1));
    /* Defence-in-depth: button is disabled while invalid, but a
       second guard here covers programmatic clicks too. */
    if (!id || amt <= 0 || uses < 1){
      genOut.textContent = "—";
      genCopy.disabled = true;
      toast(t("admin.gen.err.input") || "ID, amount and uses required", "error");
      return;
    }
    try {
      const code = await makeActivationCode(id, amt, uses);
      genOut.textContent = code;
      genCopy.disabled = false;
      genCopy.dataset.code = code;
      /* Increment the global generated counter. The same admin code
         can be regenerated for the same target if the admin re-runs
         this button — that's accepted, the counter then reflects total
         generation events rather than unique nonces. */
      if (!state.activations) state.activations = { redeemed:0, totalReceived:0, generated:0, history:[] };
      state.activations.generated = (state.activations.generated | 0) + 1;
      if (!Array.isArray(state.activations.history)) state.activations.history = [];
      /* Newest first, capped at 10 so the panel doesn't grow forever. */
      state.activations.history.unshift({ code, id, amount: amt, maxUses: uses, at: Date.now() });
      state.activations.history = state.activations.history.slice(0, 10);
      saveState();
      const genEl = document.getElementById("admin-stat-generated");
      if (genEl) genEl.textContent = fmt(state.activations.generated);
      /* Auto-copy on generation: most of the time the admin just wants
         to paste it into Telegram. Best-effort; toast falls through if
         the browser refuses clipboard access. */
      try { await navigator.clipboard.writeText(code); } catch {}
      toast(t("admin.gen.ok") || "Code generated and copied", "success");
      renderAdminHistory();
    } catch (e) {
      genOut.textContent = "—";
      toast("Failed: " + (e && e.message || e), "error");
    }
  });
  genCopy.addEventListener("click", async () => {
    const code = genCopy.dataset.code || genOut.textContent || "";
    if (!code || code === "—") return;
    try { await navigator.clipboard.writeText(code); toast(t("admin.gen.copied") || "Copied", "success"); }
    catch { toast(code, "info"); }
  });

  document.getElementById("admin-history-clear").addEventListener("click", () => {
    if (!state.activations) return;
    state.activations.history = [];
    saveState();
    renderAdminHistory();
  });

  /* Quick navigation into the tournaments screen so the admin can
     add / edit events without leaving the admin context first. */
  const goTrnBtn = document.getElementById("admin-go-tournaments");
  if (goTrnBtn){
    goTrnBtn.addEventListener("click", () => {
      go("tournaments");
      /* Open the create modal directly to save one tap. */
      if (typeof openTournamentModal === "function") openTournamentModal();
    });
  }

  /* Admin "grant boost" — overrides the level / best displayed in
     the global rating. Persisted in state.adminGrants and pushed to
     the JSONBlob so other players see the change on next poll. */
  const grantPush = document.getElementById("admin-grant-push");
  if (grantPush){
    grantPush.addEventListener("click", async () => {
      const lvl  = Math.max(0, Math.min(999, parseInt(document.getElementById("admin-grant-level").value, 10) || 0));
      const best = Math.max(0,                   parseInt(document.getElementById("admin-grant-best").value,  10) || 0);
      if (!state.adminGrants) state.adminGrants = { levelOverride:0, bestOverride:0, history:[] };
      state.adminGrants.levelOverride = lvl;
      state.adminGrants.bestOverride  = best;
      state.adminGrants.history.unshift({ kind:"grant", at: Date.now(), level: lvl, best });
      if (state.adminGrants.history.length > 20) state.adminGrants.history.length = 20;
      saveState();
      grantPush.disabled = true;
      try {
        if (typeof submitLeaderboardScore === "function") await submitLeaderboardScore(true);
        toast(t("admin.grant.ok") || "Rating boost published", "success");
        if (typeof renderMenu === "function") renderMenu();
      } catch {
        toast(t("admin.grant.fail") || "Could not push rating boost", "error");
      } finally {
        grantPush.disabled = false;
      }
    });
  }

  /* Update-banner editor. Publishing pushes the text to the shared
     bin so every other client sees it via fetchLeaderboard(). */
  const bannerPub = document.getElementById("admin-banner-publish");
  const bannerClr = document.getElementById("admin-banner-clear");
  if (bannerPub){
    bannerPub.addEventListener("click", async () => {
      const text = (document.getElementById("admin-banner-text").value || "").trim();
      bannerPub.disabled = true;
      try {
        const ok = (typeof adminPublishBanner === "function") && await adminPublishBanner(text, state.settings && state.settings.lang);
        toast(ok ? (t("admin.banner.ok") || "Banner published") : (t("admin.banner.fail") || "Banner saved locally; sync later"), ok ? "success" : "warn");
        if (typeof renderMenu === "function") renderMenu();
      } finally {
        bannerPub.disabled = false;
      }
    });
  }
  if (bannerClr){
    bannerClr.addEventListener("click", async () => {
      document.getElementById("admin-banner-text").value = "";
      bannerClr.disabled = true;
      try {
        if (typeof adminPublishBanner === "function") await adminPublishBanner("", state.settings && state.settings.lang);
        toast(t("admin.banner.cleared") || "Banner cleared", "success");
        if (typeof renderMenu === "function") renderMenu();
      } finally {
        bannerClr.disabled = false;
      }
    });
  }
}

/* Paint the "Recent codes" list under the generator. Each row shows the
   target ID, amount, and a copy button; clicking the code text itself
   also copies. The list is purely a convenience — the canonical code
   value lives in the row's dataset and is never re-derived. */
function renderAdminHistory(){
  const list = document.getElementById("admin-history-list");
  if (!list) return;
  const fmt = (typeof formatCoins === "function") ? formatCoins : String;
  const items = (state.activations && Array.isArray(state.activations.history))
    ? state.activations.history : [];
  if (items.length === 0){
    list.innerHTML = '<div class="admin-history-empty" data-i18n="admin.history.empty">' +
      (t("admin.history.empty") || "No codes generated yet") + '</div>';
    return;
  }
  list.innerHTML = items.map((it, idx) => {
    const maxUses = it.maxUses | 0;
    const usesBadge = (maxUses > 1)
      ? ('<span class="admin-history-uses">×' + (maxUses >= 9999 ? "∞" : maxUses) + '</span>')
      : "";
    return (
      '<div class="admin-history-row" data-idx="' + idx + '">' +
        '<div class="admin-history-meta">' +
          '<b class="mono">' + (it.id || "?") + '</b>' +
          '<span class="admin-history-amt">+' + fmt(it.amount || 0) + ' HEX</span>' +
          usesBadge +
        '</div>' +
        '<code class="admin-history-code mono">' + (it.code || "") + '</code>' +
        '<button class="admin-history-copy" type="button" title="Copy">⧉</button>' +
      '</div>'
    );
  }).join("");
  list.querySelectorAll(".admin-history-row").forEach(row => {
    const idx = parseInt(row.dataset.idx || "-1", 10);
    const it  = items[idx];
    if (!it) return;
    const copy = async () => {
      try { await navigator.clipboard.writeText(it.code || ""); toast(t("admin.gen.copied") || "Copied", "success"); }
      catch { toast(it.code || "", "info"); }
    };
    row.querySelector(".admin-history-code").addEventListener("click", copy);
    row.querySelector(".admin-history-copy").addEventListener("click", copy);
  });
}

/* ---------- App events ---------- */
function bindAppEvents() {
  // navigation buttons (menu tiles, play card, back buttons)
  $$("[data-go]").forEach(btn => {
    btn.addEventListener("click", () => go(btn.dataset.go));
  });

  // settings: language dropdown
  setLangDD = buildLangDropdown($("#set-lang-dropdown"), {
    value: state.settings.lang || "uk",
    onChange: (code) => {
      state.settings.lang = code;
      applyI18n();
      renderAllText();
      saveState();
      if (loginLangDD) loginLangDD.setValue(code);
    },
  });

  // theme
  document.querySelectorAll("#set-theme button").forEach(b => {
    if (b.dataset.val === state.settings.theme) b.classList.add("on"); else b.classList.remove("on");
    b.addEventListener("click", () => {
      state.settings.theme = b.dataset.val;
      document.documentElement.setAttribute("data-theme", state.settings.theme);
      document.querySelectorAll("#set-theme button").forEach(x => x.classList.toggle("on", x.dataset.val === state.settings.theme));
      saveState();
    });
  });

  // sound / vibration
  const soundBtn = $("#set-sound");
  soundBtn.classList.toggle("on", !!state.settings.sound);
  soundBtn.addEventListener("click", () => {
    state.settings.sound = !state.settings.sound;
    soundBtn.classList.toggle("on", state.settings.sound);
    saveState();
    if (state.settings.sound) sfx.toast();
  });
  const vibBtn = $("#set-vibrate");
  vibBtn.classList.toggle("on", !!state.settings.vibration);
  vibBtn.addEventListener("click", () => {
    state.settings.vibration = !state.settings.vibration;
    vibBtn.classList.toggle("on", state.settings.vibration);
    saveState();
    if (state.settings.vibration) vibrate(20);
  });

  $("#btn-reset-all").addEventListener("click", () => {
    // Tiny inline confirm using the toast stack — `confirm()` is jarring
    // inside a WebView. Two clicks within 3s commit the reset.
    const btn = $("#btn-reset-all");
    if (btn.dataset.armed === "1") {
      btn.dataset.armed = "0";
      /* Reset everything EXCEPT the permanent player ID, which lives
         under its own key. The user explicitly asked that the ID never
         change after being issued. */
      const keptId = (typeof loadPermanentPlayerId === "function") ? loadPermanentPlayerId() : (state.profile && state.profile.id);
      localStorage.removeItem(STORE_KEY);
      if (keptId && typeof savePermanentPlayerId === "function") savePermanentPlayerId(keptId);
      location.reload();
      return;
    }
    btn.dataset.armed = "1";
    btn.classList.add("armed");
    toast(t("set.reset.sub") + " — " + t("set.reset.btn") + " ?", "warn");
    setTimeout(() => { btn.dataset.armed = "0"; btn.classList.remove("armed"); }, 3000);
  });

  // restart
  $("#btn-restart").addEventListener("click", () => {
    // count abandoned run into games if score>0
    if (state.run && state.run.score > 0) {
      state.stats.games = (state.stats.games || 0) + 1;
      state.stats.totalScoreFromGames = (state.stats.totalScoreFromGames || 0) + state.run.score;
      state.stats.totalTimeMs = (state.stats.totalTimeMs || 0) + (Date.now() - state.run.startedAt);
      bumpDailyTask("games", 1);
      updateLeaderboardsForMe();
      evaluateAchievements();
    }
    startGame();
  });

  // how to
  $("#btn-howto").addEventListener("click", () => openModal("#modal-howto"));
  $("#howto-close").addEventListener("click", () => closeModal("#modal-howto"));
  $("#modal-howto").addEventListener("click", e => { if (e.target.id === "modal-howto") closeModal("#modal-howto"); });

  // Exit / leave-confirmation modal opened from the main menu.
  // The grid offers four intents instead of a yes/no — "stay",
  // "pause" (back to menu), "sign out" (clear profile), and
  // "quit" (best-effort close + sign out).
  $("#menu-exit").addEventListener("click", () => openModal("#modal-exit"));
  $("#modal-exit").addEventListener("click", e => { if (e.target.id === "modal-exit") closeModal("#modal-exit"); });
  $("#exit-stay").addEventListener("click", () => { closeModal("#modal-exit"); });
  $("#exit-pause").addEventListener("click", () => { closeModal("#modal-exit"); go("menu"); });
  $("#exit-signout").addEventListener("click", () => {
    /* "Sign out" clears the nickname and password hash so the login
       screen shows again. We don't touch the file on disk — re-typing
       the same nick + password restores the saved profile. The
       permanent HEXON ID stays preserved in its mirror key for the
       next fresh registration. */
    state.profile.nickname = "";
    state.profile.passwordHash = "";
    saveState();
    if (typeof savePermanentPlayerId === "function" && state.profile.id) savePermanentPlayerId(state.profile.id);
    location.reload();
  });
  $("#exit-quit").addEventListener("click", () => {
    /* Best-effort "quit": works in WebView (Android JS bridge) when
       present, in PWAs, and falls back to history.back() / about:blank
       in regular browsers. We also clear the active run so re-opening
       starts fresh. */
    state.run = null; saveState();
    if (window.AndroidHexon && typeof window.AndroidHexon.exit === "function") {
      try { window.AndroidHexon.exit(); return; } catch {}
    }
    try { window.close(); } catch {}
    setTimeout(() => { window.location.href = "about:blank"; }, 150);
  });

  // game over modal
  // (endGame already records totalScoreFromGames for us, so the
  //  buttons here just close the modal and reset the run.)
  $("#m-play-again").addEventListener("click", () => {
    closeModal("#modal-gameover");
    startGame();
    refreshAllUI();
  });
  $("#m-menu").addEventListener("click", () => {
    closeModal("#modal-gameover");
    startGame();
    refreshAllUI();
    go("menu");
  });

  // achievements filter & search
  document.querySelectorAll("#ach-filter button").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#ach-filter button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      achFilter = b.dataset.val;
      renderAchievements();
    });
  });
  const search = $("#ach-search");
  search.addEventListener("input", () => {
    achQuery = search.value;
    renderAchievements();
  });

  // logout from the profile screen now also goes through the exit modal
  $("#btn-logout").addEventListener("click", () => openModal("#modal-exit"));

  // profile: copy ID — click on the badge OR on the dedicated button
  const copyId = async () => {
    const id = state.profile.id || "";
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      // Fallback for browsers without async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = id; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } finally { ta.remove(); }
    }
    toast(t("profile.copied"), "success");
  };
  const profCopyBtn = $("#prof-copy");
  const profIdBadge = $("#prof-id");
  if (profCopyBtn) profCopyBtn.addEventListener("click", copyId);
  if (profIdBadge) profIdBadge.addEventListener("click", copyId);

  // settings: device picker
  const setGrid = $("#set-device-grid");
  if (setGrid) {
    paintDeviceGrid(setGrid, state.settings.device || "auto", (code) => {
      state.settings.device = code;
      applyDeviceProfile(code, { toast: true });
      saveState();
      paintDeviceGrid(setGrid, code);
    });
  }
}

function renderAllText() {
  applyI18n();
  renderTasks();
  renderLeaderboards();
  renderAchievements();
  renderMenu();
  // sync dropdowns
  if (loginLangDD) loginLangDD.setValue(state.settings.lang);
  if (setLangDD) setLangDD.setValue(state.settings.lang);
}
