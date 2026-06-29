/**
 * Quality gate and checkpoint commits (Slice 5).
 *
 * After Slice 4 classifies an Agent-Iteration, this module accepts a
 * protocol-valid `RALPH_NEXT` by running the configured quality gate in the work
 * plane and, on pass, creating exactly one Git checkpoint commit. A failed or
 * timed-out quality gate after `RALPH_NEXT` is a rejection. `RALPH_DONE` and
 * `RALPH_BLOCKED` never run the gate and never commit. Stash-based rejection
 * recovery and the retry loop are out of scope for this slice (Slice 6).
 */

import { execFile, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RalphConfig } from "./commands/run.js";
import type { AgentIterationArtifacts } from "./agent.js";
import type { IterationSummary, SummaryGate } from "./verify.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Quality gate
// ---------------------------------------------------------------------------

/** Outcome of running the quality gate command. */
export interface GateResult {
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
}

/** Raw result of launching the gate command line. */
export interface GateProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** Injectable gate launcher so tests can run without a real gate command. */
export type GateSpawn = (
  command: string,
  options: { cwd: string; timeoutMs: number },
) => Promise<GateProcessResult>;

/**
 * Default gate launcher: runs the configured `qualityGate` command line through
 * a shell in the work plane, captures stdout/stderr, and enforces a hard
 * timeout by killing the process. A failure to launch resolves with
 * `exitCode: null` (treated as a non-pass) rather than throwing.
 */
export const defaultGateSpawn: GateSpawn = (command, options) =>
  new Promise<GateProcessResult>((resolvePromise) => {
    const child = spawn(command, { cwd: options.cwd, shell: true });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const finish = (exitCode: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode, timedOut });
    };

    child.on("error", (err: Error) => {
      stderr += `[ralph] failed to launch quality gate: ${err.message}\n`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });

/**
 * Runs the configured quality gate in the work plane, capturing
 * `gate.stdout.log` and `gate.stderr.log`. The gate passes only when it exits 0
 * without timing out.
 */
export async function runQualityGate(
  config: RalphConfig,
  workPlane: string,
  artifacts: Pick<AgentIterationArtifacts, "gateStdoutLog" | "gateStderrLog">,
  spawnImpl: GateSpawn = defaultGateSpawn,
): Promise<GateResult> {
  const proc = await spawnImpl(config.qualityGate, {
    cwd: workPlane,
    timeoutMs: config.qualityGateTimeoutSeconds * 1000,
  });

  await writeFile(artifacts.gateStdoutLog, proc.stdout);
  await writeFile(artifacts.gateStderrLog, proc.stderr);

  return {
    passed: !proc.timedOut && proc.exitCode === 0,
    exitCode: proc.exitCode,
    timedOut: proc.timedOut,
  };
}

// ---------------------------------------------------------------------------
// Checkpoint commit
// ---------------------------------------------------------------------------

/** The default checkpoint commit message for a completed task. */
export function checkpointCommitMessage(taskId: string): string {
  return `ralph: complete ${taskId}`;
}

/** Result of running a git subcommand. */
export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Injectable git runner so tests can avoid a real repository. */
export type GitRunner = (
  args: string[],
  options: { cwd: string },
) => Promise<GitResult>;

/** Default git runner: invokes the system `git` binary in the work plane. */
export const defaultGitRunner: GitRunner = async (args, options) => {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: options.cwd,
  });
  return { stdout, stderr, exitCode: 0 };
};

/** The created checkpoint commit. */
export interface CheckpointCommit {
  sha: string;
  message: string;
}

export interface CreateCheckpointCommitOptions {
  workPlane: string;
  ralphDir: string;
  loopName: string;
  runId: string;
  taskId: string;
  /** When false (default), the Run's diagnostic artifacts are left uncommitted. */
  commitRunArtifacts: boolean;
  git?: GitRunner;
}

/**
 * Creates exactly one checkpoint commit for an accepted task. Stages all
 * work-plane and control-plane changes, then — unless `commitRunArtifacts` is
 * true — unstages the Loop's run-diagnostics directory so the commit stays
 * focused on durable project and control-plane state.
 */
