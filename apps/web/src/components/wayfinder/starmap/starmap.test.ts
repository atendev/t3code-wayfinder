// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { computeLayout, structureSignature } from "./layout";
import { GRAMMAR, nonColorSignature, type SessionState } from "./session";
import { clipToWidth, StarMap } from "./starmap";
import type { StarTicket, TicketStatus } from "./types";

// The unit project runs in node, so the island gets a minimal fake DOM: a canvas that
// is an EventTarget, a window EventTarget, and a ResizeObserver the test fires by hand.
class FakeCanvas extends EventTarget {
  width = 0;
  height = 0;
  style: Record<string, string> = {};
  widthWrites = 0;
  classList = { add: () => {}, remove: () => {} };
  constructor(private readonly ctx: unknown) {
    super();
  }
  getContext() {
    return this.ctx;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0 };
  }
  setPointerCapture() {}
  remove() {}
}

interface Harness {
  frames: Map<number, FrameRequestCallback>;
  paints: number;
  resize: (() => void)[];
  ctx: Record<string, unknown> | null;
  drawn: { text: string; x: number; y: number; align: string; font: string }[];
  arcs: number;
  dashes: number[][];
}

let harness: Harness;

function recordingContext(h: Harness): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    textAlign: "center",
    font: "",
    createRadialGradient: () => ({ addColorStop: () => {} }),
    measureText: (s: string) => ({ width: s.length * 6 }),
    setTransform: () => {
      h.paints++;
    },
    fillText(this: Record<string, unknown>, text: string, x: number, y: number) {
      h.drawn.push({ text, x, y, align: this.textAlign as string, font: this.font as string });
    },
    arc: () => {
      h.arcs++;
    },
    setLineDash: (segments: number[]) => {
      h.dashes.push(segments);
    },
  };
  for (const m of [
    "fillRect",
    "beginPath",
    "fill",
    "stroke",
    "moveTo",
    "lineTo",
    "closePath",
    "quadraticCurveTo",
    "save",
    "restore",
    "translate",
    "scale",
    "strokeText",
  ]) {
    ctx[m] = () => {};
  }
  return ctx;
}

