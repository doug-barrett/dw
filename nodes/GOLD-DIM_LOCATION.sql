@id("dim-location-001")
@nodeType("455")
SELECT
    LOCATION_ID @isBusinessKey,
    BOROUGH,
    ZONE,
    SERVICE_ZONE
FROM {{ ref("SILVER", "STG_LOCATION") }}
