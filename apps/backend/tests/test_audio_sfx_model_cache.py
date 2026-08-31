from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_gen.model_cache import find_cached_audio_model
from sfx_gen.model_cache import find_cached_sfx_model


def make_snapshot(root: Path, *, complete: bool, auxiliary_only: bool = False) -> None:
    snapshot = root / "models--facebook--musicgen-small" / "snapshots" / "main"
    snapshot.mkdir(parents=True)
    if complete:
        (snapshot / "config.json").write_text("{}", encoding="utf-8")
        (snapshot / "preprocessor_config.json").write_text("{}", encoding="utf-8")
        (snapshot / "model.safetensors").write_bytes(b"weights")
    if auxiliary_only:
        (snapshot / "compression_state_dict.bin").write_bytes(b"auxiliary")


class AudioSfxModelCacheTests(unittest.TestCase):
    def test_auxiliary_file_is_not_a_runnable_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_snapshot(root, complete=False, auxiliary_only=True)
            with patch.dict("os.environ", {"MYSTUDIO_AUDIO_MODEL_DIR": str(root)}, clear=False):
                self.assertIsNone(find_cached_audio_model(("facebook/musicgen-small",)))
                self.assertIsNone(find_cached_sfx_model(("facebook/musicgen-small",)))

    def test_config_and_model_weight_are_required_for_both_routes(self):
        with tempfile.TemporaryDirectory() as audio_tmp, tempfile.TemporaryDirectory() as sfx_tmp:
            audio_root = Path(audio_tmp)
            sfx_root = Path(sfx_tmp)
            make_snapshot(audio_root, complete=True)
            make_snapshot(sfx_root, complete=True)
            with patch.dict(
                "os.environ",
                {
                    "MYSTUDIO_AUDIO_MODEL_DIR": str(audio_root),
                    "MYSTUDIO_SFX_MODEL_DIR": str(sfx_root),
                },
                clear=False,
            ):
                self.assertIsNotNone(find_cached_audio_model(("facebook/musicgen-small",)))
                self.assertIsNotNone(find_cached_sfx_model(("facebook/musicgen-small",)))

    def test_sfx_route_does_not_consume_audio_cache_env(self):
        with tempfile.TemporaryDirectory() as audio_tmp, tempfile.TemporaryDirectory() as sfx_tmp:
            audio_root = Path(audio_tmp)
            sfx_root = Path(sfx_tmp)
            make_snapshot(audio_root, complete=True)
            with patch.dict(
                "os.environ",
                {
                    "MYSTUDIO_AUDIO_MODEL_DIR": str(audio_root),
                    "MYSTUDIO_SFX_MODEL_DIR": str(sfx_root),
                    "HF_HUB_CACHE": str(sfx_root / "unused-hf"),
                },
                clear=False,
            ):
                self.assertIsNone(find_cached_sfx_model(("facebook/musicgen-small",)))

    def test_audio_route_does_not_consume_tts_cache_env(self):
        with tempfile.TemporaryDirectory() as tts_tmp:
            tts_root = Path(tts_tmp)
            make_snapshot(tts_root, complete=True)
            with patch.dict(
                "os.environ",
                {
                    "MANYING_TTS_MODELS_DIR": str(tts_root),
                    "VOICEBOX_MODELS_DIR": str(tts_root),
                },
                clear=True,
            ):
                self.assertIsNone(find_cached_audio_model(("facebook/musicgen-small",)))

    def test_sfx_route_uses_its_dedicated_cache_env(self):
        with tempfile.TemporaryDirectory() as audio_tmp, tempfile.TemporaryDirectory() as sfx_tmp:
            audio_root = Path(audio_tmp)
            sfx_root = Path(sfx_tmp)
            make_snapshot(audio_root, complete=True)
            make_snapshot(sfx_root, complete=True)
            with patch.dict(
                "os.environ",
                {
                    "MYSTUDIO_AUDIO_MODEL_DIR": str(audio_root),
                    "MYSTUDIO_SFX_MODEL_DIR": str(sfx_root),
                },
                clear=False,
            ):
                cached = find_cached_sfx_model(("facebook/musicgen-small",))
            self.assertIsNotNone(cached)
            self.assertEqual(Path(cached["cache_dir"]), sfx_root)


if __name__ == "__main__":
    unittest.main()
