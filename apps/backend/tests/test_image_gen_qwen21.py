"""Qwen-Image-2.1(qwen21-viggle)本地渠道注册与模板契约测试。"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from engines.image_engine import model_cache, qwen21
from image_gen import pipeline


REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_PATH = (
    REPO_ROOT
    / "backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-daojie-t2i.json"
)


class Qwen21RegistrationTests(unittest.TestCase):
    def test_model_registered_with_service_layout(self) -> None:
        spec = model_cache.IMAGE_MODELS[qwen21.MODEL_NAME]
        self.assertEqual(qwen21.MODEL_NAME, "qwen-image-2-1")
        self.assertEqual(spec["layout"], "qwen21-viggle")
        self.assertIn("qwen21-viggle", pipeline._ENGINE_BY_LAYOUT)
        self.assertIs(pipeline._ENGINE_BY_LAYOUT["qwen21-viggle"], qwen21)

    def test_reference_images_rejected_upstream(self) -> None:
        # 一期纯文生图:能力旗标必须为 False,让 generate_image 在就绪检查前就指路
        self.assertFalse(qwen21.SUPPORTS_REFERENCE)
        self.assertFalse(qwen21.SUPPORTS_MULTI_REFERENCE)


class Qwen21TemplateContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.template = json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))

    def test_bridge_contract_shape(self) -> None:
        self.assertEqual(self.template["schemaVersion"], 1)
        self.assertIsInstance(self.template["graph"], dict)
        self.assertIsInstance(self.template["inputs"], dict)
        self.assertTrue(
            any(node.get("class_type") == "SaveImage" for node in self.template["graph"].values())
        )

    def test_bindings_point_at_live_nodes(self) -> None:
        for key, binding in self.template["inputs"].items():
            node = self.template["graph"][str(binding["node"])]
            self.assertEqual(node["class_type"], binding["class_type"], key)
            self.assertIn(binding["field"], node["inputs"], key)

    def test_runs_daojie_production_graph(self) -> None:
        # 用户裁定(1010):渠道必须跑 qi21-道劫-t2i 工作流本体——ApiPE 装配链在场,
        # viggle 9步双段加速链在场,detail-fix×0.5 挂段A,SeedVR2 2K 超分链在场
        classes = {node["class_type"] for node in self.template["graph"].values()}
        self.assertIn("MyQi21ApiPE", classes)
        self.assertIn("MyQi21DaojieBase", classes)
        self.assertIn("ViggleTurboSigmas", classes)
        self.assertIn("SplitSigmas", classes)
        self.assertIn("SeedVR2VideoUpscaler", classes)
        fix = self.template["graph"]["7:7027"]["inputs"]
        self.assertEqual(fix["lora_name"], "qwen2.1-detail-fix-2.0.safetensors")
        self.assertEqual(fix["strength_model"], 0.5)
        speed = self.template["graph"]["7:7015"]["inputs"]["mode"]
        self.assertIn("viggle", speed)

    def test_seed_single_source(self) -> None:
        # seed 单源=PrimitiveInt(7:7014) 扇出 RandomNoise;绑定必须指它
        noise = self.template["graph"]["7:7017"]["inputs"]["noise_seed"]
        self.assertEqual(noise, ["7:7014", 0])
        binding = self.template["inputs"]["seed"]
        self.assertEqual((binding["node"], binding["field"]), ("7:7014", "value"))

    def test_engine_model_files_are_real_installed_names(self) -> None:
        # 幽灵文件名回归锁(int8_convrot/r128 从未安装,见 1005 记忆)
        self.assertEqual(self.template["graph"]["1"]["inputs"]["unet_name"], "qwen_image_2.1_bf16.safetensors")
        self.assertEqual(self.template["graph"]["2"]["inputs"]["clip_name"], "qwen3vl_8b_bf16_heretic.safetensors")
        lora = self.template["graph"]["7:7011"]["inputs"]["lora_name"]
        self.assertIn("r256", lora)

    def test_small_pieces_ready_when_template_loadable(self) -> None:
        status = qwen21.small_pieces_status()
        self.assertTrue(status["ready"], f"模板应可加载: {status}")

    def test_base_type_override_applies_to_assembly_subgraph(self) -> None:
        # 型参数面(1010):调用方点名型→覆写[6:4010];缺省/空串→保持画布现值
        graph = {"6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": "人物", "透明覆盖": False}}}
        qwen21.apply_base_type(graph, "分镜")
        self.assertEqual(graph["6:4010"]["inputs"]["base"], "分镜")
        qwen21.apply_base_type(graph, None)
        self.assertEqual(graph["6:4010"]["inputs"]["base"], "分镜")
        qwen21.apply_base_type(graph, "   ")
        self.assertEqual(graph["6:4010"]["inputs"]["base"], "分镜")

    def test_upscaled_output_preferred_over_base(self) -> None:
        history = {"pid": {"status": {"status_str": "success"}, "outputs": {
            "8": {"images": [{"filename": "base.png"}]},
            "504": {"images": [{"filename": "2k.png"}]},
        }}}
        state, image = qwen21._prefer_upscaled_output(history, "pid")
        self.assertEqual(state, "success")
        self.assertEqual(image["filename"], "2k.png")
        only_base = {"pid": {"status": {"status_str": "success"}, "outputs": {
            "8": {"images": [{"filename": "base.png"}]},
        }}}
        state, image = qwen21._prefer_upscaled_output(only_base, "pid")
        self.assertEqual(image["filename"], "base.png")


if __name__ == "__main__":
    unittest.main()
