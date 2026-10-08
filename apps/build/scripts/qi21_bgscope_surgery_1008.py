#!/usr/bin/env python3
# qi21 背景脏感第二轮手术:风格词作用域切分(1008)
# 依据: apps/build/scripts/qi21_bgscope_surgery_1008_plan.md(每处旧串与 docx 报告对应关系见该计划)
# 纪律: 改前副本;每处旧串命中恰 N 次才动刀(零/多命中 abort);字段级对比报告落盘
import json
import shutil
import sys
from pathlib import Path

ROOT = Path("/Users/zhengbingjin/Project/Github/MYStudio")
JSON_P = ROOT / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
CARD_FILES = [
    ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
    ROOT / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
    ROOT / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json",
]
LIB_P = ROOT / "apps/build/scripts/daojie_canon_lib.py"
DOC05_P = ROOT / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
BK = ROOT / "apps/build/scripts/backups/qi21_bgscope_1008"
REPORT = ROOT / "apps/build/scripts/qi21_bgscope_surgery_1008.report.md"

# ── 旧串(工作树现文逐字)/新串(计划翻译版) ──
A1_OLD = "中国传统人物画审美 DNA（工笔、白描、水墨、连环画、传统色、古典山水）经现代游戏角色设计重组"
A1_NEW = "中国传统人物画审美 DNA（工笔、白描、连环画、传统色、山水构图与留白）经现代游戏角色设计重组"
A2A_OLD = "连续铁线描/丝线描（iron-wire outlines），薄透矿物色分染/罩染，柔和均匀平光照明"
A2A_NEW = "连续铁线描/丝线描（iron-wire outlines）勾勒人物与武器，薄透矿物色分染/罩染施于人物与关键配件，柔和均匀平光照明"
A2B_OLD = "用白描/铁线描加薄透矿物罩染、单次轻分染建模；保持浅净平涂底面在层间呼吸。"
A2B_NEW = "人物与关键配件用白描/铁线描加薄透矿物罩染、单次轻分染建模；保持浅净平涂底面在层间呼吸。"
A3_OLD = "多色相基底铺陈（淡墨、青灰、青绿、赭黄土色各安其位，色相分明不互混）"
A3_NEW = "色相基底以整块大色面铺陈（淡墨、青灰、青绿、赭黄土各成整块色面，边界稳定，色相分明不互混）"
A5_OLD = "画面保持干净平滑：墨与色落在平涂色场上。"
A5_NEW = "画面保持干净平滑：墨与色落在平涂色场上，大面积色面均匀连续。"
A4_OLD = "电影级成片质量指干净的可读性与精致的工艺清晰度。"
A4_NEW = "生产级资产质量指焦点主体可读性、非焦点区域低频干净、画面层级分明。"
B_OLD = "背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，宣纸白只作局部透气位；"
B_NEW = "背景以少量大色面铺陈山水空间：淡墨远山、青灰近石、青绿草木、赭黄土各成整块色面，边界稳定，宣纸白作连续净空；"
D_OLD = "远景以淡墨晕染退开，仅保留剪影与色面，不表现细碎纹理，仅保留剪影与色面。"
D_NEW = "远景以淡墨晕染退开，仅保留山脊轮廓与剪影。"
C_OLD = "，均匀锐化背景，灰化混色"
C_NEW = "，均匀锐化背景，灰化混色，密集皴擦，斑驳色块，碎墨点，背景高频线描"

# (名称, 旧, 新, json 内期望命中数)
JSON_EDITS = [
    ("A1 DNA句撤全局媒介词", A1_OLD, A1_NEW, 1),
    ("A2a 媒介句限定人物", A2A_OLD, A2A_NEW, 1),
    ("A2b 罩染建模句限定人物", A2B_OLD, A2B_NEW, 1),
    ("A3 底色句整块大色面", A3_OLD, A3_NEW, 1),
    ("A5 干净平滑可观察化", A5_OLD, A5_NEW, 1),
    ("A4 尾句生产级重定义", A4_OLD, A4_NEW, 1),
    ("B 六型背景句大色面化", B_OLD, B_NEW, 6),
    ("D 四型远景句去重复", D_OLD, D_NEW, 4),
    ("C 负向+4", C_OLD, C_NEW, 1),
]
# 生成器防复活(1007 留旧句=复活陷阱先例)
LIB_EDITS = [
    ("lib B句×3(L269/288/309)", B_OLD, B_NEW, 3),
    ("lib A3旧版(L697,无色相分明不互混)", "多色相基底铺陈（淡墨、青灰、青绿、赭黄土色各安其位）",
     "色相基底以整块大色面铺陈（淡墨、青灰、青绿、赭黄土各成整块色面，边界稳定）", 1),
]
LEDGER_ANCHOR = "- **0925 四令多彩轮(用户四令最高裁定)**:"
LEDGER_NEW = ("- **1008 作用域切分轮(背景脏感第二轮·外部深度诊断报告 2026-10-08)**:四刀后复诊=风格词作用域泄漏定谳"
              "(古典山水/水墨/罩染/多色相铺陈全局标签把高频笔墨任务漏给背景)——底座五改:A1 DNA撤「水墨/古典山水」"
              "(山水降为构图与留白)·A2 铁线描勾勒人物与武器+罩染施于人物与关键配件(两处)·A3 底色整块大色面/边界稳定"
              "(守四令色数)·A5 干净平滑+大面积色面均匀连续·A4 尾句改「生产级资产质量指焦点主体可读性、非焦点区域低频干净、"
              "画面层级分明」;六型B句→「背景以少量大色面铺陈山水空间:…各成整块色面,边界稳定,宣纸白作连续净空」"
              "(守四令:四色枚举保留/不升格大面积留白);四型远景句去重复+消正向否定式→「远景以淡墨晕染退开,仅保留山脊轮廓与剪影」;"
              "负向+4=密集皴擦/斑驳色块/碎墨点/背景高频线描;手术=qi21_bgscope_surgery_1008.py(恰1命中断言+副本+报告);"
              "本库=记录层正文不动,真值以 json 现值为准;A/B 实弹候窗。")


