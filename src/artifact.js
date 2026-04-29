const { lower, section, hasAny } = require('./textSignals');

function combinedText(normalized) {
  const issue = normalized.issue || {};
  return [issue.title, issue.description, ...(issue.comments || []).map((comment) => comment.body || '')].join('\n\n');
}

function hasSection(text, names) {
  return names.some((name) => section(text, [name]));
}

function classifyType(type) {
  const value = lower(type);
  if (['ticket', 'issue', 'task', 'bug', 'feature', 'story'].includes(value)) return 'ticket';
  if (['spec', 'product_spec', 'prd', 'brief', 'requirements', 'build_request'].includes(value)) return 'product_spec';
  if (['decision', 'decision_doc', 'rfc', 'adr', 'research'].includes(value)) return 'decision_doc';
  return null;
}

function detectArtifact(normalized = {}) {
  const issue = normalized.issue || {};
  const text = combinedText(normalized);
  const value = lower(text);
  const sourceType = normalized.source && normalized.source.type;
  const explicit = classifyType(issue.type);

  const signals = [];
  if (explicit) {
    signals.push(`frontmatter type=${issue.type}`);
    return {
      kind: explicit,
      confidence: 0.95,
      goal: goalFor(explicit),
      signals
    };
  }

  let ticket = 0;
  let spec = 0;
  let decision = 0;

  if (sourceType === 'linear' || sourceType === 'github') {
    ticket += 4;
    signals.push(`${sourceType} source defaults to ticket`);
  }
  if (hasSection(text, ['Current Behavior', 'Actual Behavior', 'Expected Behavior', 'Steps to Reproduce', 'Acceptance Criteria', 'Verification'])) {
    ticket += 4;
    signals.push('ticket execution sections detected');
  }
  if (hasAny(text, ['bug', 'repro', '500', 'error', 'failing test', 'acceptance criteria', 'done when'])) ticket += 2;

  if (/\b(spec|prd|requirements?|implementation brief|design brief|product brief)\b/i.test(text)) {
    spec += 4;
    signals.push('spec language detected');
  }
  if (hasSection(text, ['Goal', 'Goals', 'Problem', 'Users', 'User', 'Requirements', 'Success Metrics', 'Metrics', 'Rollout', 'Non-goals'])) {
    spec += 4;
    signals.push('spec planning sections detected');
  }
  if (/^\s*#?\s*build\s+\w+/im.test(text) && !hasAny(text, ['current behavior', 'actual behavior', 'steps to reproduce'])) {
    spec += 3;
    signals.push('high-level build request detected');
  }

  if (/\b(decision|rfc|adr|tradeoffs?|recommendation|options?|strategic question|pivot)\b/i.test(text)) {
    decision += 4;
    signals.push('decision language detected');
  }
  if (hasSection(text, ['Options', 'Tradeoffs', 'Recommendation', 'Decision', 'Decision Needed', 'Open Questions'])) {
    decision += 4;
    signals.push('decision sections detected');
  }

  const scores = [
    ['ticket', ticket],
    ['product_spec', spec],
    ['decision_doc', decision]
  ].sort((a, b) => b[1] - a[1]);
  const [kind, score] = scores[0];
  const [, runnerUp] = scores[1];

  if (score <= 2 || score - runnerUp <= 1) {
    return {
      kind: 'ticket',
      confidence: 0.5,
      goal: goalFor('ticket'),
      signals: ['low-confidence detection; falling back to ticket rubric']
    };
  }

  return {
    kind,
    confidence: Math.min(0.95, Math.round((0.55 + score * 0.06) * 100) / 100),
    goal: goalFor(kind),
    signals
  };
}

function goalFor(kind) {
  if (kind === 'product_spec') return 'improve completeness before decomposition or implementation';
  if (kind === 'decision_doc') return 'clarify decision quality before deriving implementation work';
  return 'improve executability before assigning to a coding agent';
}

module.exports = { detectArtifact };
