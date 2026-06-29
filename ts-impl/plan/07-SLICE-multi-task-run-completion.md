# Slice 07: Multi-Task Run Completion

Status is tracked in [README.md](./README.md).

## Goal

Allow one `ralph-loop run <loop-name>` invocation to continue across multiple
tasks until done, blocked, capped, failed, or timed out.

## Dependencies

- Slice 06 rejection stash and retry loop.

## Scope

- Reload `progress.json` after each accepted Checkpoint.
- Continue to the next eligible pending task in the same Run.
- Regenerate `RUN_CONTEXT.md` before each Agent-Iteration.
- Stop with `0` when all tasks are complete and Codex emits valid
  `RALPH_DONE`.
- Stop with `4` on valid `RALPH_BLOCKED`.
- Preserve file-only resumability.
- Ensure `agentIterationCap` prevents infinite loops.

## Out Of Scope

- Additional docs hardening beyond what is needed for run behavior.
- Changing Task Spec contract.

## Implementation Notes

- New Runs use durable Loop state only: `progress.json`, Loop `HANDOFF.md`,
  `KNOWLEDGE.md`, and Loop `tasks/`.
- Old `runs/*/summary.json` files remain diagnostic and must not drive control
  flow.
- Dependency-aware eligible-task selection must be recomputed after each
  checkpoint.

## TDD Test Plan

- A Run processes multiple eligible tasks through separate Checkpoints.
- A dependency-blocked task becomes eligible after its dependency completes.
- A new Run resumes from durable state without reading old summaries.
- `RALPH_DONE` exits `0` only after all tasks are complete.
- `RALPH_BLOCKED` exits `4`.
- Agent-Iteration cap stops runaway loops.

## Acceptance Checks

```bash
bun test
bun run src/cli.ts run demo
bun run src/cli.ts loop status demo
```

## Completion Notes

Pending.
