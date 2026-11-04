// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { computeLayout, structureSignature } from "./layout";
import { GRAMMAR, nonColorSignature, type SessionState } from "./session";
import { clipTitle, StarMap, titleBudget } from "./starmap";
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
  remove() {}
}

interface Harness {
  frames: Map<number, FrameRequestCallback>;
  fills: number[];
  resize: (() => void)[];
  ctx: Record<string, unknown> | null;
  drawn: { text: string; x: number; y: number; align: string; font: string }[];
}

let harness: Harness;

function recordingContext(h: Harness): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    textAlign: "center",
    font: "",
    createRadialGradient: () => ({ addColorStop: () => {} }),
    measureText: (s: string) => ({ width: s.length * 6 }),
    fillRect: () => h.fills.push(h.fills.length),
    fillText(this: Record<string, unknown>, text: string, x: number, y: number) {
      h.drawn.push({ text, x, y, align: this.textAlign as string, font: this.font as string });
    },
  };
  for (const m of [
    "setTransform",
    "beginPath",
    "arc",
    "fill",
    "stroke",
    "moveTo",
    "lineTo",
    "closePath",
    "quadraticCurveTo",
    "setLineDash",
    "save",
    "restore",
    "translate",
    "scale",
  ]) {
    ctx[m] = () => {};
  }
  return ctx;
}

function setup(options: { live: boolean }): Harness {
  let nextFrame = 0;
  const h: Harness = { frames: new Map(), fills: [], resize: [], ctx: null, drawn: [] };
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
  return { sm, host, canvas: host.canvas! };
}

function mouse(type: string, init: Record<string, number>): Event {
  return Object.assign(new Event(type), { clientX: 0, clientY: 0, buttons: 1, ...init });
}

