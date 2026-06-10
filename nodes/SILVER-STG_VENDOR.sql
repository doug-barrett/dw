@id("stg-vendor-001")
@nodeType("456")
SELECT
    VENDOR_ID,
    VENDOR_NAME
FROM {{ ref("BRONZE", "VENDOR") }}
