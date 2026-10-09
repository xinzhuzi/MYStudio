#!/usr/bin/env python3
"""表情差分·一发九宫格·图生图驱动器(1009 用户令:肯定不能拼,要一次性生成)。

背景:t2i 纯文生图在 viggle cfg1 快出档下锁不住「三行三列恰好九格」
(1009 实弹 15/12/12 脸三连败,正向结构加权无效)——词面到顶,结构改由
**参考底图**锁定:程序画一张 3×3 空白格模板(透明沟隔开),走并行会话
同日新建的 qi21-道劫-img2img.json(严格经典 img2img,40步 dn0.6)一发
把九张脸画进九个格子。单次生成,非拼图。

管线:模板(1248²,九格浅灰块+透明沟)→ /upload/image → img2img 工作流
本体展平(4010 base=表情差分 / 400 指令 / 4011 锁层A 用工作流快照 /
KSampler seed 随机)→ /prompt → 轮询 → 落盘 + 收据。

用法:python3 qi21_facegrid_img2img_fire_1009.py [--seed N] [--out xx.png]
       [--denoise 0.6]
"""
from __future__ import annotations

import argparse
import io
import json
import random
import re
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-img2img.json"
OUT_DIR = REPO / "apps/output/bgscope-r3-9types"

INSTRUCTION = (
    "图1是九宫格结构底图:整幅画布恰好等分为三行三列共九个正方形格子,"
    "每格内部各画同一名青年刀修的正面脸部特写,取景从头顶至下颌,"
    "头顶、双耳、下颌与发型外轮廓完整入格;肤色温润的浅麦色,剑眉浓黑,"
    "乌黑（近黑）长发高束马尾,九格发型与头部轮廓逐格一致,仅五官表情不同,"
    "光照方向与色温九格一致;从左到右、从上到下九格依次为——沉静:双目平和微垂、"
    "眉舒展、唇线平直;含笑:眼角弯起、嘴角上扬轻抿、眉梢微挑;怒:剑眉倒竖、"
    "怒目圆睁、牙关紧咬嘴角下压;哀:眉梢下垂呈八字、眼睑低垂含泪光、嘴角下弯;"
    "惧:眉毛高挑向眉心收拢、双眼圆睁、唇微张发颤;凌厉:双眼眯起、眉峰锐利下压、"
    "嘴角紧抿;惊讶:眉毛高高挑起、双眼睁大、唇微张成小圆;害羞:双颊染红晕、"
    "眼帘低垂、嘴角含羞轻抿;决然:目光坚定直视、眉宇紧锁、嘴角平直;"
    "格子之间的间隔与画布边缘保持纯白底色,九格画面之外的画布区域不画任何内容。"
)


def engine_base() -> str:
    manifest = Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json"
    port = json.loads(manifest.read_text(encoding="utf-8")).get("engine", {}).get("port")
    if not isinstance(port, int):
        raise SystemExit(f"manifest.json 无 engine.port: {manifest}")
    return f"http://127.0.0.1:{port}"


ENGINE = engine_base()


def widget_names(cls):
    d = json.load(urllib.request.urlopen(f"{ENGINE}/object_info/{urllib.parse.quote(cls)}", timeout=10))[cls]
    out = []
    for grp in ("required", "optional"):
        for k, v in d["input"].get(grp, {}).items():
            spec = v[1] if len(v) > 1 and isinstance(v[1], dict) else {}
            if not spec.get("forceInput"):
                out.append(k)
    return out


def make_template(size=1248, n=3, gutter=34, fill=(230, 226, 220, 255)):
    """白底画布 + 3×3 浅灰方格模板(结构参考;经典img2img无alpha,沟=白非透明)。"""
    im = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    d = ImageDraw.Draw(im)
    cw = (size - gutter * (n + 1)) // n
    for r in range(n):
        for c in range(n):
            x = gutter + c * (cw + gutter)
            y = gutter + r * (cw + gutter)
            d.rectangle([x, y, x + cw, y + cw], fill=fill)
    return im


