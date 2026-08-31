#!/usr/bin/env python3
"""model_cache.py 九包重复度深度分析:逐函数提取+归一化指纹+同异矩阵。

输出: stdout 摘要 + model-cache-diff.json(与脚本同目录)。
只读分析,供 08-31-arch-coupling-governance 任务 research 使用。
"""
from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BACKEND = REPO / "apps" / "backend"
PACKAGES = sorted(p.parent.name for p in BACKEND.glob("*/model_cache.py"))
OUT = Path(__file__).resolve().parent / "model-cache-diff.json"


def norm_source(seg: ast.AST) -> str:
    """归一化函数源:去注释/空行/尾随空白,统一缩进,保留语义结构。"""
    import re
    src = []
    for line in ast.unparse(seg).splitlines():
        line = re.sub(r"\s+#.*$", "", line.rstrip())
        if line.strip():
            src.append(line)
    return "\n".join(src)


def load_pkg(pkg: str) -> dict:
    path = BACKEND / pkg / "model_cache.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    funcs = {}
    total_lines = len(path.read_text(encoding="utf-8").splitlines())
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            body = norm_source(node)
            funcs[node.name] = {
                "args": [a.arg for a in node.args.args],
                "lines": node.end_lineno - node.lineno + 1,
                "fp": hashlib.md5(body.encode()).hexdigest()[:10],
                "body": body,
            }
    return {"funcs": funcs, "total_lines": total_lines}


data = {pkg: load_pkg(pkg) for pkg in PACKAGES}

# 全部函数名并集 → 谁在哪些包出现、逐体是否一致
all_names: dict[str, list[str]] = {}
for pkg, d in data.items():
    for name in d["funcs"]:
        all_names.setdefault(name, []).append(pkg)

matrix: dict[str, dict] = {}
dup_line_total = 0
for name, pkgs in sorted(all_names.items(), key=lambda kv: -len(kv[1])):
    fps = {data[p]["funcs"][name]["fp"] for p in pkgs}
    entry = {
        "packages": pkgs,
        "variants": len(fps),
        "identical": len(fps) == 1,
        "lines_per": {p: data[p]["funcs"][name]["lines"] for p in pkgs},
    }
    if len(pkgs) >= 2:
        entry["wasted_lines"] = sum(v - min(entry["lines_per"].values())
                                    for v in entry["lines_per"].values())
        dup_line_total += entry["wasted_lines"]
    matrix[name] = entry

# 分歧函数逐对差异(前 6 个最有代表性的)
divergent = {n: e for n, e in matrix.items()
             if len(e["packages"]) >= 3 and not e["identical"]}

report = {
    "packages": PACKAGES,
    "per_pkg_lines": {p: data[p]["total_lines"] for p in PACKAGES},
    "func_matrix": matrix,
    "shared_3plus": sorted(n for n, e in matrix.items() if len(e["packages"]) >= 3),
    "identical_3plus": sorted(n for n, e in matrix.items()
                              if len(e["packages"]) >= 3 and e["identical"]),
    "divergent_3plus": sorted(divergent),
    "est_duplicated_lines": dup_line_total,
    "divergence_detail": {
        n: {p: data[p]["funcs"][n]["body"][:400] for p in matrix[n]["packages"]}
        for n in list(divergent)[:6]
    },
}
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

print("包:", ", ".join(f"{p}({data[p]['total_lines']}行)" for p in PACKAGES))
print(f"≥3 包共享函数: {len(report['shared_3plus'])} | 其中逐字一致: {len(report['identical_3plus'])}")
print(f"≥2 包函数冗余行数估算: {dup_line_total}")
print()
print("【≥3 包共享函数矩阵】(✓=逐字一致, ◆=有分歧)")
for n in report["shared_3plus"]:
    e = matrix[n]
    mark = "✓" if e["identical"] else "◆"
    print(f"  {mark} {n}: {len(e['packages'])}包 {e['packages']}")
print()
print("【分歧函数明细前6】")
for n, bodies in report["divergence_detail"].items():
    print(f"  ◆ {n}")
    for p, b in bodies.items():
        first = b.splitlines()[0] if b else ""
        print(f"      {p}: {first[:90]}")
print(f"\n完整数据: {OUT}")
