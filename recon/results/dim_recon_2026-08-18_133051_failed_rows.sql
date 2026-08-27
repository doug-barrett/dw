-- Diff queries for mismatched reconciliations
-- Suite: all_dims_vs_bronze.suite.yaml
-- Generated with results 2026-08-18_133051
-- Run these to see exactly which rows differ.

--------------------------------------------------------------------------
-- Reconciliation: dim-vendor
--   Source: NY_TAXI.BRONZE.VENDOR
--   Target: DOUG_DB.DEV_GOLD.DIM_VENDOR
--   Key(s): VENDOR_ID
--   Compared (hashed) columns: VENDOR_NAME
-- Returns rows present on only one side, or where the compared-column hash
-- differs between source and target.
--------------------------------------------------------------------------
WITH src AS (
    SELECT
        "VENDOR_ID",
        MD5(COALESCE(TO_VARCHAR("VENDOR_NAME"), '<NULL>')) AS _row_hash
    FROM NY_TAXI.BRONZE.VENDOR
),
tgt AS (
    SELECT
        "VENDOR_ID",
        MD5(COALESCE(TO_VARCHAR("VENDOR_NAME"), '<NULL>')) AS _row_hash
    FROM DOUG_DB.DEV_GOLD.DIM_VENDOR
)
SELECT
    COALESCE(s."VENDOR_ID", t."VENDOR_ID") AS "VENDOR_ID",
    CASE
        WHEN s."VENDOR_ID" IS NULL THEN 'MISSING_IN_SOURCE'
        WHEN t."VENDOR_ID" IS NULL THEN 'MISSING_IN_TARGET'
        ELSE 'HASH_DIFF'
    END AS diff_type,
    s._row_hash AS source_hash,
    t._row_hash AS target_hash
FROM src s
FULL OUTER JOIN tgt t
  ON s."VENDOR_ID" = t."VENDOR_ID"
WHERE s._row_hash IS DISTINCT FROM t._row_hash
ORDER BY diff_type, 1;


