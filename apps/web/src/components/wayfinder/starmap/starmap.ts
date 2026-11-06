// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr

// An imperative canvas island behind a narrow seam. Frames run only while the camera
// is off its goal or a flare is above zero; every mutator calls wake(). Without a 2D
// context the island still ingests, lays out and selects, and draws nothing.

import { computeLayout, edgesOf, structureSignature, TAU } from "./layout";
import { GRAMMAR, type SessionState } from "./session";
import { STAR_SIZE, starColor, type StarPalette, visualState, type VisualState } from "./theme";
import type { StarTicket } from "./types";

export type SelectHandler = (num: number | null) => void;

/** A camera pose. `fitted` is set while the map is framed to fit and cleared by a manual move. */
export interface Camera {
  x: number;
  y: number;
  s: number;
  fitted: boolean;
}

interface Node {
  num: number;
  title: string;
  type: string;
  vstate: VisualState;
  sstate: SessionState | null;
  x: number;
  y: number;
  flare: number;
}

interface LabelDraw {
  text: string;
  x: number;
  y: number;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
function hits(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

const LABEL_PRIORITY: Record<VisualState, number> = {
  frontier: 0,
  claimed: 1,
  resolved: 2,
  blocked: 3,
  out_of_scope: 4,
};

const CULL_MARGIN = 140;
const INSET = 16;

// A label keeps its side until the other side is clear by this many slots.
const SIDE_HYSTERESIS = 1;
const BELOW = 1;
const ABOVE = -1;
type Side = typeof BELOW | typeof ABOVE;

const LABEL_FONT = "system-ui,sans-serif";
const LABEL_MIN_PX = 11;
const LABEL_MAX_PX = 13;
const LABEL_CLIP_PX = 180;
const LABEL_HIDE_SCALE = 0.22;
// Screen px beyond the core, past every session mark and the selection ring.
const CLAIMED_LABEL_PAD = 13;
const SELECTED_LABEL_PAD = 16;
const ORBIT_PAD = 6;
const SELECTION_PAD = 15;
const MARK_STROKE = 1.5;
const ORBIT_DASH = [3, 3];
const MOON_ANGLE = -TAU / 8;
const MOON_R = 3;
const HALO_R = 5.5;
const TRAIL_R = 1.5;
// Behind the moon, counter-clockwise, in degrees of orbit and alpha.
const TRAIL = [
  { deg: 25, alpha: 0.7 },
  { deg: 50, alpha: 0.45 },
];

const FINE_HIT_PX = 14;
const COARSE_HIT_PX = 22;

/** The longest word-boundary prefix of `title` whose text plus an ellipsis fits `maxPx`, or null. */
export function clipToWidth(
  title: string,
  maxPx: number,
  measure: (text: string) => number,
): string | null {
  if (measure(title) <= maxPx) return title;
  const words = title.split(" ");
  let fit: string | null = null;
  for (let i = 1; i < words.length; i++) {
    const candidate = words.slice(0, i).join(" ") + "…";
    if (measure(candidate) > maxPx) break;
    fit = candidate;
  }
  return fit;
}

const TICKER_HOLD_MS = 4200;
const FLARE_SECONDS = 1.1;

// The ease runs on elapsed time so a 120 Hz panel is not twice as fast.
const CAM_TAU = 0.12;
const CAM_EPS = 0.02;
const SCALE_EPS = 0.0005;

const MIN_SCALE = 0.12;
const MAX_SCALE = 3;
const FIT_MIN_SCALE = 0.15;
const FIT_MAX_SCALE = 1.4;

const CLICK_SLOP_PX = 3;
const LINE_PX = 16;
const WHEEL_GAIN = 0.0016;
const PINCH_GAIN = 0.011;
const MAX_WHEEL_PX = 140;
const MAX_PINCH_PX = 50;

// WebKit's pinch event; `scale` is cumulative from the gesture start.
interface GestureLike {
  scale: number;
  clientX: number;
  clientY: number;
  preventDefault(): void;
}

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}
function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function numberLabel(num: number): string {
  return (num < 10 ? "0" : "") + num;
}

interface StarLayer {
  f: number;
  sz: number;
  a: number;
  stars: { x: number; y: number; t: number }[];
}
function makeStarfield(): StarLayer[] {
  const specs = [
    { f: 0.15, n: 140, sz: 0.7, a: 0.45 },
    { f: 0.3, n: 80, sz: 1.1, a: 0.65 },
    { f: 0.5, n: 34, sz: 1.7, a: 0.9 },
  ];
  let t = 9001 >>> 0;
  const rnd = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  return specs.map((sp) => {
    const stars = [];
    for (let i = 0; i < sp.n; i++) stars.push({ x: rnd(), y: rnd(), t: rnd() });
    return { f: sp.f, sz: sp.sz, a: sp.a, stars };
  });
}

export class StarMap {
  #host: HTMLElement | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #ctx: CanvasRenderingContext2D | null = null;
  #dpr = 1;
  #w = 0;
  #h = 0;

