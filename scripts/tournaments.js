/* ============================================================
   HEXON BETA — Tournaments
   ============================================================
   Admin-created competitions. Players browse the active list,
   join one for a HEX fee, and submit their best run score. The
   highest score at `endsAt` wins the published prize.

   Tournaments are mirrored to a shared JSONBlob so every player
   sees the same events without a backend. We refresh on a 30 s
   poll while the user is on the Tournaments screen and on every
   submission. Network errors are silent — the local cache wins
   so the UI never blanks out.

   Schema (each tournament):
     { id, title, desc, prize, fee, startsAt, endsAt,
       minScore, maxPlayers, banner, createdBy, createdAt,
       participants: [{ id, name, score, at }],
       status: "draft"|"active"|"closed" }
   ============================================================ */
"use strict";

/* Shared JSONBlob bin for tournaments. Created separately from the
   leaderboard bin so the two payloads stay small and independent.
   Same anonymous GET/PUT contract as leaderboard.js. */
const TOURNEY_BLOB_ID    = "019e3720-9940-73d5-8b2d-25c56fc9027c";
const TOURNEY_BLOB_URL   = "https://jsonblob.com/api/jsonBlob/" + TOURNEY_BLOB_ID;
const TOURNEY_REFRESH_MS = 30_000;
const TOURNEY_MAX_ITEMS  = 50;

const tourneyCache = { list: [], updatedAt: 0, online: false, error: null, lastFetchAt: 0, failureStreak: 0 };
let   tourneyTimer = null;
let   tourneyEditing = null;   // id currently being edited in the admin modal

function ensureTournaments(){
  if (!state.tournaments) state.tournaments = { list:[], joined:[], syncedAt:0 };
  if (!Array.isArray(state.tournaments.list))   state.tournaments.list   = [];
  if (!Array.isArray(state.tournaments.joined)) state.tournaments.joined = [];
}

/* Thin wrapper around the shared netFetchJSON helper (util.js). The
   helper handles abort timeouts, retries, and the JSONBlob 404→empty
   convention so we don't have to duplicate that logic here. */
function _tourneyFetchJSON(url, init){
  return netFetchJSON(url, init);
}

function _tourneyNormalize(raw){
  if (!raw || typeof raw !== "object") return [];
  const list = Array.isArray(raw.list) ? raw.list
              : Array.isArray(raw)      ? raw
              : [];
  return list
    .filter(t => t && typeof t === "object" && t.id)
    .map(t => ({
      id:           String(t.id).slice(0, 32),
      title:        String(t.title || "").slice(0, 60),
      desc:         String(t.desc  || "").slice(0, 280),
      prize:        Math.max(0, Math.floor(Number(t.prize) || 0)),
      fee:          Math.max(0, Math.floor(Number(t.fee)   || 0)),
      startsAt:     Number(t.startsAt) || 0,
      endsAt:       Number(t.endsAt)   || 0,
      minScore:     Math.max(0, Math.floor(Number(t.minScore) || 0)),
      maxPlayers:   Math.max(0, Math.floor(Number(t.maxPlayers) || 0)),
      banner:       String(t.banner || "").slice(0, 80),
      createdBy:    String(t.createdBy || "").slice(0, 40),
      createdAt:    Number(t.createdAt) || 0,
      participants: Array.isArray(t.participants)
        ? t.participants
            .filter(p => p && typeof p === "object" && p.id)
            .slice(0, 500)
            .map(p => ({
              id:    String(p.id).slice(0, 24),
              name:  String(p.name || "").slice(0, 24),
              score: Math.max(0, Math.floor(Number(p.score) || 0)),
              at:    Number(p.at) || 0,
            }))
        : [],
      status:       (t.status === "draft" || t.status === "active" || t.status === "closed")
                      ? t.status : _tourneyDeriveStatus(Number(t.startsAt) || 0, Number(t.endsAt) || 0),
    }));
}

function _tourneyDeriveStatus(startsAt, endsAt){
  const now = Date.now();
  if (endsAt > 0 && now > endsAt) return "closed";
  if (startsAt > 0 && now < startsAt) return "draft";
  return "active";
}

