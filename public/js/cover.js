// Ghost Hand - the 1600 x 900 cover (spec §8.12), drawn by the live renderer at ?cover.
// Four patterned mittens glide the planchette toward a glowing H, a mint streak behind
// it, while Hush peeks over the board's top edge with a mitten to its lips.
// ?cover&clean drops the helper bar, so the frame can be screenshotted as is;
// ?cover&safe starts with the 1200 x 675 safe area outlined.

import { BoardView } from "./render.js";
import { TARGET_BY_KEY } from "./shared/board.js";
import { createHush } from "./hush.js";

const W = 1600, H = 900;
const SAFE = { x: 200, y: 112.5, w: 1200, h: 675 };   // centred 1200 x 675
const BOARD = { x: 660, y: 202, w: 740 };             // CSS px; the board is 1000 x 900 bu
const S = BOARD.w / 1000;
const TARGET = "H";
const LENS = { x: 648, y: 506 };                      // mid-glide, in board units
// The streak: home area up and round to the lens (cubic Bezier, board units).
const PATH = [[262, 660], [380, 722], [524, 656], [LENS.x, LENS.y]];
const TRAIL_POINTS = 44;
const TRAIL_MS = 1900;                                // under the renderer's 2 s fade
const SETTLE_MS = 2000;                               // rAF redraws while fonts and sprites settle
const HUSH_SIZE = 150;
const HUSH_BU_X = 300;                                // where Hush peeks along the top edge
const HUSH_SHOW = 0.66;                               // share of Hush's box above the rim
const FONTS = ["650 74px Fraunces", "800 80px Fraunces", "800 32px Nunito", "italic 700 50px Fraunces", "italic 700 30px Fraunces"];
// Demo pages load Fraunces upright only; the cover's italics ("Don't talk.", "shh...") need
// the real italic face, or the browser slants the roman.
const ITALIC_CSS = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@1,9..144,600..800,0..100,0..1&display=swap";

