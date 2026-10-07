// Ghost Hand - comfort settings and the "Aa" menu (spec §8.11, §4.2 hold-free pad).
//
// settings is a live object: { bigLetters, captions, reducedMotion, holdFree }.
// Only choices the player actually made are saved (localStorage "gh.settings"), so
// reducedMotion keeps following the device setting until the player touches it.

import { LANGS, getLang, setLang, t } from "./i18n.js";

const KEY = "gh.settings";
const KEYS = ["bigLetters", "captions", "reducedMotion", "holdFree"];

let mq = null;
try { mq = matchMedia("(prefers-reduced-motion: reduce)"); } catch {}
const osReduced = () => !!(mq && mq.matches);

function load() {
  const out = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (raw && typeof raw === "object") for (const k of KEYS) if (typeof raw[k] === "boolean") out[k] = raw[k];
  } catch {}
  return out;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(chosen)); } catch {}
}

let chosen = load();
const subs = new Set();

export const settings = {};
function recompute() {
  settings.bigLetters = chosen.bigLetters ?? false;
  settings.captions = chosen.captions ?? false;
  settings.reducedMotion = chosen.reducedMotion ?? osReduced();
  settings.holdFree = chosen.holdFree ?? false;
}
recompute();

function notify(key) {
  for (const fn of [...subs]) {
    try { fn(settings, key); } catch (e) { console.error(e); }
  }
}

export function get(key) { return settings[key]; }

export function set(key, value) {
  if (!KEYS.includes(key)) return false;
  const v = !!value;
  const had = key in chosen;
  if (settings[key] === v && had) return false;
  chosen[key] = v;
  save();
  const before = settings[key];
  recompute();
  if (before !== settings[key]) notify(key);
  return true;
}

// fn(settings, key) runs after every change. Pass { immediate: true } to also run it now
// (key is null then), which is handy for applying the saved choices at boot.
export function subscribe(fn, { immediate = false } = {}) {
  subs.add(fn);
  if (immediate) { try { fn(settings, null); } catch (e) { console.error(e); } }
  return () => subs.delete(fn);
}

// The device's own reduced-motion setting, until the player picks one here.
try {
  mq?.addEventListener?.("change", () => {
    if ("reducedMotion" in chosen) return;
    const before = settings.reducedMotion;
    recompute();
    if (before !== settings.reducedMotion) notify("reducedMotion");
  });
} catch {}

// Another tab changed the settings.
try {
  addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    const before = { ...settings };
    chosen = load();
    recompute();
    for (const k of KEYS) if (before[k] !== settings[k]) notify(k);
  });
} catch {}

// ------------------------------------------------------------ styles

