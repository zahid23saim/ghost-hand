// Ghost Hand - the seat strip: who is at the table while you play.
// One chip per seat (humans by id, then the ghost friends). Each chip shows the
// seat's patterned mitten, a name, and live hand state: pushing, counted, the
// knower's star, dozing, gone. update() diffs per chip, so calling it ~10 times
// a second only touches the DOM when something actually changed.

import { SEATS, patternTile } from "./render.js";

const STYLE_ID = "gh-seatstrip";
const EMOJI = { laugh: "\u{1F606}", gasp: "\u{1F62E}", heart: "\u{1F496}", tea: "\u{1F375}" };
const PUSH_ON = 0.1;        // m above this starts the push glow
const PUSH_OFF = 0.06;      // and below this ends it (no flicker at the edge)
const MAX_EMOTES = 4;       // per chip at once

// Upright mitten: body ellipse plus a thumb, the same shape the board draws.
const MITTEN = '<ellipse cx="13.5" cy="18.5" rx="10" ry="13"/><ellipse cx="22.2" cy="17" rx="4" ry="6" transform="rotate(30 22.2 17)"/>';
const STAR = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 1.6l2.5 5.3 5.8.8-4.2 4 1 5.8L10 14.7l-5.1 2.8 1-5.8-4.2-4 5.8-.8z"/></svg>';
const TAP = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2.5v3.6M3.2 5.2l2.4 2.3M12.8 5.2l-2.4 2.3"/></svg>';

let instanceN = 0;
const patCache = new Map();

