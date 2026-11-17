#!/usr/bin/env python3
"""三采-单镜.json 修脸组内置(默认旁路)生成器(1118,trellis 11-17-facerefine-inline-bypass §1.1/§1.3)。

对正典画布件 + API 模板双输出,同构追加「四采修脸臂」19 节点(拓扑=prd §1.1 修订版:
内存态直连删 5001 LoadVideo、显存修订删 5005 UNETLoader——5006 LoraLoader.model←1001 复用):

  #25   修脸身份提示词 PrimitiveStringMultiline(默认通用句,调用方按角色覆写)
  #1065 四采开关 PrimitiveBoolean(默认 False=旁路;False 时 50xx 臂被引擎惰性剪除)
  5002  GetVideoComponents ← 4002 VIDEO(帧①+音轨②,零文件竞态)
  5006  LoraLoaderModelOnly(model←1001,pika_turbo_8step_fl2va@1.0;全图禁第二个 UNETLoader)
  5011  H3FaceTrackCrop(face_yolov8m conf0.15/兜底 segm\\person_yolov8m-seg.pt/largest_face)
  5012  MiniMaxH3ReferenceToVideo(宽高=5011 canvas_w/canvas_h 出口联线勿手填;length←#52;
        ref_image_0←#1 主图;prompt←#25;clip/vae/audio_vae←1002/1003/1004)
  5013  H3InjectVideoLatent(av_latent←5012.LATENT,images←5011.crops,vae←1003)
  5014  MiniMaxH3NativeAudioLock(model←5006,av_latent←5013,audio←5002②,audio_vae←1004)
  5015  H3PerFrameDenoise(1.0/0.35/absolute_px/60/200/γ1/9;model←5014.model)
  5016-5020 采样链(5016 RandomNoise seed42 同 #54;5017 KSamplerSelect lcm;5018 BasicScheduler
        simple/8步/0.45;5019 BasicGuider(model←5015.model,cond←5012.positive);5020 SamplerCustomAdvanced)
  5021  VAEDecode(←5020,vae←1003)   5022 H3FaceStitch(face_only/16/24/1.0/1.0/fade_out)
  5023  CreateVideo(IMAGE←5022,AUDIO←5002②,24fps)
  5100  ComfySwitchNode(switch←1065,on_true←5023.VIDEO,on_false←4002.VIDEO)
  4100  SaveVideo(video←5100,prefix=video/漫影/chapter-001/sb-chapter-001-001/p-final)

两只组框(四采修脸组 5000 段/终档组 5100+4100+1065+25 就近)bbox 自算罩全;README 9999 增段。

节点数口径:prd §1.1 标题「66+21」为修订前残数(21=19+已删 5001/5005);按拓扑枚举报 19,
画布 66→85、API 64→83。自检按拓扑枚举断言并打印本对账。

幂等:先从当前正典件剥离本组既往添加(节点 id+触及链+两只组框+README 段,剥离前校验类型防误删
他人节点)后整体重放——母本即正典件自身,重跑字节稳定。
用法:
  python3 sancai_inline_facerefine_build_1118.py           # 重建两件
  python3 sancai_inline_facerefine_build_1118.py --check   # 结构自检(读盘上两件)
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CANVAS = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json"
API = REPO / "apps/frontend/lib/assist/image-studio/h3-three-stage-template.api.json"
CLONE = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜-小脸修复.json"

PREFIX_P_FINAL = "video/漫影/chapter-001/sb-chapter-001-001/p-final"
IDENTITY = (
    "The same person as in the video: sharp detailed facial features, clear bright eyes, "
    "well-defined facial contour, refined natural skin texture, clean hair edges; keep the "
    "exact facial identity, skin tone and lighting direction unchanged, no character redesign."
)

# ---- 本组节点规格(id → class_type);剥离与校验共用 ----
OWN: dict[int, str] = {
    25: "PrimitiveStringMultiline", 1065: "PrimitiveBoolean",
    5002: "GetVideoComponents", 5006: "LoraLoaderModelOnly",
    5011: "H3FaceTrackCrop", 5012: "MiniMaxH3ReferenceToVideo",
    5013: "H3InjectVideoLatent", 5014: "MiniMaxH3NativeAudioLock",
    5015: "H3PerFrameDenoise", 5016: "RandomNoise", 5017: "KSamplerSelect",
    5018: "BasicScheduler", 5019: "BasicGuider", 5020: "SamplerCustomAdvanced",
    5021: "VAEDecode", 5022: "H3FaceStitch", 5023: "CreateVideo",
    5100: "ComfySwitchNode", 4100: "SaveVideo",
}
GROUP_A_TITLE = "四采修脸组(5000 段·默认旁路·1118)"
GROUP_B_TITLE = "终档组(p-final·四采开关)"
GROUP_A_IDS = {25, 1065, 5002, 5006, 5011, 5012, 5013, 5014, 5015, 5016, 5017, 5018, 5019, 5020, 5021, 5022, 5023}
GROUP_B_IDS = {5100, 4100}
README_MARK = "\n\n---\n\n## 四采修脸(内置·默认旁路·1118)"
README_SECTION = README_MARK + """

