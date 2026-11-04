import type {
  WayfinderMapSummary,
  WayfinderProblem,
  WayfinderProblemReason,
  WayfinderSection,
  WayfinderTicketStatus,
  WayfinderTicketSummary,
  WayfinderTicketType,
} from "@t3tools/contracts";
import { parse as parseYaml } from "yaml";

export interface WayfinderFile {
  readonly name: string;
  /** `null` when the file could not be read. */
  readonly text: string | null;
  readonly fingerprint: string;
}

export interface ParsedDocument {
  readonly title: string | null;
  readonly sections: ReadonlyArray<WayfinderSection>;
}

const TICKET_FILENAME = /^(\d+)(?:-(.+))?\.md$/;
const FRONTMATTER =
  /^﻿?---[ \t]*(?:\r\n|\r|\n)((?:[\s\S]*?(?:\r\n|\r|\n))?)(?:---|\.\.\.)[ \t]*(?:\r\n|\r|\n|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TICKET_TYPES: ReadonlySet<string> = new Set<WayfinderTicketType>([
  "grilling",
  "research",
  "prototype",
  "task",
]);
const FRONTMATTER_PROBLEMS: ReadonlySet<WayfinderProblemReason> = new Set([
  "missing-frontmatter",
  "invalid-frontmatter",
  "invalid-type",
]);

export const mapsRelativePath = (...segments: ReadonlyArray<string>) =>
  [".plan", "maps", ...segments].join("/");

const ticketFileNumber = (name: string): number | null => {
  const match = TICKET_FILENAME.exec(name);
  return match === null ? null : Number.parseInt(match[1]!, 10);
};

export const ticketFileSlug = (name: string) =>
  TICKET_FILENAME.exec(name)?.[2] ?? name.replace(/\.md$/, "");

/** The first file in filename order owns each number; later ones are duplicates. */
export const ticketFileOwners = (names: ReadonlyArray<string>) => {
  const owners = new Map<number, string>();
  const duplicates: Array<string> = [];
  const invalid: Array<string> = [];
  for (const name of names.filter((entry) => entry.endsWith(".md")).toSorted()) {
    const number = ticketFileNumber(name);
    if (number === null) invalid.push(name);
    else if (owners.has(number)) duplicates.push(name);
    else owners.set(number, name);
  }
  return { owners, duplicates, invalid };
};

const stripFrontmatter = (text: string) => {
  const match = FRONTMATTER.exec(text);
  return match === null
    ? { block: null, body: text.replace(/^﻿/, "") }
    : { block: match[1] ?? "", body: text.slice(match[0].length) };
};

const trimBlankLines = (lines: ReadonlyArray<string>) => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") start += 1;
  while (end > start && lines[end - 1]!.trim() === "") end -= 1;
  return lines.slice(start, end).join("\n");
};

export const parseDocument = (text: string): ParsedDocument => {
  const { body } = stripFrontmatter(text);
  let title: string | null = null;
  let fence: string | null = null;
  const sections: Array<{ heading: string; lines: Array<string> }> = [];
  for (const line of body.split(/\r\n|\r|\n/)) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]!;
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (fence === null) {
      const h2 = /^## +(.*?)[ \t#]*$/.exec(line);
      if (h2 !== null) {
        sections.push({ heading: h2[1]!.trim(), lines: [] });
        continue;
      }
      const h1 = /^# +(.*?)[ \t#]*$/.exec(line);
      if (h1 !== null && title === null && sections.length === 0) {
        title = h1[1]!.trim() || null;
        continue;
      }
    }
    sections.at(-1)?.lines.push(line);
  }
  return {
    title,
    sections: sections.map(({ heading, lines }) => ({ heading, markdown: trimBlankLines(lines) })),
  };
};

const sectionBody = (document: ParsedDocument, heading: string) =>
  document.sections.find((section) => section.heading.toLowerCase() === heading.toLowerCase());

const hasContent = (document: ParsedDocument, heading: string) =>
  (sectionBody(document, heading)?.markdown.trim() ?? "") !== "";

const parseNumberList = (value: unknown): ReadonlyArray<number> | null => {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) return null;
  const numbers: Array<number> = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !/^\d+$/.test(entry.trim())) return null;
    numbers.push(Number.parseInt(entry, 10));
  }
  return numbers;
};

