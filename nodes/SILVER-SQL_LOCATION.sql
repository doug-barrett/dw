@id("silver-sql-location-001")
@nodeType("456")
SELECT
  LOCATION_ID,
  BOROUGH,
  ZONE,
  SERVICE_ZONE,
  FILENAME
FROM {{ ref("BRONZE", "LOCATION") }}