function _tourneyMerge(remote, local){
  /* Union by id, preferring the entry with the latest `createdAt`
     and the longer participants list. Local takes precedence for
     anything not on the wire yet (admin draft, optimistic submit). */
  const map = new Map();
  remote.forEach(t => map.set(t.id, t));
  local.forEach(t => {
    const r = map.get(t.id);
    if (!r){ map.set(t.id, t); return; }
    /* Newer createdAt wins for the metadata; participants are
       merged with the local copy first (so the player sees their
       own submit even if the server hasn't acknowledged it). */
    const out = (t.createdAt || 0) >= (r.createdAt || 0) ? t : r;
    const byId = new Map();
    (r.participants || []).forEach(p => byId.set(p.id, p));
    (t.participants || []).forEach(p => {
      const prev = byId.get(p.id);
      if (!prev || prev.score < p.score) byId.set(p.id, p);
    });
    out.participants = Array.from(byId.values()).sort((a,b)=> (b.score|0) - (a.score|0));
    map.set(t.id, out);
  });
  return Array.from(map.values()).sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
}

async function fetchTournaments(){
  tourneyCache.lastFetchAt = Date.now();
  try {
    const data = await _tourneyFetchJSON(TOURNEY_BLOB_URL, { method: "GET", headers: { "Accept": "application/json" } });
    const remote = _tourneyNormalize(data);
    ensureTournaments();
    const merged = _tourneyMerge(remote, state.tournaments.list);
    tourneyCache.list      = merged.slice(0, TOURNEY_MAX_ITEMS);
    tourneyCache.updatedAt = data && data.updatedAt ? Number(data.updatedAt) : Date.now();
    tourneyCache.online    = true;
    tourneyCache.error     = null;
    tourneyCache.failureStreak = 0;
    state.tournaments.list     = tourneyCache.list;
    state.tournaments.syncedAt = tourneyCache.updatedAt;
    saveState();
  } catch (e) {
    /* Same stickiness as the leaderboard fetch — give the network
       two full retry cycles before declaring the player offline. */
    tourneyCache.failureStreak = (tourneyCache.failureStreak | 0) + 1;
    tourneyCache.error  = String((e && e.message) || e);
    if (tourneyCache.failureStreak >= 2) tourneyCache.online = false;
  }
  if (typeof currentScreen !== "undefined" && currentScreen === "tournaments"){
    renderTournaments();
  }
}

