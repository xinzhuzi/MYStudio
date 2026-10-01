#!/usr/bin/env python3
"""qwen21-multiref-edit.json 生成器(真源:本脚本;改布局改这里,禁手改 json)。

多参考拼装件(Q2-1图像/2_图生图):
- 官方 TextEncodeQwenImage21 多参考能力(任务口径至多16图;引擎节点层 autogrow
  不设硬限,comfy_api/latest/_io.py:1085 _MaxNames=100)。
- 编辑链照官方模板 image_qwen_image_2_1_image_edit.json(TE images 槽 LoadImage×N),
  权重换引擎实配 bf16 三件套(同 qi21-edit.json 现役),平铺不用子图。
- 默认三参考:人物+服装(官方样例,引擎家级 input 已有)+道具占位。
- TE latent(槽2)直进 KSampler latent_image;KSampler 25步官方编辑档 cfg=1
  euler/simple denoise=1;resolution=0 随图(各参考原尺寸32对齐)。
- TE inputs 序列化照 qi21-edit.json [40] 子图内 TE 实战约定:
  [clip, images.image_1, vae, images.image_2, images.image_3](2026-10-02 核)。
"""
import json
import uuid
from pathlib import Path

OUT = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/"
           "comfyui/workflows/1_图片/Q2-1图像/2_图生图/qwen21-multiref-edit.json")

PROMPT = (
    "Keep the character and pose in <image1> unchanged, "
    "put the light blue denim shirt from <image2> on the character, "
    "and let the character hold the prop from <image3> naturally in hand, "
    "preserve the original facial features, hair, body shape and pose, "
    "the denim shirt fits naturally on body, realistic denim fabric texture, "
    "natural clothing folds, keep the original background and original lighting, "
    "high fashion editorial photography, sharp details"
)

NOTE = """## Qwen-Image-2.1 多参考拼装编辑 · 使用说明(2026-10-02)

**用途**:角色设定表 / 换装 / 多资产拼装——把 `TextEncodeQwenImage21` 多参考
能力一次用满(至多 **16 张**参考图;项目现役件只用到双参考)。

### 参考图(②区,可增删)
- **参考1·人物** `portrait_model_denim.png` = `<image1>`,**同时是编辑画布**(输出画布跟随 image_1)
- **参考2·服装** `clothing_light_blue_denim_shirt.png` = `<image2>`(两张官方样例,引擎 input 已有)
- **参考3·道具** = 占位空图——**跑前必须选你自己的道具图**,空图直跑会报错
- 加参考 = 再拖一个 LoadImage,连到 TE 下一根 `images.image_N` 槽(名称即次序)

### 多参考语义(指代写法)
- prompt 里用 `<image1>` `<image2>` `<image3>` … 指代对应参考图
- image_1 是编辑目标(人物/底图),其余是参考素材;指代词与连线次序一一对应
- 上限 **16 图**(模型能力口径;引擎节点层 autogrow 不设硬限,官方模板 Note 标 10 为其子图外露脚数)

### 关键参数
- **resolution = 0**:各参考按原尺寸 32 对齐、不重采样(官方编辑模板同款);调大=按总像素预算统一缩放
- **指令默认英文**:改图指令英文优先(官方模板同款英文句式);中文可用但有语义漂移风险
  (一致性 LoRA 1001 实弹教训:中文指令+LoRA=纯黑图;本件无 LoRA,中文仍建议简单直给)
- 采样 = **25 步官方编辑档** euler/simple **cfg=1** denoise=1;cfg=1 时 negative 无效(官方口径)
- TE latent(槽2)直进 KSampler latent_image,无需 EmptyLatentImage/画幅开关

### 权重三件套(引擎实配,①区)
- UNET `qwen_image_2.1_bf16.safetensors` → `QwenImage21Cache(auto/default)` → 采样
- CLIP `qwen3vl_8b_bf16_heretic.safetensors`(type=qwen_image)· VAE `qwen_image_2.1_vae_bf16.safetensors`(VAE 必接 TE,0930 实弹坑)
"""


