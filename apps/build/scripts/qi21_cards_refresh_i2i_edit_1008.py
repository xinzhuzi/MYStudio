#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 卡片对账刷新 1008 第二役:i2i/edit 两张 [402] 用法速查变体卡清偿。

同日第一役(t2i [402]/[4100],qi21_cards_refresh_1008.py)完成后,本役清偿
余留两件:qi21-道劫-i2i.json(7709字)与 qi21-edit.json(6028字)的 [402]
用法速查卡——两卡均为单槽件(widgets_values 列表仅 1 槽,widgets_values_named
键不存在,python3 实测),无双槽复活陷阱,单槽即权威;card_text_mutate 照抄
第一役双槽两段式(单槽自然退化为直改)。

病根(两份审计 1008 定谳):
- i2i 卡=1002 单口时代文案:旧节点号([15]/[130]/[160]-[163])、旧档号体系
  (支路0/1/2 与降级档名)、旧档数口径(九选一,现役十档)、10-04/1005 已推翻
  的 RGBA 英文头尾句式、维护警示整节失效(生成器 qi21_daojie_i2i_0924.py
  停在 0930 形,重跑=打回旧结构)。
- edit 卡=七处散病:维护警示整节(0923 生成器已被四轮手术超越)、默认档仍写
  直出40步(实值=Fun-Acc 4步)、演进预研尾句迁移指导失效(t2i 已换
  MyQi21ApiPE 远程)、降级旧档号 0/1、默认指令缩写引文、控件名「PE开关」
  (实名「PE启用?」)、viggle 步数史实括注倒置。

落点(五树指纹扫描 1008 本役产,24 条旧串指纹):
- 数据副本 6 件=仓库×2 + 装机×2 + 构建产物×2(i2i/edit 各三副本);
- 引擎家 user/default/workflows 零 i2i/edit 副本(侧栏走 repo: id 只读合并,
  现树仅 1_文生图/qi21-道劫-t2i.json)——零落点零同步,不播种;
- custom_nodes/my-nodes/subgraphs 三件库件无卡文([402] 住根图,子图库件
  零 MarkdownNote,实测)=零落点;
- daojie-data(MA 播种区)零命中(只载 canon json,不载工作流)。
留档豁免(含旧串=历史,不动):campaigns/ 四件 + 退役生成器
qi21_daojie_i2i_0924.py/qwen21_edit_core_pe_0923.py/qi21_daojie_t2i_0923.py
+ 历史手术脚本 qi21_edit_funacc_surgery_1003.py + *.log。
非本域同族命中(不动):K2-文生图-道劫 两件/my_daojie_base.py/
daojie_canon_lib.py(K2 线九型口径仍真)/05-道劫规范提示词库.md(K2/qi21
共库)/漫影工作流清单.md(台账历史)。
test_qwen21_workflow_contract.py:2066 docstring「降级=切回 0/1 档」同族
漂移→随本役测试重锚改 1/2 档(断言 token 本身不动,全绿)。

