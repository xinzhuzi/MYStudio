import importlib
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from manying_voicebox_tts.catalog import TTS_MODELS, get_model
import manying_voicebox_tts.main as main_module
import manying_voicebox_tts.engine as engine_module
from manying_voicebox_tts.engine import is_engine_loaded, synthesize_to_wav, unload_engine
from manying_voicebox_tts.model_cache import download_hf_cache_dir, find_cached_model, is_model_downloaded
from manying_voicebox_tts.storage import RuntimeStore
from manying_voicebox_tts.tts import generate_mock_wav


class TtsContractTest(unittest.TestCase):
    def test_sidecar_main_stays_a_thin_entrypoint(self):
        main_source = Path(main_module.__file__).read_text(encoding="utf-8")

        self.assertIn("from .server import Handler, main, run", main_source)
        self.assertNotIn("class Handler", main_source)
        self.assertNotIn("class RuntimeState", main_source)

    def test_sidecar_import_does_not_force_hf_endpoint_for_qwen_mlx(self):
        previous_endpoint = os.environ.pop("HF_ENDPOINT", None)
        try:
            importlib.reload(main_module)
            self.assertIsNone(os.environ.get("HF_ENDPOINT"))
        finally:
            if previous_endpoint is not None:
                os.environ["HF_ENDPOINT"] = previous_endpoint
            else:
                os.environ.pop("HF_ENDPOINT", None)
            importlib.reload(main_module)

    def test_catalog_keeps_voicebox_tts_engines_only(self):
        engines = {model.engine for model in TTS_MODELS if model.purpose != "stt"}

        self.assertEqual(
            engines,
            {
                "qwen",
                "qwen_custom_voice",
                "luxtts",
                "chatterbox",
                "chatterbox_turbo",
                "tada",
                "kokoro",
            },
        )
        stt_engines = {model.engine for model in TTS_MODELS if model.purpose == "stt"}
        self.assertEqual(stt_engines, {"sensevoice", "whisper"})
        self.assertIsNone(get_model("whisper-base"))

    def test_tts_sidecar_requires_control_token_for_stateful_routes(self):
        handler = types.SimpleNamespace(
            headers={},
            send_error_json=MagicMock(),
        )

        self.assertFalse(main_module.Handler.authorize_control(handler))
        handler.send_error_json.assert_called_once()

    def test_tts_sidecar_allows_valid_control_token(self):
        handler = types.SimpleNamespace(
            headers={"X-Manying-TTS-Token": "token-1"},
            send_error_json=MagicMock(),
        )

        with patch.dict("os.environ", {"MANYING_TTS_CONTROL_TOKEN": "token-1"}):
            self.assertTrue(main_module.Handler.authorize_control(handler))
        handler.send_error_json.assert_not_called()

    def test_runtime_store_creates_profiles_and_generations(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RuntimeStore(Path(tmp))
            profile = store.create_profile(
                {
                    "name": "旁白",
                    "voice_type": "reference",
                    "language": "zh",
                    "default_engine": "qwen",
                    "default_model_size": "0.6B",
                    "instruct": "压低声线，语速平缓。",
                }
            )
            generation = store.create_generation(
                profile_id=profile["id"],
                text="雨落在旧街尽头。",
                engine="qwen",
                model_size="0.6B",
            )

            self.assertEqual(store.list_profiles()[0]["name"], "旁白")
            self.assertEqual(store.list_profiles()[0]["instruct"], "压低声线，语速平缓。")
            self.assertEqual(store.get_generation(generation["id"])["status"], "generating")

    def test_model_cache_detects_voicebox_and_hf_cli_downloads(self):
        with tempfile.TemporaryDirectory() as tmp, patch("manying_voicebox_tts.model_cache.hf_cache_dirs", return_value=[Path(tmp)]):
            repo_cache = Path(tmp) / "models--Qwen--Qwen3-TTS-12Hz-1.7B-Base"
            snapshot = repo_cache / "snapshots" / "main"
            snapshot.mkdir(parents=True)
            (repo_cache / "blobs").mkdir()
            (snapshot / "model.safetensors").write_bytes(b"weights")

            downloaded, size_mb = is_model_downloaded(get_model("qwen-tts-1.7B"))
            cached = find_cached_model(get_model("qwen-tts-1.7B"))

            self.assertTrue(downloaded)
            self.assertEqual(size_mb, 0.0)
            self.assertEqual(cached.repo_id, "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
            self.assertEqual(cached.cache_dir, Path(tmp))
            self.assertEqual(cached.repo_cache_dir, repo_cache)

    def test_model_cache_exposes_display_paths_for_frontend(self):
        with tempfile.TemporaryDirectory() as tmp, patch("manying_voicebox_tts.model_cache.hf_cache_dirs", return_value=[Path(tmp)]):
            repo_cache = Path(tmp) / "models--hexgrad--Kokoro-82M"
            snapshot = repo_cache / "snapshots" / "main"
            snapshot.mkdir(parents=True)
            (repo_cache / "blobs").mkdir()
            (snapshot / "model.safetensors").write_bytes(b"weights")

            cached = find_cached_model(get_model("kokoro"))

            self.assertEqual(str(cached.cache_dir), tmp)
            self.assertEqual(str(cached.repo_cache_dir), str(repo_cache))

    def test_model_status_includes_model_paths(self):
        with tempfile.TemporaryDirectory() as tmp, patch("manying_voicebox_tts.model_cache.hf_cache_dirs", return_value=[Path(tmp)]):
            repo_cache = Path(tmp) / "models--hexgrad--Kokoro-82M"
            snapshot = repo_cache / "snapshots" / "main"
            snapshot.mkdir(parents=True)
            (repo_cache / "blobs").mkdir()
            (snapshot / "model.safetensors").write_bytes(b"weights")

            handler = types.SimpleNamespace(state=types.SimpleNamespace(get_progress=lambda _name: None))
            status = main_module.Handler.model_status(handler, get_model("kokoro"))

            self.assertEqual(status["model_cache_dir"], str(Path(tmp)))
            self.assertEqual(status["model_repo_path"], str(repo_cache))

    def test_model_cache_expands_huggingface_root_to_hub_dir(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"MANYING_TTS_MODELS_DIR": str(Path(tmp) / "huggingface")}):
            hf_root = Path(tmp) / "huggingface"
            repo_cache = hf_root / "hub" / "models--mlx-community--Qwen3-TTS-12Hz-0.6B-Base-bf16"
            snapshot = repo_cache / "snapshots" / "main"
            snapshot.mkdir(parents=True)
            (repo_cache / "blobs").mkdir()
            (snapshot / "model.safetensors").write_bytes(b"weights")

            downloaded, _size_mb = is_model_downloaded(get_model("qwen-tts-0.6B"))
            cached = find_cached_model(get_model("qwen-tts-0.6B"))

            self.assertTrue(downloaded)
            self.assertEqual(cached.cache_dir, hf_root / "hub")
            self.assertEqual(cached.repo_cache_dir, repo_cache)

    def test_download_cache_uses_hub_child_for_huggingface_root(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"MANYING_TTS_MODELS_DIR": str(Path(tmp) / "huggingface")}):
            self.assertEqual(download_hf_cache_dir(), Path(tmp) / "huggingface" / "hub")

    def test_model_cache_rejects_incomplete_hf_downloads(self):
        with tempfile.TemporaryDirectory() as tmp, patch("manying_voicebox_tts.model_cache.hf_cache_dirs", return_value=[Path(tmp)]):
            repo_cache = Path(tmp) / "models--hexgrad--Kokoro-82M"
            snapshot = repo_cache / "snapshots" / "main"
            blobs = repo_cache / "blobs"
            snapshot.mkdir(parents=True)
            blobs.mkdir()
            (snapshot / "model.safetensors").write_bytes(b"weights")
            (blobs / "abc.incomplete").write_bytes(b"partial")

            downloaded, size_mb = is_model_downloaded(get_model("kokoro"))

            self.assertFalse(downloaded)
            self.assertIsNone(size_mb)

    def test_mock_generation_writes_valid_wav(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "line.wav"
            generate_mock_wav(output, "这一夜，雨没有停。")

            data = output.read_bytes()
            self.assertTrue(data.startswith(b"RIFF"))
            self.assertIn(b"WAVE", data[:16])
            self.assertGreater(len(data), 1024)

    def test_engine_adapter_reports_mock_metadata_in_mock_mode(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"MANYING_TTS_ENGINE_MODE": "mock"}):
            output = Path(tmp) / "line.wav"
            result = synthesize_to_wav(
                output=output,
                text="这一夜，雨没有停。",
                profile={"id": "profile-1", "preset_voice_id": "zf_xiaobei"},
                engine="qwen",
                model_size="0.6B",
                language="zh",
            )

            self.assertTrue(output.exists())
            self.assertTrue(result.mocked)
            self.assertEqual(result.backend, "mock")
            self.assertGreater(result.duration, 0)

    def test_qwen_adapter_failure_unloads_cached_model_before_mock_fallback(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"MANYING_TTS_ENGINE_MODE": "auto"}):
            output = Path(tmp) / "line.wav"
            ref_audio = Path(tmp) / "ref.wav"
            generate_mock_wav(ref_audio, "参考音频")
            engine_module._qwen_model = object()
            engine_module._qwen_backend = "mlx"
            engine_module._qwen_model_size = "1.7B"

            with patch.object(engine_module, "_generate_qwen", side_effect=RuntimeError("bad cached qwen state")) as generate_qwen:
                result = synthesize_to_wav(
                    output=output,
                    text="这一句用于试听。",
                    profile={
                        "id": "profile-1",
                        "reference_audio_path": str(ref_audio),
                        "reference_text": "参考音频",
                    },
                    engine="qwen",
                    model_size="1.7B",
                    language="zh",
                )

            self.assertTrue(result.mocked)
            self.assertEqual(generate_qwen.call_count, 2)
            self.assertFalse(is_engine_loaded("qwen"))

    def test_qwen_adapter_transient_failure_retries_after_unloading_cache(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"MANYING_TTS_ENGINE_MODE": "auto"}):
            output = Path(tmp) / "line.wav"
            ref_audio = Path(tmp) / "ref.wav"
            generate_mock_wav(ref_audio, "参考音频")
            engine_module._qwen_model = object()
            engine_module._qwen_backend = "mlx"
            engine_module._qwen_model_size = "1.7B"
            loaded_before_attempts: list[bool] = []

            def generate_qwen_once_recovered(output, text, *_args, **_kwargs):
                loaded_before_attempts.append(is_engine_loaded("qwen"))
                if len(loaded_before_attempts) == 1:
                    raise RuntimeError("bad cached qwen state")
                generate_mock_wav(output, text)
                return engine_module.SynthesisResult(duration=0.5, backend="qwen-mlx", mocked=False)

            with patch.object(engine_module, "_generate_qwen", side_effect=generate_qwen_once_recovered):
                result = synthesize_to_wav(
                    output=output,
                    text="这一句用于试听。",
                    profile={
                        "id": "profile-1",
                        "reference_audio_path": str(ref_audio),
                        "reference_text": "参考音频",
                    },
                    engine="qwen",
                    model_size="1.7B",
                    language="zh",
                )

            self.assertFalse(result.mocked)
            self.assertEqual(result.backend, "qwen-mlx")
            self.assertEqual(loaded_before_attempts, [True, False])

    def test_engine_adapter_real_mode_rejects_unimplemented_engines(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"MANYING_TTS_ENGINE_MODE": "real"}):
            output = Path(tmp) / "line.wav"
            with self.assertRaisesRegex(RuntimeError, "No real TTS adapter"):
                synthesize_to_wav(
                    output=output,
                    text="这一夜，雨没有停。",
                    profile={"id": "profile-1"},
                    engine="luxtts",
                    model_size=None,
                    language="zh",
                )

    def test_qwen_real_mode_requires_reference_audio(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"MANYING_TTS_ENGINE_MODE": "real"}):
            output = Path(tmp) / "line.wav"
            with self.assertRaisesRegex(RuntimeError, "Qwen voice cloning requires reference_audio_path"):
                synthesize_to_wav(
                    output=output,
                    text="这一夜，雨没有停。",
                    profile={"id": "profile-1"},
                    engine="qwen",
                    model_size="0.6B",
                    language="zh",
                )

    def test_qwen_custom_voice_generates_with_preset_voice_and_instruction(self):
        fake_model = MagicMock()
        fake_model.generate_custom_voice.return_value = ([[0.0, 0.1, -0.1]], 24000)
        fake_qwen_module = types.SimpleNamespace(
            Qwen3TTSModel=types.SimpleNamespace(from_pretrained=MagicMock(return_value=fake_model))
        )
        fake_torch_module = types.SimpleNamespace(
            float32="float32",
            bfloat16="bfloat16",
            manual_seed=MagicMock(),
            cuda=types.SimpleNamespace(
                is_available=MagicMock(return_value=False),
                manual_seed=MagicMock(),
            ),
        )
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.dict("os.environ", {"MANYING_TTS_ENGINE_MODE": "real"}),
            patch.dict("sys.modules", {"qwen_tts": fake_qwen_module, "torch": fake_torch_module}),
            patch.object(engine_module, "_qwen_custom_voice_model", None, create=True),
            patch.object(engine_module, "_qwen_custom_voice_model_size", None, create=True),
        ):
            output = Path(tmp) / "custom-voice.wav"
            result = synthesize_to_wav(
                output=output,
                text="今夜请留在这里。",
                profile={"preset_voice_id": "Vivian", "instruct": "温柔、缓慢地叙述。"},
                engine="qwen_custom_voice",
                model_size="0.6B",
                language="zh",
            )

            self.assertFalse(result.mocked)
            self.assertEqual(result.backend, "qwen-custom-voice")
            self.assertTrue(output.exists())
            fake_model.generate_custom_voice.assert_called_once_with(
                text="今夜请留在这里。",
                language="Chinese",
                speaker="Vivian",
                instruct="温柔、缓慢地叙述。",
            )

    def test_runtime_store_updates_existing_profile_on_resync(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RuntimeStore(Path(tmp))
            store.create_profile(
                {
                    "id": "profile-1",
                    "name": "旁白",
                    "type": "preset",
                    "language": "zh",
                    "defaultEngine": "qwen_custom_voice",
                    "defaultModelSize": "0.6B",
                    "presetVoiceId": "Vivian",
                }
            )
            updated = store.create_profile(
                {
                    "id": "profile-1",
                    "name": "旁白",
                    "type": "preset",
                    "language": "zh",
                    "defaultEngine": "qwen_custom_voice",
                    "defaultModelSize": "0.6B",
                    "presetVoiceId": "Serena",
                    "instruct": "压低声线。",
                }
            )

            self.assertEqual(updated["preset_voice_id"], "Serena")
            self.assertEqual(updated["instruct"], "压低声线。")

    def test_engine_loaded_and_unload_are_safe_for_unloaded_engines(self):
        self.assertFalse(is_engine_loaded("kokoro"))
        self.assertFalse(unload_engine("kokoro"))

    def test_long_mock_narration_is_generated_in_chunks(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict("os.environ", {"MANYING_TTS_ENGINE_MODE": "mock"}):
            output = Path(tmp) / "long-line.wav"
            result = synthesize_to_wav(
                output=output,
                text="雨落长街，灯火微明。" * 40,
                profile={"id": "profile-1"},
                engine="qwen",
                model_size="0.6B",
                language="zh",
                max_chunk_chars=50,
                crossfade_ms=0,
            )

            self.assertGreater(result.duration, 12.0)
            self.assertTrue(output.read_bytes().startswith(b"RIFF"))


if __name__ == "__main__":
    unittest.main()
