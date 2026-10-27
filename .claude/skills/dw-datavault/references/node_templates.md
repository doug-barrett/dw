# DV node YAML templates (dw repo)

Exact column blocks and config for each DV node type, as the committed vault and
`gen_dv.py` produce them. All nodes are V1 YAML in SILVER. Indentation matters:
column list items sit at 6 spaces (`      - `), keys at 8.

## Node envelope

```yaml
fileVersion: 1
id: <node uuid>
name: <NODE_NAME>
operation:
  config:
    <per-type config, see below>
  database: ""
  deployEnabled: true
  description: ""
  isMultisource: false
  locationName: SILVER
  materializationType: <view|table>
  metadata:
    appliedNodeTests: []
    columns:
      <column blocks>
    cteString: ""
    enabledColumnTestIDs: []
    sourceMapping:
      - aliases:
          <UPSTREAM_NAME>: <upstream node id>
        customSQL:
          customSQL: ""
        dependencies:
          - locationName: <BRONZE|SILVER>
            nodeName: <UPSTREAM_NAME>
        join:
          joinCondition: FROM {{ ref('<LOC>', '<UPSTREAM_NAME>') }} "<UPSTREAM_NAME>"
        name: <NODE_NAME>
        noLinkRefs: []
  name: <NODE_NAME>
  overrideSQL: false
  schema: ""
  sqlType: DV:::<id>
  type: sql
  version: 1
type: Node
```

Per-type `operation.config` and `materializationType`:

| Node | sqlType | materialization | config |
|------|---------|-----------------|--------|
| DV Stage | `DV:::4` | view | `contains_multiactive_data: false`, `generate_ghost_records: true` |
| Hub | `DV:::6` | table | `disable_hwm: true`, `postSQL/preSQL: ""`, `testsEnabled: true` |
| Link | `DV:::7` | table | same as Hub |
| Sat V0 | `DV:::8` | table | `disable_hwm: false`, `postSQL/preSQL: ""`, `testsEnabled: true` |
| Sat V1 | `DV:::9` | view | `postSQL/preSQL: ""` |

## Column blocks

### Passthrough column (references one upstream column)

```yaml
      - columnReference:
          columnCounter: <fresh uuid, unique in THIS node>
          stepCounter: <THIS node id>
        dataType: <TYPE>
        description: ""
        name: <COL>
        nullable: true
        sourceColumnReferences:
          - columnReferences:
              - columnCounter: <upstream column's own columnCounter>
                stepCounter: <upstream node id>
            transform: ""
```

The wiring rule: the column's own `columnReference.stepCounter` is **this** node's
`id`; its `sourceColumnReferences…columnReferences.stepCounter` is the **upstream**
node's `id`, and that `columnCounter` is the **upstream column's** counter.

### System columns on the DV Stage (LDTS / RSRC)

No upstream ref; the value comes from a transform.

```yaml
      - acceptedValues: {strictMatch: true, values: []}
        appliedColumnTests: {}
        columnReference: {columnCounter: <uuid>, stepCounter: <stage id>}
        config: {}
        dataType: TIMESTAMP          # STRING for RSRC
        defaultValue: ""
        description: The Load Date Timestamp (LDTS) describes when this data first arrived in the Data Warehouse.
        is_system_ldts: true         # is_system_rsrc: true for RSRC
        name: LDTS                    # RSRC
        nullable: true
        sourceColumnReferences:
          - columnReferences: []
            transform: SYSDATE()      # "{{record_source()}}" for RSRC
```

Downstream nodes carry LDTS/RSRC as ordinary passthrough columns referencing the
stage's LDTS/RSRC.

### Hash column (DV Stage only)

Inputs go in the sibling `hashedColumns:` list — NOT under `hashDetails`.

