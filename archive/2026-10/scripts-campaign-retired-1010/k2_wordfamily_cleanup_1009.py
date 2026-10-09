#!/usr/bin/env python3
"""K2 域退役词族清理(1009 用户令「K2相关要清理」;范围=分镜剧情会话候裁项,其他不动)。

背景:1009 墨彩化役在 qi21 域清完笔法过程词+墨字头词族后,K2 域活区从未覆盖候裁
(提按顿挫/干湿五阶/手绘笔性-型文侧/墨字头线描词/淡墨-固层介质),本役按同一映射表清尾。

目标面(活面):
  A. K2 工作流卡(仓库 + /Applications 装机包;文本级替换=双槽 widgets_values/
     widgets_values_named 同刷且零重排版,JSON 回读校验)
  B. canon_lib 活常量(BEAUTIFIED/SUBJECTS/SECTION_PROSE/COMPOSITION_CHAR/COMPOSITION_PROP)
不动面(改史禁令+冻结装置):
  - canon_lib 的 G 覆盖矩阵、NOTE、台账 A(...)、文件头 docstring/注释(0923 美化版历史记述)
  - 05库 markdown(冻结设计记录,头部明写「勿从本文档拷贝提示词」,墨彩化役即未动)
  - ma_sync/lock-anchors.json(归 MA 同步役)
合法保留(真源 qi21_bases.json 存活口径):淡墨/宣纸白=色名供给层;晕染/晕开/接晕=场景专属
+主体句例;「彩线带手绘笔性」「转折处轻重提按」=锁层S3形态;笔墨/皴擦/工笔/白描=余量合法;
「水墨武侠漆艺鎏金/水墨线专用」=LoRA 名(含「墨线」子串,禁盲替换——故映射全用长短语精确匹配)。

映射表(与 qi21 域 1009 清尾役同款,序=长前缀优先防重复命中;现行句逐字对齐处以注标注)。

用法:python3 k2_wordfamily_cleanup_1009.py           # dry-run(逐命中+计划替换)
     python3 k2_wordfamily_cleanup_1009.py --apply   # 落盘(仓库+装机包同步)
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
K2_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像"
K2_DIR_INSTALLED = Path("/Applications/漫影工作室.app/Contents/Resources/backend/"
                        "engines/comfyui/workflows/1_图片/K2图像")
CANON = REPO / "apps/build/scripts/daojie_canon_lib.py"
# K2 修手提示词包(test_daojie_handsfix_contract 钉卡[12]↔§一围栏逐字一致=活面)
HANDSFIX_PKG = REPO / "docs/prompts/道劫_新提示词包_0917.md"

MAPPINGS: list[tuple[str, str]] = [
    ("运笔有提按顿挫的细墨线勾勒", "细彩线勾勒"),
    ("运笔有提按顿挫，", ""),
    ("细稳处带手绘笔性；", ""),
    ("，干湿五阶层次清楚。", "。"),                      # 美宣句号尾形(补)
    ("干湿五阶层次清楚。", ""),                          # 美宣句号尾形兜底
    ("干湿五阶层次清楚，", ""),
    ("淡墨晕染空气与远景", "色面晕开空气与远景"),        # 角色设定卡(补)
    ("墨色浓淡干湿层次分明", "色彩浓淡分明"),            # K2 道劫 [11] 远山卡
    ("淡墨晕染云雾远山", "色面晕开云雾远山"),            # K2-道劫修手
    ("淡墨晕染云雾", "色面晕开云雾"),                    # K2 道劫 [11]
    ("淡墨晕染层层退开", "低对比色面层层退开"),          # canon_lib 人物
    ("远景交给淡墨", "远景交给低对比色面"),              # canon_lib 场景(现行句逐字)
    ("远景用淡墨退去", "远景以低对比色面退去"),          # canon_lib 分镜(现行句逐字)
    ("远处交给淡墨", "远处交给低对比色面"),              # canon_lib 概念
    ("背景以淡墨整体退后", "背景以低对比色面整体退后"),  # canon_lib 美宣(现行句逐字)
    ("一片淡墨虚实", "一片低对比虚实"),                  # canon_lib 美宣(现行句逐字)
    ("只以淡墨一抹带过", "只以低对比色面一抹带过"),      # krea2-daojie-t2i
    ("云雾仙气以淡墨轻染", "云雾仙气以色面轻染"),        # 提示词包§一(补)
    ("淡墨晕染", "色面晕开"),                            # 兜底:提示词包指引行孤立形态
    ("墨色浓淡", "色彩浓淡"),
    ("细墨线", "细彩线"),
    ("铁线描", "彩线描"),
    ("墨线带手绘笔性", "彩线带手绘笔性"),
    ("墨线饱满", "彩线饱满"),
    ("墨线细而稳", "彩线细而稳"),
    ("墨线细稳", "彩线细稳"),
    ("墨线勾画", "彩线勾画"),
    ("墨线刻画", "彩线刻画"),
    ("墨线勾勒", "彩线勾勒"),
]

CANON_LIVE_REGIONS = ["BEAUTIFIED", "SUBJECTS", "SECTION_PROSE", "COMPOSITION_CHAR", "COMPOSITION_PROP"]

FAMILY_WORDS = ["提按顿挫", "干湿五阶", "细稳处带手绘笔性", "细墨线", "墨色浓淡", "铁线描",
                "墨线勾画", "墨线刻画", "墨线勾勒", "墨线饱满", "墨线细稳", "墨线细而稳",
                "墨线带手绘笔性", "淡墨晕染", "远景交给淡墨", "远景用淡墨退去", "远处交给淡墨",
                "背景以淡墨整体退后", "一片淡墨虚实", "只以淡墨一抹带过"]


def apply_mappings(text: str) -> tuple[str, list[str]]:
    hits = []
    for old, new in MAPPINGS:
        if old in text:
            hits.append(f"「{old}」→「{new}」" if new else f"「{old}」→删")
            text = text.replace(old, new)
    return text, hits


def edit_k2_card(path: Path, apply: bool) -> list[str]:
    """文本级替换(零重排版);短语为纯中文无 JSON 转义,raw 文本与双槽字符串值逐字同构。"""
    raw = path.read_text(encoding="utf-8")
    new, hits = apply_mappings(raw)
    if not hits:
        return []
    if apply:
        json.loads(new)  # 结构校验(替换不碰转义层,必过;防手误)
        path.write_text(new, encoding="utf-8")
    return hits


def canon_live_mask(lines: list[str]) -> list[bool]:
    """活常量行=True。锚=『NAME = {/[』起始,花括/方括深度配对到闭。"""
    mask = [False] * len(lines)
    i = 0
    while i < len(lines):
        if re.match(rf"^({'|'.join(CANON_LIVE_REGIONS)}) = [\[\{{]", lines[i]):
            depth = 0
            j = i
            while j < len(lines):
                depth += lines[j].count("{") + lines[j].count("[") - lines[j].count("}") - lines[j].count("]")
                mask[j] = True
                if j > i and depth <= 0:
                    break
                j += 1
            i = j + 1
        else:
            i += 1
    return mask


def canon_note_flags(lines: list[str]) -> list[bool]:
    """轮次注记史串标记:以 "09xx 日期开头的串起,至行尾 '"),'(元组元素闭)止——注记=设计史不改。"""
    flags = [False] * len(lines)
    note = False
    for i, line in enumerate(lines):
        if note:
            flags[i] = True
            if line.rstrip().endswith('"),') or line.rstrip().endswith('")'):
                note = False
        elif re.match(r'^\s*"09\d', line):
            flags[i] = True
            if not (line.rstrip().endswith('"),') or line.rstrip().endswith('")')):
                note = True
    return flags


def edit_canon(path: Path, apply: bool) -> tuple[list[str], int]:
    """canon_lib:仅活常量区段行做映射;两类不改=①区外(G矩阵/NOTE/台账/docstring)②区内
    轮次注记史串(设计史记述,改史禁令)。"""
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    mask = canon_live_mask(lines)
    notes = canon_note_flags(lines)
    report, frozen_lines, changed = [], set(), 0
    for idx, line in enumerate(lines):
        if any(w in line for w in FAMILY_WORDS) and not mask[idx]:
            frozen_lines.add(idx + 1)
        new, hits = apply_mappings(line)
        if not hits:
            continue
        if mask[idx] and not notes[idx]:
            report.extend(f"  L{idx+1}(活): {h}" for h in hits)
            lines[idx] = new
            changed += 1
        else:
            tag = "活区内注记史串" if notes[idx] else "冻结"
            report.extend(f"  L{idx+1}({tag},不改): {h}" for h in hits)
            frozen_lines.add(idx + 1)
    if apply and changed:
        path.write_text("".join(lines), encoding="utf-8")
    return report, len(frozen_lines)


def survey_live() -> dict[str, int]:
    """落盘后活面普查:应全零(合法保留词不属 FAMILY_WORDS)。"""
    out = {}
    pkg_n = sum(HANDSFIX_PKG.read_text(encoding="utf-8").count(w) for w in FAMILY_WORDS)
    if pkg_n:
        out["提示词包md"] = pkg_n
    for base in (K2_DIR, K2_DIR_INSTALLED):
        for jf in sorted(base.glob("*/*.json")):
            n = sum(jf.read_text(encoding="utf-8").count(w) for w in FAMILY_WORDS)
            if n:
                out[f"{base.name if base.name != 'K2图像' else '仓库'}/{jf.name}"] = n
    lines = CANON.read_text(encoding="utf-8").splitlines()
    mask = canon_live_mask(lines)
    notes = canon_note_flags(lines)
    n = sum(sum(lines[i].count(w) for w in FAMILY_WORDS)
            for i in range(len(lines)) if mask[i] and not notes[i])
    if n:
        out["canon_lib(活常量)"] = n
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    print(f"═══ K2 域词族清理 {'APPLY' if args.apply else 'DRY-RUN'} ═══")

    # 装机包-仓库预检(改前 md5;分歧件只改仓库,装机包候人工核)
    diverged = []
    for jf in sorted(K2_DIR.glob("*/*.json")):
        inst = K2_DIR_INSTALLED / jf.relative_to(K2_DIR)
        if inst.exists() and hashlib.md5(jf.read_bytes()).hexdigest() != hashlib.md5(inst.read_bytes()).hexdigest():
            diverged.append(jf.name)
    if diverged:
        print(f"⚠️ 装机包与仓库改前不同源(仅改仓库,装机包候人工核): {diverged}")

    total = 0
    print("\n── A. K2 工作流卡 ──")
    for jf in sorted(K2_DIR.glob("*/*.json")):
        hits = edit_k2_card(jf, args.apply)
        if hits:
            total += len(hits)
            print(f"◆ {jf.relative_to(K2_DIR)} ({len(hits)} 处)")
            for h in hits:
                print("   ", h)
            if args.apply:
                inst = K2_DIR_INSTALLED / jf.relative_to(K2_DIR)
                if inst.exists() and jf.name not in diverged:
                    inst.write_bytes(jf.read_bytes())
                    print(f"    ↳ 装机包同步 ✓")

    print("\n── C. K2 修手提示词包 md ──")
    raw = HANDSFIX_PKG.read_text(encoding="utf-8")
    _, pkg_hits = apply_mappings(raw)
    if pkg_hits:
        total += len(pkg_hits)
        for h in pkg_hits:
            print("   ", h)
        if args.apply:
            HANDSFIX_PKG.write_text(apply_mappings(raw)[0], encoding="utf-8")
    else:
        print("    (无命中)")

    print("\n── B. canon_lib 活常量 ──")
    rep, frozen = edit_canon(CANON, args.apply)
    total += len([r for r in rep if "(活)" in r])
    print("\n".join(rep) if rep else "    (活常量区无命中)")
    print(f"    冻结装置区(G矩阵/NOTE/台账/docstring)词族命中 {frozen} 行,按不改史禁令保留")

    if args.apply:
        print("\n── 落盘后活面普查(应全零)──")
        left = survey_live()
        print("   ", left if left else "✅ 活面全零")
        import py_compile
        py_compile.compile(str(CANON), doraise=True)
        print("    ✅ canon_lib py_compile 过")
    else:
        print(f"\n[dry-run] 活面共 {total} 处命中待改;确认后 --apply")
    return 0


if __name__ == "__main__":
    sys.exit(main())
