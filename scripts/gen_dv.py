#!/usr/bin/env python3
"""
Generate a raw Data Vault 2.0 chain (DV Stage -> Hub -> [Link] -> Sat V0 ->
Sat V1) from a scaffolded BRONZE source node, with every column-counter /
stepCounter / hash wiring filled in correctly.

This is the Data Vault sibling of scripts/../.claude/skills/dw-pipeline-development/
scripts/gen_pipeline.py. It uses the Scalefree datavault4coalesce package (alias
DV, installed via packages/DV.yml). All emitted nodes are V1 YAML.

Usage
-----
Plain dimension entity (hub + satellite, no link):
    python gen_dv.py nodes/BRONZE-VENDOR.yml --entity VENDOR --business-key VENDOR_ID

Entity with one relationship (adds a link):
    python gen_dv.py nodes/BRONZE-DRIVERS.yml --entity DRIVER \
        --business-key DRIVER_ID --fk VENDOR_ID:VENDOR --link-name DRIVER_VENDOR

Transaction / unit-of-work link over several FKs (role-playing allowed):
    python gen_dv.py nodes/BRONZE-YELLOW_CAB_TRIPS.yml --entity TRIP \
        --business-key TRIP_ID \
        --fk VENDOR_ID:VENDOR --fk PAYMENT_TYPE_ID:PAYMENT --fk RATE_CODE_ID:RATE \
        --fk PU_LOCATION_ID:PU_LOCATION --fk DO_LOCATION_ID:DO_LOCATION \
        --link-name TRIP_VENDOR_PAYMENT_RATE_LOCATION

--fk is COLUMN:HUBSHORT. HUBSHORT names the hub the FK points at, so the stage
gets H_<HUBSHORT>_KEY and the link references it. The hub short deliberately
need not match the column (PAYMENT_TYPE_ID -> PAYMENT, PU_LOCATION_ID ->
PU_LOCATION), which is how role-playing is expressed.

What each column becomes
------------------------
  business key        -> hub business key + H_<ENTITY>_KEY hash (hashes the BK)
  foreign key(s)      -> H_<HUBSHORT>_KEY hash each + the link; NOT in the satellite
  everything else     -> satellite descriptive attrs + S_<ENTITY>_HASH (hashdiff)
Use --exclude COL (repeatable) to drop a source column entirely.

Writes (next to the source's nodes/ dir, SILVER location):
    SILVER-DVSTG_<STAGE>.yml      (DV:::4, view)
    SILVER-HUB_<ENTITY>.yml       (DV:::6, table)
    SILVER-LINK_<LINK>.yml        (DV:::7, table)   -- only when --fk given
    SILVER-SATV0_<ENTITY>.yml     (DV:::8, table)
    SILVER-SATV1_<ENTITY>.yml     (DV:::9, view)

Edit the emitted files afterward for any custom transforms, then verify:
    coa validate
    coa create --include "{ DVSTG_<STAGE> }+" --dry-run --verbose

This only writes YAML; it never touches the warehouse.

Two gotchas this generator already handles for you:

1. Node types are referenced as `DV:::<id>`. The bare id (e.g. "4") collides
   with this repo's local nodeTypes/DateStage-4 and silently renders the wrong
   (date-generator) template -- always keep the DV::: selector.

2. Hash inputs live in a sibling `hashedColumns:` list of {columnCounter, name,
   stepCounter} refs, NOT under hashDetails. Getting this wrong renders the hash
   column as a literal NULL.

Hash ALGORITHM: the emitted nodes carry `hashDetails.hashAlgorithm: SHA1`, but
this datavault4coalesce version does NOT honor the node-level setting -- the
rendered SQL uses whatever `"hash"` is set to in packages/DV.yml global config
(currently MD5). To change the algorithm for the whole vault, edit that package
config, not the node YAML.
"""
import argparse
import os
import sys
import uuid

try:
    import yaml
except ImportError:
    sys.exit("PyYAML required: pip install pyyaml")

