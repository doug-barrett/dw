@id("dim-rate-code-001")
@nodeType("455")
SELECT
    RATE_CODE_ID @isBusinessKey,
    RATE_CODE
FROM {{ ref("SILVER", "STG_RATE_CODE") }}
