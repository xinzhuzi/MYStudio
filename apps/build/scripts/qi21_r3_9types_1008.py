#!/usr/bin/env python3
"""qi21 九型全量实弹出图驱动(1008 R3 验证轮;先例=qi21_bgscope_abfire_1008.py)。

装配文=真节点代码现算(字节级=产线,免App免CDP零打扰):
  MyQi21DaojieBase().run(型zh) → (型文, w, h, 型负, 透明值)
  MyQi21PromptAssembly().assemble(BASE=型文, BASE负面=型负, 主体句=该型规范例) → (装配全文, 负面词)
  MyQi21FinalOutput().compose(正向提示词=装配全文, 负向提示词=负面词, 透明模式=透明值) → (进编码正/负文)
主体句真源=docs/prompts/道劫_九型主体句示例.md 各型 §N 首个代码块逐字(零硬编码,
运行时切出;表情差分=其九情绪五官描述例)。
图=T8 FunAcc 一体采样(接线照 abfire:MODEL+positive+latent→LATENT,cfg恒1 负向不挂);
seed 每型钉死=2008+型序号(§1..§9);SaveImage 前缀 QI21_R3_<型>。
引擎口=运行时现查 <comfy-home>/manifest.json engine.port(零硬编码)。
发车纪律:每发 POST 前查 /queue==0(引擎=全局独占,仅本脚本驱动)。
产物=apps/output/bgscope-r3-9types/<型>.png + <型>.装配文.txt(快照含正负全文)。
单发引擎报错不炸批次:记录原文继续下一型(该型判 fail 由判图侧落账)。
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
DOC = REPO / "docs/prompts/道劫_九型主体句示例.md"
OUT = REPO / "apps/output/bgscope-r3-9types"

# 九型 canon 序=文档 §1..§9 序(与 qi21_bases.json 条目序一致,脚本内断言对拍)
NINE_ORDER = ["人物", "场景", "道具", "美宣", "多视图", "高清人脸",
              "分镜剧情图", "表情差分", "概念气氛图"]
# 循环序(缺省=canon 全序;--only 重拍轮被过滤,seed 仍锚 NINE_ORDER 不飘)
TYPE_ORDER = list(NINE_ORDER)
SEED_BASE = 2008
T8_MODEL = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors"
PER_FIRE_TIMEOUT = 1500  # 单发轮询上限(秒);FunAcc 产线约 3 分/发


def engine_port() -> int:
    """引擎口现查 manifest.json engine.port(零硬编码;缺=响亮报错)。"""
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


def load_subjects() -> dict:
    """文档 §N 首个代码块逐字切出(零硬编码真源;key=型名)。"""
    text = DOC.read_text(encoding="utf-8")
    subs, order = {}, []
    for m in re.finditer(r"^## (\d+)\.\s*([^(（\n]+)", text, re.M):
        seg = text[m.end():]
        nxt = re.search(r"^## \d+\.", text[m.end():], re.M)
        if nxt:
            seg = seg[:nxt.start()]
        blk = re.search(r"```\n(.*?)\n```", seg, re.S)
        if blk:
            name = m.group(2).strip()
            subs[name] = blk.group(1)
            order.append(name)
    if order != NINE_ORDER:
        raise SystemExit(f"文档型序与 canon 不合: {order}")
    return subs


def obj_info(cls: str) -> dict:
    return get(f"/object_info/{cls}")[cls]


def must(cond: bool, msg: str) -> None:
    if not cond:
        raise SystemExit(msg)


def fire_one(zh: str, seed: int, pos: str, neg: str, w: int, h: int,
             oi: dict) -> tuple[str, str]:
    """单发:queue==0 门→POST→轮询→下载。返回 (状态, 详情)。
    状态 ∈ DONE / ENG-ERR / TIMEOUT / QUEUE-BUSY。"""
    if queue_len() != 0:
        return ("QUEUE-BUSY", f"发车前 /queue!=0({queue_len()}),独占纪律拦停")
    g = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "qwen_image_2.1_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_8b_bf16_heretic.safetensors", "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
        # FunAcc 默认档产线接线(abfire 同款):T8 一体采样 MODEL+正向+latent→LATENT
        "7013": {"class_type": "T8QwenImage21FunAccPDD4Step",
                 "inputs": {"model": ["1", 0], "positive": ["4015", 0], "latent_image": ["4", 0],
                            "model_file": T8_MODEL, "seed": seed}},
        "4015": {"class_type": "TextEncodeQwenImage21",
                 "inputs": {"prompt": pos, "negative_prompt": neg, "resolution": 1024, "clip": ["2", 0]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": int(w), "height": int(h), "batch_size": 1}},
        "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7013", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": f"QI21_R3_{zh}"}},
    }
    try:
        r = post("/prompt", {"prompt": g, "client_id": "qi21-r3-9types-1008"})
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
    # 重拍轮(1008 R2):--only 道具,多视图,… 只循环子集(其余跳过),seed 公式
    # 不变=与首轮同 seed;缺省=九型全量(首轮形态)。注意先全量 load_subjects
    # (内含型序==canon 断言)再过滤循环序。
    subjects = load_subjects()
    only = None
    for i, a in enumerate(sys.argv):
        if a == "--only" and i + 1 < len(sys.argv):
            only = [x.strip() for x in sys.argv[i + 1].split(",") if x.strip()]
    global TYPE_ORDER
    if only:
        bad = [x for x in only if x not in TYPE_ORDER]
        if bad:
            raise SystemExit(f"--only 未知型: {bad}")
        TYPE_ORDER = [z for z in TYPE_ORDER if z in only]
    from engines.comfyui.my_nodes.nodes import (my_qi21_base, my_qi21_prompt_assembly,
                                                my_qi21_final_output)
    OUT.mkdir(parents=True, exist_ok=True)

    # 引擎可达性快检(启App/轮询由驱动侧负责;此处 3 连试给余量)
    for i in range(3):
        try:
            get("/queue", timeout=5)
            break
        except Exception as e:
            if i == 2:
                raise SystemExit(f"引擎 {ENGINE} 不可达: {e}")
            time.sleep(20)

    # object_info 形状核对(abfire 同款):件在+件名在
    oi = {c: obj_info(c)["input"] for c in (
        "UNETLoader", "CLIPLoader", "VAELoader", "TextEncodeQwenImage21",
        "EmptyLatentImage", "VAEDecode", "SaveImage",
        "T8QwenImage21FunAccPDD4Step")}
    must("qwen_image_2.1_bf16.safetensors" in oi["UNETLoader"]["required"]["unet_name"][0],
         "UNET 件不在引擎")
    must(T8_MODEL in oi["T8QwenImage21FunAccPDD4Step"]["required"]["model_file"][0],
         f"T8 件不在引擎: {T8_MODEL}")
    te = oi["TextEncodeQwenImage21"]
    te_text_key = "prompt" if "prompt" in te.get("required", {}) else \
        next(k for k, v in {**te.get("required", {}), **te.get("optional", {})}.items()
             if v[0] == "STRING" and k != "clip")
    must(te_text_key == "prompt", f"TE 文本槽名漂移: {te_text_key}")

    base_node = my_qi21_base.MyQi21DaojieBase()
    asm = my_qi21_prompt_assembly.MyQi21PromptAssembly()
    fin = my_qi21_final_output.MyQi21FinalOutput()

    results = []
    for zh in TYPE_ORDER:
        sec = NINE_ORDER.index(zh) + 1
        # seed 锚 canon 全序 §序(与首轮同款公式),子集循环不得重数——
        # 否则 seed 飘(1008 R2 实弹事故:过滤后 enumerate 重数,道具拿了 2009)
        seed = SEED_BASE + NINE_ORDER.index(zh) + 1
        base_text, w, h, neg_text, alpha = base_node.run(zh)
        full, merged_neg = asm.assemble(BASE=base_text, BASE负面=neg_text,
                                        主体句=subjects[zh])
        pos, neg = fin.compose(正向提示词=full, 负向提示词=merged_neg, 透明模式=alpha)
        (OUT / f"{zh}.装配文.txt").write_text(
            f"# 型={zh} seed={seed} latent={w}x{h} 透明模式={alpha} "
            f"正向{len(pos)}字 负向{len(neg)}字\n\n"
            f"═══ 主体句(文档§{sec}逐字) ═══\n{subjects[zh]}\n\n"
            f"═══ 进编码正向 ═══\n{pos}\n\n═══ 进编码负向 ═══\n{neg}\n",
            encoding="utf-8")
        print(f"[ASM] {zh} seed={seed} latent={w}x{h} alpha={alpha} "
              f"pos={len(pos)}字 neg={len(neg)}字", flush=True)
        status, detail = fire_one(zh, seed, pos, neg, w, h, oi)
        print(f"[{status}] {zh} {detail}", flush=True)
        results.append({"zh": zh, "seed": seed, "status": status, "detail": detail})
    print("SUMMARY " + json.dumps(results, ensure_ascii=False))
    bad = [r for r in results if r["status"] != "DONE"]
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
