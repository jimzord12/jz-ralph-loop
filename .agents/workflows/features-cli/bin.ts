#!/usr/bin/env bun

import { runIssuesManagerCliMain } from './cli';

runIssuesManagerCliMain(process.argv.slice(2))
  .then(exitCode => {
    process.exitCode = exitCode;
  })
  .catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