const CSS = `
.gh-aa-btn { font: 700 17px/1 var(--display); letter-spacing: -0.02em; font-variation-settings: "SOFT" 100; }
.gh-aa-btn[aria-expanded="true"] { border-color: var(--gold); color: var(--gold); }
.gh-comfort { position: fixed; inset: 0; z-index: 80; isolation: isolate; display: grid; place-items: center;
  padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
  background: rgba(8,7,20,0.86); font: 600 16px/1.4 var(--ui); color: var(--cream);
  -webkit-user-select: none; user-select: none; touch-action: manipulation;
  animation: gh-comfort-fade 160ms ease-out both; transition: opacity 140ms ease-in; }
.gh-comfort.gh-closing { opacity: 0; }
.gh-comfort-panel { width: min(420px, 100%); max-height: 100%; overflow-y: auto; overscroll-behavior: contain;
  background: var(--card, #221E45); border: 1px solid rgba(201,162,74,0.55); border-radius: 22px; padding: 16px 16px 18px;
  box-shadow: 0 18px 50px rgba(0,0,0,0.45); outline: none;
  animation: gh-comfort-rise 240ms cubic-bezier(.2,1.25,.4,1) both; }
.gh-comfort-head { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; }
.gh-comfort-aa { flex: 0 0 auto; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center;
  background: var(--gold); color: var(--ink-on-gold); font: 700 17px/1 var(--display); letter-spacing: -0.02em;
  box-shadow: 0 0 18px rgba(255,201,77,0.3); }
.gh-comfort-head h2 { margin: 0; flex: 1; font: 700 26px/1.1 var(--display); font-variation-settings: "SOFT" 100; color: var(--cream); }
.gh-comfort-x { flex: 0 0 auto; width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line-strong);
  background: var(--card-2); color: var(--cream); display: grid; place-items: center; padding: 0; }
.gh-comfort-x:hover { background: var(--violet); }
.gh-comfort-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.gh-row { width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; padding: 9px 12px 9px 10px;
  min-height: 60px; border-radius: 16px; border: 1px solid var(--line); background: var(--night-2); color: var(--cream);
  font: inherit; transition: background 160ms, border-color 160ms; }
.gh-row:hover { background: var(--card-2); }
.gh-row[aria-checked="true"] { border-color: rgba(255,201,77,0.45); }
.gh-ico { flex: 0 0 auto; width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center;
  background: var(--card); border: 1px solid var(--line); color: var(--mint); }
.gh-ico svg { display: block; }
.gh-ico .gh-a { font: 700 21px/1 var(--display); color: var(--mint); }
.gh-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.gh-txt b { font: 800 16px/1.25 var(--ui); color: var(--cream); }
.gh-txt small { font: 700 13px/1.3 var(--ui); color: var(--muted); }
.gh-txt small.gh-note { color: var(--mint); }
.gh-sw { flex: 0 0 auto; width: 48px; height: 28px; border-radius: 999px; position: relative;
  background: var(--night); border: 1px solid var(--line-strong); transition: background 160ms, border-color 160ms; }
.gh-sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
  background: var(--muted); transition: transform 200ms cubic-bezier(.3,1.4,.5,1), background 160ms; }
.gh-row[aria-checked="true"] .gh-sw { background: var(--gold); border-color: transparent; box-shadow: 0 0 12px rgba(255,201,77,0.3); }
.gh-row[aria-checked="true"] .gh-sw::after { transform: translateX(20px); background: var(--ink-on-gold); }
.gh-comfort-foot { margin-top: 14px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.gh-comfort-replay { min-height: 44px; padding: 8px 18px; border-radius: 14px; border: 1px solid var(--line-strong);
  background: var(--card-2); color: var(--cream); font: 800 15px var(--ui); display: inline-flex; align-items: center; gap: 8px; }
.gh-comfort-replay:hover { background: var(--violet); }
.gh-comfort-replay svg { color: var(--mint); }
.gh-comfort-about { margin: 0; padding-top: 12px; border-top: 1px solid var(--line); width: 100%; text-align: center;
  font: 650 15px/1.45 var(--display); font-variation-settings: "SOFT" 100; color: var(--muted); }
.gh-comfort-about em { font-style: italic; color: var(--gold); }
.gh-langrow { display: flex; align-items: center; gap: 12px; padding: 9px 12px 9px 10px; min-height: 60px; border-radius: 16px;
  border: 1px solid var(--line); background: var(--night-2); }
.gh-langrow label { flex: 1; font: 800 16px/1.25 var(--ui); color: var(--cream); }
.gh-langrow select { font: 800 15px var(--ui); color: var(--cream); background: var(--card-2); border: 1px solid var(--line-strong);
  border-radius: 12px; padding: 8px 10px; min-height: 40px; }
.gh-comfort select:focus-visible { outline: 3px solid var(--mint); outline-offset: 3px; }
.gh-comfort button:focus-visible { outline: 3px solid var(--mint); outline-offset: 3px; }
@media (max-width: 380px) {
  .gh-comfort-panel { padding: 14px 12px 16px; }
  .gh-row { gap: 10px; }
  .gh-ico { width: 34px; height: 34px; }
}
@keyframes gh-comfort-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes gh-comfort-rise { from { opacity: 0; transform: translateY(12px) scale(0.97); } to { opacity: 1; transform: none; } }
.gh-comfort.gh-still, .gh-comfort.gh-still * { animation: none !important; transition: none !important; }
@media (prefers-reduced-motion: reduce) {
  .gh-comfort, .gh-comfort * { animation: none !important; transition: none !important; }
}
`;

