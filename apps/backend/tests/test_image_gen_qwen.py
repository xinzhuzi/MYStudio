"""Qwen-Image-Edit 2511 指向版单测(08-28-qwen-image-local-gen)。

覆盖:文本编码器键名映射纯函数 / ComfyUI 大件指向扫描 / 小件完备性 /
管线构造装配(mock 组件,验证六件套+GGUF 配方接线)/ 生成调用语义
(白底画布·参考图首位·true_cfg 需 negative)。
"""

from __future__ import annotations

import os
import sys
import tempfile
import types
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from image_gen import model_cache, pipeline


class QwenKeyMappingTests(unittest.TestCase):
    def test_lm_head_passthrough(self) -> None:
        self.assertEqual(pipeline.convert_qwen25_vl_state_dict_key("lm_head.weight"), "lm_head.weight")

    def test_visual_branch_gets_model_prefix(self) -> None:
        self.assertEqual(
            pipeline.convert_qwen25_vl_state_dict_key("visual.blocks.0.attn.qkv.weight"),
            "model.visual.blocks.0.attn.qkv.weight",
        )

    def test_language_branch_sinks_one_level(self) -> None:
        self.assertEqual(
            pipeline.convert_qwen25_vl_state_dict_key("model.layers.0.mlp.up.weight"),
            "model.language_model.layers.0.mlp.up.weight",
        )

    def test_unprefixed_keys_unchanged(self) -> None:
        self.assertEqual(
            pipeline.convert_qwen25_vl_state_dict_key("rotary_emb.inv_freq"),
            "rotary_emb.inv_freq",
        )


def _write(path: Path, size: int = 8) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)


