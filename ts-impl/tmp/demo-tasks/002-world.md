# Add world variant

## Objective
Add a `greetWorld` function that calls `hello("world")` and prints the result.

## Scope
`src/world.ts` — a new file importing from `src/hello.ts`.

## Out Of Scope
Any changes to `src/hello.ts` itself.

## Blocked By
- 001-hello

## Acceptance Criteria
- `src/world.ts` exports a `greetWorld` function.
- Calling `greetWorld()` logs the greeting.

## Verification
bun run -e "import { greetWorld } from './src/world.ts'; greetWorld()"
