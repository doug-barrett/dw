@id("silver-sql-vendor-details-001")
@nodeType("456")
SELECT
  VENDOR_ID,
  HQ_ADDRESS_DETAILS,
  PHONE,
  DRIVERS
FROM {{ ref("BRONZE", "VENDOR_DETAILS") }}
