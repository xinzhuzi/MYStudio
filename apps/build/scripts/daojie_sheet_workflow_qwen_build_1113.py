#!/usr/bin/env python3
"""daojie_sheet_workflow_qwen_build_1113.py — Qwen 版道劫-角色设定卡.json 生成器(1113)。

产出:apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/道劫-角色设定卡.json(幂等)。
与 MiniMax/H3-Image 孪生件同模式同底框;差异面:
  t2i(master/武器/特效)=TextEncodeQwenImage21+EmptyLatent+viggle turbo r256@1.0 8步;
  六路编辑=**multiref 真源路**(v2,1113 三弹定谳):参考图进 TE images.image_1 槽+
  提示词 <image1> 指代,base 模型直驱 25步/cfg1/dn1(qwen21-multiref-edit 在役件口径;
  dn0.6 编辑不生效/dn1.0 无图参考则身份画风塌,两败俱汰);
  提示词独立真源=qi21_bases.json#sheet_card_qwen(v2)。
生成器骨架(画布建造器 G/结构自检 check)整图复用 daojie_sheet_workflow_build_1113.py。
用法:python3 daojie_sheet_workflow_qwen_build_1113.py [--check]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
from daojie_sheet_workflow_build_1113 import (  # noqa: E402
    G, check, NAME_DEFAULT, SUBJECT_DEFAULT)

REPO = _HERE.parents[2]
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
OUT = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/道劫-角色设定卡.json"

NOTE = """## 道劫·角色设定卡(QwenImage 2.1 版,1113)

- **孪生件**:与 `1_图片/MiniMax/道劫-角色设定卡.json`(H3-Image)同模式同底框——
  MySheetCardComposer 格式一 v1(程序绘框线/16 角标/右上角名,零缺笔零印章)
- **模型四件**(qi21 产线现行):bf16 UNET+heretic TE+texture_fix VAE(KJ,cpu/fp32)
  +viggle turbo r256@1.0;t2i=Turbo 8步/cfg1
- **六路编辑=multiref 路(v2)**:参考图进 TE `images.image_1` 槽+提示词 `<image1>`
  指代;base 直驱 25步/cfg1/dn1(qwen21-multiref-edit 在役件口径;经典 img2img 两败
  教训=dn0.6 编辑不生效/dn1.0 无图参考身份画风塌);head 吃侧视图,余吃 master
- **提示词独立真源**:qi21_bases.json#sheet_card_qwen(v2,单独成套);master 三层装配
  带负面词;换角色=改 master 首段主体句+角名+武器/特效句首名号
