// Ghost Hand - the share card (spec §6.4): a 1080 x 1350 PNG drawn in the browser in the
// "Midnight séance" look, plus a preview sheet to share it, save it, send it or copy it.
//
//   renderShareCard(rev, { you, url })            -> Promise<{ canvas, blob }>
//   openSharePreview(rev, { you, url, shareUrl }) -> { el, close, ready }
//   closeSharePreview()                           -> closes the sheet if it is open
//   makeShareCard(rev, opts)                      -> openSharePreview (kept for app.js)
//
// The sheet's labels come from i18n.js (t()); the card image itself stays English.
// "Save replay GIF" lazy-loads gifreplay.js and makes a looping GIF of the table's path
// (shared as a file where the Web Share API takes files, downloaded otherwise).
//
// The card never carries the room code: `url` should be a bare host (location.host).

import { SEATS, heartPath } from "./render.js";
import { LETTERS } from "./shared/board.js";
import { get, subscribe } from "./settings.js";
import { t } from "./i18n.js";

// Reduce motion: the in-app setting (settings.js), the device setting, or #app.reduce-motion.
// Overlays live outside #app, so the choice also goes on <html> as .gh-reduce for the CSS.
const osReduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const reducedMotion = () => !!get("reducedMotion") || osReduced() || !!document.getElementById("app")?.classList.contains("reduce-motion");
function syncReduce() { try { document.documentElement.classList.toggle("gh-reduce", reducedMotion()); } catch {} }
subscribe((_, key) => { if (key === "reducedMotion") queueMicrotask(syncReduce); });

const W = 1080, H = 1350;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const DISPLAY = "Fraunces, Georgia, 'Times New Roman', serif";
const UI = "Nunito, system-ui, -apple-system, 'Segoe UI', sans-serif";

const C = {
  night: "#14122B", night2: "#1B1838", card: "#221E45", card2: "#2A2552", violet: "#3A3270",
  cream: "#F3E9D2", muted: "#A9A3C9", gold: "#FFC94D", brass: "#C9A24A", brassHi: "#EBCB78",
  brassLo: "#8C6B27", mint: "#5EF2D0",
};
const GHOST_FRIEND = "#CBB8FF";

// The brass frame. Hush peeks over its top edge.
const FX = 60, FY = 214, FW = 960, FH = 976, FR = 56; // bottom edge at 1190
const TEXT_W = 840;                                     // widest line inside the frame

// Hush, ported from hush.js (100 x 100 box): mochi body, plum eyes, rosy cheeks, mint halo.
const HUSH = {
  ink: "#3B2F5C", cheek: "#F7B7C3", tongue: "#F29BB0", aura: "#B8E6E1",
  body: "M50 8C75.5 8 92.5 26 92.5 50C92.5 64 91.3 74 89.8 82H10.2C8.7 74 7.5 64 7.5 50C7.5 26 24.5 8 50 8Z",
  arm: "M-0.79 -3.41L6.32 -5.06A5.2 5.2 0 1 1 6.32 5.06L-0.79 3.41A3.5 3.5 0 0 1 -0.79 -3.41Z" +
    "M3.81 -4.17A2 2 0 1 1 7.81 -4.17A2 2 0 1 1 3.81 -4.17Z",
  smile: "M-3.6 -.6Q0 1.2 3.6 -.6Q3.3 3.8 0 3.8Q-3.3 3.8 -3.6 -.6Z",
  peek: 0.62, // share of the box above the frame edge: a little below the cheeks
};
// In hush.js's "grip" pose the mitten centre lands 10.5 units above the shoulder; lift the
// shoulder so the mittens sit right on the frame's edge.
const GRIP_DY = HUSH.peek * 100 - 2.5 - 48.5;

// ------------------------------------------------------------ small helpers

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; }
function mix(hexA, hexB, t) {
  const a = rgb(hexA), b = rgb(hexB);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

function seatHex(colour) {
  return Number.isInteger(colour) && colour >= 0 ? SEATS[colour % SEATS.length].hex : GHOST_FRIEND;
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

function starPath(g, x, y, R, r, points = 5) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rad = i % 2 ? r : R;
    g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  g.closePath();
}

// A soft four-point sparkle.
function sparkle(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x, y, x + s, y);
  g.quadraticCurveTo(x, y, x, y + s);
  g.quadraticCurveTo(x, y, x - s, y);
  g.quadraticCurveTo(x, y, x, y - s);
  g.closePath();
}

// Greedy line breaks over item widths -> [[start, end), ...].
function greedyLines(ws, space, maxW) {
  const out = [];
  let start = 0, w = 0;
  for (let i = 0; i < ws.length; i++) {
    const add = i > start ? space + ws[i] : ws[i];
    if (i > start && w + add > maxW) { out.push([start, i]); start = i; w = ws[i]; } else w += add;
  }
  if (ws.length) out.push([start, ws.length]);
  return out;
}

// Same number of lines as greedy, but as even as possible (no lonely last word).
function balancedLines(ws, space, maxW) {
  const base = greedyLines(ws, space, maxW);
  if (base.length < 2) return base;
  let lo = Math.max(...ws), hi = maxW;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (greedyLines(ws, space, mid).length <= base.length) hi = mid; else lo = mid;
  }
  return greedyLines(ws, space, hi);
}

function wrapWords(g, text, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const ranges = balancedLines(words.map((w) => g.measureText(w).width), g.measureText(" ").width, maxW);
  return ranges.map(([a, b]) => words.slice(a, b).join(" "));
}

// Small caps by hand (canvas has no portable font-variant): each word's first letter at
// full size, the rest as smaller capitals, with a little tracking. Returns the width.
function smallCaps(g, text, x, y, size, { align = "center", weight = 800, family = UI, track = 0.09, draw = true } = {}) {
  const glyphs = [];
  let start = true;
  for (const ch of String(text)) {
    const s = start && ch !== " " ? size : Math.round(size * 0.8);
    glyphs.push({ ch: ch.toUpperCase(), s });
    start = ch === " " || ch === "-";
  }
  let width = 0;
  for (const p of glyphs) {
    g.font = `${weight} ${p.s}px ${family}`;
    p.w = g.measureText(p.ch).width;
    width += p.w;
  }
  const gap = size * track;
  width += gap * Math.max(0, glyphs.length - 1);
  if (!draw) return width;
  let cx = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  const prevAlign = g.textAlign;
  g.textAlign = "left";
  for (const p of glyphs) {
    g.font = `${weight} ${p.s}px ${family}`;
    g.fillText(p.ch, cx, y);
    cx += p.w + gap;
  }
  g.textAlign = prevAlign;
  return width;
}

