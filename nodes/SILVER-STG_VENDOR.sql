@id("fb4f3b70-4ba8-4c00-be3e-f198fa7abc8f")
@nodeType("446")


WITH base_vendor AS (

    SELECT
        VENDOR_ID,
        VENDOR_NAME
    FROM {{ref('BRONZE','VENDOR')}}

),

vendor_details AS (

    SELECT
        VENDOR_ID,
        PHONE,
        DRIVERS,
        HQ_ADDRESS_DETAILS:ADDRESS::STRING HQ_ADDRESS1,
        HQ_ADDRESS_DETAILS:CITY::STRING HQ_CITY,
        HQ_ADDRESS_DETAILS:STATE::STRING HQ_STATE,
        HQ_ADDRESS_DETAILS:COUNTRY::STRING HQ_COUNTRY,
        HQ_ADDRESS_DETAILS:ZIP::STRING HQ_ZIP
    FROM {{ref('BRONZE','VENDOR_DETAILS')}}

),

vendor_clean_phone AS (

    SELECT
        VENDOR_ID,
        REGEXP_REPLACE(PHONE, '[^0-9]', '') AS PHONE_DIGITS,
        DRIVERS,
        HQ_ADDRESS1,
        HQ_CITY,
        HQ_STATE,
        HQ_COUNTRY,
        HQ_ZIP
    FROM vendor_details

),


full_vendor AS (
    SELECT * 
    FROM base_vendor 
    JOIN vendor_clean_phone USING (VENDOR_ID)
),

vendor_classification AS (

    SELECT
        *,
        CASE 
            WHEN DRIVERS >= 200 THEN 'ENTERPRISE'
            WHEN DRIVERS >= 50 THEN 'MID_SIZE'
            ELSE 'SMALL'
        END AS VENDOR_TIER,
        CASE
            WHEN HQ_COUNTRY = 'USA' THEN 'DOMESTIC'
            ELSE 'INTERNATIONAL'
        END AS MARKET_TYPE
    FROM full_vendor

),

vendor_activity_7 as (
    SELECT  VENDOR_ID, 
            COUNT(1) TRIP_COUNT_7,
            SUM(TRIP_DISTANCE) TRIP_DISTANCE_7,
            SUM(FARE_AMOUNT) FARE_AMOUNT_7,
            RANK() OVER (ORDER BY SUM(FARE_AMOUNT) DESC) AS RANK_FARE_7,
            RANK() OVER (ORDER BY SUM(TRIP_DISTANCE) DESC) AS RANK_DISTANCE_7
            
    FROM {{ref('BRONZE','YELLOW_CAB_TRIPS')}}
    JOIN {{ref('BRONZE','LOCATION')}} ON YELLOW_CAB_TRIPS.PU_LOCATION_ID = LOCATION.LOCATION_ID
    WHERE TO_DATE(PICKUP_DATETIME) BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE
    GROUP BY 1
), 

vendor_location_activity_7 as (
    SELECT 
        YELLOW_CAB_TRIPS.VENDOR_ID,
        LOCATION.ZONE, 
        SUM(FARE_AMOUNT) LOC_FARE_AMOUNT_7, 
        COUNT(1) LOC_TRIP_COUNT_7
    FROM {{ref('BRONZE','YELLOW_CAB_TRIPS')}}
    JOIN {{ref('BRONZE','LOCATION')}} ON YELLOW_CAB_TRIPS.PU_LOCATION_ID = LOCATION.LOCATION_ID
    WHERE TO_DATE(PICKUP_DATETIME) BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE
    GROUP BY 1, 2
    QUALIFY ROW_NUMBER() OVER (PARTITION BY YELLOW_CAB_TRIPS.VENDOR_ID, LOCATION.ZONE ORDER BY SUM(FARE_AMOUNT) DESC) <= 5
), 

vendor_location_summary_7 as (
    SELECT  VENDOR_ID, 
            LISTAGG(ZONE || ' ($' || TO_CHAR(LOC_FARE_AMOUNT_7,'9,999,999.00')||')', ', ') WITHIN GROUP (ORDER BY LOC_FARE_AMOUNT_7 DESC) AS TOP_5_ZONES
    FROM vendor_location_activity_7
    GROUP BY 1
)

SELECT
    *
FROM vendor_classification
JOIN vendor_activity_7 USING (VENDOR_ID)
JOIN vendor_location_summary_7 USING (VENDOR_ID)
ORDER BY RANK_FARE_7