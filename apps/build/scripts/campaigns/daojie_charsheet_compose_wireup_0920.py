#!/usr/bin/env python3
"""四格拼版工作流落账(09-20 十轮;主文件——四支单视角子链+拼版标注)。

定死逻辑(用户口径):四视图=半身像/正面全身/侧面全身/背面全身,各一支
单视角 i2i 子链(单视角服从度已实弹验证),[307] 四格拼版模式按拼版顺序
定死格标签——人数/视角/顺序由图结构锁死,模型只负责画好每一格。

改造面(主文件 K2-角色设定-道劫.json;专家模式保持单链留档):
  · 四支子链 i=0..3:[400+i] 视角词 / [404+i] GroundedEncode(clip←[56],
    image←[123],prompt←[400+i],grounding_px=0) / [408+i] KSampler
    (model←[120],pos←[404+i],neg←[85],euler/simple×10,seed 2027+i*10)
    / [412+i] VAEDecode(vae←[57]) / [416+i] EmptySD3Latent 768×1024;
  · [307] image←[412] ,新增 image_b/c/d←[413]/[414]/[415],layout=四格拼版;
  · [29].images←[307] 不变;旧单链 [119]/[53]/[54]/[156]/[308] mute 留档
    ([85]/[90]/[164]/[120]/[123]/[55]/[56]/[57] 共享活);
  · 布局:四支横向分行(y=2000/2600/3200/3800,x 800-3000),横向铁律。
幂等:已存在 id 400=跳过。
用法:python3 apps/build/scripts/daojie_charsheet_compose_wireup_0920.py
"""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/2_图生图" \
         / "K2-角色设定-道劫.json"

VIEWS = [  # 单视角提示词(SV 服从度实弹口径同构)
    ("半身像", "Show the character in the image as a half-body portrait from "
               "the waist up, facing the viewer. Pure white background."),
    ("正面全身", "Show the character in the image in front full body view, "
                 "standing straight, facing the viewer, complete figure "
                 "visible. Pure white background."),
    ("侧面全身", "Show the character in the image in side full body view, "
                 "standing straight, facing left, complete figure visible. "
                 "Pure white background."),
    ("背面全身", "Show the character in the image in back full body view, "
                 "standing straight, seen from behind, complete figure "
                 "visible. Pure white background."),
]
GRID_LABELS = "半身像\n正面全身\n侧面全身\n背面全身"


