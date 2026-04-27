function pad(label, width = 30) {
  return `${label}${' '.repeat(Math.max(1, width - label.length))}`;
}

function groupDimensions(dimensions) {
  return {
    pass: dimensions.filter((item) => item.status === 'pass'),
    cautions: dimensions.filter((item) => item.status === 'partial'),
    missing: dimensions.filter((item) => item.status === 'missing')
  };
}

function renderDimension(item) {
  const signal = item.signals && item.signals[0] ? `  ${item.signals[0]}` : '';
  return `  ${pad(item.label)} ${String(item.score).padStart(2)}/${item.maxScore}${signal}`;
}

function renderReport(analysis) {
  const grouped = groupDimensions(analysis.dimensions);
  const lines = [
    `Agent Preflight: ${analysis.readiness} (${analysis.score}/100, confidence ${analysis.confidence.toFixed(2)})`,
    `Recommended action: ${analysis.recommendedAction}`,
    ''
  ];

  if (analysis.hardGates.length) {
    lines.push('Blocked');
    for (const gate of analysis.hardGates) lines.push(`  ${gate.reason}`);
    lines.push('');
  }

  lines.push('Pass');
  lines.push(...(grouped.pass.length ? grouped.pass.map(renderDimension) : ['  None']));
  lines.push('');
  lines.push('Cautions');
  const cautions = [
    ...grouped.cautions.map(renderDimension),
    ...analysis.capsApplied.map((cap) => `  Score capped at ${cap.maxScore}: ${cap.reason}`),
    ...analysis.riskNotes.map((note) => `  ${note}`)
  ];
  lines.push(...(cautions.length ? cautions : ['  None']));
  lines.push('');
  lines.push('Missing');
  lines.push(...(grouped.missing.length ? grouped.missing.map(renderDimension) : ['  None']));
  lines.push('');
  lines.push('Next best fix');
  const suggestions = analysis.dimensions.flatMap((item) => item.suggestions || []);
  const next = analysis.clarifyingQuestions[0] || suggestions[0] || 'Ready to hand off.';
  lines.push(`  ${next}`);
  return `${lines.join('\n')}\n`;
}

module.exports = { renderReport };
