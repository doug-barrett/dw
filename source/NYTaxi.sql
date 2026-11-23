-- Current DDL for NY_TAXI.SILVER and NY_TAXI.GOLD (via GET_DDL)
USE DATABASE NY_TAXI;


create or replace TABLE STG_DATE (
	CALENDAR_DATE DATE,
	YEAR NUMBER(38,0),
	MONTH NUMBER(38,0),
	MONTH_NAME VARCHAR(3),
	DAY_OF_MONTH NUMBER(38,0),
	DAY_OF_WEEK VARCHAR(9),
	WEEK_OF_YEAR NUMBER(38,0),
	DAY_OF_YEAR NUMBER(38,0),
	QTR_OF_YEAR NUMBER(38,0)
);
create or replace TABLE STG_DRIVER (
	DRIVER_ID NUMBER(38,0),
	VENDOR_ID NUMBER(38,0),
	FIRST_NAME VARCHAR(50),
	LAST_NAME VARCHAR(50),
	FULL_NAME VARCHAR(101),
	LICENSE_NUMBER VARCHAR(10),
	LICENSE_EXPIRY DATE,
	PHONE VARCHAR(14),
	EMAIL VARCHAR(100),
	HIRE_DATE DATE,
	RATING NUMBER(2,1),
	IS_ACTIVE BOOLEAN,
	VENDOR_NAME VARCHAR(16777216),
	TRIP_VENDOR_ID FLOAT,
	TRIP_VENDOR_NAME VARCHAR(33),
	TENURE_YEARS NUMBER(18,2)
);



create or replace TABLE STG_LOCATION (
	LOCATION_ID NUMBER(3,0),
	BOROUGH VARCHAR(16777216),
	ZONE VARCHAR(16777216),
	SERVICE_ZONE VARCHAR(16777216),
	FILENAME VARCHAR(16777216)
);
create or replace TABLE STG_PAYMENT_TYPE (
	PAYMENT_TYPE_ID NUMBER(1,0),
	PAYMENT_TYPE VARCHAR(14)
);
create or replace TABLE STG_RATE_CODE (
	RATE_CODE_ID NUMBER(2,0),
	RATE_CODE VARCHAR(21)
);
create or replace TABLE STG_VENDOR (
	VENDOR_ID NUMBER(38,0),
	VENDOR_NAME VARCHAR(16777216),
	ADDRESS VARCHAR(16777216),
	CITY VARCHAR(16777216),
	COUNTRY VARCHAR(16777216),
	STATE VARCHAR(16777216),
	ZIP VARCHAR(16777216),
	PHONE VARCHAR(14),
	DRIVERS NUMBER(3,0)
);
create or replace TABLE STG_VENDOR1 (
	VENDOR_ID NUMBER(38,0),
	VENDOR_NAME VARCHAR(16777216)
);

