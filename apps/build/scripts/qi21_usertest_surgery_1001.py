#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21-道劫-t2i 用户测试批手术(2026-10-01,Trellis 10-01-qi21-usetest-batch
implement.md P2 步骤 6 / design §3 映射全表一把)。

范围铁律:只动 qi21-道劫-t2i.json(+t2i 蓝图随役刷新);i2i/edit 工作流零动;
共享件已在 P1 向后兼容升级(底座第六出/WhSuggest 手填槽/装配器文案),本轮零碰 python。

手术映射(design §3 全表):
  ④⑥⑦ [210] MyQi21RgbaSelect 三态件退役;-10「RGBA透明」COMBO→「透明」BOOLEAN
       (Q4 裁定,default false);面板透明布尔→[150].透明覆盖(optional 尾部入);
       装配器[152].透明模式 与 [144].switch ← [150].透明值(第六出)——子图内零
       选择层,跟随型解析住底座件(数据同源),纯 BOOLEAN 跨子图边界(⑦)。
  ②   -10「画幅联动开关」槽退役;新 -10「手动宽」「手动高」INT(0=跟型);
       [151].联动开关 ← -10「PE开关」扇出(pe开=建议路/pe关=手动/九型路,件零改);
       手填槽接 -10 两新槽。
  ③   两子图 groups=[]。
  ⑤   装配子图全节点 title 瘦身(机制注记迁 [10] 速查卡):
       [150]底座九选一/[141]装配全文件/[152]最终文本合成器/[151]画幅建议器/
       [140]PE改写(prd⑤ 钦定带号)/[142]主编码/[143]RGBA编码/[144]输出选择。
  ⑧   加速子图 title 带区分度短名(prd⑧ 钦定带号):
       [7]直出40步/[206]viggle359步/[198]FunAcc4步/[31]viggle LoRA/
       [207]seed 单源;[214]「出图速度选择」不动。
  ⑨   加速子图横向重排:出入口同横轴 y≈500;三支路三横线(y≈150 直出/
       y≈500 FunAcc 中轴顺路/y≈850 viggle);每条左→右=入口→支路件→[214]
       汇流→出口;[207] 就主轴左端(喂三支路全右向);零左向线。
  面板  宿主 widgets_values/sg.widgets/widgets_values_named 镜像重排
       (Q3 序:主体句→型选择→PE开关→透明→手动宽→手动高);[10] 速查卡重写
       (画幅/透明大白话+迁入注记);主图组框③ 面板清单句随改。
  蓝图  t2i 蓝图(qi21-提示词类型优化子图.json)随役从术后工作流重建
       (extract 同款构造;蓝图 id 恒 c3f81b56 分轨,根节点=宿主投影)。

新接线白名单(显式列名,恰 3 条):
  link68 [151].联动开关 ← -10槽4 PE开关扇出(问题②:pe开=建议路)
  link69 [151].手动宽   ← -10槽6 手动宽(问题②:PE关=手填路)
  link70 [151].手动高   ← -10槽7 手动高(同上)
改端点 3 条:link7 (-10槽4→210.mode)→(-10槽5→150.透明覆盖,COMBO→BOOLEAN);
  link59/link66 origin (210,0)→(150,5 透明值)。
退役 2 条:link47(画幅联动开关→151.联动开关,被 68 替)、link61(150.rgba_default
  →210.rgba_hint,消费件退役)。

端到端逻辑等价对拍(白名单外零漂移):
  - 固定句/参数 SHA256 对拍([24]主体句/[141]锁层A/[152]头尾W1/[150]combo/
    [207][7][206] 加速 widgets/[140] PE 参数);
  - 节点集差=恰 {210};连线多重集差=恰 上述 5 条(2 退役+3 新增);
  - 其余节点深层对比:除白名单节点([150] 加一进一出/[151] 加两进两 wv 位/
  标题/pos/size)外逐字节相等;
  - 九型默认路径语义不变:透明值=rgba_default 同型直布(人物→false=原三态
  「跟随型」解);画幅 PE 开=建议/PE 关=九型(联动开关=PE开关扇出后,PE 关=
  联动关=九型原样,与原「画幅联动开关默认关」同态)。

三件套:/tmp/qi21_usertest_surgery_1001/ 与 apps/output/usertest-batch-1001/
(before.json / after.json / assertions.txt)。
铁律:禁手工编辑 JSON;断言不过=fail-closed 不落盘。
用法:python3 apps/build/scripts/qi21_usertest_surgery_1001.py [--step all|verify]
"""
import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BLUEPRINT = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"
SNAP_TMP = Path("/tmp/qi21_usertest_surgery_1001")
SNAP_OUT = REPO / "apps/output/usertest-batch-1001"

ASM_UUID = "96937bbe-99d1-4f16-a06c-d86b57815d91"      # [40] 宿主实例 uuid(S5 换轨后)
ACC_UUID = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"      # 加速子图 uuid(生成器固定值)
BP_SG_ID = "c3f81b56-0a47-4d29-9e61-8b7f2d5a6c04"      # 蓝图恒定 id(分轨常态)

# ── 装配子图:新 -10 槽序(Q3 面板序;widget 型槽序=面板控件序)──────────────
# (槽名, 型, 原 uuid 保留/新 uuid, IO 圆点 pos)
ASM_INPUTS_NEW = [
    ("clip",    "CLIP",    "a1e2c3d4-0001-4a01-9e01-7d4a9c31a001", [4760, 820]),
    ("vae",     "VAE",     "a1e2c3d4-0002-4a02-9e02-7d4a9c31a002", [4760, 900]),
    ("主体句",   "STRING",  "a1e2c3d4-0003-4a03-9e03-7d4a9c31a003", [-36, 1240]),
    ("型选择",   "COMBO",   "a1e2c3d4-0004-4a04-9e04-7d4a9c31a004", [-36, 1160]),
    ("PE开关",  "BOOLEAN", "a1e2c3d4-0006-4a06-9e06-7d4a9c31a006", [1900, 1860]),
    ("透明",     "BOOLEAN", "a1e2c3d4-0005-4a05-9e05-7d4a9c31a005", [-36, 1320]),
    ("手动宽",   "INT",     "a1e2c3d4-0009-4a09-9e09-7d4a9c31a009", [2500, 1950]),
    ("手动高",   "INT",     "a1e2c3d4-0010-4a10-9e10-7d4a9c31a010", [2500, 2010]),
    ("pe_clip", "CLIP",    "a1e2c3d4-0007-4a07-9e07-7d4a9c31a007", [1290, 1900]),
]

# 改端点 3 条 + 退役 2 条 + 新增 3 条(白名单,见模块 docstring)
REDIRECT = {  # link_id: (origin_id, origin_slot, target_id, target_slot, type)
    7:  (-10, 5, 150, 1, "BOOLEAN"),   # 透明→[150].透明覆盖(名/型/槽改)
    8:  (-10, 4, 152, 0, "BOOLEAN"),   # PE开关:槽位随 -10 重排 5→4(端点语义不变)
    46: (-10, 8, 140, 0, "CLIP"),      # pe_clip:槽位随 -10 重排 6→8(尾位,端点语义不变)
    59: (150, 5, 144, 2, "BOOLEAN"),   # [144].switch ← [150].透明值
    66: (150, 5, 152, 1, "BOOLEAN"),   # [152].透明模式 ← [150].透明值
}
RETIRE_LINKS = {47, 61}
NEW_LINKS = {
    68: (-10, 4, 151, 1, "BOOLEAN"),   # [151].联动开关 ← PE开关扇出(问题②)
    69: (-10, 6, 151, 4, "INT"),       # [151].手动宽 ← -10 手动宽
    70: (-10, 7, 151, 5, "INT"),       # [151].手动高 ← -10 手动高
}

ASM_TITLES = {
    150: "底座九选一",
    141: "装配全文件",
    152: "最终文本合成器",
    151: "画幅建议器",
    140: "[140] PE改写",
    142: "主编码",
    143: "RGBA编码",
    144: "输出选择",
}
ACC_TITLES = {
    7:   "[7] 直出40步",
    206: "[206] viggle359步",
    198: "[198] FunAcc4步",
    31:  "[31] viggle LoRA",
    207: "[207] seed 单源",
    # 214 「出图速度选择」不动
}

# ── 加速子图横向三横线布局(⑨;出入口同横轴 y≈500)────────────────────────
ACC_LAYOUT = {  # id: pos
    207: [400, 455],    # seed 单源:主轴左端(喂三支路全右向)
    7:   [900, 150],    # 线1 直出(y≈150)
    198: [900, 420],    # 线2 FunAcc(中轴 y≈500 顺路)
    31:  [900, 800],    # 线3 viggle LoRA(y≈850)
    206: [1300, 780],   # 线3 viggle KSampler([31] 右侧)
    214: [3400, 435],   # 汇流(主轴右端)
}
ACC_IO_POS = {  # 输入口 6 槽同一横轴 y≈500(左缘竖列,视觉同层);输出口同轴
    "model": [-36, 440], "positive": [-36, 500], "negative": [-36, 560],
    "latent": [-36, 620], "速度档位": [-36, 680], "seed": [-36, 740],
}
ACC_OUT_POS = {"LATENT": [3900, 500]}
ACC_INPUT_BOUNDING = [-190, 380, 160, 420]
ACC_OUTPUT_BOUNDING = [3790, 430, 320, 260]

# 主图组框③ 面板清单句随面板重排微改(title-only,成员/框不变)
MAIN_GROUP3_OLD = "面板=型选择/RGBA/PE开关/画幅联动开关"
MAIN_GROUP3_NEW = "面板=主体句/型选择/PE开关/透明/手动宽高(条件显隐)"

# [10] 速查卡重写(画幅/透明大白话+迁入注记;锚词清单=契约 test_usage_note_*)
NOTE10 = """## 道劫 · Qwen-Image-2.1 文生图(双子图版·1001 用户测试批)

