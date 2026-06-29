import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { EXIT, RalphError } from "../errors.js";
import { isInsideGitRepo } from "./init.js";
import { validateInstallation, validateLoop } from "./validate.js";
import { selectEligibleTask } from "../task-spec.js";
import type { ProgressTask } from "../task-spec.js";
import type { ProgressJson } from "./loop.js";

const execFileAsync = promisify(execFile);

/** Typed view of `.jz-ralph/config.json`. */
export interface RalphConfig {
  workPlane: string;
  qualityGate: string;
  agent: { kind: string };
  maxRejectedIterations: number;
  agentTimeoutSeconds: number;
  qualityGateTimeoutSeconds: number;
  commitRunArtifacts: boolean;
}

/** A pending task whose dependencies are not all complete. */
export interface BlockedPendingTask {
  id: string;
  missingDependencies: string[];
}

/** Result of preparing a Run without launching the agent. */
export interface RunSetupResult {
  loopName: string;
  runId: string;
  ralphDir: string;
  workPlane: string;
  runDir: string;
  runContextPath: string;
  eligibleTask: { id: string; spec: string } | undefined;
  pendingCount: number;
  blockedPending: BlockedPendingTask[];
  rejectedCount: number;
  maxRejectedIterations: number;
  agentIterationCap: number;
  agentIteration: number;
}

export interface RunSetupOptions {
  /** Base directory for resolving `config.workPlane`. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Injectable clock for deterministic Run ids. */
  now?: Date;
  /** Explicit Run id override (used by tests). */
  runId?: string;
}

/**
 * Reads, parses, and validates `config.json`, returning a typed config.
 * `validateInstallation` already guards structure; this re-reads to surface the
 * concrete values the run path needs.
 */
export async function loadConfig(ralphDir: string): Promise<RalphConfig> {
  const raw = await readFile(join(ralphDir, "config.json"), "utf8");
  const config = JSON.parse(raw) as RalphConfig;
  return config;
}

/** Formats a filesystem-safe, lexically sortable Run id from a Date. */
export function formatRunId(now: Date): string {
  // 2026-06-29T19:12:30.000Z -> 2026-06-29T191230Z
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "");
}

/** True when `git status --porcelain` reports no changes in the work plane. */
async function isWorktreeClean(workPlane: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: workPlane,
  });
  return stdout.trim().length === 0;
}

/** Loads and parses a Loop's authoritative `progress.json`. */
async function loadProgress(
  ralphDir: string,
  loopName: string,
): Promise<ProgressJson> {
  const raw = await readFile(
    join(ralphDir, "loops", loopName, "progress.json"),
    "utf8",
  );
  return JSON.parse(raw) as ProgressJson;
}

/** Computes pending tasks whose dependencies are not all complete. */
function computeBlockedPending(tasks: ProgressTask[]): BlockedPendingTask[] {
  const completeIds = new Set(
    tasks.filter((t) => t.status === "complete").map((t) => t.id),
  );
  const blocked: BlockedPendingTask[] = [];
  for (const task of tasks) {
    if (task.status !== "pending") {
      continue;
    }
    const missing = task.dependencies.filter((dep) => !completeIds.has(dep));
    if (missing.length > 0) {
      blocked.push({ id: task.id, missingDependencies: missing });
    }
  }
  return blocked;
}

