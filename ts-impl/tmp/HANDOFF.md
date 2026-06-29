# Handoff: Ralph Loop TypeScript CLI Design

This handoff summarizes the design discussion for the Bun TypeScript CLI under
`ts-impl/`. Continue from here instead of restarting from `RALPH_LOOP.md`.

## Resume Instructions For Next Agent

Start by reading this file, then load these files before making or proposing
changes:

1. `IMPLEMENTATION.md` - authoritative TypeScript CLI product spec.
2. `GLOSSARY.md` - terminology to preserve.
3. `ENTITY_MODEL.md` - concrete TypeScript CLI entity model.
4. `package.json` - current Bun/package/bin/scripts decisions.
5. `src/cli.ts` - current runnable scaffold.

Only read `../RALPH_LOOP.md` if the user asks to revisit abstract protocol
semantics. Otherwise, keep `RALPH_LOOP.md` abstract and put product decisions in
`ts-impl/` docs.

Continue from the current planning point: implementation has not started. The
user wanted all implementation slices recorded first, and the recorded slice
plan now includes Slice 0 through Slice 8. Slice implementation tracking now
lives in `plan/README.md`, with details in `plan/NN-SLICE-*.md`. Next step:
start TDD implementation from Slice 0.

## Current State

The repo contains an abstract domain spec at `RALPH_LOOP.md`. For now, keep that
as the protocol-level spec. Product-specific TypeScript CLI decisions live under
`ts-impl/`.

Created/updated files:

- `ts-impl/IMPLEMENTATION.md`
- `ts-impl/GLOSSARY.md`
- `ts-impl/ENTITY_MODEL.md`
- `ts-impl/package.json`
- `ts-impl/tsconfig.json`
- `ts-impl/src/cli.ts`
- `ts-impl/tmp/HANDOFF.md`

The CLI scaffold is intentionally incomplete but runnable:

```bash
cd ts-impl
bun run src/cli.ts help
```

## Major Decisions

V1 is Codex-first.

Default Codex invocation:

```bash
codex exec --sandbox workspace-write
```

`--full-auto` was explicitly rejected because current Codex docs call it a
deprecated compatibility flag.

The runner is agent-less orchestration. It does not implement tasks. It launches
Codex, captures output, verifies protocol compliance, creates commits, stashes
rejected work, and decides whether to continue.

Use `.jz-ralph/` as the repo-local Ralph installation directory.

Use `progress.json` as the authoritative task ledger. Do not use `PROGRESS.md`
for the TypeScript v1 ledger.

Git is mandatory for v1:

- hard fail if the worktree is dirty before a run
- no `--allow-dirty`
- one Git commit per valid completed task
- rejected Agent-Iteration changes are preserved with `git stash`, including
  untracked files
- record stable stash commit SHA in run metadata, not only `stash@{0}`

Rejected Agent-Iterations are retried automatically. Default:

```json
{
  "maxRejectedIterations": 3
}
```

During `ralph-loop run`, Codex updates `progress.json`; the runner only verifies.
The runner should not fix up task progress after Codex exits.

## Entity Model

Preferred terminology:

- `Installation`: `.jz-ralph/` inside a repo
- `Loop`: durable unit of work, often tied to one feature/objective/issue bundle
- `Plan`: ordered, agent-ready task set owned by a Loop
- `Task`: one executable unit inside a Plan
- `Run`: one execution attempt of the runner against a Loop
- `Agent-Iteration`: one fresh Codex process launched by a Run
- `Checkpoint`: one Git commit for one accepted completed Task
- `Rejection`: invalid/unverifiable Agent-Iteration, preserved as a stash
- `Blocker`: valid `RALPH_BLOCKED` terminal state requiring human input

Use `Agent-Iteration`, not plain `Iteration`, in product docs.

Hierarchy:

