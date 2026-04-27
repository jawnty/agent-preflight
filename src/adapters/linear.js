function parseLinearSource(source) {
  const value = String(source || '').trim();
  const urlMatch = value.match(/^https:\/\/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/i);
  if (urlMatch) return { id: urlMatch[1].toUpperCase(), url: value };
  const idMatch = value.match(/^[A-Z]+-\d+$/i);
  if (idMatch) return { id: value.toUpperCase(), url: null };
  return null;
}

async function fetchLinearIssue(source, context = {}) {
  const parsed = parseLinearSource(source);
  if (!parsed) {
    const error = new Error(`Invalid Linear issue source: ${source}`);
    error.exitCode = 2;
    throw error;
  }
  const token = process.env.LINEAR_API_KEY;
  if (!token) {
    const error = new Error('LINEAR_API_KEY is required for Linear sources.');
    error.exitCode = 3;
    throw error;
  }

  const query = `
    query Issue($id: String!) {
      issue(id: $id) {
        id identifier title description priority estimate url
        state { name type }
        assignee { name email }
        labels { nodes { name } }
        comments { nodes { body user { name } } }
      }
    }
  `;
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables: { id: parsed.id } })
  });
  if (!response.ok) {
    const error = new Error(`Linear API request failed (${response.status}).`);
    error.exitCode = 3;
    throw error;
  }
  const payload = await response.json();
  if (payload.errors || !payload.data || !payload.data.issue) {
    const error = new Error(`Linear issue not found: ${parsed.id}`);
    error.exitCode = 3;
    throw error;
  }

  const issue = payload.data.issue;
  return {
    source: { type: 'linear', id: issue.identifier || parsed.id, remoteId: issue.id, url: issue.url || parsed.url },
    issue: {
      id: issue.identifier || parsed.id,
      remoteId: issue.id,
      url: issue.url || parsed.url,
      title: issue.title,
      description: issue.description || '',
      comments: (issue.comments && issue.comments.nodes || []).map((comment) => ({ author: comment.user && comment.user.name, body: comment.body || '' })),
      status: issue.state && (issue.state.type || issue.state.name) || 'open',
      type: 'issue',
      priority: String(issue.priority || 'medium'),
      labels: (issue.labels && issue.labels.nodes || []).map((label) => label.name),
      assignee: issue.assignee && (issue.assignee.name || issue.assignee.email),
      delegatedAgent: null,
      estimate: issue.estimate,
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

async function linearGraphql(query, variables) {
  const token = process.env.LINEAR_API_KEY;
  if (!token) {
    const error = new Error('LINEAR_API_KEY is required for Linear sources.');
    error.exitCode = 3;
    throw error;
  }
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) {
    const error = new Error(`Linear API request failed (${response.status}).`);
    error.exitCode = 3;
    throw error;
  }
  const payload = await response.json();
  if (payload.errors) {
    const error = new Error(`Linear API error: ${payload.errors.map((item) => item.message).join('; ')}`);
    error.exitCode = 3;
    throw error;
  }
  return payload.data;
}

function linearIssueId(normalized) {
  const id = normalized && normalized.issue && (normalized.issue.remoteId || normalized.source.remoteId);
  if (!id) {
    const error = new Error('Linear mutation requires a fetched Linear issue id.');
    error.exitCode = 3;
    throw error;
  }
  return id;
}

async function commentLinearIssue(normalized, body) {
  const query = `
    mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id url }
      }
    }
  `;
  const data = await linearGraphql(query, { input: { issueId: linearIssueId(normalized), body } });
  return data.commentCreate;
}

async function updateLinearIssueDescription(normalized, description) {
  const query = `
    mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { id identifier url }
      }
    }
  `;
  const data = await linearGraphql(query, { id: linearIssueId(normalized), input: { description } });
  return data.issueUpdate;
}

module.exports = {
  parseLinearSource,
  fetchLinearIssue,
  commentLinearIssue,
  updateLinearIssueDescription
};
