import { describe, expect, it } from "vite-plus/test";

import { tildeRoot } from "./wayfinderCopy";

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
