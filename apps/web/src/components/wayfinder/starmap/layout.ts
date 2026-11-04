// Adapted from chartr (MIT). Copyright (c) 2026 John Goh. https://github.com/rengwu/chartr

// Layout is a pure function of ticket numbers and blocked_by edges, never status,
// so a status push can never move a star.

export const TAU = 6.2831853;

export interface LayoutNode {
  num: number;
  blockedBy?: number[];
}

export interface Point {
  x: number;
  y: number;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function rankOf(nodes: LayoutNode[]): Record<number, number> {
  const rank: Record<number, number> = {};
  for (const n of nodes) rank[n.num] = 0;
  const edges = edgesOf(nodes);
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const e of edges) {
      const from = rank[e.from];
      const to = rank[e.to];
      if (from === undefined || to === undefined) continue;
      if (to < from + 1) rank[e.to] = from + 1;
    }
  }
  return rank;
}

export interface Edge {
  from: number;
  to: number;
}

// Blocker→dependent edges; edges onto a ticket the map lacks are dropped.
export function edgesOf(nodes: LayoutNode[]): Edge[] {
  const present = new Set(nodes.map((n) => n.num));
  const edges: Edge[] = [];
  for (const n of nodes) {
    for (const b of n.blockedBy ?? []) {
      if (present.has(b)) edges.push({ from: b, to: n.num });
    }
  }
  return edges;
}

function ringR(rank: number): number {
  return 130 + rank * 165;
}

// Seeded in ascending `num` order so arrival order never changes the result.
export function computeLayout(nodes: LayoutNode[]): Record<number, Point> {
  const sorted = [...nodes].sort((a, b) => a.num - b.num);
  const rank = rankOf(sorted);
  const edges = edgesOf(sorted);
  const rankOfNum = (num: number) => rank[num] ?? 0;

  const pts: Record<number, Point> = {};
  const rnd = mulberry32(1337);
  for (const n of sorted) {
    const ang = rnd() * TAU;
    const jit = (rnd() - 0.5) * 70;
    const R = ringR(rankOfNum(n.num)) + jit;
    pts[n.num] = { x: Math.cos(ang) * R, y: Math.sin(ang) * R };
  }
  const at = (num: number): Point => pts[num]!;

  const REP = 9000,
    SPRING = 0.02,
    REST = 150,
    RADIAL = 0.05;
  for (let it = 0; it < 420; it++) {
    for (let i = 0; i < sorted.length; i++) {
      const a = at(sorted[i]!.num);
      for (let j = i + 1; j < sorted.length; j++) {
        const b = at(sorted[j]!.num);
        const dx = a.x - b.x,
          dy = a.y - b.y,
          d2 = dx * dx + dy * dy || 0.01,
          d = Math.sqrt(d2),
          f = REP / d2,
          ux = dx / d,
          uy = dy / d;
        a.x += ux * f;
        a.y += uy * f;
        b.x -= ux * f;
        b.y -= uy * f;
      }
    }
    for (const e of edges) {
      const a = at(e.from),
        b = at(e.to);
      const dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.hypot(dx, dy) || 0.01,
        f = (d - REST) * SPRING,
        ux = dx / d,
        uy = dy / d;
      a.x += ux * f;
      a.y += uy * f;
      b.x -= ux * f;
      b.y -= uy * f;
    }
    for (const n of sorted) {
      const p = at(n.num);
      const d = Math.hypot(p.x, p.y) || 0.01,
        f = (ringR(rankOfNum(n.num)) - d) * RADIAL;
      p.x += (p.x / d) * f;
      p.y += (p.y / d) * f;
    }
  }
  return pts;
}

// Ticket numbers and edges only. Layout is recomputed only when this changes.
export function structureSignature(nodes: LayoutNode[]): string {
  const nums = nodes
    .map((n) => n.num)
    .sort((a, b) => a - b)
    .join(",");
  const edges = edgesOf(nodes)
    .map((e) => `${e.from}>${e.to}`)
    .sort()
    .join(",");
  return `${nums}|${edges}`;
}
