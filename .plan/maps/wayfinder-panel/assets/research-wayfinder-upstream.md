# Local wayfinder skill vs upstream mattpocock/skills

Research for ticket 01. Compared 2026-11-02.

## Sources

| Side | File | Version |
| --- | --- | --- |
| Local skill | `/home/aten/.agents/skills/wayfinder/SKILL.md` (symlinked from `~/.claude/skills/wayfinder`) | mtime 2026-10-31, no git remote, 11877 bytes |
| Local tracker docs | `/home/aten/.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md` and `issue-tracker-github.md` (symlinked from `~/.claude/skills/setup-matt-pocock-skills`) | mtime 2026-08-20 |
| Upstream skill | `mattpocock/skills` at `skills/engineering/wayfinder/SKILL.md` | main `4ae2317d` (2026-10-31); file last changed `7739eaed` (2026-10-29) |
| Upstream tracker docs | `skills/engineering/setup-matt-pocock-skills/issue-tracker-local.md`, `issue-tracker-github.md`, `issue-tracker-gitlab.md` | local doc last changed `32165827` (2026-08-19); github doc newer |
| Upstream user doc | `docs/engineering/wayfinder.md` | main |
| chartr contract | `/home/aten/Documents/Github/chartr/internal/prompt/assets/conventions.md`, parser `internal/wayfinder/parse.go`, lint `internal/wayfinder/lint.go` | working tree |

The ticket named the path `skills/wayfinder/SKILL.md`. That path returns 404; upstream moved the skill to `skills/engineering/` in commit `639df6e7` ("Graduate wayfinder to engineering; unify changesets for v1.1", 2026-07-08). All fetches used the `engineering/` path.

## Method

`diff -u` of each local file against the upstream download, plus the upstream commit log for the skill file (`gh api repos/mattpocock/skills/commits?path=...`). The two newest skill commits, `8295b8e1` (2026-10-07) and `7739eaed` (2026-10-29), are the only ones the local copy lacks. Every earlier commit is already in the local file, so the local skill is a verbatim copy of upstream as of early October 2026.

## Skill differences (SKILL.md)

`diff -u local upstream` produced four hunks. Nothing else differs.

### 1. Frontmatter: `disable-model-invocation: true`

Upstream line 4 adds the key. Local frontmatter has only `name` and `description`.

Effect on file format: none. This is a Claude Code skill-loader flag that stops the model from invoking `/wayfinder` on its own. The upstream user doc says the same: "You invoke this by typing `/wayfinder`; the agent won't reach for it on its own."

### 2. Tickets: wayfinder labels are the only labels

Local (Tickets section):

