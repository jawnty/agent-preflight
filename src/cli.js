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

function usage() {
  return `Usage:
  agent-preflight check <source> [--json] [--repo <path>] [--source <markdown|github|linear|auto>] [--agent <kind>] [--min-score <number>] [--ci]
  agent-preflight packet <source> [--out <path>] [--repo <path>] [--source <markdown|github|linear|auto>] [--agent <kind>]
  agent-preflight upgrade <source> [--dry-run] [--comment] [--apply] [--out <path>] [--repo <path>] [--source <markdown|github|linear|auto>] [--agent <kind>]
  agent-preflight init [--config <path>] [--force]
  agent-preflight fixtures [--out <path>]`;
}

function parseArgs(argv) {
  const command = argv[0];
  const positionals = [];
  const flags = {};
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (['json', 'ci', 'no-color', 'force', 'dry-run', 'comment', 'apply'].includes(key)) {
      flags[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      const error = new Error(`Missing value for --${key}\n${usage()}`);
      error.exitCode = 2;
      throw error;
    }
    flags[key] = value;
    index += 1;
  }
  return { command, source: positionals[0], flags };
}

function agentProfile(kind, config) {
  const profile = AGENT_PROFILES[kind] || AGENT_PROFILES.other;
  return { ...profile, kind, allowedDomains: config.allowedExternalDomains || [] };
}

function resolveSourceType(source, explicit) {
  if (explicit && explicit !== 'auto') return explicit;
  if (parseGitHubIssueUrl(source)) return 'github';
  if (parseLinearSource(source) && /^https:\/\/linear\.app\//i.test(source)) return 'linear';
  return 'markdown';
}

async function normalizeSource(source, flags, config) {
  const repoPath = flags.repo || config.repoPath || '.';
  const repo = detectRepo(repoPath);
  const agent = agentProfile(flags.agent || config.agent || 'other', config);
  const sourceType = resolveSourceType(source, flags.source || 'auto');
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
  const analysis = analyze(normalized, config);
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
  const analysis = analyze(normalized, config);
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
  const analysis = analyze(normalized, config);
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
    const result = await commentLinearIssue(normalized, upgrade.commentBody);
    process.stdout.write(`Posted Linear comment${result && result.comment && result.comment.url ? `: ${result.comment.url}` : '.'}\n`);
  }

  if (flags.apply) {
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
  const { command, source, flags } = parseArgs(argv);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === 'check') return commandCheck(source, flags);
  if (command === 'packet') return commandPacket(source, flags);
  if (command === 'upgrade') return commandUpgrade(source, flags);
  if (command === 'init') return commandInit(flags);
  if (command === 'fixtures') return commandFixtures(flags);

  const error = new Error(`Unknown command: ${command}\n${usage()}`);
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
