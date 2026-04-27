const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { root, fixture } = require('./helpers');

function cli(args, options = {}) {
  return spawnSync(process.execPath, [path.join(root, 'bin', 'agent-preflight.js'), ...args], {
    cwd: options.cwd || root,
    encoding: 'utf8'
  });
}

test('check --json output is parseable and contains required top-level fields', () => {
  const result = cli(['check', fixture('ready-bug.md'), '--json']);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  for (const key of ['version', 'generatedAt', 'readiness', 'score', 'confidence', 'recommendedAction', 'source', 'hardGates', 'capsApplied', 'dimensions', 'missingFields', 'clarifyingQuestions', 'riskNotes', 'packet', 'repo']) {
    assert.ok(Object.hasOwn(parsed, key), `missing ${key}`);
  }
});

test('packet command prints Markdown handoff packet', () => {
  const result = cli(['packet', fixture('ready-bug.md')]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Agent Handoff Packet/);
  assert.match(result.stdout, /## Verification/);
  assert.match(result.stdout, /## Clarifying Questions/);
});

test('upgrade command prints a safe dry-run ticket rewrite by default', () => {
  const result = cli(['upgrade', fixture('vague.md')]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^# Agent Preflight Upgrade Draft/);
  assert.match(result.stdout, /## Acceptance Criteria/);
  assert.match(result.stdout, /TODO: Add observable, testable done conditions/);
  assert.match(result.stdout, /## Open Human Questions/);
});

test('progress mode emits status lines to stderr without corrupting stdout', () => {
  const result = cli(['upgrade', fixture('vague.md'), '--progress']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /reading markdown source/);
  assert.match(result.stderr, /scanning repo signals/);
  assert.match(result.stderr, /scoring readiness/);
  assert.match(result.stderr, /building upgrade draft/);
  assert.match(result.stdout, /^# Agent Preflight Upgrade Draft/);
});

test('upgrade --out writes a draft file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-preflight-upgrade-'));
  const out = path.join(tmp, 'upgrade.md');
  const result = cli(['upgrade', fixture('ready-bug.md'), '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Wrote/);
  assert.match(fs.readFileSync(out, 'utf8'), /# Agent Preflight Upgrade Draft/);
});

test('upgrade --comment requires a Linear source', () => {
  const result = cli(['upgrade', fixture('ready-bug.md'), '--comment']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Linear source/);
});

test('--min-score exits with code 1 when threshold is not met', () => {
  const result = cli(['check', fixture('vague.md'), '--min-score', '80']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /not_ready/);
});

test('init writes config without overwriting unless --force is supplied', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-preflight-'));
  const first = cli(['init'], { cwd: tmp });
  assert.equal(first.status, 0, first.stderr);
  assert.ok(fs.existsSync(path.join(tmp, '.agent-preflight.json')));

  const second = cli(['init'], { cwd: tmp });
  assert.equal(second.status, 2);
  assert.match(second.stderr, /already exists/);

  const forced = cli(['init', '--force'], { cwd: tmp });
  assert.equal(forced.status, 0, forced.stderr);
});