const CSS = `
.ghc-body { margin: 0; overflow: hidden; background: #0D0B20; }
.ghc-stage, .ghc-stage *, .ghc-help { box-sizing: border-box; }
.ghc-stage { position: fixed; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; transform-origin: 0 0; font-synthesis-style: none;
  background-color: var(--night, #14122B); color: var(--cream, #F3E9D2); font: 600 16px/1.4 var(--ui, "Nunito", system-ui, sans-serif);
  -webkit-user-select: none; user-select: none; }
.ghc-sky { position: absolute; inset: 0; background-color: var(--night, #14122B);
  background-image:
    radial-gradient(ellipse 80% 55% at 50% -10%, rgba(94,242,208,0.10), rgba(94,242,208,0) 70%),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cg fill='%23F3E9D2'%3E%3Ccircle cx='18' cy='30' r='1.2' opacity='.5'/%3E%3Ccircle cx='120' cy='14' r='.9' opacity='.35'/%3E%3Ccircle cx='190' cy='60' r='1.4' opacity='.45'/%3E%3Ccircle cx='70' cy='96' r='.8' opacity='.3'/%3E%3Ccircle cx='160' cy='140' r='1.1' opacity='.4'/%3E%3Ccircle cx='34' cy='170' r='1' opacity='.35'/%3E%3Ccircle cx='100' cy='200' r='1.3' opacity='.45'/%3E%3Ccircle cx='206' cy='196' r='.8' opacity='.3'/%3E%3C/g%3E%3Cpath d='M150 92l2 5 5 2-5 2-2 5-2-5-5-2 5-2z' fill='%23FFC94D' opacity='.35'/%3E%3C/svg%3E"),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='370' height='310' viewBox='0 0 370 310'%3E%3Cg fill='%23F3E9D2'%3E%3Ccircle cx='52' cy='64' r='1.1' opacity='.4'/%3E%3Ccircle cx='250' cy='38' r='.8' opacity='.3'/%3E%3Ccircle cx='330' cy='170' r='1.3' opacity='.4'/%3E%3Ccircle cx='140' cy='250' r='.9' opacity='.35'/%3E%3C/g%3E%3Cpath d='M286 254l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z' fill='%23FFC94D' opacity='.3'/%3E%3C/svg%3E");
  background-position: 0 0, 0 0, 97px 41px; }
.ghc-sky::after { content: ""; position: absolute; inset: 0;
  background: radial-gradient(ellipse 75% 85% at 52% 48%, rgba(20,18,43,0) 55%, rgba(8,7,22,0.55) 100%); }
.ghc-halo { position: absolute; left: ${BOARD.x - 150}px; top: ${BOARD.y - 120}px; width: ${BOARD.w + 300}px; height: ${BOARD.w * 0.9 + 240}px;
  background: radial-gradient(closest-side, rgba(255,201,77,0.16), rgba(255,201,77,0.05) 55%, rgba(255,201,77,0) 100%); pointer-events: none; }
.ghc-moon { position: absolute; left: 286px; top: 132px; width: 420px; height: 420px; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(94,242,208,0.12), rgba(94,242,208,0.04) 50%, rgba(94,242,208,0) 100%); pointer-events: none; }
.ghc-lift { position: absolute; left: ${BOARD.x + 10}px; top: ${BOARD.y + 24}px; width: ${BOARD.w - 20}px; height: ${BOARD.w * 0.9 - 20}px;
  border-radius: ${Math.round(70 * S)}px; box-shadow: 0 34px 70px rgba(4,3,14,0.7), 0 10px 24px rgba(4,3,14,0.45); pointer-events: none; }
.ghc-cv { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; display: block; }
.ghc-hush { position: absolute; width: ${HUSH_SIZE}px; height: ${HUSH_SIZE}px; filter: drop-shadow(0 0 18px rgba(94,242,208,0.4)); }
.ghc-hush .hush-blink .hush-lid { animation: none; }
.ghc-clean .ghc-hush .hush-bob { animation: none; transform: translateY(-2px); }
.ghc-copy { position: absolute; left: ${SAFE.x + 14}px; top: 0; height: ${H}px; width: 470px; padding-top: 44px; display: flex; flex-direction: column; justify-content: center; z-index: 1; }
.ghc-shh { position: absolute; margin: 0; font: italic 700 30px/1 var(--display, "Fraunces", Georgia, serif); font-variation-settings: "SOFT" 100;
  color: rgba(243,233,210,0.72); letter-spacing: 0.04em; text-shadow: 0 0 16px rgba(94,242,208,0.45); transform: rotate(-8deg); }
.ghc-mark { margin: 0; font: 800 160px/0.86 var(--display, "Fraunces", Georgia, serif); font-variation-settings: "SOFT" 100, "WONK" 1;
  letter-spacing: -0.03em; color: var(--cream, #F3E9D2);
  text-shadow: 0 0 46px rgba(255,201,77,0.38), 0 0 14px rgba(255,201,77,0.22), 0 4px 0 rgba(8,7,22,0.35); }
.ghc-mark > span { display: block; white-space: nowrap; }
.ghc-mark .ghc-l2 { padding-left: 0.36em; }
.ghc-o { display: inline-block; width: 0.62em; height: 0.62em; margin: 0 0.02em; border-radius: 50% 50% 46% 46%;
  background: radial-gradient(circle at 50% 42%, var(--mint, #5EF2D0) 0 30%, var(--card-2, #2A2552) 32% 48%, var(--gold, #FFC94D) 50%);
  vertical-align: -0.04em; box-shadow: 0 0 34px rgba(255,201,77,0.45), 0 0 10px rgba(94,242,208,0.35); }
.ghc-rule { width: 92px; height: 3px; margin: 34px 0 26px 6px; border-radius: 3px;
  background: linear-gradient(90deg, var(--gold-deep, #C9A24A), rgba(201,162,74,0)); }
.ghc-tag { margin: 0 0 0 4px; font: 700 50px/1.12 var(--display, "Fraunces", Georgia, serif); font-variation-settings: "SOFT" 100; color: var(--cream, #F3E9D2); }
.ghc-tag em { display: block; font-style: italic; color: var(--gold, #FFC94D); text-shadow: 0 0 24px rgba(255,201,77,0.35); }
.ghc-sub { position: relative; margin: 24px 0 0 6px; max-width: 380px; font: 700 21px/1.4 var(--ui, "Nunito", system-ui, sans-serif); color: var(--muted, #A9A3C9); }
/* Quiet the sky's stars behind the small print, so none reads as punctuation. */
.ghc-sub::before { content: ""; position: absolute; z-index: -1; inset: -10px -16px; border-radius: 30px; background: var(--night, #14122B); filter: blur(9px); }
.ghc-safe { position: absolute; left: ${SAFE.x}px; top: ${SAFE.y}px; width: ${SAFE.w}px; height: ${SAFE.h}px;
  border: 2px dashed rgba(94,242,208,0.7); border-radius: 4px; pointer-events: none; z-index: 5; }
.ghc-help { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 60; display: flex; align-items: center; gap: 10px;
  max-width: calc(100vw - 32px); padding: 8px 8px 8px 16px; border-radius: 18px; background: rgba(27,24,56,0.94);
  border: 1px solid rgba(201,162,74,0.55); box-shadow: 0 10px 30px rgba(0,0,0,0.4); color: var(--cream, #F3E9D2);
  font: 700 14px/1.3 var(--ui, "Nunito", system-ui, sans-serif); }
.ghc-help span { color: var(--muted, #A9A3C9); }
.ghc-help b { color: var(--cream, #F3E9D2); font-weight: 800; }
.ghc-help button { flex: 0 0 auto; min-height: 38px; padding: 7px 14px; border-radius: 12px; border: 1px solid var(--line-strong, rgba(243,233,210,0.28));
  background: var(--card-2, #2A2552); color: var(--cream, #F3E9D2); font: 800 14px var(--ui, "Nunito", system-ui, sans-serif); cursor: pointer; }
.ghc-help button:hover { background: var(--violet, #3A3270); }
.ghc-help button[aria-pressed="true"] { border-color: var(--mint, #5EF2D0); color: var(--mint, #5EF2D0); }
.ghc-help button:focus-visible { outline: 3px solid var(--mint, #5EF2D0); outline-offset: 3px; }
@media (max-width: 640px) { .ghc-help { flex-wrap: wrap; justify-content: center; text-align: center; padding: 10px 12px; } }
@media (prefers-reduced-motion: reduce) { .ghc-hush .hush-bob { animation: none; } }
`;

