# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""[4032]→[4013] 单线四段协议回归锁(1009)。

协议文格式逐字定死(四段各占一行,线上唯一载体):
  【风格工艺件】{positive_style_text}
  【底色背景件】{positive_ground_text}
  【透明承载件】{rgba_text}
  【负向词表】{negative_text}
锁四面:①[4032] 主口=协议文+ui.bases_text_protocol+第二口负向照旧+旧库回退;
②恰 4 段解析断言;③透明组合(风格+透明承载)/带背景组合(风格+底色);④legacy
无标记全文一字不变。谁改协议格式/拆装口径/回退行为,这里红。
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from engines.comfyui.my_nodes.nodes import my_qi21_api_pe as mod

_NODE_BT = Path(__file__).resolve().parents[1] / "nodes" / "my_qi21_bases_text.py"
_spec = importlib.util.spec_from_file_location("my_qi21_bases_text_uut_p1009", _NODE_BT)
bt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bt)

_BASES_JSON = (Path(__file__).resolve().parents[6] /
               "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json")
_ASB = json.loads(_BASES_JSON.read_text(encoding="utf-8"))["art_style_base"]
_STYLE = str(_ASB["positive_style_text"]).strip()
_GROUND = str(_ASB["positive_ground_text"]).strip()
_RGBA = str(_ASB["rgba_text"]).strip()
_NEG = str(_ASB["negative_text"]).strip()
_PROTO = (f"【风格工艺件】{_STYLE}\n【底色背景件】{_GROUND}\n"
          f"【透明承载件】{_RGBA}\n【负向词表】{_NEG}")
_TAGS = ("【风格工艺件】", "【底色背景件】", "【透明承载件】", "【负向词表】")

_SUBJ = "一柄传承千年的青铜剑，剑身暗金底色上盘绕细密云雷纹。"
_TYPE_POS = "主体的尺寸标注设定图：器物主体以正侧面平视图水平居中平放。"
_DEAD_URL = "http://127.0.0.1:9"  # 确定性不可达→必走透传分支(回退=direct 直出)


def _fire(transparent: bool, style_wired: str, neg_wired: str | None = None,
          extra_neg: str | None = None):
    node = mod.MyQi21ApiPE()
    kw = {"美术风格底座-正向": style_wired, "美术风格底座-负向": neg_wired}
    if extra_neg is not None:
        kw["负向提示词"] = extra_neg
    out = node.rewrite(正向提示词=_SUBJ, 类型句正向=_TYPE_POS, 类型句负向="甲型负面",
                       画幅宽=1024, 画幅高=1024, 透明模式=transparent,
                       api_url=_DEAD_URL, timeout_sec=3, **kw)
    return out["result"]


# ── ①[4032] 主口=协议文 ────────────────────────────────────────────────

def test_pieces_node_outputs_protocol_main_port():
    """[4032] 主口=四段标记协议文;ui 三载荷齐;第二口负向照旧(兼容旧消费)。"""
    node = bt.MyQi21美术风格底座()
    opt = node.INPUT_TYPES()["optional"]
    assert list(opt)[-1] == "四段协议", "「四段协议」框应尾追(旧四值存档按位零错位)"
    assert opt["四段协议"][0] == "STRING" and opt["四段协议"][1].get("multiline") is True
    out = node.output()
    text, neg = out["result"]
    assert text == _PROTO, "主口应=四段协议文逐字节(与真源现值拼装)"
    lines = text.split("\n")
    assert len(lines) == 4 and [ln[:len(t)] for ln, t in zip(lines, _TAGS)] == list(_TAGS), \
        "四段各占一行且带标记"
    ui = out["ui"]
    assert ui["bases_text_protocol"] == [text] == ui["bases_text"], "ui 协议载荷应与主口同文"
    assert ui["bases_text_style"] == [str(_ASB["positive_style_text"])]
    assert ui["bases_text_ground"] == [str(_ASB["positive_ground_text"])]
    assert ui["bases_text_rgba"] == [str(_ASB["rgba_text"])]
    assert neg == _NEG, "负向词表输出槽(第二口)照旧输出 negative"


