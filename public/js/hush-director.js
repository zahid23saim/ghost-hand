// Ghost Hand - the Hush director: how the board's Hush moves and emotes.
// app.js still decides WHERE Hush belongs (peeking over the board's top edge, or big for
// the question); this decides HOW it gets there and how it reacts along the way.
// Web Animations on transform and opacity only. A newer call always wins: whatever was
// running is cancelled from where it stands, so Hush is never left hidden or half-turned.
//
// Layers it animates:
//   spot          (#hushspot)        travel: fly, glide, the size change between modes
//   instance el   (.hush)            horizontal shifts, mirroring, scale (pivot at the base)
//   instance svg  (.hush-svg)        vertical bobs and tilts, inside the peek clip, so the
//                                    cut along the board's edge always stays level
//   eyes          (.hush-eye)        a quick widen on a breakaway or a startle

const FLY_MS = 950;            // the swoop in for the question
const SWAP_MS = 240;           // cross-fade when the peeking and full-body Hush trade places
const GOODBYE_BACK_MS = 2800;  // hush.js waves for 1.2 s and fades; Hush is back ~1.6 s later
const DOZE_AFTER_MS = 20000;   // still hands for this long and Hush nods off

const EASE_SOFT = "cubic-bezier(.45, 0, .25, 1)";
const EASE_OUT = "cubic-bezier(.2, .8, .3, 1)";
const EASE_GLIDE = "cubic-bezier(.3, 1.16, .5, 1)";
const SIDE_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

// ------------------------------------------------------------ styles

// Each colour is given twice: a plain rgba fallback, then the Midnight token via color-mix.
const mint = (a) => `rgba(94, 242, 208, ${a})`;
const mintTok = (a) => `color-mix(in srgb, var(--mint, #5EF2D0) ${Math.round(a * 100)}%, transparent)`;
const cream = (a) => `rgba(243, 233, 210, ${a})`;
const creamTok = (a) => `color-mix(in srgb, var(--cream, #F3E9D2) ${Math.round(a * 100)}%, transparent)`;
const white = (a) => `rgba(255, 255, 255, ${a})`;
const puffBg = (c) => `radial-gradient(circle at 36% 58%, ${c(0.96)} 0 24%, ${c(0)} 25.5%),
    radial-gradient(circle at 60% 42%, ${c(0.96)} 0 28%, ${c(0)} 29.5%),
    radial-gradient(circle at 68% 66%, ${c(0.9)} 0 19%, ${c(0)} 20.5%)`;

const CSS = `
.ghd-spot { line-height: 0; transition: none !important; will-change: transform; }
.ghd-fx { position: absolute; pointer-events: none; border-radius: 50%; will-change: transform, opacity; }
.ghd-wisp { z-index: 3; border-radius: 50% 50% 44% 44%;
  background: radial-gradient(closest-side, ${mint(0.85)}, ${mint(0.3)} 55%, ${mint(0)});
  background: radial-gradient(closest-side, ${mintTok(0.85)}, ${mintTok(0.3)} 55%, ${mintTok(0)}); }
.ghd-mote { z-index: 5;
  background: radial-gradient(closest-side, ${cream(1)} 0 38%, ${mint(0.75)} 52%, ${mint(0)});
  background: radial-gradient(closest-side, ${creamTok(1)} 0 38%, ${mintTok(0.75)} 52%, ${mintTok(0)}); }
.ghd-puff { z-index: 5;
  background: ${puffBg(white)}, radial-gradient(closest-side, ${mint(0.6)}, ${mint(0.18)} 70%, ${mint(0)});
  background: ${puffBg(white)}, radial-gradient(closest-side, ${mintTok(0.6)}, ${mintTok(0.18)} 70%, ${mintTok(0)}); }
`;