function injectCss() {
  if (document.getElementById("gh-cover")) return;
  const st = document.createElement("style");
  st.id = "gh-cover";
  st.textContent = CSS;
  document.head.appendChild(st);
}

// Resolves once the italic stylesheet has loaded (or failed), so fonts.load() can see its @font-face.
let italicReady = null;
function injectItalic() {
  if (italicReady) return italicReady;
  italicReady = new Promise((resolve) => {
    const lk = document.createElement("link");
    lk.id = "gh-cover-italic";
    lk.rel = "stylesheet";
    lk.href = ITALIC_CSS;
    lk.onload = lk.onerror = () => resolve();
    document.head.appendChild(lk);
  });
  return italicReady;
}

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

// Fonts first, or the static board bakes in the fallback serif. Never wait forever.
async function fontsReady() {
  if (!document.fonts?.load) return;
  const all = injectItalic().then(() => Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => null))));
  await Promise.race([all, new Promise((r) => setTimeout(r, 4000))]);
}

const bez = (p, t) => {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1].map((i) => k[0] * p[0][i] + k[1] * p[1][i] + k[2] * p[2][i] + k[3] * p[3][i]);
};

// Points along the glide, eased in (slow off the mark, fast at the lens), stamped so
// the renderer fades the tail and keeps the head bright.
function fillTrail(view, now) {
  view.trail.length = 0;
  for (let i = 0; i < TRAIL_POINTS; i++) {
    const f = i / (TRAIL_POINTS - 1);
    const [x, y] = bez(PATH, Math.pow(f, 1.35));
    view.trail.push({ x, y, t: now - TRAIL_MS * (1 - f) });
  }
  const last = view.trail[view.trail.length - 1];
  last.x = LENS.x; last.y = LENS.y;
}

