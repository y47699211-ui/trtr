/* ---------- Util ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
function genId(){
  return "HX-" + Math.random().toString(36).slice(2,7).toUpperCase()
       + "-" + Math.random().toString(36).slice(2,7).toUpperCase();
}
function todayKey(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function fmtTime(ms){
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if(h>0) return h+"h "+m+"m";
  if(m>0) return m+"m "+sec+"s";
  return sec+"s";
}
function clamp(n,a,b){return Math.max(a,Math.min(b,n))}

/* ---------- Network helper ----------
   Shared `fetch` wrapper used by the leaderboard, tournaments and
   marketplace modules. Centralising the timeout/retry policy here
   means a flaky carrier no longer makes one device say "no internet"
   while another sees the live data — the request retries with
   exponential backoff before we give up, and the timeout is generous
   enough to ride out slow LTE / captive-portal handshakes.

   Behaviour:
     * Bigger default timeout (15s vs the previous 8s).
     * Up to 2 retries for transient errors (abort, network error,
       5xx) with 600ms + jitter backoff between attempts.
     * 404 maps to `{ __empty: true }` so callers can distinguish
       "no data yet" from "offline".
     * The returned promise rejects with the LAST observed error so
       callers can still log it for diagnostics. */
const NET_DEFAULT_TIMEOUT_MS = 15_000;
const NET_DEFAULT_RETRIES    = 2;
const NET_BACKOFF_MS         = 600;

function _isRetryableError(e){
  if (!e) return false;
  if (e.name === "AbortError") return true;
  if (e.name === "TypeError")  return true; // network error in fetch()
  const msg = String(e.message || e);
  if (/HTTP 5\d\d/.test(msg))  return true;
  if (/HTTP 429/.test(msg))    return true;
  return false;
}

async function netFetchJSON(url, init){
  const opts        = init || {};
  const timeout     = Number(opts.timeoutMs)  > 0 ? Number(opts.timeoutMs) : NET_DEFAULT_TIMEOUT_MS;
  const maxRetries  = Number.isFinite(opts.retries) ? Math.max(0, opts.retries|0) : NET_DEFAULT_RETRIES;
  const passInit    = Object.assign({ cache: "no-store" }, opts);
  /* strip our private fields before handing to fetch */
  delete passInit.timeoutMs;
  delete passInit.retries;
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++){
    const ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const tm   = setTimeout(() => { try { ctrl && ctrl.abort(); } catch {} }, timeout);
    try {
      const res = await fetch(url, Object.assign({}, passInit, ctrl ? { signal: ctrl.signal } : {}));
      clearTimeout(tm);
      /* 404 = empty bin (JSONBlob behaviour). Not an offline error. */
      if (res.status === 404) return { __empty: true };
      if (res.status >= 500 || res.status === 429){
        const err = new Error("HTTP " + res.status);
        if (attempt < maxRetries){
          lastErr = err;
          await new Promise(r => setTimeout(r, NET_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 200));
          continue;
        }
        throw err;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      /* Some PUT responses are empty — guard the json() parse. */
      const ct = res.headers && res.headers.get ? (res.headers.get("Content-Type") || "") : "";
      if (ct.indexOf("application/json") < 0){
        try { return await res.json(); } catch { return {}; }
      }
      return await res.json();
    } catch (e){
      clearTimeout(tm);
      lastErr = e;
      if (attempt < maxRetries && _isRetryableError(e)){
        await new Promise(r => setTimeout(r, NET_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 200));
        continue;
      }
      break;
    }
  }
  throw lastErr || new Error("network error");
}

