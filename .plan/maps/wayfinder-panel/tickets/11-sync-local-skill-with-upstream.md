---
type: task
blocked_by: [01]
undermined_by: []
assets: []
---

# Pull the upstream wayfinder text changes into the local skill

## Question

Ticket 01 found five text changes upstream that the local skill at `/home/aten/.agents/skills/wayfinder/SKILL.md` lacks: the `disable-model-invocation: true` frontmatter, the rule that `wayfinder:` labels are the only labels, real ids in cross-references, research subagents getting a fresh context window and pushing a branch with no PR, and resolving a ticket as the type its label names. The skill lives outside this repo, so this is human-confirmed work. Apply them, adapting the research-branch clause to this effort's practice of writing findings to the map's `assets/` on the shared branch, and point the skill's tracker consultation at `.plan/README.md` as the local tracker doc.

## Done when

The local `SKILL.md` carries the five changes, the research clause reads correctly for the assets approach, and the answer lists the lines changed.

## Answer

Applied all five upstream changes, then revised lines 25, 115, and 124 after an audit, to `/home/aten/.agents/skills/wayfinder/SKILL.md`, plus the tracker pointer. A backup of the old file sits at `/tmp/wayfinder-SKILL.md.bak` for this session only.

- Line 4: `disable-model-invocation: true` added to the frontmatter. Agents no longer start `/wayfinder` on their own; the user types it.
- Line 25: the tracker paragraph now opens with `.plan/README.md` as the local tracker doc when it exists, before the `/setup-matt-pocock-skills` fallback, so an agent in a `.plan` repo never stops at the setup prompt. It gives the `.plan/maps/<slug>/map.md` and `tickets/NN-slug.md` layout, says the README's "Rules" and "Resolving a ticket" sections stand in for "Wayfinding operations", and says its rules on derived status, frontmatter, and claims replace the issue-based mechanics anywhere in the skill. This settles the claim conflict: the skill says "assign it to yourself", while the README says agents never write `claimed_by`.
- Line 65: "`wayfinder:` labels are the only labels a map and its tickets carry, never a triage label like `ready-for-agent`" appended to the labels sentence.
- Line 114: "Write cross-references in that pass too, with real ids" appended to Chart step 4.
- Line 115: research subagents get "a fresh context window" and capture findings "where the tracker doc keeps the map's assets (for `.plan`, a file in the map's `assets/` folder, committed on the shared planning branch)". The sentence stays tracker-neutral. The upstream `research/<name>` branch and "push the branch but open no PR" clause were dropped, since this effort never uses research branches.
- Line 124: Work step 3 now reads "Resolve it as the type its `wayfinder:<type>` label (the `type:` frontmatter in `.plan`) names ... the body never states the type."

Not changed: the map body template, ticket template, ticket types, fog, and out-of-scope sections, which ticket 01 found byte-identical to upstream. Upstream's `issue-tracker-local.md` was not adopted (ticket 01).
