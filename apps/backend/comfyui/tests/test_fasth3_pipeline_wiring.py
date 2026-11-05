"""Windows FastH3 主线产线接线契约(10-27 windows-fasth3-mainline 接线员)。

被测对象 = 接线三件(工作流作者产出的 repo 库 UI 件 → 接线员落的前端模板对):
    1. apps/frontend/lib/assist/image-studio/fasth3-shot-template.json     UI 画布档(bundle 面)
    2. apps/frontend/lib/assist/image-studio/fasth3-shot-template.api.json API 图(组装器直填母版)
    3. 前端 UI 件与 repo 库真源 2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-i2v.json
       的同步契约(UI 真源=repo 库,前端件是组装器 bundle 复制——本测试钉两处不漂移)。

上游契约(工作流作者已钉,test_fasth3_workflow_contract.py):repo 库两件的三对齐表模型名/
采样参数/节点账(27/26)。本文件补接线面:UI↔repo 同步、API 锚点契约、API 图从
(UI 件+Windows 引擎 object_info 快照)经 h3_template_to_api_1027.py 的可再生产性
(重跑字节等价=参数化转换器没漂),零引擎依赖纯静态。

计划出处:.trellis/tasks/10-27-windows-fasth3-mainline/plan.md §四 W3/W10(接线节)。
"""
from __future__ import annotations

import importlib.util as _ilu
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
FRONTEND_DIR = ROOT / "apps/frontend/lib/assist/image-studio"
FRONTEND_UI = FRONTEND_DIR / "fasth3-shot-template.json"
FRONTEND_API = FRONTEND_DIR / "fasth3-shot-template.api.json"
REPO_LIB_I2V = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-i2v.json"
SNAPSHOT = Path(__file__).resolve().parent / "fixtures/fasth3_object_info_snapshot.json"
TO_API_SCRIPT = ROOT / "apps/build/scripts/h3_template_to_api_1027.py"

FIVE_SEGMENT_PREFIX = "video/漫影/chapter-001/sb-chapter-001-001/ambient"
API_NODE_IDS = {2, 4, 6, 7, 8, 9, 13, 14, 16, 20, 21, 22, 23, 26, 29, 33, 34, 36, 37, 40, 42, 43, 100}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_frontend_ui_template_stays_in_sync_with_repo_library_source():
    """前端 UI 件 = repo 库真源的逐字节复制(锚点契约面由上游契约测试钉,此处钉不漂移)。"""
    assert FRONTEND_UI.exists(), FRONTEND_UI
    assert FRONTEND_UI.read_bytes() == REPO_LIB_I2V.read_bytes(), (
        "前端 fasth3-shot-template.json 与 repo 库 fasth3-单镜视频-i2v.json 漂移:"
        "以 repo 库为真源重新复制(并重跑 API 化脚本同步 .api.json)"
    )


def test_frontend_api_template_anchor_contract():
    """API 图锚契约(组装器 buildShotH3ApiWorkflow 直填面,与旧 h3-shot-template.api.json 同构):
    23 节点(UI 27 − 4 MarkdownNote);14.value str/20.value number/9.image str/
    4.filename_prefix 五段前缀/16 链(14·9·23)+宽高在位/100 MyShot 四字段+video 直连 SaveVideo。"""
    api = load(FRONTEND_API)
    assert {int(k) for k in api} == API_NODE_IDS
    n14, n20, n9, n4, n16, n100 = (api[str(i)] for i in (14, 20, 9, 4, 16, 100))
    assert n14["class_type"] == "PrimitiveStringMultiline" and isinstance(n14["inputs"]["value"], str)
    assert n20["class_type"] == "PrimitiveFloat" and isinstance(n20["inputs"]["value"], (int, float))
    assert n9["class_type"] == "LoadImage" and isinstance(n9["inputs"]["image"], str)
    assert n4["class_type"] == "SaveVideo" and n4["inputs"]["filename_prefix"] == FIVE_SEGMENT_PREFIX
    assert n16["class_type"] == "MiniMaxH3ImageToVideo"
    assert n16["inputs"]["prompt"] == ["14", 0]
    assert n16["inputs"]["first_frame"] == ["9", 0]
    assert n16["inputs"]["length"] == ["23", 1]
    assert isinstance(n16["inputs"]["width"], list) and isinstance(n16["inputs"]["height"], list)
    assert n100["class_type"] == "MyShot" and n100["inputs"]["video"] == ["4", 0]
    for key in ("shot_id", "label", "description", "media_status"):
        assert key in n100["inputs"]


