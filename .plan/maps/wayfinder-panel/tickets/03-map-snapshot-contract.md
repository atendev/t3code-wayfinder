---
type: grilling
blocked_by: []
undermined_by: [01]
assets: []
---

# Map snapshot contract and service shape

## Question

What typed snapshot does the server push for a checkout's maps, and what service and RPC methods produce it? Cover the list of maps with slugs and titles, tickets with number, title, type, derived status, blocked_by, undermined_by, claim fields, and body, the frontier, and parse errors for malformed files. Decide whether the body ships in the snapshot or on demand per ticket, how the snapshot is keyed by checkout path, and where the schema lives in `packages/contracts`.

## Done when

The answer names the schema types, the service name and its methods following `docs/internals/effect-services.md`, the RPC method and its scope entry in `CLIENT_GUARDED_RPC_SCOPES`, and a size estimate for a fifty-ticket map so the websocket cost is known.