async function fontsReady() {
  if (!document.fonts || !document.fonts.load) return;
  const sample = "Ghost Hand AZ az";
  const want = ["700 80px Fraunces", "800 80px Fraunces", "600 40px Fraunces", "800 30px Nunito"];
  const all = Promise.all(want.map((f) => document.fonts.load(f, sample).catch(() => null)));
  // Never hang on a slow or offline font: draw with the fallbacks after a moment.
  await Promise.race([all, new Promise((r) => setTimeout(r, 2500))]);
}

function fmtTime(secs) {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function niceDate(d = new Date()) {
  try { return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch { return isoDate(d); }
}

// Slot words inside the frame text, in order (the same matching the reveal sheet uses).
function sentenceTokens(rev) {
  const words = rev.words || [];
  let k = 0;
  return String(rev.frameText || "").trim().split(/\s+/).filter(Boolean).map((t) => {
    const w = words[k];
    if (w && t.replace(/[^A-Z]/g, "") === w.w) { k++; return { t, slot: w }; }
    return { t, slot: null };
  });
}

// ------------------------------------------------------------ the sky and the frame

function drawSky(g, rnd) {
  g.fillStyle = C.night;
  g.fillRect(0, 0, W, H);
  const glow = (x, y, r, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  glow(540, -40, 760, "rgba(94,242,208,0.13)");
  glow(120, 1240, 620, "rgba(58,50,112,0.55)");
  glow(1000, 760, 520, "rgba(169,139,232,0.10)");

  for (let i = 0; i < 170; i++) {
    const x = rnd() * W, y = rnd() * H, big = rnd() < 0.12;
    g.fillStyle = `rgba(243,233,210,${(0.14 + rnd() * (big ? 0.6 : 0.35)).toFixed(2)})`;
    g.beginPath(); g.arc(x, y, big ? 1.6 + rnd() * 1.2 : 0.6 + rnd() * 1.1, 0, TAU); g.fill();
  }
  // Sparkles only in open sky: not on the frame, Hush, the moon or the footer text.
  const busy = (x, y) => (x > FX - 24 && x < FX + FW + 24 && y > FY - 24 && y < FY + FH + 24) ||
    (x > 360 && x < 720 && y < FY) || (x < 220 && y < 190) || (x > 250 && x < 830 && y > 1200);
  for (let n = 0, tries = 0; n < 12 && tries < 200; tries++) {
    const x = 24 + rnd() * (W - 48), y = 24 + rnd() * (H - 48);
    const gold = rnd() < 0.5, a = 0.3 + rnd() * 0.35, s = 5 + rnd() * 9;
    if (busy(x, y)) continue;
    g.fillStyle = gold ? `rgba(255,201,77,${a.toFixed(2)})` : `rgba(243,233,210,${(a - 0.05).toFixed(2)})`;
    sparkle(g, x, y, s);
    g.fill();
    n++;
  }

  // A crescent moon, top left, in a soft halo.
  const mx = 128, my = 104, mr = 32;
  glow(mx, my, 110, "rgba(255,214,140,0.16)");
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  g.arc(mx + 14, my - 9, mr * 0.86, 0, TAU);
  g.clip("evenodd");
  g.fillStyle = "#F7E7BE";
  g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
  g.restore();
}

function drawFrame(g, rnd) {
  // Shadow and the indigo card (opaque, so Hush hides behind it).
  g.save();
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowBlur = 50;
  g.shadowOffsetY = 18;
  const fill = g.createLinearGradient(0, FY, 0, FY + FH);
  fill.addColorStop(0, C.card2);
  fill.addColorStop(0.55, C.card);
  fill.addColorStop(1, C.night2);
  g.fillStyle = fill;
  roundRect(g, FX, FY, FW, FH, FR);
  g.fill();
  g.restore();

  g.save();
  roundRect(g, FX, FY, FW, FH, FR);
  g.clip();
  const moon = g.createRadialGradient(540, FY, 0, 540, FY, 520);
  moon.addColorStop(0, "rgba(94,242,208,0.14)");
  moon.addColorStop(1, "rgba(94,242,208,0)");
  g.fillStyle = moon;
  g.fillRect(FX, FY, FW, 560);
  for (let i = 0; i < 46; i++) {
    g.fillStyle = `rgba(243,233,210,${(0.05 + rnd() * 0.12).toFixed(2)})`;
    g.beginPath(); g.arc(FX + rnd() * FW, FY + rnd() * FH, 0.6 + rnd() * 1.3, 0, TAU); g.fill();
  }
  g.restore();

  // Brass rim and a fine inner line.
  const rim = g.createLinearGradient(FX, FY, FX + FW, FY + FH);
  rim.addColorStop(0, C.brassHi);
  rim.addColorStop(0.45, C.brass);
  rim.addColorStop(0.7, C.brassHi);
  rim.addColorStop(1, C.brassLo);
  g.strokeStyle = rim;
  g.lineWidth = 7;
  roundRect(g, FX, FY, FW, FH, FR);
  g.stroke();
  g.strokeStyle = "rgba(235,203,120,0.30)";
  g.lineWidth = 2;
  roundRect(g, FX + 16, FY + 16, FW - 32, FH - 32, FR - 14);
  g.stroke();

  // Brass sparkles in the corners.
  g.fillStyle = "rgba(235,203,120,0.75)";
  for (const [x, y] of [[FX + 40, FY + 40], [FX + FW - 40, FY + 40], [FX + 40, FY + FH - 40], [FX + FW - 40, FY + FH - 40]]) {
    sparkle(g, x, y, 9);
    g.fill();
  }
}

// ------------------------------------------------------------ Hush

function hushSpace(g, cx, cutY, S) {
  g.translate(cx - S / 2, cutY - HUSH.peek * S);
  g.scale(S / 100, S / 100);
}

function drawHushBody(g, cx, cutY, S) {
  const body = new Path2D(HUSH.body);
  g.save();
  const gy = cutY - S * 0.2;
  const glow = g.createRadialGradient(cx, gy, S * 0.1, cx, gy, S * 0.95);
  glow.addColorStop(0, "rgba(94,242,208,0.32)");
  glow.addColorStop(0.5, "rgba(94,242,208,0.10)");
  glow.addColorStop(1, "rgba(94,242,208,0)");
  g.fillStyle = glow;
  g.fillRect(cx - S, gy - S, S * 2, S * 2);

  hushSpace(g, cx, cutY, S);
  g.lineJoin = "round";
  // Mint halo, then a slim rim, then the white mochi.
  g.shadowColor = "rgba(94,242,208,0.85)";
  g.shadowBlur = S * 0.14;
  g.fillStyle = "rgba(184,230,225,0.45)";
  g.strokeStyle = "rgba(184,230,225,0.45)";
  g.lineWidth = 7;
  g.fill(body);
  g.stroke(body);
  g.shadowBlur = 0;
  g.fillStyle = HUSH.aura;
  g.strokeStyle = HUSH.aura;
  g.lineWidth = 2.2;
  g.fill(body);
  g.stroke(body);
  const skin = g.createRadialGradient(44, 40, 0, 44, 40, 60);
  skin.addColorStop(0.6, "#FFFFFF");
  skin.addColorStop(1, "#DFF3F0");
  g.fillStyle = skin;
  g.fill(body);

  // Rosy cheeks.
  g.fillStyle = rgba(HUSH.cheek, 0.65);
  for (const x of [27.5, 72.5]) { g.beginPath(); g.ellipse(x, 47.5, 6, 3.4, 0, 0, TAU); g.fill(); }
  // Oval plum eyes with two catchlights each.
  for (const x of [37, 63]) {
    g.fillStyle = HUSH.ink;
    g.beginPath(); g.ellipse(x, 41, 4.6, 6, 0, 0, TAU); g.fill();
    g.fillStyle = "#FFFFFF";
    g.beginPath(); g.arc(x + 1.5, 41 - 2.4, 1.7, 0, TAU); g.fill();
    g.beginPath(); g.arc(x - 1.6, 41 + 2.7, 0.8, 0, TAU); g.fill();
  }
  // A small smile.
  g.translate(50, 46.5);
  g.fillStyle = HUSH.ink;
  g.fill(new Path2D(HUSH.smile));
  g.fillStyle = HUSH.tongue;
  g.beginPath(); g.ellipse(0, 2.6, 1.6, 0.9, 0, 0, TAU); g.fill();
  g.restore();
}

// Two mittens gripping the frame's edge, drawn over the brass.
function drawHushMittens(g, cx, cutY, S) {
  const arm = new Path2D(HUSH.arm);
  g.save();
  g.beginPath();
  g.rect(cx - S, cutY - S, S * 2, S + 6);
  g.clip();
  hushSpace(g, cx, cutY, S);
  g.lineJoin = "round";
  for (const side of [-1, 1]) {
    g.save();
    g.translate(side > 0 ? 86.3 : 13.7, 59 + GRIP_DY);
    g.scale(side, 1);
    g.translate(-2.2, -3.11);
    g.rotate(-100 * DEG);
    g.fillStyle = "rgba(184,230,225,0.4)";
    g.strokeStyle = "rgba(184,230,225,0.4)";
    g.lineWidth = 4.4;
    g.fill(arm); g.stroke(arm);
    g.fillStyle = HUSH.aura;
    g.strokeStyle = HUSH.aura;
    g.lineWidth = 2;
    g.fill(arm); g.stroke(arm);
    const mitt = g.createRadialGradient(6, -1.5, 0, 7, 0, 7);
    mitt.addColorStop(0.55, "#FFFFFF");
    mitt.addColorStop(1, "#DDF3F0");
    g.fillStyle = mitt;
    g.fill(arm);
    g.restore();
  }
  g.restore();
}

// ------------------------------------------------------------ the words

function drawQuestion(g, ask, top) {
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = rgba(C.gold, 0.9);
  smallCaps(g, "Hush asked", 540, top, 24, { track: 0.16 });
  if (!ask) return top + 8;
  let size = 42;
  let lines = [];
  for (; size >= 32; size -= 2) {
    g.font = `600 ${size}px ${DISPLAY}`;
    lines = wrapWords(g, `“${ask}”`, TEXT_W - 40);
    if (lines.length <= 2) break;
  }
  size = Math.max(size, 32);
  g.font = `600 ${size}px ${DISPLAY}`;
  lines = lines.slice(0, 3);
  g.fillStyle = rgba(C.cream, 0.9);
  let y = top + 20 + size * 1.02;
  for (const l of lines) { g.fillText(l, 540, y); y += size * 1.2; }
  return y - size * 1.2 + size * 0.28;
}

function drawOrnament(g, y) {
  for (const dir of [-1, 1]) {
    const gr = g.createLinearGradient(540 + dir * 24, 0, 540 + dir * 170, 0);
    gr.addColorStop(0, rgba(C.brassHi, 0.8));
    gr.addColorStop(1, rgba(C.brassHi, 0));
    g.strokeStyle = gr;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(540 + dir * 24, y); g.lineTo(540 + dir * 170, y); g.stroke();
    g.fillStyle = rgba(C.brassHi, 0.6);
    g.beginPath(); g.arc(540 + dir * 186, y, 2.5, 0, TAU); g.fill();
  }
  g.fillStyle = C.gold;
  g.save();
  g.shadowColor = "rgba(255,201,77,0.7)";
  g.shadowBlur = 12;
  sparkle(g, 540, y, 12);
  g.fill();
  g.restore();
}

// Pick the largest type size that fits the sentence in the box: 96 down to 46 px in up to
// 5 lines, then (long 5-6 player sentences) down to 30 px in up to 7 lines. When nothing
// fits, return the layout that overflows least.
function layoutSentence(g, toks, you, maxH) {
  let best = null, bestOver = Infinity;
  for (let size = 96; size >= 30; size -= 2) {
    const nameSize = Math.round(size >= 46 ? clamp(size * 0.3, 20, 27) : clamp(size * 0.42, 16, 20));
    g.font = `700 ${size}px ${DISPLAY}`;
    const space = g.measureText(" ").width * 1.15;
    const cells = toks.map((tk) => {
      g.font = `700 ${size}px ${DISPLAY}`;
      const ww = g.measureText(tk.t).width;
      let name = "", nw = 0;
      if (tk.slot) {
        name = you != null && tk.slot.seat === you ? "me" : (tk.slot.name || "ghost friend");
        nw = smallCaps(g, name, 0, 0, nameSize, { draw: false });
      }
      return { ...tk, ww, nw, name, w: Math.max(ww, nw) };
    });
    const lines = balancedLines(cells.map((c) => c.w), space, TEXT_W).map(([a, b]) => {
      const cs = cells.slice(a, b);
      return { cells: cs, w: cs.reduce((s, c) => s + c.w, 0) + space * (cs.length - 1) };
    });
    const gap = size * 0.16;
    for (const l of lines) l.h = size * 1.0 + (l.cells.some((c) => c.slot) ? nameSize + 22 : 0);
    const total = lines.reduce((a, l) => a + l.h, 0) + gap * Math.max(0, lines.length - 1);
    const widest = Math.max(0, ...cells.map((c) => c.w));
    const lay = { size, nameSize, space, lines, gap, total };
    const over = Math.max(0, total - maxH) + Math.max(0, widest - TEXT_W) * 4;
    if (over === 0 && lines.length <= (size >= 46 ? 5 : 7)) return lay;
    if (over < bestOver) { best = lay; bestOver = over; }
  }
  return best;
}

function drawSentence(g, lay, top) {
  const { size, nameSize, space, lines, gap } = lay;
  let y = top;
  g.textBaseline = "alphabetic";
  g.textAlign = "center";
  for (const line of lines) {
    let x = 540 - line.w / 2;
    const base = y + size * 0.8;
    for (const c of line.cells) {
      const mid = x + c.w / 2;
      g.font = `700 ${size}px ${DISPLAY}`;
      if (c.slot) {
        const hex = seatHex(c.slot.colour);
        const ink = mix(hex, C.cream, 0.28);
        // Glow, the word, an ink underline, then the author's name in small caps.
        g.save();
        g.shadowColor = rgba(hex, 0.95);
        g.shadowBlur = size * 0.45;
        g.fillStyle = ink;
        g.fillText(c.t, mid, base);
        g.restore();
        g.fillStyle = ink;
        g.fillText(c.t, mid, base);
        g.strokeStyle = rgba(hex, 0.75);
        g.lineCap = "round";
        g.lineWidth = Math.max(3, size * 0.05);
        const uw = c.ww * 0.92, uy = base + size * 0.14;
        g.beginPath();
        g.moveTo(mid - uw / 2, uy);
        g.quadraticCurveTo(mid, uy + size * 0.06, mid + uw / 2, uy - size * 0.02);
        g.stroke();
        g.fillStyle = mix(hex, C.cream, 0.15);
        smallCaps(g, c.name, mid, uy + 12 + nameSize * 0.85, nameSize, { track: 0.1 });
      } else {
        g.fillStyle = C.cream;
        g.fillText(c.t, mid, base);
      }
      x += c.w + space;
    }
    y += line.h + gap;
  }
}

// ------------------------------------------------------------ the table's path

function drawSignature(g, rev, box) {
  const raw = Array.isArray(rev.path) ? rev.path : [];
  const pts = [];
  for (const p of raw) {
    if (!Array.isArray(p)) continue;
    const x = +p[0], y = +p[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(x - last[0], y - last[1]) < 3 && last[2] === p[2]) continue;
    pts.push([x, y, p[2]]);
  }
  if (pts.length < 2) return false;

  // Frame the letters plus wherever the path wandered; allow a little horizontal stretch.
  let x0 = 100, x1 = 900, y0 = 300, y1 = 615;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  x0 -= 40; x1 += 40; y0 -= 46; y1 += 40;
  const bw = x1 - x0, bh = y1 - y0;
  let sy = box.h / bh;
  const sx = Math.min(box.w / bw, sy * 1.8);
  sy = Math.min(sy, sx);
  const ox = box.x + (box.w - bw * sx) / 2, oy = box.y + (box.h - bh * sy) / 2;
  const P = (x, y) => [ox + (x - x0) * sx, oy + (y - y0) * sy];

  // A mini board under the doodle.
  g.save();
  roundRect(g, box.x, box.y, box.w, box.h, 26);
  g.fillStyle = "rgba(20,18,43,0.42)";
  g.fill();
  g.strokeStyle = "rgba(201,162,74,0.22)";
  g.lineWidth = 1.5;
  g.stroke();
  g.clip();

  g.font = `700 ${Math.round(clamp(sy * 56, 13, 26))}px ${DISPLAY}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(243,233,210,0.13)";
  for (const L of LETTERS) { const [px, py] = P(L.x, L.y); g.fillText(L.k, px, py); }

  const line = new Path2D();
  const sp = pts.map(([x, y]) => P(x, y));
  line.moveTo(sp[0][0], sp[0][1]);
  for (let i = 1; i < sp.length - 1; i++) {
    const mx = (sp[i][0] + sp[i + 1][0]) / 2, my = (sp[i][1] + sp[i + 1][1]) / 2;
    line.quadraticCurveTo(sp[i][0], sp[i][1], mx, my);
  }
  line.lineTo(sp[sp.length - 1][0], sp[sp.length - 1][1]);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "rgba(94,242,208,0.12)";
  g.lineWidth = 12;
  g.stroke(line);
  g.save();
  g.shadowColor = "rgba(94,242,208,0.9)";
  g.shadowBlur = 12;
  g.strokeStyle = "rgba(94,242,208,0.72)";
  g.lineWidth = 3;
  g.stroke(line);
  g.restore();

  // A dot in the author's colour where each word began.
  const words = rev.words || [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && pts[i][2] === pts[i - 1][2]) continue;
    const w = words[pts[i][2]];
    const [px, py] = sp[i];
    g.fillStyle = w ? seatHex(w.colour) : C.cream;
    g.strokeStyle = C.night;
    g.lineWidth = 3;
    g.beginPath(); g.arc(px, py, 7, 0, TAU); g.fill(); g.stroke();
  }
  // And the little planchette where it came to rest.
  const [ex, ey] = sp[sp.length - 1];
  g.save();
  g.translate(ex, ey + 14);
  heartPath(g, 20);
  g.fillStyle = "rgba(44,39,87,0.9)";
  g.fill();
  g.strokeStyle = C.gold;
  g.lineWidth = 2;
  g.stroke();
  g.beginPath(); g.arc(0, -11, 6.5, 0, TAU);
  g.fillStyle = C.night; g.fill();
  g.strokeStyle = C.mint; g.stroke();
  g.restore();
  g.restore();
  return true;
}

// ------------------------------------------------------------ the footer bits

function drawStars(g, st, y) {
  const items = [["swift", "Swift"], ["steady", "Steady"], ["sure", "Sure"]];
  const R = 17, gapIcon = 12, gapItem = 48;
  g.font = `800 32px ${UI}`;
  const widths = items.map(([, l]) => R * 2 + gapIcon + g.measureText(l).width);
  let x = 540 - (widths.reduce((a, b) => a + b, 0) + gapItem * (items.length - 1)) / 2;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  items.forEach(([k, label], i) => {
    const got = !!st[k];
    g.save();
    starPath(g, x + R, y - 11, R, R * 0.46);
    g.lineJoin = "round";
    if (got) {
      g.shadowColor = "rgba(255,201,77,0.8)";
      g.shadowBlur = 14;
      g.fillStyle = C.gold;
      g.fill();
    } else {
      g.strokeStyle = "rgba(255,201,77,0.45)";
      g.lineWidth = 2.5;
      g.stroke();
    }
    g.restore();
    g.font = `800 32px ${UI}`;
    g.fillStyle = got ? C.cream : rgba(C.muted, 0.75);
    g.fillText(label, x + R * 2 + gapIcon, y);
    x += widths[i] + gapItem;
  });
}

function infoParts(rev) {
  const knew = rev.fs ? `The table knew ${rev.fs === 1 ? "once" : `${rev.fs} times`}` : "";
  const hands = +rev.hands, secs = +rev.secs;
  let extra = "";
  if (hands > 0 && secs > 0) extra = `spelled by ${hands} ${hands === 1 ? "hand" : "hands"} in ${fmtTime(secs)}`;
  if (!knew && extra) extra = extra[0].toUpperCase() + extra.slice(1);
  return { knew, extra };
}

function drawInfo(g, rev, y) {
  const { knew, extra } = infoParts(rev);
  if (!knew && !extra) return false;
  const sep = knew && extra ? "   ·   " : "";
  g.font = `700 34px ${DISPLAY}`;
  const kw = knew ? g.measureText(knew).width : 0;
  g.font = `800 26px ${UI}`;
  const ew = g.measureText(sep + extra).width;
  let x = 540 - (kw + ew) / 2;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  if (knew) {
    g.save();
    g.font = `700 34px ${DISPLAY}`;
    g.fillStyle = C.mint;
    g.shadowColor = "rgba(94,242,208,0.55)";
    g.shadowBlur = 14;
    g.fillText(knew, x, y);
    g.restore();
    x += kw;
  }
  if (extra) {
    g.font = `800 26px ${UI}`;
    g.fillStyle = C.muted;
    g.fillText(sep + extra, x, y);
  }
  return true;
}

// "ghost hand" with the o drawn as the planchette's lens, like the top bar wordmark.
function drawWordmark(g, y) {
  const size = 62;
  g.font = `800 ${size}px ${DISPLAY}`;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  const a = "gh", b = "st hand";
  const aw = g.measureText(a).width, bw = g.measureText(b).width;
  const d = size * 0.62, m = size * 0.03;
  let x = 540 - (aw + d + m * 2 + bw) / 2;
  g.fillStyle = C.cream;
  g.fillText(a, x, y);
  x += aw + m;
  const r = d / 2, cx = x + r, cy = y + size * 0.04 - r;
  g.save();
  g.shadowColor = "rgba(94,242,208,0.5)";
  g.shadowBlur = 12;
  g.fillStyle = C.gold;
  g.beginPath(); g.ellipse(cx, cy, r, r * 0.96, 0, 0, TAU); g.fill();
  g.restore();
  g.fillStyle = C.card2;
  g.beginPath(); g.arc(cx, cy - r * 0.06, r * 0.66, 0, TAU); g.fill();
  g.fillStyle = C.mint;
  g.beginPath(); g.arc(cx, cy - r * 0.08, r * 0.4, 0, TAU); g.fill();
  x += d + m;
  g.fillStyle = C.cream;
  g.fillText(b, x, y);
}

// ------------------------------------------------------------ the card

/**
 * Draw the 1080 x 1350 share card.
 * @param {object} rev  the reveal event: { frameText, ask, words:[{w,seat,name,colour}], stars, fs, path, hands, secs }
 * @param {{you?: number, url?: string}} opts  `you` = your seat (your words say "me"), `url` = bare host for the footer
 * @returns {Promise<{canvas: HTMLCanvasElement, blob: Blob}>}
 */
export async function renderShareCard(rev, { you, url } = {}) {
  rev = rev || {};
  await fontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d");
  const rnd = rng(hash(String(rev.frameText || "ghost hand")));

  drawSky(g, rnd);
  const hushS = 290;
  drawHushBody(g, 540, FY, hushS);
  drawFrame(g, rnd);
  drawHushMittens(g, 540, FY, hushS);

  // Fixed anchors from the bottom of the frame up.
  const tagY = FY + FH - 46;
  const info = infoParts(rev);
  const hasInfo = !!(info.knew || info.extra);
  const infoY = tagY - 60;

  const qEnd = drawQuestion(g, String(rev.ask || ""), FY + 64);

  // Give the sentence room first: the path band shrinks (or goes) when it needs more, then
  // a long sentence takes the ornament's gap, and at last the info line's row.
  const toks = sentenceTokens(rev);
  const hasPath = Array.isArray(rev.path) && rev.path.length > 1;
  const plans = [];
  if (hasPath) for (const [bh, min] of [[210, 66], [165, 58], [125, 50]]) plans.push({ bh, min, orn: true, info: hasInfo });
  plans.push({ bh: 0, min: 46, orn: true, info: hasInfo });
  plans.push({ bh: 0, min: hasInfo ? 40 : 0, orn: false, info: hasInfo });
  if (hasInfo) plans.push({ bh: 0, min: 0, orn: false, info: false });
  let lay = null, plan = null, sTop = 0, sBot = 0, starsY = 0;
  for (const p of plans) {
    const sy = p.info ? infoY - 52 : tagY - 66;
    const top = p.orn ? qEnd + 66 : qEnd + 28;
    const bot = p.bh ? sy - 58 - p.bh - 26 : sy - 74;
    lay = layoutSentence(g, toks, you, bot - top);
    plan = p; sTop = top; sBot = bot; starsY = sy;
    if (lay.size >= p.min && lay.total <= bot - top) break;
  }
  if (plan.orn) drawOrnament(g, qEnd + 30);
  // Never let the words reach the stars, even if the sentence still does not fit.
  g.save();
  g.beginPath();
  g.rect(0, sTop - 24, W, starsY - 46 - (sTop - 24));
  g.clip();
  drawSentence(g, lay, sTop + Math.max(0, (sBot - sTop - lay.total) / 2));
  g.restore();
  if (plan.bh) drawSignature(g, rev, { x: 140, y: starsY - 58 - plan.bh, w: 800, h: plan.bh });

  drawStars(g, rev.stars || {}, starsY);
  if (plan.info) drawInfo(g, rev, infoY);

  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = `800 32px ${UI}`;
  g.fillStyle = C.cream;
  g.fillText("We spelled this together without talking.", 540, tagY);

  drawWordmark(g, 1276);
  g.textAlign = "center";
  g.font = `800 25px ${UI}`;
  g.fillStyle = C.muted;
  const foot = [url || location.host, niceDate()].filter(Boolean).join("   ·   ");
  g.fillText(foot, 540, 1320);

  const blob = await new Promise((resolve, reject) => {
    try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"); } catch (e) { reject(e); }
  });
  return { canvas, blob };
}

// ------------------------------------------------------------ the preview sheet

const ICONS = {
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5 5.7 15.6A7.5 7.5 0 1 1 8.6 18.6Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/></svg>',
  gif: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2.1"/><path d="M10.2 9.3v5.4l4.6-2.7Z" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.1"/><path d="M15.5 5.5A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 1.5 2" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>',
};

const CSS = `
.ghsc { position: fixed; inset: 0; z-index: 70; display: flex; align-items: flex-start; justify-content: center;
  padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  background: rgba(8, 7, 20, 0.74); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; animation: ghsc-fade 200ms ease-out;
  -webkit-user-select: none; user-select: none; }
.ghsc-panel { position: relative; margin: auto; width: min(100%, 500px); display: flex; flex-direction: column; gap: 12px;
  padding: 14px 16px 12px; border-radius: 22px; border: 1px solid rgba(201, 162, 74, 0.55); outline: none;
  background: radial-gradient(120% 50% at 50% 0%, rgba(94, 242, 208, 0.08), rgba(94, 242, 208, 0) 60%), linear-gradient(180deg, var(--card-2, #2A2552), var(--card, #221E45));
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55); color: var(--cream, #F3E9D2); font: 600 16px/1.4 var(--ui, system-ui, sans-serif);
  text-align: center; animation: ghsc-rise 280ms cubic-bezier(.2, .9, .3, 1.15); }
.ghsc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ghsc-title { margin: 0; font: 700 22px/1.15 var(--display, Georgia, serif); text-align: left; color: var(--cream, #F3E9D2); }
.ghsc .ghsc-close { flex: none; }
.ghsc-frame { position: relative; align-self: center; aspect-ratio: 1080 / 1350; max-width: 100%; border-radius: 14px; overflow: hidden;
  height: min(60vh, calc((min(100vw, 500px) - 64px) * 1.25));
  height: min(60dvh, calc((min(100vw, 500px) - 64px) * 1.25));
  background: radial-gradient(80% 45% at 50% 0%, rgba(94, 242, 208, 0.12), rgba(94, 242, 208, 0) 70%), var(--night, #14122B);
  box-shadow: 0 0 0 1px rgba(201, 162, 74, 0.35), 0 12px 32px rgba(0, 0, 0, 0.5); }
.ghsc-frame::before { content: ""; position: absolute; inset: 15.8% 5.6% 11.9%; border: 2px solid rgba(201, 162, 74, 0.32); border-radius: 12px; transition: opacity 240ms; }
.ghsc-frame::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(100deg, rgba(243, 233, 210, 0) 35%, rgba(243, 233, 210, 0.07) 50%, rgba(243, 233, 210, 0) 65%);
  background-size: 260% 100%; animation: ghsc-shimmer 1.5s linear infinite; transition: opacity 240ms; }
.ghsc-img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; transition: opacity 320ms ease;
  -webkit-user-select: auto; user-select: auto; -webkit-touch-callout: default; }
.ghsc-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  padding: 20px; color: var(--muted, #A9A3C9); font: 800 15px/1.35 var(--ui, system-ui, sans-serif); transition: opacity 240ms; }
.ghsc-dots { display: flex; gap: 8px; }
.ghsc-dots i { width: 9px; height: 9px; border-radius: 50%; background: var(--mint, #5EF2D0); box-shadow: 0 0 10px var(--mint, #5EF2D0); animation: ghsc-bob 1.1s ease-in-out infinite; }
.ghsc-dots i:nth-child(2) { animation-delay: 150ms; }
.ghsc-dots i:nth-child(3) { animation-delay: 300ms; }
.ghsc-frame.ready .ghsc-img { opacity: 1; }
.ghsc-frame.ready::before, .ghsc-frame.ready::after, .ghsc-frame.ready .ghsc-loading { opacity: 0; visibility: hidden; animation: none; }
.ghsc-frame.failed::after, .ghsc-frame.failed .ghsc-dots { display: none; }
.ghsc-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ghsc-btns .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 10px 14px;
  font-size: 16px; text-decoration: none; white-space: nowrap; }
.ghsc-btns .btn.wide { grid-column: 1 / -1; }
.ghsc [hidden] { display: none !important; }
.ghsc .btn svg { width: 18px; height: 18px; flex: none; }
.ghsc .btn:disabled { opacity: 0.45; cursor: default; transform: none; }
.ghsc .btn.done { border-color: var(--mint, #5EF2D0); color: var(--mint, #5EF2D0); }
.ghsc .btn.primary.done { color: var(--ink-on-gold, #14122B); }
.ghsc-retry { margin-top: 2px; }
.ghsc .ghsc-gif[aria-busy="true"] { opacity: 0.85; cursor: progress; }
.ghsc-gif .ghsc-dots { gap: 4px; margin-left: 2px; }
.ghsc-gif .ghsc-dots i { width: 5px; height: 5px; box-shadow: 0 0 6px var(--mint, #5EF2D0); animation-duration: 0.9s; }
.ghsc-hint { margin: 0; font: 700 13px/1.35 var(--ui, system-ui, sans-serif); color: var(--muted, #A9A3C9); }
.ghsc-live { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; padding: 0; }
.ghsc button:focus-visible, .ghsc a:focus-visible { outline: 3px solid var(--mint, #5EF2D0); outline-offset: 3px; }
@media (max-width: 520px) {
  .ghsc { padding-left: 10px; padding-right: 10px; }
  .ghsc-panel { padding: 12px; gap: 10px; border-radius: 20px; }
  .ghsc-title { font-size: 20px; }
  .ghsc-btns .btn { padding: 10px 10px; font-size: 15px; }
}
@media (max-height: 560px) and (min-width: 600px) {
  .ghsc-panel { width: min(100%, 720px); display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto 1fr auto auto; column-gap: 16px; text-align: left; }
  .ghsc-head { grid-column: 2; grid-row: 1; }
  .ghsc-frame { grid-column: 1; grid-row: 1 / span 4; height: min(calc(100vh - 56px), 460px); height: min(calc(100dvh - 56px), 460px); }
  .ghsc-btns { grid-column: 2; grid-row: 3; }
  .ghsc-hint { grid-column: 2; grid-row: 4; }
}
@keyframes ghsc-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ghsc-rise { from { opacity: 0; transform: translateY(18px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes ghsc-shimmer { from { background-position: 100% 0; } to { background-position: -160% 0; } }
@keyframes ghsc-bob { 0%, 100% { transform: translateY(0); opacity: 0.55; } 50% { transform: translateY(-7px); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .ghsc, .ghsc-panel, .ghsc-frame::after, .ghsc-dots i { animation: none; }
  .ghsc-img, .ghsc-loading, .ghsc-frame::before { transition: none; }
}
html.gh-reduce .ghsc, html.gh-reduce .ghsc-panel, html.gh-reduce .ghsc-frame::after, html.gh-reduce .ghsc-dots i { animation: none; }
html.gh-reduce .ghsc-img, html.gh-reduce .ghsc-loading, html.gh-reduce .ghsc-frame::before { transition: none; }
`;

function injectCss() {
  syncReduce();
  if (document.getElementById("gh-sharecard")) return;
  const s = document.createElement("style");
  s.id = "gh-sharecard";
  s.textContent = CSS;
  document.head.appendChild(s);
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // Some browsers leave the promise pending (no focus, no permission): do not wait forever.
      const ok = await Promise.race([
        navigator.clipboard.writeText(text).then(() => true, () => false),
        new Promise((r) => setTimeout(() => r(false), 1200)),
      ]);
      if (ok) return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

// Asked up front with a stand-in PNG so the buttons are laid out once, without a jump.
function canShareFiles(file) {
  try {
    const f = file || new File([new Uint8Array(8)], "ghost-hand.png", { type: "image/png" });
    return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [f] }));
  } catch { return false; }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let current = null;

/** Close the share preview if it is open. */
export function closeSharePreview() {
  if (current) current.close();
}

/**
 * Open the share preview sheet over the game.
 * @param {object} rev  the reveal event
 * @param {{you?: number, url?: string, shareUrl?: string}} opts
 *   url: bare host printed on the card; shareUrl: the link put in shared text (falls back to url)
 * @returns {{el: HTMLElement, close: () => void, ready: Promise<{canvas, blob}|null>}}
 */
export function openSharePreview(rev, { you, url, shareUrl } = {}) {
  closeSharePreview();
  injectCss();
  rev = rev || {};
  const host = url || location.host;
  const link = shareUrl || host;
  const sentence = String(rev.frameText || "").trim();
  const message = t("share.message", { sentence, link });
  const fileName = `ghost-hand-${isoDate()}.png`;
  const gifName = `ghost-hand-replay-${isoDate()}.gif`;
  const hasPath = Array.isArray(rev.path) && rev.path.length > 1;
  const prevFocus = document.activeElement;
  const shareable = canShareFiles();

  const root = document.createElement("div");
  root.className = "ghsc";
  root.innerHTML = `
<div class="ghsc-panel" role="dialog" aria-modal="true" aria-labelledby="ghsc-title" tabindex="-1">
  <div class="ghsc-head">
    <h2 class="ghsc-title" id="ghsc-title">${esc(t("share.title"))}</h2>
    <button type="button" class="btn small ghsc-close">${esc(t("share.close"))}</button>
  </div>
  <div class="ghsc-frame" aria-busy="true">
    <img class="ghsc-img" alt="${esc(t("share.cardAlt", { sentence }))}">
    <div class="ghsc-loading" role="status"><span class="ghsc-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="ghsc-loadtext">${esc(t("share.drawing"))}</span></div>
  </div>
  <div class="ghsc-btns">
    <button type="button" class="btn primary ghsc-share" disabled${shareable ? "" : " hidden"}>${ICONS.share}<span>${esc(t("share.share"))}</span></button>
    <button type="button" class="btn ${shareable ? "" : "primary wide "}ghsc-save" disabled>${ICONS.save}<span>${esc(t("share.saveImage"))}</span></button>
    <a class="btn ghsc-wa" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer">${ICONS.chat}<span>${esc(t("share.whatsapp"))}</span></a>
    <button type="button" class="btn ghsc-copy">${ICONS.copy}<span>${esc(t("share.copyText"))}</span></button>
    <button type="button" class="btn wide ghsc-gif"${hasPath ? "" : " hidden"}>${ICONS.gif}<span>${esc(t("share.gifSave"))}</span></button>
  </div>
  <p class="ghsc-hint">${esc(t("share.instaHint"))}</p>
  <p class="ghsc-live" aria-live="polite"></p>
</div>`;
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const panel = $(".ghsc-panel"), frame = $(".ghsc-frame"), img = $(".ghsc-img");
  const shareBtn = $(".ghsc-share"), saveBtn = $(".ghsc-save"), copyBtn = $(".ghsc-copy"), closeBtn = $(".ghsc-close");
  const gifBtn = $(".ghsc-gif");
  const live = $(".ghsc-live");
  let objUrl = null, file = null, closed = false, savedAt = 0;
  let gifBlob = null, gifUrl = null, gifBusy = false, gifLabel = t("share.gifSave");
  const timers = new Set();
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const say = (msg) => { live.textContent = ""; later(30, () => { live.textContent = msg; }); };
  const flash = (btn, label, back) => {
    const span = btn.querySelector("span");
    span.textContent = label;
    btn.classList.add("done");
    later(1700, () => { span.textContent = back; btn.classList.remove("done"); });
  };

  const handle = { el: root, close, ready: null };

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onDocKey, true);
    timers.forEach(clearTimeout);
    timers.clear();
    root.remove();
    if (objUrl) {
      const u = objUrl;
      objUrl = null;
      // Give a just-started download a moment before the URL goes away.
      if (Date.now() - savedAt < 4000) setTimeout(() => URL.revokeObjectURL(u), 4000);
      else URL.revokeObjectURL(u);
    }
    if (gifUrl) {
      const u = gifUrl;
      gifUrl = null;
      setTimeout(() => URL.revokeObjectURL(u), 4000);
    }
    if (current === handle) current = null;
    try { if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch {}
  }

  function focusables() {
    return [...root.querySelectorAll("button, a[href]")].filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
  }

  function onDocKey(e) {
    if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); e.stopPropagation(); close(); }
  }
  document.addEventListener("keydown", onDocKey, true);
  // Keep keys inside the sheet away from the game's hand controls; trap Tab in the sheet.
  root.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      const els = focusables();
      if (els.length) {
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    e.stopPropagation();
  });
  root.addEventListener("keyup", (e) => e.stopPropagation());
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  closeBtn.addEventListener("click", close);

  saveBtn.addEventListener("click", () => {
    if (!objUrl) return;
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    savedAt = Date.now();
    flash(saveBtn, t("share.saved"), t("share.saveImage"));
    say(t("share.imageSaved"));
  });

  shareBtn.addEventListener("click", async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: "Ghost Hand", text: message });
    } catch (err) {
      if (!err || err.name !== "AbortError") say(t("share.shareFailed"));
    }
  });

  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(message);
    if (closed) return;
    try { copyBtn.focus({ preventScroll: true }); } catch {}
    flash(copyBtn, ok ? t("share.copied") : t("share.copyFailed"), t("share.copyText"));
    say(ok ? t("share.copiedLive") : t("share.copyFailedLive"));
  });

  // ---- the replay GIF: made on the first tap (lazy module), then shared as a file or saved.
  const gifSpan = gifBtn.querySelector("span");
  const setGif = (label, busy = false) => {
    gifLabel = label;
    gifSpan.textContent = label;
    gifBtn.setAttribute("aria-busy", busy ? "true" : "false");
    const dots = gifBtn.querySelector(".ghsc-dots");
    if (busy && !dots) gifBtn.insertAdjacentHTML("beforeend", '<span class="ghsc-dots" aria-hidden="true"><i></i><i></i><i></i></span>');
    if (!busy && dots) dots.remove();
  };
  function saveGif() {
    if (!gifUrl) gifUrl = URL.createObjectURL(gifBlob);
    const a = document.createElement("a");
    a.href = gifUrl;
    a.download = gifName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    gifBtn.classList.add("done");
    gifSpan.textContent = t("share.gifSavedShort");
    later(1700, () => { gifSpan.textContent = gifLabel; gifBtn.classList.remove("done"); });
    say(t("share.gifSaved"));
  }
  async function deliverGif(fresh) {
    let f = null;
    try { f = new File([gifBlob], gifName, { type: "image/gif" }); } catch {}
    if (f && canShareFiles(f)) {
      try {
        await navigator.share({ files: [f], title: "Ghost Hand", text: message });
        return;
      } catch (err) {
        if (closed || (err && err.name === "AbortError")) return;
        // Making the GIF can outlast the tap's permission to share: one more tap shares it.
        if (fresh && err && err.name === "NotAllowedError") { setGif(t("share.gifShare")); say(t("share.gifShare")); return; }
      }
    }
    saveGif();
  }
  gifBtn.addEventListener("click", async () => {
    if (gifBusy || closed) return;
    let fresh = false;
    if (!gifBlob) {
      gifBusy = true;
      const back = gifLabel;
      setGif(t("share.gifMaking"), true);
      say(t("share.gifMaking"));
      try {
        const { makeReplayGif } = await import("./gifreplay.js");
        const blob = await makeReplayGif(rev, { width: 480, frames: 60, delayMs: 60 });
        if (closed) return;
        gifBlob = blob;
        fresh = true;
        let f = null;
        try { f = new File([blob], gifName, { type: "image/gif" }); } catch {}
        setGif(f && canShareFiles(f) ? t("share.gifShare") : t("share.gifSave"));
      } catch (e) {
        if (closed) return;
        console.error("replay gif", e);
        setGif(back);
        say(t("share.gifFailed"));
        gifSpan.textContent = t("share.gifFailed");
        later(2200, () => { gifSpan.textContent = gifLabel; });
        return;
      } finally {
        gifBusy = false;
      }
    }
    await deliverGif(fresh);
  });

  function draw() {
    frame.classList.remove("failed", "ready");
    frame.setAttribute("aria-busy", "true");
    $(".ghsc-loadtext").textContent = t("share.drawing");
    const oldRetry = $(".ghsc-retry");
    if (oldRetry) oldRetry.remove();
    return renderShareCard(rev, { you, url: host }).then((res) => {
      if (closed) return res;
      objUrl = URL.createObjectURL(res.blob);
      img.onload = () => { frame.classList.add("ready"); frame.setAttribute("aria-busy", "false"); };
      img.src = objUrl;
      saveBtn.disabled = false;
      if (shareable) {
        let f = null;
        try { f = new File([res.blob], fileName, { type: "image/png" }); } catch {}
        if (f && canShareFiles(f)) { file = f; shareBtn.disabled = false; }
        else { shareBtn.hidden = true; saveBtn.classList.add("primary", "wide"); }
      }
      // Move focus to the main action once the card is ready, unless the player moved it.
      if (document.activeElement === panel) {
        try { (shareBtn.hidden ? saveBtn : shareBtn).focus({ preventScroll: true }); } catch {}
      }
      return res;
    }).catch(() => {
      if (closed) return null;
      frame.classList.add("failed");
      frame.setAttribute("aria-busy", "false");
      $(".ghsc-loadtext").textContent = t("share.smudged");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn small ghsc-retry";
      retry.textContent = t("share.retry");
      retry.addEventListener("click", () => { handle.ready = draw(); });
      $(".ghsc-loading").appendChild(retry);
      return null;
    });
  }

  current = handle;
  try { panel.focus({ preventScroll: true }); } catch {}
  handle.ready = draw();
  return handle;
}

/** Kept for app.js: opens the preview sheet (which draws the card). */
export function makeShareCard(rev, opts = {}) {
  return openSharePreview(rev, opts);
}
