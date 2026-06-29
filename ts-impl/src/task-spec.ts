/**
 * Task Spec contract module.
 *
 * Owns Task Source / Task Spec parsing, validation, dependency checks, and
 * eligible-task selection. Kept independent of CLI dispatch so `loop create`,
 * `validate`, and `run` can all consume it. `progress.json` remains the only
 * authoritative Plan/progress state; this module never persists a derived task
 * queue or dependency graph.
 */

/** Allowed task filenames, matching the IMPLEMENTATION.md contract. */
export const TASK_FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/;

/** Required Task Spec headings, detected case-sensitively as `##` sections. */
export const REQUIRED_HEADINGS = [
  "Objective",
  "Scope",
  "Out Of Scope",
  "Blocked By",
  "Acceptance Criteria",
  "Verification",
] as const;

export type TaskStatus = "pending" | "complete" | "blocked";

/** A task as represented in a Loop `progress.json` ledger. */
export interface ProgressTask {
  id: string;
  status: TaskStatus;
  dependencies: string[];
}

/** A task plus the dependency ids declared in its `Blocked By` section. */
export interface TaskWithDependencies {
  id: string;
  dependencies: string[];
}

export interface ParsedTaskSpec {
  title: string | undefined;
  headings: string[];
  blockedBy: string[];
}

export type TaskSpecParseResult =
  | { ok: true; value: ParsedTaskSpec }
  | { ok: false; errors: string[] };

/** True when `name` satisfies the Task Spec filename contract. */
export function isValidTaskFilename(name: string): boolean {
  return TASK_FILENAME_PATTERN.test(name);
}

/** Derives a task id from a `.md` filename by stripping the extension. */
export function taskIdFromFilename(name: string): string {
  return name.replace(/\.md$/, "");
}

interface Heading {
  title: string;
  bodyLines: string[];
}

/** Splits Markdown content into its `##` sections, preserving body lines. */
function parseHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  let current: Heading | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const match = /^##\s+(.+?)\s*$/.exec(rawLine);
    if (match && !rawLine.startsWith("###")) {
      current = { title: match[1] ?? "", bodyLines: [] };
      headings.push(current);
      continue;
    }

    if (current) {
      current.bodyLines.push(rawLine);
    }
  }

  return headings;
}

/** Reads the first level-one `#` heading as the task title, if present. */
function parseTitle(content: string): string | undefined {
  for (const rawLine of content.split(/\r?\n/)) {
    const match = /^#\s+(.+?)\s*$/.exec(rawLine);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/** Parses a `Blocked By` section body into dependency task ids. */
function parseBlockedBy(bodyLines: string[]): string[] {
  const ids: string[] = [];

  for (const rawLine of bodyLines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    const value = bulletMatch ? bulletMatch[1]! : line;
    const id = value.trim().replace(/^`+|`+$/g, "").trim();

    if (id.length === 0 || id.toLowerCase() === "none") {
      continue;
    }

    ids.push(id);
  }

  return ids;
}

/**
 * Parses and validates one Task Spec. Returns parsed data on success, or the
 * list of contract violations on failure.
 */
export function parseTaskSpec(content: string): TaskSpecParseResult {
  const headings = parseHeadings(content);
  const headingTitles = headings.map((h) => h.title);
  const errors: string[] = [];

  for (const required of REQUIRED_HEADINGS) {
    if (!headingTitles.includes(required)) {
      errors.push(`Missing required heading: ## ${required}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const blockedBySection = headings.find((h) => h.title === "Blocked By");
  const blockedBy = blockedBySection
    ? parseBlockedBy(blockedBySection.bodyLines)
    : [];

  return {
    ok: true,
    value: {
      title: parseTitle(content),
      headings: headingTitles,
      blockedBy,
    },
  };
}

/**
 * Validates dependencies across an imported task set: every referenced id must
 * exist, and the dependency graph must be acyclic. Returns an error list (empty
 * when valid).
 */
export function validateTaskDependencies(
  tasks: readonly TaskWithDependencies[],
): string[] {
  const errors: string[] = [];
  const ids = new Set(tasks.map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!ids.has(dep)) {
        errors.push(`Task "${task.id}" depends on unknown task "${dep}"`);
      }
    }
  }

  // DFS cycle detection over known dependencies only.
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const reported = new Set<string>();

  const visit = (id: string, stack: string[]): void => {
    const current = state.get(id);
    if (current === DONE) {
      return;
    }
    if (current === VISITING) {
      const start = stack.indexOf(id);
      const cyclePath = [...stack.slice(start), id].join(" -> ");
      if (!reported.has(cyclePath)) {
        reported.add(cyclePath);
        errors.push(`Dependency cycle detected: ${cyclePath}`);
      }
      return;
    }

    state.set(id, VISITING);
    stack.push(id);
    const task = byId.get(id);
    if (task) {
      for (const dep of task.dependencies) {
        if (byId.has(dep)) {
          visit(dep, stack);
        }
      }
    }
    stack.pop();
    state.set(id, DONE);
  };

  for (const task of tasks) {
    visit(task.id, []);
  }

  return errors;
}

/**
 * Selects the next task for an Agent-Iteration: the first pending task, in
 * stable Plan order, whose dependencies are all complete. Returns `undefined`
 * when no pending task is eligible.
 */
export function selectEligibleTask(
  tasks: readonly ProgressTask[],
): ProgressTask | undefined {
  const completeIds = new Set(
    tasks.filter((t) => t.status === "complete").map((t) => t.id),
  );

  return tasks.find(
    (task) =>
      task.status === "pending" &&
      task.dependencies.every((dep) => completeIds.has(dep)),
  );
}
