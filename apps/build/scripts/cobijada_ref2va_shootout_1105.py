#!/usr/bin/env python3
"""1105 Cobijada hybrid vs 官方双件 对拍实弹(四发同 seed)。

计划(1105 会话档案):
- A: fl2va int8  + pika_fl2va  LoRA(首尾帧)  ← fl2va 线基线
- B: Cobijada   + pika_fl2va  LoRA(同seed)   ← B vs A = hybrid vs fl2va
- C: Cobijada   + pika_ref2va LoRA(参考图)   ← hybrid 吸 ref 能力
- D: ref2va int8 + pika_ref2va LoRA(同seed)  ← 产线主力基线; C vs D 预期收益最大

模板 = 引擎侧已验证直投件 api_fl2va.json / api_ref2va.json(1031 首跑真源,已 scp 回 /tmp)。
判据 = x-linked-etag sha256=85a4573a861810bfb250b3cc38f492870b6a3b01048feaa02a85bc7c511b7ca1。

用法: python3 cobijada_ref2va_shootout_1105.py [--engine http://192.168.0.101:17000] [--seed 11051105]
       [--lanes A,B,C,D] [--skip-model-check]
"""
import argparse
import copy
import json
import time
import urllib.request
import uuid
from pathlib import Path

ENGINE_DEFAULT = "http://192.168.0.101:17000"
COBIJADA = "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors"
FL2VA = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
REF2VA = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
SEED = 11051105
OUT_DIR = Path(__file__).resolve().parents[2] / "output" / "h3-cobijada-shootout-1105"


def http_json(engine, path, payload=None, timeout=30):
    url = engine.rstrip("/") + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as r:
        return json.loads(r.read())


def load_template(name):
    t = json.load(open(f"/tmp/api_{name}.json"))
    return t.get("prompt", t)


def make_variant(tpl_name, unet, tag, seed):
    p = copy.deepcopy(load_template(tpl_name))
    # 底模
    hit_unet = 0
    for nid, n in p.items():
        if n["class_type"] == "UNETLoader":
            n["inputs"]["unet_name"] = unet
            hit_unet += 1
    assert hit_unet == 1, f"{tpl_name}: UNETLoader x{hit_unet}"
    # seed 钉死(RandomNoise / KSampler 双形态兼容)
    for nid, n in p.items():
        if n["class_type"] == "RandomNoise":
            n["inputs"]["noise_seed"] = seed
        if n["class_type"] == "KSampler" and "seed" in n["inputs"]:
            n["inputs"]["seed"] = seed
    # 出片前缀
    for nid, n in p.items():
        if n["class_type"] == "SaveVideo":
            base = n["inputs"].get("filename_prefix", "video/shootout")
            n["inputs"]["filename_prefix"] = f"h3-cobijada-shootout-1105/{tag}"
    return p


LANES = {
    "A": dict(tpl="fl2va", unet=FL2VA, tag="A-fl2va-base"),
    "B": dict(tpl="fl2va", unet=COBIJADA, tag="B-cobijada-fl2valora"),
    "C": dict(tpl="ref2va", unet=COBIJADA, tag="C-cobijada-ref2valora"),
    "D": dict(tpl="ref2va", unet=REF2VA, tag="D-ref2va-base"),
}


def run_one(engine, prompt, tag, timeout):
    client_id = str(uuid.uuid4())
    t0 = time.time()
    resp = http_json(engine, "/prompt", {"prompt": prompt, "client_id": client_id})
    if resp.get("node_errors"):
        return {"tag": tag, "ok": False, "error": "node_errors", "detail": resp["node_errors"]}
    pid = resp["prompt_id"]
    while True:
        if time.time() - t0 > timeout:
            return {"tag": tag, "ok": False, "error": "timeout", "prompt_id": pid}
        time.sleep(10)
        hist = http_json(engine, f"/history/{pid}")
        entry = hist.get(pid)
        if not entry:
            continue
        st = entry.get("status", {})
        el = round(time.time() - t0, 1)
        if not st.get("completed"):
            msgs = [m for m in st.get("messages", []) if m and m[0] == "execution_error"]
            return {"tag": tag, "ok": False, "error": "failed", "elapsed_s": el,
                    "messages": msgs[:2], "prompt_id": pid}
        outs = []
        for nid, out in entry.get("outputs", {}).items():
            for vid, vinfo in (out.get("videos") or out.get("gifs") or {}).items():
                outs.append(vinfo)
        return {"tag": tag, "ok": True, "elapsed_s": el, "prompt_id": pid, "outputs": outs}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default=ENGINE_DEFAULT)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--lanes", default="A,B,C,D")
    ap.add_argument("--timeout", type=int, default=1500)
    ap.add_argument("--skip-model-check", action="store_true")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results = {}

    # 模型在位核验(C/B 需 Cobijada;不跳过时四发全验)
    if not args.skip_model_check:
        oi = http_json(args.engine, "/object_info")
        opts = oi["UNETLoader"]["input"]["required"]["unet_name"][0]
        need = {LANES[l]["unet"] for l in args.lanes.split(",")}
        missing = need - set(opts)
        if missing:
            print(f"MISSING models on engine: {missing}")
            raise SystemExit(1)

    for lane in args.lanes.split(","):
        cfg = LANES[lane]
        prompt = make_variant(cfg["tpl"], cfg["unet"], cfg["tag"], args.seed)
        (OUT_DIR / f"api_{cfg['tag']}.json").write_text(
            json.dumps({"prompt": prompt}, ensure_ascii=False, indent=1))
        print(f"[{lane}] firing {cfg['tag']} (unet={cfg['unet']}, seed={args.seed}) …", flush=True)
        r = run_one(args.engine, prompt, cfg["tag"], args.timeout)
        results[lane] = r
        print(f"[{lane}] {'OK' if r['ok'] else 'FAIL'} {r.get('elapsed_s','?')}s "
              f"{json.dumps(r.get('outputs', r.get('error')), ensure_ascii=False)[:200]}", flush=True)

    (OUT_DIR / "shootout_results.json").write_text(json.dumps({
        "seed": args.seed, "fired_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "results": results}, ensure_ascii=False, indent=1))
    print("all lanes done →", OUT_DIR / "shootout_results.json")


if __name__ == "__main__":
    main()
