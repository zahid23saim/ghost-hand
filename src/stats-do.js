// Ghost Hand - anonymous counters (spec §6.6 and a simplified §10.8).
// Counts only: no ids, no IPs, no names, no words typed by anyone.
//
// DailyStats: one per UTC date (idFromName(date)); counts tables and seances
//   completed on the daily question.
// Stats: a singleton (idFromName("global")); per-UTC-day aggregate play counts.

import { utcDate } from "./game/daily.js";

const json = (data) => Response.json(data, { headers: { "cache-control": "no-store" } });
const KEEP_DAYS = 60;
const MODES = ["table", "solo", "tutorial"];

// Requests run one at a time (input gates already do this on Cloudflare; this
// keeps the read-modify-write safe anywhere).
class Serial {
  constructor(ctx) { this.ctx = ctx; this.chain = Promise.resolve(); }
  fetch(request) {
    const run = this.chain.then(() => this.handle(request));
    this.chain = run.catch(() => {});
    return run;
  }
}

export class DailyStats extends Serial {
  async handle(request) {
    const url = new URL(request.url);
    const st = this.ctx.storage;
    if (url.pathname === "/hit" && request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch {}
      const [tables, seances] = await Promise.all([st.get("tables"), st.get("seances")]);
      await st.put({ tables: (tables || 0) + (body.first ? 1 : 0), seances: (seances || 0) + 1 });
      return json({ ok: true });
    }
    const [tables, seances] = await Promise.all([st.get("tables"), st.get("seances")]);
    return json({ tables: tables || 0, seances: seances || 0 });
  }
}

function emptyDay(date) {
  return {
    date, rooms: { table: 0, solo: 0, tutorial: 0, daily: 0 },
    seancesStarted: 0, seancesRevealed: 0, tutorialsDone: 0, secsSum: 0,
    peak: { max: 0, rooms: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } },
  };
}

// What /api/stats shows for a day (the running sum becomes an average).
function publicDay(d) {
  return {
    date: d.date, roomsCreated: d.rooms, seancesStarted: d.seancesStarted, seancesRevealed: d.seancesRevealed,
    tutorialsDone: d.tutorialsDone, avgSeanceSecs: d.seancesRevealed ? Math.round(d.secsSum / d.seancesRevealed) : 0,
    peakPlayers: { max: d.peak.max, rooms: d.peak.rooms },
  };
}

export class Stats extends Serial {
  async handle(request) {
    const url = new URL(request.url);
    const st = this.ctx.storage;
    if (url.pathname === "/add" && request.method === "POST") {
      let m = {};
      try { m = await request.json(); } catch {}
      const date = utcDate();
      const key = "d:" + date;
      const d = (await st.get(key)) || emptyDay(date);
      if (!apply(d, m)) return json({ ok: false });
      await st.put(key, d);
      if ((await st.get("lastPrune")) !== date) await this.prune(date);
      return json({ ok: true });
    }
    if (url.pathname === "/recent") {
      const days = Math.max(1, Math.min(KEEP_DAYS, parseInt(url.searchParams.get("days") || "14", 10) || 14));
      const now = Date.now();
      const dates = Array.from({ length: days }, (_, i) => utcDate(now - i * 86_400_000));
      const got = await st.get(dates.map((x) => "d:" + x));
      return json({ days: dates.map((x) => publicDay(got.get("d:" + x) || emptyDay(x))) });
    }
    return json({ error: "not found" });
  }

  // Once a day, forget days older than KEEP_DAYS.
  async prune(date) {
    const st = this.ctx.storage;
    const cutoff = "d:" + utcDate(Date.now() - KEEP_DAYS * 86_400_000);
    const old = [...(await st.list({ prefix: "d:", end: cutoff, limit: 128 })).keys()];
    if (old.length) await st.delete(old);
    await st.put("lastPrune", date);
  }
}

// One counted event from a Room DO. Returns false for anything unknown.
export function apply(d, m) {
  switch (m && m.kind) {
    case "roomCreated":
      if (MODES.includes(m.mode)) d.rooms[m.mode]++;
      if (m.daily) d.rooms.daily++;
      return true;
    case "seanceStarted":
      d.seancesStarted++;
      return true;
    case "seanceRevealed":
      d.seancesRevealed++;
      d.secsSum += Math.max(0, Math.min(3600, Number(m.secs) || 0));
      if (m.tutorial) d.tutorialsDone++;
      return true;
    case "roomPeak": {
      const n = Math.max(0, Math.min(6, m.humans | 0));
      if (!n) return false;
      d.peak.rooms[n] = (d.peak.rooms[n] || 0) + 1;
      d.peak.max = Math.max(d.peak.max, n);
      return true;
    }
    default:
      return false;
  }
}
