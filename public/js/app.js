// Ghost Hand - the app: landing, lobby, pick, the seance and the reveal.
// The server decides everything; this file draws it, plays it and sends your hand.

import { BoardView, SEATS, HUMAN_ANGLES, SITTER_ANGLES, patternTile, mittenPoint } from "./render.js";
import { HandInput } from "./input.js";
import { Net, createRoom, roomInfo, dailyInfo } from "./net.js";
import { Attract } from "./attract.js";
import { TARGET_BY_KEY, keyOfIndex } from "./shared/board.js";
import { HUSH_LINES, TUTORIAL } from "./shared/content/hush-lines.js";
import { doodle } from "./doodles.js";
import { openSharePreview, closeSharePreview } from "./sharecard.js";
import { SeatStrip } from "./seatstrip.js";
import * as scrapbook from "./scrapbook.js";
import * as wardrobe from "./wardrobe.js";
import { settings, subscribe as onSettings, openMenu, closeMenu, isMenuOpen } from "./settings.js";
import { Captions } from "./captions.js";
import { PACKS as PACK_LIST } from "./shared/content/questions.js";
import { t, onLang, translateDom, STRINGS } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const app = $("app");
const stage = $("stage");
let reduced = settings.reducedMotion;
const view = new BoardView($("cv"), { reducedMotion: reduced, bigLetters: settings.bigLetters });
const input = new HandInput({ canvas: $("cv"), pad: $("pad"), thumb: $("thumb"), view });
const captions = new Captions($("captions"), { reducedMotion: reduced });
const strip = new SeatStrip($("seatstrip"), { reduced, onResize: () => layout() });
// Phases of a seance under way: the seat strip shows, and overlays opened on the reveal close.
// In reveal the strip would cost the sheet its last rows (laptops) or hides with the pad
// (phones), so there emotes float instead.
const SEANCE_PHASES = new Set(["warmup", "arrive", "pick", "whisper", "spell", "fill", "goodbye"]);
let stripAt = 0;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const PACKS = PACK_LIST.map(({ id, name }) => ({ id, name }));
const packName = (p) => (STRINGS[`pack.${p.id}`] ? t(`pack.${p.id}`) : p.name);
const CODE_RE = /^[BDFGHKLMNPRSTVZ][AEIOU][BDFGHKLMNPRSTVZ][AEIOU]$/;
// TV mode (/CODE?tv=1): a big-screen spectator view of a table. No pad, no personal controls.
const tv = new URLSearchParams(location.search).get("tv") === "1" && CODE_RE.test(location.pathname.replace(/^\/+|\/+$/g, "").toUpperCase());
if (tv) app.dataset.tv = "1";
// Server twist lines (Hush flavour, kept in English) for a reconnect that missed the event.
const TWIST_LINES = { whisper: "Hush keeps this one secret.", gust: "Hush is feeling breezy tonight." };
// Tutorial instructions, in the player's language (the English originals live in hush-lines.js).
const TL = {
  lead: () => t("tut.lead"), follow1: () => t("tut.follow1"), filled: () => t("tut.filled"),
  pointLaptop: () => t("tut.pointLaptop"), liftPhone: () => t("tut.liftPhone"),
  rest: (d) => t(d === "phone" ? "tut.restPhone" : "tut.restLaptop"),
};
const local = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const DEG = Math.PI / 180;

// ------------------------------------------------------------ state

let hush = null, hushBig = null, sound = null, pickHush = null, revealHush = null, hushMod = null;
let director = null;          // HushDirector: moves and emotes the board's Hush
let screen = "landing";
let attract = new Attract((Date.now() & 0xffff) + 1);
let net = null, code = null;
let S = null;                 // last state from the server
let you = null;               // { seat, name, colour, host }
let phase = "";
let myTarget = null;          // the knower's next letter (only the knower gets it)
let openGlow = null;          // a letter glowing for everyone
let hint = { step: 0, letter: null };
let standIn = false;
let ribbon = { key: "", slots: [], warm: null };
let curSlot = -1;
let curPrompt = "";
let curKnower = null;
let pickState = null;
let revealData = null;
let revealTimers = [];
let arriveTimers = [];        // Hush's arrive lines; cleared when the phase moves on or we leave
let celebrateTimer = 0;       // the wardrobe find card (outlives "Another cup", not leaving)
let wardrobeUi = null;        // the open wardrobe picker's handle, if any
let lastSample = null;
let unlocked = false;
let lobbySince = 0;
let startFillSince = 0;
let wasTutorial = false;
let rested = false;
let fastWarned = false;
let lastBubbleAt = 0;
let breakawaysThisSeance = 0;
let disconnected = false;
let lastIn = null, lastInAt = 0;
let lastFrame = performance.now();
let landingHoverSince = 0;
let wordIdxSeen = -1;
let curHushed = false;        // whisper twist: the follower's clue is still hidden
let twistNow = null;          // { twist, name, line } from this seance's "twist" event
let gustDir = null;           // { dx, dy } of the current word's gust
let lastWindAt = 0;
let inkSeq = 0;               // bumps on every ink: one near-miss gasp per letter
let nearMiss = { id: "", armed: false, done: false };
let lastCheerAt = 0;
let dailyQ = null, dailyAt = 0;

const seatById = () => new Map((S?.seats || []).map((s) => [s.id, s]));
const seatName = (id) => seatById().get(id)?.name || (id === 7 ? "Nani" : id === 8 ? "Bram" : t("play.someone"));
const seatColour = (id) => {
  const s = seatById().get(id);
  if (!s || s.kind !== "human") return "#C9C2D6";
  return SEATS[s.colour % 6].hex;
};
const isPhone = () => !tv && matchMedia("(pointer: coarse)").matches && Math.min(innerWidth, innerHeight) < 600;
const device = () => (isPhone() ? "phone" : "laptop");

// ------------------------------------------------------------ boot

async function boot() {
  // Submission cover (spec 8.12): /?cover, plus &clean for a bare frame, &safe to outline the safe area.
  if (new URLSearchParams(location.search).has("cover")) {
    try {
      const { renderCover } = await import("./cover.js");
      await renderCover(document.body);
    } catch (e) { console.error("cover", e); }
    return;
  }
  const [hm, am, dm] = await Promise.all([
    import("./hush.js").catch(() => null),
    import("./audio.js").catch(() => null),
    import("./hush-director.js").catch(() => null),
  ]);
  hushMod = hm;
  if (am?.Sound) sound = new am.Sound();
  onSettings(applySettings, { immediate: true });
  if (hm?.createHush) {
    hush = hm.createHush($("hushspot"), { size: 72, peek: true });
    hushBig = hm.createHush($("hushspot"), { size: 140 });
    hushBig.el.style.display = "none";
    pickHush = hm.createHush($("pickhush"), { size: 120 });
    revealHush = hm.createHush($("revealhush"), { size: 110 });
    if (dm?.HushDirector) {
      try { director = new dm.HushDirector({ spot: $("hushspot"), peek: hush, big: hushBig, reduced }); }
      catch (e) { console.error("director", e); director = null; }
    }
  }
  wardrobe.applyTo([hush, hushBig, pickHush, revealHush]);
  $("mute").classList.toggle("muted", !!sound?.muted);
  wireUi();
  translateUi();
  onLang(onLangChange);
  addEventListener("resize", layout);
  visualViewport?.addEventListener("resize", layout);
  document.fonts?.load("650 26px Fraunces").then(layout).catch(() => {});
  setTimeout(layout, 1500);

  const path = location.pathname.replace(/^\/+|\/+$/g, "").toUpperCase();
  if (CODE_RE.test(path)) enterRoom(path, { fromLink: true });
  else showLanding();
  layout();
  requestAnimationFrame(frame);
}

function showLanding() {
  screen = "landing";
  app.dataset.screen = "landing";
  $("landing").hidden = false;
  $("lobby").hidden = true;
  $("pick").hidden = true;
  $("reveal").hidden = true;
  $("roomchip").hidden = true;
  $("adddevice").hidden = true;
  $("tvcorner").hidden = true;
  renderSoloBtn();
  refreshScrapbookBtn();
  loadDaily();
  // Nothing from the room follows us home: its timers, overlays, bubble and big Hush.
  clearRevealTimers();
  clearArriveTimers();
  clearTimeout(celebrateTimer);
  replayState = null;
  closeOverlays();
  clearTimeout(bubbleTimer);
  $("bubble").classList.remove("show");
  phase = "";
  app.dataset.phase = "";
  strip.setVisible(false);
  strip.reset();
  expr("idle");
  director?.tickIdle(performance.now(), { active: false }); // landingFrame never ticks the idle clock
  setLine("");
  layout(); // on the landing Hush always settles back to peeking
}

// Full-screen overlays a player may have opened over the room. Each close restores #app's inert.
function closeOverlays() {
  if (wardrobeUi) { wardrobeUi.close(); wardrobeUi = null; }
  if (scrapbook.isOpen()) scrapbook.close();
  if (isMenuOpen()) closeMenu();
  closeSharePreview();
}

function renderSoloBtn() {
  $("solo").innerHTML = local.get("gh.tutorialDone") ? esc(t("landing.playSolo")) : `${esc(t("landing.trySolo"))} <span class="soft">${esc(t("landing.oneMin"))}</span>`;
}

// ------------------------------------------------------------ today's question (landing chip)

async function loadDaily() {
  if (dailyAt && Date.now() - dailyAt < 10 * 60 * 1000) { renderDailyChip(); return; }
  dailyAt = Date.now();
  const d = await dailyInfo(); // null on any error: the chip just stays hidden
  if (d) dailyQ = d;
  renderDailyChip();
}
function renderDailyChip() {
  const b = $("dailychip");
  if (!b) return;
  const show = !!dailyQ && screen === "landing";
  if (!show) { b.hidden = true; return; }
  const n = dailyQ.stats?.tables | 0;
  const meta = n ? (n === 1 ? t("daily.oneTable") : t("daily.tables", { n })) : "";
  b.innerHTML = `<span class="dq">${esc(t("daily.chip", { ask: dailyQ.ask }))}</span>${meta ? `<span class="dn"> · ${esc(meta)}</span>` : ""}`;
  b.setAttribute("aria-label", `${t("daily.play")}: ${dailyQ.ask}${meta ? `. ${meta}` : ""}`);
  const was = b.hidden;
  b.hidden = false;
  if (was) layout();
}
async function startDaily() {
  try { enterRoom(await createRoom("solo", dailyQ?.pack || "cozy", { daily: true })); }
  catch { $("codeerr").textContent = t("landing.noServer"); }
}

