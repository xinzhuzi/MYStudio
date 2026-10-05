# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. COMMERCIAL_LICENSE.md available.
"""MyQi21PromptSelect(最终文本合成器)契约测试(1001 S8 R7 集成轮裁定 A 拆件
形态=装配链下游件;10-02 R1 单口化→**10-04 双口化**(「进编码文本」拆
「进编码正向/负向文本」,9 槽 4 占位 wv 形)→**1005 案B Phase I 重锚**:
pe开路负向一行对调=直写优先(负面词直写 非空恒胜,PE负面 仅空档兜底——
修 PE 编造词顶掉锁层/型层真负面断路,design §8.1 ③)。

锁:

本役重锚 6 例(10-04 双口+1005 案B口径):
①pe关+透明关=装配全文 原样(直写路)+接口面锚(required 置空/optional 声明序
  ⑭ 四连线槽前置/头尾 W1 default=qi21_bases.json rgba 节现读/multiline 大框)
②pe开+透明关=PE出文 原样+pe开×PE出文未接线→中文 ValueError(不猜不代选)
  +案B:pe开负向=直写非空恒胜/空档兜底 PE负面
③pe关+透明开=头句+装配全文+W1+尾句 逐字(1005 用户令去重:R1 中文透明声明
  插入已删,声明逐字=头+尾拼接头尾转中文后即重复;Q4 同包 W1)
  +降级双空格形+负向不随透明包裹(pe关负向=直写)
④pe开+透明开=头句+剥离(PE出文)+W1+尾句 逐字(词族真源=qi21_bases.json
  #strip_lexicon 现读)+负向不剥离不包裹(案B 同胜)
⑤双口形状锚(RETURN_TYPES/NAMES=进编码正向/负向文本)+四象限两口期望对拍
⑥懒保持:check_lazy_status 四分支矩阵(pe关→[]/pe开+PE出文已接线未求值→
  请求名单/未接线缺键→[]绝不请求/已求值→放行)+名单纯字符串形
  +PE出文/PE负面 lazy=True 声明锚(1004 双懒槽,案B 不改懒面:PE负面 值
  降为兜底但求值请求照旧——漏请求=None 静默错路)

既有契约 3 例(数据面,随集中化保留):
⑦词族单源锁:strip_word_family 与 qi21_bases.json#strip_lexicon 节
  现读行为一致(1004 集中地令)
⑧词库结构坏档锁(S8 深审 L-3):缺节→RuntimeError 中文兜底不写缓存,
  同进程修文件即自愈
⑨optional 化缺省兜底:pe开关 缺键=None→True+签名全 default 不炸
⑩全部控件 tooltip 在位(大白话;头句 tooltip=中文真源口径;案B 两负向槽
  tooltip 语义锚:直写「优先」/PE负面「兜底」)
⑪(1005 案B 新锚)负向路由矩阵五路:pe开直写胜/pe开空档兜底/pe开双空=
  空负向/pe关直写/缺键同空串。

加载纪律:importlib.util.spec_from_file_location 直载 nodes/ 文件(不 import
my_nodes 包)。
"""

from __future__ import annotations

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

# 三固定句 default 真源(10-04 随库中文化):=qi21_bases.json rgba 节现读
# (单源对拍形态,同 _LEXICON;旧 sha16 英文锚随 Phase B 中文化废止——真源
# 家热改数据即所见,契约测试另钉工作流 wv 逐字)
_RGBA = json.loads(select._BASES_JSON.read_text(encoding="utf-8"))["rgba"]
# 词族真源=qi21_bases.json#strip_lexicon 节(1004 集中地令;旧
# qi21_strip_lexicon.json=留档件,产线不再消费)
_LEXICON = json.loads(select._BASES_JSON.read_text(
    encoding="utf-8"))["strip_lexicon"]

# 四象限共用例文(④剥离期望与 qi21_bases.json#strip_lexicon en 词族行为绑定:
# "Misty mountains and clouds behind her." 整句属词族句被剥)
_ASSEMBLED = "装配全文例"
_PE_TEXT = "a lone cultivator. Misty mountains and clouds behind her. crisp edges."
_STRIPPED_PE = "a lone cultivator. crisp edges."
_DIRECT_NEG = "直写负面例"
_PE_NEG = "PE负面例"


