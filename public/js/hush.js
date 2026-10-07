// Ghost Hand - Hush, the parlour spirit: one inline-SVG ghost with expressions,
// accessories and gentle motion (CSS transforms and opacity only).

// ------------------------------------------------------------ palette & timing

const INK = "#3B2F5C";
const GHOST = "#FFFFFF";
const AURA = "#B8E6E1";
const CHEEK = "#F7B7C3";
const TONGUE = "#F29BB0";
const CANDLE = "#FFD36E";
const PINE = "#D9A066";
const PINE_DARK = "#B7794A";
const LEAF = "#9FD8CE";
const LILAC = "#C9B6E4";

const PEEK_LINE = 0.52;   // share of the box kept when peeking: just below the cheeks
const BLINK_MS = 120;
const SPIN_MS = 600;
const SPIN_HOLD_MS = 250; // let the ^ ^ face land before settling back to idle
const WAVE_MS = 1200;     // three wags
const MOTE_MS = 1300;     // goodbye motes rise and fade
const MOTE_STAGGER_MS = 70;

// ------------------------------------------------------------ expressions & poses

// arms: [left, right]. pose/look/fx/blush are optional.
const EXPRESSIONS = {
  idle:      { eyes: "open",   mouth: "smile", arms: ["rest", "rest"] },
  curious:   { eyes: "open",   mouth: "o",     arms: ["rest", "rest"],    pose: "tilt",   look: "right" },
  whisper:   { eyes: "open",   mouth: "o",     arms: ["rest", "cup"],     pose: "lean",   look: "right", fx: "psst" },
  delighted: { eyes: "happy",  mouth: "grin",  arms: ["cheer", "cheer"],  blush: true },
  puzzled:   { eyes: "squint", mouth: "flat",  arms: ["scratch", "rest"], pose: "ponder", fx: "mist" },
  sleepy:    { eyes: "closed", mouth: "o",     arms: ["droop", "droop"],  pose: "sink",   fx: "zz" },
  shh:       { eyes: "open",   mouth: "o",     arms: ["rest", "shh"],     look: "left",   blush: true },
  goodbye:   { eyes: "happy",  mouth: "smile", arms: ["rest", "rest"] },
};

const ACCESSORIES = ["scarf", "flower", "tophat", "monocle"];

// Shapes swapped in and out by data attributes on the root.
const VARIANTS = {
  eyes: ["open", "happy", "closed"],
  mouth: ["smile", "o", "grin", "flat"],
  fx: ["psst", "mist", "zz", "motes"],
  acc: ACCESSORIES,
};

// [translateX, translateY, rotate] in the right arm's frame (pivot at the shoulder,
// arm pointing +x). The left arm is drawn mirrored, so one table serves both.
// Every pose uses the same transform functions so transitions interpolate cleanly.
const ARM_POSES = {
  rest:    [0, 0, 42],
  droop:   [0, 0, 64],
  grip:    [-2.2, -3.11, -100],   // mitten resting on the edge while peeking
  cheer:   [2.2, -6.7, -45],
  wave:    [2.94, -12.95, -70],
  cup:     [-23.05, 0.5, -120],   // beside the mouth
  shh:     [-35.15, -3.03, -95],  // over the lips
  scratch: [-1.8, -22.61, -80],   // at the side of the head
};

// [translateY %, rotate deg, scale] for the whole body, pivoting near the hem.
const BODY_POSES = {
  tilt:   [0, 8, 1],
  lean:   [1, -4, 1.06],
  ponder: [0, -5, 1],
  sink:   [3, 0, 1],
};

// ------------------------------------------------------------ geometry (100 x 100 box)

// Round mochi dome whose belly bulges a little, then tucks into the hem; the flat base
// hides under the hem bumps.
const BODY_D = "M50 8C75.5 8 92.5 26 92.5 50C92.5 64 91.3 74 89.8 82H10.2C8.7 74 7.5 64 7.5 50C7.5 26 24.5 8 50 8Z";
const BUMP_X = [19.6, 39.9, 60.1, 80.4];
const BUMP_TOP = 73.5;
const BUMP_RX = 11;
const BUMP_RY = 8.5;

