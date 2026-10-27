# gen_dv.py reference

`scripts/gen_dv.py` emits a full raw Data Vault chain from one scaffolded
BRONZE source node, with every `columnCounter` / `stepCounter` / hash wiring
filled in. It only writes YAML — it never touches the warehouse.

## Invocation

```
python3 scripts/gen_dv.py <BRONZE-source.yml> --business-key <COL> [options]
```

## Flags

| Flag | Required | Meaning |
|------|----------|---------|
| `source` (positional) | yes | path to `nodes/BRONZE-<TABLE>.yml` |
| `--business-key COL` | yes | business/natural key column → hub key + `H_<ENTITY>_KEY` |
| `--entity SHORT` | no | entity short name (default: source name). Drives `HUB_<SHORT>`, `SATV0/1_<SHORT>`, `H_<SHORT>_KEY`, `S_<SHORT>_HASH` |
| `--fk COL:HUBSHORT` | no, repeatable | a foreign key column and the hub short it points at. Emits `H_<HUBSHORT>_KEY` in the stage and adds the column to the link. Any `--fk` produces a Link node |
| `--link-name NAME` | no | link suffix → `LINK_<NAME>`, `L_<NAME>_KEY` (default: `<ENTITY>_<fk hubs joined by _>`) |
| `--stage-name SFX` | no | DV Stage suffix → `DVSTG_<SFX>` (default: source name) |
| `--exclude COL` | no, repeatable | drop a source column entirely (neither attr nor key) |

## Column assignment

- `--business-key` → hub business key; hashed into `H_<ENTITY>_KEY`.
- each `--fk` column → hashed into its own `H_<HUBSHORT>_KEY`; carried into the
  link; **excluded from the satellite**.
- `--exclude` columns → dropped.
- **everything else** → satellite descriptive attributes; hashed together into
  `S_<ENTITY>_HASH`.

The link hash `L_<NAME>_KEY` hashes the business key **plus all FK columns**.

## Outputs (written next to the source, SILVER location)

```
SILVER-DVSTG_<SFX>.yml     DV:::4  view    source cols + LDTS/RSRC + hashes
SILVER-HUB_<ENTITY>.yml    DV:::6  table   H key + business key + LDTS/RSRC
SILVER-LINK_<NAME>.yml     DV:::7  table   (only when --fk given)
SILVER-SATV0_<ENTITY>.yml  DV:::8  table   H key + attrs + LDTS/RSRC + S hashdiff
SILVER-SATV1_<ENTITY>.yml  DV:::9  view    V0 passthrough + LEDTS + IS_CURRENT
```

## After generating

Edit for custom transforms if needed, then:

```
coa validate
coa create --include "{ DVSTG_<SFX> }+" --dry-run --verbose
coa run    --include "{ DVSTG_<SFX> }+" --dry-run
```

## Notes

- A full entity with N FKs is self-contained for dry-run: the stage computes all
  the `H_<hub>_KEY` hashes it needs, so the chain validates on its own even
  before the referenced hubs' own chains are built.
- Hubs for FK targets are NOT emitted by the FK side — build each hub from its
  own entity run (e.g. `--entity VENDOR --business-key VENDOR_ID`).
- Requires PyYAML (`pip install pyyaml`).
- The generator reproduces the exact shape of the vault already committed, so
  regenerating an existing entity differs only in freshly-minted UUIDs.
