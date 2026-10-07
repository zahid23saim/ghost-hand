// Build-time content check (spec §7.7). Run: node tools/check-content.mjs [--all]
// Loads the content modules, checks every string against blocklist.txt (with allowlist.txt
// exceptions), checks bank sizes and word tags (A-Z, article, packs, kids), every word-pair join
// a sentence or the ribbon can produce (base frames and appended clauses), the frame text at
// each sentence edge, every hand-spelled prefix, per-pack word pools, and all 5,625 room codes.
// Writes blocked-codes.js. Exit code 1 on any failure. --all prints every failure instead of
// the first 300 per check. GH_CONTENT_DIR=<dir> checks another content folder.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const t0 = Date.now();
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = process.env.GH_CONTENT_DIR ? resolve(process.env.GH_CONTENT_DIR) : join(ROOT, "public", "js", "shared", "content");
const PRINT_ALL = process.argv.includes("--all");
const PRINT_CAP = 300;

const CATEGORIES = ["CREATURE", "FOOD", "THING", "PLACE", "MOOD", "ACTION", "NUMBER", "TIME", "WEAR", "JOB", "TOY", "SOUND"];
const PACKS = ["cozy", "office", "travel", "mystery", "chai", "kids", "filmy", "school", "party"];
const PACK_NAMES = {
  "cozy kitchen": "cozy", "office haunts": "office", "travel tales": "travel",
  "tiny mysteries": "mystery", "chai time": "chai", "kids table": "kids",
  "filmy nights": "filmy", "school days": "school", "office party": "party",
};
const TONES = ["sensible", "absurd", "sweet"];
const HUSH_COUNTS = { arrive: 8, pick: 7, silence: 4, stir: 8, breakaway: 8, wobble: 8, help: 7, foresight: 6, reveal: 6, goodbye: 6, idle: 12, join: 6 };
const HUSH_TOTAL = Object.values(HUSH_COUNTS).reduce((a, b) => a + b, 0);
const MIN_WORDS = 30; // per category; packs may add more, keeping the tones balanced
const QUESTIONS_PER_PACK = 8;
const REACTION_COUNT = 36;
const CONSONANTS = "BDFGHKLMNPRSTVZ";
const VOWELS = "AEIOU";
const REQUIRED_MODULES = ["questions.js", "words.js", "hush-lines.js", "names.js"];
const GENERATED = "blocked-codes.js";
// Words whose article does not follow the spelling rule below: WORD -> "A" | "AN".
const ARTICLE_EXCEPTIONS = {};
// "AN" before a vowel sound: vowel letters, except a "you"/"w" sound (UNICORN, USER, EWE, ONE);
// silent-H words take "AN" (HOUR, HONEST).
function expectedArticle(w) {
  if (ARTICLE_EXCEPTIONS[w]) return ARTICLE_EXCEPTIONS[w];
  if (/^(HOUR|HONEST|HONOU?R|HEIR)/.test(w)) return "AN";
  if (/^(UNI|USE|USU|USA|URA|URI|URO|UKU|UTE|EU|EW|ONE|ONCE)/.test(w)) return "A";
  return /^[AEIOU]/.test(w) ? "AN" : "A";
}

// ---------------------------------------------------------------- reporting

const failures = new Map(); // check -> [lines]
const warnings = new Map(); // group -> [lines]
const stats = {};
function fail(check, msg) {
  if (!failures.has(check)) failures.set(check, []);
  failures.get(check).push(msg);
}
function warn(msg, group = "misc") {
  if (!warnings.has(group)) warnings.set(group, []);
  warnings.get(group).push(msg);
}
function count(key, n = 1) { stats[key] = (stats[key] || 0) + n; }

// ---------------------------------------------------------------- matching

// Aho-Corasick over a-z: one pass per string finds every blocked (or allowed) substring.
function buildMatcher(entries) {
  const next = [new Int32Array(26).fill(-1)];
  const out = [[]];
  const link = [0];
  for (const w of entries) {
    let s = 0;
    for (let i = 0; i < w.length; i++) {
      const c = w.charCodeAt(i) - 97;
      if (next[s][c] === -1) {
        next[s][c] = next.length;
        next.push(new Int32Array(26).fill(-1));
        out.push([]);
        link.push(0);
      }
      s = next[s][c];
    }
    out[s].push(w);
  }
  const queue = [];
  for (let c = 0; c < 26; c++) {
    const t = next[0][c];
    if (t === -1) next[0][c] = 0;
    else queue.push(t);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const s = queue[qi];
    for (let c = 0; c < 26; c++) {
      const t = next[s][c];
      if (t === -1) next[s][c] = next[link[s]][c];
      else {
        link[t] = next[link[s]][c];
        out[t] = out[t].concat(out[link[t]]);
        queue.push(t);
      }
    }
  }
  return { next, out };
}

function scan(m, s) {
  let hits = null;
  let st = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) - 97;
    if (c < 0 || c > 25) { st = 0; continue; }
    st = m.next[st][c];
    const o = m.out[st];
    if (o.length) {
      if (!hits) hits = [];
      for (const w of o) hits.push({ word: w, start: i - w.length + 1, end: i + 1 });
    }
  }
  return hits;
}

