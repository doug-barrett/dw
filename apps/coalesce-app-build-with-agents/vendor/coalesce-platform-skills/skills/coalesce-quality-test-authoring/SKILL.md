---
name: coalesce-quality-test-authoring
description: Decide which data quality tests a table, view or model needs, and write them in whatever test format the project already uses (dbt, SYNQ YAML, SQLMesh audits, Soda, Great Expectations, custom SQL, and so on). Use it when asked to add, suggest, review or extend data tests for a warehouse asset, or when a change to a model should come with tests.
---
<!-- coalesce-node-managed: true -->

# Data test authoring

A data test is a **deterministic assertion over the rows of one asset**: a query that
returns the rows breaking a rule. If it returns no rows, the test passes. This skill
covers *which* assertions to write and *with what parameters*. The syntax comes from the
project you are working in.

## Stance

- **Suggest fewer, better tests.** Every test costs warehouse compute and adds alert noise.
  One test that catches a real failure mode is worth more than five that restate the schema.
  Suggesting nothing is a valid result.
- **Keep each test to one concern.** To check the same thing on several columns, write one
  test per column. Combine columns only when the rule needs them together, such as a
  composite key or a cross-column formula. A multi-column not-null or empty check is fine
  when the columns form one concern (for example, "both location IDs present").
- **Never guess values.** Any test whose parameters depend on what the data holds
  (allowed values, bounds, keys) needs evidence from the code, the schema, documentation
  or a profiling query. If you cannot get evidence, drop the test or ask for the value.
- **Write rules, not snapshots.** A test should hold for tomorrow's data as well as
  today's. A bound or value list copied from a sample of current data is a snapshot and
  will fail on legitimate new data.
- **Don't duplicate.** Check what already exists before adding anything: tests, schema
  constraints, and earlier suggestions.

## Workflow

1. **Find the project's test format.** Look for existing tests next to the asset or
   elsewhere in the repo, such as `schema.yml`/`*.yml` with `tests:`/`data_tests:`, SYNQ
   `*.yaml` check configs, SQLMesh `audits`, Soda `checks.yml`, GE suites or `tests/*.sql`.
   Copy their structure, naming, file placement and severity conventions. If there is no
   format and the user named none, ask before inventing one. If the project uses
   Coalesce Quality YAML (a file with `version: v1beta2` and `entities:`), follow
   *Coalesce Quality (SYNQ) YAML* below for field names and behavior. Do not write
   that format from memory.
2. **Understand the asset.**
   - Schema: column types, nullability, primary or unique keys.
   - Code: the SQL or model that builds it. CASE branches, filters, joins, COALESCEs and
     derived formulas are where real business rules live.
   - Grain: what one row represents. This decides the uniqueness key.
   - Load pattern: full refresh, incremental or append-only, and the refresh schedule.
     This decides freshness and the time windows.
   - Immediate lineage: which upstream tables its foreign keys point to.
   - SQL dialect of the warehouse.
3. **Collect existing coverage.** Gather existing tests, monitors and constraints for the
   asset, plus any pending suggestions. Drop any candidate that duplicates or closely
   resembles one of them, or whose concern they already cover.
4. **Outline candidates.** List possible tests with one line of reasoning each, and note
   what evidence each one still needs.
5. **Gather evidence, only what the candidates need.** Read the code first, because it is
   free. Profile the data only where parameters depend on it:
   - distinct values and their counts → accepted values
   - min and max → bounds
   - duplicate count over the candidate key → unique
   - null and empty rate → not null or empty
   - a sample of rows → relative time or a business rule
6. **Decide.** Confirm or reject each candidate against the evidence. Reject it if the
   data already violates it with no sign that this is a bug, if cardinality is too high, or
   if the rule is not really a constraint.
7. **Write the tests** in the project's format, each with a short explanation (see
   *Explanations*).
8. **Validate** with the project's own tooling if there is any, such as compile, parse or
   dry-run (for Coalesce Quality, `synqcli deploy <files> --dry-run`). Run the new tests once if you can. A test that fails on its first run needs a
   look: it has either found a real issue or encoded a wrong rule. Report which.

## Test catalog

