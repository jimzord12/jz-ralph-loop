# lib.sh — pure, unit-testable helpers for ralph.sh. Source it; do not execute.
#
# These functions read a few globals that ralph.sh sets before calling them:
#   churn()          needs $BASE_HEAD, $PROJECT
#   detect_outcome() needs $MODE   (text | json)
#   extract_tokens() needs $MODE   (text | json)
#   detect_flip()    / detect_phase() are pure (args only)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "lib.sh: source this file (e.g. source ./lib.sh); do not execute it." >&2
  exit 1
fi

# Cumulative churn since BASE_HEAD → "nfiles ins del" (or "0 0 0").
# Needs globals: BASE_HEAD, PROJECT.
churn() {
  if [ -z "${BASE_HEAD:-}" ]; then echo "0 0 0"; return; fi
  git -C "${PROJECT:-}" diff --numstat "$BASE_HEAD" -- 2>/dev/null \
    | awk 'NF>=2 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ { f++; ins += $1; del += $2 }
           END { printf "%d %d %d", f+0, ins+0, del+0 }'
}

# detect_outcome LOG → echoes BLOCKED | DONE | NEXT | NONE (first-match-wins).
# Anchored ^RALPH_<KW>$ per AGENTS.md §"Keyword contract": a prose mention inside
# a sentence cannot fire because the keyword must sit ALONE on its own line. In
# json mode the keyword lives inside assistant message text, so that text is
# extracted first and the SAME anchor is applied to it — anchor-faithful in both
# modes. Needs global: MODE (text | json).
detect_outcome() {
  local text
  if [ "${MODE:-text}" = "json" ]; then
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
# Needs global: MODE (text | json).
extract_tokens() {
  if [ "${MODE:-text}" = "json" ]; then
    jq -s '[.[] | select(.type=="message_end" and (.message.role=="assistant")) | ((.message.usage // {}).totalTokens // 0)] | add // 0' "$1" 2>/dev/null || true
  else
    grep -oE '[0-9]+ tokens' "$1" | tail -1 | awk '{print $1}' || true
  fi
}

# detect_flip BEFORE AFTER → echoes "<count> <task_id>" (task_id empty if none).
# Diffs two PROCESS.md snapshots; counts lines that flipped to a checked box.
# Returns the count and the first flipped task id. Pure (args only).
detect_flip() {
  local before="$1" after="$2" flips flip_count task_id
  flip_count=0
  task_id=""
  if [ -f "$before" ] && [ -f "$after" ]; then
    flips="$(diff "$before" "$after" 2>/dev/null | grep -E '^> - \[x\] ' || true)"
    if [ -n "$flips" ]; then
      flip_count="$(printf '%s\n' "$flips" | grep -cE '^> - \[x\] ' || echo 0)"
      task_id="$(printf '%s\n' "$flips" | head -1 | sed -E 's/^> - \[x\] ([^ ]+).*/\1/')"
    fi
  fi
  printf '%s %s\n' "$flip_count" "$task_id"
}

# detect_phase PROCESS_MD TASK_ID → echoes the "## Phase:" header above the task,
# or empty. HTML-comment blocks are skipped so commented-out examples are ignored.
# Pure (args only).
detect_phase() {
  local process_md="$1" task_id="$2"
  [ -n "$task_id" ] || { printf '\n'; return; }
  awk -v t="$task_id" '
    {
      if (incomment) { if ($0 ~ /-->/) incomment = 0; next }
      if ($0 ~ /<!--/) { if ($0 !~ /-->/) incomment = 1; next }
    }
    /^## Phase: / { ph = substr($0, 11) }
    index($0, t) { print ph; exit }
  ' "$process_md" 2>/dev/null || true
}
