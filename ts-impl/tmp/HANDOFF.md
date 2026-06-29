# Handoff: Ralph Loop TypeScript CLI

This is the entry point for the next agent working on the Bun TypeScript CLI
under `ts-impl/`. Read this first, then load the files in "Load Into Context"
before making or proposing changes.

## What We Are Building

A Bun-powered CLI named `ralph-loop` that runs a "Ralph loop" against a project:
it repeatedly launches a fresh coding agent (Codex in v1), verifies the agent's
work against a protocol, commits accepted work, stashes rejected work, and
decides whether to continue, block, or stop.

Key framing:

- The runner is **agent-less orchestration**. It does not implement tasks
  itself. It launches Codex, captures output, verifies protocol compliance,
  creates Git commits, stashes rejected work, and decides whether to continue,
  block, or stop.
- v1 is **Codex-first** (`codex exec --sandbox workspace-write`), local, and
  Bun-based. No standalone binary yet.
- The repo-local installation lives in `.jz-ralph/`. `progress.json` is the
  authoritative task ledger (not `PROGRESS.md`).
- **Git is mandatory**: clean worktree required before a run (hard fail, no
  bypass), one commit per accepted task, rejected work preserved via `git stash`
  with a recorded stable stash SHA.
- During `run`, Codex updates `progress.json`; the runner only verifies. The
  runner never fixes up task progress after Codex exits.

`../RALPH_LOOP.md` is the abstract protocol spec. Keep it abstract. All
TypeScript CLI product decisions live in `ts-impl/` docs — do not move product
decisions back into `RALPH_LOOP.md`.

## Load Into Context (in this order)

1. `ts-impl/IMPLEMENTATION.md` — authoritative v1 product spec (CLI shape,
   config, exit codes, verification rules, layout). When implementation reveals
   a product-decision gap, update this file first.
2. `ts-impl/GLOSSARY.md` — terminology to preserve (Loop, Plan, Task, Run,
   Agent-Iteration, Checkpoint, Rejection, Blocker).
3. `ts-impl/ENTITY_MODEL.md` — entity hierarchy.
4. `ts-impl/plan/README.md` — **authoritative slice status index** (Slices 0-8).
   Update the status table as slices progress.
5. `ts-impl/plan/NN-SLICE-*.md` — per-slice scope, TDD plan, acceptance checks,
   and completion notes.
6. `ts-impl/src/errors.ts` — `RalphError` class and `EXIT` codes.
7. `ts-impl/src/task-spec.ts` — Slice 0 module (consumed by later slices).
8. `ts-impl/src/commands/` — Slice 1 command modules (init, docs, loop, validate).
9. `ts-impl/src/cli.ts` — CLI entry / arg parsing / command dispatch.
10. `ts-impl/package.json` / `ts-impl/tsconfig.json` — Bun/scripts/strictness.

Only read `../RALPH_LOOP.md` if the user asks to revisit abstract protocol
semantics.

## Map Of Important Files

```text
ts-impl/
  IMPLEMENTATION.md      authoritative product spec
  GLOSSARY.md            terminology
  ENTITY_MODEL.md        entity hierarchy
  plan/
    README.md            slice status index (source of truth for progress)
    00..08-SLICE-*.md    per-slice guides + completion notes
  src/
    errors.ts            RalphError + EXIT codes map
    task-spec.ts         Slice 0: task contract module (DONE)
    cli.ts               CLI entry / arg parsing / command dispatch
    commands/
      init.ts            Slice 1: ralph-loop init
      docs.ts            Slice 1: ralph-loop docs
      loop.ts            Slice 1: ralph-loop loop create/list/status
      validate.ts        Slice 1: ralph-loop validate (expanded)
  test/
    task-spec.test.ts    Slice 0 tests (20 cases)
    slice-01.test.ts     Slice 1 tests (36 cases)
  tmp/
    HANDOFF.md           this file
    demo-tasks/          demo Task Specs for acceptance checks
```

Commands:

```bash
cd ts-impl
bun test          # run tests
bun run check     # bunx tsc --noEmit
bun run src/cli.ts help
```

## Current Status

- **Slice 0 (Task Spec Contract Foundations): VERIFIED.**
  - `src/task-spec.ts` provides: `isValidTaskFilename`, `taskIdFromFilename`,
    `parseTaskSpec`, `validateTaskDependencies`, `selectEligibleTask`.
  - 20 tests pass.

- **Slice 1 (Non-Agent Commands): VERIFIED.**
  - `src/errors.ts`: `RalphError` + `EXIT` codes map.
  - `src/commands/init.ts`: `runInit` — creates `.jz-ralph/` scaffold, checks
    for git repo, hard-fails if already exists.
  - `src/commands/docs.ts`: `getDocs` — 21 doc sections, `exit-codes` alias,
    space- and slash-separated nested section support.
  - `src/commands/loop.ts`: `runLoopCreate` (wired to Slice 0 task-spec for
    validation), `runLoopList`, `runLoopStatus`.
  - `src/commands/validate.ts`: expanded `validateInstallation` +
    `validateLoop` with JSON/schema validation for `config.json`,
    `progress.json`, and task files.
  - 36 Slice 1 tests pass. `bun test` 56/56. `bun run check` exit 0.
  - All Slice 1 acceptance checks pass.

- Slices 2-8: `planned`. `src/cli.ts` returns "pending" for `run` and `tasks`.
- Last commit on branch: `feat(ts-impl): implement Slice 01 — non-agent CLI
  commands` (`1c7861a`).

## Next Action

Start **Slice 2 — Run Foundations Without Codex Launch**
(`ts-impl/plan/02-SLICE-run-foundations-no-codex.md`).

Scope: parse `progress.json`, select the eligible task, generate
`RUN_CONTEXT.md`, implement the run loop skeleton (without actually launching
Codex), validate pre-run state (clean worktree, valid installation + loop).

Acceptance checks:

```bash
bun run src/cli.ts run demo
bun run src/cli.ts validate demo
```

## Working Conventions

- **TDD**: write focused tests first, then the smallest implementation that
  passes. (User preference.)
- Decisions are handled **one at a time**; the user wanted all slices recorded
  before implementation, which is done.
- Strong safety bias: Git required, clean-worktree hard fail, no bypass flag,
  rejected work stashed not discarded.
- After each slice: run its acceptance checks, update `plan/README.md` status to
  `verified`, and fill the slice file's Completion Notes before advancing.
- Keep task parsing/validation/selection in `task-spec.ts`, separate from CLI
  dispatch. `progress.json` is the only authoritative Plan/progress state.
- tsconfig is strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`);
  account for that in types.
