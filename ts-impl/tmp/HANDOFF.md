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
  creates Git commits, stashes rejected work, and decides whether to continue.
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
6. `ts-impl/src/task-spec.ts` — implemented Slice 0 module (consumed by later
   slices).
7. `ts-impl/src/cli.ts` — current CLI scaffold (still mostly pending commands).
8. `ts-impl/package.json` / `ts-impl/tsconfig.json` — Bun/scripts/strictness.

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
    cli.ts               CLI entry / arg parsing / command dispatch (scaffold)
    task-spec.ts         Slice 0: task contract module (DONE)
  test/
    task-spec.test.ts    Slice 0 tests (20 cases)
  tmp/
    HANDOFF.md           this file
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
    `parseTaskSpec` (required-heading validation + `Blocked By` parsing),
    `validateTaskDependencies` (unknown-ref + cycle detection), and
    `selectEligibleTask`.
  - `test/task-spec.test.ts`: 20 pass / 0 fail. `bun run check`: exit 0.
  - Slice 0 intentionally did NOT wire into `src/cli.ts` (out of scope there).
- Slices 1-8: `planned`. `src/cli.ts` still returns "pending" for `init`,
  `loop`, `tasks`, and `docs`, and only does file-presence `validate`.
- Last commit on `main`: `feat(ts-impl): add TypeScript CLI scaffold and Slice 0
  task-spec module` (`cdcf6a9`).

## Next Action

Start **Slice 1 — Non-Agent Commands** (`ts-impl/plan/01-SLICE-non-agent-commands.md`).

Scope: `init`, `docs`, expanded `validate`, `loop create`, `loop list`,
`loop status`. Wire `loop create` to the Slice 0 `task-spec.ts` module so invalid
Task Specs hard fail. Do NOT implement `run` in Slice 1.

Acceptance checks:

```bash
bun run src/cli.ts init
bun run src/cli.ts docs
bun run src/cli.ts docs examples simple
bun run src/cli.ts loop create --name demo --from ./tmp/demo-tasks
bun run src/cli.ts validate demo
bun run src/cli.ts loop list
bun run src/cli.ts loop status demo
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
  dispatch. `progress.json` is the only authoritative Plan/progress state — do
  not persist a derived task queue or dependency graph.
- tsconfig is strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`);
  account for that in types.
```
