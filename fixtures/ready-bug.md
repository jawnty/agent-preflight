---
id: ready-bug
status: open
type: bug
priority: high
labels: [bug, agent-ready, small]
estimate: S
---

# Fix invoice PDF download 500 on Safari

## Problem

Customers using Safari 17 currently see a 500 error when downloading invoice PDFs from `/billing/invoices/:id/download`. Chrome and Firefox still work. This blocks finance admins from sending invoices to vendors and has generated six support tickets since the last release.

## Expected Behavior

Safari users should receive the same `application/pdf` response as other browsers. The download must not change invoice totals, billing calculations, or invoice authorization checks.

## Implementation Notes

Likely files:

- `src/routes/invoices.js`
- `src/services/pdfRenderer.js`
- `test/invoices/download.test.js`

The failing route is `GET /billing/invoices/:id/download`. Logs show `TypeError: Cannot read properties of undefined (reading 'headers')` after `renderInvoicePdf`.

## Acceptance Criteria

- [ ] Safari 17 can download an existing invoice PDF without a 500.
- [ ] Unauthorized users still receive 403 for invoices they do not own.
- [ ] Invoice totals and billing calculations are not changed.
- [ ] A regression test covers the Safari request header shape.

## Out of Scope

- Do not redesign invoice pages.
- Do not change billing calculations.

## Verification

- Run `npm test -- invoices`.
- Run `npm run lint`.
- Manual QA: open Safari, visit `/billing/invoices/inv_123`, click Download PDF, and confirm the file opens.
