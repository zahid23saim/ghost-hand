// Ghost Hand - Hush's scrapbook: every revealed sentence, kept on this device as a little storybook.
// Storage is localStorage only (key "gh.scrapbook"), newest page first, and the game never needs it:
// if storage is blocked the book still works for this visit from memory.

import { SEATS } from "./render.js";
import { get, subscribe } from "./settings.js";

const KEY = "gh.scrapbook";
const MAX_PAGES = 60;
const DEDUPE_MS = 10 * 60 * 1000;   // reconnects re-send the reveal; keep one page per sentence
const GHOST_FRIEND = "#D9CCEB";     // seat colour -1: a ghost friend, soft lavender
const TURN_MS = 540;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ------------------------------------------------------------ storage

let memory = null;       // last known pages, used when storage cannot be read or written
let useMemory = false;

const clone = (v) => JSON.parse(JSON.stringify(v));

function tidy(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((p) => p && typeof p === "object" && typeof p.frameText === "string" && Number.isFinite(p.at))
    .map((p) => ({ ...p, words: Array.isArray(p.words) ? p.words.filter((w) => w && typeof w.w === "string") : [] }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_PAGES);
}

function load() {
  if (!useMemory) {
    let raw = null;
    let ok = true;
    try { raw = localStorage.getItem(KEY); } catch { ok = false; useMemory = true; }
    if (ok) {
      if (!raw) return [];
      try { return tidy(JSON.parse(raw)); } catch { return []; }
    }
  }
  return tidy(memory || []);
}

function store(pages) {
  memory = pages;
  if (useMemory) return;
  let keep = pages;
  // A full quota keeps the newest half rather than losing the new page.
  for (;;) {
    try { localStorage.setItem(KEY, JSON.stringify(keep)); return; } catch {}
    if (keep.length <= 1) { useMemory = true; return; }
    keep = keep.slice(0, Math.ceil(keep.length / 2));
  }
}

const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");

/**
 * Keep a revealed sentence. Returns the stored page, or null when nothing was saved
 * (no sentence, or the same question and sentence were saved in the last 10 minutes).
 */
export function save(rev, { you, at, code, mode } = {}) {
  if (!rev || typeof rev.frameText !== "string") return null;
  const frameText = norm(rev.frameText);
  if (!frameText) return null;
  const ask = norm(rev.ask);
  const when = Number.isFinite(at) ? at : Date.now();
  const pages = load();
  if (pages.some((p) => p.frameText === frameText && p.ask === ask && Math.abs(when - p.at) < DEDUPE_MS)) return null;
  const me = you && typeof you === "object" ? you.seat : you;
  const page = {
    id: `${when.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: when,
    ask,
    frameText,
    words: (Array.isArray(rev.words) ? rev.words : []).map((w) => ({
      w: norm(w?.w).toUpperCase(),
      name: norm(w?.name),
      colour: Number.isInteger(w?.colour) ? w.colour : -1,
      mine: me != null && w?.seat === me,
    })),
    stars: { swift: !!rev.stars?.swift, steady: !!rev.stars?.steady, sure: !!rev.stars?.sure },
    fs: Math.max(0, Math.floor(Number(rev.fs) || 0)),
    seance: typeof rev.seance === "string" ? rev.seance : "",
    mode: mode === "solo" || mode === "table" ? mode : "",
    code: typeof code === "string" ? code : "",
  };
  pages.unshift(page);
  store(pages.slice(0, MAX_PAGES));
  return clone(page);
}

/** Every page, newest first (copies). */
export function list() { return clone(load()); }

/** How many pages the book holds. */
export function count() { return load().length; }

/** The number for a button label, e.g. `Scrapbook · ${badge()}`. */
export function badge() { return count(); }

/** Empty the book. */
export function clear() {
  memory = [];
  if (!useMemory) { try { localStorage.removeItem(KEY); } catch { useMemory = true; } }
  if (ui) ui.reload();
}

// ------------------------------------------------------------ helpers

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Reduce motion: the in-app setting (settings.js), the device setting, or #app.reduce-motion.
// Overlays live outside #app, so the choice also goes on <html> as .gh-reduce for the CSS.
const osReduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const reducedMotion = () => !!get("reducedMotion") || osReduced() || !!document.getElementById("app")?.classList.contains("reduce-motion");
function syncReduce() { try { document.documentElement.classList.toggle("gh-reduce", reducedMotion()); } catch {} }
subscribe((_, key) => { if (key === "reducedMotion") queueMicrotask(syncReduce); });

function seatHex(c) {
  return Number.isInteger(c) && c >= 0 && SEATS[c % SEATS.length] ? SEATS[c % SEATS.length].hex : GHOST_FRIEND;
}
function withAlpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(217,204,235,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function dateLabel(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const s = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? s : `${s} ${d.getFullYear()}`;
}

const ICON_X = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ------------------------------------------------------------ styles

const CSS = `
.ghsb { position: fixed; inset: 0; z-index: 80; display: flex; flex-direction: column; align-items: center;
  padding: max(10px, env(safe-area-inset-top)) 16px max(12px, env(safe-area-inset-bottom));
  background: radial-gradient(ellipse 70% 45% at 50% 0%, rgba(94,242,208,0.10), rgba(94,242,208,0) 70%), var(--night, #14122B);
  color: var(--cream, #F3E9D2); font: 600 16px/1.4 var(--ui, system-ui, sans-serif); outline: none;
  overflow-y: auto; overscroll-behavior: contain; touch-action: manipulation; -webkit-user-select: none; user-select: none;
  animation: ghsb-in 220ms ease-out; transition: opacity 170ms ease-in; }
.ghsb.out { opacity: 0; pointer-events: none; }
@keyframes ghsb-in { from { opacity: 0; } to { opacity: 1; } }
.ghsb button { font: inherit; color: inherit; cursor: pointer; }
.ghsb button:focus-visible { outline: 3px solid var(--mint, #5EF2D0); outline-offset: 3px; }
.ghsb-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }

.ghsb-top { flex: 0 0 auto; width: 100%; max-width: 820px; display: flex; align-items: center; gap: 12px; min-height: 48px; }
.ghsb-title { margin: 0; flex: 1; font: 700 25px/1.1 var(--display, Georgia, serif); font-variation-settings: "SOFT" 100; color: var(--cream, #F3E9D2); }
.ghsb-title span { display: block; margin-top: 3px; font: 800 12px/1.2 var(--ui, sans-serif); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted, #A9A3C9); }
.ghsb-x { flex: 0 0 auto; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line-strong, rgba(243,233,210,0.28)); background: var(--card, #221E45); color: var(--cream, #F3E9D2); display: grid; place-items: center; }
.ghsb-x:hover { background: var(--violet, #3A3270); }

.ghsb-stage { flex: 1 1 auto; min-height: 0; width: 100%; max-width: 820px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 0 6px; }
.ghsb-book { position: relative; display: flex; flex-direction: column; flex: 0 1 540px; width: 100%; max-width: 760px; min-height: 260px; padding: 10px 14px 12px 20px; border-radius: 22px;
  background: linear-gradient(140deg, #332B6B 0%, #241F4E 55%, #1B1739 100%);
  border: 1px solid rgba(201,162,74,0.75);
  box-shadow: 0 22px 60px rgba(0,0,0,0.5), 0 0 0 4px rgba(20,18,43,0.6), inset 0 0 0 3px rgba(20,18,43,0.45);
  animation: ghsb-rise 320ms cubic-bezier(.2,1.2,.4,1); }
@keyframes ghsb-rise { from { transform: translateY(16px) scale(0.98); } to { transform: none; } }
/* stitches down the spine */
.ghsb-book::before { content: ""; position: absolute; left: 8px; top: 18px; bottom: 18px; width: 3px; border-radius: 2px;
  background: repeating-linear-gradient(180deg, rgba(201,162,74,0.7) 0 8px, rgba(201,162,74,0) 8px 15px); }
.ghsb-hush { position: absolute; bottom: 100%; right: 64px; z-index: 4; pointer-events: none; filter: drop-shadow(0 0 14px rgba(94,242,208,0.35)); }
.ghsb-ribbon { position: absolute; bottom: -26px; right: 22%; width: 18px; height: 44px; background: var(--coral, #FF7A6B);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%); }

.ghsb-pages { position: relative; flex: 1 1 auto; min-height: 0; width: 100%; perspective: 2200px; }
/* the stack of pages under the open one */
.ghsb-pages::before { content: ""; position: absolute; inset: 0; border-radius: 6px 16px 16px 6px; background: #1E1A42;
  transform: translate(4px, 4px); box-shadow: 3px 3px 0 -1px #1A1739, 3px 3px 0 0 rgba(243,233,210,0.10), 0 0 0 1px rgba(243,233,210,0.10); }
.ghsb-page { position: absolute; inset: 0; border-radius: 6px 16px 16px 6px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y;
  background:
    linear-gradient(90deg, rgba(8,7,20,0.45), rgba(8,7,20,0) 36px),
    radial-gradient(ellipse 90% 80% at 58% 42%, #2C2758 0%, var(--card, #221E45) 72%);
  border: 1px solid rgba(243,233,210,0.12);
  transform-origin: left center; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.ghsb-page.turning { z-index: 2; box-shadow: 10px 0 30px rgba(0,0,0,0.35); }
.ghsb-inner { position: relative; box-sizing: border-box; margin: 12px 12px 12px 26px; min-height: calc(100% - 24px); padding: 22px 26px;
  border: 1px solid rgba(201,162,74,0.28); border-radius: 4px 12px 12px 4px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; }
.ghsb-inner::before, .ghsb-inner::after { content: "\\2726"; position: absolute; top: 8px; font-size: 11px; line-height: 1; color: var(--gold-deep, #C9A24A); opacity: 0.8; }
.ghsb-inner::before { left: 10px; }
.ghsb-inner::after { right: 10px; }

.ghsb-eyebrow { margin: 0; font: 800 12px/1.2 var(--ui, sans-serif); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted, #A9A3C9); }
.ghsb-ask { margin: 0; max-width: 520px; font: 600 italic 17px/1.3 var(--display, Georgia, serif); color: var(--muted, #A9A3C9); }
.ghsb-sent { margin: 6px 0 4px; max-width: 660px; display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 4px 12px;
  font: 700 clamp(28px, 4.2vw, 42px)/1.15 var(--display, Georgia, serif); font-variation-settings: "SOFT" 100; color: var(--cream, #F3E9D2); }
.ghsb-sent.short { font-size: clamp(34px, 5.4vw, 56px); }
.ghsb-sent.long { font-size: clamp(24px, 3.4vw, 34px); }
.ghsb-sent.longer { font-size: clamp(21px, 2.8vw, 28px); gap: 3px 10px; }
.ghsb-w { display: inline-flex; flex-direction: column; align-items: center; }
.ghsb-w b { font-weight: 800; color: var(--c); text-shadow: 0 0 20px var(--g), 0 0 3px var(--g); }
.ghsb-w small { margin-top: 2px; font: 800 12px/1.2 var(--ui, sans-serif); letter-spacing: 0; color: var(--muted, #A9A3C9); white-space: nowrap; max-width: 9em; overflow: hidden; text-overflow: ellipsis; }
.ghsb-w small i { display: inline-block; width: 7px; height: 7px; margin-right: 4px; border-radius: 50%; background: var(--c); vertical-align: 1px; font-style: normal; }
.ghsb-orn { margin: 2px 0 0; font-size: 12px; letter-spacing: 0.6em; color: var(--gold-deep, #C9A24A); opacity: 0.75; padding-left: 0.6em; }
.ghsb-stars { margin: 0; display: flex; gap: 6px 16px; flex-wrap: wrap; justify-content: center; font: 800 15px var(--ui, sans-serif); }
.ghsb-stars span { display: inline-flex; align-items: center; gap: 4px; }
.ghsb-stars .got { color: var(--gold, #FFC94D); }
.ghsb-stars .miss { color: var(--muted, #A9A3C9); opacity: 0.65; }
.ghsb-knew { margin: 0; font: 700 16px var(--display, Georgia, serif); color: var(--mint, #5EF2D0); }

.ghsb-ghostline { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px 10px; margin-bottom: 6px;
  font: 700 26px/1 var(--display, Georgia, serif); color: rgba(243,233,210,0.28); }
.ghsb-ghostline i { display: inline-block; width: calc(var(--n) * 18px); height: 30px; border-radius: 9px; border: 2px dashed rgba(201,162,74,0.45); }
.ghsb-invite { margin: 0; max-width: 420px; font: 700 26px/1.2 var(--display, Georgia, serif); font-variation-settings: "SOFT" 100; color: var(--cream, #F3E9D2); }
.ghsb-invite-sub { margin: 0 0 8px; font: 700 16px var(--ui, sans-serif); color: var(--muted, #A9A3C9); }

.ghsb-nav { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; gap: 18px; min-height: 58px; margin-top: 22px; }
.ghsb-arrow { width: 50px; height: 50px; border-radius: 50%; border: 1px solid rgba(201,162,74,0.65); background: var(--card, #221E45); color: var(--gold, #FFC94D);
  display: grid; place-items: center; box-shadow: var(--lift, 0 3px 0 rgba(0,0,0,0.35)); transition: transform 120ms, background 160ms, opacity 160ms; }
.ghsb-arrow:hover:not(:disabled) { background: var(--violet, #3A3270); }
.ghsb-arrow:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 rgba(0,0,0,0.35); }
.ghsb-arrow:disabled { opacity: 0.3; cursor: default; box-shadow: none; }
.ghsb-count { min-width: 86px; text-align: center; font: 800 16px var(--ui, sans-serif); color: var(--cream, #F3E9D2); font-variant-numeric: tabular-nums; }

.ghsb-foot { flex: 0 0 auto; min-height: 44px; display: flex; align-items: center; justify-content: center; gap: 4px 10px; flex-wrap: wrap; text-align: center;
  font: 700 14px var(--ui, sans-serif); color: var(--muted, #A9A3C9); }
.ghsb-link { border: 0; background: none; padding: 10px 8px; min-height: 40px; font: 700 14px var(--ui, sans-serif) !important; color: var(--muted, #A9A3C9) !important;
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(169,163,201,0.5); border-radius: 10px; }
.ghsb-link:hover { color: var(--cream, #F3E9D2) !important; }
.ghsb-q { color: var(--cream, #F3E9D2); }
.ghsb-danger { border: 1px solid rgba(255,122,107,0.7); background: rgba(255,122,107,0.14); color: var(--coral, #FF7A6B) !important; border-radius: 12px; min-height: 38px; padding: 6px 14px; font: 800 14px var(--ui, sans-serif) !important; }
.ghsb-danger:hover { background: rgba(255,122,107,0.24); }

@media (max-width: 600px) {
  .ghsb { padding-left: 10px; padding-right: 10px; }
  .ghsb-title { font-size: 21px; }
  .ghsb-stage { padding-top: 34px; }
  .ghsb-book { flex: 1 1 auto; max-height: 640px; padding: 8px 10px 10px 16px; border-radius: 20px; }
  .ghsb-book::before { left: 6px; }
  .ghsb-hush { right: 40px; }
  .ghsb-inner { margin: 10px 8px 10px 18px; min-height: calc(100% - 20px); padding: 22px 12px; gap: 9px; }
  .ghsb-sent { font-size: 26px; gap: 3px 9px; }
  .ghsb-sent.short { font-size: 34px; }
  .ghsb-sent.long { font-size: 23px; }
  .ghsb-sent.longer { font-size: 20px; gap: 2px 8px; }
  .ghsb-ask { font-size: 16px; }
  .ghsb-stars { font-size: 14px; gap: 4px 12px; }
  .ghsb-invite { font-size: 23px; }
  .ghsb-ghostline { font-size: 22px; }
  .ghsb-ghostline i { width: calc(var(--n) * 14px); height: 26px; }
  .ghsb-nav { margin-top: 20px; min-height: 54px; }
}
@media (max-height: 520px) and (orientation: landscape) {
  .ghsb-stage { padding-top: 8px; }
  .ghsb-hush { display: none; }
  .ghsb-book { flex: 1 1 auto; min-height: 220px; }
  .ghsb-nav { margin-top: 16px; min-height: 48px; }
}
@media (prefers-reduced-motion: reduce) {
  .ghsb, .ghsb-book { animation: none; }
  .ghsb { transition: none; }
}
html.gh-reduce .ghsb, html.gh-reduce .ghsb-book { animation: none; }
html.gh-reduce .ghsb { transition: none; }
`;

function injectStyles() {
  syncReduce();
  if (document.getElementById("gh-scrapbook")) return;
  const s = document.createElement("style");
  s.id = "gh-scrapbook";
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ------------------------------------------------------------ the book

let ui = null;

/** Is the scrapbook showing? */
export function isOpen() { return !!ui; }

/** Close the scrapbook if it is open (calls its onClose). */
export function close() { ui?.close(); }

/**
 * Show the scrapbook over everything. Options: onClose(), onPlay() (adds "Play solo" to the
 * empty book), start (page index to open on, 0 = newest). Returns { close }.
 */
export function open({ onClose, onPlay, start = 0 } = {}) {
  if (ui) { ui.focus(); return { close }; }
  injectStyles();

  let pages = load();
  let idx = Math.max(0, Math.min(pages.length - 1, Math.floor(Number(start) || 0)));
  let confirming = false;
  let turning = null;       // { anim, done } while a page is mid-turn
  let swipe = null;
  let hushInst = null;
  const prevFocus = document.activeElement;
  const appEl = document.getElementById("app");
  const appWasInert = appEl ? appEl.inert : false;

  const root = document.createElement("div");
  root.className = "ghsb";
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "ghsb-title");
  if (appEl?.dataset.device) root.dataset.device = appEl.dataset.device;
  root.innerHTML = `
    <header class="ghsb-top">
      <h2 class="ghsb-title" id="ghsb-title">Hush's scrapbook <span class="ghsb-sub"></span></h2>
      <button class="ghsb-x" type="button" data-act="close" aria-label="Close the scrapbook">${ICON_X}</button>
    </header>
    <div class="ghsb-stage">
      <div class="ghsb-book">
        <div class="ghsb-hush" aria-hidden="true"></div>
        <span class="ghsb-ribbon" aria-hidden="true"></span>
        <div class="ghsb-pages"></div>
      </div>
      <nav class="ghsb-nav" aria-label="Turn the pages">
        <button class="ghsb-arrow" type="button" data-go="-1" aria-label="Previous page">${ICON_PREV}</button>
        <span class="ghsb-count" aria-live="polite"></span>
        <button class="ghsb-arrow" type="button" data-go="1" aria-label="Next page">${ICON_NEXT}</button>
      </nav>
    </div>
    <div class="ghsb-foot"></div>`;
  const $ = (sel) => root.querySelector(sel);
  const pagesEl = $(".ghsb-pages");
  const nav = $(".ghsb-nav");
  const countEl = $(".ghsb-count");
  const prevBtn = $('[data-go="-1"]');
  const nextBtn = $('[data-go="1"]');
  const foot = $(".ghsb-foot");
  const sub = $(".ghsb-sub");

  function buildPage(i) {
    const p = pages[i];
    const art = document.createElement("article");
    art.className = "ghsb-page";
    art.setAttribute("aria-label", `Page ${i + 1} of ${pages.length}`);
    const toks = p.frameText.split(/\s+/);
    let k = 0;
    const words = toks.map((tok) => {
      const w = p.words[k];
      if (w && w.w && tok.toUpperCase().replace(/[^A-Z]/g, "") === w.w.replace(/[^A-Z]/g, "")) {
        k++;
        const col = seatHex(w.colour);
        const who = w.mine ? "you" : (w.name || "a ghost friend");
        return `<span class="ghsb-w slot" style="--c:${col};--g:${withAlpha(col, 0.55)}"><b>${esc(tok)}</b><small><i aria-hidden="true"></i>${esc(who)}</small></span>`;
      }
      return `<span class="ghsb-w"><span>${esc(tok)}</span><small aria-hidden="true">&nbsp;</small></span>`;
    }).join("");
    const len = p.frameText.length;
    const size = len > 66 ? " longer" : len > 42 ? " long" : len < 22 ? " short" : "";
    const st = p.stars || {};
    const stars = [["swift", "Swift"], ["steady", "Steady"], ["sure", "Sure"]].map(([key, label]) =>
      `<span class="${st[key] ? "got" : "miss"}"><span aria-hidden="true">${st[key] ? "★" : "☆"}</span>${label}<span class="ghsb-sr">${st[key] ? ", earned" : ", not this time"}</span></span>`).join("");
    const knew = p.fs ? `<p class="ghsb-knew">The table knew ${p.fs === 1 ? "once" : `${p.fs} times`}</p>` : "";
    const eyebrow = [p.seance, dateLabel(p.at)].filter(Boolean).map(esc).join(" · ");
    art.innerHTML = `
      <div class="ghsb-inner">
        ${eyebrow ? `<p class="ghsb-eyebrow">${eyebrow}</p>` : ""}
        ${p.ask ? `<p class="ghsb-ask">${esc(p.ask)}</p>` : ""}
        <h3 class="ghsb-sent${size}">${words}</h3>
        <p class="ghsb-orn" aria-hidden="true">✦✦✦</p>
        <p class="ghsb-stars">${stars}</p>
        ${knew}
      </div>`;
    return art;
  }

  function buildEmpty() {
    const art = document.createElement("article");
    art.className = "ghsb-page ghsb-blank";
    art.innerHTML = `
      <div class="ghsb-inner">
        <div class="ghsb-ghostline" aria-hidden="true"><span>A</span><i style="--n:4"></i><span>AND A</span><i style="--n:6"></i></div>
        <p class="ghsb-invite">Your table's sentences will live here.</p>
        <p class="ghsb-invite-sub">Play a round to start the book.</p>
        ${typeof onPlay === "function" ? '<button class="btn primary ghsb-play" type="button" data-act="play">Play solo</button>' : ""}
      </div>`;
    return art;
  }

  function updateNav() {
    const n = pages.length;
    nav.hidden = n === 0;
    countEl.textContent = n ? `${idx + 1} of ${n}` : "";
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx >= n - 1;
    sub.textContent = n ? (n === 1 ? "1 sentence" : `${n} sentences`) : "";
  }

  function renderFoot() {
    if (!pages.length) { foot.innerHTML = ""; return; }
    foot.innerHTML = confirming
      ? `<span class="ghsb-q" role="alert">Clear all ${pages.length === 1 ? "1 page" : `${pages.length} pages`}? This can't be undone.</span>
         <button class="ghsb-danger" type="button" data-act="clear-yes">Clear them</button>
         <button class="ghsb-link" type="button" data-act="clear-no">Keep them</button>`
      : '<button class="ghsb-link" type="button" data-act="clear">Clear the book</button>';
  }

  function render() {
    settle();
    pagesEl.textContent = "";
    pagesEl.appendChild(pages.length ? buildPage(idx) : buildEmpty());
    updateNav();
    renderFoot();
    hushInst?.setExpression(pages.length ? "idle" : "curious");
  }

  // Finish any page that is still turning, at once.
  function settle() {
    if (!turning) return;
    const t = turning;
    turning = null;
    try { t.anim.cancel(); } catch {}
    t.done();
  }

  function go(delta) {
    const to = idx + delta;
    if (!pages.length || to < 0 || to >= pages.length || to === idx) return;
    settle();
    const old = pagesEl.querySelector(".ghsb-page");
    idx = to;
    const fresh = buildPage(idx);
    updateNav();
    if (!old || reducedMotion() || typeof fresh.animate !== "function") {
      pagesEl.textContent = "";
      pagesEl.appendChild(fresh);
      return;
    }
    const timing = { duration: TURN_MS, easing: "cubic-bezier(.45,.05,.35,1)" };
    let t;
    if (delta > 0) {
      // Forward: the open page lifts and turns over the spine, showing the next one beneath.
      pagesEl.insertBefore(fresh, old);
      old.classList.add("turning");
      old.setAttribute("aria-hidden", "true");
      const anim = old.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(-104deg)" }], timing);
      t = { anim, done: () => old.remove() };
    } else {
      // Back: the earlier page swings back over from the spine.
      pagesEl.appendChild(fresh);
      fresh.classList.add("turning");
      const anim = fresh.animate([{ transform: "rotateY(-104deg)" }, { transform: "rotateY(0deg)" }], timing);
      t = { anim, done: () => { old.remove(); fresh.classList.remove("turning"); } };
    }
    turning = t;
    t.anim.onfinish = () => { if (turning === t) { turning = null; t.done(); } };
  }

  function focusables() {
    return [...root.querySelectorAll("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")]
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  // Capture on window so the game underneath never hears keys while the book is open.
  function onKey(e) {
    if (!ui || ui.root !== root) return;
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); doClose(); }
    else if (k === "ArrowRight" || k === "PageDown") { e.preventDefault(); go(1); }
    else if (k === "ArrowLeft" || k === "PageUp") { e.preventDefault(); go(-1); }
    else if (k === "Home" && pages.length) { e.preventDefault(); go(-idx); }
    else if (k === "End" && pages.length) { e.preventDefault(); go(pages.length - 1 - idx); }
    else if (k === "Tab") {
      const f = focusables();
      if (f.length) {
        const first = f[0], last = f[f.length - 1];
        const inside = root.contains(document.activeElement) && document.activeElement !== root;
        if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    const b = e.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.dataset.go) { go(Number(b.dataset.go)); return; }
    switch (b.dataset.act) {
      case "close": doClose(); break;
      case "play": { const fn = onPlay; doClose(); try { fn?.(); } catch (err) { console.error(err); } break; }
      case "clear": confirming = true; renderFoot(); foot.querySelector('[data-act="clear-no"]')?.focus(); break;
      case "clear-no": confirming = false; renderFoot(); foot.querySelector('[data-act="clear"]')?.focus(); break;
      case "clear-yes":
        confirming = false;
        clear(); // reloads the open book through ui.reload()
        (root.querySelector('[data-act="play"]') || root.querySelector('[data-act="close"]'))?.focus();
        break;
      default: break;
    }
  }

  // Swipe on phones: finger left = next page, finger right = previous page.
  pagesEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  pagesEl.addEventListener("pointerup", (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) go(dx < 0 ? 1 : -1);
  });
  pagesEl.addEventListener("pointercancel", () => { swipe = null; });
  root.addEventListener("click", onClick);

  function doClose() {
    if (!ui || ui.root !== root) return;
    ui = null;
    removeEventListener("keydown", onKey, true);
    settle();
    if (appEl) { try { appEl.inert = appWasInert; } catch {} }
    try { hushInst?.destroy(); } catch {}
    hushInst = null;
    if (reducedMotion()) root.remove();
    else { root.classList.add("out"); setTimeout(() => root.remove(), 190); }
    try { if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch {}
    try { onClose?.(); } catch (err) { console.error(err); }
  }

  ui = {
    root,
    close: doClose,
    focus: () => root.focus({ preventScroll: true }),
    reload: () => { pages = load(); idx = Math.max(0, Math.min(idx, pages.length - 1)); confirming = false; render(); },
  };

  document.body.appendChild(root);
  if (appEl) { try { appEl.inert = true; } catch {} }
  addEventListener("keydown", onKey, true);
  render();
  root.focus({ preventScroll: true });

  // A small Hush peeks over the top of the book, if Hush is around.
  import("./hush.js").then((m) => {
    if (!ui || ui.root !== root || !m?.createHush) return;
    hushInst = m.createHush($(".ghsb-hush"), { size: 70, peek: true });
    hushInst.setExpression(pages.length ? "idle" : "curious");
  }).catch(() => {});

  return { close: doClose };
}
