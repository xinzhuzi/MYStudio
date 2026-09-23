#!/usr/bin/env python3
"""qi21-道劫-t2i.json 幂等生成器(09-23,道劫装配子图版;qwen21-daojie-t2i-pro.json 改名+子图化+底座美化三合一)。

用户三件令的落位:
  ①改名  旧 qwen21-daojie-t2i-pro.json 退役(文件删除,一次性迁移);本脚本产出
         1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json。
  ②子图化  布局学 K2-文生图-道劫.json [90] 的组织法:把『底座九选一+主体句+通用
         锁层+装配链+PE 组+RGBA 开关』整体收进一个子图(definitions.subgraphs,
         契约=docs/comfyui-kb/子图工作流工程契约.md:groups 必带 int id、子图 IO
         必须写 inputs[].linkIds/outputs[].linkIds、内部 links 用对象格式)。
         子图外露(主画面板可达):型选择控制(八级选型开关,子图宿主 [40] 面板
         widget)、主体句([24] 外露 PrimitiveStringMultiline,仿 K2 [50])、PE 开关
         与 RGBA 开关(同在 [40] 面板)、分辨率([4] ResolutionSelector)、seed([7]
         KSampler widget)。外部只剩加载器/采样/解码/保存/说明 Note(+[24]/[27]
         两个外露件与显示端点)。
  ③底座美化  九型底座常量逐字=05 库②层「09-23 美化版」(《三国望神州》v2.2+手册
         词汇成文;生成时从库文档现读),canon-json 逐字锚废止、型名/顺序仍与
         daojie_bases.json 对齐;通用锁层常量A/B 照旧逐字=库首两常量(写全条款
         不变)。真源链:05 库→本工作流常量→契约测试库↔工作流互锁。

子图结构(宿主 [40],双击进入):
  inputs(14): clip/vae/pe_clip/主体句(外连 [2][3][11][24]) + 选型②场景…选型⑨
    概念气氛图(8×BOOLEAN widget,宿主面板一处切换,仿 K2 [80]→[90].base 的一处
    选型体验)+ PE改写开关 + RGBA透明开关(BOOLEAN widget)。
  outputs(3): positive/negative(CONDITIONING→[7] KSampler)、prompt(STRING→[27]
    装配预览,仿 K2 [90].applied→[86])。
  内部: [101]-[109] 九型底座常量(美化版+人物系增量锁B+配色行)/[110] 通用锁层常量A
    (恒挂)/[120]-[127] 八级 ComfySwitchNode 级联(全 false=①人物)/[130][131]
    StringConcatenate(delimiter=\\n 换行分层)/[140] PE 改写+[141] 提示词开关/
    [142] 主编码+[143] RGBA 编码+[144] RGBA 开关。
  widget-input 序列化口径=引擎 blueprints/Prompt Enhance.json 实证(宿主 inputs 带
    widget 标记+widgets_values 按槽序)+K2 1.53 存档口径(宿主 widgets_values_named)。

自查(写盘后必跑,任一失败退出码 1):json.loads 往返 / 主图+子图 link 双向一致 /
主图+子图横向排版(每条连线 target.x > origin.x;边界线以 IO 槽 pos 为端点)/
主图+子图 group 全 int id / 子图 IO linkIds 逐项登记(契约铁律)/ 道劫字号 /
九底座两两唯一且逐字=库 / 锁层A 恒挂且逐字=库 / 级联九路接线 / 默认装配全文=库
人物型组合(逐字)/ graphToPrompt 干跑谓词(静态展开子图:沿 [7] KSampler 上溯解析
positive/negative/model/latent 四源,PE/RGBA on_true 懒旁路,输出装配全文核对) /
PE·RGBA 承袭参数 / 无孤儿节点(MarkdownNote 与 easy showAnything 显示型端点豁免)/
说明 Note 必含要点。

不动 K2 侧任何文件;引擎家 userdata 零写入;不 git。重跑幂等:九底座/锁层/主体句
默认全文从库文档现读,库更新后重跑即同步(与契约测试 test_qwen21_workflow_contract.py
互锁)。真前端 graphToPrompt 干跑与实弹出图由 e2e 层另行验证(引擎 v0.37 真前端直开
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
PE_CLIP_FILE = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors"
PE_PARAMS = [1.0, 0.95, 20, 1.5, 16256, 42]
PE_SEED_PROMPT = "水墨国风修仙:一位修士立于云中山巅,渡劫前夜,大面积留白,一小块朱砂点题色"
RGBA_PROMPT = (
    "This is an RGBA format image with transparency. an ink-wash illustration of a solitary "
    "cultivator standing on a cloud-wreathed stone terrace, expressive brushwork, expansive "
    "negative space, one small cinnabar accent. The image has an alpha channel and a "
    "transparent background."
)
RGBA_HEAD = "This is an RGBA format image with transparency."
RGBA_TAIL = "The image has an alpha channel and a transparent background."

# 子图内部节点 id(独立 id 空间,仿 K2 [90] 内部 101+)
CONST_IDS = [101, 102, 103, 104, 105, 106, 107, 108, 109]   # 九型底座常量①-⑨
LOCK_ID = 110                                                # 通用锁层常量A
SWITCH_IDS = [120, 121, 122, 123, 124, 125, 126, 127]       # 选型①-⑧(⑧=九选一汇总)
CONCAT1_ID, CONCAT2_ID = 130, 131                            # 装配拼接①②
PE_RW_ID, PE_SW_ID = 140, 141                                # PE 改写/提示词开关
TE_ID, TE_RGBA_ID, RGBA_SW_ID = 142, 143, 144                # 主编码/RGBA 编码/RGBA 开关
HOST_ID = 40                                                 # 主图子图宿主
SUBJECT_ID, PREVIEW_ID = 24, 27                              # 主图外露主体句/装配预览
_CN = "①②③④⑤⑥⑦⑧⑨"

# 宿主 widget 型子图输入(槽序=inputs 数组序;widgets_values 按此序)
WIDGET_INPUTS = [
    ("主体句", "STRING"), ("选型②场景", "BOOLEAN"), ("选型③道具", "BOOLEAN"),
    ("选型④美宣", "BOOLEAN"), ("选型⑤三视图", "BOOLEAN"), ("选型⑥高清人脸", "BOOLEAN"),
    ("选型⑦分镜剧情图", "BOOLEAN"), ("选型⑧表情差分", "BOOLEAN"),
    ("选型⑨概念气氛图", "BOOLEAN"), ("PE改写开关", "BOOLEAN"), ("RGBA透明开关", "BOOLEAN"),
]
LINK_INPUTS = [("clip", "CLIP"), ("vae", "VAE"), ("pe_clip", "CLIP")]  # 槽 0-2

NOTE_TEXT = (
    "## 道劫 · Qwen-Image-2.1 文生图(装配子图版·九型底座 09-23 美化)\n\n"
    "K2 道劫『一处选型+分件装配+子图收装』思想的 Q2-1 原生落地:九型底座+通用锁层+四层装配+PE/RGBA 路由整体收进 "
    "**[40] 装配子图**(双击进入=九型底座常量/八级选型级联/锁层恒挂/换行拼接/PE 改写/双路编码);"
    "提示词真源=docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md(②层底座=09-23 美化版,《三国望神州》v2.2+手册词汇成文,"
    "纯画法零物象骨与每型锁质要点逐项保留;canon-json 逐字锚废止,型名/顺序仍对齐 daojie_bases.json)。\n\n"
    "### 怎么换型(一处切换)\n"
    "- 主画布点选 [40] 装配子图,面板上八个选型开关即型选择控制(全关=①人物默认,默认即此):"
    "开「选型②场景」=②场景;「选型③道具」=③道具;…「选型⑨概念气氛图」=⑨概念气氛图(一处切换,懒执行,未选底座不进提示词)。\n"
    "- 换型后把 [4] 分辨率同步切档(档位=ResolutionSelector 真实 combo 值;MP=canon daojie_bases.json):\n"
    "  人物 3:4 (Portrait Standard)·4.2MP / 场景 16:9 (Widescreen)·4.2MP / 道具 1:1 (Square)·1.0MP / "
    "美宣 21:9 (Ultrawide)·4.2MP / 三视图 21:9 (Ultrawide)·4.2MP(canon 另带 3072×1024 单图直出 override,"
    "须断开 [4]→[5] 连线手改宽高) / 高清人脸 1:1 (Square)·1.0MP / 分镜剧情图 16:9 (Widescreen)·4.2MP / "
    "表情差分 1:1 (Square)·4.2MP / 概念气氛图 16:9 (Widescreen)·4.2MP。\n"
    "- 换型后 [24] 主体句须同步换成本型主体句(各型例句见库文档;场景/概念气氛图不写人——空镜句尾可明写「空镜无人」);"
    "主体句只写主体与画面,不重复风格词,全角标点,质量词/比例词/否定式禁入(库文档主体句纪律五则)。\n"
    "- 警示(手贴 vs 重跑):手贴底座只活在画布件——生成脚本重跑会把九底座/锁层/主体句默认全量重置回库文档现读值"
    "(真源=库文档②层美化版),手贴内容被静默覆盖;要长久保留,先回写库文档再重跑,或重跑前另存画布件。\n\n"
    "### 装配怎么拼([24] 唯一手写位;细节双击 [40] 看)\n"
    "- 拼法=库文档四层装配『主体句领头+换行分层』:子图内拼接把 [24] 主体句 + 当前型底座(美化版②层+人物系增量锁B+"
    "④配色行)+ 通用锁层常量A(③层,库首节全文,全九型恒挂不随型)逐层接成一段进编码,再经提示词开关进 [142] 主编码。\n"
    "- 层次序注:画布装配行序=①主体句→②型底座→(人物系增量锁)→④配色行→③通用锁层;库文档直写件行序=①②③(内嵌增量锁)④"
    "——层内容零差异,仅行序不同(锁层常量恒挂不可拆,增量锁随型走故居底座常量内)。\n"
    "- 跑图前过目 [27] 装配预览(接子图 prompt 输出):显示将进编码的最终文本,确认再跑。\n"
    "- 甲案围栏:本链为甲案全中文直书(中文合法);与 PE/乙案英文长文禁混——[40] 面板「PE改写开关」开=走 PE 改写路"
    "(中文种子句进、英文长文出),与本链二选一(库文档禁混条款一)。\n\n"
    "### PE 与 RGBA 何时开(开关都在 [40] 面板)\n"
    "- PE改写开关:关=直写(默认,上面的装配链);开=PE 扩写(短句种子→官方宪法英文长文,懒执行——旁路时 PE 模型不加载)。\n"
    "- RGBA透明开关:关=普通(默认);开=透明底——官方包裹句式原文:This is an RGBA format image with transparency. "
    "[your description]. The image has an alpha channel and a transparent background. 透明路出图必须存 PNG 才保 alpha。\n"
    "- 起草/改写提示词唤取技能 qwen-image-2-1-prompter。\n\n"
    "### 参数圣经\n"
    "- cfg 恒 1(负向不生效,负向槽留空);步数 25 起手(官方 40-50);分辨率走 [4],宽高宜 32 倍数;"
    "seed 在 [7] KSampler(默认 fixed=0 可复现);风格终审=用户。\n"
    "- 生成脚本=apps/build/scripts/qi21_daojie_t2i_0923.py(幂等;九底座/锁层/主体句默认从库文档现读,重跑即同步;"
    "前代 qwen21-daojie-t2i-pro.json 与其生成器 qwen21_daojie_pro_0923.py 已随本轮改名退役)。\n"
)


# ── 真源解析(05 库文档;②层=09-23 美化版)──────────────────────────
def load_truth() -> dict:
    """返回 {types:[{zh,aspect,mp,subject,base,middle_is_char,constant_text}], const_a}。

    constant_text=子图底座常量应有全文=②美化版底座(+常量B·人物系增量四锁)+④配色行。
    """
    md = PROMPT_LIB.read_text(encoding="utf-8")
    bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))
    zh_order = [b["zh"] for b in bases]
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
    if len({t["base"] for t in types}) != 9:
        raise SystemExit("九型美化版底座两两不唯一")
    return {"types": types, "const_a": const_a}


# ── 节点工厂(序列化口径承 qwen21 族在库件/K2 件)────────────────────
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


def _concatenate(nid: int, title: str, a_link: int, b_link: int, out_links: list[int], pos: list) -> dict:
    return {
        "id": nid, "type": "StringConcatenate", "title": f"道劫·{title}",
        "pos": pos, "size": [380, 180], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "string_a", "type": "STRING", "widget": {"name": "string_a"}, "link": a_link},
            {"name": "string_b", "type": "STRING", "widget": {"name": "string_b"}, "link": b_link},
        ],
        "outputs": [{"name": "STRING", "type": "STRING", "links": out_links}],
        "properties": {"Node name for S&R": "StringConcatenate"},
        "widgets_values": ["", "", "\n"],
        "widgets_values_named": {"delimiter": "\n"},
    }


# ── 子图构建 ────────────────────────────────────────────────────────
def _internal_link(lid: int, oid: int, oslot: int, tid: int, tslot: int, typ: str) -> dict:
    return {"id": lid, "origin_id": oid, "origin_slot": oslot,
            "target_id": tid, "target_slot": tslot, "type": typ}


def build_subgraph(truth: dict) -> tuple[dict, list[dict]]:
    """返回 (subgraph 定义, 内部 link 对象表)。"""
    types = truth["types"]

    # 常量列 x=40;人物系(含常量B)行高 500,场景系 260;行距=上行底+60
    const_pos, y = [], -80
    for t in types:
        h = 500 if t["zh"] in CHAR_TYPES else 260
        const_pos.append([40, y, h])
        y += h + 60
    lock_y = y  # 110 锁层A 紧随九行之下

    # 边界线 id:1-16(自 -10 扇出);级联/装配/编码段:17-43
    links: list[dict] = []
    # -10 扇出
    links.append(_internal_link(1, -10, 0, TE_ID, 0, "CLIP"))          # clip → 主编码
    links.append(_internal_link(2, -10, 0, TE_RGBA_ID, 0, "CLIP"))     # clip → RGBA 编码
    links.append(_internal_link(3, -10, 1, TE_ID, 2, "VAE"))           # vae → 主编码
    links.append(_internal_link(4, -10, 1, TE_RGBA_ID, 2, "VAE"))      # vae → RGBA 编码
    links.append(_internal_link(5, -10, 2, PE_RW_ID, 0, "CLIP"))       # pe_clip → PE 改写
    links.append(_internal_link(6, -10, 3, CONCAT1_ID, 0, "STRING"))   # 主体句 → 拼接①.string_a
    for i, sid in enumerate(SWITCH_IDS):
        links.append(_internal_link(7 + i, -10, 4 + i, sid, 2, "BOOLEAN"))  # 选型开关 k → switch k
    links.append(_internal_link(15, -10, 12, PE_SW_ID, 2, "BOOLEAN"))   # PE改写开关 → [141].switch
    links.append(_internal_link(16, -10, 13, RGBA_SW_ID, 2, "BOOLEAN"))  # RGBA透明开关 → [144].switch
    # 级联:S_k.on_false ← C①(k=1)/S_{k-1};S_k.on_true ← C{k+2}型;末梢 → 拼接①.string_b
    for i, sid in enumerate(SWITCH_IDS):
        if i == 0:
            links.append(_internal_link(17, CONST_IDS[0], 0, sid, 0, "STRING"))
        else:
            links.append(_internal_link(17 + 2 * i, SWITCH_IDS[i - 1], 0, sid, 0, "STRING"))
        links.append(_internal_link(18 + 2 * i, CONST_IDS[i + 1], 0, sid, 1, "STRING"))
    links.append(_internal_link(33, SWITCH_IDS[-1], 0, CONCAT1_ID, 1, "STRING"))  # 级联末梢 → 拼接①
    # 装配
    links.append(_internal_link(34, LOCK_ID, 0, CONCAT2_ID, 1, "STRING"))     # 锁层A 恒挂 → 拼接②
    links.append(_internal_link(35, CONCAT1_ID, 0, CONCAT2_ID, 0, "STRING"))  # 拼接① → 拼接②
    links.append(_internal_link(36, CONCAT2_ID, 0, PE_SW_ID, 0, "STRING"))    # 拼接② → 提示词开关.on_false
    links.append(_internal_link(37, PE_RW_ID, 0, PE_SW_ID, 1, "STRING"))      # PE 改写 → 提示词开关.on_true
    links.append(_internal_link(38, PE_SW_ID, 0, TE_ID, 3, "STRING"))         # 提示词开关 → 主编码.prompt
    # 编码与 RGBA 开关
    links.append(_internal_link(39, TE_ID, 0, RGBA_SW_ID, 0, "CONDITIONING"))   # 主编码.positive → on_false
    links.append(_internal_link(40, TE_RGBA_ID, 0, RGBA_SW_ID, 1, "CONDITIONING"))  # RGBA.positive → on_true
    links.append(_internal_link(41, RGBA_SW_ID, 0, -20, 0, "CONDITIONING"))    # → 输出 positive
    links.append(_internal_link(42, TE_ID, 1, -20, 1, "CONDITIONING"))         # 主编码.negative → 输出 negative
    links.append(_internal_link(43, PE_SW_ID, 0, -20, 2, "STRING"))            # 装配文本 → 输出 prompt(预览)
    assert [l["id"] for l in links] == list(range(1, 44))

    # 内部节点
    nodes: list[dict] = []
    for i, (t, cid) in enumerate(zip(types, CONST_IDS)):
        extra = "+人物系增量锁" if t["zh"] in CHAR_TYPES else ""
        title = (f"底座{_CN[i]}{t['zh']}(美化版型底座+配色行{extra};"
                 f"画幅{t['aspect'].split(' ')[0]}·{t['mp']}MP)")
        out_link = 17 if i == 0 else 18 + 2 * (i - 1)
        pos = const_pos[i]
        nodes.append(_string_constant(cid, title, t["constant_text"], pos[:2], [out_link], [440, pos[2]]))
    nodes.append(_string_constant(
        LOCK_ID, "通用锁层常量A(③层·库首节全文·全九型恒挂)",
        truth["const_a"], [40, lock_y], [34], [440, 400]))

    for i, sid in enumerate(SWITCH_IDS):
        false_link = 17 + 2 * i
        true_link = 18 + 2 * i
        out_links = [33] if i == len(SWITCH_IDS) - 1 else [17 + 2 * (i + 1)]
        label = "九选一汇总" if i == len(SWITCH_IDS) - 1 else f"选型{_CN[i]}"
        chain_lbl = "①人物" if i == 0 else f"①-{_CN[i]}"
        title = (f"{label}(false={chain_lbl} / true={_CN[i + 1]}{types[i + 1]['zh']})"
                 if i < len(SWITCH_IDS) - 1 else
                 f"{label}(false={chain_lbl} / true=⑨概念气氛图)")
        nodes.append(_switch(sid, title, false_link, true_link, 7 + i, out_links,
                             [620 + 460 * i, -80]))

    nodes.append(_concatenate(
        CONCAT1_ID, "装配拼接①(主体句+底座级联;delimiter=\\n)", 6, 33, [35], [4360, -80]))
    nodes.append(_concatenate(
        CONCAT2_ID, "装配拼接②(+通用锁层恒挂;delimiter=\\n)", 35, 34, [36, 43], [4820, -80]))

    nodes.append({
        "id": PE_RW_ID, "type": "QwenImage21_T2IPromptRewrite",
        "title": "道劫·PE改写(短句→英文长文,默认旁路)",
        "pos": [5280, 440], "size": [440, 340], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "clip", "type": "CLIP", "link": 5},
            {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": None},
            {"name": "temperature", "type": "FLOAT", "widget": {"name": "temperature"}, "link": None},
            {"name": "top_p", "type": "FLOAT", "widget": {"name": "top_p"}, "link": None},
            {"name": "top_k", "type": "INT", "widget": {"name": "top_k"}, "link": None},
            {"name": "presence_penalty", "type": "FLOAT", "widget": {"name": "presence_penalty"}, "link": None},
            {"name": "max_new_tokens", "type": "INT", "widget": {"name": "max_new_tokens"}, "link": None},
            {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": None},
        ],
        "outputs": [
            {"name": "positive_prompt", "type": "STRING", "links": [37]},
            {"name": "negative_prompt", "type": "STRING", "links": None},
            {"name": "wh_ratio", "type": "STRING", "links": None},
            {"name": "thinking", "type": "STRING", "links": None},
            {"name": "parse_ok", "type": "BOOLEAN", "links": None},
        ],
        "properties": {"Node name for S&R": "QwenImage21_T2IPromptRewrite"},
        "widgets_values": [PE_SEED_PROMPT, *PE_PARAMS],
    })
    nodes.append(_switch(
        PE_SW_ID, "提示词开关(false=直写装配 / true=PE扩写)", 36, 37, 15, [38, 43], [5740, -80]))

    def _textencode(nid: int, title: str, pos: list, clip_l: int, vae_l: int,
                    prompt_link, prompt_text: str) -> dict:
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
                {"name": "positive", "type": "CONDITIONING", "links": (
                    [39] if nid == TE_ID else [40])},
                {"name": "negative", "type": "CONDITIONING", "links": (
                    [42] if nid == TE_ID else None)},
                {"name": "latent", "type": "LATENT", "links": None},
            ],
            "properties": {"Node name for S&R": "TextEncodeQwenImage21"},
            "widgets_values": [prompt_text, "", 1024],
        }

    nodes.append(_textencode(TE_ID, "主编码(prompt 接提示词开关)", [6200, -80], 1, 3, 38, ""))
    nodes.append(_textencode(TE_RGBA_ID, "RGBA编码(透明路,默认旁路)", [6200, 440], 2, 4, None, RGBA_PROMPT))
    nodes.append(_switch(
        RGBA_SW_ID, "RGBA开关(false=普通 / true=透明,透明图存PNG)", 39, 40, 16, [41], [6700, -80],
        typ="CONDITIONING"))

    # 内部分组(int id;①-⑨型行+级联+锁层+拼接+PE+编码)
    groups: list[dict] = []
    for i, (t, pos) in enumerate(zip(types, const_pos)):
        extra = "+人物系增量锁B" if t["zh"] in CHAR_TYPES else ""
        groups.append({
            "id": i + 1,
            "title": f"{_CN[i]} {t['zh']} · {t['aspect'].split(' ')[0]}·{t['mp']}MP(美化版底座+配色行{extra})",
            "bounding": [20, pos[1] - 40, 480, pos[2] + 80], "color": "#2a3a2a", "flags": {},
        })
    groups.append({
        "id": 10, "title": "选型级联·八级开关链(值来自宿主面板;全 false=①人物)",
        "bounding": [600, -160, 3700, 240], "color": "#4d9e6a", "flags": {},
    })
    groups.append({
        "id": 11, "title": "通用锁层常量A·恒挂(③层,全九型不随型)",
        "bounding": [20, lock_y - 40, 480, 480], "color": "#a1309b", "flags": {},
    })
    groups.append({
        "id": 12, "title": "装配拼接(delimiter=\\n 换行分层;主体句+当前型底座+锁层A)",
        "bounding": [4340, -240, 480, 440], "color": "#a1309b", "flags": {},
    })
    groups.append({
        "id": 13, "title": "PE 提示词改写(默认旁路;懒执行,旁路不载 PE 模型)",
        "bounding": [5240, 360, 540, 460], "color": "#a1309b", "flags": {},
    })
    groups.append({
        "id": 14, "title": "编码与双路开关(主编码/RGBA 编码→RGBA 开关;开关值来自宿主面板)",
        "bounding": [6160, -240, 940, 1080], "color": "#3f789e", "flags": {},
    })

    for order, n in enumerate(nodes):
        n["order"] = order

    # 子图 IO(inputs 槽序=宿主 inputs 序;widget 型输入 linkIds 同样逐项登记=契约铁律;
    # id=UUID,序列化口径承 K2 件与引擎 blueprints 实证)
    _IO_IDS = [
        "a1e2c3d4-0001-4a01-9e01-7d4a9c31a001",  # in-0 clip
        "a1e2c3d4-0002-4a02-9e02-7d4a9c31a002",  # in-1 vae
        "a1e2c3d4-0003-4a03-9e03-7d4a9c31a003",  # in-2 pe_clip
        "a1e2c3d4-0004-4a04-9e04-7d4a9c31a004",  # in-3 主体句
        "a1e2c3d4-0005-4a05-9e05-7d4a9c31a005",  # in-4 选型②场景
        "a1e2c3d4-0006-4a06-9e06-7d4a9c31a006",  # in-5 选型③道具
        "a1e2c3d4-0007-4a07-9e07-7d4a9c31a007",  # in-6 选型④美宣
        "a1e2c3d4-0008-4a08-9e08-7d4a9c31a008",  # in-7 选型⑤三视图
        "a1e2c3d4-0009-4a09-9e09-7d4a9c31a009",  # in-8 选型⑥高清人脸
        "a1e2c3d4-000a-4a0a-9e0a-7d4a9c31a00a",  # in-9 选型⑦分镜剧情图
        "a1e2c3d4-000b-4a0b-9e0b-7d4a9c31a00b",  # in-10 选型⑧表情差分
        "a1e2c3d4-000c-4a0c-9e0c-7d4a9c31a00c",  # in-11 选型⑨概念气氛图
        "a1e2c3d4-000d-4a0d-9e0d-7d4a9c31a00d",  # in-12 PE改写开关
        "a1e2c3d4-000e-4a0e-9e0e-7d4a9c31a00e",  # in-13 RGBA透明开关
        "b2f3a4c5-0001-4b01-8f01-3c5f81b56b01",  # out-0 positive
        "b2f3a4c5-0002-4b02-8f02-3c5f81b56b02",  # out-1 negative
        "b2f3a4c5-0003-4b03-8f03-3c5f81b56b03",  # out-2 prompt
    ]
    inputs = []
    for i, (name, typ) in enumerate(LINK_INPUTS):
        ids = {0: [1, 2], 1: [3, 4], 2: [5]}[i]
        inputs.append({"id": _IO_IDS[i], "name": name, "type": typ,
                       "linkIds": ids, "pos": [-196, -56 + 20 * i]})
    inputs.append({"id": _IO_IDS[3], "name": "主体句", "type": "STRING",
                   "linkIds": [6], "pos": [-196, 4]})
    for i, (name, _typ) in enumerate(WIDGET_INPUTS[1:9]):  # 8 选型开关(槽 4-11)
        inputs.append({"id": _IO_IDS[4 + i], "name": name, "type": "BOOLEAN",
                       "linkIds": [7 + i], "pos": [-196, 24 + 20 * i]})
    inputs.append({"id": _IO_IDS[12], "name": WIDGET_INPUTS[9][0], "type": "BOOLEAN",
                   "linkIds": [15], "pos": [-196, 184]})
    inputs.append({"id": _IO_IDS[13], "name": WIDGET_INPUTS[10][0], "type": "BOOLEAN",
                   "linkIds": [16], "pos": [-196, 204]})
    outputs = [
        {"id": _IO_IDS[14], "name": "positive", "type": "CONDITIONING",
         "linkIds": [41], "pos": [7384, -56]},
        {"id": _IO_IDS[15], "name": "negative", "type": "CONDITIONING",
         "linkIds": [42], "pos": [7384, -36]},
        {"id": _IO_IDS[16], "name": "prompt", "type": "STRING",
         "linkIds": [43], "pos": [7384, -16]},
    ]

    sg = {
        "id": SG_UUID,
        "version": 1,
        "state": {"lastGroupId": 14, "lastNodeId": 144, "lastLinkId": 43, "lastRerouteId": 0},
        "revision": 1,
        "config": {"defaultIOState": {}},
        "name": "[40] 道劫·装配子图(九型底座+通用锁层+四层装配+PE/RGBA 路由;双击进入)",
        "inputNode": {"id": -10, "bounding": [-300, -80, 128, 88]},
        "outputNode": {"id": -20, "bounding": [7260, -80, 128, 88]},
        "inputs": inputs,
        "outputs": outputs,
        "widgets": [truth["types"][0]["subject"], *[False] * 10],
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
            {"id": 2, "title": "道劫·主链(分辨率→潜空→[40]装配子图→采样→解码→保存;seed 外露在 [7])",
             "bounding": [-760, -480, 2860, 600], "color": "#3f789e", "flags": {}},
            {"id": 3, "title": "道劫·装配外露([24] 主体句=①层唯一手写位;型选择/PE/RGBA 开关在 [40] 子图面板;[27] 装配预览)",
             "bounding": [-780, 160, 2240, 400], "color": "#a1309b", "flags": {}},
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
            "id": 4, "type": "ResolutionSelector",
            "title": "[4] 道劫·分辨率选择(九型画幅联动,档位表见 Note;默认①人物 3:4·4.2MP)",
            "pos": [-700, -400], "size": [320, 190], "flags": {}, "order": 3, "mode": 0,
            "inputs": [],
            "outputs": [
                {"name": "width", "type": "INT", "links": [1]},
                {"name": "height", "type": "INT", "links": [2]},
            ],
            "properties": {"Node name for S&R": "ResolutionSelector"},
            "widgets_values": [types[0]["aspect"], types[0]["mp"], 8],
        },
        {
            "id": 5, "type": "EmptyLatentImage",
            "title": "[5] 道劫·空潜空(宽高接 [4])",
            "pos": [-280, -400], "size": [330, 110], "flags": {}, "order": 4, "mode": 0,
            "inputs": [
                {"name": "width", "type": "INT", "widget": {"name": "width"}, "link": 1},
                {"name": "height", "type": "INT", "widget": {"name": "height"}, "link": 2},
            ],
            "outputs": [{"name": "LATENT", "type": "LATENT", "links": [5]}],
            "properties": {"Node name for S&R": "EmptyLatentImage"},
            "widgets_values": [1024, 1024, 1],
        },
        {
            "id": 7, "type": "KSampler",
            "title": "[7] 道劫·KSampler(25步·cfg1;seed 外露)",
            "pos": [880, -400], "size": [330, 260], "flags": {}, "order": 6, "mode": 0,
            "inputs": [
                {"name": "model", "type": "MODEL", "link": 8},
                {"name": "positive", "type": "CONDITIONING", "link": 16},
                {"name": "negative", "type": "CONDITIONING", "link": 17},
                {"name": "latent_image", "type": "LATENT", "link": 5},
            ],
            "outputs": [{"name": "LATENT", "type": "LATENT", "links": [9]}],
            "properties": {"Node name for S&R": "KSampler"},
            "widgets_values": [0, "fixed", 25, 1, "euler", "simple", 1],
        },
        {
            "id": 8, "type": "VAEDecode",
            "title": "[8] 道劫·VAE解码",
            "pos": [1300, -400], "size": [240, 50], "flags": {}, "order": 7, "mode": 0,
            "inputs": [
                {"name": "samples", "type": "LATENT", "link": 9},
                {"name": "vae", "type": "VAE", "link": 10},
            ],
            "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [11]}],
            "properties": {"Node name for S&R": "VAEDecode"},
        },
        {
            "id": 9, "type": "SaveImage",
            "title": "[9] 道劫·保存",
            "pos": [1620, -400], "size": [380, 330], "flags": {}, "order": 8, "mode": 0,
            "inputs": [{"name": "images", "type": "IMAGE", "link": 11}],
            "outputs": [],
            "properties": {"Node name for S&R": "SaveImage"},
            "widgets_values": ["QI21道劫文生图_"],
        },
        {
            "id": 10, "type": "MarkdownNote",
            "title": "[10] 道劫·用法速查(装配子图版·九型底座 09-23 美化)",
            "pos": [-1980, 620], "size": [900, 1500], "flags": {}, "order": 9, "mode": 0,
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
            "pos": [-700, 200], "size": [661, 200], "flags": {}, "order": 11, "mode": 0,
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

    # 宿主 [40](widget 型子图输入=宿主面板;序列化口径=blueprints 实证+K2 1.53 存档)
    host_inputs = [
        {"name": "clip", "type": "CLIP", "link": 12},
        {"name": "vae", "type": "VAE", "link": 13},
        {"name": "pe_clip", "type": "CLIP", "link": 14},
        {"name": "主体句", "type": "STRING", "widget": {"name": "主体句"}, "link": 15},
    ]
    for name, _typ in WIDGET_INPUTS[1:]:
        host_inputs.append({"name": name, "type": "BOOLEAN", "widget": {"name": name}, "link": None})
    host = {
        "id": HOST_ID, "type": SG_UUID,
        "title": f"[{HOST_ID}] 道劫·装配子图(双击=九型底座+锁层恒挂+四层装配+PE/RGBA 路由;面板=型选择/PE/RGBA 开关)",
        "pos": [200, -400], "size": [560, 480], "flags": {}, "order": 13, "mode": 0,
        "inputs": host_inputs,
        "outputs": [
            {"name": "positive", "type": "CONDITIONING", "links": [16]},
            {"name": "negative", "type": "CONDITIONING", "links": [17]},
            {"name": "prompt", "type": "STRING", "links": [18]},
        ],
        "properties": {"subgraph": SG_UUID, "previewExposures": []},
        "widgets_values": [types[0]["subject"], *[False] * 10],
        "widgets_values_named": {name: (types[0]["subject"] if i == 0 else False)
                                 for i, (name, _t) in enumerate(WIDGET_INPUTS)},
    }
    nodes.append(host)
    for order, n in enumerate(nodes):
        n["order"] = order
    g["nodes"] = nodes

    g["links"] = [
        [1, 4, 0, 5, 0, "INT"],
        [2, 4, 1, 5, 1, "INT"],
        [5, 5, 0, 7, 3, "LATENT"],
        [8, 1, 0, 7, 0, "MODEL"],
        [9, 7, 0, 8, 0, "LATENT"],
        [10, 3, 0, 8, 1, "VAE"],
        [11, 8, 0, 9, 0, "IMAGE"],
        [12, 2, 0, HOST_ID, 0, "CLIP"],
        [13, 3, 0, HOST_ID, 1, "VAE"],
        [14, 11, 0, HOST_ID, 2, "CLIP"],
        [15, SUBJECT_ID, 0, HOST_ID, 3, "STRING"],
        [16, HOST_ID, 0, 7, 1, "CONDITIONING"],
        [17, HOST_ID, 1, 7, 2, "CONDITIONING"],
        [18, HOST_ID, 2, PREVIEW_ID, 0, "STRING"],
    ]
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
        if n["type"] != "MarkdownNote" and "道劫" not in (n.get("title") or ""):
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
    if host["widgets_values"] != [truth["types"][0]["subject"], *[False] * 10]:
        errs.append("[40] 宿主 widgets_values 应=[人物例一主体句, False×10](型选择/PE/RGBA 全默认关)")

    # 6. 外部接线:加载器/主体句→宿主;宿主→KSampler/预览
    ext_want = [
        (12, 2, 0, HOST_ID, 0, "CLIP"), (13, 3, 0, HOST_ID, 1, "VAE"),
        (14, 11, 0, HOST_ID, 2, "CLIP"), (15, SUBJECT_ID, 0, HOST_ID, 3, "STRING"),
        (16, HOST_ID, 0, 7, 1, "CONDITIONING"), (17, HOST_ID, 1, 7, 2, "CONDITIONING"),
        (18, HOST_ID, 2, PREVIEW_ID, 0, "STRING"),
    ]
    got = {(l[0], l[1], l[2], l[3], l[4], l[5]) for l in g["links"]}
    for w in ext_want:
        if w not in got:
            errs.append(f"外部接线缺: link{w[0]} {[x for x in w[1:]]}")

    # 7. 九底座:两两唯一 + 逐字=库「美化版②(+增量锁B)+④配色行」;锁层A 恒挂逐字=库
    const_texts = [i_nodes[cid]["widgets_values"][0] for cid in CONST_IDS]
    if len(set(const_texts)) != 9:
        errs.append("九型底座常量两两不唯一")
    for t, cid, text in zip(truth["types"], CONST_IDS, const_texts):
        if text != t["constant_text"]:
            errs.append(f"底座[{cid}]{t['zh']} 与库②层(美化版)装配不逐字一致")
        has_b = "衣褶/裙摆：使用宽幅平静布面" in text
        if (t["zh"] in CHAR_TYPES) != has_b:
            errs.append(f"底座[{cid}]{t['zh']} 常量B增量锁挂载错型(人物系六型应含)")
        if "细墨线" not in text or "提按顿挫" not in text:
            errs.append(f"底座[{cid}]{t['zh']} 缺美化版底座锚词(细墨线/提按顿挫)")
    if i_nodes[LOCK_ID]["widgets_values"][0] != truth["const_a"]:
        errs.append("[110] 通用锁层常量A 与库首节常量不逐字一致")
    lock_link = i_links[i_nodes[LOCK_ID]["outputs"][0]["links"][0]]
    if lock_link["target_id"] != CONCAT2_ID:
        errs.append("[110] 应恒挂直连拼接②(不随型走开关)")

    # 8. 级联九路:八级开关 switch 槽接 -10(宿主面板);S1.on_false=C①;
    #    S_k.on_true=C{k+2}型;前级输出接后级 on_false;末梢喂拼接①
    for i, sid in enumerate(SWITCH_IDS):
        sw = i_nodes[sid]
        sw_link = i_links[sw["inputs"][2]["link"]]
        if sw_link["origin_id"] != -10 or sw_link["origin_slot"] != 4 + i:
            errs.append(f"[{sid}] 选型开关 switch 槽未接 -10 槽{4 + i}(宿主面板选型值)")
        false_src = i_links[sw["inputs"][0]["link"]]
        want_false = CONST_IDS[0] if i == 0 else SWITCH_IDS[i - 1]
        if false_src["origin_id"] != want_false:
            errs.append(f"[{sid}].on_false 上游应为 {'C①人物' if i == 0 else f'前级[{SWITCH_IDS[i-1]}]'}")
        true_src = i_links[sw["inputs"][1]["link"]]
        if true_src["origin_id"] != CONST_IDS[i + 1]:
            errs.append(f"[{sid}].on_true 上游应为型常量[{CONST_IDS[i + 1]}]")
    if i_links[i_nodes[CONCAT1_ID]["inputs"][1]["link"]]["origin_id"] != SWITCH_IDS[-1]:
        errs.append("拼接①.string_b 上游应为级联末梢")

    # 9. 干跑谓词(静态 graphToPrompt 等价):默认态(全开关 false)沿 KSampler 四输入解析
    origins, assembled = _dry_run_default(g, sg)
    if sorted(origins) != sorted([CONST_IDS[0], LOCK_ID]):
        errs.append(f"干跑:子图内默认 StringConstant 源应=[{CONST_IDS[0]}]底座/[{LOCK_ID}]锁层,得 {sorted(origins)}")
    want = "\n".join([truth["types"][0]["subject"], truth["types"][0]["constant_text"], truth["const_a"]])
    if assembled != want:
        errs.append("干跑:默认装配全文与库人物型四层组合不逐字一致")

    # 10. PE/RGBA 承袭:类名/参数/默认旁路;懒执行(开关 false 时 on_true 不在默认源)
    pe = i_nodes[PE_RW_ID]
    if pe["widgets_values"] != [PE_SEED_PROMPT, *PE_PARAMS]:
        errs.append("PE 改写组参数漂移")
    pe_clip = [n for n in g["nodes"] if n["type"] == "CLIPLoader" and n["widgets_values"][0] == PE_CLIP_FILE]
    if len(pe_clip) != 1:
        errs.append("PE 专属 CLIPLoader 缺失(应在主图加载器组)")
    p = i_nodes[TE_RGBA_ID]["widgets_values"][0]
    if not (p.startswith(RGBA_HEAD) and p.endswith(RGBA_TAIL)):
        errs.append("RGBA 编码默认 prompt 非官方包裹句式")
    if host["widgets_values"][9] is not False or host["widgets_values"][10] is not False:
        errs.append("[40] 面板 PE/RGBA 开关默认必须 false")
    if PE_RW_ID in origins:
        errs.append("干跑:默认态 PE 改写不应在装配源内(懒执行旁路)")
    if TE_RGBA_ID in _dry_run_reachable(g, sg):
        errs.append("干跑:默认态 RGBA 编码不应可达(懒执行旁路)")

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
    for token in ("cfg 恒 1", "RGBA format image with transparency", "qwen-image-2-1-prompter",
                  "05-道劫规范提示词库.md", "九型", "空镜无人", "重置回库文档现读值",
                  "[27]", "恒挂", "美化"):
        if token not in note:
            errs.append(f"说明 Note 缺要点: {token!r}")
    if note.lstrip().startswith("# "):
        errs.append("说明 Note 以一级大标题开幅(禁横幅)")
    return errs


def _dry_run_default(g: dict, sg: dict) -> tuple[set[int], str]:
    """静态干跑:默认态(八级选型/PE/RGBA 全 false)装配文本溯源。

    模拟 graphToPrompt 转换路:宿主输入有外链则进主图解析,widget 型取宿主
    widgets_values;子图内部沿 link 解析;ComfySwitchNode 懒执行=只走 on_false。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    i_nodes = {n["id"]: n for n in sg["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    i_links = {l["id"]: l for l in sg["links"]}
    host = m_nodes[HOST_ID]

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
            return texts
        src = i_nodes[l["origin_id"]]
        if src["type"] == "StringConstant":
            texts.append(src["widgets_values"][0])
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
    origins = {nid for nid in reach if i_nodes[nid]["type"] == "StringConstant"}
    return origins, "\n".join(texts)


def _dry_run_reachable(g: dict, sg: dict) -> set[int]:
    """干跑:KSampler 四输入在默认态可达的子图内部节点集合(懒执行验证)。

    宿主输出槽→内部 -20 供给节点;宿主 widget 输入槽→内部 -10 消费节点;
    ComfySwitchNode 只走 on_false。"""
    m_nodes = {n["id"]: n for n in g["nodes"]}
    i_nodes = {n["id"]: n for n in sg["nodes"]}
    m_links = {l[0]: l for l in g["links"]}
    i_links = {l["id"]: l for l in sg["links"]}
    host = m_nodes[HOST_ID]
    reach_main: set[int] = set()
    reach_int: set[int] = set()

    def walk_main(nid: int):
        if nid in reach_main:
            return
        reach_main.add(nid)
        for inp in m_nodes[nid].get("inputs", []):
            lid = inp.get("link")
            if lid is None:
                continue
            ml = m_links[lid]
            if ml[1] == HOST_ID:
                walk_host_output(ml[2])
            else:
                walk_main(ml[1])

    def walk_host_output(oslot: int):
        for l in sg["links"]:
            if l["target_id"] == -20 and l["target_slot"] == oslot:
                walk_int(l["origin_id"])

    def walk_host_input(islot: int):
        hi = host["inputs"][islot]
        if hi.get("link") is not None:
            walk_main(m_links[hi["link"]][1])
            return
        for l in sg["links"]:
            if l["origin_id"] == -10 and l["origin_slot"] == islot:
                walk_int(l["target_id"])

    def walk_int(nid: int):
        if nid in reach_int:
            return
        reach_int.add(nid)
        node = i_nodes[nid]
        slots = [0] if node["type"] == "ComfySwitchNode" else range(len(node.get("inputs", [])))
        for si in slots:
            lid = node["inputs"][si].get("link")
            if lid is None:
                continue
            l = i_links[lid]
            if l["origin_id"] == -10:
                walk_host_input(l["origin_slot"])
            else:
                walk_int(l["origin_id"])

    walk_main(7)  # KSampler
    return reach_int


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
    zh_list = " ".join(t["zh"] for t in truth["types"])
    print(f"PASS: 主图 {n_nodes} 节点/{n_links} 链 + 子图 {sg_nodes} 节点/43 链;九型={zh_list};"
          f"默认=①人物(干跑装配全文逐字=库组合);双向/横向/group int/子图 linkIds 逐项登记/"
          f"九底座逐字=库②层美化版/锁层A 恒挂/懒执行旁路/零孤儿全绿")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
