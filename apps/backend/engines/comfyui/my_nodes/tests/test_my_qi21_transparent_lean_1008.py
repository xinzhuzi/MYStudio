# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""透明极简回退回归锁(1008 R3九型实弹定谳后的修复锁)。

R3定谳:富装配17句画背景命令以6.7~8.3:1兵力比淹没透明指令(道具全透
4.98%/三型0.00%,同seed四连复现)——透明开时,PE失败的一切回退稿必须=
极简公式(head_en+主体句+tail_en;0927d实测90.34%透明),不得放行富装配。
回归锁:谁把回退改回直接透传富装配,这里红。
"""

from engines.comfyui.my_nodes.nodes import my_qi21_api_pe as mod

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
    """透明开+PE不可达:回退稿=极简公式(头英句+主体句+尾英句),零底座/型文绘画词。"""
    pos, neg, tm, w, h = _fire(True)
    assert pos.startswith("This is an RGBA image with transparency.")
    assert pos.endswith("The image has alpha channel and the background is transparent.")
    assert "青铜剑" in pos and "云雷纹" in pos, "主体句必须原样夹入"
    assert "彩线描" in pos and "工笔线条质量" in pos, "底座风格工艺托底应随行(1008晚三件拆分)"
    for bad in ("平涂", "山水", "底色：浅净哑光", "大色面", "多色相铺陈", "美术风格底座", "细密分染"):
        assert bad not in pos, f"背景词泄漏: {bad}"
    assert tm is True and w == 1024 and h == 1024
    assert "透视变形" in neg, "负向=三源合并不受影响"


def test_opaque_passthrough_unchanged_full_assembly():
    """透明关:透传行为不变(富装配三层,主体句开头)——修复只作用于透明开。"""
    pos, neg, tm, _w, _h = _fire(False)
    assert pos.startswith("一柄传承千年的青铜剑"), "透明关=富装配直出(主体句打头)"
    assert "平涂" in pos and "风格底座" in pos, "透明关=底座照挂"
    assert tm is False


def test_lean_uses_truth_source_head_tail():
    """极简公式头尾取 rgba 真源节热读(head_en/tail_en),非硬编码。"""
    assert mod._rgba_lean_pos(_SUBJ).startswith("This is an RGBA image")
    assert "the background is transparent" in mod._rgba_lean_pos(_SUBJ)  # 1008 官方尾句词序


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
    assert "背景透明" in pos
    assert "彩线描" in pos and "罩染通透细腻" in pos, "底座rgba_text风格托底应随行(1008晚用户令拆分)"
    for bad in ("薄透罩染轻敷", "多色相铺陈", "平涂", "美术风格底座", "底色：浅净哑光", "大色面"):
        assert bad not in pos, f"绘画/背景词泄漏: {bad}"


def test_assembly_splits_style_for_transparent_types():
    """1008晚三件拆分(节点主路):BASE=透明型 → 底座段=风格工艺件+透明承载件;BASE=带背景型 → 锁层A全文原样。"""
    from engines.comfyui.my_nodes.nodes import my_qi21_base, my_qi21_prompt_assembly as asm
    node = asm.MyQi21PromptAssembly()
    bt_prop, _, _, neg_prop, _ = my_qi21_base.MyQi21DaojieBase().run("道具")
    pos, _neg = node.assemble(BASE=bt_prop, BASE负面=neg_prop, 主体句=_SUBJ)
    assert "彩线描" in pos and "pure transparency" not in pos.split("风格底座")[0], "透明型装配=风格件托底,承载句零入PE([4014]包裹承担,1008架构令)"
    for bad in ("平涂", "底色：浅净哑光", "大色面"):
        assert bad not in pos, f"透明型装配泄漏背景词: {bad}"
    bt_rw, _, _, neg_rw, _ = my_qi21_base.MyQi21DaojieBase().run("人物")
    pos2, _ = node.assemble(BASE=bt_rw, BASE负面=neg_rw, 主体句=_SUBJ)
    assert "平涂" in pos2 and "底色：浅净哑光" in pos2, "带背景型锁层A全文原样(positive_text 字节不变)"
