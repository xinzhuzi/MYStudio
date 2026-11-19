#!/usr/bin/env python3
"""qi21 道劫两画布 · Gem 分块超分(② 链)移植手术 · 1117。

手术内容(方案已两轮复核):
  1. qi21-道劫-t2i.json / qi21-道劫-i2i.json 两画布各植入 13 节点(id 8108-8120,
     mode=0,槽名/widgets 逐位照 Gem 源件 qwen21_Gem_Face_zoom_V1.json 的 ② 链
     donor——守卫三件平铺自源件「防大图检查」子图 88c48041,主链取 viggle→ItsGem
     face 分支:445/545/555/438/439/431/441_413/556/557/558);
     1118 B 案(用户令):8113 换挂主链同款 qi21-mikkoani@0.6——ItsGem 人脸 LoRA
     是照片域先验,实弹验证会把道劫动漫脸重绘成半写实(视线翻转),动漫先验须进
     超分段;受制裁偏离见 DEVIATIONS(该件豁免 Gem donor 对拍,只钉蓝图);
     1119 T8保真A弹(11-19-qi21-t8-superres-fidelity P1/C2 宣判:四格令覆盖 T8
     零动令)三刀:8113 三代换药 restore@1.0(引擎件=HF1500 版,R1 字节级验明)+
     8109 守卫 面积~2MP 锚(R2/R7①格)+8120 blend_band 64(R4 官方窄带独占抗双影,
     overlap 维持 256);8117 提示词本轮不动(变体对照候令);
  2. 新增 20 根顶层 link(8217-8236),摘 SeedVR 宿主 503→SaveImage 504 的旧线
     (t2i link205 / i2i link204),504.images 改接 8120(GemTiledUpscaleStitch);
  3. SeedVR 整链置 mode=4(零删可复活):顶层 503 + 两画布 definitions.subgraphs
     内 f0a844a8 定义 501/502/7401/7402;
  4. 新组框 id=7「道劫·⑤b·Gem分块超分」罩全 13 节点(1118 换装令去「·2K」尾;
     旧名=GROUP_TITLE_OLD,幂等改名支路兼容旧名画布);last_node_id→8120、
     last_link_id→8236;
  5. 蓝图 my_nodes/subgraphs/qi21-道劫-超分-SeedVR2.json 同步 mode 0→4
     (根镜像宿主 id=1 + sg 内四节点;_canon_up4 含 mode,双侧同改恒等);
  6. 快照 tests/fixtures/qi21_object_info_snapshot.json 只增并入四类
     object_info(GemTiledUpscale/GemTiledUpscaleStitch/ComfyMathExpression/
     ImageScaleBy;GetImageSize 已在)——缺类会让 flatten info[cls] KeyError。

widgets_values 键纪律(方案风险 F7):8108/8119 整键省略 widgets_values
(写 null 即 flatten `node.get('widgets_values', [])` 对 None 迭代 TypeError);
全部 13 节点不写 widgets_values_named(源件 545 named=r128 假名、447/499/555/567
named 带 qwen21\\ 前缀假名,flatten named 静默覆盖裸名 widget 致引擎 404)。

孪生件(qwen21-道劫-*-api.json)不在本脚本手术面——由
qwen21_bridge_template_build.py --target <t2i|i2i> 重生成;生成器/契约测试/
App 测试的配套改动见方案 steps 10/12/13(代码文件,不在本 JSON 手术脚本内)。

用法:
  python3 apps/build/scripts/qi21_daojie_gem_tiled_graft_1117.py               # 执行手术+自验
  python3 apps/build/scripts/qi21_daojie_gem_tiled_graft_1117.py --verify-only # 只验不改(含孪生件核验)
  python3 apps/build/scripts/qi21_daojie_gem_tiled_graft_1117.py --reverse     # 逆手术:复活 SeedVR 链、摘 Gem 链(幂等)

自验断言(真验,非自说自话):
  A. 13 新节点 widgets 逐位 == Gem 源件 donor 现值(执行/验证时现读源文件对拍)== 方案表;
  B. SeedVR 节点仍在(503+f0a844a8 内四节点,type 不变)且 mode==4;
  C. 存图改线生效(504.images.link==8236;旧线 205/204 整根缺席;503 出扇出已摘);
  D. 全图 links 可解析(顶层+各子图:端点存在/槽位在界/类型相容/双向登记互逆);
  E. 组框 7 罩全 13 节点且仅罩这 13 个;
  F. 既有节点零扰动(vs 手术前态/git HEAD 深比对:除 SeedVR mode 五位、503 出扇出、
     504.images.link、7500 出扇出外逐字节深度全等;pos/size/order 一律不动);
  G. 画布几何:节点矩形两两不交(含新节点);⑤b 与既有组框不相交;
  H. 蓝图 ↔ 两画布内嵌定义 canonical(_canon_up4 同规)恒等;
  I. 快照只增不改(66→70 类,既有 66 类逐字节不动);
  J. (--verify-only)孪生件:503 键整体缺席、8108-8120 平铺在场、504.images==["8120",0]、
     i2i 另含 11/12/17/18 层+references 3 条、name 不变。

回滚:git checkout -- 两画布/蓝图/快照 + 重生成孪生件即全回术前态(方案 risks 口径);
--reverse 为功能性逆手术(计数器保持单调不回卷,槽序/列表序不保证与 HEAD 逐字节同序)。
"""
from __future__ import annotations

import argparse
import copy
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
T2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json"
I2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json"
GEM = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qwen21_Gem_Face_zoom_V1.json"
BP = REPO / "apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-超分-SeedVR2.json"
SNAP = REPO / "apps/backend/comfyui/tests/fixtures/qi21_object_info_snapshot.json"
TWIN_T2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qwen21-道劫-t2i-api.json"
TWIN_I2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qwen21-道劫-i2i-api.json"

SEEDVR_SG = "f0a844a8-9bf5-4c71-8af5-f1c9f17c0324"
SEEDVR_SG_IDS = (501, 502, 7401, 7402)
SEEDVR_SG_TYPES = {501: "SeedVR2LoadDiTModel", 502: "SeedVR2LoadVAEModel",
                   7401: "SeedVR2VideoUpscaler", 7402: "PrimitiveInt"}
GEM_GUARD_SG = "88c48041-0d9e-4877-8ca2-5c4238f87325"

