const {
  VERSION,
  DEFAULT_RISK_KEYWORDS,
  PRIVATE_CONTEXT_DOMAINS
} = require('./schema');
const {
  normalize,
  lower,
  hasAny,
  section,
  checklistItems,
  inaccessibleLinks,
  hasContextSummary,
  extractLinks,
  filePaths,
  commands,
  likelySymbols,
  titleHasActionObject
} = require('./textSignals');
const { buildPacketObject } = require('./packet');

function dimension(id, label, score, maxScore, signals, evidence, suggestions) {
  const bounded = Math.max(0, Math.min(maxScore, score));
  const ratio = bounded / maxScore;
  return {
    id,
    label,
    score: bounded,
    maxScore,
    status: ratio >= 0.75 ? 'pass' : ratio >= 0.4 ? 'partial' : 'missing',
    signals,
    evidence,
    suggestions
  };
}

function combinedText(issue) {
  return [issue.title, issue.description, ...(issue.comments || []).map((comment) => comment.body || '')].join('\n\n');
}

function hasSection(body, names) {
  return Boolean(section(body, names));
}

function currentBehavior(body) {
  return hasAny(body, [
    'current behavior',
    'actual behavior',
    'today',
    'currently',
    'observed',
    'fails',
    'throws',
    'returns 500',
    'error',
    'bug',
    'problem'
  ]);
}

function expectedBehavior(body) {
  return hasAny(body, [
    'expected behavior',
    'should',
    'must',
    'instead',
    'desired',
    'returns',
    'shows',
    'does not'
  ]);
}

function impact(body) {
  return hasAny(body, [
    'impact',
    'users',
    'customers',
    'blocks',
    'because',
    'so that',
    'revenue',
    'support',
    'regression'
  ]);
}

function concreteEvidence(body) {
  return Boolean(filePaths(body).length || commands(body).length || likelySymbols(body).length || hasAny(body, [
    'stack trace',
    'log',
    'screenshot',
    'repro',
    'steps to reproduce',
    'payload',
    'safari',
    'chrome',
    'firefox',
    'version'
  ]));
}

function hasAcceptance(body) {
  return hasSection(body, ['Acceptance Criteria', 'Done When', 'Definition of Done', 'Given/When/Then']);
}

function hasVerification(body) {
  return hasSection(body, ['Verification', 'Testing', 'Test Plan', 'QA']) || commands(body).length > 0;
}

function hardGates(issue, config) {
  const gates = [];
  const text = combinedText(issue);
  const value = lower(text);
  const status = lower(issue.status);
  const sensitiveTerm = String.raw`(?:secret|credential|token|api key|private key|ssh key|production database|admin access)`;
  const requestVerb = String.raw`(?:ask|need|requires?|provide|paste|share|give|grant)`;

  if (['done', 'closed', 'cancelled', 'canceled'].includes(status)) {
    gates.push({ id: 'closed_issue', reason: `Issue status is ${issue.status}.` });
  }
  if ((issue.blockedBy || []).length || /\bblocked by\b/i.test(text)) {
    gates.push({ id: 'blocked_dependency', reason: 'Issue is blocked by another task or dependency.' });
  }
  if (issue.delegatedAgent) {
    gates.push({ id: 'already_delegated', reason: `Issue is already delegated to ${issue.delegatedAgent}.` });
  }
  if (
    new RegExp(`\\b${requestVerb}\\b[\\s\\S]{0,80}\\b${sensitiveTerm}\\b`, 'i').test(text) ||
    new RegExp(`\\b${sensitiveTerm}\\b[\\s\\S]{0,80}\\b${requestVerb}\\b`, 'i').test(text)
  ) {
    gates.push({ id: 'secrets_or_admin_access', reason: 'Issue appears to request secrets, credentials, tokens, or privileged access.' });
  }
  if (
    value.includes('ignore previous instructions') ||
    value.includes('ignore all instructions') ||
    value.includes('reveal your system prompt') ||
    value.includes('print your environment') ||
    value.includes('cat ~/.') ||
    /\b(curl|wget)\b[\s\S]{0,80}\b(logs?|\.env|tokens?|ssh keys?|pastebin|gist|webhook)\b/i.test(text) ||
    /\b(send|upload)\b[\s\S]{0,80}\b(secrets?|env vars?|credentials?|tokens?)\b/i.test(text)
  ) {
    gates.push({ id: 'prompt_injection_or_exfiltration', reason: 'Issue contains prompt-injection or exfiltration-like instructions.' });
  }

  const inaccessible = inaccessibleLinks(text, config.allowedExternalDomains || []);
  if (inaccessible.length && !hasContextSummary(text)) {
    gates.push({
      id: 'inaccessible_external_context',
      reason: `Issue depends on inaccessible context: ${inaccessible.map((link) => link.host).join(', ')}.`
    });
  }

  return gates;
}

