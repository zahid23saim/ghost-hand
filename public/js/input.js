// Ghost Hand - your hand (spec §4.2-4.5). Whichever input was used last wins.
//
// Laptop: hover is preview only. Click the board to rest (sticky), click again or
// Esc to lift; press-and-drag rests while held. Push = from the lens toward the cursor.
// Phone: a floating joystick on the felt pad. Keys: arrows/WASD push, Space rests.
// Hold-free pad (Aa menu, spec §4.2/§8.11): tap the pad to set a sticky push from the pad
// centre toward the tap; tap the middle to stop pushing (still resting); Esc lifts.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const KEYMAP = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
const HF_STOP_PX = 18;        // a tap this close to the pad centre stops the push
const HF_HINT = "Tap to aim. Tap the middle to stop.";
const HF_CSS = `
.pad .gh-hf-centre, .pad .gh-hf-ray { display: none; }
.pad.gh-holdfree .gh-hf-centre { display: grid; position: absolute; left: 50%; top: 50%; width: ${HF_STOP_PX * 2}px; height: ${HF_STOP_PX * 2}px;
  margin: -${HF_STOP_PX}px 0 0 -${HF_STOP_PX}px; place-items: center; border-radius: 50%; border: 2px dashed rgba(94,242,208,0.55);
  background: rgba(94,242,208,0.06); pointer-events: none; transition: background 160ms, border-color 160ms, box-shadow 160ms; }
.pad.gh-holdfree .gh-hf-centre::after { content: ""; width: 10px; height: 10px; border-radius: 3px; background: rgba(94,242,208,0.7); }
.pad.gh-holdfree.gh-hf-stopped .gh-hf-centre { border-style: solid; border-color: var(--mint); background: rgba(94,242,208,0.18); box-shadow: 0 0 16px rgba(94,242,208,0.45); }
.pad.gh-holdfree.gh-hf-aiming .gh-hf-ray { display: block; position: absolute; left: 50%; top: 50%; height: 0; transform-origin: 0 0;
  border-top: 3px dashed rgba(94,242,208,0.75); pointer-events: none; filter: drop-shadow(0 0 4px rgba(94,242,208,0.6)); }
.pad.gh-holdfree .padhint { left: 14px; right: 64px; bottom: 16px; }
.pad.gh-holdfree .thumb.gh-hf-stop { border-style: dashed; background: rgba(255,201,77,0.08); box-shadow: none; }
@media (prefers-reduced-motion: reduce) { .pad.gh-holdfree .gh-hf-centre { transition: none; } }
`;
function ensureHoldFreeStyle() {
  if (document.getElementById("gh-holdfree")) return;
  const st = document.createElement("style");
  st.id = "gh-holdfree";
  st.textContent = HF_CSS;
  document.head.appendChild(st);
}

