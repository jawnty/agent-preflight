const fs = require('node:fs');
const path = require('node:path');
const { filePaths, lines, normalize, section } = require('./textSignals');

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'when',
  'into',
  'your',
  'you',
  'are',
  'can',
  'should',
  'would',
  'could',
  'fix',
  'add',
  'update',
  'make',
  'issue',
  'ticket',
  'bug'
]);

function tokenize(text) {
  return [...new Set(normalize(text)
    .toLowerCase()
    .match(/[a-z][a-z0-9_-]{2,}/g) || [])]
    .filter((token) => !STOP_WORDS.has(token))
    .slice(0, 24);
}

function walkFiles(root, options = {}) {
  const maxFiles = options.maxFiles || 700;
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'vendor']);
  const allowedExtensions = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.css', '.scss', '.html', '.md', '.json',
    '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift'
  ]);
  const files = [];

  function visit(dir) {
    if (files.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.name.startsWith('.') && !['.github'].includes(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) visit(absolute);
        continue;
      }
      const ext = path.extname(entry.name);
      if (allowedExtensions.has(ext)) files.push(absolute);
    }
  }

  visit(root);
  return files;
}

function candidateFiles(normalized, options = {}) {
  const repoPath = path.resolve((normalized.repo && normalized.repo.path) || '.');
  const issueText = `${normalized.issue.title}\n${normalized.issue.description || ''}`;
  const explicit = filePaths(issueText);
  const tokens = tokenize(issueText);
  if (!tokens.length) return explicit.slice(0, 8);

  const scored = [];
  for (const absolute of walkFiles(repoPath, options)) {
    const relative = path.relative(repoPath, absolute);
    const haystack = relative.toLowerCase();
    let pathScore = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) pathScore += 5;
    }
    if (pathScore === 0) continue;
    let bodyScore = 0;
    try {
      const body = fs.readFileSync(absolute, 'utf8').slice(0, 60000).toLowerCase();
      for (const token of tokens) {
        if (body.includes(token)) bodyScore += 1;
      }
    } catch (_) {
      // Keep repo inspection best-effort and read-only.
    }
    scored.push({ file: relative, score: pathScore + bodyScore });
  }

  const inferred = scored
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .map((item) => item.file);
  return [...new Set([...explicit, ...inferred])].slice(0, 8);
}

function sectionOrPlaceholder(title, items, placeholder) {
  if (items && items.length) {
    return `## ${title}\n\n${items.map((item) => `- ${stripListMarker(item)}`).join('\n')}`;
  }
  return `## ${title}\n\n- TODO: ${placeholder}`;
}

function sectionOrNone(title, items) {
  if (items && items.length) {
    return `## ${title}\n\n${items.map((item) => `- ${stripListMarker(item)}`).join('\n')}`;
  }
  return `## ${title}\n\n- None.`;
}

function stripListMarker(item) {
  return String(item).replace(/^\s*[-*]\s+/, '').trim();
}

function sectionLines(description, names) {
  const found = section(description, names);
  return found ? lines(found) : [];
}

function firstAvailableSection(description, groups) {
  for (const names of groups) {
    const found = sectionLines(description, names);
    if (found.length) return found;
  }
  return [];
}

