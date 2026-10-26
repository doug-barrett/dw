# Raw Data Vault 2.0 Design — NY Yellow Cab (`dw`)

**Status:** Proposal (design only — no vault nodes built yet)
**Branch:** `data-vault-design`
**Date:** 2026-10-26
**Scope:** Raw Data Vault over the 6 BRONZE source tables that remain in this
workspace after the pivot. The former SILVER/GOLD/PLATINUM star-schema layer
(stages, dims, facts, views) and its jobs/subgraphs have been removed.

---

## 1. Source inventory (BRONZE)

All six sources are `sqlType: Source`, `locationName: BRONZE`, database
`NY_TAXI`, schema `BRONZE`.

| Source node | Node id | Grain | Business key | FKs to other sources |
|---|---|---|---|---|
| `VENDOR` | `5d93f0a0…` | one row per vendor | `VENDOR_ID` | — |
| `LOCATION` | `f811d53e…` | one row per taxi zone | `LOCATION_ID` | — |
| `PAYMENT_TYPE` | `5d63e4c0…` | one row per payment type | `PAYMENT_TYPE_ID` | — |
| `RATE_CODE` | `52fd1afb…` | one row per rate code | `RATE_CODE_ID` | — |
| `DRIVERS` | `9e529135…` | one row per driver | `DRIVER_ID` | `VENDOR_ID` → VENDOR |
| `YELLOW_CAB_TRIPS` | `6a80fae2…` | one row per trip (event) | `TRIP_ID` | `VENDOR_ID`, `PAYMENT_TYPE_ID`, `RATE_CODE_ID`, `PU_LOCATION_ID`, `DO_LOCATION_ID` |

### Column detail

**VENDOR** — `VENDOR_ID` NUMBER(38,0) *(BK)*, `VENDOR_NAME` VARCHAR.

**LOCATION** — `LOCATION_ID` NUMBER(3,0) *(BK)*, `BOROUGH`, `ZONE`,
`SERVICE_ZONE`, `FILENAME` (load artifact).

**PAYMENT_TYPE** — `PAYMENT_TYPE_ID` NUMBER(1,0) *(BK)*, `PAYMENT_TYPE` VARCHAR.

**RATE_CODE** — `RATE_CODE_ID` NUMBER(2,0) *(BK)*, `RATE_CODE` VARCHAR.

**DRIVERS** — `DRIVER_ID` NUMBER(38,0) *(BK, NOT NULL)*, `VENDOR_ID`
NUMBER(38,0) *(FK)*, `FIRST_NAME`, `LAST_NAME`, `LICENSE_NUMBER`,
`LICENSE_EXPIRY` DATE, `PHONE`, `EMAIL`, `HIRE_DATE` DATE, `RATING` NUMBER(2,1),
`IS_ACTIVE` BOOLEAN.

**YELLOW_CAB_TRIPS** — `TRIP_ID` NUMBER(18,0) *(BK)*; FKs `VENDOR_ID`,
`PAYMENT_TYPE_ID`, `RATE_CODE_ID`, `PU_LOCATION_ID`, `DO_LOCATION_ID` (all
FLOAT in source); event timestamps `PICKUP_DATETIME`, `DROPOFF_DATETIME`
(TIMESTAMP_TZ), plus unused `TPEP_PICKUP_DATETIME`/`TPEP_DROPOFF_DATETIME`
(FLOAT); descriptive `TRIP_DISTANCE`, `PASSENGER_COUNT`, `STORE_AND_FWD_FLAG`;
measures `FARE_AMOUNT`, `EXTRA`, `MTA_TAX`, `TIP_AMOUNT`, `TOLLS_AMOUNT`,
`IMPROVEMENT_SURCHARGE`, `CONGESTION_SURCHARGE`, `AIRPORT_FEE`,
`CBD_CONGESTION_FEE`, `TOTAL_AMOUNT`; `FILE_NAME` (load artifact).

### Relationships

