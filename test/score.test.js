const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeFixture } = require('./helpers');
const { analyze } = require('../src/score');
const { DEFAULT_CONFIG } = require('../src/schema');

function syntheticReady(status) {
  return {
    source: { type: 'markdown', id: 'synthetic', url: null },
    issue: {
      id: 'synthetic',
      title: 'Add a parameter to the rate limiter',
      description: '## Acceptance Criteria\n- limiter accepts a burst arg\n- existing tests still pass\n\n## Verification\n```\nnpm test\n```\n\nFiles to touch: src/rateLimiter.js. Existing function: createLimiter().',
      comments: [],
      status,
      type: 'task',
      priority: 'medium',
      labels: [],
      assignee: null,
      delegatedAgent: null,
      blockedBy: [],
      linkedPrs: [],
      linkedDocs: [],
      attachments: []
    },
    repo: { path: '.', instructionsFiles: ['README.md'], testCommands: ['npm test'], ciConfig: [] },
    agent: { kind: 'codex', allowedDomains: [] }
  };
}

function syntheticMarkdown(title, description) {
  return {
    source: { type: 'markdown', id: 'synthetic', url: null },
    issue: {
      id: 'synthetic',
      title,
      description,
      comments: [],
      status: 'open',
      type: null,
      priority: null,
      labels: [],
      assignee: null,
      delegatedAgent: null,
      blockedBy: [],
      linkedPrs: [],
      linkedDocs: [],
      attachments: []
    },
    repo: { path: '.', instructionsFiles: [], testCommands: ['npm test'], ciConfig: [] },
    agent: { kind: 'codex', allowedDomains: [] }
  };
}

test('vague fixture scores below 45', () => {
  const analysis = analyzeFixture('vague.md');
  assert.equal(analysis.readiness, 'not_ready');
  assert.ok(analysis.score < 45, `expected score below 45, got ${analysis.score}`);
  assert.ok(analysis.missingFields.includes('acceptance_criteria'));
  assert.ok(analysis.missingFields.includes('verification_path'));
});

test('ready bug fixture scores at least 80', () => {
  const analysis = analyzeFixture('ready-bug.md');
  assert.equal(analysis.artifact.kind, 'ticket');
  assert.equal(analysis.readiness, 'ready');
  assert.equal(analysis.recommendedAction, 'assign_agent');
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

test('high-level build request is treated as an under-specified product spec', () => {
  const analysis = analyzeFixture('build-tetris.md');
  assert.equal(analysis.artifact.kind, 'product_spec');
  assert.equal(analysis.readiness, 'not_ready');
  assert.equal(analysis.recommendedAction, 'request_clarification');
  assert.ok(analysis.missingFields.includes('spec_requirements'));
  assert.ok(analysis.missingFields.includes('spec_success_verification'));
  assert.ok(analysis.clarifyingQuestions.some((question) => /requirements/i.test(question)));
});

test('frontmatter-free build request can still infer product spec', () => {
  const analysis = analyze(syntheticMarkdown('Build Tetris', 'Build a Tetris game.'), DEFAULT_CONFIG);
  assert.equal(analysis.artifact.kind, 'product_spec');
  assert.equal(analysis.readiness, 'not_ready');
  assert.ok(analysis.artifact.confidence > 0.5);
});

test('complete product spec is ready for implementation briefing', () => {
  const analysis = analyzeFixture('product-spec.md');
  assert.equal(analysis.artifact.kind, 'product_spec');
  assert.equal(analysis.readiness, 'ready');
  assert.equal(analysis.recommendedAction, 'generate_implementation_brief');
  assert.ok(analysis.score >= 80, `expected score >= 80, got ${analysis.score}`);
});

test('decision document is not treated as a direct implementation ticket', () => {
  const analysis = analyzeFixture('decision-doc.md');
  assert.equal(analysis.artifact.kind, 'decision_doc');
  assert.notEqual(analysis.recommendedAction, 'assign_agent');
  assert.ok(['clarify_decision', 'derive_followup_tasks'].includes(analysis.recommendedAction));
  assert.ok(analysis.score >= 60, `expected score >= 60, got ${analysis.score}`);
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

test('closed issue is blocked by default', () => {
  const analysis = analyze(syntheticReady('completed'), DEFAULT_CONFIG);
  assert.equal(analysis.readiness, 'blocked');
  assert.ok(analysis.hardGates.some((gate) => gate.id === 'closed_issue'));
});

test('--ignore-state suppresses closed gate and surfaces a separate note', () => {
  const analysis = analyze(syntheticReady('completed'), { ...DEFAULT_CONFIG, ignoreState: true });
  assert.notEqual(analysis.readiness, 'blocked');
  assert.ok(!analysis.hardGates.some((gate) => gate.id === 'closed_issue'));
  assert.ok(analysis.notes.some((note) => /ignore-state/i.test(note)));
  assert.ok(!analysis.riskNotes.some((note) => /ignore-state/i.test(note)));
});

test('--ignore-state does not suppress other gates (prompt injection still blocks)', () => {
  const analysis = analyzeFixture('prompt-injection.md', { ignoreState: true });
  assert.equal(analysis.readiness, 'blocked');
  assert.ok(analysis.hardGates.some((gate) => gate.id === 'prompt_injection_or_exfiltration'));
});
