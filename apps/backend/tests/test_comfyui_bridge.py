from __future__ import annotations

import base64
import os
import unittest
from unittest.mock import patch

from image_gen.engines import comfyui_bridge as bridge
from image_gen import model_cache, model_inventory
from image_gen.pipeline import PipelineError


class BridgeContractTests(unittest.TestCase):
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

    def test_multi_reference_slots_are_injected_and_truncated(self):
        template = bridge.load_template("krea2_edit_ref")
        graph = bridge.instantiate_template(template, "p", "n", 4, 9, "16:9", ["a", "b", "c", "d", "e"])
        # 单参考槽设计(与用户 krea2edit 活跃链同构):首图注入,其余安全截断;
        # 多槽变体(image_b=主体第二槽)待 ComfyUI 重开后按模板变体补
        self.assertEqual(template["inputs"]["references"], [{"node": "45", "field": "image"}])
        self.assertEqual(graph["45"]["inputs"]["image"], "a")

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

    def test_find_cached_is_service_entry(self):
        with patch.object(bridge, "resolve_big_files", return_value={"cache_dir": "http://127.0.0.1:8000"}):
            found = bridge.find_cached()
        self.assertEqual(found["repo_id"], "comfyui-service:127.0.0.1:8000")

    def test_bridge_is_registered_as_service_model(self):
        self.assertIs(model_cache.IMAGE_MODELS[bridge.MODEL_NAME], bridge.SPEC)
        self.assertIs(model_cache._ENGINE_BY_LAYOUT[bridge.LAYOUT], bridge)

    def test_inventory_projects_service_probe_and_template_state(self):
        with patch.object(model_inventory, "IMAGE_MODELS", {bridge.MODEL_NAME: bridge.SPEC}), patch.object(
            model_inventory, "find_cached_image_model_for_spec",
            return_value={"cache_dir": "http://127.0.0.1:8000", "size_mb": 0},
        ), patch.object(
            bridge, "resolve_big_files",
            return_value={"source": "comfyui-service", "cache_dir": "http://127.0.0.1:8000", "comfyui_version": "0.33.0"},
        ), patch.object(
            bridge, "small_pieces_status",
            return_value={"ready": True, "missing": [], "snapshot_dirs": {}},
        ):
            row = model_inventory.build_model_status()[0]
        self.assertEqual(row["bigFilesSource"], "comfyui-service")
        self.assertEqual(row["pointedFiles"], ["http://127.0.0.1:8000"])
        self.assertEqual(row["comfyuiVersion"], "0.33.0")
        self.assertFalse(row["pointed"])


if __name__ == "__main__":
    unittest.main()
