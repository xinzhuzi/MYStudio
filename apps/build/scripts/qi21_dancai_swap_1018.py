#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""底座术语换血:工笔重彩→工笔淡彩(役号 1018davcai;1018 用户令
「提示词,从工笔重彩,改成淡彩…将 工笔重彩-->工笔淡彩」)。

范围=全部镜像同步单刀(防止半态锁锚红):
  A. qi21_bases.json 三副本(仓库真源/引擎 daojie-data 热读/装机 Resources)
     ——6 处:_doc/positive_text/人物/场景/美宣型文/layer_contract 契约段;
  B. 同目录 prompt_layering.json + ma_sync/runtime-contract.json +
     ma_sync/lock-anchors.json(装机侧同名镜像存在则同刀);
  C. 子图 qi21-提示词类型优化子图.json 4032 widget 底座副本
     (仓库 my_nodes/subgraphs + 引擎 custom_nodes/my-nodes/subgraphs);
  D. 工作流 t2i/edit/i2i 内嵌子图 4032 widget 副本;
  E. 两把测试锁随刀:test_my_qi21_prompt_assembly.py 锁层A全文哈希重锚
     (sha256 前16,惯例追加 重锚 注记)+test_qi21_style_boundary_1016.py
     在场词表 '中国工笔重彩'→'中国工笔淡彩'。
守卫:逐文件计数>0 才写+原子写+回读+备份 apps/output/bak/qi21-dancai-1018/;
幂等(全部零命中=exit 3)。--check=只查计数不写。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
HOME = Path.home()
MANUAL = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng"
APP_MANUAL = Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng")
ENGINE = HOME / "Library/Application Support/漫影工作室/comfyui"
ENGINE_MYNODES = ENGINE / "ComfyUI/custom_nodes/my-nodes"

OLD, NEW = "工笔重彩", "工笔淡彩"
BAK = REPO / "apps/output/bak/qi21-dancai-1018"
CAMPAIGN = "1018davcai"

# (文件, 说明) —— 存在才处理;装机/引擎镜像由 APP_MANUAL/ENGINE_MYNODES 派生
def file_set():
    fs = []
    for rel in ("json/qi21_bases.json", "json/prompt_layering.json",
                "ma_sync/runtime-contract.json", "ma_sync/lock-anchors.json"):
        fs.append((MANUAL / rel, f"repo:{rel}"))
        p = APP_MANUAL / rel
        if p.is_file():
            fs.append((p, f"app:{rel}"))
    fs.append((ENGINE / "daojie-data/qi21_bases.json", "engine:daojie-data/qi21_bases.json"))
    for sub in ("qi21-提示词类型优化子图.json", "qi21-提示词类型优化子图-i2i.json"):
        fs.append((REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs" / sub, f"repo:subgraphs/{sub}"))
        p = ENGINE_MYNODES / "subgraphs" / sub
        if p.is_file():
            fs.append((p, f"engine:subgraphs/{sub}"))
    for wf in ("1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
               "1_图片/Q2-1图像/2_图生图/qi21-edit.json",
               "1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"):
        fs.append((REPO / "apps/backend/engines/comfyui/workflows" / wf, f"repo:workflows/{wf.split('/')[-1]}"))
    return fs


def swap_text_files(check: bool) -> dict:
    out = {}
    BAK.mkdir(parents=True, exist_ok=True)
    for p, label in file_set():
        if not p.is_file():
            out[label] = "missing-skip"
            continue
        raw = p.read_text(encoding="utf-8")
        n = raw.count(OLD)
        if n == 0:
            already = NEW in raw
            out[label] = "already" if already else "zero-old(new-absent)"
            continue
        out[label] = f"would-swap×{n}" if check else f"swap×{n}"
        if check:
            continue
        bak = BAK / (label.replace("/", "_").replace(":", "@") + ".bak")
        if not bak.exists():
            shutil.copy2(p, bak)
        tmp = p.with_suffix(p.suffix + ".tmp-dancai")
        tmp.write_text(raw.replace(OLD, NEW), encoding="utf-8")
        reread = tmp.read_text(encoding="utf-8")
        if OLD in reread or reread.count(NEW) < n:
            tmp.unlink(missing_ok=True)
            print(f"[{CAMPAIGN}] FAIL 回读校验: {label}")
            sys.exit(1)
        tmp.replace(p)
    return out


def reanchor_tests(check: bool) -> list:
    """锁层A全文哈希重锚 + 边界测试在场词换新。"""
    notes = []
    asm = REPO / "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py"
    bases = MANUAL / "json/qi21_bases.json"
    new_pos = json.loads(bases.read_text(encoding="utf-8"))["art_style_base"]["positive_text"]
    if NEW not in new_pos:
        print(f"[{CAMPAIGN}] CHECK 模式:哈希按预演文本计算")
        new_pos = new_pos.replace(OLD, NEW)
    sha16 = hashlib.sha256(new_pos.encode()).hexdigest()[:16]
    txt = asm.read_text(encoding="utf-8")
    old_anchor = '"锁层A全文": "0b7d39d95a00782c"'
    new_anchor = f'"锁层A全文": "{sha16}"'
    if old_anchor in txt:
        notes.append(f"锁层A重锚 0b7d39d95a00782c→{sha16}")
        if not check:
            bak = BAK / "test_my_qi21_prompt_assembly.py.bak"
            if not bak.exists():
                shutil.copy2(asm, bak)
            txt = txt.replace(old_anchor, new_anchor, 1)
            asm.write_text(txt, encoding="utf-8")
    else:
        notes.append(f"锁层A锚字面未命中(可能已改)——现文件含 {sha16 in txt}")
    sb = REPO / "apps/backend/engines/comfyui/my_nodes/tests/test_qi21_style_boundary_1016.py"
    t2 = sb.read_text(encoding="utf-8")
    if "'中国工笔重彩'" in t2:
        notes.append("边界测试在场词 中国工笔重彩→中国工笔淡彩")
        if not check:
            bak = BAK / "test_qi21_style_boundary_1016.py.bak"
            if not bak.exists():
                shutil.copy2(sb, bak)
            sb.write_text(t2.replace("'中国工笔重彩'", "'中国工笔淡彩'"), encoding="utf-8")
    return notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    res = swap_text_files(args.check)
    for k, v in res.items():
        print(f"[{CAMPAIGN}] {k}: {v}")
    notes = reanchor_tests(args.check)
    for n in notes:
        print(f"[{CAMPAIGN}] TEST {n}")
    real = [v for v in res.values() if v.startswith(("swap", "would"))]
    if not args.check and not real:
        print(f"[{CAMPAIGN}] 幂等:无一处待换,exit 3")
        sys.exit(3)
    print(f"[{CAMPAIGN}] {'CHECK' if args.check else 'DONE'} 毕")


if __name__ == "__main__":
    main()