function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById("gh-settings")) return;
  const st = document.createElement("style");
  st.id = "gh-settings";
  st.textContent = CSS;
  document.head.appendChild(st);
}
ensureStyle();

// ------------------------------------------------------------ the "Aa" menu

const ICONS = {
  bigLetters: '<span class="gh-a" aria-hidden="true">A</span>',
  captions: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 6H5v12h3M16 6h3v12h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  reducedMotion: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 9c3-3 6 3 9 0s6-3 9 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".45"/><path d="M3 15h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  holdFree: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/></svg>',
};

const ROWS = [
  { key: "bigLetters", label: "Big letters", text: "Larger letters on the board." },
  { key: "captions", label: "Captions", text: "Short words for every sound." },
  { key: "reducedMotion", label: "Reduce motion", text: "Fewer sparkles, trails and wiggles." },
  { key: "holdFree", label: "Hold-free pad", text: "Tap the pad to aim your hand. Tap the middle to stop.", phoneOnly: true },
];

let menu = null; // { overlay, close }

const isPhoneish = () => {
  try {
    return document.getElementById("app")?.dataset.device === "phone" || matchMedia("(pointer: coarse)").matches;
  } catch { return false; }
};

const inRoom = () => {
  try { return document.getElementById("app")?.dataset.screen === "room"; } catch { return false; }
};

