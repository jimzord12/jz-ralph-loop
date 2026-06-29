import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  agentIterationArtifacts,
  agentIterationDir,
  buildCodexArgv,
  buildCodexPrompt,
  detectOutcome,
  runAgentIteration,
  type AgentProcessResult,
  type AgentSpawn,
  type CodexAgentConfig,
} from "../src/agent";
import type { RalphConfig } from "../src/commands/run";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ralph-agent-test-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const DEFAULT_AGENT: CodexAgentConfig = {
  kind: "codex",
  model: null,
  reasoningEffort: null,
  sandbox: "workspace-write",
  profile: null,
  requiredSkills: [],
};

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    workPlane: ".",
    qualityGate: "bun test",
    agent: DEFAULT_AGENT,
    maxRejectedIterations: 3,
    agentTimeoutSeconds: 1800,
    qualityGateTimeoutSeconds: 600,
    commitRunArtifacts: false,
    ...overrides,
  };
}

interface SpawnCall {
  command: string;
  argv: string[];
  options: { cwd: string; timeoutMs: number };
}

/** Builds a fake launcher that records its call and returns a canned result. */
function fakeSpawn(
  result: Partial<AgentProcessResult>,
  calls?: SpawnCall[],
): AgentSpawn {
  return async (command, argv, options) => {
    calls?.push({ command, argv, options });
    return {
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      timedOut: false,
      ...result,
    };
  };
}

// ---------------------------------------------------------------------------
// buildCodexPrompt / buildCodexArgv
// ---------------------------------------------------------------------------

describe("buildCodexPrompt", () => {
  test("points the agent at RUN_CONTEXT.md", () => {
    expect(buildCodexPrompt("/x/RUN_CONTEXT.md")).toBe(
      "Read /x/RUN_CONTEXT.md and follow it exactly.",
    );
  });
});

describe("buildCodexArgv", () => {
  test("default config yields exec + sandbox + prompt only", () => {
    const argv = buildCodexArgv(DEFAULT_AGENT, "/x/RUN_CONTEXT.md");
    expect(argv).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "Read /x/RUN_CONTEXT.md and follow it exactly.",
    ]);
  });

  test("maps optional model, reasoningEffort, sandbox, and profile", () => {
    const argv = buildCodexArgv(
      {
        kind: "codex",
        model: "o3",
        reasoningEffort: "high",
        sandbox: "read-only",
        profile: "ci",
        requiredSkills: [],
      },
      "/x/RUN_CONTEXT.md",
    );
    expect(argv).toEqual([
      "exec",
      "--model",
      "o3",
      "-c",
      'model_reasoning_effort="high"',
      "--sandbox",
      "read-only",
      "--profile",
      "ci",
      "Read /x/RUN_CONTEXT.md and follow it exactly.",
    ]);
  });

  test("falls back to workspace-write when sandbox is null", () => {
    const argv = buildCodexArgv(
      { ...DEFAULT_AGENT, sandbox: null },
      "/x/RUN_CONTEXT.md",
    );
    expect(argv).toContain("--sandbox");
    expect(argv[argv.indexOf("--sandbox") + 1]).toBe("workspace-write");
  });
});

// ---------------------------------------------------------------------------
// detectOutcome
// ---------------------------------------------------------------------------

describe("detectOutcome", () => {
  test("detects a standalone RALPH_NEXT line", () => {
    expect(detectOutcome("doing work\nRALPH_NEXT\n")).toBe("RALPH_NEXT");
  });

  test("detects a standalone RALPH_DONE line", () => {
    expect(detectOutcome("all tasks complete\nRALPH_DONE")).toBe("RALPH_DONE");
  });

  test("tolerates surrounding whitespace on the outcome line", () => {
    expect(detectOutcome("  RALPH_BLOCKED  \n")).toBe("RALPH_BLOCKED");
  });

  test("ignores embedded, non-standalone keywords", () => {
    expect(detectOutcome("emit RALPH_NEXT when finished")).toBeUndefined();
    expect(detectOutcome("the RALPH_DONE keyword means done")).toBeUndefined();
  });

  test("returns undefined when no keyword appears", () => {
    expect(detectOutcome("just some output\nno keyword here")).toBeUndefined();
  });

  test("RALPH_BLOCKED wins when more than one distinct keyword appears", () => {
    expect(detectOutcome("RALPH_NEXT\nRALPH_DONE")).toBe("RALPH_BLOCKED");
  });

  test("a single keyword repeated is still that keyword", () => {
    expect(detectOutcome("RALPH_NEXT\nmore\nRALPH_NEXT")).toBe("RALPH_NEXT");
  });
});

// ---------------------------------------------------------------------------
// Artifact paths
// ---------------------------------------------------------------------------