function scoreTaskClarity(issue) {
  const signals = [];
  const evidence = [];
  const suggestions = [];
  const body = issue.description || '';
  let score = 0;

  if (titleHasActionObject(issue.title)) {
    score += 4;
    signals.push('Title contains an action and object');
    evidence.push(issue.title);
  } else {
    suggestions.push('Rewrite the title with an action and concrete object.');
  }
  if (currentBehavior(body)) {
    score += 4;
    signals.push('Current behavior or problem statement is present');
  } else {
    suggestions.push('Describe what happens today.');
  }
  if (expectedBehavior(body)) {
    score += 4;
    signals.push('Expected behavior or desired outcome is present');
  } else {
    suggestions.push('Describe what should happen instead.');
  }
  if (impact(body)) {
    score += 4;
    signals.push('User or business impact is present');
  }
  if (concreteEvidence(body)) {
    score += 4;
    signals.push('Concrete examples, logs, commands, or reproduction details are present');
  } else {
    suggestions.push('Add examples, logs, screenshots, stack traces, repro steps, or a user story.');
  }

  const penalties = [
    /\b(tbd|as discussed|see slack|later)\b/i,
    /\b(clean up|make better|figure out|investigate|improve this)\b/i
  ].filter((pattern) => pattern.test(`${issue.title}\n${body}`)).length;
  if (penalties) {
    score -= Math.min(6, penalties * 3);
    suggestions.push('Replace vague or placeholder language with concrete context.');
  }

  return dimension('task_clarity', 'Task clarity', score, 20, signals, evidence.slice(0, 3), suggestions);
}

function scoreScope(issue) {
  const body = issue.description || '';
  const text = combinedText(issue);
  const labels = (issue.labels || []).map((label) => lower(label));
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (hasSection(body, ['In Scope', 'Out of Scope', 'Scope', 'Non-goals', 'Non-goals / Out of Scope'])) {
    score += 5;
    signals.push('Explicit scope boundaries are present');
  } else {
    suggestions.push('Add in-scope and out-of-scope boundaries.');
  }
  const estimate = String(issue.estimate || '').toUpperCase();
  if (['XS', 'S', 'M', '1', '2', '3'].includes(estimate) || labels.some((label) => /(small|bug|docs|tests|agent-ready)/.test(label))) {
    score += 4;
    signals.push('Estimate or labels indicate a bounded task');
  }
  const paths = filePaths(text);
  if (paths.length > 0 && paths.length <= 5) {
    score += 4;
    signals.push(`Limited file/module surface: ${paths.slice(0, 3).join(', ')}`);
  } else if (paths.length > 5) {
    score += 2;
    signals.push('File surface is named but may be broad');
  }
  if (hasSection(body, ['Non-goals', 'Out of Scope'])) {
    score += 2;
    signals.push('Non-goals are present');
  }

  const broadLine = normalize(text).split('\n').find((line) => {
    return /\b(rewrite (?:the|all|entire|everything)|redesign|overhaul|refactor everything|multiple repos|platform-wide)\b/i.test(line) && !/\b(do not|must not|out of scope|non-goal)\b/i.test(line);
  });
  if (broadLine) {
    score -= 8;
    suggestions.push('Split broad rewrite or platform-wide work into smaller agent-sized tasks.');
  }

  return dimension('scope_boundedness', 'Scope boundedness', score, 15, signals, paths.slice(0, 4), suggestions);
}

