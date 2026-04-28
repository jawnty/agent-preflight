const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeFixture } = require('./helpers');

test('vague fixture scores below 45', () => {
  const analysis = analyzeFixture('vague.md');
  assert.equal(analysis.readiness, 'not_ready');
  assert.ok(analysis.score < 45, `expected score below 45, got ${analysis.score}`);
  assert.ok(analysis.missingFields.includes('acceptance_criteria'));
  assert.ok(analysis.missingFields.includes('verification_path'));
});

test('ready bug fixture scores at least 80', () => {
  const analysis = analyzeFixture('ready-bug.md');
  assert.equal(analysis.readiness, 'ready');
  assert.ok(analysis.score >= 80, `expected score >= 80, got ${analysis.score}`);
});

test('good feature fixture scores at least 75', () => {
  const analysis = analyzeFixture('good-feature.md');
  assert.ok(analysis.score >= 75, `expected score >= 75, got ${analysis.score}`);
  assert.notEqual(analysis.readiness, 'not_ready');
});

test('Linear prompt fixture recognizes rich-text sections', () => {
  const analysis = analyzeFixture('linear-prompt.md');
  assert.ok(analysis.score >= 55, `expected score >= 55, got ${analysis.score}`);
  assert.ok(!analysis.missingFields.includes('acceptance_criteria'));
  assert.ok(!analysis.missingFields.includes('verification_path'));
});

test('risky migration fixture applies risk caution or cap', () => {
  const analysis = analyzeFixture('risky-migration.md');
  const risk = analysis.dimensions.find((item) => item.id === 'risk_profile');
  assert.ok(risk.score < risk.maxScore);
  assert.ok(analysis.riskNotes.length > 0 || analysis.capsApplied.length > 0);
});

test('prompt injection fixture returns blocked', () => {
  const analysis = analyzeFixture('prompt-injection.md');
  assert.equal(analysis.readiness, 'blocked');
  assert.equal(analysis.recommendedAction, 'keep_human_owned');
  assert.ok(analysis.hardGates.some((gate) => gate.id === 'prompt_injection_or_exfiltration'));
});

test('external context fixture is blocked when context is inaccessible', () => {
  const analysis = analyzeFixture('external-context.md');
  assert.equal(analysis.readiness, 'blocked');
  assert.ok(analysis.hardGates.some((gate) => gate.id === 'inaccessible_external_context'));
});

test('no-tests fixture has partial verification and suggestions', () => {
  const analysis = analyzeFixture('no-tests.md');
  const verification = analysis.dimensions.find((item) => item.id === 'verification_path');
  assert.equal(verification.status, 'partial');
  assert.ok(verification.suggestions.length > 0);
});