```
          DRIVERS ──VENDOR_ID──► VENDOR ◄──VENDOR_ID──┐
                                                       │
                          PAYMENT_TYPE ◄─PAYMENT_TYPE_ID┤
                                                       │
                             RATE_CODE ◄──RATE_CODE_ID─┤── YELLOW_CAB_TRIPS (TRIP_ID)
                                                       │
            LOCATION ◄──PU_LOCATION_ID (pickup role)──┤
            LOCATION ◄──DO_LOCATION_ID (dropoff role)─┘
```

Two things to note for the vault design:

1. **`LOCATION` is role-played twice** by a trip — pickup and dropoff — both
   resolving to the single `HUB_LOCATION`.
2. **Drivers do not appear on trips.** There is no `DRIVER_ID` on
   `YELLOW_CAB_TRIPS`, so the only driver relationship in this source is
   driver → vendor. Driver is modelled, but not linked to the trip event.

---

## 2. Raw Data Vault model

Standard DV 2.0 conventions used throughout:

- **Hash keys** (`H_*_KEY`, `L_*_KEY`): SHA‑1 over the trimmed / upper‑cased /
  null‑standardised business key(s), concatenated with the DV delimiter. Hub
  keys hash the business key; the link key hashes all participating business
  keys together.
- **Hashdiff** (`S_*_HASH`): SHA‑1 over the concatenation of all descriptive
  attributes in that satellite, used for change detection.
- **`LDTS`** — load date timestamp (`SYSDATE()`), on every table.
- **`RSRC`** — record source (`{{record_source()}}`, e.g.
  `NY_TAXI.BRONZE.YELLOW_CAB_TRIPS`), on every table.
- Business keys live **only** in hubs; FKs live **only** in links; descriptive
  attributes live **only** in satellites; no attributes in hubs or links.

### 2.1 Hubs (6 — one per business key)

| Hub | Hub hash key | Business key | Source (via DV Stage) |
|---|---|---|---|
| `HUB_VENDOR` | `H_VENDOR_KEY` | `VENDOR_ID` | `VENDOR` |
| `HUB_LOCATION` | `H_LOCATION_KEY` | `LOCATION_ID` | `LOCATION` |
| `HUB_PAYMENT_TYPE` | `H_PAYMENT_TYPE_KEY` | `PAYMENT_TYPE_ID` | `PAYMENT_TYPE` |
| `HUB_RATE_CODE` | `H_RATE_CODE_KEY` | `RATE_CODE_ID` | `RATE_CODE` |
| `HUB_DRIVER` | `H_DRIVER_KEY` | `DRIVER_ID` | `DRIVERS` |
| `HUB_TRIP` | `H_TRIP_KEY` | `TRIP_ID` | `YELLOW_CAB_TRIPS` |

`TRIP_ID` is a real, stable business key, so the trip event is modelled as a
**hub + link** (rather than a key-less transactional link). This keeps the
trip addressable on its own and lets its measures hang off a satellite.

### 2.2 Links (2)

| Link | Link hash key | Connects (hub keys) | Hashed over | Source |
|---|---|---|---|---|
| `L_TRIP` | `L_TRIP_KEY` | `H_TRIP_KEY`, `H_VENDOR_KEY`, `H_PAYMENT_TYPE_KEY`, `H_RATE_CODE_KEY`, `H_PICKUP_LOCATION_KEY`, `H_DROPOFF_LOCATION_KEY` | `TRIP_ID`, `VENDOR_ID`, `PAYMENT_TYPE_ID`, `RATE_CODE_ID`, `PU_LOCATION_ID`, `DO_LOCATION_ID` | `YELLOW_CAB_TRIPS` |
| `L_DRIVER_VENDOR` | `L_DRIVER_VENDOR_KEY` | `H_DRIVER_KEY`, `H_VENDOR_KEY` | `DRIVER_ID`, `VENDOR_ID` | `DRIVERS` |

`L_TRIP` is one **unit-of-work** link capturing the full context of a trip in a
single row — *not* five separate links. The two location references are
**role-playing** columns (`H_PICKUP_LOCATION_KEY`, `H_DROPOFF_LOCATION_KEY`)
that both point at `HUB_LOCATION`; each is computed from `PU_LOCATION_ID` /
`DO_LOCATION_ID` respectively.

### 2.3 Satellites (descriptive attributes, historised)