```yaml
      - acceptedValues: {strictMatch: true, values: []}
        appliedColumnTests: {}
        columnReference: {columnCounter: <uuid>, stepCounter: <stage id>}
        config: {}
        dataType: STRING
        defaultValue: ""
        description: <Entity> Hub hash key
        hashDetails:
          hashAlgorithm: SHA1        # see "Hash algorithm" note in SKILL.md — MD5 actually renders
        hashedColumns:
          - columnCounter: <in-stage source column's counter>
            name: <source col name>
            stepCounter: <stage id>
        name: H_<ENTITY>_KEY
        nullable: true
        sourceColumnReferences: []
```

- `H_<ENTITY>_KEY` hashes the **business key**.
- `H_<HUBSHORT>_KEY` (one per FK) hashes that **FK column**.
- `L_<REL>_KEY` hashes the **business key + all FK columns**.
- `S_<ENTITY>_HASH` hashes **all descriptive attributes**.

### Config-flag columns (Hub / Link / Sat), downstream of the stage

Downstream nodes do NOT re-hash; they reference the stage's hash column by
source linkage and mark it with a column-level `config` flag:

```yaml
      - columnReference: {columnCounter: <uuid>, stepCounter: <this node id>}
        config:
          is_Hub_hk: true            # see table below
        dataType: STRING
        description: <Entity> Hub hash key
        name: H_<ENTITY>_KEY
        nullable: true
        sourceColumnReferences:
          - columnReferences:
              - columnCounter: <stage hash col counter>
                stepCounter: <stage id>
            transform: ""
```

| Node | Column | Flag |
|------|--------|------|
| Hub (`DV:::6`) | `H_<ENTITY>_KEY` | `is_Hub_hk: true` |
| Link (`DV:::7`) | `L_<REL>_KEY` | `is_Link_hk: true` |
| Sat V0 (`DV:::8`) | `H_<ENTITY>_KEY` | `is_hk: true` |
| Sat V0 (`DV:::8`) | `S_<ENTITY>_HASH` | `is_hd: true` |
| Sat V1 (`DV:::9`) | `H_<ENTITY>_KEY` | `is_hk: true` |

### Sat V1 end-dating columns (`DV:::9`)

Sat V1 passes through V0, then adds two system columns with LEAD-window
transforms (no upstream ref). Copy verbatim:

```yaml
      - acceptedValues: {strictMatch: true, values: []}
        appliedColumnTests: {}
        columnReference: {columnCounter: <uuid>, stepCounter: <satv1 id>}
        config: {}
        dataType: TIMESTAMP          # BOOLEAN for IS_CURRENT
        defaultValue: ""
        description: ""
        is_system_ledts: true        # is_system_current_col: true for IS_CURRENT
        name: LEDTS                   # IS_CURRENT
        nullable: true
        sourceColumnReferences:
          - columnReferences: []
            transform: |-
              <LEAD-window expression, see gen_dv.py LEDTS_TF / ISCUR_TF>
```

The transforms reference `datavault4coalesce.config.ldts_alias`,
`get_value_by_column_attribute("is_hk")`, and `end_of_all_times`. `gen_dv.py`
holds the exact strings (`LEDTS_TF`, `ISCUR_TF`) — reuse them rather than
retyping.

## Column ordering

- **Stage**: business key, FK columns, descriptive attrs, LDTS, RSRC,
  `H_<entity>_KEY`, `H_<fk hub>_KEY` (each), `L_<rel>_KEY`, `S_<entity>_HASH`.
- **Hub**: `H_<entity>_KEY`, business key, LDTS, RSRC.
- **Link**: `L_<rel>_KEY`, `H_<entity>_KEY`, each `H_<fk hub>_KEY`, business key,
  FK columns, LDTS, RSRC.
- **Sat V0**: `H_<entity>_KEY`, business key, attrs, LDTS, RSRC, `S_<entity>_HASH`.
- **Sat V1**: `H_<entity>_KEY`, business key, LDTS, RSRC, attrs, `S_<entity>_HASH`,
  LEDTS, IS_CURRENT.
