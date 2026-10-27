@id("3969d9ad-7cfe-4ddf-8e3a-833b3466c5c3")
@nodeType("SQL:::SQLDimension")
SELECT
    0                                        AS "DIM_PAYMENT_TYPE_KEY" @id("8ea297") @isSurrogateKey,
    "PAYMENT_TYPE_ID"                        AS "PAYMENT_TYPE_ID"      @id("6d9410") @isBusinessKey,
    "PAYMENT_TYPE"                           AS "PAYMENT_TYPE"         @id("48d1d9"),
    1                                        AS "SYSTEM_VERSION"       @id("fa4810") @isSystemVersion,
    'Y'                                      AS "SYSTEM_CURRENT_FLAG"  @id("14dc39") @isSystemCurrentFlag,
    CAST(CURRENT_TIMESTAMP AS TIMESTAMP)     AS "SYSTEM_CREATE_DATE"   @id("303e4c") @isSystemCreateDate,
    CAST(CURRENT_TIMESTAMP AS TIMESTAMP)     AS "SYSTEM_UPDATE_DATE"   @id("aef282") @isSystemUpdateDate,
    CAST('2999-12-31 00:00:00' AS TIMESTAMP) AS "SYSTEM_END_DATE"      @id("702ddc") @isSystemEndDate
FROM {{ ref('SILVER', 'WRK_PAYMENT_TYPE') }} "WRK_PAYMENT_TYPE"