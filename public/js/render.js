// Ghost Hand - the board, planchette, hands and effects ("Midnight séance" look).
// One static board canvas (drawn once per resize) plus a dynamic layer per frame.

import { BOARD_W, BOARD_H, LETTERS, TARGET_BY_KEY } from "./shared/board.js";

export const PAL = {
  night: "#14122B", face: "#221E45", faceIn: "#2C2757", faceOut: "#191636",
  brass: "#C9A24A", brassHi: "#EBCB78", brassLo: "#8C6B27",
  cream: "#F3E9D2", muted: "#A9A3C9", violet: "#3A3270", violetDeep: "#2B255A",
  gold: "#FFC94D", honey: "#FFC94D", mint: "#5EF2D0", aura: "#5EF2D0",
  board: "#221E45", ink: "#F3E9D2", felt: "#3A3270",
};

// One colour + pattern per seat colour, so seats stay distinct for colour-blind players.
export const SEATS = [
  { name: "Coral", hex: "#FF7A6B", pat: "stripes" },
  { name: "Marigold", hex: "#F5B83D", pat: "dots" },
  { name: "Mint", hex: "#3FBF9F", pat: "stars" },
  { name: "Cornflower", hex: "#5AA9E6", pat: "zigzag" },
  { name: "Lilac", hex: "#A98BE8", pat: "hearts" },
  { name: "Rose", hex: "#F28DB2", pat: "checks" },
];
// Fingertip angles around the body centre (0 = right, y down): humans by colour, then sitters.
export const HUMAN_ANGLES = [150, 30, 195, 345, 110, 70];
export const SITTER_ANGLES = { 7: 240, 8: 300, 9: 270 };

const LETTER_FONT = "'Fraunces', Georgia, 'Times New Roman', serif";
const LETTER_SIZE = 74;    // spec 8.5
const BIG_LETTER_SIZE = 92; // "Big letters" setting
const ARROW_LEN = 120;     // tutorial ghost arrow, bu
const HEART_R = 100;       // heart half-size: about 200 x 190 bu
const LENS_R = 40;
const LENS_MAG = 1.3;
const BODY_DY = 60;        // body centre = lens + (0, 60)
const RING_R = 125;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// The board face colour near (x, y), matching the lamplight gradient in drawBoard,
// so a wobbling letter can cover its static twin without a dark patch.
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const FACE_STOPS = [[0, hexRgb(PAL.faceIn)], [0.6, hexRgb(PAL.face)], [1, hexRgb(PAL.faceOut)]];
function faceAt(x, y) {
  const t = clamp01((Math.hypot(x - BOARD_W / 2, y - BOARD_H * 0.475) - 60) / (BOARD_W * 0.72 - 60));
  const i = t < 0.6 ? 0 : 1;
  const [t0, a] = FACE_STOPS[i], [t1, b] = FACE_STOPS[i + 1];
  const k = (t - t0) / (t1 - t0);
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(",")})`;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Where a mitten at this seat angle sits on the planchette ring, in board units.
// st needs the lens position { x, y }; body centre = lens + (0, 60), ring radius 125.
export function mittenPoint(st, angleDeg) {
  const a = angleDeg * DEG;
  return { x: st.x + Math.cos(a) * RING_R, y: st.y + BODY_DY + Math.sin(a) * RING_R };
}

// A polygon with each corner rounded by its own radius: pts = [[x, y, r], ...].
function roundPoly(g, pts) {
  const n = pts.length;
  const last = pts[n - 1], first = pts[0];
  g.beginPath();
  g.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    g.arcTo(p[0], p[1], q[0], q[1], p[2]);
  }
  g.closePath();
}

// A four-point glint (long rays up/down/left/right).
function glint(g, x, y, R, rot = 0) {
  const r = R * 0.26;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 ? r : R;
    g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  g.closePath();
}

// A soft heart with its point up (the point carries the lens).
export function heartPath(g, r) {
  g.beginPath();
  g.moveTo(0, -r * 0.98);
  g.bezierCurveTo(r * 0.55, -r * 0.92, r * 1.08, -r * 0.2, r * 0.86, r * 0.38);
  g.bezierCurveTo(r * 0.7, r * 0.82, r * 0.28, r * 0.98, 0, r * 0.78);
  g.bezierCurveTo(-r * 0.28, r * 0.98, -r * 0.7, r * 0.82, -r * 0.86, r * 0.38);
  g.bezierCurveTo(-r * 1.08, -r * 0.2, -r * 0.55, -r * 0.92, 0, -r * 0.98);
  g.closePath();
}

function sprite(size, paint) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d"), size);
  return c;
}

function glowSprite(rgb, size = 128) {
  return sprite(size, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, `rgba(${rgb},0.85)`);
    gr.addColorStop(0.45, `rgba(${rgb},0.35)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });
}

function star(g, x, y, R, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  g.closePath();
}

export function patternTile(seat, px = 16) {
  return sprite(px, (g) => {
    g.scale(px / 16, px / 16);
    g.fillStyle = seat.hex;
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 2;
    switch (seat.pat) {
      case "stripes": g.fillRect(0, 2, 16, 3); g.fillRect(0, 10, 16, 3); break;
      case "dots": g.beginPath(); g.arc(4, 4, 2, 0, TAU); g.arc(12, 12, 2, 0, TAU); g.fill(); break;
      case "stars": star(g, 8, 8, 4.5, 2); g.fill(); break;
      case "zigzag": g.beginPath(); g.moveTo(0, 10); g.lineTo(4, 5); g.lineTo(8, 10); g.lineTo(12, 5); g.lineTo(16, 10); g.stroke(); break;
      case "hearts": g.save(); g.translate(8, 8.5); heartPath(g, 4.5); g.restore(); g.fill(); break;
      case "checks": g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8); break;
      default: break;
    }
  });
}

