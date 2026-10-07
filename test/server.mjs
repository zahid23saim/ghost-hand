// Worker routes and the counter Durable Objects, with in-memory stand-ins for
// DO storage and stubs (no wrangler, no network).
import worker from "../src/worker.js";
import { DailyStats, Stats, apply } from "../src/stats-do.js";
import { Room } from "../src/room-do.js";
import { dailyQuestion, utcDate } from "../src/game/daily.js";
import { CONTENT } from "../src/game/content.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok  " + m); } else { fail++; console.log("  FAIL " + m); } };

// Minimal DurableObjectStorage (the KV parts we use).
function memStorage() {
  const m = new Map();
  return {
    map: m,
    async get(k) { if (Array.isArray(k)) return new Map(k.filter((x) => m.has(x)).map((x) => [x, structuredClone(m.get(x))])); return structuredClone(m.get(k)); },
    async put(k, v) { if (typeof k === "object") { for (const [a, b] of Object.entries(k)) m.set(a, structuredClone(b)); } else m.set(k, structuredClone(v)); },
    async delete(k) { for (const x of [].concat(k)) m.delete(x); },
    async list({ prefix = "", end = null, limit = 1e9 } = {}) {
      const keys = [...m.keys()].filter((x) => x.startsWith(prefix) && (end === null || x < end)).sort().slice(0, limit);
      return new Map(keys.map((x) => [x, m.get(x)]));
    },
    async deleteAll() { m.clear(); },
    async setAlarm() {},
  };
}
function namespace(Cls, env) {
  const objs = new Map();
  return {
    objs,
    idFromName: (n) => n,
    get(id) {
      if (!objs.has(id)) {
        const ctx = { storage: memStorage(), blockConcurrencyWhile: (f) => f(), getWebSockets: () => [], waitUntil: (p) => pending.push(p) };
        objs.set(id, new Cls(ctx, env));
      }
      const o = objs.get(id);
      return { fetch: (url, init) => o.fetch(new Request(url, init)) };
    },
  };
}
const pending = [];
const settle = async () => { while (pending.length) await pending.shift(); };
const env = {};
env.ROOM = namespace(Room, env);
env.DAILY = namespace(DailyStats, env);
env.STATS = namespace(Stats, env);
env.ASSETS = { fetch: () => new Response("asset") };
const call = async (path, method = "GET") => worker.fetch(new Request("https://gh.test" + path, { method }), env);

console.log("daily question");
{
  const a = dailyQuestion(CONTENT, "2026-10-07"), b = dailyQuestion(CONTENT, "2026-10-07");
  ok(a && a.qId === b.qId && a.ask && a.pack, `same question for the same date (${a.qId})`);
  const seen = new Set();
  let kids = 0;
  for (let i = 0; i < 365; i++) {
    const q = dailyQuestion(CONTENT, utcDate(Date.UTC(2026, 0, 1) + i * 86_400_000));
    seen.add(q.qId);
    if (q.pack === "kids") kids++;
  }
  ok(kids === 0, "never the kids pack over a year");
  ok(seen.size > 15, `varied over a year (${seen.size} different questions)`);
  ok(utcDate(Date.UTC(2026, 9, 7, 23, 59)) === "2026-10-07", "UTC date format YYYY-MM-DD");

  const r = await (await call("/api/daily")).json();
  const want = dailyQuestion(CONTENT, utcDate());
  ok(r.date === utcDate() && r.qId === want.qId && r.ask === want.ask && r.pack === want.pack, "GET /api/daily returns today's question");
  ok(r.stats && r.stats.tables === 0 && r.stats.seances === 0, "with zero counts before anyone plays");
}

console.log("daily rooms and counters");
{
  const res = await (await call("/api/room?mode=solo&daily=1", "POST")).json();
  ok(/^[A-Z]{4}$/.test(res.code), "POST /api/room?daily=1 creates a room: " + res.code);
  const room = env.ROOM.objs.get(res.code);
  const today = dailyQuestion(CONTENT, utcDate());
  ok(room.core.session.forceQ === today.qId && room.core.session.pack === today.pack, "the room is set to today's question and its pack");
  const info = await (await call("/api/room/" + res.code)).json();
  ok(info.exists && info.daily === utcDate(), "room info says it is a daily room");

  // Simulate the core reporting a daily reveal twice: one table, two seances.
  room.onReport({ kind: "seanceRevealed", secs: 80, daily: utcDate(), qId: today.qId, mode: "solo", humans: 1 });
  room.onReport({ kind: "seanceRevealed", secs: 100, daily: utcDate(), qId: today.qId, mode: "solo", humans: 1 });
  await settle();
  const r = await (await call("/api/daily")).json();
  ok(r.stats.tables === 1 && r.stats.seances === 2, `daily counts: ${r.stats.tables} table, ${r.stats.seances} seances`);

  const plain = await (await call("/api/room?mode=table", "POST")).json();
  ok(!env.ROOM.objs.get(plain.code).core.session.forceQ, "an ordinary room has no forced question");
  await call("/api/room?mode=tutorial", "POST");
}

console.log("play stats");
{
  await settle();
  const room = [...env.ROOM.objs.values()][1];
  room.core.peakHumans = 4;
  room.reportPeak();
  room.reportPeak();
  room.onReport({ kind: "seanceStarted", mode: "table", humans: 4, tutorial: false, daily: false });
  room.onReport({ kind: "seanceRevealed", secs: 1, tutorial: true, daily: null, qId: "x", mode: "solo", humans: 1 });
  room.onReport({ kind: "nonsense" });
  await settle();
  const s = await (await call("/api/stats")).json();
  ok(Array.isArray(s.days) && s.days.length === 14, "GET /api/stats returns 14 days");
  const d = s.days[0];
  ok(d.date === utcDate(), "newest day first");
  ok(d.roomsCreated.solo === 1 && d.roomsCreated.table === 1 && d.roomsCreated.tutorial === 1 && d.roomsCreated.daily === 1, "rooms created by mode: " + JSON.stringify(d.roomsCreated));
  ok(d.seancesStarted === 1 && d.seancesRevealed === 3 && d.tutorialsDone === 1, `seances started ${d.seancesStarted}, revealed ${d.seancesRevealed}, tutorials ${d.tutorialsDone}`);
  ok(d.avgSeanceSecs === Math.round((80 + 100 + 1) / 3), "average seance seconds: " + d.avgSeanceSecs);
  ok(d.peakPlayers.max === 4 && d.peakPlayers.rooms[4] === 1, "peak players counted once per room");
  const text = JSON.stringify(s);
  ok(!/qId|code|ip|token|[A-Z]{4}"/.test(text.replace(/"date":"[^"]+"/g, "")), "no ids, codes or question ids in the stats");
  const day = { rooms: { table: 0, solo: 0, tutorial: 0, daily: 0 }, seancesStarted: 0, seancesRevealed: 0, tutorialsDone: 0, secsSum: 0, peak: { max: 0, rooms: {} } };
  ok(apply(day, { kind: "seanceRevealed", secs: 1e9 }) && day.secsSum === 3600, "absurd durations are capped");
  ok(!apply(day, { kind: "roomPeak", humans: 0 }), "empty rooms are not counted");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
