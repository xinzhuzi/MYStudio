#!/usr/bin/env python3
"""架构耦合体检——扫前端分层违规/跨域耦合、后端跨包耦合、巨石文件热点。

输出: stdout 摘要 + arch-coupling-report.json(与脚本同目录落盘)。
只读扫描,不修改任何源码。可反复运行。
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FRONTEND = REPO / "apps" / "frontend"
OUT = Path(__file__).resolve().parent / "arch-coupling-report.json"

report: dict = {"generated": Path(__file__).name, "sections": {}}

# ---------------------------------------------------------------------------
# 前端:分层铁律检查 (panels→features→ui→hooks→lib 单向;lib 零 React)
# ---------------------------------------------------------------------------
LAYER_RULES = [
    # (描述, 目录谓词, 违规 import 谓词)
    ("ui 反向依赖 panels/features", r"^components/ui/",
     [r"^components/panels/", r"^\.\./panels/", r"components/features"]),
    ("features 反向依赖 panels", r"^components/features/",
     [r"^components/panels/"]),
    ("lib 引用 React(lib 零 React 铁律)", r"^lib/",
     [r"from ['\"]react['\"]", r"from ['\"]react-dom", r"require\(['\"]react['\"]"]),
    ("lib 反向引用 components", r"^lib/",
     [r"^components/", r"^\.\./components/"]),
    ("hooks 反向引用 panels", r"^hooks/",
     [r"^components/panels/"]),
]

import_re = re.compile(r"""(?:^|\n)\s*(?:import\s+(?:type\s+)?[\w\s{},*$]*?from\s+|import\s*\(\s*|import\s+|require\(\s*)['"]([^'"]+)['"]""")
rel_import_re = re.compile(r"""(?:^|\n)\s*(?:import\s+(?:type\s+)?[\w\s{},*$]*?from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]""")

def norm_import(raw: str, importer_dir: Path) -> str | None:
    """归一化 import 说明符:相对路径→仓库相对(frontend 内),别名 @/→frontend 相对。"""
    if raw.startswith("@/"):
        return raw[2:]
    if raw.startswith("."):
        base = (importer_dir / raw).resolve()
        try:
            rel = base.relative_to(FRONTEND)
        except ValueError:
            return None
        return str(rel)
    return None  # bare 包名不参与分层判定


def frontend_layer_audit() -> dict:
    violations: list[dict] = []
    src_files = [p for p in FRONTEND.rglob("*") if p.suffix in (".ts", ".tsx")
                 and not any(seg in ("node_modules", "out", "release", ".vite", "__fixtures__") for seg in p.parts)]
    for p in src_files:
        rel = str(p.relative_to(FRONTEND))
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        specs = []
        for m in import_re.finditer(text):
            n = norm_import(m.group(1), p.parent)
            if n:
                specs.append(n)
        for rule_name, dir_pat, bad_pats in LAYER_RULES:
            if re.search(dir_pat, rel):
                for spec in specs:
                    for bad in bad_pats:
                        if bad.startswith("^") or bad.startswith("from") or bad.startswith("require"):
                            # 直接对源码文本做正则(lib-React 类)
                            if re.search(bad, text):
                                violations.append({"rule": rule_name, "file": rel, "import": bad, "kind": "text-match"})
                            break
                        else:
                            if re.search(bad, spec):
                                violations.append({"rule": rule_name, "file": rel, "import": spec, "kind": "spec"})
    # 去重(text-match 类会重复命中)
    seen, uniq = set(), []
    for v in violations:
        key = (v["rule"], v["file"], v["import"])
        if key not in seen:
            seen.add(key)
            uniq.append(v)
    return {"count": len(uniq), "items": uniq}


def cross_domain_panel_audit() -> dict:
    """panels/<域> 之间互相引用=跨域耦合。"""
    cross: dict[str, list[str]] = defaultdict(list)
    panels_dir = FRONTEND / "components" / "panels"
    for p in panels_dir.rglob("*.ts*"):
        if p.suffix not in (".ts", ".tsx") or "node_modules" in p.parts:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        src_domain = p.parent.relative_to(panels_dir).parts[0] if p.parent != panels_dir else "(root)"
        for m in import_re.finditer(text):
            n = norm_import(m.group(1), p.parent)
            if not n or not n.startswith("components/panels/"):
                continue
            tgt = n[len("components/panels/"):].split("/")[0]
            if tgt and tgt != src_domain and (panels_dir / tgt).is_dir():
                cross[f"{src_domain} → {tgt}"].append(
                    f"{p.relative_to(FRONTEND)} imports {n}")
    return {"edges": {k: v for k, v in sorted(cross.items())},
            "edge_count": len(cross)}


def fanout_audit() -> dict:
    """前端/electron 每文件内部 import 数(fan-out)TOP20。"""
    rows = []
    for p in FRONTEND.rglob("*.ts*"):
        if p.suffix not in (".ts", ".tsx") or any(seg in ("node_modules", "out", "release", ".vite") for seg in p.parts):
            continue
        if ".test." in p.name or "__fixtures__" in p.parts:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        n = len(import_re.findall(text))
        if n >= 25:
            rows.append({"file": str(p.relative_to(FRONTEND)), "imports": n})
    rows.sort(key=lambda r: -r["imports"])
    return {"top": rows[:20]}


# ---------------------------------------------------------------------------
# 后端:Python 跨包耦合
# ---------------------------------------------------------------------------
def backend_audit() -> dict:
    backend = REPO / "apps" / "backend"
    cross: dict[str, list[str]] = defaultdict(list)
    syspath_hacks: list[str] = []
    for p in backend.rglob("*.py"):
        if "__pycache__" in p.parts or p.parent.name == "tests":
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = str(p.relative_to(backend))
        own_pkg = rel.split("/")[0] if "/" in rel else "(root)"
        for m in re.finditer(r"^\s*(?:from|import)\s+([\w.]+)", text, re.M):
            mod = m.group(1)
            top = mod.split(".")[0]
            if top in {"audio_gen", "image_gen", "music3_gen", "sfx_gen", "tts", "upscale",
                       "video_qc", "video_use", "vlm_review", "depth_estimation", "layer_separation",
                       "modelscope_hub"}:
                tgt_pkg = top if top == "modelscope_hub" else mod.split(".")[0]
                if tgt_pkg != own_pkg:
                    cross[f"{own_pkg} → {tgt_pkg}"].append(f"{rel}: {m.group(0).strip()}")
        if re.search(r"sys\.path\.(?:insert|append)", text):
            syspath_hacks.append(rel)
    # model_cache.py 各包重复度:共同函数名
    caches = {}
    for p in backend.glob("*/model_cache.py"):
        text = p.read_text(encoding="utf-8", errors="replace")
        fns = set(re.findall(r"^def\s+(\w+)", text, re.M))
        caches[p.parent.name] = sorted(fns)
    all_fns: dict[str, list[str]] = defaultdict(list)
    for pkg, fns in caches.items():
        for fn in fns:
            all_fns[fn].append(pkg)
    dup_fns = {fn: pkgs for fn, pkgs in sorted(all_fns.items()) if len(pkgs) >= 5}
    return {"cross_pkg_imports": {k: v for k, v in sorted(cross.items())},
            "sys_path_hacks": syspath_hacks,
            "model_cache_dup_funcs": dup_fns,
            "model_cache_pkgs": sorted(caches)}


# ---------------------------------------------------------------------------
# Electron 主进程:main.ts 职责密度
# ---------------------------------------------------------------------------
def electron_audit() -> dict:
    main_ts = FRONTEND / "electron" / "main" / "main.ts"
    text = main_ts.read_text(encoding="utf-8", errors="replace")
    ipc_calls = len(re.findall(r"ipcMain\.handle\(", text))
    # rendering/plugins 之间互相引用
    plugins = FRONTEND / "electron" / "rendering" / "plugins"
    plugin_cross: dict[str, list[str]] = defaultdict(list)
    for p in plugins.rglob("*.ts"):
        if ".test." in p.name:
            continue
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        src_plugin = p.relative_to(plugins).parts[0]
        for m in import_re.finditer(t):
            n = norm_import(m.group(1), p.parent)
            if not n:
                continue
            mm = re.match(r"electron/rendering/plugins/([\w_]+)/", n)
            if mm and mm.group(1) != src_plugin:
                plugin_cross[f"{src_plugin} → {mm.group(1)}"].append(
                    f"{p.relative_to(FRONTEND)}")
    return {"main_ts": {"lines": text.count(chr(10)) + 1, "ipcMain_handle_count": ipc_calls},
            "plugin_cross_imports": dict(plugin_cross)}


sections = {
    "frontend_layer_violations": frontend_layer_audit(),
    "frontend_cross_domain_panels": cross_domain_panel_audit(),
    "frontend_fanout_top": fanout_audit(),
    "backend": backend_audit(),
    "electron": electron_audit(),
}
report["sections"] = sections
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

# ---- stdout 摘要(人读)----
print("=" * 72)
print("【1】前端分层违规 (panels→features→ui→hooks→lib 单向 / lib 零 React)")
v = sections["frontend_layer_violations"]
print(f"  违规总数: {v['count']}")
for item in v["items"][:25]:
    print(f"  - [{item['rule']}] {item['file']}  ← {item['import']}")
print()
print("=" * 72)
print("【2】panels 跨域耦合边")
c = sections["frontend_cross_domain_panels"]
print(f"  跨域边数: {c['edge_count']}")
for edge, hits in c["edges"].items():
    print(f"  - {edge}: {len(hits)} 处")
print()
print("=" * 72)
print("【3】前端 import fan-out TOP(≥25)")
for r in sections["frontend_fanout_top"]["top"]:
    print(f"  - {r['imports']:3d}  {r['file']}")
print()
print("=" * 72)
print("【4】后端跨包 import / sys.path hack / model_cache 重复")
b = sections["backend"]
print(f"  跨包 import 边: {len(b['cross_pkg_imports'])}")
for edge, hits in b["cross_pkg_imports"].items():
    print(f"  - {edge}: {len(hits)} 处  例: {hits[0]}")
print(f"  sys.path hack 文件: {b['sys_path_hacks']}")
print(f"  model_cache.py 重复函数(≥5 包同名): {len(b['model_cache_dup_funcs'])} 个")
for fn, pkgs in list(b["model_cache_dup_funcs"].items())[:12]:
    print(f"    - {fn}: {len(pkgs)} 包")
print()
print("=" * 72)
print("【5】Electron")
e = sections["electron"]
print(f"  main.ts: {e['main_ts']['lines']} 行, ipcMain.handle {e['main_ts']['ipcMain_handle_count']} 处")
print(f"  rendering/plugins 互引: {e['plugin_cross_imports'] or '无'}")
print()
print(f"完整报告: {OUT}")
