#!/usr/bin/env python3
"""qi21 型级加速路由三臂对拍 + P4 边锚实弹 · 1120(trellis 11-19 余项 1/2)。

三质量敏感型(人物海报/设定卡/人物多视图)×三臂同 seed 控变量:
  pruna6   = 模板默认「4 · PrunaAI 6步」(现役基线配方)
  turbo8   = 「0 · Turbo 8步」官方臂(画布 [7028]-[7031] 真身镜像:r178 LoRA×1.0
             直连底模→BasicGuider cfg1 纯正向→ManualSigmas 官方σ表→SCA)
  native40 = 「美宣」原生40步配方镜像(_apply_native_40step:KSampler 40步 cfg4
             euler/simple,mikkoani@0.6 链,5.samples 直改旁路 speed select)
+ P4 边锚实弹:分镜剧情图(16:9)8100/8122 megapixels→8.2944(恒宽 3840 数学
  等价),取图后 lanczos 终格 3840×2160 断言(qwen21.final_anchor_resize 同款)。

两段式 CLI(照 gem_t8_matrix_fire_1118.py 架构;后台 Bash 出不了 LAN 故拆段):
  submit <型> <arm>   建图+自证+入队,写 OUTROOT/<型>/<arm>/state.json,exit 0
  wait <型> <arm>     轮询 /history ≤510s,下载 node8/504 双产物落盘;未完 exit 7
                      (重入续等);p4edge 加终格微整+3840×2160 断言
  audit [型] [arm]    从盘重跑断言(缺省全量)
真源:主体句=gem_t8_matrix_1118.json(逐字);臂配方=画布件 Note+widgets 值
(严禁手搓);seed=submit 时随机一次记 state(三臂同型同 seed 控变量)。
退出码:0=成;2=拒发;7=未完可重入;8=引擎拒单/执行错。
"""
from __future__ import annotations

import json
import math
import random
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ENGINE = "http://192.168.0.101:17000"
TWIN_T2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qwen21-道劫-t2i-api.json"
MATRIX = REPO / "apps/build/scripts/gem_t8_matrix_1118.json"
OUTROOT = REPO / "apps/output/qi21-routing-p4-1120"
CLIENT = "qi21-routing-p4-1120"

TURBO_LORA = "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors"
MIKKO_LORA_NODE = "7:7034"
RESTORE_LORA = "qwen-image-2.1-restore.safetensors"
GEM_CAP_MP = 8.25
EDGE_ANCHOR_MP = 8.2944          # 3840×2160 数学等价(qwen21.edge_anchor_mp)
EDGE_ANCHOR_W, EDGE_ANCHOR_H = 3840, 2160
EDGE_FINAL_TOL = 0.03
# 官方 Turbo σ表(画布 7030 widgets 逐字;9 值=8 步)
TURBO_SIGMAS = "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"

ARMS = ("pruna6", "turbo8", "native40")
ROUTING_TYPES = ("人物海报", "设定卡", "人物多视图")
P4_TYPE, P4_ARM = "分镜剧情图", "p4edge"

EXIT_OK, EXIT_REFUSE, EXIT_WAITING, EXIT_ERROR = 0, 2, 7, 8

for _k in list(__import__("os").environ):
    if "proxy" in _k.lower():
        del __import__("os").environ[_k]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Refuse(Exception):
    pass


class EngineReject(Exception):
    pass


def need(cond: bool, msg: str) -> None:
    if not cond:
        raise Refuse(msg)


def matrix_entry(base_type: str) -> dict:
    m = json.loads(MATRIX.read_text(encoding="utf-8"))
    for t in m.get("types", []):
        if t.get("type") == base_type:
            need(isinstance(t.get("t2iSubject"), str) and t["t2iSubject"].strip(),
                 f"矩阵 {base_type}: t2iSubject 缺席")
            return t
    raise Refuse(f"矩阵缺 {base_type}")


def get(p: str, t: float = 20) -> dict:
    with OPENER.open(ENGINE + p, timeout=t) as r:
        return json.load(r)


def wait_idle(timeout: float = 120) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        q = get("/queue")
        if not q.get("queue_running") and not q.get("queue_pending"):
            return
        time.sleep(5)
    print("[fire] 队列未清空,照样入队(引擎串行正典)")


