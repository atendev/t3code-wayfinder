---
type: grilling
blocked_by: [03]
undermined_by: []
assets: []
---

# Agent access to maps through MCP

## Question

Ticket 03 made `WayfinderMaps` a service with `getSnapshot`, `readTicket`, and `readMap`. Should agents reach those methods through T3 Code MCP tools rather than by reading `.plan/` files, and if so, which tools: one snapshot tool, or separate snapshot and ticket tools? What does each return to a model (the full snapshot schema, or a trimmed frontier-first view), which scope gates it, and does it change what the `/wayfinder` skill tells agents to do? Model-facing tool text falls under `evals/README.md`.

## Done when

The answer either rules MCP access out with the reason, or names each tool, its input, its returned shape, its scope, the eval cases that cover its description, and any change to the skill text.