```text
Installation
  has many Loops

Loop
  owns one Plan
  records many Runs
  may reference one Feature or Objective

Plan
  has many Tasks
  has one Progress Ledger

Run
  has many Agent-Iterations
  has logs and summaries
  ends as done | blocked | rejected | failed | capped

Agent-Iteration
  targets at most one Task
  may produce one Checkpoint
  may produce one Rejection stash
```

## Planned Layout

Repo-level:

```text
.jz-ralph/
  config.json
  AGENTS.md
  KNOWLEDGE.md
  loops/
```

Loop-level:

```text
.jz-ralph/loops/<loop-name>/
  loop.json
  progress.json
  HANDOFF.md
  tasks/
  runs/
```

Run artifacts:

```text
.jz-ralph/loops/<loop-name>/runs/<run-id>/agent-iterations/<n>/
  stdout.log
  stderr.log
  gate.stdout.log
  gate.stderr.log
  progress.before.json
  progress.after.json
  summary.json
```

Runner-owned run context:

```text
.jz-ralph/loops/<loop-name>/runs/<run-id>/RUN_CONTEXT.md
```

## Context Surfaces

Users can add context through:

- `.jz-ralph/AGENTS.md`: repo-wide Ralph protocol and behavior rules
- `.jz-ralph/KNOWLEDGE.md`: durable repo/project facts
- `.jz-ralph/loops/<loop-name>/HANDOFF.md`: short-term Loop continuity
- `.jz-ralph/loops/<loop-name>/tasks/*.md`: feature/task-specific context

Feature-specific context should usually live in task specs, not in `AGENTS.md`.

Task decomposition is not the runner's runtime responsibility. The user or a
planning agent prepares agent-ready task files first. Then:

```bash
ralph-loop loop create --name <loop-name> --from <task-source-dir>
```

imports/copies them into Loop state.

## CLI Direction

Current intended CLI:

```text
ralph-loop init
ralph-loop loop create --name <loop-name> --from <task-source-dir>
ralph-loop loop list
ralph-loop loop status <loop-name>
ralph-loop tasks normalize --from <task-source-dir> --to <normalized-task-source-dir>
ralph-loop run <loop-name> [--ralph-dir <path>]
ralph-loop validate [<loop-name>] [--ralph-dir <path>]
ralph-loop docs
ralph-loop docs <doc-section>
ralph-loop help
```

The scaffolded `src/cli.ts` currently validates installation/loop file presence
only. `run`, `init`, and `loop` behavior still need implementation.

## Codex Config Decisions

`config.json` should support optional Codex settings:

```json
{
  "workPlane": ".",
  "qualityGate": "bun test",
  "agent": {
    "kind": "codex",
    "model": null,
    "reasoningEffort": null,
    "sandbox": "workspace-write",
    "profile": null,
    "requiredSkills": []
  },
  "maxRejectedIterations": 3,
  "agentTimeoutSeconds": 1800,
  "qualityGateTimeoutSeconds": 600,
  "commitRunArtifacts": false
}
```

Mapping:

- `model` -> `--model <model>`
- `reasoningEffort` -> `-c model_reasoning_effort="<effort>"`
- `sandbox` -> `--sandbox <mode>`
- `profile` -> `--profile <profile>`

`profile`, `model`, and `reasoningEffort` are optional. Profiles can include
more than model/reasoning, such as MCP servers, approval behavior, and skill
config.

V1 does not install or validate Codex skills. If `requiredSkills` is non-empty,
the prompt tells Codex to use them if available. If a required skill is missing,
Codex should emit `RALPH_BLOCKED` and explain the missing skill in `HANDOFF.md`.

V1 supports Codex only. No `--agent` CLI override, raw shell command agent
config, or argv-array custom agent config. Keep `agent.kind: "codex"` for schema
clarity and future-proofing. Future non-Codex support should use named presets
first.

## Core Decision Pass

The initial 7-question decision pass is complete.

