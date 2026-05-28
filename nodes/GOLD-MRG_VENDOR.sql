@id("gold-mrg-vendor-001")
@nodeType("455")
SELECT
  VENDOR_ID @isBusinessKey,
  VENDOR_NAME
FROM {{ ref("SILVER", "SQL_VENDOR") }}
