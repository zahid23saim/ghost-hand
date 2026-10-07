// Ghost Hand - Hush's wardrobe: little things Hush finds as you play (spec 6.5, 8.8).
// Cosmetic only. Progress lives in this browser ("gh.progress"); nothing in the game is
// gated by it, and everything still works when storage is blocked (it is kept in memory).
//
//   import * as wardrobe from "./wardrobe.js";
//   wardrobe.applyTo([hush, hushBig, pickHush, revealHush]);   // dress every game Hush
//   const fresh = wardrobe.recordSeance(reveal, { you: you?.seat });
//   if (fresh.length) wardrobe.celebrate(fresh[0], { hushFactory: createHush });
//   wardrobe.openPicker({ hushFactory: createHush, onChange: () => wardrobe.applyTo() });

import { get, subscribe } from "./settings.js";

const KEY = "gh.progress";
const CELEBRATE_MS = 3500;   // how long the "Hush found ..." card stays up
const TRIED_MS = 1400;       // the card lingers this long after "Try it on"
const PREVIEW_PX = 150;      // the wardrobe mirror's Hush
const CARD_HUSH_PX = 64;     // the celebration card's Hush

// Unlock ladder. Spec 6.5: the scarf after 3 seances, the flower crown after the first
// 3-star seance. The top hat and monocle (already drawn in hush.js) continue the ladder.
export const ITEMS = Object.freeze([
  { id: "scarf", label: "Scarf", noun: "a scarf", need: { seances: 3 } },
  { id: "flower", label: "Flower crown", noun: "a flower crown", need: { threeStar: 1 } },
  { id: "tophat", label: "Top hat", noun: "a top hat", need: { seances: 6 } },
  { id: "monocle", label: "Monocle", noun: "a monocle", need: { seances: 10 } },
].map((it) => Object.freeze({ ...it, need: Object.freeze(it.need) })));

const IDS = ITEMS.map((it) => it.id);
// Reduce motion: the in-app setting (settings.js), the device setting, or #app.reduce-motion.
// Overlays live outside #app, so the choice also goes on <html> as .gh-reduce for the CSS.
const osReduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const reduced = () => !!get("reducedMotion") || osReduced() || !!document.getElementById("app")?.classList.contains("reduce-motion");
function syncReduce() { try { document.documentElement.classList.toggle("gh-reduce", reduced()); } catch {} }
subscribe((_, key) => { if (key === "reducedMotion") queueMicrotask(syncReduce); });

// ------------------------------------------------------------ storage

let memory = null;           // last known progress, used when localStorage is unavailable

const count = (x) => (Number.isFinite(+x) && +x > 0 ? Math.floor(+x) : 0);

function blank() {
  return { v: 1, seances: 0, letters: 0, foresight: 0, words: 0, threeStar: 0, bestStars: 0, acc: {}, wear: null, last: "" };
}

function normalise(d) {
  const p = blank();
  if (!d || typeof d !== "object") return p;
  for (const k of ["seances", "letters", "foresight", "words", "threeStar", "bestStars"]) p[k] = count(d[k]);
  p.bestStars = Math.min(3, p.bestStars);
  if (d.acc && typeof d.acc === "object") for (const id of IDS) if (d.acc[id] === true) p.acc[id] = true;
  p.wear = IDS.includes(d.wear) ? d.wear : null;
  p.last = typeof d.last === "string" ? d.last.slice(0, 400) : "";
  return p;
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch {}
  if (raw) {
    try { return normalise(JSON.parse(raw)); } catch {}
  }
  return normalise(memory);
}

function save(p) {
  memory = p;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}

// ------------------------------------------------------------ rules

function meets(p, it) {
  if (it.need.seances) return p.seances >= it.need.seances;
  if (it.need.threeStar) return p.threeStar >= it.need.threeStar;
  return false;
}

// Once found, an item stays found even if the ladder changes later.
const unlockedIds = (p) => ITEMS.filter((it) => p.acc[it.id] || meets(p, it)).map((it) => it.id);
const wearingOf = (p) => (p.wear && unlockedIds(p).includes(p.wear) ? p.wear : null);
const itemOf = (id) => ITEMS.find((it) => it.id === id) || null;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function left(p, it) {
  return it.need.seances ? Math.max(1, it.need.seances - p.seances) : 0;
}
function lockShort(p, it) {
  return it.need.seances ? `Play ${left(p, it)} more` : "Earn 3 stars";
}
function lockLong(p, it) {
  return it.need.seances
    ? `Play ${plural(left(p, it), "more seance")} and Hush will find it.`
    : "Earn all 3 stars in one seance and Hush will find it.";
}
function lockProgress(p, it) {
  return it.need.seances ? Math.min(1, p.seances / it.need.seances) : Math.min(1, p.bestStars / 3);
}
function reason(it) {
  return it.need.seances ? `For playing ${plural(it.need.seances, "seance")}` : "For a seance with all 3 stars";
}

