from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from depth_estimation import adapter
from depth_estimation.model_cache import model_weight_sha256, resolve_snapshot_dir


class DepthModelCacheTest(unittest.TestCase):
    def test_weight_sha_uses_refs_main_snapshot_and_sorted_relative_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo_cache = Path(temp) / "models--depth-anything--small"
            snapshot = repo_cache / "snapshots" / "commit-a"
            snapshot.mkdir(parents=True)
            (repo_cache / "refs").mkdir()
            (repo_cache / "refs" / "main").write_text("commit-a\n", encoding="utf-8")
            (snapshot / "z.bin").write_bytes(b"second")
            (snapshot / "a.safetensors").write_bytes(b"first")

            expected = hashlib.sha256()
            expected.update(b"a.safetensors\0first")
            expected.update(b"z.bin\0second")

            self.assertEqual(resolve_snapshot_dir(repo_cache), snapshot)
            self.assertEqual(model_weight_sha256(repo_cache), expected.hexdigest())

    def test_probe_model_returns_weight_sha_without_loading_model(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo_cache = Path(temp) / "models--depth-anything--small"
            snapshot = repo_cache / "snapshots" / "commit-a"
            snapshot.mkdir(parents=True)
            (snapshot / "model.safetensors").write_bytes(b"weights")
            cached = {
                "repo_id": "depth-anything/Depth-Anything-V2-Small-hf",
                "cache_dir": temp,
                "repo_cache_dir": str(repo_cache),
                "size_mb": 1.0,
            }

            with patch.object(adapter, "find_cached_depth_model", return_value=cached):
                payload = adapter.probe_model()

            self.assertEqual(payload["status"], "ready")
            self.assertEqual(payload["weightSha256"], model_weight_sha256(repo_cache))


if __name__ == "__main__":
    unittest.main()
