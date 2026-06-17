@id("a1b2c3d4-0002-4000-8000-000000000002")
@nodeType("456")
SELECT
    "VD"."VENDOR_ID"                              AS "VENDOR_ID",
    "VD"."PHONE"                                  AS "PHONE",
    "VD"."DRIVERS"                                AS "DRIVERS",
    "VD"."HQ_ADDRESS_DETAILS":ADDRESS::STRING     AS "HQ_ADDRESS1",
    "VD"."HQ_ADDRESS_DETAILS":CITY::STRING        AS "HQ_CITY",
    "VD"."HQ_ADDRESS_DETAILS":STATE::STRING       AS "HQ_STATE",
    "VD"."HQ_ADDRESS_DETAILS":COUNTRY::STRING     AS "HQ_COUNTRY",
    "VD"."HQ_ADDRESS_DETAILS":ZIP::STRING         AS "HQ_ZIP"
FROM {{ ref('BRONZE', 'VENDOR_DETAILS') }} "VD"