  #nodes: Node[] = [];
  #byNum = new Map<number, Node>();
  #edges: { from: number; to: number; satisfied: boolean }[] = [];
  #sig = "";

  #cam = { x: 0, y: 0, s: 1 };
  #goal = { x: 0, y: 0, s: 1 };
  #fitted = true;
  #last = 0;
  #raf = 0;
  #reducedMotion = false;
  // Stamped so a gesture that never reports its end cannot mute the wheel for good.
  #gesture: { scale: number; at: number } | null = null;
  #selected: number | null = null;
  #tickerText = "";
  #tickerTimer: ReturnType<typeof setTimeout> | null = null;

  #starfield = makeStarfield();
  #labelCache: { key: string; fs: number; items: LabelDraw[] } | null = null;
  #labelEpoch = 0;
  #labelSide = new Map<number, Side>();
  #palette: StarPalette | null = null;
  #onSelect: SelectHandler = () => {};
  #ro: ResizeObserver | null = null;
  #detach: (() => void)[] = [];

  mount(host: HTMLElement): void {
    this.#host = host;
    const canvas = document.createElement("canvas");
    canvas.className = "starmap-canvas";
    host.appendChild(canvas);
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d");
    this.#dpr = Math.max(1, (typeof window !== "undefined" && window.devicePixelRatio) || 1);

    this.#measure();
    if (typeof ResizeObserver !== "undefined") {
      // oxlint-disable-next-line t3code/no-raw-resize-observer -- paints the canvas directly; no React state to commit
      this.#ro = new ResizeObserver(() => this.#onResize());
      this.#ro.observe(host);
    }
    this.#bindPointer(canvas);
    this.#fitted = true;
    this.#refit(true);
    this.#wake();
  }

  // A push that keeps the structure only restyles stars; only a structure change
  // re-lays out and re-fits. A push that changes nothing does not wake.
  setModel(tickets: readonly StarTicket[], sessions: Record<number, SessionState> = {}): void {
    const sig = structureSignature(tickets);

    if (sig === this.#sig && this.#nodes.length) {
      const changed: string[] = [];
      let dirty = false;
      for (const t of tickets) {
        const n = this.#byNum.get(t.num);
        if (!n) continue;
        const vstate = visualState(t);
        const sstate = sessions[t.num] ?? null;
        if (n.title !== t.title || n.type !== t.type || sstate !== n.sstate) dirty = true;
        if (vstate !== n.vstate) {
          dirty = true;
          if (!this.#reducedMotion) n.flare = 1;
          changed.push(`#${numberLabel(t.num)} → ${vstate.replace("_", " ")}`);
        }
        n.title = t.title;
        n.type = t.type;
        n.vstate = vstate;
        n.sstate = sstate;
      }
      if (!dirty) return;
      this.#labelEpoch++;
      if (changed.length) this.#tick(changed.join("   ·   "));
      this.#refreshEdges(tickets);
      this.#wake();
      return;
    }

    this.#labelEpoch++;
    this.#labelSide.clear();
    this.#sig = sig;
    const pts = computeLayout(tickets);
    this.#nodes = tickets.map((t) => {
      const p = pts[t.num] ?? { x: 0, y: 0 };
      return {
        num: t.num,
        title: t.title,
        type: t.type,
        vstate: visualState(t),
        sstate: sessions[t.num] ?? null,
        x: p.x,
        y: p.y,
        flare: 0,
      };
    });
    this.#byNum = new Map(this.#nodes.map((n) => [n.num, n]));
    this.#refreshEdges(tickets);
    if (this.#selected !== null && !this.#byNum.has(this.#selected)) this.#selected = null;
    this.#fitted = true;
    this.#refit(true);
    this.#wake();
  }

