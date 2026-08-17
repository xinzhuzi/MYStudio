from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from upscale import worker
from upscale.model_cache import DEFAULT_UPSCALE_MODEL, UPSCALE_MODELS


class UpscaleWorkerTest(unittest.TestCase):
    @staticmethod
    def _worker_env(model_dir: str | None = None) -> dict[str, str]:
        env = {**os.environ, "PYTHONPATH": "backend"}
        if model_dir:
            env["MYSTUDIO_UPSCALE_MODEL_DIR"] = model_dir
        return env

    def test_version_is_structured(self) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "upscale.worker", "--version"],
            text=True,
            capture_output=True,
            env=self._worker_env(),
            check=False,
        )
        payload = json.loads(result.stdout)
        self.assertEqual(payload["toolVersion"], worker.TOOL_VERSION)
        self.assertIn("python", payload)

    def test_probe_is_structured_and_does_not_download(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            # Empty model dir: probe must report blocked model-not-downloaded
            # instead of downloading anything.
            result = subprocess.run(
                [sys.executable, "-m", "upscale.worker", "--probe"],
                text=True,
                capture_output=True,
                env=self._worker_env(model_dir=temp),
                check=False,
            )
            payload = json.loads(result.stdout)
            self.assertIn(payload["status"], {"ready", "blocked"})
            self.assertIn("toolVersion", payload)
            self.assertIn("python", payload)
            if payload["status"] == "blocked":
                self.assertIn(payload["model"]["code"], {"model-not-downloaded", "torch-missing", "pillow-missing"})

    def test_run_without_args_exits_two(self) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "upscale.worker", "--run"],
            text=True,
            capture_output=True,
            env=self._worker_env(),
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["code"], "missing-args")

    def test_malformed_request_persists_blocked_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = root / "request.json"
            artifact = root / "artifact.json"
            request.write_text("{", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-m", "upscale.worker", "--run", "--input", str(request), "--output", str(artifact)],
                text=True,
                capture_output=True,
                env=self._worker_env(),
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            payload = json.loads(artifact.read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "blocked")
            self.assertEqual(payload["code"], "input-read-failed")
            self.assertEqual(payload["toolVersion"], worker.TOOL_VERSION)
            self.assertEqual(payload["inputSha256"], "0" * 64)
            self.assertEqual(payload["outputSha256"], "0" * 64)

    def test_missing_paths_persists_blocked_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = root / "request.json"
            artifact = root / "artifact.json"
            request.write_text(json.dumps({"schemaVersion": 1, "projectId": "p", "shotId": "s"}), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-m", "upscale.worker", "--run", "--input", str(request), "--output", str(artifact)],
                text=True,
                capture_output=True,
                env=self._worker_env(),
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            payload = json.loads(artifact.read_text(encoding="utf-8"))
            self.assertEqual(payload["code"], "missing-paths")

    def test_missing_input_image_persists_blocked_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = root / "request.json"
            artifact = root / "artifact.json"
            payload = {
                "schemaVersion": 1,
                "projectId": "p",
                "shotId": "s",
                "model": DEFAULT_UPSCALE_MODEL,
                "inputImagePath": str(root / "missing.png"),
                "outputImagePath": str(root / "out.png"),
            }
            request.write_text(json.dumps(payload), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-m", "upscale.worker", "--run", "--input", str(request), "--output", str(artifact)],
                text=True,
                capture_output=True,
                env=self._worker_env(model_dir=temp),
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            body = json.loads(artifact.read_text(encoding="utf-8"))
            self.assertEqual(body["status"], "blocked")
            self.assertEqual(body["code"], "input-not-found")

    def test_unknown_model_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "in.png"
            from PIL import Image

            Image.new("RGB", (8, 8)).save(source)
            request = root / "request.json"
            artifact = root / "artifact.json"
            payload = {
                "schemaVersion": 1,
                "projectId": "p",
                "shotId": "s",
                "model": "not-a-model",
                "inputImagePath": str(source),
                "outputImagePath": str(root / "out.png"),
            }
            request.write_text(json.dumps(payload), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-m", "upscale.worker", "--run", "--input", str(request), "--output", str(artifact)],
                text=True,
                capture_output=True,
                env=self._worker_env(model_dir=temp),
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            body = json.loads(artifact.read_text(encoding="utf-8"))
            self.assertEqual(body["code"], "unknown-model")

    def test_output_quality_failure_persists_blocked_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = root / "request.json"
            artifact = root / "artifact.json"
            request.write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "projectId": "p",
                    "shotId": "s",
                    "model": DEFAULT_UPSCALE_MODEL,
                    "inputImagePath": str(root / "in.png"),
                    "outputImagePath": str(root / "out.png"),
                }),
                encoding="utf-8",
            )
            with patch.object(
                worker,
                "upscale_image",
                side_effect=worker.UpscaleError("output-quality-failed", "近黑输出"),
            ):
                payload = worker._run(str(request), str(artifact))
            self.assertEqual(payload["status"], "blocked")
            self.assertEqual(payload["code"], "output-quality-failed")


class UpscaleModelRegistryTest(unittest.TestCase):
    def test_registry_contains_expected_models(self) -> None:
        expected = {
            "realesrgan-x4plus-anime-6b",
            "realesrgan-x4plus",
            "realesrgan-x2plus",
            "realesr-animevideov3",
            "realesr-general-x4v3",
        }
        self.assertEqual(set(UPSCALE_MODELS.keys()), expected)
        self.assertEqual(DEFAULT_UPSCALE_MODEL, "realesrgan-x4plus-anime-6b")

    def test_specs_have_pinned_hex_sha256(self) -> None:
        for name, spec in UPSCALE_MODELS.items():
            self.assertEqual(len(spec["sha256"]), 64, name)
            int(spec["sha256"], 16)
            self.assertTrue(spec["url"].startswith("https://"), name)
            self.assertGreater(spec["size_mb"], 0, name)
            self.assertIn(spec["arch"]["kind"], {"rrdbnet", "srvgg"}, name)


if __name__ == "__main__":
    unittest.main()