function readList(file, lower) {
  const path = join(CONTENT, file);
  if (!existsSync(path)) { fail("setup", `missing ${file}`); return []; }
  const seen = new Set();
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const norm = line.toLowerCase().replace(/[^a-z]/g, "");
    if (norm !== (lower ? line : line.toLowerCase())) warn(`${file}: entry "${line}" should be ${lower ? "lowercase" : "uppercase"} letters only`);
    if (!lower && line !== line.toUpperCase()) warn(`${file}: entry "${line}" should be uppercase`);
    if (norm) seen.add(norm);
  }
  return [...seen];
}

const BLOCK = readList("blocklist.txt", true);
const ALLOW = readList("allowlist.txt", false);
const blockM = buildMatcher(BLOCK);
const allowM = buildMatcher(ALLOW);

const letters = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");

// Blocked hits in s (lowercase a-z) that are not fully inside an allowlisted word occurrence.
function badHits(s) {
  const hits = scan(blockM, s);
  if (!hits) return null;
  const allows = scan(allowM, s);
  const bad = allows ? hits.filter((h) => !allows.some((a) => a.start <= h.start && a.end >= h.end)) : hits;
  return bad.length ? bad : null;
}

// ---------------------------------------------------------------- loading

const modules = {}; // file -> namespace
async function loadModules() {
  const files = existsSync(CONTENT) ? readdirSync(CONTENT).filter((f) => f.endsWith(".js") && f !== GENERATED) : [];
  for (const f of REQUIRED_MODULES) if (!files.includes(f)) fail("setup", `missing module ${f}`);
  for (const f of files.sort()) {
    try {
      modules[f] = await import(pathToFileURL(join(CONTENT, f)).href);
    } catch (e) {
      fail("setup", `${f} failed to load: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------- normalising

const TEXT_KEYS = ["word", "w", "text", "t", "value"];
const FRAME_KEYS = ["frame", "hidden", "template", "sentence", "f"];
const ASK_KEYS = ["ask", "question", "q", "public", "title"];
const firstString = (o, keys) => { for (const k of keys) if (typeof o[k] === "string") return o[k]; return null; };
const catOf = (v) => (typeof v === "string" && CATEGORIES.includes(v.toUpperCase()) ? v.toUpperCase() : null);
function packOf(v) {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (PACKS.includes(s)) return s;
  if (PACK_NAMES[s]) return PACK_NAMES[s];
  const head = s.split(/[\s_-]+/)[0];
  if (head === "tiny" || head.startsWith("myster")) return "mystery";
  if (head === "kid") return "kids";
  return PACKS.includes(head) ? head : null;
}
const kidsOf = (o) => o.kids ?? o.kidsSafe ?? o.kidSafe ?? o.kid;

// Under a category key every string (or word object) is a word, well formed or not: malformed
// ones are kept so check (2) can fail them by name instead of silently dropping them.
function extractWords(v, ctx, path, out) {
  if (typeof v === "string") {
    if (ctx.cat) out.push({ text: v.trim(), raw: v, cat: ctx.cat, tone: ctx.tone, kids: ctx.kids, packs: ctx.packs, article: undefined, path });
    return;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => extractWords(x, ctx, `${path}[${i}]`, out)); return; }
  if (!v || typeof v !== "object") return;
  const text = firstString(v, TEXT_KEYS);
  if (text !== null && (ctx.cat || catOf(v.cat ?? v.category ?? v.c) || /^[A-Za-z]+$/.test(text.trim()))) {
    out.push({
      text: text.trim(),
      raw: text,
      cat: catOf(v.cat ?? v.category ?? v.c) || ctx.cat,
      tone: (v.tone ?? v.kind ?? ctx.tone)?.toString().toLowerCase(),
      kids: kidsOf(v) ?? ctx.kids,
      packs: v.packs ?? v.pack ?? v.p ?? ctx.packs,
      // Article tag: room-core uses `an: true|false`; "A"/"AN" strings are accepted too.
      article: typeof v.an === "boolean" ? (v.an ? "AN" : "A") : v.article ?? v.art ?? (typeof v.a === "string" && /^an?$/i.test(v.a.trim()) ? v.a : undefined),
      obj: true,
      path,
    });
    return;
  }
  for (const [k, x] of Object.entries(v)) {
    if (/prompt|doodle|label|title|desc|icon|colou?r/i.test(k)) continue;
    const nctx = { ...ctx };
    if (catOf(k)) nctx.cat = catOf(k);
    else if (TONES.includes(k.toLowerCase())) nctx.tone = k.toLowerCase();
    extractWords(x, nctx, `${path}.${k}`, out);
  }
}

function extractPrompts(v, ctx, path, inPrompt, out) {
  if (typeof v === "string") {
    if (inPrompt && ctx.cat) out.push({ text: v, cat: ctx.cat, path });
    return;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => extractPrompts(x, ctx, `${path}[${i}]`, inPrompt, out)); return; }
  if (!v || typeof v !== "object") return;
  const cat = catOf(v.cat ?? v.category ?? v.c) || ctx.cat;
  const text = firstString(v, ["prompt", "text", "t"]);
  if (inPrompt && text !== null && cat) { out.push({ text, cat, path }); return; }
  for (const [k, x] of Object.entries(v)) {
    const nctx = { ...ctx, cat };
    if (catOf(k)) nctx.cat = catOf(k);
    extractPrompts(x, nctx, `${path}.${k}`, inPrompt || /prompt/i.test(k), out);
  }
}

function extractQuestions(v, ctx, path, out) {
  if (Array.isArray(v)) { v.forEach((x, i) => extractQuestions(x, ctx, `${path}[${i}]`, out)); return; }
  if (!v || typeof v !== "object") return;
  const frame = firstString(v, FRAME_KEYS);
  const ask = firstString(v, ASK_KEYS);
  if (frame !== null && frame.includes("{") && ask !== null) {
    out.push({ id: v.id ?? path, pack: packOf(v.pack ?? v.p ?? "") || ctx.pack || null, rawPack: v.pack ?? v.p, ask, frame, path });
    return;
  }
  for (const [k, x] of Object.entries(v)) extractQuestions(x, { ...ctx, pack: packOf(k) || ctx.pack }, `${path}.${k}`, out);
}

function extractTexts(v, path, out, keys = ["text", "t", "frame", "line", "template", "clause"]) {
  if (typeof v === "string") { out.push({ text: v, path }); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => extractTexts(x, `${path}[${i}]`, out, keys)); return; }
  if (!v || typeof v !== "object") return;
  const text = firstString(v, keys);
  if (text !== null) { out.push({ text, path, obj: v }); return; }
  for (const [k, x] of Object.entries(v)) extractTexts(x, `${path}.${k}`, out, keys);
}

// Every string anywhere in an export, with its path.
function allStrings(v, path, out) {
  if (typeof v === "string") out.push({ text: v, path });
  else if (Array.isArray(v)) v.forEach((x, i) => allStrings(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) allStrings(x, `${path}.${k}`, out);
}

const SLOT_RE = /\{\s*(?:(an?)\s+)?([A-Za-z]+)\s*\}/gi;
function parseFrame(frame) {
  const slots = [];
  const segs = [];
  let last = 0;
  for (const m of frame.matchAll(SLOT_RE)) {
    segs.push(frame.slice(last, m.index));
    slots.push({ cat: m[2].toUpperCase(), article: !!m[1], raw: m[0] });
    last = m.index + m[0].length;
  }
  segs.push(frame.slice(last));
  return { slots, segs }; // segs.length === slots.length + 1
}

// ---------------------------------------------------------------- main

await loadModules();

const named = []; // { file, name, value }
for (const [file, ns] of Object.entries(modules)) for (const [name, value] of Object.entries(ns)) named.push({ file, name, value });
const fromFile = (file) => named.filter((e) => e.file === file);

// Words
let words = [];
{
  const own = fromFile("words.js");
  const pref = own.filter((e) => /^(words?|word_?bank|bank)$/i.test(e.name));
  for (const e of pref.length ? pref : own.filter((x) => !/prompt|categor|pack|tone/i.test(x.name))) {
    const got = [];
    extractWords(e.value, {}, `words.js ${e.name}`, got);
    words.push(...got);
  }
  if (!words.length) {
    // Maybe the bank lives inside a CATEGORIES export.
    for (const e of own) { const got = []; extractWords(e.value, {}, `words.js ${e.name}`, got); words.push(...got); }
  }
  words = words.filter((w) => w.cat);
  for (const w of words) w.up = w.text.toUpperCase();
}
const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
for (const w of words) byCat[w.cat]?.push(w);
const catWords = Object.fromEntries(CATEGORIES.map((c) => [c, [...new Set(byCat[c].map((w) => w.up))]]));
const articleOf = (w) => {
  const a = w.article;
  if (typeof a === "string" && /^an?$/i.test(a.trim())) return a.trim().toUpperCase();
  return /^[AEIOU]/.test(w.up) ? "AN" : "A";
};
const wordArticle = new Map(words.map((w) => [`${w.cat}|${w.up}`, articleOf(w)]));

// Prompts
const prompts = [];
for (const e of named.filter((x) => x.file === "words.js" || x.file === "questions.js" || /prompt/i.test(x.name))) {
  extractPrompts(e.value, {}, `${e.file} ${e.name}`, /prompt/i.test(e.name), prompts);
}
const promptKeys = new Set();
const uniquePrompts = prompts.filter((p) => { const k = `${p.path}`; if (promptKeys.has(k)) return false; promptKeys.add(k); return true; });

// Questions, clauses, reactions
const questions = [];
for (const e of fromFile("questions.js").filter((x) => !/clause|add.?on|tail|reaction/i.test(x.name))) extractQuestions(e.value, {}, `questions.js ${e.name}`, questions);
const clauses = [];
for (const e of named.filter((x) => /clause|add.?on|tails?$/i.test(x.name))) extractTexts(e.value, `${e.file} ${e.name}`, clauses);
const reactions = [];
for (const e of named.filter((x) => /reaction/i.test(x.name))) extractTexts(e.value, `${e.file} ${e.name}`, reactions);

// Hush lines, tutorial, names
const hush = named.find((e) => e.name === "HUSH_LINES")?.value;
const tutorial = named.find((e) => e.name === "TUTORIAL")?.value;
const seatColours = named.find((e) => e.name === "SEAT_COLOURS")?.value;
const creatures = named.find((e) => e.name === "CREATURES")?.value;
const sitters = named.find((e) => e.name === "SITTERS")?.value;

// ---------------------------------------------------------------- (1) every string

{
  const strings = [];
  for (const e of named) allStrings(e.value, `${e.file} ${e.name}`, strings);
  // Seat names as shown ("Coral Otter"), also read without the space.
  if (Array.isArray(seatColours) && Array.isArray(creatures)) {
    for (const c of seatColours) for (const n of creatures) strings.push({ text: `${c.name}${n}`, path: `names.js seat name "${c.name} ${n}"` });
  }
  for (const s of strings) {
    count("strings");
    const tokens = s.text.replace(/\{[^}]*\}/g, " ").split(/\s+/);
    for (const tok of tokens) {
      const l = letters(tok);
      if (!l) continue;
      const bad = badHits(l);
      if (bad) fail("1 text", `${s.path}: "${tok}" contains ${[...new Set(bad.map((h) => `"${h.word}"`))].join(", ")}`);
    }
    // The same text read with the spaces removed ("Who really" reads WHOREALLY). Spaces are
    // visible on screen, so this only warns. Slot words are checked in (4).
    for (const seg of s.text.split(/\{[^}]*\}/)) {
      const toks = seg.split(/\s+/).map(letters).filter(Boolean);
      if (toks.length < 2) continue;
      const owner = toks.flatMap((t, i) => Array(t.length).fill(i));
      for (const h of badHits(toks.join("")) || []) {
        if (owner[h.start] !== owner[h.end - 1]) warn(`${s.path}: "${seg.trim()}" read without spaces contains "${h.word}"`, "1 spaced");
      }
    }
  }
}

// ---------------------------------------------------------------- (2) words and prompts

{
  if (!words.length) fail("2 words", "no words found in words.js");
  const seenAnywhere = new Map(); // word -> Set(cat)
  for (const c of CATEGORIES) {
    const list = byCat[c];
    if (list.length < MIN_WORDS || list.length % 3) fail("2 words", `${c}: ${list.length} words, expected at least ${MIN_WORDS} and a multiple of 3`);
    const seen = new Set();
    const tones = {};
    for (const w of list) {
      count("words");
      // The board spells the stored string as is, so it must already be 3-7 capitals A-Z.
      if (!/^[A-Z]{3,7}$/.test(w.raw ?? w.text)) fail("2 words", `${w.path}: "${w.raw ?? w.text}" is not 3-7 capital letters A-Z`);
      if (seen.has(w.up)) fail("2 words", `${c}: "${w.up}" appears twice`);
      seen.add(w.up);
      if (!seenAnywhere.has(w.up)) seenAnywhere.set(w.up, new Set());
      seenAnywhere.get(w.up).add(c);
      const t = w.tone ?? "(none)";
      tones[t] = (tones[t] || 0) + 1;
      if (!TONES.includes(t)) fail("2 words", `${w.path}: ${w.up} has tone "${t}", expected sensible, absurd or sweet`);
      // Article tag (spec §7.1): required, and must match how the word sounds.
      const art = typeof w.article === "string" && /^an?$/i.test(w.article.trim()) ? w.article.trim().toUpperCase() : null;
      if (!art) fail("2 words", `${w.path}: ${w.up} has no valid article tag (an: true/false)`);
      else if (art !== expectedArticle(w.up)) fail("2 words", `${w.path}: ${w.up} is tagged "${art} ${w.up}"; expected "${expectedArticle(w.up)} ${w.up}" (add it to ARTICLE_EXCEPTIONS if the tag is right)`);
      // Pack tags: an array of "*" or pack ids (room-core calls packs.includes).
      if (!Array.isArray(w.packs) || !w.packs.length || !w.packs.every((p) => p === "*" || PACKS.includes(p))) {
        fail("2 words", `${w.path}: ${w.up} has packs ${JSON.stringify(w.packs)}, expected an array of "*" or ${PACKS.join("/")}`);
      }
      if (typeof w.kids !== "boolean") fail("2 words", `${w.path}: ${w.up} has kids ${JSON.stringify(w.kids)}, expected true or false`);
      else if (w.kids && w.up.length > 4) fail("2 words", `${w.path}: ${w.up} is kids:true but longer than 4 letters`);
    }
    const toneNames = Object.keys(tones);
    const toneText = toneNames.map((t) => `${t} ${tones[t]}`).join(", ");
    const okNames = toneNames.length === 3 && toneNames.every((t) => TONES.includes(t));
    const per = list.length / 3;
    if (list.length && (!okNames || toneNames.some((t) => tones[t] !== per))) fail("2 words", `${c}: tone counts ${toneText}, expected ${per} of each tone`);
  }
  for (const [w, cats] of seenAnywhere) if (cats.size > 1) fail("2 words", `"${w}" is in ${cats.size} categories: ${[...cats].join(", ")}`);
  const extraCats = [...new Set(words.map((w) => w.cat))].filter((c) => !CATEGORIES.includes(c));
  if (extraCats.length) fail("2 words", `unknown categories: ${extraCats.join(", ")}`);

  const pByCat = Object.fromEntries(CATEGORIES.map((c) => [c, new Set()]));
  for (const p of uniquePrompts) pByCat[p.cat]?.add(p.text.trim());
  for (const c of CATEGORIES) {
    count("prompts", pByCat[c].size);
    if (pByCat[c].size !== 8) fail("2 prompts", `${c}: ${pByCat[c].size} distinct private prompts, expected 8`);
  }
}

// ---------------------------------------------------------------- (3) questions and clauses

const parsedQ = [];
const parsedC = [];
{
  if (questions.length !== QUESTIONS_PER_PACK * PACKS.length) fail("3 questions", `${questions.length} questions, expected ${QUESTIONS_PER_PACK * PACKS.length}`);
  const perPack = Object.fromEntries(PACKS.map((p) => [p, 0]));
  const ids = new Set();
  for (const q of questions) {
    count("questions");
    if (!q.pack || !(q.pack in perPack)) fail("3 questions", `${q.path}: unknown pack "${q.rawPack ?? ""}"`);
    else perPack[q.pack]++;
    if (ids.has(String(q.id))) warn(`question id "${q.id}" is used twice`);
    ids.add(String(q.id));
    const pf = parseFrame(q.frame);
    if (pf.slots.length !== 3) fail("3 questions", `${q.id}: frame has ${pf.slots.length} slots, expected 3: "${q.frame}"`);
    for (const s of pf.slots) if (!CATEGORIES.includes(s.cat)) fail("3 questions", `${q.id}: unknown category {${s.cat}}`);
    const outside = pf.segs.join(" ");
    if (outside !== outside.toUpperCase()) warn(`${q.id}: frame text is not ALL CAPS: "${q.frame}"`);
    parsedQ.push({ ...q, ...pf });
  }
  for (const p of PACKS) if (perPack[p] !== QUESTIONS_PER_PACK) fail("3 questions", `pack ${p}: ${perPack[p]} questions, expected ${QUESTIONS_PER_PACK}`);

  if (clauses.length !== 24) fail("3 clauses", `${clauses.length} add-on clauses, expected 24`);
  for (const c of clauses) {
    count("clauses");
    const pf = parseFrame(c.text);
    if (pf.slots.length !== 1) fail("3 clauses", `${c.path}: clause has ${pf.slots.length} slots, expected 1: "${c.text}"`);
    for (const s of pf.slots) if (!CATEGORIES.includes(s.cat)) fail("3 clauses", `${c.path}: unknown category {${s.cat}}`);
    if (pf.slots.length) parsedC.push({ id: c.obj?.id ?? c.path, text: c.text, ...pf });
  }
}

// ---------------------------------------------------------------- (4) joins through the frame

// A junction is two neighbouring slots and the frame text strictly between them, spaces removed.
// The second slot's article ("A"/"AN") is rendered between the two words too, so it is part of
// the join ("AS A SCARF" reads ASASCARF, not ASSCARF). Junctions inside a question's base frame
// are failures; junctions made by appending add-on clauses (base + clause, clause + clause) are
// reported as warnings.
const MAXLEN = Math.max(1, ...BLOCK.map((w) => w.length), ...ALLOW.map((w) => w.length));
const junctions = new Map(); // key -> { catA, mid, catB, article, base, where[] }
function addJunction(catA, midText, slotB, where, base) {
  const catB = slotB.cat;
  if (!CATEGORIES.includes(catA) || !CATEGORIES.includes(catB)) return;
  const mid = letters(midText);
  const key = `${catA}|${mid}|${catB}|${slotB.article ? 1 : 0}`;
  if (!junctions.has(key)) junctions.set(key, { catA, mid, catB, article: slotB.article, base: false, where: [] });
  const j = junctions.get(key);
  j.base = j.base || base;
  if (base) j.where.unshift(where);
  else j.where.push(where);
}
for (const q of parsedQ) {
  for (let i = 0; i + 1 < q.slots.length; i++) addJunction(q.slots[i].cat, q.segs[i + 1], q.slots[i + 1], `${q.id} slots ${i + 1}-${i + 2}`, true);
  const lastI = q.slots.length - 1; // add-on clauses are appended after the base frame (spec §7.1)
  if (lastI >= 0) for (const c of parsedC) addJunction(q.slots[lastI].cat, q.segs[lastI + 1] + " " + c.segs[0], c.slots[0], `${q.id} + ${c.id}`, false);
}
for (const a of parsedC) for (const b of parsedC) if (a !== b) addJunction(a.slots[0].cat, a.segs[1] + " " + b.segs[0], b.slots[0], `${a.id} + ${b.id}`, false);

// "AN" + word hits ("AN USHER" reads ANUSHER) do not depend on the junction: report once per word.
const articleHits = new Map(); // key -> { text, word, base, where[] }
function articleHit(j, art, b, word) {
  const key = `${j.catB}|${art}|${b}|${word}`;
  if (!articleHits.has(key)) articleHits.set(key, { cat: j.catB, text: `${art} ${b}`.toUpperCase(), word, base: false, where: new Set() });
  const e = articleHits.get(key);
  if (j.base && !e.base) e.where.clear();
  e.base = e.base || j.base;
  if (j.base || !e.base) e.where.add(j.where[0]);
}

// Hits that cross a word/frame boundary, deduplicated by the words they actually touch.
function junctionHits(j) {
  const as = (catWords[j.catA] || []).map((w) => w.toLowerCase());
  const bs = (catWords[j.catB] || []).map((w) => ({
    b: w.toLowerCase(),
    art: j.article ? (wordArticle.get(`${j.catB}|${w}`) || "A").toLowerCase() : "",
  }));
  const mid = j.mid;
  const found = new Map();
  const add = (a, b, art, word) => {
    const key = `${a ?? "*"}|${b ? art + "|" + b : "*"}|${!a && !b ? art : ""}|${word}`;
    if (!found.has(key)) found.set(key, { a, b, art, word });
  };
  let joins = 0;
  if (mid.length >= MAXLEN) {
    // Long frame text: the two sides cannot share a blocked or allowed word, so check them apart.
    for (const a of as) {
      joins++;
      for (const h of badHits(a + mid) || []) if (h.start < a.length && h.end > a.length) add(a, null, "", h.word);
    }
    for (const { b, art } of bs) {
      joins++;
      const t = mid + art + b;
      const bStart = t.length - b.length;
      for (const h of badHits(t) || []) {
        if (h.end <= mid.length || h.start >= bStart) continue; // frame-only (below) or inside b
        if (h.start >= mid.length) { articleHit(j, art, b, h.word); continue; }
        add(null, h.end > bStart ? b : null, art, h.word);
      }
    }
    for (const h of badHits(mid) || []) add(null, null, "", h.word);
  } else {
    for (const a of as) for (const { b, art } of bs) {
      joins++;
      const t = a + mid + art + b;
      const bad = badHits(t);
      if (!bad) continue;
      const bStart = t.length - b.length;
      for (const h of bad) {
        if (h.end <= a.length || h.start >= bStart) continue; // inside one word: check (1)
        if (h.start >= a.length + mid.length) { articleHit(j, art, b, h.word); continue; }
        add(h.start < a.length ? a : null, h.end > bStart ? b : null, art, h.word);
      }
    }
  }
  return { found: [...found.values()], joins };
}

{
  let joins = 0;
  let clauseHits = 0;
  for (const j of junctions.values()) {
    if (j.base && j.mid === "" && !j.article) continue; // reads exactly like the ribbon: check (5)
    const r = junctionHits(j);
    joins += r.joins;
    const where = j.where.length > 1 ? `${j.where[0]} (+${j.where.length - 1} more)` : j.where[0];
    for (const h of r.found) {
      const parts = [h.a, j.mid, h.art, h.b].filter(Boolean).map((p) => p.toUpperCase());
      const msg = `${where}: ${parts.join(" + ")} -> "${parts.join("")}" contains "${h.word}"`;
      // Clause joins are real sentences too (room-core appends clauses in every pack): fail both.
      if (j.base) fail("4 frame join", msg);
      else { clauseHits++; fail("4 clause join", msg); }
    }
  }
  for (const e of articleHits.values()) {
    const msg = `{a ${e.cat}}: "${e.text}" reads "${e.text.replace(" ", "")}", which contains "${e.word}" (${[...e.where].slice(0, 3).join(", ")}${e.where.size > 3 ? ", ..." : ""})`;
    fail(e.base ? "4 frame join" : "4 clause join", msg);
  }
  count("frame joins", joins);
  count("junctions", junctions.size);
  if (clauseHits) stats["clause-junction hits"] = clauseHits;
}

// Edges: the frame text before a base frame's first slot, and after the last slot of a base
// frame or of any clause (either can end the sentence), read with spaces removed and joined to
// every word that can fill that slot.
{
  let joins = 0;
  const seen = new Set();
  const edge = (where, text, slot, side) => {
    const t = letters(text);
    if (!t || !CATEGORIES.includes(slot.cat)) return;
    for (const h of badHits(t) || []) {
      const id = `${where}|${side}|${h.word}`;
      if (!seen.has(id)) { seen.add(id); fail("4 frame edge", `${where}: frame text "${text.trim()}" reads "${t.toUpperCase()}", which contains "${h.word}"`); }
    }
    for (const w of catWords[slot.cat] || []) {
      joins++;
      const lw = w.toLowerCase();
      const art = slot.article ? (wordArticle.get(`${slot.cat}|${w}`) || "A").toLowerCase() : "";
      const s = side === "lead" ? t + art + lw : lw + t;
      const cut = side === "lead" ? t.length : lw.length; // a hit must cross this boundary
      for (const h of badHits(s) || []) {
        if (!(h.start < cut && h.end > cut)) continue;
        const id = `${where}|${side}|${w}|${h.word}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const shown = side === "lead" ? [t, art, lw] : [lw, t];
        fail("4 frame edge", `${where}: ${shown.filter(Boolean).map((p) => p.toUpperCase()).join(" + ")} -> "${s.toUpperCase()}" contains "${h.word}"`);
      }
    }
  };
  for (const q of parsedQ) {
    if (!q.slots.length) continue;
    edge(`${q.id} start`, q.segs[0], q.slots[0], "lead");
    edge(`${q.id} end`, q.segs[q.slots.length], q.slots[q.slots.length - 1], "trail");
  }
  for (const c of parsedC) edge(`${c.id} end`, c.segs[c.slots.length], c.slots[c.slots.length - 1], "trail");
  count("edge joins", joins);
}

