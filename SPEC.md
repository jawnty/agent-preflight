# Agent Preflight Spec

## Summary

Agent Preflight is a local-first CLI that answers one question before a human assigns an issue to Codex, Claude Code, Copilot, Cursor, Devin, Codegen, or another coding agent:

> Is this specific task ready for an autonomous coding agent, and if not, what exact context is missing?

The first version scores individual issues and generates an agent-ready handoff packet. It does not try to replace Linear, GitHub Issues, Jira, or coding agents. It sits before delegation and turns vague tracker work into a verifiable, auditable preflight check.

The second workflow adds an explicit upgrade loop:

> Use the score, repo signals, and deterministic questions to draft or apply a more agent-ready ticket.

## Why This Is Worth Building

### Market Evidence

Existing products validate the category, but leave a narrow open-source wedge:

- Factory Agent Readiness measures repository readiness across technical pillars and positions the environment as the bottleneck for agents: https://factory.ai/news/agent-readiness
- Kodus `agent-readiness` is an open-source repository readiness CLI with checks across codebase maturity pillars: https://github.com/kodustech/agent-readiness
- Atlassian is researching coding-agent task suitability inside Jira, using signals such as description length, links, file paths, code snippets, and technical terms: https://www.atlassian.com/blog/atlassian-engineering/improving-coding-agent-experience
- GitHub Copilot cloud-agent docs recommend well-scoped issues, clear acceptance criteria, relevant files, setup instructions, and tests, but do not provide a standalone issue preflight CLI: https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results
- Linear has native AI agents, delegation, and agent guidance, but explicitly passes guidance through to integrations rather than guaranteeing each issue is agent-ready: https://linear.app/docs/agents-in-linear
- Codex and Claude guidance both emphasize scoped instructions, project guidance files, permission boundaries, and verification, which supports a deterministic preflight layer rather than a purely LLM-based reviewer.

### Product Gap

Factory and Kodus answer:

> Is this repository generally agent-ready?

Agent Preflight answers:

> Is this issue safe, specific, and testable enough to hand to an agent right now?

That distinction matters because a mature repo can still have a terrible ticket, and a rough repo can still have a highly agent-ready task if the issue includes enough focused context.

### Naming Note

There is already a PyPI package named `agent-preflight` focused on previewing and validating AI agent actions before execution. For this prototype, the folder and product can remain `agent-preflight`, but a public package may need a clearer name such as `task-preflight`, `issue-preflight`, `agent-task-preflight`, or `preflight-for-agents`.

## Product Principles

1. Harness first, AI optional later.
2. Score the task, not the whole company brain.
3. Output evidence, not vibes.
4. Run offline against local fixtures.
5. Be useful before auth, Linear setup, or a hosted backend.
6. Produce an artifact a coding agent can actually use.
7. Prefer "ask for plan first" over false confidence on borderline work.

## V1 Scope

### In Scope

- Node.js CLI living entirely inside `agent-preflight/`.
- Local Markdown issue files as the primary input.
- Optional GitHub issue fetching via public GitHub API or `GITHUB_TOKEN`.
- Optional Linear issue fetching via `LINEAR_API_KEY`.
- Deterministic issue-readiness score from 0 to 100.
- Hard gates for unsafe or blocked tasks.
- JSON and human-readable output.
- Markdown handoff packet generation.
- Upgrade draft generation for turning weak tickets into agent-ready issue descriptions.
- Linear comment/apply mutation behind explicit flags.
- Test fixtures for good, vague, risky, blocked, and borderline issues.
- Automated tests using Node's built-in `node:test`.
- README with installation, usage, scoring model, examples, and validation notes.
- Demo asset, preferably `docs/demo.gif`; if GIF tooling is unavailable, include `docs/demo.svg` plus a script or notes to regenerate GIF later.

### Out of Scope for V1

- Hosted SaaS.
- Browser extension.
- Full Linear app.
- Full Jira support.
- Mutating tracker issues.
- Running a coding agent.
- LLM scoring.
- Semantic codebase search.
- PR audit against final implementation.

## CLI Interface

The package should expose a binary named `agent-preflight`.

### Commands

```bash
agent-preflight check <source> [options]
agent-preflight packet <source> [options]
agent-preflight upgrade <source> [options]
agent-preflight init [options]
agent-preflight fixtures [options]
```

