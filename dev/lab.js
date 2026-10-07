// Ghost Hand - feel lab client: board, planchette, input, live tuning sliders.

import { Net, createRoom } from "./net.js";
import { BOARD_W, BOARD_H, TARGETS, TARGET_BY_KEY } from "./shared/board.js";
import { DEFAULT_TUNE, LAB_KEYS } from "./shared/sim.js";

const RANGES = {
  staticPerHand: [0.3, 1.5, 0.02], kineticPerHand: [0.1, 1.2, 0.02], mass: [0.0005, 0.006, 0.0001],
  damp: [0.5, 8, 0.1], vmax: [150, 900, 10], knowerWeight: [1, 2.5, 0.05], brake: [0, 15, 0.5],
  oppose: [0, 1, 0.05], alignDeg: [10, 60, 1], tremble: [0, 25, 0.5], selRadius: [20, 60, 1],
  selSpeed: [20, 160, 5], dwell: [0.2, 1.5, 0.05],
};

const $ = (id) => document.getElementById(id);
const cv = $("cv");
const ctx = cv.getContext("2d");
const stage = $("stage");

let net;
let tune = { ...DEFAULT_TUNE };
let whisper = null;
let knowerId = null;
let fit = { s: 1, ox: 0, oy: 0, dpr: 1 };
let boardImg = null;
let lastFrame = performance.now(), fps = 60;

// ------------------------------------------------------------ boot

async function boot() {
  const q = new URLSearchParams(location.search);
  let code = (q.get("room") || "").toUpperCase();
  if (!/^[A-HJ-NP-Z]{4}$/.test(code)) {
    code = await createRoom(true);
    history.replaceState(null, "", `?room=${code}`);
  }
  $("room").textContent = `Room ${code}`;
  net = new Net(code);
  net.addEventListener("welcome", (e) => {
    tune = { ...e.detail.tune };
    buildSliders();
    $("bots").value = e.detail.bots; $("botsV").textContent = e.detail.bots;
    $("skill").value = e.detail.skill; $("skillV").textContent = e.detail.skill;
  });
  net.addEventListener("tune", (e) => { tune = { ...e.detail.tune }; syncSliders(); });
  net.addEventListener("w", (e) => { whisper = e.detail.k; knowerId = e.detail.knower; });
  net.addEventListener("pick", (e) => toast(e.detail.ok ? `${label(e.detail.k)} ✓  (${e.detail.took}s)` : `Read ${label(e.detail.k)} - not it`, e.detail.ok));
  net.addEventListener("done", (e) => toast(`The spirit said: ${e.detail.phrase}`, true, 2400));
  net.addEventListener("error", (e) => toast(e.detail.reason === "full" ? "Room is full" : "No such room", false, 5000));
  net.addEventListener("replaced", () => toast("Opened in another tab", false, 5000));
  net.addEventListener("status", (e) => { if (!e.detail.connected) $("whisper").textContent = "Reconnecting..."; });
  net.connect();
  resize();
  requestAnimationFrame(frame);
}

const label = (k) => (k === "~" ? "next word" : k);

let toastTimer;
function toast(text, good = true, ms = 1300) {
  const t = $("toast");
  t.textContent = text;
  t.style.color = good ? "var(--mint)" : "var(--rose)";
  t.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.style.opacity = 0), ms);
}

// ------------------------------------------------------------ sliders

function buildSliders() {
  const box = $("sliders");
  box.innerHTML = "";
  for (const k of LAB_KEYS) {
    const [lo, hi, st] = RANGES[k] || [0, 10, 0.1];
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${k}</span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${tune[k]}" data-k="${k}"><span>${fmt(tune[k])}</span>`;
    const inp = row.querySelector("input");
    inp.addEventListener("input", () => {
      row.lastChild.textContent = fmt(Number(inp.value));
      net.send({ t: "tune", tune: { [k]: Number(inp.value) } });
    });
    box.appendChild(row);
  }
}
function syncSliders() {
  for (const inp of document.querySelectorAll("#sliders input")) {
    const k = inp.dataset.k;
    if (document.activeElement !== inp) { inp.value = tune[k]; inp.parentElement.lastChild.textContent = fmt(tune[k]); }
  }
}
const fmt = (v) => (Math.abs(v) < 0.01 ? v.toFixed(4) : Math.abs(v) < 10 ? v.toFixed(2) : Math.round(v));

