# Slice 04: Progress Verification

Status is tracked in [README.md](./README.md).

## Goal

Classify one Agent-Iteration as protocol-valid, blocked, or rejected based on
the outcome keyword and `progress.json` transition.

## Dependencies

- Slice 03 agent invocation and artifact capture.

## Scope

- Compare `progress.before.json` and `progress.after.json`.
- Reject missing or invalid outcome keyword.
- Resolve multiple outcome keywords with `RALPH_BLOCKED` winning.
- Require `RALPH_NEXT` to complete exactly one task.
- Require `RALPH_NEXT` to complete the selected eligible task.
- Require `RALPH_DONE` to have no pending tasks.
- Reject `RALPH_DONE` with newly completed tasks.
- Reject `RALPH_BLOCKED` with newly completed tasks.
- Write Agent-Iteration `summary.json` with status and reason.

## Out Of Scope

- Quality gates.
- Commits.
- Stashes.
- Retries.

## Implementation Notes

- The runner only verifies progress; it does not fix up `progress.json`.
- Codex owns Agent-Iteration progress updates.
- Use the Slice 00 eligible-task logic for task identity checks.

## TDD Test Plan

- Valid `RALPH_NEXT` completes only the selected eligible task.
- `RALPH_NEXT` with zero or multiple completed tasks is rejected.
- `RALPH_DONE` with pending tasks is rejected.
- `RALPH_DONE` without pending tasks is valid.
- `RALPH_BLOCKED` without new completions is valid blocked state.
- `RALPH_BLOCKED` with new completions is rejected.
- `summary.json` records classification and reason.

## Acceptance Checks

```bash
bun test
bun run src/cli.ts run demo
```

## Completion Notes

**VERIFIED.**

- `src/verify.ts`:
  - `verifyProgressTransition(before, after, outcome, timedOut?)` — pure
    classifier returning `{ status, outcome, reason, selectedTaskId,
    newlyCompleted }`. `status` is `"valid" | "blocked" | "rejected"`.
    - Recomputes the selected eligible task from the **before** snapshot via the
      Slice 0 `selectEligibleTask`, so verification depends only on the two
      snapshots and the detected outcome.
    - `newlyCompleted` = tasks `complete` in `after` that were not `complete` in
      `before`.
    - Rejects: timeout, missing/invalid outcome, `RALPH_NEXT` with zero or >1
      completions, `RALPH_NEXT` completing a non-selected task, `RALPH_DONE`
      with new completions, `RALPH_DONE` with pending remaining, `RALPH_BLOCKED`
      with new completions. (Quality-gate rejection is Slice 5.)
    - `RALPH_BLOCKED` (no new completions) → `blocked`; valid `RALPH_NEXT` /
      `RALPH_DONE` → `valid`.
  - `buildIterationSummary` + `verifyAndSummarize` — reads the
    `progress.before.json` / `progress.after.json` snapshots (tolerating the
    empty `{}` fallback), classifies, and writes `summary.json`
    (`{ iteration, outcome, status, rejected, reason, selectedTaskId,
    newlyCompleted, timedOut }`).
  - The runner only verifies; it never edits `progress.json`.
- `src/cli.ts`: `run` now verifies the captured Agent-Iteration, writes
  `summary.json`, and reports the classification + reason. Checkpoint and
  rejection recovery remain later slices.
- 14 Slice 4 tests (`test/slice-04.test.ts`). `bun test` 95/95. `bun run check`
  exit 0. `run demo` in a clean Git repo writes `summary.json` and exits 0
  (classified `rejected` when no Codex binary is present).