### `check`

Scores an issue and prints a report.

```bash
agent-preflight check fixtures/ready-bug.md
agent-preflight check fixtures/vague.md --json
agent-preflight check https://github.com/owner/repo/issues/42
agent-preflight check LIN-123
```

Options:

- `--json`: print JSON instead of the human report.
- `--repo <path>`: repository path used for environment checks. Defaults to current working directory.
- `--source <markdown|github|linear|auto>`: source adapter. Defaults to `auto`.
- `--agent <codex|claude|copilot|cursor|other>`: agent profile. Defaults to `other`.
- `--min-score <number>`: fail with exit code 1 if score is below threshold.
- `--ci`: non-interactive mode. Equivalent to `--json` plus threshold-oriented exit behavior.
- `--progress`: print read/scan/score status lines to stderr while preserving stdout.
- `--ignore-state`: suppress the closed/completed/cancelled hard gate so a terminal-state ticket can still be scored (e.g. for post-mortems or before reopening). Other gates are unaffected. The report surfaces a `Notes` line documenting the suppression.
- `--config <path>`: config file. Defaults to `.agent-preflight.json` if present.
- `--no-color`: disable ANSI color.

Exit codes:

- `0`: check completed and score met `--min-score` if provided.
- `1`: check completed but failed threshold.
- `2`: invalid CLI usage or unreadable input.
- `3`: source adapter auth/network failure.
- `4`: internal error.

### `packet`

Writes an agent handoff packet from the same analysis used by `check`.

```bash
agent-preflight packet fixtures/ready-bug.md --out packet.md
agent-preflight packet fixtures/vague.md
```

Options:

- `--out <path>`: write packet to a file. If omitted, print to stdout.
- `--repo <path>`: repository path used for environment checks.
- `--source <markdown|github|linear|auto>`: source adapter.
- `--agent <codex|claude|copilot|cursor|other>`: agent profile.
- `--ignore-state`: same meaning as on `check`.

### `init`

Creates `.agent-preflight.json`.

```bash
agent-preflight init
```

Default config:

```json
{
  "minScore": 80,
  "agent": "codex",
  "repoPath": ".",
  "riskKeywords": ["auth", "billing", "security", "migration", "production", "PII"],
  "blockedDomains": [],
  "allowedExternalDomains": [],
  "weights": {
    "task_clarity": 20,
    "scope_boundedness": 15,
    "acceptance_criteria": 15,
    "implementation_guidance": 15,
    "verification_path": 15,
    "agent_environment_readiness": 10,
    "risk_profile": 10
  }
}
```

### `fixtures`

Copies example fixture issues into a target folder or prints their paths.

```bash
agent-preflight fixtures
agent-preflight fixtures --out ./preflight-fixtures
```

This makes it easy for users to try the tool immediately.

## Normalized Input Model

All adapters should normalize into this shape:

```json
{
  "source": {
    "type": "markdown",
    "id": "ready-bug",
    "url": null
  },
  "issue": {
    "id": "ready-bug",
    "url": null,
    "title": "Fix invoice PDF download 500 on Safari",
    "description": "Markdown body",
    "comments": [],
    "status": "open",
    "type": "bug",
    "priority": "medium",
    "labels": ["bug", "agent-ready"],
    "assignee": null,
    "delegatedAgent": null,
    "estimate": "S",
    "parentId": null,
    "blockedBy": [],
    "linkedPrs": [],
    "linkedDocs": [],
    "attachments": []
  },
  "repo": {
    "path": ".",
    "provider": "github",
    "owner": null,
    "name": null,
    "defaultBranch": null,
    "instructionsFiles": [],
    "ciStatus": "unknown",
    "setupConfigPresent": false,
    "testCommands": []
  },
  "agent": {
    "kind": "codex",
    "canAccessRepo": true,
    "canAccessExternalLinks": false,
    "internetPolicy": "off",
    "allowedDomains": []
  }
}
```

Markdown adapter rules:

- First Markdown heading is the title.
- Optional frontmatter may set `id`, `status`, `type`, `priority`, `labels`, `estimate`, `assignee`, and `delegatedAgent`.
- Remaining content is the description.
- If no heading exists, first non-empty line is the title.

GitHub adapter rules:

