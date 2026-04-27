---
id: no-tests
status: open
type: bug
priority: medium
labels: [bug, small]
estimate: S
---

# Fix empty project list message

## Problem

When a new user opens `/projects`, the app currently renders a blank panel because `ProjectList` receives an empty array and does not render fallback copy. This makes onboarding feel broken.

## Expected Behavior

The page should show a friendly empty state with a "Create project" call to action.

## In Scope

- `src/components/ProjectList.js`
- `src/components/ProjectList.css`

## Acceptance Criteria

- [ ] Empty project arrays show a clear empty state.
- [ ] Existing project cards still render when projects are present.
- [ ] The CTA links to `/projects/new`.

## Verification

Manual QA: open `/projects` with a user that has no projects, then add a project and confirm the card list returns.
