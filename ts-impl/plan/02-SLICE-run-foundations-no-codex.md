# Slice 02: Run Foundations Without Codex Launch

Status is tracked in [README.md](./README.md).

## Goal

Build the run setup path without launching Codex yet, so runtime state,
configuration, Git safety, and `RUN_CONTEXT.md` generation are in place.

## Dependencies

- Slice 01 non-agent commands.

## Scope

- Create Run directories under
  `.jz-ralph/loops/<loop-name>/runs/<run-id>/`.
- Generate or update `RUN_CONTEXT.md`.
- Read and validate `config.json`.
- Load `progress.json`.
- Select the first eligible pending task using task order and dependencies.
- Compute `agentIterationCap = pendingTaskCount + maxRejectedIterations + 1`.
- Keep `maxRejectedIterations` as a per-Run total.
- Validate Git requirements for `run`.
- Make `ralph-loop run <loop-name>` stop after setup and print what would happen
  next.

## Out Of Scope

- Launching Codex.
- Capturing Agent-Iteration logs.
- Progress verification.
- Quality gates, commits, stashes, or retries.

## Implementation Notes

- Require the work plane to be inside a Git repository.
- Require a clean worktree before Run start.
- Do not add an `--allow-dirty` bypass.
- `RUN_CONTEXT.md` is diagnostic and must not become authoritative state.
- Include a derived execution view in `RUN_CONTEXT.md` if useful.

## TDD Test Plan

- Run setup fails for invalid installation or Loop.
- Run setup fails outside Git.
- Run setup fails with dirty worktree.
- Run setup creates the Run directory and `RUN_CONTEXT.md`.
- Run setup selects an eligible task, not a dependency-blocked task.
- Run setup computes caps from pending count and configured rejection cap.

## Acceptance Checks

```bash
bun run src/cli.ts run demo
bun run src/cli.ts validate demo
```

## Completion Notes

Verified.

- `src/commands/run.ts` adds the run-setup path (no Codex launch):
  - `loadConfig` — typed read of `config.json`.
  - `formatRunId` — filesystem-safe, lexically sortable UTC Run id
    (`YYYY-MM-DDTHHMMSSZ`).
  - `runSetup(ralphDir, loopName, { cwd, now, runId })` —
    validates installation + Loop (reuses `validateInstallation` /
    `validateLoop`), resolves the work plane from `config.workPlane` relative to
    `cwd`, requires the work plane to be inside Git, hard-fails on a dirty
    worktree (`git status --porcelain`, no bypass), selects the eligible task,
    computes `agentIterationCap = pendingCount + maxRejectedIterations + 1`
    (per-Run total), creates `loops/<loop>/runs/<run-id>/`, and writes a
    diagnostic `RUN_CONTEXT.md` including a derived execution view (pending tasks
    and dependency-blocked pending tasks).
- `src/cli.ts` wires `run <loop-name>`: prints the prepared Run, the selected
  task, and what would happen next; exits `0` on setup success, `4` when pending
  tasks exist but none are eligible (all blocked), `3` on validation/Git
  failures, `2` for usage errors.
- `src/commands/docs.ts` `run` section updated from "pending" to "run setup
  implemented (Slice 2)".
- Tests: `test/slice-02.test.ts` (9 cases) covers `formatRunId`, invalid
  installation / unknown loop, outside-Git, dirty worktree, Run dir +
  `RUN_CONTEXT.md` creation, eligible-task selection vs dependency-blocked tasks,
  and cap computation (default and non-default `maxRejectedIterations`).
- Checks: `bun test` 65/65 pass; `bun run check` exit 0; acceptance
  `bun run src/cli.ts run demo` and `validate demo` pass in a clean Git repo.

### Notes For The Next Slice

- `runSetup` returns a `RunSetupResult` (selected task, caps, run/context paths)
  that Slice 3 can consume to launch the Agent-Iteration without re-deriving
  state.
- Run artifacts are written under `runs/<run-id>/` and are not committed by
  default (`commitRunArtifacts: false`).
- The clean-worktree check runs against the whole work-plane repo; `.jz-ralph/`
  must be committed (or gitignored, as in this repo) for `run` to start.
