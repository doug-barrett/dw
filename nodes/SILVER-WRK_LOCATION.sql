@id("74fde037-3259-4220-8d5e-0b4e2b76c6da")
@nodeType("BaseSQL:::707")
@tests("SELECT 1 FROM {{this}} WHERE ZONE IS NULL", true, "After")
@tests("SELECT 1 FROM {{this}} WHERE SERVICE_ZONE IS NULL", true, "After")
SELECT
     "LOCATION_ID" AS "LOCATION_ID",
     "BOROUGH" AS "BOROUGH",
     "ZONE" AS "ZONE",
     "SERVICE_ZONE" AS "SERVICE_ZONE",
     "FILENAME" AS "FILENAME"
FROM {{ ref('BRONZE', 'LOCATION') }} "LOCATION"