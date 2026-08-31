from __future__ import annotations

import contextlib
import io
import json
import runpy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from music3_gen.model_cache import find_cached_music3_model
from music3_gen.worker import Music3GenError, _require_downloaded, main


REPO_IDS = ("PocketAiHub/MiniMax-Music3-MLX",)
FLAT_WEIGHTS = (
    "language_model.safetensors",
    "rvq_depth_decoder.safetensors",
    "transformer.safetensors",
    "condition_encoder.safetensors",
    "vocoder.safetensors",
)


def make_flat(root: Path) -> Path:
    model = root / "minimax" / "music3-mlxserv-bf16"
    model.mkdir(parents=True)
    (model / "config.json").write_text('{"model_type":"minimax_music3"}', encoding="utf-8")
    for name in FLAT_WEIGHTS:
        (model / name).write_bytes(b"weights")
    for name in ("tokenizer", "music_tokenizer"):
        (model / name).mkdir()
    return model


def make_snapshot(root: Path) -> Path:
    snapshot = root / "models--PocketAiHub--MiniMax-Music3-MLX" / "snapshots" / "rev"
    snapshot.mkdir(parents=True)
    for name in ("generate.py", "minimax_mlx_model.py", "model_manifest.json"):
        (snapshot / name).write_text("{}", encoding="utf-8")
    (snapshot / "diffusion_models").mkdir()
    (snapshot / "diffusion_models" / "weights.safetensors").write_bytes(b"weights")
    return snapshot


class Music3ModelCacheTests(unittest.TestCase):
    def test_converter_model_card_matches_installer_route(self):
        converter = Path(__file__).parents[1] / "music3_gen" / "vendor" / "convert_music3_weights.py"
        namespace = runpy.run_path(str(converter), run_name="music3-converter-test")
        readme = namespace["README"]
        self.assertIn("(bf16)", readme)
        self.assertIn("approximately 28.5 GB", readme)
        self.assertIn("127.0.0.1:11273", readme)
        self.assertIn("MiniMax-Music3-MLX-Serve-bf16", readme)
        self.assertNotIn("13 GB on disk", readme)
        self.assertNotIn("127.0.0.1:11234", readme)

    def test_flat_mlxserve_layout_is_found_and_returns_runnable_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model = make_flat(root)
            with patch.dict("os.environ", {"MYSTUDIO_MUSIC3_MODEL_DIR": str(root)}, clear=False):
                cached = find_cached_music3_model(REPO_IDS)
            self.assertIsNotNone(cached)
            self.assertEqual(cached["layout"], "mlxserv")
            self.assertEqual(Path(cached["repo_cache_dir"]), model)

    def test_flat_incomplete_marker_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model = make_flat(root)
            (model / "vocoder.safetensors.incomplete").write_bytes(b"partial")
            with patch.dict("os.environ", {"MYSTUDIO_MUSIC3_MODEL_DIR": str(root)}, clear=False):
                self.assertIsNone(find_cached_music3_model(REPO_IDS))

    def test_huggingface_snapshot_remains_supported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_snapshot(root)
            with patch.dict("os.environ", {"MYSTUDIO_MUSIC3_MODEL_DIR": str(root)}, clear=False):
                cached = find_cached_music3_model(REPO_IDS)
            self.assertIsNotNone(cached)
            self.assertEqual(cached["layout"], "pocket")

    def test_huggingface_snapshot_incomplete_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshot = make_snapshot(root)
            (snapshot / "weights.safetensors.incomplete").write_bytes(b"partial")
            with patch.dict("os.environ", {"MYSTUDIO_MUSIC3_MODEL_DIR": str(root)}, clear=False):
                self.assertIsNone(find_cached_music3_model(REPO_IDS))

    def test_worker_rejects_mlxserve_layout_for_pocket_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_flat(root)
            with patch.dict("os.environ", {"MYSTUDIO_MUSIC3_MODEL_DIR": str(root)}, clear=False):
                with self.assertRaises(Music3GenError) as raised:
                    _require_downloaded("minimax-music3-mlx")
            self.assertEqual(raised.exception.code, "mlxserv-only")

    def test_probe_reports_flat_route_without_claiming_python_worker_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model = make_flat(root)
            output = io.StringIO()
            with patch.dict("os.environ", {"MYSTUDIO_MUSIC3_MODEL_DIR": str(root)}, clear=False):
                with patch.object(sys, "argv", ["music3-worker", "--probe"]):
                    with contextlib.redirect_stdout(output):
                        main()
            payload = json.loads(output.getvalue())
            self.assertEqual(payload["status"], "blocked")
            self.assertEqual(payload["layout"], "mlxserv")
            self.assertEqual(payload["engine"], "mlx-serve")
            self.assertEqual(Path(payload["modelDir"]), model)
            self.assertFalse(payload["workerRunnable"])
            self.assertIn("Electron mlx-serve HTTP", payload["reason"])


if __name__ == "__main__":
    unittest.main()