| Satellite | On hub | Hashdiff | Descriptive attributes | Source |
|---|---|---|---|---|
| `SAT_VENDOR` | `HUB_VENDOR` | `S_VENDOR_HASH` | `VENDOR_NAME` | `VENDOR` |
| `SAT_LOCATION` | `HUB_LOCATION` | `S_LOCATION_HASH` | `BOROUGH`, `ZONE`, `SERVICE_ZONE` | `LOCATION` |
| `SAT_PAYMENT_TYPE` | `HUB_PAYMENT_TYPE` | `S_PAYMENT_TYPE_HASH` | `PAYMENT_TYPE` | `PAYMENT_TYPE` |
| `SAT_RATE_CODE` | `HUB_RATE_CODE` | `S_RATE_CODE_HASH` | `RATE_CODE` | `RATE_CODE` |
| `SAT_DRIVER` | `HUB_DRIVER` | `S_DRIVER_HASH` | `FIRST_NAME`, `LAST_NAME`, `LICENSE_NUMBER`, `LICENSE_EXPIRY`, `PHONE`, `EMAIL`, `HIRE_DATE`, `RATING`, `IS_ACTIVE` | `DRIVERS` |
| `SAT_TRIP_DETAILS` | `HUB_TRIP` | `S_TRIP_DETAILS_HASH` | `PICKUP_DATETIME`, `DROPOFF_DATETIME`, `TRIP_DISTANCE`, `PASSENGER_COUNT`, `STORE_AND_FWD_FLAG` | `YELLOW_CAB_TRIPS` |
| `SAT_TRIP_FINANCIAL` | `HUB_TRIP` | `S_TRIP_FINANCIAL_HASH` | `FARE_AMOUNT`, `EXTRA`, `MTA_TAX`, `TIP_AMOUNT`, `TOLLS_AMOUNT`, `IMPROVEMENT_SURCHARGE`, `CONGESTION_SURCHARGE`, `AIRPORT_FEE`, `CBD_CONGESTION_FEE`, `TOTAL_AMOUNT` | `YELLOW_CAB_TRIPS` |

Design choices:

- **Trip is split into two satellites** (`_DETAILS` vs `_FINANCIAL`), mirroring
  the old demo's OPS vs FINANCIAL facts and following the DV practice of
  splitting by subject / rate of change so a change to a fare amount does not
  re-version the trip's operational attributes.
- **`FILENAME` / `FILE_NAME`** are load artifacts, not business attributes.
  They are excluded from satellite hashdiffs. If lineage to the load file is
  wanted, carry `FILE_NAME` as a non-hashed attribute or fold it into `RSRC`.
- **`TPEP_PICKUP_DATETIME` / `TPEP_DROPOFF_DATETIME`** are FLOAT and look like
  unparsed epoch values; they are **excluded** pending clarification of their
  meaning. `PICKUP_DATETIME` / `DROPOFF_DATETIME` (TIMESTAMP_TZ) are the real
  event times.
- **PII split (optional):** `SAT_DRIVER` mixes identity (`FIRST_NAME`,
  `LAST_NAME`, `PHONE`, `EMAIL`, `LICENSE_NUMBER`) with non-PII
  (`HIRE_DATE`, `RATING`, `IS_ACTIVE`, `LICENSE_EXPIRY`). These can be split
  into `SAT_DRIVER_PII` + `SAT_DRIVER` if access control by column group is
  needed.

---

## 3. DV Stage layer (hash computation)

Hash keys, link keys and hashdiffs are all computed **once** in a DV Stage per
source, then referenced (not re-hashed) by the hubs/links/satellites. One DV
Stage per source table:

