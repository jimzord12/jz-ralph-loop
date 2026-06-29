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

Verified.

- `src/checkpoint.ts` adds:
  - `runQualityGate` — runs `config.qualityGate` in the work plane through a
    shell with an injectable launcher (`GateSpawn` / `defaultGateSpawn`),
    enforces `qualityGateTimeoutSeconds` via SIGKILL, captures `gate.stdout.log`
    and `gate.stderr.log`, and passes only on exit 0 without timeout.
  - `checkpointCommitMessage` — default `ralph: complete <task-id>`.
  - `createCheckpointCommit` — stages all changes (`git add -A`), unstages the
    Loop's `runs/` diagnostics unless `commitRunArtifacts` is true, commits once,
    and returns the resolved commit SHA. Uses an injectable `GitRunner`
    (`defaultGitRunner` shells out to `git`).
  - `runQualityGateAndCheckpoint` — orchestrator. Only a protocol-valid
    `RALPH_NEXT` runs the gate; on pass it creates one checkpoint commit, on
    fail/timeout it becomes a rejection. `RALPH_DONE` → `done`, `RALPH_BLOCKED`
    → `blocked`, and an already-rejected verification stays rejected — none of
    these run the gate or commit. It rewrites `summary.json` with the `gate`
    result and (on checkpoint) the `commit`.
- `src/agent.ts`: `AgentIterationArtifacts` gains `gateStdoutLog` /
  `gateStderrLog` (`gate.stdout.log` / `gate.stderr.log`).
- `src/verify.ts`: `IterationSummary` gains optional `gate` (`SummaryGate`) and
  `commit` (`SummaryCommit`) fields, written by the checkpoint step.
- `src/cli.ts`: `run` calls `runQualityGateAndCheckpoint` after verification and
  reports the gate result, checkpoint action, and commit.
- The runner never edits `progress.json`; Codex owns task state. The checkpoint
  step only stages/commits what Codex produced.
- Stash-based rejection recovery and the retry loop remain out of scope (Slice 6).
- 19 Slice 5 tests pass. `bun test` 107/107. `bun run check` exit 0.
- Manual e2e (real git repo, fake `codex` completing the task, gate `true`):
  one commit `ralph: complete 001-hello` containing `hello.txt`, `progress.json`,
  and `HANDOFF.md`; run diagnostics left untracked. With gate `false`, the same
  iteration is rejected and no commit is created.
