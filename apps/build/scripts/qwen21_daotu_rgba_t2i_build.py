#!/usr/bin/env python3
"""qwen21-daotu-rgba-t2i.json 生成器(道具透明底直出件,2026-10-02)。

链路(任务口径,引擎实配):
  UNETLoader(qwen_image_2.1_bf16) -> QwenImage21Cache(auto/default) -> KSampler
  CLIPLoader(qwen3vl_8b_bf16_heretic, type=qwen_image) -> TextEncodeQwenImage21
  VAELoader(qwen_image_2.1_vae_bf16) -> TextEncodeQwenImage21.vae + VAEDecode.vae
  TextEncodeQwenImage21(不接 images, resolution=1024;槽2 latent 直进 KSampler.latent_image)
    -> KSampler(cfg=1, euler, simple, denoise=1) -> VAEDecode
    -> SplitImageWithAlpha(IMAGE+MASK) -> SaveImageWithAlpha(透明 PNG)
画布格式逐字段照库内 qwen21-t2i.json(引擎前端 0.4)。
提示词=官方 RGBA 头尾句(逐字,官方模板 Note 468)+ 中文道具主体段(05 库道具型措辞化裁,正向写法)。
幂等:重跑字节稳定(固定 uuid);自验=json.load+links 端点+节点类型注册(对 /tmp/oi.json)。
"""

import json
import uuid

OUT = "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-daotu-rgba-t2i.json"
OI = "/tmp/oi.json"
WORKFLOW_ID = "c1a2d3e4-5f60-4a7b-8c9d-0a1b2c3d4e5f"  # 固定,幂等

RGBA_HEAD = "This is an RGBA format image with transparency."
RGBA_TAIL = "The image has an alpha channel and a transparent background."
DEFAULT_SUBJECT = (
    "一柄青铜古剑的道具素材:剑身暗金底色上盘绕细密云雷纹,剑格铸成兽首衔环,"
    "剑柄缠深红丝绳;器物以正侧面平视水平居中,单一主体完整入画,四周留出空边,"
    "轮廓干净利落,如一件可直接裁切的平面素材"
)
DEFAULT_PROMPT = f"{RGBA_HEAD} {DEFAULT_SUBJECT}。{RGBA_TAIL}"

NOTE_TEXT = """## 道具透明底直出 · 使用说明(2026-10-02)

**用途**:一步直出道具透明底素材 PNG(RGBA)。替代 K2 时代『纯白底生成 → rembg 抠像』两步路——Qwen-Image-2.1 VAE 原生输出带 alpha 通道,边缘由模型画出:零抠像边缘损失、零白边残留,适合分镜/设定板道具资产量产。

### 用法要点

1. **[5] 提示词只换中间主体段**(描述道具本身:形状/材质/纹样/色彩/工艺);**头尾两句官方透明句式保留,逐字勿动**——
   - 头:`This is an RGBA format image with transparency.`
   - 尾:`The image has an alpha channel and a transparent background.`
   - 默认示例(青铜剑)只是参考写法,可改。
2. **道具纪律:写有什么,不写没有什么**——正向描述主体/材质/构图(单一主体、完整入画、四周留空边、轮廓干净);**不写否定句**(「无背景/无阴影/无文字」类字面会把概念递给模型;cfg=1 下负向槽不参与采样,排杂全靠正向写法)。
3. **[5] 不接参考图**(images 留空=纯 t2i),resolution=1024 → 直出 **1024×1024**(道具 1.0MP 口径);潜空取 [5] 的 latent 槽直进采样,无需空潜节点。
4. **参数**:[6] cfg=1 / euler / simple / denoise=1(官方道,cfg=1 时负向提示词不参与采样);steps=40(官方完整档,提速可降 25);seed 默认 randomize 便于 roll 图,要复现改 fixed。
5. **输出**:[8] 把解码图拆成 RGB + Alpha 蒙版,[9] 合并存**透明 PNG**(存 PNG 才保 alpha,JPEG 会丢);产物落 `output/MYStudio/daotu-rgba/`。
6. 旧路对照:K2 纯白+rembg=两步、抠像边缘损失、白边残留;本件一步直出。

**模型三件套**(引擎实配):UNET `qwen_image_2.1_bf16` / CLIP `qwen3vl_8b_bf16_heretic`(type=qwen_image)/ VAE `qwen_image_2.1_vae_bf16`;[4] QwenImage21Cache(auto/default)。
"""