DRY_RUN=1 只验串不写盘(默认 apply)。
"""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
REL_DIR = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图"

DRY = os.environ.get("DRY_RUN", "") == "1"


def family(rel: str) -> list[Path]:
    """三常驻副本(仓库/装机/构建)+ 引擎家用户区(在位才入家族,零播种)。"""
    repo = REPO / rel
    inst = Path("/Applications/漫影工作室.app/Contents/Resources") \
        / rel.replace("apps/backend/", "backend/", 1)
    build = REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources" \
        / rel.replace("apps/backend/", "backend/", 1)
    eng = Path.home() / "Library/Application Support/漫影工作室/comfyui/ComfyUI/user/default/workflows" \
        / rel.split("workflows/", 1)[1]
    fam = [repo, inst, build]
    if eng.exists():
        fam.append(eng)
    else:
        print(f"  [note] 引擎家无副本(零播种,repo: 只读合并态): {eng}")
    return fam


I2I_REL = f"{REL_DIR}/qi21-道劫-i2i.json"
EDIT_REL = f"{REL_DIR}/qi21-edit.json"

# ── i2i [402] 整节重写(切片=[节头, 下一节头);newBody 各带一个尾换行=保原文节间空行;
#    维护警示=末节,尾换行即卡尾原 \n) ──
I2I_SEC_RGBA_OLD = "### RGBA 透明图句式(存 PNG 才保 alpha;0929 S2 D6(1001 ① 改文案):[6] 面板「RGBA透明」三态=自动(默认,按型:道具/多视图/高清人脸/表情差分四型开,其余关)/强制开/强制关——旧「RGBA透明开关」布尔控件退役;型信号=MyQi21DaojieBase.rgba_default 槽喂 MyQi21RgbaSelect.rgba_hint,开关布尔=其输出单扇出 [153] 透明包裹器(10-02 单口化:透明模式参与文本计算,双编码+双开关已塌缩);PE×透明结构性已融合=PE-I2I 改写指令①层不替换装配文,四型②层声明恒在)"
I2I_SEC_RGBA_NEW = """### RGBA 透明图句式(存 PNG 才保 alpha;0929 S2 D6(1001 ① 改文案):[6] 面板「RGBA透明」三态=自动(默认,按型:道具/多视图/高清人脸/表情差分四型开,其余关)/true=强制开/false=强制关——旧「RGBA透明开关」布尔控件退役;型信号=MyQi21DaojieBase.透明值 槽(1002 ⑯ 起 rgba_default 出已删)喂 MyQi21RgbaSelect.rgba_hint,开关布尔=其输出单扇出 [153] 透明包裹器(10-02 单口化:透明模式参与文本计算,双编码+双开关已塌缩);PE×透明结构性已融合=PE-I2I 改写指令①层不替换装配文,四型②层声明恒在)

- **句式由 [153] 合成器内现拼**(10-04 中文化:头/尾/W1 真源=qi21_bases.json rgba 节热读,英文旧值备档 head_en/tail_en;1005 去重=中文声明二次插入已删;i2i 侧 [153] 恒 pe 关,正文=装配全文):
  头句「这是一张带有透明度的RGBA图像。」+ 装配全文 + W1收束句「主体呈现为干净的平面剪裁,单一独立素材完整保持在画幅内,四周被空白透明度包围,轮廓至边缘清晰完整不断裂。」+ 尾句「该图像具有alpha通道,背景是透明的。」