const parseStringList = (value: unknown): ReadonlyArray<string> | null => {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return null;
  return value;
};

const rawString = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);

interface Frontmatter {
  readonly type: WayfinderTicketType | null;
  readonly blockedBy: ReadonlyArray<number>;
  readonly underminedBy: ReadonlyArray<number>;
  readonly assets: ReadonlyArray<string>;
  readonly claimedBy: string | null;
  readonly claimedAt: string | null;
  readonly problems: ReadonlyArray<WayfinderProblemReason>;
}

const EMPTY_FRONTMATTER = {
  type: null,
  blockedBy: [],
  underminedBy: [],
  assets: [],
  claimedBy: null,
  claimedAt: null,
} as const;

/** Keys validate one at a time: a failing key takes its default and the others keep their values. */
const parseFrontmatter = (block: string | null): Frontmatter => {
  if (block === null) return { ...EMPTY_FRONTMATTER, problems: ["missing-frontmatter"] };
  let parsed: unknown;
  try {
    // The failsafe schema keeps every scalar as its raw text.
    parsed = parseYaml(block, { schema: "failsafe" }) ?? {};
  } catch {
    return { ...EMPTY_FRONTMATTER, problems: ["invalid-frontmatter"] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ...EMPTY_FRONTMATTER, problems: ["invalid-frontmatter"] };
  }
  const fields = parsed as Record<string, unknown>;
  const problems = new Set<WayfinderProblemReason>();

  const rawType = rawString(fields.type);
  const type =
    rawType !== null && TICKET_TYPES.has(rawType) ? (rawType as WayfinderTicketType) : null;
  if (fields.type !== undefined && fields.type !== "" && type === null)
    problems.add("invalid-type");

  const blockedBy = parseNumberList(fields.blocked_by);
  const underminedBy = parseNumberList(fields.undermined_by);
  const assets = parseStringList(fields.assets);
  if (blockedBy === null || underminedBy === null || assets === null) {
    problems.add("invalid-frontmatter");
  }

  return {
    type,
    blockedBy: blockedBy ?? [],
    underminedBy: underminedBy ?? [],
    assets: assets ?? [],
    claimedBy: rawString(fields.claimed_by),
    claimedAt: rawString(fields.claimed_at),
    problems: [...problems],
  };
};

const ticketStatus = (
  document: ParsedDocument,
  claimedBy: string | null,
): WayfinderTicketStatus => {
  if (hasContent(document, "Answer")) return "resolved";
  if (hasContent(document, "Ruled out")) return "out_of_scope";
  if (claimedBy !== null) return "claimed";
  return "open";
};

const parseTicket = (input: {
  readonly mapSlug: string;
  readonly number: number;
  readonly file: WayfinderFile & { readonly text: string };
}): WayfinderTicketSummary => {
  const { file } = input;
  const slug = ticketFileSlug(file.name);
  const path = mapsRelativePath(input.mapSlug, "tickets", file.name);
  const { block } = stripFrontmatter(file.text);
  const frontmatter = parseFrontmatter(block);
  const document = parseDocument(file.text);
  const reasons: Array<WayfinderProblemReason> = [...frontmatter.problems];
  if (sectionBody(document, "Question") === undefined) reasons.push("missing-question");
  if (sectionBody(document, "Done when") === undefined) reasons.push("missing-done-when");
  if (hasContent(document, "Answer") && hasContent(document, "Ruled out")) {
    reasons.push("both-closing-headings");
  }
  return {
    number: input.number,
    slug,
    title: document.title ?? slug,
    type: frontmatter.type,
    status: ticketStatus(document, frontmatter.claimedBy),
    // Derived across the map by `withFrontier`.
    frontier: false,
    blockedBy: frontmatter.blockedBy,
    underminedBy: frontmatter.underminedBy,
    assets: frontmatter.assets,
    claimedBy: frontmatter.claimedBy,
    claimedAt: frontmatter.claimedAt,
    fingerprint: file.fingerprint,
    problems: reasons.map((reason) => ({ path, reason })),
  };
};

