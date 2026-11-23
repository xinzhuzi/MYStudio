#!/usr/bin/env python3
"""1109 社区-无审查直出-t2i 生成器(幂等)。

蓝本=Arekejoker qwen21-nsfw-pose-skill 作者实弹件 comfy_145233010.json(shower);
取其配方核心:官方 int8 底模 → NSFW LoRA@1.0 → EasyCache → 50步主段(cfg2.5/
er_sde/beta)→ 25步精炼段(dn0.35/seed1024)。作者件中的像素×2 尾段与开关实验树
不搬(留 Note 存档);PowerLoraLoader(rgthree) 换标准 LoraLoaderModelOnly 单件
(SKILL.md 钦定默认 L22-31@1.0,槽可换)。SaveImageAdvanced 换核心 SaveImage。
默认提示词=良性占位(用户自改;分层阶梯见技能 SKILL.md §4)。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/3_社区模板/社区-无审查直出-t2i.json"

LORA = "qwen2_1-femaledVaginus-nsfw-v1_3-fine_L22-31.safetensors"
DEFAULT_PROMPT = ("一位年轻女性站在洒满晨光的画室窗边,身穿米白色针织长裙,侧脸柔和,"
                  "长发微卷,写实摄影风格,浅景深,自然光")

NOTE = ("# 社区·无审查直出 t2i(1109 建)\n\n"
        "蓝本=Arekejoker/qwen21-nsfw-pose-skill 作者实弹件(shower 样图);配方核心:\n"
        "官方 int8 底模 → NSFW LoRA@1.0 → EasyCache(0.2/15-95%) → "
        "**50 步主段(cfg 2.5 / er_sde / beta / dn1.0)→ 25 步精炼段(dn 0.35 / seed 1024)**。\n\n"
        "## 用法\n"
        "- 提示词:[9] 唯一手写位(默认良性占位句,分层阶梯写法见技能 "
        ".agents/skills/qwen-image-prompt/qwen21-nsfw-pose-skill/SKILL.md §4);\n"
        "- LoRA 槽:[4] 可换引擎在位的四件之一(thesealpacas-nsfw-v2 / nsfw-posture-v3 / "
        "femaledVaginus v1.3-fine),强度默认 1.0;\n"
        "- 画幅:[6] ResolutionSelector 默认 2:3 竖版 2.0MP;\n"
        "- 负向:空(cfg2.5 下沿用作者口径)。\n\n"
        "## 未搬段(存档)\n"
        "作者件另有可选像素×2 尾段(解码→lanczos×2→重编码)与开关实验树(dn0.75 路与"
        "半分辨率 25 步路),本件不搬;要追见蓝本 downloads/samples/comfy_145233010.json。")


def node(nid: int, ntype: str, pos: list, widgets=None, inputs=None, outputs=None,
         title: str = "", size=None) -> dict:
    n = {"id": nid, "type": ntype, "pos": pos, "size": size or [260, 120],
         "flags": {}, "order": nid, "mode": 0,
         "inputs": inputs or [], "outputs": outputs or [],
         "properties": {"Node name for S&R": ntype},
         "widgets_values": widgets}
    if title:
        n["title"] = title
    return n


def inp(name: str, ntype: str, link) -> dict:
    return {"name": name, "type": ntype, "link": link}


def out(name: str, ntype: str, links: list) -> dict:
    return {"name": name, "type": ntype, "links": links}


def main() -> int:
    nodes = [
        node(1, "UNETLoader", [60, 140], ["qwen_image_2.1_int8_convrot.safetensors", "default"],
             title="[1] 底模·int8", outputs=[out("MODEL", "MODEL", [1])]),
        node(2, "CLIPLoader", [60, 320], ["qwen3vl_8b_int8_convrot.safetensors", "qwen_image", "default"],
             title="[2] 文本编码器", outputs=[out("CLIP", "CLIP", [5])]),
        node(3, "VAELoader", [60, 480], ["qwen_image_2.1_vae_bf16.safetensors"],
             title="[3] VAE", outputs=[out("VAE", "VAE", [6, 19])]),
        node(4, "LoraLoaderModelOnly", [380, 120], [LORA, 1.0],
             title="[4] NSFW LoRA @1.0(槽可换)",
             inputs=[inp("model", "MODEL", 1)], outputs=[out("MODEL", "MODEL", [2])]),
        node(5, "EasyCache", [680, 120], [0.2, 0.15, 0.95, False],
             title="[5] EasyCache(0.2/15-95%)",
             inputs=[inp("model", "MODEL", 2)], outputs=[out("MODEL", "MODEL", [7, 12])]),
        node(6, "ResolutionSelector", [380, 300], ["2:3 (Portrait Photo)", 2.0, 8],
             title="[6] 画幅选择", outputs=[out("width", "INT", [3]), out("height", "INT", [4])]),
        node(7, "EmptyLatentImage", [680, 300], [1024, 1536, 1],
             title="[7] 空潜(w/h 跟随[6])",
             inputs=[inp("width", "INT", 3), inp("height", "INT", 4)],
             outputs=[out("LATENT", "LATENT", [10])]),
        node(8, "SeedNode", [380, 460], [80964],
             title="[8] 主段 seed", outputs=[out("seed", "INT", [11, 16])]),
        node(9, "TextEncodeQwenImage21", [680, 440],
             [DEFAULT_PROMPT, "", 1024], size=[300, 240],
             title="[9] 提示词编码(唯一手写位)",
             inputs=[inp("clip", "CLIP", 5), inp("vae", "VAE", 6)],
             outputs=[out("positive", "CONDITIONING", [8, 13]),
                      out("negative", "CONDITIONING", [9, 14])]),
        node(10, "KSampler", [1040, 300],
             [0, "fixed", 50, 2.5, "er_sde", "beta", 1.0], size=[300, 260],
             title="[10] 主段·50步 cfg2.5 er_sde/beta",
             inputs=[inp("model", "MODEL", 7), inp("positive", "CONDITIONING", 8),
                     inp("negative", "CONDITIONING", 9), inp("latent_image", "LATENT", 10),
                     inp("seed", "INT", 11)],
             outputs=[out("LATENT", "LATENT", [15])]),
        node(11, "easy mathInt", [1040, 620], [50, 2, "divide"],
             title="[11] 步数=主段/2", outputs=[out("INT", "INT", [17])]),
        node(12, "KSampler", [1400, 300],
             [1024, "fixed", 0, 2.5, "er_sde", "beta", 0.35], size=[300, 260],
             title="[12] 精炼段·25步 dn0.35 seed1024",
             inputs=[inp("model", "MODEL", 12), inp("positive", "CONDITIONING", 13),
                     inp("negative", "CONDITIONING", 14), inp("latent_image", "LATENT", 15),
                     inp("seed", "INT", 16), inp("steps", "INT", 17)],
             outputs=[out("LATENT", "LATENT", [18])]),
        node(13, "VAEDecode", [1760, 300],
             title="[13] 解码",
             inputs=[inp("samples", "LATENT", 18), inp("vae", "VAE", 19)],
             outputs=[out("IMAGE", "IMAGE", [20])]),
        node(14, "SaveImage", [1760, 500], ["社区-无审查直出/out"],
             title="[14] 存图",
             inputs=[inp("images", "IMAGE", 20)], outputs=[]),
        node(15, "MarkdownNote", [60, 700], [NOTE], size=[420, 380], title="[15] 说明卡"),
    ]
    links = [
        [1, 1, 0, 4, 0, "MODEL"],
        [2, 4, 0, 5, 0, "MODEL"],
        [3, 6, 0, 7, 0, "INT"],
        [4, 6, 1, 7, 1, "INT"],
        [5, 2, 0, 9, 0, "CLIP"],
        [6, 3, 0, 9, 1, "VAE"],
        [7, 5, 0, 10, 0, "MODEL"],
        [8, 9, 0, 10, 1, "CONDITIONING"],
        [9, 9, 1, 10, 2, "CONDITIONING"],
        [10, 7, 0, 10, 3, "LATENT"],
        [11, 8, 0, 10, 4, "INT"],
        [12, 5, 0, 12, 0, "MODEL"],
        [13, 9, 0, 12, 1, "CONDITIONING"],
        [14, 9, 1, 12, 2, "CONDITIONING"],
        [15, 10, 0, 12, 3, "LATENT"],
        [16, 8, 0, 12, 4, "INT"],
        [17, 11, 0, 12, 5, "INT"],
        [18, 12, 0, 13, 0, "LATENT"],
        [19, 3, 0, 13, 1, "VAE"],
        [20, 13, 0, 14, 0, "IMAGE"],
    ]
    doc = {"id": "nsfw-t2i-1109", "revision": 1, "last_node_id": 15, "last_link_id": 20,
           "nodes": nodes, "links": links, "groups": [],
           "config": {}, "extra": {}, "version": 0.4}

    # 幸存断言:所有 input.link 都有对应 link id;所有 link 端点节点存在
    ids = {n["id"] for n in nodes}
    lids = {l[0] for l in links}
    for n in nodes:
        for i in n["inputs"]:
            assert i["link"] in lids, f"[{n['id']}] 输入悬空 link {i['link']}"
    for l in links:
        assert l[1] in ids and l[3] in ids, f"link{l[0]} 端点缺节点"
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写 {OUT.relative_to(ROOT)}(15 节点/20 链)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
