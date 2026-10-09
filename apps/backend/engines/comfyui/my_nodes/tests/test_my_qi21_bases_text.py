# 1006 真源文本(MyQi21BasesText)单测:三节热读+形状+空节降级。
from __future__ import annotations

import importlib.util
from pathlib import Path

_NODE = Path(__file__).resolve().parents[1] / "nodes" / "my_qi21_bases_text.py"
_spec = importlib.util.spec_from_file_location("my_qi21_bases_text_uut", _NODE)
bt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bt)


def test_shape_single_output_with_combo():
    """一口 STRING 出+下拉三节;DISPLAY 注册双挂。"""
    node = bt.MyQi21BasesText()
    assert node.RETURN_TYPES == ("STRING",) and node.RETURN_NAMES == ("文本",)
    req = node.INPUT_TYPES()["required"]["文本节"]
    # 1008晚三件拆分:下拉三节→六节(+风格工艺件/底色背景件/透明承载件)
    assert set(req[0]) == {"系统提示词", "色卡", "美术风格底座",
                           "风格工艺件", "底色背景件", "透明承载件"}


def test_three_sections_hotread():
    """三节真源热读:教材含扩写专家;色卡含淡墨与落点纪律;风格含锁层正文。"""
    教材 = bt._section_text("系统提示词")
    色卡 = bt._section_text("色卡")
    风格 = bt._section_text("美术风格底座")
    # 1007 v9:色库数据出教材归[4031]——教材只留选题逻辑,数据块不得在场
    assert "八步工作法" in 教材 and "色卡选题" in 教材 and len(教材) > 2500, \
        "教材应 2500+ 字(八步法+选题逻辑)"
    assert "项目色卡全库" not in 教材, "色库数据已迁[4031],教材不得内嵌(1007 用户令)"
    assert "42色" in 色卡 or "42 色" in 色卡, "色卡应含42色全库"
    # 1009 用户抓「blue.02 这些词出图模型认吗」:渲染面零 ma_id/hex(住 json 供人工对表),
    # 在用标记+五职责保留,用法带编号禁令,base 职责带满幅清退
    import re as _re
    assert "★在用" in 色卡 and "五职责" in 色卡, "色卡应在用标记+五职责"
    assert not _re.search(r"[a-z]{3,8}\.\d{2}", 色卡), "渲染面不得含 ma_id(paper.01 等)"
    assert not _re.search(r"#[0-9A-Fa-f]{6}\b", 色卡), "渲染面不得含 hex"
    assert "编号" in 色卡 and "中文名" in 色卡, "用法应立编号禁令"
    # 1009 用户裁定:base 职责=通用肯定式单态,禁分型分支/否定式
    base_line = next(l for l in 色卡.splitlines() if l.strip().startswith("base:"))
    assert base_line.strip().startswith("base: 大面积浅淡稳定衬底色面"), base_line
    assert "不落" not in base_line and "不留" not in base_line and "满幅" not in base_line
    assert len(风格) > 300, "风格底座应=美术风格底座全文量级"


def test_unknown_section_falls_back_and_registered():
    """未知节名=回落系统提示词不炸;注册面双挂。"""
    assert bt.MyQi21BasesText().output("不存在的节")["result"][0] == bt._section_text("系统提示词")
    src = (Path(__file__).resolve().parents[1] / "__init__.py").read_text(encoding="utf-8")
    assert '"MyQi21BasesText": MyQi21BasesText' in src
    assert '"MyQi21BasesText": "漫影 真源文本"' in src


def test_output_node_ui_payload_and_display_slot():
    """1006 批A 三锚:OUTPUT_NODE 开/ui.bases_text 载荷/optional「内容」展示槽。"""
    node = bt.MyQi21BasesText()
    # 锚1:OUTPUT_NODE=True(JS onExecuted 回填的前提,问题1 决议 Q3=执行回填)
    assert node.OUTPUT_NODE is True
    # 锚2:output() 返回 ui 载荷 bases_text=[全文]+result 单 STRING 口形不变
    out = node.output("色卡", 内容="旧值")
    assert out["ui"]["bases_text"][0] == bt._section_text("色卡")
    assert out["result"] == (bt._section_text("色卡"),)
    # 锚3:展示槽=optional STRING multiline(required 会被 /prompt 验证层 400,在案)
    opt = node.INPUT_TYPES()["optional"]["内容"]
    assert opt[0] == "STRING" and opt[1].get("multiline") is True
    assert "内容" not in node.INPUT_TYPES()["required"]
