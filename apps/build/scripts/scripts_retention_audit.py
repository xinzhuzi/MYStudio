#!/usr/bin/env python3
"""scripts 目录三分取证器(常驻/已花/在途)——只取证不搬件。

出处:2026-10-16 用户令「全目录常驻/已花/在途三分归档」;方法=逐件验属主:
  外部引用分类(测试/门禁/打包/文档/工作流/my_nodes/配置) + 脚本互引闭包
  + git 状态与末次提交 + __pycache__ 执行余温(pyc mtime=最近被 import/执行
  的机器证据) + hygiene 日期名命中。判定权在人,本件只出证据表。

用法:
  python3 scripts_retention_audit.py            # 人类可读表(按建议桶分组)
  python3 scripts_retention_audit.py --json     # 机器可读 JSON(stdout)
扫描面:apps/build/scripts 顶层文件(子目录=归档区/配置区,不扫);
引用面:git 非忽略全集(tracked+untracked),.md/.json/.ts/.mjs/py/sh 全文匹配。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[2]
NOW = None  # 惰性填


def sh(args: list[str], cwd: Path = ROOT) -> str:
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=60)
    return r.stdout if r.returncode == 0 else ""


def repo_files() -> list[Path]:
    out = sh(["git", "ls-files", "-z"]).split("\0")
    out += sh(["git", "ls-files", "--others", "--exclude-standard", "-z"]).split("\0")
    files = []
    for p in out:
        if not p:
            continue
        path = ROOT / p
        if path.is_file():
            files.append(path)
    return files


def classify_referrer(rel: str) -> str:
    base = Path(rel).name
    if rel.startswith("apps/build/scripts/"):
        return "script_peer"
    if base.startswith("test_") or ".test." in base:
        return "test"
    if rel.startswith(("apps/build/packaging", "apps/build/shared", "apps/build/chapter_video", "apps/build/timeline")):
        return "build"
    if base in {"package.json", "vitest.config.ts", "vitest.workspace.ts", "tsconfig.json"} or rel.endswith(".npmrc") or rel.startswith(".claude/") or rel.startswith(".agents/") or rel.startswith(".trellis/") or rel.startswith(".zcode/") or rel.startswith(".codex/"):
        return "config_or_agent"
    if rel.startswith("apps/backend/comfyui/my_nodes"):
        return "my_nodes"
    if rel.startswith("apps/backend/comfyui/workflows") or "/subgraphs/" in rel:
        return "workflow"
    if rel.endswith(".md"):
        return "docs"
    if rel.endswith((".mjs", ".cjs", ".sh", ".ts")) and rel.startswith("apps/"):
        return "app_code"
    return "other"


DATE_MMDD = r"[-_](0[1-9]|1[0-2])[0-9]{2}(?![0-9])"
DATE_YMD = r"[-_]202[0-9]{5}(?![0-9])"
DATE_RE = re.compile(DATE_MMDD + "|" + DATE_YMD)


def main() -> int:
    global NOW
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    import datetime
    NOW = datetime.datetime.now().timestamp()

    targets = sorted(p for p in SCRIPTS.iterdir() if p.is_file())
    names = {p.name: p for p in targets}

    # 引用扫描:全文匹配 basename 与(去扩展名的)stem。
    needles: dict[str, str] = {}
    for p in targets:
        needles[p.name] = p.name
        if p.suffix in {".py", ".sh"}:
            needles.setdefault(p.stem, p.stem)
    pattern = re.compile("|".join(re.escape(n) for n in sorted(needles, key=len, reverse=True)))

    refs: dict[str, dict[str, list[str]]] = {n: {} for n in needles}
    for f in repo_files():
        rel = str(f.relative_to(ROOT))
        if rel.startswith("apps/build/scripts/"):
            peer = Path(rel).name
        try:
            if f.stat().st_size > 4_000_000:
                continue
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if "scripts/" not in text and "scripts\\" not in text:
            # 快筛:提到 scripts 路径或候选词才细匹配(stem 裸词靠下一轮 findall 兜住)
            pass
        for m in pattern.finditer(text):
            hit = needles.get(m.group(0))
            if not hit:
                continue
            if rel.startswith("apps/build/scripts/") and Path(rel).name == hit:
                continue  # 自引用
            bucket = refs[hit].setdefault(classify_referrer(rel), [])
            if rel not in bucket:
                bucket.append(rel)

    # pycache 余温
    pyc_hot: dict[str, float] = {}
    pyc_dir = SCRIPTS / "__pycache__"
    if pyc_dir.is_dir():
        for pyc in pyc_dir.glob("*.pyc"):
            stem = pyc.name.split(".")[0]
            pyc_hot[stem] = max(pyc_hot.get(stem, 0), pyc.stat().st_mtime)

    # git 元数据
    status_map: dict[str, str] = {}
    for line in sh(["git", "status", "--porcelain=v1", "-z"]).split("\0"):
        if not line:
            continue
        path = line[3:].strip('"')
        status_map[path] = line[:2].strip()
    last_commit: dict[str, str] = {}
    log = sh(["git", "log", "--format=@%cI", "--name-only", "-n", "8000"])
    when = ""
    for line in log.splitlines():
        if line.startswith("@"):
            when = line[1:].strip()
        elif line.strip() and when:
            last_commit.setdefault(line.strip(), when)

    def hours_ago(ts: float | None) -> float | None:
        return round((NOW - ts) / 3600, 1) if ts else None

    rows = []
    for name, p in names.items():
        rel = f"apps/build/scripts/{name}"
        r = refs.get(name, {})
        test_pair = f"test_{name}" in names if name.endswith(".py") else False
        gate_lock = any(x.startswith("build/scripts/test_") for x in r.get("config_or_agent", []) + r.get("build", [])) and name in {
            # run-python-tests 显式清单件(缺件即 RED)——由扫描自然给出,这里只标测试对
        }
        row = {
            "file": name,
            "dated_name": bool(DATE_RE.search(p.stem)),
            "git_status": status_map.get(rel, "clean" if rel in last_commit else "?"),
            "last_commit": last_commit.get(rel, ""),
            "mtime_h_ago": hours_ago(p.stat().st_mtime),
            "pyc_exec_h_ago": hours_ago(pyc_hot.get(p.stem)) if p.suffix == ".py" else None,
            "test_pair": test_pair,
            "refs": {k: len(v) for k, v in sorted(r.items())},
            "ref_detail": {k: v[:4] for k, v in sorted(r.items())},
        }
        rows.append(row)

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return 0

    # 人类表:按热度与引用强度粗分桶打印
    def bucket(row):
        refs_all = row["refs"]
        hot = (row["pyc_exec_h_ago"] is not None and row["pyc_exec_h_ago"] < 72) or (row["mtime_h_ago"] is not None and row["mtime_h_ago"] < 72)
        if row["git_status"] not in ("clean", "?"):
            return "A_在途(工作区有改动/未跟踪)"
        if hot:
            return "B_热(72h内执行或改动)"
        if any(k in refs_all for k in ("build", "config_or_agent", "my_nodes", "workflow", "app_code")):
            return "C_被链路引用(非测试非文档)"
        if "test" in refs_all or row["test_pair"]:
            return "D_有测试对/被测试引用"
        if "docs" in refs_all:
            return "E_仅文档引用"
        return "F_零外部引用"
    groups: dict[str, list] = {}
    for row in rows:
        groups.setdefault(bucket(row), []).append(row)
    for g in sorted(groups):
        print(f"\n== {g} ({len(groups[g])}) ==")
        for row in sorted(groups[g], key=lambda r: r["file"]):
            flags = []
            if row["test_pair"]:
                flags.append("test对")
            if row["dated_name"]:
                flags.append("日期名")
            st = row["git_status"] if row["git_status"] != "clean" else ""
            hot = f" 执行{row['pyc_exec_h_ago']}h前" if row["pyc_exec_h_ago"] is not None and row["pyc_exec_h_ago"] < 720 else ""
            print(f"  {row['file']:<52} {st:<3} 末提交{row['last_commit'][:10]}{hot} 引用{row['refs']} {'/'.join(flags)}")
    print(f"\n合计 {len(rows)} 件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
