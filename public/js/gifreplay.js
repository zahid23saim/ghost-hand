// Ghost Hand - the replay GIF: the table's one planchette path drawn again on a small
// midnight board, word by word in each author's colour, then the finished sentence.
//
//   makeReplayGif(rev, { width = 480, frames = 60, delayMs = 60 }) -> Promise<Blob> (image/gif)
//
// `rev` is the reveal event: { path: [[x, y, slot], ...] (board units), words: [{ w, seat,
// name, colour }], frameText, ask }. No libraries: frames are drawn on a canvas, mapped to a
// fixed 128-colour theme palette (no dithering) and written by a small GIF89a/LZW encoder.
// Only the rectangle that changed since the previous frame is stored, so files stay small.

import { SEATS } from "./render.js";
import { LETTERS, SPECIALS, BOARD_W, BOARD_H } from "./shared/board.js";

const TAU = Math.PI * 2;
const DISPLAY = "Fraunces, Georgia, 'Times New Roman', serif";
const UI = "Nunito, system-ui, -apple-system, 'Segoe UI', sans-serif";
const C = {
  night: "#14122B", night2: "#1B1838", card: "#221E45", card2: "#2A2552", violet: "#3A3270",
  cream: "#F3E9D2", muted: "#A9A3C9", gold: "#FFC94D", brass: "#C9A24A", brassHi: "#EBCB78",
  brassLo: "#8C6B27", mint: "#5EF2D0", body: "#2C2757", white: "#FFFFFF",
};
const GHOST_FRIEND = "#CBB8FF";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rgb(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; }
function seatHex(colour) {
  return Number.isInteger(colour) && colour >= 0 ? SEATS[colour % SEATS.length].hex : GHOST_FRIEND;
}

// ------------------------------------------------------------ the palette (128 colours)

let PALETTE = null; // { table: Uint8Array(384), lut: Uint8Array(32768) }

function buildPalette() {
  if (PALETTE) return PALETTE;
  const list = [];
  const seen = new Set();
  const add = (c) => {
    const k = c.map((v) => clamp(Math.round(v), 0, 255));
    const id = k.join(",");
    if (seen.has(id) || list.length >= 128) return;
    seen.add(id);
    list.push(k);
  };
  const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  // The dark grounds first.
  for (const h of [C.night, C.night2, C.card, C.card2, C.violet, C.body, C.brassLo, "#0B0A18"]) add(rgb(h));
  // Every ink colour, plus ramps toward the board face and toward the night sky, so
  // anti-aliased edges, glows and fades land on a near neighbour instead of banding wildly.
  const inks = [C.cream, C.muted, C.gold, C.brass, C.brassHi, C.mint, GHOST_FRIEND, C.white, ...SEATS.map((s) => s.hex)];
  const face = rgb(C.card), sky = rgb(C.night);
  for (const h of inks) {
    const c = rgb(h);
    for (const t of [1, 0.8, 0.6, 0.4, 0.2]) add(mixc(face, c, t));
  }
  for (const h of inks) {
    const c = rgb(h);
    for (const t of [0.75, 0.5, 0.25]) add(mixc(sky, c, t));
  }
  // Pad with in-betweens of the grounds.
  const grounds = [C.night, C.card, C.card2, C.violet, C.cream].map(rgb);
  for (let i = 0; list.length < 128 && i < 200; i++) {
    const a = grounds[i % grounds.length], b = grounds[(i * 3 + 1) % grounds.length];
    add(mixc(a, b, ((i % 7) + 1) / 8));
  }
  while (list.length < 128) list.push([0, 0, 0]);

  const table = new Uint8Array(384);
  list.forEach(([r, g, b], i) => { table[i * 3] = r; table[i * 3 + 1] = g; table[i * 3 + 2] = b; });
  // 15-bit lookup: 5 bits per channel -> nearest palette index (weighted RGB distance).
  const lut = new Uint8Array(32768);
  const pr = list.map((c) => c[0]), pg = list.map((c) => c[1]), pb = list.map((c) => c[2]);
  for (let key = 0; key < 32768; key++) {
    const r = ((key >> 10) << 3) + 4, g = (((key >> 5) & 31) << 3) + 4, b = ((key & 31) << 3) + 4;
    let best = 0, bd = Infinity;
    for (let i = 0; i < 128; i++) {
      const dr = r - pr[i], dg = g - pg[i], db = b - pb[i];
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bd) { bd = d; best = i; }
    }
    lut[key] = best;
  }
  PALETTE = { table, lut };
  return PALETTE;
}

// ------------------------------------------------------------ the GIF89a encoder

