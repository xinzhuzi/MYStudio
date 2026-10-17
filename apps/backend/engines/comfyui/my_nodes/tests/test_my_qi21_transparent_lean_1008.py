# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""透明极简回退回归锁(1008 R3九型实弹定谳后的修复锁;1009晚修形态重锚)。

R3定谳:富装配17句画背景命令以6.7~8.3:1兵力比淹没透明指令(道具全透
4.98%/三型0.00%,同seed四连复现)——透明开时,PE失败的一切回退稿必须=
极简公式,不得放行富装配。回归锁:谁把回退改回直接透传富装配,这里红。

1009晚修(用户令「修」,10-09层冲突治理 a124896e 收口单源)后公式形态:
主体句 + 型文rgba_positive(句级剥中文透明声明) + 风格工艺件(positive_
style_text) + 透明承载件(rgba.subject_isolation英文尾),零自带头尾——官方头尾由
[4014]FinalOutput统一包裹各一次(治双头双尾),透明语义全英文承载。
"""

import json
from pathlib import Path

from engines.comfyui.my_nodes.nodes import my_qi21_api_pe as mod

_BASES = (Path(__file__).resolve().parents[6] /
          "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json")
_ART = json.loads(_BASES.read_text(encoding="utf-8"))["art_style_base"]
_STYLE = _ART["positive_text"]
_FULL = _ART["positive_text"]

_SUBJ = ("一柄传承千年的青铜剑，剑身暗金底色上盘绕细密云雷纹，剑格铸成兽首衔环，"
         "剑柄缠深红丝绳，穗尾垂一枚带裂纹的灵玉。")
_TYPE_POS = "主体的器物设定图：器物主体以正侧面平视图水平居中平放，图为带透明通道的 RGBA 透明底图，背景透明。"
_TYPE_NEG = "模糊，水印，透视变形"
_DEAD_URL = "http://127.0.0.1:9"  # 确定性不可达→必走透传分支


def _fire(transparent: bool):
    node = mod.MyQi21ApiPE()
    out = node.rewrite(正向提示词=_SUBJ, 类型句正向=_TYPE_POS, 类型句负向=_TYPE_NEG,
                       画幅宽=1024, 画幅高=1024, 透明模式=transparent,
                       api_url=_DEAD_URL, timeout_sec=3)
    return out["result"]


def test_transparent_passthrough_is_lean_formula():
    """透明开+PE不可达:回退稿=极简公式(1009晚修形态:主体句打头+透明承载件英文尾,零自带头尾)。"""
    pos, neg, tm, w, h = _fire(True)
    assert pos.startswith(_SUBJ), "极简公式主体句打头(1009晚修②:零自带头,头尾归[4014]统一包裹)"
    assert pos.endswith("isolated on pure transparency."), "透明承载件(rgba_text)英文尾收尾"
    assert "This is an RGBA image" not in pos and "The image has alpha channel" not in pos, \
        "官方头尾句不得自带(治lean自带+4014再包=双头双尾叠加)"
    assert "青铜剑" in pos and "云雷纹" in pos, "主体句必须原样夹入"
    assert _STYLE in pos, "底座风格工艺托底应随行(1008晚三件拆分)"
    for bad in ("背景透明", "透明通道"):
        assert bad not in pos, f"中文透明声明应句级剥除(1009晚修①,透明语义全英文承载): {bad}"
    for bad in ("平涂", "山水", "底色：浅净哑光", "大色面", "多色相铺陈", "旧段名·风格底座：现代", "细密分染"):
        assert bad not in pos, f"背景词泄漏: {bad}"
    assert tm is True and w == 1024 and h == 1024
    assert "透视变形" in neg, "负向=三源合并不受影响"


def test_opaque_passthrough_unchanged_full_assembly():
    """透明关:透传行为不变(富装配三层,主体句开头)——修复只作用于透明开。"""
    pos, neg, tm, _w, _h = _fire(False)
    assert pos.startswith("类型句:") and pos.endswith("主体句:" + _SUBJ), "透明关=富装配直出(1017 反序令:类型句打头,主体句收尾;透明极简公式不在令内)"
    assert _FULL not in pos, "1017 用户裁定:底座槽缺席=底座离场(不硬塞)"
    assert tm is False


def test_lean_zero_own_head_tail():
    """极简公式零自带头尾,各部件热读真源(非硬编码)。

    1009晚修②:官方头尾(head_en/tail_en)退役出本路,由[4014]FinalOutput
    统一包裹各一次;本路只拼主体句+风格工艺件+透明承载件真源现值。
    """
    s = mod._rgba_lean_pos(_SUBJ)
    assert s.startswith(_SUBJ), "主体句打头(零自带头)"
    assert "This is an RGBA image" not in s and "The image has alpha channel" not in s, \
        "官方头尾句不得自带(2008→1009晚修:零自带头尾)"
    assert "isolated on pure transparency" in s, "透明承载件=真源rgba.subject_isolation热读"
    assert _STYLE in s, "风格工艺件=真源positive_text热读"


def test_lean_carries_type_rgba_positive_framing():
    """型文逐字命中真源 types[] 时,极简公式体携带该型 rgba_positive 格式锁。

    R3 多视图教训:网格/标注等构图格式锁住型文,极简路丢弃型文=透明但内容
    契约崩(单人而非多视图)。rgba_positive 让格式锁随行,绘画词仍不得入内。
    """
    import json
    from pathlib import Path
    jp = (Path(__file__).resolve().parents[6] /
          "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json")
    types = json.loads(jp.read_text(encoding="utf-8"))["types"]
    prop = next(t for t in types if t["zh"] == "道具")
    pos = mod._rgba_lean_pos(_SUBJ, prop["positive_text"])
    assert "器物设定图" in pos, "rgba_positive 格式锁应随行"
    assert "背景透明" not in pos and "透明通道" not in pos, \
        "rgba_positive自带中文透明声明句级剥除(1009晚修①,透明语义全英文承载)"
    assert _STYLE in pos, "风格工艺件(positive_text)托底应随行(1008晚用户令拆分)"
    for bad in ("薄透罩染轻敷", "多色相铺陈", "平涂", "旧段名·风格底座：现代", "底色：浅净哑光", "大色面"):
        assert bad not in pos, f"绘画/背景词泄漏: {bad}"


def test_assembly_splits_style_for_transparent_types():
    """1008晚三件拆分(节点主路):BASE=透明型 → 底座段=风格工艺件+透明承载件;BASE=带背景型 → 锁层A全文原样。"""
    from engines.comfyui.my_nodes.nodes import my_qi21_base, my_qi21_prompt_assembly as asm
    node = asm.MyQi21PromptAssembly()
    # 1017:六出解包(第六出型名=base 入参原值直通,本测试零消费故落 _)
    bt_prop, _, _, neg_prop, _, _ = my_qi21_base.MyQi21DaojieBase().run("道具")
    pos, _neg = node.assemble(BASE=bt_prop, BASE负面=neg_prop, 主体句=_SUBJ)
    assert _STYLE in pos and "pure transparency" not in pos.split("风格底座")[0], "透明型装配=风格件托底,承载句零入PE([4014]包裹承担,1008架构令)"
    for bad in ("平涂", "底色：浅净哑光", "大色面"):
        assert bad not in pos, f"透明型装配泄漏背景词: {bad}"
    bt_rw, _, _, neg_rw, _, _ = my_qi21_base.MyQi21DaojieBase().run("人物")
    pos2, _ = node.assemble(BASE=bt_rw, BASE负面=neg_rw, 主体句=_SUBJ)
    assert _FULL in pos2, "带背景型锁层A全文原样(positive_text 字节不变)"
