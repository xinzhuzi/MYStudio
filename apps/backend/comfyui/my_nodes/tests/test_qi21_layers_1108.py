# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""1108 装配管线结构化改造契约测试(声明句字段化+层结构体化)。

PRD=.trellis/tasks/11-08-qi21-assembly-structify/prd.md。锁五面:
①真源零声明面:14 型 positive_text/rgba_positive 零「带透明通道/背景透明」
  ——声明句已字段化退役,透明语义由 rgba.head_en/tail_en 英文头尾承载;
②14 型×透明开/关 矩阵:装配出口逐层=真源逐字(style 层=art_style_base、
  type 层=positive_text、subject 层逐字),Assembly 与 ApiPE 双路同锚;
③标点不变性性质测试:任意标点突变(全分号/全逗号/顿号/无句号/句转分号)
  不再改变层完整性——变换不猜结构;
④负面合并单源:粒状切分(全角逗号+换行+顶层半角逗号,括号深度保护)+
  保序去重,双装配位同源同值(旧装配器巨 token 形=两套漂移,随轮退役);
⑤渲染模式字节锚(三层/无底座/风格转换/自由出图/lean)+层可见性显式化
  (全空响亮拒/合法缺席白名单打印可见)。

加载纪律:importlib.util.spec_from_file_location 直载 nodes/ 文件
(不 import my_nodes 包,同 test_my_qi21_prompt_assembly 家法)。
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

_NODES = Path(__file__).resolve().parents[1] / "nodes"
_BASES = (Path(__file__).resolve().parents[5] /
          "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json")
_MARKERS = ("带透明通道", "背景透明")


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"{name}_uut_1108", _NODES / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


layers_mod = _load("_qi21_layers")
asm = _load("my_qi21_prompt_assembly")
pe = _load("my_qi21_api_pe")
fo = _load("my_qi21_final_output")

_DATA = json.loads(_BASES.read_text(encoding="utf-8"))
_TYPES = _DATA["types"]
_STYLE = _DATA["art_style_base"]["positive_text"]
_SNEG = _DATA["art_style_base"]["negative_text"]
_HEAD = _DATA["rgba"]["head_en"]
_TAIL = _DATA["rgba"]["tail_en"]

# 男女主体句各一(实弹同款;须过运行时门禁)
_SUBJ_F = asm._SUBJECT_EXAMPLE
_SUBJ_M = ("一位筑基后期的年轻男修，青玉色道袍束月白腰带，足蹬青布道履，"
           "乌黑长发半束只簪一支素银簪，眉目沉静中带一点锋芒；"
           "他立于山门赭石石阶最上一级，身体正面朝向观者，双臂自然垂落，"
           "右手虚握挂定于腰间的长剑剑鞘上端三分之一处，剑身完整收在鞘中；"
           "视线越过阶下青灰云海望向远处青绿群山，旧金色晨光自左侧斜照。")


def _expected_type_layer(t: dict, subj: str) -> str:
    """期望类型句层:设定卡旗型=条件预解析落定,其余=型文逐字。"""
    pt = t["positive_text"]
    if t.get("subject_first") is True:
        return layers_mod.resolve_card_conditionals(pt, subj)
    return pt


def _expected_full(t: dict, subj: str) -> str:
    pt = t["positive_text"]
    if not pt.strip():  # 自由型=两段降级(档位语义)
        return f"{_STYLE}\n主体句:{subj}"
    return f"{_STYLE}\n类型句:{_expected_type_layer(t, subj)}\n主体句:{subj}"


# ── ① 真源零声明面(声明句字段化手术锁)──────────────────────────────

def test_truth_source_zero_decl_surface():
    """14 型 positive_text/rgba_positive 零声明标记——剥除器对型文正文的
    正则匹配面归零(仅剩 legacy 数据副本兜底);红=手术被回退/新表混入声明。"""
    for t in _TYPES:
        for f in ("positive_text", "rgba_positive"):
            v = t.get(f) or ""
            for m in _MARKERS:
                assert m not in v, f"{t['zh']}/{f} 残留声明标记 {m!r}(1108 字段化被破)"


# ── ② 14 型×透明开/关 矩阵:逐层=真源逐字(双装配位)──────────────────

@pytest.mark.parametrize("t", _TYPES, ids=lambda t: t["zh"])
@pytest.mark.parametrize("transparent", [False, True])
@pytest.mark.parametrize("subj", [_SUBJ_F, _SUBJ_M], ids=["女", "男"])
def test_matrix_assembly_layers_verbatim(t, transparent, subj):
    """装配器出口:style 层=art_style_base 逐字、type 层=型文逐字(设定卡=条件
    落定)、subject 层逐字;透明开/关同锚(透明语义只在 FinalOutput 英文头尾)。"""
    pt, nt = t["positive_text"], t["negative_text"]
    out_full, out_neg = asm.MyQi21PromptAssembly().assemble(
        BASE=pt, BASE负面=nt, 主体句=subj, 锁层A全文=_STYLE)
    assert out_full == _expected_full(t, subj), \
        f"[{t['zh']}] 装配全文逐层漂移(1108 层结构体锚)"
    # 逐层非空可见性(自由型两段降级=档位语义,type 层合法缺席)
    lines = out_full.split("\n")
    assert lines[0] == _STYLE and lines[-1] == f"主体句:{subj}"
    if pt.strip():
        assert f"类型句:{_expected_type_layer(t, subj)}" in out_full