function scoreAcceptance(issue) {
  const body = issue.description || '';
  const acceptance = section(body, ['Acceptance Criteria', 'Done When', 'Definition of Done', 'Given/When/Then']);
  const items = checklistItems(acceptance || body);
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (acceptance) {
    score += 6;
    signals.push('Explicit acceptance section is present');
  } else {
    suggestions.push('Add an Acceptance Criteria or Done When section.');
  }
  if (items.length) {
    score += 5;
    signals.push('Checklist or numbered criteria are present');
  }
  if (/\b(must|should|returns?|shows?|does not|given|when|then|visible|created|updated)\b/i.test(acceptance || body)) {
    score += 4;
    signals.push('Criteria use observable, testable language');
  } else {
    suggestions.push('Make criteria observable and testable.');
  }

  return dimension('acceptance_criteria', 'Acceptance criteria', score, 15, signals, items.slice(0, 4), suggestions);
}

function scoreImplementation(issue) {
  const text = combinedText(issue);
  const paths = filePaths(text);
  const symbols = likelySymbols(text);
  const links = extractLinks(text);
  const signals = [];
  const evidence = [];
  const suggestions = [];
  let score = 0;

  if (paths.length) {
    score += 5;
    signals.push('File paths or modules are named');
    evidence.push(...paths.slice(0, 4));
  } else {
    suggestions.push('Name the likely file, route, component, or API involved.');
  }
  if (symbols.length) {
    score += 4;
    signals.push('Code symbols, routes, or APIs are named');
    evidence.push(...symbols.slice(0, 3));
  }
  if (/\b(stack trace|traceback|error log|screenshot|payload|response|request|500|exception)\b/i.test(text)) {
    score += 3;
    signals.push('Logs, stack trace, screenshot, or sample payload are present');
  }
  if (links.length && hasContextSummary(text)) {
    score += 3;
    signals.push('Related links are summarized in the issue body');
  } else if (links.length) {
    suggestions.push('Summarize related links directly in the issue body.');
  }

  return dimension('implementation_guidance', 'Implementation guidance', score, 15, signals, evidence.slice(0, 6), suggestions);
}

function scoreVerification(issue) {
  const body = issue.description || '';
  const verification = section(body, ['Verification', 'Testing', 'Test Plan', 'QA']);
  const foundCommands = commands(body);
  const signals = [];
  const evidence = [];
  const suggestions = [];
  let score = 0;

  if (foundCommands.some((command) => /\b(test|spec)\b/i.test(command))) {
    score += 5;
    signals.push('Automated test command is included');
    evidence.push(...foundCommands.filter((command) => /\b(test|spec)\b/i.test(command)));
  } else {
    suggestions.push('Add an automated test command if one exists.');
  }
  if (verification && /\b(manual|verify|open|click|visit|run through|qa)\b/i.test(verification)) {
    score += 4;
    signals.push('Manual QA steps are included');
  }
  if (/\b(regression|failing test|add a test|coverage|unit test|integration test)\b/i.test(body)) {
    score += 3;
    signals.push('Regression or failing test target is included');
  }
  if (foundCommands.some((command) => /\b(lint|typecheck|check|build)\b/i.test(command))) {
    score += 3;
    signals.push('Build, lint, typecheck, or check command is included');
    evidence.push(...foundCommands.filter((command) => /\b(lint|typecheck|check|build)\b/i.test(command)));
  }

  if (verification && score > 0 && score < 6) {
    score = 6;
    signals.push('Explicit verification section is present');
  }

  return dimension('verification_path', 'Verification path', score, 15, signals, [...new Set(evidence)].slice(0, 5), suggestions);
}

