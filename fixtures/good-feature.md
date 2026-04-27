---
id: good-feature
status: open
type: feature
priority: medium
labels: [feature, agent-ready]
estimate: M
---

# Add overdue badge to task list cards

## Problem

Project managers currently scan due dates manually on the task list, which makes overdue work easy to miss. The task list should make overdue tasks visible without changing task status logic.

## User Story

As a project manager, I want overdue task cards to show a compact badge so that I can quickly identify work that needs follow-up.

## In Scope

- `public/js/tasks.js`
- `public/css/styles.css`
- Task list card rendering only

## Out of Scope

- Do not add notifications.
- Do not change backend task status transitions.

## Acceptance Criteria

- [ ] A task with `dueDate` before today and status not `done` shows an "Overdue" badge.
- [ ] A task with status `done` never shows the badge.
- [ ] A task without `dueDate` renders exactly as it does today.
- [ ] Badge styling works in the existing dark theme.

## Verification

- Run `npm test`.
- Run `npm run lint`.
- Manual QA: seed one overdue task, one done overdue task, and one task with no due date, then view `#/tasks`.
