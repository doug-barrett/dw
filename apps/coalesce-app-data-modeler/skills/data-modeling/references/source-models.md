# Source data models

A source model documents what already exists: the Source nodes (and anything landed raw, e.g. an
`EXTERNAL` copy) with their keys, relationships and meaning. It is the foundation every derived
model (Data Vault, star schema) is designed from, so tag it as if a generator will read it.

## Model definition

```yaml
models:
  source:
    name: <System> source          # one model per source system when there are several
    type: Source
    include: { nodeTypes: [Source], locations: [] }   # or locations: [SRC_X] to split per system
```

## Recipe — every node

1. **Entity label**: the business name of one row ("Order line", not "LINEITEM").
2. **Grain → `businessKeyPart`**: the column set that identifies one row. Prefer the documented
   primary key; verify uniqueness when you can. Composite grains get the role on each part.
   A node with no identifying columns: say so, don't guess.
3. **Foreign keys → `unitOfWorkMember` + a relation** to the referenced node's key, many-to-one,
   labelled with the verb from the referencing side ("placed by", "located in"). A key that is part
   of the grain *and* a foreign key gets both roles.
4. **Qualifiers → `dependentChildKey`**: line numbers, sequence numbers, versions that only make
   sense under a parent key (often together with `businessKeyPart`).
5. **Every other column** gets a business label and one role:
   - `changeTracking` — values that change over the entity's life and whose history matters
     (status, address, balance, price);
   - `descriptive` — stable or low-value attributes (names of reference rows, free text);
   - `systemAudit` — load timestamps, source system, batch ids;
   - `ignore` — columns that must not flow downstream (only on explicit decision).
6. **Tags** for classification: `pii` (personal data — drives satellite splits and masking),
   `currency`, `measure` (additive/semi-additive numbers), `code` (low-cardinality codes — reference
   tables, junk/small dimensions), `eventDate` (business event dates — date dimension roles),
   `freeText`.
7. **Relations, completely**: one per foreign key. Model composite foreign keys as one relation with
   several pairs. Include direct relations to parent entities as well as to an associative node when
   the source declares both (TPC-H LINEITEM → PART, → SUPPLIER and → PARTSUPP).

## Checks before handing over

- Every node has an entity label and at least one `businessKeyPart` (checker warns otherwise).
- Every `unitOfWorkMember` column is the source of a relation, and every relation source column
  carries `unitOfWorkMember`.
- Key data types match across relations (checker warns on NUMBER vs VARCHAR).
- Report anomalies: nullable keys, money stored as integers, mixed-case column names from a
  different landing path, missing source nodes (e.g. a table that only exists as an external copy).

## Worked example: TPC-H (this workspace)

[`examples/tpch-source.spec.yml`](../examples/tpch-source.spec.yml) — 8 nodes, 10 relations:

| Node | Label | Grain | Relations (→ target) |
|---|---|---|---|
| `SRC_TPCH-LINEITEM` | Order line | L_ORDERKEY + L_LINENUMBER (dependent child) | → ORDERS, → PARTSUPP (composite), → PART, → SUPPLIER |
| `SRC_TPCH-ORDERS` | Order | O_ORDERKEY | → EXTERNAL-CUSTOMER |
| `EXTERNAL-CUSTOMER` | Customer | c_custkey | → NATION |
| `SRC_TPCH-PARTSUPP` | Part supply | PS_PARTKEY + PS_SUPPKEY (both also UoW) | → PART, → SUPPLIER |
| `SRC_TPCH-PART` | Part | P_PARTKEY | — |
| `SRC_TPCH-SUPPLIER` | Supplier | S_SUPPKEY | → NATION |
| `SRC_TPCH-NATION` | Nation | N_NATIONKEY | → REGION |
| `SRC_TPCH-REGION` | Region | R_REGIONKEY | — |

Customer comes from `EXTERNAL-CUSTOMER` (lowercase columns; no `SRC_TPCH-CUSTOMER` node), and its
`c_acctbal` is `NUMBER(38,0)` where TPC-H defines `NUMBER(12,2)` — flagged rather than fixed.
Customer and supplier name/address/phone are tagged `pii` (→ separate PII satellites downstream).