@pytest.mark.parametrize("t", _TYPES, ids=lambda t: t["zh"])
@pytest.mark.parametrize("transparent", [False, True])
def test_matrix_api_pe_direct_layers_verbatim(t, transparent):
    """ApiPE direct 路(AI关直拼):与装配器同一层结构单源渲染——同型同句
    必同文(旧两处各拼各的=漂移温床);透明开/关同锚(剥除对真源恒等)。"""
    pt, nt = t["positive_text"], t["negative_text"]
    res = pe.MyQi21ApiPE().rewrite(
        正向提示词=_SUBJ_F, 类型句正向=pt, 类型句负向=nt,
        透明模式=transparent, AI扩写开关=False, api_url="http://127.0.0.1:9",
        timeout_sec=3, **{"美术风格底座-正向": _STYLE, "美术风格底座-负向": _SNEG})
    pos = res["result"][0]
    assert pos == _expected_full(t, _SUBJ_F).strip(), \
        f"[{t['zh']}] ApiPE 直拼应与装配器同锚(层结构单源,1108)"


@pytest.mark.parametrize("transparent", [False, True])
def test_matrix_negative_single_source_dedup(transparent):
    """负面合并单源:全角清单粒状拆 token+跨源去重(旧装配器巨 token 形
    「模糊」双现在册退役);两装配位同源同值(ApiPE 侧仅多 _sanitize 清洗)。"""
    t = next(x for x in _TYPES if x["zh"] == "无衣物定妆")
    _, neg_asm = asm.MyQi21PromptAssembly().assemble(
        BASE=t["positive_text"], BASE负面=t["negative_text"],
        主体句=_SUBJ_F, 锁层A全文=_STYLE)
    res = pe.MyQi21ApiPE().rewrite(
        正向提示词=_SUBJ_F, 类型句正向=t["positive_text"], 类型句负向=t["negative_text"],
        透明模式=transparent, AI扩写开关=False, api_url="http://127.0.0.1:9",
        timeout_sec=3, **{"美术风格底座-正向": _STYLE, "美术风格底座-负向": _SNEG})
    neg_pe = res["result"][1]
    expect_tokens = layers_mod.merge_negative_tokens(t["negative_text"], _SNEG)
    assert neg_asm == ", ".join(expect_tokens), "装配器负面=单源合并直出"
    assert neg_pe == pe._sanitize_negative(", ".join(expect_tokens)), \
        "ApiPE 负面=同一单源合并+清洗(两路同源)"
    assert neg_asm.count("模糊") == 1, "跨源去重生效(型负面与底座负面各含「模糊」)"


# ── ③ 标点不变性(性质测试:变换不猜结构)─────────────────────────────

def _mutants(pt: str):
    return [
        pt.replace("。", "；"),
        pt.replace("。", "，"),
        pt.replace("。", "、"),
        pt.replace("。", ""),
        pt.replace("；", "。"),
        pt.replace("，", "。"),
    ]


@pytest.mark.parametrize("t", _TYPES, ids=lambda t: t["zh"])
def test_punctuation_never_breaks_layer_integrity(t):
    """型文任意标点突变→入口变换恒等+三层渲染逐层保全。
    1108 病根=按标点猜结构(分号连句糊死吞层);字段化后正文与声明解耦,
    标点组合不再是层完整性的输入。"""
    pt = t["positive_text"]
    if not pt.strip():
        pytest.skip("自由型空正文不适用")
    for m in _mutants(pt):
        assert layers_mod.ingest_type_text(m, context=t["zh"]) == m.strip(), \
            f"[{t['zh']}] 入口变换应对零声明正文恒等(标点无关)"
        L = layers_mod.Qi21Layers(style=_STYLE, type_text=m, subject=_SUBJ_F)
        out = layers_mod.render_t2i(L, context=f"[{t['zh']}·标点突变]")
        assert f"类型句:{m}" in out and out.startswith(_STYLE) and out.endswith(f"主体句:{_SUBJ_F}"), \
            f"[{t['zh']}] 标点突变不得改变层完整性"


