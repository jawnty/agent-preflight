const path = require('node:path');
const { detectRepo } = require('../src/detectRepo');
const { parseMarkdownFile } = require('../src/adapters/markdown');
const { analyze } = require('../src/score');
const { DEFAULT_CONFIG, AGENT_PROFILES } = require('../src/schema');

const root = path.resolve(__dirname, '..');

function fixture(name) {
  return path.join(root, 'fixtures', name);
}

function analyzeFixture(name, overrides = {}) {
  const repo = detectRepo(root);
  const normalized = parseMarkdownFile(fixture(name), {
    repo,
    agent: { ...AGENT_PROFILES.codex, allowedDomains: [] }
  });
  return analyze(normalized, { ...DEFAULT_CONFIG, ...overrides });
}

module.exports = { root, fixture, analyzeFixture };
