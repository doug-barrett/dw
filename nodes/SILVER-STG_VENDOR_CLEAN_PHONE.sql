@id("stg-vendor-clean-phone")
@nodeType("456")
SELECT
    VENDOR_ID,
    REGEXP_REPLACE(PHONE, '[^0-9]', '') AS PHONE_DIGITS,
    DRIVERS,
    HQ_ADDRESS1,
    HQ_CITY,
    HQ_STATE,
    HQ_COUNTRY,
    HQ_ZIP
FROM {{ ref("SILVER", "STG_VENDOR_DETAILS") }}
