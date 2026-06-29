# Ralph Loop Glossary

This glossary defines implementation terms for the TypeScript CLI. The domain
spec in `../RALPH_LOOP.md` remains authoritative.

## Installation

An installation is the `.jz-ralph/` directory initialized inside a repository.

It contains repo-wide configuration, repo-wide agent instructions, durable
knowledge, and one or more Loops.

## Runner

The runner is the agent-less orchestrator script that runs the Ralph loop.

It does not perform task implementation work itself. Instead, it:

- validates the control plane and configuration
- starts one fresh agent process per Agent-Iteration
- captures agent output
- detects the final Ralph outcome keyword
- verifies progress against the protocol
- runs or verifies the quality gate
- creates successful checkpoints
- preserves rejected work for inspection
- decides whether to continue, stop, retry, or fail

In this implementation, the runner is the Bun TypeScript CLI exposed as
`ralph-loop`.

## Loop

A Loop is a durable unit of work, usually tied to one feature, objective, issue
bundle, or planned change.

A Loop owns one Plan and records many Runs.

## Plan

A Plan is the ordered, agent-ready task set owned by a Loop.

For v1, the Plan is represented by a Loop-scoped `progress.json` and `tasks/`
directory.

## Task Source

A Task Source is an external directory or input containing agent-ready task specs
before they are imported into a Loop.

Task decomposition happens before runtime. The runner expects a Loop's Plan to
already be agent-ready.

## Task Spec

A Task Spec is one Markdown task file in a Task Source or Loop `tasks/`
directory.

V1 Task Specs must satisfy the Ralph task contract: required sections describe
the objective, scope, out-of-scope work, dependencies, acceptance criteria, and
verification. The `Blocked By` section declares dependency task ids.

`loop create` imports only contract-compliant Task Specs.

## Run

A Run is one execution attempt of the runner against a Loop.

A single Loop may have multiple Runs, for example when one Run blocks and a later
Run resumes after human input.

## Agent

The agent is the process launched by the runner to perform one Ralph
Agent-Iteration.

V1 is Codex-first, so the default agent is `codex exec --sandbox
workspace-write`. The agent reads the `.jz-ralph/` control files, completes at
most one task, updates state files when valid, emits one outcome keyword, and
exits.

## Agent-Iteration

An Agent-Iteration is one fresh agent invocation controlled by the runner.

Each Agent-Iteration may complete at most one task.

The selected task is the first pending task, in Plan order, whose dependencies
are complete.

## Control Plane

The control plane is the `.jz-ralph/` directory plus the selected Loop directory
under `.jz-ralph/loops/<loop-name>/`.

## Work Plane

The work plane is the project tree the agent changes while completing tasks.

For v1, the work plane must be inside a Git repository and must be clean before
the runner starts.

## Quality Gate

The quality gate is the configured verification command that must pass before a
task can be accepted as complete.

## Checkpoint

A checkpoint is the Git commit created by the runner after a valid completed
task.

V1 creates one checkpoint per accepted `RALPH_NEXT`.

## Rejection

A rejection is a runner decision that an Agent-Iteration cannot be accepted
because the outcome keyword, progress ledger, quality gate, or observed file
changes violate the Ralph protocol.

Rejected work is preserved in a Git stash and recorded in run metadata.

## Blocked

Blocked is a valid agent outcome. It means the agent cannot proceed without
human input or an external state change.

Blocked is not the same as rejection. A blocked Agent-Iteration followed the
protocol; a rejected Agent-Iteration did not.
