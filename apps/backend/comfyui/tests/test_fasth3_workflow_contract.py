"""Windows FastH3 主线工作流契约测试(10-27 windows-fasth3-mainline 阶段2,repo 工作流作者)。

被测对象 = 仓库真源两件(`2_视频/H3视频/1_漫影自研/0_单镜视频/`,引擎前端格式画布直开):
    fasth3-单镜视频-i2v.json  主形态:分镜 I2V/首帧锚定(9.image→16.first_frame)
    fasth3-单镜视频-t2v.json  基础版:无首帧纯文生(官方 t2v 同形)

契约真源 = .trellis/tasks/10-27-windows-fasth3-mainline/plan.md §二 三对齐表
(工作流内引用的模型文件名必须逐字符对齐表;引擎侧并行下载同名件,错一格接不上)+
§四 W2 换芯表;官方参数真身 = Windows 引擎 venn 内
comfyui_workflow_templates_json/templates/video_fastvideo_fasth3_{t2v,i2v}.json
(subgraph 展开)与 video_fasth3_ominiref_r2v.json(平铺),本轮 SSH 逐节点核实。
母体 = apps/frontend/lib/assist/image-studio/h3-shot-template.json(31 节点单镜骨架;
锚点契约 14.value/20.value/9.image/4.filename_prefix/100 MyShot/16.width+height 直填)。

节点账:i2v = 母体 31 − 5(3 SplitSigmas/17 ModelPreviewOverrideKJ/41 LoRA/48 T8块缓存/
SolAttnPatch 换型不计删)+ 保留 9 LoadImage = 27 节点/26 链;t2v 再去 9 = 26 节点/25 链。
17 的删除依据 = Windows 引擎 /object_info 实测不在册(引擎零 custom_nodes),不是 W2
原表条目(原表按 28 节点计,系前端模板口径;本两件是 Windows 库内口径,故 27/26)。

夹具 fixtures/fasth3_object_info_snapshot.json = Windows 引擎(192.168.0.101,
ComfyUI 0.42.0,端口 17000)2026-10-27 实况 /object_info 裁剪(22 类,仿
qi21_object_info_snapshot.json 惯例);重建命令:
    ssh zbj@192.168.0.101 "curl.exe -s -m 10 http://127.0.0.1:17000/object_info" > oi.json
    python3 apps/build/scripts/fasth3_mainline_workflows_1027.py --object-info oi.json

零引擎依赖纯静态;本役不实弹(引擎侧装模型中,实弹验收=下一阶段,计划 §五)。
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
LIB = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频"
I2V = LIB / "fasth3-单镜视频-i2v.json"
T2V = LIB / "fasth3-单镜视频-t2v.json"
SNAPSHOT = Path(__file__).resolve().parent / "fixtures/fasth3_object_info_snapshot.json"

# ── §二 三对齐表(R1-R4;R5 int8 TE 为实弹兜底档,裁决前不入件;R6 仅 ominiref 线)──
R1_DIT = "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors"
R2_VIDEO_VAE = "minimax_h3_video_vae_int8_convrot.safetensors"
R3_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
R4_TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
FIVE_SEGMENT_PREFIX = "video/漫影/chapter-001/sb-chapter-001-001/ambient"

EXPECTED_NODE_IDS = {2, 4, 6, 7, 8, 13, 14, 16, 20, 21, 22, 23, 26, 29, 31, 32, 33, 34,
                     36, 37, 40, 42, 43, 47, 100, 101}
NOTE_IDS = {31, 32, 47, 101}

# 语义边集合 (origin_id, origin_slot, target_id, target_slot)
EXPECTED_EDGES_COMMON = {
    (21, 0, 16, 0), (7, 0, 16, 1), (14, 0, 16, 4), (22, 0, 16, 5), (22, 1, 16, 6),
    (23, 1, 16, 7), (20, 0, 23, 0), (37, 0, 26, 0), (33, 0, 26, 1), (29, 0, 26, 2),
    (8, 0, 26, 3), (16, 1, 26, 4), (16, 0, 33, 1), (34, 0, 42, 0), (42, 0, 40, 0),
    (40, 0, 43, 0), (43, 0, 8, 0), (43, 0, 33, 0), (26, 1, 6, 0), (26, 1, 2, 0),
    (7, 0, 6, 1), (13, 0, 2, 1), (6, 0, 36, 0), (2, 0, 36, 1), (36, 0, 4, 0),
}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def nodes_by_type(wf: dict, type_name: str) -> list[dict]:
    return [n for n in wf["nodes"] if n["type"] == type_name]


def node(wf: dict, nid: int) -> dict:
    got = [n for n in wf["nodes"] if n["id"] == nid]
    assert len(got) == 1, f"node {nid} not unique in {wf.get('id')}"
    return got[0]


def edge_set(wf: dict) -> set[tuple[int, int, int, int]]:
    return {(l[1], l[2], l[3], l[4]) for l in wf["links"]}


def test_library_files_exist_with_expected_shape():
    for path, node_count, link_count in ((I2V, 27, 26), (T2V, 26, 25)):
        assert path.exists(), path
        wf = load(path)
        ids = {n["id"] for n in wf["nodes"]}
        expected = EXPECTED_NODE_IDS | ({9} if path == I2V else set())
        assert ids == expected, f"{path.name} node drift: {ids ^ expected}"
        assert len(wf["nodes"]) == node_count
        assert len(wf["links"]) == link_count
        # 说明 Note 全保留(锚点契约的面板说明层)
        assert {n["id"] for n in nodes_by_type(wf, "MarkdownNote")} == NOTE_IDS
        # 母体退役节点零回潮(旧 H3 线残构 + Windows 不在册件)
        for banned in ("CLIPLoaderGGUF", "SolAttnPatch", "MiniMaxH3BlockCacheT8",
                       "SplitSigmas", "LoraLoaderModelOnly", "ModelPreviewOverrideKJ"):
            assert not nodes_by_type(wf, banned), banned


def test_model_references_match_alignment_table():
    """加载器引用名逐字符对齐 §二 三对齐表(引擎按文件名枚举,一字不差才接得上)。"""
    for path in (I2V, T2V):
        wf = load(path)
        unet = nodes_by_type(wf, "UNETLoader")
        assert len(unet) == 1
        assert unet[0]["widgets_values_named"] == {"unet_name": R1_DIT, "weight_dtype": "default"}
        assert unet[0]["widgets_values"] == [R1_DIT, "default"]

        clip = nodes_by_type(wf, "CLIPLoader")
        assert len(clip) == 1
        assert clip[0]["widgets_values_named"] == {
            "clip_name": R4_TE, "type": "minimax", "device": "default"}
        assert clip[0]["widgets_values"] == [R4_TE, "minimax", "default"]

        vaes = {n["widgets_values_named"]["vae_name"] for n in nodes_by_type(wf, "VAELoader")}
        assert vaes == {R2_VIDEO_VAE, R3_AUDIO_VAE}

        # 旧线残留名禁现于执行节点(widgets/properties/sockets;MarkdownNote 是说明
        # 文档,允许记述换芯前的旧值)——与官方克隆件不同,本件是执行真源。
        executable = json.dumps([n for n in wf["nodes"] if n["type"] != "MarkdownNote"],
                                ensure_ascii=False)
        for stale in ("minimax_h3_fl2va", "Qwen3-VL-32B-Ultra-Heretic", "turbo_4step",
                      "video_vae_fp16", "omniref", "qwen3vl_32b_minimax_h3_int8_convrot",
                      ".gguf"):
            assert stale not in executable, f"{path.name} leaks stale token: {stale}"


def test_fasth3_sampling_contract_is_pinned():
    """采样参数钉死防回归漂移(官方 t2v/i2v 模板逐字口径)。"""
    for path in (I2V, T2V):
        wf = load(path)
        assert node(wf, 29)["widgets_values_named"] == {"sampler_name": "res_multistep"}
        assert node(wf, 8)["widgets_values_named"] == {"scheduler": "simple", "steps": 8,
                                                        "denoise": 1}
        assert node(wf, 42)["widgets_values_named"] == {"shift_video": 10, "shift_audio": 3}
        assert node(wf, 40)["widgets_values_named"] == {"attention": "comfy kitchen attention"}
        # VSA 稀疏注意力(官方 t2v/i2v 档:start_percent=0.2;r2v 平铺件为 0,不取)
        assert node(wf, 43)["widgets_values_named"] == {
            "selection": "vsa", "selection.keep_percent": 10, "start_percent": 0.2,
            "end_percent": 1, "dense_blocks": "", "min_tokens": 12288, "extra_tokens": 256,
            "sink_conditioning": "exact_kv_and_rows", "verbose": False,
        }
        assert node(wf, 36)["widgets_values_named"] == {
            "fps": 24, "bit_depth": "auto", "color_space": "sRGB", "codec": "none"}
        assert node(wf, 37)["widgets_values_named"]["control_after_generate"] == "fixed"


def test_storyboard_anchors_and_factory_tier():
    """锚点契约(与 h3-shot-template 家族同构)+ 出厂档=480p 档 608x352/124 帧。"""
    for path in (I2V, T2V):
        wf = load(path)
        n14 = node(wf, 14)  # 提示词锚 14.value(画布档 widget 键=text 已废,契约为 API 键 value)
        assert n14["type"] == "PrimitiveStringMultiline"
        assert isinstance(n14["widgets_values_named"]["value"], str)
        assert n14["widgets_values_named"]["value"].strip()
        assert node(wf, 20)["widgets_values_named"] == {"value": 5}  # 秒锚
        assert node(wf, 23)["widgets_values_named"]["expression"] == \
            "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17"
        n16 = node(wf, 16)
        assert n16["widgets_values_named"] == {"prompt": "", "width": 608, "height": 352,
                                               "length": 124}
        assert n16["widgets_values"] == ["", 608, 352, 124]
        # 22/23 链路出厂=0.2MP(608x352,档位真源 H3_RESOLUTION_TIERS 的 480p 档)
        assert node(wf, 22)["widgets_values_named"] == {
            "aspect_ratio": "16:9 (Widescreen)", "megapixels": 0.2, "multiple": 32}
        # 五段前缀(回收白名单依赖)+ MyShot 锚卡(工厂 S00;无任何下游消费)
        assert node(wf, 4)["widgets_values_named"]["filename_prefix"] == FIVE_SEGMENT_PREFIX
        n100 = node(wf, 100)
        assert n100["type"] == "MyShot"
        assert n100["widgets_values"][0] == "S00"
        assert n100["inputs"] == [] and n100["outputs"] == []

    i2v = load(I2V)  # i2v 主形态:首帧锚 9.image 占位(api 件同款工厂值)
    n9 = node(i2v, 9)
    assert n9["type"] == "LoadImage"
    assert n9["widgets_values_named"] == {"image": "manying-shot-h3-placeholder.jpg",
                                          "upload": "image"}
    assert n9["widgets_values"] == ["manying-shot-h3-placeholder.jpg", "image"]

    t2v = load(T2V)  # t2v 基础版:提示词样例不得再挂首帧/图片指代
    prompt = node(t2v, 14)["widgets_values_named"]["value"]
    assert "<Picture" not in prompt and "首帧" not in prompt and "参考图" not in prompt


def test_model_chain_and_wiring_match_official_fasth3():
    """模型链官方同构:UNET→SigmaShift→AttentionBackend→VSA→(Scheduler+Guider 双喂);
    调度器直连采样器(SplitSigmas 已删);母体旧 34→8 直连线废除。"""
    for path in (I2V, T2V):
        wf = load(path)
        edges = edge_set(wf)
        expected = EXPECTED_EDGES_COMMON | ({(9, 0, 16, 2)} if path == I2V else set())
        assert edges == expected, f"{path.name} wiring drift: {edges ^ expected}"
        assert (34, 0, 8, 0) not in edges  # 母体旧直连线不得回潮
        nt = {n["id"]: n["type"] for n in wf["nodes"]}
        assert nt[43] == "BlockSparseAttention" and nt[21] == "CLIPLoader"
        # 引用一致性:每个 input.link 指回本节点本槽位
        for l in wf["links"]:
            tgt = node(wf, l[3])
            names = [e["name"] for e in tgt.get("inputs", [])]
            assert l[4] < len(names), f"slot OOB in link {l}"
            assert [e for e in tgt["inputs"] if e["name"] == names[l[4]]][0]["link"] == l[0]


def test_t2v_is_exactly_i2v_minus_first_frame():
    """基础版=主形态去首帧:节点差恰 {9},语义边差恰 首帧边,其余锚/参数全同构。"""
    i2v, t2v = load(I2V), load(T2V)
    ids_i2v = {n["id"] for n in i2v["nodes"]}
    ids_t2v = {n["id"] for n in t2v["nodes"]}
    assert ids_i2v - ids_t2v == {9} and ids_t2v - ids_i2v == set()
    assert edge_set(i2v) - edge_set(t2v) == {(9, 0, 16, 2)}
    assert edge_set(t2v) - edge_set(i2v) == set()
    # t2v 首帧槽位空置(官方 t2v 同形:MiniMaxH3ImageToVideo 首帧不接)
    first_frame_entry = [e for e in node(t2v, 16)["inputs"] if e["name"] == "first_frame"]
    assert first_frame_entry and first_frame_entry[0]["link"] is None


def test_all_node_classes_registered_on_windows_engine():
    """全 class_type ⊆ Windows 引擎 /object_info 快照(MarkdownNote 为前端 UI 件,惯例豁免);
    关键枚举值在引擎实况里在册(attention/采样器/TE type)。"""
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    for path in (I2V, T2V):
        wf = load(path)
        for n in wf["nodes"]:
            if n["type"] == "MarkdownNote":
                continue
            assert n["type"] in snapshot, f"{path.name} uses unregistered {n['type']}"
    attention = snapshot["ModelAttentionBackend"]["input"]["required"]["attention"]
    assert "comfy kitchen attention" in attention[1]["options"]
    samplers = snapshot["KSamplerSelect"]["input"]["required"]["sampler_name"]
    assert "res_multistep" in samplers[1]["options"]

    def combo_options(spec: list) -> list:
        """引擎两代 combo 形:{options}(新)与 [options](旧,如 CLIPLoader.type)。"""
        return spec[1]["options"] if len(spec) > 1 and isinstance(spec[1], dict) else spec[0]

    clip_type = snapshot["CLIPLoader"]["input"]["required"]["type"]
    assert "minimax" in combo_options(clip_type)
    bsa_selection = json.dumps(snapshot["BlockSparseAttention"]["input"]["required"]["selection"],
                               ensure_ascii=False)
    assert "vsa" in bsa_selection
    assert "MyShot" in snapshot  # Windows 引擎 my-nodes 实况注册(deprecated 标记在档)
