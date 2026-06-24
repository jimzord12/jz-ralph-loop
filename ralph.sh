#!/usr/bin/env bash
# ralph.sh — drives a Ralph loop: one `omp -p` iteration per unchecked task.
#
# Control files live in THIS directory (the control plane). The work target is
# $RALPH_PROJECT (default: the parent directory). Logs + analytics land in
# runs/<UTC-timestamp>/ — one dir per invocation.
#
# Env:
#   RALPH_PROJECT    project to work on (default: parent of this dir)
#   RALPH_MAX_ITERS  hard cap on iterations (default: 50)
#   RALPH_OMP        omp binary (default: omp)
#   RALPH_MODE       text (default) | json — json spawns omp under --mode=json so
#                    the loop can account tokens (logs become NDJSON)
#   RALPH_VERIFY_GATES 1 (default) | 0 — loop re-runs the gate command each
#                    iteration and unchecks the box on red; set 0 to trust the
#                    agent self-report
#   RALPH_GATE_CMD   the project's quality gates, run as one shell command
#                    (default: `npm test && npm run typecheck`). Used by BOTH the
#                    loop's verification re-run AND injected into the spawned
#                    agent's prompt (AGENTS.md step 5). Override for non-npm
#                    stacks, e.g. `cargo test`, `pytest -q`, `go build ./... && go test ./...`
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${RALPH_PROJECT:-$(cd "$DIR/.." && pwd)}"
MAX_ITERS="${RALPH_MAX_ITERS:-50}"
OMP="${RALPH_OMP:-omp}"

# Verification-model config (see README §"Verification model").
MODE="${RALPH_MODE:-text}"
OMP_MODE_ARGS=()
[ "$MODE" = "json" ] && OMP_MODE_ARGS=(--mode=json)
VERIFY_GATES="${RALPH_VERIFY_GATES:-1}"
GATE_CMD="${RALPH_GATE_CMD:-npm test && npm run typecheck}"

for f in AGENTS.md PROCESS.md HANDOFF.md KNOWLEDGE.md; do
  [ -f "$DIR/$f" ] || { echo "[ralph] missing control file $DIR/$f" >&2; exit 1; }
done

# One plan dir per invocation.
PLAN_DIR="$DIR/runs/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$PLAN_DIR/analytics"
mkdir -p "$DIR/runs"

echo "[ralph] control: $DIR"
echo "[ralph] project: $PROJECT"
echo "[ralph] plan:    $PLAN_DIR"
echo "[ralph] cap:     $MAX_ITERS iterations"
echo "[ralph] gates:   $GATE_CMD (verify=$VERIFY_GATES)"

# Git baseline for churn analytics (empty if the project isn't a repo).
BASE_HEAD=""
if git -C "$PROJECT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BASE_HEAD="$(git -C "$PROJECT" rev-parse HEAD 2>/dev/null || echo "")"
fi
printf '%s\n' "$BASE_HEAD" > "$PLAN_DIR/.base_head"

MASTER="$DIR/runs/RALPH.log"
printf '%s plan=%s project=%s started=%s\n' "$(date -u +%FT%TZ)" "$PLAN_DIR" "$PROJECT" "$(date -u +%FT%TZ)" >> "$MASTER"

# timeline.csv header.
printf 'iter,start_iso,end_iso,dur_s,outcome,task_id,phase,nfiles,ins,del,tokens\n' \
  > "$PLAN_DIR/timeline.csv"

# Cumulative churn since BASE_HEAD → "nfiles ins del" (or "0 0 0").
churn() {
  if [ -z "$BASE_HEAD" ]; then echo "0 0 0"; return; fi
  git -C "$PROJECT" diff --numstat "$BASE_HEAD" -- 2>/dev/null \
    | awk 'NF>=2 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ { f++; ins += $1; del += $2 }
           END { printf "%d %d %d", f+0, ins+0, del+0 }'
}

