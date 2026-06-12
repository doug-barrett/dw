@id("vendor-trip-summary-001")
@nodeType("456")
SELECT
    vc.*,
    va.TRIP_COUNT_7,
    va.TRIP_DISTANCE_7,
    va.FARE_AMOUNT_7,
    va.RANK_FARE_7,
    va.RANK_DISTANCE_7,
    vz.TOP_5_ZONES
FROM {{ ref("SILVER", "STG_VENDOR_ENRICHED") }} vc
JOIN {{ ref("SILVER", "STG_VENDOR_ACTIVITY_7") }} va ON vc.VENDOR_ID = va.VENDOR_ID
JOIN {{ ref("SILVER", "STG_VENDOR_TOP_ZONES_7") }} vz ON vc.VENDOR_ID = vz.VENDOR_ID
ORDER BY va.RANK_FARE_7
