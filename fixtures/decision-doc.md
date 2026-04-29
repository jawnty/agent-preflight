---
id: decision-doc
status: open
type: decision
---

# Decide whether Agent Preflight should support specs

## Context

Agent Preflight currently scores implementation tickets. Users also want to feed specs into agents, but a generic document improver could dilute the product.

## Options

- Keep the tool ticket-only.
- Add an explicit `--mode spec` flag.
- Infer artifact type and keep the same commands.

## Tradeoffs

- Ticket-only preserves focus but rejects a real workflow.
- Explicit mode is predictable but makes the interface heavier.
- Inference keeps the interface simple but must be conservative to avoid surprise.

## Recommendation

Infer artifact type for local Markdown, keep Linear and GitHub ticket-first, and fall back to the ticket rubric when confidence is low.

## Next Steps

- Add artifact detection tests.
- Add a product spec fixture.
- Update README examples.