nodes = [
    {
        "id": 1, "type": "UNETLoader", "pos": [560.0, 100.0], "size": [340, 84],
        "flags": {}, "order": 0, "mode": 0, "inputs": [],
        "outputs": [{"name": "MODEL", "type": "MODEL", "links": [1]}],
        "title": "[1] UNET加载",
        "properties": {"Node name for S&R": "UNETLoader"},
        "widgets_values": ["qwen_image_2.1_bf16.safetensors", "default"],
        "widgets_values_named": {"unet_name": "qwen_image_2.1_bf16.safetensors", "weight_dtype": "default"},
    },
    {
        "id": 2, "type": "CLIPLoader", "pos": [560.0, 420.0], "size": [360, 130],
        "flags": {}, "order": 1, "mode": 0, "inputs": [],
        "outputs": [{"name": "CLIP", "type": "CLIP", "links": [3]}],
        "title": "[2] CLIP加载(qwen_image)",
        "properties": {"Node name for S&R": "CLIPLoader"},
        "widgets_values": ["qwen3vl_8b_bf16_heretic.safetensors", "qwen_image", "default"],
        "widgets_values_named": {"clip_name": "qwen3vl_8b_bf16_heretic.safetensors", "type": "qwen_image", "device": "default"},
    },
    {
        "id": 3, "type": "VAELoader", "pos": [560.0, 740.0], "size": [340, 60],
        "flags": {}, "order": 2, "mode": 0, "inputs": [],
        "outputs": [{"name": "VAE", "type": "VAE", "links": [4, 9]}],
        "title": "[3] VAE加载",
        "properties": {"Node name for S&R": "VAELoader"},
        "widgets_values": ["qwen_image_2.1_vae_bf16.safetensors"],
        "widgets_values_named": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"},
    },
    {
        "id": 4, "type": "QwenImage21Cache", "pos": [1040.0, 100.0], "size": [300, 130],
        "flags": {}, "order": 3, "mode": 0,
        "inputs": [
            {"name": "model", "type": "MODEL", "link": 1},
            {"name": "device", "type": "COMBO", "widget": {"name": "device"}, "link": None},
            {"name": "dtype", "type": "COMBO", "widget": {"name": "dtype"}, "link": None},
        ],
        "outputs": [{"name": "MODEL", "type": "MODEL", "links": [2]}],
        "title": "[4] Q2.1缓存(auto)",
        "properties": {"Node name for S&R": "QwenImage21Cache"},
        "widgets_values": ["auto", "default"],
    },
    {
        "id": 5, "type": "TextEncodeQwenImage21", "pos": [1040.0, 340.0], "size": [420, 340],
        "flags": {}, "order": 4, "mode": 0,
        "inputs": [
            {"name": "clip", "type": "CLIP", "link": 3},
            {"name": "images.image_1", "shape": 7, "type": "IMAGE", "link": None},
            {"name": "vae", "shape": 7, "type": "VAE", "link": 4},
        ],
        "outputs": [
            {"name": "positive", "type": "CONDITIONING", "links": [5]},
            {"name": "negative", "type": "CONDITIONING", "links": [6]},
            {"name": "latent", "type": "LATENT", "links": [7]},
        ],
        "title": "[5] 文本编码(t2i·不接图·latent 直进采样)",
        "properties": {"Node name for S&R": "TextEncodeQwenImage21"},
        "widgets_values": [DEFAULT_PROMPT, "", 1024],
        "widgets_values_named": {"prompt": DEFAULT_PROMPT, "negative_prompt": "", "resolution": 1024},
    },
    {
        "id": 6, "type": "KSampler", "pos": [1560.0, 200.0], "size": [330, 262],
        "flags": {}, "order": 5, "mode": 0,
        "inputs": [
            {"name": "model", "type": "MODEL", "link": 2},
            {"name": "positive", "type": "CONDITIONING", "link": 5},
            {"name": "negative", "type": "CONDITIONING", "link": 6},
            {"name": "latent_image", "type": "LATENT", "link": 7},
        ],
        "outputs": [{"name": "LATENT", "type": "LATENT", "links": [8]}],
        "title": "[6] 采样(40步·cfg1·euler/simple)",
        "properties": {"Node name for S&R": "KSampler"},
        "widgets_values": [0, "randomize", 40, 1, "euler", "simple", 1],
        "widgets_values_named": {
            "seed": 0, "control_after_generate": "randomize", "steps": 40, "cfg": 1,
            "sampler_name": "euler", "scheduler": "simple", "denoise": 1,
        },
    },
    {
        "id": 7, "type": "VAEDecode", "pos": [1980.0, 460.0], "size": [240, 50],
        "flags": {}, "order": 6, "mode": 0,
        "inputs": [
            {"name": "samples", "type": "LATENT", "link": 8},
            {"name": "vae", "type": "VAE", "link": 9},
        ],
        "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [10]}],
        "title": "[7] VAE解码",
        "properties": {"Node name for S&R": "VAEDecode"},
    },
    {
        "id": 8, "type": "SplitImageWithAlpha", "pos": [2300.0, 460.0], "size": [260, 80],
        "flags": {}, "order": 7, "mode": 0,
        "inputs": [{"name": "image", "type": "IMAGE", "link": 10}],
        "outputs": [
            {"name": "IMAGE", "type": "IMAGE", "links": [11]},
            {"name": "MASK", "type": "MASK", "links": [12]},
        ],
        "title": "[8] 透明拆分(RGB + Alpha)",
        "properties": {"Node name for S&R": "SplitImageWithAlpha"},
    },
    {
        "id": 9, "type": "SaveImageWithAlpha", "pos": [2660.0, 340.0], "size": [380, 300],
        "flags": {}, "order": 8, "mode": 0,
        "inputs": [
            {"name": "images", "type": "IMAGE", "link": 11},
            {"name": "mask", "type": "MASK", "link": 12},
        ],
        "outputs": [],
        "title": "[9] 存透明PNG",
        "properties": {"Node name for S&R": "SaveImageWithAlpha"},
        "widgets_values": ["MYStudio/daotu-rgba"],
        "widgets_values_named": {"filename_prefix": "MYStudio/daotu-rgba"},
    },
    {
        "id": 10, "type": "MarkdownNote", "pos": [40.0, 80.0], "size": [440, 760],
        "flags": {}, "order": 9, "mode": 0, "inputs": [], "outputs": [],
        "title": "[10] 使用说明",
        "properties": {"Node name for S&R": "MarkdownNote"},
        "widgets_values": [NOTE_TEXT],
    },
]

