@id("da6cd1ba-326d-4cfb-a1ab-d2cadf947cb5")
@nodeType("446")
@truncateBefore("false")
@materialization("table")
@pre_test("SELECT 1 FROM {{this}} WHERE RATE_CODE_ID < 0 ", "true")
@pre_sql("SELECT 1 FROM {{this}} WHERE RATE_CODE_ID < 0 ")
@post_test("SELECT 1 FROM {{this}} WHERE RATE_CODE_ID < 0 ", "true")
@post_test1("SELECT 1 FROM {{this}} WHERE RATE_CODE_ID < 0 ", "true")

SELECT
     "RATE_CODE_ID" AS "RATE_CODE_ID",
     "RATE_CODE" AS "RATE_CODE"
FROM {{ ref('BRONZE', 'RATE_CODE') }} "RATE_CODE"