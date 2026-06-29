import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { runInit } from "../src/commands/init";
import { runLoopCreate } from "../src/commands/loop";
import { formatRunId, runSetup } from "../src/commands/run";
import { RalphError } from "../src/errors";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ralph-run-test-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Initializes a real git repo so `git status --porcelain` works. */
async function makeRealGitRepo(dir: string): Promise<void> {
  await execFileAsync("git", ["init", "-q"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
}

/** Commits everything so the worktree is clean. */
async function commitAll(dir: string, message: string): Promise<void> {
  await execFileAsync("git", ["add", "-A"], { cwd: dir });
  await execFileAsync("git", ["commit", "-q", "-m", message], { cwd: dir });
}

const VALID_SPEC_A = `# Task A

## Objective
Do A.

## Scope
File a.ts

## Out Of Scope
File b.ts

## Blocked By
None

## Acceptance Criteria
- A done

## Verification
bun test
`;

const VALID_SPEC_B = `# Task B

## Objective
Do B.

## Scope
File b.ts

## Out Of Scope
Other files.

## Blocked By
- 001-task-a

## Acceptance Criteria
- B done

## Verification
bun test
`;

async function makeTaskSource(
  dir: string,
  files: Record<string, string>,
): Promise<string> {
  const srcDir = join(dir, "tasks-src");
  await mkdir(srcDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(srcDir, name), content);
  }
  return srcDir;
}

/**
 * Builds a real git repo with a `.jz-ralph` installation and a `demo` loop,
 * then commits so the worktree is clean. Returns the ralphDir.
 * `.gitignore` does NOT ignore `.jz-ralph` here, so committing makes it clean.
 */
async function makeRunnableLoop(
  dir: string,
  files: Record<string, string>,
): Promise<string> {
  await makeRealGitRepo(dir);
  const ralphDir = join(dir, ".jz-ralph");
  await runInit(ralphDir, dir);
  const srcDir = await makeTaskSource(dir, files);
  await runLoopCreate(ralphDir, "demo", srcDir);
  await commitAll(dir, "init ralph");
  return ralphDir;
}

// ---------------------------------------------------------------------------
// formatRunId
// ---------------------------------------------------------------------------

describe("formatRunId", () => {
  test("produces a filesystem-safe, sortable id", () => {
    const id = formatRunId(new Date("2026-06-29T19:12:30.000Z"));
    expect(id).toBe("2026-06-29T191230Z");
    expect(id).not.toContain(":");
  });
});

// ---------------------------------------------------------------------------
// runSetup — failures
// ---------------------------------------------------------------------------

describe("runSetup failures", () => {
  test("fails for an invalid installation", async () => {
    await makeRealGitRepo(tmp);
    const ralphDir = join(tmp, ".jz-ralph");
    await mkdir(ralphDir, { recursive: true });
    await expect(runSetup(ralphDir, "demo", { cwd: tmp })).rejects.toMatchObject({
      exitCode: 3,
    });
  });

  test("fails for an unknown loop", async () => {
    await makeRealGitRepo(tmp);
    const ralphDir = join(tmp, ".jz-ralph");
    await runInit(ralphDir, tmp);
    await commitAll(tmp, "init");
    await expect(runSetup(ralphDir, "nope", { cwd: tmp })).rejects.toMatchObject({
      exitCode: 3,
    });
  });

  test("fails outside a Git repository", async () => {
    // No git init: .jz-ralph created but cwd is not a repo.
    const ralphDir = join(tmp, ".jz-ralph");
    // runInit requires a git repo, so create a fake .git, init, then remove .git.
    await mkdir(join(tmp, ".git"), { recursive: true });
    await runInit(ralphDir, tmp);
    const srcDir = await makeTaskSource(tmp, { "001-task-a.md": VALID_SPEC_A });
    await runLoopCreate(ralphDir, "demo", srcDir);
    await rm(join(tmp, ".git"), { recursive: true, force: true });

    await expect(runSetup(ralphDir, "demo", { cwd: tmp })).rejects.toMatchObject({
      exitCode: 3,
    });
  });

  test("fails with a dirty worktree", async () => {
    const ralphDir = await makeRunnableLoop(tmp, { "001-task-a.md": VALID_SPEC_A });
    // Dirty the worktree with an untracked tracked-able file.
    await writeFile(join(tmp, "dirty.txt"), "uncommitted");

    await expect(runSetup(ralphDir, "demo", { cwd: tmp })).rejects.toMatchObject({
      exitCode: 3,
    });
    await expect(runSetup(ralphDir, "demo", { cwd: tmp })).rejects.toBeInstanceOf(
      RalphError,
    );
  });
});

// ---------------------------------------------------------------------------
// runSetup — success
// ---------------------------------------------------------------------------

describe("runSetup success", () => {
  test("creates the Run directory and RUN_CONTEXT.md", async () => {
    const ralphDir = await makeRunnableLoop(tmp, {
      "001-task-a.md": VALID_SPEC_A,
      "002-task-b.md": VALID_SPEC_B,
    });

    const result = await runSetup(ralphDir, "demo", {
      cwd: tmp,
      runId: "2026-06-29T120000Z",
    });

    const { stat } = await import("node:fs/promises");
    expect((await stat(result.runDir)).isDirectory()).toBe(true);
    expect((await stat(result.runContextPath)).isFile()).toBe(true);

    const ctx = await readFile(result.runContextPath, "utf8");
    expect(ctx).toContain("Loop name: demo");
    expect(ctx).toContain("Run id: 2026-06-29T120000Z");
    expect(ctx).toContain("RALPH_NEXT");
    expect(ctx).toContain("001-task-a");
  });

  test("selects the eligible task, not a dependency-blocked one", async () => {
    const ralphDir = await makeRunnableLoop(tmp, {
      "001-task-a.md": VALID_SPEC_A,
      "002-task-b.md": VALID_SPEC_B,
    });

    const result = await runSetup(ralphDir, "demo", { cwd: tmp });

    // 001-task-a has no deps -> eligible. 002-task-b depends on 001 -> blocked.
    expect(result.eligibleTask?.id).toBe("001-task-a");
    expect(result.eligibleTask?.spec).toBe("tasks/001-task-a.md");
    expect(result.blockedPending.map((t) => t.id)).toEqual(["002-task-b"]);
    expect(result.blockedPending[0]?.missingDependencies).toEqual(["001-task-a"]);
  });

  test("computes caps from pending count and configured rejection cap", async () => {
    const ralphDir = await makeRunnableLoop(tmp, {
      "001-task-a.md": VALID_SPEC_A,
      "002-task-b.md": VALID_SPEC_B,
    });

    const result = await runSetup(ralphDir, "demo", { cwd: tmp });

    // 2 pending tasks, default maxRejectedIterations = 3 -> cap = 2 + 3 + 1 = 6.
    expect(result.pendingCount).toBe(2);
    expect(result.maxRejectedIterations).toBe(3);
    expect(result.agentIterationCap).toBe(6);
    expect(result.rejectedCount).toBe(0);
    expect(result.agentIteration).toBe(1);
  });

  test("honors a non-default maxRejectedIterations in config", async () => {
    const ralphDir = await makeRunnableLoop(tmp, {
      "001-task-a.md": VALID_SPEC_A,
    });
    // Rewrite config with a different rejection cap, then re-commit clean.
    const configPath = join(ralphDir, "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    config["maxRejectedIterations"] = 5;
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
    await commitAll(tmp, "bump rejection cap");

    const result = await runSetup(ralphDir, "demo", { cwd: tmp });
    // 1 pending + 5 + 1 = 7
    expect(result.agentIterationCap).toBe(7);
  });
});