// ------------------------------------------------------------ language

function translateUi() {
  translateDom(document);
  $("codeform").querySelectorAll("input").forEach((inp, i) => inp.setAttribute("aria-label", t("landing.codeLetter", { n: i + 1 })));
  renderSoloBtn();
  refreshScrapbookBtn();
  renderDailyChip();
}
function onLangChange() {
  translateUi();
  if (screen === "room") {
    if (phase === "lobby") renderLobby();
    renderBanner();
    renderTvCorner();
    if (phase === "reveal" && revealData) { renderRevealResult(revealData); renderRevealBadges(revealData); }
  }
  setLine(""); // updateLine puts the right instruction back, in the new language
  layout();
}

// A screen reader hears this (polite): each inked letter, the twists, the finished sentence.
let announceTimer = 0;
function announce(text) {
  const el = $("announce");
  if (!el || !text) return;
  el.textContent = "";
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { el.textContent = text; }, 40);
}

function refreshScrapbookBtn() {
  const n = scrapbook.badge();
  const b = $("scrapbookbtn");
  if (!b) return;
  b.hidden = n === 0;
  b.textContent = t("landing.scrapbookCount", { n });
}
function openScrapbook() {
  unlockAudio();
  const fromLanding = screen === "landing";
  // From the landing an empty book offers "Play solo"; from inside a room it never does.
  scrapbook.open(fromLanding ? { onClose: refreshScrapbookBtn, onPlay: () => startSolo() } : { onClose: refreshScrapbookBtn });
}
function openWardrobe() {
  unlockAudio();
  wardrobeUi?.close(); // idempotent: a picker closed by its own X just ignores this
  wardrobeUi = wardrobe.openPicker({ hushFactory: hushMod?.createHush, sound, onChange: () => wardrobe.applyTo() }) || null;
}

// ------------------------------------------------------------ comfort settings and captions

// The player's own Captions choice (saved by settings.js only once they touch the switch).
function captionsChosen() {
  try { return typeof JSON.parse(local.get("gh.settings") || "{}")?.captions === "boolean"; } catch { return false; }
}
// Spec 8.11: on iOS captions start on for the first seance only, and never over an explicit choice.
const iosFirstSeance = () => isIOS && !local.get("gh.firstSeanceDone") && !captionsChosen();
function syncCaptions() {
  const iosFirst = iosFirstSeance();
  captions.setEnabled(settings.captions || !!sound?.muted || iosFirst);
}
function applySettings(s) {
  reduced = !!s.reducedMotion;
  view.reduced = reduced;
  app.classList.toggle("reduce-motion", reduced);
  captions.setReducedMotion(reduced);
  strip.reduced = reduced;
  strip.root.classList.toggle("gss-reduced", reduced);
  if (director) director.reduced = reduced;
  view.setBigLetters(!!s.bigLetters);
  input.setHoldFree(!!s.holdFree);
  syncCaptions();
}
function replayTutorial() {
  const go = () => {
    local.set("gh.tutorialDone", "");
    if (screen === "room") { net?.close(); net = null; history.pushState(null, "", "/"); }
    startSolo();
  };
  if (screen === "room" && !["lobby", "reveal", ""].includes(phase)) dialog(t("tut.replayAsk"), [[t("tut.replay"), go]]);
  else go();
}

// ------------------------------------------------------------ layout

let box = { x: 0, y: 0, w: 1, h: 1 };

function layout() {
  const phone = isPhone();
  app.dataset.device = phone ? "phone" : "laptop";
  // Seat strip: under the stage on laptops, inside the pad (left of the knock button) on phones.
  const ss = $("seatstrip");
  if (phone) { if (ss.parentNode !== $("pad")) $("pad").insertBefore(ss, $("knock")); }
  else if (ss.parentNode !== app) app.insertBefore(ss, $("pad"));
  const vh =visualViewport ? visualViewport.height : innerHeight;
  const vw = innerWidth;
  const lobby = screen === "room" && phase === "lobby";
  // Phones: the pad hides during reveal (app.css) so the sheet gets the whole height.
  if (phone && screen === "room" && phase !== "reveal") {
    const margin = vw < 360 ? 10 : 12;
    const top = 52 + 40;
    const boardW = Math.min(vw - 2 * margin, (vh - top - 150 - 16) / 0.9, 560);
    // In the lobby the pad shrinks, so the table card and the board both fit above it.
    const padH = lobby ? 150 : Math.max(150, vh - top - boardW * 0.9 - 22);
    $("pad").style.height = `${padH}px`;
  }
  const r = stage.getBoundingClientRect();
  const W = r.width, H = r.height;
  let rect;
  const landing = screen === "landing";
  const wide = W > H * 1.25 && W > 820;
  const Lb = $("lobby");
  let cardH = 0;
  if (lobby && !wide) {
    // Stack: the table card on top, the board in the space below it.
    Lb.style.left = "50%";
    Lb.style.transform = "translateX(-50%)";
    Lb.style.width = `${Math.min(W - 12, 560)}px`;
    Lb.style.top = "4px";
    Lb.style.maxHeight = "";
    cardH = Lb.querySelector(".lobbycard").offsetHeight || 0;
  }
  const L = $("landing");
  if (landing && wide) rect = { x: 16, y: 8, w: W * 0.6, h: H - 16 };
  else if (landing) {
    // Under the board: shrink the board on short screens so the whole CTA (down to the
    // Scrapbook / wardrobe links) still fits above the bottom edge.
    L.style.top = "0"; L.style.bottom = "auto";
    const need = L.offsetHeight || 0;
    rect = { x: 10, y: 4, w: W - 20, h: Math.max(160, Math.min(H * 0.56, H - need - 14)) };
  }
  else if (lobby && wide) rect = { x: 16, y: 8, w: W - 420 - 32, h: H - 16 };
  else if (lobby) rect = { x: 8, y: cardH + 14, w: W - 16, h: Math.max(120, H - cardH - 18) };
  else if (phone) rect = { x: 8, y: 2, w: W - 16, h: H - 4 };
  else rect = { x: 24, y: 6, w: W - 48, h: H - 12 };
  view.resize(W, H, rect);
  box = view.boardRect();
  lastCardH = cardH;

  // Landing CTA beside or under the board.
  if (wide) { L.style.left = `${box.x + box.w + 16}px`; L.style.right = "16px"; L.style.top = "0"; L.style.bottom = "0"; L.style.justifyContent = "center"; }
  else { L.style.left = "0"; L.style.right = "0"; L.style.top = `${box.y + box.h + 6}px`; L.style.bottom = "auto"; L.style.justifyContent = "flex-start"; }

  // Lobby card beside the board on wide screens.
  if (wide) { Lb.style.transform = ""; Lb.style.left = `${box.x + box.w + 16}px`; Lb.style.width = "400px"; Lb.style.top = "8px"; Lb.style.maxHeight = `${H - 16}px`; }

  placeHush(landing ? "peek" : undefined);
}
let lastCardH = 0;
// Re-fit when the lobby card changes height (people joining, host controls appearing).
function refitLobby() {
  if (screen !== "room" || phase !== "lobby") return;
  const h = $("lobby").querySelector(".lobbycard").offsetHeight || 0;
  if (Math.abs(h - lastCardH) > 2) layout();
}

// app.js decides where Hush belongs; the director (when loaded) decides how it gets there.
let hushMode = "peek";
function hushSpot(mode) {
  if (mode === "big") {
    const size = Math.round(Math.min(150, box.w * 0.22));
    return { size, left: box.x + box.w / 2 - size / 2, top: box.y + box.h * 0.18 };
  }
  const size = Math.round(Math.max(52, Math.min(80, box.w * 0.1)));
  // In a laptop room the role banner (and its clue line) sits right above the board's top centre,
  // so Hush peeks over the top edge off to the right instead.
  const across = screen === "room" && app.dataset.device === "laptop" ? 0.82 : 0.5;
  return { size, left: box.x + box.w * across - size / 2, top: Math.max(-size * 0.2, box.y - size * 0.55) };
}
function placeHush(mode = hushMode, how) {
  const changed = mode !== hushMode;
  hushMode = mode;
  const spot = hushSpot(mode);
  if (director) {
    if (how === "fly") director.flyIn(spot);
    else if (changed && mode === "peek") director.settle(spot);
    else director.moveTo(spot, { mode, how: how || "glide" }); // a no-op when nothing changed
  } else {
    const el = $("hushspot");
    el.style.left = `${spot.left}px`; el.style.top = `${spot.top}px`; el.style.width = `${spot.size}px`;
    const active = mode === "big" ? hushBig : hush, other = mode === "big" ? hush : hushBig;
    active?.setSize(spot.size);
    if (active) active.el.style.display = "";
    if (other) other.el.style.display = "none";
  }
  positionBubble();
}

// The bubble hangs under Hush, its tail pointing at Hush, and stays inside the stage.
function positionBubble() {
  const b = $("bubble");
  const spot = hushSpot(hushMode);
  const cx = spot.left + spot.size / 2;
  b.style.left = "0px"; // measure at full width before placing
  const w = b.offsetWidth, sw = stage.clientWidth;
  const left = Math.max(8, Math.min(sw - w - 8, cx - w / 2));
  b.style.left = `${left}px`;
  b.style.top = `${spot.top + spot.size * (hushMode === "big" ? 1.08 : 1.0) + 6}px`;
  b.style.setProperty("--tail", `${Math.max(20, Math.min(w - 20, cx - left))}px`);
}

// ------------------------------------------------------------ words on screen

let lineText = "";
function setLine(text) {
  if (text === lineText) return;
  lineText = text;
  const el = $("line");
  if (text) { el.textContent = text; el.classList.add("show"); } else el.classList.remove("show");
}

let toastTimer = 0;
function toast(text, ms = 2200) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

