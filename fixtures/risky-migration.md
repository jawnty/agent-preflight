---
id: risky-migration
status: open
type: task
priority: high
labels: [database]
estimate: S
---

# Update user table migration for archived accounts

## Problem

The production database migration for archived accounts currently skips users with a null `archivedAt` value, which leaves compliance exports inconsistent.

## Expected Behavior

The migration should backfill archived account metadata in `migrations/20260427_archive_users.sql` and `src/jobs/archiveUsers.js` without changing active account permissions.

## Acceptance Criteria

- [ ] Archived users receive a populated `archived_reason` value.
- [ ] Active users are not modified.
- [ ] The migration is idempotent when run twice.

## Verification

- Run `npm test -- archiveUsers`.
- Run `npm run build`.

## Notes

This touches production database schema behavior and needs human review before deploy.
