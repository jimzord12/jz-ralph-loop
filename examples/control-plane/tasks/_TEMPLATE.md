---
id: 0NN
phase: <Phase name>
depends_on: []          # task ids that must be checked before this one
estimate: ~45min        # rough size: 30 min – 2 h for a junior/mid dev
---
# Task: <imperative title>

## Goal
<one sentence — the precise meaning of "done">

## Context
- relevant files / modules / docs (paths or links)
- anything an agent with no prior memory needs to orient itself

## Acceptance criteria
- [ ] <testable, unambiguous condition>
- [ ] <…>

## Notes
- pitfalls, constraints, design decisions
- TDD applies? if yes, write the failing test first, then implement
- keep this task self-contained: a single agent should be able to finish it
  in one iteration without hand-holding
