/* ---------- Custom skins & marketplace ----------
   Players design their own piece palette ("texture") from 6 base
   colours. The result is saved into `state.customSkins.owned` and
   shows up in the skin shop next to the catalogue skins.

   Each custom skin can be put up for sale on the marketplace for a
   HEX price. To prevent spam, regular players can only post ONE
   listing per rolling 24 hours; admins are exempt and can post as
   many as they like, as often as they like.

   The marketplace is mirrored to a shared JSONBlob bin so every
   player sees the listings made by every other player — same
   contract as the leaderboard / tournaments bins. Network failures
   are silent: the local cache wins so the UI never blanks out
   when the device is offline. We seed a handful of curated admin
   listings ONCE per device install so the marketplace is never
   empty on first open. The `seeded` flag prevents the seeds from
   coming back after the admin unlists them. */

const CUSTOM_LISTING_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CUSTOM_LISTING_MIN_PRICE   = 100;
const CUSTOM_LISTING_MAX_PRICE   = 1000000;
const CUSTOM_SKIN_TEXTURES = 6;

/* Shared JSONBlob bin for marketplace listings. Same anonymous
   GET/PUT contract as leaderboard.js + tournaments.js. */
const MARKET_BLOB_ID    = "019e3720-9c4f-7f1d-bb04-3a8f5a2b7c9d";
const MARKET_BLOB_URL   = "https://jsonblob.com/api/jsonBlob/" + MARKET_BLOB_ID;
const MARKET_REFRESH_MS = 45_000;
const MARKET_MAX_ITEMS  = 100;

/* Curated seed listings — only added the very first time the
   marketplace state is empty AND no purchases have been recorded.
   They look like community-uploaded textures so the marketplace
   has something to browse on day one. */
const MARKETPLACE_SEED = [
  {
    id: "seed-volcano", sellerId: "ADMIN", sellerName: "ADMIN",
    name: "Volcano Forge", price: 1500,
    palette: ["#ff3d00","#ff7a3d","#ffb347","#ffe0b3","#7c1f1f","#3b0a0a"],
    accent: "#ff7a3d", listedAt: 0,
  },
  {
    id: "seed-deepsea", sellerId: "ADMIN", sellerName: "ADMIN",
    name: "Deep Sea", price: 1500,
    palette: ["#053e6e","#0a5a99","#1d8acb","#5cb8e6","#a9d6ef","#dff0fa"],
    accent: "#1d8acb", listedAt: 0,
  },
  {
    id: "seed-candy", sellerId: "ADMIN", sellerName: "ADMIN",
    name: "Candy Pop", price: 1800,
    palette: ["#ff5a8c","#ffa1c3","#ffe0eb","#ffd86b","#9be1d5","#9b8df7"],
    accent: "#ff5a8c", listedAt: 0,
  },
  {
    id: "seed-shadow", sellerId: "ADMIN", sellerName: "ADMIN",
    name: "Shadow Pulse", price: 2400,
    palette: ["#0b0f1a","#1f2937","#374151","#7c5cff","#a766ff","#22d3ee"],
    accent: "#7c5cff", listedAt: 0,
  },
  {
    id: "seed-meadow", sellerId: "ADMIN", sellerName: "ADMIN",
    name: "Meadow", price: 2000,
    palette: ["#1d6c3a","#2da25b","#7fd09f","#c1f0c1","#fff6c1","#fff299"],
    accent: "#2da25b", listedAt: 0,
  },
];

/* In-memory cache + polling control for the shared market bin. */
const marketCache = { listings: [], updatedAt: 0, online: false, error: null, lastFetchAt: 0, failureStreak: 0 };
let   marketTimer = null;

function ensureMarketplace(){
  if (!state.marketplace) state.marketplace = { listings: [], purchased: [], seeded: false, syncedAt: 0 };
  if (!Array.isArray(state.marketplace.listings))  state.marketplace.listings  = [];
  if (!Array.isArray(state.marketplace.purchased)) state.marketplace.purchased = [];
  /* Seed the curated listings exactly once per install. The `seeded`
     flag is what stops the seeds from coming back after the admin
     deletes them — previously the seeds were re-injected whenever
     listings hit zero, which made the admin's "Unlist" button look
     like an "Add" button to the user. */
  if (!state.marketplace.seeded){
    if (state.marketplace.listings.length === 0 && state.marketplace.purchased.length === 0){
      state.marketplace.listings = MARKETPLACE_SEED.map(s => ({ ...s, listedAt: Date.now() }));
    }
    state.marketplace.seeded = true;
    saveState();
  }
}

function ensureCustomInv(){
  if (!state.customSkins) state.customSkins = { owned: [], equipped: "", lastListedAt: 0 };
  if (!Array.isArray(state.customSkins.owned)) state.customSkins.owned = [];
}

