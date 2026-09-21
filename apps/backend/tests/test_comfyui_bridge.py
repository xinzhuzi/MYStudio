from __future__ import annotations

import base64
import io
from urllib.error import HTTPError
import os
import unittest
from unittest.mock import patch

from engines.image_engine import comfyui_bridge as bridge
from engines.image_engine import model_cache
from image_gen import model_inventory
from image_gen.pipeline import PipelineError


def _all_template_classes_available() -> frozenset[str]:
    """桩:K2 模板用到的全部节点类引擎侧都可用——缺插件预检门放行,
    让传输契约测试(upload/poll/view/超时/错误码)不掺预检因素。"""
    classes: set[str] = set()
    for name in ("krea2_t2i", "krea2_edit_ref"):
        classes.update(bridge.graph_node_classes(bridge.load_template(name)["graph"]))
    return frozenset(classes)


class BridgeContractTests(unittest.TestCase):
    def test_bridge_url_defaults_to_comfyui_desktop_port(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(bridge.bridge_url(), "http://127.0.0.1:17598")

    def test_bridge_url_honors_environment_override(self):
        with patch.dict(os.environ, {"MYSTUDIO_COMFYUI_BRIDGE_URL": "http://localhost:9123/"}, clear=True):
            self.assertEqual(bridge.bridge_url(), "http://localhost:9123")

    def test_templates_validate_and_status_is_ready(self):
        self.assertEqual(bridge.load_template("krea2_t2i")["schemaVersion"], 1)
        status = bridge.small_pieces_status(None)
        self.assertTrue(status["ready"], status)

    def test_missing_required_node_fails_closed(self):
        template = {"schemaVersion": 1, "inputs": {"prompt": {"node": "404", "field": "text"}}, "graph": {"9": {"class_type": "SaveImage", "inputs": {}}}}
        with patch.object(bridge, "_template_path") as path, patch("pathlib.Path.read_text", return_value=__import__("json").dumps(template)):
            path.return_value = bridge._WORKFLOWS_DIR / "bad.json"
            with self.assertRaises(PipelineError) as ctx:
                bridge.load_template("bad")
        self.assertEqual(ctx.exception.code, "bridge-template-missing")

    def test_binding_expected_class_type_is_enforced(self):
        template = {
            "schemaVersion": 1,
            "inputs": {"prompt": {"node": "9", "field": "text", "class_type": "KSampler"}},
            "graph": {"9": {"class_type": "SaveImage", "inputs": {"text": ""}}},
        }
        with patch.object(bridge, "_template_path") as path, patch(
            "pathlib.Path.read_text", return_value=__import__("json").dumps(template)
        ):
            path.return_value = bridge._WORKFLOWS_DIR / "bad-class.json"
            with self.assertRaises(PipelineError) as ctx:
                bridge.load_template("bad-class")
        self.assertEqual(ctx.exception.code, "bridge-template-missing")

    def test_daojie_templates_load_and_instantiate(self):
        """09-14 分镜图接入:道劫水墨 t2i(无参考白名单)+i2i(单基准图编辑)。"""
        t2i = bridge.load_template("krea2_daojie_t2i")
        self.assertEqual(t2i["schemaVersion"], 1)
        graph = bridge.instantiate_template(t2i, "少年立于雨后长街", None, 8, 42, "3:4", [])
        self.assertEqual(graph["50"]["inputs"]["value"], "少年立于雨后长街")
        self.assertEqual(graph["28"]["inputs"]["steps"], 8)
        w, h = bridge.ASPECT_RATIOS["3:4"]
        self.assertEqual(graph["29"]["inputs"]["width"], w)
        self.assertEqual(graph["29"]["inputs"]["height"], h)
        self.assertEqual(graph["37"]["inputs"]["unet_name"], "krea2_turbo_bf16.safetensors")
        i2i = bridge.load_template("krea2_daojie_i2i")
        graph2 = bridge.instantiate_template(i2i, "重绘为水墨", None, 10, None, "1:1", ["base.png"])
        self.assertEqual(graph2["18"]["inputs"]["value"], "重绘为水墨")
        self.assertEqual(graph2["7"]["inputs"]["image"], "base.png")
        self.assertEqual(graph2["17"]["inputs"]["grounding_px"], 0)

    def test_multi_reference_slots_are_injected_and_truncated(self):
        template = bridge.load_template("krea2_edit_ref")
        graph = bridge.instantiate_template(template, "p", "n", 4, 9, "16:9", ["a", "b", "c", "d", "e"])
        self.assertEqual(len(template["inputs"]["references"]), 2)
        self.assertEqual(graph["45"]["inputs"]["image"], "a")
        self.assertEqual(graph["46"]["inputs"]["image"], "b")
        self.assertEqual(graph["36"]["inputs"]["image_b"], ["52", 0])
        self.assertEqual(graph["35"]["inputs"]["source_image_b"], ["52", 0])
        self.assertEqual(graph["34"]["inputs"]["prompt"], "n")
        self.assertEqual(graph["28"]["inputs"]["width"], 1152)
        self.assertEqual(graph["28"]["inputs"]["height"], 640)

    def test_single_reference_removes_optional_second_reference_chain(self):
        graph = bridge.instantiate_template(
            bridge.load_template("krea2_edit_ref"), "p", "n", 4, 9, "1:1", ["a"]
        )
        self.assertNotIn("46", graph)
        self.assertNotIn("52", graph)
        self.assertNotIn("53", graph)
        self.assertNotIn("image_b", graph["36"]["inputs"])
        self.assertNotIn("source_image_b", graph["35"]["inputs"])

    def test_upload_names_use_bridge_prefix(self):
        with patch.object(bridge, "_available_node_classes", return_value=_all_template_classes_available()), patch.object(
            bridge, "_http_json", side_effect=[{"system": {"comfyui_version": "0.33.0"}}, {"prompt_id": "pid", "node_errors": []}, {"pid": {"status": {"status_str": "success"}, "outputs": {"9": {"images": [{"filename": "out.png"}]}}}}]), patch.object(
            bridge, "_upload_image", return_value={"name": "ref.png"}
        ) as upload, patch.object(bridge, "_fetch_bytes", return_value=b"png"), patch.object(bridge.time, "sleep"):
            bridge.generate("hello", "1:1", None, 8, 1, reference_b64="aGVsbG8=")
        self.assertRegex(upload.call_args.args[2], r"^mystudio-bridge-[0-9a-f]{8}\.png$")

    def test_below_minimum_version_is_logged_before_execution(self):
        with patch("builtins.print") as print_mock:
            bridge._warn_if_version_below_min(
                {"comfyui_version": "0.32.9"}, {"comfyuiVersionMin": "0.33"}
            )
        self.assertTrue(any("below template minimum" in str(call) for call in print_mock.call_args_list))

    def test_history_404_is_treated_as_pending(self):
        exc = HTTPError("http://127.0.0.1:17598/history/pid", 404, "not found", {}, io.BytesIO())
        with patch.object(bridge.request, "urlopen", side_effect=exc):
            self.assertEqual(bridge._http_json("GET", "http://127.0.0.1:17598/history/pid"), {})

    def test_generate_success_uses_upload_poll_and_view(self):
        png = b"fake-png"
        history = {"pid": {"status": {"status_str": "success"}, "outputs": {"9": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]}}}}
        responses = [{"system": {"comfyui_version": "0.33.0"}}, {"prompt_id": "pid", "node_errors": []}, history]
        with patch.object(bridge, "_available_node_classes", return_value=_all_template_classes_available()), patch.object(bridge, "_http_json", side_effect=responses), patch.object(bridge, "_upload_image", return_value={"name": "ref.png"}), patch.object(bridge, "_fetch_bytes", return_value=png), patch.object(bridge.time, "sleep"):
            result = bridge.generate("hello", "1:1", None, 8, 1, reference_b64="aGVsbG8=")
        self.assertEqual(base64.b64decode(result), png)

    def test_missing_node_classes_fail_closed_before_submit(self):
        # 缺插件预检门(c05502e):引擎侧类集为空→差分非空→生成前拦断,
        # 绝不带病提交 /prompt(策展指路文案见 missing_nodes_message 纯函数测)。
        responses = [{"system": {"comfyui_version": "0.33.0"}}]
        with patch.object(bridge, "_available_node_classes", return_value=frozenset()), patch.object(
            bridge, "_http_json", side_effect=responses
        ) as http_json, patch.object(bridge, "_upload_image", return_value={"name": "ref.png"}):
            with self.assertRaises(PipelineError) as ctx:
                bridge.generate("x", "1:1", None, 8, None)
        self.assertEqual(ctx.exception.code, "bridge-missing-nodes")
        self.assertFalse(any("/prompt" in str(call.args[1]) for call in http_json.call_args_list))

    def test_error_codes_timeout_no_output_and_execution(self):
        with patch.object(bridge, "_available_node_classes", return_value=_all_template_classes_available()), patch.object(bridge, "_http_json", side_effect=OSError("offline")):
            with self.assertRaises(PipelineError) as ctx:
                bridge.generate("x", "1:1", None, 8, None)
        self.assertEqual(ctx.exception.code, "bridge-unreachable")
        with patch.object(bridge, "_available_node_classes", return_value=_all_template_classes_available()), patch.object(bridge, "_http_json", side_effect=[{"system": {}}, {"node_errors": [{"x": "bad"}]}]):
            with self.assertRaises(PipelineError) as ctx:
                bridge.generate("x", "1:1", None, 8, None)
        self.assertEqual(ctx.exception.code, "bridge-execution-failed")

    def test_timeout_interrupts_active_prompt_best_effort(self):
        responses = [{"system": {"comfyui_version": "0.33.0"}}, {"prompt_id": "p", "node_errors": []}, {}]
        with patch.object(bridge, "_available_node_classes", return_value=_all_template_classes_available()), patch.object(bridge, "_http_json", side_effect=responses) as http_json, patch.object(
            bridge.time, "monotonic", side_effect=[0.0, 1.0, 2.0]
        ), patch.dict(os.environ, {"MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S": "1"}, clear=True), patch.object(
            bridge.time, "sleep"
        ):
            with self.assertRaises(PipelineError) as ctx:
                bridge.generate("x", "1:1", None, 8, None)
        self.assertEqual(ctx.exception.code, "bridge-timeout")
        self.assertEqual(http_json.call_args_list[-1].args[:2], ("POST", "http://127.0.0.1:17598/api/jobs/p/cancel"))
        self.assertFalse(any(call.args[1].endswith("/interrupt") for call in http_json.call_args_list))

    def test_find_cached_is_service_entry(self):
        with patch.object(bridge, "resolve_big_files", return_value={"cache_dir": "http://127.0.0.1:17598"}):
            found = bridge.find_cached()
        self.assertEqual(found["repo_id"], "comfyui-service:127.0.0.1:17598")

    def test_invalid_timeout_configuration_keeps_a_finite_default(self):
        for value in ("oops", "NaN", "Infinity", "-Infinity", "0", "-1", "1e1000"):
            with self.subTest(value=value), patch.dict(os.environ, {
                "MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S": value,
            }), patch.object(bridge, "resolve_big_files", return_value={"system": {}}), patch.object(
                bridge, "_available_node_classes", return_value=_all_template_classes_available()
            ), patch.object(bridge, "_http_json", side_effect=[
                {"prompt_id": "p-config"}, {}, {},
            ]) as http_json, patch.object(bridge.time, "monotonic", side_effect=[0.0, 1.0, 601.0]), patch.object(
                bridge.time, "sleep"
            ), patch("engines.comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True):
                with self.assertRaises(PipelineError) as caught:
                    bridge.generate("x", "1:1", None, 8, None)
                self.assertEqual(caught.exception.code, "bridge-timeout")
                self.assertEqual(sum("/history/" in call.args[1] for call in http_json.call_args_list), 1)
                self.assertTrue(http_json.call_args_list[-1].args[1].endswith("/api/jobs/p-config/cancel"))

    def test_partial_acceptance_tracks_prompt_and_reports_warning(self):
        node_errors = {"bad-output": {"errors": [{"message": "Required input is missing"}]}}
        history = {"p-partial": {"status": {"status_str": "success"}, "outputs": {
            "11": {"images": [{"filename": "out.png"}]},
        }}}
        with patch.object(bridge, "resolve_big_files", return_value={"system": {}}), patch.object(
            bridge, "_available_node_classes", return_value=_all_template_classes_available()
        ), patch.object(bridge, "_http_json", side_effect=[
            {"prompt_id": "p-partial", "node_errors": node_errors}, history,
        ]) as http_json, patch.object(bridge, "_fetch_bytes", return_value=b"partial-output"), patch(
            "engines.comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True
        ), patch("builtins.print") as printed:
            result = bridge.generate("x", "1:1", None, 8, None)
        self.assertEqual(base64.b64decode(result), b"partial-output")
        self.assertTrue(any("/history/p-partial" in call.args[1] for call in http_json.call_args_list))
        self.assertTrue(any("p-partial" in str(call) and "bad-output" in str(call) for call in printed.call_args_list))

    def test_bridge_is_registered_as_service_model(self):
        self.assertIs(model_cache.IMAGE_MODELS[bridge.MODEL_NAME], bridge.SPEC)
        self.assertIs(model_cache._ENGINE_BY_LAYOUT[bridge.LAYOUT], bridge)

    def test_user_cancel_stops_before_submit_and_cancels_only_accepted_prompt(self):
        for stage in ("before", "submitted", "history", "fetch", "cancel-fails", "history-error", "fetch-error"):
            with self.subTest(stage=stage):
                cancelled = {"value": stage == "before"}
                calls = []
                history = {"p/cancel": {"status": {"status_str": "success"}, "outputs": {
                    "11": {"images": [{"filename": "out.png"}]},
                }}}

                def http_json(method, url, payload=None, timeout=10):
                    calls.append((method, url))
                    if url.endswith("/prompt"):
                        if stage in ("submitted", "cancel-fails"):
                            cancelled["value"] = True
                        return {"prompt_id": "p/cancel"}
                    if "/history/" in url:
                        if stage in ("history", "history-error"):
                            cancelled["value"] = True
                        if stage == "history-error":
                            raise OSError("history connection closed")
                        return history
                    if "/cancel" in url:
                        if stage == "cancel-fails":
                            raise OSError("cleanup unavailable")
                        return {}
                    raise AssertionError(url)

                def fetch_bytes(url):
                    if stage in ("fetch", "fetch-error"):
                        cancelled["value"] = True
                    if stage == "fetch-error":
                        raise OSError("view connection closed")
                    return b"late-output"

                with patch.object(bridge, "resolve_big_files", return_value={"system": {}}), patch.object(
                    bridge, "_available_node_classes", return_value=_all_template_classes_available()
                ), patch.object(bridge, "_http_json", side_effect=http_json), patch.object(
                    bridge, "_fetch_bytes", side_effect=fetch_bytes
                ), patch("engines.comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True), patch(
                    "image_gen.pipeline.is_generation_cancelled", side_effect=lambda: cancelled["value"]
                ):
                    with self.assertRaises(PipelineError) as caught:
                        bridge.generate("x", "1:1", None, 8, None)
                self.assertEqual(caught.exception.code, "generation-cancelled")
                if stage == "before":
                    self.assertEqual(calls, [])
                else:
                    self.assertTrue(calls[-1][1].endswith("/api/jobs/p%2Fcancel/cancel"))
                    self.assertEqual(sum("/api/jobs/" in url for _, url in calls), 1)
                self.assertFalse(any(url.endswith("/interrupt") for _, url in calls))

    def test_inventory_projects_service_probe_and_template_state(self):
        with patch.object(model_inventory, "IMAGE_MODELS", {bridge.MODEL_NAME: bridge.SPEC}), patch.object(
            model_inventory, "find_cached_image_model_for_spec",
            return_value={"cache_dir": "http://127.0.0.1:17598", "size_mb": 0},
        ), patch.object(
            bridge, "resolve_big_files",
            return_value={"source": "comfyui-service", "cache_dir": "http://127.0.0.1:17598", "comfyui_version": "0.33.0"},
        ), patch.object(
            bridge, "small_pieces_status",
            return_value={"ready": True, "missing": [], "snapshot_dirs": {}},
        ):
            row = model_inventory.build_model_status()[0]
        self.assertEqual(row["bigFilesSource"], "comfyui-service")
        self.assertEqual(row["pointedFiles"], ["http://127.0.0.1:17598"])
        self.assertEqual(row["comfyuiVersion"], "0.33.0")
        self.assertFalse(row["pointed"])


if __name__ == "__main__":
    unittest.main()


class ManyingT2ITemplateTests(unittest.TestCase):
    """09-11 漫影专属生图:manying_t2i 模板 + checkpoint(model_file)注入通道。"""

    def test_manying_t2i_validates_and_binds_model_file(self):
        template = bridge.load_template("manying_t2i")
        self.assertEqual(template["schemaVersion"], 1)
        binding = template["inputs"].get("model_file")
        self.assertIsNotNone(binding)
        self.assertEqual(binding["node"], "3")
        self.assertEqual(binding["field"], "unet_name")
        # 图内默认权重仍是 K2 主力(manying 模板=krea2_t2i 同构图+模型可选)
        self.assertEqual(template["graph"]["3"]["inputs"]["unet_name"], "krea2_turbo_bf16.safetensors")

    def test_instantiate_injects_model_file_when_present(self):
        template = bridge.load_template("manying_t2i")
        graph = bridge.instantiate_template(
            template, "水墨少年", None, 8, None, "1:1", [], model_file="other_model.safetensors")
        self.assertEqual(graph["3"]["inputs"]["unet_name"], "other_model.safetensors")
        self.assertEqual(graph["6"]["inputs"]["text"], "水墨少年")

    def test_instantiate_without_model_file_keeps_template_default(self):
        # 既有调用面(分镜链等)不传 model_file:默认权重原样,行为零变化
        template = bridge.load_template("manying_t2i")
        graph = bridge.instantiate_template(template, "p", None, 8, None, "1:1", [])
        self.assertEqual(graph["3"]["inputs"]["unet_name"], "krea2_turbo_bf16.safetensors")

    def test_generate_with_manying_template_routes_without_references(self):
        # 路由护栏回归(09-12 实弹踩中):漫影纯文生图模板点名跑、无参考图必须放行
        # (修复前被「模板需要参考图: manying_t2i」秒拒);checkpoint 注入要落到提交图
        png = b"fake-png"
        history = {"pid": {"status": {"status_str": "success"}, "outputs": {"12": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]}}}}
        responses = [{"system": {"comfyui_version": "0.33.0"}}, {"prompt_id": "pid", "node_errors": []}, history]
        with patch.object(bridge, "_available_node_classes", return_value=_all_template_classes_available()), patch.object(
            bridge, "_http_json", side_effect=responses
        ) as http_json, patch.object(bridge, "_fetch_bytes", return_value=png), patch.object(bridge.time, "sleep"):
            result = bridge.generate("水墨少年", "1:1", None, 8, 42, template="manying_t2i", checkpoint="other_model.safetensors")
        self.assertEqual(base64.b64decode(result), png)
        submitted = http_json.call_args_list[1].args[2]["prompt"]
        self.assertEqual(submitted["3"]["inputs"]["unet_name"], "other_model.safetensors")


