@id("2b0f6db7-7695-467e-ab01-e1ff515941bc")
@nodeType("SQL:::SQLDimension")
SELECT
    0                                        AS "DIM_LOCATION_KEY"    @id("4e4a3a") @isSurrogateKey,
    "LOCATION_ID"                            AS "LOCATION_ID"         @id("9f9479"),
    "BOROUGH"                                AS "BOROUGH"             @id("f8eaa3"),
    "ZONE"                                   AS "ZONE"                @id("513133"),
    "SERVICE_ZONE"                           AS "SERVICE_ZONE"        @id("904d95"),
    "FILENAME"                               AS "FILENAME"            @id("ea34cb"),
    1                                        AS "SYSTEM_VERSION"      @id("0342fd") @isSystemVersion,
    'Y'                                      AS "SYSTEM_CURRENT_FLAG" @id("0f39ea") @isSystemCurrentFlag,
    CAST(CURRENT_TIMESTAMP AS TIMESTAMP)     AS "SYSTEM_CREATE_DATE"  @id("1f5503") @isSystemCreateDate,
    CAST(CURRENT_TIMESTAMP AS TIMESTAMP)     AS "SYSTEM_UPDATE_DATE"  @id("d81eb4") @isSystemUpdateDate,
    CAST('2999-12-31 00:00:00' AS TIMESTAMP) AS "SYSTEM_END_DATE"     @id("e0f8db") @isSystemEndDate
FROM {{ ref('BRONZE', 'LOCATION') }} "LOCATION"