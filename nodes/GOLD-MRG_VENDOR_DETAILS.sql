@id("gold-mrg-vendor-details-001")
@nodeType("455")
SELECT
  VENDOR_ID @isBusinessKey,
  HQ_ADDRESS_DETAILS,
  PHONE,
  DRIVERS
FROM {{ ref("SILVER", "SQL_VENDOR_DETAILS") }}