let bubbleTimer = 0;
// Hush says something: a bubble plus a hummed voice line.
function say(text, { big = false, ms = 2600, question = false, voice = true } = {}) {
  if (!text) return;
  const b = $("bubble");
  b.textContent = text;
  b.classList.toggle("big", big);
  positionBubble();
  b.classList.add("show");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => b.classList.remove("show"), ms);
  lastBubbleAt = performance.now();
  if (voice) {
    sound?.hushVoice(text, { question });
    captions.say(question ? t("cap.humQuestion") : t("cap.hum"), 1400, { gap: 4000, key: "hum" });
  }
}
// Flavour lines are rare, so they stay charming.
function flavour(key, chance = 1) {
  if (performance.now() - lastBubbleAt < 5000 || Math.random() > chance) return;
  const lines = HUSH_LINES[key];
  if (lines?.length) say(pick(lines), { ms: 2000 });
}

function activeHush() {
  return director ? director.active : hushMode === "big" ? hushBig : hush;
}

function expr(name, back = 0) {
  if (director) { director.express(name, { back }); return; }
  for (const h of [hush, hushBig]) h?.setExpression(name);
  if (back) setTimeout(() => { for (const h of [hush, hushBig]) h?.setExpression("idle"); }, back);
}

// ------------------------------------------------------------ room

async function enterRoom(c, { fromLink = false } = {}) {
  if (fromLink) {
    const info = await roomInfo(c);
    if (!info.exists) {
      showLanding();
      history.replaceState(null, "", "/");
      $("codeerr").textContent = t("landing.seanceEnded");
      return;
    }
  }
  code = c;
  if (location.pathname !== `/${c}`) history.pushState(null, "", `/${c}${tv ? "?tv=1" : ""}`);
  screen = "room";
  app.dataset.screen = "room";
  $("landing").hidden = true;
  $("dailychip").hidden = true;
  $("roomchip").hidden = false;
  $("roomchip").textContent = c;
  resetRoomState();
  net?.close();
  let recent = [];
  try { recent = JSON.parse(local.get("gh.recentQ") || "[]"); } catch {}
  net = new Net(c, { device: device(), recentQ: recent, want: tv ? "watch" : "seat" });
  net.addEventListener("welcome", (e) => onWelcome(e.detail));
  net.addEventListener("state", (e) => onState(e.detail));
  net.addEventListener("ev", (e) => onEv(e.detail));
  net.addEventListener("pickq", (e) => onPickq(e.detail));
  net.addEventListener("whisper", (e) => onWhisper(e.detail));
  net.addEventListener("status", (e) => { disconnected = !e.detail.connected; if (e.detail.code === 4004) roomGone(); });
  net.addEventListener("err", (e) => onErr(e.detail));
  net.addEventListener("dupe", () => dialog(t("dialog.dupe"), [[t("dialog.sitHere"), () => net.send({ t: "takeover" })]]));
  net.addEventListener("moved", () => dialog(t("dialog.moved"), [[t("dialog.backHome"), () => { location.href = "/"; }]]));
  net.addEventListener("reload", () => dialog(t("dialog.fresher"), [[t("dialog.reload"), () => location.reload()]]));
  net.connect();
  layout();
}

function resetRoomState() {
  S = null; you = null; phase = ""; myTarget = null; openGlow = null; hint = { step: 0, letter: null };
  ribbon = { key: "", slots: [], warm: null }; curSlot = -1; pickState = null; revealData = null;
  wordIdxSeen = -1;
  curHushed = false; curPrompt = ""; twistNow = null; gustDir = null;
  strip.reset();
  director?.tickIdle(performance.now(), { active: false }); // no idle time carried in from before
  $("ribbon").innerHTML = "";
  view.clearTrail();
}

function roomGone() {
  net?.close();
  net = null;
  history.replaceState(null, "", "/");
  showLanding();
  $("codeerr").textContent = t("landing.seanceEnded");
}

function onErr(m) {
  if (m.code === "no-room") return roomGone();
  dialog(m.msg || t("dialog.wrong"), [[t("dialog.startOwn"), () => startTable()]]);
}

function onWelcome(m) {
  if (m.watching) { if (!tv) toast(t("lobby.tableFull"), 4000); return; }
  you = m.you;
}

function onState(st) {
  S = st;
  if (st.you != null && you) you.seat = st.you;
  if (st.tutorial) wasTutorial = true;
  if (st.code) $("roomchip").textContent = st.code;
  $("adddevice").hidden = st.mode !== "solo";
  syncRibbon(st);
  syncClue(st);
  enterPhase(st.phase);
  renderTvCorner();
  if (phase === "lobby") renderLobby();
  renderBanner();
}

// The current word's clue from the state (a reconnect, or a state ahead of its events).
function syncClue(st) {
  const sc = st.seance;
  if (!sc || sc.warmup || !(sc.wordIdx >= 0) || curSlot !== sc.wordIdx) return;
  const cs = sc.slots?.[sc.wordIdx];
  if (!cs) return;
  if (cs.prompt && !curPrompt) curPrompt = cs.prompt;
  curHushed = !!cs.hushed && !curPrompt;
}