function setup(options: { live: boolean }): Harness {
  let nextFrame = 0;
  const h: Harness = {
    frames: new Map(),
    paints: 0,
    resize: [],
    ctx: null,
    drawn: [],
    arcs: 0,
    dashes: [],
  };
  h.ctx = options.live ? recordingContext(h) : null;
  vi.stubGlobal("window", Object.assign(new EventTarget(), { devicePixelRatio: 1 }));
  vi.stubGlobal("document", { createElement: () => new FakeCanvas(h.ctx) });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    h.frames.set(++nextFrame, cb);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => h.frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        h.resize.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  harness = h;
  return h;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture(overrides: Partial<Record<number, TicketStatus>> = {}): StarTicket[] {
  const base: Array<[number, string, number[]]> = [
    [1, "The filtering seam and the streaming CSV download", []],
    [2, "Per-date historical conversion and rate backfill", [1]],
    [3, "The Export page and its preview fragment", [1]],
    [4, "The live-preview endpoint and island", [3]],
    [5, "Docs and architecture catch up with what shipped", [2, 4]],
  ];
  return base.map(([num, title, blockedBy]) => ({
    num,
    title,
    type: "task",
    status: overrides[num] ?? "open",
    blockedBy,
    frontier: overrides[num] === undefined && blockedBy.length === 0,
  }));
}

const LIFECYCLE: Array<Record<number, TicketStatus>> = [
  { 1: "resolved", 2: "resolved", 3: "claimed" },
  { 1: "resolved", 2: "resolved", 3: "resolved", 4: "claimed" },
  { 1: "resolved", 2: "resolved", 3: "resolved", 4: "resolved", 5: "out_of_scope" },
];

function beat(overrides: Partial<Record<number, TicketStatus>>, frontier: number[] = []) {
  return fixture(overrides).map((t) => ({ ...t, frontier: frontier.includes(t.num) }));
}

interface Host {
  clientWidth: number;
  clientHeight: number;
  canvas: FakeCanvas | null;
  appendChild(c: FakeCanvas): void;
}

const PALETTE = {
  background: "oklch(0.2 0 0)",
  frontier: "oklch(0.8 0.1 230)",
  claimed: "oklch(0.8 0.1 80)",
  resolved: "oklch(0.8 0.1 150)",
  blocked: "oklch(0.6 0 0)",
  edge: "oklch(0.9 0 0)",
  edgeMuted: "oklch(0.6 0 0)",
  label: "oklch(0.7 0 0)",
  labelStroke: "oklch(0.2 0 0)",
  scheme: "dark",
  highContrast: false,
} as const;

function mounted(): { sm: StarMap; host: Host; canvas: FakeCanvas } {
  const host: Host = {
    clientWidth: 1000,
    clientHeight: 700,
    canvas: null,
    appendChild(c) {
      this.canvas = c;
    },
  };
  const sm = new StarMap();
  sm.mount(host as unknown as HTMLElement);
  sm.setPalette(PALETTE);
  return { sm, host, canvas: host.canvas! };
}

function pointer(type: string, init: Record<string, number | string> = {}): Event {
  return Object.assign(new Event(type), {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: 0,
    clientY: 0,
    ...init,
  });
}

function pan(canvas: FakeCanvas, dx: number, dy: number): void {
  canvas.dispatchEvent(pointer("pointerdown"));
  canvas.dispatchEvent(pointer("pointermove", { clientX: dx, clientY: dy }));
  canvas.dispatchEvent(pointer("pointerup", { clientX: dx, clientY: dy }));
}

function click(canvas: FakeCanvas, at: { x: number; y: number }): void {
  canvas.dispatchEvent(pointer("pointerdown", { clientX: at.x, clientY: at.y }));
  canvas.dispatchEvent(pointer("pointerup", { clientX: at.x, clientY: at.y }));
}

function wheel(canvas: FakeCanvas, init: Record<string, number | boolean>): void {
  const e = Object.assign(new Event("wheel", { cancelable: true }), {
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    clientX: 500,
    clientY: 350,
    ...init,
  });
  canvas.dispatchEvent(e);
}

// Runs the pending frame at the fake clock; the island schedules at most one.
function step(ms: number): void {
  vi.advanceTimersByTime(ms);
  const [id, cb] = harness.frames.entries().next().value ?? [];
  if (id === undefined || !cb) return;
  harness.frames.delete(id);
  cb(0);
}

function settle(): void {
  for (let i = 0; i < 150 && harness.frames.size > 0; i++) step(16);
}

describe("deterministic layout", () => {
  it("lays the same data out to the same positions every time", () => {
    expect(computeLayout(fixture())).toEqual(computeLayout(fixture()));
  });

  it("is independent of the order tickets arrive in", () => {
    expect(computeLayout([...fixture()].reverse())).toEqual(computeLayout(fixture()));
  });

  it("does not take status as an input to layout", () => {
    expect(computeLayout(fixture({ 1: "resolved", 3: "claimed", 5: "out_of_scope" }))).toEqual(
      computeLayout(fixture()),
    );
  });
});

describe("the island seam", () => {
  let sm: StarMap;
  let canvas: FakeCanvas;
  beforeEach(() => {
    setup({ live: false });
    ({ sm, canvas } = mounted());
  });

  it("never moves a star as the model pushes new statuses across the lifecycle", () => {
    sm.setModel(fixture());
    const start = sm.positions();
    for (const b of LIFECYCLE) {
      sm.setModel(fixture(b));
      expect(sm.positions()).toEqual(start);
    }
  });

  it("recomputes layout only when the structure changes", () => {
    sm.setModel(fixture());
    const five = sm.positions();
    expect(structureSignature(fixture())).toBe(structureSignature(fixture({ 3: "claimed" })));
    const four = fixture().filter((t) => t.num !== 5);
    sm.setModel(four);
    expect(sm.positions()).toEqual(computeLayout(four));
    sm.setModel(fixture());
    expect(sm.positions()).toEqual(five);
  });

  it("emits selection on the click path only, and a click on empty space emits nothing", () => {
    sm.setModel(fixture());
    const emitted: (number | null)[] = [];
    sm.onSelect((n) => emitted.push(n));

    sm.select(2);
    expect(emitted).toEqual([]);

    click(canvas, sm.screenOf(3)!);
    const pose = sm.camera();
    expect(sm.selectAtScreen(-9999, -9999)).toBe(null);
    click(canvas, { x: -9999, y: -9999 });
    expect(emitted).toEqual([3]);
    expect(sm.camera()).toEqual(pose);
  });

  it("picks the nearest star in reach, with a wider reach for touch", () => {
    sm.setModel(fixture());
    const p = sm.positions();
    const d = Math.hypot(p[2]!.x - p[1]!.x, p[2]!.y - p[1]!.y);
    sm.restoreCamera({ x: 0, y: 0, s: 30 / d });
    const a = sm.screenOf(1)!,
      b = sm.screenOf(2)!;
    const at = { x: a.x + (b.x - a.x) * 0.4, y: a.y + (b.y - a.y) * 0.4 };
    expect(Math.hypot(b.x - at.x, b.y - at.y)).toBeLessThan(22);
    expect(sm.selectAtScreen(at.x, at.y, true)).toBe(1);

    const seated = sm.screenOf(1)!;
    const off = { x: seated.x, y: seated.y + 18 };
    expect(sm.selectAtScreen(off.x, off.y)).toBe(null);
    expect(sm.selectAtScreen(off.x, off.y, true)).toBe(1);
  });

  it("seats an off-screen star in view and leaves an on-screen one where it is", () => {
    sm.setModel(fixture());
    const pose = sm.camera();
    sm.select(3);
    expect(sm.camera()).toEqual(pose);

    const p = sm.positions()[3]!;
    sm.restoreCamera({ x: -p.x - 400, y: 350 - p.y, s: 1 });
    sm.select(3);
    const seated = sm.screenOf(3)!;
    expect(seated.x).toBeCloseTo(500, 6);
    expect(seated.y).toBeCloseTo(350, 6);
    expect(sm.camera().s).toBe(1);
  });

  it("drops a stale selection when its ticket leaves the map", () => {
    sm.setModel(fixture());
    sm.select(5);
    sm.setModel(fixture().filter((t) => t.num !== 5));
    sm.select(5);
    expect(sm.screenOf(5)).toBe(null);
  });

  it("pinch-zooms about the midpoint of two pointers", () => {
    sm.setModel(fixture());
    const p = sm.positions();
    const worldUnder = (x: number, y: number) => {
      const a = sm.screenOf(1)!;
      const s = sm.camera().s;
      return { x: (x - a.x) / s + p[1]!.x, y: (y - a.y) / s + p[1]!.y };
    };
    const pinned = worldUnder(500, 350);
    const s0 = sm.camera().s;
    canvas.dispatchEvent(
      pointer("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 450, clientY: 350 }),
    );
    canvas.dispatchEvent(
      pointer("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 550, clientY: 350 }),
    );
    canvas.dispatchEvent(
      pointer("pointermove", { pointerId: 1, pointerType: "touch", clientX: 425, clientY: 350 }),
    );
    canvas.dispatchEvent(
      pointer("pointermove", { pointerId: 2, pointerType: "touch", clientX: 575, clientY: 350 }),
    );
    canvas.dispatchEvent(
      pointer("pointerup", { pointerId: 1, pointerType: "touch", clientX: 425, clientY: 350 }),
    );
    canvas.dispatchEvent(
      pointer("pointerup", { pointerId: 2, pointerType: "touch", clientX: 575, clientY: 350 }),
    );
    expect(sm.camera().s).toBeCloseTo(s0 * 1.5, 6);
    const after = worldUnder(500, 350);
    expect(after.x).toBeCloseTo(pinned.x, 6);
    expect(after.y).toBeCloseTo(pinned.y, 6);
  });
});

describe("the camera pose on the seam", () => {
  beforeEach(() => {
    setup({ live: false });
  });

  it("reads back where the operator put the map, and puts a new island there", () => {
    const first = mounted();
    first.sm.setModel(fixture());
    pan(first.canvas, 140, -60);
    const pose = first.sm.camera();
    const where = first.sm.screenOf(3)!;

    const second = mounted();
    second.sm.setModel(fixture());
    expect(second.sm.screenOf(3)).not.toEqual(where);
    second.sm.restoreCamera(pose);
    expect(second.sm.screenOf(3)).toEqual(where);
  });

  it("sets fitted on mount, fit and a structure change, and clears it on a manual move", () => {
    const { sm, canvas } = mounted();
    sm.setModel(fixture());
    expect(sm.camera().fitted).toBe(true);
    pan(canvas, 40, 0);
    expect(sm.camera().fitted).toBe(false);
    sm.fit();
    expect(sm.camera().fitted).toBe(true);
    wheel(canvas, { deltaY: -120 });
    expect(sm.camera().fitted).toBe(false);
    sm.setModel(fixture().filter((t) => t.num !== 5));
    expect(sm.camera().fitted).toBe(true);
    sm.restoreCamera({ x: 0, y: 0, s: 1 });
    expect(sm.camera().fitted).toBe(false);
  });

  it("refits on resize while fitted, and otherwise holds the centre", () => {
    const { sm, canvas, host } = mounted();
    sm.setModel(fixture());
    const wide = sm.camera();
    host.clientWidth = 400;
    harness.resize.at(-1)!();
    const narrow = sm.camera();
    expect(narrow.fitted).toBe(true);
    expect(narrow.s).toBeLessThan(wide.s);

    pan(canvas, 30, 0);
    const pose = sm.camera();
    host.clientWidth = 600;
    harness.resize.at(-1)!();
    expect(sm.camera()).toEqual({ ...pose, x: pose.x + 100 });
  });

  it("refuses a pose it cannot paint, and clamps one past the zoom stops", () => {
    const { sm } = mounted();
    sm.setModel(fixture());
    const fit = sm.camera();
    sm.restoreCamera({ x: NaN, y: 0, s: 1 });
    sm.restoreCamera({ x: 0, y: 0, s: 0 });
    expect(sm.camera()).toEqual(fit);
    sm.restoreCamera({ x: 10, y: 10, s: 900 });
    expect(sm.camera().s).toBe(3);
  });
});

const SESSION_LIFECYCLE: Array<{ tickets: StarTicket[]; sessions: Record<number, SessionState> }> =
  [
    {
      tickets: beat({ 1: "resolved", 2: "resolved", 3: "claimed" }),
      sessions: { 3: "working" },
    },
    {
      tickets: beat({ 1: "resolved", 2: "resolved", 3: "claimed" }),
      sessions: { 3: "unattended" },
    },
    { tickets: beat({ 1: "resolved", 2: "resolved", 3: "resolved" }, [4]), sessions: {} },
  ];

describe("the session overlay and ticker", () => {
  beforeEach(() => {
    setup({ live: false });
  });

  it("carries the overlay without moving a star", () => {
    const { sm } = mounted();
    sm.setModel(fixture());
    const start = sm.positions();
    for (const b of SESSION_LIFECYCLE) {
      sm.setModel(b.tickets, b.sessions);
      expect(sm.positions()).toEqual(start);
      expect(sm.overlays()).toEqual(b.sessions);
    }
  });

  it("writes a ticker line for visual-state changes only, and none on the first ingest", () => {
    const { sm } = mounted();
    sm.setModel(SESSION_LIFECYCLE[0]!.tickets, SESSION_LIFECYCLE[0]!.sessions);
    expect(sm.ticker()).toBe(null);

    sm.setModel(SESSION_LIFECYCLE[1]!.tickets, SESSION_LIFECYCLE[1]!.sessions);
    expect(sm.ticker()).toBe(null);

    sm.setModel(SESSION_LIFECYCLE[2]!.tickets, SESSION_LIFECYCLE[2]!.sessions);
    expect(sm.ticker()).toContain("#03 → resolved");
    expect(sm.ticker()).toContain("#04 → frontier");
  });

  // One paint per row; the extra arcs over a claimed star with no session key are its marks.
  it.each([
    { sessions: {}, extraArcs: 0, dashed: false },
    { sessions: { 3: "working" } as const, extraArcs: 3, dashed: false },
    { sessions: { 3: "needs_user" } as const, extraArcs: 2, dashed: false },
    { sessions: { 3: "unattended" } as const, extraArcs: 0, dashed: true },
  ])("draws the marks the grammar names for $sessions", ({ sessions, extraArcs, dashed }) => {
    const paintArcs = (states: Record<number, SessionState>) => {
      vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
      setup({ live: true });
      const { sm } = mounted();
      sm.setModel(SESSION_LIFECYCLE[0]!.tickets, states);
      settle();
      harness.arcs = 0;
      harness.dashes = [];
      sm.setPalette(PALETTE);
      step(16);
      // The orbit dash is even and scales with the camera; edge dashes are uneven.
      const dashed = harness.dashes.some((d) => d.length === 2 && d[0] === d[1] && d[0]! > 0);
      return { arcs: harness.arcs, dashed };
    };
    const bare = paintArcs({});
    const marked = paintArcs(sessions);
    expect(marked.arcs - bare.arcs).toBe(extraArcs);
    expect(marked.dashed).toBe(dashed);
  });

  it("gives every session state a distinct shape and spends at most two hues", () => {
    const all: SessionState[] = ["working", "needs_user", "unattended"];
    expect(new Set(all.map(nonColorSignature)).size).toBe(all.length);
    expect(new Set(all.map((s) => GRAMMAR[s].hue)).size).toBeLessThanOrEqual(2);
  });
});

describe("clipping a title to a width", () => {
  const measure = (s: string) => s.length * 6;

  it("keeps a title that fits, and otherwise cuts at a word boundary with an ellipsis", () => {
    expect(clipToWidth("Short one", 180, measure)).toBe("Short one");
    expect(clipToWidth("The agent adapter contract", 72, measure)).toBe("The agent…");
  });

  it("gives up when not even the first word fits", () => {
    expect(clipToWidth("Supercalifragilistic expialidocious", 60, measure)).toBe(null);
  });
});

const CROWDED: StarTicket[] = [
  {
    num: 1,
    title: "The root everything hangs from",
    type: "task",
    status: "open",
    blockedBy: [],
    frontier: true,
  },
  ...Array.from({ length: 12 }, (_, i) => ({
    num: i + 2,
    title: `A dependent with a fairly long title that runs well past the clip width ${i + 2}`,
    type: "task",
    status: "open" as const,
    blockedBy: [1],
    frontier: false,
  })),
];

describe("label placement", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
    setup({ live: true });
  });

  function labels() {
    return harness.drawn.filter((d) => !d.text.startsWith("▸"));
  }
  function boxes() {
    const drawn = labels();
    const fs = parseFloat(drawn[0]?.font ?? "11");
    return drawn.map((d) => {
      const w = d.text.length * 6;
      return {
        text: d.text,
        x0: d.x - w / 2,
        y0: d.y - fs * 0.82,
        x1: d.x + w / 2,
        y1: d.y + fs * 0.22,
      };
    });
  }
  const overlaps = (a: ReturnType<typeof boxes>[number], b: ReturnType<typeof boxes>[number]) =>
    a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  it("never draws two labels across each other, or a label outside the canvas", () => {
    const { sm } = mounted();
    sm.setModel(CROWDED);
    harness.drawn.length = 0;
    step(16);
    const placed = boxes();
    expect(placed.length).toBeGreaterThan(0);
    for (let i = 0; i < placed.length; i++) {
      expect(placed[i]!.x0).toBeGreaterThanOrEqual(0);
      expect(placed[i]!.x1).toBeLessThanOrEqual(1000);
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i]!, placed[j]!)).toBe(false);
      }
    }
  });

  function labelKinds(width: number): Set<string> {
    const { sm, host } = mounted();
    host.clientWidth = width;
    harness.resize.at(-1)!();
    sm.setModel(CROWDED);
    harness.drawn.length = 0;
    step(16);
    const byNum = new Map(CROWDED.map((t) => [String(t.num).padStart(2, "0"), t.title]));
    const kinds = new Set<string>();
    for (const d of labels()) {
      const num = d.text.slice(0, 2);
      const title = byNum.get(num)!;
      const clipped = clipToWidth(title, 180, (s) => s.length * 6);
      if (d.text === `${num}  ${title}`) kinds.add("full");
      else if (d.text === `${num}  ${clipped}`) kinds.add("clipped");
      else if (d.text === num) kinds.add("number");
      else throw new Error(`unexpected label ${d.text}`);
      expect(parseFloat(d.font)).toBeGreaterThanOrEqual(11);
    }
    return kinds;
  }

  it("draws the full title when it fits, and falls back to the clipped title, then the number", () => {
    expect(labelKinds(1000)).toEqual(new Set(["full"]));
    expect(labelKinds(320)).toEqual(new Set(["full", "clipped", "number"]));
  });

  it("keeps the selected star labelled when the map is crowded", () => {
    const { sm, canvas } = mounted();
    sm.setModel(CROWDED);
    click(canvas, sm.screenOf(7)!);
    harness.drawn.length = 0;
    step(16);
    expect(labels().some((d) => d.text.startsWith("07"))).toBe(true);
  });
});