// [bezier t, sideways offset bu, size bu]: motes shaken loose along the visible streak.
const SPARKS = [[0.16, 24, 4], [0.3, -22, 5.5], [0.43, 26, 5], [0.55, -28, 7.5], [0.66, 30, 6]];

function twinkle(g, x, y, r) {
  g.beginPath();
  g.moveTo(x, y - r * 2);
  g.quadraticCurveTo(x, y, x + r * 2, y);
  g.quadraticCurveTo(x, y, x, y + r * 2);
  g.quadraticCurveTo(x, y, x - r * 2, y);
  g.quadraticCurveTo(x, y, x, y - r * 2);
  g.fill();
}

// Extra layers under the game's own trail (and under the planchette), so the glide reads
// at cover size: a soft pool of shadow that quiets the letters round the mittens, a mint
// bloom with a bright core along the streak, and a few motes.
function enrichTrail(view) {
  const base = view.drawTrail;
  view.drawTrail = function (g, st, now) {
    const tr = this.trail;
    const bx = st.x, by = st.y + 60;
    const blur = (px) => px * S * this.fit.dpr;   // shadowBlur ignores the transform
    const pool = g.createRadialGradient(bx, by, 80, bx, by, 215);
    pool.addColorStop(0, "rgba(14,12,34,0.62)");
    pool.addColorStop(1, "rgba(14,12,34,0)");
    g.fillStyle = pool;
    g.fillRect(bx - 215, by - 215, 430, 430);
    // The closed ring glows, so the moment of breakaway reads from across the room.
    g.save();
    g.strokeStyle = "rgba(255,201,77,0.55)";
    g.shadowColor = "rgba(255,201,77,0.9)";
    g.shadowBlur = blur(34);
    g.lineWidth = 16;
    g.beginPath(); g.arc(bx, by, 125, 0, Math.PI * 2); g.stroke();
    g.restore();
    if (tr.length > 2) {
      const a = tr[0], b = tr[tr.length - 1];
      const line = (w, c0, c1, c2, blur) => {
        const grad = g.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, c0); grad.addColorStop(0.45, c1); grad.addColorStop(1, c2);
        g.save();
        g.lineCap = "round"; g.lineJoin = "round";
        g.strokeStyle = grad;
        if (blur) { g.shadowColor = "rgba(94,242,208,0.9)"; g.shadowBlur = blur; }
        g.beginPath();
        g.moveTo(a.x, a.y);
        for (let i = 1; i < tr.length; i++) g.lineTo(tr[i].x, tr[i].y);
        g.lineWidth = w;
        g.stroke();
        g.restore();
      };
      line(40, "rgba(94,242,208,0)", "rgba(94,242,208,0.16)", "rgba(94,242,208,0.4)", blur(30));
      base.call(this, g, st, now);
      line(4, "rgba(243,233,210,0)", "rgba(220,255,246,0.45)", "rgba(240,255,250,0.9)", 0);
    } else base.call(this, g, st, now);
    g.save();
    for (const [t, side, r] of SPARKS) {
      const [x0, y0] = bez(PATH, t), [x1, y1] = bez(PATH, t + 0.01);
      const tl = Math.hypot(x1 - x0, y1 - y0) || 1;
      const x = x0 - ((y1 - y0) / tl) * side, y = y0 + ((x1 - x0) / tl) * side;
      g.globalAlpha = 0.45 + 0.55 * t;
      g.drawImage(this.glowMint, x - r * 3, y - r * 3, r * 6, r * 6);
      g.fillStyle = t > 0.4 ? "#F3E9D2" : "#5EF2D0";
      twinkle(g, x, y, r);
    }
    g.restore();
  };
}