function patternUrl(colour) {
  const k = ((colour | 0) % 6 + 6) % 6;
  if (!patCache.has(k)) {
    let url = "";
    try { url = patternTile(SEATS[k], 24).toDataURL(); } catch { url = ""; }
    patCache.set(k, url);
  }
  return patCache.get(k);
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const creature = (name) => String(name || "").trim().split(/\s+/).pop() || "Someone";

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

export class SeatStrip {
  constructor(container, { reduced = false, onResize = null } = {}) {
    injectStyle();
    this.root = container;
    this.id = `gss${++instanceN}`;
    this.reduced = !!reduced;
    this.onResize = typeof onResize === "function" ? onResize : null;
    this.chips = new Map();       // seat id -> chip
    this.order = "";
    this.compact = null;
    this.visible = !container.hidden;
    this.rendered = false;
    this.lastArgs = null;
    this.hmap = new Map();
    this.list = [];
    container.classList.add("gss");
    container.classList.toggle("gss-reduced", this.reduced);
    container.setAttribute("role", "list");
    container.setAttribute("aria-label", "At the table");
    this.lastH = -1;
    this.ro = null;
    if (this.onResize && typeof ResizeObserver === "function") {
      let raf = 0;
      this.ro = new ResizeObserver(() => {
        const h = Math.round(this.root.offsetHeight);
        if (this.lastH < 0) { this.lastH = h; return; }
        if (Math.abs(h - this.lastH) <= 1) return;
        this.lastH = h;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { try { this.onResize(); } catch {} });
      });
      this.ro.observe(container);
    }
  }

  // Render the table. Cheap to call often: each chip only writes what changed.
  update(args = {}) {
    this.lastArgs = args;
    if (!this.visible) return;
    const { seats = [], hands = [], you = null, knower = null, compact = false, mine = null } = args;

    const list = this.list;
    list.length = 0;
    for (const s of seats || []) if (s && (s.kind === "human" || s.kind === "bot")) list.push(s);
    list.sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "human" ? -1 : 1));

    if (compact !== this.compact) {
      this.compact = compact;
      this.root.classList.toggle("compact", !!compact);
      for (const c of this.chips.values()) c.st.label = null; // labels change length
    }

    const order = list.map((s) => s.id).join(",");
    if (order !== this.order) this.reconcile(list, order);

    const hmap = this.hmap;
    hmap.clear();
    for (const h of hands || []) if (h) hmap.set(h.seat, h);
    for (const s of list) this.paint(this.chips.get(s.id), s, hmap.get(s.id), you, knower, compact, mine);
    this.rendered = true;
  }

  reconcile(list, order) {
    this.order = order;
    const keep = new Set(list.map((s) => s.id));
    for (const [id, c] of this.chips) {
      if (!keep.has(id)) { clearTimeout(c.knockT); c.el.remove(); this.chips.delete(id); }
    }
    for (const s of list) {
      let c = this.chips.get(s.id);
      if (!c) {
        c = this.makeChip(s.id);
        this.chips.set(s.id, c);
        if (this.rendered && !this.reduced) {
          c.el.classList.add("gss-in");
          c.el.addEventListener("animationend", (ev) => { if (ev.animationName === "gss-in") c.el.classList.remove("gss-in"); });
        }
      }
      this.root.appendChild(c.el);
    }
  }

  makeChip(id) {
    const el = document.createElement("div");
    el.className = "gss-chip";
    el.setAttribute("role", "listitem");
    el.dataset.seat = id;
    const pid = `${this.id}-p${id}`;
    el.innerHTML =
      `<span class="gss-mw">` +
        `<span class="gss-halo"></span>` +
        `<svg class="gss-mit" viewBox="0 0 30 34" aria-hidden="true" focusable="false">` +
          `<defs><pattern id="${pid}" patternUnits="userSpaceOnUse" width="11" height="11"><image width="11" height="11" preserveAspectRatio="none"/></pattern></defs>` +
          `<g class="gss-line">${MITTEN}</g><g class="gss-fill" fill="url(#${pid})">${MITTEN}</g>` +
        `</svg>` +
        `<span class="gss-star">${STAR}</span>` +
        `<span class="gss-zz" aria-hidden="true">z z</span>` +
      `</span>` +
      `<span class="gss-name"></span><span class="gss-you" hidden>you</span>` +
      `<span class="gss-fx" aria-hidden="true"></span>`;
    return {
      el,
      img: el.querySelector("image"),
      name: el.querySelector(".gss-name"),
      you: el.querySelector(".gss-you"),
      fx: el.querySelector(".gss-fx"),
      st: {},
      knockT: 0,
    };
  }

  paint(c, s, h, you, knower, compact, mine) {
    if (!c) return;
    const st = c.st;
    const human = s.kind === "human";
    const isMine = you != null && s.id === you;
    let resting = h ? !!h.resting : !human;
    let m = (h && h.m) || 0;
    let status = (h && h.status) || s.status || "ok";
    if (isMine && mine) {
      resting = !!mine.resting;
      m = resting ? mine.m || 0 : 0;
      if (mine.dozing && status === "ok") status = "dozing";
    }
    const gone = status === "gone";
    const dozing = status === "dozing";
    const push = resting && !gone && m > (st.push ? PUSH_OFF : PUSH_ON);
    const counted = !!(h && h.counted) && resting && !gone;
    const isKnower = knower != null && s.id === knower;
    let dirty = false;

    // Identity: kind and colour (rare).
    if (st.kind !== s.kind || st.colour !== s.colour) {
      st.kind = s.kind; st.colour = s.colour;
      c.el.classList.toggle("is-bot", !human);
      if (human) {
        const hex = SEATS[((s.colour | 0) % 6 + 6) % 6].hex;
        c.el.style.setProperty("--gss-glow", rgba(hex, 0.55));
        c.el.style.setProperty("--gss-seat", hex);
        const url = patternUrl(s.colour);
        if (url) c.img.setAttribute("href", url);
      } else {
        c.el.style.setProperty("--gss-glow", "rgba(243,233,210,0.5)");
        c.el.style.setProperty("--gss-seat", "rgba(243,233,210,0.6)");
      }
      dirty = true;
    }

    // Compact (phones): just the creature word, and your own chip simply says "you".
    const label = compact ? (isMine ? "you" : human ? creature(s.name) : s.name || "Someone") : s.name || "Someone";
    if (st.label !== label) { st.label = label; c.name.textContent = label; dirty = true; }
    if (st.fullName !== s.name) { st.fullName = s.name; dirty = true; }
    const youTag = isMine && !compact;
    if (st.youTag !== youTag) { st.youTag = youTag; c.you.hidden = !youTag; }
    if (st.mine !== isMine) { st.mine = isMine; c.el.classList.toggle("is-mine", isMine); dirty = true; }

    flag(c, "push", push);
    flag(c, "counted", counted);
    if (flag(c, "knower", isKnower)) dirty = true;
    if (flag(c, "lifted", !resting && !gone && !dozing)) dirty = true;
    if (flag(c, "dozing", dozing)) dirty = true;
    if (flag(c, "gone", gone)) dirty = true;

    if (dirty) {
      let t = s.name || "Someone";
      if (isMine) t += " (you)";
      if (!human) t += ", ghost friend";
      if (isKnower) t += ", leading this word";
      if (gone) t += ", left the table";
      else if (dozing) t += ", dozing";
      else if (!resting) t += ", hand lifted";
      if (st.title !== t) { st.title = t; c.el.title = t; c.el.setAttribute("aria-label", t); }
    }
  }

  // That chip bumps twice with two tiny knuckle taps.
  knock(seatId) {
    const c = this.chips.get(seatId);
    if (!c || !this.visible) return false;
    c.el.classList.remove("is-knock");
    void c.el.offsetWidth;
    c.el.classList.add("is-knock");
    clearTimeout(c.knockT);
    c.knockT = setTimeout(() => c.el.classList.remove("is-knock"), 700);
    for (let i = 0; i < 2; i++) {
      const t = document.createElement("span");
      t.className = `gss-tap gss-tap${i}`;
      t.innerHTML = TAP;
      c.fx.appendChild(t);
      setTimeout(() => t.remove(), 900);
    }
    return true;
  }

  // A small emoji pops up from that chip and floats away. Returns false when
  // it could not be shown (strip hidden or no such seat), so the caller can fall back.
  emote(seatId, e) {
    const c = this.chips.get(seatId);
    if (!c || !this.visible) return false;
    const live = c.fx.querySelectorAll(".gss-emo");
    for (let i = 0; i <= live.length - MAX_EMOTES; i++) live[i].remove();
    const s = document.createElement("span");
    s.className = "gss-emo";
    s.textContent = EMOJI[e] || "✨";
    s.style.setProperty("--gss-sway", `${Math.round((Math.random() * 2 - 1) * 14)}px`);
    c.fx.appendChild(s);
    setTimeout(() => s.remove(), 2000);
    return true;
  }

  setVisible(v) {
    v = !!v;
    if (v === this.visible && this.root.hidden === !v) return;
    this.visible = v;
    this.root.hidden = !v;
    if (v && this.lastArgs) this.update(this.lastArgs);
  }

  // Forget every chip (leaving a room).
  reset() {
    for (const c of this.chips.values()) clearTimeout(c.knockT);
    this.chips.clear();
    this.root.replaceChildren();
    this.order = "";
    this.rendered = false;
    this.lastArgs = null;
  }

  destroy() {
    this.ro?.disconnect();
    this.reset();
    this.root.classList.remove("gss", "compact", "gss-reduced");
  }
}

