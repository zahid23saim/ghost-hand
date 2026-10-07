// Every tunable (spec §3.10). Values marked LAB are live sliders in the feel lab.
// Bump CONFIG_VERSION whenever a default changes, so playtest notes can cite it.

export const CONFIG_VERSION = 2; // 2: capture bonus scales with table size; gust tunables

export const DEFAULTS = {
  // Force
  knowerWeight: 1.5,   // LAB
  effSat: 0.6,         // LAB  push magnitude at full effectiveness
  alignFull: 30,       // LAB  degrees: fully counted inside this angle
  alignZero: 60,       // LAB  ...fading to nothing by here
  opposeStart: 120,    // LAB  opposition starts here...
  opposeFull: 150,     // LAB  ...and is total from here
  minDir: 0.25,        //      below this combined push there is no direction
  crew: 0.85,          // LAB  threshold factor
  keep: 0.92,          // LAB  easier to keep moving than to start
  thresholdScale: 1.0, // LAB  First Cup uses 0.95
  botCap: 1.5,         // LAB  bots amplify humans, never replace them
  captureBonus: 1.0,   // LAB  harder to pull away from a captured letter
  tLobby: 1.7,         // LAB  lobby toy threshold

  // Motion
  vMax: 240,           // LAB  bu/s
  vFloor: 0.55,        // LAB  fraction of vMax right at breakaway
  excessSpan: 0.35,    // LAB
  tauUp: 0.20,         // LAB  s
  tauStop: 0.12,       // LAB  s
  stickSpeed: 8,       //      bu/s
  stickMs: 150,

  // Letters
  approachR: 140,      // LAB  bu
  approachMin: 80,     // LAB  bu/s
  captureR: 45,        // LAB  bu
  capK: 30,            // LAB  /s^2
  capC: 11,            // LAB  /s
  inkR: 30,            // LAB  bu
  inkSpeed: 40,        // LAB  bu/s
  dwell: 0.6,          // LAB  s
  drain: 2,
  wobbleTime: 1.0,     // LAB  s
  sameLetterMs: 800,
  specialCaptureR: 60, //      YES / NO / GOODBYE

  // Pacing
  budgetTable: 12,     // LAB  hand letters per seance
  budgetSolo: 10,      // LAB
  quotaFrac: 0.6,      // LAB
  hint1: 8,            // LAB  s
  hint2: 15,           // LAB  s
  hint3: 24,           // LAB  s (Hush blows)
  swiftStar: 4.0,      // LAB  s per hand letter
  blowSpeed: 120,      //      bu/s

  // Twists (Last Biscuit)
  gustSpeed: 90,       //      bu/s sideways nudge added to the target velocity
  gustMs: 600,         //      how long one gust blows
  gustQuietMs: 2000,   //      no gust in the first 2 s of a word
  gustClearR: 160,     //      bu: no gust this close to the target (never into ink)

  // Feedback (client)
  stirMin: 0.35,       // LAB

  // Lifted hands (server)
  silenceMs: 400,      // LAB
  silenceHoldMs: 600,  // LAB
  silenceFadeMs: 400,  // LAB
  dozeMs: 20000,       // LAB
  standInMs: 10000,    // LAB
  seatHoldMs: 60000,
};

export const LAB_KEYS = [
  "knowerWeight", "effSat", "alignFull", "alignZero", "opposeStart", "opposeFull", "crew", "keep",
  "thresholdScale", "botCap", "captureBonus", "tLobby", "vMax", "vFloor", "excessSpan", "tauUp", "tauStop",
  "approachR", "approachMin", "captureR", "capK", "capC", "inkR", "inkSpeed", "dwell", "wobbleTime",
  "budgetTable", "budgetSolo", "quotaFrac", "hint1", "hint2", "hint3", "swiftStar", "stirMin",
  "silenceMs", "silenceHoldMs", "silenceFadeMs", "dozeMs", "standInMs",
];

export const PRESETS = {
  feather: { vMax: 300, crew: 0.8 },
  default: {},
  oak: { vMax: 200, crew: 0.9 },
};

export function makeConfig(overrides = {}) {
  return { version: CONFIG_VERSION, ...DEFAULTS, ...overrides };
}

// Threshold for the table (spec §3.3). nHumans counts seated humans ok|silent.
export function tStart(cfg, nHumans) {
  const nEff = Math.max(2, nHumans);
  return cfg.crew * (cfg.knowerWeight + Math.ceil((nEff - 1) / 2)) * cfg.thresholdScale;
}
