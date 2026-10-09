#!/usr/bin/env python3
# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""qi21-道劫-img2img 建件(1009 用户令:严格经典图生图 denoise 0.5~0.7)。

用户令(2026-10-09):「选择 0.5~0.7 大结构保留,细节大幅重画(同构图精修、改
细节),要做成这个,图生图」。与上一令(i2i 默认档 viggle=满噪参考图范式)并存
的唯一解=立新件,i2i 原样保留。

形态=pose-edit 先例(扁平自持,零子图,13~15 节点):
  底图 LoadImage → 1.5MP 预缩 ──┐
  精修指令(主体句)→ 装配(指令+BASE+锁层A)──→ TextEncodeQwenImage21 ──→
  QwenImage21Cache ← UNET ──┘        (image_1=底图;image_2 留空=Autogrow min0)
  KSampler(40步/cfg1/euler/simple/denoise 0.6)→ VAEDecode → 保存
  负向真接线:装配负面词口1 → TE.negative_prompt(i2i 空置位,本件接通;
  cfg=1 下数学不参与=官方路径口径,抬 cfg 可激活)

四改造令落地对照(对话四点):①denoise=0.6 默认(档位 0.5~0.7,面板即 KSampler
widget 直调);②latent=TE 内置 image_1 VAE latent(画布随底图,零额外接线);
③恒 40 步直出无加速档(FunAcc4步/viggle6步=满噪蒸馏件,低 denoise 有效步数
坍缩必崩——与 i2i 三档互斥分野);④提示词=描述性精修指令(非 <image1>/<image2>
编辑指令),型文底座照常参与。

模板来源:节点对象逐件拷自 qi21-道劫-i2i.json(装配三件自其 [6] 子图提升为
顶层,链路重排)与 qwen21-pose-edit.json(Cache/KSampler);asm 锁层A全文=
i2i 现值(=qi21_bases.json art_style_base.positive_text 真源,契约测试热读互锁)。

fail-closed:建后自验(链接双向完整性/必接槽全接/禁件零在/denoise=steps=cfg
锚/锁层A==真源热读/零负区/image_2 恰空/件数锚),任一不满足即零写入退出非零。
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ENG = REPO / "apps/backend/engines/comfyui"
I2I = ENG / "workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
POSE = ENG / "workflows/1_图片/Q2-1图像/2_图生图/qwen21-pose-edit.json"
OUT = ENG / "workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-img2img.json"
TRUTH = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"

DN = 0.6          # 用户令 0.5~0.7 区间取中
STEPS = 40        # 道劫产线完整档(官方区间 40-50,同 i2i 直出支路)
SAVE_PREFIX = "QI21道劫精修_"
INSTRUCTION = ("保持图1的构图、人物姿态与画面内容不变,按道劫画风整幅精修:"
               "重画细节纹理与质感,提升线描与设色完成度,不增删画面元素")

