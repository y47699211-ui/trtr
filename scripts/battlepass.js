/* ---------- Battle Pass ----------
   Seasonal progression track. Earning Battle Pass XP is decoupled
   from the global player XP so a player can play casually all
   month long and still tick the pass forward at a steady rate
   without distorting their account level.

   Each tier needs `BP_XP_PER_TIER` XP. The free track always
   pays out a small bag of HEX and milestone tiers gift one of
   the standard skins. The premium track stacks larger HEX
   payouts and seasonal-only skins on top (those are also
   listed in scripts/season.js so they show up in the seasonal
   bar even after the pass expires). */

const BP_TIERS_TOTAL = 30;
const BP_XP_PER_TIER = 240;
/* Premium track price in HEX. Bought once per season — flipping
   `state.battlepass.premium` to true unlocks every premium reward
   the player has already met the XP threshold for; later tiers
   are claimable in real time as XP accrues. */
const BP_PREMIUM_PRICE = 9000;

/* Reward shape: { type, amount, skin } where type is "coins" or
   "skin"; "skin" is a skin id from scripts/skins.js. */
const BP_FREE_REWARDS = [
  { type:"coins", amount: 100  },
  { type:"coins", amount: 150  },
  { type:"coins", amount: 200  },
  { type:"coins", amount: 250  },
  { type:"skin",  skin: "pastel" }, // tier 5
  { type:"coins", amount: 300  },
  { type:"coins", amount: 350  },
  { type:"coins", amount: 400  },
  { type:"coins", amount: 450  },
  { type:"skin",  skin: "ocean"  }, // tier 10
  { type:"coins", amount: 500  },
  { type:"coins", amount: 600  },
  { type:"coins", amount: 700  },
  { type:"coins", amount: 800  },
  { type:"skin",  skin: "aurora" }, // tier 15
  { type:"coins", amount: 900  },
  { type:"coins", amount: 1000 },
  { type:"coins", amount: 1100 },
  { type:"coins", amount: 1200 },
  { type:"skin",  skin: "sunset" }, // tier 20
  { type:"coins", amount: 1300 },
  { type:"coins", amount: 1400 },
  { type:"coins", amount: 1500 },
  { type:"coins", amount: 1600 },
  { type:"skin",  skin: "mono"   }, // tier 25
  { type:"coins", amount: 1700 },
  { type:"coins", amount: 1800 },
  { type:"coins", amount: 1900 },
  { type:"coins", amount: 2000 },
  { type:"skin",  skin: "galaxy" }, // tier 30 (final free)
];

const BP_PREMIUM_REWARDS = [
  { type:"coins", amount: 300  },
  { type:"coins", amount: 400  },
  { type:"coins", amount: 500  },
  { type:"coins", amount: 600  },
  { type:"skin",  skin: "season_ember" }, // tier 5 — seasonal exclusive
  { type:"coins", amount: 700  },
  { type:"coins", amount: 800  },
  { type:"coins", amount: 900  },
  { type:"coins", amount: 1000 },
  { type:"skin",  skin: "season_frost" }, // tier 10
  { type:"coins", amount: 1100 },
  { type:"coins", amount: 1200 },
  { type:"coins", amount: 1300 },
  { type:"coins", amount: 1400 },
  { type:"skin",  skin: "season_eclipse" }, // tier 15
  { type:"coins", amount: 1500 },
  { type:"coins", amount: 1700 },
  { type:"coins", amount: 1900 },
  { type:"coins", amount: 2100 },
  { type:"skin",  skin: "season_bloom" }, // tier 20
  { type:"coins", amount: 2300 },
  { type:"coins", amount: 2500 },
  { type:"coins", amount: 2700 },
  { type:"coins", amount: 2900 },
  { type:"skin",  skin: "season_neonpulse" }, // tier 25
  { type:"coins", amount: 3100 },
  { type:"coins", amount: 3300 },
  { type:"coins", amount: 3500 },
  { type:"coins", amount: 4000 },
  { type:"skin",  skin: "season_aurora_lights" }, // tier 30 — final
];

function ensureBattlePass(){
  if (!state.battlepass) state.battlepass = { season:"", xp:0, claimedFree:[], claimedPremium:[], premium:false };
  const cur = (typeof seasonId === "function") ? seasonId() : "default";
  if (state.battlepass.season !== cur){
    /* Season rotated since the last visit — reset pass progress
       but leave any granted skins, the HEX wallet and the global
       XP untouched. */
    state.battlepass = { season: cur, xp: 0, claimedFree: [], claimedPremium: [], premium: false };
  }
  if (!Array.isArray(state.battlepass.claimedFree))    state.battlepass.claimedFree    = [];
  if (!Array.isArray(state.battlepass.claimedPremium)) state.battlepass.claimedPremium = [];
}

