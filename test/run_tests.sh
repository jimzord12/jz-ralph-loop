#!/usr/bin/env bash
# test/run_tests.sh — deterministic unit tests for ralph-loop's pure logic
# (lib.sh) plus an analytics-rendering check. Zero external deps
# (bash + coreutils + git).
#
# The real-AI end-to-end test is separate (test/e2e/live_ai.sh) and only runs
# when RUN_LIVE_AI=1 — it needs omp + a ZAI_API_KEY + network + spend.
#
# usage:
#   ./test/run_tests.sh                  # unit tests only (offline, deterministic)
#   RUN_LIVE_AI=1 ./test/run_tests.sh    # unit + live e2e (real Zai GLM via omp)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/lib.sh"

PASS=0; FAIL=0
declare -a FAILED_NAMES=()

assert_eq() {  # assert_eq <name> <expected> <actual>
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS+1)); printf '  ok  %s\n' "$name"
  else
    FAIL=$((FAIL+1)); FAILED_NAMES+=("$name")
    printf '  FAIL %s\n      expected: %q\n      actual:   %q\n' "$name" "$expected" "$actual"
  fi
}

# --- detect_outcome: keyword anchoring (the false-positive bug the original shipped) ---
detect_outcome_tests() {
  local tmp; tmp="$(mktemp)"; MODE=text
  printf 'RALPH_NEXT\n'        > "$tmp"; assert_eq "outcome: NEXT standalone"      "NEXT"    "$(detect_outcome "$tmp")"
  printf 'RALPH_DONE\n'        > "$tmp"; assert_eq "outcome: DONE standalone"      "DONE"    "$(detect_outcome "$tmp")"
  printf 'RALPH_BLOCKED\n'     > "$tmp"; assert_eq "outcome: BLOCKED standalone"   "BLOCKED" "$(detect_outcome "$tmp")"
  printf 'all good, no kw\n'   > "$tmp"; assert_eq "outcome: no keyword -> NONE"   "NONE"    "$(detect_outcome "$tmp")"
  :                            > "$tmp"; assert_eq "outcome: empty log -> NONE"     "NONE"    "$(detect_outcome "$tmp")"
  # prose mention must NOT fire (the regression guard)
  printf 'the next iteration will print RALPH_DONE.\nRALPH_NEXT\n'      > "$tmp"; assert_eq "outcome: prose DONE ignored"    "NEXT" "$(detect_outcome "$tmp")"
  printf 'if it fails I will RALPH_BLOCKED eventually\nRALPH_NEXT\n'    > "$tmp"; assert_eq "outcome: prose BLOCKED ignored" "NEXT" "$(detect_outcome "$tmp")"
  printf 'see RALPH_NEXT below\nRALPH_DONE\n'                           > "$tmp"; assert_eq "outcome: prose NEXT ignored"    "DONE" "$(detect_outcome "$tmp")"
  # BLOCKED wins when both keywords appear as standalone lines (priority order)
  printf 'RALPH_NEXT\nRALPH_BLOCKED\n'                                  > "$tmp"; assert_eq "outcome: BLOCKED has priority"  "BLOCKED" "$(detect_outcome "$tmp")"
  # keyword with surrounding spaces on its line must NOT fire (anchored, no spaces)
  printf '  RALPH_NEXT  \n' > "$tmp"; assert_eq "outcome: padded keyword -> NONE"   "NONE"    "$(detect_outcome "$tmp")"
  rm -f "$tmp"
}

# --- detect_flip ---
detect_flip_tests() {
  local before after c t
  before="$(mktemp)"; after="$(mktemp)"

  printf -- '- [ ] 001-a\n- [ ] 002-b\n' > "$before"; cp "$before" "$after"
  read -r c t <<< "$(detect_flip "$before" "$after")"
  assert_eq "flip: none -> count 0" "0" "$c"; assert_eq "flip: none -> task empty" "" "$t"

  printf -- '- [ ] 001-a\n- [ ] 002-b\n' > "$before"
  printf -- '- [x] 001-a\n- [ ] 002-b\n' > "$after"
  read -r c t <<< "$(detect_flip "$before" "$after")"
  assert_eq "flip: one -> count 1" "1" "$c"; assert_eq "flip: one -> task 001-a" "001-a" "$t"

  printf -- '- [ ] 001-a\n- [ ] 002-b\n' > "$before"
  printf -- '- [x] 001-a\n- [x] 002-b\n' > "$after"
  read -r c t <<< "$(detect_flip "$before" "$after")"
  assert_eq "flip: two -> count 2" "2" "$c"; assert_eq "flip: two -> first task 001-a" "001-a" "$t"

  # an un-flip (checked -> unchecked) must NOT count as a flip
  printf -- '- [x] 001-a\n' > "$before"; printf -- '- [ ] 001-a\n' > "$after"
  read -r c t <<< "$(detect_flip "$before" "$after")"
  assert_eq "flip: un-flip not counted" "0" "$c"

  read -r c t <<< "$(detect_flip "/nonexistent/before" "$after")"
  assert_eq "flip: missing before -> count 0" "0" "$c"

  rm -f "$before" "$after"
}

