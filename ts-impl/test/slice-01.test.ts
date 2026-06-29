import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isInsideGitRepo, runInit } from "../src/commands/init";
import { getDocs } from "../src/commands/docs";
import { runLoopCreate, runLoopList, runLoopStatus } from "../src/commands/loop";
import { validateInstallation, validateLoop } from "../src/commands/validate";
import { RalphError } from "../src/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ralph-test-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Creates a minimal git repo inside a directory (just a .git dir placeholder). */
async function makeGitRepo(dir: string): Promise<void> {
  await mkdir(join(dir, ".git"), { recursive: true });
}

/** Creates a valid Ralph installation inside `dir`. */
async function makeInstallation(dir: string): Promise<string> {
  const ralphDir = join(dir, ".jz-ralph");
  await makeGitRepo(dir);
  await runInit(ralphDir, dir);
  return ralphDir;
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

/** Writes a task source directory with the given files (filename -> content). */
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

// ---------------------------------------------------------------------------
// isInsideGitRepo
// ---------------------------------------------------------------------------

describe("isInsideGitRepo", () => {
  test("returns true when .git exists in cwd", async () => {
    await makeGitRepo(tmp);
    expect(await isInsideGitRepo(tmp)).toBe(true);
  });

  test("returns true when .git exists in an ancestor", async () => {
    await makeGitRepo(tmp);
    const sub = join(tmp, "a", "b", "c");
    await mkdir(sub, { recursive: true });
    expect(await isInsideGitRepo(sub)).toBe(true);
  });

  test("returns false when no .git ancestor exists", async () => {
    // tmp itself has no .git and tmpdir() is not a git repo
    expect(await isInsideGitRepo(tmp)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

describe("init", () => {
  test("creates the expected installation layout", async () => {
    await makeGitRepo(tmp);
    const ralphDir = join(tmp, ".jz-ralph");
    await runInit(ralphDir, tmp);

    const { stat } = await import("node:fs/promises");
    expect((await stat(join(ralphDir, "config.json"))).isFile()).toBe(true);
    expect((await stat(join(ralphDir, "AGENTS.md"))).isFile()).toBe(true);
    expect((await stat(join(ralphDir, "KNOWLEDGE.md"))).isFile()).toBe(true);
    expect((await stat(join(ralphDir, "loops"))).isDirectory()).toBe(true);
  });

  test("config.json contains required fields", async () => {
    await makeGitRepo(tmp);
    const ralphDir = join(tmp, ".jz-ralph");
    await runInit(ralphDir, tmp);

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(ralphDir, "config.json"), "utf8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config["workPlane"]).toBe(".");
    expect(config["qualityGate"]).toBe("bun test");
    expect(typeof (config["agent"] as Record<string, unknown>)?.["kind"]).toBe("string");
    expect(config["maxRejectedIterations"]).toBe(3);
    expect(config["commitRunArtifacts"]).toBe(false);
  });

  test("fails if .jz-ralph/ already exists", async () => {
    await makeGitRepo(tmp);
    const ralphDir = join(tmp, ".jz-ralph");
    await runInit(ralphDir, tmp);

    await expect(runInit(ralphDir, tmp)).rejects.toBeInstanceOf(RalphError);
    await expect(runInit(ralphDir, tmp)).rejects.toMatchObject({ exitCode: 2 });
  });

  test("fails outside a git repository", async () => {
    const ralphDir = join(tmp, ".jz-ralph");
    // tmp has no .git
    await expect(runInit(ralphDir, tmp)).rejects.toBeInstanceOf(RalphError);
    await expect(runInit(ralphDir, tmp)).rejects.toMatchObject({ exitCode: 2 });
  });
});

// ---------------------------------------------------------------------------
// loop create
// ---------------------------------------------------------------------------

describe("loop create", () => {
  test("imports valid task specs and creates loop structure", async () => {
    const ralphDir = await makeInstallation(tmp);
    const srcDir = await makeTaskSource(tmp, {
      "001-task-a.md": VALID_SPEC_A,
      "002-task-b.md": VALID_SPEC_B,
    });

    await runLoopCreate(ralphDir, "demo", srcDir);

    const { stat, readFile } = await import("node:fs/promises");
    const loopDir = join(ralphDir, "loops", "demo");
    expect((await stat(join(loopDir, "loop.json"))).isFile()).toBe(true);
    expect((await stat(join(loopDir, "progress.json"))).isFile()).toBe(true);
    expect((await stat(join(loopDir, "HANDOFF.md"))).isFile()).toBe(true);
    expect((await stat(join(loopDir, "tasks"))).isDirectory()).toBe(true);
    expect((await stat(join(loopDir, "runs"))).isDirectory()).toBe(true);

    // Task files copied
    expect((await stat(join(loopDir, "tasks", "001-task-a.md"))).isFile()).toBe(true);
    expect((await stat(join(loopDir, "tasks", "002-task-b.md"))).isFile()).toBe(true);

    // progress.json shape
    const raw = await readFile(join(loopDir, "progress.json"), "utf8");
    const p = JSON.parse(raw) as { tasks: Array<Record<string, unknown>> };
    expect(p.tasks.length).toBe(2);
    expect(p.tasks[0]?.["id"]).toBe("001-task-a");
    expect(p.tasks[0]?.["status"]).toBe("pending");
    expect(p.tasks[0]?.["spec"]).toBe("tasks/001-task-a.md");
    expect(p.tasks[0]?.["dependencies"]).toEqual([]);
    expect(p.tasks[1]?.["dependencies"]).toEqual(["001-task-a"]);
  });

  test("sorts task files lexically", async () => {
    const ralphDir = await makeInstallation(tmp);
    const srcDir = await makeTaskSource(tmp, {
      "003-task-c.md": VALID_SPEC_A.replace("Task A", "Task C"),
      "001-task-a.md": VALID_SPEC_A,
      "002-task-b.md": VALID_SPEC_A.replace("Task A", "Task B"),
    });
    await runLoopCreate(ralphDir, "demo", srcDir);

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(ralphDir, "loops", "demo", "progress.json"), "utf8");
    const p = JSON.parse(raw) as { tasks: Array<Record<string, unknown>> };
    expect(p.tasks.map((t) => t["id"])).toEqual(["001-task-a", "002-task-b", "003-task-c"]);
  });

  test("fails if loop name already exists", async () => {
    const ralphDir = await makeInstallation(tmp);
    const srcDir = await makeTaskSource(tmp, { "001-task-a.md": VALID_SPEC_A });
    await runLoopCreate(ralphDir, "demo", srcDir);

    await expect(runLoopCreate(ralphDir, "demo", srcDir)).rejects.toBeInstanceOf(RalphError);
    await expect(runLoopCreate(ralphDir, "demo", srcDir)).rejects.toMatchObject({ exitCode: 2 });
  });

  test("fails if --from directory does not exist", async () => {
    const ralphDir = await makeInstallation(tmp);
    await expect(
      runLoopCreate(ralphDir, "demo", join(tmp, "nonexistent")),
    ).rejects.toMatchObject({ exitCode: 2 });
  });

  test("fails if --from is not a directory", async () => {
    const ralphDir = await makeInstallation(tmp);
    const file = join(tmp, "not-a-dir.txt");
    await writeFile(file, "hello");
    await expect(runLoopCreate(ralphDir, "demo", file)).rejects.toMatchObject({ exitCode: 2 });
  });

  test("fails on invalid task filenames (skips non-md files)", async () => {
    const ralphDir = await makeInstallation(tmp);
    const srcDir = await makeTaskSource(tmp, {
      "no-extension": VALID_SPEC_A,
    });
    // Only non-.md files — no valid task files found
    await expect(runLoopCreate(ralphDir, "demo", srcDir)).rejects.toMatchObject({ exitCode: 2 });
  });

  test("fails on tasks with missing required headings", async () => {
    const ralphDir = await makeInstallation(tmp);
    const badSpec = `# Bad Task\n\n## Objective\nSomething.\n`;
    const srcDir = await makeTaskSource(tmp, { "001-bad.md": badSpec });
    await expect(runLoopCreate(ralphDir, "demo", srcDir)).rejects.toMatchObject({
      exitCode: 3,
    });
  });

  test("fails on tasks with unknown dependency references", async () => {
    const ralphDir = await makeInstallation(tmp);
    const spec = VALID_SPEC_A.replace("Blocked By\nNone", "Blocked By\n- 999-missing");
    const srcDir = await makeTaskSource(tmp, { "001-task-a.md": spec });
    await expect(runLoopCreate(ralphDir, "demo", srcDir)).rejects.toMatchObject({
      exitCode: 3,
    });
  });

  test("fails on tasks with dependency cycles", async () => {
    const ralphDir = await makeInstallation(tmp);
    const specA = VALID_SPEC_A.replace("Blocked By\nNone", "Blocked By\n- 002-task-b");
    const specB = VALID_SPEC_B.replace("- 001-task-a", "- 001-task-a");
    // Make B depend on A, but here A also depends on B => cycle
    const specAcycle = VALID_SPEC_A.replace("Blocked By\nNone", "Blocked By\n- 002-task-b");
    const srcDir = await makeTaskSource(tmp, {
      "001-task-a.md": specAcycle,
      "002-task-b.md": specB,
    });
    await expect(runLoopCreate(ralphDir, "demo", srcDir)).rejects.toMatchObject({
      exitCode: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// loop list
// ---------------------------------------------------------------------------

describe("loop list", () => {
  test("returns empty array when no loops exist", async () => {
    const ralphDir = await makeInstallation(tmp);
    expect(await runLoopList(ralphDir)).toEqual([]);
  });

  test("returns loop names sorted", async () => {
    const ralphDir = await makeInstallation(tmp);
    const srcDir = await makeTaskSource(tmp, { "001-task-a.md": VALID_SPEC_A });
    await runLoopCreate(ralphDir, "beta", srcDir);
    await runLoopCreate(ralphDir, "alpha", srcDir);
    expect(await runLoopList(ralphDir)).toEqual(["alpha", "beta"]);
  });
});

// ---------------------------------------------------------------------------
// loop status
// ---------------------------------------------------------------------------

describe("loop status", () => {
  test("reports counts and eligible task", async () => {
    const ralphDir = await makeInstallation(tmp);
    const srcDir = await makeTaskSource(tmp, {
      "001-task-a.md": VALID_SPEC_A,
      "002-task-b.md": VALID_SPEC_B,
    });
    await runLoopCreate(ralphDir, "demo", srcDir);

    const status = await runLoopStatus(ralphDir, "demo");
    expect(status.name).toBe("demo");
    expect(status.total).toBe(2);
    expect(status.pending).toBe(2);
    expect(status.complete).toBe(0);
    expect(status.blocked).toBe(0);
    // 001-task-a has no deps, so it is eligible
    expect(status.eligibleTaskId).toBe("001-task-a");
  });

  test("eligible task is none when all pending have unsatisfied deps", async () => {
    const ralphDir = await makeInstallation(tmp);
    // specB depends on 001-task-a. Only specB in the set (but that would fail dep validation).
    // Instead: make specB depend on specC which is blocked.
    const specC = VALID_SPEC_A.replace("Task A", "Task C");
    const specBdepC = VALID_SPEC_B.replace("- 001-task-a", "- 003-task-c");
    const srcDir = await makeTaskSource(tmp, {
      "002-task-b.md": specBdepC,
      "003-task-c.md": specC,
    });
    await runLoopCreate(ralphDir, "demo", srcDir);

    // Manually mark 003-task-c as blocked in progress.json
    const { readFile, writeFile: wf } = await import("node:fs/promises");
    const path = join(ralphDir, "loops", "demo", "progress.json");
    const p = JSON.parse(await readFile(path, "utf8")) as {
      tasks: Array<{ id: string; status: string; spec: string; dependencies: string[] }>;
    };
    for (const t of p.tasks) {
      if (t.id === "003-task-c") t.status = "blocked";
    }
    await wf(path, JSON.stringify(p, null, 2) + "\n");

    const status = await runLoopStatus(ralphDir, "demo");
    expect(status.eligibleTaskId).toBeUndefined();
  });

  test("fails if loop does not exist", async () => {
    const ralphDir = await makeInstallation(tmp);
    await expect(runLoopStatus(ralphDir, "nonexistent")).rejects.toBeInstanceOf(RalphError);
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("validateInstallation", () => {
  test("passes for a valid installation", async () => {
    const ralphDir = await makeInstallation(tmp);
    await expect(validateInstallation(ralphDir)).resolves.toBeUndefined();
  });

  test("fails when required files are missing", async () => {
    const ralphDir = join(tmp, ".jz-ralph");
    await mkdir(ralphDir, { recursive: true });
    await expect(validateInstallation(ralphDir)).rejects.toBeInstanceOf(RalphError);
  });

  test("fails when config.json is not valid JSON", async () => {
    const ralphDir = await makeInstallation(tmp);
    await writeFile(join(ralphDir, "config.json"), "not json");
    await expect(validateInstallation(ralphDir)).rejects.toBeInstanceOf(RalphError);
  });

  test("fails when config.json is missing required fields", async () => {
    const ralphDir = await makeInstallation(tmp);
    await writeFile(join(ralphDir, "config.json"), JSON.stringify({ workPlane: "." }));
    await expect(validateInstallation(ralphDir)).rejects.toBeInstanceOf(RalphError);
  });
});

describe("validateLoop", () => {
  test("passes for a valid loop", async () => {
    const ralphDir = await makeInstallation(tmp);
    const srcDir = await makeTaskSource(tmp, { "001-task-a.md": VALID_SPEC_A });
    await runLoopCreate(ralphDir, "demo", srcDir);
    await expect(validateLoop(ralphDir, "demo")).resolves.toBeUndefined();
  });

  test("fails when loop directory is missing", async () => {
    const ralphDir = await makeInstallation(tmp);
    await expect(validateLoop(ralphDir, "nonexistent")).rejects.toBeInstanceOf(RalphError);
  });

  test("fails when progress.json is invalid JSON", async () => {
    const ralphDir = await makeInstallation(tmp);
    const srcDir = await makeTaskSource(tmp, { "001-task-a.md": VALID_SPEC_A });
    await runLoopCreate(ralphDir, "demo", srcDir);
    await writeFile(join(ralphDir, "loops", "demo", "progress.json"), "bad json");
    await expect(validateLoop(ralphDir, "demo")).rejects.toBeInstanceOf(RalphError);
  });

  test("fails when a task file has invalid spec", async () => {
    const ralphDir = await makeInstallation(tmp);
    const srcDir = await makeTaskSource(tmp, { "001-task-a.md": VALID_SPEC_A });
    await runLoopCreate(ralphDir, "demo", srcDir);
    // Overwrite the task file with a bad spec
    await writeFile(
      join(ralphDir, "loops", "demo", "tasks", "001-task-a.md"),
      "# Bad\n\n## Objective\nonly one heading\n",
    );
    await expect(validateLoop(ralphDir, "demo")).rejects.toBeInstanceOf(RalphError);
  });
});

// ---------------------------------------------------------------------------
// docs
// ---------------------------------------------------------------------------

describe("getDocs", () => {
  test("returns the index when no section specified", () => {
    const result = getDocs([]);
    expect(result).toContain("ralph-loop docs overview");
    expect(result).toContain("ralph-loop docs examples simple");
  });

  test("returns content for a top-level section", () => {
    const result = getDocs(["overview"]);
    expect(result).toBeDefined();
    expect(result).toContain("ralph-loop");
  });

  test("exit-codes is an alias for status-codes", () => {
    const a = getDocs(["status-codes"]);
    const b = getDocs(["exit-codes"]);
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });

  test("resolves nested sections with space-separated parts", () => {
    const result = getDocs(["examples", "simple"]);
    expect(result).toBeDefined();
    expect(result).toContain("ralph-loop init");
  });

  test("resolves nested sections with slash-separated parts", () => {
    const result = getDocs(["examples/simple"]);
    expect(result).toBeDefined();
    expect(getDocs(["examples", "simple"])).toBe(getDocs(["examples/simple"]));
  });

  test("returns undefined for unknown sections", () => {
    expect(getDocs(["does-not-exist"])).toBeUndefined();
  });

  test("returns examples index for docs examples", () => {
    const result = getDocs(["examples"]);
    expect(result).toBeDefined();
    expect(result).toContain("examples simple");
    expect(result).toContain("examples advanced");
  });
});