- **开关 #1065「四采修脸」**:默认 **False=旁路**——终档 4100 p-final=三采 p3 直通,50xx 臂被引擎惰性剪除(0.45.2 实证;1118 双态探针旁路态全链 264.3s 恰=纯三采一链,臂零叠加),零成本;**True=三采出片内部走进修脸→终档一条线**(外部只传参数,内部处理流程)
- **#25 修脸身份提示词**:默认通用句;外部按角色覆写(角色五官特征文,参照 #1 主图人物)
- **API 直调**:`g["1065"]["inputs"]["value"]=true` + `g["25"]["inputs"]["value"]="<角色五官特征句>"`,其余注入点与现行三采调用完全一致(图1/21/51/54/31/41)
- **臂拓扑**:5002 拆 4002(帧①+音轨②)→ 5011 追踪裁剪(face_yolov8m conf0.15/兜底 segm\\person_yolov8m-seg.pt/largest_face)→ 5012 H3 重画(**宽高=5011 出口联线勿手填**/length=#52/参考图=#1/提示词=#25)→ 5013 注入真实帧 → 5014 音轨锁(audio←5002②)→ 5015 逐帧 denoise(60/200px)→ 5016-5020 采样(seed 同 #54/lcm/simple/8步/0.45)→ 5021 解码 → 5022 贴回(16/24)→ 5023 合成 → 5100 终档选择 → 4100 p-final
- **极性口径(1118 双态实测定谳)**:**bypass(1065=false)=直通**——p-final 与 p3 MD5 逐字节一致(帧差 0px);**repair(1065=true)=修脸**——远端 t=1s 帧 >12 差分 24,467px;5100 接线 on_true=修脸片(1065=true)/ on_false=p3 直通(1065=false)与实测一致,勿手改(防 wf2api 反转坑)
- **显存纪律**:5006 LoRA 挂 1001 单 loader(全图禁第二个 UNETLoader);p1/p2/p3 两态照常落盘(诊断链完整),MyShot 3061 锚与 3071 零改动
- **生效面**:仓库/引擎直投即时生效;装机 App 面候打包窗口另役同步
"""

# ---- 画布模板来源:正典件既有节点(公共件)/ 克隆件(五件 H3 定制件,widgets 已 1117 实弹调参)----
TPL_FROM_CANVAS = {5002: 42, 5006: 1012, 5012: 2001, 5016: 54, 5017: 2022, 5018: 2021,
                   5019: 2031, 5020: 2032, 5021: 2041, 5023: 2051, 4100: 4003,
                   5100: 1062, 1065: 1061, 25: 21}
TPL_FROM_CLONE = {5011: 5011, 5013: 5013, 5014: 5014, 5015: 5015, 5022: 5022}

TITLE = {
    25: "⑦ 修脸身份提示词(四采·默认通用句·调用方覆写)", 1065: "四采修脸:False 关(默认旁路)/ True 开",
    5002: "四采·拆帧拆音(←4002 内存态)", 5006: "四采·Pika turbo 8step LoRA(复用 1001)",
    5011: "四采·人脸追踪裁剪", 5012: "四采·H3 重画条件(画布=追踪器出口)",
    5013: "四采·注入真实帧", 5014: "四采·音轨锁", 5015: "四采·逐帧 denoise(60/200)",
    5016: "四采·噪声(同源 #54)", 5017: "四采·采样器(lcm)", 5018: "四采·调度 simple/8步/0.45",
    5019: "四采·引导器", 5020: "四采·采样", 5021: "四采·解码", 5022: "四采·贴回",
    5023: "四采·合成视频", 5100: "终档选择(1065:真=修脸片/假=p3 直通)", 4100: "终档保存 p-final",
}
# 布局=拓扑分层列(x 严格右向,契约 test_no_negative_zone_and_no_leftward 刻碑:全链恒向右):
# 4002(6533)→5002→5011→5012→5013→5006→5014→5015→[5016/5017/5018/5019 同列纵堆,互无边]
# →5020→5021→5022→5023→5100→4100;25/1065 仅出边(→5012/→5100)且被链位钉在臂左端,
# 归四采修脸组输入位(与 5100 同框必横跨整臂=组框相交,故终档组=5100+4100)。
POS = {
    5002: [6600, 5900], 5011: [6940, 5900], 5012: [7360, 5900], 5013: [7840, 5900],
    5006: [8230, 5900], 5014: [8670, 5900], 5015: [9080, 5900],
    5016: [9490, 6100], 5017: [9490, 6320], 5018: [9490, 6520], 5019: [9490, 6760],
    5020: [9940, 5900], 5021: [10270, 5900], 5022: [10600, 5900], 5023: [11010, 5900],
    5100: [11480, 5900], 4100: [11820, 5900], 25: [6600, 6900], 1065: [7060, 6900],
}
SIZE = {
    5002: [270, 100], 5011: [360, 600], 5006: [400, 148], 5012: [400, 622],
    5013: [330, 105], 5014: [330, 120], 5015: [330, 240],
    5016: [360, 148], 5017: [370, 118], 5018: [315, 178], 5019: [360, 112], 5020: [250, 184],
    5021: [250, 112], 5022: [330, 270], 5023: [270, 232],
    25: [430, 200], 1065: [300, 120], 5100: [270, 166], 4100: [283, 564],
}
WIDGETS: dict[int, list | None] = {
    25: [IDENTITY], 1065: [False],
    5002: None, 5006: ["pika_turbo_8step_fl2va.safetensors", 1],
    5011: ["face_yolov8m.pt", 0.15, 2.5, 768, 768, "auto_capped_768", 21, 51, "gaussian",
           "per_frame", True, 0.28, "largest_face", "segm\\person_yolov8m-seg.pt", 0.5, 0,
           "insightface", "none", 3.0, "off", 0, 0, 0],
    5012: ["", 768, 768, 124, "max"],
    5013: None, 5014: None,
    5015: [1.0, 0.35, "absolute_px", 60.0, 200.0, 1, 9],
    5016: [42, "fixed"], 5017: ["lcm"], 5018: ["simple", 8, 0.45],
    5019: None, 5020: None, 5021: None,
    5022: ["face_only", 16, 24, 1, 1, "fade_out", False],
    5023: [24, 8, "sRGB", "none"],
    5100: [False], 4100: [PREFIX_P_FINAL, "auto", "auto", "auto"],
}

# ---- 连线(src_id, src出口槽名, dst_id, dst输入槽名)----
WIRING = [
    (4002, "VIDEO", 5002, "video"),
    (4002, "VIDEO", 5100, "on_false"),
    (5002, "images", 5011, "images"),
    (5002, "images", 5022, "base_images"),
    (5002, "audio", 5014, "audio"),
    (5002, "audio", 5023, "audio"),
    (1001, "MODEL", 5006, "model"),
    (5006, "MODEL", 5014, "model"),
    (5011, "crops", 5013, "images"),
    (5011, "transform", 5015, "transform"),
    (5011, "transform", 5022, "transform"),
    (5011, "canvas_w", 5012, "width"),
    (5011, "canvas_h", 5012, "height"),
    (5012, "LATENT", 5013, "av_latent"),
    (1003, "VAE", 5012, "vae"),
    (1003, "VAE", 5013, "vae"),
    (1003, "VAE", 5021, "vae"),
    (1004, "VAE", 5012, "audio_vae"),
    (1004, "VAE", 5014, "audio_vae"),
    (1002, "CLIP", 5012, "clip"),
    (1, "IMAGE", 5012, "ref_images.ref_image_0"),
    (25, "STRING", 5012, "prompt"),
    (52, "INT", 5012, "length"),
    (5013, "av_latent", 5014, "av_latent"),
    (5014, "model", 5015, "model"),
    (5014, "av_latent", 5015, "av_latent"),
    (5015, "model", 5018, "model"),
    (5015, "model", 5019, "model"),
    (5012, "positive", 5019, "conditioning"),
    (5016, "NOISE", 5020, "noise"),
    (5019, "GUIDER", 5020, "guider"),
    (5017, "SAMPLER", 5020, "sampler"),
    (5018, "SIGMAS", 5020, "sigmas"),
    (5015, "av_latent", 5020, "latent_image"),
    (5020, "output", 5021, "samples"),
    (5021, "IMAGE", 5022, "refined_crops"),
    (5022, "images", 5023, "images"),
    (5023, "VIDEO", 5100, "on_true"),
    (1065, "BOOLEAN", 5100, "switch"),
    (5100, "COMFY_MATCHTYPE_V3", 4100, "video"),
]

# ---- API 模板同构节点(平铺 prompt dict;槽名以 API 模板 2001 现有 inputs 为真源,REF 用点分)----
API_NEW: dict[str, dict] = {
    "25": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": IDENTITY}},
    "1065": {"class_type": "PrimitiveBoolean", "inputs": {"value": False}},
    "5002": {"class_type": "GetVideoComponents", "inputs": {"video": ["4002", 0]}},
    "5006": {"class_type": "LoraLoaderModelOnly", "inputs": {
        "model": ["1001", 0], "lora_name": "pika_turbo_8step_fl2va.safetensors", "strength_model": 1}},
    "5011": {"class_type": "H3FaceTrackCrop", "inputs": {
        "images": ["5002", 0], "detector": "face_yolov8m.pt", "confidence": 0.15, "crop_factor": 2.5,
        "canvas_width": 768, "canvas_height": 768, "canvas_mode": "auto_capped_768",
        "smooth_window": 21, "size_smooth_window": 51, "smooth_method": "gaussian",
        "size_mode": "per_frame", "identity_track": True, "identity_threshold": 0.28,
        "select": "largest_face", "fallback_detector": "segm\\person_yolov8m-seg.pt",
        "fallback_head_frac": 0.5}},
    "5012": {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": {
        "clip": ["1002", 0], "vae": ["1003", 0], "audio_vae": ["1004", 0],
        "ref_images.ref_image_0": ["1", 0], "prompt": ["25", 0],
        "width": ["5011", 4], "height": ["5011", 5], "length": ["52", 1], "ref_image_size": "max"}},
    "5013": {"class_type": "H3InjectVideoLatent", "inputs": {
        "av_latent": ["5012", 1], "images": ["5011", 0], "vae": ["1003", 0]}},
    "5014": {"class_type": "MiniMaxH3NativeAudioLock", "inputs": {
        "model": ["5006", 0], "av_latent": ["5013", 0], "audio_vae": ["1004", 0], "audio": ["5002", 1]}},
    "5015": {"class_type": "H3PerFrameDenoise", "inputs": {
        "model": ["5014", 0], "av_latent": ["5014", 1], "transform": ["5011", 1],
        "denoise_multiplier_small_face": 1.0, "denoise_multiplier_large_face": 0.35,
        "scale_mode": "absolute_px", "face_px_small": 60.0, "face_px_large": 200.0,
        "gamma": 1.0, "smooth_frames": 9}},
    "5016": {"class_type": "RandomNoise", "inputs": {"noise_seed": 42}},
    "5017": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "lcm"}},
    "5018": {"class_type": "BasicScheduler", "inputs": {
        "model": ["5015", 2], "scheduler": "simple", "steps": 8, "denoise": 0.45}},
    "5019": {"class_type": "BasicGuider", "inputs": {"model": ["5015", 2], "conditioning": ["5012", 0]}},
    "5020": {"class_type": "SamplerCustomAdvanced", "inputs": {
        "noise": ["5016", 0], "guider": ["5019", 0], "sampler": ["5017", 0],
        "sigmas": ["5018", 0], "latent_image": ["5015", 0]}},
    "5021": {"class_type": "VAEDecode", "inputs": {"samples": ["5020", 0], "vae": ["1003", 0]}},
    "5022": {"class_type": "H3FaceStitch", "inputs": {
        "base_images": ["5002", 0], "refined_crops": ["5021", 0], "transform": ["5011", 1],
        "paste_region": "face_only", "mask_dilation": 16, "feather": 24, "colour_match": 1.0,
        "blend": 1.0, "undetected_frames": "fade_out"}},
    "5023": {"class_type": "CreateVideo", "inputs": {
        "images": ["5022", 0], "audio": ["5002", 1], "fps": 24, "bit_depth": "auto",
        "color_space": "sRGB", "chroma_subsampling": "auto", "codec": "none"}},
    "5100": {"class_type": "ComfySwitchNode", "inputs": {
        "switch": ["1065", 0], "on_false": ["4002", 0], "on_true": ["5023", 0]}},
    "4100": {"class_type": "SaveVideo", "inputs": {
        "video": ["5100", 0], "filename_prefix": PREFIX_P_FINAL, "format": "auto", "codec": "auto"}},
}


def die(msg: str) -> "None":
    sys.exit(f"[FATAL] {msg}")


def node_by_id(nodes, nid):
    for n in nodes:
        if n["id"] == nid:
            return n
    die(f"模板缺节点 #{nid}")


def fresh(n: dict) -> dict:
    """深拷贝模板并清联线/标题/命名 widgets,供重编号重摆放。"""
    n = copy.deepcopy(n)
    for sec in ("inputs", "outputs"):
        for slot in n.get(sec, []):
            slot.pop("links", None)
            slot.pop("link", None)
    n.pop("title", None)
    n.pop("widgets_values_named", None)
    return n


def slot_index(n: dict, section: str, name: str) -> int:
    for i, s in enumerate(n.get(section, [])):
        if s["name"] == name:
            return i
    die(f"#{n['id']} {n['type']} 无{section}槽 {name}:{[s['name'] for s in n.get(section, [])]}")


def strip_canvas(S: dict) -> dict:
    """剥离本组既往添加(幂等母本=正典件自身)。"""
    own_ids = set(OWN)
    for n in list(S["nodes"]):
        if n["id"] in own_ids:
            if n["type"] != OWN[n["id"]]:
                die(f"正典件 #{n['id']} 已被他人占用为 {n['type']}(预期 {OWN[n['id']]}),拒剥")
            S["nodes"].remove(n)
    removed_links = [l for l in S["links"] if l[1] in own_ids or l[3] in own_ids]
    removed_link_ids = {l[0] for l in removed_links}
    S["links"] = [l for l in S["links"] if l[0] not in removed_link_ids]
    for n in S["nodes"]:
        for sec in ("inputs", "outputs"):
            for slot in n.get(sec, []):
                if slot.get("link") in removed_link_ids:
                    slot["link"] = None
                if isinstance(slot.get("links"), list):
                    slot["links"] = [x for x in slot["links"] if x not in removed_link_ids]
    S["groups"] = [g for g in S.get("groups", [])
                   if g.get("title") not in (GROUP_A_TITLE, GROUP_B_TITLE)]
    for n in S["nodes"]:
        if n["id"] == 9999:
            md = n["widgets_values"][0]
            i = md.find(README_MARK)
            if i >= 0:
                n["widgets_values"][0] = md[:i]
    S["last_link_id"] = max((l[0] for l in S["links"]), default=0)
    S["last_node_id"] = max((n["id"] for n in S["nodes"]), default=0)
    return S


def build_canvas(S: dict, clone_nodes: list) -> dict:
    tpl = {}
    for new_id, src_id in TPL_FROM_CANVAS.items():
        tpl[new_id] = fresh(node_by_id(S["nodes"], src_id))
    for new_id, src_id in TPL_FROM_CLONE.items():
        tpl[new_id] = fresh(node_by_id(clone_nodes, src_id))

    base_order = max((n.get("order") or 0) for n in S["nodes"]) + 1
    new_nodes = []
    for k, new_id in enumerate(OWN):
        n = tpl[new_id]
        n["id"] = new_id
        n["pos"] = POS[new_id][:]
        n["size"] = SIZE[new_id][:]
        n["title"] = TITLE[new_id]
        n["mode"] = 0
        n["order"] = base_order + k
        wv = WIDGETS[new_id]
        if wv is not None:
            n["widgets_values"] = copy.deepcopy(wv)
        new_nodes.append(n)
    S["nodes"].extend(new_nodes)

    id2node = {n["id"]: n for n in S["nodes"]}
    next_link = S["last_link_id"] + 1
    for src_id, src_name, dst_id, dst_name in WIRING:
        src, dst = id2node[src_id], id2node[dst_id]
        so, di = slot_index(src, "outputs", src_name), slot_index(dst, "inputs", dst_name)
        S["links"].append([next_link, src_id, so, dst_id, di, dst["inputs"][di]["type"]])
        src["outputs"][so].setdefault("links", []).append(next_link)
        dst["inputs"][di]["link"] = next_link
        next_link += 1
    S["last_link_id"] = next_link - 1
    S["last_node_id"] = max(S["last_node_id"], 4002, 5100, 4100, 1065)

    def group(title, ids, color):
        ns = [n for n in new_nodes if n["id"] in ids]
        x1 = min(n["pos"][0] for n in ns); y1 = min(n["pos"][1] for n in ns)
        x2 = max(n["pos"][0] + n["size"][0] for n in ns)
        y2 = max(n["pos"][1] + n["size"][1] for n in ns)
        return {"id": 105 if title == GROUP_A_TITLE else 106, "title": title,
                "bounding": [x1 - 60, y1 - 80, x2 - x1 + 60, y2 - y1 + 120],
                "color": color, "flags": {}, "order": 5 if title == GROUP_A_TITLE else 6}

    S.setdefault("groups", []).append(group(GROUP_A_TITLE, GROUP_A_IDS, "#995588"))
    S["groups"].append(group(GROUP_B_TITLE, GROUP_B_IDS, "#557799"))

    for n in S["nodes"]:
        if n["id"] == 9999:
            md = n["widgets_values"][0]
            if README_MARK not in md:
                n["widgets_values"][0] = md + README_SECTION
    return S


def build_api(A: dict) -> dict:
    for k, ct in OWN.items():
        old = A.get(str(k))
        if old is not None and old.get("class_type") != ct:
            die(f"API 模板节点 {k} 已被他人占用为 {old.get('class_type')}(预期 {ct}),拒剥")
        A.pop(str(k), None)
    for k in OWN:  # 固定插入序,保证重跑字节稳定
        A[str(k)] = copy.deepcopy(API_NEW[str(k)])
    return A


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def check() -> int:
    S = json.loads(CANVAS.read_text(encoding="utf-8"))
    A = json.loads(API.read_text(encoding="utf-8"))
    fails: list[str] = []

    def ok(cond, msg):
        if cond:
            print(f"  PASS  {msg}")
        else:
            fails.append(msg)
            print(f"  FAIL  {msg}")

    n_canvas, n_api = len(S["nodes"]), len(A)
    print(f"[CHECK] 画布节点 {n_canvas}(66+{n_canvas-66}) / API 节点 {n_api}(64+{n_api-64})")
    print("  NOTE  节点数口径:PRD §1.1 标题「66+21=87」为修订前残数(21=19+已删 5001 LoadVideo/"
          "5005 UNETLoader);按 §1.1 拓扑枚举报 19 → 画布 85 / API 83,自检按拓扑枚举断言")
    ok(n_canvas == 85, f"画布节点数=85(拓扑枚举 66+19),实际 {n_canvas}")
    ok(n_api == 83, f"API 节点数=83(64+19),实际 {n_api}")

    ids = [n["id"] for n in S["nodes"]]
    ok(len(ids) == len(set(ids)), "画布节点 id 唯一")
    idset = set(ids)
    ok(all(l[1] in idset and l[3] in idset for l in S["links"]), "画布无悬空链")
    ok(all(str(i) in A for i in OWN), "19 新节点 API/画布两件齐备")

    b65 = next(n for n in S["nodes"] if n["id"] == 1065)
    ok(b65.get("widgets_values") == [False], "画布 #1065 开关默认 False")
    ok(A["1065"]["inputs"]["value"] is False, "API #1065 开关默认 False")
    ok(sum(1 for n in S["nodes"] if n["type"] == "UNETLoader") == 1, "画布无第二个 UNETLoader(仅 1001)")
    ok(sum(1 for v in A.values() if v["class_type"] == "UNETLoader") == 1, "API 无第二个 UNETLoader(仅 1001)")

    n5012 = next(n for n in S["nodes"] if n["id"] == 5012)
    lk = {l[0]: l for l in S["links"]}
    n5011 = next(n for n in S["nodes"] if n["id"] == 5011)

    def src_of(n, in_name):
        s = next(s for s in n["inputs"] if s["name"] == in_name)
        return lk.get(s.get("link"))

    wl, hl = src_of(n5012, "width"), src_of(n5012, "height")
    ok(wl and wl[1] == 5011 and n5011["outputs"][wl[2]]["name"] == "canvas_w",
       "画布 5012.width=5011.canvas_w 出口联线")
    ok(hl and hl[1] == 5011 and n5011["outputs"][hl[2]]["name"] == "canvas_h",
       "画布 5012.height=5011.canvas_h 出口联线")
    ok(A["5012"]["inputs"]["width"] == ["5011", 4] and A["5012"]["inputs"]["height"] == ["5011", 5],
       "API 5012 宽高=5011 出口(canvas_w=4/canvas_h=5)")

    gs = [g for g in S["groups"] if g["title"] in (GROUP_A_TITLE, GROUP_B_TITLE)]
    ok(len(gs) == 2, "两只组框在位")
    cover = True
    for n in S["nodes"]:
        if n["id"] not in OWN:
            continue
        x, y, w, h = n["pos"][0], n["pos"][1], n["size"][0], n["size"][1]
        inside = any(g["bounding"][0] <= x and g["bounding"][1] <= y
                     and x + w <= g["bounding"][0] + g["bounding"][2]
                     and y + h <= g["bounding"][1] + g["bounding"][3] for g in gs)
        if not inside:
            cover = False
            print(f"  ..  #{n['id']} 未被组框罩住")
    ok(cover, "组框罩全(19 新节点全部落框)")

    par = all(str(i) in A and A[str(i)]["class_type"] == OWN[i] for i in OWN)
    ok(par, "API/画布 19 节点 class_type 同构")

    def wired(nid, in_name, want_src):
        l = src_of(next(n for n in S["nodes"] if n["id"] == nid), in_name)
        return bool(l) and l[1] == want_src

    ok(wired(5002, "video", 4002) and wired(5100, "on_false", 4002) and wired(5100, "on_true", 5023)
       and wired(5100, "switch", 1065) and wired(4100, "video", 5100) and wired(5006, "model", 1001)
       and wired(5014, "audio", 5002) and wired(5019, "conditioning", 5012)
       and wired(5020, "noise", 5016), "关键联线拓扑(5002←4002/5100 双臂+开关/4100←5100/5006←1001/5014.audio←5002②/5019←5012/5020←5016)")
    ok(A["5002"]["inputs"]["video"] == ["4002", 0] and A["5100"]["inputs"]["on_false"] == ["4002", 0]
       and A["5100"]["inputs"]["on_true"] == ["5023", 0] and A["4100"]["inputs"]["video"] == ["5100", 0]
       and A["5006"]["inputs"]["model"] == ["1001", 0], "API 关键拓扑同构")

    t25 = next(n for n in S["nodes"] if n["id"] == 25)
    ok(bool(t25["widgets_values"][0].strip()) and A["25"]["inputs"]["value"] == t25["widgets_values"][0],
       "#25 默认通用句两件一致且非空")
    ok(README_MARK in next(n for n in S["nodes"] if n["id"] == 9999)["widgets_values"][0],
       "README 9999 已增「四采修脸」段")
    ok(S["last_link_id"] == max(l[0] for l in S["links"]), "last_link_id 已对齐最大链号")

    if fails:
        print("\n[CHECK] FAIL x%d" % len(fails))
        for f in fails:
            print("  " + f)
        return 1
    print("[CHECK] ALL PASS")
    return 0


def main() -> int:
    if "--check" in sys.argv:
        return check()
    S = strip_canvas(json.loads(CANVAS.read_text(encoding="utf-8")))
    clone_nodes = json.loads(CLONE.read_text(encoding="utf-8"))["nodes"]
    S = build_canvas(S, clone_nodes)
    write_json(CANVAS, S)
    A = build_api(json.loads(API.read_text(encoding="utf-8")))
    write_json(API, A)
    print(f"[OK] 画布 {CANVAS.name}:{len(S['nodes'])} 节点(66+19)/ {len(S['links'])} 链 / {len(S['groups'])} 组")
    print(f"[OK] API {API.name}:{len(A)} 节点(64+19)")
    return check()


if __name__ == "__main__":
    raise SystemExit(main())
