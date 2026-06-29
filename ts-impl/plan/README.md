# Ralph Loop Implementation Plan

This directory tracks implementation progress for the approved TypeScript CLI
slices. `IMPLEMENTATION.md` remains the product spec. These files describe how
to implement and verify each slice.

## Status Values

- `planned`: ready to implement
- `in-progress`: currently being implemented
- `blocked`: waiting on a decision or external dependency
- `implemented`: code is written
- `verified`: acceptance checks passed

## Slice Index

| Slice | Title                                                                                    | Status  | Depends On | Acceptance Checks                                                     |
| ----- | ---------------------------------------------------------------------------------------- | ------- | ---------- | --------------------------------------------------------------------- |
| 00    | [Task Spec Contract Foundations](./00-SLICE-task-spec-contract-foundations.md)           | verified | none       | `bun test`; `bun run check`                                           |
| 01    | [Non-Agent Commands](./01-SLICE-non-agent-commands.md)                                   | verified | 00         | `init`; `docs`; `loop create`; `validate`; `loop list`; `loop status` |
| 02    | [Run Foundations Without Codex Launch](./02-SLICE-run-foundations-no-codex.md)           | verified | 01         | `run demo`; `validate demo`                                           |
| 03    | [Agent Invocation And Artifact Capture](./03-SLICE-agent-invocation-artifact-capture.md) | verified | 02         | `bun test`; `run demo`                                                |
| 04    | [Progress Verification](./04-SLICE-progress-verification.md)                             | planned | 03         | `bun test`; `run demo`                                                |
| 05    | [Quality Gate And Checkpoint Commits](./05-SLICE-quality-gate-checkpoint-commits.md)     | planned | 04         | `bun test`; `run demo`; `git log -1 --oneline`                        |
| 06    | [Rejection Stash And Retry Loop](./06-SLICE-rejection-stash-retry-loop.md)               | planned | 05         | `bun test`; `run demo`; `git stash list`                              |
| 07    | [Multi-Task Run Completion](./07-SLICE-multi-task-run-completion.md)                     | planned | 06         | `bun test`; `run demo`; `loop status demo`                            |
| 08    | [Final Validation, Docs, And Hardening](./08-SLICE-final-validation-docs-hardening.md)   | planned | 07         | `bun test`; `bun run check`; docs and validate smoke checks           |

## Working Rules

- Update this status table when a slice starts, is blocked, is implemented, or
  is verified.
- Keep per-slice files as implementation guides and completion notes, not as a
  second product spec.
- If implementation reveals a product decision gap, update `IMPLEMENTATION.md`
  first, then update the relevant slice file.
- Follow TDD: add focused tests first, then the smallest implementation that
  passes those tests.
- Do not advance to the next slice until the current slice acceptance checks
  pass or a blocker is recorded.