function injectStyles() {
  if (document.getElementById("gh-hush-director")) return;
  const style = document.createElement("style");
  style.id = "gh-hush-director";
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ------------------------------------------------------------ helpers

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const near = (a, b) => Math.abs(a - b) < 0.5;
const px = (v) => `${(Math.round(v * 10) / 10) || 0}px`;
const lift = (y, deg = 0) => `translateY(${px(y)}) rotate(${deg}deg)`;

function currentMatrix(el) {
  try {
    const t = getComputedStyle(el).transform;
    return t && t !== "none" ? new DOMMatrixReadOnly(t) : null;
  } catch { return null; }
}

const bez = (p0, p1, p2, p3, u) => {
  const v = 1 - u;
  return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3;
};

// The swoop, as offsets from the landing spot: a dive down one side of the screen, a sweep
// under the spot, an overshoot past it, then a small damped settle. Sampled densely so the
// linear keyframes read as one smooth curve; Hush leans into its sideways speed.
function flyPath(W, D, s, n = 30) {
  const side = W >= 0 ? 1 : -1;
  const P = [[W, D], [W * 0.95, D * 0.1], [W * 0.3, s * 0.62], [-side * s * 0.16, s * 0.07]];
  const SPLIT = 0.68;
  const at = (t) => {
    if (t <= SPLIT) {
      const q = t / SPLIT;
      const u = q < 0.5 ? 2 * q * q : 1 - (2 - 2 * q) ** 2 / 2;
      return {
        x: bez(P[0][0], P[1][0], P[2][0], P[3][0], u),
        y: bez(P[0][1], P[1][1], P[2][1], P[3][1], u),
        k: 0.6 + 0.46 * (1 - (1 - u) ** 2),
      };
    }
    const v = (t - SPLIT) / (1 - SPLIT);
    const f = (1 - v) ** 2 * (1 + 2 * v) * Math.cos(v * Math.PI * 1.25);
    return { x: P[3][0] * f, y: P[3][1] * f, k: 1 + 0.06 * f };
  };
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push({ t: i / n, ...at(i / n) });
  let vmax = 1e-6;
  const vx = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
    const v = (b.x - a.x) / (b.t - a.t);
    vmax = Math.max(vmax, Math.abs(v));
    return v;
  });
  pts.forEach((p, i) => { p.r = (16 * vx[i]) / vmax; });
  pts[n] = { t: 1, x: 0, y: 0, k: 1, r: 0 };
  return pts;
}

// ------------------------------------------------------------ the director

export class HushDirector {
  static FLY_MS = FLY_MS;
  static DOZE_AFTER_MS = DOZE_AFTER_MS;

