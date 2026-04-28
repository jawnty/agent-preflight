const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, writeDefaultConfig } = require('./config');
const { detectRepo } = require('./detectRepo');
const { AGENT_PROFILES } = require('./schema');
const { parseMarkdownFile } = require('./adapters/markdown');
const { parseGitHubIssueUrl, fetchGitHubIssue } = require('./adapters/github');
const {
  parseLinearSource,
  fetchLinearIssue,
  commentLinearIssue,
  updateLinearIssueDescription
} = require('./adapters/linear');
const { analyze } = require('./score');
const { renderReport } = require('./report');
const { renderPacket } = require('./packet');
const { renderUpgrade, renderUpgradeMarkdown } = require('./upgrade');

const PKG = require('../package.json');

const BOOLEAN_FLAGS = new Set([
  'json', 'ci', 'no-color', 'force', 'dry-run', 'comment', 'apply',
  'progress', 'verbose', 'ignore-state', 'help', 'version'
]);

const SHORT_FLAGS = { h: 'help', v: 'version' };

const COMMANDS = ['check', 'packet', 'upgrade', 'init', 'fixtures', 'help'];

function topHelp() {
  return `agent-preflight v${PKG.version}
${PKG.description || ''}

USAGE
  agent-preflight <command> [options]
  agent-preflight check fixtures/ready-bug.md
  agent-preflight upgrade ENG-123 --dry-run

COMMANDS
  check <source>      Score an issue and print a readiness report
  packet <source>     Generate an agent handoff packet
  upgrade <source>    Draft a normalized, agent-ready ticket rewrite
  init                Create .agent-preflight.json with default config
  fixtures            List or copy bundled example fixtures
  help [command]      Show help, optionally for a specific command

SOURCES
  Local file:  ./issue.md  |  fixtures/ready-bug.md
  Linear:      ENG-123  |  https://linear.app/<workspace>/issue/ENG-123/...
  GitHub:      https://github.com/<owner>/<repo>/issues/<number>

ENVIRONMENT
  LINEAR_API_KEY    Required for Linear sources.
  GITHUB_TOKEN      Optional. Increases GitHub API rate limits.

EXAMPLES
  agent-preflight check fixtures/vague.md
  agent-preflight check fixtures/ready-bug.md --json --min-score 80
  agent-preflight upgrade fixtures/vague.md --dry-run
  agent-preflight packet ENG-123 --out packet.md
  LINEAR_API_KEY=… agent-preflight check ENG-123 --ignore-state

Run 'agent-preflight help <command>' for command-specific options.
Docs: ${PKG.homepage || 'https://github.com/jawnty/agent-preflight'}`;
}

function commandHelp(command) {
  switch (command) {
    case 'check':
      return `agent-preflight check <source> — score an issue for agent readiness.

The source may be a local Markdown file, a Linear ticket id (e.g. ENG-123)
or URL, or a GitHub issue URL. Adapter is auto-detected unless --source
is given. Linear sources require LINEAR_API_KEY in the environment.

OPTIONS
  --json                  Print JSON instead of the human report
  --ci                    JSON output + threshold-oriented exit behavior
  --min-score <number>    Exit code 1 if score is below threshold
  --progress              Print read/scan/score status to stderr
  --ignore-state          Suppress the closed/completed/cancelled gate so
                          terminal-state tickets can still be scored
  --source <kind>         markdown|github|linear|auto (default: auto)
  --agent <kind>          codex|claude|copilot|cursor|other
  --repo <path>           Repo path for environment checks (default: .)
  --config <path>         Config file (default: .agent-preflight.json)

EXIT CODES
  0  check completed (and met --min-score if provided)
  1  check completed but below threshold
  2  invalid CLI usage or unreadable input
  3  source adapter auth/network failure`;

    case 'packet':
      return `agent-preflight packet <source> — generate an agent handoff packet.

Builds a Markdown packet (summary, acceptance criteria, likely files,
verification, clarifying questions, agent prompt addendum) suitable for
pasting into an agent's context.

OPTIONS
  --out <path>            Write packet to a file (default: stdout)
  --ignore-state          Suppress the closed/completed/cancelled gate
  --source <kind>         markdown|github|linear|auto
  --agent <kind>          codex|claude|copilot|cursor|other
  --repo <path>           Repo path for environment checks`;

    case 'upgrade':
      return `agent-preflight upgrade <source> — draft a normalized ticket rewrite.

By default this is a dry run that prints the rewrite as Markdown. To
mutate a real Linear issue, pass --comment (post as a comment) or --apply
(rewrite the description). Both require a Linear source and LINEAR_API_KEY.

OPTIONS
  --dry-run               Print the proposed rewrite (default)
  --out <path>            Write the upgrade draft to a file
  --comment               Post the proposal as a Linear comment
  --apply                 Replace the Linear issue description
  --progress              Print read/scan/score/update status to stderr
  --ignore-state          Suppress the closed/completed/cancelled gate
  --source <kind>         markdown|github|linear|auto
  --agent <kind>          codex|claude|copilot|cursor|other
  --repo <path>           Repo path for environment checks

SAFETY
  --apply mutates the Linear issue description and is never the default.
  Use --comment first to validate the rewrite end-to-end.`;

    case 'init':
      return `agent-preflight init — create .agent-preflight.json with default config.

OPTIONS
  --config <path>         Path to write (default: .agent-preflight.json)
  --force                 Overwrite an existing config file`;

    case 'fixtures':
      return `agent-preflight fixtures — list or copy bundled example fixtures.

With no flags, prints absolute paths of the bundled fixtures. With --out,
copies them to the target directory so you can experiment locally.

OPTIONS
  --out <path>            Copy fixtures to this directory`;

    case 'help':
    case undefined:
    case '':
      return topHelp();

    default:
      return `Unknown command: ${command}\n\n${topHelp()}`;
  }
}

