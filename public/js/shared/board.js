// Board geometry shared by the server simulation and every client (spec §8.5).
// One layout for every device, in board units (bu): the lens at (x, y) must sit
// over the same letter on a phone and on a laptop.

export const BOARD_W = 1000;
export const BOARD_H = 900;

const ROWS = [
  { chars: "ABCDEFGHI", baseY: 300 },
  { chars: "JKLMNOPQR", baseY: 440 },
  { chars: "STUVWXYZ", baseY: 580 },
];

// x = 500 + (i - (n-1)/2) * 100 ; y = baseY + 0.00025 * (x - 500)^2
export const LETTERS = ROWS.flatMap(({ chars, baseY }) => {
  const n = chars.length;
  return [...chars].map((k, i) => {
    const x = 500 + (i - (n - 1) / 2) * 100;
    return { k, x, y: Math.round(baseY + 0.00025 * (x - 500) ** 2) };
  });
});

// Index used on the wire: 0-25 A-Z, 26 YES, 27 NO, 28 GOODBYE.
export const SPECIALS = [
  { k: "YES", label: "YES", x: 150, y: 150, icon: { x: 150, y: 85 } },
  { k: "NO", label: "NO", x: 850, y: 150, icon: { x: 850, y: 85 } },
  { k: "BYE", label: "GOODBYE", x: 500, y: 760, banner: { w: 460, h: 90 } },
];

export const TARGETS = [...LETTERS, ...SPECIALS];
export const TARGET_BY_KEY = Object.fromEntries(TARGETS.map((t) => [t.k, t]));
export const KEY_INDEX = Object.fromEntries(TARGETS.map((t, i) => [t.k, i]));
export const keyOfIndex = (i) => (i >= 0 && i < TARGETS.length ? TARGETS[i].k : null);

export const HOME = { x: 500, y: 680 };
export const LENS_BOUNDS = { x0: 60, x1: 940, y0: 70, y1: 820 };

export function nearestTarget(x, y, keys = null) {
  let best = null;
  let bd = Infinity;
  for (const t of TARGETS) {
    if (keys && !keys.includes(t.k)) continue;
    const d = (t.x - x) ** 2 + (t.y - y) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return { target: best, dist: Math.sqrt(bd) };
}