export async function createCheckpointCommit(
  options: CreateCheckpointCommitOptions,
): Promise<CheckpointCommit> {
  const git = options.git ?? defaultGitRunner;
  const message = checkpointCommitMessage(options.taskId);

  await git(["add", "-A"], { cwd: options.workPlane });

  if (!options.commitRunArtifacts) {
    // Keep runtime diagnostics out of the checkpoint by default.
    const runsDir = join(options.ralphDir, "loops", options.loopName, "runs");
    await git(["reset", "--quiet", "--", runsDir], { cwd: options.workPlane });
  }

  await git(["commit", "--quiet", "--message", message], {
    cwd: options.workPlane,
  });

  const { stdout } = await git(["rev-parse", "HEAD"], {
    cwd: options.workPlane,
  });

  return { sha: stdout.trim(), message };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** What the checkpoint step decided to do with an Agent-Iteration. */
export type CheckpointAction = "checkpoint" | "rejected" | "done" | "blocked";

/** Result of the gate-and-checkpoint step for one Agent-Iteration. */
export interface CheckpointOutcome {
  action: CheckpointAction;
  reason: string;
  /** The gate result, present only when the gate ran. */
  gate: GateResult | null;
  /** The checkpoint commit, present only when a commit was created. */
  commit: CheckpointCommit | null;
}

export interface QualityGateCheckpointOptions {
  summary: IterationSummary;
  config: RalphConfig;
  workPlane: string;
  ralphDir: string;
  loopName: string;
  runId: string;
  artifacts: AgentIterationArtifacts;
  gateSpawn?: GateSpawn;
  git?: GitRunner;
}

/** Persists an updated summary back to `summary.json`. */
async function writeSummary(
  artifacts: AgentIterationArtifacts,
  summary: IterationSummary,
): Promise<void> {
  await writeFile(artifacts.summary, JSON.stringify(summary, null, 2) + "\n");
}

/**
 * Accepts or rejects a classified Agent-Iteration. Only a protocol-valid
 * `RALPH_NEXT` runs the quality gate; on pass it produces one checkpoint commit,
 * on fail/timeout it becomes a rejection. `RALPH_DONE` and `RALPH_BLOCKED`
 * resolve without a gate or commit, and an already-rejected verification is left
 * untouched. The summary on disk is updated to reflect the gate and commit.
 */
export async function runQualityGateAndCheckpoint(
  options: QualityGateCheckpointOptions,
): Promise<CheckpointOutcome> {
  const { summary, config, artifacts } = options;

  // Only an accepted RALPH_NEXT is eligible for the gate + checkpoint.
  if (summary.status === "valid" && summary.outcome === "RALPH_NEXT") {
    const taskId = summary.newlyCompleted[0] ?? summary.selectedTaskId;
    if (!taskId) {
      // Defensive: verification guarantees a completed task here, but never
      // commit without a task id.
      return { action: "rejected", reason: "No completed task to checkpoint", gate: null, commit: null };
    }

    const gate = await runQualityGate(
      config,
      options.workPlane,
      artifacts,
      options.gateSpawn,
    );
    const gateSummary: SummaryGate = {
      passed: gate.passed,
      exitCode: gate.exitCode,
      timedOut: gate.timedOut,
    };

    if (!gate.passed) {
      const reason = gate.timedOut
        ? `Quality gate timed out after ${config.qualityGateTimeoutSeconds}s`
        : `Quality gate failed (exit ${gate.exitCode ?? "unknown"})`;
      await writeSummary(artifacts, {
        ...summary,
        status: "rejected",
        rejected: true,
        reason,
        gate: gateSummary,
      });
      return { action: "rejected", reason, gate, commit: null };
    }

    const commit = await createCheckpointCommit({
      workPlane: options.workPlane,
      ralphDir: options.ralphDir,
      loopName: options.loopName,
      runId: options.runId,
      taskId,
      commitRunArtifacts: config.commitRunArtifacts,
      ...(options.git ? { git: options.git } : {}),
    });
    await writeSummary(artifacts, {
      ...summary,
      gate: gateSummary,
      commit: { sha: commit.sha, message: commit.message },
    });
    return {
      action: "checkpoint",
      reason: `Checkpoint committed for ${taskId}`,
      gate,
      commit,
    };
  }

  if (summary.status === "valid" && summary.outcome === "RALPH_DONE") {
    return {
      action: "done",
      reason: "All tasks complete; nothing to checkpoint",
      gate: null,
      commit: null,
    };
  }

  if (summary.status === "blocked") {
    return { action: "blocked", reason: summary.reason, gate: null, commit: null };
  }

  // Already rejected by progress verification (Slice 4); no gate, no commit.
  return { action: "rejected", reason: summary.reason, gate: null, commit: null };
}
