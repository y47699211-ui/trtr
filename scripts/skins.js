/* ============================================================
   HEXON BETA — Piece skins
   ============================================================
   A "skin" is a named palette + accent colour that re-paints every
   piece, tray cell, board cell, and shop preview. Skins live in
   state.skins (equipped + unlocked) and are persisted via
   storage.js. Players unlock new skins from the in-game shop.

   Adding a skin: append an entry to SKINS with a unique id, a
   localisation key (so i18n can translate the name later), a
   price in HEX coins, and a 6-colour palette. The default skin
   is free and pre-equipped.
   ============================================================ */
"use strict";

const SKINS = {
  default: {
    name: "Класична",
    price: 0,
    accent: "#7c5cff",
    palette: [
      "#7c5cff","#24bdff","#3ddc97","#ffb454","#ff6470",
      "#a766ff","#22d3ee","#facc15","#f472b6","#34d399",
    ],
  },
  neon: {
    name: "Неон",
    price: 800,
    accent: "#39ff14",
    palette: [
      "#39ff14","#ff00ff","#00ffff","#ffea00","#ff3df0",
      "#7cff8a","#5cffff","#fff04d","#ff6dff","#a3ff5c",
    ],
  },
  aurora: {
    name: "Аврора",
    price: 1500,
    accent: "#7CF1B8",
    palette: [
      "#7cf1b8","#6cc9ff","#a98bff","#ffd1f0","#6affd3",
      "#92d8ff","#c2a4ff","#ffb6e9","#73f3c5","#88c8ff",
    ],
  },
  ocean: {
    name: "Океан",
    price: 2500,
    accent: "#1097d6",
    palette: [
      "#1097d6","#0ec8b6","#2c5fbf","#7cd9ff","#3ddc97",
      "#1a5fa3","#0fbfd4","#5bb1ff","#23b8a1","#3a7cd8",
    ],
  },
  sunset: {
    name: "Захід",
    price: 5000,
    accent: "#ff7a59",
    palette: [
      "#ff7a59","#ffb454","#ff5e9e","#ffd166","#ef476f",
      "#ff8e5e","#ffc06b","#ff77b2","#ffd884","#f55a85",
    ],
  },
  pastel: {
    name: "Пастель",
    price: 3000,
    accent: "#fcb1e5",
    palette: [
      "#fcb1e5","#b1d6fc","#c7fcb1","#fcd6b1","#d6b1fc",
      "#fcc6c6","#b1f0fc","#e7fcb1","#fce0b1","#cab1fc",
    ],
  },
  ember: {
    name: "Жар",
    price: 8000,
    accent: "#ff3d00",
    palette: [
      "#ff3d00","#ff7300","#ffb300","#ffd000","#c41e3a",
      "#ff5722","#ff9a3a","#ffc23a","#ffea3a","#e63a4d",
    ],
  },
  galaxy: {
    name: "Галактика",
    price: 12000,
    accent: "#9b5cff",
    palette: [
      "#9b5cff","#4a3aff","#ff5cff","#5cf6ff","#ffd166",
      "#7d3aff","#3a4bff","#e74cff","#3acaff","#ffe9a3",
    ],
  },
  mono: {
    name: "Моно",
    price: 1000,
    accent: "#e6e9f5",
    palette: [
      "#e6e9f5","#bcc1d6","#9aa0b8","#7a8099","#5d6280",
      "#cad0e3","#a8aec8","#888fac","#6d7390","#4f5470",
    ],
  },
};

/* ============================================================
   Per-skin icons
   ============================================================
   Each skin has a unique inline SVG glyph that fills with three
   colours pulled from its own palette. The icons appear above
   the colour swatch in the Shop and on top of the menu tile so
   the player can tell skins apart at a glance.

   The builders below return a self-contained <svg> string sized
   24×24 so they can be dropped into any container. To add a new
   skin just register a builder under the same id used in SKINS.
   ============================================================ */
