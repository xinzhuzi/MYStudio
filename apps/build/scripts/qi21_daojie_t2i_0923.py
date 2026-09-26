#!/usr/bin/env python3
"""qi21-道劫-t2i.json 幂等生成器(09-23;0925 加速与展示全量外露收窄轮)。

历史轮:改名→子图化(学 K2 [90])→底座美化→MyQi21DaojieBase 总装→RGBA 官方公式
→画幅联动→R26.4 LoRA 槽→满血接线 steps 联动→0925 布局美化/节点标题归位→
0926 子图 pos≥80 收口(实测发现项3:子图整体归一平移,自查零负区阈值 40→80 互锁)→
**0926 线不遮节点轮(用户令:「工作流的美化,你只管位置,不要线与节点彼此遮盖!」
实测(贝塞尔 41 点采样精判)该件曾有 21 条真遮挡——重灾区=主画布 [151]-[158]
画幅联动链菊花链互压([151]->[153] 遮 152、[153]->[156] 遮 154,155 等)与
[140]->[152] 遮 [40]、加速区 [30]/[179] 扇出遮串、[32]/[177]->[7] 遮 [5] 等;
本轮主画布全量重排+4 枚垫脚石 Reroute 归零,自查新增谓词「零线遮节点」互锁)**:
  - 画幅联动链改蛇形两行(上=宽路 [151][153][155][157] y1560,下=高路
    [152][154][156][158] y2100,列对齐 x3700/4240/4690/5230+高开关 [158] 让位
    x5900):同路横连走行内空档,跨路 [153]<->[156]/[154]<->[155] 走列间对角,
    wh_ratio 双降线走 [140] 右缘陡降走廊;
  - 行2 收敛为装配横排 [24]→[40]→[141]→[27](左右相邻零穿越);[140] PE 改写
    下沉 PE 带 y1450([11]→[140] 陡降,[140]→[141]/双正则斜上/陡下均零穿越);
  - [40].width/.height→联动开关 on_false 垫脚石 [191]/[192](九型 W/H 长横线
    先沿蛇形上带平走再陡降,避免直连斜穿列盒);[180] 总闸挪蛇形行间走廊右端;
  - 主链上移与蛇形同带([5] y1200/[7][8][9] y1560):[40].positive/.negative
    直连 [7] 零遮挡(不再需要通道件),[157]/[158]→[5] 陡升;
  - 加速区两行化(上=[32]@4900 y2600,下=[30]@2400 y2680/[177]@3800 y2900/
    [31]@4400 y2900/[178][179]@2400 y2900/3200):[30] 扇出走行间,
    [178]/[179] 垂直堆叠避菊花,[21] 顶通道 MODEL 垂降垫脚石 [190]@1100
    (x982-1218 装载器列缝)再平送 [31]/[32](直连斜穿 [3]/[140]/[151] 全避免);
  - 子图两笔:[173] H 通道拐点左移避 [150].WIDTH 升线;[143]->[144] 行3
    on_true 线几何上必过 [142](三行契约+成员序钉死),垫脚石 [175] 走行2-行3
    框间带拐弯。
本轮(Trellis 09-25-qi21-speed-subgraph,W1/W2/W3/W5/W6):

  W2 t2i PE 链迁出子图(0925 设计铁则 1/2:经常改动的量+需展示的结果=主画布):
    [140] QwenImage21_T2IPromptRewrite + [141] 提示词开关 + 画幅联动链
    [151]-[158](正则×2/转数×2/公式×2/双 INT 开关)全部从 [40] 子图迁到主画布,
    与 i2i/edit 的 PE 位置同构(均主画布);PE 开关=本件 widget(照 i2i [15] 式,
    不再占宿主面板);画幅联动开关改主画布 PrimitiveBoolean [180](铁则 1)。
    **结构性冻结项(契约冻结,仿 ad22a9e 先例)**:PE 开关在主画布+双路编码在子图
    (拍板③)⇒ [141] 输出必须回流 [40]「提示词」槽——文本出子图([40].prompt→
    [141].on_false 向右)再回子图([141]→[40].提示词)在几何上必有且恰 1 条
    左向线(target.x≤origin.x),横向铁律对该 link(id 34)单点豁免+新增谓词
    「左向线恰 1 条且端点=[141]→[40].提示词」钉死豁免不可蔓延。
  W3 [40] 子图收窄(铁则 4:子图只放九型+装配底层美术):
    迁出 PE 后子图 11 节点=MyQi21DaojieBase[150] 九选一+锁层A[110]+拼接
    [130][131]+RGBA 官方头尾/公式拼接 [160][161][162][163]+双路编码
    [142][143]+RGBA 开关 [144](拍板③:双路编码留子图);行式三行=源行/
    装配路由/编码输出(与 i2i 子图同构);宿主 widget 槽序收窄=主体句/型选择/
    RGBA透明开关(与 i2i 三 widget 同构),新增「提示词」link 输入槽(①=装配
    全文进 [141] 二选一后回编码)。九型 W/H 仍由 [150] 直出,经顶部 Reroute 通道
    (y=40/140 正区)自 width/height 输出直驱主画布 [157]/[158].on_false。
  W1 加速区组框收纳(方案 C·原生组框,拍板①):
    [30] 总闸/[32] MODEL 开关/[31] LoraLoaderModelOnly/[177] steps 联动开关/
    [178][179] 常量 40/6 六件收进主画布原生组框「道劫·加速区·总闸[30]」,
    Note 说明两态(关=40 步原味/开=viggle LoRA·6 步一拨全配);主图 group 预算
    3→4。[7] 面板 steps 显 40 与 [5] 面板 1024×1024=摆设值,Note 注明不生效。
  W5 Note 两笔终审(拍板④⑤):负面线=保留接线+Note 写明「cfg=1 下负面数学上
    不参与采样,占位为官方同构」;PE presence_penalty=1.5 定档(A/B 四维 57.5 vs
    55.0 略优,保留 1.5)。
  W6 画布归一:①负坐标归一——主画布+子图全部节点 pos≥40(整图平移至左上留
    边距,打开即全貌);②输出口最右——子图输出 IO 槽按新前端表示法钉死最右列
    (K2-文生图-道劫 [90] 实证:输出槽 x 超过全子图最右节点,纵向堆叠);③自查
    新增两谓词:零负区(主图+子图所有节点 pos≥40)+输出口最右(子图输出接口
    x≥全子图最大 x-50),与既有谓词(est 零重叠+横距≥200/纵距≥80)合成防线。

主画布布局(0926 线不遮节点轮全量重排,全部正区;从上到下=阶段带,行内从左到右):
  顶通道 y=80/170:MODEL 通道 [20][21]+垂降垫脚石 [190]@1100(x982-1218 装载器
             列缝,平送 [31]/[32] 两臂)/VAE 通道 [22]@[1420]→[23]@[6500]
  行1 y=320  加载器:[1] UNET/[2] 主TE/[3] VAE/[11] PE 专属 TE(不动)
  行2 y=960  装配横排:[24] 主体句→[40] 装配子图→[141] 提示词开关→[27] 装配预览
  PE 带 y=1450:[140] PE改写([11] 陡降喂 clip;wh_ratio 双陡降喂联动链正则)
  蛇形联动 y=1560/2100:上=宽路 [151]正则→[153]转数→[155]公式→[157]开关;
             下=高路 [152]→[154]→[156]→[158](col x3700/4240/4690/5230,
             [158] 让位 x5900 避 [32]→[7] 走廊);[40] W/H 经垫脚石 [191]/[192]
             沿上带平送再陡降;[180] 总闸在行间走廊右端 @4800,1810
  主链带 y=1200/1560:[5] 空潜@5980→[7] KSampler@6150→[8] 解码@6700→[9] 保存@7150
             ([40] positive/negative 直连 [7] 零遮挡)
  加速区 y=2600-3200(组框,两行):[30] 总闸@2400,2680/[177] steps开关@3800,2900/
             [31] LoRA@4400,2900/[32] MODEL开关@4900,2600/[178] 常量40@2400,2900/
             [179] 常量6@2400,3200(常量垂直堆叠避菊花,[30] 扇出走行间)
  Note [10] 左下独立;主图 group 恰 4=加载器/装配外露+PE/主链/加速区。

子图结构(宿主 [40],双击进入;行式三行):
  inputs(6): clip/vae(外连 [2][3])+ 主体句(外连 [24])+ 型选择(COMBO widget)
  + RGBA透明开关(BOOLEAN widget)+ 提示词(link,外连主画布 [141])。
  outputs(5): positive/negative(→[7] KSampler)、prompt(装配全文→[141].on_false,
  [27] 预览改接 [141] 输出=最终文本)、width/height(INT→[157]/[158].on_false)。
  行1 y=240   源行:[150] MyQi21DaojieBase+[110] 锁层A+[160][161] RGBA 官方头尾
  行2 y=1000  装配路由:[130] 拼接①(主体句+BASE)→[131] 拼接②(+锁层A)→
              [162][163] RGBA 公式拼接(头+装配全文+尾)
  行3 y=1760  编码输出:[143] RGBA编码→[142] 主编码(prompt 接「提示词」槽)→
              [144] RGBA 开关
  通道 y=40/140:W/H 升+顶横 Reroute 四拐点([171]-[174],est 盒互不重叠);
  group 三框各罩单一阶段行;子图输出 IO 槽 x=7300 钉死最右列(全子图最大节点
  x=7200,表示法=K2 [90] 实证)。

自查(写盘后必跑,任一失败退出码 1):json.loads 往返 / 主图+子图 link 双向一致 /
主图 LoRA 槽(恰1+name 预填+默认关+KSampler.model 上游=开关+关态干跑执行图零
LoraLoader)/ steps 联动(INT 开关+常量40/6+同一布尔源扇出+[7].steps 转输入+关态
干跑解析40+开态干跑([30]=true)解析6且 LoRA 在链)/
主图+子图横向排版(每条连线 target.x>origin.x,含 Reroute 段;边界线以 IO 槽 pos
为端点;**唯一豁免=冻结回流线 [141]→[40].提示词,且新增谓词钉死左向线恰 1 条
即该线**)/ 子图三行排版(按 y 分行恰 3 行=三阶段、Reroute 拐点不占行、行间净距
≥100、行内 x 严格递增;group 各框单一阶段行全部节点)/ 主图+子图节点矩形零重叠 /
est 间距(同行横距≥200/同列纵距≥80,Reroute/Note 豁免)+ est 足迹零重叠 /
group 预算(子图≤4、主图≤4[W1 加速区组框])+ 框两两不相交 /
**零负区(主图+子图所有节点 pos≥40)** / **输出口最右(子图输出接口 x≥全子图
最大 x-50)** / **零线遮节点(0926 铁律,主图+子图同口径:贝塞尔 41 点采样,
任采样点落入非端点节点盒 ±2 即遮挡;-10/-20 边界线与验收器同口径跳过)** /
主图+子图 group 全 int id / 子图 IO linkIds 逐项登记(契约铁律) /
道劫字号归位(组框/子图名/说明卡留道劫,节点标题零道劫=0925 裁定) / W1 加速区
组框在位且罩住六件 / MyQi21DaojieBase 在场+combo 默认人物+qi21_bases.json↔05 库
逐字互锁 / 锁层A 恒挂且逐字=库 / 级联退役(子图开关恰 1=RGBA;PE/联动链在主画布)/
PE 链主画布同构锚([140] 参数/pp=1.5 定档、[141] on_false←[40].prompt、
on_true←[140]、输出→[27]+[40].提示词) / 画幅联动链锚(正则/公式逐字、
[157][158].on_false←[40] 九型 W/H、switch←[180]、输出→[5]) / 干跑直写选配臂装配
逐字=库人物型组合(经 [141] on_false 臂回流;默认臂=PE 开路,0926 裁定1 含画布
本体:[141] 默认 true) / RGBA 官方头尾逐字 / steps=40 /
无孤儿节点(MarkdownNote 与 easy showAnything 显示型端点豁免)/ 说明 Note 必含要点。

不动 K2 侧任何文件;引擎家 userdata 零写入;不 git。重跑幂等:主体句默认与
锁层A 全文从 05 库文档现读,BASE 真源=qi21_bases.json,库更新后重跑即同步
(与契约测试 test_qwen21_workflow_contract.py 互锁)。真前端 graphToPrompt 干跑
与实弹出图由 e2e 层另行验证(引擎 v0.37 真前端直开为最终裁判)。

用法:
    python3 apps/build/scripts/qi21_daojie_t2i_0923.py            # 生成(写盘+自查)
    python3 apps/build/scripts/qi21_daojie_t2i_0923.py --check    # 只查不写
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

# ── 真源定位(零 cwd 依赖)──────────────────────────────────────────
_SCRIPT = pathlib.Path(__file__).resolve()
_REPO = _SCRIPT.parents[3]  # scripts → build → apps → 仓库根
_Q21_DIR = _REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图"
QI21_JSON = _Q21_DIR / "qi21-道劫-t2i.json"
PROMPT_LIB = _REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
BASES_JSON = _REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
QI21_BASES_JSON = _REPO / "apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json"

WF_UUID = "7d4a9c31-5e62-4b8a-b1f0-2c8e57a90413"   # 工作流 id,固定值幂等
SG_UUID = "c3f81b56-0a47-4d29-9e61-8b7f2d5a6c04"   # 装配子图 uuid,固定值幂等

# 人物系六型(库 §二:常量B 加挂型)
CHAR_TYPES = ("人物", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分")
# ④配色行映射(库 §一映射表;0925 四令多彩轮:宣纸白领头行退役,多彩行=生成器侧映射)
COLOR_MAP = {
    "人物": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "场景": "场景多彩=淡墨+青灰+青绿+赭石+旧金(大面积稳定基底+多色相铺陈各安其位)",
    "道具": "道具多彩=淡墨+旧金+玉青+赭石+朱红(大面积稳定基底+中等强度器物色+少量高识别强调色)",
    "美宣": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "三视图": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "高清人脸": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "分镜剧情图": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "表情差分": "人物多彩=淡墨+石青+青绿+赭石+旧金+朱红(大面积稳定基底+中等强度人物色+少量高识别强调色)",
    "概念气氛图": "场景多彩=淡墨+青灰+青绿+赭石+旧金(大面积稳定基底+多色相铺陈各安其位)",
}
PE_CLIP_FILE = "qwen_image_2.1_pe_t2i_bf16.safetensors".replace("qwen_image", "qwen3.5_9b_qwen_image")
# PE 参数(0925 拍板⑤:presence_penalty=1.5 定档——A/B 四维 57.5 vs 55.0 略优,保留)
PE_PARAMS = [1.0, 0.95, 20, 1.5, 16256, 42]
# PE 种子句(0925 毒理定案 R1/C1 反噪 + 0925 四令多彩化):PE 路旁路③层锁文,种子句是
# 唯一能携带反噪意志进 PE 路的通道——必须在风格前缀后自带表面洁净正向条款(措辞=05 库
# 常量A 禁纸纹条款的正向转写原文,零自造词),禁裸「水墨国风修仙:」前缀直发(九拍 PE 文
# 纹理语全部溯源到裸前缀,无第二风格源);四令多彩轮:留白/稀彩点题语退役,种子句多彩向
# (背景多色相铺陈+一点强调色),使 PE 扩围时同守四令(大面积留白/素净暖白=按图选配);
# 纪律=05 库 §一/§六「PE 种子纪律」。
PE_SEED_PROMPT = ("水墨国风修仙,画面干净平滑,墨与色落在浅净平涂色场上,"
                  "而非纸面纹理:一位修士立于云中山巅,渡劫前夜,背景青灰远山与青绿草木"
                  "多色相铺陈,朱红灯塔一点强调色")
DEFAULT_TYPE = "人物"

# RGBA 官方公式头尾(research/12 答A必改1;逐字对齐官方模板原文)
RGBA_HEAD_EN = "This is an RGBA image with transparency."
RGBA_TAIL_EN = "The image has alpha channel and the background is transparent."
RGBA_HEAD_ZH = "这是一张带有透明度的RGBA图像。"
RGBA_TAIL_ZH = "该图像具有alpha通道,背景是透明的。"

# 画幅联动:PE 建议 wh_ratio(如 "16:9")→ 4.2MP 档宽高(口径=native_px)
RATIO_W_PATTERN = r"^\s*(\d+)"
RATIO_H_PATTERN = r":\s*(\d+)\s*$"
MATH_W_EXPR = "round(a*sqrt(4.2*1024*1024/(a*b))/8)*8"
MATH_H_EXPR = "round(b*sqrt(4.2*1024*1024/(a*b))/8)*8"

# 子图内部节点 id(独立 id 空间;0925 W3 收窄后 11 节点,与 i2i 子图同构)
BASE_ID = 150                                              # MyQi21DaojieBase 九选一
LOCK_ID = 110                                              # 通用锁层常量A
RGBA_HEAD_ID, RGBA_TAIL_ID = 160, 161                      # RGBA 官方头/尾常量(EN)
CONCAT1_ID, CONCAT2_ID = 130, 131                          # 装配拼接①②
RGBA_CAT1_ID, RGBA_CAT2_ID = 162, 163                      # RGBA 公式拼接
TE_ID, TE_RGBA_ID, RGBA_SW_ID = 142, 143, 144              # 主编码/RGBA 编码/RGBA 开关
# 子图 W/H 顶部通道 Reroute(0925 W6 零负区:y=40/140 正区通道带)
RR_W_A_ID, RR_W_B_ID = 171, 172                            # WIDTH 通道(升/顶横)
RR_H_A_ID, RR_H_B_ID = 173, 174                            # HEIGHT 通道(升/顶横)
RR_SWC_ID = 175        # 0926 线不遮节点:[143]->[144] 行3 on_true 垫脚石
                       # (行3 成员序 [143][142][144] 钉死,直连几何上必过 [142])
HOST_ID = 40                                               # 主图子图宿主
SUBJECT_ID, PREVIEW_ID = 24, 27                            # 主图外露主体句/装配预览
LATENT_ID, SAMPLER_ID = 5, 7                               # 主图空潜/KSampler
# PE 链(0925 W2 迁出子图→主画布;id 承袭,与 i2i/edit 的 PE 位置同构=均主画布)
PE_RW_ID, PE_SW_ID = 140, 141                              # PE 改写/提示词开关
RATIO_RW_ID, RATIO_RH_ID = 151, 152                        # 正则取宽/高比
CONV_RW_ID, CONV_RH_ID = 153, 154                          # 字串→数
MATH_W_ID, MATH_H_ID = 155, 156                            # 公式求宽/高
SW_W_ID, SW_H_ID = 157, 158                                # 宽/高联动开关(INT)
RATIO_PB_ID = 180                                          # 画幅联动总闸(主画布,默认关)
# 主图通道 Reroute(MODEL y=80 / VAE y=170 顶缘通道,正区)
RR_M8A_ID, RR_M8B_ID = 20, 21                              # MODEL 通道
RR_M10A_ID, RR_M10B_ID = 22, 23                            # VAE 通道
# 0926 线不遮节点轮垫脚石(通道拐点不占行,Reroute est 零重叠豁免间距不豁免重叠)
RR_M8C_ID = 190        # MODEL 低位垂降拐点:[21] 顶通道在 x982-1218 装载器列缝
                       # 垂降后平送 [31]/[32] 两臂(直连斜穿 [3]/[140]/[151] 全避免)
RR_WH_W_ID, RR_WH_H_ID = 191, 192   # [40].width/.height→联动开关 on_false 中继:
                                     # 九型 W/H 长横线沿蛇形上带平走再陡降,不斜穿列盒
# R26.4 LoRA 加速槽三件 + 满血接线 steps 联动三件(W1 组框收纳)
LORA_PB_ID, LORA_ID, LORA_SW_ID = 30, 31, 32
LORA_FILE = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors"
STEPS_SW_ID, STEPS_C40_ID, STEPS_C6_ID = 177, 178, 179
STEPS_OFF, STEPS_ON = 40, 6   # 关=40 官方完整档(原路)/开=6(v0.2.1 系卡荐档,一拨全配)

# 宿主 widget 型子图输入(槽序=inputs 数组序;widgets_values 按此序;0925 W3 收窄)
WIDGET_INPUTS = [
    ("主体句", "STRING"), ("型选择", "COMBO"), ("RGBA透明开关", "BOOLEAN"),
]
# 冻结回流线(契约冻结项):[141] 输出→[40]「提示词」槽——PE 开关在主画布(W2)+
# 双路编码在子图(拍板③)⇒ 文本出子图再回子图,几何上必有且恰 1 条左向线。
FROZEN_BACK_LINK = 34   # link id;横向铁律单点豁免,自查钉死「左向线恰此 1 条」

NOTE_TEXT = (
    "## 道劫 · Qwen-Image-2.1 文生图(装配子图版·0925 加速与展示全量外露收窄轮)\n\n"
    "K2 道劫『一处选型+分件装配+子图收装』思想的 Q2-1 原生落地(0925 铁则:经常改动的量"
    "与需展示的结果=主画布;子图只放九型分类+装配底层美术)。**[40] 装配子图**(双击进入="
    "底座九选一节点+锁层恒挂+换行拼接+RGBA 公式拼接+双路编码);**PE 改写链与画幅联动链"
    "已迁主画布**([140]→[141] 提示词开关→[27] 装配预览;[151]-[158]+[180]),提示词真源="
    "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md(②层底座=09-23 美化版,canon-json "
    "逐字锚废止,型名/顺序仍对齐 daojie_bases.json)。\n\n"
    "### 怎么换型(一处切换)\n"
    "- 主画布点选 [40] 装配子图,面板「型选择」下拉九选一(默认①人物):人物/场景/道具/美宣/"
    "三视图/高清人脸/分镜剧情图/表情差分/概念气氛图——子图内 MyQi21DaojieBase 节点按选型出 "
    "BASE(该型②层底座+人物系增量四锁B+④配色行,真源=qi21_bases.json 磁盘热读,逐字=05 库)"
    "与 WIDTH/HEIGHT(型档分辨率直出)。\n"
    "- **分辨率随型自动**:[40] 子图 width/height 输出→[157]/[158] 联动开关 on_false(默认路)"
    "→直驱 [5] 空潜宽高(ResolutionSelector 已退役;九型档=qi21_bases.json 的 aspect/MP/"
    "override,三视图 3072×1024 直出)——换型不再手动切档;[5] 面板 1024×1024=**摆设值不生效**"
    "(实际由联动开关供给)。\n"
    "- 换型后 [24] 主体句须同步换成本型主体句(各型例句见库文档;场景/概念气氛图不写人——"
    "空镜句尾可明写「空镜无人」);主体句只写主体与画面,不重复风格词,全角标点,质量词/比例词/"
    "否定式禁入(库文档主体句纪律五则)。\n"
    "- 警示(手贴 vs 重跑):手贴内容只活在画布件——生成脚本重跑会把主体句默认/锁层全文重置回"
    "库文档现读值(底座 BASE 不经画布常量、直读 qi21_bases.json,库更新重跑提取脚本即同步),"
    "要长久保留先回写库文档再重跑,或重跑前另存画布件。\n\n"
    "### 装配怎么拼([24] 唯一手写位;最终文本在主画布 [141])\n"
    "- 拼法=库文档四层装配『主体句领头+换行分层』:子图内拼接把 [24] 主体句 + [150] 当前型 "
    "BASE + [110] 通用锁层常量A(③层,库首节全文,全九型恒挂不随型)逐层接成一段,经子图 "
    "prompt 输出到主画布 **[141] 提示词开关**(true=PE 扩写=**默认 PE 改写**(0926 裁定1:"
    "多彩时代默认 PE 开路,任何人打开默认走 PE;false=直写装配=按图选配,单图手动关)——"
    "开关输出=将进编码的最终文本,接 [40]「提示词」槽回编码,并过目 [27] 装配预览。\n"
    "- 层次序注:画布装配行序=①主体句→②型底座→(人物系增量锁)→④配色行→③通用锁层;库文档"
    "直写件行序=①②③(内嵌增量锁)④——层内容零差异,仅行序不同(锁层常量恒挂不可拆,增量锁"
    "随型走在 BASE 内)。\n"
    "- 甲案围栏:本链为甲案全中文直书(中文合法);与 PE/乙案英文长文禁混——主画布 [141] 提示词"
    "开关开=走 PE 改写路(中文种子句进、英文长文出,整体替换装配全文),与本链二选一(库文档"
    "禁混条款一)。\n\n"
    "### PE 与画幅联动(0925 迁主画布;[141] 默认开=PE 开路(0926 裁定1)/[180] 默认关=恒九型)\n"
    "- [140] PE 改写(默认随 [141] 开路即入链载 PE 模型;关 [141]=直写选配时旁路懒执行不载):"
    "PE 参数=插件官方 README 推荐值"
    "(temp1.0/topP0.95/topK20/**presence_penalty=1.5 已定档**(0925 拍板:A/B 四维 57.5 vs "
    "55.0 略优,保留 1.5)/max16256/seed42)。\n"
    "- [140] **PE 种子纪律**(0925 毒理定案 C1,反噪):PE 路旁路③层锁文,种子句是唯一能"
    "携带反噪意志进 PE 路的通道——种子句在风格前缀后自带表面洁净正向条款「画面干净平滑,"
    "墨与色落在浅净平涂色场上,而非纸面纹理」(措辞=05 库常量A 禁纸纹条款的正向转写原文,"
    "零自造词),**禁止裸「水墨国风修仙:」前缀直发**(九拍 PE 文的纹理语全部溯源到裸前缀,"
    "无第二风格源);[140] 种子句默认值已按此落盘,驱动脚本与人工发拍同守此纪律"
    "(宪法=05 库 §一/§六「PE 种子纪律」)。\n"
    "- [180] 画幅联动开关(默认关):开=[140] PE 建议画幅 wh_ratio 经 [151]-[158](正则/转数/"
    "公式)接管 [5] 宽高(4.2MP 档);恒九型仍是业务默认,故默认关;开联动会把 PE 组拉入执行"
    "(PE 开关同开才有意义),PE 未给建议画幅时该路报错——常规出图保持关闭。\n"
    "- 起草/改写提示词唤取技能 qwen-image-2-1-prompter。\n\n"
    "### 负面线说明(cfg=1 占位,W5 终审)\n"
    "- **cfg=1 下负面提示词数学上不参与采样**;[40] negative 输出→[7] 负向槽的接线保留,纯为"
    "与官方模板同构的**占位**(不生效)。要用负向须抬 cfg,非本产线口径。\n\n"
    "### LoRA 加速区(主画布组框收纳,W1 方案C;[30] 总闸默认关=正常生成)\n"
    "- 组框内六件:[30] 总闸/[32] MODEL 开关(false=MODEL 直连/true=[31] LoraLoaderModelOnly)"
    "/[31] LoRA(name 预填 **" + LORA_FILE + "**,viggle 蒸馏件已装机,strength 0.8——0925 探针最优:flatMAD 2.52→1.75 细腻无结构缺陷;8步方案 2.60 无收益+超荐档弃)/"
    "[177] steps 联动开关+[178] 常量 40/[179] 常量 6。\n"
    "- **关闭=正常生成**(默认):MODEL 直连进 [7],LoRA 不加载,40 步主线不动。\n"
    "- **一拨全配(开=自动 6 步加速,关=自动回 40,无需手动调)**:[30] 同时驱动 MODEL 开关与 "
    "[177] steps 联动 INT 开关(false→[178] 常量 40/true→[179] 常量 6→[7].steps,widget 已转"
    "输入)——开 [30] 一拨,LoRA 挂链+步数自动 6(v0.2.1 系卡荐档,cfg 保持 1);关掉一拨,"
    "LoRA 卸链+步数自动回 40(官方完整档);**[7] 面板 steps 显 40=摆设值不生效**(实际由 "
    "[177] 联动供给,断链才回显 widget)。模型卡注 shift_terminal=0.02 伤末步,画质异常先查"
    "调度。\n"
    "- TE-Speed 槽不加(3c 试装已死归档:插件未装=画布红节点,D4 终审永不装)。\n\n"
    "### 参数圣经\n"
    "- cfg 恒 1(负面=官方同构占位,见上节);**步数 40(官方完整档;官方区间 40-50,起手即"
    "完整态;[30] 开=自动 6,由 [177] 联动开关供给,[7] 面板不再手调)**;"
    "分辨率走 [40] 子图随型直驱经 [157]/[158](宽高恒 8 倍数);seed 在 [7] KSampler(默认 "
    "fixed=0 可复现);风格终审=用户。\n"
    "- 生成脚本=apps/build/scripts/qi21_daojie_t2i_0923.py(幂等;主体句默认/锁层全文从库文档"
    "现读,BASE 真源=qi21_bases.json,重跑即同步)。\n"
    "- RGBA 透明(默认关):官方公式 This is an RGBA image with transparency. [装配全文,与 "
    "[27] 同源]. The image has alpha channel and the background is transparent.(头尾逐字=官方"
    "原文,子图 [160][161][162][163] 现拼;中文同款:这是一张带有透明度的RGBA图像。……该图像"
    "具有alpha通道,背景是透明的。)透明路出图必须存 PNG 才保 alpha。\n"
)


# ── 真源解析(05 库文档;②层=09-23 美化版;qi21_bases.json 互锁)────────
def load_truth() -> dict:
    """返回 {types:[{zh,aspect,mp,subject,base,middle_is_char,constant_text}], const_a}。

    constant_text=该型底座应有全文=②美化版底座(+常量B·人物系增量四锁)+④配色行;
    并与 qi21_bases.json(MyQi21DaojieBase 运行时真源)逐字互锁——两账漂移即拒生成。
    """
    md = PROMPT_LIB.read_text(encoding="utf-8")
    bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))
    qi21_bases = json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))
    zh_order = [b["zh"] for b in bases]
    if [e.get("zh") for e in qi21_bases] != zh_order:
        raise SystemExit("qi21_bases.json 条目 zh 顺序与 daojie_bases.json 不一致(真源链断)")
    qi21_by_zh = {e["zh"]: e for e in qi21_bases}

    headings = re.findall(r"^### (.+?)-基础\s*$", md, re.M)
    if headings != zh_order:
        raise SystemExit(f"库 ### 九型标题与 daojie_bases.json zh 顺序不一致: {headings} vs {zh_order}")

    head = md.split("## 三、")[0]
    fences = re.findall(r"```text\n(.*?)\n```", head, re.S)
    if len(fences) < 3:
        raise SystemExit("库 §二 常量围栏不足(应含 装配顺序块+常量A+常量B)")
    const_a, const_b = fences[1], fences[2]
    b_lines = const_b.split("\n")

    types = []
    for zh, canon in zip(zh_order, bases):
        m = re.search(rf"^### {zh}-基础\s*$", md, re.M)
        if not m:
            raise SystemExit(f"库文档缺条目: ### {zh}-基础")
        fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S)
        if not fence:
            raise SystemExit(f"条目 {zh} 缺 ```text 装配全文围栏")
        lines = fence.group(1).split("\n")
        subject_wrapped, base_line, middle, color = lines[0], lines[1], lines[2:-1], lines[-1]
        if not (subject_wrapped.startswith("⟨①:") and subject_wrapped.endswith("⟩")):
            raise SystemExit(f"条目 {zh} 首行非 ⟨①:…⟩ 主体槽")
        # ③层互锁:人物系=[A1,A2,B×4,A3] 七行,场景系=[A1,A2,A3] 三行
        is_char = zh in CHAR_TYPES
        want_len = 7 if is_char else 3
        if len(middle) != want_len:
            raise SystemExit(f"条目 {zh} ③锁层行数 {len(middle)} ≠ {want_len}(库结构漂移)")
        if middle[2:6] != b_lines and is_char:
            raise SystemExit(f"条目 {zh} ③锁层中段与常量B 不逐字一致")
        if color != COLOR_MAP[zh]:
            raise SystemExit(f"条目 {zh} ④配色行与 §一映射表不一致")
        constant_text = "\n".join([base_line] + (b_lines if is_char else []) + [color])
        # 真源链互锁:qi21_bases.json(节点运行时读)与 05 库(文档真源)逐字一致
        if qi21_by_zh[zh].get("base_text") != constant_text:
            raise SystemExit(f"qi21_bases.json 「{zh}」base_text 与 05 库②层(美化版)装配不逐字一致"
                             "(先重跑 qi21_bases_extract_0923.py 同步提取)")
        types.append({
            "zh": zh,
            "aspect": canon["aspect_ratio"],
            "mp": canon["megapixels"],
            "subject": subject_wrapped[len("⟨①:"):-len("⟩")],
            "base": base_line,
            "constant_text": constant_text,
        })
    if len({t["constant_text"] for t in types}) != 9 or len({t["base"] for t in types}) != 9:
        raise SystemExit("九型底座常量两两不唯一")
    return {"types": types, "const_a": const_a}


def _qi21_base_text(zh: str) -> str:
    """MyQi21DaojieBase 运行时将读出的 BASE(干跑用;qi21_bases.json 现读)。"""
    entries = json.loads(QI21_BASES_JSON.read_text(encoding="utf-8"))
    for e in entries:
        if e.get("zh") == zh:
            return e["base_text"]
    raise SystemExit(f"qi21_bases.json 缺「{zh}」条目")


# ── 节点工厂(序列化口径承 qwen21 族在库件/K2 件/官方 blueprint)─────────
def _string_constant(nid: int, title: str, text: str, pos: list, links: list[int], size: list) -> dict:
    return {
        "id": nid, "type": "StringConstant", "title": title,
        "pos": pos, "size": size, "flags": {}, "order": 0, "mode": 0,
        "inputs": [],
        "outputs": [{"name": "STRING", "type": "STRING", "links": links}],
        "properties": {"Node name for S&R": "StringConstant"},
        "widgets_values": [text],
    }


def _switch(nid: int, title: str, false_link: int, true_link: int, switch_link: int,
            out_links: list[int], pos: list, typ: str = "STRING", default: bool = False) -> dict:
    """开关:switch 槽为 widget 转输入(接 -10 边界或主画布布尔源;None=本件 widget,
    照 i2i [15] PE 开关式——主画布 PE 开关不再占宿主面板)。default=widget 默认值
    (0926 裁定1:PE 开路含画布本体,[141] 默认 true;其余开关一律默认 false)。"""
    return {
        "id": nid, "type": "ComfySwitchNode", "title": title,
        "pos": pos, "size": [380, 120], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "on_false", "shape": 7, "type": typ, "link": false_link},
            {"name": "on_true", "shape": 7, "type": typ, "link": true_link},
            {"name": "switch", "type": "BOOLEAN", "widget": {"name": "switch"}, "link": switch_link},
        ],
        "outputs": [{"name": "output", "type": typ, "links": out_links}],
        "properties": {"Node name for S&R": "ComfySwitchNode"},
        "widgets_values": [default],
    }


def _concatenate(nid: int, title: str, a_link: int, b_link: int, out_links: list[int], pos: list,
                 delimiter: str = "\n") -> dict:
    return {
        "id": nid, "type": "StringConcatenate", "title": title,
        "pos": pos, "size": [380, 180], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "string_a", "type": "STRING", "widget": {"name": "string_a"}, "link": a_link},
            {"name": "string_b", "type": "STRING", "widget": {"name": "string_b"}, "link": b_link},
        ],
        "outputs": [{"name": "STRING", "type": "STRING", "links": out_links}],
        "properties": {"Node name for S&R": "StringConcatenate"},
        "widgets_values": ["", "", delimiter],
        "widgets_values_named": {"delimiter": delimiter},
    }


def _reroute(nid: int, pos: list, in_link: int, out_link, typ: str) -> dict:
    """Reroute 通道拐点(序列化逐字段=K2-角色设定-道劫.json 顶层级实取样板;
    out_link 可单线 int 或扇出 list——R26.4 起 MODEL 通道扇出直连/LoRA 两臂)。"""
    return {
        "id": nid, "type": "Reroute", "pos": pos, "size": [75, 26],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "", "type": "*", "link": in_link}],
        "outputs": [{"name": "", "type": typ,
                     "links": out_link if isinstance(out_link, list) else [out_link]}],
        "properties": {"showOutputText": False, "horizontal": False},
    }


def _primitive_int(nid: int, title: str, value: int, pos: list, out_link: int) -> dict:
    """PrimitiveInt 常量(steps 联动臂;序列化逐字段=官方本地 I2V-480P 模板实取样板:
    widgets_values=[value,"fixed"] 带 control_after_generate + named 双记账)。"""
    return {
        "id": nid, "type": "PrimitiveInt", "title": title,
        "pos": pos, "size": [270, 90], "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "value", "type": "INT", "widget": {"name": "value"}, "link": None}],
        "outputs": [{"name": "INT", "type": "INT", "links": [out_link]}],
        "properties": {"cnr_id": "comfy-core", "Node name for S&R": "PrimitiveInt"},
        "widgets_values": [value, "fixed"],
        "widgets_values_named": {"value": value, "fixed": "fixed"},
    }


def _trace_origin(i_links: dict, i_nodes: dict, lid: int) -> int:
    """沿 link 反向溯源,穿过 Reroute 通道拐点回到实源节点 id(-10 边界照实返回)。"""
    seen = set()
    while True:
        l = i_links[lid]
        oid = l["origin_id"]
        if oid == -10 or i_nodes[oid]["type"] != "Reroute" or oid in seen:
            return oid
        seen.add(oid)
        lid = i_nodes[oid]["inputs"][0]["link"]


# ── 子图构建(0925 W3 收窄:九型+锁层+拼接+RGBA 公式+双路编码;三行)───────
def _internal_link(lid: int, oid: int, oslot: int, tid: int, tslot: int, typ: str) -> dict:
    return {"id": lid, "origin_id": oid, "origin_slot": oslot,
            "target_id": tid, "target_slot": tslot, "type": typ}


def build_subgraph(truth: dict) -> tuple[dict, list[dict]]:
    """返回 (subgraph 定义, 内部 link 对象表)。

    布局(0925 W6 零负区:全部节点 pos≥40):
      通道带 y=40/140:W/H 升+顶横 Reroute 四拐点(不占阶段行)
      行1 y=240   源行:[150] 底座九选一/[110] 锁层A/[160][161] RGBA 头尾
      行2 y=1000  装配路由:[130] 拼接①→[131] 拼接②→[162][163] RGBA 公式拼接
      行3 y=1760  编码输出:[143] RGBA 编码→[142] 主编码(prompt 接「提示词」槽)
                  →[144] RGBA 开关
    输出 IO 槽 x=7300 钉死最右列(全子图最大节点 x=7200;表示法=K2 [90] 实证)。
    """
    links: list[dict] = []
    # -10 扇出(边界线;widget 型输入 linkIds 同样逐项登记=契约铁律)
    links.append(_internal_link(1, -10, 0, TE_ID, 0, "CLIP"))            # clip → 主编码
    links.append(_internal_link(2, -10, 0, TE_RGBA_ID, 0, "CLIP"))       # clip → RGBA 编码
    links.append(_internal_link(3, -10, 1, TE_ID, 2, "VAE"))             # vae → 主编码
    links.append(_internal_link(4, -10, 1, TE_RGBA_ID, 2, "VAE"))        # vae → RGBA 编码
    links.append(_internal_link(5, -10, 2, CONCAT1_ID, 0, "STRING"))     # 主体句 → 拼接①.string_a
    links.append(_internal_link(6, -10, 3, BASE_ID, 0, "COMBO"))         # 型选择 → MyQi21DaojieBase.base
    links.append(_internal_link(7, -10, 4, RGBA_SW_ID, 2, "BOOLEAN"))    # RGBA透明开关 → [144].switch
    links.append(_internal_link(8, -10, 5, TE_ID, 3, "STRING"))          # 提示词(主图[141]回流) → 主编码.prompt
    # 装配链(9-12)
    links.append(_internal_link(9, BASE_ID, 0, CONCAT1_ID, 1, "STRING"))    # BASE → 拼接①.string_b
    links.append(_internal_link(10, LOCK_ID, 0, CONCAT2_ID, 1, "STRING"))   # 锁层A 恒挂 → 拼接②
    links.append(_internal_link(11, CONCAT1_ID, 0, CONCAT2_ID, 0, "STRING"))
    links.append(_internal_link(12, CONCAT2_ID, 0, RGBA_CAT1_ID, 1, "STRING"))  # 装配全文 → RGBA 公式①
    # RGBA 官方公式拼接(13-16;头句+装配全文+尾句)
    links.append(_internal_link(13, RGBA_HEAD_ID, 0, RGBA_CAT1_ID, 0, "STRING"))
    links.append(_internal_link(14, RGBA_CAT1_ID, 0, RGBA_CAT2_ID, 0, "STRING"))
    links.append(_internal_link(15, RGBA_TAIL_ID, 0, RGBA_CAT2_ID, 1, "STRING"))
    links.append(_internal_link(16, RGBA_CAT2_ID, 0, TE_RGBA_ID, 3, "STRING"))  # → RGBA 编码.prompt
    # 编码与 RGBA 开关(17-21;0926:[143]->[144] on_true 经垫脚石 [175] 拐弯——
    # 行3 成员序 [143][142][144] 钉死,直连线几何上必横穿 [142] 盒)
    links.append(_internal_link(17, TE_ID, 0, RGBA_SW_ID, 0, "CONDITIONING"))
    links.append(_internal_link(18, TE_RGBA_ID, 0, RR_SWC_ID, 0, "CONDITIONING"))
    links.append(_internal_link(28, RR_SWC_ID, 0, RGBA_SW_ID, 1, "CONDITIONING"))
    links.append(_internal_link(19, RGBA_SW_ID, 0, -20, 0, "CONDITIONING"))   # → 输出 positive
    links.append(_internal_link(20, TE_ID, 1, -20, 1, "CONDITIONING"))        # 主编码.negative → 输出
    links.append(_internal_link(21, CONCAT2_ID, 0, -20, 2, "STRING"))         # 装配文本 → 输出 prompt
    # 九型 WIDTH/HEIGHT → 顶部通道(升→顶横→输出槽,全程右向)→ 输出(22-27)
    links.append(_internal_link(22, BASE_ID, 1, RR_W_A_ID, 0, "INT"))
    links.append(_internal_link(23, RR_W_A_ID, 0, RR_W_B_ID, 0, "INT"))
    links.append(_internal_link(24, RR_W_B_ID, 0, -20, 3, "INT"))             # → 输出 width
    links.append(_internal_link(25, BASE_ID, 2, RR_H_A_ID, 0, "INT"))
    links.append(_internal_link(26, RR_H_A_ID, 0, RR_H_B_ID, 0, "INT"))
    links.append(_internal_link(27, RR_H_B_ID, 0, -20, 4, "INT"))             # → 输出 height
    assert sorted(l["id"] for l in links) == list(range(1, 29))

    nodes: list[dict] = []
    # 行1 源行(列距≥200 est 足迹口径)
    nodes.append({
        "id": BASE_ID, "type": "MyQi21DaojieBase",
        "title": "底座九选一(MyQi21DaojieBase:BASE=②+B+④ 逐字=05库/宽高随型直出/磁盘热读)",
        "pos": [40, 240], "size": [420, 200], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "base", "type": "COMBO", "widget": {"name": "base"}, "link": 6},
        ],
        "outputs": [
            {"name": "BASE", "type": "STRING", "links": [9]},
            {"name": "WIDTH", "type": "INT", "links": [22]},
            {"name": "HEIGHT", "type": "INT", "links": [25]},
            {"name": "型名", "type": "STRING", "links": None},
        ],
        "properties": {"Node name for S&R": "MyQi21DaojieBase"},
        "widgets_values": [DEFAULT_TYPE],
    })
    nodes.append(_string_constant(
        LOCK_ID, "通用锁层常量A(③层·库首节全文·全九型恒挂)",
        truth["const_a"], [660, 240], [10], [440, 400]))
    nodes.append(_string_constant(
        RGBA_HEAD_ID, "RGBA官方头句(EN·逐字=官方模板)", RGBA_HEAD_EN,
        [1300, 240], [13], [380, 120]))
    nodes.append(_string_constant(
        RGBA_TAIL_ID, "RGBA官方尾句(EN·逐字=官方模板)", RGBA_TAIL_EN,
        [1880, 240], [15], [380, 120]))

    # 行2 装配路由
    nodes.append(_concatenate(
        CONCAT1_ID, "装配拼接①(主体句+BASE;delimiter=\\n)", 5, 9, [11], [100, 1000]))
    nodes.append(_concatenate(
        CONCAT2_ID, "装配拼接②(+通用锁层恒挂;delimiter=\\n)", 11, 10, [12, 21], [680, 1000]))
    nodes.append(_concatenate(
        RGBA_CAT1_ID, "RGBA公式拼接①(官方头句+装配全文;delimiter=空格)", 13, 12, [14],
        [1560, 1000], delimiter=" "))
    nodes.append(_concatenate(
        RGBA_CAT2_ID, "RGBA公式拼接②(+官方尾句;delimiter=空格)", 14, 15, [16],
        [2140, 1000], delimiter=" "))

    # 行3 编码输出(TextEncode 输入序=官方:clip/images.image_1/vae/prompt)
    def _textencode(nid: int, title: str, pos: list, clip_l: int, vae_l: int,
                    prompt_link, prompt_text: str, pos_links) -> dict:
        return {
            "id": nid, "type": "TextEncodeQwenImage21", "title": title,
            "pos": pos, "size": [420, 320], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"name": "clip", "type": "CLIP", "link": clip_l},
                {"name": "images.image_1", "type": "IMAGE", "shape": 7, "link": None},
                {"name": "vae", "type": "VAE", "shape": 7, "link": vae_l},
                {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": prompt_link},
            ],
            "outputs": [
                {"name": "positive", "type": "CONDITIONING", "links": pos_links},
                {"name": "negative", "type": "CONDITIONING", "links": (
                    [20] if nid == TE_ID else None)},
                {"name": "latent", "type": "LATENT", "links": None},
            ],
            "properties": {"Node name for S&R": "TextEncodeQwenImage21"},
            "widgets_values": [prompt_text, "", 1024],
        }

    nodes.append(_textencode(TE_RGBA_ID, "RGBA编码(官方公式拼接路,默认旁路)",
                             [3000, 1760], 2, 4, 16, "", [18]))
    nodes.append(_textencode(TE_ID, "主编码(prompt 接「提示词」槽=主画布[141]开关回流)",
                             [3620, 1760], 1, 3, 8, "", [17]))
    nodes.append(_switch(
        RGBA_SW_ID, "RGBA开关(false=普通 / true=透明,透明图存PNG)", 17, 28, 7, [19],
        [4240, 1760], typ="CONDITIONING"))

    # 通道 Reroute 拐点(0925 W6 零负区:y=40(W)/140(H) 正区通道带,est 盒互不重叠
    # 亦不压行1;拐点 x 排布=升线在 [150] 右、顶横右行至输出槽近旁;0926 线不遮节点:
    # [173] 左移至 (700,120) 避 [150].WIDTH 升线,[175] 走行2-行3 框间带)
    nodes.append(_reroute(RR_W_A_ID, [1080, 40], 22, 23, "INT"))
    nodes.append(_reroute(RR_W_B_ID, [7040, 40], 23, 24, "INT"))
    nodes.append(_reroute(RR_H_A_ID, [700, 120], 25, 26, "INT"))
    nodes.append(_reroute(RR_H_B_ID, [7200, 140], 26, 27, "INT"))
    nodes.append(_reroute(RR_SWC_ID, [3860, 1660], 18, 28, "CONDITIONING"))

    for order, n in enumerate(nodes):
        n["order"] = order

    # 内部分组(三框各罩单一阶段行,边到边;通道拐点留框间带不入框)
    groups: list[dict] = [
        {
            "id": 1, "title": "道劫·底座装配(行1 源行:九选一底座+锁层A恒挂+RGBA官方头尾)",
            "bounding": [20, 200, 2280, 480], "color": "#3f789e", "flags": {},
        },
        {
            "id": 2, "title": "道劫·装配路由(行2:拼接①② delimiter=\\n 分层;RGBA 公式拼接;装配全文=prompt 输出)",
            "bounding": [60, 960, 2500, 280], "color": "#a1309b", "flags": {},
        },
        {
            "id": 3, "title": "道劫·编码输出(行3:主编码(prompt 接主画布[141]回流)+RGBA编码(默认旁路)+RGBA开关)",
            "bounding": [2960, 1720, 1700, 440], "color": "#886", "flags": {},
        },
    ]

    # 子图 IO(inputs 槽序=宿主 inputs 序;widget 型输入 linkIds 同样逐项登记=契约铁律)
    _IO_IDS = [
        "a1e2c3d4-0001-4a01-9e01-7d4a9c31a001",  # in-0 clip
        "a1e2c3d4-0002-4a02-9e02-7d4a9c31a002",  # in-1 vae
        "a1e2c3d4-0003-4a03-9e03-7d4a9c31a003",  # in-2 主体句
        "a1e2c3d4-0004-4a04-9e04-7d4a9c31a004",  # in-3 型选择(COMBO)
        "a1e2c3d4-0005-4a05-9e05-7d4a9c31a005",  # in-4 RGBA透明开关
        "a1e2c3d4-0006-4a06-9e06-7d4a9c31a006",  # in-5 提示词(主图[141]回流)
        "b2f3a4c5-0001-4b01-8f01-3c5f81b56b01",  # out-0 positive
        "b2f3a4c5-0002-4b02-8f02-3c5f81b56b02",  # out-1 negative
        "b2f3a4c5-0003-4b03-8f03-3c5f81b56b03",  # out-2 prompt(装配全文)
        "b2f3a4c5-0004-4b04-8f04-3c5f81b56b04",  # out-3 width
        "b2f3a4c5-0005-4b05-8f05-3c5f81b56b05",  # out-4 height
    ]
    # IO 槽 pos(输入槽落各自目标近旁:clip/vae 落行2-行3 间带、开关类落行3 下缘带、
    # 主体句/型选择落左缘行带;输出槽 x=7300 全部钉死最右列,纵向按出线源行分布)
    inputs = [
        {"id": _IO_IDS[0], "name": "clip", "type": "CLIP", "linkIds": [1, 2], "pos": [2900, 1500]},
        {"id": _IO_IDS[1], "name": "vae", "type": "VAE", "linkIds": [3, 4], "pos": [2600, 2160]},
        {"id": _IO_IDS[2], "name": "主体句", "type": "STRING", "linkIds": [5], "pos": [-196, 1056]},
        {"id": _IO_IDS[3], "name": "型选择", "type": "COMBO", "linkIds": [6], "pos": [-196, 276]},
        {"id": _IO_IDS[4], "name": "RGBA透明开关", "type": "BOOLEAN", "linkIds": [7], "pos": [4060, 2200]},
        {"id": _IO_IDS[5], "name": "提示词", "type": "STRING", "linkIds": [8], "pos": [3180, 2160]},
    ]
    outputs = [
        {"id": _IO_IDS[6], "name": "positive", "type": "CONDITIONING", "linkIds": [19], "pos": [7300, 1800]},
        {"id": _IO_IDS[7], "name": "negative", "type": "CONDITIONING", "linkIds": [20], "pos": [7300, 1940]},
        {"id": _IO_IDS[8], "name": "prompt", "type": "STRING", "linkIds": [21], "pos": [7300, 860]},
        {"id": _IO_IDS[9], "name": "width", "type": "INT", "linkIds": [24], "pos": [7300, 60]},
        {"id": _IO_IDS[10], "name": "height", "type": "INT", "linkIds": [27], "pos": [7300, 200]},
    ]

    sg = {
        "id": SG_UUID,
        "version": 1,
        "state": {"lastGroupId": 3, "lastNodeId": 175, "lastLinkId": 28, "lastRerouteId": 5},
        "revision": 1,
        "config": {"defaultIOState": {}},
        "name": "[40] 道劫·装配子图(双击进入)",
        "inputNode": {"id": -10, "bounding": [-320, -260, 160, 2560]},
        "outputNode": {"id": -20, "bounding": [7220, 20, 320, 2320]},
        "inputs": inputs,
        "outputs": outputs,
        "widgets": [truth["types"][0]["subject"], DEFAULT_TYPE, False],
        "nodes": nodes,
        "groups": groups,
        "links": links,
        "extra": {"ue_links": [], "links_added_by_ue": []},
    }
    # W6 收口(0926 实测发现项3 计划断言互锁):子图整体归一平移至所有节点
    # pos≥80(左上边距升级 40→80;相对布局零变=est 间距/零重叠/行带语义全保持;
    # 源码逻辑坐标 行1-3 y=240/1000/1760·通道带 y=40/140 不改,序列化前统一抬,
    # IO 槽/组框/inputNode·outputNode bounding 同步平移保持罩合关系)。
    _dx = max(0, 80 - min(n["pos"][0] for n in sg["nodes"]))
    _dy = max(0, 80 - min(n["pos"][1] for n in sg["nodes"]))
    if _dx or _dy:
        for _n in sg["nodes"]:
            _n["pos"] = [_n["pos"][0] + _dx, _n["pos"][1] + _dy]
        for _io in sg["inputs"] + sg["outputs"]:
            _io["pos"] = [_io["pos"][0] + _dx, _io["pos"][1] + _dy]
        for _grp in sg["groups"]:
            _grp["bounding"][0] += _dx
            _grp["bounding"][1] += _dy
        sg["inputNode"]["bounding"][0] += _dx
        sg["inputNode"]["bounding"][1] += _dy
        sg["outputNode"]["bounding"][0] += _dx
        sg["outputNode"]["bounding"][1] += _dy
    return sg, links


# ── 主图构建(0925 W6 零负区:全部节点 pos≥40;W2 PE 链主画布)───────────
def build_main(truth: dict, sg: dict) -> dict:
    g = {
        "id": WF_UUID, "version": 0.4, "revision": 0, "config": {}, "extra": {},
        "groups": [
            {"id": 1, "title": "道劫·加载器(bf16 三件套+PE 专属文本编码器)",
             "bounding": [40, 280, 2200, 300], "color": "#3f789e", "flags": {}},
            {"id": 2, "title": "道劫·装配外露+PE 改写([24]主体句=①层唯一手写位;[140]PE改写+画幅联动链[151]-[158]主画布;[40]装配子图;[141]提示词开关;[27]装配预览=最终文本)",
             "bounding": [40, 920, 4620, 1040], "color": "#a1309b", "flags": {}},
            {"id": 3, "title": "道劫·主链([5]空潜→[7]采样→[8]解码→[9]保存;steps 接[177]联动)",
             "bounding": [5940, 1160, 1680, 840], "color": "#3f789e", "flags": {}},
            # W1 加速区组框(方案C 原生收纳;六件=总闸/MODEL开关/LoRA/steps开关/常量40与6)
            {"id": 4, "title": "道劫·加速区·总闸[30](关=40步原味 / 开=viggle LoRA·6步,一拨全配:MODEL+steps 两开关同驱)",
             "bounding": [2360, 2560, 2900, 1180], "color": "#4d9e6a", "flags": {}},
        ],
        "nodes": [],
        "links": [],
        "definitions": {"subgraphs": [sg]},
        "last_node_id": HOST_ID,
        "last_link_id": 18,
    }
    types = truth["types"]

    def loader(nid: int, ntype: str, title: str, pos: list, size: list, wv: list,
               out_links: list[int], inputs: list[dict]) -> dict:
        return {
            "id": nid, "type": ntype, "title": f"[{nid}] {title}",
            "pos": pos, "size": size, "flags": {}, "order": 0, "mode": 0,
            "inputs": inputs,
            "outputs": [{"name": {"UNETLoader": "MODEL", "CLIPLoader": "CLIP",
                                  "VAELoader": "VAE"}[ntype], "type":
                         {"UNETLoader": "MODEL", "CLIPLoader": "CLIP",
                          "VAELoader": "VAE"}[ntype],
                         "links": out_links}],
            "properties": {"Node name for S&R": ntype},
            "widgets_values": wv,
        }

    nodes = [
        # 行1 加载器(0925 W6 零负区:x 自 80 起)
        loader(1, "UNETLoader", "UNETLoader", [80, 320], [340, 84],
               ["qwen_image_2.1_bf16.safetensors", "default"], [8],
               [{"name": "unet_name", "type": "COMBO", "widget": {"name": "unet_name"}, "link": None},
                {"name": "weight_dtype", "type": "COMBO", "widget": {"name": "weight_dtype"}, "link": None}]),
        loader(2, "CLIPLoader", "CLIPLoader(主 TE)", [620, 320], [360, 130],
               ["qwen3vl_8b_bf16_heretic.safetensors", "qwen_image", "default"], [12],
               [{"name": "clip_name", "type": "COMBO", "widget": {"name": "clip_name"}, "link": None},
                {"name": "type", "type": "COMBO", "widget": {"name": "type"}, "link": None},
                {"name": "device", "type": "COMBO", "shape": 7, "widget": {"name": "device"}, "link": None}]),
        loader(3, "VAELoader", "VAELoader", [1220, 320], [340, 60],
               ["qwen_image_2.1_vae_bf16.safetensors"], [10, 13],
               [{"name": "vae_name", "type": "COMBO", "widget": {"name": "vae_name"}, "link": None}]),
        loader(11, "CLIPLoader", "CLIPLoader(PE 专属 TE)", [1800, 320], [400, 130],
               [PE_CLIP_FILE, "qwen_image", "default"], [31],
               [{"name": "clip_name", "type": "COMBO", "widget": {"name": "clip_name"}, "link": None},
                {"name": "type", "type": "COMBO", "widget": {"name": "type"}, "link": None},
                {"name": "device", "type": "COMBO", "shape": 7, "widget": {"name": "device"}, "link": None}]),
        # 行2 装配外露+PE(0925 W2:PE 改写链主画布,与 i2i/edit 同构)
        {
            "id": SUBJECT_ID, "type": "PrimitiveStringMultiline",
            "title": f"[{SUBJECT_ID}] 主体句(①层唯一手写位;默认=库人物型例一)",
            "pos": [80, 960], "size": [661, 200], "flags": {}, "order": 4, "mode": 0,
            "inputs": [],
            "outputs": [{"name": "STRING", "type": "STRING", "slot_index": 0, "links": [15]}],
            "properties": {"Node name for S&R": "PrimitiveStringMultiline"},
            "widgets_values": [types[0]["subject"]],
        },
        {
            "id": PE_RW_ID, "type": "QwenImage21_T2IPromptRewrite",
            "title": f"[{PE_RW_ID}] PE改写(短句→英文长文,默认开路(0926裁定1);pp=1.5 已定档 0925)",
            "pos": [2500, 1450], "size": [440, 340], "flags": {}, "order": 5, "mode": 0,
            "inputs": [
                {"name": "clip", "type": "CLIP", "link": 31},
                {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": None},
                {"name": "temperature", "type": "FLOAT", "widget": {"name": "temperature"}, "link": None},
                {"name": "top_p", "type": "FLOAT", "widget": {"name": "top_p"}, "link": None},
                {"name": "top_k", "type": "INT", "widget": {"name": "top_k"}, "link": None},
                {"name": "presence_penalty", "type": "FLOAT", "widget": {"name": "presence_penalty"}, "link": None},
                {"name": "max_new_tokens", "type": "INT", "widget": {"name": "max_new_tokens"}, "link": None},
                {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": None},
            ],
            "outputs": [
                {"name": "positive_prompt", "type": "STRING", "links": [32]},
                {"name": "negative_prompt", "type": "STRING", "links": None},
                {"name": "wh_ratio", "type": "STRING", "links": [35, 36]},
                {"name": "thinking", "type": "STRING", "links": None},
                {"name": "parse_ok", "type": "BOOLEAN", "links": None},
            ],
            "properties": {"Node name for S&R": "QwenImage21_T2IPromptRewrite"},
            "widgets_values": [PE_SEED_PROMPT, *PE_PARAMS],
        },
        {
            "id": PREVIEW_ID, "type": "easy showAnything",
            "title": f"[{PREVIEW_ID}] 装配预览(接[141]开关输出=将进编码的最终文本;跑图前过目)",
            "pos": [4100, 960], "size": [480, 230], "flags": {}, "order": 6, "mode": 0,
            "inputs": [{"label": "输入任何", "name": "anything", "shape": 7, "type": "*", "link": 18}],
            "outputs": [{"name": "output", "type": "*", "links": None}],
            "properties": {"Node name for S&R": "easy showAnything"},
            "widgets_values": [""],
        },
        # 蛇形联动总闸(0926 线不遮节点轮:行间走廊右端,两开关 slot 走右缘陡线)
        {
            "id": RATIO_PB_ID, "type": "PrimitiveBoolean",
            "title": f"[{RATIO_PB_ID}] 画幅联动开关(默认关=恒九型;开=PE 建议画幅接管 [5])",
            "pos": [4800, 1810], "size": [280, 90], "flags": {}, "order": 7, "mode": 0,
            "inputs": [{"name": "value", "type": "BOOLEAN", "widget": {"name": "value"}, "link": None}],
            "outputs": [{"name": "BOOLEAN", "type": "BOOLEAN", "links": [47, 48]}],
            "properties": {"Node name for S&R": "PrimitiveBoolean"},
            "widgets_values": [False],
        },
        # 主链带(0926 上移与蛇形同带:[40] positive/negative 直连 [7] 零遮挡;
        # 宽高接联动开关,默认=[40] 九型直驱)
        {
            "id": LATENT_ID, "type": "EmptyLatentImage",
            "title": f"[{LATENT_ID}] EmptyLatentImage(宽高接 [{SW_W_ID}]/[{SW_H_ID}] 联动,默认=[40] 九型直驱;面板 1024=摆设值不生效)",
            "pos": [5980, 1200], "size": [330, 110], "flags": {}, "order": 8, "mode": 0,
            "inputs": [
                {"name": "width", "type": "INT", "widget": {"name": "width"}, "link": 1},
                {"name": "height", "type": "INT", "widget": {"name": "height"}, "link": 2},
            ],
            "outputs": [{"name": "LATENT", "type": "LATENT", "links": [5]}],
            "properties": {"Node name for S&R": "EmptyLatentImage"},
            "widgets_values": [1024, 1024, 1],
        },
        {
            "id": SAMPLER_ID, "type": "KSampler",
            "title": f"[{SAMPLER_ID}] KSampler(40步·cfg1;seed 外露;model 接 [{LORA_SW_ID}] 加速槽开关;"
                     f"steps 接 [{STEPS_SW_ID}] 联动开关,面板 steps=摆设值不生效)",
            "pos": [6150, 1560], "size": [330, 260], "flags": {}, "order": 9, "mode": 0,
            "inputs": [
                {"name": "model", "type": "MODEL", "link": 26},
                {"name": "positive", "type": "CONDITIONING", "link": 16},
                {"name": "negative", "type": "CONDITIONING", "link": 17},
                {"name": "latent_image", "type": "LATENT", "link": 5},
                # 满血接线轮:steps widget 转输入(widget 标记保留;连线期 link 优先)
                {"name": "steps", "type": "INT", "widget": {"name": "steps"}, "link": 30},
            ],
            "outputs": [{"name": "LATENT", "type": "LATENT", "links": [9]}],
            "properties": {"Node name for S&R": "KSampler"},
            "widgets_values": [0, "fixed", 40, 1, "euler", "simple", 1],
        },
        {
            "id": 8, "type": "VAEDecode",
            "title": "[8] VAEDecode",
            "pos": [6700, 1560], "size": [240, 50], "flags": {}, "order": 10, "mode": 0,
            "inputs": [
                {"name": "samples", "type": "LATENT", "link": 9},
                {"name": "vae", "type": "VAE", "link": 22},
            ],
            "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [11]}],
            "properties": {"Node name for S&R": "VAEDecode"},
        },
        {
            "id": 9, "type": "SaveImage",
            "title": "[9] SaveImage",
            "pos": [7150, 1560], "size": [380, 330], "flags": {}, "order": 11, "mode": 0,
            "inputs": [{"name": "images", "type": "IMAGE", "link": 11}],
            "outputs": [],
            "properties": {"Node name for S&R": "SaveImage"},
            "widgets_values": ["QI21道劫文生图_"],
        },
        {
            "id": 10, "type": "MarkdownNote",
            "title": "[10] 道劫·用法速查(装配子图版·0925 加速与展示全量外露收窄轮)",
            "pos": [80, 2600], "size": [900, 1500], "flags": {}, "order": 12, "mode": 0,
            "inputs": [], "outputs": [],
            "properties": {},
            "widgets_values": [NOTE_TEXT],
        },
    ]

    # 宿主 [40](widget 型子图输入=宿主面板;序列化口径=K2 [90].base COMBO 实证)
    host_inputs = [
        {"name": "clip", "type": "CLIP", "link": 12},
        {"name": "vae", "type": "VAE", "link": 13},
        {"name": "主体句", "type": "STRING", "widget": {"name": "主体句"}, "link": 15},
        {"name": "型选择", "type": "COMBO", "widget": {"name": "型选择"}, "link": None},
        {"name": "RGBA透明开关", "type": "BOOLEAN", "widget": {"name": "RGBA透明开关"}, "link": None},
        # 提示词槽(0925 W2):主画布 [141] 开关输出回流(最终文本进主编码)
        {"name": "提示词", "type": "STRING", "link": 34},
    ]
    host = {
        "id": HOST_ID, "type": SG_UUID,
        "title": f"[{HOST_ID}] 装配子图(双击进入)",
        "pos": [1700, 960], "size": [560, 480], "flags": {}, "order": 13, "mode": 0,
        "inputs": host_inputs,
        "outputs": [
            {"name": "positive", "type": "CONDITIONING", "links": [16]},
            {"name": "negative", "type": "CONDITIONING", "links": [17]},
            {"name": "prompt", "type": "STRING", "links": [33]},
            {"name": "width", "type": "INT", "links": [45]},
            {"name": "height", "type": "INT", "links": [46]},
        ],
        "properties": {"subgraph": SG_UUID, "previewExposures": []},
        "widgets_values": [types[0]["subject"], DEFAULT_TYPE, False],
        "widgets_values_named": {name: (types[0]["subject"] if i == 0 else
                                        (DEFAULT_TYPE if i == 1 else False))
                                 for i, (name, _t) in enumerate(WIDGET_INPUTS)},
    }
    nodes.append(host)

    # [141] 提示词开关(W2 迁主画布;switch=本件 widget,照 i2i [15] 式;0926 裁定1
    # PE 开路含画布本体:默认 true=PE 改写,关=直写按图选配)
    nodes.append(_switch(
        PE_SW_ID, "提示词开关(true=PE扩写·默认(0926裁定1) / false=直写装配=按图选配;输出=最终文本)",
        33, 32, None, [18, 34], [3300, 980], default=True))

    # 蛇形画幅联动链(0926 线不遮节点轮:菊花链单行改蛇形两行——上=宽路/下=高路,
    # 列对齐,同路横连走行内空档,跨路对角走列间;[158] 让位右移避 [32]→[7] 走廊)
    def _regex(nid: int, title: str, pattern: str, in_link: int, out_link: int, pos: list) -> dict:
        return {
            "id": nid, "type": "RegexExtract", "title": title,
            "pos": pos, "size": [340, 200], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"name": "string", "type": "STRING", "widget": {"name": "string"}, "link": in_link},
                {"name": "regex_pattern", "type": "STRING", "widget": {"name": "regex_pattern"}, "link": None},
                {"name": "mode", "type": "COMBO", "widget": {"name": "mode"}, "link": None},
                {"name": "case_insensitive", "type": "BOOLEAN", "widget": {"name": "case_insensitive"}, "link": None},
                {"name": "multiline", "type": "BOOLEAN", "widget": {"name": "multiline"}, "link": None},
                {"name": "dotall", "type": "BOOLEAN", "widget": {"name": "dotall"}, "link": None},
                {"name": "group_index", "type": "INT", "widget": {"name": "group_index"}, "link": None},
            ],
            "outputs": [{"name": "STRING", "type": "STRING", "links": [out_link]}],
            "properties": {"Node name for S&R": "RegexExtract"},
            "widgets_values": ["", pattern, "First Group", False, False, False, 1],
        }

    def _convert(nid: int, title: str, in_link: int, out_links: list[int], pos: list) -> dict:
        return {
            "id": nid, "type": "ComfyNumberConvert", "title": title,
            "pos": pos, "size": [240, 80], "flags": {}, "order": 0, "mode": 0,
            "inputs": [{"name": "value", "type": "INT,FLOAT,STRING,BOOLEAN", "link": in_link}],
            "outputs": [
                {"name": "FLOAT", "type": "FLOAT", "links": None},
                {"name": "INT", "type": "INT", "links": out_links},
            ],
            "properties": {"Node name for S&R": "ComfyNumberConvert"},
        }

    def _math(nid: int, title: str, expr: str, a_link: int, b_link: int, out_link: int, pos: list) -> dict:
        return {
            "id": nid, "type": "ComfyMathExpression", "title": title,
            "pos": pos, "size": [340, 160], "flags": {}, "order": 0, "mode": 0,
            "inputs": [
                {"label": "a", "name": "values.a", "type": "FLOAT,INT", "link": a_link},
                {"label": "b", "name": "values.b", "shape": 7, "type": "FLOAT,INT", "link": b_link},
                {"name": "expression", "type": "STRING", "widget": {"name": "expression"}, "link": None},
            ],
            "outputs": [
                {"name": "FLOAT", "type": "FLOAT", "links": None},
                {"name": "INT", "type": "INT", "links": [out_link]},
            ],
            "properties": {"Node name for S&R": "ComfyMathExpression"},
            "widgets_values": [expr],
        }

    nodes.append(_regex(RATIO_RW_ID, "PE建议画幅·取宽比(如 16:9→16)", RATIO_W_PATTERN, 35, 37,
                        [3700, 1560]))
    nodes.append(_regex(RATIO_RH_ID, "PE建议画幅·取高比(如 16:9→9)", RATIO_H_PATTERN, 36, 38,
                        [3700, 2100]))
    nodes.append(_convert(CONV_RW_ID, "宽比转数", 37, [39, 40], [4240, 1560]))
    nodes.append(_convert(CONV_RH_ID, "高比转数", 38, [41, 42], [4240, 2100]))
    nodes.append(_math(MATH_W_ID, "PE建议宽(4.2MP·8倍数取整)", MATH_W_EXPR, 39, 41, 43,
                       [4690, 1560]))
    nodes.append(_math(MATH_H_ID, "PE建议高(4.2MP·8倍数取整)", MATH_H_EXPR, 40, 42, 44,
                       [4690, 2100]))
    nodes.append(_switch(SW_W_ID, "宽联动开关(false=九型WIDTH / true=PE建议宽)", 52, 43, 47, [1],
                         [5230, 1560], typ="INT"))
    nodes[-1]["size"] = [300, 110]
    nodes.append(_switch(SW_H_ID, "高联动开关(false=九型HEIGHT / true=PE建议高)", 53, 44, 48, [2],
                         [5900, 2100], typ="INT"))
    nodes[-1]["size"] = [300, 110]

    # 加速区(W1 组框收纳;0926 线不遮节点轮两行化:[32] 上行近主链,[30] 总闸
    # 与 [177]/[31] 下行,常量 [178]/[179] 垂直堆叠避菊花,[30] 扇出走行间)
    nodes.append({
        "id": LORA_PB_ID, "type": "PrimitiveBoolean",
        "title": f"[{LORA_PB_ID}] 加速开关(默认关=正常生成;一拨全配:同驱 MODEL+steps 两开关)",
        "pos": [2400, 2680], "size": [280, 90], "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "value", "type": "BOOLEAN", "widget": {"name": "value"}, "link": None}],
        "outputs": [{"name": "BOOLEAN", "type": "BOOLEAN", "links": [25, 29]}],
        "properties": {"Node name for S&R": "PrimitiveBoolean"},
        "widgets_values": [False],
    })
    nodes.append({
        "id": LORA_ID, "type": "LoraLoaderModelOnly",
        "title": f"[{LORA_ID}] LoraLoaderModelOnly(viggle v0.2 r256;开=[30]一拨自动6步·strength0.8)",
        "pos": [4400, 2900], "size": [340, 130], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "model", "type": "MODEL", "link": 23},
            {"name": "lora_name", "type": "COMBO", "widget": {"name": "lora_name"}, "link": None},
            {"name": "strength_model", "type": "FLOAT", "widget": {"name": "strength_model"}, "link": None},
        ],
        "outputs": [{"name": "MODEL", "type": "MODEL", "links": [24]}],
        "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
        "widgets_values": [LORA_FILE, 0.8],
    })
    nodes.append({
        "id": LORA_SW_ID, "type": "ComfySwitchNode",
        "title": f"[{LORA_SW_ID}] MODEL开关(false=直连正常生成 / true=LoRA加速)",
        "pos": [4900, 2600], "size": [300, 110], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "on_false", "shape": 7, "type": "MODEL", "link": 49},
            {"name": "on_true", "shape": 7, "type": "MODEL", "link": 24},
            {"name": "switch", "type": "BOOLEAN", "widget": {"name": "switch"}, "link": 25},
        ],
        "outputs": [{"name": "output", "type": "MODEL", "links": [26]}],
        "properties": {"Node name for S&R": "ComfySwitchNode"},
        "widgets_values": [False],
    })
    nodes.append(_switch(
        STEPS_SW_ID, "steps联动开关", 27, 28, 29, [30], [3800, 2900], typ="INT"))
    nodes[-1]["size"] = [300, 110]
    nodes[-1]["title"] = \
        f"[{STEPS_SW_ID}] steps联动开关(false=自动回40原路 / true=自动6步加速;同受[{LORA_PB_ID}]一拨驱动)"
    nodes.append(_primitive_int(
        STEPS_C40_ID, "steps常量40(关态=原路·官方完整档)", STEPS_OFF, [2400, 2900], 27))
    nodes.append(_primitive_int(
        STEPS_C6_ID, "steps常量6(开态=v0.2卡荐档)", STEPS_ON, [2400, 3200], 28))
    # 顶缘通道 Reroute(MODEL y=80 / VAE y=170;零负区;0926:VAE 尾拐随主链上移至
    # [8] 近旁;MODEL 顶通道经垂降垫脚石 [190] 送加速区两臂,VAE 通道直落 [8])
    nodes.append(_reroute(RR_M8A_ID, [520, 80], 8, 19, "MODEL"))
    nodes.append(_reroute(RR_M8B_ID, [1020, 80], 19, 20, "MODEL"))
    nodes.append(_reroute(RR_M8C_ID, [1100, 1560], 20, [23, 49], "MODEL"))
    nodes.append(_reroute(RR_M10A_ID, [1420, 170], 10, 21, "VAE"))
    nodes.append(_reroute(RR_M10B_ID, [6500, 170], 21, 22, "VAE"))
    # 九型 W/H 垫脚石([40].width/.height 长横线沿蛇形上带平送再陡降)
    nodes.append(_reroute(RR_WH_W_ID, [4650, 1400], 45, 52, "INT"))
    nodes.append(_reroute(RR_WH_H_ID, [5830, 1460], 46, 53, "INT"))
    for order, n in enumerate(nodes):
        n["order"] = order
    g["nodes"] = nodes

    g["links"] = [
        # 画幅联动输出(W2:默认=[40] 九型 W/H,开=PE 建议;0926 九型臂经垫脚石
        # [191]/[192] 沿蛇形上带平送再陡降,长横线不斜穿联动列盒)
        [1, SW_W_ID, 0, LATENT_ID, 0, "INT"],       # 宽联动开关 → [5].width
        [2, SW_H_ID, 0, LATENT_ID, 1, "INT"],       # 高联动开关 → [5].height
        [45, HOST_ID, 3, RR_WH_W_ID, 0, "INT"],     # [40].width → 垫脚石(九型默认路)
        [46, HOST_ID, 4, RR_WH_H_ID, 0, "INT"],     # [40].height → 垫脚石
        [52, RR_WH_W_ID, 0, SW_W_ID, 0, "INT"],     # 垫脚石 → 宽开关.on_false
        [53, RR_WH_H_ID, 0, SW_H_ID, 0, "INT"],     # 垫脚石 → 高开关.on_false
        [47, RATIO_PB_ID, 0, SW_W_ID, 2, "BOOLEAN"],  # 联动总闸 → 宽开关.switch
        [48, RATIO_PB_ID, 0, SW_H_ID, 2, "BOOLEAN"],  # 联动总闸 → 高开关.switch
        [35, PE_RW_ID, 2, RATIO_RW_ID, 0, "STRING"],   # wh_ratio → 取宽比
        [36, PE_RW_ID, 2, RATIO_RH_ID, 0, "STRING"],   # wh_ratio → 取高比
        [37, RATIO_RW_ID, 0, CONV_RW_ID, 0, "STRING"],
        [38, RATIO_RH_ID, 0, CONV_RH_ID, 0, "STRING"],
        [39, CONV_RW_ID, 1, MATH_W_ID, 0, "INT"],
        [40, CONV_RW_ID, 1, MATH_H_ID, 0, "INT"],
        [41, CONV_RH_ID, 1, MATH_W_ID, 1, "INT"],
        [42, CONV_RH_ID, 1, MATH_H_ID, 1, "INT"],
        [43, MATH_W_ID, 1, SW_W_ID, 1, "INT"],      # 公式宽 → 宽开关.on_true
        [44, MATH_H_ID, 1, SW_H_ID, 1, "INT"],      # 公式高 → 高开关.on_true
        # PE 链(W2 主画布;[141] 输出=最终文本)
        [31, 11, 0, PE_RW_ID, 0, "CLIP"],           # PE 专属 TE → PE 改写.clip
        [32, PE_RW_ID, 0, PE_SW_ID, 1, "STRING"],   # PE 改写 → 开关.on_true
        [33, HOST_ID, 2, PE_SW_ID, 0, "STRING"],    # [40].prompt(装配全文) → 开关.on_false
        [18, PE_SW_ID, 0, PREVIEW_ID, 0, "STRING"], # 开关输出 → [27] 装配预览(最终文本)
        # 冻结回流线(契约冻结项,横向铁律单点豁免):PE 开关在主画布+编码在子图 ⇒ 必有
        [34, PE_SW_ID, 0, HOST_ID, 5, "STRING"],    # 开关输出 → [40].提示词(回主编码)
        # 宿主外链
        [12, 2, 0, HOST_ID, 0, "CLIP"],
        [13, 3, 0, HOST_ID, 1, "VAE"],
        [15, SUBJECT_ID, 0, HOST_ID, 2, "STRING"],
        [16, HOST_ID, 0, SAMPLER_ID, 1, "CONDITIONING"],
        [17, HOST_ID, 1, SAMPLER_ID, 2, "CONDITIONING"],
        # 主链
        [5, LATENT_ID, 0, SAMPLER_ID, 3, "LATENT"],
        [9, SAMPLER_ID, 0, 8, 0, "LATENT"],
        [11, 8, 0, 9, 0, "IMAGE"],
        # MODEL 顶通道 + 加速槽(R26.4;0926 顶通道经垂降垫脚石 [190] 送两臂,
        # 直连斜穿 [3]/[140]/[151] 全避免;通道件 id 与 link id 各自独立命名空间)
        [8, 1, 0, RR_M8A_ID, 0, "MODEL"],
        [19, RR_M8A_ID, 0, RR_M8B_ID, 0, "MODEL"],
        [20, RR_M8B_ID, 0, RR_M8C_ID, 0, "MODEL"],     # 顶横 → 垂降拐点
        [23, RR_M8C_ID, 0, LORA_ID, 0, "MODEL"],       # 垂降 → LoraLoader.model(加速臂)
        [49, RR_M8C_ID, 0, LORA_SW_ID, 0, "MODEL"],    # 垂降 → 加速槽开关.on_false(直连臂)
        [24, LORA_ID, 0, LORA_SW_ID, 1, "MODEL"],      # LoraLoader → 开关.on_true
        [25, LORA_PB_ID, 0, LORA_SW_ID, 2, "BOOLEAN"], # LoRA 开关源 → 开关.switch
        [26, LORA_SW_ID, 0, SAMPLER_ID, 0, "MODEL"],   # 开关 → KSampler.model(二选一)
        # VAE 顶通道
        [10, 3, 0, RR_M10A_ID, 0, "VAE"],
        [21, RR_M10A_ID, 0, RR_M10B_ID, 0, "VAE"],
        [22, RR_M10B_ID, 0, 8, 1, "VAE"],
        # steps 联动(满血接线轮:同一布尔源 [30])
        [27, STEPS_C40_ID, 0, STEPS_SW_ID, 0, "INT"],  # 常量40 → steps开关.on_false(关=原路)
        [28, STEPS_C6_ID, 0, STEPS_SW_ID, 1, "INT"],   # 常量6 → steps开关.on_true(开=卡荐档)
        [29, LORA_PB_ID, 0, STEPS_SW_ID, 2, "BOOLEAN"],# LoRA 开关源 → steps开关.switch(同一布尔源)
        [30, STEPS_SW_ID, 0, SAMPLER_ID, 4, "INT"],    # steps开关 → KSampler.steps(一拨全配)
    ]
    # id 计数器真值重算(根图+子图共享分配器,一并计入 max;计数器只抬不降)
    g["last_node_id"] = max(
        [g["last_node_id"]]
        + [n["id"] for n in g["nodes"]]
        + [n["id"] for sg_ in g["definitions"]["subgraphs"] for n in sg_["nodes"]])
    g["last_link_id"] = max(
        [g["last_link_id"]]
        + [l[0] for l in g["links"]]
        + [l["id"] for sg_ in g["definitions"]["subgraphs"] for l in sg_["links"]])
    return g


# ── 自查(与契约测试同口径谓词 + 子图契约铁律 + 干跑)───────────────
def self_check(g: dict, truth: dict) -> list[str]:
    errs: list[str] = []
    sg = g["definitions"]["subgraphs"][0]
    m_nodes = {n["id"]: n for n in g["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    i_nodes = {n["id"]: n for n in sg["nodes"]}
    i_links = {l["id"]: l for l in sg["links"]}

    # 1. 主图 link 双向一致 + 类型匹配
    for l in g["links"]:
        lid, oid, oslot, tid, tslot, typ = l
        origin, target = m_nodes[oid], m_nodes[tid]
        if typ != origin["outputs"][oslot]["type"]:
            errs.append(f"主图 link{lid}: origin 槽类型不匹配")
        if lid not in (origin["outputs"][oslot].get("links") or []):
            errs.append(f"主图 link{lid}: origin.outputs 未登记")
        if target["inputs"][tslot].get("link") != lid:
            errs.append(f"主图 link{lid}: target.inputs 不匹配")

    # 2. 子图 link 双向一致(对象格式;-10/-20 端点对照 IO 槽 linkIds)
    for l in sg["links"]:
        lid, oid, oslot, tid, tslot, typ = l["id"], l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"], l["type"]
        if oid == -10:
            io = sg["inputs"][oslot]
            if lid not in io["linkIds"]:
                errs.append(f"子图 link{lid}: -10 槽{oslot}({io['name']}) linkIds 未登记(契约铁律)")
            if typ != io["type"]:
                errs.append(f"子图 link{lid}: -10 槽{oslot} 类型不匹配")
        else:
            origin = i_nodes[oid]
            if typ != origin["outputs"][oslot]["type"]:
                errs.append(f"子图 link{lid}: origin 槽类型不匹配")
            if lid not in (origin["outputs"][oslot].get("links") or []):
                errs.append(f"子图 link{lid}: origin.outputs 未登记")
        if tid == -20:
            io = sg["outputs"][tslot]
            if lid not in io["linkIds"]:
                errs.append(f"子图 link{lid}: -20 槽{tslot}({io['name']}) linkIds 未登记(契约铁律)")
        else:
            target = i_nodes[tid]
            if target["inputs"][tslot].get("link") != lid:
                errs.append(f"子图 link{lid}: target.inputs 不匹配")
    # linkIds 反向:IO 槽登记的每条线必须真实存在且端点正确
    for slot, io in enumerate(sg["inputs"]):
        for lid in io["linkIds"]:
            l = i_links.get(lid)
            if not l or l["origin_id"] != -10 or l["origin_slot"] != slot:
                errs.append(f"子图 inputs[{slot}]({io['name']}) linkIds[{lid}] 端点不实")
        if not io["linkIds"]:
            errs.append(f"子图 inputs[{slot}]({io['name']}) linkIds 为空(契约铁律)")
    for slot, io in enumerate(sg["outputs"]):
        for lid in io["linkIds"]:
            l = i_links.get(lid)
            if not l or l["target_id"] != -20 or l["target_slot"] != slot:
                errs.append(f"子图 outputs[{slot}]({io['name']}) linkIds[{lid}] 端点不实")
        if not io["linkIds"]:
            errs.append(f"子图 outputs[{slot}]({io['name']}) linkIds 为空(契约铁律)")

    # 3. 横向排版:主图每条连线 target.x > origin.x,唯一豁免=冻结回流线
    #    [141]→[40].提示词(W2 PE 开关主画布+拍板③编码在子图 ⇒ 文本出子图再回子图,
    #    几何上必有且恰 1 条左向线;豁免被 3a 钉死不可蔓延——仿 ad22a9e 契约冻结先例)
    backward = [l[0] for l in g["links"]
                if not m_nodes[l[3]]["pos"][0] > m_nodes[l[1]]["pos"][0]]
    if sorted(backward) != [FROZEN_BACK_LINK]:
        errs.append(f"主图左向线应恰 1 条=冻结回流线{FROZEN_BACK_LINK}([141]→[40].提示词,"
                    f"契约冻结项),得 {sorted(backward)}")
    fl = m_links.get(FROZEN_BACK_LINK)
    if not fl or fl[1] != PE_SW_ID or fl[3] != HOST_ID or fl[4] != 5 or fl[5] != "STRING":
        errs.append(f"冻结回流线{FROZEN_BACK_LINK} 端点漂移(应 [{PE_SW_ID}]→[{HOST_ID}].提示词)")
    for l in sg["links"]:
        ox = sg["inputs"][l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 else i_nodes[l["origin_id"]]["pos"][0]
        tx = sg["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 else i_nodes[l["target_id"]]["pos"][0]
        if not tx > ox:
            errs.append(f"子图 link{l['id']}: 纵向塔违规")

    # 3b. 行排版:子图按 y 分行恰 3 行=三阶段(源/装配路由/编码输出;通道 Reroute
    #     拐点不占行);行间净距≥100;行内 x 严格递增(数组序=数据流序)
    sg_rows: dict[int, list[int]] = {}
    for n in sg["nodes"]:
        if n["type"] == "Reroute":
            continue  # 通道拐点不占阶段行
        sg_rows.setdefault(n["pos"][1], []).append(n["id"])
    row_ys = sorted(sg_rows)
    want_rows = [
        [BASE_ID, LOCK_ID, RGBA_HEAD_ID, RGBA_TAIL_ID],
        [CONCAT1_ID, CONCAT2_ID, RGBA_CAT1_ID, RGBA_CAT2_ID],
        [TE_RGBA_ID, TE_ID, RGBA_SW_ID],
    ]
    if len(row_ys) != 3:
        errs.append(f"子图应恰 3 行(源/装配路由/编码输出),得 {len(row_ys)} 行")
    for y, want in zip(row_ys, want_rows):
        if sorted(sg_rows[y]) != sorted(want):
            errs.append(f"子图行 y={y} 成员漂移: 应 {sorted(want)} 得 {sorted(sg_rows[y])}")
        xs = [i_nodes[nid]["pos"][0] for nid in sg_rows[y]]  # 数组序=数据流序
        if any(b <= a for a, b in zip(xs, xs[1:])):
            errs.append(f"子图行 y={y} 行内 x 非严格递增(行内应从左到右)")
    for y, next_y in zip(row_ys, row_ys[1:]):
        bottom = y + max(i_nodes[nid]["size"][1] for nid in sg_rows[y])
        if next_y - bottom < 100:
            errs.append(f"子图行距不足: 行 y={y} 底 {bottom} 与下行 y={next_y} 净距 <100")
    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        for i in range(len(scope_nodes)):
            for j in range(i + 1, len(scope_nodes)):
                a, b = scope_nodes[i], scope_nodes[j]
                if (a["pos"][0] < b["pos"][0] + b["size"][0] and b["pos"][0] < a["pos"][0] + a["size"][0]
                        and a["pos"][1] < b["pos"][1] + b["size"][1] and b["pos"][1] < a["pos"][1] + a["size"][1]):
                    errs.append(f"{scope} node{a['id']} 与 node{b['id']} 矩形重叠")
    # 3c. 间距阈值(0925 布局美化轮,est 足迹口径):同行横净距≥200 / 同列纵净距≥80;
    #     Reroute 通道件与 MarkdownNote 说明卡豁免;全图(含豁免件)est 盒零重叠。
    def _est_box(n: dict):
        x, y = float(n["pos"][0]), float(n["pos"][1])
        w = max(250.0, float(n["size"][0]))
        rows = max(len(n.get("inputs", [])), len(n.get("outputs", [])))
        h = max(36 + 24 * rows + 30 * len(n.get("widgets_values") or []) + 28, float(n["size"][1]))
        return x, y, x + w, y + h

    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        boxes = [(n["id"], _est_box(n)) for n in scope_nodes]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                (ida, (ax0, ay0, ax1, ay1)), (idb, (bx0, by0, bx1, by1)) = boxes[i], boxes[j]
                if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
                    errs.append(f"{scope} node{ida} 与 node{idb} est 足迹重叠(inspect 口径)")
        real = [(n["id"], _est_box(n)) for n in scope_nodes
                if n["type"] not in ("Reroute", "MarkdownNote")]
        for i in range(len(real)):
            for j in range(i + 1, len(real)):
                (ida, (ax0, ay0, ax1, ay1)), (idb, (bx0, by0, bx1, by1)) = real[i], real[j]
                yov = min(ay1, by1) - max(ay0, by0)
                xov = min(ax1, bx1) - max(ax0, bx0)
                if yov > 0 and xov <= 0 and -(xov) < 200:
                    errs.append(f"{scope} node{ida} 与 node{idb} 同行横距 {-(xov):.0f} <200(0925 间距令)")
                elif xov > 0 and yov <= 0 and -(yov) < 80:
                    errs.append(f"{scope} node{ida} 与 node{idb} 同列纵距 {-(yov):.0f} <80(0925 间距令)")

    # 3d. 零负区(0925 W6①;0926 收紧 pos≥40→≥80=实测发现项3 计划断言互锁):
    #     主图+子图所有节点 pos≥80,整图平移至左上留边距,打开即全貌
    #     (子图 IO 槽非节点,负 x 表示法=K2 [90] 同款,豁免)
    for scope, scope_nodes in (("主图", g["nodes"]), ("子图", sg["nodes"])):
        for n in scope_nodes:
            if n["pos"][0] < 80 or n["pos"][1] < 80:
                errs.append(f"{scope} node{n['id']} 负区坐标 {n['pos']}(零负区:pos≥80)")

    # 3e. 输出口最右(0925 W6②):子图输出 IO 槽钉死最右列(表示法=K2 [90] 实证:
    #     输出槽 x 超过全子图最右节点,纵向堆叠)
    max_nx = max(n["pos"][0] for n in sg["nodes"])
    for io in sg["outputs"]:
        if io["pos"][0] < max_nx - 50:
            errs.append(f"子图输出 {io['name']} 未钉最右列(x={io['pos'][0]} < 全子图最大 x{max_nx}-50)")

    # 3f. 零线遮节点(0926 铁律:工作流的美化只管位置,线与节点不得彼此遮盖):
    #     判定=三次贝塞尔 41 点采样——P0=输出槽(节点右缘,top+25+origin_slot×20)、
    #     P3=输入槽(左缘,top+25+target_slot×20),控制点 P1=(P0.x+k,P0.y)/
    #     P2=(P3.x−k,P3.y),k=clamp(|dx|/2,40,200);节点盒=普通节点 size(缺省
    #     [220,120])/Reroute 60×30;任采样点落入非端点节点盒(±2 容差)即遮挡,
    #     端点豁免;-10/-20 边界线无节点盒端点,与验收器同口径跳过(主图+子图同判)。
    def _occl_box(n: dict):
        w, h = (60, 30) if n["type"] == "Reroute" else (n.get("size") or [220, 120])[:2]
        x, y = n["pos"][0], n["pos"][1]
        return x, y, x + w, y + h

    def _occl_slot(n: dict, s: int, side: str):
        x, y, x2, _ = _occl_box(n)
        sy = y + 25 + (s or 0) * 20
        return (x2, sy) if side == "out" else (x, sy)

    def _bez(p0, p1, p2, p3, t):
        mt = 1 - t
        return (mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
                mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1])

    for scope, scope_nodes, scope_links in (
            ("主图", g["nodes"], [[l[0], l[1], l[2], l[3], l[4]] for l in g["links"]]),
            ("子图", sg["nodes"], [[l["id"], l["origin_id"], l["origin_slot"],
                                    l["target_id"], l["target_slot"]] for l in sg["links"]])):
        byid = {n["id"]: n for n in scope_nodes}
        for lid, oid, oslot, tid, tslot in scope_links:
            o, t = byid.get(oid), byid.get(tid)
            if not o or not t:
                continue   # -10/-20 边界线(无节点盒端点),与验收器同口径跳过
            p0, p3 = _occl_slot(o, oslot, "out"), _occl_slot(t, tslot, "in")
            k = max(40, min(200, abs(p3[0] - p0[0]) * 0.5))
            p1, p2 = (p0[0] + k, p0[1]), (p3[0] - k, p3[1])
            hit = set()
            for i in range(41):
                x, y = _bez(p0, p1, p2, p3, i / 40)
                for nid, n in byid.items():
                    if nid in (oid, tid):
                        continue   # 端点豁免
                    bx = _occl_box(n)
                    if bx[0] - 2 <= x <= bx[2] + 2 and bx[1] - 2 <= y <= bx[3] + 2:
                        hit.add(nid)
            if hit:
                errs.append(f"{scope} link{lid} [{oid}]->[{tid}] 线遮节点 {sorted(hit)}"
                            f"(0926 铁律:线不遮节点;挪位或按通道约定垫 Reroute)")

    if len(sg["groups"]) > 4:
        errs.append(f"子图 group 预算超限(≤4),得 {len(sg['groups'])}")
    if len(g["groups"]) > 4:
        errs.append(f"主图 group 预算超限(≤4,W1 加速区组框),得 {len(g['groups'])}")
    sg_boxes = [(grp["bounding"][0], grp["bounding"][1],
                 grp["bounding"][0] + grp["bounding"][2],
                 grp["bounding"][1] + grp["bounding"][3]) for grp in sg["groups"]]
    for i in range(len(sg_boxes)):
        for j in range(i + 1, len(sg_boxes)):
            if (sg_boxes[i][0] < sg_boxes[j][2] and sg_boxes[j][0] < sg_boxes[i][2]
                    and sg_boxes[i][1] < sg_boxes[j][3] and sg_boxes[j][1] < sg_boxes[i][3]):
                errs.append(f"子图 group 框 {i} 与 {j} 相交")
    for grp in sg["groups"]:
        gx0, gy0 = grp["bounding"][0], grp["bounding"][1]
        gx1, gy1 = gx0 + grp["bounding"][2], gy0 + grp["bounding"][3]
        inside = [n for n in sg["nodes"] if n["type"] != "Reroute"
                  if gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                  and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1]
        if not inside:
            errs.append(f"子图 group {grp['title']!r} 未框住任何节点(装饰框即病)")
        if len({n["pos"][1] for n in inside}) != 1:
            errs.append(f"子图 group {grp['title']!r} 跨行框住节点(应只框单一阶段行)")
        row_y = inside[0]["pos"][1] if inside else None
        row_all = [n["id"] for n in sg["nodes"] if n["pos"][1] == row_y]
        if sorted(n["id"] for n in inside) != sorted(row_all):
            errs.append(f"子图 group {grp['title']!r} 应框住其阶段行全部节点")

    # 4. group 全 int id + 标题字号(节点标题零道劫=0925 归位裁定)+ W1 加速区组框在位
    for scope, groups in (("主图", g["groups"]), ("子图", sg["groups"])):
        if not groups:
            errs.append(f"{scope}分组为空")
        for grp in groups:
            if not isinstance(grp.get("id"), int):
                errs.append(f"{scope} group {grp.get('title')!r} id 非 int")
    for grp in g["groups"]:
        if "道劫" not in grp["title"]:
            errs.append(f"主图 group {grp['title']!r} 缺道劫字号")
    if "道劫" not in sg["name"]:
        errs.append("子图 name 缺道劫字号")
    for n in g["nodes"]:
        if n["type"] == "MarkdownNote":
            if "道劫" not in (n.get("title") or ""):
                errs.append(f"主图 node{n['id']} 说明卡标题缺道劫字号(工作流级说明件保留道劫)")
        elif n["type"] != "Reroute" and "道劫" in (n.get("title") or ""):
            errs.append(f"主图 node{n['id']} 标题含道劫前缀(0925 归位:节点标题零道劫): {n.get('title')!r}")
    for n in sg["nodes"]:
        if n["type"] != "MarkdownNote" and "道劫" in (n.get("title") or ""):
            errs.append(f"子图 node{n['id']} 标题含道劫前缀(0925 归位:节点标题零道劫): {n.get('title')!r}")
    # W1 加速区组框:标题带「加速区·总闸」且罩住六件([30][31][32][177][178][179])
    accel_ids = [LORA_PB_ID, LORA_ID, LORA_SW_ID, STEPS_SW_ID, STEPS_C40_ID, STEPS_C6_ID]
    accel_grp = next((grp for grp in g["groups"] if "加速区·总闸" in grp["title"]), None)
    if accel_grp is None:
        errs.append("W1 缺「加速区」组框(主画布原生组框收纳六件)")
    else:
        gx0, gy0 = accel_grp["bounding"][0], accel_grp["bounding"][1]
        gx1 = gx0 + accel_grp["bounding"][2]
        gy1 = gy0 + accel_grp["bounding"][3]
        for nid in accel_ids:
            n = m_nodes[nid]
            if not (gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                    and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1):
                errs.append(f"W1 加速区组框未罩住 [{nid}](方案C 组框收纳)")

    # 5. 宿主结构:type/properties.subgraph=uuid;输入槽序与子图 inputs 对齐;widget 值
    host = m_nodes[HOST_ID]
    if host["type"] != SG_UUID or host["properties"].get("subgraph") != SG_UUID:
        errs.append("[40] 宿主 type/properties.subgraph 与子图 uuid 不一致")
    if len(host["inputs"]) != len(sg["inputs"]):
        errs.append("[40] 宿主 inputs 槽数与子图 inputs 不一致")
    for i, (hi, si) in enumerate(zip(host["inputs"], sg["inputs"])):
        if hi["name"] != si["name"] or hi["type"] != si["type"]:
            errs.append(f"[40] 宿主 inputs[{i}]({hi['name']}) 与子图 inputs[{i}]({si['name']}) 不对齐")
    if host["widgets_values"] != [truth["types"][0]["subject"], DEFAULT_TYPE, False]:
        errs.append("[40] 宿主 widgets_values 应=[人物例一主体句, 人物, False](型选择默认人物/开关默认关)")

    # 6. 外部接线:加载器/主体句→宿主;PE 链主画布(W2);联动链→[5];加速槽→[7]
    ext_want = [
        (12, 2, 0, HOST_ID, 0, "CLIP"), (13, 3, 0, HOST_ID, 1, "VAE"),
        (15, SUBJECT_ID, 0, HOST_ID, 2, "STRING"),
        (34, PE_SW_ID, 0, HOST_ID, 5, "STRING"),   # 冻结回流线(提示词槽)
        (16, HOST_ID, 0, SAMPLER_ID, 1, "CONDITIONING"), (17, HOST_ID, 1, SAMPLER_ID, 2, "CONDITIONING"),
        (18, PE_SW_ID, 0, PREVIEW_ID, 0, "STRING"),
        (31, 11, 0, PE_RW_ID, 0, "CLIP"),
        (32, PE_RW_ID, 0, PE_SW_ID, 1, "STRING"), (33, HOST_ID, 2, PE_SW_ID, 0, "STRING"),
        # 0926 线不遮节点:九型 W/H 默认路经垫脚石 [191]/[192](语义接线不变)
        (45, HOST_ID, 3, RR_WH_W_ID, 0, "INT"), (46, HOST_ID, 4, RR_WH_H_ID, 0, "INT"),
        (52, RR_WH_W_ID, 0, SW_W_ID, 0, "INT"), (53, RR_WH_H_ID, 0, SW_H_ID, 0, "INT"),
        (47, RATIO_PB_ID, 0, SW_W_ID, 2, "BOOLEAN"), (48, RATIO_PB_ID, 0, SW_H_ID, 2, "BOOLEAN"),
        (35, PE_RW_ID, 2, RATIO_RW_ID, 0, "STRING"), (36, PE_RW_ID, 2, RATIO_RH_ID, 0, "STRING"),
        (43, MATH_W_ID, 1, SW_W_ID, 1, "INT"), (44, MATH_H_ID, 1, SW_H_ID, 1, "INT"),
        (1, SW_W_ID, 0, LATENT_ID, 0, "INT"), (2, SW_H_ID, 0, LATENT_ID, 1, "INT"),
        (5, LATENT_ID, 0, SAMPLER_ID, 3, "LATENT"),
        # 0926 线不遮节点:MODEL 顶通道经垂降垫脚石 [190] 送加速区两臂
        (8, 1, 0, RR_M8A_ID, 0, "MODEL"), (20, RR_M8B_ID, 0, RR_M8C_ID, 0, "MODEL"),
        (23, RR_M8C_ID, 0, LORA_ID, 0, "MODEL"), (49, RR_M8C_ID, 0, LORA_SW_ID, 0, "MODEL"),
        (24, LORA_ID, 0, LORA_SW_ID, 1, "MODEL"),
        (25, LORA_PB_ID, 0, LORA_SW_ID, 2, "BOOLEAN"), (26, LORA_SW_ID, 0, SAMPLER_ID, 0, "MODEL"),
        (10, 3, 0, RR_M10A_ID, 0, "VAE"), (22, RR_M10B_ID, 0, 8, 1, "VAE"),
        (27, STEPS_C40_ID, 0, STEPS_SW_ID, 0, "INT"), (28, STEPS_C6_ID, 0, STEPS_SW_ID, 1, "INT"),
        (29, LORA_PB_ID, 0, STEPS_SW_ID, 2, "BOOLEAN"), (30, STEPS_SW_ID, 0, SAMPLER_ID, 4, "INT"),
    ]
    got = {(l[0], l[1], l[2], l[3], l[4], l[5]) for l in g["links"]}
    for w in ext_want:
        if w not in got:
            errs.append(f"外部接线缺: link{w[0]} {[x for x in w[1:]]}")
    for banned in ("ResolutionSelector", "TextEncodeQwenImage21",
                   "StringConstant", "StringConcatenate"):
        if any(n["type"] == banned for n in g["nodes"]):
            errs.append(f"主图不应有平铺 {banned}(装配核心已收进子图/分辨率已随型直驱)")
    # W2:PE 改写件必须在主画布(恰 1,与 i2i/edit 的 PE 位置同构)
    pe_mains = [n for n in g["nodes"] if n["type"] == "QwenImage21_T2IPromptRewrite"]
    if len(pe_mains) != 1 or pe_mains[0]["id"] != PE_RW_ID:
        errs.append(f"W2:主图应恰 1 个 QwenImage21_T2IPromptRewrite[{PE_RW_ID}](PE 链迁出子图),"
                    f"得 {[n['id'] for n in pe_mains]}")

    # 6b. LoRA 加速槽(R26.4 统一接线;D1 硬性 AC=关闭也正常生成)
    loras = [n for n in g["nodes"] if n["type"] == "LoraLoaderModelOnly"]
    if len(loras) != 1 or loras[0]["id"] != LORA_ID:
        errs.append(f"LoraLoaderModelOnly[{LORA_ID}] 应恰 1 个(加速槽)")
    else:
        if loras[0]["widgets_values"] != [LORA_FILE, 0.8]:
            errs.append(f"LoRA 槽 name/strength 漂移: {loras[0]['widgets_values']}")
        if _trace_reroute_main(m_links, m_nodes, loras[0]["inputs"][0]["link"]) != 1:
            errs.append("LoRA 槽 model 上游应 UNETLoader[1](可穿顶通道 Reroute)")
    lsw = m_nodes[LORA_SW_ID]
    if lsw["type"] != "ComfySwitchNode" or lsw["outputs"][0]["type"] != "MODEL":
        errs.append(f"[{LORA_SW_ID}] 应为 MODEL 泛型开关")
    if lsw["widgets_values"][0] is not False:
        errs.append(f"[{LORA_SW_ID}] LoRA 开关默认应 false(旁路=正常生成)")
    if _trace_reroute_main(m_links, m_nodes, lsw["inputs"][0]["link"]) != 1:
        errs.append("MODEL 开关 on_false 上游应 UNETLoader[1](直连臂,可穿通道)")
    if m_links[lsw["inputs"][1]["link"]][1] != LORA_ID:
        errs.append("MODEL 开关 on_true 上游应 LoraLoaderModelOnly")
    if m_links[lsw["inputs"][2]["link"]][1] != LORA_PB_ID:
        errs.append("MODEL 开关 switch 上游应 PrimitiveBoolean[30]")
    if m_nodes[LORA_PB_ID]["widgets_values"][0] is not False:
        errs.append(f"[{LORA_PB_ID}] LoRA 开关源默认应 false")
    if m_links[m_nodes[SAMPLER_ID]["inputs"][0]["link"]][1] != LORA_SW_ID:
        errs.append("KSampler.model 上游应 MODEL 开关(加速槽二选一)")
    lora_reach = _dry_run_main(g)
    if LORA_ID in lora_reach:
        errs.append("干跑:关态执行图含 LoraLoaderModelOnly(关闭必须=正常生成,懒执行旁路)")
    if PE_RW_ID not in lora_reach:
        errs.append("干跑:默认态 PE 改写应在执行源内(0926 裁定1 默认 PE 开路,[141]=true)")
    for nid in (RATIO_RW_ID, RATIO_RH_ID, CONV_RW_ID, CONV_RH_ID, MATH_W_ID, MATH_H_ID):
        if nid in lora_reach:
            errs.append(f"干跑:默认态 [{nid}] 不应可达(画幅联动默认关,懒执行旁路)")

    # 6c. 满血接线轮·steps 联动(一拨全配):[177] INT 开关 false→[178]=40/true→[179]=6
    #     →[7].steps(widget 转输入);switch 槽与 MODEL 开关同一布尔源 [30](扇出两线)
    ssw = m_nodes[STEPS_SW_ID]
    if ssw["type"] != "ComfySwitchNode" or ssw["outputs"][0]["type"] != "INT":
        errs.append(f"[{STEPS_SW_ID}] 应为 INT 泛型开关(steps 联动)")
    if ssw["widgets_values"][0] is not False:
        errs.append(f"[{STEPS_SW_ID}] steps 联动开关默认应 false(关=原路 40)")
    for cid, want in ((STEPS_C40_ID, STEPS_OFF), (STEPS_C6_ID, STEPS_ON)):
        c = m_nodes[cid]
        if c["type"] != "PrimitiveInt" or c["widgets_values"][0] != want:
            errs.append(f"[{cid}] PrimitiveInt 常量应={want}(关臂 40 原路/开臂 6 卡荐档),"
                        f"得 {c.get('widgets_values')}")
    if m_links[ssw["inputs"][0]["link"]][1] != STEPS_C40_ID:
        errs.append(f"[{STEPS_SW_ID}].on_false 上游应常量40 [{STEPS_C40_ID}](关=自动回 40 原路)")
    if m_links[ssw["inputs"][1]["link"]][1] != STEPS_C6_ID:
        errs.append(f"[{STEPS_SW_ID}].on_true 上游应常量6 [{STEPS_C6_ID}](开=自动 6 步)")
    if m_links[ssw["inputs"][2]["link"]][1] != LORA_PB_ID:
        errs.append(f"[{STEPS_SW_ID}].switch 上游应同一布尔源 [{LORA_PB_ID}](一拨全配)")
    if sorted(m_nodes[LORA_PB_ID]["outputs"][0]["links"] or []) != sorted([25, 29]):
        errs.append(f"[{LORA_PB_ID}] 开关源应扇出恰两线(MODEL 开关+steps 开关,同一布尔源)")
    ks_steps = next((i for i in m_nodes[SAMPLER_ID]["inputs"] if i.get("name") == "steps"), None)
    if not ks_steps or ks_steps.get("link") != 30 or "widget" not in ks_steps:
        errs.append("[7].steps 应为 widget 转输入接 [177] 联动开关(序列化照 [150].base 先例)")
    off_steps = _steps_value_main(g)
    if off_steps != STEPS_OFF:
        errs.append(f"干跑:关态 steps 应解析={STEPS_OFF}(自动回原路),得 {off_steps}")
    on_reach = _dry_run_main(g, pb_override=True)
    if LORA_ID not in on_reach:
        errs.append("干跑:开态(运行态 [30]=true)执行图应含 LoraLoaderModelOnly(LoRA 真入链)")
    on_steps = _steps_value_main(g, pb_override=True)
    if on_steps != STEPS_ON:
        errs.append(f"干跑:开态(一拨全配)steps 应解析={STEPS_ON}(v0.2 卡荐档),得 {on_steps}")

    # 7. MyQi21DaojieBase 在场+combo 默认人物+三出接线;qi21_bases.json↔05 库互锁;
    #    锁层A 恒挂逐字=库;九型 W/H 经通道 Reroute 出子图
    base_node = i_nodes.get(BASE_ID)
    if not base_node or base_node["type"] != "MyQi21DaojieBase":
        errs.append(f"[{BASE_ID}] 应为 MyQi21DaojieBase(九选一底座节点)")
    else:
        if base_node["widgets_values"] != [DEFAULT_TYPE]:
            errs.append(f"[{BASE_ID}] combo 默认应为 {DEFAULT_TYPE!r}")
        b_inp = base_node["inputs"][0]
        if b_inp.get("name") != "base" or "widget" not in b_inp:
            errs.append("[150].base 应为 widget 转输入(combo 经宿主面板外露)")
        bl = i_links.get(b_inp.get("link"))
        if not bl or bl["origin_id"] != -10 or bl["origin_slot"] != 3:
            errs.append("[150].base 应接 -10 槽3(宿主面板「型选择」COMBO)")
        if [o["name"] for o in base_node["outputs"]] != ["BASE", "WIDTH", "HEIGHT", "型名"]:
            errs.append("[150] 四出应为 BASE/WIDTH/HEIGHT/型名")
        if i_links[i_nodes[CONCAT1_ID]["inputs"][1]["link"]]["origin_id"] != BASE_ID:
            errs.append("拼接①.string_b 上游应为 [150].BASE(级联已退役)")
        if _trace_origin(i_links, i_nodes, i_nodes[RR_W_A_ID]["inputs"][0]["link"]) != BASE_ID or \
           _trace_origin(i_links, i_nodes, i_nodes[RR_H_A_ID]["inputs"][0]["link"]) != BASE_ID:
            errs.append("W/H 通道首拐点上游应为 [150].WIDTH/HEIGHT(九型直驱)")
    if _qi21_base_text(DEFAULT_TYPE) != truth["types"][0]["constant_text"]:
        errs.append("干跑 BASE(qi21_bases.json 人物)与 05 库人物型②层装配不逐字一致")
    if i_nodes[LOCK_ID]["widgets_values"][0] != truth["const_a"]:
        errs.append("[110] 通用锁层常量A 与库首节常量不逐字一致")
    lock_link = i_links[i_nodes[LOCK_ID]["outputs"][0]["links"][0]]
    if lock_link["target_id"] != CONCAT2_ID:
        errs.append("[110] 应恒挂直连拼接②(不随型走开关)")

    # 8. 级联退役+子图收窄(W2/W3):子图 ComfySwitchNode 恰 1 枚(RGBA);PE/联动链
    #    件零残留子图;联动链锚(主画布):正则/公式逐字、[157][158] 接线、[180] 总闸
    switches = [n for n in sg["nodes"] if n["type"] == "ComfySwitchNode"]
    if sorted(n["id"] for n in switches) != [RGBA_SW_ID]:
        errs.append(f"级联退役:子图开关应恰 1 枚(RGBA;提示词/画幅联动开关已迁主画布),"
                    f"得 {[n['id'] for n in switches]}")
    for sw in switches:
        if sw["widgets_values"][0] is not False:
            errs.append(f"[{sw['id']}] 开关默认非 false")
        if _trace_origin(i_links, i_nodes, sw["inputs"][2]["link"]) != -10:
            errs.append(f"[{sw['id']}] switch 槽应接 -10(宿主面板,可穿通道 Reroute)")
    sconsts = [n for n in sg["nodes"] if n["type"] == "StringConstant"]
    if sorted(n["id"] for n in sconsts) != sorted([LOCK_ID, RGBA_HEAD_ID, RGBA_TAIL_ID]):
        errs.append(f"级联退役:子图 StringConstant 应恰 3 枚(锁层A+RGBA头尾),得 {[n['id'] for n in sconsts]}")
    for banned in ("QwenImage21_T2IPromptRewrite", "RegexExtract",
                   "ComfyNumberConvert", "ComfyMathExpression"):
        if any(n["type"] == banned for n in sg["nodes"]):
            errs.append(f"W3 子图收窄:子图不应有 {banned}(PE 链/画幅联动已迁主画布)")
    # 联动链锚(主画布)
    if m_nodes[RATIO_RW_ID]["widgets_values"][1] != RATIO_W_PATTERN or \
       m_nodes[RATIO_RH_ID]["widgets_values"][1] != RATIO_H_PATTERN:
        errs.append("画幅联动正则 pattern 漂移")
    if m_nodes[MATH_W_ID]["widgets_values"][0] != MATH_W_EXPR or \
       m_nodes[MATH_H_ID]["widgets_values"][0] != MATH_H_EXPR:
        errs.append("画幅联动公式漂移")
    for mid, conv_a, conv_b in ((MATH_W_ID, CONV_RW_ID, CONV_RH_ID), (MATH_H_ID, CONV_RW_ID, CONV_RH_ID)):
        a_src = m_links[m_nodes[mid]["inputs"][0]["link"]][1]
        b_src = m_links[m_nodes[mid]["inputs"][1]["link"]][1]
        if a_src != conv_a or b_src != conv_b:
            errs.append(f"[{mid}] 公式 values.a/b 上游应为宽/高转数([{CONV_RW_ID}]/[{CONV_RH_ID}])")
    if m_links[m_nodes[SW_W_ID]["inputs"][1]["link"]][1] != MATH_W_ID or \
       m_links[m_nodes[SW_H_ID]["inputs"][1]["link"]][1] != MATH_H_ID:
        errs.append("宽高开关 on_true 上游应为公式宽/高")
    wh = m_nodes[PE_RW_ID]["outputs"][2]
    if wh["name"] != "wh_ratio" or sorted(wh["links"] or []) != [35, 36]:
        errs.append("[140].wh_ratio 应扇出两线喂宽高正则(联动源)")
    if m_nodes[RATIO_PB_ID]["widgets_values"][0] is not False:
        errs.append(f"[{RATIO_PB_ID}] 画幅联动开关默认应 false(恒九型)")
    if sorted(m_nodes[RATIO_PB_ID]["outputs"][0]["links"] or []) != sorted([47, 48]):
        errs.append(f"[{RATIO_PB_ID}] 联动总闸应扇出恰两线(宽/高联动开关)")
    # 0926 线不遮节点:九型默认臂经垫脚石(可穿 Reroute),语义仍=[40] 宽/高输出
    for sw_id, host_slot in ((SW_W_ID, 3), (SW_H_ID, 4)):
        l_ = m_links[m_nodes[sw_id]["inputs"][0]["link"]]
        while m_nodes[l_[1]]["type"] == "Reroute":
            l_ = m_links[m_nodes[l_[1]]["inputs"][0]["link"]]
        if l_[1] != HOST_ID or l_[2] != host_slot:
            errs.append(f"[{sw_id}].on_false 上游应 [40] 输出槽{host_slot}"
                        f"(九型 W/H 默认路,可穿垫脚石)")
    lat_w = m_links[m_nodes[LATENT_ID]["inputs"][0]["link"]]
    lat_h = m_links[m_nodes[LATENT_ID]["inputs"][1]["link"]]
    if (lat_w[1], lat_w[4]) != (SW_W_ID, 0) or (lat_h[1], lat_h[4]) != (SW_H_ID, 1):
        errs.append("[5] 宽高应接 [157]/[158] 联动开关输出(默认=九型直驱)")

    # 9. 干跑谓词(静态 graphToPrompt 等价):直写选配臂([141] on_false)装配链完整性;
    #    默认态(0926 裁定1)=PE 开路,文本动态出 PE,[141]=true 由第 10 节+主图干跑另核
    reach_int, assembled = _dry_run_default(g, sg)
    if BASE_ID not in reach_int or LOCK_ID not in reach_int:
        errs.append(f"干跑:直写选配臂应含 [{BASE_ID}]底座/[{LOCK_ID}]锁层,得 {sorted(reach_int)}")
    for nid in (RGBA_HEAD_ID, RGBA_TAIL_ID, RGBA_CAT1_ID, RGBA_CAT2_ID, TE_RGBA_ID):
        if nid in reach_int:
            errs.append(f"干跑:直写选配臂 [{nid}] 不应可达(RGBA 懒执行旁路)")
    want = "\n".join([truth["types"][0]["subject"],
                      _qi21_base_text(DEFAULT_TYPE), truth["const_a"]])
    if assembled != want:
        errs.append("干跑:直写选配臂装配全文与库人物型四层组合不逐字一致")

    # 10. PE/RGBA 承袭(W2 后 PE 链在主画布):[140] 参数/clip;[141] 接线=最终文本路由;
    #     RGBA 官方公式(子图;头尾逐字+拼接路+空格 delimiter)
    pe = m_nodes[PE_RW_ID]
    if pe["widgets_values"] != [PE_SEED_PROMPT, *PE_PARAMS]:
        errs.append("PE 改写组参数漂移(官方 README 推荐值;pp=1.5 已定档 0925)")
    if m_links[pe["inputs"][0]["link"]][1] != 11:
        errs.append("[140].clip 上游应 PE 专属 CLIPLoader[11]")
    pe_clip = [n for n in g["nodes"] if n["type"] == "CLIPLoader" and n["widgets_values"][0] == PE_CLIP_FILE]
    if len(pe_clip) != 1:
        errs.append("PE 专属 CLIPLoader 缺失(应在主图加载器组)")
    psw = m_nodes[PE_SW_ID]
    if psw["type"] != "ComfySwitchNode" or psw["outputs"][0]["type"] != "STRING":
        errs.append(f"[{PE_SW_ID}] 应为 STRING 泛型开关(提示词开关)")
    if psw["widgets_values"][0] is not True:
        errs.append(f"[{PE_SW_ID}] 提示词开关默认应 true(PE 开路,0926 裁定1 含画布本体;关=直写按图选配)")
    if psw["inputs"][2].get("link") is not None:
        errs.append(f"[{PE_SW_ID}] switch 应为本件 widget(照 i2i [15] 式,不占宿主面板)")
    f_src = m_links[psw["inputs"][0]["link"]]
    if (f_src[1], f_src[2]) != (HOST_ID, 2):
        errs.append("[141].on_false 上游应 [40].prompt 输出(装配全文)")
    if m_links[psw["inputs"][1]["link"]][1] != PE_RW_ID:
        errs.append("[141].on_true 上游应 [140] PE 改写")
    if sorted(psw["outputs"][0]["links"] or []) != sorted([18, 34]):
        errs.append("[141] 输出应扇出恰两线([27] 装配预览 + [40].提示词回流)")
    pv = m_nodes[PREVIEW_ID]
    if m_links[pv["inputs"][0]["link"]][1] != PE_SW_ID:
        errs.append("[27] 装配预览应接 [141] 开关输出(最终文本)")
    if i_nodes[RGBA_HEAD_ID]["widgets_values"][0] != RGBA_HEAD_EN or \
       i_nodes[RGBA_TAIL_ID]["widgets_values"][0] != RGBA_TAIL_EN:
        errs.append("RGBA 官方头/尾常量非官方原文逐字")
    rgba_prompt_link = i_links.get(i_nodes[TE_RGBA_ID]["inputs"][3]["link"])
    if not rgba_prompt_link or rgba_prompt_link["origin_id"] != RGBA_CAT2_ID:
        errs.append("[143].prompt 应接 [163] RGBA 公式拼接输出")
    if i_nodes[TE_RGBA_ID]["widgets_values"][0] != "":
        errs.append("[143] prompt widget 应清空(公式路现拼)")
    cat1, cat2 = i_nodes[RGBA_CAT1_ID], i_nodes[RGBA_CAT2_ID]
    if cat1["widgets_values"][2] != " " or cat2["widgets_values"][2] != " ":
        errs.append("RGBA 公式拼接 delimiter 应为空格")
    if i_links[cat1["inputs"][1]["link"]]["origin_id"] != CONCAT2_ID:
        errs.append("RGBA 公式拼接①.string_b 上游应为装配全文")
    if host["widgets_values"][2] is not False:
        errs.append("[40] 面板 RGBA透明开关默认必须 false")

    # 10b. 采样完整态:steps=40(官方完整档);euler/simple/cfg1 不变
    sampler = m_nodes[SAMPLER_ID]
    wv = sampler["widgets_values"]
    if wv[2] != 40:
        errs.append(f"[7] KSampler steps 应=40(官方完整档),得 {wv[2]}")
    if wv[3] != 1 or wv[4] != "euler" or wv[5] != "simple" or wv[1] != "fixed":
        errs.append("[7] KSampler cfg/scheduler/sampler/seed 控制漂移")

    # 11. 无孤儿节点(SaveImage 向上可达;MarkdownNote/easy showAnything 显示型端点豁免)
    seen, stack = set(), [9]
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        for inp in m_nodes[nid].get("inputs", []):
            lid = inp.get("link")
            if lid is not None:
                stack.append(m_links[lid][1])
    orphans = sorted(i for i in m_nodes if i not in seen
                     and m_nodes[i]["type"] not in ("MarkdownNote", "easy showAnything"))
    if orphans:
        errs.append(f"孤儿节点: {orphans}")

    # 12. 说明 Note 必含要点(W5 两笔终审:负面占位/pp 定档;W1 摆设值/组框两态)
    note = next(n for n in g["nodes"] if n["type"] == "MarkdownNote")["widgets_values"][0]
    for token in ("cfg 恒 1", "步数 40", "40-50", RGBA_HEAD_EN, RGBA_TAIL_EN, RGBA_HEAD_ZH,
                  RGBA_TAIL_ZH, "qwen-image-2-1-prompter", "05-道劫规范提示词库.md", "九型", "空镜无人",
                  "MyQi21DaojieBase", "画幅联动", "恒挂", "美化", "[27]", "ResolutionSelector 已退役",
                  "LoraLoaderModelOnly", LORA_FILE,
                  "一拨全配(开=自动 6 步加速,关=自动回 40,无需手动调)", "[177]", "[178]", "[179]",
                  "shift_terminal=0.02", "关闭=正常生成", "TE-Speed",
                  # 0925 收窄轮新要点
                  "数学上不参与采样", "官方同构", "占位", "presence_penalty=1.5 已定档",
                  "摆设值不生效", "加速区", "[140]", "[141]", "[180]",
                  # 0925 毒理定案 C1:PE 种子纪律(反噪)
                  "PE 种子纪律", "画面干净平滑", "而非纸面纹理",
                  # 0926 裁定1:默认 PE 开路含画布本体(Note 必含新口径)
                  "默认 PE 改写", "按图选配"):
        if token not in note:
            errs.append(f"说明 Note 缺要点: {token!r}")
    if note.lstrip().startswith("# "):
        errs.append("说明 Note 以一级大标题开幅(禁横幅)")
    return errs


def _trace_reroute_main(m_links: dict, m_nodes: dict, lid: int) -> int:
    """主图沿 link 反向溯源,穿过顶通道 Reroute 回到实源节点 id。"""
    seen = set()
    while True:
        l = m_links[lid]
        oid = l[1]
        if m_nodes[oid]["type"] != "Reroute" or oid in seen:
            return oid
        seen.add(oid)
        lid = m_nodes[oid]["inputs"][0]["link"]


def _switch_bool_main(m_links: dict, m_nodes: dict, node: dict,
                      pb_override: bool | None = None) -> bool:
    """主图 ComfySwitchNode 有效布尔:switch 槽有连线→解析到布尔源(满血接线轮起
    [30] 一源扇出驱 MODEL/steps 两开关,运行态翻转=改 [30] 一处);否则本件 widget。"""
    lid = node["inputs"][2].get("link")
    if lid is not None:
        src = m_nodes[m_links[lid][1]]
        if src["type"] == "PrimitiveBoolean":
            if pb_override is not None:
                return pb_override
            return bool(src["widgets_values"][0])
    return bool(node["widgets_values"][0])


def _dry_run_main(g: dict, pb_override: bool | None = None) -> set[int]:
    """主图执行集(SaveImage 回溯;ComfySwitchNode 懒执行=只走选中臂)。

    R26.4 硬性 AC(用户令):加速槽「关闭=正常生成」——关态 MODEL 直连,
    执行图零 LoraLoader(LoRA 不加载);pb_override=True 模拟运行态把 [30] 拨开;
    W2 后另核(0926 裁定1 更新):默认态 PE 改写 [140] 在执行源内([141] 默认
    true=PE 开路);画幅联动链 [151]-[156] 仍不在执行源(懒执行,总闸默认关)。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    reach: set[int] = set()
    stack = [9]  # SaveImage
    while stack:
        nid = stack.pop()
        if nid in reach:
            continue
        reach.add(nid)
        node = m_nodes[nid]
        slots = (([1 if _switch_bool_main(m_links, m_nodes, node, pb_override) else 0]
                  if node["type"] == "ComfySwitchNode" else range(len(node.get("inputs", [])))))
        for si in slots:
            lid = node["inputs"][si].get("link")
            if lid is not None:
                stack.append(m_links[lid][1])
    return reach