- Parse URLs matching `https://github.com/<owner>/<repo>/issues/<number>`.
- Fetch `GET /repos/{owner}/{repo}/issues/{issue_number}`.
- Include labels, assignee, state, title, body, and comments when accessible.
- Use `GITHUB_TOKEN` if present.
- If the API request fails, return exit code 3 with a clear message.

Linear adapter rules:

- Accept Linear URLs and issue identifiers automatically.
- Require `LINEAR_API_KEY`.
- Fetch issue title, description, state, labels, priority, assignee, estimate, comments, relations, and attachments where available.
- V1 can implement this as a best-effort adapter with tests around URL/id parsing and missing-token behavior.

## Repository Environment Detection

The scorer should inspect the repo path without modifying files.

Signals:

- Instructions files: `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursorrules`, `.cursor/rules`.
- Package manager files: `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`.
- Test commands from `package.json` scripts containing `test`, `lint`, `typecheck`, `check`, or `build`.
- CI config: `.github/workflows/*`, `.gitlab-ci.yml`, `circle.yml`.
- Dev containers: `.devcontainer/devcontainer.json`.

No command execution is required for V1 environment detection. The tool should not run project tests unless a future explicit `doctor` command is added.

## Hard Gates

Hard gates run before scoring. A hard gate can make the result `blocked` or cap the final score.

### Blocking Gates

Return readiness `blocked` and recommended action `keep_human_owned` when:

- Issue status is `done`, `closed`, `cancelled`, `canceled`, or `completed`. The CLI flag `--ignore-state` overrides this single gate so a terminal-state ticket can still be scored; the suppression is recorded in `analysis.notes`.
- Issue is explicitly blocked by another task.
- Issue is already delegated to another active agent.
- Issue asks for secrets, credentials, tokens, key material, production database access, or admin access.
- Issue appears to contain prompt-injection or exfiltration instructions.
- Issue requires external context that is inaccessible to the agent, such as private Slack, Figma, Google Docs, Notion, or Confluence links, without a summary in the issue body.

Prompt-injection/exfiltration patterns:

- `ignore previous instructions`
- `ignore all instructions`
- `reveal your system prompt`
- `print your environment`
- `cat ~/.`
- `curl` or `wget` combined with logs, `.env`, tokens, SSH keys, or external paste hosts
- `send` or `upload` combined with secrets, env vars, or credentials

### Score Caps

- Cap at 45 if title and description together are shorter than 120 characters.
- Cap at 60 if the issue has no acceptance criteria and no verification path.
- Cap at 70 if the issue depends on external links and the body does not summarize the linked context.
- Cap at 75 if risky domains are present without rollback, feature flag, migration plan, or human review.
- Cap at 80 if repository instructions and test commands are both missing.

Caps should be reported in `capsApplied`.

## Scoring Algorithm

Total score: 100 points.

The algorithm should be deterministic and explainable. Each dimension returns:

```json
{
  "id": "task_clarity",
  "label": "Task clarity",
  "score": 18,
  "maxScore": 20,
  "status": "pass",
  "signals": ["Title contains an action and object"],
  "evidence": ["Fix invoice PDF download 500 on Safari"],
  "suggestions": []
}
```

Dimension status:

- `pass`: score is at least 75 percent of max.
- `partial`: score is at least 40 percent and below 75 percent.
- `missing`: score is below 40 percent.

### 1. Task Clarity, 20 Points

Positive signals:

- Title has action plus object, such as `Fix invoice PDF download`.
- Description explains current behavior.
- Description explains expected behavior.
- Description includes user or business impact.
- Bug reports include environment, version, logs, stack trace, or repro rate.
- Feature requests include user story or concrete desired behavior.

Negative signals:

- Vague verbs: `fix`, `improve`, `clean up`, `make better`, `figure out`, `investigate`.
- Placeholder text: `TBD`, `as discussed`, `see Slack`, `later`.
- Description too short to infer intent.

Suggested scoring:

- 4 points for title action/object.
- 4 points for current behavior or problem statement.
- 4 points for expected behavior or desired outcome.
- 4 points for impact or why now.
- 4 points for concrete examples, logs, screenshots, stack trace, or user story.
- Subtract up to 6 for vague/placeholder language.

### 2. Scope Boundedness, 15 Points

