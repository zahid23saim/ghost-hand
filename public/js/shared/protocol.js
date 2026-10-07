// Wire format shared by server and client (spec §4.7, §10.4).
// Snapshots and inputs are compact arrays; everything else is JSON objects.

export const PROTOCOL = 1;

const TAU = Math.PI * 2;
export const angleToByte = (a) => ((Math.round(((a % TAU) + TAU) % TAU / TAU * 256)) & 255);
export const byteToAngle = (b) => (b / 256) * TAU;
const toByte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

// Planchette flags (pf)
export const PF = { SLIDING: 1, CAPTURED: 2, STIR: 4, HINT_SHIFT: 3, HINT_MASK: 0b11000, BLOWING: 32, GUST: 64 };
// Hand flags (hf)
export const HF = { RESTING: 1, COUNTED: 2, STATUS_SHIFT: 2, STATUS_MASK: 0b1100, BOT: 16, VISIBLE: 32 };
export const STATUS = ["ok", "silent", "dozing", "gone"];
// Input flags
export const IF = { RESTING: 1, DEVICE_SHIFT: 1, DEVICE_MASK: 0b110, HIDDEN: 8 };
export const DEVICES = ["pad", "mouse", "keys", "touch"];

// ["s", tick, serverMs, x10, y10, vx10, vy10, pf, sDir, r100, dwellL, dwellP, hands]
export function encodeSnapshot(s) {
  return ["s", s.tick, s.serverMs,
    Math.round(s.x * 10), Math.round(s.y * 10), Math.round(s.vx * 10), Math.round(s.vy * 10),
    s.pf, s.hasDir ? angleToByte(Math.atan2(s.dirY, s.dirX)) : 0,
    Math.min(255, Math.round(s.r * 100)), s.dwellL, Math.round(s.dwellP * 100),
    s.hands.map((h) => [h.seat, h.hidden ? 0 : angleToByte(Math.atan2(h.uy, h.ux)), h.hidden ? 0 : toByte(h.m), h.hf]),
  ];
}

export function decodeSnapshot(a) {
  const pf = a[7];
  const dir = byteToAngle(a[8]);
  return {
    tick: a[1], serverMs: a[2],
    x: a[3] / 10, y: a[4] / 10, vx: a[5] / 10, vy: a[6] / 10,
    sliding: !!(pf & PF.SLIDING), captured: !!(pf & PF.CAPTURED), stir: !!(pf & PF.STIR),
    hint: (pf & PF.HINT_MASK) >> PF.HINT_SHIFT, blowing: !!(pf & PF.BLOWING), gust: !!(pf & PF.GUST),
    dirX: Math.cos(dir), dirY: Math.sin(dir), r: a[9] / 100, dwellL: a[10], dwellP: a[11] / 100,
    hands: a[12].map(([seat, d, m, hf]) => ({
      seat, ux: Math.cos(byteToAngle(d)), uy: Math.sin(byteToAngle(d)), m: m / 255,
      resting: !!(hf & HF.RESTING), counted: !!(hf & HF.COUNTED),
      status: STATUS[(hf & HF.STATUS_MASK) >> HF.STATUS_SHIFT], bot: !!(hf & HF.BOT), visible: !!(hf & HF.VISIBLE),
    })),
  };
}

// ["i", seq, dir, mag, flags]
export function encodeInput(seq, ux, uy, m, resting, device, hidden) {
  const flags = (resting ? IF.RESTING : 0) | ((DEVICES.indexOf(device) & 3) << IF.DEVICE_SHIFT) | (hidden ? IF.HIDDEN : 0);
  return ["i", seq, angleToByte(Math.atan2(uy, ux)), toByte(m), flags];
}

export function decodeInput(a) {
  const ang = byteToAngle(a[2] & 255);
  const flags = a[4] | 0;
  return {
    seq: a[1] | 0, ux: Math.cos(ang), uy: Math.sin(ang), m: Math.max(0, Math.min(1, (a[3] | 0) / 255)),
    resting: !!(flags & IF.RESTING), device: DEVICES[(flags & IF.DEVICE_MASK) >> IF.DEVICE_SHIFT], hidden: !!(flags & IF.HIDDEN),
  };
}
