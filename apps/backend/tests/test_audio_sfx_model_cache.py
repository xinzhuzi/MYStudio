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
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_snapshot(root, complete=True)
            with patch.dict("os.environ", {"MYSTUDIO_AUDIO_MODEL_DIR": str(root)}, clear=False):
                self.assertIsNotNone(find_cached_audio_model(("facebook/musicgen-small",)))
                self.assertIsNotNone(find_cached_sfx_model(("facebook/musicgen-small",)))


if __name__ == "__main__":
    unittest.main()
