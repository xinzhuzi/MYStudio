# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. COMMERCIAL_LICENSE.md available.
"""MyQi21PromptSelect(最终文本合成器)契约测试(1001 S8 R7 集成轮裁定 A 拆件
形态=装配链下游件;1002 ⑭/⑰/Q4 接口批沿革;**10-02-qi21-subgraph-singleport
R1 单口化**——原两口「最终文本/透明文本」合一为单口「进编码文本」)。

锁(10 例=本役 6 例+既有契约 4 例随单口适配保留):

本役 6 例(design §1 钦定口径:四象限+预览实况+懒保持):
①pe关+透明关=装配全文 原样(直写路)+接口面锚(required 置空/optional 声明序
  ⑭ 两连线槽前置/头尾 W1 default 迁移锚 sha256 前16位/multiline 大框)
②pe开+透明关=PE出文 原样+pe开×PE出文未接线→中文 ValueError(不猜不代选)
③pe关+透明开=头句+装配全文+W1+尾句 逐字(Q4 两路同包 W1 保持)+装配全文
  未接线+pe关→降级空串→包裹=头句+"  "+W1+尾句(双空格形;裁定 A 自洽降级)
④pe开+透明开=头句+剥离(PE出文)+W1+尾句 逐字(词族整句消失+大小写不敏感+
  pattern 真源=数据文件现读)
⑤预览实况(R1 验收口径「预览=实况」):RETURN_TYPES 单 STRING 锚(防两口回潮)
  +四象限两口合一语义无损对拍(每象限期望值==原两口形对应出口:透明开=原
  透明文本口/透明关=原最终文本口,md5 同锚)+进编码文本 md5==预览 md5
  (单口=预览与进编码同一条文本,实弹 [401] 预览 md5 文证的件级同构)
⑥懒保持:check_lazy_status 四分支矩阵(pe关→[]/pe开+PE出文已接线未求值→
  请求名单/未接线缺键→[]绝不请求/已求值→放行)+名单纯字符串形(引擎
  execution.py:513-516 按 isinstance(x,str) 过滤,元组形被静默丢弃)
  +INPUT_TYPES「PE出文」lazy=True 声明锚(契约测试 _load_my_node_class
  动态消费的正是此两面,件改不得伤;懒成立条件=pe开关关(单口化后透明
  模式参与计算不改变消费面:透明开(pe关)只用装配全文,PE出文 仍零消费)。

既有契约 4 例(与出口形态无关,随单口解包适配保留):
⑦词族单源锁:strip_word_family 与 qi21_strip_lexicon.json 现读 pattern
  行为一致(case_insensitive 生效,与 [MyQi21PromptAssembly].BASE 无关)
⑧词库结构坏档锁(S8 深审 L-3):合法 JSON 缺键→同款 RuntimeError 中文兜底
  且不写缓存,同进程修文件即自愈(坏 dict 不得钉死缓存)
⑨(1002 ⑭)optional 化缺省兜底:pe开关 缺键=None→True(widget default
  同态,0926 裁定1 不漂)+签名全 default 不炸 TypeError
⑩(1002 ⑰)全部控件 tooltip 在位(大白话;头句=prd ⑰ 例文逐字)。

退役锁(R1 架构裁定随行):原「透明模式=False→透明文本仍产出」机械双产出锁
(R7.4 两口形态专属)退役——单口后选择边界自下游 [144] 闸门迁入本件,透明
模式 直接参与文本计算,透明关=正文原样直出(=①②所锁)。

1002 ⑭ 接口批:INPUT_TYPES required 置空,optional 声明序=装配全文/PE出文
(两连线槽前置)→pe开关/透明模式/头/尾/W1(五参数下沉);Q4 补强:pe关透明
路同包 W1 收束句(③⑨ 断言随行)。槽位映射表=任务档 research/slot-map.md。

加载纪律:importlib.util.spec_from_file_location 直载 nodes/ 文件(不 import
my_nodes 包)。
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path

# 被测模块直载(禁 import my_nodes 包;__file__ 生效→词库路径解析同产线)
_NODE_FILE = (Path(__file__).resolve().parents[1] / "nodes"
              / "my_qi21_prompt_select.py")
_spec = importlib.util.spec_from_file_location(
    "my_qi21_prompt_select_under_test", _NODE_FILE)
select = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(select)
MyQi21PromptSelect = select.MyQi21PromptSelect

# 三固定句 default 迁移锚(SHA256 前16位;迁入时对拍 1001 t2i 工作流
# [160]/[161]/[215] 现值;改值须同批过账更新)
_DEFAULT_ANCHORS = {
    "RGBA官方头句": "fe7eca21a0b8dd10",  # 原 [160] RGBA官方头句
    "RGBA官方尾句": "eb30fffec9f87437",  # 原 [161] RGBA官方尾句
    "W1收束句": "c17fba67932284ed",     # 原 [215] W1收束句
}
_LEXICON = json.loads((Path(__file__).resolve().parents[1] / "nodes"
                       / "qi21_strip_lexicon.json").read_text(encoding="utf-8"))

# 四象限共用例文(④剥离期望与 qi21_strip_lexicon.json pattern 行为绑定:
# "Misty mountains and clouds behind her." 整句属词族句被剥)
_ASSEMBLED = "装配全文例"
_PE_TEXT = "a lone cultivator. Misty mountains and clouds behind her. crisp edges."
_STRIPPED_PE = "a lone cultivator. crisp edges."
_QUADRANTS = [
    # (pe开关, 透明模式, PE出文, 期望单口文本, 说明)
    (False, False, None, _ASSEMBLED, "pe关+透明关=装配全文原样"),
    (True, False, _PE_TEXT, _PE_TEXT, "pe开+透明关=PE出文原样"),
    (False, True, None, "头句 装配全文例 W1句 尾句", "pe关+透明开=头+装配+W1+尾"),
    (True, True, _PE_TEXT, f"头句 {_STRIPPED_PE} W1句 尾句",
     "pe开+透明开=头+剥离(PE出文)+W1+尾"),
]


def _sha16(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _md5(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


def _compose_quadrant(pe开关: bool, 透明模式: bool, PE出文: str | None) -> str:
    node = MyQi21PromptSelect()
    got = node.compose(pe开关=pe开关, 透明模式=透明模式,
                       装配全文=_ASSEMBLED if PE出文 is None else "被忽略",
                       PE出文=PE出文, RGBA官方头句="头句", RGBA官方尾句="尾句",
                       W1收束句="W1句")
    assert isinstance(got, tuple) and len(got) == 1, \
        f"单口形=一元组,得 {got!r}"
    return got[0]


def test_1_pe_off_transparent_off_returns_assembled_verbatim():
    """四象限③(pe关+透明关):装配全文 原样直出(不包裹不剥离不拼 W1)。

    并锚 ⑭ 接口面(required 置空/optional 声明序/default 三锚/multiline)
    ——原两口形 test_1 接口面锁全数随单口迁入(输入面不动=R1 单口化只改
    出口面,拼接序铁律保持)。
    """
    node = MyQi21PromptSelect()
    got = node.compose(pe开关=False, 透明模式=False, 装配全文=_ASSEMBLED)
    assert got == (_ASSEMBLED,), \
        f"pe关+透明关→进编码文本应=装配全文原样,得 {got!r}"
    inputs = node.INPUT_TYPES()
    # 1002 ⑭:参数 widget 全迁 optional(连线槽装配全文/PE出文前置),锚随迁
    for name, anchor in _DEFAULT_ANCHORS.items():
        assert _sha16(inputs["optional"][name][1]["default"]) == anchor, \
            f"{name} default 迁移锚漂移(应 sha16={anchor})"
        assert inputs["optional"][name][1]["multiline"] is True, \
            f"Q4:{name} 应 multiline 大框"
    assert inputs["required"] == {}, "required 应置空(1002 ⑭ 连线槽前置重排)"
    assert list(inputs["optional"]) == ["装配全文", "PE出文", "pe开关", "透明模式",
                                        "RGBA官方头句", "RGBA官方尾句", "W1收束句"], \
        f"optional 声明序应=两连线槽前置+五参数下沉(⑭),得 {list(inputs['optional'])}"
    assert inputs["optional"]["pe开关"][1]["default"] is True, "pe开关默认应 true(0926 裁定1)"
    assert inputs["optional"]["透明模式"][1]["default"] is False


def test_2_pe_on_transparent_off_returns_pe_text_and_raises_without_wiring():
    """四象限④(pe开+透明关):PE出文 原样直出(PE 路正文,不包裹不剥离);
    pe开×PE出文未接线→中文 ValueError(不猜不代选,SpeedSelect 同款)。"""
    node = MyQi21PromptSelect()
    got = node.compose(pe开关=True, 透明模式=False, 装配全文=_ASSEMBLED,
                       PE出文="PE 出文例")
    assert got == ("PE 出文例",), \
        f"pe开+透明关→进编码文本应=PE出文原样(优化器路),得 {got!r}"
    try:
        node.compose(pe开关=True, 透明模式=False, 装配全文=_ASSEMBLED)
    except ValueError as exc:
        assert "PE出文" in str(exc) and "pe开关" in str(exc), \
            f"报错应中文指路(PE出文 未接线/关 pe开关),得 {exc}"
    else:
        raise AssertionError("pe开+PE出文未接线应 ValueError(不猜不代选)")


def test_3_pe_off_transparent_on_wraps_assembled_with_w1_and_degrades():
    """四象限②(pe关+透明开):头句+空格+装配全文+空格+W1收束句+空格+尾句
    逐字(Q4 两路同包 W1——grill 五问 Q4 裁定保持:pe关透明路不裸拼)。

    同锁降级象限:装配全文未接线+pe关→正文降级空串+中文 print 警告→包裹=
    头句+" "+空串+" "+W1+" "+尾句(双空格形;裁定 A 自洽降级语义)。
    """
    node = MyQi21PromptSelect()
    got = node.compose(pe开关=False, 透明模式=True, 装配全文=_ASSEMBLED,
                       RGBA官方头句="头句", RGBA官方尾句="尾句", W1收束句="W1句")
    assert got == ("头句 装配全文例 W1句 尾句",), \
        f"pe关+透明开→头句+装配全文+W1+尾句(Q4 同包 W1)逐字,得 {got!r}"
    degraded = node.compose(pe开关=False, 透明模式=True,
                            RGBA官方头句="头句", RGBA官方尾句="尾句",
                            W1收束句="W1句")
    assert degraded == ("头句  W1句 尾句",), \
        f"装配全文未接线+pe关→降级空串包裹=头句+空串+W1+尾句(双空格形),得 {degraded!r}"
    # pe开路不消费装配全文=缺键照常(PE出文为正文;隔离降级语义不外溢)
    pe_on = node.compose(pe开关=True, 透明模式=False, PE出文="PE 文")
    assert pe_on == ("PE 文",), "pe开路不消费装配全文=缺键照常出 PE出文"


def test_4_pe_on_transparent_on_strips_word_family_and_keeps_w1():
    """四象限①(pe开+透明开):头句+剥离(PE出文)+W1+尾句 逐字——剥离对象=
    PE出文(词族整句删,含 backgrounds 族句 "Misty mountains ... behind her."
    消失;pattern=数据文件现读,大小写由 case_insensitive 驱动)。"""
    node = MyQi21PromptSelect()
    got = node.compose(pe开关=True, 透明模式=True, 装配全文=_ASSEMBLED,
                       PE出文=_PE_TEXT, RGBA官方头句="头句", RGBA官方尾句="尾句",
                       W1收束句="W1句")
    assert "Misty mountains and clouds behind her." not in got[0], \
        f"词族整句(backgrounds 族)应被剥离,得 {got[0]!r}"
    assert "W1句" in got[0], "W1收束句应在场(剥离之后拼接)"
    assert got == (f"头句 {_STRIPPED_PE} W1句 尾句",), \
        f"pe开+透明开=头句+剥离文+W1+尾句 逐字,得 {got[0]!r}"
    # 大小写不敏感由数据文件驱动:大写词族句同样被剥(case_insensitive=true)
    upper = node.compose(pe开关=True, 透明模式=True,
                         PE出文="Keep this. DISTANT MOUNTAINS fade away. Keep that too.",
                         RGBA官方头句="头句", RGBA官方尾句="尾句", W1收束句="W1句")
    assert "DISTANT MOUNTAINS fade away." not in upper[0], \
        f"case_insensitive=true 应剥大写词族句,得 {upper[0]!r}"
    pattern = _LEXICON["pattern"]
    assert _LEXICON["case_insensitive"] is True
    assert "mountains?" in pattern and "backgrounds?" in pattern, \
        "剥离 pattern 真源=qi21_strip_lexicon.json(词边界匹配核对)"


def test_5_single_port_preview_is_live_and_two_port_merge_lossless():
    """预览实况(R1 验收口径):单口=预览与进编码同一条文本(所见即所进编码,
    透明开时预览含头尾);两口合一语义无损(每象限期望值==原两口形对应出口
    的 md5:透明开=原透明文本口/透明关=原最终文本口)+单 STRING 出口锚防回潮。
    """
    node = MyQi21PromptSelect()
    assert node.RETURN_TYPES == ("STRING",), \
        f"单口化:RETURN_TYPES 应单 STRING(R1),得 {node.RETURN_TYPES}"
    assert node.RETURN_NAMES == ("进编码文本",), \
        f"单口名应=「进编码文本」(R1),得 {node.RETURN_NAMES}"
    for pe开关, 透明模式, pe_text, expected, note in _QUADRANTS:
        got = _compose_quadrant(pe开关, 透明模式, pe_text)
        assert got == expected, \
            f"{note} 期望 {expected!r},得 {got!r}(拼接序铁律=design §1 逐字)"
        # 两口合一语义无损对拍:按透明模式选原两口形对应出口,逐字重构
        if 透明模式:
            mid = (select.strip_word_family(pe_text) if pe开关
                   else _ASSEMBLED) + " W1句"
            legacy = f"头句 {mid} 尾句"  # 原透明文本口(RETURN_NAMES 口1)
        else:
            legacy = pe_text if pe开关 else _ASSEMBLED  # 原最终文本口(口0)
        assert _md5(got) == _md5(legacy), \
            f"{note} 两口合一应无损:单口 md5={_md5(got)} 原两口对应出口 md5={_md5(legacy)}"
        # 预览=实况:进编码文本 md5==预览 md5(同一条文本;实弹 [401] 预览
        # md5==进编码文本 文证的件级同构=单口形态下不存在第二条预览文本)
        assert _md5(got) == _md5(expected), f"{note} 预览实况 md5 应同锚"


def test_6_lazy_protocol_preserved_unchanged():
    """懒保持:check_lazy_status 四分支矩阵原样+纯字符串名单+PE出文 lazy=True
    INPUT_TYPES 声明锚(契约测试 _load_my_node_class 动态消费的两面;单口化
    不改变消费面:PE出文 的消费仅由 pe开关 决定,透明模式参与计算后 pe关路
    仍零消费 PE出文——懒成立条件=pe开关关,协议零漂移)。"""
    node = MyQi21PromptSelect()
    assert node.check_lazy_status(pe开关=False, PE出文=None) == [], \
        "pe关→[]([140] 无人消费其输出→不进执行图,PE TE 零装载)"
    got = node.check_lazy_status(pe开关=True, PE出文=None)
    assert got == ["PE出文"], \
        f"pe开+PE出文已接线未求值(None)→请求名单,得 {got!r}"
    assert all(isinstance(x, str) for x in got), \
        "请求名单必须纯字符串形(引擎按 isinstance(x,str) 过滤,元组形被静默丢弃)"
    assert node.check_lazy_status(pe开关=True) == [], \
        "PE出文未接线(缺键)→[]绝不请求(未接线槽建强链=NodeInputError)"
    assert node.check_lazy_status(pe开关=True, PE出文="已求值") == [], \
        "PE出文已求值→放行(空名单)"
    # pe关×透明开=装配全文 包裹路,PE出文 仍零消费(单口化不外溢懒面)
    assert node.check_lazy_status(pe开关=False, PE出文=None, 透明模式=True) == [], \
        "pe关×透明开→[](透明路正文=装配全文,PE出文 零消费)"
    decl = node.INPUT_TYPES()["optional"]["PE出文"]
    assert (decl[1] or {}).get("lazy") is True, \
        f"PE出文 应保持 lazy=True 声明(懒协议锚),得 {decl}"
    assert hasattr(node, "check_lazy_status"), \
        "实名懒钩子 check_lazy_status 必须在位(引擎只认此名)"


def test_7_strip_uses_lexicon_file_single_source():
    pattern = _LEXICON["pattern"]
    assert _LEXICON["case_insensitive"] is True
    # 大小写不敏感由数据文件驱动:大写词族句同样被剥
    text = "Keep this. DISTANT MOUNTAINS fade away. Keep that too."
    stripped = select.strip_word_family(text)
    assert "DISTANT MOUNTAINS fade away." not in stripped, \
        f"case_insensitive=true 应剥大写词族句,得 {stripped!r}"
    # pattern 真源=数据文件(词边界匹配核对)
    assert "mountains?" in pattern and "backgrounds?" in pattern


def test_8_lexicon_valid_json_missing_keys_not_pinned_in_cache():
    """S8 深审 L-3:合法 JSON 缺键→同款 RuntimeError 中文兜底+不写缓存。

    坏档钉死缓存=修文件不自愈须重启引擎(L-3 根除项):缺键词表首调即
    RuntimeError(非裸 KeyError)且缓存保持 None;同进程修好文件后
    _load_lexicon 立即现读自愈。
    """
    with tempfile.TemporaryDirectory() as tmp:
        bad = Path(tmp) / "lexicon_bad.json"
        bad.write_text('{"foo": 1}', encoding="utf-8")  # 合法 JSON,缺两键
        real_path, real_cache = select._LEXICON_PATH, select._lexicon_cache
        try:
            select._LEXICON_PATH, select._lexicon_cache = bad, None
            try:
                select._load_lexicon()
            except RuntimeError as exc:
                assert "词族库" in str(exc) and "结构不合法" in str(exc), \
                    f"应同款 RuntimeError 中文兜底(结构不合法路),得 {exc}"
            else:
                raise AssertionError("缺键词表应 RuntimeError,非裸 KeyError/静默通过")
            assert select._lexicon_cache is None, \
                "坏 dict 不得写入缓存(钉死=修文件不自愈须重启,L-3)"
            # 同进程修好文件→自愈(缓存未钉死,下次调用现读)
            good = Path(tmp) / "lexicon_good.json"
            good.write_text(json.dumps({"pattern": "mountains?",
                                        "case_insensitive": True}),
                            encoding="utf-8")
            select._LEXICON_PATH = good
            got = select._load_lexicon()
            assert got == ("mountains?", True), \
                f"同进程修文件后应现读自愈,得 {got!r}"
        finally:
            select._LEXICON_PATH, select._lexicon_cache = real_path, real_cache


# ── ⑨ 1002 ⑭ optional 化缺省兜底(手写 API prompt 省略槽态) ──────────
def test_9_pe_switch_missing_defaults_true():
    """⑭ 随迁 optional 后 pe开关 可缺键(前端 widget 恒投递,仅手写 API prompt
    省略槽时可达)——兜底 True=widget default 同态(0926 裁定1「画布默认 PE
    开路」不随槽位搬家漂移);懒钩子同款兜底;签名全 default 不炸 TypeError。"""
    node = MyQi21PromptSelect()
    # 懒钩子:pe开关缺键(None)→按 True 处理→请求未求值的 PE出文
    assert node.check_lazy_status(PE出文=None) == ["PE出文"], \
        "pe开关缺省应兜底 True(钩子按 pe开请求 PE出文)"
    # compose:缺省 pe开关=True→PE 路语义(PE出文 有值即用)
    got = node.compose(PE出文="PE 文", 装配全文="装配全文例")
    assert got == ("PE 文",), "compose pe开关缺省应兜底 True(PE 路)"
    # 缺省 pe开关=True 而 PE出文 缺键=既有语义保持(中文 ValueError,不猜不代选)
    try:
        node.compose(装配全文="装配全文例")
    except ValueError as exc:
        assert "PE出文" in str(exc)
    else:
        raise AssertionError("pe开关缺省(True)+PE出文缺键应 ValueError(语义不随"
                             "槽位搬家漂移)")
    # pe关路全缺省:签名完整可调用(optional 化不炸 TypeError),降级空串+包裹
    got2 = node.compose(pe开关=False)
    assert got2 == ("",), "pe关路装配全文缺键→降级空串(既有语义;透明关=原样)"
    got3 = node.compose(pe开关=False, 透明模式=True)
    assert got3[0].startswith(select._RGBA_HEAD), "pe关+透明开→头句起头(Q4 包裹)"


def test_10_tooltips_present_plain_language():
    """⑰(1002 用户测试批):全部控件 tooltip 在位(大白话一行);头句 tooltip
    锁 prd ⑰ 例文口径(「教模型输出透明图的官方英文开头句,一般不用改」)。"""
    inputs = MyQi21PromptSelect().INPUT_TYPES()
    tips = {name: spec[1].get("tooltip")
            for group in ("required", "optional") for name, spec in inputs[group].items()}
    for name, tip in tips.items():
        assert isinstance(tip, str) and tip.strip(), f"{name} 应有非空 tooltip(⑰),得 {tip!r}"
    assert tips["RGBA官方头句"] == \
        "教模型输出透明图的官方英文开头句,一般不用改", "头句 tooltip=prd ⑰ 例文逐字"
    assert "总开关" in tips["pe开关"]