def _compose_quadrant(pe开关: bool, 透明模式: bool, PE出文: str | None,
                      负面词直写: str | None = _DIRECT_NEG,
                      PE负面: str | None = None) -> tuple[str, str]:
    node = MyQi21PromptSelect()
    got = node.compose(pe开关=pe开关, 透明模式=透明模式,
                       装配全文=_ASSEMBLED if PE出文 is None else "被忽略",
                       PE出文=PE出文, 负面词直写=负面词直写, PE负面=PE负面,
                       RGBA官方头句="头句", RGBA官方尾句="尾句", W1收束句="W1句")
    assert isinstance(got, tuple) and len(got) == 2, \
        f"双口形=二元组(10-04 Phase B),得 {got!r}"
    return got


def test_1_pe_off_transparent_off_returns_assembled_verbatim():
    """四象限(pe关+透明关):进编码正向=装配全文 原样直出(不包裹不剥离不拼
    W1)+进编码负向=负面词直写。

    并锚 ⑭ 接口面(required 置空/optional 声明序 9 槽/default 三锚=rgba 节
    现读/multiline)。
    """
    node = MyQi21PromptSelect()
    got = node.compose(pe开关=False, 透明模式=False, 装配全文=_ASSEMBLED,
                       负面词直写=_DIRECT_NEG)
    assert got == (_ASSEMBLED, _DIRECT_NEG), \
        f"pe关+透明关→(装配全文原样, 负面词直写),得 {got!r}"
    inputs = node.INPUT_TYPES()
    # 2002 ⑭+10-04 双口化:参数 widget 全迁 optional(四连线槽前置),锚随迁
    for name, live in (("RGBA官方头句", _RGBA["head"]),
                       ("RGBA官方尾句", _RGBA["tail"]),
                       ("W1收束句", _RGBA["w1_closing"])):
        assert inputs["optional"][name][1]["default"] == live, \
            f"{name} default 应=qi21_bases.json rgba 节现读(10-04 中文化)"
        assert inputs["optional"][name][1]["multiline"] is True, \
            f"Q4:{name} 应 multiline 大框"
    assert inputs["required"] == {}, "required 应置空(2002 ⑭ 连线槽前置重排)"
    assert list(inputs["optional"]) == ["装配全文", "负面词直写", "PE出文", "PE负面",
                                        "pe开关", "透明模式",
                                        "RGBA官方头句", "RGBA官方尾句", "W1收束句"], \
        f"optional 声明序应=四连线槽前置+五参数下沉(⑭+10-04 负向拆开),得 {list(inputs['optional'])}"
    assert inputs["optional"]["pe开关"][1]["default"] is True, "pe开关默认应 true(0926 裁定1)"
    assert inputs["optional"]["透明模式"][1]["default"] is False


def test_2_pe_on_transparent_off_returns_pe_text_and_raises_without_wiring():
    """四象限(pe开+透明关):进编码正向=PE出文 原样直出(PE 路正文,不包裹
    不剥离);pe开×PE出文未接线→中文 ValueError(不猜不代选,SpeedSelect 同款)。

    案B(1005 Phase I):pe开负向=直写优先——负面词直写 非空恒胜 PE负面
    (修前 PE负面 非空恒胜=PE 编造词顶掉真负面的断路根)。"""
    node = MyQi21PromptSelect()
    got = node.compose(pe开关=True, 透明模式=False, 装配全文=_ASSEMBLED,
                       PE出文="PE 出文例", 负面词直写=_DIRECT_NEG,
                       PE负面=_PE_NEG)
    assert got == ("PE 出文例", _DIRECT_NEG), \
        f"pe开+透明关→(PE出文原样, 案B直写胜),得 {got!r}"
    try:
        node.compose(pe开关=True, 透明模式=False, 装配全文=_ASSEMBLED)
    except ValueError as exc:
        assert "PE出文" in str(exc) and "pe开关" in str(exc), \
            f"报错应中文指路(PE出文 未接线/关 pe开关),得 {exc}"
    else:
        raise AssertionError("pe开+PE出文未接线应 ValueError(不猜不代选)")


