#!/usr/bin/env python3
"""qi21-道劫-t2i.json 幂等生成器(09-23,道劫装配子图版;同日深夜四成果+深检吸收总装轮)。

历史轮:改名(旧 qwen21-daojie-t2i-pro.json 退役)→子图化(学 K2-文生图-道劫.json
[90] 组织法)→底座美化(②层=05 库 09-23 美化版)。本轮总装四件令+深检吸收清单:

  ①MyQi21DaojieBase 节点进子图(my_nodes/nodes/my_qi21_base.py,09-23 造件):
    combo 九选一经宿主面板外露(子图输入「型选择」COMBO widget,默认 人物——
    序列化口径=K2 [90].base 实证:内部节点 base 槽带 widget 标记+接 -10 边界线,
    宿主 widgets_values 按槽序携带选值);八级布尔级联[120]-[127]与九
    StringConstant[101]-[109]退役;BASE 与主体句/锁层A 按原换行分层拼接;
    WIDTH/HEIGHT 直驱主图 [5] 空潜(经宿主 width/height 两输出),主图
    ResolutionSelector[4] 与 Note 写死档位表废止(九型档=qi21_bases.json 真源,
    W/H 口径与 K2 MyDaojieBase 一比一)。
  ②宿主 PE 与 RGBA widget 默认全 false(功能保留可开,默认旁路懒执行)。
  ③采样完整态:KSampler steps 25→40(官方完整档;官方区间 40-50 写进 Note),
    euler/simple/cfg1 不变。
  ④深检吸收清单落地:
    - RGBA 官方公式化(research/12 答A必改1):[143] 从「固定英文水墨演示句整体
      替换」改为「官方头句+装配全文([27] 同源)+官方尾句」拼接路([160][161]
      官方头尾常量逐字+[162][163] 拼接),头尾逐字对齐官方原文(英文
      This is an RGBA image with transparency. / The image has alpha channel
      and the background is transparent.;中文版『这是一张带有透明度的RGBA图像。/
      该图像具有alpha通道,背景是透明的。』同步记入 Note,英文为画布接线用)。
    - wh_ratio→分辨率联动·可选开关(research/10 §4.2):[140] 空置的 wh_ratio
      输出经 RegexExtract×2+ComfyNumberConvert×2+ComfyMathExpression×2(全核心
      节点,序列化口径=官方 blueprint 实证)解析建议画幅并按 4.2MP 求宽高,
      [157][158] 双 INT 开关(宿主面板「画幅联动开关」默认 false=恒九型)择一
      驱动 [5];开联动会把 PE 组拉入执行(Note 载明)。
    - PE 架构/接线/默认参数/排布顺序/②③层禁句口径等其余吸收条目=不改本件
      接线,落 05 库与 research 文档(见 docs/prompts/Qwen-Image-2.1/06-视频提示词
      精要.md 吸收账)。

子图结构(宿主 [40],双击进入;行式从上到下=阶段行、行内从左到右,design §12):
  inputs(8): clip/vae/pe_clip(外连 [2][3][11])+ 主体句(外连 [24])+ 型选择
    (COMBO widget)+ PE改写开关 + RGBA透明开关 + 画幅联动开关(BOOLEAN widget)。
  outputs(5): positive/negative(→[7] KSampler)、prompt(STRING→[27] 装配预览,
    仿 K2 [90].applied→[86])、width/height(INT→[5] 空潜)。
  行1 y=0    源行:[150] MyQi21DaojieBase(九选一)+[110] 锁层A+[160][161] RGBA
             官方头尾常量+[140] PE 改写(自带种子句 widget)
  行2 y=560  装配路由:[130] 拼接①(主体句+BASE)→[131] 拼接②(+锁层A)→
             [162][163] RGBA 公式拼接(头+装配全文+尾)→[141] 提示词开关
  行3 y=1060 画幅联动:[151][152] 正则取宽高比→[153][154] 转数→[155][156]
             公式求宽高→[157][158] 双 INT 开关(默认走 [150] 九型 W/H)
  行4 y=1560 编码输出:[143] RGBA编码→[142] 主编码→[144] RGBA开关(09-24 整治
             改序:与行2 尾段 [163]→[141] 同序,两条长降线平行不互交)
  group 三阶段+画幅联动共 4 框,全 int id 互异,各框单一阶段行边到边罩满(≤4)。
  09-24 布局整治:W/H·pe_clip·画幅联动开关长驱线走顶部 Reroute 通道(y=-200/
  -160/-120/-80 分层互不相交);clip 自行4 槽位高度带上方平入,vae/RGBA开关 IO
  落行4 下缘带自下而入;
  主图 UNET/VAE 两长横穿走上顶缘通道;Reroute 序列化=K2-角色设定-道劫.json 样板。

自查(写盘后必跑,任一失败退出码 1):json.loads 往返 / 主图+子图 link 双向一致 /
主图+子图横向排版(每条连线 target.x>origin.x,含 Reroute 段;边界线以 IO 槽 pos 为
端点)/ 子图四行排版(按 y 分行恰 4 行=四阶段、Reroute 拐点不占行、行间净距≥100、
行内 x 严格递增;group 各框单一阶段行全部节点)/ 主图+子图节点零重叠 / group 预算
(子图≤4、主图≤3)/
主图+子图 group 全 int id / 子图 IO linkIds 逐项登记(契约铁律)/ 道劫字号 /
MyQi21DaojieBase 在场+combo 默认人物+qi21_bases.json↔05 库逐字互锁 / 锁层A 恒挂
且逐字=库 / 级联退役(子图开关恰 4 枚=提示词/RGBA/宽高双联)/ 干跑默认装配
逐字=库人物型组合 / PE·RGBA 承袭参数与默认旁路 / RGBA 官方头尾逐字 / steps=40 /
无孤儿节点(MarkdownNote 与 easy showAnything 显示型端点豁免)/ 说明 Note 必含要点。

不动 K2 侧任何文件;引擎家 userdata 零写入;不 git。重跑幂等:主体句默认与
锁层A 全文从 05 库文档现读,BASE 真源=qi21_bases.json(mtime 热读在引擎侧运行时
生效),库更新后重跑即同步(与契约测试 test_qwen21_workflow_contract.py 互锁)。
真前端 graphToPrompt 干跑与实弹出图由 e2e 层另行验证(引擎 v0.37 真前端直开
为最终裁判)。

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
# ④配色行映射(库 §一映射表)
COLOR_MAP = {
    "人物": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "场景": "场景青绿=宣纸白+淡墨+石绿+石青+赭石",
    "道具": "道具旧金=宣纸白+浓墨+旧金+暗玉青",
    "美宣": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "三视图": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "高清人脸": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "分镜剧情图": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "表情差分": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "概念气氛图": "场景青绿=宣纸白+淡墨+石绿+石青+赭石",
}
PE_CLIP_FILE = "qwen_image_2.1_pe_t2i_bf16.safetensors".replace("qwen_image", "qwen3.5_9b_qwen_image")
PE_PARAMS = [1.0, 0.95, 20, 1.5, 16256, 42]
PE_SEED_PROMPT = "水墨国风修仙:一位修士立于云中山巅,渡劫前夜,大面积留白,一小块朱砂点题色"
DEFAULT_TYPE = "人物"

# RGBA 官方公式头尾(research/12 答A必改1;逐字对齐官方模板原文——旧版
# 『an RGBA format image/a transparent background』两处微差就此正字;中文版
# 为官方同款同步记录,画布接线用英文原版)
RGBA_HEAD_EN = "This is an RGBA image with transparency."
RGBA_TAIL_EN = "The image has alpha channel and the background is transparent."
RGBA_HEAD_ZH = "这是一张带有透明度的RGBA图像。"
RGBA_TAIL_ZH = "该图像具有alpha通道,背景是透明的。"

# 画幅联动:PE 建议 wh_ratio(如 "16:9")→ 4.2MP 档宽高(口径=native_px:
# MP 按 1024² 计、边长取整 8 的倍数,与 MyQi21DaojieBase/ResolutionSelector 同式)
RATIO_W_PATTERN = r"^\s*(\d+)"
RATIO_H_PATTERN = r":\s*(\d+)\s*$"
MATH_W_EXPR = "round(a*sqrt(4.2*1024*1024/(a*b))/8)*8"
MATH_H_EXPR = "round(b*sqrt(4.2*1024*1024/(a*b))/8)*8"

# 子图内部节点 id(独立 id 空间,仿 K2 [90] 内部 101+)
BASE_ID = 150                                              # MyQi21DaojieBase 九选一
LOCK_ID = 110                                              # 通用锁层常量A
RGBA_HEAD_ID, RGBA_TAIL_ID = 160, 161                      # RGBA 官方头/尾常量(EN)
CONCAT1_ID, CONCAT2_ID = 130, 131                          # 装配拼接①②
RGBA_CAT1_ID, RGBA_CAT2_ID = 162, 163                      # RGBA 公式拼接(头+全文 / +尾)
PE_RW_ID, PE_SW_ID = 140, 141                              # PE 改写/提示词开关
TE_ID, TE_RGBA_ID, RGBA_SW_ID = 142, 143, 144              # 主编码/RGBA 编码/RGBA 开关
RATIO_RW_ID, RATIO_RH_ID = 151, 152                        # 正则取宽/高比
CONV_RW_ID, CONV_RH_ID = 153, 154                          # 字串→数
MATH_W_ID, MATH_H_ID = 155, 156                            # 公式求宽/高
SW_W_ID, SW_H_ID = 157, 158                               # 宽/高联动开关(INT)
# 布局整治 Reroute 节点(09-24;序列化样板=K2-角色设定-道劫.json 顶层级)
RR_PE_ID = 170                                             # pe_clip 顶通道(y=-160)
RR_W_A_ID, RR_W_B_ID = 171, 172                            # WIDTH 通道(升/顶横 y=-80)
RR_H_A_ID, RR_H_B_ID = 173, 174                            # HEIGHT 通道(升/顶横 y=-120)
RR_SW10_ID = 175                                           # 画幅开关→[157](最顶 y=-200 通道,单拐点)
RR_SW11_ID = 176                                           # 画幅开关→[158](最顶 y=-200 通道,单拐点)
HOST_ID = 40                                               # 主图子图宿主
SUBJECT_ID, PREVIEW_ID = 24, 27                            # 主图外露主体句/装配预览
LATENT_ID, SAMPLER_ID = 5, 7                               # 主图空潜/KSampler
# 主图通道 Reroute(09-24 整治:UNET→KSampler 与 VAE→VAEDecode 两长横穿上顶缘通道)
RR_M8A_ID, RR_M8B_ID = 20, 21                              # link8 通道(y=-620)
RR_M10A_ID, RR_M10B_ID = 22, 23                            # link10 通道(y=-560)

# 宿主 widget 型子图输入(槽序=inputs 数组序;widgets_values 按此序)
WIDGET_INPUTS = [
    ("主体句", "STRING"), ("型选择", "COMBO"),
    ("PE改写开关", "BOOLEAN"), ("RGBA透明开关", "BOOLEAN"), ("画幅联动开关", "BOOLEAN"),
]
LINK_INPUTS = [("clip", "CLIP"), ("vae", "VAE"), ("pe_clip", "CLIP")]  # 槽 0-2

NOTE_TEXT = (
    "## 道劫 · Qwen-Image-2.1 文生图(装配子图版·九型底座 09-23 美化·MyQi21DaojieBase 总装轮)\n\n"
    "K2 道劫『一处选型+分件装配+子图收装』思想的 Q2-1 原生落地:**[40] 装配子图**(双击进入=底座九选一节点+"
    "锁层恒挂+换行拼接+RGBA 公式拼接+PE 改写+画幅联动+双路编码);提示词真源=docs/prompts/Qwen-Image-2.1/"
    "05-道劫规范提示词库.md(②层底座=09-23 美化版,《三国望神州》v2.2+手册词汇成文,纯画法零物象骨与每型锁质"
    "要点逐项保留;canon-json 逐字锚废止,型名/顺序仍对齐 daojie_bases.json)。\n\n"
    "### 怎么换型(一处切换)\n"
    "- 主画布点选 [40] 装配子图,面板「型选择」下拉九选一(默认①人物):人物/场景/道具/美宣/三视图/高清人脸/"
    "分镜剧情图/表情差分/概念气氛图——子图内 MyQi21DaojieBase 节点按选型出 BASE(该型②层底座+人物系增量四锁B"
    "+④配色行,真源=qi21_bases.json 磁盘热读,逐字=05 库)与 WIDTH/HEIGHT(型档分辨率直出)。\n"
    "- **分辨率随型自动**:[40] 子图 width/height 输出直驱 [5] 空潜宽高(ResolutionSelector 已退役;九型档="
    "qi21_bases.json 的 aspect/MP/override,三视图 3072×1024 直出)——换型不再手动切档。\n"
    "- 换型后 [24] 主体句须同步换成本型主体句(各型例句见库文档;场景/概念气氛图不写人——空镜句尾可明写"
    "「空镜无人」);主体句只写主体与画面,不重复风格词,全角标点,质量词/比例词/否定式禁入(库文档主体句纪律五则)。\n"
    "- 警示(手贴 vs 重跑):手贴内容只活在画布件——生成脚本重跑会把主体句默认/锁层全文重置回库文档现读值"
    "(底座 BASE 不经画布常量、直读 qi21_bases.json,库更新重跑提取脚本即同步),要长久保留先回写库文档再重跑,"
    "或重跑前另存画布件。\n\n"
    "### 装配怎么拼([24] 唯一手写位;细节双击 [40] 看)\n"
    "- 拼法=库文档四层装配『主体句领头+换行分层』:子图内拼接把 [24] 主体句 + [150] 当前型 BASE + [110] 通用锁层"
    "常量A(③层,库首节全文,全九型恒挂不随型)逐层接成一段进编码,再经提示词开关进 [142] 主编码。\n"
    "- 层次序注:画布装配行序=①主体句→②型底座→(人物系增量锁)→④配色行→③通用锁层;库文档直写件行序=①②③"
    "(内嵌增量锁)④——层内容零差异,仅行序不同(锁层常量恒挂不可拆,增量锁随型走在 BASE 内)。\n"
    "- 跑图前过目 [27] 装配预览(接子图 prompt 输出):显示将进编码的最终文本,确认再跑。\n"
    "- 甲案围栏:本链为甲案全中文直书(中文合法);与 PE/乙案英文长文禁混——[40] 面板「PE改写开关」开=走 PE 改写路"
    "(中文种子句进、英文长文出),与本链二选一(库文档禁混条款一)。\n\n"
    "### PE 与 RGBA 何时开(开关都在 [40] 面板,默认全关=直写/普通)\n"
    "- PE改写开关:关=直写(默认,上面的装配链);开=PE 扩写(短句种子→官方宪法英文长文,懒执行——旁路时 PE 模型"
    "不加载);PE 参数=插件官方 README 推荐值(temp1.0/topP0.95/topK20/presence1.5/max16256),与视频侧官方模板值"
    "的分歧行 A/B 对拍后再定(见 06-视频提示词精要.md 吸收账)。\n"
    "- RGBA透明开关:关=普通(默认);开=透明底——**官方公式**:This is an RGBA image with transparency. "
    "[装配全文,与 [27] 同源]. The image has alpha channel and the background is transparent.(头尾逐字=官方原文,"
    "子图 [160][161][162][163] 现拼;中文同款:这是一张带有透明度的RGBA图像。……该图像具有alpha通道,背景是"
    "透明的。)透明路出图必须存 PNG 才保 alpha。\n"
    "- 画幅联动开关(默认关):开=[140] PE 建议画幅 wh_ratio 经正则/转数/公式接管 [5] 宽高(4.2MP 档);恒九型仍是"
    "业务默认,故默认关;开联动会把 PE 组拉入执行(PE 改写开关同开才有意义),PE 未给建议画幅时该路报错——"
    "常规出图保持关闭。\n"
    "- 起草/改写提示词唤取技能 qwen-image-2-1-prompter。\n\n"
    "### 参数圣经\n"
    "- cfg 恒 1(负向不生效,负向槽留空);**步数 40(官方完整档;官方区间 40-50,起手即完整态)**;"
    "分辨率走 [40] 子图随型直驱(宽高恒 8 倍数);seed 在 [7] KSampler(默认 fixed=0 可复现);风格终审=用户。\n"
    "- 生成脚本=apps/build/scripts/qi21_daojie_t2i_0923.py(幂等;主体句默认/锁层全文从库文档现读,"
    "BASE 真源=qi21_bases.json,重跑即同步)。\n"
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
        "id": nid, "type": "StringConstant", "title": f"道劫·{title}",
        "pos": pos, "size": size, "flags": {}, "order": 0, "mode": 0,
        "inputs": [],
        "outputs": [{"name": "STRING", "type": "STRING", "links": links}],
        "properties": {"Node name for S&R": "StringConstant"},
        "widgets_values": [text],
    }


def _switch(nid: int, title: str, false_link: int, true_link: int, switch_link: int,
            out_links: list[int], pos: list, typ: str = "STRING") -> dict:
    """子图内开关:switch 槽为 widget 转输入(接 -10 边界,值由宿主面板 widget 供)。"""
    return {
        "id": nid, "type": "ComfySwitchNode", "title": f"道劫·{title}",
        "pos": pos, "size": [380, 120], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "on_false", "shape": 7, "type": typ, "link": false_link},
            {"name": "on_true", "shape": 7, "type": typ, "link": true_link},
            {"name": "switch", "type": "BOOLEAN", "widget": {"name": "switch"}, "link": switch_link},
        ],
        "outputs": [{"name": "output", "type": typ, "links": out_links}],
        "properties": {"Node name for S&R": "ComfySwitchNode"},
        "widgets_values": [False],
    }


def _concatenate(nid: int, title: str, a_link: int, b_link: int, out_links: list[int], pos: list,
                 delimiter: str = "\n") -> dict:
    return {
        "id": nid, "type": "StringConcatenate", "title": f"道劫·{title}",
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


def _reroute(nid: int, pos: list, in_link: int, out_link: int, typ: str) -> dict:
    """Reroute 通道拐点(序列化逐字段=K2-角色设定-道劫.json 顶层级实取样板)。"""
    return {
        "id": nid, "type": "Reroute", "pos": pos, "size": [75, 26],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "", "type": "*", "link": in_link}],
        "outputs": [{"name": "", "type": typ, "links": [out_link]}],
        "properties": {"showOutputText": False, "horizontal": False},
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


# ── 子图构建 ────────────────────────────────────────────────────────
def _internal_link(lid: int, oid: int, oslot: int, tid: int, tslot: int, typ: str) -> dict:
    return {"id": lid, "origin_id": oid, "origin_slot": oslot,
            "target_id": tid, "target_slot": tslot, "type": typ}


def build_subgraph(truth: dict) -> tuple[dict, list[dict]]:
    """返回 (subgraph 定义, 内部 link 对象表)。"""
    # 布局(design §12:从上到下=阶段行、行内从左到右;三阶段+画幅联动 4 框全 int id):
    #   行1 y=0    源行:[150] 底座九选一/[110] 锁层A/[160][161] RGBA 头尾/[140] PE 改写
    #   行2 y=560  装配路由:[130] 拼接①→[131] 拼接②→[162][163] RGBA 公式拼接→[141] 开关
    #   行3 y=1060 画幅联动:[151][152] 正则→[153][154] 转数→[155][156] 公式→[157][158] 双开关
    #   行4 y=1560 编码输出:[143] RGBA 编码→[142] 主编码→[144] RGBA 开关(与行2 尾段同序)
    # 行距=上行最高节点底+≥100;行内节点零重叠;每条连线 target.x>origin.x(全局含跨行
    # 与 Reroute 通道段);长驱线通道分层 y=-200/-160/-120/-80 互不相交。
    ROW_Y = (0, 560, 1060, 1560)

    # 布局整治(09-24):长驱线走 Reroute 通道(序列化=K2-角色设定-道劫.json 顶层级样板,
    # size[75,26]/inputs type "*"//outputs 具型,可进子图,对象格式 link 以 reroute id 记账):
    #   pe_clip IO→RR_pe(顶部 y=-160 通道)→[140].clip;
    #   [150].W/H→RRa(升)→RRb(顶横 y=-80/-120,分层不互交)→[157]/[158].on_false;
    #   画幅联动开关 IO→RR10/RR11(最顶 y=-200 通道)→[157]/[158].switch。
    # 原 link id 留给边界侧/落点侧段(5/10/11 恒为 -10 出线,38/39 恒为入 [157]/[158] 段)。
    links: list[dict] = []
    # -10 扇出(边界线 id 1-11;5/10/11 的 -10 段直连各自通道首 Reroute)
    links.append(_internal_link(1, -10, 0, TE_ID, 0, "CLIP"))            # clip → 主编码
    links.append(_internal_link(2, -10, 0, TE_RGBA_ID, 0, "CLIP"))       # clip → RGBA 编码
    links.append(_internal_link(3, -10, 1, TE_ID, 2, "VAE"))             # vae → 主编码
    links.append(_internal_link(4, -10, 1, TE_RGBA_ID, 2, "VAE"))        # vae → RGBA 编码
    links.append(_internal_link(5, -10, 2, RR_PE_ID, 0, "CLIP"))         # pe_clip → RR_pe(顶通道)
    links.append(_internal_link(45, RR_PE_ID, 0, PE_RW_ID, 0, "CLIP"))   # RR_pe → PE 改写
    links.append(_internal_link(6, -10, 3, CONCAT1_ID, 0, "STRING"))     # 主体句 → 拼接①.string_a
    links.append(_internal_link(7, -10, 4, BASE_ID, 0, "COMBO"))         # 型选择 → MyQi21DaojieBase.base
    links.append(_internal_link(8, -10, 5, PE_SW_ID, 2, "BOOLEAN"))      # PE改写开关 → [141].switch
    links.append(_internal_link(9, -10, 6, RGBA_SW_ID, 2, "BOOLEAN"))    # RGBA透明开关 → [144].switch
    links.append(_internal_link(10, -10, 7, RR_SW10_ID, 0, "BOOLEAN"))  # 画幅联动开关 → RR10(顶通道)
    links.append(_internal_link(50, RR_SW10_ID, 0, SW_W_ID, 2, "BOOLEAN"))    # → [157].switch
    links.append(_internal_link(11, -10, 7, RR_SW11_ID, 0, "BOOLEAN"))  # 画幅联动开关 → RR11(顶通道)
    links.append(_internal_link(51, RR_SW11_ID, 0, SW_H_ID, 2, "BOOLEAN"))    # → [158].switch
    # 装配链(12-17)
    links.append(_internal_link(12, BASE_ID, 0, CONCAT1_ID, 1, "STRING"))   # BASE → 拼接①.string_b
    links.append(_internal_link(13, LOCK_ID, 0, CONCAT2_ID, 1, "STRING"))   # 锁层A 恒挂 → 拼接②
    links.append(_internal_link(14, CONCAT1_ID, 0, CONCAT2_ID, 0, "STRING"))
    links.append(_internal_link(15, CONCAT2_ID, 0, PE_SW_ID, 0, "STRING"))  # 装配全文 → 开关.on_false
    links.append(_internal_link(16, PE_RW_ID, 0, PE_SW_ID, 1, "STRING"))    # PE 改写 → 开关.on_true
    links.append(_internal_link(17, PE_SW_ID, 0, TE_ID, 3, "STRING"))       # 开关 → 主编码.prompt
    # 编码与 RGBA 开关(18-22)
    links.append(_internal_link(18, TE_ID, 0, RGBA_SW_ID, 0, "CONDITIONING"))
    links.append(_internal_link(19, TE_RGBA_ID, 0, RGBA_SW_ID, 1, "CONDITIONING"))
    links.append(_internal_link(20, RGBA_SW_ID, 0, -20, 0, "CONDITIONING"))   # → 输出 positive
    links.append(_internal_link(21, TE_ID, 1, -20, 1, "CONDITIONING"))        # 主编码.negative → 输出
    links.append(_internal_link(22, PE_SW_ID, 0, -20, 2, "STRING"))           # 装配文本 → 输出 prompt
    # RGBA 官方公式拼接(23-27;research/12 答A必改1:头句+装配全文+尾句)
    links.append(_internal_link(23, RGBA_HEAD_ID, 0, RGBA_CAT1_ID, 0, "STRING"))
    links.append(_internal_link(24, CONCAT2_ID, 0, RGBA_CAT1_ID, 1, "STRING"))  # 装配全文([27] 同源)
    links.append(_internal_link(25, RGBA_CAT1_ID, 0, RGBA_CAT2_ID, 0, "STRING"))
    links.append(_internal_link(26, RGBA_TAIL_ID, 0, RGBA_CAT2_ID, 1, "STRING"))
    links.append(_internal_link(27, RGBA_CAT2_ID, 0, TE_RGBA_ID, 3, "STRING"))  # → RGBA 编码.prompt
    # 画幅联动(28-41;wh_ratio→宽高,默认关=九型 W/H 直驱)
    links.append(_internal_link(28, PE_RW_ID, 2, RATIO_RW_ID, 0, "STRING"))    # wh_ratio → 正则宽
    links.append(_internal_link(29, PE_RW_ID, 2, RATIO_RH_ID, 0, "STRING"))    # wh_ratio → 正则高
    links.append(_internal_link(30, RATIO_RW_ID, 0, CONV_RW_ID, 0, "STRING"))
    links.append(_internal_link(31, RATIO_RH_ID, 0, CONV_RH_ID, 0, "STRING"))
    links.append(_internal_link(32, CONV_RW_ID, 1, MATH_W_ID, 0, "INT"))       # INT 槽 → 公式.a
    links.append(_internal_link(33, CONV_RH_ID, 1, MATH_W_ID, 1, "INT"))       # → 公式.b
    links.append(_internal_link(34, CONV_RW_ID, 1, MATH_H_ID, 0, "INT"))
    links.append(_internal_link(35, CONV_RH_ID, 1, MATH_H_ID, 1, "INT"))
    links.append(_internal_link(36, MATH_W_ID, 1, SW_W_ID, 1, "INT"))          # 公式宽 → on_true
    links.append(_internal_link(37, MATH_H_ID, 1, SW_H_ID, 1, "INT"))
    # 九型 WIDTH/HEIGHT → 顶部通道(每线两拐点:升→顶横→降,全程右向)→ on_false
    links.append(_internal_link(46, BASE_ID, 1, RR_W_A_ID, 0, "INT"))
    links.append(_internal_link(47, RR_W_A_ID, 0, RR_W_B_ID, 0, "INT"))
    links.append(_internal_link(38, RR_W_B_ID, 0, SW_W_ID, 0, "INT"))
    links.append(_internal_link(48, BASE_ID, 2, RR_H_A_ID, 0, "INT"))
    links.append(_internal_link(49, RR_H_A_ID, 0, RR_H_B_ID, 0, "INT"))
    links.append(_internal_link(39, RR_H_B_ID, 0, SW_H_ID, 0, "INT"))
    links.append(_internal_link(40, SW_W_ID, 0, -20, 3, "INT"))                # → 输出 width
    links.append(_internal_link(41, SW_H_ID, 0, -20, 4, "INT"))                # → 输出 height
    assert sorted(l["id"] for l in links) == list(range(1, 42)) + list(range(45, 52))

    nodes: list[dict] = []
    # 行1 源行
    nodes.append({
        "id": BASE_ID, "type": "MyQi21DaojieBase",
        "title": "道劫·底座九选一(MyQi21DaojieBase:BASE=②+B+④ 逐字=05库/宽高随型直出/磁盘热读)",
        "pos": [40, ROW_Y[0]], "size": [420, 200], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "base", "type": "COMBO", "widget": {"name": "base"}, "link": 7},
        ],
        "outputs": [
            {"name": "BASE", "type": "STRING", "links": [12]},
            {"name": "WIDTH", "type": "INT", "links": [46]},
            {"name": "HEIGHT", "type": "INT", "links": [48]},
            {"name": "型名", "type": "STRING", "links": None},
        ],
        "properties": {"Node name for S&R": "MyQi21DaojieBase"},
        "widgets_values": [DEFAULT_TYPE],
    })
    nodes.append(_string_constant(
        LOCK_ID, "通用锁层常量A(③层·库首节全文·全九型恒挂)",
        truth["const_a"], [520, ROW_Y[0]], [13], [440, 400]))
    nodes.append(_string_constant(
        RGBA_HEAD_ID, "RGBA官方头句(EN·逐字=官方模板)", RGBA_HEAD_EN,
        [1040, ROW_Y[0]], [23], [380, 120]))
    nodes.append(_string_constant(
        RGBA_TAIL_ID, "RGBA官方尾句(EN·逐字=官方模板)", RGBA_TAIL_EN,
        [1460, ROW_Y[0]], [26], [380, 120]))
    nodes.append({
        "id": PE_RW_ID, "type": "QwenImage21_T2IPromptRewrite",
        "title": "道劫·PE改写(短句→英文长文,默认旁路;参数=插件官方 README 推荐值)",
        "pos": [1880, ROW_Y[0]], "size": [440, 340], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "clip", "type": "CLIP", "link": 45},
            {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": None},
            {"name": "temperature", "type": "FLOAT", "widget": {"name": "temperature"}, "link": None},
            {"name": "top_p", "type": "FLOAT", "widget": {"name": "top_p"}, "link": None},
            {"name": "top_k", "type": "INT", "widget": {"name": "top_k"}, "link": None},
            {"name": "presence_penalty", "type": "FLOAT", "widget": {"name": "presence_penalty"}, "link": None},
            {"name": "max_new_tokens", "type": "INT", "widget": {"name": "max_new_tokens"}, "link": None},
            {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": None},
        ],
        "outputs": [
            {"name": "positive_prompt", "type": "STRING", "links": [16]},
            {"name": "negative_prompt", "type": "STRING", "links": None},
            {"name": "wh_ratio", "type": "STRING", "links": [28, 29]},
            {"name": "thinking", "type": "STRING", "links": None},
            {"name": "parse_ok", "type": "BOOLEAN", "links": None},
        ],
        "properties": {"Node name for S&R": "QwenImage21_T2IPromptRewrite"},
        "widgets_values": [PE_SEED_PROMPT, *PE_PARAMS],
    })

    # 行2 装配路由(09-24 整治:与行1 源行一一对齐改序,[163]收拢到1880 使 [141] 紧随其后,
    # PE改写开关水平线不再被 [163]→[143] 下降线截断)
    nodes.append(_concatenate(
        CONCAT1_ID, "装配拼接①(主体句+BASE;delimiter=\\n)", 6, 12, [14], [100, ROW_Y[1]]))
    nodes.append(_concatenate(
        CONCAT2_ID, "装配拼接②(+通用锁层恒挂;delimiter=\\n)", 14, 13, [15, 24], [560, ROW_Y[1]]))
    nodes.append(_concatenate(
        RGBA_CAT1_ID, "RGBA公式拼接①(官方头句+装配全文;delimiter=空格)", 23, 24, [25],
        [1440, ROW_Y[1]], delimiter=" "))
    nodes.append(_concatenate(
        RGBA_CAT2_ID, "RGBA公式拼接②(+官方尾句;delimiter=空格)", 25, 26, [27],
        [1880, ROW_Y[1]], delimiter=" "))
    nodes.append(_switch(
        PE_SW_ID, "提示词开关(false=直写装配 / true=PE扩写)", 15, 16, 8, [17, 22], [2280, ROW_Y[1]]))

    # 行3 画幅联动(默认关;序列化口径=官方 blueprint RegexExtract/ComfyNumberConvert/
    # ComfyMathExpression 实证:正则 7 槽全 widget、转数单槽无 widget、公式 values.a/b+expression)
    def _regex(nid: int, title: str, pattern: str, in_link: int, out_link: int, pos: list) -> dict:
        return {
            "id": nid, "type": "RegexExtract", "title": f"道劫·{title}",
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
            "id": nid, "type": "ComfyNumberConvert", "title": f"道劫·{title}",
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
            "id": nid, "type": "ComfyMathExpression", "title": f"道劫·{title}",
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

    # 行3 画幅联动(09-24 整治:整行右移到 [141]→[142] 长降线右侧,wh 两线恒在其上方平行不互交)
    nodes.append(_regex(RATIO_RW_ID, "PE建议画幅·取宽比(如 16:9→16)", RATIO_W_PATTERN, 28, 30,
                        [4000, ROW_Y[2]]))
    nodes.append(_regex(RATIO_RH_ID, "PE建议画幅·取高比(如 16:9→9)", RATIO_H_PATTERN, 29, 31,
                        [4380, ROW_Y[2]]))
    nodes.append(_convert(CONV_RW_ID, "宽比转数", 30, [32, 34], [4760, ROW_Y[2]]))
    # [154] 高比转数:出两线(→[155].b 与 →[156].b)
    nodes.append(_convert(CONV_RH_ID, "高比转数", 31, [33, 35], [5040, ROW_Y[2]]))
    nodes.append(_math(MATH_W_ID, "PE建议宽(4.2MP·8倍数取整)", MATH_W_EXPR, 32, 33, 36,
                       [5320, ROW_Y[2]]))
    nodes.append(_math(MATH_H_ID, "PE建议高(4.2MP·8倍数取整)", MATH_H_EXPR, 34, 35, 37,
                       [5730, ROW_Y[2]]))
    nodes.append(_switch(SW_W_ID, "宽联动开关(false=九型WIDTH / true=PE建议宽)", 38, 36, 50, [40],
                         [6080, ROW_Y[2]], typ="INT"))
    nodes.append(_switch(SW_H_ID, "高联动开关(false=九型HEIGHT / true=PE建议高)", 39, 37, 51, [41],
                         [6500, ROW_Y[2]], typ="INT"))

    # 行4 编码输出
    def _textencode(nid: int, title: str, pos: list, clip_l: int, vae_l: int,
                    prompt_link, prompt_text: str, pos_links) -> dict:
        return {
            "id": nid, "type": "TextEncodeQwenImage21", "title": f"道劫·{title}",
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
                    [21] if nid == TE_ID else None)},
                {"name": "latent", "type": "LATENT", "links": None},
            ],
            "properties": {"Node name for S&R": "TextEncodeQwenImage21"},
            "widgets_values": [prompt_text, "", 1024],
        }

    # 行4 编码输出(09-24 整治:改序 [143]→[142]→[144],与行2 尾段([163]→[141])同序,
    # 两条长下降线 [163]→[143]/[141]→[142] 平行不换位互交归零)
    nodes.append(_textencode(TE_RGBA_ID, "RGBA编码(官方公式拼接路,默认旁路)",
                             [3800, ROW_Y[3]], 2, 4, 27, "", [19]))
    nodes.append(_textencode(TE_ID, "主编码(prompt 接提示词开关)", [4300, ROW_Y[3]], 1, 3, 17, "", [18]))
    nodes.append(_switch(
        RGBA_SW_ID, "RGBA开关(false=普通 / true=透明,透明图存PNG)", 18, 19, 9, [20],
        [4780, ROW_Y[3]], typ="CONDITIONING"))

    # 通道 Reroute 拐点(09-24 整治:坐标全部代码算,通道分层 y=-200/-160/-120/-80 互不相交;
    # 拐点 x 避让各通道水平段端点,降线不穿他通道)
    nodes.append(_reroute(RR_PE_ID, [350, -160], 5, 45, "CLIP"))
    nodes.append(_reroute(RR_W_A_ID, [1050, -80], 46, 47, "INT"))
    nodes.append(_reroute(RR_W_B_ID, [3900, -80], 47, 38, "INT"))
    nodes.append(_reroute(RR_H_A_ID, [800, -120], 48, 49, "INT"))
    nodes.append(_reroute(RR_H_B_ID, [4550, -120], 49, 39, "INT"))
    nodes.append(_reroute(RR_SW10_ID, [4450, -200], 10, 50, "BOOLEAN"))
    nodes.append(_reroute(RR_SW11_ID, [5900, -200], 11, 51, "BOOLEAN"))

    for order, n in enumerate(nodes):
        n["order"] = order

    # 内部分组(09-24 整治:三阶段+画幅联动共 4 框,全 int id 互异,各框单一阶段行边到边罩满;
    # 通道 Reroute 拐点留框间带,不入框)
    groups: list[dict] = [
        {
            "id": 1, "title": "道劫·底座装配(行1 源行:九选一底座+锁层A恒挂+RGBA官方头尾+PE改写默认旁路)",
            "bounding": [0, -40, 2380, 500], "color": "#3f789e", "flags": {},
        },
        {
            "id": 2, "title": "道劫·PE 路由(行2:拼接①② delimiter=\\n 分层;RGBA 公式拼接;提示词开关 false=直写)",
            "bounding": [60, 520, 2660, 280], "color": "#a1309b", "flags": {},
        },
        {
            "id": 3, "title": "道劫·画幅联动(行3:默认关=九型宽高直驱;开=wh_ratio 建议 4.2MP 接管,PE 组随之拉入执行)",
            "bounding": [3960, 1020, 2980, 300], "color": "#4d9e6a", "flags": {},
        },
        {
            "id": 4, "title": "道劫·编码输出(行4:主编码+RGBA编码(官方公式路,默认旁路)+RGBA开关)",
            "bounding": [3760, 1520, 1450, 400], "color": "#886", "flags": {},
        },
    ]

    # 子图 IO(inputs 槽序=宿主 inputs 序;widget 型输入 linkIds 同样逐项登记=契约铁律)
    _IO_IDS = [
        "a1e2c3d4-0001-4a01-9e01-7d4a9c31a001",  # in-0 clip
        "a1e2c3d4-0002-4a02-9e02-7d4a9c31a002",  # in-1 vae
        "a1e2c3d4-0003-4a03-9e03-7d4a9c31a003",  # in-2 pe_clip
        "a1e2c3d4-0004-4a04-9e04-7d4a9c31a004",  # in-3 主体句
        "a1e2c3d4-0005-4a05-9e05-7d4a9c31a005",  # in-4 型选择(COMBO)
        "a1e2c3d4-0006-4a06-9e06-7d4a9c31a006",  # in-5 PE改写开关
        "a1e2c3d4-0007-4a07-9e07-7d4a9c31a007",  # in-6 RGBA透明开关
        "a1e2c3d4-0008-4a08-9e08-7d4a9c31a008",  # in-7 画幅联动开关
        "b2f3a4c5-0001-4b01-8f01-3c5f81b56b01",  # out-0 positive
        "b2f3a4c5-0002-4b02-8f02-3c5f81b56b02",  # out-1 negative
        "b2f3a4c5-0003-4b03-8f03-3c5f81b56b03",  # out-2 prompt
        "b2f3a4c5-0004-4b04-8f04-3c5f81b56b04",  # out-3 width
        "b2f3a4c5-0005-4b05-8f05-3c5f81b56b05",  # out-4 height
    ]
    # IO 槽 pos(09-24 整治:pe_clip/画幅联动开关上顶通道口;clip 自行4 槽位高度带上方平入,
    # vae/RGBA开关 落行4 下缘带自下而入;左边界列 x=-196/右边界列按各出线行深分布)
    inputs = [
        {"id": _IO_IDS[0], "name": "clip", "type": "CLIP", "linkIds": [1, 2], "pos": [-196, 1560]},
        {"id": _IO_IDS[1], "name": "vae", "type": "VAE", "linkIds": [3, 4], "pos": [-196, 1950]},
        {"id": _IO_IDS[2], "name": "pe_clip", "type": "CLIP", "linkIds": [5], "pos": [-196, -160]},
        {"id": _IO_IDS[3], "name": "主体句", "type": "STRING", "linkIds": [6], "pos": [-196, 600]},
        {"id": _IO_IDS[4], "name": "型选择", "type": "COMBO", "linkIds": [7], "pos": [-196, 20]},
        {"id": _IO_IDS[5], "name": "PE改写开关", "type": "BOOLEAN", "linkIds": [8], "pos": [-196, 660]},
        {"id": _IO_IDS[6], "name": "RGBA透明开关", "type": "BOOLEAN", "linkIds": [9], "pos": [-196, 2000]},
        {"id": _IO_IDS[7], "name": "画幅联动开关", "type": "BOOLEAN", "linkIds": [10, 11], "pos": [-196, -200]},
    ]
    outputs = [
        {"id": _IO_IDS[8], "name": "positive", "type": "CONDITIONING", "linkIds": [20], "pos": [6900, 1580]},
        {"id": _IO_IDS[9], "name": "negative", "type": "CONDITIONING", "linkIds": [21], "pos": [6900, 1640]},
        {"id": _IO_IDS[10], "name": "prompt", "type": "STRING", "linkIds": [22], "pos": [2800, 620]},
        {"id": _IO_IDS[11], "name": "width", "type": "INT", "linkIds": [40], "pos": [6900, 1120]},
        {"id": _IO_IDS[12], "name": "height", "type": "INT", "linkIds": [41], "pos": [6900, 1140]},
    ]

    sg = {
        "id": SG_UUID,
        "version": 1,
        "state": {"lastGroupId": 4, "lastNodeId": 176, "lastLinkId": 51, "lastRerouteId": 7},
        "revision": 1,
        "config": {"defaultIOState": {}},
        "name": "[40] 道劫·装配子图(底座九选一+通用锁层+四层装配+PE/RGBA/画幅联动路由;双击进入)",
        "inputNode": {"id": -10, "bounding": [-320, -260, 160, 2340]},
        "outputNode": {"id": -20, "bounding": [2760, 560, 4200, 1200]},
        "inputs": inputs,
        "outputs": outputs,
        "widgets": [truth["types"][0]["subject"], DEFAULT_TYPE, False, False, False],
        "nodes": nodes,
        "groups": groups,
        "links": links,
        "extra": {"ue_links": [], "links_added_by_ue": []},
    }
    return sg, links


# ── 主图构建 ────────────────────────────────────────────────────────
def build_main(truth: dict, sg: dict) -> dict:
    g = {
        "id": WF_UUID, "version": 0.4, "revision": 0, "config": {}, "extra": {},
        "groups": [
            {"id": 1, "title": "道劫·加载器(bf16 三件套+PE 专属文本编码器)",
             "bounding": [-2040, -480, 1400, 560], "color": "#3f789e", "flags": {}},
            {"id": 2, "title": "道劫·主链(子图宽高直驱空潜→[40]装配子图→采样→解码→保存;seed 外露在 [7])",
             "bounding": [-760, -480, 2200, 600], "color": "#3f789e", "flags": {}},
            {"id": 3, "title": "道劫·装配外露([24] 主体句=①层唯一手写位;型选择/PE/RGBA/画幅联动开关在 [40] 子图面板;[27] 装配预览)",
             "bounding": [-1220, 160, 2600, 400], "color": "#a1309b", "flags": {}},
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
            "id": nid, "type": ntype, "title": f"[{nid}] 道劫·{title}",
            "pos": pos, "size": size, "flags": {}, "order": 0, "mode": 0,
            "inputs": inputs,
            "outputs": [{"name": {"UNETLoader": "MODEL", "CLIPLoader": "CLIP",
                                  "VAELoader": "VAE"}[ntype], "type":
                         {"UNETLoader": "MODEL", "CLIPLoader": "CLIP", "VAELoader": "VAE"}[ntype],
                         "links": out_links}],
            "properties": {"Node name for S&R": ntype},
            "widgets_values": wv,
        }

    nodes = [
        loader(1, "UNETLoader", "UNET加载", [-1980, -400], [340, 84], ["qwen_image_2.1_bf16.safetensors", "default"], [8],
               [{"name": "unet_name", "type": "COMBO", "widget": {"name": "unet_name"}, "link": None},
                {"name": "weight_dtype", "type": "COMBO", "widget": {"name": "weight_dtype"}, "link": None}]),
        loader(2, "CLIPLoader", "CLIP加载(qwen_image)", [-1560, -400], [360, 130],
               ["qwen3vl_8b_bf16.safetensors", "qwen_image", "default"], [12],
               [{"name": "clip_name", "type": "COMBO", "widget": {"name": "clip_name"}, "link": None},
                {"name": "type", "type": "COMBO", "widget": {"name": "type"}, "link": None},
                {"name": "device", "type": "COMBO", "shape": 7, "widget": {"name": "device"}, "link": None}]),
        loader(3, "VAELoader", "VAE加载", [-1140, -400], [340, 60],
               ["qwen_image_2.1_vae_bf16.safetensors"], [10, 13],
               [{"name": "vae_name", "type": "COMBO", "widget": {"name": "vae_name"}, "link": None}]),
        {
            "id": LATENT_ID, "type": "EmptyLatentImage",
            "title": "[5] 道劫·空潜空(宽高接 [40] 子图直驱·随型)",
            "pos": [-100, -400], "size": [330, 110], "flags": {}, "order": 4, "mode": 0,
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
            "title": "[7] 道劫·KSampler(40步·cfg1;seed 外露)",
            "pos": [300, -400], "size": [330, 260], "flags": {}, "order": 6, "mode": 0,
            "inputs": [
                {"name": "model", "type": "MODEL", "link": 20},
                {"name": "positive", "type": "CONDITIONING", "link": 16},
                {"name": "negative", "type": "CONDITIONING", "link": 17},
                {"name": "latent_image", "type": "LATENT", "link": 5},
            ],
            "outputs": [{"name": "LATENT", "type": "LATENT", "links": [9]}],
            "properties": {"Node name for S&R": "KSampler"},
            "widgets_values": [0, "fixed", 40, 1, "euler", "simple", 1],
        },
        {
            "id": 8, "type": "VAEDecode",
            "title": "[8] 道劫·VAE解码",
            "pos": [700, -400], "size": [240, 50], "flags": {}, "order": 7, "mode": 0,
            "inputs": [
                {"name": "samples", "type": "LATENT", "link": 9},
                {"name": "vae", "type": "VAE", "link": 22},
            ],
            "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [11]}],
            "properties": {"Node name for S&R": "VAEDecode"},
        },
        {
            "id": 9, "type": "SaveImage",
            "title": "[9] 道劫·保存",
            "pos": [1020, -400], "size": [380, 330], "flags": {}, "order": 8, "mode": 0,
            "inputs": [{"name": "images", "type": "IMAGE", "link": 11}],
            "outputs": [],
            "properties": {"Node name for S&R": "SaveImage"},
            "widgets_values": ["QI21道劫文生图_"],
        },
        {
            "id": 10, "type": "MarkdownNote",
            "title": "[10] 道劫·用法速查(装配子图版·MyQi21DaojieBase 总装轮)",
            "pos": [-1220, 620], "size": [900, 1500], "flags": {}, "order": 9, "mode": 0,
            "inputs": [], "outputs": [],
            "properties": {},
            "widgets_values": [NOTE_TEXT],
        },
        loader(11, "CLIPLoader", "PE文本编码加载(qwen_image)", [-1140, -160], [400, 130],
               [PE_CLIP_FILE, "qwen_image", "default"], [14],
               [{"name": "clip_name", "type": "COMBO", "widget": {"name": "clip_name"}, "link": None},
                {"name": "type", "type": "COMBO", "widget": {"name": "type"}, "link": None},
                {"name": "device", "type": "COMBO", "shape": 7, "widget": {"name": "device"}, "link": None}]),
        {
            "id": SUBJECT_ID, "type": "PrimitiveStringMultiline",
            "title": f"[{SUBJECT_ID}] 道劫·主体句(①层唯一手写位;默认=库人物型例一)",
            "pos": [-1180, 200], "size": [661, 200], "flags": {}, "order": 11, "mode": 0,
            "inputs": [],
            "outputs": [{"name": "STRING", "type": "STRING", "slot_index": 0, "links": [15]}],
            "properties": {"Node name for S&R": "PrimitiveStringMultiline"},
            "widgets_values": [types[0]["subject"]],
        },
        {
            "id": PREVIEW_ID, "type": "easy showAnything",
            "title": f"[{PREVIEW_ID}] 道劫·装配预览(接[40]prompt输出;跑图前过目将进编码的最终文本)",
            "pos": [880, 200], "size": [480, 230], "flags": {}, "order": 12, "mode": 0,
            "inputs": [{"label": "输入任何", "name": "anything", "shape": 7, "type": "*", "link": 18}],
            "outputs": [{"name": "output", "type": "*", "links": None}],
            "properties": {"Node name for S&R": "easy showAnything"},
            "widgets_values": [""],
        },
    ]

    # 宿主 [40](widget 型子图输入=宿主面板;序列化口径=K2 件 [90].base COMBO 实证
    # +blueprints 实证+K2 1.53 存档:宿主 inputs 带 widget 标记+widgets_values 按槽序)
    host_inputs = [
        {"name": "clip", "type": "CLIP", "link": 12},
        {"name": "vae", "type": "VAE", "link": 13},
        {"name": "pe_clip", "type": "CLIP", "link": 14},
        {"name": "主体句", "type": "STRING", "widget": {"name": "主体句"}, "link": 15},
        {"name": "型选择", "type": "COMBO", "widget": {"name": "型选择"}, "link": None},
        {"name": "PE改写开关", "type": "BOOLEAN", "widget": {"name": "PE改写开关"}, "link": None},
        {"name": "RGBA透明开关", "type": "BOOLEAN", "widget": {"name": "RGBA透明开关"}, "link": None},
        {"name": "画幅联动开关", "type": "BOOLEAN", "widget": {"name": "画幅联动开关"}, "link": None},
    ]
    host = {
        "id": HOST_ID, "type": SG_UUID,
        "title": f"[{HOST_ID}] 道劫·装配子图(双击=底座九选一+锁层恒挂+四层装配+PE/RGBA/画幅联动;面板=型选择/三开关)",
        "pos": [-700, -400], "size": [560, 480], "flags": {}, "order": 13, "mode": 0,
        "inputs": host_inputs,
        "outputs": [
            {"name": "positive", "type": "CONDITIONING", "links": [16]},
            {"name": "negative", "type": "CONDITIONING", "links": [17]},
            {"name": "prompt", "type": "STRING", "links": [18]},
            {"name": "width", "type": "INT", "links": [1]},
            {"name": "height", "type": "INT", "links": [2]},
        ],
        "properties": {"subgraph": SG_UUID, "previewExposures": []},
        "widgets_values": [types[0]["subject"], DEFAULT_TYPE, False, False, False],
        "widgets_values_named": {name: (types[0]["subject"] if i == 0 else
                                        (DEFAULT_TYPE if i == 1 else False))
                                 for i, (name, _t) in enumerate(WIDGET_INPUTS)},
    }
    nodes.append(host)
    # 顶缘通道 Reroute(09-24 整治:两条长横穿改走 y=-640/-560/-540 顶通道分层,列表格式
    # link 记账=K2-角色设定-道劫.json 顶层级样板;原 link id 8/10 留给加载器出线段;
    # 拐点 x 錯开使降线不穿他通道水平段,拐点盒(est 250×88)互不重叠)
    nodes.append(_reroute(RR_M8A_ID, [-1200, -540], 8, 19, "MODEL"))
    nodes.append(_reroute(RR_M8B_ID, [-50, -540], 19, 20, "MODEL"))
    nodes.append(_reroute(RR_M10A_ID, [-1130, -640], 10, 21, "VAE"))
    nodes.append(_reroute(RR_M10B_ID, [420, -560], 21, 22, "VAE"))
    for order, n in enumerate(nodes):
        n["order"] = order
    g["nodes"] = nodes

    g["links"] = [
        [1, HOST_ID, 3, LATENT_ID, 0, "INT"],
        [2, HOST_ID, 4, LATENT_ID, 1, "INT"],
        [5, LATENT_ID, 0, SAMPLER_ID, 3, "LATENT"],
        [8, 1, 0, RR_M8A_ID, 0, "MODEL"],
        [19, RR_M8A_ID, 0, RR_M8B_ID, 0, "MODEL"],
        [20, RR_M8B_ID, 0, SAMPLER_ID, 0, "MODEL"],
        [9, SAMPLER_ID, 0, 8, 0, "LATENT"],
        [10, 3, 0, RR_M10A_ID, 0, "VAE"],
        [21, RR_M10A_ID, 0, RR_M10B_ID, 0, "VAE"],
        [22, RR_M10B_ID, 0, 8, 1, "VAE"],
        [11, 8, 0, 9, 0, "IMAGE"],
        [12, 2, 0, HOST_ID, 0, "CLIP"],
        [13, 3, 0, HOST_ID, 1, "VAE"],
        [14, 11, 0, HOST_ID, 2, "CLIP"],
        [15, SUBJECT_ID, 0, HOST_ID, 3, "STRING"],
        [16, HOST_ID, 0, SAMPLER_ID, 1, "CONDITIONING"],
        [17, HOST_ID, 1, SAMPLER_ID, 2, "CONDITIONING"],
        [18, HOST_ID, 2, PREVIEW_ID, 0, "STRING"],
    ]
    # id 计数器真值重算(09-23 round7 红根因修复):新前端 configure 用
    # last_node_id/last_link_id 播种 id 分配器,陈旧计数器会让画布下一次接线
    # mint 出与实存链接撞车的 id(linkStore 拒登,connect 返回 null)。
    # 计数器只抬不降(高于 max 合法:删除只减 max 不减计数器);子图 id 与
    # 根图共享分配器,一并计入 max。
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

    # 3. 横向排版:主图每条连线 target.x > origin.x;子图同(边界线以 IO 槽 pos 为端点)
    for l in g["links"]:
        if not m_nodes[l[3]]["pos"][0] > m_nodes[l[1]]["pos"][0]:
            errs.append(f"主图 link{l[0]}: 纵向塔违规 {m_nodes[l[1]]['type']}→{m_nodes[l[3]]['type']}")
    for l in sg["links"]:
        ox = sg["inputs"][l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 else i_nodes[l["origin_id"]]["pos"][0]
        tx = sg["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 else i_nodes[l["target_id"]]["pos"][0]
        if not tx > ox:
            errs.append(f"子图 link{l['id']}: 纵向塔违规")

    # 3b. 行排版(design §12):子图按 y 分行恰 4 行=四阶段(源/装配路由/画幅联动/编码输出;
    #     通道 Reroute 拐点不占行);行间净距≥100;行内 x 严格递增(数组序=数据流序);
    #     主图+子图节点矩形零重叠;group 预算 子图≤4(三阶段+画幅联动)/主图≤3(泛滥即病);
    #     group 各框单一阶段行全部节点
    sg_rows: dict[int, list[int]] = {}
    for n in sg["nodes"]:
        if n["type"] == "Reroute":
            continue  # 通道拐点不占阶段行
        sg_rows.setdefault(n["pos"][1], []).append(n["id"])
    row_ys = sorted(sg_rows)
    want_rows = [
        [BASE_ID, LOCK_ID, RGBA_HEAD_ID, RGBA_TAIL_ID, PE_RW_ID],
        [CONCAT1_ID, CONCAT2_ID, RGBA_CAT1_ID, RGBA_CAT2_ID, PE_SW_ID],
        [RATIO_RW_ID, RATIO_RH_ID, CONV_RW_ID, CONV_RH_ID, MATH_W_ID, MATH_H_ID, SW_W_ID, SW_H_ID],
        [TE_RGBA_ID, TE_ID, RGBA_SW_ID],
    ]
    if len(row_ys) != 4:
        errs.append(f"子图应恰 4 行(源/装配路由/画幅联动/编码),得 {len(row_ys)} 行")
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
    if len(sg["groups"]) > 4:
        errs.append(f"子图 group 预算超限(≤4),得 {len(sg['groups'])}")
    if len(g["groups"]) > 3:
        errs.append(f"主图 group 预算超限(≤3),得 {len(g['groups'])}")
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

    # 4. group 全 int id(主图+子图)+ 标题带道劫(主图);子图名带道劫
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
        if n["type"] not in ("MarkdownNote", "Reroute") and "道劫" not in (n.get("title") or ""):
            errs.append(f"主图 node{n['id']} 标题缺道劫字号: {n.get('title')!r}")

    # 5. 宿主结构:type/properties.subgraph=uuid;输入槽序与子图 inputs 对齐;widget 值
    host = m_nodes[HOST_ID]
    if host["type"] != SG_UUID or host["properties"].get("subgraph") != SG_UUID:
        errs.append("[40] 宿主 type/properties.subgraph 与子图 uuid 不一致")
    if len(host["inputs"]) != len(sg["inputs"]):
        errs.append("[40] 宿主 inputs 槽数与子图 inputs 不一致")
    for i, (hi, si) in enumerate(zip(host["inputs"], sg["inputs"])):
        if hi["name"] != si["name"] or hi["type"] != si["type"]:
            errs.append(f"[40] 宿主 inputs[{i}]({hi['name']}) 与子图 inputs[{i}]({si['name']}) 不对齐")
    if host["widgets_values"] != [truth["types"][0]["subject"], DEFAULT_TYPE, False, False, False]:
        errs.append("[40] 宿主 widgets_values 应=[人物例一主体句, 人物, False×3](型选择默认人物/三开关默认关)")

    # 6. 外部接线:加载器/主体句→宿主;宿主→空潜宽高/KSampler/预览;主图无平铺装配件
    #    (09-24 整治:link8/10 走顶缘 Reroute 通道,锚定通道首尾段)
    ext_want = [
        (12, 2, 0, HOST_ID, 0, "CLIP"), (13, 3, 0, HOST_ID, 1, "VAE"),
        (14, 11, 0, HOST_ID, 2, "CLIP"), (15, SUBJECT_ID, 0, HOST_ID, 3, "STRING"),
        (1, HOST_ID, 3, LATENT_ID, 0, "INT"), (2, HOST_ID, 4, LATENT_ID, 1, "INT"),
        (16, HOST_ID, 0, SAMPLER_ID, 1, "CONDITIONING"), (17, HOST_ID, 1, SAMPLER_ID, 2, "CONDITIONING"),
        (18, HOST_ID, 2, PREVIEW_ID, 0, "STRING"),
        (8, 1, 0, RR_M8A_ID, 0, "MODEL"), (20, RR_M8B_ID, 0, SAMPLER_ID, 0, "MODEL"),
        (10, 3, 0, RR_M10A_ID, 0, "VAE"), (22, RR_M10B_ID, 0, 8, 1, "VAE"),
    ]
    got = {(l[0], l[1], l[2], l[3], l[4], l[5]) for l in g["links"]}
    for w in ext_want:
        if w not in got:
            errs.append(f"外部接线缺: link{w[0]} {[x for x in w[1:]]}")
    for banned in ("ResolutionSelector", "TextEncodeQwenImage21", "ComfySwitchNode",
                   "QwenImage21_T2IPromptRewrite", "StringConstant", "StringConcatenate"):
        if any(n["type"] == banned for n in g["nodes"]):
            errs.append(f"主图不应有平铺 {banned}(装配核心已收进子图/分辨率已随型直驱)")

    # 7. MyQi21DaojieBase 在场+combo 默认人物+三出接线;qi21_bases.json↔05 库互锁;
    #    锁层A 恒挂逐字=库
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
        if not bl or bl["origin_id"] != -10 or bl["origin_slot"] != 4:
            errs.append("[150].base 应接 -10 槽4(宿主面板「型选择」COMBO)")
        if [o["name"] for o in base_node["outputs"]] != ["BASE", "WIDTH", "HEIGHT", "型名"]:
            errs.append("[150] 四出应为 BASE/WIDTH/HEIGHT/型名")
        if i_links[i_nodes[CONCAT1_ID]["inputs"][1]["link"]]["origin_id"] != BASE_ID:
            errs.append("拼接①.string_b 上游应为 [150].BASE(级联已退役)")
        if _trace_origin(i_links, i_nodes, i_nodes[SW_W_ID]["inputs"][0]["link"]) != BASE_ID or \
           _trace_origin(i_links, i_nodes, i_nodes[SW_H_ID]["inputs"][0]["link"]) != BASE_ID:
            errs.append("宽高开关 on_false 上游应为 [150].WIDTH/HEIGHT(九型直驱默认路,可穿通道 Reroute)")
    # 真源链互锁:qi21_bases.json(节点运行时真源)↔05 库(load_truth 已逐型对拍;
    # 这里复核默认型 BASE 干跑取值)
    if _qi21_base_text(DEFAULT_TYPE) != truth["types"][0]["constant_text"]:
        errs.append("干跑 BASE(qi21_bases.json 人物)与 05 库人物型②层装配不逐字一致")
    if i_nodes[LOCK_ID]["widgets_values"][0] != truth["const_a"]:
        errs.append("[110] 通用锁层常量A 与库首节常量不逐字一致")
    lock_link = i_links[i_nodes[LOCK_ID]["outputs"][0]["links"][0]]
    if lock_link["target_id"] != CONCAT2_ID:
        errs.append("[110] 应恒挂直连拼接②(不随型走开关)")

    # 8. 级联退役:子图 ComfySwitchNode 恰 4 枚(提示词 STRING/RGBA CONDITIONING/宽高 INT 联动);
    #    全部 switch 槽接 -10;九 StringConstant 不复活(子图 StringConstant 恰 3=锁层A+RGBA头尾)
    switches = [n for n in sg["nodes"] if n["type"] == "ComfySwitchNode"]
    if sorted(n["id"] for n in switches) != sorted([PE_SW_ID, RGBA_SW_ID, SW_W_ID, SW_H_ID]):
        errs.append(f"级联退役:子图开关应恰 4 枚(提示词/RGBA/宽高联动),得 {[n['id'] for n in switches]}")
    for sw in switches:
        if sw["widgets_values"][0] is not False:
            errs.append(f"[{sw['id']}] 开关默认非 false")
        if _trace_origin(i_links, i_nodes, sw["inputs"][2]["link"]) != -10:
            errs.append(f"[{sw['id']}] switch 槽应接 -10(宿主面板,可穿通道 Reroute)")
    sconsts = [n for n in sg["nodes"] if n["type"] == "StringConstant"]
    if sorted(n["id"] for n in sconsts) != sorted([LOCK_ID, RGBA_HEAD_ID, RGBA_TAIL_ID]):
        errs.append(f"级联退役:子图 StringConstant 应恰 3 枚(锁层A+RGBA头尾),得 {[n['id'] for n in sconsts]}")
    # 联动链:wh_ratio→正则→转数→公式→开关 on_true;正则/公式锚
    if i_nodes[RATIO_RW_ID]["widgets_values"][1] != RATIO_W_PATTERN or \
       i_nodes[RATIO_RH_ID]["widgets_values"][1] != RATIO_H_PATTERN:
        errs.append("画幅联动正则 pattern 漂移")
    if i_nodes[MATH_W_ID]["widgets_values"][0] != MATH_W_EXPR or \
       i_nodes[MATH_H_ID]["widgets_values"][0] != MATH_H_EXPR:
        errs.append("画幅联动公式漂移")
    for mid, conv_a, conv_b in ((MATH_W_ID, CONV_RW_ID, CONV_RH_ID), (MATH_H_ID, CONV_RW_ID, CONV_RH_ID)):
        a_src = i_links[i_nodes[mid]["inputs"][0]["link"]]["origin_id"]
        b_src = i_links[i_nodes[mid]["inputs"][1]["link"]]["origin_id"]
        if a_src != conv_a or b_src != conv_b:
            errs.append(f"[{mid}] 公式 values.a/b 上游应为宽/高转数([{CONV_RW_ID}]/[{CONV_RH_ID}])")
    if i_links[i_nodes[SW_W_ID]["inputs"][1]["link"]]["origin_id"] != MATH_W_ID or \
       i_links[i_nodes[SW_H_ID]["inputs"][1]["link"]]["origin_id"] != MATH_H_ID:
        errs.append("宽高开关 on_true 上游应为公式宽/高")
    wh = i_nodes[PE_RW_ID]["outputs"][2]
    if wh["name"] != "wh_ratio" or sorted(wh["links"] or []) != [28, 29]:
        errs.append("[140].wh_ratio 应扇出两线喂宽高正则(联动源)")

    # 9. 干跑谓词(静态 graphToPrompt 等价):默认态沿 KSampler 四输入解析
    reach_int, assembled = _dry_run_default(g, sg)
    if BASE_ID not in reach_int or LOCK_ID not in reach_int:
        errs.append(f"干跑:默认态应含 [{BASE_ID}]底座/[{LOCK_ID}]锁层,得 {sorted(reach_int)}")
    for nid in (PE_RW_ID, TE_RGBA_ID, RATIO_RW_ID, RATIO_RH_ID, CONV_RW_ID, CONV_RH_ID,
                MATH_W_ID, MATH_H_ID, RGBA_CAT1_ID, RGBA_CAT2_ID):
        if nid in reach_int:
            errs.append(f"干跑:默认态 [{nid}] 不应可达(懒执行旁路)")
    want = "\n".join([truth["types"][0]["subject"],
                      _qi21_base_text(DEFAULT_TYPE), truth["const_a"]])
    if assembled != want:
        errs.append("干跑:默认装配全文与库人物型四层组合不逐字一致")

    # 10. PE/RGBA 承袭:类名/参数/默认旁路;懒执行(开关 false 时 on_true 不在默认源);
    #     RGBA 官方公式(头尾常量逐字+拼接路+空格 delimiter)
    pe = i_nodes[PE_RW_ID]
    if pe["widgets_values"] != [PE_SEED_PROMPT, *PE_PARAMS]:
        errs.append("PE 改写组参数漂移(插件官方 README 推荐值,A/B 后再定)")
    pe_clip = [n for n in g["nodes"] if n["type"] == "CLIPLoader" and n["widgets_values"][0] == PE_CLIP_FILE]
    if len(pe_clip) != 1:
        errs.append("PE 专属 CLIPLoader 缺失(应在主图加载器组)")
    if i_nodes[RGBA_HEAD_ID]["widgets_values"][0] != RGBA_HEAD_EN or \
       i_nodes[RGBA_TAIL_ID]["widgets_values"][0] != RGBA_TAIL_EN:
        errs.append("RGBA 官方头/尾常量非官方原文逐字")
    rgba_prompt_link = i_links.get(i_nodes[TE_RGBA_ID]["inputs"][3]["link"])
    if not rgba_prompt_link or rgba_prompt_link["origin_id"] != RGBA_CAT2_ID:
        errs.append("[143].prompt 应接 [163] RGBA 公式拼接输出(整体替换演示句已废止)")
    if i_nodes[TE_RGBA_ID]["widgets_values"][0] != "":
        errs.append("[143] prompt widget 应清空(公式路现拼)")
    cat1, cat2 = i_nodes[RGBA_CAT1_ID], i_nodes[RGBA_CAT2_ID]
    if cat1["widgets_values"][2] != " " or cat2["widgets_values"][2] != " ":
        errs.append("RGBA 公式拼接 delimiter 应为空格")
    if i_links[cat1["inputs"][1]["link"]]["origin_id"] != CONCAT2_ID:
        errs.append("RGBA 公式拼接①.string_b 上游应为装配全文([27] 同源)")
    if host["widgets_values"][2] is not False or host["widgets_values"][3] is not False \
       or host["widgets_values"][4] is not False:
        errs.append("[40] 面板 PE/RGBA/画幅联动开关默认必须 false")
    if PE_RW_ID in reach_int:
        errs.append("干跑:默认态 PE 改写不应在执行源内(懒执行旁路)")

    # 10b. 采样完整态:steps=40(官方完整档,官方区间 40-50 进 Note);euler/simple/cfg1 不变
    sampler = m_nodes[SAMPLER_ID]
    wv = sampler["widgets_values"]
    if wv[2] != 40:
        errs.append(f"[7] KSampler steps 应=40(官方完整档),得 {wv[2]}")
    if wv[3] != 1 or wv[4] != "euler" or wv[5] != "simple" or wv[1] != "fixed":
        errs.append("[7] KSampler cfg/scheduler/sampler/seed 控制漂移")

    # 11. 无孤儿节点(SaveImage 向上可达;MarkdownNote/easy showAnything 显示型端点豁免)
    seen, stack = set(), [9]
    m_links = {l[0]: l for l in g["links"]}
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

    # 12. 说明 Note 必含要点
    note = next(n for n in g["nodes"] if n["type"] == "MarkdownNote")["widgets_values"][0]
    for token in ("cfg 恒 1", "步数 40", "40-50", RGBA_HEAD_EN, RGBA_TAIL_EN, RGBA_HEAD_ZH,
                  "qwen-image-2-1-prompter", "05-道劫规范提示词库.md", "九型", "空镜无人",
                  "MyQi21DaojieBase", "画幅联动", "恒挂", "美化", "[27]", "ResolutionSelector 已退役"):
        if token not in note:
            errs.append(f"说明 Note 缺要点: {token!r}")
    if note.lstrip().startswith("# "):
        errs.append("说明 Note 以一级大标题开幅(禁横幅)")
    return errs


def _dry_run_default(g: dict, sg: dict) -> tuple[set[int], str]:
    """静态干跑:默认态(PE/RGBA/画幅联动全 false)装配文本溯源与可达集。

    模拟 graphToPrompt 转换路:宿主输入有外链则进主图解析,widget 型取宿主
    widgets_values;子图内部沿 link 解析;ComfySwitchNode 懒执行=只走 on_false;
    MyQi21DaojieBase 的 BASE=qi21_bases.json 该型 base_text(节点运行时真源)。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    i_nodes = {n["id"]: n for n in sg["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    i_links = {l["id"]: l for l in sg["links"]}
    host = m_nodes[HOST_ID]
    host_widget_values = dict(zip([i["name"] for i in host["inputs"] if "widget" in i],
                                  host["widgets_values"]))

    def resolve_internal(node_id: int, slot: int):
        """解析子图内部某输入槽的文本贡献:内链→内部节点/-10(外链→主图源)。"""
        texts: list[str] = []
        inp = i_nodes[node_id]["inputs"][slot]
        lid = inp.get("link")
        if lid is None:
            return texts
        l = i_links[lid]
        if l["origin_id"] == -10:
            hi = host["inputs"][l["origin_slot"]]
            if hi.get("link") is not None:  # 外链→主图源(主体句)
                src = m_nodes[m_links[hi["link"]][1]]
                if src["type"] == "PrimitiveStringMultiline":
                    texts.append(src["widgets_values"][0])
            else:  # widget 型(型选择 COMBO 等)——MyQi21DaojieBase 的 base 即此路
                if i_nodes[node_id]["type"] == "MyQi21DaojieBase":
                    texts.append(_qi21_base_text(host_widget_values.get("型选择", DEFAULT_TYPE)))
            return texts
        src = i_nodes[l["origin_id"]]
        if src["type"] == "StringConstant":
            texts.append(src["widgets_values"][0])
        elif src["type"] == "MyQi21DaojieBase":
            texts.append(_qi21_base_text(host_widget_values.get("型选择", DEFAULT_TYPE)))
        elif src["type"] == "ComfySwitchNode":
            if src["widgets_values"][0] is not False:
                raise SystemExit(f"干跑:默认链开关非 false [{src['id']}]")
            texts.extend(resolve_internal(src["id"], 0))  # on_false(懒执行)
        elif src["type"] == "StringConcatenate":
            texts.extend(resolve_internal(src["id"], 0))   # string_a
            texts.extend(resolve_internal(src["id"], 1))   # string_b
        return texts

    # 装配文本 = 提示词开关.on_false 支路(默认)溯源
    texts = resolve_internal(PE_SW_ID, 0)

    # 默认态参与执行的子图内部节点(懒执行:开关只走 on_false)
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

    walk(PE_SW_ID)
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
          f"默认=①人物(MyQi21DaojieBase combo 经宿主面板外露,级联退役,宽高直驱 [5],"
          f"steps=40 完整态,RGBA 官方头尾公式,画幅联动默认关);干跑默认装配全文逐字=库组合;"
              f"双向/横向/四行排版(行内左→右,行间上→下,Reroute 通道拐点不占行)/零重叠/"
              "group 预算(子图4·主图3,各框单一阶段行)/group int/子图 linkIds 逐项登记/"
              "锁层A 恒挂/懒执行旁路/零孤儿全绿")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
