#!/usr/bin/env python3
"""抽取重写修复 pass v2:逐行配对引号,覆盖 vi.mock 等非 import 语句的引用。

v1 教训:全文件正则配对引号会被前文撇号错位吞掉跨行区域;vi.mock("./x") 不是
import 语句,import 正则也看不见。逐行处理两种问题都根治。
幂等,可反复运行。规则:
  - `@/components/panels/director/<moved>` → `@/components/features/storyboard/<moved>`
  - `<../>director/<moved>` / director 留守文件内 `./<moved>` → 同上别名
  - features/storyboard 内部 `./<moved>` 有效不动
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FRONTEND = REPO / "apps" / "frontend"
DEST = FRONTEND / "components" / "features" / "storyboard"
DIRECTOR = FRONTEND / "components" / "panels" / "director"

moved_stems = sorted(p.stem for p in DEST.iterdir() if p.is_file() and p.suffix in (".ts", ".tsx"))
moved_set = set(moved_stems)
ALIAS = "@/components/features/storyboard/"

qstr_re = re.compile(r"(?P<q>['\"])(?P<spec>[^'\"\n]+)(?P=q)")
alias_re = re.compile(r"^@/components/panels/director/([\w.-]+)$")
reldir_re = re.compile(r"^(?:\.\./)+director/([\w.-]+)$")
dot_re = re.compile(r"^\./([\w.-]+)$")

changed_files, total_subs = 0, 0
for base in [FRONTEND / "components", FRONTEND / "stores", FRONTEND / "lib", FRONTEND / "hooks"]:
    if not base.exists():
        continue
    for p in base.rglob("*.ts*"):
        if p.suffix not in (".ts", ".tsx") or any(
                seg in ("node_modules", "out", "release", ".vite") for seg in p.parts):
            continue
        in_dest = p.is_relative_to(DEST)
        in_director = p.is_relative_to(DIRECTOR)
        lines = p.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
        dirty = False

        def sub_line(m: re.Match) -> str:
            global total_subs
            spec = m.group("spec")
            am = alias_re.match(spec)
            if am and am.group(1) in moved_set:
                total_subs += 1
                return m.group(0).replace(spec, ALIAS + am.group(1))
            rm = reldir_re.match(spec)
            if rm and rm.group(1) in moved_set:
                total_subs += 1
                return m.group(0).replace(spec, ALIAS + rm.group(1))
            rm = dot_re.match(spec)
            if rm and rm.group(1) in moved_set and in_director and not in_dest:
                total_subs += 1
                return m.group(0).replace(spec, ALIAS + rm.group(1))
            return m.group(0)

        for i, line in enumerate(lines):
            new_line = qstr_re.sub(sub_line, line)
            if new_line != line:
                lines[i] = new_line
                dirty = True
        if dirty:
            p.write_text("".join(lines), encoding="utf-8")
            changed_files += 1

print(f"已搬移模块数: {len(moved_stems)} | 重写文件: {changed_files} | 替换处数: {total_subs}")

# 残留断言:全前端不允许再出现旧路径引用/悬空相对引用
leftover: list[str] = []
for p in FRONTEND.rglob("*.ts*"):
    if p.suffix not in (".ts", ".tsx") or any(
            seg in ("node_modules", "out", "release", ".vite") for seg in p.parts):
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    for stem in moved_set:
        if f"panels/director/{stem}" in t:
            leftover.append(f"{p.relative_to(FRONTEND)} → panels/director/{stem}")
    if p.is_relative_to(DIRECTOR):
        for stem in moved_set:
            if f"./{stem}" in t:
                leftover.append(f"{p.relative_to(FRONTEND)} → ./{stem}")
print(f"残留引用: {len(leftover)}")
for x in leftover[:20]:
    print("  ✗", x)
