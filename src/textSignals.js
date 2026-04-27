const path = require('node:path');
const { PRIVATE_CONTEXT_DOMAINS } = require('./schema');

function normalize(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function lower(text) {
  return normalize(text).toLowerCase();
}

function hasAny(text, patterns) {
  const value = lower(text);
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(text);
    return value.includes(String(pattern).toLowerCase());
  });
}

function firstHeading(markdown) {
  const match = normalize(markdown).match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function section(markdown, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const sourceLines = normalize(markdown).split('\n');
  let start = -1;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const match = sourceLines[index].match(/^(#{2,4})\s*(.+?)\s*$/);
    if (match && wanted.has(match[2].toLowerCase())) {
      start = index + 1;
      break;
    }
  }

  if (start === -1) return '';
  const collected = [];
  for (let index = start; index < sourceLines.length; index += 1) {
    if (/^#{1,4}\s+/.test(sourceLines[index])) break;
    collected.push(sourceLines[index]);
  }
  return collected.join('\n').trim();
}

function lines(text) {
  return normalize(text).split('\n').map((line) => line.trim()).filter(Boolean);
}

function checklistItems(text) {
  return lines(text)
    .filter((line) => /^[-*]\s+\[[ xX]\]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+\[[ xX]\]\s+/, '').replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim());
}

function extractLinks(text) {
  const links = [];
  const regex = /https?:\/\/[^\s)>\]]+/gi;
  let match;
  while ((match = regex.exec(normalize(text)))) {
    try {
      const url = new URL(match[0]);
      links.push({ url: match[0], host: url.hostname.replace(/^www\./, '') });
    } catch (_) {
      links.push({ url: match[0], host: '' });
    }
  }
  return links;
}

function inaccessibleLinks(text, allowedDomains = []) {
  const allowed = allowedDomains.map((domain) => domain.toLowerCase());
  return extractLinks(text).filter((link) => {
    const host = link.host.toLowerCase();
    if (allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
    return PRIVATE_CONTEXT_DOMAINS.some((domain) => host.includes(domain));
  });
}

function hasContextSummary(text) {
  return hasAny(text, [
    'summary:',
    'context summary',
    'linked context',
    'relevant details',
    'the link says',
    'figma summary',
    'doc summary'
  ]);
}

function filePaths(text) {
  const source = normalize(text);
  const matches = source.match(/(?:^|[\s`(])(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+(?:\.\w+)?(?=$|[\s`),.:])/gm) || [];
  return [...new Set(matches
    .map((match) => match.trim().replace(/^[`(]/, '').replace(/[`),.:]$/, ''))
    .filter((match) => !/^[a-z]+\/[a-z0-9.+-]+$/i.test(match))
    .filter((match) => !match.startsWith('/') || /\.[A-Za-z0-9]+$/.test(match)))];
}

function commands(text) {
  const found = [];
  const regex = /\b(?:npm|pnpm|yarn|bun|node|npx|make|pytest|go test|cargo test|mvn|gradle)\b[^\n`]*/gi;
  let match;
  while ((match = regex.exec(normalize(text)))) {
    found.push(match[0].trim().replace(/[.)]+$/, ''));
  }
  return [...new Set(found)];
}

function likelySymbols(text) {
  const source = normalize(text);
  const symbols = new Set();
  const patterns = [
    /`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)`/g,
    /\b([A-Z][A-Za-z0-9]+(?:View|Page|Controller|Service|Client|Provider|Component))\b/g,
    /\b(GET|POST|PUT|PATCH|DELETE)\s+\/[^\s`]+/g,
    /\b\/api\/[\w./:-]+/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      symbols.add(match[0].replace(/`/g, '').trim());
    }
  }
  return [...symbols];
}

function titleHasActionObject(title) {
  const value = lower(title);
  const action = /\b(fix|add|update|remove|create|implement|prevent|handle|show|hide|validate|document|test|repair|restore|improve)\b/.test(value);
  const words = value.split(/\s+/).filter(Boolean);
  const vagueOnly = /^(fix|improve|update|clean up|make better|investigate|figure out)$/i.test(title.trim());
  return action && words.length >= 4 && !vagueOnly;
}

function relativeFixturePath(file) {
  return path.relative(process.cwd(), file) || file;
}

module.exports = {
  normalize,
  lower,
  hasAny,
  firstHeading,
  section,
  lines,
  checklistItems,
  extractLinks,
  inaccessibleLinks,
  hasContextSummary,
  filePaths,
  commands,
  likelySymbols,
  titleHasActionObject,
  relativeFixturePath
};
