@id("a099c0a8-ed3d-4a5b-808a-8d4c44f0eb04")
@nodeType("SQL:::SQLDimension")
SELECT
    0                                        AS "DIM_VENDOR_KEY"      @id("8d0ffc") @isSurrogateKey,
    "VENDOR_ID"                              AS "VENDOR_ID"           @id("efe987") @isBusinessKey,
    "VENDOR_NAME"                            AS "VENDOR_NAME"         @id("b909ee"),
    1                                        AS "SYSTEM_VERSION"      @id("ec500b") @isSystemVersion,
    'Y'                                      AS "SYSTEM_CURRENT_FLAG" @id("ef97e2") @isSystemCurrentFlag,
    CAST(CURRENT_TIMESTAMP AS TIMESTAMP)     AS "SYSTEM_CREATE_DATE"  @id("78d43d") @isSystemCreateDate,
    CAST(CURRENT_TIMESTAMP AS TIMESTAMP)     AS "SYSTEM_UPDATE_DATE"  @id("7b0eb5") @isSystemUpdateDate,
    CAST('2999-12-31 00:00:00' AS TIMESTAMP) AS "SYSTEM_END_DATE"     @id("181e0b") @isSystemEndDate
FROM {{ ref('SILVER', 'WRK_VENDOR') }} "WRK_VENDOR"