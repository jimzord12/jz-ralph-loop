import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildIterationSummary,
  verifyAndSummarize,
  verifyProgressTransition,
  type IterationSummary,
  type VerificationResult,
} from "../src/verify";
import {
  agentIterationArtifacts,
  type AgentIterationResult,
} from "../src/agent";
import type { ProgressEntry, ProgressJson } from "../src/commands/loop";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ralph-verify-test-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function entry(
  id: string,
  status: ProgressEntry["status"],
  dependencies: string[] = [],
): ProgressEntry {
  return { id, status, spec: `tasks/${id}.md`, dependencies };
}

function prog(...tasks: ProgressEntry[]): ProgressJson {
  return { tasks };
}

// ---------------------------------------------------------------------------
// verifyProgressTransition — RALPH_NEXT
// ---------------------------------------------------------------------------

describe("verifyProgressTransition: RALPH_NEXT", () => {
  test("valid when it completes only the selected eligible task", () => {
    const before = prog(entry("001", "pending"), entry("002", "pending", ["001"]));
    const after = prog(entry("001", "complete"), entry("002", "pending", ["001"]));

    const result = verifyProgressTransition(before, after, "RALPH_NEXT");

    expect(result.status).toBe("valid");
    expect(result.selectedTaskId).toBe("001");
    expect(result.newlyCompleted).toEqual(["001"]);
  });

  test("rejected with zero completed tasks", () => {
    const before = prog(entry("001", "pending"));
    const after = prog(entry("001", "pending"));

    const result = verifyProgressTransition(before, after, "RALPH_NEXT");

    expect(result.status).toBe("rejected");
    expect(result.reason).toMatch(/zero/i);
  });

  test("rejected with more than one newly completed task", () => {
    const before = prog(entry("001", "pending"), entry("002", "pending"));
    const after = prog(entry("001", "complete"), entry("002", "complete"));

    const result = verifyProgressTransition(before, after, "RALPH_NEXT");

    expect(result.status).toBe("rejected");
    expect(result.reason).toMatch(/multiple/i);
    expect(result.newlyCompleted).toEqual(["001", "002"]);
  });

  test("rejected when it completes a task other than the selected one", () => {
    const before = prog(entry("001", "pending"), entry("002", "pending"));
    const after = prog(entry("001", "pending"), entry("002", "complete"));

    const result = verifyProgressTransition(before, after, "RALPH_NEXT");

    expect(result.status).toBe("rejected");
    expect(result.selectedTaskId).toBe("001");
    expect(result.reason).toContain("002");
    expect(result.reason).toContain("001");
  });
});

// ---------------------------------------------------------------------------
// verifyProgressTransition — RALPH_DONE
// ---------------------------------------------------------------------------

describe("verifyProgressTransition: RALPH_DONE", () => {
  test("valid when no pending tasks remain and nothing was completed", () => {
    const before = prog(entry("001", "complete"));
    const after = prog(entry("001", "complete"));

    const result = verifyProgressTransition(before, after, "RALPH_DONE");

    expect(result.status).toBe("valid");
  });

  test("rejected while pending tasks remain", () => {
    const before = prog(entry("001", "complete"), entry("002", "pending"));
    const after = prog(entry("001", "complete"), entry("002", "pending"));

    const result = verifyProgressTransition(before, after, "RALPH_DONE");

    expect(result.status).toBe("rejected");
    expect(result.reason).toMatch(/pending/i);
  });

  test("rejected with newly completed tasks", () => {
    const before = prog(entry("001", "pending"));
    const after = prog(entry("001", "complete"));

    const result = verifyProgressTransition(before, after, "RALPH_DONE");

    expect(result.status).toBe("rejected");
    expect(result.newlyCompleted).toEqual(["001"]);
  });
});

// ---------------------------------------------------------------------------
// verifyProgressTransition — RALPH_BLOCKED
// ---------------------------------------------------------------------------