// Same reveal twice (a resent event, a re-render) must only count once.
function revealKey(rev) {
  if (!rev.ask && !rev.frameText) return "";
  const path = Array.isArray(rev.path) ? rev.path.length : 0;
  return [rev.ask || "", rev.frameText || "", rev.secs ?? "", rev.seance || "", path].join("|").slice(0, 400);
}

// ------------------------------------------------------------ public API: progress

/** Everything this device has played, plus what Hush has found and is wearing. */
export function getProgress() {
  const p = load();
  return {
    seances: p.seances, letters: p.letters, foresight: p.foresight,
    words: p.words, threeStar: p.threeStar, bestStars: p.bestStars,
    unlocked: unlockedIds(p), wearing: wearingOf(p),
  };
}

/**
 * Counts one finished seance from its reveal event. Returns the ids found just now
 * (usually [] - at most a couple), in ladder order. A repeat of the last reveal is ignored.
 */
export function recordSeance(rev, { you } = {}) {
  if (!rev || typeof rev !== "object" || (!rev.frameText && !Array.isArray(rev.words))) return [];
  const p = load();
  const key = revealKey(rev);
  if (key && key === p.last) return [];
  const before = new Set(unlockedIds(p));
  const seat = you && typeof you === "object" ? you.seat : you;
  const words = Array.isArray(rev.words) ? rev.words : [];
  const stars = rev.stars && typeof rev.stars === "object" ? rev.stars : {};
  const got = ["swift", "steady", "sure"].filter((k) => stars[k]).length;

  p.seances += 1;
  p.foresight += count(rev.fs);
  p.letters += words.reduce((n, w) => n + String(w?.w || "").replace(/[^A-Za-z]/g, "").length, 0);
  if (seat != null) p.words += words.filter((w) => w && w.seat === seat).length;
  p.bestStars = Math.max(p.bestStars, got);
  if (got === 3) p.threeStar += 1;
  p.last = key;

  const fresh = [];
  for (const it of ITEMS) {
    if (meets(p, it)) p.acc[it.id] = true;
    if (p.acc[it.id] && !before.has(it.id)) fresh.push(it.id);
  }
  save(p);
  return fresh;
}

// ------------------------------------------------------------ public API: wearing

let targets = [];            // the game's Hush instances, from the last applyTo(list)

/** What Hush wears on this device: an item id, or null. */
export function wearing() {
  return wearingOf(load());
}

/** Puts an item on (or null to take it off). Only found items can be worn. Returns what Hush now wears. */
export function setWearing(name) {
  const p = load();
  const id = name == null || name === "" ? null : String(name);
  if (id !== null && !unlockedIds(p).includes(id)) return wearingOf(p);
  if (p.wear !== id) { p.wear = id; save(p); }
  applyTo();
  try { dispatchEvent(new CustomEvent("gh:wardrobe", { detail: { wearing: id } })); } catch {}
  return id;
}

/**
 * Dresses Hush instances in the current item. A list (nulls allowed) is remembered, so
 * later setWearing() calls re-dress the same Hushes; with no argument it re-applies.
 */
export function applyTo(hushes) {
  if (Array.isArray(hushes)) targets = hushes.filter((h) => h && typeof h.setAccessory === "function");
  else if (hushes && typeof hushes.setAccessory === "function") targets = [hushes];
  const w = wearing();
  for (const h of targets) { try { h.setAccessory(w); } catch {} }
  return w;
}

// Another tab changed the wardrobe: follow it.
try { addEventListener("storage", (e) => { if (e.key === KEY) applyTo(); }); } catch {}

// ------------------------------------------------------------ icons (48 x 48)

const C = {
  candle: "#FFD36E", pine: "#D9A066", pineDark: "#B7794A", cheek: "#F7B7C3", leaf: "#9FD8CE",
  lilac: "#C9B6E4", ink: "#3B2F5C", aura: "#B8E6E1", cream: "#F3E9D2", white: "#FFFFFF",
};
const PETALS = [0, 72, 144, 216, 288].map((a) => [3 * Math.sin((a * Math.PI) / 180), -3 * Math.cos((a * Math.PI) / 180)]);

function bloom(x, y, petal, heart, s = 1) {
  const petals = PETALS.map(([px, py]) => `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="2.5"/>`).join("");
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${petal}">${petals}<circle r="1.9" fill="${heart}"/></g>`;
}