def upload(im, name):
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    b = buf.getvalue()
    bound = uuid.uuid4().hex
    body = (f"--{bound}\r\nContent-Disposition: form-data; name=\"image\"; "
            f"filename=\"{name}\"\r\nContent-Type: image/png\r\n\r\n").encode() + b + \
           f"\r\n--{bound}--\r\n".encode()
    req = urllib.request.Request(f"{ENGINE}/upload/image", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={bound}"})
    return json.load(urllib.request.urlopen(req, timeout=30))["name"]


def flatten(base, denoise, seed, img_name):
    """GUI→API:链接槽=数组引用,其余槽按 object_info widget 名序对位铺平。"""
    g = {}
    links = {(L[3], L[4]): (str(L[1]), L[2]) for L in base["links"]}
    for n in base["nodes"]:
        nid, cls = str(n["id"]), n["type"]
        if cls == "MarkdownNote":
            continue
        wv = list(n.get("widgets_values") or [])
        names = widget_names(cls)
        ins = {}
        for slot, inp in enumerate(n.get("inputs", [])):
            if (n["id"], slot) in links:
                ins[inp["name"]] = list(links[(n["id"], slot)])
        # 通用:widget 值按名序对位,仅填未被链接占据的槽
        if cls == "MyQi21PromptAssembly":
            # 快照 wv=[主体句镜像, 锁层A全文];BASE/主体句已被链接占据
            lock = next((v for v in wv if isinstance(v, str) and "风格底座" in v), "")
            ins.setdefault("锁层A全文", lock)
        elif len(wv) == len(names):
            for k, v in zip(names, wv):
                ins.setdefault(k, v)
        elif wv:
            # 长度不齐(链接槽镜像被前端剔除):按名序从后对位兜底
            for k, v in zip(reversed(names), reversed(wv)):
                ins.setdefault(k, v)
        # 本驱动覆盖项
        if cls == "MyQi21DaojieBase":
            ins["base"], ins["透明覆盖"] = "表情差分", False
        elif cls == "KSampler":
            ins["seed"], ins["denoise"] = seed, denoise
        elif cls == "LoadImage":
            ins["image"] = img_name
        elif cls == "PrimitiveStringMultiline":
            ins["value"] = INSTRUCTION
        g[nid] = {"class_type": cls, "inputs": ins}
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--denoise", type=float, default=0.6)
    ap.add_argument("--out", default=str(OUT_DIR / "表情差分.img2img.png"))
    args = ap.parse_args()
    seed = args.seed if args.seed is not None else random.randint(1, 2**31 - 1)

    base = json.loads(WF.read_text(encoding="utf-8"))
    tpl = make_template()
    name = upload(tpl, "qi21_facegrid_template_1009.png")
    print(f"[img2img] 模板已上传 {name} denoise={args.denoise} seed={seed}(随机)" if args.seed is None
          else f"[img2img] 模板已上传 {name} denoise={args.denoise} seed={seed}")
    g = flatten(base, args.denoise, seed, name)

    req = urllib.request.Request(f"{ENGINE}/prompt",
                                 data=json.dumps({"prompt": g, "client_id": "facegrid-img2img-fire"}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        raise SystemExit(f"400: {e.read().decode()[:800]}")
    print(f"queued {pid}")
    t0 = time.time()
    fn = None
    while time.time() - t0 < 1500:
        time.sleep(10)
        with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=10) as r:
            hist = json.load(r)
        if pid in hist:
            for _n, o in hist[pid].get("outputs", {}).items():
                for img in o.get("images", []):
                    fn = img["filename"]; break
            if fn:
                break
            st = hist[pid].get("status", {})
            if st.get("status_str") == "error":
                for m in st.get("messages", []):
                    if m[0] == "execution_error":
                        raise SystemExit(f"execution_error: {m[1].get('node_type')}: "
                                         f"{m[1].get('exception_message', '')[:300]}")
    assert fn, "无产物(超时)"
    out = Path(args.out)
    urllib.request.urlretrieve(f"{ENGINE}/view?filename={urllib.parse.quote(fn)}&type=output", out)
    (out.with_suffix(".指令.txt")).write_text(
        f"# 表情差分·img2img一发九宫格 seed={seed} denoise={args.denoise} 产物={fn}\n"
        f"═══ 精修指令(400) ═══\n{INSTRUCTION}\n", encoding="utf-8")
    print(f"DONE {fn} ({time.time()-t0:.0f}s) → {out} [seed={seed}]")


if __name__ == "__main__":
    main()
