#!/usr/bin/env python3
# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""my21fast-1026 实弹四案(序2 回环收口:MyQi21FastEncode v3 装载后真弹验收)。

复用已加固探针 my21fast_livefire_probe.py 的纪律件:fail-closed /prompt
200+node_errors 判败、平铺投弹体形检、multipart 上传覆写、history 轮询。

臂序(引擎在跑、每发前在驾门 queue 0/0;同参同种子 seed=424242):
  WU  暖身=官方TE t2i,负面=变体文本(破执行缓存;cfg=1 下负面不参与采样,
      出图应与 A 全等——白赚负面不变性验证)
  L1-A 官方TE t2i(TextEncodeQwenImage21)
  L1-B 新节点 t2i(MyQi21FastEncode)——与 A 逐位同参,判据=解码后像素级全等+耗时差
  L1-C 官方TE i2i(带参考图 01_人物海报,vae 接 VAELoaderKJ cpu/fp32,
      resolution=0,latent 用 TE latent 出口)
  L1-D 新节点 i2i——与 C 同法,判据同 A/B
  L2-t 手术后的 qwen21-道劫-t2i-api.json:注入提示词(节点400)+固定覆写
      seed 节点 value(7:7014=424242)后直发
  L2-i 手术后的 qwen21-道劫-i2i-api.json:同上注入+覆写,另将 LoadImage(10)
      指到上传参考图(portrait_model_denim.png 不在引擎 input,必须换)

采样形:SamplerCustom(cfg=1.0)+KSamplerSelect(euler)+BasicScheduler(simple,
steps=8)+denoise=1.0;t2i latent=EmptyLatentImage(1088,1440)(引擎
fix_empty_latent_channels 折半 → [1,64,90,68] → 出图 1088×1440)。
LoRA 链:qi21-mikkoani@0.8 → qwen_image_2.1_turbo_lora_avg_rank_178@1.0。

判据:
  L1 等值=PIL→np.array 逐元素全等(np.array_equal)+像素哈希(sha256 of
  tobytes)+最大绝对差;只取原始出图 SaveImage(前缀 QI21道劫*)。
  L2 =history 成功(status_str=success+completed+无 execution_error)+
  TE class_type=MyQi21FastEncode(发送图与 history 记录双验)+原始图过
  尺寸门(t2i 1088×1440;i2i 按参考图经产线 1MP 缩放公式推得)与不透明门
  (不透明像素占比≥0.95);超分 2K 臂(504)只验成功不参与等值。

纪律:失败先取 history execution_error 分类后重试一次,连败如实报;
每发播报耗时;产物只进 apps/output/my21fast_fire_1025。
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
APP = REPO / "apps"
PROBE = APP / "build/scripts/my21fast_livefire_probe.py"
T2I_API = APP / "backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json"
I2I_API = APP / "backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qwen21-道劫-i2i-api.json"
BASES_JSON = APP / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
# ask 所写 01_人物海报_重掷三锁版.png 在盘上不存在;同名目录唯一人物海报件=下件(1088×1456 RGB)
REF_SRC = APP / "output/moss-win-campaign-1025/images/14types/01_人物海报_14types_00001_.png"
REF_NAME = "my21fast_fire_ref_01_renwuhaibao.png"
OUT_DIR = APP / "output/my21fast_fire_1025"

SEED = 424242
STEPS = 8
CFG = 1.0
SAMPLER = "euler"
SCHEDULER = "simple"
W_T2I, H_T2I = 1088, 1440
UNET = "qwen_image_2.1_bf16.safetensors"
CLIP = "qwen3vl_8b_bf16_heretic.safetensors"
VAE = "texture_fix_vae_for_qwen_image_2.1_bf16.safetensors"
LORA_MIKKOANI = "qi21-mikkoani.safetensors"
LORA_TURBO = "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors"
CLIENT_ID = "my21fast-fire1026-fourcases"
POLL_INTERVAL = 3.0
ARM_TIMEOUT = 1800.0
QUEUE_WAIT_MAX = 900.0  # 在驾门:60s 复查至多 15 分钟


