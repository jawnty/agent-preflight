const {
  VERSION,
  DEFAULT_RISK_KEYWORDS,
  PRIVATE_CONTEXT_DOMAINS
} = require('./schema');
const { detectArtifact } = require('./artifact');
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
  if (filePaths(body).length || commands(body).length || likelySymbols(body).length) return true;
  if (/^\s*(?:WARNING|ERROR|FATAL|FAIL(?:URE|ED)?|TRACEBACK|EXCEPTION)\b[: ]/im.test(body)) return true;
  return hasAny(body, [
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
  ]);
}

function hasAcceptance(body) {
  return hasSection(body, ['Acceptance Criteria', 'Done When', 'Definition of Done', 'Given/When/Then']);
}

function hasVerification(body) {
  return hasSection(body, ['Verification', 'Testing', 'Test Plan', 'QA']) || commands(body).length > 0;
}

function lineCountInSections(body, names) {
  return names.flatMap((name) => checklistItems(section(body, [name]) || '')).length;
}

function hardGates(issue, config) {
  const gates = [];
  const text = combinedText(issue);
  const value = lower(text);
  const status = lower(issue.status);
  const sensitiveTerm = String.raw`(?:secret|credential|token|api key|private key|ssh key|production database|admin access)`;
  const requestVerb = String.raw`(?:ask|need|requires?|provide|paste|share|give|grant)`;

  if (['done', 'closed', 'cancelled', 'canceled', 'completed'].includes(status) && !config.ignoreState) {
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
  const titled = `${issue.title || ''}\n${body}`;
  let score = 0;

  if (titleHasActionObject(issue.title)) {
    score += 4;
    signals.push('Title contains an action and object');
    evidence.push(issue.title);
  } else {
    suggestions.push('Rewrite the title with an action and concrete object.');
  }
  if (currentBehavior(titled)) {
    score += 4;
    signals.push('Current behavior or problem statement is present');
  } else {
    suggestions.push('Describe what happens today.');
  }
  if (expectedBehavior(titled)) {
    score += 4;
    signals.push('Expected behavior or desired outcome is present');
  } else {
    suggestions.push('Describe what should happen instead.');
  }
  if (impact(titled)) {
    score += 4;
    signals.push('User or business impact is present');
  }
  if (concreteEvidence(titled)) {
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

function scoreSpecProblem(issue) {
  const body = issue.description || '';
  const text = combinedText(issue);
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (hasSection(body, ['Problem', 'Context'])) {
    score += 5;
    signals.push('Problem or context section is present');
  } else {
    suggestions.push('Describe the problem, context, or why this should exist.');
  }
  if (hasSection(body, ['Users', 'User', 'User Story']) || /\b(user|customer|player|admin|team|buyer|persona)\b/i.test(text)) {
    score += 5;
    signals.push('User or customer is named');
  } else {
    suggestions.push('Name the target user or customer.');
  }
  if (impact(text)) {
    score += 5;
    signals.push('Motivation or impact is present');
  }

  return dimension('spec_problem_context', 'Problem and user context', score, 15, signals, [], suggestions);
}

function scoreSpecGoal(issue) {
  const body = issue.description || '';
  const text = combinedText(issue);
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (titleHasActionObject(issue.title) || /^build\s+\w+/i.test(issue.title || '')) {
    score += 5;
    signals.push('Title contains an actionable product objective');
  } else {
    suggestions.push('State the concrete product or capability to build.');
  }
  if (hasSection(body, ['Goal', 'Goals']) || /\b(goal|objective|outcome|build|ship|launch)\b/i.test(text)) {
    score += 5;
    signals.push('Goal or desired outcome is present');
  }
  if (expectedBehavior(text)) {
    score += 5;
    signals.push('Desired behavior is described');
  } else {
    suggestions.push('Describe what should be true when the spec is complete.');
  }

  return dimension('spec_goal', 'Goal clarity', score, 15, signals, [], suggestions);
}

function scoreSpecScope(issue) {
  const body = issue.description || '';
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (hasSection(body, ['Scope', 'In Scope'])) {
    score += 5;
    signals.push('Scope is present');
  } else {
    suggestions.push('Add an in-scope section.');
  }
  if (hasSection(body, ['Non-goals', 'Out of Scope'])) {
    score += 5;
    signals.push('Non-goals or out-of-scope boundaries are present');
  } else {
    suggestions.push('Add non-goals or out-of-scope boundaries.');
  }
  if (hasSection(body, ['Constraints']) || /\b(no backend|local only|must not|do not|constraint)\b/i.test(body)) {
    score += 5;
    signals.push('Constraints are present');
  }

  return dimension('spec_scope', 'Scope and constraints', score, 15, signals, [], suggestions);
}

function scoreSpecRequirements(issue) {
  const body = issue.description || '';
  const text = combinedText(issue);
  const signals = [];
  const evidence = [];
  const suggestions = [];
  let score = 0;
  const items = [
    ...checklistItems(section(body, ['Requirements']) || ''),
    ...checklistItems(section(body, ['Acceptance Criteria']) || ''),
    ...checklistItems(section(body, ['Goal', 'Goals']) || '')
  ];

  if (hasSection(body, ['Requirements', 'Acceptance Criteria', 'Done When'])) {
    score += 7;
    signals.push('Requirements or acceptance section is present');
  } else {
    suggestions.push('Add explicit functional requirements or acceptance criteria.');
  }
  if (items.length >= 3) {
    score += 6;
    signals.push('Multiple requirement items are present');
    evidence.push(...items.slice(0, 4));
  } else if (items.length) {
    score += 3;
    signals.push('Some requirement items are present');
    evidence.push(...items);
  }
  if (/\b(flow|screen|state|input|output|controls?|api|data model|edge case)\b/i.test(text)) {
    score += 4;
    signals.push('Behavior, flow, data, or edge cases are named');
  }
  if (/\b(must|should|can|cannot|does not|supports?|shows?|creates?|updates?)\b/i.test(text)) {
    score += 3;
    signals.push('Requirements use actionable language');
  }

  return dimension('spec_requirements', 'Requirements completeness', score, 20, signals, evidence, suggestions);
}

function scoreSpecSuccess(issue) {
  const body = issue.description || '';
  const text = combinedText(issue);
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (hasSection(body, ['Success Metrics', 'Metrics'])) {
    score += 5;
    signals.push('Success metrics are present');
  } else {
    suggestions.push('Add success metrics or observable validation criteria.');
  }
  if (hasVerification(body)) {
    score += 5;
    signals.push('Verification or test plan is present');
  } else {
    suggestions.push('Add the test command, manual QA flow, or evaluation path.');
  }
  if (hasSection(body, ['Rollout']) || /\b(rollout|launch|release|feature flag|beta|manual qa)\b/i.test(text)) {
    score += 5;
    signals.push('Rollout or release validation is present');
  }

  return dimension('spec_success_verification', 'Success and verification', score, 15, signals, commands(body).slice(0, 4), suggestions);
}

function scoreSpecAgentReadiness(issue, repo) {
  const text = combinedText(issue);
  const paths = filePaths(text);
  const signals = [];
  const evidence = [];
  const suggestions = [];
  let score = 0;

  if (paths.length || likelySymbols(text).length || /\b(web|browser|frontend|backend|server|cli|ios|android|mobile|desktop|terminal|api)\b/i.test(text)) {
    score += 4;
    signals.push('Technical anchors are present');
    evidence.push(...paths.slice(0, 3), ...likelySymbols(text).slice(0, 2));
  } else {
    suggestions.push('Name the platform, repo area, component, or technical surface.');
  }
  if ((repo.testCommands || []).length) {
    score += 2;
    signals.push('Repo exposes commands the agent can use');
    evidence.push(...repo.testCommands.slice(0, 3));
  }
  if ((repo.instructionsFiles || []).length) {
    score += 2;
    signals.push('Repo instructions are present');
    evidence.push(...repo.instructionsFiles.slice(0, 3));
  }
  if (/\b(phase|milestone|ticket|task|decompose|implementation plan|plan first)\b/i.test(text)) {
    score += 2;
    signals.push('Spec includes decomposition or planning cues');
  }

  return dimension('spec_agent_readiness', 'Agent handoff readiness', score, 10, signals, evidence, suggestions);
}

function scoreDecisionContext(issue) {
  const body = issue.description || '';
  const text = combinedText(issue);
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (hasSection(body, ['Context', 'Problem'])) {
    score += 5;
    signals.push('Decision context is present');
  } else {
    suggestions.push('Explain the context or problem behind the decision.');
  }
  if (/\b(decision|choose|decide|whether|question|tradeoff|why)\b/i.test(text)) {
    score += 5;
    signals.push('Decision question is explicit');
  }
  if (impact(text)) {
    score += 5;
    signals.push('Impact or stakes are present');
  }

  return dimension('decision_context', 'Decision context', score, 15, signals, [], suggestions);
}

function scoreDecisionOptions(issue) {
  const body = issue.description || '';
  const options = lineCountInSections(body, ['Options']);
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (hasSection(body, ['Options'])) {
    score += 8;
    signals.push('Options section is present');
  } else {
    suggestions.push('List the options being considered.');
  }
  if (options >= 2 || /\b(option\s+[A-C1-9]|path\s+[A-C])\b/i.test(body)) {
    score += 8;
    signals.push('Multiple options are present');
  }
  if (/\b(bull|bear|pros?|cons?|benefit|cost)\b/i.test(body)) {
    score += 4;
    signals.push('Option pros and cons are included');
  }

  return dimension('decision_options', 'Options coverage', score, 20, signals, [], suggestions);
}

function scoreDecisionTradeoffs(issue) {
  const body = issue.description || '';
  const text = combinedText(issue);
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (hasSection(body, ['Tradeoffs', 'Risks'])) {
    score += 8;
    signals.push('Tradeoffs or risks section is present');
  } else {
    suggestions.push('Add tradeoffs, risks, or downside analysis.');
  }
  if (/\b(risk|cost|constraint|defensibility|complexity|surface area|migration|cold start)\b/i.test(text)) {
    score += 6;
    signals.push('Risks or costs are discussed');
  }
  if (/\b(evidence|source|customer|metric|research|validated|market)\b/i.test(text)) {
    score += 6;
    signals.push('Evidence or validation signals are present');
  }

  return dimension('decision_tradeoffs', 'Tradeoffs and evidence', score, 20, signals, [], suggestions);
}

function scoreDecisionRecommendation(issue) {
  const body = issue.description || '';
  const text = combinedText(issue);
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (hasSection(body, ['Recommendation', 'Decision'])) {
    score += 8;
    signals.push('Recommendation or decision section is present');
  } else {
    suggestions.push('State the recommended direction or decision status.');
  }
  if (/\b(recommend|choose|decided|direction|we should|go with)\b/i.test(text)) {
    score += 7;
    signals.push('Recommended direction is stated');
  }
  if (/\b(owner|approver|sign off|founder|pm|eng)\b/i.test(text)) {
    score += 5;
    signals.push('Decision owner or stakeholder is named');
  }

  return dimension('decision_recommendation', 'Recommendation clarity', score, 20, signals, [], suggestions);
}

function scoreDecisionFollowup(issue) {
  const body = issue.description || '';
  const text = combinedText(issue);
  const signals = [];
  const suggestions = [];
  let score = 0;

  if (hasSection(body, ['Next Steps', 'Open Questions'])) {
    score += 6;
    signals.push('Next steps or open questions are present');
  } else {
    suggestions.push('Add next steps or open questions.');
  }
  if (/\b(ticket|task|prototype|experiment|test|validate|build|follow up)\b/i.test(text)) {
    score += 5;
    signals.push('Follow-up work is named');
  }
  if (hasVerification(body) || /\b(success metric|exit criteria|validation)\b/i.test(text)) {
    score += 4;
    signals.push('Validation path is present');
  }

  return dimension('decision_followup', 'Follow-up readiness', score, 15, signals, [], suggestions);
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

function applyArtifactCaps(rawScore, issue, dimensions, repo, config, artifact) {
  if (!artifact || artifact.kind === 'ticket') return applyCaps(rawScore, issue, dimensions, repo, config);
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
  if (artifact.kind === 'product_spec' && dimensions.some((item) => ['spec_requirements', 'spec_success_verification'].includes(item.id) && item.status === 'missing')) {
    cap(65, 'Spec is missing requirements or validation criteria.');
  }
  if (artifact.kind === 'decision_doc' && dimensions.some((item) => ['decision_options', 'decision_recommendation'].includes(item.id) && item.status === 'missing')) {
    cap(65, 'Decision document is missing options or a recommendation.');
  }
  if (extractLinks(text).length && !hasContextSummary(text)) {
    cap(70, 'Artifact depends on external links without summarized context.');
  }
  const risk = dimensions.find((item) => item.id === 'risk_profile');
  if (risk && risk.score <= 4 && hasAny(text, DEFAULT_RISK_KEYWORDS)) {
    cap(75, 'Risky domain is present without rollback, flag, migration plan, or human review.');
  }

  return { score, capsApplied };
}

function missingFields(dimensions) {
  return dimensions.filter((item) => item.status === 'missing').map((item) => item.id);
}

function clarifyingQuestions(issue, dimensions, gates, artifact = { kind: 'ticket' }) {
  const questions = [];
  const ids = new Set(missingFields(dimensions));
  if (artifact.kind === 'product_spec') {
    if (ids.has('spec_problem_context')) questions.push('Who is this for, and what problem should the agent preserve while building?');
    if (ids.has('spec_goal')) questions.push('What concrete product outcome should exist when this is done?');
    if (ids.has('spec_scope')) questions.push('What is explicitly in scope and out of scope?');
    if (ids.has('spec_requirements')) questions.push('What functional requirements and edge cases must the implementation satisfy?');
    if (ids.has('spec_success_verification')) questions.push('How should the agent or reviewer verify this worked?');
    if (ids.has('spec_agent_readiness')) questions.push('What platform, repo area, or technical surface should the agent target?');
  } else if (artifact.kind === 'decision_doc') {
    if (ids.has('decision_context')) questions.push('What decision is being made, and why does it matter now?');
    if (ids.has('decision_options')) questions.push('What options are being compared?');
    if (ids.has('decision_tradeoffs')) questions.push('What evidence, risks, and tradeoffs should drive the decision?');
    if (ids.has('decision_recommendation')) questions.push('What is the recommended direction and who needs to approve it?');
    if (ids.has('decision_followup')) questions.push('What concrete follow-up tasks should come out of this decision?');
  } else {
    if (ids.has('acceptance_criteria')) questions.push('What observable conditions should be true when this is done?');
    if (ids.has('verification_path')) questions.push('What command or manual flow should the agent use to verify the change?');
    if (!currentBehavior(issue.description || '')) questions.push('What happens today, and where can the agent reproduce it?');
    if (!expectedBehavior(issue.description || '')) questions.push('What should happen instead?');
    if (ids.has('implementation_guidance')) questions.push('Which file, route, component, or API is most likely involved?');
  }
  const risk = dimensions.find((item) => item.id === 'risk_profile');
  if (risk && risk.score <= 4) questions.push('What rollback or review path should the agent follow if this touches a sensitive area?');
  if (gates.some((gate) => gate.id === 'inaccessible_external_context')) questions.push('Can you summarize the linked context directly in the issue?');
  return [...new Set(questions)];
}

function readinessFor(score, gates, dimensions, artifact = { kind: 'ticket' }) {
  if (gates.length) return { readiness: 'blocked', recommendedAction: 'keep_human_owned' };
  if (artifact.kind === 'product_spec') {
    const missing = new Set(missingFields(dimensions));
    if (score >= 80 && !missing.has('spec_agent_readiness')) return { readiness: 'ready', recommendedAction: 'generate_implementation_brief' };
    if (score >= 65) return { readiness: 'ready_with_cautions', recommendedAction: 'ask_for_plan_first' };
    if (score >= 45) return { readiness: 'needs_human_refinement', recommendedAction: 'request_clarification' };
    return { readiness: 'not_ready', recommendedAction: 'request_clarification' };
  }
  if (artifact.kind === 'decision_doc') {
    if (score >= 80) return { readiness: 'ready', recommendedAction: 'derive_followup_tasks' };
    if (score >= 65) return { readiness: 'ready_with_cautions', recommendedAction: 'clarify_decision' };
    if (score >= 45) return { readiness: 'needs_human_refinement', recommendedAction: 'clarify_decision' };
    return { readiness: 'not_ready', recommendedAction: 'request_clarification' };
  }
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
  const artifact = detectArtifact(normalized);
  const gates = hardGates(issue, config);
  const dimensions = artifact.kind === 'product_spec'
    ? [
      scoreSpecProblem(issue),
      scoreSpecGoal(issue),
      scoreSpecScope(issue),
      scoreSpecRequirements(issue),
      scoreSpecSuccess(issue),
      scoreSpecAgentReadiness(issue, repo),
      scoreRisk(issue, config)
    ]
    : artifact.kind === 'decision_doc'
      ? [
        scoreDecisionContext(issue),
        scoreDecisionOptions(issue),
        scoreDecisionTradeoffs(issue),
        scoreDecisionRecommendation(issue),
        scoreDecisionFollowup(issue),
        scoreRisk(issue, config)
      ]
      : [
        scoreTaskClarity(issue),
        scoreScope(issue),
        scoreAcceptance(issue),
        scoreImplementation(issue),
        scoreVerification(issue),
        scoreEnvironment(repo),
        scoreRisk(issue, config)
      ];
  const rawScore = dimensions.reduce((sum, item) => sum + item.score, 0);
  const capped = applyArtifactCaps(rawScore, issue, dimensions, repo, config, artifact);
  const finalScore = gates.length ? 0 : capped.score;
  const band = readinessFor(finalScore, gates, dimensions, artifact);
  const conf = confidence(issue, repo);
  const questions = clarifyingQuestions(issue, dimensions, gates, artifact);
  const riskNotes = dimensions.find((item) => item.id === 'risk_profile').evidence.map((risk) => `Mentions ${risk}.`);
  if (conf < 0.65 && !gates.length) {
    riskNotes.push('Low confidence: ask the agent for a plan before implementation.');
  }
  const notes = [];
  if (config.ignoreState && ['done', 'closed', 'cancelled', 'canceled', 'completed'].includes(lower(issue.status))) {
    notes.push(`Issue status is ${issue.status} — closed/cancelled gate suppressed via --ignore-state.`);
  }

  const result = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    readiness: band.readiness,
    score: finalScore,
    confidence: conf,
    recommendedAction: band.recommendedAction,
    artifact,
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
    notes,
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
