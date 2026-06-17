@id("stg-base-vendor")
@nodeType("456")
SELECT
    VENDOR_ID,
    VENDOR_NAME
FROM {{ ref("BRONZE", "VENDOR") }}
