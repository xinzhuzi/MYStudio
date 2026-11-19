#!/usr/bin/env python3
"""单镜.json(1119 前旧名=三采-单镜)修脸组内置+双技术档生成器(1118 立·1119 双档扩,trellis 11-19-dualmode-facerefine-rename)。

1118 原役(11-17-facerefine-inline-bypass):正典画布件 + API 模板双输出,同构追加
「四采修脸臂」19 节点(默认旁路,拓扑=prd §1.1 修订版:内存态直连删 5001 LoadVideo、
显存修订删 5005 UNETLoader——5006 LoraLoader.model←1001 复用)。

1119 双档扩(PRD V2 §1)→ **V2.1 简化定案(零·五,探针 probe-1119 六发取证)**:
同组追加 10 节点,远景(默认)/高清两技术档,出口复制案投切。V2 的 14 节点案中
中链 SLNM 路被 AudioLock 源码级冲掉(ComfyUI-H3-NativeAudioLock/__init__.py:50-54
lock_audio 无条件覆写 locked["noise_mask"]——上游 SetLatentNoiseMask 带入的 mask 在
5014 恒被冲掉,恒无效;陶艺对拍 B 臂增益实证全部来自 SAM 贴回 5024.masks+VOSR2),
**砍 5105/5106/5107(MVEx+SLNM)与 5112(中链 LATENT Switch)**,MVEx 插件(GPL-3.0)
随之退出依赖面;5013.av_latent→5014 直连复原正典原链:

  #25    修脸身份提示词 PrimitiveStringMultiline(默认通用句,调用方按角色覆写)
  #1065  四采开关 PrimitiveBoolean(默认 False=旁路,出厂态不因本役改变)
  #5111  高清修脸子开关 PrimitiveBoolean(默认 **False=远景档**;True=高清档)
         四态矩阵:1065F+5111F=p3 直通(出厂)/1065T+5111F=远景修脸=默认修脸档/
         1065T+5111T=高清修脸/1065F+5111T=非法态(高清段静默剪枝,README 9999 记口径)
  5002-5023 公共底盘 19 节点(远景臂,widgets 逐位零改;接线仅一处等效改接:
         5023→5100.on_true 改经 5113 直通臂,远景态数据流等效 1118 正典
         (5013.av_latent→5014 直连=原链复原,V2.1 起零改写);5022.masks 恒悬空=
         face_only 脸框贴回保真)
  高清段 6 节点(参数逐位承融合件 1119b;差分扩散 5108 已移除禁回加;SLNM 路砍除):
         5101 CheckpointLoaderSimple(sam3.1_multiplex_fp16)→5102 CLIPTextEncode("face")
         →5103 SAM3_VideoTrack(0.5/1/1,images=5011.crops)→5104 SAM3_TrackToMask("0")
         遮罩只走贴回:5104.masks→5024.masks(单出口)
         VOSR2 尾档:5109 VOSR2ModelLoader("VOSR2"/default)→5110 VOSR2Upscale
         (1/300831622214023-**fixed**/wavelet/512/32/1024/32,image=5021.IMAGE)
  投切/复制 4 节点(出口复制案,5100 先例同构;全官方件零自定义投切,防缓存静默串档):
         5113 ComfySwitchNode(VIDEO 出口)on_false=5023 远景/on_true=5025 高清→5100.on_true
         5024 H3FaceStitch 高清复制对(widgets 逐位同 5022;masks=5104 非 5022 悬空)
         5025 CreateVideo 高清复制对(widgets 逐位同 5023)
  5100   ComfySwitchNode(switch←1065,on_false=4002 p3 直通,on_true=5113 出口)
  4100   SaveVideo(p-final)

节点账:画布 87→97(+10)、API 85→95(+10)。组框恒 7 组(扩四采组框罩全,组标题
更新双档口径)。布局:HD 段居 5000 带下方 y≥7300 行带+开关位+出口行,全链恒向右
(含 5103>5011/5110>5021 两处融合件左向后勘)、节点 AABB 零重叠、
组框两两不交(A 右缘让开终档组 120px)。

API 模板 +10 同构:命名输入实证源=object_info_17000.json+P1/P2 探针实跑图
(probe-1119/graph_p2-t.json SAM3/H3FaceStitch.masks/ComfySwitchNode 形态);5111 可注入。

幂等:先从当前正典件剥离本组既往添加(节点 id+触及链+两只组框+README 段,含 1118
旧组标题过渡剥离,剥离前校验类型防误删他人节点)后整体重放——母本即正典件自身,
重跑字节稳定;main 自带双跑字节一致对账(AC6)。
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
CANVAS = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/单镜.json"  # 1119 git mv 自 三采-单镜
API = REPO / "apps/frontend/lib/assist/image-studio/h3-three-stage-template.api.json"
CLONE = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/7_测试/三采-单镜-小脸修复.json"  # df4162c8 迁 7_测试/(留档名,3.3 豁免)

PREFIX_P_FINAL = "video/漫影/chapter-001/sb-chapter-001-001/p-final"
IDENTITY = (
    "The same person as in the video: sharp detailed facial features, clear bright eyes, "
    "well-defined facial contour, refined natural skin texture, clean hair edges; keep the "
    "exact facial identity, skin tone and lighting direction unchanged, no character redesign."
)

# ---- 本组节点规格(id → class_type);剥离与校验共用;序=重放 order 序 ----
# 1118 臂 19 件 + 1119 双档 10 件(HD_IDS,V2.1 砍后);multiseg 嫁接件按 HD_IDS 过滤只取 19 件原链。
OWN: dict[int, str] = {
    25: "PrimitiveStringMultiline", 1065: "PrimitiveBoolean",
    5002: "GetVideoComponents", 5006: "LoraLoaderModelOnly",
    5011: "H3FaceTrackCrop", 5012: "MiniMaxH3ReferenceToVideo",
    5013: "H3InjectVideoLatent", 5014: "MiniMaxH3NativeAudioLock",
    5015: "H3PerFrameDenoise", 5016: "RandomNoise", 5017: "KSamplerSelect",
    5018: "BasicScheduler", 5019: "BasicGuider", 5020: "SamplerCustomAdvanced",
    5021: "VAEDecode", 5022: "H3FaceStitch", 5023: "CreateVideo",
    5100: "ComfySwitchNode", 4100: "SaveVideo",
    # ---- 1119 双档 +10(V2.1:6 融合段 + 5111/5113 + 5024/5025 复制对;砍 5105/5106/5107/5112)----
    5101: "CheckpointLoaderSimple", 5102: "CLIPTextEncode",
    5103: "SAM3_VideoTrack", 5104: "SAM3_TrackToMask",
    5109: "VOSR2ModelLoader", 5110: "VOSR2Upscale",
    5111: "PrimitiveBoolean", 5113: "ComfySwitchNode",
    5024: "H3FaceStitch", 5025: "CreateVideo",
}
HD_IDS = {5101, 5102, 5103, 5104, 5109, 5110, 5111, 5113, 5024, 5025}
# V2.1 砍除件(PRD 零·五):SLNM 潜空间遮罩路被 AudioLock 源码级冲掉恒无效,连中链
# 5112 一并砍——盘上 101 版(V2 全量)重放时须按此剥离(类型校验防误删他人节点)。
RETIRED: dict[int, str] = {
    5105: "MVEx_MaskCleanup", 5106: "MVEx_MaskToLatentSpace",
    5107: "SetLatentNoiseMask", 5112: "ComfySwitchNode",
}

GROUP_A_TITLE = "四采修脸组(5000 段·远景/高清双档·默认旁路·1118→1119)"
GROUP_A_TITLE_1118 = "四采修脸组(5000 段·默认旁路·1118)"  # 旧标题,剥离过渡期一并移除
GROUP_B_TITLE = "终档组(p-final·四采开关)"
GROUP_A_IDS = {25, 1065, 5002, 5006, 5011, 5012, 5013, 5014, 5015, 5016, 5017, 5018, 5019,
               5020, 5021, 5022, 5023} | HD_IDS
GROUP_B_IDS = {5100, 4100}
README_MARK = "\n\n---\n\n## 四采修脸(内置·默认旁路·1118)"
README_SECTION = README_MARK + """

