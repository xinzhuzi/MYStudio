#!/usr/bin/env python3
"""daojie_sheet_workflow_qwen_build_1113.py — Qwen 版道劫-角色设定卡 双件生成器(1113)。

产出(幂等,字节稳定):
  .../QwenImage2.1/5_角色设定卡/道劫-角色设定卡-t2i.json  —— master 文生图链
  .../QwenImage2.1/5_角色设定卡/道劫-角色设定卡-i2i.json  —— master 图生图链(LoadImage→multiref)
与 MiniMax/H3-Image 孪生件同模式同底框;两件共用 MySheetPromptHub(提示词单点
固化+背景类型唯一旋钮)与六路 multiref 编辑(25步 base 直驱)+MySheetCardComposer
(格式注册表+背景类型联动,背景输入由枢纽同源直连=永不脱钩)。
提示词独立真源=qi21_bases.json#sheet_card_qwen(v4:{背景} 占位+backgrounds 表)。
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
OUT_DIR = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/5_角色设定卡"
OUTS = {"t2i": OUT_DIR / "道劫-角色设定卡-t2i.json",
        "i2i": OUT_DIR / "道劫-角色设定卡-i2i.json"}

NOTE = """# 道劫·角色设定卡(QwenImage 2.1 版)

## 这是什么
从一段主体句文本(或一张参考图)生成 3840×2160 4K 水墨国风角色设定卡:
三视图(正/侧/背)+六格特写+配色五圆+武器/服饰/装备/能力四区,全部程序合成
固定底框(零缺笔零印章)。

## 输入
- **主体句**(枢纽节点):竖线字段式「姓名:X|性别:男|服装:...|武器:...」
- **角名**(枢纽节点):角色名,程序绘到卡片右上角
- **背景类型**(枢纽节点):纯白单档(1114 用户令背景收敛)——同时控制提示词与画布底色

## 输出
- 4K PNG 设定卡(3840×2160, RGB 无 alpha)

## 设计思路
- **框与字归程序,画归模型**:底框/格线/16 角标/角名由 MySheetCardComposer 程序
  绘制(结构性保证零缺笔零印章);格内画面由 QwenImage 分格生成
- **提示词单点**:MySheetPromptHub 是画布唯一的提示词入口,运行时热读
  qi21_bases.json 真源装配三层提示词,15 路输出链接分发到各 TextEncode
- **背景类型联动**:枢纽旋钮→提示词占位填充→同型直连合成器→画布底色同型渲染
- **档案行**(v6,Skill-5.4 §十 标配信息栏):枢纽从主体句解析 姓名/性别/年龄/
  身份/武器/技能 六短字段→直连合成器→底部通栏信息带程序绘(档案左+配色方案右)
- **设计说明行**(Skill-5.4 §十④):主体句「设计说明:」字段→底带第二行程序绘
- **表情参考行**(Skill-5.4 §六):面部图 multiref 编辑×5(开心/生气/悲伤/惊讶/
  害羞,肌群定义逐字取 §六表)→通栏表情条;缺步回退面部中性不断链
- **master 一源**:三视图+六特写全部从 master 正视图派生(multiref 编辑)

## 双件说明
- **-t2i**:master=文生图(三层装配:主体句+净空立绘底座+美术风格底座)
- **-i2i**:master=图生图(LoadImage 喂已有角色图→multiref 正面全身立绘)

## 注意
- 模型=bf16 UNET+heretic TE+texture_fix VAE(KJ,cpu/fp32)+viggle turbo r256
- t2i=Turbo 8步;编辑=multiref base 25步
- VAE 恒 cpu/fp32(回 GPU 会崩引擎)
- 合成器格式=全卡/简版/竖版/无武器(四选一)