def test_3_pe_off_transparent_on_wraps_assembled_with_w1_and_degrades():
    """四象限(pe关+透明开):正向=头句+空格+装配全文+空格+W1收束句+空格+尾句
    逐字(Q4 两路同包 W1;1005 用户令去重——R1 的中文透明声明插入已删,它
    逐字=中文头+尾拼接,头尾转中文后即书挡,再插一遍=同一句话出现两次,
    锚定意图由中文头尾承担)。

    同锁降级象限:装配全文未接线+pe关→正向降级空串+中文 print 警告→包裹=
    头句+" "+" "+W1+" "+尾句(双空格形);负向路不随透明包裹
    (透明包裹是正向路画幅指令)——pe关负向恒=负面词直写,缺键=空串。"""
    node = MyQi21PromptSelect()
    got = node.compose(pe开关=False, 透明模式=True, 装配全文=_ASSEMBLED,
                       负面词直写=_DIRECT_NEG,
                       RGBA官方头句="头句", RGBA官方尾句="尾句", W1收束句="W1句")
    expected = f"头句 装配全文例 W1句 尾句"
    assert got == (expected, _DIRECT_NEG), \
        f"pe关+透明开→正向=头句+装配+W1+尾(去重后)逐字+负向=直写,得 {got!r}"
    # 去重锁:R1 声明常量须已删(它逐字=中文头+尾拼接,插回即同一句话两次)
    assert not hasattr(select, "_ZH_ALPHA_DECL"), \
        f"_ZH_ALPHA_DECL 应已删(1005 去重令:头尾中文书挡后声明=逐字重复)"
    degraded = node.compose(pe开关=False, 透明模式=True,
                            RGBA官方头句="头句", RGBA官方尾句="尾句",
                            W1收束句="W1句")
    assert degraded == (f"头句  W1句 尾句", ""), \
        f"装配全文未接线+pe关→正向降级双空格形+负向缺键=空串(空负向合法态),得 {degraded!r}"
    # pe开路不消费装配全文=缺键照常(PE出文为正文;隔离降级语义不外溢)
    pe_on = node.compose(pe开关=True, 透明模式=False, PE出文="PE 文")
    assert pe_on == ("PE 文", ""), "pe开路不消费装配全文=缺键照常出 PE出文"


def test_4_pe_on_transparent_on_strips_word_family_and_keeps_w1():
    """四象限(pe开+透明开):正向=头句+剥离(PE出文)+W1+尾句 逐字——剥离对象=
    PE出文(词族整句删,含 backgrounds 族句 "Misty mountains ... behind her."
    消失;词族=qi21_bases.json#strip_lexicon 节现读,大小写由 case_insensitive
    驱动);负向不剥离(词族整句删会误伤逗号清单式负面词)+案B 直写胜。"""
    node = MyQi21PromptSelect()
    got = node.compose(pe开关=True, 透明模式=True, 装配全文=_ASSEMBLED,
                       PE出文=_PE_TEXT, 负面词直写=_DIRECT_NEG, PE负面=_PE_NEG,
                       RGBA官方头句="头句", RGBA官方尾句="尾句", W1收束句="W1句")
    assert "Misty mountains and clouds behind her." not in got[0], \
        f"词族整句(backgrounds 族)应被剥离,得 {got[0]!r}"
    assert "W1句" in got[0], "W1收束句应在场(剥离之后拼接)"
    assert got == (f"头句 {_STRIPPED_PE} W1句 尾句", _DIRECT_NEG), \
        f"pe开+透明开=正向头+剥离文+W1+尾 逐字+负向案B直写胜(不剥离),得 {got!r}"
    # 大小写不敏感由数据文件驱动:大写词族句同样被剥(case_insensitive=true)
    upper = node.compose(pe开关=True, 透明模式=True,
                         PE出文="Keep this. DISTANT MOUNTAINS fade away. Keep that too.",
                         RGBA官方头句="头句", RGBA官方尾句="尾句", W1收束句="W1句")
    assert "DISTANT MOUNTAINS fade away." not in upper[0], \
        f"case_insensitive=true 应剥大写词族句,得 {upper[0]!r}"
    en_patterns = _LEXICON["en"]
    assert _LEXICON["case_insensitive"] is True
    assert any("mountains?" in p for p in en_patterns) and \
        any("backgrounds?" in p for p in en_patterns), \
        "剥离词族真源=qi21_bases.json#strip_lexicon.en(词边界匹配核对)"


