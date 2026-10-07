// Ghost Hand - RoomCore: the whole game as a pure state machine (no I/O).
// The Durable Object feeds it sockets and time; tests and sims drive it directly.
//
// Output: core.drain() returns [{ to, msg }] where `to` is "all", a seat id,
// or "spectators". Snapshots are built per recipient with snapshotFor(seat).

import { makeConfig, tStart } from "../../public/js/shared/config.js";
import { step, newPlanchette, setTarget, quotas } from "../../public/js/shared/physics.js";
import { HOME, TARGET_BY_KEY, KEY_INDEX } from "../../public/js/shared/board.js";
import { encodeSnapshot, PF, HF, STATUS } from "../../public/js/shared/protocol.js";
import { rng } from "../../public/js/shared/rng.js";
import { newBotBrain, botNewLetter, botThink } from "../../public/js/shared/bots.js";

const DT = 1 / 30;
const MAX_HUMANS = 6;
const MAX_SPECTATORS = 12;
export const BOT_SEATS = [7, 8];   // Nani, Bram
const HUSH_SEAT = 9;
const SEAT_ANGLES = [150, 30, 195, 345, 110, 70]; // humans, degrees (client draws)
const DEG = Math.PI / 180;

const PHASE_MS = { warmupWait: 600, arrive: 3000, whisper: 1500, fill: 800, wordGap: 600, goodbye: 1200, rematch: 3000 };

const TWIST_LINES = { whisper: "Hush keeps this one secret.", gust: "Hush is feeling breezy tonight." };
const SOULMATE_MIN_SAMPLES = 20;   // 2 s of both pushing

const isToken = (t) => typeof t === "string" && /^[0-9a-f]{32}$/.test(t);

export class RoomCore {
  constructor({ code, now, seed = 1, content, cfg = {}, build = "dev", mode = "table", tutorial = false, pack = "cozy", daily = null }) {
    this.code = code;
    this.build = build;
    this.content = content;
    this.rand = rng(seed);
    this.cfg = makeConfig(cfg);
    this.mode = mode;                 // 'table' | 'solo'
    this.tutorial = tutorial;
    this.createdAt = now;
    this.locked = false;
    this.companion = false;
    this.oneSpeaker = false;
    this.phase = "lobby";
    this.phaseEndsAt = 0;
    this.hostSeat = null;
    this.eventSeq = 0;
    this.tickN = 0;
    this.acc = 0;
    this.lastNow = now;
    this.seats = [];                  // humans and bots
    this.spectators = new Set();
    this.barred = new Map();          // token -> until
    this.outbox = [];
    this.session = { seanceIndex: 0, pack, usedQ: [], usedWords: new Set(), firstTableSeance: true, recentQ: [] };
    // Daily question (spec §6.6): the first seance uses today's question.
    if (daily && daily.qId) { this.session.forceQ = daily.qId; this.session.daily = daily.date || null; if (daily.pack) this.session.pack = daily.pack; }
    this.peakHumans = 0;
    this.seance = null;
    this.planchette = newPlanchette(HOME.x, HOME.y);
    this.world = { planchette: this.planchette, hands: [], knower: -1, Tstart: this.cfg.tLobby, target: null, captureScale: 1, hushBlowing: false };
    this.last = { r: 0, gate: false, stir: false, hasDir: false, dirX: 0, dirY: 0 };
    this.votes = {};
    this.lobbyRestSince = 0;
    this.soloSince = 0;
    this.lastSampleAt = 0;
    if (mode === "solo") this.seatBots();
  }

  // ------------------------------------------------------------ seats

  humans(includeGone = true) {
    return this.seats.filter((s) => s.kind === "human" && (includeGone || s.status !== "gone"));
  }

  seat(id) { return this.seats.find((s) => s.id === id) || null; }

  join({ token, want = "seat", device = "laptop", now }) {
    if (isToken(token)) {
      const s = this.seats.find((x) => x.token === token && x.kind === "human");
      if (s) {
        if (s.status !== "gone" && s.connected) return { dupe: true, seat: s.id };
        this.reconnect(s, now);
        return { seat: s.id, token: s.token };
      }
      if ((this.barred.get(token) || 0) > now) return { error: "barred" };
    }
    const humans = this.humans();
    if (want === "watch" || humans.length >= MAX_HUMANS || (this.locked && humans.length > 0)) {
      if (this.spectators.size >= MAX_SPECTATORS) return { error: "full" };
      const id = `w${now.toString(36)}${Math.floor(this.rand() * 1e6)}`;
      this.spectators.add(id);
      return { spectator: id };
    }
    const used = new Set(humans.map((h) => h.colour));
    const colour = [0, 1, 2, 3, 4, 5].find((c) => !used.has(c));
    const s = {
      id: colour + 1, token: makeToken(this.rand), kind: "human", colour,
      name: this.uniqueName(colour), joinedAt: now, status: "ok", connected: true,
      rest: false, ux: 0, uy: 0, m: 0, device, lastPacketAt: now, lastChangeAt: now, goneAt: 0,
      restSince: 0, longestRest: 0, foresight: 0,
    };
    this.seats.push(s);
    this.peakHumans = Math.max(this.peakHumans, this.humans(false).length);
    if (this.hostSeat === null) this.hostSeat = s.id;
    this.event("seat", { a: "join", seat: s.id, name: s.name, colour: s.colour });
    this.onHumanJoined(s, now);
    return { seat: s.id, token: s.token };
  }

  takeover(token, now) {
    const s = this.seats.find((x) => x.token === token && x.kind === "human");
    if (!s) return null;
    this.reconnect(s, now);
    return s.id;
  }

  reconnect(s, now) {
    s.status = "ok"; s.connected = true; s.goneAt = 0; s.lastPacketAt = now; s.lastChangeAt = now;
    s.rest = false; s.m = 0;
    if (this.hostSeat === null) { this.hostSeat = s.id; this.event("host", { seat: s.id }); }
    this.event("seat", { a: "status", seat: s.id, status: "ok" });
  }

  leave(id, now) {
    const s = this.seat(id);
    if (!s || s.kind !== "human") { this.spectators.delete(id); return; }
    s.connected = false; s.status = "gone"; s.goneAt = now; s.rest = false; s.m = 0;
    this.event("seat", { a: "status", seat: s.id, status: "gone" });
    // The host keeps the role through a quick reload; it passes after 10 s away (updateStatuses).
  }

  passHost() {
    const next = this.humans(false).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    this.hostSeat = next ? next.id : null;
    if (next) this.event("host", { seat: next.id });
  }