function scoreEnvironment(repo) {
  const signals = [];
  const evidence = [];
  const suggestions = [];
  let score = 0;

  if (repo.instructionsFiles && repo.instructionsFiles.length) {
    score += 3;
    signals.push('Agent instruction file is present');
    evidence.push(...repo.instructionsFiles);
  } else {
    suggestions.push('Add an agent instruction file such as AGENTS.md.');
  }
  if (repo.packageFiles && repo.packageFiles.length) {
    score += 2;
    signals.push('Package/dependency metadata is present');
    evidence.push(...repo.packageFiles);
  }
  if (repo.testCommands && repo.testCommands.length) {
    score += 2;
    signals.push('Repo exposes test/check commands');
    evidence.push(...repo.testCommands);
  }
  if (repo.ciConfig && repo.ciConfig.length) {
    score += 2;
    signals.push('CI config is present');
    evidence.push(...repo.ciConfig);
  }
  if (repo.setupConfigPresent) {
    score += 1;
    signals.push('Devcontainer/setup metadata is present');
  }

  return dimension('agent_environment_readiness', 'Agent environment readiness', score, 10, signals, evidence.slice(0, 8), suggestions);
}

function scoreRisk(issue, config) {
  const text = combinedText(issue);
  const keywords = [...new Set([...(config.riskKeywords || []), ...DEFAULT_RISK_KEYWORDS].map((keyword) => String(keyword).toLowerCase()))];
  const found = keywords.filter((keyword) => new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  const mitigated = /\b(rollback|feature flag|behind a flag|migration plan|dry run|human review|manual approval)\b/i.test(text);
  const signals = [];
  const suggestions = [];
  const evidence = found.slice(0, 8);
  let score = 10;

  if (!found.length) {
    signals.push('No sensitive risk keywords detected');
  } else if (found.length === 1 && hasSection(issue.description || '', ['In Scope', 'Out of Scope', 'Scope'])) {
    score = 7;
    signals.push(`Sensitive domain appears bounded: ${found[0]}`);
  } else if (mitigated) {
    score = 7;
    signals.push('Sensitive domain has rollback, review, flag, or migration mitigation');
  } else {
    score = 4;
    suggestions.push('Add rollback, feature flag, dry-run, migration plan, or human-review guidance.');
  }

  return dimension('risk_profile', 'Risk profile', score, 10, signals, evidence, suggestions);
}

function applyCaps(rawScore, issue, dimensions, repo, config) {
  let score = rawScore;
  const capsApplied = [];
  const text = combinedText(issue);

  function cap(max, reason) {
    if (score > max) {
      score = max;
      capsApplied.push({ maxScore: max, reason });
    }
  }

  if (normalize(`${issue.title}\n${issue.description}`).trim().length < 120) {
    cap(45, 'Title and description are shorter than 120 characters.');
  }
  if (!hasAcceptance(issue.description || '') && !hasVerification(issue.description || '')) {
    cap(60, 'Issue has no acceptance criteria and no verification path.');
  }
  if (extractLinks(text).length && !hasContextSummary(text)) {
    cap(70, 'Issue depends on external links without summarized context.');
  }
  const risk = dimensions.find((item) => item.id === 'risk_profile');
  if (risk && risk.score <= 4 && hasAny(text, DEFAULT_RISK_KEYWORDS)) {
    cap(75, 'Risky domain is present without rollback, flag, migration plan, or human review.');
  }
  if (!(repo.instructionsFiles || []).length && !(repo.testCommands || []).length) {
    cap(80, 'Repository instructions and test commands are both missing.');
  }

  return { score, capsApplied };
}

function missingFields(dimensions) {
  return dimensions.filter((item) => item.status === 'missing').map((item) => item.id);
}

function clarifyingQuestions(issue, dimensions, gates) {
  const questions = [];
  const ids = new Set(missingFields(dimensions));
  if (ids.has('acceptance_criteria')) questions.push('What observable conditions should be true when this is done?');
  if (ids.has('verification_path')) questions.push('What command or manual flow should the agent use to verify the change?');
  if (!currentBehavior(issue.description || '')) questions.push('What happens today, and where can the agent reproduce it?');
  if (!expectedBehavior(issue.description || '')) questions.push('What should happen instead?');
  if (ids.has('implementation_guidance')) questions.push('Which file, route, component, or API is most likely involved?');
  const risk = dimensions.find((item) => item.id === 'risk_profile');
  if (risk && risk.score <= 4) questions.push('What rollback or review path should the agent follow if this touches a sensitive area?');
  if (gates.some((gate) => gate.id === 'inaccessible_external_context')) questions.push('Can you summarize the linked context directly in the issue?');
  return [...new Set(questions)];
}

function readinessFor(score, gates, dimensions) {
  if (gates.length) return { readiness: 'blocked', recommendedAction: 'keep_human_owned' };
  const severeMissing = dimensions.some((item) => ['acceptance_criteria', 'verification_path', 'implementation_guidance'].includes(item.id) && item.status === 'missing');
  if (score >= 80) return { readiness: 'ready', recommendedAction: 'assign_agent' };
  if (score >= 65) return { readiness: 'ready_with_cautions', recommendedAction: 'ask_for_plan_first' };
  if (score >= 45 || (severeMissing && score >= 40)) return { readiness: 'needs_human_refinement', recommendedAction: 'request_clarification' };
  return { readiness: 'not_ready', recommendedAction: 'request_clarification' };
}

function confidence(issue, repo) {
  let value = 0.4;
  if (normalize(issue.description).length > 300) value += 0.15;
  if (hasAcceptance(issue.description || '')) value += 0.15;
  if ((repo.packageFiles || []).length || (repo.instructionsFiles || []).length || (repo.testCommands || []).length) value += 0.1;
  if ((issue.comments || []).length) value += 0.1;
  if ((repo.testCommands || []).length || (repo.instructionsFiles || []).length) value += 0.1;
  return Math.min(1, Math.round(value * 100) / 100);
}

function analyze(normalized, config = {}) {
  const issue = normalized.issue;
  const repo = normalized.repo || {};
  const gates = hardGates(issue, config);
  const dimensions = [
    scoreTaskClarity(issue),
    scoreScope(issue),
    scoreAcceptance(issue),
    scoreImplementation(issue),
    scoreVerification(issue),
    scoreEnvironment(repo),
    scoreRisk(issue, config)
  ];
  const rawScore = dimensions.reduce((sum, item) => sum + item.score, 0);
  const capped = applyCaps(rawScore, issue, dimensions, repo, config);
  const finalScore = gates.length ? 0 : capped.score;
  const band = readinessFor(finalScore, gates, dimensions);
  const conf = confidence(issue, repo);
  const questions = clarifyingQuestions(issue, dimensions, gates);
  const riskNotes = dimensions.find((item) => item.id === 'risk_profile').evidence.map((risk) => `Mentions ${risk}.`);
  if (conf < 0.65 && !gates.length) {
    riskNotes.push('Low confidence: ask the agent for a plan before implementation.');
  }

  const result = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    readiness: band.readiness,
    score: finalScore,
    confidence: conf,
    recommendedAction: band.recommendedAction,
    source: {
      type: normalized.source.type,
      id: normalized.source.id,
      url: normalized.source.url,
      title: issue.title
    },
    hardGates: gates,
    capsApplied: gates.length ? [] : capped.capsApplied,
    dimensions,
    missingFields: missingFields(dimensions),
    clarifyingQuestions: questions,
    riskNotes,
    packet: null,
    repo: {
      path: repo.path || '.',
      instructionsFiles: repo.instructionsFiles || [],
      testCommands: repo.testCommands || [],
      ciConfig: repo.ciConfig || []
    }
  };
  result.packet = buildPacketObject(normalized, result);
  return result;
}

module.exports = {
  analyze,
  hardGates,
  scoreTaskClarity,
  scoreScope,
  scoreAcceptance,
  scoreImplementation,
  scoreVerification,
  scoreEnvironment,
  scoreRisk
};
