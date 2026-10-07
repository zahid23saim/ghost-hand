// Drives RoomCore end to end with simulated people: solo, tutorial, a 3-person table.
import { RoomCore } from "../src/game/room-core.js";
import { decodeSnapshot } from "../public/js/shared/protocol.js";
import { TARGET_BY_KEY } from "../public/js/shared/board.js";
import { content as fixture } from "./fixture-content.mjs";

let content = fixture;
if (process.argv.includes("--real")) {
  const [questions, words, hush, names] = await Promise.all(["questions", "words", "hush-lines", "names"].map((f) => import(`../public/js/shared/content/${f}.js`)));
  content = { questions, words, hush, names };
  console.log("(real content bank)");
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok  " + m); } else { fail++; console.log("  FAIL " + m); } };

// A person: rests, leads to the letter when they know it, otherwise follows the
// visible pull of the others after a human-ish delay.
function person(core, seat, rnd) {
  let followAng = null, reactAt = 0;
  return (now) => {
    const P = core.planchette;
    const sl = core.phase === "spell" ? core.currentSlot() : null;
    const iKnow = (sl && sl.seat === seat) || core.phase === "warmup" || core.phase === "goodbye";
    const target = core.world.target;
    if (iKnow && target) {
      const T = TARGET_BY_KEY[target];
      const dx = T.x - P.x, dy = T.y - P.y, d = Math.hypot(dx, dy) || 1;
      // Release on arrival, but pull back (the knower's veto) if the table drags it off.
      const away = P.vx * dx + P.vy * dy < 0 && Math.hypot(P.vx, P.vy) > 15;
      return { resting: true, ux: dx / d, uy: dy / d, m: d < 40 && !away ? 0 : 1 };
    }
    // "If it stuck, it was right": followers ease off while the lens is captured.
    if (P.captured) { followAng = null; return { resting: true, ux: 1, uy: 0, m: 0 }; }
    let sx = 0, sy = 0;
    for (const h of core.world.hands) if (h.seat !== seat) { sx += h.ux * h.m * h.w; sy += h.uy * h.m * h.w; }
    if (Math.hypot(sx, sy) < 0.3) return { resting: true, ux: 1, uy: 0, m: 0 };
    const a = Math.atan2(sy, sx);
    const off = followAng === null ? 9 : Math.abs(Math.atan2(Math.sin(a - followAng), Math.cos(a - followAng)));
    if (off > 0.5) {
      if (!reactAt) reactAt = now + 500 + rnd() * 400;
      if (now >= reactAt) { followAng = a; reactAt = 0; }
    } else followAng = a;
    if (followAng === null) return { resting: true, ux: 1, uy: 0, m: 0 };
    return { resting: true, ux: Math.cos(followAng), uy: Math.sin(followAng), m: 0.9 };
  };
}

function run(core, people, { until, maxMs = 240000, start = 0, each = null }) {
  let now = start;
  const msgs = [];
  while (now - start < maxMs) {
    now += 1000 / 30;
    for (const [seat, brain] of people) {
      core.input(seat, { ...brain(now), device: "mouse", hidden: false }, now);
      if (core.phase === "pick") {
        for (const sl of core.seance.slots) if (sl.seat === seat && sl.pick === null) core.pick(seat, sl.i, 0, now);
      }
    }
    core.tick(now);
    if (each) each(core, now);
    for (const o of core.drain()) msgs.push(o);
    if (until(core, msgs)) return { now, msgs };
  }
  return { now, msgs, timedOut: true };
}

const evs = (msgs, k) => msgs.filter((o) => o.msg && o.msg.k === k).map((o) => o.msg);

// --- 1. Solo seance: you + Nani + Bram ---------------------------------------
console.log("solo seance");
{
  const core = new RoomCore({ code: "BAKU", now: 0, seed: 7, content, mode: "solo" });
  const j = core.join({ token: null, now: 0 });
  ok(j.seat === 1 && /^[0-9a-f]{32}$/.test(j.token), "human gets seat 1 and a token");
  ok(core.phase === "arrive", "a solo room starts its seance on join");
  ok(core.seats.filter((s) => s.kind === "bot").length === 2, "Nani and Bram are seated");
  const r = run(core, [[1, person(core, 1, Math.random)]], { until: (c) => c.phase === "reveal" });
  ok(!r.timedOut, `reached the reveal in ${(r.now / 1000).toFixed(1)} s`);
  const rev = evs(r.msgs, "reveal")[0];
  ok(rev && typeof rev.frameText === "string" && !rev.frameText.includes("{"), "reveal sentence: " + (rev && rev.frameText));
  ok(rev && rev.words.length === 3, "three words, one per sitter");
  const inks = evs(r.msgs, "ink").length, fills = evs(r.msgs, "hushFill").length;
  ok(inks >= 6 && fills >= 1, `${inks} letters inked by hand, Hush filled ${fills} words`);
  ok(evs(r.msgs, "wordStart").every((e) => e.prompt && e.len > 0), "every word starts with a public clue");
  const wh = r.msgs.filter((o) => o.msg && o.msg.t === "whisper");
  ok(wh.length && wh.every((o) => o.to !== "all"), "whispers are never broadcast");
  const snap = decodeSnapshot(core.snapshotFor(1));
  ok(snap.hands.length === 3 && Number.isFinite(snap.x), "snapshot decodes with 3 hands");
  ok(rev && rev.line && !rev.line.includes("{"), "Hush reacts: " + (rev && rev.line));
  const qFirst = core.seance.qId;
  core.vote(1, "again", r.now);
  const r2 = run(core, [[1, person(core, 1, Math.random)]], { start: r.now, until: (c) => c.phase === "spell" });
  ok(!r2.timedOut && core.session.seanceIndex === 1, "Another cup starts a second seance");
  ok(core.seance.qId !== qFirst, "with a different question");
}

// --- 2. Tutorial: MORE ___ -------------------------------------------------
console.log("tutorial");
{
  const core = new RoomCore({ code: "TUTO", now: 0, seed: 3, content, mode: "solo", tutorial: true });
  core.join({ token: null, now: 0 });
  ok(core.seance.slots[0].word === "MORE", "Nani's word is MORE");
  const r = run(core, [[1, person(core, 1, Math.random)]], { until: (c) => c.phase === "reveal" });
  const rev = evs(r.msgs, "reveal")[0];
  ok(!r.timedOut && rev && /^MORE (PIE|HUGS|NAPS)$/.test(rev.frameText), `tutorial reveal "${rev && rev.frameText}" in ${(r.now / 1000).toFixed(1)} s`);
}

// --- 3. A table of three -----------------------------------------------------
console.log("table of three");
{
  const core = new RoomCore({ code: "TRIO", now: 0, seed: 11, content, mode: "table" });
  const a = core.join({ token: null, now: 0 }), b = core.join({ token: null, now: 10 }), c = core.join({ token: null, now: 20 });
  ok(new Set([a.seat, b.seat, c.seat]).size === 3 && core.hostSeat === a.seat, "three seats, first is host");
  ok(new Set(core.seats.map((s) => s.name)).size === 3, "unique names: " + core.seats.map((s) => s.name).join(", "));
  const people = [a, b, c].map((s) => [s.seat, person(core, s.seat, Math.random)]);
  core.begin(a.seat, 30);
  ok(core.phase === "warmup", "begin goes to the HI warm-up");
  const r = run(core, people, { start: 30, until: (x) => x.phase === "reveal" });
  ok(!r.timedOut, `table reached the reveal in ${(r.now / 1000).toFixed(1)} s`);
  ok(evs(r.msgs, "ink").filter((e) => e.warm).length === 2, "warm-up inked H and I");
  const rev = evs(r.msgs, "reveal")[0];
  ok(rev && rev.words.length === 3 && new Set(rev.words.map((w) => w.seat)).size === 3, "each person owned one word: " + (rev && rev.frameText));

  const core2 = new RoomCore({ code: "PRIV", now: 0, seed: 5, content, mode: "table" });
  const p = core2.join({ token: null, now: 0 }), q = core2.join({ token: null, now: 0 });
  core2.startSeance(0);
  run(core2, [[p.seat, person(core2, p.seat, Math.random)], [q.seat, person(core2, q.seat, Math.random)]], { until: (x) => x.phase === "spell" });
  const st = core2.stateFor(q.seat);
  ok(!st.seance.slots.some((s) => s.seat !== q.seat && s.word), "state never leaks another player's word");
  ok(core2.seance.slots.length === 4, "two players share four slots");
  core2.leave(p.seat, 1000);
  const back = core2.join({ token: p.token, now: 2000 });
  ok(back.seat === p.seat, "reconnect with token returns the same seat");
}

console.log("persistence");
{
  const core = new RoomCore({ code: "SAVE", now: 0, seed: 9, content, mode: "solo" });
  const j = core.join({ token: null, now: 0 });
  const r = run(core, [[1, person(core, 1, Math.random)]], { until: (c) => c.phase === "spell" && c.currentSlot().inked.length === 1 });
  const data = JSON.parse(JSON.stringify(core.serialize()));
  const size = JSON.stringify(data).length;
  ok(size < 60000 && !("content" in data), `saved state is small (${size} bytes)`);
  const back = RoomCore.restore(data, content, r.now);
  ok(back.seance.slots[back.seance.wordIdx].inked.length === 1 && back.world.planchette === back.planchette, "restore resumes mid-word with the inked letter kept");
  const r2 = run(back, [[1, person(back, 1, Math.random)]], { start: r.now, until: (c) => c.phase === "reveal" });
  ok(!r2.timedOut, "the restored room plays on to the reveal");
  back.resync(j.seat);
}

// --- 5. Last Biscuit twists: Whisper (seance 3) and Gust (seance 4) -----------
console.log("twists");
{
  const core = new RoomCore({ code: "TWIS", now: 0, seed: 21, content, mode: "table" });
  const ids = [0, 1, 2].map((i) => core.join({ token: null, now: i }).seat);
  const people = ids.map((id) => [id, person(core, id, Math.random)]);
  core.begin(ids[0], 10);
  let start = 10;
  const bySeance = [];
  let gustFlag = 0, gustOnStill = 0;
  const each = (c) => {
    if (!(c.world.gust && c.world.gust.ms > 0)) return;
    if (decodeSnapshot(c.snapshotFor(null)).gust) gustFlag++;
    if (!c.planchette.sliding) gustOnStill++;
  };
  for (let i = 0; i < 4; i++) {
    let st = null;
    const r = run(core, people, { start, each, until: (c) => { if (c.phase === "spell" && !st) st = c.stateFor(ids[1]); return c.phase === "reveal" && c.session.seanceIndex === i + 1; } });
    bySeance.push({ r, st, sc: core.seance });
    start = r.now;
    if (r.timedOut) break;
    for (const id of ids) core.vote(id, "again", start);
  }
  ok(bySeance.length === 4 && bySeance.every((b) => !b.r.timedOut), "four seances in a row all reach the reveal");
  const w = bySeance[2], g = bySeance[3];
  ok(w.st && w.st.seance.name === "Last Biscuit" && w.st.seance.twist === "whisper", "seance 3 is Last Biscuit with the whisper twist (in state)");
  ok(g.sc.diff.name === "Last Biscuit" && g.sc.twist === "gust", "seance 4 is Last Biscuit with the gust twist");
  ok(evs(w.r.msgs, "twist").some((e) => e.twist === "whisper" && e.line), "a twist event announces the whisper");
  const ws = evs(w.r.msgs, "wordStart"), clues = evs(w.r.msgs, "clue");
  ok(ws.length === w.sc.slots.length && ws.every((e) => e.hushed && e.prompt === null), "whisper: every clue line is hidden at word start");
  ok(clues.length === w.sc.slots.length && clues.every((e) => e.prompt), "whisper: each clue is revealed once its word starts inking");
  const firstInk = w.r.msgs.findIndex((o) => o.msg && o.msg.k === "ink" && !o.msg.warm);
  const firstClue = w.r.msgs.findIndex((o) => o.msg && o.msg.k === "clue");
  ok(firstInk >= 0 && firstClue > firstInk, "the first clue appears only after the first ink");
  const wh = w.r.msgs.filter((o) => o.msg && o.msg.t === "whisper");
  ok(wh.length && wh.every((o) => o.msg.prompt && o.to !== "all"), "the knower still gets the clue privately");
  ok(w.st.seance.slots.every((s) => s.seat === ids[1] || !s.prompt), "state hides a hushed clue from followers");
  ok(bySeance.slice(0, 2).every((b) => evs(b.r.msgs, "wordStart").every((e) => !e.hushed && e.prompt)), "earlier seances show the clue line");
  const gusts = evs(g.r.msgs, "gust");
  ok(gusts.length >= 1 && gusts.length <= g.sc.slots.length, `gust: ${gusts.length} gust(s) over ${g.sc.slots.length} words (at most one each)`);
  ok(new Set(gusts.map((e) => e.slot)).size === gusts.length && gusts.every((e) => Number.isFinite(e.dir) && Math.abs(Math.hypot(e.dx, e.dy) - 1) < 0.01), "gust events carry a slot and a unit direction");
  ok(gustFlag > 0 && gustOnStill === 0, `PF.GUST is set while it blows (${gustFlag} ticks), never on a still planchette`);
  ok(bySeance.slice(0, 3).every((b) => !evs(b.r.msgs, "gust").length), "no gusts outside the gust twist");
}

// --- 6. Party table of six ----------------------------------------------------
console.log("party of six");
{
  const core = new RoomCore({ code: "SIXY", now: 0, seed: 33, content, mode: "table" });
  const ids = [0, 1, 2, 3, 4, 5].map((i) => core.join({ token: null, now: i }).seat);
  ok(new Set(ids).size === 6 && core.join({ token: null, now: 9 }).spectator, "six seats, the seventh person watches");
  const people = ids.map((id) => [id, person(core, id, Math.random)]);
  core.begin(ids[0], 10);
  const r = run(core, people, { start: 10, until: (c) => c.phase === "reveal" });
  ok(!r.timedOut, `six humans reach the reveal in ${(r.now / 1000).toFixed(1)} s`);
  const sc = core.seance;
  ok(sc.slots.length === 6 && new Set(sc.slots.map((s) => s.seat)).size === 6, "six slots, one per person (3 clauses appended)");
  const rev = evs(r.msgs, "reveal")[0];
  ok(rev && rev.words.length === 6 && !rev.frameText.includes("{"), "six-word sentence: " + (rev && rev.frameText));
  const titles = rev ? rev.titles : [];
  ok(titles.length === 6 && new Set(titles.map((t) => t.seat)).size === 6, "every human gets exactly one title: " + titles.map((t) => t.title).join(", "));
  const soul = titles.filter((t) => t.title === "Soulmates");
  ok(soul.length === 2 && soul[0].with === soul[1].seat && soul[1].with === soul[0].seat, "Soulmates covers a pair of followers");
  // Soulmates rules on a hand-built sample set.
  const c2 = new RoomCore({ code: "PAIR", now: 0, seed: 1, content, mode: "table" });
  const s2 = [0, 1, 2, 3].map((i) => c2.join({ token: null, now: i }).seat);
  c2.seance = { knowerStats: {}, pairs: { [`${s2[1]}-${s2[2]}`]: { n: 30, sum: 29 }, [`${s2[2]}-${s2[3]}`]: { n: 30, sum: 20 } } };
  const t2 = c2.superlatives();
  ok(t2.filter((t) => t.title === "Soulmates").map((t) => t.seat).sort().join() === [s2[1], s2[2]].sort().join(), "Soulmates picks the best pair above 0.85");
  c2.seance = { knowerStats: {}, pairs: { [`${s2[1]}-${s2[2]}`]: { n: 30, sum: 24 } } };
  ok(!c2.superlatives().some((t) => t.title === "Soulmates"), "no Soulmates below 0.85 mean similarity");
}

// --- 7. Daily question and stats reports ----------------------------------------
console.log("daily question");
{
  const qs = content.questions.QUESTIONS;
  const dq = qs[qs.length - 1];
  const core = new RoomCore({ code: "DAYO", now: 0, seed: 4, content, mode: "solo", daily: { date: "2026-10-07", qId: dq.id, pack: dq.pack } });
  core.join({ token: null, now: 0 });
  ok(core.seance.qId === dq.id && core.seance.daily === "2026-10-07", "a daily room's first seance uses the daily question");
  const out = core.drain();
  ok(out.some((o) => o.to === "stats" && o.msg.kind === "seanceStarted"), "seance start is reported for anonymous stats");
  const r = run(core, [[1, person(core, 1, Math.random)]], { until: (c) => c.phase === "reveal" });
  const rep = r.msgs.find((o) => o.to === "stats" && o.msg.kind === "seanceRevealed");
  ok(rep && rep.msg.daily === "2026-10-07" && rep.msg.qId === dq.id && rep.msg.secs > 0, "the reveal is reported with the daily date");
  ok(evs(r.msgs, "reveal")[0].daily === "2026-10-07", "the reveal event carries the daily date");
  core.vote(1, "again", r.now);
  run(core, [[1, person(core, 1, Math.random)]], { start: r.now, until: (c) => c.phase === "spell" });
  ok(core.seance.qId !== dq.id && !core.seance.daily, "the second seance is an ordinary one");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
