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
    / "backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json"
)
I2I_TEMPLATE_PATH = (
    REPO_ROOT
    / "backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qwen21-道劫-i2i-api.json"
)
I2I_CANVAS_PATH = (
    REPO_ROOT
    / "backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
)


class Qwen21RegistrationTests(unittest.TestCase):
    def test_model_registered_with_service_layout(self) -> None:
        spec = model_cache.IMAGE_MODELS[qwen21.MODEL_NAME]
        self.assertEqual(qwen21.MODEL_NAME, "qwen-image-2-1")
        self.assertEqual(spec["layout"], "qwen21-viggle")
        self.assertIn("qwen21-viggle", pipeline._ENGINE_BY_LAYOUT)
        self.assertIs(pipeline._ENGINE_BY_LAYOUT["qwen21-viggle"], qwen21)

    def test_reference_supported_flags(self) -> None:
        # 10-19 图生图·画风转换(D3):单参考放开(SUPPORTS_REFERENCE=True 走 i2i 分流),
        # 多参考仍关(恒单参考,--enable-ref3 语义不在本役)
        self.assertTrue(qwen21.SUPPORTS_REFERENCE)
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
        # 现行 GUI/API 契约:ApiPE 装配、Turbo 8步官方采样、SeedVR2 2K 超分在场;
        # 7034 mikkoani×0.8→7028 Turbo×1.0,底模为1;1016 拆除的7027 Fix×0.5不得回灌。
        classes = {node["class_type"] for node in self.template["graph"].values()}
        self.assertIn("MyQi21ApiPE", classes)
        self.assertIn("MyQi21DaojieBase", classes)
        self.assertIn("ManualSigmas", classes)
        self.assertIn("SamplerCustomAdvanced", classes)
        self.assertNotIn("ViggleTurboLora", classes)
        self.assertNotIn("ViggleTurboSigmas", classes)
        self.assertIn("SeedVR2VideoUpscaler", classes)
        self.assertNotIn("7:7027", self.template["graph"])
        self.assertEqual(self.template["graph"]["7:7034"]["class_type"], "LoraLoaderModelOnly")
        style = self.template["graph"]["7:7034"]["inputs"]
        self.assertEqual(style["lora_name"], "qi21-mikkoani.safetensors")
        self.assertEqual(style["strength_model"], 0.8)
        self.assertEqual(style["model"], ["1", 0])
        self.assertEqual(self.template["graph"]["7:7028"]["class_type"], "LoraLoaderModelOnly")
        turbo = self.template["graph"]["7:7028"]["inputs"]
        self.assertEqual(turbo["lora_name"], "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors")
        self.assertEqual(turbo["strength_model"], 1.0)
        self.assertEqual(turbo["model"], ["7:7034", 0])
        speed = self.template["graph"]["7:7015"]["inputs"]["mode"]
        self.assertEqual(speed, "0 · Turbo 8步")
        self.assertIs(self.template['graph']['6:4013']['inputs']['AI扩写开关'], False)

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
        lora = self.template["graph"]["7:7028"]["inputs"]["lora_name"]
        self.assertEqual(lora, "qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors")
        self.assertEqual(self.template['graph']['7:7028']['inputs']['strength_model'], 1.0)

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


class Qwen21I2iTemplateContractTests(unittest.TestCase):
    """10-19 图生图·画风转换:i2i API 模板契约(由 build 脚本 --target i2i 从
    qi21-道劫-i2i.json 展平生成;快照=画布现值锁——组装用途=局部编辑、Turbo 8步、
    PE 关、SeedVR2 旁路,运行时才覆写组装用途=画风转换)。"""

    def setUp(self) -> None:
        self.template = json.loads(I2I_TEMPLATE_PATH.read_text(encoding="utf-8"))
        self.graph = self.template["graph"]

    def test_i2i_template_contract(self) -> None:
        self.assertEqual(self.template["schemaVersion"], 1)
        self.assertEqual(self.template["name"], "qwen21_道劫_i2i_api")
        inputs = self.template["inputs"]
        # 绑定指向活节点且 class 吻合:prompt→400 / seed→7:7014
        prompt_binding = inputs["prompt"]
        self.assertEqual((prompt_binding["node"], prompt_binding["field"]), ("400", "value"))
        self.assertEqual(self.graph["400"]["class_type"], "PrimitiveStringMultiline")
        seed_binding = inputs["seed"]
        self.assertEqual((seed_binding["node"], seed_binding["field"]), ("7:7014", "value"))
        self.assertEqual(self.graph["7:7014"]["class_type"], "PrimitiveInt")
        # references→[10].image(LoadImage 恰 1 个=激活槽 [10])
        references = inputs.get("references")
        self.assertIsInstance(references, list)
        self.assertEqual(len(references), 1)
        ref = references[0]
        self.assertEqual((ref["node"], ref["slot"], ref["field"]), ("10", 0, "image"))
        self.assertEqual(ref["class_type"], "LoadImage")
        load_images = sorted(key for key, node in self.graph.items() if node["class_type"] == "LoadImage")
        self.assertEqual(load_images, ["10"])
        self.assertIn("image", self.graph["10"]["inputs"])
        # 旁路参考槽与 SeedVR2 双产物在模板缺席(现值快照:mode=4 剪除)
        for absent in ("11", "12", "505", "503", "504"):
            self.assertNotIn(absent, self.graph, absent)
        # SaveImage [8] 在场(唯一产物口;504 缺席→_prefer_upscaled_output 自然回落 8)
        self.assertEqual(self.graph["8"]["class_type"], "SaveImage")

    def test_i2i_snapshot_locks_canvas_values(self) -> None:
        # 组装用途快照=局部编辑(GUI 现值;运行时覆写画风转换)
        self.assertEqual(self.graph["6:4011"]["inputs"]["组装用途"], "局部编辑")
        # 档位快照=Turbo 8 步
        self.assertEqual(self.graph["7:7015"]["inputs"]["mode"], "0 · Turbo 8步")
        # PE 链在场且 pe开关 False(PE出文/PE负面 按 selected_graph 剪除)
        self.assertIs(self.graph["6:4012"]["inputs"]["value"], False)
        self.assertIn("6:4014", self.graph)
        self.assertNotIn("PE出文", self.graph["6:4014"]["inputs"])
        self.assertNotIn("PE负面", self.graph["6:4014"]["inputs"])
        # seed 单源=PrimitiveInt(7:7014) 扇出 RandomNoise
        self.assertEqual(self.graph["7:7017"]["inputs"]["noise_seed"], ["7:7014", 0])


