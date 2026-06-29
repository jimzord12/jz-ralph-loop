# Ralph Loop TypeScript CLI Implementation

This document turns `../RALPH_LOOP.md` into concrete implementation choices for
the Bun.js TypeScript CLI. The domain spec is authoritative; this file defines
the v1 product behavior where the domain spec intentionally leaves room.

## Current Scope

Build a Bun-powered CLI named `ralph-loop` that can run a Ralph loop against a
Loop and work plane.

The initial implementation should prioritize:

- predictable file-based behavior
- clear verification and rejection semantics
- useful logs for debugging failed iterations
- no hidden long-lived state
- minimal dependencies

## Proposed CLI

```text
ralph-loop init

ralph-loop loop create --name <loop-name> --from <task-source-dir>
ralph-loop loop list
ralph-loop loop status <loop-name>

ralph-loop tasks normalize --from <task-source-dir> --to <normalized-task-source-dir>

ralph-loop run <loop-name>
ralph-loop run <loop-name> --ralph-dir <path>

ralph-loop validate
ralph-loop validate <loop-name>
ralph-loop validate --ralph-dir <path>
ralph-loop docs
ralph-loop docs <doc-section>
ralph-loop help
```

By default, the runner uses `.jz-ralph/` in the current working directory.

## Proposed V1 Behavior

### Control Plane Validation

The runner validates that these repo-level entries exist before running:

- `config.json`
- `AGENTS.md`
- `KNOWLEDGE.md`
- `loops/`

The runner validates that these Loop-level entries exist for the selected Loop:

- `loop.json`
- `progress.json`
- `HANDOFF.md`
- `tasks/`

Default layout:

```text
.jz-ralph/
  config.json
  AGENTS.md
  KNOWLEDGE.md
  loops/
    <loop-name>/
      loop.json
      progress.json
      HANDOFF.md
      tasks/
      runs/
```

### Initialization

`ralph-loop init` creates a repo-local Ralph installation:

```text
.jz-ralph/
  config.json
  AGENTS.md
  KNOWLEDGE.md
  loops/
```

Rules:

- hard fail if `.jz-ralph/` already exists
- hard fail if the current directory is not inside a Git repository
- do not require a clean worktree for `init`; only `run` requires a clean
  worktree
- create `loops/` empty
- generate `KNOWLEDGE.md` with a short placeholder
- generate `AGENTS.md` with Ralph protocol instructions and agent behavior
  rules
- generate `config.json` with the approved defaults

Default `config.json`:

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

After successful initialization, print next-step guidance:

```text
Ralph initialized in .jz-ralph/

Next:
  ralph-loop docs
  ralph-loop docs <doc-section>
  ralph-loop docs examples simple
  ralph-loop loop create --name <loop-name> --from <task-source-dir>
  ralph-loop run <loop-name>
```

### Configuration

V1 reads `.jz-ralph/config.json` by default. The config file contains runner and
agent invocation settings, not task state.

Proposed shape:

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

The runner translates Codex agent settings into CLI arguments:

- `model` -> `--model <model>`
- `reasoningEffort` -> `-c model_reasoning_effort="<effort>"`
- `sandbox` -> `--sandbox <mode>`
- `profile` -> `--profile <profile>`

`profile`, `model`, and `reasoningEffort` are optional. A profile may already
define model, reasoning effort, MCP servers, skill config, approval behavior, or
other Codex settings. Explicit v1 config values should be passed as CLI
overrides when present.

V1 does not install or validate Codex skills. If `requiredSkills` is non-empty,
the static prompt tells Codex to use those skills if available. If a required
skill is unavailable, Codex must emit `RALPH_BLOCKED` and explain the missing
skill in `HANDOFF.md`.

V1 does not hardcode a fixed default maximum Agent-Iteration count. Unless an
explicit override is added later, the runner computes the cap at Run start:

```text
pendingTaskCount + maxRejectedIterations + 1
```

`maxRejectedIterations` is a per-Run total. The final `+ 1` allows a final
Agent-Iteration to emit `RALPH_DONE` after all pending tasks have been
completed.

Each Agent-Iteration has an `agentTimeoutSeconds` timeout, defaulting to `1800`
seconds. The quality gate has a separate `qualityGateTimeoutSeconds` timeout,
defaulting to `600` seconds. If an Agent-Iteration or quality gate times out,
the runner treats the attempt as rejected. If the timeout left worktree changes,
those changes are preserved with the same rejection stash behavior used for
other invalid Agent-Iterations.

### Exit Codes

V1 uses stable process exit codes:

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