These are the kinds of test to reason with. Map each one onto the closest construct in the
project's format (see *Mapping onto the project's format*).

### Not null
- **Checks that:** none of the listed columns holds NULL.
- **Use for:** identifiers, foreign keys, required business attributes, timestamps the
  rest of the pipeline relies on.
- **Don't use for:** columns the schema already declares NOT NULL or as a primary key, or
  columns that are optional by design (for example, a LEFT JOIN result or a `cancelled_at`
  that is null until the event happens).
- **Evidence:** the schema, plus the code or a profile when you are unsure. A column that
  is null today can still be required, but say so in the explanation.

### Empty
- **Checks that:** none of the listed text or array columns is empty, meaning NULL, an
  empty string, whitespace only, or an empty array.
- **Use for:** text fields where `''` is as bad as NULL (names, codes, emails).
- **Note:** in the common implementation this check also catches NULL, so **don't pair it
  with a not-null test on the same column**. Use one or the other.

### Accepted values
- **Checks that:** every value in the column is in a complete, closed list.
- **Use for:** enum-like columns with a small, stable set of values, roughly 20 to 30 or
  fewer: statuses, types, flags, codes.
- **Don't use for:** high-cardinality columns, or open sets that grow with the business
  (country lists your product expands to, product SKUs).
- **Evidence:** required. Prefer values defined in code (CASE branches, enum definitions,
  upstream accepted-values tests) over values seen in samples. If you rely on profiling,
  profile the whole column's distinct values, not a sample. **The list must be complete.**
- **Note:** this check is usually `col NOT IN (…)`, so NULL passes it. Add a not-null test
  separately if NULL is invalid too.

### Rejected values
- **Checks that:** the column never holds any value from a forbidden list.
- **Use for:** known sentinel or junk values such as `'UNKNOWN'`, `'TEST'`, `'N/A'`, `-1`
  or `'1970-01-01'`, especially when the set of valid values is open.
- **Evidence:** the forbidden values must be named by the user, the code or the
  documentation, or seen in data and confirmed to be junk. No speculative lists.

### Unique
- **Checks that:** no two rows share the same value, or combination of values, in the
  listed columns.
- **Use for:** the asset's grain: primary keys, natural keys and composite business keys.
- **Don't use for:** columns already declared as primary or unique keys, where the
  warehouse actually enforces them.
- **Evidence:** know the grain from the code (GROUP BY, DISTINCT, join cardinality) or
  profile the duplicate count. If duplicates exist today, find out whether that is a bug
  before you encode the test.
- **Scale rule:** on large or growing tables, limit the check to recent rows using the
  row-creation or load timestamp (for example, the last 30 days or the last week). If
  there is no clear creation timestamp, check the whole table. The window misses
  duplicates where one copy falls outside it. That is an accepted trade-off.

### Relationships (referential integrity)
- **Checks that:** every non-null value of a foreign-key column, or a tuple of columns,
  exists in the referenced column of another asset.
- **Use for:** foreign keys you can see in the schema, the join conditions in the code, or
  immediate upstream lineage.
- **Parameters:** say whether null foreign keys are allowed, which is usually yes, because
  optional relations are null. On large tables, scope the check to a time window as you
  would for unique.
- **Evidence:** read the referenced asset's schema to confirm the column exists and its
  type matches.

### Freshness
- **Checks that:** the most recent value of a timestamp column is no older than a window.
  The test fails when `max(ts) < now() - window`.
- **Use for:** assets that are loaded on a schedule or continuously.
- **Parameters:** pick a timestamp that moves on every load (`loaded_at`, `created_at`,
  the event time). Set the window to the expected refresh interval plus slack for normal
  delay, for example daily load → 26 to 36 hours, not exactly 24.
- **Don't use for:** static reference tables, one-off backfills, or demo and archive data.

### Minimum value / maximum value
- **Checks that:** the column is ≥ a minimum, or ≤ a maximum. The bound is inclusive
  unless the format offers strict comparison and you need it.
- **Use for:** physical or logical bounds such as amounts ≥ 0, quantities ≥ 0, a
  percentage ≤ 100, or an age ≤ 150.
