#!/usr/bin/env python3
"""daojie_lora_stack.json 预设按 09-19 对拍定谳点亮(九型配方 C2/C3 数据一致)。

与 daojie_bases_v3_0919.py 同源同值(定谳=docs/prompts/道劫_水墨四件对拍定谳_0919.md §3):
  sumiwash(墨洗): 场景 on 0.8(主推最佳)/概念气氛图 on 0.7(候选首选中值)
  tancai(淡彩线描): 分镜剧情图 on 0.5(连环画候选下沿)
  goldenmist(金雾): 场景/概念气氛图 0.6 已在(零改动)
其余槽位零改动(人物系三件维持,全局件恒挂,备选件恒关)。
改后账:点亮矩阵 = daojie_bases.json lora_recipe 一比一(契约测试钉死)。

幂等:目标态已达成即跳过写盘;写前断言现值与预期旧态一致(防错文件)。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
STACK = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json"
BASES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"

# (slot_key, 型) -> (旧 on, 旧 weight, 新 on, 新 weight)
CHANGES = [
    ("sumiwash", "场景", False, True, 1.0, 0.8),
    ("sumiwash", "概念气氛图", False, True, 1.0, 0.7),
    ("tancai", "分镜剧情图", False, True, 1.0, 0.5),
]


def main() -> int:
    slots = json.loads(STACK.read_text(encoding="utf-8"))
    by_key = {s["key"]: s for s in slots}
    dirty = False
    for key, zh, old_on, new_on, old_w, new_w in CHANGES:
        p = by_key[key]["presets"][zh]
        if p == {"on": new_on, "weight": new_w}:
            continue  # 幂等:已达标
        if p != {"on": old_on, "weight": old_w}:
            print(f"✗ 槽「{key}」{zh} 现值 {p} 与预期旧态不符,拒绝盲改", file=sys.stderr)
            return 2
        by_key[key]["presets"][zh] = {"on": new_on, "weight": new_w}
        dirty = True
    # note 增补定谳出处(仅目标槽)
    if dirty:
        by_key["sumiwash"]["note"] = ("09-19 对拍定谳:场景●0.8(主推最佳,0.6-0.8)/"
                                      "概念气氛●0.7(候选首选);人物轻档 0.4-0.6=可选不默认;"
                                      "w1.0 光斑粒子判崩;与金雾0.6共存已验证")
        by_key["tancai"]["note"] = ("09-19 对拍定谳:分镜剧情图●0.5(连环画候选 0.5-0.6,"
                                    "场景证据外推);场景备选 0.5-0.6;w1.0 描边化+紫灰污染判崩;"
                                    "启用须补触发词 watercolor ink illustration style")
        STACK.write_text(json.dumps(slots, ensure_ascii=False, indent=2) + "\n",
                         encoding="utf-8")

    # 自检:栈点亮矩阵 == bases lora_recipe 一比一(文件↔权重↔开关)
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    for e in bases:
        zh, want = e["zh"], {i["file"]: i["weight"] for i in e["lora_recipe"]}
        for s in slots:
            on = s["presets"][zh]["on"]
            w = s["presets"][zh]["weight"]
            if s["file"] in want:
                assert on and abs(w - want[s["file"]]) < 1e-9, (zh, s["key"], w)
            elif s["key"] not in ("turbo", "projector"):  # 全局件不入配方
                assert not on, (zh, s["key"], "配方未列却点亮")
    print("OK daojie_lora_stack.json 预设=定谳点亮,与 daojie_bases.lora_recipe 一比一"
          + ("(本次写盘)" if dirty else "(幂等跳过)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