- **开关 #1065「四采修脸」**:默认 **False=旁路**——终档 4100 p-final=三采 p3 直通,50xx 臂被引擎惰性剪除(0.45.2 实证;1118 双态探针旁路态全链 264.3s 恰=纯三采一链,臂零叠加),零成本;**True=三采出片内部走进修脸→终档一条线**(外部只传参数,内部处理流程)
- **#25 修脸身份提示词**:默认通用句;外部按角色覆写(角色五官特征文,参照 #1 主图人物)
- **API 直调**:`g["1065"]["inputs"]["value"]=true` + `g["25"]["inputs"]["value"]="<角色五官特征句>"`,其余注入点与现行三采调用完全一致(图1/21/51/54/31/41)
- **臂拓扑**:5002 拆 4002(三采 p3 4K 出片·帧①+音轨②)→ 5011 追踪裁剪(face_yolov8m conf0.15/兜底 segm\\person_yolov8m-seg.pt/largest_face)→ 5012 H3 重画(**宽高=5011 出口联线勿手填**/length=#52/参考图=#1/提示词=#25)→ 5013 注入真实帧 → 5014 音轨锁(audio←5002②)→ 5015 逐帧 denoise(60/200px)→ 5016-5020 采样(seed 同 #54/lcm/simple/8步/0.45)→ 5021 解码 → 5022 贴回(16/24)→ 5023 合成 → 5100 终档选择 → 4100 p-final
- **极性口径(1118 双态实测定谳)**:**bypass(1065=false)=直通**——p-final 与 p3 MD5 逐字节一致(帧差 0px);**repair(1065=true)=修脸**——远端 t=1s 帧 >12 差分 24,467px;5100 接线 on_true=修脸片(1065=true)/ on_false=p3 直通(1065=false)与实测一致,勿手改(防 wf2api 反转坑)
- **显存纪律**:5006 LoRA 挂 1001 单 loader(全图禁第二个 UNETLoader);p1/p2/p3 两态照常落盘(诊断链完整),MyShot 3061 锚与 3071 零改动
- **生效面**:仓库/引擎直投即时生效;装机 App 面候打包窗口另役同步

### 1119 双档调用(远景=默认 / 高清)

- **#5111「高清修脸」子开关**(默认 **False=远景档**):False 时 5013→5014 直连(1118 正典原链)、5113 出口 VIDEO Switch 直通 5023 远景链、5022.masks 恒悬空(face_only 脸框贴回=正典现状);True 时 SAM3 遮罩贴回(5104→5024.masks)+ VOSR2 高频尾档(5110,control=**fixed** seed 锁 300831622214023 禁 randomize 回抖)→ 5024/5025 高清复制对 → 5113 出口
- **四态矩阵**:1065=False(出厂)→ p3 直通不修脸;1065=True ∧ 5111=False → **远景修脸=默认修脸档**;1065=True ∧ 5111=True → 高清修脸;**1065=False ∧ 5111=True = 非法态**(高清段被计算却在 5100 被丢弃=静默剪枝)——发车器/API 注入前必须拒绝此组合
- **API 直调(延伸)**:远景档 `g["1065"]...=true`;高清档再加 `g["5111"]["inputs"]["value"]=true`(+#25 身份句)
- **极性口径延伸(防 wf2api 反转坑)**:5100 on_true=修脸片/on_false=4002 p3 直通;**5113** on_true=5025 高清片/on_false=5023 远景片——两 Switch 均「真=新臂」,勿手改
- **显存分账**:SAM3 只吃 5011 的 768 crops,VOSR2 只吃 5021 解码 768 画布,5024/5025 与 5022/5023 同量级——新增段无 4K 全帧重采样(4K 内联楔死前科均在 4K 全帧链)
- **V2.1 砍除记(1119 探针定案)**:潜空间遮罩路(MVEx 清洗/入潜+SetLatentNoiseMask+中链 LATENT Switch)被 AudioLock 源码级冲掉(lock_audio 无条件覆写 noise_mask,恒无效)全砍——SAM3 遮罩只走贴回(5024.masks),5013→5014 直连复原正典原链
"""

# ---- 画布模板来源:正典件既有节点(公共件)/ 克隆件(五件 H3 定制件)/ 硬编码(HD 段 9 件)----
# HD 段结构硬编码自融合件 1119b(参数逐位;融合件已归档不再作模板源,作者件在
# apps/output 可清亦不依赖)——槽名/形状/位序与 object_info_17000.json 对账。
TPL_FROM_CANVAS = {5002: 42, 5006: 1012, 5012: 2001, 5016: 54, 5017: 2022, 5018: 2021,
                   5019: 2031, 5020: 2032, 5021: 2041, 5023: 2051, 4100: 4003,
                   5100: 1062, 1065: 1061, 25: 21,
                   5025: 2051, 5111: 1061, 5113: 1062}  # 1119:复制对/双开关克隆同源件(V2.1 砍 5112 克隆位)
TPL_FROM_CLONE = {5011: 5011, 5013: 5013, 5014: 5014, 5015: 5015, 5022: 5022, 5024: 5022}

# HD 段 9 件硬编码槽结构(widget 口带 widget 子名;shape=7 悬空可选口;无 link 字段)
HD_TPL: dict[int, dict] = {
    5101: {"type": "CheckpointLoaderSimple",
           "inputs": [{"widget": {"name": "ckpt_name"}, "name": "ckpt_name", "label": "ckpt_name",
                       "type": "COMBO", "localized_name": "ckpt_name"}],
           "outputs": [{"name": "MODEL", "label": "MODEL", "type": "MODEL", "localized_name": "MODEL"},
                       {"name": "CLIP", "label": "CLIP", "type": "CLIP", "localized_name": "CLIP"},
                       {"name": "VAE", "label": "VAE", "type": "VAE", "localized_name": "VAE"}]},
    5102: {"type": "CLIPTextEncode",
           "inputs": [{"name": "clip", "label": "clip", "type": "CLIP", "localized_name": "clip"},
                      {"widget": {"name": "text"}, "name": "text", "label": "text",
                       "type": "STRING", "localized_name": "text"}],
           "outputs": [{"name": "CONDITIONING", "label": "CONDITIONING", "type": "CONDITIONING",
                        "localized_name": "CONDITIONING"}]},
    5103: {"type": "SAM3_VideoTrack",
           "inputs": [{"name": "images", "label": "images", "type": "IMAGE", "localized_name": "images"},
                      {"name": "model", "label": "model", "type": "MODEL", "localized_name": "model"},
                      {"shape": 7, "name": "initial_mask", "label": "initial_mask", "type": "MASK",
                       "localized_name": "initial_mask"},
                      {"shape": 7, "name": "conditioning", "label": "conditioning",
                       "type": "CONDITIONING", "localized_name": "conditioning"},
                      {"widget": {"name": "detection_threshold"}, "name": "detection_threshold",
                       "label": "detection_threshold", "type": "FLOAT", "localized_name": "detection_threshold"},
                      {"widget": {"name": "max_objects"}, "name": "max_objects", "label": "max_objects",
                       "type": "INT", "localized_name": "max_objects"},
                      {"widget": {"name": "detect_interval"}, "name": "detect_interval",
                       "label": "detect_interval", "type": "INT", "localized_name": "detect_interval"}],
           "outputs": [{"name": "track_data", "label": "track_data", "type": "SAM3_TRACK_DATA",
                        "localized_name": "track_data"}]},
    5104: {"type": "SAM3_TrackToMask",
           "inputs": [{"name": "track_data", "label": "track_data", "type": "SAM3_TRACK_DATA",
                       "localized_name": "track_data"},
                      {"widget": {"name": "object_indices"}, "name": "object_indices",
                       "label": "object_indices", "type": "STRING", "localized_name": "object_indices"}],
           "outputs": [{"name": "masks", "label": "masks", "type": "MASK", "localized_name": "masks"}]},
    5109: {"type": "VOSR2ModelLoader",
           "inputs": [{"widget": {"name": "model"}, "name": "model", "label": "model",
                       "type": "COMBO", "localized_name": "model"},
                      {"widget": {"name": "dtype"}, "name": "dtype", "label": "dtype",
                       "type": "COMBO", "localized_name": "dtype"}],
           "outputs": [{"name": "model", "label": "model", "type": "VOSR2_MODEL", "localized_name": "model"}]},
    5110: {"type": "VOSR2Upscale",
           "inputs": [{"name": "model", "label": "model", "type": "VOSR2_MODEL", "localized_name": "model"},
                      {"name": "image", "label": "image", "type": "IMAGE", "localized_name": "image"},
                      {"widget": {"name": "upscale"}, "name": "upscale", "label": "upscale",
                       "type": "INT", "localized_name": "upscale"},
                      {"widget": {"name": "seed"}, "name": "seed", "label": "seed",
                       "type": "INT", "localized_name": "seed"},
                      {"widget": {"name": "color_alignment"}, "name": "color_alignment",
                       "label": "color_alignment", "type": "COMBO", "localized_name": "color_alignment"},
                      {"widget": {"name": "tile_size"}, "name": "tile_size", "label": "tile_size",
                       "type": "INT", "localized_name": "tile_size"},
                      {"widget": {"name": "tile_overlap"}, "name": "tile_overlap", "label": "tile_overlap",
                       "type": "INT", "localized_name": "tile_overlap"},
                      {"widget": {"name": "vae_tile_size"}, "name": "vae_tile_size",
                       "label": "vae_tile_size", "type": "INT", "localized_name": "vae_tile_size"},
                      {"widget": {"name": "vae_tile_overlap"}, "name": "vae_tile_overlap",
                       "label": "vae_tile_overlap", "type": "INT", "localized_name": "vae_tile_overlap"}],
           "outputs": [{"name": "IMAGE", "label": "IMAGE", "type": "IMAGE", "localized_name": "IMAGE"}]},
}
for _t in HD_TPL.values():
    _t["flags"] = {}
    _t["properties"] = {"Node name for S&R": _t["type"]}

TITLE = {
    25: "⑦ 修脸身份提示词(四采·默认通用句·调用方覆写)", 1065: "四采修脸:False 关(默认旁路)/ True 开",
    5002: "四采·拆帧拆音(←4002 内存态)", 5006: "四采·Pika turbo 8step LoRA(复用 1001)",
    5011: "四采·人脸追踪裁剪", 5012: "四采·H3 重画条件(画布=追踪器出口)",
    5013: "四采·注入真实帧", 5014: "四采·音轨锁", 5015: "四采·逐帧 denoise(60/200)",
    5016: "四采·噪声(同源 #54)", 5017: "四采·采样器(lcm)", 5018: "四采·调度 simple/8步/0.45",
    5019: "四采·引导器", 5020: "四采·采样", 5021: "四采·解码", 5022: "四采·贴回",
    5023: "四采·合成视频", 5100: "终档选择(1065:真=修脸片/假=p3 直通)", 4100: "终档保存 p-final",
    5101: "四采·SAM3 检查点(高清)", 5102: "四采·SAM3 文本提示(face)",
    5103: "四采·SAM3 视频追踪(高清)", 5104: "四采·SAM3 轨迹转遮罩(高清)",
    5109: "四采·VOSR2 加载器(高清)",
    5110: "四采·VOSR2 满血补频(高清·fixed)",
    5111: "高清修脸:False 远景(默认)/ True 高清",
    5113: "出口选择 VIDEO(5111:真=5025 高清/假=5023 远景)",
    5024: "四采·贴回(高清)", 5025: "四采·合成视频(高清)",
}
# 布局=拓扑分层列(x 严格右向,契约 test_no_negative_zone_and_no_leftward 刻碑:全链恒向右):
# 主带 y5900 不动(5002→5011→5012→5013→5006→5014→5015→[5016/5019/5017/5018 同列纵堆]→
# 5020→5021→5022→5023→5100→4100);1119 HD 段(V2.1 砍后)=主带下方行带+开关位+出口行
# (存量节点零挪动):
#   y7300 行A(SAM3 链):5101→5102→5103→5104(列步进让 5103>5011 融合件左向后勘);
#   y7600 开关位:5111(左于 5113 扇出);
#   右翼 y7300 行A':5109→5110(>5021.x=12040,第二处左向后勘)→y7600 行B':5024(吃 5110)
#   →5025;y7960 出口行:5113(>5023.x 且 <5100.x,组框 A 右缘让开终档组 120px)。
#   (V2.1 砍 5105-5107/5112:行A 右段与中链位腾空,不再摆件。)
# 组框罩全自算;全图节点 AABB 零重叠。
POS = {
    5002: [7200, 5900], 5011: [7670, 5900], 5012: [8230, 5900], 5013: [8830, 5900],
    5006: [9360, 5900], 5014: [9960, 5900], 5015: [10490, 5900],
    5016: [11020, 6400], 5019: [11020, 6628], 5017: [11020, 6820], 5018: [11020, 7018],
    5020: [11590, 5900], 5021: [12040, 5900], 5022: [12490, 5900], 5023: [13020, 5900],
    5100: [13490, 5900], 4100: [13960, 5900], 25: [7800, 6902], 1065: [12960, 6270],
    # ---- 1119 HD 段(见上布局注)----
    5101: [7200, 7300], 5102: [7660, 7300], 5103: [8120, 7300], 5104: [8580, 7300],
    5111: [9500, 7600],
    5109: [12060, 7300], 5110: [12420, 7300],
    5024: [12520, 7600], 5025: [12900, 7600], 5113: [13040, 7960],
}
SIZE = {
    5002: [270, 100], 5011: [360, 600], 5006: [400, 148], 5012: [400, 622],
    5013: [330, 105], 5014: [330, 120], 5015: [330, 240],
    5016: [360, 148], 5017: [370, 118], 5018: [315, 178], 5019: [360, 112], 5020: [250, 184],
    5021: [250, 112], 5022: [330, 270], 5023: [270, 232],
    25: [430, 200], 1065: [300, 120], 5100: [270, 166], 4100: [283, 564],
    5101: [400, 100], 5102: [400, 170], 5103: [400, 266], 5104: [320, 80],
    5109: [320, 82], 5110: [360, 250],
    5111: [300, 120], 5113: [270, 166],
    5024: [330, 270], 5025: [270, 232],
}
WIDGETS: dict[int, list | None] = {
    25: [IDENTITY], 1065: [False],
    5002: None, 5006: ["pika_turbo_8step_fl2va.safetensors", 1],
    5011: ["face_yolov8m.pt", 0.15, 2.5, 768, 768, "auto_capped_768", 21, 51, "gaussian",
           "per_frame", True, 0.0, "closest_to_xy", "segm\\person_yolov8m-seg.pt", 0.5, 0,
           "clip_vision", "none", 3.0, "off", 1920, 900, 170],
    5012: ["", 768, 768, 124, "max"],
    5013: None, 5014: None,
    5015: [1.0, 0.35, "absolute_px", 60.0, 200.0, 1, 9],
    5016: [42, "fixed"], 5017: ["lcm"], 5018: ["simple", 8, 0.45],
    5019: None, 5020: None, 5021: None,
    5022: ["face_only", 16, 24, 1, 1, "fade_out", False],
    5023: [24, 8, "sRGB", "none"],
    5100: [False], 4100: [PREFIX_P_FINAL, "auto", "auto", "auto"],
    # ---- 1119 HD 段(逐位承融合件 1119b;5110 control=fixed 禁 randomize;V2.1 砍 5105-5107)----
    5101: ["sam3.1_multiplex_fp16.safetensors"],
    5102: ["face"],
    5103: [0.5, 1, 1],
    5104: ["0"],
    5109: ["VOSR2", "default"],
    5110: [1, 300831622214023, "fixed", "wavelet", 512, 32, 1024, 32],
    5111: [False], 5113: [False],
    5024: ["face_only", 16, 24, 1, 1, "fade_out", False],  # 逐位同 5022(出口复制案)
    5025: [24, 8, "sRGB", "none"],                          # 逐位同 5023
}


def midchain_latent_switch_wiring():
    """V2.1(1119 探针定案,PRD 零·五)已砍空——保留函数名作历史锚。

    V2 曾在此布 5112 中链 LATENT Switch(5013.av_latent↔5014 间,PRD V2 五·1 双态
    探针 P2 的直接对象)。探针六发取证定案:中链 Switch 本身无引擎墙(LATENT 真臂
    放行,p1z 真帧差 43.58dB),但其 on_true 臂的 SLNM 潜空间遮罩路被 AudioLock
    **源码级**冲掉(ComfyUI-H3-NativeAudioLock/__init__.py:50-54 lock_audio 无条件
    覆写 locked["noise_mask"],上游 SetLatentNoiseMask 带入的 mask 在 5014 恒被冲掉,
    恒无效)——故 5105/5106/5107(MVEx+SLNM)与 5112 一并砍除,5013.av_latent→5014
    直连复原 1118 正典原链(5014 输入零改写),SAM3 遮罩只走贴回(5104→5024.masks)。"""
    return []


# ---- 连线(src_id, src出口槽名, dst_id, dst输入槽名)----
WIRING = [
    (4002, "VIDEO", 5002, "video"),  # 1119 回正:四采吃 p3 4K(用户裁定「三采 4K 后修脸」;施工员误植 multiseg TAIL=3053 范式=开修脸丢三采超分,融合役红旗)
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
    (5013, "av_latent", 5014, "av_latent"),  # 正典原链直连(V2.1 复原:5112 砍除,5014 输入不被改写)
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
    (5021, "IMAGE", 5022, "refined_crops"),  # 远景臂 871 线原样(零语义改写)
    (5022, "images", 5023, "images"),
    (1065, "BOOLEAN", 5100, "switch"),
    (5100, "COMFY_MATCHTYPE_V3", 4100, "video"),
    # ---- 1119 高清段(SAM3 遮罩贴回 + VOSR2 尾档;参数逐位承融合件 1119b;V2.1 砍 SLNM 路)----
    (5101, "MODEL", 5103, "model"),
    (5101, "CLIP", 5102, "clip"),
    (5102, "CONDITIONING", 5103, "conditioning"),
    (5011, "crops", 5103, "images"),
    (5103, "track_data", 5104, "track_data"),
    (5104, "masks", 5024, "masks"),        # SAM3 遮罩单出口=只进高清复制对贴回(远景臂 5022 恒悬空)
    (5109, "model", 5110, "model"),
    (5021, "IMAGE", 5110, "image"),
    (5110, "IMAGE", 5024, "refined_crops"),
    (5002, "images", 5024, "base_images"),
    (5011, "transform", 5024, "transform"),
    (5024, "images", 5025, "images"),
    (5002, "audio", 5025, "audio"),
    (5025, "VIDEO", 5113, "on_true"),
    # ---- 1119 投切(出口复制案)----
    *midchain_latent_switch_wiring(),      # V2.1 砍空(5112 连 SLNM 路一并除,见函数 docstring)
    (5023, "VIDEO", 5113, "on_false"),     # 原 5023→5100.on_true 等效改接(远景态直通臂)
    (5111, "BOOLEAN", 5113, "switch"),
    (5113, "COMFY_MATCHTYPE_V3", 5100, "on_true"),
]

# ---- API 模板同构节点(平铺 prompt dict;命名输入实证=object_info_17000+P1/P2 探针实跑图)----
API_NEW: dict[str, dict] = {
    "25": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": IDENTITY}},
    "1065": {"class_type": "PrimitiveBoolean", "inputs": {"value": False}},
    "5111": {"class_type": "PrimitiveBoolean", "inputs": {"value": False}},  # 高清修脸子开关(默认远景)
    "5002": {"class_type": "GetVideoComponents", "inputs": {"video": ["4002", 0]}},
    "5006": {"class_type": "LoraLoaderModelOnly", "inputs": {
        "model": ["1001", 0], "lora_name": "pika_turbo_8step_fl2va.safetensors", "strength_model": 1}},
    "5011": {"class_type": "H3FaceTrackCrop", "inputs": {
        "images": ["5002", 0], "detector": "face_yolov8m.pt", "confidence": 0.15, "crop_factor": 2.5,
        "canvas_width": 768, "canvas_height": 768, "canvas_mode": "auto_capped_768",
        "smooth_window": 21, "size_smooth_window": 51, "smooth_method": "gaussian",
        "size_mode": "per_frame", "identity_track": True, "identity_threshold": 0.28,
        "select": "closest_to_xy", "X": 1920, "Y": 900, "frame_index": 170,
            "identity_model": "clip_vision", "identity_threshold": 0.0,
            "identity_clip_vision": [800, 0], "fallback_detector": "segm\\person_yolov8m-seg.pt",
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
        "switch": ["1065", 0], "on_false": ["4002", 0], "on_true": ["5113", 0]}},
    "4100": {"class_type": "SaveVideo", "inputs": {
        "video": ["5100", 0], "filename_prefix": PREFIX_P_FINAL, "format": "auto", "codec": "auto"}},
    # ---- 1119 HD 段 +10(SAM3/Switch 形态=探针 graph_p2-t.json 实拉同构;V2.1 砍 MVEx/SLNM/5112)----
    "5101": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sam3.1_multiplex_fp16.safetensors"}},
    "5102": {"class_type": "CLIPTextEncode", "inputs": {"text": "face", "clip": ["5101", 1]}},
    "5103": {"class_type": "SAM3_VideoTrack", "inputs": {
        "images": ["5011", 0], "model": ["5101", 0], "conditioning": ["5102", 0],
        "detection_threshold": 0.5, "max_objects": 1, "detect_interval": 1}},
    "5104": {"class_type": "SAM3_TrackToMask", "inputs": {
        "track_data": ["5103", 0], "object_indices": "0"}},
    "5109": {"class_type": "VOSR2ModelLoader", "inputs": {"model": "VOSR2", "dtype": "default"}},
    "5110": {"class_type": "VOSR2Upscale", "inputs": {
        "model": ["5109", 0], "image": ["5021", 0], "upscale": 1, "seed": 300831622214023,
        "color_alignment": "wavelet", "tile_size": 512, "tile_overlap": 32,
        "vae_tile_size": 1024, "vae_tile_overlap": 32}},  # seed 控制位 fixed=画布侧件,API 无此键(object_info 实证)
    "5113": {"class_type": "ComfySwitchNode", "inputs": {
        "switch": ["5111", 0], "on_false": ["5023", 0], "on_true": ["5025", 0]}},
    "5024": {"class_type": "H3FaceStitch", "inputs": {
        "base_images": ["5002", 0], "refined_crops": ["5110", 0], "transform": ["5011", 1],
        "masks": ["5104", 0], "paste_region": "face_only", "mask_dilation": 16, "feather": 24,
        "colour_match": 1.0, "blend": 1.0, "undetected_frames": "fade_out"}},
    "5025": {"class_type": "CreateVideo", "inputs": {
        "images": ["5024", 0], "audio": ["5002", 1], "fps": 24, "bit_depth": "auto",
        "color_space": "sRGB", "chroma_subsampling": "auto", "codec": "none"}},
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
    """剥离本组既往添加(幂等母本=正典件自身;含 1118 旧组标题过渡剥离+V2.1 砍除件剥离)。"""
    own_ids = set(OWN) | set(RETIRED)  # RETIRED=V2.1 砍除件:盘上 101 版(V2 全量)重放须一并剥净
    expect = {**OWN, **RETIRED}
    for n in list(S["nodes"]):
        if n["id"] in own_ids:
            if n["type"] != expect[n["id"]]:
                die(f"正典件 #{n['id']} 已被他人占用为 {n['type']}(预期 {expect[n['id']}),拒剥")
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
                   if g.get("title") not in (GROUP_A_TITLE, GROUP_A_TITLE_1118, GROUP_B_TITLE)]
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
    for new_id in HD_TPL:  # 1119 HD 段:硬编码结构(融合件已归档不作模板源)
        tpl[new_id] = copy.deepcopy(HD_TPL[new_id])

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
    S["last_node_id"] = max(S["last_node_id"], 4002, 5100, 4100, 1065, 5113)

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
    for k, ct in {**OWN, **RETIRED}.items():  # RETIRED 同剥(盘上 99 版 V2 残键)
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
    print(f"[CHECK] 画布节点 {n_canvas} / API 节点 {n_api}")
    print("  NOTE  口径:1118 内置 19 臂(66+19+lowvram#1072+clip_vision#800=87)→"
          " 1119 双档 +10(V2.1 砍后:6 融合段+5111/5113+5024/5025 复制对)=97;"
          "API 同构 85→95(画布 97-2 loader 差)")
    ok(n_canvas == 97, f"画布节点数=97(87+10 双档,V2.1),实际 {n_canvas}")
    ok(n_api == 95, f"API 节点数=95(85+10,V2.1),实际 {n_api}")

    ids = [n["id"] for n in S["nodes"]]
    ok(len(ids) == len(set(ids)), "画布节点 id 唯一")
    idset = set(ids)
    ok(all(l[1] in idset and l[3] in idset for l in S["links"]), "画布无悬空链")
    ok(all(str(i) in A for i in OWN), "29 新节点(19 臂+10 双档)API/画布两件齐备")

    nmap = {n["id"]: n for n in S["nodes"]}
    lk = {l[0]: l for l in S["links"]}

    def src_of(nid, in_name):
        s = next(s for s in nmap[nid]["inputs"] if s["name"] == in_name)
        return lk.get(s.get("link"))

    b65 = nmap[1065]
    ok(b65.get("widgets_values") == [False], "画布 #1065 开关默认 False(出厂旁路不因本役改变)")
    ok(A["1065"]["inputs"]["value"] is False, "API #1065 开关默认 False")
    b111 = nmap[5111]
    ok(b111["type"] == "PrimitiveBoolean" and b111.get("widgets_values") == [False],
       "画布 #5111 高清子开关默认 False(远景=默认档)")
    ok(A["5111"]["inputs"]["value"] is False, "API #5111 默认 False(可注入)")
    ok(sum(1 for n in S["nodes"] if n["type"] == "UNETLoader") == 1, "画布无第二个 UNETLoader(仅 1001)")
    ok(sum(1 for v in A.values() if v["class_type"] == "UNETLoader") == 1, "API 无第二个 UNETLoader(仅 1001)")

    n5012 = nmap[5012]
    n5011 = nmap[5011]
    wl, hl = src_of(5012, "width"), src_of(5012, "height")
    ok(wl and wl[1] == 5011 and n5011["outputs"][wl[2]]["name"] == "canvas_w",
       "画布 5012.width=5011.canvas_w 出口联线")
    ok(hl and hl[1] == 5011 and n5011["outputs"][hl[2]]["name"] == "canvas_h",
       "画布 5012.height=5011.canvas_h 出口联线")
    ok(A["5012"]["inputs"]["width"] == ["5011", 4] and A["5012"]["inputs"]["height"] == ["5011", 5],
       "API 5012 宽高=5011 出口(canvas_w=4/canvas_h=5)")

    # ---- 1119 双档结构契约 ----
    def wired(nid, in_name, want_src):
        l = src_of(nid, in_name)
        return bool(l) and l[1] == want_src

    # V2.1 砍除面(SLNM 路被 AudioLock 源码级冲掉恒无效,连中链 5112 一并砍)
    ok(all(i not in idset for i in RETIRED), "V2.1 砍除件不在画布(5105/5106/5107/5112)")
    ok(all(str(i) not in A for i in RETIRED), "V2.1 砍除键不在 API 模板(5105/5106/5107/5112)")
    ok(not any(n["type"].startswith("MVEx") or n["type"] == "SetLatentNoiseMask" for n in S["nodes"]),
       "MVEx/SLNM 类面退出画布(GPL-3.0 插件随役退出依赖面)")
    ok(not any(v.get("class_type", "").startswith("MVEx") or v.get("class_type") == "SetLatentNoiseMask"
               for v in A.values()), "MVEx/SLNM 类面退出 API")
    ok(src_of(5014, "av_latent")[1] == 5013,
       "5014.av_latent←5013 直连(正典原链复原,V2.1 起 5014 输入零改写)")
    ok(A["5014"]["inputs"]["av_latent"] == ["5013", 0], "API 5014.av_latent←5013 直连同构")
    # 5113 出口
    ok(wired(5113, "switch", 5111) and wired(5113, "on_false", 5023) and wired(5113, "on_true", 5025),
       "5113 出口极性:switch←5111/on_false←5023 远景/on_true←5025 高清")
    ok(wired(5100, "on_true", 5113) and wired(5100, "on_false", 4002) and wired(5100, "switch", 1065),
       "5100 极性不变:on_true←5113 出口(原 5023 线等效改接)/on_false←4002/switch←1065")
    ok(A["5113"]["inputs"] == {"switch": ["5111", 0], "on_false": ["5023", 0], "on_true": ["5025", 0]}
       and A["5100"]["inputs"]["on_true"] == ["5113", 0],
       "API 5113/5100 投切同构")
    # 远景臂零语义改写(AC4)
    ok(wired(5022, "refined_crops", 5021), "远景臂 871 线原样:5022.refined_crops←5021(零语义改写)")
    m22 = next(s for s in nmap[5022]["inputs"] if s["name"] == "masks")
    ok(m22.get("link") is None and m22.get("shape") == 7,
       "5022.masks 恒悬空 shape7(face_only 脸框贴回=正典现状保真)")
    ok(nmap[5024]["widgets_values"] == nmap[5022]["widgets_values"],
       "5024 widgets 逐位同 5022(高清复制对)")
    ok(nmap[5025]["widgets_values"] == nmap[5023]["widgets_values"],
       "5025 widgets 逐位同 5023")
    ok(wired(5024, "masks", 5104) and wired(5024, "refined_crops", 5110)
       and wired(5024, "base_images", 5002) and wired(5024, "transform", 5011),
       "5024 四进口:masks←5104(SAM3 贴回约束)/refined_crops←5110(VOSR2)/base←5002/transform←5011")
    ok(wired(5025, "images", 5024) and wired(5025, "audio", 5002), "5025:images←5024/audio←5002②")
    ok(A["5024"]["inputs"]["masks"] == ["5104", 0] and A["5024"]["inputs"]["refined_crops"] == ["5110", 0],
       "API 5024 masks/refined_crops 同构")
    # HD 段链
    ok(wired(5103, "images", 5011) and wired(5103, "model", 5101) and wired(5103, "conditioning", 5102),
       "5103 SAM3:images←5011.crops/model←5101/conditioning←5102")
    ok(wired(5104, "track_data", 5103), "5104 track_data←5103")
    m04 = next(s for s in nmap[5104]["outputs"] if s["name"] == "masks")
    ok({lk[l][3] for l in (m04.get("links") or [])} == {5024},
       "5104.masks 单出口=只进 5024(SLNM 路砍除,SAM3 遮罩只走贴回)")
    ok(wired(5110, "model", 5109) and wired(5110, "image", 5021), "VOSR2 尾档:5109→5110(image←5021)")
    ok(nmap[5110]["widgets_values"][2] == "fixed", "5110 control=fixed(seed 锁 300831622214023 禁 randomize)")
    ok(nmap[5103]["widgets_values"] == [0.5, 1, 1]
       and nmap[5109]["widgets_values"] == ["VOSR2", "default"],
       "HD 段 widgets 逐位承融合件 1119b(5103/5109)")

    # ---- 布局契约(零左向/零 AABB 重叠/组框)----
    left_bad = [(l[0], l[1], l[3]) for l in S["links"]
                if nmap[l[3]]["pos"][0] <= nmap[l[1]]["pos"][0]]
    ok(not left_bad, f"全链恒向右(零左向线),违例 {left_bad[:5]}")
    ok(nmap[5103]["pos"][0] > nmap[5011]["pos"][0]
       and nmap[5110]["pos"][0] > nmap[5021]["pos"][0],
       "两处融合件左向后勘:5103>5011/5110>5021(V2.1 砍 5107,其位腾空)")
    ok(all(n["pos"][0] >= 80 and n["pos"][1] >= 80 for n in S["nodes"]), "零负区(pos≥80)")
    boxes = [(n["id"], n["pos"][0], n["pos"][1], n["pos"][0] + n["size"][0], n["pos"][1] + n["size"][1])
             for n in S["nodes"]]
    overlaps = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i], boxes[j]
            if a[1] < b[3] and b[1] < a[3] and a[2] < b[4] and b[2] < a[4]:
                overlaps.append((a[0], b[0]))
    ok(not overlaps, f"全图节点 AABB 零重叠,违例 {overlaps[:6]}")

    gs = [g for g in S["groups"] if g["title"] in (GROUP_A_TITLE, GROUP_B_TITLE)]
    ok(len(gs) == 2 and len(S["groups"]) == 7,
       "组框恒 7 组(扩四采组框罩全 14 新件,不新增第 8 组)")
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
    ok(cover, "组框罩全(29 新节点全部落框)")
    gover = []
    for i in range(len(S["groups"])):
        for j in range(i + 1, len(S["groups"])):
            a, b = S["groups"][i]["bounding"], S["groups"][j]["bounding"]
            if a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]:
                gover.append((S["groups"][i]["title"], S["groups"][j]["title"]))
    ok(not gover, f"组框两两不交(A 右缘让开终档组),违例 {gover}")

    par = all(str(i) in A and A[str(i)]["class_type"] == OWN[i] for i in OWN)
    ok(par, "API/画布 33 节点 class_type 同构")

    ok(wired(5002, "video", 4002) and wired(4100, "video", 5100) and wired(5006, "model", 1001)
       and wired(5014, "audio", 5002) and wired(5019, "conditioning", 5012)
       and wired(5020, "noise", 5016), "关键联线拓扑(5002←4002/4100←5100/5006←1001/5014.audio←5002②/5019←5012/5020←5016)")
    ok(A["5002"]["inputs"]["video"] == ["4002", 0] and A["4100"]["inputs"]["video"] == ["5100", 0]
       and A["5006"]["inputs"]["model"] == ["1001", 0], "API 关键拓扑同构")

    t25 = nmap[25]
    ok(bool(t25["widgets_values"][0].strip()) and A["25"]["inputs"]["value"] == t25["widgets_values"][0],
       "#25 默认通用句两件一致且非空")
    md = nmap[9999]["widgets_values"][0]
    ok(README_MARK in md, "README 9999 已增「四采修脸」段")
    ok("### 1119 双档调用(远景=默认 / 高清)" in md and "非法态" in md,
       "README 9999 已增 1119 双档调用段(四态矩阵+非法态口径)")
    ok("5112" not in md and "V2.1 砍除记" in md,
       "README 9999 无 5112 残留字样+载 V2.1 砍除记(SLNM 路 AudioLock 冲掉)")
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
    clone_nodes = json.loads(CLONE.read_text(encoding="utf-8"))["nodes"]
    S = strip_canvas(json.loads(CANVAS.read_text(encoding="utf-8")))
    S = build_canvas(S, clone_nodes)
    write_json(CANVAS, S)
    A = build_api(json.loads(API.read_text(encoding="utf-8")))
    write_json(API, A)
    print(f"[OK] 画布 {CANVAS.name}:{len(S['nodes'])} 节点(87+10 双档·V2.1)/ {len(S['links'])} 链 / {len(S['groups'])} 组")
    print(f"[OK] API {API.name}:{len(A)} 节点(85+10·V2.1)")

    # 幂等双跑字节一致(AC6):盘上产物再剥再建应逐字节复现
    S2 = build_canvas(strip_canvas(json.loads(CANVAS.read_text(encoding="utf-8"))), clone_nodes)
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
