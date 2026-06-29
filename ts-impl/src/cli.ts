#!/usr/bin/env bun

import { join } from "node:path";
import { EXIT, RalphError } from "./errors.js";
import { isInsideGitRepo, runInit } from "./commands/init.js";
import { getDocs } from "./commands/docs.js";
import { runLoopCreate, runLoopList, runLoopStatus } from "./commands/loop.js";
import { validateInstallation, validateLoop } from "./commands/validate.js";

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
  ralph-loop docs [<section>]
  ralph-loop help

Run "ralph-loop docs" for detailed documentation.
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

  throw new RalphError(`Unknown command: ${command}`, EXIT.USAGE_ERROR);
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
    throw new RalphError(`Missing required flag: --${key}`, EXIT.USAGE_ERROR);
  }

  return value;
}

function getRalphDir(flags: Map<string, string | true>): string {
  return getStringFlag(flags, "ralph-dir") ?? ".jz-ralph";
}

async function main(): Promise<number> {
  const parsed = parseArgs(Bun.argv.slice(2));

  // help
  if (parsed.command === "help") {
    console.log(HELP);
    return EXIT.SUCCESS;
  }

  // docs
  if (parsed.command === "docs") {
    const content = getDocs(parsed.positionals);
    if (content === undefined) {
      const section = parsed.positionals.join(" ");
      console.error(`Unknown docs section: ${section}`);
      console.error('Run "ralph-loop docs" for the section index.');
      return EXIT.USAGE_ERROR;
    }
    console.log(content);
    return EXIT.SUCCESS;
  }

  // init
  if (parsed.command === "init") {
    const ralphDir = getRalphDir(parsed.flags);
    const cwd = process.cwd();
    await runInit(ralphDir, cwd);
    console.log(`Ralph initialized in ${ralphDir}/\n`);
    console.log("Next:");
    console.log("  ralph-loop docs");
    console.log("  ralph-loop docs <doc-section>");
    console.log("  ralph-loop docs examples simple");
    console.log("  ralph-loop loop create --name <loop-name> --from <task-source-dir>");
    console.log("  ralph-loop run <loop-name>");
    return EXIT.SUCCESS;
  }

  // validate
  if (parsed.command === "validate") {
    const ralphDir = getRalphDir(parsed.flags);
    await validateInstallation(ralphDir);
    const loopName = parsed.positionals[0];
    if (loopName) {
      await validateLoop(ralphDir, loopName);
      console.log(`Loop "${loopName}" is valid.`);
      return EXIT.SUCCESS;
    }
    console.log("Ralph installation is valid.");
    return EXIT.SUCCESS;
  }

  // loop subcommands
  if (parsed.command === "loop") {
    const ralphDir = getRalphDir(parsed.flags);
    const sub = parsed.positionals[0];

    if (sub === "create") {
      const name = requireStringFlag(parsed.flags, "name");
      const fromDir = requireStringFlag(parsed.flags, "from");
      await runLoopCreate(ralphDir, name, fromDir);
      console.log(`Loop "${name}" created in ${join(ralphDir, "loops", name)}/`);
      return EXIT.SUCCESS;
    }

    if (sub === "list") {
      const loops = await runLoopList(ralphDir);
      if (loops.length === 0) {
        console.log("No loops found.");
      } else {
        for (const name of loops) {
          console.log(name);
        }
      }
      return EXIT.SUCCESS;
    }

    if (sub === "status") {
      const loopName = parsed.positionals[1];
      if (!loopName) {
        throw new RalphError("Missing loop name. Usage: ralph-loop loop status <loop-name>", EXIT.USAGE_ERROR);
      }
      const status = await runLoopStatus(ralphDir, loopName);
      console.log(`Loop: ${status.name}`);
      console.log(
        `Tasks: ${status.total} total | ${status.complete} complete | ${status.pending} pending | ${status.blocked} blocked`,
      );
      console.log(`Eligible: ${status.eligibleTaskId ?? "none"}`);
      return EXIT.SUCCESS;
    }

    throw new RalphError(
      `Unknown loop subcommand: ${sub ?? "(none)"}. Try: create, list, status`,
      EXIT.USAGE_ERROR,
    );
  }

  // tasks subcommands (pending)
  if (parsed.command === "tasks") {
    console.log("Command is intentionally pending its approved implementation slice.");
    return EXIT.USAGE_ERROR;
  }

  // run (pending)
  if (parsed.command === "run") {
    console.log("Command is intentionally pending its approved implementation slice.");
    return EXIT.USAGE_ERROR;
  }

  return EXIT.SUCCESS;
}

try {
  const exitCode = await main();
  process.exit(exitCode);
} catch (error) {
  if (error instanceof RalphError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(EXIT.RUNNER_ERROR);
}