def test_5_two_port_shape_and_quadrant_expectations():
    """双口形状锚(10-04 Phase B)+四象限两口期望对拍:正向路四象限逐字
    (拼接序铁律),负向路=pe开关 单扇(pe开=案B 直写胜[直写空则 PE负面],
    pe关=直写缺键空串);负向不包裹不剥离(透明象限负向与透明关象限同文)。"""
    node = MyQi21PromptSelect()
    assert node.RETURN_TYPES == ("STRING", "STRING"), \
        f"双口化:RETURN_TYPES 应双 STRING(10-04 Phase B),得 {node.RETURN_TYPES}"
    assert node.RETURN_NAMES == ("进编码正向文本", "进编码负向文本"), \
        f"双口名应=「进编码正向/负向文本」(10-04),得 {node.RETURN_NAMES}"
    # 正向四象限(10-02 单口形逐字保持;负向随 pe开关 单扇)
    quadrants = [
        # (pe开关, 透明模式, PE出文, 期望正向, 期望负向)
        (False, False, None, _ASSEMBLED, _DIRECT_NEG),
        (True, False, _PE_TEXT, _PE_TEXT, _DIRECT_NEG),   # 案B:直写胜
        (False, True, None,
         f"头句 装配全文例 W1句 尾句", _DIRECT_NEG),   # 1005 去重:声明插入已删
        (True, True, _PE_TEXT, f"头句 {_STRIPPED_PE} W1句 尾句", _DIRECT_NEG),
    ]
    for pe_on, transparent, pe_text, want_pos, want_neg in quadrants:
        got = _compose_quadrant(pe_on, transparent, pe_text)
        assert got == (want_pos, want_neg), \
            f"象限(pe={pe_on},透明={transparent}) 期望 {(want_pos[:30] + '…', want_neg)!r},得 {got!r}"
    # pe开×直写缺键×PE负面接线=空档兜底(案B fallback 路)
    assert _compose_quadrant(True, False, _PE_TEXT,
                             负面词直写=None, PE负面=_PE_NEG) == (_PE_TEXT, _PE_NEG), \
        "pe开×直写缺键→PE负面兜底(空档才轮到)"


def test_6_lazy_protocol_preserved_unchanged():
    """懒保持:check_lazy_status 四分支矩阵原样+纯字符串名单+PE出文/PE负面
    lazy=True INPUT_TYPES 声明锚(2004 双懒槽;1005 案B 不改懒面——PE负面
    值降为空档兜底,但求值请求照旧:漏请求=None 静默错路)。"""
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
    # pe关×透明开=装配全文 包裹路,PE出文 仍零消费(双口化不外溢懒面)
    assert node.check_lazy_status(pe开关=False, PE出文=None, 透明模式=True) == [], \
        "pe关×透明开→[](透明路正文=装配全文,PE出文 零消费)"
    decl = node.INPUT_TYPES()["optional"]["PE出文"]
    assert (decl[1] or {}).get("lazy") is True, \
        f"PE出文 应保持 lazy=True 声明(懒协议锚),得 {decl}"
    decl_neg = node.INPUT_TYPES()["optional"]["PE负面"]
    assert (decl_neg[1] or {}).get("lazy") is True, \
        f"PE负面 应保持 lazy=True 声明(2004 双懒槽;案B 不改懒面),得 {decl_neg}"
    assert hasattr(node, "check_lazy_status"), \
        "实名懒钩子 check_lazy_status 必须在位(引擎只认此名)"


