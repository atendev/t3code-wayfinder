import { describe, expect, it } from "vite-plus/test";

import { canvasSummary, tildeRoot } from "./wayfinderCopy";

describe("tildeRoot", () => {
  it.each([
    ["/home/ana/code/t3", "~/code/t3"],
    ["/home/ana", "~"],
    ["/Users/ana/code", "~/code"],
    ["C:\\Users\\ana\\code", "~\\code"],
    ["d:\\users\\ana", "~"],
    ["/home/ana-old/code", "~/code"],
    ["/homes/ana/code", "/homes/ana/code"],
    ["/srv/repo", "/srv/repo"],
    ["/home", "/home"],
  ])("%s shows as %s", (root, expected) => {
    expect(tildeRoot(root)).toBe(expected);
  });
});

describe("canvasSummary", () => {
  it.each([
    [14, 3, {}, "Impl, 14 tickets, 3 on the frontier"],
    [1, 0, {}, "Impl, 1 ticket, 0 on the frontier"],
    [
      14,
      3,
      { 3: "needs_user", 5: "unattended" },
      "Impl, 14 tickets, 3 on the frontier, 1 needs you, 1 unattended",
    ],
    [14, 3, { 3: "working", 5: "working" }, "Impl, 14 tickets, 3 on the frontier, 2 working"],
  ] as const)(
    "%i tickets, %i on the frontier, sessions %o",
    (tickets, frontier, sessions, expected) => {
      expect(canvasSummary("Impl", tickets, frontier, sessions)).toBe(expected);
    },
  );
});
