import type { WayfinderProblemReason } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { holdMidWrite, parseDocument, parseMap, type WayfinderFile } from "./parse.ts";

const MAP = "# Panel\n\n## Destination\n\nShip it.\n";

const ticket = (options: {
  readonly frontmatter?: string | null;
  readonly title?: string | null;
  readonly sections?: Readonly<Record<string, string>>;
}) => {
  const frontmatter =
    options.frontmatter === null ? "" : `---\n${options.frontmatter ?? "type: task"}\n---\n\n`;
  const title = options.title === null ? "" : `# ${options.title ?? "A ticket"}\n\n`;
  const sections = options.sections ?? { Question: "Why?", "Done when": "Tests pass." };
  return (
    frontmatter +
    title +
    Object.entries(sections)
      .map(([heading, body]) => `## ${heading}\n\n${body}\n`)
      .join("\n")
  );
};

const file = (name: string, text: string | null): WayfinderFile => ({
  name,
  text,
  fingerprint: `fp:${name}`,
});

const map = (ticketFiles: ReadonlyArray<WayfinderFile>, mapText = MAP) =>
  parseMap({
    slug: "panel",
    mapFile: { name: "map.md", text: mapText, fingerprint: "fp:map" },
    ticketFiles,
  });

const reasonsOf = (problems: ReadonlyArray<{ readonly reason: WayfinderProblemReason }>) =>
  problems.map((problem) => problem.reason);

describe("parseMap", () => {
  it.each<{
    readonly name: string;
    readonly text: string;
    readonly reasons: ReadonlyArray<WayfinderProblemReason>;
  }>([
    { name: "clean", text: ticket({}), reasons: [] },
    {
      name: "missing-frontmatter",
      text: ticket({ frontmatter: null }),
      reasons: ["missing-frontmatter"],
    },
    {
      name: "unparsable yaml",
      text: ticket({ frontmatter: "type: [task" }),
      reasons: ["invalid-frontmatter"],
    },
    {
      name: "non-object yaml",
      text: ticket({ frontmatter: "- task" }),
      reasons: ["invalid-frontmatter"],
    },
    {
      name: "invalid-type",
      text: ticket({ frontmatter: "type: chore" }),
      reasons: ["invalid-type"],
    },
    {
      name: "missing-question",
      text: ticket({ sections: { "Done when": "x" } }),
      reasons: ["missing-question"],
    },
    {
      name: "missing-done-when",
      text: ticket({ sections: { Question: "x" } }),
      reasons: ["missing-done-when"],
    },
    {
      name: "both-closing-headings",
      text: ticket({
        sections: { Question: "x", "Done when": "y", Answer: "a", "Ruled out": "r" },
      }),
      reasons: ["both-closing-headings"],
    },
  ])("attaches ticket problems: $name", ({ text, reasons }) => {
    const [summary] = map([file("01-one.md", text)]).tickets;
    expect(reasonsOf(summary!.problems)).toEqual(reasons);
    expect(
      summary!.problems.every((problem) => problem.path === ".plan/maps/panel/tickets/01-one.md"),
    ).toBe(true);
  });

  it.each<{
    readonly name: string;
    readonly sections: Readonly<Record<string, string>>;
    readonly frontmatter?: string;
    readonly status: string;
  }>([
    { name: "open", sections: { Question: "q", "Done when": "d" }, status: "open" },
    {
      name: "claimed",
      sections: { Question: "q", "Done when": "d" },
      frontmatter: "type: task\nclaimed_by: thread-1",
      status: "claimed",
    },
    {
      name: "empty answer stays open",
      sections: { Question: "q", "Done when": "d", Answer: "" },
      status: "open",
    },
    {
      name: "resolved",
      sections: { Question: "q", "Done when": "d", Answer: "yes" },
      status: "resolved",
    },
    {
      name: "resolved wins over ruled out",
      sections: { Question: "q", "Done when": "d", Answer: "yes", "Ruled out": "no" },
      status: "resolved",
    },
    {
      name: "out of scope",
      sections: { Question: "q", "Done when": "d", "Ruled out": "no" },
      status: "out_of_scope",
    },
    {
      name: "answer beats a claim",
      sections: { Question: "q", "Done when": "d", Answer: "yes" },
      frontmatter: "type: task\nclaimed_by: thread-1",
      status: "resolved",
    },
  ])("derives status: $name", ({ sections, frontmatter, status }) => {
    const [summary] = map([
      file("01-one.md", ticket({ sections, ...(frontmatter ? { frontmatter } : {}) })),
    ]).tickets;
    expect(summary!.status).toBe(status);
  });

  it.each<{ readonly name: string; readonly frontmatter: string; readonly expected: object }>([
    {
      name: "all keys",
      frontmatter:
        "type: research\nblocked_by: [01, 2]\nundermined_by: [3]\nassets: [a.md]\nclaimed_by: abc\nclaimed_at: 2026-11-04T00:00:00Z\nstatus: resolved\nextra: 1",
      expected: {
        type: "research",
        blockedBy: [1, 2],
        underminedBy: [3],
        assets: ["a.md"],
        claimedBy: "abc",
        claimedAt: "2026-11-04T00:00:00Z",
        status: "claimed",
      },
    },
    {
      name: "bad blocked_by keeps the other keys",
      frontmatter: "type: task\nblocked_by: soon\nassets: [a.md]\nclaimed_by: abc",
      expected: { type: "task", blockedBy: [], assets: ["a.md"], claimedBy: "abc" },
    },
    {
      name: "bad assets keeps the other keys",
      frontmatter: "type: task\nblocked_by: [2]\nassets: {a: b}",
      expected: { type: "task", blockedBy: [2], assets: [] },
    },
    {
      name: "bad type defaults to null",
      frontmatter: "type: [task]\nblocked_by: [2]",
      expected: { type: null, blockedBy: [2] },
    },
    {
      name: "missing keys default",
      frontmatter: "",
      expected: {
        type: null,
        blockedBy: [],
        underminedBy: [],
        assets: [],
        claimedBy: null,
        claimedAt: null,
      },
    },
    {
      name: "raw claim strings",
      frontmatter: "type: task\nclaimed_by: 12\nclaimed_at: not a date",
      expected: { claimedBy: "12", claimedAt: "not a date" },
    },
  ])("defaults frontmatter per key: $name", ({ frontmatter, expected }) => {
    const [summary] = map([file("01-one.md", ticket({ frontmatter }))]).tickets;
    expect(summary).toMatchObject(expected);
  });

  it("falls back to the filename slug and folder slug for missing titles", () => {
    const summary = map(
      [file("07-start-thread.md", ticket({ title: null }))],
      "## Destination\n\nx\n",
    );
    expect(summary.title).toBe("panel");
    expect(reasonsOf(summary.problems)).toEqual(["missing-title"]);
    expect(summary.tickets[0]).toMatchObject({
      number: 7,
      slug: "start-thread",
      title: "start-thread",
    });
  });

  it("reports a map without a destination", () => {
    expect(reasonsOf(map([], "# Panel\n\n## Notes\n").problems)).toEqual(["missing-destination"]);
  });

  it("gives a duplicate number, including 1 versus 01, to the first file in filename order", () => {
    const summary = map([
      file("1-late.md", ticket({ title: "Late" })),
      file("01-early.md", ticket({ title: "Early" })),
      file("02-blocked.md", ticket({ frontmatter: "type: task\nblocked_by: [1]" })),
    ]);
    expect(summary.tickets.map((entry) => [entry.number, entry.title])).toEqual([
      [1, "Early"],
      [2, "A ticket"],
    ]);
    expect(summary.problems).toEqual([
      { path: ".plan/maps/panel/tickets/1-late.md", reason: "duplicate-number" },
    ]);
  });

  it("drops unreadable and unnumbered files into map problems", () => {
    const summary = map([
      file("01-one.md", null),
      file("notes.md", ticket({})),
      file(".gitkeep", ""),
    ]);
    expect(summary.tickets).toEqual([]);
    expect(summary.problems).toEqual([
      { path: ".plan/maps/panel/tickets/01-one.md", reason: "unreadable" },
      { path: ".plan/maps/panel/tickets/notes.md", reason: "invalid-filename" },
    ]);
  });

  it.each<{
    readonly name: string;
    readonly second: string;
    readonly frontier: ReadonlyArray<number>;
  }>([
    { name: "blocker resolved", second: "type: task\nblocked_by: [1]", frontier: [2, 3] },
    { name: "blocker missing", second: "type: task\nblocked_by: [9]", frontier: [3] },
    { name: "blocker open", second: "type: task\nblocked_by: [3]", frontier: [3] },
    { name: "claimed", second: "type: task\nclaimed_by: someone", frontier: [3] },
    { name: "missing-frontmatter", second: "", frontier: [3] },
    { name: "invalid-frontmatter", second: "type: task\nblocked_by: nope", frontier: [3] },
    { name: "invalid-type", second: "type: chore", frontier: [3] },
  ])("derives the frontier: $name", ({ second, frontier }) => {
    const summary = map([
      file("01-done.md", ticket({ sections: { Question: "q", "Done when": "d", Answer: "a" } })),
      file(
        "02-second.md",
        second === "" ? ticket({ frontmatter: null }) : ticket({ frontmatter: second }),
      ),
      file("03-third.md", ticket({ sections: { Question: "q" } })),
    ]);
    expect(summary.frontier).toEqual(frontier);
    expect(summary.tickets.filter((entry) => entry.frontier).map((entry) => entry.number)).toEqual(
      frontier,
    );
  });
});