const ICONS = {
  scarf: `<path d="M12 27L20.5 29.6L19 43Q15 44.4 11 43Z" fill="${C.candle}"/>
<path d="M11.6 35L19.9 36L19.7 37.9L11.4 37.1ZM11.3 39.2L19.5 40.1L19.3 41.7L11.2 41Z" fill="${C.pine}"/>
<g fill="${C.candle}"><circle cx="12.3" cy="44.3" r="1.5"/><circle cx="15.1" cy="44.9" r="1.5"/><circle cx="17.9" cy="44.3" r="1.5"/></g>
<path d="M5 17Q24 25 43 17Q44.6 21.5 43 26Q24 34 5 26Q3.4 21.5 5 17Z" fill="${C.candle}"/>
<path d="M4.4 21Q24 29 43.6 21L43.7 22.9Q24 30.9 4.3 22.9Z" fill="${C.pine}" opacity=".75"/>`,

  flower: `<path d="M5 33Q24 11 43 33" fill="none" stroke="${C.leaf}" stroke-width="2" stroke-linecap="round"/>
<g fill="${C.leaf}"><ellipse rx="3.4" ry="1.6" transform="translate(12.4 25.4) rotate(-36)"/><ellipse rx="3.4" ry="1.6" transform="translate(20 20.6) rotate(-14)"/>
<ellipse rx="3.4" ry="1.6" transform="translate(28 20.6) rotate(14)"/><ellipse rx="3.4" ry="1.6" transform="translate(35.6 25.4) rotate(36)"/></g>
${bloom(8.6, 29.4, C.cheek, C.candle, 0.9)}${bloom(16.3, 23.8, C.candle, C.pine)}${bloom(24, 21.6, C.cheek, C.candle, 1.18)}${bloom(31.7, 23.8, C.lilac, C.candle)}${bloom(39.4, 29.4, C.cheek, C.candle, 0.9)}`,

  tophat: `<g transform="rotate(-8 24 26)" stroke="${C.cream}" stroke-opacity=".6" stroke-width="1.1" stroke-linejoin="round">
<path d="M14.5 35L13.4 11.6Q13.3 9.6 15.3 9.6H32.7Q34.7 9.6 34.6 11.6L33.5 35Z" fill="${C.ink}"/>
<path d="M14.1 28.2L13.85 22.6H34.15L33.9 28.2Z" fill="${C.cheek}" stroke="none"/>
<path d="M17.6 21.6L17 12.4H19.4L19.9 21.6Z" fill="${C.white}" opacity=".2" stroke="none"/>
<ellipse cx="24" cy="35.4" rx="17.5" ry="4.3" fill="${C.ink}"/></g>`,

  monocle: `<circle cx="20" cy="20" r="10" fill="${C.aura}" opacity=".28"/>
<path d="M7.6 20a12.4 12.4 0 1 0 24.8 0a12.4 12.4 0 1 0 -24.8 0ZM10 20a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z" fill="${C.pine}" fill-rule="evenodd"/>
<circle cx="20" cy="20" r="10" fill="none" stroke="${C.pineDark}" stroke-width=".9"/>
<path d="M13.4 15.2Q15.8 11.4 20.4 11.1Q17.2 13.4 15.4 16.5Z" fill="${C.white}" opacity=".85"/>
<g fill="${C.pine}"><circle cx="30.4" cy="29.6" r="1.25"/><circle cx="32.9" cy="33.3" r="1.25"/><circle cx="35" cy="37.1" r="1.25"/><circle cx="36.6" cy="41" r="1.25"/><circle cx="37.7" cy="44.9" r="1.25"/></g>`,
};

const icon = (id) => `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">${ICONS[id] || ""}</svg>`;
const LOCK = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><path d="M5 7.2V5.4a3 3 0 0 1 6 0v1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="3" y="7" width="10" height="7.6" rx="2" fill="currentColor"/></svg>`;
const CHECK = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3.2 8.4l3 3 6.6-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CROSS = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const SPARK = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0.5L9.6 6.4L15.5 8L9.6 9.6L8 15.5L6.4 9.6L0.5 8L6.4 6.4Z" fill="currentColor"/></svg>`;

// ------------------------------------------------------------ styles

