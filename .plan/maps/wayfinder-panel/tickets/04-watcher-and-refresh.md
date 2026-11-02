---
type: grilling
blocked_by: [03]
undermined_by: []
assets: []
---

# Watcher and refresh semantics

## Question

Which existing server watcher pattern does the `.plan/maps` watcher reuse, what debounce it applies while an agent writes several files in one step, whether the server pushes a whole snapshot or a diff on each change, and what happens over remote and tunnel connections when a map changes often. Decide also when the watcher starts and stops relative to the panel being open and the thread being active.

## Done when

The answer names the watcher module to copy, the debounce window, the push shape, the start and stop conditions, and how a malformed file mid-write is kept from flashing an error.