// ---------------------------------------------------------------- (5) ribbon pairs

// The ribbon shows slot words side by side with no filler, for every neighbouring pair of slots
// (base frame and appended clauses). The second word is spelled letter by letter, so a blocked
// substring counts if any prefix shows it: an allowlisted word only excuses it if that word is
// already complete at the letter where the blocked substring first appears.
function firstSeenBad(s, from) {
  const hits = scan(blockM, s);
  if (!hits) return null;
  const allows = scan(allowM, s) || [];
  const bad = hits.filter((h) => h.end > from && !allows.some((a) => a.end === h.end && a.start <= h.start));
  return bad.length ? bad : null;
}
{
  const pairs = new Map();
  for (const j of junctions.values()) {
    const k = `${j.catA}|${j.catB}`;
    if (!pairs.has(k) || (j.base && !pairs.get(k).base)) pairs.set(k, { where: j.where[0], base: j.base });
  }
  let joins = 0;
  const reported = new Set();
  const checkPair = (where, a, b) => {
    joins++;
    const bad = firstSeenBad((a + b).toLowerCase(), a.length);
    if (!bad) return;
    for (const h of bad) {
      if (h.start >= a.length) continue; // inside the second word: checks (1) and (6)
      const k = h.end - a.length;
      const id = `${a}|${b.slice(0, k)}|${h.word}`;
      if (reported.has(id)) continue;
      reported.add(id);
      fail("5 ribbon", `${where}: ${a} | ${b.slice(0, k)}${k < b.length ? "..." : ""} -> "${(a + b.slice(0, k)).toUpperCase()}" contains "${h.word}"`);
    }
  };
  for (const [k, { where }] of pairs) {
    const [ca, cb] = k.split("|");
    for (const a of catWords[ca] || []) for (const b of catWords[cb] || []) checkPair(`${ca}+${cb} (${where})`, a, b);
  }
  if (tutorial && Array.isArray(tutorial.options) && typeof tutorial.naniWord === "string") {
    for (const o of tutorial.options) checkPair("tutorial", tutorial.naniWord.toUpperCase(), String(o).toUpperCase());
  }
  count("ribbon joins", joins);
}