- **Rule:** if you don't know the exact range, or it changes over time, assert **only the
  bound you are sure of**. A non-negative amount gets a minimum of 0 and no maximum.

### Range (min and max)
- **Checks that:** `min ≤ col ≤ max`.
- **Use only when both bounds are true by definition:** percentages 0 to 100,
  probabilities 0 to 1, hour 0 to 23, a rating scale of 1 to 5.
- **Don't use for:** a range copied from observed min and max ("0 to 6 passengers because
  that is what the profile showed"). That snapshots the data. Use a one-sided bound, or
  nothing.

### Relative time (ordering)
- **Checks that:** one timestamp column is not later than another, so the test fails when
  `first > second`. Equal values and NULLs pass.
- **Use for:** lifecycle pairs such as `start < end`, `created_at ≤ updated_at`,
  `ordered_at ≤ shipped_at`, or `pickup ≤ dropoff`.
- **Evidence:** both columns exist, are date or time types, and a sample confirms the
  order you expect.

### Business rule (custom SQL)
- **Checks that:** an expression in the warehouse's SQL dialect, which evaluates to
  **TRUE for invalid rows**, never matches a row.
- **Use for:** cross-column logic that no other test can express, such as
  `total ≠ subtotal + tax` (with a tolerance for floating point), conditional requirements
  (`status = 'shipped' AND shipped_at IS NULL`), or mutually exclusive flags.
- **Last resort:** if a catalog test above fits, use it instead.
- **Rules:**
  - Use only functions from the asset's SQL dialect.
  - Compare floating-point values with a tolerance.
  - Remember that an expression involving NULL evaluates to NULL, which counts as not
    flagged. Handle NULLs explicitly if they matter.
  - If the format can deploy one test onto many tables, use its table placeholder rather
    than a hard-coded name.
  - Check the polarity: some frameworks want "returns failing rows", others want "the
    condition that must hold". Invert accordingly.

## Choosing between overlapping tests

| Situation | Choose |
|---|---|
| A text column must be non-blank | **Empty** only (it already covers NULL) |
| A column must be present, and blank text is fine | **Not null** |
| Small, closed set of valid values | **Accepted values** (+ not null if NULL is invalid) |
| Open set, but specific junk values are known | **Rejected values** |
| Only one bound is certain | **Minimum value** or **Maximum value** |
| Both bounds are true by definition | **Range** |
| Two timestamps with a lifecycle order | **Relative time** |
| A foreign key to another asset | **Relationships** |
| Multi-column arithmetic or conditional logic | **Business rule** |
| Grain or key of the asset | **Unique** (time-windowed on large tables) |

## Signals in the asset that point to a test

- A column named `*_id`, `*_key` or `*_code` that is the table's grain → unique (+ not null
  if the schema does not enforce it).
- A `*_id` column that joins to another asset, in the code or the lineage → relationships.
- `status`, `type`, `kind`, `category`, a boolean-like `*_flag` holding `'Y'`/`'N'`, or a
  CASE expression that produces a fixed set of labels → accepted values.
- `amount`, `price`, `quantity`, `count`, `duration` or `distance` → minimum 0, if negative
  values are impossible. Check for refunds and adjustments first.
- `*_pct`, `*_rate` or `*_ratio` → a range, but only after you confirm whether the scale
  is 0 to 1 or 0 to 100.
- Pairs such as `*_start`/`*_end`, `created_at`/`updated_at` or
  `opened_at`/`closed_at` → relative time.
- A derived column computed in the code from others (`total = a + b + c`) → business rule.
- An incremental or scheduled load with a load or event timestamp → freshness.
- A COALESCE to a sentinel in upstream code (`COALESCE(x, 'UNKNOWN')`) → rejected values on
  that sentinel downstream, if the sentinel should not reach this asset.

## Scale and cost

- Use time windows on unique and relationships checks for large or append-heavy tables.
  Anchor the window on the row-creation or load timestamp, not on a business date that can
  be backdated.
- Don't profile the whole table when a sample or column statistics will answer the question.
  Profile only the columns the candidates need.
- Don't include personal data found while profiling in tests, explanations or summaries.
  If a rule really needs a sensitive value list, say so and let the user supply it.

## Explanations

