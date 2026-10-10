#!/usr/bin/env python3
"""qi21-道劫-t2i [7027] Fix v2.0×0.5 viggle 实验臂 A/B 对照发车器(1010)。

仿 apps/build/scripts/qi21_t2i_workflow_fire.py 的 GUI→API 展平手法,唯一差异=
viggle 链 7011(ViggleTurboLora) 的 model 上游:
- --arm A(旁路)=7011.model 直吃边界 model(=根图 UNETLoader ["1",0]),跳过 7027
  ——对应工作流删掉 link 104(-10→7027)与 4323(7027→7011),回纯官方链;
- --arm B(在链)=原样:7027 LoraLoaderModelOnly(qwen2.1-detail-fix-2.0, 0.5)→7011
  ——对应 link 104+4323 现状。

其余一切(型/主体句/seed/σ表/段A段B结构)两臂逐字节同源;段B(7022)按工作流
link 4313 恒吃边界 model(摘LoRA底模收尾),两臂一致。

每发前查 /queue==0;产物+meta 落 apps/output/fisher-pose-test/7027ab/。

用法:python3 qi21_7027_ab_fire_1010.py --arm A --seed 305314339 [--type 美宣]
"""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
DOC = REPO / "docs/prompts/道劫_九型主体句示例.md"
OUTDIR = REPO / "apps/output/fisher-pose-test/7027ab"


def engine_base() -> str:
    manifest = Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json"
    port = json.loads(manifest.read_text(encoding="utf-8")).get("engine", {}).get("port")
    if not isinstance(port, int):
        raise SystemExit(f"manifest.json 无 engine.port: {manifest}")
    return f"http://127.0.0.1:{port}"


ENGINE = engine_base()


def widget_inputs(cls):
    d = json.load(urllib.request.urlopen(f"{ENGINE}/object_info/{urllib.parse.quote(cls)}", timeout=10))[cls]
    out = []
    for grp in ("required", "optional"):
        for k, v in d["input"].get(grp, {}).items():
            spec = v[1] if len(v) > 1 and isinstance(v[1], dict) else {}
            if not spec.get("forceInput"):
                out.append(k)
    return out


def queue_empty():
    q = json.load(urllib.request.urlopen(f"{ENGINE}/queue", timeout=10))
    return len(q.get("queue_running", [])) == 0 and len(q.get("queue_pending", [])) == 0


