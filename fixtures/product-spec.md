---
id: product-spec
status: open
type: spec
---

# Build browser Tetris

## Problem

Players need a simple, local browser game that can be used as a small coding-agent benchmark. The game should be understandable without accounts, backend services, or external assets.

## Users

- A developer evaluating whether an agent can build a complete interactive UI.
- A player using desktop keyboard controls.

## Goals

- Build a playable single-player Tetris-style game in the existing web app.
- Keep the implementation local to the frontend.

## Non-goals

- No multiplayer.
- No backend persistence.
- No paid assets or network calls.

## Requirements

- The player can move, rotate, soft drop, and hard drop pieces with keyboard controls.
- Completed rows clear and increase the score.
- The game speeds up as the player clears more rows.
- The game shows pause, game over, and restart states.
- The layout works at desktop and mobile viewport widths.

## Success Metrics

- A user can start a game, clear a row, lose, and restart without reloading the page.
- The game loop remains responsive for at least five minutes of play.

## Verification

- Run `npm test`.
- Run `npm run build`.
- Manual QA: play until clearing at least one row, pause, resume, lose, and restart.

## Risks

- Canvas rendering and keyboard handling can become hard to test. Keep the core game rules in a pure module.
