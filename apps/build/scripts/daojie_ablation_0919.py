#!/usr/bin/env python3
"""道劫九型出图缺陷消融实弹(09-19):单变量 7 跑,定位「过于电影化/细线布满」根因。

对 apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json
(工作树现态:78×1/46×0.8/81×0.01/67×1/73×0.3 全激活):
  v0_baseline = 现状原样,唯 [63] per_layer_weights 显式强制作者档
                1,1,1,1,1,1,1,2.5,5.0,1.1,4.0 —— 工作树文件 widgets_values_named
                已是全 1.0 而 widgets_values 数组才是作者档;引擎前端加载与仓库
                ui_to_api 转换均 named 优先(前端 bundle createWidgetRestorationState
                实证),若不显式强制,v0 会静默取中性 → v0≡v1 实验报废。
  v1_no63 = 63 per_layer_weights 全 1.0(中性)
  v2_no78 = [78] 电影感 strength_model 0   v3_no46 = [46] 光影 0
  v4_no81 = [81] 服从度 0                  v5_no67 = [67] 细节 0
  v6_no73 = [73] 水墨武侠漆艺鎏金 0
共同:seed=42 内联 [12];场景型测试面——[80].base=「场景」、[50]=暮春祭坛
场景句(原样);分辨率压 1280x720 内联 [53](绕开 [61] UI 件);步数/cfg 用
工作流现值(4/1)。转换复用 daojie_livefire_0917.ui_to_api(object_info+named
对齐、mode=4 旁路穿透、MarkdownNote 跳过);[80].negative 未连线,位置回退
会误填 widgets_values[0],照 projector_ab 惯例弹出该键忠实还原画布语义。

纪律:每跑提交前查 /queue(pending/running 非空先等,上限 10 分钟,超时如实
跳过);单跑 /history 轮询上限 6 分钟;[62] 回读最终正向,须以「场景」底座
开头且含主体句开头「暮春时节的黄昏」,否则该跑计 invalid 不出图不评审。
成图经 /view 下载 → ~/Downloads/daojie_ablation_0919/vN_名.png + 工作区
docs/prompts/道劫_九型实弹_0919/ablation/ 同名副本。任何失败如实报 ran=false。

用法:python3 apps/build/scripts/daojie_ablation_0919.py [--base-url http://127.0.0.1:17000]
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from daojie_livefire_0917 import http_bytes, http_json, ui_to_api  # noqa: E402

WF_DAOJIE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
             / "K2-文生图-道劫.json")
DOWNLOADS = Path.home() / "Downloads" / "daojie_ablation_0919"
WS_COPY = REPO / "docs/prompts/道劫_九型实弹_0919" / "ablation"
CLIENT_ID = "daojie-ablation-0919"
SEED = 42
WIDTH, HEIGHT = 1280, 720
EXEC_TIMEOUT_S = 360   # 单跑上限 6 分钟
IDLE_WAIT_MAX_S = 600  # 提交前队列礼让上限 10 分钟
POLL_S = 4

SUBJECT = ("暮春时节的黄昏,废弃的上古祭坛深藏在群山环抱的谷底,九根断裂的石柱围成半圆,"
           "坛心一泓浅潭映出残阳;谷口白雾正缓缓漫入,远山三重叠影渐次淡去。")
SUBJECT_HEAD = "暮春时节的黄昏"  # [62] 回读校验锚

AUTHOR_PLW = "1.0,1.0,1.0,1.0,1.0,1.0,1.0,2.5,5.0,1.1,4.0,1.0"
NEUTRAL_PLW = "1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0"

RUNS = [
    ("v0_baseline", {}),
    ("v1_no63", {"63.per_layer_weights": NEUTRAL_PLW}),
    ("v2_no78", {"78.strength_model": 0.0}),
    ("v3_no46", {"46.strength_model": 0.0}),
    ("v4_no81", {"81.strength_model": 0.0}),
    ("v5_no67", {"67.strength_model": 0.0}),
    ("v6_no73", {"73.strength_model": 0.0}),
]
COMMON_OVERRIDES = {
    "12.seed": SEED,          # 内联字面量(绕开 rgthree 种子件 [20])
    "53.width": WIDTH,        # ~1MP 16:9(绕开 ResolutionSelector [61])
    "53.height": HEIGHT,
    "50.value": SUBJECT,      # 场景主体句(原样)
    "80.base": "场景",        # 底座下拉=场景(逐字)
    "63.per_layer_weights": AUTHOR_PLW,  # 作者档显式强制(见模块 docstring)
}


def wait_idle(base: str) -> bool:
    """队列礼让:pending/running 全空返回 True;忙则等,超时返回 False。"""
    t0 = time.time()
    while time.time() - t0 < IDLE_WAIT_MAX_S:
        q = http_json(f"{base}/queue", timeout=10)
        if not q.get("queue_running") and not q.get("queue_pending"):
            return True
        time.sleep(5)
    return False


def wait_done(base: str, pid: str) -> tuple[dict | None, float]:
    t0 = time.time()
    while time.time() - t0 < EXEC_TIMEOUT_S:
        hist = http_json(f"{base}/history/{pid}", timeout=20)
        if pid in hist:
            return hist[pid], round(time.time() - t0, 1)
        time.sleep(POLL_S)
    return None, round(time.time() - t0, 1)


def first_image(entry: dict) -> dict | None:
    for _nid, out in (entry.get("outputs") or {}).items():
        for imgs in (out or {}).values():
            if isinstance(imgs, list):
                for x in imgs:
                    if isinstance(x, dict) and "filename" in x:
                        return x
    return None


def final_positive(entry: dict) -> str | None:
    out62 = (entry.get("outputs") or {}).get("62") or {}
    texts = out62.get("text") or []
    if isinstance(texts, list) and texts and isinstance(texts[0], str):
        return texts[0]
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="道劫九型缺陷单变量消融 7 跑")
    ap.add_argument("--base-url", default="http://127.0.0.1:17000")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    WS_COPY.mkdir(parents=True, exist_ok=True)

    wf = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)

    results = []
    for name, extra in RUNS:
        overrides = dict(COMMON_OVERRIDES)
        overrides.update(extra)
        graph = ui_to_api(wf, oi, overrides)
        # [80].negative forceInput 可选槽未连线,位置回退误填 widgets_values[0],
        # 弹出=忠实还原画布语义(同 daojie_projector_ab_0919 惯例)
        graph["80"]["inputs"].pop("negative", None)
        key_inputs = {
            "12.seed": graph["12"]["inputs"]["seed"],
            "12.steps": graph["12"]["inputs"]["steps"],
            "12.cfg": graph["12"]["inputs"]["cfg"],
            "53.width": graph["53"]["inputs"]["width"],
            "53.height": graph["53"]["inputs"]["height"],
            "80.base": graph["80"]["inputs"]["base"],
            "63.per_layer_weights": graph["63"]["inputs"]["per_layer_weights"],
            "46.strength_model": graph["46"]["inputs"]["strength_model"],
            "67.strength_model": graph["67"]["inputs"]["strength_model"],
            "73.strength_model": graph["73"]["inputs"]["strength_model"],
            "78.strength_model": graph["78"]["inputs"]["strength_model"],
            "81.strength_model": graph["81"]["inputs"]["strength_model"],
        }

        if not wait_idle(base):
            results.append({"name": name, "ran": False,
                            "skip_reason": f"引擎忙(礼让等待>{IDLE_WAIT_MAX_S}s)"})
            continue

        t0 = time.time()
        resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID}, timeout=60)
        if resp.get("node_errors"):
            results.append({"name": name, "ran": False, "skip_reason": "node_errors",
                            "detail": json.dumps(resp["node_errors"], ensure_ascii=False)[:800]})
            continue
        pid = resp["prompt_id"]
        entry, wall = wait_done(base, pid)
        if entry is None:
            results.append({"name": name, "ran": False,
                            "skip_reason": f"超时(>{EXEC_TIMEOUT_S}s)", "prompt_id": pid})
            continue
        status = entry.get("status", {})
        if status.get("status_str") != "success":
            errs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
            results.append({"name": name, "ran": False, "skip_reason": "execution_failed",
                            "detail": errs[:1], "prompt_id": pid})
            continue

        final = final_positive(entry)
        ok_head = bool(final and final.startswith("现代修仙游戏的场景设定资产"))
        ok_subj = bool(final and SUBJECT_HEAD in final)
        if not (ok_head and ok_subj):
            results.append({"name": name, "ran": False, "skip_reason": "final_positive 校验失败",
                            "head_ok": ok_head, "subj_ok": ok_subj,
                            "final_head_80": (final or "")[:80], "prompt_id": pid})
            continue

        image = first_image(entry)
        if image is None:
            results.append({"name": name, "ran": False, "skip_reason": "history 无图片输出",
                            "prompt_id": pid})
            continue
        q = (f"filename={urllib.parse.quote(image['filename'])}"
             f"&subfolder={urllib.parse.quote(image.get('subfolder', ''))}&type=output")
        png = http_bytes(f"{base}/view?{q}")
        fname = f"{name}.png"
        out_dl = DOWNLOADS / fname
        out_dl.write_bytes(png)
        out_ws = WS_COPY / fname
        shutil.copyfile(out_dl, out_ws)
        results.append({"name": name, "ran": True, "prompt_id": pid, "wall_s": wall,
                        "bytes": len(png), "output": str(out_dl), "ws_copy": str(out_ws),
                        "engine_image": image["filename"], "key_inputs": key_inputs,
                        "final_positive_len": len(final or "")})
        print(f"[ablation] {name} 完成 wall={wall}s -> {out_dl.name}", flush=True)

    report = {"status": "done", "runs": results,
              "ok_count": sum(1 for r in results if r.get("ran")),
              "common": {"seed": SEED, "width": WIDTH, "height": HEIGHT,
                         "base": "场景", "subject_head": SUBJECT_HEAD,
                         "steps_cfg": "工作流现值(见各跑 key_inputs,应为 4/1)"}}
    (WS_COPY / "runs_audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1), flush=True)
    return 0 if all(r.get("ran") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