def build_graph(wf, arm, subj, seed):
    root_nodes = {n["id"]: n for n in wf["nodes"]}
    sgs = {sg["id"]: sg for sg in wf["definitions"]["subgraphs"]}
    host6, host7 = root_nodes[6], root_nodes[7]
    speed = host7["widgets_values"][0]
    sigma_str = host7["widgets_values"][2]
    assert "viggle" in speed, f"宿主档非 viggle: {speed}"

    g = {}
    # ── 子图[6] 装配(与 fire 脚本逐字同手法)──
    sg6 = sgs[host6["type"]]
    n4010 = next(n for n in sg6["nodes"] if n["id"] == 4010)
    n4013 = next(n for n in sg6["nodes"] if n["id"] == 4013)
    n4030 = next(n for n in sg6["nodes"] if n["id"] == 4030)
    n4031 = next(n for n in sg6["nodes"] if n["id"] == 4031)
    n4032 = next(n for n in sg6["nodes"] if n["id"] == 4032)

    g["6:4010"] = {"class_type": "MyQi21DaojieBase",
                   "inputs": {"base": TYPE, "透明覆盖": n4010["widgets_values"][1]}}
    pe_keys = widget_inputs("MyQi21ApiPE")
    pe_in = {k: v for k, v in zip(pe_keys, n4013["widgets_values"])}
    for k in ("系统提示词", "色卡", "美术风格底座-正向", "美术风格底座-负向", "正向提示词", "负向提示词",
              "类型句正向", "类型句负向", "画幅宽", "画幅高", "透明模式"):
        pe_in.pop(k, None)
    pe_in.update({
        "正向提示词": ["400", 0], "负向提示词": ["404", 0],
        "类型句正向": ["6:4010", 0], "类型句负向": ["6:4010", 3],
        "画幅宽": ["6:4010", 1], "画幅高": ["6:4010", 2], "透明模式": ["6:4010", 4],
        "系统提示词": ["6:4030", 0], "色卡": ["6:4031", 0],
        "美术风格底座-正向": ["6:4032", 0], "美术风格底座-负向": ["6:4032", 1],
    })
    g["6:4013"] = {"class_type": "MyQi21ApiPE", "inputs": pe_in}
    g["6:4014"] = {"class_type": "MyQi21FinalOutput",
                   "inputs": {"正向提示词": ["6:4013", 0], "负向提示词": ["6:4013", 1], "透明模式": ["6:4013", 2]}}
    g["6:4030"] = {"class_type": "MyQi21系统提示词", "inputs": {"内容": n4030["widgets_values"][0]}}
    g["6:4031"] = {"class_type": "MyQi21色卡", "inputs": {"内容": n4031["widgets_values"][0]}}
    g["6:4032"] = {"class_type": "MyQi21美术风格底座",
                   "inputs": {"风格工艺件": n4032["widgets_values"][0], "底色背景件": n4032["widgets_values"][1],
                              "透明承载件": n4032["widgets_values"][2], "负向词表": n4032["widgets_values"][3]}}

    # ── 根图 ──
    g["1"] = {"class_type": "UNETLoader", "inputs": {"unet_name": root_nodes[1]["widgets_values"][0], "weight_dtype": "default"}}
    g["2"] = {"class_type": "CLIPLoader", "inputs": {"clip_name": root_nodes[2]["widgets_values"][0], "type": "qwen_image", "device": "default"}}
    g["3"] = {"class_type": "VAELoader", "inputs": {"vae_name": root_nodes[3]["widgets_values"][0]}}
    g["400"] = {"class_type": "PrimitiveStringMultiline", "inputs": {"value": subj}}
    g["404"] = {"class_type": "PrimitiveStringMultiline", "inputs": {"value": root_nodes[404]["widgets_values"][0]}}
    g["401"] = {"class_type": "MyQi21PromptPreview",
                "inputs": {"正向提示词": ["6:4014", 0], "负向提示词": ["6:4014", 1]}}
    g["4015"] = {"class_type": "TextEncodeQwenImage21",
                 "inputs": {"prompt": ["6:4014", 0], "negative_prompt": "", "resolution": 1024, "clip": ["2", 0]}}
    g["4016"] = {"class_type": "TextEncodeQwenImage21",
                 "inputs": {"prompt": ["6:4014", 1], "negative_prompt": "", "resolution": 1024, "clip": ["2", 0]}}
    g["4018"] = {"class_type": "MyQi21WhSuggest",
                 "inputs": {"九型WIDTH": ["6:4013", 3], "九型HEIGHT": ["6:4013", 4], "手动宽": 0, "手动高": 0}}
    g["4"] = {"class_type": "EmptyLatentImage", "inputs": {"width": ["4018", 0], "height": ["4018", 1], "batch_size": 1}}

    # ── 子图[7] 加速:档2 viggle 9步双段(σ表/step=7 从工作流现值)──
    sg7 = sgs[host7["type"]]
    n7 = {n["id"]: n for n in sg7["nodes"]}
    lora_name = n7[7011]["widgets_values"][0]
    split_step = n7[7021]["widgets_values"][0]
    fix_lora = n7[7027]["widgets_values"][0]      # qwen2.1-detail-fix-2.0.safetensors
    fix_strength = n7[7027]["widgets_values"][1]  # 0.5

    if arm == "B":  # 在链:7027 Fix v2.0×0.5 → 7011(=link 104+4323 现状)
        g["7:7027"] = {"class_type": "LoraLoaderModelOnly",
                       "inputs": {"model": ["1", 0], "lora_name": fix_lora, "strength_model": fix_strength}}
        viggle_model_src = ["7:7027", 0]
    else:           # A 旁路:7011 直吃边界 model(=删 104/4323 回纯官方链)
        viggle_model_src = ["1", 0]

    g["7:7011"] = {"class_type": "ViggleTurboLora", "inputs": {"model": viggle_model_src, "lora_name": lora_name, "strength": 1.0}}
    g["7:7017"] = {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}}
    g["7:7018"] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}
    g["7:7019"] = {"class_type": "BasicGuider", "inputs": {"model": ["7:7011", 0], "conditioning": ["4015", 0]}}
    g["7:7020"] = {"class_type": "ViggleTurboSigmas", "inputs": {"latent": ["4", 0], "nodes": sigma_str}}
    g["7:7021"] = {"class_type": "SplitSigmas", "inputs": {"sigmas": ["7:7020", 0], "step": split_step}}
    g["7:7012"] = {"class_type": "SamplerCustomAdvanced",
                   "inputs": {"noise": ["7:7017", 0], "guider": ["7:7019", 0], "sampler": ["7:7018", 0],
                              "sigmas": ["7:7021", 0], "latent_image": ["4", 0]}}
    g["7:7022"] = {"class_type": "BasicGuider", "inputs": {"model": ["1", 0], "conditioning": ["4015", 0]}}
    g["7:7023"] = {"class_type": "DisableNoise", "inputs": {}}
    g["7:7024"] = {"class_type": "SamplerCustomAdvanced",
                   "inputs": {"noise": ["7:7023", 0], "guider": ["7:7022", 0], "sampler": ["7:7018", 0],
                              "sigmas": ["7:7021", 1], "latent_image": ["7:7012", 0]}}

    g["5"] = {"class_type": "VAEDecode", "inputs": {"samples": ["7:7024", 0], "vae": ["3", 0]}}
    g["8"] = {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": f"QI21_7027{arm}"}}
    return g


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", required=True, choices=["A", "B"])
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--type", default="美宣")
    args = ap.parse_args()
    TYPE = args.type

    wf = json.loads(WF.read_text(encoding="utf-8"))

    t = DOC.read_text(encoding="utf-8")
    alias = {"人物多视图": "多视图"}.get(args.type, args.type)
    m = re.search(rf"## \d+\. [^\n]*?{re.escape(alias)}[^\n]*\n.*?```[a-z]*\n(.*?)\n```", t, re.S)
    if not m:
        sys.exit(f"示例库未找到型「{args.type}」条目")
    subj = m.group(1).strip()

    arm_desc = {"A": "旁路(7011.model=边界,无7027)", "B": "在链(7027 fix-2.0×0.5→7011)"}[args.arm]
    print(f"[7027ab] 臂={args.arm} {arm_desc} 型={args.type} seed={args.seed}")

    # 每发前查 /queue==0
    for _ in range(60):
        if queue_empty():
            break
        print("queue 非空,等待…")
        time.sleep(10)
    else:
        sys.exit("60 次检查后队列仍非空,放弃")
    print("queue==0 ✓")

    g = build_graph(wf, args.arm, subj, args.seed)
    OUTDIR.mkdir(parents=True, exist_ok=True)
    (OUTDIR / f"{args.arm}-graph.json").write_text(json.dumps(g, ensure_ascii=False, indent=1), encoding="utf-8")

    req = urllib.request.Request(f"{ENGINE}/prompt",
                                 data=json.dumps({"prompt": g, "client_id": f"qi21-7027ab-{args.arm}"}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        sys.exit(f"400: {e.read().decode()[:600]}")
    print(f"queued {pid}")
    t0 = time.time()
    fn, hist = None, {}
    while time.time() - t0 < 1200:
        time.sleep(10)
        with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=10) as r:
            hist = json.load(r)
        if pid in hist:
            status = hist[pid].get("status", {})
            if status.get("status_str") == "error":
                sys.exit(f"执行错误: {json.dumps(status, ensure_ascii=False)[:800]}")
            for _n, o in hist[pid].get("outputs", {}).items():
                for img in o.get("images", []):
                    fn = img["filename"]; break
            if fn:
                break
    assert fn, "1200s 无产物"
    elapsed = time.time() - t0

    name = {"A": "A-bypass", "B": "B-inchain"}[args.arm]
    out = OUTDIR / f"{name}.png"
    urllib.request.urlretrieve(f"{ENGINE}/view?filename={urllib.request.quote(fn)}&type=output", out)

    # 装配文快照([401] 终稿真值)
    ui = None
    for nid, o in hist.get(pid, {}).get("outputs", {}).items():
        if not isinstance(o, dict):
            continue
        if "positive" in o or "negative" in o:
            ui = (nid, o)
            break
        cand = o.get("ui")
        if isinstance(cand, dict) and ("positive" in cand or "negative" in cand):
            ui = (nid, cand)
            break

    def _join(v):
        return "".join(v) if isinstance(v, list) else str(v or "")

    pos_final = neg_final = ""
    if ui:
        pos_final, neg_final = _join(ui[1].get("positive")), _join(ui[1].get("negative"))
        (OUTDIR / f"{name}.装配文.txt").write_text(
            f"# 臂={args.arm} {arm_desc} 型={args.type} seed={args.seed} 产物={fn}\n"
            f"═══ 主体句(入图) ═══\n{subj}\n\n"
            f"═══ [401] 正向终稿 ═══\n{pos_final}\n\n"
            f"═══ [401] 负向终稿 ═══\n{neg_final}\n", encoding="utf-8")

    root7 = next(n for n in wf["nodes"] if n["id"] == 7)
    meta = {
        "arm": args.arm, "arm_desc": arm_desc, "type": args.type, "seed": args.seed,
        "speed": root7["widgets_values"][0], "sigma": root7["widgets_values"][2],
        "prompt_id": pid, "engine": ENGINE, "product": fn, "elapsed_s": round(elapsed, 1),
        "out": str(out),
        "fix_lora": {"name": "qwen2.1-detail-fix-2.0.safetensors", "strength": 0.5},
        "pos_final_len": len(pos_final), "neg_final_len": len(neg_final),
    }
    (OUTDIR / f"{name}.meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"DONE {fn} ({elapsed:.0f}s) → {out}")
