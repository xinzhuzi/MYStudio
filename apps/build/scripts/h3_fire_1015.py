#!/usr/bin/env python3
"""H3 固定线 v1.2 实弹首验发车器(1015)——H3 全量升级役的生效判据收据。

做法:UI 形固定线工作流(社区-480P生成-SolAttn加速-480P直出.json,31 节点零子图)
通用展平为 /prompt API 形后发车;转换规则=前端同款(object_info 对位 widget 序),
另处理本件三坑:①静音件(mode=4,LoadImage×2)与其出链按「未接线」丢弃(=模板出厂
T2V 缺省态);②widgets_values 里的 control_after_generate('fixed' 等)在对位数超出
object_info widget 序时剥离;③RandomNoise 种子按「每次生图必换种子」铁令随机
(--seed 显式给值=受控 A/B 例外口径)。
收据:排队→轮询 history→SaveVideo 产物经 /view 落盘 runs/campaigns/h3-v12-firstfire-1015/,
全程掐秒,节点级错误原样上抛。

用法:python3 apps/build/scripts/h3_fire_1015.py [--seed N] [--timeout 3600]
"""
import argparse
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
EH = Path.home() / "Library/Application Support/漫影工作室/comfyui"
WF = REPO / "apps/backend/engines/comfyui/workflows/2_视频/H3视频/2_固定线/社区-480P生成-SolAttn加速-480P直出.json"
OUT_DIR = REPO / "runs/campaigns/h3-v12-firstfire-1015"
ENGINE = f"http://127.0.0.1:{json.loads((EH / 'manifest.json').read_text(encoding='utf-8'))['engine']['port']}"
CONTROL_WORDS = {"fixed", "increment", "decrement", "randomize"}
_OBJ_CACHE: dict = {}


def obj_info(cls: str) -> dict:
    if cls not in _OBJ_CACHE:
        with urllib.request.urlopen(f"{ENGINE}/object_info/{urllib.parse.quote(cls)}", timeout=10) as r:
            _OBJ_CACHE[cls] = json.load(r)[cls]
    return _OBJ_CACHE[cls]


def widget_inputs(cls: str) -> list:
    d = obj_info(cls)
    out = []
    for grp in ("required", "optional"):
        for k, v in d["input"].get(grp, {}).items():
            spec = v[1] if len(v) > 1 and isinstance(v[1], dict) else {}
            if not spec.get("forceInput"):
                out.append(k)
    return out


