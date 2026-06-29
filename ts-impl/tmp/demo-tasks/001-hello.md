# Add hello greeting

## Objective
Add a `hello` function that returns a greeting string.

## Scope
`src/hello.ts` — a new file with a single exported function.

## Out Of Scope
Any UI or CLI wiring. No tests needed in this task.

## Blocked By
None

## Acceptance Criteria
- `src/hello.ts` exists and exports a `hello` function.
- `hello("world")` returns `"Hello, world!"`.

## Verification
bun run -e "import { hello } from './src/hello.ts'; console.log(hello('world'))"