Positive signals:

- Explicit in-scope/out-of-scope section.
- Non-goals are present.
- Mentions a small number of files, routes, modules, or components.
- Estimate is XS, S, M, or less than or equal to 3 points.
- Labels indicate small task, bug, docs, tests, or agent-ready.

Negative signals:

- `rewrite`, `redesign`, `overhaul`, `refactor everything`, `multiple repos`, `platform-wide`.
- Many broad domains in one task.
- Requires product/design invention.

Suggested scoring:

- 5 points for explicit boundaries.
- 4 points for small estimate or small-task label.
- 4 points for limited component/file surface.
- 2 points for non-goals.
- Subtract up to 8 for broad rewrite/refactor language.

### 3. Acceptance Criteria, 15 Points

Positive signals:

- Heading contains `Acceptance Criteria`, `Done When`, `Definition of Done`, or `Given/When/Then`.
- Checklist items are present.
- Criteria are observable and testable.

Suggested scoring:

- 6 points for explicit acceptance section.
- 5 points for checklist or numbered criteria.
- 4 points for testable language such as `must`, `should`, `returns`, `shows`, `does not`, `given/when/then`.

### 4. Implementation Guidance, 15 Points

Positive signals:

- File paths, routes, symbols, function/class/component names.
- Stack traces or logs.
- API endpoint names.
- Related PRs/issues/docs.
- Screenshots or reproduction media.

Suggested scoring:

- 5 points for file paths or modules.
- 4 points for code symbols/routes/API names.
- 3 points for logs, stack trace, screenshot, or sample payload.
- 3 points for related links or prior art summarized in the body.

### 5. Verification Path, 15 Points

Positive signals:

- Test command included.
- Manual QA steps included.
- Expected failing test or regression test target included.
- Build/lint/typecheck command included.

Suggested scoring:

- 5 points for automated test command.
- 4 points for manual verification steps.
- 3 points for regression/failing test target.
- 3 points for build/lint/typecheck command.

### 6. Agent Environment Readiness, 10 Points

Positive signals:

- Repo contains an agent instruction file.
- Repo has package/dependency metadata.
- Repo exposes test commands.
- Repo has CI config.
- Repo has setup/devcontainer metadata.

Suggested scoring:

- 3 points for agent instructions.
- 2 points for package/dependency metadata.
- 2 points for test commands.
- 2 points for CI config.
- 1 point for devcontainer/setup metadata.

### 7. Risk Profile, 10 Points

Start from 10 and subtract risk.

Risk keywords:

- `auth`, `oauth`, `session`, `password`, `permission`, `security`, `billing`, `payment`, `stripe`, `migration`, `schema`, `database`, `production`, `deploy`, `incident`, `PII`, `privacy`, `legal`, `compliance`, `admin`.

Mitigations:

- `rollback`, `feature flag`, `behind a flag`, `migration plan`, `dry run`, `human review`, `manual approval`.

Suggested scoring:

- 10 if low-risk and no sensitive domains.
- 7 if one sensitive domain appears with clear boundaries.
- 4 if sensitive domain appears without mitigation.
- 0 if it should be blocked by hard gates.

## Readiness Bands

- `ready`: score >= 80 and no blocking hard gates.
- `ready_with_cautions`: score 65 to 79 and no blocking hard gates.
- `needs_human_refinement`: score 45 to 64 or severe missing sections.
- `not_ready`: score below 45.
- `blocked`: blocking hard gate triggered.

Recommended action:

- `assign_agent`: `ready`.
- `ask_for_plan_first`: `ready_with_cautions`.
- `request_clarification`: `needs_human_refinement` or `not_ready`.
- `keep_human_owned`: `blocked` or high-risk issue.

## Confidence Score

Confidence communicates how much evidence the deterministic scorer had.

Suggested algorithm:

```text
confidence = 0.4
+ 0.15 if description length > 300
+ 0.15 if acceptance criteria detected
+ 0.10 if repo metadata available
+ 0.10 if comments included
+ 0.10 if test commands or instructions detected
cap at 1.0
```

Confidence should not change readiness directly, but low confidence should add a caution:

> Low confidence: ask the agent for a plan before implementation.

## Output JSON Schema