- 旧英文头尾(This is an RGBA format image…/The image has an alpha channel…)与「中文同款」双写句式已随 10-04 中文化退役;[160][161][162][163] 为 1001 集成轮前旧节点号,现役拼装全在 [153] 一件内。
- ⚠ 已知结构债(1005 复核在册债2 同族,本役审计坐实):本件 [4010] 实例仍是四出无「负面词」出槽,而节点源码 1007 起为五出(负面词=槽3/透明值=槽4);rgba_hint 连线(#55,origin_slot=3)在引擎按槽路由下运行时将取到「负面词」字符串,「自动」档恒真=全型恒开透明包裹。是否按型须实弹核验;修法=实例补五出+连线迁槽4(随 1005 案B i2i 推广役同批)。
"""

I2I_SEC_SPEED_OLD = "### 加速档单参考正源(0928 黑图修复;支路1/2 专用)"
I2I_SEC_SPEED_NEW = """### 加速档单参考正源(0928 黑图修复;viggle/Fun-Acc 两加速档专用)

- **实测事实(0928 实弹判别,七拍闭环)**:编码器同时吃双参考图(image_1 画布 1.5MP+image_2 参考 1.0MP)时,**viggle 6 步与 Fun-Acc 4 步两档少步蒸馏采样一律崩纯黑**(引擎报 success、尺寸对、全图唯一色=1);40 步直出档不受影响。单参考(仅 image_1)两加速档全真——viggle 单参考 105s/Fun-Acc 单参考 120s 出真图(结构相关 r=0.872)。
- **修复接线(0929 并行化后形,分线直入)**:子图行4 单参考编码 [171] 单编码独挑(10-02 单口化:主路 [4016][4017]+单路 [172][173] 双编码+双开关塌缩,透明/非透明选择已在 [153] 合成器内前置,词源与行3 同源)产出 positive_single;主图不再走 [185] 正源档位开关(随注入式机构拆除),改分线直入各支路:直出支路 [7010].positive=宿主 positive(双参考=「1 · 直出40步」档官方路零改动)/viggle·Fun-Acc 两档 [7012]/[7013].positive=宿主 positive_single(单参考)——正源差异内聚进各支路(0929 S3 起双正源经加速子图边界槽 positive/positive_single 分线直入,语义零改动)。
- [6] 恒执行(负面/latent 仍由其供,画幅随 image_1 不变);viggle/Fun-Acc 档选中时行4 编码亦入链(多一次视觉编码,约 +20s)。
- 默认档沿革:0927 裁定 Fun-Acc 默认→0929 拉齐轮暂 11(等效直出)→0929 并行化轮恢复 Fun-Acc(选择件 combo 首项)→0929 拉齐重放(用户 12:05 裁定)默认=直出40步等效→**1002 用户新令推翻拉齐重放:Fun-Acc 回 combo 首项「0 · Fun-Acc 4步」=现行默认**(直出40步居二,viggle 居三);直出档的双参考语义零改动。
"""

I2I_SEC_MAINT_OLD = "### 维护警示"
I2I_SEC_MAINT_NEW = """### 维护警示

**生成器已破,勿再重跑**:apps/build/scripts/qi21_daojie_i2i_0924.py(09-24 生,0930 S5 布局终排后停更)仍产 1002 前旧结构(内含 [4016]/[4017]/[172]/[173]/[130]/[15] 等 1001-1002 已替已删节点号,grep 命中 59 处);本件现结构=1001 同构集成手术+1002 单口化手术(装配子图 15 节点 34 线)+1003 甲案布局役+1005/1007 文本役逐轮手术所得,重跑生成器会把上述轮次全部打回旧结构。改本件=走新手术脚本单点改+契约测试重锚(家规:动前五树指纹扫描),「幂等再生成」通道已不存在。
"""

# ── i2i [402] 精准替换对(必须恰好命中 1 次) ────────────────────────────────
PAIRS_I2I = [
    ("生修合一·编辑流骨架+九型装配;i2i 09-24",
     "生修合一·编辑流骨架+十档装配(九型+自由,1001 P1 起;自由=无型底座仍挂锁层A);i2i 09-24"),
    ("子图内 [15] 指令开关(true=PE-I2I 看图改写=**默认 PE 改写**(0926 裁定1:多彩时代默认 PE 开路;false=直写=按图选配,单图手动关)——开关=[4012]『PE启用?』节点(PrimitiveBoolean,1002 ㉑;宿主面板同名控件外露,扇出合成器)",
     "子图内 [4012]『PE启用?』开关(PrimitiveBoolean,1002 ㉑;宿主面板同名控件外露,扇出 [4014] 合成器;true=PE-I2I 看图改写=**默认 PE 改写**(0926 裁定1:多彩时代默认 PE 开路),false=直写=指令原文进①层)"),
    ("改写输出直占 [130] 拼接①①层——**指令即主体**(0928 PE 迁子图轮:指令路径全程子图内)",
     "改写输出经 [4014] 择文合成器①占 [4011] 底料拼合的主体句位——**指令即主体**(0928 PE 迁子图轮:指令路径全程子图内)"),
    ("→ [130] 拼接①占①层。",
     "→ 占 [4011] 底料拼合主体句位。"),
    ("(ComfySwitchNode 懒执行,PE 模型不加载)",
     "([4014] PE出文 lazy 槽×check_lazy_status 懒执行,PE 模型不加载)"),
    ("面板「型选择」下拉九选一(默认①人物):人物/场景/道具/美宣/多视图/高清人脸/分镜剧情图/表情差分/概念气氛图——子图内",
     "面板「型选择」下拉十选一(默认①人物;1001 P1 起九型+自由):人物/场景/道具/美宣/多视图/高清人脸/分镜剧情图/表情差分/概念气氛图/自由(自由=无型底座,BASE 空串仍挂锁层A)——子图内"),
    ("(③层,库首节全文,全九型恒挂)",
     "(③层,库首节全文,全十档恒挂;[4011] 参数面 715 字与 qi21_bases.json lock_layer.positive_text 逐字一致=1007 负向式清退版)"),
    ("切「1 · viggle」或「0 · 直出40步」档",
     "切「2 · viggle」或「1 · 直出40步」档"),
    ("**支路0 直出([7010],子图行3)**",
     "**直出支路([7010],子图行3,combo「1 · 直出40步」)**"),
    ("**支路1 viggle([7011]→[7012],子图行2)**",
     "**viggle 支路([7011]→[7012],子图行2,combo「2 · viggle」)**"),
    ("支路2 Fun-Acc([7013],子图行1,主加速档=次序第二)",
     "Fun-Acc 支路([7013],子图行1,主加速档=combo 首项「0 · Fun-Acc 4步」)"),
    ("LoRA=少步数加速(支路1 自足)/Fun-Acc=PDD 4步采样(支路2 自足)",
     "LoRA=少步数加速(viggle 支路自足)/Fun-Acc=PDD 4步采样(Fun-Acc 支路自足)"),
    ("(0928 黑图修复铁则:支路0 双参考/加速两支路单参考,见下节)",
     "(0928 黑图修复铁则:直出支路双参考/两加速档单参考,见下节)"),
    ("显示将进编码的最终文本(指令+装配全文)。",
     "显示将进编码的最终文本([153] 终稿:PE 开=①层已是改写文的装配全文;透明开=外加 RGBA 头句+W1 收束+尾句)。"),
]

# ── edit [402] 整节重写(维护警示非末节,后随演进预研;newBody 尾换行=保节间空行) ──
EDIT_SEC_MAINT_OLD = "### 维护警示"
EDIT_SEC_MAINT_NEW = """### 维护警示

本件真源=仓库工作流 JSON 本身;旧生成器 apps/build/scripts/qwen21_edit_core_pe_0923.py 已被 1001 同构集成(qi21_integration_surgery_edit_1001.py)/1002 衔接批/1003 Fun-Acc 默认化/1005 预览分离各轮手术超越,其内置图谱仍是 0929 旧形(选择件 [58]/LoRA [31] strength 0.8/viggle [56] 359 步/默认直出40步/说明卡=节点 11)——**重跑即回退毁件,禁跑**。改本件=照 1008 t2i 卡对账先例写手术脚本(qi21_cards_refresh_1008.py 同款 card_text_mutate:DRY_RUN 验串每对恰命中一次,再 APPLY 写盘),契约测试 test_qwen21_workflow_contract.py(装配子图 9 件 census/边界槽序/加速面板值 [DEFAULT_MODE,0]/说明卡 [402] 置顶)与引擎家蓝图随改随锚;本卡仅 widgets_values 单槽(无命名槽),单槽即权威。
"""

# ── edit [402] 精准替换对(必须恰好命中 1 次) ────────────────────────────────
PAIRS_EDIT = [
    ("- 默认指令(中文单图,与 1003 m1z 实测逐字同):背景改水墨远山,人物服饰兵器姿态不变",
     "- 默认指令(中文单图,与 1003 m1z 实测逐字同):将<image1>中人物身后的背景改为云雾缭绕的水墨远山,留白取势;人物本体、服饰、兵器与姿态保持完全不变。"),
    ("——降级=切回 0/1 档。",
     "——降级=切回 1/2 档(1=直出40步/2=viggle;0=Fun-Acc 本档)。"),
    ("- 档0 的双参考语义零改动;加速子图宿主面板默认档=直出40步(正源走双参考 [4015])。",
     "- 直出档(现档1「1 · 直出40步」)双参考语义零改动;加速子图宿主面板默认档=「0 · Fun-Acc 4步」(1003 用户令改造,单参考正源 [4016],须配 PE启用?=开;双参考 [4015] 归直出档)。"),
    ("pe开关=宿主面板「PE开关」外露",
     "pe开关=宿主面板「PE启用?」同名联动([4012] 同名外露)"),
    ("viggle 支路 [7012]=6(官方荐档)(0929 拉齐值,原 6)",
     "viggle 支路 [7012]=6(官方荐档,1002 考据;原 359 系 TE-Speed 时代值)"),
    ("t2i/道劫线暂为 benjiyaya QwenImage21_T2IPromptRewrite(pe_t2i 系检查点)——同检查点族同宪法同 JSON 字段,道劫换核心时照本件五件套抄。",
     "t2i/道劫线已于 1007-1008 换 MyQi21ApiPE(LM Studio Windows 远程 9B,本机 TextGenerate 出局),i2i 装配子图已入 [4010] 底座/[4011] 装配器过渡——道劫系后续迁远程照 t2i 新五件套([4010]底座/[4013]ApiPE/[4014]FinalOutput/三真源)抄,勿再照本件本机五件套抄。"),
]

# ── 终验锚:新串必在 / 退役串必不在(仅查两卡卡文,豁免区另计) ─────────────────
ANCHORS_I2I = [
    "十档装配(九型+自由", "[4012]『PE启用?』开关", "占 [4011] 底料拼合主体句位",
    "check_lazy_status 懒执行,PE 模型不加载", "下拉十选一", "全十档恒挂",
    "「2 · viggle」或「1 · 直出40步」", "主加速档=combo 首项「0 · Fun-Acc 4步」",
    "生成器已破,勿再重跑", "已知结构债", "[153] 终稿:PE 开=①层已是改写文的装配全文",
]
ABSENT_I2I = [
    "[15] 指令开关", "直占 [130]", "[130] 拼接①占①层", "ComfySwitchNode 懒执行",
    "下拉九选一", "全九型恒挂", "支路0", "支路1", "支路2", "档0",
    "rgba_default 槽喂", "中文同款:", "This is an RGBA format image with transparency",
    "全量再生成(幂等", "次序第二",
]  # 注:「中文同款」/英文头句在 newBody 里以退役点名形合法在场,探针取旧句精确形
ANCHORS_EDIT = [
    "将<image1>中人物身后的背景改为云雾缭绕的水墨远山,留白取势",
    "切回 1/2 档(1=直出40步/2=viggle;0=Fun-Acc 本档)",
    "默认档=「0 · Fun-Acc 4步」(1003 用户令改造", "「PE启用?」同名联动",
    "原 359 系 TE-Speed 时代值", "换 MyQi21ApiPE", "重跑即回退毁件,禁跑",
]
ABSENT_EDIT = [
    "背景改水墨远山,人物服饰兵器姿态不变", "切回 0/1 档", "档0 的双参考",
    "「PE开关」外露", "拉齐值,原 6", "照本件五件套抄", "全量再生成(幂等",
    "默认档=直出40步",
]


def fail(msg):
    print("ABORT:", msg)
    sys.exit(1)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def card_text_mutate(node, pairs, sec_pairs, label):
    """双槽同改:ComfyUI 新序列化同时存 widgets_values(列表)与
    widgets_values_named(字典)两份卡文——只改其一=旧文从命名槽复活。
    双槽不一致时以能吃下全部配对的现役版为基准,术后双槽逐字镜像。
    (本役两卡均单槽:holders 仅列表 1 槽,自然退化为直改。)"""
    holders = []
    wv = node.get("widgets_values")
    if isinstance(wv, list):
        holders += [(wv, i) for i, v in enumerate(wv)
                    if isinstance(v, str) and len(v) > 300]
    wvn = node.get("widgets_values_named")
    if isinstance(wvn, dict):
        holders += [(wvn, k) for k, v in wvn.items()
                    if isinstance(v, str) and len(v) > 300]
    if not holders:
        fail(f"{label}: 卡文槽定位失败(无 >300 字串槽)")
    raws = [cont[key] for cont, key in holders]

    def transform(t: str) -> str:
        for old, new in sec_pairs:
            start = t.find(old)
            if start < 0:
                raise ValueError(f"节头未命中 {old[:40]!r}")
            end = t.find("\n### ", start)
            if end < 0:
                end = t.find("\n## ", start)
            if end < 0:
                end = len(t)
            t = t[:start] + new + t[end:]
        for old, new in pairs:
            c = t.count(old)
            if c != 1:
                raise ValueError(f"配对命中 {c} 次(须1): {old[:50]!r}")
            t = t.replace(old, new)
        return t

    outs = []
    try:
        for (cont, key), raw in zip(holders, raws):
            outs.append((cont, key, transform(raw)))
        if len({o[2] for o in outs}) == 1:
            for cont, key, t in outs:
                cont[key] = t
            if len(holders) > 1:
                print(f"  {label}: 双槽({len(holders)})同改一致 ✓")
            else:
                print(f"  {label}: 单槽直改({len(raws[0])}字) ✓")
            return outs[0][2]
    except ValueError:
        pass
    # 回退:命名槽滞留旧版——以唯一能吃下全部探串的现役版为基准,术后双槽逐字镜像
    probes = [o for o, _ in sec_pairs] + [o for o, _ in pairs]
    bases = [r for r in set(raws) if all(p in r for p in probes)]
    if len(bases) != 1:
        fail(f"{label}: 双槽互异且基准不唯一 lens={sorted(map(len, set(raws)))}")
    t = transform(bases[0])
    for cont, key in holders:
        cont[key] = t
    print(f"  {label}: 命名槽滞留旧版(lens={sorted(map(len, raws))})→镜像现役版 ✓")
    return t


def load_402(p: Path):
    d = json.loads(p.read_text(encoding="utf-8"))
    n402 = [n for n in d["nodes"] if n.get("id") == 402]
    if len(n402) != 1 or n402[0].get("type") != "MarkdownNote":
        fail(f"{p}: 定位 [402] MarkdownNote 失败(得 {len(n402)} 件)")
    return d, n402[0]


def run_card(rel, sec_pairs, pairs, anchors, absent, label):
    targets = family(rel)
    # ── 前置:家族副本现 md5 一致(防覆写异版;并行在途冲突即在此炸出) ──
    sigs = {md5(p) for p in targets}
    missing = [str(p) for p in targets if not p.exists()]
    if missing:
        fail(f"{label}家族缺副本: {missing}")
    if len(sigs) != 1:
        for p in targets:
            print("  ", md5(p), p)
        fail(f"{label}家族副本不一致,先查明再动")
    print(f"[pre] {label} {len(targets)} 副本 md5 一致 ✓")

    d, n402 = load_402(targets[0])
    text = card_text_mutate(n402, pairs, sec_pairs, label)
    for a in anchors:
        if a not in text:
            fail(f"{label} 新锚缺失: {a!r}")
    for a in absent:
        if a in text:
            fail(f"{label} 退役串残留: {a!r}")
    print(f"[verify] {label} 新锚 {len(anchors)} 全在 / 退役串 {len(absent)} 全无 ✓")

    if DRY:
        return text

    targets[0].write_text(
        json.dumps(d, ensure_ascii=False, indent=2, separators=(",", ": ")),
        encoding="utf-8")
    for dst in targets[1:]:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(targets[0], dst)
        if md5(dst) != md5(targets[0]):
            fail(f"同步校验失败: {dst}")
    print(f"[sync] {label} 家族 {len(targets)} 副本已同 md5 ✓")
    return text


def main():
    t_i2i = run_card(I2I_REL,
                     [(I2I_SEC_RGBA_OLD, I2I_SEC_RGBA_NEW),
                      (I2I_SEC_SPEED_OLD, I2I_SEC_SPEED_NEW),
                      (I2I_SEC_MAINT_OLD, I2I_SEC_MAINT_NEW)],
                     PAIRS_I2I, ANCHORS_I2I, ABSENT_I2I, "[402/i2i]")
    t_edit = run_card(EDIT_REL,
                      [(EDIT_SEC_MAINT_OLD, EDIT_SEC_MAINT_NEW)],
                      PAIRS_EDIT, ANCHORS_EDIT, ABSENT_EDIT, "[402/edit]")
    if DRY:
        print(f"[dry] 验串全过:i2i={len(t_i2i)}字 edit={len(t_edit)}字(未写盘)")
        return
    # ── 终验:全家族 JSON 可解析 ──
    for rel in (I2I_REL, EDIT_REL):
        for p in family(rel):
            json.loads(p.read_text(encoding="utf-8"))
    print("[verify] 全家族 JSON 合法 ✓")


if __name__ == "__main__":
    main()
