#!/usr/bin/env python3
"""yanliao_poster_fire_1024 —— 晏燎海报批产固化驱动(10-24 手部防崩闭环收口)。

今天共主四连崩的教训:门禁建了没挂批产=白建。本脚本把防线全部焊死在流程里:

  ① 指令预检(起草纪律静态化):扫手部动作关键词——违禁词命中(张开/托举/剑指/摊开等
     L3+ 动作)且无安全词(拢袖/实握/垂放/藏袖)→ 打警告(不阻断,特批场景可 --force-pass-precheck);
  ② 一发一重启(治 MPS 退化)+ 生成期 megapixels=2.25(手像素地基);
  ③ 五线门禁(出图必过才落盘):字节<400K 废/透明>1% 废/近空白废/高饱和<5% 废/
     hand_gate 手部门禁 FAIL 废——UNVERIFIED(袖藏检不到)标注放行候人工;
  ④ FAIL 自动重掷(--attempts 上限),全 FAIL 不落盘(保住旧图)。

用法:
  python3 yanliao_poster_fire_1024.py --stage 10.共主期 [--attempts 3]
  python3 yanliao_poster_fire_1024.py --stage 10.共主期 --ref <参考图> --out <落盘> --instruction-file <指令文件>

依赖:真源晏燎.json / user_fire_template_1023.json / handgate venv(/tmp/handgate-venv)/引擎拉起配方。
"""
from __future__ import annotations

import argparse
import base64
import json
import random
import subprocess
import sys
import time
from pathlib import Path
from urllib import request as urlreq
from urllib.parse import quote

REPO = Path(__file__).resolve().parents[3]
TRUTH = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/晏燎.json"
TPL = REPO / "apps/output/晏燎/user_fire_template_1023.json"
HANDGATE = REPO / "apps/build/scripts/hand_gate_1024.py"
HANDGATE_PY = "/tmp/handgate-venv/bin/python"
ENGINE_PY = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/venv/bin/python"
ENGINE_HOME = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI"
ENGINE = "http://127.0.0.1:17002"
MEGAPIXELS = 2.25

# 手部动作分级静态检查(L2 纪律自动化;命中违禁词且无安全词=警告)
RISKY_WORDS = ("五指自然张开", "五指张开", "张开保持平衡", "双手掌心向上", "托起", "托举", "剑指", "摊开")
SAFE_WORDS = ("拢袖", "拢入宽袖", "实握", "自然垂放", "藏于袖", "不入画", "手部零入画", "恰好五根手指")


def precheck(instruction: str) -> list[str]:
    hits = [w for w in RISKY_WORDS if w in instruction]
    if hits and not any(w in instruction for w in SAFE_WORDS):
        return [f"手部违禁动作词命中: {hits}(分级表 L3+,高崩;须配安全词或拢袖/实握)"]
    return []


def restart_engine():
    r = subprocess.run(["lsof", "-ti", ":17002"], capture_output=True, text=True).stdout.split()
    for p in r:
        subprocess.run(["kill", p], capture_output=True)
    time.sleep(3)
    subprocess.Popen(
        [ENGINE_PY, "main.py", "--listen", "127.0.0.1", "--port", "17002",
         "--enable-manager", "--gpu-only", "--reserve-vram", "16",
         "--use-pytorch-cross-attention",
         "--input-directory", "../input", "--output-directory", "../output"],
        cwd=ENGINE_HOME, stdout=open("/tmp/qi21-fire-engine.log", "w"), stderr=subprocess.STDOUT)
    for _ in range(60):
        try:
            urlreq.urlopen(f"{ENGINE}/system_stats", timeout=2)
            return
        except Exception:
            time.sleep(5)
    raise RuntimeError("引擎未就绪")


def http(method, url, payload=None, timeout=15):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urlreq.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    return json.load(urlreq.urlopen(req, timeout=timeout))


def run_one(instruction: str, ref_png: bytes, seed: int) -> bytes:
    sys.path.insert(0, str(REPO / "apps/backend"))
    from engines.image_engine.qwen21 import _upload_image, _fetch_bytes
    restart_engine()
    upload = _upload_image(f"{ENGINE}/upload/image", base64.b64encode(ref_png).decode("ascii"),
                           f"fire-{seed}.png").get("name")
    g = json.loads(TPL.read_text())
    g["400"]["inputs"]["value"] = instruction
    g["10"]["inputs"]["image"] = upload
    g["7:7014"]["inputs"]["value"] = seed
    g["6:180"]["inputs"]["mode"] = "false"
    g["16"]["inputs"]["megapixels"] = MEGAPIXELS
    pid = http("POST", f"{ENGINE}/prompt", {"prompt": g, "client_id": "poster-fire"})["prompt_id"]
    deadline = time.time() + 1200
    while time.time() < deadline:
        time.sleep(3)
        e = http("GET", f"{ENGINE}/history/{pid}").get(pid, {})
        st = e.get("status", {}).get("status_str")
        if st == "error":
            raise RuntimeError(str(e.get("status", {}).get("messages"))[:300])
        if st != "success":
            continue
        for node in ("504", "8"):
            imgs = e.get("outputs", {}).get(node, {}).get("images", [])
            if imgs:
                q = f"filename={quote(imgs[0]['filename'])}&subfolder={quote(imgs[0].get('subfolder',''))}&type={imgs[0].get('type','output')}"
                return _fetch_bytes(f"{ENGINE}/view?{q}")
        raise RuntimeError("success 但无产物")
    raise RuntimeError("超时")


