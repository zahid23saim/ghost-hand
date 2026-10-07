// Ghost Hand - the Room Durable Object (spec §10.3). One per room code.
// Sockets are hibernatable; the 30 Hz loop runs only while a seance needs it.
// All game rules live in RoomCore; this file only moves bytes and time.

import { RoomCore } from "./game/room-core.js";
import { CONTENT } from "./game/content.js";
import { decodeInput, PROTOCOL } from "../public/js/shared/protocol.js";
import { BUILD } from "../public/js/build.js";
import { dailyQuestion, utcDate } from "./game/daily.js";

const TICK_MS = 33;
const STOP_AFTER_MS = 10_000;     // keep ticking this long after the loop is no longer needed
const RECYCLE_MS = 10 * 60_000;   // an empty room is forgotten after this
const MAX_MSG = 1024;
const MAX_RATE = 40;              // messages per second per socket

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.core = null;
    this.loop = null;
    this.idleSince = 0;
    this.rates = new Map();
    this.dirty = false;
    this.lastSavedPhase = null;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get("core");
      if (saved) {
        try { this.core = RoomCore.restore(saved, CONTENT, Date.now()); } catch { this.core = null; }
      }
    });
  }

  // ------------------------------------------------------------ HTTP

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);

    if (url.pathname === "/claim") {
      const sockets = this.ctx.getWebSockets().length;
      const active = this.core && (sockets > 0 || Date.now() - (this.core.lastNow || 0) < RECYCLE_MS);
      if (active) return Response.json({ ok: false });
      if (this.core) this.reportPeak();
      const asked = url.searchParams.get("mode");
      const mode = asked === "solo" || asked === "tutorial" ? "solo" : "table";
      const now = Date.now();
      // ?daily=1: the first seance uses today's question (never in the tutorial).
      const daily = url.searchParams.get("daily") === "1" && asked !== "tutorial" ? dailyQuestion(CONTENT, utcDate(now)) : null;
      this.core = new RoomCore({
        code: url.searchParams.get("code"), now, seed: (now ^ (Math.random() * 2 ** 32)) >>> 0,
        content: CONTENT, mode, tutorial: asked === "tutorial",
        pack: url.searchParams.get("pack") || "cozy", build: BUILD, daily,
      });
      this.postStats({ kind: "roomCreated", mode: asked === "tutorial" ? "tutorial" : mode, daily: !!daily });
      await this.save(true);
      await this.ctx.storage.setAlarm(now + RECYCLE_MS);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/info") {
      if (!this.core) return Response.json({ exists: false });
      const humans = this.core.humans(false).length;
      return Response.json({ exists: true, phase: this.core.phase, mode: this.core.mode, seatsFree: Math.max(0, 6 - humans), locked: this.core.locked, daily: this.core.session.daily || null });
    }

    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ seat: null, role: "new" });
    if (!this.core) {
      this.send(pair[1], { t: "err", code: "no-room", msg: "That table has packed up." });
      try { pair[1].close(4004, "no such room"); } catch {}
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ------------------------------------------------------------ sockets

  async webSocketMessage(ws, raw) {
    await this.ready;
    if (!this.core || typeof raw !== "string" || raw.length > MAX_MSG) return;
    if (!this.rateOk(ws)) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const core = this.core;
    const now = Date.now();
    const att = ws.deserializeAttachment() || {};

    if (Array.isArray(m)) {
      if (att.seat == null) return;
      if (m[0] === "i") { core.input(att.seat, decodeInput(m), now); this.ensureLoop(); }
      else if (m[0] === "h") core.heartbeat(att.seat, now);
      return;
    }
    if (!m || typeof m.t !== "string") return;

    switch (m.t) {
      case "ping":
        this.send(ws, { t: "pong", c: m.c, s: Date.now() });
        return;
      case "hello":
        return this.hello(ws, m, now);
      case "takeover": {
        const seat = core.takeover(att.token, now);
        if (seat == null) return;
        for (const other of this.socketsFor(seat)) if (other !== ws) { this.send(other, { t: "moved" }); try { other.close(4000, "moved"); } catch {} }
        ws.serializeAttachment({ seat, token: att.token, role: "seat" });
        this.welcome(ws, seat, now);
        break;
      }
      case "bye":
        if (att.seat != null) core.leave(att.seat, now);
        break;
    }
    if (att.seat == null) { this.flush(); return; }
    const seat = att.seat;
    switch (m.t) {
      case "pick": core.pick(seat, m.slot | 0, m.opt | 0, now); break;
      case "vote": core.vote(seat, m.v, now); break;
      case "begin": core.begin(seat, now); break;
      case "host": core.hostAction(seat, String(m.a || ""), { seat: m.seat | 0, pack: String(m.pack || ""), on: !!m.on }, now); break;
      case "reroll": core.reroll(seat); break;
      case "knock": if (this.every(ws, "knock", 1000)) core.knock(seat); break;
      case "emote": if (this.every(ws, "emote", 1000)) core.emote(seat, m.e); break;
    }
    this.ensureLoop();
    this.flush();
  }

  hello(ws, m, now) {
    const core = this.core;
    if (m.v !== PROTOCOL) { this.send(ws, { t: "reload", build: BUILD }); return; }
    if (Array.isArray(m.recentQ)) core.session.recentQ = m.recentQ.filter((q) => typeof q === "string").slice(0, 40);
    const res = core.join({ token: m.token, want: m.want === "watch" ? "watch" : "seat", device: String(m.device || "laptop"), now });
    if (res.error) {
      this.send(ws, { t: "err", code: res.error, msg: res.error === "full" ? "This table is full." : "You can't join this table right now." });
      try { ws.close(4003, res.error); } catch {}
      return;
    }
    if (res.dupe && m.retake) {
      // A reload or a reconnect from the same tab: take the seat back quietly.
      const seat = core.takeover(m.token, now);
      if (seat != null) {
        for (const other of this.socketsFor(seat)) if (other !== ws) { this.send(other, { t: "moved" }); try { other.close(4000, "moved"); } catch {} }
        ws.serializeAttachment({ seat, token: m.token, role: "seat" });
        this.welcome(ws, seat, now);
        this.ensureLoop();
        this.flush();
        return;
      }
    }
    if (res.dupe) {
      ws.serializeAttachment({ seat: null, token: m.token, role: "dupe" });
      this.send(ws, { t: "dupe" });
      return;
    }
    if (res.spectator) {
      ws.serializeAttachment({ seat: null, spectator: res.spectator, role: "watch" });
      this.send(ws, { t: "welcome", you: null, code: core.code, build: BUILD, serverMs: now, watching: true });
      this.send(ws, core.stateFor(null));
      this.send(ws, core.snapshotFor(null));
      return;
    }
    // Same seat in another socket (reload, flaky network): the newest wins.
    for (const other of this.socketsFor(res.seat)) if (other !== ws) { this.send(other, { t: "moved" }); try { other.close(4000, "moved"); } catch {} }
    ws.serializeAttachment({ seat: res.seat, token: res.token, role: "seat" });
    this.welcome(ws, res.seat, now);
    this.ensureLoop();
    this.flush();
    this.save(true);
  }

  welcome(ws, seat, now) {
    const core = this.core;
    const s = core.seat(seat);
    this.send(ws, {
      t: "welcome", code: core.code, build: BUILD, serverMs: now,
      you: { seat, token: s.token, name: s.name, colour: s.colour, host: core.hostSeat === seat },
      cfg: { stirMin: core.cfg.stirMin, inkR: core.cfg.inkR, dwell: core.cfg.dwell },
    });
    this.send(ws, core.stateFor(seat));
    this.send(ws, core.snapshotFor(seat));
    core.resync(seat);
  }

  async webSocketClose(ws) { await this.closed(ws); }
  async webSocketError(ws) { await this.closed(ws); }

  async closed(ws) {
    await this.ready;
    this.rates.delete(ws);
    if (!this.core) return;
    const att = ws.deserializeAttachment() || {};
    if (att.seat != null && !this.socketsFor(att.seat).some((o) => o !== ws)) {
      this.core.leave(att.seat, Date.now());
      this.flush();
      this.save(true);
    }
    await this.ctx.storage.setAlarm(Date.now() + 11_000);
  }

  // ------------------------------------------------------------ loop

  ensureLoop() {
    if (this.loop) return;
    this.idleSince = 0;
    this.loop = setInterval(() => this.onTick(), TICK_MS);
  }

  onTick() {
    const core = this.core;
    if (!core) return this.stopLoop();
    const now = Date.now();
    const before = core.tickN;
    core.tick(now);
    if (core.tickN !== before && core.tickN % 2 === 0) this.sendSnapshots();
    this.flush();
    if (core.phase !== this.lastSavedPhase) this.save(true);
    if (core.wantsLoop()) this.idleSince = 0;
    else if (!this.idleSince) this.idleSince = now;
    else if (now - this.idleSince > STOP_AFTER_MS) { this.sendSnapshots(); this.stopLoop(); this.save(true); }
  }

  stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  async alarm() {
    await this.ready;
    const sockets = this.ctx.getWebSockets().length;
    const now = Date.now();
    if (!this.core) return;
    if (sockets === 0 && now - (this.core.lastNow || 0) > RECYCLE_MS) {
      this.stopLoop();
      this.reportPeak();
      this.core = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    this.core.updateStatuses(now);
    this.core.lastNow = now;
    this.flush();
    await this.save(true);
    const waiting = this.core.seats.some((s) => s.kind === "human" && s.status === "gone");
    await this.ctx.storage.setAlarm(now + (waiting ? 11_000 : sockets ? 60_000 : RECYCLE_MS));
  }

  // ------------------------------------------------------------ output

  sendSnapshots() {
    const core = this.core;
    const veiled = core.seance && !core.seance.warmup && !core.seance.open && core.phase === "spell";
    let shared = null;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      if (att.role !== "seat" && att.role !== "watch") continue;
      if (veiled) this.sendRaw(ws, JSON.stringify(core.snapshotFor(att.seat ?? null)));
      else this.sendRaw(ws, shared ||= JSON.stringify(core.snapshotFor(null)));
    }
  }

  flush() {
    const core = this.core;
    if (!core) return;
    const out = core.drain();
    if (!out.length) return;
    let wantState = false;
    const sockets = this.ctx.getWebSockets().map((ws) => [ws, ws.deserializeAttachment() || {}]);
    for (const { to, msg } of out) {
      if (to === "state") { wantState = true; continue; }
      if (to === "stats") { this.onReport(msg); continue; }
      if (msg && msg.k === "phase") this.dirty = true;
      const s = JSON.stringify(msg);
      for (const [ws, att] of sockets) {
        if (att.role !== "seat" && att.role !== "watch") continue;
        if (to === "all" || att.seat === to) this.sendRaw(ws, s);
      }
    }
    if (wantState) for (const [ws, att] of sockets) if (att.role === "seat" || att.role === "watch") this.send(ws, core.stateFor(att.seat ?? null));
  }

  async save(force) {
    if (!this.core || (!force && !this.dirty)) return;
    this.dirty = false;
    this.lastSavedPhase = this.core.phase;
    try { await this.ctx.storage.put("core", this.core.serialize()); } catch {}
  }

  // ------------------------------------------------------------ anonymous counts (fire-and-forget)

  onReport(msg) {
    this.postStats(msg);
    if (msg.kind === "seanceRevealed" && msg.daily && this.env.DAILY) {
      const first = !this.core.dailyCounted;
      this.core.dailyCounted = true;
      this.post(this.env.DAILY.get(this.env.DAILY.idFromName(msg.daily)), "https://daily/hit", { first });
    }
  }

  postStats(msg) {
    if (!this.env.STATS) return;
    const { qId, daily, ...counts } = msg; // the Stats DO only gets counts
    this.post(this.env.STATS.get(this.env.STATS.idFromName("global")), "https://stats/add", { ...counts, daily: !!daily });
  }

  // A room's peak table size, counted once when the room is recycled.
  reportPeak() {
    const n = this.core && this.core.peakHumans;
    if (n > 0 && !this.core.peakReported) { this.core.peakReported = true; this.postStats({ kind: "roomPeak", humans: n }); }
  }

  post(stub, url, body) {
    try {
      const p = stub.fetch(url, { method: "POST", body: JSON.stringify(body) }).catch(() => {});
      if (this.ctx.waitUntil) this.ctx.waitUntil(p);
    } catch {}
  }

  socketsFor(seat) {
    return this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() || {}).seat === seat);
  }

  send(ws, obj) { this.sendRaw(ws, JSON.stringify(obj)); }
  sendRaw(ws, s) { try { ws.send(s); } catch {} }

  rateOk(ws) {
    const now = Date.now();
    let r = this.rates.get(ws);
    if (!r) { r = { since: now, n: 0, lastBy: {} }; this.rates.set(ws, r); }
    if (now - r.since >= 1000) { r.since = now; r.n = 0; }
    return ++r.n <= MAX_RATE;
  }

  every(ws, key, ms) {
    const r = this.rates.get(ws);
    if (!r) return true;
    const now = Date.now();
    if (now - (r.lastBy[key] || 0) < ms) return false;
    r.lastBy[key] = now;
    return true;
  }
}