def _load_probe():
    spec = importlib.util.spec_from_file_location("my21fast_probe", PROBE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


PROBE_MOD = _load_probe()
_http_json = PROBE_MOD._http_json
_payload_shape_ok = PROBE_MOD._payload_shape_ok


def _now() -> str:
    return datetime.now().strftime("%H:%M:%S")


def log(msg: str) -> None:
    print(f"[{_now()}] {msg}", flush=True)


# ── 在驾门:queue_running==0 且 queue_pending==0 ─────────────────────
def queue_gate(base: str) -> None:
    t0 = time.time()
    while True:
        q = _http_json(f"{base}/queue", timeout=15)
        running = len(q.get("queue_running", []))
        pending = len(q.get("queue_pending", []))
        if running == 0 and pending == 0:
            return
        if time.time() - t0 > QUEUE_WAIT_MAX:
            raise SystemExit(f"[gate] 队列忙超 {QUEUE_WAIT_MAX}s({running}/{pending})——按纪律停手")
        log(f"[gate] 队列忙 running={running} pending={pending},60s 后复查")
        time.sleep(60)


# ── 参考图上传(multipart,同探针范式) ─────────────────────────────
def upload_ref(base: str) -> dict:
    from PIL import Image
    raw = REF_SRC.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    im = Image.open(io.BytesIO(raw))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    boundary = "----my21fastfire1026"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{REF_NAME}\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + buf.getvalue() + \
           (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\ninput\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(f"{base}/upload/image", data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.load(resp)
    assert payload.get("name") == REF_NAME, f"上传回名不符: {payload}"
    rec = {"source": str(REF_SRC.relative_to(REPO)), "uploaded_as": REF_NAME,
           "sha256": sha, "size_px": list(im.size), "mode": im.mode,
           "note": "ask 所写 01_人物海报_重掷三锁版.png 不在盘;取同目录唯一人物海报件"}
    log(f"[ref] 上传完成 {rec['size_px']} {rec['mode']} sha256={sha[:16]}…")
    return rec


# ── L1 受控图构造(唯一变量=TE 类) ─────────────────────────────────
def _l1_loaders(family: str) -> dict:
    vae_node = ({"class_type": "VAELoaderKJ",
                 "inputs": {"vae_name": VAE, "device": "cpu", "weight_dtype": "fp32"}}
                if family == "i2i" else
                {"class_type": "VAELoader", "inputs": {"vae_name": VAE}})
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": UNET, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": CLIP, "type": "qwen_image", "device": "default"}},
        "3": vae_node,
        "100": {"class_type": "LoraLoaderModelOnly",
                "inputs": {"lora_name": LORA_MIKKOANI, "strength_model": 0.8, "model": ["1", 0]}},
        "101": {"class_type": "LoraLoaderModelOnly",
                "inputs": {"lora_name": LORA_TURBO, "strength_model": 1.0, "model": ["100", 0]}},
    }


def build_l1(family: str, te_class: str, prefix: str, prompt: str, negative: str) -> dict:
    g = _l1_loaders(family)
    if family == "t2i":
        g["200"] = {"class_type": te_class,
                    "inputs": {"clip": ["2", 0], "prompt": prompt,
                               "negative_prompt": negative, "resolution": 1024}}
        g["300"] = {"class_type": "EmptyLatentImage",
                    "inputs": {"width": W_T2I, "height": H_T2I, "batch_size": 1}}
        latent_src = ["300", 0]
    else:
        g["200"] = {"class_type": te_class,
                    "inputs": {"clip": ["2", 0], "prompt": prompt,
                               "negative_prompt": negative, "resolution": 0,
                               "vae": ["3", 0], "images.image_1": ["300", 0]}}
        g["300"] = {"class_type": "LoadImage", "inputs": {"image": REF_NAME}}
        latent_src = ["200", 2]  # latent 用 TE latent 出口
    g["410"] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": SAMPLER}}
    g["420"] = {"class_type": "BasicScheduler",
                "inputs": {"model": ["101", 0], "scheduler": SCHEDULER, "steps": STEPS, "denoise": 1.0}}
    g["430"] = {"class_type": "SamplerCustom",
                "inputs": {"model": ["101", 0], "add_noise": True, "noise_seed": SEED, "cfg": CFG,
                           "positive": ["200", 0], "negative": ["200", 1],
                           "sampler": ["410", 0], "sigmas": ["420", 0], "latent_image": latent_src}}
    g["440"] = {"class_type": "VAEDecode", "inputs": {"samples": ["430", 0], "vae": ["3", 0]}}
    g["450"] = {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["440", 0]}}
    return g


