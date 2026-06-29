#!/usr/bin/env bash
# analytics.sh — render runs/<plan>/analytics/summary.md from timeline.csv + PROGRESS.md
#
# usage: analytics.sh <plan_dir> <control_dir> <project>
# Called by ralph.sh after every iteration (live) and usable standalone.
set -euo pipefail

PLAN_DIR="${1:?plan_dir required}"
CTRL="${2:?control_dir required}"
PROJECT="${3:?project required}"
CSV="$PLAN_DIR/timeline.csv"
PROC="$CTRL/PROGRESS.md"
OUT="$PLAN_DIR/analytics/summary.md"
BARW="${RALPH_BAR_WIDTH:-20}"

mkdir -p "$(dirname "$OUT")"

[ -f "$CSV" ] || { echo "[analytics] no $CSV" >&2; exit 1; }

# Phase progress from PROGRESS.md: "phase\tdone\ttotal".
phase_file="$(mktemp)"
if [ -f "$PROC" ]; then
  awk '
    {
      # Skip HTML comment blocks so commented-out examples are not counted.
      if (incomment) { if ($0 ~ /-->/) incomment = 0; next }
      if ($0 ~ /<!--/) { if ($0 !~ /-->/) incomment = 1; next }
    }
    /^## Phase: / { ph = substr($0, 11) }
    /^- \[[ x]\] / { total[ph]++; if (match($0, /^- \[x\]/)) done[ph]++ }
    END { for (p in total) printf "%s\t%d\t%d\n", p, done[p]+0, total[p]+0 }
  ' "$PROC" | sort > "$phase_file"
fi

{
  echo "# Ralph Loop — Run Analytics"
  echo
  echo "- **Plan:** \`$(basename "$PLAN_DIR")\`"
  echo "- **Project:** \`$PROJECT\`"
  echo "- **Control:** \`$CTRL\`"
  echo "- **Generated:** $(date -u +%FT%TZ)"
  echo

  echo "## Phase progress"
  echo
  echo '```'
  if [ -s "$phase_file" ]; then
    awk -v w="$BARW" -F'\t' '
      {
        ph=$1; d=$2; t=$3; pct=(t>0 ? int(d*100/t) : 0);
        filled=(t>0 ? int(d*w/t) : 0);
        bar=""; for (i=0;i<w;i++) bar = (i<filled ? "█" : "░");
        printf "%-18s [%s] %d/%d (%d%%)\n", substr(ph,1,18), bar, d, t, pct
      }
    ' "$phase_file"
  else
    echo "(no phases parsed from PROGRESS.md)"
  fi
  echo '```'
  echo

  echo "## Aggregate"
  echo
  awk -F',' 'NR>1 {
      iters++; dur += $4;
      if ($5=="NEXT") nxt++; if ($5=="BLOCKED") blk++; if ($5=="DONE") dn++; if ($5=="RED") red++; if ($5=="ANOMALY") anm++;
      if ($6 != "" && ($5=="NEXT" || $5=="DONE")) done_tasks++;
      nf=$8; ins=$9; del=$10; tok += ($11=="" ? 0 : $11);
    }
    END {
      printf "- iterations run: %d\n", iters+0
      printf "- outcomes: NEXT=%d  BLOCKED=%d  DONE=%d  RED=%d  ANOMALY=%d\n", nxt+0, blk+0, dn+0, red+0, anm+0
      printf "- tasks completed: %d\n", done_tasks+0
      printf "- total duration: %ds (%dm)\n", dur+0, int((dur+0)/60)
      printf "- churn (cumulative): %d files, +%d / -%d lines\n", nf+0, ins+0, del+0
      if (tok > 0) printf "- tokens (best-effort): %d\n", tok+0
    }' "$CSV"
  echo

  echo "## Per-iteration (true deltas)"
  echo
  echo "| iter | task | phase | outcome | dur(s) | Δfiles | +lines | -lines |"
  echo "|---|---|---|---|---|---|---|---|"
  awk -F',' 'NR>1 {
      dnf = $8 - pnf; din = $9 - pin; ddl = $10 - pdl;
      printf "| %s | %s | %s | %s | %s | %d | %d | %d |\n", \
        $1, ($6==""?"-":$6), ($7==""?"-":$7), $5, $4, dnf, din, ddl;
      pnf = $8; pin = $9; pdl = $10;
    }' "$CSV"
  echo

  echo "## Slowest iterations"
  echo
  awk -F',' 'NR>1 && $6 != "" { print $4"\t"$6"\t"$7 }' "$CSV" \
    | sort -rn | head -n 5 \
    | while IFS=$'\t' read -r dur task ph; do
        printf -- "- %s (%s) — %ss\n" "$task" "$ph" "$dur"
      done
} > "$OUT"

rm -f "$phase_file"
echo "[analytics] wrote $OUT"
