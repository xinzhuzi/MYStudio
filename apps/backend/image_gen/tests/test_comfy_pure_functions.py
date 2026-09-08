"""纯函数单测:requirements/freeze 解析、依赖冲突预检、端口分配、
release tag 解析、性能档翻译、节点差分、插件加载错误收集、工作流 JSON 解析。

覆盖一期后端流 A(engine_manager/plugin_manager)的可测缝;
全部纯函数/纯数据,零网络零子进程。
"""
from __future__ import annotations

from image_gen.engine_manager import (
    allocate_port,
    build_launch_args,
    collect_import_failures,
    diff_node_sets,
    parse_release_tags,
    pick_latest_release,
)
from image_gen.plugin_manager import (
    check_dependency_conflicts,
    normalize_pkg,
    parse_freeze,
    parse_requirements,
    specs_compatible,
    workflow_node_count,
    workflow_node_types,
)

# ── requirements / freeze 解析 ─────────────────────────────────────

class TestParseRequirements:
    def test_basic_pinned_and_ranged(self):
        reqs, warnings = parse_requirements("numpy>=1.24.0\nopencv-python-headless==4.9.0.80\ntorch\n")
        assert [r["name"] for r in reqs] == ["numpy", "opencv-python-headless", "torch"]
        assert reqs[0]["spec"] == ">=1.24.0"
        assert reqs[1]["spec"] == "==4.9.0.80"
        assert reqs[2]["spec"] == ""
        assert warnings == []

    def test_comments_blanks_and_inline_comment(self):
        reqs, _ = parse_requirements("# 主依赖\n\npillow  # Pillow 图片库\n")
        assert len(reqs) == 1
        assert reqs[0]["name"] == "pillow" and reqs[0]["spec"] == ""

    def test_extras_and_env_markers(self):
        reqs, _ = parse_requirements("insightface[cli]>=0.7.3 ; python_version >= '3.10'\n")
        assert reqs[0]["name"] == "insightface"
        assert reqs[0]["spec"] == ">=0.7.3"

    def test_include_and_option_lines_reported_as_warnings(self):
        reqs, warnings = parse_requirements("-r shared.txt\n--extra-index-url https://x\nnumpy>=1.0\n")
        assert [r["name"] for r in reqs] == ["numpy"]
        assert len(warnings) == 2

    def test_name_normalization(self):
        reqs, _ = parse_requirements("NumPy>=1.0\nscikit_image\n")
        assert [r["name"] for r in reqs] == ["numpy", "scikit-image"]
        assert normalize_pkg("Foo_Bar.baz") == "foo-bar-baz"


class TestParseFreeze:
    def test_plain_versions(self):
        frozen = parse_freeze("numpy==1.26.4\ntorch==2.9.1\n")
        assert frozen == {"numpy": "1.26.4", "torch": "2.9.1"}

    def test_skips_editable_and_vcs_lines(self):
        frozen = parse_freeze("# comment\n-e git+https://x\nfile @ file:///tmp/x\nnumpy==1.26.4\n")
        assert frozen == {"numpy": "1.26.4"}


# ── 依赖冲突预检 ───────────────────────────────────────────────────

class TestSpecsCompatible:
    def test_disjoint_ranges_conflict(self):
        assert specs_compatible(">=1.26", "<1.24") is False

    def test_overlapping_ranges_ok(self):
        assert specs_compatible(">=1.24,<2.0", ">1.20") is True

    def test_exact_vs_range(self):
        assert specs_compatible("==1.26.4", ">=1.24,<2.0") is True
        assert specs_compatible("==1.23.0", ">=1.26") is False

    def test_empty_spec_always_compatible(self):
        assert specs_compatible("", ">=1.26") is True
        assert specs_compatible(">=1.26", "") is True


class TestCheckDependencyConflicts:
    def test_no_conflict_when_range_satisfied(self):
        reqs = [{"name": "numpy", "spec": ">=1.24", "raw": "numpy>=1.24"}]
        conflicts = check_dependency_conflicts(reqs, {"numpy": "1.26.4"}, {})
        assert conflicts == []

    def test_conflict_against_installed(self):
        reqs = [{"name": "numpy", "spec": ">=1.26", "raw": "numpy>=1.26"}]
        conflicts = check_dependency_conflicts(reqs, {"numpy": "1.23.0"}, {})
        assert len(conflicts) == 1
        assert conflicts[0]["type"] == "installed"
        assert "当前环境已是 1.23.0" in conflicts[0]["message"]

    def test_conflict_against_other_plugin_lock(self):
        reqs = [{"name": "numpy", "spec": ">=1.26", "raw": "numpy>=1.26"}]
        locks = {"ComfyUI-Other": {"numpy": "<1.24"}}
        conflicts = check_dependency_conflicts(reqs, {}, locks)
        assert len(conflicts) == 1
        assert conflicts[0]["type"] == "plugin"
        assert "ComfyUI-Other" in conflicts[0]["message"]
        assert "不能共存" in conflicts[0]["message"]

    def test_compatible_plugin_lock_passes(self):
        reqs = [{"name": "numpy", "spec": ">=1.24", "raw": "numpy>=1.24"}]
        locks = {"ComfyUI-Other": {"numpy": ">=1.22"}}
        assert check_dependency_conflicts(reqs, {}, locks) == []

    def test_unpinned_requirement_never_conflicts(self):
        reqs = [{"name": "numpy", "spec": "", "raw": "numpy"}]
        assert check_dependency_conflicts(reqs, {"numpy": "1.23.0"}, {"B": {"numpy": "<1.20"}}) == []

    def test_multiple_reqs_same_package_merge(self):
        reqs = [
            {"name": "numpy", "spec": ">=1.24", "raw": "numpy>=1.24"},
            {"name": "numpy", "spec": "<1.26", "raw": "numpy<1.26"},
        ]
        conflicts = check_dependency_conflicts(reqs, {"numpy": "1.26.4"}, {})
        assert len(conflicts) == 1  # 1.26.4 不在合并后的 [1.24,1.26) 里