function scene() {
  const t = TARGET_BY_KEY[TARGET];
  const dx = t.x - LENS.x, dy = t.y - LENS.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const base = Math.atan2(uy, ux);
  // Four seats push from four sides, each a touch off the true line, like real hands.
  const jitter = [-7, 5, -3, 8];
  const hands = [0, 90, 180, 270].map((angle, i) => {
    const a = base + (jitter[i] * Math.PI) / 180;
    return { angle, colour: i, kind: "human", ux: Math.cos(a), uy: Math.sin(a), m: 1, counted: true, resting: true, mine: false, star: false, status: "ok", hidden: false };
  });
  return {
    x: LENS.x, y: LENS.y, sliding: true, captured: false, stir: false,
    r: 1, dirX: ux, dirY: uy, hasDir: true, dwellKey: null, dwellP: 0,
    glows: [{ key: TARGET, kind: "knower" }], hintStep: 0, hintKey: null, blowing: false,
    hands, ghost: null, ghostColour: 0, pulse: false, startFill: 0,
  };
}

function helperBar(stage, safe, onClose) {
  const bar = el("div", "ghc-help");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Cover helper");
  const info = el("div", "", "");
  const scaleText = el("span");
  info.append(el("b", "", "Cover 1600 × 900"), document.createTextNode(" "), scaleText,
    el("span", "", " · add <b>&amp;clean</b> for a bare frame"));
  const safeBtn = el("button", "", "Safe area");
  safeBtn.type = "button";
  safeBtn.setAttribute("aria-pressed", String(!safe.hidden));
  safeBtn.addEventListener("click", () => {
    const on = safe.hidden;
    safe.hidden = !on;
    safeBtn.setAttribute("aria-pressed", String(on));
  });
  const hide = el("button", "", "Hide");
  hide.type = "button";
  hide.setAttribute("aria-label", "Hide the helper bar");
  hide.addEventListener("click", onClose);
  bar.append(info, safeBtn, hide);
  return { bar, scaleText };
}

/**
 * Replace `root` with the cover stage and draw it.
 * Resolves once the board has settled: { stage, view, hush, destroy }.
 */
