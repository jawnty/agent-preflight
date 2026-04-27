#!/usr/bin/env node

const { run } = require('../src/cli');

run(process.argv.slice(2)).catch((error) => {
  const message = error && error.message ? error.message : String(error);
  console.error(`agent-preflight: ${message}`);
  process.exitCode = error.exitCode || 4;
});