  uniqueName(colour) {
    const { SEAT_COLOURS, CREATURES } = this.content.names;
    const taken = new Set(this.seats.map((s) => s.name));
    for (let i = 0; i < 40; i++) {
      const n = `${SEAT_COLOURS[colour].name} ${CREATURES[Math.floor(this.rand() * CREATURES.length)]}`;
      if (!taken.has(n)) return n;
    }
    return `${SEAT_COLOURS[colour].name} ${CREATURES[colour]}`;
  }

  reroll(id) {
    const s = this.seat(id);
    if (!s || s.kind !== "human" || this.phase !== "lobby") return;
    s.name = this.uniqueName(s.colour);
    this.event("seat", { a: "rename", seat: s.id, name: s.name });
  }

  seatBots() {
    const { SITTERS } = this.content.names;
    for (let i = 0; i < 2; i++) {
      if (this.seat(BOT_SEATS[i])) continue;
      this.seats.push({
        id: BOT_SEATS[i], kind: "bot", name: SITTERS[i].name, emblem: SITTERS[i].emblem,
        status: "ok", connected: true, rest: true, ux: 0, uy: 0, m: 0, brain: newBotBrain(this.rand), foresight: 0,
      });
    }
  }

  removeBots() {
    this.seats = this.seats.filter((s) => s.kind !== "bot");
  }

  onHumanJoined(s, now) {
    const humans = this.humans(false).length;
    if (this.mode === "solo" && humans === 1 && !this.seance) { this.startSeance(now); return; }
    if (this.mode === "solo" && humans === 2) {
      this.companion = true;
      this.companionSeat = s.id;
    } else if (this.mode === "solo" && humans >= 3) {
      this.pendingTable = true; // bots leave at the next seance boundary
    }
  }

  // ------------------------------------------------------------ input

  input(id, inp, now) {
    const s = this.seat(id);
    if (!s || s.kind !== "human") return;
    s.lastPacketAt = now;
    if (s.status === "silent") s.status = "ok";
    const changed = inp.resting !== s.rest || Math.abs(inp.m - s.m) > 0.05 || (inp.m > 0.05 && Math.abs(Math.atan2(inp.uy, inp.ux) - Math.atan2(s.uy, s.ux)) > 3 * DEG);
    if (changed) s.lastChangeAt = now;
    if (inp.hidden) { this.setDozing(s, true); s.rest = false; s.m = 0; return; }
    if (s.status === "dozing" && (inp.m > 0.05 || changed)) this.setDozing(s, false);
    if (inp.resting && !s.rest) s.restSince = now;
    if (!inp.resting && s.rest) s.longestRest = Math.max(s.longestRest, now - s.restSince);
    s.rest = inp.resting;
    s.ux = inp.ux; s.uy = inp.uy;
    s.m = inp.resting ? inp.m : 0;
    s.device = inp.device || s.device;
  }

  heartbeat(id, now) {
    const s = this.seat(id);
    if (!s) return;
    s.lastPacketAt = now;
    if (s.status === "silent") s.status = "ok";
  }

  setDozing(s, on) {
    const st = on ? "dozing" : "ok";
    if (s.status === st) return;
    s.status = st;
    this.event("seat", { a: "status", seat: s.id, status: st });
  }

  // Push the server actually uses, after the silence / doze rules (spec §4.1).
  effectivePush(s, now) {
    if (s.kind !== "human") return s.m;
    if (s.status === "gone" || s.status === "dozing" || !s.rest) return 0;
    const quiet = now - s.lastPacketAt;
    const { silenceMs, silenceHoldMs, silenceFadeMs } = this.cfg;
    if (quiet <= silenceMs + silenceHoldMs) return s.m;
    return s.m * Math.max(0, 1 - (quiet - silenceMs - silenceHoldMs) / silenceFadeMs);
  }

