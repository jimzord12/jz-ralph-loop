# Feature Delivery Pipeline

A 7-step pipeline from a feature idea (or a roadmap milestone) to a verified feature. Each step produces a named artifact that the next step consumes. Every feature's artifacts live in one directory: `.scratch/features/<id>-<slug>/`. Step 4 runs in two passes — `to-issues` (4a, the slice shape) then `decompose-issues` (4b, a depth pass that scores each slice and splits any scoring ≥4 into ≤3-complexity leaves before `do-issue` dispatches them).

`features-cli` is the single source of truth for pipeline state: it tracks the active feature, registers features, manages issue state and blockers, and reports project state. Skills read the active feature via `npx tsx .agents/workflows/features-cli/bin.ts get-feature` and must never hand-edit the status JSON.

**Bootstrap:** run `npx tsx .agents/workflows/features-cli/bin.ts init` once to scaffold `.scratch/features-status.json`. Features are created with `create-feature <slug>` (which allocates the ID and creates the feature directory) — this is the only supported way to register a feature.

## Pipeline

| Step | Skill                                    | Produces                                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                   | Lives at                                                 |
| ---- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1    | `new-feature` (or `milestone-to-briefs`) | **Feature brief** — a mini-PRD (scope, acceptance criteria, in/out of scope); the feature registered in `features-status.json` via `create-feature`                                            | `new-feature` turns one feature description into a registered brief, grounding it in a codebase audit — the normal entry for an established repo with no roadmap. `milestone-to-briefs` instead decomposes a whole `ROADMAP.md` milestone into many features at once. | `.scratch/features/<id>-<slug>/BRIEF.md`                 |
| 2    | `grill-with-docs`                        | **Grilling session state** — decision tree (N1–Nn nodes), constraints, open leaves; plus inline `CONTEXT.md`/ADR updates                                                                       | Stress-tests the brief against the domain model. Machine-readable checkpoint a new session resumes from without prior context                                                                                                                                         | `.scratch/features/<id>-<slug>/GRILL_SESSION.md`         |
| 3    | `to-prd`                                 | **PRD (HLD)** — problem statement, user stories, implementation and testing decisions, out-of-scope, plus a **feature registry** mapping to features                                           | Distills the resolved grilling session into the source of truth for _what_ we build and _why_. Keeps conclusions, drops Q&A                                                                                                                                           | `.scratch/features/<id>-<slug>/PRD.md`                   |
| 4    | `to-issues`                              | **Vertical-slice issues** — each a slice through every layer (UI → logic → data), with acceptance criteria, complexity, blocked-by, HITL/AFK label                                             | Independently grabbable work units. The CLI regenerates `issues-status.json` from these files                                                                                                                                                                         | `.scratch/features/<id>-<slug>/issues/<NN>-<slug>.md`    |
| 4b   | `decompose-issues`                       | **Dispatchable leaf issues** — each slice scored on a 7-dimension rubric (≤3 ceiling); ≥4 slices split recursively; every leaf carries concrete context pointers + inlined interface contracts; every finalized issue stamped `Decomposed: <date>` | Deepens 4a's slices so each is autonomously dispatchable to one subagent with bounded context — `do-issue` hands a leaf that never explores beyond its listed pointers. 4b mutates 4a's files in place, so the `Decomposed:` stamp is what distinguishes a decomposed slice from a raw one | `.scratch/features/<id>-<slug>/issues/<NN>-<slug>.md`    |
| 5    | `do-issue`                               | **Implemented code** — production code, tests, type definitions                                                                                                                                | The deliverable. Each issue's acceptance criteria are verifiable                                                                                                                                                                                                      | `src/`, `scripts/`, test files                           |
| 6    | `review-feature`                         | **Feature review report** — pass/fail per acceptance criterion, QA results, orphan detection, downstream impact                                                                                | Automated gate between implementation and sign-off. Catches integration gaps, dead code, and scope misses                                                                                                                                                             | `.scratch/features/<id>-<slug>/reviews/<NN>-review.md`   |
| 7    | _(manual)_                               | **Human sign-off** — approval or required changes; feature transitioned to `archived` + `finalStatus: done` via the CLI                                                                        | Final authority. The human verifies the _experience_, not the plumbing                                                                                                                                                                                                | `features-status.json` (via `... bin.ts update-feature`) |