function buildSpecDescription(normalized, analysis) {
  const repo = normalized.repo || {};
  const description = normalized.issue.description || '';
  const packet = analysis.packet || {};
  const likelyFiles = packet.likelyFiles && packet.likelyFiles.length
    ? packet.likelyFiles
    : [];
  const verification = packet.verification && packet.verification.length
    ? packet.verification
    : (repo.testCommands || []).slice(0, 4);
  const problem = firstAvailableSection(description, [['Problem'], ['Context'], ['Users'], ['User'], ['User Story']]);
  const goals = firstAvailableSection(description, [['Goal'], ['Goals']]);
  const requirements = firstAvailableSection(description, [['Requirements'], ['Acceptance Criteria'], ['Done When']]);
  const constraints = firstAvailableSection(description, [['Scope'], ['In Scope'], ['Constraints'], ['Non-goals'], ['Out of Scope']]);
  const success = firstAvailableSection(description, [['Success Metrics'], ['Metrics'], ['Verification'], ['Testing'], ['Test Plan'], ['QA']]);
  const questions = analysis.clarifyingQuestions || [];
  const contextNotes = [];

  if ((repo.instructionsFiles || []).length) contextNotes.push(`Repo instructions detected: ${(repo.instructionsFiles || []).join(', ')}`);
  if ((repo.testCommands || []).length) contextNotes.push(`Detected repo commands: ${(repo.testCommands || []).join(', ')}`);
  if (analysis.riskNotes && analysis.riskNotes.length) contextNotes.push(...analysis.riskNotes);

  return `${[
    `# ${normalized.issue.title}`,
    '## Goal',
    goals.length ? goals.join('\n') : (packet.summary || `TODO: State the concrete product outcome for "${normalized.issue.title}".`),
    sectionOrPlaceholder('Problem / User Context', problem, 'Describe who this is for, what problem it solves, and why it matters.'),
    sectionOrPlaceholder('Requirements', requirements, 'List functional requirements, important states, edge cases, and behaviors.'),
    sectionOrPlaceholder('Scope / Non-Goals / Constraints', constraints, 'List what is in scope, what is out of scope, and any platform or design constraints.'),
    sectionOrPlaceholder('Success Metrics / Verification', [...success, ...verification], 'Add observable success criteria, test commands, manual QA, or evaluation steps.'),
    sectionOrPlaceholder('Implementation Notes / Likely Areas', [...likelyFiles, ...contextNotes], 'Name the platform, repo area, component, service, or API the agent should target.'),
    sectionOrNone('Open Human Questions', questions)
  ].join('\n\n')}\n`;
}

function buildDecisionDescription(normalized, analysis) {
  const description = normalized.issue.description || '';
  const context = firstAvailableSection(description, [['Context'], ['Problem']]);
  const options = firstAvailableSection(description, [['Options']]);
  const tradeoffs = firstAvailableSection(description, [['Tradeoffs'], ['Risks']]);
  const recommendation = firstAvailableSection(description, [['Recommendation'], ['Decision'], ['Decision Needed']]);
  const followup = firstAvailableSection(description, [['Next Steps'], ['Open Questions']]);
  const questions = analysis.clarifyingQuestions || [];

  return `${[
    `# ${normalized.issue.title}`,
    '## Decision Question',
    recommendation.length ? recommendation.join('\n') : `TODO: State the decision to make and the recommended direction.`,
    sectionOrPlaceholder('Context', context, 'Explain why this decision matters now.'),
    sectionOrPlaceholder('Options', options, 'List the options being compared.'),
    sectionOrPlaceholder('Tradeoffs / Evidence', tradeoffs, 'Summarize pros, cons, risks, evidence, and validation signals.'),
    sectionOrPlaceholder('Recommendation', recommendation, 'State the preferred direction, owner, and approval needed.'),
    sectionOrPlaceholder('Follow-Up Tasks', followup, 'List concrete implementation, research, or validation tasks that should follow.'),
    sectionOrNone('Open Human Questions', questions)
  ].join('\n\n')}\n`;
}

function buildProposedDescription(normalized, analysis) {
  if (analysis.artifact && analysis.artifact.kind === 'product_spec') return buildSpecDescription(normalized, analysis);
  if (analysis.artifact && analysis.artifact.kind === 'decision_doc') return buildDecisionDescription(normalized, analysis);

  const packet = analysis.packet;
  const repo = normalized.repo || {};
  const description = normalized.issue.description || '';
  const likelyFiles = packet.likelyFiles && packet.likelyFiles.length
    ? packet.likelyFiles
    : candidateFiles(normalized);
  const verification = packet.verification && packet.verification.length
    ? packet.verification
    : (repo.testCommands || []).slice(0, 4);
  const questions = analysis.clarifyingQuestions || [];
  const contextNotes = [];
  const currentBehavior = sectionLines(description, ['Current Behavior', 'Actual Behavior', 'Problem']);
  const expectedBehavior = sectionLines(description, ['Expected Behavior', 'Desired Behavior']);

  if ((repo.instructionsFiles || []).length) {
    contextNotes.push(`Repo instructions detected: ${(repo.instructionsFiles || []).join(', ')}`);
  }
  if ((repo.testCommands || []).length) {
    contextNotes.push(`Detected repo commands: ${(repo.testCommands || []).join(', ')}`);
  }
  if (analysis.riskNotes && analysis.riskNotes.length) {
    contextNotes.push(...analysis.riskNotes);
  }

  const summary = packet.summary || normalized.issue.title;
  const parts = [
    `# ${normalized.issue.title}`,
    '## Summary',
    summary,
    sectionOrPlaceholder('Current Behavior', currentBehavior, 'Describe what happens today and where to reproduce it.'),
    sectionOrPlaceholder('Expected Behavior', expectedBehavior, 'Describe what should happen instead.'),
    sectionOrPlaceholder('Acceptance Criteria', packet.acceptanceCriteria, 'Add observable, testable done conditions.'),
    sectionOrPlaceholder('Scope / Constraints', packet.constraints, 'List what is in scope and what the agent must not touch.'),
    sectionOrPlaceholder('Likely Files / Areas', likelyFiles, 'Name the file, route, component, service, or API most likely involved.'),
    sectionOrPlaceholder('Verification', verification, 'Add the exact test command or manual QA flow.'),
    sectionOrPlaceholder('Repo Context Detected by Agent Preflight', contextNotes, 'No repo context detected. Run from the target repo or pass --repo.')
  ];

  if (analysis.notes && analysis.notes.length) {
    parts.push(`## Preflight Notes\n\n${analysis.notes.map((note) => `- ${note}`).join('\n')}`);
  }

  parts.push(sectionOrNone('Open Human Questions', questions));

  return `${parts.join('\n\n')}\n`;
}

