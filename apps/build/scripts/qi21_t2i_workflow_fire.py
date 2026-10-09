#!/usr/bin/env python3
"""qi21-道劫-t2i.json 工作流本体直跑器(1009 用户令:「必须跑 qi21-道劫-t2i.json 工作流,不要瞎搞自己的设计;每次随机种子」)。

不做任何自建图——从工作流 GUI JSON **按其结构展平**成 API 格式发车:
- 装配子图[6]:真节点逻辑(4010→4013 ApiPE(9B)→4014),型选择/主体句参数化;
- 加速子图[7]:**默认档=宿主 widget 现值**(现=2·viggle 9步双段:RandomNoise→段A
  turboLoRA+ViggleTurboSigmas(SplitSigmas@7)→段B 底模+DisableNoise 续采);
  未选支路(FunAcc/直出)懒排除——与画布执行图一致;
- seed=**每次随机**(random.randint),透传到 7:7017 RandomNoise 与 7:7010/7013(懒分支
  仍排除,seed 只落在活支路);
- 4018 WhSuggest 手动宽高=0(透传型宽高)——工作流默认。

用法:python3 qi21_t2i_workflow_fire.py --type 表情差分 [--subject-file xx.txt] [--seed N(缺省随机)] [--out xx.png]
"""
import argparse
import json
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
DOC = REPO / "docs/prompts/道劫_九型主体句示例.md"


def engine_base() -> str:
    """引擎口=manifest.json engine.port 现查(零硬编码;端口随引擎重启会变,17001 只是现值)。"""
    manifest = Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json"
    port = json.loads(manifest.read_text(encoding="utf-8")).get("engine", {}).get("port")
    if not isinstance(port, int):
        raise SystemExit(f"manifest.json 无 engine.port: {manifest}")
    return f"http://127.0.0.1:{port}"


ENGINE = engine_base()


def obj_info(cls):
    d = json.load(urllib.request.urlopen(f"{ENGINE}/object_info/{urllib.parse.quote(cls)}", timeout=10))[cls]
    order, widget_like = [], []
    for grp in ("required", "optional"):
        for k, v in d["input"].get(grp, {}).items():
            order.append(k)
            spec = v[1] if len(v) > 1 and isinstance(v[1], dict) else {}
            if not spec.get("forceInput") and not isinstance(v[0], list) or isinstance(v[0], list):
                widget_like.append(k) if not spec.get("forceInput") else None
    return order


