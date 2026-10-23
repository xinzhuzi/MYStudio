#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""道劫加速子图 FunAcc→官方Turbo 换臂·单一真源化 手术脚本(役号 1016turbo)。

真源链:工作流 JSON(本脚本唯一写点)→ 蓝图件(本脚本抽取)→ 装机/引擎家(--sync-home 数据级)。

用法:
  --check        只读:验锚(未施态验术前锚/已施态验术后锚)+三蓝图 canonical-除-id 对比
  (默认)         手术三工作流+抽三蓝图(幂等;任何锚失即中止,fail-closed)
  --sync-home    术后:三工作流+三蓝图+py 三件同步装机 Resources 与引擎家
                 custom_nodes/my-nodes(不含引擎家用户区——placement_audit 会话恒零写入)

设计(计划 v3):
  - 移除 [7013] T8 FunAcc 节点+其全部 5 线(内容锚:target_id/origin_id==7013)
  - 新增 Turbo 臂:t2i/i2i=7028 LoRA/7029 BasicGuider/7030 ManualSigmas/7031
    SamplerCustomAdvanced(噪声/采样器复用 viggle 臂 7017/7018);edit 另加
    7032 RandomNoise/7033 KSamplerSelect(viggle 臂塌缩形无共享件)
  - 正源按形:t2i=positive(-10:1)/i2i·edit=positive_single(-10:3/-10:2)
    ——0928「少步蒸馏须单参考」域保守沿用(契约 :1387-1400 同笔)
  - σ 串=官方 model_index.json sample_sigmas+模板补终止 0(9 元素=8 步)
  - edit 速度档位 widget 四面双写 '0 · Fun-Acc 4步'→'0 · Turbo 8步'
    (宿主 widgets_values[0]/widgets_values_named/sg.widgets/内部 [7015] wv)
  - [7015] 槽名 latent_funacc→latent_turbo(inputs[].name,槽位/连线不动)
  - 组框题完整重写(edit 组以完整现题为精确锚);Note FunAcc 段换 Turbo 段
  - 新链接 id=4400+(三件 root/sg 现值均 <4400;edit root∩sg 有撞号故双空间都查)
  - 备份 .bak-1016turbo;mtime 守卫(读→写窗口内被并行役覆写即中止)
  - 禁删除任何文件;蓝图=新增件,回滚 rm 即净
