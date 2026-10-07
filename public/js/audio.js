// Ghost Hand - sound engine. Every sound is synthesized live with Web Audio (no audio
// files): a sunny parlour of soft wood, felt and kalimba, and a ghost who hums.
//
//   const sound = new Sound();
//   button.onclick = () => sound.unlock();   // from a tap; cheap, safe to repeat
//
// Every method is a silent no-op until unlock() succeeds, and none of them ever throws.

const MUTE_KEY = "gh.muted";

const BUS = { ambience: 0.25, fx: 0.7, voice: 0.5 };
const ROOM = { cutoff: 600, sway: 150, swayHz: 0.07, level: 0.035, tick: 0.015, fade: 1 };
const CREAK = {
  from: 0.3, to: 0.95,                  // alignment range the creak grows across
  rate: [18, 55], freq: [350, 850], gain: [0.05, 0.2],
  q: 8, grains: 6, grainMs: 4, jitter: 0.2, lookahead: 0.025,
};
// A Q 8 bandpass lets through only ~3% of a 4 ms noise burst. Baking this boost into the
// grains lets CREAK.gain describe how loud the creak really is.
const GRAIN_BOOST = 20;
const GLIDE = { freq: 1200, q: 1, max: 0.08, boost: 2 };   // boost: makeup for the bandpass
const DWELL = { from: 400, to: 800, level: 0.03, air: 6, vibrato: 7 };
const VOICE = { level: 0.5, q1: 3, q2: 5, f2: 0.7, dry: 0.1, breath: 0.02, breathHz: 3000 };
const FORMANTS = { oo: [300, 870], ah: [730, 1090], ee: [270, 2290] };
const PARLOUR = { times: [0.061, 0.089], feedback: 0.35, damp: 2200, wet: 0.2 };
const PLUCK = 0.3;
const IDLE_SECS = 1.5;      // a looping sound is torn down after this long at silence
const LET_GO_SECS = 0.4;    // per-frame loudness fades out if not renewed within this
const WAKE_MS = 500;        // sounds may be queued this long while resume() is pending
const SEQ = { ahead: 0.25, everyMs: 50 };   // long tunes build their notes just in time
// Events that count as a user gesture (user activation) in Safari, Chrome and Firefox.
const TAP_EVENTS = ["touchend", "pointerup", "mousedown", "keydown"];

const C5 = 523.25;
const semis = (n) => Math.pow(2, n / 12);
const PENTATONIC = [0, 2, 4, 7, 9];                                        // C D E G A
const CATCH_NOTES = [C5 * 2, C5 * semis(19)];                              // C6, G6
const SEAT_NOTES = [-5, -3, 0, 2, 4, 7, 9, 12].map((n) => C5 * semis(n));  // G4 .. C6
const VOICE_BASE = 280;
const VOICE_SCALE = [0, 2, 4, 5, 7];                                       // 280 .. 420 Hz
const VOICE_STEPS = [-2, -1, -1, 0, 1, 1, 2];
const VOWEL_OF = { a: "ah", e: "ee", i: "ee", y: "ee", o: "oo", u: "oo" };
const VOWELS = ["oo", "ah", "ee"];
const WORD_GAP = 0.04, PUNCT_GAP = 0.16;

const IS_IOS = typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// ------------------------------------------------------------ small helpers

const noop = () => {};
const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);   // also turns NaN into 0
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const wait = (secs) => new Promise((resolve) => setTimeout(resolve, secs * 1000));

// Sound is decoration: a failure in here must never break the game.
function safely(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

// play(), resume() and suspend() return promises that may reject (or nothing at all).
function quietly(p) {
  if (p && p.catch) p.catch(noop);
}

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

// A repeat stop() can throw on older Safari; the first one already did the job.
function stopAt(src, t) {
  try { src.stop(t); } catch {}
}

// Disconnect a one-shot's nodes as soon as its source finishes, so nothing lingers.
function cleanup(src, ...nodes) {
  src.onended = () => {
    src.disconnect();
    for (const n of nodes) n.disconnect();
  };
}

// Percussive envelope: rise to `peak` in `attack` seconds, then fall away exponentially.
function strike(param, t, peak, decay, attack) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + decay);
}