# ── L2 产线直发图(注入提示词+seed 覆写;i2i 另换 LoadImage) ────────
def build_l2(family: str, prompt: str) -> dict:
    path = T2I_API if family == "t2i" else I2I_API
    graph = json.loads(path.read_text(encoding="utf-8"))["graph"]
    graph["400"]["inputs"]["value"] = prompt          # 注入提示词(主体句/原始指令槽)
    graph["7:7014"]["inputs"]["value"] = SEED         # 固定覆写 seed 节点 value
    if family == "i2i":
        graph["10"]["inputs"]["image"] = REF_NAME     # portrait_model_denim.png 不在引擎 input
    return graph


# ── 发送+轮询+取图(fail-closed;失败分类重试一次) ──────────────────
def _history_error(hist: dict) -> dict | None:
    for m in hist.get("status", {}).get("messages", []):
        mtype = m.get("type") if isinstance(m, dict) else (m[0] if isinstance(m, (list, tuple)) else None)
        if mtype in ("execution_error", "execution_interrupted", "validation_error"):
            data = m.get("data", m) if isinstance(m, dict) else (m[1] if len(m) > 1 else {})
            return {"type": mtype, "data": data}
    return None


def _send_once(base: str, arm: str, graph: dict) -> dict:
    shape_problems = _payload_shape_ok(graph)
    assert not shape_problems, f"{arm} 投弹体形坏: {shape_problems}"
    queue_gate(base)
    t0 = time.time()
    accepted = _http_json(f"{base}/prompt", timeout=120,
                          data={"prompt": graph, "client_id": CLIENT_ID})
    node_errors = accepted.get("node_errors") or {}
    if node_errors:
        raise RuntimeError(f"{arm} 引擎校验败(200+node_errors,拒实弹): "
                           f"{json.dumps(node_errors, ensure_ascii=False)[:600]}")
    prompt_id = accepted["prompt_id"]
    while True:
        hist = _http_json(f"{base}/history/{prompt_id}", timeout=30).get(prompt_id)
        if hist:
            break
        if time.time() - t0 > ARM_TIMEOUT:
            raise RuntimeError(f"{arm} 轮询超时 {ARM_TIMEOUT}s")
        time.sleep(POLL_INTERVAL)
    elapsed = round(time.time() - t0, 1)
    status = hist.get("status", {})
    err = _history_error(hist)
    ok = (status.get("status_str") == "success" and status.get("completed") and err is None)
    rec = {"arm": arm, "prompt_id": prompt_id, "elapsed_s": elapsed,
           "status_str": status.get("status_str"), "completed": status.get("completed"),
           "execution_error": err, "ok": ok, "history_status": status}
    log(f"[{arm}] 耗时 {elapsed}s status={rec['status_str']} completed={rec['completed']} "
        f"err={'无' if err is None else err['type']}")
    return rec


