// Ghost Hand - connection, clock sync, snapshot interpolation and event timing (spec §4.7).
//
// Every screen renders the shared world at renderTime = serverNow - D, and fires
// events at their server timestamp on that same clock, so an ink lands exactly as
// the planchette arrives, on every device at once.

import { PROTOCOL, decodeSnapshot, encodeInput } from "./shared/protocol.js";
import { BUILD } from "./build.js";

const RING = 32;
const D_MIN = 120, D_MAX = 320, D_START = 150;

export async function createRoom(mode = "table", pack = "cozy", { daily = false } = {}) {
  const r = await fetch(`/api/room?mode=${mode}&pack=${pack}${daily ? "&daily=1" : ""}`, { method: "POST" });
  const j = await r.json();
  if (!j.code) throw new Error(j.error || "Could not open a table");
  return j.code;
}

// Today's question (spec 6.6): { date, qId, ask, pack, stats: { tables, seances } } or null.
export async function dailyInfo() {
  try {
    const r = await fetch("/api/daily");
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.ask ? j : null;
  } catch { return null; }
}

export async function roomInfo(code) {
  try { return await (await fetch(`/api/room/${code}`)).json(); } catch { return { exists: false }; }
}

const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
};

export class Net extends EventTarget {
  constructor(code, { want = "seat", device = "laptop", recentQ = [] } = {}) {
    super();
    this.code = code;
    this.want = want;
    this.device = device;
    this.recentQ = recentQ;
    this.ws = null;
    this.seat = null;
    this.connected = false;
    this.closed = false;
    this.retry = 0;
    this.fails = 0;
    this.offset = 0;            // serverNow ~= Date.now() + offset
    this.haveOffset = false;
    this.pings = [];            // { rtt, off }
    this.D = D_START;
    this.snaps = [];
    this.jitter = [];
    this.lastSnapAt = 0;
    this.events = [];
    this.seq = 0;
    this.pingTimer = null;
    this.lastSentAt = 0;
  }

  get tokenKey() { return `gh.seat.${this.code}`; }
  serverNow() { return Date.now() + this.offset; }
  renderTime() { return this.serverNow() - this.D; }