/** Sets each ticket's `frontier` and returns the map's ordered frontier. */
const withFrontier = (tickets: ReadonlyArray<WayfinderTicketSummary>) => {
  const statusByNumber = new Map(tickets.map((ticket) => [ticket.number, ticket.status]));
  const derived = tickets
    .map((ticket) => ({
      ...ticket,
      frontier:
        ticket.status === "open" &&
        ticket.blockedBy.every((blocker) => statusByNumber.get(blocker) === "resolved") &&
        !ticket.problems.some((problem) => FRONTMATTER_PROBLEMS.has(problem.reason)),
    }))
    .toSorted((left, right) => left.number - right.number);
  return {
    tickets: derived,
    frontier: derived.filter((ticket) => ticket.frontier).map((ticket) => ticket.number),
  };
};

export const parseMap = (input: {
  readonly slug: string;
  readonly mapFile: WayfinderFile & { readonly text: string };
  readonly ticketFiles: ReadonlyArray<WayfinderFile>;
}): WayfinderMapSummary => {
  const document = parseDocument(input.mapFile.text);
  const mapPath = mapsRelativePath(input.slug, "map.md");
  const ticketPath = (name: string) => mapsRelativePath(input.slug, "tickets", name);
  const problems: Array<WayfinderProblem> = [];
  if (document.title === null) problems.push({ path: mapPath, reason: "missing-title" });
  if (sectionBody(document, "Destination") === undefined) {
    problems.push({ path: mapPath, reason: "missing-destination" });
  }

  const filesByName = new Map(input.ticketFiles.map((file) => [file.name, file]));
  const { owners, duplicates, invalid } = ticketFileOwners([...filesByName.keys()]);
  const parsed: Array<WayfinderTicketSummary> = [];
  for (const [number, name] of owners) {
    const file = filesByName.get(name)!;
    if (file.text === null) {
      problems.push({ path: ticketPath(name), reason: "unreadable" });
      continue;
    }
    parsed.push(parseTicket({ mapSlug: input.slug, number, file: { ...file, text: file.text } }));
  }
  for (const name of invalid) problems.push({ path: ticketPath(name), reason: "invalid-filename" });
  for (const name of duplicates) {
    problems.push({ path: ticketPath(name), reason: "duplicate-number" });
  }

  const { tickets, frontier } = withFrontier(parsed);
  return {
    slug: input.slug,
    title: document.title ?? input.slug,
    fingerprint: input.mapFile.fingerprint,
    tickets,
    frontier,
    problems: problems.toSorted((left, right) =>
      left.path === right.path ? 0 : left.path < right.path ? -1 : 1,
    ),
  };
};

export interface RootSnapshot {
  readonly root: string;
  readonly maps: ReadonlyArray<WayfinderMapSummary>;
  readonly problems: ReadonlyArray<WayfinderProblem>;
}

const reasonsOf = (problems: ReadonlyArray<WayfinderProblem>) =>
  new Set(problems.map((problem) => problem.reason));

/**
 * Mid-write guard: a ticket that gains a problem, or vanishes beside a new unreadable file, keeps
 * its previous summary. `held` reports whether anything was kept, so the caller re-reads later.
 */
export const holdMidWrite = (previous: RootSnapshot, next: RootSnapshot) => {
  let held = false;
  const maps = next.maps.map((map) => {
    const before = previous.maps.find((candidate) => candidate.slug === map.slug);
    if (before === undefined) return map;
    let mapHeld = false;
    const tickets = map.tickets.map((ticket) => {
      const prior = before.tickets.find((candidate) => candidate.number === ticket.number);
      if (prior === undefined) return ticket;
      const priorReasons = reasonsOf(prior.problems);
      if (!ticket.problems.some((problem) => !priorReasons.has(problem.reason))) return ticket;
      mapHeld = true;
      return prior;
    });
    const priorUnreadable = new Set(
      before.problems.filter((problem) => problem.reason === "unreadable").map((p) => p.path),
    );
    const newlyUnreadable = map.problems.some(
      (problem) => problem.reason === "unreadable" && !priorUnreadable.has(problem.path),
    );
    if (newlyUnreadable) {
      for (const prior of before.tickets) {
        if (tickets.some((ticket) => ticket.number === prior.number)) continue;
        tickets.push(prior);
        mapHeld = true;
      }
    }
    if (!mapHeld) return map;
    held = true;
    return { ...map, ...withFrontier(tickets) };
  });
  return { snapshot: held ? { ...next, maps } : next, held };
};
