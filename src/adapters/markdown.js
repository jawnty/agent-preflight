const fs = require('node:fs');
const path = require('node:path');
const { firstHeading, normalize } = require('../textSignals');

function parseScalar(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return trimmed;
}

function parseFrontmatter(markdown) {
  const source = normalize(markdown);
  if (!source.startsWith('---\n')) return { data: {}, body: source };
  const end = source.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: source };

  const data = {};
  const raw = source.slice(4, end).trim();
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (match) data[match[1]] = parseScalar(match[2]);
  }

  return { data, body: source.slice(end + 4).replace(/^\n/, '') };
}

function titleFromBody(body) {
  const heading = firstHeading(body);
  if (heading) return heading;
  return normalize(body).split('\n').map((line) => line.trim()).find(Boolean) || 'Untitled issue';
}

function stripTitle(body, title) {
  const source = normalize(body);
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.replace(new RegExp(`^#\\s+${escaped}\\s*\\n?`, 'm'), '').trim();
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(source, tag) {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeEntities(match[1]).trim() : null;
}

function parseLinearPrompt(body) {
  const source = normalize(body);
  const issueMatch = source.match(/<issue\s+[^>]*identifier=["']([^"']+)["'][^>]*>([\s\S]*?)<\/issue>/i);
  if (!issueMatch) return null;

  const issueId = issueMatch[1].trim();
  const issueXml = issueMatch[2];
  const title = extractTag(issueXml, 'title') || `Linear issue ${issueId}`;
  const description = extractTag(issueXml, 'description') || '';
  const teamMatch = issueXml.match(/<team\s+[^>]*name=["']([^"']+)["'][^>]*\/?>/i);
  const comments = [];
  const commentPattern = /<comment\s+([^>]*)>([\s\S]*?)<\/comment>/gi;
  let commentMatch;

  while ((commentMatch = commentPattern.exec(source))) {
    const attrs = commentMatch[1] || '';
    const authorMatch = attrs.match(/\bauthor=["']([^"']+)["']/i);
    const createdAtMatch = attrs.match(/\bcreated-at=["']([^"']+)["']/i);
    comments.push({
      author: authorMatch ? decodeEntities(authorMatch[1]).trim() : null,
      createdAt: createdAtMatch ? createdAtMatch[1].trim() : null,
      body: decodeEntities(commentMatch[2]).trim()
    });
  }

  return {
    id: issueId,
    title,
    description,
    labels: teamMatch ? [decodeEntities(teamMatch[1]).trim()].filter(Boolean) : [],
    comments
  };
}

function parseMarkdownFile(filePath, context = {}) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    const error = new Error(`Markdown source not found: ${filePath}`);
    error.exitCode = 2;
    throw error;
  }

  const raw = fs.readFileSync(absolute, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const linearPrompt = parseLinearPrompt(body);
  const title = data.title || (linearPrompt && linearPrompt.title) || titleFromBody(body);
  const id = data.id || (linearPrompt && linearPrompt.id) || path.basename(filePath, path.extname(filePath));
  const labels = Array.isArray(data.labels) ? data.labels : String(data.labels || '').split(',').map((item) => item.trim()).filter(Boolean);
  const inferredLabels = labels.length ? labels : linearPrompt ? linearPrompt.labels : [];
  const description = linearPrompt ? linearPrompt.description : stripTitle(body, title);

  return {
    source: {
      type: 'markdown',
      id,
      url: null
    },
    issue: {
      id,
      url: null,
      title,
      description,
      comments: linearPrompt ? linearPrompt.comments : [],
      status: data.status || 'open',
      type: data.type || 'task',
      priority: data.priority || 'medium',
      labels: inferredLabels,
      assignee: data.assignee || null,
      delegatedAgent: data.delegatedAgent || null,
      estimate: data.estimate || null,
      parentId: data.parentId || null,
      blockedBy: Array.isArray(data.blockedBy) ? data.blockedBy : String(data.blockedBy || '').split(',').map((item) => item.trim()).filter(Boolean),
      linkedPrs: [],
      linkedDocs: [],
      attachments: []
    },
    repo: context.repo,
    agent: context.agent
  };
}

module.exports = { parseFrontmatter, parseLinearPrompt, parseMarkdownFile, titleFromBody };
