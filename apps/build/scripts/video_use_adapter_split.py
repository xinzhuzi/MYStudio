#!/usr/bin/env python3
"""video_use/adapter.py 按功能簇拆分(1294 行 → 5 文件,函数体逐字保留)。

用户裁定 08-31:行数过多的文件按 功能/模型/工具 拆分。

结构:
  adapter_shared.py       错误类型+参数微工具+ffmpeg 执行原语(测试 patch 目标所在)
  adapter_creative.py     模板池/情绪/转场增强/图像定位/亮心
  adapter_edl.py          对齐解析/叠层槽位/转场排程/EDL 载荷
  adapter_media_tools.py  派生音频/输入预备/成片校验/对齐工件
  adapter.py              编排入口(execute/run)+全符号门面再导出

patch 契约:跨模块调用的执行原语一律走模块属性 adapter_shared.X,使
patch("video_use.adapter_shared.<name>") 可拦截;同模块互调(如
_prepare_derived_inputs 调 _derive_video_to_audio)保持裸调,测试 patch
目标=video_use.adapter_media_tools。<name>。测试的 patch 字符串由本脚本
同步改写(幂等:两侧均从 git HEAD 重建)。
"""
from __future__ import annotations

import ast
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PKG = REPO / "apps" / "backend" / "video_use"
TEST = REPO / "apps" / "backend" / "tests" / "test_video_use_adapter.py"

SHARED, CREATIVE, EDL, TOOLS = (
    "adapter_shared", "adapter_creative", "adapter_edl", "adapter_media_tools")
PRIMS = ("_tool_env", "_run_helper", "_probe_output", "_probe_media_duration")

NAME_TO_MODULE = {
    # 共享底座
    "VideoUseAdapterError": SHARED, "_write_json": SHARED,
    "_require_absolute_file": SHARED, "_require_sha": SHARED, "_seconds": SHARED,
    "_tool_env": SHARED, "_run_helper": SHARED,
    "_probe_output": SHARED, "_probe_media_duration": SHARED,
    # 创意决策簇
    "_TRANSITION_EFFECT_IDS": CREATIVE, "_TRANSITION_MIN_US": CREATIVE,
    "_TRANSITION_MAX_US": CREATIVE, "HYPERFRAMES_DECORATIVE_TEMPLATES": CREATIVE,
    "CURATED_REGISTRY_TEMPLATES": CREATIVE, "DEFAULT_TEMPLATE_PARAMETERS": CREATIVE,
    "MOOD_TEMPLATE_RULES": CREATIVE, "_TRANSITION_ENHANCEMENT_BASE": CREATIVE,
    "_interleave_pool": CREATIVE, "_ROTATION_POOL_FULL": CREATIVE,
    "_transition_enhancement_for": CREATIVE, "_mood_for_shot": CREATIVE,
    "_registry_deps_ready": CREATIVE, "_template_for_mood": CREATIVE,
    "_image_path_for_shot": CREATIVE, "_bright_centroid": CREATIVE,
    # EDL 组装簇
    "_OVERLAY_SLOT_MAX_US": EDL, "_alignment_for_shot": EDL,
    "_shot_voice_end_s": EDL, "_build_overlay_slots": EDL,
    "_edl_entries_with_transitions": EDL, "_validate_alignment_identity": EDL,
    "_resolve_grade_for_pinned_upstream": EDL, "build_edl_payload": EDL,
    # 媒体工具簇
    "_derived_filename": TOOLS, "_derive_video_to_audio": TOOLS,
    "_prepare_derived_inputs": TOOLS, "_validate_rendered_output": TOOLS,
    "_build_alignment_artifacts": TOOLS,
    # 门面(编排入口)
    "execute_pinned_adapter": "facade", "run_pinned_adapter": "facade",
}

DOCS = {
    SHARED: "video_use 共享底座——错误类型/参数微工具/ffmpeg 执行原语(测试 patch 目标所在)。",
    CREATIVE: "video_use 创意决策簇——模板池/情绪/转场增强/图像定位/亮心计算。",
    EDL: "video_use EDL 组装簇——对齐解析/叠层槽位/转场排程/成片 EDL 载荷。",
    TOOLS: "video_use 媒体工具簇——派生音频/输入预备/成片校验/对齐工件。",
}
FACADE_DOC = ("video_use 适配器门面——编排入口+执行原语属性调用;"
              "功能簇见 adapter_shared/adapter_creative/adapter_edl/adapter_media_tools,"
              "本模块再导出全部符号保历史引用面(worker/tests 仍可 from video_use.adapter import X)。")

original = subprocess.run(
    ["git", "show", "HEAD:apps/backend/video_use/adapter.py"],
    capture_output=True, text=True, cwd=REPO).stdout
assert original, "HEAD 读取失败"
lines = original.splitlines(keepends=True)
tree = ast.parse(original)

segments: list[tuple[str, int, int]] = []
import_block_end = 0
for node in tree.body:
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        import_block_end = max(import_block_end, node.end_lineno)
        continue
    if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
        segments.append((node.name, node.lineno, node.end_lineno))
    elif isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
        segments.append((node.targets[0].id, node.lineno, node.end_lineno))
    elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        segments.append((node.target.id, node.lineno, node.end_lineno))
seg_by_name = {n: (s, e) for n, s, e in segments}
unknown = [n for n, _, _ in segments if n not in NAME_TO_MODULE]
assert not unknown, f"未映射符号: {unknown}"

