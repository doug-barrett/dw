@id("a1b2c3d4-0008-4000-8000-000000000008")
@nodeType("456")
SELECT
    "VLA"."VENDOR_ID"                                                           AS "VENDOR_ID",
    LISTAGG(
        "VLA"."ZONE" || ' ($' || TO_CHAR("VLA"."LOC_FARE_AMOUNT_7", '9,999,999.00') || ')',
        ', '
    ) WITHIN GROUP (ORDER BY "VLA"."LOC_FARE_AMOUNT_7" DESC)                   AS "TOP_5_ZONES"
FROM {{ ref('SILVER', 'STG_VENDOR_LOCATION_ACTIVITY_7') }} "VLA"
GROUP BY 1