def node(nid, ntype, pos, size, order, inputs, outputs, wv=None, title=None,
         props=None, extra_fields=None):
    n = {"id": nid, "type": ntype, "pos": pos, "size": size, "flags": {},
         "order": order, "mode": 0, "inputs": inputs, "outputs": outputs,
         "properties": props if props is not None else
         {"Node name for S&R": ntype}}
    if wv is not None:
        n["widgets_values"] = wv
    if title:
        n["title"] = title
    if extra_fields:
        n.update(extra_fields)
    return n


def winput(name, ntype, widget=None, link=None, shape=None):
    # widget 槽显式 "link": null(家款口径,qi21-edit 平铺节点同式)
    e = {"name": name, "type": ntype}
    if shape is not None:
        e["shape"] = shape
    if widget is not None:
        e["widget"] = {"name": widget}
    e["link"] = link
    return e


def output(name, ntype, links):
    return {"name": name, "type": ntype, "links": links}


nodes = [
    # ① 加载器 + 缓存
    node(1, "UNETLoader", [780, 160], [340, 84], 0,
         [winput("unet_name", "COMBO", widget="unet_name"),
          winput("weight_dtype", "COMBO", widget="weight_dtype")],
         [output("MODEL", "MODEL", [1])],
         ["qwen_image_2.1_bf16.safetensors", "default"]),
    node(2, "CLIPLoader", [780, 320], [360, 130], 1,
         [winput("clip_name", "COMBO", widget="clip_name"),
          winput("type", "COMBO", widget="type"),
          winput("device", "COMBO", widget="device", shape=7)],
         [output("CLIP", "CLIP", [3])],
         ["qwen3vl_8b_bf16_heretic.safetensors", "qwen_image", "default"]),
    node(3, "VAELoader", [780, 520], [340, 60], 2,
         [winput("vae_name", "COMBO", widget="vae_name")],
         [output("VAE", "VAE", [4, 12])],
         ["qwen_image_2.1_vae_bf16.safetensors"]),
    node(7, "QwenImage21Cache", [1220, 160], [340, 120], 3,
         [winput("model", "MODEL", link=1),
          winput("device", "COMBO", widget="device"),
          winput("dtype", "COMBO", widget="dtype")],
         [output("MODEL", "MODEL", [2])],
         ["auto", "default"]),
    # ② 参考图 ×3
    node(4, "LoadImage", [780, 740], [340, 420], 4,
         [winput("image", "COMBO", widget="image"),
          winput("upload", "IMAGEUPLOAD", widget="upload")],
         [output("IMAGE", "IMAGE", [5]), output("MASK", "MASK", None)],
         ["portrait_model_denim.png", "image"], title="参考1·人物(=image_1·编辑画布)"),
    node(5, "LoadImage", [780, 1220], [340, 420], 5,
         [winput("image", "COMBO", widget="image"),
          winput("upload", "IMAGEUPLOAD", widget="upload")],
         [output("IMAGE", "IMAGE", [6]), output("MASK", "MASK", None)],
         ["clothing_light_blue_denim_shirt.png", "image"], title="参考2·服装(=image_2)"),
    node(6, "LoadImage", [780, 1700], [340, 420], 6,
         [winput("image", "COMBO", widget="image"),
          winput("upload", "IMAGEUPLOAD", widget="upload")],
         [output("IMAGE", "IMAGE", [7]), output("MASK", "MASK", None)],
         ["", "image"], title="参考3·道具(=image_3·占位,跑前选图)"),
    # ③ 多参考编码 + 采样(25步官方编辑档)
    node(8, "TextEncodeQwenImage21", [1640, 740], [760, 480], 7,
         [winput("clip", "CLIP", link=3),
          winput("images.image_1", "IMAGE", link=5, shape=7),
          winput("vae", "VAE", link=4, shape=7),
          winput("images.image_2", "IMAGE", link=6, shape=7),
          winput("images.image_3", "IMAGE", link=7, shape=7)],
         [output("positive", "CONDITIONING", [8]),
          output("negative", "CONDITIONING", [9]),
          output("latent", "LATENT", [10])],
         [PROMPT, "", 0], title="多参考编码(resolution=0 随图)"),
    node(9, "KSampler", [2480, 740], [330, 260], 8,
         [winput("model", "MODEL", link=2),
          winput("positive", "CONDITIONING", link=8),
          winput("negative", "CONDITIONING", link=9),
          winput("latent_image", "LATENT", link=10),
          winput("seed", "INT", widget="seed"),
          winput("steps", "INT", widget="steps"),
          winput("cfg", "FLOAT", widget="cfg"),
          winput("sampler_name", "COMBO", widget="sampler_name"),
          winput("scheduler", "COMBO", widget="scheduler"),
          winput("denoise", "FLOAT", widget="denoise")],
         [output("LATENT", "LATENT", [11])],
         [0, "randomize", 25, 1, "euler", "simple", 1],
         title="采样(25步·cfg=1)"),
    node(10, "VAEDecode", [2880, 740], [240, 50], 9,
         [winput("samples", "LATENT", link=11),
          winput("vae", "VAE", link=12)],
         [output("IMAGE", "IMAGE", [13])]),
    node(11, "SaveImage", [3180, 740], [380, 330], 10,
         [winput("images", "IMAGE", link=13)],
         [], ["MYStudio"]),
    # 说明卡(家款口径:位置式 widgets_values + 标准 properties,qi21-edit 同式)
    {"id": 12, "type": "MarkdownNote", "pos": [80, 160], "size": [620, 1180],
     "flags": {}, "order": 11, "mode": 0, "inputs": [], "outputs": [],
     "properties": {"Node name for S&R": "MarkdownNote"},
     "widgets_values": [NOTE]},
]