/* ---------- Marketplace remote sync (JSONBlob) ----------
   Same pattern as scripts/leaderboard.js + scripts/tournaments.js:
   * fetch / push share the same fetch helper with abort timeout,
   * merge by listing id so concurrent listings from different
     devices never wipe each other,
   * "removed" ids carry a tombstone so the admin's unlist sticks
     across the network without seeds or other clients reviving
     the entry on the next pull. */
function _marketFetchJSON(url, init){
  if (typeof netFetchJSON === "function") return netFetchJSON(url, init);
  /* Fallback path used only if util.js failed to load — no retries
     but at least don't crash. */
  return fetch(url, Object.assign({ cache: "no-store" }, init || {}))
    .then(res => {
      if (res.status === 404) return { __empty: true };
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
}

function _marketNormalize(raw){
  if (!raw || typeof raw !== "object") return { listings: [], removed: [] };
  const arr = Array.isArray(raw.listings) ? raw.listings
            : Array.isArray(raw)          ? raw
            : [];
  const removed = Array.isArray(raw.removed) ? raw.removed.filter(x => typeof x === "string").slice(0, 500) : [];
  const listings = arr
    .filter(l => l && typeof l === "object" && l.id && Array.isArray(l.palette))
    .map(l => ({
      id:         String(l.id).slice(0, 48),
      sellerId:   String(l.sellerId || "").slice(0, 32),
      sellerName: String(l.sellerName || "").slice(0, 24),
      name:       String(l.name || "").slice(0, 24),
      price:      Math.max(0, Math.floor(Number(l.price) || 0)),
      palette:    l.palette.slice(0, CUSTOM_SKIN_TEXTURES).map(c => /^#[0-9a-fA-F]{6}$/.test(String(c)) ? String(c).toLowerCase() : "#000000"),
      accent:     /^#[0-9a-fA-F]{6}$/.test(String(l.accent)) ? String(l.accent).toLowerCase() : "#000000",
      listedAt:   Number(l.listedAt) || 0,
      source:     String(l.source || "").slice(0, 48),
    }))
    .filter(l => l.id && l.palette.length === CUSTOM_SKIN_TEXTURES);
  return { listings, removed };
}

function _marketMerge(remote, local){
  /* Union by id, preferring the newer `listedAt`. Tombstones on
     either side win over surviving entries with the same id so an
     admin "unlist" can never be resurrected by an older snapshot. */
  const removed = new Set([...(remote.removed || []), ...(local.removed || [])]);
  const map = new Map();
  remote.listings.forEach(l => { if (!removed.has(l.id)) map.set(l.id, l); });
  local.listings.forEach(l => {
    if (removed.has(l.id)) return;
    const r = map.get(l.id);
    if (!r || (l.listedAt || 0) > (r.listedAt || 0)) map.set(l.id, l);
  });
  const merged = Array.from(map.values()).sort((a,b)=> (b.listedAt||0) - (a.listedAt||0));
  return { listings: merged.slice(0, MARKET_MAX_ITEMS), removed: Array.from(removed).slice(-500) };
}

function _marketLocalSnapshot(){
  ensureMarketplace();
  return {
    listings: (state.marketplace.listings || []).slice(),
    removed:  (state.marketplace.removed  || []).slice(),
  };
}

async function fetchMarketplace(){
  marketCache.lastFetchAt = Date.now();
  /* Snapshot the ids we currently show so the caller can repaint
     only when the merge actually changes the visible set. Without
     this we'd repaint every 45s even if nothing came back. */
  const beforeIds = new Set((state.marketplace && state.marketplace.listings || []).map(l => l.id));
  let changed = false;
  try {
    const data   = await _marketFetchJSON(MARKET_BLOB_URL, { method: "GET", headers: { "Accept": "application/json" } });
    const remote = _marketNormalize(data);
    const local  = _marketLocalSnapshot();
    const merged = _marketMerge(remote, local);
    marketCache.listings  = merged.listings;
    marketCache.updatedAt = data && data.updatedAt ? Number(data.updatedAt) : Date.now();
    marketCache.online    = true;
    marketCache.error     = null;
    marketCache.failureStreak = 0;
    state.marketplace.listings = merged.listings;
    state.marketplace.removed  = merged.removed;
    state.marketplace.syncedAt = marketCache.updatedAt;
    saveState();
    if (merged.listings.length !== beforeIds.size) {
      changed = true;
    } else {
      for (const l of merged.listings){ if (!beforeIds.has(l.id)){ changed = true; break; } }
    }
  } catch (e) {
    /* Same stickiness as leaderboard / tournaments — one transient
       miss does NOT flip the marketplace into the offline state. */
    marketCache.failureStreak = (marketCache.failureStreak | 0) + 1;
    marketCache.error  = String((e && e.message) || e);
    if (marketCache.failureStreak >= 2) marketCache.online = false;
  }
  return changed;
}

async function pushMarketplace(){
  /* Read-modify-write the bin so concurrent listings on multiple
     devices don't fight; merge the latest server copy with the
     local list before pushing. Silent on failure — the local
     cache stays authoritative until the next pull. */
  try {
    const data   = await _marketFetchJSON(MARKET_BLOB_URL, { method: "GET" });
    const remote = _marketNormalize(data);
    const local  = _marketLocalSnapshot();
    const merged = _marketMerge(remote, local);
    const body = { version: 1, updatedAt: Date.now(), listings: merged.listings, removed: merged.removed };
    await _marketFetchJSON(MARKET_BLOB_URL, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    marketCache.listings  = body.listings;
    marketCache.updatedAt = body.updatedAt;
    marketCache.online    = true;
    state.marketplace.listings = body.listings;
    state.marketplace.removed  = body.removed;
    state.marketplace.syncedAt = body.updatedAt;
    saveState();
    return true;
  } catch {
    return false;
  }
}

function startMarketplacePolling(){
  if (marketTimer) clearInterval(marketTimer);
  fetchMarketplace();
  marketTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    fetchMarketplace();
  }, MARKET_REFRESH_MS);
}
function stopMarketplacePolling(){
  if (marketTimer){ clearInterval(marketTimer); marketTimer = null; }
}

function customSkinById(id){
  ensureCustomInv();
  return state.customSkins.owned.find(s => s.id === id) || null;
}

function isCustomSkinId(id){
  return typeof id === "string" && id.indexOf("custom_") === 0;
}

function newCustomId(){
  return "custom_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7);
}

/* Default palette used when opening the editor for the first
   time — visually distinct from the base skins so it's obvious
   the user can start customising. */
const CUSTOM_DEFAULT_PALETTE = [
  "#ff5a3d","#ffb454","#3ddc97","#24bdff","#7c5cff","#f472b6",
];

/* Author a new (or edited) custom skin. Returns the saved record. */
function saveCustomSkin({ id, name, palette, accent }){
  ensureCustomInv();
  if (!Array.isArray(palette) || palette.length !== CUSTOM_SKIN_TEXTURES) return null;
  /* Sanitize the 6 textures into safe hex colours; reject anything
     that's not a #rrggbb string so the renderer can't be poisoned
     by free-form input. */
  const clean = [];
  for (const c of palette){
    if (!/^#[0-9a-fA-F]{6}$/.test(String(c))) return null;
    clean.push(String(c).toLowerCase());
  }
  const safeAccent = /^#[0-9a-fA-F]{6}$/.test(String(accent)) ? String(accent).toLowerCase() : clean[0];
  const safeName = String(name || "Custom").trim().slice(0, 24) || "Custom";
  let rec;
  if (id){
    rec = customSkinById(id);
    if (rec){
      rec.name = safeName;
      rec.palette = clean;
      rec.accent = safeAccent;
    }
  }
  if (!rec){
    rec = {
      id: newCustomId(),
      name: safeName,
      palette: clean,
      accent: safeAccent,
      createdAt: Date.now(),
    };
    state.customSkins.owned.push(rec);
  }
  /* Make sure SKINS knows about this id so renderTray etc. can
     resolve the palette. */
  if (typeof SKINS !== "undefined"){
    SKINS[rec.id] = {
      name: rec.name,
      price: 0,
      accent: rec.accent,
      palette: rec.palette,
      custom: true,
    };
  }
  /* Custom skins are always "owned" — also add to skins.unlocked
     for back-compat with isSkinUnlocked(). */
  if (state.skins && Array.isArray(state.skins.unlocked) && state.skins.unlocked.indexOf(rec.id) < 0){
    state.skins.unlocked.push(rec.id);
  }
  saveState();
  return rec;
}

function deleteCustomSkin(id){
  ensureCustomInv();
  state.customSkins.owned = state.customSkins.owned.filter(s => s.id !== id);
  if (state.skins){
    state.skins.unlocked = (state.skins.unlocked || []).filter(x => x !== id);
    if (state.skins.equipped === id) state.skins.equipped = "default";
  }
  if (typeof SKINS !== "undefined") delete SKINS[id];
  saveState();
}

/* Time remaining until the player can list a new custom skin on the
   market. NOTE: `Date.now()` returns ~1.7×10^12 which overflows a
   32-bit int, so do NOT use bitwise `|0` to coerce — that mangles
   the timestamp and lets every player bypass the cooldown. Use the
   `|| 0` fallback only to default a missing field to 0. */
function listingsCooldownLeftMs(){
  ensureCustomInv();
  if ((typeof isAdminUser === "function") && isAdminUser()) return 0;
  const last = state.customSkins.lastListedAt || 0;
  const now = Date.now();
  const left = (last + CUSTOM_LISTING_COOLDOWN_MS) - now;
  return Math.max(0, left);
}

function canListNow(){
  return listingsCooldownLeftMs() === 0;
}

function listCustomSkin(skinId, priceRaw){
  ensureCustomInv();
  ensureMarketplace();
  const rec = customSkinById(skinId);
  if (!rec){
    toast(t("custom.toast.notFound") || "Custom skin not found", "info");
    return false;
  }
  const price = Math.max(CUSTOM_LISTING_MIN_PRICE, Math.min(CUSTOM_LISTING_MAX_PRICE, parseInt(priceRaw, 10) || 0));
  if (price <= 0){
    toast(t("custom.toast.badPrice") || "Set a price first", "info");
    return false;
  }
  if (!canListNow()){
    const hLeft = Math.ceil(listingsCooldownLeftMs() / 3600000);
    toast(((t("custom.toast.cooldown") || "Wait {n}h to list again").replace("{n}", hLeft)), "info");
    return false;
  }
  const listing = {
    id: "list_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7),
    sellerId:   state.profile.id || "—",
    sellerName: state.profile.nickname || "Player",
    name: rec.name,
    price: price,
    palette: rec.palette.slice(),
    accent: rec.accent,
    listedAt: Date.now(),
    /* keep a reference back to the source skin id so duplicates
       can be deduped client-side. */
    source: skinId,
  };
  state.marketplace.listings.unshift(listing);
  /* Cap the marketplace at a reasonable size to keep render snappy. */
  if (state.marketplace.listings.length > MARKET_MAX_ITEMS){
    state.marketplace.listings = state.marketplace.listings.slice(0, MARKET_MAX_ITEMS);
  }
  const admin = (typeof isAdminUser === "function") && isAdminUser();
  if (!admin) state.customSkins.lastListedAt = Date.now();
  saveState();
  toast(t("custom.toast.listed") || "Listing posted", "success");
  /* Fire-and-forget remote sync. UI keeps working from cache even
     if the network is down. */
  if (typeof navigator === "undefined" || navigator.onLine !== false){
    pushMarketplace();
  }
  return true;
}

function unlistCustomSkin(listingId){
  ensureMarketplace();
  const before = state.marketplace.listings.length;
  state.marketplace.listings = state.marketplace.listings.filter(l => l.id !== listingId);
  /* Tombstone: remember this id was deleted so the next pull from
     the shared bin doesn't bring it back. Without this, another
     client (or our own next fetch) would treat the old entry as
     "still alive" and revive it. */
  if (!Array.isArray(state.marketplace.removed)) state.marketplace.removed = [];
  if (state.marketplace.listings.length !== before){
    if (state.marketplace.removed.indexOf(listingId) < 0){
      state.marketplace.removed.push(listingId);
      /* Cap tombstones so the bin stays small. */
      if (state.marketplace.removed.length > 500){
        state.marketplace.removed = state.marketplace.removed.slice(-500);
      }
    }
  }
  saveState();
  if (typeof navigator === "undefined" || navigator.onLine !== false){
    pushMarketplace();
  }
}

function buyMarketplaceListing(listingId){
  ensureMarketplace();
  ensureCustomInv();
  const idx = state.marketplace.listings.findIndex(l => l.id === listingId);
  if (idx < 0) return false;
  const listing = state.marketplace.listings[idx];
  /* Can't buy your own listing. */
  if (listing.sellerId === state.profile.id){
    toast(t("custom.toast.ownListing") || "That's your listing", "info");
    return false;
  }
  if (typeof spendCoins !== "function" || !spendCoins(listing.price)){
    toast(t("shop.skin.poor") || "Not enough HEX", "info");
    return false;
  }
  /* Copy the listing into the buyer's owned customs and remove
     it from the marketplace pool. */
  const rec = saveCustomSkin({
    name: listing.name + " · " + listing.sellerName,
    palette: listing.palette,
    accent: listing.accent,
  });
  state.marketplace.purchased.push({
    listingId: listing.id, at: Date.now(), price: listing.price,
    sellerId: listing.sellerId, sellerName: listing.sellerName,
    skinId: rec ? rec.id : "",
  });
  state.marketplace.listings.splice(idx, 1);
  /* Same tombstone treatment as unlist — a sold listing should
     never reappear from a stale remote pull. */
  if (!Array.isArray(state.marketplace.removed)) state.marketplace.removed = [];
  if (state.marketplace.removed.indexOf(listing.id) < 0){
    state.marketplace.removed.push(listing.id);
    if (state.marketplace.removed.length > 500){
      state.marketplace.removed = state.marketplace.removed.slice(-500);
    }
  }
  saveState();
  toast(t("custom.toast.bought") || "Skin purchased", "success");
  if (typeof navigator === "undefined" || navigator.onLine !== false){
    pushMarketplace();
  }
  return rec;
}

/* ---------- Rendering ---------- */
function renderCustomEditor(){
  const panel = document.getElementById("shop-pane-custom");
  if (!panel) return;
  ensureCustomInv();
  /* Pick a working draft: either the last-edited custom skin, or
     a blank one with the default palette. We stash the draft on
     the panel element so re-renders preserve the in-progress
     state without persisting it. */
  if (!panel.dataset.draftInited){
    panel.dataset.draftInited = "1";
    panel._draft = {
      id: "",
      name: "Custom #" + ((state.customSkins.owned.length || 0) + 1),
      palette: CUSTOM_DEFAULT_PALETTE.slice(),
      accent: CUSTOM_DEFAULT_PALETTE[0],
    };
  }
  const draft = panel._draft;

  let html = '';
  html += '<div class="shop-pane-hint">'+ (t("custom.editor.hint") || "Design 6 textures for your figures. Save to your collection, then list it on the market.") +'</div>';
  html += '<div class="custom-editor glass">';
  html += '  <div class="custom-editor-name">';
  html += '    <label data-i18n="custom.editor.name">Name</label>';
  html += '    <input type="text" id="custom-name" maxlength="24" value="'+ String(draft.name).replace(/"/g,"&quot;") +'">';
  html += '  </div>';
  html += '  <div class="custom-editor-row">';
  for (let i = 0; i < CUSTOM_SKIN_TEXTURES; i++){
    html += '<label class="custom-cell" data-idx="'+ i +'">';
    html += '  <input class="custom-cell-input" type="color" value="'+ draft.palette[i] +'" data-idx="'+ i +'">';
    html += '  <span class="custom-cell-swatch" style="background:'+ draft.palette[i] +'"></span>';
    html += '  <b class="custom-cell-num">'+ (i+1) +'</b>';
    html += '</label>';
  }
  html += '  </div>';
  html += '  <div class="custom-editor-preview"><b data-i18n="custom.editor.preview">Preview</b>';
  /* Mini preview: 3 pieces using the new palette so the user sees
     what their textures look like on real figures. */
  html += '    <div class="custom-preview-pieces" id="custom-preview"></div>';
  html += '  </div>';
  html += '  <div class="custom-editor-actions">';
  html += '    <button class="btn btn-primary" id="custom-save">'+ (t("custom.editor.save") || "Save to my skins") +'</button>';
  html += '    <button class="btn" id="custom-reset">'+ (t("custom.editor.reset") || "Reset") +'</button>';
  /* Gallery import: lets the player pick a photo and we sample 6
     swatches from it. The actual <input type=file> is hidden and
     triggered from the button so we keep the visual rhythm of the
     editor footer. */
  html += '    <button class="btn btn-ghost" id="custom-upload-btn"><svg class="ic-svg"><use href="#i-camera"/></svg> <span>'+ (t("custom.upload.btn") || "Choose image") +'</span></button>';
  html += '    <input type="file" id="custom-upload-input" accept="image/*" style="display:none">';
  html += '  </div>';
  html += '  <div class="custom-upload-hint">'+ (t("custom.upload.hint") || "Pick an image — we extract 6 textures from it.") +'</div>';
  html += '</div>';

  /* My customs list */
  html += '<div class="custom-list">';
  html += '  <h3 class="custom-list-title">'+ (t("custom.list.title") || "Your custom skins") +'</h3>';
  if (state.customSkins.owned.length === 0){
    html += '<div class="custom-empty">'+ (t("custom.list.empty") || "No custom skins yet.") +'</div>';
  } else {
    state.customSkins.owned.forEach(s => {
      const equipped = (typeof currentSkinId === "function") && currentSkinId() === s.id;
      html += '<div class="custom-card" data-id="'+ s.id +'">';
      html += '  <div class="custom-card-strip">';
      for (let i = 0; i < CUSTOM_SKIN_TEXTURES; i++){
        html += '<i style="background:'+ (s.palette[i] || s.accent) +'"></i>';
      }
      html += '  </div>';
      html += '  <div class="custom-card-name">'+ s.name +'</div>';
      html += '  <div class="custom-card-actions">';
      if (equipped){
        html += '<span class="custom-card-on">'+ (t("shop.skin.active") || "Active") +'</span>';
      } else {
        html += '<button class="btn btn-primary" data-equip="'+ s.id +'">'+ (t("shop.skin.equip") || "Equip") +'</button>';
      }
      html += '<button class="btn" data-edit="'+ s.id +'">'+ (t("custom.card.edit") || "Edit") +'</button>';
      html += '<button class="btn btn-ghost" data-list="'+ s.id +'">'+ (t("custom.card.list") || "List on market") +'</button>';
      html += '<button class="btn btn-ghost" data-del="'+ s.id +'">'+ (t("custom.card.delete") || "Delete") +'</button>';
      html += '  </div>';
      html += '</div>';
    });
  }
  html += '</div>';

  panel.innerHTML = html;
  if (typeof applyI18n === "function") applyI18n();
  customRenderPreview(draft);
  customWireEditor(panel, draft);
}

function customRenderPreview(draft){
  const wrap = document.getElementById("custom-preview");
  if (!wrap) return;
  /* 3 sample shapes painted with consecutive draft palette slots. */
  const shapes = [
    [[1,1,1],[0,1,0]],
    [[1,1],[1,1]],
    [[1,1,1,1]],
  ];
  wrap.innerHTML = "";
  shapes.forEach((shape, sIdx) => {
    const color = draft.palette[(sIdx*2) % draft.palette.length];
    const fl = document.createElement("div");
    fl.className = "custom-preview-piece";
    fl.style.gridTemplateColumns = "repeat("+ shape[0].length +", 14px)";
    for (let r = 0; r < shape.length; r++){
      for (let c = 0; c < shape[0].length; c++){
        const cell = document.createElement("div");
        cell.className = "custom-preview-cell" + (shape[r][c] ? "" : " gap");
        cell.style.setProperty("--cell-color", color);
        fl.appendChild(cell);
      }
    }
    wrap.appendChild(fl);
  });
}

function customWireEditor(panel, draft){
  const nameInput = panel.querySelector("#custom-name");
  if (nameInput) nameInput.addEventListener("input", () => { draft.name = nameInput.value; });

  panel.querySelectorAll(".custom-cell-input").forEach(inp => {
    inp.addEventListener("input", () => {
      const i = parseInt(inp.dataset.idx, 10) || 0;
      const v = String(inp.value).toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(v)){
        draft.palette[i] = v;
        const sw = panel.querySelectorAll(".custom-cell-swatch")[i];
        if (sw) sw.style.background = v;
        if (i === 0) draft.accent = v;
        customRenderPreview(draft);
      }
    });
  });

  /* Gallery import — read an image, draw it on a tiny offscreen
     canvas and sample 6 evenly spaced columns for the palette.
     Keeping the canvas small (60×60) means the colour buckets are
     dominated by the image's big regions, which is exactly what
     we want for a piece palette. */
  const uploadBtn   = panel.querySelector("#custom-upload-btn");
  const uploadInput = panel.querySelector("#custom-upload-input");
  if (uploadBtn && uploadInput){
    uploadBtn.addEventListener("click", () => uploadInput.click());
    uploadInput.addEventListener("change", () => {
      const file = uploadInput.files && uploadInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const W = 60, H = 60;
            const cvs = document.createElement("canvas");
            cvs.width = W; cvs.height = H;
            const ctx = cvs.getContext("2d");
            ctx.drawImage(img, 0, 0, W, H);
            const data = ctx.getImageData(0, 0, W, H).data;
            const slots = CUSTOM_SKIN_TEXTURES;
            const samples = new Array(slots).fill(null).map(() => ({ r:0, g:0, b:0, n:0 }));
            for (let y = 0; y < H; y++){
              for (let x = 0; x < W; x++){
                const idx = (y * W + x) * 4;
                const slot = Math.min(slots - 1, Math.floor(x / (W / slots)));
                samples[slot].r += data[idx];
                samples[slot].g += data[idx+1];
                samples[slot].b += data[idx+2];
                samples[slot].n += 1;
              }
            }
            const hex = c => {
              const h = Math.max(0, Math.min(255, c | 0)).toString(16);
              return h.length === 1 ? "0" + h : h;
            };
            samples.forEach((s, i) => {
              const r = (s.r / Math.max(1, s.n)) | 0;
              const g = (s.g / Math.max(1, s.n)) | 0;
              const b = (s.b / Math.max(1, s.n)) | 0;
              draft.palette[i] = "#" + hex(r) + hex(g) + hex(b);
            });
            draft.accent = draft.palette[0];
            renderCustomEditor();
            toast(t("custom.upload.ok") || "Texture imported from image", "success");
          } catch {
            toast(t("custom.upload.fail") || "Could not read this image", "error");
          }
        };
        img.onerror = () => toast(t("custom.upload.fail") || "Could not read this image", "error");
        img.src = String(reader.result || "");
      };
      reader.onerror = () => toast(t("custom.upload.fail") || "Could not read this image", "error");
      reader.readAsDataURL(file);
      /* Reset so picking the same file again still triggers change. */
      uploadInput.value = "";
    });
  }

  panel.querySelector("#custom-save").addEventListener("click", () => {
    const rec = saveCustomSkin(draft);
    if (rec){
      toast(t("custom.toast.saved") || "Custom skin saved", "success");
      /* Reset the draft so subsequent saves create new entries. */
      delete panel.dataset.draftInited;
      renderCustomEditor();
      if (typeof renderShop === "function") renderShop();
    }
  });
  panel.querySelector("#custom-reset").addEventListener("click", () => {
    delete panel.dataset.draftInited;
    renderCustomEditor();
  });

  panel.querySelectorAll("[data-equip]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.equip;
    /* Make sure SKINS map is up to date for legacy save imports
       (they wouldn't have re-registered on this session). */
    const rec = customSkinById(id);
    if (rec && typeof SKINS !== "undefined" && !SKINS[id]){
      SKINS[id] = { name: rec.name, price: 0, accent: rec.accent, palette: rec.palette, custom: true };
    }
    if (typeof equipSkin === "function" && equipSkin(id)){
      renderCustomEditor();
    }
  }));
  panel.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.edit;
    const rec = customSkinById(id);
    if (!rec) return;
    delete panel.dataset.draftInited;
    panel._draft = { id: rec.id, name: rec.name, palette: rec.palette.slice(), accent: rec.accent };
    panel.dataset.draftInited = "1";
    renderCustomEditor();
  }));
  panel.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.del;
    deleteCustomSkin(id);
    renderCustomEditor();
    if (typeof renderShop === "function") renderShop();
  }));
  panel.querySelectorAll("[data-list]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.list;
    openListingModal(id);
  }));
}

