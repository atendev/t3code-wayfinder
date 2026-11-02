---
type: grilling
blocked_by: [02]
undermined_by: []
assets: []
---

# Ambient motion and a demand-driven render loop

## Question

chartr's star-map runs a continuous requestAnimationFrame loop that drives star drift, the frontier pulse, claimed rings, edge particles, session moons, ticker fade, and camera easing. This repo forbids continuous repaints because they peg the GPU on high-refresh displays. Which of those effects survive, which are replaced by static treatments, and which run only during an interaction such as camera motion, selection, or a snapshot change. Decide the rule for when the loop may run and how it proves it stopped.

## Done when

The answer gives a table of each effect with keep, replace, or drop and its trigger, the invariant the loop must satisfy at rest, and the assertion a seam test can make about it.