// Stubby arm: a tapered capsule from the shoulder (0,0) to a round mitten, plus a thumb.
// Both subpaths wind clockwise so they union under the nonzero fill rule.
const ARM_D = "M-0.79 -3.41L6.32 -5.06A5.2 5.2 0 1 1 6.32 5.06L-0.79 3.41A3.5 3.5 0 0 1 -0.79 -3.41Z" +
  "M3.81 -4.17A2 2 0 1 1 7.81 -4.17A2 2 0 1 1 3.81 -4.17Z";
const SHOULDER = [86.3, 59];

const EYE_Y = 41;
const EYE_X = { l: 37, r: 63 };
const MOUTH = [50, 46.5];
// Filled crescents keep the face stroke-free: ^ for happy, a soft U for sleepy.
const HAPPY_D = "M-4.4 1.6Q0 -6.4 4.4 1.6A1.12 1.12 0 0 1 2.2 2Q0 -2.4 -2.2 2A1.12 1.12 0 0 1 -4.4 1.6Z";
const CLOSED_D = "M-4.4 0.9Q0 7.3 4.4 0.9A1.12 1.12 0 0 0 2.2 0.5Q0 3.7 -2.2 0.5A1.12 1.12 0 0 0 -4.4 0.9Z";

// Soft mint halo then a slim rim, drawn under the white fill of every body part.
// Arms get a tighter halo because it spills over the body in front of which they sit.
const halo = (width, opacity = 1) =>
  `fill="${AURA}" stroke="${AURA}" stroke-width="${width}" stroke-linejoin="round" opacity="${opacity}"`;
const LAYER = { aura: halo(7, 0.45), rim: halo(2.2), armAura: halo(4.4, 0.4), armRim: halo(2) };

const PSST_DOTS = [[95.5, 46.5, 1.8], [101, 44, 2.1], [106.6, 41.4, 2.4]]; // just clear of the leaning halo
const MIST_PUFFS = [[-3.8, -5.6], [-3.5, -8.6], [-1.4, -10.8], [1.6, -11.2], [4.2, -9.6],
  [5, -6.8], [3.8, -4.2], [1.6, -2.4], [0.5, 0.2], [0.4, 1.6]];
const MIST_DOT = [0.4, 9];
const ZEDS = [[82, 17, 0.8], [89, 9, 1.05]];
const MOTES = [[30, 36, -14], [50, 26, -4], [70, 36, 10], [38, 60, -8], [62, 60, 12]]; // x, y, drift angle
const PETALS = [0, 72, 144, 216, 288].map((a) => {
  const r = (a * Math.PI) / 180;
  return [(2.5 * Math.sin(r)).toFixed(2), (-2.5 * Math.cos(r)).toFixed(2)];
});

// ------------------------------------------------------------ markup

function markup(id) {
  return `<div class="hush-shadow"></div>
<div class="hush-bob"><div class="hush-pose"><div class="hush-spin">
<svg class="hush-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
<defs>
<radialGradient id="${id}-body" gradientUnits="userSpaceOnUse" cx="44" cy="40" r="60">
<stop offset=".6" stop-color="${GHOST}"/><stop offset="1" stop-color="#DFF3F0"/></radialGradient>
<radialGradient id="${id}-mitt" cx=".4" cy=".35" r=".7">
<stop offset=".55" stop-color="${GHOST}"/><stop offset="1" stop-color="#DDF3F0"/></radialGradient>
</defs>
${silhouette(LAYER.aura)}
${silhouette(LAYER.rim)}
${silhouette(`fill="url(#${id}-body)"`)}
${face()}
${scarf()}${flowerCrown()}${topHat()}
${arm("l", id)}${arm("r", id)}
</svg></div></div></div>
<svg class="hush-fx" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${effects()}</svg>`;
}