Timeouts are rejected Agent-Iterations. Exit code `6` is only the final process
exit when the Run stops because of timeout. If a timed-out Agent-Iteration is
stashed and a later retry succeeds, the final exit code is `0`.

### CLI Documentation

The CLI should expose built-in docs for both humans and agents.

```text
ralph-loop docs
ralph-loop docs <doc-section>
ralph-loop docs examples
ralph-loop docs examples simple
ralph-loop docs examples advanced
```

`ralph-loop docs` should return an index of available documentation sections,
including protocol rules, control-plane layout, config shape, command behavior,
outcome keywords, verification rules, artifact paths, and troubleshooting
guidance.

`ralph-loop docs <doc-section>` should print only the requested section. This
lets an agent fetch narrow, relevant CLI guidance without loading the full
implementation document into context.

V1 docs index:

```text
ralph-loop docs overview
ralph-loop docs commands
ralph-loop docs config
ralph-loop docs init
ralph-loop docs loop-create
ralph-loop docs loop-status
ralph-loop docs task-source
ralph-loop docs task-spec
ralph-loop docs tasks-normalize
ralph-loop docs run
ralph-loop docs validate
ralph-loop docs protocol
ralph-loop docs progress-ledger
ralph-loop docs run-context
ralph-loop docs checkpoints
ralph-loop docs rejections
ralph-loop docs artifacts
ralph-loop docs status-codes
ralph-loop docs exit-codes
ralph-loop docs troubleshooting
ralph-loop docs examples
ralph-loop docs examples simple
ralph-loop docs examples advanced
```

`ralph-loop docs status-codes` is the user-facing process status/exit code
reference. `ralph-loop docs exit-codes` should remain available as an alias.

`ralph-loop docs` prints only the index. It does not dump all docs by default.
Nested docs should support both space-separated and slash-separated forms, such
as `ralph-loop docs examples simple` and `ralph-loop docs examples/simple`.
Internally, nested names can normalize to slash form.

The docs command must include an `examples` section with two sub-sections:

- `simple`: mostly relies on defaults and shows the shortest practical happy
  path.
- `advanced`: showcases most available customization points and options,
  including config values, non-default Ralph directory, agent settings, and
  validation/run commands.

### Loops And Plans

A Loop is a durable unit of work, usually tied to one feature, objective, issue
bundle, or planned change. A Loop owns one Plan and records many Runs.

Task decomposition is not the runner's runtime responsibility. The caller is
responsible for decomposing issues or objectives into task specs, but those task
specs must satisfy the Ralph Task Spec contract before they can be imported into
a Loop. `ralph-loop loop create` copies an external Task Source into Loop state,
but `ralph-loop run` expects the Loop's Plan to already be agent-ready.

For quality of life, v1 should include a Codex-assisted normalization command:

```text
ralph-loop tasks normalize --from <task-source-dir> --to <normalized-task-source-dir>
```

This command rewrites raw target tasks or issue notes into contract-compliant
Task Specs. `loop create` remains deterministic and must not invoke Codex
implicitly. A caller can normalize, inspect the generated Markdown, then import
the normalized Task Source.

Each Loop owns its own `tasks/` directory under `.jz-ralph/loops/<loop-name>/`.
Task files are copied from the Task Source into that Loop-local directory.

V1 Loop metadata lives in `.jz-ralph/loops/<loop-name>/loop.json`.

Proposed shape:

```json
{
  "name": "feature-auth-refresh",
  "title": "Auth refresh tokens",
  "objective": "Add refresh-token support to the auth flow",
  "createdAt": "2026-06-29T19:00:00.000Z",
  "taskSource": "../planning/auth-refresh-tasks"
}
```

`name` is the unique Loop slug used in CLI commands and directory names. V1 uses
`--name` instead of `--id` because `id` can imply an auto-generated number or
UUID.

`ralph-loop loop create --name <loop-name> --from <task-source-dir>` should:

- hard fail if the Loop name already exists
- hard fail if `--from` does not exist or is not a directory
- copy matching task files into `.jz-ralph/loops/<loop-name>/tasks/`
- sort task files lexically to define Plan order
- generate `progress.json` with each task marked `pending`
- set task ids from filenames without `.md`
- generate `loop.json`
- generate default `HANDOFF.md`
- create empty `runs/`

Task filenames must match:

```text
^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$
```

Task files must be non-empty Markdown files using this contract:

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

Required headings:

- `Objective`
- `Scope`
- `Out Of Scope`
- `Blocked By`
- `Acceptance Criteria`
- `Verification`

`Notes` is optional.

`loop create` should hard fail if a Task Spec is missing a required heading, is
empty, references a dependency that is not present in the imported task set, or
creates a dependency cycle.

