# Data Vault models and spine diagrams

Design the vault from a **tagged source model** (see source-models.md); the roles are the
derivation rules. Propose it as **planned nodes** so the user reviews it in the app before anything
is built. If the source model isn't tagged yet, tag it first — that is where the real decisions are.

## Derivation rules

| Source metadata | Vault object |
|---|---|
| Node with a `businessKeyPart` set that identifies a business concept | **Hub** `HUB_<ENTITY>`: hash key + business key column(s) + LDTS + RSRC |
| `unitOfWorkMember` columns of one node (plus its own business key when it is also a member) | **Link** `LNK_<A>_<B>[_…]`: link hash key + one hub hash key per member |
| `dependentChildKey` | Extra key column in the link (and part of the link hash) |
| Node whose grain is *only* foreign keys (associative, e.g. PARTSUPP) | Link, not hub; its attributes go to a link satellite |
| `changeTracking` / `descriptive` columns | **Satellite(s)** on the hub or link of the node's grain |
| `pii` tag | Separate satellite `<SAT>_PII` (same parent hash key) |
| Different rates of change / source systems | Split satellites accordingly |
| `drivingKey` | **Effectivity satellite** on the link |
| `code` tag on a small code set | **Reference hub / reference table** (or leave in the satellite) |
| Events/transactions that never change (`measure`s at a UoW grain) | Non-historized link (+ satellite) |
| `ignore` | Not carried |

Every relation in the source model should be traceable to a link (or to a deliberate decision not
to model it — e.g. a direct LINEITEM → PART relation already covered by an order-line link).

## Naming and columns (this workspace's conventions; check the package variables for others)

- Hash keys: `HK_<ENTITY>_H` (hub), `HK_<A>_<B>_L` (link); hash diff `HD_<SAT>_S`;
  load metadata `LDTS`, `RSRC` (from `packages/Data-Vault.yml` → `ldts_alias`, `rsrc_alias`).
  `hash_datatype` there gives the hash key data type (`STRING`).
- Satellites: `SATV0_<NAME>` (table) and `SATV1_<NAME>` (view with `IS_CURRENT`).
- Locations: hubs/links/sats in the vault location (`CORE` here), the vault stage in `RAW_STAGE`.

Roles on vault columns: hub business key → `businessKeyPart`; link hub hash keys →
`unitOfWorkMember`; link dependent child → `dependentChildKey`; LDTS/RSRC/hash diff →
`systemAudit` (`changeTracking` on the hash diff is also used); satellite attributes keep the source
role (`changeTracking`/`descriptive`) and tags (`pii`). Hash keys get the `surrogateKey` tag.
Give every planned column `derivedFrom` pointing at the source column(s).

Relations: **satellite → its hub/link** (many-to-one on the hash key), **link → each hub**
(many-to-one per hub hash key). Hubs have no outgoing relations.

## Node type ids

Read them from `.coa/cache/packages/<alias>/nodeTypes/*/definition.yml` (`id`). In this workspace
(Scalefree package, alias `Data-Vault`): Hub `Data-Vault:::6`, Link `:::7`, Non-Historized Link
`:::23`, Satellite v0 `:::8`, v1 `:::9`, Multi-active Sat v0 `:::18`, Non-Historized Sat `:::24`,
Record-Tracking Sat `:::27`, Effectivity Sat v0 `:::44`, Reference Hub `:::33`, Reference Sat v0
`:::34`, PIT `:::12`, Stage `:::4`.

## Models to create

```yaml
models:
  data-vault:
    name: Data Vault
    type: Data Vault                      # → spine auto layout
    include: { nodeTypes: [Data-Vault:::6, Data-Vault:::7, Data-Vault:::23, Data-Vault:::33,
                           Data-Vault:::8, Data-Vault:::18, Data-Vault:::24, Data-Vault:::27,
                           Data-Vault:::34, Data-Vault:::44], locations: [] }
  spine:
    name: Spine
    type: Data Vault
    include: { nodeTypes: [Data-Vault:::6, Data-Vault:::7, Data-Vault:::23, Data-Vault:::33], locations: [] }
```

A **spine diagram** is hubs and links only (the business-key backbone); it is the best review
artefact for the integration design. Include v0 satellites (tables) in the full model, not v1 views,
to avoid duplicates.

## Spec sketch

```yaml
nodes:
  CORE-HUB_CUSTOMER:
    label: Customer
    planned: { nodeType: Data-Vault:::6, description: Hub of customers (business key c_custkey) }
    columns:
      HK_CUSTOMER_H: { label: Customer hash key, roles: [systemAudit], tags: [surrogateKey], planned: { dataType: STRING, derivedFrom: [EXTERNAL-CUSTOMER.c_custkey] } }
      C_CUSTKEY:     { label: Customer number, roles: [businessKeyPart], planned: { dataType: NUMBER(38,0), derivedFrom: [EXTERNAL-CUSTOMER.c_custkey] } }
      LDTS:          { roles: [systemAudit], planned: { dataType: TIMESTAMP_TZ } }
      RSRC:          { roles: [systemAudit], planned: { dataType: STRING } }
  CORE-LNK_CUSTOMER_ORDER:
    label: Customer order
    planned: { nodeType: Data-Vault:::7 }
    columns:
      HK_CUSTOMER_ORDER_L: { roles: [systemAudit], tags: [surrogateKey], planned: { dataType: STRING, derivedFrom: [SRC_TPCH-ORDERS.O_ORDERKEY, SRC_TPCH-ORDERS.O_CUSTKEY] } }
      HK_ORDER_H:    { roles: [unitOfWorkMember], planned: { dataType: STRING, derivedFrom: [SRC_TPCH-ORDERS.O_ORDERKEY] } }
      HK_CUSTOMER_H: { roles: [unitOfWorkMember], planned: { dataType: STRING, derivedFrom: [SRC_TPCH-ORDERS.O_CUSTKEY] } }
      LDTS: { roles: [systemAudit], planned: { dataType: TIMESTAMP_TZ } }
      RSRC: { roles: [systemAudit], planned: { dataType: STRING } }
    relations:
      - { to: CORE-HUB_CUSTOMER, label: customer, columns: { HK_CUSTOMER_H: HK_CUSTOMER_H } }
      - { to: CORE-HUB_ORDER, label: order, columns: { HK_ORDER_H: HK_ORDER_H } }
```

When the user approves, the vault is built with the `coalesce-*` skills (or a generator such as
`generate_dv.py`) using the same locations, names and column names; the app then turns the planned
files into normal metadata with `design:` history.
