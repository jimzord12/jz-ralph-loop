# Slice 05: Quality Gate And Checkpoint Commits

Status is tracked in [README.md](./README.md).

## Goal

Accept valid task completions by running the quality gate and creating one Git
Checkpoint commit per completed task.

## Dependencies

- Slice 04 progress verification.

## Scope

- Run `qualityGate` only after protocol-valid `RALPH_NEXT`.
- Enforce `qualityGateTimeoutSeconds`.
- Capture `gate.stdout.log` and `gate.stderr.log`.
- Treat failed or timed-out quality gate as rejection.
- Create one Git commit for accepted `RALPH_NEXT`.
- Use default commit message `ralph: complete <task-id>`.
- Include run artifacts in commits only when `commitRunArtifacts` is `true`.
- Exit correctly for valid `RALPH_DONE` and `RALPH_BLOCKED` without committing.

## Out Of Scope

- Rejection stash.
- Retry loop.
- Multi-task continuation after a checkpoint.

## Implementation Notes

- Commit durable project and control-plane state by default.
- Runtime diagnostics remain uncommitted unless `commitRunArtifacts` is true.
- Preserve existing clean-worktree safety from Slice 02.

## TDD Test Plan

- Quality gate runs only for valid `RALPH_NEXT`.
- Failed quality gate rejects the Agent-Iteration.
- Timed-out quality gate rejects the Agent-Iteration.
- Accepted completion creates one commit with the expected message.
- `commitRunArtifacts` controls whether run diagnostics are included.
- `RALPH_DONE` and `RALPH_BLOCKED` do not create commits.

## Acceptance Checks

```bash
bun test
bun run src/cli.ts run demo
git log -1 --oneline
```

## Completion Notes

Pending.