// ---------------------------------------------------------------- (6) hand-spelled prefixes

{
  const spelled = new Map();
  for (const w of words) spelled.set(w.up, w.path);
  if (tutorial) for (const w of [tutorial.naniWord, ...(tutorial.options || [])]) if (typeof w === "string") spelled.set(w.toUpperCase(), "hush-lines.js TUTORIAL");
  for (const [w, path] of spelled) {
    count("prefixes", Math.max(0, w.length - 1));
    for (const h of firstSeenBad(w.toLowerCase(), 0) || []) {
      if (h.end >= w.length) continue; // first seen in the whole word: check (1)
      fail("6 prefix", `${path}: prefix "${w.slice(0, h.end)}" of ${w} contains "${h.word}"`);
    }
  }
}

// ---------------------------------------------------------------- (7) room codes

{
  const blocked = [];
  let n = 0;
  for (const c1 of CONSONANTS) for (const v1 of VOWELS) for (const c2 of CONSONANTS) for (const v2 of VOWELS) {
    n++;
    const code = c1 + v1 + c2 + v2;
    if (badHits(code.toLowerCase())) blocked.push(code);
  }
  count("room codes", n);
  stats["room codes blocked"] = blocked.length;
  if (n !== 5625) fail("7 codes", `generated ${n} room codes, expected 5625`);
  const rows = [];
  for (let i = 0; i < blocked.length; i += 12) rows.push("  " + blocked.slice(i, i + 12).map((c) => `"${c}"`).join(", ") + ",");
  const body = [
    "// Generated by tools/check-content.mjs. Do not edit by hand.",
    "// CVCV room codes (consonants BDFGHKLMNPRSTVZ, vowels AEIOU) that contain a blocklist entry.",
    "",
    "export const BLOCKED_CODES = [",
    ...rows,
    "];",
    "",
  ].join("\n");
  try {
    writeFileSync(join(CONTENT, GENERATED), body);
  } catch (e) {
    fail("7 codes", `could not write ${GENERATED}: ${e.message}`);
  }
}

