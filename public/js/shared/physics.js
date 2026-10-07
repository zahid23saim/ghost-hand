// The shared-planchette physics (spec §3). Pure and deterministic: the server
// runs it authoritatively at 30 Hz; tests and the local lab run it too.
//
// world = {
//   planchette: { x, y, vx, vy, sliding, captured, closedMs, stuckMs, dwellP, lastInked,
//                 wobble: { key, ms, done }, sameMs },
//   hands: [{ kind: 'human'|'bot'|'hush', w, ux, uy, m }],
//   knower: index into hands or -1,
//   Tstart, target (letter key or null), captureScale, hushBlowing,
//   gust: null | { dx, dy, ms, speed }   (Last Biscuit "Gust" twist: a short sideways nudge)
// }
// step() mutates world and returns { events: [...], A, r, dirS, gate, stir }.

import { TARGET_BY_KEY, LETTERS, LENS_BOUNDS } from "./board.js";

const DEG = 180 / Math.PI;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function newPlanchette(x, y) {
  return {
    x, y, vx: 0, vy: 0, sliding: false, captured: false,
    closedMs: 1000, stuckMs: 0, dwellP: 0, lastInked: null,
    wobble: { key: null, ms: 0, done: false }, sameMs: -1,
  };
}

// a(theta): 1 when aligned, 0 when sideways, -1 when pushing against (spec §3.2).
export function align(deg, cfg) {
  if (deg <= cfg.alignFull) return 1;
  if (deg <= cfg.alignZero) return 1 - (deg - cfg.alignFull) / (cfg.alignZero - cfg.alignFull);
  if (deg <= cfg.opposeStart) return 0;
  if (deg <= cfg.opposeFull) return -(deg - cfg.opposeStart) / (cfg.opposeFull - cfg.opposeStart);
  return -1;
}

const angleBetween = (ax, ay, bx, by) => {
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return 180;
  return Math.acos(clamp((ax * bx + ay * by) / (la * lb), -1, 1)) * DEG;
};

// Aligned weight A and the direction of travel (spec §3.2).
export function alignedWeight(hands, cfg) {
  let s0x = 0, s0y = 0;
  for (const h of hands) {
    h.eff = Math.min(1, h.m / cfg.effSat);
    h.vx = h.ux * h.w * h.eff;
    h.vy = h.uy * h.w * h.eff;
    s0x += h.vx; s0y += h.vy;
    h.c = 0; h.counted = false;
  }
  if (Math.hypot(s0x, s0y) < cfg.minDir) return { A: 0, dirX: 0, dirY: 0, hasDir: false };

  let Hs = 0, B = 0, shx = 0, shy = 0, sbx = 0, sby = 0;
  for (const h of hands) {
    const mag = Math.hypot(h.vx, h.vy);
    h.c = mag * align(angleBetween(h.ux, h.uy, s0x, s0y), cfg);
    if (h.kind === "human") { Hs += h.c; shx += h.vx; shy += h.vy; }
    else { B += Math.max(0, h.c); sbx += h.vx; sby += h.vy; }
  }
  const Beff = Math.min(B, cfg.botCap * Math.max(Hs, 0));
  const k = B > 0 ? Beff / B : 0;
  const sx = shx + sbx * k, sy = shy + sby * k;
  const sl = Math.hypot(sx, sy);
  for (const h of hands) {
    h.counted = h.kind === "human" ? h.c >= 0.5 * h.w : k > 0 && h.c > 0;
  }
  return { A: Hs + Beff, dirX: sl > 1e-6 ? sx / sl : 0, dirY: sl > 1e-6 ? sy / sl : 0, hasDir: sl > 1e-6 };
}