NOTE = """## 道劫·图生图(严格经典 img2img)·用法速查

**定位:同构图精修/改细节**——底图给骨架、文字给皮:denoise<1 部分重噪,输出
**构图与姿态从底图继承**,提示词只换质感细节。与 `qi21-道劫-i2i`(参考图编辑,
满噪 denoise=1.0,构图由文字重排)是两种范式,勿混用:改内容/换装/多参考走
i2i 或 multiref;**保构图换细节走本件**。

### 三步用法
1. [10] 换底图(人物/场景/既有成图均可);
2. [4010] 选型(十选一,默认①人物;型文底座照常参与,画面结构仍以底图为准);
3. [400] 写精修指令(描述性,默认例句可直接跑)→ 队列。

### denoise 档位([7] KSampler 末位 widget,默认 0.6)
| 档位 | 效果 |
|---|---|
| 0.2~0.4 | 几乎不动构图,只换质感/风格 |
| **0.5~0.7(默认 0.6)** | **大结构保留,细节大幅重画(同构图精修/改细节)** |
| →1.0 | 逼近重画,构图渐不听底图(即退化回 i2i 范式) |

### 采样与加速分野
- [7] 恒 **40 步直出**(cfg1/euler/simple/seed fixed 0,道劫完整档官方区间)。
- **本件无加速档,有意为之**:Fun-Acc 4 步/viggle 6 步=满噪蒸馏件,低 denoise
  下有效步数坍缩(4×0.6≈2.4 步)必崩——要加速走 i2i(其 viggle 默认=1009 令)。
- 负向:[4011] 装配负面词(型负面+锁层负面合并)真接 TE.negative_prompt;
  **cfg=1 下数学不参与采样**(官方路径口径,同 i2i),抬 cfg 即激活。

### 画幅与参考
- 画幅随底图:[16] 预缩 1.5MP→TE resolution=0 不重采样,输出=底图(预缩后)比例。
- [4015] image_2 槽**留空=合法**(TE images=Autogrow min0);要第二参考走 i2i。
- PE 扩写不在本件(直写;PE-I2I 走 i2i);RGBA 透明不在本件(走 i2i)。

### 装配与真源
- 装配全文=[400] 精修指令+BASE+[4011] 锁层A 三段换行拼合;[28] 装配预览可看全文。
- 锁层A=qi21_bases.json art_style_base.positive_text 唯一真源热读互锁
  (1004 集中化令);型文同源。改词先改真源再同步本件卡文。

### 维护
- 生成脚本 `apps/build/scripts/qi21_img2img_build_1009.py`(幂等,重跑字节稳定);
  契约=TestQi21Img2ImgContract+计数锚(清单台账同步 `docs/comfyui-kb/漫影工作流清单.md`)。
- 与 i2i 的分野表:i2i=图给素材文字重排(满噪)/本件=图给骨架文字换皮(降噪)。"""