const CSS = `
.ghw-scrim { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center;
  padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
  background: rgba(8,7,20,0.68); animation: ghw-fade 200ms ease-out; touch-action: pan-y; overscroll-behavior: contain; }
.ghw-scrim.ghw-out { opacity: 0; transition: opacity 160ms ease-in; }
.ghw-card { position: relative; width: min(640px, 100%); max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); overflow-y: auto;
  padding: 18px 20px 20px; border-radius: 22px; background: var(--card, #221E45); border: 1px solid rgba(201,162,74,0.55);
  box-shadow: 0 12px 44px rgba(0,0,0,0.45); color: var(--cream, #F3E9D2); text-align: center;
  font: 700 15px/1.35 var(--ui, system-ui, sans-serif); animation: ghw-pop 280ms cubic-bezier(.2,1.3,.4,1); }
.ghw-x { position: absolute; top: 10px; right: 10px; width: 40px; height: 40px; padding: 0; display: grid; place-items: center;
  border-radius: 50%; border: 1px solid var(--line-strong, rgba(243,233,210,0.28)); background: var(--card-2, #2A2552);
  color: var(--cream, #F3E9D2); cursor: pointer; transition: background 160ms; }
.ghw-x:hover { background: var(--violet, #3A3270); }
.ghw-scrim button:focus-visible, .ghw-cele button:focus-visible { outline: 3px solid var(--mint, #5EF2D0); outline-offset: 3px; }
.ghw-mirror { position: relative; width: 186px; height: 194px; margin: 4px auto 8px; display: flex; align-items: center; justify-content: center;
  border-radius: 93px 93px 24px 24px; border: 2px solid var(--gold-deep, #C9A24A);
  background: radial-gradient(circle at 50% 44%, rgba(94,242,208,0.22), rgba(94,242,208,0) 62%), linear-gradient(180deg, #2E2860, var(--night-2, #1B1838));
  box-shadow: inset 0 0 0 5px rgba(20,18,43,0.55), inset 0 0 0 6px rgba(201,162,74,0.3), 0 6px 0 rgba(0,0,0,0.3); }
.ghw-mirror::before { content: ""; position: absolute; left: 22px; top: 30px; width: 16px; height: 70px; border-radius: 8px;
  background: linear-gradient(180deg, rgba(243,233,210,0.14), rgba(243,233,210,0)); transform: rotate(18deg); pointer-events: none; }
.ghw-mirror .hush { margin-top: 10px; }
.ghw-title { margin: 0; font: 700 28px/1.1 var(--display, Georgia, serif); font-variation-settings: "SOFT" 100; color: var(--cream, #F3E9D2); }
.ghw-sub { margin: 4px 0 0; font: 700 14px/1.35 var(--ui, sans-serif); color: var(--muted, #A9A3C9); }
.ghw-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 16px 0 6px; }
.ghw-tile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 6px;
  min-height: 150px; padding: 14px 6px 12px; border-radius: 18px; border: 1px solid var(--line-strong, rgba(243,233,210,0.28));
  background: var(--card-2, #2A2552); color: var(--cream, #F3E9D2); font: 800 15px/1.2 var(--ui, sans-serif); cursor: pointer;
  box-shadow: 0 4px 0 rgba(0,0,0,0.35); transition: transform 140ms, border-color 160ms, background 160ms; -webkit-tap-highlight-color: transparent; }
.ghw-tile:hover { transform: translateY(-2px); border-color: rgba(255,201,77,0.6); }
.ghw-tile:active { transform: translateY(2px); box-shadow: 0 1px 0 rgba(0,0,0,0.35); }
.ghw-tile.ghw-on { border-color: var(--gold, #FFC94D); background: linear-gradient(180deg, rgba(255,201,77,0.18), rgba(255,201,77,0.03)), var(--card-2, #2A2552);
  box-shadow: 0 4px 0 rgba(0,0,0,0.35), inset 0 0 0 1px var(--gold, #FFC94D); }
.ghw-tile.ghw-locked { background: var(--night-2, #1B1838); border-style: dashed; color: var(--muted, #A9A3C9); cursor: default; box-shadow: none; }
.ghw-tile.ghw-locked:hover, .ghw-tile.ghw-locked:active { transform: none; border-color: var(--line-strong, rgba(243,233,210,0.28)); }
.ghw-shelf { position: relative; width: 66px; height: 66px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%;
  background: radial-gradient(circle at 50% 38%, #342D6B, var(--night-2, #1B1838)); border: 1px solid rgba(201,162,74,0.45); }
.ghw-shelf > svg { width: 50px; height: 50px; display: block; }
.ghw-locked .ghw-shelf { background: var(--night, #14122B); border-color: var(--line, rgba(243,233,210,0.14)); }
.ghw-locked .ghw-shelf > svg { opacity: 0.26; }
.ghw-lock { position: absolute; right: -3px; bottom: -3px; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%;
  background: var(--card, #221E45); border: 1px solid var(--line-strong, rgba(243,233,210,0.28)); color: var(--gold-deep, #C9A24A); }
.ghw-lock svg { width: 13px; height: 13px; display: block; }
.ghw-name { margin-top: 2px; }
.ghw-state { display: inline-flex; align-items: center; gap: 4px; min-height: 22px; padding: 2px 9px; border-radius: 999px;
  font: 800 12.5px var(--ui, sans-serif); color: var(--mint, #5EF2D0); white-space: nowrap; }
.ghw-on .ghw-state { background: var(--gold, #FFC94D); color: var(--ink-on-gold, #14122B); }
.ghw-locked .ghw-state { color: var(--muted, #A9A3C9); padding: 2px 4px; }
.ghw-bar { width: 64%; height: 4px; border-radius: 2px; background: var(--line, rgba(243,233,210,0.14)); overflow: hidden; }
.ghw-bar i { display: block; height: 100%; border-radius: 2px; background: var(--mint, #5EF2D0); opacity: 0.8; }
.ghw-wiggle { animation: ghw-wiggle 420ms ease-in-out; }
.ghw-count { margin: 12px 0 0; font: 700 18px/1.2 var(--display, Georgia, serif); font-variation-settings: "SOFT" 100; color: var(--cream, #F3E9D2); }
.ghw-count b { color: var(--gold, #FFC94D); font-weight: 800; }
.ghw-stats { margin: 3px 0 0; font: 800 13px var(--ui, sans-serif); color: var(--muted, #A9A3C9); }
.ghw-hint { margin: 8px 0 0; min-height: 1.35em; font: 800 14px/1.35 var(--ui, sans-serif); color: var(--mint, #5EF2D0); }
.ghw-done { margin-top: 10px; min-width: 160px; }
.ghw-cele { position: fixed; z-index: 90; top: calc(env(safe-area-inset-top, 0px) + 58px); left: 50%; width: min(380px, calc(100vw - 32px));
  display: flex; align-items: center; gap: 12px; padding: 10px 46px 12px 10px; border-radius: 20px; overflow: hidden;
  background: var(--card, #221E45); border: 1px solid rgba(255,201,77,0.6); box-shadow: 0 12px 36px rgba(0,0,0,0.45);
  color: var(--cream, #F3E9D2); text-align: left; transform: translateX(-50%); animation: ghw-drop 460ms cubic-bezier(.2,1.3,.4,1) both; }
.ghw-cele.ghw-out { animation: ghw-lift 240ms ease-in forwards; }
.ghw-cele .ghw-x { top: 8px; right: 8px; width: 34px; height: 34px; }
.ghw-cele-hush { position: relative; flex: 0 0 78px; height: 78px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,201,77,0.30), rgba(94,242,208,0.12) 55%, rgba(94,242,208,0) 72%); }
.ghw-spark { position: absolute; width: 12px; height: 12px; color: var(--gold, #FFC94D); opacity: 0; animation: ghw-twinkle 1100ms ease-out both; }
.ghw-spark svg { display: block; width: 100%; height: 100%; }
.ghw-spark:nth-child(2) { color: var(--mint, #5EF2D0); width: 9px; height: 9px; }
.ghw-cele-body { min-width: 0; flex: 1 1 auto; }
.ghw-cele-title { margin: 0; font: 700 19px/1.15 var(--display, Georgia, serif); font-variation-settings: "SOFT" 100; color: var(--gold, #FFC94D); }
.ghw-cele-sub { margin: 2px 0 8px; font: 800 13px/1.3 var(--ui, sans-serif); color: var(--muted, #A9A3C9); }
.ghw-cele-done { margin: 2px 0 0; font: 800 14px var(--ui, sans-serif); color: var(--mint, #5EF2D0); }
.ghw-cele-timer { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--line, rgba(243,233,210,0.14)); }
.ghw-cele-timer i { display: block; height: 100%; background: var(--gold, #FFC94D); transform-origin: left; animation: ghw-timer linear forwards; }
.ghw-cele:hover .ghw-cele-timer i, .ghw-cele:focus-within .ghw-cele-timer i { animation-play-state: paused; }
@keyframes ghw-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ghw-pop { from { opacity: 0; transform: translateY(10px) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes ghw-drop { from { opacity: 0; transform: translate(-50%, -18px) scale(0.94); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes ghw-lift { to { opacity: 0; transform: translate(-50%, -12px); } }
@keyframes ghw-wiggle { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-3deg); } 75% { transform: rotate(3deg); } }
@keyframes ghw-twinkle { 0% { opacity: 0; transform: scale(0.2) rotate(0deg); } 35% { opacity: 1; transform: scale(1.1) rotate(25deg); } 100% { opacity: 0; transform: scale(0.6) rotate(60deg); } }
@keyframes ghw-timer { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@media (max-width: 560px) {
  .ghw-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ghw-tile { min-height: 138px; }
  .ghw-card { padding: 16px 14px 18px; }
}
@media (max-height: 640px) {
  .ghw-mirror { width: 150px; height: 156px; border-radius: 75px 75px 20px 20px; }
  .ghw-tile { min-height: 124px; padding-top: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .ghw-scrim, .ghw-card, .ghw-wiggle { animation: none; }
  .ghw-cele, .ghw-cele.ghw-out { animation-name: ghw-fade; animation-duration: 200ms; transform: translateX(-50%); }
  .ghw-cele.ghw-out { animation: none; opacity: 0; transition: opacity 200ms; }
  .ghw-tile, .ghw-tile:hover, .ghw-tile:active { transition: none; transform: none; }
  .ghw-spark { animation: none; opacity: 0.85; }
  .ghw-cele-timer { display: none; }
}
html.gh-reduce .ghw-scrim, html.gh-reduce .ghw-card, html.gh-reduce .ghw-wiggle { animation: none; }
html.gh-reduce .ghw-cele, html.gh-reduce .ghw-cele.ghw-out { animation-name: ghw-fade; animation-duration: 200ms; transform: translateX(-50%); }
html.gh-reduce .ghw-cele.ghw-out { animation: none; opacity: 0; transition: opacity 200ms; }
html.gh-reduce .ghw-tile, html.gh-reduce .ghw-tile:hover, html.gh-reduce .ghw-tile:active { transition: none; transform: none; }
html.gh-reduce .ghw-spark { animation: none; opacity: 0.85; }
html.gh-reduce .ghw-cele-timer { display: none; }
`;