  constructor({ spot, peek, big, reduced } = {}) {
    if (!spot) throw new Error("HushDirector: needs the #hushspot element");
    injectStyles();
    this.spot = spot;
    this.peek = peek || null;
    this.big = big || null;
    this.layer = spot.parentElement || document.body;
    let pref = false;
    try { pref = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch {}
    this._reduced = reduced == null ? pref : !!reduced;
    this.mode = "peek";
    this.left = 0;
    this.top = 0;
    this.size = 0;
    this.dozing = false;
    this._placed = false;
    this._token = 0;          // bumps on every emote call; stale timers do nothing
    this._moveToken = 0;
    this._moveAnim = null;
    this._moveKind = "";
    this._moveResolve = null;
    this._movePromise = null;
    this._trail = [];
    this._swap = null;
    this._emotes = new Map(); // element -> its transform Animation
    this._fx = new Set();
    this._timers = new Set();
    this._flySide = -1;
    this._idleSince = 0;

    spot.classList.add("ghd-spot");
    spot.style.transition = "none"; // app.css glides left/top; travel is ours now
    // Pivots: the peeking Hush turns and scales about the board's edge; tilts and bobs
    // pivot low in the body, like the pose transforms in hush.js.
    for (const h of [this.peek, this.big]) {
      if (!h?.el) continue;
      h.el.style.transformOrigin = h === this.peek ? "50% 100%" : "50% 88%";
      const svg = h.el.querySelector(".hush-svg");
      if (svg) svg.style.transformOrigin = "50% 88%";
    }
    this._showOnly(this.active);
  }

  get active() { return this.mode === "big" ? this.big || this.peek : this.peek || this.big; }

  get reduced() { return this._reduced; }
  set reduced(v) {
    this._reduced = !!v;
    if (!this._reduced) return;
    this._stopMove();
    for (const a of this._emotes.values()) a.cancel();
    this._emotes.clear();
  }

  // ---------------------------------------------------------- travel

  // target = { left, top, size } in stage CSS px (top-left of #hushspot, Hush's box size).
  // Resolves true when Hush arrives, false if a newer move took over.
  moveTo(target, { mode, how = "glide" } = {}) {
    if (!target) return Promise.resolve(false);
    const left = Number(target.left), top = Number(target.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return Promise.resolve(false);
    const size = Math.max(8, Math.round(Number(target.size) || this.size || 72));
    mode = mode === "big" || mode === "peek" ? mode : this.mode;
    const first = !this._placed;
    const modeChanged = mode !== this.mode;
    const same = !first && !modeChanged && near(left, this.left) && near(top, this.top) && size === this.size;
    if (same && how !== "fly") return this._movePromise || Promise.resolve(true);

    // A relayout mid-swoop: the swoop's offsets are relative, so it simply lands on the new spot.
    if (!first && !modeChanged && how !== "fly" && this._moveAnim && this._moveKind === "fly") {
      this._setBox(left, top, size);
      this.active?.setSize(size);
      return this._movePromise;
    }

    const from = first ? null : this._visual();
    const prev = this.active;
    const wasVisible = !first && this._isVisible(prev);
    this._stopMove();
    this.mode = mode;
    const inst = this.active;
    this._setBox(left, top, size);
    if (inst) inst.setSize(size);
    if (prev && prev !== inst) this._cancelEmotes(prev);
    this._showOnly(inst);
    this._placed = true;
    if (modeChanged && this.dozing) this._holdDoze(true);
    if (how === "instant" || !inst || !this.spot.animate) return Promise.resolve(true);

    let anim = null;
    if (this._reduced) {
      // No arcs and no travel: Hush simply appears where it belongs.
      if (how !== "fly" && !modeChanged) return Promise.resolve(true);
      anim = inst.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
      this._moveKind = "fade";
    } else if (how === "fly") {
      if (from && wasVisible) this._poof(from.ax, from.ay, from.size);
      anim = this._fly(size);
      this._moveKind = "fly";
    } else {
      if (!from) return Promise.resolve(true);
      const dx = from.ax - (left + size / 2), dy = from.ay - (top + size / 2), k = from.size / size;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(k - 1) < 0.01) return Promise.resolve(true);
      if (modeChanged && prev && prev !== inst) this._crossfade(prev, inst, size);
      const dur = clamp(360 + Math.hypot(dx, dy) * 0.9 + Math.abs(k - 1) * 160, 360, 860);
      anim = this.spot.animate([
        { transform: `translate(${px(dx)}, ${px(dy)}) scale(${k.toFixed(4)})` },
        { transform: "translate(0px, 0px) scale(1)" },
      ], { duration: dur, easing: EASE_GLIDE });
      this._moveKind = "glide";
    }
    this._moveToken += 1;
    this._moveAnim = anim;
    this._movePromise = new Promise((resolve) => {
      this._moveResolve = resolve;
      anim.onfinish = () => {
        if (this._moveAnim !== anim) return;
        this._moveAnim = null;
        this._moveKind = "";
        this._moveResolve = null;
        this._movePromise = null;
        resolve(true);
      };
    });
    return this._movePromise;
  }

  // Arrive: swoop in from above the screen to the big spot, bounce, look curious.
  flyIn(target) {
    const token = this._begin();
    this._face("idle");
    const moved = this.moveTo(target, { mode: "big", how: "fly" });
    const moveToken = this._moveToken;
    return moved.then(() => {
      if (token !== this._token || moveToken !== this._moveToken) return false;
      const inst = this.active;
      this._face("curious");
      this._emote(inst?.el, [
        { offset: 0.3, transform: "scale(1.1, 0.9)", easing: EASE_SOFT },
        { offset: 0.65, transform: "scale(0.96, 1.05)", easing: EASE_SOFT },
        { offset: 1, transform: "scale(1, 1)" },
      ], { duration: 420, lead: "ease-out" });
      return true;
    });
  }

  // Drift back up to the peek spot over the board's top edge.
  settle(target) {
    return this.moveTo(target, { mode: "peek", how: "glide" });
  }

  // ---------------------------------------------------------- moments

  // Plain expression change (what app.js's expr() should call), with an optional return
  // to idle after `back` ms if nothing newer happened.
  express(name, { back = 0 } = {}) {
    this._begin();
    const p = this._face(name);
    if (back > 0) this._backToIdle(name, back);
    return p;
  }

  // Lean toward the knower. toMe: lean in close with a cupped-mitten "psst".
  // Otherwise turn and tilt toward side ('left' | 'right' | 'up') for about 1.2 s.
  whisper({ toMe = false, side = "right" } = {}) {
    this._begin();
    const inst = this.active;
    if (!inst) return;
    this._face("whisper");
    const s = this.size, svg = this._svg(inst);
    if (toMe) {
      const close = "scale(1.22)";
      this._emote(inst.el, [
        { offset: 0.22, transform: close, easing: "linear" },
        { offset: 0.78, transform: close, easing: EASE_SOFT },
        { offset: 1, transform: "scale(1)" },
      ], { duration: 1500 });
      this._emote(svg, [
        { offset: 0.22, transform: lift(-0.04 * s), easing: "linear" },
        { offset: 0.78, transform: lift(-0.04 * s), easing: EASE_SOFT },
        { offset: 1, transform: lift(0) },
      ], { duration: 1500 });
      this._backToIdle("whisper", 1500);
      return;
    }
    const dir = side === "left" ? -1 : side === "up" ? 0 : 1;
    // Mirroring the whole Hush turns it (cupped mitten and psst dots included) to face left.
    const turned = `translateX(${px(dir * 0.08 * s)}) scaleX(${dir < 0 ? -1 : 1})`;
    const tilt = dir === 0 ? lift(-0.1 * s) : lift(0, 12); // when mirrored, +12deg tilts left
    this._emote(inst.el, [
      { offset: 0.2, transform: turned, easing: "linear" },
      { offset: 0.75, transform: turned, easing: EASE_SOFT },
      { offset: 1, transform: "translateX(0px) scaleX(1)" },
    ], { duration: 1200 });
    this._emote(svg, [
      { offset: 0.2, transform: tilt, easing: "linear" },
      { offset: 0.75, transform: tilt, easing: EASE_SOFT },
      { offset: 1, transform: lift(0) },
    ], { duration: 1200 });
    this._backToIdle("whisper", 1200);
  }

  // Nod off (sleepy face, "z z", a slow sink) or wake with a tiny startled hop.
  doze(on) {
    on = !!on;
    if (on === this.dozing) return;
    this._token += 1;
    const inst = this.active;
    if (on) {
      this.dozing = true;
      this._face("sleepy");
      this._holdDoze(false);
      return;
    }
    this.dozing = false;
    if (this._idleSince) this._idleSince = performance.now();
    if (!inst) return;
    const s = this.size;
    this._face("curious");
    this._emote(this._svg(inst), [
      { offset: 0.35, transform: lift(-0.14 * s), easing: EASE_SOFT },
      { offset: 0.7, transform: lift(0.02 * s), easing: EASE_SOFT },
      { offset: 1, transform: lift(0) },
    ], { duration: 460, lead: EASE_OUT });
    this._emote(inst.el, [
      { offset: 0.35, transform: "scale(0.96, 1.06)", easing: EASE_SOFT },
      { offset: 0.7, transform: "scale(1.05, 0.95)", easing: EASE_SOFT },
      { offset: 1, transform: "scale(1, 1)" },
    ], { duration: 460 });
    this._eyes(inst, 520);
    this._backToIdle("curious", 560);
  }

  // Run once per frame from app.js. active: the phase can doze (spell, warmup).
  // pushing: any human hand is pushing. 20 s of stillness dozes; any push wakes.
  tickIdle(now, { active = false, pushing = false } = {}) {
    if (!active || pushing) {
      this._idleSince = 0;
      if (this.dozing) this.doze(false);
      return;
    }
    if (!this._idleSince) { this._idleSince = now; return; }
    if (!this.dozing && now - this._idleSince >= DOZE_AFTER_MS) this.doze(true);
  }

  cheer() {
    this._begin();
    const inst = this.active;
    if (!inst) return;
    this._face("delighted"); // hush.js spins, hops and returns to idle by itself
    this._pop(inst, 1.12);
  }

  puzzle() {
    this._begin();
    const inst = this.active;
    if (!inst) return;
    this._face("puzzled");
    this._emote(this._svg(inst), [
      { offset: 0.2, transform: lift(0, -7), easing: EASE_SOFT },
      { offset: 0.45, transform: lift(0, 5), easing: EASE_SOFT },
      { offset: 0.7, transform: lift(0, -3), easing: EASE_SOFT },
      { offset: 1, transform: lift(0, 0) },
    ], { duration: 1000 });
    this._backToIdle("puzzled", 1300);
  }

  // Hint step 3: a puffed "shh", then a breath of mist toward `toward`:
  // a stage point { x, y } (e.g. view.toScreen of the planchette), an angle in radians,
  // or 'left' | 'right' | 'up' | 'down' (the default).
  blow(toward) {
    this._begin();
    const inst = this.active;
    if (!inst) return;
    this._face("shh");
    const s = this.size;
    const mx = this.left + s / 2, my = this.top + s * 0.47;
    let ang = SIDE_ANGLE.down;
    if (typeof toward === "number" && Number.isFinite(toward)) ang = toward;
    else if (typeof toward === "string" && toward in SIDE_ANGLE) ang = SIDE_ANGLE[toward];
    else if (toward && Number.isFinite(toward.x) && Number.isFinite(toward.y)) ang = Math.atan2(toward.y - my, toward.x - mx);
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const puffed = "translateX(0px) scale(1.08, 1.04)";
    this._emote(inst.el, [
      { offset: 0.38, transform: puffed, easing: "linear" },
      { offset: 0.48, transform: puffed, easing: EASE_OUT },
      { offset: 0.56, transform: `translateX(${px(-ux * 0.05 * s)}) scale(0.95, 0.98)`, easing: EASE_SOFT },
      { offset: 1, transform: "translateX(0px) scale(1, 1)" },
    ], { duration: 1100 });
    this._emote(this._svg(inst), [
      { offset: 0.48, transform: lift(0), easing: EASE_OUT },
      { offset: 0.58, transform: lift(-uy * 0.04 * s), easing: EASE_SOFT },
      { offset: 1, transform: lift(0) },
    ], { duration: 1100 });
    const token = this._token;
    this._later(520, () => { if (token === this._token) this._puffs(mx, my, ux, uy, s); });
    this._backToIdle("shh", 1500);
  }

  // Wave, fade to motes (hush.js 'goodbye'), drift up a little, then come back ~1.6 s later.
  // Resolves true when Hush is back (false if something newer brought it back first).
  goodbye() {
    this._begin();
    const inst = this.active;
    const s = this.size;
    this._face("goodbye");
    // One finite drift (nothing held): up while the motes rise, a hop down while the body
    // is fully faded, then a rise back into view as hush.js fades it in again.
    const total = GOODBYE_BACK_MS + 450;
    const o = (ms) => ms / total;
    this._emote(this._svg(inst), [
      { offset: o(1200), transform: lift(0), easing: "ease-in" },
      { offset: o(2600), transform: lift(-0.12 * s), easing: "linear" },
      { offset: o(GOODBYE_BACK_MS), transform: lift(0.06 * s), easing: EASE_OUT },
      { offset: 1, transform: lift(0) },
    ], { duration: total, lead: "linear" });
    // hush.js's motes are one-shot CSS animations on elements that sat hidden since load;
    // Chrome can have run them out already, so restart them the moment they show.
    const token = this._token;
    this._later(1230, () => {
      if (token !== this._token || inst?.el.dataset.fx !== "motes") return;
      for (const m of inst.el.querySelectorAll(".hush-mote")) {
        for (const a of m.getAnimations()) { try { a.currentTime = 0; a.play(); } catch {} }
      }
    });
    return new Promise((resolve) => {
      // Not token-guarded: whatever else happened, Hush must not stay faded out.
      this._later(GOODBYE_BACK_MS, () => {
        let back = false;
        for (const h of [this.peek, this.big]) {
          if (h?.el.dataset.expr !== "goodbye") continue;
          try { h.setExpression("idle"); back = true; } catch {}
        }
        resolve(back);
      });
    });
  }

  // 'breakaway': eyes widen, a little jolt, curious for 600 ms.
  // 'foresight': delighted, a pop and a few rising motes.
  react(kind) {
    if (kind !== "breakaway" && kind !== "foresight") return;
    this._begin();
    const inst = this.active;
    if (!inst) return;
    if (kind === "breakaway") {
      this._face("curious");
      this._emote(this._svg(inst), [
        { offset: 0.3, transform: lift(-0.08 * this.size), easing: EASE_SOFT },
        { offset: 1, transform: lift(0) },
      ], { duration: 380, lead: EASE_OUT });
      this._pop(inst, 1.06, 380);
      this._eyes(inst, 600);
      this._backToIdle("curious", 600);
    } else if (kind === "foresight") {
      this._face("delighted");
      this._pop(inst, 1.12);
      this._sparkle();
    }
  }

  destroy() {
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    this._stopMove();
    for (const a of this._emotes.values()) a.cancel();
    this._emotes.clear();
    for (const el of this._fx) el.remove();
    this._fx.clear();
    this.spot.classList.remove("ghd-spot");
    this.spot.style.transition = "";
  }

  // ---------------------------------------------------------- internals: state

  // Every emote call starts here: newer wins, and it gently wakes a dozing Hush.
  _begin() {
    this._token += 1;
    if (this.dozing) {
      this.dozing = false;
      const inst = this.active;
      this._relax(this._svg(inst));
      this._relax(inst?.el);
    }
    if (this._idleSince) this._idleSince = performance.now();
    return this._token;
  }

  _face(name) {
    let p = Promise.resolve();
    for (const h of [this.peek, this.big]) {
      if (!h) continue;
      try {
        const r = h.setExpression(name);
        if (h === this.active) p = r;
      } catch {}
    }
    return p;
  }

  _backToIdle(name, ms) {
    const token = this._token;
    this._later(ms, () => {
      if (token === this._token && this.active?.el.dataset.expr === name) this._face("idle");
    });
  }

  _later(ms, fn) {
    const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms);
    this._timers.add(t);
  }