// Body plus four hem bumps; each bump ripples from its top edge, a quarter cycle behind
// the last. Bumps stay in the body's own coordinates so the shared gradient is seamless.
function silhouette(attrs) {
  const bumps = BUMP_X.map((x, i) =>
    `<ellipse class="hush-bump" style="transform-origin:${x}px ${BUMP_TOP}px;animation-delay:${((i - 3) * 0.3).toFixed(1)}s" ` +
    `cx="${x}" cy="${BUMP_TOP + BUMP_RY}" rx="${BUMP_RX}" ry="${BUMP_RY}"/>`).join("");
  return `<g ${attrs}><path d="${BODY_D}"/>${bumps}</g>`;
}

function arm(side, id) {
  const [x, y] = SHOULDER;
  const place = side === "r" ? `translate(${x} ${y})` : `translate(${100 - x} ${y}) scale(-1 1)`;
  return `<g transform="${place}"><g class="hush-arm hush-arm-${side}"><g class="hush-wag">` +
    `<path d="${ARM_D}" ${LAYER.armAura}/><path d="${ARM_D}" ${LAYER.armRim}/><path d="${ARM_D}" fill="url(#${id}-mitt)"/>` +
    `</g></g></g>`;
}

function face() {
  const eye = (side) => `<g transform="translate(${EYE_X[side]} ${EYE_Y})"><g class="hush-eye hush-eye-${side}">` +
    `<g class="hush-lid hush-eyes-open"><ellipse rx="4.6" ry="6" fill="${INK}"/>` +
    `<circle cx="1.5" cy="-2.4" r="1.7" fill="${GHOST}"/><circle cx="-1.6" cy="2.7" r=".8" fill="${GHOST}"/></g>` +
    `<path class="hush-eyes-happy" d="${HAPPY_D}" fill="${INK}"/>` +
    `<path class="hush-eyes-closed" d="${CLOSED_D}" fill="${INK}"/></g></g>`;
  return `<g class="hush-face">
<ellipse class="hush-cheek" cx="27.5" cy="47.5" rx="6" ry="3.4" fill="${CHEEK}" opacity=".6"/>
<ellipse class="hush-cheek" cx="72.5" cy="47.5" rx="6" ry="3.4" fill="${CHEEK}" opacity=".6"/>
${eye("l")}${eye("r")}
<g transform="translate(${MOUTH[0]} ${MOUTH[1]})">
<g class="hush-mouth-smile"><path d="M-3.6 -.6Q0 1.2 3.6 -.6Q3.3 3.8 0 3.8Q-3.3 3.8 -3.6 -.6Z" fill="${INK}"/><ellipse cy="2.6" rx="1.6" ry=".9" fill="${TONGUE}"/></g>
<ellipse class="hush-mouth-o" cy="1.4" rx="2.1" ry="2.5" fill="${INK}"/>
<g class="hush-mouth-grin"><path d="M-5 -1Q0 1.4 5 -1Q4.6 5.4 0 5.4Q-4.6 5.4 -5 -1Z" fill="${INK}"/><ellipse cy="3.9" rx="2.3" ry="1.3" fill="${TONGUE}"/></g>
<rect class="hush-mouth-flat" x="-2.8" y="-.9" width="5.6" height="1.8" rx=".9" transform="translate(1.6 1.4) rotate(-9)" fill="${INK}"/>
</g>
${monocle()}
</g>`;
}

// ------------------------------------------------------------ accessories

function scarf() {
  return `<g class="hush-acc-scarf">
<path d="M24.5 59.5L33.5 61.8L32.3 76.6Q28.2 78 24 76.8Z" fill="${CANDLE}"/>
<path d="M24.1 68.2L32.9 69.2L32.7 71.2L24 70.3ZM23.9 72.6L32.6 73.5L32.5 75.4L23.8 74.6Z" fill="${PINE}"/>
<g fill="${CANDLE}"><circle cx="25.4" cy="77.4" r="1.3"/><circle cx="28.2" cy="77.9" r="1.3"/><circle cx="31" cy="77.4" r="1.3"/></g>
<path d="M7.9 52.6Q50 63.4 92.1 52.6Q93.5 57 92.2 61.2Q50 72.2 7.8 61.2Q6.5 57 7.9 52.6Z" fill="${CANDLE}"/>
<path d="M7.3 56.4Q50 67.1 92.7 56.4L92.8 58.2Q50 69 7.2 58.2Z" fill="${PINE}" opacity=".7"/>
</g>`;
}

