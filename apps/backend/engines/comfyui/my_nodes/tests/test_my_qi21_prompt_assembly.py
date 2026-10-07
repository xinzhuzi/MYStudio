# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. COMMERCIAL_LICENSE.md available.
"""MyQi21PromptAssembly(装配全文件)契约测试(1001 S8 R7 集成轮;**裁定 A 拆件
形态**:本件=装配链上游;1004 正负拆开轮起双出=装配全文(口0 真源)+负面词
(口1);**1005 案B Phase I 重锚**:新增 optional 连线槽「BASE负面」←[150]
MyQi21DaojieBase.负面词(第五出=型负面),负面词输出改=_merge_negative(
BASE负面, 锁层负面 mtime 现读)——import 快照 _LOCK_A_NEG 退役(遗留债9)、
型负面出口接通(design §8.1 ②))。原一件式七例中②-⑦随 PE 路/透明路逻辑
迁 test_my_qi21_prompt_select.py,本件=裁定规格例+空串守卫例+案B 新锚例。

裁定 A 缘起在档:一件式三口形态「装配全文→[140].prompt」+「[140].positive_prompt
→PE出文」构成数据环,引擎验证层实测拒(lazy 边无豁免);拆件成链=本件(141)
→[140]→MyQi21PromptSelect(152),环变链。

加载纪律:importlib.util.spec_from_file_location 直接从 nodes/ 文件加载被测
模块(不 import my_nodes 包,与旧单测同款)。

锁:
①装配全文=主体句+换行+BASE+换行+锁层A 逐字拼接且口0 即此值(喂
[140].prompt 的唯一真源,Q1=B+)+主体句 default 迁移锚+锁层A default 锚
(1004 集中地令后 default=qi21_bases.json lock_layer.positive_text 热读,
sha16 锚=现值钉;锁层A改值走 05 库 Q3 通道同批过账并更新锚)
②BASE 未接线(None)=主体句+换行+锁层A 两段降级拼**不炸**(裁定 A 规格②
optional 缺键语义;产线日志可查)
③接口面锁:RETURN_TYPES/RETURN_NAMES(双出)/INPUT_TYPES(optional 声明序
=BASE/BASE负面(两连线槽前置)/主体句/锁层A全文;1005 案B BASE负面槽在位)
④BASE 已接线但空串/纯空白=与 None 同款两段降级拼+中文警告(1001 S8 L-1
修补;判空家法=my_daojie_base (x or "").strip())
⑤自由型空 BASE=正常态两段拼+中性化双关警告(1001 用户测试批 P1;
「两段拼」断言=首行主体句+无空行)
⑥1005 案B:负面词=merge(BASE负面, 锁层负面现读)——型负面 token 在前
锁层在后、整 token 相等去重(my_styles._merge_negative 单源复用);BASE负面
缺键/空串=裸锁层负面兜底;负面全角逗号清单=整段一 token,两段以半角", "
拼接(K2 侧同款现行为)
⑦1005 案B:锁层负面 mtime 现读(遗留债9 回归锁)——同进程热改锁层负面
即生效,不重启(import 快照回潮即红)。
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

# 1001 用户测试批 P1 例起 import 用包路径(历史例 importlib 直载并存,同目录
# test_my_qi21_base/wh_suggest 惯例;1005 案B:_LOCK_A_NEG 已退役,包路径只取类)
from engines.comfyui.my_nodes.nodes.my_qi21_prompt_assembly import (
    MyQi21PromptAssembly as MyQi21PromptAssemblyPkg)

# 被测模块直载(禁 import my_nodes 包;__file__ 生效→路径解析同产线)
_NODE_FILE = (Path(__file__).resolve().parents[1] / "nodes"
              / "my_qi21_prompt_assembly.py")
_spec = importlib.util.spec_from_file_location(
    "my_qi21_prompt_assembly_under_test", _NODE_FILE)
assembly = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(assembly)
MyQi21PromptAssembly = assembly.MyQi21PromptAssembly

# 主体句 default 迁移锚(SHA256 前16位;迁入时对拍 1001 t2i 工作流 [24] 现值)
# +锁层A default 锚(1004 集中地令后 default=qi21_bases.json
# lock_layer.positive_text 热读现值钉;旧 eac9a808aa8f7232=工作流历史值,
# 与真源家正负拆开瘦身版(739 字)不同文,锚随真源迁)
_DEFAULT_ANCHORS = {
    "主体句": "afd9e6f562e3e606",       # 原 顶层 [24] 主体句例文
    "锁层A全文": "c74fffcb5c4a9b0f",    # qi21_bases.json lock_layer.positive_text(1007 否定式清退两轮后)
}


def _sha16(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _lock_neg() -> str:
    """锁层负面真值现读(单源对拍用,不走被测函数)。"""
    return json.loads(assembly._BASES_FILE.read_text(encoding="utf-8")
                      )["lock_layer"]["negative_text"]


# ── ① 装配全文逐字拼接+双出真源+default 锚 ──────────────────────
def test_1_assembled_full_text_verbatim_single_output():
    node = MyQi21PromptAssembly()
    result = node.assemble(主体句="主体句例", BASE="底座例", 锁层A全文="锁层A例")
    expected = "主体句例\n底座例\n锁层A例"
    # 1005 案B:口1 负面词=merge(BASE负面, 锁层负面现读);BASE负面 缺键
    # =merge("", lock)=裸锁层负面(全角逗号清单=整段一 token,归一并=原文)
    assert result == (expected, _lock_neg()), \
        f"装配全文应=主体句+换行+BASE+换行+锁层A 逐字+负面词二元组,得 {result!r}"
    assert result[1] == assembly._merge_negative("", _lock_neg()), \
        "缺键负面词应=merge('', 锁层负面)=裸锁层负面(案B 口1 语义)"
    # 口0 即喂 [140].prompt 的真源(Q1=B+);口1=负面词双出
    assert node.RETURN_TYPES == ("STRING", "STRING") \
        and node.RETURN_NAMES == ("装配全文", "负面词")
    # default 锚(主体句=工作流迁入逐字;锁层A=真源家热读现值钉)
    inputs = node.INPUT_TYPES()
    assert _sha16(inputs["optional"]["主体句"][1]["default"]) == _DEFAULT_ANCHORS["主体句"]
    assert _sha16(inputs["optional"]["锁层A全文"][1]["default"]) == _DEFAULT_ANCHORS["锁层A全文"]
    assert inputs["optional"]["锁层A全文"][1]["default"] \
        == assembly._load_lock_layer()["positive"], \
        "锁层A default 应=qi21_bases.json lock_layer.positive_text 现读(1004 集中地)"
    assert inputs["optional"]["主体句"][1]["multiline"] is True \
        and inputs["optional"]["锁层A全文"][1]["multiline"] is True, \
        "Q4:固定句/主体句参数应 multiline 大框"


# ── ② BASE 未接线=两段降级拼不炸(裁定 A 规格② optional 缺键语义)────
def test_2_base_unwired_degrades_to_two_segments():
    node = MyQi21PromptAssembly()
    result = node.assemble(主体句="主体句例", 锁层A全文="锁层A例")  # BASE 缺键
    assert result == ("主体句例\n锁层A例", _lock_neg()), \
        f"BASE 未接线应降级=主体句+换行+锁层A 两段拼(optional 缺键不炸),得 {result!r}"


# ── ③ 接口面锁:⑭ 连线槽前置/参数下沉+案B BASE负面槽 ────────────────
def test_3_interface_shape_upstream_single_output():
    node = MyQi21PromptAssembly()
    inputs = node.INPUT_TYPES()
    # 2002 ⑭:required 置空(连线槽前置需全槽住 optional——BASE 进 required 会被
    # 引擎验证层强拒「可不接」语义=breaking);1005 案B:BASE负面 第二连线槽
    # (BASE 与参数 widget 之间,连线槽相邻前置)
    assert inputs["required"] == {}, \
        f"required 应置空(2002 ⑭ 连线槽前置重排),得 {inputs['required']}"
    assert list(inputs["optional"]) == ["BASE", "BASE负面", "主体句", "主体句负面", "锁层A全文"], \
        f"optional 声明序应=BASE/BASE负面(两连线槽,⑭ 前置)/主体句/锁层A全文" \
        f"(参数下沉;1005 案B Phase I),得 {list(inputs['optional'])}"
    assert inputs["optional"]["BASE"][0] == "STRING"
    assert inputs["optional"]["BASE负面"][0] == "STRING", \
        "BASE负面 应 STRING 连线槽(接 [150].负面词 第五出)"
    assert node.FUNCTION == "assemble"


def test_tooltips_present_plain_language():
    """⑰(1002 用户测试批):全部控件 tooltip 在位(大白话一行);头句式样例锁
    prd ⑰ 给的口径文案关键词,防回退成技术腔/空串;BASE负面 tooltip 指路
    [150].负面词(1005 案B)。"""
    inputs = MyQi21PromptAssembly().INPUT_TYPES()
    tips = {name: spec[1].get("tooltip")
            for group in ("required", "optional") for name, spec in inputs[group].items()}
    for name, tip in tips.items():
        assert isinstance(tip, str) and tip.strip(), f"{name} 应有非空 tooltip(⑰),得 {tip!r}"
    assert "底座十选一" in tips["BASE"], "BASE tooltip 应大白话指向「底座十选一」件"
    assert "负面词" in tips["BASE负面"] and "底座十选一" in tips["BASE负面"], \
        "BASE负面 tooltip 应指路「底座十选一」件的 负面词 输出(案B)"
    assert "一般不用改" in tips["锁层A全文"]


# ── ④ BASE 已接线但空串/纯空白=与 None 同款两段降级拼+中文警告 ───────
# (1001 S8 L-1 修补:BASE 空即无底座层;此前空串走三段拼+零警告)
def test_4_base_empty_string_degrades_to_two_segments(capsys):
    node = MyQi21PromptAssembly()
    result = node.assemble(主体句="主体句例", BASE="", 锁层A全文="锁层A例")
    assert result == ("主体句例\n锁层A例", _lock_neg()), \
        f"BASE=''(接线但空串)应与 None 同款降级=主体句+换行+锁层A 两段拼" \
        f"(BASE 空即无底座层),得 {result!r}"
    out = capsys.readouterr().out
    assert "[MyQi21PromptAssembly]" in out and "两段拼" in out, \
        f"BASE 空串路应发与 None 同款中文 print 警告(不再零警告),得 {out!r}"


def test_5_base_whitespace_string_degrades_to_two_segments(capsys):
    node = MyQi21PromptAssembly()
    result = node.assemble(主体句="主体句例", BASE="  ", 锁层A全文="锁层A例")
    assert result == ("主体句例\n锁层A例", _lock_neg()), \
        f"BASE='  '(纯空白)应与 None 同款降级=两段拼,得 {result!r}"
    out = capsys.readouterr().out
    assert "[MyQi21PromptAssembly]" in out and "两段拼" in out, \
        f"BASE 纯空白路应发同款中文 print 警告,得 {out!r}"


# ── ⑤ 自由型空 BASE=正常态两段拼+中性化双关警告(1001 用户测试批 P1, ──
# ── design §2.1/§2.2;import 用包路径,与存量直载并存测同一行为) ──────
def test_6_free_type_empty_base_two_segments_neutral_warning(capsys):
    """自由型 BASE 恒空串(qi21_bases.json 十档末位 base_text="")→装配器
    判空走两段降级拼=**正常态**;断言口径(implement.md 步骤5):首行主体句
    +全文无空行——「两段拼」≠「只有两行」,锁层A 内换行须原样保留(1005
    案B 注:真源家 lock_layer.positive_text 瘦身版 739 字无换行,换行守卫
    用合成多行值单独钉,逐字断言仍用真 default 零硬编码)。"""
    node = MyQi21PromptAssemblyPkg()
    lock_a = node.INPUT_TYPES()["optional"]["锁层A全文"][1]["default"]
    assert lock_a == assembly._load_lock_layer()["positive"], \
        "包路径/直载两形态 default 同源(真源家现读)"
    result = node.assemble(主体句="主体句例", BASE="", 锁层A全文=lock_a)
    out = result[0]
    assert result == (f"主体句例\n{lock_a}",
                      json.loads(Path(assembly._BASES_FILE).read_text(
                          encoding="utf-8"))["lock_layer"]["negative_text"]), \
        f"自由型空 BASE 应两段拼=主体句+换行+锁层A(逐字),得 {out[:50]!r}…"
    # 换行守卫(合成多行锁层A):锁层A 内换行原样保留,禁空行分隔/禁压缩
    ml = "锁A行1\n锁A行2"
    out_ml = node.assemble(主体句="主体句例", BASE="", 锁层A全文=ml)[0]
    lines = out_ml.split("\n")
    assert lines[0] == "主体句例"          # 首行=主体句
    assert lines == ["主体句例", "锁A行1", "锁A行2"], \
        "锁层A 内换行应原样保留(两段拼≠两行;实现误用 \\n\\n 拼段即红)"
    assert out_ml.endswith(ml)             # 尾段=锁层A 逐字
    # 中性化双关警告(design §2.2):自由型正常态+非自由型请检查连线
    warn = capsys.readouterr().out
    assert "[MyQi21PromptAssembly]" in warn and "两段拼" in warn
    assert "自由型" in warn and "正常态" in warn
    assert "非自由型" in warn and "检查连线" in warn


# ── ⑥ 1005 案B:负面词=merge(BASE负面, 锁层负面)——型负面在前+去重 ──
def test_7_base_negative_merged_with_lock_negative():
    """案B 口1 真值锚(design §8.1 ②):负面词=_merge_negative(BASE负面,
    锁层负面)——①型负面 token 在前、锁层负面在后(K2 my_styles 单源复用);
    ②BASE负面=真源家人物型 negative_text(202 字全角逗号清单=整段一 token)
    →输出=「型负面, 锁层负面」半角", "两段拼接;③整 token 相等才去重:
    BASE负面 传整段锁层负面=去重裸输出;④半角逗号清单 token 归一并
    ("A,B"→"A, B",merge 保守重组纪律);⑤空串/纯空白=裸锁层负面兜底
    (BASE负面 独立于 BASE 判空——BASE 空不妨碍型负面在场)。"""
    node = MyQi21PromptAssembly()
    lock = _lock_neg()
    data = json.loads(assembly._BASES_FILE.read_text(encoding="utf-8"))
    renwu_neg = next(e for e in data["types"] if e["zh"] == "人物")["negative_text"]
    # ①+②:型负面在前,锁层在后
    got = node.assemble(主体句="S", BASE="B", BASE负面=renwu_neg,
                        锁层A全文="L")[1]
    assert got == f"{renwu_neg}, {lock}", \
        f"merge 应=型负面在前+锁层在后 半角\", \"拼接,得 {got[:60]!r}…"
    assert got == assembly._merge_negative(renwu_neg, lock), \
        "应与 my_styles._merge_negative 单源行为逐字一致(防两处实现漂移)"
    # ③:整 token 相等去重(全角清单=整段一 token,同段即消)
    dup = node.assemble(主体句="S", BASE="B", BASE负面=lock, 锁层A全文="L")[1]
    assert dup == lock, "BASE负面=整段锁层负面 应去重裸输出(整 token 相等才去重)"
    # ④:半角逗号清单 token 化归并
    tokens = node.assemble(主体句="S", BASE="B", BASE负面="甲,乙",
                           锁层A全文="L")[1]
    assert tokens == f"甲, 乙, {lock}", f"半角逗号 token 应归一重组,得 {tokens[:40]!r}"
    # ⑤:空串/纯空白/缺键=裸锁层负面兜底;BASE 空=两段拼不妨碍负面输出
    for empty in ("", "   "):
        got2 = node.assemble(主体句="S", BASE="", BASE负面=empty,
                             锁层A全文="L")[1]
        assert got2 == lock, f"BASE负面={empty!r} 应=裸锁层负面兜底,得 {got2[:30]!r}"


# ── ⑦ 1005 案B:锁层负面 mtime 现读(遗留债9 回归锁)──────────────────
def test_8_lock_negative_mtime_hot_read(tmp_path):
    """负面词=每次装配 mtime 现读(修前=_LOCK_A_NEG import 快照:热改锁层
    负面须重启引擎才生效,违背全链热读纪律)——同进程换数据文件→mtime 变
    →下次 assemble 即新值;positive default 面不受影响(锁层A widget default
    求值一次属 INPUT_TYPES default 家法,非负面输出面)。"""
    real_path, real_cache = assembly._BASES_FILE, assembly._lock_cache
    try:
        data = json.loads(real_path.read_text(encoding="utf-8"))
        data["lock_layer"]["negative_text"] = "热改锁层负面甲，热改锁层负面乙"
        fake = tmp_path / "qi21_bases_hot.json"
        fake.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        assembly._BASES_FILE = fake
        assembly._lock_cache.update(mtime=None, data=None)  # mtime 失效重扫
        got = MyQi21PromptAssembly().assemble(主体句="S", BASE="B",
                                              BASE负面="型负面", 锁层A全文="L")[1]
        assert got == "型负面, 热改锁层负面甲，热改锁层负面乙", \
            f"热改锁层负面应现读生效(遗留债9:import 快照回潮即红),得 {got!r}"
    finally:
        assembly._BASES_FILE = real_path
        assembly._lock_cache.update(mtime=None, data=None)
    # 还原后回真值(缓存失效重扫回真源)
    got2 = MyQi21PromptAssembly().assemble(主体句="S", BASE="B",
                                           锁层A全文="L")[1]
    assert got2 == _lock_neg()