create or replace TABLE STG_YELLOW_CAB_TRIPS (
	VENDOR_ID FLOAT,
	PAYMENT_TYPE_ID FLOAT,
	RATE_CODE_ID FLOAT,
	PICKUP_DATETIME TIMESTAMP_TZ(9),
	DROPOFF_DATETIME TIMESTAMP_TZ(9),
	DO_LOCATION_ID FLOAT,
	PU_LOCATION_ID FLOAT,
	TRIP_DISTANCE FLOAT,
	TRIP_DURATION_MINUTES NUMBER(38,0),
	TRIP_AVG_SPEED FLOAT,
	PICKUP_TIME_OF_DAY VARCHAR(16777216),
	AIRPORT_FEE FLOAT,
	CBD_CONGESTION_FEE FLOAT,
	CONGESTION_SURCHARGE FLOAT,
	EXTRA FLOAT,
	FARE_AMOUNT FLOAT,
	IMPROVEMENT_SURCHARGE FLOAT,
	MTA_TAX FLOAT,
	PASSENGER_COUNT FLOAT,
	STORE_AND_FWD_FLAG VARCHAR(16777216),
	TIP_AMOUNT FLOAT,
	TOLLS_AMOUNT FLOAT,
	TOTAL_AMOUNT FLOAT,
	TPEP_PICKUP_DATETIME FLOAT,
	TPEP_DROPOFF_DATETIME FLOAT,
	TRIP_ID NUMBER(18,0),
	COALESCE_RUN_ID NUMBER(38,0)
);
create or replace TABLE STG_YELLOW_CAB_TRIPS1 (
	VENDOR_ID FLOAT,
	VENDOR_NAME VARCHAR(33),
	PAYMENT_TYPE_ID FLOAT,
	PAYMENT_TYPE VARCHAR(14),
	RATE_CODE_ID FLOAT,
	RATE_CODE VARCHAR(21),
	PICKUP_DATETIME TIMESTAMP_TZ(9),
	DROPOFF_DATETIME TIMESTAMP_TZ(9),
	PU_LOCATION_ID FLOAT,
	PU_BOROUGH VARCHAR(16777216),
	DO_LOCATION_ID FLOAT,
	DO_BOROUGH VARCHAR(16777216),
	DIM_PAYMENT_TYPE_KEY NUMBER(38,0),
	DIM_RATE_CODE_KEY NUMBER(38,0),
	DIM_VENDOR_KEY NUMBER(38,0),
	DIM_PICKUP_LOCATION_KEY NUMBER(38,0),
	DIM_DROPOFF_LOCATION_KEY NUMBER(38,0),
	TRIP_DISTANCE FLOAT,
	TRIP_DURATION_MINUTES NUMBER(38,0),
	TRIP_AVG_SPEED FLOAT,
	PICKUP_TIME_OF_DAY VARCHAR(16777216),
	AIRPORT_FEE FLOAT,
	CBD_CONGESTION_FEE FLOAT,
	CONGESTION_SURCHARGE FLOAT,
	EXTRA FLOAT,
	FARE_AMOUNT FLOAT,
	IMPROVEMENT_SURCHARGE FLOAT,
	MTA_TAX FLOAT,
	PASSENGER_COUNT FLOAT,
	STORE_AND_FWD_FLAG VARCHAR(16777216),
	TIP_AMOUNT FLOAT,
	TOLLS_AMOUNT FLOAT,
	TOTAL_AMOUNT FLOAT,
	TRIP_ID NUMBER(18,0),
	COALESCE_RUN_ID NUMBER(38,0)
);
create or replace TABLE STG_YELLOW_CAB_VENDOR_MONTHLY (
	VENDOR_ID FLOAT,
	VENDOR_NAME VARCHAR(33),
	YEAR NUMBER(38,0),
	MONTH NUMBER(38,0),
	TRIP_COUNT NUMBER(38,0),
	TOTAL_AMOUNT NUMBER(12,2),
	TOTAL_AMOUNT_CASH NUMBER(12,2),
	TOTAL_AMOUNT_CC NUMBER(12,2),
	TOTAL_AMOUNT_VOID NUMBER(12,2),
	TRIP_DISTANCE_TOTAL NUMBER(38,0),
	TRIP_DISTANCE_AVG NUMBER(12,2),
	TRIP_DURATION_MINUTES_TOTAL NUMBER(38,0)
);
create or replace view DROPOFF_DATE(
	DATE_KEY,
	CALENDAR_DATE,
	YEAR,
	MONTH,
	MONTH_NAME,
	DAY_OF_MONTH,
	DAY_OF_WEEK,
	WEEK_OF_YEAR,
	DAY_OF_YEAR,
	QTR_OF_YEAR,
	SYSTEM_VERSION,
	SYSTEM_CURRENT_FLAG,
	SYSTEM_START_DATE,
	SYSTEM_END_DATE,
	SYSTEM_CREATE_DATE,
	SYSTEM_UPDATE_DATE
) as
    
        SELECT 
        
            "DIM_DATE"."DATE_KEY" AS "DATE_KEY", 
        
            "DIM_DATE"."CALENDAR_DATE" AS "CALENDAR_DATE", 
        
            "DIM_DATE"."YEAR" AS "YEAR", 
        
            "DIM_DATE"."MONTH" AS "MONTH", 
        
            "DIM_DATE"."MONTH_NAME" AS "MONTH_NAME", 
        
            "DIM_DATE"."DAY_OF_MONTH" AS "DAY_OF_MONTH", 
        
            "DIM_DATE"."DAY_OF_WEEK" AS "DAY_OF_WEEK", 
        
            "DIM_DATE"."WEEK_OF_YEAR" AS "WEEK_OF_YEAR", 
        
            "DIM_DATE"."DAY_OF_YEAR" AS "DAY_OF_YEAR", 
        
            "DIM_DATE"."QTR_OF_YEAR" AS "QTR_OF_YEAR", 
        
            "DIM_DATE"."SYSTEM_VERSION" AS "SYSTEM_VERSION", 
        
            "DIM_DATE"."SYSTEM_CURRENT_FLAG" AS "SYSTEM_CURRENT_FLAG", 
        
            "DIM_DATE"."SYSTEM_START_DATE" AS "SYSTEM_START_DATE", 
        
            "DIM_DATE"."SYSTEM_END_DATE" AS "SYSTEM_END_DATE", 
        
            "DIM_DATE"."SYSTEM_CREATE_DATE" AS "SYSTEM_CREATE_DATE", 
        
            "DIM_DATE"."SYSTEM_UPDATE_DATE" AS "SYSTEM_UPDATE_DATE"
        

        FROM "NY_TAXI"."GOLD"."DIM_DATE" "DIM_DATE";
create or replace view DROPOFF_LOCATION(
	DIM_DROPOFF_LOCATION_KEY,
	LOCATION_ID,
	BOROUGH,
	ZONE,
	SERVICE_ZONE,
	FILENAME,
	SYSTEM_VERSION,
	SYSTEM_CURRENT_FLAG,
	SYSTEM_START_DATE,
	SYSTEM_END_DATE,
	SYSTEM_CREATE_DATE,
	SYSTEM_UPDATE_DATE
) as
    
        SELECT 
        
            "DIM_LOCATION"."DIM_LOCATION_KEY" AS "DIM_DROPOFF_LOCATION_KEY", 
        
            "DIM_LOCATION"."LOCATION_ID" AS "LOCATION_ID", 
        
            "DIM_LOCATION"."BOROUGH" AS "BOROUGH", 
        
            "DIM_LOCATION"."ZONE" AS "ZONE", 
        
            "DIM_LOCATION"."SERVICE_ZONE" AS "SERVICE_ZONE", 
        
            "DIM_LOCATION"."FILENAME" AS "FILENAME", 
        
            "DIM_LOCATION"."SYSTEM_VERSION" AS "SYSTEM_VERSION", 
        
            "DIM_LOCATION"."SYSTEM_CURRENT_FLAG" AS "SYSTEM_CURRENT_FLAG", 
        
            "DIM_LOCATION"."SYSTEM_START_DATE" AS "SYSTEM_START_DATE", 
        
            "DIM_LOCATION"."SYSTEM_END_DATE" AS "SYSTEM_END_DATE", 
        
            "DIM_LOCATION"."SYSTEM_CREATE_DATE" AS "SYSTEM_CREATE_DATE", 
        
            "DIM_LOCATION"."SYSTEM_UPDATE_DATE" AS "SYSTEM_UPDATE_DATE"
        

        FROM "NY_TAXI"."GOLD"."DIM_LOCATION" "DIM_LOCATION";