function flower(x, y, petal, heart, s = 1) {
  const petals = PETALS.map(([px, py]) => `<circle cx="${px}" cy="${py}" r="2.2"/>`).join("");
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${petal}">${petals}<circle r="1.6" fill="${heart}"/></g>`;
}

function flowerCrown() {
  const leaves = [[21, 20.5, -60], [30.5, 13.4, -35], [43, 9.2, -15], [57, 9.2, 15], [69.5, 13.4, 35], [79, 20.5, 60]]
    .map(([x, y, a]) => `<ellipse rx="2.7" ry="1.3" transform="translate(${x} ${y}) rotate(${a})"/>`).join("");
  return `<g class="hush-acc-flower"><g fill="${LEAF}">${leaves}</g>` +
    flower(25.5, 16.8, CHEEK, CANDLE) + flower(36.5, 11, CANDLE, PINE) + flower(50, 8.6, CHEEK, CANDLE, 1.15) +
    flower(63.5, 11, LILAC, CANDLE) + flower(74.5, 16.8, CHEEK, CANDLE) + `</g>`;
}

// Plum topper with a pink band; the brim is drawn last so it overlaps the crown's base.
function topHat() {
  return `<g class="hush-acc-tophat" transform="translate(55 9.5) rotate(9)">
<path d="M-9 0L-10 -18.6Q-10.1 -20.6 -8 -20.6H8Q10.1 -20.6 10 -18.6L9 0Z" fill="${INK}"/>
<path d="M-9.3 -4.2L-9.55 -8.6H9.55L9.3 -4.2Z" fill="${CHEEK}"/>
<path d="M-6.2 -9.6L-6.9 -18.4Q-6.9 -19 -6.2 -19H-4.8L-4.3 -9.6Z" fill="${GHOST}" opacity=".16"/>
<ellipse rx="15" ry="3.6" fill="${INK}"/>
</g>`;
}

// Lives inside the face group so it follows the right eye when Hush glances.
function monocle() {
  const [x, y] = [EYE_X.r, EYE_Y];
  return `<g class="hush-acc-monocle">
<circle cx="${x}" cy="${y}" r="6.5" fill="${AURA}" opacity=".3"/>
<path d="M${x - 7.8} ${y}a7.8 7.8 0 1 0 15.6 0a7.8 7.8 0 1 0 -15.6 0ZM${x - 6.5} ${y}a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0Z" fill="${PINE_DARK}" fill-rule="evenodd"/>
<path d="M${x - 4.3} ${y - 3.2}Q${x - 2.6} ${y - 5.7} ${x + 0.4} ${y - 5.9}Q${x - 1.7} ${y - 4.4} ${x - 2.9} ${y - 2.4}Z" fill="${GHOST}" opacity=".85"/>
<g fill="${PINE_DARK}"><circle cx="${x + 6.6}" cy="${y + 5.3}" r=".8"/><circle cx="${x + 8.2}" cy="${y + 8.2}" r=".8"/>` +
    `<circle cx="${x + 9.4}" cy="${y + 11.3}" r=".8"/><circle cx="${x + 10.1}" cy="${y + 14.5}" r=".8"/></g>
</g>`;
}

// ------------------------------------------------------------ effects (unclipped overlay)

function effects() {
  const dots = PSST_DOTS.map(([x, y, r], i) =>
    `<g transform="translate(${x} ${y})"><circle class="hush-dot" r="${r}" style="animation-delay:${(i * 0.22).toFixed(2)}s"/></g>`).join("");
  const puffs = (r, dot) => MIST_PUFFS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("") +
    `<circle cx="${MIST_DOT[0]}" cy="${MIST_DOT[1]}" r="${dot}"/>`;
  const zeds = ZEDS.map(([x, y, s], i) =>
    `<g transform="translate(${x} ${y}) scale(${s})"><path class="hush-z" style="animation-delay:${i * 1.5}s" d="M-3.4 -3.4H3.4L-3.4 3.4H3.4"/></g>`).join("");
  const motes = MOTES.map(([x, y, a], i) =>
    `<g transform="translate(${x} ${y}) rotate(${a})"><g class="hush-mote" style="animation-delay:${i * MOTE_STAGGER_MS}ms">` +
    `<circle r="5" fill="${AURA}" opacity=".55"/><circle r="3.4" fill="${GHOST}"/></g></g>`).join("");
  return `<g class="hush-fx-psst" fill="${INK}" fill-opacity=".7">${dots}</g>
<g class="hush-fx-mist" transform="translate(86 13)"><g class="hush-mist">` +
    `<g fill="${AURA}" opacity=".75">${puffs(3.1, 3.4)}</g><g fill="${GHOST}">${puffs(2, 2.3)}</g></g></g>
<g class="hush-fx-zz" fill="none" stroke="${INK}" stroke-opacity=".55" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${zeds}</g>
<g class="hush-fx-motes">${motes}</g>`;
}

