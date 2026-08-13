from __future__ import annotations

import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tts.model_routes import ModelRoutesMixin


class _ProgressState:
    def __init__(self) -> None:
        self.updates: list[tuple[str, dict[str, object]]] = []

    def set_progress(self, model_name: str, **updates: object) -> None:
        self.updates.append((model_name, updates))


class ModelRoutesTests(unittest.TestCase):
    def test_download_whisper_also_downloads_alignment_tokenizer(self):
        state = _ProgressState()
        handler = types.SimpleNamespace(state=state)
        downloads: list[dict[str, object]] = []

        def snapshot_download(**kwargs: object) -> None:
            downloads.append(kwargs)

        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            sys.modules,
            {"huggingface_hub": types.SimpleNamespace(snapshot_download=snapshot_download)},
        ), patch("tts.model_routes.download_hf_cache_dir", return_value=Path(tmp)):
            ModelRoutesMixin.download_model(handler, "whisper-large-v3-turbo")

        self.assertEqual(
            [download["repo_id"] for download in downloads],
            ["mlx-community/whisper-large-v3-turbo", "openai/whisper-large-v3-turbo"],
        )
        self.assertEqual(state.updates[-1][1]["status"], "complete")

    def test_delete_model_uses_resolved_cached_repository(self):
        handler = types.SimpleNamespace(send_json=MagicMock(), send_error_json=MagicMock())
        cached_path = Path("/isolated/cache/models--Qwen--Qwen3-TTS-12Hz-1.7B-Base")

        with patch(
            "tts.model_routes.find_cached_model",
            return_value=types.SimpleNamespace(repo_cache_dir=cached_path),
        ), patch.object(Path, "exists", return_value=True), patch("tts.model_routes.shutil.rmtree") as remove:
            ModelRoutesMixin.delete_model_cache(handler, "qwen-tts-1.7B")

        remove.assert_called_once_with(cached_path)
        handler.send_error_json.assert_not_called()
        handler.send_json.assert_called_once_with({"message": "Model qwen-tts-1.7B deleted successfully"})


if __name__ == "__main__":
    unittest.main()
