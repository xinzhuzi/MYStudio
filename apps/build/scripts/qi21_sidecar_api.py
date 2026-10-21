#!/usr/bin/env python3
"""qi21_sidecar_api —— 固定生图 API 调用器(sidecar 17595 /v1/images/generations)。

10-21 定谳(晏燎十境界脸+独孤剑尘两役内核收拢;此前无固定件——既有文生图脚本
=引擎 WS 直提的各役收据器 qi21_local_ten_types 等,i2i 产品装配只住在本 API
链路,引擎直提须手工复刻装配=漂移,禁):

  t2i: python3 qi21_sidecar_api.py t2i --prompt "主体句" [--base-type 人物] [--out a.png] [--aspect 1:1] [--dry-run]
  i2i: python3 qi21_sidecar_api.py i2i --prompt "指令" --ref 参考图.png [--shape keep|square|32] [--out b.png] [--dry-run]

模型恒 qwen-image-2-1(qwen21→道劫 t2i/i2i 模板;comfyui-bridge=K2 老桥禁混)。
t2i 可注入型层(--base-type,十型真源 qi21_bases.json 型名);i2i 不吃型层
(组装用途恒=画风转换),构图语言写进指令,画幅=参考 AR×2(--shape 预整形控幅)。

公共能力(战役实弹沉淀):
- 令牌自取(python/profiles/image-gen/config.json controlToken);
- sidecar 探活:App 在驾→CDP 9223 imageGenRuntime.setup() 唤醒;未在驾→独立
  拉起(装机 backend+env);
- App 未在驾且引擎亡→引擎保活守护(engine_manager.ensure_engine_ready 须常驻
  父进程抱着,退出即收摊;qwen21 布局的 _require_downloaded 不自举引擎);
- 参考图 768 硬门 JPEG 阶梯(镜像 image-transfer.ts);
- 白图检测(引擎冷启/中断期 200 返回纯白 11394B 件)删件重试;
- 503=引擎冷启耐心等,409=排队等待。
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from PIL import Image

USER_DATA = Path.home() / "Library" / "Application Support" / "漫影工作室"
BACKEND = Path("/Applications/漫影工作室.app/Contents/Resources/backend")
PY = USER_DATA / "python" / "bin" / "python3"
SIDECAR = "http://127.0.0.1:17595"
MODEL = "qwen-image-2-1"
POST_TIMEOUT_S = 900

TRANSFER_MAX_EDGES = [768, 672, 576, 512, 448, 384, 320, 256]
TRANSFER_JPEG_QUALITIES = [0.86, 0.78, 0.7, 0.62, 0.54, 0.46, 0.4]
IMAGE_TRANSFER_MAX_BYTES = 1_000_000


def log(m: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {m}", flush=True)


def die(m: str) -> None:
    print(f"FATAL: {m}", file=sys.stderr, flush=True)
    sys.exit(1)


def token() -> str:
    cfg = json.loads((USER_DATA / "python" / "profiles" / "image-gen" / "config.json").read_text())
    return str(cfg["controlToken"])


def sidecar_ok() -> bool:
    try:
        with urllib.request.urlopen(f"{SIDECAR}/health", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def app_running() -> bool:
    return bool(subprocess.run(["pgrep", "-f", "漫影工作室.app/Contents/MacOS"],
                               capture_output=True).stdout.strip())


def engine_ok() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:17001/system_stats", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def spawn_sidecar() -> None:
    env = {**os.environ, "PYTHONPATH": str(BACKEND),
           "MYSTUDIO_IMAGE_MODEL_DIR": str(USER_DATA / "model" / "imagegen"),
           "MANYING_LOCAL_IMAGE_TOKEN": token()}
    logd = USER_DATA / "logs" / "sidecars"
    logd.mkdir(parents=True, exist_ok=True)
    lf = open(logd / f"image-gen-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log", "wb")
    subprocess.Popen([str(PY), "-m", "image_gen.main", "--host", "127.0.0.1", "--port", "17595"],
                     cwd=str(BACKEND), env=env, stdout=lf, stderr=subprocess.STDOUT,
                     start_new_session=True)


def hold_engine() -> None:
    """引擎保活守护:ensure_engine_ready 须常驻父进程(退出即收摊)。"""
    holder = Path("/tmp/qi21_sidecar_api_engine_hold.py")
    holder.write_text(
        "from engines.comfyui import engine_manager\nimport time,sys\n"
        "engine_manager.engine_manager().ensure_engine_ready()\n"
        "print('engine ready',flush=True)\nwhile True: time.sleep(60)\n")
    lf = open("/tmp/qi21_sidecar_api_engine_hold.log", "wb")
    subprocess.Popen([str(PY), str(holder)], cwd=str(BACKEND),
                     env={**os.environ, "PYTHONPATH": str(BACKEND),
                          "MYSTUDIO_IMAGE_MODEL_DIR": str(USER_DATA / "model" / "imagegen")},
                     stdout=lf, stderr=subprocess.STDOUT, start_new_session=True)


def cdp_eval(expr: str) -> str:
    r = subprocess.run(["node", str(Path(__file__).with_name("cdp_eval.mjs")), expr],
                       capture_output=True, text=True, timeout=180)
    return (r.stdout or r.stderr).strip()[:160]


def ensure_channel() -> None:
    """sidecar 缺席先救活;App 未在驾且引擎亡→保活守护拉引擎。"""
    if sidecar_ok():
        pass
    elif app_running():
        log("sidecar 缺席,CDP 唤醒(App 在驾)")
        cdp_eval("(async()=>{try{await window.imageGenRuntime.setup();return 'ok'}catch(e){return 'throw:'+(e&&e.message)}})()")
        for _ in range(90):
            if sidecar_ok():
                break
            time.sleep(2)
    else:
        log("sidecar 缺席,独立拉起(App 未在驾)")
        spawn_sidecar()
        for _ in range(120):
            if sidecar_ok():
                break
            time.sleep(1)
    if not sidecar_ok():
        die("sidecar 未能就绪")
    if not engine_ok() and not app_running():
        log("引擎亡且 App 未在驾,保活守护拉引擎(冷启 1-3 分钟)")
        hold_engine()


def prepare_reference(png: Path) -> str:
    im = Image.open(png).convert("RGB")
    for edge in TRANSFER_MAX_EDGES:
        s = edge / max(im.size)
        sized = im if s >= 1 else im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        if max(sized.size) > 768:
            continue
        for q in TRANSFER_JPEG_QUALITIES:
            buf = io.BytesIO()
            sized.save(buf, "JPEG", quality=int(round(q * 100)))
            d = buf.getvalue()
            if len(d) < IMAGE_TRANSFER_MAX_BYTES:
                log(f"  参考 {png.name} → {sized.size[0]}x{sized.size[1]} q{q} {len(d)}B")
                return "data:image/jpeg;base64," + base64.b64encode(d).decode()
    die(f"参考阶梯全败 {png}")


def shape_reference(png: Path, shape: str) -> Path:
    """keep=原样;square=顶部方裁(头肩区);32=垫边成 3:2 横幅(多视图家族口径)。"""
    if shape == "keep":
        return png
    im = Image.open(png).convert("RGB")
    w, h = im.size
    if shape == "square":
        side = min(w, h)
        out = im.crop((0, 0, side, side))
        p = Path(f"/tmp/qi21_api_ref_square_{side}.png")
        out.save(p, "PNG")
        log(f"  方裁毕 {out.size[0]}x{out.size[1]}")
        return p
    if shape == "32":
        tw = round(h * 1.5)
        edges = [im.getpixel((0, y)) for y in range(0, h, 64)] + [im.getpixel((w - 1, y)) for y in range(0, h, 64)]
        tone = tuple(int(statistics.median(c[i] for c in edges)) for i in range(3))
        canvas = Image.new("RGB", (tw, h), tone)
        canvas.paste(im, ((tw - w) // 2, 0))
        p = Path(f"/tmp/qi21_api_ref_32_{tw}x{h}.png")
        canvas.save(p, "PNG")
        log(f"  3:2 垫边毕 {tw}x{h} 底调={tone}")
        return p
    die(f"未知 shape: {shape}")


def is_blank(png: Path) -> bool:
    im = Image.open(png).convert("RGB").resize((64, 64))
    return len(set(im.getdata())) < 10


def run(mode: str, args: argparse.Namespace) -> Path:
    out = Path(args.out) if args.out else Path(f"/tmp/qi21_api_{mode}_{int(time.time())}.png")
    body: dict = {"model": MODEL, "prompt": args.prompt, "n": 1, "stream": False,
                  "aspect_ratio": args.aspect, "resolution": "1024"}
    ref_path = None
    if mode == "i2i":
        if not args.ref:
            die("i2i 必填 --ref")
        ref_path = shape_reference(Path(args.ref).expanduser(), args.shape)
        body["image_urls"] = [prepare_reference(ref_path)]
    elif args.base_type:
        body["base_type"] = args.base_type  # 仅 t2i 分支消费(qwen21 实读定谳)
    if args.dry_run:
        safe = {**body}
        if "image_urls" in safe:
            safe["image_urls"] = [f"<{len(body['image_urls'][0])}B data URI>"]
        print(json.dumps(safe, ensure_ascii=False, indent=2))
        return out
    ensure_channel()
    payload = json.dumps(body).encode()
    for attempt in range(1, 8):
        if not sidecar_ok():
            ensure_channel()
        req = urllib.request.Request(
            f"{SIDECAR}/v1/images/generations", data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token()}"},
            method="POST")
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=POST_TIMEOUT_S) as r:
                resp = json.loads(r.read())
            raw = base64.b64decode(resp["data"][0]["b64_json"])
            if raw[:8] != b"\x89PNG\r\n\x1a\n":
                raise ValueError("非 PNG")
            out.write_bytes(raw)
            if is_blank(out):
                log(f"  白图(第{attempt}刀),重试")
                out.unlink()
                time.sleep(5)
                continue
            im = Image.open(out)
            log(f"  成功 {im.size[0]}x{im.size[1]} {out.stat().st_size}B {time.time()-t0:.0f}s → {out}")
            return out
        except urllib.error.HTTPError as e:
            log(f"  HTTP {e.code} {e.read().decode(errors='replace')[:160]}(第{attempt}刀)")
            time.sleep(60 if e.code == 503 else (30 if e.code == 409 else 10))
        except Exception as e:
            log(f"  {e}(第{attempt}刀)")
            if not sidecar_ok():
                ensure_channel()
            else:
                time.sleep(10)
    die("多刀全败")


def main() -> None:
    ap = argparse.ArgumentParser(description="固定生图 API 调用器(sidecar 17595)")
    sub = ap.add_subparsers(dest="mode", required=True)
    common = {"prompt": [("--prompt", "-p")], "out": [("--out", "-o")], "dry": [("--dry-run",)]}
    t2i = sub.add_parser("t2i", help="文生图(可注入型层)")
    t2i.add_argument("--prompt", "-p", required=True)
    t2i.add_argument("--base-type", help="十型名:人物/场景/道具/美宣/人物多视图/高清人脸/分镜剧情图/表情差分/概念气氛图/设定卡")
    t2i.add_argument("--aspect", default="1:1")
    t2i.add_argument("--out", "-o")
    t2i.add_argument("--dry-run", action="store_true")
    i2i = sub.add_parser("i2i", help="图生图(参考图锚身份,画风转换装配)")
    i2i.add_argument("--prompt", "-p", required=True)
    i2i.add_argument("--ref", "-r", required=True, help="参考图路径")
    i2i.add_argument("--shape", default="keep", choices=["keep", "square", "32"],
                     help="keep=原样画幅/square=顶方裁/32=垫边 3:2 横幅")
    i2i.add_argument("--aspect", default="1:1")
    i2i.add_argument("--out", "-o")
    i2i.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    run(args.mode, args)


if __name__ == "__main__":
    main()
