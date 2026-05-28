@id("silver-sql-payment-type-001")
@nodeType("456")
@materializationType("view")
SELECT
  PAYMENT_TYPE_ID,
  PAYMENT_TYPE
FROM {{ ref("BRONZE", "PAYMENT_TYPE") }}