// TV mode: the code and a QR, big, in the corner (the lobby card has them in the lobby).
function renderTvCorner() {
  const c = $("tvcorner");
  const show = tv && screen === "room" && !!code && phase !== "lobby";
  c.hidden = !show;
  if (!show) return;
  const tc = $("tvcode");
  if (tc.dataset.code !== code) { tc.dataset.code = code; tc.innerHTML = [...code].map((ch) => `<span>${ch}</span>`).join(""); }
  tc.setAttribute("aria-label", `${t("lobby.tableCode")}: ${code.split("").join(" ")}`);
  drawQR($("tvqr"), roomUrl());
  $("tvjoin").textContent = t("tv.join", { url: roomUrl().replace(/^https?:\/\//, "") });
}

// ------------------------------------------------------------ phases

function enterPhase(p) {
  if (p === phase) return;
  const prev = phase;
  phase = p;
  app.dataset.phase = p;
  strip.setVisible(screen === "room" && SEANCE_PHASES.has(p));
  $("lobby").hidden = p !== "lobby";
  if (p !== "pick") $("pick").hidden = true;
  if (p !== "reveal") { $("reveal").hidden = true; clearRevealTimers(); }
  if (p !== "arrive") clearArriveTimers();
  // A new seance starting (or its pick deadline): nothing the player opened on the reveal may sit
  // over (and inert) the pick cards or the board. A "close the book" vote back to the lobby, or
  // the Aa menu opened mid-spell, are left be.
  if (SEANCE_PHASES.has(p) && (!SEANCE_PHASES.has(prev) || p === "pick")) closeOverlays();
  input.enabled = !tv;
  // Fit the board first, so Hush is placed on this phase's board rect.
  layout();
  switch (p) {
    case "lobby":
      lobbySince = performance.now();
      placeHush("peek");
      expr("idle");
      break;
    case "warmup":
      placeHush("peek");
      director?.tickIdle(performance.now(), { active: false }); // a fresh idle clock for dozing
      say(t("play.sayHiLong"), { ms: 3200 });
      break;
    case "arrive": {
      myTarget = null; openGlow = null; hint = { step: 0, letter: null }; standIn = false;
      breakawaysThisSeance = 0;
      twistNow = null; gustDir = null; curHushed = false;
      view.clearTrail();
      syncCaptions();
      placeHush("big", "fly");
      if (!director) expr("curious");
      const ask = S?.seance?.ask || "";
      arriveLater(director && !reduced ? 700 : 350, () => say(ask, { big: true, ms: 2900, question: true }));
      if ((S?.seanceIndex || 0) === 0 && !S?.tutorial) arriveLater(2600, () => say(pick(HUSH_LINES.silence) || "Shh. No talking.", { ms: 2400 }));
      if (S?.seance?.ask) rememberQuestion();
      break;
    }
    case "pick":
      placeHush("peek");
      expr("whisper");
      // Spectators (TV) never get the pick sheet: Hush says the twist on the board instead.
      if (tv && S?.seance?.twist) {
        const tw = S.seance.twist;
        say(twistNow?.line || TWIST_LINES[tw] || "", { ms: 2800 });
        twistMoment(tw);
      }
      break;
    case "whisper":
      placeHush("peek");
      break;
    case "spell":
      placeHush("peek");
      director?.tickIdle(performance.now(), { active: false });
      break;
    case "goodbye":
      if (director) director.goodbye(); else expr("delighted");
      break;
    case "reveal":
      break;
  }
}

function clearArriveTimers() { arriveTimers.forEach(clearTimeout); arriveTimers = []; }
// Arrive lines only play while this room is still arriving.
function arriveLater(ms, fn) {
  const room = code;
  arriveTimers.push(setTimeout(() => { if (screen === "room" && phase === "arrive" && code === room) fn(); }, ms));
}

// Remember recent questions so a returning visitor hears new ones.
function rememberQuestion() {
  const id = S?.seance?.qId;
  if (!id) return;
  let list = [];
  try { list = JSON.parse(local.get("gh.recentQ") || "[]"); } catch {}
  if (!list.includes(id)) local.set("gh.recentQ", JSON.stringify([id, ...list].slice(0, 40)));
}

// ------------------------------------------------------------ events (fired on the shared render clock)

function onEv(e) {
  switch (e.k) {
    case "seat":
      if (e.a === "join" && e.seat !== you?.seat) {
        sound?.joinPop(e.colour ?? 0); flavour("join", 0.6); toast(t("lobby.satDown", { name: e.name }));
        captions.say(t("cap.join", { name: e.name }));
      }
      if (e.a === "picked") markPicked(e.seat, e.slot);
      break;
    case "phase":
      // Clear a leftover whisper or shh face, but not the cheer/foresight that hushFill or the
      // last ink started in this same frame: delight goes back to idle by itself.
      if (e.name === "fill" && activeHush()?.el?.dataset.expr !== "delighted") expr("idle");
      break;
    case "wordStart":
      curSlot = e.slot;
      curPrompt = e.prompt || "";
      curHushed = !!e.hushed && !curPrompt;
      gustDir = null;
      curKnower = e.knower;
      myTarget = null; openGlow = null; hint = { step: 0, letter: null }; fastWarned = false;
      {
        const toMe = e.knower === you?.seat;
        if (director) {
          const ks = seatById().get(e.knower);
          const ang = ks?.kind === "human" ? HUMAN_ANGLES[ks.colour % 6] : (SITTER_ANGLES[e.knower] ?? 270);
          director.whisper({ toMe, side: ang > 90 && ang < 270 ? "left" : "right" });
        } else expr(toMe ? "whisper" : "curious", toMe ? 1400 : 1200);
        if (toMe && (S?.tutorial || wasTutorial)) setLine(TL.lead());
      }
      renderRibbon();
      renderBanner();
      break;
    case "target":
      myTarget = e.letter;
      break;
    case "glow":
      openGlow = e.letter;
      break;
    case "breakaway":
      if (lastSample) view.breakaway(lastSample.x, lastSample.y);
      sound?.catchSound();
      if (++breakawaysThisSeance === 1) flavour("breakaway", 0.7);
      if (director) director.react("breakaway"); else expr("curious", 600);
      captions.say(t("cap.breakaway"));
      break;
    case "ink": onInk(e); break;
    case "wobble":
      view.wobble(e.ch);
      sound?.wrongSound();
      if (director) director.puzzle(); else expr("puzzled", 1300);
      captions.say(t("cap.wobble"));
      flavour("wobble", 0.5);
      break;
    case "hint":
      hint = { step: e.step, letter: e.letter };
      if (e.step === 1 && (S?.tutorial) && curKnower === 7) setLine(TL.follow1());
      if (e.step === 3 && lastSample) {
        view.gust(lastSample.x, lastSample.y - 120, e.letter);
        flavour("help", 1);
        if (director) { const [hx, hy] = view.toScreen(lastSample.x, lastSample.y); director.blow({ x: hx, y: hy }); }
        else expr("shh", 1500);
        captions.say(t("cap.gust"));
      }
      break;
    case "hushHelp":
      standIn = e.on;
      if (e.on) toast(t("play.hushHelping", { name: seatName(curKnower) }), 3000);
      break;
    case "hushFill": onHushFill(e); break;
    case "wordDone": {
      const sl = ribbon.slots[e.slot];
      if (sl) { sl.word = e.word; sl.done = true; }
      renderRibbon();
      break;
    }
    case "reveal": showReveal(e); break;
    case "knock":
      sound?.tok(); setTimeout(() => sound?.tok(), 90);
      if (!strip.knock(e.seat)) toast(t("play.knockFrom", { name: seatName(e.seat) }), 1400);
      captions.say(t("cap.knock", { name: seatName(e.seat) }));
      break;
    case "emote":
      if (!strip.emote(e.seat, e.e)) floatEmote(e.e);
      if (phase === "reveal" && (e.e === "laugh" || e.e === "heart")) hushCheer();
      break;
    case "vote": $("votes").textContent = e.again ? t("reveal.wantAgain", { n: e.again }) : ""; break;
    case "twist": onTwist(e); break;
    case "clue":
      if (e.slot === curSlot) { curPrompt = e.prompt || ""; curHushed = false; renderBanner(); }
      if (e.prompt) {
        captions.say(t("cap.clue", { prompt: e.prompt }), 2400);
        if (ribbon.slots[e.slot]?.seat !== you?.seat) announce(t("play.theirWord", { prompt: e.prompt }));
      }
      break;
    case "gust": onGust(e); break;
    case "host": break;
  }
}

// A seance with a twist starts: Hush shows it off for a moment (the line also sits on the pick sheet).
function onTwist(e) {
  twistNow = { twist: e.twist, name: e.name, line: e.line || TWIST_LINES[e.twist] || "" };
  captions.say(t("cap.twist", { line: twistNow.line }), 2800);
  announce(`${e.name || ""} · ${t(`twist.${e.twist}`)}. ${twistNow.line}`);
  renderBanner();
  if (!$("pick").hidden) renderPickTwist();
}
function twistMoment(kind) {
  if (kind === "gust") { if (director) director.blow("right"); else expr("shh", 1500); }
  else if (director) director.express("shh", { back: 1600 }); else expr("shh", 1600);
}
// Gust twist: a sideways breath across the planchette, from the board's Hush.
function onGust(e) {
  gustDir = { dx: e.dx || 0, dy: e.dy || 0 };
  if (lastSample) view.wind(lastSample.x, lastSample.y, gustDir.dx, gustDir.dy);
  lastWindAt = performance.now();
  if (director) director.blow(Math.atan2(gustDir.dy, gustDir.dx)); else expr("shh", 1200);
  captions.say(t("cap.gustWind"), 1800);
}
function hushCheer() {
  const now = performance.now();
  if (now - lastCheerAt < 900) return;
  lastCheerAt = now;
  revealHush?.setExpression("delighted");
  director?.cheer();
}
// A near miss: the planchette rushes past the letter (within 60 bu, over 120 bu/s) and on
// without settling there. Hush gasps, once per letter.
function checkNearMiss(s) {
  if (phase !== "spell" || !s) { nearMiss.armed = false; return; }
  const key = myTarget || openGlow || (hint.step >= 2 ? hint.letter : null);
  const T = key && TARGET_BY_KEY[key];
  if (!T) { nearMiss.armed = false; return; }
  const id = `${curSlot}:${key}:${inkSeq}`;
  if (nearMiss.id !== id) nearMiss = { id, armed: false, done: false };
  if (nearMiss.done) return;
  const d = Math.hypot(T.x - s.x, T.y - s.y);
  if (!nearMiss.armed) {
    if (d < 60 && Math.hypot(s.vx, s.vy) > 120 && !s.captured) nearMiss.armed = true;
  } else if (s.captured || (s.dwellL >= 0 && keyOfIndex(s.dwellL) === key)) {
    nearMiss.done = true; // it is settling in there: not a miss
  } else if (d > 90) {
    nearMiss.done = true;
    if (director) director.react("breakaway"); else expr("curious", 700);
    captions.say(t("cap.gasp"), 1400, { gap: 4000, key: "gasp" });
  }
}

function onInk(e) {
  const tgt = TARGET_BY_KEY[e.ch];
  let hex = "#FFC94D";
  if (e.warm) {
    ribbon.warm = ribbon.warm || { inked: [] };
    ribbon.warm.inked[e.idx] = e.ch;
    flyLetter(e.ch, "warm", e.idx);
  } else if (e.slot != null) {
    const sl = ribbon.slots[e.slot];
    if (sl) {
      sl.inked[e.idx] = e.ch;
      sl.pending.add(e.idx);
      hex = seatColour(sl.seat);
      flyLetter(e.ch, e.slot, e.idx);
    }
  }
  view.ink(e.ch, hex, !!e.fs);
  sound?.letterNote(e.note ?? 0);
  sound?.tok();
  captions.say(t("cap.ink", { ch: e.ch && e.ch.length === 1 ? e.ch : t("cap.letter") }));
  inkSeq++;
  if (e.ch) announce(t("a11y.inked", { ch: e.ch }));
  try { navigator.vibrate?.(12); } catch {}
  if (e.fs) {
    say(pick(HUSH_LINES.foresight) || "The table knew...", { ms: 1800 });
    if (director) director.react("foresight"); else expr("delighted");
  }
  myTarget = null; openGlow = null; hint = { step: 0, letter: null };
  if (S?.tutorial && lineText === TL.follow1()) setLine("");
  renderBanner();
  void tgt;
}

function onHushFill(e) {
  const sl = ribbon.slots[e.slot];
  if (!sl) return;
  captions.say(t("cap.fill"), 2000);
  if (director) director.cheer(); else expr("delighted");
  e.letters.forEach((ch, i) => {
    setTimeout(() => {
      sl.filled[i] = ch;
      sl.newSmoke = i;
      renderRibbon();
      sound?.letterNote((e.note ?? 0) + i + 1);
    }, 110 * i);
  });
  if (S?.tutorial && !local.get("gh.filledSeen")) { local.set("gh.filledSeen", "1"); setTimeout(() => toast(TL.filled(), 2200), 200); }
}

function onWhisper(m) {
  const sl = ribbon.slots[m.slot];
  if (sl) { sl.word = m.word; sl.mine = true; }
  renderRibbon();
  renderBanner();
}

// ------------------------------------------------------------ ribbon (the sentence being built)

function syncRibbon(st) {
  const sc = st.seance;
  if (!sc) { ribbon = { key: "", slots: [], warm: null }; renderRibbon(); return; }
  if (sc.warmup) {
    const key = "warm";
    if (ribbon.key !== key) ribbon = { key, slots: [], warm: { inked: [] } };
    renderRibbon();
    return;
  }
  const key = `${st.seanceIndex}|${sc.ask}|${sc.slotCount}`;
  if (ribbon.key !== key) {
    ribbon = { key, warm: null, slots: sc.slots.map((s) => ({ i: s.i, seat: s.seat, len: s.len, quota: s.quota, inked: [], filled: [], pending: new Set(), word: null, done: false, mine: false })) };
  }
  const pendingInks = (i) => net ? net.events.filter((e) => e.k === "ink" && e.slot === i).length : 0;
  for (const s of sc.slots) {
    const sl = ribbon.slots[s.i];
    if (!sl) continue;
    sl.seat = s.seat; sl.len = s.len || sl.len; sl.quota = s.quota;
    if (s.word && s.seat === you?.seat) { sl.word = s.word; sl.mine = true; }
    const want = s.inked.length - pendingInks(s.i);
    for (let j = sl.inked.filter(Boolean).length; j < want; j++) sl.inked[j] = s.inked[j];
    if (s.word && s.filled.length && !sl.done) { sl.word = s.word; sl.filled = s.filled.slice(); sl.done = true; }
  }
  if (sc.wordIdx >= 0 && sc.wordIdx !== wordIdxSeen) { wordIdxSeen = sc.wordIdx; if (curSlot < 0) curSlot = sc.wordIdx; }
  renderRibbon();
}

function renderRibbon() {
  const el = $("ribbon");
  if (ribbon.warm) {
    const sig = "warm";
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = `<div class="wcard current">${["H", "I"].map((_, j) => `<div class="tile todo" data-j="${j}"></div>`).join("")}</div>`;
    }
    const tiles = el.querySelectorAll(".tile");
    tiles.forEach((tile, j) => {
      const ch = ribbon.warm.inked[j];
      setTile(tile, ch && !(ribbon.warm.pending || new Set()).has(j) ? ch : "", ch ? "hand" : j === ribbon.warm.inked.filter(Boolean).length ? "todo next" : "todo");
    });
    return;
  }
  const slots = ribbon.slots;
  const sig = slots.map((s) => `${s.seat}:${s.len}`).join(",");
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig;
    el.innerHTML = slots.map((s, k) => `${k ? '<span class="squig">~</span>' : ""}<div class="wcard" data-k="${k}">${Array.from({ length: Math.max(1, s.len) }, (_, j) => `<div class="tile todo" data-j="${j}"></div>`).join("")}</div>`).join("");
  }
  slots.forEach((s, k) => {
    const card = el.querySelector(`.wcard[data-k="${k}"]`);
    if (!card) return;
    card.classList.toggle("current", k === curSlot && ["whisper", "spell", "fill"].includes(phase));
    card.classList.toggle("done", s.done);
    card.style.setProperty("--seat", seatColour(s.seat));
    const handN = s.inked.filter(Boolean).length;
    card.querySelectorAll(".tile").forEach((tile, j) => {
      if (j < handN) {
        const ch = s.pending.has(j) ? "" : s.inked[j];
        setTile(tile, ch, ch ? "hand" : "todo");
      } else if (s.filled[j - handN]) {
        setTile(tile, s.filled[j - handN], "smoke");
      } else if (s.mine && s.word) {
        setTile(tile, s.word[j] || "", j === handN ? "mine next" : "mine");
      } else {
        setTile(tile, "", j === handN && k === curSlot && phase === "spell" ? "todo next" : "todo");
      }
    });
  });
}

function setTile(tile, ch, cls) {
  const want = `tile ${cls}`;
  if (tile.textContent === ch && tile.className === want) return;
  tile.textContent = ch;
  tile.className = want;
}

// The inked letter flies from the board into its tile.
function flyLetter(ch, slot, idx) {
  const done = () => {
    if (slot === "warm") ribbon.warm?.pending?.delete(idx);
    else ribbon.slots[slot]?.pending.delete(idx);
    renderRibbon();
  };
  const t = TARGET_BY_KEY[ch];
  renderRibbon();
  const tile = slot === "warm" ? $("ribbon").querySelectorAll(".tile")[idx] : $("ribbon").querySelector(`.wcard[data-k="${slot}"] .tile[data-j="${idx}"]`);
  if (!t || !tile || reduced) { done(); return; }
  const cr = $("cv").getBoundingClientRect();
  const [sx, sy] = view.toScreen(t.x, t.y);
  const from = { x: cr.left + sx, y: cr.top + sy };
  const tr = tile.getBoundingClientRect();
  const to = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
  const f = document.createElement("div");
  f.className = "flyer";
  f.textContent = ch;
  f.style.left = `${from.x}px`;
  f.style.top = `${from.y}px`;
  f.style.translate = "-50% -50%";
  document.body.appendChild(f);
  const dx = to.x - from.x, dy = to.y - from.y;
  const anim = f.animate([
    { transform: "translate(0,0) scale(1.5)", opacity: 1 },
    { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 60}px) scale(1.25)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.75)`, opacity: 0.9 },
  ], { duration: 450, easing: "cubic-bezier(.45,0,.25,1)" });
  anim.onfinish = () => { f.remove(); done(); };
  setTimeout(() => { if (f.isConnected) { f.remove(); done(); } }, 900);
}

// ------------------------------------------------------------ role banner

function twistBadge(name, twist) {
  return twist ? `<span class="twistbadge">${esc(name || "Last Biscuit")} · ${esc(t(`twist.${twist}`))}</span>` : "";
}
function renderBanner() {
  let html = "";
  const sl = curSlot >= 0 ? ribbon.slots[curSlot] : null;
  const sc = S?.seance && !S.seance.warmup ? S.seance : null;
  const badge = sc ? twistBadge(sc.name, sc.twist) : "";
  if (phase === "warmup") html = `<span class="big">${esc(t("play.sayHi"))}</span>`;
  else if (sc && ["arrive", "pick"].includes(phase)) {
    // The seance's name (First Cup, Second Cup, Last Biscuit) while Hush asks.
    html = badge || (sc.name ? `<span class="seancename">${esc(sc.name)}</span>` : "");
    if (sc.daily) html += `<span class="dailybadge">${esc(t("daily.badge"))}</span>`;
    if (phase === "pick" && tv) html += `<div class="clue">${esc(t("tv.picking"))}</div>`;
  } else if (sl && ["whisper", "spell", "fill"].includes(phase)) {
    if (!tv && sl.seat === you?.seat && sl.word) {
      const handN = sl.inked.filter(Boolean).length;
      const letters = [...sl.word].map((c, j) => `<span class="${j < handN ? "inked" : j === handN && j < sl.quota ? "nextl" : "rest"}">${c}</span>`).join("");
      html = `${badge}<span class="big">${esc(t("play.yourWord"))}</span><span class="wordk">${letters}</span>`;
      if (standIn) html += `<div class="clue">${esc(t("play.keepingPlace"))}</div>`;
    } else {
      const who = `<span class="swatch" style="background:${seatColour(sl.seat)}"></span>${esc(seatName(sl.seat))}`;
      html = `${badge}<span class="big">${t(tv ? "tv.leads" : "play.follow", { name: who })}</span>`;
      if (curPrompt) html += `<div class="clue">${esc(t("play.theirWord", { prompt: curPrompt }))}</div>`;
      else if (curHushed) html += `<div class="clue secret">${esc(t("twist.secret"))}</div>`;
    }
  } else if (phase === "lobby" && S) {
    const humans = S.seats.filter((s) => s.kind === "human" && s.status !== "gone").length;
    html = humans > 1 ? `<span class="clue">${esc(t("lobby.handsAtTable", { n: humans }))}</span>` : "";
  }
  $("banner").innerHTML = html;
  $("padbanner").innerHTML = html;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ------------------------------------------------------------ lobby

function renderLobby() {
  if (!S) return;
  $("bigcode").innerHTML = [...S.code].map((c) => `<span>${c}</span>`).join("");
  drawQR($("qr"), roomUrl());
  const humans = S.seats.filter((s) => s.kind === "human" && s.status !== "gone");
  const bots = S.seats.filter((s) => s.kind === "bot");
  const rows = [];
  for (const s of humans) {
    const me = s.id === you?.seat;
    rows.push(`<li><span class="mit" style="background-color:${SEATS[s.colour % 6].hex};background-image:url(${patternUrl(s.colour)})"></span><span>${esc(s.name)}${me ? ` <span class="tag">${esc(t("lobby.you"))}</span>` : ""}${s.host ? ` <span class="crown" title="${esc(t("lobby.host"))}" aria-label="${esc(t("lobby.host"))}">★</span>` : ""}</span>${me ? `<button class="reroll" data-act="reroll" aria-label="${esc(t("lobby.newName"))}">↻</button>` : ""}</li>`);
  }
  for (const b of bots) rows.push(`<li><span class="mit bot"></span><span>${esc(b.name)} <span class="tag">${esc(t("lobby.ghostFriend"))}</span></span></li>`);
  for (let i = humans.length; i < Math.max(2, Math.min(6, humans.length + 1)); i++) rows.push(`<li class="empty"><span class="mit"></span>${esc(t("lobby.emptySeat"))}</li>`);
  $("seats").innerHTML = rows.join("");
  const host = S.host === you?.seat;
  $("hostrow").hidden = !host;
  const sel = $("pack");
  const langSig = t("pack.cozy");
  if (!sel.options.length || sel.dataset.sig !== langSig) {
    sel.dataset.sig = langSig;
    sel.innerHTML = PACKS.map((p) => `<option value="${p.id}">${esc(packName(p))}</option>`).join("");
  }
  sel.value = S.pack;
  $("lock").textContent = S.locked ? t("lobby.unlock") : t("lobby.lock");
  $("tvlink").href = `${roomUrl()}?tv=1`;
  $("ghostfriends").hidden = !(host && humans.length === 1);
  updateBeginButton();
  refitLobby();
}

function updateBeginButton() {
  if (!S || phase !== "lobby") return;
  const humans = S.seats.filter((s) => s.kind === "human" && s.status !== "gone").length;
  const hide = !(S.host === you?.seat && humans >= 2 && performance.now() - lobbySince > 10000);
  if ($("begin").hidden !== hide) { $("begin").hidden = hide; refitLobby(); }
}

function roomUrl() { return `${location.origin}/${code}`; }

const patternCache = {};
function patternUrl(colour) {
  return (patternCache[colour] ||= patternTile(SEATS[colour % 6], 24).toDataURL());
}

function drawQR(canvas, text) {
  if (!window.qrcode || canvas.dataset.text === text) return;
  canvas.dataset.text = text;
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const g = canvas.getContext("2d");
  const size = canvas.width;
  const cell = size / (n + 2);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, size, size);
  g.fillStyle = "#3B2F5C";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c)) continue;
    const x = (c + 1) * cell, y = (r + 1) * cell;
    g.beginPath();
    g.roundRect ? g.roundRect(x + 0.4, y + 0.4, cell - 0.8, cell - 0.8, cell * 0.35) : g.rect(x, y, cell, cell);
    g.fill();
  }
}

// ------------------------------------------------------------ pick

function onPickq(m) {
  pickState = { ...m, chosen: {} };
  const sheet = $("pick");
  sheet.hidden = false;
  clearTimeout(bubbleTimer);
  $("bubble").classList.remove("show");
  $("pickq").textContent = m.ask;
  pickHush?.setExpression("whisper");
  sound?.hushVoice(m.ask, { question: true });
  captions.say(t("cap.humQuestion"), 1400, { gap: 4000, key: "hum" });
  const tut = S?.tutorial;
  renderPickTwist();
  if (S?.seance?.twist) {
    // The twist's moment: Hush shushes on the pick sheet, then goes back to whispering.
    pickHush?.setExpression("shh");
    setTimeout(() => { if (phase === "pick") pickHush?.setExpression("whisper"); }, 1600);
    twistMoment(S.seance.twist);
  }
  $("pickslots").innerHTML = m.slots.map((s) => `
    <div class="pickslot" data-slot="${s.slot}">
      <p class="prompt">${esc(tut ? t("pick.inSecret") : t("pick.yourWordIs"))} <em>${esc(s.prompt)}</em></p>
      <div class="cards">${s.options.map((w, i) => `<button class="card" data-slot="${s.slot}" data-opt="${i}">${doodle(s.cat, w)}<span>${w}</span></button>`).join("")}</div>
    </div>`).join("");
  const others = [...new Set((m.others || []).map((o) => o.seat))].filter((id) => id !== you?.seat);
  $("pickothers").innerHTML = others.map((id) => `<div class="facedown" data-seat="${id}"><div class="fd"></div>${esc(seatName(id))}</div>`).join("");
  // Pre-flip seats that already picked (tutorial Nani).
  if (tut) setTimeout(() => markPicked(7), 900);
  const tm = $("picktimer");
  const left = Math.max(0, m.deadline - (net?.serverNow() || 0));
  tm.style.transition = "none";
  tm.style.transform = "scaleX(1)";
  requestAnimationFrame(() => requestAnimationFrame(() => { tm.style.transition = `transform ${left}ms linear`; tm.style.transform = "scaleX(0)"; }));
  if (tut) {
    setTimeout(() => { const c = $("pickslots").querySelector(".card:not(.chosen):not(.dim)"); if (c && !Object.keys(pickState?.chosen || {}).length) c.classList.add("wiggle"); }, 15000);
  }
  flavour("pick", 0.4);
}

function renderPickTwist() {
  const pt = $("picktwist");
  const sc = S?.seance;
  if (!sc?.twist) { pt.hidden = true; return; }
  pt.innerHTML = `${twistBadge(sc.name, sc.twist)} <span>${esc(twistNow?.line || TWIST_LINES[sc.twist] || "")}</span>`;
  pt.hidden = false;
}

function choose(slot, opt) {
  if (!pickState || pickState.chosen[slot] != null) return;
  pickState.chosen[slot] = opt;
  net?.send({ t: "pick", slot, opt });
  sound?.tok();
  $("pickslots").querySelectorAll(`.card[data-slot="${slot}"]`).forEach((c) => {
    c.classList.toggle("chosen", +c.dataset.opt === opt);
    c.classList.toggle("dim", +c.dataset.opt !== opt);
    c.disabled = true;
  });
  const allDone = pickState.slots.every((s) => pickState.chosen[s.slot] != null);
  if (allDone) {
    const w = document.createElement("p");
    w.className = "waiting";
    w.textContent = t("pick.waiting");
    $("pickslots").appendChild(w);
  }
}

function markPicked(seat) {
  const el = $("pickothers").querySelector(`.facedown[data-seat="${seat}"]`);
  if (el && !el.classList.contains("done")) { el.classList.add("done"); sound?.tok(); }
}

// ------------------------------------------------------------ reveal

function clearRevealTimers() { revealTimers.forEach(clearTimeout); revealTimers = []; }
const later = (ms, fn) => revealTimers.push(setTimeout(fn, ms));

function showReveal(e) {
  revealData = e;
  clearRevealTimers();
  captions.say(t("cap.sentence"), 2400);
  // Keep the page and count the seance now (both ignore a resent reveal), not in a timer that
  // "Another cup" could clear. A TV only watches: nothing is kept on it.
  const saved = tv ? null : scrapbook.save(e, { you: you?.seat, at: Date.now(), code: S?.code, mode: S?.mode });
  const fresh = tv ? [] : wardrobe.recordSeance(e, { you: you?.seat });
  $("pick").hidden = true;
  const sheet = $("reveal");
  sheet.hidden = false;
  revealHush?.setSize(device() === "phone" ? 72 : innerHeight <= 820 ? 80 : 110);
  revealHush?.setExpression("delighted");
  $("revask").textContent = e.ask;
  renderRevealBadges(e);
  if (e.daily) captions.say(t("cap.daily"), 1800);
  // Build the sentence: slot words carry their author's colour and name.
  const tokens = e.frameText.split(/\s+/);
  let k = 0;
  const parts = tokens.map((tok) => {
    const w = e.words[k];
    if (w && tok.replace(/[^A-Z]/g, "") === w.w) {
      k++;
      const col = w.colour >= 0 ? SEATS[w.colour % 6].hex : "#D9CCEB";
      const who = w.seat === you?.seat ? t("reveal.you") : w.name;
      return `<span class="w slot" style="--seatc:${col}66"><b>${esc(tok)}</b><small>${esc(who)}</small></span>`;
    }
    return `<span class="w"><span>${esc(tok)}</span><small>&nbsp;</small></span>`;
  });
  $("sentence").innerHTML = parts.join("");
  for (const id of ["speak", "reaction", "result"]) $(id).classList.remove("on");
  $("reaction").textContent = e.line && e.line !== TUTORIAL.lines.speak ? e.line : "";
  $("votes").textContent = "";

  renderRevealResult(e);

  const solo = S?.mode === "solo";
  $("closebook").textContent = t("reveal.closeBook");
  $("sharecard").hidden = false;
  const tw = $("twodev");
  tw.hidden = tv || !(solo && !S?.companion);
  if (!tw.hidden) {
    drawQR($("qr2"), roomUrl());
    $("twodevurl").textContent = roomUrl().replace(/^https?:\/\//, "");
    $("secondwin").hidden = device() === "phone";
  }
  if (wasTutorial && !tv) local.set("gh.tutorialDone", "1");
  if (!tv) local.set("gh.firstSeanceDone", "1"); // iOS first-seance captions stop from the next arrive

  // The sentence flips word by word while Hush hums it.
  const wordsEls = [...$("sentence").querySelectorAll(".w")];
  const step = reduced ? 120 : 500;
  wordsEls.forEach((el, i) => later(300 + i * step, () => { el.classList.add("on"); sound?.letterNote(i); }));
  const after = 300 + wordsEls.length * step;
  // Hush's finds and the first scrapbook page are announced after the result fades in.
  // Its own timer (not later()) so the card still shows if the table has already moved on;
  // only leaving the room cancels it.
  clearTimeout(celebrateTimer);
  if (fresh.length) celebrateTimer = setTimeout(() => fresh.forEach((id) => wardrobe.celebrate(id, { hushFactory: hushMod?.createHush, sound })), after + 2600 + 1200);
  if (saved && scrapbook.count() === 1) later(after + 3000, () => toast(t("reveal.scrapbookStarted"), 2500));
  later(after + 200, () => {
    view.petals(30, (S?.seats || []).filter((s) => s.kind === "human").map((s) => SEATS[s.colour % 6].hex).concat(["#FFC94D", "#5EF2D0", "#F3E9D2"]));
    sound?.goodbyeTune(0);
    captions.say(t("cap.tune"), 2400);
    // The sentence is all there: Hush laughs and cheers, and a screen reader hears it whole.
    hushCheer();
    announce(t("a11y.sentence", { sentence: e.frameText }));
    $("speak").classList.add("on");
    sound?.hushVoice(TUTORIAL.lines.speak);
  });
  later(after + 1500, () => { $("reaction").classList.add("on"); sound?.hushVoice(e.line || ""); });
  later(after + 2600, () => { $("result").classList.add("on"); replayPath(e.path || []); });
  const seanceWords = e.words.map((w) => w.w).join(" ");
  $("reveal").setAttribute("aria-label", `${e.frameText}. ${seanceWords}`);
}

function renderRevealBadges(e) {
  const out = [];
  if (e.daily) out.push(`<span class="dailybadge">${esc(t("daily.badge"))}</span>`);
  if (e.twist) out.push(twistBadge(e.seance, e.twist));
  $("revbadges").innerHTML = out.join("");
  $("revbadges").hidden = !out.length;
}

function renderRevealResult(e) {
  const stars = e.stars || {};
  $("stars").innerHTML = [["swift", t("reveal.swift")], ["steady", t("reveal.steady")], ["sure", t("reveal.sure")]]
    .map(([k2, label]) => `<span class="${stars[k2] ? "got" : "miss"}">${stars[k2] ? "★" : "☆"} ${esc(label)}</span>`).join("");
  $("knew").textContent = e.fs ? (e.fs === 1 ? t("reveal.knewOnce") : t("reveal.knewTimes", { n: e.fs })) : "";
  $("titles").innerHTML = titlesHtml(e.titles);
}

// Superlatives; a pair title (Soulmates, with: otherSeat) shows once, as one line for both.
function titlesHtml(list) {
  const who = (seat) => esc(seat === you?.seat ? t("reveal.You") : seatName(seat));
  const sw = (seat) => `<span class="swatch" style="background:${seatColour(seat)}"></span>`;
  const seen = new Set();
  const out = [];
  for (const it of list || []) {
    if (it.with != null) {
      const k = `${Math.min(it.seat, it.with)}-${Math.max(it.seat, it.with)}:${it.title}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(`<li class="pair">${sw(it.seat)}${sw(it.with)}${who(it.seat)} &amp; ${who(it.with)}: ${esc(it.title)}</li>`);
    } else out.push(`<li>${sw(it.seat)}${who(it.seat)}: ${esc(it.title)}</li>`);
  }
  return out.join("");
}

