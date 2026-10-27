@id("b816b8c2-cb68-4619-b949-1842a705d1ab")
@nodeType("SQL:::SQLDimension")
SELECT
    0                                        AS "DIM_LOCATION_KEY"    @id("9e6f91") @isSurrogateKey,
    "LOCATION_ID"                            AS "LOCATION_ID"         @id("27e2a2") @isBusinessKey,
    "BOROUGH"                                AS "BOROUGH"             @id("a86455"),
    "ZONE"                                   AS "ZONE"                @id("107e74"),
    "SERVICE_ZONE"                           AS "SERVICE_ZONE"        @id("27973d"),
    "FILENAME"                               AS "FILENAME"            @id("3bfbaa"),
    1                                        AS "SYSTEM_VERSION"      @id("96129d") @isSystemVersion,
    'Y'                                      AS "SYSTEM_CURRENT_FLAG" @id("9070fc") @isSystemCurrentFlag,
    CAST(CURRENT_TIMESTAMP AS TIMESTAMP)     AS "SYSTEM_CREATE_DATE"  @id("347a0e") @isSystemCreateDate,
    CAST(CURRENT_TIMESTAMP AS TIMESTAMP)     AS "SYSTEM_UPDATE_DATE"  @id("ba81f5") @isSystemUpdateDate,
    CAST('2999-12-31 00:00:00' AS TIMESTAMP) AS "SYSTEM_END_DATE"     @id("9f3d37") @isSystemEndDate
FROM {{ ref('SILVER', 'WRK_LOCATION') }} "WRK_LOCATION"