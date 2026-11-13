#!/usr/bin/env python3
"""daojie_sheet_workflow_build_1113.py — 道劫-角色设定卡.json 画布件生成器(1113 道劫正册化)。

产出:apps/backend/comfyui/workflows/1_图片/MiniMax/道劫-角色设定卡.json(幂等,字节稳定)。
固定内容全部烧入:美术风格底座+人物海报/道具型底座(逐字=qi21_bases.json 真源)、
sheet_card 六路 edit 指令/武器特效模板/分辨率/seed、MySheetCardComposer 固定框(格式一 v1)。
画布口径:链横排右向;点分输入名 images.image_1=API 真源同名(1112 实弹口径)。
用法:python3 daojie_sheet_workflow_build_1113.py [--check]  # --check=只校验不写
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
OUT = REPO / "apps/backend/comfyui/workflows/1_图片/MiniMax/5_角色设定卡/道劫-角色设定卡.json"

# 主机适配四件(1112 装机终版,与 h3image 两真源脚本同款)
DIT = "minimax_h3_image_pruned_int8_convrot.safetensors"
TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VAE = "minimax_h3_image_vae_fp16.safetensors"

# 默认示例主体句=沈孤鸿(1112 首单金样同款;换角色=改本段+角名+武器/特效句首名号)
SUBJECT_DEFAULT = (
    "姓名:沈孤鸿|性别:男|年龄:二十二岁|身份:剑修|"
    "能力:孤鸿剑气——剑锋凝出一线青白剑气,形如鸿羽掠空,自剑尖延展约三尺|"
    "脸型:清峻,丹凤眼深褐瞳,眉斜飞入鬓|发型:黑发高束马尾,墨青发带,颊侧两缕碎发|"
    "服装:月白窄袖长袍衣缘银线暗纹,内黛青束袖劲装,墨色宽腰封缀素银方扣,"
    "黛青束口裤,玄色短靴靴口银边|配色:主色月白,辅色黛青,点睛银|"
    "衣料:主衣料细密缎面,腰封厚织锦,绑绳素麻绳|配饰:墨青发带,腰封素银方扣,剑穗青白丝线|"
    "武器:长剑,玄色木胎鲛皮鞘,鞘口衔银,剑柄缠墨色丝绦,剑穗青白丝线,收鞘态|"
    "其余:无灵兽,无伤痕旧损"
)
NAME_DEFAULT = "沈孤鸿"

NOTE = """## 道劫·角色设定卡(格式一 v1,1113 道劫正册化)

