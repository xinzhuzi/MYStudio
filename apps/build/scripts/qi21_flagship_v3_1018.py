#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A 裁定全量归一·役号 1018flagship(用户令 A+姿势精化「握住剑鞘,在剑的三分之一处」)。

1) 姿势段全线换握(轻按→握住上端三分之一处,锚端点+保防双剑保险):
   手册条款/宪法例/示例库§1§4/装配例文/子图/桥模板/画布/flux3/测试句;
2) 四处默认例句(表情版/中间版两代)整句归一到新旗舰逐字:
   05库§224/§239、api 桥模板、画布 t2i、装配例文(含引擎镜像);
3) 引擎用户区画布副本同步仓库版;装机 Resources 同步;
4) 双哈希重锚:主体句例文锚+flux3 source-hashes(非 drift 键)。
守卫:锚恰一次/原子写/回读/备份/幂等;--check 只查。
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
HOME = Path.home()
APP = Path("/Applications/漫影工作室.app/Contents/Resources")
ENGN = HOME / "Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes"
BAK = REPO / "apps/output/bak/qi21-flagship-1018"
FLAG = (REPO / "apps/output/qi21-fullcheck-1018/flagship_v3.txt").read_text(encoding="utf-8").strip()
CAMPAIGN = "1018flagship"

POSE_OLD = "右手虎口轻按在挂定的剑鞘鞘身上端，五指自然虚拢、指腹贴实鞘面"
POSE_NEW = "右手自然握住挂定的剑鞘上端三分之一处，五指环拢鞘身、指腹贴实鞘面"
POSE_OLD_L = POSE_OLD.replace("右手", "左手")
POSE_NEW_L = POSE_NEW.replace("右手", "左手")
MANUAL_RULE_OLD = "虎口按鞘位（挂定未拔时手按剑鞘鞘身，禁按剑柄——按柄＝拔剑预备式，1018 用户裁定）"
MANUAL_RULE_NEW = "握鞘位（挂定未拔时手握剑鞘上端三分之一处，禁握剑柄——握柄＝拔剑预备式，1018 用户裁定）"
VERB_OLD = "「右手轻按剑鞘」不是「拿着剑」"
VERB_NEW = "「右手握住剑鞘上端三分之一处」不是「拿着剑」"


def flagship_targets():
    """整句归一位:文件中含「青玉色道袍束月白腰带」的默认例文串→新旗舰。"""
    return [
        REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md",
        REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json",
        REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
        APP / "backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json",
        APP / "backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
        REPO / "apps/backend/comfyui/my_nodes/nodes/my_qi21_prompt_assembly.py",
        ENGN / "nodes/my_qi21_prompt_assembly.py",
        REPO / "apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
        ENGN / "subgraphs/qi21-提示词类型优化子图.json",
    ]


def pose_targets():
    return [
        REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/art_prompt/art_subject_ten_types.md",
        REPO / "docs/prompts/Qwen-Image-2.1/07-主体句写作宪法.md",
        REPO / "docs/prompts/道劫_类型主体句示例.md",
        REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md",
        REPO / "apps/backend/comfyui/workflows/1_图片/Flux3图像/flux3-道劫-t2i.json",
        APP / "backend/comfyui/workflows/1_图片/Flux3图像/flux3-道劫-t2i.json",
    ]


SENT_RE = re.compile(r"[^\n\"'『』〔〕⟨〉>]*青玉色道袍束月白腰带[^\n\"'『』〔〕⟨〉>]*")


def swap_sentence(p: Path, check: bool) -> int:
    raw = p.read_text(encoding="utf-8")
    hits = [m for m in SENT_RE.finditer(raw) if "眉峰舒展平顺" in m.group(0) or "腰侧石青剑绦悬一柄长剑" in m.group(0) or "右手轻按剑鞘" in m.group(0)]
    # 排除已是旗舰者
    hits = [m for m in hits if m.group(0).strip() != FLAG and "眉目沉静中带一点锋芒" not in m.group(0)]
    # 注:含「眉目沉静中带一点锋芒」但非全旗舰的中间版(装配例文)也要归一
    hits2 = [m for m in SENT_RE.finditer(raw)
             if "眉目沉静中带一点锋芒" in m.group(0) and m.group(0).strip() != FLAG]
    spans = sorted({(m.start(), m.end()) for m in hits + hits2}, reverse=True)
    if not spans:
        return 0
    if check:
        return len(spans)
    out = raw
    for s, e in spans:
        out = out[:s] + FLAG + out[e:]
    bak = BAK / (p.parent.parent.name + "__" + p.name + ".sent.bak")
    if not bak.exists():
        shutil.copy2(p, bak)
    tmp = p.with_suffix(p.suffix + ".tmp-fl")
    tmp.write_text(out, encoding="utf-8")
    assert FLAG in tmp.read_text(encoding="utf-8")
    tmp.replace(p)
    return len(spans)


