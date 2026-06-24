#!/usr/bin/env bash
# test/e2e/live_ai.sh — real-AI end-to-end test.
#
# Builds a throwaway control plane + work plane in a temp dir, copies in the
# ACTUAL committed ralph.sh/analytics.sh/lib.sh/AGENTS.md, and drives a real
# omp + Zai GLM model on a one-task sandbox. Asserts the loop reaches RALPH_DONE
# (exit 0), flips the checkbox, and lands the deliverable.
#
# Opt-in: only runs when RUN_LIVE_AI=1. Needs: omp on PATH, ZAI_API_KEY set,
# network, and (small) API spend.
#
# usage (via the runner):   RUN_LIVE_AI=1 ./test/run_tests.sh
#   env: RALPH_TEST_MODEL      (default glm-5.2)  — the omp model to spawn
#        RALPH_TEST_MAX_ITERS  (default 6)        — iteration cap for the run
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL="${RALPH_TEST_MODEL:-glm-5.2}"
MAX_ITERS="${RALPH_TEST_MAX_ITERS:-6}"

echo "live: checking prerequisites…"
command -v omp >/dev/null 2>&1 || { echo "live: FAIL — omp not found on PATH" >&2; exit 1; }
[ -n "${ZAI_API_KEY:-}" ]      || { echo "live: FAIL — ZAI_API_KEY not set" >&2;     exit 1; }

WORK="$(mktemp -d -t ralph-live-XXXXXX)"
CTRL="$WORK/control"
PROJ="$WORK/project"
mkdir -p "$CTRL/tasks" "$PROJ"

# Copy the real committed loop into the throwaway control plane so $DIR resolves
# to the sandbox (the repo's own PROCESS.md is never touched).
cp "$ROOT/ralph.sh" "$ROOT/analytics.sh" "$ROOT/lib.sh" "$ROOT/AGENTS.md" "$CTRL/"
chmod +x "$CTRL/ralph.sh" "$CTRL/analytics.sh"

# --- control plane: a one-task plan ---
cat > "$CTRL/PROCESS.md" <<'EOF'
# Ralph Loop — Process

## Phase: Hello
- [ ] 001-say-hello → tasks/001-say-hello.md
EOF
cat > "$CTRL/HANDOFF.md" <<'EOF'
# Ralph Loop — Handoff
First iteration of the live e2e sandbox: nothing done yet.
EOF
cat > "$CTRL/KNOWLEDGE.md" <<'EOF'
# Ralph Loop — Knowledge
EOF
cat > "$CTRL/tasks/001-say-hello.md" <<'EOF'
---
id: 001
phase: Hello
depends_on: []
estimate: ~1min
---
# Task: say hello

## Goal
Create a file named `hello.txt` in the project root containing the text `hello from ralph`.

## Context
- Your current working directory IS the project root.
- Use a tool (write or bash) to create the file. No other files are needed.

## Acceptance criteria
- [ ] A file named `hello.txt` exists in the project root.
- [ ] Its contents include the text `hello from ralph`.

## Notes
- Trivial single-step task — finish it in this one iteration.
- Then follow AGENTS.md: run the gate, flip ONLY this box, rewrite HANDOFF, commit, print RALPH_NEXT.
EOF

# --- work plane: a real git repo (agent commits here; churn analytics need it) ---
git -C "$PROJ" init -q
git -C "$PROJ" config user.email ralph@test.local
git -C "$PROJ" config user.name "Ralph Test"
printf '# sandbox project\n' > "$PROJ/README.md"
git -C "$PROJ" add -A; git -C "$PROJ" commit -qm init

# Gate: green once hello.txt exists. (Content is checked separately, leniently.)
GATE='test -f hello.txt'

echo "live: model=$MODEL  max_iters=$MAX_ITERS"
echo "live: control=$CTRL"
echo "live: project=$PROJ"
echo "live: launching ralph.sh …"
echo

set +e
RALPH_PROJECT="$PROJ" \
RALPH_MODEL="$MODEL" \
RALPH_MAX_ITERS="$MAX_ITERS" \
RALPH_VERIFY_GATES=1 \
RALPH_GATE_CMD="$GATE" \
RALPH_OMP=omp \
bash "$CTRL/ralph.sh"
RC=$?
set -e

echo
echo "live: ralph.sh exited $RC"

FAIL=0
# 1. the loop must terminate via RALPH_DONE (exit 0)
if [ "$RC" -eq 0 ]; then
  echo "live: ok  loop reached RALPH_DONE (exit 0)"
else
  echo "live: FAIL expected exit 0 (DONE), got $RC"; FAIL=1
fi
# 2. the one checkbox flipped to [x]
if grep -q -- '- \[x\] 001-say-hello' "$CTRL/PROCESS.md"; then
  echo "live: ok  box flipped -> [x] 001-say-hello"
else
  echo "live: FAIL box was not flipped in PROCESS.md"; FAIL=1
fi
# 3. the deliverable landed with the right content
if [ -f "$PROJ/hello.txt" ]; then
  if grep -q 'hello from ralph' "$PROJ/hello.txt"; then
    echo "live: ok  hello.txt created with expected content"
  else
    echo "live: WARN hello.txt exists but content mismatch:"; sed 's/^/      /' "$PROJ/hello.txt"
  fi
else
  echo "live: FAIL hello.txt was not created in the project"; FAIL=1
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "live: analytics summary (tail):"
  sed -n '1,18p' "$CTRL"/runs/*/analytics/summary.md 2>/dev/null | sed 's/^/  /' || true
  rm -rf "$WORK"
  echo "live: PASS — real GLM completed the loop end-to-end"
  exit 0
else
  echo "live: --- diagnostics: last iteration log (tail) ---"
  LAST="$(ls -1 "$CTRL"/runs/*/*.log 2>/dev/null | tail -1)"
  [ -n "$LAST" ] && sed -n '1,60p' "$LAST" | sed 's/^/  /'
  echo "live: --- timeline ---"
  cat "$CTRL"/runs/*/timeline.csv 2>/dev/null | sed 's/^/  /'
  echo "live: kept sandbox at $WORK for inspection"
  exit 1
fi