// Opens the Comfort panel. Options:
//   onReplayTutorial: () => void   shows the "Replay the tutorial" button (the panel closes first)
//   muted: boolean                 notes that captions are showing anyway while the sound is off
//   firstSeance: boolean           notes that captions are showing for the first seance (iOS default)
//   opener: HTMLElement            the Aa button (gets aria-expanded; focus back on close, except at the table)
//   showHoldFree: boolean          force the hold-free row on or off (default: phones only)
// Returns { close, el }. Calling it while open just focuses the panel.
export function openMenu({ onReplayTutorial = null, muted = false, firstSeance = false, opener = null, showHoldFree } = {}) {
  ensureStyle();
  if (menu) { menu.panel.focus(); return { close: menu.close, el: menu.overlay }; }
  const back = opener || document.activeElement;
  const still = settings.reducedMotion;
  const phone = showHoldFree ?? isPhoneish();

  const overlay = document.createElement("div");
  overlay.className = "gh-comfort" + (still ? " gh-still" : "");
  overlay.dataset.ghOverlay = "comfort";
  const rows = ROWS.filter((r) => !r.phoneOnly || phone).map((r) => `
      <li><button type="button" class="gh-row" role="switch" aria-checked="false" data-key="${r.key}">
        <span class="gh-ico">${ICONS[r.key]}</span>
        <span class="gh-txt"><b>${r.label}</b><small>${r.text}</small></span>
        <span class="gh-sw" aria-hidden="true"></span>
      </button></li>`).join("");
  overlay.innerHTML = `
    <div class="gh-comfort-panel" role="dialog" aria-modal="true" aria-labelledby="gh-comfort-title" tabindex="-1">
      <div class="gh-comfort-head">
        <span class="gh-comfort-aa" aria-hidden="true">Aa</span>
        <h2 id="gh-comfort-title">Comfort</h2>
        <button type="button" class="gh-comfort-x" aria-label="Close">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
        </button>
      </div>
      <ul class="gh-comfort-list">${rows}
        <li class="gh-langrow">
          <span class="gh-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></span>
          <label for="gh-lang">${t("lang.label")}</label>
          <select id="gh-lang">${LANGS.map((l) => `<option value="${l.id}" lang="${l.id === "hi" ? "hi" : "en"}"${l.id === getLang() ? " selected" : ""}>${l.name}</option>`).join("")}</select>
        </li>
      </ul>
      <div class="gh-comfort-foot">
        ${onReplayTutorial ? `<button type="button" class="gh-comfort-replay">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Replay the tutorial</button>` : ""}
        <p class="gh-comfort-about">Ghost Hand is a silent co-op game.<br><em>Push together. Don't talk.</em></p>
      </div>
    </div>`;
  const panel = overlay.querySelector(".gh-comfort-panel");

  const paint = () => {
    for (const b of overlay.querySelectorAll(".gh-row")) {
      const k = b.dataset.key;
      const on = !!settings[k];
      b.setAttribute("aria-checked", String(on));
      const small = b.querySelector("small");
      const base = ROWS.find((r) => r.key === k).text;
      let note = "";
      if (k === "captions" && !on && muted) note = "Showing for now, while the sound is off.";
      else if (k === "captions" && !on && firstSeance && !("captions" in chosen)) note = "Showing for your first seance.";
      if (k === "reducedMotion" && on && osReduced() && !("reducedMotion" in chosen)) note = "On because your device asks for it.";
      small.textContent = note || base;
      small.classList.toggle("gh-note", !!note);
    }
  };
  paint();
  const unsub = subscribe(() => paint());

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    unsub();
    removeEventListener("keydown", onKey, true);
    menu = null;
    if (opener) opener.setAttribute("aria-expanded", "false");
    const done = () => overlay.remove();
    if (settings.reducedMotion || still) done();
    else { overlay.classList.add("gh-closing"); setTimeout(done, 150); }
    // At the table, focus goes back to the page, not the Aa button: Space (rest) and Enter
    // on a focused Aa would just reopen the panel. Elsewhere it returns to the opener.
    try {
      if (inRoom()) { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }
      else if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
    } catch {}
  }

  const focusables = () => [...panel.querySelectorAll("button, select")].filter((b) => !b.disabled && b.offsetParent !== null);

  // Capture phase on window: the game's own keys (arrows push, Space rests, Esc lifts,
  // Enter starts) never see key presses while the panel is open.
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "Tab") {
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i === f.length - 1 ? 0 : i + 1);
      f[n].focus();
      e.stopPropagation();
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target?.tagName === "SELECT") { e.stopPropagation(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const f = focusables();
      const i = f.indexOf(document.activeElement);
      const n = e.key === "ArrowDown" ? Math.min(f.length - 1, i + 1) : Math.max(0, i - 1);
      if (f[n]) f[n].focus();
      e.preventDefault();
    }
    // Keep Space/Enter working on the focused button, but hide everything from the game.
    e.stopPropagation();
  }
  addEventListener("keydown", onKey, true);

  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) { e.preventDefault(); close(); } });
  overlay.querySelector(".gh-comfort-x").addEventListener("click", close);
  overlay.querySelector(".gh-comfort-list").addEventListener("click", (e) => {
    const b = e.target.closest(".gh-row");
    if (b) set(b.dataset.key, !settings[b.dataset.key]);
  });
  const langSel = overlay.querySelector("#gh-lang");
  langSel.addEventListener("change", () => {
    setLang(langSel.value);
    const lab = overlay.querySelector(".gh-langrow label");
    if (lab) lab.textContent = t("lang.label");
  });
  overlay.querySelector(".gh-comfort-replay")?.addEventListener("click", () => {
    close();
    try { onReplayTutorial(); } catch (err) { console.error(err); }
  });

  document.body.appendChild(overlay);
  if (opener) opener.setAttribute("aria-expanded", "true");
  menu = { overlay, panel, close };
  (overlay.querySelector(".gh-row") || panel).focus({ preventScroll: true });
  return { close, el: overlay };
}

export function closeMenu() { menu?.close(); }
export function isMenuOpen() { return !!menu; }
