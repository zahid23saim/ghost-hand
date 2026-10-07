// Ghost Hand - little category doodles for the word cards (inline SVG, ink on cream).

const INK = "#F3E9D2";
const FILLS = ["#FFC94D", "#5EF2D0", "#FF8FB1", "#A98BE8", "#FF9F6B"];

const SHAPES = {
  CREATURE: (f) => `<ellipse cx="32" cy="38" rx="13" ry="11" fill="${f}"/><circle cx="18" cy="24" r="5" fill="${f}"/><circle cx="27" cy="17" r="5" fill="${f}"/><circle cx="37" cy="17" r="5" fill="${f}"/><circle cx="46" cy="24" r="5" fill="${f}"/>`,
  FOOD: (f) => `<path d="M16 32h32l-4 18H20z" fill="${f}"/><path d="M16 32c0-9 7-15 16-15s16 6 16 15" fill="#fff"/><circle cx="32" cy="14" r="4" fill="#FF7A6B" stroke="none"/>`,
  THING: (f) => `<path d="M16 28h28v14a10 10 0 0 1-10 10h-8a10 10 0 0 1-10-10z" fill="${f}"/><path d="M44 32h4a5 5 0 0 1 0 10h-4"/><path d="M24 28v-4h12v4M30 20v4"/>`,
  PLACE: (f) => `<path d="M14 30L32 14l18 16" fill="none"/><rect x="19" y="29" width="26" height="21" rx="2" fill="${f}"/><rect x="28" y="38" width="8" height="12" fill="#fff"/>`,
  MOOD: (f) => `<circle cx="32" cy="33" r="17" fill="${f}"/><circle cx="26" cy="29" r="1.6" fill="#14122B"/><circle cx="38" cy="29" r="1.6" fill="#14122B"/><path d="M25 38c4 4 10 4 14 0" fill="none"/>`,
  ACTION: (f) => `<circle cx="34" cy="14" r="5" fill="${f}"/><path d="M33 20l-4 14 8 6 2 10M29 34l-9 6M33 24l9 6M29 34l-3 14" fill="none"/>`,
  NUMBER: (f) => `<rect x="14" y="14" width="36" height="36" rx="9" fill="${f}"/><circle cx="24" cy="24" r="3" fill="#14122B"/><circle cx="40" cy="40" r="3" fill="#14122B"/><circle cx="32" cy="32" r="3" fill="#14122B"/>`,
  TIME: (f) => `<circle cx="32" cy="33" r="17" fill="${f}"/><path d="M32 23v10l7 5" fill="none"/>`,
  WEAR: (f) => `<path d="M14 40c0-12 8-22 18-22s18 10 18 22z" fill="${f}"/><path d="M10 40h44" /><circle cx="32" cy="15" r="4" fill="#fff"/>`,
  JOB: (f) => `<rect x="14" y="24" width="36" height="24" rx="5" fill="${f}"/><path d="M26 24v-5h12v5M14 34h36" fill="none"/>`,
  TOY: (f) => `<circle cx="32" cy="34" r="16" fill="${f}"/><path d="M17 30c10 4 20 4 30 0M20 44c8-6 16-6 24 0" fill="none"/>`,
  SOUND: (f) => `<path d="M14 27h8l10-8v26l-10-8h-8z" fill="${f}"/><path d="M38 25a10 10 0 0 1 0 14M43 20a17 17 0 0 1 0 24" fill="none"/>`,
  TUT: (f) => `<path d="M32 50S12 38 12 25a10 10 0 0 1 20-3 10 10 0 0 1 20 3c0 13-20 25-20 25z" fill="${f}"/>`,
};

export function doodle(cat, word = "") {
  let h = 0;
  for (const c of word) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const fill = FILLS[h % FILLS.length];
  const shape = (SHAPES[cat] || SHAPES.TUT)(fill);
  return `<svg class="doodle" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${shape}</g></svg>`;
}