export class HandInput extends EventTarget {
  constructor({ canvas, pad, thumb, view }) {
    super();
    this.cv = canvas;
    this.pad = pad;
    this.thumb = thumb;
    this.view = view;
    this.enabled = true;
    this.sticky = false;
    this.held = false;          // press-and-drag or touch on the board
    this.src = "mouse";         // last used: mouse | touch | pad | keys
    this.cursor = null;         // board coords of the pointer
    this.cursorScreen = null;
    this.onBoard = false;
    this.offSince = 0;
    this.lastMove = performance.now();
    this.down = null;           // { at, wasSticky, pid, type }
    this.padPid = null;
    this.padOrigin = null;
    this.padVec = { x: 0, y: 0, m: 0 };
    this.keys = new Set();
    this.keyRamp = 0;
    this.shift = false;
    this.hidden = document.hidden;
    this.holdFree = false;
    this.hf = { pid: null, resting: false, ux: 0, uy: -1, m: 0, dx: 0, dy: 0 };
    this.hfCentre = null;
    this.hfRay = null;
    this.out = { resting: false, ux: 0, uy: -1, m: 0, device: "mouse", hidden: false, ghost: null };
    this.bind();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  get resting() {
    if (this.src === "pad") return this.holdFree ? this.hf.resting : this.padPid !== null;
    return this.sticky || this.held;
  }

  lift() {
    this.sticky = false;
    this.held = false;
    this.resetPad();
  }

  // Forget any pad touch, joystick or hold-free aim, and hide the thumb.
  resetPad() {
    this.padPid = null;
    this.padOrigin = null;
    this.hf.pid = null;
    this.hf.resting = false;
    this.hf.m = 0;
    if (this.thumb) {
      this.thumb.style.display = "none";
      this.thumb.style.left = "";
      this.thumb.style.top = "";
      this.thumb.classList.remove("gh-hf-stop");
    }
    this.pad?.classList.remove("gh-hf-aiming", "gh-hf-stopped");
  }

  // Hold-free pad on or off. Switching drops whatever the pad was doing (nothing keeps
  // pushing by surprise); mouse, touch-on-board and keyboard rest are left alone.
  setHoldFree(on) {
    on = !!on;
    if (on === this.holdFree) return;
    this.resetPad();
    this.padVec = { x: 0, y: 0, m: 0 };
    this.holdFree = on;
    if (this.pad) {
      if (on) {
        ensureHoldFreeStyle();
        if (!this.hfCentre) {
          this.hfCentre = document.createElement("div");
          this.hfCentre.className = "gh-hf-centre";
          this.hfCentre.setAttribute("aria-hidden", "true");
          this.hfRay = document.createElement("div");
          this.hfRay.className = "gh-hf-ray";
          this.hfRay.setAttribute("aria-hidden", "true");
          const before = this.thumb && this.thumb.parentNode === this.pad ? this.thumb : null;
          this.pad.insertBefore(this.hfCentre, before);
          this.pad.insertBefore(this.hfRay, before);
        }
      }
      this.pad.classList.toggle("gh-holdfree", on);
      const hint = this.pad.querySelector(".padhint");
      if (hint) {
        if (on) { if (hint.dataset.ghText == null) hint.dataset.ghText = hint.textContent; hint.textContent = HF_HINT; }
        else if (hint.dataset.ghText != null) { hint.textContent = hint.dataset.ghText; delete hint.dataset.ghText; }
      }
    }
    this.emit("change");
  }

  // Hold-free: aim from the pad centre toward a screen point (sticky until the next tap).
  hfAim(clientX, clientY) {
    const r = this.pad.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2), dy = clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    const hf = this.hf;
    hf.resting = true;
    if (d <= HF_STOP_PX) {
      hf.m = 0; hf.dx = 0; hf.dy = 0;          // keep the last direction, push nothing
    } else {
      hf.ux = dx / d; hf.uy = dy / d;
      hf.m = clamp01((d - 6) / 26);
      hf.dx = dx; hf.dy = dy;
    }
    this.hfShow();
  }

  hfShow() {
    const hf = this.hf, d = Math.hypot(hf.dx, hf.dy);
    const stopped = hf.m === 0;
    this.pad.classList.toggle("gh-hf-stopped", stopped);
    this.pad.classList.toggle("gh-hf-aiming", !stopped);
    if (this.thumb) {
      // Left/top relative to the pad centre, so a pad resize keeps the thumb on its spot.
      this.thumb.style.display = "block";
      this.thumb.style.transform = "none";
      this.thumb.style.left = `calc(50% + ${hf.dx.toFixed(1)}px)`;
      this.thumb.style.top = `calc(50% + ${hf.dy.toFixed(1)}px)`;
      this.thumb.classList.toggle("gh-hf-stop", stopped);
    }
    if (this.hfRay && !stopped) {
      // From the edge of the centre ring to the edge of the thumb.
      const start = HF_STOP_PX + 4, len = Math.max(0, d - start - 31);
      const a = Math.atan2(hf.dy, hf.dx);
      this.hfRay.style.width = `${len.toFixed(1)}px`;
      this.hfRay.style.transform = `rotate(${a.toFixed(4)}rad) translate(${start}px, -1.5px)`;
    }
  }

  boardPoint(e) {
    const r = this.cv.getBoundingClientRect();
    const [bx, by] = this.view.toBoard(e.clientX - r.left, e.clientY - r.top);
    return { x: bx, y: by };
  }

