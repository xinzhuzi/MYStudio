"""纯函数单测:requirements/freeze 解析、依赖冲突预检、端口分配、
release tag 解析、性能档翻译、节点差分、插件加载错误收集、工作流 JSON 解析。

覆盖一期后端流 A(engine_manager/plugin_manager)的可测缝;
全部纯函数/纯数据,零网络零子进程。
"""
from __future__ import annotations

import pytest

from engines.comfyui.engine_manager import (
    allocate_port,
    build_launch_args,
    collect_import_failures,
    diff_node_sets,
    parse_release_tags,
    pick_latest_release,
)
from engines.comfyui.plugin_manager import (
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
    """09-10 全盘照 Desktop:串=唯一真源。旧三档语义经 legacy_launch_flags 翻译后等价保留。"""

    def test_empty_string_gives_managed_defaults(self):
        assert build_launch_args("", 17600) == ["main.py", "--listen", "127.0.0.1", "--port", "17600"]

    def test_flags_passthrough_in_order(self):
        args = build_launch_args("--gpu-only --reserve-vram 2.5 --use-pytorch-cross-attention", 17600)
        assert args == ["main.py", "--listen", "127.0.0.1", "--port", "17600",
                        "--gpu-only", "--reserve-vram", "2.5", "--use-pytorch-cross-attention"]

    def test_listen_from_string_port_from_caller_resolution(self):
        # 09-11 根修:--port 一律用调用方决议口(resolve 已消费串口:空闲即串口,
        # 被占顺延)——串口再压决议口会让引擎实际口与账本/健康检查口分叉
        args = build_launch_args("--listen localhost --port 8188 --fast", 17600)
        assert args == ["main.py", "--listen", "localhost", "--port", "17600", "--fast"]

    def test_non_loopback_listen_is_rejected(self):
        # 0924 安全收口 M4:引擎零鉴权,--listen 仅放行环回白名单
        # (127.0.0.1/localhost);0.0.0.0 等取值在此拒绝,改串重启也过不了这道闸。
        from engines.comfyui.engine_manager import EngineOpError

        for bad in ("0.0.0.0", "192.168.1.10", "::", "[::1]"):
            with pytest.raises(EngineOpError):
                build_launch_args(f"--listen {bad} --fast", 17600)
        # 环回白名单内的写法原样透传(等值写法同罪/同放)
        assert build_launch_args("--listen=127.0.0.1 --fast", 17600)[1:3] == ["--listen", "127.0.0.1"]

    def test_managed_comfy_api_base_env_appends_official_flag(self, monkeypatch):
        # 云端收编二轮:节点全保留,官方 --comfy-api-base 改指漫影网关(env 驱动)
        monkeypatch.setenv("MYSTUDIO_COMFY_API_BASE", "https://gw.my.example")
        args = build_launch_args("--fast", 17600)
        assert args[-2:] == ["--comfy-api-base", "https://gw.my.example"]
        # 用户串两种写法都识别,不重复注入
        assert build_launch_args("--comfy-api-base https://self.example --fast", 17600).count("--comfy-api-base") == 1
        eq_form = build_launch_args("--comfy-api-base=https://self.example", 17600)
        assert sum(1 for token in eq_form if token.startswith("--comfy-api-base")) == 1

    def test_managed_comfy_api_base_absent_env_is_zero_touch(self, monkeypatch):
        monkeypatch.delenv("MYSTUDIO_COMFY_API_BASE", raising=False)
        assert build_launch_args("--fast", 17600) == [
            "main.py", "--listen", "127.0.0.1", "--port", "17600", "--fast"]

    def test_io_dirs_appended_after_user_flags(self):
        # 09-11 输入/输出目录迁出源码目录:manifest 键 → 官方参数,追加在
        # 用户串之后(argparse 后写胜出=托管位权威,用户串手写同款也被覆盖)
        args = build_launch_args("--fast", 17600,
                                 input_dir="/data/comfyui/input", output_dir="/data/comfyui/output")
        assert args == ["main.py", "--listen", "127.0.0.1", "--port", "17600", "--fast",
                        "--input-directory", "/data/comfyui/input",
                        "--output-directory", "/data/comfyui/output"]
        overridden = build_launch_args("--input-directory /old/input --fast", 17600,
                                       input_dir="/new/input")
        assert overridden.count("--input-directory") == 2
        assert overridden[-2:] == ["--input-directory", "/new/input"]

    def test_io_dirs_none_keeps_legacy_argv(self):
        assert build_launch_args("--fast", 17600, input_dir=None, output_dir=None) == [
            "main.py", "--listen", "127.0.0.1", "--port", "17600", "--fast"]

    def test_port_equals_form(self):
        # 09-11 根修:等值写法的串口同样由决议口取代(调用方传啥用啥)
        args = build_launch_args("--port=17500", 17600)
        assert args[3:5] == ["--port", "17600"]

    def test_legacy_dict_translation_equivalence(self):
        from engines.comfyui.manifest import legacy_launch_flags
        legacy = legacy_launch_flags({"vramPolicy": "gpu-only", "reserveVramGb": 16,
                                      "attentionMode": "pytorch-cross-attention"})
        # 09-12 端口矛盾根修:迁移基线不再钉 --port 17598(桥回落保留段位),
        # 口由账本 manifest.port 承载;其余翻译规则不变
        assert legacy == "--enable-manager --gpu-only --reserve-vram 16 --use-pytorch-cross-attention"
        # 旧默认(缺档落 gpu-only/16/pytorch)翻译规则不变,只叠管理器基线
        # 旧读侧:reserve 缺失默认 16 → 迁移后有效行为零变化(含 auto 档也带 reserve)
        assert legacy_launch_flags({}) == legacy
        assert legacy_launch_flags({"vramPolicy": "reserve-vram"}) == "--enable-manager --reserve-vram 16 --use-pytorch-cross-attention"
        assert legacy_launch_flags({"vramPolicy": "auto", "reserveVramGb": 2.5, "attentionMode": "auto"}) == "--enable-manager --reserve-vram 2.5"


class TestParseLaunchArgsString:
    def test_syntax_error_rejected(self):
        from engines.comfyui.engine_manager import EngineOpError, parse_launch_args_string
        try:
            parse_launch_args_string('"--unbalanced')
            raise AssertionError("应抛语法错")
        except EngineOpError as exc:
            assert "引号" in str(exc)

    def test_invalid_port_value_rejected(self):
        from engines.comfyui.engine_manager import EngineOpError, parse_launch_args_string
        for bad in ("--port 0", "--port 99999", "--port abc"):
            try:
                parse_launch_args_string(bad)
                raise AssertionError(f"{bad} 应被拒")
            except EngineOpError:
                pass

    def test_port_missing_value_rejected(self):
        from engines.comfyui.engine_manager import EngineOpError, parse_launch_args_string
        try:
            parse_launch_args_string("--port")
            raise AssertionError("缺取值应被拒")
        except EngineOpError:
            pass

    def test_quoted_flag_value(self):
        from engines.comfyui.engine_manager import parse_launch_args_string
        parsed = parse_launch_args_string('--listen "127.0.0.1" --fp16-vae')
        assert parsed == {"flags": ["--fp16-vae"], "port": None, "listen": "127.0.0.1"}


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


# ── 缺插件预检(09-09,Manager「Install Missing Custom Nodes」语义) ──

class TestMissingNodesPrecheck:
    def test_graph_node_classes_dedup_keeps_order(self):
        from engines.image_engine.comfyui_bridge import graph_node_classes

        graph = {
            "1": {"class_type": "KSampler", "inputs": {}},
            "2": {"class_type": "SaveImage", "inputs": {}},
            "3": {"class_type": "KSampler", "inputs": {}},
            "4": "not-a-node",
            "5": {"inputs": {}},
        }
        assert graph_node_classes(graph) == ["KSampler", "SaveImage"]

    def test_message_maps_missing_class_to_curated_pack(self):
        from engines.image_engine.comfyui_bridge import missing_nodes_message

        packs = {"ConditioningKrea2Rebalance": "Krea2 提示重平衡"}
        message = missing_nodes_message(["ConditioningKrea2Rebalance"], packs)
        assert "Krea2 提示重平衡" in message
        assert "生态插件" in message

    def test_message_unknown_class_falls_back_to_generic_hint(self):
        from engines.image_engine.comfyui_bridge import missing_nodes_message

        message = missing_nodes_message(["SomePrivateNode"], {})
        assert "SomePrivateNode" in message
        assert "git 地址" in message
        assert "「" not in message  # 无包可指时不出现包名括号

    def test_message_none_when_nothing_missing(self):
        from engines.image_engine.comfyui_bridge import missing_nodes_message

        assert missing_nodes_message([], {"X": "Y"}) is None

    def test_curated_provides_mapping_reads_real_curated_file(self):
        """真实策展文件里 Krea2 三包的 provides 必须能映射(装机链路的活数据)。"""
        from engines.image_engine.comfyui_bridge import curated_node_class_packs

        mapping = curated_node_class_packs()
        assert mapping.get("Krea2EditGroundedEncode") == "Krea2 指令编辑节点"
        assert mapping.get("Krea2EditModelPatch") == "Krea2 指令编辑节点"
        assert mapping.get("ConditioningKrea2Rebalance") == "Krea2 提示重平衡"
        assert mapping.get("GetImageSize+") == "Essentials 基础增强"
