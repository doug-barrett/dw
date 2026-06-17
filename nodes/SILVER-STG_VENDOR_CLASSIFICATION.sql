@id("a1b2c3d4-0005-4000-8000-000000000005")
@nodeType("456")
SELECT
    "FV"."VENDOR_ID"      AS "VENDOR_ID",
    "FV"."VENDOR_NAME"    AS "VENDOR_NAME",
    "FV"."PHONE_DIGITS"   AS "PHONE_DIGITS",
    "FV"."DRIVERS"        AS "DRIVERS",
    "FV"."HQ_ADDRESS1"    AS "HQ_ADDRESS1",
    "FV"."HQ_CITY"        AS "HQ_CITY",
    "FV"."HQ_STATE"       AS "HQ_STATE",
    "FV"."HQ_COUNTRY"     AS "HQ_COUNTRY",
    "FV"."HQ_ZIP"         AS "HQ_ZIP",
    CASE
        WHEN "FV"."DRIVERS" >= 200 THEN 'ENTERPRISE'
        WHEN "FV"."DRIVERS" >= 50  THEN 'MID_SIZE'
        ELSE 'SMALL'
    END                   AS "VENDOR_TIER",
    CASE
        WHEN "FV"."HQ_COUNTRY" = 'USA' THEN 'DOMESTIC'
        ELSE 'INTERNATIONAL'
    END                   AS "MARKET_TYPE"
FROM {{ ref('SILVER', 'STG_FULL_VENDOR') }} "FV"