  _setBox(left, top, size) {
    this.left = left;
    this.top = top;
    this.size = size;
    const st = this.spot.style;
    st.left = `${left}px`;
    st.top = `${top}px`;
    st.width = `${size}px`;
    st.transformOrigin = `50% ${size / 2}px`; // Hush's middle, in both modes
  }

  _showOnly(inst) {
    for (const h of [this.peek, this.big]) if (h?.el) h.el.style.display = h === inst ? "" : "none";
  }

  _isVisible(inst) {
    return !!inst?.el && inst.el.style.display !== "none" && !inst.el.classList.contains("hush-gone");
  }

  _svg(inst) { return inst?.el ? inst.el.querySelector(".hush-svg") || inst.el : null; }

  // Where Hush's middle is drawn right now (mid-flight included) and how big it looks.
  _visual() {
    const s = this.size;
    let ax = this.left + s / 2, ay = this.top + s / 2, k = 1;
    const m = this._moveAnim ? currentMatrix(this.spot) : null;
    if (m) { ax += m.e; ay += m.f; k = Math.hypot(m.a, m.b) || 1; }
    return { ax, ay, size: s * k };
  }

  _stopMove() {
    const a = this._moveAnim;
    this._moveAnim = null;
    this._moveKind = "";
    if (a) { a.onfinish = null; a.cancel(); }
    const r = this._moveResolve;
    this._moveResolve = null;
    this._movePromise = null;
    if (r) r(false);
    for (const t of this._trail) t?.cancel();
    this._trail = [];
    this._endSwap();
  }