// ---------------------------------------------------------------------------

export class BoardView {
  constructor(canvas, { reducedMotion = false, bigLetters = false } = {}) {
    this.cv = canvas;
    this.g = canvas.getContext("2d");
    this.reduced = reducedMotion;
    this.letterSize = bigLetters ? BIG_LETTER_SIZE : LETTER_SIZE;
    this.arrowState = null; // { t0, ang } while the ghost arrow is showing
    this.fit = { s: 1, ox: 0, oy: 0, dpr: 1, w: 1, h: 1 };
    this.board = null;
    this.trail = [];
    this.fx = [];
    this.dust = [];
    this.lift = 0;
    this.bloomAt = -1e9;
    this.glowHoney = glowSprite("255,201,77");
    this.glowMint = glowSprite("94,242,208");
    this.glowWhite = glowSprite("243,233,210");
    this.shadow = sprite(128, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, "rgba(0,0,0,0.45)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    this.patterns = SEATS.map((s) => patternTile(s));
    this.patternFills = null;
    const r = rng(42);
    for (let i = 0; i < 12; i++) this.dust.push({ u: r(), v: r(), sp: 0.004 + r() * 0.006, ph: r() * TAU, sz: 1 + r() * 2.2 });
  }

  // -------------------------------------------------------------- layout

  // rect: the CSS-pixel box the board must fit inside (within a cssW x cssH canvas).
  resize(cssW, cssH, rect) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(cssW * dpr);
    this.cv.height = Math.round(cssH * dpr);
    const s = Math.min(rect.w / BOARD_W, rect.h / BOARD_H);
    this.fit = { s, dpr, w: cssW, h: cssH, ox: rect.x + (rect.w - BOARD_W * s) / 2, oy: rect.y + (rect.h - BOARD_H * s) / 2 };
    this.board = this.drawBoard();
    this.patternFills = this.patterns.map((p) => this.g.createPattern(p, "repeat"));
  }

  // "Big letters" setting: 92 bu letters instead of 74. Redraws the static board if it exists.
  setBigLetters(on) {
    const size = on ? BIG_LETTER_SIZE : LETTER_SIZE;
    if (size === this.letterSize) return;
    this.letterSize = size;
    if (this.board) this.board = this.drawBoard();
  }
  get bigLetters() { return this.letterSize === BIG_LETTER_SIZE; }

  toScreen(x, y) { return [this.fit.ox + x * this.fit.s, this.fit.oy + y * this.fit.s]; }
  toBoard(sx, sy) { return [(sx - this.fit.ox) / this.fit.s, (sy - this.fit.oy) / this.fit.s]; }
  boardRect() { const { ox, oy, s } = this.fit; return { x: ox, y: oy, w: BOARD_W * s, h: BOARD_H * s }; }
  // Is a board point on the planchette (lens or heart)?
  onPlanchette(bx, by, lx, ly) {
    return Math.hypot(bx - lx, by - (ly + 48)) < HEART_R * 1.05 || Math.hypot(bx - lx, by - ly) < LENS_R + 20;
  }

  // -------------------------------------------------------------- static board

  drawBoard() {
    const { s, dpr } = this.fit;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(BOARD_W * s * dpr));
    c.height = Math.max(1, Math.round(BOARD_H * s * dpr));
    const g = c.getContext("2d");
    g.scale(s * dpr, s * dpr);

    // Brass rim, lit from the top left.
    const rim = g.createLinearGradient(0, 0, BOARD_W, BOARD_H);
    rim.addColorStop(0, PAL.brassHi); rim.addColorStop(0.45, PAL.brass); rim.addColorStop(1, PAL.brassLo);
    g.fillStyle = rim;
    roundRect(g, 0, 0, BOARD_W, BOARD_H, 70);
    g.fill();
    g.strokeStyle = "rgba(255,240,200,0.45)";
    g.lineWidth = 2;
    roundRect(g, 6, 6, BOARD_W - 12, BOARD_H - 12, 64);
    g.stroke();

