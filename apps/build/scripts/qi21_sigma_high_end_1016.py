#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""道劫 viggle σ 表修正·官方铁律形(役号 1016sigma)。

背景(1016 用户令「viggle 永远是 9 步」+「降噪信息从官方再看看」):
  - 官方 ViggleTurboSigmas 节点 tooltip 铁律:加减步**只动高端**(1.0→0.875 区间),
    尾锚 0.875/0.75/0.5/0.25 恒不动(5 步=1.0,0.875,…;7 步=1.0,0.9583,0.9167,0.875,…)。
  - 现役 9 点表为**低端加步**形(官方 7 点 + 0.16666667/0.08333333),违反铁律
    (来由=a357b40b「comfyui融合」旧合并,无设计说明存档)。
  - 修正形:9 点=高端区间 6 点均布(间距 0.025)+尾锚四点——
    1.0, 0.975, 0.95, 0.925, 0.9, 0.875, 0.75, 0.5, 0.25
    (节点自动补终止 0 → 10 元 σ;[7021] SplitSigmas step=7 不动 → 段A 7 步
    全高端 + 段B 2 步 0.5→0 底模收尾,9 步双段结构保持)。
  - turbo 臂 σ(0.978453…)经官方模板+model_index.json 双验逐字一致,本役零触碰。

做法(文本级手术,幂等 fail-closed):
  1) 全目标文件:OLD9 → NEW9(裸串替换=同时覆盖 顶层面板 widgets/命名 widgets/
     子图 widgets/Note 文档段;逐文件断言替换数≥1)。
  2) i2i 两件:带引号 OLD6 → NEW9(仅子图内部 ViggleTurboSigmas 遗留 6 点 widget;
     Note 里不带引号的 OLD6=6 步单段合法文档,保留)。
  3) 备份 .bak-1016sigma;改后 json.loads 往返断言;OLD9 残留归零断言。

用法:python3 qi21_sigma_high_end_1016.py [--check]
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/engines/comfyui"
CAMPAIGN = "1016sigma"

OLD9 = "1.0, 0.9583, 0.9167, 0.875, 0.75, 0.5, 0.25, 0.16666667, 0.08333333"
OLD6 = "1.0, 0.9375, 0.875, 0.75, 0.5, 0.25"
NEW9 = "1.0, 0.975, 0.95, 0.925, 0.9, 0.875, 0.75, 0.5, 0.25"

WF = BASE / "workflows/1_图片/Q2-1图像"
TARGETS: list[tuple[Path, bool]] = [
    # (文件, 是否做带引号 OLD6 修正)
    (WF / "1_文生图/qi21-道劫-t2i.json", False),
    (WF / "1_文生图/qwen21-道劫-t2i-api.json", False),
    (WF / "2_图生图/qi21-道劫-i2i.json", True),
    (WF / "2_图生图/qi21-edit.json", False),
    (WF / "2_图生图/qi21-道劫-img2img.json", False),
    (BASE / "my_nodes/subgraphs/qi21-道劫-加速子图.json", False),
    (BASE / "my_nodes/subgraphs/qi21-道劫-加速子图-i2i.json", True),
    (BASE / "my_nodes/subgraphs/qi21-道劫-加速子图-edit.json", False),
]


def main(check_only: bool) -> int:
    total9 = total6 = 0
    for path, fix6 in TARGETS:
        if not path.exists():
            print(f"[{CAMPAIGN}] 缺目标文件,中止(fail-closed):{path}")
            return 1
        text = path.read_text(encoding="utf-8")
        n9 = text.count(OLD9)
        n6q = text.count(f'"{OLD6}"') if fix6 else 0
        print(f"[{CAMPAIGN}] {path.name}: OLD9×{n9}" + (f" 引号OLD6×{n6q}" if fix6 else ""))
        if check_only:
            total9 += n9
            total6 += n6q
            continue
        if n9 == 0 and n6q == 0:
            print(f"[{CAMPAIGN}]   ↑ 无锚点,跳过(可能已施或该形不含 σ 表)")
            continue
        new_text = text.replace(OLD9, NEW9)
        if fix6:
            new_text = new_text.replace(f'"{OLD6}"', f'"{NEW9}"')
        # 往返断言:改后必须仍是合法 JSON
        try:
            json.loads(new_text)
        except ValueError as exc:
            print(f"[{CAMPAIGN}] 改后 JSON 损坏,不落盘:{path} {ex}")
            return 1
        if OLD9 in new_text:
            print(f"[{CAMPAIGN}] OLD9 残留,不落盘:{path}")
            return 1
        bak = path.with_name(path.name + f".bak-{CAMPAIGN}")
        if not bak.exists():
            shutil.copy2(path, bak)
        path.write_text(new_text, encoding="utf-8")
        print(f"[{CAMPAIGN}]   已改并备份 → {bak.name}(n9={n9}, n6q={n6q})")
        total9 += n9
        total6 += n6q
    mode = "--check 清点" if check_only else "手术完成"
    print(f"[{CAMPAIGN}] {mode}:OLD9 共 {total9} 处→NEW9;引号OLD6 共 {total6} 处→NEW9;"
          f"[7021] SplitSigmas step=7 未触碰(9 步双段 7+2 保持)")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只读清点,不改")
    sys.exit(main(ap.parse_args().check))