function bpCurrentTier(){
  ensureBattlePass();
  const xp = state.battlepass.xp | 0;
  return Math.min(BP_TIERS_TOTAL, Math.floor(xp / BP_XP_PER_TIER));
}
function bpProgressIntoTier(){
  ensureBattlePass();
  return (state.battlepass.xp | 0) % BP_XP_PER_TIER;
}

function bpAddXp(n){
  if (!Number.isFinite(n) || n <= 0) return;
  ensureBattlePass();
  const before = bpCurrentTier();
  state.battlepass.xp = Math.max(0, (state.battlepass.xp | 0) + Math.round(n));
  const after = bpCurrentTier();
  if (after > before){
    try { if (typeof toast === "function") toast(t("bp.toast.tier",{n:after}) || ("Battle Pass: tier " + after), "success"); } catch {}
    /* Refresh the panel if the player is currently looking at it. */
    if (typeof renderBattlePass === "function" && document.querySelector('[data-screen="battlepass"]')?.classList.contains("active")){
      renderBattlePass();
    }
  }
  if (typeof saveStateSoon === "function") saveStateSoon();
  else saveState();
}

function bpRewardForTier(track, idx){
  const arr = track === "premium" ? BP_PREMIUM_REWARDS : BP_FREE_REWARDS;
  return arr[idx] || null;
}

function bpClaim(track, idx){
  ensureBattlePass();
  if (idx < 0 || idx >= BP_TIERS_TOTAL) return false;
  const tier = bpCurrentTier();
  if (idx >= tier) {
    toast(t("bp.toast.locked") || "Tier locked", "info");
    return false;
  }
  if (track === "premium" && !state.battlepass.premium){
    toast(t("bp.toast.needPremium") || "Premium pass required", "info");
    return false;
  }
  const ledger = track === "premium" ? state.battlepass.claimedPremium : state.battlepass.claimedFree;
  if (ledger.indexOf(idx) >= 0) return false;
  const reward = bpRewardForTier(track, idx);
  if (!reward) return false;
  if (reward.type === "coins"){
    if (typeof addCoins === "function") addCoins(reward.amount);
  } else if (reward.type === "skin"){
    if (typeof unlockSkin === "function") unlockSkin(reward.skin);
    /* Seasonal exclusives are also written to seasonal.unlocked so
       the Season screen can show them as "owned forever" later. */
    if (String(reward.skin).indexOf("season_") === 0){
      if (!state.seasonal) state.seasonal = { unlocked: [] };
      if (state.seasonal.unlocked.indexOf(reward.skin) < 0) state.seasonal.unlocked.push(reward.skin);
    }
  }
  ledger.push(idx);
  if (typeof saveStateSoon === "function") saveStateSoon();
  else saveState();
  try { if (typeof sfx !== "undefined" && sfx.coinUp) sfx.coinUp(); } catch {}
  toast(t("bp.toast.claimed") || "Reward claimed", "success");
  return true;
}

function bpBuyPremium(){
  ensureBattlePass();
  if (state.battlepass.premium) return true;
  const admin = (typeof isAdminUser === "function") && isAdminUser();
  if (admin){
    state.battlepass.premium = true;
    saveState();
    toast(t("bp.toast.premiumOn") || "Premium activated", "success");
    return true;
  }
  if (typeof spendCoins !== "function") return false;
  if (!spendCoins(BP_PREMIUM_PRICE)){
    toast(t("shop.skin.poor") || "Not enough HEX", "info");
    return false;
  }
  state.battlepass.premium = true;
  saveState();
  toast(t("bp.toast.premiumOn") || "Premium activated", "success");
  return true;
}

/* ---------- Rendering ---------- */
function bpRewardCellHtml(reward, claimed, claimable){
  if (!reward) return '<div class="bp-cell bp-cell-empty">—</div>';
  let inner = "";
  if (reward.type === "coins"){
    inner =
      '<div class="bp-reward-icon"><svg class="ic-svg lg"><use href="#i-coin"/></svg></div>'+
      '<div class="bp-reward-val mono">'+ ((typeof formatCoins === "function") ? formatCoins(reward.amount) : reward.amount) +' HEX</div>';
  } else if (reward.type === "skin"){
    const meta = (typeof skinMeta === "function") ? skinMeta(reward.skin) : null;
    const name = meta ? meta.name : reward.skin;
    const color = meta && meta.accent ? meta.accent : "#7c5cff";
    inner =
      '<div class="bp-reward-icon"><svg class="ic-svg lg" style="color:'+color+'"><use href="#i-skin"/></svg></div>'+
      '<div class="bp-reward-val">'+ name +'</div>';
  }
  const klass = "bp-cell" + (claimed ? " claimed" : "") + (claimable ? " claimable" : "");
  return '<div class="'+klass+'">'+ inner +'</div>';
}

