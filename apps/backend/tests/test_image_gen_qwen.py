"""Qwen-Image-Edit 2511 指向版单测(08-28-qwen-image-local-gen)。

覆盖:文本编码器键名映射纯函数 / ComfyUI 大件指向扫描 / 小件完备性 /
管线构造装配(mock 组件,验证六件套+GGUF 配方接线)/ 生成调用语义
(白底画布·参考图首位·true_cfg 需 negative)。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import types
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from image_gen import download_model, model_cache, model_inventory, pipeline
from image_gen.engines import flux2 as flux2_engine
from image_gen.engines import krea2 as krea2_engine
from image_gen.engines import z_image as z_image_engine


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

    def test_z_image_uses_its_dedicated_comfyui_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            _write(base / model_cache.Z_COMFY_MAIN_FILE)
            _write(base / model_cache.Z_COMFY_TEXT_ENCODER_FILE)
            with patch.dict(
                os.environ,
                {
                    "MYSTUDIO_ZIMAGE_COMFYUI_MODELS_DIR": str(base),
                    "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(base / "qwen-not-z"),
                },
            ):
                resolved = model_cache.resolve_z_image_big_files()
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved["source"], "comfyui")
        self.assertEqual(resolved["main"], base / model_cache.Z_COMFY_MAIN_FILE)


class NativeEngineReadinessTests(unittest.TestCase):
    def test_pointed_engines_fail_closed_when_small_pieces_are_missing(self) -> None:
        cases = (
            ("z-image-turbo", z_image_engine),
            ("flux2-klein-9b", flux2_engine),
            ("krea2-turbo", krea2_engine),
        )
        for model_name, engine in cases:
            with self.subTest(model_name=model_name), patch.object(
                pipeline, "find_cached_image_model_for_spec", return_value={"size_mb": 1}
            ), patch.object(
                engine,
                "small_pieces_status",
                return_value={"ready": False, "missing": ["required/config.json"]},
            ):
                with self.assertRaises(pipeline.PipelineError) as context:
                    pipeline._require_downloaded(model_name)

            self.assertEqual(context.exception.code, "small-pieces-missing")
            self.assertIn("required/config.json", context.exception.message)

    def test_z_image_generation_uses_dedicated_comfyui_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            z_dir = Path(temp) / "z-models"
            shared_dir = Path(temp) / "shared-models"
            with patch.dict(
                os.environ,
                {
                    "MYSTUDIO_ZIMAGE_COMFYUI_MODELS_DIR": str(z_dir),
                    "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(shared_dir),
                },
            ), patch.object(pipeline, "_require_downloaded"), patch.object(
                z_image_engine, "generate", return_value="ZmFrZQ=="
            ) as generate:
                result = pipeline.generate_image("z-image-turbo", "一只仙鹤")

        self.assertEqual(result, "ZmFrZQ==")
        self.assertEqual(generate.call_args.kwargs["models_dir"], z_dir)


class CacheIsolationTests(unittest.TestCase):
    def test_image_cache_ignores_legacy_tts_environment_variables(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            tts_root = Path(temp) / "legacy-tts"
            voicebox_root = Path(temp) / "legacy-voicebox"
            with patch.dict(
                os.environ,
                {
                    "MANYING_TTS_MODELS_DIR": str(tts_root),
                    "VOICEBOX_MODELS_DIR": str(voicebox_root),
                },
                clear=True,
            ):
                primary = model_cache.primary_hf_cache_dir()
                candidates = model_cache.hf_cache_dirs()

        self.assertNotEqual(primary, tts_root)
        self.assertNotEqual(primary, voicebox_root)
        self.assertNotIn(tts_root, candidates)
        self.assertNotIn(voicebox_root, candidates)

    def test_hf_home_uses_hub_subdirectory_for_read_and_write(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            hf_home = Path(temp) / "huggingface"
            with patch.dict(os.environ, {"HF_HOME": str(hf_home)}, clear=True):
                primary = model_cache.primary_hf_cache_dir()
                download = model_cache.download_hf_cache_dir()
                primary_repo = model_cache.repo_cache_dir("Qwen/Test")
                download_repo = model_cache.repo_cache_dir("Qwen/Test", download)
                _write(download_repo / "snapshots" / "rev1" / "config.json", size=2)
                cached = model_cache._find_cached_hf({
                    "repo_id": "Qwen/Test",
                    "repo_ids": ("Qwen/Test",),
                })

        expected = hf_home / "hub"
        self.assertEqual(primary, expected)
        self.assertEqual(download, expected)
        self.assertEqual(primary_repo, download_repo)
        self.assertIsNotNone(cached)
        self.assertEqual(cached["cache_dir"], str(expected))


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


# ---------------------------------------------------------------------------
# 08-30 自足回退:两源解析 / 缺什么下什么 / 清单上报 / ModelScope 过滤
# ---------------------------------------------------------------------------


class TwoSourceResolveTests(unittest.TestCase):
    """resolve_qwen_big_files 优先级:ComfyUI 指向 → 应用缓存自足布局 → None。"""

    @staticmethod
    def _fake_appcache(root: Path) -> Path:
        """应用缓存自足布局:GGUF 仓 snapshot(HF 布局)+TE 仓 snapshot(ModelScope 平铺布局)。"""
        cache = root / "cache"
        gguf_snap = cache / "models--unsloth--Qwen-Image-Edit-2511-GGUF" / "snapshots" / "rev1"
        _write(gguf_snap / "qwen-image-edit-2511-Q8_0.gguf", size=100)
        te_snap = cache / "models--Comfy-Org--Qwen-Image_ComfyUI" / "snapshots" / "main"
        _write(te_snap / "split_files" / "text_encoders" / "qwen_2.5_vl_7b.safetensors", size=24)
        return cache

    def test_appcache_layout_resolves_when_comfyui_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cache = self._fake_appcache(root)
            env = {
                "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(root / "no-comfy"),
                "MYSTUDIO_IMAGE_MODEL_DIR": str(cache),
            }
            with patch.dict(os.environ, env):
                resolved = model_cache.resolve_qwen_big_files()
                cached = model_cache.find_cached_qwen_pointed_model()
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved["source"], "app-cache")
        self.assertTrue(resolved["main"].name.endswith("Q8_0.gguf"))
        self.assertTrue(str(resolved["text_encoder"]).endswith("qwen_2.5_vl_7b.safetensors"))
        self.assertEqual(resolved["size_mb"], round(124 / 1024 / 1024, 2))
        self.assertTrue(cached["repo_id"].startswith("app-cache:"))

    def test_comfyui_wins_over_appcache(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            comfy = root / "comfy"
            _write(comfy / "diffusion_models" / "qwen_image_edit_2511_Q8_0.gguf", size=10)
            _write(comfy / "text_encoders" / "qwen_2.5_vl_7b.safetensors", size=4)
            cache = self._fake_appcache(root)
            env = {
                "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(comfy),
                "MYSTUDIO_IMAGE_MODEL_DIR": str(cache),
            }
            with patch.dict(os.environ, env):
                resolved = model_cache.resolve_qwen_big_files()
        self.assertEqual(resolved["source"], "comfyui")

    def test_partial_appcache_not_ready(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cache = root / "cache"
            gguf_snap = cache / "models--unsloth--Qwen-Image-Edit-2511-GGUF" / "snapshots" / "rev1"
            _write(gguf_snap / "qwen-image-edit-2511-Q8_0.gguf", size=100)  # 只有 GGUF,无 TE
            env = {
                "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(root / "no-comfy"),
                "MYSTUDIO_IMAGE_MODEL_DIR": str(cache),
            }
            with patch.dict(os.environ, env):
                self.assertIsNone(model_cache.resolve_qwen_big_files())

    def test_neither_source_resolves_none(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            env = {
                "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(root / "a"),
                "MYSTUDIO_IMAGE_MODEL_DIR": str(root / "b"),
            }
            with patch.dict(os.environ, env):
                self.assertIsNone(model_cache.resolve_qwen_big_files())


class DownloadModeTests(unittest.TestCase):
    """缺什么下什么:大件在→只小件;大件缺→完整(ModelScope 过滤直链优先+磁盘余量门)。"""

    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        root = Path(self._temp.name)
        self._root = root
        self._cache = root / "cache"
        self._cache.mkdir()
        self._progress = root / "progress.json"
        self._calls: list[tuple[str, str, tuple[str, ...]]] = []

    def tearDown(self) -> None:
        self._temp.cleanup()

    def _fake_hub_modules(self) -> dict[str, object]:
        def fake_snapshot_download(repo_id: str, allow_patterns=None, cache_dir=None):
            self._calls.append(("hf", repo_id, tuple(allow_patterns or ())))

        def fake_ms(repo_id: str, cache_dir: str, allow_paths=None):
            self._calls.append(("ms", repo_id, tuple(allow_paths or ())))

        return {
            "huggingface_hub": types.SimpleNamespace(snapshot_download=fake_snapshot_download),
            "modelscope_hub": types.SimpleNamespace(download_repo_to_hf_cache=fake_ms),
        }

    def _env(self, comfy: str) -> dict[str, str]:
        return {
            "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": comfy,
            "MYSTUDIO_IMAGE_MODEL_DIR": str(self._cache),
        }

    def test_full_mode_when_big_missing(self) -> None:
        env = self._env(str(self._root / "no-comfy"))
        with patch.dict(sys.modules, self._fake_hub_modules()), patch.dict(os.environ, env):
            rc = download_model.download_model(model_cache.QWEN_IMAGE_EDIT_MODEL, self._progress)
        self.assertEqual(rc, 0)
        repos = {(kind, repo) for kind, repo, _ in self._calls}
        self.assertIn(("ms", model_cache.QWEN_GGUF_REPO), repos)  # 大件走 ModelScope 过滤直链
        self.assertIn(("ms", model_cache.QWEN_TE_REPO), repos)
        self.assertIn(("hf", model_cache.QWEN_IMAGE_REPO), repos)  # 小件照旧 HF snapshot
        self.assertIn(("hf", model_cache.QWEN_VL_REPO), repos)
        # 大件仓必须带 allow 清单(严禁整仓)
        for kind, repo, paths in self._calls:
            if kind == "ms" and repo in (model_cache.QWEN_GGUF_REPO, model_cache.QWEN_TE_REPO):
                self.assertTrue(paths, f"{repo} 未带 allow_paths")
        payload = json.loads(self._progress.read_text(encoding="utf-8"))
        self.assertEqual(payload["status"], "complete")
        self.assertIn("完整模型", payload["filename"])
        spec = model_cache.IMAGE_MODELS[model_cache.QWEN_IMAGE_EDIT_MODEL]
        self.assertEqual(payload["total"], spec["size_mb"] * 1024 * 1024)

    def test_small_only_when_comfyui_present(self) -> None:
        comfy = self._root / "comfy"
        _write(comfy / "diffusion_models" / "qwen_image_edit_2511_Q8_0.gguf", size=10)
        _write(comfy / "text_encoders" / "qwen_2.5_vl_7b.safetensors", size=4)
        with patch.dict(sys.modules, self._fake_hub_modules()), patch.dict(os.environ, self._env(str(comfy))):
            rc = download_model.download_model(model_cache.QWEN_IMAGE_EDIT_MODEL, self._progress)
        self.assertEqual(rc, 0)
        repos = {repo for _, repo, _ in self._calls}
        self.assertNotIn(model_cache.QWEN_GGUF_REPO, repos)
        self.assertNotIn(model_cache.QWEN_TE_REPO, repos)
        self.assertIn(model_cache.QWEN_IMAGE_REPO, repos)
        payload = json.loads(self._progress.read_text(encoding="utf-8"))
        self.assertEqual(payload["status"], "complete")
        self.assertEqual(payload["total"], model_cache.QWEN_SMALL_PIECES_SIZE_MB * 1024 * 1024)

    def test_flux2_pointed_small_download_does_not_raise_name_error(self) -> None:
        comfy = self._root / "flux-comfy"
        _write(comfy / model_cache.FLUX2_COMFY_MAIN_FILE)
        _write(comfy / model_cache.FLUX2_COMFY_TEXT_ENCODER_FILES[0])
        env = {
            "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(comfy),
            "MYSTUDIO_IMAGE_MODEL_DIR": str(self._cache),
        }
        with patch.dict(sys.modules, self._fake_hub_modules()), patch.dict(os.environ, env):
            rc = download_model.download_model(model_cache.FLUX2_KLEIN_MODEL, self._progress)
        self.assertEqual(rc, 0)
        self.assertIn(("ms", model_cache.FLUX2_SMALL_REPO), {(kind, repo) for kind, repo, _ in self._calls})
        payload = json.loads(self._progress.read_text(encoding="utf-8"))
        self.assertEqual(payload["status"], "complete")

    def test_full_mode_insufficient_disk_fails_closed(self) -> None:
        env = self._env(str(self._root / "no-comfy"))
        with (
            patch.dict(sys.modules, self._fake_hub_modules()),
            patch.dict(os.environ, env),
            patch("shutil.disk_usage", return_value=types.SimpleNamespace(free=0)),
        ):
            rc = download_model.download_model(model_cache.QWEN_IMAGE_EDIT_MODEL, self._progress)
        self.assertEqual(rc, 2)
        self.assertEqual(self._calls, [])  # 余量门在下任何字节之前
        payload = json.loads(self._progress.read_text(encoding="utf-8"))
        self.assertEqual(payload["status"], "error")
        self.assertIn("磁盘空间不足", payload["error"])

    def test_full_mode_falls_back_to_hf_when_modelscope_fails(self) -> None:
        def fake_snapshot_download(repo_id: str, allow_patterns=None, cache_dir=None):
            self._calls.append(("hf", repo_id, tuple(allow_patterns or ())))

        def exploding_ms(repo_id: str, cache_dir: str, allow_paths=None):
            if repo_id in (model_cache.QWEN_GGUF_REPO, model_cache.QWEN_TE_REPO):
                raise RuntimeError("modelscope down")
            self._calls.append(("ms", repo_id, tuple(allow_paths or ())))

        modules = {
            "huggingface_hub": types.SimpleNamespace(snapshot_download=fake_snapshot_download),
            "modelscope_hub": types.SimpleNamespace(download_repo_to_hf_cache=exploding_ms),
        }
        with patch.dict(sys.modules, modules), patch.dict(os.environ, self._env(str(self._root / "no-comfy"))):
            rc = download_model.download_model(model_cache.QWEN_IMAGE_EDIT_MODEL, self._progress)
        self.assertEqual(rc, 0)
        repos = {(kind, repo) for kind, repo, _ in self._calls}
        self.assertIn(("hf", model_cache.QWEN_GGUF_REPO), repos)  # ModelScope 挂了走 HF 回退
        self.assertIn(("hf", model_cache.QWEN_TE_REPO), repos)
        payload = json.loads(self._progress.read_text(encoding="utf-8"))
        self.assertEqual(payload["status"], "complete")

    def test_flux2_small_only_when_comfyui_big_files_present(self) -> None:
        comfy = self._root / "comfy-flux2"
        _write(comfy / "diffusion_models" / "flux2_klein_9b.safetensors", size=10)
        _write(comfy / "text_encoders" / "qwen_3_8b.safetensors", size=4)
        _write(comfy / "vae" / "flux2-vae.safetensors", size=4)
        env = {
            "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(comfy),
            "MYSTUDIO_IMAGE_MODEL_DIR": str(self._cache),
        }
        with patch.dict(sys.modules, self._fake_hub_modules()), patch.dict(os.environ, env):
            rc = download_model.download_model(model_cache.FLUX2_KLEIN_MODEL, self._progress)
        self.assertEqual(rc, 0)
        repos = {repo for _, repo, _ in self._calls}
        self.assertEqual(repos, {model_cache.FLUX2_SMALL_REPO})
        payload = json.loads(self._progress.read_text(encoding="utf-8"))
        self.assertEqual(payload["status"], "complete")
        self.assertEqual(payload["total"], 400 * 1024 * 1024)

    def test_flux2_missing_big_files_fails_closed_without_download(self) -> None:
        env = {
            "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(self._root / "no-comfy"),
            "MYSTUDIO_IMAGE_MODEL_DIR": str(self._cache),
        }
        with patch.dict(sys.modules, self._fake_hub_modules()), patch.dict(os.environ, env):
            rc = download_model.download_model(model_cache.FLUX2_KLEIN_MODEL, self._progress)
        self.assertEqual(rc, 2)
        self.assertEqual(self._calls, [])
        payload = json.loads(self._progress.read_text(encoding="utf-8"))
        self.assertEqual(payload["status"], "error")
        self.assertIn("FLUX.2 大件缺失", payload["error"])

    def test_krea2_missing_big_files_fails_closed_without_download(self) -> None:
        env = {
            "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(self._root / "no-comfy"),
            "MYSTUDIO_IMAGE_MODEL_DIR": str(self._cache),
        }
        with patch.dict(sys.modules, self._fake_hub_modules()), patch.dict(os.environ, env):
            rc = download_model.download_model(model_cache.KREA2_MODEL, self._progress)
        self.assertEqual(rc, 2)
        self.assertEqual(self._calls, [])
        payload = json.loads(self._progress.read_text(encoding="utf-8"))
        self.assertEqual(payload["status"], "error")
        self.assertIn("Krea2 大件缺失", payload["error"])
        self.assertIn("Krea2 完整模型", payload["filename"])
        self.assertNotIn("Qwen", payload["filename"])

    def test_krea2_small_only_when_comfyui_big_files_present(self) -> None:
        comfy = self._root / "comfy-krea2"
        _write(comfy / model_cache.KREA2_COMFY_MAIN_FILE, size=10)
        _write(comfy / model_cache.KREA2_COMFY_TEXT_ENCODER_FILE, size=4)
        _write(comfy / model_cache.KREA2_COMFY_VAE_FILE, size=4)
        env = {
            "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(comfy),
            "MYSTUDIO_IMAGE_MODEL_DIR": str(self._cache),
        }
        with patch.dict(sys.modules, self._fake_hub_modules()), patch.dict(os.environ, env):
            rc = download_model.download_model(model_cache.KREA2_MODEL, self._progress)
        self.assertEqual(rc, 0)
        self.assertIn(("ms", model_cache.KREA2_SMALL_REPO), {(kind, repo) for kind, repo, _ in self._calls})
        payload = json.loads(self._progress.read_text(encoding="utf-8"))
        self.assertEqual(payload["status"], "complete")
        self.assertEqual(payload["total"], 400 * 1024 * 1024)
        self.assertIn("Krea2 小件", payload["filename"])
        self.assertEqual(
            self._calls,
            [("ms", model_cache.KREA2_SMALL_REPO, tuple(model_cache.KREA2_SMALL_EXACT_FILES))],
        )


class InventorySourceTests(unittest.TestCase):
    def test_inventory_reports_comfyui_source_and_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            comfy = root / "comfy"
            _write(comfy / "diffusion_models" / "qwen_image_edit_2511_Q8_0.gguf", size=10)
            _write(comfy / "text_encoders" / "qwen_2.5_vl_7b.safetensors", size=4)
            env = {
                "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(comfy),
                "MYSTUDIO_IMAGE_MODEL_DIR": str(root / "cache"),
            }
            with patch.dict(os.environ, env):
                rows = model_inventory.build_model_status()
        row = next(r for r in rows if r["modelName"] == model_cache.QWEN_IMAGE_EDIT_MODEL)
        self.assertTrue(row["downloaded"])
        self.assertEqual(row["bigFilesSource"], "comfyui")
        self.assertEqual(len(row["pointedFiles"]), 2)
        self.assertTrue(row["pointedFiles"][0].endswith("qwen_image_edit_2511_Q8_0.gguf"))

    def test_inventory_reports_missing_when_neither_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            env = {
                "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(root / "a"),
                "MYSTUDIO_IMAGE_MODEL_DIR": str(root / "b"),
            }
            with patch.dict(os.environ, env):
                rows = model_inventory.build_model_status()
        row = next(r for r in rows if r["modelName"] == model_cache.QWEN_IMAGE_EDIT_MODEL)
        self.assertFalse(row["downloaded"])
        self.assertIsNone(row["bigFilesSource"])
        self.assertEqual(row["pointedFiles"], [])

    def test_inventory_reports_appcache_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cache = TwoSourceResolveTests._fake_appcache(root)
            env = {
                "MYSTUDIO_QWEN_COMFYUI_MODELS_DIR": str(root / "no-comfy"),
                "MYSTUDIO_IMAGE_MODEL_DIR": str(cache),
            }
            with patch.dict(os.environ, env):
                rows = model_inventory.build_model_status()
        row = next(r for r in rows if r["modelName"] == model_cache.QWEN_IMAGE_EDIT_MODEL)
        self.assertTrue(row["downloaded"])
        self.assertEqual(row["bigFilesSource"], "app-cache")
        self.assertTrue(row["pointedFiles"][0].endswith("Q8_0.gguf"))
        self.assertTrue(row["pointedFiles"][1].endswith("qwen_2.5_vl_7b.safetensors"))


class ModelScopeAllowPathsTests(unittest.TestCase):
    def test_allow_paths_downloads_only_listed_files(self) -> None:
        import modelscope_hub

        captured: dict[str, object] = {}

        class FakeResponse:
            status_code = 200

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def raise_for_status(self) -> None:
                return None

            def iter_content(self, chunk_size):  # noqa: ARG002
                yield b"z" * 100

        class FakeSession:
            def get(self, url, stream=None, headers=None, timeout=None):  # noqa: ARG002
                captured["url"] = url
                return FakeResponse()

        files = [("README.md", 10), ("big/Q8_0.gguf", 100), ("other/extra.bin", 50)]
        with tempfile.TemporaryDirectory() as temp:
            cache = str(Path(temp))
            with (
                patch.object(modelscope_hub, "list_modelscope_files", return_value=files),
                patch("requests.Session", FakeSession),
            ):
                modelscope_hub.download_repo_to_hf_cache("org/repo", cache, allow_paths=("big/Q8_0.gguf",))
            target = Path(cache) / "models--org--repo" / "snapshots" / "main"
            self.assertEqual((target / "big" / "Q8_0.gguf").read_bytes(), b"z" * 100)
            self.assertFalse((target / "README.md").exists())
            self.assertFalse((target / "other" / "extra.bin").exists())
        self.assertIn("resolve/master/big/Q8_0.gguf", str(captured["url"]))


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
