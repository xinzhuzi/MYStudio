#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1019 持械握句 C32 终版全仓镜像清零(执行补尾)。

背景:1018 C32 裁定「虚握挂定的剑鞘上端三分之一处、五指环拢鞘身,重量归绦」后,
10-19 P3 只清了文档纪律层,镜像面未随终版。本脚本一次清零:
  A 老形例句「右手握住剑鞘」12 处(flux3×2 并补 1017「仅此一柄」枚举与「足蹬青布道履」,全文对齐示例库§1 现行)
  B 纪律术语:示例库:11/05库第6则「虎口扣位」→「虚握鞘位」;12错题集正解升虚握鞘路(1017 轻按柄路被 1018 门禁废止)
  C 机器面:_gongbi_gate 建议文案改三分之一;test_gongbi_gate 通过锚钉新形(老形维持合法=存量不拒,严格化候用户另令)
  + 台账两笔;IP家/Library 两份手册镜像整份回刷(镜像停在前 C32 版)
例文真源=docs/prompts/道劫_类型主体句示例.md §1/§4。幂等:重复运行报零命中即已清。
备份 *.bak-grip1019 不入库(循 0 先例)。
"""
from pathlib import Path
import shutil
import sys

ROOT = Path("/Users/zhengbingjin/Project/Github/MYStudio")

R1_OLD = "右臂自然垂落、右肘微屈，右手握住剑鞘；视线越过"
R1_NEW = "右臂自然垂落、右肘微屈，右手虚握挂定的剑鞘上端三分之一处、五指环拢鞘身，剑身重量仍由腰间剑绦承担；视线越过"
R2_OLD = "右臂自然垂落、右肘微屈，右手握住剑鞘，目光直视"
R2_NEW = "右臂自然垂落、右肘微屈，右手虚握挂定的剑鞘上端三分之一处、五指环拢鞘身，剑身重量仍由腰间丝绦承担，目光直视"
R3_OLD = "青玉色道袍束月白腰带，乌黑长发半束只簪一支素银簪"
R3_NEW = "青玉色道袍束月白腰带，足蹬青布道履，乌黑长发半束只簪一支素银簪"
R4_OLD = "剑身完整收在鞘中；右臂自然垂落、右肘微屈，右手握住剑鞘；视线越过"
R4_NEW = "剑身完整收在鞘中，全身仅此一柄长剑、始终挂定腰间；右臂自然垂落、右肘微屈，右手虚握挂定的剑鞘上端三分之一处、五指环拢鞘身，剑身重量仍由腰间剑绦承担；视线越过"
R5_OLD = "持挂手臂姿态、虎口扣位、五指接触关系"
R5_NEW = "持挂手臂姿态、虚握鞘位、五指接触关系"
R6A_OLD = "如「虚握住挂定的剑鞘上端四分之一处，五指环拢鞘身」"
R6A_NEW = "如「虚握挂定的剑鞘上端三分之一处、五指环拢鞘身」"
R6B_OLD = "改「虚握住挂定的剑鞘上端四分之一处，"
R6B_NEW = "改「虚握挂定的剑鞘上端三分之一处、五指环拢鞘身，"
R7_OLD = "「虎口**轻按**在**挂定的**剑柄上端，指腹贴实柄身」＋「**全身仅此一柄长剑、始终挂定腰间**」唯一性枚举——「轻按」本就是 07 宪法§五规范动词；实弹 01C/04B 双过"
R7_NEW = "「右手**虚握挂定的剑鞘上端三分之一处、五指环拢鞘身**，剑身重量仍由腰间剑绦承担」＋「**全身仅此一柄长剑、始终挂定腰间**」唯一性枚举——1017 原解=「虎口轻按在挂定的剑柄上端」(实弹 01C/04B 双过)；1018 C32 终版禁握柄(握柄＝拔剑预备式，门禁强制)，正解升虚握鞘路"
R8_OLD = "右手握住剑鞘。"
R8_NEW = "右手虚握挂定的剑鞘上端三分之一处、五指环拢鞘身，剑身重量仍由腰间剑绦承担。"

PLAN = {
    "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md": [(R1_OLD, R1_NEW, 2), (R2_OLD, R2_NEW, 2), (R5_OLD, R5_NEW, 1)],
    "docs/prompts/道劫_类型主体句示例.md": [(R5_OLD, R5_NEW, 1)],
    "docs/prompts/Qwen-Image-2.1/12-毁风格词错题集.md": [(R7_OLD, R7_NEW, 1)],
    "apps/backend/comfyui/my_nodes/nodes/my_qi21_prompt_assembly.py": [(R1_OLD, R1_NEW, 1)],
    "apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json": [(R1_OLD, R1_NEW, 1)],
    "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json": [(R1_OLD, R1_NEW, 3)],
    "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json": [(R1_OLD, R1_NEW, 1)],
    "apps/backend/comfyui/workflows/1_图片/Flux3图像/flux3-道劫-t2i.json": [(R3_OLD, R3_NEW, 2), (R4_OLD, R4_NEW, 2)],
    "apps/backend/comfyui/my_nodes/nodes/_gongbi_gate.py": [(R6A_OLD, R6A_NEW, 1), (R6B_OLD, R6B_NEW, 1)],
    "apps/backend/comfyui/my_nodes/tests/test_gongbi_gate.py": [(R8_OLD, R8_NEW, 1)],
}

LEDGER1_ANCHOR = "- （原 :30/:65）「右手握住剑鞘」——被 09-24 部件清单句纪律 1018 终版（虚握剑鞘上端三分之一处、五指环拢鞘身，重量由剑绦/丝绦承担）取代（C32，与类型句「手部至多轻搭」重量挂载语义统一）。"
LEDGER1 = "- 1019 全仓镜像清零（C32 执行补尾）：老形 12 处全换终版——05库×4／装配兜底×1／类型子图×1／qi21-t2i×3／api×1／flux3×2（flux3 并补 1017「仅此一柄」枚举与「足蹬青布道履」全文对齐）；本文件 :11 与 05 库第 6 则「虎口扣位」→「虚握鞘位」；12 错题集持械行正解升虚握鞘路（1017 轻按柄路被 1018 门禁废止）；_gongbi_gate 建议文案与 test_gongbi_gate 通过锚随终版重钉（三分之一）；IP家与 Library 手册镜像整份回刷。"
LEDGER2 = "- **1019 持械握句镜像清零（C32 执行补尾）**：本库四例文老形「右手握住剑鞘」全换终版（虚握+三分之一+五指环拢+重量归绦）；主体句纪律第 6 则「虎口扣位」→「虚握鞘位」（与示例库 :11 逐字一致）；同批=示例库/装配兜底/类型子图/qi21-t2i×3/api/flux3×2（补枚举）/12 错题集/门禁文案与测试锚/IP家与 Library 手册镜像回刷；例文真源=《道劫_类型主体句示例》§1/§4。"

REPO_MANUAL = ROOT / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/art_prompt/art_subject_ten_types.md"
MIRRORS = [
    Path("/Users/zhengbingjin/Project/IP/漫影工作室/skills/art_skills/daojie_ink_guofeng/art_prompt/art_subject_ten_types.md"),
    Path.home() / "Library/Application Support/漫影工作室/skills/art_skills/daojie_ink_guofeng/art_prompt/art_subject_ten_types.md",
]


def main() -> int:
    # 第一遍:全量核数,任何不符即整体中止(零部分写)
    texts, problems = {}, []
    for rel, reps in PLAN.items():
        p = ROOT / rel
        t = p.read_text(encoding="utf-8")
        for old, new, want in reps:
            got = t.count(old)
            if got != want:
                if got == 0 and new in t:
                    continue  # 已清零,幂等通过
                problems.append(f"{rel}: 期望 {want} 处,实测 {got} 处 → {old[:30]}…")
        texts[rel] = t
    if problems:
        print("核数不符,零写入中止:")
        for x in problems:
            print("  " + x)
        return 2

    # 第二遍:备份+写入
    for rel, reps in PLAN.items():
        p = ROOT / rel
        bak = p.with_name(p.name + ".bak-grip1019")
        if not bak.exists():
            shutil.copy2(p, bak)
        t = texts[rel]
        for old, new, want in reps:
            if t.count(old) == want:
                t = t.replace(old, new)
        # 台账
        if rel.endswith("道劫_类型主体句示例.md") and LEDGER1 not in t:
            assert LEDGER1_ANCHOR in t, "示例库 C32 锚行未找到"
            t = t.replace(LEDGER1_ANCHOR, LEDGER1_ANCHOR + "\n" + LEDGER1, 1)
        if rel.endswith("05-道劫规范提示词库.md") and LEDGER2 not in t:
            if not t.endswith("\n"):
                t += "\n"
            t += LEDGER2 + "\n"
        p.write_text(t, encoding="utf-8")
        print(f"[ok] {rel}")

    # 手册镜像整份回刷(镜像停在前 C32 版)
    for m in MIRRORS:
        if m.exists():
            bak = m.with_name(m.name + ".bak-grip1019")
            if not bak.exists():
                shutil.copy2(m, bak)
            shutil.copy2(REPO_MANUAL, m)
            print(f"[ok] 镜像回刷 {m}")
        else:
            print(f"[skip] 镜像不存在 {m}")

    print("清零完成:老形 12+纪律 2+错题集 1+门禁 2+测试锚 1+台账 2+镜像 2")
    return 0


if __name__ == "__main__":
    sys.exit(main())
