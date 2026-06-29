import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  checkpointCommitMessage,
  createCheckpointCommit,
  runQualityGate,
  runQualityGateAndCheckpoint,
  type GateSpawn,
  type GitRunner,
} from "../src/checkpoint";
import { agentIterationArtifacts } from "../src/agent";
import type { RalphConfig } from "../src/commands/run";
import type { IterationSummary } from "../src/verify";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ralph-checkpoint-test-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    workPlane: ".",
    qualityGate: "true",
    agent: {
      kind: "codex",
      model: null,
      reasoningEffort: null,
      sandbox: "workspace-write",
      profile: null,
      requiredSkills: [],
    },
    maxRejectedIterations: 3,
    agentTimeoutSeconds: 1800,
    qualityGateTimeoutSeconds: 600,
    commitRunArtifacts: false,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<IterationSummary> = {}): IterationSummary {
  return {
    iteration: 1,
    outcome: "RALPH_NEXT",
    status: "valid",
    rejected: false,
    reason: 'Completed the selected eligible task "001"',
    selectedTaskId: "001",
    newlyCompleted: ["001"],
    timedOut: false,
    ...overrides,
  };
}

/** A fake gate launcher that records its call and returns a canned result. */
function fakeGateSpawn(
  result: { stdout?: string; stderr?: string; exitCode?: number | null; timedOut?: boolean },
  calls?: { command: string; options: { cwd: string; timeoutMs: number } }[],
): GateSpawn {
  return async (command, options) => {
    calls?.push({ command, options });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
      timedOut: result.timedOut ?? false,
    };
  };
}

async function makeGitRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["init", "-q"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
}

async function gitLogSubjects(dir: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["log", "--format=%s"], { cwd: dir });
  return stdout.split("\n").filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// checkpointCommitMessage
// ---------------------------------------------------------------------------

describe("checkpointCommitMessage", () => {
  test("uses the default ralph commit message", () => {
    expect(checkpointCommitMessage("003-task-c")).toBe("ralph: complete 003-task-c");
  });
});

// ---------------------------------------------------------------------------
// runQualityGate
// ---------------------------------------------------------------------------

