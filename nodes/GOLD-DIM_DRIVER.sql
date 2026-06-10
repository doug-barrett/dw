@id("dim-driver-001")
@nodeType("455")
SELECT
    DRIVER_ID @isBusinessKey,
    VENDOR_ID,
    FIRST_NAME,
    LAST_NAME,
    LICENSE_NUMBER,
    LICENSE_EXPIRY,
    PHONE,
    EMAIL,
    HIRE_DATE,
    RATING,
    IS_ACTIVE
FROM {{ ref("SILVER", "STG_DRIVERS") }}
