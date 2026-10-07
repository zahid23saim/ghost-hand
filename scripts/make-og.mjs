// Renders the link preview (public/og.png, 1200 x 630) and the PWA icons (public/icons/*.png)
// from scripts/og.html and scripts/icon.html with headless Chrome. Run: node scripts/make-og.mjs
// Set CHROME=/path/to/chrome when Chrome is not in the default Windows location.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "gh-og-"));
mkdirSync(join(root, "public", "icons"), { recursive: true });

// Headless windows have a minimum width, so small icons are drawn in a 512 px window at a
// lower device scale factor (the screenshot is taken in device pixels).
function shot(page, query, out, w, h, transparent = false) {
  const url = pathToFileURL(join(root, "scripts", page)).href + (query ? `?${query}` : "");
  const dsf = w < 512 && w === h ? w / 512 : 1;
  const args = [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", `--force-device-scale-factor=${dsf}`,
    `--user-data-dir=${profile}`, "--virtual-time-budget=8000",
    `--window-size=${Math.round(w / dsf)},${Math.round(h / dsf)}`, `--screenshot=${join(root, out)}`,
  ];
  if (transparent) args.push("--default-background-color=00000000");
  args.push(url);
  execFileSync(chrome, args, { stdio: "ignore" });
  console.log(out.padEnd(36), `${w}x${h}`, `${statSync(join(root, out)).size} bytes`);
}

try {
  shot("og.html", "", "public/og.png", 1200, 630);
  shot("icon.html", "", "public/icons/icon-192.png", 192, 192, true);
  shot("icon.html", "", "public/icons/icon-512.png", 512, 512, true);
  shot("icon.html", "mask=1", "public/icons/icon-maskable-192.png", 192, 192);
  shot("icon.html", "mask=1", "public/icons/icon-maskable-512.png", 512, 512);
  shot("icon.html", "bleed=1", "public/icons/apple-touch-icon.png", 180, 180);
} finally {
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
