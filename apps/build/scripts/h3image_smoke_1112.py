#!/usr/bin/env python3
"""h3image_smoke_1112.py — MiniMax H3-Image Win 引擎实弹测试(1112 用户令:测试三遍才结束)。

主机适配(1112 用户令「适配 Windows 主机/显卡,找最合适的模型下载」):
  DiT  = minimax_h3_image_pruned_int8_convrot(21G,官方推荐档,24G 卡可容)
  TE   = qwen3vl_32b_minimax_h3_nvfp4_awq(复用 H3 视频线在役件,Blackwell 原生 FP4,
         省 27G 下载;Comfy-Org H3-Image 仓同件在列=受支持变体,已核进 CLIPLoader 名单)
  PE   = qwen3.5_9b_w4a8_gptq(官方轻量扩写器)
  VAE  = minimax_h3_image_vae_fp16

schema 真源=0.45.2 引擎 object_info(1112 现场核对,非官方 JSON 槽序猜测):
  MiniMaxH3ImageConditioning: required clip/prompt/width/height;optional vae/images
    (width=0/height=0=随 image_1;VAE 接通=参考图 latent 锚定)
  TextGenerateV2: required clip/prompt/max_length;optional system_prompt/images/thinking
每遍 = 1×t2i(seed 逐遍换,锚跨画风)+1×edit(同遍 t2i 产物作 images 槽,指令编辑,
PE 扩写链按官方 edit 模板挂载——PE 链验证 400 时自动退直投并记档)。
产物落 apps/output/h3image-smoke-1112/。

用法:python3 h3image_smoke_1112.py --pass 1|2|3|all  [--no-edit] [--no-pe]
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ENGINE = "http://192.168.0.101:17000"
OUT_DIR = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/h3image-smoke-1112")

DIT = "minimax_h3_image_pruned_int8_convrot.safetensors"
TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"  # 主机适配:盘上在役件
PE = "qwen3.5_9b_w4a8_gptq.safetensors"
VAE = "minimax_h3_image_vae_fp16.safetensors"

SEEDS = {1: 11, 2: 31, 3: 47}  # AIMixer 三遍口径

# 每遍 t2i 锚(跨画风;宽高全 32 对齐)
T2I_ANCHORS = {
    1: ("4K photo, cinematic still: a scarred young swordsman in ink-wash style "
        "wuxia world stands on a cliff at dawn, torn white robes fluttering, a "
        "closed scabbard on his back, sea of clouds below, dramatic rim light, "
        "rich detail, natural film grain", 2048, 2048),
    2: ("Anime key visual: a girl with silver twin-tails in a futuristic night "
        "market, neon signs in Chinese characters reflecting on wet pavement, "
        "she holds a paper lantern, cel shading with painterly background, "
        "vivid colors", 2304, 1280),  # 16:9 32对齐
    3: ("Studio product photograph of a celadon tea set on dark walnut wood, "
        "soft window light, shallow depth of field, steam rising from the cup, "
        "ultra detailed ceramic glaze texture", 2048, 2048),
}

# edit 指令(images = 同遍 t2i 产物;跨能力:换主体/加物/改氛围)
EDIT_INSTRUCTIONS = {
    1: "Change the swordsman's torn white robes into ornate black-and-gold "
       "armor. Keep his pose, face, the cliff and the dawn clouds unchanged.",
    2: "Add a fluffy white cat sitting beside the girl, looking up at her "
       "lantern. Keep everything else identical.",
    3: "Replace the ceramic teapot with a glass teapot filled with amber tea. "
       "Keep the composition and lighting unchanged.",
}

# 官方 PE system/user 模板:运行时从官方 edit 件直抽全文(零转写误差,
# [36]=system JSON 契约、[39]=user 扩写模板含 {input text} 占位)
REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
OFFICIAL_EDIT = (REPO / "apps/backend/comfyui/workflows/1_图片/MiniMax/"
                 "官方-H3图像-图像编辑.json")


def pe_templates():
    d = json.loads(OFFICIAL_EDIT.read_text(encoding="utf-8"))
    texts = {n["id"]: (n.get("widgets_values") or [""])[0]
             for n in d["nodes"] if n["type"] == "PrimitiveStringMultiline"}
    return texts[36], texts[39]  # (system, user 模板)


def pe_user_prompt(instruction):
    _, template = pe_templates()
    return template.replace("{input text}", instruction)


def http_json(url, timeout=15):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def obj_info(cls):
    return http_json(f"{ENGINE}/object_info/{urllib.parse.quote(cls)}", timeout=20)[cls]


def check_inputs(cls, expected):
    """expected: {输入名: 'required'|'optional'};不符打印真源 schema 并退出 2。"""
    spec = obj_info(cls)
    req = list((spec["input"].get("required") or {}).keys())
    opt = list((spec["input"].get("optional") or {}).keys())
    for name, kind in expected.items():
        where = "required" if name in req else ("optional" if name in opt else None)
        if where != kind:
            print(f"[FAIL] {cls} 输入名核对不符:{name} 期望 {kind},"
                  f"实际 required={req} optional={opt}")
            sys.exit(2)


def post_prompt(api):
    body = json.dumps({"prompt": api, "client_id": "h3image-smoke-1112"}).encode()
    req = urllib.request.Request(f"{ENGINE}/prompt", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def wait_done(pid, deadline_s=3600):
    t0 = time.time()
    while time.time() - t0 < deadline_s:
        try:
            h = http_json(f"{ENGINE}/history/{pid}", timeout=20)
        except Exception:
            time.sleep(5)
            continue
        if pid in h:
            entry = h[pid]
            status = entry.get("status", {})
            if status.get("completed"):
                return entry, time.time() - t0
            if status.get("status_str") == "error":
                print(f"[FAIL] 执行错误:{json.dumps(status, ensure_ascii=False)[:600]}")
                for mid, m in (status.get("messages") or []):
                    if mid == "execution_error":
                        print("  execution_error:",
                              json.dumps(m, ensure_ascii=False)[:800])
                sys.exit(3)
        time.sleep(6)
    print(f"[FAIL] 超时 {deadline_s}s")
    sys.exit(4)


def fetch_images(entry, tag):
    outs = []
    for node_out in entry.get("outputs", {}).values():
        for img in node_out.get("images", []):
            if img.get("type") == "output":
                url = (f"{ENGINE}/view?filename={urllib.parse.quote(img['filename'])}"
                       f"&subfolder={urllib.parse.quote(img.get('subfolder', ''))}"
                       f"&type=output")
                dst = OUT_DIR / f"{tag}__{img['filename']}"
                urllib.request.urlretrieve(url, dst)
                outs.append(dst)
    return outs


def upload_image(path):
    """上传编辑底图到引擎 input/(multipart)。"""
    boundary = "----h3smoke1112"
    fn = f"h3smoke_{path.name}"
    body = b""
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\""
             f"\r\n\r\ntrue\r\n").encode()
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; "
             f"filename=\"{fn}\"\r\nContent-Type: image/png\r\n\r\n").encode()
    body += path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{ENGINE}/upload/image", data=body,
                                 headers={"Content-Type":
                                          f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read().decode("utf-8"))
    return resp.get("name", fn)


def build_t2i(prompt, width, height, seed):
    """官方 t2i 子图活跃路径展平(PE 默认关=原文直入;VAE 恒接官方同款)。"""
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": DIT, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": TE, "type": "minimax", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "5": {"class_type": "MiniMaxH3ImageConditioning",
              "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt,
                         "width": width, "height": height}},
        "6": {"class_type": "ConditioningZeroOut",
              "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["5", 0],
                         "negative": ["6", 0], "latent_image": ["5", 1],
                         "seed": seed, "steps": 6, "cfg": 1.0,
                         "sampler_name": "euler", "scheduler": "simple",
                         "denoise": 1.0}},
        "8": {"class_type": "VAEDecode",
              "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0],
                         "filename_prefix": "h3image_smoke_t2i"}},
    }


def build_edit(image_name, instruction, seed, with_pe=True):
    """官方 edit 件活跃路径展平。底图=t2i 产物(已 4MP/32 对齐,官方 Resize 链
    语义已由上游保证,不重复挂);width=0/height=0=随 image_1(object_info tooltip
    真源);PE 链按官方 edit 模板挂(TextGenerateV2→JsonExtract expanded_caption)。"""
    api = {
        "29": {"class_type": "UNETLoader",
               "inputs": {"unet_name": DIT, "weight_dtype": "default"}},
        "30": {"class_type": "CLIPLoader",
               "inputs": {"clip_name": TE, "type": "minimax", "device": "default"}},
        "31": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "45": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "32": {"class_type": "MiniMaxH3ImageConditioning",
               "inputs": {"clip": ["30", 0], "vae": ["31", 0],
                          "images.image_1": ["45", 0], "width": 0, "height": 0}},
        "33": {"class_type": "ConditioningZeroOut",
               "inputs": {"conditioning": ["32", 0]}},
        "38": {"class_type": "KSampler",
               "inputs": {"model": ["29", 0], "positive": ["32", 0],
                          "negative": ["33", 0], "latent_image": ["32", 1],
                          "seed": seed, "steps": 6, "cfg": 1.0,
                          "sampler_name": "euler", "scheduler": "simple",
                          "denoise": 1.0}},
        "42": {"class_type": "VAEDecode",
               "inputs": {"samples": ["38", 0], "vae": ["31", 0]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["42", 0],
                         "filename_prefix": "h3image_smoke_edit"}},
    }
    if with_pe:
        api["35"] = {"class_type": "CLIPLoader",
                     "inputs": {"clip_name": PE, "type": "minimax",
                                "device": "default"}}
        api["34"] = {"class_type": "TextGenerateV2",
                     # PE 槽名=image1 无下划线(conditioning 是 image_1 有下划线,
                     # 官方 UI 件 inputs 数组真名,两节点命名不一致)
                     # use_default_template=True(1112 定谳):自定 [36] system+thinking
                     # 会随机把 8196 预算烧在思考段→JSON 截断→expanded_caption 抽空
                     # →edit 无操作;checkpoint 原生模板输出收敛
                     "inputs": {"clip": ["35", 0], "images.image1": ["45", 0],
                                "prompt": pe_user_prompt(instruction),
                                "max_length": 8196,
                                # dynamic combo "on" 六点分子参(官方 edit 件 [34] widget 现值)
                                "sampling_mode": "on",
                                "sampling_mode.temperature": 1.0,
                                "sampling_mode.top_k": 20,
                                "sampling_mode.top_p": 0.95,
                                "sampling_mode.min_p": 0.0,
                                "sampling_mode.repetition_penalty": 1.0,
                                "sampling_mode.presence_penalty": 0.0,
                                "sampling_mode.seed": 0,
                                "thinking": True, "use_default_template": True,
                                "mtp": "auto"}}
        api["46"] = {"class_type": "PreviewAny",
                     "inputs": {"source": ["44", 0]}}  # 扩写文本进 history 可验
        api["44"] = {"class_type": "JsonExtractString",
                     "inputs": {"json_string": ["34", 0],
                                "key": "expanded_caption"}}
        api["32"]["inputs"]["prompt"] = ["44", 0]
    else:
        api["32"]["inputs"]["prompt"] = instruction
    return api


def run_one(tag, api_factory, deadline):
    print(f"[{tag}] 提交…", flush=True)
    try:
        resp = post_prompt(api_factory())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:800]
        return None, f"HTTP {e.code}: {body}"
    pid = resp["prompt_id"]
    print(f"[{tag}] prompt_id={pid}", flush=True)
    entry, dt = wait_done(pid, deadline)
    outs = fetch_images(entry, tag)
    print(f"[{tag}] 完成 {dt:.0f}s → {[p.name for p in outs]}", flush=True)
    return outs, dt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pass", dest="which", required=True, choices=["1", "2", "3", "all"])
    ap.add_argument("--deadline", type=int, default=3600)
    ap.add_argument("--no-edit", action="store_true", help="只跑 t2i(调试)")
    ap.add_argument("--no-pe", action="store_true", help="edit 不挂 PE 链(直投指令)")
    ap.add_argument("--edit-only", action="store_true",
                    help="跳过 t2i,用已落袋的同遍 t2i 产物重跑 edit")
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── 发车前 object_info 真源核对(接口边界假设核对纪律)──
    check_inputs("MiniMaxH3ImageConditioning",
                 {"clip": "required", "prompt": "required",
                  "width": "required", "height": "required",
                  "vae": "optional", "images": "optional"})
    check_inputs("TextGenerateV2",
                 {"clip": "required", "prompt": "required",
                  "max_length": "required", "system_prompt": "optional",
                  "images": "optional"})
    for cls in ("UNETLoader", "CLIPLoader", "VAELoader", "KSampler", "VAEDecode",
                "ConditioningZeroOut", "JsonExtractString", "LoadImage",
                "SaveImage"):
        obj_info(cls)  # 在场性冒烟
    # CLIPLoader 名单核对(两 TE+PE 三件须在册)
    cl = obj_info("CLIPLoader")["input"]["required"]["clip_name"][0]
    for f in (TE, PE):
        if f not in cl:
            print(f"[FAIL] CLIPLoader 名单缺 {f}")
            sys.exit(2)
    print("[OK] object_info 核对全过")

    use_pe = not args.no_pe
    passes = ["1", "2", "3"] if args.which == "all" else [args.which]
    for p in passes:
        seed = SEEDS[int(p)]
        prompt, w, h = T2I_ANCHORS[int(p)]
        if args.edit_only:
            cands = sorted(OUT_DIR.glob(f"p{p}-t2i__*.png"))
            if not cands:
                print(f"[FAIL] edit-only 缺 p{p}-t2i 产物")
                sys.exit(6)
            outs = [cands[-1]]
        else:
            outs, info = run_one(f"p{p}-t2i",
                                 lambda: build_t2i(prompt, w, h, seed),
                                 args.deadline)
        if not outs:
            print(f"[FAIL] p{p}-t2i {info}")
            sys.exit(5)
        if args.no_edit:
            continue
        up = upload_image(outs[0])
        outs2, info2 = run_one(
            f"p{p}-edit",
            lambda: build_edit(up, EDIT_INSTRUCTIONS[int(p)], seed + 1, use_pe),
            args.deadline)
        if not outs2:
            if use_pe:
                # PE 链 400 → 退直投重试一次,记档(PE 参数面与官方 UI 序列化有出入时兜底)
                print(f"[WARN] p{p}-edit PE 链拒单({str(info2)[:200]})→退直投")
                use_pe = False
                outs2, info2 = run_one(
                    f"p{p}-edit",
                    lambda: build_edit(up, EDIT_INSTRUCTIONS[int(p)],
                                       seed + 1, False),
                    args.deadline)
            if not outs2:
                print(f"[FAIL] p{p}-edit {info2}")
                sys.exit(5)
    print("[ALL DONE]")


if __name__ == "__main__":
    main()
