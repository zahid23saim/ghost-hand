// Ghost Hand - Worker entry (spec §10.2). Routes the API and sockets to one
// Room Durable Object per code; everything else is static, with SPA fallback
// so /BAKU deep links land on the app.

export { Room } from "./room-do.js";
export { DailyStats, Stats } from "./stats-do.js";
import { BLOCKED_CODES } from "../public/js/shared/content/blocked-codes.js";
import { CONTENT } from "./game/content.js";
import { dailyQuestion, utcDate } from "./game/daily.js";

const CONS = "BDFGHKLMNPRSTVZ";
const VOWS = "AEIOU";
const blocked = new Set(BLOCKED_CODES);
const isCode = (c) => typeof c === "string" && /^[BDFGHKLMNPRSTVZ][AEIOU][BDFGHKLMNPRSTVZ][AEIOU]$/.test(c);

function makeCode() {
  const b = new Uint8Array(4);
  for (let i = 0; i < 20; i++) {
    crypto.getRandomValues(b);
    const c = CONS[b[0] % 15] + VOWS[b[1] % 5] + CONS[b[2] % 15] + VOWS[b[3] % 5];
    if (!blocked.has(c)) return c;
  }
  return "BAKU";
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

// A light per-isolate limit on room creation (spec: 20 per minute per IP).
const recent = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return list.length > 20;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") return json({ ok: true });

    if (path === "/api/room" && request.method === "POST") {
      if (limited(request.headers.get("cf-connecting-ip") || "local")) return json({ error: "slow-down" }, 429);
      const mode = ["solo", "tutorial", "table"].includes(url.searchParams.get("mode")) ? url.searchParams.get("mode") : "table";
      const pack = (url.searchParams.get("pack") || "cozy").replace(/[^a-z]/g, "").slice(0, 12);
      const daily = url.searchParams.get("daily") === "1" ? "1" : "0";
      for (let i = 0; i < 8; i++) {
        const code = makeCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const r = await stub.fetch(`https://room/claim?code=${code}&mode=${mode}&pack=${pack}&daily=${daily}`);
        if ((await r.json()).ok) return json({ code });
      }
      return json({ error: "busy" }, 503);
    }

    // Today's question (spec §6.6): same for everyone, chosen by UTC date.
    if (path === "/api/daily") {
      const date = utcDate();
      const q = dailyQuestion(CONTENT, date);
      if (!q) return json({ error: "no-question" }, 503);
      let stats = { tables: 0, seances: 0 };
      try {
        if (env.DAILY) stats = await (await env.DAILY.get(env.DAILY.idFromName(date)).fetch("https://daily/get")).json();
      } catch {}
      return json({ ...q, stats: { tables: stats.tables | 0, seances: stats.seances | 0 } });
    }

    // Anonymous aggregate play counts for the last 14 UTC days (no ids, no IPs).
    if (path === "/api/stats") {
      if (!env.STATS) return json({ days: [] });
      try {
        return json(await (await env.STATS.get(env.STATS.idFromName("global")).fetch("https://stats/recent?days=14")).json());
      } catch {
        return json({ error: "unavailable" }, 503);
      }
    }

    const info = path.match(/^\/api\/room\/([A-Za-z]{4})$/);
    if (info) {
      const code = info[1].toUpperCase();
      if (!isCode(code)) return json({ exists: false });
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      return json(await (await stub.fetch("https://room/info")).json());
    }

    const ws = path.match(/^\/ws\/([A-Za-z]{4})$/);
    if (ws) {
      const code = ws[1].toUpperCase();
      if (!isCode(code)) return new Response("bad room code", { status: 400 });
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
    }

    if (path.startsWith("/api/")) return json({ error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