const SKIN_ICON_BUILDERS = {
  /* Three nested hexagons in the palette's primary, secondary and
     tertiary colours — a literal "stack of pieces" emblem. */
  default: (p) => (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 2 L20 7 L20 17 L12 22 L4 17 L4 7 Z" fill="' + p[0] + '" opacity="0.85"/>' +
      '<path d="M12 6 L17 9 L17 15 L12 18 L7 15 L7 9 Z" fill="' + p[1] + '"/>' +
      '<path d="M12 10 L14 11 L14 13 L12 14 L10 13 L10 11 Z" fill="' + p[2] + '"/>' +
    '</svg>'
  ),
  /* A lightning bolt with a faint after-glow trail — neon arcade
     vibes that match the harsh palette. */
  neon: (p) => (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M14 2 L4 14 H10 L8 22 L20 10 H14 L15 2 Z" fill="' + p[2] + '" opacity="0.45"/>' +
      '<path d="M13 2 L3 14 H9 L7 22 L19 10 H13 L14 2 Z" fill="' + p[0] + '"/>' +
      '<circle cx="20" cy="4"  r="1.4" fill="' + p[1] + '"/>' +
      '<circle cx="4"  cy="20" r="1.0" fill="' + p[1] + '"/>' +
    '</svg>'
  ),
  /* Three horizontal wave bands — the actual northern-lights look. */
  aurora: (p) => (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke-linecap="round" stroke-width="3">' +
      '<path d="M2 7 C 6 3, 10 11, 14 7 S 22 3, 22 7" stroke="' + p[0] + '"/>' +
      '<path d="M2 13 C 6 9, 10 17, 14 13 S 22 9, 22 13" stroke="' + p[1] + '"/>' +
      '<path d="M2 19 C 6 15, 10 23, 14 19 S 22 15, 22 19" stroke="' + p[2] + '"/>' +
    '</svg>'
  ),
  /* Sea swell with a single droplet over it — calm-water motif. */
  ocean: (p) => (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M2 14 C 6 11, 9 17, 12 14 S 18 11, 22 14 V22 H2 Z" fill="' + p[0] + '"/>' +
      '<path d="M2 18 C 6 15, 9 21, 12 18 S 18 15, 22 18 V22 H2 Z" fill="' + p[1] + '" opacity="0.9"/>' +
      '<path d="M17 3 C 19 6, 20 8, 17 8 S 15 6, 17 3 Z" fill="' + p[2] + '"/>' +
    '</svg>'
  ),
  /* Half-disc sun rising over a horizon, with a single hot ray. */
  sunset: (p) => (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="12" cy="14" r="7" fill="' + p[0] + '"/>' +
      '<circle cx="12" cy="14" r="4" fill="' + p[3] + '" opacity="0.85"/>' +
      '<rect x="0" y="16" width="24" height="3"  fill="' + p[1] + '" opacity="0.55"/>' +
      '<rect x="0" y="20" width="24" height="2"  fill="' + p[2] + '" opacity="0.75"/>' +
      '<path d="M12 2 V6 M6 6 L8 8 M18 6 L16 8" stroke="' + p[3] + '" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>'
  ),
  /* Three overlapping clouds in soft pastel hues. */
  pastel: (p) => (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="8"  cy="11" r="5" fill="' + p[0] + '"/>' +
      '<circle cx="15" cy="13" r="6" fill="' + p[1] + '" opacity="0.92"/>' +
      '<circle cx="11" cy="16" r="3" fill="' + p[2] + '"/>' +
      '<circle cx="18" cy="7"  r="1.6" fill="' + p[3] + '"/>' +
    '</svg>'
  ),
  /* Twin-tongue flame, hot core + cooler outer layer. */
  ember: (p) => (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 2 C 14 5, 17 7, 17 12 a5 5 0 1 1 -10 0 c 0 -3 2 -4 3 -6 -1 4 2 6 2 6 s -2 -3 0 -10 Z" fill="' + p[0] + '"/>' +
      '<path d="M12 9 C 13 11, 15 12, 15 15 a3 3 0 1 1 -6 0 c 0 -2 2 -2 3 -4 -1 3 2 3 2 3 s -2 -2 0 -1 Z" fill="' + p[2] + '"/>' +
      '<circle cx="12" cy="17" r="2" fill="' + p[3] + '"/>' +
    '</svg>'
  ),
  /* Tilted ellipse orbit with a coloured planet + scattered stars. */
  galaxy: (p) => (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<g transform="rotate(-22 12 12)">' +
        '<ellipse cx="12" cy="12" rx="10" ry="3.5" fill="none" stroke="' + p[0] + '" stroke-width="1.6" opacity="0.85"/>' +
      '</g>' +
      '<circle cx="12" cy="12" r="3.6" fill="' + p[1] + '"/>' +
      '<circle cx="12" cy="12" r="1.8" fill="' + p[2] + '"/>' +
      '<path d="M5  4 L5.6 5.4 L7 6 L5.6 6.6 L5 8 L4.4 6.6 L3 6 L4.4 5.4 Z" fill="' + p[3] + '"/>' +
      '<path d="M19 18 L19.5 19 L20.5 19.5 L19.5 20 L19 21 L18.5 20 L17.5 19.5 L18.5 19 Z" fill="' + p[4] + '"/>' +
    '</svg>'
  ),
  /* Faceted diamond / gem — all four facets carved from the same
     monochrome palette to highlight the "shades of grey" theme. */
  mono: (p) => (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 3 L21 9 L12 22 L3 9 Z" fill="' + p[0] + '"/>' +
      '<path d="M12 3 L21 9 L12 13 Z" fill="' + p[3] + '" opacity="0.9"/>' +
      '<path d="M12 3 L3 9 L12 13 Z" fill="' + p[1] + '" opacity="0.92"/>' +
      '<path d="M12 13 L21 9 L12 22 Z" fill="' + p[2] + '" opacity="0.92"/>' +
    '</svg>'
  ),
};

