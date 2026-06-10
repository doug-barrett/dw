@id("dim-calendar-001")
@nodeType("455")
SELECT
    CALENDAR_DATE @isBusinessKey,
    YEAR,
    MONTH,
    MONTH_NAME,
    DAY_OF_MONTH,
    DAY_OF_WEEK,
    WEEK_OF_YEAR,
    DAY_OF_YEAR,
    QTR_OF_YEAR
FROM {{ ref("SILVER", "STG_CALENDAR") }}
