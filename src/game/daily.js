// Daily question (spec §6.6): one question per UTC date, the same for everyone.
// Pure: the Worker uses it for /api/daily and the Room DO for ?daily=1 rooms.

export const utcDate = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

// FNV-1a, so the pick is stable across runtimes.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// Never the kids pack; sorted by id so the order of the bank file doesn't matter.
export function dailyQuestion(content, date) {
  const pool = content.questions.QUESTIONS.filter((q) => q.pack !== "kids").sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!pool.length) return null;
  const q = pool[hash("ghost-hand:" + date) % pool.length];
  return { date, qId: q.id, ask: q.ask, pack: q.pack };
}
