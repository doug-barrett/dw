@id("stg-location-001")
@nodeType("456")
SELECT
    LOCATION_ID,
    BOROUGH,
    ZONE,
    SERVICE_ZONE
FROM {{ ref("BRONZE", "LOCATION") }}
