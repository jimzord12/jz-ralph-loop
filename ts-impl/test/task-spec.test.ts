import { describe, expect, test } from "bun:test";

import {
  isValidTaskFilename,
  taskIdFromFilename,
  parseTaskSpec,
  validateTaskDependencies,
  selectEligibleTask,
  type ProgressTask,
} from "../src/task-spec";

const VALID_SPEC = `# Add refresh tokens

## Objective
Add refresh-token support.

## Scope
The auth module.

## Out Of Scope
Unrelated UI work.

## Blocked By
None

## Acceptance Criteria
- Tokens refresh
- Tests pass

## Verification
bun test
`;

function specWith(blockedBy: string): string {
  return `# Title

## Objective
o

## Scope
s

## Out Of Scope
oos

## Blocked By
${blockedBy}

## Acceptance Criteria
- a

## Verification
v
`;
}

describe("isValidTaskFilename", () => {
  test("accepts contract-compliant filenames", () => {
    expect(isValidTaskFilename("001-task.md")).toBe(true);
    expect(isValidTaskFilename("a.md")).toBe(true);
    expect(isValidTaskFilename("task_one.test.md")).toBe(true);
    expect(isValidTaskFilename("Task-1.md")).toBe(true);
  });

  test("rejects invalid filenames", () => {
    expect(isValidTaskFilename("-leading-dash.md")).toBe(false);
    expect(isValidTaskFilename(".hidden.md")).toBe(false);
    expect(isValidTaskFilename("no-extension")).toBe(false);
    expect(isValidTaskFilename("spaces here.md")).toBe(false);
    expect(isValidTaskFilename("task.txt")).toBe(false);
    expect(isValidTaskFilename("task.md.bak")).toBe(false);
    expect(isValidTaskFilename(".md")).toBe(false);
  });
});

describe("taskIdFromFilename", () => {
  test("strips the .md extension", () => {
    expect(taskIdFromFilename("001-task.md")).toBe("001-task");
    expect(taskIdFromFilename("a.b.md")).toBe("a.b");
  });
});

describe("parseTaskSpec headings", () => {
  test("parses a valid spec", () => {
    const result = parseTaskSpec(VALID_SPEC);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Add refresh tokens");
      expect(result.value.blockedBy).toEqual([]);
    }
  });

  test("rejects an empty spec with errors for every required heading", () => {
    const result = parseTaskSpec("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(6);
    }
  });

  test("reports each missing required heading", () => {
    const missingVerification = `# T

## Objective
o

## Scope
s

## Out Of Scope
oos

## Blocked By
None

## Acceptance Criteria
- a
`;
    const result = parseTaskSpec(missingVerification);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("Verification"))).toBe(true);
    }
  });

  test("heading detection is case-sensitive", () => {
    const lowercased = VALID_SPEC.replace("## Objective", "## objective");
    const result = parseTaskSpec(lowercased);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("Objective"))).toBe(true);
    }
  });

  test("treats Notes as optional", () => {
    const withNotes = VALID_SPEC + "\n## Notes\nsome context\n";
    expect(parseTaskSpec(withNotes).ok).toBe(true);
    expect(parseTaskSpec(VALID_SPEC).ok).toBe(true);
  });
});

describe("parseTaskSpec Blocked By", () => {
  test("parses None as no dependencies", () => {
    const result = parseTaskSpec(specWith("None"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blockedBy).toEqual([]);
    }
  });

  test("parses a single dependency bullet", () => {
    const result = parseTaskSpec(specWith("- 001-setup"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blockedBy).toEqual(["001-setup"]);
    }
  });

  test("parses multiple dependency bullets", () => {
    const result = parseTaskSpec(specWith("- 001-setup\n- 002-config"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blockedBy).toEqual(["001-setup", "002-config"]);
    }
  });

  test("strips surrounding backticks from ids", () => {
    const result = parseTaskSpec(specWith("- `001-setup`"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blockedBy).toEqual(["001-setup"]);
    }
  });
});

describe("validateTaskDependencies", () => {
  test("passes when all dependencies exist and there is no cycle", () => {
    const errors = validateTaskDependencies([
      { id: "a", dependencies: [] },
      { id: "b", dependencies: ["a"] },
      { id: "c", dependencies: ["a", "b"] },
    ]);
    expect(errors).toEqual([]);
  });

  test("fails on unknown dependency references", () => {
    const errors = validateTaskDependencies([
      { id: "a", dependencies: ["missing"] },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("missing"))).toBe(true);
  });

  test("fails on a dependency cycle", () => {
    const errors = validateTaskDependencies([
      { id: "a", dependencies: ["b"] },
      { id: "b", dependencies: ["a"] },
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.toLowerCase().includes("cycle"))).toBe(true);
  });

  test("detects a self-dependency cycle", () => {
    const errors = validateTaskDependencies([{ id: "a", dependencies: ["a"] }]);
    expect(errors.some((e) => e.toLowerCase().includes("cycle"))).toBe(true);
  });
});

describe("selectEligibleTask", () => {
  const tasks = (xs: ProgressTask[]) => xs;

  test("returns the first pending task with satisfied dependencies", () => {
    const selected = selectEligibleTask(
      tasks([
        { id: "a", status: "complete", dependencies: [] },
        { id: "b", status: "pending", dependencies: ["a"] },
        { id: "c", status: "pending", dependencies: [] },
      ]),
    );
    expect(selected?.id).toBe("b");
  });

  test("skips pending tasks with incomplete dependencies", () => {
    const selected = selectEligibleTask(
      tasks([
        { id: "a", status: "pending", dependencies: ["b"] },
        { id: "b", status: "pending", dependencies: ["c"] },
        { id: "c", status: "pending", dependencies: ["d"] },
        { id: "d", status: "pending", dependencies: [] },
      ]),
    );
    expect(selected?.id).toBe("d");
  });

  test("returns undefined when no pending task is eligible", () => {
    const selected = selectEligibleTask(
      tasks([
        { id: "a", status: "complete", dependencies: [] },
        { id: "b", status: "pending", dependencies: ["c"] },
        { id: "c", status: "blocked", dependencies: [] },
      ]),
    );
    expect(selected).toBeUndefined();
  });

  test("returns undefined for an empty task list", () => {
    expect(selectEligibleTask([])).toBeUndefined();
  });
});
