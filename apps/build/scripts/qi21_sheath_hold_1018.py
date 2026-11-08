#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""主体句纪律双修正(役号 1018sheath;1018 用户裁定):

①持剑姿势:挂定未拔时手按**剑鞘鞘身**,不按剑柄——按柄=拔剑预备式,
  姿势错(用户:「要握住剑鞘,而不是握住这个剑把」);1017 双剑病防件
  (轻按动词+唯一性枚举+贴附语)保留,贴附对象 柄→鞘。
②人物图发色必写:主体句不写发色=无人兜底(用户:「头发颜色必须写上去,
  不能丢这个,主体词必须写」);例句欠发色处补「乌黑」。

刀位=例句全镜像(手册/宪法/示例库/05库/装配例文/自检夹具/子图/主画布
t2i/flux3/K2×2/桥模板/charsheet)+引擎侧两镜像+主体句例文哈希锚重锚
(_DEFAULT_ANCHORS["主体句"],sha256 前16 惯例)。
守卫:逐文件计数>0 才写+原子写+回读+备份 apps/output/bak/qi21-sheath-1018/;
幂等;--check 只查。
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
HOME = Path.home()
ENGINE_MYNODES = HOME / "Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes"
BAK = REPO / "apps/output/bak/qi21-sheath-1018"
CAMPAIGN = "1018sheath"

R = {
    # 持剑姿势:柄→鞘(A=1017 虎口全式 / B=短式 / C=动词精度例 / D=自检夹具)
    "R1": ("右手虎口轻按在挂定的剑柄上端，五指自然虚拢、指腹贴实柄身",
           "右手虎口轻按在挂定的剑鞘鞘身上端，五指自然虚拢、指腹贴实鞘面"),
    "R2": ("剑身完整收在鞘中，右手轻按剑柄",
           "剑身完整收在鞘中，右手轻按剑鞘"),
    "R3": ("「右手轻按剑柄」不是「拿着剑」",
           "「右手轻按剑鞘」不是「拿着剑」"),
    "R4": ("右手轻按剑柄姿态从容", "右手轻按剑鞘姿态从容"),
    # 发色必写:例句补乌黑(E=女修句 / F=美宣雷劫句)
    "R5": ("长发半束只簪一支素银簪", "乌黑长发半束只簪一支素银簪"),
    "R6": ("长发高束马尾、束发紧实", "乌黑长发高束马尾、束发紧实"),
    # 手册纪律条款(G=四件套发色必写 / H=持挂几何按鞘位)
    "R7": ("发型＝身份锚**必写**（主体句不写发型＝无人兜底）",
           "发型＝身份锚**必写且发色必写**（主体句不写发型或发色＝无人兜底，「乌黑长发」式＝形制与发色一体落，1018 用户裁定）"),
    "R8": ("挂载侧别与倾角／鞘尾剑柄朝向／持挂手臂姿态／虎口扣位／五指接触关系",
           "挂载侧别与倾角／鞘尾剑柄朝向／持挂手臂姿态／虎口按鞘位（挂定未拔时手按剑鞘鞘身，禁按剑柄——按柄＝拔剑预备式，1018 用户裁定）／五指接触关系"),
}

FILES = [
    REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/art_prompt/art_subject_ten_types.md",
    REPO / "docs/prompts/Qwen-Image-2.1/07-主体句写作宪法.md",
    REPO / "docs/prompts/道劫_类型主体句示例.md",
    REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md",
    REPO / "apps/backend/comfyui/my_nodes/nodes/my_qi21_prompt_assembly.py",
    ENGINE_MYNODES / "nodes/my_qi21_prompt_assembly.py",
    REPO / "apps/backend/comfyui/my_nodes/tests/test_my_qi21_api_pe_selfcheck.py",
    REPO / "apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
    ENGINE_MYNODES / "subgraphs/qi21-提示词类型优化子图.json",
    REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json",
    REPO / "apps/backend/comfyui/workflows/1_图片/Flux3图像/flux3-道劫-t2i.json",
    REPO / "apps/backend/comfyui/workflows/1_图片/K2图像/2_图生图/K2-角色设定-道劫.json",
    REPO / "apps/backend/comfyui/workflows/1_图片/K2图像/2_图生图/K2-角色设定-道劫-专家模式.json",
    REPO / "apps/backend/comfyui/my_nodes/nodes/my_charsheet_labels.py",
]


def swap(check: bool):
    total = 0
    BAK.mkdir(parents=True, exist_ok=True)
    for p in FILES:
        if not p.is_file():
            print(f"[{CAMPAIGN}] {p.name}@{p.parent.parent.name}: missing-skip")
            continue
        raw = p.read_text(encoding="utf-8")
        n0 = sum(raw.count(old) for old, _ in R.values())
        if n0 == 0:
            print(f"[{CAMPAIGN}] {p.name}@{p.parent.parent.name}: zero(already/无关)")
            continue
        out = raw
        for old, new in R.values():
            out = out.replace(old, new)
        # 残留校验:新串包含旧串的规则(R5/R6 前缀增补式)用计数等式验,
        # 其余用旧串绝迹验(新⊃旧时旧串计数恒为新串子串,不能当残留)
        for k, (old, new) in R.items():
            if old in new:
                grew = out.count(new) - raw.count(new)
                if grew != raw.count(old):
                    print(f"[{CAMPAIGN}] FAIL {k} 计数不等(Δ新={grew} 旧={raw.count(old)}): {p}")
                    sys.exit(1)
            elif out.count(old):
                print(f"[{CAMPAIGN}] FAIL {k} 残留: {p}")
                sys.exit(1)
        cnt = n0
        print(f"[{CAMPAIGN}] {p.name}@{p.parent.parent.name}: {'would' if check else 'ok'}×{cnt}")
        total += cnt
        if check:
            continue
        bak = BAK / (p.parent.parent.name + "__" + p.name + ".bak")
        if not bak.exists():
            shutil.copy2(p, bak)
        tmp = p.with_suffix(p.suffix + ".tmp-sheath")
        tmp.write_text(out, encoding="utf-8")
        tmp.replace(p)
    return total


def reanchor(check: bool):
    """主体句例文哈希锚(装配节点 _SUBJECT_EXAMPLE 变更后重锚)。"""
    asm = REPO / "apps/backend/comfyui/my_nodes/nodes/my_qi21_prompt_assembly.py"
    spec = importlib.util.spec_from_file_location("asm", asm)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    sha16 = hashlib.sha256(m._SUBJECT_EXAMPLE.encode()).hexdigest()[:16]
    tst = REPO / "apps/backend/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py"
    txt = tst.read_text(encoding="utf-8")
    old_anchor = '"主体句": "afd9e6f562e3e606"'
    new_anchor = f'"主体句": "{sha16}"'
    print(f"[{CAMPAIGN}] 主体句锚 {'would' if check else 'ok'}: afd9e6f562e3e606→{sha16}"
          if old_anchor in txt else f"[{CAMPAIGN}] 主体句锚字面未命中(现含 {sha16 in txt})")
    if not check and old_anchor in txt:
        bak = BAK / "test_my_qi21_prompt_assembly.py.bak"
        if not bak.exists():
            shutil.copy2(tst, bak)
        tst.write_text(txt.replace(old_anchor, new_anchor, 1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    n = swap(args.check)
    reanchor(args.check)
    if not args.check and n == 0:
        print(f"[{CAMPAIGN}] 幂等:零待换,exit 3")
        sys.exit(3)
    print(f"[{CAMPAIGN}] {'CHECK' if args.check else 'DONE'} 总换点={n}")


if __name__ == "__main__":
    main()