export async function renderCover(root = document.body, { clean } = {}) {
  const params = new URLSearchParams(location.search);
  if (clean == null) clean = params.has("clean");
  injectCss();
  injectItalic();
  document.title = "Ghost Hand - cover";
  if (root === document.body) document.body.classList.add("ghc-body");
  root.replaceChildren();

  const stage = el("div", "ghc-stage");
  stage.classList.toggle("ghc-clean", clean);
  stage.setAttribute("role", "img");
  stage.setAttribute("aria-label", "Ghost Hand: four mittens push one planchette toward a glowing letter while Hush the ghost says shh. Push together. Don't talk.");
  const sky = el("div", "ghc-sky");
  const moon = el("div", "ghc-moon");
  const halo = el("div", "ghc-halo");
  const lift = el("div", "ghc-lift");
  const hushBox = el("div", "ghc-hush");
  const cv = el("canvas", "ghc-cv");
  cv.setAttribute("aria-hidden", "true");
  const copy = el("div", "ghc-copy", `
    <h1 class="ghc-mark" aria-label="Ghost Hand"><span>gh<span class="ghc-o"></span>st</span><span class="ghc-l2">hand</span></h1>
    <div class="ghc-rule"></div>
    <p class="ghc-tag">Push together. <em>Don't talk.</em></p>
    <p class="ghc-sub">A silent co-op party game. Every hand on one planchette.</p>`);
  const safe = el("div", "ghc-safe");
  safe.hidden = clean || !params.has("safe");
  stage.append(sky, moon, halo, lift, hushBox, cv, copy, safe);
  root.appendChild(stage);

  // Hush rises from behind the rim: the canvas sits above it and is clear off the board.
  const hush = createHush(hushBox, { size: HUSH_SIZE });
  hush.setExpression("shh");
  const hushX = Math.round(BOARD.x + HUSH_BU_X * S - HUSH_SIZE / 2), hushY = Math.round(BOARD.y - HUSH_SIZE * HUSH_SHOW);
  hushBox.style.left = `${hushX}px`;
  hushBox.style.top = `${hushY}px`;
  const shh = el("p", "ghc-shh", "shh…");
  shh.setAttribute("aria-hidden", "true");
  shh.style.left = `${hushX - 90}px`;
  shh.style.top = `${hushY + 26}px`;
  stage.insertBefore(shh, cv);

  // Scale the fixed 1600 x 900 stage down to fit smaller windows; never up.
  let help = null;
  const fit = () => {
    const vw = innerWidth, vh = innerHeight;
    const k = Math.min(1, vw / W, vh / H);
    const tx = Math.max(0, Math.round((vw - W * k) / 2)), ty = Math.max(0, Math.round((vh - H * k) / 2));
    stage.style.transform = k === 1 ? `translate(${tx}px, ${ty}px)` : `translate(${tx}px, ${ty}px) scale(${k})`;
    if (help) help.scaleText.textContent = `shown at ${Math.round(k * 100)}%`;
  };

  const closeHelp = () => {
    if (!help) return;
    help.bar.remove();
    help = null;
  };
  const onKey = (e) => { if (e.key === "Escape" && help) { e.preventDefault(); closeHelp(); } };
  if (!clean) {
    help = helperBar(stage, safe, closeHelp);
    root.appendChild(help.bar);
    addEventListener("keydown", onKey);
  }
  fit();
  addEventListener("resize", fit);

  await fontsReady();

  const view = new BoardView(cv, { reducedMotion: false });
  view.dust.length = 0;   // drifting motes are for the live board; on a still they read as specks
  enrichTrail(view);
  const st = scene();
  const resize = () => view.resize(W, H, { x: BOARD.x, y: BOARD.y, w: BOARD.w, h: BOARD.w * 0.9 });
  resize();

  // A frozen clock keeps the trail fade and the glow's breath at their best, so every
  // frame (and every screenshot) is the same picture.
  const T = Math.ceil(performance.now() / 1200) * 1200 + 300;   // glow breath at its peak
  const paint = () => { fillTrail(view, T); view.draw(st, T); };
  let raf = 0, timer = 0;
  paint();   // on screen at once, even where rAF sleeps (a background tab)
  await new Promise((done) => {
    const t0 = performance.now();
    let rebaked = false, finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      if (!rebaked) resize();
      paint();
      done();
    };
    const tick = (now) => {
      if (!rebaked && now - t0 > SETTLE_MS / 2) { rebaked = true; resize(); }   // re-bake once fonts are surely in
      paint();
      if (now - t0 < SETTLE_MS) raf = requestAnimationFrame(tick);
      else end();
    };
    raf = requestAnimationFrame(tick);
    timer = setTimeout(end, SETTLE_MS + 1500);
  });
  document.documentElement.dataset.cover = "ready";

  const destroy = () => {
    removeEventListener("resize", fit);
    removeEventListener("keydown", onKey);
    closeHelp();
    hush.destroy();
    stage.remove();
    document.body.classList.remove("ghc-body");
    delete document.documentElement.dataset.cover;
  };
  return { stage, view, hush, destroy };
}
