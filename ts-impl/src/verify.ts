/**
 * Progress verification module (Slice 4).
 *
 * Classifies a single Agent-Iteration as protocol-valid, blocked, or rejected by
 * comparing the Loop's `progress.json` before and after the iteration against
 * the detected outcome keyword. The runner only verifies; it never edits
 * `progress.json`. Quality gates, commits, stashes, and retries are out of scope
 * for this slice.
 */

import { readFile, writeFile } from "node:fs/promises";
import { selectEligibleTask } from "./task-spec.js";
import type { ProgressJson } from "./commands/loop.js";
import type { AgentIterationResult, RalphOutcome } from "./agent.js";

/** Classification of an Agent-Iteration's protocol compliance. */
export type VerificationStatus = "valid" | "blocked" | "rejected";

/** The classification plus the evidence used to reach it. */
export interface VerificationResult {
  status: VerificationStatus;
  outcome: RalphOutcome | undefined;
  reason: string;
  /** The task selected as eligible from the before-snapshot, if any. */
  selectedTaskId: string | undefined;
  /** Task ids that became `complete` between the before and after snapshots. */
  newlyCompleted: string[];
}

/** The persisted `summary.json` shape for one Agent-Iteration. */
export interface IterationSummary {
  iteration: number;
  outcome: RalphOutcome | null;
  status: VerificationStatus;
  rejected: boolean;
  reason: string;
  selectedTaskId: string | null;
  newlyCompleted: string[];
  timedOut: boolean;
}

/**
 * Classifies one Agent-Iteration. The eligible task is recomputed from the
 * before-snapshot using the Slice 0 selection logic, so verification depends
 * only on the two progress snapshots and the detected outcome (and whether the
 * iteration timed out).
 */
export function verifyProgressTransition(
  before: ProgressJson,
  after: ProgressJson,
  outcome: RalphOutcome | undefined,
  timedOut = false,
): VerificationResult {
  const selectedTaskId = selectEligibleTask(before.tasks)?.id;

  const beforeComplete = new Set(
    before.tasks.filter((t) => t.status === "complete").map((t) => t.id),
  );
  const newlyCompleted = after.tasks
    .filter((t) => t.status === "complete" && !beforeComplete.has(t.id))
    .map((t) => t.id);
  const pendingAfter = after.tasks.filter((t) => t.status === "pending").length;

  const reject = (reason: string): VerificationResult => ({
    status: "rejected",
    outcome,
    reason,
    selectedTaskId,
    newlyCompleted,
  });
  const accept = (
    status: Exclude<VerificationStatus, "rejected">,
    reason: string,
  ): VerificationResult => ({
    status,
    outcome,
    reason,
    selectedTaskId,
    newlyCompleted,
  });

  // A timed-out iteration has no trustworthy outcome, and stash recovery is left
  // to a later slice; treat it as a rejection here.
  if (timedOut) {
    return reject("Agent-Iteration timed out before emitting an outcome");
  }
  if (!outcome) {
    return reject("Missing or invalid outcome keyword");
  }

  if (outcome === "RALPH_NEXT") {
    if (newlyCompleted.length === 0) {
      return reject("RALPH_NEXT completed zero tasks");
    }
    if (newlyCompleted.length > 1) {
      return reject(
        `RALPH_NEXT completed multiple tasks: ${newlyCompleted.join(", ")}`,
      );
    }
    const completed = newlyCompleted[0]!;
    if (completed !== selectedTaskId) {
      return reject(
        selectedTaskId
          ? `RALPH_NEXT completed "${completed}" instead of the selected eligible task "${selectedTaskId}"`
          : `RALPH_NEXT completed "${completed}" but no task was eligible for selection`,
      );
    }
    return accept("valid", `Completed the selected eligible task "${completed}"`);
  }

  if (outcome === "RALPH_DONE") {
    if (newlyCompleted.length > 0) {
      return reject(
        `RALPH_DONE with newly completed tasks: ${newlyCompleted.join(", ")}`,
      );
    }
    if (pendingAfter > 0) {
      return reject(`RALPH_DONE while ${pendingAfter} task(s) remain pending`);
    }
    return accept("valid", "All tasks complete; no task newly completed");
  }

  // RALPH_BLOCKED
  if (newlyCompleted.length > 0) {
    return reject(
      `RALPH_BLOCKED with newly completed tasks: ${newlyCompleted.join(", ")}`,
    );
  }
  return accept("blocked", "Agent reported a blocker with no task newly completed");
}

/** Builds the persisted summary from an Agent-Iteration result + verification. */
export function buildIterationSummary(
  result: AgentIterationResult,
  verification: VerificationResult,
): IterationSummary {
  return {
    iteration: result.iteration,
    outcome: verification.outcome ?? null,
    status: verification.status,
    rejected: verification.status === "rejected",
    reason: verification.reason,
    selectedTaskId: verification.selectedTaskId ?? null,
    newlyCompleted: verification.newlyCompleted,
    timedOut: result.timedOut,
  };
}

/** Parses a progress snapshot, tolerating a missing/empty `{}` snapshot. */
async function readProgressSnapshot(path: string): Promise<ProgressJson> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProgressJson>;
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch {
    return { tasks: [] };
  }
}

/**
 * Reads the before/after snapshots captured by the Agent-Iteration, classifies
 * the transition, and writes `summary.json`. Returns the summary it wrote.
 */
export async function verifyAndSummarize(
  result: AgentIterationResult,
): Promise<IterationSummary> {
  const before = await readProgressSnapshot(result.artifacts.progressBefore);
  const after = await readProgressSnapshot(result.artifacts.progressAfter);

  const verification = verifyProgressTransition(
    before,
    after,
    result.outcome,
    result.timedOut,
  );
  const summary = buildIterationSummary(result, verification);

  await writeFile(
    result.artifacts.summary,
    JSON.stringify(summary, null, 2) + "\n",
  );
  return summary;
}
