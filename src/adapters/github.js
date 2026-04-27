function parseGitHubIssueUrl(source) {
  const match = String(source).match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

async function fetchJson(url, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'agent-preflight-prototype'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const error = new Error(`GitHub API request failed (${response.status}) for ${url}`);
    error.exitCode = 3;
    throw error;
  }
  return response.json();
}

async function fetchGitHubIssue(source, context = {}) {
  const parsed = parseGitHubIssueUrl(source);
  if (!parsed) {
    const error = new Error(`Invalid GitHub issue URL: ${source}`);
    error.exitCode = 2;
    throw error;
  }

  const token = process.env.GITHUB_TOKEN;
  const base = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`;
  const issue = await fetchJson(base, token);
  let comments = [];
  try {
    comments = await fetchJson(`${base}/comments`, token);
  } catch (_) {
    comments = [];
  }

  return {
    source: { type: 'github', id: `${parsed.owner}/${parsed.repo}#${parsed.number}`, url: source },
    issue: {
      id: String(issue.number),
      url: issue.html_url,
      title: issue.title,
      description: issue.body || '',
      comments: comments.map((comment) => ({ author: comment.user && comment.user.login, body: comment.body || '' })),
      status: issue.state,
      type: issue.pull_request ? 'pull_request' : 'issue',
      priority: 'medium',
      labels: (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean),
      assignee: issue.assignee && issue.assignee.login,
      delegatedAgent: null,
      estimate: null,
      parentId: null,
      blockedBy: [],
      linkedPrs: [],
      linkedDocs: [],
      attachments: []
    },
    repo: context.repo,
    agent: context.agent
  };
}

module.exports = { parseGitHubIssueUrl, fetchGitHubIssue };