// ---------------------------------------------------------------- (8) kids table

// Pools as room-core's pickOptions builds them: words tagged "*" or the pack, and at the Kids
// Table only kids:true words of 3-4 letters. Clauses are appended in every pack, so their
// categories count for every pack, the Kids Table included.
{
  const inPack = (w, p) => Array.isArray(w.packs) && (w.packs.includes("*") || w.packs.includes(p)) && (p !== "kids" || (w.kids === true && w.up.length <= 4));
  const clauseCats = new Set(parsedC.flatMap((c) => c.slots.map((s) => s.cat)));
  for (const p of PACKS) {
    const used = new Map(); // cat -> where
    for (const q of parsedQ.filter((x) => x.pack === p)) for (const s of q.slots) if (!used.has(s.cat)) used.set(s.cat, q.id);
    for (const c of clauseCats) if (!used.has(c)) used.set(c, "add-on clauses");
    for (const [cat, where] of used) {
      if (!CATEGORIES.includes(cat)) continue;
      const pool = (byCat[cat] || []).filter((w) => inPack(w, p));
      const need = p === "kids" ? 8 : 3;
      if (pool.length < need) fail("8 pools", `${p}: {${cat}} (${where}) has only ${pool.length} usable words, needs ${need}${p === "kids" ? " kids:true words of 3-4 letters tagged * or kids" : ""}`);
      const missing = TONES.filter((t) => !pool.some((w) => w.tone === t));
      if (pool.length && missing.length) warn(`${p}: {${cat}} has no ${missing.join("/")} words, so its three options will not span every tone`, "8 pools");
    }
  }
}