# detect_outcome LOG → echoes BLOCKED | DONE | NEXT | NONE (first-match-wins).
# Anchored ^RALPH_<KW>$ per AGENTS.md §"Keyword contract": a prose mention inside
# a sentence cannot fire because the keyword must sit ALONE on its own line. In
# json mode the keyword lives inside assistant message text, so that text is
# extracted first and the SAME anchor is applied to it — anchor-faithful in both
# modes.
detect_outcome() {
  local text
  if [ "$MODE" = "json" ]; then
    text="$(jq -jr 'select(.type=="message_end" and (.message.role=="assistant")) | ((.message.content // [])[] | .text // ""), "\n"' "$1" 2>/dev/null || true)"
  else
    text="$(cat "$1" 2>/dev/null || true)"
  fi
  if   printf '%s\n' "$text" | grep -qE '^RALPH_BLOCKED$'; then echo BLOCKED
  elif printf '%s\n' "$text" | grep -qE '^RALPH_DONE$';    then echo DONE
  elif printf '%s\n' "$text" | grep -qE '^RALPH_NEXT$';    then echo NEXT
  else echo NONE
  fi
}

# extract_tokens LOG → integer token count, or empty if unavailable. json mode
# sums usage.totalTokens across assistant message_end events (per-message usage);
# text mode keeps the best-effort grep (omp -p text emits no usage line).
extract_tokens() {
  if [ "$MODE" = "json" ]; then
    jq -s '[.[] | select(.type=="message_end" and (.message.role=="assistant")) | ((.message.usage // {}).totalTokens // 0)] | add // 0' "$1" 2>/dev/null || true
  else
    grep -oE '[0-9]+ tokens' "$1" | tail -1 | awk '{print $1}' || true
  fi
}