def test_legacy_decl_fallback_isolates_declaration_under_any_punct():
    """legacy 数据副本兜底(真源外旧份/手改混入):声明句仍被句级隔离,
    任意标点环境只剔声明不伤正文(存活断言在位)。"""
    body = "全身素体立绘：正面直立站姿；通身素体呈现，零衣物零配饰；全身完整入画；"
    for glue in ("；", "。", "，"):
        decl = f"图为带透明通道的RGBA透明底图，背景透明{glue}"
        assert layers_mod.ingest_type_text(body + decl, context="兜底") == body
    # 分号糊死形(1108 事故同型):声明分句居中,两侧正文保全
    mid = "设定图采用便于辨认结构的均匀漫射光。"
    text = "面部肤色与角色设定一致；图为带透明通道的RGBA透明底图，背景透明；" + mid
    assert layers_mod.ingest_type_text(text, context="糊死") == "面部肤色与角色设定一致；" + mid


# ── ④ 负面合并单源(粒状切分+深度保护+保序去重)───────────────────────

def test_merge_negative_tokens_unified_semantics():
    m = layers_mod.merge_negative_tokens
    assert m("模糊，水印，透视变形", "模糊, 水印",
             "(worst quality, low quality:1.4)\n低分辨率") == (
        "模糊", "水印", "透视变形",
        "(worst quality, low quality:1.4)", "低分辨率"), \
        "全角/换行/半角三界切分+括号深度保护(权重组建制不得拆)+保序去重"
    assert m("", "") == ()
    assert m("  ") == ()


# ── ⑤ 渲染模式字节锚+层可见性显式化+FinalOutput 包裹──────────────────

def test_render_mode_byte_anchors():
    L = layers_mod.Qi21Layers(style="S", type_text="T", subject="X")
    assert layers_mod.render_t2i(L, context="锚") == "S\n类型句:T\n主体句:X"
    assert layers_mod.render_t2i(
        layers_mod.Qi21Layers(type_text="T", subject="X"), context="锚") == "类型句:T\n主体句:X"
    assert layers_mod.render_t2i(
        layers_mod.Qi21Layers(style="S", subject="X"), context="锚") == "S\n主体句:X"
    assert layers_mod.render_style_swap(
        layers_mod.Qi21Layers(style="S", subject="X"), context="锚") == "X\nS"
    assert layers_mod.render_free(
        layers_mod.Qi21Layers(subject="X"), context="锚") == "X"
    assert layers_mod.render_lean(
        ["B", "", "T", "E", "C"], context="锚") == "B T E C"
    assert layers_mod.render_lean([], context="锚").startswith("A single game asset"), \
        "lean 全空=官方英文兜底句"


def test_render_all_empty_raises_loudly():
    with pytest.raises(RuntimeError, match="层"):
        layers_mod.render_t2i(layers_mod.Qi21Layers(), context="全空")


def test_render_legal_absence_prints_visibility(capsys):
    """合法缺席(裸测 style 空/降级 type 空)打印中文可见警告,不静默。"""
    out = layers_mod.render_t2i(
        layers_mod.Qi21Layers(type_text="T", subject="X"), context="[裸测]")
    assert out == "类型句:T\n主体句:X"
    assert "美术风格底座" in capsys.readouterr().out
    out = layers_mod.render_t2i(
        layers_mod.Qi21Layers(style="S", subject="X"), context="[降级]")
    assert out == "S\n主体句:X"
    assert "类型句" in capsys.readouterr().out


def test_card_resolver_single_source_provenance():
    """设定卡条件预解析收编单源:两装配位的解析器同出 _qi21_layers.py
    (旧两份手工逐句同步复制=漂移温床,1108 收编)。"""
    for mod in (asm, pe):
        fn = getattr(mod, "resolve_card_conditionals", None) or getattr(mod, "_resolve_card_conditionals")
        assert fn.__code__.co_filename.endswith("_qi21_layers.py"), \
            f"{mod.__name__} 的设定卡解析器应出自 _qi21_layers.py 单源"


@pytest.mark.parametrize("subj", [_SUBJ_F, _SUBJ_M], ids=["女", "男"])
@pytest.mark.parametrize("transparent", [False, True])
def test_final_output_english_wrap_matrix(subj, transparent):
    """无衣物定妆×男女×透明开/关:进编码正向=装配全文(透明开=英文官方
    头尾各一次;透明关=原样)——中文声明零在场。"""
    t = next(x for x in _TYPES if x["zh"] == "无衣物定妆")
    full, neg = asm.MyQi21PromptAssembly().assemble(
        BASE=t["positive_text"], BASE负面=t["negative_text"],
        主体句=subj, 锁层A全文=_STYLE)
    pos, neg_out = fo.MyQi21FinalOutput().compose(
        正向提示词=full, 负向提示词=neg, 透明模式=transparent)
    if transparent:
        assert pos == f"{_HEAD} {full} {_TAIL}"
    else:
        assert pos == full
    assert neg_out == neg
    for m in _MARKERS:
        assert m not in pos, f"进编码正向不得含中文声明 {m!r}(透明语义全英文承载)"
    assert subj[:10] in pos and t["positive_text"][:10] in pos, "主体句/类型句层保全"