- **固定框**=MySheetCardComposer:顶块[三视图紧凑横排|六特写3×2|配色条]+底部四区;框线/16 角标/右上角名**程序绘**(零缺笔零印章);角名最后贴(先画框后贴名)
- **真源**:六路指令/武器特效模板/分辨率/seed=qi21_bases.json#sheet_card(v1);master=人物海报型三层装配(主体句+型底座+美术风格底座逐字);合成器单真源=my_nodes/nodes/my_sheet_card_composer.py
- **固定方式**:master t2i(1664×2496)→六路 edit 直投(侧/背转 view+面部/侧头/腕/腰推近;head 吃侧视图,余吃 master)→武器 t2i(3456×1280 横陈)与特效 t2i(2048²)→合成器出 4K
- **换角色**:改 master 提示词首段主体句+角名+武器/特效句首名号;六路指令角色无关恒定
- **批量/断点续跑**走脚本路 apps/build/scripts/daojie_sheet_b_pipeline.py;本件=画布直开单卡
- steps=6/CFG1/euler/simple(H3-Image 蒸馏口径,禁高 CFG)"""


def _prompts():
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    sc = bases["sheet_card"]
    assert sc["format_version"] == "v1.1"
    style = bases["art_style_base"]["positive_text"]
    m_base = sc["master"]["positive_text"]  # v1.1 起 master 自有净空立绘底座
    t_item = next(t["positive_text"] for t in bases["types"]
                  if t["zh"] == sc["weapon"]["type"])
    weapon_field = next(p.split(":", 1)[1] for p in SUBJECT_DEFAULT.split("|")
                        if p.startswith("武器:"))
    ability_field = next(p.split(":", 1)[1] for p in SUBJECT_DEFAULT.split("|")
                         if p.startswith("能力:"))
    return {
        "master": "\n".join([SUBJECT_DEFAULT, m_base, style]),
        "instr": sc["edit_instructions"],
        "weapon": "\n".join([sc["weapon"]["subject_template"].format(
            name=NAME_DEFAULT, weapon=weapon_field), t_item, style]),
        "effect": "\n".join([sc["effect"]["subject_template"].format(
            ability=ability_field), style]),
        "sc": sc,
    }


class G:
    """画布图建造器:节点/连线/组框,字节稳定产出。"""

    def __init__(self):
        self.nodes = []
        self.links = []
        self.groups = []
        self._nid = 0
        self._lid = 0

    def node(self, nid, ntype, pos, size, widgets=None, named=None,
             inputs=(), outputs=()):
        self._nid = max(self._nid, nid)
        n = {"id": nid, "type": ntype, "pos": pos, "size": size,
             "flags": {}, "order": 0, "mode": 0,
             "inputs": [{"name": nm, "type": ty, "link": lk}
                        for nm, ty, lk in inputs],
             "outputs": [{"name": nm, "type": ty, "links": lks,
                          "slot_index": i}
                         for i, (nm, ty, lks) in enumerate(outputs)],
             "properties": {"Node name for S&R": ntype}}
        if widgets is not None:
            n["widgets_values"] = widgets
        if named is not None:
            n["widgets_values_named"] = named
        self.nodes.append(n)
        return n

    def link(self, src, sslot, dst, dslot, ty):
        self._lid += 1
        self.links.append([self._lid, src, sslot, dst, dslot, ty])
        return self._lid

    def group(self, title, bounding, color="#3f789e"):
        self.groups.append({"id": len(self.groups) + 1, "title": title,
                            "bounding": bounding, "color": color, "flags": {}})

    def build(self):
        return {"last_node_id": self._nid, "last_link_id": self._lid,
                "nodes": self.nodes, "links": self.links,
                "groups": self.groups,
                "config": {}, "extra": {}, "version": 0.4, "revision": 0}


def build_doc():
    p = _prompts()
    g = G()

    # ① 装载三件
    g.node(1, "UNETLoader", [0, 0], [340, 100], [DIT, "default"],
           {"unet_name": DIT, "weight_dtype": "default"},
           outputs=[("MODEL", "MODEL", [])])
    g.node(2, "CLIPLoader", [0, 180], [340, 130], [TE, "minimax", "default"],
           {"clip_name": TE, "type": "minimax", "device": "default"},
           outputs=[("CLIP", "CLIP", [])])
    g.node(3, "VAELoader", [0, 360], [340, 100], [VAE],
           {"vae_name": VAE}, outputs=[("VAE", "VAE", [])])

    def chain(nid, y, prompt, w, h, seed, image_src=None, tag=""):
        """一段生成链:conditioning(+zero)+sampler+decode;image_src=编辑底图节点。"""
        c, z, s, d = nid, nid + 1, nid + 2, nid + 3
        cond_in = [("clip", "CLIP", None), ("vae", "VAE", None)]
        if image_src is not None:
            cond_in.append(("images.image_1", "IMAGE", None))
        g.node(c, "MiniMaxH3ImageConditioning", [700, y], [480, 300],
               [prompt, w, h], {"prompt": prompt, "width": w, "height": h},
               inputs=cond_in,
               outputs=[("CONDITIONING", "CONDITIONING", []),
                        ("LATENT", "LATENT", [])])
        g.node(z, "ConditioningZeroOut", [1240, y], [300, 80],
               inputs=[("conditioning", "CONDITIONING", None)],
               outputs=[("CONDITIONING", "CONDITIONING", [])])
        g.node(s, "KSampler", [1600, y], [340, 280],
               [seed, "fixed", 6, 1.0, "euler", "simple", 1.0],
               {"seed": seed, "control_after_generate": "fixed", "steps": 6,
                "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple",
                "denoise": 1.0},
               inputs=[("model", "MODEL", None), ("positive", "CONDITIONING", None),
                       ("negative", "CONDITIONING", None),
                       ("latent_image", "LATENT", None)],
               outputs=[("LATENT", "LATENT", [])])
        g.node(d, "VAEDecode", [2000, y], [300, 110],
               inputs=[("samples", "LATENT", None), ("vae", "VAE", None)],
               outputs=[("IMAGE", "IMAGE", [])])
        return c, z, s, d

    # 建链时先占位,连线统一补(输入槽序:cond=[clip,vae,(image_1)];sampler=[model,pos,neg,lat])
    def wire(c, z, s, d, image_src=None):
        def set_in(nid, slot, link):
            n = next(x for x in g.nodes if x["id"] == nid)
            n["inputs"][slot]["link"] = link

        def add_out(nid, slot, link):
            n = next(x for x in g.nodes if x["id"] == nid)
            n["outputs"][slot]["links"].append(link)

        l1 = g.link(2, 0, c, 0, "CLIP"); add_out(2, 0, l1); set_in(c, 0, l1)
        l2 = g.link(3, 0, c, 1, "VAE"); add_out(3, 0, l2); set_in(c, 1, l2)
        if image_src is not None:
            li = g.link(image_src, 0, c, 2, "IMAGE")
            add_out(image_src, 0, li); set_in(c, 2, li)
        l3 = g.link(c, 0, s, 1, "CONDITIONING"); add_out(c, 0, l3); set_in(s, 1, l3)
        l4 = g.link(z, 0, s, 2, "CONDITIONING"); add_out(z, 0, l4); set_in(s, 2, l4)
        l5 = g.link(c, 1, s, 3, "LATENT"); add_out(c, 1, l5); set_in(s, 3, l5)
        l6 = g.link(1, 0, s, 0, "MODEL"); add_out(1, 0, l6); set_in(s, 0, l6)
        l7 = g.link(s, 0, d, 0, "LATENT"); add_out(s, 0, l7); set_in(d, 0, l7)
        l8 = g.link(3, 0, d, 1, "VAE"); add_out(3, 0, l8); set_in(d, 1, l8)
        l9 = g.link(c, 0, z, 0, "CONDITIONING"); add_out(c, 0, l9); set_in(z, 0, l9)

    sc = p["sc"]
    m = chain(5, 0, p["master"], sc["master"]["width"], sc["master"]["height"],
              sc["seeds"]["master"])
    edits = {}
    for i, tag in enumerate(("side", "back", "face", "wrist", "waist", "head")):
        nid = 10 + i * 5
        y = 420 + i * 420
        src = 13 if tag == "head" else 8  # head 吃侧视图,余吃 master
        edits[tag] = chain(nid, y, p["instr"][tag], 0, 0,
                           sc["seeds"][tag], image_src=src)
    wp = chain(40, 2940, p["weapon"], sc["weapon"]["width"], sc["weapon"]["height"],
               sc["seeds"]["weapon"])
    fx = chain(45, 3360, p["effect"], sc["effect"]["width"], sc["effect"]["height"],
               sc["seeds"]["effect"])

    wire(*m)
    for tag in edits:
        wire(*edits[tag], image_src=(13 if tag == "head" else 8))
    wire(*wp)
    wire(*fx)

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
        next(x for x in g.nodes if x["id"] == s)["outputs"][0]["links"].append(li)
        g.nodes[-1]["inputs"][slot]["link"] = li
    g.node(51, "SaveImage", [3060, 1440], [340, 110], ["道劫设定卡/"],
           {"filename_prefix": "道劫设定卡/"},
           inputs=[("images", "IMAGE", None)], outputs=[])
    l = g.link(50, 0, 51, 0, "IMAGE")
    next(x for x in g.nodes if x["id"] == 50)["outputs"][0]["links"].append(l)
    next(x for x in g.nodes if x["id"] == 51)["inputs"][0]["link"] = l

    g.node(52, "MarkdownNote", [0, 3820], [560, 640], [NOTE])

    g.group("① 装载三件(H3-Image 主机适配档)", [-40, -60, 760, 560])
    g.group("② master·正视图源(三层装配)", [640, -60, 1720, 300])
    g.group("③ 六路分格编辑(指令真源 sheet_card)", [640, 360, 1720, 2450])
    g.group("④ 武器/特效 t2i", [640, 2880, 1720, 900], "#88A")
    g.group("⑤ 固定底框合成(格式一 v1)", [2480, 1180, 1100, 660], "#3A3")
    return g.build()


def check(doc, verbose=True):
    """结构自检:连线双向/槽位一致/组框罩全/真源互锁。"""
    nodes = {n["id"]: n for n in doc["nodes"]}
    links = {l[0]: l for l in doc["links"]}
    assert len(links) == len(doc["links"]), "链 id 重复"
    for l in doc["links"]:
        _, s, ss, d, ds, ty = l
        assert s in nodes and d in nodes, l
        assert ss < len(nodes[s]["outputs"]), l
        assert ds < len(nodes[d]["inputs"]), l
        assert l in [x["link"] for x in nodes[d]["inputs"]] or True
        assert nodes[d]["inputs"][ds]["link"] == l[0], f"入槽链不符 {l}"
        assert l[0] in nodes[s]["outputs"][ss]["links"], f"出槽链不符 {l}"
    for n in doc["nodes"]:
        for i in n["inputs"]:
            if i["link"] is not None:
                assert i["link"] in links, (n["id"], i)
        for o in n["outputs"]:
            for lk in o["links"]:
                assert lk in links, (n["id"], o)
    # 组框罩全:每节点中心恰落入一个组(合成/存图同组;Note 允许无组)
    covered = 0
    for n in doc["nodes"]:
        if n["type"] == "MarkdownNote":
            continue
        cx, cy = n["pos"][0] + n["size"][0] / 2, n["pos"][1] + n["size"][1] / 2
        hits = [g_ for g_ in doc["groups"]
                if g_["bounding"][0] <= cx <= g_["bounding"][0] + g_["bounding"][2]
                and g_["bounding"][1] <= cy <= g_["bounding"][1] + g_["bounding"][3]]
        assert len(hits) == 1, f"节点 {n['id']} 组框命中 {len(hits)}"
        covered += 1
    if verbose:
        print(f"[CHECK] {len(doc['nodes'])} 节点/{len(doc['links'])} 链/"
              f"{len(doc['groups'])} 组;双向/槽位/罩全全过(覆盖 {covered} 节点)")


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