Current discussion: pre-implementation product decisions are complete, including
the Task Source / Task Spec contract and Slice 0 through Slice 8. The next step
is implementation, starting with Slice 0 in TDD style.

## Remaining Work

1. Implement Slice 0: Task Spec Contract Foundations, test-first.
2. Implement Slice 1: `init`, `docs`, expanded `validate`, `loop create`,
   `loop list`, and `loop status`, using the Slice 0 task module.
3. Continue through approved Slices 2-8 in order.
4. Verify each slice with its acceptance checks before moving to the next.

Use `plan/README.md` as the authoritative slice status index. The embedded
slice list below is retained as continuity context, but execution details should
be updated in `plan/NN-SLICE-*.md`.

## Recent Decisions

Default max Agent-Iteration cap:

- Do not hardcode `20`.
- Compute the default at Run start as
  `pendingTaskCount + maxRejectedIterations + 1`.
- `maxRejectedIterations` is a per-Run total.
- The final `+ 1` allows a final `RALPH_DONE` Agent-Iteration.

CLI docs command:

- Add `ralph-loop docs` as a documentation index.
- Add `ralph-loop docs <doc-section>` to print only one documentation section,
  so agents can fetch narrow CLI guidance without loading all docs.
- `ralph-loop docs` prints only the index; it does not dump all docs.
- V1 index: `overview`, `commands`, `config`, `init`, `loop-create`,
  `loop-status`, `task-source`, `task-spec`, `tasks-normalize`, `run`,
  `validate`, `protocol`, `progress-ledger`, `run-context`, `checkpoints`,
  `rejections`, `artifacts`, `status-codes`, `exit-codes`,
  `troubleshooting`, `examples`, `examples/simple`, `examples/advanced`.
- Add `ralph-loop docs status-codes` for process exit/status code reference.
- Keep `ralph-loop docs exit-codes` as an alias for `status-codes`.
- Nested docs should work as both `ralph-loop docs examples simple` and
  `ralph-loop docs examples/simple`.
- Include an `examples` docs section.
- Include `ralph-loop docs examples simple` for a mostly-default happy path.
- Include `ralph-loop docs examples advanced` to showcase most customization
  points and options.

Timeout defaults:

- `agentTimeoutSeconds`: `1800` seconds.
- `qualityGateTimeoutSeconds`: `600` seconds.
- Timeouts are treated as rejected Agent-Iterations.
- If timed-out attempts leave worktree changes, preserve them with the normal
  rejection stash behavior.

Exit codes:

```text
0  done / success
1  unexpected runner error
2  config or usage error
3  validation error
4  blocked
5  rejection cap reached
6  timeout
7  quality gate failed
```

Exit code `6` only applies when the Run stops because of timeout. If a
timed-out Agent-Iteration is retried successfully, the final process exit is
`0`.

Run context binding:

- The runner generates
  `.jz-ralph/loops/<loop-name>/runs/<run-id>/RUN_CONTEXT.md`.
- The runner creates it when a Run starts and regenerates or updates it before
  each Agent-Iteration.
- Codex reads `RUN_CONTEXT.md` but must not edit it.
- The Codex invocation prompt can stay minimal:
  `Read .jz-ralph/loops/<loop-name>/runs/<run-id>/RUN_CONTEXT.md and follow it exactly.`
- `RUN_CONTEXT.md` includes dynamic runtime facts such as Loop name, Run id,
  current Agent-Iteration number, selected eligible task, retry counts, caps,
  relevant paths, outcome rules, and progress rules.
- `RUN_CONTEXT.md` is a run diagnostic artifact and is not committed by default
  unless run artifacts are configured to be committed.

Checkpoint artifact commits:

- Default `commitRunArtifacts` is `false`.
- Accepted task checkpoints commit durable project/control-plane state, not run
  diagnostics.