describe("verifyProgressTransition: RALPH_BLOCKED", () => {
  test("valid blocked state when no task was newly completed", () => {
    const before = prog(entry("001", "pending"));
    const after = prog(entry("001", "pending"));

    const result = verifyProgressTransition(before, after, "RALPH_BLOCKED");

    expect(result.status).toBe("blocked");
  });

  test("rejected when a task was newly completed", () => {
    const before = prog(entry("001", "pending"));
    const after = prog(entry("001", "complete"));

    const result = verifyProgressTransition(before, after, "RALPH_BLOCKED");

    expect(result.status).toBe("rejected");
    expect(result.newlyCompleted).toEqual(["001"]);
  });
});

// ---------------------------------------------------------------------------
// verifyProgressTransition — missing outcome / timeout
// ---------------------------------------------------------------------------

describe("verifyProgressTransition: missing outcome and timeout", () => {
  test("rejected when the outcome keyword is missing", () => {
    const before = prog(entry("001", "pending"));
    const after = prog(entry("001", "complete"));

    const result = verifyProgressTransition(before, after, undefined);

    expect(result.status).toBe("rejected");
    expect(result.reason).toMatch(/outcome/i);
  });

  test("rejected on timeout regardless of stdout", () => {
    const before = prog(entry("001", "pending"));
    const after = prog(entry("001", "complete"));

    const result = verifyProgressTransition(before, after, "RALPH_NEXT", true);

    expect(result.status).toBe("rejected");
    expect(result.reason).toMatch(/timed out/i);
  });
});

// ---------------------------------------------------------------------------
// buildIterationSummary / verifyAndSummarize
// ---------------------------------------------------------------------------

describe("summary.json", () => {
  function makeResult(
    artifactsDir: string,
    iteration: number,
    overrides: Partial<AgentIterationResult> = {},
  ): AgentIterationResult {
    const artifacts = agentIterationArtifacts(artifactsDir, iteration);
    return {
      iteration,
      outcome: "RALPH_NEXT",
      timedOut: false,
      exitCode: 0,
      argv: ["exec"],
      artifacts,
      ...overrides,
    };
  }

  test("buildIterationSummary records classification and reason", () => {
    const verification: VerificationResult = {
      status: "rejected",
      outcome: "RALPH_NEXT",
      reason: "RALPH_NEXT completed zero tasks",
      selectedTaskId: "001",
      newlyCompleted: [],
    };
    const result = makeResult("/run", 2, { outcome: "RALPH_NEXT" });

    const summary = buildIterationSummary(result, verification);

    expect(summary).toEqual({
      iteration: 2,
      outcome: "RALPH_NEXT",
      status: "rejected",
      rejected: true,
      reason: "RALPH_NEXT completed zero tasks",
      selectedTaskId: "001",
      newlyCompleted: [],
      timedOut: false,
    } satisfies IterationSummary);
  });

  test("verifyAndSummarize reads snapshots, classifies, and writes summary.json", async () => {
    const runDir = join(tmp, "run");
    const result = makeResult(runDir, 1, { outcome: "RALPH_NEXT" });
    await mkdir(result.artifacts.dir, { recursive: true });
    await writeFile(
      result.artifacts.progressBefore,
      JSON.stringify(prog(entry("001", "pending"))),
    );
    await writeFile(
      result.artifacts.progressAfter,
      JSON.stringify(prog(entry("001", "complete"))),
    );

    const summary = await verifyAndSummarize(result);

    expect(summary.status).toBe("valid");
    expect(summary.selectedTaskId).toBe("001");

    const written = JSON.parse(
      await readFile(result.artifacts.summary, "utf8"),
    ) as IterationSummary;
    expect(written.status).toBe("valid");
    expect(written.reason).toBeTruthy();
    expect(written.newlyCompleted).toEqual(["001"]);
  });

  test("verifyAndSummarize tolerates an empty progress snapshot", async () => {
    const runDir = join(tmp, "run");
    const result = makeResult(runDir, 1, { outcome: undefined, exitCode: null });
    await mkdir(result.artifacts.dir, { recursive: true });
    await writeFile(result.artifacts.progressBefore, "{}\n");
    await writeFile(result.artifacts.progressAfter, "{}\n");

    const summary = await verifyAndSummarize(result);

    expect(summary.status).toBe("rejected");
    expect(summary.reason).toMatch(/outcome/i);
  });
});
