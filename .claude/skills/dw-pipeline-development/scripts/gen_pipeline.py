#!/usr/bin/env python3
"""
Generate a standard dw pipeline (Stage -> Dimension|Fact -> View) from a
scaffolded BRONZE source node, with all column-counter / stepCounter wiring
filled in correctly.

Usage:
    python gen_pipeline.py <BRONZE-source.yml> --flavor dim --business-key DRIVER_ID
    python gen_pipeline.py <BRONZE-source.yml> --flavor fact --business-key TRIP_ID

Writes, next to the source's nodes/ dir:
    SILVER-STG_<NAME>.yml
    GOLD-DIM_<NAME>.yml   (or GOLD-FCT_<NAME>.yml)
    PLATINUM-V_<NAME>.yml

Edit the emitted files afterward for any custom transforms, then run:
    coa validate
    coa create --include "{ STG_<NAME> }+" --dry-run --verbose

This only writes YAML; it never touches the warehouse.
"""
import argparse
import os
import sys
import uuid

try:
    import yaml
except ImportError:
    sys.exit("PyYAML required: pip install pyyaml")


def uid():
    return str(uuid.uuid4())


def load_source(path):
    with open(path) as f:
        doc = yaml.safe_load(f)
    op = doc["operation"]
    src_id = doc["id"]
    name = doc["name"]
    cols = []
    for c in op["metadata"]["columns"]:
        cols.append((c["name"], c["dataType"], c["columnReference"]["columnCounter"]))
    return src_id, name, cols


def col_block(node_id, name, dtype, up_cc, up_id, *, business=False,
              surrogate=False, system=None):
    cc = uid()
    lines = []
    if surrogate:
        lines += ["      - acceptedValues:",
                  "          strictMatch: true",
                  "          values: []",
                  "        appliedColumnTests: {}"]
    elif business:
        lines += ["      - appliedColumnTests:",
                  "          hasNull: true",
                  "          isDistinct: true"]
    else:
        lines += ["      - appliedColumnTests: {}"]
    lines += ["        columnReference:",
              f"          columnCounter: {cc}",
              f"          stepCounter: {node_id}",
              "        config: {}",
              f"        dataType: {dtype}"]
    if surrogate:
        lines.append('        defaultValue: ""')
    lines.append('        description: ""')
    if surrogate:
        lines.append("        isSurrogateKey: true")
    if business:
        lines.append("        isBusinessKey: true")
    if system:
        lines.append(f"        {system}: true")
    lines += [f"        name: {name}",
              "        nullable: true",
              "        sourceColumnReferences:"]
    if up_cc:
        lines += ["          - columnReferences:",
                  f"              - columnCounter: {up_cc}",
                  f"                stepCounter: {up_id}",
                  '            transform: ""']
    elif system:
        # surrogate/system columns have no upstream column; empty refs + transform
        lines += ["          - columnReferences: []",
                  "            transform: CAST(CURRENT_TIMESTAMP AS TIMESTAMP)"]
    else:  # surrogate key
        lines += ["          - columnReferences: []",
                  '            transform: ""']
    return cc, "\n".join(lines) + "\n"


def source_mapping(this_name, up_name, up_id, up_loc):
    return (f"""    sourceMapping:
      - aliases:
          {up_name}: {up_id}
        customSQL:
          customSQL: ""
        dependencies:
          - locationName: {up_loc}
            nodeName: {up_name}
        join:
          joinCondition: FROM {{{{ ref('{up_loc}', '{up_name}') }}}} "{up_name}"
        name: {this_name}
        noLinkRefs: []
""")


