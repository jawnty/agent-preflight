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

function parseMarkdownFile(filePath, context = {}) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    const error = new Error(`Markdown source not found: ${filePath}`);
    error.exitCode = 2;
    throw error;
  }

  const raw = fs.readFileSync(absolute, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const title = data.title || titleFromBody(body);
  const id = data.id || path.basename(filePath, path.extname(filePath));
  const labels = Array.isArray(data.labels) ? data.labels : String(data.labels || '').split(',').map((item) => item.trim()).filter(Boolean);

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
      description: stripTitle(body, title),
      comments: [],
      status: data.status || 'open',
      type: data.type || 'task',
      priority: data.priority || 'medium',
      labels,
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

module.exports = { parseFrontmatter, parseMarkdownFile, titleFromBody };
