#!/usr/bin/env python3
"""qwen21-t2i.json 主 TE 换装 Heretic(0924 用户令:TE 换 Heretic 当主力)。

背景:Q2-1 四件中三件(qi21-道劫-t2i/qi21-道劫-i2i/qi21-edit)由幂等生成器驱动,
本 task 已在生成器侧换装;唯 qwen21-t2i.json 是 09-23 画布重存版(生成器
qwen21_canvas_options_0923.py 已随 caed3ab 退役删除),无生成器可改——契约测试
test_qwen21_workflow_contract.py 的 CLIP_FILE 对四件统一断言,故此件必须同步换装,
否则契约恒红。本脚本即该件的幂等换装真源(重跑=无操作 PASS)。

范围:仅 qwen21-t2i.json;替换主 TE 字面量
    qwen3vl_8b_bf16.safetensors → qwen3vl_8b_bf16_heretic.safetensors
预期命中 4 处:CLIPLoader[2] widgets_values + widgets_values_named.clip_name +
说明 Note 双字段(content/text 各一)。PE 专属 TE(qwen3.5_9b 系)不含该字面量,
天然免疫。官方 TE 件保留引擎家不删(换装后作备胎)。

验证(任一失败退出码 1):json 往返 / 主 CLIP=heretic 恰 1 且 type=qwen_image /
PE CLIP 官方件名逐字恰 1 / 旧字面量归零 / 新字面量恰 4。

用法:python3 apps/build/scripts/q21_te_heretic_swap_0924.py [--check]
    --check 只查不写(换装后应报 already/ok)。
"""
from __future__ import annotations

import json
import pathlib
import sys

_SCRIPT = pathlib.Path(__file__).resolve()
_REPO = _SCRIPT.parents[3]
TARGET = (_REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/"
          "1_文生图/qwen21-t2i.json")

OLD = "qwen3vl_8b_bf16.safetensors"                # 官方 TE(换装后=引擎家备胎)
NEW = "qwen3vl_8b_bf16_heretic.safetensors"        # Heretic 破限 TE(0924 主力)
PE_T2I = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors"   # PE 专属,不动
EXPECT_NEW = 4


def main() -> int:
    check_only = "--check" in sys.argv[1:]
    text = TARGET.read_text(encoding="utf-8")
    n_old, n_new = text.count(OLD), text.count(NEW)

    if n_old == 0:
        if n_new != EXPECT_NEW:
            print(f"FAIL: 旧字面量已绝迹但新字面量 {n_new} ≠ 预期 {EXPECT_NEW}")
            return 1
        print(f"PASS(幂等无操作): {TARGET.name} 已是 Heretic 主力({n_new} 处)")
    else:
        if n_new != 0:
            print(f"FAIL: 混态(旧 {n_old} + 新 {n_new} 并存),疑半途手改")
            return 1
        if check_only:
            print(f"CHECK-ONLY: 待换装 {n_old} 处(未写盘)")
            return 0
        TARGET.write_text(text.replace(OLD, NEW), encoding="utf-8")
        print(f"换装完成: {n_old} 处 {OLD} → {NEW}")

    # ── 换装后结构验证(与契约 test_clip_loader_* 同口径)────────────
    graph = json.loads(TARGET.read_text(encoding="utf-8"))
    clips = [n for n in graph["nodes"] if n.get("type") == "CLIPLoader"]
    main_clips = [n for n in clips if n["widgets_values"][0] == NEW]
    pe_clips = [n for n in clips if n["widgets_values"][0] == PE_T2I]
    errs = []
    if len(clips) != 2:
        errs.append(f"CLIPLoader 应恰 2 个(主+PE),得 {len(clips)}")
    if len(main_clips) != 1:
        errs.append(f"主 CLIP({NEW})应恰 1 个,得 {len(main_clips)}")
    elif main_clips[0]["widgets_values"][1] != "qwen_image":
        errs.append("主 CLIPLoader type 应 qwen_image")
    if len(pe_clips) != 1:
        errs.append(f"PE CLIP({PE_T2I})应恰 1 个,得 {len(pe_clips)}")
    after = TARGET.read_text(encoding="utf-8")
    if after.count(OLD) != 0:
        errs.append(f"旧字面量未归零({after.count(OLD)})")
    if after.count(NEW) != EXPECT_NEW:
        errs.append(f"新字面量 {after.count(NEW)} ≠ 预期 {EXPECT_NEW}")
    if errs:
        for e in errs:
            print("FAIL:", e)
        return 1
    print(f"PASS: 主 CLIP={NEW}(type=qwen_image)恰 1 / PE CLIP 逐字不动 / "
          f"旧归零·新恰 {EXPECT_NEW} / json 往返 OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
