# Slice 06: Rejection Stash And Retry Loop

Status is tracked in [README.md](./README.md).

## Goal

Preserve rejected work with Git stash metadata and retry rejected
Agent-Iterations within the configured Run cap.

## Dependencies

- Slice 05 quality gate and checkpoint commits.

## Scope

- Stash all worktree changes on rejected Agent-Iteration, including untracked
  files.
- Record stable stash commit SHA and stash message in Agent-Iteration
  `summary.json`.
- Restore a clean worktree before retrying.
- Retry the same selected task until accepted, blocked, done, capped, or timed
  out.
- Generate one summary per Agent-Iteration.
- Apply the same rejection stash path to timed-out Agent-Iterations that leave
  changes.
- Exit with `5` when rejection cap is reached.
- Exit with `6` only when the final Run outcome is timeout.

## Out Of Scope

- Multi-task continuation after accepted checkpoints.
- New task decomposition or normalization behavior.

## Implementation Notes

- Do not rely only on `stash@{0}` because stash indexes move.
- Use stash messages like
  `ralph rejected <run-id> agent-iteration <n> <task-id>`.
- `maxRejectedIterations` is a per-Run total, not per task.

## TDD Test Plan

- Rejected changes are stashed with untracked files.
- Summary includes stable stash SHA and message.
- Worktree is clean before retry.
- Retry count stops at `maxRejectedIterations`.
- Timeout with changes follows rejection stash behavior.
- Final exit codes distinguish cap reached from timeout.

## Acceptance Checks

```bash
bun test
bun run src/cli.ts run demo
git stash list
```

## Completion Notes

Pending.