$("toggle").onclick = () => $("panel").classList.toggle("open");
$("reset").onclick = () => net.send({ t: "tune-reset" });
$("skip").onclick = () => net.send({ t: "skip" });
for (const id of ["bots", "skill"]) {
  $(id).addEventListener("input", () => {
    $(id + "V").textContent = $(id).value;
    net.send({ t: "bots", n: Number($("bots").value), skill: Number($("skill").value) });
  });
}
$("copy").onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); toast("Invite link copied"); }
  catch { toast(location.href); }
};

// ------------------------------------------------------------ layout & board art

function resize() {
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  const pad = 10;
  const s = Math.min((r.width - pad * 2) / BOARD_W, (r.height - pad * 2 - 30) / BOARD_H);
  fit = { s, ox: (r.width - BOARD_W * s) / 2, oy: (r.height - BOARD_H * s) / 2 + 12, dpr };
  boardImg = drawBoard();
}
window.addEventListener("resize", resize);

function drawBoard() {
  const c = document.createElement("canvas");
  c.width = Math.round(BOARD_W * fit.s * fit.dpr);
  c.height = Math.round(BOARD_H * fit.s * fit.dpr);
  const g = c.getContext("2d");
  g.scale(fit.s * fit.dpr, fit.s * fit.dpr);
  const grad = g.createLinearGradient(0, 0, 0, BOARD_H);
  grad.addColorStop(0, "#3a2c4f");
  grad.addColorStop(1, "#271d36");
  g.fillStyle = grad;
  roundRect(g, 4, 4, BOARD_W - 8, BOARD_H - 8, 46);
  g.fill();
  g.strokeStyle = "rgba(242,196,109,.35)";
  g.lineWidth = 3;
  roundRect(g, 16, 16, BOARD_W - 32, BOARD_H - 32, 36);
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const t of TARGETS) {
    if (t.k.length === 1 && t.k !== "~") {
      g.font = "600 54px Georgia, 'Times New Roman', serif";
      g.fillStyle = "#f3ecdf";
      g.fillText(t.k, t.x, t.y);
    } else {
      g.font = "600 34px Georgia, serif";
      g.fillStyle = "#cbbfe0";
      g.fillText(t.label.toUpperCase(), t.x, t.y);
    }
  }
  return c;
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

const toScreen = (x, y) => [fit.ox + x * fit.s, fit.oy + y * fit.s];
const toBoard = (sx, sy) => [(sx - fit.ox) / fit.s, (sy - fit.oy) / fit.s];

// ------------------------------------------------------------ input

const input = { x: 0, y: 0, m: 0, down: false, src: null, pid: null, padStart: null };
const keys = new Set();
let lastSent = 0, lastSig = "";
let planchetteScreen = [0, 0];

// A hand resting on the board pushes from the planchette toward the pointer.
// The pointer may sit perfectly still, so this is re-aimed every frame.
let aimClient = null;
function boardPush(clientX, clientY) { aimClient = [clientX, clientY]; reaim(); }
function reaim() {
  if (!aimClient || (input.src !== "hover" && input.src !== "touch")) return;
  const r = cv.getBoundingClientRect();
  const [bx, by] = toBoard(aimClient[0] - r.left, aimClient[1] - r.top);
  const s = net && net.sample();
  if (!s) return;
  const dx = bx - s.x, dy = by - s.y, d = Math.hypot(dx, dy);
  input.x = dx; input.y = dy;
  input.m = Math.max(0, Math.min(1, (d - 6) / 60));
}

