const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_CONFIG } = require('./schema');

function deepMerge(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      output[key] = deepMerge(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function loadConfig(configPath, cwd = process.cwd()) {
  const candidate = configPath || path.join(cwd, '.agent-preflight.json');
  if (!fs.existsSync(candidate)) {
    return { config: { ...DEFAULT_CONFIG }, path: null };
  }

  const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  return { config: deepMerge(DEFAULT_CONFIG, parsed), path: candidate };
}

function writeDefaultConfig(targetPath, options = {}) {
  const filePath = targetPath || path.join(process.cwd(), '.agent-preflight.json');
  if (fs.existsSync(filePath) && !options.force) {
    const error = new Error(`${filePath} already exists. Use --force to overwrite.`);
    error.exitCode = 2;
    throw error;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  return filePath;
}

module.exports = { deepMerge, loadConfig, writeDefaultConfig };
