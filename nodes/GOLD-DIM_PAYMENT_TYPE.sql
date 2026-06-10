@id("dim-payment-type-001")
@nodeType("455")
SELECT
    PAYMENT_TYPE_ID @isBusinessKey,
    PAYMENT_TYPE
FROM {{ ref("SILVER", "STG_PAYMENT_TYPE") }}
