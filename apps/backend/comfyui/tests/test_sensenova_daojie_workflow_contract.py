# -*- coding: utf-8 -*-
"""SenseNova 道劫产线契约测试(1126 道劫范式 × SenseNova-U1.6 役)。

覆盖四物(design §6 十项):
  1. sensenova-道劫-t2i.json / -i2i.json(画布件):加载器锚/Turbo 双臂语义/
     32 对齐节点/装配连线契约/装配 widget 默认/零负区/例句与底座逐字真源/
     i2i 参考图链与指令反双写
  2. 两件 -api.json(直投模板):注入锚/与画布件节点集合一致(除 MarkdownNote)
  3. sensenova_daojie_build_1126.py(生成器):文件 ≈ 重导出(幂等字节)
  4. 例句真源:画布默认主体句 == docs/prompts/道劫_类型主体句示例.md §1 代码块逐字

纪律:四件工作流均=生成器产物(幂等字节),本测试同时钉「文件≈生成器重导出」防手改漂移。
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]  # tests/ -> comfyui/ -> backend
REPO = BACKEND.parents[1]
GEN = REPO / "apps/build/scripts/sensenova_daojie_build_1126.py"
WF = REPO / "apps/backend/comfyui/workflows/1_图片/SenseNova"
MD = REPO / "docs/prompts/道劫_类型主体句示例.md"
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
T2I = WF / "1_文生图/sensenova-道劫-t2i.json"
T2I_API = WF / "1_文生图/sensenova-道劫-t2i-api.json"
I2I = WF / "2_图生图/sensenova-道劫-i2i.json"
I2I_API = WF / "2_图生图/sensenova-道劫-i2i-api.json"
ARTIFACTS = [T2I, T2I_API, I2I, I2I_API]

CKPT = "sensenova_u1.6_8b_mot_int8_convrot.safetensors"
LORA = "sensenova_u1.6_8b_mot_8step_lora_bf16.safetensors"
ALIGN_EXPR = "floor(a / 32) * 32"


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _node(d: dict, nid: int) -> dict:
    hits = [n for n in d["nodes"] if n["id"] == nid]
    assert len(hits) == 1, f"节点 {nid} 应恰一个,实得 {len(hits)}"
    return hits[0]


def _link(d: dict, nid: int, name: str):
    """节点 nid 名为 name 的输入连线 →(源节点 id, 源槽);未连线返回 None。"""
    hits = [i for i in _node(d, nid).get("inputs", []) if i.get("name") == name]
    assert len(hits) == 1, f"节点 {nid} 输入 {name} 应恰一个,实得 {len(hits)}"
    link = hits[0].get("link")
    if link is None:
        return None
    for l in d["links"]:
        if l[0] == link:
            return (l[1], l[2])
    raise AssertionError(f"连线 {link} 在 links 表缺失(节点 {nid}.{name})")


def _src_expr(d: dict, nid: int, name: str) -> str:
    """节点 nid 输入 name 的来源,形如「[源id].输出名」。

    links 表 l[2]=数字槽(官方约定);此处按源节点 outputs 的 slot_index
    反查输出名,断言里用名字不角标,防「槽位回指错」这类静默漂移。
    """
    got = _link(d, nid, name)
    assert got is not None, f"节点 {nid}.{name} 应连线"
    src_id, src_slot = got
    src_node = _node(d, src_id)
    outs = src_node.get("outputs", [])
    for o in outs:
        if o.get("slot_index") == src_slot:
            return f"[{src_id}].{o.get('name')}"
    # 正典约定(qi21-道劫-i2i [4011] 同款):outputs 缺 slot_index 时前端按顺序推断
    if 0 <= src_slot < len(outs):
        return f"[{src_id}].{outs[src_slot].get('name')}"
    return f"[{src_id}].#{src_slot}"


def _subject_example() -> str:
    md = MD.read_text(encoding="utf-8")
    m = re.search(r"## 1\. 人物海报[^\n]*\n+```(?:text)?\n(.*?)\n```", md, re.S)
    assert m, "例句库 §1 代码块未命中"
    return m.group(1)


# ── 1. 加载器锚 ─────────────────────────────────────────────────────
class TestLoaders:
    @pytest.mark.parametrize("path", [T2I, I2I])
    def test_ckpt_and_lora_anchors(self, path):
        d = _load(path)
        assert _node(d, 8 if "t2i" in path.name else 7)["widgets_values"] == [CKPT]
        lora = _node(d, 9 if "t2i" in path.name else 8)
        assert lora["widgets_values"][0] == LORA and lora["widgets_values"][1] == 1
        assert _src_expr(d, lora["id"], "model") == (
            f"[{lora['id'] - 1}].MODEL")

    @pytest.mark.parametrize("path", [T2I_API, I2I_API])
    def test_api_loader_anchors(self, path):
        d = _load(path)
        ck = [k for k, v in d.items() if k != "_doc" and v["class_type"] == "CheckpointLoaderSimple"]
        assert len(ck) == 1 and d[ck[0]]["inputs"]["ckpt_name"] == CKPT
        lo = [k for k, v in d.items() if k != "_doc" and v["class_type"] == "LoraLoaderModelOnly"]
        assert len(lo) == 1
        assert d[lo[0]]["inputs"]["lora_name"] == LORA
        assert d[lo[0]]["inputs"]["strength_model"] == 1

    def test_preview_is_output_node_and_wired(self):
        for d, pid, aid in ((_load(T2I), 5, 4), (_load(I2I), 4, 3)):
            prev = _node(d, pid)
            assert _link(d, pid, "正向提示词") == (aid, 0)
            assert _link(d, pid, "负向提示词") == (aid, 1)

    def test_my_nodes_registered(self):
        from comfyui.my_nodes import NODE_CLASS_MAPPINGS  # noqa: F401 (conftest 已垫 comfy_api 桩)
        for cls in ("MyQi21DaojieBase", "MyQi21PromptAssembly", "MyQi21PromptPreview"):
            assert cls in NODE_CLASS_MAPPINGS, cls


# ── 2. Turbo 双臂语义 ───────────────────────────────────────────────
class TestDualArm:
    @pytest.mark.parametrize(
        "path,flag,steps_t,steps_f,cfg_t,cfg_f,ks,s_model,s_steps,s_cfg,ckpt_id,lora_id",
        [(T2I, 10, 11, 12, 13, 14, 22, 15, 16, 17, 8, 9),
         (I2I, 9, 10, 11, 12, 13, 25, 14, 15, 16, 7, 8)])
    def test_turbo_switch_semantics(self, path, flag, steps_t, steps_f, cfg_t, cfg_f, ks,
                                    s_model, s_steps, s_cfg, ckpt_id, lora_id):
        d = _load(path)
        assert _node(d, flag)["widgets_values"] == [True], "Turbo 默认应为 true(24G 实测口径)"
        assert _node(d, steps_t)["widgets_values"][0] == 8
        assert _node(d, steps_f)["widgets_values"][0] == 50
        assert _node(d, cfg_t)["widgets_values"] == [1]
        assert _node(d, cfg_f)["widgets_values"] == [4]
        assert _src_expr(d, s_model, "switch") == f"[{flag}].BOOLEAN"
        assert _src_expr(d, s_model, "on_false") == f"[{ckpt_id}].MODEL"
        assert _src_expr(d, s_model, "on_true") == f"[{lora_id}].MODEL"
        assert _src_expr(d, s_steps, "on_false") == f"[{steps_f}].INT"
        assert _src_expr(d, s_steps, "on_true") == f"[{steps_t}].INT"
        assert _src_expr(d, s_cfg, "on_false") == f"[{cfg_f}].FLOAT"
        assert _src_expr(d, s_cfg, "on_true") == f"[{cfg_t}].FLOAT"
        k = _node(d, ks)
        assert k["widgets_values"][2:] == [8, 1, "euler", "simple", 1]
        assert k["widgets_values"][1] == "fixed"
        assert _src_expr(d, ks, "steps") == f"[{s_steps}].output"
        assert _src_expr(d, ks, "cfg") == f"[{s_cfg}].output"

    @pytest.mark.parametrize("path,seed_id,ks", [(T2I, 21, 22), (I2I, 24, 25)])
    def test_seed_fixed_and_wired(self, path, seed_id, ks):
        d = _load(path)
        assert _node(d, seed_id)["widgets_values"] == [42, "fixed"]
        assert _src_expr(d, ks, "seed") == f"[{seed_id}].INT"


# ── 3. 32 对齐节点 ──────────────────────────────────────────────────
class TestAlign:
    def test_t2i_align_chain(self):
        d = _load(T2I)
        for nid, src_slot in ((18, 1), (19, 2)):
            m = _node(d, nid)
            assert m["widgets_values"] == [ALIGN_EXPR]
            assert _src_expr(d, nid, "values.a") == f"[1].{('WIDTH', 'HEIGHT')[src_slot - 1]}"
        assert _src_expr(d, 20, "width") == "[18].INT"
        assert _src_expr(d, 20, "height") == "[19].INT"

    def test_i2i_latent_follows_reference(self):
        d = _load(I2I)
        assert _src_expr(d, 21, "width") == "[20].width"
        assert _src_expr(d, 21, "height") == "[20].height"
        assert _src_expr(d, 20, "image") == "[19].resized"


# ── 4. 装配连线契约 ─────────────────────────────────────────────────
class TestAssemblyWiring:
    def test_t2i_assembly_chain(self):
        d = _load(T2I)
        assert _src_expr(d, 4, "BASE") == "[1].BASE"
        assert _src_expr(d, 4, "BASE负面") == "[1].负面词"
        assert _src_expr(d, 4, "主体句") == "[2].STRING"
        assert _src_expr(d, 4, "锁层A全文") == "[3].STRING"
        assert _src_expr(d, 6, "text") == "[4].装配全文"
        assert _src_expr(d, 7, "text") == "[4].负面词"
        assert _src_expr(d, 6, "clip") == "[8].CLIP"
        assert _src_expr(d, 7, "clip") == "[8].CLIP"

    def test_i2i_assembly_chain(self):
        d = _load(I2I)
        assert _src_expr(d, 3, "BASE") == "[1].BASE"
        assert _src_expr(d, 3, "BASE负面") == "[1].负面词"
        assert _src_expr(d, 3, "主体句") == "[2].STRING"
        assert _src_expr(d, 5, "text") == "[3].装配全文"
        assert _src_expr(d, 6, "text") == "[3].负面词"
        cond = _node(d, 23)
        assert cond["widgets_values"][0] == "image"
        assert _src_expr(d, 23, "conditioning") == "[22].positive"
        assert _src_expr(d, 23, "negative") == "[22].negative"
        assert _src_expr(d, 23, "clip") == "[7].CLIP"


# ── 5. 装配 widget 默认值与真源逐字 ─────────────────────────────────
class TestAssemblyDefaults:
    def test_t2i_purpose_and_subject_from_md(self):
        d = _load(T2I)
        a = _node(d, 4)
        assert len(a["widgets_values"]) == 6
        assert a["widgets_values"][5] == "道劫美术类型"
        assert a["widgets_values"][2] == _subject_example()
        assert _node(d, 2)["widgets_values"][0] == _subject_example()

    def test_i2i_purpose_and_no_style_double_write(self):
        d = _load(I2I)
        a = _node(d, 3)
        assert len(a["widgets_values"]) == 6
        assert a["widgets_values"][5] == "道劫美术风格转换"
        instr = _node(d, 2)["widgets_values"][0]
        style = _load(BASES)["art_style_base"]["positive_text"]
        # 09 篇 §三.1 底座禁双写:指令不得复述画法词,画法由装配追加
        for w in ("国风二维动漫手绘插画", "白描", "工笔", "连环画", "厚涂", "赛璐璐"):
            assert w not in instr, f"指令双写画风词:{w}"
        assert a["widgets_values"][4] == style
        # 09 篇 §四:操作段与保真段两段必须在场
        assert "保持不变" in instr or "保持原样" in instr
        assert ("保留" in instr) or ("保真" in instr)

    def test_daojie_base_default_type(self):
        for d in (_load(T2I), _load(I2I)):
            assert _node(d, 1)["widgets_values"] == ["人物海报", False]


# ── 6. i2i 参考图链 ─────────────────────────────────────────────────
class TestI2IReferenceChain:
    def test_reference_chain(self):
        d = _load(I2I)
        assert _node(d, 17)["widgets_values"][0] == "sensenova_u16_edit_women_in_car.png"
        assert _node(d, 18)["widgets_values"][:2] == ["scale total pixels", 4]
        assert _node(d, 19)["widgets_values"][:2] == ["scale to multiple", 32]
        assert _src_expr(d, 18, "input") == "[17].IMAGE"
        assert _src_expr(d, 19, "input") == "[18].resized"
        assert _src_expr(d, 22, "images.image_1") == "[19].resized"
        assert _src_expr(d, 22, "positive") == "[5].CONDITIONING"
        assert _src_expr(d, 22, "negative") == "[6].CONDITIONING"
        assert _src_expr(d, 25, "positive") == "[23].conditioning"
        assert _src_expr(d, 25, "negative") == "[23].negative"


# ── 7. 输出与画布卫生 ───────────────────────────────────────────────
class TestCanvasHygiene:
    @pytest.mark.parametrize("path,prefix", [(T2I, "sensenova_daojie/"), (I2I, "sensenova_daojie_i2i/")])
    def test_save_prefix(self, path, prefix):
        d = _load(path)
        saves = [n for n in d["nodes"] if n["type"] == "SaveImage"]
        assert len(saves) == 1 and saves[0]["widgets_values"] == [prefix]

    @pytest.mark.parametrize("path", [T2I, I2I])
    def test_no_negative_coords(self, path):
        d = _load(path)
        for n in d["nodes"]:
            assert n.get("pos", [0, 0])[0] >= 0 and n.get("pos", [0, 0])[1] >= 0, f"节点 {n['id']} 负坐标"

    def test_notes_present(self):
        for d in (_load(T2I), _load(I2I)):
            assert any(n["type"] == "MarkdownNote" for n in d["nodes"])


# ── 8. API 直投件 ───────────────────────────────────────────────────
class TestApiArtifacts:
    def test_api_matches_canvas_node_set(self):
        for canvas, api in ((T2I, T2I_API), (I2I, I2I_API)):
            c, a = _load(canvas), _load(api)
            c_types = {n["type"] for n in c["nodes"] if n["type"] != "MarkdownNote"}
            a_types = {v["class_type"] for k, v in a.items() if k != "_doc"}
            assert c_types == a_types, f"{canvas.name}: {c_types ^ a_types}"
            assert "_doc" in a

    def test_api_inject_anchors(self):
        t = _load(T2I_API)
        assert t["1"]["inputs"]["base"] == "人物海报"
        assert "value" in t["2"]["inputs"] and "value" in t["21"]["inputs"]
        assert t["10"]["inputs"]["value"] is True
        i = _load(I2I_API)
        assert "value" in i["2"]["inputs"] and i["3"]["inputs"]["组装用途"] == "道劫美术风格转换"
        assert i["17"]["inputs"]["image"] == "sensenova_u16_edit_women_in_car.png"
        assert "value" in i["24"]["inputs"] and i["9"]["inputs"]["value"] is True

    def test_api_has_preview_and_no_markdown(self):
        for api in (T2I_API, I2I_API):
            d = _load(api)
            types = [v["class_type"] for k, v in d.items() if k != "_doc"]
            assert "MyQi21PromptPreview" in types
            assert "MarkdownNote" not in types


# ── 9. 文件 ≈ 生成器重导出(幂等字节) ────────────────────────────────
class TestGeneratorReexport:
    def test_reexport_byte_identical(self, tmp_path):
        spec = importlib.util.spec_from_file_location("sn_daojie_gen", GEN)
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        names = [p.name for p in ARTIFACTS]
        for name, obj in gen.build_all():
            assert name in names
            assert (WF / gen.ARTIFACTS[name] / name).read_bytes() == gen.render(obj), name

    def test_generator_out_flag_deterministic(self, tmp_path):
        out1, out2 = tmp_path / "a", tmp_path / "b"
        for out in (out1, out2):
            subprocess.run([sys.executable, str(GEN), "--out", str(out)], check=True,
                           cwd=str(REPO), capture_output=True)
        for name in (p.name for p in ARTIFACTS):
            assert (out1 / name).read_bytes() == (out2 / name).read_bytes(), name

    def test_no_double_write_in_generator_instruction(self):
        spec = importlib.util.spec_from_file_location("sn_daojie_gen", GEN)
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        assert "国风二维动漫手绘插画" not in gen.I2I_INSTRUCTION


# ── 10. 预览节点与引擎对账通道 ──────────────────────────────────────
class TestPreviewChannel:
    def test_preview_wired_to_assembly(self):
        for d, pid, aid in ((_load(T2I), 5, 4), (_load(I2I), 4, 3)):
            prev = _node(d, pid)
            assert prev["type"] == "MyQi21PromptPreview"
            assert _link(d, pid, "正向提示词") == (aid, 0)
            assert _link(d, pid, "负向提示词") == (aid, 1)