buckets: dict[str, list[str]] = {k: [] for k in ("facade", SHARED, CREATIVE, EDL, TOOLS)}
for name, _, _ in segments:
    buckets[NAME_TO_MODULE[name]].append(name)
defined_in = {n: NAME_TO_MODULE[n] for n in seg_by_name}


def body_of(names: list[str]) -> str:
    return "".join("".join(lines[seg_by_name[n][0] - 1: seg_by_name[n][1]]) for n in names)


STD_ORDER = ["import hashlib", "import json", "import os", "import re",
             "import subprocess", "import sys"]
PKG_NAMES = ("AlignmentError", "sha256_file", "sha256_text", "HYPERFRAMES_REGISTRY_TEMPLATES")


def build_cluster(mod: str) -> str:
    text = body_of(buckets[mod])
    if mod != SHARED:
        text = re.sub(r"(?<![\w.])(" + "|".join(PRIMS) + r")(?=\s*\()",
                      lambda m: f"adapter_shared.{m.group(0)}", text)
    needs_shared_prim = mod != SHARED and re.search(
        r"adapter_shared\.(" + "|".join(PRIMS) + r")", text) is not None
    std = {s for s in STD_ORDER if re.search(rf"\b{s.split()[-1]}\.", text)}
    if re.search(r"\bPath\b", text):
        std.add("Path")
    if re.search(r"\bAny\b", text):
        std.add("Any")
    pkg = {n for n in PKG_NAMES if re.search(rf"\b{n}\b", text)}
    cross: dict[str, list[str]] = {}
    for name, src in defined_in.items():
        if src == mod:
            continue
        if re.search(rf"(?<![\w.]){re.escape(name)}\b", text):
            cross.setdefault(src, []).append(name)
    imports = sorted(std & set(STD_ORDER), key=STD_ORDER.index)
    if "Path" in std:
        imports.append("from pathlib import Path")
    if "Any" in std:
        imports.append("from typing import Any")
    if {"AlignmentError", "sha256_file", "sha256_text"} & pkg:
        imports.append("from .alignment import " + ", ".join(
            n for n in ("AlignmentError", "sha256_file", "sha256_text") if n in pkg))
    if "HYPERFRAMES_REGISTRY_TEMPLATES" in pkg:
        imports.append("from .hyperframes_registry import HYPERFRAMES_REGISTRY_TEMPLATES")
    shared_names = sorted(n for n in cross.get(SHARED, []) if n not in PRIMS)
    if needs_shared_prim:
        imports.append("from . import adapter_shared")
    if shared_names:
        imports.append("from .adapter_shared import " + ", ".join(shared_names))
    for src in (CREATIVE, EDL, TOOLS):
        if src != mod and src in cross:
            imports.append(f"from .{src} import " + ", ".join(sorted(cross[src])))
    header = f'"""{DOCS[mod]}"""\n\nfrom __future__ import annotations\n\n' + "\n".join(imports) + "\n\n\n"
    return header + text


for mod in (SHARED, CREATIVE, EDL, TOOLS):
    content = build_cluster(mod)
    (PKG / f"{mod}.py").write_text(content, encoding="utf-8")
    print(f"{mod}.py: {len(content.splitlines())} 行")

# ── 门面 ──
facade_body = body_of(buckets["facade"])
facade_body = re.sub(r"(?<![\w.])(" + "|".join(PRIMS) + r")(?=\s*\()",
                     lambda m: f"adapter_shared.{m.group(0)}", facade_body)
facade_imports = "".join(lines[:import_block_end])
cluster_imports = []
for src in (SHARED, CREATIVE, EDL, TOOLS):
    # 含 PRIMS:门面持有名字绑定供历史 import;门面内部调用已属性化,patch 不受影响
    names = sorted(buckets[src])
    if names:
        cluster_imports.append(f"from .{src} import (  # noqa: F401\n    " + ",\n    ".join(names) + ",\n)")
facade = (
    f'"""{FACADE_DOC}"""\n\n' + facade_imports.rstrip("\n")
    + "\nfrom . import adapter_shared\n"
    + ("\n".join(cluster_imports) if cluster_imports else "")
    + "\n\n\n" + facade_body.rstrip("\n") + "\n"
)
(PKG / "adapter.py").write_text(facade, encoding="utf-8")
print(f"adapter.py 门面: {len(facade.splitlines())} 行")

# ── 测试 patch 路径同步(从 HEAD 重建后整体替换) ──
test_src = subprocess.run(["git", "show", "HEAD:apps/backend/tests/test_video_use_adapter.py"],
                          capture_output=True, text=True, cwd=REPO).stdout
for name in PRIMS:
    test_src = test_src.replace(f'"video_use.adapter.{name}"', f'"video_use.adapter_shared.{name}"')
test_src = test_src.replace('"video_use.adapter._derive_video_to_audio"',
                            '"video_use.adapter_media_tools._derive_video_to_audio"')
# 情绪回退日志的 print 在 creative(_template_for_mood);仅 `as log` 断言处改指
assert test_src.count('patch("video_use.adapter.print") as log') == 1
test_src = test_src.replace('patch("video_use.adapter.print") as log',
                            'patch("video_use.adapter_creative.print") as log')
TEST.write_text(test_src, encoding="utf-8")
print("测试 patch 路径同步完成")