  updateStatuses(now) {
    for (const s of this.humans()) {
      if (s.status === "gone") continue;
      if (now - s.lastPacketAt > this.cfg.silenceMs && s.status === "ok") s.status = "silent";
      if (s.status !== "dozing" && s.m < 0.02 && now - s.lastChangeAt > this.cfg.dozeMs && this.phase !== "lobby" && this.phase !== "reveal") {
        this.setDozing(s, true);
      }
      if (s.status === "gone" && now - s.goneAt > this.cfg.seatHoldMs) this.dropSeat(s);
    }
    for (const s of this.seats.filter((x) => x.kind === "human" && x.status === "gone" && now - x.goneAt > this.cfg.seatHoldMs)) this.dropSeat(s);
    const host = this.seat(this.hostSeat);
    if (!host || (host.status === "gone" && now - host.goneAt > 10_000)) {
      const next = this.humans(false).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next && next.id !== this.hostSeat) { this.hostSeat = next.id; this.event("host", { seat: next.id }); }
    }
  }

  dropSeat(s) {
    this.seats = this.seats.filter((x) => x !== s);
    if (this.hostSeat === s.id) this.hostSeat = null;
    this.event("seat", { a: "leave", seat: s.id });
  }

  // N_h counts humans ok|silent; recounted only at letter boundaries (spec §3.3).
  countHumans() {
    return this.humans().filter((s) => s.status === "ok" || s.status === "silent").length;
  }

  // ------------------------------------------------------------ actions

  begin(id, now) {
    if (this.phase !== "lobby" || id !== this.hostSeat) return;
    const n = this.humans(false).length;
    if (n >= 2) this.startSession(now);
  }

  hostAction(id, a, args, now) {
    if (id !== this.hostSeat) return;
    if (a === "lock") this.locked = true;
    else if (a === "unlock") this.locked = false;
    else if (a === "pack" && this.content.questions.PACKS.some((p) => p.id === args.pack)) this.session.pack = args.pack;
    else if (a === "speaker") this.oneSpeaker = !!args.on;
    else if (a === "solo" && this.phase === "lobby" && this.humans(false).length === 1) { this.mode = "solo"; this.seatBots(); this.startSeance(now); return; }
    else if (a === "table" && this.mode === "solo") this.pendingTable = true;
    else if (a === "kick" && args.seat && args.seat !== id) {
      const s = this.seat(args.seat);
      if (s && s.kind === "human") { this.barred.set(s.token, now + 10 * 60_000); this.leave(s.id, now); this.dropSeat(s); }
    }
    this.pushState();
  }

  pick(id, slot, opt, now) {
    const sc = this.seance;
    if (!sc || this.phase !== "pick") return;
    const sl = sc.slots[slot];
    if (!sl || sl.seat !== id || sl.pick !== null || !(opt >= 0 && opt < 3)) return;
    sl.pick = opt;
    sl.word = sl.options[opt];
    this.event("seat", { a: "picked", seat: id, slot });
    if (sc.slots.every((x) => x.pick !== null)) this.phaseEndsAt = Math.min(this.phaseEndsAt, now + 400);
  }

  vote(id, v, now) {
    if (this.phase !== "reveal" || !this.seat(id)) return;
    this.votes[id] = v === "close" ? "close" : "again";
    const again = Object.values(this.votes).filter((x) => x === "again").length;
    const close = Object.values(this.votes).filter((x) => x === "close").length;
    this.event("vote", { again, close });
    const need = Math.ceil(this.humans(false).length / 2);
    if (again >= need && !this.rematchAt) this.rematchAt = now + PHASE_MS.rematch;
    if (this.mode === "table" && close >= need) { this.seance = null; this.setPhase("lobby", now, 0); }
  }

  knock(id) { this.event("knock", { seat: id }); }
  emote(id, e) { if (this.phase === "reveal" && ["laugh", "gasp", "heart", "tea"].includes(e)) this.event("emote", { seat: id, e }); }

  // ------------------------------------------------------------ session / seance

  startSession(now) {
    this.session.firstTableSeance = true;
    if (this.mode === "table" && this.humans(false).length >= 2) this.startWarmup(now);
    else this.startSeance(now);
  }

  startWarmup(now) {
    this.seance = { warmup: true, word: "HI", idx: 0, startedAt: now, hint: { step: 0, since: now } };
    this.world.Tstart = tStart(this.cfg, this.countHumans());
    this.setPhase("warmup", now, 0);
    this.nextTarget(now);
  }

  difficulty() {
    const i = this.session.seanceIndex;
    const n = this.humans(false).length;
    let band = i === 0 ? [3, 5] : i === 1 ? [4, 6] : [4, 7];
    if (n >= 5) band = [3, 5];
    if (this.session.pack === "kids") band = [3, 4];
    return {
      name: i === 0 ? "First Cup" : i === 1 ? "Second Cup" : "Last Biscuit",
      open: i === 0, thresholdScale: i === 0 ? 0.95 : 1, band,
      twist: i >= 2 ? (i % 2 === 0 ? "whisper" : "gust") : null,
    };
  }

  // Name and twist of the current (or, between seances, the next) seance for the client.
  difficultyInfo() {
    const sc = this.seance;
    if (sc && !sc.warmup && sc.diff) return { name: sc.diff.name, twist: sc.twist || null, open: !!sc.open, next: false };
    const d = this.difficulty();
    return { name: d.name, twist: d.twist, open: d.open, next: true };
  }

  startSeance(now) {
    if (this.pendingTable && this.humans(false).length >= 2) { this.mode = "table"; this.removeBots(); this.pendingTable = false; this.companion = false; }
    if (this.mode === "table" && this.humans(false).length === 1 && this.soloSince && now - this.soloSince > 15000) { this.mode = "solo"; this.seatBots(); }
    this.votes = {};
    this.rematchAt = 0;
    const diff = this.difficulty();
    this.cfg.thresholdScale = diff.thresholdScale;
    this.seance = this.tutorial ? this.buildTutorialSeance(now) : this.buildSeance(diff, now);
    this.planchette.x = HOME.x; this.planchette.y = HOME.y; this.planchette.vx = 0; this.planchette.vy = 0;
    this.world.gust = null;
    this.setPhase("arrive", now, now + PHASE_MS.arrive);
    const sc = this.seance;
    if (sc.twist) this.event("twist", { twist: sc.twist, name: sc.diff.name, line: TWIST_LINES[sc.twist] || "" });
    this.report("seanceStarted", { mode: this.mode, humans: this.humans(false).length, tutorial: !!sc.tutorialSeance, daily: !!sc.daily });
  }

  // Who owns which slot (spec §2.6).
  slotOwners() {
    const humans = this.humans(false).sort((a, b) => a.id - b.id);
    if (this.mode === "solo" && !this.companion) {
      const order = [BOT_SEATS[0], humans[0]?.id, BOT_SEATS[1]];
      return shuffle(order.filter(Boolean), this.rand);
    }
    if (this.mode === "solo" && this.companion) {
      const comp = this.companionSeat;
      const other = humans.find((h) => h.id !== comp)?.id;
      return [comp, BOT_SEATS[0], other].filter(Boolean);
    }
    if (humans.length === 2) return [humans[0].id, humans[1].id, humans[0].id, humans[1].id];
    // First knower rotates by seat each seance.
    const rot = this.session.seanceIndex % humans.length;
    return [...humans.slice(rot), ...humans.slice(0, rot)].map((h) => h.id);
  }

  buildSeance(diff, now) {
    const { QUESTIONS, CLAUSES } = this.content.questions;
    const pack = this.session.pack;
    const avoid = new Set([...this.session.usedQ, ...this.session.recentQ]);
    let pool = QUESTIONS.filter((q) => q.pack === pack && !avoid.has(q.id));
    if (!pool.length) pool = QUESTIONS.filter((q) => q.pack === pack && !this.session.usedQ.includes(q.id));
    if (!pool.length) pool = QUESTIONS.filter((q) => q.pack === pack);
    // The daily question is used once, for the first seance of the room.
    const forced = this.session.forceQ ? QUESTIONS.find((x) => x.id === this.session.forceQ) : null;
    const daily = forced ? this.session.daily || "today" : null;
    this.session.forceQ = null;
    const q = forced || pool[Math.floor(this.rand() * pool.length)];
    this.session.usedQ.push(q.id);

    const owners = this.slotOwners();
    let frame = q.frame;
    const extra = Math.max(0, owners.length - 3);
    const clauses = shuffle([...CLAUSES], this.rand).slice(0, extra);
    for (const c of clauses) frame += " " + c.text;
    const cats = [...frame.matchAll(/\{(a )?([A-Z]+)\}/g)].map((m) => m[2]);

    const slots = cats.map((cat, i) => {
      const prompts = this.content.words.PROMPTS[cat] || ["something you like"];
      return {
        i, seat: owners[i % owners.length], cat,
        prompt: prompts[Math.floor(this.rand() * prompts.length)],
        options: this.pickOptions(cat, diff.band, pack),
        pick: null, word: null, quota: 0, inked: [], filled: [], startedAt: 0, doneAt: 0,
      };
    });
    return {
      qId: q.id, ask: q.ask, frame, diff, twist: diff.twist, open: diff.open, slots, daily,
      wordIdx: -1, letterIdx: 0, inkedHand: 0, Nh: 0, foresight: 0, wobbles: 0, maxHint: 0,
      letterTimes: [], path: [], standIn: false, startedAt: now, knowerStats: {}, pairs: {},
    };
  }

  buildTutorialSeance(now) {
    const T = this.content.hush.TUTORIAL;
    const you = this.humans(false)[0]?.id;
    const slots = [
      { i: 0, seat: BOT_SEATS[0], cat: "TUT", prompt: "", options: [T.naniWord, T.naniWord, T.naniWord], pick: 0, word: T.naniWord },
      { i: 1, seat: you, cat: "TUT", prompt: "something that would make Hush's day", options: [...T.options], pick: null, word: null },
    ].map((s) => ({ quota: 0, inked: [], filled: [], startedAt: 0, doneAt: 0, ...s }));
    return {
      qId: "tutorial", ask: T.ask, frame: "{TUT} {TUT}", diff: { name: "First Cup", open: true, band: [3, 4], twist: null },
      open: true, twist: null, slots, tutorialSeance: true,
      wordIdx: -1, letterIdx: 0, inkedHand: 0, Nh: 0, foresight: 0, wobbles: 0, maxHint: 0,
      letterTimes: [], path: [], standIn: false, startedAt: now, knowerStats: {}, pairs: {},
    };
  }

  // One sensible, one absurd, one sweet; lengths within 2 letters; no session repeats (spec §7.1).
  pickOptions(cat, [lo, hi], pack) {
    const all = (this.content.words.WORDS[cat] || []).filter((w) => (w.packs.includes("*") || w.packs.includes(pack)) && (pack !== "kids" || w.kids));
    const fresh = (w) => !this.session.usedWords.has(w.w);
    const inBand = (w) => w.w.length >= lo && w.w.length <= hi;
    const out = [];
    for (const tone of ["sensible", "absurd", "sweet"]) {
      const near = (w) => !out.length || Math.abs(w.w.length - out[0].w.length) <= 2;
      const tiers = [
        all.filter((w) => w.tone === tone && fresh(w) && inBand(w) && near(w)),
        all.filter((w) => w.tone === tone && fresh(w) && near(w)),
        all.filter((w) => fresh(w) && !out.includes(w)),
        all.filter((w) => !out.includes(w)),
      ];
      const pool = tiers.find((t) => t.filter((w) => !out.includes(w)).length)?.filter((w) => !out.includes(w)) || [];
      if (pool.length) out.push(pool[Math.floor(this.rand() * pool.length)]);
    }
    for (const w of out) this.session.usedWords.add(w.w);
    return shuffle(out.map((w) => w.w), this.rand);
  }

  // ------------------------------------------------------------ word loop

  beginWords(now) {
    const sc = this.seance;
    for (const sl of sc.slots) {
      if (sl.pick === null) { sl.pick = sc.tutorialSeance ? 0 : Math.floor(this.rand() * 3); sl.word = sl.options[sl.pick]; }
    }
    const solo = this.mode === "solo";
    const q = quotas(sc.slots.map((s) => s.word.length), solo ? this.cfg.budgetSolo : this.cfg.budgetTable, this.cfg.quotaFrac);
    sc.slots.forEach((s, i) => { s.quota = q[i]; });
    sc.wordIdx = -1;
    this.nextWord(now);
  }

  nextWord(now) {
    const sc = this.seance;
    sc.wordIdx++;
    if (sc.wordIdx >= sc.slots.length) { this.startGoodbye(now); return; }
    const sl = sc.slots[sc.wordIdx];
    sc.letterIdx = 0;
    sl.startedAt = now;
    const knower = this.seat(sl.seat);
    sl.gusted = false;
    sl.clueShown = sc.twist !== "whisper";
    this.world.gust = null;
    this.setPhase("whisper", now, now + PHASE_MS.whisper);
    this.event("wordStart", this.wordStartPayload(sl, knower));
    this.whisperTo(sl);
  }

  // Whisper twist: the clue line stays with the knower until the first letter inks.
  wordStartPayload(sl, knower = this.seat(sl.seat)) {
    const hushed = sl.clueShown === false;
    return { slot: sl.i, knower: sl.seat, prompt: hushed ? null : sl.prompt, hushed, len: sl.word.length, quota: sl.quota, kname: knower?.name || "" };
  }

  showClue(sl) {
    if (sl.clueShown !== false) return;
    sl.clueShown = true;
    this.event("clue", { slot: sl.i, prompt: sl.prompt });
  }

  whisperTo(sl) {
    this.send(sl.seat, { t: "whisper", slot: sl.i, word: sl.word, quota: sl.quota, next: sl.inked.length, prompt: sl.prompt });
  }

  currentSlot() {
    const sc = this.seance;
    return sc && sc.slots ? sc.slots[sc.wordIdx] || null : null;
  }

  // Set up the next letter target and recount the table (a letter boundary).
  nextTarget(now) {
    const sc = this.seance;
    let key = null;
    if (sc.warmup) key = sc.word[sc.idx] || null;
    else if (this.phase === "goodbye") key = "BYE";
    else { const sl = this.currentSlot(); key = sl ? sl.word[sl.inked.length] : null; }
    sc.Nh = this.countHumans();
    this.world.Tstart = tStart(this.cfg, sc.Nh);
    setTarget(this.world, key, this.cfg);
    sc.hint = { step: 0, since: now };
    sc.letterStart = now;
    sc.knowerStart = null;
    sc.fsQualified = new Set();
    for (const s of this.seats) { s.alignedSince = null; if (s.brain) botNewLetter(s.brain, { now, rand: this.rand, isKnower: this.isKnowerSeat(s.id), target: key, tutorial: this.tutorial }); }
    const sl = this.currentSlot();
    if (key && !sc.warmup && sl) this.send(sl.seat, { t: "ev", k: "target", letter: key, idx: sl.inked.length, q: ++this.eventSeq, at: now });
    if (sc.warmup || (sc.open && sl && sl.inked.length === 0)) this.event("glow", { letter: key, all: true });
  }

  isKnowerSeat(id) {
    const sc = this.seance;
    if (!sc || sc.warmup) return false;
    const sl = this.currentSlot();
    return !!sl && sl.seat === id && this.phase === "spell";
  }

  onInk(key, bounce, now) {
    const sc = this.seance;
    this.planchette.lastInked = key;
    if (sc.warmup) {
      this.event("ink", { ch: key, idx: sc.idx, warm: true, note: sc.idx });
      sc.idx++;
      if (sc.idx >= sc.word.length) { this.session.firstTableSeance = false; this.startSeance(now); }
      else this.nextTarget(now);
      return;
    }
    if (this.phase === "goodbye") { this.startReveal(now); return; }
    const sl = this.currentSlot();
    const took = (now - sc.letterStart) / 1000;
    const humansF = this.humans(false).filter((h) => h.id !== sl.seat).length;
    const fs = humansF >= 1 && sc.fsQualified.size >= Math.ceil(Math.max(1, humansF) / 2);
    if (fs) { sc.foresight++; for (const id of sc.fsQualified) { const s = this.seat(id); if (s) s.foresight++; } }
    sl.inked.push(key);
    sc.inkedHand++;
    sc.letterTimes.push(took);
    const ks = (sc.knowerStats[sl.seat] ||= { letters: 0, time: 0 });
    ks.letters++; ks.time += took;
    this.event("ink", { ch: key, idx: sl.inked.length - 1, slot: sl.i, fs, note: this.noteIndex(), bounce: !!bounce });
    this.showClue(sl);
    if (sl.inked.length >= sl.quota || sl.inked.length >= sl.word.length) this.startFill(now);
    else this.nextTarget(now);
  }

  noteIndex() {
    const sc = this.seance;
    return sc.slots.reduce((n, s) => n + s.inked.length + s.filled.length, 0) - 1;
  }

  startFill(now) {
    const sl = this.currentSlot();
    const rest = sl.word.slice(sl.inked.length).split("");
    sl.filled = rest;
    this.showClue(sl);
    setTarget(this.world, null, this.cfg);
    this.world.hushBlowing = false;
    this.world.gust = null;
    if (rest.length) this.event("hushFill", { slot: sl.i, letters: rest });
    this.setPhase("fill", now, now + PHASE_MS.fill + PHASE_MS.wordGap);
  }

  finishWord(now) {
    const sl = this.currentSlot();
    sl.doneAt = now;
    this.event("wordDone", { slot: sl.i, word: sl.word, seat: sl.seat });
    this.nextWord(now);
  }

  startGoodbye(now) {
    this.setPhase("goodbye", now, 0);
    this.nextTarget(now);
    this.world.hushBlowing = true; // Hush glides the planchette to GOODBYE
  }

  startReveal(now) {
    const sc = this.seance;
    this.world.hushBlowing = false;
    setTarget(this.world, null, this.cfg);
    this.setPhase("reveal", now, 0);
    const words = sc.slots.map((s) => ({ w: s.word, seat: s.seat, name: this.seat(s.seat)?.name || "", colour: this.seat(s.seat)?.colour ?? -1 }));
    const avg = sc.letterTimes.length ? sc.letterTimes.reduce((a, b) => a + b, 0) / sc.letterTimes.length : 99;
    const stars = { swift: avg <= this.cfg.swiftStar, steady: sc.wobbles <= 1, sure: sc.maxHint < 2 };
    this.event("reveal", {
      frameText: fillFrame(sc.frame, sc.slots, this.content.words.WORDS),
      ask: sc.ask, words, stars, fs: sc.foresight, titles: this.superlatives(),
      path: sc.path.slice(-600), line: sc.tutorialSeance ? `MORE ${sc.slots[1]?.word || "PIE"}? You know me so well.` : this.reactionLine(sc), seance: sc.diff.name,
      secs: Math.round((now - sc.startedAt) / 1000), hands: this.humans(false).length + this.seats.filter((s) => s.kind === "bot").length,
      twist: sc.twist || null, daily: sc.daily || null,
    });
    this.report("seanceRevealed", {
      mode: this.mode, humans: this.humans(false).length, secs: (now - sc.startedAt) / 1000,
      tutorial: !!sc.tutorialSeance, daily: sc.daily || null, qId: sc.qId,
    });
    this.session.seanceIndex++;
    if (this.tutorial) { this.tutorial = false; this.wasTutorial = true; }
  }

  reactionLine(sc) {
    const { REACTIONS } = this.content.questions;
    const cats = new Map(sc.slots.map((s) => [s.cat, s.word]));
    const texts = REACTIONS.map((r) => (typeof r === "string" ? r : r.text));
    const fits = texts.filter((t) => [...t.matchAll(/\{(a )?([A-Z]+)\}/g)].every((m) => cats.has(m[2])));
    const t = fits.length ? fits[Math.floor(this.rand() * fits.length)] : null;
    if (!t) return this.content.hush.HUSH_LINES.reveal[0];
    return t.replace(/\{(a )?([A-Z]+)\}/g, (_, a, c) => (a ? article(cats.get(c), c, this.content.words.WORDS) + " " : "") + cats.get(c));
  }

  // Greedy titles in priority order (spec §6.3), simplified for v1.
  superlatives() {
    const humans = this.humans(false);
    const sc = this.seance;
    const titles = [];
    const taken = new Set();
    const give = (seat, title) => { if (seat && !taken.has(seat)) { taken.add(seat); titles.push({ seat, title }); } };
    const best = (score, ok = () => true) => humans.filter((h) => !taken.has(h.id) && ok(h)).sort((a, b) => score(b) - score(a))[0];
    give(best((h) => h.foresight, (h) => h.foresight >= 1)?.id, "First to Feel");
    give(best((h) => { const k = sc.knowerStats[h.id]; return k ? -k.time / k.letters : -999; }, (h) => (sc.knowerStats[h.id]?.letters || 0) >= 2)?.id, "Bold Knower");
    // Soulmates: two followers whose aims matched most while both pushed (one title for the pair).
    const isHere = (id) => humans.some((h) => h.id === id);
    const pair = Object.entries(sc.pairs || {})
      .map(([k, p]) => ({ a: +k.split("-")[0], b: +k.split("-")[1], n: p.n, mean: p.sum / p.n }))
      .filter((p) => p.n >= SOULMATE_MIN_SAMPLES && p.mean >= 0.85 && !taken.has(p.a) && !taken.has(p.b) && isHere(p.a) && isHere(p.b))
      .sort((x, y) => y.mean - x.mean || y.n - x.n)[0];
    if (pair) {
      taken.add(pair.a); taken.add(pair.b);
      titles.push({ seat: pair.a, title: "Soulmates", with: pair.b }, { seat: pair.b, title: "Soulmates", with: pair.a });
    }
    give(best((h) => h.longestRest)?.id, "Patient Owl");
    for (const h of humans) give(h.id, "Kind Hand");
    for (const h of humans) h.foresight = 0;
    return titles;
  }

  // ------------------------------------------------------------ phases

  setPhase(name, now, endsAt) {
    this.phase = name;
    for (const s of this.seats) if (s.kind === "human") s.lastChangeAt = Math.max(s.lastChangeAt || 0, now);
    this.phaseEndsAt = endsAt;
    if (name === "spell") this.nextTarget(now);
    this.event("phase", { name, deadline: endsAt });
    this.pushState();
  }

  pushState() { this.outbox.push({ to: "state", msg: null }); }

  advancePhase(now) {
    const sc = this.seance;
    switch (this.phase) {
      case "lobby": {
        const humans = this.humans(false);
        const resting = humans.length >= 2 && humans.every((h) => h.rest);
        if (resting) { if (!this.lobbyRestSince) this.lobbyRestSince = now; else if (now - this.lobbyRestSince >= 1500) { this.lobbyRestSince = 0; this.startSession(now); } }
        else this.lobbyRestSince = 0;
        break;
      }
      case "arrive":
        if (now >= this.phaseEndsAt) {
          const extra = Math.max(0, sc.slots.length - 3);
          if (sc.tutorialSeance) this.setPhase("pick", now, now + 25000);
          else this.setPhase("pick", now, now + 10000 + 4000 * extra);
          this.sendPicks(now);
        }
        break;
      case "pick":
        this.botPicks(now);
        if (now >= this.phaseEndsAt) this.beginWords(now);
        break;
      case "whisper":
        if (now >= this.phaseEndsAt) { const sl = this.currentSlot(); if (sl) sl.spellAt = now; this.setPhase("spell", now, 0); }
        break;
      case "fill":
        if (now >= this.phaseEndsAt) this.finishWord(now);
        break;
      case "reveal":
        if (this.rematchAt && now >= this.rematchAt) this.startSeance(now);
        break;
      default: break;
    }
  }

  sendPicks(now) {
    const sc = this.seance;
    for (const h of this.humans(false)) {
      const mine = sc.slots.filter((s) => s.seat === h.id).map((s) => ({ slot: s.i, prompt: s.prompt, cat: s.cat, options: s.options }));
      if (mine.length) this.send(h.id, { t: "pickq", ask: sc.ask, slots: mine, deadline: this.phaseEndsAt, others: sc.slots.filter((s) => s.seat !== h.id).map((s) => ({ slot: s.i, seat: s.seat })) });
    }
  }

  botPicks(now) {
    for (const sl of this.seance.slots) {
      const s = this.seat(sl.seat);
      if (s && s.kind === "bot" && sl.pick === null && now - (this.phaseStartedAt || now) > 900 + sl.i * 500) {
        sl.pick = Math.floor(this.rand() * 3); sl.word = sl.options[sl.pick];
        this.event("seat", { a: "picked", seat: s.id, slot: sl.i });
      }
    }
    if (this.seance.slots.every((x) => x.pick !== null)) this.phaseEndsAt = Math.min(this.phaseEndsAt, now + 400);
  }

  // ------------------------------------------------------------ tick

  tick(now) {
    this.acc += Math.min(200, now - this.lastNow);
    this.lastNow = now;
    let steps = 0;
    while (this.acc >= DT * 1000 && steps < 4) {
      this.acc -= DT * 1000;
      steps++;
      this.tickN++;
      this.stepOnce(now);
    }
  }

  stepOnce(now) {
    this.updateStatuses(now);
    if (this.phase !== this.prevPhase) { this.phaseStartedAt = now; this.prevPhase = this.phase; }
    if (this.mode === "table" && this.humans(false).length === 1) this.soloSince ||= now; else this.soloSince = 0;
    this.advancePhase(now);

    const live = this.phase === "warmup" || this.phase === "spell" || this.phase === "goodbye" || this.phase === "lobby";
    const sc = this.seance;
    const humanResting = this.humans(false).some((h) => h.rest && h.status !== "dozing");

    // Assemble hands for physics.
    const hands = [];
    let knowerIdx = -1;
    const knowerSeat = this.phase === "spell" ? this.currentSlot()?.seat : null;
    const target = this.world.target;
    for (const s of this.seats) {
      const isKnower = s.id === knowerSeat;
      if (s.kind === "bot") {
        const others = this.seats.filter((o) => o !== s).map((o) => ({ ux: o.ux, uy: o.uy, m: o.kind === "human" ? this.effectivePush(o, now) : o.m, w: o.id === knowerSeat ? this.cfg.knowerWeight : 1, kind: o.kind, knower: o.id === knowerSeat }));
        const p = live && this.phase !== "lobby" ? botThink(s.brain, { now, rand: this.rand, isKnower, target, lens: this.planchette, others, humanResting, assist: this.assistOn, tutorial: this.tutorial }) : { ux: 0, uy: 0, m: 0 };
        s.ux = p.ux; s.uy = p.uy; s.m = p.m;
      }
      const m = s.kind === "human" ? this.effectivePush(s, now) : s.m;
      if (s.kind === "human" && s.status === "gone") continue;
      if (isKnower) knowerIdx = hands.length;
      const w = this.phase === "lobby" || (sc && sc.warmup) ? 1 : isKnower ? this.cfg.knowerWeight : 1;
      hands.push({ kind: s.kind, w, ux: s.ux, uy: s.uy, m, seat: s.id });
    }
    // Hush's hand: warm-up helper, or stand-in for an absent knower.
    if (sc && sc.warmup && this.phase === "warmup" && target) hands.push(this.hushHand(target, 1.0));
    if (this.phase === "spell") this.updateStandIn(now, hands, target);

    this.world.hands = hands;
    this.world.knower = knowerIdx;
    if (this.phase === "lobby") this.world.Tstart = this.cfg.tLobby;

    if (!live) { this.last = { r: 0, gate: false, stir: false, hasDir: false, dirX: 0, dirY: 0 }; return; }

    const out = step(this.world, this.cfg, DT);
    this.last = out;
    if (this.phase === "lobby") return;

    for (const e of out.events) {
      if (e.k === "breakaway") this.event("breakaway", {});
      else if (e.k === "wobble") { if (sc && !sc.warmup) sc.wobbles++; this.event("wobble", { ch: e.key }); }
      else if (e.k === "ink") this.onInk(e.key, e.bounce, now);
    }
    if (this.phase === "spell" || this.phase === "warmup") {
      this.updateHints(now);
      this.updateForesight(now, hands, knowerIdx);
    }
    // Path for the replay, 10 Hz.
    if (sc && sc.path && this.phase === "spell" && now - this.lastSampleAt >= 100) {
      this.lastSampleAt = now;
      sc.path.push([Math.round(this.planchette.x), Math.round(this.planchette.y), sc.wordIdx]);
      this.samplePairs(hands, knowerIdx);
    }
    if (this.phase === "spell" && sc && sc.twist === "gust") this.updateGust(now);
  }

  // Soulmates (spec §6.3): cosine similarity of every pair of pushing followers, 10 Hz.
  samplePairs(hands, knowerIdx) {
    const sc = this.seance;
    if (!sc.pairs) sc.pairs = {};
    const f = hands.filter((h, i) => h.kind === "human" && i !== knowerIdx && h.m >= 0.4);
    for (let i = 0; i < f.length; i++) {
      for (let j = i + 1; j < f.length; j++) {
        const [a, b] = f[i].seat < f[j].seat ? [f[i], f[j]] : [f[j], f[i]];
        const p = (sc.pairs[a.seat + "-" + b.seat] ||= { n: 0, sum: 0 });
        p.n++; p.sum += a.ux * b.ux + a.uy * b.uy;
      }
    }
  }

  // Gust twist: once per word, a sideways nudge while sliding, never toward the letter.
  updateGust(now) {
    const sl = this.currentSlot();
    const P = this.planchette;
    const G = this.world.gust;
    const T = this.world.target ? TARGET_BY_KEY[this.world.target] : null;
    if (!sl || !T) return;
    const d = Math.hypot(T.x - P.x, T.y - P.y);
    if (G && G.ms > 0) { if (d < this.cfg.approachR) G.ms = 0; return; }
    if (G) this.world.gust = null;
    const speed = Math.hypot(P.vx, P.vy);
    if (sl.gusted || !P.sliding || speed < 60 || d < this.cfg.gustClearR) return;
    if (now - (sl.spellAt || now) < this.cfg.gustQuietMs) return;
    if (this.rand() > 1 / 30) return; // about once a second while it qualifies
    let dx = -P.vy / speed, dy = P.vx / speed;
    if (dx * (T.x - P.x) + dy * (T.y - P.y) > 0) { dx = -dx; dy = -dy; }
    this.world.gust = { dx, dy, ms: this.cfg.gustMs, speed: this.cfg.gustSpeed };
    sl.gusted = true;
    this.event("gust", { slot: sl.i, dir: Math.round((Math.atan2(dy, dx) / DEG + 360) % 360), dx: +dx.toFixed(3), dy: +dy.toFixed(3) });
  }

  hushHand(target, w) {
    const T = TARGET_BY_KEY[target];
    const dx = T.x - this.planchette.x, dy = T.y - this.planchette.y, d = Math.hypot(dx, dy) || 1;
    return { kind: "hush", w, ux: dx / d, uy: dy / d, m: d < 45 ? 0 : 1, seat: HUSH_SEAT };
  }

  updateStandIn(now, hands, target) {
    const sc = this.seance;
    const sl = this.currentSlot();
    const k = sl && this.seat(sl.seat);
    const away = k && k.kind === "human" && (k.status === "gone" || k.status === "dozing");
    if (away) { k.awaySince ||= now; } else if (k) k.awaySince = 0;
    const on = away && now - k.awaySince >= this.cfg.standInMs;
    if (on !== sc.standIn) { sc.standIn = on; this.event("hushHelp", { on }); if (on) this.event("glow", { letter: target, all: true }); }
    if (on && target) hands.push(this.hushHand(target, 1.5));
  }

  // Stuck ladder (spec §3.6); the tutorial uses faster steps and a soft assist.
  updateHints(now) {
    const sc = this.seance;
    const allAway = this.humans(false).every((h) => h.status === "dozing");
    if (allAway) { sc.hint.since += DT * 1000; return; }
    const t = (now - sc.hint.since) / 1000;
    const steps = this.tutorial ? [3, 7, 20] : [this.cfg.hint1, this.cfg.hint2, this.cfg.hint3];
    let step = 0;
    if (t >= steps[0]) step = 1;
    if (t >= steps[1]) step = 2;
    if (t >= steps[2]) step = 3;
    this.assistOn = this.tutorial && t >= 12;
    this.world.captureScale = this.assistOn ? 1.5 : 1;
    if (step !== sc.hint.step) {
      sc.hint.step = step;
      if (!sc.warmup) sc.maxHint = Math.max(sc.maxHint, step);
      this.event("hint", { step, letter: step >= 1 ? this.world.target : null });
      if (step === 3) this.world.hushBlowing = true;
    }
    if (this.world.hushBlowing && this.planchette.captured && this.phase !== "goodbye") this.world.hushBlowing = false;
    // Past step 3 Hush blows again whenever the lens is dragged out of capture, so a word can never stall for good.
    else if (sc.hint.step === 3 && !this.world.hushBlowing && !this.planchette.captured && !this.planchette.sliding) this.world.hushBlowing = true;
  }

  // "The table knew" (spec §6.1).
  updateForesight(now, hands, knowerIdx) {
    const sc = this.seance;
    if (sc.warmup || knowerIdx < 0 || !this.world.target) return;
    const T = TARGET_BY_KEY[this.world.target];
    const tx = T.x - this.planchette.x, ty = T.y - this.planchette.y;
    const tl = Math.hypot(tx, ty) || 1;
    const aimed = (h) => h.m >= 0.4 && (h.ux * tx + h.uy * ty) / tl >= Math.cos(25 * DEG);
    const kn = hands[knowerIdx];
    if (sc.knowerStart === null && aimed(kn)) sc.knowerStart = now;
    for (const h of hands) {
      if (h.kind !== "human" || h === kn) continue;
      const s = this.seat(h.seat);
      if (aimed(h)) {
        s.alignedSince ??= now;
        const start = s.alignedSince;
        const inWindow = start >= sc.letterStart + 250 && (sc.knowerStart === null || start <= sc.knowerStart + 300);
        if (inWindow && now - start >= 150) sc.fsQualified.add(s.id);
      } else s.alignedSince = null;
    }
  }

  // ------------------------------------------------------------ output

  event(k, payload) {
    this.outbox.push({ to: "all", msg: { t: "ev", q: ++this.eventSeq, at: this.lastNow, k, ...payload } });
    if (k === "seat" || k === "host") this.pushState();
  }

  send(to, msg) { this.outbox.push({ to, msg }); }

  // Anonymous counts for the Room DO to forward to the Stats DO (never sent to players).
  report(kind, data) { this.outbox.push({ to: "stats", msg: { kind, ...data } }); }

  drain() { const o = this.outbox; this.outbox = []; return o; }

  wantsLoop() {
    if (["warmup", "arrive", "pick", "whisper", "spell", "fill", "goodbye"].includes(this.phase)) return true;
    if (this.phase === "reveal" && this.rematchAt) return true;
    return this.humans(false).some((h) => h.rest);
  }

  snapshotFor(seatId) {
    const P = this.planchette;
    const sc = this.seance;
    const veiled = sc && !sc.warmup && !sc.open && this.phase === "spell";
    const knowerSeat = this.phase === "spell" ? this.currentSlot()?.seat : null;
    let pf = 0;
    if (P.sliding) pf |= PF.SLIDING;
    if (P.captured) pf |= PF.CAPTURED;
    if (this.last.stir) pf |= PF.STIR;
    if (sc && sc.hint) pf |= (Math.min(3, sc.hint.step) << PF.HINT_SHIFT);
    if (this.world.hushBlowing) pf |= PF.BLOWING;
    if (this.world.gust && this.world.gust.ms > 0) pf |= PF.GUST;
    const wh = new Map(this.world.hands.map((h) => [h.seat, h]));
    const hands = [];
    for (const s of [...this.seats, ...(wh.has(HUSH_SEAT) ? [{ id: HUSH_SEAT, kind: "hush", status: "ok", rest: true }] : [])]) {
      const h = wh.get(s.id) || { ux: 0, uy: 0, m: 0, counted: false };
      const statusIdx = Math.max(0, STATUS.indexOf(s.status || "ok"));
      let hf = (statusIdx << HF.STATUS_SHIFT);
      if (s.kind === "human" ? s.rest : true) hf |= HF.RESTING;
      if (h.counted) hf |= HF.COUNTED;
      if (s.kind !== "human") hf |= HF.BOT;
      const hidden = veiled && s.id !== seatId;
      if (!hidden && s.id === knowerSeat && sc && sc.open) hf |= HF.VISIBLE;
      hands.push({ seat: s.id, ux: h.ux, uy: h.uy, m: h.m, hf, hidden });
    }
    const dwellKey = this.world.target;
    return encodeSnapshot({
      tick: this.tickN, serverMs: this.lastNow, x: P.x, y: P.y, vx: P.vx, vy: P.vy, pf,
      hasDir: this.last.hasDir, dirX: this.last.dirX, dirY: this.last.dirY, r: this.last.r || 0,
      dwellL: P.dwellP > 0 && dwellKey ? KEY_INDEX[dwellKey] : -1, dwellP: P.dwellP, hands,
    });
  }

  // Full state for one recipient (spec §10.5-10.6): never another player's word or options.
  stateFor(seatId) {
    const sc = this.seance;
    const me = this.seat(seatId);
    const seats = this.seats.map((s) => ({ id: s.id, kind: s.kind, name: s.name, colour: s.colour ?? -1, emblem: s.emblem || null, status: s.status, host: s.id === this.hostSeat }));
    let seance = null;
    if (sc && !sc.warmup) {
      const sl = this.currentSlot();
      seance = {
        qId: sc.qId, ask: sc.ask, name: sc.diff.name, open: sc.open, twist: sc.twist || null, daily: sc.daily || null,
        wordIdx: sc.wordIdx, slotCount: sc.slots.length,
        slots: sc.slots.map((s) => ({
          i: s.i, seat: s.seat, cat: s.cat, len: s.word ? s.word.length : 0, quota: s.quota,
          inked: s.doneAt || s.seat === seatId ? s.inked : s.inked, filled: s.doneAt ? s.filled : [],
          word: s.doneAt || (s.seat === seatId && s.word) ? s.word : null,
          picked: s.pick !== null, prompt: sl && sl.i === s.i && (s.clueShown !== false || s.seat === seatId) ? s.prompt : null,
          hushed: !!(sl && sl.i === s.i && s.clueShown === false),
        })),
        hint: sc.hint ? sc.hint.step : 0, standIn: sc.standIn,
      };
    } else if (sc && sc.warmup) {
      seance = { warmup: true, word: sc.word, idx: sc.idx };
    }
    return {
      t: "state", code: this.code, phase: this.phase, phaseEndsAt: this.phaseEndsAt, mode: this.mode,
      companion: this.companion, locked: this.locked, host: this.hostSeat, you: me ? me.id : null,
      tutorial: this.tutorial || (!!this.wasTutorial && this.phase === "reveal" && this.session.seanceIndex === 1), seats, seance, votes: this.votes, pack: this.session.pack,
      seanceIndex: this.session.seanceIndex, seatAngles: SEAT_ANGLES, daily: this.session.daily || null,
      difficulty: this.difficultyInfo(),
    };
  }

  // ------------------------------------------------------------ persistence

  serialize() {
    const skip = new Set(["rand", "content", "outbox", "spectators", "world"]);
    const o = {};
    for (const [k, v] of Object.entries(this)) if (!skip.has(k)) o[k] = v;
    o.session = { ...this.session, usedWords: [...this.session.usedWords] };
    o.barred = [...this.barred];
    o.worldTarget = this.world.target;
    o.worldTstart = this.world.Tstart;
    o.hushBlowing = this.world.hushBlowing;
    return JSON.parse(JSON.stringify(o, (k, v) => (k === "brain" ? undefined : v)));
  }

  static restore(data, content, now) {
    const core = new RoomCore({ code: data.code, now, seed: (now ^ 0x9e3779b9) >>> 0, content, cfg: data.cfg, mode: data.mode });
    const { worldTarget, worldTstart, hushBlowing, ...rest } = data;
    Object.assign(core, rest);
    core.content = content;
    core.outbox = [];
    core.spectators = new Set();
    core.session.usedWords = new Set(data.session.usedWords || []);
    core.barred = new Map(data.barred || []);
    core.world = { planchette: core.planchette, hands: [], knower: -1, Tstart: worldTstart, target: worldTarget, captureScale: 1, hushBlowing };
    for (const s of core.seats) if (s.kind === "bot") s.brain = newBotBrain(core.rand);
    core.lastNow = now;
    core.acc = 0;
    return core;
  }

  // After a reconnect: send this seat whatever private things it should hold.
  resync(id) {
    const sc = this.seance;
    if (!sc) return;
    const key = this.world.target;
    const ev = (k, p) => this.send(id, { t: "ev", k, q: ++this.eventSeq, at: this.lastNow, ...p });
    if (key && ["warmup", "spell", "goodbye"].includes(this.phase)) {
      const sl0 = this.currentSlot();
      if (sc.warmup || sc.standIn || (sc.open && sl0 && sl0.inked.length === 0)) ev("glow", { letter: key, all: true });
      if (sc.hint && sc.hint.step > 0) ev("hint", { step: sc.hint.step, letter: key });
      if (!sc.warmup && sl0 && this.phase === "spell") ev("wordStart", this.wordStartPayload(sl0));
    }
    if (sc.warmup) return;
    if (this.phase === "pick") {
      const mine = sc.slots.filter((s) => s.seat === id && s.pick === null);
      if (mine.length) this.send(id, { t: "pickq", ask: sc.ask, slots: mine.map((s) => ({ slot: s.i, prompt: s.prompt, cat: s.cat, options: s.options })), deadline: this.phaseEndsAt, others: [] });
    }
    const sl = this.currentSlot();
    if (sl && sl.seat === id && (this.phase === "whisper" || this.phase === "spell")) {
      this.whisperTo(sl);
      if (this.phase === "spell" && this.world.target) this.send(id, { t: "ev", k: "target", letter: this.world.target, idx: sl.inked.length, q: ++this.eventSeq, at: this.lastNow });
    }
  }
}

// ------------------------------------------------------------ helpers

function makeToken(rand) {
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function article(word, cat, WORDS) {
  const entry = (WORDS[cat] || []).find((w) => w.w === word);
  if (entry) return entry.an ? "AN" : "A";
  return /^[AEIOU]/.test(word) ? "AN" : "A";
}

export function fillFrame(frame, slots, WORDS) {
  let i = 0;
  return frame.replace(/\{(a )?([A-Z]+)\}/g, (_, a, cat) => {
    const w = slots[i++]?.word || "?";
    return a ? `${article(w, cat, WORDS)} ${w}` : w;
  });
}
