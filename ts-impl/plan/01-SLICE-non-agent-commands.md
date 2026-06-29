# Slice 01: Non-Agent Commands

Status is tracked in [README.md](./README.md).

## Goal

Implement the deterministic CLI commands needed to initialize, inspect, document,
validate, and create Loops before any agent execution exists.

## Dependencies

- Slice 00 task-contract module.

## Scope

- Implement `ralph-loop init`.
- Implement `ralph-loop docs` as an index and `ralph-loop docs <section>`.
- Implement `ralph-loop loop create --name <loop-name> --from <task-source-dir>`.
- Implement `ralph-loop loop list`.
- Implement `ralph-loop loop status <loop-name>`.
- Expand `ralph-loop validate [<loop-name>] [--ralph-dir <path>]`.
- Wire `loop create` to the Slice 00 task module so invalid Task Specs hard
  fail.

## Out Of Scope

- `ralph-loop run`.
- Codex invocation.
- `ralph-loop tasks normalize`.
- Git checkpoint, stash, or quality gate behavior.

## Implementation Notes

- `init` hard fails if `.jz-ralph/` already exists.
- `init` hard fails outside a Git repository but does not require a clean
  worktree.
- `loop create` copies task files; it never moves them.
- Task files are sorted lexically to define Plan order.
- `progress.json.tasks[].dependencies` is populated from each Task Spec's
  `Blocked By` section.
- `docs status-codes` is the user-facing status/exit code reference.
- `docs exit-codes` remains an alias for `status-codes`.
- Nested docs support both `examples simple` and `examples/simple`.

## TDD Test Plan

- `init` creates the expected installation layout and default config.
- `init` fails when `.jz-ralph/` already exists.
- `loop create` imports valid Task Specs and writes `loop.json`,
  `progress.json`, `HANDOFF.md`, `tasks/`, and `runs/`.
- `loop create` rejects invalid filenames, missing headings, unknown
  dependencies, and dependency cycles.
- `loop list` prints existing Loops.
- `loop status` summarizes pending, complete, blocked, and eligible tasks.
- `validate` fails on malformed installation, Loop, config, progress, or task
  state.
- Docs aliases and nested sections resolve correctly.

## Acceptance Checks

```bash
bun run src/cli.ts init
bun run src/cli.ts docs
bun run src/cli.ts docs examples simple
bun run src/cli.ts loop create --name demo --from ./tmp/demo-tasks
bun run src/cli.ts validate demo
bun run src/cli.ts loop list
bun run src/cli.ts loop status demo
```

## Completion Notes

Implemented and verified. All 7 acceptance checks pass; `bun test` 56/56 pass;
`bun run check` exit 0.

New files:
- `src/errors.ts` — `RalphError` class and `EXIT` codes map.
- `src/commands/init.ts` — `runInit` + `isInsideGitRepo`.
- `src/commands/docs.ts` — `getDocs` with all 21 sections and `exit-codes` alias.
- `src/commands/loop.ts` — `runLoopCreate`, `runLoopList`, `runLoopStatus`.
- `src/commands/validate.ts` — `validateInstallation`, `validateLoop` (expanded
  with JSON/schema validation for config.json, progress.json, and task files).
- `test/slice-01.test.ts` — 36 tests covering all commands.
- `tmp/demo-tasks/` — two demo Task Spec files for acceptance checks.