- Include `.jz-ralph/loops/<loop-name>/runs/<run-id>/RUN_CONTEXT.md`, logs,
  summaries, and progress snapshots in successful commits only when
  `commitRunArtifacts` is `true`.

Loop create direction:

- Public flag is `--name <loop-name>`, not `--id`.
- `name` is the unique Loop slug used in CLI commands and directory names.
- Each Loop owns its own `.jz-ralph/loops/<loop-name>/tasks/` directory.
- `loop create` copies task files from `--from`; it does not move them.
- Task files are sorted lexically to define Plan order.
- Task filenames must match:
  `^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$`
- Generate `progress.json` with every imported task marked `pending`.
- Set task ids from filenames without `.md`.
- Generate `loop.json`; current proposed fields are `name`, `title`,
  `objective`, `createdAt`, and `taskSource`.
- Generate default `HANDOFF.md` with guidance that the agent should use it for
  concise short-term Loop continuity, task-completion notes, discovered context,
  and blockers.

Init behavior:

- `ralph-loop init` creates `.jz-ralph/config.json`, `.jz-ralph/AGENTS.md`,
  `.jz-ralph/KNOWLEDGE.md`, and `.jz-ralph/loops/`.
- Hard fail if `.jz-ralph/` already exists.
- Hard fail if the current directory is not inside a Git repository.
- Do not require a clean worktree for `init`; only `run` requires a clean
  worktree.
- Generate `config.json` with approved defaults:
  `workPlane: "."`, `qualityGate: "bun test"`, Codex agent defaults,
  `maxRejectedIterations: 3`, `agentTimeoutSeconds: 1800`,
  `qualityGateTimeoutSeconds: 600`, and `commitRunArtifacts: false`.
- Generate `KNOWLEDGE.md` with a short placeholder.
- Generate `AGENTS.md` with Ralph protocol instructions and agent behavior
  rules.
- Create `loops/` empty.
- After success, print next-step guidance including:
  `ralph-loop docs`, `ralph-loop docs <doc-section>`,
  `ralph-loop docs examples simple`,
  `ralph-loop loop create --name <loop-name> --from <task-source-dir>`, and
  `ralph-loop run <loop-name>`.

Run resumability:

- V1 resumes only from durable Loop state files.
- Authoritative state: `progress.json`, Loop `HANDOFF.md`, `KNOWLEDGE.md`, and
  Loop `tasks/`.
- Run artifacts under `.jz-ralph/loops/<loop-name>/runs/**/*` are diagnostic
  only.
- A new `ralph-loop run <loop-name>` reads `progress.json`, computes the first
  eligible pending task from task order and dependencies, and ignores old
  `runs/*/summary.json` files for control flow.

Implementation review:

- Required before implementation starts.
- Reconcile `IMPLEMENTATION.md`, `GLOSSARY.md`, `ENTITY_MODEL.md`,
  `src/cli.ts`, and `tmp/HANDOFF.md`.
- Check for stale `loop id` / `<loop-id>` / `--id` terminology, stale
  `maxIterations: 20`, missing config defaults, missing docs command references,
  and missing notes for `RUN_CONTEXT.md`, `commitRunArtifacts`, Codex-only v1,
  and file-only resumability.

Original first implementation slice, now Slice 1:

- Approved scope: `init`, `docs`, `validate`, `loop create`, `loop list`, and
  `loop status`.
- Do not implement `run` in the first slice.
- Slice 0 was added before this slice to establish Task Spec contract parsing,
  validation, dependency checks, and eligible-task selection.
- Acceptance checks:
  `bun run src/cli.ts init`,
  `bun run src/cli.ts docs`,
  `bun run src/cli.ts docs examples simple`,
  `bun run src/cli.ts loop create --name demo --from ./tmp/demo-tasks`,
  `bun run src/cli.ts validate demo`,
  `bun run src/cli.ts loop list`, and
  `bun run src/cli.ts loop status demo`.

Release packaging:

