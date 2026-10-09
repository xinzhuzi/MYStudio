#!/usr/bin/env python3
"""库存模板 TE 切 Heretic(1005 用户令·乙案:先切模板,后删原版 8B TE)。

背景:1004 磁盘审计定谳原版 qwen3vl_8b_bf16(16G)为全 models 唯一冗余嫌疑,
瘦身选项①候令;1005 用户选乙案。探针定谳(与本脚本同日)真实引用形态:
  - 6 件模板的 widget 保存值(CLIPLoader clip_name,含根层子图实例+definitions
    子图定义双形态)全是 qwen3vl_8b_int8_convrot——盘上从未装过,模板点跑本就
    报缺,与原版 bf16 无运行时关联;
  - 原版 bf16 只活在社区 3 件的 properties.models[].name 依赖元数据(每件 2 处)
    与官方 3 件的 Note 文档(纯文档)。
乙案手术口径:6 件全部**独立成串**的 int8 与 bf16 引用(widget+properties
元数据,探针实测 21+6=27 处)一律切 heretic,使模板开箱即跑;含旧名的更长
字符串(官方 Note 文档/properties url,探针证实无带前缀 widget 形态)逐字
保全,前后多重集相等断言。

替换原理:带 JSON 引号精确串替换(如 "qwen3vl_8b_bf16.safetensors" 整体),
长串内的旧名(前接 / 或正文)结构上不可能命中,故不动 Note/url;文件零重排。

验证(任一失败退出码 1,先验后写):独立串计数=探针硬编码期望/替换后两旧名
独立串归零/heretic 精确串=替换总数/长串多重集前后全等/json 往返。
每件期望计数硬编码(探针实测),漂移即红。

用法:python3 apps/build/scripts/campaigns/q21_stock_te_heretic_1005.py [--check]
    --check 只查不写。幂等:重跑=无操作 PASS。
"""
from __future__ import annotations

import json
import pathlib
import sys
from collections import Counter

_SCRIPT = pathlib.Path(__file__).resolve()
_REPO = _SCRIPT.parents[4]  # 本件住 campaigns/ 子层,比 0924 脚本深一级
_WF = _REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"

NEW = "qwen3vl_8b_bf16_heretic.safetensors"        # Heretic 破限 TE(0924 起主力)
OLD_INT8 = "qwen3vl_8b_int8_convrot.safetensors"   # 官方模板默认 TE(盘上未装)
OLD_BF16 = "qwen3vl_8b_bf16.safetensors"           # 官方原版 TE(1005 乙案退役)
OLDS = (OLD_INT8, OLD_BF16)

# (文件, 期望int8处数, 期望bf16处数)——探针(同日 JSON 全树走查)实测
TARGETS = [
    (_WF / "0_官方模板/image_qwen_image_2_1_t2i.json", 5, 0),
    (_WF / "0_官方模板/image_qwen_image_2_1_image_edit.json", 5, 0),
    (_WF / "0_官方模板/image_qwen_image_2_1_background_removal.json", 5, 0),
    (_WF / "3_社区模板/社区-全能文生图-官方PE.json", 2, 2),
    (_WF / "3_社区模板/社区-全能图片编辑-官方PE.json", 2, 2),
    (_WF / "3_社区模板/社区-编辑生图整合-TE.json", 4, 2),
]


def collect(data) -> tuple[dict[str, int], Counter]:
    """全树走查:值恰为各旧名的独立串计数 + 含旧名的更长字符串多重集。"""
    counts = {old: 0 for old in OLDS}
    longer: Counter = Counter()

    def walk(o) -> None:
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, str):
            for old in OLDS:
                if o == old:
                    counts[old] += 1
                elif old in o:
                    longer[o] += 1

    walk(data)
    return counts, longer


def main() -> int:
    check_only = "--check" in sys.argv[1:]
    total = {"int8": 0, "bf16": 0}
    fails: list[str] = []

    for target, exp_int8, exp_bf16 in TARGETS:
        rel = target.relative_to(_REPO)
        if not target.exists():
            fails.append(f"{rel}: 文件不存在")
            continue
        raw = target.read_text(encoding="utf-8")
        counts, longer_before = collect(json.loads(raw))
        n_int8, n_bf16 = counts[OLD_INT8], counts[OLD_BF16]

        if (n_int8, n_bf16) != (exp_int8, exp_bf16):
            n_new = raw.count(f'"{NEW}"')
            if n_int8 == 0 and n_bf16 == 0 and n_new == exp_int8 + exp_bf16:
                print(f"PASS(幂等无操作): {rel.name} 旧名独立串已绝迹"
                      f"(heretic 精确串 {n_new})")
                continue
            fails.append(f"{rel}: 计数漂移 int8={n_int8}(期望{exp_int8}) "
                         f"bf16={n_bf16}(期望{exp_bf16}) heretic={n_new},未写盘")
            continue
        if check_only:
            print(f"CHECK-ONLY: {rel.name} 待切 int8 {n_int8} + bf16 {n_bf16} 处(未写盘)")
            total["int8"] += n_int8
            total["bf16"] += n_bf16
            continue

        out = raw.replace(f'"{OLD_INT8}"', f'"{NEW}"').replace(f'"{OLD_BF16}"', f'"{NEW}"')
        target.write_text(out, encoding="utf-8")

        after_raw = target.read_text(encoding="utf-8")
        after_counts, longer_after = collect(json.loads(after_raw))
        errs = []
        if after_counts[OLD_INT8] or after_counts[OLD_BF16]:
            errs.append(f"旧名独立串未归零 {after_counts}")
        expect_new = exp_int8 + exp_bf16
        n_new = after_raw.count(f'"{NEW}"')
        if n_new != expect_new:
            errs.append(f"heretic 精确串 {n_new} ≠ 期望 {expect_new}")
        if longer_after != longer_before:
            errs.append(f"含旧名长串被误动({len(longer_before)}→{len(longer_after)} 种)")
        if errs:
            fails.append(f"{rel}: " + ";".join(errs))
            continue
        print(f"切装完成: {rel.name} int8 {n_int8} + bf16 {n_bf16} → heretic"
              f"(Note/url 长串 {sum(longer_before.values())} 处逐字未动)")
        total["int8"] += n_int8
        total["bf16"] += n_bf16

    if fails:
        for f in fails:
            print("FAIL:", f)
        return 1
    print(f"合计: int8 {total['int8']} + bf16 {total['bf16']} 处独立串 → {NEW};json 往返全通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
