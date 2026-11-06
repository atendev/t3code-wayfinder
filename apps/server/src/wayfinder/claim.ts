import * as DateTime from "effect/DateTime";

// Line-based ports of chartr's `stampClaim` and `stripClaim` (internal/server/claim.go). No YAML
// round-trip, so every other frontmatter line keeps its order and spelling.

const isFence = (line: string) => line.trim() === "---";

const isClaimLine = (line: string) => {
  const key = line.trim();
  return key.startsWith("claimed_by:") || key.startsWith("claimed_at:");
};

/** Removes `claimed_by` and `claimed_at` from the frontmatter only; the body is untouched. */
export const stripClaim = (source: string): string => {
  const lines = source.split("\n");
  if (!isFence(lines[0] ?? "")) return source;
  const out = [lines[0]!];
  let inFrontmatter = true;
  for (const line of lines.slice(1)) {
    if (inFrontmatter) {
      if (isFence(line)) inFrontmatter = false;
      else if (isClaimLine(line)) continue;
    }
    out.push(line);
  }
  return out.join("\n");
};

/** Replaces any existing claim with this one, just before the closing `---`. Idempotent. */
export const stampClaim = (source: string, threadId: string, claimedAt: string): string => {
  // Lines split on LF keep a CRLF fence's `\r`, so new lines match the frontmatter's ending.
  const cr =
    /^---[ \t]*\r\n/.test(source) || (!source.startsWith("---") && source.includes("\r\n"))
      ? "\r"
      : "";
  const claim = [`claimed_by: ${threadId}${cr}`, `claimed_at: ${claimedAt}${cr}`];
  const lines = stripClaim(source).split("\n");
  if (isFence(lines[0] ?? "")) {
    const close = lines.findIndex((line, index) => index > 0 && isFence(line));
    if (close !== -1) {
      return [...lines.slice(0, close), ...claim, ...lines.slice(close)].join("\n");
    }
  }
  return [`---${cr}`, ...claim, `---${cr}`, cr, source].join("\n");
};

/** UTC RFC 3339 to the second, for example `2026-11-02T14:03:00Z`. */
export const formatClaimedAt = (epochMillis: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(epochMillis)).replace(/\.\d{3}Z$/, "Z");
