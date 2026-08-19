#!/usr/bin/env python3
"""
Helper for run_dim_recon.sh.

Reads synq-recon JSON results + the suite config + the connections file, writes
a human-readable results .txt, and — for any reconciliation that MISMATCHED
whose source and target connections are the SAME type (currently Snowflake) —
appends a diagnostic SQL query to a .sql file. The query FULL OUTER JOINs source
and target on the key column(s) and returns the rows whose hash of the compared
columns differs (or that are missing on one side).

Usage:
  gen_diff_sql.py --suite S --results J --connections C --txt T --sql Q --stamp STAMP
Exit code: number of mismatched reconciliations (0 = all matched).
"""
import argparse, json, sys
import yaml


def conn_types(conn_path):
    """connection name -> dialect (the single sub-key, e.g. 'snowflake')."""
    try:
        doc = yaml.safe_load(open(conn_path)) or {}
    except FileNotFoundError:
        return {}
    out = {}
    for name, cfg in (doc.get("connections") or {}).items():
        if isinstance(cfg, dict) and cfg:
            out[name] = next(iter(cfg.keys()))
    return out


def key_cols(rec):
    if rec.get("key_columns"):
        return list(rec["key_columns"])
    if rec.get("key_column"):
        return [rec["key_column"]]
    return []


def snowflake_diff_sql(rid, src, tgt, keys, compared):
    """Build a Snowflake FULL OUTER JOIN diff query for one reconciliation."""
    hash_cols = [c for c in compared if c not in keys] or compared

    def hash_expr(alias_none=True):
        parts = " || '~|~' || ".join(
            f"COALESCE(TO_VARCHAR(\"{c}\"), '<NULL>')" for c in hash_cols
        )
        return f"MD5({parts})"

    def sel_keys():
        return ",\n        ".join(f'"{k}"' for k in keys)

    src_tbl = src["table"]
    tgt_tbl = tgt["table"]
    k0 = keys[0]
    join_on = "\n      AND ".join(f's."{k}" = t."{k}"' for k in keys)
    coalesced_keys = ",\n    ".join(
        f'COALESCE(s."{k}", t."{k}") AS "{k}"' for k in keys
    )

    return f"""\
--------------------------------------------------------------------------
-- Reconciliation: {rid}
--   Source: {src_tbl}
--   Target: {tgt_tbl}
--   Key(s): {', '.join(keys)}
--   Compared (hashed) columns: {', '.join(hash_cols)}
-- Returns rows present on only one side, or where the compared-column hash
-- differs between source and target.
--------------------------------------------------------------------------
WITH src AS (
    SELECT
        {sel_keys()},
        {hash_expr()} AS _row_hash
    FROM {src_tbl}
),
tgt AS (
    SELECT
        {sel_keys()},
        {hash_expr()} AS _row_hash
    FROM {tgt_tbl}
)
SELECT
    {coalesced_keys},
    CASE
        WHEN s."{k0}" IS NULL THEN 'MISSING_IN_SOURCE'
        WHEN t."{k0}" IS NULL THEN 'MISSING_IN_TARGET'
        ELSE 'HASH_DIFF'
    END AS diff_type,
    s._row_hash AS source_hash,
    t._row_hash AS target_hash
FROM src s
FULL OUTER JOIN tgt t
  ON {join_on}
WHERE s._row_hash IS DISTINCT FROM t._row_hash
ORDER BY diff_type, 1;
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", required=True)
    ap.add_argument("--results", required=True)
    ap.add_argument("--connections", required=True)
    ap.add_argument("--txt", required=True)
    ap.add_argument("--sql", required=True)
    ap.add_argument("--stamp", required=True)
    a = ap.parse_args()

    suite = yaml.safe_load(open(a.suite))
    recs = suite.get("reconciliations", {})
    ctypes = conn_types(a.connections)
    results = json.load(open(a.results))
    by_name = {r["name"]: r for r in results.get("results", [])}
    summ = results.get("summary", {})

    # ---- human-readable results file -------------------------------------
    lines = []
    lines.append("=" * 58)
    lines.append(f"Dimension reconciliation results")
    lines.append(f"Suite : {a.suite}")
    lines.append(f"Stamp : {a.stamp}")
    lines.append("=" * 58)
    lines.append("")
    hdr = f"{'RECONCILIATION':<26}{'SOURCE':>10}{'TARGET':>10}  STATUS"
    lines.append(hdr)
    lines.append("-" * len(hdr))
    for rid in recs:
        r = by_name.get(rid, {})
        status = "MATCH" if r.get("match") else ("MISMATCH" if r else "MISSING")
        sc = r.get("source_count", "?")
        tc = r.get("target_count", "?")
        lines.append(f"{rid:<26}{str(sc):>10}{str(tc):>10}  {status}")
    lines.append("")
    lines.append(
        f"Total: {summ.get('total','?')}, Matched: {summ.get('matched','?')}, "
        f"Mismatched: {summ.get('mismatched','?')}, Errors: {summ.get('errors','?')}"
    )
    open(a.txt, "w").write("\n".join(lines) + "\n")

    # ---- diff SQL for mismatches -----------------------------------------
    mismatched = [rid for rid in recs if rid in by_name and not by_name[rid].get("match")]
    if not mismatched:
        return 0

    blocks = [
        f"-- Diff queries for mismatched reconciliations",
        f"-- Suite: {a.suite}",
        f"-- Generated with results {a.stamp}",
        f"-- Run these to see exactly which rows differ.",
        "",
    ]
    for rid in mismatched:
        rec = recs[rid]
        src, tgt = rec["source"], rec["target"]
        st = ctypes.get(src.get("connection"))
        tt = ctypes.get(tgt.get("connection"))
        keys = key_cols(rec)
        compared = src.get("columns") or tgt.get("columns") or []
        if st != tt:
            blocks.append(
                f"-- [{rid}] SKIPPED: source ({st}) and target ({tt}) are different "
                f"connection types; no cross-type diff query generated.\n"
            )
            continue
        if st != "snowflake":
            blocks.append(
                f"-- [{rid}] SKIPPED: diff-SQL generation only implemented for "
                f"Snowflake (connection type '{st}').\n"
            )
            continue
        if not keys:
            blocks.append(f"-- [{rid}] SKIPPED: no key column(s) defined.\n")
            continue
        if not compared:
            blocks.append(f"-- [{rid}] SKIPPED: no explicit compared columns.\n")
            continue
        blocks.append(snowflake_diff_sql(rid, src, tgt, keys, compared))
        blocks.append("")

    open(a.sql, "w").write("\n".join(blocks) + "\n")
    return len(mismatched)


if __name__ == "__main__":
    sys.exit(main())
