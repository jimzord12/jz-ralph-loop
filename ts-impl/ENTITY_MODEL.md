# Ralph TypeScript CLI Entity Model

This document defines the concrete product/domain entities for the TypeScript
CLI. `../RALPH_LOOP.md` remains the abstract loop protocol.

## Entity Hierarchy

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

## Installation

An installation is the `.jz-ralph/` directory initialized inside a repository.

It contains repo-wide Ralph configuration, durable agent instructions, durable
project knowledge, and one or more Loops.

```text
.jz-ralph/
  config.json
  AGENTS.md
  KNOWLEDGE.md
  loops/
```

## Loop

A Loop is a durable unit of work created by the CLI, usually tied to one feature,
objective, issue bundle, or planned change.

A Loop is not a single process execution. A Loop can survive multiple Runs.

Example lifecycle:

```text
user designs a feature
-> user or planning agent decomposes it into agent-ready tasks
-> user creates a Loop from those tasks
-> one or more Runs execute the Loop until terminal state
```

Loop state lives under:

```text
.jz-ralph/loops/<loop-name>/
  loop.json
  progress.json
  HANDOFF.md
  tasks/
  runs/
```

## Plan

A Plan is the ordered, agent-ready task set owned by a Loop.

For v1, the Plan is represented by:

- `.jz-ralph/loops/<loop-name>/progress.json`
- `.jz-ralph/loops/<loop-name>/tasks/`

Task decomposition is not the runner's responsibility. The runner expects tasks
to already be agent-ready before the Loop runs.

## Task Source

A Task Source is an external directory or input containing agent-ready task files
before they are imported into a Loop.

The Task Source is not runtime state. The CLI may copy or normalize it into
`.jz-ralph/loops/<loop-name>/tasks/` when creating a Loop.

Task Source files must satisfy the Task Spec contract before import.

## Task

A Task is one executable unit inside a Plan. An Agent-Iteration may complete at
most one Task.

Task specs are Markdown files with required sections for objective, scope,
out-of-scope work, dependency metadata, acceptance criteria, and verification.
The `Blocked By` section declares dependency task ids.

Task specs are immutable during normal runtime. Task status and parsed
dependencies are represented in the Loop's `progress.json` ledger.

The next task selected for an Agent-Iteration is the first pending Task, in Plan
order, whose dependencies are complete.

## Run

A Run is one execution attempt of the runner against a Loop.

A Run starts when the user invokes the runner for a Loop and ends when the Loop
reaches a terminal state for that execution attempt.

Run artifacts belong under:

```text
.jz-ralph/loops/<loop-name>/runs/<run-id>/
```

## Agent-Iteration

An Agent-Iteration is one fresh agent process launched by a Run.

V1 uses Codex as the default agent. Each Agent-Iteration starts cold, reads the
Ralph files, attempts at most one Task, emits one outcome keyword, and exits.

## Checkpoint

A Checkpoint is one Git commit created after an accepted completed Task.

V1 creates one Checkpoint for each valid `RALPH_NEXT`.

## Rejection

A Rejection is a runner decision that an Agent-Iteration violated the protocol
or could not be verified.

Rejected changes are preserved in a Git stash and referenced from Run metadata.

## Blocker

A Blocker is a valid terminal state reported by an agent with `RALPH_BLOCKED`.

Blocked is not rejection. A blocked Agent-Iteration followed the protocol but
cannot continue without human input or an external state change.

## Context Surfaces

Users can provide context through different files depending on scope:

- `.jz-ralph/AGENTS.md`: repo-wide Ralph protocol and behavior rules
- `.jz-ralph/KNOWLEDGE.md`: durable repo/project facts
- `.jz-ralph/loops/<loop-name>/HANDOFF.md`: short-term loop continuity
- `.jz-ralph/loops/<loop-name>/tasks/*.md`: feature/task-specific context

Feature-specific context should usually live in task specs, not in `AGENTS.md`.