def widget_inputs(cls):
    """返回该类的 widget 形输入名序(非 forceInput 的)——widgets_values 按此对位。"""
    d = json.load(urllib.request.urlopen(f"{ENGINE}/object_info/{urllib.parse.quote(cls)}", timeout=10))[cls]
    out = []
    for grp in ("required", "optional"):
        for k, v in d["input"].get(grp, {}).items():
            spec = v[1] if len(v) > 1 and isinstance(v[1], dict) else {}
            if not spec.get("forceInput"):
                out.append(k)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", required=True)
    ap.add_argument("--subject", default=None, help="主体句全文;缺省=示例库该型§首例逐字")
    ap.add_argument("--seed", type=int, default=None, help="缺省=随机")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    wf = json.loads(WF.read_text(encoding="utf-8"))
    root_nodes = {n["id"]: n for n in wf["nodes"]}
    root_links = {L[0]: L for L in wf["links"]}  # [id, src, sslot, dst, dslot, type]
    sgs = {sg["id"]: sg for sg in wf["definitions"]["subgraphs"]}

    subj = args.subject
    if subj is None:
        t = DOC.read_text(encoding="utf-8")
        # 节名允许别名(人物多视图↔多视图);节头与首个代码围栏间可有说明文字。
        # 节头匹配必须钉死单行([^\n] 禁跨行):re.S 下贪婪 .* 会从本节节头一路吞到
        # 后文别节标题里的同名字样(如§2「无人物」)再取围栏→主体句跨节错配(1009 两犯)。
        alias = {"人物多视图": "多视图"}.get(args.type, args.type)
        m = re.search(rf"## \d+\. [^\n]*?{re.escape(alias)}[^\n]*\n.*?```[a-z]*\n(.*?)\n```", t, re.S)
        if not m:
            sys.exit(f"示例库未找到型「{args.type}」条目")
        subj = m.group(1).strip()

    seed = args.seed if args.seed is not None else random.randint(1, 2**31 - 1)

    host6 = root_nodes[6]          # 装配子图宿主(型选择 widget)
    host7 = root_nodes[7]          # 加速子图宿主(速度档位/seed/σ表 widget)
    speed = host7["widgets_values"][0]
    sigma_str = host7["widgets_values"][2] if len(host7["widgets_values"]) > 2 else ""
    print(f"[fire] 型={args.type} 档={speed} seed={seed}(随机)" if args.seed is None else f"[fire] 型={args.type} 档={speed} seed={seed}")

    # ── 展平:子图[6]装配 ──(节点 id 前缀 6:,与画布 API 形一致)
    sg6 = sgs[host6["type"]]
    g = {}
    # 4010/4013/4014/4030/4031/4032 —— 结构固定,widget 从工作流现值取,型/主体句注入
    n4010 = next(n for n in sg6["nodes"] if n["id"] == 4010)
    n4013 = next(n for n in sg6["nodes"] if n["id"] == 4013)
    pe_wv = n4013["widgets_values"]
    n4030 = next(n for n in sg6["nodes"] if n["id"] == 4030)
    n4031 = next(n for n in sg6["nodes"] if n["id"] == 4031)
    n4032 = next(n for n in sg6["nodes"] if n["id"] == 4032)

    g["6:4010"] = {"class_type": "MyQi21DaojieBase",
                   "inputs": {"base": args.type, "透明覆盖": n4010["widgets_values"][1]}}
    pe_keys = widget_inputs("MyQi21ApiPE")
    pe_in = {k: v for k, v in zip(pe_keys, pe_wv)}
    for k in ("系统提示词", "色卡", "美术风格底座-正向", "美术风格底座-负向", "正向提示词", "负向提示词",
              "类型句正向", "类型句负向", "画幅宽", "画幅高", "透明模式"):
        pe_in.pop(k, None)
    pe_in.update({
        "api_url": pe_in.get("api_url", "http://192.168.0.101:1234"),
        "model": pe_in.get("model", "qwen3.5-9b-uncensored-hauhaucs-aggressive"),
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

    # ── 展平:子图[7]加速(按工作流现档) ──
    sg7 = sgs[host7["type"]]
    n7 = {n["id"]: n for n in sg7["nodes"]}
    if "viggle" in speed:
        lora_name = n7[7011]["widgets_values"][0]
        split_step = n7[7021]["widgets_values"][0] if n7[7021].get("widgets_values") else 7
        g["7:7011"] = {"class_type": "ViggleTurboLora", "inputs": {"model": ["1", 0], "lora_name": lora_name, "strength": 1.0}}
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
        latent_src = ["7:7024", 0]
    elif "Fun" in speed:
        g["7:7013"] = {"class_type": "T8QwenImage21FunAccPDD4Step",
                       "inputs": {"model": ["1", 0], "positive": ["4015", 0], "latent_image": ["4", 0],
                                  "model_file": n7[7013]["widgets_values"][0], "seed": seed}}
        latent_src = ["7:7013", 0]
    else:
        g["7:7010"] = {"class_type": "KSampler",
                       "inputs": {"seed": seed, "steps": 40, "cfg": 4.0, "sampler_name": "euler", "scheduler": "simple",
                                  "denoise": 1.0, "model": ["1", 0], "positive": ["4015", 0],
                                  "negative": ["4016", 0], "latent_image": ["4", 0]}}
        latent_src = ["7:7010", 0]

    g["5"] = {"class_type": "VAEDecode", "inputs": {"samples": latent_src, "vae": ["3", 0]}}
    g["8"] = {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "QI21_t2i_wf"}}

    req = urllib.request.Request(f"{ENGINE}/prompt",
                                 data=json.dumps({"prompt": g, "client_id": "t2i-workflow-fire"}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        sys.exit(f"400: {e.read().decode()[:600]}")
    print(f"queued {pid}")
    t0 = time.time()
    fn = None
    while time.time() - t0 < 900:
        time.sleep(8)
        with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=10) as r:
            hist = json.load(r)
        if pid in hist:
            for _n, o in hist[pid].get("outputs", {}).items():
                for img in o.get("images", []):
                    fn = img["filename"]; break
            if fn: break
    assert fn, "无产物"
    out = Path(args.out) if args.out else REPO / "apps/output/bgscope-r3-9types" / f"{args.type}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(f"{ENGINE}/view?filename={urllib.parse.quote(fn)}&type=output", out)
    # 装配文快照(从history取[401]双显示框载荷=终稿真值;1009 用户令「提示词一律正文完整贴出」)
    # history形状=outputs[node]即ui本体(positive/negative顶层直挂,无'ui'套层;1007/1009两度实证,
    # 54655b49实跑定谳)。顶层键优先,ui套层仅作旧形状兜底。
    ent = hist.get(pid, {})
    ui = None
    for nid, o in ent.get("outputs", {}).items():
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

    if ui:
        pos_final, neg_final = _join(ui[1].get("positive")), _join(ui[1].get("negative"))
        snap = out.with_suffix(".装配文.txt")
        snap.write_text(
            f"# 型={args.type} seed={seed} 档={speed} 产物={fn}\n"
            f"═══ 主体句(入图) ═══\n{subj}\n\n"
            f"═══ [401] 正向终稿 ═══\n{pos_final}\n\n"
            f"═══ [401] 负向终稿 ═══\n{neg_final}\n",
            encoding="utf-8")
        print(f"装配文快照 → {snap}")
    else:
        print("警告:history 无 [401] 正负终稿载荷,未落装配文快照")
    print(f"DONE {fn} ({time.time()-t0:.0f}s) → {out} [seed={seed}]")


if __name__ == "__main__":
    main()
