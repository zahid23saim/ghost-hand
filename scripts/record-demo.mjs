// Records a demo video of Ghost Hand from the local dev server (http://127.0.0.1:8787).
// Drives headless Chrome over CDP: landing, then the solo tutorial played by a scripted
// hand, then the reveal. Frames are captured with Page.startScreencast and encoded to
// WebM inside Chrome (canvas + MediaRecorder). Output: demo/ghost-hand-demo.webm
// Usage: node scripts/record-demo.mjs [--secs 75]

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const PORT = 9333;
const W = 1280, H = 720;
const MAX_SECS = Number(process.argv[process.argv.indexOf("--secs") + 1]) || 80;
const OUT_DIR = new URL("../demo/", import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = join(tmpdir(), `gh-rec-${process.pid}`);
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
  "--force-device-scale-factor=1", "about:blank",
], { stdio: "ignore" });

async function json(path, method = "GET") {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method }); return await r.json(); } catch { await sleep(200); }
  }
  throw new Error("Chrome did not start");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map(), handlers = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method && handlers.has(m.method)) handlers.get(m.method)(m.params);
  };
  return new Promise((resolve) => ws.onopen = () => resolve({
    send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
    on: (method, fn) => handlers.set(method, fn),
    close: () => ws.close(),
  }));
}

const evalJs = async (c, expr) => (await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

const AUTOPLAY = readFileSync(new URL("../test/autoplay.js", import.meta.url), "utf8");

async function main() {
  const target = await json(`/json/new?about:blank`, "PUT");
  const c = await cdp(target.webSocketDebuggerUrl);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  const frames = [];
  c.on("Page.screencastFrame", (p) => {
    frames.push({ t: p.metadata.timestamp, data: p.data });
    c.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  });

  await c.send("Page.navigate", { url: `${BASE}/` });
  await sleep(1500);
  await c.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const t0 = Date.now();
  const secs = () => (Date.now() - t0) / 1000;

  // 1. The landing with the ghost friends spelling HELLO.
  await sleep(6000);
  // 2. Start the guided solo seance (fresh profile, so it is the tutorial).
  await evalJs(c, `document.getElementById('solo').click()`);
  await sleep(2500);
  // 3. A scripted hand plays like a person: picks a card, rests, follows, leads.
  await evalJs(c, AUTOPLAY);
  // The local address on the two-device card means nothing to viewers; hide that card.
  await evalJs(c, `document.head.insertAdjacentHTML("beforeend", "<style>#twodev{display:none!important}</style>"); true`);
  let phase = "";
  while (secs() < MAX_SECS) {
    await sleep(1000);
    phase = await evalJs(c, `window.__gh && window.__gh.phase`);
    if (phase === "reveal") break;
  }
  // 4. Let the reveal play out (sentence, Now you may speak, stars).
  await sleep(9000);
  await c.send("Page.stopScreencast");
  console.log(`captured ${frames.length} frames over ${secs().toFixed(1)} s (last phase: ${phase})`);

  // Encode in a fresh page: draw each frame at its own time onto a canvas and record it.
  await c.send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  await evalJs(c, `window.__frames = []; true`);
  for (let i = 0; i < frames.length; i += 40) {
    const chunk = frames.slice(i, i + 40).map((f) => ({ t: f.t, d: f.data }));
    await evalJs(c, `window.__frames.push(...${JSON.stringify(chunk)}); true`);
  }
  const b64 = await evalJs(c, `(async () => {
    const fr = window.__frames; const cv = document.createElement('canvas'); cv.width = ${W}; cv.height = ${H};
    document.body.appendChild(cv); const g = cv.getContext('2d');
    const imgs = await Promise.all(fr.map((f) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/jpeg;base64,' + f.d; })));
    const stream = cv.captureStream(30);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
    const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => rec.onstop = r);
    g.drawImage(imgs[0], 0, 0, ${W}, ${H}); rec.start(500);
    const start = performance.now(), base = fr[0].t;
    for (let i = 0; i < imgs.length; i++) {
      const due = (fr[i].t - base) * 1000;
      const wait = due - (performance.now() - start);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      g.drawImage(imgs[i], 0, 0, ${W}, ${H});
    }
    await new Promise((r) => setTimeout(r, 600)); rec.stop(); await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  mkdirSync(OUT_DIR, { recursive: true });
  const out = new URL("ghost-hand-demo.webm", OUT_DIR);
  writeFileSync(out, Buffer.from(b64, "base64"));
  // Keep a few stills for checking.
  [0.1, 0.35, 0.6, 0.85, 0.99].forEach((k, i) => writeFileSync(new URL(`still-${i + 1}.jpg`, OUT_DIR), Buffer.from(frames[Math.floor((frames.length - 1) * k)].data, "base64")));
  console.log("wrote", out.pathname, Math.round(Buffer.byteLength(b64, "base64") / 1024), "KB");
  c.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  chrome.kill();
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 1500);
});