/* Build the icon SVG string for a skin. Returns "" if the id is
   unknown so callers can do `if (svg) container.innerHTML = svg;`. */
function skinIconSvg(id){
  const skin = SKINS[id];
  if(!skin) return "";
  const build = SKIN_ICON_BUILDERS[id] || SKIN_ICON_BUILDERS.default;
  return build(skin.palette);
}

/* The list order used by the shop grid. Default comes first so the
   player always sees the "equipped" pill at the top. */
const SHOP_SKIN_ORDER = ["default","neon","aurora","ocean","pastel","sunset","ember","galaxy","mono"];

function currentSkinId(){
  return (state.skins && state.skins.equipped) || "default";
}
function currentSkin(){
  return SKINS[currentSkinId()] || SKINS.default;
}
function currentPalette(){
  return currentSkin().palette;
}
function isSkinUnlocked(id){
  return !!(state.skins && Array.isArray(state.skins.unlocked) && state.skins.unlocked.indexOf(id) >= 0);
}
function unlockSkin(id){
  if(!SKINS[id]) return false;
  if(!state.skins) state.skins = { equipped:"default", unlocked:["default"] };
  if(!Array.isArray(state.skins.unlocked)) state.skins.unlocked = ["default"];
  if(state.skins.unlocked.indexOf(id) < 0) state.skins.unlocked.push(id);
  return true;
}
function equipSkin(id){
  if(!SKINS[id]) return false;
  if(!isSkinUnlocked(id)) return false;
  state.skins.equipped = id;
  applySkinAccent();
  return true;
}
/* Push the equipped skin's accent into a CSS custom property so the
   menu, HUD, and shop can tint themselves to match the current
   piece palette without re-reading the JS state. */
function applySkinAccent(){
  const s = currentSkin();
  document.documentElement.style.setProperty("--skin-accent", s.accent || "#7c5cff");
  /* Keep the body[data-mastery] in sync with the freshly equipped
     skin so the mastery aura CSS swaps tiers immediately. */
  if (typeof applySkinMasteryEffect === "function") applySkinMasteryEffect();
}

/* Shallow metadata for any registered skin (base, seasonal, custom).
   Returns null for unknown ids so callers can short-circuit. Used by
   battlepass.js / season.js / mastery.js when they need to print a
   skin's name or accent without depending on the SKINS dict layout. */
function skinMeta(id){
  if (!id || typeof SKINS === "undefined") return null;
  const s = SKINS[id];
  if (!s) return null;
  return { id, name: s.name, accent: s.accent, palette: s.palette, custom: !!s.custom, seasonal: !!s.seasonal };
}
