@id("a1b2c3d4-0003-4000-8000-000000000003")
@nodeType("456")
SELECT
    "VD"."VENDOR_ID"                                         AS "VENDOR_ID",
    REGEXP_REPLACE("VD"."PHONE", '[^0-9]', '')               AS "PHONE_DIGITS",
    "VD"."DRIVERS"                                           AS "DRIVERS",
    "VD"."HQ_ADDRESS1"                                       AS "HQ_ADDRESS1",
    "VD"."HQ_CITY"                                           AS "HQ_CITY",
    "VD"."HQ_STATE"                                          AS "HQ_STATE",
    "VD"."HQ_COUNTRY"                                        AS "HQ_COUNTRY",
    "VD"."HQ_ZIP"                                            AS "HQ_ZIP"
FROM {{ ref('SILVER', 'STG_VENDOR_DETAILS') }} "VD"
