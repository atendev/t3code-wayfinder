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

## Answer

Done with the user on 2026-11-02. Ticket 01 found no upstream conflict.

Files changed:

- `~/tools/jev-toolbox/plan-init.sh` now creates `.plan/maps/` and copies only `README.md`, never overwriting. It no longer creates `map.md`, `TICKET.template.md`, `tickets/`, or `closed/`, and it no longer adds `.gitkeep` files. The `.agent-state.md` gitignore entry is unchanged.
- `~/tools/jev-toolbox/plan-template/README.md` is now byte-identical to this repo's `.plan/README.md`.
- This repo's `.plan/README.md` says "the T3 Code Wayfinder panel" instead of "the Wayfinder panel in this fork", so the same text reads correctly in any project opened in T3 Code.
- `~/.claude/CLAUDE.md`, Planning layout: maps live at `.plan/maps/<slug>/map.md` with tickets in `.plan/maps/<slug>/tickets/`, and a session loads only the one `map.md` and the one ticket in progress.

- `plan-template/map.md` and `plan-template/TICKET.template.md` are deleted, with the user's approval. `README.md` is the only template file left.
- `~/.claude/skills/session-pickup/SKILL.md` step 2 now loads `.plan/maps/<slug>/map.md` instead of `.plan/map.md`.
