@id("stg-payment-type-001")
@nodeType("456")
SELECT
    PAYMENT_TYPE_ID,
    PAYMENT_TYPE
FROM {{ ref("BRONZE", "PAYMENT_TYPE") }}