// ---------------------------------------------------------------- extra shape checks (warnings)

{
  if (!hush) warn("HUSH_LINES not found");
  else {
    let total = 0;
    for (const [k, n] of Object.entries(HUSH_COUNTS)) {
      const list = hush[k];
      if (!Array.isArray(list)) { warn(`HUSH_LINES.${k} missing`); continue; }
      total += list.length;
      if (list.length !== n) warn(`HUSH_LINES.${k}: ${list.length} lines, expected ${n}`);
      for (const line of list) if (line.trim().split(/\s+/).length > 12) warn(`HUSH_LINES.${k}: over 12 words: "${line}"`);
    }
    count("hush lines", total);
    if (total !== HUSH_TOTAL) warn(`HUSH_LINES: ${total} lines, expected ${HUSH_TOTAL}`);
  }
  if (reactions.length !== REACTION_COUNT) warn(`${reactions.length} reaction templates, expected ${REACTION_COUNT}`);
  for (const r of reactions) {
    count("reactions");
    if (r.text.trim().split(/\s+/).length > 12) warn(`${r.path}: reaction over 12 words: "${r.text}"`);
    for (const s of parseFrame(r.text).slots) if (!CATEGORIES.includes(s.cat)) warn(`${r.path}: unknown category {${s.cat}}`);
  }
  if (!Array.isArray(seatColours) || seatColours.length !== 6) warn("SEAT_COLOURS should have 6 entries");
  if (!Array.isArray(creatures) || creatures.length !== 18) warn("CREATURES should have 18 entries");
  if (!Array.isArray(sitters) || sitters.length !== 3) warn("SITTERS should have 3 entries");
  // "AN" + word, read without the space, for {a CAT} slots not already covered by check (4).
  const articled = new Set();
  for (const f of [...parsedQ, ...parsedC]) for (const s of f.slots) if (s.article) articled.add(s.cat);
  for (const c of articled) {
    for (const w of catWords[c] || []) {
      const art = wordArticle.get(`${c}|${w}`) || "A";
      const s = (art + w).toLowerCase();
      const bad = (badHits(s) || []).filter((h) => h.start < art.length && !articleHits.has(`${c}|${art.toLowerCase()}|${w.toLowerCase()}|${h.word}`));
      if (bad.length) fail("4 article", `${c}: "${art} ${w}" reads as "${s.toUpperCase()}", containing "${bad[0].word}"`);
    }
  }
}