- Keep v1 local and Bun-based until CLI behavior is stable.
- `package.json` exposes `"ralph-loop": "./src/cli.ts"` in `bin`.
- Required scripts: `check`, `start`, and `test`.
- Do not bundle or compile a standalone executable in the first implementation
  slice.
- Revisit `bun build --compile`, npm publishing, GitHub release binaries, and
  cross-platform install docs after local behavior works.

Latest verification:

- On 2026-06-30, `bun run check` passed.
- On 2026-06-30, `bun run src/cli.ts help` passed and showed `--name` plus the
  pending `docs` command.

## User Preferences / Constraints

The user wants decisions handled one at a time.

The user wants all implementation slices recorded before implementation starts.

The user prefers strong safety:

- Git required
- clean worktree hard fail
- no bypass flag
- rejected work preserved via stash instead of discarded

The user likes to work with TDD. Implementation slices should start with focused
tests for the intended CLI behavior, then make the smallest implementation pass
those tests.

The user makes typos and appreciates corrections without fuss.

Keep `RALPH_LOOP.md` abstract for now. Put TypeScript CLI product decisions in
`ts-impl/` docs.

## Approved Implementation Slices

### Slice 0: Task Spec Contract Foundations

Scope:

- add tests first for task spec parsing and validation
- implement a separate task module for:
  - filename validation
  - required heading validation
  - `Blocked By` parsing
  - dependency existence validation
  - cycle detection
  - eligible-task selection from `progress.json`
- do not wire it fully into CLI yet except where needed by tests
- do not invoke Codex
- do not copy files yet

Acceptance checks:

```bash
bun test
bun run check
```

Expected result: task contract logic is independently tested and ready for
`loop create`, `validate`, and `run` to consume.

### Slice 1: Non-Agent Commands

Scope:

- `init`
- `docs`
- expanded `validate`
- `loop create`
- `loop list`
- `loop status`
- wire `loop create` to the Slice 0 task module so invalid Task Specs hard fail

Do not implement `run` in Slice 1.

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

### Slice 2: Run Foundations Without Codex Launch

Scope:

- add Run directory creation under
  `.jz-ralph/loops/<loop-name>/runs/<run-id>/`
- generate `RUN_CONTEXT.md`
- read and validate `config.json`
- load `progress.json`
- select the first eligible pending task using task order and dependencies
- compute Run caps:
  `agentIterationCap = pendingTaskCount + maxRejectedIterations + 1`
- keep `maxRejectedIterations` as a per-Run total
- validate Git requirements for `run`:
  - work plane is inside a Git repository
  - worktree is clean before Run starts
- add dry internal run scaffolding, but do not launch Codex yet
- make `ralph-loop run <loop-name>` stop after generating run context and print
  what would happen next

Acceptance checks:

```bash
bun run src/cli.ts run demo
bun run src/cli.ts validate demo
```

Expected result: Run setup succeeds only for a valid Loop and clean Git
worktree, creates diagnostic run context, and exits with pending/placeholder
behavior rather than invoking Codex.

### Slice 3: Agent Invocation And Artifact Capture

Scope:

- add focused tests first for Codex argv construction and artifact paths
- build Codex command from `config.json`
- create per-Agent-Iteration artifact directories
- capture:
  - `stdout.log`
  - `stderr.log`
  - `progress.before.json`
  - `progress.after.json`
- enforce `agentTimeoutSeconds`
- detect standalone outcome lines:
  - `RALPH_NEXT`
  - `RALPH_DONE`
  - `RALPH_BLOCKED`
- do not verify progress semantics yet
- do not run quality gates yet
- do not commit or stash yet

Acceptance checks:

```bash
bun test
bun run src/cli.ts run demo
```

Expected result: the runner can launch one Codex Agent-Iteration, capture
diagnostics, detect the reported outcome, and stop before accepting or rejecting
changes.

### Slice 4: Progress Verification

Scope:

