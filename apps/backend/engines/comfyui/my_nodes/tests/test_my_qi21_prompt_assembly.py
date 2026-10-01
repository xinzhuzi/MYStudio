# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. COMMERCIAL_LICENSE.md available.
"""MyQi21PromptAssembly(装配全文件)契约测试(1001 S8 R7 集成轮;**裁定 A 拆件
形态**:本件=装配链上游,单口真源;原一件式七例中②-⑦随 PE 路/透明路逻辑
迁 test_my_qi21_prompt_select.py,本件=裁定规格三例+1001 S8 L-1 空串守卫两例)。

裁定 A 缘起在档:一件式三口形态「装配全文→[140].prompt」+「[140].positive_prompt
→PE出文」构成数据环,引擎验证层实测拒(lazy 边无豁免);拆件成链=本件(141)
→[140]→MyQi21PromptSelect(152),环变链,Q1=B+ 语义零损。

加载纪律:importlib.util.spec_from_file_location 直接从 nodes/ 文件加载被测
模块(不 import my_nodes 包,与旧单测同款)。

锁:①装配全文=主体句+换行+BASE+换行+锁层A 逐字拼接且输出口即此值(喂
[140].prompt 的唯一真源,Q1=B+)+主体句/锁层A default 迁移锚(sha256 前16位
=1001 t2i 工作流值;锁层A改值走 05 库 Q3「从库刷参数」同批过账,主体句例文
不在 Q3 四固定句、须手改三处——口径同节点文件注释,1001 S8 L-2 纠偏)②BASE 未接线
(None)=主体句+换行+锁层A 两段降级拼**不炸**(裁定 A 规格② optional 缺键
语义;产线日志可查)③单口接口面锁:RETURN_TYPES/RETURN_NAMES/INPUT_TYPES
(required 主体句+锁层A全文 multiline;optional BASE)④BASE 已接线但空串/
纯空白=与 None 同款两段降级拼+中文警告(1001 S8 L-1 修补:BASE 空即无底座
层;判空家法=my_daojie_base (x or "").strip())⑤自由型空 BASE=正常态两段拼
+中性化双关警告(1001 用户测试批 P1,design §2.1/§2.2;「两段拼」断言=
首行主体句+无空行,锁层A 真值内含换行≠两行,import 用包路径)。
"""

from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path

# 1001 用户测试批 P1 新例(import 用包路径——本文件存量例 importlib 直载为
# 历史纪律,新例统一包路径,同目录 test_my_qi21_base/wh_suggest 惯例)
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

# 主体句+锁层A default 迁移锚(SHA256 前16位;迁入时对拍 1001 t2i 工作流
# [24]/[110] 现值——工作流侧节点随 L2 手术删除后,本锚即逐字迁入的存证)
_DEFAULT_ANCHORS = {
    "主体句": "afd9e6f562e3e606",       # 原 顶层 [24] 主体句例文
    "锁层A全文": "eac9a808aa8f7232",    # 原 [110] 通用锁层常量A
}


