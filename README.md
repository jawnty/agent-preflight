# Agent Preflight

Agent Preflight is a local-first CLI that checks whether a specific issue is ready for an autonomous coding agent. It scores Linear, GitHub, or local Markdown issues deterministically, explains the evidence, generates a handoff packet, and can draft or apply a safer ticket upgrade.

No hosted backend is required. No LLM calls are made.

## Install

```bash
# Global install (binary on your PATH)
npm install -g @jawnty/agent-preflight

# Or run on demand without installing
npx @jawnty/agent-preflight check ENG-123
```

The binary name is `agent-preflight` (the `@jawnty/` prefix is just the npm scope). Then:

```bash
agent-preflight check fixtures/ready-bug.md
agent-preflight upgrade fixtures/vague.md --progress
agent-preflight packet fixtures/ready-bug.md --out packet.md
LINEAR_API_KEY=… agent-preflight check ENG-123
```

To try it without installing globally, copy a sample fixture out:

```bash
npx @jawnty/agent-preflight fixtures --out ./preflight-fixtures
npx @jawnty/agent-preflight check ./preflight-fixtures/ready-bug.md
```

## Develop

```bash
git clone https://github.com/jawnty/agent-preflight.git
cd agent-preflight
npm install
npm test
node bin/agent-preflight.js check fixtures/vague.md
```

## Commands

```bash
agent-preflight check <source> [options]
agent-preflight packet <source> [options]
agent-preflight upgrade <source> [options]
agent-preflight init [options]
agent-preflight fixtures [options]
agent-preflight help [command]
```

For built-in help and version:

```bash
agent-preflight                  # top-level help
agent-preflight --help           # same
agent-preflight help <command>   # per-command help (also: agent-preflight <command> --help)
agent-preflight --version        # version (also: -v)
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

Use `--ignore-state` to preflight a closed, completed, or cancelled ticket — useful for post-morteming an old issue or scoring a cancelled one before reopening it. The closed-issue hard gate is suppressed and a note is surfaced in the report:

```bash
LINEAR_API_KEY=... agent-preflight check ENG-123 --ignore-state
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
node bin/agent-preflight.js upgrade fixtures/vague.md --progress
```

For Linear, `upgrade` can safely post the proposal as a comment, or explicitly replace the issue description:

```bash
LINEAR_API_KEY=... agent-preflight upgrade ENG-123 --comment
LINEAR_API_KEY=... agent-preflight upgrade ENG-123 --apply
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
- `--progress`: print read/scan/score status lines to stderr while keeping stdout machine-readable.
- `--ignore-state`: suppress the closed/completed/cancelled hard gate and score the ticket anyway. The report surfaces a `Notes` line indicating the gate was suppressed.
- `--config <path>`: config file. Defaults to `.agent-preflight.json` if present.

`packet` supports `--out`, `--repo`, `--source`, `--agent`, and `--ignore-state`.

`upgrade` supports:

- `--dry-run`: print the proposed ticket rewrite. This is also the default when no mutation flags are supplied.
- `--out <path>`: write the upgrade draft to a file.
- `--comment`: post the upgrade proposal as a Linear comment. Requires a Linear ticket or Linear URL and `LINEAR_API_KEY`.
- `--apply`: replace the Linear issue description with the proposed upgrade. Requires a Linear ticket or Linear URL and `LINEAR_API_KEY`.
- `--progress`: print read/scan/score/update status lines to stderr.
- `--ignore-state`: suppress the closed/completed/cancelled hard gate (same meaning as on `check`).
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

Hard gates block closed, completed, or cancelled issues, explicit blockers, issues already delegated to another agent, requests for secrets or privileged access, prompt-injection/exfiltration text, and inaccessible private external context without an in-issue summary. Pass `--ignore-state` on `check`/`packet`/`upgrade` to preflight a closed/completed/cancelled ticket anyway (e.g. for post-mortems); other gates are unaffected.

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

It also understands Linear's "Copy as prompt" export format, including `<issue>`,
`<title>`, `<description>`, team name, and copied comment threads. That makes it
usable when you export a ticket from Linear in the browser and save it as a local
`.md` file.

## Optional Remote Sources

GitHub issue URLs are fetched with the public GitHub API. `GITHUB_TOKEN` is used when present.

```bash
node bin/agent-preflight.js check https://github.com/owner/repo/issues/42
```

Linear ticket IDs and Linear issue URLs are auto-detected. Linear API access requires `LINEAR_API_KEY`.

```bash
LINEAR_API_KEY=... node bin/agent-preflight.js check LIN-123
LINEAR_API_KEY=... agent-preflight upgrade LIN-123 --comment
```

Network or auth failures return exit code 3.

## Demo

This repo includes `docs/demo.gif` and `docs/demo.svg`, which show the intended contrast:

1. Run on `fixtures/vague.md`.
2. See `not_ready` with missing acceptance criteria, verification, and technical anchors.
3. Run on `fixtures/ready-bug.md`.
4. See `ready`.
5. Generate an upgrade draft and packet.

`docs/demo.svg` is a static poster frame. `docs/demo.gif` is an animated terminal recording (about 32 s, 296 frames). To re-record the GIF, drive the CLI through a terminal-capture tool such as [`vhs`](https://github.com/charmbracelet/vhs) or [`asciinema`](https://asciinema.org/) + [`agg`](https://github.com/asciinema/agg):

```bash
# vhs (preferred — script-driven, deterministic)
brew install vhs
vhs docs/demo.tape   # if a tape file exists; otherwise author one against the commands above

# asciinema + agg
asciinema rec demo.cast
agg demo.cast docs/demo.gif
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
LINEAR_API_KEY=... node bin/agent-preflight.js check ENG-123 --ignore-state
```

The CLI is read-only except for explicit `packet --out`, `upgrade --out`, `upgrade --comment`, `upgrade --apply`, `init`, and `fixtures --out` commands.

## Real Linear Workflow

From the repo you want the agent to work in:

```bash
cd /path/to/your/project
LINEAR_API_KEY=... agent-preflight check ENG-123
LINEAR_API_KEY=... agent-preflight upgrade ENG-123 --dry-run --progress
LINEAR_API_KEY=... agent-preflight upgrade ENG-123 --comment --progress
```

This lets Linear provide the task while the local repo provides grounded context such as package scripts, instruction files, CI config, and inferred candidate files. If the ticket is still missing product intent, Agent Preflight leaves TODOs and human questions instead of inventing answers.