LDTS_DESC = ("The Load Date Timestamp (LDTS) describes when this data first "
             "arrived in the Data Warehouse.")
RSRC_DESC = "The Record Source (RSRC) describes the source of this data."

# SATV1 end-dating transforms (verbatim from the datavault4coalesce templates).
LEDTS_TF = (
    'COALESCE(LEAD("{{ datavault4coalesce.config.ldts_alias }}" - INTERVAL \'1 MICROSECOND\') \n'
    'OVER (PARTITION BY "{{ get_value_by_column_attribute("is_hk") }}" \n'
    'ORDER BY "{{ datavault4coalesce.config.ldts_alias }}"), '
    '{{ datavault4coalesce__string_to_timestamp(datavault4coalesce.config.timestamp_format, '
    'datavault4coalesce.config.end_of_all_times) }})')
ISCUR_TF = (
    'CASE \n  WHEN \n    LEAD("{{ datavault4coalesce.config.ldts_alias }}" - INTERVAL \'1 MICROSECOND\') \n'
    '    OVER (PARTITION BY "{{ get_value_by_column_attribute("is_hk") }}" \n'
    '    ORDER BY "{{ datavault4coalesce.config.ldts_alias }}") IS NULL \n'
    '  THEN TRUE \n  ELSE FALSE \nEND')


def uid():
    return str(uuid.uuid4())


def load_source(path):
    """Return (node_id, name, {colname: (dataType, columnCounter)})."""
    with open(path) as f:
        doc = yaml.safe_load(f)
    src_id = doc["id"]
    name = doc["name"]
    cols = {}
    for c in doc["operation"]["metadata"]["columns"]:
        cols[c["name"]] = (c["dataType"], c["columnReference"]["columnCounter"])
    return src_id, name, cols


# ---- column-block builders (strings; indentation matches validated output) ----

def col_pass(name, dtype, cc, nid, up_cc, up_id, desc=""):
    """Passthrough column referencing one upstream column."""
    return (f"      - columnReference:\n"
            f"          columnCounter: {cc}\n"
            f"          stepCounter: {nid}\n"
            f"        dataType: {dtype}\n"
            f"        description: {desc!r}\n"
            f"        name: {name}\n"
            f"        nullable: true\n"
            f"        sourceColumnReferences:\n"
            f"          - columnReferences:\n"
            f"              - columnCounter: {up_cc}\n"
            f"                stepCounter: {up_id}\n"
            f"            transform: \"\"\n")


def col_cfg(name, dtype, cc, nid, up_cc, up_id, cfgline, desc=""):
    """Passthrough column carrying a datavault4coalesce config flag."""
    return (f"      - columnReference:\n"
            f"          columnCounter: {cc}\n"
            f"          stepCounter: {nid}\n"
            f"        config:\n"
            f"          {cfgline}\n"
            f"        dataType: {dtype}\n"
            f"        description: {desc!r}\n"
            f"        name: {name}\n"
            f"        nullable: true\n"
            f"        sourceColumnReferences:\n"
            f"          - columnReferences:\n"
            f"              - columnCounter: {up_cc}\n"
            f"                stepCounter: {up_id}\n"
            f"            transform: \"\"\n")


def col_system(name, dtype, cc, nid, flag, transform):
    """System column with no upstream ref (LDTS/RSRC on the stage)."""
    desc = {"is_system_ldts": LDTS_DESC, "is_system_rsrc": RSRC_DESC}.get(flag, "")
    return (f"      - acceptedValues:\n"
            f"          strictMatch: true\n"
            f"          values: []\n"
            f"        appliedColumnTests: {{}}\n"
            f"        columnReference:\n"
            f"          columnCounter: {cc}\n"
            f"          stepCounter: {nid}\n"
            f"        config: {{}}\n"
            f"        dataType: {dtype}\n"
            f"        defaultValue: \"\"\n"
            f"        description: {desc}\n"
            f"        {flag}: true\n"
            f"        name: {name}\n"
            f"        nullable: true\n"
            f"        sourceColumnReferences:\n"
            f"          - columnReferences: []\n"
            f"            transform: {transform}\n")


