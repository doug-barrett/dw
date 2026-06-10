@id("stg-drivers-001")
@nodeType("456")
SELECT
    DRIVER_ID,
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
FROM {{ ref("BRONZE", "DRIVERS") }}