"""

from __future__ import annotations

import argparse
import copy
import json
import shutil
import sys
import uuid as _uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF_DIR = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像"
BP_DIR = REPO / "apps/backend/comfyui/my_nodes/subgraphs"
CAMPAIGN = "1016turbo"

T8_CLASS = "T8QwenImage21FunAccPDD4Step"
FUNACC_FILE = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors"
TURBO_FILE = "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors"
TURBO_SIGMAS = "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"
OLD_EDIT_MODE = "0 · Fun-Acc 4步"
NEW_EDIT_MODE = "0 · Turbo 8步"
DEFAULT_MODE = "0 · Turbo 8步"

EDIT_GROUP_OLD = ("道劫·加速支路(0=原生出图[8] / 1=viggle·359步[31]→[56] / 2=Fun-Acc·4步[55];"
                  "model=[7]Cache 单源三扇入,T8 直连 base 绝不吃 LoRA;seed 单源[57]扇三支路;"
                  "汇流[59] 懒选择=未选支路零执行零加载)")
EDIT_GROUP_NEW = ("道劫·加速支路(0=Turbo·官方8步[7028]LoRA×1.0→[7029]BasicGuider cfg1→[7031]σ官方表;"
                  "1=原生出图[7010] / 2=viggle·6步[7011]→[7012];model=边界单源三扇入,"
                  "Turbo 经 Fix×0.5，绝不吃 viggle LoRA;seed 单源[7014]扇三支路;"
                  "汇流[7015] 懒选择=未选支路零执行零加载)")
T2I_GROUP_OLD_PREFIX = "道劫·加速子图·①Fun-Acc 支路"
T2I_GROUP_NEW = ("道劫·加速子图·①Turbo 支路([7028] Fix×0.5→官方LoRA×1.0→[7029]BasicGuider cfg1"
                 "→[7031] SamplerCustomAdvanced 8步官方σ([7030]ManualSigmas);不与viggle同挂;前接Fix×0.5;seed=面板单源)")
I2I_GROUP_OLD = "①Fun-Acc 支路(4步)"
I2I_GROUP_NEW = "①Turbo 支路(官方8步 cfg1)"
I2I_NOTE_MAIN_SUBS = [
    ("- **Fun-Acc 支路([7013],子图行1,combo 首项「0 · Fun-Acc 4步」=全局出厂首项)**:[7013] T8QwenImage21FunAccPDD4Step 接管采样——4步/sigmas 五值/euler/cfg1 全内置(勿外接采样器),无负面槽(负面词在该档不参与);model=[9]Cache(base)直连**绝不吃 viggle LoRA**;positive=positive_single(单参考);latent_image 与 [7010] 同源;model_file=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors(已装机 models/loras/)。实测速度(0926 三轮实弹):1024² 28.8s/2048² 130.7s(viggle 34.1/183.1,直出 214.7/1173.4)。TE 硬校验 4096 维,现产线 TE=qwen3vl_8b_bf16_heretic 已实测通过。",
     "- **Turbo 支路([7028],子图行1,combo 首项「0 · Turbo 8步」=全局出厂首项;1016turbo 换臂)**:[7028] LoraLoaderModelOnly 官方 avg_rank_178 LoRA ×1.0 直连底模(不与 viggle/Fix 同挂)→[7029] BasicGuider cfg1 纯正向无负口→[7031] SamplerCustomAdvanced+8步官方σ表([7030] ManualSigmas);model=[9]Cache(base)直连**绝不吃 viggle LoRA**;[7029].conditioning=positive_single(单参考,0928 域);latent_image 与 [7010] 同源。旧 Fun-Acc 臂(28.8s 实测)随 T8 退役;Turbo 实弹速度待证。TE 硬校验 4096 维,现产线 TE=qwen3vl_8b_bf16_heretic 已实测通过。"),
    ("加速两档(viggle/Fun-Acc)画幅恒 1.0 勿动", "加速两档(viggle/Turbo)画幅恒 1.0 勿动"),
    ("Fun-Acc 支路无负面槽。", "Turbo 支路 cfg1 负向无口。"),
    ("Fun-Acc 4 步内置于 [7013] T8;可直接手调", "Turbo 8 步=[7030] 官方σ表;可直接手调"),
    ("直出/viggle/Fun-Acc 三条完整自足支路", "直出/viggle/Turbo 三条完整自足支路"),
    ("(首项=「0 · Fun-Acc 4步」=全局出厂默认;本件默认=「2 · viggle」",
     "(首项=「0 · Turbo 8步」=全局出厂默认;本件默认=「2 · viggle」"),
    ("1014 起 viggle 支路同源多参考/Fun-Acc 仍单参考,见下节",
     "1014 起 viggle 支路同源多参考/Turbo 仍单参考(1016turbo),见下节"),
    ("- **依赖警示:Fun-Acc 需引擎装 Fun-Acc 插件(T8 节点,见设置页生态插件区 Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8)**;未装的机器选 Fun-Acc 档节点红/执行失败——降级=切「2 · viggle」或「1 · 原生出图」档。",
     "- **依赖警示:Turbo 档需官方 LoRA 文件 qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors 装机 models/loras/**;节点全为引擎核心件零插件依赖(T8 插件随 Fun-Acc 臂退役 1016turbo,文件留盘)——缺文件时降级=切「2 · viggle」或「1 · 原生出图」档。"),
    ("分工:PE=提示词优化(已在链)/LoRA=少步数加速(viggle 支路自足)/Fun-Acc=PDD 4步采样(Fun-Acc 支路自足)。",
     "分工:PE=提示词优化(已在链)/LoRA=少步数加速(viggle 支路自足)/Turbo=官方8步采样(Turbo 支路自足,1016turbo)。"),
    ("viggle·Fun-Acc 两加速档=宿主 positive_single(单参考;1014 定谳:少步×多参考=黑,双加速档恒单参考)",
     "viggle·Turbo 两加速档=宿主 positive_single(单参考;1014 定谳:少步×多参考=黑,双加速档恒单参考)"),
    ("Fun-Acc 档选中时行4 单参考编码 [171] 亦入链", "Turbo 档选中时行4 单参考编码 [171] 亦入链"),
    ("(1014 用户令(色彩严查终局):viggle 官方化(σ表+9步双段)并正源回切 positive 多参考)。",
     "(1014 用户令(色彩严查终局):viggle 官方化(σ表+9步双段)并正源回切 positive 多参考)→**1016turbo 换臂:FunAcc→官方 Turbo(档0)**。"),
    ("**加速档(viggle/Fun-Acc)=画布轻编辑**", "**加速档(viggle/Turbo)=画布轻编辑**"),
    ("**viggle 6 步与 Fun-Acc 4 步两档少步蒸馏采样一律崩纯黑**",
     "**viggle 6 步与 Fun-Acc 4 步两档少步蒸馏采样一律崩纯黑(FunAcc 时代实证)**"),
    ("单节点扇出 [7010]/[7017]/[7013] 三采(1014:viggle 支路 seed 改经 [7017] RandomNoise.noise_seed)",
     "单节点扇出 [7010]/[7017] 两采(Turbo 臂噪声共用 [7017];1014 viggle 改经 RandomNoise.noise_seed)"),
    ("消灭旧 [7010] widget 与 [7013] seed 两处分离",
     "消灭旧 [7010] widget 与旧加速臂 seed 两处分离"),
    ("**1002 用户新令推翻拉齐重放:Fun-Acc 回 combo 首项「0 · Fun-Acc 4步」**",
     "**1002 用户新令推翻拉齐重放:Fun-Acc 回 combo 首项(旧档串=台账 #26 判旧信号,活件不复制)**"),
]

# ── Note 文案替换表(内容锚;锚失中止)────────────────────────────────
T2I_NOTE_7016_SUBS = [
    ("三支路:①档0 FunAcc 无负槽=[7013] T8 一体采样 4 步;",
     "三支路:①档0 Turbo 官方8步 cfg1 负向无口=[7028 官方 avg_rank_178 LoRA×1.0 直连底模,"
     "不与 viggle/Fix 同挂]→[7029 BasicGuider cfg1 纯正向]→[7031 SamplerCustomAdvanced]"
     "+[7030 ManualSigmas 官方σ表];"),
    ("[7014] seed 单源三用;",
     "[7014] seed 单源(viggle/Turbo 共用 [7017] 噪声,直出另线);"),
]
T2I_NOTE_MAIN_SUBS = [
    ("档0 Fun-Acc 无负槽,档2 viggle 蒸馏件 cfg 恒 1 负向无效",
     "档0 Turbo cfg1 负向无口,档2 viggle 蒸馏件 cfg 恒 1 负向无效"),
    ("combo 三选一**首项=「0 · Fun-Acc 4步」=全局出厂默认;本件默认=「2 · viggle」**",
     "combo 三选一**首项=「0 · Turbo 8步」=全局出厂默认;本件默认=「2 · viggle」**"),
    ("本件默认=「2 · viggle」,随时可切;全局出厂首项=「0 · Fun-Acc 4步」",
     "本件默认=「2 · viggle」,随时可切;全局出厂首项=「0 · Turbo 8步」"),
    ("**档0=Fun-Acc**:[7013] model_file=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors(已装机 models/loras/)。实测速度(0926 三轮实弹):1024² 28.8s/2048² 130.7s(viggle 34.1/183.1,直出 214.7/1173.4)。TE 硬校验 4096 维,现产线 TE=qwen3vl_8b_bf16_heretic 已实测通过。",
     "**档0=Turbo·官方8步(1016turbo 换臂)**:[7028] LoraLoaderModelOnly 官方 avg_rank_178 LoRA ×1.0 直连底模(不与 viggle/Fix 同挂)→[7029] BasicGuider cfg1 纯正向→[7031] SamplerCustomAdvanced+8步官方σ表([7030] ManualSigmas 逐字复现官方 model_index sample_sigmas)。旧 Fun-Acc 臂(28.8s 实测)随 T8 退役;Turbo 实弹速度待证。TE 硬校验 4096 维,现产线 TE=qwen3vl_8b_bf16_heretic 已实测通过。"),
    ("**依赖警示:档0 需引擎装 Fun-Acc 插件(T8 节点,见设置页生态插件区 Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8)**;未装的机器选档0 节点红/执行失败——降级=经宿主面板「速度档位」切回 1/2 档(直出/viggle,零插件依赖)。TE-Speed 槽不加(3c 试装已死归档:插件未装=画布红节点,D4 终审永不装)。",
     "**依赖警示:档0 Turbo 需官方 LoRA 文件 qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors 装机 models/loras/**;节点全为引擎核心件(ManualSigmas/SamplerCustomAdvanced/BasicGuider)零插件依赖——T8 插件随 Fun-Acc 臂退役(1016turbo,文件留盘)。降级=经宿主面板「速度档位」切 1/2 档(直出/viggle)。"),
    ("cfg=[7010]4/[7012]1/[7013]内置(Fun-Acc cfg 内置勿外接;负向仅档1 生效,见负面线说明);**步数=各支路面板真实生效值([7010]=40 官方完整档,官方区间 40-50;[7012]=6(官方荐档)=viggle 支路;档0=Fun-Acc 4 步内置于 [7013] T8)**;",
     "cfg=[7010]4/[7012]1/[7029]1(Turbo BasicGuider 纯正向;负向仅档1 生效,见负面线说明);**步数=各支路面板真实生效值([7010]=40 官方完整档,官方区间 40-50;[7012]=6(官方荐档)=viggle 支路;档0=Turbo 8 步=[7030] 官方σ表(9元素含终止0))**;"),
    ("/档0支路=[7013] FunAcc4步(T8QwenImage21FunAccPDD4Step·4步/sigmas 五值/euler/cfg1 全内置勿外接采样器;model=[1] base 直连**绝不吃 viggle LoRA**;无负面槽)。",
     "/档0支路=[7028] Turbo8步(官方 avg_rank_178 LoRA×1.0 直连底模→[7029] BasicGuider cfg1→[7031] SamplerCustomAdvanced+[7030] 官方σ表;1016turbo 换臂;不与 viggle/Fix 同挂)。"),
    ("cfg=[7010]4/[7012]1(蒸馏件恒1)/[7013]内置;euler/simple/denoise 1 照官方",
     "cfg=[7010]4/[7012]1(蒸馏件恒1)/[7029]1(Turbo BasicGuider 纯正向);euler/simple/denoise 1 照官方(Turbo 臂=euler+官方σ表)"),
    ("如本件默认「2 · viggle」时 [7010]/[7013] 全不在执行图",
     "如本件默认「2 · viggle」时 [7010]/Turbo 臂([7028]-[7031])全不在执行图"),
]
EDIT_NOTE_MAIN_SUBS = [
    ("Fun-Acc 支路无负面槽。步数官方 40-50:直出支路 [7010]=40 官方完整档/viggle 支路 [7012]=6(官方荐档,1002 考据;原 359 系 TE-Speed 时代值)/Fun-Acc 支路 4 步内置于 [7013] T8——三支路 steps 均为面板=生效值(0929 并行化轮消灭摆设值)。",
     "Turbo 支路 cfg1 负向无口。步数官方 40-50:直出支路 [7010]=40 官方完整档/viggle 支路 [7012]=6(官方荐档,1002 考据;原 359 系 TE-Speed 时代值)/Turbo 支路 8 步=[7030] 官方σ表——三支路 steps 均为面板=生效值(0929 并行化轮消灭摆设值)。"),
    ("0=Fun-Acc·4步=[9]Cache→[7013]T8(**本件默认,须配 PE启用?=开**,见「Fun-Acc×edit 白图警示」);1=原生出图(官方完整档,1014 更名)=[9]Cache→[7010]KSampler;2=viggle 6 步=[9]Cache",
     "0=Turbo·官方8步=[9]Cache→[7028]官方LoRA→[7029]cfg1→[7031]σ官方表(**本件默认**;1016turbo 换臂);1=原生出图(官方完整档,1014 更名)=[9]Cache→[7010]KSampler;2=viggle 6 步=[9]Cache"),
    ("combo 三选一(首项=「0 · Fun-Acc 4步」居首/原生出图居二/viggle 居三);本件默认=「0 · Fun-Acc 4步」×PE启用?=开(1003 用户令改造:m1z 实测 PE开×FunAcc 真图端到端 250s vs 直出40 514s 快一倍——PE 改写把指令化为英文描述文=FunAcc 蒸馏头训练域)",
     "combo 三选一(首项=「0 · Turbo 8步」居首/原生出图居二/viggle 居三);本件默认=「0 · Turbo 8步」(1016turbo 换臂官方 Turbo LoRA;PE 关系沿 0928 单参考域待实弹)"),
    ("**Fun-Acc 支路(档0「0 · Fun-Acc 4步」)**:[7013] T8QwenImage21FunAccPDD4Step 接管采样——4步/sigmas 五值/euler/cfg1 全内置(勿外接采样器),无负面槽(负面词在该支路不参与);model_file=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors(已装机 models/loras/);model=[9] Cache 直连 base 模型(绝不吃 viggle LoRA)",
     "**Turbo 支路(档0「0 · Turbo 8步」)**:[7028] LoraLoaderModelOnly 官方 avg_rank_178 LoRA ×1.0 直连底模(不与 viggle LoRA 同挂)→[7029] BasicGuider cfg1 纯正向无负口→[7031] SamplerCustomAdvanced+8步官方σ表([7030] ManualSigmas 逐字复现官方 model_index sample_sigmas;1016turbo 换臂);model=[9] Cache 直连边界(绝不吃 viggle LoRA)"),
    ("**依赖警示:Fun-Acc 档需引擎装 Fun-Acc 插件(T8 节点,见设置页生态插件区 Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8)**;未装的机器该支路节点红/执行失败——降级=切回 1/2 档(1=原生出图/2=viggle;0=Fun-Acc 本档)。",
     "**依赖警示:Turbo 档需官方 LoRA 文件 qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors 装机 models/loras/**;节点全为引擎核心件零插件依赖(T8 插件随 Fun-Acc 臂退役 1016turbo,文件留盘)——缺 LoRA 文件时降级=切 1/2 档(1=原生出图/2=viggle)。"),
]
EDIT_NOTE_MAIN_SUBS_LONG = [
    # 白图警示整段替换(逐字锚)
    ("**Fun-Acc×edit 白图警示(1002 R2 立 F3;1003 中文域复现+定谳翻案)**:死因精确定位=**PE 关×Fun-Acc**(指令直写撞 t2i 描述文蒸馏头分布外崩溃)——两独立 seed(3008/3009 英文指令)与 1003 m2z(中文指令,33KB 全透)三发实锤全透空白图(status=success 静默坏图,同 seed 重发被节点缓存秒回);**PE启用?=开×Fun-Acc=绿**(1003 m1z 道劫中文素材真图,250s)。**用 Fun-Acc 必开 PE,关 PE 请切原生出图**;t2i/i2i 件 Fun-Acc 档不受影响。",
     "**Fun-Acc×edit 白图警示(历史账;1016turbo FunAcc 臂退役)**:死因精确定位=**PE 关×Fun-Acc**(指令直写撞 t2i 描述文蒸馏头分布外崩溃)——两独立 seed(3008/3009 英文指令)与 1003 m2z(中文指令,33KB 全透)三发实锤全透空白图(status=success 静默坏图);**PE启用?=开×Fun-Acc=绿**(1003 m1z 道劫中文素材真图,250s)。**Turbo 档(1016turbo)单参考正源沿 0928 域,PE 关系待实弹**;t2i/i2i 件 Turbo 档同待证。"),
    ("### 加速档单参考正源(0928 黑图修复;viggle/Fun-Acc 支路专用)",
     "### 加速档单参考正源(0928 黑图修复;viggle/Turbo 支路专用)"),
    ("**viggle 6 步与 Fun-Acc 4 步两档少步蒸馏采样一律崩纯黑**",
     "**viggle 6 步与 Fun-Acc 4 步两档少步蒸馏采样一律崩纯黑(FunAcc 时代实证)**"),
    ("viggle/Fun-Acc 支路 [7012]/[7013].positive=[6]装配子图.positive_single([4016] 单参考编码,仅 image_1,词源与 [4015] 同源=[4014] PE 路选择)。",
     "viggle 支路 [7012].positive 与 Turbo 链 [7029].conditioning=[6]装配子图.positive_single([4016] 单参考编码,仅 image_1,词源与 [4015] 同源=[4014] PE 路选择)。"),
    ("viggle/Fun-Acc 档时 [4016] 亦入链(多一次视觉编码,约 +20s);直出档 [4016] 懒旁路。",
     "viggle/Turbo 档时 [4016] 亦入链(多一次视觉编码,约 +20s);直出档 [4016] 懒旁路。"),
    ("加速子图宿主面板默认档=「0 · Fun-Acc 4步」(1003 用户令改造,单参考正源 [4016],须配 PE启用?=开;双参考 [4015] 归直出档)。",
     "加速子图宿主面板默认档=「0 · Turbo 8步」(1016turbo;单参考正源 [4016];双参考 [4015] 归直出档)。"),
]

FORMS = {
    "edit": {
        "path": WF_DIR / "2_图生图" / "qi21-edit.json",
        "bp": BP_DIR / "qi21-道劫-加速子图-edit.json",
        "bp_name": "道劫·加速子图(edit)",
        "pos_boundary": "positive_single",   # -10 槽名
        "turbo_noise": 7032, "turbo_select": 7033,   # edit 专属(无 viggle 共享件)
        "note_subs": (), "note_main_subs": EDIT_NOTE_MAIN_SUBS + EDIT_NOTE_MAIN_SUBS_LONG,
        "group_old": EDIT_GROUP_OLD, "group_new": EDIT_GROUP_NEW,
        "widget_rewrite": True,
    },
    "t2i": {
        "path": WF_DIR / "1_文生图" / "qi21-道劫-t2i.json",
        "bp": BP_DIR / "qi21-道劫-加速子图.json",
        "bp_name": "道劫·加速子图(t2i)",
        "pos_boundary": "positive",
        "turbo_noise": 7017, "turbo_select": 7018,   # 复用 viggle 臂
        "note_subs": T2I_NOTE_7016_SUBS, "note_main_subs": T2I_NOTE_MAIN_SUBS,
        "group_old": None, "group_new": T2I_GROUP_NEW,   # 前缀锚
        "widget_rewrite": False,
    },
    "i2i": {
        "path": WF_DIR / "2_图生图" / "qi21-道劫-i2i.json",
        "bp": BP_DIR / "qi21-道劫-加速子图-i2i.json",
        "bp_name": "道劫·加速子图(i2i)",
        "pos_boundary": "positive_single",
        "turbo_noise": 7017, "turbo_select": 7018,
        "note_subs": (), "note_main_subs": I2I_NOTE_MAIN_SUBS,   # i2i 主图 Note 镜像(named.text)单段
        "group_old": I2I_GROUP_OLD, "group_new": I2I_GROUP_NEW,
        "widget_rewrite": False,
    },
}


def fail(msg: str) -> None:
    print(f"[{CAMPAIGN}] FAIL: {msg}")
    sys.exit(1)


def _ue_props(ntype: str, cnr: bool = False) -> dict:
    props = {"Node name for S&R": ntype,
             "ue_properties": {"widget_ue_connectable": {}, "version": "7.8",
                               "input_ue_unconnectable": {}}}
    if cnr:
        props["cnr_id"] = "comfy-core"
    return props


def _in(name: str, typ: str, ln: int | None, loc: str, widget: bool = False, shape: int | None = None):
    d: dict = {"name": name, "type": typ}
    if loc:
        d["localized_name"] = loc
    if widget:
        d["widget"] = {"name": name}
    if shape is not None:
        d["shape"] = shape
    d["link"] = ln
    return d


def _out(name: str, typ: str, links: list, loc: str):
    return {"localized_name": loc, "name": name, "type": typ, "links": links}


def _mk_link(lid: int, o: int, os_: int, t: int, ts: int, typ: str) -> dict:
    return {"id": lid, "origin_id": o, "origin_slot": os_,
            "target_id": t, "target_slot": ts, "type": typ}


def _rewrite_notes(tag: str, doc: dict, cfg: dict, nodes: dict | None = None) -> bool:
    """Note 卡文替换(widgets_values 与 widgets_values_named 镜像同笔;幂等:
    已换过的锚 replace no-op)。返回是否有字节级变更。"""
    changed = False
    subs = list(cfg["note_subs"])
    main_subs = list(cfg["note_main_subs"])
    _, sg = _sg_of(doc)
    sg_nodes = {n["id"]: n for n in sg["nodes"]}

    def _apply(node: dict, table: list, holder: str) -> None:
        nonlocal changed
        texts: list[str] = []
        wv = node.get("widgets_values")
        if isinstance(wv, list) and wv and isinstance(wv[0], str):
            texts.append("wv")
        named = node.get("widgets_values_named")
        if isinstance(named, dict):
            texts += [k for k, v in named.items() if isinstance(v, str)]
        if not texts:
            return
        probe = ""
        if "wv" in texts:
            probe += node["widgets_values"][0]
        for k in texts:
            if k != "wv":
                probe += "\n" + node["widgets_values_named"][k]
        hits = [s for s in table if s[0] in probe]
        for old, new in hits:
            if "wv" in texts:
                node["widgets_values"][0] = node["widgets_values"][0].replace(old, new)
            for k in texts:
                if k != "wv":
                    node["widgets_values_named"][k] = \
                        node["widgets_values_named"][k].replace(old, new)
            changed = True

    if subs:
        note = sg_nodes.get(7016)
        if note is not None:
            _apply(note, subs, "子图[7016]")
    if main_subs:
        for n in doc["nodes"]:
            if n["type"] == "MarkdownNote":
                _apply(n, main_subs, f"主图[{n['id']}]")
    return changed


def _sg_of(doc: dict) -> tuple[dict, dict]:
    host = next((n for n in doc["nodes"] if n.get("id") == 7), None)
    if host is None:
        fail("宿主 [7] 不在场")
    sgid = host.get("properties", {}).get("subgraph")
    sg = next((s for s in doc["definitions"]["subgraphs"] if s["id"] == sgid), None)
    if sg is None:
        fail("加速子图定义不在场")
    return host, sg


def _set_default_turbo(doc: dict) -> bool:
    """同步宿主、子图和选择件的速度默认；运行值只由这四个镜像承载。"""
    host, sg = _sg_of(doc)
    nodes = {n["id"]: n for n in sg["nodes"]}
    sel = nodes[7015]
    changed = False
    for values in (host.get("widgets_values"), sg.get("widgets"), sel.get("widgets_values")):
        if isinstance(values, list) and values and values[0] != DEFAULT_MODE:
            values[0] = DEFAULT_MODE
            changed = True
    for values, key in ((host.get("widgets_values_named"), "速度档位"),
                        (sel.get("widgets_values_named"), "mode")):
        if isinstance(values, dict) and values.get(key) != DEFAULT_MODE:
            values[key] = DEFAULT_MODE
            changed = True
    for node in doc["nodes"]:
        if node.get("type") != "MarkdownNote":
            continue
        for field in ("widgets_values",):
            values = node.get(field)
            if isinstance(values, list) and values and isinstance(values[0], str):
                updated = values[0].replace("本件默认=「2 · viggle」", "本件默认=「0 · Turbo 8步」")
                if updated != values[0]:
                    values[0] = updated
                    changed = True
        named = node.get("widgets_values_named")
        if isinstance(named, dict) and isinstance(named.get("text"), str):
            updated = named["text"].replace("本件默认=「2 · viggle」", "本件默认=「0 · Turbo 8步」")
            if updated != named["text"]:
                named["text"] = updated
                changed = True
    return changed


def _b_idx(sg: dict) -> dict:
    return {i["name"]: k for k, i in enumerate(sg["inputs"])}


def _t8_lines(sg: dict) -> list[dict]:
    return [l for l in sg["links"] if l["target_id"] == 7013 or l["origin_id"] == 7013]


def _verify_pre(tag: str, doc: dict, cfg: dict) -> None:
    host, sg = _sg_of(doc)
    nodes = {n["id"]: n for n in sg["nodes"]}
    if 7013 not in nodes or nodes[7013]["type"] != T8_CLASS:
        fail(f"{tag}: [7013] 不在场或非 {T8_CLASS}(术前锚失)")
    if nodes[7013]["widgets_values"][0] != FUNACC_FILE:
        fail(f"{tag}: [7013] model_file 非预期")
    lines = _t8_lines(sg)
    if len(lines) != 5:
        fail(f"{tag}: 7013 关联线应恰 5 条,得 {len(lines)}: {[l['id'] for l in lines]}")
    sel = nodes[7015]
    if not any(i.get("name") == "latent_funacc" for i in sel["inputs"]):
        fail(f"{tag}: [7015] 槽 latent_funacc 不在场(术前锚失)")
    if cfg["widget_rewrite"]:
        four = (host["widgets_values"][0],
                host.get("widgets_values_named", {}).get("速度档位"),
                sg.get("widgets", [None])[0],
                sel["widgets_values"][0])
        if four != (OLD_EDIT_MODE,) * 4:
            fail(f"{tag}: edit 四面 widget 非 {OLD_EDIT_MODE!r},得 {four!r}")
    else:
        if host["widgets_values"][0] != HOST_WV_VIGGLE:
            fail(f"{tag}: 宿主档位非 {HOST_WV_VIGGLE!r}(本役零触碰锚)")
    for sub in cfg["note_subs"]:
        note = nodes.get(7016)
        if note is None or sub[0] not in note["widgets_values"][0]:
            fail(f"{tag}: 子图 Note 锚失: {sub[0][:40]!r}")
    if cfg["note_main_subs"]:
        main_txts = [n["widgets_values"][0] for n in doc["nodes"]
                     if n["type"] == "MarkdownNote" and isinstance(n.get("widgets_values"), list)]
        joined = "\n".join(main_txts)
        missing = [s[0] for s in cfg["note_main_subs"] if s[0] not in joined]
        if missing:
            fail(f"{tag}: 主图 Note 替换锚失 {len(missing)} 条: {missing[0][:50]!r}")
    # 组框锚
    titles = [g.get("title", "") for g in sg.get("groups", [])]
    if cfg["group_old"] is not None:
        if cfg["group_old"] not in titles:
            fail(f"{tag}: 组框精确锚失(旧题不在): {cfg['group_old'][:50]!r}")
    elif tag == "t2i":
        if not any(t.startswith(T2I_GROUP_OLD_PREFIX) for t in titles):
            fail("t2i: 组①前缀锚失(①Fun-Acc 支路)")


def ensure_fix_turbo_route(doc: dict) -> bool:
    _host, sg = _sg_of(doc)
    before = json.dumps(doc, sort_keys=True)
    nodes = {node['id']: node for node in sg['nodes']}
    links = {link['id']: link for link in sg['links']}
    turbo = nodes[7028]
    turbo_input = next(slot for slot in turbo['inputs'] if slot['name'] == 'model')
    turbo_link = links[turbo_input['link']]
    boundary_slot = next(index for index, slot in enumerate(sg['inputs']) if slot['name'] == 'model')
    boundary = sg['inputs'][boundary_slot]
    if 7027 not in nodes:
        link_id = max([link['id'] for link in sg['links']] + [link[0] for link in doc.get('links', [])]) + 1
        fix = copy.deepcopy(turbo)
        fix.update(id=7027, pos=[1000, 140], order=max(node.get('order', 0) for node in sg['nodes']) + 1)
        fix['inputs'][0]['link'] = link_id
        fix['outputs'][0]['links'] = [turbo_link['id']]
        fix['widgets_values'] = ['qwen2.1-detail-fix-2.0.safetensors', 0.5]
        fix['widgets_values_named'] = {'lora_name': fix['widgets_values'][0], 'strength_model': 0.5}
        sg['nodes'].append(fix)
        nodes[7027] = fix
        sg['links'].append(_mk_link(link_id, -10, boundary_slot, 7027, 0, 'MODEL'))
        boundary['linkIds'].append(link_id)
        sg.setdefault('state', {})['lastLinkId'] = link_id
    fix = nodes[7027]
    if fix['widgets_values'] != ['qwen2.1-detail-fix-2.0.safetensors', 0.5]:
        fail('Fix 7027 dependency/strength drift; refusing to overwrite custom parameters')
    if turbo_link['origin_id'] not in (-10, 7027):
        fail('Turbo model has unexpected upstream; refusing concurrent/custom topology')
    turbo_link.update(origin_id=7027, origin_slot=0)
    if turbo_link['id'] in boundary['linkIds']:
        boundary['linkIds'].remove(turbo_link['id'])
    if turbo_link['id'] not in fix['outputs'][0]['links']:
        fix['outputs'][0]['links'].append(turbo_link['id'])
    consumers = {link['target_id'] for link in sg['links'] if link['origin_id'] == 7027}
    fix['title'] = '[7027] Fix v2.0·Turbo+viggle×0.5' if 7011 in consumers else '[7027] Fix v2.0·Turbo×0.5'
    turbo['title'] = '[7028] Turbo·官方avg_rank_178(Fix×0.5)'
    if 7011 not in consumers:
        for group in sg.get('groups', []):
            if 'Turbo' in group.get('title', ''):
                left, top, width, height = group['bounding']
                new_left = min(left, fix['pos'][0] - 40)
                group['bounding'] = [new_left, top, left + width - new_left, height]
    for group in sg.get('groups', []):
        group['title'] = group.get('title', '').replace('Turbo 直连底模绝不吃 viggle/Fix LoRA', 'Turbo 经 Fix×0.5，绝不吃 viggle LoRA').replace('官方LoRA×1.0 直连底模', 'Fix×0.5→官方LoRA×1.0').replace('不与viggle/Fix同挂', '不与viggle同挂;前接Fix×0.5')
    replacements = (
        ('LoRA ×1.0 直连底模(不与 viggle/Fix 同挂)', 'LoRA ×1.0 前接 Fix×0.5(不与 viggle 同挂)'),
        ('LoRA×1.0 直连底模,不与 viggle/Fix 同挂', 'LoRA×1.0 前接 Fix×0.5,不与 viggle 同挂'),
        ('model=[9]Cache(base)直连**绝不吃 viggle LoRA**', 'model=[9]Cache(base)→[7027]Fix×0.5→[7028]Turbo，**绝不吃 viggle LoRA**'),
        ('本件默认=「2 · viggle」', '本件默认=「0 · Turbo 8步」'),
    )
    for node in doc['nodes'] + sg['nodes']:
        if node['type'] not in ('Note', 'MarkdownNote'):
            continue
        values = node.get('widgets_values', [])
        named = node.get('widgets_values_named', {})
        for old, new in replacements:
            for index, value in enumerate(values):
                if isinstance(value, str):
                    values[index] = value.replace(old, new)
            for key, value in named.items():
                if isinstance(value, str):
                    named[key] = value.replace(old, new)
    doc['last_link_id'] = max(doc.get('last_link_id', 0), max(link['id'] for link in sg['links']))
    return before != json.dumps(doc, sort_keys=True)


def _verify_post(tag: str, doc: dict, cfg: dict) -> None:
    host, sg = _sg_of(doc)
    nodes = {n["id"]: n for n in sg["nodes"]}
    if 7013 in nodes:
        fail(f"{tag}: [7013] 仍在场(术后应移除)")
    if _t8_lines(sg):
        fail(f"{tag}: 7013 残线在场")
    for nid in (7028, 7029, 7030, 7031):
        if nid not in nodes:
            fail(f"{tag}: [{nid}] 缺席")
    if tag == "edit" and not ({7017, 7018} <= set(nodes)):
        fail(f"{tag}: edit Turbo 共用 [7017]/[7018] 缺席")
    want_types = {7028: "LoraLoaderModelOnly", 7029: "BasicGuider",
                  7030: "ManualSigmas", 7031: "SamplerCustomAdvanced",
                  7032: "RandomNoise", 7033: "KSamplerSelect"}
    for nid, t in want_types.items():
        if nid in nodes and nodes[nid]["type"] != t:
            fail(f"{tag}: [{nid}] type 应 {t},得 {nodes[nid]['type']}")
    if nodes[7028]["widgets_values"] != [TURBO_FILE, 1.0]:
        fail(f"{tag}: [7028] wv 应 [{TURBO_FILE!r}, 1.0]")
    links = {link['id']: link for link in sg['links']}
    turbo_input = next(slot for slot in nodes[7028]['inputs'] if slot['name'] == 'model')
    if 7027 not in nodes or links[turbo_input['link']]['origin_id'] != 7027:
        fail(f'{tag}: Turbo must use base→Fix0.5→official Turbo1.0')
    if nodes[7030]["widgets_values"] != [TURBO_SIGMAS]:
        fail(f"{tag}: [7030] σ串漂移")
    sel = nodes[7015]
    if any(i.get("name") == "latent_funacc" for i in sel["inputs"]):
        fail(f"{tag}: [7015] 槽 latent_funacc 残留")
    tr = next((i for i in sel["inputs"] if i.get("name") == "latent_turbo"), None)
    if tr is None or tr.get("link") is None:
        fail(f"{tag}: [7015] latent_turbo 槽未接线")
    # seed 扇出
    seed_out = nodes[7014]["outputs"][0]["links"]
    tgts = sorted((l["target_id"], l["target_slot"]) for l in sg["links"] if l["id"] in seed_out)
    if tag == "edit" and 7032 in nodes:
        want = sorted([(7010, 4), (7012, 4), (7032, 0)])
    else:
        want = sorted([(7010, 4), (7017, 0)])
    if tgts != want:
        fail(f"{tag}: seed 扇出 {tgts} != {want}")
    # 组框新题
    titles = [g.get("title", "") for g in sg.get("groups", [])]
    if not any('Turbo' in title for title in titles):
        fail(f"{tag}: 组框新题不在场")
    if tag == "edit":
        four = (host["widgets_values"][0],
                host.get("widgets_values_named", {}).get("速度档位"),
                sg.get("widgets", [None])[0],
                sel["widgets_values"][0])
        if four != (NEW_EDIT_MODE,) * 4:
            fail(f"{tag}: edit 四面 widget 非 {NEW_EDIT_MODE!r},得 {four!r}")
    else:
        four = (host["widgets_values"][0], host.get("widgets_values_named", {}).get("速度档位"),
                sg.get("widgets", [None])[0], sel["widgets_values"][0])
        if four != (DEFAULT_MODE,) * 4:
            fail(f"{tag}: Turbo 默认四面漂移 {four!r}")
    blob = json.dumps(doc, ensure_ascii=False)
    if T8_CLASS in blob or FUNACC_FILE in blob:
        fail(f"{tag}: 术后全文件仍含 T8 类名/文件名残串(Note 镜像未清)")
    if "[7013]" in blob:
        fail(f"{tag}: 术后全文件仍含 [7013] 档位残文(现在时机制文须改指 [7028]-[7031];"
             "历史沿革叙述不得以「[7013]」字面点名——终审 1016turbo.r2 拦截面)")


def _already(tag: str, doc: dict) -> bool:
    _, sg = _sg_of(doc)
    return any(n["id"] == 7028 for n in sg["nodes"])


def _serialize(doc: dict, path: Path, had_trailing_nl: bool) -> bytes:
    s = json.dumps(doc, ensure_ascii=False, indent=2)
    if had_trailing_nl:
        s += "\n"
    return s.encode("utf-8")


def _build_turbo(tag: str, doc: dict, cfg: dict) -> None:
    host, sg = _sg_of(doc)
    nodes = {n["id"]: n for n in sg["nodes"]}
    bidx = _b_idx(sg)
    # 链接 id 冲突面=子图+根图双空间(edit 有撞号先例)
    used = {l["id"] for l in sg["links"]} | {l[0] for l in doc["links"]}
    L = {k: v for k, v in (("model", 4400), ("pos", 4401), ("latent", 4402),
                           ("lora_out", 4403), ("guider_out", 4404),
                           ("noise", 4405), ("sampler", 4406), ("sigmas", 4407),
                           ("sca_out", 4408), ("seed_noise", 4409))}
    for k, v in L.items():
        if v in used:
            fail(f"{tag}: 新链接 id {v} 冲突")
    # ── 移除 7013+五线 ──
    t8_lines = _t8_lines(sg)
    t8_ids = [l["id"] for l in t8_lines]
    sg["links"] = [l for l in sg["links"] if l not in t8_lines]
    del nodes[7013]
    sg["nodes"] = [n for n in sg["nodes"] if n["id"] != 7013]
    # 7014 出线摘 7013
    p7014 = nodes[7014]
    p7014["outputs"][0]["links"] = [x for x in p7014["outputs"][0]["links"] if x not in t8_ids]
    # 边界槽 linkIds 摘 7013 线
    for inp in sg["inputs"]:
        inp["linkIds"] = [x for x in inp.get("linkIds", []) if x not in t8_ids]

    # ── 7015 槽改名+换接线 ──
    sel = nodes[7015]
    sel_slot = next(i for i in sel["inputs"] if i.get("name") == "latent_funacc")
    sel_slot["name"] = "latent_turbo"
    sel_slot["localized_name"] = "latent_turbo"
    sel_slot["link"] = L["sca_out"]

    # ── 新节点 ──
    pos0 = [1400, 140]
    n7028 = {"id": 7028, "type": "LoraLoaderModelOnly", "pos": list(pos0), "size": [270, 130],
             "flags": {}, "order": 20, "mode": 0,
             "inputs": [_in("model", "MODEL", L["model"], "模型")],
             "outputs": [_out("MODEL", "MODEL", [L["lora_out"]], "模型")],
             "title": "[7028] Turbo·官方avg_rank_178(Fix×0.5)",
             "properties": _ue_props("LoraLoaderModelOnly"),
             "widgets_values": [TURBO_FILE, 1.0],
             "widgets_values_named": {"lora_name": TURBO_FILE, "strength_model": 1.0}}
    n7029 = {"id": 7029, "type": "BasicGuider", "pos": [pos0[0], pos0[1] + 190], "size": [270, 110],
             "flags": {}, "order": 21, "mode": 0,
             "inputs": [_in("model", "MODEL", L["lora_out"], "模型"),
                        _in("conditioning", "CONDITIONING", L["pos"], "条件")],
             "outputs": [_out("GUIDER", "GUIDER", [L["guider_out"]], "引导")],
             "title": "[7029] cfg1引导·BasicGuider(Turbo纯正向)",
             "properties": _ue_props("BasicGuider", cnr=True),
             "widgets_values": [], "widgets_values_named": {}}
    n7030 = {"id": 7030, "type": "ManualSigmas", "pos": [pos0[0], pos0[1] + 380], "size": [270, 100],
             "flags": {}, "order": 22, "mode": 0, "inputs": [],
             "outputs": [_out("SIGMAS", "SIGMAS", [L["sigmas"]], "Sigmas")],
             "title": "[7030] 官方8步σ·ManualSigmas",
             "properties": _ue_props("ManualSigmas", cnr=True),
             "widgets_values": [TURBO_SIGMAS], "widgets_values_named": {"sigmas": TURBO_SIGMAS}}
    n7031 = {"id": 7031, "type": "SamplerCustomAdvanced", "pos": [pos0[0], pos0[1] + 570], "size": [330, 200],
             "flags": {}, "order": 23, "mode": 0,
             "inputs": [_in("noise", "NOISE", L["noise"], "噪声"),
                        _in("guider", "GUIDER", L["guider_out"], "引导"),
                        _in("sampler", "SAMPLER", L["sampler"], "采样器"),
                        _in("sigmas", "SIGMAS", L["sigmas"], "Sigmas"),
                        _in("latent_image", "LATENT", L["latent"], "Latent图像")],
             "outputs": [_out("output", "LATENT", [L["sca_out"]], "输出"),
                         _out("denoised_output", "LATENT", [], "去噪输出")],
             "title": "[7031] Turbo8步·SamplerCustom",
             "properties": _ue_props("SamplerCustomAdvanced", cnr=True),
             "widgets_values": [], "widgets_values_named": {}}
    new_nodes = [n7028, n7029, n7030, n7031]
    if tag == "edit":
        n7032 = {"id": 7032, "type": "RandomNoise", "pos": [1000, 140], "size": [270, 90],
                 "flags": {}, "order": 24, "mode": 0,
                 "inputs": [_in("noise_seed", "INT", L["seed_noise"], "随机种子", widget=True)],
                 "outputs": [_out("NOISE", "NOISE", [L["noise"]], "噪声")],
                 "title": "[7032] Turbo噪声·RandomNoise",
                 "properties": _ue_props("RandomNoise", cnr=True),
                 "widgets_values": [0, "fixed"],
                 "widgets_values_named": {"noise_seed": 0, "control_after_generate": "fixed"}}
        n7033 = {"id": 7033, "type": "KSamplerSelect", "pos": [1000, 330], "size": [270, 60],
                 "flags": {}, "order": 25, "mode": 0, "inputs": [],
                 "outputs": [_out("SAMPLER", "SAMPLER", [L["sampler"]], "采样器")],
                 "title": "[7033] euler·KSamplerSelect(Turbo)",
                 "properties": _ue_props("KSamplerSelect", cnr=True),
                 "widgets_values": ["euler"], "widgets_values_named": {"sampler_name": "euler"}}
        new_nodes += [n7032, n7033]
    sg["nodes"].extend(new_nodes)

    # ── 新链接 ──
    pos_slot = bidx[cfg["pos_boundary"]]
    lat_slot = bidx["latent"]
    new_links = [
        _mk_link(L["model"], -10, bidx["model"], 7028, 0, "MODEL"),
        _mk_link(L["pos"], -10, pos_slot, 7029, 1, "CONDITIONING"),
        _mk_link(L["latent"], -10, lat_slot, 7031, 4, "LATENT"),
        _mk_link(L["lora_out"], 7028, 0, 7029, 0, "MODEL"),
        _mk_link(L["guider_out"], 7029, 0, 7031, 1, "GUIDER"),
        _mk_link(L["noise"], cfg["turbo_noise"], 0, 7031, 0, "NOISE"),
        _mk_link(L["sampler"], cfg["turbo_select"], 0, 7031, 2, "SAMPLER"),
        _mk_link(L["sigmas"], 7030, 0, 7031, 3, "SIGMAS"),
        _mk_link(L["sca_out"], 7031, 0, 7015, sel["inputs"].index(sel_slot), "LATENT"),
    ]
    if tag == "edit":
        new_links.append(_mk_link(L["seed_noise"], 7014, 0, 7032, 0, "INT"))
    sg["links"].extend(new_links)

    # ── 共享件出线/seed 扇出 ──
    if tag != "edit":
        nodes[7017]["outputs"][0]["links"].append(L["noise"])
        nodes[7018]["outputs"][0]["links"].append(L["sampler"])
    else:
        p7014["outputs"][0]["links"].append(L["seed_noise"])
    # 边界槽 linkIds 增新线
    for inp in sg["inputs"]:
        if inp["name"] == "model":
            inp["linkIds"].append(L["model"])
        elif inp["name"] == cfg["pos_boundary"]:
            inp["linkIds"].append(L["pos"])
        elif inp["name"] == "latent":
            inp["linkIds"].append(L["latent"])

    # ── widget 四面(edit)──
    if cfg["widget_rewrite"]:
        host["widgets_values"][0] = NEW_EDIT_MODE
        host["widgets_values_named"]["速度档位"] = NEW_EDIT_MODE
        sg["widgets"][0] = NEW_EDIT_MODE
        sel["widgets_values"][0] = NEW_EDIT_MODE

    # ── 组框 ──
    for g in sg.get("groups", []):
        if cfg["group_old"] is not None and g.get("title") == cfg["group_old"]:
            g["title"] = cfg["group_new"]
        elif tag == "t2i" and str(g.get("title", "")).startswith(T2I_GROUP_OLD_PREFIX):
            g["title"] = cfg["group_new"]
            g["bounding"] = [1340, 80, 560, 850]   # 4 节点纵排随扩
        elif tag == "i2i" and g.get("title") == I2I_GROUP_OLD:
            g["title"] = cfg["group_new"]
            g["bounding"] = [1340, 80, 560, 850]

    # ── Note(子图 7016 + 主图 MarkdownNote;widgets_values 与
    #    widgets_values_named.text 双镜像同笔替换)──
    changed = _rewrite_notes(tag, doc, cfg, nodes)

    # ── 计数器 ──
    st = sg.setdefault("state", {})
    st["lastNodeId"] = max(st.get("lastNodeId") or 0, 7033)
    st["lastLinkId"] = max(st.get("lastLinkId") or 0, 4409)
    doc["last_link_id"] = max(doc.get("last_link_id") or 0, 4409)
    ensure_fix_turbo_route(doc)


# ── 蓝图抽取(决策①:v0.4 单根形,sg.id=宿主 uuid;--check canonical 除 id)──
def _canon_no_id(sg: dict) -> str:
    return json.dumps({k: v for k, v in sg.items() if k != "id"},
                      ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _extract_blueprint(tag: str, doc: dict, cfg: dict) -> dict:
    host, sg = _sg_of(doc)
    sg_uuid = host["properties"]["subgraph"]
    root_in = []
    for i in sg["inputs"]:
        ent: dict = {"name": i["name"], "type": i["type"]}
        if i["type"] in ("COMBO", "INT", "STRING", "FLOAT", "BOOLEAN"):
            ent["widget"] = {"name": i["name"]}
        ent["link"] = None
        root_in.append(ent)
    root_out = [{"name": o["name"], "type": o["type"], "links": []} for o in sg["outputs"]]
    root_node = {"id": 1, "type": sg_uuid, "pos": [0, 0], "size": [560, 520],
                 "flags": {}, "order": 0, "mode": 0,
                 "properties": {"subgraph": sg_uuid, "previewExposures": []},
                 "inputs": root_in, "outputs": root_out,
                 "widgets_values": copy.deepcopy(host.get("widgets_values")),
                 "title": host.get("title"),
                 "widgets_values_named": copy.deepcopy(host.get("widgets_values_named", {}))}
    sg_def = copy.deepcopy(sg)
    sg_def["category"] = "漫影"
    return {"revision": 1, "last_node_id": 1, "last_link_id": 0,
            "nodes": [root_node], "links": [], "version": 0.4,
            "info": {"category": "漫影", "name": cfg["bp_name"]},
            "definitions": {"subgraphs": [sg_def]}}


# ── 主流程 ──
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只读验锚+蓝图 canonical 对比")
    ap.add_argument("--sync-home", action="store_true",
                    help="同步装机 Resources+引擎家(不含用户区)")
    args = ap.parse_args()

    order = ["edit", "t2i", "i2i"]
    state = {}
    for tag in order:
        cfg = FORMS[tag]
        path: Path = cfg["path"]
        if not path.exists():
            fail(f"{tag}: 文件不存在 {path}")
        raw = path.read_bytes()
        mtime0 = path.stat().st_mtime
        doc = json.loads(raw)
        had_nl = raw.endswith(b"\n")
        _sg_of(doc)  # 结构可寻
        done = _already(tag, doc)
        if args.check:
            (_verify_post if done else _verify_pre)(tag, doc, cfg)
            # 蓝图 canonical-除-id 对比(蓝图 sg 加 category 键后归一)
            bp_path: Path = cfg["bp"]
            if not done:
                if bp_path.exists():
                    fail(f"{tag}: 未施态但蓝图已在场(先跑手术)")
            else:
                if not bp_path.exists():
                    fail(f"{tag}: 已施态但蓝图缺席")
                bp = json.loads(bp_path.read_text(encoding="utf-8"))
                wf_sg = _sg_of(doc)[1]
                bp_sg = bp["definitions"]["subgraphs"][0]
                wf_norm = copy.deepcopy(wf_sg); wf_norm["category"] = "漫影"
                if _canon_no_id(wf_norm) != _canon_no_id(bp_sg):
                    fail(f"{tag}: 蓝图↔宿主 canonical(除 id)漂移——请重跑本脚本抽取")
                # 根节点 widget 面
                host = _sg_of(doc)[0]
                if bp["nodes"][0]["widgets_values"] != host.get("widgets_values"):
                    fail(f"{tag}: 蓝图根 widget 与宿主漂移")
            state[tag] = "post" if done else "pre"
            print(f"[{CAMPAIGN}] check {tag}: {'已施(术后锚过+蓝图一致)' if done else '未施(术前锚过)'}")
            continue
        if args.sync_home:
            continue
        # ── 默认=手术 ──
        if done:
            changed = _set_default_turbo(doc)
            changed = _rewrite_notes(tag, doc, cfg) or changed  # Note 镜像补刀(幂等,先于 verify)
            changed = ensure_fix_turbo_route(doc) or changed
            _verify_post(tag, doc, cfg)
            bp = _extract_blueprint(tag, doc, cfg)
            _write_atomic(cfg["bp"], bp)
            if changed:
                if path.stat().st_mtime != mtime0:
                    fail(f"{tag}: mtime 守卫触发(读→写窗口内被并行役改动),中止")
                tmp = path.with_name(path.name + ".tmp-" + CAMPAIGN)
                tmp.write_bytes(_serialize(doc, path, had_nl))
                tmp.replace(path)
                print(f"[{CAMPAIGN}] {tag}: 已施态——验术后锚+Note 镜像补刀写回+蓝图重抽")
            else:
                print(f"[{CAMPAIGN}] {tag}: 已施态——验术后锚过+蓝图重抽(noop 幂等)")
            continue
        _verify_pre(tag, doc, cfg)
        _build_turbo(tag, doc, cfg)
        _verify_post(tag, doc, cfg)
        if path.stat().st_mtime != mtime0:
            fail(f"{tag}: mtime 守卫触发(读→写窗口内被并行役改动),中止")
        bak = path.with_name(path.name + f".bak-{CAMPAIGN}")
        if not bak.exists():
            shutil.copy2(path, bak)
        tmp = path.with_name(path.name + ".tmp-" + CAMPAIGN)
        tmp.write_bytes(_serialize(doc, path, had_nl))
        tmp.replace(path)
        bp = _extract_blueprint(tag, doc, cfg)
        _write_atomic(cfg["bp"], bp)
        print(f"[{CAMPAIGN}] {tag}: 手术完成(移除 7013+5线;增 7028-7031"
              f"{'/7032/7033' if tag == 'edit' else ''};蓝图 {cfg['bp'].name})")
    if args.check:
        return

    if args.sync_home:
        app_res = (REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app"
                   "/Contents/Resources/backend/comfyui")
        engine_home = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI")
        py_files = [
            REPO / "apps/backend/comfyui/my_nodes/nodes/my_qi21_speed_select.py",
            REPO / "apps/backend/comfyui/my_nodes/__init__.py",
            REPO / "apps/backend/comfyui/my_nodes/nodes/my_qi21_rgba_select.py",
        ]
        targets = []
        for tag in order:
            cfg = FORMS[tag]
            rel_wf = cfg["path"].relative_to(REPO / "apps/backend/comfyui")
            rel_bp = cfg["bp"].relative_to(REPO / "apps/backend/comfyui")
            # 引擎家用户区(ComfyUI/user/default/workflows)恒不同步——placement_audit
            # 「会话恒零写入」策略面;用户区 5 件陈旧属已知容忍面(裁决 1016turbo)
            targets.append((cfg["path"], app_res / rel_wf))
            targets.append((cfg["bp"], app_res / rel_bp))
            targets.append((cfg["bp"], engine_home / "custom_nodes" / "my-nodes" / "subgraphs" / cfg["bp"].name))
        for f in py_files:
            rel = f.relative_to(REPO / "apps/backend/comfyui")
            targets.append((f, app_res / rel))
            targets.append((f, engine_home / "custom_nodes" / "my-nodes" / rel.relative_to("my_nodes")))
        n = 0
        for src, dst in targets:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if dst.exists():
                bakd = dst.with_name(dst.name + f".bak-{CAMPAIGN}")
                if not bakd.exists():
                    shutil.copy2(dst, bakd)
            shutil.copy2(src, dst)
            n += 1
            print(f"[{CAMPAIGN}] sync {dst}")
        print(f"[{CAMPAIGN}] --sync-home 完成:{n} 件(不含引擎家用户区 ComfyUI/user/default/workflows)")
        return

    print(f"[{CAMPAIGN}] 手术+蓝图抽取全部完成")


def _write_atomic(p: Path, obj: dict) -> None:
    tmp = p.with_name(p.name + ".tmp-" + CAMPAIGN)
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(p)


if __name__ == "__main__":
    main()