def test_pieces_node_old_library_fallback_fulltext_no_marker(tmp_path, monkeypatch, capsys):
    """旧库缺拆分字段:主口回退=全文不加标记+响亮提示(不产半截协议)。"""
    old_lib = tmp_path / "qi21_bases.json"
    old_lib.write_text(json.dumps({"art_style_base": {
        "positive_text": "旧库全文底座。", "negative_text": "旧库负向"}}, ensure_ascii=False),
        encoding="utf-8")
    monkeypatch.setattr(bt, "_BASES_JSON", old_lib)
    monkeypatch.setattr(bt, "_cache", {"mtime": None, "data": None})
    out = bt.MyQi21美术风格底座().output()
    text, neg = out["result"]
    assert text == "旧库全文底座。", "旧库应回退全文不加标记"
    assert "【风格工艺件】" not in text
    assert out["ui"]["bases_text_protocol"] == [text]
    assert neg == "旧库负向"
    assert "缺拆分字段" in capsys.readouterr().out, "回退必须响亮 print"


# ── ②恰 4 段解析断言 ──────────────────────────────────────────────────

def test_parse_exact_four_segments():
    """恰 4 段拆解:每段去标记取正文(strip);非协议/坏协议=None。"""
    p = mod._parse_bases_protocol(_PROTO)
    assert p == {"style": _STYLE, "ground": _GROUND, "rgba": _RGBA, "neg": _NEG}
    assert mod._parse_bases_protocol("旧线全文无标记底座") is None, "无标记=legacy"
    assert mod._parse_bases_protocol(None) is None and mod._parse_bases_protocol("") is None
    bad = "【风格工艺件】甲\n【底色背景件】乙\n【透明承载件】丙"  # 3段坏协议
    assert mod._parse_bases_protocol(bad) is None, "段数≠4(恰4段断言)=按 legacy 全文直通"


# ── ③透明组合 / 带背景组合 ────────────────────────────────────────────

def test_protocol_opaque_direct_is_style_plus_ground():
    """带背景组合(透明关):direct=主体句\\n型底座\\n风格段+底色段(逐字节);
    负向=型负在前+协议负向段在后(替换 style_base_neg 连线位,次序照旧)。"""
    proto_neg_wired = "旧连线负向词,不该出现"
    pos, neg, tm, w, h = _fire(False, _PROTO, neg_wired=proto_neg_wired,
                               extra_neg="丙外部负面")
    assert pos == f"主体句:{_SUBJ}\n类型句:{_TYPE_POS}\n{_STYLE}{_GROUND}", "带背景组合=风格段+底色段逐字节(1009段标签)"
    assert "【" not in pos, "标记不得泄入装配文"
    proto_toks = [t.strip() for t in _NEG.replace("，", ",").split(",") if t.strip()]
    toks = neg.split(", ")
    assert toks[0] == "甲型负面", "型负在前(次序照旧)"
    assert toks[1:1 + len(proto_toks)] == proto_toks, "协议负向段紧随型负(替换 style_base_neg 位)"
    assert "旧连线负向词" not in toks and "不该出现" not in toks, \
        "协议负向段应替换连线槽旧值(不双载)"
    assert toks[-1] == "丙外部负面", "外部负向殿后"
    assert tm is False and w == 1024 and h == 1024


