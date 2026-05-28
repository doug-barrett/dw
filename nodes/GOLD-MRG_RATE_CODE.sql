@id("gold-mrg-rate-code-001")
@nodeType("455")
SELECT
  RATE_CODE_ID @isBusinessKey,
  RATE_CODE
FROM {{ ref("SILVER", "SQL_RATE_CODE") }}
