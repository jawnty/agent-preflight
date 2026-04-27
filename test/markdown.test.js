const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdownFile } = require('../src/adapters/markdown');
const { fixture } = require('./helpers');

test('markdown parser extracts title, frontmatter, labels, and body', () => {
  const normalized = parseMarkdownFile(fixture('ready-bug.md'), { repo: {}, agent: {} });
  assert.equal(normalized.issue.id, 'ready-bug');
  assert.equal(normalized.issue.title, 'Fix invoice PDF download 500 on Safari');
  assert.equal(normalized.issue.status, 'open');
  assert.equal(normalized.issue.type, 'bug');
  assert.deepEqual(normalized.issue.labels, ['bug', 'agent-ready', 'small']);
  assert.match(normalized.issue.description, /Customers using Safari 17/);
  assert.doesNotMatch(normalized.issue.description, /^# Fix invoice/m);
});
