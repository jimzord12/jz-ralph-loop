# Ralph Loop Domain Specification

This document defines the Ralph loop as a domain model and protocol. It is not
specific to any operating system, shell, programming language, agent runtime, or
package manager. A developer should be able to implement a compatible Ralph loop
runner in their preferred stack by following this specification.

## Purpose

A Ralph loop is a file-driven automation loop for executing a prepared plan one
task at a time with a fresh agent process for every iteration.

The loop exists to make long-running agentic work:

- stateless across agent invocations
- inspectable by humans
- crash-resumable
- bounded to one task per iteration
- gated by objective verification before progress is recorded
- reversible through one commit or checkpoint per completed task

The key idea is that runtime memory lives in ordinary files, not in a long-lived
conversation or process. Each agent instance starts cold, reads the protocol and
current state from disk, performs exactly one task, writes its result back to
disk, emits a machine-readable outcome keyword, and exits.

## Core Concepts

### Loop

The loop is the orchestrator. It repeatedly launches one fresh agent iteration
until the plan is complete, blocked, rejected too many times, or a configured
iteration cap is reached.

The loop is responsible for:

- locating the control plane
- locating the work plane
- starting an agent iteration with the correct context
- capturing the agent's output
- detecting the outcome keyword
- verifying task progress
- recording run logs and metrics
- deciding whether to continue, stop, or report failure

### Agent Iteration

An agent iteration is one fresh agent invocation. It has no required memory
except the files in the control plane and the current contents of the work
plane.

One iteration must do at most one task. It must not preemptively work on later
tasks.

### Control Plane

The control plane is a directory containing the Ralph loop state and protocol
files. It is the authoritative state store for a Ralph run.

Required files:

- `AGENTS.md`
- `progress.json`
- `HANDOFF.md`
- `KNOWLEDGE.md`
- `tasks/`

Runtime logs may also be written under the control plane, typically in a `runs/`
directory.

### Work Plane

The work plane is the target project being changed. All product code, tests,
documentation, and project-specific files modified by the agent belong here.

The work plane may be the same directory as the control plane, but the domain
model treats them as separate roles. Keeping them separate is recommended so the
tool's own files are not confused with the target project's files.

### Task

A task is one unit of work small enough for a single agent iteration. Tasks are
listed in `progress.json` and specified in detail under `tasks/`.

Tasks are ordered. The first pending task in `progress.json` is the only task
eligible for the next iteration.

### Quality Gate

A quality gate is an implementation-defined verification command, test suite,
checklist, or validation procedure. The important domain rule is that progress
cannot be recorded unless the gate passes.

A runner may support arbitrary project-specific gates. The gate must produce a
clear pass/fail result.

### Checkpoint

A checkpoint is a durable record of a completed task. In a Git-based
implementation, this is usually one commit containing the work-plane changes,
the updated task status, and the rewritten handoff.

The domain requirement is atomicity: a completed task should be revertable or
auditable as one logical unit.

## Required Control Files

### `AGENTS.md`

`AGENTS.md` is the binding instruction contract for each agent iteration.

It must tell the agent:

- it is one iteration of a Ralph loop
- it must do exactly one task
- where the control files live
- how to select the next task
- how to read task context
- how to respect dependencies
- how to run quality gates
- when it may mark progress
- how to rewrite handoff state
- how to emit the final outcome keyword

`AGENTS.md` is read by every fresh agent process. It should be concise,
imperative, and stricter than general project documentation.

### `progress.json`

`progress.json` is the authoritative task ledger. It is status only.

It contains an ordered list of task records. A compatible implementation must be
able to identify task records in this conceptual form:

```json
{
  "tasks": [
    {
      "id": "000-finished-task",
      "status": "complete",
      "spec": "tasks/000-finished-task.md"
    },
    {
      "id": "001-task-id",
      "status": "pending",
      "spec": "tasks/001-task-id.md",
      "dependencies": ["000-finished-task"]
    }
  ]
}
```

Each task record must encode:

- stable task id
- status
- path or reference to the task specification

