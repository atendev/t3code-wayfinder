import type { WayfinderProblemReason } from "@t3tools/contracts";

export const PROBLEM_REASON_COPY: Record<WayfinderProblemReason, string> = {
  unreadable: "Can't be read",
  "invalid-filename": "File name has no ticket number",
  "missing-frontmatter": "No frontmatter",
  "invalid-frontmatter": "Frontmatter has an invalid value",
  "invalid-type": "Type isn't grilling, research, prototype, or task",
  "missing-question": "No Question section",
  "missing-done-when": "No Done when section",
  "both-closing-headings": "Has both an Answer and a Ruled out section",
  "duplicate-number": "Another ticket already uses this number",
  "missing-title": "map.md has no title",
  "missing-destination": "map.md has no Destination section",
};

// The client never learns the host's home directory, so this matches the usual home prefixes.
const HOME_PREFIX = /^(?:\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[/\\])/i;

/** Shows a host path with a conventional home-directory prefix as `~`. */
export function tildeRoot(root: string): string {
  return root.replace(HOME_PREFIX, "~");
}