def col_hash(name, cc, nid, inputs, desc):
    """DV Stage hash column. `inputs` is a list of (in_node_cc, src_name)."""
    hc = "".join(
        f"          - columnCounter: {c}\n"
        f"            name: {n}\n"
        f"            stepCounter: {nid}\n"
        for c, n in inputs)
    return (f"      - acceptedValues:\n"
            f"          strictMatch: true\n"
            f"          values: []\n"
            f"        appliedColumnTests: {{}}\n"
            f"        columnReference:\n"
            f"          columnCounter: {cc}\n"
            f"          stepCounter: {nid}\n"
            f"        config: {{}}\n"
            f"        dataType: STRING\n"
            f"        defaultValue: \"\"\n"
            f"        description: {desc}\n"
            f"        hashDetails:\n"
            f"          hashAlgorithm: SHA1\n"
            f"        hashedColumns:\n"
            f"{hc}"
            f"        name: {name}\n"
            f"        nullable: true\n"
            f"        sourceColumnReferences: []\n")


def col_tf(name, dtype, cc, nid, flag, transform):
    """SATV1 end-dating column (multi-line Jinja transform, no upstream ref)."""
    ind = "\n              ".join(transform.split("\n"))
    return (f"      - acceptedValues:\n"
            f"          strictMatch: true\n"
            f"          values: []\n"
            f"        appliedColumnTests: {{}}\n"
            f"        columnReference:\n"
            f"          columnCounter: {cc}\n"
            f"          stepCounter: {nid}\n"
            f"        config: {{}}\n"
            f"        dataType: {dtype}\n"
            f"        defaultValue: \"\"\n"
            f"        description: \"\"\n"
            f"        {flag}: true\n"
            f"        name: {name}\n"
            f"        nullable: true\n"
            f"        sourceColumnReferences:\n"
            f"          - columnReferences: []\n"
            f"            transform: |-\n"
            f"              {ind}\n")


def source_mapping(this_name, up_name, up_id, up_loc):
    return (f"    sourceMapping:\n"
            f"      - aliases:\n"
            f"          {up_name}: {up_id}\n"
            f"        customSQL:\n"
            f"          customSQL: \"\"\n"
            f"        dependencies:\n"
            f"          - locationName: {up_loc}\n"
            f"            nodeName: {up_name}\n"
            f"        join:\n"
            f"          joinCondition: FROM {{{{ ref('{up_loc}', '{up_name}') }}}} \"{up_name}\"\n"
            f"        name: {this_name}\n"
            f"        noLinkRefs: []\n")


def wrap(node_id, name, loc, mat, sqltype, config, cols_yaml, mapping):
    return (f"fileVersion: 1\n"
            f"id: {node_id}\n"
            f"name: {name}\n"
            f"operation:\n"
            f"{config}"
            f"  database: \"\"\n"
            f"  deployEnabled: true\n"
            f"  description: \"\"\n"
            f"  isMultisource: false\n"
            f"  locationName: {loc}\n"
            f"  materializationType: {mat}\n"
            f"  metadata:\n"
            f"    appliedNodeTests: []\n"
            f"    columns:\n"
            f"{cols_yaml}"
            f"    cteString: \"\"\n"
            f"    enabledColumnTestIDs: []\n"
            f"{mapping}"
            f"  name: {name}\n"
            f"  overrideSQL: false\n"
            f"  schema: \"\"\n"
            f"  sqlType: {sqltype}\n"
            f"  type: sql\n"
            f"  version: 1\n"
            f"type: Node\n")


# node-level config blocks (operation.config)
CFG_STAGE = ("  config:\n    contains_multiactive_data: false\n"
             "    generate_ghost_records: true\n")
