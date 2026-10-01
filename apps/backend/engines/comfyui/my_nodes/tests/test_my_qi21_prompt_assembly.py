# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. COMMERCIAL_LICENSE.md available.
"""MyQi21PromptAssembly(装配全文件)契约测试(1001 S8 R7 集成轮;**裁定 A 拆件
形态**:本件=装配链上游,单口真源;原一件式七例中②-⑦随 PE 路/透明路逻辑
迁 test_my_qi21_prompt_select.py,本件=裁定规格三例)。

裁定 A 缘起在档:一件式三口形态「装配全文→[140].prompt」+「[140].positive_prompt
→PE出文」构成数据环,引擎验证层实测拒(lazy 边无豁免);拆件成链=本件(141)
→[140]→MyQi21PromptSelect(152),环变链,Q1=B+ 语义零损。

加载纪律:importlib.util.spec_from_file_location 直接从 nodes/ 文件加载被测
模块(不 import my_nodes 包,与旧单测同款)。

锁:①装配全文=主体句+换行+BASE+换行+锁层A 逐字拼接且输出口即此值(喂
[140].prompt 的唯一真源,Q1=B+)+主体句/锁层A default 迁移锚(sha256 前16位
=1001 t2i 工作流值,改值须与 05 库「从库刷参数」同批过账)②BASE 未接线
(None)=主体句+换行+锁层A 两段降级拼**不炸**(裁定 A 规格② optional 缺键
语义;产线日志可查)③单口接口面锁:RETURN_TYPES/RETURN_NAMES/INPUT_TYPES
(required 主体句+锁层A全文 multiline;optional BASE)。
"""

from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path

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