// ------------------------------------------------------------ styles

// SVG parts transform about their local origin (eyes, arms and effects sit in translated
// wrappers; bumps name their pivot in user units). Bob, poses and spin run on plain divs.
const BASE_CSS = `
.hush { --hush-size: 96px; position: relative; display: inline-block; vertical-align: bottom; width: var(--hush-size); height: var(--hush-size); }
.hush-peek { height: calc(var(--hush-size) * ${PEEK_LINE}); -webkit-clip-path: inset(-150% -100% 0 -100%); clip-path: inset(-150% -100% 0 -100%); }
.hush-bob, .hush-fx { position: absolute; left: 0; top: 0; width: var(--hush-size); height: var(--hush-size); }
.hush-pose, .hush-spin, .hush-svg { display: block; width: 100%; height: 100%; }
.hush-svg, .hush-fx { overflow: visible; }
.hush-fx { pointer-events: none; }
.hush-shadow { position: absolute; left: 28%; top: 93%; width: 44%; height: 5%; border-radius: 50%; background: rgba(59, 47, 92, .12);
  transition: opacity .45s ease; animation: hush-shadow 1.2s ease-in-out infinite alternate; }
.hush-peek .hush-shadow { display: none; }
.hush-bob { animation: hush-bob 1.2s ease-in-out infinite alternate; }
@keyframes hush-bob { from { transform: translateY(3px); } to { transform: translateY(-3px); } }
@keyframes hush-shadow { from { transform: scale(1); } to { transform: scale(.82); } }
.hush-pose { transform-origin: 50% 88%; transition: transform .4s cubic-bezier(.34, 1.36, .64, 1); }
.hush-spin { transform-origin: 50% 50%; }
.hush-spinning .hush-spin { animation: hush-spin ${SPIN_MS}ms cubic-bezier(.55, 0, .3, 1); }
.hush-spinning .hush-pose { animation: hush-hop ${SPIN_MS}ms ease-in-out; }
@keyframes hush-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes hush-hop { 0%, 100% { transform: translateY(0); } 45% { transform: translateY(-8%); } }
.hush-svg { transition: opacity .45s ease; }
.hush-gone .hush-svg, .hush-gone .hush-shadow { opacity: 0; }
.hush-bump { animation: hush-ripple 1.2s ease-in-out infinite; }
@keyframes hush-ripple { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.04, 1.2); } }
/* The ripple repaints the whole SVG every frame, so stop it when nobody can see the hem:
   below the edge while peeking, or once the body has faded out. */
.hush-peek .hush-bump { animation: none; }
.hush-gone .hush-bump { animation-play-state: paused; }
.hush-arm { transition: transform .32s cubic-bezier(.34, 1.3, .64, 1); }
.hush-wagging .hush-arm-r .hush-wag { animation: hush-wag ${WAVE_MS / 3}ms ease-in-out 3; }
@keyframes hush-wag { 0%, 100% { transform: rotate(0deg); } 30% { transform: rotate(-16deg); } 70% { transform: rotate(14deg); } }
.hush-face { transition: transform .3s ease; }
.hush[data-look="right"] .hush-face { transform: translate(2.6px, -.5px); }
.hush[data-look="left"] .hush-face { transform: translate(-2.4px, -.3px); }
.hush-eye { transition: transform .2s ease; }
.hush[data-eyes="squint"] .hush-eyes-open { display: inline; }
.hush[data-eyes="squint"] .hush-eye-r { transform: scale(1.06, .42); }
.hush-blink .hush-lid { animation: hush-blink ${BLINK_MS}ms ease-in-out; }
@keyframes hush-blink { 50% { transform: scaleY(.08); } }
.hush-cheek { transition: opacity .3s ease; }
.hush[data-blush] .hush-cheek { opacity: .9; }
.hush-dot { animation: hush-psst 1.8s ease-out infinite both; }
@keyframes hush-psst { 0% { opacity: 0; transform: scale(.2); } 14%, 60% { opacity: 1; transform: scale(1); } 78%, 100% { opacity: 0; transform: scale(1); } }
.hush-mist { animation: hush-mist 2.8s ease-out infinite; }
@keyframes hush-mist { 0% { opacity: 0; transform: translateY(5px) scale(.85); } 22% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(-14px) scale(1.08); } }
.hush-z { animation: hush-z 3s ease-in-out infinite both; }
@keyframes hush-z { 0% { opacity: 0; transform: translate(0, 0) scale(.6); } 25% { opacity: 1; } 100% { opacity: 0; transform: translate(6px, -15px) scale(1.15); } }
.hush-mote { opacity: 0; animation: hush-mote ${MOTE_MS}ms ease-out both; }
@keyframes hush-mote { 0% { opacity: 0; transform: translateY(0) scale(.5); } 20% { opacity: 1; transform: translateY(-5px) scale(1); } 100% { opacity: 0; transform: translateY(-36px) scale(.6); } }
`;