async function pushTournaments(){
  /* Read-modify-write the bin so concurrent admins on multiple
     devices don't fight; merge the latest server copy with the
     local list before pushing. */
  try {
    const data = await _tourneyFetchJSON(TOURNEY_BLOB_URL, { method: "GET" });
    const remote = _tourneyNormalize(data);
    ensureTournaments();
    const merged = _tourneyMerge(remote, state.tournaments.list);
    const body = { version: 1, updatedAt: Date.now(), list: merged.slice(0, TOURNEY_MAX_ITEMS) };
    await _tourneyFetchJSON(TOURNEY_BLOB_URL, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    tourneyCache.list      = body.list;
    tourneyCache.updatedAt = body.updatedAt;
    tourneyCache.online    = true;
    state.tournaments.list     = body.list;
    state.tournaments.syncedAt = body.updatedAt;
    saveState();
    return true;
  } catch {
    return false;
  }
}

function newTourneyId(){
  return "trn_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7);
}

function tourneyById(id){
  ensureTournaments();
  return state.tournaments.list.find(t => t.id === id) || null;
}

/* Admin-only: create or update a tournament definition. Returns the
   saved record on success, or null on validation failure. */
function adminSaveTournament(input){
  if (!(typeof isAdminUser === "function") || !isAdminUser()) return null;
  ensureTournaments();
  const now = Date.now();
  const startsAt = Number(input.startsAt) || now;
  const endsAt   = Number(input.endsAt)   || (now + 24 * 3600_000);
  const rec = {
    id:           input.id && tourneyById(input.id) ? input.id : newTourneyId(),
    title:        String(input.title || "").slice(0, 60).trim() || "Untitled",
    desc:         String(input.desc  || "").slice(0, 280).trim(),
    prize:        Math.max(0, Math.floor(Number(input.prize) || 0)),
    fee:          Math.max(0, Math.floor(Number(input.fee)   || 0)),
    startsAt,
    endsAt,
    minScore:     Math.max(0, Math.floor(Number(input.minScore) || 0)),
    maxPlayers:   Math.max(0, Math.floor(Number(input.maxPlayers) || 0)),
    banner:       String(input.banner || "").slice(0, 80).trim(),
    createdBy:    (state.profile && state.profile.nickname) || "admin",
    createdAt:    now,
    participants: [],
    status:       _tourneyDeriveStatus(startsAt, endsAt),
  };
  const existing = tourneyById(rec.id);
  if (existing){
    rec.createdAt    = existing.createdAt || now;
    rec.participants = existing.participants || [];
    Object.assign(existing, rec);
  } else {
    state.tournaments.list.unshift(rec);
  }
  if (state.tournaments.list.length > TOURNEY_MAX_ITEMS){
    state.tournaments.list = state.tournaments.list.slice(0, TOURNEY_MAX_ITEMS);
  }
  saveState();
  /* Fire-and-forget remote sync. The UI keeps working from cache
     even if the network is down. */
  if (typeof navigator === "undefined" || navigator.onLine !== false){
    pushTournaments();
  }
  return rec;
}

function adminDeleteTournament(id){
  if (!(typeof isAdminUser === "function") || !isAdminUser()) return false;
  ensureTournaments();
  const before = state.tournaments.list.length;
  state.tournaments.list = state.tournaments.list.filter(t => t.id !== id);
  saveState();
  if (state.tournaments.list.length !== before && (typeof navigator === "undefined" || navigator.onLine !== false)){
    pushTournaments();
  }
  return true;
}

/* Player-side: join a tournament. Costs `fee` HEX. Idempotent —
   joining twice is a no-op (no double-charge). */
function joinTournament(id){
  ensureTournaments();
  const trn = tourneyById(id);
  if (!trn){
    toast(t("trn.toast.notFound") || "Tournament not found", "info");
    return false;
  }
  if (trn.status === "closed"){
    toast(t("trn.toast.closed") || "Tournament has ended", "info");
    return false;
  }
  if (state.tournaments.joined.indexOf(id) >= 0) return true;
  if (trn.fee > 0){
    if (typeof spendCoins !== "function" || !spendCoins(trn.fee)){
      toast(t("trn.toast.poor") || "Not enough HEX for entry fee", "warn");
      return false;
    }
  }
  if (trn.maxPlayers > 0 && trn.participants.length >= trn.maxPlayers){
    toast(t("trn.toast.full") || "Tournament is full", "info");
    return false;
  }
  state.tournaments.joined.push(id);
  const me = { id: state.profile.id || "—", name: state.profile.nickname || "Player", score: 0, at: Date.now() };
  const idx = trn.participants.findIndex(p => p.id === me.id);
  if (idx < 0) trn.participants.push(me);
  saveState();
  toast(t("trn.toast.joined") || "Joined tournament", "success");
  if (typeof navigator === "undefined" || navigator.onLine !== false){
    pushTournaments();
  }
  return true;
}

/* Hook called from game.js whenever a run finishes so the player's
   tournament rank stays fresh without manual submit. */
function submitTournamentScore(score){
  ensureTournaments();
  const myId  = state.profile && state.profile.id;
  const myName = state.profile && state.profile.nickname;
  if (!myId) return;
  let touched = false;
  state.tournaments.list.forEach(trn => {
    if (trn.status === "closed") return;
    if (state.tournaments.joined.indexOf(trn.id) < 0) return;
    if (Number(score) < (trn.minScore | 0)) return;
    const idx = trn.participants.findIndex(p => p.id === myId);
    if (idx < 0){
      trn.participants.push({ id: myId, name: myName || "Player", score: Math.floor(Number(score) || 0), at: Date.now() });
      touched = true;
    } else if (trn.participants[idx].score < Number(score)){
      trn.participants[idx].score = Math.floor(Number(score) || 0);
      trn.participants[idx].at    = Date.now();
      touched = true;
    }
  });
  if (touched){
    saveState();
    if (typeof navigator === "undefined" || navigator.onLine !== false){
      pushTournaments();
    }
  }
}

/* Recompute status flags ("active" / "closed") from current time.
   Called before every render so the UI doesn't show a finished
   event as still open. */
function refreshTourneyStatuses(){
  ensureTournaments();
  state.tournaments.list.forEach(trn => {
    trn.status = _tourneyDeriveStatus(trn.startsAt, trn.endsAt);
  });
}

function startTournamentsPolling(){
  if (tourneyTimer) clearInterval(tourneyTimer);
  fetchTournaments();
  tourneyTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    fetchTournaments();
  }, TOURNEY_REFRESH_MS);
}
function stopTournamentsPolling(){
  if (tourneyTimer){ clearInterval(tourneyTimer); tourneyTimer = null; }
}

