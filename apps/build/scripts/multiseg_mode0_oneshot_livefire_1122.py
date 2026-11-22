#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1122 解旁路实弹判决门:一镜到底 整图一发两态(默认 1065=False / 修脸 1065=True)。

背景(README 9999 刻碑):1115 整图一发含段B 曾原生崩引擎(mode=4 全链驻留下 ReCaVSR 上卡,
零 traceback)而立两步法;1118 起 1066 LowVRAM+ChunkFFN 削峰改变显存格局,1122 用户裁定
解旁路(mode 4→0)恢复整图一发——本门即两态判决,崩则如实上报(回退须用户再裁)。

构造纪律:图构造 import 生成器单一真源(禁复制):
  - 段A/段B 37+3 节点 = multiseg_full3stage_extend.build_full3stage_graph / build_stageA_api /
    build_stageB_api(4002.video 改回 3053 内联,去 300 LoadVideo);
  - 四采 25 节点 = multiseg_inline_facerefine_build_1118.api_node(5002.video/5100.on_false
    覆写 4002;5011 身份栈=canvas 终版 insightface+0.28 免 CLIPVision;5012 弹参考图键
    =画布零参考出厂);
  - 1066 LowVRAM+3011 ChunkFFN=2 = lowvram_dual_node_1118 常量镜像画布终态(整图一发含削峰)。

断言:
  A 态:outputs 含 4(p1)/3071(p2)/4003(p3)/4100(p-final);p3 与 p-final 规格=3840×2220
       24fps 56 帧(scale=2.667 修复后才是真 4K);p-final≡p3 直通(md5 报告)。
  B 态:同上四产物;history prompt 复核 5002.inputs.video==['4002',0] 且 4002 scale=2.667;
       p-final=修脸出片(规格同 4K)。
  发前 /queue 双空;产物归集 apps/output/multiseg-mode0-oneshot-1122/。
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "apps/build/scripts"))
import multiseg_full3stage_extend as EXT   # noqa: E402  段A/段B 图构造单一真源
import multiseg_inline_facerefine_build_1118 as IB  # noqa: E402  四采 25 节点 API 真源
import lowvram_dual_node_1118 as LV        # noqa: E402  1066/ChunkFFN 削峰常量

ENGINE = "http://192.168.0.101:17000"
OUT_DIR = REPO / "apps/output/multiseg-mode0-oneshot-1122"
CLIENT_ID = "multiseg-mode0-oneshot-1122"
POLL = 10
TIMEOUT_A = 60 * 45
TIMEOUT_B = 60 * 50

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 禁系统代理


def http_json(method: str, path: str, payload: dict | None = None, timeout: int = 30) -> dict:
    req = urllib.request.Request(ENGINE + path, method=method)
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    with _opener.open(req, data=data, timeout=timeout) as r:
        body = r.read().decode("utf-8")
    return json.loads(body) if body.strip() else {}


def download(path_qs: str, dest: Path) -> Path:
    with _opener.open(ENGINE + path_qs, timeout=600) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return dest


