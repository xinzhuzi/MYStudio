#!/usr/bin/env python3
"""一镜到底-分段.json 修脸组内置(默认旁路)生成器(1118,multiseg 嫁接役)。

母本=apps/build/scripts/sancai_inline_facerefine_build_1118.py(三采版,含 19 节点修脸组+
开关+终档全部逻辑;本件 import 之为单一真源——OWN/WIDGETS/SIZE/API_NEW/IDENTITY 禁复制两份)。
任务书(11-17-facerefine-inline-bypass §1.1 接线语义)同款嫁接,锚点按本件实况换:

  链尾终采 VIDEO 出口 = 3053 CreateVideo(二采 p2 出片口;4001-4003 ReCaVSR 出厂 mode4 旁路,
    其 video 输入恰为 3053.VIDEO——修脸组接 3053 与段B 正交,零改动段B)
  唯一 UNETLoader   = 34   (5006 LoraLoaderModelOnly.model←1066 lowvram 头复用,全图仍无第二 UNETLoader)
  CLIP/视频VAE/音频VAE = 21 / 7 / 13 (101/3031 同源件)
  宽高               = 5011 H3FaceTrackCrop.canvas_w/canvas_h 出口联线(勿手填,同母本)
  帧数               = 本件无帧数图出口(100 H3Parameter 只出 DICT;#52 ComfyMathExpression 是
                       三采件专属)→ 5012.length widget=56 与 3031.length 出厂同值(livefire/
                       发车器覆写 3031.length 时须同步覆写 5012.length,README 记纪律)
  参考图             = 画布侧零参考出厂(同 3031 纯文生口径);API 侧接 9 LoadImage
  编号               = 沿用母本组号 25/1065/5002/5006/5011-5023/5100/4100(本件既有 id 段
                       2-41/100-102/1021-1046/3001-3071/4001-4003/9999 全不撞,零重编号)

节点数:画布 41→60(+19;lowvram役 81f8909f 后又 +1066=61,check 按 61 对账)/API
h3-multiseg-template.api.json(平铺 prompt dict,已核无 wrapper)14→35(+19+remux5030/5031)。
API 侧链尾=36 CreateVideo(一采直出门自己的终采口),5002/5100 接 36。

⚠ 真源关系(头注刻碑):本件手术入口=本生成器(读盘剥离+重放,幂等);既有
multiseg_full3stage_extend.py 的 build_full3stage_graph 只透传 12 旧锚点+自建 29 节点——
**重跑 extend(无参写盘)会抹掉本修脸组,抹后重跑本生成器即恢复**(其 --verify 验重建图,
对盘上嫁接盲,不因本组红绿)。改版顺序恒为:先 extend 后本件。

用法:
  python3 multiseg_inline_facerefine_build_1118.py           # 重建两件
  python3 multiseg_inline_facerefine_build_1118.py --check   # 结构自检(读盘上两件)
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import sancai_inline_facerefine_build_1118 as MB  # noqa: E402  母本单一真源(在途件,1118 同役族)

CANVAS = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/一镜到底-分段.json"
API = REPO / "apps/frontend/lib/assist/image-studio/h3-multiseg-template.api.json"
SRC = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/单镜.json"  # 模板源(只读;1119 由 三采-单镜 改名)

# ---- 本件锚点(画布件实勘)----
TAIL = 3053   # CreateVideo 二采 p2 出片口(mode0;链尾终采 VIDEO 输出节点)
UNET = 34     # 唯一 UNETLoader
CLIP, VAE_V, VAE_A = 21, 7, 13
LENGTH_NODE = 3031          # 帧数同源参照件(5012.length widget 与其 length widget 同值)
LENGTH = 56                 # 出厂帧数(2×1秒@24fps→[22,34]→56,multiseg 出厂口径)
REF_API = 9                 # API 模板 LoadImage(画布件无 LoadImage,零参考出厂)
API_TAIL = 36               # API 模板自己的终采 VIDEO 输出节点(CreateVideo 一采直出)
PREFIX_P_FINAL = "video/H3/分段视频/p-final"

# 1119 双档核验(PRD 3.4,结论回填):母本 1119 起 OWN 扩为 25(+HD_IDS 6 件远景/高清
# 双档段,V2.2 砍 SAM3 后口径;V2 曾为 33/14、V2.1 为 29/10——5105/5106/5107/5112 已随
# SLNM 路砍除,5101-5104 已随 SAM3 支路砍除,均天然不在),本件若直接继承会误带
# VOSR2/投切段进 multiseg——已证带,加节点过滤(只克隆 5000 段修脸原链 19 件);
# multiseg 不随双档役,双档需求走正典件(V2.2 复跑 --check 天然适配实证)。
HD_FILTER = set(getattr(MB, "HD_IDS", set()))
OWN: dict[int, str] = {k: v for k, v in MB.OWN.items() if k not in HD_FILTER}
WIDGETS = {k: (list(v) if v is not None else None) for k, v in MB.WIDGETS.items()
           if k not in HD_FILTER}
WIDGETS[5012] = ["", 768, 768, LENGTH, "max"]   # length=56 出厂(3031 同值);宽高位被 5011 联线覆盖
WIDGETS[4100] = [PREFIX_P_FINAL, "auto", "auto", "auto"]  # p-final 前缀换本件口径(勿承三采 chapter-001)
# 5011 追踪分策(1118 收尾):锚三元组取母本终版(closest_to_xy/1920/900/@f170),身份栈退回
# insightface+0.28——本件布线密度无余量(490 位仪表扫描实证任何新线必破棘轮),免 CLIPVision
# 装载器;七发探针定谳 clip_vision 身份全程 never consulted,锚才是根因修复。
_w = WIDGETS[5011]
_w[11], _w[16] = 0.28, "insightface"
WIDGETS[5011] = _w

GROUP_A_TITLE = "四采修脸组(5000 段·默认旁路·1118 multiseg)"
GROUP_B_TITLE = "终档组(p-final·四采开关·1118 multiseg)"
GROUP_A_IDS = set(MB.GROUP_A_IDS) - HD_FILTER  # 25/1065/5002/5006/5011-5023(滤除 1119 双档 10 件)
GROUP_B_IDS = set(MB.GROUP_B_IDS)           # 5100/4100
README_MARK = "\n\n---\n\n## 四采修脸(内置·默认旁路·1118 multiseg)"
README_SECTION = README_MARK + """

