# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. COMMERCIAL_LICENSE.md available.
"""MyQi21PromptSelect(最终文本合成器)契约测试(1001 S8 R7 集成轮裁定 A 拆件
形态=装配链下游件;原一件式装配器七例中②-⑦全数迁本件+裁定新增例)。

锁(十例):
①pe关→最终文本=装配全文(直写路)+头/尾/W1 default 迁移锚(sha256 前16位=
1001 t2i 工作流值)②pe开→最终文本=PE出文(优化器路)③透明+pe关→头句+空格+
装配全文+空格+尾句 ④透明+pe开→词族整句剥离(含 "backgrounds" 整句消失,
pattern=数据文件现读)+W1收束句在场 ⑤懒钩子矩阵:pe关→[];pe开+PE出文
None(已接线未求值态)→请求名单;PE出文未接线(缺键)→[]绝不请求;名单=
纯字符串形(引擎 execution.py:513-516 按 isinstance(x,str) 过滤建链,元组形
会被静默丢弃)⑥透明模式=False→透明文本仍产出(机械值,下游 [144] 不选即弃;
透明模式输入不参与文本计算=R7.4 不可吞边界)⑦装配全文未接线+pe关→最终文本
空串+透明文本=头句+空格+尾句(裁定 A 自洽降级语义;pe开路不消费装配全文=
照常出 PE出文)⑧pe开+PE出文未接线→中文 ValueError(不猜不代选)⑨词族单源
锁:strip_word_family 与 qi21_strip_lexicon.json 现读 pattern 行为一致
(case_insensitive 生效,与 [MyQi21PromptAssembly].BASE 无关的独立真源)
⑩词库结构坏档锁(1001 S8 深审 L-3):合法 JSON 缺键→同款 RuntimeError
中文兜底且不写缓存,同进程修文件即自愈(坏 dict 不得钉死缓存)。

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


def _sha16(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def test_1_pe_off_final_equals_assembled_and_defaults():
    node = MyQi21PromptSelect()
    final, _transparent = node.compose(pe开关=False, 透明模式=False,
                                       装配全文="装配全文例")
    assert final == "装配全文例", f"pe关→最终文本应=装配全文(直写路),得 {final!r}"
    inputs = node.INPUT_TYPES()
    for name, anchor in _DEFAULT_ANCHORS.items():
        assert _sha16(inputs["required"][name][1]["default"]) == anchor, \
            f"{name} default 迁移锚漂移(应 sha16={anchor})"
        assert inputs["required"][name][1]["multiline"] is True, \
            f"Q4:{name} 应 multiline 大框"
    assert inputs["required"]["pe开关"][1]["default"] is True, "pe开关默认应 true(0926 裁定1)"
    assert inputs["required"]["透明模式"][1]["default"] is False


def test_2_pe_on_final_equals_pe_text():
    node = MyQi21PromptSelect()
    final, _t = node.compose(pe开关=True, 透明模式=False, 装配全文="装配全文例",
                             PE出文="PE 出文例")
    assert final == "PE 出文例", f"pe开→最终文本应=PE出文(优化器路),得 {final!r}"


def test_3_transparent_pe_off_wraps_assembled():
    node = MyQi21PromptSelect()
    _final, transparent = node.compose(pe开关=False, 透明模式=True,
                                       装配全文="装配全文例",
                                       RGBA官方头句="头句", RGBA官方尾句="尾句",
                                       W1收束句="W1句")
    assert transparent == "头句 装配全文例 尾句", \
        f"透明+pe关→头句+空格+装配全文+空格+尾句,得 {transparent!r}"


def test_4_transparent_pe_on_strips_word_family_and_keeps_w1():
    node = MyQi21PromptSelect()
    pe_text = "a lone cultivator. Misty mountains and clouds behind her. crisp edges."
    _final, transparent = node.compose(pe开关=True, 透明模式=True,
                                       装配全文="装配全文例", PE出文=pe_text,
                                       RGBA官方头句="头句", RGBA官方尾句="尾句",
                                       W1收束句="W1句")
    assert "Misty mountains and clouds behind her." not in transparent, \
        f"词族整句(backgrounds 族)应被剥离,得 {transparent!r}"
    assert "W1句" in transparent, "W1收束句应在场(剥离之后拼接)"
    assert transparent == "头句 a lone cultivator. crisp edges. W1句 尾句", \
        f"透明+pe开=头句+剥离文+W1+尾句 逐字,得 {transparent!r}"


def test_5_check_lazy_status_matrix():
    node = MyQi21PromptSelect()
    assert node.check_lazy_status(pe开关=False, PE出文=None) == [], \
        "pe关→[]([140] 无人消费其输出→不进执行图)"
    got = node.check_lazy_status(pe开关=True, PE出文=None)
    assert got == ["PE出文"], \
        f"pe开+PE出文已接线未求值(None)→请求名单,得 {got!r}"
    assert all(isinstance(x, str) for x in got), \
        "请求名单必须纯字符串形(引擎按 isinstance(x,str) 过滤,元组形被静默丢弃)"
    assert node.check_lazy_status(pe开关=True) == [], \
        "PE出文未接线(缺键)→[]绝不请求(未接线槽建强链=NodeInputError)"
    assert node.check_lazy_status(pe开关=True, PE出文="已求值") == [], \
        "PE出文已求值→放行(空名单)"


def test_6_transparent_mode_off_still_produces_transparent_text():
    node = MyQi21PromptSelect()
    _final, transparent = node.compose(pe开关=False, 透明模式=False,
                                       装配全文="装配全文例",
                                       RGBA官方头句="头句", RGBA官方尾句="尾句")
    assert transparent == "头句 装配全文例 尾句", \
        "透明模式=False→透明文本仍机械产出(下游 [144] 不选即弃,R7.4 不可吞边界)"


def test_7_assembled_unwired_pe_off_degrades_to_empty():
    node = MyQi21PromptSelect()
    final, transparent = node.compose(pe开关=False, 透明模式=False,
                                       RGBA官方头句="头句", RGBA官方尾句="尾句")
    assert final == "", \
        f"装配全文未接线+pe关→最终文本降级空串(缺真源自洽语义),得 {final!r}"
    assert transparent == "头句  尾句", \
        f"同态透明文本=头句+空格+空串+空格+尾句,得 {transparent!r}"
    # pe开路不消费装配全文=缺键照常(PE出文为最终文本)
    final2, _t2 = node.compose(pe开关=True, 透明模式=False, PE出文="PE 文")
    assert final2 == "PE 文"


def test_8_pe_on_without_pe_text_raises_chinese():
    node = MyQi21PromptSelect()
    try:
        node.compose(pe开关=True, 透明模式=False, 装配全文="装配全文例")
    except ValueError as exc:
        assert "PE出文" in str(exc) and "pe开关" in str(exc), \
            f"报错应中文指路(PE出文 未接线/关 pe开关),得 {exc}"
    else:
        raise AssertionError("pe开+PE出文未接线应 ValueError(不猜不代选)")


def test_9_strip_uses_lexicon_file_single_source():
    pattern = _LEXICON["pattern"]
    assert _LEXICON["case_insensitive"] is True
    # 大小写不敏感由数据文件驱动:大写词族句同样被剥
    text = "Keep this. DISTANT MOUNTAINS fade away. Keep that too."
    stripped = select.strip_word_family(text)
    assert "DISTANT MOUNTAINS fade away." not in stripped, \
        f"case_insensitive=true 应剥大写词族句,得 {stripped!r}"
    # pattern 真源=数据文件(词边界匹配核对)
    assert "mountains?" in pattern and "backgrounds?" in pattern


def test_10_lexicon_valid_json_missing_keys_not_pinned_in_cache():
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
