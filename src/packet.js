const {
  normalize,
  section,
  checklistItems,
  filePaths,
  commands,
  lines
} = require('./textSignals');

function firstParagraph(text) {
  return normalize(text)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !/^#{1,6}\s+/.test(part) && !/^[-*]\s+/.test(part)) || '';
}

function extractAcceptance(description) {
  const explicit = section(description, ['Acceptance Criteria', 'Done When', 'Definition of Done', 'Given/When/Then']);
  return checklistItems(explicit || '').length ? checklistItems(explicit) : checklistItems(explicit || description).slice(0, 5);
}

function extractConstraints(description) {
  const constraints = [];
  const explicit = section(description, ['Constraints', 'Out of Scope', 'Non-goals']);
  if (explicit) constraints.push(...checklistItems(explicit), ...lines(explicit).filter((line) => /\b(do not|must not|only|avoid)\b/i.test(line)));
  constraints.push(...lines(description).filter((line) => {
    if (/^#{1,6}\s+/.test(line) || /^[-*]\s+\[[ xX]\]/.test(line)) return false;
    return /\b(do not|must not|keep .* scoped)\b/i.test(line);
  }));
  return [...new Set(constraints.map((item) => item.replace(/^[-*]\s+/, '').trim()).filter(Boolean))].slice(0, 8);
}

function extractVerification(description, repo) {
  const explicit = section(description, ['Verification', 'Testing', 'Test Plan', 'QA']);
  const commandList = commands(explicit || description);
  const manual = lines(explicit).filter((line) => !commands(line).length).map((line) => line.replace(/^[-*]\s+/, '').trim());
  const repoCommands = repo && repo.testCommands ? repo.testCommands.slice(0, 2) : [];
  return [...new Set([...commandList, ...manual, ...repoCommands])].filter(Boolean).slice(0, 8);
}

function buildAgentPrompt(normalized, analysis) {
  const likelyFiles = analysis.packet && analysis.packet.likelyFiles || filePaths(normalized.issue.description || '');
  const scopeHint = likelyFiles.length ? ` Keep the change scoped to ${likelyFiles.slice(0, 4).join(', ')} when possible.` : ' Keep the change scoped to the issue.';
  return `Follow repository instructions.${scopeHint} Add or update tests for changed behavior. If the likely root cause differs from the issue, stop after investigation and report a plan before implementing.`;
}

function buildPacketObject(normalized, analysis) {
  const issue = normalized.issue;
  const description = issue.description || '';
  const acceptanceCriteria = extractAcceptance(description);
  const verification = extractVerification(description, normalized.repo || {});
  const likelyFiles = filePaths(description).slice(0, 8);
  const packet = {
    summary: firstParagraph(description) || issue.title,
    acceptanceCriteria,
    constraints: extractConstraints(description),
    likelyFiles,
    verification,
    questions: analysis.clarifyingQuestions || [],
    agentPrompt: ''
  };
  packet.agentPrompt = buildAgentPrompt(normalized, { ...analysis, packet });
  return packet;
}

function renderPacket(normalized, analysis) {
  const packet = analysis.packet || buildPacketObject(normalized, analysis);
  const sourceLabel = normalized.source.url || normalized.source.id || normalized.issue.id;

  function list(items, fallback = 'None.') {
    if (!items || !items.length) return `- ${fallback}`;
    return items.map((item) => `- ${item}`).join('\n');
  }

  return `# Agent Handoff Packet

## Source

- Title: ${normalized.issue.title}
- Source: ${sourceLabel}
- Readiness: ${analysis.readiness}, ${analysis.score}/100
- Recommended action: ${analysis.recommendedAction}

## Task Summary

${packet.summary}

## Acceptance Criteria

${list(packet.acceptanceCriteria)}

## Constraints

${list(packet.constraints)}

## Likely Files

${list(packet.likelyFiles)}

## Verification

${list(packet.verification)}

## Clarifying Questions

${list(packet.questions)}

## Agent Prompt Addendum

${packet.agentPrompt}
`;
}

module.exports = {
  buildPacketObject,
  renderPacket,
  extractAcceptance,
  extractVerification
};