def _steps_value_main(g: dict, pb_override: bool | None = None) -> int | None:
    """KSampler.steps 溯源干跑:widget 转输入→[177] steps 联动开关→布尔源定臂→
    PrimitiveInt 常量值(关=40/开=6;非链接形态返回 None=联动断链)。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    ks = m_nodes[SAMPLER_ID]
    steps_inp = next((i for i in ks["inputs"] if i.get("name") == "steps"), None)
    if steps_inp is None or steps_inp.get("link") is None:
        return None
    sw = m_nodes[m_links[steps_inp["link"]][1]]
    if sw["type"] != "ComfySwitchNode":
        return None
    arm = 1 if _switch_bool_main(m_links, m_nodes, sw, pb_override) else 0
    src = m_nodes[m_links[sw["inputs"][arm]["link"]][1]]
    return src["widgets_values"][0]


def _dry_run_default(g: dict, sg: dict) -> tuple[set[int], str]:
    """静态干跑:直写选配臂视图(0926 裁定1 后默认臂=[141] true=PE 开路,PE 文本运行
    时动态出改写器、静态不可逐字;本函数固定走 [141].on_false 直写臂)装配文本溯源
    与可达集——直写臂装配链完整性与逐字组合仍是硬契约(选配档不许坏)。

    W2 后装配全文路径:主编码 [142].prompt ← -10「提示词」槽 ← 宿主外链 [34] ←
    主画布 [141] 开关(本视图走 on_false)← [33] 宿主 prompt 输出 ← 子图
    out-2 ← [131] 装配全文(主体句+BASE+锁层A)——文本出子图经 [141] 再回子图,
    懒执行语义不变(默认态 [140] 入链由主图干跑另核)。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    i_nodes = {n["id"]: n for n in sg["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    i_links = {l["id"]: l for l in sg["links"]}
    host = m_nodes[HOST_ID]
    host_widget_values = dict(zip([i["name"] for i in host["inputs"] if "widget" in i],
                                  host["widgets_values"]))

    def resolve_node(src: dict) -> list[str]:
        """按节点类型解析其文本贡献(拼接=两输入递归;开关=默认 on_false 懒执行)。"""
        if src["type"] == "StringConstant":
            return [src["widgets_values"][0]]
        if src["type"] == "MyQi21DaojieBase":
            return [_qi21_base_text(host_widget_values.get("型选择", DEFAULT_TYPE))]
        if src["type"] == "ComfySwitchNode":
            if src["widgets_values"][0] is not False:
                raise SystemExit(f"干跑:默认链开关非 false [{src['id']}]")
            return resolve_internal(src["id"], 0)  # on_false(懒执行)
        if src["type"] == "StringConcatenate":
            return resolve_internal(src["id"], 0) + resolve_internal(src["id"], 1)
        return []

    def resolve_internal(node_id: int, slot: int) -> list[str]:
        """解析子图内部某输入槽的文本贡献:内链→内部节点/-10(外链→主图源/输出)。"""
        texts: list[str] = []
        inp = i_nodes[node_id]["inputs"][slot]
        lid = inp.get("link")
        if lid is None:
            return texts
        l = i_links[lid]
        if l["origin_id"] == -10:
            hi = host["inputs"][l["origin_slot"]]
            if hi.get("link") is not None:  # 外链→主图源(提示词←[141] 开关)
                src = m_nodes[m_links[hi["link"]][1]]
                if src["type"] == "ComfySwitchNode":
                    # [141]=主画布 PE 开关(0926 裁定1 默认 true=PE 开路);本视图固定
                    # 走 on_false 直写选配臂核装配文本,不随 widget 定臂
                    f_l = m_links[src["inputs"][0]["link"]]
                    if (f_l[1], f_l[2]) != (HOST_ID, 2):
                        raise SystemExit("干跑:[141].on_false 应接 [40].prompt 输出")
                    out_l = i_links[sg["outputs"][2]["linkIds"][0]]
                    texts.extend(resolve_node(i_nodes[out_l["origin_id"]]))
                elif src["type"] == "PrimitiveStringMultiline":
                    texts.append(src["widgets_values"][0])
            else:  # widget 型(型选择 COMBO 等)——MyQi21DaojieBase 的 base 即此路
                if i_nodes[node_id]["type"] == "MyQi21DaojieBase":
                    texts.append(_qi21_base_text(host_widget_values.get("型选择", DEFAULT_TYPE)))
            return texts
        texts.extend(resolve_node(i_nodes[l["origin_id"]]))
        return texts

    # 装配文本 = 主编码 [142].prompt(「提示词」槽)溯源
    texts = resolve_internal(TE_ID, 3)

    # 默认态参与执行的子图内部节点(懒执行:开关只走 on_false;直写选配臂装配全文
    # 支路经 prompt 输出出子图,故从 [144] 与 [131] 双起点回溯)
    reach: set[int] = set()

    def walk(node_id: int):
        if node_id in reach:
            return
        reach.add(node_id)
        node = i_nodes[node_id]
        slots = [0] if node["type"] == "ComfySwitchNode" else range(len(node.get("inputs", [])))
        for si in slots:
            lid = node["inputs"][si].get("link")
            if lid is None:
                continue
            l = i_links[lid]
            if l["origin_id"] != -10:
                walk(l["origin_id"])

    walk(RGBA_SW_ID)   # positive 默认路终点开关(on_false=[142] 主编码臂)
    walk(CONCAT2_ID)   # 装配全文支路(prompt 输出→[141] 默认臂→回编码)
    return reach, "\n".join(texts)


def main() -> int:
    check_only = "--check" in sys.argv
    truth = load_truth()
    sg, _ = build_subgraph(truth)
    g = build_main(truth, sg)
    errs = self_check(g, truth)
    if errs:
        for e in errs:
            print(f"FAIL(构建期): {e}", file=sys.stderr)
        return 1

    payload = json.dumps(g, ensure_ascii=False, indent=2) + "\n"
    if not check_only:
        existing = QI21_JSON.read_text(encoding="utf-8") if QI21_JSON.is_file() else None
        if existing != payload:
            QI21_JSON.write_text(payload, encoding="utf-8")
            print(f"写盘: {QI21_JSON.relative_to(_REPO)}")
        else:
            print(f"在位且一致(幂等跳过): {QI21_JSON.relative_to(_REPO)}")

    # 写盘后复读自查(磁盘态为准):json.loads 往返 + 全谓词
    if QI21_JSON.is_file():
        disk = json.loads(QI21_JSON.read_text(encoding="utf-8"))
        disk_errs = self_check(disk, truth)
        if disk_errs:
            for e in disk_errs:
                print(f"FAIL(磁盘态): {e}", file=sys.stderr)
            return 1
    else:
        print("FAIL: qi21 件未在位", file=sys.stderr)
        return 1

    n_nodes = len(disk["nodes"])
    n_links = len(disk["links"])
    sg_nodes = len(disk["definitions"]["subgraphs"][0]["nodes"])
    sg_links = len(disk["definitions"]["subgraphs"][0]["links"])
    zh_list = " ".join(t["zh"] for t in truth["types"])
    print(f"PASS: 主图 {n_nodes} 节点/{n_links} 链 + 子图 {sg_nodes} 节点/{sg_links} 链;九型={zh_list};"
          f"W2 PE 链迁主画布([140]/[141]/[151]-[158]/[180],冻结回流线 {FROZEN_BACK_LINK} 单点豁免+左向线恰1谓词);"
          f"W3 子图收窄=九型+锁层+拼接+RGBA公式+双路编码(三行,宿主三 widget 同构 i2i);"
          f"W1 加速区组框收纳六件(主图 group 4);W5 负面 cfg=1 占位说明+pp=1.5 定档;"
          f"W6 零负区(全节点 pos≥80,0926 收紧=发现项3 互锁)+输出口最右(输出槽钉最右列);"
          f"0926 铁律·线不遮节点全绿(蛇形联动两行+装配横排+PE 带+主链上移+加速区两行,"
          f"垫脚石 {RR_M8C_ID}/{RR_WH_W_ID}/{RR_WH_H_ID}+子图 {RR_SWC_ID},零遮挡贝塞尔精判);"
          f"默认=①人物(combo 经宿主面板外露,宽高经联动开关直驱 [5],steps=40 完整态,"
          f"RGBA 官方头尾公式,PE 默认开路=0926 裁定1([141] true,关=直写按图选配)/联动默认关);LoRA 加速槽在位(name 预填 viggle v0.2.1 r256,"
          f"strength 0.8=0925 探针最优,"
          f"默认关=MODEL 直连,关态执行图零 LoraLoader);满血接线(steps 联动 [177] 同受 [30] 驱动:"
          f"关=自动回 40 原路/开=一拨自动 6+LoRA 挂链);干跑直写选配臂装配全文逐字=库组合;"
          f"双向/横向(恰 1 冻结回流线)/三行排版/零重叠/est 间距(横≥200/纵≥80)/零线遮节点(0926)/"
          f"group 预算(子图3·主图4,子图各框单一阶段行且不相交)/group int/子图 linkIds 逐项登记/"
          "锁层A 恒挂/懒执行旁路/零孤儿全绿")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
