# Agent Preflight

Agent Preflight is a local-first CLI that checks whether a specific issue is ready for an autonomous coding agent. It scores Linear, GitHub, or local Markdown issues deterministically, explains the evidence, generates a handoff packet, and can draft or apply a safer ticket upgrade.

No hosted backend is required. No LLM calls are made.

## Install

```bash
npm install
npm test
```

You can run the CLI directly:

```bash
node bin/agent-preflight.js check fixtures/vague.md
node bin/agent-preflight.js check fixtures/ready-bug.md
node bin/agent-preflight.js upgrade fixtures/vague.md
node bin/agent-preflight.js packet fixtures/ready-bug.md --out packet.md
```

If installed as a package or linked locally, the binary name is `agent-preflight`:

```bash
npm link
agent-preflight check fixtures/ready-bug.md
```

## Commands

```bash
agent-preflight check <source> [options]
agent-preflight packet <source> [options]
agent-preflight upgrade <source> [options]
agent-preflight init [options]
agent-preflight fixtures [options]
```

`check` prints a human report by default:

```bash
node bin/agent-preflight.js check fixtures/ready-bug.md
```

Use JSON for CI or downstream tooling:

```bash
node bin/agent-preflight.js check fixtures/ready-bug.md --json
node bin/agent-preflight.js check fixtures/vague.md --min-score 80
```

`packet` generates an agent handoff packet:

```bash
node bin/agent-preflight.js packet fixtures/ready-bug.md
node bin/agent-preflight.js packet fixtures/ready-bug.md --out packet.md
```

`upgrade` drafts a normalized, agent-ready ticket rewrite:

```bash
node bin/agent-preflight.js upgrade fixtures/vague.md
node bin/agent-preflight.js upgrade fixtures/vague.md --out upgrade.md
```

For Linear, `upgrade` can safely post the proposal as a comment, or explicitly replace the issue description:

```bash
LINEAR_API_KEY=... agent-preflight upgrade ENG-123 --source linear --comment
LINEAR_API_KEY=... agent-preflight upgrade ENG-123 --source linear --apply
```

Use `--comment` first when testing real workflows. `--apply` intentionally requires an explicit flag because it mutates the Linear issue description.

`init` creates `.agent-preflight.json`:

```bash
node bin/agent-preflight.js init
node bin/agent-preflight.js init --force
```

`fixtures` lists or copies example issues:

```bash
node bin/agent-preflight.js fixtures
node bin/agent-preflight.js fixtures --out ./preflight-fixtures
```

## Options

`check` supports:

- `--json`: print JSON instead of a human report.
- `--repo <path>`: repository path used for environment checks. Defaults to the config value or current directory.
- `--source <markdown|github|linear|auto>`: source adapter. Defaults to `auto`.
- `--agent <codex|claude|copilot|cursor|other>`: agent profile. Defaults to config or `other`.
- `--min-score <number>`: exit with code 1 if the score is below the threshold.
- `--ci`: equivalent to JSON output plus threshold-oriented exit behavior.
- `--config <path>`: config file. Defaults to `.agent-preflight.json` if present.

`packet` supports `--out`, `--repo`, `--source`, and `--agent`.

`upgrade` supports:

- `--dry-run`: print the proposed ticket rewrite. This is also the default when no mutation flags are supplied.
- `--out <path>`: write the upgrade draft to a file.
- `--comment`: post the upgrade proposal as a Linear comment. Requires `--source linear` and `LINEAR_API_KEY`.
- `--apply`: replace the Linear issue description with the proposed upgrade. Requires `--source linear` and `LINEAR_API_KEY`.
- `--repo`, `--source`, and `--agent`: same meaning as `check`.

## Scoring Model

The score is deterministic and totals 100 points:

- Task clarity: 20
- Scope boundedness: 15
- Acceptance criteria: 15
- Implementation guidance: 15
- Verification path: 15
- Agent environment readiness: 10
- Risk profile: 10

Readiness bands:

- `ready`: score >= 80 and no blocking gate.
- `ready_with_cautions`: score 65 to 79 and no blocking gate.
- `needs_human_refinement`: score 45 to 64 or severe missing sections.
- `not_ready`: score below 45.
- `blocked`: a hard gate triggered.

Hard gates block closed/cancelled issues, explicit blockers, issues already delegated to another agent, requests for secrets or privileged access, prompt-injection/exfiltration text, and inaccessible private external context without an in-issue summary.

Score caps reduce false confidence for very short issues, missing acceptance plus verification, unsummarized external links, risky areas without mitigation, and repos lacking both instructions and test commands.

## Markdown Input

The Markdown adapter uses the first `# Heading` as the title. Optional frontmatter can set:

```yaml
---
id: ready-bug
status: open
type: bug
priority: high
labels: [bug, agent-ready]
estimate: S
assignee: alice
delegatedAgent:
---
```

## Optional Remote Sources

GitHub issue URLs are fetched with the public GitHub API. `GITHUB_TOKEN` is used when present.

```bash
node bin/agent-preflight.js check https://github.com/owner/repo/issues/42
```

Linear requires `--source linear` for identifiers and `LINEAR_API_KEY` for API access.

```bash
LINEAR_API_KEY=... node bin/agent-preflight.js check LIN-123 --source linear
LINEAR_API_KEY=... agent-preflight upgrade LIN-123 --source linear --comment
```

Network or auth failures return exit code 3.

## Demo

This repo includes `docs/demo.gif` and `docs/demo.svg`, which show the intended contrast:

1. Run on `fixtures/vague.md`.
2. See `not_ready` with missing acceptance criteria, verification, and technical anchors.
3. Run on `fixtures/ready-bug.md`.
4. See `ready`.
5. Generate an upgrade draft and packet.

If you edit the SVG and want to regenerate the GIF later:

```bash
# Example if ImageMagick/rsvg-convert tooling is available:
rsvg-convert docs/demo.svg -o docs/demo.png
convert docs/demo.png docs/demo.gif
```

## Validation

Representative validation commands:

```bash
npm test
node bin/agent-preflight.js check fixtures/vague.md
node bin/agent-preflight.js check fixtures/ready-bug.md --json
node bin/agent-preflight.js upgrade fixtures/vague.md
node bin/agent-preflight.js packet fixtures/ready-bug.md
node bin/agent-preflight.js check fixtures/vague.md --min-score 80
node bin/agent-preflight.js init
```

The CLI is read-only except for explicit `packet --out`, `upgrade --out`, `upgrade --comment`, `upgrade --apply`, `init`, and `fixtures --out` commands.

## Real Linear Workflow

From the repo you want the agent to work in:

```bash
cd /path/to/your/project
LINEAR_API_KEY=... agent-preflight check ENG-123 --source linear
LINEAR_API_KEY=... agent-preflight upgrade ENG-123 --source linear --dry-run
LINEAR_API_KEY=... agent-preflight upgrade ENG-123 --source linear --comment
```

This lets Linear provide the task while the local repo provides grounded context such as package scripts, instruction files, CI config, and inferred candidate files. If the ticket is still missing product intent, Agent Preflight leaves TODOs and human questions instead of inventing answers.