// Everything holds still except the blink; goodbye simply fades.
const REDUCED_CSS = `
@media (prefers-reduced-motion: reduce) {
  .hush-bob, .hush-shadow, .hush-bump, .hush-dot, .hush-mist, .hush-z, .hush-mote,
  .hush-spinning .hush-spin, .hush-spinning .hush-pose, .hush-wagging .hush-arm-r .hush-wag { animation: none; }
  .hush-pose, .hush-arm, .hush-face, .hush-eye { transition: none; }
}
`;

function buildCss() {
  const rules = [];
  for (const [pose, [x, y, a]] of Object.entries(ARM_POSES)) {
    rules.push(`.hush[data-larm="${pose}"] .hush-arm-l, .hush[data-rarm="${pose}"] .hush-arm-r { transform: translate(${x}px, ${y}px) rotate(${a}deg); }`);
  }
  for (const [pose, [y, a, s]] of Object.entries(BODY_POSES)) {
    rules.push(`.hush[data-pose="${pose}"] .hush-pose { transform: translateY(${y}%) rotate(${a}deg) scale(${s}); }`);
  }
  for (const [group, values] of Object.entries(VARIANTS)) {
    for (const v of values) {
      rules.push(`.hush-${group}-${v} { display: none; }`, `.hush[data-${group}="${v}"] .hush-${group}-${v} { display: inline; }`);
    }
  }
  return BASE_CSS + rules.join("\n") + REDUCED_CSS;
}

function injectStyles() {
  if (document.getElementById("hush-styles")) return;
  const style = document.createElement("style");
  style.id = "hush-styles";
  style.textContent = buildCss();
  document.head.appendChild(style);
}

// ------------------------------------------------------------ public API

let uid = 0;

