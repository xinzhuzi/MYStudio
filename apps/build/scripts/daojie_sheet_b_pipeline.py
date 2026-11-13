#!/usr/bin/env python3
"""daojie_sheet_b_pipeline.py — 设定卡 B 线编排(H3-Image 分格生成+程序合成,1112 用户令)。

链路:master t2i(人物海报型三层装配,主体句+型底座+美术风格底座逐字取 qi21_bases.json)
→ H3-Image edit×6 直投(侧/背转 view+面部/侧头/腕/腰推近;指令句锚自设定卡型文格位句)
→ t2i×2(武器=道具型装配/能力特效)→ 程序裁贴合成 3840×2160(daojie_sheet_b_frame.compose)。

API 载荷整图复用 1112 三遍实弹毕的两件真源(禁拆抄拼改):
  t2i  = h3image_daojie14_1112.py build_api(conditioning 直出 latent/CFG1 无负面/6步)
  edit = h3image_smoke_1112.py  build_edit 直投路(images.image_1 点分/宽高 0 随图)
断点续跑:每步产物落 step_XX_<tag>.png,存在即跳过;--compose-only 只重合成。
产物恒单夹:apps/output/daojie-sheet-b-1112/。

用法:python3 daojie_sheet_b_pipeline.py [--subject /tmp/sheet_subject.txt]
            [--name 沈孤鸿] [--seed 0] [--compose-only]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from daojie_sheet_b_frame import (CELL_KEYS, compose, derive_cells,  # noqa: E402
                                  extract_palette)

BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
ENGINE = "http://192.168.0.101:17000"
OUT = REPO / "apps/output/daojie-sheet-b-1112"

# 主机适配四件(1112 装机终版,与 smoke/daojie14 同款)
DIT = "minimax_h3_image_pruned_int8_convrot.safetensors"
TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VAE = "minimax_h3_image_vae_fp16.safetensors"

# 分格真源=qi21_bases.json 顶层 sheet_card 块(1113 道劫正册化:指令/模板/分辨率/
# seed 表逐字取真源,禁手搓;管线零硬编码)
SHEET_REQUIRED_KEYS = ("master", "edit_instructions", "weapon", "effect", "seeds")


def sheet_cfg(bases: dict) -> dict:
    sc = bases.get("sheet_card") or {}
    assert sc.get("format_version") == "v1.1", "sheet_card 真源缺位或版本漂移"
    for k in SHEET_REQUIRED_KEYS + ("master",):
        assert k in sc, f"sheet_card 缺 {k}"
    assert sc["master"].get("positive_text"), "master 底座句缺位(v1.1 起 master 自有底座)"
    return sc


def http_json(url, timeout=20):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def build_t2i(prompt, w, h, seed, prefix):
    """t2i 载荷=daojie14 真源整图复用(conditioning 直出 latent;CFG1 无负面)。"""
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": DIT, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": TE, "type": "minimax", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "5": {"class_type": "MiniMaxH3ImageConditioning",
              "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt,
                         "width": w, "height": h}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["5", 0],
                         "negative": ["6", 0], "latent_image": ["5", 1],
                         "seed": seed, "steps": 6, "cfg": 1.0,
                         "sampler_name": "euler", "scheduler": "simple",
                         "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def build_edit(image_name, instruction, seed, prefix):
    """edit 载荷=smoke 真源直投路(images.image_1 点分;宽高 0=随 image_1)。"""
    return {
        "29": {"class_type": "UNETLoader",
               "inputs": {"unet_name": DIT, "weight_dtype": "default"}},
        "30": {"class_type": "CLIPLoader",
               "inputs": {"clip_name": TE, "type": "minimax", "device": "default"}},
        "31": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "45": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "32": {"class_type": "MiniMaxH3ImageConditioning",
               "inputs": {"clip": ["30", 0], "vae": ["31", 0],
                          "images.image_1": ["45", 0], "width": 0, "height": 0,
                          "prompt": instruction}},
        "33": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["32", 0]}},
        "38": {"class_type": "KSampler",
               "inputs": {"model": ["29", 0], "positive": ["32", 0],
                          "negative": ["33", 0], "latent_image": ["32", 1],
                          "seed": seed, "steps": 6, "cfg": 1.0,
                          "sampler_name": "euler", "scheduler": "simple",
                          "denoise": 1.0}},
        "42": {"class_type": "VAEDecode", "inputs": {"samples": ["38", 0], "vae": ["31", 0]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["42", 0], "filename_prefix": prefix}},
    }


def upload_image(path: Path) -> str:
    """编辑底图上传引擎 input/(smoke 真源 multipart 件;ASCII 名防 GBK 雷)。"""
    boundary = "----sheetB1112"
    fn = f"sheetB_{path.stem[-24:]}.png"
    body = b""
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\""
             f"\r\n\r\ntrue\r\n").encode()
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; "
             f"filename=\"{fn}\"\r\nContent-Type: image/png\r\n\r\n").encode()
    body += path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{ENGINE}/upload/image", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8")).get("name", fn)


def fire(api, tag, dst: Path, deadline=900):
    print(f"[{tag}] 提交…", flush=True)
    body = json.dumps({"prompt": api, "client_id": "daojie-sheet-b-1112"}).encode()
    req = urllib.request.Request(f"{ENGINE}/prompt", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            pid = json.loads(r.read().decode())["prompt_id"]
    except urllib.error.HTTPError as e:
        print(f"[FAIL] {tag} HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:400]}")
        sys.exit(3)
    t0 = time.time()
    while time.time() - t0 < deadline:
        time.sleep(6)
        try:
            h = http_json(f"{ENGINE}/history/{pid}", timeout=20)
        except Exception:
            continue
        if pid in h:
            e = h[pid]
            st = e.get("status", {})
            if st.get("status_str") == "error":
                for mid, m in (st.get("messages") or []):
                    if mid == "execution_error":
                        print(f"[FAIL] {tag} 执行错误:"
                              f"{json.dumps(m, ensure_ascii=False)[:400]}")
                sys.exit(3)
            if st.get("completed"):
                for no in (e.get("outputs") or {}).values():
                    for img in no.get("images", []):
                        if img.get("type") != "output":
                            continue
                        q = urllib.parse.urlencode(
                            {"filename": img["filename"],
                             "subfolder": img.get("subfolder", ""),
                             "type": "output"})
                        with urllib.request.urlopen(f"{ENGINE}/view?{q}",
                                                    timeout=180) as r:
                            dst.write_bytes(r.read())
                print(f"[{tag}] PASS {time.time() - t0:.0f}s → {dst.name}", flush=True)
                return
    print(f"[FAIL] {tag} 超时 {deadline}s")
    sys.exit(4)


def parse_subject(path: Path):
    text = path.read_text(encoding="utf-8").strip()
    fields = {}
    for part in text.replace("\n", "").split("|"):
        if ":" in part:
            k, v = part.split(":", 1)
            fields[k.strip()] = v.strip()
    return text, fields


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--subject", default="/tmp/sheet_subject.txt")
    ap.add_argument("--name", default="沈孤鸿")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--compose-only", action="store_true")
    ap.add_argument("--title-size", type=int, default=None,
                    help="覆盖 frame.TITLE_SIZE(逐步调版旋钮;不传=用底框常量)")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    import daojie_sheet_b_frame as frame
    if args.title_size:
        frame.NAME_SIZE = args.title_size  # 逐步调版旋钮(默认=底框常量)

    bases = json.loads(BASES.read_text(encoding="utf-8"))
    sc = sheet_cfg(bases)
    style_pos = bases["art_style_base"]["positive_text"]
    m_base = sc["master"]["positive_text"]  # v1.1 起 master 自有净空立绘底座
    t_item = next(t["positive_text"] for t in bases["types"] if t["zh"] == sc["weapon"]["type"])
    subject_raw, f = parse_subject(Path(args.subject))
    name = f.get("姓名", args.name)

    def step_path(i, tag):
        return OUT / f"step_{i:02d}_{tag}.png"

    # 步表:(tag, 依赖tag|None, 构造器)
    def steps():
        yield "master", None, build_t2i(
            "\n".join([subject_raw, m_base, style_pos]),
            sc["master"]["width"], sc["master"]["height"],
            args.seed, "sheetB/master")
        for tag in ("side", "back", "face", "wrist", "waist"):
            yield tag, "master", None  # edit 需先有 master 落盘再构造
        yield "head", "side", None
        yield "weapon", None, build_t2i(
            "\n".join([sc["weapon"]["subject_template"].format(
                           name=name, weapon=f.get("武器", "长剑")),
                       t_item, style_pos]),
            sc["weapon"]["width"], sc["weapon"]["height"],
            args.seed, "sheetB/weapon")
        yield "effect", None, build_t2i(
            "\n".join([sc["effect"]["subject_template"].format(
                           ability=f.get("能力", "剑气")),
                       style_pos]),
            sc["effect"]["width"], sc["effect"]["height"],
            args.seed, "sheetB/effect")

    if not args.compose_only:
        # 发车前门:队列空+schema 真源核对(接口边界假设核对纪律)
        q = http_json(f"{ENGINE}/queue", timeout=10)
        if q.get("queue_running") or q.get("queue_pending"):
            print(f"[FAIL] 队列非空,让行:{len(q['queue_running'])}+{len(q['queue_pending'])}")
            return 9
        spec = http_json(f"{ENGINE}/object_info/MiniMaxH3ImageConditioning")[
            "MiniMaxH3ImageConditioning"]["input"]
        req = list((spec.get("required") or {}).keys())
        assert {"clip", "prompt", "width", "height"} <= set(req), req
        cl = http_json(f"{ENGINE}/object_info/CLIPLoader")["CLIPLoader"][
            "input"]["required"]["clip_name"][0]
        assert TE in cl, f"TE 不在 CLIPLoader 名单:{TE}"
        print("[OK] 发车前门全过(队列空/schema/名单)")

        for i, (tag, dep, api) in enumerate(steps()):
            dst = step_path(i, tag)
            if dst.is_file():
                print(f"[{tag}] 已在,跳过", flush=True)
                continue
            if api is None:  # edit 步:依赖落盘图上传后直投
                src = next(p for j, (t2, _, _) in enumerate(steps())
                           if t2 == dep for p in [step_path(j, t2)])
                up = upload_image(src)
                api = build_edit(up, sc["edit_instructions"][tag],
                                 args.seed + sc["seeds"][tag], f"sheetB/{tag}")
            fire(api, tag, dst)

    # ── 合成:直生格+预裁格+配色取色(主体中央带,滤背景)──
    imgs = {p.stem.split("_", 2)[2]: Image.open(p)
            for p in sorted(OUT.glob("step_*.png"))}
    cells = derive_cells(imgs)
    assert set(cells) == set(CELL_KEYS), set(CELL_KEYS) ^ set(cells)

    m = imgs["master"]
    pal_src = m.crop((round(m.width * 0.32), 0, round(m.width * 0.68), m.height))
    palette = extract_palette(pal_src)

    final = OUT / f"设定卡B线_{name}_3840.png"
    compose(cells, palette, name, str(final))
    print(f"[DONE] {final}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