def test_frontend_api_template_fasth3_pins():
    """FastH3 换芯钉死(防回潮):采样/注意力/VSA/模型引用名逐项对齐三对齐表与官方参数口径。"""
    api = load(FRONTEND_API)
    assert api["29"]["inputs"]["sampler_name"] == "res_multistep"
    assert api["8"]["inputs"] == {"model": ["43", 0], "scheduler": "simple", "steps": 8, "denoise": 1}
    assert api["42"]["inputs"]["shift_video"] == 10 and api["42"]["inputs"]["shift_audio"] == 3
    assert api["40"]["inputs"]["attention"] == "comfy kitchen attention"
    # VSA 动态组合组展开:selection + selection.keep_percent 成员键成对在位(API 化关键路径)
    assert api["43"]["inputs"]["selection"] == "vsa"
    assert api["43"]["inputs"]["selection.keep_percent"] == 10
    assert api["43"]["inputs"]["start_percent"] == 0.2
    assert api["34"]["inputs"]["unet_name"] == "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors"
    assert api["21"]["inputs"]["clip_name"] == "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
    assert api["21"]["inputs"]["type"] == "minimax"
    assert {api["7"]["inputs"]["vae_name"], api["13"]["inputs"]["vae_name"]} == {
        "minimax_h3_video_vae_int8_convrot.safetensors", "minimax_h3_audio_vae_fp32.safetensors"}
    blob = json.dumps(api, ensure_ascii=False)
    for stale in ("CLIPLoaderGGUF", "SolAttnPatch", "SplitSigmas", "LoraLoaderModelOnly",
                  "MiniMaxH3BlockCacheT8", "ModelPreviewOverrideKJ", "minimax_h3_fl2va", ".gguf"):
        assert stale not in blob, f"api 模板旧线残留: {stale}"


def test_frontend_api_template_classes_registered_on_windows_engine():
    """全 class_type ⊆ Windows 引擎 object_info 快照(接线面复检;上游已钉 UI 件,API 件同口径)。"""
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    api = load(FRONTEND_API)
    for node in api.values():
        assert node["class_type"] in snapshot, f"unregistered {node['class_type']}"


def test_api_template_is_reproducible_from_ui_and_snapshot():
    """可再生产性:参数化转换器(h3_template_to_api_1027.py,importlib 纯模块加载,零引擎)
    以「前端 UI 件 + Windows 快照」重跑 convert,与已入库 .api.json 字节等价——
    转换逻辑或模板任一漂移即红(重生成命令见模块 docstring)。"""
    spec = _ilu.spec_from_file_location("h3_template_to_api_1027", TO_API_SCRIPT)
    module = _ilu.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]

    canvas = load(FRONTEND_UI)
    module.connect_video_writeback(canvas)
    oi = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    regenerated, _skipped = module.convert(canvas, oi)
    assert json.dumps(regenerated, ensure_ascii=False, indent=1) + "\n" == FRONTEND_API.read_text(encoding="utf-8"), (
        ".api.json 与 (UI 件+快照) 经转换器的再生产结果不一致:重跑 "
        "uv run python apps/build/scripts/h3_template_to_api_1027.py --src <repo 库 i2v 件> "
        "--dst <前端 .api.json> --ui-count 27 --api-count 23 --object-info-file <快照>"
    )
