import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  isValidTaskFilename,
  parseTaskSpec,
  selectEligibleTask,
  taskIdFromFilename,
  validateTaskDependencies,
} from "../task-spec.js";
import { EXIT, RalphError } from "../errors.js";
import type { ProgressTask } from "../task-spec.js";

export interface LoopJson {
  name: string;
  title: string;
  objective: string;
  createdAt: string;
  taskSource: string;
}

export interface ProgressEntry {
  id: string;
  status: "pending" | "complete" | "blocked";
  spec: string;
  dependencies: string[];
}

export interface ProgressJson {
  tasks: ProgressEntry[];
}

export interface LoopStatusSummary {
  name: string;
  total: number;
  pending: number;
  complete: number;
  blocked: number;
  eligibleTaskId: string | undefined;
}

const HANDOFF_MD = `# Loop Handoff

Use this file to record short-term continuity for the current Loop.

Update it when you complete a task, discover important context that is not
durable enough for KNOWLEDGE.md, or hit a blocker. Keep it concise and focused
on what the next Agent-Iteration needs to know.
`;

export async function runLoopCreate(
  ralphDir: string,
  name: string,
  fromDir: string,
): Promise<void> {
  const loopDir = join(ralphDir, "loops", name);

  // Fail if loop already exists
  let loopExists = false;
  try {
    await stat(loopDir);
    loopExists = true;
  } catch {
    // does not exist — good
  }
  if (loopExists) {
    throw new RalphError(
      `Loop "${name}" already exists: ${loopDir}`,
      EXIT.USAGE_ERROR,
    );
  }

  // Validate --from directory
  let fromStat;
  try {
    fromStat = await stat(fromDir);
  } catch {
    throw new RalphError(
      `Task source directory does not exist: ${fromDir}`,
      EXIT.USAGE_ERROR,
    );
  }
  if (!fromStat.isDirectory()) {
    throw new RalphError(
      `Task source is not a directory: ${fromDir}`,
      EXIT.USAGE_ERROR,
    );
  }

  // Read and filter task files
  const entries = await readdir(fromDir);
  const taskFiles = entries.filter(isValidTaskFilename).sort();

  if (taskFiles.length === 0) {
    throw new RalphError(
      `No valid task files found in: ${fromDir}`,
      EXIT.USAGE_ERROR,
    );
  }

  // Parse and validate each task spec
  const parseErrors: string[] = [];
  const parsedTasks: Array<{ id: string; dependencies: string[] }> = [];

  for (const filename of taskFiles) {
    const id = taskIdFromFilename(filename);
    const content = await readFile(join(fromDir, filename), "utf8");
    const result = parseTaskSpec(content);
    if (!result.ok) {
      for (const e of result.errors) {
        parseErrors.push(`  ${filename}: ${e}`);
      }
    } else {
      parsedTasks.push({ id, dependencies: result.value.blockedBy });
    }
  }

  if (parseErrors.length > 0) {
    throw new RalphError(
      `Invalid Task Specs in ${fromDir}:\n${parseErrors.join("\n")}`,
      EXIT.VALIDATION_ERROR,
    );
  }

  // Validate cross-task dependencies
  const depErrors = validateTaskDependencies(parsedTasks);
  if (depErrors.length > 0) {
    throw new RalphError(
      `Task dependency errors:\n${depErrors.map((e) => `  ${e}`).join("\n")}`,
      EXIT.VALIDATION_ERROR,
    );
  }

  // Build the loop directory structure
  const tasksDir = join(loopDir, "tasks");
  const runsDir = join(loopDir, "runs");
  await mkdir(tasksDir, { recursive: true });
  await mkdir(runsDir, { recursive: true });

  // Copy task files
  for (const filename of taskFiles) {
    await copyFile(join(fromDir, filename), join(tasksDir, filename));
  }

  // Write progress.json
  const progressTasks: ProgressEntry[] = parsedTasks.map((t) => ({
    id: t.id,
    status: "pending" as const,
    spec: `tasks/${t.id}.md`,
    dependencies: t.dependencies,
  }));
  const progressJson: ProgressJson = { tasks: progressTasks };
  await writeFile(
    join(loopDir, "progress.json"),
    JSON.stringify(progressJson, null, 2) + "\n",
  );

  // Write loop.json
  const loopJson: LoopJson = {
    name,
    title: "",
    objective: "",
    createdAt: new Date().toISOString(),
    taskSource: resolve(fromDir),
  };
  await writeFile(
    join(loopDir, "loop.json"),
    JSON.stringify(loopJson, null, 2) + "\n",
  );

  // Write HANDOFF.md
  await writeFile(join(loopDir, "HANDOFF.md"), HANDOFF_MD);
}

export async function runLoopList(ralphDir: string): Promise<string[]> {
  const loopsDir = join(ralphDir, "loops");
  let entries: string[];
  try {
    entries = await readdir(loopsDir);
  } catch {
    return [];
  }

  const loops: string[] = [];
  for (const entry of entries) {
    try {
      const s = await stat(join(loopsDir, entry));
      if (s.isDirectory()) {
        loops.push(entry);
      }
    } catch {
      // skip
    }
  }
  return loops.sort();
}

export async function runLoopStatus(
  ralphDir: string,
  name: string,
): Promise<LoopStatusSummary> {
  const progressPath = join(ralphDir, "loops", name, "progress.json");
  let raw: string;
  try {
    raw = await readFile(progressPath, "utf8");
  } catch {
    throw new RalphError(
      `Loop "${name}" not found or missing progress.json`,
      EXIT.VALIDATION_ERROR,
    );
  }

  let progress: ProgressJson;
  try {
    progress = JSON.parse(raw) as ProgressJson;
  } catch {
    throw new RalphError(
      `progress.json for loop "${name}" is not valid JSON`,
      EXIT.VALIDATION_ERROR,
    );
  }

  const tasks = progress.tasks;

  const pending = tasks.filter((t) => t.status === "pending").length;
  const complete = tasks.filter((t) => t.status === "complete").length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;

  // Map to ProgressTask for selectEligibleTask
  const progressTasks: ProgressTask[] = tasks.map((t) => ({
    id: t.id,
    status: t.status,
    dependencies: t.dependencies,
  }));
  const eligible = selectEligibleTask(progressTasks);

  return {
    name,
    total: tasks.length,
    pending,
    complete,
    blocked,
    eligibleTaskId: eligible?.id,
  };
}