cv.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse") { input.down = true; input.src = "hover"; boardPush(e.clientX, e.clientY); }
  else if (input.pid === e.pointerId) boardPush(e.clientX, e.clientY);
});
cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && input.src === "hover") { input.down = false; input.m = 0; } });
cv.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  if (input.pid !== null) return; // first finger only
  input.pid = e.pointerId; input.down = true; input.src = "touch";
  cv.setPointerCapture(e.pointerId);
  boardPush(e.clientX, e.clientY);
});
const endTouch = (e) => { if (e.pointerId === input.pid) { input.pid = null; input.down = false; input.m = 0; } };
cv.addEventListener("pointerup", endTouch);
cv.addEventListener("pointercancel", endTouch);

const pad = $("pad");
pad.addEventListener("pointerdown", (e) => {
  if (input.pid !== null) return;
  input.pid = e.pointerId; input.down = true; input.src = "pad";
  input.padStart = [e.clientX, e.clientY]; input.m = 0;
  pad.setPointerCapture(e.pointerId);
});
pad.addEventListener("pointermove", (e) => {
  if (e.pointerId !== input.pid || !input.padStart) return;
  const dx = e.clientX - input.padStart[0], dy = e.clientY - input.padStart[1], d = Math.hypot(dx, dy);
  input.x = dx; input.y = dy; input.m = Math.max(0, Math.min(1, (d - 6) / 70));
});
const endPad = (e) => { if (e.pointerId === input.pid) { input.pid = null; input.down = false; input.m = 0; input.padStart = null; } };
pad.addEventListener("pointerup", endPad);
pad.addEventListener("pointercancel", endPad);

const KEYMAP = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
window.addEventListener("keydown", (e) => { if (KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); } });
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("contextmenu", (e) => e.preventDefault());

function currentInput() {
  if (keys.size) {
    let x = 0, y = 0;
    for (const k of keys) { x += KEYMAP[k][0]; y += KEYMAP[k][1]; }
    return { x, y, m: x || y ? 1 : 0, d: true };
  }
  return { x: input.x, y: input.y, m: input.down ? input.m : 0, d: input.down };
}

function pumpInput(now) {
  if (!net || !net.connected) return;
  if (input.down) reaim();
  const i = currentInput();
  const sig = `${i.d}|${Math.round(Math.atan2(i.y, i.x) * 20)}|${Math.round(i.m * 20)}`;
  if (now - lastSent > 50 && (sig !== lastSig || (i.d && now - lastSent > 250))) {
    net.send({ t: "in", x: +i.x.toFixed(2), y: +i.y.toFixed(2), m: +i.m.toFixed(2), d: i.d });
    lastSent = now; lastSig = sig;
  }
}

// ------------------------------------------------------------ frame