- **开关 #1065「四采修脸」**:默认 **False=旁路**——终档 4100 p-final=3053 二采 p2 直通,50xx 臂被引擎惰性剪除
  (0.45.2 实证,同 单镜 1118 双态探针口径),零成本;**True=二采出片内部走进修脸→终档一条线**
- **#25 修脸身份提示词**:默认通用句;外部按角色覆写(参照正片人物五官特征)
- **臂拓扑**(同 单镜 1118 §1.1):5002 拆 3053(帧①+音轨②)→ 5011 追踪裁剪(face_yolov8m
  conf0.15/兜底 segm\\person_yolov8m-seg.pt/largest_face)→ 5012 H3 重画(**宽高=5011 出口联线勿手填**/
  参考图=零参考出厂/提示词=#25)→ 5013 注入真实帧 → 5014 音轨锁(audio←5002②)→ 5015 逐帧 denoise
  (60/200px)→ 5016-5020 采样(seed 42 同 3040/lcm/simple/8步/0.45)→ 5021 解码 → 5022 贴回(16/24)
  → 5023 合成 → 5100 终档选择 → 4100 p-final
- **帧数同步纪律(本件专属)**:本件无帧数图出口——改 [3031].length 必须同步 [5012].length
  (出厂两处皆 56;livefire/发车器覆写 3031.length 时同步覆写 5012.length)
- **极性口径**(同三采 1118 双态实测定谳):5100 on_true=修脸片(1065=true)/on_false=3053 p2 直通
  (1065=false),勿手改(防 wf2api 反转坑)
- **显存纪律**:5006 LoRA 挂 34 单 loader(全图禁第二个 UNETLoader);p1/p2 两档照常落盘,段B
  4001-4003 mode4 与 MyShot/3071 零改动(修脸组与段B 正交)
- **生效面**:仓库/引擎直投即时生效;装机 App 面候打包窗口另役同步
- **改版顺序**:本组手术入口=apps/build/scripts/multiseg_inline_facerefine_build_1118.py(幂等);
  multiseg_full3stage_extend.py 无参重跑会抹本组(其只透传 12 锚点+自建 29),抹后重跑本生成器即恢复
"""

TITLE = dict(MB.TITLE)
TITLE[5002] = "四采·拆帧拆音(←3053 二采出片)"
TITLE[5006] = "四采·Pika turbo 8step LoRA(复用 34)"

# 布局=x 严格右向(同三采契约刻碑);新区起 x=11300(组⑤ ReCaVSR 右缘 11060 之外,组框零相交)。
# 1118 布局治理役(apps/build/scripts/workflow_layout_fix_multiseg_band_1118.py)立分层行带:
# R1 y1000 主链头(5002→5011→5012→5013,净距恰 200)+终档同道右置(5100→4100;5023→5100
# 留 GAP 200 组间通道,组隙 140 同三采;终档留浅廊=3053→5100 不下钻穿带);
# R2 y1760 中尾行(PITCH 760):5006(5012 est 右缘齐位,贴 5014 净距 200)→5014(wrap 70
# 落行)→5015→5020→5021→5022→5023(GAP 200 链);R3 y2520 纵堆(5016/5019/5017/5018
# 行序=5020 输入槽序 noise/guider/sampler/sigmas,x 全等净距恰 80);寄生:25 右缘齐 5012
# 左缘(y=5011 est 底+80)、1065=5100 左 530(y=5013 est 底+80)。重跑本生成器按本表落位。
POS = {
    5002: [11300, 1000], 5011: [11770, 1000], 5012: [12330, 1000], 5013: [12930, 1000],
    5006: [12730, 1760], 5014: [13330, 1760], 5015: [13860, 1760],
    5016: [14260, 2520], 5019: [14260, 2748], 5017: [14260, 2940], 5018: [14260, 3138],
    5020: [14700, 1760], 5021: [15150, 1760], 5022: [15600, 1760], 5023: [16130, 1760],
    5100: [16600, 1000], 4100: [17070, 1000], 25: [11900, 2002], 1065: [16070, 1216],
}
SIZE = dict(MB.SIZE)

# ---- 连线(母本 40 条减 ref/length 两条=38;锚=3053/34/21/7/13)----
WIRING = [
    (TAIL, "VIDEO", 5002, "video"),
    (TAIL, "VIDEO", 5100, "on_false"),
    (5002, "images", 5011, "images"),
    (5002, "images", 5022, "base_images"),
    (5002, "audio", 5014, "audio"),
    (5002, "audio", 5023, "audio"),
    (1066, "MODEL", 5006, "model"),  # 81f8909f lowvram G4:修脸臂模型经 1066 分块收束点(34→1066→5006)
    (5006, "MODEL", 5014, "model"),
    (5011, "crops", 5013, "images"),
    (5011, "transform", 5015, "transform"),
    (5011, "transform", 5022, "transform"),
    (5011, "canvas_w", 5012, "width"),
    (5011, "canvas_h", 5012, "height"),
    (5012, "LATENT", 5013, "av_latent"),
    (VAE_V, "VAE", 5012, "vae"),
    (VAE_V, "VAE", 5013, "vae"),
    (VAE_V, "VAE", 5021, "vae"),
    (VAE_A, "VAE", 5012, "audio_vae"),
    (VAE_A, "VAE", 5014, "audio_vae"),
    (CLIP, "CLIP", 5012, "clip"),
    (25, "STRING", 5012, "prompt"),
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


def die(msg: str) -> None:
    sys.exit(f"[FATAL] {msg}")


def node_by_id(nodes, nid):
    for n in nodes:
        if n["id"] == nid:
            return n
    die(f"模板缺节点 #{nid}")


def api_node(k: str) -> dict:
    """母本 API_NEW 深拷贝换锚(链尾 36/UNET 34/CLIP 21/VAE 7,13/参考图 9/length widget)。"""
    d = copy.deepcopy(MB.API_NEW[k])
    ins = d["inputs"]
    if k == "5002":
        ins["video"] = ["5031", 0]  # remux 出口(lazy-switch 禁吃 auto-context 边界 36,1118 探针定谳)
    elif k == "5006":
        ins["model"] = [str(UNET), 0]
    elif k == "5012":
        ins["clip"] = [str(CLIP), 0]
        ins["vae"] = [str(VAE_V), 0]
        ins["audio_vae"] = [str(VAE_A), 0]
        ins["ref_images.ref_image_0"] = [str(REF_API), 0]
        ins["length"] = LENGTH
    elif k == "5013":
        ins["vae"] = [str(VAE_V), 0]
    elif k == "5014":
        ins["audio_vae"] = [str(VAE_A), 0]
    elif k == "5021":
        ins["vae"] = [str(VAE_V), 0]
    elif k == "5100":
        ins["on_false"] = ["5031", 0]
    elif k == "4100":
        ins["filename_prefix"] = PREFIX_P_FINAL
    return d


def strip_canvas(S: dict) -> dict:
    """剥离本组既往添加(幂等;剥离前校验类型防误删他人节点)。"""
    own_ids = set(OWN)
    for n in list(S["nodes"]):
        if n["id"] in own_ids:
            if n["type"] != OWN[n["id"]]:
                die(f"画布件 #{n['id']} 已被他人占用为 {n['type']}(预期 {OWN[n['id']]}) ,拒剥")
            S["nodes"].remove(n)
    removed = [l for l in S["links"] if l[1] in own_ids or l[3] in own_ids]
    removed_ids = {l[0] for l in removed}
    S["links"] = [l for l in S["links"] if l[0] not in removed_ids]
    for n in S["nodes"]:
        for sec in ("inputs", "outputs"):
            for slot in n.get(sec, []):
                if slot.get("link") in removed_ids:
                    slot["link"] = None
                if isinstance(slot.get("links"), list):
                    slot["links"] = [x for x in slot["links"] if x not in removed_ids]
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


def build_canvas(S: dict, src_nodes: list) -> dict:
    """模板=三采术后件同号节点(同款修脸组现成实体,widgets=1118 实证配置)fresh 后重摆。"""
    tpl = {nid: MB.fresh(node_by_id(src_nodes, nid)) for nid in OWN}
    base_order = max((n.get("order") or 0) for n in S["nodes"]) + 1
    new_nodes = []
    for k, nid in enumerate(OWN):
        n = tpl[nid]
        n["id"] = nid
        n["pos"] = POS[nid][:]
        n["size"] = SIZE[nid][:]
        n["title"] = TITLE[nid]
        n["mode"] = 0
        n["order"] = base_order + k
        wv = WIDGETS[nid]
        if wv is not None:
            n["widgets_values"] = copy.deepcopy(wv)
        new_nodes.append(n)
    S["nodes"].extend(new_nodes)

    id2node = {n["id"]: n for n in S["nodes"]}
    next_link = S["last_link_id"] + 1
    for src_id, src_name, dst_id, dst_name in WIRING:
        src, dst = id2node[src_id], id2node[dst_id]
        so = MB.slot_index(src, "outputs", src_name)
        di = MB.slot_index(dst, "inputs", dst_name)
        S["links"].append([next_link, src_id, so, dst_id, di, dst["inputs"][di]["type"]])
        src["outputs"][so].setdefault("links", []).append(next_link)
        dst["inputs"][di]["link"] = next_link
        next_link += 1
    S["last_link_id"] = next_link - 1
    S["last_node_id"] = max(S["last_node_id"], TAIL, 5100, 4100, 1065)

    def group(gid, title, ids, color, order):
        ns = [n for n in new_nodes if n["id"] in ids]
        x1 = min(n["pos"][0] for n in ns)
        y1 = min(n["pos"][1] for n in ns)
        x2 = max(n["pos"][0] + n["size"][0] for n in ns)
        y2 = max(n["pos"][1] + n["size"][1] for n in ns)
        return {"id": gid, "title": title,
                "bounding": [x1 - 60, y1 - 80, x2 - x1 + 60, y2 - y1 + 120],
                "color": color, "flags": {}, "order": order}

    S.setdefault("groups", []).append(group(16, GROUP_A_TITLE, GROUP_A_IDS, "#995588", 7))
    S["groups"].append(group(17, GROUP_B_TITLE, GROUP_B_IDS, "#557799", 8))

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
    for k in OWN:  # 固定插入序,重跑字节稳定
        A[str(k)] = api_node(str(k))
    # remux 出口(1118 探针定谳:lazy-switch 禁吃 auto-context 边界 36;常规则链破边界)
    A["5030"] = {"class_type": "GetVideoComponents", "inputs": {"video": [str(API_TAIL), 0]}}
    A["5031"] = {"class_type": "CreateVideo", "inputs": {"images": ["5030", 0], "audio": ["5030", 1],
                  "fps": 24, "bit_depth": "auto", "color_space": "sRGB",
                  "chroma_subsampling": "auto", "codec": "none"}}
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
    print(f"[CHECK] 画布节点 {n_canvas}(41+{n_canvas - 41}) / API 节点 {n_api}(14+{n_api - 14})")
    ok(n_canvas == 61, f"画布节点数=61(41+19 修脸组+lowvram役#1066),实际 {n_canvas}")
    ok(n_api == 35, f"API 节点数=35(14+19+remux5030/5031),实际 {n_api}")

    ids = [n["id"] for n in S["nodes"]]
    idset = set(ids)
    ok(len(ids) == len(idset), "画布节点 id 唯一")
    ok(all(l[1] in idset and l[3] in idset for l in S["links"]), "画布无悬空链")
    ok(all(str(i) in A for i in OWN), "19 新节点 API/画布两件齐备")

    ok(next(n for n in S["nodes"] if n["id"] == 1065).get("widgets_values") == [False],
       "画布 #1065 开关默认 False")
    ok(A["1065"]["inputs"]["value"] is False, "API #1065 开关默认 False")
    unets = [n for n in S["nodes"] if n["type"] == "UNETLoader"]
    ok(len(unets) == 1 and unets[0]["id"] == UNET, f"画布无第二个 UNETLoader(仅 #{UNET})")
    ok(sum(1 for v in A.values() if v["class_type"] == "UNETLoader") == 1,
       "API 无第二个 UNETLoader")

    lk = {l[0]: l for l in S["links"]}
    nmap = {n["id"]: n for n in S["nodes"]}

    def src_of(nid, in_name):
        s = next(s for s in nmap[nid]["inputs"] if s["name"] == in_name)
        return lk.get(s.get("link"))

    wl, hl = src_of(5012, "width"), src_of(5012, "height")
    ok(wl and wl[1] == 5011 and nmap[5011]["outputs"][wl[2]]["name"] == "canvas_w",
       "画布 5012.width=5011.canvas_w 出口联线")
    ok(hl and hl[1] == 5011 and nmap[5011]["outputs"][hl[2]]["name"] == "canvas_h",
       "画布 5012.height=5011.canvas_h 出口联线")
    ok(A["5012"]["inputs"]["width"] == ["5011", 4] and A["5012"]["inputs"]["height"] == ["5011", 5],
       "API 5012 宽高=5011 出口(canvas_w=4/canvas_h=5)")

    n3031 = next(n for n in S["nodes"] if n["id"] == LENGTH_NODE)
    n5012 = next(n for n in S["nodes"] if n["id"] == 5012)
    ok(n5012["widgets_values"][3] == LENGTH == n3031["widgets_values"][3],
       f"5012.length widget={LENGTH} 与 3031.length 同源同值(帧数同步纪律)")

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

    def wired(nid, in_name, want_src):
        l = src_of(nid, in_name)
        return bool(l) and l[1] == want_src

    ok(wired(5002, "video", TAIL) and wired(5100, "on_false", TAIL) and wired(5100, "on_true", 5023)
       and wired(5100, "switch", 1065) and wired(4100, "video", 5100)
       and wired(5006, "model", 1066)  # 81f8909f lowvram 插桩后经 1066 头分块收束点=34 扇出之后
       and wired(5014, "audio", 5002) and wired(5019, "conditioning", 5012)
       and wired(5020, "noise", 5016),
       f"关键联线拓扑(5002←{TAIL}/5100 双臂+开关/4100←5100/5006←{UNET}/5014.audio←5002②/5019←5012/5020←5016)")
    ok(A["5002"]["inputs"]["video"] == ["5031", 0]
       and A["5100"]["inputs"]["on_false"] == ["5031", 0]
       and A["5030"]["inputs"]["video"] == [str(API_TAIL), 0]
       and A["5100"]["inputs"]["on_true"] == ["5023", 0]
       and A["4100"]["inputs"]["video"] == ["5100", 0]
       and A["5006"]["inputs"]["model"] == [str(UNET), 0]
       and A["5012"]["inputs"]["ref_images.ref_image_0"] == [str(REF_API), 0]
       and A["5012"]["inputs"]["length"] == LENGTH, "API 关键拓扑同构(链尾 36/UNET 34/参考图 9/length 56)")

    ok(all(A[str(i)]["class_type"] == OWN[i] for i in OWN), "API/画布 19 节点 class_type 同构")
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
    S = build_canvas(S, json.loads(SRC.read_text(encoding="utf-8"))["nodes"])
    write_json(CANVAS, S)
    A = build_api(json.loads(API.read_text(encoding="utf-8")))
    write_json(API, A)
    print(f"[OK] 画布 {CANVAS.name}:{len(S['nodes'])} 节点(41+19)/ {len(S['links'])} 链 / {len(S['groups'])} 组")
    print(f"[OK] API {API.name}:{len(A)} 节点(14+19)")
    return check()


if __name__ == "__main__":
    raise SystemExit(main())