def build_prompt(face: bool) -> dict:
    """整图一发 prompt(镜像画布终态拓扑;禁复制真源,全部 import 构造)。"""
    base = json.loads(EXT.WF_PATH.read_text(encoding="utf-8"))
    graph = EXT.build_full3stage_graph(base)
    prompt = EXT.build_stageA_api(graph)                 # 37 节点(段A:一采+二采+README 除名)
    apiB = EXT.build_stageB_api(graph, source_file="")   # 4001/4002/4003 + 300 LoadVideo(两发形态)
    apiB.pop("300")                                      # 一发形态:4002 直吃 3053(画布内联语义)
    apiB["4002"]["inputs"]["video"] = ["3053", 0]
    prompt.update(apiB)
    for k in IB.OWN:                                     # 四采 25 节点(画布语义覆写)
        d = IB.api_node(str(k))
        ins = d["inputs"]
        if k == 5002:
            ins["video"] = ["4002", 0]                   # 1122 回正:拆帧吃三采 p3
        elif k == 5100:
            ins["on_false"] = ["4002", 0]                # 旁路态终档=4002 p3 直通
        elif k == 5012:
            ins.pop("ref_images.ref_image_0", None)      # 画布零参考出厂(API 模板 9 号件不在一发图)
        elif k == 5011:                                  # 1118 收尾身份栈:insightface+0.28,免 CLIPVision
            ins["identity_threshold"] = IB.WIDGETS[5011][11]
            ins["identity_model"] = IB.WIDGETS[5011][16]
            ins.pop("identity_clip_vision", None)
        prompt[str(k)] = d
    # 1066 削峰镜像(lowvram 役画布终态:34→1066→{41,1021,5006};3011 chunks=2)
    prompt["1066"] = {"class_type": LV.NEW_TYPE,
                      "inputs": {"model": ["34", 0], "head_chunks": LV.HEAD_CHUNKS}}
    for nid in ("41", "1021"):
        prompt[nid]["inputs"]["model"] = ["1066", 0]
    prompt["5006"]["inputs"]["model"] = ["1066", 0]
    prompt["3011"]["inputs"]["chunks"] = LV.CHUNKFFN_NEW_WV[0]
    prompt["1065"]["inputs"]["value"] = face
    return prompt


def validate_prompt(p: dict) -> None:
    for nid, n in p.items():
        for v in n["inputs"].values():
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and isinstance(v[1], int):
                assert v[0] in p, f"悬空节点引用 [{nid}].{v}"


def wait_queue_empty(timeout: int = 3600) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout:
        q = http_json("GET", "/queue")
        if not q.get("queue_running") and not q.get("queue_pending"):
            print("  queue 双空 ✓")
            return
        time.sleep(POLL)
    raise SystemExit("等待队列清空超时")


def submitAndWait(prompt: dict, tag: str, timeout: int) -> dict:
    stats = http_json("GET", "/system_stats")
    q = http_json("GET", "/queue")
    if q.get("queue_running") or q.get("queue_pending"):
        raise SystemExit(f"[{tag}] 队列非空 fail-fast: {q}")
    print(f"[{tag}] 引擎 {stats.get('system', {}).get('comfyui_version', '?')} 活,queue 双空 ✓;提交({len(prompt)} 节点)")
    r = http_json("POST", "/prompt", {"prompt": prompt, "client_id": CLIENT_ID})
    if "prompt_id" not in r:
        raise SystemExit(f"[{tag}] 提交失败: {json.dumps(r)[:800]}")
    pid = r["prompt_id"]
    print(f"[{tag}] prompt_id={pid};轮询 history …")
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = http_json("GET", f"/history/{pid}")
        if pid in h:
            entry = h[pid]
            st = entry.get("status", {})
            if st.get("status_str") == "error":
                msgs = json.dumps(st)[:2000]
                for m in st.get("messages", []):
                    if m and str(m[0]) in ("execution_error", "execution_interrupted"):
                        msgs = json.dumps(m[1])[:2000]
                raise SystemExit(f"[{tag}] 执行错误: {msgs}")
            print(f"[{tag}] 完成({int(time.time()-t0)}s)")
            return entry
        time.sleep(POLL)
    raise SystemExit(f"[{tag}] 超时 {timeout}s")


def outputs_of(entry: dict, want: list[int]) -> dict[int, dict]:
    outs = entry.get("outputs", {})
    found = {}
    for nid in want:
        o = outs.get(str(nid)) or {}
        for key in ("gifs", "videos", "images"):
            if o.get(key):
                found[nid] = o[key][-1]
                break
    missing = [n for n in want if n not in found]
    if missing:
        raise SystemExit(f"history 缺产物节点 {missing}: {json.dumps(outs)[:600]}")
    return found


def fetch(item: dict, dest: Path) -> Path:
    qs = urllib.parse.urlencode({"filename": item["filename"],
                                 "subfolder": item.get("subfolder", ""),
                                 "type": item.get("type", "output")})
    return download(f"/view?{qs}", dest)