create or replace view PICKUP_DATE(
	DATE_KEY,
	CALENDAR_DATE,
	YEAR,
	MONTH,
	MONTH_NAME,
	DAY_OF_MONTH,
	DAY_OF_WEEK,
	WEEK_OF_YEAR,
	DAY_OF_YEAR,
	QTR_OF_YEAR,
	SYSTEM_VERSION,
	SYSTEM_CURRENT_FLAG,
	SYSTEM_START_DATE,
	SYSTEM_END_DATE,
	SYSTEM_CREATE_DATE,
	SYSTEM_UPDATE_DATE
) as
    
        SELECT 
        
            "DIM_DATE"."DATE_KEY" AS "DATE_KEY", 
        
            "DIM_DATE"."CALENDAR_DATE" AS "CALENDAR_DATE", 
        
            "DIM_DATE"."YEAR" AS "YEAR", 
        
            "DIM_DATE"."MONTH" AS "MONTH", 
        
            "DIM_DATE"."MONTH_NAME" AS "MONTH_NAME", 
        
            "DIM_DATE"."DAY_OF_MONTH" AS "DAY_OF_MONTH", 
        
            "DIM_DATE"."DAY_OF_WEEK" AS "DAY_OF_WEEK", 
        
            "DIM_DATE"."WEEK_OF_YEAR" AS "WEEK_OF_YEAR", 
        
            "DIM_DATE"."DAY_OF_YEAR" AS "DAY_OF_YEAR", 
        
            "DIM_DATE"."QTR_OF_YEAR" AS "QTR_OF_YEAR", 
        
            "DIM_DATE"."SYSTEM_VERSION" AS "SYSTEM_VERSION", 
        
            "DIM_DATE"."SYSTEM_CURRENT_FLAG" AS "SYSTEM_CURRENT_FLAG", 
        
            "DIM_DATE"."SYSTEM_START_DATE" AS "SYSTEM_START_DATE", 
        
            "DIM_DATE"."SYSTEM_END_DATE" AS "SYSTEM_END_DATE", 
        
            "DIM_DATE"."SYSTEM_CREATE_DATE" AS "SYSTEM_CREATE_DATE", 
        
            "DIM_DATE"."SYSTEM_UPDATE_DATE" AS "SYSTEM_UPDATE_DATE"
        

        FROM "NY_TAXI"."GOLD"."DIM_DATE" "DIM_DATE";
create or replace view PICKUP_LOCATION(
	DIM_PICKUP_LOCATION_KEY,
	LOCATION_ID,
	BOROUGH,
	ZONE,
	SERVICE_ZONE,
	FILENAME,
	SYSTEM_VERSION,
	SYSTEM_CURRENT_FLAG,
	SYSTEM_START_DATE,
	SYSTEM_END_DATE,
	SYSTEM_CREATE_DATE,
	SYSTEM_UPDATE_DATE
) as
    
        SELECT 
        
            "DIM_LOCATION"."DIM_LOCATION_KEY" AS "DIM_PICKUP_LOCATION_KEY", 
        
            "DIM_LOCATION"."LOCATION_ID" AS "LOCATION_ID", 
        
            "DIM_LOCATION"."BOROUGH" AS "BOROUGH", 
        
            "DIM_LOCATION"."ZONE" AS "ZONE", 
        
            "DIM_LOCATION"."SERVICE_ZONE" AS "SERVICE_ZONE", 
        
            "DIM_LOCATION"."FILENAME" AS "FILENAME", 
        
            "DIM_LOCATION"."SYSTEM_VERSION" AS "SYSTEM_VERSION", 
        
            "DIM_LOCATION"."SYSTEM_CURRENT_FLAG" AS "SYSTEM_CURRENT_FLAG", 
        
            "DIM_LOCATION"."SYSTEM_START_DATE" AS "SYSTEM_START_DATE", 
        
            "DIM_LOCATION"."SYSTEM_END_DATE" AS "SYSTEM_END_DATE", 
        
            "DIM_LOCATION"."SYSTEM_CREATE_DATE" AS "SYSTEM_CREATE_DATE", 
        
            "DIM_LOCATION"."SYSTEM_UPDATE_DATE" AS "SYSTEM_UPDATE_DATE"
        

        FROM "NY_TAXI"."GOLD"."DIM_LOCATION" "DIM_LOCATION";

create or replace view V_VENDOR_DETAILS(
	VENDOR_ID,
	ADDRESS,
	CITY,
	COUNTRY,
	STATE,
	ZIP,
	PHONE,
	DRIVERS
) as
    
        SELECT 
        
            "VENDOR_DETAILS"."VENDOR_ID" AS "VENDOR_ID", 
        
            "VENDOR_DETAILS"."HQ_ADDRESS_DETAILS":"ADDRESS"::STRING AS "ADDRESS", 
        
            "VENDOR_DETAILS"."HQ_ADDRESS_DETAILS":"CITY"::STRING AS "CITY", 
        
            "VENDOR_DETAILS"."HQ_ADDRESS_DETAILS":"COUNTRY"::STRING AS "COUNTRY", 
        
            "VENDOR_DETAILS"."HQ_ADDRESS_DETAILS":"STATE"::STRING AS "STATE", 
        
            "VENDOR_DETAILS"."HQ_ADDRESS_DETAILS":"ZIP"::STRING AS "ZIP", 
        
            "VENDOR_DETAILS"."PHONE" AS "PHONE", 
        
            "VENDOR_DETAILS"."DRIVERS" AS "DRIVERS"
        

        FROM "NY_TAXI"."BRONZE"."VENDOR_DETAILS" "VENDOR_DETAILS";
-- ===== GOLD =====

create or replace TABLE DIM_DATE (
	DATE_KEY NUMBER(38,0),
	CALENDAR_DATE DATE,
	YEAR NUMBER(38,0),
	MONTH NUMBER(38,0),
	MONTH_NAME VARCHAR(3),
	DAY_OF_MONTH NUMBER(38,0),
	DAY_OF_WEEK VARCHAR(9),
	WEEK_OF_YEAR NUMBER(38,0),
	DAY_OF_YEAR NUMBER(38,0),
	QTR_OF_YEAR NUMBER(38,0),
	SYSTEM_VERSION NUMBER(38,0),
	SYSTEM_CURRENT_FLAG VARCHAR(16777216),
	SYSTEM_START_DATE TIMESTAMP_NTZ(9),
	SYSTEM_END_DATE TIMESTAMP_NTZ(9),
	SYSTEM_CREATE_DATE TIMESTAMP_NTZ(9),
	SYSTEM_UPDATE_DATE TIMESTAMP_NTZ(9)
);

