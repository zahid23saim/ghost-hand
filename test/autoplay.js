// Ghost Hand - in-page autoplayer for local testing. Paste into a tab (or inject) to
// let that tab play like a person, using real pointer events: it leads when it knows
// the letter and follows the visible pull of the others when it doesn't.
// window.__ghAuto.stop() ends it.
(() => {
  if (window.__ghAuto) window.__ghAuto.stop();
  const G = window.__gh;
  const cv = document.getElementById("cv");
  const pad = document.getElementById("pad");
  const phone = document.getElementById("app").dataset.device === "phone";
  let padDown = false, rested = false, timer = 0, followAng = null, reactAt = 0;
  const fire = (el, type, x, y, kind) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: kind === "mouse" ? 1 : 7, pointerType: kind, isPrimary: true, bubbles: true, button: 0, buttons: type === "pointerup" ? 0 : 1 }));

  function aim(s) {
    const T = G.TARGET_BY_KEY;
    const key = G.target || G.glow || (G.hint.step >= 2 ? G.hint.letter : null) || (G.phase === "goodbye" ? "BYE" : null);
    if (key && T[key]) {
      const t = T[key];
      const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy) || 1;
      return { ux: dx / d, uy: dy / d, d, lead: true };
    }
    let sx = 0, sy = 0;
    const me = G.you && G.you.seat;
    for (const h of s.hands) if (h.seat !== me && h.resting) { sx += h.ux * h.m; sy += h.uy * h.m; }
    if (Math.hypot(sx, sy) < 0.25) return null;
    const a = Math.atan2(sy, sx);
    const now = performance.now();
    const off = followAng === null ? 9 : Math.abs(Math.atan2(Math.sin(a - followAng), Math.cos(a - followAng)));
    if (off > 0.5) { if (!reactAt) reactAt = now + 450 + Math.random() * 350; if (now >= reactAt) { followAng = a; reactAt = 0; } }
    else followAng = a;
    if (followAng === null) return null;
    return { ux: Math.cos(followAng), uy: Math.sin(followAng), d: 999, lead: false };
  }

  function tick() {
    const ph = G.phase;
    if (ph === "pick" && G.pick) {
      const c = document.querySelector("#pickslots .card:not([disabled])");
      if (c) c.click();
    }
    const s = G.net && G.net.sample();
    if (!s || !["warmup", "spell", "lobby"].includes(ph)) return;
    const a = aim(s);
    if (phone) {
      const r = pad.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (!padDown) { fire(pad, "pointerdown", cx, cy, "touch"); padDown = true; }
      const k = !a ? 0 : a.lead && a.d < 40 ? 0 : 40;
      fire(pad, "pointermove", cx + (a ? a.ux * k : 0), cy + (a ? a.uy * k : 0), "touch");
    } else {
      const r = cv.getBoundingClientRect();
      if (!rested) {
        const [px, py] = G.view.toScreen(s.x, s.y + 60);
        fire(cv, "pointerdown", r.left + px, r.top + py, "mouse");
        fire(cv, "pointerup", r.left + px, r.top + py, "mouse");
        rested = true;
      }
      // Point 80 bu past the lens (full push), or right at the letter when leading close in.
      const reach = !a ? 0 : a.lead ? Math.min(80, a.d) : 80;
      const [px, py] = G.view.toScreen(s.x + (a ? a.ux * reach : 0), s.y + (a ? a.uy * reach : 0));
      fire(cv, "pointermove", r.left + px, r.top + py, "mouse");
    }
  }
  timer = setInterval(tick, 50);
  window.__ghAuto = { stop() { clearInterval(timer); if (padDown) { const r = pad.getBoundingClientRect(); fire(pad, "pointerup", r.left + r.width / 2, r.top + r.height / 2, "touch"); } window.__ghAuto = null; } };
  return "autoplay on (" + (phone ? "phone" : "laptop") + ")";
})();
