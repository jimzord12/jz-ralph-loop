# Ralph Agent — Per-Iteration Protocol

> You are ONE iteration of an automated loop (a "Ralph loop"). Do exactly ONE
> task, then stop. Another fresh instance continues after you. You have no
> memory of previous iterations except what is written in the files below.

## Paths
- **CONTROL_DIR** = the directory that contains this file. Its absolute path was
  given in your startup prompt. All control files live here:
  - `CONTROL_DIR/PROCESS.md` — status: a checklist of tasks grouped by phase.
  - `CONTROL_DIR/HANDOFF.md` — transient in-flight notes from the previous agent.
  - `CONTROL_DIR/KNOWLEDGE.md` — durable, append-only pitfall ledger.
  - `CONTROL_DIR/tasks/0NN-<slug>.md` — immutable task specs.
- **Work target** = your current working directory (the project). Make your code
  changes here. Reference control files by their absolute `CONTROL_DIR/...` path.

## Step-by-step (do these in order)
1. Read `CONTROL_DIR/PROCESS.md`. Find the FIRST unchecked box: a line like
   `- [ ] 0NN-<slug> → tasks/0NN-<slug>.md`.
   - If there is NO unchecked box → everything is done. Rewrite
     `CONTROL_DIR/HANDOFF.md` with a short final summary, then print exactly
     `RALPH_DONE` (on its own line) and stop.
2. Read that task's spec (`CONTROL_DIR/tasks/0NN-<slug>.md`) completely.
3. Read `CONTROL_DIR/HANDOFF.md` and `CONTROL_DIR/KNOWLEDGE.md` for context.
4. Implement the task. Rules:
   - Keep changes scoped to THIS one task. Do not start other tasks.
   - Follow TDD where the task's acceptance criteria imply tests.
   - Respect `depends_on`: if a dependency is still unchecked, STOP — write the
     reason in `CONTROL_DIR/HANDOFF.md`, print `RALPH_BLOCKED`, and stop.
   - If you discover a pitfall or fact worth remembering, APPEND one short line
     to `CONTROL_DIR/KNOWLEDGE.md` (keep that file small and high-signal).
   - If you are BLOCKED (missing info, genuinely ambiguous, failing with no path
     forward) → write what you need in `CONTROL_DIR/HANDOFF.md`, print exactly
     `RALPH_BLOCKED`, and stop. Do not loop forever on a failing task.
5. Run the quality gates — GREEN is required to finalize the task:
   - Run the project's gates. The exact command was given in your startup prompt
     (e.g. `npm test && npm run typecheck`, `cargo test`, `pytest -q`). If no
     command was provided, run whatever this project uses to verify a clean
     change (tests + typecheck/lint as applicable).
   - Re-check the task's acceptance criteria against the result.
   - ALL GREEN → continue to step 6.
   - RED → you may NOT flip the box or commit. Try to fix it within this
     iteration. If you cannot, write the failing gate + the error in
     `CONTROL_DIR/HANDOFF.md`, print `RALPH_BLOCKED`, and stop. Never commit
     red; never flip a box whose gates are red.
6. Finalize the task (only if gates are green):
   - Check the box for THIS task only in `CONTROL_DIR/PROCESS.md`: `- [ ]` →
     `- [x]`. Do not touch any other box.
   - REWRITE (do not append) `CONTROL_DIR/HANDOFF.md` with: what you just did,
     key decisions made, and what the next agent should do first. Keep it short.
   - Commit-on-green: `git add -A && git commit` using the message format below.
     This makes one atomic "task done" commit (code + box flip + handoff), so
     each task is a clean, revertable checkpoint. If nothing is staged (a
     no-code task), use `git commit --allow-empty` so the box flip is still
     recorded.
7. Print exactly `RALPH_NEXT` (on its own line) and stop.

## Keyword contract (print the keyword alone on its own line)
- `RALPH_NEXT` — finished one task; loop should continue.
- `RALPH_DONE` — no tasks remain; loop should stop (success).
- `RALPH_BLOCKED` — cannot proceed; loop should stop and alert a human.

## Hard rules
- One task per run. Never check more than one box.
- Never delete or reorder tasks in `PROCESS.md`; only flip your own box.
- `HANDOFF.md` is rewritten each run; `KNOWLEDGE.md` is append-only.
- If something keeps failing, emit `RALPH_BLOCKED` — do not flail.
- Never flip a box or commit while the quality gates are red — fix it or emit `RALPH_BLOCKED`.
- Commit exactly once per task, immediately after flipping its box (commit-on-green).

## Commit message format (commit-on-green)
One commit per completed task. First line: `<id>-<slug>: <task title>` — e.g.
`001-git-clone: Implement git.clone in the git adapter`. Optional blank line +
1–3 line body (what changed; the gate result). The `<id>-<slug>` prefix keeps
history greppable and maps 1:1 to `PROCESS.md`. The commit is atomic — it
includes the code, the `PROCESS.md` box flip, and the rewritten `HANDOFF.md` —
so `git revert <commit>` cleanly undoes one task.
