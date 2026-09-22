#!/usr/bin/env python3
"""QuadView 四视图终态落账(09-20 五轮;两工作流同改——用户令:做工作流输出角色四视图)。

落账面(全部写进工作流 JSON 本体,画布即所得,实弹口径=G3 终态全链):
  · [164] LoRA→QuadView_krea2_v1.safetensors(用户荐原厂件,bf16 底模四格触发实证);
  · [53] 采样=官方口径:steps=10、sampler_name=euler、scheduler=simple
    (注意:euler 是 sampler_name,KSampler 位置序 [4]=sampler_name [5]=scheduler;
    named 与位置式双写);
  · [120] Krea2EditModelPatch ref_boost 6.0→1.0(官方 QuadView 工作流口径,
    6.0=参考锁死档会压四格布局);
  · [119]/[85] grounding_px 1024→0(官方=native);
  · [308] 触发词件 unmute+换 QuadView 官方触发词,link29 源 [163]→[308]
    (主文件 [308]→[305].string_a 与 [304] 底座锚拼接→[119];专家 [308]→[119] 直连);
  · [184]/[162]/[163] VLM 三件 mute(单句触发词不需 VLM);
  · [307] layout=四格条带(自适应对齐标签+左上角色小卡+朱印);
  · [156] 保持 2568×1712(2K 用户定案),[90] 九型栈=设定板档(现值不动)。
幂等:[164] 已 QuadView 且 [308] mode=0=跳过。
用法:python3 apps/build/scripts/daojie_charsheet_quadview_wireup_0920.py
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

LORA_QUAD = "QuadView_krea2_v1.safetensors"
# Alissonerdx README §QuadView — Krea 2 触发词逐字
TRIGGER = ("Convert the character in the image to a Character Sheet showing "
           "a face close-up, front full body, side full body and back full "
           "body views")
GRID_LABELS = "面部特写\n正面全身\n侧面全身\n背面全身"


def _set53(n53: dict) -> None:
    n53["widgets_values"][2] = 10
    n53["widgets_values"][4] = "euler"
    n53["widgets_values"][5] = "simple"
    named = n53.get("widgets_values_named")
    if isinstance(named, dict):
        named.update(steps=10, sampler_name="euler", scheduler="simple")


def main() -> int:
    for kind, path in WFS.items():
        wf = json.loads(path.read_text(encoding="utf-8"))
        nodes = {n["id"]: n for n in wf["nodes"]}
        links = {l[0]: l for l in wf["links"]}
        print(f"== {path.name} ({kind})")

        n164 = nodes[164]
        if (n164["widgets_values"][0] == LORA_QUAD
                and nodes[308].get("mode") == 0):
            print("  已是 QuadView 落账态,跳过")
            continue
        n164["widgets_values"][0] = LORA_QUAD

        _set53(nodes[53])
        n120 = nodes[120]
        try:
            n120["widgets_values"][0] = 1.0
        except Exception:
            pass
        named120 = n120.get("widgets_values_named")
        if isinstance(named120, dict) and "ref_boost" in named120:
            named120["ref_boost"] = 1.0
        for nid in (119, 85):  # grounding_px → 0(位置序 [1])
            wv = nodes[nid].get("widgets_values")
            if isinstance(wv, list) and len(wv) > 1:
                wv[1] = 0
            named = nodes[nid].get("widgets_values_named")
            if isinstance(named, dict) and "grounding_px" in named:
                named["grounding_px"] = 0

        for nid in (184, 162, 163):   # VLM 三件 mute
            if nid in nodes:
                nodes[nid]["mode"] = 4
        n308 = nodes[308]
        n308["mode"] = 0              # 触发词件 unmute+换官方触发词
        n308["title"] = "四视图·QuadView 触发词"
        n308["widgets_values"] = [TRIGGER]
        l29 = links[29]               # link29 源 [163]→[308],源侧登记同步
        old_out = next((o for o in nodes[l29[1]].get("outputs", [])
                        if 29 in (o.get("links") or [])), None)
        if old_out:
            old_out["links"].remove(29)
        out308 = n308["outputs"][0]
        out308.setdefault("links", [])
        if 29 not in out308["links"]:
            out308["links"].append(29)
        l29[1], l29[2] = 308, 0

        n307 = nodes[307]             # 标注层=四格条带
        n307["widgets_values"][7] = "四格条带"
        n307["widgets_values"][8] = GRID_LABELS

        path.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        print("  [164]QuadView + [53]euler/simple×10 + [120]rb1 + gp0 + "
              "[308]触发词 + [307]四格条带 —— 已落")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