function pan(canvas: FakeCanvas, dx: number, dy: number): void {
  canvas.dispatchEvent(mouse("mousedown", {}));
  window.dispatchEvent(mouse("mousemove", { clientX: dx, clientY: dy }));
  window.dispatchEvent(mouse("mouseup", { clientX: dx, clientY: dy, buttons: 0 }));
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
  beforeEach(() => {
    setup({ live: false });
    sm = mounted().sm;
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

  it("emits selection on the click path only, and deselection on empty space", () => {
    sm.setModel(fixture());
    const emitted: (number | null)[] = [];
    sm.onSelect((n) => emitted.push(n));

    sm.select(2);
    expect(emitted).toEqual([]);

    const p = sm.screenOf(3)!;
    expect(sm.selectAtScreen(p.x, p.y)).toBe(3);
    expect(sm.selectAtScreen(-9999, -9999)).toBe(null);
    expect(emitted).toEqual([3, null]);
  });

  it("seats a selected star in the free rect the pane leaves, in either docking", () => {
    sm.setModel(fixture());
    sm.setInsets({ top: 16, right: 400, bottom: 16, left: 16 });
    sm.select(3);
    expect(sm.screenOf(3)!.x).toBeLessThan(1000 - 400);
    sm.setInsets({ top: 16, right: 16, bottom: 300, left: 16 });
    const bottom = sm.screenOf(3)!;
    expect(bottom.y).toBeLessThan(700 - 300);
    expect(bottom.x).toBeGreaterThan(400);
  });

  it("drops a stale selection when its ticket leaves the map", () => {
    sm.setModel(fixture());
    sm.select(5);
    sm.setModel(fixture().filter((t) => t.num !== 5));
    sm.select(5);
    expect(sm.screenOf(5)).toBe(null);
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

  it("keeps the pose when the pane closes, and still clears room when one opens", () => {
    const { sm, canvas } = mounted();
    sm.setModel(fixture());
    sm.setInsets({ top: 52, right: 420, bottom: 16, left: 16 });
    sm.select(3);
    pan(canvas, 120, 80);
    const pose = sm.camera();

    sm.setInsets({ top: 52, right: 420, bottom: 16, left: 16 });
    expect(sm.camera()).toEqual(pose);

    sm.select(null);
    sm.setInsets({ top: 52, right: 16, bottom: 16, left: 16 });
    expect(sm.camera()).toEqual(pose);
    sm.setInsets({ top: 52, right: 420, bottom: 16, left: 16 });
    expect(sm.camera()).not.toEqual(pose);
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
      sessions: { 3: "implementing" },
    },
    { tickets: beat({ 1: "resolved", 2: "resolved", 3: "claimed" }), sessions: { 3: "dead" } },
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

  it("gives every session state a shape and spends at most two hues", () => {
    const all: SessionState[] = ["implementing", "blocked", "dead"];
    for (const s of all) expect(nonColorSignature(s)).toBeTruthy();
    expect(new Set(all.map((s) => GRAMMAR[s].hue)).size).toBeLessThanOrEqual(2);
  });
});

describe("rationing the title as the camera pulls back", () => {
  it("ramps the budget with scale, and clamps at both ends", () => {
    const wide = titleBudget(2);
    const tight = titleBudget(0.42);
    expect(tight).toBeLessThan(wide);
    let prev = 0;
    for (let s = 0.42; s <= 1.2; s += 0.02) {
      expect(titleBudget(s)).toBeGreaterThanOrEqual(prev);
      prev = titleBudget(s);
    }
    expect(titleBudget(10)).toBe(wide);
    expect(titleBudget(0.1)).toBe(tight);
  });

  it("clips on a word boundary when one is near the cut", () => {
    expect(clipTitle("The agent adapter contract", 12)).toBe("The agent…");
    expect(clipTitle("Supercalifragilistic", 12)).toBe("Supercalifra…");
    expect(clipTitle("Short one", 12)).toBe("Short one");
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
    title: `A dependent with a fairly long title ${i + 2}`,
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

  function boxes() {
    const labels = harness.drawn.filter((d) => !d.text.startsWith("▸"));
    const fs = parseFloat(labels[0]?.font ?? "11");
    return labels.map((d) => {
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

  it("never draws two labels across each other", () => {
    const { sm } = mounted();
    sm.setModel(CROWDED);
    harness.drawn.length = 0;
    step(16);
    const placed = boxes();
    expect(placed.length).toBeGreaterThan(0);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i]!, placed[j]!)).toBe(false);
      }
    }
  });

  it("keeps the selected star labelled when the map is crowded", () => {
    const { sm, canvas } = mounted();
    sm.setModel(CROWDED);
    const at = sm.screenOf(7)!;
    canvas.dispatchEvent(mouse("mousedown", { clientX: at.x, clientY: at.y }));
    window.dispatchEvent(mouse("mouseup", { clientX: at.x, clientY: at.y, buttons: 0 }));
    harness.drawn.length = 0;
    step(16);
    expect(harness.drawn.some((d) => d.text.startsWith("07"))).toBe(true);
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
    canvas.dispatchEvent(mouse("mousedown", {}));
    window.dispatchEvent(mouse("mousemove", { clientX: 300 }));
    step(16);
    const trailing = sm.screenOf(1)!.x - start;
    expect(trailing).toBeGreaterThan(0);
    expect(trailing).toBeLessThan(300);
    window.dispatchEvent(mouse("mouseup", { clientX: 300, buttons: 0 }));
    settle();
    expect(sm.screenOf(1)!.x - start).toBeCloseTo(300, 6);
  });
});

// Ticket 12's proof of stop: every trigger ends with an empty frame queue and no timers.
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
      },
    },
    { name: "drag", act: ({ canvas }) => pan(canvas, 80, 40) },
    {
      name: "a lost mouse-up ends the drag on the next buttonless move",
      act: ({ sm, canvas }) => {
        canvas.dispatchEvent(mouse("mousedown", {}));
        window.dispatchEvent(mouse("mousemove", { clientX: 50 }));
        window.dispatchEvent(mouse("mousemove", { clientX: 90, buttons: 0 }));
        settle();
        const pose = sm.camera();
        window.dispatchEvent(mouse("mousemove", { clientX: 200, buttons: 1 }));
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
      name: "setBackground paints once without animating",
      act: ({ sm }) => {
        sm.setBackground("#111111");
        step(16);
        expect(harness.frames.size).toBe(0);
      },
    },
    { name: "setInsets", act: ({ sm }) => sm.setInsets({ right: 300 }) },
    {
      name: "the first observer callback at the same size leaves the canvas painted",
      act: () => {
        const fills = harness.fills.length;
        harness.resize.at(-1)!();
        expect(harness.fills.length).toBeGreaterThan(fills);
      },
    },
    {
      name: "resize and setInsets in the same frame give one settled paint",
      act: ({ sm, host }) => {
        host.clientWidth = 600;
        harness.resize.at(-1)!();
        sm.setInsets({ right: 200 });
        expect(harness.frames.size).toBe(1);
      },
    },
    {
      name: "remount with a selection and a remembered camera ends with nothing animating",
      act: ({ sm }) => {
        const pose = sm.camera();
        sm.destroy();
        const next = mounted();
        next.sm.setModel(fixture());
        next.sm.select(3);
        next.sm.restoreCamera(pose);
        step(16);
        expect(harness.frames.size).toBe(0);
      },
    },
    {
      name: "reduced motion snaps a select and flares nothing",
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