function renderRunContext(result: RunSetupResult, config: RalphConfig): string {
  const loopRel = `loops/${result.loopName}`;
  const runRel = `${loopRel}/runs/${result.runId}`;
  const eligibleLine = result.eligibleTask
    ? `${result.eligibleTask.id} (${loopRel}/${result.eligibleTask.spec})`
    : "none";

  const blockedView =
    result.blockedPending.length === 0
      ? "  (none)"
      : result.blockedPending
          .map(
            (t) =>
              `  - ${t.id} (waiting on: ${t.missingDependencies.join(", ")})`,
          )
          .join("\n");

  return `# RUN_CONTEXT

Runner-owned diagnostic file. Read it and follow it exactly. Do not edit it.

## Run Bindings

- Loop name: ${result.loopName}
- Run id: ${result.runId}
- Ralph directory: ${result.ralphDir}
- Work plane: ${result.workPlane}
- Agent-Iteration: ${result.agentIteration}
- Rejected attempts (this Run): ${result.rejectedCount}
- Rejection cap (maxRejectedIterations): ${result.maxRejectedIterations}
- Agent-Iteration cap: ${result.agentIterationCap}
- Quality gate: ${config.qualityGate}
- Agent: ${config.agent.kind}

## Selected Task

- Eligible task: ${eligibleLine}

## Derived Execution View

- Pending tasks: ${result.pendingCount}
- Pending tasks blocked by incomplete dependencies:
${blockedView}

## Control-Plane Files

- Config: ${result.ralphDir}/config.json
- Agent instructions: ${result.ralphDir}/AGENTS.md
- Project knowledge: ${result.ralphDir}/KNOWLEDGE.md
- Progress ledger (authoritative): ${result.ralphDir}/${loopRel}/progress.json
- Loop handoff: ${result.ralphDir}/${loopRel}/HANDOFF.md
- Task specs: ${result.ralphDir}/${loopRel}/tasks/

## Outcome Keyword Rules

Emit exactly one standalone outcome line before exiting:

- RALPH_NEXT — selected task complete; runner continues to the next task.
- RALPH_DONE — all tasks complete; no task newly completed this iteration.
- RALPH_BLOCKED — cannot proceed; no task newly completed this iteration.

If more than one keyword appears, RALPH_BLOCKED wins.

## Progress Update Rules

- Complete at most one task per Agent-Iteration (the selected eligible task).
- Mark it "complete" in the authoritative progress.json shown above.
- The runner only verifies progress.json; it never edits task progress.
- Do not edit this RUN_CONTEXT.md file.

## Artifacts

- Run directory: ${result.ralphDir}/${runRel}/
- This file: ${result.runContextPath}
`;
}

/**
 * Prepares a Run without launching the agent: validates the installation, Loop,
 * Git requirements, and clean worktree; selects the eligible task; computes
 * caps; creates the Run directory; and writes `RUN_CONTEXT.md`.
 */
export async function runSetup(
  ralphDir: string,
  loopName: string,
  options: RunSetupOptions = {},
): Promise<RunSetupResult> {
  const cwd = options.cwd ?? process.cwd();

  // 1. Installation + Loop must be valid (throws VALIDATION_ERROR otherwise).
  await validateInstallation(ralphDir);
  await validateLoop(ralphDir, loopName);

  // 2. Resolve the work plane and enforce Git requirements.
  const config = await loadConfig(ralphDir);
  const workPlane = resolve(cwd, config.workPlane);

  if (!(await isInsideGitRepo(workPlane))) {
    throw new RalphError(
      `Work plane is not inside a Git repository: ${workPlane}`,
      EXIT.VALIDATION_ERROR,
    );
  }

  let clean: boolean;
  try {
    clean = await isWorktreeClean(workPlane);
  } catch {
    throw new RalphError(
      `Unable to inspect Git worktree in: ${workPlane}`,
      EXIT.VALIDATION_ERROR,
    );
  }
  if (!clean) {
    throw new RalphError(
      `Work plane has uncommitted changes. ralph-loop run requires a clean worktree (no --allow-dirty bypass).`,
      EXIT.VALIDATION_ERROR,
    );
  }

  // 3. Load progress, select the eligible task, compute the derived view.
  const progress = await loadProgress(ralphDir, loopName);
  const progressTasks: ProgressTask[] = progress.tasks.map((t) => ({
    id: t.id,
    status: t.status,
    dependencies: t.dependencies,
  }));
  const pendingCount = progressTasks.filter((t) => t.status === "pending").length;
  const eligible = selectEligibleTask(progressTasks);
  const eligibleSpec = eligible
    ? progress.tasks.find((t) => t.id === eligible.id)?.spec
    : undefined;
  const blockedPending = computeBlockedPending(progressTasks);

  // 4. Compute caps. The cap is a per-Run total of allowed Agent-Iterations.
  const maxRejectedIterations = config.maxRejectedIterations;
  const agentIterationCap = pendingCount + maxRejectedIterations + 1;

  // 5. Create the Run directory and write RUN_CONTEXT.md.
  const runId = options.runId ?? formatRunId(options.now ?? new Date());
  const runDir = join(ralphDir, "loops", loopName, "runs", runId);
  await mkdir(runDir, { recursive: true });
  const runContextPath = join(runDir, "RUN_CONTEXT.md");

  const result: RunSetupResult = {
    loopName,
    runId,
    ralphDir,
    workPlane,
    runDir,
    runContextPath,
    eligibleTask:
      eligible && eligibleSpec
        ? { id: eligible.id, spec: eligibleSpec }
        : undefined,
    pendingCount,
    blockedPending,
    rejectedCount: 0,
    maxRejectedIterations,
    agentIterationCap,
    agentIteration: 1,
  };

  await writeFile(runContextPath, renderRunContext(result, config));

  return result;
}