The implementation should keep task parsing, validation, dependency graph
construction, and eligible-task selection in a separate module from CLI command
dispatch. Do not persist a separate `implementationTaskList`, task queue, or
derived dependency graph in v1. `progress.json` remains the only authoritative
Plan/progress state. The runner computes eligible task order from
`progress.json.tasks[].dependencies` on demand. `RUN_CONTEXT.md` may include a
derived execution view, such as eligible tasks and pending tasks blocked by
incomplete dependencies, because Run context is diagnostic rather than
authoritative state.

The generated `HANDOFF.md` should include brief guidance for the agent, such as:

```md
# Loop Handoff

Use this file to record short-term continuity for the current Loop.

Update it when you complete a task, discover important context that is not
durable enough for KNOWLEDGE.md, or hit a blocker. Keep it concise and focused
on what the next Agent-Iteration needs to know.
```

### Progress Ledger

V1 uses `.jz-ralph/loops/<loop-name>/progress.json` as the authoritative task
ledger for a Loop.

Required shape:

```json
{
  "tasks": [
    {
      "id": "001-task-id",
      "status": "pending",
      "spec": "tasks/001-task-id.md",
      "dependencies": []
    }
  ]
}
```

Allowed task statuses are `pending`, `complete`, and `blocked`. The next
eligible task is the first `pending` task, in stable Plan order, whose
dependencies are complete. Dependencies are parsed from each Task Spec's
`Blocked By` section and stored in that task's `dependencies` array.

### Agent Invocation

The runner should launch a fresh process for each Agent-Iteration. The working
directory should be the work plane.

V1 is Codex-first. The default Codex invocation is:

```text
codex exec --sandbox workspace-write
```

V1 supports Codex only. It does not expose a `--agent` CLI override, raw shell
command agent config, or argv-array custom agent config. `agent.kind: "codex"`
is kept for schema clarity and future-proofing. Future non-Codex support, if
added, should use named presets before any custom command mechanism.

V1 should use a static bundled Codex prompt template. The prompt instructs Codex
to read `.jz-ralph/config.json`, `.jz-ralph/AGENTS.md`, and the selected Loop
directory.

Because the selected Loop changes per command invocation, the runner must provide
Codex the Loop name and other runtime bindings. V1 does this with a runner-owned
generated Run context file:

```text
.jz-ralph/loops/<loop-name>/runs/<run-id>/RUN_CONTEXT.md
```

The runner creates this file when a Run starts and regenerates or updates it
before each Agent-Iteration. Codex reads this file but must not edit it.

`RUN_CONTEXT.md` should include:

- Loop name
- Run id
- Ralph directory
- work plane
- current Agent-Iteration number
- selected eligible task, if any
- rejected attempt count for the Run
- configured rejection and Agent-Iteration caps
- required control-plane file paths
- required outcome keyword rules
- progress update rules
- relevant artifact paths

The Codex invocation prompt can stay minimal:

```text
Read .jz-ralph/loops/<loop-name>/runs/<run-id>/RUN_CONTEXT.md and follow it exactly.
```

The Ralph protocol instructions remain static; `RUN_CONTEXT.md` binds the
selected Loop name, Run id, selected task, retry counts, and other runtime
facts. It belongs to run diagnostics and is not committed by default unless run
artifacts are configured to be committed.

### Outcome Detection

The runner should detect exactly these standalone output lines:

- `RALPH_NEXT`
- `RALPH_DONE`
- `RALPH_BLOCKED`

If more than one appears, `RALPH_BLOCKED` wins.

### Verification

After each Agent-Iteration, the runner compares the selected Loop's
`progress.json` before and after the Agent-Iteration.

V1 should reject:

- missing or invalid outcome keyword
- `RALPH_NEXT` with zero completed tasks
- `RALPH_NEXT` with more than one newly completed task
- `RALPH_NEXT` completing anything other than the selected eligible task
- `RALPH_DONE` while pending tasks remain
- `RALPH_DONE` with newly completed tasks
- `RALPH_BLOCKED` with newly completed tasks
- failed quality gate after `RALPH_NEXT`

During `ralph-loop run`, the runner never marks task progress itself and never
fixes up `progress.json` after Codex exits. Codex owns the Agent-Iteration state
update; the runner only verifies, checkpoints, stashes, retries, or stops.
Future initialization or planning commands may create or rewrite `progress.json`
outside normal runtime.

### Checkpoints

V1 requires Git checkpoints. The work plane must be inside a Git repository.
Before the loop starts, the runner must require a clean worktree. If
`git status --porcelain` reports any change, the runner fails. V1 intentionally
does not provide an `--allow-dirty` bypass.