def hand_gate(path: Path) -> str:
    """PASS / FAIL / UNVERIFIED;异常按 UNVERIFIED 处理(不误杀)。"""
    try:
        r = subprocess.run([HANDGATE_PY, str(HANDGATE), str(path)],
                           capture_output=True, text=True, timeout=180)
        data = json.loads(r.stdout[r.stdout.find("{"):])
        return list(data.values())[0]["verdict"]
    except Exception as exc:
        print(f"  hand_gate 异常(按 UNVERIFIED): {exc}", flush=True)
        return "UNVERIFIED"


def gate(raw: bytes, tmp: Path) -> tuple[bool, str, str]:
    """四线确定性门禁 + hand_gate 第五线。返回(过?, 理由, 手部verdict)。"""
    from PIL import Image
    import io
    import numpy as np
    im = Image.open(io.BytesIO(raw))
    if len(raw) < 400_000:
        return False, f"废(字节{len(raw)})", ""
    if im.mode == "RGBA":
        if (np.array(im)[..., 3] < 250).mean() > 0.01:
            return False, "废(透明)", ""
    small = im.convert("RGB").resize((64, 64))
    if all(hi - lo < 12 for lo, hi in small.getextrema()):
        return False, "废(近空白)", ""
    a = np.array(im.convert("RGB").resize((256, 340))).astype(float) / 255
    mx, mn = a.max(-1), a.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    if (sat > 0.3).mean() < 0.05:
        return False, f"废(低饱和{(sat>0.3).mean():.1%})", ""
    tmp.write_bytes(raw)
    hv = hand_gate(tmp)
    if hv == "FAIL":
        return False, "废(手部门禁FAIL)", hv
    return True, f"过({im.size[0]}×{im.size[1]},{len(raw)//1024}KB,高饱和{(sat>0.3).mean():.0%},手部{hv})", hv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", help="晏燎.json 境界键,如 10.共主期")
    ap.add_argument("--instruction-file", help="替代:指令文本文件(优先于 --stage)")
    ap.add_argument("--ref", help="替代:参考图路径")
    ap.add_argument("--out", help="替代:落盘路径")
    ap.add_argument("--attempts", type=int, default=3)
    ap.add_argument("--force-pass-precheck", action="store_true")
    a = ap.parse_args()

    d = json.loads(TRUTH.read_text())
    base = REPO / "apps/output/晏燎/trial_基准"
    if a.instruction_file:
        instruction = Path(a.instruction_file).read_text(encoding="utf-8").strip()
    else:
        instruction = d["stages"]["境界"][a.stage]["海报指令"]
    ref_png = Path(a.ref).read_bytes() if a.ref else \
        (base / f"晏燎_{a.stage.split('.')[-1].replace('期','')}期_正视图_v1.png".replace("共主期", "共主期")).read_bytes()
    out = Path(a.out) if a.out else base / f"晏燎_{a.stage.split('.')[-1]}_海报_v1.png"

    warns = precheck(instruction)
    if warns:
        for w in warns:
            print(f"[预检警告] {w}", flush=True)
        if not a.force_pass_precheck:
            print("预检未过——修指令或 --force-pass-precheck 特批", flush=True)
            sys.exit(4)

    tmp = out.with_suffix(".gating.png")
    for attempt in range(1, a.attempts + 1):
        seed = random.randint(1, 2**31 - 1)
        try:
            raw = run_one(instruction, ref_png, seed)
            ok, why, hv = gate(raw, tmp)
            print(f"[{a.stage or '自定义'}] 试{attempt} seed={seed} → {why}", flush=True)
            if ok:
                out.write_bytes(raw)
                tmp.unlink(missing_ok=True)
                print(f"  落盘: {out.name}", flush=True)
                kill = subprocess.run(["lsof", "-ti", ":17002"], capture_output=True, text=True).stdout.split()
                for p in kill:
                    subprocess.run(["kill", p], capture_output=True)
                sys.exit(0)
        except Exception as exc:
            print(f"[{a.stage or '自定义'}] 试{attempt} 异常: {exc}", flush=True)
    print("全部尝试未过——不落盘,旧图保留", flush=True)
    tmp.unlink(missing_ok=True)
    kill = subprocess.run(["lsof", "-ti", ":17002"], capture_output=True, text=True).stdout.split()
    for p in kill:
        subprocess.run(["kill", p], capture_output=True)
    sys.exit(1)


if __name__ == "__main__":
    main()
