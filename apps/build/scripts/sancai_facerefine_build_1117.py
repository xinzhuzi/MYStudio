#!/usr/bin/env python3
"""三采-单镜-小脸修复.json 生成器(1117,trellis 11-17-facerefine-sancai-integration §三)。

克隆正典 三采-单镜.json + 追加「四采·小脸修复」组 5001-5024(19 节点):
  节点对象槽结构移植=两类真源——FaceRefine 五件取作者 Auto_Select 画布(上游 main 版端口面,
  含 PerFrameDenoise model 口),常用件取正典件本体;widgets 按 prd §3.1;组框罩全自算 bbox;
  README 9999 增段。幂等:每次从正典源重生成。

1118 起重跑 fail-closed(勿再作为落盘途径):SRC 正典件已内置四采修脸臂(5000 段 id 被占),
重跑在自检「节点 id 重复」assert 处先于 OUT.write_text 退出,不会覆写;克隆件布局自 1118 治役起
由 apps/build/scripts/workflow_layout_fix_sancai_facerefine_band_1118.py 维护,本生成器降为
拓扑/布局历史真源(OUT/POS_1118/组框字段已同批对齐治役现值)。
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json"
AUTO = Path("/tmp/bili-bv15eby6fE2E/H3_Face_Refine_Auto_Select.json")  # 作者上游画布
OUT = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/7_测试/三采-单镜-小脸修复.json"  # df4162c8 迁 7_测试/

PREFIX_P4 = "video/漫影/chapter-002/sb-chapter-002-016/p4-facerefine"
README_APPEND = """

---

## 四采·小脸修复(可选尾段,5001-5024)