// The seance's one planchette path replays at 4x behind the card.
function replayPath(path) {
  if (!path.length || reduced) return;
  const t0 = performance.now();
  const dur = Math.max(1500, (path.length * 100) / 4);
  replayState = { path, t0, dur };
}
let replayState = null;

function floatEmote(e) {
  const map = { laugh: "😆", gasp: "😮", heart: "💖", tea: "🍵" };
  const s = document.createElement("span");
  s.textContent = map[e] || "✨";
  s.style.left = `${10 + Math.random() * 80}%`;
  $("emotefloat").appendChild(s);
  setTimeout(() => s.remove(), 1900);
}

// ------------------------------------------------------------ dialogs

function dialog(text, buttons) {
  $("dialogtext").textContent = text;
  $("dialogbtns").innerHTML = "";
  for (const [label, fn] of buttons) {
    const b = document.createElement("button");
    b.className = "btn primary";
    b.textContent = label;
    b.onclick = () => { $("dialog").hidden = true; fn(); };
    $("dialogbtns").appendChild(b);
  }
  const close = document.createElement("button");
  close.className = "btn ghost";
  close.textContent = t("dialog.notNow");
  close.onclick = () => { $("dialog").hidden = true; };
  $("dialogbtns").appendChild(close);
  $("dialog").hidden = false;
}

