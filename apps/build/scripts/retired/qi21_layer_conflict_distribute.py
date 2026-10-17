#!/usr/bin/env python3
"""qi21_bases.json 五路分发(10-09-qi21-prompt-layer-conflict Phase 5.3,design §5.1)。

源 → 装机 Resources / 构建产物 Resources / 引擎家 daojie-data / MA 镜像;目的地照 codex
10-09-qi21-source-prompt-review-fixes face-distribution-result.json 已走通的四路。
守卫:每路现值须等于 --expect-md5(批 A 改前值)或已等于源,否则拒写(他方改过);
逐路 cp 备份 backups/distribution/<n>-<名>.json → 复制 → 回读 md5 == 源。默认 dry-run。

用法:python3 apps/build/scripts/qi21_layer_conflict_distribute.py --expect-md5 <md5> [--apply]
"""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
TASK = REPO / ".trellis/tasks/10-09-qi21-prompt-layer-conflict"
_REL = "Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
DESTS = (
    ("installed", Path("/Applications/漫影工作室.app") / _REL),
    ("build", REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app" / _REL),
    ("engine-home", Path.home() / "Project/IP/漫影工作室/comfyui/daojie-data/qi21_bases.json"),
    ("ma-mirror", Path.home() / "Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--expect-md5", required=True, help="目的地允许被覆盖的旧值")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    src_raw = SOURCE.read_bytes()
    src_md5 = hashlib.md5(src_raw).hexdigest()
    rows = []
    for name, dest in DESTS:
        if not dest.is_file():
            raise SystemExit(f"{name} 不存在:{dest}(不新建)")
        cur = md5(dest)
        if cur not in (args.expect_md5, src_md5):
            raise SystemExit(f"{name} 现值 {cur} 非预期旧值/源值,他方改过,拒写:{dest}")
        rows.append({"name": name, "dest": str(dest), "before_md5": cur, "changed": cur != src_md5})
    if args.apply:
        bdir = TASK / "backups" / "distribution"
        bdir.mkdir(parents=True, exist_ok=True)
        for i, row in enumerate(rows, 1):
            dest = Path(row["dest"])
            if not row["changed"]:
                continue
            backup = bdir / f"{i}-{row['name']}.json"
            if backup.exists() and backup.read_bytes() != dest.read_bytes():
                raise SystemExit(f"{backup.name} 已存在且不同,拒绝覆盖备份")
            shutil.copy2(dest, backup)
            if SOURCE.read_bytes() != src_raw:
                raise SystemExit("源在分发中被改,停止")
            shutil.copyfile(SOURCE, dest)
            row["backup"] = str(backup.relative_to(REPO))
        for row in rows:
            row["after_md5"] = md5(Path(row["dest"]))
            assert row["after_md5"] == src_md5, row
    report = {"source": str(SOURCE.relative_to(REPO)), "source_md5": src_md5,
              "expect_md5": args.expect_md5, "applied": args.apply, "routes": rows,
              "all_equal": args.apply and all(r["after_md5"] == src_md5 for r in rows)}
    if args.apply:
        (TASK / "research" / "distribution.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