describe("the camera", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
    setup({ live: true });
  });

  function live() {
    const m = mounted();
    m.sm.setModel(fixture());
    settle();
    return m;
  }

  it("holds the world still under the cursor for the whole flight of a zoom", () => {
    const { sm, canvas } = live();
    const anchor = { x: 700, y: 200 };
    const worldAt = () => {
      const p = sm.positions();
      const a = sm.screenOf(1)!,
        b = sm.screenOf(5)!;
      const s = Math.hypot(b.x - a.x, b.y - a.y) / Math.hypot(p[5]!.x - p[1]!.x, p[5]!.y - p[1]!.y);
      return {
        x: (anchor.x - (a.x - p[1]!.x * s)) / s,
        y: (anchor.y - (a.y - p[1]!.y * s)) / s,
        s,
      };
    };
    const pinned = worldAt();
    wheel(canvas, { deltaY: -240, clientX: anchor.x, clientY: anchor.y });
    for (let i = 0; i < 40; i++) {
      step(16);
      const w = worldAt();
      expect(Math.hypot(w.x - pinned.x, w.y - pinned.y)).toBeLessThan(0.05);
    }
    expect(worldAt().s).toBeGreaterThan(pinned.s * 1.2);
  });

  it("eases on the clock, not on the frame, so a 120Hz panel is not twice as fast", () => {
    const run = (stepMs: number, steps: number) => {
      const { sm, canvas } = live();
      wheel(canvas, { deltaY: -240, clientX: 700, clientY: 200 });
      for (let i = 0; i < steps; i++) step(stepMs);
      const at = sm.screenOf(5)!;
      sm.destroy();
      return at;
    };
    const slow = run(16, 10);
    const fast = run(8, 20);
    expect(fast.x).toBeCloseTo(slow.x, 2);
    expect(fast.y).toBeCloseTo(slow.y, 2);
  });

  it("trails a drag and lands exactly where it was put", () => {
    const { sm, canvas } = live();
    const start = sm.screenOf(1)!.x;
    canvas.dispatchEvent(pointer("pointerdown"));
    canvas.dispatchEvent(pointer("pointermove", { clientX: 300 }));
    step(16);
    const trailing = sm.screenOf(1)!.x - start;
    expect(trailing).toBeGreaterThan(0);
    expect(trailing).toBeLessThan(300);
    canvas.dispatchEvent(pointer("pointerup", { clientX: 300 }));
    settle();
    expect(sm.screenOf(1)!.x - start).toBeCloseTo(300, 6);
  });
});