  #refreshEdges(tickets: readonly StarTicket[]): void {
    const resolved = new Set(tickets.filter((t) => t.status === "resolved").map((t) => t.num));
    this.#edges = edgesOf(tickets).map((e) => ({
      from: e.from,
      to: e.to,
      satisfied: resolved.has(e.from),
    }));
  }

  onSelect(cb: SelectHandler): void {
    this.#onSelect = cb;
  }

  /** Programmatic selection. Never calls `onSelect`; only a click emits. */
  select(num: number | null): void {
    if (num !== null && !this.#byNum.has(num)) return;
    this.#selected = num;
    this.#labelEpoch++;
    if (num !== null) this.#seat(num);
    this.#wake();
  }

  fit(): void {
    this.#labelEpoch++;
    this.#fitted = true;
    this.#refit(false);
    this.#settleIfHeadless();
    this.#wake();
  }

  /** Where the camera is going, not where it is mid-ease. */
  camera(): Camera {
    return { ...this.#goal, fitted: this.#fitted };
  }

  /** Sets both camera and goal so a remount opens in place, and clears `fitted`. Call it last. */
  restoreCamera(cam: Pick<Camera, "x" | "y" | "s">): void {
    if (!isFinite(cam.x) || !isFinite(cam.y) || !(cam.s > 0)) return;
    const s = clamp(cam.s, MIN_SCALE, MAX_SCALE);
    this.#goal = { x: cam.x, y: cam.y, s };
    this.#cam = { ...this.#goal };
    this.#fitted = false;
    this.#labelEpoch++;
    this.#wake();
  }

  get #colors(): StarPalette {
    return this.#palette!;
  }

  setPalette(palette: StarPalette): void {
    this.#palette = palette;
    this.#labelEpoch++;
    this.#wake();
  }

  /** Snaps the camera and clears flares when turned on. Call before the first `setModel`. */
  setReducedMotion(reduced: boolean): void {
    if (this.#reducedMotion === reduced) return;
    this.#reducedMotion = reduced;
    if (!reduced) return;
    this.#cam = { ...this.#goal };
    for (const n of this.#nodes) n.flare = 0;
    this.#wake();
  }

  destroy(): void {
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    if (this.#tickerTimer !== null) clearTimeout(this.#tickerTimer);
    this.#tickerTimer = null;
    this.#ro?.disconnect();
    for (const off of this.#detach) off();
    this.#detach = [];
    this.#canvas?.remove();
    this.#canvas = null;
    this.#ctx = null;
    this.#host = null;
  }

  positions(): Record<number, { x: number; y: number }> {
    const out: Record<number, { x: number; y: number }> = {};
    for (const n of this.#nodes) out[n.num] = { x: n.x, y: n.y };
    return out;
  }

  overlays(): Record<number, SessionState> {
    const out: Record<number, SessionState> = {};
    for (const n of this.#nodes) if (n.sstate) out[n.num] = n.sstate;
    return out;
  }

  ticker(): string | null {
    return this.#tickerText || null;
  }

  screenOf(num: number): { x: number; y: number } | null {
    const n = this.#byNum.get(num);
    if (!n) return null;
    return { x: n.x * this.#cam.s + this.#cam.x, y: n.y * this.#cam.s + this.#cam.y };
  }

  /** The click path: picks the nearest star in reach, selects it, and emits. A miss does nothing. */
  selectAtScreen(sx: number, sy: number, coarse = false): number | null {
    const minReach = coarse ? COARSE_HIT_PX : FINE_HIT_PX;
    let hit: Node | null = null;
    let best = Infinity;
    for (const n of this.#nodes) {
      const px = n.x * this.#cam.s + this.#cam.x;
      const py = n.y * this.#cam.s + this.#cam.y;
      const reach = Math.max(minReach, STAR_SIZE[n.vstate].r * this.#cam.s + 10);
      const d = Math.hypot(sx - px, sy - py);
      if (d < reach && d < best) {
        hit = n;
        best = d;
      }
    }
    if (!hit) return null;
    if (!this.#reducedMotion) hit.flare = Math.max(hit.flare, 0.6);
    this.#selected = hit.num;
    this.#labelEpoch++;
    this.#seat(hit.num);
    this.#wake();
    this.#onSelect(hit.num);
    return hit.num;
  }

  #freeRect(): { cx: number; cy: number; availW: number; availH: number } {
    return {
      cx: this.#w / 2,
      cy: this.#h / 2,
      availW: Math.max(80, this.#w - 2 * INSET),
      availH: Math.max(80, this.#h - 2 * INSET),
    };
  }

  // A new line replaces the old one and restarts the single clear timer.
  #tick(msg: string): void {
    this.#tickerText = msg;
    if (this.#tickerTimer !== null) clearTimeout(this.#tickerTimer);
    this.#tickerTimer = setTimeout(() => {
      this.#tickerTimer = null;
      this.#tickerText = "";
      this.#wake();
    }, TICKER_HOLD_MS);
  }

  // Moves only when the star or its label leaves the inset canvas rect; never changes scale.
  #seat(num: number): void {
    const n = this.#byNum.get(num);
    if (!n) return;
    const s = this.#goal.s;
    const sx = n.x * s + this.#goal.x;
    const sy = n.y * s + this.#goal.y;
    const ring = STAR_SIZE[n.vstate].r * s + SELECTED_LABEL_PAD;
    const half = Math.max(ring, this.#labelWidth(n) / 2);
    const below = s < LABEL_HIDE_SCALE ? 0 : this.#labelPx() + 4;
    const inside =
      sx - half >= INSET &&
      sx + half <= this.#w - INSET &&
      sy - ring >= INSET &&
      sy + ring + below <= this.#h - INSET;
    if (inside) return;
    const { cx, cy } = this.#freeRect();
    this.#goal.x = cx - n.x * s;
    this.#goal.y = cy - n.y * s;
    this.#settleIfHeadless();
  }

  #labelPx(): number {
    return clamp(11 * Math.pow(this.#cam.s, 0.3), LABEL_MIN_PX, LABEL_MAX_PX);
  }

  #labelWidth(n: Node): number {
    const g = this.#ctx;
    if (!g) return 0;
    g.font = this.#labelPx().toFixed(1) + "px " + LABEL_FONT;
    const num = numberLabel(n.num);
    return Math.min(
      g.measureText(`${num}  ${n.title}`).width,
      g.measureText(`${num}  `).width + LABEL_CLIP_PX,
    );
  }

  #settleIfHeadless(): void {
    if (this.#ctx && !this.#reducedMotion) return;
    this.#cam.x = this.#goal.x;
    this.#cam.y = this.#goal.y;
    this.#cam.s = this.#goal.s;
  }

  #pan(dx: number, dy: number): void {
    this.#goal.x += dx;
    this.#goal.y += dy;
    this.#fitted = false;
    this.#settleIfHeadless();
    this.#wake();
  }

  #zoomAt(sx: number, sy: number, f: number): void {
    if (!(f > 0) || !isFinite(f)) return;
    const ns = clamp(this.#goal.s * f, MIN_SCALE, MAX_SCALE);
    const k = ns / this.#goal.s;
    this.#goal.x = sx - (sx - this.#goal.x) * k;
    this.#goal.y = sy - (sy - this.#goal.y) * k;
    this.#goal.s = ns;
    this.#fitted = false;
    this.#settleIfHeadless();
    this.#wake();
  }

  // Eases in (focus, world-units-per-pixel), which is linear in the world point under
  // any screen point, so a zoom holds the cursor's point still for the whole flight.
  #easeCamera(dt: number): void {
    const cam = this.#cam,
      goal = this.#goal;
    if (this.#reducedMotion || this.#nearGoal()) {
      cam.x = goal.x;
      cam.y = goal.y;
      cam.s = goal.s;
      return;
    }
    const a = 1 - Math.exp(-dt / CAM_TAU);
    const z = 1 / cam.s,
      zg = 1 / goal.s;
    const fx = -cam.x * z,
      fy = -cam.y * z;
    const nz = z + (zg - z) * a;
    const nfx = fx + (-goal.x * zg - fx) * a;
    const nfy = fy + (-goal.y * zg - fy) * a;
    cam.s = 1 / nz;
    cam.x = -nfx / nz;
    cam.y = -nfy / nz;
  }

  #nearGoal(): boolean {
    const cam = this.#cam,
      goal = this.#goal;
    return (
      Math.abs(goal.x - cam.x) < CAM_EPS &&
      Math.abs(goal.y - cam.y) < CAM_EPS &&
      Math.abs(goal.s - cam.s) < SCALE_EPS
    );
  }

  #measure(): void {
    const host = this.#host;
    const w = host?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 800);
    const h = host?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 600);
    this.#w = w;
    this.#h = h;
    if (this.#canvas) {
      this.#canvas.width = Math.max(1, Math.round(w * this.#dpr));
      this.#canvas.height = Math.max(1, Math.round(h * this.#dpr));
      this.#canvas.style.width = w + "px";
      this.#canvas.style.height = h + "px";
    }
  }

  // A fitted map refits; otherwise the world point at the centre stays there at the same
  // zoom. Both snap. Always draws: #measure reassigns the backing store, which clears it.
  #onResize(): void {
    const w = this.#w,
      h = this.#h;
    const before = this.#freeRect();
    this.#measure();
    if (this.#w !== w || this.#h !== h) {
      if (this.#fitted) {
        this.#refit(false);
      } else {
        const after = this.#freeRect();
        const s = this.#goal.s;
        const wx = (before.cx - this.#goal.x) / s;
        const wy = (before.cy - this.#goal.y) / s;
        this.#goal.x = after.cx - wx * s;
        this.#goal.y = after.cy - wy * s;
      }
      this.#cam = { ...this.#goal };
    }
    this.#draw();
  }

  #refit(snap: boolean): void {
    if (!this.#nodes.length) return;
    let minx = 1e9,
      miny = 1e9,
      maxx = -1e9,
      maxy = -1e9;
    for (const n of this.#nodes) {
      minx = Math.min(minx, n.x);
      miny = Math.min(miny, n.y);
      maxx = Math.max(maxx, n.x);
      maxy = Math.max(maxy, n.y);
    }
    const pad = 90;
    minx -= pad;
    miny -= pad;
    maxx += pad;
    maxy += pad;
    const { cx: fcx, cy: fcy, availW, availH } = this.#freeRect();
    const s = clamp(
      Math.min(availW / (maxx - minx || 1), availH / (maxy - miny || 1)),
      FIT_MIN_SCALE,
      FIT_MAX_SCALE,
    );
    const cx = (minx + maxx) / 2,
      cy = (miny + maxy) / 2;
    this.#goal.s = s;
    this.#goal.x = fcx - cx * s;
    this.#goal.y = fcy - cy * s;
    if (snap) this.#cam = { ...this.#goal };
  }

  #bindPointer(canvas: HTMLCanvasElement): void {
    // Client coordinates of each active pointer; two pinch-zoom about their midpoint.
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number } | null = null;
    let moved = false;
    const local = (x: number, y: number) => {
      const r = canvas.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };
    const release = () => {
      if (pointers.size === 0) canvas.classList.remove("drag");
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      this.#gesture = null;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        down = { x: e.clientX, y: e.clientY };
        moved = false;
      } else {
        moved = true;
      }
      canvas.classList.add("drag");
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const next = { x: e.clientX, y: e.clientY };
      if (pointers.size === 1) {
        if (!moved) {
          if (!down || Math.hypot(next.x - down.x, next.y - down.y) <= CLICK_SLOP_PX) return;
          moved = true;
        }
        pointers.set(e.pointerId, next);
        this.#pan(next.x - prev.x, next.y - prev.y);
        return;
      }
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
      pointers.set(e.pointerId, next);
      if (!other || pointers.size !== 2) return;
      const before = local((prev.x + other.x) / 2, (prev.y + other.y) / 2);
      const after = local((next.x + other.x) / 2, (next.y + other.y) / 2);
      const was = Math.hypot(prev.x - other.x, prev.y - other.y);
      const span = Math.hypot(next.x - other.x, next.y - other.y);
      this.#pan(after.x - before.x, after.y - before.y);
      if (was > 0) this.#zoomAt(after.x, after.y, span / was);
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      release();
      if (pointers.size > 0 || moved) return;
      const { x, y } = local(e.clientX, e.clientY);
      this.selectAtScreen(x, y, e.pointerType !== "mouse");
    };
    const onCancel = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      moved = true;
      release();
    };
    const pixelsOf = (e: WheelEvent, cap: number) => {
      const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? this.#h : 1;
      return clamp(e.deltaY * unit, -cap, cap);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.#gesture && now() - this.#gesture.at < 0.5) return;
      this.#gesture = null;
      const { x, y } = local(e.clientX, e.clientY);
      const pinch = e.ctrlKey;
      const px = pixelsOf(e, pinch ? MAX_PINCH_PX : MAX_WHEEL_PX);
      this.#zoomAt(x, y, Math.exp(-px * (pinch ? PINCH_GAIN : WHEEL_GAIN)));
    };
    // preventDefault also stops WKWebView magnifying the whole page.
    const onGestureStart = (ev: Event) => {
      const e = ev as unknown as GestureLike;
      e.preventDefault();
      this.#gesture = { scale: e.scale || 1, at: now() };
    };
    const onGestureChange = (ev: Event) => {
      const e = ev as unknown as GestureLike;
      e.preventDefault();
      const g = this.#gesture;
      if (!g) return;
      const s = e.scale || 1;
      const { x, y } = local(e.clientX, e.clientY);
      this.#zoomAt(x, y, s / (g.scale || 1));
      g.scale = s;
      g.at = now();
    };
    const onGestureEnd = (ev: Event) => {
      ev.preventDefault();
      this.#gesture = null;
    };
    const listeners: Array<[string, EventListener, AddEventListenerOptions?]> = [
      ["pointerdown", onDown as EventListener],
      ["pointermove", onMove as EventListener],
      ["pointerup", onUp as EventListener],
      ["pointercancel", onCancel as EventListener],
      ["wheel", onWheel as EventListener, { passive: false }],
      ["gesturestart", onGestureStart],
      ["gesturechange", onGestureChange],
      ["gestureend", onGestureEnd],
    ];
    for (const [type, fn, options] of listeners) {
      canvas.addEventListener(type, fn, options);
      this.#detach.push(() => canvas.removeEventListener(type, fn));
    }
  }

  // Schedules one frame if none is pending; a wake from idle restarts the clock.
  #wake(): void {
    if (!this.#ctx || this.#raf) return;
    this.#last = now();
    this.#raf = requestAnimationFrame(this.#render);
  }

  #render = (): void => {
    this.#raf = 0;
    try {
      if (!this.#ctx) return;
      const t = now();
      const dt = clamp(t - this.#last, 0, 0.1);
      this.#last = t;
      for (const n of this.#nodes) {
        if (n.flare > 0)
          n.flare = this.#reducedMotion ? 0 : Math.max(0, n.flare - dt / FLARE_SECONDS);
      }
      this.#easeCamera(dt);
      this.#draw();
    } finally {
      if (this.#ctx && !this.#raf && this.#animating()) {
        this.#raf = requestAnimationFrame(this.#render);
      }
    }
  };

  #animating(): boolean {
    const cam = this.#cam,
      goal = this.#goal;
    if (cam.x !== goal.x || cam.y !== goal.y || cam.s !== goal.s) return true;
    return this.#nodes.some((n) => n.flare > 0);
  }

  // Paints nothing until the host's first setPalette; the renderer owns no colours.
  #draw(): void {
    const g = this.#ctx;
    const palette = this.#palette;
    if (!g || !palette) return;
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = palette.background;
    g.fillRect(0, 0, this.#w, this.#h);
    if (palette.scheme === "dark") this.#drawStarfield(g);

    g.save();
    g.translate(this.#cam.x, this.#cam.y);
    g.scale(this.#cam.s, this.#cam.s);
    for (const e of this.#edges) this.#drawEdge(g, e);
    for (const n of this.#nodes) this.#drawStar(g, n);
    g.restore();
    g.globalAlpha = 1;
    this.#drawLabels(g);
    this.#drawTicker(g);
  }

  #drawStarfield(g: CanvasRenderingContext2D): void {
    const W = this.#w,
      H = this.#h;
    g.fillStyle = "#ffffff";
    for (const L of this.#starfield) {
      for (const s of L.stars) {
        const x = mod(s.x * W + this.#cam.x * L.f, W);
        const y = mod(s.y * H + this.#cam.y * L.f, H);
        g.globalAlpha = L.a * (0.65 + 0.35 * Math.sin(s.t * TAU));
        g.fillRect(x, y, L.sz, L.sz);
      }
    }
    g.globalAlpha = 1;
  }

  #drawEdge(
    g: CanvasRenderingContext2D,
    e: { from: number; to: number; satisfied: boolean },
  ): void {
    const a = this.#byNum.get(e.from),
      b = this.#byNum.get(e.to);
    if (!a || !b) return;
    const ax = a.x,
      ay = a.y,
      bx = b.x,
      by = b.y;
    const mx = (ax + bx) / 2,
      my = (ay + by) / 2,
      dx = bx - ax,
      dy = by - ay,
      len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len,
      ny = dx / len,
      bow = Math.min(46, len * 0.13),
      cx = mx + nx * bow,
      cy = my + ny * bow;
    const color = e.satisfied ? this.#colors.edge : this.#colors.edgeMuted;
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo(cx, cy, bx, by);
    g.strokeStyle = color;
    if (e.satisfied) {
      g.globalAlpha = 0.5;
      g.lineWidth = 1.8;
      g.setLineDash([]);
    } else {
      g.globalAlpha = 0.45;
      g.lineWidth = 1.3;
      g.setLineDash([4, 6]);
    }
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
    const midx = 0.25 * ax + 0.5 * cx + 0.25 * bx,
      midy = 0.25 * ay + 0.5 * cy + 0.25 * by;
    const ux = dx / len,
      uy = dy / len;
    const ah = 7,
      aw = 3.8,
      px = -uy,
      py = ux,
      tipx = midx + ux * ah * 0.5,
      tipy = midy + uy * ah * 0.5;
    g.beginPath();
    g.moveTo(tipx, tipy);
    g.lineTo(tipx - ux * ah + px * aw, tipy - uy * ah + py * aw);
    g.lineTo(tipx - ux * ah - px * aw, tipy - uy * ah - py * aw);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  }

  #disc(g: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
    g.globalAlpha = alpha;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  #ring(g: CanvasRenderingContext2D, x: number, y: number, r: number, width: number): void {
    g.lineWidth = width;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.stroke();
  }

  // Marks are sized in screen px, so world sizes divide by the camera scale.
  #drawStar(g: CanvasRenderingContext2D, n: Node): void {
    const size = STAR_SIZE[n.vstate];
    const color = starColor(this.#colors, n.vstate);
    const s = this.#cam.s;
    const x = n.x,
      y = n.y,
      fl = n.flare;
    const glowScale = this.#colors.scheme === "dark" ? 1 : 0.55;
    g.fillStyle = color;
    g.strokeStyle = color;

    if (n.vstate === "out_of_scope") {
      g.globalAlpha = 1;
      this.#ring(g, x, y, size.r, MARK_STROKE / s);
    } else {
      const isF = n.vstate === "frontier";
      const gr = (isF ? size.gr * 1.08 : size.gr) * (1 + fl * 0.5);
      const glow = (isF ? 1 : 0.75) * glowScale;
      this.#disc(g, x, y, gr, Math.min(1, 0.07 * glow + fl * 0.12));
      this.#disc(g, x, y, gr * 0.55, Math.min(1, 0.12 * glow + fl * 0.2));
      this.#disc(g, x, y, gr * 0.3, Math.min(1, 0.2 * glow + fl * 0.3));
      this.#disc(g, x, y, size.r * 1.35, 0.45);
      this.#disc(g, x, y, size.r, 1);
    }

    if (fl > 0) {
      g.globalAlpha = fl * 0.7;
      this.#ring(g, x, y, size.r + (1 - fl) * 40, 1.5 + 2 * fl);
    }
    g.globalAlpha = 1;
    const core = size.r * s;
    if (n.vstate === "claimed") this.#drawSessionMarks(g, n, core);
    if (this.#selected === n.num) {
      g.strokeStyle = this.#colors.edge;
      this.#ring(g, x, y, (core + SELECTION_PAD) / s, MARK_STROKE / s);
    }
  }

  // Every claimed star wears one orbit ring; the moon and its marks follow the state's grammar.
  // A claimed star with no state yet wears the solid ring alone.
  #drawSessionMarks(g: CanvasRenderingContext2D, n: Node, core: number): void {
    const s = this.#cam.s;
    const grammar = n.sstate === null ? null : GRAMMAR[n.sstate];
    const hue = grammar?.hue === "blocked" ? this.#colors.blocked : this.#colors.claimed;
    const orbit = (core + ORBIT_PAD) / s;
    g.strokeStyle = hue;
    g.fillStyle = hue;
    if (grammar?.orbit === "dashed") g.setLineDash(ORBIT_DASH.map((d) => d / s));
    this.#ring(g, n.x, n.y, orbit, MARK_STROKE / s);
    g.setLineDash([]);
    if (!grammar?.moon) return;
    const mx = n.x + Math.cos(MOON_ANGLE) * orbit;
    const my = n.y + Math.sin(MOON_ANGLE) * orbit;
    this.#disc(g, mx, my, MOON_R / s, 1);
    for (const mark of grammar.marks) {
      if (mark === "halo") {
        g.globalAlpha = 1;
        this.#ring(g, mx, my, HALO_R / s, MARK_STROKE / s);
      } else {
        for (const { deg, alpha } of TRAIL) {
          const a = MOON_ANGLE - (deg / 360) * TAU;
          const tx = n.x + Math.cos(a) * orbit;
          const ty = n.y + Math.sin(a) * orbit;
          this.#disc(g, tx, ty, TRAIL_R / s, this.#colors.highContrast ? 1 : alpha);
        }
      }
    }
    g.globalAlpha = 1;
  }

  #strokedText(g: CanvasRenderingContext2D, text: string, x: number, y: number): void {
    g.strokeText(text, x, y);
    g.fillText(text, x, y);
  }

  #textStyle(g: CanvasRenderingContext2D, font: string): void {
    g.font = font;
    g.textAlign = "center";
    g.lineJoin = "round";
    g.lineWidth = 3;
    g.strokeStyle = this.#colors.labelStroke;
    g.fillStyle = this.#colors.label;
  }

  #drawTicker(g: CanvasRenderingContext2D): void {
    if (!this.#tickerText) return;
    this.#textStyle(g, "11px ui-monospace,SFMono-Regular,Menlo,monospace");
    this.#strokedText(g, "▸ " + this.#tickerText, this.#w / 2, INSET + 12);
  }

  // The solve is memoised on camera pose, viewport and #labelEpoch, and carries one
  // piece of history (#labelSide) so near-ties do not flip a label frame to frame.
  #drawLabels(g: CanvasRenderingContext2D): void {
    if (this.#cam.s < LABEL_HIDE_SCALE) return;
    const key =
      this.#cam.x.toFixed(2) +
      "|" +
      this.#cam.y.toFixed(2) +
      "|" +
      this.#cam.s.toFixed(4) +
      "|" +
      this.#w +
      "x" +
      this.#h +
      "|" +
      this.#labelEpoch;
    let cache = this.#labelCache;
    if (!cache || cache.key !== key) {
      cache = this.#solveLabels(g, key);
      this.#labelCache = cache;
    }
    this.#textStyle(g, cache.fs.toFixed(1) + "px " + LABEL_FONT);
    for (const it of cache.items) this.#strokedText(g, it.text, it.x, it.y);
  }

  // Greedy placement in priority order: stars are obstacles, labels hang vertically
  // above or below their own star, and each tries the full title, a clipped title, then
  // the number, keeping the first text that fits a slot.
  #solveLabels(
    g: CanvasRenderingContext2D,
    key: string,
  ): { key: string; fs: number; items: LabelDraw[] } {
    const fs = this.#labelPx();
    g.font = fs.toFixed(1) + "px " + LABEL_FONT;
    const measure = (text: string) => g.measureText(text).width;
    const s = this.#cam.s;
    const gap = 4;
    const step = fs + 4;

    const vis: { n: Node; sx: number; sy: number; rad: number }[] = [];
    for (const n of this.#nodes) {
      const sx = n.x * s + this.#cam.x;
      const sy = n.y * s + this.#cam.y;
      if (sx < -CULL_MARGIN || sx > this.#w + CULL_MARGIN) continue;
      if (sy < -CULL_MARGIN || sy > this.#h + CULL_MARGIN) continue;
      const core = STAR_SIZE[n.vstate].r * s;
      const rad =
        this.#selected === n.num
          ? core + SELECTED_LABEL_PAD
          : n.vstate === "claimed"
            ? core + CLAIMED_LABEL_PAD
            : core + 2 * s;
      vis.push({ n, sx, sy, rad });
    }

    const obstacles: Box[] = vis.map((v) => ({
      x0: v.sx - v.rad,
      y0: v.sy - v.rad,
      x1: v.sx + v.rad,
      y1: v.sy + v.rad,
    }));

    const order = [...vis].sort((a, b) => {
      const pa = this.#selected === a.n.num ? -1 : LABEL_PRIORITY[a.n.vstate];
      const pb = this.#selected === b.n.num ? -1 : LABEL_PRIORITY[b.n.vstate];
      return pa - pb || a.n.num - b.n.num;
    });

    const items: LabelDraw[] = [];
    for (const v of order) {
      const num = numberLabel(v.n.num);
      const clipped = clipToWidth(v.n.title, LABEL_CLIP_PX, measure);
      const texts = [`${num}  ${v.n.title}`];
      if (clipped !== null && clipped !== v.n.title) texts.push(`${num}  ${clipped}`);
      texts.push(num);

      const slot = (side: Side, k: number) =>
        side === BELOW
          ? v.sy + v.rad + gap + fs * 0.82 + k * step
          : v.sy - v.rad - gap - fs * 0.22 - k * step;

      const kept = this.#labelSide.get(v.n.num) ?? BELOW;
      const other: Side = kept === BELOW ? ABOVE : BELOW;
      const cands: { y: number; side: Side }[] = [];
      for (let k = 0; k <= 3 + SIDE_HYSTERESIS; k++) {
        if (k <= 3) cands.push({ y: slot(kept, k), side: kept });
        const j = k - SIDE_HYSTERESIS;
        if (j >= 0 && j <= 3) cands.push({ y: slot(other, j), side: other });
      }

      placing: for (const text of texts) {
        const w = measure(text);
        if (text !== num && w > this.#w - 4) continue;
        const left = clamp(v.sx - w / 2, 2, Math.max(2, this.#w - 2 - w));
        for (const c of cands) {
          const box: Box = {
            x0: left - 3,
            y0: c.y - fs * 0.82 - 2,
            x1: left + w + 3,
            y1: c.y + fs * 0.22 + 2,
          };
          if (obstacles.some((o) => hits(box, o))) continue;
          obstacles.push(box);
          items.push({ text, x: left + w / 2, y: c.y });
          this.#labelSide.set(v.n.num, c.side);
          break placing;
        }
      }
    }
    return { key, fs, items };
  }
}

function now(): number {
  return performance.now() / 1000;
}