def send_arm(base: str, arm: str, graph: dict, images_dir: Path) -> dict:
    """发一臂:失败先取 execution_error 分类,重试恰一次,连败如实报。"""
    rec = None
    for attempt in (1, 2):
        try:
            rec = _send_once(base, arm, graph)
            rec["attempts"] = attempt
            if rec["ok"]:
                break
        except Exception as exc:  # noqa: BLE001
            log(f"[{arm}] 第{attempt}发异常: {exc}")
            rec = {"arm": arm, "ok": False, "exception": str(exc)[:800], "attempts": attempt,
                   "elapsed_s": None}
        if not rec.get("ok"):
            if rec.get("execution_error"):
                log(f"[{arm}] 失败分类: {json.dumps(rec['execution_error'], ensure_ascii=False)[:500]}")
            elif rec.get("exception"):
                pass
            if attempt == 1:
                log(f"[{arm}] 按纪律重试一次")
                time.sleep(5)
    # 取原始出图 SaveImage(前缀 QI21道劫*;MYStudio-2K 只验成功)
    if rec.get("ok"):
        hist = _http_json(f"{base}/history/{rec['prompt_id']}", timeout=30)[rec["prompt_id"]]
        outputs = hist.get("outputs", {})
        raw_files, two_k = [], None
        for key, node in sorted(graph.items()):
            if node.get("class_type") != "SaveImage":
                continue
            prefix = node.get("inputs", {}).get("filename_prefix", "")
            imgs = outputs.get(key, {}).get("images", [])
            if prefix.startswith("QI21道劫"):
                raw_files += [(prefix, i) for i in imgs]
            elif prefix.startswith("MYStudio-2K"):
                two_k = bool(imgs)
        rec["raw_images"], rec["upscale_2k_ok"] = [], two_k
        for prefix, img in raw_files:
            saved = _download(base, img, images_dir / f"{arm}__{img['filename']}")
            rec["raw_images"].append({"engine_filename": img["filename"], "prefix": prefix,
                                      "saved": str(saved.relative_to(OUT_DIR))})
    return rec


def _download(base: str, img: dict, dest: Path) -> Path:
    qs = urllib.parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""),
                                 "type": img.get("type", "output")})
    with urllib.request.urlopen(f"{base}/view?{qs}", timeout=120) as resp:
        data = resp.read()
    dest.write_bytes(data)
    return dest


# ── 像素级等值对拍 ────────────────────────────────────────────────
def pixel_compare(name: str, path_a: Path, path_b: Path) -> dict:
    import numpy as np
    from PIL import Image
    a = np.array(Image.open(path_a))
    b = np.array(Image.open(path_b))
    ha = hashlib.sha256(a.tobytes()).hexdigest()
    hb = hashlib.sha256(b.tobytes()).hexdigest()
    out = {"pair": name, "shape_a": list(a.shape), "shape_b": list(b.shape),
           "pixel_hash_a": ha, "pixel_hash_b": hb,
           "shape_equal": a.shape == b.shape, "equal": False}
    if a.shape == b.shape:
        out["equal"] = bool(np.array_equal(a, b))
        out["max_abs_diff"] = int(np.abs(a.astype(int) - b.astype(int)).max())
        out["diff_pixels"] = int((a != b).any(axis=-1).sum()) if a.ndim == 3 else int((a != b).sum())
    return out


def img_stats(path: Path) -> dict:
    import numpy as np
    from PIL import Image
    im = Image.open(path)
    arr = np.array(im)
    alpha = arr[..., 3] if arr.ndim == 3 and arr.shape[-1] == 4 else None
    return {"size": list(im.size), "mode": im.mode,
            "opaque_fraction": round(float((alpha == 255).mean()), 6) if alpha is not None else 1.0,
            "alpha_min": int(alpha.min()) if alpha is not None else 255}


def scale_1mp(w: int, h: int, megapixels: float = 1.0, steps: int = 32) -> tuple[int, int]:
    """引擎 ImageScaleToTotalPixels 同式(nodes_post_processing.py:249-255)。"""
    import math
    total = megapixels * 1024 * 1024
    scale_by = math.sqrt(total / (w * h))
    return (round(w * scale_by / steps) * steps, round(h * scale_by / steps) * steps)


def te_ref_latent_size(w: int, h: int) -> tuple[int, int]:
    """TE resolution=0:宽高各自取 32 倍数(nodes_qwen.py 同式)。"""
    return (round(w / 32) * 32, round(h / 32) * 32)