function frame(now) {
  requestAnimationFrame(frame);
  const dt = now - lastFrame; lastFrame = now;
  fps = fps * 0.95 + (1000 / Math.max(1, dt)) * 0.05;
  pumpInput(now);
  const s = net && net.sample();
  const r = stage.getBoundingClientRect();
  ctx.setTransform(fit.dpr, 0, 0, fit.dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  if (boardImg) ctx.drawImage(boardImg, fit.ox, fit.oy, BOARD_W * fit.s, BOARD_H * fit.s);
  if (!s) return;

  // Letter under the window, with its dwell ring; the knower's letter glows.
  if (whisper && TARGET_BY_KEY[whisper]) glow(TARGET_BY_KEY[whisper], "rgba(242,196,109,.55)", 46);
  if (s.o && TARGET_BY_KEY[s.o]) {
    const t = TARGET_BY_KEY[s.o];
    glow(t, "rgba(127,224,195,.35)", 40);
    const [cx, cy] = toScreen(t.x, t.y);
    ctx.strokeStyle = "#7fe0c3"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, 44 * fit.s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.d)); ctx.stroke();
  }

  const px = s.x + s.sx, py = s.y + s.sy;
  const [sx, sy] = toScreen(px, py);
  planchetteScreen = [sx, sy];
  drawPlanchette(sx, sy, s);

  // Hands: fingertips on the rim, leaning the way each one pushes.
  const R = 74 * fit.s;
  for (const [id, ux, uy, m, bot, act] of s.h) {
    if (!act) continue;
    const mine = id === net.id;
    let hx = ux, hy = uy, hm = m;
    if (mine) { const i = currentInput(); const l = Math.hypot(i.x, i.y) || 1; hx = i.x / l; hy = i.y / l; hm = i.m; }
    if (hm < 0.04) continue;
    const ex = sx + hx * (R + hm * 26 * fit.s), ey = sy + hy * (R + hm * 26 * fit.s);
    ctx.fillStyle = mine ? "rgba(242,196,109,.95)" : bot ? "rgba(203,191,224,.55)" : "rgba(127,224,195,.8)";
    ctx.beginPath(); ctx.arc(ex, ey, (mine ? 9 : 7) * Math.max(0.7, fit.s * 1.6), 0, Math.PI * 2); ctx.fill();
    if (id === s.k) { ctx.strokeStyle = "rgba(242,196,109,.9)"; ctx.lineWidth = 2; ctx.stroke(); }
  }

  // Progress dots for the phrase.
  for (let i = 0; i < s.L; i++) {
    const dx = r.width / 2 + (i - (s.L - 1) / 2) * 16, dy = r.height - 34;
    ctx.fillStyle = i < s.g ? "#7fe0c3" : i === s.g ? "#f2c46d" : "#4a3f60";
    ctx.beginPath(); ctx.arc(dx, dy, 5, 0, Math.PI * 2); ctx.fill();
  }

  const knowerName = (s.names.find((n) => n[0] === s.k) || [0, "?"])[1];
  $("whisper").textContent = whisper
    ? `You know this letter: ${label(whisper)} - push toward it`
    : s.k === net.id ? "..." : `${knowerName} knows this letter - feel the pull and push with it`;
  $("stats").textContent = `rtt ${Math.round(net.rtt)}ms | ${Math.round(fps)}fps | hands ${s.a}/${s.n} | power ${s.p.toFixed(2)}`;
}

function glow(t, color, rad) {
  const [cx, cy] = toScreen(t.x, t.y);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * fit.s * 1.6);
  g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, rad * fit.s * 1.6, 0, Math.PI * 2); ctx.fill();
}

function drawPlanchette(sx, sy, s) {
  const k = fit.s;
  ctx.save();
  ctx.translate(sx, sy);
  // Body: a soft rounded heart shape with a round window at the reading point.
  ctx.fillStyle = "rgba(243,236,223,.16)";
  ctx.strokeStyle = "rgba(243,236,223,.85)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -62 * k);
  ctx.bezierCurveTo(70 * k, -60 * k, 82 * k, 30 * k, 0, 70 * k);
  ctx.bezierCurveTo(-82 * k, 30 * k, -70 * k, -60 * k, 0, -62 * k);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(22,18,31,.35)";
  ctx.beginPath(); ctx.arc(0, 0, 30 * k, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(242,196,109,.9)"; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, 30 * k, 0, Math.PI * 2); ctx.stroke();
  // Ring of segments: lights up as hands line up; full = it moves.
  const n = s.n, lit = Math.min(s.a, n);
  const ringR = 94 * k, gap = 0.18;
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2 + gap / 2;
    const a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2 - gap / 2;
    ctx.strokeStyle = i < lit ? (lit >= n ? "#7fe0c3" : "#f2c46d") : "rgba(167,159,182,.25)";
    ctx.lineWidth = 6 * Math.max(0.6, k * 1.5);
    ctx.beginPath(); ctx.arc(0, 0, ringR, a0, a1); ctx.stroke();
  }
  ctx.restore();
}

boot().catch((e) => { $("whisper").textContent = `Could not start: ${e.message}`; });