links = [
    [1, 1, 0, 4, 0, "MODEL"],        # UNETLoader -> Cache.model
    [2, 4, 0, 6, 0, "MODEL"],        # Cache -> KSampler.model
    [3, 2, 0, 5, 0, "CLIP"],         # CLIPLoader -> TE.clip
    [4, 3, 0, 5, 2, "VAE"],          # VAELoader -> TE.vae
    [5, 5, 0, 6, 1, "CONDITIONING"],  # TE.positive -> KSampler.positive
    [6, 5, 1, 6, 2, "CONDITIONING"],  # TE.negative -> KSampler.negative
    [7, 5, 2, 6, 3, "LATENT"],       # TE.latent -> KSampler.latent_image
    [8, 6, 0, 7, 0, "LATENT"],       # KSampler -> VAEDecode.samples
    [9, 3, 0, 7, 1, "VAE"],          # VAELoader -> VAEDecode.vae
    [10, 7, 0, 8, 0, "IMAGE"],       # VAEDecode -> Split.image
    [11, 8, 0, 9, 0, "IMAGE"],       # Split.IMAGE -> Save.images
    [12, 8, 1, 9, 1, "MASK"],        # Split.MASK -> Save.mask
]

groups = [
    {
        "id": 1, "title": "Qwen-Image-2.1 加载器(bf16 三件套)",
        "bounding": [520, 60, 460, 780], "color": "#3f789e", "flags": {},
    },
    {
        "id": 2, "title": "道具透明底主链(编码→采样→解码→透明拆分→存PNG)",
        "bounding": [1000, 60, 2080, 760], "color": "#3f789e", "flags": {},
    },
]

