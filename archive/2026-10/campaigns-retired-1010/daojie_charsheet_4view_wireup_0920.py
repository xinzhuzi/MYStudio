#!/usr/bin/env python3
"""4-View 换装落账(09-20 三轮;两工作流同改,用户令:方案要落到工作流本体)。

改动面(全部写进工作流 JSON 文件,画布即所见):
  · [164] LoRA→Krea2_Character_Design_4-View_V1(四视图件,09-20 对拍实测过);
  · VLM 三件 [184]/[162]/[163] mute(四视图=单句触发词,无需 VLM 重写);
  · 新 [308] PrimitiveStringMultiline=官方触发词,接管提示词源:
      主文件 [308]→[305].string_a(与 [304] 底座锚拼接)→[119];
      专家模式 [308]→[119].prompt 直连;
  · [53] steps 10→8(4-View 官方 turbo 口径);
  · [307] MyCharsheetLabels widgets 7→9(新 layout=四格条带+grid_labels)。
幂等:已 4-View 文件名=跳过。
用法:python3 apps/build/scripts/daojie_charsheet_4view_wireup_0920.py
"""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WFS = {
    "main": REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/2_图生图"
            / "K2-角色设定-道劫.json",
    "expert": REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/2_图生图"
              / "K2-角色设定-道劫-专家模式.json",
}

LORA_4VIEW = "Krea2_Character_Design_4-View_V1.safetensors"
TRIGGER = ("Convert the character in Figure 1 into a 4-view turnaround: "
           "from left to right, full-body front view, full-body side view, "
           "full-body back view, and a close-up facial shot. Pure white background.")
FIELDS_DEFAULT = ("筑基后期 · 剑修\n青云门 · 内门弟子\n佩剑『听澜』\n"
                  "青玉道袍 · 素银簪\n眉目沉静 藏三分锋")
GRID_LABELS = "正面全身\n侧面全身\n背面全身\n面部特写"
WIDGETS_307 = ["青珣", FIELDS_DEFAULT, "苹方(简体)", 92, 40, "墨黑", "道劫",
               "四格条带", GRID_LABELS]


def main() -> int:
    for kind, path in WFS.items():
        wf = json.loads(path.read_text(encoding="utf-8"))
        nodes = {n["id"]: n for n in wf["nodes"]}
        links = {l[0]: l for l in wf["links"]}
        print(f"== {path.name} ({kind})")

        n164 = next(n for n in wf["nodes"] if n["id"] == 164)
        if n164["widgets_values"][0] == LORA_4VIEW and 308 in nodes:
            print("  已是 4-View 落账态,跳过")
            continue
        n164["widgets_values"][0] = LORA_4VIEW

        for nid in (184, 162, 163):  # VLM 三件 mute(mode=4)
            if nid in nodes:
                nodes[nid]["mode"] = 4
        print("  [184]/[162]/[163] mute(mode=4)")

        # [308] 触发词件新建;link29 重指(163→308),源侧登记同步
        n163 = nodes[163]
        l29 = links[29]
        dst_node = l29[3]
        old_src_out = next(o for o in nodes[l29[1]].get("outputs", [])
                           if 29 in (o.get("links") or []))
        old_src_out["links"].remove(29)
        l29[1], l29[2] = 308, 0
        v184 = nodes[184]
        wf["nodes"].append({
            "id": 308, "type": "PrimitiveStringMultiline",
            "pos": [v184["pos"][0], v184["pos"][1] + 760],  # VLM 区下一行(避 AABB)
            "size": [340, 180], "flags": {}, "mode": 0,
            "outputs": [{"name": "STRING", "type": "STRING", "links": [29],
                         "slot_index": 0}],
            "title": "四视图·触发词",
            "properties": {"Node name for S&R": "PrimitiveStringMultiline"},
            "widgets_values": [TRIGGER],
            "order": v184.get("order", 20)})
        print(f"  [308] 触发词件 → [{dst_node}] (link29 重指)")

        n53 = next(n for n in wf["nodes"] if n["id"] == 53)
        n53["widgets_values"][2] = 8
        (n53.get("widgets_values_named") or {}).update(steps=8)  # named 优先级高于位置式
        n307 = nodes[307]
        n307["widgets_values"] = list(WIDGETS_307)
        print("  [53] steps→8;[307] widgets→9(四格条带)")

        path.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