CFG_HUB = ("  config:\n    disable_hwm: true\n    postSQL: \"\"\n"
           "    preSQL: \"\"\n    testsEnabled: true\n")
CFG_LINK = CFG_HUB
CFG_SATV0 = ("  config:\n    disable_hwm: false\n    postSQL: \"\"\n"
             "    preSQL: \"\"\n    testsEnabled: true\n")
CFG_SATV1 = "  config:\n    postSQL: \"\"\n    preSQL: \"\"\n"


def parse_fk(spec):
    if ":" not in spec:
        sys.exit(f"--fk must be COLUMN:HUBSHORT, got {spec!r}")
    col, hub = spec.split(":", 1)
    return col.strip().upper(), hub.strip().upper()


def main():
    ap = argparse.ArgumentParser(
        description="Generate a raw Data Vault chain from a BRONZE source node.")
    ap.add_argument("source", help="path to BRONZE-<TABLE>.yml")
    ap.add_argument("--entity", help="entity short name (default: source name)")
    ap.add_argument("--business-key", required=True,
                    help="business/natural key column -> hub key")
    ap.add_argument("--fk", action="append", default=[], metavar="COL:HUBSHORT",
                    help="foreign key column and the hub short it points at "
                         "(repeatable); any --fk adds a link node")
    ap.add_argument("--link-name",
                    help="link suffix -> LINK_<name>, L_<name>_KEY "
                         "(default: <ENTITY>_<fk hubs>)")
    ap.add_argument("--stage-name",
                    help="DV Stage suffix (default: source name)")
    ap.add_argument("--exclude", action="append", default=[], metavar="COL",
                    help="source column to drop entirely (repeatable)")
    args = ap.parse_args()

    src_id, src_name, src_cols = load_source(args.source)
    nodes_dir = os.path.dirname(os.path.abspath(args.source))
    entity = (args.entity or src_name).upper()
    stage_sfx = (args.stage_name or src_name).upper()
    bk = args.business_key.upper()
    exclude = {c.upper() for c in args.exclude}
    fks = [parse_fk(s) for s in args.fk]
    fk_cols = [c for c, _ in fks]

    if bk not in src_cols:
        sys.exit(f"business key {bk} not in source columns: {sorted(src_cols)}")
    for c, _ in fks:
        if c not in src_cols:
            sys.exit(f"fk column {c} not in source columns: {sorted(src_cols)}")

    # attributes = everything that is not the bk, an fk, or excluded
    attrs = [n for n in src_cols
             if n != bk and n not in fk_cols and n not in exclude]

    link_name = args.link_name
    if fks and not link_name:
        link_name = "_".join([entity] + [hub for _, hub in fks])
    if link_name:
        link_name = link_name.upper()

    hk = f"H_{entity}_KEY"          # this entity's hub hash key
    sh = f"S_{entity}_HASH"         # this entity's satellite change hash
    stage = f"DVSTG_{stage_sfx}"

    bk_dt = src_cols[bk][0]
    fk_dt = {c: src_cols[c][0] for c in fk_cols}
    attr_dt = {n: src_cols[n][0] for n in attrs}

    # ---- node ids ----
    sid, hubid, lnkid, s0id, s1id = uid(), uid(), uid(), uid(), uid()

    # ================= DV STAGE (DV:::4, view) =================
    # in-stage counters per column
    bk_s = uid()
    fk_s = {c: uid() for c in fk_cols}
    attr_s = {n: uid() for n in attrs}
    ld_s, rs_s, hk_s, sh_s = uid(), uid(), uid(), uid()
    fkhub_s = {hub: uid() for _, hub in fks}   # H_<hub>_KEY counters
    lk_s = uid() if fks else None              # link key counter

    cols = [col_pass(bk, bk_dt, bk_s, sid, src_cols[bk][1], src_id)]
    for c in fk_cols:
        cols.append(col_pass(c, fk_dt[c], fk_s[c], sid, src_cols[c][1], src_id))
    for n in attrs:
        cols.append(col_pass(n, attr_dt[n], attr_s[n], sid, src_cols[n][1], src_id))
    cols.append(col_system("LDTS", "TIMESTAMP", ld_s, sid, "is_system_ldts", "SYSDATE()"))
    cols.append(col_system("RSRC", "STRING", rs_s, sid, "is_system_rsrc",
                           "\"{{record_source()}}\""))
    cols.append(col_hash(hk, hk_s, sid, [(bk_s, bk)], f"{entity.title()} Hub hash key"))
    for c, hub in fks:
        cols.append(col_hash(f"H_{hub}_KEY", fkhub_s[hub], sid,
                             [(fk_s[c], c)], f"{hub.title()} Hub hash key"))
    if fks:
        link_inputs = [(bk_s, bk)] + [(fk_s[c], c) for c in fk_cols]
        cols.append(col_hash(f"L_{link_name}_KEY", lk_s, sid, link_inputs,
                             f"{link_name.title()} Link hash key"))
    cols.append(col_hash(sh, sh_s, sid, [(attr_s[n], n) for n in attrs],
                         f"{entity.title()} Satellite change hash key"))
    stage_yaml = wrap(sid, stage, "SILVER", "view", "DV:::4", CFG_STAGE,
                      "".join(cols),
                      source_mapping(stage, src_name, src_id, "BRONZE"))

    # ================= HUB (DV:::6, table) =================
    h_hk, h_bk, h_ld, h_rs = uid(), uid(), uid(), uid()
    hcols = [
        col_cfg(hk, "STRING", h_hk, hubid, hk_s, sid, "is_Hub_hk: true",
                desc=f"{entity.title()} Hub hash key"),
        col_pass(bk, bk_dt, h_bk, hubid, bk_s, sid),
        col_pass("LDTS", "TIMESTAMP", h_ld, hubid, ld_s, sid, desc=LDTS_DESC),
        col_pass("RSRC", "STRING", h_rs, hubid, rs_s, sid, desc=RSRC_DESC),
    ]
    hub_yaml = wrap(hubid, f"HUB_{entity}", "SILVER", "table", "DV:::6", CFG_HUB,
                    "".join(hcols),
                    source_mapping(f"HUB_{entity}", stage, sid, "SILVER"))

    # ================= LINK (DV:::7, table) -- only with FKs =================
    link_yaml = None
    if fks:
        l_lk = uid()
        l_hub = {entity: uid()}
        l_hub.update({hub: uid() for _, hub in fks})
        l_bk = uid()
        l_fk = {c: uid() for c in fk_cols}
        l_ld, l_rs = uid(), uid()
        lcols = [col_cfg(f"L_{link_name}_KEY", "STRING", l_lk, lnkid, lk_s, sid,
                         "is_Link_hk: true", desc=f"{link_name.title()} Link hash key")]
        # hub hash keys: this entity first, then each fk hub
        lcols.append(col_pass(hk, "STRING", l_hub[entity], lnkid, hk_s, sid,
                              desc=f"{entity.title()} Hub hash key"))
        for _, hub in fks:
            lcols.append(col_pass(f"H_{hub}_KEY", "STRING", l_hub[hub], lnkid,
                                  fkhub_s[hub], sid, desc=f"{hub.title()} Hub hash key"))
        # business keys carried for readability
        lcols.append(col_pass(bk, bk_dt, l_bk, lnkid, bk_s, sid))
        for c in fk_cols:
            lcols.append(col_pass(c, fk_dt[c], l_fk[c], lnkid, fk_s[c], sid))
        lcols.append(col_pass("LDTS", "TIMESTAMP", l_ld, lnkid, ld_s, sid, desc=LDTS_DESC))
        lcols.append(col_pass("RSRC", "STRING", l_rs, lnkid, rs_s, sid, desc=RSRC_DESC))
        link_yaml = wrap(lnkid, f"LINK_{link_name}", "SILVER", "table", "DV:::7",
                         CFG_LINK, "".join(lcols),
                         source_mapping(f"LINK_{link_name}", stage, sid, "SILVER"))

    # ================= SAT V0 (DV:::8, table) =================
    s0_hk, s0_bk, s0_ld, s0_rs, s0_sh = uid(), uid(), uid(), uid(), uid()
    s0_attr = {n: uid() for n in attrs}
    scols = [
        col_cfg(hk, "STRING", s0_hk, s0id, hk_s, sid, "is_hk: true",
                desc=f"{entity.title()} Hub hash key"),
        col_pass(bk, bk_dt, s0_bk, s0id, bk_s, sid),
    ]
    for n in attrs:
        scols.append(col_pass(n, attr_dt[n], s0_attr[n], s0id, attr_s[n], sid))
    scols.append(col_pass("LDTS", "TIMESTAMP", s0_ld, s0id, ld_s, sid, desc=LDTS_DESC))
    scols.append(col_pass("RSRC", "STRING", s0_rs, s0id, rs_s, sid, desc=RSRC_DESC))
    scols.append(col_cfg(sh, "STRING", s0_sh, s0id, sh_s, sid, "is_hd: true",
                         desc=f"{entity.title()} Satellite change hash key"))
    satv0_yaml = wrap(s0id, f"SATV0_{entity}", "SILVER", "table", "DV:::8", CFG_SATV0,
                      "".join(scols),
                      source_mapping(f"SATV0_{entity}", stage, sid, "SILVER"))

    # ================= SAT V1 (DV:::9, view) =================
    s1_hk, s1_bk, s1_ld, s1_rs, s1_sh = uid(), uid(), uid(), uid(), uid()
    s1_attr = {n: uid() for n in attrs}
    s1_le, s1_ic = uid(), uid()
    vcols = [
        col_cfg(hk, "STRING", s1_hk, s1id, s0_hk, s0id, "is_hk: true",
                desc=f"{entity.title()} Hub hash key"),
        col_pass(bk, bk_dt, s1_bk, s1id, s0_bk, s0id),
        col_pass("LDTS", "TIMESTAMP", s1_ld, s1id, s0_ld, s0id, desc=LDTS_DESC),
        col_pass("RSRC", "STRING", s1_rs, s1id, s0_rs, s0id, desc=RSRC_DESC),
    ]
    for n in attrs:
        vcols.append(col_pass(n, attr_dt[n], s1_attr[n], s1id, s0_attr[n], s0id))
    vcols.append(col_pass(sh, "STRING", s1_sh, s1id, s0_sh, s0id))
    vcols.append(col_tf("LEDTS", "TIMESTAMP", s1_le, s1id, "is_system_ledts", LEDTS_TF))
    vcols.append(col_tf("IS_CURRENT", "BOOLEAN", s1_ic, s1id, "is_system_current_col", ISCUR_TF))
    satv1_yaml = wrap(s1id, f"SATV1_{entity}", "SILVER", "view", "DV:::9", CFG_SATV1,
                      "".join(vcols),
                      source_mapping(f"SATV1_{entity}", f"SATV0_{entity}", s0id, "SILVER"))

    # ---- write ----
    outs = {
        f"SILVER-{stage}.yml": stage_yaml,
        f"SILVER-HUB_{entity}.yml": hub_yaml,
        f"SILVER-SATV0_{entity}.yml": satv0_yaml,
        f"SILVER-SATV1_{entity}.yml": satv1_yaml,
    }
    if link_yaml:
        outs[f"SILVER-LINK_{link_name}.yml"] = link_yaml
    for fname, content in sorted(outs.items()):
        with open(os.path.join(nodes_dir, fname), "w") as f:
            f.write(content)
        print("wrote", fname)
    print(f"\nverify:\n  coa validate\n"
          f"  coa create --include \"{{ {stage} }}+\" --dry-run --verbose")


if __name__ == "__main__":
    main()
