@id("38a6b9e9-cd50-4947-9f8e-f91c3049cb51")
@nodeType("SQL:::SQLWork")

WITH C AS (

SELECT
     "RATE_CODE_ID" AS "RATE_CODE_ID",
     "RATE_CODE" AS "RATE_CODE",
     CAST("RATE_CODE_ID" AS NUMBER) AS "RATE_CODE_NUM",

     -- Cleaned / standardized label
     INITCAP(TRIM("RATE_CODE")) AS "RATE_CODE_CLEAN",

     -- Human-readable description (NYC TLC standard rate codes 1-6)
     CASE CAST("RATE_CODE_ID" AS NUMBER)
          WHEN 1 THEN 'Standard Rate'
          WHEN 2 THEN 'JFK'
          WHEN 3 THEN 'Newark'
          WHEN 4 THEN 'Nassau or Westchester'
          WHEN 5 THEN 'Negotiated Fare'
          WHEN 6 THEN 'Group Ride'
          ELSE 'Unknown'
     END AS "RATE_CODE_DESC",

     -- High-level category grouping
     CASE
          WHEN CAST("RATE_CODE_ID" AS NUMBER) IN (2, 3) THEN 'Airport'
          WHEN CAST("RATE_CODE_ID" AS NUMBER) = 5 THEN 'Negotiated'
          WHEN CAST("RATE_CODE_ID" AS NUMBER) = 6 THEN 'Shared'
          WHEN CAST("RATE_CODE_ID" AS NUMBER) IN (1, 4) THEN 'Metered'
          ELSE 'Other'
     END AS "RATE_CODE_CATEGORY",

     -- Convenience flags for downstream filtering
     CASE WHEN CAST("RATE_CODE_ID" AS NUMBER) IN (2, 3) THEN 'Y' ELSE 'N' END AS "IS_AIRPORT_RATE_FLAG",
     CASE WHEN CAST("RATE_CODE_ID" AS NUMBER) = 5 THEN 'Y' ELSE 'N' END AS "IS_NEGOTIATED_FLAG",
     CASE WHEN CAST("RATE_CODE_ID" AS NUMBER) BETWEEN 1 AND 6 THEN 'Y' ELSE 'N' END AS "IS_VALID_RATE_FLAG"
FROM {{ ref('BRONZE', 'RATE_CODE') }}
)


SELECT * FROM C WHERE 1 = 1