create or replace TABLE DIM_LOCATION (
	DIM_LOCATION_KEY NUMBER(38,0) autoincrement start 1 increment 1 noorder COMMENT 'Surrogate key for the location dimension. Uniquely identifies each location record. Used as the primary key for the dimension. Enables efficient joins with fact tables like Trip and Payment. Supports location-based reporting and analysis. System-generated during the data warehousing process. Not sourced from any specific source column. Integer value with no inherent business meaning beyond identification. Increments automatically with each new location.',
	LOCATION_ID NUMBER(3,0) COMMENT 'Business key for the location dimension. Identifies each location record. Sourced from LOCATION_ID column in the source data. Used to track location-specific metrics in reports. Helps in identifying unique location. Integer value. No transformations applied. Used for auditing and data reconciliation. Part of the composite key along with other attributes. Enables tracking of changes to location attributes over time.',
	BOROUGH VARCHAR(16777216) COMMENT 'Borough in which the location is situated. Sourced from the BOROUGH column in the source data. Used in location-based analytics and reporting. Helps in understanding the distribution of activity across different boroughs. String value. No transformations applied. Enables filtering and grouping of data by borough. Part of the location''s descriptive information. Essential for geographic segmentation and analysis.',
	ZONE VARCHAR(16777216) COMMENT 'Zone within the borough where the location is situated. Sourced from the ZONE column in the source data. Used in location-based analytics and reporting. Helps in understanding the distribution of activity across different zones. String value. No transformations applied. Enables filtering and grouping of data by zone. Part of the location''s descriptive information. Essential for geographic segmentation and analysis.',
	SERVICE_ZONE VARCHAR(16777216) COMMENT 'Service zone associated with the location. Sourced from the SERVICE_ZONE column in the source data. Used in location-based analytics and reporting. Helps in understanding the distribution of activity across different service zones. String value. No transformations applied. Enables filtering and grouping of data by service zone. Part of the location''s descriptive information. Essential for operational analysis.',
	FILENAME VARCHAR(16777216) COMMENT 'Name of the source file from which the location data was loaded. Sourced from the FILENAME column in the source data. Used for auditing and data lineage purposes. Helps in tracking the origin of the data. String value. No transformations applied. Enables identification of the specific file that contributed to a location record. Useful for troubleshooting and data quality monitoring. Supports data governance efforts.',
	SYSTEM_VERSION NUMBER(38,0) COMMENT 'Version number of the location record. System-generated column. Used for tracking changes to location attributes over time. Integer value. Increments automatically with each update to a location record. Enables historical analysis and auditing of data changes. Supports temporal data warehousing. Not sourced from any specific source column. Essential for maintaining data integrity and consistency. Facilitates point-in-time reporting.',
	SYSTEM_CURRENT_FLAG VARCHAR(16777216) COMMENT 'Flag indicating whether the location record is the most current version. System-generated column. Used for identifying the active location record. String value (''Y'' or ''N''). Enables efficient querying of current location data. Supports real-time reporting and analysis. Not sourced from any specific source column. Essential for maintaining data accuracy and relevance. Simplifies data retrieval for current state analysis.',
	SYSTEM_START_DATE TIMESTAMP_NTZ(9) COMMENT 'Timestamp indicating the start date and time when the location record became active. System-generated column. Used for tracking the effective date of location attributes. Timestamp value. Derived using the CURRENT_TIMESTAMP function. Enables historical analysis and auditing of data changes. Supports temporal data warehousing. Not sourced from any specific source column. Essential for maintaining data integrity and consistency.',
	SYSTEM_END_DATE TIMESTAMP_NTZ(9) COMMENT 'Timestamp indicating the end date and time when the location record became inactive. System-generated column. Used for tracking the expiration date of location attributes. Timestamp value. Defaults to ''2999-12-31 00:00:00'' for current records. Enables historical analysis and auditing of data changes. Supports temporal data warehousing. Not sourced from any specific source column. Essential for maintaining data integrity.',
	SYSTEM_CREATE_DATE TIMESTAMP_NTZ(9) COMMENT 'Timestamp indicating the date and time when the location record was created. System-generated column. Used for auditing and data lineage purposes. Timestamp value. Derived using the CURRENT_TIMESTAMP function. Enables tracking of the creation time of location records. Not sourced from any specific source column. Essential for maintaining data integrity and consistency. Facilitates data governance efforts and troubleshooting.',
	SYSTEM_UPDATE_DATE TIMESTAMP_NTZ(9) COMMENT 'Timestamp indicating the date and time when the location record was last updated. System-generated column. Used for auditing and data lineage purposes. Timestamp value. Derived using the CURRENT_TIMESTAMP function. Enables tracking of the last modification time of location records. Not sourced from any specific source column. Essential for maintaining data integrity and consistency. Facilitates data governance efforts.'
)COMMENT='Locations at Borough and Zone detail around NYC used to identify Pickup and Dropoff locations.  Reference data provided by New York City (NYC) Taxi & Limousine Commission (TLC)'
;
create or replace TABLE DIM_PAYMENT_TYPE (
	DIM_PAYMENT_TYPE_KEY NUMBER(38,0) autoincrement start 1 increment 1 noorder COMMENT 'Surrogate key for Payment Type dimension. Uniquely identifies each payment type record. Used as a foreign key in the FactPayment table to link payments to their respective payment types. Enables efficient querying and reporting on payment data. System-generated during the data warehousing process. Not sourced from any source system. Integer value automatically incremented for each new payment type.',
	PAYMENT_TYPE_ID NUMBER(1,0) COMMENT 'Numeric identifier for payment type. Business key for the Payment Type dimension. Originates from the source system''s Payment_Type table. Used to track and analyze payment preferences. Included in payment analysis dashboards. No transformations applied. Serves as the link between the data warehouse and the source system''s payment type information. Used for auditing and reconciliation purposes.',
	PAYMENT_TYPE VARCHAR(14) COMMENT 'Describes the payment method used. Sourced directly from the source system''s Payment_Type table. Examples include ''Credit Card'', ''Debit Card'', or ''Cash''. Used in payment method analysis reports. Aids in understanding customer payment behavior. No transformations applied. Provides a user-friendly description of the payment type. Essential for business users to interpret payment data accurately.',
	SYSTEM_VERSION NUMBER(38,0) COMMENT 'Tracks the version number of each record in the Payment Type dimension. Automatically generated by the system. Increments with each update to a payment type record. Used for auditing changes. Supports historical analysis. Enables tracking of changes to payment type attributes over time. Not sourced from any source system. Integer value automatically incremented for each update.',
	SYSTEM_CURRENT_FLAG VARCHAR(16777216) COMMENT 'Indicates whether a record is the most current version. System-generated flag. Set to ''Y'' for the current record and ''N'' for historical records. Used in queries to retrieve the latest payment type information. Simplifies data retrieval. Not sourced from any source system. Enables efficient querying of current data. Supports point-in-time analysis.',
	SYSTEM_START_DATE TIMESTAMP_NTZ(9) COMMENT 'Specifies the date and time when a record becomes effective. System-generated timestamp. Indicates the start of the record''s validity period. Used in conjunction with SYSTEM_END_DATE to track changes over time. Supports historical analysis. Defaults to the timestamp when the record was created. Not sourced from any source system. Essential for temporal data analysis.',
	SYSTEM_END_DATE TIMESTAMP_NTZ(9) COMMENT 'Specifies the date and time when a record is no longer effective. System-generated timestamp. Indicates the end of the record''s validity period. Used in conjunction with SYSTEM_START_DATE to track changes over time. Supports historical analysis. Defaults to ''2999-12-31'' for the current record. Not sourced from any source system. Essential for temporal data analysis.',
	SYSTEM_CREATE_DATE TIMESTAMP_NTZ(9) COMMENT 'Records the date and time when a record was initially created. System-generated timestamp. Used for auditing and tracking data lineage. Not sourced from any source system. Provides a historical record of when the data was first introduced into the system. Useful for debugging and identifying data quality issues. No transformations applied. Essential for maintaining data integrity.',
	SYSTEM_UPDATE_DATE TIMESTAMP_NTZ(9) COMMENT 'Records the date and time when a record was last updated. System-generated timestamp. Used for auditing and tracking data changes. Not sourced from any source system. Provides a historical record of when the data was last modified. Useful for identifying data quality issues and understanding data evolution. No transformations applied. Essential for maintaining data integrity.'
)COMMENT='Taxi ride payment types - from a reference dataset provided by New York City (NYC) Taxi & Limousine Commission (TLC)'
;
create or replace TABLE DIM_RATE_CODE (
	DIM_RATE_CODE_KEY NUMBER(38,0) autoincrement start 1 increment 1 noorder,
	RATE_CODE_ID NUMBER(2,0),
	RATE_CODE VARCHAR(21),
	SYSTEM_VERSION NUMBER(38,0),
	SYSTEM_CURRENT_FLAG VARCHAR(16777216),
	SYSTEM_START_DATE TIMESTAMP_NTZ(9),
	SYSTEM_END_DATE TIMESTAMP_NTZ(9),
	SYSTEM_CREATE_DATE TIMESTAMP_NTZ(9),
	SYSTEM_UPDATE_DATE TIMESTAMP_NTZ(9)
)COMMENT='Taxi rate codes for the fare - populated from a reference dataset provided by New York City (NYC) Taxi & Limousine Commission (TLC)'
;
create or replace TABLE DIM_VENDOR (
	DIM_VENDOR_KEY NUMBER(38,0) autoincrement start 1 increment 1 noorder,
	VENDOR_ID NUMBER(38,0),
	VENDOR_NAME VARCHAR(16777216),
	SYSTEM_VERSION NUMBER(38,0),
	SYSTEM_CURRENT_FLAG VARCHAR(16777216),
	SYSTEM_START_DATE TIMESTAMP_NTZ(9),
	SYSTEM_END_DATE TIMESTAMP_NTZ(9),
	SYSTEM_CREATE_DATE TIMESTAMP_NTZ(9),
	SYSTEM_UPDATE_DATE TIMESTAMP_NTZ(9),
	ADDRESS VARCHAR(16777216),
	CITY VARCHAR(16777216),
	COUNTRY VARCHAR(16777216),
	STATE VARCHAR(16777216),
	ZIP VARCHAR(16777216),
	PHONE VARCHAR(14),
	DRIVERS NUMBER(3,0)
)COMMENT='Reference data of all New York City taxi ride vendors'
;