> Each ticket carries a `wayfinder:<type>` label, one of `research`, `prototype`, `grilling`, `task` (see [Ticket Types](#ticket-types)).

Upstream appends:

> `wayfinder:` labels are the only labels a map and its tickets carry, never a triage label like `ready-for-agent`: they are decisions, not implementation work.

From commit `8295b8e1`, closing upstream #518. Effect on file format: none for local markdown. The `.plan` layout has no labels; `type:` in frontmatter is the only type carrier and triage labels do not exist there.

### 3. Chart the map, step 4: real ids in cross-references

Upstream adds to step 4:

> Write cross-references in that pass too, with real ids: a placeholder `#<n>` auto-links to an unrelated issue.

From `8295b8e1`, closing upstream #507. Effect on file format: none. In `.plan` the id is the file number `NN`, assigned at creation, so there is no placeholder window. chartr's contract already says numbers are permanent and never reused.

### 4. Chart the map, step 5: fresh context, push branch, no PR

Local:

> spin up a subagent that calls the Skill tool with "research" to resolve it in parallel, capturing its findings on a throwaway `research/<name>` branch with a context pointer from the ticket.

Upstream:

> spin up a subagent with a fresh context window that calls the Skill tool with "research" to resolve it in parallel, capturing its findings on a throwaway `research/<name>` branch with a context pointer from the ticket. Push the branch but open no PR: it is never merged.

From `8295b8e1` (no PR, closing #576) and `7739eaed` (fresh context window; some Codex models fork the parent conversation). Effect on file format: none. It does touch workflow: the `research/<name>` branch convention conflicts with the way this map runs research, which writes findings into `assets/` on the shared branch (this file). See the recommendation.

### 5. Work through the map, step 3: resolve as the labelled type

Local:

> Resolve it. **Zoom as needed**: ...

Upstream:

> Resolve it as the type its `wayfinder:<type>` label names (see [Ticket Types](#ticket-types)). Read the label, not just the body: the body never states the type. **Zoom as needed**: ...

From `8295b8e1`, closing upstream #625. Effect on file format: none. In `.plan` the type is the `type:` frontmatter key, which the body also does not restate, so the instruction maps cleanly.

### Sections with no difference

The following sections are byte-identical between local and upstream: Plan don't do, Refer by name, The Map, The map body template (Destination, Notes, Decisions so far, Not yet specified, Out of scope), the ticket body template (`## Question` only), the claiming paragraph, the blocking paragraph, Ticket Types (all four), Fog of war, Out of scope, Invocation steps 1 to 3 and 6, and Work through the map steps 1, 2, 4, 5. `agents/openai.yaml` is identical.

## Tracker doc differences

### issue-tracker-local.md

Identical. `diff` exit 0. Both say maps live at `.scratch/<effort>/map.md` with tickets at `.scratch/<effort>/issues/NN-<slug>.md`, a `Type:` line, a `Status: claimed|resolved` line, and a `Blocked by: NN, NN` line near the top.

### issue-tracker-github.md

Upstream refreshed the `gh` commands: `gh issue create --parent`, `--blocked-by`, `gh issue edit --add-sub-issue` and `--add-blocked-by` (gh 2.94+), a "Count open blockers" recipe, a two-step close (comment, then close, because `gh issue close --comment` drops the comment on an already-closed issue), and a warning never to file issues into `mattpocock/skills` from a fork. The Wayfinding operations section now points at those Conventions entries instead of inlining `gh api` calls. The claim and resolve lines are unchanged.

Effect on file format: none. Out of scope for this map (local markdown only).

## Does upstream know about chartr or `.plan/maps/<slug>/`?

No. `grep -i 'chartr\|\.plan\|claimed_by\|frontmatter\|Done when\|Ruled out\|undermined'` across the upstream skill, the three tracker docs, and the user doc finds nothing. Upstream's only local layout is `.scratch/`, and its user doc actively discourages it: "Local markdown puts the artifacts in your repo, which is not recommended, because material stored in the repo tends to persist by accident."

The relationship runs the other way. chartr's README lists `mattpocock/skills` as "the original `/wayfinder` skill and the method the maps side drives", and chartr ADR 0015 maps its four session roles one-to-one onto the skill's four ticket types.

## Conflict check: upstream conventions vs the chartr contract

The skill itself is tracker-agnostic and defers layout to the tracker doc ("Where the map, its child tickets, blocking, and frontier queries physically live is tracker-specific"). So the only format-bearing text upstream is `issue-tracker-local.md`. Compared against `conventions.md`:

| Concern | Upstream local tracker | chartr contract | Conflict |
| --- | --- | --- | --- |
| Root | `.scratch/<effort>/` | `.plan/maps/<slug>/`, "fixed and not configurable" | Yes, different root. A `.scratch` map is never discovered by chartr or by this panel. |
| Ticket folder | `issues/` | `tickets/` | Yes |
| Ticket filename | `NN-<slug>.md` from `01` | `NN-kebab-case-slug.md` from `01`, numbers permanent | Compatible |
| Type | `Type:` line in body | `type:` frontmatter key, required | Divergent, but chartr's parser accepts the loose `Type:`/`Status:`/`Blocked by:` header block as `Legacy` and lint warns "migrate Type/Blocked by into YAML frontmatter" (`parse.go` line 158 and 352, `lint.go` line 57). |
| Blocking | `Blocked by: NN, NN` line | `blocked_by: [NN, NN]` | Same as above: readable as legacy, warned by lint |
| Claim | `Status: claimed`, written by the agent | `claimed_by` and `claimed_at`, chartr-owned, "Agents must not create, edit, or remove it" | Yes. Direct conflict on who writes the claim and where. |
| Status | `Status: resolved` stored | `status` "is forbidden and ignored: status is derived" from `## Answer`, `## Ruled out`, `claimed_by` | Yes. chartr lint reports a stored status as a second copy of a body fact. |
| Resolve | append `## Answer`, set `Status: resolved`, add Decisions-so-far pointer | add non-empty `## Answer`, add Decisions-so-far bullet | Compatible on the `## Answer` heading; the stored status is the only extra |
| Out of scope close | not specified (skill says close the issue and leave a line under Out of scope) | `## Ruled out` heading, bullet under Out of scope | chartr adds a heading upstream never names; no contradiction |
| `## Done when` | absent; ticket body is `## Question` only | required | chartr requires a section upstream does not mention; a ticket written to upstream's template fails chartr's contract |
| `undermined_by`, `assets`, `<clears-with: NN>` | absent | optional | chartr additions; no contradiction |
| Map body | five sections, same names and order | five sections, same names and order, H1 title required, Decisions-so-far link form `./tickets/NN-slug.md` | Compatible. chartr fixes the link form; upstream says "link". |
| Map title | the issue title | H1 required | Compatible |

Summary: the skill body never conflicts with chartr. Upstream's local tracker doc conflicts on root path, folder name, stored status, and agent-written claims, and lacks `## Done when`. chartr tolerates the first two header-style differences as a warned legacy format; it does not tolerate the root path at all.

None of the four upstream commits since the local copy touch any of these rows. The newest upstream changes are workflow text (labels, placeholder ids, research branches, fresh context) and a loader flag.

## What this means for the panel

The panel parses `.plan/maps/<slug>/` per `conventions.md` (map decision, "Map and ticket files follow chartr's conventions"). Nothing upstream changes that format. Two upstream behaviours are worth knowing when the panel's start-thread prompt invokes `/wayfinder`:

- Upstream's resolve step says "post the answer as a resolution comment, close the issue". In `.plan` that is "add `## Answer`". Whichever skill copy is installed, the tracker doc an agent reads decides whether it writes `Status: resolved` (upstream local doc) or nothing (chartr). This repo's `.plan/README.md` already says status is derived and agents never write `claimed_by`, so a session that reads it writes a chartr-clean ticket.
- Upstream's claim step says "assign it to yourself before any work". chartr reserves the claim for the tool. The map already decided the panel's start-thread action writes `claimed_by`, which matches chartr, and an agent following upstream literally would have nowhere to write a claim in `.plan` anyway because `status` is forbidden and `claimed_by` is reserved.

## Recommendation

1. Pull the four upstream text changes into the local skill. They are small, carry no format change, and two of them (resolve as the labelled type, fresh-context research subagents) make sessions on this map behave better. Suggested diff: add `disable-model-invocation: true`, the labels sentence, the real-ids sentence, the fresh-context clause, and the step 3 "resolve as the type" sentence. Omit or adapt the "push the branch but open no PR" clause: this map runs research into `assets/` on the shared branch, not on `research/<name>` branches, and the map Notes should say so rather than the skill.
2. Do not adopt upstream `issue-tracker-local.md`. Its `.scratch/`, `issues/`, `Status:`, and agent-written claim conventions conflict with chartr and with this repo's `.plan/README.md`. Ticket 08 should instead write a tracker doc for the `.plan/maps/<slug>/` layout (or point the setup skill's pointer at `.plan/README.md`), so the skill's "consult the tracker doc" step lands on chartr's contract.
3. Keep `.plan/README.md` as the authoritative layout doc for this repo. It already states derived status, reserved `claimed_by`, the frontmatter keys, and the `## Answer` / `## Ruled out` closings, and matches `conventions.md` on every row above.
4. No change to the panel's parser scope. Parse exactly what `conventions.md` defines, and consider reporting chartr's `Legacy` header-block warning in the readout only if a later ticket asks for lint surfacing.
