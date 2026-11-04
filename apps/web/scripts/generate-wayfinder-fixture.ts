// Prototype stand-in for the WayfinderMaps service (ticket 03): parses one map's tickets into
// the star-map's ticket shape. Usage: node apps/web/scripts/generate-wayfinder-fixture.ts [slug]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const webRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const repoRoot = NodePath.resolve(webRoot, "../..");
const slug = process.argv[2] ?? "wayfinder-panel";
const mapDir = NodePath.join(repoRoot, ".plan/maps", slug);
const outFile = NodePath.join(webRoot, "src/components/wayfinder/fixture", `${slug}.json`);

function frontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const line of match?.[1]?.split("\n") ?? []) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv?.[1]) out[kv[1]] = (kv[2] ?? "").trim();
  }
  return out;
}

function numberList(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function sectionHasBody(text: string, heading: string): boolean {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2} /.test(line)) return false;
    if (line.trim().length > 0) return true;
  }
  return false;
}

function title(text: string, fallback: string): string {
  return /^# (.+)$/m.exec(text)?.[1]?.trim() ?? fallback;
}

const mapText = NodeFS.readFileSync(NodePath.join(mapDir, "map.md"), "utf8");
const ticketDir = NodePath.join(mapDir, "tickets");
const raw = NodeFS.readdirSync(ticketDir)
  .filter((name) => /^\d+-.+\.md$/.test(name))
  .sort()
  .map((name) => {
    const text = NodeFS.readFileSync(NodePath.join(ticketDir, name), "utf8");
    const fm = frontmatter(text);
    const status = sectionHasBody(text, "Answer")
      ? "resolved"
      : sectionHasBody(text, "Ruled out")
        ? "out_of_scope"
        : fm.claimed_by
          ? "claimed"
          : "open";
    return {
      num: Number.parseInt(name, 10),
      title: title(text, name),
      type: fm.type ?? "task",
      status,
      blockedBy: numberList(fm.blocked_by),
    };
  });

const statusByNum = new Map(raw.map((t) => [t.num, t.status]));
const tickets = raw.map((t) => ({
  ...t,
  frontier: t.status === "open" && t.blockedBy.every((num) => statusByNum.get(num) === "resolved"),
}));

const fixture = { slug, title: title(mapText, slug), tickets };
NodeFS.writeFileSync(outFile, JSON.stringify(fixture, null, 2) + "\n");
console.log(`wrote ${tickets.length} tickets to ${NodePath.relative(repoRoot, outFile)}`);