  bind() {
    const cv = this.cv;
    cv.addEventListener("pointermove", (e) => {
      this.cursor = this.boardPoint(e);
      this.cursorScreen = [e.clientX, e.clientY];
      this.onBoard = true;
      this.offSince = 0;
      this.lastMove = performance.now();
      if (e.pointerType === "mouse") this.src = this.keys.size ? this.src : "mouse";
    });
    cv.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") { this.onBoard = false; this.offSince = performance.now(); }
    });
    cv.addEventListener("pointerdown", (e) => {
      this.emit("activate", { target: "board", point: this.boardPoint(e) });
      if (!this.enabled) return;
      if (this.down && this.down.pid !== e.pointerId) return; // first finger only
      this.cursor = this.boardPoint(e);
      this.onBoard = true;
      this.lastMove = performance.now();
      this.src = e.pointerType === "mouse" ? "mouse" : "touch";
      this.down = { at: performance.now(), wasSticky: this.sticky, pid: e.pointerId, type: e.pointerType };
      this.held = true;
      try { cv.setPointerCapture(e.pointerId); } catch {}
    });
    const up = (e) => {
      if (!this.down || this.down.pid !== e.pointerId) return;
      const quick = performance.now() - this.down.at < 250;
      if (this.down.type === "mouse" && quick) this.sticky = !this.down.wasSticky;
      this.held = false;
      this.down = null;
      if (e.pointerType !== "mouse") this.onBoard = false;
      this.emit("change");
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);

    // Phone pad: a floating joystick (spec §4.2).
    if (this.pad) {
      this.pad.addEventListener("pointerdown", (e) => {
        this.emit("activate", { target: "pad" });
        if (this.holdFree) {
          // Aim at once (instant feedback), follow the finger while it is down, keep on release.
          if (!this.enabled || this.hf.pid !== null) return;
          if (e.target.closest("button")) return;
          this.src = "pad";
          this.hf.pid = e.pointerId;
          try { this.pad.setPointerCapture(e.pointerId); } catch {}
          this.hfAim(e.clientX, e.clientY);
          this.emit("change");
          return;
        }
        if (!this.enabled || this.padPid !== null) return;
        if (e.target.closest("button")) return;
        this.src = "pad";
        this.padPid = e.pointerId;
        this.padOrigin = [e.clientX, e.clientY];
        this.padVec = { x: 0, y: 0, m: 0 };
        try { this.pad.setPointerCapture(e.pointerId); } catch {}
        this.placeThumb(e);
        this.emit("change");
      });
      this.pad.addEventListener("pointermove", (e) => {
        if (this.holdFree) {
          if (e.pointerId === this.hf.pid) this.hfAim(e.clientX, e.clientY);
          return;
        }
        if (e.pointerId !== this.padPid || !this.padOrigin) return;
        let dx = e.clientX - this.padOrigin[0], dy = e.clientY - this.padOrigin[1];
        let d = Math.hypot(dx, dy);
        const follow = 1.3 * 32;
        if (d > follow) {
          // The origin trails the finger, so reversing is instant.
          const k = (d - follow) / d;
          this.padOrigin[0] += dx * k; this.padOrigin[1] += dy * k;
          dx = e.clientX - this.padOrigin[0]; dy = e.clientY - this.padOrigin[1]; d = follow;
        }
        const m = d <= 6 ? 0 : clamp01(Math.pow((d - 6) / 26, 0.8));
        const nx = d > 0 ? dx / d : 0, ny = d > 0 ? dy / d : 0;
        // Smoothing: blend 40% of the new input into the previous value.
        const px = this.padVec.x * this.padVec.m, py = this.padVec.y * this.padVec.m;
        const bx = px + (nx * m - px) * 0.4, by = py + (ny * m - py) * 0.4;
        const bm = Math.hypot(bx, by);
        this.padVec = { x: bm > 1e-4 ? bx / bm : nx, y: bm > 1e-4 ? by / bm : ny, m: Math.min(1, bm) };
        this.placeThumb(e);
      });
      const padUp = (e) => {
        if (this.holdFree) {
          // The aim stays (that is the point); a cancelled touch keeps the last aim too.
          if (e.pointerId !== this.hf.pid) return;
          this.hf.pid = null;
          if (e.type === "pointerup" && this.hf.resting) this.hfAim(e.clientX, e.clientY);
          this.emit("change");
          return;
        }
        if (e.pointerId !== this.padPid) return;
        this.padPid = null;
        this.padOrigin = null;
        this.padVec = { x: 0, y: 0, m: 0 };
        if (this.thumb) this.thumb.style.display = "none";
        this.emit("change");
      };
      this.pad.addEventListener("pointerup", padUp);
      this.pad.addEventListener("pointercancel", padUp);
    }

    addEventListener("keydown", (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      // Keys pressed inside a modal panel (the Aa menu and friends) are not game keys.
      if (e.target && e.target.closest && e.target.closest('[aria-modal="true"]')) return;
      // Nor is anything pressed while a dialog or overlay covers the board: the Esc that
      // closes it must not also lift the hand, and arrows must not push behind it.
      if (this.modalOpen()) { this.keys.clear(); return; }
      this.shift = e.shiftKey;
      if (KEYMAP[e.code]) {
        if (!this.enabled) return;
        this.emit("activate", { target: "keys" });
        if (!this.keys.size) this.keyRamp = 0;
        this.keys.add(e.code);
        this.src = "keys";
        this.sticky = true;
        e.preventDefault();
      } else if (e.code === "Space" && this.enabled && !(e.target && e.target.closest && e.target.closest("button"))) {
        this.emit("activate", { target: "keys" });
        this.src = this.src === "pad" ? "keys" : this.src;
        this.sticky = !this.sticky;
        e.preventDefault();
        this.emit("change");
      } else if (e.code === "Escape") {
        this.lift();
        this.emit("change");
      } else if (e.code === "KeyK") {
        this.emit("knock");
      }
    });
    addEventListener("keyup", (e) => { this.shift = e.shiftKey; this.keys.delete(e.code); });
    addEventListener("blur", () => { this.keys.clear(); this.lift(); this.emit("change"); });
    document.addEventListener("visibilitychange", () => {
      this.hidden = document.hidden;
      if (this.hidden) { this.keys.clear(); this.lift(); }
      this.emit("change");
    });
    addEventListener("orientationchange", () => { this.lift(); this.emit("change"); });
  }

  // The in-room #dialog, any aria-modal panel, or an inert app.
  modalOpen() {
    const dlg = document.getElementById("dialog");
    if (dlg && !dlg.hidden) return true;
    if (document.querySelector('[aria-modal="true"]')) return true;
    const app = document.getElementById("app");
    return !!(app && app.inert);
  }

  placeThumb(e) {
    if (!this.thumb) return;
    const r = this.pad.getBoundingClientRect();
    this.thumb.style.display = "block";
    this.thumb.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
  }

  // Called every frame with the interpolated lens position; returns this frame's hand.
  update(now, lens, dt) {
    const o = this.out;
    o.hidden = this.hidden;
    o.ghost = null;
    // Another input took over from the hold-free pad: drop its aim so the pad shows nothing stale.
    if (this.holdFree && this.src !== "pad" && this.hf.resting) this.resetPad();
    if (this.src === "pad" && this.holdFree) {
      o.device = "pad";
      o.resting = this.hf.resting;
      o.ux = this.hf.ux; o.uy = this.hf.uy; o.m = o.resting ? this.hf.m : 0;
      return o;
    }
    if (this.src === "pad") {
      o.device = "pad";
      o.resting = this.padPid !== null;
      o.ux = this.padVec.x; o.uy = this.padVec.y; o.m = o.resting ? this.padVec.m : 0;
      return o;
    }
    if (this.src === "keys" && this.keys.size) {
      let x = 0, y = 0;
      for (const k of this.keys) { x += KEYMAP[k][0]; y += KEYMAP[k][1]; }
      const l = Math.hypot(x, y);
      this.keyRamp = Math.min(1, this.keyRamp + dt / 0.12);
      o.device = "keys";
      o.resting = true;
      if (l > 0) { o.ux = x / l; o.uy = y / l; o.m = this.keyRamp * (this.shift ? 0.5 : 1); } else o.m = 0;
      return o;
    }
    if (this.src === "keys") {
      o.device = "keys";
      o.resting = this.sticky;
      o.m = 0;
      return o;
    }
    // Mouse or touch on the board.
    o.device = this.src === "touch" ? "touch" : "mouse";
    o.resting = this.sticky || this.held;
    if (this.cursor && this.onBoard && this.src === "mouse") o.ghost = this.cursor;
    if (!o.resting || !this.cursor || !lens) { o.m = 0; return o; }
    if (!this.onBoard && this.src === "mouse" && this.offSince && now - this.offSince > 400) { o.m = 0; return o; }
    const dx = this.cursor.x - lens.x, dy = this.cursor.y - lens.y, d = Math.hypot(dx, dy);
    let m = clamp01((d - 24) / (60 - 24));
    // 8 s without moving the cursor: the push fades over 1 s.
    const still = now - this.lastMove;
    if (this.src === "mouse" && still > 8000) m *= clamp01(1 - (still - 8000) / 1000);
    if (d > 1e-3) { o.ux = dx / d; o.uy = dy / d; }
    o.m = m;
    return o;
  }

  get drowsy() { return this.src === "mouse" && (this.sticky || this.held) && performance.now() - this.lastMove > 8000; }
}
