from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from image_gen import adapter, pipeline, worker


class ImageGenWorkerTest(unittest.TestCase):
    @staticmethod
    def _request(root: Path) -> dict[str, object]:
        media_root = root / "media"
        return {
            "schemaVersion": 1,
            "projectId": "p",
            "shotId": "s",
            "model": "sdxl-turbo",
            "prompt": "x",
            "mediaRoot": str(media_root),
            "outputPath": str(media_root / "image.png"),
            "width": 1920,
            "height": 1080,
        }

    @staticmethod
    def _worker_env() -> dict[str, str]:
        return {
            **os.environ,
            "PYTHONPATH": "backend",
            "MYSTUDIO_IMAGE_GENERATION_FROZEN": "0",
        }

    def test_probe_is_structured_and_does_not_require_model_download(self) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "image_gen.worker", "--probe"],
            text=True,
            capture_output=True,
            env=self._worker_env(),
            check=False,
        )
        payload = json.loads(result.stdout)
        self.assertIn(payload["status"], {"ready", "blocked"})
        self.assertIn("toolVersion", payload)

    def test_frozen_run_persists_blocked_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = root / "request.json"
            artifact = root / "artifact.json"
            payload = {**self._request(root), "frozen": True}
            request.write_text(json.dumps(payload), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-m", "image_gen.worker", "--run", "--input", str(request), "--output", str(artifact)],
                text=True,
                capture_output=True,
                env=self._worker_env(),
                check=False,
            )
            payload = json.loads(artifact.read_text(encoding="utf-8"))
            self.assertEqual(result.returncode, 2)
            self.assertEqual(payload["code"], "image-generation-frozen")
            self.assertEqual(payload["toolVersion"], worker.TOOL_VERSION)
            self.assertEqual(payload["mediaRef"]["path"], "")

    def test_malformed_json_persists_complete_blocked_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = root / "request.json"
            artifact = root / "artifact.json"
            request.write_text("{", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-m", "image_gen.worker", "--run", "--input", str(request), "--output", str(artifact)],
                text=True,
                capture_output=True,
                env=self._worker_env(),
                check=False,
            )
            payload = json.loads(artifact.read_text(encoding="utf-8"))
            self.assertEqual(result.returncode, 2)
            self.assertEqual(payload["status"], "blocked")
            self.assertEqual(payload["code"], "input-read-failed")
            self.assertEqual(payload["backend"], "diffusers")
            self.assertEqual(payload["upscaleBackend"], "none")
            self.assertEqual(len(payload["requestFingerprint"]), 64)

    def test_request_rejects_unknown_fields_and_schema_versions(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            request = self._request(Path(temp))
            with self.assertRaisesRegex(adapter.ImageGenerationError, "未知字段"):
                adapter.validate_request({**request, "unexpected": True})
            with self.assertRaisesRegex(adapter.ImageGenerationError, "schemaVersion=1"):
                adapter.validate_request({**request, "schemaVersion": 2})
            without_schema = dict(request)
            without_schema.pop("schemaVersion")
            with self.assertRaisesRegex(adapter.ImageGenerationError, "schemaVersion=1"):
                adapter.validate_request(without_schema)

    def test_request_rejects_output_outside_media_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            request = {**self._request(root), "outputPath": str(root / "outside.png")}
            with self.assertRaises(adapter.ImageGenerationError) as context:
                adapter.validate_request(request)
            self.assertEqual(context.exception.code, "invalid-output-path")

    def test_request_rejects_symlink_escape_from_media_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            media_root = root / "media"
            outside = root / "outside"
            media_root.mkdir()
            outside.mkdir()
            (media_root / "link").symlink_to(outside, target_is_directory=True)
            request = {
                **self._request(root),
                "outputPath": str(media_root / "link" / "escaped.png"),
            }
            with self.assertRaises(adapter.ImageGenerationError) as context:
                adapter.validate_request(request)
            self.assertEqual(context.exception.code, "invalid-output-path")

    def test_request_rejects_non_fixed_dimensions(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            request = {**self._request(Path(temp)), "width": 1024}
            with self.assertRaises(adapter.ImageGenerationError) as context:
                adapter.validate_request(request)
            self.assertEqual(context.exception.code, "invalid-dimensions")

    def test_probe_reports_missing_dependencies_after_cache_probe(self) -> None:
        cached = {"repo_id": "stabilityai/sdxl-turbo", "size_mb": 1}
        with patch.object(adapter, "find_cached_image_model", return_value=cached), patch.object(
            adapter, "_missing_dependencies", return_value=["diffusers"]
        ):
            payload = adapter.probe_model()
        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["code"], "dependencies-missing")
        self.assertEqual(payload["dependencies"], ["diffusers"])
        self.assertFalse(payload["capabilities"]["controlNet"])
        self.assertFalse(payload["capabilities"]["ipAdapter"])
        self.assertFalse(payload["capabilities"]["realEsrgan"])

    def test_reference_request_fails_closed_until_capability_is_wired(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            request = {
                **self._request(Path(temp)),
                "referenceImages": [{"path": "/tmp/reference.png", "role": "character"}],
            }
            with self.assertRaises(adapter.ImageGenerationError) as context:
                adapter.generate_artifact(request)
            self.assertEqual(context.exception.code, "capability-unavailable")

    def test_success_artifact_has_fixed_dimensions_sha_and_media_ref(self) -> None:
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("pillow is not installed")

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.png"
            Image.new("RGB", (16, 9), "white").save(source, format="PNG")
            source_b64 = base64.b64encode(source.read_bytes()).decode("ascii")
            ready = {
                "status": "ready",
                "modelRevision": "test-revision",
                "backend": "diffusers",
            }
            with patch.object(adapter, "probe_model", return_value=ready), patch.object(
                adapter, "generate_image", return_value=source_b64
            ):
                payload = adapter.generate_artifact(self._request(root))

            output = Path(str(payload["outputPath"]))
            with Image.open(output) as image:
                self.assertEqual(image.size, (1920, 1080))
            self.assertEqual(payload["status"], "accepted")
            self.assertEqual(payload["outputSha256"], payload["mediaRef"]["contentSha256"])
            self.assertEqual(payload["mediaRef"]["path"], str(output))

    def test_img2img_pipeline_does_not_reenter_pipeline_lock(self) -> None:
        created = object()

        class FakeImagePipeline:
            @staticmethod
            def from_pipe(value: object) -> object:
                self.assertIs(value, created)
                return object()

        def locked_pipeline(_model_name: str) -> object:
            with pipeline._lock:
                return created

        result: list[object] = []
        fake_diffusers = types.SimpleNamespace(AutoPipelineForImage2Image=FakeImagePipeline)
        with patch.object(pipeline, "_require_downloaded"), patch.object(
            pipeline, "_get_pipeline", side_effect=locked_pipeline
        ), patch.dict(sys.modules, {"diffusers": fake_diffusers}):
            pipeline._img2img_pipelines.clear()
            thread = threading.Thread(
                target=lambda: result.append(pipeline._get_img2img_pipeline("sdxl-turbo")),
                daemon=True,
            )
            thread.start()
            thread.join(timeout=1)

        self.assertFalse(thread.is_alive(), "img2img pipeline initialization deadlocked")
        self.assertEqual(len(result), 1)
