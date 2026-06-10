@id("stg-vendor-details-001")
@nodeType("456")
SELECT
    v.VENDOR_ID,
    v.VENDOR_NAME,
    vd.HQ_ADDRESS_DETAILS,
    vd.PHONE,
    vd.DRIVERS AS DRIVER_COUNT
FROM {{ ref("BRONZE", "VENDOR") }} v
JOIN {{ ref("BRONZE", "VENDOR_DETAILS") }} vd
    ON v.VENDOR_ID = vd.VENDOR_ID