def self_check(graph: dict, tag: str, arm: str) -> None:
    g8100 = graph["8100"]["inputs"]
    if arm != P4_ARM:  # p4edge 由臂专属断言钉 8.2944
        need(g8100.get("megapixels") == GEM_CAP_MP and type(g8100.get("megapixels")) is float,
             f"{tag}: 8100 megapixels 应 {GEM_CAP_MP}(得 {g8100.get('megapixels')!r})")
    g8102 = graph["8102"]["inputs"]
    need(g8102.get("lora_name") == RESTORE_LORA and g8102.get("strength_model") == 1.0,
         f"{tag}: 8102 应 restore@1.0")
    if arm == "pruna6":
        need(graph["7:7015"]["inputs"]["mode"] == "4 · PrunaAI 6步", f"{tag}: mode 非 PrunaAI 6步")
    elif arm == "turbo8":
        sp = graph["7:7015"]["inputs"]
        need(sp.get("mode") == "0 · Turbo 8步", f"{tag}: mode 非 Turbo 8步")
        need(sp.get("latent_turbo") == ["7:7131", 0], f"{tag}: latent_turbo 未接线")
        need(graph["7:7128"]["inputs"]["lora_name"] == TURBO_LORA
             and graph["7:7128"]["inputs"]["strength_model"] == 1.0,
             f"{tag}: 7:7128 非 r178×1.0")
        need(graph["7:7128"]["inputs"]["model"] == ["1", 0], f"{tag}: turbo LoRA 非直连底模")
        need(graph["7:7129"]["inputs"]["conditioning"] == ["4015", 0], f"{tag}: BasicGuider 非纯正向")
        sig = graph["7:7130"]["inputs"]["sigmas"]
        need(sig == TURBO_SIGMAS and len(sig.split(",")) == 9, f"{tag}: σ表非官方 9 值")
        sca = graph["7:7131"]["inputs"]
        need(sca.get("noise") == ["7:7017", 0] and sca.get("latent_image") == ["4", 0],
             f"{tag}: turbo SCA noise/latent 源错")
    elif arm == "native40":
        ks = graph["7500"]["inputs"]
        need(ks.get("steps") == 40 and ks.get("cfg") == 4.0
             and ks.get("sampler_name") == "euler" and ks.get("scheduler") == "simple",
             f"{tag}: native KSampler 配方错")
        need(ks.get("model") == [MIKKO_LORA_NODE, 0], f"{tag}: native 模型链非 mikkoani 出")
        need(graph["5"]["inputs"]["samples"] == ["7500", 0], f"{tag}: 5.samples 未改直 7500")
    elif arm == P4_ARM:
        for nid in ("8100", "8122"):
            mp = graph[nid]["inputs"].get("megapixels")
            need(mp == EDGE_ANCHOR_MP, f"{tag}: {nid} megapixels 应 {EDGE_ANCHOR_MP}(得 {mp!r})")


