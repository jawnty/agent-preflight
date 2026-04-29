const VERSION = '0.4.1';

const DEFAULT_CONFIG = {
  minScore: 80,
  agent: 'codex',
  repoPath: '.',
  riskKeywords: [
    'auth',
    'billing',
    'security',
    'migration',
    'production',
    'PII'
  ],
  blockedDomains: [],
  allowedExternalDomains: [],
  weights: {
    task_clarity: 20,
    scope_boundedness: 15,
    acceptance_criteria: 15,
    implementation_guidance: 15,
    verification_path: 15,
    agent_environment_readiness: 10,
    risk_profile: 10
  }
};

const DEFAULT_RISK_KEYWORDS = [
  'auth',
  'oauth',
  'session',
  'password',
  'permission',
  'security',
  'billing',
  'payment',
  'stripe',
  'migration',
  'schema',
  'database',
  'production',
  'deploy',
  'incident',
  'pii',
  'privacy',
  'legal',
  'compliance',
  'admin'
];

const PRIVATE_CONTEXT_DOMAINS = [
  'slack.com',
  'figma.com',
  'docs.google.com',
  'notion.so',
  'atlassian.net',
  'confluence'
];

const AGENT_PROFILES = {
  codex: { kind: 'codex', canAccessRepo: true, canAccessExternalLinks: false, internetPolicy: 'off' },
  claude: { kind: 'claude', canAccessRepo: true, canAccessExternalLinks: false, internetPolicy: 'off' },
  copilot: { kind: 'copilot', canAccessRepo: true, canAccessExternalLinks: false, internetPolicy: 'off' },
  cursor: { kind: 'cursor', canAccessRepo: true, canAccessExternalLinks: false, internetPolicy: 'off' },
  other: { kind: 'other', canAccessRepo: true, canAccessExternalLinks: false, internetPolicy: 'off' }
};

module.exports = {
  VERSION,
  DEFAULT_CONFIG,
  DEFAULT_RISK_KEYWORDS,
  PRIVATE_CONTEXT_DOMAINS,
  AGENT_PROFILES
};
