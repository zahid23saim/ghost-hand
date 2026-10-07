// Ghost Hand - sound captions (spec §8.10 "every sound has a visual twin", §8.11).
// Small pills like "[wood creaks, rising]" stack in the container (at most 2) and fade.
// The container's position belongs to the page; give it the class "gh-caps-dock" for the
// default spot (bottom-left of the stage, just above the instruction line).

const CSS = `
.gh-caps-dock { position: absolute; left: 12px; bottom: 58px; z-index: 12; max-width: calc(100% - 24px); pointer-events: none; }
#app[data-device="phone"] .gh-caps-dock { left: 10px; bottom: 50px; max-width: calc(100% - 20px); }
.gh-caps { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; pointer-events: none; max-width: 100%; }
.gh-cap { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; padding: 5px 12px 5px 9px; border-radius: 999px;
  background: rgba(27,24,56,0.94); border: 1px solid var(--line-strong); color: var(--cream);
  font: 800 14px/1.25 var(--ui); white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,0.3);
  opacity: 0; transform: translateY(6px); transition: opacity 180ms ease-out, transform 220ms cubic-bezier(.2,1.2,.4,1); }
.gh-cap.gh-in { opacity: 1; transform: none; }
.gh-cap.gh-out { opacity: 0; transform: translateY(-4px); transition: opacity 280ms ease-in, transform 280ms ease-in; }
.gh-cap.gh-bump { animation: gh-cap-bump 260ms ease-out; }
.gh-cap-ico { flex: 0 0 auto; color: var(--mint); display: grid; place-items: center; }
.gh-cap-ico svg { display: block; }
.gh-cap-txt { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.gh-cap-txt .gh-br { color: var(--mint); opacity: 0.85; }
.gh-cap-n { flex: 0 0 auto; font: 800 12px var(--ui); color: var(--gold); }
.gh-cap-n:empty { display: none; }
#app[data-device="phone"] .gh-cap { font-size: 13px; padding: 4px 10px 4px 8px; }
@keyframes gh-cap-bump { 0% { transform: scale(1); } 40% { transform: scale(1.06); } 100% { transform: scale(1); } }
.gh-caps.gh-still .gh-cap, .reduce-motion .gh-cap { transform: none !important; animation: none !important; transition: opacity 160ms linear; }
@media (prefers-reduced-motion: reduce) {
  .gh-cap { transform: none !important; animation: none !important; transition: opacity 160ms linear; }
}
`;

function ensureStyle() {
  if (document.getElementById("gh-captions")) return;
  const st = document.createElement("style");
  st.id = "gh-captions";
  st.textContent = CSS;
  document.head.appendChild(st);
}

const WAVE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6.5v3M5 4.5v7M8 2.5v11M11 4.5v7M14 6.5v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

export class Captions {
  // container: the element the strip lives in. opts: { reducedMotion, max }
  constructor(container, { reducedMotion = false, max = 2 } = {}) {
    ensureStyle();
    this.max = Math.max(1, max);
    this.enabled = false;
    this.items = [];          // newest last: { el, text, timer, n }
    this.last = new Map();    // throttle key -> time of the last caption
    this.root = document.createElement("div");
    this.root.className = "gh-caps";
    // A visual twin for sounds; screen readers already hear the sounds and the ribbon.
    this.root.setAttribute("aria-hidden", "true");
    (container || document.body).appendChild(this.root);
    this.setReducedMotion(reducedMotion);
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.clear();
  }

  setReducedMotion(on) { this.root.classList.toggle("gh-still", !!on); }

  // Shows "[text]" for ms. opts.gap (ms) drops the caption if the same key (default: the
  // text) was shown less than gap ago. Returns true if something was shown or refreshed.
  say(text, ms = 1800, { gap = 0, key } = {}) {
    if (!this.enabled || !text) return false;
    let label = String(text).trim();
    if (label.startsWith("[") && label.endsWith("]")) label = label.slice(1, -1).trim();
    if (!label) return false;
    const now = performance.now();
    const k = key ?? label;
    if (gap > 0 && now - (this.last.get(k) ?? -Infinity) < gap) return false;
    this.last.set(k, now);

    // The same sound again while its pill is up: keep it, count it, restart its clock.
    const top = this.items[this.items.length - 1];
    if (top && top.text === label && !top.leaving) {
      top.n++;
      top.el.querySelector(".gh-cap-n").textContent = `×${top.n}`;
      top.el.classList.remove("gh-bump");
      void top.el.offsetWidth;
      top.el.classList.add("gh-bump");
      clearTimeout(top.timer);
      top.timer = setTimeout(() => this.dismiss(top), ms);
      return true;
    }

    const el = document.createElement("div");
    el.className = "gh-cap";
    const ico = document.createElement("span");
    ico.className = "gh-cap-ico";
    ico.innerHTML = WAVE;
    const txt = document.createElement("span");
    txt.className = "gh-cap-txt";
    const open = document.createElement("span");
    open.className = "gh-br";
    open.textContent = "[";
    const close = document.createElement("span");
    close.className = "gh-br";
    close.textContent = "]";
    txt.append(open, document.createTextNode(label), close);
    const n = document.createElement("span");
    n.className = "gh-cap-n";
    el.append(ico, txt, n);
    this.root.appendChild(el);
    requestAnimationFrame(() => el.classList.add("gh-in"));

    const item = { el, text: label, n: 1, timer: 0, leaving: false };
    item.timer = setTimeout(() => this.dismiss(item), ms);
    this.items.push(item);
    const live = this.items.filter((it) => !it.leaving);
    for (let i = 0; i < live.length - this.max; i++) this.dismiss(live[i], true);
    return true;
  }

  dismiss(item, fast = false) {
    if (!item || item.leaving) return;
    item.leaving = true;
    clearTimeout(item.timer);
    const gone = () => {
      item.el.remove();
      const i = this.items.indexOf(item);
      if (i >= 0) this.items.splice(i, 1);
    };
    if (fast) { gone(); return; }
    item.el.classList.remove("gh-in");
    item.el.classList.add("gh-out");
    setTimeout(gone, 300);
  }

  clear() {
    for (const it of [...this.items]) { clearTimeout(it.timer); it.el.remove(); }
    this.items = [];
  }

  destroy() {
    this.clear();
    this.root.remove();
  }
}
