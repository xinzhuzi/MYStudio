#!/usr/bin/env python3
"""B4 三视图对拍 f1/f2/f4 API 运行器(0930,配方=apps/build/scripts/b4_duipai_plan_0930.md §二/§五)。

机制(p2_duipai_run.py 先例沿用+适配):
  - prompt JSON 由 qwen21-t2i.json **现读换算**(权重三件套/KSampler 默认档/负向空/
    resolution widget 全部现读,零硬抄);仓库工作流文件零改动、引擎 userdata 零落盘。
  - 直写路 API 直构:只装 [1][2][3][5][6][7][8][9] 九件——[13]直写串内联进 [6].prompt,
    [14]/[16] 开关与 PE 组([11][12])/RGBA 组([15])/ResolutionSelector([4])零涉;
    EmptyLatentImage width/height=1536/512 直给(plan §二发1 款)。
  - 模板=K2-多视图.json 节点[50] 三联英文模板**逐字**(分格指令+角色块);发2 同文换
    seed=88001177;发4 机动位(默认=换第二角色男剑客泛化;--f4-mode lesion=加强化句病灶复跑)。
  - 干跑验 digest(实弹前置):①qwen21-t2i 无剥离/拼接/收束句件(收束句只在 qi21 件,
    直写路洁净前置);②权重名三件套在活引擎 object_info combo;③graph 回读逐字 md5=
    模板 md5、seed/宽高/步数回读一致。digest 记录落 --out-dir/b4-digest.json。
  - 种子纪律:发1/f4=20260930、发2=88001177(09-15 双面沿用);PE 路全旁路(种子句零涉)。
  - 提交前 wait_idle(p2 纪律:不与在跑任务抢队);POST /prompt → poll history →
    /view 落盘 --out-dir/f{n}.png;记录 --out-dir/run-records.json(幂等:ok 且产物在盘即跳过)。

用法: python3 b4_duipai_run_0930.py --shot f1 [--base-url http://127.0.0.1:17599]
         [--f4-mode generalization|lesion] [--force]
退出码: 0=ok;1=执行/判失败;2=干跑/环境失败。
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path.home() / "Project/Github/MYStudio"
WF_QWEN = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-t2i.json"
WF_K2MULTI = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-多视图.json"
OUT_DIR_DEFAULT = REPO / "apps/output/b4-duipai-0930"
CLIENT_ID = "b4-duipai-0930"
CALL_TIMEOUT_S = 2400
IDLE_WAIT_MAX_S = 3600

SEEDS = {"f1": 20260930, "f2": 88001177, "f4": 20260930}
PREFIX = {"f1": "MYStudio/b4-duipai-0930/f1", "f2": "MYStudio/b4-duipai-0930/f2",
          "f4": "MYStudio/b4-duipai-0930/f4"}

# 发4 角色块替换(女面包师→男剑客,模板其余逐字不动;泛化性面)
CHAR_BAKER = ("a cheerful young woman baker with shoulder-length black hair, neat straight bangs, "
              "round silver-framed glasses, wearing a moss-green apron over a cream blouse with "
              "rolled-up sleeves and a small red neckerchief")
CHAR_SWORDSMAN = ("a lean young male swordsman with tied-back black hair, sharp straight brows, "
                  "wearing a slate-blue training robe with a white sash and a sheathed straight "
                  "sword hanging at his hip")
# 发4 病灶复跑强化句(plan §二发4 机动位原文)
LESION_SENTENCE = "three separate panels, characters do not touch or cross the divider lines"


def http_json(url: str, payload: dict | None = None, timeout: float = 30) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"},
                                 method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def load_template() -> str:
    wf = json.loads(WF_K2MULTI.read_text(encoding="utf-8"))
    n50 = [n for n in wf["nodes"] if n.get("id") == 50][0]
    return n50["widgets_values"][0]


def build_prompt_text(shot: str, f4_mode: str, template: str) -> tuple[str, dict]:
    if shot in ("f1", "f2"):
        return template, {"source": "K2-多视图[50] 逐字", "swap": None}
    if shot == "f4":
        if f4_mode == "lesion":
            first_stop = template.index(". ") + 2
            # plan §二发4 强化句逐字(小写原文,不 capitalize——引文逐字纪律)
            text = template[:first_stop] + LESION_SENTENCE + ". " + template[first_stop:]
            return text, {"source": "K2-多视图[50]+强化句(病灶复跑)", "insert": LESION_SENTENCE}
        assert CHAR_BAKER in template, "模板中未找到面包师角色块(先例漂移,中止)"
        return template.replace(CHAR_BAKER, CHAR_SWORDSMAN), \
            {"source": "K2-多视图[50] 换第二角色(泛化)", "swap": f"{CHAR_BAKER[:40]}…→男剑客"}
    raise SystemExit(f"未知 shot: {shot}(本运行器只管 f1/f2/f4;f3 见 b4_duipai_f3_0930.mjs)")


def build_graph(oi: dict, prompt_text: str, seed: int) -> dict:
    """直写路九件最小图,权重/默认档全部现读 qwen21-t2i.json。"""
    wf = json.loads(WF_QWEN.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in wf["nodes"]}

    def named(nid: int, key: str):
        n = nodes[nid]
        wvn = n.get("widgets_values_named") or {}
        if key in wvn:
            return wvn[key]
        order = None  # 回落位置式(object_info 序)
        cls = n["type"]
        spec_order = (list(oi[cls]["input"].get("required", {}).keys())
                      + list(oi[cls]["input"].get("optional", {}).keys()))
        wv = n.get("widgets_values") or []
        ui_keys = [k for k in spec_order if k != "control_after_generate"]
        for i, k in enumerate(ui_keys):
            if k == key and i < len(wv):
                return wv[i]
        raise RuntimeError(f"节点{nid} widget {key} 现读失败(named/位置式均未命中)")

    ks = nodes[7].get("widgets_values_named") or {}
    return {
        "1": {"class_type": "UNETLoader", "inputs": {
            "unet_name": named(1, "unet_name"), "weight_dtype": named(1, "weight_dtype")}},
        "2": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": named(2, "clip_name"), "type": named(2, "type"), "device": named(2, "device")}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": named(3, "vae_name")}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {
            "width": 1536, "height": 512, "batch_size": 1}},  # plan:直给,ResolutionSelector 零涉
        "6": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "clip": ["2", 0], "vae": ["3", 0],
            "prompt": prompt_text,                       # [13]直写串内联(开关[14]零涉)
            "negative_prompt": named(6, "negative_prompt"),
            "resolution": named(6, "resolution")}},
        "7": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["6", 0], "negative": ["6", 1],
            "latent_image": ["5", 0],
            "seed": int(seed),
            "steps": int(ks.get("steps", 25)), "cfg": float(ks.get("cfg", 1)),
            "sampler_name": ks.get("sampler_name", "euler"),
            "scheduler": ks.get("scheduler", "simple"),
            "denoise": float(ks.get("denoise", 1))}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {
            "images": ["8", 0], "filename_prefix": ""}},  # 前缀调用方注入
    }


def dry_run(base: str, shot: str, prompt_text: str, seed: int, graph: dict, out_dir: Path,
            f4_mode: str) -> dict:
    """干跑验 digest:直写路洁净前置+权重在盘+graph 回读一致。失败=退出码 2。"""
    digest: dict = {"shot": shot, "at": dt.datetime.now().isoformat(timespec="seconds")}
    wf = json.loads(WF_QWEN.read_text(encoding="utf-8"))
    # ① 直写路洁净前置:qwen21-t2i 无剥离/拼接/收束句件(收束句[215]/[216]只在 qi21 件)
    bad_types = {"RegexReplace", "StringConcatenate"}
    offenders = [f"{n['id']}:{n['type']}" for n in wf["nodes"] if n["type"] in bad_types]
    ids = {n["id"] for n in wf["nodes"]}
    digest["directPathClean"] = {
        "no_strip_concat_nodes": not offenders, "offenders": offenders,
        "no_215_216": not ({215, 216} & ids),
        "note": "S10 W1 收束句在 qi21-道劫-t2i.json 装配子图;qwen21 通用线无涉(直写路洁净)"}
    # ② 权重三件套在活引擎 combo
    checks = [("UNETLoader", "unet_name", graph["1"]["inputs"]["unet_name"]),
              ("CLIPLoader", "clip_name", graph["2"]["inputs"]["clip_name"]),
              ("VAELoader", "vae_name", graph["3"]["inputs"]["vae_name"])]
    weight_ok = {}
    for cls, field, val in checks:
        oi = http_json(f"{base}/object_info/{cls}", timeout=20)
        combo = oi[cls]["input"]["required"][field][0]
        weight_ok[f"{cls}.{val}"] = val in combo
    digest["weightsOnDisk"] = weight_ok
    # ③ graph 回读一致(prompt 逐字 md5/seed/宽高/步数)
    g6, g5, g7 = graph["6"]["inputs"], graph["5"]["inputs"], graph["7"]["inputs"]
    digest["graphEcho"] = {
        "prompt_md5": md5(g6["prompt"]), "template_md5_source": md5(prompt_text),
        "prompt_matches_intent": g6["prompt"] == prompt_text,
        "seed": g7["seed"], "expect_seed": SEEDS[shot], "seed_ok": g7["seed"] == SEEDS[shot],
        "width": g5["width"], "height": g5["height"], "size_ok": (g5["width"], g5["height"]) == (1536, 512),
        "steps": g7["steps"], "cfg": g7["cfg"], "sampler": g7["sampler_name"], "scheduler": g7["scheduler"],
        "f4_mode": f4_mode if shot == "f4" else None}
    ok = (digest["directPathClean"]["no_strip_concat_nodes"] and digest["directPathClean"]["no_215_216"]
          and all(weight_ok.values()) and digest["graphEcho"]["prompt_matches_intent"]
          and digest["graphEcho"]["seed_ok"] and digest["graphEcho"]["size_ok"])
    digest["dryRunPass"] = bool(ok)
    path = out_dir / "b4-digest.json"
    prev = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    prev.setdefault("shots", {})[shot] = digest
    prev["updatedAt"] = digest["at"]
    path.write_text(json.dumps(prev, ensure_ascii=False, indent=1), encoding="utf-8")
    return digest


def wait_idle(base: str) -> None:
    t0 = time.time()
    while True:
        q = http_json(f"{base}/queue", timeout=10)
        if len(q.get("queue_running", [])) == 0 and len(q.get("queue_pending", [])) == 0:
            return
        if time.time() - t0 > IDLE_WAIT_MAX_S:
            raise RuntimeError("等待引擎空闲超时")
        time.sleep(5)


def run_shot(base: str, shot: str, out_dir: Path, f4_mode: str, force: bool) -> int:
    rec_path = out_dir / "run-records.json"
    recs = json.loads(rec_path.read_text(encoding="utf-8")) if rec_path.exists() else {}
    prev = recs.get(shot, {})
    png = out_dir / f"{shot}.png"
    if (not force and prev.get("status") == "ok" and png.exists()):
        print(f"[{shot}] 跳过(已完成且产物在盘)")
        return 0
    template = load_template()
    prompt_text, src_note = build_prompt_text(shot, f4_mode, template)
    oi = http_json(f"{base}/object_info", timeout=60)
    graph = build_graph(oi, prompt_text, SEEDS[shot])
    graph["9"]["inputs"]["filename_prefix"] = PREFIX[shot]
    (out_dir / "graphs").mkdir(exist_ok=True)
    (out_dir / "graphs" / f"{shot}.json").write_text(
        json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
    digest = dry_run(base, shot, prompt_text, SEEDS[shot], graph, out_dir, f4_mode)
    if not digest["dryRunPass"]:
        print(f"[{shot}] 干跑验 digest 失败: {json.dumps(digest, ensure_ascii=False)[:600]}")
        return 2
    print(f"[{shot}] 干跑 digest 过: prompt md5={digest['graphEcho']['prompt_md5'][:8]} "
          f"seed={SEEDS[shot]} 1536x512 steps={digest['graphEcho']['steps']} cfg={digest['graphEcho']['cfg']} "
          f"| {src_note}")
    wait_idle(base)
    t0 = time.time()
    try:
        resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID}, timeout=60)
        if resp.get("node_errors"):
            raise RuntimeError(f"节点校验失败: {json.dumps(resp['node_errors'])[:500]}")
        pid = resp["prompt_id"]
        engine_out = Path.home() / "Library/Application Support/漫影工作室/comfyui/output"
        deadline = t0 + CALL_TIMEOUT_S
        entry = None
        while time.time() < deadline:
            hist = http_json(f"{base}/history/{pid}", timeout=20)
            if pid in hist:
                entry = hist[pid]
                break
            time.sleep(3)
        if entry is None:
            raise RuntimeError("执行超时(history 未见完成)")
        status = entry.get("status", {})
        if status.get("status_str") != "success":
            msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
            raise RuntimeError(f"执行失败: {json.dumps(msgs[:1])[:800]}")
        imgs = []
        for _nid, out in (entry.get("outputs") or {}).items():
            for v in (out or {}).values():
                if isinstance(v, list):
                    imgs += [x for x in v if isinstance(x, dict) and "filename" in x]
        if not imgs:
            raise RuntimeError("无输出产物")
        img = imgs[0]
        # /view 取图:逐参 quote(旧版误把 urlencode 当单参引用传串,ValueError,
        # f1 发已执行成功、产物由 history 回收零加发——本修后续发不再触)
        url = (f"{base}/view?filename={urllib.parse.quote(img['filename'])}"
               f"&subfolder={urllib.parse.quote(img.get('subfolder', ''))}"
               f"&type={urllib.parse.quote(img.get('type', 'output'))}")
        with urllib.request.urlopen(url, timeout=120) as r:
            data = r.read()
        png.write_bytes(data)
        rec = {"status": "ok", "prompt_id": pid, "seed": SEEDS[shot], "f4_mode": f4_mode,
               "engineFile": img["filename"], "engineOut": str(engine_out / img.get("subfolder", "") / img["filename"]),
               "png": str(png), "pngBytes": len(data), "templateNote": src_note,
               "promptMd5": digest["graphEcho"]["prompt_md5"],
               "wall_s": round(time.time() - t0, 1),
               "at": dt.datetime.now().isoformat(timespec="seconds")}
    except Exception as exc:  # noqa: BLE001
        rec = {"status": "failed", "error": str(exc)[:800], "seed": SEEDS[shot], "f4_mode": f4_mode,
               "at": dt.datetime.now().isoformat(timespec="seconds")}
    recs[shot] = rec
    rec_path.write_text(json.dumps(recs, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[{shot}] {rec['status']} wall={rec.get('wall_s','?')}s png={rec.get('pngBytes','?')}B")
    return 0 if rec["status"] == "ok" else 1


def main() -> None:
    import urllib.parse  # noqa: F401 顶层 import 会在 --help 提前退出场景下多余,此处按需
    ap = argparse.ArgumentParser()
    ap.add_argument("--shot", required=True, choices=["f1", "f2", "f4"])
    ap.add_argument("--base-url", default="http://127.0.0.1:17599")
    ap.add_argument("--out-dir", type=Path, default=OUT_DIR_DEFAULT)
    ap.add_argument("--f4-mode", default="generalization", choices=["generalization", "lesion"])
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    try:
        sys.exit(run_shot(args.base_url, args.shot, args.out_dir, args.f4_mode, args.force))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"[{args.shot}] 运行器异常(退出码 2): {exc}")
        sys.exit(2)


if __name__ == "__main__":
    import urllib.parse  # run_shot 内使用
    main()