function injectCss() {
  syncReduce();
  if (document.getElementById("gh-wardrobe")) return;
  const s = document.createElement("style");
  s.id = "gh-wardrobe";
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ------------------------------------------------------------ helpers

// Builds a preview Hush with the given factory, or loads hush.js when none was passed.
function makeHush(factory, container, opts, then) {
  const go = (fn) => {
    if (typeof fn !== "function" || !container.isConnected) return;
    try { then(fn(container, opts)); } catch {}
  };
  if (typeof factory === "function") go(factory);
  else import("./hush.js").then((m) => go(m.createHush)).catch(() => {});
}

function node(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
}

function playSafe(sound, method, ...args) {
  try { sound?.[method]?.(...args); } catch {}
}

// ------------------------------------------------------------ public API: wardrobe picker

let picker = null;

/**
 * Opens the "Hush's wardrobe" overlay. hushFactory is createHush from hush.js (loaded on
 * demand if omitted). onChange(wearing) runs after every change. Returns { el, close }.
 */
export function openPicker({ hushFactory, onChange, sound } = {}) {
  if (picker) { picker.focusFirst(); return picker.handle; }
  injectCss();
  const opener = document.activeElement;
  const app = document.getElementById("app");
  const appWasInert = app ? app.inert : false;
  const timers = new Set();
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  let preview = null;
  let closed = false;
  let exprTimer = 0;

  const scrim = node("div", "ghw-scrim");
  const card = node("div", "ghw-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "ghw-title");
  card.innerHTML = `<button type="button" class="ghw-x" aria-label="Close the wardrobe">${CROSS}</button>
<div class="ghw-mirror"></div>
<h2 class="ghw-title" id="ghw-title">Hush’s wardrobe</h2>
<p class="ghw-sub">Hush finds these while you play. Just for looks.</p>
<div class="ghw-tiles" role="group" aria-label="Accessories">${ITEMS.map((it) => `<button type="button" class="ghw-tile" data-id="${it.id}">
<span class="ghw-shelf">${icon(it.id)}<span class="ghw-lock" hidden>${LOCK}</span></span>
<span class="ghw-name">${it.label}</span><span class="ghw-state"></span><span class="ghw-bar" hidden><i></i></span></button>`).join("")}</div>
<p class="ghw-count">Seances played: <b>0</b></p>
<p class="ghw-stats"></p>
<p class="ghw-hint" aria-live="polite"></p>
<button type="button" class="btn primary ghw-done">Done</button>`;
  scrim.appendChild(card);

  const $ = (sel) => card.querySelector(sel);
  const tiles = [...card.querySelectorAll(".ghw-tile")];
  const hint = $(".ghw-hint");

  function paint() {
    const p = getProgress();
    const raw = load();
    for (const tile of tiles) {
      const it = itemOf(tile.dataset.id);
      const open = p.unlocked.includes(it.id);
      const on = open && p.wearing === it.id;
      tile.classList.toggle("ghw-locked", !open);
      tile.classList.toggle("ghw-on", on);
      tile.setAttribute("aria-pressed", on ? "true" : "false");
      if (open) tile.removeAttribute("aria-disabled");
      else tile.setAttribute("aria-disabled", "true");
      tile.querySelector(".ghw-lock").hidden = open;
      const bar = tile.querySelector(".ghw-bar");
      bar.hidden = open;
      if (!open) bar.firstElementChild.style.width = `${Math.round(lockProgress(raw, it) * 100)}%`;
      const state = tile.querySelector(".ghw-state");
      if (on) state.innerHTML = `${CHECK}Wearing`;
      else if (open) state.textContent = "Wear it";
      else state.textContent = lockShort(raw, it);
      tile.setAttribute("aria-label", on ? `${it.label}, wearing. Press to take it off.`
        : open ? `${it.label}. Press to put it on.` : `${it.label}, not found yet. ${lockLong(raw, it)}`);
    }
    $(".ghw-count b").textContent = String(p.seances);
    const bits = [];
    if (p.letters) bits.push(`${plural(p.letters, "letter")} spelled`);
    if (p.foresight) bits.push(`the table knew ${p.foresight === 1 ? "once" : `${p.foresight} times`}`);
    $(".ghw-stats").textContent = p.seances ? bits.join(" · ") : "Play a seance and see what Hush finds.";
    $(".ghw-stats").hidden = p.seances > 0 && !bits.length;
  }

  function react(name, backMs) {
    if (!preview) return;
    clearTimeout(exprTimer);
    try { preview.setExpression(name); } catch {}
    if (backMs) exprTimer = setTimeout(() => { try { preview?.setExpression("idle"); } catch {} }, backMs);
  }

  function choose(tile) {
    const it = itemOf(tile.dataset.id);
    const p = getProgress();
    if (!p.unlocked.includes(it.id)) {
      tile.classList.remove("ghw-wiggle");
      void tile.offsetWidth;
      tile.classList.add("ghw-wiggle");
      hint.textContent = lockLong(load(), it);
      react("curious", 1100);
      playSafe(sound, "tok");
      return;
    }
    const next = p.wearing === it.id ? null : it.id;
    const now = setWearing(next);
    try { preview?.setAccessory(now); } catch {}
    hint.textContent = now ? `Hush is wearing the ${it.label.toLowerCase()}.` : `Hush took off the ${it.label.toLowerCase()}.`;
    react(now ? "delighted" : "shh", now ? 0 : 900);
    playSafe(sound, now ? "catchSound" : "tok");
    paint();
    try { onChange?.(now); } catch {}
  }

  for (const tile of tiles) {
    tile.addEventListener("click", () => choose(tile));
    tile.addEventListener("animationend", () => tile.classList.remove("ghw-wiggle"));
    // A mouse hovering a found item tries it on in the mirror; leaving puts back what Hush wears.
    tile.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse" || !preview || !getProgress().unlocked.includes(tile.dataset.id)) return;
      try { preview.setAccessory(tile.dataset.id); } catch {}
    });
    tile.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse" || !preview) return;
      try { preview.setAccessory(wearing()); } catch {}
    });
  }

  function focusables() { return [...card.querySelectorAll("button:not([disabled])")]; }
  function focusFirst() {
    const w = wearing();
    const target = tiles.find((t) => t.dataset.id === w) || tiles.find((t) => !t.classList.contains("ghw-locked")) || $(".ghw-done");
    try { target.focus({ preventScroll: true }); } catch {}
  }

  // Esc and Tab are handled before anything else sees them; every other key pressed
  // inside the wardrobe stays here, so the game's Enter, Space and arrows don't fire.
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const f = focusables();
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (i === -1) { e.preventDefault(); f[0].focus(); }
    else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
  scrim.addEventListener("keydown", (e) => {
    const i = tiles.indexOf(document.activeElement);
    if (i !== -1 && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      e.preventDefault();
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      tiles[(i + step + tiles.length) % tiles.length].focus();
    }
    e.stopPropagation();
  });
  scrim.addEventListener("keyup", (e) => e.stopPropagation());
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  $(".ghw-x").addEventListener("click", () => close());
  $(".ghw-done").addEventListener("click", () => close());

  function close() {
    if (closed) return;
    closed = true;
    removeEventListener("keydown", onKey, true);
    clearTimeout(exprTimer);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    try { preview?.destroy(); } catch {}
    preview = null;
    if (app) app.inert = appWasInert;
    picker = null;
    const gone = () => scrim.remove();
    if (reduced()) gone();
    else { scrim.classList.add("ghw-out"); setTimeout(gone, 170); }
    try { if (opener && opener.isConnected) opener.focus({ preventScroll: true }); } catch {}
  }

  document.body.appendChild(scrim);
  if (app) app.inert = true;
  addEventListener("keydown", onKey, true);
  paint();
  focusFirst();

  const size = innerHeight < 640 ? 120 : PREVIEW_PX;
  makeHush(hushFactory, $(".ghw-mirror"), { size }, (h) => {
    if (closed) { try { h.destroy(); } catch {} return; }
    preview = h;
    try { h.setAccessory(wearing()); } catch {}
    later(260, () => react("delighted"));
  });

  const handle = { el: scrim, close };
  picker = { handle, focusFirst };
  return handle;
}

