const fs = require('node:fs');
const path = require('node:path');

const INSTRUCTION_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
  '.cursor/rules'
];

const PACKAGE_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb'
];

const CI_FILES = [
  '.gitlab-ci.yml',
  'circle.yml'
];

function exists(filePath) {
  return fs.existsSync(filePath);
}

function detectRepo(repoPath = '.') {
  const root = path.resolve(repoPath);
  const instructionsFiles = INSTRUCTION_FILES.filter((file) => exists(path.join(root, file)));
  const packageFiles = PACKAGE_FILES.filter((file) => exists(path.join(root, file)));
  const ciConfig = CI_FILES.filter((file) => exists(path.join(root, file)));
  const workflowDir = path.join(root, '.github', 'workflows');
  if (exists(workflowDir)) {
    for (const file of fs.readdirSync(workflowDir)) {
      ciConfig.push(path.join('.github', 'workflows', file));
    }
  }

  const testCommands = [];
  const packageJson = path.join(root, 'package.json');
  if (exists(packageJson)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
      for (const [name, value] of Object.entries(parsed.scripts || {})) {
        if (/(test|lint|typecheck|check|build)/i.test(name)) {
          testCommands.push(`npm run ${name}${name === 'test' ? '' : ''}`.replace('npm run test', 'npm test'));
        } else if (/(test|lint|typecheck|check|build)/i.test(String(value))) {
          testCommands.push(`npm run ${name}`);
        }
      }
    } catch (_) {
      // Keep detection read-only and tolerant of invalid package files.
    }
  }

  const setupConfigPresent = exists(path.join(root, '.devcontainer', 'devcontainer.json'));

  return {
    path: repoPath,
    provider: exists(path.join(root, '.git')) ? 'github' : null,
    owner: null,
    name: path.basename(root),
    defaultBranch: null,
    instructionsFiles,
    ciStatus: ciConfig.length ? 'configured' : 'unknown',
    setupConfigPresent,
    testCommands: [...new Set(testCommands)],
    packageFiles,
    ciConfig
  };
}

module.exports = { detectRepo };