# ── 13 新节点表(id → donor 定位/尺寸/标题/widgets 期望)──────────────────────
# donor: ("sub", id)=Gem 源件守卫子图 88c48041 内;("top", id)=Gem 源件顶层。
# widgets 期望=方案表;执行/验证时与 Gem 源件 donor 现值对拍(双源一致才放行)。
DONOR = {
    8108: ("sub", "460_600"), 8109: ("sub", "460_601"), 8110: ("sub", 425),
    8111: ("top", 445), 8112: ("top", 545), 8113: ("top", 555),
    8114: ("top", 438), 8115: ("top", 439), 8116: ("top", 431),
    8117: ("top", "441_413"), 8118: ("top", 556), 8119: ("top", 557),
    8120: ("top", 558),
}
NEW_IDS = tuple(DONOR)
SIZES = {
    8108: [140, 124], 8109: [400, 200], 8110: [238, 82],
    8111: [354, 82], 8112: [354, 82], 8113: [354, 82],
    8114: [270, 106], 8115: [270, 58], 8116: [289, 278],
    8117: [428, 371], 8118: [270, 262], 8119: [281, 60], 8120: [289, 150],
}
TITLES = {
    8108: "[8108] Gem②·守卫·取尺寸", 8109: "[8109] Gem②·守卫·缩放系数",
    8110: "[8110] Gem②·守卫·预缩放", 8111: "[8111] Gem②·独立UNET int8",
    8112: "[8112] Gem②·viggle turbo r256 ×1", 8113: "[8113] Gem②·restore ×1.0(1119A)",
    8114: "[8114] Gem②·独立CLIP int8", 8115: "[8115] Gem②·独立VAE bf16",
    8116: "[8116] Gem②·分块超分 8.25MP(4K帽)", 8117: "[8117] Gem②·修复提示词编码",
    8118: "[8118] Gem②·KSampler 6步", 8119: "[8119] Gem②·解码",
    8120: "[8120] Gem②·拼缝",
}
# None = 整键省略 widgets_values(donor 同形;写 null 即 flatten TypeError)
WIDGETS = {
    8108: None,
    # 1119 T8保真A弹(1119 四格令,P1/C2 宣判覆盖 T8 零动令):8109 边长1024锚→
    # 面积~2MP 锚(R2 正路先放大到 ~2MP 再进链/R7 ①格);8113 三代换药
    # mikkoani@0.6→restore@1.0(引擎件=HF1500 版,R1 SHA256 65de4f6c… 字节级验明)。
    # 8110 scale_by 现值 1.0 自洽:slot2 恒接 8221(表达式输出),min(1,…) 值域
    # (0,1] ⊆ [0.01,8.0] 上限内(16:9 典型 0.59MP→√3.39≈1.84 亦在内),widget 仅回退值。
    8109: ["min(1, sqrt(2000000 / (a * b)))"],
    8110: ["lanczos", 1],
    8111: ["qwen_image_2.1_int8_convrot.safetensors", "default"],
    8112: ["qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors", 1],  # 1118 换装(原 viggle r256)
    8113: ["qwen-image-2.1-restore.safetensors", 1.0],  # 1119 A弹三代换药(原 mikkoani@0.6←ItsGem face ×1)
    8114: ["qwen3vl_8b_int8_convrot.safetensors", "qwen_image", "default"],
    8115: ["qwen_image_2.1_vae_bf16.safetensors"],
    8116: [8.25, 2, 256, 32, 64, True],  # 1118末 4K帽令 10→8.25(全型长边≤3840 唯一 0.05 档内值)
    8117: ["Upscale this illustration to ultra-high definition: remove blur, "
           "noise and compression artifacts, recover crisp linework, clean "
           "flat color planes and fine detail across figures, garments, "
           "scenery, architecture and props, keeping the same composition, "
           "characters, identities and hand-drawn Chinese guofeng anime "
           "style unchanged.", "", 0],  # 1118 换装(原人脸修复域句)
    8118: [0, "fixed", 8, 1, "euler", "simple", 1],  # 1118 换装 steps 6→8(余六位不动)
    8119: None,
    # 1119 A弹 blend_band 0→64(R4 ItsGemTools 源码官方窄带独占抗双影开关,
    # 重影带 2×band=128px;8116 overlap 维持 256 不动=B弹候令域)
    8120: [1, "translation", 64, 64],
}
# 受制裁偏离表:键=新链节点 id,值=偏离缘由(谱系逐代在册)。偏离件 widgets 只钉
# 本表(WIDGETS),豁免「== Gem 源件 donor 现值」双源对拍(load_gem_donors/verify A)。
# 1119 谱系注记:T8 期「donor 只取 LoRA 本件其余零动」令作用域=1118 换装那一次的
# donor 采用面,非 ⑤b 参数永久冻结;1119 四格蓝图+换药令显式覆盖(PRD C2 宣判)。
DEVIATIONS = {
    8113: "三代谱系:ItsGem face ×1(donor 原值)→mikkoani@0.6(1118 B 案,治超分段"
          "动漫感流失)→restore@1.0(1119 A弹主刀,R2 起步档=1.0;引擎件=HF1500 版"
          " SHA256 65de4f6c… 字节级验明 R1);回滚=改表重跑本脚本(幂等)",
    8109: "1119 A弹:守卫表达式 边长1024锚→面积~2MP 锚 min(1,sqrt(2e6/(a*b)))(R2 正路"
          "/R7 ①格;1119 四格令覆盖 T8 零动令,C2 宣判);Gem 源件 460_601 现值禁动故豁免双源对拍",
    8120: "1119 A弹:blend_band 0→64(R4 ItsGemTools 源码官方窄带独占抗双影开关,重影带"
          "2×band=128px;overlap 维持 256 不动=B弹候令域);Gem 源件 558 现值禁动故豁免双源对拍",
    8112: "1118 换装令:换官方 turbo r178×1+steps 6→8+超分提示词换装;donor 只取"
          "LoRA 本件+步数(1118 用户澄清令),Gem 源件 545/441_413/556 未动故豁免双源对拍",
    8117: "1118 换装令:换官方 turbo r178×1+steps 6→8+超分提示词换装;donor 只取"
          "LoRA 本件+步数(1118 用户澄清令),Gem 源件 545/441_413/556 未动故豁免双源对拍",
    8118: "1118 换装令:换官方 turbo r178×1+steps 6→8+超分提示词换装;donor 只取"
          "LoRA 本件+步数(1118 用户澄清令),Gem 源件 545/441_413/556 未动故豁免双源对拍",
    8116: "1118末 4K帽令:megapixels 10→8.25,GemTiledUpscale 出图=逐边 ceil 无对齐,"
          "8.25=全型长边严格≤3840 唯一 0.05 档内值;donor 只取结构值域进蓝图"
          "(照 8112/8117/8118 换装先例;Gem 源件 431 恒 10 禁动)",
}
# 1118末 用户四令画布整理(⑤b 上移/⑤ 下移/504 最右/加速区缩短)+立宪重排:
# 主车道 x 严格递增 + 加载器双行落缝(CLIP/VAE 行 A+560、LoRA 级联 A+960)+ 8120 上跨;
# 504 挪画布最右(x14400)=8236 随之右流 → leftward 全零(旧「8236 结构豁免」作废);
# i2i 节点 20 自 y4480 提到加速区主体旁(y1400)=加速区组框 3956→~850;
# t2i 4018 上提 200px=加速区紧框。终态我方判项:overlap0/leftward0/
# occ 残2(8218 进场线+8233 VAE 跨车道)/sp 残1(加载器搁板);旧静默尾线
# (7500→503/505)新增 occlusion 各 2=muted 死线穿越 ④ 输出区,几何不可避
# (503 下移必过 ④ x 带),记档接受;crossings 净额 t2i+10/i2i+14(用户令
# 重排优先于棘轮;剥我方线归因口径不变)。
POS = {
    "t2i": {8108: [9300, 1700], 8109: [9870, 1700], 8110: [10590, 1700],
            8111: [10755, 2260], 8112: [11429, 2660], 8113: [12103, 2660],
            8114: [11349, 2260], 8115: [11709, 2260], 8116: [11160, 1700],
            8117: [11769, 1700], 8118: [12517, 1700], 8119: [13107, 1700],
            8120: [13708, 1100]},
    "i2i": {8108: [9400, 1500], 8109: [9970, 1500], 8110: [10690, 1500],
            8111: [10855, 2060], 8112: [11529, 2460], 8113: [12203, 2460],
            8114: [11449, 2060], 8115: [11809, 2060], 8116: [11260, 1500],
            8117: [11869, 1500], 8118: [12617, 1500], 8119: [13207, 1500],
            8120: [13808, 900]},
}
# 1118末 用户令:既有件动位(幂等回灌;F 零扰豁免同步)
MOVE_USER = {
    "t2i": {503: [7300, 3950], 505: [7750, 4550], 4018: [4064, 2400],
            504: [14400, 1100]},
    "i2i": {503: [8400, 3900], 504: [14400, 900], 20: [6600, 1250]},
}
# 既有组框修正(按题名锚定;⑤ 縮为 503[+505] 贴身框/加速区縮为主体贴身框)
GROUP_FIX = {
    "t2i": {"道劫·⑤超分尾档": [7260, 3890, 990, 1180],
            "道劫·加速区③": [4024, 1615, 1415, 1100]},
    "i2i": {"道劫·⑤超分尾档": [8360, 3840, 440, 518],
            "道劫·加速区③": [6560, 710, 840, 700]},
}
CANVASES = {"t2i": T2I, "i2i": I2I}

