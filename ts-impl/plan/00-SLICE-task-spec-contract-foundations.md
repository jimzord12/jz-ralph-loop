# Slice 00: Task Spec Contract Foundations

Status is tracked in [README.md](./README.md).

## Goal

Build the independently tested task-contract module that later commands use for
Task Source import, validation, dependency checks, and eligible-task selection.

## Dependencies

None.

## Scope

- Validate task filenames against `^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$`.
- Parse Task Spec Markdown headings.
- Require these headings: `Objective`, `Scope`, `Out Of Scope`, `Blocked By`,
  `Acceptance Criteria`, and `Verification`.
- Treat `Notes` as optional.
- Parse `Blocked By` values as dependency task ids.
- Treat `None` in `Blocked By` as no dependencies.
- Validate dependency references against the imported task set.
- Detect dependency cycles.
- Select the first pending task, in Plan order, whose dependencies are complete.

## Out Of Scope

- CLI command wiring beyond what tests require.
- Copying Task Source files into Loop state.
- Codex invocation.
- Runtime progress mutation.

## Implementation Notes

- Put task-contract logic in a separate module from CLI dispatch.
- Keep `progress.json` as the only authoritative Plan/progress state.
- Do not persist a derived task queue, `implementationTaskList`, or dependency
  graph.
- Return structured validation errors that CLI commands can later print.
- Preserve lexical task order as the stable Plan order.

## TDD Test Plan

- Valid filenames pass; invalid filenames fail.
- Required headings are detected case-sensitively as Markdown `##` sections.
- Missing required headings fail with actionable errors.
- `Blocked By` parses `None`, bullet lists, and multiple task ids.
- Unknown dependencies fail validation.
- Cyclic dependencies fail validation.
- Eligible-task selection skips pending tasks with incomplete dependencies.
- Eligible-task selection returns `undefined` when no pending task is eligible.

## Acceptance Checks

```bash
bun test
bun run check
```

## Completion Notes

Implemented `src/task-spec.ts` (CLI-independent module) with:

- `isValidTaskFilename` / `taskIdFromFilename` (regex `^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$`).
- `parseTaskSpec`: case-sensitive `##` heading detection, required-heading
  validation with actionable errors, optional `Notes`, and `Blocked By` parsing
  (`None`, single/multiple bullets, surrounding backticks stripped).
- `validateTaskDependencies`: unknown-reference checks and DFS cycle detection
  (including self-cycles).
- `selectEligibleTask`: first pending task in Plan order with all dependencies
  complete; returns `undefined` when none eligible.

Tests in `test/task-spec.test.ts` (20 cases) cover the full TDD plan.

Acceptance checks on 2026-06-30: `bun test` → 20 pass / 0 fail; `bun run check`
→ exit 0.

No product-spec gaps surfaced; `IMPLEMENTATION.md` unchanged.