/* ---------- Marketplace pane ---------- */
function renderMarketplace(){
  const panel = document.getElementById("shop-pane-market");
  if (!panel) return;
  ensureMarketplace();
  ensureCustomInv();
  const admin = (typeof isAdminUser === "function") && isAdminUser();
  const cooldown = listingsCooldownLeftMs();
  const fmt = (typeof formatCoins === "function") ? formatCoins : String;
  /* Opening the marketplace pane should always feel fresh — kick
     a non-blocking fetch in the background. The cached listings
     render immediately below; the fetch overlays the latest data
     from the shared bin as soon as it arrives. */
  if (typeof navigator === "undefined" || navigator.onLine !== false){
    if (typeof fetchMarketplace === "function"){
      fetchMarketplace().then(changed => {
        /* Repaint only if the merge actually changed something
           and the pane is still on screen, so we don't fight the
           user's click. */
        if (changed && document.getElementById("shop-pane-market")) renderMarketplace();
      }).catch(() => {});
    }
  }
  /* The "offline" banner is reserved for the case where we've
     genuinely run out of cached options to show — when the
     browser explicitly says it's offline AND the remote cache
     has produced two consecutive failures. Otherwise we render
     listings from cache so a flaky moment doesn't blank the UI. */
  const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  const remoteDown     = marketCache.online === false && (marketCache.failureStreak | 0) >= 2;
  const online         = !(browserOffline && remoteDown);

  let html = '';
  html += '<div class="shop-pane-hint">'+ (t("market.hint") || "Buy custom textures from other players for HEX.") +'</div>';

  /* Offline takeover — we still show the cached listings beneath,
     but a prominent panel asks the player to reconnect. The retry
     button just re-renders, which re-reads navigator.onLine. */
  if (!online){
    html += '<div class="market-offline glass">';
    html += '  <div class="market-offline-icon"><svg class="ic-svg lg"><use href="#i-wifi-off"/></svg></div>';
    html += '  <div class="market-offline-body">';
    html += '    <div class="market-offline-title">'+ (t("market.offline.title") || "No internet connection") +'</div>';
    html += '    <div class="market-offline-sub">'+ (t("market.offline.sub") || "Marketplace listings need an active connection.") +'</div>';
    html += '  </div>';
    html += '  <button class="btn btn-primary" id="market-offline-retry">'+ (t("market.offline.retry") || "Retry") +'</button>';
    html += '</div>';
  }

  html += '<div class="market-status glass">';
  if (online){
    html += '<div class="market-status-line market-online-note">'+ (t("market.online.note") || "Live · syncing in real time") +'</div>';
  }
  if (admin){
    html += '<div class="market-status-line">'+ (t("market.admin.note") || "Admin · unlimited listings") +'</div>';
  } else if (cooldown > 0){
    const h = Math.ceil(cooldown / 3600000);
    html += '<div class="market-status-line">'+ ((t("market.cooldown") || "Next listing available in {n}h").replace("{n}", h)) +'</div>';
  } else {
    html += '<div class="market-status-line">'+ (t("market.canList") || "Ready to list one custom skin") +'</div>';
  }
  html += '</div>';

  html += '<div class="market-grid">';
  if (state.marketplace.listings.length === 0){
    html += '<div class="market-empty">'+ (t("market.empty") || "No listings yet — be the first!") +'</div>';
  } else {
    state.marketplace.listings.forEach(l => {
      const isMine = l.sellerId === state.profile.id;
      html += '<div class="market-card glass" data-id="'+ l.id +'">';
      html += '  <div class="market-card-strip">';
      for (let i = 0; i < CUSTOM_SKIN_TEXTURES; i++){
        html += '<i style="background:'+ (l.palette[i] || l.accent) +'"></i>';
      }
      html += '  </div>';
      html += '  <div class="market-card-name">'+ l.name +'</div>';
      html += '  <div class="market-card-seller">'+ (t("market.by") || "by") +' <b>'+ l.sellerName +'</b></div>';
      html += '  <div class="market-card-foot">';
      html += '    <div class="market-price mono"><svg class="ic-svg"><use href="#i-coin"/></svg> '+ fmt(l.price) +'</div>';
      if (isMine || admin){
        html += '    <button class="btn btn-ghost" data-unlist="'+ l.id +'">'+ (t("market.unlist") || "Unlist") +'</button>';
      } else {
        html += '    <button class="btn btn-primary" data-buy="'+ l.id +'">'+ (t("market.buy") || "Buy") +'</button>';
      }
      html += '  </div>';
      html += '</div>';
    });
  }
  html += '</div>';

  panel.innerHTML = html;
  if (typeof applyI18n === "function") applyI18n();
  panel.querySelectorAll("[data-buy]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.buy;
    if (buyMarketplaceListing(id)){
      renderMarketplace();
      if (typeof renderShop === "function") renderShop();
    }
  }));
  panel.querySelectorAll("[data-unlist]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.unlist;
    unlistCustomSkin(id);
    renderMarketplace();
  }));
  const retry = panel.querySelector("#market-offline-retry");
  if (retry){
    retry.addEventListener("click", () => renderMarketplace());
  }
}

