#!/usr/bin/env bash
#
# Runs the all-dimensions reconciliation suite and writes a timestamped
# results file. Local run only (--no-report): nothing is sent to Coalesce Quality.
#
# On MISMATCH, and when a reconciliation's source and target connections are the
# same type (currently Snowflake), also writes a timestamped .sql file with a
# FULL OUTER JOIN diff query per failing reconciliation so you can see which rows
# differ. Run that .sql yourself to investigate.
#
# Usage: ./run_dim_recon.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SUITE="all_dims_vs_bronze.suite.yaml"
CONNECTIONS=".connections.yaml"
RESULTS_DIR="$SCRIPT_DIR/results"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="$RESULTS_DIR/dim_recon_${STAMP}.txt"
SQL="$RESULTS_DIR/dim_recon_${STAMP}_failed_rows.sql"
RAW_JSON="$RESULTS_DIR/.dim_recon_${STAMP}.json"

mkdir -p "$RESULTS_DIR"

echo "Running $SUITE ..."

# Run the suite once, capturing machine-readable JSON for detection.
set +e
synq-recon run "$SUITE" --no-report -o json > "$RAW_JSON" 2>/dev/null
run_status=$?
set -e

# Build the human-readable results file and (on mismatch) the diff SQL file.
set +e
python3 "$SCRIPT_DIR/gen_diff_sql.py" \
  --suite "$SUITE" \
  --results "$RAW_JSON" \
  --connections "$CONNECTIONS" \
  --txt "$OUT" \
  --sql "$SQL" \
  --stamp "$STAMP"
mismatches=$?
set -e

rm -f "$RAW_JSON"

echo
cat "$OUT"
echo
echo "Results written to: $OUT"

if [[ -f "$SQL" ]]; then
  echo "MISMATCH detected ($mismatches reconciliation(s))."
  echo "Row-level diff query written to: $SQL"
fi

# Non-zero exit if the run errored or any reconciliation mismatched.
if [[ "$run_status" -ne 0 || "$mismatches" -ne 0 ]]; then
  exit 1
fi
exit 0
