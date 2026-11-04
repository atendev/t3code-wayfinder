// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr

// An imperative canvas island behind a narrow seam. Frames run only while the camera
// is off its goal or a flare is above zero; every mutator calls wake(). Without a 2D
// context the island still ingests, lays out and selects, and draws nothing.

import { computeLayout, edgesOf, structureSignature, TAU } from "./layout";
import { GRAMMAR, type SessionState } from "./session";
import { hexA, LABEL, SESSION_HUE, STAR, visualState, type VisualState } from "./theme";
import type { StarTicket } from "./types";

export type SelectHandler = (num: number | null) => void;

const DEFAULT_BG = "#05070d";

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
  fill: string;
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

// A label keeps its side until the other side is clear by this many slots.
const SIDE_HYSTERESIS = 1;
const BELOW = 1;
const ABOVE = -1;
type Side = typeof BELOW | typeof ABOVE;

const TITLE_MIN_SCALE = 0.42;
const TITLE_FULL_SCALE = 1.6;
const TITLE_MIN_CHARS = 12;
const TITLE_MAX_CHARS = 60;
const TITLE_RAMP_EASE = 0.7;

export function titleBudget(scale: number): number {
  const u = clamp((scale - TITLE_MIN_SCALE) / (TITLE_FULL_SCALE - TITLE_MIN_SCALE), 0, 1);
  return Math.round(
    TITLE_MIN_CHARS + Math.pow(u, TITLE_RAMP_EASE) * (TITLE_MAX_CHARS - TITLE_MIN_CHARS),
  );
}

export function clipTitle(title: string, budget: number): string {
  if (title.length <= budget) return title;
  const cut = title.slice(0, budget);
  const sp = cut.lastIndexOf(" ");
  return (sp >= budget - 6 && sp > 0 ? cut.slice(0, sp) : cut.trimEnd()) + "…";
}

const TICKER_HOLD_MS = 4200;
const FLARE_SECONDS = 1.1;

/** A camera pose, carried across a remount by the host. */
export interface Camera {
  x: number;
  y: number;
  s: number;
}

// The ease runs on elapsed time so a 120 Hz panel is not twice as fast.
const CAM_TAU = 0.12;
const CAM_EPS = 0.02;
const SCALE_EPS = 0.0005;