// ------------------------------------------------------------ public API: celebration card

const queue = [];
let celebrating = false;

/**
 * Shows "Hush found a scarf!" over the game for about 3.5 s, with a "Try it on" button
 * that puts it on. Extra calls queue up. Resolves true if the player tried it on.
 */
export function celebrate(name, { hushFactory, onChange, sound } = {}) {
  const it = itemOf(name);
  if (!it || typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    queue.push({ it, hushFactory, onChange, sound, resolve });
    if (!celebrating) nextCelebration();
  });
}

// Full-screen sheets the card would hide behind (or be dimmed by): the wardrobe itself,
// the scrapbook, the share preview and the Aa menu. The card waits for them to close, so
// its timer only starts once it can be seen.
const BLOCKERS = ".ghw-scrim, .ghsb, .ghsc, .gh-comfort";
let waitObs = null;
const overlayOpen = () => !!picker || !!document.querySelector(BLOCKERS);

function nextCelebration() {
  if (!queue.length) { celebrating = false; return; }
  celebrating = true;
  if (overlayOpen()) { waitForOverlays(); return; }
  showCelebration(queue.shift());
}

function waitForOverlays() {
  if (waitObs) return;
  const resume = () => {
    if (overlayOpen()) return;
    if (waitObs) { waitObs.disconnect(); waitObs = null; }
    setTimeout(nextCelebration, 250);
  };
  if (typeof MutationObserver !== "function") { setTimeout(nextCelebration, 500); return; }
  waitObs = new MutationObserver(resume);
  waitObs.observe(document.body, { childList: true });
}

