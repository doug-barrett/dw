@id("dim-vendor-001")
@nodeType("455")
SELECT
    VENDOR_ID @isBusinessKey,
    VENDOR_NAME,
    HQ_ADDRESS_DETAILS,
    PHONE,
    DRIVER_COUNT
FROM {{ ref("SILVER", "STG_VENDOR_DETAILS") }}