# ── 20 根新顶层 link(两件同段 8217-8236)───────────────────────────────────
LINKS = (
    (8217, 7500, 0, 8108, 0, "IMAGE"),
    (8218, 7500, 0, 8110, 0, "IMAGE"),
    (8219, 8108, 0, 8109, 0, "INT"),
    (8220, 8108, 1, 8109, 1, "INT"),
    (8221, 8109, 0, 8110, 2, "FLOAT"),
    (8222, 8110, 0, 8116, 0, "IMAGE"),
    (8223, 8111, 0, 8112, 0, "MODEL"),
    (8224, 8112, 0, 8113, 0, "MODEL"),
    (8225, 8113, 0, 8118, 0, "MODEL"),
    (8226, 8114, 0, 8117, 0, "CLIP"),
    (8227, 8115, 0, 8117, 4, "VAE"),
    (8228, 8116, 0, 8117, 1, "IMAGE"),
    (8229, 8117, 0, 8118, 1, "CONDITIONING"),
    (8230, 8117, 1, 8118, 2, "CONDITIONING"),
    (8231, 8117, 2, 8118, 3, "LATENT"),
    (8232, 8118, 0, 8119, 0, "LATENT"),
    (8233, 8115, 0, 8119, 1, "VAE"),
    (8234, 8119, 0, 8120, 0, "IMAGE"),
    (8235, 8116, 1, 8120, 1, "ITSGEM_TILE_STITCHER"),
    (8236, 8120, 0, 504, 0, "IMAGE"),
)
OLD_LINK = {"t2i": 205, "i2i": 204}  # [旧id,503,0,504,0,'IMAGE'] 摘除

GROUP_TITLE = "道劫·⑤b·Gem分块超分"          # 1118 换装令新名(去「·2K」尾)
GROUP_TITLE_OLD = "道劫·⑤b·Gem分块超分·2K"    # 旧名:幂等改名支路兼容(295/351/394)
GROUPS = {
    "t2i": {"id": 7, "title": GROUP_TITLE, "bounding": [9260, 1040, 4777, 1762], "color": "#b58b2a"},
    "i2i": {"id": 7, "title": GROUP_TITLE, "bounding": [9360, 840, 4777, 1762], "color": "#a88040"},
}
SVR2_GROUP_PREFIX = "道劫·⑤超分尾档"  # 尾档选择器 startswith 锚(新组题名不得误触)

# ── 四类 object_info 快照补条(1118 自引擎 192.168.0.101:17000 实拉冻结;
#    快照只增不改,引擎 combo 长表随拉随冻)──────────────────────────────────
OBJECT_INFO_EMBED_JSON = "{\"GemTiledUpscale\":{\"input\":{\"required\":{\"image\":[\"IMAGE\",{\"tooltip\":\"要放大并切成 tile 的图。\"}],\"megapixels\":[\"FLOAT\",{\"default\":4.0,\"min\":0.0,\"max\":64.0,\"step\":0.05,\"tooltip\":\"成图尺寸（百万像素）。0 = 保持原尺寸。\"}]},\"optional\":{\"upscale_model\":[\"UPSCALE_MODEL\",{\"tooltip\":\"可选：放大模型，先放大再切 tile；不接则普通 lanczos 放大。\"}],\"tile_megapixels\":[\"FLOAT\",{\"default\":2.0,\"min\":0.25,\"max\":16.0,\"step\":0.05,\"tooltip\":\"单 tile 最大重绘尺寸。Qwen Image 2.1 / Krea 2 用 2，SDXL 用 1。超过 2048x2048 上限时会被 enforce_qwen_tile_limit 自动调低。\"}],\"overlap\":[\"INT\",{\"default\":128,\"min\":0,\"max\":1024,\"step\":8,\"tooltip\":\"相邻 tile 共享的像素宽；拼缝在这条带上混合。\"}],\"multiple\":[\"INT\",{\"default\":32,\"min\":1,\"max\":256,\"step\":1,\"tooltip\":\"每个 tile 的宽高都是它的倍数。32 适配 Qwen Image 2.1。\"}],\"max_growth\":[\"FLOAT\",{\"default\":8.0,\"min\":1.0,\"max\":64.0,\"step\":0.5,\"tooltip\":\"小图重绘不超过自身 megapixels 的多少倍；超出部分普通放大。\"}],\"enforce_qwen_tile_limit\":[\"BOOLEAN\",{\"default\":true,\"tooltip\":\"防呆：单 tile 超过安全工作点（4.6MP，对齐 AusBoss 口径，官方硬上限 4.19MP）时，自动调低 tile_megapixels 并写入 report 提示；关闭则完全按填的参数切。\"}]}},\"input_order\":{\"required\":[\"image\",\"megapixels\"],\"optional\":[\"upscale_model\",\"tile_megapixels\",\"overlap\",\"multiple\",\"max_growth\",\"enforce_qwen_tile_limit\"]},\"is_input_list\":false,\"output\":[\"IMAGE\",\"ITSGEM_TILE_STITCHER\",\"IMAGE\",\"INT\",\"INT\",\"STRING\"],\"output_is_list\":[true,false,false,false,false,false],\"output_name\":[\"tiles\",\"stitcher\",\"before\",\"width\",\"height\",\"report\"],\"name\":\"GemTiledUpscale\",\"display_name\":\"Tiled Upscale (ItsGemTools)\",\"description\":\"按 megapixels 设定成图尺寸，把图切成模型能一次重绘的 tile（32 对齐）。把 tiles 送进采样器重绘，再接 GemTiledUpscaleStitch 拼回。Stitch 端自带亚像素几何配准，适配 QwenImage 2.1 + 自训 LoRA。\",\"python_module\":\"custom_nodes.ItsGemTools\",\"category\":\"ItsGemTools/image\",\"output_node\":false,\"has_intermediate_output\":false,\"output_tooltips\":[\"The tiles, one after another. Nodes after this run once per tile.\",\"GemTiledUpscaleStitch 拼回所需的 stitcher。\",\"普通放大到成图尺寸的原图：重绘前的对照图。\",\"成图宽（像素）。\",\"成图高（像素）。\",\"这次放大做了什么，一两句话。\"],\"search_aliases\":[]},\"GemTiledUpscaleStitch\":{\"input\":{\"required\":{\"tiles\":[\"IMAGE\",{\"tooltip\":\"重绘后的 tiles，按 GemTiledUpscale 给出的顺序。\"}],\"stitcher\":[\"ITSGEM_TILE_STITCHER\",{\"tooltip\":\"GemTiledUpscale 输出的 stitcher。\"}]},\"optional\":{\"keep_colors\":[\"FLOAT\",{\"default\":1.0,\"min\":0.0,\"max\":1.0,\"step\":0.05,\"tooltip\":\"1 保持原图颜色（每 tile 匹配源 tile 颜色）；0 关。\"}],\"align_mode\":[[\"translation\",\"off\"],{\"default\":\"translation\",\"tooltip\":\"translation：重绘 tile 与源 tile 亚像素平移配准后再混合（默认，适配自训 LoRA）；off：原版行为。\"}],\"max_align_shift\":[\"INT\",{\"default\":64,\"min\":1,\"max\":256,\"step\":1,\"tooltip\":\"配准位移超过该像素数判为不可靠并跳过，防止错误配准。zoom/重构图漂移大的工作流可调大。\"}],\"blend_band\":[\"INT\",{\"default\":0,\"min\":0,\"max\":256,\"step\":8,\"tooltip\":\"接缝混合模式。0 = 全带对称渐变（默认、推荐）：共享区两 tile 权重 0↔1 横跨整个 overlap、权重和恒=1，用相邻 tile 平均天然稀释单 tile 随机幻觉（幽灵下巴），配准先对齐几何故无重影，与 AusBoss 一致。>0 = 窄带独占（可选）：后写 tile 独占 overlap 主体、仅边界 band 内衔接，仅在全带确实出现重影且无幻觉时使用，值为渐变带宽。\"}]}},\"input_order\":{\"required\":[\"tiles\",\"stitcher\"],\"optional\":[\"keep_colors\",\"align_mode\",\"max_align_shift\",\"blend_band\"]},\"is_input_list\":true,\"output\":[\"IMAGE\",\"STRING\"],\"output_is_list\":[true,false],\"output_name\":[\"image\",\"diagnostics\"],\"name\":\"GemTiledUpscaleStitch\",\"display_name\":\"Tiled Upscale Stitch (ItsGemTools)\",\"description\":\"把 GemTiledUpscale 的 tiles 重绘结果拼回成图。相比原版新增亚像素几何配准（align_mode=translation）：每个重绘 tile 先与源 tile 配准归位再混合，根治接缝偏移 / 重影，适配 QwenImage 2.1 + 自训 LoRA。\",\"python_module\":\"custom_nodes.ItsGemTools\",\"category\":\"ItsGemTools/image\",\"output_node\":false,\"has_intermediate_output\":false,\"output_tooltips\":[\"拼回并调整到目标尺寸的成图。输入多张图时输出列表，各一张成图。\",\"逐 tile 配准诊断：每个 tile 的估计位移 / 跳过原因，排查偏移用。\"],\"search_aliases\":[]},\"ComfyMathExpression\":{\"input\":{\"required\":{\"expression\":[\"STRING\",{\"default\":\"a + b\",\"multiline\":true}],\"values\":[\"COMFY_AUTOGROW_V3\",{\"template\":{\"input\":{\"required\":{\"value\":[\"FLOAT,INT,BOOLEAN\",{}]}},\"names\":[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\",\"h\",\"i\",\"j\",\"k\",\"l\",\"m\",\"n\",\"o\",\"p\",\"q\",\"r\",\"s\",\"t\",\"u\",\"v\",\"w\",\"x\",\"y\",\"z\"],\"min\":1}}]}},\"input_order\":{\"required\":[\"expression\",\"values\"]},\"is_input_list\":false,\"output\":[\"FLOAT\",\"INT\",\"BOOLEAN\"],\"output_is_list\":[false,false,false],\"output_name\":[\"FLOAT\",\"INT\",\"BOOL\"],\"output_tooltips\":[null,null,null],\"output_matchtypes\":null,\"name\":\"ComfyMathExpression\",\"display_name\":\"Math Expression\",\"description\":\"\",\"python_module\":\"comfy_extras.nodes_math\",\"category\":\"utilities\",\"output_node\":false,\"deprecated\":false,\"experimental\":false,\"dev_only\":false,\"api_node\":false,\"price_badge\":null,\"search_aliases\":[\"math\",\"expression\",\"formula\",\"calculate\",\"calculator\",\"eval\"],\"essentials_category\":null,\"has_intermediate_output\":false},\"ImageScaleBy\":{\"input\":{\"required\":{\"image\":[\"IMAGE\"],\"upscale_method\":[[\"nearest-exact\",\"bilinear\",\"area\",\"bicubic\",\"lanczos\"]],\"scale_by\":[\"FLOAT\",{\"default\":1.0,\"min\":0.01,\"max\":8.0,\"step\":0.01}]}},\"input_order\":{\"required\":[\"image\",\"upscale_method\",\"scale_by\"]},\"is_input_list\":false,\"output\":[\"IMAGE\"],\"output_is_list\":[false],\"output_name\":[\"IMAGE\"],\"name\":\"ImageScaleBy\",\"display_name\":\"Upscale Image By\",\"description\":\"\",\"python_module\":\"nodes\",\"category\":\"image/upscaling\",\"output_node\":false,\"has_intermediate_output\":false,\"search_aliases\":[],\"essentials_category\":\"Image Tools\"}}"