Every test carries a one-sentence explanation of **what it guards against and why it
matters**, in business terms. Say where the rule comes from (the code, the schema, the
user, or a profile), especially for any value that came from the data.

- Good: "Order totals must equal the sum of line items plus tax. This is how
  `fct_orders.sql` derives them, so a mismatch means a broken join upstream."
- Bad: "Checks total_amount."

## Mapping onto the project's format

You will not always know the target format ahead of time. Map concepts onto it like this:

1. Use the format's **native construct** when one exists (a dbt `not_null`, a SYNQ
   `accepted_values`, a Soda `invalid_count`, and so on). Match its parameter names, value
   types and quoting exactly as existing tests do.
2. If the format has no native construct for a concept, express it as the format's
   **custom SQL or assertion** construct, with the semantics defined above.
3. If the format cannot express it at all, such as a time window on uniqueness, **say so**
   and either drop the refinement and explain the trade-off, or skip the test. Don't skip
   a test only because you are unsure of the syntax. Look it up, or use the format's
   custom SQL construct.
4. Keep the **inclusive or exclusive and NULL semantics** the same as above. When the
   native construct behaves differently (for example, an accepted-values test that fails
   on NULL), adjust or note it.
5. Put tests where the project keeps them and follow its naming, tagging, ownership and
   severity conventions.

## Coalesce Quality (SYNQ) YAML

Coalesce Quality tests live in YAML files deployed with `synqcli deploy`. The editor
schema is `https://schemas.synq.io/synq-monitors/v1/config.schema.json`. The schema
rejects unknown fields, so one wrong key fails the whole deploy.

```yaml
# yaml-language-server: $schema=https://schemas.synq.io/synq-monitors/v1/config.schema.json
version: v1beta2
namespace: analytics-orders
defaults:
  severity: ERROR
entities:
  - id: <entity id, copied exactly from existing config or the Coalesce Quality UI>
    tests:
      - type: not_null
        columns: [customer_id]
    monitors:
      - id: fct_orders_freshness
        type: freshness
        expression: loaded_at
```

- Add tests to the existing entry for the asset under `entities[].tests`. Keep
  `version: v1beta2`. A file without it is read in a legacy layout.
- Never guess an entity `id`, including the one a `relationships` test points at. Copy it
  from another config file in the repo. If no file names it, ask for it.
- `monitors:` on the same entity are existing coverage too. A `freshness` monitor already
  covers freshness, so don't add a `freshness` test next to it.

### Fields per test type

Every test also accepts `id`, `name`, `description`, `severity` (`INFO`, `WARNING` or
`ERROR`, not `WARN`), `select_columns`, `schedule`, `timezone` and `save_failures`.

| Concept | `type` | Required fields | Optional fields |
|---|---|---|---|
| Not null | `not_null` | `columns: [..]` | |
| Empty | `empty` | `columns: [..]` | |
| Accepted values | `accepted_values` | `column`, `values: [..]` | |
| Rejected values | `rejected_values` | `column`, `values: [..]` | |
| Unique | `unique` | `columns: [..]` | `time_partition_column`, `time_window_seconds` |
| Relationships | `relationships` | `references` (see below) | `ignore_nulls`, `time_partition_column`, `time_window_seconds` |
| Freshness | `freshness` | | `time_partition_column`, `time_window_seconds` |
| Minimum value | `min_value` | `column`, `min_value` | `strictly` |
| Maximum value | `max_value` | `column`, `max_value` | `strictly` |
| Range | `min_max` | `column`, `min_value`, `max_value` | `strictly` |
| Relative time | `relative_time` | `column`, `relative_column` | |
| Business rule | `business_rule` | `sql_expression` | |
| Custom query | `business_query` | `sql_query` | `evaluators` |

Field names to get right: `columns` is a list and `column` is a single name. The custom
SQL field is `sql_expression`, not `sql` or `expression`. There is no `custom_sql` type.

```yaml
- type: relationships
  references:
    - entity: <id of the referenced asset>
      columns:
        - source: customer_id
          reference: customer_id
  ignore_nulls: true
  time_partition_column: ordered_at
  time_window_seconds: 2592000   # 30 days
```

### How each type behaves