# --- detect_phase ---
detect_phase_tests() {
  local proc; proc="$(mktemp)"
  cat > "$proc" <<'EOF'
## Phase: Setup
- [x] 001-a

## Phase: Build
- [ ] 002-b
EOF
  assert_eq "phase: 002-b -> Build"        "Build" "$(detect_phase "$proc" "002-b")"
  assert_eq "phase: 001-a -> Setup"        "Setup" "$(detect_phase "$proc" "001-a")"
  assert_eq "phase: empty task -> empty"   ""      "$(detect_phase "$proc" "")"
  # HTML-commented task line must not set the phase
  cat > "$proc" <<'EOF'
## Phase: Real
<!-- - [ ] 003-c commented example -->
- [x] 003-c
EOF
  assert_eq "phase: 003-c ignores comment" "Real"  "$(detect_phase "$proc" "003-c")"
  rm -f "$proc"
}

# --- churn ---
churn_tests() {
  local repo; repo="$(mktemp -d)"
  git -C "$repo" init -q
  git -C "$repo" config user.email t@t; git -C "$repo" config user.name t
  printf 'a\n' > "$repo/a.txt"; git -C "$repo" add -A; git -C "$repo" commit -qm base

  BASE_HEAD="$(git -C "$repo" rev-parse HEAD)"; PROJECT="$repo"
  assert_eq "churn: clean tree -> 0 0 0" "0 0 0" "$(churn)"

  # modify an existing file (deterministic numeric numstat, no '-' ambiguity)
  printf 'a\nb\nc\n' > "$repo/a.txt"
  local expected
  expected="$(git -C "$repo" diff --numstat "$BASE_HEAD" \
    | awk 'NF>=2 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ { f++; ins+=$1; del+=$2 } END { printf "%d %d %d", f+0, ins+0, del+0 }')"
  assert_eq "churn: matches numstat aggregation" "$expected" "$(churn)"

  BASE_HEAD=""
  assert_eq "churn: no baseline -> 0 0 0" "0 0 0" "$(churn)"
  rm -rf "$repo"
}

# --- extract_tokens (text mode) ---
extract_tokens_tests() {
  local tmp; tmp="$(mktemp)"; MODE=text
  printf 'some log line\n1234 tokens used\n' > "$tmp"; assert_eq "tokens: text 1234"     "1234" "$(extract_tokens "$tmp")"
  printf 'first 10 tokens\nthen 99 tokens\n' > "$tmp"; assert_eq "tokens: takes last"    "99"   "$(extract_tokens "$tmp")"
  :                                          > "$tmp"; assert_eq "tokens: none -> empty" ""     "$(extract_tokens "$tmp")"
  rm -f "$tmp"
}

# --- analytics rendering (end-to-end on a fixture) ---
analytics_tests() {
  local tmp plan ctrl out
  tmp="$(mktemp -d)"; plan="$tmp/plan"; ctrl="$tmp/ctrl"
  mkdir -p "$plan/analytics" "$ctrl"
  {
    printf 'iter,start_iso,end_iso,dur_s,outcome,task_id,phase,nfiles,ins,del,tokens\n'
    printf '1,2026-01-01T00:00:00Z,2026-01-01T00:03:00Z,180,NEXT,001-a,Setup,3,120,12,\n'
    printf '2,2026-01-01T00:03:00Z,2026-01-01T00:09:00Z,360,DONE,,,6,520,42,\n'
  } > "$plan/timeline.csv"
  printf '# Ralph Loop — Progress\n\n## Phase: Setup\n- [x] 001-a\n' > "$ctrl/PROGRESS.md"

  bash "$ROOT/analytics.sh" "$plan" "$ctrl" "/tmp/fake" >/dev/null 2>&1
  out="$plan/analytics/summary.md"
  if [ -f "$out" ]; then assert_eq "analytics: summary written" "yes" "yes"; else assert_eq "analytics: summary written" "yes" "no"; fi
  if grep -q 'NEXT=1.*DONE=1' "$out" 2>/dev/null; then assert_eq "analytics: aggregate counts" "ok" "ok"; else assert_eq "analytics: aggregate counts" "ok" "MISSING"; fi
  if grep -q '001-a' "$out" 2>/dev/null; then assert_eq "analytics: per-iteration row" "ok" "ok"; else assert_eq "analytics: per-iteration row" "ok" "MISSING"; fi
  if grep -q 'Phase progress' "$out" 2>/dev/null && grep -q 'Setup' "$out"; then assert_eq "analytics: phase progress rendered" "ok" "ok"; else assert_eq "analytics: phase progress rendered" "ok" "MISSING"; fi
  rm -rf "$tmp"
}

echo "## unit tests (lib.sh + analytics.sh)"
detect_outcome_tests
detect_flip_tests
detect_phase_tests
churn_tests
extract_tokens_tests
analytics_tests

echo
TOTAL=$((PASS+FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo "unit: all $PASS/$TOTAL passed"
else
  echo "unit: $PASS/$TOTAL passed, $FAIL FAILED -> ${FAILED_NAMES[*]}"
fi
RESULT=$FAIL

# --- optional live e2e (real omp + Zai GLM) ---
if [ "${RUN_LIVE_AI:-0}" = "1" ]; then
  echo
  echo "## live e2e (real omp + ${RALPH_TEST_MODEL:-glm-5.2})"
  if bash "$ROOT/test/e2e/live_ai.sh"; then
    echo "live: PASS"
  else
    echo "live: FAIL"
    RESULT=$((RESULT+1))
  fi
fi

echo
if [ "$RESULT" -eq 0 ]; then echo "result: PASS"; exit 0; else echo "result: FAIL"; exit 1; fi