def convert(wf: dict) -> dict:
    nodes = {n["id"]: n for n in wf["nodes"]}
    links = {L[0]: L for L in wf["links"]}  # [id, src, sslot, dst, dslot, type]
    muted = {n["id"] for n in wf["nodes"] if n.get("mode", 0) != 0}
    g: dict = {}
    warns = []
    for n in wf["nodes"]:
        if n["type"] in ("MarkdownNote", "Note") or n["id"] in muted:
            continue
        ins: dict = {}
        for i in n.get("inputs") or []:
            lid = i.get("link")
            if lid is None:
                continue
            L = links[lid]
            if L[1] in muted:
                continue  # 静音件出链=未接线(可选输入缺省)
            ins[i["name"]] = [str(L[1]), L[2]]
        wv = list(n.get("widgets_values") or [])
        # widget 键序须剔除「本工作流里已连链」的输入——widgets_values 只含真 widget 位
        # (object_info 里 model 等既是可链可 widget;连链时前端不渲染 widget,存档无此槽位)
        linked = {i["name"] for i in n.get("inputs") or [] if i.get("link") is not None}
        keys = [k for k in widget_inputs(n["type"]) if k not in linked]
        if len(wv) > len(keys):
            stripped = [v for v in wv if not (isinstance(v, str) and v in CONTROL_WORDS)]
            if len(stripped) >= len(keys):
                warns.append(f'[{n["id"]}] {n["type"]}: widget {len(wv)}→{len(stripped)}(剥 control)')
                wv = stripped
            if len(wv) > len(keys):
                warns.append(f'[{n["id"]}] {n["type"]}: widget 仍超配 {len(wv)}>{len(keys)},截位')
                wv = wv[: len(keys)]
        for k, v in zip(keys, wv):
            if k not in ins:
                ins[k] = v
        g[str(n["id"])] = {"class_type": n["type"], "inputs": ins}
    for w in warns:
        print(f"[convert] {w}")
    return g


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=None, help="缺省=随机(生图铁令)")
    ap.add_argument("--timeout", type=int, default=3600)
    args = ap.parse_args()

    seed = args.seed if args.seed is not None else random.randint(1, 2**31 - 1)
    wf = json.loads(WF.read_text(encoding="utf-8"))
    g = convert(wf)

    # 种子注入:RandomNoise.noise_seed
    noise_ids = [nid for nid, nd in g.items() if nd["class_type"] == "RandomNoise"]
    if len(noise_ids) != 1:
        raise SystemExit(f"RandomNoise 节点数={len(noise_ids)}(须恰 1)")
    g[noise_ids[0]]["inputs"]["noise_seed"] = seed

    # 已知潜伏病旁路(非本役引入):自管 extra_model_paths.yaml 缺 vae_approx 映射,
    # ModelPreviewOverrideKJ.tiny_vae 的 taeh3 不在引擎选项里(画布跑同样会撞);
    # 该输入只影响画布预览解码,成片走真 VAEDecode——实弹置 none 不损验证效力
    for nd in g.values():
        if nd["class_type"] == "ModelPreviewOverrideKJ" and nd["inputs"].get("tiny_vae") not in (None, "none"):
            print(f"[convert] tiny_vae={nd['inputs']['tiny_vae']}→none(vae_approx 未映射潜伏病旁路)")
            nd["inputs"]["tiny_vae"] = "none"

    lora = next(nd for nd in g.values() if nd["class_type"] == "LoraLoaderModelOnly")
    print(f"[fire] LoRA={lora['inputs'].get('lora_name')} ×{lora['inputs'].get('strength')} seed={seed}{'(随机)' if args.seed is None else '(受控)'}")

    t0 = time.time()
    req = urllib.request.Request(
        f"{ENGINE}/prompt", data=json.dumps({"prompt": g, "client_id": "h3-v12-firstfire"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            pid = json.load(r).get("prompt_id")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"排队失败 HTTP {e.code}:\n{e.read().decode()[:3000]}")
    print(f"[fire] queued {pid}")

    while time.time() - t0 < args.timeout:
        time.sleep(15)
        with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=10) as r:
            h = json.load(r).get(pid)
        if h is None:
            print(f"[poll] {int(time.time() - t0)}s 队列/执行中…")
            continue
        st = h.get("status", {})
        if st.get("status_str") == "error":
            msgs = [m for m in st.get("messages", []) if m[0] in ("execution_error", "validation_error")]
            raise SystemExit(f"执行错误({int(time.time() - t0)}s):{json.dumps(msgs, ensure_ascii=False)[:3000]}")
        outs = []
        for nid, od in h.get("outputs", {}).items():
            for ent in od.get("gifs", []) or od.get("videos", []) or od.get("images", []):
                outs.append((nid, ent))
        if not outs:
            print(f"[done?] {int(time.time() - t0)}s 完成但无产物,outputs 原文:{json.dumps(h.get('outputs'))[:500]}")
            return 1
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        for nid, ent in outs:
            q = urllib.parse.urlencode({"filename": ent["filename"], "subfolder": ent.get("subfolder", ""), "type": ent.get("type", "output")})
            dst = OUT_DIR / f"{int(time.time() - t0)}s_{ent['filename']}"
            with urllib.request.urlopen(f"{ENGINE}/view?{q}", timeout=120) as r, open(dst, "wb") as f:
                f.write(r.read())
            print(f"[receipt] 节点{nid} 产物落盘 {dst}(大小 {dst.stat().st_size / 1e6:.1f}MB)")
        print(f"[receipt] 端到端 {int(time.time() - t0)}s,seed={seed} → {OUT_DIR}")
        (OUT_DIR / "receipt.json").write_text(json.dumps({"seed": seed, "prompt_id": pid, "seconds": int(time.time() - t0), "lora": lora["inputs"].get("lora_name")}, ensure_ascii=False, indent=1))
        return 0
    raise SystemExit(f"超时 {args.timeout}s 未完成")


if __name__ == "__main__":
    raise SystemExit(main())
