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

Pending.