For each valid `RALPH_NEXT`, the runner creates one commit containing:

- work-plane changes for the completed task
- the updated task status in `.jz-ralph/loops/<loop-name>/progress.json`
- the rewritten `.jz-ralph/loops/<loop-name>/HANDOFF.md`
- any valid `.jz-ralph/KNOWLEDGE.md` additions
- run artifacts only if `commitRunArtifacts` is `true`

By default, `commitRunArtifacts` is `false`. Accepted task checkpoints should
stay focused on durable project and control-plane state. Runtime diagnostics are
not committed by default:

- `.jz-ralph/loops/<loop-name>/runs/<run-id>/RUN_CONTEXT.md`
- stdout and stderr logs
- quality gate logs
- per-Agent-Iteration summaries
- progress before/after snapshots

Default commit message:

```text
ralph: complete <task-id>
```

### Rejection Recovery

V1 preserves rejected Agent-Iteration changes in Git stash instead of discarding
them.

On rejection:

1. The runner captures diagnostics.
2. The runner stashes all changes from the failed Agent-Iteration, including
   untracked files.
3. The runner records the stable stash commit SHA and stash message in the run
   summary.
4. The runner restores the worktree to a clean state before retrying or exiting.

The runner should not rely only on `stash@{0}` because stash indexes move as new
stashes are created or dropped. It should record the stash commit SHA returned by
Git after storing the rejected state.

Recommended stash message:

```text
ralph rejected <run-id> agent-iteration <n> <task-id>
```

Recommended summary fields:

```json
{
  "rejected": true,
  "rejectionReason": "RALPH_NEXT completed multiple tasks",
  "stash": {
    "sha": "<stash-commit-sha>",
    "message": "ralph rejected 2026-06-29T190000Z agent-iteration 3 003-task-id"
  }
}
```

The path to the run summary belongs in
`.jz-ralph/loops/<loop-name>/runs/<run-id>/summary.json`.
The static `.jz-ralph/config.json` should not point at a specific rejection
stash because config is stable project configuration, while stashes are runtime
artifacts.

The runner retries rejected Agent-Iterations automatically up to
`maxRejectedIterations`, defaulting to `3`. Each rejected attempt is stashed and
logged before retrying the same task. After the cap is reached, the runner stops
with a rejection failure and points to the relevant Run summaries and stashes.

### Runtime Artifacts

Recommended v1 logs:

```text
<ralph-dir>/loops/<loop-name>/runs/<run-id>/agent-iterations/<n>/
  stdout.log
  stderr.log
  gate.stdout.log
  gate.stderr.log
  progress.before.json
  progress.after.json
  summary.json
```

## Open V1 Decisions

No open v1 product decisions remain in this document. Remaining work is
implementation, validation, and later distribution decisions.

### Run Resumability

V1 resumes only from durable Loop state files. Previous Run summaries and
artifacts are diagnostic only and do not influence future control flow.

Authoritative state:

```text
.jz-ralph/loops/<loop-name>/progress.json
.jz-ralph/loops/<loop-name>/HANDOFF.md
.jz-ralph/KNOWLEDGE.md
.jz-ralph/loops/<loop-name>/tasks/
```

Diagnostic-only state:

```text
.jz-ralph/loops/<loop-name>/runs/**/*
```

A new `ralph-loop run <loop-name>` reads `progress.json`, computes the first
eligible pending task from task order and dependencies, and continues from
there. It ignores old `runs/*/summary.json` files for control flow.

### Packaging

V1 keeps packaging local and Bun-based until CLI behavior is stable.

`package.json` exposes the CLI through:

```json
{
  "bin": {
    "ralph-loop": "./src/cli.ts"
  }
}
```

Required scripts:

```json
{
  "scripts": {
    "check": "bunx tsc --noEmit",
    "start": "bun run src/cli.ts",
    "test": "bun test"
  }
}
```

Do not bundle or compile a standalone executable in the first implementation
slice. After local behavior works, revisit `bun build --compile`, npm
publishing, GitHub release binaries, and cross-platform install docs.

## Initial Scaffold

The current CLI scaffold supports:

- `ralph-loop help`
- `ralph-loop validate --ralph-dir <path>`
- `ralph-loop docs` as a pending command
- `ralph-loop tasks` as a pending command
- `ralph-loop run --ralph-dir <path>` as a pending command

The first implementation slice should replace the pending command behavior for
`init`, `docs`, `loop create`, `loop list`, `loop status`, and expanded
`validate`. Task normalization and `run` remain intentionally pending until
their planned slices.