create or replace TABLE FCT_YELLOW_CAB_TRIPS (
	VENDOR_ID FLOAT COMMENT 'Numeric identifier for the vendor. Sourced directly from the original dataset without transformations. Used in vendor performance analysis and cost optimization reports. Links trips to specific taxi companies. Enables the calculation of key performance indicators, such as average trip cost per vendor. Foreign key potentially linking to a vendor dimension table, if available. Useful in understanding market share and vendor efficiency.',
	VENDOR_NAME VARCHAR(33) COMMENT 'Name of the vendor. Extracted directly from the source data without modification. Used for identifying the vendor associated with each taxi trip. Appears in summary reports for operational overviews. Enables grouping and filtering of data by vendor name. Useful for quickly identifying the service provider. Supports analysis of customer satisfaction and service quality across different vendors. No transformations applied.',
	PAYMENT_TYPE_ID FLOAT COMMENT 'Numeric identifier for the payment type used in the taxi trip. Sourced directly from the original dataset. Used in financial analysis to understand payment method trends. Enables the calculation of revenue distribution across different payment types. Foreign key to a payment type dimension table. Aids in fraud detection by identifying unusual payment patterns. No transformations applied.',
	PAYMENT_TYPE VARCHAR(14) COMMENT 'Categorical description of the payment type used for the taxi trip. Sourced directly from the original dataset. Used in customer behavior analysis to understand payment preferences. Enables filtering and grouping of data by payment type. Supports marketing efforts by identifying popular payment methods. Aids in financial reconciliation processes. No transformations applied.',
	RATE_CODE_ID FLOAT COMMENT 'Numeric identifier for the rate code applied to the taxi trip. Sourced directly from the original dataset. Used in pricing analysis to understand the impact of different rate codes on revenue. Enables the calculation of average fare per rate code. Foreign key to a rate code dimension table. Aids in understanding pricing strategy effectiveness. No transformations applied.',
	RATE_CODE VARCHAR(21) COMMENT 'Categorical description of the rate code applied to the taxi trip. Sourced directly from the original dataset. Used in pricing analysis to understand the impact of different rate codes on revenue. Enables filtering and grouping of data by rate code. Supports marketing efforts by identifying popular rate plans. Aids in understanding pricing strategy effectiveness. No transformations applied.',
	PICKUP_DATETIME TIMESTAMP_TZ(9) COMMENT 'Timestamp indicating when the taxi trip began. Sourced directly from the original dataset. Used in time series analysis to understand trip patterns over time. Enables the calculation of peak hours and days for taxi demand. Supports resource allocation and dispatch optimization. Aids in understanding the impact of events on taxi demand. No transformations applied.',
	DROPOFF_DATETIME TIMESTAMP_TZ(9) COMMENT 'Timestamp indicating when the taxi trip ended. Sourced directly from the original dataset. Used in time series analysis to understand trip duration patterns. Enables the calculation of average trip time. Supports traffic analysis and route optimization. Aids in understanding the impact of events on trip duration. No transformations applied.',
	PU_LOCATION_ID FLOAT COMMENT 'Numeric identifier for the pickup location of the taxi trip. Sourced directly from the original dataset. Used in spatial analysis to understand popular pickup locations. Enables the calculation of trip density per location. Foreign key to a location dimension table. Supports geographic targeting for marketing campaigns. Aids in understanding the impact of location on trip demand. No transformations applied.',
	PU_BOROUGH VARCHAR(16777216) COMMENT 'Borough where the taxi trip originated. Sourced directly from the original dataset. Used in geographic analysis to understand trip patterns by borough. Enables the calculation of trip volume per borough. Supports resource allocation and dispatch optimization. Aids in understanding the impact of borough on trip demand. No transformations applied.',
	DO_LOCATION_ID FLOAT COMMENT 'Numeric identifier for the drop-off location of the taxi trip. Sourced directly from the original dataset. Used in spatial analysis to understand popular drop-off locations. Enables the calculation of trip density per location. Foreign key to a location dimension table. Supports geographic targeting for marketing campaigns. Aids in understanding the impact of location on trip demand. No transformations applied.',
	DO_BOROUGH VARCHAR(16777216) COMMENT 'Borough where the taxi trip terminated. Sourced directly from the original dataset. Used in geographic analysis to understand trip patterns by borough. Enables the calculation of trip volume per borough. Supports resource allocation and dispatch optimization. Aids in understanding the impact of borough on trip demand. No transformations applied.',
	DIM_PAYMENT_TYPE_KEY NUMBER(38,0) COMMENT 'Surrogate key for the payment type dimension. Links fact table records to specific payment methods. Used in reports analyzing payment type distribution and revenue per payment type. Foreign key referencing the payment type dimension table. Simplifies querying and improves performance. Maps directly from the payment_type_key column in the source data without transformation.',
	DIM_RATE_CODE_KEY NUMBER(38,0) COMMENT 'Surrogate key for the rate code dimension. Connects fact data to specific rate structures. Enables analysis of trip costs by rate type. Foreign key to the rate code dimension table. Sourced directly from the rate_code_key column. Used in financial reporting to break down revenue by rate code. Aids in identifying the most profitable rate codes.',
	DIM_VENDOR_KEY NUMBER(38,0) COMMENT 'Surrogate key for the vendor dimension. Links fact records to the vendor who provided the trip. Used in vendor performance analysis and payment reconciliation. Foreign key to the vendor dimension table. Maps directly from the vendor_key column in the source data. Allows for detailed reporting on vendor-specific metrics. Essential for understanding vendor contributions.',
	DIM_PICKUP_LOCATION_KEY NUMBER(38,0) COMMENT 'Surrogate key for the pickup location dimension. Links fact records to specific pickup locations. Used in geographic analysis of trip origins. Foreign key to the pickup location dimension table. Maps directly from the pickup_location_key column in the source data. Enables spatial analysis of trip demand. Facilitates location-based service optimization.',
	DIM_DROPOFF_LOCATION_KEY NUMBER(38,0) COMMENT 'Surrogate key for the dropoff location dimension. Links fact records to specific dropoff locations. Used in geographic analysis of trip destinations. Foreign key to the dropoff location dimension table. Maps directly from the dropoff_location_key column in the source data. Enables spatial analysis of trip patterns. Supports location-based marketing initiatives.',
	TRIP_DISTANCE FLOAT COMMENT 'Distance of the trip in miles. Used in calculating per-mile revenue and fuel efficiency metrics. Sourced directly from the trip_distance column. No transformations applied. Included in reports on average trip distance by region and time of day. Helps in understanding travel patterns and optimizing resource allocation. Supports fare calculation analysis.',
	TRIP_DURATION_MINUTES NUMBER(38,0) COMMENT 'Duration of the trip in minutes. Used in calculating hourly revenue and driver utilization metrics. Sourced directly from the trip_duration_minutes column. Calculated from difference in PICKUP_DATETIME and DROPOFF_DATETIME',
	TRIP_AVG_SPEED FLOAT COMMENT 'Average speed of the trip in miles per hour. Used in performance analysis and identifying traffic patterns. Sourced directly from the trip_avg_speed column. Calculated from TRIP DISTANCE divided by TRIP DURATION',
	PICKUP_TIME_OF_DAY VARCHAR(16777216) COMMENT 'Categorization of the pickup time into time of day segments (e.g., morning, afternoon, evening, night). Used in analyzing trip demand by time of day. Sourced directly from the pickup_time_of_day column. Categorization based on CASE statement in staging area',
	AIRPORT_FEE FLOAT COMMENT 'Fee charged for trips originating from or destined to the airport. Used in revenue analysis and understanding airport-related costs. Sourced directly from the airport_fee column. No transformations applied. Included in reports on airport trip revenue. Helps in understanding airport traffic and optimizing airport services. Supports airport contract negotiations.',
	CBD_CONGESTION_FEE FLOAT COMMENT 'Fee charged for trips passing through the central business district (CBD) during peak hours. Used in revenue analysis and understanding congestion-related costs. Sourced directly from the cbd_congestion_fee column. No transformations applied. Included in reports on CBD trip revenue. Helps in understanding congestion impact and optimizing pricing strategies.',
	CONGESTION_SURCHARGE FLOAT COMMENT 'Surcharge applied to trips during periods of high congestion. Used in revenue analysis and understanding congestion-related costs. Sourced directly from the congestion_surcharge column. No transformations applied. Included in reports on congestion surcharge revenue. Helps in understanding congestion impact and optimizing pricing strategies. Supports dynamic pricing models.',
	EXTRA FLOAT COMMENT 'Miscellaneous extra charges associated with the taxi trip. Sourced directly from the source system without transformations. Included in financial reports to provide a detailed breakdown of trip costs. Used in calculating total revenue and identifying potential areas for fee optimization. Helps in understanding the composition of charges beyond the base fare.',
	FARE_AMOUNT FLOAT COMMENT 'Base fare for the taxi trip, before any additional charges. Pulled directly from source data without modification. Used in calculating overall revenue and average trip cost. Essential for financial analysis and reporting. Provides a baseline for understanding the cost of taxi services before surcharges and tips are added.',
	IMPROVEMENT_SURCHARGE FLOAT COMMENT 'Surcharge to support improvements to the transportation system. Directly sourced from source system. Included in total cost calculations and fare analysis. Helps in understanding the impact of surcharges on overall trip expenses. Used in reports detailing revenue allocation and funding for infrastructure projects.',
	MTA_TAX FLOAT COMMENT 'Tax levied by the Metropolitan Transportation Authority (MTA). Sourced directly from source system without transformations. Used in financial reporting to show tax contributions from taxi trips. Essential for compliance and revenue tracking. Helps in understanding the tax component of the total trip cost and its contribution to public funds.',
	PASSENGER_COUNT FLOAT COMMENT 'Number of passengers in the taxi trip. Directly sourced from source system. Used in ridership analysis and demand forecasting. Helps in understanding passenger load patterns and optimizing resource allocation. Included in reports detailing average passengers per trip and peak travel times. Useful for planning and service adjustments.',
	STORE_AND_FWD_FLAG VARCHAR(16777216) COMMENT 'Indicates if the trip record was stored in the vehicle before sending to the vendor. Sourced directly from source system. Used for identifying potential data transmission issues. Included in data quality assessments and system performance monitoring. Helps in understanding data flow and identifying potential delays in reporting. Provides insights into data reliability.',
	TIP_AMOUNT FLOAT COMMENT 'Amount of tip given by the passenger. Sourced directly from source system without transformations. Used in driver compensation analysis and customer satisfaction metrics. Included in reports detailing average tip amounts and tipping patterns. Helps in understanding customer behavior and service quality. Provides insights into income distribution.',
	TOLLS_AMOUNT FLOAT COMMENT 'Total amount of tolls paid during the trip. Sourced directly from source system without transformations. Used in cost analysis and route optimization. Included in reports detailing toll expenses and preferred routes. Helps in understanding the impact of tolls on overall trip costs. Provides insights into travel patterns and infrastructure usage.',
	TOTAL_AMOUNT FLOAT COMMENT 'Total cost of the trip, including fare, taxes, and tips. Sourced directly from source system without transformations. Used in financial reporting and customer billing. Essential for revenue tracking and profitability analysis. Helps in understanding the overall cost of taxi services. Provides a comprehensive view of trip expenses.',
	SYSTEM_CREATE_DATE TIMESTAMP_NTZ(9) COMMENT 'Timestamp representing when the record was created in the data warehouse. System-generated using the current timestamp. Used for auditing and tracking data lineage. Essential for understanding data freshness and identifying potential data quality issues. Helps in monitoring data ingestion processes and ensuring data integrity. Not sourced from an external system.',
	SYSTEM_UPDATE_DATE TIMESTAMP_NTZ(9) COMMENT 'Timestamp representing the last time the record was updated in the data warehouse. System-generated using the current timestamp. Used for auditing and tracking data changes. Essential for understanding data modification history and identifying potential data discrepancies. Helps in monitoring data updates and ensuring data accuracy. Not sourced from an external system.',
	TRIP_ID NUMBER(18,0),
	COALESCE_RUN_ID NUMBER(38,0)
)COMMENT='Taxi ride information for Yellow Cabs in New York.  Provided by New York City (NYC) Taxi & Limousine Commission (TLC)..'
;
create or replace TABLE FCT_YELLOW_CAB_VENDOR_FINANCIAL (
	VENDOR_ID FLOAT,
	VENDOR_NAME VARCHAR(33),
	YEAR NUMBER(38,0),
	MONTH NUMBER(38,0),
	TRIP_COUNT NUMBER(38,0),
	TOTAL_AMOUNT NUMBER(12,2),
	TOTAL_AMOUNT_CASH NUMBER(12,2),
	TOTAL_AMOUNT_CC NUMBER(12,2),
	TOTAL_AMOUNT_VOID NUMBER(12,2),
	SYSTEM_CREATE_DATE TIMESTAMP_NTZ(9),
	SYSTEM_UPDATE_DATE TIMESTAMP_NTZ(9)
)COMMENT='Summarization of Trip data to provide Financial metrics at Vendor and Month level'
;
create or replace TABLE FCT_YELLOW_CAB_VENDOR_OPS (
	MONTH NUMBER(38,0) COMMENT 'The month of the trip data. Part of the composite key with VENDOR_ID and YEAR. Used for monthly performance tracking and reporting. Sourced directly from the input data without transformations. Allows for granular analysis of trip metrics. Supports the creation of monthly performance reports. Facilitates timely monitoring of vendor activity. Integral for identifying seasonal trends in trip data.',
	VENDOR_ID FLOAT COMMENT 'Unique identifier for the vendor. Part of the composite key with YEAR and MONTH. Used for identifying specific vendors in reports. Sourced directly from the input data without transformations. Key component in vendor performance analysis and payment tracking. Enables detailed views of vendor-specific metrics. Essential for accurate vendor-level reporting and analytics. Foreign key to the Vendor dimension table.',
	VENDOR_NAME VARCHAR(33) COMMENT 'Name of the vendor. Provides a descriptive label for the vendor ID. Used in reports and dashboards for easy identification. Sourced directly from the input data without transformations. Aids in the interpretation of vendor-related metrics. Supports user-friendly data presentation. Facilitates quick recognition of vendors in various analyses. Consistent naming conventions are applied for standardization.',
	YEAR NUMBER(38,0) COMMENT 'The year of the trip data. Part of the composite key with VENDOR_ID and MONTH. Used for time-based analysis and reporting. Sourced directly from the input data without transformations. Enables year-over-year comparisons of trip metrics. Essential for trend analysis and forecasting. Supports the creation of annual performance summaries. Integral for tracking changes in vendor activity over time.',
	TRIP_COUNT NUMBER(38,0) COMMENT 'Total number of trips. Aggregated from the source data. Used in performance analysis and reporting. Sourced directly from the input data without transformations. Provides a key measure of vendor activity. Supports the calculation of trip-related metrics. Essential for understanding the volume of trips. Used in various dashboards to monitor vendor performance. Basis for calculating average trip distance.',
	TRIP_DISTANCE_TOTAL NUMBER(38,0) COMMENT 'Total distance of all trips. Aggregated from the source data. Used in performance analysis and reporting. Sourced directly from the input data without transformations. Provides a key measure of vendor activity. Supports the calculation of trip-related metrics. Essential for understanding the volume of trips. Used in various dashboards to monitor vendor performance. Basis for calculating average trip distance.',
	TRIP_DISTANCE_AVG NUMBER(12,2) COMMENT 'Average distance per trip. Calculated by dividing TRIP_DISTANCE_TOTAL by TRIP_COUNT. Used in performance analysis and reporting. Provides a normalized measure of trip distance. Supports the comparison of trip distances across vendors. Essential for understanding the efficiency of trips. Used in various dashboards to monitor vendor performance. Aids in identifying outliers in trip distances.',
	TRIP_DURATION_MINUTES_TOTAL NUMBER(38,0) COMMENT 'Total duration of all trips in minutes. Aggregated from the source data. Used in performance analysis and reporting. Sourced directly from the input data without transformations. Provides a key measure of vendor activity. Supports the calculation of trip-related metrics. Essential for understanding the volume of trips. Used in various dashboards to monitor vendor performance. Basis for calculating average trip duration.',
	SYSTEM_CREATE_DATE TIMESTAMP_NTZ(9) COMMENT 'Timestamp of when the record was created in the data warehouse. Automatically generated by the system. Used for auditing and data lineage purposes. Indicates when the data was initially loaded. Supports tracking the freshness of the data. Essential for debugging and troubleshooting data issues. Facilitates the identification of data loading patterns. Not sourced from any external system.',
	SYSTEM_UPDATE_DATE TIMESTAMP_NTZ(9) COMMENT 'Timestamp of when the record was last updated in the data warehouse. Automatically generated by the system. Used for auditing and data lineage purposes. Indicates when the data was last modified. Supports tracking changes to the data. Essential for debugging and troubleshooting data issues. Facilitates the identification of data update patterns. Not sourced from any external system.'
)COMMENT='Summarization of Trip data to provide Operational metrics at Vendor and Month level....'
;


    CREATE TABLE IF NOT EXISTS NY_TAXI.GOLD.DIM_DRIVER (
        DIM_DRIVER_KEY      NUMBER(38,0) IDENTITY,
        DRIVER_ID           NUMBER(38,0),
        VENDOR_ID           NUMBER(38,0),
        FIRST_NAME          VARCHAR(50),
        LAST_NAME           VARCHAR(50),
        FULL_NAME           VARCHAR(101),
        LICENSE_NUMBER      VARCHAR(10),
        LICENSE_EXPIRY      DATE,
        PHONE               VARCHAR(14),
        EMAIL               VARCHAR(100),
        HIRE_DATE           DATE,
        RATING              NUMBER(2,1),
        IS_ACTIVE           BOOLEAN,
        VENDOR_NAME         VARCHAR,
        TRIP_VENDOR_ID      FLOAT,
        TRIP_VENDOR_NAME    VARCHAR(33),
        TENURE_YEARS        NUMBER(5,2),
        SYSTEM_VERSION      NUMBER(38,0),
        SYSTEM_CURRENT_FLAG VARCHAR(1),
        SYSTEM_START_DATE   TIMESTAMP_NTZ,
        SYSTEM_END_DATE     TIMESTAMP_NTZ,
        SYSTEM_CREATE_DATE  TIMESTAMP_NTZ,
        SYSTEM_UPDATE_DATE  TIMESTAMP_NTZ
    );

-- ===== Query history for Coalesce runID 5797 =====
SELECT start_time, user_name, query_type, execution_status,
       TRY_PARSE_JSON(query_tag):coalesce:jobName::STRING         AS job_name,
       TRY_PARSE_JSON(query_tag):coalesce:nodeName::STRING        AS node_name,
       TRY_PARSE_JSON(query_tag):coalesce:stageName::STRING       AS stage_name,
       TRY_PARSE_JSON(query_tag):coalesce:storageLocation::STRING AS storage_location,
       query_id, query_text
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE start_time > DATEADD(day, -30, CURRENT_TIMESTAMP())
  AND query_tag ILIKE '%"coalesce"%'
  AND TRY_PARSE_JSON(query_tag):coalesce:runID::STRING = '5797'
ORDER BY start_time;
