@id("eea28880-256e-4e85-b0be-074301214bf1")
@nodeType("SQL:::SQLDimension")
SELECT
    0                                        AS "DIM_RATE_CODE_KEY"   @id("13f5d7") @isSurrogateKey,
    "RATE_CODE_ID"                           AS "RATE_CODE_ID"        @id("89499f") @isBusinessKey,
    "RATE_CODE"                              AS "RATE_CODE"           @id("bdc045"),
    1                                        AS "SYSTEM_VERSION"      @id("cf7d95") @isSystemVersion,
    'Y'                                      AS "SYSTEM_CURRENT_FLAG" @id("106567") @isSystemCurrentFlag,
    CAST(CURRENT_TIMESTAMP AS TIMESTAMP)     AS "SYSTEM_CREATE_DATE"  @id("d7e952") @isSystemCreateDate,
    CAST(CURRENT_TIMESTAMP AS TIMESTAMP)     AS "SYSTEM_UPDATE_DATE"  @id("3b6893") @isSystemUpdateDate,
    CAST('2999-12-31 00:00:00' AS TIMESTAMP) AS "SYSTEM_END_DATE"     @id("57d51d") @isSystemEndDate
FROM {{ ref('SILVER', 'WRK_RATE_CODE') }} "WRK_RATE_CODE"