TWIN_NAMES = {"t2i": "qwen21_道劫_t2i_api", "i2i": "qwen21_道劫_i2i_api"}
TWIN_REFERENCE_THREE = [
    {"node": "10", "slot": 0, "field": "image", "class_type": "LoadImage"},
    {"node": "11", "slot": 1, "field": "image", "class_type": "LoadImage"},
    {"node": "12", "slot": 2, "field": "image", "class_type": "LoadImage"},
]


class Fail(AssertionError):
    pass


def need(cond: bool, msg: str) -> None:
    if not cond:
        raise Fail(msg)


def load_gem_donors() -> dict:
    """现读 Gem 源件,返回 {new_id: donor_node};同时校验 widgets 双源一致。"""
    gem = json.loads(GEM.read_text(encoding="utf-8"))
    sub = next(s for s in gem["definitions"]["subgraphs"] if s["id"] == GEM_GUARD_SG)
    sub_nodes = {n["id"]: n for n in sub["nodes"]}
    top_nodes = {n["id"]: n for n in gem["nodes"]}
    donors = {}
    for nid, (scope, did) in DONOR.items():
        src = sub_nodes if scope == "sub" else top_nodes
        need(did in src, f"Gem 源件缺 donor {scope}:{did!r}(手术真源被动的,先查源件)")
        donors[nid] = src[did]
        # 断言 A(半):方案 widgets 表 == Gem 源件 donor 现值(逐位;1118 B 案
        # 偏离件豁免——widgets 真源=DEVIATIONS/WIDGETS 蓝图,不再照源件)
        if nid in DEVIATIONS:
            continue
        if WIDGETS[nid] is None:
            need("widgets_values" not in donors[nid],
                 f"8{nid} 方案=无 widgets_values,但 Gem donor {did} 带该键(方案/源件漂移)")
        else:
            got = donors[nid].get("widgets_values")
            need(got == WIDGETS[nid],
                 f"{nid} widgets 方案表≠Gem 源件 donor {did}: {got!r} vs {WIDGETS[nid]!r}")
    return donors


def build_new_node(nid: int, donor: dict, pos, order: int) -> dict:
    node = {
        "id": nid,
        "type": donor["type"],
        "pos": list(pos),
        "size": list(SIZES[nid]),
        "flags": copy.deepcopy(donor.get("flags") or {}),
        "order": order,
        "mode": 0,
        "inputs": copy.deepcopy(donor.get("inputs") or []),
        "outputs": copy.deepcopy(donor.get("outputs") or []),
        "title": TITLES[nid],
        "properties": copy.deepcopy(donor.get("properties") or {}),
    }
    if WIDGETS[nid] is not None:
        node["widgets_values"] = copy.deepcopy(WIDGETS[nid])
    # 全 13 节点不写 widgets_values_named(F7:源件 named 假名陷阱)
    for idx, slot in enumerate(node["inputs"]):
        slot["link"] = next((l[0] for l in LINKS if l[3] == nid and l[4] == idx), None)
    for idx, slot in enumerate(node["outputs"]):
        lids = [l[0] for l in LINKS if l[1] == nid and l[2] == idx]
        slot["links"] = lids if lids else slot.get("links")
    return node


def sg_of(wf: dict, sg_id: str) -> dict:
    return next(s for s in wf["definitions"]["subgraphs"] if s["id"] == sg_id)


