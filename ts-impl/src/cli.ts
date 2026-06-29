#!/usr/bin/env bun

import { stat } from "node:fs/promises";
import { join } from "node:path";

type CliCommand = "init" | "loop" | "tasks" | "run" | "validate" | "docs" | "help";

type ParsedArgs = {
  command: CliCommand;
  positionals: string[];
  flags: Map<string, string | true>;
};

const HELP = `ralph-loop

Usage:
  ralph-loop init
  ralph-loop loop create --name <loop-name> --from <task-source-dir>
  ralph-loop loop list
  ralph-loop loop status <loop-name>
  ralph-loop tasks normalize --from <task-source-dir> --to <normalized-task-source-dir>
  ralph-loop run <loop-name> [--ralph-dir <path>]
  ralph-loop validate [<loop-name>] [--ralph-dir <path>]
  ralph-loop docs
  ralph-loop docs <doc-section>
  ralph-loop help

Status:
  This TypeScript CLI scaffold is ready for the approved implementation slices in plan/README.md.
`;

function parseArgs(argv: string[]): ParsedArgs {
  const [rawCommand = "help", ...rest] = argv;
  const command = normalizeCommand(rawCommand);
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token) {
      continue;
    }

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, next);
    i += 1;
  }

  return { command, positionals, flags };
}

function normalizeCommand(command: string): CliCommand {
  if (
    command === "init" ||
    command === "loop" ||
    command === "tasks" ||
    command === "run" ||
    command === "validate" ||
    command === "docs" ||
    command === "help"
  ) {
    return command;
  }

  throw new Error(`Unknown command: ${command}`);
}

function getStringFlag(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return undefined;
}

function requireStringFlag(flags: Map<string, string | true>, key: string): string {
  const value = getStringFlag(flags, key);
  if (!value) {
    throw new Error(`Missing required flag: --${key}`);
  }

  return value;
}

function getRalphDir(flags: Map<string, string | true>): string {
  return getStringFlag(flags, "ralph-dir") ?? ".jz-ralph";
}

async function validateInstallation(ralphDir: string): Promise<void> {
  const requiredFiles = ["config.json", "AGENTS.md", "KNOWLEDGE.md"];
  const missing: string[] = [];

  for (const entry of requiredFiles) {
    try {
      const info = await stat(join(ralphDir, entry));
      if (!info.isFile()) {
        missing.push(entry);
      }
    } catch {
      missing.push(entry);
    }
  }

  try {
    const info = await stat(join(ralphDir, "loops"));
    if (!info.isDirectory()) {
      missing.push("loops");
    }
  } catch {
    missing.push("loops");
  }

  if (missing.length > 0) {
    throw new Error(`Ralph installation is missing: ${missing.join(", ")}`);
  }
}

async function validateLoop(ralphDir: string, loopName: string): Promise<void> {
  const loopDir = join(ralphDir, "loops", loopName);
  const requiredFiles = ["loop.json", "progress.json", "HANDOFF.md"];
  const missing: string[] = [];

  for (const entry of requiredFiles) {
    try {
      const info = await stat(join(loopDir, entry));
      if (!info.isFile()) {
        missing.push(entry);
      }
    } catch {
      missing.push(entry);
    }
  }

  try {
    const info = await stat(join(loopDir, "tasks"));
    if (!info.isDirectory()) {
      missing.push("tasks");
    }
  } catch {
    missing.push("tasks");
  }

  if (missing.length > 0) {
    throw new Error(`Loop "${loopName}" is missing: ${missing.join(", ")}`);
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(Bun.argv.slice(2));

  if (parsed.command === "help") {
    console.log(HELP);
    return 0;
  }

  if (parsed.command === "validate") {
    const ralphDir = getRalphDir(parsed.flags);
    await validateInstallation(ralphDir);
    const loopName = parsed.positionals[0];
    if (loopName) {
      await validateLoop(ralphDir, loopName);
      console.log(`Ralph loop "${loopName}" is valid.`);
      return 0;
    }

    console.log("Ralph installation is valid.");
    return 0;
  }

  if (
    parsed.command === "init" ||
    parsed.command === "loop" ||
    parsed.command === "tasks" ||
    parsed.command === "docs"
  ) {
    console.log("Command is intentionally pending its approved implementation slice.");
    return 2;
  }

  const ralphDir = getRalphDir(parsed.flags);
  const loopName = parsed.positionals[0];
  if (!loopName) {
    throw new Error("Missing required loop name.");
  }

  await validateInstallation(ralphDir);
  await validateLoop(ralphDir, loopName);

  console.log("Ralph loop TypeScript runner scaffold");
  console.log(`ralphDir: ${ralphDir}`);
  console.log(`loopName: ${loopName}`);
  console.log("Run behavior is intentionally pending the v1 decisions in IMPLEMENTATION.md.");

  return 2;
}

try {
  const exitCode = await main();
  process.exit(exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