class Bytes {
  constructor(n = 1 << 16) { this.b = new Uint8Array(n); this.p = 0; }
  need(k) {
    if (this.p + k <= this.b.length) return;
    let n = this.b.length * 2;
    while (n < this.p + k) n *= 2;
    const nb = new Uint8Array(n);
    nb.set(this.b.subarray(0, this.p));
    this.b = nb;
  }
  byte(v) { this.need(1); this.b[this.p++] = v; }
  u16(v) { this.need(2); this.b[this.p++] = v & 255; this.b[this.p++] = (v >> 8) & 255; }
  str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  all(arr) { this.need(arr.length); this.b.set(arr, this.p); this.p += arr.length; }
}

const LZW_TABLE = new Int16Array(4096 * 128); // (prefix code, next index) -> code; 0 = empty

// Variable-width LZW of 7-bit indices, written as GIF data sub-blocks (after the min code size byte).
function lzw(out, px, minCode = 7) {
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1;
  const table = LZW_TABLE;
  table.fill(0);
  const block = new Uint8Array(256);
  let bn = 0, acc = 0, bits = 0;
  const flush = () => { if (bn) { out.byte(bn); out.all(block.subarray(0, bn)); bn = 0; } };
  const emit = (code) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      block[bn++] = acc & 255;
      acc >>>= 8;
      bits -= 8;
      if (bn === 255) flush();
    }
  };
  out.byte(minCode);
  emit(clear);
  let cur = px[0];
  for (let i = 1, n = px.length; i < n; i++) {
    const k = px[i];
    const key = (cur << 7) | k;
    const hit = table[key];
    if (hit) { cur = hit; continue; }
    emit(cur);
    if (next === 4096) {
      emit(clear);
      table.fill(0);
      size = minCode + 1;
      next = eoi + 1;
    } else {
      if (next >= 1 << size) size++;
      table[key] = next++;
    }
    cur = k;
  }
  emit(cur);
  emit(eoi);
  if (bits > 0) { block[bn++] = acc & 255; if (bn === 255) flush(); }
  flush();
  out.byte(0); // block terminator
}

function writeHeader(out, w, h, table) {
  out.str("GIF89a");
  out.u16(w); out.u16(h);
  out.byte(0xf6); // global colour table, 8-bit colour resolution, 128 entries
  out.byte(0); out.byte(0);
  out.all(table);
  // Netscape looping extension: loop forever.
  out.byte(0x21); out.byte(0xff); out.byte(11); out.str("NETSCAPE2.0");
  out.byte(3); out.byte(1); out.u16(0); out.byte(0);
}

function writeFrame(out, px, x, y, w, h, delayCs) {
  out.byte(0x21); out.byte(0xf9); out.byte(4);
  out.byte(0x04); // disposal 1: leave the frame in place (later frames patch only what changed)
  out.u16(delayCs);
  out.byte(0); out.byte(0);
  out.byte(0x2c);
  out.u16(x); out.u16(y); out.u16(w); out.u16(h);
  out.byte(0);
  lzw(out, px);
}

// ------------------------------------------------------------ drawing helpers

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

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function sparkle(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x, y, x + s, y);
  g.quadraticCurveTo(x, y, x, y + s);
  g.quadraticCurveTo(x, y, x - s, y);
  g.quadraticCurveTo(x, y, x, y - s);
  g.closePath();
}

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
function balancedLines(ws, space, maxW) {
  const base = greedyLines(ws, space, maxW);
  if (base.length < 2) return base;
  let lo = Math.max(...ws), hi = maxW;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (greedyLines(ws, space, mid).length <= base.length) hi = mid; else lo = mid;
  }
  return greedyLines(ws, space, hi);
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