def test_7_strip_uses_lexicon_file_single_source():
    """⑦词族单源锁:剥离词族真源=qi21_bases.json#strip_lexicon 节(1004
    集中地令;旧 qi21_strip_lexicon.json=留档件,产线不再消费,词族逐字
    在彼节,搬迁对拍 SHA256 一致)——strip_word_family 行为与真源家数据
    现读一致(case_insensitive 生效)。"""
    en_patterns = _LEXICON["en"]
    assert _LEXICON["case_insensitive"] is True
    # 大小写不敏感由数据文件驱动:大写词族句同样被剥
    text = "Keep this. DISTANT MOUNTAINS fade away. Keep that too."
    stripped = select.strip_word_family(text)
    assert "DISTANT MOUNTAINS fade away." not in stripped, \
        f"case_insensitive=true 应剥大写词族句,得 {stripped!r}"
    # 词族真源=qi21_bases.json#strip_lexicon.en(词边界匹配核对)
    assert any("mountains?" in p for p in en_patterns)
    assert any("backgrounds?" in p for p in en_patterns)


def test_8_lexicon_valid_json_missing_keys_not_pinned_in_cache():
    """S8 深审 L-3(2004 集中化随迁,坏档面=qi21_bases.json 缺 strip_lexicon
    节):合法 JSON 缺节→同款 RuntimeError 中文兜底;自愈=整文件 mtime 缓存。

    坏档钉死缓存=修文件不自愈须重启引擎(L-3 根除项):缺节词表首调即
    RuntimeError(非裸 KeyError);节结构校验每次调用现跑,同进程换上好文件
    后 _load_strip_lexicon 立即现读自愈。"""
    with tempfile.TemporaryDirectory() as tmp:
        bad = Path(tmp) / "bases_bad.json"
        bad.write_text('{"foo": 1}', encoding="utf-8")  # 合法 JSON,缺 strip_lexicon 节
        real_path, real_cache = select._BASES_JSON, select._bases_cache
        try:
            select._BASES_JSON, select._bases_cache = bad, {"mtime": None, "data": None}
            try:
                select._load_strip_lexicon()
            except RuntimeError as exc:
                assert "词族库" in str(exc) and "结构不合法" in str(exc), \
                    f"应同款 RuntimeError 中文兜底(结构不合法路),得 {exc}"
            else:
                raise AssertionError("缺节词表应 RuntimeError,非裸 KeyError/静默通过")
            # 同进程修好(换上含合法 strip_lexicon 节的文件)→自愈
            good = Path(tmp) / "bases_good.json"
            good.write_text(json.dumps({"strip_lexicon": {"en": ["mountains?"],
                                                          "zh": [],
                                                          "case_insensitive": True}}),
                            encoding="utf-8")
            select._BASES_JSON = good
            got = select._load_strip_lexicon()
            assert got["en"] == ["mountains?"], \
                f"同进程修文件后应现读自愈,得 {got!r}"
        finally:
            select._BASES_JSON, select._bases_cache = real_path, real_cache


# ── ⑨ 2002 ⑭ optional 化缺省兜底(手写 API prompt 省略槽态) ──────────
def test_9_pe_switch_missing_defaults_true():
    """⑭ 随迁 optional 后 pe开关 可缺键(前端 widget 恒投递,仅手写 API prompt
    省略槽时可达)——兜底 True=widget default 同态(0926 裁定1);懒钩子同款
    兜底;签名全 default 不炸 TypeError(双口返回)。"""
    node = MyQi21PromptSelect()
    # 懒钩子:pe开关缺键(None)→按 True 处理→请求未求值的 PE出文
    assert node.check_lazy_status(PE出文=None) == ["PE出文"], \
        "pe开关缺省应兜底 True(钩子按 pe开请求 PE出文)"
    # compose:缺省 pe开关=True→PE 路语义(PE出文 有值即用;负向双缺=空)
    got = node.compose(PE出文="PE 文", 装配全文="装配全文例")
    assert got == ("PE 文", ""), "compose pe开关缺省应兜底 True(PE 路;负向双缺=空串)"
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
    assert got2 == ("", ""), "pe关路装配全文缺键→正向降级空串+负向缺键空串"
    got3 = node.compose(pe开关=False, 透明模式=True)
    assert got3[0].startswith(select._RGBA_HEAD), "pe关+透明开→头句起头(Q4 包裹)"