class Qwen21I2iGenerateTests(unittest.TestCase):
    """10-19 图生图·画风转换:i2i 分流行为测(mock 上传/提交/取图)。"""

    def _all_classes_available(self) -> frozenset[str]:
        classes: set[str] = set()
        for template in (qwen21.load_template(qwen21.TEMPLATE_NAME), qwen21.load_template(qwen21.TEMPLATE_NAME_I2I)):
            classes.update(qwen21.graph_node_classes(template["graph"]))
        return frozenset(classes)

    def _run_generate(self, *, prompt_id: str = "p-run", **generate_kwargs: object) -> tuple[dict, object, object]:
        """跑一次 generate 并捕获提交图/上传调用;返回 (submitted_graph, http_json, upload)。"""
        submitted: dict = {}

        def http_json(method: str, url: str, payload: dict | None = None, timeout: float = 2) -> dict:
            if url.endswith("/prompt"):
                submitted.update(payload["prompt"])
                return {"prompt_id": prompt_id}
            if "/history/" in url:
                return {prompt_id: {"status": {"status_str": "success"}, "outputs": {
                    "8": {"images": [{"filename": "out.png", "subfolder": "", "type": "output"}]},
                }}}
            raise AssertionError(url)

        with patch.object(qwen21, "resolve_big_files", return_value={"comfyui_version": "0.41.2"}), patch.object(
            qwen21, "_available_node_classes", return_value=self._all_classes_available()
        ), patch.object(qwen21, "_http_json", side_effect=http_json) as http_mock, patch.object(
            qwen21, "_upload_image", return_value={"name": "qwen21-i2i-uploaded.png"}
        ) as upload_mock, patch.object(qwen21, "_fetch_bytes", return_value=b"i2i-png"), patch(
            "engines.comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True
        ), patch("image_gen.pipeline.is_generation_cancelled", return_value=False):
            qwen21.generate(**generate_kwargs)
        return submitted, http_mock, upload_mock

    def test_i2i_generate_overrides_assembly_purpose(self) -> None:
        canvas_before = I2I_CANVAS_PATH.read_bytes()
        graph_one, _, upload_one = self._run_generate(
            prompt="画风转换指令甲", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=None,
            reference_b64="aWlpcmVmaW9uZQ==",
        )
        self.assertEqual(graph_one["6:4011"]["inputs"]["组装用途"], "画风转换")
        self.assertEqual(graph_one["10"]["inputs"]["image"], "qwen21-i2i-uploaded.png")
        self.assertRegex(upload_one.call_args.args[2], r"^qwen21-i2i-[0-9a-f]{32}\.png$")
        self.assertEqual(graph_one["400"]["inputs"]["value"], "画风转换指令甲")
        # seed=None 时每次随机(fire 铁令):两次提交的 7:7014 不同
        graph_two, _, _ = self._run_generate(
            prompt="画风转换指令乙", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=None,
            reference_b64="aWlpcmVmaW9uZQ==",
        )
        seed_one = graph_one["7:7014"]["inputs"]["value"]
        seed_two = graph_two["7:7014"]["inputs"]["value"]
        self.assertIsInstance(seed_one, int)
        self.assertNotEqual(seed_one, seed_two)
        self.assertTrue(1 <= seed_one <= 2**31 - 1 and 1 <= seed_two <= 2**31 - 1)
        # GUI 本体文件未被改写
        self.assertEqual(I2I_CANVAS_PATH.read_bytes(), canvas_before)

    def test_i2i_rejects_multi_reference(self) -> None:
        from image_gen.pipeline import PipelineError

        with patch.object(qwen21, "resolve_big_files", return_value={"comfyui_version": "0.41.2"}), patch(
            "engines.comfyui.engine_manager.EngineManager.ensure_engine_ready", return_value=True
        ), patch("image_gen.pipeline.is_generation_cancelled", return_value=False):
            with self.assertRaises(PipelineError) as caught:
                qwen21.generate(
                    "指令", "1:1", None, 8, None,
                    reference_b64="c2Vjb25kcmVm",
                    reference_images_b64=["cmVmMQ==", "cmVmMg=="],
                )
        self.assertEqual(caught.exception.code, "reference-unsupported")

    def test_t2i_path_unchanged_without_reference(self) -> None:
        # 回归锁:无参考图走原 t2i 路逐字节不变(t2i 模板实例化原样提交,不上传参考图)
        submitted, _, upload_mock = self._run_generate(
            prompt="t2i 回归", aspect_ratio="1:1", negative_prompt=None, steps=8, seed=42,
        )
        upload_mock.assert_not_called()
        expected = qwen21.instantiate_template(
            qwen21.load_template(qwen21.TEMPLATE_NAME), "t2i 回归", None, 8, 42, "1:1", [],
        )
        self.assertEqual(submitted, expected)
        self.assertNotIn("10", submitted)


if __name__ == "__main__":
    unittest.main()
