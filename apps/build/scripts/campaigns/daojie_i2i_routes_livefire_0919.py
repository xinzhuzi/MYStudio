#!/usr/bin/env python3
"""九型配方 i2i 两辅路实弹(09-19 R3;每辅路 denoise 0.35/0.25 A/B 一轮)。

对象=daojie_i2i_routes_0919.py 落的两条小流(UI→API 直排,盘上工作流零改动):
  人脸精修  K2-人脸精修-道劫.json:人物图(九型实弹·配方版「人物」输出)→
            YuNet 裁脸→1.0MP→denoise A/B {0.35, 0.25};
  表情差分  K2-表情差分-道劫.json:人脸基准图(九型实弹·配方版「高清人脸」输出)
            →1.0MP→denoise A/B {0.25, 0.35}(起步 0.25,对拍 0.35)。
seed=42;步数 12(质量档);[80]=高清人脸(其 LoRA 组与表情差分型同三件);
[90] preset=跟随底座型+[80].base 联动(与 t2i 主链同机制)。

防呆:YuNet 裁脸零检出=WAS 返黑帧(源码 image_crop_face_yunet.py L22/L152-166),
以输出图均值 <8 判黑帧并降 confidence 0.6→0.45 重试一轮,如实记台账。
图双落 ~/Downloads/daojie_i2i_routes_0919/ 与仓库
docs/prompts/道劫_九型实弹_配方版_0919/i2i/;runs_audit.json 台账。
用法:python3 apps/build/scripts/daojie_i2i_routes_livefire_0919.py [--base-url …]
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_livefire_0917 as lf  # noqa: E402
from daojie_livefire_0917 import http_bytes, http_json, ui_to_api  # noqa: E402

lf.SKIP_NODES = {20, 75}  # 20 种子 UI 件内联;75 YuNet 加载器零输入件转换器拒空,手工补节点
lf.UI_ONLY_WIDGETS = lf.UI_ONLY_WIDGETS | {"upload"}  # LoadImage 上传件纯 UI(0917 转换器补丁)

WF_FACE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/2_图生图"
           / "K2-人脸精修-道劫.json")
WF_EXPR = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/2_图生图"
           / "K2-表情差分-道劫.json")
STACK_JSON = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json"
NINE_DL = Path.home() / "Downloads" / "daojie_nineform_recipe_0919"
DOWNLOADS = Path.home() / "Downloads" / "daojie_i2i_routes_0919"
WS_DIR = REPO / "docs/prompts/道劫_九型实弹_配方版_0919" / "i2i"
CLIENT_ID = "daojie-i2i-routes-0919"
SEED = 42
EXEC_TIMEOUT_S = 600
IDLE_WAIT_MAX_S = 600
POLL_S = 4
EXPECTED_BASE = "高清人脸"  # 两辅路 [80] 均为高清人脸型(单脸内容基准)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def upload_image(base: str, path: Path) -> str:
    """POST /upload/image(multipart);返回引擎侧文件名(input 目录)。"""
    boundary = uuid.uuid4().hex
    body = io.BytesIO()
    body.write(f"--{boundary}\r\n".encode())
    body.write(
        f'Content-Disposition: form-data; name="image"; filename="{path.name}"\r\n'
        .encode())
    body.write(b"Content-Type: image/png\r\n\r\n")
    body.write(path.read_bytes())
    body.write(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        f"{base}/upload/image", data=body.getvalue(), method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read().decode())
    name = resp.get("name")
    assert name, f"上传失败:{resp}"
    return name


def png_mean(b: bytes) -> float:
    """输出图均值(黑帧判定;PIL 解码)。"""
    from PIL import Image
    with Image.open(io.BytesIO(b)) as im:
        return sum(im.convert("L").getdata()) / (im.width * im.height)


def wait_idle(base: str) -> bool:
    t0 = time.time()
    while time.time() - t0 < IDLE_WAIT_MAX_S:
        q = http_json(f"{base}/queue", timeout=10)
        if not q.get("queue_running") and not q.get("queue_pending"):
            return True
        time.sleep(5)
    return False


def wait_done(base: str, pid: str) -> tuple[dict | None, float]:
    t0 = time.time()
    while time.time() - t0 < EXEC_TIMEOUT_S:
        hist = http_json(f"{base}/history/{pid}", timeout=20)
        if pid in hist:
            return hist[pid], round(time.time() - t0, 1)
        time.sleep(POLL_S)
    return None, round(time.time() - t0, 1)


def first_image(entry: dict) -> dict | None:
    for _nid, out in (entry.get("outputs") or {}).items():
        for imgs in (out or {}).values():
            if isinstance(imgs, list):
                for x in imgs:
                    if isinstance(x, dict) and "filename" in x:
                        return x
    return None


def node_output_text(entry: dict, nid: str) -> str | None:
    out = (entry.get("outputs") or {}).get(nid) or {}
    texts = out.get("text") or []
    if isinstance(texts, list) and texts and isinstance(texts[0], str):
        return texts[0]
    return None


def expected_applied(zh: str, slots: list) -> str:
    plan = [(Path(s["file"]).stem, s["presets"][zh]["weight"])
            for s in slots if s["presets"][zh]["on"]]
    total = len([s for s in slots if s.get("file")])
    return (f"跟随底座型·{zh}({len(plan)}/{total}):"
            + " + ".join(f"{stem}×{w:g}" for stem, w in plan))


def run_once(base: str, wf: dict, oi: dict, image_name: str, denoise: float,
             confidence: float | None, want_applied: str) -> dict:
    rec: dict = {"ran": False, "denoise": denoise}
    if confidence is not None:
        rec["confidence"] = confidence
    wf = json.loads(json.dumps(wf))
    for n in wf["nodes"]:  # LoadImage 上传件值('image')不占 API 输入序,内存剥除
        if n["type"] == "LoadImage" and len(n.get("widgets_values") or []) > 1:
            n["widgets_values"] = n["widgets_values"][:1]
    for n in wf["nodes"]:  # 裁脸器:模型线源(75)被跳过,内存以 named 锚回接(API 连线形态)
        if n["id"] == 76:
            conf = confidence if confidence is not None else n["widgets_values"][1]
            n["widgets_values_named"] = {
                "yunet_model": ["75", 0],
                "crop_padding_factor": n["widgets_values"][0],
                "confidence": conf,
                "select": n["widgets_values"][2]}
    overrides = {"7.image": image_name, "12.seed": SEED, "12.denoise": denoise}
    graph = ui_to_api(wf, oi, overrides)
    graph["80"]["inputs"].pop("negative", None)  # 0919 惯例:可选槽未连线弹出(位置回退残值)
    if "75" not in graph:  # WASYuNetModelLoader 零输入件,转换器拒空映射→手工补(API 合法)
        graph["75"] = {"class_type": "WASYuNetModelLoader", "inputs": {}}
    rec["key_inputs"] = {
        "seed": graph["12"]["inputs"]["seed"], "steps": graph["12"]["inputs"]["steps"],
        "cfg": graph["12"]["inputs"]["cfg"], "denoise": graph["12"]["inputs"]["denoise"],
        "image": graph["7"]["inputs"]["image"], "base": graph["80"]["inputs"]["base"],
        "preset": graph["90"]["inputs"]["preset"],
        "90.base_link": graph["90"]["inputs"].get("base"),
    }
    if not wait_idle(base):
        rec["skip_reason"] = f"引擎忙(>{IDLE_WAIT_MAX_S}s)"
        return rec
    try:
        resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID},
                         timeout=60)
        if resp.get("node_errors"):
            rec.update(skip_reason="node_errors",
                       detail=json.dumps(resp["node_errors"], ensure_ascii=False)[:800])
            return rec
        pid = resp["prompt_id"]
        rec["prompt_id"] = pid
        entry, wall = wait_done(base, pid)
        rec["wall_s"] = wall
        status = (entry or {}).get("status", {})
        if entry is None:
            rec["skip_reason"] = f"超时(>{EXEC_TIMEOUT_S}s)"
            return rec
        if status.get("status_str") != "success":
            errs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
            rec.update(skip_reason="execution_failed", detail=errs[:1])
            return rec
        applied = node_output_text(entry, "86")
        rec["applied_90_actual"] = applied
        rec["applied_90_ok"] = bool(applied and applied == want_applied)
        image = first_image(entry)
        if image is None:
            rec["skip_reason"] = "history 无图片输出"
            return rec
        q = (f"filename={urllib.parse.quote(image['filename'])}"
             f"&subfolder={urllib.parse.quote(image.get('subfolder', ''))}"
             f"&type=output")
        png = http_bytes(f"{base}/view?{q}")
        rec.update(ran=True, bytes=len(png), sha256=sha256_bytes(png),
                   engine_image=image["filename"], png_mean=round(png_mean(png), 2))
        rec["_png"] = png
        return rec
    except Exception as exc:
        rec.update(skip_reason=f"异常:{type(exc).__name__}", detail=str(exc)[:300])
        return rec


def settle(rec: dict, name: str) -> dict:
    rec["name"] = name
    png = rec.pop("_png", None)
    if png is not None:
        fname = f"{name}.png"
        dl, ws = DOWNLOADS / fname, WS_DIR / fname
        dl.write_bytes(png)
        shutil.copyfile(dl, ws)
        rec.update(output=str(dl), ws_copy=str(ws))
    return rec


def main() -> int:
    ap = argparse.ArgumentParser(description="i2i 两辅路实弹 A/B")
    ap.add_argument("--base-url", default="http://127.0.0.1:17000")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    src_char = NINE_DL / "人物.png"
    src_face = NINE_DL / "高清人脸.png"
    for p in (src_char, src_face):
        if not p.is_file():
            print(f"✗ 前置缺图:{p}(先跑 daojie_nineform_recipe_livefire_0919.py)",
                  file=sys.stderr)
            return 2
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    WS_DIR.mkdir(parents=True, exist_ok=True)

    slots = json.loads(STACK_JSON.read_text(encoding="utf-8"))
    want_applied = expected_applied(EXPECTED_BASE, slots)
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop(
        "preview", None)
    up_char = upload_image(base, src_char)
    up_face = upload_image(base, src_face)
    print(f"[i2i] 上传:人物图={up_char} 人脸图={up_face}", flush=True)

    results = []
    # ── 人脸精修:A=0.35(起步) B=0.25;黑帧(YuNet 零检出)降 confidence 重试 ──
    wf_face = json.loads(WF_FACE.read_text(encoding="utf-8"))
    for tag, dn in (("face_refine_A_dn035", 0.35), ("face_refine_B_dn025", 0.25)):
        rec = run_once(base, wf_face, oi, up_char, dn, None, want_applied)
        if rec.get("ran") and rec.get("png_mean", 255) < 8:
            rec["black_frame_retry"] = "YuNet 零检出黑帧,降 confidence 0.45 重试"
            print(f"[i2i] {tag} 黑帧(均值 {rec['png_mean']}),降 confidence 重试", flush=True)
            rec2 = run_once(base, wf_face, oi, up_char, dn, 0.45, want_applied)
            rec2["black_frame_first_attempt_mean"] = rec["png_mean"]
            rec = rec2
        results.append(settle(rec, tag))
        print(f"[i2i] {tag} {'OK' if rec.get('ran') else rec.get('skip_reason')}"
              f" wall={rec.get('wall_s')}s mean={rec.get('png_mean')}", flush=True)

    # ── 表情差分:A=0.25(起步) B=0.35(对拍) ──
    wf_expr = json.loads(WF_EXPR.read_text(encoding="utf-8"))
    for tag, dn in (("expr_variant_A_dn025", 0.25), ("expr_variant_B_dn035", 0.35)):
        rec = run_once(base, wf_expr, oi, up_face, dn, None, want_applied)
        results.append(settle(rec, tag))
        print(f"[i2i] {tag} {'OK' if rec.get('ran') else rec.get('skip_reason')}"
              f" wall={rec.get('wall_s')}s mean={rec.get('png_mean')}", flush=True)

    ok = [r for r in results if r.get("ran")]
    report = {
        "status": "done",
        "task": "九型配方 i2i 两辅路实弹 A/B(09-19 R3)",
        "interpretations": {
            "人脸精修": "输入=九型实弹·配方版「人物」输出(1816×2424);YuNet 裁脸"
                        "padding0.9→1.0MP→KSampler;denoise A=0.35(起步)/B=0.25",
            "表情差分": "输入=九型实弹·配方版「高清人脸」输出(1024²);denoise "
                        "A=0.25(起步)/B=0.35(对拍);情绪轴主体句=默认",
            "两路 [80]": "均为高清人脸型(单脸内容基准;LoRA 组与表情差分型同三件)",
            "黑帧防呆": "YuNet 零检出=WAS 黑帧(源码 L152-166),均值<8 判定并降 "
                        "confidence 0.45 重试一轮",
            "终审": "图只产不评,审美终审=用户",
        },
        "common": {"seed": SEED, "steps": 12, "cfg": 1,
                   "expected_applied_90": want_applied,
                   "input_char": str(src_char), "input_face": str(src_face)},
        "runs": results, "runs_total": len(results), "ok_count": len(ok),
    }
    (WS_DIR / "runs_audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"runs_total": len(results), "ok_count": len(ok)}))
    return 0 if len(ok) == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
