# Slice 08: Final Validation, Docs, And Hardening

Status is tracked in [README.md](./README.md).

## Goal

Finish validation coverage, built-in docs, exit-code consistency, and final
review so v1 behavior is internally coherent.

## Dependencies

- Slice 07 multi-task run completion.

## Scope

- Complete `validate` coverage for config, Loop metadata, progress ledger, task
  spec paths, task statuses, and required files/directories.
- Complete built-in docs sections, including `status-codes`, `exit-codes`,
  `examples simple`, and `examples advanced`.
- Normalize docs paths such as `examples simple` and `examples/simple`.
- Ensure stable exit codes for all command families.
- Run the required implementation review.
- Run full checks.

## Out Of Scope

- New v1 product decisions.
- Packaging changes such as standalone binaries, npm publishing, or GitHub
  release assets.

## Implementation Notes

- Reconcile `IMPLEMENTATION.md`, `GLOSSARY.md`, `ENTITY_MODEL.md`,
  `src/cli.ts`, and `tmp/HANDOFF.md`.
- Remove stale `loop id`, `<loop-id>`, `--id`, and `maxIterations: 20` product
  references if any appear outside review checklist text.
- Verify docs references for `RUN_CONTEXT.md`, `commitRunArtifacts`, Codex-only
  v1, file-only resumability, task-source, task-spec, and tasks-normalize.

## TDD Test Plan

- Usage errors return config/usage exit code.
- Validation errors return validation exit code.
- Docs aliases resolve correctly.
- Docs nested paths resolve correctly.
- `validate` catches malformed config, Loop metadata, progress ledger, task
  specs, and missing files.

## Acceptance Checks

```bash
bun test
bun run check
bun run src/cli.ts docs status-codes
bun run src/cli.ts docs exit-codes
bun run src/cli.ts docs examples/simple
bun run src/cli.ts validate demo
```

## Completion Notes

Pending.