## Stage inputs (Consumes)

Every stage declares exactly what it reads, so a fresh session can resume a step without guessing. (Kept as its own table rather than a sixth column on the pipeline table, which is already paragraph-wide.) The granularity matters: 4b is **feature-scoped** (it must see the whole slice set to rewire the blocker graph and renumber on split), while 5 is **single-issue** (one locked leaf, nothing else) — don't conflate the two.

| Step | Skill                | Consumes                                                                                              |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| 1    | `new-feature` / `milestone-to-briefs` | a feature description — or a `ROADMAP.md` milestone (`milestone-to-briefs`)                  |
| 2    | `grill-with-docs`    | `BRIEF.md` + the domain model (`CONTEXT.md`, ADRs)                                                    |
| 3    | `to-prd`             | `GRILL_SESSION.md`                                                                                    |
| 4a   | `to-issues`          | `PRD.md`                                                                                              |
| 4b   | `decompose-issues`   | the feature's **entire** `issues/*.md` set + `PRD.md` (codebase scanned, not dumped, for pointers)   |
| 5    | `do-issue`           | a **single** leaf issue + only its inlined Context Pointers — never the sibling issues                |
| 6    | `review-feature`     | `BRIEF.md` acceptance criteria + the implemented code + the feature's issues                          |
| 7    | _(manual)_           | the feature review report                                                                            |

## Naming conventions

- **Feature directories**: `.scratch/features/<id>-<slug>/` — `<id>` is the 3-digit zero-padded feature ID; holds the brief, grilling session, PRD, issues, and reviews
- **Briefs**: `BRIEF.md`
- **Grilling session state**: `GRILL_SESSION.md` (per-branch responses, when used, go in `grill-responses/N<N>-response.md`)
- **PRD**: `PRD.md`
- **Issues**: `issues/<NN>-<slug>.md` — `<NN>` is the zero-padded sequential index and the issue ID; the CLI derives `issues-status.json` from these
- **Feature review reports**: `reviews/<NN>-review.md` — auto-incrementing (01, 02, …)
- **ADRs**: `docs/adr/<NNNN>-<topic>.md` — numbered, auto-incrementing
- **CONTEXT.md**: repo-root glossary, updated inline during grilling

## Lifecycle and flow

- All `.scratch/features/` artifacts are archival once the feature ships and is verified; `CONTEXT.md` and ADRs are permanent and accumulate across features.
- Steps 2–7 run once per feature. After sign-off, pick the next feature from the registry (`npx tsx .agents/workflows/features-cli/bin.ts get-feature` / `status` shows what's actionable) and re-enter at step 2. Step 1 repeats per new feature (`new-feature`), or once per roadmap milestone (`milestone-to-briefs`).

## Key rules

- Each step must produce its named artifact before the next begins.
- Step 4 is two passes: `to-issues` (4a) sets the slice shape; `decompose-issues` (4b) scores each slice and splits any ≥4 into ≤3-complexity leaves with concrete pointers. A split slice becomes a `ready-for-human` container — only its leaves are `ready-for-agent` and dispatched.
- 4b reads the **whole feature's issue set** (it has to, to rewire blockers and renumber on split) and is **idempotent**: it stamps each finalized issue `Decomposed: <date>` and skips already-stamped issues on a re-run, so a partial pass resumes cleanly. Because 4b edits 4a's files in place rather than emitting a new artifact, the `Decomposed:` stamp **is** its artifact — it's the only signal that tells whether (and how completely) 4b ran. Check it with `... bin.ts status` (`decomposed N/total` per feature; `✓ decomposed` per issue). It lives in the issue frontmatter; never hand-write it into `issues-status.json` (that file is regenerated from the markdown).
- The feature directory is the unit of work — every artifact lives under `.scratch/features/<id>-<slug>/`.
- Never hand-edit `features-status.json` or `issues-status.json` — always go through `npx tsx .agents/workflows/features-cli/bin.ts`.
- If step 5 reveals a bad decision, return to step 2 and re-run `to-prd` — don't patch around it silently.
- Step 6 reviews against the brief's acceptance criteria, not "does the code look nice".
- Step 7 is the final gate; never skipped.
