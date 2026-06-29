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

Pending.
