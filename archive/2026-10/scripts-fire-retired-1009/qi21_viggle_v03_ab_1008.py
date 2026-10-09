#!/usr/bin/env python3
"""qi21 viggle turbo v0.3 换件 A/B 驱动(1008;先例=qi21_r3_9types_1008.py)。

目的:背景逐像素颗粒噪(1008 实测 场景块std 10.75/分镜 9.41,人物基准 2.23)
换蒸馏件验证——v0.2.1-r256 → v0.3-r256(官方 changelog: less grain, cleaner
surfaces; fine texture a little softer)。

接线=产线 viggle 腿逐节点复刻(道劫t2i 道劫·加速子图 7011+7012):
  UNETLoader(base bf16) → LoraLoaderModelOnly(v0.3, strength 1.0)
  → KSampler(6步, cfg1, euler, simple, denoise1)
  TE=heretic 经 TextEncodeQwenImage21(正/负分槽,与 9types 驱动同件)。
装配文=1008 R3 快照逐字节取(apps/output/bgscope-r3-9types/<型>.装配文.txt,
段标记 ═══ 分割;seed/latent 从头部行取,与 r3 完全同源)。
对照基线=同目录 <型>.png(FunAcc T8 4步,r3 现役)。
发车纪律:每发 POST 前查 /queue==0(引擎=全局独占,仅本脚本驱动)。
产物=apps/output/viggle-v03-ab-1008/<型>.png(+装配文快照带 v0.3 溯源头)。
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
sys.path.insert(0, str(REPO / "apps/backend"))

MANIFEST = Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json"
R3_DIR = REPO / "apps/output/bgscope-r3-9types"
OUT = REPO / "apps/output/viggle-v03-ab-1008"

LORA_V03 = "Qwen-Image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors"
LORA_V021 = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors"
PER_FIRE_TIMEOUT = 1500  # 单发轮询上限(秒);viggle 6步约 4-6 分/发+首发模型装载

# A/B 靶=背景噪点最重两型(1008 实测块std 10.75/9.41)
TYPES = ["场景", "分镜剧情图"]


def engine_port() -> int:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    port = data.get("engine", {}).get("port")
    if not isinstance(port, int):
        raise SystemExit(f"manifest.json 无 engine.port: {MANIFEST}")
    return port


ENGINE = f"http://127.0.0.1:{engine_port()}"


def get(path: str, timeout: int = 10):
    with urllib.request.urlopen(f"{ENGINE}{path}", timeout=timeout) as r:
        return json.load(r)


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(f"{ENGINE}{path}", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"POST {path} HTTP {e.code}: {e.read().decode()[:800]}")


def queue_len() -> int:
    q = get("/queue")
    return len(q.get("queue_running", [])) + len(q.get("queue_pending", []))


def parse_asm(zh: str) -> dict:
    """R3 装配文快照解析:头部行(seed/latent)+逐字节正负文(═══ 段分割)。"""
    text = (R3_DIR / f"{zh}.装配文.txt").read_text(encoding="utf-8")
    head = text.splitlines()[0]
    m = re.search(r"seed=(\d+) latent=(\d+)x(\d+)", head)
    must(m, f"{zh} 装配文头部无 seed/latent: {head}")
    seed, w, h = int(m.group(1)), int(m.group(2)), int(m.group(3))
    segs = re.split(r"═══.*?═══\n", text)
    # segs: [头部行, 主体句, 进编码正向, 进编码负向]
    must(len(segs) >= 4, f"{zh} 装配文段数异常: {len(segs)}")
    pos, neg = segs[2].strip("\n"), segs[3].strip("\n")
    return {"seed": seed, "w": w, "h": h, "pos": pos, "neg": neg}


def must(cond, msg):
    if not cond:
        raise SystemExit(f"[断言拦停] {msg}")


def fire_one(zh: str, asm: dict, oi: dict) -> tuple[str, str]:
    """单发:queue==0 门→POST→轮询→下载。状态 ∈ DONE/ENG-ERR/TIMEOUT/QUEUE-BUSY。"""
    # 形状核对(0信任):装载器与采样槽名、LoRA 在引擎 choices 里
    must("UNETLoader" in oi and "lora_name" in oi["LoraLoaderModelOnly"]["input"]["required"],
         "object_info 缺 LoraLoaderModelOnly.lora_name")
    choices = oi["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]
    must(LORA_V03 in choices, f"引擎 choices 无 {LORA_V03}(文件未落到引擎家 loras?)")
    ks = oi["KSampler"]["input"]["required"]
    must(ks["sampler_name"][0] and "euler" in ks["sampler_name"][0], "KSampler 采样器表漂移")

    if queue_len() != 0:
        return ("QUEUE-BUSY", f"发车前 /queue!=0({queue_len()}),独占纪律拦停")
    g = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "qwen_image_2.1_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_8b_bf16_heretic.safetensors", "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
        # 产线 viggle 腿逐节点复刻:7011 LoraLoaderModelOnly(强度1.0)+7012 KSampler(6/1/euler/simple)
        "7011": {"class_type": "LoraLoaderModelOnly",
                 "inputs": {"model": ["1", 0], "lora_name": LORA_V03, "strength_model": 1.0}},
        "4015": {"class_type": "TextEncodeQwenImage21",
                 "inputs": {"prompt": asm["pos"], "negative_prompt": asm["neg"], "resolution": 1024, "clip": ["2", 0]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": int(asm["w"]), "height": int(asm["h"]), "batch_size": 1}},
        "7012": {"class_type": "KSampler",
                 "inputs": {"model": ["7011", 0], "positive": ["4015", 0], "negative": ["4015", 1],
                            "latent_image": ["4", 0], "seed": asm["seed"], "steps": 6, "cfg": 1.0,
                            "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7012", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": f"QI21_V03_{zh}"}},
    }
    try:
        r = post("/prompt", {"prompt": g, "client_id": "qi21-viggle-v03-ab-1008"})
    except RuntimeError as e:
        return ("ENG-ERR", str(e))
    pid = r["prompt_id"]
    t0 = time.time()
    while time.time() - t0 < PER_FIRE_TIMEOUT:
        time.sleep(10)
        hist = get(f"/history/{pid}")
        if pid not in hist:
            continue
        ent = hist[pid]
        st = ent.get("status", {})
        if st.get("status_str") == "error":
            return ("ENG-ERR", json.dumps(st.get("messages", [])[-1:], ensure_ascii=False)[:1200])
        for _nid, o in ent.get("outputs", {}).items():
            for img in o.get("images", []):
                fn, sub = img["filename"], img.get("subfolder", "")
                url = (f"{ENGINE}/view?filename={urllib.parse.quote(fn)}"
                       f"&subfolder={urllib.parse.quote(sub)}&type=output")
                dst = OUT / f"{zh}.png"
                urllib.request.urlretrieve(url, dst)
                return ("DONE", f"{dst} engine_fn={fn} {time.time()-t0:.0f}s")
    return ("TIMEOUT", f"{PER_FIRE_TIMEOUT}s 无产出 pid={pid}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # 发车前哨:引擎活着+新 LoRA 文件已在引擎家(两侧同 inode)
    oi = get("/object_info")
    for zh in TYPES:
        asm = parse_asm(zh)
        print(f"[ASM] {zh} seed={asm['seed']} latent={asm['w']}x{asm['h']} "
              f"正向{len(asm['pos'])}字 负向{len(asm['neg'])}字", flush=True)
        status, detail = fire_one(zh, asm, oi)
        print(f"[FIRE] {zh}: {status} {detail}", flush=True)
        if status == "DONE":
            snap = OUT / f"{zh}.装配文.txt"
            snap.write_text(
                f"# 型={zh} seed={asm['seed']} latent={asm['w']}x{asm['h']} "
                f"lora={LORA_V03}(v0.2.1→v0.3 换件A/B,余链与R3逐字节同)\n"
                f"{(R3_DIR / f'{zh}.装配文.txt').read_text(encoding='utf-8')}",
                encoding="utf-8")
        if status in ("QUEUE-BUSY",):
            raise SystemExit("[熔断] 引擎被他人占用,不排队不抢跑")
        if status == "ENG-ERR":
            print("[熔断] 引擎报错,停批查看", flush=True)
            break
    print("[完] 产物=", OUT, flush=True)


if __name__ == "__main__":
    main()