def _sha16(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


# ── ① 装配全文逐字拼接+输出口即真源+default 迁移锚 ──────────────────
def test_1_assembled_full_text_verbatim_single_output():
    node = MyQi21PromptAssembly()
    result = node.assemble(主体句="主体句例", BASE="底座例", 锁层A全文="锁层A例")
    expected = "主体句例\n底座例\n锁层A例"
    assert result == (expected,), \
        f"装配全文应=主体句+换行+BASE+换行+锁层A 逐字单口元组,得 {result!r}"
    # 输出口即喂 [140].prompt 的真源(Q1=B+:PE=装配全文的优化器)
    assert node.RETURN_TYPES == ("STRING",) and node.RETURN_NAMES == ("装配全文",)
    # default 迁移锚(逐字迁入存证)
    inputs = node.INPUT_TYPES()
    assert _sha16(inputs["required"]["主体句"][1]["default"]) == _DEFAULT_ANCHORS["主体句"]
    assert _sha16(inputs["required"]["锁层A全文"][1]["default"]) == _DEFAULT_ANCHORS["锁层A全文"]
    assert inputs["required"]["主体句"][1]["multiline"] is True \
        and inputs["required"]["锁层A全文"][1]["multiline"] is True, \
        "Q4:固定句/主体句参数应 multiline 大框"


# ── ② BASE 未接线=两段降级拼不炸(裁定 A 规格② optional 缺键语义)────
def test_2_base_unwired_degrades_to_two_segments():
    node = MyQi21PromptAssembly()
    result = node.assemble(主体句="主体句例", 锁层A全文="锁层A例")  # BASE 缺键
    assert result == ("主体句例\n锁层A例",), \
        f"BASE 未接线应降级=主体句+换行+锁层A 两段拼(optional 缺键不炸),得 {result!r}"


# ── ③ 接口面锁:单口+optional BASE(裁定 A 拆件形态防回退)────────────
def test_3_interface_shape_upstream_single_output():
    node = MyQi21PromptAssembly()
    inputs = node.INPUT_TYPES()
    assert set(inputs["required"]) == {"主体句", "锁层A全文"}, \
        f"required 应恰 主体句+锁层A全文(头/尾/W1 已随裁定 A 迁选择器件),得 {set(inputs['required'])}"
    assert set(inputs["optional"]) == {"BASE"}, \
        f"optional 应恰 BASE,得 {set(inputs['optional'])}"
    assert inputs["optional"]["BASE"][0] == "STRING"
    assert node.FUNCTION == "assemble"


# ── ④ BASE 已接线但空串/纯空白=与 None 同款两段降级拼+中文警告 ────────
# (1001 S8 L-1 修补:BASE 空即无底座层;此前空串走三段拼+零警告)
def test_4_base_empty_string_degrades_to_two_segments(capsys):
    node = MyQi21PromptAssembly()
    result = node.assemble(主体句="主体句例", BASE="", 锁层A全文="锁层A例")
    assert result == ("主体句例\n锁层A例",), \
        f"BASE=''(接线但空串)应与 None 同款降级=主体句+换行+锁层A 两段拼" \
        f"(BASE 空即无底座层),得 {result!r}"
    out = capsys.readouterr().out
    assert "[MyQi21PromptAssembly]" in out and "两段拼" in out, \
        f"BASE 空串路应发与 None 同款中文 print 警告(不再零警告),得 {out!r}"


def test_5_base_whitespace_string_degrades_to_two_segments(capsys):
    node = MyQi21PromptAssembly()
    result = node.assemble(主体句="主体句例", BASE="  ", 锁层A全文="锁层A例")
    assert result == ("主体句例\n锁层A例",), \
        f"BASE='  '(纯空白)应与 None 同款降级=两段拼,得 {result!r}"
    out = capsys.readouterr().out
    assert "[MyQi21PromptAssembly]" in out and "两段拼" in out, \
        f"BASE 纯空白路应发同款中文 print 警告,得 {out!r}"


# ── ⑤ 自由型空 BASE=正常态两段拼+中性化双关警告(1001 用户测试批 P1, ──
# ── design §2.1/§2.2;import 用包路径,与存量直载并存测同一行为) ──────
def test_6_free_type_empty_base_two_segments_neutral_warning(capsys):
    """自由型 BASE 恒空串(qi21_bases.json 十档末位 base_text="")→装配器
    判空走两段降级拼=**正常态**;断言口径(implement.md 步骤5):首行主体句
    +全文无空行——锁层A 真值内含换行,「两段拼」≠「只有两行」,禁按行数断言
    (防锁层A 内换行坑:误把锁层A 换行当段界,或实现误用空行分隔)。"""
    node = MyQi21PromptAssemblyPkg()
    # 真锁层A default(内含换行,三段长文)从 INPUT_TYPES 运行时取,零硬编码
    lock_a = node.INPUT_TYPES()["required"]["锁层A全文"][1]["default"]
    assert "\n" in lock_a, "前置:真锁层A 应内含换行(断言口径成立的前提"
    result = node.assemble(主体句="主体句例", BASE="", 锁层A全文=lock_a)
    out = result[0]
    assert result == (f"主体句例\n{lock_a}",), \
        f"自由型空 BASE 应两段拼=主体句+换行+锁层A(逐字),得 {out[:50]!r}…"
    lines = out.split("\n")
    assert lines[0] == "主体句例"          # 首行=主体句
    assert len(lines) > 2, \
        "两段拼≠两行:锁层A 内换行应原样保留(行数断言=锁层A 内换行坑)"
    assert "" not in lines, \
        "全文无空行(实现误用 \\n\\n 拼段即红)"
    assert out.endswith(lock_a)            # 尾段=锁层A 逐字
    # 中性化双关警告(design §2.2):自由型正常态+非自由型请检查连线
    warn = capsys.readouterr().out
    assert "[MyQi21PromptAssembly]" in warn and "两段拼" in warn
    assert "自由型" in warn and "正常态" in warn
    assert "非自由型" in warn and "检查连线" in warn
