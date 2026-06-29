#!/usr/bin/env bun

import { join } from "node:path";
import { EXIT, RalphError } from "./errors.js";
import { isInsideGitRepo, runInit } from "./commands/init.js";
import { getDocs } from "./commands/docs.js";
import { runLoopCreate, runLoopList, runLoopStatus } from "./commands/loop.js";
import { validateInstallation, validateLoop } from "./commands/validate.js";
import { loadConfig, runSetup } from "./commands/run.js";
import { runAgentIteration } from "./agent.js";
import { verifyAndSummarize } from "./verify.js";
import { runQualityGateAndCheckpoint } from "./checkpoint.js";

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

  // run (setup only — Slice 2; Codex launch lands in later slices)
  if (parsed.command === "run") {
    const ralphDir = getRalphDir(parsed.flags);
    const loopName = parsed.positionals[0];
    if (!loopName) {
      throw new RalphError(
        "Missing loop name. Usage: ralph-loop run <loop-name>",
        EXIT.USAGE_ERROR,
      );
    }

    const result = await runSetup(ralphDir, loopName, { cwd: process.cwd() });

    console.log(`Run prepared for loop "${result.loopName}".`);
    console.log(`  Run id:            ${result.runId}`);
    console.log(`  Work plane:        ${result.workPlane}`);
    console.log(`  Run directory:     ${result.runDir}`);
    console.log(`  RUN_CONTEXT.md:    ${result.runContextPath}`);
    console.log(
      `  Agent-Iteration:   ${result.agentIteration} of cap ${result.agentIterationCap}` +
        ` (pending ${result.pendingCount} + rejection cap ${result.maxRejectedIterations} + 1)`,
    );
    console.log("");

    if (result.eligibleTask) {
      console.log(`Selected task: ${result.eligibleTask.id} (${result.eligibleTask.spec})`);
      console.log("");

      // Slice 3-4: launch one Agent-Iteration, capture artifacts, then verify
      // the progress transition. Checkpoints and rejection recovery land in
      // later slices.
      const config = await loadConfig(ralphDir);
      const progressPath = join(ralphDir, "loops", loopName, "progress.json");
      console.log(`Launching agent (${config.agent.kind}) for Agent-Iteration ${result.agentIteration}...`);

      const iteration = await runAgentIteration({
        config,
        workPlane: result.workPlane,
        runDir: result.runDir,
        progressPath,
        runContextPath: result.runContextPath,
        iteration: result.agentIteration,
      });

      console.log("");
      console.log(`Agent-Iteration ${iteration.iteration} captured:`);
      console.log(`  Artifacts:   ${iteration.artifacts.dir}`);
      console.log(`  stdout.log:  ${iteration.artifacts.stdoutLog}`);
      console.log(`  stderr.log:  ${iteration.artifacts.stderrLog}`);
      if (iteration.timedOut) {
        console.log(`  Outcome:     (timed out after ${config.agentTimeoutSeconds}s)`);
      } else {
        console.log(`  Exit code:   ${iteration.exitCode ?? "unknown"}`);
        console.log(`  Outcome:     ${iteration.outcome ?? "none detected"}`);
      }
      // Slice 4: classify the progress transition and write summary.json.
      const summary = await verifyAndSummarize(iteration);
      console.log("");
      console.log(`Verification:  ${summary.status.toUpperCase()}`);
      console.log(`  Reason:      ${summary.reason}`);
      if (summary.newlyCompleted.length > 0) {
        console.log(`  Completed:   ${summary.newlyCompleted.join(", ")}`);
      }
      console.log(`  summary.json: ${iteration.artifacts.summary}`);

      // Slice 5: for an accepted RALPH_NEXT, run the quality gate and create one
      // checkpoint commit on pass. A failed gate is a rejection. RALPH_DONE and
      // RALPH_BLOCKED neither run the gate nor commit.
      const checkpoint = await runQualityGateAndCheckpoint({
        summary,
        config,
        workPlane: result.workPlane,
        ralphDir,
        loopName,
        runId: result.runId,
        artifacts: iteration.artifacts,
      });

      console.log("");
      if (checkpoint.gate) {
        const gateLabel = checkpoint.gate.timedOut
          ? `timed out after ${config.qualityGateTimeoutSeconds}s`
          : checkpoint.gate.passed
            ? "passed"
            : `failed (exit ${checkpoint.gate.exitCode ?? "unknown"})`;
        console.log(`Quality gate:  ${gateLabel} (${config.qualityGate})`);
      }
      console.log(`Checkpoint:    ${checkpoint.action.toUpperCase()}`);
      console.log(`  Reason:      ${checkpoint.reason}`);
      if (checkpoint.commit) {
        console.log(`  Commit:      ${checkpoint.commit.sha} "${checkpoint.commit.message}"`);
      }
      console.log("");
      console.log("Rejection stash recovery and the retry loop land in later slices.");
      return EXIT.SUCCESS;
    }

    if (result.pendingCount === 0) {
      console.log("No pending tasks remain. The Loop appears complete.");
      return EXIT.SUCCESS;
    }

    // Pending tasks exist but none are eligible (all blocked by dependencies).
    console.log("No eligible task: all pending tasks are blocked by incomplete dependencies.");
    for (const t of result.blockedPending) {
      console.log(`  - ${t.id} (waiting on: ${t.missingDependencies.join(", ")})`);
    }
    return EXIT.BLOCKED;
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
