// Physics invariants (spec §3.8) and behaviour checks.
import { makeConfig, tStart } from "../public/js/shared/config.js";
import { step, newPlanchette, setTarget, quotas, alignedWeight } from "../public/js/shared/physics.js";
import { TARGET_BY_KEY, HOME } from "../public/js/shared/board.js";
import { rng } from "../public/js/shared/rng.js";
let fail = 0; const ok = (c, m) => { console.log((c ? "  PASS  " : "  FAIL  ") + m); if (!c) fail++; };
const DT = 1 / 30;
const cfg = makeConfig();
const hand = (kind, w, ang, m) => ({ kind, w, ux: Math.cos(ang), uy: Math.sin(ang), m });
function world(hands, Tstart, target = null, knower = -1) {
  return { planchette: newPlanchette(HOME.x, HOME.y), hands, knower, Tstart, target, captureScale: 1, hushBlowing: false };
}
const moved = (w) => Math.hypot(w.planchette.x - HOME.x, w.planchette.y - HOME.y);
function run(w, secs, c = cfg) { let maxV = 0; for (let t = 0; t < secs; t += DT) { step(w, c, DT); maxV = Math.max(maxV, Math.hypot(w.planchette.vx, w.planchette.vy)); } return maxV; }

// 1. Every human at zero push: bots alone never move it (10k fuzzed states).
const R = rng(99); let worst = 0;
for (let i = 0; i < 10000; i++) {
  const nb = 1 + Math.floor(R() * 3), nh = 1 + Math.floor(R() * 4);
  const hs = [];
  for (let j = 0; j < nh; j++) hs.push(hand("human", j === 0 ? 1.5 : 1, R() * 6.28, 0));
  for (let j = 0; j < nb; j++) hs.push(hand(R() < 0.3 ? "hush" : "bot", R() < 0.5 ? 1.5 : 1, R() * 6.28, R()));
  const { A } = alignedWeight(hs, cfg);
  worst = Math.max(worst, A);
}
ok(worst <= 1e-9, `bots alone never produce force (max A ${worst.toFixed(4)} over 10k states)`);
const wb = world([hand("human", 1, 0, 0), hand("bot", 1, 0, 1), hand("bot", 1, 0, 1)], tStart(cfg, 1));
run(wb, 3); ok(moved(wb) < 0.5, "solo: bots pushing with a still human never move it");

// 2. Minimum crew minus one follower cannot start it (normal tables, both scales).
for (const scale of [1.0, 0.95]) {
  const c = makeConfig({ thresholdScale: scale });
  for (let N = 2; N <= 6; N++) {
    const followersNeeded = Math.ceil((Math.max(2, N) - 1) / 2);
    const hs = [hand("human", 1.5, 0, 1)];
    for (let j = 0; j < followersNeeded - 1; j++) hs.push(hand("human", 1, 0, 1));
    while (hs.length < N) hs.push(hand("human", 1, 0, 0));
    const w = world(hs, tStart(c, N), null, 0);
    run(w, 2, c);
    ok(moved(w) < 0.5, `N=${N} scale ${scale}: knower + ${followersNeeded - 1} cannot start it (T=${tStart(c, N).toFixed(3)})`);
    const w2 = world([hand("human", 1.5, 0, 1), ...Array.from({ length: followersNeeded }, () => hand("human", 1, 0, 1)), ...Array.from({ length: Math.max(0, N - 1 - followersNeeded) }, () => hand("human", 1, 0, 0))], tStart(c, N), null, 0);
    run(w2, 1, c);
    ok(moved(w2) > 50, `N=${N} scale ${scale}: knower + ${followersNeeded} does move it`);
  }
}

// 3. A knower opposing at full push vetoes aligned followers below T_start.
for (const N of [4, 6]) {
  const hs = [hand("human", 1.5, Math.PI, 1), ...Array.from({ length: N - 1 }, () => hand("human", 1, 0, 1))];
  const w = world(hs, tStart(cfg, N), null, 0);
  run(w, 2);
  ok(moved(w) < 0.5, `N=${N}: knower opposing vetoes ${N - 1} followers`);
}

// 4. 2-human table: one human never moves it.
for (const w0 of [1.5, 1]) {
  const w = world([hand("human", w0, 0.3, 1), hand("human", 1, 0, 0)], tStart(cfg, 2), null, w0 > 1 ? 0 : -1);
  run(w, 2); ok(moved(w) < 0.5, `2 humans: a single hand (weight ${w0}) cannot move it`);
}

// 5. Max speed 240 for any N; breakaway speed with N=2 >= 180.
for (const N of [2, 4, 6]) {
  const w = world(Array.from({ length: N }, (_, j) => hand("human", j ? 1 : 1.5, 0, 1)), tStart(cfg, N), null, 0);
  const vmax = run(w, 2);
  ok(vmax <= 240.01, `N=${N}: top speed ${vmax.toFixed(1)} <= 240`);
}
{
  const w = world([hand("human", 1.5, 0, 1), hand("human", 1, 0, 1)], tStart(cfg, 2), null, 0);
  const v = run(w, 1.5); ok(v >= 180, `N=2 breakaway speed ${v.toFixed(1)} >= 180`);
}