export function createHush(container, { size = 96, peek = false } = {}) {
  injectStyles();
  const id = `hush-${++uid}`;
  const el = document.createElement("div");
  el.className = "hush";
  el.setAttribute("role", "img");
  el.innerHTML = markup(id);

  const state = { expr: "idle", acc: null, fx: null, peek: Boolean(peek), waving: false, gone: false };
  const timers = new Set();
  let seq = 0;          // bumps on every expression change so stale one-shot steps do nothing
  let settle = null;    // resolves the running one-shot's promise
  let waveSeq = 0;
  let waveDone = null;
  let farewellWave = -1; // waveSeq of the wave goodbye started, so interrupting goodbye stops it

  function later(ms, fn) {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  }

  // Re-adding a class only restarts its animation after a style flush in between.
  function replay(cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function render() {
    const def = EXPRESSIONS[state.expr];
    // A peeking Hush holds the edge instead of letting its mittens hang out of sight.
    const arm = (pose) => (state.peek && (pose === "rest" || pose === "droop") ? "grip" : pose);
    Object.assign(el.dataset, {
      expr: state.expr,
      eyes: def.eyes,
      mouth: def.mouth,
      pose: def.pose || "none",
      look: def.look || "none",
      larm: arm(def.arms[0]),
      rarm: state.waving ? "wave" : arm(def.arms[1]),
      fx: state.fx || "none",
      acc: state.acc || "none",
    });
    el.toggleAttribute("data-blush", Boolean(def.blush));
    el.classList.toggle("hush-peek", state.peek);
    el.classList.toggle("hush-gone", state.gone);
    el.setAttribute("aria-label", `Hush the ghost, ${state.expr}`);
  }

  function finishOneShot() {
    el.classList.remove("hush-spinning");
    if (!settle) return;
    const done = settle;
    settle = null;
    done();
  }

  // Runs timed steps for a one-shot expression. A newer expression interrupts it:
  // the remaining steps are dropped and its promise resolves straight away.
  function oneShot(steps) {
    const token = seq;
    return new Promise((resolve) => {
      settle = resolve;
      for (const [at, step] of steps) later(at, () => { if (token === seq) step(); });
    });
  }

  function setExpression(name) {
    const def = EXPRESSIONS[name];
    if (!def) throw new Error(`Hush: unknown expression "${name}"`);
    finishOneShot();
    if (waveSeq === farewellWave) endWave();
    seq += 1;
    state.expr = name;
    state.fx = def.fx || null;
    state.gone = false;
    render();
    if (name === "delighted") return delight();
    if (name === "goodbye") return farewell();
    return Promise.resolve();
  }

  // A hopping spin, a beat to enjoy it, then back to idle (which resolves the promise).
  function delight() {
    replay("hush-spinning");
    return oneShot([
      [SPIN_MS, () => el.classList.remove("hush-spinning")],
      [SPIN_MS + SPIN_HOLD_MS, () => setExpression("idle")],
    ]);
  }

  // Wave, then dissolve into rising motes; stays gone until the next expression.
  // Resolves once the last, most delayed mote has faded.
  function farewell() {
    wave();
    farewellWave = waveSeq;
    const motesDone = WAVE_MS + MOTE_MS + (MOTES.length - 1) * MOTE_STAGGER_MS;
    return oneShot([
      [WAVE_MS, () => { state.gone = true; state.fx = "motes"; render(); }],
      [motesDone, finishOneShot],
    ]);
  }

  function wave() {
    endWave();
    const token = ++waveSeq;
    state.waving = true;
    render();
    replay("hush-wagging");
    return new Promise((resolve) => {
      waveDone = resolve;
      later(WAVE_MS, () => { if (token === waveSeq) endWave(); });
    });
  }

  function endWave() {
    if (!waveDone) return;
    const done = waveDone;
    waveDone = null;
    state.waving = false;
    el.classList.remove("hush-wagging");
    render();
    done();
  }

  function setAccessory(name) {
    const acc = name ?? null;
    if (acc !== null && !ACCESSORIES.includes(acc)) throw new Error(`Hush: unknown accessory "${name}"`);
    state.acc = acc;
    render();
  }

  function setSize(px) {
    if (!(px > 0)) throw new RangeError(`Hush: size must be a positive number of pixels, got ${px}`);
    el.style.setProperty("--hush-size", `${px}px`);
  }

  // The class is always gone again long before the next blink, so a plain add restarts
  // the animation without replay()'s forced layout every few seconds.
  function scheduleBlink() {
    later(3000 + Math.random() * 3000, () => {
      el.classList.add("hush-blink");
      later(BLINK_MS, () => el.classList.remove("hush-blink"));
      scheduleBlink();
    });
  }

  function destroy() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    finishOneShot();
    endWave();
    el.remove();
  }

  setSize(size);
  render();
  scheduleBlink();
  if (container) container.appendChild(el);

  return { el, setExpression, wave, setAccessory, setSize, destroy };
}