links = [
    [1, 1, 0, 7, 0, "MODEL"],
    [2, 7, 0, 9, 0, "MODEL"],
    [3, 2, 0, 8, 0, "CLIP"],
    [4, 3, 0, 8, 2, "VAE"],
    [5, 4, 0, 8, 1, "IMAGE"],
    [6, 5, 0, 8, 3, "IMAGE"],
    [7, 6, 0, 8, 4, "IMAGE"],
    [8, 8, 0, 9, 1, "CONDITIONING"],
    [9, 8, 1, 9, 2, "CONDITIONING"],
    [10, 8, 2, 9, 3, "LATENT"],
    [11, 9, 0, 10, 0, "LATENT"],
    [12, 3, 0, 10, 1, "VAE"],
    [13, 10, 0, 11, 0, "IMAGE"],
]

groups = [
    {"id": 1, "title": "①加载器·bf16三件套[1][2][3]+缓存[7](UNET→Cache→采样)",
     "bounding": [760, 120, 820, 500], "color": "#3f789e", "flags": {}},
    {"id": 2, "title": "②参考图×3([4]人物/[5]服装/[6]道具占位;加图=新LoadImage连TE下一根images.image_N)",
     "bounding": [760, 700, 460, 1660], "color": "#3f789e", "flags": {}},
    {"id": 3, "title": "③多参考编码[8]+采样[9](25步官方编辑档·cfg=1·TE latent直进)",
     "bounding": [1620, 700, 1600, 620], "color": "#3f789e", "flags": {}},
    {"id": 4, "title": "④出图([10]解码·[11]存图)",
     "bounding": [3160, 700, 440, 420], "color": "#8864a8", "flags": {}},
]

wf = {
    "id": str(uuid.uuid4()),
    "version": 0.4,
    "revision": 0,
    "config": {},
    "extra": {},
    "groups": groups,
    "nodes": nodes,
    "links": links,
    "definitions": {"subgraphs": []},
    "last_node_id": 12,
    "last_link_id": 13,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"written: {OUT} ({OUT.stat().st_size} bytes)")
# 立即复验
json.load(open(OUT, encoding="utf-8"))
print("re-load ok, nodes =", len(nodes), "links =", len(links))
