#!/usr/bin/env python3
"""sclass↔director 共享分镜域抽取:panels/director → components/features/storyboard。

两阶段:
  python3 sclass_director_extraction.py           # 干跑:只算清单+报告,零改动
  python3 sclass_director_extraction.py --apply   # 执行 git mv + import 重写

规则(架构耦合体检 08-31 #1 治疗):
  1. 种子 = 被 panels/sclass 引用的 panels/director 模块
  2. 闭包 = 种子在 director 内的传递依赖(搬移集不得残留对 panels 的引用)
  3. 拒绝搬移有未提交改动的文件(并行会话保护区)
  4. import 统一重写为 @/ 别名(与仓内既有风格一致)
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FRONTEND = REPO / "apps" / "frontend"
PANELS = FRONTEND / "components" / "panels"
DIRECTOR = PANELS / "director"
SCLASS = PANELS / "sclass"
DEST = FRONTEND / "components" / "features" / "storyboard"

EXCLUDE_DIRS = {"node_modules", "out", "release", ".vite", "__fixtures__", "__snapshots__"}
EXTS = (".ts", ".tsx", ".mts", ".cts")

import_re = re.compile(
    r"""(?P<stmt>(?:^|\n)[ \t]*(?:import|export)[ \t]*(?:type[ \t]+)?[\w{}\s,*$]*?(?:from[ \t]*)?|\n[ \t]*import[ \t]*\()[ \t]*(?P<q>['"])(?P<spec>[^'"]+)(?P=q)"""
)

def frontend_files() -> list[Path]:
    out = []
    for p in FRONTEND.rglob("*"):
        if not p.is_file() or p.suffix not in EXTS:
            continue
        if any(seg in EXCLUDE_DIRS for seg in p.parts):
            continue
        out.append(p)
    return out

def resolve_spec(spec: str, importer: Path) -> Path | None:
    """把 import 说明符解析成真实文件(支持 @/ 别名与相对路径,含目录 barrel)。"""
    if spec.startswith("@/"):
        base = FRONTEND / spec[2:]
    elif spec.startswith("."):
        base = (importer.parent / spec).resolve()
    else:
        return None
    candidates = [base] + [base.with_suffix(base.suffix + e) for e in EXTS]
    candidates += [base / f"index{e}" for e in EXTS]
    for c in candidates:
        if c.is_file() and c.suffix in EXTS:
            return c
    return None

def imports_of(file: Path) -> set[Path]:
    try:
        text = file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return set()
    found = set()
    for m in import_re.finditer(text):
        r = resolve_spec(m.group("spec"), file)
        if r:
            found.add(r)
    return found

def rel(p: Path) -> str:
    return str(p.relative_to(FRONTEND))

# ── 1. 建图 ─────────────────────────────────────────────────────────────
files = frontend_files()
importers_of: dict[Path, set[Path]] = {}
deps_of: dict[Path, set[Path]] = {}
for f in files:
    deps = imports_of(f)
    deps_of[f] = deps
    for d in deps:
        importers_of.setdefault(d, set()).add(f)

# ── 2. 种子 + 闭包 ──────────────────────────────────────────────────────
seed = {d for d, imps in importers_of.items()
        if d.is_relative_to(DIRECTOR)
        and any(i.is_relative_to(SCLASS) for i in imps)}
move_set: set[Path] = set()
frontier = set(seed)
while frontier:
    nxt: set[Path] = set()
    for f in frontier:
        if f in move_set:
            continue
        move_set.add(f)
        for dep in deps_of.get(f, ()):
            if dep.is_relative_to(DIRECTOR) and dep not in move_set:
                nxt.add(dep)
    frontier = nxt

# 同模块测试文件一起搬( foo.ts → foo.test.ts / foo.test.tsx )
final_set: set[Path] = set(move_set)
for f in move_set:
    stem = f.with_suffix("")
    for cand in [f.with_name(stem.name + ".test.ts"), f.with_name(stem.name + ".test.tsx")]:
        if cand.exists():
            final_set.add(cand)

# ── 3. 安全校验 ─────────────────────────────────────────────────────────
dirty = subprocess.run(
    ["git", "status", "--porcelain", "--", "apps/frontend/components/panels/director",
     "apps/frontend/components/panels/sclass", "apps/frontend/components/features/storyboard"],
    cwd=REPO, capture_output=True, text=True).stdout.strip()
if dirty and "--apply" in sys.argv:
    print("!! 拒绝执行:director/sclass/features 目录存在未提交改动(并行会话保护区):")
    print(dirty)
    sys.exit(2)

# 搬移集不得引用任何「不随迁」的 panels 文件(会违反 panels→features 单向)
panel_refs: list[tuple[str, str]] = []
for f in final_set:
    for dep in deps_of.get(f, ()):
        if dep.is_relative_to(PANELS) and dep not in final_set:
            panel_refs.append((rel(f), rel(dep)))

name_clash = [f for f in final_set if (DEST / f.name).exists()]

print("=" * 72)
print(f"种子(被 sclass 直接引用): {len(seed)} 个")
print(f"搬移集(含 director 内传递闭包 + 配套测试): {len(final_set)} 个")
print()
for f in sorted(final_set, key=rel):
    tag = " [种子]" if f in seed else (" [测试]" if ".test." in f.name else " [闭包]")
    print(f"  {rel(f)}{tag}")
print()
print(f"搬移集 → panels 残留引用(必须为空): {len(panel_refs)}")
for a, b in panel_refs:
    print(f"  ✗ {a} → {b}")
print(f"与 features/storyboard 现有文件重名: {len(name_clash)}")

# ── 4. 影响面:所有引用搬移集的文件 ─────────────────────────────────────
rewrite_targets: dict[str, set[str]] = {}   # importer rel → 搱移模块名集合
for f in final_set:
    module = f.stem  # 不带扩展名
    for imp in importers_of.get(f, ()):
        rewrite_targets.setdefault(rel(imp), set()).add(f.name)
print()
print(f"需重写 import 的文件: {len(rewrite_targets)} 个")
for k in sorted(rewrite_targets):
    print(f"  {k}  ({len(rewrite_targets[k])} 处模块)")

if panel_refs or name_clash:
    print("\n!! 存在阻塞项,终止。")
    sys.exit(2)

if "--apply" not in sys.argv:
    print("\n[干跑] 未做任何改动。加 --apply 执行。")
    sys.exit(0)

# ── 5. 执行:git mv + import 重写 ───────────────────────────────────────
DEST.mkdir(parents=True, exist_ok=True)
moved_pairs: dict[str, str] = {}   # 旧 rel → 新 rel (frontend 相对)
for f in sorted(final_set, key=rel):
    dst = DEST / f.name
    r = subprocess.run(["git", "mv", str(f), str(dst)], cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"git mv 失败 {f}: {r.stderr.strip()}")
        sys.exit(3)
    moved_pairs[rel(f)] = rel(dst)
print(f"git mv 完成: {len(moved_pairs)} 文件")

# 重写:任何解析到搬移文件的说明符 → @/components/features/storyboard/<stem>
# 注意:搬移文件自身的旧路径已失效,须映射到新路径
alias_of: dict[Path, str] = {}
for old_rel, new_rel in moved_pairs.items():
    p = FRONTEND / new_rel
    alias_of[p] = "@/components/features/storyboard/" + p.stem

changed = 0
for importer_rel in sorted(rewrite_targets):
    actual_rel = moved_pairs.get(importer_rel, importer_rel)
    path = FRONTEND / actual_rel
    if not path.exists():
        print(f"!! 缺失文件 {importer_rel} → {actual_rel},终止")
        sys.exit(4)
    text = path.read_text(encoding="utf-8")
    def sub(m: re.Match) -> str:
        spec = m.group("spec")
        target = resolve_spec(spec, path)
        if target in alias_of:
            return m.group(0).replace(spec, alias_of[target])
        return m.group(0)
    new_text, n = import_re.subn(sub, text)
    if n and new_text != text:
        path.write_text(new_text, encoding="utf-8")
        changed += 1
print(f"import 重写完成: {changed} 文件")
print("下一步: cd apps && pnpm typecheck && pnpm vitest run components/panels/sclass components/panels/director components/features/storyboard")