- add tests first for valid and invalid `progress.json` transitions
- compare `progress.before.json` and `progress.after.json`
- enforce:
  - missing or invalid outcome keyword is rejected
  - multiple outcome keywords resolves with `RALPH_BLOCKED` winning
  - `RALPH_NEXT` must complete exactly one task
  - `RALPH_NEXT` must complete the selected eligible task
  - `RALPH_DONE` requires no pending tasks
  - `RALPH_DONE` must not complete a new task
  - `RALPH_BLOCKED` must not complete a new task
- write Agent-Iteration `summary.json` with accepted, rejected, or blocked
  status and reason
- do not run quality gates yet
- do not commit or stash yet
- do not retry yet

Acceptance checks:

```bash
bun test
bun run src/cli.ts run demo
```

Expected result: the runner can classify one Agent-Iteration as protocol-valid,
blocked, or rejected based on outcome plus ledger transition, but does not yet
preserve or accept work.

### Slice 5: Quality Gate And Checkpoint Commits

Scope:

- add tests first for quality gate execution decisions and commit message
  construction
- run `qualityGate` only after protocol-valid `RALPH_NEXT`
- enforce `qualityGateTimeoutSeconds`
- capture:
  - `gate.stdout.log`
  - `gate.stderr.log`
- treat failed or timed-out quality gate as rejection
- for accepted `RALPH_NEXT`, create one Git commit:
  - default message `ralph: complete <task-id>`
  - include durable project and control-plane state
  - include run artifacts only when `commitRunArtifacts: true`
- do not implement rejection stash or retry yet
- `RALPH_DONE` and `RALPH_BLOCKED` terminal behavior should exit with correct
  codes but not create commits

Acceptance checks:

```bash
bun test
bun run src/cli.ts run demo
git log -1 --oneline
```

Expected result: a valid task completion with passing quality gate becomes one
Checkpoint commit; invalid or failed attempts are classified but not yet
preserved through stash or retry.

### Slice 6: Rejection Stash And Retry Loop

Scope:

- add tests first for rejection cap behavior and stash metadata parsing
- on rejected Agent-Iteration, stash all worktree changes including untracked
  files
- record stable stash commit SHA and stash message in Agent-Iteration
  `summary.json`
- restore clean worktree before retrying
- retry the same selected task until:
  - accepted completion
  - valid blocked state
  - valid done state
  - `maxRejectedIterations` cap is reached
  - timeout stop condition applies
- generate one summary per Agent-Iteration
- ensure timed-out Agent-Iterations use the same rejection stash path when they
  leave changes
- stop with exit code `5` when rejection cap is reached
- stop with exit code `6` only when the final Run outcome is timeout

Acceptance checks:

```bash
bun test
bun run src/cli.ts run demo
git stash list
```

Expected result: rejected or timed-out work is preserved in Git stash with
stable metadata, the runner retries within caps, and exits cleanly when the cap
is reached.

### Slice 7: Multi-Task Run Completion

Scope:

- add tests first for full Run control flow across multiple pending tasks
- after an accepted Checkpoint, reload `progress.json`
- continue to the next eligible pending task in the same Run
- regenerate `RUN_CONTEXT.md` before each Agent-Iteration
- stop with `0` when all tasks are complete and an Agent-Iteration emits valid
  `RALPH_DONE`
- stop with `4` on valid `RALPH_BLOCKED`
- preserve file-only resumability:
  - new Runs use `progress.json`, `HANDOFF.md`, `KNOWLEDGE.md`, and `tasks/`
  - old `runs/*/summary.json` files remain diagnostic only
- ensure `agentIterationCap` prevents infinite loops

Acceptance checks:

```bash
bun test
bun run src/cli.ts run demo
bun run src/cli.ts loop status demo
```

Expected result: one `ralph-loop run <loop-name>` can process multiple tasks
through Checkpoints, stop correctly on done or blocked, and remain resumable
from durable Loop state.

