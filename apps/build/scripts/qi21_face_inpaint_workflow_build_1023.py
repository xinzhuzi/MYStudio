"""qi21-道劫-换脸-局部重绘 工作流生成器 v3(10-23 用户令:单功能局部重绘工作流)。

v1/v2 教训:本引擎栈 VAEEncode 与 TextEncodeQwenImage21 槽2 latent 均不可用作初始潜码
(往返探针=废码/黑图),SetLatentNoiseMask 路判死。v3 改走社区标准「裁块-编辑-缝回」:
脸框 ImageCrop(x/y/w/h widget 全确定性) → 4:3 保比放大 1024×768 → 双图编辑
(image_1=脸块,image_2=基准脸,denoise1.0) → 缩回原尺寸 → ImageCompositeMasked
缝回原坐标——缝外像素逐位不变,脸以 1024px 高分辨率重生(全身图里脸仅~130px)。
产物=workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-换脸-局部重绘.json
"""
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-换脸-局部重绘.json"
ENGINE = "http://127.0.0.1:17001"

PROMPT = ("保持第一张图的构图、发型与衣物原样，色彩色调与第一张图完全一致；"
          "仅将画面中人物面部的五官替换为第二张图人物的面部：眼型、眉毛、鼻型、唇形、下颌与脸型与第二张图完全一致，"
          "神情中性平和；面部肤色与第一张图一致。")
# 脸框(v1 正视图 1248² 坐标,视觉定框外扩): x,y,w,h 全 16 倍数
CROP = {"x": 512, "y": 96, "w": 224, "h": 176}


def node(nid, ntype, x, y, title, widgets, inputs, outputs):
    n = {"id": nid, "type": ntype, "pos": [x, y], "size": [0, 0], "flags": {}, "order": 0, "mode": 0,
         "inputs": inputs, "outputs": outputs, "properties": {}, "widgets_values": widgets}
    if title:
        n["title"] = title
    return n


def ins(name, stype, link, widget=None, shape=None):
    d = {"name": name, "type": stype, "link": link}
    if shape:
        d["shape"] = shape
    if widget:
        d["widget"] = {"name": widget}
    return d


def outs(name, stype, links, idx=0):
    return {"name": name, "type": stype, "links": links, "slot_index": idx}