function renderBattlePass(){
  ensureBattlePass();
  const panel = document.getElementById("bp-panel");
  if (!panel) return;
  const xp = state.battlepass.xp | 0;
  const tier = bpCurrentTier();
  const intoTier = bpProgressIntoTier();
  const totalXp = BP_TIERS_TOTAL * BP_XP_PER_TIER;
  const pct = Math.min(100, Math.round((xp / totalXp) * 100));
  const premium = !!state.battlepass.premium;
  const season = (typeof seasonName === "function") ? seasonName(state.battlepass.season) : state.battlepass.season;
  const fmt = (typeof formatCoins === "function") ? formatCoins : String;

  let html = '';
  html += '<div class="bp-head glass">';
  html += '  <div class="bp-head-top">';
  html += '    <div class="bp-title"><svg class="ic-svg lg"><use href="#i-star"/></svg><b>'+ (t("bp.title") || "Battle Pass") +'</b></div>';
  html += '    <div class="bp-season">'+ season +'</div>';
  html += '  </div>';
  html += '  <div class="bp-progress">';
  html += '    <div class="bp-progress-bar"><div class="bp-progress-fill" style="width:'+ pct +'%"></div></div>';
  html += '    <div class="bp-progress-lbl mono">'+ fmt(xp) +' / '+ fmt(totalXp) +' XP</div>';
  html += '  </div>';
  html += '  <div class="bp-foot">';
  html += '    <div class="bp-tier-lbl">'+ (t("bp.tier") || "Tier") +' <b>'+ tier +'</b> / '+ BP_TIERS_TOTAL +'</div>';
  if (!premium){
    html += '    <button class="btn btn-primary bp-buy" id="bp-buy">'+ (t("bp.buyPremium") || "Unlock Premium") +' · '+ fmt(BP_PREMIUM_PRICE) +' HEX</button>';
  } else {
    html += '    <div class="bp-prem-on"><svg class="ic-svg"><use href="#i-check"/></svg> '+ (t("bp.premiumOn") || "Premium active") +'</div>';
  }
  html += '  </div>';
  html += '</div>';

  html += '<div class="bp-track-head">';
  html += '  <div class="bp-track-cap" data-i18n="bp.free">Free</div>';
  html += '  <div class="bp-track-cap" data-i18n="bp.premium">Premium</div>';
  html += '</div>';
  html += '<div class="bp-track">';
  for (let i = 0; i < BP_TIERS_TOTAL; i++){
    const freeReward = BP_FREE_REWARDS[i];
    const premReward = BP_PREMIUM_REWARDS[i];
    const freeClaimed = state.battlepass.claimedFree.indexOf(i) >= 0;
    const premClaimed = state.battlepass.claimedPremium.indexOf(i) >= 0;
    const freeClaimable = !freeClaimed && i < tier;
    const premClaimable = !premClaimed && i < tier && premium;
    const rowKlass = (i < tier) ? "bp-row reached" : "bp-row";
    html += '<div class="'+ rowKlass +'" data-tier="'+ (i+1) +'">';
    html += '  <div class="bp-row-num">'+ (i+1) +'</div>';
    html +=    bpRewardCellHtml(freeReward, freeClaimed, freeClaimable);
    html +=    bpRewardCellHtml(premReward, premClaimed, premClaimable);
    html += '  <div class="bp-row-actions">';
    if (freeClaimable) html += '<button class="bp-claim" data-track="free" data-idx="'+ i +'">'+ (t("bp.claim") || "Claim") +'</button>';
    if (premClaimable) html += '<button class="bp-claim prem" data-track="premium" data-idx="'+ i +'">'+ (t("bp.claim") || "Claim") +'</button>';
    html += '  </div>';
    html += '</div>';
  }
  html += '</div>';

  panel.innerHTML = html;
  if (typeof applyI18n === "function") applyI18n();

  const buyBtn = document.getElementById("bp-buy");
  if (buyBtn) buyBtn.addEventListener("click", () => {
    if (bpBuyPremium()){
      renderBattlePass();
      if (typeof renderWallet === "function") renderWallet();
    }
  });
  panel.querySelectorAll(".bp-claim").forEach(btn => {
    btn.addEventListener("click", () => {
      const track = btn.dataset.track;
      const idx = parseInt(btn.dataset.idx, 10) || 0;
      if (bpClaim(track, idx)){
        renderBattlePass();
        if (typeof renderWallet === "function") renderWallet();
        if (typeof renderShop === "function") renderShop();
      }
    });
  });
}
