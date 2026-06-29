import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RalphConfig } from "./commands/run.js";

/** The three standalone outcome keywords a Ralph Agent-Iteration may emit. */
export type RalphOutcome = "RALPH_NEXT" | "RALPH_DONE" | "RALPH_BLOCKED";

const OUTCOME_KEYWORDS: readonly RalphOutcome[] = [
  "RALPH_NEXT",
  "RALPH_DONE",
  "RALPH_BLOCKED",
];

/**
 * Codex agent settings as stored in `config.json` under `agent`. `kind` is kept
 * for schema clarity; v1 only supports `"codex"`. The optional fields map to
 * Codex CLI overrides (see `IMPLEMENTATION.md`).
 */
export interface CodexAgentConfig {
  kind: string;
  model: string | null;
  reasoningEffort: string | null;
  sandbox: string | null;
  profile: string | null;
  requiredSkills: string[];
}

/** The minimal prompt that points Codex at the runner-owned RUN_CONTEXT.md. */
export function buildCodexPrompt(runContextPath: string): string {
  return `Read ${runContextPath} and follow it exactly.`;
}

/**
 * Builds the argv for `codex` (the executable name is supplied separately). The
 * default invocation is `codex exec --sandbox workspace-write "<prompt>"`.
 * Optional config fields are appended as CLI overrides when present.
 */
export function buildCodexArgv(
  agent: CodexAgentConfig,
  runContextPath: string,
): string[] {
  const argv: string[] = ["exec"];

  if (agent.model) {
    argv.push("--model", agent.model);
  }
  if (agent.reasoningEffort) {
    // Codex parses `-c key=value` as TOML, so the string value keeps its quotes.
    argv.push("-c", `model_reasoning_effort="${agent.reasoningEffort}"`);
  }
  argv.push("--sandbox", agent.sandbox ?? "workspace-write");
  if (agent.profile) {
    argv.push("--profile", agent.profile);
  }

  argv.push(buildCodexPrompt(runContextPath));
  return argv;
}

/**
 * Detects the winning outcome from agent output. Only lines that, when trimmed,
 * exactly equal a keyword count — embedded keywords are ignored. If more than
 * one distinct keyword appears, `RALPH_BLOCKED` wins.
 */
export function detectOutcome(output: string): RalphOutcome | undefined {
  const found = new Set<RalphOutcome>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if ((OUTCOME_KEYWORDS as readonly string[]).includes(line)) {
      found.add(line as RalphOutcome);
    }
  }

  if (found.size === 0) {
    return undefined;
  }
  if (found.size > 1) {
    return "RALPH_BLOCKED";
  }
  for (const outcome of found) {
    return outcome;
  }
  return undefined;
}

/** Stable artifact paths for a single Agent-Iteration. */
export interface AgentIterationArtifacts {
  dir: string;
  stdoutLog: string;
  stderrLog: string;
  gateStdoutLog: string;
  gateStderrLog: string;
  progressBefore: string;
  progressAfter: string;
  summary: string;
}

/** The directory that holds one Agent-Iteration's artifacts. */
export function agentIterationDir(runDir: string, iteration: number): string {
  return join(runDir, "agent-iterations", String(iteration));
}

/** Computes the stable artifact paths under an Agent-Iteration directory. */
export function agentIterationArtifacts(
  runDir: string,
  iteration: number,
): AgentIterationArtifacts {
  const dir = agentIterationDir(runDir, iteration);
  return {
    dir,
    stdoutLog: join(dir, "stdout.log"),
    stderrLog: join(dir, "stderr.log"),
    gateStdoutLog: join(dir, "gate.stdout.log"),
    gateStderrLog: join(dir, "gate.stderr.log"),
    progressBefore: join(dir, "progress.before.json"),
    progressAfter: join(dir, "progress.after.json"),
    summary: join(dir, "summary.json"),
  };
}

/** Captured result of running the agent process to completion (or timeout). */
export interface AgentProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

/** Injectable process launcher so tests can run without a real Codex binary. */
export type AgentSpawn = (
  command: string,
  argv: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<AgentProcessResult>;

/**
 * Default launcher: spawns a child process in the work plane, captures
 * stdout/stderr, and enforces a hard timeout by killing the process. A failure
 * to launch (e.g. Codex not installed) resolves with `exitCode: null` and the
 * error recorded on stderr rather than throwing.
 */
export const defaultAgentSpawn: AgentSpawn = (command, argv, options) =>
  new Promise<AgentProcessResult>((resolvePromise) => {
    const child = spawn(command, argv, { cwd: options.cwd });

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

    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode, signal, timedOut });
    };

    child.on("error", (err: Error) => {
      stderr += `[ralph] failed to launch ${command}: ${err.message}\n`;
      finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });

/** Options for launching one Agent-Iteration and capturing its artifacts. */
export interface RunAgentIterationOptions {
  config: RalphConfig;
  workPlane: string;
  runDir: string;
  /** Path to the authoritative `progress.json` (for before/after snapshots). */
  progressPath: string;
  runContextPath: string;
  iteration: number;
  /** Override the launcher (tests). Defaults to {@link defaultAgentSpawn}. */
  spawn?: AgentSpawn;
  /** Override the executable name (tests). Defaults to `"codex"`. */
  command?: string;
}

/** Result of one Agent-Iteration, before any verification or rejection. */
export interface AgentIterationResult {
  iteration: number;
  outcome: RalphOutcome | undefined;
  timedOut: boolean;
  exitCode: number | null;
  argv: string[];
  artifacts: AgentIterationArtifacts;
}

/** Copies the authoritative progress.json into a snapshot path. */
async function snapshotProgress(
  progressPath: string,
  destination: string,
): Promise<void> {
  try {
    await copyFile(progressPath, destination);
  } catch {
    // Progress should always exist by run time, but never let a missing
    // snapshot crash artifact capture: record an empty object instead.
    await writeFile(destination, "{}\n");
  }
}

/**
 * Launches one Codex Agent-Iteration: snapshots progress, runs the agent in the
 * work plane with the configured timeout, captures stdout/stderr and the
 * progress before/after snapshots, and detects the outcome keyword. It stops
 * before any verification, checkpoint, or rejection (later slices).
 */
export async function runAgentIteration(
  options: RunAgentIterationOptions,
): Promise<AgentIterationResult> {
  const command = options.command ?? "codex";
  const spawnImpl = options.spawn ?? defaultAgentSpawn;
  const artifacts = agentIterationArtifacts(options.runDir, options.iteration);

  await mkdir(artifacts.dir, { recursive: true });
  await snapshotProgress(options.progressPath, artifacts.progressBefore);

  const argv = buildCodexArgv(options.config.agent, options.runContextPath);
  const timeoutMs = options.config.agentTimeoutSeconds * 1000;

  const proc = await spawnImpl(command, argv, {
    cwd: options.workPlane,
    timeoutMs,
  });

  await writeFile(artifacts.stdoutLog, proc.stdout);
  await writeFile(artifacts.stderrLog, proc.stderr);
  await snapshotProgress(options.progressPath, artifacts.progressAfter);

  // A timed-out Agent-Iteration has no trustworthy outcome.
  const outcome = proc.timedOut ? undefined : detectOutcome(proc.stdout);

  return {
    iteration: options.iteration,
    outcome,
    timedOut: proc.timedOut,
    exitCode: proc.exitCode,
    argv,
    artifacts,
  };
}