// ------------------------------------------------------------ UI wiring

async function startSolo() {
  const tutorial = !local.get("gh.tutorialDone");
  try { enterRoom(await createRoom(tutorial ? "tutorial" : "solo")); }
  catch { $("codeerr").textContent = t("landing.noServer"); }
}
async function startTable() {
  try { enterRoom(await createRoom("table", "cozy")); }
  catch { $("codeerr").textContent = t("landing.noServer"); }
}
async function joinCode(c) {
  c = c.toUpperCase().replace(/[^A-Z]/g, "");
  if (!CODE_RE.test(c)) { $("codeerr").textContent = t("landing.noTable", { code: c }); return; }
  const info = await roomInfo(c);
  if (!info.exists) { $("codeerr").textContent = t("landing.noTable", { code: c }); return; }
  enterRoom(c);
}

function unlockAudio() {
  if (unlocked || !sound) return;
  unlocked = true;
  sound.unlock();
  sound.ambience(true);
}

function wireUi() {
  $("solo").onclick = () => { unlockAudio(); startSolo(); };
  $("table").onclick = () => { unlockAudio(); startTable(); };
  $("dailychip").onclick = () => { unlockAudio(); startDaily(); };
  $("home").onclick = (e) => {
    if (screen !== "room") return;
    e.preventDefault();
    const leave = () => { net?.close(); net = null; history.pushState(null, "", "/"); showLanding(); };
    const inSeance = !["lobby", "reveal", ""].includes(phase);
    if (inSeance && !tv) dialog(t("dialog.leaveTable"), [[t("dialog.leave"), leave]]);
    else leave();
  };
  const tiles = [...$("codeform").querySelectorAll("input")];
  tiles.forEach((inp, i) => {
    inp.addEventListener("input", () => {
      inp.value = inp.value.toUpperCase().replace(/[^A-Z]/g, "").slice(-1);
      $("codeerr").textContent = "";
      if (inp.value && i < 3) tiles[i + 1].focus();
      const c = tiles.map((t) => t.value).join("");
      if (c.length === 4) { unlockAudio(); joinCode(c); }
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !inp.value && i > 0) tiles[i - 1].focus(); });
    inp.addEventListener("paste", (e) => {
      const txt = (e.clipboardData?.getData("text") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
      if (txt.length) { e.preventDefault(); txt.split("").forEach((ch, j) => { if (tiles[j]) tiles[j].value = ch; }); if (txt.length === 4) joinCode(txt); }
    });
  });
  $("codeform").onsubmit = (e) => { e.preventDefault(); joinCode(tiles.map((t) => t.value).join("")); };

  $("mute").onclick = () => { unlockAudio(); if (!sound) return; sound.setMuted(!sound.muted); $("mute").classList.toggle("muted", sound.muted); syncCaptions(); };
  $("aa").onclick = () => { unlockAudio(); openMenu({ opener: $("aa"), muted: !!sound?.muted, firstSeance: iosFirstSeance(), onReplayTutorial: replayTutorial }); };
  $("scrapbookbtn").onclick = openScrapbook;
  $("revscrapbook").onclick = openScrapbook;
  $("wardrobebtn").onclick = openWardrobe;
  $("revwardrobe").onclick = openWardrobe;
  $("roomchip").onclick = () => copyLink();
  $("copylink").onclick = () => copyLink();
  $("sharelink").onclick = () => shareLink();
  $("adddevice").onclick = () => dialog(t("dialog.addDevice", { url: roomUrl().replace(/^https?:\/\//, "") }), [[t("lobby.copyLink"), copyLink], ...(device() === "laptop" ? [[t("reveal.secondWindow"), openSecondWindow]] : [])]);
  $("seats").onclick = (e) => { if (e.target.closest('[data-act="reroll"]')) net?.send({ t: "reroll" }); };
  $("pack").onchange = (e) => net?.send({ t: "host", a: "pack", pack: e.target.value });
  $("lock").onclick = () => net?.send({ t: "host", a: S?.locked ? "unlock" : "lock" });
  $("begin").onclick = () => net?.send({ t: "begin" });
  $("ghostfriends").onclick = () => net?.send({ t: "host", a: "solo" });
  $("pickslots").onclick = (e) => { const c = e.target.closest(".card"); if (c) choose(+c.dataset.slot, +c.dataset.opt); };
  $("again").onclick = () => { net?.send({ t: "vote", v: "again" }); $("votes").textContent = t("reveal.pouring"); sound?.tok(); };
  $("closebook").onclick = () => {
    if (S?.mode === "solo") { net?.close(); net = null; history.pushState(null, "", "/"); showLanding(); }
    else net?.send({ t: "vote", v: "close" });
  };
  $("sharecard").onclick = () => {
    if (!revealData) return;
    sound?.tok();
    // location.origin, never the room link: the room code is not shared.
    openSharePreview(revealData, { you: you?.seat, url: location.host, shareUrl: location.origin });
  };
  $("secondwin").onclick = openSecondWindow;
  $("emotebar").onclick = (e) => { const b = e.target.closest("button"); if (b) net?.send({ t: "emote", e: b.dataset.e }); };
  $("knock").onclick = () => net?.send({ t: "knock" });
  input.addEventListener("knock", () => net?.send({ t: "knock" }));
  input.addEventListener("activate", (e) => {
    unlockAudio();
    // Landing: clicking the planchette starts the guided seance.
    if (screen === "landing" && e.detail.target === "board" && e.detail.point) {
      const st = attract.view();
      if (view.onPlanchette(e.detail.point.x, e.detail.point.y, st.x, st.y)) startSolo();
    }
  });
  addEventListener("popstate", () => {
    const p = location.pathname.replace(/^\/+|\/+$/g, "").toUpperCase();
    if (CODE_RE.test(p)) enterRoom(p); else { net?.close(); net = null; showLanding(); }
  });
  addEventListener("beforeunload", (e) => {
    if (!tv && screen === "room" && !["lobby", "reveal", ""].includes(phase)) { e.preventDefault(); e.returnValue = ""; }
  });
  // Let the table know at once when this page goes away, so a reload gets its seat straight back.
  addEventListener("pagehide", () => { try { net?.ws?.close(1000); } catch {} });
  addEventListener("keydown", (e) => {
    if (app.inert) return; // a full-screen overlay (wardrobe, scrapbook) owns the keyboard
    if (!$("dialog").hidden) { if (e.key === "Escape") $("dialog").hidden = true; return; }
    if (e.key === "Enter" && !tv && !e.target.closest?.("input,button,select,a")) {
      if (screen === "landing") $("solo").click();
      else if (phase === "reveal") $("again").click();
      else if (phase === "lobby" && !$("begin").hidden) $("begin").click();
    }
  });
}

async function copyLink() {
  try { await navigator.clipboard.writeText(roomUrl()); toast(t("lobby.linkCopied")); } catch { toast(roomUrl(), 4000); }
}
async function shareLink() {
  if (navigator.share) { try { await navigator.share({ title: "Ghost Hand", text: t("lobby.shareText"), url: roomUrl() }); return; } catch {} }
  copyLink();
}
function openSecondWindow() {
  const w = Math.round(window.screen.availWidth / 2);
  window.open(roomUrl(), "_blank", `width=${w},height=${window.screen.availHeight},left=${w}`);
}

// ------------------------------------------------------------ frame

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  if (screen === "landing") return landingFrame(now, dt);
  if (!net) { view.draw(null, now); return; }
  net.pumpEvents();
  const s = net.sample();
  lastSample = s;
  const my = input.update(now, s, dt);
  if (my.resting) rested = true;
  pumpInput(now, my);
  if (now - stripAt >= 100) {   // the seat strip diffs per chip; ~10 Hz is plenty
    stripAt = now;
    strip.update({
      seats: S?.seats || [],
      hands: s?.hands || [],
      you: you?.seat ?? null,
      knower: ["whisper", "spell", "fill"].includes(phase) ? curKnower : null,
      phase,
      compact: app.dataset.device === "phone",
      mine: { resting: my.resting, m: my.resting ? my.m : 0, dozing: !!(input.drowsy || my.hidden) },
    });
  }
  if (!s) { view.draw(null, now); updateLine(null, my, now); return; }
  if (director) {
    // Hush dozes after 20 s of still hands in spell or warmup; any push wakes it.
    const pushing = (my.resting && my.m >= 0.05) || s.hands.some((h) => !h.bot && h.seat !== 9 && h.m >= 0.05);
    director.tickIdle(now, { active: phase === "spell" || phase === "warmup", pushing });
  }
  checkNearMiss(s);
  // Gust twist: keep the mint streaks blowing while the server's gust lasts.
  if (s.gust && gustDir && now - lastWindAt > 320) { view.wind(s.x, s.y, gustDir.dx, gustDir.dy); lastWindAt = now; }
  const st = buildView(s, my, now);
  view.draw(st, now);
  drawReplay(now);
  const creak = s.sliding ? 0 : Math.min(1, s.r);
  if (sound) {
    sound.creak(creak);
    sound.glide(Math.min(1, Math.hypot(s.vx, s.vy) / 240));
    sound.dwell(s.dwellL >= 0 ? s.dwellP : 0);
  }
  if (captions.enabled && phase !== "reveal") {
    if (creak >= 0.3) captions.say(creak >= 0.7 ? t("cap.creakRising") : t("cap.creakSoft"), 1800, { gap: 6000, key: "creak" });
    if (s.dwellL >= 0 && s.dwellP > 0.25) captions.say(t("cap.dwell"), 1400, { gap: 5000, key: "dwell" });
  }
  if (app.dataset.device === "phone") drawMagnifier(s);
  updateLine(s, my, now);
  if (phase === "lobby") updateBeginButton();
}

function landingFrame(now, dt) {
  for (const e of attract.update(now)) {
    const P = attract.P;
    if (e.k === "ink") { view.ink(e.key, "#FFC94D"); if (unlocked) sound?.letterNote(attract.idx === 0 ? 4 : attract.idx - 1); }
    else if (e.k === "breakaway") view.breakaway(P.x, P.y);
  }
  const st = attract.view();
  st.hands = st.hands.map((h) => ({ ...h, angle: { 7: 240, 8: 300, 9: 90 }[h.seat], colour: 0 }));
  const my = input.update(now, st, dt);
  const over = my.ghost && view.onPlanchette(my.ghost.x, my.ghost.y, st.x, st.y);
  if (over) { landingHoverSince ||= now; } else landingHoverSince = 0;
  st.ghost = my.ghost;
  st.ghostColour = 0;
  st.pulse = !!over;
  st.glows = attract.world.target ? [{ key: attract.world.target, kind: "open" }] : [];
  view.draw(st, now);
  setLine(landingHoverSince && now - landingHoverSince > 600 ? t("landing.clickPlanchette") : "");
}

function pumpInput(now, my) {
  if (!net?.connected || tv) return;
  const ang = Math.atan2(my.uy, my.ux);
  const changed = !lastIn || my.resting !== lastIn.resting || my.hidden !== lastIn.hidden || my.device !== lastIn.device
    || Math.abs(my.m - lastIn.m) > 0.05 || (my.m > 0.02 && Math.abs(Math.atan2(Math.sin(ang - lastIn.ang), Math.cos(ang - lastIn.ang))) > 3 * DEG);
  if (changed && now - lastInAt >= 50) {
    net.sendInput(my.ux, my.uy, my.m, my.resting, my.device, my.hidden);
    lastIn = { resting: my.resting, hidden: my.hidden, device: my.device, m: my.m, ang };
    lastInAt = now;
  } else net.heartbeat();
}

function buildView(s, my, now) {
  const seats = seatById();
  const veiled = S?.seance && !S.seance.warmup && !S.seance.open && phase === "spell";
  let allResting = true, humans = 0;
  const hands = [];
  for (const h of s.hands) {
    const seat = seats.get(h.seat);
    const kind = h.seat === 9 ? "hush" : h.bot ? "bot" : "human";
    const mine = h.seat === you?.seat;
    if (kind === "human" && h.status === "gone" && !mine) continue;
    const colour = seat?.colour ?? 0;
    const hand = {
      angle: kind === "human" ? HUMAN_ANGLES[colour % 6] : SITTER_ANGLES[h.seat] ?? 270,
      colour, kind, ux: h.ux, uy: h.uy, m: h.m, counted: h.counted, resting: h.resting, status: h.status,
      mine, hidden: false, star: false,
    };
    if (mine) {
      hand.ux = my.ux; hand.uy = my.uy; hand.m = my.resting ? my.m : 0; hand.resting = my.resting;
      hand.star = !!myTarget;
      if (input.drowsy) hand.status = "dozing";
    } else if (veiled && kind === "human") hand.hidden = true;
    else hand.star = h.visible;
    if (kind === "human") { humans++; if (!hand.resting) allResting = false; }
    hands.push(hand);
  }
  // Lobby start ring: every hand resting for 1.5 s.
  let startFill = 0;
  if (phase === "lobby" && humans >= 2 && allResting) { startFillSince ||= now; startFill = (now - startFillSince) / 1500; }
  else startFillSince = 0;
  const glows = [];
  if (myTarget) glows.push({ key: myTarget, kind: "knower" });
  if (openGlow && openGlow !== myTarget) glows.push({ key: openGlow, kind: "open" });
  if (hint.step >= 2 && hint.letter && hint.letter !== myTarget) glows.push({ key: hint.letter, kind: "hint" });
  const st = {
    x: s.x, y: s.y, sliding: s.sliding, captured: s.captured, stir: s.stir, r: s.r,
    dirX: s.dirX, dirY: s.dirY, hasDir: s.r > 0.01,
    dwellKey: keyOfIndex(s.dwellL), dwellP: s.dwellP, glows,
    hintStep: hint.step, hintKey: hint.letter, hands,
    ghost: !tv && app.dataset.device === "laptop" && !my.resting && ["lobby", "warmup", "spell", "whisper"].includes(phase) ? my.ghost : null,
    ghostColour: you?.colour ?? 0,
    pulse: !tv && !my.resting && ["spell", "warmup"].includes(phase) && (S?.tutorial || !rested),
    startFill,
  };
  st.arrow = helperArrow(s, my, hands, st);
  return st;
}

// Stuck ladder step 2 (spec 3.6 / 5.6): a ghost arrow from my own mitten along the knower's push.
// Tutorial: from step 2 while Nani (seat 7) leads. Normal game: at step 2 in open seances,
// following the knower's visible push.
function helperArrow(s, my, hands, st) {
  if (phase !== "spell" || hint.step < 2 || !my.resting) return null;
  if (curKnower == null || curKnower === you?.seat) return null;
  if (s.sliding || s.captured) return null;
  const me = hands.find((h) => h.mine);
  const k = s.hands.find((h) => h.seat === curKnower);
  if (!me || !k || !(k.m > 0.2)) return null;
  const tutorial = !!S?.tutorial && curKnower === 7;
  const open = !!S?.seance?.open && hint.step === 2 && k.visible;
  if (!tutorial && !open) return null;
  const km = Math.hypot(k.ux, k.uy);
  const ux = k.ux / km, uy = k.uy / km;
  // My mitten sits on the planchette ring; the opposite seat gives the ring's centre and radius.
  const mt = mittenPoint(st, me.angle), op = mittenPoint(st, me.angle + 180);
  const cx = (mt.x + op.x) / 2, cy = (mt.y + op.y) / 2;
  const R = Math.hypot(mt.x - cx, mt.y - cy) || 1;
  const rx = (mt.x - cx) / R, ry = (mt.y - cy) / R;
  // Pushing away from the body: drawArrow's own gap already clears the mitten.
  if (ux * rx + uy * ry >= 0) return { ...mt, ux, uy };
  // Pushing into the body (seats sit below it, letters above): drawn from the mitten the arrow
  // would cross the planchette and land on the lens. Run it beside the ring instead, on my
  // mitten's side, starting level with the mitten and pointing along the knower's push.
  let nx = -uy, ny = ux;
  if (nx * rx + ny * ry < 0) { nx = -nx; ny = -ny; }
  const side = R + 45;                                      // clear of the ring and the arrow head
  const along = (mt.x - cx) * ux + (mt.y - cy) * uy - 42;   // drawArrow starts 42 bu along the push
  return { x: cx + nx * side + ux * along, y: cy + ny * side + uy * along, ux, uy };
}

function drawReplay(now) {
  if (!replayState || phase !== "reveal") { replayState = phase === "reveal" ? replayState : null; return; }
  const { path, t0, dur } = replayState;
  const k = Math.min(1, (now - t0) / dur);
  const n = Math.max(2, Math.floor(path.length * k));
  const g = view.g;
  const { s, ox, oy } = view.fit;
  g.save();
  g.translate(ox, oy);
  g.scale(s, s);
  g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = 12;
  for (let i = 1; i < n; i++) {
    const a = path[i - 1], b = path[i];
    const sl = ribbon.slots[b[2]];
    g.strokeStyle = sl ? seatColour(sl.seat) : "#5FCFB7";
    g.globalAlpha = 0.75;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  }
  g.restore();
}

function drawMagnifier(s) {
  const mc = $("magnifier");
  const g = mc.getContext("2d");
  const cv = $("cv");
  const dpr = view.fit.dpr;
  const [sx, sy] = view.toScreen(s.x, s.y);
  const r = 20 * dpr;
  g.clearRect(0, 0, mc.width, mc.height);
  g.save();
  g.beginPath(); g.arc(72, 72, 72, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#FFF8EC"; g.fillRect(0, 0, 144, 144);
  try { g.drawImage(cv, sx * dpr - r, sy * dpr - r, r * 2, r * 2, 0, 0, 144, 144); } catch {}
  g.restore();
}

function updateLine(s, my, now) {
  if (screen !== "room") return;
  if (disconnected) return setLine(t("play.reconnecting"));
  if (s?.stale && !["lobby", "reveal"].includes(phase)) return setLine(t("play.veilThin"));
  if (tv) return setLine(""); // a TV has no hands to rest
  const restLine = device() === "phone" && settings.holdFree ? t("play.tapPad") : TL.rest(device());
  $("padhint").style.opacity = my.resting ? 0 : 1;
  if (phase === "lobby" && S) {
    const humans = S.seats.filter((x) => x.kind === "human" && x.status !== "gone").length;
    if (humans <= 1) return setLine(t("lobby.oneHand"));
    return setLine(my.resting ? t("lobby.restAll") : restLine);
  }
  if (["spell", "warmup"].includes(phase)) {
    if (!my.resting) return setLine(restLine);
    if (S?.tutorial && lineText === TL.follow1()) return;
    if (S?.tutorial && curKnower === you?.seat && myTarget && s && !fastWarned) {
      const T = TARGET_BY_KEY[myTarget];
      if (T && Math.hypot(T.x - s.x, T.y - s.y) < 60 && Math.hypot(s.vx, s.vy) > 60) {
        fastWarned = true;
        const brake = device() === "phone" ? (settings.holdFree ? t("play.tapStop") : TL.liftPhone()) : TL.pointLaptop();
        setLine(brake);
        setTimeout(() => { if (lineText === brake) setLine(""); }, 2500);
        return;
      }
    }
    if (lineText === restLine || lineText === t("lobby.restAll") || lineText === t("lobby.oneHand")) setLine("");
    if (lineText === TL.lead() && curKnower !== you?.seat) setLine("");
    return;
  }
  if (lineText && ![TL.lead()].includes(lineText)) setLine("");
  if (phase !== "spell" && phase !== "whisper" && lineText === TL.lead()) setLine("");
}

// Debug handle for local testing only (read-only use); never on the public site.
if (["127.0.0.1", "localhost"].includes(location.hostname)) {
  window.__gh = {
    get net() { return net; }, get state() { return S; }, get phase() { return phase; }, get you() { return you; },
    get target() { return myTarget; }, get glow() { return openGlow; }, get hint() { return hint; }, get knower() { return curKnower; },
    get pick() { return pickState; }, get director() { return director; }, view, TARGET_BY_KEY,
    strip, captions, scrapbook, wardrobe, settings,
  };
}

boot().catch((e) => { console.error(e); setLine(t("app.couldNotStart", { msg: e.message })); });

// PWA: the service worker keeps the app shell close (never on a local dev server).
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
  const reg = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
  if (document.readyState === "complete") reg(); else addEventListener("load", reg, { once: true });
}
