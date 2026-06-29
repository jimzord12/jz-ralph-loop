const DOCS_INDEX = `ralph-loop docs

Available sections:

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
  ralph-loop docs status-codes      (also: exit-codes)
  ralph-loop docs troubleshooting
  ralph-loop docs examples
  ralph-loop docs examples simple
  ralph-loop docs examples advanced
`;

const SECTIONS: Record<string, string> = {
  overview: `ralph-loop — Overview

A Bun-powered CLI that runs a "Ralph loop" against a project: it repeatedly
launches a fresh coding agent (Codex in v1), verifies the agent's work against
a protocol, commits accepted work, stashes rejected work, and decides whether to
continue, block, or stop.

Key concepts:

  Loop            Durable unit of work tied to one feature or objective.
  Plan            Ordered, agent-ready task set owned by a Loop.
  Task            One executable unit inside a Plan.
  Run             One execution of the runner against a Loop.
  Agent-Iteration One fresh agent process per Run iteration.
  Checkpoint      Git commit created after an accepted completed task.
  Rejection       Runner decision that an Agent-Iteration violated the protocol.

Control plane:  .jz-ralph/
Work plane:     . (configurable via workPlane in config.json)
Agent (v1):     codex exec --sandbox workspace-write
`,

  commands: `ralph-loop — Commands

  ralph-loop init
    Initialize a Ralph installation in the current directory.

  ralph-loop loop create --name <loop-name> --from <task-source-dir>
    Create a new Loop from a directory of Task Specs.

  ralph-loop loop list
    List all Loops in the installation.

  ralph-loop loop status <loop-name>
    Show task progress for a Loop.

  ralph-loop tasks normalize --from <task-source-dir> --to <normalized-dir>
    Normalize raw task files into contract-compliant Task Specs (requires Codex).

  ralph-loop run <loop-name> [--ralph-dir <path>]
    Run the Ralph loop for the named Loop.

  ralph-loop validate [<loop-name>] [--ralph-dir <path>]
    Validate the installation and optionally a specific Loop.

  ralph-loop docs [<section>]
    Show built-in documentation.

  ralph-loop help
    Show usage summary.
`,

  config: `ralph-loop — config.json

Location: .jz-ralph/config.json

Shape:

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

Fields:

  workPlane               Directory the agent operates in (default: ".")
  qualityGate             Command run to verify work after RALPH_NEXT
  agent.kind              Agent type; v1 only supports "codex"
  agent.model             Codex model override (null = Codex default)
  agent.reasoningEffort   Codex reasoning effort override (null = default)
  agent.sandbox           Codex sandbox mode (default: "workspace-write")
  agent.profile           Codex profile override
  agent.requiredSkills    Skills the agent must use; absence triggers RALPH_BLOCKED
  maxRejectedIterations   Max rejected Agent-Iterations per Run (default: 3)
  agentTimeoutSeconds     Per-iteration timeout in seconds (default: 1800)
  qualityGateTimeoutSeconds  Quality gate timeout in seconds (default: 600)
  commitRunArtifacts      Commit run diagnostics alongside task checkpoints (default: false)
`,

  init: `ralph-loop init

Initializes a Ralph installation in the current directory.

Creates:

  .jz-ralph/
    config.json    Default runner and agent configuration
    AGENTS.md      Ralph protocol instructions for the agent
    KNOWLEDGE.md   Placeholder for durable project knowledge
    loops/         Empty directory for future Loops

Rules:

  - Hard fails if .jz-ralph/ already exists.
  - Hard fails if the current directory is not inside a Git repository.
  - Does NOT require a clean worktree (only "run" does).

After init, use:

  ralph-loop docs
  ralph-loop loop create --name <loop-name> --from <task-source-dir>
  ralph-loop run <loop-name>
`,

  "loop-create": `ralph-loop loop create --name <loop-name> --from <task-source-dir>

Creates a new Loop from a directory of Task Spec files.

What it does:

  1. Validates all Task Spec files in <task-source-dir> against the contract.
  2. Sorts task files lexically to define Plan order.
  3. Copies task files into .jz-ralph/loops/<loop-name>/tasks/
  4. Generates progress.json with each task marked "pending".
  5. Generates loop.json with loop metadata.
  6. Generates a default HANDOFF.md.
  7. Creates an empty runs/ directory.

Hard fails if:

  - The loop name already exists.
  - <task-source-dir> does not exist or is not a directory.
  - A task file has an invalid filename.
  - A task file is missing a required heading.
  - A task references an unknown dependency.
  - Task dependencies contain a cycle.

Task filename pattern:  ^[a-zA-Z0-9][a-zA-Z0-9._-]*\\.md$

See also: ralph-loop docs task-spec
`,

  "loop-status": `ralph-loop loop status <loop-name>

Shows task progress for a named Loop.

Output includes:

  - Total task count
  - Counts by status: pending, complete, blocked
  - The currently eligible task (first pending task with satisfied dependencies)

A task is eligible when it is pending and all its dependencies are complete.
`,

  "task-source": `ralph-loop — Task Source

A Task Source is an external directory containing agent-ready Task Spec files
before they are imported into a Loop.

Rules:

  - All files must match the filename pattern: ^[a-zA-Z0-9][a-zA-Z0-9._-]*\\.md$
  - Each file must satisfy the Task Spec contract (see: ralph-loop docs task-spec).
  - Files are sorted lexically to define Plan order.
  - task-source is the input to "loop create --from <task-source-dir>".

The runner copies (never moves) task files into the Loop directory.
`,

  "task-spec": `ralph-loop — Task Spec

Each Task Spec is a Markdown file with required sections.

Required headings (## level, case-sensitive):

  ## Objective
  ## Scope
  ## Out Of Scope
  ## Blocked By
  ## Acceptance Criteria
  ## Verification

Optional:

  ## Notes

The "Blocked By" section declares dependency task ids:

  ## Blocked By
  - 001-setup-task
  - 002-config-task

  Use "None" when the task has no dependencies:

  ## Blocked By
  None

Task ids are derived from filenames by stripping the .md extension.
Example: "001-setup.md" -> task id "001-setup".
`,

  "tasks-normalize": `ralph-loop tasks normalize --from <dir> --to <dir>

Rewrites raw task notes or objectives into contract-compliant Task Specs using
Codex. Outputs normalized files to <to>, leaving the original <from> unchanged.

Use this when you have rough task descriptions that don't yet satisfy the Task
Spec contract. After normalization, inspect the output, then import with:

  ralph-loop loop create --name <loop-name> --from <normalized-dir>

Note: This command requires Codex to be available. It is NOT invoked implicitly
by "loop create". Task decomposition and normalization are caller responsibilities.

Status: pending (Slice 1 scope is non-agent commands only).
`,

  run: `ralph-loop run <loop-name> [--ralph-dir <path>]

Runs the Ralph loop for the named Loop against the configured work plane.

What it does per Agent-Iteration:

  1. Selects the next eligible task from progress.json.
  2. Writes RUN_CONTEXT.md with loop, run, and task binding.
  3. Launches: codex exec --sandbox workspace-write
  4. Detects the outcome keyword (RALPH_NEXT / RALPH_DONE / RALPH_BLOCKED).
  5. Verifies protocol compliance and progress.json update.
  6. On success: runs quality gate, creates a Git checkpoint commit.
  7. On rejection: stashes changes, records diagnostics, retries or stops.

Requires:

  - A valid Ralph installation (.jz-ralph/ or --ralph-dir path).
  - A named Loop with at least one pending task.
  - A clean Git worktree in the work plane (hard fail, no bypass).

Status: pending (Slice 2+).
`,

  validate: `ralph-loop validate [<loop-name>] [--ralph-dir <path>]

Validates the Ralph installation and optionally a specific Loop.

Without a loop name:

  Checks that .jz-ralph/ (or --ralph-dir) has:
    config.json, AGENTS.md, KNOWLEDGE.md, loops/
  Also validates config.json structure.

With a loop name:

  Also checks that .jz-ralph/loops/<loop-name>/ has:
    loop.json, progress.json, HANDOFF.md, tasks/
  Also validates progress.json structure and each task file.

Exit codes:
  0  valid
  3  validation error
`,

  protocol: `ralph-loop — Protocol

The runner detects exactly these outcome keywords as standalone output lines:

  RALPH_NEXT     Task complete. Runner should continue to the next task.
  RALPH_DONE     All tasks are complete. Runner should stop successfully.
  RALPH_BLOCKED  Cannot proceed. Requires human input or external change.

If more than one keyword appears, RALPH_BLOCKED takes precedence.

Verification rules (applied after each Agent-Iteration):

  RALPH_NEXT is rejected if:
    - Zero tasks were newly completed.
    - More than one task was newly completed.
    - A task other than the selected eligible task was completed.
    - The quality gate fails.

  RALPH_DONE is rejected if:
    - Pending tasks still remain in progress.json.
    - Any tasks were newly completed.

  RALPH_BLOCKED is rejected if:
    - Any tasks were newly completed.

Rejected iterations are stashed and retried up to maxRejectedIterations.
`,

  "progress-ledger": `ralph-loop — Progress Ledger

Location: .jz-ralph/loops/<loop-name>/progress.json

The authoritative task ledger for a Loop. The runner never persists a derived
task queue. Task order and dependency satisfaction are computed on demand.

Shape:

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

Allowed status values: "pending", "complete", "blocked"

The eligible task is the first "pending" task, in stable Plan order, whose
dependencies are all "complete".

The agent updates progress.json during an Agent-Iteration. The runner only
verifies the update — it never writes task progress itself during "run".
`,

  "run-context": `ralph-loop — RUN_CONTEXT.md

Location: .jz-ralph/loops/<loop-name>/runs/<run-id>/RUN_CONTEXT.md

Runner-generated file created at Run start and regenerated before each
Agent-Iteration. The agent reads it but must not edit it.

Contents:

  - Loop name and Run id
  - Ralph directory and work plane
  - Current Agent-Iteration number
  - Selected eligible task (id and spec path)
  - Rejected attempt count for the Run
  - Configured rejection and iteration caps
  - Required control-plane file paths
  - Required outcome keyword rules
  - Progress update rules
  - Relevant artifact paths

The Codex prompt is minimal:

  Read .jz-ralph/loops/<loop-name>/runs/<run-id>/RUN_CONTEXT.md and follow it exactly.

By default, RUN_CONTEXT.md is not committed (commitRunArtifacts: false).
`,

  checkpoints: `ralph-loop — Checkpoints

A checkpoint is a Git commit created by the runner after each valid RALPH_NEXT.

Default commit message:

  ralph: complete <task-id>

Each checkpoint includes:

  - Work-plane changes from the completed task
  - Updated .jz-ralph/loops/<loop-name>/progress.json
  - Rewritten .jz-ralph/loops/<loop-name>/HANDOFF.md
  - Any valid .jz-ralph/KNOWLEDGE.md additions
  - Run artifacts only if commitRunArtifacts is true

Requirements:

  - The work plane must be inside a Git repository.
  - The worktree must be clean before "run" starts (hard fail, no bypass).
`,

  rejections: `ralph-loop — Rejection Recovery

When an Agent-Iteration is rejected, the runner:

  1. Captures diagnostics (stdout, stderr, progress snapshots).
  2. Stashes all changes (including untracked files) with git stash.
  3. Records the stable stash commit SHA and message in the run summary.
  4. Restores the worktree to a clean state.
  5. Retries the same task (up to maxRejectedIterations times).

Stash message format:
  ralph rejected <run-id> agent-iteration <n> <task-id>

After maxRejectedIterations rejections, the runner stops with exit code 5
and points to the relevant run summaries and stash SHAs.

Stash SHAs are recorded in:
  .jz-ralph/loops/<loop-name>/runs/<run-id>/agent-iterations/<n>/summary.json
`,

  artifacts: `ralph-loop — Run Artifacts

Per-Agent-Iteration artifacts:

  .jz-ralph/loops/<loop-name>/runs/<run-id>/agent-iterations/<n>/
    stdout.log               Agent stdout
    stderr.log               Agent stderr
    gate.stdout.log          Quality gate stdout
    gate.stderr.log          Quality gate stderr
    progress.before.json     progress.json snapshot before the iteration
    progress.after.json      progress.json snapshot after the iteration
    summary.json             Iteration summary (outcome, rejection info, stash SHA)

These are diagnostic-only. They are not committed by default (commitRunArtifacts: false).
`,

  "status-codes": `ralph-loop — Status / Exit Codes

  0   done / success
  1   unexpected runner error
  2   config or usage error
  3   validation error
  4   blocked (agent emitted RALPH_BLOCKED)
  5   rejection cap reached (too many failed Agent-Iterations)
  6   timeout (Run stopped due to final timeout)
  7   quality gate failed

Note on timeouts (exit code 6): timed-out Agent-Iterations are treated as
rejections and contribute to the maxRejectedIterations count. Exit code 6
is only the final process exit when a Run stops because of timeout. If a
timed-out iteration is stashed and a later retry succeeds, exit code is 0.
`,

  troubleshooting: `ralph-loop — Troubleshooting

"Not inside a Git repository"
  Run "git init" in the project root before "ralph-loop init".

"Ralph installation already exists"
  .jz-ralph/ already exists. Remove it or use --ralph-dir to point at a
  different location.

"Dirty worktree"
  Run "git status" to inspect changes. Commit, stash, or discard before
  running "ralph-loop run".

"Missing required heading"
  Each Task Spec must have all required ## headings. See:
  ralph-loop docs task-spec

"Dependency cycle detected"
  Two or more tasks depend on each other (directly or transitively). Fix the
  "Blocked By" sections so the graph is acyclic.

"Unknown dependency"
  A task references an id that does not correspond to any file in the task set.
  Check the "Blocked By" section and ensure the id matches a .md filename
  (without the .md extension).

Validation failures
  Run "ralph-loop validate <loop-name>" for a full structural check before
  starting a Run.
`,

  examples: `ralph-loop docs examples

Sub-sections:

  ralph-loop docs examples simple
  ralph-loop docs examples advanced
`,

  "examples/simple": `ralph-loop — Simple Example

Initialize Ralph, create a Loop, and run it using all defaults.

  # 1. In your project root (must be a git repo)
  ralph-loop init

  # 2. Create a directory with your Task Specs
  mkdir my-tasks
  # (add .md files with required headings — see: ralph-loop docs task-spec)

  # 3. Create a Loop
  ralph-loop loop create --name my-feature --from ./my-tasks

  # 4. Validate the Loop
  ralph-loop validate my-feature

  # 5. Run the loop
  ralph-loop run my-feature
`,

  "examples/advanced": `ralph-loop — Advanced Example

Using non-default ralph-dir, custom agent settings, and a multi-step workflow.

  # 1. Init into a custom control-plane directory
  ralph-loop init --ralph-dir .jz-ralph-staging

  # 2. Edit .jz-ralph-staging/config.json to customize agent settings:
  #    "agent": { "model": "o4-mini", "reasoningEffort": "high", "profile": "my-profile" }
  #    "maxRejectedIterations": 5
  #    "agentTimeoutSeconds": 3600

  # 3. Normalize raw task notes (requires Codex)
  ralph-loop tasks normalize --from ./raw-notes --to ./normalized-tasks

  # 4. Inspect and edit normalized tasks, then create the Loop
  ralph-loop loop create --name auth-refresh --from ./normalized-tasks

  # 5. Validate before running
  ralph-loop validate auth-refresh --ralph-dir .jz-ralph-staging

  # 6. Check loop status
  ralph-loop loop status auth-refresh --ralph-dir .jz-ralph-staging

  # 7. Run
  ralph-loop run auth-refresh --ralph-dir .jz-ralph-staging

  # 8. After run, inspect stash if there were rejections
  git stash list
  ralph-loop loop status auth-refresh --ralph-dir .jz-ralph-staging
`,
};

// "exit-codes" is a stable alias for "status-codes"
SECTIONS["exit-codes"] = SECTIONS["status-codes"] as string;

export function getDocs(parts: string[]): string | undefined {
  if (parts.length === 0) return DOCS_INDEX;
  // Normalize: split any slash-joined tokens ("examples/simple" -> ["examples","simple"])
  const tokens = parts.flatMap((p) => p.split("/"));
  const key = tokens.join("/");
  return SECTIONS[key];
}