// Behaviour: ink only the target, capture settles, wobble on wrong letters, double letters.
{
  const T = TARGET_BY_KEY.M;
  const w = world([hand("human", 1.5, 0, 0), hand("human", 1, 0, 0)], tStart(cfg, 2), null, 0);
  setTarget(w, "M", cfg);
  let ink = null, t = 0, wrongInk = false;
  for (; t < 10 && !ink; t += DT) {
    const P = w.planchette, d = Math.hypot(T.x - P.x, T.y - P.y), a = Math.atan2(T.y - P.y, T.x - P.x);
    const m = d > 24 ? 1 : 0;   // both push at M, release when on it
    w.hands[0] = hand("human", 1.5, a, m); w.hands[1] = hand("human", 1, a, m);
    const out = step(w, cfg, DT);
    for (const e of out.events) { if (e.k === "ink") { ink = e.key; } }
  }
  ok(ink === "M", `two hands spell M from home in ${t.toFixed(2)} s`);
}
{
  // Rest on a wrong letter (K) with a target elsewhere: wobble, never ink.
  const K = TARGET_BY_KEY.K;
  const w = world([hand("human", 1.5, 0, 0), hand("human", 1, 0, 0)], tStart(cfg, 2), null, 0);
  w.planchette.x = K.x; w.planchette.y = K.y;
  setTarget(w, "A", cfg);
  const evs = []; for (let t = 0; t < 2; t += DT) evs.push(...step(w, cfg, DT).events);
  ok(evs.some((e) => e.k === "wobble" && e.key === "K") && !evs.some((e) => e.k === "ink"), "resting on a wrong letter wobbles once and never inks");
}
{
  const O = TARGET_BY_KEY.O;
  const w = world([hand("human", 1.5, 0, 0), hand("human", 1, 0, 0)], tStart(cfg, 2), null, 0);
  w.planchette.x = O.x; w.planchette.y = O.y;
  setTarget(w, "O", cfg);
  let at = null; for (let t = 0; t < 2 && at === null; t += DT) if (step(w, cfg, DT).events.some((e) => e.k === "ink")) at = t;
  ok(at !== null && at >= 0.75 && at <= 0.9, `double letter bounce-inks after ~0.8 s (got ${at && at.toFixed(2)})`);
}
{
  // Hush blowing reaches the target with nobody pushing.
  const w = world([hand("human", 1.5, 0, 0)], tStart(cfg, 2), null, 0);
  setTarget(w, "Q", cfg); w.hushBlowing = true;
  let ink = false; for (let t = 0; t < 15 && !ink; t += DT) { const out = step(w, cfg, DT); if (w.planchette.captured) w.hushBlowing = false; ink = out.events.some((e) => e.k === "ink"); }
  ok(ink, "Hush blowing always reaches and inks the target");
}
{
  // Gust twist: never moves a still or unpushed planchette, never beats vMax, nudges sideways.
  const still = world([hand("human", 1.5, 0, 0), hand("human", 1, 0, 0)], tStart(cfg, 2), null, 0);
  still.gust = { dx: 0, dy: 1, ms: 600, speed: cfg.gustSpeed };
  run(still, 1); ok(moved(still) < 1e-9, "a gust never moves an unpushed planchette");
  const w = world(Array.from({ length: 6 }, (_, j) => hand("human", j ? 1 : 1.5, 0, 1)), tStart(cfg, 6), null, 0);
  run(w, 1);
  const y0 = w.planchette.y;
  w.gust = { dx: 0, dy: 1, ms: 600, speed: cfg.gustSpeed };
  const v = run(w, 0.8);
  ok(v <= cfg.vMax + 1e-6 && w.planchette.y - y0 > 20 && w.gust.ms <= 0, `a gust nudges a sliding planchette sideways (${(w.planchette.y - y0).toFixed(0)} bu) within vMax`);
}
{
  // Capture holds against a 6-table of followers once the knower lets go.
  const T = TARGET_BY_KEY.M;
  const w = world([hand("human", 1.5, 0, 0), ...Array.from({ length: 5 }, () => hand("human", 1, 0, 1))], tStart(cfg, 6), null, 0);
  w.planchette.x = T.x; w.planchette.y = T.y;
  setTarget(w, "M", cfg);
  step(w, cfg, DT);
  run(w, 1);
  ok(Math.hypot(w.planchette.x - T.x, w.planchette.y - T.y) < cfg.captureR, "5 followers alone cannot drag the lens off a captured letter");
}
ok(JSON.stringify(quotas([4, 3], 10, 0.6)) === "[3,2]" && JSON.stringify(quotas([3, 4, 4], 10, 0.6)) === "[2,3,3]", "tutorial quotas: MORE 3, PIE 2, HUGS/NAPS 3");
ok(quotas([8, 8, 8, 8], 12, 0.6).reduce((a, b) => a + b) <= 12, "quota trims to the 12-letter budget");
console.log(fail ? `\n${fail} FAILED` : "\nall passed"); process.exit(fail ? 1 : 0);