    // The indigo face, a little lighter in the middle like lamplight.
    const face = g.createRadialGradient(BOARD_W / 2, BOARD_H * 0.45, 60, BOARD_W / 2, BOARD_H * 0.5, BOARD_W * 0.72);
    face.addColorStop(0, PAL.faceIn); face.addColorStop(0.6, PAL.face); face.addColorStop(1, PAL.faceOut);
    g.fillStyle = face;
    roundRect(g, 24, 24, BOARD_W - 48, BOARD_H - 48, 50);
    g.fill();
    g.strokeStyle = "rgba(201,162,74,0.45)";
    g.lineWidth = 3;
    roundRect(g, 44, 44, BOARD_W - 88, BOARD_H - 88, 38);
    g.stroke();
    g.strokeStyle = "rgba(201,162,74,0.18)";
    g.lineWidth = 1.5;
    roundRect(g, 54, 54, BOARD_W - 108, BOARD_H - 108, 32);
    g.stroke();
    // Little gold diamonds at the inner corners.
    g.fillStyle = "rgba(255,201,77,0.55)";
    for (const [cx, cy] of [[60, 60], [BOARD_W - 60, 60], [60, BOARD_H - 60], [BOARD_W - 60, BOARD_H - 60]]) {
      g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx + 9, cy); g.lineTo(cx, cy + 9); g.lineTo(cx - 9, cy); g.closePath(); g.fill();
    }

    // A sprinkle of faint stars.
    const ls = this.letterSize;
    const clear = 62 * Math.max(1, ls / LETTER_SIZE);
    const r = rng(7);
    for (let i = 0; i < 46; i++) {
      const x = 70 + r() * (BOARD_W - 140), y = 70 + r() * (BOARD_H - 140);
      if (LETTERS.some((l) => Math.hypot(l.x - x, l.y - y) < clear)) continue;
      if (Math.abs(x - 500) < 240 && Math.abs(y - 760) < 60) continue;
      if (Math.hypot(x - 150, y - 110) < 90 || Math.hypot(x - 850, y - 110) < 90) continue;
      const big = r() < 0.25;
      g.fillStyle = big ? "rgba(255,201,77,0.28)" : "rgba(243,233,210,0.22)";
      if (big) { star(g, x, y, 9, 3.5); g.fill(); }
      else { g.beginPath(); g.arc(x, y, 1.5 + r() * 1.8, 0, TAU); g.fill(); }
    }

    this.drawSun(g, 150, 88);
    this.drawMoon(g, 850, 88);
    this.drawBanner(g, 500, 760);

    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `650 ${ls}px ${LETTER_FONT}`;
    // A soft gold halo under each letter, then the cream letter.
    g.save();
    g.shadowColor = "rgba(255,201,77,0.35)";
    g.shadowBlur = 18 * (ls / LETTER_SIZE);
    g.fillStyle = PAL.cream;
    for (const l of LETTERS) g.fillText(l.k, l.x, l.y + 3 * (ls / LETTER_SIZE));
    g.restore();
    g.font = `800 ${ls > LETTER_SIZE ? 38 : 32}px 'Nunito', system-ui, sans-serif`;
    g.fillStyle = PAL.muted;
    g.fillText("YES", 150, 164);
    g.fillText("NO", 850, 164);
    return c;
  }

  drawSun(g, x, y) {
    g.save();
    g.translate(x, y);
    g.drawImage(this.glowHoney, -70, -70, 140, 140);
    g.strokeStyle = PAL.gold;
    g.lineWidth = 6;
    g.lineCap = "round";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      g.beginPath(); g.moveTo(Math.cos(a) * 40, Math.sin(a) * 40); g.lineTo(Math.cos(a) * 51, Math.sin(a) * 51); g.stroke();
    }
    g.fillStyle = PAL.gold;
    g.beginPath(); g.arc(0, 0, 32, 0, TAU); g.fill();
    this.face(g, 0, 2, 0.85);
    g.restore();
  }

  drawMoon(g, x, y) {
    g.save();
    g.translate(x, y);
    g.drawImage(this.glowWhite, -64, -64, 128, 128);
    // Draw the crescent on its own canvas, so cutting it out leaves the board untouched.
    const m = sprite(96, (mg) => {
      mg.translate(48, 48);
      mg.fillStyle = PAL.cream;
      mg.beginPath(); mg.arc(0, 0, 36, 0, TAU); mg.fill();
      mg.globalCompositeOperation = "destination-out";
      mg.beginPath(); mg.arc(17, -12, 31, 0, TAU); mg.fill();
      mg.globalCompositeOperation = "source-over";
      mg.strokeStyle = PAL.night; mg.lineWidth = 4; mg.lineCap = "round";
      mg.beginPath(); mg.arc(-15, 2, 6, 0.15 * Math.PI, 0.85 * Math.PI); mg.stroke();
      mg.beginPath(); mg.arc(-12, 15, 5, 0.1 * Math.PI, 0.7 * Math.PI); mg.stroke();
    });
    g.drawImage(m, -48, -48);
    g.fillStyle = "rgba(255,201,77,0.85)";
    star(g, 34, -32, 8, 3.5); g.fill();
    star(g, 44, 6, 5.5, 2.5); g.fill();
    g.restore();
  }

  face(g, x, y, k) {
    g.fillStyle = PAL.night;
    g.beginPath(); g.ellipse(x - 12 * k, y - 6 * k, 3.6 * k, 5 * k, 0, 0, TAU); g.ellipse(x + 12 * k, y - 6 * k, 3.6 * k, 5 * k, 0, 0, TAU); g.fill();
    g.fillStyle = "rgba(247,150,170,0.55)";
    g.beginPath(); g.ellipse(x - 21 * k, y + 6 * k, 6 * k, 4 * k, 0, 0, TAU); g.ellipse(x + 21 * k, y + 6 * k, 6 * k, 4 * k, 0, 0, TAU); g.fill();
    g.strokeStyle = PAL.night; g.lineWidth = 3.5 * k; g.lineCap = "round";
    g.beginPath(); g.arc(x, y + 4 * k, 9 * k, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  }

  // GOODBYE on a ribbon banner, 460 x 90.
  drawBanner(g, x, y) {
    g.save();
    g.translate(x, y);
    const w = 360, h = 74;
    g.fillStyle = PAL.violetDeep;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(sx * (w / 2 - 20), -h / 2 + 14);
      g.lineTo(sx * (w / 2 + 50), -h / 2 + 14);
      g.lineTo(sx * (w / 2 + 30), 6);
      g.lineTo(sx * (w / 2 + 50), h / 2 + 4);
      g.lineTo(sx * (w / 2 - 20), h / 2 + 4);
      g.closePath();
      g.fill();
    }
    g.fillStyle = PAL.violet;
    roundRect(g, -w / 2, -h / 2, w, h, 22);
    g.fill();
    g.strokeStyle = "rgba(255,201,77,0.5)";
    g.lineWidth = 3;
    g.setLineDash([10, 8]);
    roundRect(g, -w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 14);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = PAL.ink;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `650 44px ${LETTER_FONT}`;
    g.fillText("GOODBYE", 0, 3);
    g.restore();
  }

  // A rounded mitten (thumb to one side); w x h bu, pointing "up" before rotation.
  mittenPath(g, x, y, w, h, rot = 0) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.beginPath();
    g.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU);
    g.moveTo(w * 0.5, h * 0.05);
    g.ellipse(w * 0.42, h * 0.02, w * 0.2, h * 0.22, -0.5, 0, TAU);
    g.restore();
  }

  // -------------------------------------------------------------- effects (called by the game)

  breakaway(x, y) {
    this.bloomAt = performance.now();
    this.lift = 1;
    if (this.reduced) return;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + Math.random() * 0.4;
      const sp = 110 + Math.random() * 90;
      this.fx.push({ kind: "mote", t0: performance.now(), dur: 700 + Math.random() * 300, x, y: y + BODY_DY + 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40 });
    }
  }

  ink(key, hex = PAL.honey, sparkle = false) {
    const t = TARGET_BY_KEY[key];
    if (!t) return;
    this.fx.push({ kind: "pop", t0: performance.now(), dur: 560, k: key, x: t.x, y: t.y, c: hex });
    if (sparkle && !this.reduced) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        this.fx.push({ kind: "spark", t0: performance.now(), dur: 650, x: t.x, y: t.y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160 });
      }
    }
  }

  wobble(key) {
    const t = TARGET_BY_KEY[key];
    if (t) this.fx.push({ kind: "wobble", t0: performance.now(), dur: 700, k: key, x: t.x, y: t.y });
  }

  gust(fromX, fromY, toKey) {
    const t = TARGET_BY_KEY[toKey];
    if (!t || this.reduced) return;
    for (let i = 0; i < 14; i++) {
      this.fx.push({ kind: "gust", t0: performance.now() + i * 40, dur: 900, x: fromX + (Math.random() - 0.5) * 80, y: fromY + (Math.random() - 0.5) * 80, tx: t.x, ty: t.y });
    }
  }

  // The gust twist: mint streaks blowing sideways across (x, y) along (dx, dy) (board units).
  wind(x, y, dx, dy) {
    const m = Math.hypot(dx, dy) || 1;
    const ux = dx / m, uy = dy / m;
    const n = this.reduced ? 3 : 9;
    for (let i = 0; i < n; i++) {
      const off = (Math.random() - 0.5) * 220;   // spread across the wind
      const back = 120 + Math.random() * 120;    // start upwind of the planchette
      this.fx.push({
        kind: "wind", t0: performance.now() + (this.reduced ? 0 : i * 45), dur: this.reduced ? 700 : 760 + Math.random() * 260,
        x: x - ux * back - uy * off, y: y - uy * back + ux * off, ux, uy,
        len: 70 + Math.random() * 70, run: this.reduced ? 0 : 260 + Math.random() * 120,
      });
    }
  }

  petals(count = 30, colors = SEATS.map((s) => s.hex)) {
    if (this.reduced) return;
    for (let i = 0; i < count; i++) {
      this.fx.push({ kind: "petal", t0: performance.now() + Math.random() * 900, dur: 2600 + Math.random() * 1400, x: Math.random() * BOARD_W, y: -40 - Math.random() * 200, vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 90, rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 6, c: colors[i % colors.length] });
    }
  }

  clearTrail() { this.trail.length = 0; }

  // -------------------------------------------------------------- frame

  // st: {
  //   x, y, sliding, captured, stir, r, dirX, dirY, hasDir, dwellKey, dwellP,
  //   glows: [{ key, kind: 'knower'|'open'|'hint' }], hintStep, hintKey, blowing,
  //   hands: [{ angle, colour, kind, ux, uy, m, counted, resting, mine, star, status, hidden }],
  //   ghost: { x, y } | null, pulse: bool (planchette outline pulses), startFill: 0..1,
  //   arrow: { x, y, ux, uy, len? } | null  (ghost helper arrow starting just outside x,y along ux,uy; board units)
  // }
  draw(st, now = performance.now()) {
    const g = this.g;
    const { dpr, w, h, s } = this.fit;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (this.board) g.drawImage(this.board, this.fit.ox, this.fit.oy, BOARD_W * s, BOARD_H * s);
    this.drawDust(g, now);
    if (!st) { this.arrowState = null; return; }

    g.save();
    g.translate(this.fit.ox, this.fit.oy);
    g.scale(s, s);

    this.drawTrail(g, st, now);
    this.drawGlows(g, st, now);

    // Dwell: a clock-wipe honey glow around the letter under the lens.
    if (st.dwellKey && TARGET_BY_KEY[st.dwellKey] && st.dwellP > 0.02) {
      const t = TARGET_BY_KEY[st.dwellKey];
      const R = t.k.length > 1 ? 70 : 54;
      g.globalAlpha = 0.55 * st.dwellP;
      g.drawImage(this.glowHoney, t.x - R * 1.3, t.y - R * 1.3, R * 2.6, R * 2.6);
      g.globalAlpha = 1;
      g.strokeStyle = PAL.honey;
      g.lineWidth = 10;
      g.lineCap = "round";
      g.beginPath();
      g.arc(t.x, t.y, R, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(st.dwellP));
      g.stroke();
    }

    this.drawFx(g, now, "under");
    this.drawPlanchette(g, st, now);
    if (st.ghost) this.drawGhostTip(g, st.ghost, st.ghostColour ?? 0, now);
    if (st.arrow) this.drawArrow(g, st.arrow, now);
    else this.arrowState = null;
    this.drawFx(g, now, "over");
    g.restore();
  }

  // Tutorial helper: a soft ghostly mint arrow from just outside (x, y) along (ux, uy).
  // It fades in, eases its heading (so a wandering push does not jitter it) and
  // breathes forward 10 bu every 1.2 s; it holds still under reduced motion.
  drawArrow(g, a, now) {
    const m = Math.hypot(a.ux, a.uy);
    if (!(m > 1e-3) || !Number.isFinite(a.x) || !Number.isFinite(a.y)) { this.arrowState = null; return; }
    const target = Math.atan2(a.uy / m, a.ux / m);
    let as = this.arrowState;
    if (!as) as = this.arrowState = { t0: now, ang: target, last: now };
    else {
      const dt = Math.min(0.1, Math.max(0, (now - as.last) / 1000));
      const d = Math.atan2(Math.sin(target - as.ang), Math.cos(target - as.ang));
      as.ang += this.reduced ? d : d * (1 - Math.exp(-dt * 9));
      as.last = now;
    }
    const ang = as.ang;
    const fade = this.reduced ? 1 : clamp01((now - as.t0) / 320);
    const p = this.reduced ? 0 : ((now - as.t0) % 1200) / 1200;
    const wave = 0.5 - 0.5 * Math.cos(p * TAU); // 0 -> 1 -> 0
    const slide = 10 * wave;
    // ~120 bu, but never shorter than ~48 px on screen so it still reads on a small phone board.
    const base = a.len || ARROW_LEN;
    const L = Math.max(base, 48 / Math.max(0.05, this.fit.s));
    const k = L / ARROW_LEN;
    const gap = 42; // clear of a 50 x 65 mitten
    const hl = 46 * k, hw = 33 * k, sw = 12 * k; // head length, head half-width, shaft half-width

    g.save();
    g.translate(a.x, a.y);
    g.rotate(ang);
    g.translate(gap + slide, 0);
    g.globalAlpha = fade * (0.8 + 0.2 * wave);

    // A soft mint haze under the whole arrow.
    g.save();
    g.globalAlpha *= 0.35;
    g.drawImage(this.glowMint, -20, -hw * 1.6, L + 40, hw * 3.2);
    g.restore();

    roundPoly(g, [
      [0, -sw, sw - 0.5], [L - hl, -sw, 4 * k], [L - hl, -hw, 6 * k], [L, 0, 7 * k],
      [L - hl, hw, 6 * k], [L - hl, sw, 4 * k], [0, sw, sw - 0.5],
    ]);
    g.fillStyle = "rgba(94,242,208,0.22)";
    g.fill();
    g.lineJoin = "round";
    g.lineCap = "round";
    // A faint dark under-stroke keeps the dashes readable over cream letters.
    g.strokeStyle = "rgba(20,18,43,0.45)";
    g.lineWidth = 9 * k;
    g.stroke();
    g.setLineDash([13 * k, 9 * k]);
    g.strokeStyle = PAL.mint;
    g.lineWidth = 5 * k;
    g.stroke();
    g.setLineDash([]);
    // A small bright tip so the direction reads at a glance.
    g.globalAlpha = fade * (0.55 + 0.45 * wave);
    g.drawImage(this.glowWhite, L - 26 * k, -14 * k, 28 * k, 28 * k);
    g.restore();
  }

  drawTrail(g, st, now) {
    const tr = this.trail;
    const last = tr[tr.length - 1];
    if (!last || Math.hypot(last.x - st.x, last.y - st.y) > 2) tr.push({ x: st.x, y: st.y, t: now });
    while (tr.length && now - tr[0].t > 2000) tr.shift();
    if (tr.length < 3) return;
    g.lineCap = "round"; g.lineJoin = "round";
    g.lineWidth = 10;
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1], b = tr[i];
      g.strokeStyle = `rgba(94,242,208,${0.55 * (1 - (now - b.t) / 2000)})`;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
  }

  drawGlows(g, st, now) {
    for (const gl of st.glows || []) {
      const t = TARGET_BY_KEY[gl.key];
      if (!t) continue;
      const breathe = this.reduced ? 1 : 0.86 + 0.14 * Math.sin((now / 1200) * TAU);
      const big = t.k.length > 1 ? 1.5 : 1;
      const lk = this.letterSize / LETTER_SIZE; // 1, or ~1.24 with big letters
      if (gl.kind === "knower") {
        const R = 96 * breathe * big * lk;
        g.globalAlpha = 0.95;
        g.drawImage(this.glowHoney, t.x - R, t.y - R, R * 2, R * 2);
        g.globalAlpha = 1;
        // Underline as well as halo, so colour is never the only cue.
        const uy = t.y + 14 + this.letterSize * 0.4;
        const uw = 24 * big * lk;
        g.strokeStyle = PAL.honey;
        g.lineWidth = 8;
        g.lineCap = "round";
        g.beginPath(); g.moveTo(t.x - uw, uy); g.lineTo(t.x + uw, uy); g.stroke();
      } else {
        const R = 80 * breathe * big * lk;
        g.globalAlpha = gl.kind === "open" ? 0.55 : 0.4;
        g.drawImage(gl.kind === "hint" ? this.glowMint : this.glowHoney, t.x - R, t.y - R, R * 2, R * 2);
        g.globalAlpha = 1;
        if (!this.reduced) this.drawTwinkle(g, t, gl, big * lk, now);
      }
    }
  }

  // A small four-point glint that drifts round a glowing letter and twinkles in and out,
  // with a fainter partner on the far side. Honey for open glows, mint for hints.
  drawTwinkle(g, t, gl, k, now) {
    const hint = gl.kind === "hint";
    const seed = (t.x * 0.013 + t.y * 0.007) % TAU; // neighbours twinkle out of step
    const spin = (now / 3400) * TAU * (hint ? -1 : 1) + seed;
    const rx = 50 * k, ry = 44 * k;
    const col = hint ? PAL.mint : PAL.honey;
    for (let i = 0; i < 2; i++) {
      const a = spin + i * Math.PI * 1.15;
      const tw = Math.sin((now / 900) * TAU * 0.75 + seed + i * 2.1);
      const sc = Math.max(0, tw); // pops in, holds, fades out, rests
      if (sc < 0.03) continue;
      const R = (i ? 10 : 16) * k * (0.35 + 0.65 * sc);
      const x = t.x + Math.cos(a) * rx, y = t.y + Math.sin(a) * ry;
      g.globalAlpha = (i ? 0.55 : 0.9) * sc;
      g.drawImage(this.glowWhite, x - R * 1.4, y - R * 1.4, R * 2.8, R * 2.8);
      g.fillStyle = col;
      glint(g, x, y, R, sc * 0.6);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.beginPath(); g.arc(x, y, R * 0.16, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
  }

  drawDust(g, now) {
    if (this.reduced) return;
    const { w, h } = this.fit;
    // Drifting motes that twinkle like far-off stars.
    for (const d of this.dust) {
      d.u = (d.u + d.sp / 60) % 1.2;
      const x = (d.u - 0.1) * w;
      const y = (d.v * 0.7 + d.u * 0.35) * h + Math.sin(now / 1700 + d.ph) * 8;
      g.fillStyle = `rgba(243,233,210,${0.25 + 0.35 * (0.5 + 0.5 * Math.sin(now / 600 + d.ph * 3))})`;
      g.beginPath(); g.arc(x, y, d.sz, 0, TAU); g.fill();
    }
  }

  drawPlanchette(g, st, now) {
    // Stir: a tremble along the push direction, drawn by the client only.
    let tx = 0, ty = 0;
    if (st.stir && !this.reduced && st.hasDir) {
      const amp = 2 + 8 * clamp01((st.r - 0.35) / 0.65);
      const k = Math.sin((now / 1000) * TAU * 9) * amp;
      tx = st.dirX * k; ty = st.dirY * k;
    }
    const x = st.x + tx, y = st.y + ty;
    const bx = x, by = y + BODY_DY;
    this.lift = Math.max(0, this.lift - 1 / 20);
    const liftK = st.sliding ? 1 : this.lift;
    const scale = 1 + 0.04 * liftK;

    // Shadow (further and softer when sliding).
    const sh = 6 + 8 * liftK;
    const sw = HEART_R * 2.6;
    g.drawImage(this.shadow, bx - sw / 2 + sh, by - sw / 2 + sh, sw, sw);

    this.drawRing(g, bx, by, st, now);

    g.save();
    g.translate(x, y + 48);
    g.scale(scale, scale);
    // Felt feet.
    g.fillStyle = PAL.felt;
    for (const [fx, fy] of [[-58, 40], [58, 40], [0, 72]]) { g.beginPath(); g.ellipse(fx, fy, 16, 10, 0, 0, TAU); g.fill(); }
    // See-through pine body (55%) with a pine-dark outline, so letters stay readable.
    heartPath(g, HEART_R);
    g.fillStyle = "rgba(44,39,92,0.66)";
    g.fill();
    g.strokeStyle = PAL.brass;
    g.lineWidth = 6;
    g.stroke();
    if (st.pulse && !this.reduced) {
      g.strokeStyle = `rgba(255,201,77,${0.5 + 0.5 * Math.sin(now / 260)})`;
      g.lineWidth = 10;
      heartPath(g, HEART_R + 10);
      g.stroke();
    }
    g.strokeStyle = "rgba(235,203,120,0.55)";
    g.lineWidth = 6;
    g.beginPath(); g.arc(-34, -10, 46, 1.15 * Math.PI, 1.6 * Math.PI); g.stroke();
    g.restore();

    // The mint lens magnifies the board under it (decorative).
    const lr = LENS_R * scale;
    g.save();
    g.beginPath(); g.arc(x, y, lr, 0, TAU); g.clip();
    g.fillStyle = PAL.board;
    g.fillRect(x - lr, y - lr, lr * 2, lr * 2);
    if (this.board) {
      const { s, dpr } = this.fit;
      const srcR = lr / LENS_MAG;
      g.drawImage(this.board, (st.x - srcR) * s * dpr, (st.y - srcR) * s * dpr, srcR * 2 * s * dpr, srcR * 2 * s * dpr, x - lr, y - lr, lr * 2, lr * 2);
    }
    g.fillStyle = "rgba(94,242,208,0.12)";
    g.fillRect(x - lr, y - lr, lr * 2, lr * 2);
    g.restore();
    g.strokeStyle = PAL.mint;
    g.lineWidth = 6;
    g.beginPath(); g.arc(x, y, lr, 0, TAU); g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 4;
    g.beginPath(); g.arc(x, y, lr - 9, 1.15 * Math.PI, 1.45 * Math.PI); g.stroke();

    this.drawHands(g, bx, by, st, now);
  }

  // Honey arc centred on the combined push; sweeps 360° x min(1, r) and closes at breakaway.
  drawRing(g, x, y, st, now) {
    g.lineCap = "round";
    g.strokeStyle = "rgba(243,233,210,0.12)";
    g.lineWidth = 8;
    g.beginPath(); g.arc(x, y, RING_R, 0, TAU); g.stroke();

    // Start ring (lobby): fills while every hand rests.
    if (st.startFill > 0) {
      g.strokeStyle = "rgba(255,201,77,0.9)";
      g.lineWidth = 12;
      g.beginPath(); g.arc(x, y, RING_R, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(st.startFill)); g.stroke();
    }

    const r = clamp01(st.r || 0);
    if (st.hasDir && r > 0.02) {
      const dir = Math.atan2(st.dirY, st.dirX);
      const half = Math.PI * r;
      g.strokeStyle = r >= 1 ? "rgba(255,201,77,1)" : "rgba(255,201,77,0.85)";
      g.lineWidth = 12;
      g.beginPath(); g.arc(x, y, RING_R, dir - half, dir + half); g.stroke();
    }

    // Hint step 1: the segment pointing at the target pulses mint for everyone.
    if (st.hintStep >= 1 && st.hintKey && TARGET_BY_KEY[st.hintKey]) {
      const t = TARGET_BY_KEY[st.hintKey];
      const a = Math.atan2(t.y - st.y, t.x - st.x);
      g.strokeStyle = `rgba(94,242,208,${0.45 + 0.4 * Math.sin(now / 220)})`;
      g.lineWidth = 16;
      g.beginPath(); g.arc(x, y, RING_R, a - 0.35, a + 0.35); g.stroke();
    }

    // Breakaway bloom.
    const bt = (now - this.bloomAt) / 280;
    if (bt >= 0 && bt < 1) {
      g.strokeStyle = `rgba(255,201,77,${1 - bt})`;
      g.lineWidth = 14 * (1 - bt) + 2;
      g.beginPath(); g.arc(x, y, RING_R * (1 + 0.15 * bt), 0, TAU); g.stroke();
    }
  }

  // Mittens rest on the ring at their seat angles; a comet trails each push.
  drawHands(g, bx, by, st, now) {
    for (const hnd of st.hands || []) {
      const a = hnd.angle * DEG;
      const rx = bx + Math.cos(a) * RING_R, ry = by + Math.sin(a) * RING_R;
      const sitter = hnd.kind !== "human";
      const hex = hnd.kind === "hush" ? PAL.aura : sitter ? PAL.cream : SEATS[hnd.colour % 6].hex;
      const away = hnd.status === "dozing" || hnd.status === "gone";
      const base = hnd.mine ? 1 : 0.85;
      const showVec = !hnd.hidden && hnd.m > 0.04;

      // Comet: 6 fading dots outward along the push.
      if (showVec && !this.reduced && hnd.resting) {
        const len = 90 * Math.min(1, hnd.m / 0.6);
        for (let k = 1; k <= 6; k++) {
          const d = 30 + (k / 6) * len;
          g.globalAlpha = base * (0.55 - k * 0.075);
          g.fillStyle = sitter ? "rgba(243,233,210,0.9)" : hex;
          g.beginPath(); g.arc(rx + hnd.ux * d, ry + hnd.uy * d, 9 - k * 0.9, 0, TAU); g.fill();
          if (hnd.star && k === 1) { g.strokeStyle = PAL.honey; g.lineWidth = 3; g.stroke(); }
        }
        g.globalAlpha = 1;
      }

      // Honey halo when the hand is counted.
      if (hnd.counted && hnd.resting) {
        g.globalAlpha = 0.6;
        g.drawImage(this.glowHoney, rx - 52, ry - 52, 104, 104);
        g.globalAlpha = 1;
      }

      // Ghost friends are see-through, softly glowing mittens; Hush's hand glows mint.
      if (sitter && hnd.resting && !away) {
        g.globalAlpha = 0.55;
        g.drawImage(hnd.kind === "hush" ? this.glowMint : this.glowWhite, rx - 46, ry - 46, 92, 92);
      }
      g.globalAlpha = base * (away ? 0.4 : 1);
      const rot = showVec ? Math.atan2(hnd.uy, hnd.ux) + Math.PI / 2 : a + Math.PI / 2 + Math.PI;
      this.mittenPath(g, rx, ry, 50, 65, rot);
      if (!hnd.resting) {
        g.setLineDash([7, 7]);
        g.strokeStyle = sitter ? "rgba(243,233,210,0.45)" : hex;
        g.lineWidth = 4;
        g.stroke();
        g.setLineDash([]);
      } else if (sitter) {
        g.fillStyle = hnd.kind === "hush" ? "rgba(94,242,208,0.35)" : "rgba(243,233,210,0.28)";
        g.fill();
        g.strokeStyle = hnd.kind === "hush" ? PAL.mint : "rgba(243,233,210,0.9)";
        g.lineWidth = 3;
        g.stroke();
      } else {
        g.fillStyle = this.patternFills ? this.patternFills[hnd.colour % 6] : hex;
        g.fill();
        g.strokeStyle = hnd.counted ? PAL.honey : "rgba(255,255,255,0.95)";
        g.lineWidth = hnd.mine ? 6 : 4;
        g.stroke();
      }
      if (hnd.star) { g.fillStyle = PAL.honey; star(g, rx, ry, 11, 4.5); g.fill(); g.strokeStyle = PAL.night; g.lineWidth = 1.5; g.stroke(); }
      if (away && !this.reduced) {
        g.fillStyle = PAL.ink;
        g.font = `800 22px 'Nunito', sans-serif`;
        g.textAlign = "center";
        g.fillText("z z", rx + 26, ry - 30 - 4 * Math.sin(now / 400));
      }
      g.globalAlpha = 1;
    }
  }

  // Laptop hover: your ghost fingertip follows the cursor (preview only).
  drawGhostTip(g, p, colour, now) {
    g.globalAlpha = 0.5 + 0.15 * Math.sin(now / 300);
    this.mittenPath(g, p.x, p.y, 40, 52, 0);
    g.fillStyle = "rgba(243,233,210,0.3)";
    g.fill();
    g.setLineDash([6, 6]);
    g.strokeStyle = SEATS[colour % 6].hex;
    g.lineWidth = 4;
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  drawFx(g, now, layer) {
    let n = 0;
    for (let i = 0; i < this.fx.length; i++) if (now - this.fx[i].t0 < this.fx[i].dur) this.fx[n++] = this.fx[i];
    this.fx.length = n;
    for (const f of this.fx) {
      const t = (now - f.t0) / f.dur;
      if (t < 0) continue;
      if (layer === "over" && f.kind === "mote") {
        const k = (now - f.t0) / 1000;
        g.globalAlpha = 1 - t;
        g.drawImage(this.glowMint, f.x + f.vx * k - 14, f.y + f.vy * k + 60 * k * k - 14, 28, 28);
        g.globalAlpha = 1;
      } else if (layer === "over" && f.kind === "spark") {
        const k = (now - f.t0) / 1000;
        g.globalAlpha = 1 - t;
        g.fillStyle = PAL.honey;
        star(g, f.x + f.vx * k, f.y + f.vy * k, 12 * (1 - t) + 3, 5 * (1 - t) + 1.5);
        g.fill();
        g.globalAlpha = 1;
      } else if (layer === "over" && f.kind === "gust") {
        const e = t * t * (3 - 2 * t);
        const gx = f.x + (f.tx - f.x) * e, gy = f.y + (f.ty - f.y) * e;
        g.globalAlpha = (1 - t) * 0.8;
        g.drawImage(this.glowWhite, gx - 22, gy - 22, 44, 44);
        g.drawImage(this.glowMint, gx - 14, gy - 14, 28, 28);
        g.globalAlpha = 1;
      } else if (layer === "over" && f.kind === "wind") {
        const e = 1 - (1 - t) * (1 - t);
        const hx = f.x + f.ux * f.run * e, hy = f.y + f.uy * f.run * e;
        const tx = hx - f.ux * f.len, ty = hy - f.uy * f.len;
        g.save();
        g.globalAlpha = Math.sin(Math.PI * Math.min(1, t)) * 0.85;
        g.lineCap = "round";
        g.strokeStyle = "#5EF2D0";
        g.lineWidth = 5;
        g.beginPath(); g.moveTo(tx, ty);
        // a little curl in the middle of each streak
        g.quadraticCurveTo((hx + tx) / 2 - f.uy * 14, (hy + ty) / 2 + f.ux * 14, hx, hy);
        g.stroke();
        g.globalAlpha *= 0.5;
        g.strokeStyle = "#FFFFFF";
        g.lineWidth = 2;
        g.stroke();
        g.restore();
      } else if (layer === "over" && f.kind === "pop") {
        const sc = 1 + 0.5 * easeOutBack(Math.min(1, t * 1.6)) * (1 - t);
        g.save();
        g.translate(f.x, f.y);
        g.scale(sc, sc);
        g.globalAlpha = 1 - t * 0.8;
        const pk = this.letterSize / LETTER_SIZE;
        g.drawImage(this.glowHoney, -80 * pk, -80 * pk, 160 * pk, 160 * pk);
        g.fillStyle = PAL.ink;
        g.font = `650 ${this.letterSize}px ${LETTER_FONT}`;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(f.k.length === 1 ? f.k : "", 0, 3 * pk);
        g.restore();
        g.globalAlpha = 1;
      } else if (layer === "over" && f.kind === "wobble") {
        g.save();
        g.translate(f.x, f.y);
        g.rotate(Math.sin(t * Math.PI * 4) * 4 * DEG * 1.4 * (1 - t * 0.5));
        const wk = this.letterSize / LETTER_SIZE;
        // Cover the static letter with the face colour at this spot, then draw it tilted.
        g.fillStyle = faceAt(f.x, f.y);
        g.beginPath(); g.arc(0, 0, 40 * wk, 0, TAU); g.fill();
        g.fillStyle = PAL.ink;
        g.font = `650 ${this.letterSize}px ${LETTER_FONT}`;
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(f.k.length === 1 ? f.k : "", 0, 3 * wk);
        g.restore();
      } else if (layer === "over" && f.kind === "petal") {
        const k = (now - f.t0) / 1000;
        g.save();
        g.translate(f.x + f.vx * k + Math.sin(k * 2 + f.rot) * 30, f.y + f.vy * k);
        g.rotate(f.rot + f.spin * k);
        g.globalAlpha = t > 0.8 ? (1 - t) * 5 : 1;
        g.fillStyle = f.c;
        g.beginPath(); g.ellipse(0, 0, 11, 6, 0, 0, TAU); g.fill();
        g.restore();
        g.globalAlpha = 1;
      }
    }
  }
}
