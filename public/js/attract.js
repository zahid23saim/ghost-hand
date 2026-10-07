// Ghost Hand - the landing attract loop (spec §5.5). Runs locally with the same
// physics as the server: Nani, Bram and Juno spell HELLO, then rest for 2 s.

import { makeConfig, tStart } from "./shared/config.js";
import { step, newPlanchette, setTarget } from "./shared/physics.js";
import { HOME } from "./shared/board.js";
import { newBotBrain, botNewLetter, botThink } from "./shared/bots.js";
import { rng } from "./shared/rng.js";

const DT = 1 / 30;
const WORD = "HELLO";

export class Attract {
  constructor(seed = 5) {
    this.rand = rng(seed);
    this.cfg = makeConfig();
    this.P = newPlanchette(HOME.x, HOME.y);
    this.world = { planchette: this.P, hands: [], knower: -1, Tstart: tStart(this.cfg, 2), target: null, captureScale: 1, hushBlowing: false };
    this.sitters = [7, 8, 9].map((seat) => ({ seat, brain: newBotBrain(this.rand), ux: 0, uy: -1, m: 0 }));
    this.idx = 0;
    this.pauseUntil = 0;
    this.acc = 0;
    this.last = null;
    this.out = { r: 0, gate: false, stir: false, hasDir: false, dirX: 0, dirY: 0 };
    this.events = [];
    this.started = false;
  }

  knowerFor(i) { return i % this.sitters.length; }

  begin(now) {
    this.idx = 0;
    this.P.x = HOME.x; this.P.y = HOME.y; this.P.vx = 0; this.P.vy = 0;
    this.newLetter(now);
  }

  newLetter(now) {
    const key = WORD[this.idx] || null;
    setTarget(this.world, key, this.cfg);
    const kn = this.knowerFor(this.idx);
    this.sitters.forEach((s, i) => botNewLetter(s.brain, { now, rand: this.rand, isKnower: i === kn, target: key, tutorial: false }));
    this.letterAt = now;
  }

  // Advance to `now` (ms) in fixed steps; returns events since the last call.
  update(now) {
    if (!this.started) { this.started = true; this.last = now; this.pauseUntil = now + 900; this.pendingBegin = true; }
    this.acc += Math.min(200, now - this.last);
    this.last = now;
    const events = [];
    while (this.acc >= DT * 1000) {
      this.acc -= DT * 1000;
      if (now < this.pauseUntil) {
        for (const s of this.sitters) s.m = Math.max(0, s.m - 0.1);
        this.world.hands = this.sitters.map((s) => ({ kind: "human", w: 1, ux: s.ux, uy: s.uy, m: 0, seat: s.seat }));
        this.out = step(this.world, this.cfg, DT);
        continue;
      }
      if (this.pendingBegin) { this.pendingBegin = false; this.begin(now); }
      const kn = this.knowerFor(this.idx);
      const hands = this.sitters.map((s, i) => ({ kind: "human", w: i === kn ? this.cfg.knowerWeight : 1, ux: s.ux, uy: s.uy, m: s.m, seat: s.seat }));
      this.sitters.forEach((s, i) => {
        const others = hands.filter((_, j) => j !== i).map((h, j) => ({ ...h, kind: "bot", knower: hands.indexOf(h) === kn }));
        const p = botThink(s.brain, { now, rand: this.rand, isKnower: i === kn, target: this.world.target, lens: this.P, others, humanResting: true, assist: false, tutorial: false });
        if (p.m > 0.02 || i === kn) { s.ux = p.ux; s.uy = p.uy; }
        s.m = p.m;
        hands[i].ux = s.ux; hands[i].uy = s.uy; hands[i].m = s.m;
      });
      this.world.hands = hands;
      this.world.knower = kn;
      // Never get stuck on the landing page: Hush nudges after a while.
      this.world.hushBlowing = now - this.letterAt > 9000;
      this.out = step(this.world, this.cfg, DT);
      for (const e of this.out.events) {
        events.push(e);
        if (e.k === "ink") {
          this.idx++;
          if (this.idx >= WORD.length) {
            setTarget(this.world, null, this.cfg);
            this.world.hushBlowing = false;
            this.pauseUntil = now + 2600;
            this.pendingBegin = true;
            this.idx = 0;
          } else this.newLetter(now);
        }
      }
    }
    return events;
  }

  // Render state in the same shape the game builds from snapshots.
  view() {
    const P = this.P;
    const counted = new Set(this.world.hands.filter((h) => h.counted).map((h) => h.seat));
    return {
      x: P.x, y: P.y, sliding: P.sliding, captured: P.captured, stir: this.out.stir,
      r: this.out.r || 0, dirX: this.out.dirX, dirY: this.out.dirY, hasDir: this.out.hasDir,
      dwellKey: this.world.target, dwellP: P.dwellP, glows: [], hintStep: 0,
      hands: this.sitters.map((s) => ({ seat: s.seat, kind: "bot", ux: s.ux, uy: s.uy, m: s.m, counted: counted.has(s.seat), resting: true, status: "ok" })),
    };
  }

  spelled() { return WORD.slice(0, this.idx); }
}