```json
{
  "version": "0.1.0",
  "generatedAt": "2026-04-27T00:00:00.000Z",
  "readiness": "ready",
  "score": 84,
  "confidence": 0.9,
  "recommendedAction": "assign_agent",
  "source": {
    "type": "markdown",
    "id": "ready-bug",
    "url": null,
    "title": "Fix invoice PDF download 500 on Safari"
  },
  "hardGates": [],
  "capsApplied": [],
  "dimensions": [
    {
      "id": "task_clarity",
      "label": "Task clarity",
      "score": 18,
      "maxScore": 20,
      "status": "pass",
      "signals": [],
      "evidence": [],
      "suggestions": []
    }
  ],
  "missingFields": [],
  "clarifyingQuestions": [],
  "notes": [],
  "riskNotes": [],
  "packet": {
    "summary": "",
    "acceptanceCriteria": [],
    "constraints": [],
    "likelyFiles": [],
    "verification": [],
    "questions": [],
    "agentPrompt": ""
  },
  "repo": {
    "path": ".",
    "instructionsFiles": [],
    "testCommands": [],
    "ciConfig": []
  }
}
```

## Human Report Format

Example:

```text
Agent Preflight: ready (84/100, confidence 0.90)
Recommended action: assign_agent

Pass
  Task clarity                 18/20
  Acceptance criteria           14/15
  Verification path             13/15

Cautions
  Risk profile                   7/10  Mentions auth; rollback plan present.

Missing
  None

Next best fix
  Add one explicit regression test command if available.
```

A `Notes` section appears above `Pass` whenever the analysis populates `analysis.notes`. Today this surfaces only when `--ignore-state` suppressed the closed/completed/cancelled gate; future invocation-meta signals can land in the same channel without polluting the content-derived `Cautions` and `riskNotes` sections.

```text
Agent Preflight: not_ready (28/100, confidence 0.85)
Recommended action: request_clarification

Notes
  Issue status is completed — closed/cancelled gate suppressed via --ignore-state.

Pass
  Task clarity                 16/20

…
```

## Agent Handoff Packet

`packet` should produce Markdown:

```markdown
# Agent Handoff Packet

## Source

- Title: Fix invoice PDF download 500 on Safari
- Source: fixtures/ready-bug.md
- Readiness: ready, 84/100
- Recommended action: assign_agent

## Task Summary

...

## Acceptance Criteria

- ...

## Constraints

- Do not change billing calculations.

## Likely Files

- public/js/invoices.js

## Verification

- npm test -- invoices
- npm run lint

## Clarifying Questions

- None.

## Agent Prompt Addendum

Follow repository instructions. Keep the change scoped to the listed files when possible. Add or update tests for changed behavior. If the likely root cause differs from the issue, stop after investigation and report a plan before implementing.
```

### `upgrade`

Creates a normalized ticket rewrite from the preflight result. By default it is a dry run and prints Markdown to stdout.

```bash
agent-preflight upgrade ENG-123 --dry-run
agent-preflight upgrade ENG-123 --comment
agent-preflight upgrade ENG-123 --apply
```

Options:

- `--dry-run`: print the proposed rewrite. This is the default if no mutation flag is supplied.
- `--out <path>`: write the upgrade draft to a file.
- `--comment`: post the upgrade proposal as a Linear comment.
- `--apply`: replace the Linear issue description with the proposed rewrite.
- `--repo <path>`: repo path used to detect instructions, test commands, CI config, and candidate files.
- `--source <markdown|github|linear|auto>`: source adapter.
- `--agent <codex|claude|copilot|cursor|other>`: agent profile.
- `--progress`: print read/scan/score/update status lines to stderr.
- `--ignore-state`: same meaning as on `check`. Lets `upgrade` draft a normalized rewrite for a closed/completed/cancelled ticket without the gate firing.

Safety rules:

- `--comment` and `--apply` require a Linear source in V1.
- `--apply` must never be the default.
- The upgrade must preserve uncertainty as TODOs or human questions rather than inventing missing product intent.
- Repo inspection is read-only.

## Clarifying Question Generation

Generate deterministic questions from missing dimensions:

