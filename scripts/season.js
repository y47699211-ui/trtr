/* ---------- Seasonal event ----------
   The "season" rotates roughly every calendar month. Each season
   exposes a small set of exclusive-to-that-season cosmetic skins
   that drop from the Battle Pass premium track but also surface
   in a dedicated "Season" tab in the shop while the event is
   live.

   The rotation key is just the current YYYY-MM string. Season
   skin ids are namespaced with the `season_` prefix so the rest of
   the code can tell them apart from base skins. The visual
   palette of each seasonal skin is defined here so we don't bloat
   the main `SKINS` registry that lives in scripts/skins.js. */

function seasonId(){
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

/* Friendly name for the current season. Keyed off the month so
   each calendar month is its own themed event. */
function seasonName(id){
  const sid = id || seasonId();
  const month = parseInt((sid.split("-")[1] || "1"), 10) - 1;
  const monthNames = [
    "Winter Spark", "Frost Echo", "Spring Bloom", "Aurora Dawn",
    "Sunset Drift", "Solstice Heat", "Neon Pulse", "Eclipse",
    "Harvest Rune", "Crimson Moon", "Starfall", "Midnight Glow",
  ];
  return (monthNames[month] || "Season") + " · " + sid;
}

/* Seasonal skins. Each entry mirrors the base SKINS layout
   (`name, price, accent, palette[6+]`) and is merged into the
   global SKINS registry on first access. Players normally earn
   these from the Battle Pass premium track; we also let them
   buy any with HEX from the seasonal screen at a premium price
   while the season is live, so missing the pass isn't a hard
   gate. */
const SEASONAL_SKINS = {
  season_ember: {
    name: "Ember Rune",
    price: 4000,
    accent: "#ff7a3d",
    palette: [
      "#ff7a3d","#ff3d6a","#ffb454","#ff5a3d","#ffe0b3","#ff8855",
      "#ff6b35","#ffa872","#ff5263","#ffd28a",
    ],
    seasonal: true,
  },
  season_frost: {
    name: "Frost Echo",
    price: 4000,
    accent: "#7fdcff",
    palette: [
      "#7fdcff","#a0e1ff","#caf2ff","#5cb8ff","#4f9be8","#e6f6ff",
      "#9dd2ff","#bce6ff","#7ab8e3","#cfe8ff",
    ],
    seasonal: true,
  },
  season_eclipse: {
    name: "Eclipse",
    price: 5000,
    accent: "#8b5cf6",
    palette: [
      "#8b5cf6","#a766ff","#c084fc","#5b3aed","#6d28d9","#312e81",
      "#1e1b4b","#312f60","#7449c2","#4338ca",
    ],
    seasonal: true,
  },
  season_bloom: {
    name: "Spring Bloom",
    price: 4500,
    accent: "#34d399",
    palette: [
      "#34d399","#86efac","#a7f3d0","#fbcfe8","#f9a8d4","#fde68a",
      "#bef264","#6ee7b7","#facc15","#f472b6",
    ],
    seasonal: true,
  },
  season_neonpulse: {
    name: "Neon Pulse",
    price: 5500,
    accent: "#39ff14",
    palette: [
      "#39ff14","#ff00ff","#00ffff","#ffea00","#ff3df0","#5cffff",
      "#7cff8a","#fff04d","#ff6dff","#a3ff5c",
    ],
    seasonal: true,
  },
  season_aurora_lights: {
    name: "Aurora Lights",
    price: 6500,
    accent: "#22d3ee",
    palette: [
      "#22d3ee","#34d399","#a78bfa","#f472b6","#facc15","#60a5fa",
      "#fb7185","#67e8f9","#86efac","#c4b5fd",
    ],
    seasonal: true,
  },
};

/* Active in the current season → array of skin ids. We cycle
   through SEASONAL_SKINS so each month features 3 different
   exclusive skins. */
function seasonActiveSkins(){
  const ids = Object.keys(SEASONAL_SKINS);
  const sid = seasonId();
  const monthIdx = parseInt((sid.split("-")[1] || "1"), 10) - 1;
  /* 3 skins per month, wrapping. */
  const out = [];
  for (let i = 0; i < 3; i++){
    out.push(ids[(monthIdx * 3 + i) % ids.length]);
  }
  return out;
}

function ensureSeasonalRegistered(){
  if (typeof SKINS === "undefined") return;
  for (const id in SEASONAL_SKINS){
    if (!SKINS[id]) SKINS[id] = SEASONAL_SKINS[id];
  }
}

function isSeasonalSkin(id){
  return !!SEASONAL_SKINS[id];
}

function seasonalIsAvailable(id){
  return seasonActiveSkins().indexOf(id) >= 0;
}

/* Buy a seasonal skin directly with HEX (premium fallback path).
   Only enabled while that skin is in the current season. */
function buySeasonalSkin(id){
  if (!isSeasonalSkin(id)) return false;
  if (!seasonalIsAvailable(id)){
    toast(t("season.toast.expired") || "Out of season", "info");
    return false;
  }
  if (typeof isSkinUnlocked === "function" && isSkinUnlocked(id)){
    if (typeof equipSkin === "function") equipSkin(id);
    return true;
  }
  const meta = SEASONAL_SKINS[id];
  const admin = (typeof isAdminUser === "function") && isAdminUser();
  if (!admin){
    if (typeof spendCoins !== "function" || !spendCoins(meta.price)){
      toast(t("shop.skin.poor") || "Not enough HEX", "info");
      return false;
    }
  }
  if (typeof unlockSkin === "function") unlockSkin(id);
  if (!state.seasonal) state.seasonal = { unlocked: [] };
  if (state.seasonal.unlocked.indexOf(id) < 0) state.seasonal.unlocked.push(id);
  saveState();
  if (typeof renderWallet === "function") renderWallet();
  toast((t("shop.skin.bought") || "{name} unlocked").replace("{name}", meta.name), "success");
  return true;
}

/* Renders the seasonal panel into #season-panel. */
function renderSeasonal(){
  const panel = document.getElementById("season-panel");
  if (!panel) return;
  ensureSeasonalRegistered();
  const sid = seasonId();
  const active = seasonActiveSkins();
  const fmt = (typeof formatCoins === "function") ? formatCoins : String;

  let html = '';
  html += '<div class="season-head glass">';
  html += '  <div class="season-title"><svg class="ic-svg lg"><use href="#i-sparkle"/></svg><b>'+ (t("season.title") || "Seasonal event") +'</b></div>';
  html += '  <div class="season-sub mono">'+ seasonName(sid) +'</div>';
  html += '  <p class="season-desc">'+ (t("season.desc") || "Limited cosmetics. Only available this month.") +'</p>';
  html += '</div>';

  html += '<div class="season-grid">';
  active.forEach(id => {
    const meta = SEASONAL_SKINS[id];
    const owned = (typeof isSkinUnlocked === "function") && isSkinUnlocked(id);
    const equipped = (typeof currentSkinId === "function") && currentSkinId() === id;
    html += '<div class="season-card glass" data-id="'+ id +'">';
    html += '  <div class="season-card-art" style="--accent:'+ meta.accent +'">';
    /* Swatch strip from the palette so each card visually previews the texture. */
    for (let i = 0; i < 6; i++){
      const c = meta.palette[i] || meta.accent;
      html += '<i style="background:'+ c +'"></i>';
    }
    html += '  </div>';
    html += '  <div class="season-card-name">'+ meta.name +'</div>';
    html += '  <div class="season-card-foot">';
    if (equipped){
      html += '<span class="season-pill on">'+ (t("shop.skin.active") || "Active") +'</span>';
    } else if (owned){
      html += '<button class="btn btn-primary season-equip" data-equip="'+ id +'">'+ (t("shop.skin.equip") || "Equip") +'</button>';
    } else {
      html += '<button class="btn btn-primary season-buy" data-buy="'+ id +'"><svg class="ic-svg"><use href="#i-coin"/></svg> '+ fmt(meta.price) +'</button>';
    }
    html += '  </div>';
    html += '</div>';
  });
  html += '</div>';

  panel.innerHTML = html;
  panel.querySelectorAll(".season-buy").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.buy;
    if (buySeasonalSkin(id)){
      renderSeasonal();
      if (typeof renderShop === "function") renderShop();
    }
  }));
  panel.querySelectorAll(".season-equip").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.equip;
    if (typeof equipSkin === "function" && equipSkin(id)){
      renderSeasonal();
      if (typeof renderShop === "function") renderShop();
    }
  }));
}
