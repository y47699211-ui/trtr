/* ---------- Mastery per skin ----------
   Every piece placed while a given skin is equipped earns mastery
   XP for that specific skin. Reaching milestones unlocks small
   visual effects layered on top of the board:
     L1 — soft glow ring
     L2 — sparkle particles
     L3 — animated gradient sheen
     L4 — afterimage trail when placing
     L5 — full "mastered" badge + extra particle burst on clears

   The HUD / board reads the active skin's mastery level via
   `masteryLevel(currentSkinId())` and toggles the corresponding
   data-attribute on <body>. CSS in styles/mastery.css picks it up.
*/

const MASTERY_TIERS = [0, 200, 600, 1500, 3500, 7500];
const MASTERY_MAX = MASTERY_TIERS.length - 1;
const MASTERY_PER_PLACE = 1;
const MASTERY_PER_LINE  = 3;

function ensureMasterySlot(skinId){
  if (!state.mastery) state.mastery = {};
  if (!state.mastery[skinId]) state.mastery[skinId] = { xp: 0, claimed: 0 };
  return state.mastery[skinId];
}

function masteryLevel(skinId){
  if (!skinId) return 0;
  const slot = ensureMasterySlot(skinId);
  const xp = slot.xp | 0;
  let lvl = 0;
  for (let i = MASTERY_TIERS.length - 1; i >= 0; i--){
    if (xp >= MASTERY_TIERS[i]) { lvl = i; break; }
  }
  return lvl;
}

function masteryNextThreshold(skinId){
  const lvl = masteryLevel(skinId);
  if (lvl >= MASTERY_MAX) return MASTERY_TIERS[MASTERY_MAX];
  return MASTERY_TIERS[lvl + 1];
}

function masteryProgress(skinId){
  const slot = ensureMasterySlot(skinId);
  const lvl  = masteryLevel(skinId);
  const xp   = slot.xp | 0;
  const baseXp = MASTERY_TIERS[lvl];
  const nextXp = MASTERY_TIERS[Math.min(MASTERY_MAX, lvl + 1)];
  const span   = Math.max(1, nextXp - baseXp);
  const into   = Math.max(0, xp - baseXp);
  return { lvl, xp, baseXp, nextXp, span, into, pct: Math.min(100, Math.round((into / span) * 100)) };
}

function gainSkinMastery(amount){
  const id = (typeof currentSkinId === "function") ? currentSkinId() : null;
  if (!id) return;
  const slot = ensureMasterySlot(id);
  const before = masteryLevel(id);
  slot.xp = Math.max(0, (slot.xp | 0) + Math.round(amount));
  const after = masteryLevel(id);
  if (after > before){
    try { if (typeof toast === "function") toast((t("mastery.toast.lvlup") || "Mastery Lvl {n}").replace("{n}", after), "success"); } catch {}
    applySkinMasteryEffect(id);
    if (typeof renderShop === "function" && document.querySelector('[data-screen="shop"]')?.classList.contains("active")){
      renderShop();
    }
  }
}

/* Drive the body[data-mastery] attribute so CSS can switch on
   the effect tier for the equipped skin. Called from skins.js on
   equip and from `placePiece()` after XP gains. */
function applySkinMasteryEffect(skinId){
  const id = skinId || ((typeof currentSkinId === "function") ? currentSkinId() : "");
  const lvl = masteryLevel(id);
  document.body.setAttribute("data-mastery", String(lvl));
}

/* Render a small mastery badge (svg + lvl number + progress bar)
   used as a sub-card inside skin cards. Returns an HTML string. */
function masteryBadgeHtml(skinId){
  const prog = masteryProgress(skinId);
  const fmt = (typeof formatCoins === "function") ? formatCoins : String;
  return (
    '<div class="mastery-badge" data-skin="'+ skinId +'">'+
    '  <div class="mastery-badge-row">'+
    '    <svg class="ic-svg"><use href="#i-star"/></svg>'+
    '    <span class="mastery-lvl">'+ (t("mastery.lvl") || "Mastery") +' '+ prog.lvl +'</span>'+
    '    <span class="mastery-xp mono">'+ fmt(prog.into) +'/'+ fmt(prog.span) +'</span>'+
    '  </div>'+
    '  <div class="mastery-bar"><div class="mastery-bar-fill" style="width:'+ prog.pct +'%"></div></div>'+
    '</div>'
  );
}
