const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdownFile } = require('../src/adapters/markdown');
const { analyze } = require('../src/score');
const { renderUpgradeMarkdown, candidateFiles } = require('../src/upgrade');
const { DEFAULT_CONFIG } = require('../src/schema');
const { root, fixture } = require('./helpers');

test('upgrade draft includes repo-grounded likely files and verification commands', () => {
  const normalized = parseMarkdownFile(fixture('ready-bug.md'), {
    repo: {
      path: root,
      instructionsFiles: [],
      testCommands: ['npm test'],
      packageFiles: ['package.json'],
      ciConfig: []
    },
    agent: { kind: 'codex' }
  });
  const analysis = analyze(normalized, DEFAULT_CONFIG);
  const markdown = renderUpgradeMarkdown(normalized, analysis);
  assert.match(markdown, /## Likely Files \/ Areas/);
  assert.match(markdown, /src\/routes\/invoices.js/);
  assert.match(markdown, /npm test -- invoices/);
});

test('candidateFiles can infer files from repo names without modifying the repo', () => {
  const normalized = {
    issue: {
      title: 'Update upgrade draft rendering',
      description: 'The upgrade draft should include inferred files.'
    },
    repo: { path: root }
  };
  const files = candidateFiles(normalized, { maxFiles: 100 });
  assert.ok(files.some((file) => file.includes('upgrade.js')), files.join(', '));
});
