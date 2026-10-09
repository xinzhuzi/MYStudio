#!/usr/bin/env python3
"""qi21 线描词去彩(1009 用户令:「细彩线」错误——线描词不得带颜色语义,颜色唯一落点=主体句+色卡)。

词族沿革:细墨线(墨=单色介质,退役)→细彩线(彩=颜色介质,1009 用户今令退役)→细线(无色,本役)。
改面(提示词正文,按字段键白名单):
  types[].positive_text / positive_background_text(型文/B句)
  art_style_base.positive_text / positive_style_text / positive_ground_text / negative_text(锁层三件)
  expand_instruction.system_prompt_zh(教材随源防写回)
不动面(合法保留):
  color_recipe.* / color_lexicon.*(色卡=色名合法落点;roles.ink 正是「线色随主体明文配色出」机制)
  types[].postprocess(「[82]淡彩线描」=画风件节点名引用;全局占位保护防误伤)
  主体句示例 md(主体句=色名唯一落点,本就该带色)

传播腿:真源→装机包 studio-manuals json→引擎家 daojie-data json→MA腿 json(改前与真源逐字同则拷贝,
分歧则同规则独立变换)+工作流卡(t2i/i2i/img2img)+repo/装机包子图(文本级,双槽天然同刷)。

用法:python3 qi21_lineart_decolor_1009.py [--apply]
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
TRUE_SRC = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
INST = Path("/Applications/漫影工作室.app/Contents/Resources")
LEG_BASES = [
    INST / "studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
    Path.home() / "Library/Application Support/漫影工作室/comfyui/daojie-data/qi21_bases.json",
    Path.home() / "Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
]
WF_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
WF_FILES = [
    WF_DIR / "1_文生图/qi21-道劫-t2i.json",
    WF_DIR / "2_图生图/qi21-道劫-i2i.json",
    WF_DIR / "2_图生图/qi21-道劫-img2img.json",
]
SUBGRAPH_FILES = [
    REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
    REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json",
    INST / "backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
    INST / "backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json",
]

MAPPINGS = [
    ("细彩线", "细线"),
    ("彩线描", "线描"),
    ("彩线饱满", "线条饱满"),
    ("彩线带", "线条带"),
    ("彩线与", "线条与"),
]
PROTECT = [("淡彩线描", "\x00P_DTXM\x00")]  # 画风件/节点名,禁改
# 提示词正文字段键(其余键=color_recipe/lexicon/postprocess 等供给/引用层,不动)
PROMPT_KEYS = {"positive_text", "positive_background_text", "positive_style_text",
               "positive_ground_text", "negative_text", "system_prompt_zh"}

PAT = re.compile("|".join(re.escape(m[0]) for m in MAPPINGS))


def protect(text: str) -> str:
    for old, ph in PROTECT:
        text = text.replace(old, ph)
    return text


def unprotect(text: str) -> str:
    for old, ph in PROTECT:
        text = text.replace(ph, old)
    return text


def apply_mappings(text: str) -> tuple[str, list[str]]:
    hits = []
    for old, new in MAPPINGS:
        if old in text:
            hits.append(f"「{old}」→「{new}」")
            text = text.replace(old, new)
    return text, hits


def transform_bases(path: Path, apply: bool) -> list[str]:
    """qi21_bases.json 形:仅提示词正文字段键(末键)做映射。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    report = []

    def walk(o, key=""):
        if isinstance(o, dict):
            return {k: walk(v, k) for k, v in o.items()}
        if isinstance(o, list):
            return [walk(v, key) for v in o]
        if isinstance(o, str) and key in PROMPT_KEYS and PAT.search(o):
            new, hits = apply_mappings(protect(o))
            report.extend(hits)
            return unprotect(new)
        return o

    new_data = walk(data)
    if report and apply:
        path.write_text(json.dumps(new_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def transform_plain(path: Path, apply: bool) -> list[str]:
    """工作流/子图 json:文本级(双槽天然同刷;保护淡彩线描)。"""
    raw = path.read_text(encoding="utf-8")
    new, hits = apply_mappings(protect(raw))
    new = unprotect(new)
    if not hits:
        return []
    if apply:
        json.loads(new)
        path.write_text(new, encoding="utf-8")
    return hits


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    print(f"═══ qi21 线描词去彩 {'APPLY' if args.apply else 'DRY-RUN'} ═══")

    src_pre = hashlib.md5(TRUE_SRC.read_bytes()).hexdigest()
    rep = transform_bases(TRUE_SRC, args.apply)
    print(f"── 真源 qi21_bases.json:{len(rep)} 处 ──")
    for h in sorted(set(rep)):
        print(f"    {h} ×{rep.count(h)}")

    print("── 工作流卡+子图(文本级)──")
    for f in [*WF_FILES, *SUBGRAPH_FILES]:
        if not f.exists():
            print(f"    (缺席) {f}")
            continue
        hits = transform_plain(f, args.apply)
        print(f"    {f.name} @ {f.parent.parent.name if 'Applications' in str(f.parent) else '仓库'}: {len(hits)} 处")

    print("── 腿镜像 json(改前与真源逐字同→拷贝;异→同规则变换)──")
    for leg in LEG_BASES:
        if not leg.exists():
            print(f"    (缺席) {leg}")
            continue
        same = hashlib.md5(leg.read_bytes()).hexdigest() == src_pre
        if same:
            if args.apply:
                leg.write_bytes(TRUE_SRC.read_bytes())
            print(f"    拷贝同步 ✓ {leg}")
        else:
            rep = transform_bases(leg, args.apply)
            print(f"    分歧→独立变换 {len(rep)} 处 {leg}")

    if args.apply:
        print("── 落盘后活面普查(提示词字段应全零)──")
        d = json.loads(TRUE_SRC.read_text(encoding="utf-8"))
        left = []
        def ck(o, key=""):
            if isinstance(o, dict):
                for k, v in o.items(): ck(v, k)
            elif isinstance(o, list):
                for v in o: ck(v, key)
            elif isinstance(o, str) and key in PROMPT_KEYS and PAT.search(unprotect(protect(o))):
                left.append(key)
        ck(d)
        print("    余量:", left if left else "✅ 提示词字段全零")
    return 0


if __name__ == "__main__":
    sys.exit(main())