class PointedScanTests(unittest.TestCase):
    def test_big_files_present_reports_downloaded(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            _write(base / "diffusion_models" / "qwen_image_edit_2511_Q8_0.gguf", size=100)
            _write(base / "text_encoders" / "qwen_2.5_vl_7b.safetensors", size=24)
            with patch.dict(os.environ, {"MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(base)}):
                cached = model_cache.find_cached_qwen_pointed_model()
        self.assertIsNotNone(cached)
        self.assertEqual(cached["size_mb"], round(124 / 1024 / 1024, 2))
        self.assertTrue(cached["repo_id"].startswith("comfyui:"))

    def test_missing_text_encoder_reports_not_downloaded(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            _write(base / "diffusion_models" / "qwen_image_edit_2511_Q8_0.gguf")
            with patch.dict(os.environ, {"MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(base)}):
                self.assertIsNone(model_cache.find_cached_qwen_pointed_model())

    def test_default_dir_is_home_comfyui(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(
                model_cache.comfyui_models_dir(),
                Path.home() / "Project" / "ComfyUI" / "models",
            )


class SmallPiecesTests(unittest.TestCase):
    @staticmethod
    def _fake_cache(root: Path) -> Path:
        cache = root / "hf-cache"
        image_snap = cache / "models--Qwen--Qwen-Image" / "snapshots" / "rev1"
        for name in model_cache.QWEN_IMAGE_REQUIRED_FILES:
            _write(image_snap / name)
        vl_snap = cache / "models--Qwen--Qwen2.5-VL-7B-Instruct" / "snapshots" / "rev1"
        for name in model_cache.QWEN_VL_REQUIRED_FILES:
            _write(vl_snap / name)
        return cache

    def test_ready_when_all_required_files_present(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            cache = self._fake_cache(Path(temp))
            status = model_cache.qwen_small_pieces_status(cache)
        self.assertTrue(status["ready"], status["missing"])
        self.assertEqual(status["missing"], [])

    def test_missing_file_is_named(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            cache = self._fake_cache(Path(temp))
            vae_weight = (
                cache / "models--Qwen--Qwen-Image" / "snapshots" / "rev1" / "vae" / "diffusion_pytorch_model.safetensors"
            )
            vae_weight.unlink()
            status = model_cache.qwen_small_pieces_status(cache)
        self.assertFalse(status["ready"])
        self.assertIn(
            "Qwen/Qwen-Image:vae/diffusion_pytorch_model.safetensors",
            status["missing"],
        )

    def test_missing_repo_lists_all_required(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            cache = self._fake_cache(Path(temp))
            import shutil

            shutil.rmtree(cache / "models--Qwen--Qwen2.5-VL-7B-Instruct")
            status = model_cache.qwen_small_pieces_status(cache)
        self.assertFalse(status["ready"])
        self.assertEqual(len(status["missing"]), len(model_cache.QWEN_VL_REQUIRED_FILES))


class PipelineConstructionTests(unittest.TestCase):
    """管线装配 mock 测试:验证尖刺配方接线(from_single_file+config=/
    GGUF 量化/六件套/VAE bf16),不实载真权重。"""

    def setUp(self) -> None:
        pipeline._pipelines.clear()
        self._temp = tempfile.TemporaryDirectory()
        root = Path(self._temp.name)
        comfy = root / "comfyui"
        _write(comfy / "diffusion_models" / "qwen_image_edit_2511_Q8_0.gguf", size=64)
        _write(comfy / "text_encoders" / "qwen_2.5_vl_7b.safetensors", size=32)
        image_snap = root / "cache" / "models--Qwen--Qwen-Image" / "snapshots" / "rev1"
        for name in model_cache.QWEN_IMAGE_REQUIRED_FILES:
            _write(image_snap / name)
        vl_snap = root / "cache" / "models--Qwen--Qwen2.5-VL-7B-Instruct" / "snapshots" / "rev1"
        for name in model_cache.QWEN_VL_REQUIRED_FILES:
            _write(vl_snap / name)
        self._env = {
            "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(comfy),
            "MYSTUDIO_IMAGE_MODEL_DIR": str(root / "cache"),
        }

    def tearDown(self) -> None:
        pipeline._pipelines.clear()
        self._temp.cleanup()

    def test_pipeline_assembles_six_components_from_pointed_files(self) -> None:
        captured: dict[str, object] = {}

        class FakeTransformer:
            @staticmethod
            def from_single_file(path, config=None, quantization_config=None, torch_dtype=None):
                captured["transformer_path"] = path
                captured["transformer_config"] = config
                captured["quantization_config"] = quantization_config
                return object()

        class FakeVae:
            @staticmethod
            def from_pretrained(directory, subfolder=None, torch_dtype=None):
                captured["vae_dir"] = directory
                captured["vae_subfolder"] = subfolder
                captured["vae_dtype"] = torch_dtype
                return object()

        class FakeScheduler:
            @staticmethod
            def from_pretrained(directory, subfolder=None):
                return object()

        class FakeTokenizer:
            @staticmethod
            def from_pretrained(directory):
                captured["tokenizer_dir"] = directory
                return object()

        class FakeProcessor:
            @staticmethod
            def from_pretrained(directory):
                captured["processor_dir"] = directory
                return object()

        class FakeVLConfig:
            @staticmethod
            def from_json_file(path):
                captured["vl_config_path"] = path
                return object()

        class FakeVLModel:
            def __init__(self, config) -> None:
                captured["vl_model_config"] = config

            def load_state_dict(self, state_dict, strict=False, assign=False):
                captured["te_state_dict_keys"] = sorted(state_dict)
                return ([], [])

            def to(self, dtype):
                return self

        @contextmanager
        def fake_init_empty_weights():
            yield

        def fake_load_file(path):
            return {
                "lm_head.weight": 1,
                "visual.patch_embed": 2,
                "model.layers.0": 3,
                "rotary.inv_freq": 4,
            }

        class FakePipe:
            def __init__(self, **kwargs) -> None:
                captured["pipe_kwargs_keys"] = sorted(kwargs)
                self.kwargs = kwargs

            def to(self, device):
                captured["device"] = device
                return self

        fake_torch = types.SimpleNamespace(
            backends=types.SimpleNamespace(
                mps=types.SimpleNamespace(is_available=lambda: False),
            ),
            cuda=types.SimpleNamespace(is_available=lambda: False),
            bfloat16="bf16",
        )
        modules = {
            "torch": fake_torch,
            "diffusers": types.SimpleNamespace(
                AutoencoderKLQwenImage=FakeVae,
                FlowMatchEulerDiscreteScheduler=FakeScheduler,
                QwenImageEditPlusPipeline=FakePipe,
                QwenImageTransformer2DModel=FakeTransformer,
            ),
            "diffusers.quantizers.quantization_config": types.SimpleNamespace(
                GGUFQuantizationConfig=lambda compute_dtype=None: ("gguf-quant", compute_dtype)
            ),
            "transformers": types.SimpleNamespace(
                AutoProcessor=FakeProcessor,
                AutoTokenizer=FakeTokenizer,
                Qwen2_5_VLConfig=FakeVLConfig,
                Qwen2_5_VLForConditionalGeneration=FakeVLModel,
            ),
            "accelerate": types.SimpleNamespace(init_empty_weights=fake_init_empty_weights),
            # 假 safetensors 必须带 __path__ 才能作为包被 "import safetensors.torch" 解析
            "safetensors.torch": types.SimpleNamespace(load_file=fake_load_file),
        }
        fake_safetensors = types.ModuleType("safetensors")
        fake_safetensors.__path__ = []
        modules["safetensors"] = fake_safetensors

        with patch.dict(sys.modules, modules), patch.dict(os.environ, self._env):
            pipe = pipeline._get_qwen_pipeline(model_cache.QWEN_IMAGE_EDIT_MODEL)

        self.assertIs(pipe, pipe)  # noqa: PLR0124 — 构造成功即达意
        self.assertTrue(str(captured["transformer_path"]).endswith("qwen_image_edit_2511_Q8_0.gguf"))
        self.assertTrue(str(captured["transformer_config"]).endswith("transformer"))
        self.assertEqual(captured["quantization_config"], ("gguf-quant", "bf16"))
        self.assertEqual(captured["vae_dtype"], "bf16")
        self.assertEqual(captured["vae_subfolder"], "vae")
        # TE 键名映射:ComfyUI 原始导出 → transformers 5.x 结构
        self.assertEqual(
            captured["te_state_dict_keys"],
            ["lm_head.weight", "model.language_model.layers.0", "model.visual.patch_embed", "rotary.inv_freq"],
        )
        self.assertEqual(
            captured["pipe_kwargs_keys"],
            ["processor", "scheduler", "text_encoder", "tokenizer", "transformer", "vae"],
        )
        self.assertEqual(captured["device"], "cpu")

    def test_pipeline_fails_closed_when_small_pieces_missing(self) -> None:
        env = dict(self._env)
        with tempfile.TemporaryDirectory() as temp:
            env["MYSTUDIO_IMAGE_MODEL_DIR"] = str(Path(temp) / "empty-cache")
            with patch.dict(os.environ, env):
                with self.assertRaises(pipeline.PipelineError) as context:
                    pipeline._get_qwen_pipeline(model_cache.QWEN_IMAGE_EDIT_MODEL)
        self.assertEqual(context.exception.code, "small-pieces-missing")

    def test_pipeline_fails_closed_when_big_files_missing(self) -> None:
        env = dict(self._env)
        with tempfile.TemporaryDirectory() as temp:
            env["MYSTUDIO_QWEN_COMFYUI_MODELS_DIR"] = str(Path(temp) / "no-comfyui")
            with patch.dict(os.environ, env):
                with self.assertRaises(pipeline.PipelineError) as context:
                    pipeline._get_qwen_pipeline(model_cache.QWEN_IMAGE_EDIT_MODEL)
        self.assertEqual(context.exception.code, "model-not-downloaded")


class GenerateSemanticsTests(unittest.TestCase):
    def setUp(self) -> None:
        pipeline._pipelines.clear()

    def tearDown(self) -> None:
        pipeline._pipelines.clear()

    def test_t2i_uses_white_canvas_and_official_tier(self) -> None:
        captured: dict[str, object] = {}

        from PIL import Image

        class FakeResult:
            images = [Image.new("RGB", (64, 36))]

        class FakePipe:
            def __call__(self, **kwargs):
                captured.update(kwargs)
                return FakeResult()

        with patch.object(pipeline, "_get_qwen_pipeline", return_value=FakePipe()):
            b64 = pipeline._generate_qwen("一只仙鹤", "16:9", None, steps=20, seed=None, reference_image_b64=None)

        self.assertTrue(b64)  # 真 PIL 编码回 b64
        images = captured["image"]
        self.assertIsInstance(images, list)
        self.assertEqual(images[0].size, (1664, 928))
        self.assertEqual(images[0].getpixel((0, 0)), (255, 255, 255))
        self.assertEqual(captured["num_inference_steps"], 20)
        self.assertNotIn("negative_prompt", captured)
        self.assertNotIn("true_cfg_scale", captured)

    def test_negative_prompt_enables_true_cfg(self) -> None:
        captured: dict[str, object] = {}

        from PIL import Image

        class FakeResult:
            images = [Image.new("RGB", (64, 36))]

        class FakePipe:
            def __call__(self, **kwargs):
                captured.update(kwargs)
                return FakeResult()

        with patch.object(pipeline, "_get_qwen_pipeline", return_value=FakePipe()):
            pipeline._generate_qwen(
                "仙鹤", "1:1", "低质量", steps=20, seed=None, reference_image_b64=None
            )

        self.assertEqual(captured["negative_prompt"], "低质量")
        self.assertEqual(captured["true_cfg_scale"], 4.0)


class LegacyAliasTests(unittest.TestCase):
    def test_legacy_ids_resolve_to_qwen(self) -> None:
        self.assertEqual(model_cache.resolve_image_model_name("sdxl-turbo"), "qwen-image-edit-2511")
        self.assertEqual(model_cache.resolve_image_model_name("flux-schnell"), "qwen-image-edit-2511")
        self.assertEqual(model_cache.resolve_image_model_name("qwen-image-edit-2511"), "qwen-image-edit-2511")


if __name__ == "__main__":
    unittest.main()


class InferenceSerializationTests(unittest.TestCase):
    def test_concurrent_second_request_fails_fast_with_busy(self) -> None:
        import threading
        import time

        from PIL import Image

        release = threading.Event()

        class FakeResult:
            images = [Image.new("RGB", (64, 36))]

        class SlowPipe:
            def __call__(self, **kwargs):  # noqa: ARG002
                release.wait(timeout=5)
                return FakeResult()

        class FastPipe:
            def __call__(self, **kwargs):  # noqa: ARG002
                raise AssertionError("忙时不得进入推理")

        outcomes: dict[str, object] = {}

        def run_first():
            with patch.object(pipeline, "_get_qwen_pipeline", return_value=SlowPipe()):
                outcomes["first"] = pipeline._generate_qwen(
                    "a", "1:1", None, 1, None, None
                ) is not None

        def run_second():
            time.sleep(0.05)  # 确保先发请求已持锁
            with patch.object(pipeline, "_get_qwen_pipeline", return_value=FastPipe()):
                try:
                    pipeline._generate_qwen("b", "1:1", None, 1, None, None)
                    outcomes["second"] = "ran"
                except pipeline.PipelineError as exc:
                    outcomes["second"] = exc.code

        first = threading.Thread(target=run_first)
        second = threading.Thread(target=run_second)
        first.start(); second.start()
        second.join(timeout=3)
        release.set()
        first.join(timeout=3)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertIs(outcomes.get("first"), True)
        self.assertEqual(outcomes.get("second"), "generation-busy")
