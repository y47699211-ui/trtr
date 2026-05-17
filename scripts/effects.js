/* ---------- Visual effects layer ----------
   Floating score popups and radial particle bursts rendered into
   #fx-layer. Each effect is self-cleaning (timed `remove()`). The
   layer is pointer-events: none, so it never interferes with input.
   All animations honor prefers-reduced-motion via CSS. */

(function(){
  function layer(){ return document.getElementById("fx-layer"); }

  /* Pop a label at viewport coordinates (x, y in CSS pixels). */
  function popup(text, x, y, kind){
    const root = layer();
    if(!root) return;
    const el = document.createElement("div");
    el.className = "fx-popup" + (kind ? " " + kind : "");
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.textContent = text;
    root.appendChild(el);
    setTimeout(()=> el.remove(), 1200);
  }

  /* Radial particle burst centered at (x, y).
     `colors` is an array of CSS colors; `count` controls density. */
  function burst(x, y, opts){
    const root = layer();
    if(!root) return;
    const {
      count   = 18,
      colors  = ["#7c5cff", "#24bdff", "#3ddc97", "#ffb454", "#f25c8e"],
      spread  = 110,
      size    = 9,
    } = opts || {};
    for(let i = 0; i < count; i++){
      const p = document.createElement("div");
      const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.6 - 0.3);
      const dist  = spread * (0.55 + Math.random() * 0.55);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      const rot = (Math.random() * 720 - 360) + "deg";
      const sz = size * (0.8 + Math.random() * 0.7);
      p.className = "fx-particle";
      p.style.left = x + "px";
      p.style.top  = y + "px";
      p.style.width  = sz + "px";
      p.style.height = sz + "px";
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--dx", dx + "px");
      p.style.setProperty("--dy", dy + "px");
      p.style.setProperty("--rot", rot);
      root.appendChild(p);
      setTimeout(()=> p.remove(), 1000);
    }
  }

  /* Full-screen flash, used for big moments (level up, mega combo). */
  function flash(){
    const root = layer();
    if(!root) return;
    const el = document.createElement("div");
    el.className = "fx-flash";
    root.appendChild(el);
    setTimeout(()=> el.remove(), 500);
  }

  /* Centered "LEVEL UP" celebration: flash + popup + burst + sound. */
  function celebrateLevelUp(level){
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = vw / 2, cy = vh * 0.42;
    flash();
    popup((window.t ? window.t("fx.lvlup") : "LEVEL UP") + " " + level, cx, cy, "score");
    burst(cx, cy, { count: 28, spread: 180, size: 11 });
    if(typeof sfx !== "undefined") sfx.lvlup();
    if(typeof vibrate === "function") vibrate([16, 30, 16]);
  }

  /* Combo flourish at the board center. */
  function celebrateCombo(n, anchorEl){
    let cx, cy;
    if(anchorEl){
      const r = anchorEl.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    } else {
      cx = window.innerWidth / 2;
      cy = window.innerHeight / 2;
    }
    popup((window.t ? window.t("fx.combo") : "COMBO") + " x" + n, cx, cy - 24, "combo");
    burst(cx, cy, { count: 14 + Math.min(20, n * 2), spread: 90 + n * 8, size: 8 });
    if(typeof sfx !== "undefined") sfx.combo(n);
  }

  /* "+12" style score popup, anchored to a viewport coord. */
  function scorePop(amount, x, y){
    popup("+" + amount, x, y, "score");
  }

  /* "Line cleared" small burst at a row's midpoint. */
  function linePop(x, y, count){
    popup(count > 1 ? (count + "×") : "", x, y, "combo");
    burst(x, y, { count: 10 + count * 4, spread: 70, size: 7 });
  }

  window.fx = { popup, burst, flash, scorePop, linePop, celebrateLevelUp, celebrateCombo };
})();
