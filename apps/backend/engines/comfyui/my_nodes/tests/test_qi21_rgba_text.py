# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""透明声明句级剔除锁(10-09-qi21-prompt-layer-conflict P5/P6)。

P5:[4013] ApiPE 透明开时 direct 拼「类型句:{base}」整段直塞,型文自带的中文
透明声明句(图为带透明通道…背景透明)入 PE 输入,与 2008 架构令「透明语义全
英文承载、零入 PE」相悖。
P6:MyQi21PromptAssembly 透明路按「行」滤声明,道具型 L0 正文与声明同行
→整行吞没,类型句只剩 57 字。
修=三处共用 _qi21_rgba_text.strip_rgba_decl(按行、行内按「。」句级剔除)。
"""
import importlib.util
import json
import re
from pathlib import Path

from engines.comfyui.my_nodes.nodes import my_qi21_api_pe as pe
from engines.comfyui.my_nodes.nodes import my_qi21_prompt_assembly as asm

_NODES = Path(pe.__file__).resolve().parent
_MARKERS = ("带透明通道", "背景透明")
_DECL = "图为带透明通道的RGBA透明底图，背景透明。"
_SUBJ = "一柄传承千年的青铜剑，剑格铸成兽首衔环。"
_DEAD_URL = "http://127.0.0.1:9"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, _NODES / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _types() -> dict:
    return {t["zh"]: t for t in pe._load_bases_node()["types"] if isinstance(t, dict) and t.get("zh")}


def _transparent_types() -> list:
    return [t for t in _types().values() if t.get("rgba_default") is True]


def _old_lean_extra(text: str) -> str:
    """修前 _rgba_lean_pos 339-342 行口径(字节回归神谕)。"""
    return "".join(s for s in re.split(r"(?<=[。])", text)
                   if "带透明通道" not in s and "背景透明" not in s).strip()


# ── 共享模块 ──────────────────────────────────────────────────────────────

def test_strip_is_sentence_level_not_line_level():
    m = _load("_qi21_rgba_text")
    text = f"首行正文不动。\n同行正文保留，薄透罩染轻敷。{_DECL}\n{_DECL}\n尾行。"
    assert m.strip_rgba_decl(text) == "首行正文不动。\n同行正文保留，薄透罩染轻敷。\n尾行。"


def test_strip_without_markers_is_identity():
    m = _load("_qi21_rgba_text")
    text = "空镜场景，前景、中景、远景三层分明。\n  行首空白原样。"
    assert m.strip_rgba_decl(text) == text
    assert m.strip_rgba_decl("") == ""


def test_strip_matches_old_lean_on_real_rgba_positive():
    m = _load("_qi21_rgba_text")
    for t in _transparent_types():
        rp = str(t.get("rgba_positive") or "").strip()
        assert m.strip_rgba_decl(rp).strip() == _old_lean_extra(rp), t["zh"]


# ── P5:ApiPE 透明开 PE 输入零中文透明声明 ─────────────────────────────────

class _Recorder:
    def __init__(self):
        self.user = []

    def open(self, req, timeout=None):
        body = json.loads(req.data.decode("utf-8"))
        self.user.append(body["messages"][1]["content"])
        raise OSError("测试拦截:不出网")


def _pe_user_input(monkeypatch, type_text: str, transparent: bool) -> str:
    rec = _Recorder()
    monkeypatch.setattr(pe, "_RUNTIME_KEY", None)
    monkeypatch.setattr(pe, "_alive", lambda *_a, **_k: True)
    monkeypatch.setattr(pe, "_LAN_OPENER", rec)
    pe.MyQi21ApiPE().rewrite(正向提示词=_SUBJ, 类型句正向=type_text, 类型句负向="",
                             画幅宽=1024, 画幅高=1024, 透明模式=transparent,
                             api_url=_DEAD_URL, timeout_sec=3)
    assert rec.user, "PE 请求未发出(拦截器未命中)"
    return rec.user[0]


def test_pe_transparent_input_has_no_rgba_decl(monkeypatch):
    for t in _transparent_types():
        user = _pe_user_input(monkeypatch, t["positive_text"], True)
        for mk in _MARKERS:
            assert mk not in user, f"{t['zh']} PE 输入残留透明声明:{mk}"
        assert user.startswith(f"主体句:{_SUBJ}\n类型句:"), t["zh"]


def test_pe_transparent_keeps_prop_body(monkeypatch):
    prop = _types()["道具"]["positive_text"]
    user = _pe_user_input(monkeypatch, prop, True)
    assert "薄透罩染轻敷。" in user and "器物主体以正侧面平视图" in user


def test_pe_opaque_input_type_text_verbatim(monkeypatch):
    scene = _types()["场景"]["positive_text"]
    user = _pe_user_input(monkeypatch, scene, False)
    assert f"类型句:{scene}\n" in user


def test_lean_fallback_byte_identical_to_old_formula():
    """_rgba_lean_pos 改调共享模块后,回退稿与修前口径逐字节一致。"""
    bases = pe._load_bases_node()
    asb = bases.get("art_style_base") or {}
    for t in _transparent_types():
        extra = _old_lean_extra(str(t.get("rgba_positive") or "").strip())
        parts = [p for p in (_SUBJ, extra, str(asb.get("positive_style_text") or "").strip(),
                             str(asb.get("rgba_text") or "").strip()) if p]
        assert pe._rgba_lean_pos(_SUBJ, t["positive_text"]) == " ".join(parts), t["zh"]


# ── P6:装配器透明路不吞道具 L0 正文 ─────────────────────────────────────

def _type_segment(mod, base: str) -> str:
    """装配全文=主体句:…\\n类型句:{base_out}\\n{风格工艺件},切出 base_out。"""
    out = mod.MyQi21PromptAssembly().assemble(BASE=base, BASE负面="", 主体句=_SUBJ)[0]
    head, style = f"主体句:{_SUBJ}\n类型句:", mod._style_combo_transparent()
    assert out.startswith(head) and out.endswith("\n" + style)
    return out[len(head):len(out) - len(style) - 1]


def test_assembly_prop_keeps_l0_body_both_load_paths():
    prop = _types()["道具"]["positive_text"]
    direct_mod = _load("my_qi21_prompt_assembly")  # 单测家法直载腿(无包上下文)
    for mod in (asm, direct_mod):
        seg = _type_segment(mod, prop)
        assert "器物主体以正侧面平视图" in seg and "薄透罩染轻敷。\n" in seg


def test_assembly_transparent_type_segment_has_no_decl():
    for t in _transparent_types():
        seg = _type_segment(asm, t["positive_text"])
        assert seg.strip(), t["zh"]
        for mk in _MARKERS:
            assert mk not in seg, f"{t['zh']} 装配类型句残留透明声明:{mk}"


def test_assembly_opaque_output_unchanged():
    scene = _types()["场景"]["positive_text"]
    lock = "锁层A全文·对拍"
    out = asm.MyQi21PromptAssembly().assemble(BASE=scene, BASE负面="", 主体句=_SUBJ, 锁层A全文=lock)[0]
    assert out == f"主体句:{_SUBJ}\n类型句:{scene}\n{lock}"
