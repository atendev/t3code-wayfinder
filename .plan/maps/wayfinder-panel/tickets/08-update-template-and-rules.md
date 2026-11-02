---
type: task
blocked_by: [01]
undermined_by: []
assets: []
---

# Update the plan template and planning rules to chartr conventions

## Question

The jev-toolbox `plan-init.sh` and `plan-template/` at `~/tools/jev-toolbox/` create `.plan/map.md` with a stored `status:` field and `tickets/` plus `closed/` folders. The user's global `CLAUDE.md` Planning layout section describes that layout. Both live outside this repo, so this is human-confirmed work. Rewrite them to the `.plan/maps/<slug>/` layout with derived status, matching this repo's `.plan/README.md`, after ticket 01 confirms nothing upstream conflicts.

## Done when

`plan-init.sh` creates `.plan/README.md` and `.plan/maps/` only, the template README matches this repo's, the `CLAUDE.md` Planning layout paragraph names `.plan/maps/<slug>/map.md`, and the answer records the files changed.