  connect() {
    this.closed = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/${this.code}`);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.retry = 0;
      this.fails = 0;
      // Same tab coming back (a reload, or a reconnect after a blip) retakes its seat;
      // a duplicated tab (copied sessionStorage) is asked first.
      let reload = false;
      try { reload = performance.getEntriesByType("navigation")[0]?.type === "reload"; } catch {}
      const retake = this.everConnected || reload;
      this.everConnected = true;
      this.send({ t: "hello", v: PROTOCOL, build: BUILD, code: this.code, token: this.want === "watch" ? null : store.get(this.tokenKey), want: this.want, device: this.device, recentQ: this.recentQ, retake });
      this.burst();
    });
    ws.addEventListener("message", (ev) => this.onMessage(ev.data));
    ws.addEventListener("close", (ev) => {
      if (this.ws !== ws) return;
      this.connected = false;
      clearInterval(this.pingTimer);
      this.emit("status", { connected: false, code: ev.code });
      if (this.closed || [4000, 4003, 4004].includes(ev.code)) return;
      this.fails++;
      const wait = Math.min(4000, 250 * 2 ** this.retry++);
      setTimeout(() => { if (!this.closed) this.connect(); }, wait);
    });
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    try { this.send({ t: "bye" }); this.ws?.close(1000); } catch {}
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); return true; }
    return false;
  }

  sendInput(ux, uy, m, resting, device, hidden) {
    if (this.send(encodeInput(++this.seq, ux, uy, m, resting, device, hidden))) this.lastSentAt = performance.now();
  }

  heartbeat() {
    if (performance.now() - this.lastSentAt > 250 && this.send(["h", ++this.seq])) this.lastSentAt = performance.now();
  }

  burst() {
    for (let i = 0; i < 5; i++) setTimeout(() => this.send({ t: "ping", c: Date.now(), d: this.D }), i * 150);
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.send({ t: "ping", c: Date.now(), d: this.D }), 4000);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  onMessage(raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (Array.isArray(m)) {
      if (m[0] === "s") this.onSnapshot(decodeSnapshot(m));
      return;
    }
    switch (m.t) {
      case "pong": return this.onPong(m);
      case "welcome":
        this.connected = true;
        if (!this.haveOffset) { this.offset = m.serverMs - Date.now(); }
        if (m.you && this.want !== "watch") { this.seat = m.you.seat; store.set(this.tokenKey, m.you.token); }
        this.emit("welcome", m);
        this.emit("status", { connected: true });
        return;
      case "ev": this.events.push(m); return;
      default: this.emit(m.t, m);
    }
  }

  onPong(m) {
    const now = Date.now();
    const rtt = now - m.c;
    if (rtt < 0 || rtt > 5000) return;
    this.pings.push({ rtt, off: m.s + rtt / 2 - now });
    if (this.pings.length > 10) this.pings.shift();
    const best = this.pings.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    if (!this.haveOffset || Math.abs(best.off - this.offset) > 250) { this.offset = best.off; this.haveOffset = true; }
    else this.offset += Math.max(-5, Math.min(5, best.off - this.offset)); // slew gently
    this.rtt = best.rtt;
  }

  onSnapshot(s) {
    const now = this.serverNow();
    if (this.snaps.length) {
      const prev = this.snaps[this.snaps.length - 1];
      if (s.tick <= prev.tick && s.serverMs <= prev.serverMs) return;
      this.jitter.push(Math.max(0, now - s.serverMs));
      if (this.jitter.length > 60) this.jitter.shift();
    }
    this.snaps.push(s);
    if (this.snaps.length > RING) this.snaps.shift();
    this.lastSnapAt = performance.now();
    this.adaptD();
  }

  adaptD() {
    if (this.jitter.length < 10) return;
    const sorted = [...this.jitter].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const want = Math.max(D_MIN, Math.min(D_MAX, 66 + 2 * p90));
    this.D += Math.max(-0.7, Math.min(0.7, want - this.D)); // about 10 ms/s at 15 Hz
  }

  // Fire queued events whose time has come on the render clock.
  pumpEvents() {
    const rt = this.renderTime();
    let n = 0;
    while (n < this.events.length && (this.events[n].at || 0) <= rt) n++;
    if (!n && this.events.length && this.events[0].at - rt > 1000) n = 1; // clock trouble: never stall
    if (!n) return;
    const due = this.events.splice(0, n);
    for (const e of due) this.emit("ev", e);
  }

  // The interpolated shared world at renderTime (Hermite on positions + velocities).
  sample() {
    const S = this.snaps;
    if (!S.length) return null;
    const rt = this.renderTime();
    let i = S.length - 1;
    while (i > 0 && S[i - 1].serverMs > rt) i--;
    const b = S[i], a = S[i - 1];
    if (!a || rt >= b.serverMs) {
      // Past the newest snapshot: coast briefly, decelerating, then hold.
      const last = S[S.length - 1];
      const dt = Math.min(0.18, Math.max(0, (rt - last.serverMs) / 1000));
      const k = dt - (dt * dt) / (2 * 0.18);
      return { ...last, x: last.x + last.vx * k, y: last.y + last.vy * k, stale: performance.now() - this.lastSnapAt > 1500 };
    }
    if (rt <= a.serverMs) return { ...a, stale: false };
    const span = (b.serverMs - a.serverMs) / 1000;
    const t = (rt - a.serverMs) / (b.serverMs - a.serverMs);
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const lerp = (p, q) => p + (q - p) * t;
    return {
      ...a,
      x: h00 * a.x + h10 * span * a.vx + h01 * b.x + h11 * span * b.vx,
      y: h00 * a.y + h10 * span * a.vy + h01 * b.y + h11 * span * b.vy,
      vx: lerp(a.vx, b.vx), vy: lerp(a.vy, b.vy),
      r: lerp(a.r, b.r), dwellP: a.dwellL === b.dwellL ? lerp(a.dwellP, b.dwellP) : b.dwellP, dwellL: b.dwellL,
      dirX: lerp(a.dirX, b.dirX), dirY: lerp(a.dirY, b.dirY),
      sliding: b.sliding, captured: b.captured, stir: b.stir, hint: b.hint, blowing: b.blowing,
      hands: b.hands.map((h) => {
        const ha = a.hands.find((x) => x.seat === h.seat);
        if (!ha) return h;
        return { ...h, ux: lerp(ha.ux, h.ux), uy: lerp(ha.uy, h.uy), m: lerp(ha.m, h.m) };
      }),
      stale: false,
    };
  }
}
