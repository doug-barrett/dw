# Node YAML templates (dw repo, V1)

Full skeletons for each node type as used in this repo. All share the same outer
shape:

```yaml
fileVersion: 1
id: <unique-uuid>              # unique across the whole workspace
name: <NODE_NAME>
operation:
  config: { ... }              # type-specific, see below
  database: ""
  deployEnabled: true
  description: ""
  isMultisource: false
  locationName: <BRONZE|SILVER|GOLD|PLATINUM>
  materializationType: <table|view>
  metadata:
    appliedNodeTests: []
    columns: [ ... ]           # see column block
    cteString: ""
    enabledColumnTestIDs: [ ... ]
    sourceMapping: [ ... ]     # see source mapping
  name: <NODE_NAME>
  overrideSQL: false
  schema: ""
  sqlType: <Source|Stage|Dimension|Fact|View>
  type: sql
  version: 1
type: Node
```

## Column block (mapped 1:1 from upstream)

```yaml
      - appliedColumnTests: {}
        columnReference:
          columnCounter: <fresh-uuid-unique-in-this-node>
          stepCounter: <this-node-id>
        config: {}
        dataType: <type>          # copy exact type from upstream
        description: ""
        name: <COLUMN_NAME>
        nullable: true
        sourceColumnReferences:
          - columnReferences:
              - columnCounter: <upstream-column-columnCounter>
                stepCounter: <upstream-node-id>
            transform: ""         # SQL expression, or "" for straight passthrough
```

## Source mapping (one per node)

```yaml
    sourceMapping:
      - aliases:
          <UPSTREAM_NODE_NAME>: <upstream-node-id>
        customSQL:
          customSQL: ""
        dependencies:
          - locationName: <upstream-location>
            nodeName: <UPSTREAM_NODE_NAME>
        join:
          joinCondition: FROM {{ ref('<LOCATION>', '<UPSTREAM_NODE_NAME>') }} "<UPSTREAM_NODE_NAME>"
        name: <THIS_NODE_NAME>
        noLinkRefs: []
```

## Stage config

```yaml
  config:
    insertStrategy: INSERT
    postSQL: ""
    preSQL: ""
    testsEnabled: true
    truncateBefore: true
```
`enabledColumnTestIDs: [hasNull, isDistinct]`; apply those two to the business
key column via its `appliedColumnTests: { hasNull: true, isDistinct: true }`.

## Dimension config + key columns

```yaml
  config:
    groupByAll: false
    insertStrategy: "UNION DISTINCT"
    orderby: false
    orderbycolumn:
      items:
        - {}
    postSQL: ""
    preSQL: ""
    selectDistinct: false
    testsEnabled: true
    truncateBefore: false
```
Plus a required `businessKeyColumns:` list under `metadata` naming the business
key(s).

Surrogate key (first column, auto-hashed — no source refs):
```yaml
      - acceptedValues:
          strictMatch: true
          values: []
        appliedColumnTests: {}
        columnReference:
          columnCounter: <fresh-uuid>
          stepCounter: <this-node-id>
        config: {}
        dataType: NUMBER
        defaultValue: ""
        description: ""
        isSurrogateKey: true
        name: DIM_<NAME>_KEY
        nullable: true
        sourceColumnReferences:
          - columnReferences: []
            transform: ""
```
Business key: a normal column block plus `isBusinessKey: true`.

System date columns (create + update):
```yaml
      - appliedColumnTests: {}
        columnReference:
          columnCounter: <fresh-uuid>
          stepCounter: <this-node-id>
        config: {}
        dataType: TIMESTAMP
        description: ""
        isSystemCreateDate: true        # or isSystemUpdateDate: true
        name: SYSTEM_CREATE_DATE        # or SYSTEM_UPDATE_DATE
        nullable: true
        sourceColumnReferences:
          - columnReferences: []
            transform: CAST(CURRENT_TIMESTAMP AS TIMESTAMP)
```

## Fact config

```yaml
  config:
    postSQL: ""
    preSQL: ""
    testsEnabled: true
```
Natural key column gets `isBusinessKey: true`; add the same two `SYSTEM_*` date
columns as the dimension. No surrogate key.

## View config (PLATINUM V_ and SILVER role-playing)

```yaml
  config:
    insertStrategy: UNION
    selectDistinct: false
```
`materializationType: view`. Pass every upstream column through 1:1 (surrogate
key and system dates included).

## Verification

```bash
~/.coalesce/desktop/coa validate
~/.coalesce/desktop/coa create --include "{ STG_<NAME> }+" --dry-run --verbose
```
`coa validate --json` emits a banner before the JSON in some builds — write to a
file and parse, then filter `data.occurrences` to the nodes you touched by
`target.nodeName`.