def build_t2i_arm(entry: dict, arm: str, seed: int) -> dict:
    graph = json.loads(TWIN_T2I.read_text(encoding="utf-8"))["graph"]
    graph["400"]["inputs"]["value"] = entry["t2iSubject"]
    graph["6:4010"]["inputs"]["base"] = entry["type"]
    graph["7:7014"]["inputs"]["value"] = seed
    if arm == "turbo8":
        # 画布 [7028]-[7031] 真身镜像(档0 Turbo 8步;新键 7:7128-31 防撞)
        graph["7:7128"] = {"class_type": "LoraLoaderModelOnly", "inputs": {
            "lora_name": TURBO_LORA, "strength_model": 1.0, "model": ["1", 0]}}
        graph["7:7129"] = {"class_type": "BasicGuider", "inputs": {
            "model": ["7:7128", 0], "conditioning": ["4015", 0]}}
        graph["7:7130"] = {"class_type": "ManualSigmas", "inputs": {"sigmas": TURBO_SIGMAS}}
        graph["7:7131"] = {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["7:7017", 0], "guider": ["7:7129", 0],
            "sampler": ["7:7018", 0], "sigmas": ["7:7130", 0],
            "latent_image": ["4", 0]}}
        sp = graph["7:7015"]["inputs"]
        sp["mode"] = "0 · Turbo 8步"
        sp["latent_turbo"] = ["7:7131", 0]
    elif arm == "native40":
        # _apply_native_40step 镜像(qwen21.py 同款镜像源链)
        cond = graph["7:7111"]["inputs"].get("conditioning")
        latent = graph["7:7112"]["inputs"].get("latent_image")
        need(isinstance(cond, list) and isinstance(latent, list),
             f"native40/{entry['type']}: 镜像源缺(7:7111 cond/7:7112 latent)")
        graph["7500"] = {"class_type": "KSampler", "inputs": {
            "model": [MIKKO_LORA_NODE, 0], "positive": cond,
            "negative": ["4015", 1], "latent_image": latent,
            "seed": ["7:7014", 0], "steps": 40, "cfg": 4.0,
            "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}}
        graph["5"]["inputs"]["samples"] = ["7500", 0]
    elif arm == P4_ARM:
        for nid in ("8100", "8122"):
            graph[nid]["inputs"]["megapixels"] = EDGE_ANCHOR_MP
    self_check(graph, f"{arm}/{entry['type']}", arm)
    return graph


def post_prompt(graph: dict) -> str:
    req = urllib.request.Request(
        ENGINE + "/prompt",
        data=json.dumps({"prompt": graph, "client_id": CLIENT}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        return json.load(OPENER.open(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        raise EngineReject(f"引擎拒单 400: {e.read().decode()[:1200]}")


def download(outs: dict, d: Path) -> list[dict]:
    got = []
    d.mkdir(parents=True, exist_ok=True)
    for nid in sorted(outs, key=lambda x: (len(x), x)):
        for img in outs[nid].get("images", []):
            url = (f"{ENGINE}/view?filename={urllib.parse.quote(img['filename'])}"
                   f"&type={img.get('type', 'output')}&subfolder={urllib.parse.quote(img.get('subfolder', ''))}")
            data = OPENER.open(url, timeout=120).read()
            p = d / f"node{nid}_{img['filename']}"
            p.write_bytes(data)
            w, h = struct.unpack(">II", data[16:24])
            got.append({"node": nid, "path": str(p.relative_to(REPO)), "w": w, "h": h,
                        "bytes": len(data)})
            print(f"  [dl] node {nid}: {p.name} {w}x{h}")
    return got


def final_anchor_resize(p: Path) -> tuple[Path, tuple[int, int], float]:
    """qwen21.final_anchor_resize 同款:PIL lanczos 终格 3840×2160(≤3% 才整),
    禁欠 raise。返回(终格件路径, 原始尺寸, 偏差)。"""
    from PIL import Image
    image = Image.open(p)
    w, h = image.size
    ratio = w / h
    need(abs(ratio - 16 / 9) / (16 / 9) <= 0.02,
         f"p4edge: 出口 {w}×{h} 非 16:9 族,比例门不过")
    deviation = max(abs(w - EDGE_ANCHOR_W) / EDGE_ANCHOR_W, abs(h - EDGE_ANCHOR_H) / EDGE_ANCHOR_H)
    need(deviation <= EDGE_FINAL_TOL,
         f"p4edge: 出口 {w}×{h} 偏离交付线 {deviation:.1%} >3%,禁欠")
    if (w, h) == (EDGE_ANCHOR_W, EDGE_ANCHOR_H):
        return p, (w, h), deviation
    resized = image.convert("RGBA").resize((EDGE_ANCHOR_W, EDGE_ANCHOR_H), Image.LANCZOS)
    out = p.parent / (p.stem + "_final3840x2160.png")
    resized.save(out, format="PNG")
    return out, (w, h), deviation


def preflight() -> None:
    info = get("/system_stats")
    print(f"[fire] 引擎在跑: comfyui {info['system'].get('comfyui_version', '?')}"
          f" (ram_free={info['system'].get('ram_free', 0) // (1024 ** 2)}MB)")
    combo = get("/object_info/LoraLoaderModelOnly")["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]
    need(TURBO_LORA in combo, f"引擎 lora combo 缺 {TURBO_LORA}")
    print(f"[fire] 引擎 combo 含 r178 ✓")


def cmd_submit(base_type: str, arm: str, seed: int | None) -> int:
    preflight()
    wait_idle()
    entry = matrix_entry(base_type)
    if seed is None:
        seed = random.randint(1, 2 ** 31 - 1)
    graph = build_t2i_arm(entry, arm, seed)
    pid = post_prompt(graph)
    d = OUTROOT / base_type / arm
    d.mkdir(parents=True, exist_ok=True)
    state = {"pid": pid, "type": base_type, "arm": arm, "seed": seed,
             "engine": ENGINE, "submitted": time.time()}
    (d / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    (d / "assembled_prompt.txt").write_text(entry["t2iSubject"], encoding="utf-8")
    print(f"[submit] {base_type}/{arm} seed={seed} pid={pid}")
    return EXIT_OK


def fetch_history(pid: str) -> dict | None:
    try:
        hist = get(f"/history/{pid}", 15)
    except Exception:
        return None
    rec = hist.get(pid)
    if not rec:
        return None
    st = rec.get("status", {})
    if st.get("status_str") == "error":
        raise EngineReject(f"执行失败: {str(st.get('messages'))[:1200]}")
    outs = rec.get("outputs", {})
    if any("images" in o for o in outs.values()):
        return {"outputs": outs}
    return None


def cmd_wait(base_type: str, arm: str, poll_timeout: float = 510) -> int:
    d = OUTROOT / base_type / arm
    sf = d / "state.json"
    need(sf.exists(), f"状态文件缺 {sf}(先 submit)")
    state = json.loads(sf.read_text(encoding="utf-8"))
    if (d / "meta.json").exists():
        print(f"[wait] {base_type}/{arm} 已完成(meta 在盘,跳过)")
        return EXIT_OK
    deadline = time.time() + poll_timeout
    got = None
    while time.time() < deadline:
        rec = fetch_history(state["pid"])
        if rec is not None:
            got = rec
            break
        time.sleep(5)
    if got is None:
        print(f"[wait] {base_type}/{arm} 未完(exit 7 可重入续等)")
        return EXIT_WAITING
    files = download(got["outputs"], d)
    need(any(f["node"] == "504" for f in files), f"{base_type}/{arm}: 504 超分产物缺席")
    meta = {**state, "files": files, "waited": time.time()}
    if arm == P4_ARM:
        raw504 = next(Path(REPO / f["path"]) for f in files if f["node"] == "504")
        final, (rw, rh), dev = final_anchor_resize(raw504)
        meta["edge_anchor"] = {"raw": [rw, rh], "deviation": round(dev, 5),
                               "final": [EDGE_ANCHOR_W, EDGE_ANCHOR_H],
                               "final_path": str(final.relative_to(REPO))}
        print(f"  [p4] 原始 {rw}×{rh}(偏差 {dev:.2%})→ 终格 {EDGE_ANCHOR_W}×{EDGE_ANCHOR_H} ✓")
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[wait] {base_type}/{arm} 完成,产物 {len(files)} 件")
    return EXIT_OK


def cmd_audit(base_type: str | None, arm: str | None) -> int:
    from PIL import Image
    targets = []
    if base_type and arm:
        targets = [(base_type, arm)]
    else:
        for t in ROUTING_TYPES + (P4_TYPE,):
            arms = ARMS if t != P4_TYPE else (P4_ARM,)
            for a in arms:
                if (OUTROOT / t / a / "meta.json").exists():
                    targets.append((t, a))
    bad = 0
    for t, a in targets:
        meta = json.loads((OUTROOT / t / a / "meta.json").read_text(encoding="utf-8"))
        f504 = next((f for f in meta["files"] if f["node"] == "504"), None)
        need(f504 is not None, f"audit {t}/{a}: 504 记录缺")
        w, h = f504["w"], f504["h"]
        if a == P4_ARM:
            ea = meta.get("edge_anchor", {})
            ok = ea.get("final") == [3840, 2160] and Path(REPO / ea.get("final_path", "")).exists()
            im = Image.open(REPO / ea["final_path"]) if ok else None
            ok = ok and im is not None and im.size == (3840, 2160)
            print(f"[audit] {t}/{a}: 原始 {w}×{h} → 终格 {ea.get('final')} 断言{'✓' if ok else 'FAIL'}")
            bad += 0 if ok else 1
        else:
            # MP 带断言(路由发不涉边锚,任何型=8.25MP 帽 ±2%;型别纵横比随型)
            mp = w * h / 1e6
            ok = 8.0 <= mp <= 8.5
            print(f"[audit] {t}/{a}: 504 {w}×{h} ({mp:.2f}MP) seed={meta['seed']} 断言{'✓' if ok else 'FAIL'}")
            bad += 0 if ok else 1
    return EXIT_ERROR if bad else EXIT_OK


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s1 = sub.add_parser("submit")
    s1.add_argument("type")
    s1.add_argument("arm", choices=(*ARMS, P4_ARM))
    s1.add_argument("--seed", type=int, default=None)
    s2 = sub.add_parser("wait")
    s2.add_argument("type")
    s2.add_argument("arm")
    s2.add_argument("--poll-timeout", type=float, default=510)
    s3 = sub.add_parser("audit")
    s3.add_argument("type", nargs="?")
    s3.add_argument("arm", nargs="?")
    a = ap.parse_args()
    try:
        if a.cmd == "submit":
            return cmd_submit(a.type, a.arm, a.seed)
        if a.cmd == "wait":
            return cmd_wait(a.type, a.arm, a.poll_timeout)
        if a.cmd == "audit":
            return cmd_audit(a.type, a.arm)
    except Refuse as e:
        print(f"[refuse] {e}", file=sys.stderr)
        return EXIT_REFUSE
    except EngineReject as e:
        print(f"[engine] {e}", file=sys.stderr)
        return EXIT_ERROR
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