/* Re-render the marketplace when the browser regains/loses
   connectivity. The window listeners are idempotent — we only
   bind them once per session. */
if (typeof window !== "undefined" && !window.__marketOnlineWired){
  window.__marketOnlineWired = true;
  const reflow = () => {
    if (document.getElementById("shop-pane-market")) renderMarketplace();
  };
  window.addEventListener("online",  reflow);
  window.addEventListener("offline", reflow);
}

/* ---------- Listing modal ----------
   Built dynamically because we don't want a permanent DOM node
   for an action that's used rarely. Returns silently if the
   target skin doesn't exist. */
function openListingModal(skinId){
  ensureMarketplace();
  ensureCustomInv();
  const rec = customSkinById(skinId);
  if (!rec) return;
  const back = document.createElement("div");
  back.className = "modal-back show active";
  back.id = "modal-list-skin";
  const cd = listingsCooldownLeftMs();
  const admin = (typeof isAdminUser === "function") && isAdminUser();
  const fmt = (typeof formatCoins === "function") ? formatCoins : String;
  const strip = rec.palette.map(c => '<i style="background:'+ c +'"></i>').join("");

  back.innerHTML =
    '<div class="modal glass list-skin-modal" role="dialog" aria-modal="true">'+
    '  <h2>'+ (t("custom.list.title2") || "List on marketplace") +'</h2>'+
    '  <p>'+ (t("custom.list.sub") || "Set a HEX price for your custom texture.") +'</p>'+
    '  <div class="list-skin-strip">'+ strip +'</div>'+
    '  <div class="list-skin-row">'+
    '    <label>'+ (t("custom.list.priceLabel") || "Price (HEX)") +'</label>'+
    '    <input type="number" id="list-skin-price" min="'+ CUSTOM_LISTING_MIN_PRICE +'" max="'+ CUSTOM_LISTING_MAX_PRICE +'" value="1000">'+
    '  </div>'+
    (admin ? '' :
      (cd > 0
        ? '<div class="list-skin-cool">'+ ((t("custom.list.cooldown") || "You can list again in {n}h").replace("{n}", Math.ceil(cd/3600000))) +'</div>'
        : '<div class="list-skin-cool ok">'+ (t("custom.list.ready") || "You can list now (then wait 24h)") +'</div>'
      ))+
    '  <div class="modal-actions">'+
    '    <button class="btn btn-primary" id="list-skin-go">'+ (t("custom.list.btn") || "Post listing") +'</button>'+
    '    <button class="btn" id="list-skin-cancel">'+ (t("shop.confirm.no") || "Cancel") +'</button>'+
    '  </div>'+
    '</div>';
  document.body.appendChild(back);

  const close = () => back.remove();
  back.querySelector("#list-skin-cancel").addEventListener("click", close);
  back.addEventListener("click", (ev) => { if (ev.target === back) close(); });
  back.querySelector("#list-skin-go").addEventListener("click", () => {
    const price = parseInt(back.querySelector("#list-skin-price").value, 10) || 0;
    if (listCustomSkin(skinId, price)){
      close();
      if (typeof renderShop === "function") renderShop();
      if (typeof renderMarketplace === "function") renderMarketplace();
    }
  });
}

/* Ensure SKINS gets the customs back into its registry on every
   page boot, even before the user opens the editor. Called by
   main.js right after the saved state is loaded. */
function rehydrateCustomSkins(){
  ensureCustomInv();
  if (typeof SKINS === "undefined") return;
  state.customSkins.owned.forEach(rec => {
    SKINS[rec.id] = {
      name: rec.name,
      price: 0,
      accent: rec.accent,
      palette: rec.palette,
      custom: true,
    };
    if (state.skins && Array.isArray(state.skins.unlocked) && state.skins.unlocked.indexOf(rec.id) < 0){
      state.skins.unlocked.push(rec.id);
    }
  });
}
