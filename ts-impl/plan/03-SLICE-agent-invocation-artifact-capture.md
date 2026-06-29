# Slice 03: Agent Invocation And Artifact Capture

Status is tracked in [README.md](./README.md).

## Goal

Launch one Codex Agent-Iteration, capture diagnostics, detect the outcome
keyword, and stop before accepting or rejecting work.

## Dependencies

- Slice 02 run foundations.

## Scope

- Build Codex argv from `config.json`.
- Create per-Agent-Iteration artifact directories.
- Capture `stdout.log` and `stderr.log`.
- Capture `progress.before.json` and `progress.after.json`.
- Enforce `agentTimeoutSeconds`.
- Detect standalone outcome lines: `RALPH_NEXT`, `RALPH_DONE`,
  `RALPH_BLOCKED`.

## Out Of Scope

- Progress transition verification.
- Quality gates.
- Checkpoint commits.
- Rejection stash or retry.

## Implementation Notes

- Default invocation starts from `codex exec --sandbox workspace-write`.
- Optional config maps to argv as documented in `IMPLEMENTATION.md`.
- The prompt should stay minimal and point Codex at `RUN_CONTEXT.md`.
- If more than one outcome appears, detection records `RALPH_BLOCKED` as the
  winning outcome for later verification.

## TDD Test Plan

- Codex argv construction covers default and optional config fields.
- Artifact paths are stable and under the correct Agent-Iteration directory.
- Outcome detection ignores embedded/non-standalone keywords.
- Timeout handling records timeout as the Agent-Iteration result.

## Acceptance Checks

```bash
bun test
bun run src/cli.ts run demo
```

## Completion Notes

Pending.