describe("agent iteration artifact paths", () => {
  test("are stable and under agent-iterations/<n>/", () => {
    const dir = agentIterationDir("/run", 2);
    expect(dir).toBe(join("/run", "agent-iterations", "2"));

    const artifacts = agentIterationArtifacts("/run", 2);
    expect(artifacts.dir).toBe(dir);
    expect(artifacts.stdoutLog).toBe(join(dir, "stdout.log"));
    expect(artifacts.stderrLog).toBe(join(dir, "stderr.log"));
    expect(artifacts.progressBefore).toBe(join(dir, "progress.before.json"));
    expect(artifacts.progressAfter).toBe(join(dir, "progress.after.json"));
    expect(artifacts.summary).toBe(join(dir, "summary.json"));
  });
});

// ---------------------------------------------------------------------------
// runAgentIteration
// ---------------------------------------------------------------------------

describe("runAgentIteration", () => {
  async function setupRun(): Promise<{ runDir: string; progressPath: string }> {
    const runDir = join(tmp, "runs", "R1");
    await mkdir(runDir, { recursive: true });
    const progressPath = join(tmp, "progress.json");
    await writeFile(
      progressPath,
      JSON.stringify({ tasks: [{ id: "001", status: "pending", spec: "tasks/001.md", dependencies: [] }] }) + "\n",
    );
    return { runDir, progressPath };
  }

  test("captures artifacts and detects the outcome", async () => {
    const { runDir, progressPath } = await setupRun();
    const calls: SpawnCall[] = [];
    const spawn = fakeSpawn(
      { stdout: "work\nRALPH_NEXT\n", stderr: "warn", exitCode: 0 },
      calls,
    );

    const result = await runAgentIteration({
      config: makeConfig(),
      workPlane: tmp,
      runDir,
      progressPath,
      runContextPath: join(runDir, "RUN_CONTEXT.md"),
      iteration: 1,
      spawn,
    });

    expect(result.outcome).toBe("RALPH_NEXT");
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);

    // Artifacts written under agent-iterations/1/.
    expect(await readFile(result.artifacts.stdoutLog, "utf8")).toBe("work\nRALPH_NEXT\n");
    expect(await readFile(result.artifacts.stderrLog, "utf8")).toBe("warn");

    // Progress snapshots match the authoritative progress.json.
    const expectedProgress = await readFile(progressPath, "utf8");
    expect(await readFile(result.artifacts.progressBefore, "utf8")).toBe(expectedProgress);
    expect(await readFile(result.artifacts.progressAfter, "utf8")).toBe(expectedProgress);
  });

  test("passes codex argv, work-plane cwd, and the configured timeout", async () => {
    const { runDir, progressPath } = await setupRun();
    const calls: SpawnCall[] = [];
    const spawn = fakeSpawn({ stdout: "RALPH_DONE" }, calls);

    await runAgentIteration({
      config: makeConfig({ agentTimeoutSeconds: 42 }),
      workPlane: tmp,
      runDir,
      progressPath,
      runContextPath: "/ctx/RUN_CONTEXT.md",
      iteration: 1,
      spawn,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.command).toBe("codex");
    expect(call.argv).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "Read /ctx/RUN_CONTEXT.md and follow it exactly.",
    ]);
    expect(call.options.cwd).toBe(tmp);
    expect(call.options.timeoutMs).toBe(42_000);
  });

  test("records a timeout and yields no outcome even if stdout had a keyword", async () => {
    const { runDir, progressPath } = await setupRun();
    const spawn = fakeSpawn({ stdout: "RALPH_NEXT\n", timedOut: true, exitCode: null });

    const result = await runAgentIteration({
      config: makeConfig(),
      workPlane: tmp,
      runDir,
      progressPath,
      runContextPath: join(runDir, "RUN_CONTEXT.md"),
      iteration: 3,
      spawn,
    });

    expect(result.timedOut).toBe(true);
    expect(result.outcome).toBeUndefined();
    // Artifacts are still captured on timeout.
    expect(await readFile(result.artifacts.stdoutLog, "utf8")).toBe("RALPH_NEXT\n");
  });

  test("falls back to an empty snapshot when progress.json is missing", async () => {
    const runDir = join(tmp, "runs", "R2");
    await mkdir(runDir, { recursive: true });
    const spawn = fakeSpawn({ stdout: "RALPH_BLOCKED" });

    const result = await runAgentIteration({
      config: makeConfig(),
      workPlane: tmp,
      runDir,
      progressPath: join(tmp, "does-not-exist.json"),
      runContextPath: join(runDir, "RUN_CONTEXT.md"),
      iteration: 1,
      spawn,
    });

    expect(result.outcome).toBe("RALPH_BLOCKED");
    expect(await readFile(result.artifacts.progressBefore, "utf8")).toBe("{}\n");
  });
});