def must(cond: bool, msg: str) -> None:
    if not cond:
        print(f"ABORT: {msg}")
        sys.exit(1)


def replace_count(text: str, old: str, new: str, expect: int, tag: str) -> str:
    n = text.count(old)
    must(n == expect, f"[{tag}] 旧串命中 {n} 次,期望恰 {expect} 次")
    return text.replace(old, new)


def main() -> None:
    # 0) 现值读取
    json_text = JSON_P.read_text(encoding="utf-8")
    data = json.loads(json_text)
    old_pos = data["art_style_base"]["positive_text"]
    old_neg = data["art_style_base"]["negative_text"]

    # 1) 改前副本
    BK.mkdir(parents=True, exist_ok=True)
    for f in [JSON_P, *CARD_FILES, LIB_P, DOC05_P]:
        shutil.copy2(f, BK / (f.name + ".pre"))
    print(f"副本 → {BK}")

    log: list[str] = []

    # 2) 真源 9 处
    for tag, old, new, expect in JSON_EDITS:
        json_text = replace_count(json_text, old, new, expect, f"json {tag}")
        log.append(f"- json `{tag}`: {expect} 处替换")
    json.loads(json_text)  # 合法性
    JSON_P.write_text(json_text, encoding="utf-8")

    # 3) 计算新底座正负(仅 A 组+C 作用于底座;B/D 是型级不进底座)
    new_pos = old_pos
    for tag, old, new, expect in JSON_EDITS:
        if tag.startswith("A"):
            new_pos = new_pos.replace(old, new)
    new_neg = old_neg.replace(C_OLD, C_NEW)
    must(new_pos != old_pos and new_neg != old_neg, "新底座正负文未变化,异常")

    # 4) 卡文(按旧串识别,不按槽号)。正向槽恰 1(t2i=[4032]底座节点,i2i=[4011]装配器参数槽);
    #    负向槽 0 或 1(i2i 族装配器无负向槽,已实测)
    for f in CARD_FILES:
        t = f.read_text(encoding="utf-8")
        must(t.count(old_pos) == 1, f"{f.name} 正向旧快照命中 {t.count(old_pos)} 次,期望 1")
        neg_n = t.count(old_neg)
        must(neg_n in (0, 1), f"{f.name} 负向旧快照命中 {neg_n} 次,期望 0 或 1")
        t = t.replace(old_pos, new_pos)
        if neg_n:
            t = t.replace(old_neg, new_neg)
        json.loads(t)
        f.write_text(t, encoding="utf-8")
        log.append(f"- 卡文 `{f.name}`: 正向×1 + 负向×{neg_n}")

    # 5) 生成器防复活
    lib = LIB_P.read_text(encoding="utf-8")
    for tag, old, new, expect in LIB_EDITS:
        lib = replace_count(lib, old, new, expect, f"canon_lib {tag}")
        log.append(f"- canon_lib `{tag}`: {expect} 处替换")
    LIB_P.write_text(lib, encoding="utf-8")

    # 6) 05库 §六台账 +1 行(正文不动)
    doc = DOC05_P.read_text(encoding="utf-8")
    must(doc.count(LEDGER_ANCHOR) == 1, "05库台账锚命中异常")
    lines = doc.split("\n")
    idx = next(i for i, x in enumerate(lines) if x.startswith(LEDGER_ANCHOR))
    lines.insert(idx + 1, LEDGER_NEW)
    DOC05_P.write_text("\n".join(lines), encoding="utf-8")
    log.append("- 05库 §六台账 +1 行(正文不动)")

    # 7) 后验
    new_data = json.loads(JSON_P.read_text(encoding="utf-8"))
    must(new_data["art_style_base"]["positive_text"] == new_pos, "底座正向与卡文新串不一致")
    must(new_data["art_style_base"]["negative_text"] == new_neg, "底座负向与卡文新串不一致")
    for old in [A1_OLD, A2A_OLD, A3_OLD, A5_OLD, A4_OLD, B_OLD, D_OLD]:
        must(old not in json_text, f"旧串残留: {old[:20]}…")
    # A2B 新串包含旧串作子串,用上下文判别(旧文以「。用白描」起,新文以「配件用白描」起)
    must("。用白描/铁线描加薄透矿物罩染" not in json_text, "A2B 旧串残留")
    for tag, old, new, expect in JSON_EDITS:
        must(json_text.count(new) == expect, f"新串计数异常 {tag}: {json_text.count(new)} != {expect}")
    must(new_pos.count(B_OLD) == 0 and "细节层级" in new_pos, "底座四刀成果丢失,异常")

    REPORT.write_text(
        "# qi21_bgscope_surgery_1008 执行报告\n\n"
        f"- 副本: `{BK.relative_to(ROOT)}`\n- 基线提交: d346cfa4(手术前 checkpoint)\n\n"
        "## 替换明细\n" + "\n".join(log) +
        "\n\n## 底座正向(新,全文)\n```\n" + new_pos + "\n```\n"
        "## 底座负向(新,全文)\n```\n" + new_neg + "\n```\n",
        encoding="utf-8",
    )
    print("\n".join(log))
    print(f"\nOK 全部落刀,报告 → {REPORT}")


if __name__ == "__main__":
    main()