class ManyingT2IFastTemplateTests(unittest.TestCase):
    """09-12 Krea2 加速工作流:4 步蒸馏 LoRA 挂 LoraLoaderModelOnly,模型钉死。"""

    def test_fast_template_validates_with_lora_chain(self):
        template = bridge.load_template("manying_t2i_fast")
        self.assertEqual(template["schemaVersion"], 1)
        lora = template["graph"]["14"]
        self.assertEqual(lora["class_type"], "LoraLoaderModelOnly")
        self.assertEqual(lora["inputs"]["model"], ["3", 0])
        self.assertEqual(lora["inputs"]["strength_model"], 1.0)
        # KSampler 的 model 必须吃 LoRA 输出(而不是直连 UNETLoader)
        self.assertEqual(template["graph"]["9"]["inputs"]["model"], ["14", 0])
        self.assertEqual(template["graph"]["9"]["inputs"]["steps"], 4)
        self.assertEqual(template["graph"]["9"]["inputs"]["cfg"], 1.0)

    def test_fast_template_pins_model_even_if_checkpoint_passed(self):
        # 加速档蒸馏 LoRA 只对 Krea2 Turbo 有效:模板不声明 model_file 绑定,
        # 调用方即使传了 checkpoint 也被 bindings 检查天然忽略(防呆)
        template = bridge.load_template("manying_t2i_fast")
        self.assertNotIn("model_file", template["inputs"])
        graph = bridge.instantiate_template(
            template, "雪夜孤城", None, 4, None, "1:1", [], model_file="other_model.safetensors")
        self.assertEqual(graph["3"]["inputs"]["unet_name"], "krea2_turbo_bf16.safetensors")
        self.assertEqual(graph["9"]["inputs"]["steps"], 4)
        self.assertEqual(graph["6"]["inputs"]["text"], "雪夜孤城")

    def test_generate_with_fast_template_routes_without_references(self):
        # 路由护栏回归(09-12 实弹踩中):加速档点名模板无参考图也必须放行,
        # 且提交给 /prompt 的 graph 挂着 LoraLoaderModelOnly、步数=4
        png = b"fake-png"
        history = {"pid": {"status": {"status_str": "success"}, "outputs": {"11": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]}}}}
        responses = [{"system": {"comfyui_version": "0.33.0"}}, {"prompt_id": "pid", "node_errors": []}, history]
        with patch.object(bridge, "_available_node_classes", return_value=_all_template_classes_available()), patch.object(
            bridge, "_http_json", side_effect=responses
        ) as http_json, patch.object(bridge, "_fetch_bytes", return_value=png), patch.object(bridge.time, "sleep"):
            result = bridge.generate("雪夜孤城", "1:1", None, 4, 42, template="manying_t2i_fast")
        self.assertEqual(base64.b64decode(result), png)
        submitted = http_json.call_args_list[1].args[2]["prompt"]
        self.assertEqual(submitted["14"]["class_type"], "LoraLoaderModelOnly")
        self.assertEqual(submitted["9"]["inputs"]["model"], ["14", 0])
        self.assertEqual(submitted["9"]["inputs"]["steps"], 4)