function usage() {
  return topHelp();
}

function parseArgs(argv) {
  const firstIsFlag = argv[0] && argv[0].startsWith('-');
  const command = firstIsFlag ? undefined : argv[0];
  const start = firstIsFlag ? 0 : 1;
  const positionals = [];
  const flags = {};
  for (let index = start; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg && arg.length === 2 && arg.startsWith('-') && !arg.startsWith('--')) {
      const expanded = SHORT_FLAGS[arg.slice(1)];
      if (expanded && BOOLEAN_FLAGS.has(expanded)) {
        flags[expanded] = true;
        continue;
      }
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      const error = new Error(`Missing value for --${key}\n\nRun 'agent-preflight help' for usage.`);
      error.exitCode = 2;
      throw error;
    }
    flags[key] = value;
    index += 1;
  }
  return { command, source: positionals[0], positionals, flags };
}

function shouldShowProgress(flags) {
  return Boolean((flags.progress || flags.verbose) && !flags.json && !flags.ci);
}

function progress(flags, message) {
  if (shouldShowProgress(flags)) process.stderr.write(`› ${message}\n`);
}

function agentProfile(kind, config) {
  const profile = AGENT_PROFILES[kind] || AGENT_PROFILES.other;
  return { ...profile, kind, allowedDomains: config.allowedExternalDomains || [] };
}

function resolveSourceType(source, explicit) {
  if (explicit && explicit !== 'auto') return explicit;
  if (parseGitHubIssueUrl(source)) return 'github';
  if (parseLinearSource(source)) return 'linear';
  return 'markdown';
}

async function normalizeSource(source, flags, config) {
  const repoPath = flags.repo || config.repoPath || '.';
  const sourceType = resolveSourceType(source, flags.source || 'auto');
  progress(flags, `reading ${sourceType === 'linear' ? 'Linear ticket' : `${sourceType} source`}`);
  const repo = detectRepo(repoPath);
  progress(flags, `scanning repo signals at ${path.resolve(repoPath)}`);
  const agent = agentProfile(flags.agent || config.agent || 'other', config);
  const context = { repo, agent };

  if (sourceType === 'markdown') return parseMarkdownFile(source, context);
  if (sourceType === 'github') return fetchGitHubIssue(source, context);
  if (sourceType === 'linear') return fetchLinearIssue(source, context);

  const error = new Error(`Unsupported source type: ${sourceType}`);
  error.exitCode = 2;
  throw error;
}

async function commandCheck(source, flags) {
  if (!source) {
    const error = new Error(`Missing source.\n${usage()}`);
    error.exitCode = 2;
    throw error;
  }
  const { config } = loadConfig(flags.config);
  const normalized = await normalizeSource(source, flags, config);
  progress(flags, 'scoring readiness');
  const analysis = analyze(normalized, { ...config, ignoreState: Boolean(flags['ignore-state']) });
  const minScore = flags['min-score'] === undefined ? (flags.ci ? config.minScore : null) : Number(flags['min-score']);

  if (flags.json || flags.ci) {
    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
  } else {
    process.stdout.write(renderReport(analysis));
  }

  if (minScore !== null && minScore !== undefined && analysis.score < minScore) {
    process.exitCode = 1;
  }
}