export function step(world, cfg, dt) {
  const P = world.planchette;
  const events = [];
  const hands = world.hands;
  const kn = world.knower >= 0 ? hands[world.knower] : null;
  const { A, dirX, dirY, hasDir } = alignedWeight(hands, cfg);

  const opposing = kn && hasDir && kn.m >= 0.3 && angleBetween(kn.ux, kn.uy, dirX, dirY) > 90;
  let Teff = P.sliding && !opposing ? cfg.keep * world.Tstart : world.Tstart;
  // Capture bonus grows with the table (relative to a 2-human table), so a big
  // table of followers can't drag the lens off the right letter on momentum.
  if (P.captured) Teff += cfg.captureBonus * Math.max(1, world.Tstart / (cfg.crew * (cfg.knowerWeight + 1) * cfg.thresholdScale));
  const gate = hasDir && A > Teff;
  const r = Teff > 0 ? A / Teff : 0;

  // Target speed, with invisible easing on the approach to the right letter.
  const T = world.target ? TARGET_BY_KEY[world.target] : null;
  let vtx = 0, vty = 0, tau = cfg.tauStop;
  if (gate) {
    const frac = clamp((A - Teff) / (cfg.excessSpan * world.Tstart), 0, 1);
    let vs = cfg.vMax * (cfg.vFloor + (1 - cfg.vFloor) * frac);
    if (T) {
      const d = Math.hypot(T.x - P.x, T.y - P.y);
      const sp = Math.hypot(P.vx, P.vy);
      const heading = sp > 1 ? angleBetween(P.vx, P.vy, T.x - P.x, T.y - P.y) : angleBetween(dirX, dirY, T.x - P.x, T.y - P.y);
      if (d < cfg.approachR && heading <= 50) {
        vs = Math.min(vs, lerp(cfg.approachMin, cfg.vMax, clamp((d - cfg.captureR) / (cfg.approachR - cfg.captureR), 0, 1)));
      }
    }
    vtx = dirX * vs; vty = dirY * vs;
    tau = vs >= Math.hypot(P.vx, P.vy) ? cfg.tauUp : cfg.tauStop;
  }
  // Gust: a sideways nudge that only rides on a moving, pushed planchette (so it
  // never moves a still or unpushed one), capped at vMax.
  const G = world.gust;
  if (G && G.ms > 0) {
    if (gate) {
      vtx += G.dx * G.speed; vty += G.dy * G.speed;
      const vl = Math.hypot(vtx, vty);
      if (vl > cfg.vMax) { vtx *= cfg.vMax / vl; vty *= cfg.vMax / vl; }
      tau = cfg.tauUp;
    }
    G.ms -= dt * 1000;
  }
  if (world.hushBlowing && T) {
    const dx = T.x - P.x, dy = T.y - P.y, d = Math.hypot(dx, dy) || 1;
    vtx = (dx / d) * cfg.blowSpeed; vty = (dy / d) * cfg.blowSpeed;
    tau = cfg.tauUp;
  }
  const kv = 1 - Math.exp(-dt / tau);
  P.vx += (vtx - P.vx) * kv;
  P.vy += (vty - P.vy) * kv;

  // Capture: a critically damped spring centres the right letter (spec §3.5).
  P.captured = false;
  if (T) {
    const capR = (world.target.length > 1 ? cfg.specialCaptureR : cfg.captureR) * (world.captureScale || 1);
    const dx = T.x - P.x, dy = T.y - P.y, d = Math.hypot(dx, dy);
    const pushingAway = kn && kn.m > 0.5 && d > 1e-6 && (kn.ux * dx + kn.uy * dy) / d < -0.5;
    if (d < capR && !pushingAway) {
      P.captured = true;
      if (!gate) {
        P.vx += (cfg.capK * dx - cfg.capC * P.vx) * dt;
        P.vy += (cfg.capK * dy - cfg.capC * P.vy) * dt;
      }
    }
  }

  // Integrate and keep the lens on the board; no bounce.
  P.x += P.vx * dt;
  P.y += P.vy * dt;
  const b = LENS_BOUNDS;
  if (P.x < b.x0) { P.x = b.x0; if (P.vx < 0) P.vx = 0; }
  if (P.x > b.x1) { P.x = b.x1; if (P.vx > 0) P.vx = 0; }
  if (P.y < b.y0) { P.y = b.y0; if (P.vy < 0) P.vy = 0; }
  if (P.y > b.y1) { P.y = b.y1; if (P.vy > 0) P.vy = 0; }

  // Breakaway after being stuck; stick again when slow with the gate closed.
  const speed = Math.hypot(P.vx, P.vy);
  if (gate) {
    if (!P.sliding && P.closedMs >= cfg.stickMs) events.push({ k: "breakaway" });
    P.sliding = true;
    P.closedMs = 0;
    P.stuckMs = 0;
  } else {
    P.closedMs += dt * 1000;
    if (!P.captured && speed < cfg.stickSpeed) {
      P.stuckMs += dt * 1000;
      if (P.stuckMs >= cfg.stickMs) { P.vx = 0; P.vy = 0; P.sliding = false; }
    } else {
      P.stuckMs = 0;
    }
    if (P.captured && speed < cfg.stickSpeed) P.sliding = false;
  }

  // Ink: only the target ever inks (spec §3.5).
  if (T) {
    const d = Math.hypot(T.x - P.x, T.y - P.y);
    if (P.sameMs >= 0) {
      // The new target was already under the lens: bounce-ink after a beat.
      if (d <= cfg.inkR) {
        P.sameMs += dt * 1000;
        if (P.sameMs >= cfg.sameLetterMs) {
          P.sameMs = -1; P.dwellP = 0;
          events.push({ k: "ink", key: world.target, bounce: true });
        }
      } else {
        P.sameMs = -1;
      }
    } else if (d <= cfg.inkR && speed < cfg.inkSpeed) {
      P.dwellP += dt / cfg.dwell;
      if (P.dwellP >= 1) { P.dwellP = 0; events.push({ k: "ink", key: world.target }); }
    } else {
      P.dwellP = Math.max(0, P.dwellP - (dt / cfg.dwell) * cfg.drain);
    }
  } else {
    P.dwellP = 0;
  }

  // Wobble: resting on a wrong letter for a second makes it shiver, once per visit.
  updateWobble(P, world, cfg, dt, speed, events);

  const stir = !P.sliding && r >= cfg.stirMin;
  return { events, A, r, dirX, dirY, hasDir, gate, stir };
}

