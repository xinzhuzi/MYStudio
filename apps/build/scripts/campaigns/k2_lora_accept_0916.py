#!/usr/bin/env python3
"""09-16 一次性脚本:K2 新 LoRA 接入实测(阶段4实弹)
矩阵(全部 1024x1024, seed=20260916, 安全题材):
  A superset_default   超集默认原样回归(速度档4步/cfg1, 风格库ON, 新LoRA全旁路)
  B quality_baseline   质量档基线(12步/cfg5, 46/47/60旁路=纯净归因口径)
  C quality_detail     B + [67]细节滑杆 ON
  D quality_watercolor B + [68]柔水彩 ON   (触发词 art deco watercolor style)
  E quality_darkbrush  B + [69]暗笔刷 ON   (触发词 monochrome ink wash style)
  F quality_retroanime B + [70]复古漫 ON   (触发词 purple retro anime style)
  G1 style_ref_on      风格参照工作流,[72]ON, 参考图=example.png(默认速度档)
  G2 style_ref_off     同G1但[72]旁路(对照:仅参考图conditioning)
产物收 /tmp/k2_lora_accept/,拼2张contact sheet,计时入results json。
用法: python3 k2_lora_accept_0916.py   (后台跑, 写 /tmp/k2_lora_accept/accept.exit)
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
P2 = REPO / "apps/build/scripts/p2_duipai_run.py"
WF_SUPERSET = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-K2_文生图_超集.json"
WF_STYLE = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-K2-文生图_风格参照.json"
OUT_DIR = Path("/tmp/k2_lora_accept")
OUT_DIR.mkdir(parents=True, exist_ok=True)

SEED = 20260916
CONTENT_PROMPT = ("一位黑发少女穿着齐胸襦裙站在盛开的桃花树下,全身像,服饰完整,"
                  "双手轻扶花枝,柔和的春日光线")
TRIGGERS = {
    "D": "art deco watercolor style",
    "E": "monochrome ink wash style",
    "F": "purple retro anime style",
}

spec = importlib.util.spec_from_file_location("p2", P2)
p2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p2)
BASE = p2.BASE_URL_DEFAULT


def http_json(url: str, data=None, timeout=30):
    req = urllib.request.Request(url, json.dumps(data).encode() if data else None,
                                 {"Content-Type": "application/json"},
                                 method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def load_wf(path: Path, mode_flips: dict[int, int] | None = None) -> dict:
    wf = json.loads(path.read_text(encoding="utf-8"))
    for n in wf["nodes"]:
        if mode_flips and n["id"] in mode_flips:
            n["mode"] = mode_flips[n["id"]]
    return wf


def run_one(test_id: str, wf: dict, overrides: dict, oi: dict) -> dict:
    graph = p2.ui_to_api_t2i(wf, oi, overrides)
    (OUT_DIR / f"graph_{test_id}.json").write_text(json.dumps(graph, ensure_ascii=False, indent=1))
    p2.wait_idle(BASE)
    t0 = time.time()
    resp = http_json(f"{BASE}/prompt", {"prompt": graph, "client_id": "k2-lora-accept-0916"}, timeout=60)
    if resp.get("node_errors"):
        raise RuntimeError(f"{test_id} 节点校验失败: {json.dumps(resp['node_errors'])[:600]}")
    pid = resp["prompt_id"]
    while time.time() - t0 < 2400:
        hist = http_json(f"{BASE}/history/{pid}", timeout=20)
        if pid in hist:
            entry = hist[pid]
            break
        time.sleep(3)
    else:
        raise RuntimeError(f"{test_id} 执行超时")
    status = entry.get("status", {})
    if status.get("status_str") != "success":
        msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
        raise RuntimeError(f"{test_id} 执行失败: {json.dumps(msgs[:1])[:900]}")
    wall = round(time.time() - t0, 1)
    outs = []
    for _nid, out in (entry.get("outputs") or {}).items():
        for imgs in (out or {}).values():
            if isinstance(imgs, list):
                outs += [x for x in imgs if isinstance(x, dict) and "filename" in x]
    if not outs:
        raise RuntimeError(f"{test_id} 无输出")
    o = outs[0]
    src = p2.ENGINE_OUT / o.get("subfolder", "") / o["filename"]
    dst = OUT_DIR / f"{test_id}_{src.name}"
    shutil.copy(src, dst)
    print(f"[{test_id}] ok {wall}s -> {dst.name}", flush=True)
    return {"test": test_id, "wall_s": wall, "file": str(dst), "engine_file": str(src)}


def contact_sheet(name: str, tests: list[str], results: dict, cols: int):
    cell, label_h = 384, 34
    items = [results[t] for t in tests if t in results]
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + label_h)), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for i, it in enumerate(items):
        im = Image.open(it["file"]).resize((cell, cell))
        x, y = (i % cols) * cell, (i // cols) * (cell + label_h)
        sheet.paste(im, (x, y + label_h))
        d.text((x + 6, y + 9), f"{it['test']}  {it['wall_s']}s", fill=(240, 240, 240))
    path = OUT_DIR / name
    sheet.save(path)
    print(f"sheet: {path}", flush=True)


def main():
    oi = http_json(f"{BASE}/object_info", timeout=60)
    results: dict[str, dict] = {}
    errors: dict[str, str] = {}

    common = {"12.seed": SEED, "53.width": 1024, "53.height": 1024}

    def attempt(tid, wf, ov):
        try:
            results[tid] = run_one(tid, wf, dict(common, **ov), oi)
        except Exception as e:
            errors[tid] = str(e)
            print(f"[{tid}] FAILED: {e}", flush=True)

    # A 超集默认原样(仅固定种子/尺寸/前缀)
    attempt("A_superset_default", load_wf(WF_SUPERSET),
            {"4.filename_prefix": "k2accept_A_"})

    # B..F 质量档矩阵: 46/47/60 旁路(纯净归因), 12步/cfg5
    q_flips = {46: 4, 47: 4, 60: 4}
    q_over = {"50.value": CONTENT_PROMPT, "12.steps": 12, "12.cfg": 5.0,
              "4.filename_prefix": "k2accept_B_"}
    attempt("B_quality_base", load_wf(WF_SUPERSET, q_flips), q_over)
    attempt("C_detail_on", load_wf(WF_SUPERSET, {**q_flips, 67: 0}),
            {**q_over, "4.filename_prefix": "k2accept_C_"})
    for tid, nid in (("D_watercolor_on", 68), ("E_darkbrush_on", 69), ("F_retroanime_on", 70)):
        prompt = f"{CONTENT_PROMPT}, {TRIGGERS[tid[0]]}"
        attempt(tid, load_wf(WF_SUPERSET, {**q_flips, nid: 0}),
                {**q_over, "50.value": prompt, "4.filename_prefix": f"k2accept_{tid[0]}_"})

    # G1/G2 风格参照工作流(默认速度档), 60 旁路;参考图 example.png
    # LoadImage 的 image widget 是位置式,转换前补 named(转换器对空映射节点会在
    # 覆盖前抛错),overrides 里仍留一份双保险
    def load_style_wf(flips):
        wf = load_wf(WF_STYLE, flips)
        for n in wf["nodes"]:
            if n["id"] == 71:
                n["widgets_values_named"] = {"image": "example.png"}
        return wf
    g_over = {"71.image": "example.png", "50.value": CONTENT_PROMPT,
              "4.filename_prefix": "k2accept_G1_"}
    attempt("G1_style_ref_on", load_style_wf({60: 4}), g_over)
    attempt("G2_style_ref_off", load_style_wf({60: 4, 72: 4}),
            {**g_over, "4.filename_prefix": "k2accept_G2_"})

    contact_sheet("sheet_quality_matrix.jpg",
                  ["B_quality_base", "C_detail_on", "D_watercolor_on", "E_darkbrush_on", "F_retroanime_on"],
                  results, cols=3)
    contact_sheet("sheet_speed_and_styleref.jpg",
                  ["A_superset_default", "G1_style_ref_on", "G2_style_ref_off"], results, cols=3)

    (OUT_DIR / "results.json").write_text(json.dumps(
        {"results": results, "errors": errors}, ensure_ascii=False, indent=1))
    (OUT_DIR / "accept.exit").write_text("ok\n" if not errors else
                                         "failed: " + ", ".join(errors) + "\n")
    print("DONE", "errors:" + str(list(errors)) if errors else "all-ok", flush=True)


if __name__ == "__main__":
    main()