graph = {
    "id": WORKFLOW_ID,
    "revision": 0,
    "last_node_id": 10,
    "last_link_id": 12,
    "nodes": nodes,
    "links": links,
    "groups": groups,
    "config": {},
    "extra": {"ue_links": [], "frontendVersion": "1.53.6"},
    "version": 0.4,
}


def self_check(g: dict) -> None:
    # 1) links 四元组端点核验:端点节点与槽位都存在
    by_id = {n["id"]: n for n in g["nodes"]}
    for l in g["links"]:
        lid, oid, oslot, tid, tslot, ltype = l
        assert oid in by_id and tid in by_id, f"link {lid}: 端点节点缺失 {oid}/{tid}"
        o = by_id[oid]["outputs"][oslot]
        t = by_id[tid]["inputs"][tslot]
        assert o["type"] == ltype, f"link {lid}: 源槽类型 {o['type']} != {ltype}"
        assert t["type"] == ltype, f"link {lid}: 目标槽类型 {t['type']} != {ltype}"
        assert lid in (o.get("links") or []), f"link {lid}: 源节点 outputs.links 未登记"
        assert t.get("link") == lid, f"link {lid}: 目标节点 inputs.link 未登记"
    # outputs.links / inputs.link 反向核验:登记的都在 links 里
    link_ids = {l[0] for l in g["links"]}
    for n in g["nodes"]:
        for o in n.get("outputs", []):
            for lid in o.get("links") or []:
                assert lid in link_ids, f"node {n['id']} 输出登记 link {lid} 不在 links"
        for i in n.get("inputs", []):
            if i.get("link") is not None:
                assert i["link"] in link_ids, f"node {n['id']} 输入登记 link {i['link']} 不在 links"
    # 2) 节点类型注册核验(对 /tmp/oi.json;Note/MarkdownNote 前端件豁免)
    oi = json.load(open(OI))
    for n in g["nodes"]:
        if n["type"] in ("Note", "MarkdownNote"):
            continue
        assert n["type"] in oi, f"节点类型未注册: {n['type']}"
    # 3) 采样参数与实配链锚
    te = by_id[5]
    assert te["widgets_values"][2] == 1024, "TE.resolution != 1024"
    assert te["inputs"][0]["name"] == "clip" and te["inputs"][2]["name"] == "vae"
    assert te["inputs"][1]["name"] == "images.image_1" and te["inputs"][1]["link"] is None, "t2i 链 images 槽必须留空"
    ks = by_id[6]["widgets_values"]
    assert ks[3] == 1 and ks[4] == "euler" and ks[5] == "simple" and ks[6] == 1, "KSampler 参数漂移"
    assert by_id[1]["widgets_values"][0] == "qwen_image_2.1_bf16.safetensors"
    assert by_id[2]["widgets_values"][:2] == ["qwen3vl_8b_bf16_heretic.safetensors", "qwen_image"]
    assert by_id[3]["widgets_values"][0] == "qwen_image_2.1_vae_bf16.safetensors"
    assert by_id[4]["widgets_values"] == ["auto", "default"], "Cache widgets 漂移"
    # 4) 零左向线(主流程左→右)
    for l in g["links"]:
        assert by_id[l[1]]["pos"][0] < by_id[l[3]]["pos"][0], f"link {l[0]} 左向线"
    # 5) 提示词头尾官方句式逐字在场
    p = by_id[5]["widgets_values"][0]
    assert p.startswith("This is an RGBA format image with transparency. ")
    assert p.endswith("The image has an alpha channel and a transparent background.")
    print("self-check PASS:",
          f"nodes={len(g['nodes'])} links={len(g['links'])}",
          f"exec_nodes={sum(1 for n in g['nodes'] if n['type'] != 'MarkdownNote')}")


if __name__ == "__main__":
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)
        f.write("\n")
    reloaded = json.load(open(OUT))  # json.load 复验
    self_check(reloaded)
    print("written:", OUT)
