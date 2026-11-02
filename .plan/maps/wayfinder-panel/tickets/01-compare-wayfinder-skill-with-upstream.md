---
type: research
blocked_by: []
undermined_by: []
assets: [research-wayfinder-upstream.md]
---

# Compare the local wayfinder skill with the published one

## Question

The local skill at `/home/aten/.agents/skills/wayfinder/SKILL.md` has no git remote. The published source is the `mattpocock/skills` repository on GitHub. What differs between the two in the map body sections, ticket types, ticket format, blocking, claiming, out-of-scope handling, and the local-markdown tracker layout? Does the published version know about chartr's `.plan/maps/<slug>/` layout, and does anything in it conflict with that layout?

## Done when

A findings file at `assets/research-wayfinder-upstream.md` lists each difference with a quote or line reference from both sides, states whether it affects the file format this panel parses, and ends with a recommendation on whether to update the local skill.

## Answer

The local skill is a verbatim copy of upstream `mattpocock/skills` `skills/engineering/wayfinder/SKILL.md` as of early October 2026 (the published path moved under `engineering/` in July; the ticket's `skills/wayfinder/` path is a 404). It lacks exactly two upstream commits, `8295b8e1` (2026-10-07) and `7739eaed` (2026-10-29), which add five text changes: a `disable-model-invocation: true` frontmatter flag, "wayfinder labels are the only labels, never a triage label", "write cross-references with real ids, not placeholder `#<n>`", "spin up research subagents with a fresh context window, push the `research/<name>` branch but open no PR", and "resolve a ticket as the type its label names, the body never states the type". The map body sections, ticket body template, ticket types, blocking, claiming, fog, and out-of-scope sections are byte-identical. `issue-tracker-local.md` is identical to upstream; `issue-tracker-github.md` upstream only refreshed `gh` commands.

None of this affects the file format the panel parses. Upstream does not know about chartr or `.plan/maps/<slug>/`; it never mentions either. The skill body is tracker-agnostic and defers layout to the tracker doc, so the only upstream text that conflicts with chartr's `conventions.md` is `issue-tracker-local.md`: `.scratch/<effort>/issues/` instead of `.plan/maps/<slug>/tickets/`, a stored `Status:` line where chartr forbids `status`, an agent-written `Status: claimed` where chartr reserves `claimed_by` for the tool, and no `## Done when`. chartr's parser reads the loose `Type:`/`Blocked by:` header block as a warned legacy format but never discovers a `.scratch` map at all. That conflict predates the local copy and is not changed by the four newer commits.

Recommendation: update the local skill with the four upstream text changes (dropping or adapting the `research/<name>` branch clause, since this map writes research into `assets/` on the shared branch). Do not adopt upstream's local tracker doc; ticket 08 should instead make the tracker doc this repo's `.plan/README.md`, which already matches chartr on every row. The panel's parser scope stays exactly `conventions.md`. Full comparison table with quotes and line references in `assets/research-wayfinder-upstream.md`.