These come from the SQL that Coalesce Quality generates for each type. Where the public
examples disagree, these are correct.

- **`relative_time` fails when `column > relative_column`.** Put the **earlier** timestamp
  in `column` and the later one in `relative_column`: `column: ordered_at`,
  `relative_column: shipped_at`. Some published examples show the reverse
  (`column: ship_date`, `relative_column: order_date`). That version flags every
  correctly ordered row. Rows where either side is NULL pass.
- **`relationships` fails on a NULL foreign key unless `ignore_nulls: true` is set.**
  Optional relations need `ignore_nulls: true`. Leave it off only when NULL is invalid
  too. That also covers not-null, so don't add a separate not-null test.
- **`business_rule` reports rows where `sql_expression` is TRUE.** Write the condition
  for a *bad* row, such as `status = 'shipped' and shipped_at is null`. An expression
  that describes a good row flags every good row. Write `{{ table }}` to refer to the
  asset in a subquery. It is the only placeholder allowed.
- **`accepted_values` lets NULL through** (`col NOT IN (..)`). Add a `not_null` test if
  NULL is invalid. `rejected_values` lets NULL through as well.
- **`empty` catches NULL as well as blank text**, so it never needs a `not_null` partner.
- **`min_value`, `max_value` and `min_max` are inclusive** unless `strictly: true`. NULL
  passes.
- **`unique` and `relationships` windows** keep only rows where
  `time_partition_column >= now - time_window_seconds`. Use the row-creation or load
  timestamp.
- **`freshness`** fails when the newest `time_partition_column` value is older than
  `time_window_seconds`.

## Worked example

### The asset

`analytics.fct_orders` has one row per order. It is loaded incrementally once a day at
02:00.

```sql
select
  o.id                as order_id,
  o.customer_id,
  case o.state
    when 'new'       then 'open'
    when 'paid'      then 'open'
    when 'shipped'   then 'shipped'
    when 'cancelled' then 'cancelled'
  end                 as status,
  o.subtotal,
  o.tax,
  o.total             as order_total,
  o.discount_pct,
  o.created_at        as ordered_at,
  s.shipped_at,
  o.coupon_code,
  current_timestamp() as loaded_at
from raw.orders o
left join raw.shipments s on s.order_id = o.id
where o.created_at > (select max(ordered_at) from analytics.fct_orders)
```

### What the steps turn up

- **Schema:** `ordered_at` is declared NOT NULL. No other constraints are declared.
- **Existing coverage:** there is already a not-null test on `order_id`.
- **Lineage:** `customer_id` joins upstream to `analytics.dim_customers.customer_id`.
- **Profile, last 30 days:**
  - 0 duplicate `order_id` values and 0 null `customer_id` values.
  - `order_total` ranges from 0.00 to 18,400.00.
  - `discount_pct` ranges from 0.00 to 0.35, so the scale is 0 to 1.
  - `coupon_code` has 4,210 distinct values and is 61% null.
- **Sample:** `shipped_at` is never earlier than `ordered_at`. `order_total` matches
  `subtotal + tax` to within a cent.

### Candidates and decisions