K2 道劫『一处选型+分件装配+子图收装』思想的 Q2-1 原生落地(0928 用户裁定:所有提示词必须过 PE——PE 改写链已收进 [40] 装配子图,消灭 [40]→主图 PE 链→[40] 来回绕线,主图零 PE 件零左向线)。**0929 S3 收装轮:加速区整体收进 [208] 加速子图**(三支路+viggle LoRA+seed 单源+出图速度选择全在内,双击进入;主图退成四块骨架=①加载器→②提示词·装配([24][40][27])→③加速([5] 空潜+[208] 加速子图)→④输出([8][9]);每画布恰两子图=②提示词子图管内容语义+③加速子图管采样策略,职责互斥不掺和)。**1001 S8 集成轮:装配子图 28→10 节点(裁定A两件链)**;**1001 用户测试批:10→9 节点([210] 三态件退役)+型选择十档(九型+自由)+透明纯布尔直布+画幅规则重构(PE 开=自动/PE 关才可手动)+两子图分组框全清空+节点标题瘦身(机制注记迁本卡)**;提示词真源=docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md(②层底座=09-23 美化版,型名/顺序对齐 daojie_bases.json)。

### 怎么换型(一处切换;十档=九型+「自由」)
- 主画布点选 [40] 装配子图,面板「型选择」下拉十选一(默认①人物):人物/场景/道具/美宣/多视图/高清人脸/分镜剧情图/表情差分/概念气氛图/自由——子图内 [150] 底座九选一(MyQi21DaojieBase:BASE=②层底座+人物系增量四锁B+④配色行逐字=05 库/宽高随型直出/磁盘热读)按选型出 BASE 与 WIDTH/HEIGHT(型档分辨率直出);**「自由」型**(1001 用户测试批)=无型底座(BASE 空,装配自动降级两段拼=主体句+锁层A)+画幅兜底 1024×1024+透明手动(见下节)。
- **分辨率**:PE 开=画幅自动跟 PE 建议(见画幅节);PE 关=跟所选型默认画幅,或在面板「手动宽/手动高」填成对非 0 值(0=跟型)。[40] 子图 width/height 输出直驱 [5] 空潜宽高(ResolutionSelector 已退役;九型档=qi21_bases.json 的 aspect/MP/override;多视图=Q2.1侧分档 3:4 Portrait 4.2MP 分张产线,override 已退役)——[5] 面板 1024×1024=**摆设值不生效**(实际由 [40] width/height 供给)。
- 换型后 [24] 主体句须同步换成本型主体句(各型例句见库文档;场景/概念气氛图不写人——空镜句尾可明写「空镜无人」);主体句只写主体与画面,不重复风格词,全角标点,质量词/比例词/否定式禁入(库文档主体句纪律五则)。
- 警示(手贴 vs 库真源):手贴内容只活在画布件——历史生成脚本已退役(qi21_daojie_t2i_0923.py 在 1001 手术轮后**勿再运行**,重跑必回退手术;真源=本 JSON+蓝图);主体句默认/锁层全文真源链仍在(底座 BASE 不经画布常量、直读 qi21_bases.json),装配器参数面(锁层A/头尾句/W1)改后要长久保留先回写库文档再经「从库刷参数」通道过账,或改前另存画布件。

### 画幅怎么定(大白话:PE 开=自动,PE 关=可手动)
- **PE 开**:画幅由 PE 改写给出的宽高比决定——[140] 的 wh_ratio(如 16:9)经 [151] 画幅建议器(MyQi21WhSuggest:4.2MP 公式+8 倍数取整)算出建议宽高自动生效;面板无任何画幅项(「手动宽/手动高」两控件隐藏)。
- **PE 关**:跟所选型默认画幅;想自定就在面板「手动宽」「手动高」两个数字框填成对值(**两个都非 0 才生效;只填一个会报错,不猜不代选**;都留 0=跟型)。
- 旧「画幅联动开关」独立控件已退役(1001 用户测试批:其语义并入 PE 开关——[151].联动开关 改接 PE 开关扇出,建议器件零改;PE 关=联动关=九型原样,与旧默认同态)。

### 透明怎么定(大白话:九型全自动,自由型才手动)
- **九型**:透明=纯按型默认(道具/多视图/高清人脸/表情差分四型开,其余五型关),面板无透明控件,不用管——RGBA 编码路自动跟随型。
- **「自由」型**:面板出现「透明」开关(true/false,默认 false)手动定;切到九型时该开关自动隐藏(面板布尔值保留不丢,切回自由型还在)。
- 机制(1001 ④⑥⑦ 落地):旧「RGBA透明」三态控件(跟随型/强制开/强制关)与子图内 [210] 三态选择件已退役——透明布尔唯一来源=底座件 [150] 第六出「透明值」(型≠自由=该型 rgba_default;自由型=面板「透明」布尔经 [150].透明覆盖 直通),纯 BOOLEAN 跨子图边界直布 [152] 合成器与 [144] 输出选择,子图内零自选转换层;透明图必须存 PNG 才保 alpha。

