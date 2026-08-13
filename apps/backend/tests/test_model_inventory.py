from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tts.model_inventory import scan_model_inventory


def create_repo(cache_dir: Path, repo_id: str, *, weight: bool = True, incomplete: bool = False) -> Path:
    repo_dir = cache_dir / ("models--" + repo_id.replace("/", "--"))
    snapshot = repo_dir / "snapshots" / "main"
    blobs = repo_dir / "blobs"
    snapshot.mkdir(parents=True)
    blobs.mkdir()
    if weight:
        (snapshot / "model.safetensors").write_bytes(b"weights")
    if incomplete:
        (blobs / "partial.incomplete").write_bytes(b"partial")
    return repo_dir


class ModelInventoryTests(unittest.TestCase):
    def test_scans_complete_alias_exact_and_missing_models_without_global_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            base_repo = create_repo(cache_dir, "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
            custom_repo = create_repo(cache_dir, "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")

            with patch.dict("os.environ", {"MANYING_TTS_MODELS_DIR": str(cache_dir)}, clear=False):
                models = {item["model_name"]: item for item in scan_model_inventory()["models"]}

            self.assertTrue(models["qwen-tts-1.7B"]["downloaded"])
            self.assertEqual(models["qwen-tts-1.7B"]["model_repo_path"], str(base_repo))
            self.assertTrue(models["qwen-custom-voice-1.7B"]["downloaded"])
            self.assertEqual(models["qwen-custom-voice-1.7B"]["model_repo_path"], str(custom_repo))
            self.assertFalse(models["qwen-tts-0.6B"]["downloaded"])
            self.assertFalse(models["qwen-tts-1.7B"]["downloading"])
            self.assertFalse(models["qwen-tts-1.7B"]["loaded"])

    def test_rejects_incomplete_weightless_and_missing_snapshot_repositories(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            create_repo(cache_dir, "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16", incomplete=True)
            create_repo(cache_dir, "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", weight=False)
            missing_snapshot = cache_dir / "models--Qwen--Qwen3-TTS-12Hz-0.6B-CustomVoice"
            (missing_snapshot / "blobs").mkdir(parents=True)

            with patch.dict("os.environ", {"MANYING_TTS_MODELS_DIR": str(cache_dir)}, clear=False):
                models = {item["model_name"]: item for item in scan_model_inventory()["models"]}

            self.assertFalse(models["qwen-tts-1.7B"]["downloaded"])
            self.assertFalse(models["qwen-custom-voice-1.7B"]["downloaded"])
            self.assertFalse(models["qwen-custom-voice-0.6B"]["downloaded"])

    def test_requires_alignment_tokenizer_for_whisper_large(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_dir = Path(tmp)
            create_repo(cache_dir, "mlx-community/whisper-large-v3-turbo")

            with patch.dict("os.environ", {"MANYING_TTS_MODELS_DIR": str(cache_dir)}, clear=False):
                before = {item["model_name"]: item for item in scan_model_inventory()["models"]}
                tokenizer = create_repo(cache_dir, "openai/whisper-large-v3-turbo", weight=False)
                (tokenizer / "snapshots" / "main" / "tokenizer.json").write_text("{}", encoding="utf-8")
                after = {item["model_name"]: item for item in scan_model_inventory()["models"]}

            self.assertFalse(before["whisper-large-v3-turbo"]["downloaded"])
            self.assertTrue(after["whisper-large-v3-turbo"]["downloaded"])


if __name__ == "__main__":
    unittest.main()
