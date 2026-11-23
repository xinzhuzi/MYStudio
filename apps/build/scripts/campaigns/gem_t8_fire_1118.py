#!/usr/bin/env python3
"""Gem② 换装(turbo r178×1 + steps 8)实弹验收 · 1118(道劫 t2i + i2i 场景弹)。

前置:两画布已由 qi21_daojie_gem_turbo_swap_1118.py 换装;引擎在跑(本机托管,
端口现查 manifest)。本脚本=纯发车验收,不改任何仓件;产物落 apps/output/gem-t8-1118/。

两弹:
  ① t2i 实弹:孪生件 qwen21-道劫-t2i-api.json graph 件内现值直发(唯一覆写=
     7:7014 seed 随机,铁律「每次生图必随机种子」);双产物=[8]直出裸图+[504]
     Gem 拼缝 2K——⑤b 换装链的实弹验证面。
  ② i2i 场景弹:以①的 [8] 裸图为参考(上传引擎 input),孪生件件内现值 +
     恰四处覆写:6:4010 base→「场景」、6:4011/6:4022 组装用途→「道劫美术类型」、
     单参考剪链(pop 12/18/11/17 与 4015.images.image_2/3)+7:7014 seed 随机;
     queue 空闲轮询(先等队列清空再发,不与他人任务叠跑)。

用法:python3 apps/build/scripts/gem_t8_fire_1118.py [--poll-timeout 1500]
"""
from __future__ import annotations

import argparse
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TWIN_T2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qwen21-道劫-t2i-api.json"
TWIN_I2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qwen21-道劫-i2i-api.json"
OUTDIR = REPO / "apps/output/gem-t8-1118"
NEW_LORA = "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors"
CLIENT = "gem-t8-fire-1118"


def engine_base() -> str:
    manifest = Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json"
    port = json.loads(manifest.read_text(encoding="utf-8"))["engine"]["port"]
    return f"http://127.0.0.1:{port}"


ENGINE = engine_base()


def set_engine(base: str | None) -> None:
    """--base-url 覆写(1118 实弹:道劫 Gem 栈生产面=Win 引擎 192.168.0.101:17000,
    本机两 home 的模型集均缺 int8 convrot 栈——实测验证,见 meta_fire.json)。"""
    global ENGINE
    if base:
        ENGINE = base.rstrip("/")


def get(path: str, timeout: float = 20) -> dict:
    with urllib.request.urlopen(f"{ENGINE}{path}", timeout=timeout) as r:
        return json.load(r)


