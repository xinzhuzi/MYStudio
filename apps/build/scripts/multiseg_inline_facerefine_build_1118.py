#!/usr/bin/env python3
"""一镜到底-分段.json 修脸组内置(默认旁路)生成器(1118,multiseg 嫁接役)。

母本=apps/build/scripts/sancai_inline_facerefine_build_1118.py(三采版,含 19 节点修脸组+
开关+终档全部逻辑;本件 import 之为单一真源——OWN/WIDGETS/SIZE/API_NEW/IDENTITY 禁复制两份)。
任务书(11-17-facerefine-inline-bypass §1.1 接线语义)同款嫁接,锚点按本件实况换:

  三采 p3 出口 = 4002 ReCaVSRUpscale(1122 回正:修脸吃三采底,与单镜 5002←4002 同构;
    4001-4003 出厂激活 mode=0——5002/5100 直吃 4002.VIDEO,修脸组与段B 串联非正交)
  唯一 UNETLoader   = 34   (5006 LoraLoaderModelOnly.model←1066 lowvram 头复用,全图仍无第二 UNETLoader)
  CLIP/视频VAE/音频VAE = 21 / 7 / 13 (101/3031 同源件)
  宽高               = 5011 H3FaceTrackCrop.canvas_w/canvas_h 出口联线(勿手填,同母本)
  帧数               = 5012.length 已接线 ← 5011.frame_count(1123 D4,K2 核毕 INT 出口);
                       3031.length 无图内出口(100 只出 DICT,#52 是三采件专属)→ 出厂 56 手动同步
                       (App 路由组装器覆写 3031.length=总帧数;5012 覆写已随 D4 删除)
  参考图             = 画布侧零参考出厂(同 3031 纯文生口径);API 侧接 9 LoadImage
  编号               = 沿用母本组号 25/1065/5002/5006/5011-5023/5100/4100(本件既有 id 段
                       2-41/100-102/1021-1046/3001-3071/4001-4003/9999 全不撞,零重编号)

节点数:画布 41→60(+19;lowvram役 81f8909f 后又 +1066=61)→1119 双档移植 +6=67
(check 按 67 对账)/API h3-multiseg-template.api.json(平铺 prompt dict,已核无 wrapper)
14→33(+19;1123 D1=A′ 剔 remux5030/5031,4002 已改吃 3053 后纯孤立)→1119 双档 +6=39
→1123 二采正典簇 +19=58→800/4001/4002 +3=61→1123 D1=A′ 一采正典臂 1041-1046 +6=67。
103 MyShot 锚终档(103.video←4100,#1);41/5006.model←1066、101 三口外接
(model←1044/sampler←1046/sigmas←1045,画布 1115 正典臂同构)。

1119 双档移植(11-19-dualmode-facerefine-rename 二役):同 id 直搬单镜六件
(5109/5110 VOSR2 尾档+5111 高清子开关+5113 出口投切+5024/5025 复制对),参数逐位
照单镜.json(本生成器自 SRC 克隆即天然逐位);唯一改线 5100.on_true:5023→5113;
**1122 回正(README 9999 刻碑)**:multiseg 修脸/高清档改吃三采底(4002 p3 4K,与单镜
5002←4002 同构;段B mode 4→0 出厂激活随同批解旁路)——两件修脸入口一致,VOSR2 均吃
5021 解码 768 画布,档位语义与上游底两件一致。

⚠ 真源关系(头注刻碑):本件手术入口=本生成器(读盘剥离+重放,幂等);既有
multiseg_full3stage_extend.py 的 build_full3stage_graph 只透传 12 旧锚点+自建 29 节点——
**重跑 extend(无参写盘)会抹掉本修脸组,抹后重跑本生成器即恢复**(其 --verify 验重建图,
对盘上嫁接盲,不因本组红绿)。改版顺序恒为三步链:①extend → ②lowvram_dual_node_1118.py
(补 1066:link1/link15 改源回 1066+ChunkFFN 激活,幂等)→ ③本件;跳步即断链
(漏②直接跑本件,WIRING 引用 1066 即崩)。

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
TAIL = 3053   # CreateVideo 二采 p2 出片口(mode0;段B/终档直通的历史锚,1122 起修脸不再吃它)
P3_SRC = 4002  # 1122 回正:三采 p3 4K 出口(ReCaVSRUpscale.VIDEO)——5002/5100 双吃(与单镜同构)
UNET = 34     # 唯一 UNETLoader
CLIP, VAE_V, VAE_A = 21, 7, 13
LENGTH_NODE = 3031          # 帧数同源参照件(5012.length widget 与其 length widget 同值)
LENGTH = 56                 # 出厂帧数(2×1秒@24fps→[22,34]→56,multiseg 出厂口径)
REF_API = 9                 # API 模板 LoadImage(画布件无 LoadImage,零参考出厂)
API_TAIL = 36               # API 模板一采直出 CreateVideo(喂 4=一采预览;1123 D1 起 remux 已剔,此锚仅存史)
PREFIX_P_FINAL = "video/H3/分段视频/p-final"

# 1119 双档移植(母本 1119 起 OWN 扩为 25 件):全量继承,不再过滤 HD_IDS——六件
# (5109/5110 VOSR2 尾档+5111/5113 投切+5024/5025 复制对)同 id 直搬;母本 V2.1/V2.2
# 砍除面(5105-5107/5112/5101-5104)随 RETIRED 一并防御性剥离(multiseg 盘上天然无,
# 重跑他人误植即净)。1118 役曾以 HD_FILTER 只取 19 件原链(当时 multiseg 不随双档),
# 本役开放。
OWN: dict[int, str] = dict(MB.OWN)
RETIRED: dict[int, str] = dict(MB.RETIRED)  # V2.1/V2.2 砍除件:multiseg 天然无,防御性同剥
WIDGETS = {k: (list(v) if v is not None else None) for k, v in MB.WIDGETS.items()}
WIDGETS[5012] = ["", 768, 768, LENGTH, "max"]   # length=56 出厂(3031 同值);宽高位被 5011 联线覆盖
WIDGETS[4100] = [PREFIX_P_FINAL, "auto", "auto", "auto"]  # p-final 前缀换本件口径(勿承三采 chapter-001)
# 5011 追踪分策(1118 收尾):锚三元组取母本终版(closest_to_xy/1920/900/@f170),身份栈退回
# insightface+0.28——本件布线密度无余量(490 位仪表扫描实证任何新线必破棘轮),免 CLIPVision
# 装载器;七发探针定谳 clip_vision 身份全程 never consulted,锚才是根因修复。
_w = WIDGETS[5011]
_w[11], _w[16] = 0.28, "insightface"
WIDGETS[5011] = _w

GROUP_A_TITLE = "四采修脸组(5000 段·远景/高清双档·默认旁路·1118→1119 multiseg)"
GROUP_A_TITLE_1118 = "四采修脸组(5000 段·默认旁路·1118 multiseg)"  # 1118 旧标题,剥离过渡期一并移除
GROUP_B_TITLE = "终档组"                                            # 1122 用户令改名(旧全名如下,剥离过渡期一并移除)
GROUP_B_TITLE_1118 = "终档组(p-final·四采开关·1118 multiseg)"      # 1118 旧标题,防重放残留双终档组
GROUP_A_IDS = set(MB.GROUP_A_IDS)           # 25/1065/5002/5006/5011-5025/5109-5111/5113(1119 双档六件入同组)
GROUP_B_IDS = set(MB.GROUP_B_IDS)           # 5100/4100
README_MARK = "\n\n---\n\n## 四采修脸(内置·默认旁路·1118 multiseg)"
README_SECTION = README_MARK + """

