// Network and fairness simulation (spec §11.2, simplified): RoomCore driven by
// simulated players who see the table late (one-way latency + render delay)
// and whose inputs reach the server late, jittered, in order (WebSocket = TCP,
// so a lost packet arrives after a retransmit instead of vanishing), with one
// player going silent for 1.5 s mid-word every seance.
// Asserts every seance reaches the reveal under a time cap and the physics
// invariants hold on every tick; reports median seconds per hand letter.
import { RoomCore } from "../src/game/room-core.js";
import { content as fixture } from "./fixture-content.mjs";
import { TARGET_BY_KEY } from "../public/js/shared/board.js";
import { rng } from "../public/js/shared/rng.js";

let content = fixture;
if (process.argv.includes("--real")) {
  const [questions, words, hush, names] = await Promise.all(["questions", "words", "hush-lines", "names"].map((f) => import(`../public/js/shared/content/${f}.js`)));
  content = { questions, words, hush, names };
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok  " + m); } else { fail++; console.log("  FAIL " + m); } };

const TICK = 1000 / 30;
const RENDER_D = 150;          // client render delay (spec §4.7 starting D)
const JITTER = 80;             // +- ms one-way
const LOSS = 0.02;             // per packet; costs a retransmit (RTO 200 ms + RTT)
const SILENT_MS = 1500;
const capMs = (prof) => (prof === 30 ? 150_000 : prof === 150 ? 180_000 : 240_000); // per seance
const SEANCES = 4;             // First Cup, Second Cup, Last Biscuit whisper, Last Biscuit gust
const REPS = 6;                // tables per cell
const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// The server as each client sees it: one frame per tick.
function frameOf(core, now) {
  const P = core.planchette, sl = core.phase === "spell" ? core.currentSlot() : null;
  return {
    now, phase: core.phase, x: P.x, y: P.y, vx: P.vx, vy: P.vy, captured: P.captured,
    hasDir: core.last.hasDir, dirX: core.last.dirX, dirY: core.last.dirY, r: core.last.r || 0,
    target: core.world.target, knower: sl ? sl.seat : null,
  };
}

// A simulated player: reaction 400-900 ms, aim error up to 20 degrees.
function player(seat, oneWay, rand) {
  return {
    seat, oneWay, lastSent: null, lastSentAt: -1e9, arrivals: [], lastArrival: 0,
    silentFrom: -1, silentTo: -1,
    brain: { letter: null, wakeAt: 0, err: 0, want: null, aim: null, reactAt: 0, m: 0, stallMs: 0, relaxUntil: 0 },
    think(f, now) {
      const b = this.brain;
      const lead = f.phase === "warmup" || f.phase === "goodbye" || (f.phase === "spell" && f.knower === seat);
      if (!["warmup", "spell", "goodbye"].includes(f.phase) || !f.target) { b.letter = null; b.m = 0; return { ux: 1, uy: 0, m: 0 }; }
      const key = f.phase + f.target + (f.knower ?? "");
      if (key !== b.letter) { b.letter = key; b.wakeAt = now + 400 + rand() * 500; b.err = (rand() * 2 - 1) * 20 * DEG; }
      if (lead) {
        if (now < b.wakeAt) return { ux: 1, uy: 0, m: 0 };
        // People lead a late lens a little: extrapolate half the loop delay.
        const lead = (2 * this.oneWay + RENDER_D) / 2000;
        const T = TARGET_BY_KEY[f.target];
        const dx = T.x - (f.x + f.vx * lead), dy = T.y - (f.y + f.vy * lead), d = Math.hypot(dx, dy) || 1;
        const sp = Math.hypot(f.vx, f.vy);
        const away = f.vx * dx + f.vy * dy < 0 && sp > 15;
        if (d < 45 && !away) return { ux: dx / d, uy: dy / d, m: 0 }; // release on arrival
        // The knower's veto: when the table pulls the wrong way, pull straight against it.
        if (d >= 45 && f.hasDir && f.r > 0.5 && (f.dirX * dx + f.dirY * dy) / d < 0) return { ux: -f.dirX, uy: -f.dirY, m: 1 };
        if (d >= 45 && sp > 60 && (f.vx * dx + f.vy * dy) / (sp * d) < Math.cos(75 * DEG)) return { ux: -f.vx / sp, uy: -f.vy / sp, m: 1 };
        const a = Math.atan2(dy, dx) + (d < 45 ? 0 : b.err * Math.min(1, d / 200));
        return { ux: Math.cos(a), uy: Math.sin(a), m: 1 };
      }
      // Follower: reads the group direction (sDir) and eases off when the lens sticks.
      if (f.captured || !f.hasDir || f.r < 0.2 || now < b.relaxUntil) { b.m = Math.max(0, b.m - 0.2); b.want = null; return this.out(); }
      // Pushing and nothing moves: relax for a beat and feel for the pull again.
      b.stallMs = b.m > 0.5 && Math.hypot(f.vx, f.vy) < 40 ? b.stallMs + TICK : 0;
      if (b.stallMs > 2 * this.oneWay + RENDER_D + 350 + rand() * 250) { b.stallMs = 0; b.relaxUntil = now + 400; b.m = 0; b.want = null; return this.out(); }
      const g = Math.atan2(f.dirY, f.dirX);
      if (b.want === null || Math.abs(wrap(g - b.want)) > 30 * DEG) { b.want = g; b.reactAt = now + 400 + rand() * 500; b.err = (rand() * 2 - 1) * 20 * DEG; }
      else b.want = g;
      if (now < b.reactAt) return this.out();
      b.aim = b.want + b.err;
      b.err *= 0.97; // re-aims, improving
      b.m = Math.min(0.9, b.m + 0.15);
      return this.out();
    },
    out() { const b = this.brain; return b.aim === null ? { ux: 1, uy: 0, m: 0 } : { ux: Math.cos(b.aim), uy: Math.sin(b.aim), m: b.m }; },
    // Client send rules (spec §4.7): on change, at most 20 Hz; heartbeat 4 Hz otherwise.
    send(inp, now, rand) {
      if (now >= this.silentFrom && now < this.silentTo) return;
      const L = this.lastSent;
      const changed = !L || Math.abs(inp.m - L.m) > 0.05 || (inp.m > 0.05 && Math.abs(wrap(Math.atan2(inp.uy, inp.ux) - Math.atan2(L.uy, L.ux))) > 3 * DEG);
      let pkt = null;
      if (changed && now - this.lastSentAt >= 50) { pkt = { kind: "i", inp }; this.lastSent = inp; }
      else if (now - this.lastSentAt >= 250) pkt = { kind: "h" };
      if (!pkt) return;
      this.lastSentAt = now;
      let at = now + this.oneWay + (rand() * 2 - 1) * JITTER;
      if (rand() < LOSS) at += 200 + 2 * this.oneWay;
      at = Math.max(at, this.lastArrival, now + 5); // in order
      this.lastArrival = at;
      this.arrivals.push({ at, ...pkt });
    },
  };
}

function simTable(n, profile, seed) {
  const rand = rng(seed);
  const core = new RoomCore({ code: "NETS", now: 0, seed, content, mode: "table" });
  const players = [];
  for (let i = 0; i < n; i++) {
    const j = core.join({ token: null, now: i });
    const lat = profile === "mixed" ? [30, 150, 300][i % 3] : profile;
    players.push(player(j.seat, lat, rand));
  }
  const frames = [];
  let now = 10;
  core.begin(players[0].seat, now);
  const res = { seances: [], letters: [], hint2: 0, lettersTotal: 0, inv: { moved: 0, gate: 0, speed: 0, maxV: 0 } };
  let prev = { x: core.planchette.x, y: core.planchette.y, v: 0 }, zeroSince = null;
  for (let s = 0; s < SEANCES; s++) {
    const start = now;
    let silenced = false, letterHints = 0;
    while (true) {
      now += TICK;
      // What each player sees, late; what they do; what reaches the server now.
      for (const p of players) {
        const seeAt = now - p.oneWay - RENDER_D;
        let f = frames[frames.length - 1] || frameOf(core, now);
        for (let k = frames.length - 1; k >= 0; k--) if (frames[k].now <= seeAt) { f = frames[k]; break; }
        if (core.phase === "pick") for (const sl of core.seance.slots) if (sl.seat === p.seat && sl.pick === null && now - start > p.oneWay + 1200) core.pick(p.seat, sl.i, Math.floor(rand() * 3), now);
        const inp = p.think(f, now);
        p.send({ resting: true, ...inp, device: "mouse", hidden: false }, now, rand);
        while (p.arrivals.length && p.arrivals[0].at <= now) {
          const a = p.arrivals.shift();
          if (a.kind === "i") core.input(p.seat, a.inp, now); else core.heartbeat(p.seat, now);
        }
      }
      // One player goes quiet for 1.5 s, 2 s into the second word.
      const sl = core.phase === "spell" ? core.currentSlot() : null;
      if (!silenced && sl && core.seance.wordIdx === 1 && sl.spellAt && now - sl.spellAt > 2000) {
        const q = players[1];
        q.silentFrom = now; q.silentTo = now + SILENT_MS; silenced = true;
      }
      core.tick(now);
      core.drain();
      frames.push(frameOf(core, now));
      if (frames.length > 40) frames.shift();

      // Invariants on every tick.
      const P = core.planchette, v = Math.hypot(P.vx, P.vy);
      res.inv.maxV = Math.max(res.inv.maxV, v);
      if (v > core.cfg.vMax + 1e-6) res.inv.speed++;
      const live = ["warmup", "spell", "goodbye"].includes(core.phase);
      const humansStill = core.world.hands.filter((h) => h.kind === "human").every((h) => h.m === 0);
      if (live && humansStill && !core.world.hushBlowing) {
        if (core.last.gate) res.inv.gate++;
        if (!P.captured && v > prev.v + 1e-6) res.inv.moved++;
        zeroSince ??= now;
        // Coasting only: once humans have been still for 1.5 s, the lens is stuck (or held by its letter).
        if (now - zeroSince > 1500 && !P.captured && v >= core.cfg.stickSpeed) res.inv.moved++;
      } else zeroSince = null;
      prev = { x: P.x, y: P.y, v };
      if (core.phase === "spell" && core.seance.hint && core.seance.hint.step >= 2) letterHints = 1;

      if (core.phase === "reveal" && core.session.seanceIndex === s + 1) {
        const sc = core.seance;
        res.seances.push({ secs: (now - start) / 1000, name: sc.diff.name, twist: sc.twist });
        res.letters.push(...sc.letterTimes);
        res.lettersTotal += sc.letterTimes.length;
        break;
      }
      if (now - start > capMs(profile)) { res.seances.push({ secs: Infinity, timedOut: true, phase: core.phase }); return res; }
    }
    for (const p of players) core.vote(p.seat, "again", now);
  }
  return res;
}

const PROFILES = [30, 150, 300, "mixed"];
const SIZES = [2, 4, 6];
const table = [];
let seed = 100;
for (const n of SIZES) {
  console.log(`${n} players`);
  for (const prof of PROFILES) {
    const all = { letters: [], seances: [], inv: { moved: 0, gate: 0, speed: 0, maxV: 0 } };
    for (let rep = 0; rep < REPS; rep++) {
      const r = simTable(n, prof, seed++);
      all.letters.push(...r.letters);
      all.seances.push(...r.seances);
      for (const k of ["moved", "gate", "speed"]) all.inv[k] += r.inv[k];
      all.inv.maxV = Math.max(all.inv.maxV, r.inv.maxV);
    }
    const label = `${n}p @ ${prof === "mixed" ? "30/150/300" : prof} ms`;
    const done = all.seances.filter((x) => !x.timedOut);
    ok(done.length === all.seances.length && done.length === REPS * SEANCES, `${label}: ${done.length}/${all.seances.length} seances revealed (max ${Math.max(...done.map((x) => x.secs)).toFixed(0)} s, cap ${capMs(prof) / 1000} s)`);
    ok(all.inv.gate === 0 && all.inv.moved === 0, `${label}: no force and no motion gained with every human at m=0`);
    ok(all.inv.speed === 0, `${label}: max speed ${all.inv.maxV.toFixed(1)} <= vMax`);
    const med = median(all.letters);
    table.push({ n, prof, med, letters: all.letters.length, secs: median(done.map((x) => x.secs)) });
  }
}

console.log(`\nmedian seconds per hand letter (${REPS} tables x ${SEANCES} seances per cell; one player silent 1.5 s per seance)`);
console.log("players | " + PROFILES.map((p) => String(p === "mixed" ? "mixed" : p + " ms").padStart(9)).join(" | "));
for (const n of SIZES) console.log(`   ${n}    | ` + PROFILES.map((p) => { const t = table.find((x) => x.n === n && x.prof === p); return `${t.med.toFixed(2)} s`.padStart(9); }).join(" | "));
for (const t of table) {
  // Regression bounds for these simple sim players, who lead and follow far less
  // cleverly than people; the spec §11.2 targets need real playtests.
  const cap = t.prof === 30 ? 6.5 : t.prof === 150 ? 9 : 12;
  ok(t.med <= cap, `${t.n}p @ ${t.prof}: median ${t.med.toFixed(2)} s/letter <= ${cap} s (${t.letters} letters, median seance ${t.secs.toFixed(0)} s)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