iter=0
while [ "$iter" -lt "$MAX_ITERS" ]; do
  iter=$((iter + 1))
  log="$PLAN_DIR/$(printf '%03d' "$iter").log"
  before="$PLAN_DIR/.process.${iter}.before"
  cp "$DIR/PROCESS.md" "$before" 2>/dev/null || true

  start_iso="$(date -u +%FT%TZ)"; start_s="$(date +%s)"
  echo "[ralph] iter $iter → $log"

  set +e
  "$OMP" -p --no-session --auto-approve "${OMP_MODE_ARGS[@]}" --cwd "$PROJECT" \
    "You are ONE iteration of a Ralph loop. CONTROL_DIR is $DIR. Read and follow the protocol at $DIR/AGENTS.md exactly. Control files (PROCESS.md, HANDOFF.md, KNOWLEDGE.md, tasks/) live in CONTROL_DIR. Your work target is the current working directory; make code changes there. The project's quality gates are: \`$GATE_CMD\`." \
    > "$log" 2>&1
  rc=$?
  set -e

  end_s="$(date +%s)"; end_iso="$(date -u +%FT%TZ)"
  dur=$((end_s - start_s))

  # Outcome keyword (first match wins). detect_outcome anchors each pattern to a
  # standalone line (^RALPH_<KW>$) so a prose mention inside a sentence cannot
  # fire — AGENTS.md §"Keyword contract" requires the keyword alone on its own
  # line. In json mode the anchor is applied to the extracted assistant message
  # text, not the raw log.
  outcome="$(detect_outcome "$log")"
  kw="$outcome"

  # Which box(es) flipped? (diff PROCESS.md before → after). Asserts the flip
  # count matches the outcome: NEXT requires exactly 1; DONE/BLOCKED/NONE require
  # 0; >1 is always wrong (AGENTS.md "never check more than one box").
  flip_count=0
  task_id=""
  if [ -f "$before" ] && [ -f "$DIR/PROCESS.md" ]; then
    flips="$(diff "$before" "$DIR/PROCESS.md" 2>/dev/null | grep -E '^> - \[x\] ' || true)"
    if [ -n "$flips" ]; then
      flip_count="$(printf '%s\n' "$flips" | grep -cE '^> - \[x\] ' || echo 0)"
      task_id="$(printf '%s\n' "$flips" | head -1 | sed -E 's/^> - \[x\] ([^ ]+).*/\1/')"
    fi
  fi

  # Phase = the "## Phase:" header above the task line in PROCESS.md.
  phase=""
  if [ -n "$task_id" ]; then
    phase="$(awk -v t="$task_id" '
      {
        if (incomment) { if ($0 ~ /-->/) incomment = 0; next }
        if ($0 ~ /<!--/) { if ($0 !~ /-->/) incomment = 1; next }
      }
      /^## Phase: / { ph = substr($0, 11) }
      index($0, t) { print ph; exit }
    ' "$DIR/PROCESS.md" || true)"
  fi

  # Loop re-runs the gates + unchecks on red. The agent self-runs them
  # (AGENTS.md step 5) but its self-report is the only evidence; this is the
  # external check. Skipped for BLOCKED (the agent asked for human help — honor
  # it). An empty GATE_CMD disables the re-run.
  gate_red=0
  if [ "$VERIFY_GATES" = "1" ] && [ "$kw" != "BLOCKED" ] && [ -n "$GATE_CMD" ]; then
    set +e
    ( cd "$PROJECT" && eval "$GATE_CMD" ) >/dev/null 2>&1 || gate_red=1
    set -e
  fi

  # Assert exactly-one-box-flipped. NEXT requires exactly 1; DONE/NONE require 0;
  # >1 is always wrong. Checked only when the gates are green (a gate failure is
  # the louder signal and already triggers a reject); BLOCKED is exempt — a
  # BLOCKED agent that nonetheless flipped is honored (outcome=BLOCKED → exit 2)
  # with its stray box restored by the override below.
  flip_anomaly=0
  if [ "$gate_red" -eq 0 ] && [ "$kw" != "BLOCKED" ]; then
    case "$kw" in
      NEXT) [ "$flip_count" -eq 1 ] || flip_anomaly=1 ;;
      *)    [ "$flip_count" -eq 0 ] || flip_anomaly=1 ;;
    esac
  fi

  # Loop verdict: RED/ANOMALY override the agent's self-report. RED = the tree is
  # genuinely broken; ANOMALY = the box-flip count violates the one-box rule. On
  # either, restore PROCESS.md from the pre-iteration snapshot so the box is
  # unchecked and the task retries next iteration (the agent's commit, if any,
  # stays in git as a forensic record; it is not auto-reverted).
  rejected=0
  if [ "$gate_red" -eq 1 ]; then outcome="RED"; rejected=1
  elif [ "$flip_anomaly" -eq 1 ]; then outcome="ANOMALY"; rejected=1
  else outcome="$kw"; fi
  # A BLOCKED agent that nonetheless flipped a box: honor the keyword (exit 2
  # below) but still restore the box so the ledger isn't corrupted.
  if [ "$kw" = "BLOCKED" ] && [ "$flip_count" -gt 0 ]; then
    rejected=1
    echo "[ralph] iter $iter: BLOCKED with $flip_count flip(s) — restoring PROCESS.md" >&2
  fi
  if [ "$rejected" -eq 1 ]; then
    [ -f "$before" ] && cp "$before" "$DIR/PROCESS.md" || true
    echo "[ralph] REJECT iter $iter outcome=$outcome (kw=$kw flips=$flip_count) — restored PROCESS.md; task will retry next iteration" >&2
  fi

  read -r nfiles ins del <<< "$(churn)"
  tokens="$(extract_tokens "$log")"

  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$iter" "$start_iso" "$end_iso" "$dur" "$outcome" "$task_id" "$phase" \
    "$nfiles" "$ins" "$del" "${tokens:-}" >> "$PLAN_DIR/timeline.csv"

  printf '%s plan=%s iter=%d outcome=%s task=%s dur=%ss rc=%d\n' \
    "$(date -u +%FT%TZ)" "$PLAN_DIR" "$iter" "$outcome" "${task_id:--}" "$dur" "$rc" >> "$MASTER"

  # Live analytics refresh (never fatal to the loop).
  bash "$DIR/analytics.sh" "$PLAN_DIR" "$DIR" "$PROJECT" >/dev/null 2>&1 || true

  case "$outcome" in
    BLOCKED)
      echo "[ralph] BLOCKED at iter $iter (rc=$rc) — see $log and $DIR/HANDOFF.md"
      exit 2 ;;
    DONE)
      echo "[ralph] DONE at iter $iter (rc=$rc) — see $PLAN_DIR/analytics/summary.md"
      exit 0 ;;
  esac
done

bash "$DIR/analytics.sh" "$PLAN_DIR" "$DIR" "$PROJECT" >/dev/null 2>&1 || true
echo "[ralph] hit MAX_ITERS=$MAX_ITERS (possible runaway) — see $PLAN_DIR"
exit 3