async function commandPacket(source, flags) {
  if (!source) {
    const error = new Error(`Missing source.\n${usage()}`);
    error.exitCode = 2;
    throw error;
  }
  const { config } = loadConfig(flags.config);
  const normalized = await normalizeSource(source, flags, config);
  progress(flags, 'scoring readiness');
  const analysis = analyze(normalized, { ...config, ignoreState: Boolean(flags['ignore-state']) });
  const markdown = renderPacket(normalized, analysis);
  if (flags.out) {
    fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
    fs.writeFileSync(flags.out, markdown);
    process.stdout.write(`Wrote ${flags.out}\n`);
  } else {
    process.stdout.write(markdown);
  }
}

async function commandUpgrade(source, flags) {
  if (!source) {
    const error = new Error(`Missing source.\n${usage()}`);
    error.exitCode = 2;
    throw error;
  }
  const { config } = loadConfig(flags.config);
  const normalized = await normalizeSource(source, flags, config);
  progress(flags, 'scoring readiness');
  const analysis = analyze(normalized, { ...config, ignoreState: Boolean(flags['ignore-state']) });
  progress(flags, 'building upgrade draft');
  const upgrade = renderUpgrade(normalized, analysis);
  const markdown = renderUpgradeMarkdown(normalized, analysis);

  if (flags.out) {
    fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
    fs.writeFileSync(flags.out, markdown);
    process.stdout.write(`Wrote ${flags.out}\n`);
  }

  if (flags.comment || flags.apply) {
    if (normalized.source.type !== 'linear') {
      const error = new Error('--comment and --apply currently require a Linear source.');
      error.exitCode = 2;
      throw error;
    }
  }

  if (flags.comment) {
    progress(flags, 'posting proposal to Linear');
    const result = await commentLinearIssue(normalized, upgrade.commentBody);
    process.stdout.write(`Posted Linear comment${result && result.comment && result.comment.url ? `: ${result.comment.url}` : '.'}\n`);
  }

  if (flags.apply) {
    progress(flags, 'updating Linear issue description');
    const result = await updateLinearIssueDescription(normalized, upgrade.proposedDescription);
    process.stdout.write(`Updated Linear issue${result && result.issue && result.issue.url ? `: ${result.issue.url}` : '.'}\n`);
  }

  if ((!flags.comment && !flags.apply && !flags.out) || flags['dry-run']) {
    process.stdout.write(markdown);
  }
}

function commandInit(flags) {
  const filePath = writeDefaultConfig(flags.config, { force: flags.force });
  process.stdout.write(`Wrote ${filePath}\n`);
}

function commandFixtures(flags) {
  const sourceDir = path.resolve(__dirname, '..', 'fixtures');
  const fixtures = fs.readdirSync(sourceDir).filter((file) => file.endsWith('.md')).sort();
  if (!flags.out) {
    process.stdout.write(fixtures.map((file) => path.join(sourceDir, file)).join('\n') + '\n');
    return;
  }

  const target = path.resolve(flags.out);
  fs.mkdirSync(target, { recursive: true });
  for (const fixture of fixtures) {
    fs.copyFileSync(path.join(sourceDir, fixture), path.join(target, fixture));
  }
  process.stdout.write(`Copied ${fixtures.length} fixtures to ${target}\n`);
}

async function run(argv) {
  const { command, source, positionals, flags } = parseArgs(argv);

  if (flags.version) {
    process.stdout.write(`agent-preflight ${PKG.version}\n`);
    return;
  }

  if (!command) {
    process.stdout.write(`${topHelp()}\n`);
    return;
  }

  if (command === 'help') {
    const topic = positionals[0];
    process.stdout.write(`${commandHelp(topic)}\n`);
    return;
  }

  if (flags.help) {
    if (COMMANDS.includes(command)) {
      process.stdout.write(`${commandHelp(command)}\n`);
      return;
    }
    process.stdout.write(`${topHelp()}\n`);
    return;
  }

  if (command === 'check') return commandCheck(source, flags);
  if (command === 'packet') return commandPacket(source, flags);
  if (command === 'upgrade') return commandUpgrade(source, flags);
  if (command === 'init') return commandInit(flags);
  if (command === 'fixtures') return commandFixtures(flags);

  const error = new Error(`Unknown command: ${command}\n\nRun 'agent-preflight help' for usage.`);
  error.exitCode = 2;
  throw error;
}

module.exports = {
  run,
  parseArgs,
  resolveSourceType,
  normalizeSource,
  commandUpgrade
};