function showCelebration({ it, hushFactory, onChange, sound, resolve }) {
  injectCss();
  const titleId = `ghw-cele-${Date.now().toString(36)}`;
  const card = node("div", "ghw-cele");
  card.setAttribute("role", "group");
  card.setAttribute("aria-labelledby", titleId);
  const p = getProgress();
  const worn = p.wearing === it.id;
  const canTry = p.unlocked.includes(it.id);
  card.innerHTML = `<div class="ghw-cele-hush"><span class="ghw-spark" style="left:2px;top:6px">${SPARK}</span>` +
    `<span class="ghw-spark" style="right:0;top:16px;animation-delay:240ms">${SPARK}</span>` +
    `<span class="ghw-spark" style="left:12px;bottom:2px;animation-delay:480ms">${SPARK}</span></div>
<div class="ghw-cele-body"><p class="ghw-cele-title" id="${titleId}" role="status"></p><p class="ghw-cele-sub">${reason(it)}</p>
<div class="ghw-cele-act">${canTry ? `<button type="button" class="btn primary small ghw-try"${worn ? " disabled" : ""}>${worn ? "Wearing it" : "Try it on"}</button>` : ""}</div></div>
<button type="button" class="ghw-x" aria-label="Dismiss">${CROSS}</button>
<div class="ghw-cele-timer" aria-hidden="true"><i style="animation-duration:${CELEBRATE_MS}ms"></i></div>`;
  document.body.appendChild(card);
  // Filled in after insertion so screen readers announce it.
  requestAnimationFrame(() => { card.querySelector(".ghw-cele-title").textContent = `Hush found ${it.noun}!`; });

  let preview = null;
  let tried = false;
  let done = false;
  let timer = 0, spinTimer = 0;
  let remaining = CELEBRATE_MS, armedAt = 0, paused = false, hover = false, focusIn = false;

  makeHush(hushFactory, card.querySelector(".ghw-cele-hush"), { size: CARD_HUSH_PX }, (h) => {
    if (done) { try { h.destroy(); } catch {} return; }
    preview = h;
    try { h.setAccessory(it.id); } catch {}
    const spin = () => { try { preview?.setExpression("delighted"); } catch {} };
    spinTimer = setTimeout(() => { spin(); spinTimer = setTimeout(spin, 1500); }, 140);
  });
  playSafe(sound, "catchSound");

  function arm(ms) { clearTimeout(timer); armedAt = performance.now(); remaining = ms; timer = setTimeout(dismiss, ms); }
  function sync() {
    const hold = hover || focusIn;
    if (tried || done || hold === paused) return;
    paused = hold;
    if (hold) { clearTimeout(timer); remaining = Math.max(600, remaining - (performance.now() - armedAt)); }
    else arm(remaining);
  }
  card.addEventListener("pointerenter", () => { hover = true; sync(); });
  card.addEventListener("pointerleave", () => { hover = false; sync(); });
  card.addEventListener("focusin", () => { focusIn = true; sync(); });
  card.addEventListener("focusout", (e) => { focusIn = card.contains(e.relatedTarget); sync(); });
  card.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); e.stopPropagation(); });
  const onEsc = (e) => { if (e.key === "Escape" && !picker) dismiss(); };
  addEventListener("keydown", onEsc);

  card.querySelector(".ghw-x").addEventListener("click", () => dismiss());
  card.querySelector(".ghw-try")?.addEventListener("click", () => {
    if (tried) return;
    tried = true;
    const now = setWearing(it.id);
    try { onChange?.(now); } catch {}
    playSafe(sound, "tok");
    const act = card.querySelector(".ghw-cele-act");
    const hadFocus = act.contains(document.activeElement);
    act.innerHTML = `<p class="ghw-cele-done" tabindex="-1">Hush is wearing it.</p>`;
    if (hadFocus) { try { act.firstElementChild.focus({ preventScroll: true }); } catch {} }
    card.querySelector(".ghw-cele-timer").hidden = true;
    clearTimeout(spinTimer);
    try { preview?.setExpression("delighted"); } catch {}
    clearTimeout(timer);
    timer = setTimeout(dismiss, TRIED_MS);
  });

  function dismiss() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearTimeout(spinTimer);
    removeEventListener("keydown", onEsc);
    const finish = () => {
      try { preview?.destroy(); } catch {}
      card.remove();
      resolve(tried);
      setTimeout(nextCelebration, 250);
    };
    card.classList.add("ghw-out");
    setTimeout(finish, reduced() ? 200 : 240);
  }

  arm(CELEBRATE_MS);
}
