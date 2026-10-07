// Bot sitters (spec §5.3). They run inside the room on the same tick and feed
// the same input path as humans. They never count in N and are capped by the
// physics (botCap x human force), so they amplify people and never replace them.

import { TARGET_BY_KEY, LETTERS } from "./board.js";

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function newBotBrain(rand) {
  return { aim: null, want: null, reactAt: 0, errStart: 0, errAt: 0, errDir: 1, detourUntil: 0, detourAng: 0, m: 0, letterKey: null, wake: 0 };
}

// Called once per new letter so each letter gets fresh imperfections.
export function botNewLetter(brain, ctx) {
  brain.letterKey = ctx.target;
  brain.wake = ctx.now + (ctx.tutorial ? 600 : 400) + ctx.rand() * 300;
  brain.detourUntil = 0;
  if (!ctx.isKnower && ctx.rand() < 0.12) brain.detourPending = true;
}

// ctx: { now, rand, isKnower, target, lens:{x,y,vx,vy}, others:[{ux,uy,m,w,kind,knower}],
//        humanResting, assist, tutorial }
export function botThink(brain, ctx) {
  if (!ctx.humanResting) { brain.m = 0; return { ux: 0, uy: 0, m: 0 }; }
  return ctx.isKnower ? knowerThink(brain, ctx) : followerThink(brain, ctx);
}

// The knower aims at its letter with a little error, waits as long as it
// takes, and lets go once the lens is close, so the capture spring settles it.
function knowerThink(brain, ctx) {
  const T = ctx.target && TARGET_BY_KEY[ctx.target];
  if (!T || ctx.now < brain.wake) return { ux: 0, uy: 0, m: 0 };
  const dx = T.x - ctx.lens.x, dy = T.y - ctx.lens.y, d = Math.hypot(dx, dy);
  if (d < 45) return { ux: dx / (d || 1), uy: dy / (d || 1), m: 0 };
  const err = ctx.assist ? 0 : (brain.errDir * 10 * DEG);
  if (ctx.rand() < 0.01) brain.errDir = ctx.rand() < 0.5 ? -1 : 1;
  const a = Math.atan2(dy, dx) + err;
  return { ux: Math.cos(a), uy: Math.sin(a), m: 1 };
}

// A follower feels the pull of the knower and the people (never its own push
// or other followers' bots), re-aims late and imperfectly, then improves.
function followerThink(brain, ctx) {
  let sx = 0, sy = 0;
  for (const h of ctx.others) {
    if (h.kind === "bot" && !h.knower) continue;
    sx += h.ux * h.m * h.w;
    sy += h.uy * h.m * h.w;
  }
  const s = Math.hypot(sx, sy);
  if (s < 0.3) { brain.m = Math.max(0, brain.m - 0.15); return out(brain); }

  const groupAng = Math.atan2(sy, sx);
  const react = ctx.assist ? 200 : ctx.tutorial ? 600 + ctx.rand() * 300 : 350 + ctx.rand() * 550;
  if (brain.want === null || Math.abs(wrap(groupAng - brain.want)) > 30 * DEG) {
    brain.want = groupAng;
    brain.reactAt = ctx.now + react;
    brain.errStart = (ctx.assist ? 0 : 35) * (ctx.rand() < 0.5 ? -1 : 1) * DEG;
    brain.errAt = brain.reactAt;
  } else {
    brain.want = groupAng; // small drift: track it smoothly
  }
  if (ctx.now < brain.reactAt) return out(brain);

  // Heading error shrinks from +/-35 deg to +/-8 deg over 1.2 s.
  const t = Math.min(1, (ctx.now - brain.errAt) / 1200);
  const err = ctx.assist ? 0 : brain.errStart * (1 - t) + Math.sign(brain.errStart) * 8 * DEG * t;
  let ang = brain.want + err;

  // Now and then, a short detour toward a neighbouring letter, then correct.
  if (brain.detourPending && t > 0.2) {
    brain.detourPending = false;
    brain.detourUntil = ctx.now + 400;
    brain.detourAng = ang + (ctx.rand() < 0.5 ? -1 : 1) * 40 * DEG;
  }
  if (ctx.now < brain.detourUntil) ang = brain.detourAng;

  brain.aim = ang;
  brain.m = Math.min(1, brain.m + 0.12);
  return out(brain);
}

function out(brain) {
  if (brain.aim === null) return { ux: 0, uy: 0, m: 0 };
  return { ux: Math.cos(brain.aim), uy: Math.sin(brain.aim), m: brain.m };
}

// Exposed for tests and the attract loop.
export const _internal = { LETTERS };
