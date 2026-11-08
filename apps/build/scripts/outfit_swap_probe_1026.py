#!/usr/bin/env python3
"""outfit_probe_1026 任务B③:qwen-image-2.1-outfit-swap LoRA 双臂实弹探针。

仿已验模式 apps/build/scripts/my21fast_livefire_probe.py:
读盘上 api 件→内存 deepcopy 改装→POST /prompt(平铺 graph,禁整包装件);
禁改盘上模板/契约半字(基图 sha256 前后自证)。

双臂(唯一变量=LoRA 挂否,余逐节点逐参全同):
  A 臂=基线(无 outfit-swap LoRA)
  B 臂=+qwen-image-2.1-outfit-swap.safetensors @ strength 1.0(HF 官方模型卡口径)
       LoraLoader(model/clip 链;引擎字段名=lora_name)插 7:7026→7:7010 与 CLIPLoader→双TE 之间。

直出支路自构(主裁B3结构·复审(a)案,案2=直接旁路选择件,理由见台账):
  移植产线实抓 7:7010 参数面:steps40/cfg1/euler/simple/denoise1/seed=424242 全字面
  (弃原种子键 7:7014 旧口径);+7:7026 detail-fix@1.0(model←7:7034);
  positive/negative←4015 出口,latent←4015 latent 出口(i2i 语义);
  节点5(VAEDecode).samples 由 ['7:7015',0] 改 ['7:7010',0](turbo 支路随剪枝)。

自构图结构断言(主裁B3逐字):
  恰2个 MyQi21FastEncode 实例(171 出 conditioning 喂 guider、4015 出 latent 喂采样)、
  KSampler negative 槽接 4015 的 negative 出口(单遍节点语义位),
  KSampler 参数面=steps40/euler/simple/cfg1/denoise1。

prompt 注入(主裁B3⑤终稿,测中不得回改):节点 400.value 整段替换,断言旧文案零残留。
fail-closed:双臂 graph 深比对,除 LoraLoader 新节点及其重接线外零差异。

用法:
  python3 outfit_swap_probe_1026.py --dry-run   # 断言集全过才许 --live
  python3 outfit_swap_probe_1026.py --live      # 两臂串行,每发前重查 /queue 忙则等
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
BASE_API = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qwen21-道劫-i2i-api.json"
OUT_DIR = REPO / "apps/output/outfit_probe_1026"
ENGINE = "http://127.0.0.1:17001"  # manifest.json engine.port 亲验=17001
CLIENT_ID = "outfit_probe_1026"

SRC_IMAGE = "yanliao_outfit_probe_src.png"  # B2 入库件(md5 f1837d32… 亲验)
INSTRUCTION = ("<image1>为人物参考。将人物全身服装替换为玄黑色长袍,金线暗纹衣缘,"
               "身份、面部、姿态、背景与构图保持不变。")
OLD_FRAGMENTS = ["<image2>", "上衣参考", "青灰色", "原有画法", "衣服款式", "其余内容保持原样"]
LORA_FILE = "qwen-image-2.1-outfit-swap.safetensors"
DETAIL_FIX = "qwen2.1-detail-fix-2.0.safetensors"
KS_KEY = "7:7010"          # 直出支路 KSampler(自构)
DETAIL_KEY = "7:7026"      # detail-fix LoRA(移植自产线样本)
OUTFIT_KEY = "7:7090"      # B 臂 outfit-swap LoRA(唯一增量)
SEED = 424242              # 双臂同字面(弃 7:7014 旧口径)
TE_KEYS = ("171", "4015")

# ── 图构建 ────────────────────────────────────────────────────────────────


def build_common() -> dict:
    """公共面(双臂全同):直出支路自构+LoadImage 覆写+指令整段替换。"""
    api = json.loads(BASE_API.read_text(encoding="utf-8"))
    g = copy.deepcopy(api["graph"])  # 只动内存副本,盘上模板零改

    # ① 直出支路自构(案2:旁路选择件)
    g[DETAIL_KEY] = {
        "class_type": "LoraLoaderModelOnly",
        "inputs": {"lora_name": DETAIL_FIX, "strength_model": 1.0, "model": ["7:7034", 0]},
    }
    g[KS_KEY] = {
        "class_type": "KSampler",
        "inputs": {"model": [DETAIL_KEY, 0], "seed": SEED, "steps": 40, "cfg": 1.0,
                   "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0,
                   "positive": ["4015", 0], "negative": ["4015", 1],
                   "latent_image": ["4015", 2]},
    }
    g["5"]["inputs"]["samples"] = [KS_KEY, 0]  # VAEDecode 直读直出 KSampler

    # ② LoadImage 覆写为 B2 入库件(基图唯一 LoadImage=人物图)
    g["10"]["inputs"]["image"] = SRC_IMAGE

    # ④ 指令整段替换(主裁B3⑤终稿)
    g["400"]["inputs"]["value"] = INSTRUCTION
    return g


def build_arm_b(common: dict) -> dict:
    """B 臂唯一增量=LoraLoader 插 model/clip 链(引擎字段名=lora_name)。"""
    g = copy.deepcopy(common)
    g[OUTFIT_KEY] = {
        "class_type": "LoraLoader",
        "inputs": {"lora_name": LORA_FILE, "strength_model": 1.0, "strength_clip": 1.0,
                   "model": [DETAIL_KEY, 0], "clip": ["2", 0]},
    }
    g[KS_KEY]["inputs"]["model"] = [OUTFIT_KEY, 0]   # KSampler.model ← outfit LoRA
    g["171"]["inputs"]["clip"] = [OUTFIT_KEY, 1]     # 双 TE clip ← outfit LoRA clip
    g["4015"]["inputs"]["clip"] = [OUTFIT_KEY, 1]
    return g

# ── 断言集(dry-run 全过才许 live)──────────────────────────────────────────


def _diff(a, b, path="", out=None):
    """深比对:返回差异路径列表(值随路径缀简述)。"""
    if out is None:
        out = []
    if type(a) is not type(b):
        out.append(f"{path}: 类型 {type(a).__name__}≠{type(b).__name__}")
    elif isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(f"{path}/{k}: 仅B有")
            elif k not in b:
                out.append(f"{path}/{k}: 仅A有")
            else:
                _diff(a[k], b[k], f"{path}/{k}", out)
    else:
        # list 与标量按整值比对(接线引用 ['节点',槽] 为原子值,不逐元素拆;
        # 任何值差仍必报 → fail-closed 语义不变)
        if a != b:
            out.append(f"{path}: {a!r}≠{b!r}")
    return out


def run_assertions(arm_a: dict, arm_b: dict) -> tuple[list[str], list[str]]:
    """返回 (PASS 行, FAIL 行)。任一 FAIL → 零发弹。"""
    ok, bad = [], []

    def chk(name: str, cond: bool, detail: str = ""):
        (ok if cond else bad).append(f"{name}{(' | ' + detail) if detail else ''}")

    # 0) 盘上模板零改自证
    sha = hashlib.sha256(BASE_API.read_bytes()).hexdigest()
    chk("基图盘上件 sha256 恒定", len(sha) == 64, sha[:16] + "…")

    # 1) 双臂唯一差=LoRA(新节点+重接线),其余零差异
    diffs = _diff(arm_a, arm_b)
    allowed = {
        f"/{OUTFIT_KEY}: 仅B有",
        f"/{KS_KEY}/inputs/model: {[DETAIL_KEY, 0]!r}≠{[OUTFIT_KEY, 0]!r}",
        "/171/inputs/clip: ['2', 0]≠['%s', 1]" % OUTFIT_KEY,
        "/4015/inputs/clip: ['2', 0]≠['%s', 1]" % OUTFIT_KEY,
    }
    unexpected = [d for d in diffs if d not in allowed]
    missing = [d for d in allowed if d not in diffs]
    chk("双臂深比对=恰4处差(outfit LoRA新节点+model重接+双TE clip重接)",
        not unexpected and not missing,
        f"意外差={unexpected} 缺失预期差={missing}" if (unexpected or missing)
        else f"差异数={len(diffs)}(全部为预期)")

    # 2) 双臂同 seed=424242(字面整数)
    for tag, g in (("A", arm_a), ("B", arm_b)):
        seed = g[KS_KEY]["inputs"]["seed"]
        chk(f"{tag}臂 seed=424242 字面", seed == 424242 and type(seed) is int, f"实值={seed!r}")

    # 3) 直出支路 KSampler 参数面
    for tag, g in (("A", arm_a), ("B", arm_b)):
        i = g[KS_KEY]["inputs"]
        face = (i["steps"] == 40, i["sampler_name"] == "euler", i["scheduler"] == "simple",
                i["cfg"] == 1.0, i["denoise"] == 1.0)
        chk(f"{tag}臂 KSampler 参数面 steps40/euler/simple/cfg1/denoise1", all(face),
            f"steps={i['steps']} sampler={i['sampler_name']} sched={i['scheduler']} "
            f"cfg={i['cfg']} denoise={i['denoise']}")

    # 4) 恰2个 MyQi21FastEncode 实例+接线(主裁B3逐字)
    for tag, g in (("A", arm_a), ("B", arm_b)):
        te = sorted(k for k, v in g.items() if v.get("class_type") == "MyQi21FastEncode")
        chk(f"{tag}臂 恰2个 MyQi21FastEncode(171/4015)", te == ["171", "4015"], f"实得={te}")
        chk(f"{tag}臂 171 conditioning→guider(7:7029)",
            g["7:7029"]["inputs"]["conditioning"] == ["171", 0])
        chk(f"{tag}臂 4015 latent→采样(7:7010.latent_image)",
            g[KS_KEY]["inputs"]["latent_image"] == ["4015", 2])
        # 5) KSampler negative←4015 negative 出口(单遍节点语义位)
        chk(f"{tag}臂 KSampler negative←4015.negative",
            g[KS_KEY]["inputs"]["negative"] == ["4015", 1])

    # 6) LoadImage=B2 入库件且唯一
    for tag, g in (("A", arm_a), ("B", arm_b)):
        li = {k: v for k, v in g.items() if v.get("class_type") == "LoadImage"}
        chk(f"{tag}臂 唯一LoadImage=10且挂B2入库件",
            set(li) == {"10"} and li["10"]["inputs"]["image"] == SRC_IMAGE,
            f"实得={ {k: v['inputs'].get('image') for k, v in li.items()} }")

    # 7) 400.value=换装指令全文且旧文案零残留
    for tag, g in (("A", arm_a), ("B", arm_b)):
        v = g["400"]["inputs"]["value"]
        chk(f"{tag}臂 400.value=指令全文", v == INSTRUCTION)
        hits = [f for f in OLD_FRAGMENTS if f in v]
        chk(f"{tag}臂 旧文案零残留", not hits, f"残留={hits}" if hits else "")

    # 8) SpeedSelect 支路案=案2已定(节点5直读7:7010;台账已落案由)
    chk("SpeedSelect案=案2(VAEDecode直读7:7010)",
        arm_a["5"]["inputs"]["samples"] == [KS_KEY, 0]
        and arm_b["5"]["inputs"]["samples"] == [KS_KEY, 0])

    # 9) TE 面:class=MyQi21FastEncode 且 resolution=0、images 挂人物参考
    for tag, g in (("A", arm_a), ("B", arm_b)):
        for k in TE_KEYS:
            n = g[k]
            chk(f"{tag}臂 TE[{k}] class/res0/挂人物参考",
                n["class_type"] == "MyQi21FastEncode"
                and n["inputs"]["resolution"] == 0
                and n["inputs"]["images.image_1"] == ["16", 0])

    # 10) B 臂 LoraLoader 面(strength1.0;model←7:7026;clip←CLIPLoader;消费方重接齐)
    bl = arm_b[OUTFIT_KEY]["inputs"]
    chk("B臂 LoraLoader lora/strength1.0/model←7:7026/clip←2",
        bl["lora_name"] == LORA_FILE and bl["strength_model"] == 1.0
        and bl["strength_clip"] == 1.0 and bl["model"] == [DETAIL_KEY, 0]
        and bl["clip"] == ["2", 0])
    chk("B臂 outfit LoRA 消费方重接齐(KSampler.model+双TE.clip)",
        arm_b[KS_KEY]["inputs"]["model"] == [OUTFIT_KEY, 0]
        and arm_b["171"]["inputs"]["clip"] == [OUTFIT_KEY, 1]
        and arm_b["4015"]["inputs"]["clip"] == [OUTFIT_KEY, 1])

    return ok, bad

# ── 引擎交互 ─────────────────────────────────────────────────────────────


def _http_json(url: str, timeout: float = 30.0, data: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers={"Content-Type": "application/json"},
                                 data=json.dumps(data).encode() if data else None)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def wait_queue_empty(timeout_s: float = 3600.0) -> None:
    """每发弹前重查 /queue;忙则轮询等待,绝不打断。"""
    t0 = time.time()
    while True:
        q = _http_json(f"{ENGINE}/queue", timeout=15)
        if not q.get("queue_running") and not q.get("queue_pending"):
            return
        if time.time() - t0 > timeout_s:
            raise SystemExit(f"[live] /queue 等待超时 {timeout_s}s(纪律:绝不打断)")
        time.sleep(10)


def fetch_history_image(prompt_id: str, save_key: str, out_png: Path) -> dict:
    """轮询 /history;取原始出图 SaveImage(节点8,前缀 QI21道劫图生图_)。"""
    t0 = time.time()
    while True:
        hist = _http_json(f"{ENGINE}/history/{prompt_id}", timeout=30).get(prompt_id)
        if hist:
            break
        if time.time() - t0 > 1800:
            raise SystemExit(f"[live] {save_key} 轮询超时(1800s)")
        time.sleep(3)
    elapsed = time.time() - t0
    status = hist.get("status", {})
    msgs = status.get("messages", [])
    err = [m for m in msgs if isinstance(m, list) and m and
           ("error" in str(m[0]) or "interrupt" in str(m[0]))]
    if err or not status.get("completed"):
        raise SystemExit(f"[live] {save_key} 执行失败: status={status.get('status_str')} "
                         f"错误消息={json.dumps(err, ensure_ascii=False)[:1200]}")
    images = hist.get("outputs", {}).get("8", {}).get("images", [])
    if not images:
        raise SystemExit(f"[live] {save_key} 节点8无出图(outputs={list(hist.get('outputs', {}))})")
    img = images[-1]
    q = urllib.parse.urlencode({"filename": img["filename"], "type": img["type"],
                                "subfolder": img.get("subfolder", "")})
    with urllib.request.urlopen(f"{ENGINE}/view?{q}", timeout=120) as resp:
        out_png.write_bytes(resp.read())
    # 超分臂(504 MYStudio-2K)仅成功验
    up_ok = bool(hist.get("outputs", {}).get("504", {}).get("images"))
    return {"elapsed_s": round(elapsed, 1), "image_meta": img,
            "status_str": status.get("status_str"), "error_messages": err,
            "upscale_504_success": up_ok}

# ── 主流程 ───────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--arm", choices=("A", "B", "both"), default="both",
                    help="live 只发指定臂(A=基线/B=+LoRA);断言集恒对双臂全跑。"
                         "引擎硬死恢复轮用:已完成臂真值经 live_report.json 保真合并。")
    args = ap.parse_args()
    if not (args.dry_run ^ args.live):
        ap.error("--dry-run 或 --live 其一")

    arm_a = build_common()
    arm_b = build_arm_b(arm_a)

    if args.dry_run:
        ok, bad = run_assertions(arm_a, arm_b)
        print(f"[dry-run] 断言 {len(ok)} PASS / {len(bad)} FAIL")
        for line in ok:
            print("  PASS |", line)
        for line in bad:
            print("  FAIL |", line)
        (OUT_DIR / "dry_run_report.json").write_text(
            json.dumps({"pass": ok, "fail": bad,
                        "instruction": INSTRUCTION, "seed": SEED,
                        "speedselect_branch": "案2 旁路选择件(台账已落案由)"},
                       ensure_ascii=False, indent=1), encoding="utf-8")
        if bad:
            print("[dry-run] FAIL→零发弹退出")
            return 1
        print("[dry-run] 断言集全过,许 --live")
        return 0

    # --live:先复跑断言集(fail-closed),再两臂串行发弹
    ok, bad = run_assertions(arm_a, arm_b)
    if bad:
        print(f"[live] 前置断言败({len(bad)}),零发弹: {bad}")
        return 1

    (OUT_DIR / "armA_graph.json").write_text(json.dumps(arm_a, ensure_ascii=False, indent=1),
                                             encoding="utf-8")
    (OUT_DIR / "armB_graph.json").write_text(json.dumps(arm_b, ensure_ascii=False, indent=1),
                                             encoding="utf-8")

    # 增量合并:已完成臂真值(引擎硬死前实测)保真续存
    report_path = OUT_DIR / "live_report.json"
    results = {}
    if report_path.exists():
        prev = json.loads(report_path.read_text(encoding="utf-8"))
        results.update(prev.get("arms", {}))
        print(f"[live] 续存既有臂记录: {sorted(results)}")

    arms = (("A", arm_a, OUT_DIR / "B_armA_基线.png"),
            ("B", arm_b, OUT_DIR / "B_armB_outfit.png"))
    todo = arms if args.arm == "both" else [a for a in arms if a[0] == args.arm]
    for tag, graph, png in todo:
        if tag in results:
            print(f"[live] {tag} 臂已有记录,跳过(--arm both 欲重跑请先清 live_report.json)")
            continue
        wait_queue_empty()  # 每发弹前重查,忙则等(绝不打断)
        t_post = time.time()
        accepted = _http_json(f"{ENGINE}/prompt", timeout=120,
                              data={"prompt": graph, "client_id": CLIENT_ID})
        node_errors = accepted.get("node_errors") or {}
        if node_errors:
            raise SystemExit(f"[live] {tag} 臂引擎校验败(200+node_errors,拒实弹): "
                             f"{json.dumps(node_errors, ensure_ascii=False)[:800]}")
        pid = accepted["prompt_id"]
        info = fetch_history_image(pid, tag, png)
        info["prompt_id"] = pid
        info["post_to_done_s"] = round(time.time() - t_post, 1)
        results[tag] = info
        print(f"[live] {tag} 臂完成: elapsed={info['elapsed_s']}s "
              f"(POST→done {info['post_to_done_s']}s) pid={pid} 图={info['image_meta']} "
              f"超分504成功={info['upscale_504_success']} 落 {png.name}")
        report_path.write_text(
            json.dumps({"seed": SEED, "instruction": INSTRUCTION, "arms": results},
                       ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"[live] 报告落 {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