def test_protocol_transparent_base_segment_excludes_ground():
    """透明组合:底座段=风格段+透明承载段(零底色/背景词);带背景组合=风格+底色。"""
    p = mod._parse_bases_protocol(_PROTO)
    seg_t = mod._proto_base_segment(p, True)
    seg_f = mod._proto_base_segment(p, False)
    assert seg_t == _STYLE, "透明组合=仅风格段(1008架构令:透明语义零入PE,由[4014]程序化包裹)"
    assert "平涂" not in seg_t and "底色：浅净哑光" not in seg_t, "底色/背景词不得入透明组合"
    assert seg_f == _STYLE + _GROUND, "带背景组合=风格段+底色段"
    # 透明开+协议接线+PE 不可达:回退极简公式不动(_rgba_lean_pos 热读真源,与协议等价)
    pos, neg, tm, _w, _h = _fire(True, _PROTO)
    assert pos.startswith("This is an RGBA image with transparency.")
    assert pos.endswith("The image has alpha channel and the background is transparent.")
    assert "彩线描" in pos, "极简公式风格托底应随行(协议模式不改变回退公式)"
    assert tm is True


# ── ④legacy 无标记一字不变 ────────────────────────────────────────────

def test_legacy_fulltext_no_marker_unchanged():
    """非协议(值存在但无标记,如 i2i 旧线):现行全文行为一字不变。"""
    fulltext = str(_ASB["positive_text"]).strip()
    pos, neg, tm, _w, _h = _fire(False, fulltext, neg_wired="旧线负向", extra_neg=None)
    assert pos == f"主体句:{_SUBJ}\n类型句:{_TYPE_POS}\n{fulltext}", "legacy 全文直拼(1009段标签)"
    assert "【风格工艺件】" not in pos
    assert neg.startswith("甲型负面, 旧线负向"), "legacy 负向仍走连线位+热读兜底合并"
    assert tm is False


def test_legacy_transparent_hot_combo_still_works():
    """legacy 透明开(无标记):热读组合照旧兜底,回退=极简公式(1008 行为不回退)。"""
    fulltext = str(_ASB["positive_text"]).strip()
    pos, _neg, tm, _w, _h = _fire(True, fulltext)
    assert pos.startswith("This is an RGBA image") and tm is True


# ── ⑤两处卡文快照逐字节锚(值变必重对,技能纪律) ─────────────────────

def test_card_files_carry_protocol_snapshot():
    """t2i 工作流+装配子图两处 [4032]:旧四值=真源现值,第五值=协议文;size 560×760。"""
    for card in ("apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
                 "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"):
        p = Path(__file__).resolve().parents[6] / card
        d = json.loads(p.read_text(encoding="utf-8"))
        sg = d["definitions"]["subgraphs"][0]
        n = [x for x in sg["nodes"] if x.get("id") == 4032][0]
        wv = n["widgets_values"]
        assert len(wv) == 5, f"{p.name} widgets_values 应恰5项"
        assert wv[0] == str(_ASB["positive_style_text"]), f"{p.name} [0] 应=真源风格工艺件"
        assert wv[1] == str(_ASB["positive_ground_text"]), f"{p.name} [1] 应=真源底色背景件"
        assert wv[2] == str(_ASB["rgba_text"]), f"{p.name} [2] 应=真源透明承载件"
        assert wv[3] == str(_ASB["negative_text"]), f"{p.name} [3] 应=真源负向词表"
        assert wv[4] == _PROTO, f"{p.name} [4] 应=协议文逐字节"
        assert n["size"] == [560, 760], f"{p.name} size 应=560×760(第五框同批落刀)"
        # 接线面不漂:4032.0→4013.2 / 4032.1→4013.3
        pe = [x for x in sg["nodes"] if x.get("id") == 4013][0]
        got = {}
        for l in sg["links"]:
            if isinstance(l, dict):
                got[(l["origin_id"], l["origin_slot"])] = (l["target_id"], l["target_slot"])
        assert got[(4032, 0)] == (4013, 2), f"{p.name} 主口应连 [4013] 美术风格底座-正向"
        assert got[(4032, 1)] == (4013, 3), f"{p.name} 负向口应连 [4013] 美术风格底座-负向"
        assert pe["type"] == "MyQi21ApiPE"