describe("parseDocument", () => {
  it("splits H2 sections in file order and ignores headings inside fences", () => {
    expect(
      parseDocument(
        "---\ntype: task\n---\n# Title\n\nintro\n\n## Question\n\nWhy?\n\n```md\n## Not a heading\n```\n\n## Done when\n\n- one\n",
      ),
    ).toEqual({
      title: "Title",
      sections: [
        { heading: "Question", markdown: "Why?\n\n```md\n## Not a heading\n```" },
        { heading: "Done when", markdown: "- one" },
      ],
    });
  });
});

describe("holdMidWrite", () => {
  const snapshot = (tickets: ReadonlyArray<WayfinderFile>) => ({
    root: "/repo",
    maps: [map(tickets)],
    problems: [],
  });

  it("keeps a ticket's previous summary when it gains a problem", () => {
    const previous = snapshot([file("01-one.md", ticket({}))]);
    const next = snapshot([file("01-one.md", "")]);
    expect(holdMidWrite(previous, next)).toEqual({ snapshot: previous, held: true });
  });

  it("keeps a ticket that vanished beside a new unreadable file", () => {
    const previous = snapshot([file("01-one.md", ticket({}))]);
    const next = snapshot([file("01-one.md", null)]);
    const result = holdMidWrite(previous, next);
    expect(result.held).toBe(true);
    expect(result.snapshot.maps[0]!.tickets).toEqual(previous.maps[0]!.tickets);
  });

  it("passes through changes that add no problem", () => {
    const previous = snapshot([file("01-one.md", ticket({}))]);
    const next = snapshot([file("01-one.md", ticket({ title: "Renamed" }))]);
    expect(holdMidWrite(previous, next)).toEqual({ snapshot: next, held: false });
  });
});