| # | Candidate | Decision | Why |
|---|---|---|---|
| 1 | Unique `order_id` | **Keep, windowed on `ordered_at`, last 30 days** | This is the grain. The LEFT JOIN to shipments fans out if an order has two shipments. `ordered_at` is the creation timestamp. |
| 2 | Not null `order_id` | Drop | Already covered by an existing test. |
| 3 | Not null `ordered_at` | Drop | The schema already declares it NOT NULL. |
| 4 | Not null `customer_id` | **Keep** | It is required for every order. The profile shows no nulls today. |
| 5 | Relationships `customer_id` → `dim_customers.customer_id` | **Keep, windowed** | It is a foreign key visible in the lineage. Nulls are already handled by #4. |
| 6 | Accepted values `status` ∈ {open, shipped, cancelled} | **Keep** | This is a closed set. The values come from the CASE expression, not from a sample. |
| 7 | Not null `status` | **Keep** | The CASE has no ELSE, so a new upstream state turns into NULL. Accepted values lets NULL through, so #6 alone would miss it. |
| 8 | Not null `shipped_at` | Drop | It is null by design for orders that have not shipped (LEFT JOIN). |
| 9 | Business rule: a shipped order has no ship date | **Keep** | This is the conditional form of #8. Invalid when `status = 'shipped' AND shipped_at IS NULL`. |
| 10 | Relative time `ordered_at` ≤ `shipped_at` | **Keep** | This is a lifecycle order and the sample confirms it. |
| 11 | Range `order_total` 0 to 18,400 | Reject | The upper bound is copied from today's data. |
| 12 | Minimum value `order_total` ≥ 0 | **Keep** | Refunds are modelled elsewhere, so a negative total is a bug. |
| 13 | Range `discount_pct` 0 to 1 | **Keep** | Both bounds are true by definition for a fraction. Use 1, not the observed 0.35. |
| 14 | Business rule: `order_total` = `subtotal + tax` | **Keep** | The total comes from the source rather than being computed here, so this checks real data. Invalid when `abs(order_total - (subtotal + tax)) > 0.01`. |
| 15 | Accepted values `coupon_code` | Reject | 4,210 distinct values is an open set. |
| 16 | Empty `coupon_code` | Reject | Coupons are optional, so a blank value is not an error. |
| 17 | Freshness on `loaded_at` | **Keep, 36-hour window** | The load runs daily. The extra 12 hours allow for a late run without alerting. |

### Result

The result is 11 tests. The schema and existing tests already cover two more candidates,
and four were rejected. Written out in neutral notation:

```
unique            columns=[order_id]  window=ordered_at, 30d
                  — order_id is the grain; the shipments join can fan out an order into duplicates
not_null          columns=[customer_id]
                  — every order belongs to a customer
relationships     customer_id → analytics.dim_customers.customer_id  window=ordered_at, 30d
                  — orders must not point at customers missing from the dimension
accepted_values   status ∈ {open, shipped, cancelled}
                  — the only labels the model's CASE produces
not_null          columns=[status]
                  — an unmapped upstream state turns into NULL, which accepted_values lets through
business_rule     invalid when status = 'shipped' AND shipped_at IS NULL
                  — a shipped order without a ship date means the shipments join lost its row
relative_time     ordered_at ≤ shipped_at
                  — an order cannot ship before it was placed
min_value         order_total ≥ 0
                  — refunds are modelled separately, so a negative total is a bug
min_max           0 ≤ discount_pct ≤ 1
                  — a discount is a fraction of the order
business_rule     invalid when abs(order_total - (subtotal + tax)) > 0.01
                  — the source total must agree with its components
freshness         loaded_at, window 36h
                  — daily load plus 12h of slack
```

### Mapping onto a format (dbt as an example)

- `unique` and `relationships` have no time-window parameter in dbt. Express the window
  as the test's `where` config, written in the warehouse dialect.
- `dbt_utils.expression_is_true` asserts the **valid** condition. Invert the invalid-row
  expressions, for example `not (status = 'shipped' and shipped_at is null)`.
- Freshness on a model, rather than a source, has no native test in dbt core. Use
  `dbt_utils.recency` if the package is installed, or a singular SQL test otherwise.

## Before you finish

- [ ] Each test has a single, clear concern and an explanation of why it exists.
- [ ] No test duplicates an existing test, a schema constraint or another suggestion.
- [ ] No not-null test on a column that is NOT NULL or a primary key, and no not-null +
      empty pair on the same column.
- [ ] Every value list and bound came from the code, the docs, the user or a profile, and
      none came from a guess.
- [ ] Ranges use both bounds only when both are true by definition.
- [ ] Accepted-values lists are complete.
- [ ] Unique and relationships checks on big tables are time-windowed on a creation or
      load timestamp.
- [ ] Freshness windows include slack over the refresh interval.
- [ ] Custom SQL uses the asset's dialect, flags *invalid* rows (or is inverted correctly
      for the format) and handles NULLs.
- [ ] The tests parse or compile with the project's tooling.
- [ ] Coalesce Quality YAML: each field matches the table in *Fields per test type*,
      `relative_time` puts the earlier column in `column`, optional foreign keys set
      `ignore_nulls: true`, and every entity id is copied, not guessed.
