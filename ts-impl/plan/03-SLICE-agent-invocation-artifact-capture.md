# Slice 03: Agent Invocation And Artifact Capture

Status is tracked in [README.md](./README.md).

## Goal

Launch one Codex Agent-Iteration, capture diagnostics, detect the outcome
keyword, and stop before accepting or rejecting work.

## Dependencies

- Slice 02 run foundations.

## Scope

- Build Codex argv from `config.json`.
- Create per-Agent-Iteration artifact directories.
- Capture `stdout.log` and `stderr.log`.
- Capture `progress.before.json` and `progress.after.json`.
- Enforce `agentTimeoutSeconds`.
- Detect standalone outcome lines: `RALPH_NEXT`, `RALPH_DONE`,
  `RALPH_BLOCKED`.

## Out Of Scope

- Progress transition verification.
- Quality gates.
- Checkpoint commits.
- Rejection stash or retry.

## Implementation Notes

- Default invocation starts from `codex exec --sandbox workspace-write`.
- Optional config maps to argv as documented in `IMPLEMENTATION.md`.
- The prompt should stay minimal and point Codex at `RUN_CONTEXT.md`.
- If more than one outcome appears, detection records `RALPH_BLOCKED` as the
  winning outcome for later verification.

## TDD Test Plan

- Codex argv construction covers default and optional config fields.
- Artifact paths are stable and under the correct Agent-Iteration directory.
- Outcome detection ignores embedded/non-standalone keywords.
- Timeout handling records timeout as the Agent-Iteration result.

## Acceptance Checks

```bash
bun test
bun run src/cli.ts run demo
```

## Completion Notes

Status: **VERIFIED.**

- `src/agent.ts` implements the slice:
  - `buildCodexPrompt` / `buildCodexArgv` — build the Codex argv from
    `config.agent`. Default is `exec --sandbox workspace-write "<prompt>"`;
    optional `model`, `reasoningEffort` (`-c model_reasoning_effort="<e>"`),
    `sandbox`, and `profile` map to CLI overrides per `IMPLEMENTATION.md`.
  - `detectOutcome` — recognizes only standalone `RALPH_NEXT` / `RALPH_DONE` /
    `RALPH_BLOCKED` lines (trimmed). Embedded keywords are ignored; if more than
    one distinct keyword appears, `RALPH_BLOCKED` wins.
  - `agentIterationDir` / `agentIterationArtifacts` — stable paths under
    `runs/<run-id>/agent-iterations/<n>/`.
  - `defaultAgentSpawn` — spawns the process in the work plane, captures
    stdout/stderr, enforces `agentTimeoutSeconds` via `SIGKILL`, and records a
    launch failure (e.g. Codex not installed) on stderr instead of throwing.
  - `runAgentIteration` — snapshots `progress.before.json`, launches the agent,
    writes `stdout.log`/`stderr.log` and `progress.after.json`, and detects the
    outcome. A timed-out iteration yields no outcome. The launcher is injectable
    so tests run without a real Codex binary.
- `RalphConfig.agent` widened to `CodexAgentConfig` (`src/commands/run.ts`).
- `src/cli.ts` `run` now launches one Agent-Iteration after setup and reports the
  captured outcome + artifact paths, then stops before verification.
- `src/commands/docs.ts` `run` section status updated.
- 16 Slice 3 tests added. `bun test` 81/81. `bun run check` exit 0.
- Acceptance: `run demo` in a clean Git repo launches a stub `codex`, captures
  artifacts, and detects `RALPH_NEXT`; a missing `codex` is recorded on
  `stderr.log` without crashing (outcome: none, exit 0).