## 批量使用
```bash
python3 apps/build/scripts/daojie_sheet_b_pipeline.py --engine qwen \
    --subject 主体句文件.txt --name 角色名
```"""


def _prompts():
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    q = bases["sheet_card_qwen"]
    assert q["format_version"] == "v6" and q["engine"] == "qwen-image-2.1"
    style = bases["art_style_base"]["positive_text"]
    style_neg = bases["art_style_base"].get("negative_text", "")
    bgp = q["backgrounds"]["纯白"]["phrase"]  # 画布件烧默认型(旋钮在枢纽)
    fill = lambda s: s.replace("{背景}", bgp)  # noqa: E731
    weapon_field = next(p.split(":", 1)[1] for p in SUBJECT_DEFAULT.split("|")
                        if p.startswith("武器:"))
    ability_field = next(p.split(":", 1)[1] for p in SUBJECT_DEFAULT.split("|")
                         if p.startswith("能力:"))
    t_item = next(t["positive_text"] for t in bases["types"]
                  if t["zh"] == q["weapon"].get("type", "道具"))
    return {
        "master": ("\n".join([SUBJECT_DEFAULT, fill(q["master"]["positive_text"]),
                              style]),
                   ",".join([p for p in (style_neg, q["master"]["negative_text"]) if p])),
        "instr": {k: fill(v) for k, v in q["edit_instructions"].items()},
        "edit_neg": ",".join([p for p in (style_neg, q["edit_negative"]) if p]),
        "weapon": ("\n".join([q["weapon"]["positive_template"].format(
                                name=NAME_DEFAULT, weapon=weapon_field),
                              t_item, style]),
                   ",".join([p for p in (style_neg, q["weapon"]["negative_text"]) if p])),
        "effect": ("\n".join([q["effect"]["positive_template"].format(
                                 ability=ability_field), style]),
                   ",".join([p for p in (style_neg, q["effect"]["negative_text"]) if p])),
        "q": q,
    }


HUB = {"master": 0, "master_i2i": 1, "weapon": 2, "effect": 3,
       "side": 4, "back": 5, "face": 6, "head": 7, "wrist": 8, "waist": 9,
       "exp_happy": 10, "exp_angry": 11, "exp_sad": 12,
       "exp_surprise": 13, "exp_shy": 14,
       "neg_gen": 15, "neg_edit": 16, "bg": 17, "fmt": 18, "arch": 19}


def build_doc(variant: str = "t2i"):
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
        return lk

    def unwire(dst, ds):
        n = node_by(dst)
        old = n["inputs"][ds]["link"]
        if old is None:
            return
        entry = next(l for l in g.links if l[0] == old)
        node_by(entry[1])["outputs"][entry[2]]["links"].remove(old)
        g.links = [l for l in g.links if l[0] != old]
        n["inputs"][ds]["link"] = None

    # ① 装载四件
    g.node(1, "UNETLoader", [540, 0], [340, 100],
           [models["unet"], "default"],
           {"unet_name": models["unet"], "weight_dtype": "default"},
           outputs=[("MODEL", "MODEL", [])])
    g.node(2, "CLIPLoader", [540, 180], [340, 130],
           [models["clip"], "qwen_image", "default"],
           {"clip_name": models["clip"], "type": "qwen_image", "device": "default"},
           outputs=[("CLIP", "CLIP", [])])
    g.node(3, "VAELoaderKJ", [540, 360], [340, 150],
           [models["vae"], "cpu", "fp32"],
           {"vae_name": models["vae"], "device": "cpu", "weight_dtype": "fp32"},
           outputs=[("VAE", "VAE", [])])
    g.node(4, "LoraLoaderModelOnly", [540, 560], [340, 130],
           [models["lora"], models["lora_strength"]],
           {"lora_name": models["lora"], "strength_model": models["lora_strength"]},
           inputs=[("model", "MODEL", None)],
           outputs=[("MODEL", "MODEL", [])])
    wire(1, 0, 4, 0, "MODEL")

    # ⑥ 提示词枢纽(单点固化+背景唯一旋钮;真源 v4)
    hub_outs = [("正向·master", "STRING", []), ("指令·master图生图", "STRING", []),
                ("正向·武器", "STRING", []), ("正向·特效", "STRING", []),
                ("指令·侧视图", "STRING", []), ("指令·背视图", "STRING", []),
                ("指令·面部", "STRING", []), ("指令·头部", "STRING", []),
                ("指令·腕部", "STRING", []), ("指令·腰部", "STRING", []),
                ("指令·开心", "STRING", []), ("指令·生气", "STRING", []),
                ("指令·悲伤", "STRING", []), ("指令·惊讶", "STRING", []),
                ("指令·害羞", "STRING", []),
                ("负面·生成", "STRING", []), ("负面·编辑", "STRING", []),
                ("背景类型", "STRING", []), ("格式", "STRING", []),
                ("档案", "STRING", [])]
    g.node(60, "MySheetPromptHub", [0, 100], [420, 820],
           [SUBJECT_DEFAULT, NAME_DEFAULT, "纯白", "全卡"],
           {"主体句": SUBJECT_DEFAULT, "角名": NAME_DEFAULT,
            "背景类型": "纯白", "格式": "全卡"},
           outputs=hub_outs)

    def te_node(nid, y, prompt, neg, hub_key, is_edit):
        """TE:prompt/negative 全由枢纽链接喂入(散装提示词退役;widget 留兜底值)。"""
        ins = [("clip", "CLIP", None), ("prompt", "STRING", None),
               ("negative_prompt", "STRING", None)]
        if is_edit:
            ins += [("images.image_1", "IMAGE", None), ("vae", "VAE", None)]
        res = smp["t2i"]["resolution"] if not is_edit else 0
        g.node(nid, "TextEncodeQwenImage21", [1260, y], [460, 320],
               [prompt, neg, res],
               {"prompt": prompt, "negative_prompt": neg, "resolution": res},
               inputs=ins,
               outputs=[("positive", "CONDITIONING", []),
                        ("negative", "CONDITIONING", [])])
        wire(2, 0, nid, 0, "CLIP")
        wire(60, HUB[hub_key], nid, 1, "STRING")
        wire(60, HUB["neg_edit"] if is_edit else HUB["neg_gen"], nid, 2, "STRING")
        return nid

    def t2i_chain(nid, y, prompt, neg, w, h, seed, hub_key):
        te, lat, s, dec = nid, nid + 1, nid + 2, nid + 3
        te_node(te, y, prompt, neg, hub_key, is_edit=False)
        t = smp["t2i"]
        g.node(lat, "EmptyLatentImage", [1770, y], [300, 120],
               [w, h, 1], {"width": w, "height": h, "batch_size": 1},
               outputs=[("LATENT", "LATENT", [])])
        g.node(s, "KSampler", [2130, y], [340, 280],
               [seed, "fixed", t["steps"], t["cfg"], t["sampler_name"],
                t["scheduler"], t["denoise"]],
               {"seed": seed, "control_after_generate": "fixed",
                "steps": t["steps"], "cfg": t["cfg"],
                "sampler_name": t["sampler_name"], "scheduler": t["scheduler"],
                "denoise": t["denoise"]},
               inputs=[("model", "MODEL", None), ("positive", "CONDITIONING", None),
                       ("negative", "CONDITIONING", None), ("latent_image", "LATENT", None)],
               outputs=[("LATENT", "LATENT", [])])
        g.node(dec, "VAEDecode", [2530, y], [300, 110],
               inputs=[("samples", "LATENT", None), ("vae", "VAE", None)],
               outputs=[("IMAGE", "IMAGE", [])])
        wire(4, 0, s, 0, "MODEL")
        wire(te, 0, s, 1, "CONDITIONING")
        wire(te, 1, s, 2, "CONDITIONING")
        wire(lat, 0, s, 3, "LATENT")
        wire(s, 0, dec, 0, "LATENT")
        wire(3, 0, dec, 1, "VAE")
        return te, lat, s, dec

    def edit_chain(nid, y, instr, seed, image_src, hub_key):
        te, lat, s, dec = nid, nid + 1, nid + 2, nid + 3
        te_node(te, y, instr, p["edit_neg"], hub_key, is_edit=True)
        e = smp["edit"]
        g.node(lat, "EmptyLatentImage", [1770, y], [300, 120],
               [e["width"], e["height"], 1],
               {"width": e["width"], "height": e["height"], "batch_size": 1},
               outputs=[("LATENT", "LATENT", [])])
        g.node(s, "KSampler", [2130, y], [340, 280],
               [seed, "fixed", e["steps"], e["cfg"], e["sampler_name"],
                e["scheduler"], e["denoise"]],
               {"seed": seed, "control_after_generate": "fixed",
                "steps": e["steps"], "cfg": e["cfg"],
                "sampler_name": e["sampler_name"], "scheduler": e["scheduler"],
                "denoise": e["denoise"]},
               inputs=[("model", "MODEL", None), ("positive", "CONDITIONING", None),
                       ("negative", "CONDITIONING", None), ("latent_image", "LATENT", None)],
               outputs=[("LATENT", "LATENT", [])])
        g.node(dec, "VAEDecode", [2530, y], [300, 110],
               inputs=[("samples", "LATENT", None), ("vae", "VAE", None)],
               outputs=[("IMAGE", "IMAGE", [])])
        wire(image_src, 0, te, 3, "IMAGE")   # 参考图槽
        wire(3, 0, te, 4, "VAE")
        wire(1, 0, s, 0, "MODEL")            # v2 定谳:编辑=base 直驱
        wire(te, 0, s, 1, "CONDITIONING")
        wire(te, 1, s, 2, "CONDITIONING")
        wire(lat, 0, s, 3, "LATENT")
        wire(s, 0, dec, 0, "LATENT")
        wire(3, 0, dec, 1, "VAE")
        return te, lat, s, dec

    seeds = q["seeds"]
    # ② master 双变体:t2i=文生图;i2i=LoadImage→multiref 图生图(base 直驱)
    if variant == "t2i":
        m = t2i_chain(5, 0, p["master"][0], p["master"][1],
                      q["master"]["width"], q["master"]["height"],
                      seeds["master"], "master")
        master_dec = m[3]
    else:
        g.node(55, "LoadImage", [1280, 60], [340, 130],
               ["道劫-角色图.png", "image"],
               {"image": "道劫-角色图.png", "upload": "image"},
               outputs=[("IMAGE", "IMAGE", [])])
        m = edit_chain(5, 0, p["instr"]["master_i2i"], seeds["master"],
                       image_src=55, hub_key="master_i2i")
        master_dec = m[3]

    edits = {}
    for i, tag in enumerate(("side", "back", "face", "wrist", "waist", "head")):
        nid = 10 + i * 5
        y = 560 + i * 420
        edits[tag] = edit_chain(nid, y, p["instr"][tag], seeds[tag],
                                image_src=master_dec, hub_key=tag)
    wp = t2i_chain(40, 3080, p["weapon"][0], p["weapon"][1],
                   q["weapon"]["width"], q["weapon"]["height"],
                   seeds["weapon"], "weapon")
    fx = t2i_chain(45, 3500, p["effect"][0], p["effect"][1],
                   q["effect"]["width"], q["effect"]["height"],
                   seeds["effect"], "effect")

    # head 编辑参考图改吃侧视图(13=side decode)
    unwire(edits["head"][0], 3)
    wire(edits["side"][3], 0, edits["head"][0], 3, "IMAGE")

    # ③b 表情参考×5(1114 Skill-5.4 §六;参考源=面部特写图,仅变表情锁身份)
    face_dec = edits["face"][3]
    exp_decs = []
    for i, tag in enumerate(("exp_happy", "exp_angry", "exp_sad",
                             "exp_surprise", "exp_shy")):
        chain = edit_chain(70 + i * 10, 5260 + i * 420, p["instr"][tag],
                           seeds[tag], image_src=face_dec, hub_key=tag)
        exp_decs.append(chain[3])

    # ⑤ 合成+存图(格式=注册表;背景=枢纽同源直连)
    src_ids = [master_dec, edits["side"][3], edits["back"][3], edits["face"][3],
               edits["head"][3], edits["wrist"][3], edits["waist"][3],
               wp[3], fx[3]]
    comp_inputs = [(k, "IMAGE", None) for k in
                   ("master", "side", "back", "face", "head",
                    "wrist", "waist", "weapon", "effect")]
    comp_inputs += [(f"exp_{i}", "IMAGE", None) for i in range(1, 6)]  # 表情五图
    comp_inputs.append(("背景", "STRING", None))  # 枢纽同源(永不脱钩)
    comp_inputs.append(("格式", "STRING", None))   # 1114 注册表驱动透传
    comp_inputs.append(("档案", "STRING", None))   # v6 底部信息带字段行
    g.node(50, "MySheetCardComposer", [3060, 1260], [420, 620],
           [NAME_DEFAULT, "全卡", "纯白", ""],
           {"角名": NAME_DEFAULT, "格式": "全卡", "背景": "纯白", "档案": ""},
           inputs=comp_inputs,
           outputs=[("设定卡", "IMAGE", [])])
    for slot, s in enumerate(src_ids):
        li = g.link(s, 0, 50, slot, "IMAGE")
        node_by(s)["outputs"][0]["links"].append(li)
        g.nodes[-1]["inputs"][slot]["link"] = li
    for i, dec in enumerate(exp_decs):      # 表情五图→槽 9..13
        wire(dec, 0, 50, 9 + i, "IMAGE")
    wire(60, HUB["bg"], 50, 14, "STRING")   # 背景类型:枢纽→合成器
    wire(60, HUB["fmt"], 50, 15, "STRING")  # 格式:枢纽→合成器(注册表透传)
    wire(60, HUB["arch"], 50, 16, "STRING")  # 档案:枢纽→合成器(底带两行)
    g.node(51, "SaveImage", [3560, 1440], [340, 110],
           ["道劫设定卡Q/"], {"filename_prefix": "道劫设定卡Q/"},
           inputs=[("images", "IMAGE", None)], outputs=[])
    wire(50, 0, 51, 0, "IMAGE")

    # Note=README(顶置,组外)
    g.node(52, "MarkdownNote", [0, -800], [800, 600], [NOTE])

    # 组框:⑥枢纽左置独立;Note 组外;全流程向右;两两不相交
    g.group("⑥ 提示词枢纽(单点固化·背景类型唯一旋钮)", [-40, -60, 460, 500], "#C3A")
    g.group("① 装载四件+turbo r256(bf16/heretic/texture_fix)", [500, -60, 660, 760])
    g.group("② master(本件变体:t2i 文生图 / i2i 图生图)", [1220, -60, 1740, 480])
    g.group("③ 六路编辑(multiref:TE 参考图槽;head 吃侧视图)", [1220, 500, 1720, 2400])
    g.group("④ 武器/特效 t2i(Turbo 8步)", [1220, 3020, 1720, 900], "#88A")
    g.group("⑦ 表情参考×5(Skill-5.4 §六;参考=面部特写)", [1220, 5160, 1720, 2500], "#8AA")
    g.group("⑤ 固定底框合成(格式/背景联动)", [3000, 1180, 1100, 780], "#3A3")
    return g.build()


def carry_layout(old_doc: dict, doc: dict) -> dict:
    """版式回灌(1114 勘误:用户手排画布=布局真源,重生只换结构不换布局)。

    节点按 id 回灌 pos/size;组框按 title 回灌 bounding(结构变化新增组保留新位)。
    """
    old_nodes = {n["id"]: n for n in old_doc.get("nodes", [])}
    for n in doc["nodes"]:
        if n["id"] in old_nodes:
            n["pos"] = old_nodes[n["id"]]["pos"]
            if "size" in old_nodes[n["id"]]:
                n["size"] = old_nodes[n["id"]]["size"]
    old_groups = {g_["title"]: g_ for g_ in old_doc.get("groups", [])}
    for g_ in doc["groups"]:
        if g_["title"] in old_groups:
            g_["bounding"] = old_groups[g_["title"]]["bounding"]
    return doc


def groups_disjoint(doc):
    """组框两两不相交(1113 用户令「分组不能互相遮盖」)。"""
    bs = [g["bounding"] for g in doc["groups"]]
    for i in range(len(bs)):
        for j in range(i + 1, len(bs)):
            a, b = bs[i], bs[j]
            ox = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
            oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
            assert ox <= 0 or oy <= 0, f"组框重叠 {i}×{j}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    for name, out in OUTS.items():
        doc = build_doc(name)
        if out.is_file():                      # 版式回灌:布局恒取在版画布
            doc = carry_layout(json.loads(out.read_text(encoding="utf-8")), doc)
        check(doc)
        groups_disjoint(doc)
        if args.check:
            if out.is_file():
                d = json.loads(out.read_text(encoding="utf-8"))
                check(d)
                groups_disjoint(d)
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
        if out.is_file() and out.read_text(encoding="utf-8") == text:
            print(f"[SKIP] {name} 逐字节一致")
            continue
        out.write_text(text, encoding="utf-8")
        d = json.loads(out.read_text(encoding="utf-8"))
        check(d)
        groups_disjoint(d)
        print(f"[OK] {out.name}")
    if args.check:
        print("[CHECK] 既有件复验过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