// ---------------------------------------------------------------- summary

let failTotal = 0;
for (const [check, lines] of failures) {
  failTotal += lines.length;
  const shown = PRINT_ALL ? lines : lines.slice(0, PRINT_CAP);
  for (const l of shown) console.log(`FAIL [${check}] ${l}`);
  if (shown.length < lines.length) console.log(`FAIL [${check}] ... and ${lines.length - shown.length} more (run with --all)`);
}
let warnTotal = 0;
for (const [group, lines] of warnings) {
  warnTotal += lines.length;
  const shown = PRINT_ALL ? lines : lines.slice(0, 40);
  for (const l of shown) console.log(`warn [${group}] ${l}`);
  if (shown.length < lines.length) console.log(`warn [${group}] ... and ${lines.length - shown.length} more (run with --all)`);
}

const ms = Date.now() - t0;
console.log("");
console.log("Ghost Hand content check");
console.log(`  blocklist ${BLOCK.length} entries, allowlist ${ALLOW.length} entries`);
console.log(`  checked: ${Object.entries(stats).map(([k, v]) => `${v} ${k}`).join(", ")}`);
console.log(`  wrote ${GENERATED} (${stats["room codes blocked"] ?? 0} blocked codes)`);
if (failTotal) {
  console.log(`  FAILED: ${failTotal} failures (${[...failures].map(([k, v]) => `${k}: ${v.length}`).join(", ")}), ${warnTotal} warnings, ${ms} ms`);
  process.exit(1);
}
console.log(`  OK: 0 failures, ${warnTotal} warnings, ${ms} ms`);