Each task record may encode:

- phase
- dependencies
- other metadata needed by a runner or planning tool

Allowed task statuses:

- `pending`
- `complete`
- `blocked`

The runner should treat any unknown task status as invalid unless the
implementation explicitly extends the status model.

Rules:

- The first task with status `pending` is the next task.
- Only one task may change from `pending` to `complete` during one successful
  iteration.
- The runner or agent must not delete, reorder, or rewrite unrelated tasks at
  runtime.
- `progress.json` should not contain detailed task requirements. Put those in the
  task spec.

### `HANDOFF.md`

`HANDOFF.md` is transient working memory between iterations.

It is rewritten after every iteration. It is not an append-only history file.

It should contain:

- what was just done
- key decisions made in the most recent iteration
- what the next agent should look at first
- any immediate blocker details if the loop stopped as blocked

Because each agent starts fresh, `HANDOFF.md` is the short-term continuity file.
If a detail remains useful beyond the next iteration, promote it to
`KNOWLEDGE.md`.

### `KNOWLEDGE.md`

`KNOWLEDGE.md` is durable memory.

It is append-only during normal operation. It should stay small and high-signal.

It should contain:

- pitfalls discovered during implementation
- project facts future agents are likely to need
- conventions that prevent repeated mistakes
- non-obvious shortcuts or constraints

It should not become a full work log. Old or noisy entries may be pruned or
consolidated by explicit human maintenance outside a normal iteration.

### `tasks/`

`tasks/` contains immutable task specifications.

Each task spec should include:

- task id
- phase
- dependencies
- estimate or expected size
- goal
- context
- acceptance criteria
- notes or constraints

Task specs should be written so an agent with no prior memory can complete the
task using only:

- the task spec
- the control files
- the current work plane
- the configured quality gate

Task specs are immutable during normal runtime. If the plan is wrong, a human
should update the plan deliberately before rerunning the loop.

## Task Selection

At the start of each iteration, the agent must:

1. Read `progress.json`.
2. Find the first task with status `pending`.
3. If no pending task exists, rewrite `HANDOFF.md` with a final summary, emit
   `RALPH_DONE`, and stop.
4. Read the selected task specification completely.
5. Read `HANDOFF.md` and `KNOWLEDGE.md`.
6. Check the selected task's dependencies.

Dependencies are satisfied only if their corresponding tasks have status
`complete` in `progress.json`. If a dependency is not complete, the agent must write
the reason to `HANDOFF.md`, emit `RALPH_BLOCKED`, and stop.

## Iteration Lifecycle

A complete successful iteration follows this lifecycle:

1. Agent starts fresh.
2. Agent reads the control protocol and state.
3. Agent selects the first pending task.
4. Agent performs only that task in the work plane.
5. Agent runs the configured quality gate.
6. Agent confirms the task acceptance criteria are satisfied.
7. Agent marks only the selected task complete in `progress.json`.
8. Agent rewrites `HANDOFF.md`.
9. Agent creates one atomic checkpoint for the completed task.
10. Agent emits `RALPH_NEXT` on a line by itself.
11. Agent exits.
12. Runner verifies the outcome and decides whether to start another iteration.

If any required condition fails, the agent must not mark the task complete.

## Outcome Keywords

The agent communicates its final outcome by printing exactly one keyword on its
own line.

Required keywords:

```text
RALPH_NEXT
RALPH_DONE
RALPH_BLOCKED
```

Meanings:

- `RALPH_NEXT`: exactly one task was completed and the loop should continue.
- `RALPH_DONE`: no pending tasks remain and the loop should stop
  successfully.
- `RALPH_BLOCKED`: the agent cannot proceed without human input or an external
  state change.

The runner should treat outcome detection as line-anchored. A keyword mentioned
inside prose must not count.

If multiple standalone keywords are present, `RALPH_BLOCKED` should take
priority because it signals that human attention may be needed.

## Runner Verification

The runner should not blindly trust the agent's self-report.

After each iteration, the runner should verify:

- the outcome keyword is valid
- `RALPH_NEXT` completed exactly one task
- `RALPH_DONE` completed no task
- `RALPH_BLOCKED` does not leave progress falsely marked complete
- the quality gate passes for non-blocked progress

If verification fails, the runner should reject the iteration. Rejection should
restore the task ledger to its previous state or otherwise prevent false
progress from being recorded.

The runner may keep logs, checkpoints, or failed commits for forensic purposes,
but the authoritative progress ledger must not claim a rejected task is done.

## Blocking

Blocking is a valid terminal state for a run.

The agent should emit `RALPH_BLOCKED` when:

- required information is missing
- a dependency is not complete
- the task spec is contradictory or impossible
- quality gates fail and the agent has no clear fix
- an external system or credential is required
- continuing would require unsafe guessing

When blocked, the agent must write a concise explanation to `HANDOFF.md`,
including what a human should provide or change.

## Completion

The loop is complete when no pending tasks remain in `progress.json`.

On completion, the final agent iteration should:

- rewrite `HANDOFF.md` with a short final summary
- emit `RALPH_DONE`
- stop without changing task state

The runner should exit successfully.

## Rejection and Retry

A runner may reject an iteration when the outcome and observed state disagree.

Examples:

- The agent emits `RALPH_NEXT` but no task was completed.
- The agent emits `RALPH_NEXT` but multiple tasks were completed.
- The agent emits `RALPH_DONE` while pending tasks remain.
- The quality gate fails after a task was marked complete.
- The agent emits no recognized keyword.

Rejected iterations should not advance the authoritative progress ledger. The
runner may retry until a configured maximum iteration count is reached.

## Invariants

A compatible Ralph loop should preserve these invariants:

- One agent iteration may complete at most one task.
- The first pending task is the only eligible task.
- Task completion requires passing the configured quality gate.
- The progress ledger is the source of truth for task completion.
- `HANDOFF.md` is rewritten, not appended, each iteration.
- `KNOWLEDGE.md` is append-only during normal iteration work.
- Task specs are not edited during normal task execution.
- Runtime memory must be reconstructable from files.
- A successful completed task has one atomic checkpoint.
- The runner must have a bounded stop condition.

## Optional Runtime Artifacts

A runner may create additional artifacts, such as:

- per-iteration logs
- timeline data
- analytics summaries
- token or cost accounting
- before/after snapshots of the progress ledger
- gate output captures

These artifacts are useful, but they are not the core domain state. The required
state is the control file set plus the work plane.

## Minimal Compatible Implementation

A minimal Ralph loop implementation needs to:

1. Accept a control plane path.
2. Accept a work plane path.
3. Accept a quality gate definition.
4. Validate that required control files exist.
5. Start a fresh agent process with:
   - the control plane path
   - the work plane as its current target
   - the quality gate instructions
6. Capture the agent output.
7. Detect the outcome keyword.
8. Compare `progress.json` before and after the iteration.
9. Run or verify the quality gate.
10. Continue on valid `RALPH_NEXT`.
11. Stop successfully on valid `RALPH_DONE`.
12. Stop with human-actionable details on `RALPH_BLOCKED`.
13. Reject invalid progress.
14. Stop after a maximum iteration count.

Everything else is implementation detail.

## Human Workflow

Before running a Ralph loop, a human or planning agent should:

1. Define the target project.
2. Decompose the desired work into ordered tasks.
3. Write one task spec per task.
4. Register those tasks in `progress.json`.
5. Set the quality gate.
6. Start the runner.

During execution, humans inspect:

- `progress.json` for status
- `HANDOFF.md` for immediate context
- `KNOWLEDGE.md` for durable lessons
- run logs or analytics for diagnostics

After execution, humans review the checkpoints and final state of the work
plane.

## Naming

"Ralph loop" refers to the domain protocol described here, not a specific
implementation.

This repository may provide one implementation of the protocol. Other
implementations may use different languages, process managers, storage APIs, or
agent runtimes as long as they preserve the required control files, lifecycle,
keywords, and invariants.