### 装配怎么拼([24] 唯一手写位;最终文本经 [40]「最终文本」出口过目 [27])
- 拼法=库文档四层装配『主体句领头+换行分层』:子图内 [141] 装配全文件(MyQi21PromptAssembly:主体句+BASE+锁层A→装配全文;Q1=B+ 唯一真源)→直喂 [140].prompt;[152] 最终文本合成器(MyQi21PromptSelect)做路选择:pe开关=开(**默认 PE 改写**,0926 裁定1)时 PE出文为最终文本,关=直写=装配全文——最终文本直喂 [142] 主编码,并经 [40]「最终文本」输出到主画布 [27] 装配预览过目。**pe开关在 [40] 面板**(默认开;面板=主体句/型选择/PE开关/透明(仅自由型)/手动宽高(仅PE关)六控件)。
- 层次序注:画布装配行序=①主体句→②型底座→(人物系增量锁)→④配色行→③通用锁层;库文档直写件行序=①②③(内嵌增量锁)④——层内容零差异,仅行序不同(锁层常量恒挂不可拆,增量锁随型走在 BASE 内;锁层A=③层库首节全文,全型恒挂不随型,参数面大框可编辑)。
- 甲案围栏:本链为甲案全中文直书(中文合法);与 PE/乙案英文长文禁混——pe开关 开=走 PE 改写路(装配全文进、英文长文出,整体替换),与本链二选一(库文档禁混条款一)。

