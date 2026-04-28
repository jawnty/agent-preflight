Work on Linear issue ENG-42:

<issue identifier="ENG-42">
<title>Ship connector health dashboard</title>
<description>
**Context**
Support cannot see whether customer connectors are failing.

**Scope**

* Add a dashboard route at `src/pages/connector-health.tsx`.
* Show status, last sync time, and latest error for each connector.

**Acceptance Criteria**

1. Operators can filter unhealthy connectors.
2. The dashboard links to the relevant customer detail page.

**Testing**

Run `npm test -- connector-health`.
</description>
<team name="Engineering"/>
</issue>

<comment-thread comment-id="abc123">
<comment author="A Teammate" created-at="2026-01-02T03:04:05.000Z">
The existing admin shell lives in `src/pages/admin.tsx`.
</comment>
</comment-thread>