function renderUpgrade(normalized, analysis) {
  const proposedDescription = buildProposedDescription(normalized, analysis);
  const artifactKind = analysis.artifact && analysis.artifact.kind || 'ticket';
  const modeLine = artifactKind === 'product_spec'
    ? 'This draft turns the spec into an implementation brief and preserves missing product intent as TODOs.'
    : artifactKind === 'decision_doc'
      ? 'This draft turns the decision document into a decision brief plus concrete follow-up tasks.'
      : analysis.readiness === 'ready'
        ? 'This ticket already looks agent-ready; the draft below still normalizes it into a handoff format.'
        : 'This draft fills what can be inferred from the ticket and repo, and marks remaining human questions as TODOs.';

  return {
    proposedDescription,
    commentBody: `## Agent Preflight Upgrade Proposal\n\nPreflight result: **${analysis.readiness}** (${analysis.score}/100, confidence ${analysis.confidence}).\n\n${modeLine}\n\n${proposedDescription}`,
    summary: {
      readiness: analysis.readiness,
      score: analysis.score,
      confidence: analysis.confidence,
      recommendedAction: analysis.recommendedAction,
      missingFields: analysis.missingFields,
      clarifyingQuestions: analysis.clarifyingQuestions
    }
  };
}

function renderUpgradeMarkdown(normalized, analysis) {
  const upgrade = renderUpgrade(normalized, analysis);
  const artifactKind = analysis.artifact && analysis.artifact.kind || 'ticket';
  const mode = artifactKind === 'product_spec'
    ? 'Product spec implementation brief'
    : artifactKind === 'decision_doc'
      ? 'Decision clarification brief'
      : 'Ticket upgrade draft';
  return `# Agent Preflight Upgrade Draft

- Source: ${normalized.source.url || normalized.source.id || normalized.issue.id}
- Mode: ${mode}
- Readiness: ${analysis.readiness} (${analysis.score}/100)
- Recommended action: ${analysis.recommendedAction}

${upgrade.proposedDescription}`;
}

module.exports = {
  buildProposedDescription,
  candidateFiles,
  renderUpgrade,
  renderUpgradeMarkdown,
  tokenize
};