- Missing acceptance criteria: `What observable conditions should be true when this is done?`
- Missing verification: `What command or manual flow should the agent use to verify the change?`
- Missing current behavior: `What happens today, and where can the agent reproduce it?`
- Missing expected behavior: `What should happen instead?`
- Missing technical anchors: `Which file, route, component, or API is most likely involved?`
- Risk without mitigation: `What rollback or review path should the agent follow if this touches a sensitive area?`
- External context inaccessible: `Can you summarize the linked context directly in the issue?`

## Implementation Architecture

Suggested file layout:

```text
agent-preflight/
  SPEC.md
  README.md
  package.json
  bin/
    agent-preflight.js
  src/
    cli.js
    adapters/
      github.js
      linear.js
      markdown.js
    config.js
    detectRepo.js
    packet.js
    report.js
    schema.js
    score.js
    textSignals.js
  fixtures/
    ready-bug.md
    good-feature.md
    vague.md
    risky-migration.md
    prompt-injection.md
    external-context.md
    no-tests.md
  test/
    cli.test.js
    markdown.test.js
    score.test.js
    packet.test.js
  docs/
    demo.gif
    demo.svg
```

### Module Responsibilities

- `cli.js`: parse args, load config, call adapters, run scorer, render report or JSON.
- `markdown.js`: parse local Markdown and frontmatter.
- `github.js`: parse GitHub issue URLs and fetch issue JSON.
- `linear.js`: parse Linear URLs/ids and fetch issue JSON when token is present.
- `config.js`: load defaults and merge `.agent-preflight.json`.
- `detectRepo.js`: inspect local repo files and package scripts.
- `textSignals.js`: pure regex/string helpers.
- `score.js`: hard gates, dimensions, caps, confidence, readiness band.
- `packet.js`: build packet object and Markdown.
- `report.js`: render readable terminal output.
- `schema.js`: constants and default weights.

## Testing Requirements

Use `node:test` and `node:assert/strict`.

Required tests:

- Markdown parser extracts title, frontmatter, and body.
- Vague fixture scores below 45.
- Ready bug fixture scores at least 80.
- Good feature fixture scores at least 75.
- Risky migration fixture applies risk cap or caution.
- Prompt-injection fixture returns `blocked`.
- External-context fixture is blocked or capped when context is inaccessible.
- No-tests fixture has partial verification and concrete suggestions.
- JSON output is parseable and contains all required top-level fields.
- `packet` command prints Markdown with summary, criteria, verification, and questions.
- `--min-score` exits with code 1 when threshold is not met.
- `init` writes config without overwriting unless `--force` is supplied.
- A closed/completed/cancelled issue returns `blocked` by default.
- `--ignore-state` removes only the closed-issue gate (other gates such as prompt-injection still block) and surfaces a meta-note in `analysis.notes`.

## Demo Requirements

The README should show:

```bash
npm install
npm test
node bin/agent-preflight.js check fixtures/vague.md
node bin/agent-preflight.js check fixtures/ready-bug.md
node bin/agent-preflight.js packet fixtures/ready-bug.md --out packet.md
```

The demo asset should show the contrast:

1. Run on `fixtures/vague.md`.
2. See `not_ready` with missing acceptance criteria, verification, and technical anchors.
3. Run on `fixtures/ready-bug.md`.
4. See `ready`.
5. Generate a packet.

If a real GIF can be generated in the environment, create `docs/demo.gif`. If not, include `docs/demo.svg` and document how to convert it.

## Validation Plan

Before handing the prototype back:

1. Run `npm test`.
2. Run `node bin/agent-preflight.js check fixtures/vague.md`.
3. Run `node bin/agent-preflight.js check fixtures/ready-bug.md --json` and parse it.
4. Run `node bin/agent-preflight.js packet fixtures/ready-bug.md`.
5. Run `node bin/agent-preflight.js check fixtures/vague.md --min-score 80` and confirm exit code 1.
6. Run `node bin/agent-preflight.js init` in a temporary directory and confirm config is created.

## Future Versions

- GitHub Action that comments readiness on newly labeled issues.
- Linear comment command or app integration.
- Jira adapter.
- Optional LLM enrichment that proposes better acceptance criteria but never changes the deterministic score silently.
- PR postflight audit: compare implementation diff against original packet.
- Team dashboard showing recurring issue-quality gaps.
- Agent-specific profiles for Codex, Claude Code, Copilot, Cursor, Devin, Codegen.
- MCP server exposing `check_issue` and `generate_packet`.