describe("runQualityGate", () => {
  test("passes on exit 0 and captures gate logs", async () => {
    const artifacts = agentIterationArtifacts(tmp, 1);
    await mkdir(artifacts.dir, { recursive: true });
    const calls: { command: string; options: { cwd: string; timeoutMs: number } }[] = [];
    const spawn = fakeGateSpawn({ stdout: "ok out", stderr: "ok err", exitCode: 0 }, calls);

    const gate = await runQualityGate(
      makeConfig({ qualityGate: "bun test", qualityGateTimeoutSeconds: 42 }),
      tmp,
      artifacts,
      spawn,
    );

    expect(gate.passed).toBe(true);
    expect(gate.exitCode).toBe(0);
    expect(gate.timedOut).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("bun test");
    expect(calls[0]!.options.cwd).toBe(tmp);
    expect(calls[0]!.options.timeoutMs).toBe(42_000);
    expect(await readFile(artifacts.gateStdoutLog, "utf8")).toBe("ok out");
    expect(await readFile(artifacts.gateStderrLog, "utf8")).toBe("ok err");
  });

  test("fails on a non-zero exit code", async () => {
    const artifacts = agentIterationArtifacts(tmp, 1);
    await mkdir(artifacts.dir, { recursive: true });
    const gate = await runQualityGate(
      makeConfig(),
      tmp,
      artifacts,
      fakeGateSpawn({ exitCode: 1 }),
    );
    expect(gate.passed).toBe(false);
    expect(gate.exitCode).toBe(1);
  });

  test("fails when the gate times out even with exit 0", async () => {
    const artifacts = agentIterationArtifacts(tmp, 1);
    await mkdir(artifacts.dir, { recursive: true });
    const gate = await runQualityGate(
      makeConfig(),
      tmp,
      artifacts,
      fakeGateSpawn({ exitCode: 0, timedOut: true }),
    );
    expect(gate.passed).toBe(false);
    expect(gate.timedOut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createCheckpointCommit (real git)
// ---------------------------------------------------------------------------

describe("createCheckpointCommit", () => {
  async function seedRepo(): Promise<string> {
    const ralphDir = join(tmp, ".jz-ralph");
    await makeGitRepo(tmp);
    await mkdir(join(ralphDir, "loops", "demo", "runs", "R1", "agent-iterations", "1"), {
      recursive: true,
    });
    await writeFile(join(tmp, "README.md"), "seed\n");
    await execFileAsync("git", ["add", "-A"], { cwd: tmp });
    await execFileAsync("git", ["commit", "-q", "-m", "seed"], { cwd: tmp });
    return ralphDir;
  }

  test("creates exactly one commit with the default message", async () => {
    const ralphDir = await seedRepo();
    // Durable change + a run artifact that must be excluded by default.
    await writeFile(join(tmp, "feature.ts"), "export const x = 1;\n");
    await writeFile(join(ralphDir, "loops", "demo", "progress.json"), "{}\n");
    await writeFile(
      join(ralphDir, "loops", "demo", "runs", "R1", "RUN_CONTEXT.md"),
      "diagnostic\n",
    );

    const commit = await createCheckpointCommit({
      workPlane: tmp,
      ralphDir,
      loopName: "demo",
      runId: "R1",
      taskId: "001-task-a",
      commitRunArtifacts: false,
    });

    expect(commit.message).toBe("ralph: complete 001-task-a");
    expect(commit.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await gitLogSubjects(tmp)).toEqual(["ralph: complete 001-task-a", "seed"]);

    // Durable file committed; run artifact left untracked.
    const { stdout: tracked } = await execFileAsync(
      "git",
      ["ls-files", "feature.ts"],
      { cwd: tmp },
    );
    expect(tracked.trim()).toBe("feature.ts");
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: tmp,
    });
    expect(status).toContain("loops/demo/runs/");
  });

  test("includes run artifacts when commitRunArtifacts is true", async () => {
    const ralphDir = await seedRepo();
    await writeFile(join(ralphDir, "loops", "demo", "progress.json"), "{}\n");
    await writeFile(
      join(ralphDir, "loops", "demo", "runs", "R1", "RUN_CONTEXT.md"),
      "diagnostic\n",
    );

    await createCheckpointCommit({
      workPlane: tmp,
      ralphDir,
      loopName: "demo",
      runId: "R1",
      taskId: "001-task-a",
      commitRunArtifacts: true,
    });

    // Worktree fully clean: run artifact was committed too.
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: tmp,
    });
    expect(status.trim()).toBe("");
    const { stdout: tracked } = await execFileAsync(
      "git",
      ["ls-files", join(".jz-ralph", "loops", "demo", "runs", "R1", "RUN_CONTEXT.md")],
      { cwd: tmp },
    );
    expect(tracked.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// runQualityGateAndCheckpoint — orchestration
// ---------------------------------------------------------------------------

describe("runQualityGateAndCheckpoint", () => {
  function makeArtifacts() {
    return agentIterationArtifacts(tmp, 1);
  }

  async function options(
    summary: IterationSummary,
    config: RalphConfig,
    gateSpawn: GateSpawn,
    git?: GitRunner,
  ) {
    const artifacts = makeArtifacts();
    await mkdir(artifacts.dir, { recursive: true });
    return {
      summary,
      config,
      workPlane: tmp,
      ralphDir: join(tmp, ".jz-ralph"),
      loopName: "demo",
      runId: "R1",
      artifacts,
      gateSpawn,
      git: git ?? (async () => ({ stdout: "deadbeef\n", stderr: "", exitCode: 0 })),
    };
  }

  test("runs the gate and commits for a valid RALPH_NEXT", async () => {
    const gateCalls: { command: string; options: { cwd: string; timeoutMs: number } }[] = [];
    const gitCalls: string[][] = [];
    const git: GitRunner = async (args) => {
      gitCalls.push(args);
      return { stdout: "abc123\n", stderr: "", exitCode: 0 };
    };
    const opts = await options(
      makeSummary(),
      makeConfig(),
      fakeGateSpawn({ exitCode: 0 }, gateCalls),
      git,
    );

    const outcome = await runQualityGateAndCheckpoint(opts);

    expect(outcome.action).toBe("checkpoint");
    expect(gateCalls).toHaveLength(1);
    expect(outcome.gate?.passed).toBe(true);
    expect(outcome.commit?.message).toBe("ralph: complete 001");
    expect(outcome.commit?.sha).toBe("abc123");
    // Commit actually ran through git.
    expect(gitCalls.some((a) => a[0] === "commit")).toBe(true);

    // summary.json updated with the gate + commit and still marked accepted.
    const written = JSON.parse(
      await readFile(opts.artifacts.summary, "utf8"),
    ) as IterationSummary;
    expect(written.rejected).toBe(false);
    expect(written.status).toBe("valid");
    expect(written.commit?.sha).toBe("abc123");
  });

  test("rejects (no commit) when the gate fails", async () => {
    const gitCalls: string[][] = [];
    const git: GitRunner = async (args) => {
      gitCalls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const opts = await options(
      makeSummary(),
      makeConfig(),
      fakeGateSpawn({ exitCode: 1 }),
      git,
    );

    const outcome = await runQualityGateAndCheckpoint(opts);

    expect(outcome.action).toBe("rejected");
    expect(outcome.commit).toBeNull();
    expect(outcome.reason).toMatch(/quality gate/i);
    expect(gitCalls.some((a) => a[0] === "commit")).toBe(false);

    const written = JSON.parse(
      await readFile(opts.artifacts.summary, "utf8"),
    ) as IterationSummary;
    expect(written.rejected).toBe(true);
    expect(written.status).toBe("rejected");
    expect(written.gate?.passed).toBe(false);
  });

  test("rejects when the gate times out", async () => {
    const opts = await options(
      makeSummary(),
      makeConfig(),
      fakeGateSpawn({ exitCode: 0, timedOut: true }),
    );

    const outcome = await runQualityGateAndCheckpoint(opts);

    expect(outcome.action).toBe("rejected");
    expect(outcome.reason).toMatch(/timed out/i);
    expect(outcome.gate?.timedOut).toBe(true);
  });

  test("does not run the gate or commit for a valid RALPH_DONE", async () => {
    const gateCalls: { command: string; options: { cwd: string; timeoutMs: number } }[] = [];
    const gitCalls: string[][] = [];
    const git: GitRunner = async (args) => {
      gitCalls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const opts = await options(
      makeSummary({ outcome: "RALPH_DONE", newlyCompleted: [], selectedTaskId: null }),
      makeConfig(),
      fakeGateSpawn({ exitCode: 0 }, gateCalls),
      git,
    );

    const outcome = await runQualityGateAndCheckpoint(opts);

    expect(outcome.action).toBe("done");
    expect(outcome.gate).toBeNull();
    expect(outcome.commit).toBeNull();
    expect(gateCalls).toHaveLength(0);
    expect(gitCalls.some((a) => a[0] === "commit")).toBe(false);
  });

  test("does not run the gate or commit for a RALPH_BLOCKED", async () => {
    const gateCalls: { command: string; options: { cwd: string; timeoutMs: number } }[] = [];
    const opts = await options(
      makeSummary({ outcome: "RALPH_BLOCKED", status: "blocked", newlyCompleted: [] }),
      makeConfig(),
      fakeGateSpawn({ exitCode: 0 }, gateCalls),
    );

    const outcome = await runQualityGateAndCheckpoint(opts);

    expect(outcome.action).toBe("blocked");
    expect(outcome.gate).toBeNull();
    expect(outcome.commit).toBeNull();
    expect(gateCalls).toHaveLength(0);
  });

  test("does not run the gate for an already-rejected verification", async () => {
    const gateCalls: { command: string; options: { cwd: string; timeoutMs: number } }[] = [];
    const opts = await options(
      makeSummary({
        status: "rejected",
        rejected: true,
        reason: "RALPH_NEXT completed zero tasks",
        newlyCompleted: [],
      }),
      makeConfig(),
      fakeGateSpawn({ exitCode: 0 }, gateCalls),
    );

    const outcome = await runQualityGateAndCheckpoint(opts);

    expect(outcome.action).toBe("rejected");
    expect(outcome.gate).toBeNull();
    expect(gateCalls).toHaveLength(0);
  });
});