// Spec section 8's proof of stop: every trigger ends with an empty frame queue and no timers.
describe("the render loop stops", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
    setup({ live: true });
  });

  function expectAtRest(): void {
    settle();
    expect(harness.frames.size).toBe(0);
    vi.advanceTimersByTime(4200);
    settle();
    expect(harness.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  }

  function ready() {
    const m = mounted();
    m.sm.setModel(fixture());
    expectAtRest();
    return m;
  }

  function remount(prev: ReturnType<typeof mounted>, selected: number | null) {
    const pose = prev.sm.camera();
    prev.sm.destroy();
    const next = mounted();
    next.sm.setModel(fixture());
    next.sm.select(selected);
    if (pose.fitted) next.sm.fit();
    else next.sm.restoreCamera(pose);
    step(16);
    expect(harness.frames.size).toBe(0);
    return next;
  }

  const rows: Array<{ name: string; act: (m: ReturnType<typeof mounted>) => void }> = [
    {
      name: "setModel with a visual-state change flares and ticks",
      act: ({ sm }) => {
        sm.setModel(fixture({ 1: "resolved" }));
        expect(harness.frames.size).toBe(1);
        expect(sm.ticker()).toContain("#01");
      },
    },
    {
      name: "setModel with a session-state change paints once, with no flare and no ticker line",
      act: ({ sm }) => {
        const claimed = fixture({ 3: "claimed" });
        sm.setModel(claimed, {});
        expectAtRest();
        sm.setModel(claimed, { 3: "working" });
        expect(harness.frames.size).toBe(1);
        step(16);
        expect(harness.frames.size).toBe(0);
        expect(sm.ticker()).toBe(null);
        expect(sm.overlays()).toEqual({ 3: "working" });
      },
    },
    {
      name: "setModel with nothing changed schedules no frame",
      act: ({ sm }) => {
        sm.setModel(fixture());
        expect(harness.frames.size).toBe(0);
      },
    },
    {
      name: "select, then select of the already-selected star paints once",
      act: ({ sm }) => {
        sm.select(3);
        settle();
        sm.select(3);
        expect(harness.frames.size).toBe(1);
        step(16);
        expect(harness.frames.size).toBe(0);
      },
    },
    { name: "drag", act: ({ canvas }) => pan(canvas, 80, 40) },
    {
      name: "a drag ended by pointercancel",
      act: ({ sm, canvas }) => {
        canvas.dispatchEvent(pointer("pointerdown"));
        canvas.dispatchEvent(pointer("pointermove", { clientX: 50 }));
        canvas.dispatchEvent(pointer("pointercancel", { clientX: 50 }));
        settle();
        const pose = sm.camera();
        canvas.dispatchEvent(pointer("pointermove", { clientX: 200 }));
        expect(sm.camera()).toEqual(pose);
      },
    },
    {
      name: "restoreCamera paints once without animating",
      act: ({ sm }) => {
        sm.restoreCamera({ x: 10, y: 20, s: 1 });
        step(16);
        expect(harness.frames.size).toBe(0);
      },
    },
    {
      name: "setPalette paints once without animating",
      act: ({ sm }) => {
        sm.setPalette(PALETTE);
        step(16);
        expect(harness.frames.size).toBe(0);
      },
    },
    {
      name: "the first observer callback at the same size leaves the canvas painted",
      act: () => {
        const paints = harness.paints;
        harness.resize.at(-1)!();
        expect(harness.paints).toBe(paints + 1);
      },
    },
    {
      name: "a resize while fitted refits and snaps in one paint",
      act: ({ host }) => {
        const paints = harness.paints;
        host.clientWidth = 600;
        harness.resize.at(-1)!();
        expect(harness.paints).toBe(paints + 1);
        expect(harness.frames.size).toBe(0);
      },
    },
    {
      name: "remount with a selected star and a remembered camera ends with nothing animating",
      act: (m) => {
        pan(m.canvas, 60, 0);
        settle();
        const next = remount(m, 3);
        expect(next.sm.camera().fitted).toBe(false);
      },
    },
    {
      name: "remount with fitted remembered calls fit and ends with nothing animating",
      act: (m) => {
        const next = remount(m, 3);
        expect(next.sm.camera().fitted).toBe(true);
      },
    },
    {
      name: "reduced motion on schedules no animation frames",
      act: ({ sm }) => {
        sm.setReducedMotion(true);
        settle();
        sm.select(4);
        sm.setModel(fixture({ 2: "resolved" }));
        step(16);
        expect(harness.frames.size).toBe(0);
      },
    },
    {
      name: "destroy cancels the frame and the ticker timer",
      act: ({ sm }) => {
        sm.setModel(fixture({ 1: "resolved" }));
        sm.destroy();
        expect(harness.frames.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      },
    },
  ];

  it.each(rows)("$name", ({ act }) => {
    const m = ready();
    act(m);
    expectAtRest();
  });
});