- **批量/断点续跑**:python3 apps/build/scripts/daojie_sheet_b_pipeline.py --engine qwen"""


def _prompts():
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    q = bases["sheet_card_qwen"]
    assert q["format_version"] == "v2" and q["engine"] == "qwen-image-2.1"
    style = bases["art_style_base"]["positive_text"]
    style_neg = bases["art_style_base"].get("negative_text", "")
    weapon_field = next(p.split(":", 1)[1] for p in SUBJECT_DEFAULT.split("|")
                        if p.startswith("武器:"))
    ability_field = next(p.split(":", 1)[1] for p in SUBJECT_DEFAULT.split("|")
                         if p.startswith("能力:"))
    return {
        "master": ("\n".join([SUBJECT_DEFAULT, q["master"]["positive_text"], style]),
                   ",".join([p for p in (style_neg, q["master"]["negative_text"]) if p])),
        "instr": q["edit_instructions"],
        "edit_neg": ",".join([p for p in (style_neg, q["edit_negative"]) if p]),
        "weapon": ("\n".join([q["weapon"]["positive_template"].format(
                                name=NAME_DEFAULT, weapon=weapon_field), style]),
                   ",".join([p for p in (style_neg, q["weapon"]["negative_text"]) if p])),
        "effect": ("\n".join([q["effect"]["positive_template"].format(
                                 ability=ability_field), style]),
                   ",".join([p for p in (style_neg, q["effect"]["negative_text"]) if p])),
        "q": q,
    }


def build_doc():
    p = _prompts()
    q = p["q"]
    models, smp = q["models"], q["sampler"]
    g = G()

    def node_by(nid):
        return next(x for x in g.nodes if x["id"] == nid)

    def set_in(nid, slot, link):
        node_by(nid)["inputs"][slot]["link"] = link

    def add_out(nid, slot, link):
        node_by(nid)["outputs"][slot]["links"].append(link)

    def wire(src, ss, dst, ds, ty):
        lk = g.link(src, ss, dst, ds, ty)
        add_out(src, ss, lk)
        set_in(dst, ds, lk)

    # ① 装载四件
    g.node(1, "UNETLoader", [0, 0], [340, 100],
           [models["unet"], "default"],
           {"unet_name": models["unet"], "weight_dtype": "default"},
           outputs=[("MODEL", "MODEL", [])])
    g.node(2, "CLIPLoader", [0, 180], [340, 130],
           [models["clip"], "qwen_image", "default"],
           {"clip_name": models["clip"], "type": "qwen_image", "device": "default"},
           outputs=[("CLIP", "CLIP", [])])
    g.node(3, "VAELoaderKJ", [0, 360], [340, 150],
           [models["vae"], "cpu", "fp32"],
           {"vae_name": models["vae"], "device": "cpu", "weight_dtype": "fp32"},
           outputs=[("VAE", "VAE", [])])
    g.node(4, "LoraLoaderModelOnly", [0, 560], [340, 130],
           [models["lora"], models["lora_strength"]],
           {"lora_name": models["lora"], "strength_model": models["lora_strength"]},
           inputs=[("model", "MODEL", None)],
           outputs=[("MODEL", "MODEL", [])])
    wire(1, 0, 4, 0, "MODEL")

    def t2i_chain(nid, y, prompt, neg, w, h, seed):
        """Qwen t2i 段:TE+EmptyLatent+KSampler(turbo 模型链)+Decode。"""
        te, lat, s, dec = nid, nid + 1, nid + 2, nid + 3
        t = smp["t2i"]
        g.node(te, "TextEncodeQwenImage21", [700, y], [460, 320],
               [prompt, neg, t["resolution"]],
               {"prompt": prompt, "negative_prompt": neg,
                "resolution": t["resolution"]},
               inputs=[("clip", "CLIP", None)],
               outputs=[("positive", "CONDITIONING", []),
                        ("negative", "CONDITIONING", [])])
        g.node(lat, "EmptyLatentImage", [1210, y], [300, 120],
               [w, h, 1], {"width": w, "height": h, "batch_size": 1},
               outputs=[("LATENT", "LATENT", [])])
        g.node(s, "KSampler", [1570, y], [340, 280],
               [seed, "fixed", t["steps"], t["cfg"], t["sampler_name"],
                t["scheduler"], t["denoise"]],
               {"seed": seed, "control_after_generate": "fixed",
                "steps": t["steps"], "cfg": t["cfg"],
                "sampler_name": t["sampler_name"], "scheduler": t["scheduler"],
                "denoise": t["denoise"]},
               inputs=[("model", "MODEL", None), ("positive", "CONDITIONING", None),
                       ("negative", "CONDITIONING", None), ("latent_image", "LATENT", None)],
               outputs=[("LATENT", "LATENT", [])])
        g.node(dec, "VAEDecode", [1970, y], [300, 110],
               inputs=[("samples", "LATENT", None), ("vae", "VAE", None)],
               outputs=[("IMAGE", "IMAGE", [])])
        wire(2, 0, te, 0, "CLIP")
        wire(4, 0, s, 0, "MODEL")
        wire(te, 0, s, 1, "CONDITIONING")
        wire(te, 1, s, 2, "CONDITIONING")
        wire(lat, 0, s, 3, "LATENT")
        wire(s, 0, dec, 0, "LATENT")
        wire(3, 0, dec, 1, "VAE")
        return te, lat, s, dec

    def edit_chain(nid, y, instr, seed, image_src):
        """Qwen 编辑段 v2(multiref):TE 参考图槽+EmptyLatent+KSampler(base 直驱)+Decode。"""
        te, lat, s, dec = nid, nid + 1, nid + 2, nid + 3
        e = smp["edit"]
        g.node(te, "TextEncodeQwenImage21", [700, y], [460, 320],
               [instr, p["edit_neg"], 0],
               {"prompt": instr, "negative_prompt": p["edit_neg"], "resolution": 0},
               inputs=[("clip", "CLIP", None), ("images.image_1", "IMAGE", None),
                       ("vae", "VAE", None)],
               outputs=[("positive", "CONDITIONING", []),
                        ("negative", "CONDITIONING", [])])
        g.node(lat, "EmptyLatentImage", [1210, y], [300, 120],
               [e["width"], e["height"], 1],
               {"width": e["width"], "height": e["height"], "batch_size": 1},
               outputs=[("LATENT", "LATENT", [])])
        g.node(s, "KSampler", [1570, y], [340, 280],
               [seed, "fixed", e["steps"], e["cfg"], e["sampler_name"],
                e["scheduler"], e["denoise"]],
               {"seed": seed, "control_after_generate": "fixed",
                "steps": e["steps"], "cfg": e["cfg"],
                "sampler_name": e["sampler_name"], "scheduler": e["scheduler"],
                "denoise": e["denoise"]},
               inputs=[("model", "MODEL", None), ("positive", "CONDITIONING", None),
                       ("negative", "CONDITIONING", None), ("latent_image", "LATENT", None)],
               outputs=[("LATENT", "LATENT", [])])
        g.node(dec, "VAEDecode", [1970, y], [300, 110],
               inputs=[("samples", "LATENT", None), ("vae", "VAE", None)],
               outputs=[("IMAGE", "IMAGE", [])])
        wire(2, 0, te, 0, "CLIP")
        wire(image_src, 0, te, 1, "IMAGE")   # 参考图槽
        wire(3, 0, te, 2, "VAE")
        wire(1, 0, s, 0, "MODEL")            # v2 编辑=base 直驱,无 turbo
        wire(te, 0, s, 1, "CONDITIONING")
        wire(te, 1, s, 2, "CONDITIONING")
        wire(lat, 0, s, 3, "LATENT")
        wire(s, 0, dec, 0, "LATENT")
        wire(3, 0, dec, 1, "VAE")
        return te, lat, s, dec

    seeds = q["seeds"]
    m = t2i_chain(5, 0, p["master"][0], p["master"][1],
                  q["master"]["width"], q["master"]["height"], seeds["master"])
    edits = {}
    for i, tag in enumerate(("side", "back", "face", "wrist", "waist", "head")):
        nid = 10 + i * 5
        y = 420 + i * 420
        edits[tag] = edit_chain(nid, y, p["instr"][tag], seeds[tag], image_src=8)
    wp = t2i_chain(40, 2940, p["weapon"][0], p["weapon"][1],
                   q["weapon"]["width"], q["weapon"]["height"], seeds["weapon"])
    fx = t2i_chain(45, 3360, p["effect"][0], p["effect"][1],
                   q["effect"]["width"], q["effect"]["height"], seeds["effect"])

    # head 编辑参考图改吃侧视图(13=side decode)
    head_te = node_by(edits["head"][0])
    old_lk = head_te["inputs"][1]["link"]
    old_entry = next(l for l in g.links if l[0] == old_lk)
    old_src = node_by(old_entry[1])
    g.links = [l for l in g.links if l[0] != old_lk]
    old_src["outputs"][old_entry[2]]["links"].remove(old_lk)
    wire(edits["side"][3], 0, head_te["id"], 1, "IMAGE")

    # ⑤ 合成+存图
    src_ids = [8, edits["side"][3], edits["back"][3], edits["face"][3],
               edits["head"][3], edits["wrist"][3], edits["waist"][3],
               wp[3], fx[3]]
    comp_inputs = [(k, "IMAGE", None) for k in
                   ("master", "side", "back", "face", "head",
                    "wrist", "waist", "weapon", "effect")]
    g.node(50, "MySheetCardComposer", [2560, 1260], [420, 560],
           [NAME_DEFAULT], {"角名": NAME_DEFAULT}, inputs=comp_inputs,
           outputs=[("设定卡", "IMAGE", [])])
    for slot, s in enumerate(src_ids):
        li = g.link(s, 0, 50, slot, "IMAGE")
        node_by(s)["outputs"][0]["links"].append(li)
        g.nodes[-1]["inputs"][slot]["link"] = li
    g.node(51, "SaveImage", [3060, 1440], [340, 110], ["道劫设定卡Q/"],
           {"filename_prefix": "道劫设定卡Q/"},
           inputs=[("images", "IMAGE", None)], outputs=[])
    wire(50, 0, 51, 0, "IMAGE")

    g.node(52, "MarkdownNote", [0, 3820], [560, 640], [NOTE])

    g.group("① 装载四件+turbo r256(bf16/heretic/texture_fix)", [-40, -60, 760, 760])
    g.group("② master·正视图源(三层装配)", [640, -60, 1720, 300])
    g.group("③ 六路编辑(multiref:TE 参考图槽;head 吃侧视图)", [640, 360, 1720, 2450])
    g.group("④ 武器/特效 t2i(Turbo 8步)", [640, 2880, 1720, 900], "#88A")
    g.group("⑤ 固定底框合成(格式一 v1,与 H3 孪生同框)", [2480, 1180, 1100, 660], "#3A3")
    return g.build()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    doc = build_doc()
    check(doc)
    if args.check:
        if OUT.is_file():
            check(json.loads(OUT.read_text(encoding="utf-8")))
            print("[CHECK] 既有件复验过")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    if OUT.is_file() and OUT.read_text(encoding="utf-8") == text:
        print("[SKIP] 逐字节一致,零改动")
        return 0
    OUT.write_text(text, encoding="utf-8")
    check(json.loads(OUT.read_text(encoding="utf-8")))
    print(f"[OK] {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