function updateWobble(P, world, cfg, dt, speed, events) {
  let near = null, nd = Infinity;
  for (const l of LETTERS) {
    const d = Math.hypot(l.x - P.x, l.y - P.y);
    if (d < nd) { nd = d; near = l; }
  }
  const W = P.wobble;
  if (P.lastInked && near && near.k === P.lastInked && nd <= 45) return; // just inked; exempt until we leave it
  if (P.lastInked && (!near || near.k !== P.lastInked || nd > 45)) P.lastInked = null;
  if (!near || nd > 45) { W.key = null; W.ms = 0; W.done = false; return; }
  if (W.key !== near.k) { W.key = near.k; W.ms = 0; W.done = false; }
  if (near.k === world.target || W.done) return;
  if (nd <= 30 && speed < cfg.inkSpeed) {
    W.ms += dt * 1000;
    if (W.ms >= cfg.wobbleTime * 1000) { W.done = true; events.push({ k: "wobble", key: near.k }); }
  }
}

// Called by the game when a new target is set: if it is already under the
// lens (double letters), it inks itself after a short bounce.
export function setTarget(world, key, cfg) {
  world.target = key;
  const P = world.planchette;
  P.dwellP = 0;
  P.sameMs = -1;
  if (!key) return;
  const T = TARGET_BY_KEY[key];
  if (T && Math.hypot(T.x - P.x, T.y - P.y) <= cfg.inkR) P.sameMs = 0;
}

// Hand quota per word (spec §3.5): q = max(2, ceil(frac * len)), trimmed to the budget.
export function quotas(lengths, budget, frac) {
  const q = lengths.map((len) => Math.min(len - 1, Math.max(2, Math.ceil(frac * len))));
  for (let i = 0; i < q.length; i++) if (lengths[i] <= 2) q[i] = Math.max(1, lengths[i] - 1);
  let sum = q.reduce((a, b) => a + b, 0);
  while (sum > budget) {
    let pick = -1;
    for (let i = q.length - 1; i >= 0; i--) if (q[i] > 2 && (pick < 0 || q[i] > q[pick])) pick = i;
    if (pick < 0) break;
    q[pick]--; sum--;
  }
  return q;
}
