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
      run.ts             Slice 2: run setup (no Codex launch)
    agent.ts             Slice 3: Codex argv, outcome detection, iteration launch
  test/
    task-spec.test.ts    Slice 0 tests (20 cases)
    slice-01.test.ts     Slice 1 tests (36 cases)
    slice-02.test.ts     Slice 2 tests (9 cases)
    slice-03.test.ts     Slice 3 tests (16 cases)
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

- **Slice 2 (Run Foundations Without Codex Launch): VERIFIED.**
  - `src/commands/run.ts`: `loadConfig`, `formatRunId`, and `runSetup` —
    validates installation + Loop, resolves the work plane, enforces Git +
    clean-worktree (hard fail, no bypass), selects the eligible task, computes
    `agentIterationCap = pendingCount + maxRejectedIterations + 1`, creates
    `runs/<run-id>/`, and writes diagnostic `RUN_CONTEXT.md`.
  - `src/cli.ts`: `run <loop-name>` wired (setup only). Exits 0 on success, 4
    when all pending tasks are dependency-blocked, 3 on validation/Git failures.
  - `src/commands/docs.ts`: `run` section status updated.
  - 9 Slice 2 tests pass. `bun test` 65/65. `bun run check` exit 0.
  - Acceptance `run demo` + `validate demo` pass in a clean Git repo.

- **Slice 3 (Agent Invocation And Artifact Capture): VERIFIED.**
  - `src/agent.ts`: `buildCodexPrompt`, `buildCodexArgv` (default + optional
    `model`/`reasoningEffort`/`sandbox`/`profile` overrides), `detectOutcome`
    (standalone-only; `RALPH_BLOCKED` wins on conflict), `agentIterationDir` /
    `agentIterationArtifacts`, `defaultAgentSpawn` (timeout via SIGKILL, ENOENT
    recorded not thrown), and `runAgentIteration` (injectable launcher; snapshots
    progress before/after, captures stdout/stderr, detects outcome).
  - `RalphConfig.agent` widened to `CodexAgentConfig` in `src/commands/run.ts`.
  - `src/cli.ts`: `run` launches one Agent-Iteration after setup, reports the
    outcome + artifact paths, then stops before verification.
  - 16 Slice 3 tests pass. `bun test` 81/81. `bun run check` exit 0.

- Slices 4-8: `planned`. `src/cli.ts` still returns "pending" for `tasks`.
- Last verified commit on branch: Slice 02 (`16184e9`); Slice 03 commit lands on
  the same branch.

## Next Action

Start **Slice 4 — Progress Verification**
(`ts-impl/plan/04-SLICE-progress-verification.md`).

Scope: classify one Agent-Iteration as protocol-valid / blocked / rejected by
comparing `progress.before.json` and `progress.after.json` against the detected
outcome, and write `summary.json`. Slice 3's `runAgentIteration` already returns
the `outcome`, `timedOut`, and the artifact paths (`progress.before.json` /
`progress.after.json`) needed to drive verification. Reuse the Slice 0
eligible-task logic for task-identity checks. The runner only verifies; it never
edits `progress.json`.

Acceptance checks:

```bash
bun test
bun run src/cli.ts run demo
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