# ── 端口分配 ───────────────────────────────────────────────────────

class TestAllocatePort:
    def test_first_free_in_range(self):
        assert allocate_port(set()) == 17000

    def test_skips_occupied_and_reserved(self):
        occupied = set(range(17000, 17006)) | {17598}
        assert allocate_port(occupied) == 17006

    def test_reserved_never_returned_even_if_free(self):
        # 17598(桥回落段位)与 17595(sidecar)即使空闲也不分配
        occupied = set(range(17000, 17999))  # 17999 空着
        assert allocate_port(occupied) == 17999
        for probe in (allocate_port(set(range(17000, 17598))), allocate_port(set(range(17000, 17595)))):
            assert probe not in (17595, 17598)

    def test_exhausted_range_returns_none(self):
        assert allocate_port(set(range(17000, 18000))) is None


# ── release tag 解析(git ls-remote 输出) ──────────────────────────

class TestReleaseTags:
    LINES = [
        "abc\trefs/tags/v0.3.27",
        "def\trefs/tags/v0.3.27^{}",
        "123\trefs/tags/v0.9.2",
        "456\trefs/tags/v0.10.0",
        "789\trefs/tags/latest",       # 非数字,忽略
        "0ff\trefs/tags/v0.3.10b1",    # 后缀 tag,忽略
    ]

    def test_pure_numeric_tags_sorted_numerically(self):
        tags = [tag for _, tag in parse_release_tags(self.LINES)]
        assert tags == ["v0.3.27", "v0.9.2", "v0.10.0"]  # 0.10 > 0.9(数值比较)

    def test_pick_latest(self):
        assert pick_latest_release(self.LINES) == "v0.10.0"

    def test_no_tags(self):
        assert pick_latest_release(["x\trefs/heads/master"]) is None

    def test_bare_numeric_tag_without_v_prefix(self):
        assert pick_latest_release(["a\trefs/tags/1.2.3", "b\trefs/tags/1.10.0"]) == "1.10.0"


# ── 性能档翻译(不暴露命令行原文) ─────────────────────────────────

class TestBuildLaunchArgs:
    def test_auto_tier_adds_no_perf_flags(self):
        args = build_launch_args({"vramPolicy": "auto", "attentionMode": "auto"}, 17600)
        assert args == ["main.py", "--listen", "127.0.0.1", "--port", "17600"]

    def test_gpu_only(self):
        args = build_launch_args({"vramPolicy": "gpu-only", "attentionMode": "auto"}, 17600)
        assert "--gpu-only" in args

    def test_reserve_vram_uses_configured_gb(self):
        args = build_launch_args({"vramPolicy": "reserve-vram", "reserveVramGb": 2.5}, 17600)
        assert args[args.index("--reserve-vram") + 1] == "2.5"

    def test_reserve_vram_defaults_to_4gb(self):
        args = build_launch_args({"vramPolicy": "reserve-vram"}, 17600)
        assert args[args.index("--reserve-vram") + 1] == "4"

    def test_pytorch_cross_attention(self):
        args = build_launch_args({"vramPolicy": "auto", "attentionMode": "pytorch-cross-attention"}, 17600)
        assert "--use-pytorch-cross-attention" in args

    def test_invalid_tier_falls_back_to_silent(self):
        args = build_launch_args({"vramPolicy": "--evil-flag"}, 17600)
        assert "--evil-flag" not in args


# ── object_info 节点差分 ───────────────────────────────────────────

class TestDiffNodeSets:
    def test_added_removed_counts(self):
        diff = diff_node_sets({"A", "B", "C"}, {"B", "C", "D", "E"})
        assert diff["added"] == ["D", "E"] and diff["addedCount"] == 2
        assert diff["removed"] == ["A"] and diff["removedCount"] == 1


# ── 插件加载错误收集(引擎日志) ────────────────────────────────────

class TestCollectImportFailures:
    def test_import_failed_format(self):
        log = "(IMPORT FAILED): /u/comfyui/custom_nodes/rgthree-comfy\nok line\n(IMPORT FAILED): /u/comfyui/custom_nodes/rgthree-comfy\n"
        failures = collect_import_failures(log)
        assert [f["plugin"] for f in failures] == ["rgthree-comfy"]  # 去重

    def test_cannot_import_format(self):
        log = "Cannot import /u/comfyui/custom_nodes/ComfyUI-Impact-Pack module for custom nodes: No module named 'cv2'\n"
        failures = collect_import_failures(log)
        assert failures[0]["plugin"] == "ComfyUI-Impact-Pack"

    def test_clean_log(self):
        assert collect_import_failures("startup ok\nloaded 42 nodes\n") == []


# ── 工作流 JSON 解析(class_type 扫描) ────────────────────────────

class TestWorkflowParsing:
    def test_api_format(self):
        obj = {"3": {"class_type": "KSampler", "inputs": {}}, "9": {"class_type": "SaveImage", "inputs": {}}}
        assert workflow_node_types(obj) == {"KSampler", "SaveImage"}
        assert workflow_node_count(obj) == 2

    def test_ui_format(self):
        obj = {"nodes": [{"type": "KSampler"}, {"type": "LoadImage"}, {"type": "KSampler"}]}
        assert workflow_node_types(obj) == {"KSampler", "LoadImage"}
        assert workflow_node_count(obj) == 3

    def test_invalid_payload(self):
        assert workflow_node_types(None) == set()
        assert workflow_node_count("junk") == 0