def post_prompt(graph: dict) -> str:
    req = urllib.request.Request(
        f"{ENGINE}/prompt",
        data=json.dumps({"prompt": graph, "client_id": CLIENT}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        raise SystemExit(f"[gem-t8] 引擎拒单 400: {e.read().decode()[:1200]}")


IDLE_TIMEOUT = 600.0


def wait_queue_idle(timeout: float | None = None) -> None:
    timeout = IDLE_TIMEOUT if timeout is None else timeout
    """queue 空闲轮询:running+pending 全空才发(不与他人任务叠跑)。"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        q = get("/queue")
        if not q.get("queue_running") and not q.get("queue_pending"):
            return
        time.sleep(5)
    raise SystemExit(f"[gem-t8] 队列 {timeout:.0f}s 未清空,放弃发车")


def poll_history(pid: str, timeout: float) -> dict:
    """轮询 /history 至产物/错误;返回 outputs dict(超时 SystemExit)。"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(10)
        try:
            hist = get(f"/history/{pid}", timeout=15)
        except Exception:
            continue
        entry = hist.get(pid)
        if not entry:
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            raise SystemExit(f"[gem-t8] 执行失败: {str(status.get('messages'))[:1200]}")
        outs = entry.get("outputs", {})
        if any("images" in o for o in outs.values()):
            if status.get("completed") or status.get("status_str") == "success":
                return outs
            return outs  # 有图即收(504/8 双存图时先到先收,余图由本帧 outputs 携带)
    raise SystemExit(f"[gem-t8] {timeout:.0f}s 超时无产物(pid={pid})")


def download(outs: dict, subdir: str) -> list[dict]:
    got = []
    d = OUTDIR / subdir
    d.mkdir(parents=True, exist_ok=True)
    for nid in sorted(outs, key=lambda x: (len(x), x)):
        for img in outs[nid].get("images", []):
            url = (f"{ENGINE}/view?filename={urllib.parse.quote(img['filename'])}"
                   f"&type={img.get('type', 'output')}&subfolder={urllib.parse.quote(img.get('subfolder', ''))}")
            data = urllib.request.urlopen(url, timeout=60).read()
            p = d / f"node{nid}_{img['filename']}"
            p.write_bytes(data)
            ok_magic = data[:8] == b"\x89PNG\r\n\x1a\n"
            got.append({"node": nid, "filename": img["filename"], "path": str(p.relative_to(REPO)),
                        "bytes": len(data), "png_magic": ok_magic})
            print(f"  [dl] node {nid}: {p.name} ({len(data)} bytes, png_magic={ok_magic})")
    return got


def upload_image(path: Path, name: str) -> str:
    """POST /upload/image(multipart 手搓,无 requests 依赖)。"""
    boundary = uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{name}"\r\n'.encode(),
        b"Content-Type: image/png\r\n\r\n",
        path.read_bytes(),
        f"\r\n--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n',
        f"--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        f"{ENGINE}/upload/image", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    resp = json.load(urllib.request.urlopen(req, timeout=60))
    got = resp.get("name", name)
    print(f"  [up] {name} -> engine input: {got}")
    return got


def fresh_seed() -> int:
    return random.randint(1, 2**31 - 1)


def preflight() -> None:
    info = get("/system_stats")
    print(f"[gem-t8] 引擎在跑: comfyui {info['system'].get('comfyui_version', '?')}")
    combo = get("/object_info/LoraLoaderModelOnly")["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]
    if NEW_LORA not in combo:
        raise SystemExit(f"[gem-t8] 引擎 lora combo 缺 {NEW_LORA}(运行时 404 风险,拒发)")
    print(f"[gem-t8] 引擎 combo 含 {NEW_LORA} ✓")


def fire_t2i(poll_timeout: float) -> dict:
    print("== ① t2i 实弹(件内现值直发)==")
    graph = json.loads(TWIN_T2I.read_text(encoding="utf-8"))["graph"]
    seed = fresh_seed()
    graph["7:7014"]["inputs"]["value"] = seed
    # 发车前四点自证:换装值确在执行图(防止拿旧孪生实弹)
    assert graph["8112"]["inputs"]["lora_name"] == NEW_LORA, "孪生 8112 非新 LoRA"
    assert graph["8118"]["inputs"]["steps"] == 8, "孪生 8118 steps≠8"
    assert "Upscale this illustration" in graph["8117"]["inputs"]["prompt"], "孪生 8117 非新句"
    wait_queue_idle()
    t0 = time.time()
    pid = post_prompt(graph)
    print(f"[gem-t8] queued {pid} seed={seed}, polling …")
    outs = poll_history(pid, poll_timeout)
    products = download(outs, "t2i")
    bare = next((p for p in products if p["node"] == "8"), None)
    return {"seed": seed, "prompt_id": pid, "seconds": round(time.time() - t0), "products": products, "bare": bare}


def fire_i2i(ref_path: Path, poll_timeout: float) -> dict:
    print("== ② i2i 场景弹(以 t2i 裸图为参考)==")
    graph = json.loads(TWIN_I2I.read_text(encoding="utf-8"))["graph"]
    seed = fresh_seed()
    # 恰四处覆写(发车令):型→场景、双组装用途→道劫美术类型、单参考剪链
    graph["6:4010"]["inputs"]["base"] = "场景"
    graph["6:4011"]["inputs"]["组装用途"] = "道劫美术类型"
    graph["6:4022"]["inputs"]["组装用途"] = "道劫美术类型"
    for k in ("12", "18", "11", "17"):
        graph.pop(k, None)
    graph["4015"]["inputs"].pop("images.image_2", None)
    graph["4015"]["inputs"].pop("images.image_3", None)
    graph["7:7014"]["inputs"]["value"] = seed
    # 换装值自证(同①)
    assert graph["8112"]["inputs"]["lora_name"] == NEW_LORA, "孪生 8112 非新 LoRA"
    assert graph["8118"]["inputs"]["steps"] == 8, "孪生 8118 steps≠8"
    assert "Upscale this illustration" in graph["8117"]["inputs"]["prompt"], "孪生 8117 非新句"
    # 单参考剪链自证:4015 无 image_2/3 残留、被剪件不残留任何引用
    dangling = [k for k, n in graph.items() for v in n["inputs"].values()
                if isinstance(v, list) and len(v) == 2 and v[0] in ("11", "12", "17", "18")]
    assert not dangling, f"剪链残留引用: {dangling}"
    ref_name = upload_image(ref_path, f"gem_t8_ref_{seed}.png")
    graph["10"]["inputs"]["image"] = ref_name
    wait_queue_idle()
    t0 = time.time()
    pid = post_prompt(graph)
    print(f"[gem-t8] queued {pid} seed={seed} ref={ref_name}, polling …")
    outs = poll_history(pid, poll_timeout)
    products = download(outs, "i2i")
    return {"seed": seed, "prompt_id": pid, "ref": ref_name, "seconds": round(time.time() - t0),
            "products": products}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--poll-timeout", type=float, default=1500)
    ap.add_argument("--idle-timeout", type=float, default=600,
                    help="queue 空闲等待上限秒(生产引擎可能有他役长任务,可调大)")
    ap.add_argument("--base-url", default=None,
                    help="引擎基址覆写(缺省=manifest 本机托管口;1118 实弹用 Win http://192.168.0.101:17000)")
    args = ap.parse_args()
    set_engine(args.base_url)
    OUTDIR.mkdir(parents=True, exist_ok=True)
    preflight()
    global IDLE_TIMEOUT
    IDLE_TIMEOUT = args.idle_timeout
    t2i = fire_t2i(args.poll_timeout)
    if not t2i["bare"]:
        raise SystemExit("[gem-t8] t2i 弹无 [8] 裸图产物,i2i 参考源缺席")
    i2i = fire_i2i(Path(t2i["bare"]["path"]), args.poll_timeout)
    meta = {"campaign": "gem-t8-1118", "engine": ENGINE, "poll_timeout": args.poll_timeout,
            "t2i": t2i, "i2i": i2i,
            "swap": {"lora": NEW_LORA, "steps": 8,
                     "prompt_head": "Upscale this illustration to ultra-high definition"}}
    (OUTDIR / "meta_fire.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[gem-t8] 两弹完成:meta 已写 {OUTDIR / 'meta_fire.json'}")
    return 0


if __name__ == "__main__":
    sys_rc = main()
    raise SystemExit(sys_rc)