def test_10_tooltips_present_plain_language():
    """⑰(2002 用户测试批):全部控件 tooltip 在位(大白话一行);头句 tooltip
    =中文真源口径(10-04 随库中文化);案B 两负向槽 tooltip 语义锚:直写
    「优先」/PE负面「兜底」(1005 Phase I)。"""
    inputs = MyQi21PromptSelect().INPUT_TYPES()
    tips = {name: spec[1].get("tooltip")
            for group in ("required", "optional") for name, spec in inputs[group].items()}
    for name, tip in tips.items():
        assert isinstance(tip, str) and tip.strip(), f"{name} 应有非空 tooltip(⑰),得 {tip!r}"
    assert tips["RGBA官方头句"] == \
        "教模型输出透明图的官方开头句(真源=qi21_bases.json,中文;一般不用改)", \
        "头句 tooltip=中文真源口径(10-04 中文化)"
    assert "总开关" in tips["pe开关"]
    # 案B 语义锚(1005):直写优先/PE负面兜底,面板话术与路由同向
    assert "优先" in tips["负面词直写"], "负面词直写 tooltip 应言明 PE 开时直写优先(案B)"
    assert "兜底" in tips["PE负面"], "PE负面 tooltip 应言明兜底位(案B)"


# ── ⑪ 1005 案B:负向路由矩阵五路(design §8.1 ③ 一行对调的件级锚)────
def test_11_case_b_negative_routing_matrix():
    """案B 负向路由矩阵:pe开=direct_neg 非空?direct_neg:pe_neg(修前=
    pe_neg 非空恒胜——实弹 1/2-negative.txt 全 PE 编造词,26+36 条真负面
    零命中);pe关路不变=direct_neg;双空=空负向合法态;缺键同空串。"""
    node = MyQi21PromptSelect()
    # 路1:pe开×双负向在场→直写胜(修前此路=PE负面胜,断路根)
    got1 = node.compose(pe开关=True, 透明模式=False, 装配全文=_ASSEMBLED,
                        PE出文="P", 负面词直写=_DIRECT_NEG, PE负面=_PE_NEG)
    assert got1[1] == _DIRECT_NEG, f"案B:pe开直写非空应恒胜,得 {got1[1]!r}"
    # 路2:pe开×直写空串→PE负面空档兜底
    got2 = node.compose(pe开关=True, 透明模式=False, 装配全文=_ASSEMBLED,
                        PE出文="P", 负面词直写="", PE负面=_PE_NEG)
    assert got2[1] == _PE_NEG, f"案B:直写空串→PE负面兜底,得 {got2[1]!r}"
    # 路3:pe开×直写缺键(None)→兜底(缺键=空串同态)
    got3 = node.compose(pe开关=True, 透明模式=False, 装配全文=_ASSEMBLED,
                        PE出文="P", PE负面=_PE_NEG)
    assert got3[1] == _PE_NEG, f"案B:直写缺键→PE负面兜底,得 {got3[1]!r}"
    # 路4:pe开×双空→空负向(合法态;禁凭空造词)
    got4 = node.compose(pe开关=True, 透明模式=False, 装配全文=_ASSEMBLED,
                        PE出文="P")
    assert got4[1] == "", f"案B:双空→空负向,得 {got4[1]!r}"
    # 路5:pe关路不变——直写恒胜(PE负面 在场也被忽略,修前修后同此路)
    got5 = node.compose(pe开关=False, 透明模式=False, 装配全文=_ASSEMBLED,
                        负面词直写=_DIRECT_NEG, PE负面=_PE_NEG)
    assert got5[1] == _DIRECT_NEG, f"pe关=直写(不变量),得 {got5[1]!r}"
    # 纯空白直写=空(strip 家法:全空白清单视同空→兜底)
    got6 = node.compose(pe开关=True, 透明模式=False, 装配全文=_ASSEMBLED,
                        PE出文="P", 负面词直写="   ", PE负面=_PE_NEG)
    assert got6[1] == _PE_NEG, "纯空白直写应视同空(空档兜底)"
