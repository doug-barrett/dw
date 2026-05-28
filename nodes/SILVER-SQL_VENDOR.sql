@id("silver-sql-vendor-001")
@nodeType("sqlstage")
SELECT
  VENDOR_ID,
  VENDOR_NAME
FROM {{ ref("BRONZE", "VENDOR") }}
