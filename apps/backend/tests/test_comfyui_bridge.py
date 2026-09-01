from __future__ import annotations

import base64
import io
from urllib.error import HTTPError
import os
import unittest
from unittest.mock import patch

from image_gen.engines import comfyui_bridge as bridge
from image_gen import model_cache, model_inventory
from image_gen.pipeline import PipelineError


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
        with patch.object(bridge, "_http_json", side_effect=[{"system": {"comfyui_version": "0.33.0"}}, {"prompt_id": "pid", "node_errors": []}, {"pid": {"status": {"status_str": "success"}, "outputs": {"9": {"images": [{"filename": "out.png"}]}}}}]), patch.object(
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
        with patch.object(bridge, "_http_json", side_effect=responses), patch.object(bridge, "_upload_image", return_value={"name": "ref.png"}), patch.object(bridge, "_fetch_bytes", return_value=png), patch.object(bridge.time, "sleep"):
            result = bridge.generate("hello", "1:1", None, 8, 1, reference_b64="aGVsbG8=")
        self.assertEqual(base64.b64decode(result), png)

    def test_error_codes_timeout_no_output_and_execution(self):
        with patch.object(bridge, "_http_json", side_effect=OSError("offline")):
            with self.assertRaises(PipelineError) as ctx:
                bridge.generate("x", "1:1", None, 8, None)
        self.assertEqual(ctx.exception.code, "bridge-unreachable")
        with patch.object(bridge, "_http_json", side_effect=[{"system": {}}, {"prompt_id": "p", "node_errors": [{"x": "bad"}]}]):
            with self.assertRaises(PipelineError) as ctx:
                bridge.generate("x", "1:1", None, 8, None)
        self.assertEqual(ctx.exception.code, "bridge-execution-failed")

    def test_timeout_interrupts_active_prompt_best_effort(self):
        responses = [{"system": {"comfyui_version": "0.33.0"}}, {"prompt_id": "p", "node_errors": []}, {}]
        with patch.object(bridge, "_http_json", side_effect=responses) as http_json, patch.object(
            bridge.time, "monotonic", side_effect=[0.0, 1.0, 2.0]
        ), patch.dict(os.environ, {"MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S": "1"}, clear=True), patch.object(
            bridge.time, "sleep"
        ):
            with self.assertRaises(PipelineError) as ctx:
                bridge.generate("x", "1:1", None, 8, None)
        self.assertEqual(ctx.exception.code, "bridge-timeout")
        self.assertEqual(http_json.call_args_list[-1].args[:2], ("POST", "http://127.0.0.1:17598/interrupt"))

    def test_find_cached_is_service_entry(self):
        with patch.object(bridge, "resolve_big_files", return_value={"cache_dir": "http://127.0.0.1:17598"}):
            found = bridge.find_cached()
        self.assertEqual(found["repo_id"], "comfyui-service:127.0.0.1:17598")

    def test_bridge_is_registered_as_service_model(self):
        self.assertIs(model_cache.IMAGE_MODELS[bridge.MODEL_NAME], bridge.SPEC)
        self.assertIs(model_cache._ENGINE_BY_LAYOUT[bridge.LAYOUT], bridge)

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
