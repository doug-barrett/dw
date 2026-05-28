@id("silver-sql-payment-type-001")
@nodeType("457")
SELECT
  PAYMENT_TYPE_ID,
  PAYMENT_TYPE
FROM {{ ref("BRONZE", "PAYMENT_TYPE") }}