// Ease a param from wherever it is right now to `value`, about 98% there after `secs`.
// setTargetAtTime starts from the live value, so a fade can safely interrupt another
// (a linear ramp would start from the previous event's time and could jump).
function fadeTo(param, value, now, secs) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
  else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
  param.setTargetAtTime(value, now, secs / 4);
}

// Letter i on the C major pentatonic from C5, up an octave every five notes. After two
// octaves the tune walks back down, so long sentences stay sweet instead of shrill.
function letterFreq(i) {
  const span = 10, k = i % (span * 2), step = k <= span ? k : span * 2 - k;
  return C5 * semis(12 * Math.floor(step / 5) + PENTATONIC[step % 5]);
}

// ------------------------------------------------------------ baked buffers

function whiteBuffer(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Paul Kellet's pink filter. The tail is cross-faded into the head so the loop has no seam.
function pinkLoopBuffer(ctx, seconds) {
  const sr = ctx.sampleRate, n = Math.round(seconds * sr), fade = Math.round(0.05 * sr);
  const raw = new Float32Array(n + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const x = (i / fade) * (Math.PI / 2);
    d[i] = i < fade ? raw[i] * Math.sin(x) + raw[n + i] * Math.cos(x) : raw[i];
    peak = Math.max(peak, Math.abs(d[i]));
  }
  for (let i = 0; i < n; i++) d[i] /= peak;
  return buf;
}

// A handful of 4 ms creak grains: noise with a quick rise and a longer fall. Uneven
// strengths make the creak sound like real wood rather than a machine.
function grainBuffers(ctx) {
  const sr = ctx.sampleRate, len = Math.round((CREAK.grainMs / 1000) * sr);
  return Array.from({ length: CREAK.grains }, (_, k) => {
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    const level = GRAIN_BOOST * (0.6 + (0.4 * k) / (CREAK.grains - 1));
    for (let i = 0; i < len; i++) {
      const x = i / len, env = x < 0.15 ? x / 0.15 : Math.pow(1 - (x - 0.15) / 0.85, 2);
      d[i] = (Math.random() * 2 - 1) * env * level;
    }
    return buf;
  });
}

// The 5 ms click on top of tok(): softened noise with a quick decay.
function clickBuffer(ctx) {
  const buf = ctx.createBuffer(1, Math.round(0.005 * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let y = 0;
  for (let i = 0; i < d.length; i++) {
    y += 0.3 * (Math.random() * 2 - 1 - y);        // one-pole lowpass takes the hiss off
    d[i] = 0.15 * y * Math.exp(-i / (d.length * 0.25));
  }
  return buf;
}

// Two-second mantel clock loop: a tick on the second, a slightly lower tock a second later.
function tickBuffer(ctx) {
  const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr * 2, sr), d = buf.getChannelData(0);
  const knock = (start, pitch) => {
    for (let i = 0; i < 0.06 * sr; i++) {
      const t = i / sr;
      d[start + i] += 0.6 * Math.sin(2 * Math.PI * 2200 * pitch * t) * Math.exp(-t / 0.003) +
        0.4 * Math.sin(2 * Math.PI * 1100 * pitch * t) * Math.exp(-t / 0.008);
    }
  };
  knock(0, 1);
  knock(sr, 0.86);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) d[i] /= peak;
  return buf;
}

// Half a second of 8-bit silence as a WAV data URI, for the iOS silent-switch workaround.
// It must share the AudioContext's sample rate: a mismatch makes iOS switch the hardware
// rate, and Web Audio then crackles or plays at the wrong pitch.
function silentWavURI(rate) {
  const n = Math.round(rate / 2);
  const u16 = (v) => String.fromCharCode(v & 255, (v >> 8) & 255);
  const u32 = (v) => u16(v & 0xffff) + u16(v >>> 16);
  const header = "RIFF" + u32(36 + n) + "WAVE" + "fmt " + u32(16) + u16(1) + u16(1) +
    u32(rate) + u32(rate) + u16(1) + u16(8) + "data" + u32(n);
  return "data:audio/wav;base64," + btoa(header + "\x80".repeat(n));
}

// ------------------------------------------------------------ Hush's voice planning

// Same text, same tune: a tiny deterministic PRNG seeded from the text (FNV-1a + mulberry32).
function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The vowel a syllable hums: the first vowel letter in its two-letter chunk, else in the word.
function vowelFor(chunk, word, rand) {
  const hit = /[aeiouy]/.exec(chunk) || /[aeiouy]/.exec(word);
  return hit ? VOWEL_OF[hit[0]] : VOWELS[Math.floor(rand() * VOWELS.length)];
}

// Turn text into hummed syllables: about one per two letters, 90-140 ms each, wandering
// through Hush's five-note range. Questions lift 4 semitones at the end; statements settle.
function planVoice(text, question) {
  const rand = seeded(text);
  const tokens = text.toLowerCase().slice(0, 240).match(/[\p{L}\p{N}']+|[.,!?;:…]/gu) || [];
  const syllables = [];
  let t = 0, degree = 2;
  for (const token of tokens) {
    const word = token.replace(/'/g, "");
    if (!word) continue;
    if (!/[\p{L}\p{N}]/u.test(word)) {               // punctuation: a longer breath
      if (syllables.length) t += PUNCT_GAP - WORD_GAP;
      continue;
    }
    for (let k = 0; k < Math.ceil(word.length / 2); k++) {
      const d = lerp(0.09, 0.14, rand());
      degree = Math.min(4, Math.max(0, degree + VOICE_STEPS[Math.floor(rand() * VOICE_STEPS.length)]));
      const f = VOICE_BASE * semis(VOICE_SCALE[degree] + (rand() - 0.5) * 0.3);
      syllables.push({ t, d, f, vowel: vowelFor(word.slice(k * 2, k * 2 + 2), word, rand) });
      t += d;
    }
    t += WORD_GAP;
  }
  const last = syllables[syllables.length - 1];
  if (!last) return { syllables, duration: 0 };
  last.d *= 1.35;
  last.bend = question ? semis(4) : Math.max(VOICE_BASE / last.f, semis(-2));
  return { syllables, duration: last.t + last.d + 0.15 };
}

function bandGain(f, center, q) {
  const x = f / center - center / f;
  return 1 / Math.sqrt(1 + q * q * x * x);
}

// Rough loudness of the hum (a triangle at f) through a formant pair. Dividing by it keeps
// "oo", "ah" and "ee" level even though the filters pass very different amounts.
function formantLevel(f, f1, f2) {
  let sum = 0;
  for (let n = 1; n <= 9; n += 2) {
    const g = bandGain(n * f, f1, VOICE.q1) + VOICE.f2 * bandGain(n * f, f2, VOICE.q2) + VOICE.dry;
    sum += Math.pow(g / (n * n), 2);
  }
  return Math.sqrt(sum);
}

// ------------------------------------------------------------ the engine

export class Sound {
  constructor() {
    this.ctx = null;                 // created by the first unlock()
    this._muted = readMuted();
    this.wantAmbience = false;
    this.wakeUntil = 0;
    this.room = null;                // looping sounds, alive only while needed
    this.glider = null;
    this.kettle = null;
    this.voice = null;               // the line Hush is speaking right now
    this.silentEl = null;
    this.tapWake = null;             // armed while a sleeping context waits for a tap
    this.targets = new WeakMap();    // per-frame AudioParam -> { value, renewAt } last sent
    this.creakNext = 0;
    this.creakLast = 0;
    this.glideHeard = 0;
    this.kettleHeard = 0;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => safely(() => this._onVisibility()));
    }
  }

  // ---------------------------------------------------------- lifecycle

  // Create or wake the AudioContext. Call from a tap; resolves true once sound is running.
  // Also the way back after an iOS interruption ("interrupted" state): just call it again.
  // If the context still won't run, the next tap anywhere on the page calls it for you.
  unlock() {
    return safely(() => {
      safely(() => this._preferPlaybackSession());   // before any audio starts
      if (!this.ctx) this._build();
      if (!this.ctx) return Promise.resolve(false);
      safely(() => this._playSilentLoop());
      if (this.ctx.state !== "running") safely(() => this._prime());
      safely(() => this._syncRoom());
      return this._resume();
    }, Promise.resolve(false));
  }

  setMuted(muted) {
    safely(() => {
      this._muted = !!muted;
      try { localStorage.setItem(MUTE_KEY, this._muted ? "1" : "0"); } catch {}
      if (!this.ctx) return;
      fadeTo(this.master.gain, this._muted ? 0 : 1, this.ctx.currentTime, 0.12);
      this._syncRoom();
    });
  }

  get muted() {
    return this._muted;
  }

  // ---------------------------------------------------------- the room

  // Room tone and mantel clock, faded over a second. Remembered if called before unlock().
  ambience(on) {
    safely(() => {
      this.wantAmbience = !!on;
      this._syncRoom();
    });
  }

  // Wood creak, called every frame with alignment a in [0, 1]; silent below 0.3. Grains are
  // only ever scheduled from here, so if the game stops calling, the creak simply stops.
  creak(a) {
    safely(() => {
      if (!this._live()) return;
      const now = this.ctx.currentTime, frame = now - this.creakLast;
      this.creakLast = now;
      if (this._muted || !(a >= CREAK.from)) { this.creakNext = 0; return; }
      const k = clamp01((a - CREAK.from) / (CREAK.to - CREAK.from));
      const rate = lerp(CREAK.rate[0], CREAK.rate[1], k);
      this._smooth(this.creakBand.frequency, lerp(CREAK.freq[0], CREAK.freq[1], k), 0.05);
      this._smooth(this.creakGain.gain, lerp(CREAK.gain[0], CREAK.gain[1], k), 0.05);
      // ~25 ms ahead, stretched to span a slow phone's frame gap so the grains never stall.
      const horizon = now + Math.min(0.1, Math.max(CREAK.lookahead, frame * 1.5));
      if (this.creakNext < now) this.creakNext = now + 0.005;
      while (this.creakNext < horizon) {
        this._grain(this.creakNext);
        this.creakNext += (1 + (Math.random() * 2 - 1) * CREAK.jitter) / rate;
      }
    });
  }

  // Felt sliding on wood, called every frame with speed in [0, 1].
  glide(speed01) {
    safely(() => {
      if (!this._live()) return;
      const s = this._muted ? 0 : clamp01(speed01), now = this.ctx.currentTime;
      if (s > 0.01) {
        this.glideHeard = now;
        if (!this.glider) this.glider = this._startGlide();
      }
      if (!this.glider) return;
      this._hold(this.glider.out.gain, GLIDE.max * GLIDE.boost * s, 0.06);
      if (now - this.glideHeard > IDLE_SECS) { this._retire(this.glider, now); this.glider = null; }
    });
  }

  // ---------------------------------------------------------- letters

  catchSound() {
    this._play((t) => CATCH_NOTES.forEach((f, i) => this._pluck(f, t + i * 0.07)));
  }

  letterNote(i) {
    this._play((t) => {
      const n = Math.floor(Number(i));
      if (Number.isFinite(n) && n >= 0) this._pluck(letterFreq(n), t);
    });
  }

  // A small wooden "tok": a sine falling 1800 -> 900 Hz in 30 ms, with a 5 ms click.
  tok() {
    this._play((t) => {
      const osc = this._partial(1800, t, 0.14, 0.045, 0.001, this.bus.fx);
      osc.frequency.setValueAtTime(1800, t);
      osc.frequency.exponentialRampToValueAtTime(900, t + 0.03);
      const click = this._source(this.click);
      click.connect(this.bus.fx);
      cleanup(click);
      click.start(t);
    });
  }

  // Kettle-like rise while the planchette dwells, called every frame with p in [0, 1].
  dwell(p) {
    safely(() => {
      if (!this._live()) return;
      const k = this._muted ? 0 : clamp01(p), now = this.ctx.currentTime;
      const freq = lerp(DWELL.from, DWELL.to, k);
      if (k > 0) {
        this.kettleHeard = now;
        if (!this.kettle) this.kettle = this._startKettle(freq);
      }
      if (!this.kettle) return;
      const { osc, band, vibrato, out } = this.kettle;
      if (k > 0) {                       // hold the pitch while fading out, so it never swoops down
        this._smooth(osc.frequency, freq, 0.03);
        this._smooth(band.frequency, freq, 0.03);
        this._smooth(vibrato.gain, DWELL.vibrato * k, 0.1);
      }
      this._hold(out.gain, DWELL.level * smoothstep(k / 0.15), 0.035);
      if (now - this.kettleHeard > IDLE_SECS) { this._retire(this.kettle, now); this.kettle = null; }
    });
  }

  // A soft, friendly low "boop" that sags a little, like a kind "not quite".
  wrongSound() {
    this._play((t) => {
      const osc = this._partial(294, t, 0.38, 0.45, 0.015);
      osc.setPeriodicWave(this.warm);
      osc.frequency.setValueAtTime(294, t);
      osc.frequency.exponentialRampToValueAtTime(196, t + 0.3);
    });
  }

  // The session's letters replayed as a gentle arpeggio, then a soft C major chord.
  goodbyeTune(count) {
    this._play((t) => {
      const n = Math.min(40, Math.max(0, Math.floor(Number(count)) || 0));
      const step = Math.min(0.16, Math.max(0.08, 2.2 / Math.max(1, n)));
      const notes = [];                                  // [time, play(at)], in time order
      for (let i = 0; i < n; i++) notes.push([t + i * step, (at) => this._pluck(letterFreq(i), at, 0.8)]);
      const chord = t + n * step + (n ? 0.25 : 0);
      notes.push([chord, (at) => {
        for (const s of [-12, -5, 4]) this._partial(C5 * semis(s), at, 0.05, 2.6, 0.25);
      }]);
      [0, 4, 7, 12].forEach((s, i) => notes.push([chord + i * 0.03, (at) => this._pluck(C5 * semis(s), at, 0.55)]));
      this._sequence(notes);
    });
  }

  // ---------------------------------------------------------- Hush and friends

  // Hush hums the text, Animal Crossing style. Resolves when the line is done; when it
  // can't be heard (muted, locked, hidden) it still waits the line's length, so dialogue
  // pacing never depends on audio. A new line cuts off the one before it.
  hushVoice(text, options = {}) {
    return safely(() => {
      const question = !!(options && options.question);
      const plan = planVoice(text == null ? "" : String(text), question);
      if (this.voice) this._hush();
      if (!plan.syllables.length) return Promise.resolve();
      if (!this._live() || this._muted) return wait(plan.duration);
      return this._speak(plan);
    }, Promise.resolve());
  }

  // A soft bubble pop for a friend taking seat 0-7, each seat its own note.
  joinPop(seat) {
    this._play((t) => {
      const k = Math.floor(Number(seat));
      if (!Number.isFinite(k)) return;
      const f = SEAT_NOTES[((k % 8) + 8) % 8];
      const osc = this._partial(f, t, 0.26, 0.2, 0.004);
      osc.frequency.setValueAtTime(f * 0.7, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    });
  }

  // ---------------------------------------------------------- internals: setup

  _build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.knee.value = 12;            // narrower than the 30 dB default, so quiet sounds pass untouched
    comp.connect(ctx.destination);
    ctx.onstatechange = () => safely(() => this._onStateChange());
    this.ctx = ctx;
    this.master = this._gain(this._muted ? 0 : 1, comp);
    this.bus = {};
    for (const name in BUS) this.bus[name] = this._gain(BUS[name], this.master);
    this.tone = this._gain(1, this.bus.fx);   // pitched one-shots: dry, plus a touch of room
    this._buildParlour();
    this.creakGain = this._gain(0, this.bus.fx);
    this.creakBand = this._filter("bandpass", CREAK.freq[0], CREAK.q, this.creakGain);
    this.white = whiteBuffer(ctx, 1);
    this.grains = grainBuffers(ctx);
    this.click = clickBuffer(ctx);
    // Sine plus a little 2nd and 3rd harmonic: warm, and still audible on phone speakers.
    this.warm = ctx.createPeriodicWave(new Float32Array(4), new Float32Array([0, 1, 0.35, 0.1]));
  }

  // A whisper of room: two damped feedback delays give pitched sounds a short, soft tail.
  _buildParlour() {
    const wet = this._gain(PARLOUR.wet, this.bus.fx);
    for (const time of PARLOUR.times) {
      const delay = this.ctx.createDelay(0.2);
      delay.delayTime.value = time;
      const damp = this._filter("lowpass", PARLOUR.damp, undefined, wet);
      const feedback = this._gain(PARLOUR.feedback, delay);
      this.tone.connect(delay);
      delay.connect(damp);
      damp.connect(feedback);
    }
  }

  // Older iOS only unlocks Web Audio once a sound starts inside the tap itself.
  _prime() {
    const src = this._source(this.ctx.createBuffer(1, 1, this.ctx.sampleRate));
    src.connect(this.ctx.destination);
    cleanup(src);
    src.start(0);
  }

  // iOS treats Web Audio like a ringtone, so the silent switch mutes it. Newer Safari can
  // ask for a "playback" audio session instead, which plays like video.
  _preferPlaybackSession() {
    const session = navigator.audioSession;
    if (session && session.type !== "playback") session.type = "playback";
  }

  // Older iOS has no audio session API: a looping silent <audio>, started from a tap, moves
  // the page into the playback category so the silent switch no longer mutes the game.
  _playSilentLoop() {
    if (navigator.audioSession || !IS_IOS) return;
    if (!this.silentEl) {
      const el = document.createElement("audio");
      el.src = silentWavURI(this.ctx.sampleRate);
      el.loop = true;
      el.preload = "auto";
      el.setAttribute("playsinline", "");
      el.setAttribute("x-webkit-airplay", "deny");
      el.disableRemotePlayback = true;
      this.silentEl = el;
    }
    if (this.silentEl.paused) quietly(this.silentEl.play());
  }

  // Wake a sleeping context; resolves true once it runs. An interrupted iOS context can
  // leave resume() pending forever, so stop waiting after a moment and let the next tap
  // anywhere on the page try again.
  _resume() {
    const ctx = this.ctx;
    if (ctx.state === "running") return Promise.resolve(true);
    this.wakeUntil = performance.now() + WAKE_MS;
    const resumed = safely(() => Promise.resolve(ctx.resume()), Promise.resolve());
    return Promise.race([resumed, wait(WAKE_MS / 1000)]).then(noop, noop).then(() => {
      const running = ctx.state === "running";
      if (!running && !document.hidden) safely(() => this._wakeOnNextTap());
      return running;
    });
  }

  // iOS only lets a tap bring audio back after a call, Siri or another app's sound, and the
  // game may only ever call unlock() once. So the next tap anywhere calls it again.
  _wakeOnNextTap() {
    if (this.tapWake) return;
    const opts = { capture: true, passive: true };
    const wake = () => {
      for (const type of TAP_EVENTS) document.removeEventListener(type, wake, opts);
      this.tapWake = null;
      this.unlock();
    };
    for (const type of TAP_EVENTS) document.addEventListener(type, wake, opts);
    this.tapWake = wake;
  }

  // The context fell asleep on its own (iOS "interrupted", or a browser autoplay rule)
  // while the page is in view: arm the tap wake. Our own hidden-tab suspend is left alone.
  _onStateChange() {
    if (this.ctx.state !== "running" && !document.hidden) this._wakeOnNextTap();
  }

  // Hidden tabs go quiet (and stop costing battery); they wake again when shown.
  _onVisibility() {
    if (!this.ctx) return;
    if (document.hidden) {
      quietly(this.ctx.suspend());
      if (this.silentEl) this.silentEl.pause();
      return;
    }
    this._resume();
    if (this.silentEl) quietly(this.silentEl.play());
  }

  // True when a sound made now will be heard now: running, or just asked to resume. This
  // keeps sounds from piling up in a suspended context and bursting out all at once later.
  _live() {
    return !!this.ctx && (this.ctx.state === "running" || performance.now() < this.wakeUntil);
  }

  // ---------------------------------------------------------- internals: node helpers

  _gain(value, dest) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
  }

  // Filter frequencies here move slowly, so k-rate is plenty, and it spares Chrome from
  // recomputing the filter coefficients for every sample while one is moving (a real cost
  // on a cheap phone). Browsers without automationRate simply ignore it.
  _filter(type, freq, q, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    try { f.frequency.automationRate = "k-rate"; } catch {}
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  _osc(freq, type = "sine") {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  _source(buffer, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    return s;
  }

  // True when a per-frame target is close enough to the last one sent not to resend it.
  _unchanged(param, value) {
    const last = this.targets.get(param);
    return !!last && Math.abs(last.value - value) < 1e-4 + Math.abs(value) * 0.003;
  }

  // Ease a per-frame parameter toward `value`, skipping repeats so the automation timeline
  // doesn't fill up with identical events sixty times a second.
  _smooth(param, value, tc) {
    if (this._unchanged(param, value)) return;
    this.targets.set(param, { value, renewAt: Infinity });
    param.setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  // Like _smooth, for a per-frame loudness, with a dead man's switch: it fades out by itself
  // unless renewed, so a hiss or whistle can't get stuck on if the game stops calling.
  _hold(param, value, tc) {
    const now = this.ctx.currentTime;
    if (this._unchanged(param, value) && (value === 0 || now < this.targets.get(param).renewAt)) return;
    param.cancelScheduledValues(now);              // drops only the pending let-go
    param.setTargetAtTime(value, now, tc);
    if (value > 0) param.setTargetAtTime(0, now + LET_GO_SECS, 0.08);
    this.targets.set(param, { value, renewAt: now + LET_GO_SECS / 2 });
  }

  // Stop a looping sound's sources and disconnect all its nodes once they have stopped.
  _retire(loop, at) {
    loop.sources[0].onended = () => loop.nodes.forEach((n) => n.disconnect());
    for (const s of loop.sources) stopAt(s, at);
  }

  // Run a one-shot just ahead of now, only when it can be heard (no work while muted).
  _play(fn) {
    safely(() => {
      if (this._live() && !this._muted) fn(this.ctx.currentTime + 0.01);
    });
  }

  // Play timed notes ([time, play(at)] pairs, in time order) a few at a time instead of
  // building every node up front, so a long tune never stalls a frame or keeps dozens of
  // voices alive. Muting, hiding the tab or an interruption ends the tune.
  _sequence(notes) {
    let i = 0;
    const pump = () => safely(() => {
      if (this._muted || !this._live()) return;
      const now = this.ctx.currentTime;
      for (; i < notes.length && notes[i][0] < now + SEQ.ahead; i++) notes[i][1](Math.max(notes[i][0], now));
      if (i < notes.length) setTimeout(pump, SEQ.everyMs);
    });
    pump();
  }

  // ---------------------------------------------------------- internals: voices

  // One decaying sine (into the tone bus unless told otherwise), cleaned up when it ends.
  _partial(freq, t, peak, decay, attack, dest = this.tone) {
    const osc = this._osc(freq), env = this._gain(0, dest);
    strike(env.gain, t, peak, decay, attack);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + decay + 0.02);
    cleanup(osc, env);
    return osc;
  }

  // Kalimba tine: a sine body over 0.9 s, plus a bright x6.27 partial gone in 0.15 s.
  _pluck(freq, t, level = 1) {
    const peak = PLUCK * level * Math.pow(C5 / freq, 0.25);   // high notes sound louder; ease them back
    this._partial(freq, t, peak, 0.9, 0.004);
    this._partial(freq * 6.27, t, peak * 0.15, 0.15, 0.002);
  }

  _grain(t) {
    const src = this._source(this.grains[Math.floor(Math.random() * this.grains.length)]);
    src.connect(this.creakBand);
    cleanup(src);
    src.start(t);
  }

  // Start or fade out the room tone so it matches what was asked for (and the mute state).
  _syncRoom() {
    if (!this.ctx) return;
    const want = this.wantAmbience && !this._muted, now = this.ctx.currentTime;
    if (want && !this.room) {
      this.room = this._startRoom();
      fadeTo(this.room.fade.gain, 1, now, ROOM.fade);
    } else if (!want && this.room) {
      fadeTo(this.room.fade.gain, 0, now, ROOM.fade);
      this._retire(this.room, now + ROOM.fade + 0.05);
      this.room = null;
    }
  }

  // Warm pink noise under a slowly swaying lowpass, and a mantel clock ticking far away.
  _startRoom() {
    if (!this.pink) {
      this.pink = pinkLoopBuffer(this.ctx, 2);
      this.ticks = tickBuffer(this.ctx);
    }
    const fade = this._gain(0, this.bus.ambience);
    const level = this._gain(ROOM.level, fade);
    const lowpass = this._filter("lowpass", ROOM.cutoff, undefined, level);
    const hum = this._source(this.pink, true);
    hum.connect(lowpass);
    const sway = this._osc(ROOM.swayHz), depth = this._gain(ROOM.sway, lowpass.frequency);
    sway.connect(depth);
    const clock = this._gain(ROOM.tick, fade);
    const tick = this._source(this.ticks, true);
    tick.connect(clock);
    const t = this.ctx.currentTime;
    hum.start(t);
    sway.start(t);
    tick.start(t);
    return { fade, sources: [hum, sway, tick], nodes: [hum, lowpass, level, sway, depth, tick, clock, fade] };
  }

  _startGlide() {
    const out = this._gain(0, this.bus.fx);
    const band = this._filter("bandpass", GLIDE.freq, GLIDE.q, out);
    const felt = this._source(this.white, true);
    felt.connect(band);
    felt.start(0, Math.random() * 0.9);              // random offset: never in step with other noise
    return { out, sources: [felt], nodes: [felt, band, out] };
  }

  // A sine with a slow wobble, plus a breath of band-passed air tracking its pitch.
  _startKettle(freq) {
    const out = this._gain(0, this.bus.fx);
    const osc = this._osc(freq);
    osc.connect(out);
    const lfo = this._osc(5.5), vibrato = this._gain(0, osc.frequency);
    lfo.connect(vibrato);
    const air = this._gain(DWELL.air, out);
    const band = this._filter("bandpass", freq, 10, air);
    const hiss = this._source(this.white, true);
    hiss.connect(band);
    osc.start();
    lfo.start();
    hiss.start(0, Math.random() * 0.9);
    return {
      osc, band, vibrato, out,
      sources: [osc, lfo, hiss], nodes: [osc, lfo, vibrato, air, band, hiss, out],
    };
  }

  // One line of humming: a triangle through two moving formant filters, a syllable
  // envelope, and a faint breath. Everything is scheduled up front from the plan.
  _speak(plan) {
    const t0 = this.ctx.currentTime + 0.03, first = plan.syllables[0];
    const out = this._gain(0, this.bus.voice);
    const low = this._filter("bandpass", FORMANTS[first.vowel][0], VOICE.q1, out);
    const highLevel = this._gain(VOICE.f2, out);
    const high = this._filter("bandpass", FORMANTS[first.vowel][1], VOICE.q2, highLevel);
    const dry = this._gain(VOICE.dry, out);
    const hum = this._osc(first.f, "triangle");
    hum.connect(low);
    hum.connect(high);
    hum.connect(dry);
    const breath = this._gain(0, this.bus.voice);
    const breathBand = this._filter("bandpass", VOICE.breathHz, 0.7, breath);
    const air = this._source(this.white, true);
    air.connect(breathBand);

    for (const s of plan.syllables) {
      const t = t0 + s.t, [f1, f2] = FORMANTS[s.vowel];
      const release = t + s.d * (s.bend ? 0.8 : 0.62);
      hum.frequency.setTargetAtTime(s.f, t, 0.012);
      if (s.bend) hum.frequency.setTargetAtTime(s.f * s.bend, t + s.d * 0.2, s.d * 0.18);
      low.frequency.setTargetAtTime(f1, t, 0.02);
      high.frequency.setTargetAtTime(f2, t, 0.02);
      out.gain.setTargetAtTime(Math.min(3, VOICE.level / formantLevel(s.f, f1, f2)), t, 0.012);
      out.gain.setTargetAtTime(0, release, 0.022);
      breath.gain.setTargetAtTime(VOICE.breath, t, 0.02);
      breath.gain.setTargetAtTime(0, release, 0.03);
    }
    const end = t0 + plan.duration;
    hum.start(t0);
    air.start(t0, Math.random() * 0.9);
    stopAt(hum, end);
    stopAt(air, end);

    return new Promise((resolve) => {
      const voice = { gains: [out.gain, breath.gain], sources: [hum, air], resolve };
      this.voice = voice;
      hum.onended = () => {
        for (const n of [hum, low, high, highLevel, dry, out, air, breathBand, breath]) n.disconnect();
        if (this.voice === voice) this.voice = null;
        resolve();
      };
      // onended waits while the tab is hidden; the timer keeps the game's pacing honest.
      setTimeout(resolve, (plan.duration + 0.4) * 1000);
    });
  }

  // Cut off the line Hush is speaking with a quick fade, and let its caller move on.
  _hush() {
    const v = this.voice, now = this.ctx.currentTime;
    this.voice = null;
    for (const g of v.gains) fadeTo(g, 0, now, 0.04);
    for (const s of v.sources) stopAt(s, now + 0.05);
    v.resolve();
  }
}
