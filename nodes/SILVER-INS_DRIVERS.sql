@id("6dbcbdde-b666-46bd-a039-56c2bb6baa83")
@nodeType("NodesV2:::6fda2820-4404-4b60-bad3-cf0edd7dab92")

WITH DRV AS (
SELECT
     *, first_name || last_Name as full_name
FROM {{ ref('BRONZE', 'DRIVERS') }} )

SELECT * FROM DRV