def ffprobe(path: Path) -> dict:
    import subprocess
    out = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", str(path)],
                         capture_output=True, text=True, check=True)
    v = next(s for s in json.loads(out.stdout)["streams"] if s["codec_type"] == "video")
    return {"width": v["width"], "height": v["height"], "fps": v["r_frame_rate"], "frames": int(v.get("nb_frames") or 0)}


def md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run_state(face: bool, tag: str, timeout: int) -> dict:
    prompt = build_prompt(face)
    validate_prompt(prompt)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"prompt-{tag}.json").write_text(json.dumps(prompt, ensure_ascii=False, indent=2), encoding="utf-8")
    entry = submitAndWait(prompt, tag, timeout)
    items = outputs_of(entry, [4, 3071, 4003, 4100])
    saved = {}
    for nid, name in ((4, "p1"), (3071, "p2"), (4003, "p3"), (4100, "p-final")):
        saved[name] = fetch(items[nid], OUT_DIR / f"{tag}-{name}.mp4")
    meta = {name: ffprobe(p) for name, p in saved.items()}
    for name, m in meta.items():
        print(f"  {name}: {m['width']}x{m['height']} {m['fps']}fps {m['frames']}帧")
    # 规格断言:三采 4K 出厂(scale2.667 修复后才成立)+帧数/fps
    for name in ("p3", "p-final"):
        m = meta[name]
        assert (m["width"], m["height"]) == (3840, 2220), f"[{tag}] {name} 规格 {m} 应 3840×2220(真 4K)"
        assert abs(eval(m["fps"]) - 24.0) < 0.01, f"[{tag}] {name} fps={m['fps']} 非 24"
        assert m["frames"] == 56, f"[{tag}] {name} 帧数 {m['frames']} 应 56(出厂 2×1秒)"
    # history prompt 复核:1122 回正接线 + scale 正典
    # 0.46.x history 形:[2, prompt_id, prompt_dict, extra_data, outputs_to_execute]
    pr = entry["prompt"][2] if isinstance(entry.get("prompt"), list) else entry["prompt"]
    v5002 = pr["5002"]["inputs"]["video"]
    scale = pr["4002"]["inputs"]["scale"]
    assert v5002 == ["4002", 0], f"[{tag}] history prompt 5002.video={v5002} 应 ['4002',0]"
    assert abs(scale - 2.667) < 1e-6, f"[{tag}] history prompt 4002.scale={scale} 应 2.667"
    sw = pr["5100"]["inputs"]
    assert sw["on_false"] == ["4002", 0] and sw["on_true"] == ["5113", 0], f"[{tag}] 5100 接线 {sw}"
    same = md5(saved["p3"]) == md5(saved["p-final"])
    print(f"[{tag}] ✓ 5002←4002/scale2.667/规格 4K 断言过;p3≡p-final md5 同={same}(A 态应 True)")
    return {"meta": meta, "p3_eq_pfinal": same,
            "prompt_5002": v5002, "scale": scale}


def main() -> int:
    print("== 发 A(默认态 1065=False:p-final=4002 p3 直通)==")
    a = run_state(False, "A-default", TIMEOUT_A)
    if not a["p3_eq_pfinal"]:
        print("  ⚠ A 态 p3≠p-final md5(规格已同;直通性以规格+探针史为准,如实记录)")
    wait_queue_empty()
    print("== 发 B(修脸态 1065=True:三采 p3 → 四采修脸 → p-final)==")
    b = run_state(True, "B-facerefine", TIMEOUT_B)
    summary = {
        "ok": True,
        "A": {"meta": a["meta"], "p3_eq_pfinal_md5": a["p3_eq_pfinal"]},
        "B": {"meta": b["meta"], "p3_eq_pfinal_md5": b["p3_eq_pfinal"]},
        "verdict": "整图一发两态全绿(1122 解旁路判决:1118 削峰后显存格局撑住 mode0 一发)",
    }
    (OUT_DIR / "livefire-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
