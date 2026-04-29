const test = require('node:test');
const assert = require('node:assert/strict');
const { detectRepo } = require('../src/detectRepo');
const { parseMarkdownFile } = require('../src/adapters/markdown');
const { analyze } = require('../src/score');
const { renderPacket } = require('../src/packet');
const { DEFAULT_CONFIG, AGENT_PROFILES } = require('../src/schema');
const { root, fixture } = require('./helpers');

test('packet renderer prints summary, criteria, verification, and questions', () => {
  const normalized = parseMarkdownFile(fixture('ready-bug.md'), {
    repo: detectRepo(root),
    agent: AGENT_PROFILES.codex
  });
  const analysis = analyze(normalized, DEFAULT_CONFIG);
  const packet = renderPacket(normalized, analysis);
  assert.match(packet, /## Task Summary/);
  assert.match(packet, /Safari 17 can download/);
  assert.match(packet, /npm test -- invoices/);
  assert.match(packet, /## Clarifying Questions/);
});

test('product spec packet renders spec-oriented handoff sections', () => {
  const normalized = parseMarkdownFile(fixture('product-spec.md'), {
    repo: detectRepo(root),
    agent: AGENT_PROFILES.codex
  });
  const analysis = analyze(normalized, DEFAULT_CONFIG);
  const packet = renderPacket(normalized, analysis);
  assert.match(packet, /Artifact: product_spec/);
  assert.match(packet, /## Spec Summary/);
  assert.match(packet, /## Requirements/);
  assert.match(packet, /## Success \/ Verification/);
  assert.match(packet, /Treat this as an implementation brief/);
});

test('decision packet warns agents not to implement directly', () => {
  const normalized = parseMarkdownFile(fixture('decision-doc.md'), {
    repo: detectRepo(root),
    agent: AGENT_PROFILES.codex
  });
  const analysis = analyze(normalized, DEFAULT_CONFIG);
  const packet = renderPacket(normalized, analysis);
  assert.match(packet, /Artifact: decision_doc/);
  assert.match(packet, /## Decision Summary/);
  assert.match(packet, /Do not implement directly/);
});