- **开关 #1065「四采修脸」**:默认 **False=旁路**——终档 4100 p-final=4002 三采 p3 直通,50xx 臂被引擎惰性剪除
  (0.45.2 实证,同 单镜 1118 双态探针口径),零成本;**True=三采出片内部走进修脸→终档一条线**
- **#25 修脸身份提示词**:默认通用句;外部按角色覆写(参照正片人物五官特征)
- **臂拓扑**(同 单镜 1118 §1.1):5002 拆 4002(三采 p3 4K 出片·帧①+音轨②)→ 5011 追踪裁剪(face_yolov8m
  conf0.15/兜底 segm\\person_yolov8m-seg.pt/largest_face)→ 5012 H3 重画(**宽高=5011 出口联线勿手填**/
  参考图=零参考出厂/提示词=#25)→ 5013 注入真实帧 → 5014 音轨锁(audio←5002②)→ 5015 逐帧 denoise
  (60/200px)→ 5016-5020 采样(seed 42 同 3040/lcm/simple/8步/0.45)→ 5021 解码 → 5022 贴回(16/24)
  → 5023 合成 → 5113 出口选择 → 5100 终档选择 → 4100 p-final
- **帧数同步纪律(1123 D4/D5 改版)**:[5012].length 已接线 ← [5011].frame_count(INT 出口,
  K2 核毕)=追踪器实测帧数,自动同步勿手填;唯 [3031].length 无图内总帧数出口(K3 核毕
  H3AutoContextSampler/H3Parameter 均只出 DICT)——**改分段时长必须手动同步 [3031].length**
  (出厂 56;App 路由组装器随车覆写 3031.length=总帧数,不受此项影响)
- **极性口径**(同三采 1118 双态实测定谳):5100 on_true=修脸臂出口(1065=true)/on_false=4002 p3 直通
  (1065=false);5113 on_true=5025 高清片/on_false=5023 远景片——两 Switch 均「真=新臂」,勿手改(防 wf2api 反转坑)
- **显存纪律**:5006 LoRA 挂 34 单 loader(全图禁第二个 UNETLoader);p1/p2/p3 三档照常落盘;段B 4001-4003
  出厂激活(mode=0,1122 用户裁定解旁路,整图一发直出三档)——修脸组直吃 4002 出口,与段B 串联
- **生效面**:仓库/引擎直投即时生效;装机 App 面候打包窗口另役同步
- **改版顺序(三步链,恒此序)**:①multiseg_full3stage_extend.py(重建 41 节点态)→
  ②lowvram_dual_node_1118.py(补 1066:link1/link15 改源回 1066+ChunkFFN 激活,幂等)→
  ③本生成器(重建 67 节点+组16/17+本 README 段);跳步即断链(漏②直接跑本件,WIRING 引用 1066 即崩)

### 1119 双档调用(远景=默认 / 高清;multiseg 移植)

- **#5111「高清修脸」子开关**(默认 **False=远景档**):False 时 5113 出口 VIDEO Switch 直通 5023
  远景链、5022/5024.masks 恒悬空(face_only 脸框贴回=正典现状);True 时 VOSR2 高频尾档
  (5110,control=**fixed** seed 锁 300831622214023 禁 randomize 回抖)→ 5024/5025 高清复制对
  (**5024.masks 悬空=face_only 贴回,与 5022 同款**)→ 5113 出口
- **四态矩阵**:1065=False(出厂)→ p3 直通不修脸;1065=True ∧ 5111=False → **远景修脸=默认修脸档**;
  1065=True ∧ 5111=True → 高清修脸;**1065=False ∧ 5111=True = 非法态**(高清段被计算却在 5100
  被丢弃=静默剪枝)——发车器(API 直调)注入前必须拒绝此组合
- **1122 回正(刻碑)**:两件同吃**三采底**——multiseg 修脸入口=4002(三采 p3 4K 出片口,与单镜
  5002←4002 同构;段B mode 4→0 出厂激活随同批解旁路);VOSR2 均吃 5021 解码 768 画布,
  档位语义与上游底两件一致
- **API 直调(延伸)**:远景档 `g["1065"]...=true`;高清档再加 `g["5111"]["inputs"]["value"]=true`
  (+#25 身份句;1065=false 时发车器拒单);**1123 D1/D3 起 API 面=一采正典臂烙入(101 外接
  1044/1045/1046)+MyShot 103 锚 4100 终档+remux 5030/5031 剔除**,4=一采预览(-p1)、
  4100=终档(-p-final,组装器注入),36 一采直出仅喂 4
"""

TITLE = dict(MB.TITLE)
TITLE[5002] = "四采·拆帧拆音(←4002 三采 p3 4K)"
TITLE[5006] = "四采·Pika turbo 8step LoRA(复用 34)"
TITLE[5016] = "四采·噪声(同源 #3040)"  # 1123 #8:本件无 #54(单镜编号),勘误为 #3040

# 布局=x 严格右向(同三采契约刻碑);新区起 x=11300(组⑤ ReCaVSR 右缘 11060 之外,组框零相交)。
# 1118 布局治理役(apps/build/scripts/workflow_layout_fix_multiseg_band_1118.py)立分层行带:
# R1 y1000 主链头(5002→5011→5012→5013,净距恰 200)+终档同道右置(5100→4100;5023→5100
# 留 GAP 200 组间通道,组隙 140 同三采;终档留浅廊=3053→5100 不下钻穿带);
# R2 y1760 中尾行(PITCH 760):5006(5012 est 右缘齐位,贴 5014 净距 200)→5014(wrap 70
# 落行)→5015→5020→5021→5022→5023(GAP 200 链);R3 y2520 纵堆(5016/5019/5017/5018
# 行序=5020 输入槽序 noise/guider/sampler/sigmas,x 全等净距恰 80);寄生:25 右缘齐 5012
# 左缘(y=5011 est 底+80)、1065=5100 左 530(y=5013 est 底+80)。重跑本生成器按本表落位。
# 1119 双档六件(1122 HD 段下沉错行重排,R3 底 3316 之下阶梯四行,est 零容忍口径):
#   行A y3480:5109→5110(净距 200;>5021.x=15150 恒右向;5110 est 高 520 底=4000);
#   行B y4080:5024(吃 5110,x 微进 70 恒右向,纵距 80 清 est_overlap);
#   行C y4530:5025(x>5024 恒右向,纵距 80);
#   行D y4842:5113 出口(>5023.x=16130 恒右向且 <5100.x=16600;组框 A 右缘 16400(=5023 右缘)
#   让开终档组 x1=16540 余 140px);开关位 5111=臂头下方 y3800(左于 5113 扇出,同 单镜「开关位左置」口径)。
POS = {
    5002: [11300, 1000], 5011: [11770, 1000], 5012: [12330, 1000], 5013: [12930, 1000],
    5006: [12730, 1760], 5014: [13330, 1760], 5015: [13860, 1760],
    5016: [14260, 2520], 5019: [14260, 2748], 5017: [14260, 2940], 5018: [14260, 3138],
    5020: [14700, 1760], 5021: [15150, 1760], 5022: [15600, 1760], 5023: [16130, 1760],
    5100: [16600, 1000], 4100: [17070, 1000], 25: [11900, 2002], 1065: [16070, 1216],
    # ---- 1119 HD 段(见上布局注;1122 下沉错行重排)----
    5111: [12060, 3800],
    5109: [15210, 3480], 5110: [15730, 3480],
    5024: [15800, 4080], 5025: [15880, 4530], 5113: [16200, 4842],
}
SIZE = dict(MB.SIZE)

# ---- 连线(母本 40 条减 ref/length 两条=38 + 1119 双档 10 条=48;锚=4002/34/21/7/13)----
WIRING = [
    (P3_SRC, "VIDEO", 5002, "video"),    # 1122 回正:拆帧吃三采 p3 4K(用户裁定,与单镜同构)
    (P3_SRC, "VIDEO", 5100, "on_false"),  # 旁路态终档=4002 p3 直通(旧 3053 p2 直通废)
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
    (5011, "frame_count", 5012, "length"),  # 1123 D4:帧数同步图化(K2 核毕 frame_count=INT 出口),widget 值退居展示位
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
    (1065, "BOOLEAN", 5100, "switch"),
    (5100, "COMFY_MATCHTYPE_V3", 4100, "video"),
    # ---- 1119 高清段(VOSR2 尾档;5024.masks 恒悬空=face_only 贴回,同 单镜 V2.2)----
    (5109, "model", 5110, "model"),
    (5021, "IMAGE", 5110, "image"),
    (5110, "IMAGE", 5024, "refined_crops"),
    (5002, "images", 5024, "base_images"),
    (5011, "transform", 5024, "transform"),
    (5024, "images", 5025, "images"),
    (5002, "audio", 5025, "audio"),
    (5025, "VIDEO", 5113, "on_true"),
    # ---- 1119 投切(出口复制案)----
    (5023, "VIDEO", 5113, "on_false"),     # 原 5023→5100.on_true 等效改接(远景态直通臂)
    (5111, "BOOLEAN", 5113, "switch"),
    (5113, "COMFY_MATCHTYPE_V3", 5100, "on_true"),
]


def die(msg: str) -> None:
    sys.exit(f"[FATAL] {msg}")



# ── 1123 二采正典簇(引擎验证实发图整体烙入;禁手改,改=重导出实发图) ──
STAGE2_IDS = ['1066', '1033', '3011', '1021', '3001', '3002', '3003', '3030', '3031', '3021', '3022', '3040', '3041', '3042', '3043', '3044', '3051', '3052', '3053']
STAGE2_NODES = json.loads(r"""{
 "1066": {
  "class_type": "MiniMaxLowVRAMAttention",
  "inputs": {
   "model": [
    "34",
    0
   ],
   "head_chunks": 2
  }
 },
 "1033": {
  "class_type": "BlockSparseAttention",
  "inputs": {
   "model": [
    "1021",
    0
   ],
   "selection": "sol-attn",
   "selection.tau": 1.3,
   "start_percent": 0,
   "end_percent": 1,
   "dense_blocks": "",
   "min_tokens": 12288,
   "extra_tokens": 256,
   "sink_conditioning": "exact_kv_and_rows",
   "verbose": false
  }
 },
 "3011": {
  "class_type": "MiniMaxChunkFeedForward",
  "inputs": {
   "model": [
    "1033",
    0
   ],
   "chunks": 2,
   "seq_threshold": 4096
  }
 },
 "1021": {
  "class_type": "LoraLoaderModelOnly",
  "inputs": {
   "model": [
    "1066",
    0
   ],
   "lora_name": "taomate_h3_3step.safetensors",
   "strength_model": 0.7
  }
 },
 "3001": {
  "class_type": "LTXVSeparateAVLatent",
  "inputs": {
   "av_latent": [
    "101",
    1
   ]
  }
 },
 "3002": {
  "class_type": "MinimaxH3LatentUpscaler3D",
  "inputs": {
   "latent": [
    "3001",
    0
   ],
   "model_name": "minimax_h3_latent_upscaler_3d_bf16.safetensors",
   "mode.width": 1440,
   "mode.height": 832,
   "align": 32,
   "enable_temporal_chunking": true,
   "force_unload": true,
   "device": "cuda",
   "precision": "fp16",
   "mode": "target dimensions"
  }
 },
 "3003": {
  "class_type": "LTXVConcatAVLatent",
  "inputs": {
   "video_latent": [
    "3002",
    0
   ],
   "audio_latent": [
    "3001",
    1
   ]
  }
 },
 "3030": {
  "class_type": "PrimitiveStringMultiline",
  "inputs": {
   "value": "段1:1秒\n[Shot 1] 中景，固定机位。一位穿深蓝色长袍的年轻剑修站在竹林小径上，微微抬头看向竹梢，晨光从竹叶缝隙洒落，竹叶轻晃。\n\n段2:1秒\n[Shot 1] 他收回视线，抬手把拂过肩头的竹叶轻轻拨开，衣袖摆动，沿小径继续向前走去。\n\noverall_soundscape: 清晨竹林鸟鸣，风吹竹叶沙沙声，脚步踩在落叶上的轻响"
  }
 },
 "3031": {
  "class_type": "MiniMaxH3ReferenceToVideo",
  "inputs": {
   "clip": [
    "21",
    0
   ],
   "prompt": [
    "3030",
    0
   ],
   "width": 1440,
   "height": 832,
   "length": 56,
   "ref_image_size": "match",
   "vae": [
    "7",
    0
   ],
   "audio_vae": [
    "13",
    0
   ]
  }
 },
 "3021": {
  "class_type": "MiniMaxH3SigmaShift",
  "inputs": {
   "model": [
    "3011",
    0
   ],
   "shift_video": 12,
   "shift_audio": 3
  }
 },
 "3022": {
  "class_type": "KSamplerSelect",
  "inputs": {
   "sampler_name": "lcm"
  }
 },
 "3040": {
  "class_type": "RandomNoise",
  "inputs": {
   "noise_seed": 42
  }
 },
 "3041": {
  "class_type": "BasicScheduler",
  "inputs": {
   "model": [
    "3021",
    0
   ],
   "scheduler": "simple",
   "steps": 3,
   "denoise": 0.2
  }
 },
 "3042": {
  "class_type": "BasicGuider",
  "inputs": {
   "model": [
    "3044",
    0
   ],
   "conditioning": [
    "3031",
    0
   ]
  }
 },
 "3043": {
  "class_type": "SamplerCustomAdvanced",
  "inputs": {
   "noise": [
    "3040",
    0
   ],
   "guider": [
    "3042",
    0
   ],
   "sampler": [
    "3022",
    0
   ],
   "sigmas": [
    "3041",
    0
   ],
   "latent_image": [
    "3003",
    0
   ]
  }
 },
 "3044": {
  "class_type": "ModelAttentionBackend",
  "inputs": {
   "model": [
    "3021",
    0
   ],
   "attention": "comfy kitchen attention"
  }
 },
 "3051": {
  "class_type": "VAEDecode",
  "inputs": {
   "samples": [
    "3043",
    0
   ],
   "vae": [
    "7",
    0
   ]
  }
 },
 "3052": {
  "class_type": "VAEDecodeAudio",
  "inputs": {
   "samples": [
    "3043",
    0
   ],
   "vae": [
    "13",
    0
   ]
  }
 },
 "3053": {
  "class_type": "CreateVideo",
  "inputs": {
   "images": [
    "3051",
    0
   ],
   "fps": 24,
   "audio": [
    "3052",
    0
   ],
   "bit_depth": 8,
   "color_space": "sRGB"
  }
 }
}""")
STAGE2_CLASSES = {'1066': 'MiniMaxLowVRAMAttention', '1033': 'BlockSparseAttention', '3011': 'MiniMaxChunkFeedForward', '1021': 'LoraLoaderModelOnly', '3001': 'LTXVSeparateAVLatent', '3002': 'MinimaxH3LatentUpscaler3D', '3003': 'LTXVConcatAVLatent', '3030': 'PrimitiveStringMultiline', '3031': 'MiniMaxH3ReferenceToVideo', '3021': 'MiniMaxH3SigmaShift', '3022': 'KSamplerSelect', '3040': 'RandomNoise', '3041': 'BasicScheduler', '3042': 'BasicGuider', '3043': 'SamplerCustomAdvanced', '3044': 'ModelAttentionBackend', '3051': 'VAEDecode', '3052': 'VAEDecodeAudio', '3053': 'CreateVideo'}

# ── 1123 D1=A′:一采正典臂 PASS1_ARM(画布 1115 正典臂逐值真源,引擎验证同款类谱;
#    键名以 STAGE2 同类节点实锚为准——1033/3011/3044/3021/3041/3022 均引擎实发图烙入件) ──
PASS1_IDS = ['1041', '1042', '1043', '1044', '1045', '1046']
PASS1_NODES = json.loads(r"""{
 "1041": {
  "class_type": "BlockSparseAttention",
  "inputs": {
   "model": [
    "41",
    0
   ],
   "selection": "sol-attn",
   "selection.tau": 1.3,
   "start_percent": 0,
   "end_percent": 1,
   "dense_blocks": "",
   "min_tokens": 12288,
   "extra_tokens": 256,
   "sink_conditioning": "exact_kv_and_rows",
   "verbose": false
  }
 },
 "1042": {
  "class_type": "MiniMaxChunkFeedForward",
  "inputs": {
   "model": [
    "1041",
    0
   ],
   "chunks": 2,
   "seq_threshold": 4096
  }
 },
 "1043": {
  "class_type": "ModelAttentionBackend",
  "inputs": {
   "model": [
    "1042",
    0
   ],
   "attention": "comfy kitchen attention"
  }
 },
 "1044": {
  "class_type": "MiniMaxH3SigmaShift",
  "inputs": {
   "model": [
    "1043",
    0
   ],
   "shift_video": 6,
   "shift_audio": 3
  }
 },
 "1045": {
  "class_type": "BasicScheduler",
  "inputs": {
   "model": [
    "1044",
    0
   ],
   "scheduler": "simple",
   "steps": 8,
   "denoise": 1.0
  }
 },
 "1046": {
  "class_type": "KSamplerSelect",
  "inputs": {
   "sampler_name": "lcm"
  }
 }
}""")
PASS1_CLASSES = {'1041': 'BlockSparseAttention', '1042': 'MiniMaxChunkFeedForward',
                 '1043': 'ModelAttentionBackend', '1044': 'MiniMaxH3SigmaShift',
                 '1045': 'BasicScheduler', '1046': 'KSamplerSelect'}
# 基座改写锚(1123 D1=A′):基座节点接线逐口改写,改前校验 class_type 防他人占用
PASS1_BASE_EXPECT = {"41": "LoraLoaderModelOnly", "101": "H3AutoContextSampler", "103": "MyShot"}

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
        ins["video"] = ["4002", 0]  # 1122 用户令:修脸吃三采后(ReCaVSR 4K,与画布同语义);1118 探针的 auto-context 边界由 5031 remux 承担
    elif k == "5006":
        ins["model"] = ["1066", 0]  # 1123 D1:与画布同构经 1066 lowvram 头分块收束点(34→1066→5006)
    elif k == "5012":
        ins["clip"] = [str(CLIP), 0]
        ins["vae"] = [str(VAE_V), 0]
        ins["audio_vae"] = [str(VAE_A), 0]
        ins["ref_images.ref_image_0"] = [str(REF_API), 0]
        ins["length"] = ["5011", 6]  # 1123 D4:帧数同步图化(frame_count=5011 输出槽6,K2 核毕 INT);widget 56 退居画布展示位
    elif k == "5013":
        ins["vae"] = [str(VAE_V), 0]
    elif k == "5011":
        ins["identity_clip_vision"] = ["800", 0]  # 母本携带 int 800 引用(API 格式须 str,1122 根治历史悬空)
    elif k == "5014":
        ins["audio_vae"] = [str(VAE_A), 0]
    elif k == "5021":
        ins["vae"] = [str(VAE_V), 0]
    elif k == "5100":
        ins["on_false"] = ["4002", 0]  # p3 直通臂同步三采 4K(1122)
    elif k == "4100":
        ins["filename_prefix"] = PREFIX_P_FINAL
    return d


def strip_canvas(S: dict) -> dict:
    """剥离本组既往添加(幂等;剥离前校验类型防误删他人节点)。

    own_ids 含 RETIRED(母本 V2.1/V2.2 砍除件)——multiseg 盘上天然无,误植重放即净;
    组标题含 1118 旧称(双档移植前)与 1122 改名前终档组旧全名过渡剥离(防双终档组)。"""
    own_ids = set(OWN) | set(RETIRED)
    expect = {**OWN, **RETIRED}
    for n in list(S["nodes"]):
        if n["id"] in own_ids:
            if n["type"] != expect[n["id"]]:
                die(f"画布件 #{n['id']} 已被他人占用为 {n['type']}(预期 {expect[n['id']]}),拒剥")
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
                   if g.get("title") not in (GROUP_A_TITLE, GROUP_A_TITLE_1118,
                                             GROUP_B_TITLE, GROUP_B_TITLE_1118)]
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
    S["last_node_id"] = max(S["last_node_id"], TAIL, 5100, 4100, 1065, 5113)

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
    return fix_seed_control_layout(S)


def fix_seed_control_layout(S: dict) -> dict:
    """1123 D17 探针实证(真实前端加载导出):#101 控件值表漏了 seed 后的「固定」项。

    前端给 seed 控件自动配 control_after_generate 下拉并一并序列化(同画布 4002/5110 均带 "fixed");
    #101 的表按 10 个标量写,加载后第 3 位(本应给 steps 的 8)落进该下拉,其后整体错位一格
    (导出 steps=1/cfg="euler"/sampler_name="simple"/scheduler=1/denoise=true/enable_cache=false)。
    #101 属「本件既有」节点,剥离重放不触及,历史脚本手写从未经前端存盘回写 → 在此规整。
    幂等:已带该项(第 3 位为字符串)原样;不在两种已知形态内=拒改报错(禁猜)。"""
    wv = node_by_id(S["nodes"], 101).get("widgets_values")
    if isinstance(wv, list) and len(wv) == 11 and isinstance(wv[2], str):
        return S
    if isinstance(wv, list) and len(wv) == 10 and isinstance(wv[1], int) and not isinstance(wv[2], str):
        wv.insert(2, "fixed")
        return S
    die(f"#101 widgets_values 形态非预期({wv!r}),拒改")


def build_api(A: dict) -> dict:
    strip = {**{k: v for k, v in {**OWN, **RETIRED}.items()},
             5030: "GetVideoComponents", 5031: "CreateVideo",
             800: "CLIPVisionLoader", 4001: "ReCaVSRLoader", 4002: "ReCaVSRUpscale",
             **STAGE2_CLASSES, **PASS1_CLASSES}
    for k, ct in strip.items():  # RETIRED/remux/三采臂/一采臂同剥(键序确定性:全剥全按固定序重追加)
        old = A.get(str(k))
        if old is not None and old.get("class_type") != ct:
            die(f"API 模板节点 {k} 已被他人占用为 {old.get('class_type')}(预期 {ct}),拒剥")
        A.pop(str(k), None)
    for k in OWN:  # 固定插入序,重跑字节稳定
        A[str(k)] = api_node(str(k))
    # 1123 D1=#8:remux 5030/5031 剔除不再回加(4002 已改吃 3053 后纯孤立;1118 探针场景已随
    # 1122 三采回正作废——终档链=3053→4002→{5002,5100}→4100,auto-context 边界由三采链承担)
    # 1123 用户令(正典裁定):一采→二采→三采 恒走,修脸四采仅按需——二采簇自引擎验证实发图
    # (apps/output/pi-h3-test-1121/apptpl3-stage2.json,success 83.5s)整体烙入,键名以引擎 400 实锚为真源
    for k in STAGE2_IDS:
        A[k] = copy.deepcopy(STAGE2_NODES[k])
    # 1122 用户令:App multiseg 三采后修脸——ReCaVSR 臂 + 补 800 CLIPVisionLoader(历史悬空顺手封)
    A["800"] = {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": "clip_vision_g.safetensors"}}
    A["4001"] = {"class_type": "ReCaVSRLoader", "inputs": {"transformer": "transformer_int8_convrot.safetensors"}}  # 输入键=transformer(object_info 实锚;model_name 为 400 实弹勘误)
    A["4002"] = {"class_type": "ReCaVSRUpscale", "inputs": {
        "model": ["4001", 0], "video": ["3053", 0],
        "scale": 2.667, "color_fix": "none", "seed": 42,
        "decoder": "flashdecoder", "kernels": "fast", "kv_offload": False,
        "encoder": "auto", "fps": 30}}  # 三采吃二采 p2(3053);2.667=1440→3840 恒宽锚(1123 正典)
    # 1123 D1=A′:一采正典臂六节点烙入(画布 1115 臂逐值真源;链 41→1041→1042→1043→1044→101)
    for k in PASS1_IDS:
        A[k] = copy.deepcopy(PASS1_NODES[k])
    # 1123 D1=A′+#1:基座接线改写(幂等直写;class_type 先验防漂)
    for k, ct in PASS1_BASE_EXPECT.items():
        if A.get(k, {}).get("class_type") != ct:
            die(f"API 模板基座节点 {k} 已被他人占用为 {A.get(k, {}).get('class_type')}(预期 {ct}),拒改写")
    A["41"]["inputs"]["model"] = ["1066", 0]      # 一采 LoRA 臂经 lowvram 头(画布 link1 同构)
    A["101"]["inputs"]["model"] = ["1044", 0]     # 裸 41 直连废除,吃 σshift[6,3] 出口
    A["101"]["inputs"]["sampler"] = ["1046", 0]   # 外接 lcm(object_info optional 单键,真名 sampler)
    A["101"]["inputs"]["sigmas"] = ["1045", 0]    # 外接 simple/8/dn1.0(真名 sigmas)
    A["103"]["inputs"]["video"] = ["4100", 0]     # MyShot 锚终档(#1:与三采 3061←4003 同语义)
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
    ok(n_canvas == 67, f"画布节点数=67(41+19 修脸组+lowvram役#1066+1119 双档 6),实际 {n_canvas}")
    # 1123 D1=A′ 定账:63 − remux5030/5031 两孤立 + PASS1_ARM 六节点 = 67(PRD 写 69 为算术笔误,
    # 批复实质=「+6 烙入、−2 剔除」,以本行为准)
    ok(n_api == 67, f"API 节点数=67(61+1123 D1 一采正典臂 6;remux 5030/5031 已剔),实际 {n_api}")
    ok("5030" not in A and "5031" not in A, "remux 5030/5031 已剔除(1123 #8:4002 改吃 3053 后纯孤立)")

    ids = [n["id"] for n in S["nodes"]]
    idset = set(ids)
    ok(len(ids) == len(idset), "画布节点 id 唯一")
    ok(all(l[1] in idset and l[3] in idset for l in S["links"]), "画布无悬空链")
    ok(all(i not in idset for i in RETIRED), "V2.1/V2.2 砍除件不在画布(防御性剥离面)")
    ok(all(str(i) not in A for i in RETIRED), "V2.1/V2.2 砍除键不在 API(防御性剥离面)")
    ok(all(str(i) in A for i in OWN), "25 新节点(19 臂+6 双档)API/画布两件齐备")

    ok(next(n for n in S["nodes"] if n["id"] == 1065).get("widgets_values") == [False],
       "画布 #1065 开关默认 False")
    ok(A["1065"]["inputs"]["value"] is False, "API #1065 开关默认 False")
    b111 = next(n for n in S["nodes"] if n["id"] == 5111)
    ok(b111["type"] == "PrimitiveBoolean" and b111.get("widgets_values") == [False],
       "画布 #5111 高清子开关默认 False(远景=默认档)")
    ok(A["5111"]["inputs"]["value"] is False, "API #5111 默认 False(可注入)")
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
    fl = src_of(5012, "length")
    ok(fl and fl[1] == 5011 and nmap[5011]["outputs"][fl[2]]["name"] == "frame_count",
       "画布 5012.length=5011.frame_count 出口联线(1123 D4,帧数同步图化)")
    ok(A["5012"]["inputs"]["width"] == ["5011", 4] and A["5012"]["inputs"]["height"] == ["5011", 5],
       "API 5012 宽高=5011 出口(canvas_w=4/canvas_h=5)")
    ok(A["5012"]["inputs"]["length"] == ["5011", 6], "API 5012.length=[5011,6] frame_count(1123 D4)")

    n3031 = next(n for n in S["nodes"] if n["id"] == LENGTH_NODE)
    n5012 = next(n for n in S["nodes"] if n["id"] == 5012)
    ok(n5012["widgets_values"][3] == LENGTH == n3031["widgets_values"][3],
       f"5012/3031 出厂 widget 同值 {LENGTH}(5012 已接线退居展示位;3031 手动同步纪律)")

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
    ok(cover, "组框罩全(25 新节点全部落框,双档六件入四采组框不立第三框)")
    gover = []
    all_groups = S.get("groups", [])
    for i in range(len(all_groups)):
        for j in range(i + 1, len(all_groups)):
            a, b = all_groups[i]["bounding"], all_groups[j]["bounding"]
            if a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]:
                gover.append((all_groups[i]["title"], all_groups[j]["title"]))
    ok(not gover, f"组框两两不交(A 右缘让开终档组),违例 {gover}")

    def wired(nid, in_name, want_src):
        l = src_of(nid, in_name)
        return bool(l) and l[1] == want_src

    ok(wired(5002, "video", P3_SRC) and wired(5100, "on_false", P3_SRC) and wired(5100, "on_true", 5113)
       and wired(5100, "switch", 1065) and wired(4100, "video", 5100)
       and wired(5006, "model", 1066)  # 81f8909f lowvram 插桩后经 1066 头分块收束点=34 扇出之后
       and wired(5014, "audio", 5002) and wired(5019, "conditioning", 5012)
       and wired(5020, "noise", 5016),
       f"关键联线拓扑(5002←{P3_SRC} 三采 p3/5100 双臂+开关(1119 改接 on_true←5113)/4100←5100/5006←{UNET}/5014.audio←5002②/5019←5012/5020←5016)")
    ok(A["5002"]["inputs"]["video"] == ["4002", 0]
       and A["5100"]["inputs"]["on_false"] == ["4002", 0]
       and A["4002"]["inputs"]["video"] == ["3053", 0]
       and A["4002"]["inputs"]["model"] == ["4001", 0]
       and A["4002"]["inputs"]["scale"] == 2.667
       and A["3030"]["class_type"] == "PrimitiveStringMultiline"
       and A["3031"]["inputs"]["width"] == 1440 and A["3031"]["inputs"]["height"] == 832
       and A["3043"]["inputs"]["latent_image"] == ["3003", 0]
       and A["3053"]["class_type"] == "CreateVideo"
       and A["800"]["class_type"] == "CLIPVisionLoader"
       and A["5100"]["inputs"]["on_true"] == ["5113", 0]
       and A["4100"]["inputs"]["video"] == ["5100", 0]
       and A["5006"]["inputs"]["model"] == ["1066", 0]
       and A["5012"]["inputs"]["ref_images.ref_image_0"] == [str(REF_API), 0], "API 关键拓扑同构(参考图 9/5100.on_true←5113/5006←1066)")

    # ---- 1123 D1=A′:一采正典臂 PASS1_ARM(API 面)----
    ok(A["1041"]["inputs"] == {"model": ["41", 0], "selection": "sol-attn", "selection.tau": 1.3,
       "start_percent": 0, "end_percent": 1, "dense_blocks": "", "min_tokens": 12288,
       "extra_tokens": 256, "sink_conditioning": "exact_kv_and_rows", "verbose": False}
       and A["1042"]["inputs"] == {"model": ["1041", 0], "chunks": 2, "seq_threshold": 4096}
       and A["1043"]["inputs"] == {"model": ["1042", 0], "attention": "comfy kitchen attention"}
       and A["1044"]["inputs"] == {"model": ["1043", 0], "shift_video": 6, "shift_audio": 3}
       and A["1045"]["inputs"] == {"model": ["1044", 0], "scheduler": "simple", "steps": 8, "denoise": 1.0}
       and A["1046"]["inputs"] == {"sampler_name": "lcm"},
       "PASS1_ARM 六节点逐值(1041 sol-attn τ1.3/1042 ChunkFFN[2,4096]/1043 kitchen/1044 σshift[6,3]/1045 simple·8·1.0/1046 lcm)")
    ok(A["41"]["inputs"]["model"] == ["1066", 0]
       and A["101"]["inputs"]["model"] == ["1044", 0]
       and A["101"]["inputs"]["sampler"] == ["1046", 0]
       and A["101"]["inputs"]["sigmas"] == ["1045", 0]
       and A["103"]["inputs"]["video"] == ["4100", 0],
       "基座接线改写(41←1066/101 三口外接 1044·1046·1045/103 MyShot 锚 4100 终档)")

    # ---- 1119 双档结构契约(同 单镜 test_facerefine_dual_mode_1119 口径)----
    ok(wired(5113, "switch", 5111) and wired(5113, "on_false", 5023) and wired(5113, "on_true", 5025),
       "5113 出口极性:switch←5111/on_false←5023 远景/on_true←5025 高清")
    ok(wired(5110, "model", 5109) and wired(5110, "image", 5021),
       "VOSR2 尾档:5109→5110(image←5021 解码 768 画布)")
    ok(nmap[5110]["widgets_values"] == [1, 300831622214023, "fixed", "wavelet", 512, 32, 1024, 32]
       and nmap[5110]["widgets_values"][2] == "fixed",
       "5110 widgets 逐位照单镜(control=fixed seed 锁 300831622214023 禁 randomize)")
    ok(nmap[5109]["widgets_values"] == ["VOSR2", "default"], "5109 widgets 逐位照单镜")
    ok(nmap[101]["widgets_values"] == [0.0, 42, "fixed", 8, 1.0, "euler", "simple", 1.0, True, False, False],
       "101 widgets seed 后带「固定」项(1123 D17:此前漏项,真实前端加载后 steps/cfg 等错位一格)")
    ok(nmap[5024]["widgets_values"] == nmap[5022]["widgets_values"],
       "5024 widgets 逐位同 5022(高清复制对)")
    ok(nmap[5025]["widgets_values"] == nmap[5023]["widgets_values"], "5025 widgets 逐位同 5023")
    m24 = next(s for s in nmap[5024]["inputs"] if s["name"] == "masks")
    ok(m24.get("link") is None, "5024.masks 恒悬空(face_only 贴回,同 5022/单镜 V2.2 口径)")
    ok(wired(5024, "refined_crops", 5110) and wired(5024, "base_images", 5002)
       and wired(5024, "transform", 5011),
       "5024 三进口:refined_crops←5110(VOSR2)/base←5002/transform←5011(masks 悬空)")
    ok(wired(5025, "images", 5024) and wired(5025, "audio", 5002), "5025:images←5024/audio←5002②")
    ok("masks" not in A["5024"]["inputs"] and A["5024"]["inputs"]["refined_crops"] == ["5110", 0]
       and A["5113"]["inputs"] == {"switch": ["5111", 0], "on_false": ["5023", 0], "on_true": ["5025", 0]}
       and A["5025"]["inputs"]["images"] == ["5024", 0] and A["5025"]["inputs"]["audio"] == ["5002", 1],
       "API 双档同构(5024 无 masks 注入+5113/5025 投切复制对)")

    # ---- 布局契约(零左向;单镜同构刻碑)----
    left_bad = [(l[0], l[1], l[3]) for l in S["links"]
                if nmap[l[3]]["pos"][0] <= nmap[l[1]]["pos"][0]]
    ok(not left_bad, f"全链恒向右(零左向线),违例 {left_bad[:5]}")
    ok(nmap[5110]["pos"][0] > nmap[5021]["pos"][0], "5110>5021(5021→5110 线恒右向,单镜同构)")

    ok(all(A[str(i)]["class_type"] == OWN[i] for i in OWN), "API/画布 25 节点 class_type 同构")
    t25 = next(n for n in S["nodes"] if n["id"] == 25)
    ok(bool(t25["widgets_values"][0].strip()) and A["25"]["inputs"]["value"] == t25["widgets_values"][0],
       "#25 默认通用句两件一致且非空")
    md = next(n for n in S["nodes"] if n["id"] == 9999)["widgets_values"][0]
    ok(README_MARK in md, "README 9999 已增「四采修脸」段")
    ok("### 1119 双档调用(远景=默认 / 高清;multiseg 移植)" in md and "非法态" in md
       and "1122 回正" in md and "三采底" in md,
       "README 9999 已增 1119 双档段(四态矩阵+非法态+1122 回正两件同吃三采底刻碑)")
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
    src_nodes = json.loads(SRC.read_text(encoding="utf-8"))["nodes"]
    S = strip_canvas(json.loads(CANVAS.read_text(encoding="utf-8")))
    S = build_canvas(S, src_nodes)
    write_json(CANVAS, S)
    A = build_api(json.loads(API.read_text(encoding="utf-8")))
    write_json(API, A)
    print(f"[OK] 画布 {CANVAS.name}:{len(S['nodes'])} 节点(41+19+1119 双档 6)/ {len(S['links'])} 链 / {len(S['groups'])} 组")
    print(f"[OK] API {API.name}:{len(A)} 节点(14+19+1119 双档 6+二采簇 19+800/4001/4002+D1 一采臂 6;remux 5030/5031 已剔)")

    # 幂等双跑字节一致(同母本 AC6):盘上产物再剥再建应逐字节复现
    S2 = build_canvas(strip_canvas(json.loads(CANVAS.read_text(encoding="utf-8"))), src_nodes)
    A2 = build_api(json.loads(API.read_text(encoding="utf-8")))
    idem = (json.dumps(S2, ensure_ascii=False, indent=2) == CANVAS.read_text(encoding="utf-8")
            and json.dumps(A2, ensure_ascii=False, indent=2) == API.read_text(encoding="utf-8"))
    if not idem:
        print("[FATAL] 幂等双跑字节不一致(生成器非确定性,禁改规格迁就)")
        return 1
    print("[OK] 幂等双跑字节一致(AC6)")
    return check()


if __name__ == "__main__":
    raise SystemExit(main())