/* ---------- Rendering ---------- */
function renderTournaments(){
  const panel = document.getElementById("tourney-list");
  if (!panel) return;
  ensureTournaments();
  refreshTourneyStatuses();
  const admin = (typeof isAdminUser === "function") && isAdminUser();
  const fmt = (typeof formatCoins === "function") ? formatCoins : String;

  /* Header pieces (admin "new tournament" + sync hint) — drawn into
     a stable host so re-paints don't strip the buttons mid-edit.
     The offline banner is now driven SOLELY by `navigator.onLine`
     (the OS-level "no network at all" signal). If JSONBlob itself
     is being slow / blocked we keep the normal hint visible — the
     user genuinely has internet in that case and falsely telling
     them "Немає інтернету" is what the screenshot complained about.
     Two devices on the same WiFi where one sees the banner and the
     other doesn't is exactly the symptom this guard removes. */
  const hint = document.getElementById("tourney-hint");
  if (hint){
    const reallyOffline = (typeof navigator !== "undefined") && navigator.onLine === false;
    if (reallyOffline){
      hint.textContent = t("trn.offline");
      hint.classList.add("warn");
    } else {
      hint.textContent = t("trn.hint");
      hint.classList.remove("warn");
    }
  }
  const addBtn = document.getElementById("tourney-add");
  if (addBtn) addBtn.classList.toggle("hidden", !admin);
  /* Surface a manual "Оновити" / refresh control next to the hint so
     the player has a way to force a fresh GET when they suspect the
     screen is stale. Idempotent — only inserted once per render. */
  if (hint && !document.getElementById("tourney-refresh")){
    const btn = document.createElement("button");
    btn.id = "tourney-refresh";
    btn.className = "btn btn-ghost tiny";
    btn.style.marginLeft = "8px";
    btn.textContent = t("common.refresh") || "Оновити";
    btn.addEventListener("click", () => {
      btn.disabled = true;
      Promise.resolve(fetchTournaments()).finally(() => { btn.disabled = false; });
    });
    hint.appendChild(document.createTextNode(" "));
    hint.appendChild(btn);
  }

  const list = state.tournaments.list || [];
  panel.innerHTML = "";
  if (list.length === 0){
    panel.innerHTML = '<div class="tourney-empty">' + (t("trn.empty") || "Поки що немає жодного турніру.") + '</div>';
    return;
  }
  list.forEach(trn => {
    const card = document.createElement("div");
    card.className = "tourney-card glass status-" + trn.status;
    const top = trn.participants.slice(0, 3);
    const joined = state.tournaments.joined.indexOf(trn.id) >= 0;
    const myEntry = trn.participants.find(p => p.id === state.profile.id) || null;
    const myRank  = myEntry ? (trn.participants.findIndex(p => p.id === state.profile.id) + 1) : 0;
    const endsLeft = Math.max(0, trn.endsAt - Date.now());
    const endsLabel = endsLeft <= 0
      ? (t("trn.ended") || "Завершено")
      : ((t("trn.endsIn") || "До завершення {h}год {m}хв")
          .replace("{h}", Math.floor(endsLeft / 3600000))
          .replace("{m}", Math.floor((endsLeft % 3600000) / 60000)));

    /* All string fields here come from a public JSONBlob bin that
       any client can PUT to, so every one is escaped before
       concatenation. The `id` field is also user-controlled but
       it's only emitted into data-* attributes — those still need
       quote-escaping so escapeHtml is the right tool. */
    const esc = (typeof escapeHtml === "function") ? escapeHtml : (s => String(s == null ? "" : s));
    let html = '';
    if (trn.banner){
      html += '<div class="tourney-banner">' + esc(trn.banner) + '</div>';
    }
    html += '<div class="tourney-card-head">';
    html += '  <h3 class="tourney-title">' + esc(trn.title || "Tournament") + '</h3>';
    html += '  <span class="tourney-pill status-' + esc(trn.status) + '">' + esc(t("trn.status." + trn.status) || trn.status) + '</span>';
    html += '</div>';
    if (trn.desc){
      html += '<p class="tourney-desc">' + esc(trn.desc) + '</p>';
    }
    html += '<div class="tourney-meta">';
    html += '  <div class="tm"><b>' + esc(t("trn.prize") || "Приз") + '</b><span class="mono">' + esc(fmt(trn.prize)) + ' HEX</span></div>';
    html += '  <div class="tm"><b>' + esc(t("trn.fee")   || "Вхід") + '</b><span class="mono">' + esc(trn.fee > 0 ? (fmt(trn.fee) + " HEX") : (t("trn.free") || "free")) + '</span></div>';
    html += '  <div class="tm"><b>' + esc(t("trn.players") || "Гравців") + '</b><span class="mono">' + trn.participants.length + (trn.maxPlayers > 0 ? "/" + trn.maxPlayers : "") + '</span></div>';
    html += '  <div class="tm"><b>' + esc(t("trn.deadline") || "Час") + '</b><span>' + esc(endsLabel) + '</span></div>';
    html += '</div>';

    if (top.length){
      html += '<div class="tourney-top">';
      html += '  <h4>' + esc(t("trn.top") || "Топ учасники") + '</h4>';
      html += '  <ol class="tourney-top-list">';
      top.forEach((p, i) => {
        const me = p.id === state.profile.id;
        html += '<li' + (me ? ' class="me"' : '') + '><b>#' + (i+1) + '</b><span>' + esc(p.name || "—") + '</span><span class="mono">' + (p.score|0).toLocaleString() + '</span></li>';
      });
      html += '  </ol>';
      html += '</div>';
    }
    if (myEntry && myRank > 3){
      html += '<div class="tourney-myrank">' + esc(t("trn.yourRank") || "Ваше місце") + ': <b>#' + myRank + '</b> · ' + (myEntry.score|0).toLocaleString() + '</div>';
    }

    html += '<div class="tourney-actions">';
    if (trn.status === "closed"){
      html += '<button class="btn" disabled>' + esc(t("trn.ended") || "Завершено") + '</button>';
    } else if (joined){
      html += '<span class="tourney-joined">' + esc(t("trn.youIn") || "Ви берете участь") + '</span>';
    } else {
      html += '<button class="btn btn-primary" data-trn-join="' + esc(trn.id) + '">' + esc(t("trn.join") || "Долучитися") + '</button>';
    }
    if (admin){
      html += '<button class="btn btn-ghost" data-trn-edit="' + esc(trn.id) + '">' + esc(t("trn.edit") || "Редагувати") + '</button>';
      html += '<button class="btn btn-ghost danger" data-trn-del="' + esc(trn.id) + '">' + esc(t("trn.delete") || "Видалити") + '</button>';
    }
    html += '</div>';

    card.innerHTML = html;
    panel.appendChild(card);
  });

  if (typeof applyI18n === "function") applyI18n();

  panel.querySelectorAll("[data-trn-join]").forEach(b => b.addEventListener("click", () => {
    if (joinTournament(b.dataset.trnJoin)) renderTournaments();
  }));
  panel.querySelectorAll("[data-trn-edit]").forEach(b => b.addEventListener("click", () => {
    openTournamentModal(b.dataset.trnEdit);
  }));
  panel.querySelectorAll("[data-trn-del]").forEach(b => b.addEventListener("click", () => {
    /* Two-click confirm via the toast stack — `confirm()` is jarring
       in a WebView. */
    if (b.dataset.armed === "1"){
      adminDeleteTournament(b.dataset.trnDel);
      renderTournaments();
      return;
    }
    b.dataset.armed = "1";
    b.classList.add("armed");
    toast(t("trn.toast.confirmDel") || "Натисніть ще раз, щоб видалити", "warn");
    setTimeout(() => { b.dataset.armed = "0"; b.classList.remove("armed"); }, 3000);
  }));
}