const MIN_SCALE = 0.12;
const MAX_SCALE = 3;

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

  #cam: Camera = { x: 0, y: 0, s: 1 };
  #goal: Camera = { x: 0, y: 0, s: 1 };
  #insets = { top: 16, right: 16, bottom: 16, left: 16 };
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
  #bg = DEFAULT_BG;
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
    this.#refit(true);
    this.#wake();
  }

  // A push that keeps the structure only restyles stars; only a structure change
  // re-lays out and re-fits. A push that changes nothing does not wake.
  setModel(tickets: StarTicket[], sessions: Record<number, SessionState> = {}): void {
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
          changed.push(`#${t.num < 10 ? "0" : ""}${t.num} → ${vstate.replace("_", " ")}`);
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
    this.#refit(true);
    this.#wake();
  }

  #refreshEdges(tickets: StarTicket[]): void {
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
    if (num !== null) this.#seat(num);
    this.#wake();
  }

  fit(): void {
    this.#labelEpoch++;
    this.#refit(false);
    this.#settleIfHeadless();
    this.#wake();
  }

  // Only a pane claiming more room re-fits an unselected map; giving room back keeps the pose.
  setInsets(insets: Partial<{ top: number; right: number; bottom: number; left: number }>): void {
    const next = { ...this.#insets, ...insets };
    if (
      next.top === this.#insets.top &&
      next.right === this.#insets.right &&
      next.bottom === this.#insets.bottom &&
      next.left === this.#insets.left
    ) {
      return;
    }
    const claiming =
      next.top > this.#insets.top ||
      next.right > this.#insets.right ||
      next.bottom > this.#insets.bottom ||
      next.left > this.#insets.left;
    this.#insets = next;
    if (this.#selected !== null && this.#byNum.has(this.#selected)) {
      this.#seat(this.#selected);
    } else if (claiming) {
      this.#refit(false);
      this.#settleIfHeadless();
    }
    this.#wake();
  }

  /** Where the camera is going, not where it is mid-ease. */
  camera(): Camera {
    return { ...this.#goal };
  }

  /** Sets both camera and goal so a remount opens in place. Call it last. */
  restoreCamera(cam: Camera): void {
    if (!isFinite(cam.x) || !isFinite(cam.y) || !(cam.s > 0)) return;
    const s = clamp(cam.s, MIN_SCALE, MAX_SCALE);
    this.#goal = { x: cam.x, y: cam.y, s };
    this.#cam = { ...this.#goal };
    this.#labelEpoch++;
    this.#wake();
  }

  setBackground(color: string): void {
    this.#bg = color || DEFAULT_BG;
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

  /** The click path: hit-test, select, and emit. Empty space deselects. */
  selectAtScreen(sx: number, sy: number): number | null {
    let hit: Node | null = null;
    for (const n of this.#nodes) {
      const px = n.x * this.#cam.s + this.#cam.x;
      const py = n.y * this.#cam.s + this.#cam.y;
      const r = Math.max(14, STAR[n.vstate].r * this.#cam.s + 10);
      if (Math.hypot(sx - px, sy - py) < r) hit = n;
    }
    const num = hit ? hit.num : null;
    if (hit && !this.#reducedMotion) hit.flare = Math.max(hit.flare, 0.6);
    this.#selected = num;
    if (num !== null) this.#seat(num);
    this.#wake();
    this.#onSelect(num);
    return num;
  }

  #freeRect(): { cx: number; cy: number; availW: number; availH: number } {
    const left = this.#insets.left,
      right = this.#w - this.#insets.right,
      top = this.#insets.top,
      bottom = this.#h - this.#insets.bottom;
    return {
      cx: (left + right) / 2,
      cy: (top + bottom) / 2,
      availW: Math.max(80, right - left),
      availH: Math.max(80, bottom - top),
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

  #seat(num: number): void {
    const n = this.#byNum.get(num);
    if (!n) return;
    const { cx, cy } = this.#freeRect();
    this.#goal.x = cx - n.x * this.#goal.s;
    this.#goal.y = cy - n.y * this.#goal.s;
    this.#settleIfHeadless();
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

  // The world point at the free rect's centre stays there at the same zoom, snapped.
  // Always draws: #measure reassigns the backing store, which clears it even at the same size.
  #onResize(): void {
    const w = this.#w,
      h = this.#h;
    const before = this.#freeRect();
    this.#measure();
    if (this.#w !== w || this.#h !== h) {
      const after = this.#freeRect();
      const s = this.#goal.s;
      const wx = (before.cx - this.#goal.x) / s;
      const wy = (before.cy - this.#goal.y) / s;
      this.#goal.x = after.cx - wx * s;
      this.#goal.y = after.cy - wy * s;
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
    const s = clamp(Math.min(availW / (maxx - minx || 1), availH / (maxy - miny || 1)), 0.15, 1.4);
    const cx = (minx + maxx) / 2,
      cy = (miny + maxy) / 2;
    this.#goal.s = s;
    this.#goal.x = fcx - cx * s;
    this.#goal.y = fcy - cy * s;
    if (snap) this.#cam = { ...this.#goal };
  }

  #bindPointer(canvas: HTMLCanvasElement): void {
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const rectXY = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const endDrag = () => {
      canvas.classList.remove("drag");
      drag = null;
    };
    const onDown = (e: MouseEvent) => {
      this.#gesture = null;
      drag = { x: e.clientX, y: e.clientY, moved: false };
      canvas.classList.add("drag");
    };
    const onMove = (e: MouseEvent) => {
      if (!drag) return;
      // A mouse-up lost outside the window shows up as a move with no buttons held.
      if (e.buttons === 0) {
        endDrag();
        return;
      }
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      this.#pan(dx, dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const onUp = (e: MouseEvent) => {
      const click = drag !== null && !drag.moved;
      endDrag();
      if (click) {
        const { x, y } = rectXY(e);
        this.selectAtScreen(x, y);
      }
    };
    const pixelsOf = (e: WheelEvent, cap: number) => {
      const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? this.#h : 1;
      return clamp(e.deltaY * unit, -cap, cap);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.#gesture && now() - this.#gesture.at < 0.5) return;
      this.#gesture = null;
      const { x, y } = rectXY(e);
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
      const { x, y } = rectXY(e);
      this.#zoomAt(x, y, s / (g.scale || 1));
      g.scale = s;
      g.at = now();
    };
    const onGestureEnd = (ev: Event) => {
      ev.preventDefault();
      this.#gesture = null;
    };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("gesturestart", onGestureStart);
    canvas.addEventListener("gesturechange", onGestureChange);
    canvas.addEventListener("gestureend", onGestureEnd);
    this.#detach.push(
      () => canvas.removeEventListener("mousedown", onDown),
      () => window.removeEventListener("mousemove", onMove),
      () => window.removeEventListener("mouseup", onUp),
      () => canvas.removeEventListener("wheel", onWheel),
      () => canvas.removeEventListener("gesturestart", onGestureStart),
      () => canvas.removeEventListener("gesturechange", onGestureChange),
      () => canvas.removeEventListener("gestureend", onGestureEnd),
    );
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

  #draw(): void {
    const g = this.#ctx;
    if (!g) return;
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.fillStyle = this.#bg;
    g.fillRect(0, 0, this.#w, this.#h);
    this.#drawStarfield(g);

    g.save();
    g.translate(this.#cam.x, this.#cam.y);
    g.scale(this.#cam.s, this.#cam.s);
    for (const e of this.#edges) this.#drawEdge(g, e);
    for (const n of this.#nodes) this.#drawStar(g, n);
    g.restore();
    this.#drawLabels(g);
    this.#drawTicker(g);
  }

  #drawStarfield(g: CanvasRenderingContext2D): void {
    const W = this.#w,
      H = this.#h;
    for (const L of this.#starfield) {
      for (const s of L.stars) {
        const x = mod(s.x * W + this.#cam.x * L.f, W);
        const y = mod(s.y * H + this.#cam.y * L.f, H);
        g.globalAlpha = L.a * (0.65 + 0.35 * Math.sin(s.t * TAU));
        g.fillStyle = "rgba(255,255,255,1)";
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
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo(cx, cy, bx, by);
    if (e.satisfied) {
      g.strokeStyle = "rgba(160,192,166,0.62)";
      g.lineWidth = 1.8;
      g.setLineDash([]);
    } else {
      g.strokeStyle = "rgba(132,146,168,0.34)";
      g.lineWidth = 1.3;
      g.setLineDash([4, 6]);
    }
    g.stroke();
    g.setLineDash([]);
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
    g.fillStyle = e.satisfied ? "#aecdb6" : "#6f7889";
    g.fill();
  }

  #drawStar(g: CanvasRenderingContext2D, n: Node): void {
    const c = STAR[n.vstate];
    const x = n.x,
      y = n.y,
      fl = n.flare;
    const isF = n.vstate === "frontier";
    const glow = isF ? 1 : 0.8;
    const gr = (isF ? c.gr * 1.08 : c.gr) * (1 + fl * 0.5);

    const grd = g.createRadialGradient(x, y, 0, x, y, gr);
    grd.addColorStop(0, hexA(c.glow, Math.min(1, 0.85 * glow + fl * 0.5)));
    grd.addColorStop(0.4, hexA(c.glow, 0.22 * glow));
    grd.addColorStop(1, hexA(c.glow, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, gr, 0, TAU);
    g.fill();

    const cr = c.r;
    const cg = g.createRadialGradient(x, y, 0, x, y, cr * 1.35);
    cg.addColorStop(0, hexA(c.core, 1));
    cg.addColorStop(0.6, hexA(c.core, 0.92));
    cg.addColorStop(0.82, hexA(c.core, 0.45));
    cg.addColorStop(1, hexA(c.core, 0));
    g.fillStyle = cg;
    g.beginPath();
    g.arc(x, y, cr * 1.35, 0, TAU);
    g.fill();

    if (fl > 0) {
      g.strokeStyle = hexA(c.core, fl * 0.7);
      g.lineWidth = 1.5 + 2 * fl;
      g.beginPath();
      g.arc(x, y, c.r + (1 - fl) * 40, 0, TAU);
      g.stroke();
    }
    // The static claimed ring is a fallback; a session glyph speaks for the claim when present.
    if (n.vstate === "claimed" && !n.sstate) {
      g.strokeStyle = hexA(c.core, 0.58);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, c.r + 5.6, 0, TAU);
      g.stroke();
      g.strokeStyle = hexA(c.core, 0.25);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, c.r + 11.9, 0, TAU);
      g.stroke();
    }
    if (n.sstate) this.#drawSession(g, n.sstate, n.num, x, y, c.r);
    if (this.#selected === n.num) {
      g.strokeStyle = "rgba(255,255,255,0.85)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, c.r + 13, 0, TAU);
      g.stroke();
    }
  }

  #drawSession(
    g: CanvasRenderingContext2D,
    s: SessionState,
    num: number,
    x: number,
    y: number,
    r: number,
  ): void {
    const gm = GRAMMAR[s];
    const orbR = r + 10;
    const frozen = gm.moon === "frozen";

    if (frozen) {
      g.strokeStyle = hexA(SESSION_HUE.dead, 0.3);
      g.setLineDash([3, 5]);
    } else {
      g.strokeStyle = hexA(SESSION_HUE.session, 0.16);
    }
    g.lineWidth = 1;
    g.beginPath();
    g.arc(x, y, orbR, 0, TAU);
    g.stroke();
    g.setLineDash([]);

    const ang = num * 1.3;
    const mx = x + Math.cos(ang) * orbR,
      my = y + Math.sin(ang) * orbR;

    if (gm.marks.includes("trail")) {
      for (let k = 1; k <= 3; k++) {
        const ta = ang - k * 0.22;
        g.fillStyle = hexA(SESSION_HUE.session, 0.3 - k * 0.09);
        g.beginPath();
        g.arc(x + Math.cos(ta) * orbR, y + Math.sin(ta) * orbR, 1.6, 0, TAU);
        g.fill();
      }
    }

    g.fillStyle = hexA(frozen ? SESSION_HUE.dead : SESSION_HUE.session, frozen ? 0.9 : 0.95);
    g.beginPath();
    g.arc(mx, my, frozen ? 2.4 : 2.7, 0, TAU);
    g.fill();

    if (gm.marks.includes("halo")) {
      g.strokeStyle = hexA(SESSION_HUE.dead, 0.7);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(mx, my, 4.6, 0, TAU);
      g.stroke();
    }
  }

  #drawTicker(g: CanvasRenderingContext2D): void {
    if (!this.#tickerText) return;
    const { cx } = this.#freeRect();
    g.font = "11px ui-monospace,SFMono-Regular,Menlo,monospace";
    g.textAlign = "center";
    g.shadowColor = "rgba(0,0,0,0.85)";
    g.shadowBlur = 4;
    g.fillStyle = SESSION_HUE.gold;
    g.fillText("▸ " + this.#tickerText, cx, this.#insets.top + 20);
    g.shadowBlur = 0;
  }

  // The solve is memoised on camera pose, viewport and #labelEpoch, and carries one
  // piece of history (#labelSide) so near-ties do not flip a label frame to frame.
  #drawLabels(g: CanvasRenderingContext2D): void {
    if (this.#cam.s < 0.22) return;
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
    g.textAlign = "center";
    g.font = cache.fs.toFixed(1) + "px ui-sans-serif,system-ui,sans-serif";
    g.shadowColor = "rgba(0,0,0,0.85)";
    g.shadowBlur = 4;
    for (const it of cache.items) {
      g.fillStyle = it.fill;
      g.fillText(it.text, it.x, it.y);
    }
    g.shadowBlur = 0;
  }

  // Greedy placement in priority order: stars are obstacles, labels hang vertically
  // above or below their own star, and a label that fits nowhere is dropped.
  #solveLabels(
    g: CanvasRenderingContext2D,
    key: string,
  ): { key: string; fs: number; items: LabelDraw[] } {
    const numOnly = this.#cam.s < TITLE_MIN_SCALE;
    const budget = titleBudget(this.#cam.s);
    const fs = clamp(11 * Math.pow(this.#cam.s, 0.3), 8, 13);
    g.font = fs.toFixed(1) + "px ui-sans-serif,system-ui,sans-serif";
    const s = this.#cam.s;
    const gap = 4;
    const step = fs + 4;

    const vis: { n: Node; sx: number; sy: number; rad: number }[] = [];
    for (const n of this.#nodes) {
      const sx = n.x * s + this.#cam.x;
      const sy = n.y * s + this.#cam.y;
      if (sx < -CULL_MARGIN || sx > this.#w + CULL_MARGIN) continue;
      if (sy < -CULL_MARGIN || sy > this.#h + CULL_MARGIN) continue;
      const c = STAR[n.vstate];
      let r = c.r + 2;
      if (n.sstate) r = c.r + 15;
      if (this.#selected === n.num) r = Math.max(r, c.r + 14);
      vis.push({ n, sx, sy, rad: r * s });
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
      let text = (v.n.num < 10 ? "0" : "") + v.n.num;
      if (!numOnly) text += "  " + clipTitle(v.n.title, budget);
      const w = g.measureText(text).width;

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

      const left = v.sx - w / 2;
      for (const c of cands) {
        const box: Box = {
          x0: left - 3,
          y0: c.y - fs * 0.82 - 2,
          x1: left + w + 3,
          y1: c.y + fs * 0.22 + 2,
        };
        if (obstacles.some((o) => hits(box, o))) continue;
        obstacles.push(box);
        items.push({ text, x: v.sx, y: c.y, fill: LABEL[v.n.vstate] });
        this.#labelSide.set(v.n.num, c.side);
        break;
      }
    }
    return { key, fs, items };
  }
}

function now(): number {
  return performance.now() / 1000;
}
