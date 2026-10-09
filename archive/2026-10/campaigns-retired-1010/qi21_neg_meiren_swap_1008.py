#!/usr/bin/env python3
"""qi21 负向性别税清退 1008:「网文封面美人」→「网文封面画风」一词手术。

背景(2026-10-08 00002 女修画成男性案定谳后的第二刀):
  负向清单里「美人」是唯一带性别载荷的脸部词——压的不是海报画风,是"漂亮
  女性脸"概念本身,对女性角色每发征收性别税(与男性漂移同向)。「古风偶像
  海报」=纯风格词(男女通吃)保留不动。换词保功能:封面/海报糖水美学照压,
  性别词拿掉。「网文封面画风」=6字裸视觉token,合规负向格式铁律
  (零指令词/零斜杠/<12字/零重复)。

落点(-uu 五树扫描 23 件活文件;排除日志/trellis备份/runs战役件/MA镜像):
  仓库7 + 装机6 + 构建产物6 + 引擎家4。
  生效链定谳:ApiPE 风格负面=引擎家 daojie-data/qi21_bases.json 的
  art_style_base.negative_text 热读(本工作流未连 [4032].1 旁路)——改引擎
  数据即下一发生效,无需重启/重载画布。

用法:
  python3 qi21_neg_meiren_swap_1008.py --dry   # 只报数不动盘
  python3 qi21_neg_meiren_swap_1008.py          # 开刀(幂等,二跑=0改)

纪律:纯文本逐字替换(不走 json round-trip,防重排版);.json 改后
json.loads 校验;改后旧串必须归零;四份 t2i 工作流+三份子图副本 md5 对账。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

OLD = "网文封面美人"
NEW = "网文封面画风"

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
APP = Path("/Applications/漫影工作室.app/Contents/Resources")
BUILD = REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources"
ENG = Path("/Users/zhengbingjin/Project/IP/漫影工作室")

TARGETS = [
    # ── 仓库(7) ──
    REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md",
    REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
    REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/prefix.md",
    REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
    REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/prompt_layering.json",
    REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/ma_sync/palette-canon.json",
    # ── 装机(6) ──
    APP / "backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    APP / "backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
    APP / "studio-manuals/art_skills/daojie_ink_guofeng/prefix.md",
    APP / "studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
    APP / "studio-manuals/art_skills/daojie_ink_guofeng/json/prompt_layering.json",
    APP / "studio-manuals/art_skills/daojie_ink_guofeng/ma_sync/palette-canon.json",
    # ── 构建产物(6) ──
    BUILD / "studio-manuals/art_skills/daojie_ink_guofeng/prefix.md",
    BUILD / "studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
    BUILD / "studio-manuals/art_skills/daojie_ink_guofeng/json/prompt_layering.json",
    BUILD / "studio-manuals/art_skills/daojie_ink_guofeng/ma_sync/palette-canon.json",
    BUILD / "backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    BUILD / "backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
    # ── 引擎家(4,含活数据) ──
    ENG / "skills/art_skills/daojie_ink_guofeng/prefix.md",
    ENG / "comfyui/daojie-data/qi21_bases.json",
    ENG / "comfyui/ComfyUI/user/default/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    ENG / "comfyui/ComfyUI/custom_nodes/my-nodes/subgraphs/qi21-提示词类型优化子图.json",
]

# md5 对账组:同名多副本改后应同指纹(并行役若已造成副本漂移,只报不合并)
MD5_GROUPS = {
    "qi21-道劫-t2i.json": [t for t in TARGETS if t.name == "qi21-道劫-t2i.json"],
    "qi21-提示词类型优化子图.json": [t for t in TARGETS if t.name == "qi21-提示词类型优化子图.json"],
    "qi21_bases.json": [t for t in TARGETS if t.name == "qi21_bases.json"],
}


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="只报数不动盘")
    args = ap.parse_args()

    missing = [t for t in TARGETS if not t.exists()]
    total_old = total_new = 0
    for t in TARGETS:
        if not t.exists():
            print(f"[缺失] {t}")
            continue
        raw = t.read_text(encoding="utf-8")
        n_old = raw.count(OLD)
        if n_old == 0:
            print(f"[零命中] {t.name} @ {t.parent.parent.name if t.parent.name in ('json','ma_sync') else t.parent.name}")
            continue
        swapped = raw.replace(OLD, NEW)
        # 三重校验:新计数=旧计数、旧串归零、长度差=词长差×次数
        assert swapped.count(NEW) >= n_old, f"{t}: 新词计数异常"
        assert OLD not in swapped, f"{t}: 旧串残留"
        assert len(swapped) - len(raw) == n_old * (len(NEW) - len(OLD)), f"{t}: 长度对账失败"
        if t.suffix == ".json":
            json.loads(swapped)  # 结构校验(不写回 round-trip 产物)
        total_old += n_old
        if args.dry:
            print(f"[干跑] {n_old}处 待改 {t}")
        else:
            t.write_text(swapped, encoding="utf-8")
            back = t.read_text(encoding="utf-8")
            assert OLD not in back and back.count(NEW) >= n_old, f"{t}: 落盘复核失败"
            total_new += n_old
            print(f"[已改] {n_old}处 {t}")

    print(f"\n合计:旧串 {total_old} 处" + (f" → 已改 {total_new} 处" if not args.dry else "(干跑)"))
    if missing:
        print(f"缺失 {len(missing)} 件(见上),须人工核因")
    if not args.dry:
        print("\n── md5 对账 ──")
        for gname, paths in MD5_GROUPS.items():
            sigs = {}
            for p in paths:
                if p.exists():
                    sigs.setdefault(md5(p), []).append(p.parent.parent.name or p.parent.name)
            flag = "同" if len(sigs) == 1 else "异(并行漂移,只报不合)"
            print(f"{gname}: {len(sigs)} 指纹 {flag}")
            for h, owners in sigs.items():
                print(f"  {h[:10]} ← {owners}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
