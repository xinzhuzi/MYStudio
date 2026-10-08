#!/usr/bin/env python3
"""qi21 背景作用域切分 A/B 实弹驱动(1008)。

用法(两腿分进程,env 切真源):
  A 腿(旧底座): MYSTUDIO_DAOJIE_DATA=<backup_tmp> python3 qi21_bgscope_abfire_1008.py A
  B 腿(新底座): python3 qi21_bgscope_abfire_1008.py B

装配文=真节点代码现算(字节级=产线):MyQi21DaojieBase().run('人物') →
MyQi21PromptAssembly().assemble(BASE=型文, BASE负面=型负, 主体句=产线主体句)。
图:最小复刻产线采样链(FunAcc 默认档=T8件 6步 cfg1 euler/simple;
负向照接,cfg1 下惰性)。seed=1008 钉死。输出→引擎家 output +
apps/output/bgscope-ab-1008/(png+装配文快照)。
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
sys.path.insert(0, str(REPO / "apps/backend"))
ENGINE = "http://127.0.0.1:17001"
OUT = REPO / "apps/output/bgscope-ab-1008"
WF = json.loads((REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/"
                 "1_文生图/qi21-道劫-t2i.json").read_text(encoding="utf-8"))
SEED = 1008
LEG = sys.argv[1] if len(sys.argv) > 1 else "B"


def obj_info(cls: str) -> dict:
    with urllib.request.urlopen(f"{ENGINE}/object_info/{cls}", timeout=10) as r:
        return json.load(r)[cls]


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(f"{ENGINE}{path}", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"POST {path} HTTP {e.code}: {e.read().decode()[:800]}")


def main() -> None:
    from engines.comfyui.my_nodes.nodes import my_qi21_base, my_qi21_prompt_assembly
    src = os.environ.get("MYSTUDIO_DAOJIE_DATA", "<repo真源家>")
    subj = WF["nodes"][next(i for i, n in enumerate(WF["nodes"]) if n["id"] == 400)]["widgets_values"][0]
    base_node = my_qi21_base.MyQi21DaojieBase()
    base_text, w, h, neg_text, _t = base_node.run("人物")
    pos, neg = my_qi21_prompt_assembly.MyQi21PromptAssembly().assemble(
        BASE=base_text, BASE负面=neg_text, 主体句=subj)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"leg_{LEG}_assembled.txt").write_text(
        f"# 真源: {src}\n# {len(pos)}字\n\n═══ 正向 ═══\n{pos}\n\n═══ 负向 ═══\n{neg}\n", encoding="utf-8")
    print(f"[{LEG}] 真源={src} 装配 {len(pos)}字 latent={w}x{h}")

    oi = {c: obj_info(c)["input"] for c in (
        "UNETLoader", "CLIPLoader", "VAELoader", "TextEncodeQwenImage21",
        "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage",
        "T8QwenImage21FunAccPDD4Step")}
    unet_names = oi["UNETLoader"]["required"]["unet_name"][0]
    t8_names = oi["T8QwenImage21FunAccPDD4Step"]["required"]
    t8_model = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors"
    def must(cond: bool, msg: str) -> None:
        if not cond:
            raise SystemExit(msg)
    must("qwen_image_2.1_bf16.safetensors" in unet_names, "UNET 件不在引擎")

    te_inputs = oi["TextEncodeQwenImage21"]
    te_text_key = "text" if "text" in te_inputs.get("required", {}) else \
        next(k for k, v in {**te_inputs.get("required", {}), **te_inputs.get("optional", {})}.items()
             if v[0] == "STRING" and k != "clip")
    g = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "qwen_image_2.1_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_8b_bf16_heretic.safetensors", "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
        # FunAcc 默认档产线接线:T8 一体采样(MODEL+正向+latent→LATENT,cfg恒1 负向无效故不挂)
        "7013": {"class_type": "T8QwenImage21FunAccPDD4Step",
                 "inputs": {"model": ["1", 0], "positive": ["4015", 0], "latent_image": ["4", 0],
                            "model_file": t8_model, "seed": SEED}},
        "4015": {"class_type": "TextEncodeQwenImage21",
                 "inputs": {"prompt": pos, "negative_prompt": neg, "resolution": 1024, "clip": ["2", 0]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": int(w), "height": int(h), "batch_size": 1}},
        "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7013", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": f"QI21_bgscopeAB_{LEG}"}},
    }
    must(t8_model in oi["T8QwenImage21FunAccPDD4Step"]["required"]["model_file"][0], f"T8件不在引擎: {t8_model}")
    te_opt = te_inputs.get("optional", {})

    r = post("/prompt", {"prompt": g, "client_id": "bgscope-ab-1008"})
    pid = r["prompt_id"]
    print(f"[{LEG}] queued {pid}, polling…")
    t0 = time.time()
    while time.time() - t0 < 1800:
        time.sleep(10)
        with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=10) as resp:
            hist = json.load(resp)
        if pid in hist:
            ent = hist[pid]
            st = ent.get("status", {})
            if st.get("status_str") == "error":
                print(f"[{LEG}] ERROR: {json.dumps(st.get('messages', [])[-1:])[:500]}")
                sys.exit(1)
            outs = ent.get("outputs", {})
            for _nid, o in outs.items():
                for img in o.get("images", []):
                    fn, sub = img["filename"], img.get("subfolder", "")
                    url = f"{ENGINE}/view?filename={urllib.parse.quote(fn)}&subfolder={urllib.parse.quote(sub)}&type=output"
                    dst = OUT / f"leg_{LEG}.png"
                    urllib.request.urlretrieve(url, dst)
                    print(f"[{LEG}] DONE {dst} ({time.time()-t0:.0f}s)")
                    return
    print(f"[{LEG}] TIMEOUT 1800s")
    sys.exit(1)


if __name__ == "__main__":
    import urllib.parse
    main()
