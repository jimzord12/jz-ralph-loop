import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EXIT, RalphError } from "../errors.js";

const DEFAULT_CONFIG = {
  workPlane: ".",
  qualityGate: "bun test",
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
};

const AGENTS_MD = `# Ralph Agent Instructions

You are an AI coding agent participating in a Ralph loop orchestrated by \`ralph-loop\`.

## Required Behavior

1. Read the \`RUN_CONTEXT.md\` file at the start of each session (path is in your prompt).
2. Complete **at most one task** per Agent-Iteration as directed by \`RUN_CONTEXT.md\`.
3. Update the Loop's \`progress.json\` to mark the completed task as \`"complete"\`.
4. Update the Loop's \`HANDOFF.md\` with short-term continuity notes.
5. Emit **exactly one** outcome keyword as a standalone line before exiting:
   - \`RALPH_NEXT\` — task complete, runner should continue to the next task
   - \`RALPH_DONE\` — all tasks are complete
   - \`RALPH_BLOCKED\` — cannot proceed without human input

## Outcome Keyword Rules

- Output the keyword as a standalone line (no surrounding text on that line).
- If more than one keyword appears, \`RALPH_BLOCKED\` takes precedence.
- \`RALPH_NEXT\` requires exactly one newly completed task (the selected eligible task).
- \`RALPH_DONE\` requires no pending tasks remain and no newly completed tasks.
- \`RALPH_BLOCKED\` requires no newly completed tasks.

## What Not To Do

- Do not complete more than one task per Agent-Iteration.
- Do not edit \`RUN_CONTEXT.md\` (it is runner-owned).
- Do not emit outcome keywords until you are finished with your work for this iteration.
- Do not mark tasks complete unless you have fully satisfied their Acceptance Criteria.
`;

const KNOWLEDGE_MD = `# Project Knowledge

Add durable project facts here that should persist across Ralph Runs and Agent-Iterations.

Keep entries concise. Use this file for stable facts — not for task-specific context
(which belongs in task specs) or short-term continuity (which belongs in HANDOFF.md).
`;

export async function isInsideGitRepo(cwd: string): Promise<boolean> {
  let dir = cwd;
  for (;;) {
    try {
      await stat(join(dir, ".git"));
      return true;
    } catch {
      const parent = join(dir, "..");
      if (parent === dir) return false;
      dir = parent;
    }
  }
}

export async function runInit(ralphDir: string, cwd: string): Promise<void> {
  let exists = false;
  try {
    await stat(ralphDir);
    exists = true;
  } catch {
    // does not exist — good
  }
  if (exists) {
    throw new RalphError(
      `Ralph installation already exists: ${ralphDir}`,
      EXIT.USAGE_ERROR,
    );
  }

  if (!(await isInsideGitRepo(cwd))) {
    throw new RalphError(
      "Not inside a Git repository. ralph-loop init requires Git.",
      EXIT.USAGE_ERROR,
    );
  }

  await mkdir(join(ralphDir, "loops"), { recursive: true });
  await writeFile(
    join(ralphDir, "config.json"),
    JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
  );
  await writeFile(join(ralphDir, "AGENTS.md"), AGENTS_MD);
  await writeFile(join(ralphDir, "KNOWLEDGE.md"), KNOWLEDGE_MD);
}