  // The outgoing Hush fades out on top of the incoming one; both ride the spot's glide.
  _crossfade(oldInst, newInst, size) {
    this._endSwap();
    if (!oldInst.el.animate) return;
    oldInst.setSize(size);
    Object.assign(oldInst.el.style, { position: "absolute", left: "0px", top: "0px", display: "" });
    // The newcomer is solid before the old one has gone, so Hush never looks see-through.
    const out = oldInst.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWAP_MS, easing: "ease-in", fill: "forwards" });
    const inn = newInst.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SWAP_MS / 2, easing: "ease-out" });
    const swap = { oldInst, out, inn };
    this._swap = swap;
    out.onfinish = () => { if (this._swap === swap) this._endSwap(); };
  }

  _endSwap() {
    const sw = this._swap;
    if (!sw) return;
    this._swap = null;
    sw.out.onfinish = null;
    sw.out.cancel();
    sw.inn.cancel();
    Object.assign(sw.oldInst.el.style, { position: "", left: "", top: "" });
    if (sw.oldInst !== this.active) sw.oldInst.el.style.display = "none";
  }

  // ---------------------------------------------------------- internals: animation

  // A transform animation that starts from wherever el stands now, replacing el's last one.
  _emote(el, frames, { duration = 600, fill = "none", lead = EASE_SOFT } = {}) {
    if (!el) return null;
    const prev = this._emotes.get(el);
    let start = "none";
    if (prev) {
      const m = currentMatrix(el);
      // A mirrored mid-turn matrix would interpolate as a spin, so that one snaps instead.
      if (m && !m.isIdentity && m.a * m.d - m.b * m.c > 0) start = m.toString();
      prev.cancel();
      this._emotes.delete(el);
    }
    if (!frames || this._reduced || !el.animate) return null;
    const anim = el.animate([{ offset: 0, transform: start, easing: lead }, ...frames], { duration, easing: "linear", fill });
    this._emotes.set(el, anim);
    if (fill === "none") anim.addEventListener("finish", () => { if (this._emotes.get(el) === anim) this._emotes.delete(el); });
    return anim;
  }

  // Ease el back to rest from wherever it is (used when something interrupts a doze).
  _relax(el, ms = 220) {
    if (el && this._emotes.has(el)) this._emote(el, [{ offset: 1, transform: "none" }], { duration: ms });
  }

  _cancelEmotes(inst) {
    for (const [el, a] of this._emotes) {
      if (!inst.el.contains(el)) continue;
      a.cancel();
      this._emotes.delete(el);
    }
  }

  // Sleepy slump: the body sinks a touch behind the edge and droops. Held while dozing.
  _holdDoze(instant) {
    const inst = this.active;
    if (!inst) return;
    // Peeking, hush.js's own sleepy pose already sinks it; any more and the closed eyes dip
    // behind the board's edge at the bottom of the bob.
    const sink = (inst === this.peek ? 0 : 0.07) * this.size;
    const a = this._emote(this._svg(inst), [{ offset: 1, transform: lift(sink, -5) }],
      { duration: 1800, fill: "forwards", lead: EASE_SOFT });
    if (instant && a) a.finish();
  }

  _pop(inst, k, ms = 520) {
    this._emote(inst.el, [
      { offset: 0.3, transform: `scale(${k})`, easing: EASE_SOFT },
      { offset: 0.62, transform: "scale(0.97)", easing: EASE_SOFT },
      { offset: 1, transform: "scale(1)" },
    ], { duration: ms, lead: EASE_OUT });
  }

  _eyes(inst, ms) {
    for (const eye of inst.el.querySelectorAll(".hush-eye")) {
      this._emote(eye, [
        { offset: 0.2, transform: "scale(1.28)", easing: "linear" },
        { offset: 0.75, transform: "scale(1.28)", easing: EASE_SOFT },
        { offset: 1, transform: "scale(1)" },
      ], { duration: ms, lead: EASE_OUT });
    }
  }

  _fly(s) {
    const ax = this.left + s / 2, ay = this.top + s / 2;
    let stageTop = 0;
    try { stageTop = this.layer.getBoundingClientRect().top; } catch {}
    const D = -(stageTop + ay) - s * 0.9; // starts fully above the top of the screen
    this._flySide = -this._flySide;       // alternate the side Hush swoops in from
    const W = this._flySide * Math.min((window.innerWidth || 800) * 0.36, 320);
    const pts = flyPath(W, D, s);
    const anim = this.spot.animate(pts.map((p) => ({
      offset: p.t,
      transform: `translate(${px(p.x)}, ${px(p.y)}) rotate(${p.r.toFixed(2)}deg) scale(${p.k.toFixed(3)})`,
      opacity: clamp(p.t / 0.08, 0, 1),
    })), { duration: FLY_MS, easing: "linear" });
    // A trail of mint wisps follows the same arc a beat behind, fading before Hush lands.
    [0.8, 0.62, 0.46, 0.3].forEach((alpha, i) => {
      const el = this._spawn("ghd-wisp", ax, ay, s * (0.7 - i * 0.08));
      this._trail.push(this._play(el, pts.map((p) => ({
        offset: p.t,
        transform: `translate(${px(p.x)}, ${px(p.y)}) scale(${(p.k * (1 - i * 0.1)).toFixed(3)})`,
        opacity: +(alpha * clamp((p.t - 0.03) / 0.1, 0, 1) * clamp((0.8 - p.t) / 0.22, 0, 1)).toFixed(3),
      })), { duration: FLY_MS, delay: 40 + i * 42, easing: "linear", fill: "both" }));
    });
    return anim;
  }

  // Hush blinks out of its old spot in a little burst of motes.
  _poof(x, y, s) {
    if (this._reduced) return;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const r = s * (0.36 + (i % 2) * 0.12);
      const el = this._spawn("ghd-mote", x, y - s * 0.12, s * 0.16);
      this._play(el, [
        { transform: "translate(0px, 0px) scale(0.6)", opacity: 0.95 },
        { transform: `translate(${px(Math.cos(a) * r)}, ${px(Math.sin(a) * r - s * 0.1)}) scale(1.1)`, opacity: 0 },
      ], { duration: 460, easing: EASE_OUT });
    }
  }

  _sparkle() {
    if (this._reduced) return;
    const s = this.size, cx = this.left + s / 2, cy = this.top + s * 0.3;
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i - 2.5) * 0.55;
      const r = s * (0.55 + (i % 2) * 0.15);
      const el = this._spawn("ghd-mote", cx + Math.cos(a) * s * 0.3, cy + Math.sin(a) * s * 0.25, s * 0.12);
      this._play(el, [
        { transform: "translate(0px, 0px) scale(0.4)", opacity: 0 },
        { offset: 0.3, transform: `translate(${px(Math.cos(a) * r * 0.5)}, ${px(Math.sin(a) * r * 0.5)}) scale(1)`, opacity: 1 },
        { transform: `translate(${px(Math.cos(a) * r)}, ${px(Math.sin(a) * r - s * 0.15)}) scale(0.5)`, opacity: 0 },
      ], { duration: 700, delay: i * 40, easing: EASE_OUT, fill: "both" });
    }
  }

  // Four little clouds of breath leave the mouth toward (ux, uy). Reduced: they just fade.
  _puffs(mx, my, ux, uy, s) {
    const nx = -uy, ny = ux;
    const dist = 36 + s * 1.25;
    const at = (d, sp) => `translate(${px(ux * d + nx * sp)}, ${px(uy * d + ny * sp)})`;
    [0, 0.12, -0.12, 0.05].forEach((spread, i) => {
      const sp = spread * s;
      const el = this._spawn("ghd-puff", mx, my, s * (0.24 + i * 0.05));
      const end = dist * (0.75 + i * 0.12);
      const frames = this._reduced
        ? [
          { transform: `${at(s * 0.45, sp)} scale(1)`, opacity: 0 },
          { offset: 0.25, transform: `${at(s * 0.45, sp)} scale(1)`, opacity: 0.9 },
          { transform: `${at(s * 0.45, sp)} scale(1)`, opacity: 0 },
        ]
        : [
          { transform: `${at(s * 0.22, 0)} scale(0.35)`, opacity: 0 },
          { offset: 0.15, transform: `${at(s * 0.4, sp * 0.5)} scale(0.8)`, opacity: 1 },
          { offset: 0.55, transform: `${at(end * 0.7, sp * 0.85)} scale(1.15)`, opacity: 0.85 },
          { transform: `${at(end, sp)} scale(1.5)`, opacity: 0 },
        ];
      this._play(el, frames, { duration: 760, delay: i * 70, easing: EASE_OUT, fill: "both" });
    });
  }

  _spawn(cls, cx, cy, w) {
    const el = document.createElement("div");
    el.className = `ghd-fx ${cls}`;
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, { left: px(cx - w / 2), top: px(cy - w / 2), width: px(w), height: px(w) });
    this.layer.appendChild(el);
    this._fx.add(el);
    return el;
  }

  // One-off effect: plays, then removes its element (also when cancelled).
  _play(el, frames, opts) {
    const end = () => { el.remove(); this._fx.delete(el); };
    if (!el.animate) { end(); return null; }
    const a = el.animate(frames, opts);
    a.onfinish = end;
    a.oncancel = end;
    return a;
  }
}

export default HushDirector;