/* deterministic RNG */
function mulberry32(seed){
  return function(){
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashStr(s){
  let h = 2166136261 >>> 0;
  for(let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ---------- Audio engine ----------
   A tiny synth on top of WebAudio. We keep a single shared
   AudioContext (created lazily on first user gesture), then
   build short envelope-shaped tones. `beep()` keeps its legacy
   shape so existing call sites keep working; `tone()` is the
   richer primitive used by `sfx.*` presets. */
let audioCtx = null;
let masterGain = null;
function ensureAudio(){
  if(audioCtx) return;
  try{
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    /* Lowered from 0.85 -> 0.55 so every sfx feels softer at the same
       relative oscillator gains. Players can still mute via settings. */
    masterGain.gain.value = 0.55;
    masterGain.connect(audioCtx.destination);
  }catch{}
}
/* Resume context on first interaction — required by Chrome/Safari
   autoplay policies. Bound once via main.js. */
function resumeAudio(){
  ensureAudio();
  if(audioCtx && audioCtx.state === "suspended"){
    audioCtx.resume().catch(()=>{});
  }
}
/* Shape: { freq, dur, type, attack, release, gain, detune, slide } */
function tone(opts){
  if(!state.settings.sound) return;
  ensureAudio();
  if(!audioCtx) return;
  const {
    freq = 440,
    dur  = 120,
    type = "sine",
    attack  = 0.005,
    release = 0.08,
    gain    = 0.08,
    detune  = 0,
    slide   = null,           // [startFreq, endFreq] for a pitch glide
  } = opts || {};
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.detune.value = detune;
  if(slide){
    o.frequency.setValueAtTime(slide[0], audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, slide[1]), audioCtx.currentTime + dur/1000);
  } else {
    o.frequency.value = freq;
  }
  o.connect(g); g.connect(masterGain || audioCtx.destination);
  const now = audioCtx.currentTime;
  const peak = Math.max(0.0005, gain);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0002, now + dur/1000 + release);
  o.start(now);
  o.stop(now + dur/1000 + release + 0.05);
}
/* Backwards-compatible: simple sine tone. */
function beep(freq, dur, type){
  tone({ freq, dur, type: type || "sine", gain: 0.06 });
}
/* Curated effect presets (frequencies in Hz, dur in ms). Tuned to be
   soft & pleasant — sines + triangles, low gains, short releases. */
const sfx = {
  click()   { tone({ freq: 660, dur: 45,  type: "sine",     gain: 0.04, release: 0.06 }); },
  hover()   { tone({ freq: 880, dur: 28,  type: "sine",     gain: 0.018, release: 0.05 }); },
  place()   {
    tone({ freq: 480, dur: 55, type: "sine",     gain: 0.045, release: 0.09 });
    tone({ freq: 720, dur: 55, type: "triangle", gain: 0.025, detune: 4, release: 0.09 });
  },
  invalid() {
    tone({ freq: 220, dur: 100, type: "triangle", gain: 0.035, slide: [220, 160] });
  },
  clear()   {
    tone({ freq: 620, dur: 110, type: "sine",     gain: 0.055 });
    tone({ freq: 930, dur: 140, type: "triangle", gain: 0.035, detune: 5 });
  },
  combo(n)  {
    const base = 500 + Math.min(8, n) * 50;
    tone({ freq: base,        dur: 80,  type: "sine",     gain: 0.05 });
    tone({ freq: base * 1.25, dur: 110, type: "sine",     gain: 0.035 });
    tone({ freq: base * 1.5,  dur: 130, type: "triangle", gain: 0.025 });
  },
  lvlup()   {
    // Major triad arpeggio sweeping upward (softer triangles).
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      setTimeout(()=> tone({ freq: f, dur: 150, type: "triangle", gain: 0.05, release: 0.12 }), i * 70);
    });
  },
  gameover(){
    [440, 392, 349.23, 293.66].forEach((f, i) => {
      setTimeout(()=> tone({ freq: f, dur: 200, type: "sine", gain: 0.045 }), i * 100);
    });
  },
  toast()       { tone({ freq: 820, dur: 45, type: "sine", gain: 0.03 }); },
  modalOpen()   { tone({ freq: 480, dur: 75, type: "sine", gain: 0.032, slide: [380, 540] }); },
  modalClose()  { tone({ freq: 380, dur: 65, type: "sine", gain: 0.028, slide: [540, 380] }); },
  /* Wallet & shop sounds — chime-style, deliberately gentle. */
  coinUp()    {
    tone({ freq: 880, dur: 70, type: "sine",     gain: 0.045 });
    setTimeout(()=> tone({ freq: 1318, dur: 90, type: "sine", gain: 0.03 }), 45);
  },
  coinSpend() {
    tone({ freq: 660, dur: 60, type: "sine",     gain: 0.035 });
    setTimeout(()=> tone({ freq: 520, dur: 80, type: "sine", gain: 0.025 }), 40);
  },
  coinJackpot(){
    // Daily-reward fanfare: ascending pentatonic over ~600ms.
    [523, 659, 784, 988, 1175].forEach((f, i) => {
      setTimeout(()=> tone({ freq: f, dur: 130, type: "triangle", gain: 0.04 }), i * 90);
    });
  },
  shopOpen()  { tone({ freq: 540, dur: 85, type: "sine", gain: 0.035, slide: [380, 620] }); },
  shopEquip() {
    tone({ freq: 740, dur: 90, type: "sine", gain: 0.04 });
    setTimeout(()=> tone({ freq: 988, dur: 110, type: "triangle", gain: 0.03 }), 60);
  },
};
function vibrate(p){ if(state.settings.vibration && navigator.vibrate) navigator.vibrate(p); }

/* ---------- HTML escape ----------
   Strict entity escape for any user-controlled string we have to
   concatenate into innerHTML. Use it on every field that comes
   from the network (leaderboard, tournaments, marketplace) or
   from saves that might have been hand-edited. */
function escapeHtml(s){
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- Toast ---------- */
function toast(msg, kind){
  const stack = $("#toast-stack");
  const el = document.createElement("div");
  el.className = "toast " + (kind || "info");
  el.innerHTML = '<svg class="ic-svg"><use href="#i-'+(kind==="success"?"check":"bolt")+'"/></svg><span></span>';
  el.querySelector("span").textContent = msg;
  stack.appendChild(el);
  setTimeout(()=>{ el.style.transition="opacity .25s, transform .25s"; el.style.opacity="0"; el.style.transform="translateY(8px)"; }, 1800);
  setTimeout(()=> el.remove(), 2200);
}

