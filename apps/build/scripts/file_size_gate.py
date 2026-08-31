#!/usr/bin/env python3
"""文件尺寸门禁——大文件必须按 功能/模型/工具 拆分(用户裁定 2026-08-31)。

预算:源码文件 ≤500 行(警告线)/ ≤800 行(强制拆分线)。
豁免:测试(*.test.* / test_*.py / *_test.py)、生成物(*.generated.* / __pycache__)、
vendor、__fixtures__、数据 spec 类(见豁免清单 json)。
用法:
  python3 file_size_gate.py            # 列清单(警告+超线),超线退出码 1
  python3 file_size_gate.py --json     # 机器可读输出
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WARN, HARD = 500, 800
EXEMPT_JSON = Path(__file__).resolve().parent / "file-size-gate-exemptions.json"


def is_test(p: Path) -> bool:
    return (".test." in p.name or p.name.startswith("test_")
            or p.name.endswith("_test.py") or p.name.endswith("_test.ts"))


def is_exempt(p: Path) -> bool:
    segs = set(p.parts)
    if segs & {"node_modules", "out", "release", ".vite", "__pycache__", "vendor", "__fixtures__"}:
        return True
    if ".generated." in p.name or p.name.endswith(".generated.ts"):
        return True
    if is_test(p):
        return True
    rel = str(p.relative_to(REPO))
    exemptions = set()
    if EXEMPT_JSON.exists():
        exemptions = set(json.loads(EXEMPT_JSON.read_text(encoding="utf-8")).get("exempt", []))
    return rel in exemptions


def scan() -> list[dict]:
    rows = []
    for pattern, roots in (("py", [REPO / "apps" / "backend"]),
                           ("ts", [REPO / "apps" / "frontend"]),
                           ("tsx", [REPO / "apps" / "frontend"])):
        for root in roots:
            if not root.exists():
                continue
            for p in root.rglob(f"*.{pattern}"):
                if is_exempt(p):
                    continue
                n = len(p.read_text(encoding="utf-8", errors="replace").splitlines())
                if n >= WARN:
                    rows.append({"file": str(p.relative_to(REPO)), "lines": n,
                                 "level": "HARD" if n >= HARD else "WARN"})
    rows.sort(key=lambda r: -r["lines"])
    return rows


if __name__ == "__main__":
    rows = scan()
    as_json = "--json" in sys.argv
    if as_json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
    else:
        hard = [r for r in rows if r["level"] == "HARD"]
        warn = [r for r in rows if r["level"] == "WARN"]
        print(f"预算:WARN≥{WARN} 行 / HARD≥{HARD} 行(豁免:测试/生成物/vendor/fixtures)")
        print(f"\nHARD({len(hard)} 个,须拆分或登记豁免):")
        for r in hard:
            print(f"  {r['lines']:5d}  {r['file']}")
        print(f"\nWARN({len(warn)} 个,新改动勿再增行):")
        for r in warn:
            print(f"  {r['lines']:5d}  {r['file']}")
    sys.exit(1 if any(r["level"] == "HARD" for r in rows) else 0)