def build():
    nodes = [
        node(1, "UNETLoader", 60, 120, "[1] UNET加载",
             ["qwen_image_2.1_bf16.safetensors", "default"], [],
             [outs("MODEL", "MODEL", [16])]),
        node(2, "CLIPLoader", 60, 300, "[2] 主TE·CLIPLoader",
             ["qwen3vl_8b_bf16_heretic.safetensors", "qwen_image", "default"], [],
             [outs("CLIP", "CLIP", [6])]),
        node(3, "VAELoader", 60, 470, "[3] VAE加载",
             ["texture_fix_vae_for_qwen_image_2.1_bf16.safetensors"], [],
             [outs("VAE", "VAE", [9])]),
        node(10, "LoadImage", 420, 60, "[10] 身图·原样底图",
             ["example.png", "image"], [],
             [outs("IMAGE", "IMAGE", [0, 1])]),
        node(11, "LoadImage", 420, 300, "[11] 基准脸·五官来源(不透明图)",
             ["example.png", "image"], [],
             [outs("IMAGE", "IMAGE", [2])]),
        node(17, "ImageCrop", 720, 60, "[17] 裁脸块(x/y/w/h 与[19][70]联动)",
             [CROP["w"], CROP["h"], CROP["x"], CROP["y"]],
             [ins("image", "IMAGE", 0, shape=7)],
             [outs("IMAGE", "IMAGE", [3])]),
        node(18, "ImageResizeKJv2", 960, 60, "[18] 脸块放大·1024×768",
             [1024, 768, "lanczos", "stretch", "0, 0, 0", "center", 32, "cpu"],
             [ins("image", "IMAGE", 3, shape=7)],
             [outs("IMAGE", "IMAGE", [4])]),
        node(13, "ImageResizeKJv2", 720, 300, "[13] 基准脸缩放",
             [1024, 1024, "lanczos", "resize", "0, 0, 0", "center", 32, "cpu"],
             [ins("image", "IMAGE", 2, shape=7)],
             [outs("IMAGE", "IMAGE", [5])]),
        node(31, "TextEncodeQwenImage21", 1220, 60, "[31] 双图编码·换脸指令",
             [PROMPT, "", 0],
             [ins("clip", "CLIP", 6),
              ins("prompt", "STRING", None, widget="prompt"),
              ins("negative_prompt", "STRING", None, widget="negative_prompt"),
              ins("resolution", "INT", None, widget="resolution"),
              ins("images.image_1", "COMFY_AUTOGROW_V3", 4, widget="images.image_1", shape=7),
              ins("images.image_2", "COMFY_AUTOGROW_V3", 5, widget="images.image_2", shape=7),
              ins("vae", "VAE", 9, shape=7)],
             [outs("正向", "STRING", [8], 0), outs("负向", "STRING", [10], 1)]),
        node(41, "EmptyLatentImage", 1220, 320, "[41] 空潜码·1024×768",
             [1024, 768, 1],
             [ins("width", "INT", None, widget="width"),
              ins("height", "INT", None, widget="height"),
              ins("batch_size", "INT", None, widget="batch_size")],
             [outs("LATENT", "LATENT", [11])]),
        node(80, "LoraLoaderModelOnly", 340, 120, "[80] BFS换头LoRA×1.0(脸块大图条件下生效)",
             ["bfs_head_v1.1_qwen_2.1.safetensors", 1.0],
             [ins("model", "MODEL", 16)],
             [outs("MODEL", "MODEL", [7])]),
        node(40, "KSampler", 1700, 60, "[40] 采样·20步cfg1·denoise1",
             [42, "fixed", 20, 1, "euler", "simple", 1.0],
             [ins("model", "MODEL", 7), ins("positive", "STRING", 8),
              ins("negative", "STRING", 10), ins("latent_image", "LATENT", 11)],
             [outs("LATENT", "LATENT", [12])]),
        node(50, "VAEDecode", 1980, 60, "[50] 解码",
             None,
             [ins("samples", "LATENT", 12), ins("vae", "VAE", 9)],
             [outs("IMAGE", "IMAGE", [13])]),
        node(19, "ImageResizeKJv2", 1700, 320, "[19] 结果缩回脸块原尺寸",
             [CROP["w"], CROP["h"], "lanczos", "stretch", "0, 0, 0", "center", 32, "cpu"],
             [ins("image", "IMAGE", 13, shape=7)],
             [outs("IMAGE", "IMAGE", [14])]),
        node(70, "ImageCompositeMasked", 1980, 320, "[70] 缝回原坐标(x/y 与[17]联动)",
             [CROP["x"], CROP["y"], False],
             [ins("destination", "IMAGE", 1), ins("source", "IMAGE", 14),
              ins("x", "INT", None, widget="x"), ins("y", "INT", None, widget="y"),
              ins("resize_to_batch", "BOOLEAN", None, widget="resize_to_batch")],
             [outs("IMAGE", "IMAGE", [15])]),
        node(60, "SaveImage", 2260, 200, "[60] 保存",
             ["QI21换脸局部重绘_"],
             [ins("images", "IMAGE", 15)], []),
    ]
    links = [
        [0, 10, 0, 17, 0, "IMAGE"], [1, 10, 0, 70, 0, "IMAGE"], [2, 11, 0, 13, 0, "IMAGE"],
        [3, 17, 0, 18, 0, "IMAGE"], [4, 18, 0, 31, 0, "IMAGE"], [5, 13, 0, 31, 0, "IMAGE"],
        [6, 2, 0, 31, 0, "CLIP"], [16, 1, 0, 80, 0, "MODEL"], [7, 80, 0, 40, 0, "MODEL"], [8, 31, 0, 40, 1, "STRING"],
        [9, 3, 0, 31, 1, "VAE"], [10, 31, 1, 40, 2, "STRING"], [11, 41, 0, 40, 3, "LATENT"],
        [12, 40, 0, 50, 0, "LATENT"], [13, 50, 0, 19, 0, "IMAGE"], [14, 19, 0, 70, 1, "IMAGE"],
        [15, 70, 0, 60, 0, "IMAGE"],
    ]
    return {"id": "qi21-daojie-face-inpaint-1023", "revision": 3, "last_node_id": 80, "last_link_id": 16,
            "nodes": nodes, "links": links, "groups": [], "definitions": {"subgraphs": []},
            "config": {}, "extra": {}, "version": 0.4}


def main() -> int:
    doc = build()
    ids = {l[0] for l in doc["links"]}
    bad = [(n["id"], s["name"]) for n in doc["nodes"] for s in n.get("inputs", [])
           if s.get("link") is not None and s["link"] not in ids]
    assert not bad, f"悬空输入槽: {bad}"
    missing = []
    for cls in ("LoraLoaderModelOnly", "ImageCrop", "ImageResizeKJv2", "TextEncodeQwenImage21", "KSampler",
                "VAEDecode", "ImageCompositeMasked", "EmptyLatentImage", "SaveImage"):
        try:
            urllib.request.urlopen(f"{ENGINE}/object_info/{cls}", timeout=8)
        except Exception:
            missing.append(cls)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"written: {OUT.relative_to(ROOT)} (rev3 裁块-编辑-缝回)")
    print("link 自检: 通过 | 引擎节点类缺失:", missing if missing else "无")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