| DV Stage | From BRONZE | Computes |
|---|---|---|
| `DVSTG_VENDOR` | `VENDOR` | `H_VENDOR_KEY`, `S_VENDOR_HASH`, `LDTS`, `RSRC` |
| `DVSTG_LOCATION` | `LOCATION` | `H_LOCATION_KEY`, `S_LOCATION_HASH`, `LDTS`, `RSRC` |
| `DVSTG_PAYMENT_TYPE` | `PAYMENT_TYPE` | `H_PAYMENT_TYPE_KEY`, `S_PAYMENT_TYPE_HASH`, `LDTS`, `RSRC` |
| `DVSTG_RATE_CODE` | `RATE_CODE` | `H_RATE_CODE_KEY`, `S_RATE_CODE_HASH`, `LDTS`, `RSRC` |
| `DVSTG_DRIVER` | `DRIVERS` | `H_DRIVER_KEY`, `H_VENDOR_KEY`, `L_DRIVER_VENDOR_KEY`, `S_DRIVER_HASH`, `LDTS`, `RSRC` |
| `DVSTG_TRIP` | `YELLOW_CAB_TRIPS` | `H_TRIP_KEY`, `H_VENDOR_KEY`, `H_PAYMENT_TYPE_KEY`, `H_RATE_CODE_KEY`, `H_PICKUP_LOCATION_KEY`, `H_DROPOFF_LOCATION_KEY`, `L_TRIP_KEY`, `S_TRIP_DETAILS_HASH`, `S_TRIP_FINANCIAL_HASH`, `LDTS`, `RSRC` |

`DVSTG_DRIVER` carries `H_VENDOR_KEY` as well as `H_DRIVER_KEY` because it feeds
both `HUB_DRIVER` and `L_DRIVER_VENDOR`. `DVSTG_TRIP` carries all six hub keys
plus the link key because it feeds `HUB_TRIP`, `L_TRIP`, and both trip
satellites.

---

## 4. Node summary

**6 DV Stages · 6 Hubs · 2 Links · 7 Satellites = 21 vault nodes** over the 6
bronze sources. (Using the Scalefree V0/V1 satellite pattern, each satellite is
a V0 + a V1 node, which would make the satellite count 14 and the total 28.)

```
BRONZE                 DV STAGE            RAW VAULT
VENDOR            ─►  DVSTG_VENDOR     ─►  HUB_VENDOR, SAT_VENDOR
LOCATION          ─►  DVSTG_LOCATION   ─►  HUB_LOCATION, SAT_LOCATION
PAYMENT_TYPE      ─►  DVSTG_PAYMENT…   ─►  HUB_PAYMENT_TYPE, SAT_PAYMENT_TYPE
RATE_CODE         ─►  DVSTG_RATE_CODE  ─►  HUB_RATE_CODE, SAT_RATE_CODE
DRIVERS           ─►  DVSTG_DRIVER     ─►  HUB_DRIVER, SAT_DRIVER, L_DRIVER_VENDOR
YELLOW_CAB_TRIPS  ─►  DVSTG_TRIP       ─►  HUB_TRIP, SAT_TRIP_DETAILS,
                                          SAT_TRIP_FINANCIAL, L_TRIP
```

---

## 5. Build prerequisites & next steps

This document is the **design proposal only**; no vault nodes have been built.
To implement it:

1. **Install the Scalefree `datavault4coalesce` package** in this workspace.
   It is **not currently installed** — the workspace has only `BaseSQL`,
   `NodesV2`, `adv`, and `Test`. The build uses its node types
   `DV:::4` (DV Stage), `DV:::6` (Hub), `DV:::7` (Link), `DV:::8` (Satellite V0)
   and `DV:::9` (Satellite V1), per the `coalesce-data-vault` skill.
2. Build in layer order: DV Stages → Hubs → Links → Satellite V0s →
   Satellite V1s, validating (`coa validate`) and dry-running
   (`coa create --dry-run`) at each layer.
3. Resolve the open questions: meaning of the `TPEP_*` FLOAT columns; whether a
   PII split of `SAT_DRIVER` is required; whether `FILE_NAME`/`FILENAME` should
   be retained as lineage.

### Open assumptions

| # | Assumption |
|---|---|
| A1 | `TRIP_ID`, `DRIVER_ID`, `VENDOR_ID`, `LOCATION_ID`, `PAYMENT_TYPE_ID`, `RATE_CODE_ID` are unique, stable business keys in their source tables. |
| A2 | A trip references exactly one vendor, payment type, rate code, pickup location and dropoff location (standard star FKs) — modelled as one unit-of-work link. |
| A3 | Drivers relate to the business only through vendor; they are intentionally not linked to trips (no `DRIVER_ID` on the trip source). |
| A4 | `TPEP_*` columns are excluded until their meaning is confirmed. |
