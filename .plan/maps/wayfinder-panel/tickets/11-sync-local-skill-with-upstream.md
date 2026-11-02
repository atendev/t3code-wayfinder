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