def wrap(node_id, name, loc, mat, sqltype, config, cols_yaml, enabled, mapping,
         business_keys=None):
    bk = ""
    if business_keys:
        bk = "    businessKeyColumns:\n" + "".join(
            f"      - {k}\n" for k in business_keys)
    enabled_yaml = "    enabledColumnTestIDs: []\n"
    if enabled:
        enabled_yaml = "    enabledColumnTestIDs:\n" + "".join(
            f"      - {e}\n" for e in enabled)
    return (f"""fileVersion: 1
id: {node_id}
name: {name}
operation:
{config}  database: ""
  deployEnabled: true
  description: ""
  isMultisource: false
  locationName: {loc}
  materializationType: {mat}
  metadata:
    appliedNodeTests: []
{bk}    columns:
{cols_yaml}    cteString: ""
{enabled_yaml}{mapping}  name: {name}
  overrideSQL: false
  schema: ""
  sqlType: {sqltype}
  type: sql
  version: 1
type: Node
""")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="path to BRONZE-<TABLE>.yml")
    ap.add_argument("--flavor", choices=["dim", "fact"], required=True)
    ap.add_argument("--business-key", required=True,
                    help="column name of the natural/business key")
    ap.add_argument("--name", help="base name (default: source name)")
    args = ap.parse_args()

    src_id, src_name, cols = load_source(args.source)
    base = args.name or src_name
    nodes_dir = os.path.dirname(os.path.abspath(args.source))
    bk = args.business_key.upper()
    colnames = {c[0] for c in cols}
    if bk not in colnames:
        sys.exit(f"business key {bk} not found in source columns: {sorted(colnames)}")

    # ---- STAGE ----
    stg_id = uid()
    stg_map = {}
    blocks = []
    for n, dt, src_cc in cols:
        cc, b = col_block(stg_id, n, dt, src_cc, src_id, business=(n == bk))
        stg_map[n] = cc
        blocks.append(b)
    stage = wrap(stg_id, f"STG_{base}", "SILVER", "table", "Stage",
                 ("  config:\n    insertStrategy: INSERT\n    postSQL: \"\"\n"
                  "    preSQL: \"\"\n    testsEnabled: true\n    truncateBefore: true\n"),
                 "".join(blocks), ["hasNull", "isDistinct"],
                 source_mapping(f"STG_{base}", src_name, src_id, "BRONZE"))

    # ---- GOLD (dim or fact) ----
    gold_id = uid()
    gmap = {}
    gblocks = []
    if args.flavor == "dim":
        cc, b = col_block(gold_id, f"DIM_{base}_KEY", "NUMBER", None, None,
                          surrogate=True)
        gmap[f"DIM_{base}_KEY"] = cc
        gblocks.append(b)
    for n, dt, _ in cols:
        cc, b = col_block(gold_id, n, dt, stg_map[n], stg_id,
                          business=(n == bk))
        gmap[n] = cc
        gblocks.append(b)
    for sysname, flag in [("SYSTEM_CREATE_DATE", "isSystemCreateDate"),
                          ("SYSTEM_UPDATE_DATE", "isSystemUpdateDate")]:
        cc, b = col_block(gold_id, sysname, "TIMESTAMP", None, None, system=flag)
        gmap[sysname] = cc
        gblocks.append(b)

    if args.flavor == "dim":
        gold = wrap(gold_id, f"DIM_{base}", "GOLD", "table", "Dimension",
                    ("  config:\n    groupByAll: false\n"
                     "    insertStrategy: \"UNION DISTINCT\"\n    orderby: false\n"
                     "    orderbycolumn:\n      items:\n        - {}\n"
                     "    postSQL: \"\"\n    preSQL: \"\"\n    selectDistinct: false\n"
                     "    testsEnabled: true\n    truncateBefore: false\n"),
                    "".join(gblocks), [],
                    source_mapping(f"DIM_{base}", f"STG_{base}", stg_id, "SILVER"),
                    business_keys=[bk])
        gold_name = f"DIM_{base}"
    else:
        gold = wrap(gold_id, f"FCT_{base}", "GOLD", "table", "Fact",
                    "  config:\n    postSQL: \"\"\n    preSQL: \"\"\n    testsEnabled: true\n",
                    "".join(gblocks), [],
                    source_mapping(f"FCT_{base}", f"STG_{base}", stg_id, "SILVER"))
        gold_name = f"FCT_{base}"

    # ---- VIEW (PLATINUM) ----
    v_id = uid()
    order = ([f"DIM_{base}_KEY"] if args.flavor == "dim" else []) \
        + [c[0] for c in cols] + ["SYSTEM_CREATE_DATE", "SYSTEM_UPDATE_DATE"]
    dtypes = {c[0]: c[1] for c in cols}
    dtypes.update({f"DIM_{base}_KEY": "NUMBER",
                   "SYSTEM_CREATE_DATE": "TIMESTAMP",
                   "SYSTEM_UPDATE_DATE": "TIMESTAMP"})
    vblocks = []
    for n in order:
        _, b = col_block(v_id, n, dtypes[n], gmap[n], gold_id)
        vblocks.append(b)
    view = wrap(v_id, f"V_{base}", "PLATINUM", "view", "View",
                "  config:\n    insertStrategy: UNION\n    selectDistinct: false\n",
                "".join(vblocks), [],
                source_mapping(f"V_{base}", gold_name, gold_id, "GOLD"))

    outs = {
        f"SILVER-STG_{base}.yml": stage,
        f"{'GOLD-DIM_' if args.flavor=='dim' else 'GOLD-FCT_'}{base}.yml": gold,
        f"PLATINUM-V_{base}.yml": view,
    }
    for fname, content in outs.items():
        with open(os.path.join(nodes_dir, fname), "w") as f:
            f.write(content)
        print("wrote", fname)
    print(f"\nverify:\n  coa validate\n  coa create --include \"{{ STG_{base} }}+\" --dry-run --verbose")


if __name__ == "__main__":
    main()