function flag(c, k, v) {
  if (c.st[k] === v) return false;
  c.st[k] = v;
  c.el.classList.toggle(`is-${k}`, v);
  return true;
}

// ---------------------------------------------------------------------------

const CSS = `
.gss { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; align-content: flex-end;
  gap: 6px 8px; padding: 4px 16px 8px; flex: 0 0 auto; position: relative; z-index: 12; min-width: 0; }
.gss:empty { display: none; }
.gss-chip { position: relative; display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 13px 0 6px;
  border-radius: 999px; background: rgba(34,30,69,0.82); border: 1px solid var(--line-strong);
  font: 800 14px/1 var(--ui); color: var(--cream); white-space: nowrap; max-width: 100%;
  transition: border-color 220ms, box-shadow 220ms, opacity 300ms, background 220ms, filter 300ms; }
.gss-chip.is-bot { background: rgba(34,30,69,0.55); border-style: dashed; }
.gss-chip.is-counted { border: 1px solid var(--gold); box-shadow: inset 0 0 0 1px rgba(255,201,77,0.35), 0 0 10px rgba(255,201,77,0.16); }
.gss-chip.is-push { box-shadow: 0 0 0 2px var(--gss-glow), 0 0 16px var(--gss-glow); }
.gss-chip.is-counted.is-push { box-shadow: inset 0 0 0 1px rgba(255,201,77,0.35), 0 0 0 2px var(--gss-glow), 0 0 16px var(--gss-glow); }
.gss-chip.is-knower { background: rgba(58,50,112,0.92); }
.gss-chip.is-lifted .gss-name { color: var(--muted); }
.gss-chip.is-dozing { opacity: 0.62; }
.gss-chip.is-gone { opacity: 0.34; filter: saturate(0.3); }

.gss-mw { position: relative; flex: 0 0 auto; width: 22px; height: 25px; }
.gss-mit { position: relative; display: block; width: 100%; height: 100%; overflow: visible; }
.gss-line { fill: none; stroke: rgba(255,255,255,0.95); stroke-width: 3.6; }
.gss-chip.is-mine .gss-line { stroke-width: 4.8; }
.gss-chip.is-counted .gss-line { stroke: var(--gold); }
.gss-chip.is-bot .gss-fill { fill: rgba(243,233,210,0.32); }
.gss-chip.is-bot .gss-line { stroke: rgba(243,233,210,0.9); stroke-width: 3; }
.gss-chip.is-lifted .gss-fill { fill-opacity: 0.35; }
.gss-chip.is-lifted .gss-line { stroke: var(--gss-seat); stroke-dasharray: 3.4 3; }
.gss-chip.is-gone .gss-line, .gss-chip.is-dozing .gss-line { stroke-dasharray: none; }

.gss-halo { position: absolute; left: 50%; top: 50%; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%;
  background: radial-gradient(circle, var(--gss-glow) 0%, rgba(0,0,0,0) 68%); opacity: 0; transform: scale(0.6);
  transition: opacity 200ms, transform 200ms; pointer-events: none; }
.gss-chip.is-bot:not(.is-lifted):not(.is-gone):not(.is-dozing) .gss-halo { opacity: 0.45; transform: scale(0.8); }
.gss-chip.is-push .gss-halo { opacity: 1; transform: scale(1); animation: gss-breathe 1.1s ease-in-out infinite alternate; }
@keyframes gss-breathe { from { transform: scale(0.88); } to { transform: scale(1.12); } }

.gss-star { position: absolute; right: -6px; top: -6px; width: 14px; height: 14px; opacity: 0; transform: scale(0.4) rotate(-40deg);
  transition: opacity 200ms, transform 320ms cubic-bezier(.3,1.6,.5,1); filter: drop-shadow(0 0 4px rgba(255,201,77,0.8)); }
.gss-star svg { display: block; width: 100%; height: 100%; fill: var(--gold); stroke: var(--night); stroke-width: 1.6; stroke-linejoin: round; }
.gss-chip.is-knower .gss-star { opacity: 1; transform: none; }

.gss-zz { position: absolute; right: -10px; top: -9px; font: 800 10px/1 var(--ui); color: var(--cream); letter-spacing: 0.04em; opacity: 0; pointer-events: none; }
.gss-chip.is-dozing .gss-zz { opacity: 1; animation: gss-doze 2.4s ease-in-out infinite; }
@keyframes gss-doze { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }

.gss-name { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.gss-you { flex: 0 0 auto; margin-left: -2px; padding: 3px 6px; border-radius: 999px; background: rgba(255,201,77,0.16);
  color: var(--gold); font: 800 11px/1 var(--ui); letter-spacing: 0.02em; }

.gss-fx { position: absolute; left: 6px; top: 0; width: 22px; height: 100%; pointer-events: none; overflow: visible; }
.gss-emo { position: absolute; left: 50%; top: -2px; font-size: 22px; line-height: 1; margin-left: -0.5em; opacity: 0;
  animation: gss-emo 1.8s ease-out forwards; will-change: transform, opacity; }
@keyframes gss-emo {
  0% { opacity: 0; transform: translate(0, 6px) scale(0.4); }
  14% { opacity: 1; transform: translate(0, -10px) scale(1.15); }
  30% { transform: translate(calc(var(--gss-sway) * 0.4), -26px) scale(1); }
  100% { opacity: 0; transform: translate(var(--gss-sway), -84px) scale(0.95); }
}
.gss-tap { position: absolute; top: -15px; width: 15px; height: 15px; color: var(--cream); opacity: 0; animation: gss-tap 420ms ease-out both;
  filter: drop-shadow(0 0 3px rgba(243,233,210,0.7)); }
.gss-tap svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
.gss-tap0 { left: -7px; rotate: -26deg; }
.gss-tap1 { right: -9px; rotate: 26deg; animation-delay: 150ms; }
@keyframes gss-tap { 0% { opacity: 0; transform: translateY(4px) scale(0.4); } 35% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-3px) scale(1.15); } }
.gss-chip.is-knock .gss-mw { animation: gss-knock 520ms ease-out; }
@keyframes gss-knock {
  0%, 100% { transform: none; }
  12% { transform: translateY(2px) rotate(-8deg); }
  26% { transform: translateY(-1px) rotate(0); }
  40% { transform: translateY(2px) rotate(8deg); }
  56% { transform: none; }
}
.gss-chip.is-knock { border-color: var(--cream); }
.gss-chip.gss-in { animation: gss-in 360ms cubic-bezier(.3,1.5,.5,1); }
@keyframes gss-in { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: none; } }

/* Compact (phones): 6 hands + 2 ghost friends fit in two short rows. */
.gss.compact { gap: 4px 3px; padding: 2px 8px 4px; }
.gss.compact .gss-chip { height: 24px; gap: 3px; padding: 0 6px 0 3px; font-size: 11px; }
.gss.compact .gss-chip.is-mine .gss-name { color: var(--gold); }
.gss.compact .gss-mw { width: 16px; height: 18px; }
.gss.compact .gss-halo { width: 30px; height: 30px; margin: -15px 0 0 -15px; }
.gss.compact .gss-star { width: 11px; height: 11px; right: -5px; top: -5px; }
.gss.compact .gss-zz { font-size: 9px; right: -7px; top: -7px; }
.gss.compact .gss-you { font-size: 9.5px; padding: 2px 5px; margin-left: -1px; }
.gss.compact .gss-fx { left: 3px; width: 16px; }
.gss.compact .gss-emo { font-size: 18px; }
.gss.compact .gss-tap { width: 12px; height: 12px; top: -12px; }

/* Inside the phone pad: along the bottom, left of the knock button. Touches pass through to the pad. */
.pad > .gss { position: absolute; left: 10px; right: 60px; bottom: 10px; padding: 0; justify-content: flex-start; z-index: auto; pointer-events: none; }
/* Lift the pad's "Hold here" hint a little while the strip is showing, so they never touch. */
.pad:has(> .gss:not([hidden]):not(:empty)) .padhint { bottom: calc(42% + 12px); }
/* Hold-free pad: the centre holds the 36px stop ring, so the hint sits in the gap between the
   ring and the strip, on one line (never up into the ring, the banner or the magnifier). */
.pad.gh-holdfree:has(> .gss:not([hidden]):not(:empty)) .padhint { top: calc(50% + 21px); bottom: auto; left: 14px; right: 64px;
  font-size: 13px; line-height: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.gss-reduced .gss-chip, .gss-reduced .gss-halo, .gss-reduced .gss-mw, .gss-reduced .gss-zz { animation: none !important; }
.gss-reduced .gss-emo { animation: gss-emo-still 1.6s ease-out forwards; }
.gss-reduced .gss-tap { animation: gss-fade 420ms ease-out both; }
@keyframes gss-emo-still { 0% { opacity: 0; transform: translateY(-14px); } 15%, 70% { opacity: 1; transform: translateY(-14px); } 100% { opacity: 0; transform: translateY(-14px); } }
@keyframes gss-fade { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .gss-chip, .gss-halo, .gss-mw, .gss-zz { animation: none !important; }
  .gss-emo { animation: gss-emo-still 1.6s ease-out forwards; }
  .gss-tap { animation: gss-fade 420ms ease-out both; }
}
`;