- **吃什么**:#5001 LoadVideo 手填 `p3-recavsr` 落盘件路径(三段跑完后);拆帧拆音轨→追踪→重画→贴回→p4-facerefine
- **什么时候用**:远景/中远景小脸糊的镜头;大脸镜 PerFrameDenoise(absolute_px 30/120)自动弱修,不伤
- **模型**:5005/5006 自带裸 Cobijada+turbo 8step 迷你链(与一采同权重=引擎缓存命中,不双载);TE/双 VAE/主图/提示词/帧数复用正典件既有节点
- **注意**:5012 的宽高=5011 追踪器画布出口联线,禁手填;length=52 网格帧数联动
"""


def node_by_type(nodes, t):
    for n in nodes:
        if n["type"] == t:
            return n
    sys.exit(f"[FATAL] 模板缺 {t}")


def strip_links(n: dict) -> dict:
    n = copy.deepcopy(n)
    for sec in ("inputs", "outputs"):
        for slot in n.get(sec, []):
            slot.pop("links", None)
            slot.pop("link", None)
    return n


def main() -> int:
    S = json.loads(SRC.read_text())
    A = json.loads(AUTO.read_text())
    snodes = S["nodes"]

    # ---- 模板库 ----
    tpl = {t: strip_links(node_by_type(snodes, t)) for t in (
        "LoadVideo", "GetVideoComponents", "UNETLoader", "LoraLoaderModelOnly",
        "RandomNoise", "BasicScheduler", "KSamplerSelect", "BasicGuider",
        "SamplerCustomAdvanced", "VAEDecode", "CreateVideo", "SaveVideo",
        "MiniMaxH3ReferenceToVideo")}
    for t in ("H3FaceTrackCrop", "H3InjectVideoLatent", "MiniMaxH3NativeAudioLock",
              "H3PerFrameDenoise", "H3FaceStitch"):
        tpl[t] = strip_links(node_by_type(A["nodes"], t))
    # REF 模板改取正典件 2001(槽超集:prompt/ref_image_0..2/width/height/length 全在)
    tpl["MiniMaxH3ReferenceToVideo"] = strip_links(node_by_type(snodes, "MiniMaxH3ReferenceToVideo"))

    # ---- 布局:1118 画布布局役四采带(分层行带,绝对坐标)----
    # 1117 初版=相对 dx 三排(y_by_id);1118 治役(workflow_layout_fix_sancai_facerefine_band_1118.py)
    # 改分层行带:x 严格右向消 10 左向线、est 同行净距 200/纵堆 80、采样四件同列纵堆(行序=5020
    # 槽序 noise/guider/sampler/sigmas,本件 sampler=5018/sigmas=5017)、尾段 5022-5024 二排(y=7100)。
    # specs 元组第 4 元 dx 就此作废仅存历史,坐标一律以下表为准(与克隆件手术脚本同源)。
    POS_1118 = {
        5001: [2130, 5900], 5002: [2670, 5900], 5011: [3140, 5900],
        5012: [3700, 5900], 5013: [4300, 5900], 5005: [4830, 5900],
        5006: [5670, 5900], 5014: [6510, 5900], 5015: [7040, 5900],
        5016: [7570, 6400], 5019: [7570, 6628], 5018: [7570, 6820], 5017: [7570, 7018],
        5020: [8140, 5900], 5021: [8590, 5900],
        5022: [9040, 7100], 5023: [9570, 7100], 5024: [10040, 7100],
    }

    specs = [
        # (id, type, widgets, dx)
        (5001, "LoadVideo", ["", "image"], 0),
        (5002, "GetVideoComponents", None, 260),
        (5005, "UNETLoader", ["Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors", "default"], 520),
        (5006, "LoraLoaderModelOnly", ["pika_turbo_8step_fl2va.safetensors", 1.0], 780),
        (5011, "H3FaceTrackCrop", None, 0),   # widgets 下方特调
        (5012, "MiniMaxH3ReferenceToVideo", ["", 768, 768, 124, "max"], 420),
        (5013, "H3InjectVideoLatent", None, 760),
        (5014, "MiniMaxH3NativeAudioLock", None, 980),
        (5015, "H3PerFrameDenoise", None, 1220),
        (5016, "RandomNoise", [42, "fixed"], 1460),
        (5017, "BasicScheduler", ["simple", 8, 0.45], 1660),
        (5018, "KSamplerSelect", ["lcm"], 1880),
        (5019, "BasicGuider", None, 2060),
        (5020, "SamplerCustomAdvanced", None, 2240),
        (5021, "VAEDecode", None, 2480),
        (5022, "H3FaceStitch", None, 0),
        (5023, "CreateVideo", [24, 8, "sRGB", "none"], 380),
        (5024, "SaveVideo", [PREFIX_P4, "auto", "video"], 680),
    ]
    new_nodes = []
    for nid, t, wv, dx in specs:   # dx 已废(见 POS_1118 注)
        n = copy.deepcopy(tpl[t])
        n["id"] = nid
        n["pos"] = list(POS_1118[nid])
        if wv is not None:
            n["widgets_values"] = wv
        new_nodes.append(n)

    # TrackCrop 特调 widgets(按上游 INPUT_TYPES 序)
    tc = next(n for n in new_nodes if n["id"] == 5011)
    tc_wv = tc.get("widgets_values")
    # 上游序: images, detector, confidence, crop_factor, canvas_width, canvas_height,
    # canvas_mode, smooth_window, size_smooth_window, smooth_method, size_mode,
    # identity_reference(opt 链), identity_track, identity_threshold, select,
    # fallback_detector, fallback_head_frac, select_index, identity_model,
    # cut_detection, cut_threshold, identity_clip_vision(链), absent_shots, X, Y, frame_index, face_pick(链)
    tc["widgets_values"] = [768, 768] if tc_wv is None else tc_wv  # 保底
    # 直接按已知默认重建(与实弹器同参):
    tc["widgets_values"] = ["face_yolov8m.pt", 0.15, 2.5, 768, 768, "auto_capped_768",
                            21, 51, "gaussian", "per_frame", True, 0.28, "largest_face",
                            "segm\\person_yolov8m-seg.pt", 0.5, 0, "insightface", "none", 3.0, "off", 0, 0, 0]

    # ---- 连线(名寻槽,禁猜索引) ----
    next_link = max((l[0] for l in S["links"]), default=0) + 1

    def slot_index(n, section, name):
        for i, s in enumerate(n.get(section, [])):
            if s["name"] == name:
                return i
        sys.exit(f"[FATAL] #{n['id']} {n['type']} 无{section}槽 {name}:"
                 f"{[s['name'] for s in n.get(section, [])]}")

    wiring = [  # (src_id, src槽名, dst_id, dst槽名)
        (5001, "VIDEO", 5002, "video"),
        (5005, "MODEL", 5006, "model"),
        (5002, "images", 5011, "images"),
        (5011, "crops", 5013, "images"),
        (5011, "transform", 5015, "transform"),
        (5011, "transform", 5022, "transform"),
        (5011, "canvas_w", 5012, "width"),
        (5011, "canvas_h", 5012, "height"),
        (5012, "LATENT", 5013, "av_latent"),
        (1003, "VAE", 5013, "vae"),
        (5013, "av_latent", 5014, "av_latent"),
        (5006, "MODEL", 5014, "model"),
        (5002, "audio", 5014, "audio"),
        (1004, "VAE", 5014, "audio_vae"),
        (5014, "model", 5015, "model"),
        (5014, "av_latent", 5015, "av_latent"),
        (5015, "model", 5017, "model"),
        (5015, "model", 5019, "model"),
        (5012, "positive", 5019, "conditioning"),
        (5016, "NOISE", 5020, "noise"),
        (5019, "GUIDER", 5020, "guider"),
        (5018, "SAMPLER", 5020, "sampler"),
        (5017, "SIGMAS", 5020, "sigmas"),
        (5015, "av_latent", 5020, "latent_image"),
        (5020, "output", 5021, "samples"),
        (1003, "VAE", 5021, "vae"),
        (5021, "IMAGE", 5022, "refined_crops"),
        (5002, "images", 5022, "base_images"),
        (5022, "images", 5023, "images"),
        (5002, "audio", 5023, "audio"),
        (5023, "VIDEO", 5024, "video"),
        # 复用正典件既有节点
        (1002, "CLIP", 5012, "clip"),
        (1003, "VAE", 5012, "vae"),
        (1004, "VAE", 5012, "audio_vae"),
        (1, "IMAGE", 5012, "ref_images.ref_image_0"),
        
        (52, "INT", 5012, "length"),
            ]
    wiring = [w for w in wiring if w[:2] != (1001, "unet")]  # 5005=自载,不接 1001

    id2new = {n["id"]: n for n in new_nodes}
    id2old = {n["id"]: n for n in snodes}

    for src_id, src_name, dst_id, dst_name in wiring:
        src = id2new.get(src_id) or id2old[src_id]
        dst = id2new.get(dst_id) or id2old[dst_id]
        so, di = slot_index(src, "outputs", src_name), slot_index(dst, "inputs", dst_name)
        l = [next_link, src_id, so, dst_id, di, dst["inputs"][di]["type"]]
        S["links"].append(l)
        src["outputs"][so].setdefault("links", []).append(next_link)
        dst["inputs"][di].setdefault("links", []).append(next_link)
        dst["inputs"][di]["link"] = next_link
        next_link += 1

    # 5015 强度曲线按 4K 源口径重标定(30/120→60/200,按值替换防槽位错)
    pfd = next(n for n in new_nodes if n["id"] == 5015)
    pfd_wv = pfd.get("widgets_values")
    if isinstance(pfd_wv, list):
        pfd["widgets_values"] = [60.0 if v == 30.0 else (200.0 if v == 120.0 else v) for v in pfd_wv]

    # 5012 widgets 中的宽高/长度已被联线接管(canvas 联动正典)

    S["nodes"].extend(new_nodes)

    # ---- 组框:罩全自算 bbox ----
    xs = [n["pos"][0] for n in new_nodes]; ys = [n["pos"][1] for n in new_nodes]
    x2 = max(n["pos"][0] + n.get("size", [300, 200])[0] for n in new_nodes)
    y2 = max(n["pos"][1] + n.get("size", [300, 200])[1] for n in new_nodes)
    S["groups"].append({"id": 105, "title": "四采·小脸修复(FaceRefine)",
                        "bounding": [min(xs) - 60, min(ys) - 80,
                                     x2 - min(xs) + 60, y2 - min(ys) + 120],
                        "color": "#995588", "flags": {}, "order": 5})

    # ---- README 9999 增段 ----
    for n in S["nodes"]:
        if n["id"] == 9999:
            md = n["widgets_values"][0]
            if "四采·小脸修复" not in md:
                n["widgets_values"][0] = md + README_APPEND

    # ---- 自检 ----
    ids = [n["id"] for n in S["nodes"]]
    assert len(ids) == len(set(ids)), "节点 id 重复"
    nid = set(ids)
    for l in S["links"]:
        assert l[1] in nid and l[3] in nid, f"悬空链 {l}"
    for n in new_nodes:
        for s in n.get("inputs", []):
            if s["type"] not in ("IMAGE", "LATENT", "MODEL", "VAE", "CLIP", "AUDIO", "VIDEO",
                                 "H3FACEXFORM", "CONDITIONING", "SAM_MODEL", "H3FACEPICK",
                                 "CLIP_VISION", "NOISE", "GUIDER", "SAMPLER", "SIGMAS"):
                continue  # widget 型
            if s.get("link") is None:
                print(f"[WARN] #{n['id']} {n['type']} 输入 {s['name']}({s['type']}) 未连线")

    OUT.write_text(json.dumps(S, ensure_ascii=False, indent=1))
    print(f"[OK] {OUT.name}: {len(S['nodes'])} 节点(66+19) / {len(S['links'])} 链 / {len(S['groups'])} 组")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