def swap_pose(p: Path, check: bool) -> int:
    raw = p.read_text(encoding="utf-8")
    rules = [(POSE_OLD, POSE_NEW), (POSE_OLD_L, POSE_NEW_L),
             (MANUAL_RULE_OLD, MANUAL_RULE_NEW), (VERB_OLD, VERB_NEW)]
    n = sum(raw.count(o) for o, _ in rules)
    if not n:
        return 0
    if check:
        return n
    out = raw
    for o, w in rules:
        out = out.replace(o, w)
    for o, _ in rules:
        assert o not in out or o in w, f"残留 {o[:20]} @{p}"
    bak = BAK / (p.parent.parent.name + "__" + p.name + ".pose.bak")
    if not bak.exists():
        shutil.copy2(p, bak)
    p.write_text(out, encoding="utf-8")
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    BAK.mkdir(parents=True, exist_ok=True)
    tot = 0
    for p in pose_targets():
        if not p.is_file():
            continue
        n = swap_pose(p, args.check)
        print(f"[{CAMPAIGN}] pose {p.name}@{p.parent.parent.name}: {'would' if args.check else 'ok'}×{n}")
        tot += n
    for p in flagship_targets():
        if not p.is_file():
            print(f"[{CAMPAIGN}] sent {p.name}: missing-skip")
            continue
        n = swap_sentence(p, args.check)
        print(f"[{CAMPAIGN}] sent {p.name}@{p.parent.parent.name}: {'would' if args.check else 'ok'}×{n}")
        tot += n
    if not args.check:
        # 引擎用户区画布副本=仓库版同步
        eu = HOME / "Library/Application Support/漫影工作室/comfyui/ComfyUI/user/default/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
        src = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
        if eu.is_file():
            eu.write_bytes(src.read_bytes())
            print(f"[{CAMPAIGN}] 引擎用户区副本=仓库版同步 md5={hashlib.md5(src.read_bytes()).hexdigest()}")
        # 主体句例文哈希重锚
        asm = REPO / "apps/backend/comfyui/my_nodes/nodes/my_qi21_prompt_assembly.py"
        spec = importlib.util.spec_from_file_location("asm", asm)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        sha = hashlib.sha256(m._SUBJECT_EXAMPLE.encode()).hexdigest()[:16]
        assert m._SUBJECT_EXAMPLE.strip() == FLAG, "装配例文≠旗舰,异常"
        tst = REPO / "apps/backend/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py"
        txt = tst.read_text(encoding="utf-8")
        mm = re.search(r'"主体句": "([0-9a-f]{16})"', txt)
        if mm and mm.group(1) != sha:
            shutil.copy2(tst, BAK / "test_asm.py.bak")
            tst.write_text(txt.replace(mm.group(0), f'"主体句": "{sha}"', 1), encoding="utf-8")
            print(f"[{CAMPAIGN}] 主体句锚重锚 {mm.group(1)}→{sha}")
        # flux3 夹具姿势段+source-hashes 重锚
        td = REPO / ".trellis/tasks/10-16-flux3-daojie-ten-types"
        for f in ("artifacts/cases.json", "artifacts/gui-template.json"):
            fp = td / f
            raw = fp.read_text(encoding="utf-8")
            n = raw.count(POSE_OLD)
            if n:
                shutil.copy2(fp, BAK / (f.replace("/", "_") + ".bak"))
                fp.write_text(raw.replace(POSE_OLD, POSE_NEW), encoding="utf-8")
                print(f"[{CAMPAIGN}] flux3 {f}: pose×{n}")
        shp = td / "artifacts/source-hashes.json"
        sh = json.loads(shp.read_text())
        drift = json.loads((td / "reports/source-drift.json").read_text())
        for name in sh:
            if name in drift:
                sh[name] = drift[name]["original_sha256"]
            else:
                sh[name] = hashlib.sha256((REPO / name).read_bytes()).hexdigest()
        shp.write_text(json.dumps(sh, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[{CAMPAIGN}] flux3 source-hashes 重锚毕")
    print(f"[{CAMPAIGN}] {'CHECK' if args.check else 'DONE'} tot={tot}")


if __name__ == "__main__":
    main()
