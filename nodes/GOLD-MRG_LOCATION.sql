@id("gold-mrg-location-001")
@nodeType("455")
SELECT
  LOCATION_ID @isBusinessKey,
  BOROUGH,
  ZONE,
  SERVICE_ZONE,
  FILENAME
FROM {{ ref("SILVER", "SQL_LOCATION") }}