### Slice 8: Final Validation, Docs, And Hardening

Scope:

- add tests first for CLI usage errors, docs aliases, and validation failures
- complete `validate` coverage:
  - config schema shape
  - loop metadata shape
  - progress ledger shape
  - task spec path existence
  - invalid task statuses
  - missing required files/directories
- complete built-in docs sections, including:
  - `status-codes`
  - `exit-codes` alias
  - `examples simple`
  - `examples advanced`
- normalize docs paths:
  - `examples simple`
  - `examples/simple`
- ensure stable exit codes for all command families
- run the required implementation review:
  - reconcile `IMPLEMENTATION.md`, `GLOSSARY.md`, `ENTITY_MODEL.md`,
    `src/cli.ts`, and `tmp/HANDOFF.md`
  - remove stale `loop id`, `<loop-id>`, `--id`, and `maxIterations: 20`
  - verify docs command references
  - verify `RUN_CONTEXT.md`, `commitRunArtifacts`, Codex-only v1, and
    file-only resumability notes
- run full checks

Acceptance checks:

```bash
bun test
bun run check
bun run src/cli.ts docs status-codes
bun run src/cli.ts docs exit-codes
bun run src/cli.ts docs examples/simple
bun run src/cli.ts validate demo
```

Expected result: command behavior, docs, validation, and specs are internally
consistent enough to start implementation slices with TDD.

## Open Planning Topic: Task Source / Task Spec Contract

The user identified a missing contract for copied task/issue specs. The
`ralph-loop` caller is responsible for decomposing work, but the Task Source
should still satisfy a runner-defined contract so imported tasks are
agent-ready.

Approved direction:

- define a Task Source / Task Spec contract before implementation review
- add task metadata, including dependency metadata such as `Blocked By`
- create a dependency graph for tasks during Loop creation
- add a separate module for task-spec parsing, validation, dependency graph
  construction, and eligible-task selection
- add a quality-of-life command that uses Codex to rewrite raw target tasks into
  contract-compliant Task Specs

Recommended CLI addition:

```text
ralph-loop tasks normalize --from <task-source-dir> --to <normalized-task-source-dir>
```

Rules:

- `loop create` should stay deterministic and should not invoke Codex
  implicitly
- callers with messy issue/task input can run `tasks normalize` first, inspect
  the normalized Markdown files, then run `loop create`
- `loop create` should hard fail on invalid Task Specs, because invalid tasks
  are not agent-ready

Recommended Task Spec contract:

```md
# <task title>

## Objective
One concrete outcome this task must accomplish.

## Scope
What files, behavior, or area this task is expected to touch.

## Out Of Scope
What the agent must not do in this task.

## Blocked By
- <task-id>

Use `None` when the task has no dependencies.

## Acceptance Criteria
- Observable condition 1
- Observable condition 2

## Verification
Command(s) or checks the agent should run before emitting RALPH_NEXT.

## Notes
Optional context, constraints, links, risks, or implementation hints.
```

Recommended dependency behavior:

- parse `## Blocked By` values as task ids
- hard fail if a referenced dependency does not exist in the imported task set
- hard fail on dependency cycles
- preserve lexical task order as the stable Plan order
- select the first pending task whose dependencies are complete, not simply the
  first pending task
- store dependencies in `progress.json` task entries, using the existing
  `dependencies` array shape
- do not persist a separate `implementationTaskList`, task queue, or derived
  dependency graph in v1
- keep `progress.json` as the only authoritative Plan/progress state
- compute eligible task order from `progress.json.tasks[].dependencies` on
  demand
- `RUN_CONTEXT.md` may include a derived execution view for diagnostics, such
  as eligible tasks and pending tasks blocked by incomplete dependencies

Docs additions:

- `ralph-loop docs task-source`
- `ralph-loop docs task-spec`
- `ralph-loop docs tasks-normalize`
