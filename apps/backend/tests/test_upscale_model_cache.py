from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from upscale import model_cache
from upscale.model_cache import (
    UPSCALE_MODELS,
    delete_cached_model,
    file_sha256,
    find_cached_upscale_model,
    is_upscale_model_downloaded,
    primary_model_dir,
    verify_model_sha256,
)


class UpscaleModelCacheTest(unittest.TestCase):
    def test_env_dir_takes_priority(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with patch.dict("os.environ", {"MYSTUDIO_UPSCALE_MODEL_DIR": temp}):
                self.assertEqual(primary_model_dir(), Path(temp))

    def test_find_and_delete_cached_model(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with patch.dict("os.environ", {"MYSTUDIO_UPSCALE_MODEL_DIR": temp}, clear=False):
                name = "realesrgan-x4plus-anime-6b"
                spec = UPSCALE_MODELS[name]
                target = Path(temp) / spec["file"]
                self.assertIsNone(find_cached_upscale_model(name))
                target.write_bytes(b"0" * (512 * 1024))
                digest = file_sha256(target)
                with patch.dict(model_cache.UPSCALE_MODELS, {name: {**spec, "sha256": digest}}):
                    cached = find_cached_upscale_model(name)
                    self.assertIsNotNone(cached)
                    self.assertEqual(cached["file_path"], str(target))
                    downloaded, size_mb = is_upscale_model_downloaded(name)
                    self.assertTrue(downloaded)
                    self.assertGreater(size_mb, 0)
                    self.assertTrue(delete_cached_model(name))
                    self.assertFalse(target.exists())
                    self.assertIsNone(find_cached_upscale_model(name))

    def test_corrupt_cached_model_is_not_downloaded(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with patch.dict("os.environ", {"MYSTUDIO_UPSCALE_MODEL_DIR": temp}, clear=False):
                name = "realesrgan-x4plus-anime-6b"
                spec = UPSCALE_MODELS[name]
                target = Path(temp) / spec["file"]
                target.write_bytes(b"tampered-model")
                self.assertIsNone(find_cached_upscale_model(name))
                self.assertEqual(is_upscale_model_downloaded(name), (False, None))

    def test_verify_model_sha256_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with patch.dict("os.environ", {"MYSTUDIO_UPSCALE_MODEL_DIR": temp}, clear=False):
                name = "realesr-general-x4v3"
                spec = UPSCALE_MODELS[name]
                target = Path(temp) / spec["file"]
                ok, _ = verify_model_sha256(name)
                self.assertFalse(ok)
                target.write_bytes(b"corrupt")
                ok, _ = verify_model_sha256(name)
                self.assertFalse(ok)
                # Real digest is impractical to fabricate here; use a temp spec
                # with a digest of known bytes instead.
                digest = file_sha256(target)
                with patch.dict(
                    model_cache.UPSCALE_MODELS,
                    {name: {**spec, "sha256": digest}},
                ):
                    ok, path = verify_model_sha256(name)
                    self.assertTrue(ok)
                    self.assertEqual(path, str(target))

    def test_unknown_model_operations_fail_closed(self) -> None:
        self.assertIsNone(find_cached_upscale_model("not-a-model"))
        self.assertEqual(is_upscale_model_downloaded("not-a-model"), (False, None))
        self.assertFalse(delete_cached_model("not-a-model"))


if __name__ == "__main__":
    unittest.main()
