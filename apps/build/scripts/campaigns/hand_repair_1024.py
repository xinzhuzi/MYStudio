#!/usr/bin/env python3
"""hand_repair_1024 —— 手崩第一响应:crop-放大-单点修-回贴(10-24 手部防崩计划 P1.5)。

设计(手崩专用,替代整图重掷——保住已合格的姿势/特效/背景像素):
  ① mediapipe 定位崩手(检出即给腕点/指根坐标);
  ② 裁手部 ROI(边距 margin,短边 ≥768,放大后喂引擎);
  ③ 喂 i2i 引擎单点修(指令=手部重绘为自然垂放五指+数量锚,满噪编辑只重绘 ROI);
  ④ 回贴原图(羽化边缘 blend,其余像素原样)。

用法:
  # 系统 python(调引擎/上传走 repo 桥函数;手部检测内部转调 handgate venv):
  python3 hand_repair_1024.py <图路径> --out <覆盖或另存路径> [--seed N] [--host 127.0.0.1:17002]

依赖:handgate venv(/tmp/handgate-venv,mediapipe)+模型(/tmp/hand_landmarker.task)
     +引擎在驾(user_fire_template_1023.json 提交图,fires 画风转换路)。
修指令(手部防崩计划 L3 三件套,硬编码禁改):
  「将图中手部重绘为自然垂放的手:五指自然放松,每只手恰好五根手指,五指数量准确,
   指节清晰分明,手腕与手背结构自然;仅重绘手部,其余未提及之处保持原样。」
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import random
import subprocess
import sys
import time
from pathlib import Path
from urllib import request as urlreq
from urllib.parse import quote

HANDGATE_PY = "/tmp/handgate-venv/bin/python"
HAND_MODEL = "/tmp/hand_landmarker.task"
REPO = Path(__file__).resolve().parents[3]  # apps/build/scripts/ → 仓库根
TPL = REPO / "apps/output/晏燎/user_fire_template_1023.json"
REPAIR_INSTRUCTION = (
    "将图中手部重绘为结构正确的手：五指数量准确（每只手恰好五根手指），指节清晰分明，"
    "手部动作与原图保持一致（握物则仍稳固握物，张开则仍自然张开）；仅修手部结构，"
    "手中的剑与衣物保持原样，其余未提及之处保持原样。")
FEATHER = 48  # 回贴羽化边(像素,2K 图)


def detect_hands(img, only_bad=False) -> list[tuple[float, float]]:
    """返回手部中心(中指根)列表(handgate venv 隔离跑)。
    only_bad=True 只返回结构畸形的手(与 hand_gate 同判据:握拳态宽带[0.8,20]/舒展态[2,20])。"""
    code = (
        "import mediapipe as mp,numpy as np,PIL.Image,io,json,sys,math\n"
        "from mediapipe.tasks import python as mpp\n"
        "from mediapipe.tasks.python import vision\n"
        "def ok(lm):\n"
        "    def d(a,b): return math.hypot(a.x-b.x,a.y-b.y)\n"
        "    palm=lm[9]\n"
        "    curled=sum(1 for t,m in ((8,5),(12,9),(16,13),(20,17)) if d(lm[t],palm)<d(lm[m],palm))\n"
        "    lo=0.8 if curled>=3 else 2.0\n"
        "    r=d(lm[0],lm[12])/(d(lm[5],lm[17]) or 1e-6)\n"
        "    return lo<=r<=20.0\n"
        "buf=sys.stdin.buffer.read(); im=PIL.Image.open(io.BytesIO(buf)).convert('RGB')\n"
        "im.thumbnail((1600,1600))\n"
        "d=vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions("
        "base_options=mpp.BaseOptions(model_asset_path='" + HAND_MODEL + "'),"
        "num_hands=4,running_mode=vision.RunningMode.IMAGE,"
        "min_hand_detection_confidence=0.3,min_hand_presence_confidence=0.3))\n"
        "r=d.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.array(im)))\n"
        "allh=[[l[9].x,l[9].y] for l in r.hand_landmarks]\n"
        "keep=[h for h,l in zip(allh,r.hand_landmarks) if (ok(l) or not " + str(only_bad) + ")]\n"
        "print(json.dumps(keep))\n")
    raw = subprocess.run([HANDGATE_PY, "-c", code], input=img_bytes(img), capture_output=True, check=True)
    return json.loads(raw.stdout.decode())


def img_bytes(im):
    b = io.BytesIO(); im.save(b, format="PNG"); return b.getvalue()


def http(method, url, payload=None, timeout=15):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urlreq.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    return json.load(urlreq.urlopen(req, timeout=timeout))


def engine_ready(host):
    try:
        urlreq.urlopen(f"http://{host}/system_stats", timeout=2); return True
    except Exception:
        return False


def gen_crop(crop_png: bytes, seed: int, host: str) -> bytes:
    """把 ROI 喂 i2i(满噪画风转换路)单点修手,返回修好的 ROI PNG 字节。"""
    sys.path.insert(0, str(REPO / "apps/backend"))
    from engines.image_engine.qwen21 import _upload_image, _fetch_bytes
    upload = _upload_image(f"http://{host}/upload/image",
                           base64.b64encode(crop_png).decode("ascii"), f"handfix-{seed}.png").get("name")
    g = json.loads(TPL.read_text())
    g["400"]["inputs"]["value"] = REPAIR_INSTRUCTION
    g["10"]["inputs"]["image"] = upload
    g["7:7014"]["inputs"]["value"] = seed
    g["6:180"]["inputs"]["mode"] = "false"
    g["16"]["inputs"]["megapixels"] = 2.25  # ROI 手像素保障:与整图同档(1024 两轮 1MP 修不动教训)
    pid = http("POST", f"http://{host}/prompt", {"prompt": g, "client_id": "handfix"})["prompt_id"]
    deadline = time.time() + 600
    while time.time() < deadline:
        time.sleep(3)
        e = http("GET", f"http://{host}/history/{pid}").get(pid, {})
        st = e.get("status", {}).get("status_str")
        if st == "error":
            raise RuntimeError(str(e.get("status", {}).get("messages"))[:200])
        if st != "success":
            continue
        for node in ("504", "8"):
            imgs = e.get("outputs", {}).get(node, {}).get("images", [])
            if imgs:
                q = f"filename={quote(imgs[0]['filename'])}&subfolder={quote(imgs[0].get('subfolder',''))}&type={imgs[0].get('type','output')}"
                return _fetch_bytes(f"http://{host}/view?{q}")
        raise RuntimeError("success 但无产物")
    raise RuntimeError("超时")


def paste_feathered(base: "PIL.Image.Image", patch: "PIL.Image.Image", box):
    """羽化回贴:patch 边缘线性渐隐,与 base 混合。"""
    from PIL import Image as PImage
    import numpy as np
    x0, y0 = box
    ph, pw = patch.size[1], patch.size[0]
    m = np.ones((ph, pw), dtype=float)
    f = FEATHER
    ramp = np.linspace(0, 1, f)
    m[:f, :] *= ramp[:, None]; m[-f:, :] *= ramp[::-1][:, None]
    m[:, :f] *= ramp[None, :]; m[:, -f:] *= ramp[::-1][None, :]
    a = np.array(base); p = np.array(patch).astype(float)
    m3 = m[..., None]
    a[y0:y0+ph, x0:x0+pw] = (p * m3 + a[y0:y0+ph, x0:x0+pw] * (1 - m3)).astype("uint8")
    base.paste(PImage.fromarray(a[y0:y0+ph, x0:x0+pw]), (x0, y0))


def main():
    import PIL.Image
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--host", default="127.0.0.1:17002")
    ap.add_argument("--all", action="store_true", help="修全部检出的手(默认只修第一只)")
    a = ap.parse_args()
    if not engine_ready(a.host):
        print(f"引擎 {a.host} 不在驾——先拉实例再修"); sys.exit(3)
    im = PIL.Image.open(a.image).convert("RGB")
    W, H = im.size
    hands = detect_hands(im, only_bad=not a.all)
    if not hands:
        print("无可修目标(0 手=遮蔽/袖藏请人工;或全部手已结构正常)"); sys.exit(0)
    targets = hands
    print(f"检出 {len(hands)} 只手,修 {len(targets)} 只: {[(round(x*W), round(y*H)) for x, y in targets]}")
    seed = a.seed or random.randint(1, 2**31 - 1)
    for (nx, ny) in targets:
        cx, cy = int(nx * W), int(ny * H)
        side = min(768, W, H)
        # ROI 中心贴手,边界收敛进画
        x0 = max(0, min(W - side, cx - side // 2)); y0 = max(0, min(H - side, cy - side // 2))
        crop = im.crop((x0, y0, x0 + side, y0 + side))
        fixed = gen_crop(img_bytes(crop), seed, a.host)
        patch = PIL.Image.open(io.BytesIO(fixed)).convert("RGB").resize((side, side))
        paste_feathered(im, patch, (x0, y0))
        print(f"  手 @({cx},{cy}) ROI({x0},{y0},{side}px) 修复回贴 ✓")
        seed += 1
    im.save(a.out)
    print(f"落盘: {a.out}")


if __name__ == "__main__":
    main()