### PE 改写([140];短句→英文长文;默认开路 0926 裁定1;pp=1.5 已定档 0925)
- clip 由主图 [11] PE 专属 TE 经 [40].pe_clip 槽一进线供给;关 PE开关=直写选配时旁路懒执行不载(PE 关×无建议路需求=[140] 零执行零 PE TE 装载)。PE 参数=插件官方 README 推荐值(temp1.0/topP0.95/topK20/**presence_penalty=1.5**(0925 拍板:A/B 四维 57.5 vs 55.0 略优)/max16256/seed42)。
- **1001 Q1=B+ 裁定:[140] 输入=装配全文件·装配全文**(prompt 槽接 [141] MyQi21PromptAssembly 输出口0,种子文 widget 退役清空——写死的种子文被旁路问题就此根治,PE=装配全文的优化器);宪法=05 库 §一/§六「PE 种子纪律」。
- 起草/改写提示词唤取技能 qwen-image-2-1-prompter。

### 负面线说明(cfg=1 占位,W5 终审)
- **cfg=1 下负面提示词数学上不参与采样**;[40] negative 输出→加速子图内 [7]/[206] 负向槽的接线保留,纯为与官方模板同构的**占位**(不生效;T8 无负面槽)。要用负向须抬 cfg,非本产线口径。

### 加速区·加速子图([208] 双击进入;默认=直出40步=0929 拉齐重放裁定;横向三支路三横线)
- **主图只剩一个加速子图节点 [208]**:双击进入=并行三支路+viggle LoRA+seed 单源+出图速度选择,**前面只有一个选择逻辑**=子图内 [214] MyQi21SpeedSelect(LATENT 汇流单点,combo 三选一**首项=默认=「0 · 直出40步」**(0929 拉齐重放;Fun-Acc 仍为主加速=次序第二)):支路0=[7] 直出40步(KSampler 官方完整档·40步·cfg1)/支路1=[31] viggle LoRA(v0.2.1 r256·strength 0.8)→[206] viggle359步(KSampler·359步·cfg1;0929 用户改值,原 6=v0.2.1 系卡荐档)/支路2=[198] FunAcc4步(T8QwenImage21FunAccPDD4Step·4步/sigmas 五值/euler/cfg1 全内置勿外接采样器;model=[1] base 直连**绝不吃 viggle LoRA**;无负面槽)。布局=出入口同一横轴+三支路三条平行横线([207] seed 单源居主轴左端扇出)。默认档只是初始值,随时可切任何档;加速启停语义=用户手动权威。
- **宿主面板两控件=「速度档位」+「seed」**(照 [40] 型选择外露机制):速度档位=combo 三选一(默认直出40步,随时可切);seed=number(默认 0 fixed 可复现,**seed 单源**——子图内 [207] PrimitiveInt 单源扇出三支路采样器,各采样器面板 seed 值=摆设值不生效,改 seed 只动宿主面板一处,三支路同步)。**面板值=生效值**(steps 回归各支路 widget 真实生效:[7]=40 官方区间 40-50 起手即完整态/[206]=359;cfg 恒 1/euler/simple/denoise 1 照官方)。
- **边界**:model=主图 [1] UNET 直连进子图;positive/negative=主图 [40] 装配子图输出(negative=cfg=1 占位,见负面线说明);latent=[5] 空潜;LATENT 出子图→[8] 解码→[9] 保存。
- **懒执行**:未选中支路整体不进执行图零加载(MyQi21SpeedSelect 懒选择,check_lazy_status 只拉起选中档支路;如默认直出40步时 [198]/[206]/[31] 全不在执行图;子图环境同款生效)。
- **档1=viggle**:[31] LoraLoaderModelOnly 挂链(name 预填 Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors,viggle 蒸馏件已装机,strength 0.8——0925 探针最优:flatMAD 2.52→1.75 细腻无结构缺陷;8步方案 2.60 无收益+超荐档弃)+[206] 359 步;模型卡注 shift_terminal=0.02 伤末步,画质异常先查调度。
- **档2=Fun-Acc**:[198] model_file=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors(已装机 models/loras/)。实测速度(0926 三轮实弹):1024² 28.8s/2048² 130.7s(viggle 34.1/183.1,直出 214.7/1173.4)。TE 硬校验 4096 维,现产线 TE=qwen3vl_8b_bf16_heretic 已实测通过。
- **依赖警示:档2 需引擎装 Fun-Acc 插件(T8 节点,见设置页生态插件区 Comfyui-Qwen-Image-2.1-Fun-Acc-LoRAs-T8)**;未装的机器选档2 节点红/执行失败——降级=经宿主面板「速度档位」切回 0/1 档。TE-Speed 槽不加(3c 试装已死归档:插件未装=画布红节点,D4 终审永不装)。

### 参数圣经
- cfg 恒 1(负面=官方同构占位,见上节;档2 Fun-Acc 无负面槽);**步数=各支路面板真实生效值([7]=40 官方完整档,官方区间 40-50;[206]=359=viggle 支路;档2=Fun-Acc 4 步内置于 [198] T8)**;分辨率走 [40] 子图随型直驱 width/height(宽高恒 8 倍数;PE 开=PE 建议/PE 关=跟型或手动宽高);seed=加速子图宿主面板「seed」;风格终审=用户。
- RGBA 透明官方公式 This is an RGBA format image with transparency. [剥离文+W1收束句/装配文]. The image has an alpha channel and a transparent background.(头尾逐字=官方原文;中文同款:这是一张带有透明度的RGBA图像。……该图像具有alpha通道,背景是透明的。);**PE×透明融合**(0929 用户翻案令「PE 要出透明提示词,要融合」):PE 开路走透明时=[152] 合成器内置:PE出文→背景句剥离(词族黑名单,词边界匹配,真源=my-nodes/nodes/qi21_strip_lexicon.json 单源现读)→+W1收束句(0930 宪法改写轮S10·型盲静态,句身=05库§一0930条款,收束句在剥离之后拼接=对词族结构性免疫)→官方头尾包裹=透明文本→[143] RGBA编码;透明关+PE 开=[152] 口0 最终文本直喂 [142] 主编码吃带背景完整文(禁剥离);装配全文禁过剥离(声明句词族误伤=翻车)。透明路出图必须存 PNG 才保 alpha。
- [5] 自动化宽高:宽高直连 [40] width/height 输出=画幅规则后终值;本节点面板 1024 为摆设值不生效。
- [27] 最终提示词预览:接 [40]「最终文本」输出=将进编码的最终文本;跑图前过目。
"""

# 旧 [10] 锚(前置态校验:这些 token 不在=输入态漂移,拒绝手术)
NOTE10_OLD_TOKENS = ("RGBA透明", "跟随型", "画幅联动开关", "28→10 节点", "裁定A",
                     "双子图版·0929 S3 收装轮")


def sha16(b) -> str:
    if isinstance(b, str):
        b = b.encode()
    return hashlib.sha256(b).hexdigest()[:16]


def sg_of(d, uuid):
    hits = [s for s in d["definitions"]["subgraphs"] if s["id"] == uuid]
    assert len(hits) == 1, f"子图 {uuid[:8]} 命中 {len(hits)} 份"
    return hits[0]


def consistency(d):
    """全图引用一致性:零悬空零反向+IO linkIds 端点实(两子图+主图)。"""
    errs = []
    for sg in d["definitions"]["subgraphs"]:
        nodes = {n["id"]: n for n in sg["nodes"]}
        links = {l["id"]: l for l in sg["links"]}
        for nid, n in nodes.items():
            for i in n.get("inputs", []) or []:
                lid = i.get("link")
                if lid is not None and lid not in links:
                    errs.append(f"[{sg['name'][:12]}] node {nid} input {i.get('name')} 悬空 link {lid}")
                elif lid is not None and links[lid]["target_id"] != nid:
                    errs.append(f"[{sg['name'][:12]}] node {nid} input {i.get('name')} link {lid} 反向指向")
                elif lid is not None and links[lid]["target_slot"] != _idx_of(n["inputs"], i):
                    errs.append(f"[{sg['name'][:12]}] node {nid} input {i.get('name')} link {lid} 槽位不符")
            for o in n.get("outputs", []) or []:
                for lid in (o.get("links") or []):
                    if lid not in links:
                        errs.append(f"[{sg['name'][:12]}] node {nid} output {o.get('name')} 悬空 link {lid}")
                    elif links[lid]["origin_id"] != nid:
                        errs.append(f"[{sg['name'][:12]}] node {nid} output {o.get('name')} link {lid} 反向源")
        for arr, tag, oid in ((sg.get("inputs", []), "sg.input", -10),
                              (sg.get("outputs", []), "sg.output", -20)):
            for slot, s in enumerate(arr):
                for lid in s.get("linkIds", []):
                    if lid not in links:
                        errs.append(f"[{sg['name'][:12]}] {tag} {s['name']} 悬空 linkId {lid}")
                    else:
                        l = links[lid]
                        if tag == "sg.input" and (l["origin_id"] != oid or l["origin_slot"] != slot):
                            errs.append(f"[{sg['name'][:12]}] {tag} {s['name']} linkId {lid} 端点不符")
                        if tag == "sg.output" and (l["target_id"] != oid or l["target_slot"] != slot):
                            errs.append(f"[{sg['name'][:12]}] {tag} {s['name']} linkId {lid} 端点不符")
        for l in links.values():
            if l["origin_id"] not in nodes and l["origin_id"] != -10:
                errs.append(f"[{sg['name'][:12]}] link {l['id']} 源节点 {l['origin_id']} 不存在")
            if l["target_id"] not in nodes and l["target_id"] != -20:
                errs.append(f"[{sg['name'][:12]}] link {l['id']} 目标节点 {l['target_id']} 不存在")
    return errs


def _idx_of(arr, item):
    for i, x in enumerate(arr):
        if x is item:
            return i
    return -1


def assert_acyclic(sg):
    """引擎 validate_inputs 同款环检(全部连线输入递归,lazy 边计入)。"""
    upstream = {}
    for l in sg["links"]:
        if l["target_id"] != -20:
            upstream.setdefault(l["target_id"], []).append(l["origin_id"])
    state = {}

    def visit(nid, path):
        if state.get(nid) == 1:
            return
        if state.get(nid) == 0:
            raise AssertionError("依赖环实测:" + " -> ".join(map(str, path + [nid])))
        state[nid] = 0
        for org in upstream.get(nid, []):
            if org != -10:
                visit(org, path + [nid])
        state[nid] = 1

    for n in sg["nodes"]:
        visit(n["id"], [])


def rebuild_refs(sg):
    for n in sg["nodes"]:
        for i in n.get("inputs", []) or []:
            i["link"] = None
        for o in n.get("outputs", []) or []:
            o["links"] = []
    for l in sg["links"]:
        if l["target_id"] == -20:
            continue
        t = next(n for n in sg["nodes"] if n["id"] == l["target_id"])
        assert l["target_slot"] < len(t["inputs"]), \
            f"link{l['id']} target_slot {l['target_slot']} 越界 node{t['id']}"
        t["inputs"][l["target_slot"]]["link"] = l["id"]
    for l in sg["links"]:
        if l["origin_id"] == -10:
            continue
        o = next(n for n in sg["nodes"] if n["id"] == l["origin_id"])
        assert l["origin_slot"] < len(o["outputs"]), \
            f"link{l['id']} origin_slot {l['origin_slot']} 越界 node{o['id']}"
        o["outputs"][l["origin_slot"]].setdefault("links", []).append(l["id"])
    for slot, s in enumerate(sg["inputs"]):
        s["linkIds"] = [l["id"] for l in sg["links"]
                        if l["origin_id"] == -10 and l["origin_slot"] == slot]
    for slot, s in enumerate(sg["outputs"]):
        s["linkIds"] = [l["id"] for l in sg["links"]
                        if l["target_id"] == -20 and l["target_slot"] == slot]


def link_multiset(sg):
    return sorted((l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"], l["type"])
                  for l in sg["links"])


def do_surgery(d, report):
    asm = sg_of(d, ASM_UUID)
    acc = sg_of(d, ACC_UUID)
    host40 = next(n for n in d["nodes"] if n["id"] == 40)
    note10 = next(n for n in d["nodes"] if n["id"] == 10)
    nodes = {n["id"]: n for n in asm["nodes"]}

    # ── 前置态锚(fail-closed:与档不符即停手)──
    assert len(asm["nodes"]) == 10 and len(asm["links"]) == 29, \
        f"前置锚:装配子图应 10件29线(1001 S8 集成术后态),得 {len(asm['nodes'])}件{len(asm['links'])}线"
    assert len(acc["nodes"]) == 6 and len(acc["links"]) == 21, \
        f"前置锚:加速子图应 6件21线,得 {len(acc['nodes'])}件{len(acc['links'])}线"
    assert nodes[210]["type"] == "MyQi21RgbaSelect", "[210] 应为 MyQi21RgbaSelect"
    assert [i["name"] for i in nodes[151]["inputs"]] == \
        ["wh_ratio", "联动开关", "九型WIDTH", "九型HEIGHT"], "[151] 槽序漂移"
    assert len(host40["widgets_values"]) == 5, "宿主面板应 5 控件(术前态)"
    for tok in NOTE10_OLD_TOKENS:
        assert tok in note10["widgets_values"][0], f"[10] 旧锚 token 缺失(输入态漂移):{tok}"
    old_links_asm = {l["id"]: dict(l) for l in asm["links"]}
    before_snapshot = {
        "asm_links": link_multiset(asm),
        "nodes_asm": {n["id"]: copy.deepcopy(n) for n in asm["nodes"]},
        "host40_wv": list(host40["widgets_values"]),
    }

    # ══ ① 装配子图连线手术 ══
    links = {l["id"]: l for l in asm["links"]}
    for lid in RETIRE_LINKS:
        assert lid in links, f"退役线 link{lid} 不在(前置态漂移)"
    asm["links"] = [l for l in asm["links"] if l["id"] not in RETIRE_LINKS]
    links = {l["id"]: l for l in asm["links"]}
    for lid, (o, os_, t, ts, ty) in REDIRECT.items():
        assert lid in links, f"改端点线 link{lid} 不在(前置态漂移)"
        links[lid].update(origin_id=o, origin_slot=os_, target_id=t, target_slot=ts, type=ty)
    for lid, (o, os_, t, ts, ty) in NEW_LINKS.items():
        assert lid not in links, f"新线 link{lid} 已存在(id 撞车)"
        asm["links"].append({"id": lid, "origin_id": o, "origin_slot": os_,
                             "target_id": t, "target_slot": ts, "type": ty})

    # ══ ② [210] 退役 ══
    asm["nodes"] = [n for n in asm["nodes"] if n["id"] != 210]

    # ══ ③ [150] 底座件:透明覆盖入+透明值出 ══
    n150 = nodes[150]
    assert n150["type"] == "MyQi21DaojieBase"
    n150["inputs"].append({"name": "透明覆盖", "type": "BOOLEAN",
                           "widget": {"name": "透明覆盖"}, "link": 7})
    n150["outputs"].append({"name": "透明值", "type": "BOOLEAN", "links": []})

    # ══ ④ [151] 建议器:手动宽/手动高两槽 ══
    n151 = nodes[151]
    n151["inputs"].append({"name": "手动宽", "type": "INT",
                           "widget": {"name": "手动宽"}, "link": 69})
    n151["inputs"].append({"name": "手动高", "type": "INT",
                           "widget": {"name": "手动高"}, "link": 70})
    assert n151["widgets_values"] == ["", False], "[151] widgets 前置态漂移"
    n151["widgets_values"] = ["", False, 0, 0]

    # ══ ⑤ -10 槽重排(RGBA透明→透明 BOOLEAN;画幅联动开关退;手动宽/高入;pe_clip 尾位)══
    old_inputs = {s["name"]: s for s in asm["inputs"]}
    assert [s["name"] for s in asm["inputs"]] == \
        ["clip", "vae", "主体句", "型选择", "RGBA透明", "PE开关", "pe_clip", "画幅联动开关"], \
        "装配子图 -10 槽序漂移(前置态锚)"
    new_inputs = []
    for name, typ, uid, pos in ASM_INPUTS_NEW:
        if name in old_inputs:  # 存量槽:保 uuid,type/pos/name 随映射更新
            s = copy.deepcopy(old_inputs[name])
            s["type"] = typ
            s["pos"] = list(pos)
            new_inputs.append(s)
        else:  # 新槽:手动宽/手动高
            new_inputs.append({"id": uid, "name": name, "type": typ,
                               "linkIds": [], "pos": list(pos)})
    asm["inputs"] = new_inputs

    # ══ ⑥ groups 清空(③)+标题瘦身(⑤)══
    asm["groups"] = []
    for nid, t in ASM_TITLES.items():
        nodes[nid]["title"] = t
    asm["state"]["lastLinkId"] = 70

    # ══ ⑦ 引用重建 ══
    rebuild_refs(asm)

    # ══ ⑧ 宿主面板镜像重排(Q3 序)══
    subj = host40["widgets_values"][0]
    host40["widgets_values"] = [subj, "人物", True, False, 0, 0]
    host40["widgets_values_named"] = {
        "主体句": subj, "型选择": "人物", "PE开关": True,
        "透明": False, "手动宽": 0, "手动高": 0}
    asm["widgets"] = list(host40["widgets_values"])

    # ══ ⑨ 加速子图:横向三横线布局(⑨)+标题(⑧)+groups(③)══
    acc_nodes = {n["id"]: n for n in acc["nodes"]}
    for nid, pos in ACC_LAYOUT.items():
        acc_nodes[nid]["pos"] = list(pos)
    for s in acc["inputs"]:
        if s["name"] in ACC_IO_POS:
            s["pos"] = list(ACC_IO_POS[s["name"]])
    for s in acc["outputs"]:
        if s["name"] in ACC_OUT_POS:
            s["pos"] = list(ACC_OUT_POS[s["name"]])
    acc["inputNode"]["bounding"] = list(ACC_INPUT_BOUNDING)
    acc["outputNode"]["bounding"] = list(ACC_OUTPUT_BOUNDING)
    acc["groups"] = []
    for nid, t in ACC_TITLES.items():
        acc_nodes[nid]["title"] = t

    # ══ ⑩ [10] 速查卡重写 + 主图组框③ 面板清单句 ══
    note10["widgets_values"] = [NOTE10]
    hit = [g for g in d["groups"] if MAIN_GROUP3_OLD in g.get("title", "")]
    assert len(hit) == 1, f"主图组框③ 面板清单句命中 {len(hit)} 处(应恰 1)"
    hit[0]["title"] = hit[0]["title"].replace(MAIN_GROUP3_OLD, MAIN_GROUP3_NEW)

    return before_snapshot, old_links_asm


def verify(d, carried, report):
    asm = sg_of(d, ASM_UUID)
    acc = sg_of(d, ACC_UUID)
    host40 = next(n for n in d["nodes"] if n["id"] == 40)
    nodes = {n["id"]: n for n in asm["nodes"]}
    links = {l["id"]: l for l in asm["links"]}

    # A. 节点/连线账
    assert len(asm["nodes"]) == 9, f"装配子图应 9 件([210] 退),得 {len(asm['nodes'])}"
    assert sorted(nodes) == [140, 141, 142, 143, 144, 150, 151, 152, 250], \
        f"装配子图成员漂移:{sorted(nodes)}"
    assert 210 not in nodes and "MyQi21RgbaSelect" not in {n['type'] for n in asm['nodes']}, \
        "[210]/三态件应退役"
    assert len(asm["links"]) == 30, f"装配子图应 30 线(29-2+3),得 {len(asm['links'])}"
    report.append("A 装配子图:10件29线→9件30线([210] 退役+2退役线+3新线)✓")

    # B. 全 30 条端点逐条对拍
    want_eps = {
        1: (-10, 0, 142, 0, "CLIP"), 2: (-10, 0, 143, 0, "CLIP"),
        3: (-10, 1, 142, 2, "VAE"), 4: (-10, 1, 143, 2, "VAE"),
        5: (-10, 2, 141, 0, "STRING"), 6: (-10, 3, 150, 0, "COMBO"),
        7: (-10, 5, 150, 1, "BOOLEAN"),
        8: (-10, 4, 152, 0, "BOOLEAN"), 46: (-10, 8, 140, 0, "CLIP"),
        9: (150, 0, 141, 2, "STRING"),
        17: (142, 0, 144, 0, "CONDITIONING"), 19: (143, 0, 144, 1, "CONDITIONING"),
        20: (144, 0, -20, 0, "CONDITIONING"), 21: (142, 1, -20, 1, "CONDITIONING"),
        23: (140, 0, 152, 6, "STRING"), 25: (140, 2, 151, 0, "STRING"),
        37: (150, 1, 151, 2, "INT"), 41: (150, 2, 151, 3, "INT"),
        42: (151, 0, -20, 2, "INT"), 43: (151, 1, -20, 3, "INT"),
        45: (152, 0, -20, 4, "STRING"), 57: (152, 1, 143, 3, "STRING"),
        59: (150, 5, 144, 2, "BOOLEAN"), 61: None,
        62: (152, 0, 142, 3, "STRING"), 65: (141, 0, 140, 1, "STRING"),
        66: (150, 5, 152, 1, "BOOLEAN"), 67: (141, 0, 152, 5, "STRING"),
        68: (-10, 4, 151, 1, "BOOLEAN"), 69: (-10, 6, 151, 4, "INT"),
        70: (-10, 7, 151, 5, "INT"), 47: None,
    }
    want_live = {k for k, v in want_eps.items() if v is not None}
    assert set(links) == want_live, \
        f"link id 集漂移:多 {sorted(set(links) - want_live)} 少 {sorted(want_live - set(links))}"
    for lid, want in want_eps.items():
        if want is None:
            continue
        l = links[lid]
        got = (l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"], l["type"])
        assert got == want, f"link{lid} 端点 {got} != {want}"
    wl = ("  ★新接线白名单(恰3条):link68 [151].联动开关←PE开关扇出 / "
          "link69 [151].手动宽←-10槽6 / link70 [151].手动高←-10槽7\n"
          "  ★改端点(恰5条):link7 →[150].透明覆盖(COMBO→BOOLEAN) / "
          "link8 PE开关槽5→4+link46 pe_clip槽6→8(重排随迁,语义不变) / "
          "link59+66 origin [210]→[150]槽5 透明值\n"
          "  ★退役(恰2条):link47 画幅联动开关 / link61 rgba_hint")
    report.append("B 全 30 条端点逐条对拍 ✓\n" + wl)

    # C. 无环(引擎同款,lazy 边计入)
    assert_acyclic(asm)
    report.append("C 无环断言 ✓(150→141→140→152 链式,新线全单向扇出)")

    # D. -10/-20 槽面
    assert [s["name"] for s in asm["inputs"]] == \
        ["clip", "vae", "主体句", "型选择", "PE开关", "透明", "手动宽", "手动高", "pe_clip"], \
        "-10 槽序应=Q3 面板序(clip/vae/主体句/型选择/PE开关/透明/手动宽/手动高/pe_clip)"
    slot5 = asm["inputs"][5]
    assert slot5["type"] == "BOOLEAN" and slot5["name"] == "透明", \
        "-10 槽5 应=「透明」BOOLEAN(Q4 裁定)"
    assert "RGBA透明" not in {s["name"] for s in asm["inputs"]} and \
        "画幅联动开关" not in {s["name"] for s in asm["inputs"]}, "旧槽应退役"
    assert len(asm["outputs"]) == 5, "-20 输出 5 槽零动"
    report.append("D -10 槽面:9 槽(Q3 序;透明 BOOLEAN/手动宽高 INT 新立;旧两槽退役);"
                  "-20 五出零动 ✓")

    # E. [150]/[151] 接口面
    assert [i["name"] for i in nodes[150]["inputs"]] == ["base", "透明覆盖"], \
        "[150] 入槽应= base+透明覆盖(optional 尾部,P1 件侧接口)"
    assert [o["name"] for o in nodes[150]["outputs"]] == \
        ["BASE", "WIDTH", "HEIGHT", "型名", "rgba_default", "透明值"], \
        "[150] 应六出(存量五出槽序零漂移+透明值第六出)"
    assert nodes[150]["outputs"][4]["links"] == [], \
        "[150].rgba_default 消费者应随 [210] 退役清空"
    assert sorted(nodes[150]["outputs"][5]["links"]) == [59, 66], \
        "[150].透明值 应双扇出(59→[144].switch + 66→[152].透明模式)"
    assert nodes[150]["inputs"][1]["link"] == 7, "[150].透明覆盖 应接 link7(-10 透明)"
    assert [i["name"] for i in nodes[151]["inputs"]] == \
        ["wh_ratio", "联动开关", "九型WIDTH", "九型HEIGHT", "手动宽", "手动高"], \
        "[151] 槽序应=件侧 P1 接口面"
    assert nodes[151]["widgets_values"] == ["", False, 0, 0], "[151] wv 应含手填两 0"
    report.append("E [150] 六出+透明覆盖入 / [151] 六槽+手填 wv ✓(纯 BOOLEAN 跨界=⑦)")

    # F. 宿主面板(Q3 序)+双镜像
    subj = carried["host40_wv"][0]
    assert host40["widgets_values"] == [subj, "人物", True, False, 0, 0], \
        f"宿主面板应=[主体句,人物,PE开true,透明false,手动宽0,手动高0],得 {host40['widgets_values']}"
    assert list(host40["widgets_values_named"]) == \
        ["主体句", "型选择", "PE开关", "透明", "手动宽", "手动高"], "具名镜像键序漂移"
    assert asm["widgets"] == host40["widgets_values"], "sg.widgets 应与宿主面板双写同值"
    assert [i["name"] for i in host40["inputs"]] == ["clip", "vae", "主体句", "pe_clip"], \
        "宿主外露连线槽 4 槽零动"
    report.append("F 宿主面板六控件(Q3 序:主体句→型选择→PE开关→透明→手动宽→手动高)"
                  "+sg.widgets/具名镜像三写一致 ✓")

    # G. groups 清空(③)+标题瘦身(⑤⑧)
    assert asm["groups"] == [] and acc["groups"] == [], "两子图 groups 应恰 0(③)"
    assert len(d["groups"]) == 4, "主图 4 组框零动(③ 只清子图)"
    got_asm_titles = {nid: nodes[nid]["title"] for nid in ASM_TITLES}
    assert got_asm_titles == ASM_TITLES, f"装配标题漂移:{got_asm_titles}"
    acc_nodes = {n["id"]: n for n in acc["nodes"]}
    got_acc_titles = {nid: acc_nodes[nid]["title"] for nid in ACC_TITLES}
    assert got_acc_titles == ACC_TITLES, f"加速标题漂移:{got_acc_titles}"
    assert acc_nodes[214]["title"] == "出图速度选择", "[214] 标题应不动"
    report.append("G 两子图 groups=恰0;标题瘦身 13 处(⑤装配8+⑧加速5)✓")

    # H. 固定句/参数 SHA256 链式对拍(白名单外零漂移;verify-only 跳过=自比无义)
    if carried.get("surgical"):
        b_nodes = carried["nodes_asm"]
        subj_node = next(n for n in d["nodes"] if n["id"] == 24)
        pairs = [
            ("[24] 主体句", subj_node["widgets_values"][0], carried["host40_wv"][0]),
            ("[141] 锁层A", nodes[141]["widgets_values"][1], b_nodes[141]["widgets_values"][1]),
            ("[152] 头句", nodes[152]["widgets_values"][2], b_nodes[152]["widgets_values"][2]),
            ("[152] 尾句", nodes[152]["widgets_values"][3], b_nodes[152]["widgets_values"][3]),
            ("[152] W1", nodes[152]["widgets_values"][4], b_nodes[152]["widgets_values"][4]),
            ("[150] combo", nodes[150]["widgets_values"], b_nodes[150]["widgets_values"]),
            ("[140] PE 参数", nodes[140]["widgets_values"], b_nodes[140]["widgets_values"]),
        ]
        report.append("H 固定句/参数 SHA256 对拍:")
        for name, new, old in pairs:
            n16 = sha16(json.dumps(new, ensure_ascii=False))
            assert n16 == sha16(json.dumps(old, ensure_ascii=False)), \
                f"{name} 链式迁移漂移!"
            report.append(f"  {name} sha16={n16} ✓")
        for nid in (207, 7, 206, 198, 214, 31):
            an = next(n for n in acc["nodes"] if n["id"] == nid)
            assert an["widgets_values"] == carried["acc_nodes"][nid]["widgets_values"], \
                f"加速 [{nid}] widgets 漂移"
        report.append("  加速 6 件 widgets 逐字节一致 ✓")

        # I. 逻辑等价对拍:连线多重集差=恰白名单
        diff_added = [l for l in link_multiset(asm) if l not in carried["asm_links"]]
        diff_removed = [l for l in carried["asm_links"] if l not in link_multiset(asm)]
        want_added = sorted([
            (-10, 4, 151, 1, "BOOLEAN"),   # 68 PE开关扇出
            (-10, 4, 152, 0, "BOOLEAN"),   # 8 PE开关槽位随重排 5→4(语义不变)
            (-10, 5, 150, 1, "BOOLEAN"),   # 7 改端点(透明→透明覆盖)
            (-10, 6, 151, 4, "INT"),       # 69 手动宽
            (-10, 7, 151, 5, "INT"),       # 70 手动高
            (-10, 8, 140, 0, "CLIP"),      # 46 pe_clip槽位随重排 6→8(语义不变)
            (150, 5, 144, 2, "BOOLEAN"),   # 59 改端点
            (150, 5, 152, 1, "BOOLEAN"),   # 66 改端点
        ])
        want_removed = sorted([
            (-10, 4, 210, 0, "COMBO"),     # 7 旧形态
            (-10, 5, 152, 0, "BOOLEAN"),   # 8 旧形态(PE开关旧槽5)
            (-10, 6, 140, 0, "CLIP"),      # 46 旧形态(pe_clip旧槽6)
            (-10, 7, 151, 1, "BOOLEAN"),   # 47 画幅联动开关
            (150, 4, 210, 1, "BOOLEAN"),   # 61 rgba_hint
            (210, 0, 144, 2, "BOOLEAN"),   # 59 旧形态
            (210, 0, 152, 1, "BOOLEAN"),   # 66 旧形态
        ])
        assert sorted(diff_added) == want_added, f"连线新增漂移:{sorted(diff_added)}"
        assert sorted(diff_removed) == want_removed, f"连线移除漂移:{sorted(diff_removed)}"
        report.append("I 逻辑等价:连线多重集差=恰 7 形态移除+8 形态新增(白名单显式列名;"
                      "其中 link8/link46 两对=纯槽位随迁,语义不变)✓\n"
                      "  差异白名单=自由型透明路(150.透明覆盖/透明值)+手动宽高直布+透明布尔直布;"
                      "九型默认路径语义不变(透明值=rgba_default 同型直布/画幅 PE关=九型原样)")

        # J. 节点级深层对比(白名单外逐字节相等)
        ALLOWED_MUTATED = {150, 151, 140, 141, 142, 143, 144, 152, 250}
        for nid, bn in carried["nodes_asm"].items():
            an = nodes.get(nid)
            if an is None:
                assert nid == 210, f"节点 {nid} 消失(白名单外)"
                continue
            if nid not in ALLOWED_MUTATED:
                assert an == bn, f"节点 {nid} 白名单外漂移"
        report.append("J 节点级深层对比:白名单外节点逐字节相等 ✓([210] 退役;[150]/[151]"
                      " 接口面扩展;标题/pos 在白名单)")

    # K. 加速子图布局(⑨:出入口同横轴+三横线+零左向)
    xs = {nid: acc_nodes[nid]["pos"][0] for nid in acc_nodes}
    for l in acc["links"]:
        ox = acc["inputs"][l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 \
            else acc_nodes[l["origin_id"]]["pos"][0]
        tx = acc["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 \
            else acc_nodes[l["target_id"]]["pos"][0]
        assert tx > ox, f"加速子图左向线 link{l['id']}:ox={ox} tx={tx}(⑨ 应严格右向)"
    # 三横线带成员(y 带:0=直出[7] / 1=FunAcc[198] / 2=viggle[31][206];主轴=[207][198][214]+出入口)
    def band(y):
        return 0 if y < 300 else (1 if y < 700 else 2)
    bands = {}
    for nid, n in acc_nodes.items():
        bands.setdefault(band(n["pos"][1]), []).append(nid)
    assert sorted(bands.get(0, [])) == [7], f"线1(直出)成员漂移:{bands.get(0)}"
    assert sorted(bands.get(1, [])) == [198, 207, 214], f"线2(主轴/FunAcc)成员漂移:{bands.get(1)}"
    assert sorted(bands.get(2, [])) == [31, 206], f"线3(viggle)成员漂移:{bands.get(2)}"
    # 出入口同横轴:全部 IO 槽 pos y 与输出 y 都落在 y≈500±250 带
    for s in acc["inputs"] + acc["outputs"]:
        assert abs(s["pos"][1] - 500) <= 250, \
            f"IO 槽 {s['name']} y={s['pos'][1]} 不在主横轴带(500±250)"
    # 节点矩形零重叠
    ns = list(acc_nodes.values())
    for i in range(len(ns)):
        for j in range(i + 1, len(ns)):
            a, b = ns[i], ns[j]
            assert not (a["pos"][0] < b["pos"][0] + b["size"][0]
                        and b["pos"][0] < a["pos"][0] + a["size"][0]
                        and a["pos"][1] < b["pos"][1] + b["size"][1]
                        and b["pos"][1] < a["pos"][1] + a["size"][1]), \
                f"加速子图 node{a['id']} 与 node{b['id']} 矩形重叠"
    # 输出口最右 + 全节点 ≥80
    max_nx = max(n["pos"][0] for n in ns)
    for io in acc["outputs"]:
        assert io["pos"][0] >= max_nx - 50, f"输出口 {io['name']} 未钉最右列"
    for scope, allnodes in (("装配", asm["nodes"]), ("加速", acc["nodes"])):
        for n in allnodes:
            assert n["pos"][0] >= 80 and n["pos"][1] >= 80, \
                f"{scope}子图 node{n['id']} 负区坐标 {n['pos']}"
    # 装配子图零左向(既有口径复验)
    for l in asm["links"]:
        ox = asm["inputs"][l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 \
            else nodes[l["origin_id"]]["pos"][0]
        tx = asm["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 \
            else nodes[l["target_id"]]["pos"][0]
        assert tx > ox, f"装配子图左向线 link{l['id']}:ox={ox} tx={tx}"
    report.append("K 加速布局:三横线带成员锚+零左向线+IO 同横轴带+零重叠+输出口最右 ✓")

    # L. 引用一致性(零悬空零反向;主图+两子图)
    errs = consistency(d)
    assert errs == [], errs
    report.append("L 引用一致性:零悬空零反向;IO linkIds 逐项登记 ✓")

    # M. 计数器真值锚
    max_lid = max(l["id"] for l in asm["links"])
    assert asm["state"]["lastLinkId"] >= max_lid, "子图 lastLinkId 低于实存最大 link id"
    assert d.get("last_link_id", 0) >= max(l["id"] for l in asm["links"]), "根计数器低于子图最大 link id"
    report.append(f"M 计数器:lastLinkId={asm['state']['lastLinkId']} ≥ 实存最大 {max_lid};"
                  "根 last_link_id=97 ✓")

    # N. [10] 速查卡锚(大白话+迁入注记)
    note = next(n for n in d["nodes"] if n["id"] == 10)["widgets_values"][0]
    for tok in ("PE 开=自动", "PE 关=可手动", "手动宽", "手动高", "只填一个会报错",
                "九型全自动", "自由型才手动", "透明值", "十档", "自由", "10→9 节点",
                "三态件退役", "分组框全清空", "标题瘦身", "横向三支路三横线",
                "摆设值不生效", "cfg 恒 1", "qwen-image-2-1-prompter",
                "This is an RGBA format image with transparency.",
                "The image has an alpha channel and a transparent background.",
                "这是一张带有透明度的RGBA图像", "该图像具有alpha通道,背景是透明的"):
        assert tok in note, f"[10] 新锚 token 缺失:{tok}"
    assert note.lstrip().startswith("## "), "[10] 应以二级标题开幅(禁一级大标题)"
    report.append("N [10] 速查卡:21 新锚 token 全在场;大白话画幅/透明段+机制迁入 ✓")


def refresh_blueprint(d):
    """t2i 蓝图随役重建(extract 同款构造;蓝图 id 恒 BP_SG_ID 分轨)。"""
    asm = sg_of(d, ASM_UUID)
    host40 = next(n for n in d["nodes"] if n["id"] == 40)
    root = {
        "id": 1,
        "type": BP_SG_ID,
        "pos": [0, 0],
        "size": host40.get("size", [560, 480]),
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": copy.deepcopy(host40.get("inputs", [])),
        "outputs": copy.deepcopy(host40.get("outputs", [])),
        "properties": {"subgraph": BP_SG_ID, "previewExposures": []},
        "widgets_values": copy.deepcopy(host40.get("widgets_values", [])),
        "title": host40.get("title"),
    }
    sg_def = copy.deepcopy(asm)
    sg_def["id"] = BP_SG_ID
    old_bp = json.loads(BLUEPRINT.read_text(encoding="utf-8"))
    bp = {
        "revision": old_bp.get("revision", 1),
        "last_node_id": 1,
        "last_link_id": 0,
        "nodes": [root],
        "links": [],
        "version": old_bp.get("version", 0.4),
        "definitions": {"subgraphs": [sg_def]},
        "info": old_bp.get("info", {"category": "漫影",
                                    "name": "[40] 提示词类型优化子图"}),
    }
    # 形态对拍:信封键序/根节点键序与旧蓝图一致
    assert list(bp.keys()) == list(old_bp.keys()), \
        f"蓝图信封键序漂移:{list(bp.keys())} != {list(old_bp.keys())}"
    assert list(bp["nodes"][0].keys()) == list(old_bp["nodes"][0].keys()), \
        "蓝图根节点键序漂移"
    return bp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", default="all", choices=["all", "verify"])
    a = ap.parse_args()
    raw = WF.read_text(encoding="utf-8")
    d = json.loads(raw)
    assert sg_of(d, ASM_UUID) and sg_of(d, ACC_UUID), "子图 uuid 锚漂移,拒绝手术"

    for p in (SNAP_TMP, SNAP_OUT):
        p.mkdir(parents=True, exist_ok=True)

    if a.step == "verify":
        carried = {"asm_links": link_multiset(sg_of(d, ASM_UUID)),
                   "nodes_asm": {n["id"]: copy.deepcopy(n) for n in sg_of(d, ASM_UUID)["nodes"]},
                   "acc_nodes": {n["id"]: copy.deepcopy(n) for n in sg_of(d, ACC_UUID)["nodes"]},
                   "host40_wv": next(n for n in d["nodes"] if n["id"] == 40)["widgets_values"],
                   "surgical": False}
        # verify-only:逻辑等价/SHA 对拍(H/I/J)在 all 模式执行;此处跑结构面全断言
        report = ["(verify-only:逻辑等价/SHA 对拍在 all 模式执行)"]
        verify(d, carried, report)
        print("\n".join(report))
        return

    SNAP_TMP.joinpath("before.json").write_text(raw)
    SNAP_OUT.joinpath("before.json").write_text(raw)
    report = ["=" * 72, "qi21 用户测试批手术断言账(design §3 全表)", "=" * 72]

    before_snapshot, _ = do_surgery(d, report)
    carried = dict(before_snapshot)
    carried["acc_nodes"] = {n["id"]: copy.deepcopy(n)
                            for n in sg_of(d, ACC_UUID)["nodes"]}
    carried["surgical"] = True

    verify(d, carried, report)
    report += ["=" * 72, "全绿:手术成立,落盘(工作流+蓝图)", "=" * 72]

    out = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
    SNAP_TMP.joinpath("after.json").write_text(out)
    SNAP_OUT.joinpath("after.json").write_text(out)
    SNAP_TMP.joinpath("assertions.txt").write_text("\n".join(report) + "\n")
    SNAP_OUT.joinpath("assertions.txt").write_text("\n".join(report) + "\n")

    bp = refresh_blueprint(d)
    bp_out = json.dumps(bp, ensure_ascii=False, indent=2) + "\n"
    SNAP_TMP.joinpath("blueprint-after.json").write_text(bp_out)
    SNAP_OUT.joinpath("blueprint-after.json").write_text(bp_out)

    WF.write_text(out)
    BLUEPRINT.write_text(bp_out)
    print("\n".join(report))
    print(f"已落盘 {WF}")
    print(f"已落盘 {BLUEPRINT}(蓝图随役重建,id 恒 {BP_SG_ID[:8]} 分轨)")
    print(f"三件套:{SNAP_TMP} 与 {SNAP_OUT}(before/after/assertions/blueprint-after)")


if __name__ == "__main__":
    main()