# ── 主流程 ────────────────────────────────────────────────────────
def main() -> int:
    (OUT_DIR / "images").mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "graphs").mkdir(parents=True, exist_ok=True)
    images_dir = OUT_DIR / "images"

    # 引擎=manifest 现查 + ask 钉 17001
    base = PROBE_MOD._engine_base()
    assert base.endswith(":17001"), f"manifest 端口非 17001: {base}"
    stats = _http_json(f"{base}/system_stats", timeout=10)
    log(f"[engine] {base} 在跑 ComfyUI {stats.get('system', {}).get('comfyui_version', '?')}")

    # 提示词=qi21_bases.json 人物海报型文+风格底座(装配节点同款换行拼)
    bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))
    t0 = next(t for t in bases["types"] if t["zh"] == "人物海报")
    style = bases["art_style_base"]
    prompt_pos = t0["positive_text"] + "\n" + style["positive_text"]
    prompt_neg = t0["negative_text"] + "，" + style["negative_text"]
    warmup_neg = prompt_neg + "(暖身变体,破缓存用)"
    (OUT_DIR / "prompts.json").write_text(
        json.dumps({"prompt_positive": prompt_pos, "prompt_negative": prompt_neg,
                    "warmup_negative": warmup_neg,
                    "lens": {"pos": len(prompt_pos), "neg": len(prompt_neg), "wu_neg": len(warmup_neg)}},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"[prompt] 正向 {len(prompt_pos)}ch 负向 {len(prompt_neg)}ch(人物海报型文+风格底座)")

    ref = upload_ref(base)
    (OUT_DIR / "ref_image.json").write_text(json.dumps(ref, ensure_ascii=False, indent=1), encoding="utf-8")

    # 期望画幅推算
    rw, rh = ref["size_px"]
    i2i_l1_wh = te_ref_latent_size(rw, rh)
    i2i_l2_wh = te_ref_latent_size(*scale_1mp(rw, rh))
    log(f"[canvas] L1-t2i={W_T2I}×{H_T2I}(EmptyLatent 折半) L1-i2i={i2i_l1_wh[0]}×{i2i_l1_wh[1]}"
        f"(参考图 res=0 取整) L2-i2i={i2i_l2_wh[0]}×{i2i_l2_wh[1]}(产线 1MP 缩放后)")

    graphs = {
        "WU": build_l1("t2i", "TextEncodeQwenImage21", "QI21道劫文生图_L1W", prompt_pos, warmup_neg),
        "L1A": build_l1("t2i", "TextEncodeQwenImage21", "QI21道劫文生图_L1A", prompt_pos, prompt_neg),
        "L1B": build_l1("t2i", "MyQi21FastEncode", "QI21道劫文生图_L1B", prompt_pos, prompt_neg),
        "L1C": build_l1("i2i", "TextEncodeQwenImage21", "QI21道劫图生图_L1C", prompt_pos, prompt_neg),
        "L1D": build_l1("i2i", "MyQi21FastEncode", "QI21道劫图生图_L1D", prompt_pos, prompt_neg),
        "L2T": build_l2("t2i", prompt_pos),
        "L2I": build_l2("i2i", prompt_pos),
    }
    for arm, g in graphs.items():
        (OUT_DIR / "graphs" / f"{arm}.json").write_text(json.dumps(g, ensure_ascii=False, indent=1), encoding="utf-8")

    order = ["WU", "L1A", "L1B", "L1C", "L1D", "L2T", "L2I"]
    results = {}
    for arm in order:
        log(f"[send] {arm} 开投(class={graphs[arm]['200']['class_type'] if arm.startswith('L1') else '产线图'})")
        results[arm] = send_arm(base, arm, graphs[arm], images_dir)

    # ── L1 等值对拍(只取原始出图) ──
    equality = {}
    def _first_img(arm):
        r = results[arm]
        if r.get("raw_images"):
            return images_dir / Path(r["raw_images"][0]["saved"]).name
        return None

    for pair_name, a_arm, b_arm in (("L1-A_vs_L1-B_t2i", "L1A", "L1B"),
                                    ("L1-C_vs_L1-D_i2i", "L1C", "L1D"),
                                    ("bonus_WU_vs_L1A_负面不变性", "WU", "L1A")):
        pa, pb = _first_img(a_arm), _first_img(b_arm)
        if pa and pb and pa.exists() and pb.exists():
            equality[pair_name] = pixel_compare(pair_name, pa, pb)
            equality[pair_name]["image_a"] = pa.name
            equality[pair_name]["image_b"] = pb.name
            log(f"[equal] {pair_name}: equal={equality[pair_name]['equal']} "
                f"hash_a={equality[pair_name]['pixel_hash_a'][:12]} hash_b={equality[pair_name]['pixel_hash_b'][:12]}")
        else:
            equality[pair_name] = {"pair": pair_name, "skipped": f"缺图({a_arm}={'有' if pa else '无'},{b_arm}={'有' if pb else '无'})"}

    # ── 图像统计+L2 门禁 ──
    img_stat = {arm: (img_stats(_first_img(arm)) if _first_img(arm) and _first_img(arm).exists() else None)
                for arm in order}
    l2_gates = {}
    for arm, te_keys, want_wh in (("L2T", ["4015"], (W_T2I, H_T2I)), ("L2I", ["171", "4015"], tuple(i2i_l2_wh))):
        r = results[arm]
        if not r.get("ok"):
            l2_gates[arm] = {"history_success": False, "note": "连败或未完成"}
            continue
        hist = _http_json(f"{base}/history/{r['prompt_id']}", timeout=30)[r["prompt_id"]]
        exec_graph = hist.get("prompt", {})
        te_sent = {k: graphs[arm][k]["class_type"] for k in te_keys}
        te_hist = {k: (exec_graph.get(k, {}) or {}).get("class_type") for k in te_keys}
        st = img_stat[arm] or {}
        l2_gates[arm] = {
            "history_success": True,
            "te_class_sent": te_sent, "te_class_history": te_hist,
            "te_class_ok": all(v == "MyQi21FastEncode" for v in list(te_sent.values()) + list(te_hist.values())),
            "expected_wh": list(want_wh),
            "actual_wh": st.get("size"),
            "size_gate": st.get("size") == list(want_wh),
            "opaque_fraction": st.get("opaque_fraction"),
            "opacity_gate": (st.get("opaque_fraction", 0) or 0) >= 0.95,
            "upscale_2k_success_only": r.get("upscale_2k_ok"),
        }
        log(f"[l2gate] {arm}: {json.dumps(l2_gates[arm], ensure_ascii=False)}")

    report = {
        "meta": {"engine": base, "seed": SEED, "steps": STEPS, "cfg": CFG,
                 "sampler": SAMPLER, "scheduler": SCHEDULER, "client_id": CLIENT_ID,
                 "models": {"unet": UNET, "clip": CLIP, "vae": VAE},
                 "lora_chain": [f"{LORA_MIKKOANI}@0.8", f"{LORA_TURBO}@1.0"],
                 "canvas": {"l1_t2i": [W_T2I, H_T2I], "l1_i2i": list(i2i_l1_wh), "l2_i2i": list(i2i_l2_wh)},
                 "ref": ref, "generated_at": datetime.now().isoformat()},
        "arms": results, "image_stats": img_stat, "equality": equality, "l2_gates": l2_gates,
    }
    (OUT_DIR / "fire_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"[done] 报告落 {OUT_DIR / 'fire_report.json'}")

    # 摘要
    print("\n===== 实弹四案摘要 =====", flush=True)
    for arm in order:
        r = results[arm]
        print(f"{arm}: ok={r.get('ok')} elapsed={r.get('elapsed_s')}s attempts={r.get('attempts')}", flush=True)
    for k, v in equality.items():
        print(f"等值 {k}: equal={v.get('equal')} max_diff={v.get('max_abs_diff')} "
              f"diff_px={v.get('diff_pixels')}", flush=True)
    for k, v in l2_gates.items():
        print(f"L2门 {k}: {json.dumps({kk: v.get(kk) for kk in ('history_success', 'te_class_ok', 'size_gate', 'opacity_gate', 'upscale_2k_success_only')}, ensure_ascii=False)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
