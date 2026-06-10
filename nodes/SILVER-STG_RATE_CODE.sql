@id("stg-rate-code-001")
@nodeType("456")
SELECT
    RATE_CODE_ID,
    RATE_CODE
FROM {{ ref("BRONZE", "RATE_CODE") }}
