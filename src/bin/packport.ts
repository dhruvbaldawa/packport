#!/usr/bin/env bun
// ABOUTME: Provides the installed packport executable entrypoint.
// ABOUTME: Delegates all command behavior to the shared CLI primitive.

import { runCli } from "../cli";

const result = await runCli(Bun.argv.slice(2));

if (result.stdout) {
  console.log(result.stdout);
}

if (result.stderr) {
  console.error(result.stderr);
}

process.exit(result.exitCode);
