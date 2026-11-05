import { describe, expect, it } from "vite-plus/test";

import { formatClaimedAt, stampClaim, stripClaim } from "./claim.ts";

const AT = "2026-11-02T14:03:00Z";

describe("stampClaim and stripClaim", () => {
  it.each([
    [
      "puts the claim keys just before the closing fence",
      "---\ntype: task\nblocked_by: [03]\n---\n# Title\n",
      "---\ntype: task\nblocked_by: [03]\nclaimed_by: thread-1\nclaimed_at: 2026-11-02T14:03:00Z\n---\n# Title\n",
    ],
    [
      "replaces a stale claim without doubling the keys",
      "---\nclaimed_by: old\ntype: task\nclaimed_at: 2026-01-01T00:00:00Z\nassets: []\n---\nBody\n",
      "---\ntype: task\nassets: []\nclaimed_by: thread-1\nclaimed_at: 2026-11-02T14:03:00Z\n---\nBody\n",
    ],
    [
      "prepends a block to a ticket with no frontmatter",
      "# Title\n",
      "---\nclaimed_by: thread-1\nclaimed_at: 2026-11-02T14:03:00Z\n---\n\n# Title\n",
    ],
    [
      "keeps a CRLF file's line endings",
      "---\r\ntype: task\r\n---\r\n# Title\r\n",
      "---\r\ntype: task\r\nclaimed_by: thread-1\r\nclaimed_at: 2026-11-02T14:03:00Z\r\n---\r\n# Title\r\n",
    ],
    [
      "follows the frontmatter's LF when the body has CRLF",
      "---\ntype: task\n---\r\nBody\r\n",
      "---\ntype: task\nclaimed_by: thread-1\nclaimed_at: 2026-11-02T14:03:00Z\n---\r\nBody\r\n",
    ],
  ])("%s", (_name, source, stamped) => {
    expect(stampClaim(source, "thread-1", AT)).toBe(stamped);
    expect(stampClaim(stamped, "thread-1", AT)).toBe(stamped);
  });

  it.each([
    [
      "keeps every other line in order and spelling",
      "---\ntype: task\nblocked_by: [03]\nclaimed_by: thread-1\nclaimed_at: x\nundermined_by: []\n---\n# T\n",
      "---\ntype: task\nblocked_by: [03]\nundermined_by: []\n---\n# T\n",
    ],
    [
      "leaves a claim-like line in the body alone",
      "---\ntype: task\n---\nclaimed_by: body text\n",
      "---\ntype: task\n---\nclaimed_by: body text\n",
    ],
    ["leaves a file with no frontmatter alone", "claimed_by: x\n", "claimed_by: x\n"],
  ])("strip %s", (_name, source, stripped) => {
    expect(stripClaim(source)).toBe(stripped);
  });

  it("formats the claim time as UTC RFC 3339 to the second", () => {
    expect(formatClaimedAt(Date.parse("2026-11-02T14:03:00.789Z"))).toBe(AT);
  });
});