def die(msg: str) -> None:
    print(f"FAIL {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    i2i = json.loads(I2I.read_text(encoding="utf-8"))
    pose = json.loads(POSE.read_text(encoding="utf-8"))
    truth = json.loads(TRUTH.read_text(encoding="utf-8"))["art_style_base"]["positive_text"]

    def top(doc, nid):
        ns = [n for n in doc["nodes"] if n["id"] == nid]
        assert len(ns) == 1, f"top#{nid} 应恰 1"
        return ns[0]

    def sg6(doc, nid):
        s = [x for x in doc["definitions"]["subgraphs"] if "文本提示词" in x["name"]][0]
        ns = [n for n in s["nodes"] if n["id"] == nid]
        assert len(ns) == 1, f"sg6#{nid} 应恰 1"
        return ns[0]

    N: dict[int, dict] = {}

    def take(node: dict, nid: int, title: str, pos: list[int]) -> dict:
        n = copy.deepcopy(node)
        n["id"] = nid
        n["title"] = title
        n["pos"] = pos
        # 断链重排:inputs[].link 清空、outputs[].links 清空,由 wiring 段重建
        for i in n.get("inputs", []) or []:
            i["link"] = None
        for o in n.get("outputs", []) or []:
            o["links"] = []
        N[nid] = n
        return n

    take(top(i2i, 1), 1, "[1] UNET加载", [1140, 1700])
    take(top(i2i, 2), 2, "[2] 主TE·CLIPLoader", [1540, 1900])
    take(top(i2i, 3), 3, "[3] VAE加载", [1540, 2200])
    take(top(i2i, 10), 10, "[10] 底图·LoadImage", [820, 120])
    take(top(i2i, 16), 16, "[16] 画布预缩·Scale", [1440, 240])
    n400 = take(top(i2i, 400), 400, "[400] 精修指令·主体句", [820, 640])
    n400["widgets_values"] = [INSTRUCTION]
    n4010 = take(sg6(i2i, 4010), 4010, "[4010] 底座十选一·自研", [820, 900])
    n4011 = take(sg6(i2i, 4011), 4011, "[4011] 底料拼合·自研", [1480, 760])
    w = n4011["widgets_values"]
    assert isinstance(w, list) and len(w) == 2, f"asm wv 结构漂移:{w!r}"
    n4011["widgets_values"] = [INSTRUCTION, w[1]]          # 主体句默认随新例句;锁层A 逐字承 i2i(=真源)
    # i2i 存档实例只带 1 出(装配全文);py 现行 RETURN=(装配全文,负面词)——补负面词
    # 输出口(引擎装载按 object_info 对齐,存档补口=与活 py 同构)
    assert [o["name"] for o in n4011["outputs"]] == ["装配全文"], "asm 出口序漂移"
    n4011["outputs"].append({"name": "负面词", "type": "STRING", "links": [],
                             "slot_index": 1})
    take(top(i2i, 401), 28, "[28] 装配预览·showAnything", [1980, 1280])
    n4015 = take(sg6(i2i, 4015), 4015, "[4015] 主编码·TextEncode", [2100, 300])
    # negative_prompt 接线位:插输入槽(列序=槽序;prompt 仍居 slot4,新槽垫后=插槽后移零波及——本件链路全新)
    assert [i["name"] for i in n4015["inputs"]] == ["clip", "images.image_1", "vae", "images.image_2", "prompt"], \
        f"TE 输入序漂移:{[i['name'] for i in n4015['inputs']]}"
    n4015["inputs"].append({"name": "negative_prompt", "type": "STRING",
                            "widget": {"name": "negative_prompt"}, "link": None})
    take(top(pose, 9), 9, "[9] 模型缓存·QwenImage21Cache", [2560, 1900])
    n7 = take(top(pose, 10), 7, f"[7] 精修采样·KSampler({STEPS}步·dn{DN})", [2980, 1000])
    n7["widgets_values"] = [0, "fixed", STEPS, 1, "euler", "simple", DN]
    take(top(i2i, 5), 5, "[5] VAEDecode", [3520, 1180])
    n8 = take(top(i2i, 8), 8, "[8] SaveImage", [3980, 1000])
    n8["widgets_values"] = [SAVE_PREFIX]

    note = {"id": 402, "type": "MarkdownNote", "pos": [80, 80], "size": [640, 880],
            "flags": {}, "order": 20, "mode": 0, "inputs": [], "outputs": [],
            "properties": {}, "widgets_values": [NOTE], "title": "[402] 道劫图生图·用法速查"}
    N[402] = note

    # ── wiring:(from,fslot)→(to,tslot);TE 槽序 clip0/image_1 1/vae2/image_2 3/prompt4/negative_prompt5
    PLAN = [
        (10, 0, 16, 0, "IMAGE"),
        (2, 0, 4015, 0, "CLIP"),
        (16, 0, 4015, 1, "IMAGE"),
        (3, 0, 4015, 2, "VAE"),
        (4011, 0, 4015, 4, "STRING"),
        (4011, 1, 4015, 5, "STRING"),
        (4010, 0, 4011, 0, "STRING"),
        (400, 0, 4011, 1, "STRING"),
        (4011, 0, 28, 0, "STRING"),   # 链型标=源类型(showAnything 目标为通配,同 i2i link21 口径)
        (1, 0, 9, 0, "MODEL"),
        (9, 0, 7, 0, "MODEL"),
        (4015, 0, 7, 1, "CONDITIONING"),
        (4015, 1, 7, 2, "CONDITIONING"),
        (4015, 2, 7, 3, "LATENT"),
        (7, 0, 5, 0, "LATENT"),
        (3, 0, 5, 1, "VAE"),
        (5, 0, 8, 0, "IMAGE"),
    ]
    links = []
    for lid, (f, fs, t, ts, ty) in enumerate(PLAN, start=1):
        fi = N[f]["outputs"][fs]
        ti = N[t]["inputs"][ts]
        if ti["link"] is not None:
            die(f"槽重复接线:#{t}.{ti['name']}")
        ti["link"] = lid
        fi.setdefault("links", []).append(lid)
        links.append([lid, f, fs, t, ts, ty])

    groups = [
        {"id": 1, "title": "道劫·①底图·装配(指令+底座+拼合+预览)", "bounding": [780, 60, 1250, 1530], "color": "#3f789e", "flags": {}},
        {"id": 2, "title": "Qwen-Image-2.1 ②加载器(bf16 实配)", "bounding": [1100, 1620, 900, 660], "color": "#a1309b", "flags": {}},
        {"id": 3, "title": "道劫·③图生图主链(单参考TE→Cache→40步采样dn0.6→解码→保存)", "bounding": [2040, 240, 2340, 1900], "color": "#88A", "flags": {}},
    ]

    doc = {"id": "qi21-daojie-img2img-1009", "revision": 0, "last_node_id": 4020,
           "last_link_id": len(links), "nodes": [N[k] for k in sorted(N)],
           "links": links, "groups": groups, "config": {}, "extra": {},
           "definitions": {"subgraphs": []}, "version": 0.4}

    # ── 自验(fail-closed)──
    ids = {n["id"] for n in doc["nodes"]}
    assert len(ids) == len(doc["nodes"]) == 15, f"节点应恰 15,得 {len(doc['nodes'])}"
    banned = ("LoraLoaderModelOnly", "MyQi21SpeedSelect", "EmptyLatentImage",
              "ComfySwitchNode", "SplitSigmas", "SamplerCustomAdvanced")
    for n in doc["nodes"]:
        if n["type"].startswith("T8QwenImage21") or n["type"] in banned:
            die(f"禁件在场:{n['type']}(低 denoise 与满噪蒸馏/选择机构互斥)")
        if n["pos"][0] < 0 or n["pos"][1] < 0:
            die(f"负区坐标:#{n['id']} {n['pos']}")
    for l in links:
        _, f, fs, t, ts, ty = l
        assert f in ids and t in ids, f"链 {l} 引用不存在的节点"
        fo = N[f]["outputs"][fs]
        ti = N[t]["inputs"][ts]
        if ti["link"] != l[0]:
            die(f"链 {l[0]} 目标槽 link 不回指")
        if l[0] not in (fo.get("links") or []):
            die(f"链 {l[0]} 源槽 links 缺登记")
        if fo["type"] != ty or (ti["type"] != ty and ti["type"] != "*"):
            die(f"链 {l[0]} 类型不匹配:{fo['type']}→{ti['type']}({ty})")
    must_wired = {4015: ["clip", "images.image_1", "vae", "prompt", "negative_prompt"],
                  4011: ["BASE", "主体句"], 7: ["model", "positive", "negative", "latent_image"],
                  5: ["samples", "vae"], 8: ["images"], 16: ["image"], 9: ["model"], 28: ["anything"]}
    for nid, names in must_wired.items():
        for i in N[nid]["inputs"]:
            if i["name"] in names and i["link"] is None:
                die(f"必接槽空置:#{nid}.{i['name']}")
    img2 = next(i for i in N[4015]["inputs"] if i["name"] == "images.image_2")
    if img2["link"] is not None:
        die("image_2 应恰空接(单参考;Autogrow min0)")
    ks = N[7]["widgets_values"]
    assert ks[2] == STEPS and ks[3] == 1 and ks[6] == DN, f"KSampler 锚漂移:{ks}"
    assert N[4011]["widgets_values"][1] == truth, "锁层A全文≠qi21_bases.json 真源"
    assert N[4015]["widgets_values"][2] == 0, "TE resolution 应=0(不重采样)"
    assert N[8]["widgets_values"] == [SAVE_PREFIX]
    for tok in ("0.5~0.7", "同构图精修", "满噪蒸馏", "negative_prompt", "image_2", "qi21_bases.json", "viggle"):
        if tok not in NOTE:
            die(f"Note 缺要点 token:{tok}")

    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PASS 建件完成:{OUT.name}")
    print(f"     节点 15/链 {len(links)}/组框 3;denoise={DN} steps={STEPS};锁层A==真源(热读)")


if __name__ == "__main__":
    main()
