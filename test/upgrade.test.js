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

test('product spec upgrade draft renders an implementation brief', () => {
  const normalized = parseMarkdownFile(fixture('product-spec.md'), {
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
  assert.match(markdown, /Mode: Product spec implementation brief/);
  assert.match(markdown, /## Problem \/ User Context/);
  assert.match(markdown, /## Requirements/);
  assert.match(markdown, /## Success Metrics \/ Verification/);
  assert.doesNotMatch(markdown, /## Current Behavior/);
});

test('decision document upgrade draft renders a decision brief', () => {
  const normalized = parseMarkdownFile(fixture('decision-doc.md'), {
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
  assert.match(markdown, /Mode: Decision clarification brief/);
  assert.match(markdown, /## Decision Question/);
  assert.match(markdown, /## Options/);
  assert.match(markdown, /## Recommendation/);
  assert.doesNotMatch(markdown, /## Acceptance Criteria/);
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
