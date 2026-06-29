import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseTaskSpec } from "../task-spec.js";
import { EXIT, RalphError } from "../errors.js";
import type { ProgressJson } from "./loop.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function isValidStatus(s: unknown): s is "pending" | "complete" | "blocked" {
  return s === "pending" || s === "complete" || s === "blocked";
}

export async function validateInstallation(ralphDir: string): Promise<void> {
  const missing: string[] = [];

  for (const f of ["config.json", "AGENTS.md", "KNOWLEDGE.md"]) {
    if (!(await fileExists(join(ralphDir, f)))) missing.push(f);
  }
  if (!(await dirExists(join(ralphDir, "loops")))) missing.push("loops/");

  if (missing.length > 0) {
    throw new RalphError(
      `Ralph installation is missing: ${missing.join(", ")}`,
      EXIT.VALIDATION_ERROR,
    );
  }

  // Validate config.json structure
  let configRaw: string;
  try {
    configRaw = await readFile(join(ralphDir, "config.json"), "utf8");
  } catch {
    throw new RalphError("Cannot read config.json", EXIT.VALIDATION_ERROR);
  }

  let config: unknown;
  try {
    config = JSON.parse(configRaw);
  } catch {
    throw new RalphError("config.json is not valid JSON", EXIT.VALIDATION_ERROR);
  }

  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new RalphError("config.json must be a JSON object", EXIT.VALIDATION_ERROR);
  }

  const c = config as Record<string, unknown>;
  const configErrors: string[] = [];

  if (typeof c["workPlane"] !== "string") configErrors.push("workPlane must be a string");
  if (typeof c["qualityGate"] !== "string") configErrors.push("qualityGate must be a string");
  if (typeof c["maxRejectedIterations"] !== "number")
    configErrors.push("maxRejectedIterations must be a number");
  if (typeof c["agentTimeoutSeconds"] !== "number")
    configErrors.push("agentTimeoutSeconds must be a number");
  if (typeof c["qualityGateTimeoutSeconds"] !== "number")
    configErrors.push("qualityGateTimeoutSeconds must be a number");
  if (typeof c["commitRunArtifacts"] !== "boolean")
    configErrors.push("commitRunArtifacts must be a boolean");

  const agent = c["agent"];
  if (typeof agent !== "object" || agent === null || Array.isArray(agent)) {
    configErrors.push("agent must be an object");
  } else {
    const a = agent as Record<string, unknown>;
    if (typeof a["kind"] !== "string") configErrors.push("agent.kind must be a string");
  }

  if (configErrors.length > 0) {
    throw new RalphError(
      `config.json is invalid:\n${configErrors.map((e) => `  ${e}`).join("\n")}`,
      EXIT.VALIDATION_ERROR,
    );
  }
}

export async function validateLoop(ralphDir: string, loopName: string): Promise<void> {
  const loopDir = join(ralphDir, "loops", loopName);
  const missing: string[] = [];

  for (const f of ["loop.json", "progress.json", "HANDOFF.md"]) {
    if (!(await fileExists(join(loopDir, f)))) missing.push(f);
  }
  if (!(await dirExists(join(loopDir, "tasks")))) missing.push("tasks/");

  if (missing.length > 0) {
    throw new RalphError(
      `Loop "${loopName}" is missing: ${missing.join(", ")}`,
      EXIT.VALIDATION_ERROR,
    );
  }

  // Validate progress.json structure
  let progressRaw: string;
  try {
    progressRaw = await readFile(join(loopDir, "progress.json"), "utf8");
  } catch {
    throw new RalphError(
      `Cannot read progress.json for loop "${loopName}"`,
      EXIT.VALIDATION_ERROR,
    );
  }

  let progress: unknown;
  try {
    progress = JSON.parse(progressRaw);
  } catch {
    throw new RalphError(
      `progress.json for loop "${loopName}" is not valid JSON`,
      EXIT.VALIDATION_ERROR,
    );
  }

  if (typeof progress !== "object" || progress === null || Array.isArray(progress)) {
    throw new RalphError(
      `progress.json for loop "${loopName}" must be a JSON object`,
      EXIT.VALIDATION_ERROR,
    );
  }

  const p = progress as Record<string, unknown>;
  if (!Array.isArray(p["tasks"])) {
    throw new RalphError(
      `progress.json for loop "${loopName}": "tasks" must be an array`,
      EXIT.VALIDATION_ERROR,
    );
  }

  const progressErrors: string[] = [];
  const typed = progress as ProgressJson;

  for (let i = 0; i < typed.tasks.length; i++) {
    const t = typed.tasks[i];
    if (t === undefined) continue;
    if (typeof t.id !== "string" || t.id.length === 0)
      progressErrors.push(`tasks[${i}]: id must be a non-empty string`);
    if (!isValidStatus(t.status))
      progressErrors.push(`tasks[${i}]: status must be "pending", "complete", or "blocked"`);
    if (typeof t.spec !== "string")
      progressErrors.push(`tasks[${i}]: spec must be a string`);
    if (!Array.isArray(t.dependencies))
      progressErrors.push(`tasks[${i}]: dependencies must be an array`);
  }

  if (progressErrors.length > 0) {
    throw new RalphError(
      `progress.json for loop "${loopName}" is invalid:\n${progressErrors.map((e) => `  ${e}`).join("\n")}`,
      EXIT.VALIDATION_ERROR,
    );
  }

  // Validate task files exist and are valid specs
  const tasksDir = join(loopDir, "tasks");
  let taskFiles: string[];
  try {
    taskFiles = await readdir(tasksDir);
  } catch {
    throw new RalphError(
      `Cannot read tasks/ directory for loop "${loopName}"`,
      EXIT.VALIDATION_ERROR,
    );
  }

  const taskFileSet = new Set(taskFiles);
  const taskErrors: string[] = [];

  for (const t of typed.tasks) {
    if (!t) continue;
    const filename = `${t.id}.md`;
    if (!taskFileSet.has(filename)) {
      taskErrors.push(`  Task file missing: tasks/${filename}`);
      continue;
    }
    try {
      const content = await readFile(join(tasksDir, filename), "utf8");
      const result = parseTaskSpec(content);
      if (!result.ok) {
        for (const e of result.errors) {
          taskErrors.push(`  ${filename}: ${e}`);
        }
      }
    } catch {
      taskErrors.push(`  Cannot read task file: tasks/${filename}`);
    }
  }

  if (taskErrors.length > 0) {
    throw new RalphError(
      `Task validation errors for loop "${loopName}":\n${taskErrors.join("\n")}`,
      EXIT.VALIDATION_ERROR,
    );
  }
}