def surgery_canvas(name: str, donors: dict) -> dict:
    """幂等画布手术;返回 (术前态, 术后态)。"""
    path = CANVASES[name]
    wf = json.loads(path.read_text(encoding="utf-8"))
    before = copy.deepcopy(wf)
    nodes = {n["id"]: n for n in wf["nodes"]}
    have_new = [nid for nid in NEW_IDS if nid in nodes]

    # —— 前置核验(fail-closed)——
    for nid in have_new:
        need(nodes[nid]["type"] == donors[nid]["type"],
             f"{name}: id {nid} 已被占用且类型不符({nodes[nid]['type']}),拒绝覆盖")
    link_ids = [l[0] for l in wf["links"]]
    need(all(l not in link_ids for l in range(8217, 8237)) or all(
        l in link_ids for l in range(8217, 8237)),
        f"{name}: 8217-8236 段部分在场(半手术态),先人工核")
    need(503 in nodes and nodes[503]["type"] == SEEDVR_SG, f"{name}: 缺 SeedVR 宿主 503")
    need(7500 in nodes and 504 in nodes, f"{name}: 缺 7500/504 锚点")
    need(wf["last_node_id"] <= 8120 and wf["last_link_id"] <= 8236,
         f"{name}: 计数器越段(last={wf['last_node_id']}/{wf['last_link_id']})")
    sg = sg_of(wf, SEEDVR_SG)
    sg_nodes = {n["id"]: n for n in sg["nodes"]}
    need(all(i in sg_nodes for i in SEEDVR_SG_IDS), f"{name}: SeedVR 子图缺节点")
    grp_ids = [g["id"] for g in wf["groups"]]
    need(7 not in grp_ids or any(g["id"] == 7 and g["title"] in (GROUP_TITLE, GROUP_TITLE_OLD)
                                  for g in wf["groups"]),
         f"{name}: 组 id 7 已被异构占用(题名非新旧名)")

    # —— 1) 新节点 ——
    if len(have_new) < len(NEW_IDS):
        base_order = max(n.get("order", 0) for n in wf["nodes"] if isinstance(n.get("order"), int)) + 1
        order = base_order
        for nid in NEW_IDS:
            if nid in nodes:
                continue
            wf["nodes"].append(build_new_node(nid, donors[nid], POS[name][nid], order))
            order += 1

    # —— 1b) 新链节点按蓝图回灌 widgets/title/pos(1118 B 案调参口+立宪重排口,
    #     幂等;size/mode 不动;pos 恒取 POS 表=立宪坐标单源) ——
    nodes = {n["id"]: n for n in wf["nodes"]}
    for nid in NEW_IDS:
        cur = nodes[nid]
        if WIDGETS[nid] is None:
            cur.pop("widgets_values", None)
        else:
            cur["widgets_values"] = copy.deepcopy(WIDGETS[nid])
        cur.pop("widgets_values_named", None)
        cur["title"] = TITLES[nid]
        cur["pos"] = list(POS[name][nid])

    # —— 2) 摘旧线 + 端点改挂 ——
    old = OLD_LINK[name]
    if old in [l[0] for l in wf["links"]]:
        wf["links"] = [l for l in wf["links"] if l[0] != old]
    nodes = {n["id"]: n for n in wf["nodes"]}
    n504, n503, n7500 = nodes[504], nodes[503], nodes[7500]
    slot504 = next(i for i in n504["inputs"] if i["name"] == "images")
    slot504["link"] = 8236
    out503 = n503["outputs"][0]
    if old in (out503["links"] or []):
        out503["links"] = [x for x in out503["links"] if x != old]
    fan7500 = n7500["outputs"][0]["links"]
    for add in (8217, 8218):
        if add not in fan7500:
            fan7500.append(add)

    # —— 3) 新 links ——
    have = {l[0] for l in wf["links"]}
    for l in LINKS:
        if l[0] not in have:
            wf["links"].append(list(l))

    # —— 4) SeedVR mode=4(顶层宿主+子图定义内四节点)——
    if n503.get("mode", 0) == 0:
        n503["mode"] = 4
    for i in SEEDVR_SG_IDS:
        if sg_nodes[i].get("mode", 0) == 0:
            sg_nodes[i]["mode"] = 4

    # —— 5) 组框 + 计数器(幂等回灌 bounding=立宪坐标单源) ——
    grp7 = next((g for g in wf["groups"]
                 if g["id"] == 7 and g["title"] in (GROUP_TITLE, GROUP_TITLE_OLD)), None)
    if grp7 is None:
        wf["groups"].append(copy.deepcopy(GROUPS[name]))
    else:
        grp7["title"] = GROUP_TITLE  # 1118 换装改名:命中旧名就地改(防复跑追加重复组 id 7)
        grp7["bounding"] = list(GROUPS[name]["bounding"])

    # —— 6) 1118末 用户令既有件动位 + 组框修正(幂等回灌) ——
    for nid, pos in MOVE_USER[name].items():
        nodes[nid]["pos"] = list(pos)
    for g in wf["groups"]:
        # 1118末 ⑤组正名:去「·2K」尾注(用户令,终图像素不定;前缀锚幂等就地改)
        if g.get("title", "").startswith(SVR2_GROUP_PREFIX) and g["title"] != SVR2_GROUP_PREFIX:
            g["title"] = SVR2_GROUP_PREFIX
        fix = GROUP_FIX[name].get(g.get("title", ""))
        if fix is not None:
            g["bounding"] = list(fix)
    wf["last_node_id"] = max(wf["last_node_id"], 8120)
    wf["last_link_id"] = max(wf["last_link_id"], 8236)
    return before, wf


def reverse_canvas(name: str) -> None:
    """功能性逆手术:摘 Gem 链、复活 SeedVR(503 mode0+重建旧线)。幂等。"""
    path = CANVASES[name]
    wf = json.loads(path.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in wf["nodes"]}
    old = OLD_LINK[name]
    gem_links = {l[0] for l in LINKS}
    wf["links"] = [l for l in wf["links"] if l[0] not in gem_links]
    if 504 in nodes and 503 in nodes:
        slot504 = next(i for i in nodes[504]["inputs"] if i["name"] == "images")
        if slot504.get("link") == 8236:
            slot504["link"] = old
        if old not in [l[0] for l in wf["links"]]:
            wf["links"].append([old, 503, 0, 504, 0, "IMAGE"])
        out503 = nodes[503]["outputs"][0]
        links = out503.get("links") or []
        if old not in links:
            links.append(old)
        out503["links"] = links
        if nodes[503].get("mode") == 4:
            nodes[503]["mode"] = 0
    if 7500 in nodes:
        fan = nodes[7500]["outputs"][0]["links"]
        nodes[7500]["outputs"][0]["links"] = [x for x in (fan or []) if x not in (8217, 8218)]
    wf["nodes"] = [n for n in wf["nodes"] if n["id"] not in NEW_IDS]
    wf["groups"] = [g for g in wf["groups"] if not (g.get("id") == 7 and g.get("title") in (GROUP_TITLE, GROUP_TITLE_OLD))]
    try:
        sg = sg_of(wf, SEEDVR_SG)
        for n in sg["nodes"]:
            if n["id"] in SEEDVR_SG_IDS and n.get("mode") == 4:
                n["mode"] = 0
    except StopIteration:
        pass
    write_json(path, wf, indent=2)
    print(f"[gem-graft] reverse: {path.name} 已摘 Gem 链、SeedVR 复活(mode0+旧线 {old} 重建)")


def write_json(path: Path, data, indent: int) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=indent)
    if indent == 1:
        text += "\n"  # 快照件带尾换行;画布/蓝图不带
    if text != path.read_text(encoding="utf-8"):
        path.write_text(text, encoding="utf-8")
        print(f"[gem-graft] 写入 {path.relative_to(REPO)}")
    else:
        print(f"[gem-graft] 无变化(幂等跳过) {path.relative_to(REPO)}")


# ═══════════════════════ 验证层 ═══════════════════════

def git_head_json(path: Path):
    rel = str(path.relative_to(REPO))
    out = subprocess.run(["git", "-C", str(REPO), "show", f"HEAD:{rel}"],
                         capture_output=True)
    if out.returncode != 0:
        return None
    return json.loads(out.stdout.decode("utf-8"))