def main() -> int:
    wf = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in wf["nodes"]}
    links = {l[0]: l for l in wf["links"]}
    if 400 in nodes:
        print("已是四支拼版态,跳过")
        return 0
    nid = max(links) + 1          # 新 link id 发号器

    def link(src, sslot, dst, dslot, ltype):
        """五元组登记:links 表+源侧 outputs(按 slot 归并)+目标侧 inputs[].link
        (首轮教训:漏目标侧登记=100 处断链)。"""
        nonlocal nid
        lid = nid; nid += 1
        wf["links"].append([lid, src, sslot, dst, dslot, ltype])
        outs = nodes[src].setdefault("outputs", [])
        for o in outs:
            if o.get("slot_index") == sslot:
                o.setdefault("links", []).append(lid)
                break
        else:
            outs.append({"name": ltype.lower(), "type": ltype,
                         "links": [lid], "slot_index": sslot})
        nodes[dst]["inputs"][dslot]["link"] = lid
        return lid

    order = max(n.get("order", 0) for n in wf["nodes"])
    for i, (label, prompt) in enumerate(VIEWS):
        y = 2000 + i * 600
        p, ge, ks, vd, lt = 400 + i, 404 + i, 408 + i, 412 + i, 416 + i
        nodes[p] = {"id": p, "type": "PrimitiveStringMultiline",
                    "pos": [800, y], "size": [340, 140], "flags": {}, "mode": 0,
                    "outputs": [{"name": "STRING", "type": "STRING", "links": [], "slot_index": 0}],
                    "title": f"视角·{label}", "order": order + 1,
                    "properties": {"Node name for S&R": "PrimitiveStringMultiline"},
                    "widgets_values": [prompt]}
        nodes[ge] = {"id": ge, "type": "Krea2EditGroundedEncode",
                     "pos": [1220, y], "size": [400, 200], "flags": {}, "mode": 0,
                     "inputs": [{"name": "clip", "type": "CLIP", "link": None},
                                {"name": "image", "type": "IMAGE", "link": None},
                                {"name": "image_b", "type": "IMAGE", "link": None},
                                {"name": "prompt", "type": "STRING", "link": None}],
                     "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING",
                                  "links": [], "slot_index": 0}],
                     "order": order + 2,
                     "properties": {"Node name for S&R": "Krea2EditGroundedEncode"},
                     "widgets_values": ["", 0, ""]}
        nodes[ks] = {"id": ks, "type": "KSampler",
                     "pos": [1700, y], "size": [320, 470], "flags": {}, "mode": 0,
                     "inputs": [{"name": "model", "type": "MODEL", "link": None},
                                {"name": "positive", "type": "CONDITIONING", "link": None},
                                {"name": "negative", "type": "CONDITIONING", "link": None},
                                {"name": "latent_image", "type": "LATENT", "link": None}],
                     "outputs": [{"name": "LATENT", "type": "LATENT", "links": [], "slot_index": 0}],
                     "order": order + 3,
                     "properties": {"Node name for S&R": "KSampler"},
                     "widgets_values": [2027 + i * 10, "fixed", 10, 1, "euler", "simple", 1],
                     "widgets_values_named": {"seed": 2027 + i * 10, "control_after_generate": "fixed",
                                              "steps": 10, "cfg": 1, "sampler_name": "euler",
                                              "scheduler": "simple", "denoise": 1}}
        nodes[vd] = {"id": vd, "type": "VAEDecode",
                     "pos": [2100, y], "size": [210, 60], "flags": {}, "mode": 0,
                     "inputs": [{"name": "samples", "type": "LATENT", "link": None},
                                {"name": "vae", "type": "VAE", "link": None}],
                     "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [], "slot_index": 0}],
                     "order": order + 4,
                     "properties": {"Node name for S&R": "VAEDecode"}, "widgets_values": []}
        nodes[lt] = {"id": lt, "type": "EmptySD3LatentImage",
                     "pos": [2400, y], "size": [270, 130], "flags": {}, "mode": 0,
                     "outputs": [{"name": "LATENT", "type": "LATENT", "links": [], "slot_index": 0}],
                     "order": order + 5,
                     "title": f"Latent·{label}",
                     "properties": {"Node name for S&R": "EmptySD3LatentImage"},
                     "widgets_values": [768, 1024, 1]}
        # 连线
        link(p, 0, ge, 3, "STRING")
        link(56, 0, ge, 0, "CLIP")
        link(123, 0, ge, 1, "IMAGE")
        link(ge, 0, ks, 1, "CONDITIONING")
        link(85, 0, ks, 2, "CONDITIONING")
        link(120, 0, ks, 0, "MODEL")
        link(lt, 0, ks, 3, "LATENT")
        link(ks, 0, vd, 0, "LATENT")
        link(57, 0, vd, 1, "VAE")
        wf["nodes"].extend([nodes[p], nodes[ge], nodes[ks], nodes[vd], nodes[lt]])
        print(f"  支{i+1} {label}: [400+i]链已建")

    # [307] 改四入+拼版模式
    n307 = nodes[307]
    n307["widgets_values"][7] = "四格拼版"
    n307["widgets_values"][8] = GRID_LABELS
    in307 = {ip["name"]: ip for ip in n307["inputs"]}
    for name, src in (("image", 412), ("image_b", 413),
                      ("image_c", 414), ("image_d", 415)):
        if name not in in307 and name != "image":
            n307["inputs"].append({"name": name, "type": "IMAGE", "link": None,
                                   "slot_index": len(n307["inputs"])})
    in307 = {ip["name"]: ip for ip in n307["inputs"]}
    # image 槽改接 [412](旧 [54] 线卸)
    old = in307["image"].get("link")
    if old in links:
        l = links[old]
        try:
            nodes[l[1]]["outputs"][0]["links"].remove(old)
        except (ValueError, KeyError, IndexError):
            pass
        wf["links"].remove(l)
    in307["image"]["link"] = link(412, 0, 307, 0, "IMAGE")
    for name, src in (("image_b", 413), ("image_c", 414), ("image_d", 415)):
        in307[name]["link"] = link(src, 0, 307, n307["inputs"].index(in307[name]), "IMAGE")
    # 旧单链 mute
    for nid_ in (119, 53, 54, 156, 308):
        if nid_ in nodes:
            nodes[nid_]["mode"] = 4
    print("  [307] 四入拼版;旧单链 [119]/[53]/[54]/[156]/[308] mute")

    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n",
                  encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