function cleanPath(rev) {
  const raw = Array.isArray(rev.path) ? rev.path : [];
  const pts = [];
  for (const p of raw) {
    if (!Array.isArray(p)) continue;
    const x = +p[0], y = +p[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = pts[pts.length - 1];
    if (last && Math.abs(x - last[0]) < 0.5 && Math.abs(y - last[1]) < 0.5 && last[2] === p[2]) continue;
    pts.push([clamp(x, 0, BOARD_W), clamp(y, 0, BOARD_H), p[2]]);
  }
  return pts;
}

async function fontsReady() {
  try {
    if (typeof document === "undefined" || !document.fonts || !document.fonts.load) return;
    const all = Promise.all(["700 30px Fraunces", "800 16px Nunito"].map((f) => document.fonts.load(f, "AZ az").catch(() => null)));
    await Promise.race([all, new Promise((r) => setTimeout(r, 1200))]);
  } catch {}
}

function makeCanvas(w, h) {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

// ------------------------------------------------------------ the replay

/**
 * Make a looping replay GIF of the table's planchette path.
 * @param {object} rev  the reveal event ({ path, words, frameText, ask })
 * @param {{width?: number, frames?: number, delayMs?: number}} [opts]
 * @returns {Promise<Blob>} an image/gif blob (width x round(width * 1.125))
 */
export async function makeReplayGif(rev, { width = 480, frames = 60, delayMs = 60 } = {}) {
  rev = rev || {};
  const W = Math.round(clamp(+width || 480, 160, 1080) / 2) * 2;
  const H = Math.round(W * 1.125);
  const frameN = Math.round(clamp(+frames || 60, 2, 400));
  const delayCs = Math.max(2, Math.round((+delayMs || 60) / 10));
  const k = W / 480;
  const { table, lut } = buildPalette();
  await fontsReady();

  // Layout: the board on top, a band for the question and then the sentence below.
  const m = Math.round(12 * k);
  const bx = m, by = m, bw = W - 2 * m, bh = Math.round(bw * (BOARD_H / BOARD_W));
  const s = bw / BOARD_W;
  const P = (x, y) => [bx + x * s, by + y * s];
  const bandTop = by + bh + Math.round(4 * k), bandH = H - bandTop;

  // ---- the still background (sky, board, letters, a tiny wordmark), drawn once
  const bg = makeCanvas(W, H);
  {
    const g = bg.getContext("2d");
    const rnd = rng(hash(String(rev.frameText || "ghost hand")));
    g.fillStyle = C.night;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = rgba(C.cream, 0.25 + rnd() * 0.5);
      g.beginPath(); g.arc(rnd() * W, bandTop + rnd() * bandH, (0.5 + rnd()) * k, 0, TAU); g.fill();
    }
    // Indigo face with a brass rim.
    g.fillStyle = C.card;
    roundRect(g, bx, by, bw, bh, 22 * k);
    g.fill();
    g.save();
    roundRect(g, bx, by, bw, bh, 22 * k);
    g.clip();
    g.fillStyle = C.card2;
    g.beginPath(); g.ellipse(bx + bw / 2, by, bw * 0.55, bh * 0.32, 0, 0, TAU); g.fill();
    for (let i = 0; i < 26; i++) {
      g.fillStyle = rgba(C.cream, 0.15 + rnd() * 0.25);
      g.beginPath(); g.arc(bx + rnd() * bw, by + rnd() * bh, (0.5 + rnd() * 0.8) * k, 0, TAU); g.fill();
    }
    g.restore();
    g.strokeStyle = C.brass;
    g.lineWidth = 3.5 * k;
    roundRect(g, bx, by, bw, bh, 22 * k);
    g.stroke();
    g.strokeStyle = rgba(C.brassHi, 0.4);
    g.lineWidth = 1.2 * k;
    roundRect(g, bx + 8 * k, by + 8 * k, bw - 16 * k, bh - 16 * k, 16 * k);
    g.stroke();
    g.fillStyle = rgba(C.brassHi, 0.8);
    for (const [x, y] of [[bx + 22 * k, by + 22 * k], [bx + bw - 22 * k, by + 22 * k], [bx + 22 * k, by + bh - 22 * k], [bx + bw - 22 * k, by + bh - 22 * k]]) {
      sparkle(g, x, y, 5 * k); g.fill();
    }
    // Letters at their real board positions.
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.round(58 * s)}px ${DISPLAY}`;
    g.fillStyle = rgba(C.cream, 0.88);
    for (const L of LETTERS) { const [x, y] = P(L.x, L.y); g.fillText(L.k, x, y); }
    // YES / NO and the GOODBYE banner.
    for (const S of SPECIALS) {
      const [x, y] = P(S.x, S.y);
      if (S.banner) {
        g.strokeStyle = rgba(C.brass, 0.7);
        g.lineWidth = 1.5 * k;
        roundRect(g, x - (S.banner.w / 2) * s, y - (S.banner.h / 2) * s, S.banner.w * s, S.banner.h * s, 12 * k);
        g.stroke();
        g.font = `700 ${Math.round(40 * s)}px ${DISPLAY}`;
        g.fillStyle = rgba(C.cream, 0.6);
        g.fillText(S.label, x, y);
      } else {
        g.font = `800 ${Math.round(46 * s)}px ${DISPLAY}`;
        g.fillStyle = C.gold;
        g.fillText(S.label, x, y);
        if (S.icon) {
          const [ix, iy] = P(S.icon.x, S.icon.y);
          g.fillStyle = rgba(C.gold, 0.8);
          sparkle(g, ix, iy, 9 * k); g.fill();
        }
      }
    }
    // Wordmark, bottom right of the band.
    g.textAlign = "right";
    g.textBaseline = "alphabetic";
    g.font = `800 ${Math.round(13 * k)}px ${DISPLAY}`;
    g.fillStyle = C.muted;
    g.fillText("ghost hand", W - m, H - Math.round(8 * k));
  }

  // ---- the path in screen pixels, split into runs by word
  const pts = cleanPath(rev).map(([x, y, slot]) => { const [px, py] = P(x, y); return [px, py, slot]; });
  const words = rev.words || [];
  const colourOf = (slot) => { const w = words[slot]; return w ? seatHex(w.colour) : C.mint; };

  // ---- the sentence layout (for the last frames) and the question (before)
  const toks = sentenceTokens(rev);
  const maxTextW = W - 2 * m - 16 * k;
  const ctx = makeCanvas(W, H).getContext("2d", { willReadFrequently: true });
  let sent = null;
  if (toks.length) {
    for (let size = Math.round(30 * k); size >= Math.round(12 * k); size--) {
      ctx.font = `700 ${size}px ${DISPLAY}`;
      const ws = toks.map((t) => ctx.measureText(t.t).width);
      const space = ctx.measureText(" ").width * 1.1;
      const lines = balancedLines(ws, space, maxTextW);
      const lh = size * 1.18;
      const fits = lines.length * lh <= bandH - 22 * k && Math.max(...ws) <= maxTextW;
      sent = { size, ws, space, lines, lh };
      if (fits && lines.length <= 3) break;
    }
  }
  const ask = String(rev.ask || "").trim();
  let askLines = [], askSize = Math.round(15 * k);
  if (ask) {
    for (; askSize >= Math.round(10 * k); askSize--) {
      ctx.font = `700 ${askSize}px ${UI}`;
      const words2 = `“${ask}”`.split(/\s+/);
      const ranges = balancedLines(words2.map((w) => ctx.measureText(w).width), ctx.measureText(" ").width, maxTextW);
      askLines = ranges.map(([a, b]) => words2.slice(a, b).join(" "));
      if (askLines.length <= 2) break;
    }
    askLines = askLines.slice(0, 2);
  }

  const fadeN = Math.max(1, Math.min(10, Math.floor(frameN / 4)));
  const pathFrames = Math.max(1, frameN - fadeN);

  const N = W * H;
  let cur = new Uint8Array(N), prev = new Uint8Array(N);
  const out = new Bytes(Math.max(1 << 16, (N * frameN) >> 4));
  writeHeader(out, W, H, table);

  for (let f = 0; f < frameN; f++) {
    const g = ctx;
    g.globalAlpha = 1;
    g.drawImage(bg, 0, 0);

    // Path progress: the whole path over the first frames, then it holds.
    const prog = clamp((f + 1) / pathFrames, 0, 1);
    let lens = null, lensColour = C.mint;
    if (pts.length) {
      const fpos = prog * (pts.length - 1);
      const full = Math.floor(fpos), frac = fpos - full;
      const end = Math.min(pts.length - 1, full + 1);
      const tip = [pts[full][0] + (pts[end][0] - pts[full][0]) * frac, pts[full][1] + (pts[end][1] - pts[full][1]) * frac, pts[end][2]];
      // Segment j (point j-1 to j) takes point j's word; consecutive segments of one word
      // are stroked as one run so the joins stay round. The last run ends at the moving tip.
      const runs = [];
      for (let j = 1; j <= full; j++) {
        const r = runs[runs.length - 1];
        if (r && r[2] === pts[j][2]) r[1] = j; else runs.push([j - 1, j, pts[j][2]]);
      }
      g.lineCap = "round";
      g.lineJoin = "round";
      for (const pass of [0, 1]) {
        g.lineWidth = pass ? 4.5 * k : 12 * k;
        const stroke = (col, draw) => {
          g.strokeStyle = pass ? col : rgba(col, 0.22);
          g.beginPath();
          draw();
          g.stroke();
        };
        for (const [a, b, slot] of runs) {
          stroke(colourOf(slot), () => {
            g.moveTo(pts[a][0], pts[a][1]);
            for (let i = a + 1; i <= b; i++) g.lineTo(pts[i][0], pts[i][1]);
          });
        }
        if (end > full && frac > 0) {
          stroke(colourOf(pts[end][2]), () => { g.moveTo(pts[full][0], pts[full][1]); g.lineTo(tip[0], tip[1]); });
        }
      }
      lens = tip;
      lensColour = colourOf(tip[2]);
    }
    if (lens) {
      const [x, y] = lens;
      g.fillStyle = rgba(lensColour, 0.2);
      g.beginPath(); g.arc(x, y, 15 * k, 0, TAU); g.fill();
      g.fillStyle = rgba(lensColour, 0.4);
      g.beginPath(); g.arc(x, y, 10 * k, 0, TAU); g.fill();
      g.strokeStyle = C.brassHi;
      g.lineWidth = 2 * k;
      g.beginPath(); g.arc(x, y, 40 * s, 0, TAU); g.stroke();
      g.fillStyle = C.white;
      g.beginPath(); g.arc(x, y, 5 * k, 0, TAU); g.fill();
    }

    // The band: the question while the path plays, then the sentence fades in.
    const a = clamp((f - pathFrames + 1) / fadeN, 0, 1);
    if (askLines.length && a < 1) {
      g.globalAlpha = 1 - a;
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      g.font = `700 ${Math.round(11 * k)}px ${UI}`;
      g.fillStyle = C.gold;
      const top = bandTop + bandH * 0.42 - (askLines.length * askSize * 1.25) / 2;
      g.fillText("HUSH ASKED", W / 2, top);
      g.font = `700 ${askSize}px ${UI}`;
      g.fillStyle = C.cream;
      askLines.forEach((l, i) => g.fillText(l, W / 2, top + (i + 1) * askSize * 1.25 + 2 * k));
      g.globalAlpha = 1;
    }
    if (sent && a > 0) {
      g.globalAlpha = a;
      g.textAlign = "left";
      g.textBaseline = "alphabetic";
      g.font = `700 ${sent.size}px ${DISPLAY}`;
      const total = sent.lines.length * sent.lh;
      let y = bandTop + (bandH - 16 * k - total) / 2 + sent.size * 0.95;
      for (const [s0, s1] of sent.lines) {
        let lw = 0;
        for (let i = s0; i < s1; i++) lw += sent.ws[i] + (i > s0 ? sent.space : 0);
        let x = (W - lw) / 2;
        for (let i = s0; i < s1; i++) {
          const t = toks[i];
          g.fillStyle = t.slot ? seatHex(t.slot.colour) : C.cream;
          g.fillText(t.t, x, y);
          if (t.slot) {
            g.fillRect(x, y + sent.size * 0.12, sent.ws[i], Math.max(1.5, sent.size * 0.06));
          }
          x += sent.ws[i] + sent.space;
        }
        y += sent.lh;
      }
      g.globalAlpha = 1;
    }

    // Map to the palette, then store only the rectangle that changed.
    const data = g.getImageData(0, 0, W, H).data;
    for (let i = 0, o = 0; i < N; i++, o += 4) {
      cur[i] = lut[((data[o] & 0xf8) << 7) | ((data[o + 1] & 0xf8) << 2) | (data[o + 2] >> 3)];
    }
    let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
    if (f > 0) {
      x0 = W; y0 = H; x1 = -1; y1 = -1;
      for (let y = 0; y < H; y++) {
        const row = y * W;
        let lx = -1, rx = -1;
        for (let x = 0; x < W; x++) if (cur[row + x] !== prev[row + x]) { lx = x; break; }
        if (lx < 0) continue;
        for (let x = W - 1; x >= lx; x--) if (cur[row + x] !== prev[row + x]) { rx = x; break; }
        if (y < y0) y0 = y;
        y1 = y;
        if (lx < x0) x0 = lx;
        if (rx > x1) x1 = rx;
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; } // nothing changed: a 1 px no-op frame keeps the timing
    }
    const fw = x1 - x0 + 1, fh = y1 - y0 + 1;
    let px = cur;
    if (fw !== W || fh !== H) {
      px = new Uint8Array(fw * fh);
      for (let y = 0; y < fh; y++) px.set(cur.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + fw), y * fw);
    }
    const last = f === frameN - 1;
    const d = last ? Math.max(delayCs, 220) : f === 0 ? Math.max(delayCs, 40) : delayCs;
    writeFrame(out, px, x0, y0, fw, fh, d);
    [cur, prev] = [prev, cur];
    // Let the page breathe (the loading dots keep moving).
    if (f % 12 === 11) await new Promise((r) => setTimeout(r, 0));
  }
  out.byte(0x3b);
  return new Blob([out.b.subarray(0, out.p)], { type: "image/gif" });
}