def canon_up4(sg: dict) -> str:
    """_canon_up4 同规(契约测试 6094 行):除 id/state/last_link_id 外 canonical 全等。"""
    sg = copy.deepcopy(sg)
    sg.pop("id", None), sg.pop("state", None), sg.pop("last_link_id", None)
    links = sorted(sg.get("links", []),
                   key=lambda l: (l["origin_id"], l["origin_slot"], l["target_id"],
                                  l["target_slot"], l["type"], l["id"]))
    lid = {l["id"]: i for i, l in enumerate(links)}
    sg["links"] = [{**l, "id": lid[l["id"]]} for l in links]
    for io in ("inputs", "outputs"):
        for s in sg.get(io, []):
            s["linkIds"] = sorted(lid.get(x, x) for x in (s.get("linkIds") or []))
    for n in sg["nodes"]:
        for i in n.get("inputs", []):
            if i.get("link") is not None:
                i["link"] = lid.get(i["link"], i["link"])
    return json.dumps(sg, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _norm_link(l):
    """画布顶层 link=数组形;子图 link=字典形——归一为六元组。"""
    if isinstance(l, dict):
        return (l["id"], l["origin_id"], l["origin_slot"], l["target_id"],
                l["target_slot"], l["type"])
    return tuple(l)


def verify_link_table(scope_name: str, nodes: list, links: list, sg_inputs=None, sg_outputs=None) -> None:
    """断言 D:全 links 可解析+双向登记(两形通吃)。"""
    links = [_norm_link(l) for l in links]
    nmap = {n["id"]: n for n in nodes}
    lmap = {l[0]: l for l in links}
    for l in links:
        lid, oid, osl, tid, tsl, typ = l
        # 端点可解析(子图边界 -10/-20 走子图 inputs/outputs 槽表)
        if oid == -10:
            need(slots_ok(sg_inputs, osl, typ), f"{scope_name}: link{l[0]} -10 槽越界/类型不符")
        else:
            need(oid in nmap, f"{scope_name}: link{l[0]} origin {oid} 不存在")
            outs = nmap[oid].get("outputs") or []
            need(0 <= osl < len(outs), f"{scope_name}: link{l[0]} origin 槽 {osl} 越界({oid})")
            need(_type_ok(outs[osl]["type"], typ),
                 f"{scope_name}: link{l[0]} 类型 {typ} ≠ 源槽 {outs[osl]['type']}")
            need(lid in (outs[osl].get("links") or []),
                 f"{scope_name}: link{l[0]} 未登记在 {oid}.outputs[{osl}].links")
        if tid == -20:
            need(slots_ok(sg_outputs, tsl, typ), f"{scope_name}: link{l[0]} -20 槽越界/类型不符")
        else:
            need(tid in nmap, f"{scope_name}: link{l[0]} target {tid} 不存在")
            ins = nmap[tid].get("inputs") or []
            need(0 <= tsl < len(ins), f"{scope_name}: link{l[0]} target 槽 {tsl} 越界({tid})")
            need(_type_ok(ins[tsl]["type"], typ),
                 f"{scope_name}: link{l[0]} 类型 {typ} ≠ 目标槽 {ins[tsl]['type']}")
            need(ins[tsl].get("link") == lid,
                 f"{scope_name}: link{l[0]} 未登记在 {tid}.inputs[{tsl}].link")
    # 反向:节点槽登记的 link 必须真实存在且端点吻合
    for n in nodes:
        for idx, i in enumerate(n.get("inputs") or []):
            if i.get("link") is not None:
                need(i["link"] in lmap, f"{scope_name}: {n['id']}.inputs[{idx}].link={i['link']} 无此线")
                l = lmap[i["link"]]
                need((l[3], l[4]) == (n["id"], idx),
                     f"{scope_name}: {n['id']}.inputs[{idx}] 登记的线端点不符 {l}")
        for idx, o in enumerate(n.get("outputs") or []):
            for lid in (o.get("links") or []):
                need(lid in lmap, f"{scope_name}: {n['id']}.outputs[{idx}].links 含无此线 {lid}")
                l = lmap[lid]
                need((l[1], l[2]) == (n["id"], idx),
                     f"{scope_name}: {n['id']}.outputs[{idx}] 登记的线端点不符 {l}")


def _type_ok(slot_type, typ: str) -> bool:
    """link 类型与槽类型相容:多型逗号表含之,或槽为通配 '*'(i2i 术前既有形)。"""
    t = str(slot_type).strip()
    return t == "*" or typ in t.split(",")


def slots_ok(slots, idx: int, typ: str) -> bool:
    return slots is not None and 0 <= idx < len(slots) and _type_ok(slots[idx]["type"], typ)


def verify_canvas(name: str, before: dict, wf: dict, donors: dict) -> None:
    nodes = {n["id"]: n for n in wf["nodes"]}
    links = {l[0]: l for l in wf["links"]}

    # A. 13 新节点:type/mode/pos/size/widgets 逐位 == donor 与方案表;槽形照 donor
    for nid in NEW_IDS:
        need(nid in nodes, f"{name}: 缺新节点 {nid}")
        n = nodes[nid]
        d = donors[nid]
        need(n["type"] == d["type"], f"{name}:{nid} type {n['type']} ≠ donor {d['type']}")
        need(n.get("mode", 0) == 0, f"{name}:{nid} mode 应 0")
        need(n["pos"] == POS[name][nid], f"{name}:{nid} pos {n['pos']} ≠ 方案 {POS[name][nid]}")
        need(list(n["size"]) == SIZES[nid], f"{name}:{nid} size {n['size']} ≠ 方案 {SIZES[nid]}")
        if WIDGETS[nid] is None:
            need("widgets_values" not in n, f"{name}:{nid} 应整键省略 widgets_values(null=flatten TypeError)")
            need("widgets_values" not in d, f"{name}:{nid} donor 带 widgets_values 与方案冲突")
        elif nid in DEVIATIONS:
            # 1118 B 案偏离件:只钉蓝图,不对拍 Gem donor(源件仍是 ItsGem face)
            need(n.get("widgets_values") == WIDGETS[nid],
                 f"{name}:{nid} widgets ≠ 蓝图(1118 B 案偏离件): {n.get('widgets_values')!r}")
        else:
            need(n.get("widgets_values") == WIDGETS[nid] == d.get("widgets_values"),
                 f"{name}:{nid} widgets 三源不一致: {n.get('widgets_values')!r}")
        need("widgets_values_named" not in n, f"{name}:{nid} 不得带 named(假名覆盖陷阱 F7)")
        need([(i["name"], i["type"]) for i in (n.get("inputs") or [])]
             == [(i["name"], i["type"]) for i in (d.get("inputs") or [])],
             f"{name}:{nid} 输入槽名/型未照 donor")
        need([(o["name"], o["type"]) for o in (n.get("outputs") or [])]
             == [(o["name"], o["type"]) for o in (d.get("outputs") or [])],
             f"{name}:{nid} 输出槽名/型未照 donor")

    # B. SeedVR 仍在且 mode=4(节点零删)
    need(503 in nodes and nodes[503]["type"] == SEEDVR_SG,
         f"{name}: SeedVR 宿主 503 应仍在(零删)")
    need(nodes[503].get("mode") == 4, f"{name}: 503 mode 应 4(得 {nodes[503].get('mode')})")
    sg = sg_of(wf, SEEDVR_SG)
    for i in SEEDVR_SG_IDS:
        dn = next((x for x in sg["nodes"] if x["id"] == i), None)
        need(dn is not None and dn["type"] == SEEDVR_SG_TYPES[i],
             f"{name}: SeedVR 子图缺 {i} 或类型变")
        need(dn.get("mode") == 4, f"{name}: SeedVR 子图 {i} mode 应 4(得 {dn.get('mode')})")

    # C. 存图改线
    old = OLD_LINK[name]
    need(old not in links, f"{name}: 旧线 {old} 应整根摘除")
    for l in LINKS:
        need(l[0] in links and tuple(links[l[0]]) == l,
             f"{name}: link {l[0]} 缺失或形不符: {links.get(l[0])}")
    slot504 = next(i for i in nodes[504]["inputs"] if i["name"] == "images")
    need(slot504.get("link") == 8236, f"{name}: 504.images.link 应 8236(得 {slot504.get('link')})")
    out503 = nodes[503]["outputs"][0].get("links") or []
    expect_out503 = [x for x in ([205, 207] if name == "t2i" else [204]) if x != old]
    need(sorted(out503) == sorted(expect_out503),
         f"{name}: 503 出扇出应 {expect_out503}(得 {out503})")
    fan = set(nodes[7500]["outputs"][0].get("links") or [])
    need({8217, 8218} <= fan, f"{name}: 7500 出扇出应含 8217/8218(得 {sorted(fan)})")

    # D. 全图 links 可解析(顶层+各子图,双向互逆)
    verify_link_table(f"{name}/top", wf["nodes"], wf["links"])
    for s in wf["definitions"]["subgraphs"]:
        verify_link_table(f"{name}/sg[{s['id'][:8]}]", s["nodes"], s["links"],
                          sg_inputs=s.get("inputs"), sg_outputs=s.get("outputs"))

    # E. 组框 7 罩全 13 且仅 13
    grp = [g for g in wf["groups"] if g.get("id") == 7]
    need(len(grp) == 1 and grp[0]["title"] == GROUP_TITLE, f"{name}: 组 7 应恰一组且题名符")
    g = grp[0]
    need(g["bounding"] == GROUPS[name]["bounding"] and g["color"] == GROUPS[name]["color"],
         f"{name}: 组 7 bounding/color 与方案不符: {g}")
    need("mode" not in g, f"{name}: 组 7 不得带 mode(默认 0 激活)")
    need(not g["title"].startswith(SVR2_GROUP_PREFIX), f"{name}: 组 7 题名误触尾档选择器前缀")
    bx, by, bw, bh = g["bounding"]
    inside = []
    for n in wf["nodes"]:
        if "size" not in n or "pos" not in n:
            continue
        x, y = n["pos"]; w, h = n["size"]
        if bx <= x and y >= by and x + w <= bx + bw and y + h <= by + bh:
            inside.append(n["id"])
    need(sorted(inside) == sorted(NEW_IDS),
         f"{name}: ⑤b 罩集应恰 13 新节点(得 {sorted(inside)})")

    # E2. 504 不被误罩进 ⑤b(既有件零裹挟,上条已保证);组框间不相交
    for g2 in wf["groups"]:
        if g2 is g:
            continue
        ax, ay, aw, ah = g2["bounding"]
        need(not (ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah),
             f"{name}: 组框 {g2.get('title')} 与 ⑤b 相交")

    # F. 既有节点零扰动(vs 术前态深比对;1118末 用户令动位件豁免 pos)
    b_nodes = {n["id"]: n for n in before["nodes"]}
    for nid, b in b_nodes.items():
        cur = nodes.get(nid)
        need(cur is not None, f"{name}: 术前节点 {nid} 不得消失")
        if nid in NEW_IDS:
            continue  # 新链节点由断言 A 按蓝图逐位钉(1118 B 案调参口,F 只保既有件)
        moved = MOVE_USER[name].get(nid)
        if moved is not None:
            need(cur["pos"] == list(moved), f"{name}: 既有节点 {nid} 应在用户令动位 {moved}(得 {cur['pos']})")
            b = copy.deepcopy(b)
            b["pos"] = list(moved)
        if nid == 503:
            exp = copy.deepcopy(b)
            exp["mode"] = 4
            exp["outputs"][0]["links"] = [x for x in (b["outputs"][0].get("links") or [])
                                          if x != old]
            need(cur == exp, f"{name}: 503 除 mode/出扇出/pos 外不得变动")
        elif nid == 504:
            exp = copy.deepcopy(b)
            for i in exp["inputs"]:
                if i["name"] == "images":
                    i["link"] = 8236
            need(cur == exp, f"{name}: 504 除 images.link/pos 外不得变动")
        elif nid == 7500:
            exp = copy.deepcopy(b)
            exp["outputs"][0]["links"] = list(b["outputs"][0].get("links") or [])
            for add in (8217, 8218):
                if add not in exp["outputs"][0]["links"]:
                    exp["outputs"][0]["links"].append(add)
            need(cur == exp, f"{name}: 7500 除出扇出外不得变动")
        else:
            need(cur == b, f"{name}: 既有节点 {nid} 被扰动(pos/size/mode/order/widgets 任一)")
    # links 集合 = 术前 - 旧线 + 20 新线
    b_links = {l[0]: l for l in before["links"]}
    want = {k: v for k, v in b_links.items() if k != old}
    want.update({l[0]: list(l) for l in LINKS})
    need({k: tuple(v) for k, v in links.items()} == {k: tuple(v) for k, v in want.items()},
         f"{name}: links 集合 ≠ 术前-旧线+20新线")
    # groups = 术前 + 组7 + 用户令修正框(⑤/加速区;幂等复跑双侧同态)
    for g2 in wf["groups"]:
        if g2.get("id") == 7:
            continue
        fix = GROUP_FIX[name].get(g2.get("title", ""))
        if fix is not None:
            need(g2["bounding"] == list(fix),
                 f"{name}: 组框「{g2.get('title')}」bounding 应用户令修正值 {fix}(得 {g2.get('bounding')})")
        else:
            b_g = next((x for x in before["groups"] if x.get("id") == g2.get("id")), None)
            need(b_g is not None and g2 == b_g, f"{name}: 既有组框被扰动: {g2.get('title')}")
    # 1118末 用户令断言:504 出 ⑤ 组且不入 ⑤b;8236 右流(504 在 8120 右侧)
    g7box = next(g["bounding"] for g in wf["groups"] if g["id"] == 7)
    svr_box = next(g["bounding"] for g in wf["groups"]
                   if g.get("title", "").startswith(SVR2_GROUP_PREFIX))
    p4 = nodes[504]["pos"]; s4 = (nodes[504].get("size") or [380, 330])
    for tag2, bx in (("⑤b", g7box), ("⑤", svr_box)):
        need(not (bx[0] <= p4[0] and p4[0] + s4[0] <= bx[0] + bx[2]
                  and bx[1] <= p4[1] and p4[1] + s4[1] <= bx[1] + bx[3]),
             f"{name}: 504 不得落入 {tag2} 组框(用户令=画布最右)")
    need(nodes[504]["pos"][0] > nodes[8120]["pos"][0],
         f"{name}: 504 应在 8120 右侧(8236 右流)")
    # 子图:仅 f0a844a8 四节点 mode 位;其余子图深比对恒等
    b_sgs = {s["id"]: s for s in before["definitions"]["subgraphs"]}
    for s in wf["definitions"]["subgraphs"]:
        b = b_sgs[s["id"]]
        if s["id"] == SEEDVR_SG:
            exp = copy.deepcopy(b)
            for n in exp["nodes"]:
                if n["id"] in SEEDVR_SG_IDS:
                    n["mode"] = 4
            need(s == exp, f"{name}: SeedVR 子图除四节点 mode 外不得变动")
        else:
            need(s == b, f"{name}: 子图 {s['id'][:8]} 被扰动")
    # 计数器
    need(wf["last_node_id"] == 8120 and wf["last_link_id"] == 8236,
         f"{name}: 计数器应 8120/8236(得 {wf['last_node_id']}/{wf['last_link_id']})")
    max_node = max([n["id"] for n in wf["nodes"]] +
                   [n["id"] for s in wf["definitions"]["subgraphs"] for n in s["nodes"]])
    max_link = max([l[0] for l in wf["links"]] +
                   [l["id"] for s in wf["definitions"]["subgraphs"] for l in s["links"]])
    need(wf["last_node_id"] >= max_node and wf["last_link_id"] >= max_link,
         f"{name}: 计数器低于实存最大 id({max_node}/{max_link})")
    # 其余顶层键
    for k in wf:
        if k in ("nodes", "links", "groups", "last_node_id", "last_link_id", "definitions"):
            continue
        need(wf[k] == before.get(k), f"{name}: 顶层键 {k} 被扰动")

    # G. 几何:节点矩形两两不交(全量,含新节点)
    rects = [(n["id"], n["pos"][0], n["pos"][1], n["size"][0], n["size"][1])
             for n in wf["nodes"] if "pos" in n and "size" in n]
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            a, b = rects[i], rects[j]
            need(not (a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
                      and a[2] < b[2] + b[4] and b[2] < a[2] + a[4]),
                 f"{name}: 节点矩形相交 {a[0]} × {b[0]}")


def verify_blueprint(before_bp: dict) -> None:
    bp = json.loads(BP.read_text(encoding="utf-8"))
    root = next(n for n in bp["nodes"] if n["id"] == 1)
    need(root["type"] == SEEDVR_SG and root.get("mode") == 4,
         f"蓝图根宿主 mode 应 4(得 {root.get('mode')})")
    sg = bp["definitions"]["subgraphs"][0]
    need(sg["id"] == SEEDVR_SG, "蓝图子图 uuid 漂移")
    for i in SEEDVR_SG_IDS:
        n = next(x for x in sg["nodes"] if x["id"] == i)
        need(n["type"] == SEEDVR_SG_TYPES[i] and n.get("mode") == 4,
             f"蓝图 sg {i} mode 应 4/type 不变")
    # 除 mode 位外零扰动
    exp = copy.deepcopy(before_bp)
    for n in exp["nodes"]:
        if n["id"] == 1:
            n["mode"] = 4
    for n in exp["definitions"]["subgraphs"][0]["nodes"]:
        if n["id"] in SEEDVR_SG_IDS:
            n["mode"] = 4
    need(bp == exp, "蓝图除 mode 五位外被扰动")
    # H. canonical 恒等:蓝图 sg ↔ 两画布内嵌 f0a844a8
    for name in CANVASES:
        wf = json.loads(CANVASES[name].read_text(encoding="utf-8"))
        need(canon_up4(sg_of(wf, SEEDVR_SG)) == canon_up4(sg),
             f"蓝图 ↔ {name} 内嵌 SeedVR 定义 canonical 漂移")


def verify_snapshot(embed: dict) -> None:
    snap = json.loads(SNAP.read_text(encoding="utf-8"))
    for cls, entry in embed.items():
        need(cls in snap and snap[cls] == entry, f"快照缺类或漂移: {cls}")
    before = git_head_json(SNAP)
    if before is not None:
        need(set(before) <= set(snap), "快照原有类不得消失")
        for k, v in before.items():
            need(snap[k] == v, f"快照原有类被改动: {k}")
    base = 66 if before is None else len(before)
    need(len(snap) in (base, base + 4),
         f"快照类数应 base 或 base+4(幂等重跑;HEAD 已含四类则=base;base={base},得 {len(snap)})")


def verify_twins() -> None:
    t2i = json.loads(TWIN_T2I.read_text(encoding="utf-8"))
    i2i = json.loads(TWIN_I2I.read_text(encoding="utf-8"))
    for name, twin in (("t2i", t2i), ("i2i", i2i)):
        g = twin["graph"]
        need(twin.get("name") == TWIN_NAMES[name], f"{name} 孪生 name 变更: {twin.get('name')}")
        need(not any(k == "503" or k.startswith("503:") for k in g),
             f"{name} 孪生: 503 键应整体缺席(SeedVR mode4 剪枝)")
        cls = {n["class_type"] for n in g.values()}
        need(not any(c.startswith("SeedVR2") for c in cls),
             f"{name} 孪生: SeedVR2* 类应缺席(得 {sorted(c for c in cls if c.startswith('SeedVR2'))})")
        for nid in NEW_IDS:
            need(str(nid) in g, f"{name} 孪生: 缺平铺键 {nid}")
        need(g["504"]["inputs"]["images"] == ["8120", 0],
             f"{name} 孪生: 504.images 应 ['8120',0](得 {g['504']['inputs'].get('images')})")
        need(g["504"]["class_type"] == "SaveImage", f"{name} 孪生: 504 应 SaveImage")
    g = i2i["graph"]
    for k in ("11", "12", "17", "18"):
        need(k in g, f"i2i 孪生: 缺三槽手术层键 {k}")
    need(i2i["inputs"]["references"] == TWIN_REFERENCE_THREE,
         f"i2i 孪生: references 应 3 条(得 {i2i['inputs'].get('references')})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--verify-only", action="store_true", help="只验不改(含孪生件核验)")
    ap.add_argument("--reverse", action="store_true", help="逆手术:复活 SeedVR 链、摘 Gem 链")
    args = ap.parse_args()

    if args.reverse and args.verify_only:
        print("--reverse 与 --verify-only 互斥"); return 2

    if args.reverse:
        for name in CANVASES:
            reverse_canvas(name)
        bp = json.loads(BP.read_text(encoding="utf-8"))
        changed = False
        root = next(n for n in bp["nodes"] if n["id"] == 1)
        if root.get("mode") == 4:
            root["mode"] = 0; changed = True
        for n in bp["definitions"]["subgraphs"][0]["nodes"]:
            if n["id"] in SEEDVR_SG_IDS and n.get("mode") == 4:
                n["mode"] = 0; changed = True
        write_json(BP, bp, indent=2)
        print("[gem-graft] reverse 完成(快照四类保留=无害;孪生件须重跑生成器复原)")
        return 0

    donors = load_gem_donors()  # 内含断言 A(半):方案表 == Gem 源件现值
    embed = json.loads(OBJECT_INFO_EMBED_JSON)

    if args.verify_only:
        for name in CANVASES:
            wf = json.loads(CANVASES[name].read_text(encoding="utf-8"))
            before = git_head_json(CANVASES[name])
            need(before is not None, f"{name}: 取 git HEAD 术前态失败(无法执行零扰动比对)")
            verify_canvas(name, before, wf, donors)
            print(f"[gem-graft] verify {name}: PASS")
        verify_blueprint(git_head_json(BP) or json.loads('{"nodes":[],"definitions":{"subgraphs":[]}}'))
        print("[gem-graft] verify blueprint: PASS")
        verify_snapshot(embed)
        print("[gem-graft] verify snapshot: PASS")
        verify_twins()
        print("[gem-graft] verify twins: PASS")
        print("[gem-graft] --verify-only 全部断言通过 ✓")
        return 0

    # 手术:画布×2 + 蓝图 + 快照(全部幂等)
    for name in CANVASES:
        before, after = surgery_canvas(name, donors)
        write_json(CANVASES[name], after, indent=2)
        verify_canvas(name, before, json.loads(CANVASES[name].read_text(encoding="utf-8")), donors)
        print(f"[gem-graft] surgery+verify {name}: PASS")

    bp = json.loads(BP.read_text(encoding="utf-8"))
    bp_before = copy.deepcopy(bp)
    root = next(n for n in bp["nodes"] if n["id"] == 1)
    if root.get("mode", 0) == 0:
        root["mode"] = 4
    for n in bp["definitions"]["subgraphs"][0]["nodes"]:
        if n["id"] in SEEDVR_SG_IDS and n.get("mode", 0) == 0:
            n["mode"] = 4
    write_json(BP, bp, indent=2)
    verify_blueprint(bp_before)
    print("[gem-graft] surgery+verify blueprint: PASS")

    snap = json.loads(SNAP.read_text(encoding="utf-8"))
    snap_before_count = len(snap)
    for cls, entry in embed.items():
        if cls not in snap:
            snap[cls] = entry
        else:
            need(snap[cls] == entry, f"快照已有类 {cls} 与引擎冻结条目不符(只增不改纪律)")
    write_json(SNAP, snap, indent=1)
    verify_snapshot(embed)
    print(f"[gem-graft] surgery+verify snapshot: {snap_before_count}→{len(snap)} 类 PASS")

    print("[gem-graft] 手术完成。孪生件待重生成(另跑 qwen21_bridge_template_build.py "
          "--target t2i / i2i);全量核验用 --verify-only。")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Fail as exc:
        print(f"[gem-graft] FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