/* Modal for admin tournament create/edit. Built dynamically because
   it's only used by the admin. */
function openTournamentModal(id){
  const admin = (typeof isAdminUser === "function") && isAdminUser();
  if (!admin) return;
  const editing = id ? tourneyById(id) : null;
  tourneyEditing = editing ? editing.id : null;
  const back = document.createElement("div");
  back.className = "modal-back show active";
  back.id = "modal-tournament";
  const v = editing || {
    title:"", desc:"", prize:1000, fee:0,
    startsAt: Date.now(), endsAt: Date.now() + 24*3600_000,
    minScore:0, maxPlayers:0, banner:"",
  };
  const toLocal = (ms) => {
    if (!ms) return "";
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes());
  };

  /* Same XSS treatment as renderTournaments — the edited values may
     have arrived from the public JSONBlob, so escape everything that
     touches innerHTML (titles, banners, descriptions). */
  const esc = (typeof escapeHtml === "function") ? escapeHtml : (s => String(s == null ? "" : s));
  back.innerHTML =
    '<div class="modal glass tourney-modal" role="dialog" aria-modal="true">'+
    '  <h2>' + esc(editing ? (t("trn.modal.editTitle") || "Edit tournament") : (t("trn.modal.newTitle") || "New tournament")) + '</h2>'+
    '  <div class="tourney-form">'+
    '    <label>' + esc(t("trn.f.title") || "Title") + '<input id="trn-title" maxlength="60" value="' + esc(v.title) + '"></label>'+
    '    <label>' + esc(t("trn.f.banner") || "Banner") + '<input id="trn-banner" maxlength="80" placeholder="Hot · Limited · Pro only" value="' + esc(v.banner) + '"></label>'+
    '    <label class="span2">' + esc(t("trn.f.desc") || "Description") + '<textarea id="trn-desc" maxlength="280" rows="3">' + esc(v.desc) + '</textarea></label>'+
    '    <label>' + esc(t("trn.f.prize") || "Prize (HEX)") + '<input id="trn-prize" type="number" min="0" value="' + (v.prize|0) + '"></label>'+
    '    <label>' + esc(t("trn.f.fee")   || "Entry fee (HEX)") + '<input id="trn-fee" type="number" min="0" value="' + (v.fee|0) + '"></label>'+
    '    <label>' + esc(t("trn.f.minScore")   || "Min score") + '<input id="trn-minscore" type="number" min="0" value="' + (v.minScore|0) + '"></label>'+
    '    <label>' + esc(t("trn.f.maxPlayers") || "Max players (0 = ∞)") + '<input id="trn-max" type="number" min="0" value="' + (v.maxPlayers|0) + '"></label>'+
    '    <label>' + esc(t("trn.f.startsAt") || "Starts") + '<input id="trn-starts" type="datetime-local" value="' + toLocal(v.startsAt) + '"></label>'+
    '    <label>' + esc(t("trn.f.endsAt")   || "Ends")   + '<input id="trn-ends"   type="datetime-local" value="' + toLocal(v.endsAt)   + '"></label>'+
    '  </div>'+
    '  <div class="modal-actions">'+
    '    <button class="btn btn-primary" id="trn-save">' + esc(t("trn.modal.save") || "Save") + '</button>'+
    '    <button class="btn" id="trn-cancel">' + esc(t("shop.confirm.no") || "Cancel") + '</button>'+
    '  </div>'+
    '</div>';
  document.body.appendChild(back);

  const close = () => back.remove();
  back.querySelector("#trn-cancel").addEventListener("click", close);
  back.addEventListener("click", (ev) => { if (ev.target === back) close(); });
  back.querySelector("#trn-save").addEventListener("click", () => {
    const startsAt = new Date(back.querySelector("#trn-starts").value).getTime() || Date.now();
    const endsAt   = new Date(back.querySelector("#trn-ends").value).getTime()   || (Date.now() + 24*3600_000);
    if (endsAt <= startsAt){
      toast(t("trn.toast.badRange") || "End must be after start", "warn");
      return;
    }
    const rec = adminSaveTournament({
      id: editing ? editing.id : "",
      title:      back.querySelector("#trn-title").value,
      banner:     back.querySelector("#trn-banner").value,
      desc:       back.querySelector("#trn-desc").value,
      prize:      parseInt(back.querySelector("#trn-prize").value, 10) || 0,
      fee:        parseInt(back.querySelector("#trn-fee").value, 10) || 0,
      minScore:   parseInt(back.querySelector("#trn-minscore").value, 10) || 0,
      maxPlayers: parseInt(back.querySelector("#trn-max").value, 10) || 0,
      startsAt, endsAt,
    });
    if (rec){
      close();
      tourneyEditing = null;
      toast(t("trn.toast.saved") || "Tournament saved", "success");
      renderTournaments();
    } else {
      toast(t("trn.toast.saveFail") || "Couldn't save tournament", "error");
    }
  });
}
