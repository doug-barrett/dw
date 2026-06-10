@id("stg-calendar-001")
@nodeType("456")
SELECT
    CALENDAR_DATE,
    YEAR,
    MONTH,
    MONTH_NAME,
    DAY_OF_MONTH,
    DAY_OF_WEEK,
    WEEK_OF_YEAR,
    DAY_OF_YEAR,
    QTR_OF_YEAR
FROM {{ ref("BRONZE", "CALENDAR") }}
