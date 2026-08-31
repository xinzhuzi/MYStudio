"""HTTP contract tests for the local image-generation sidecar."""

from __future__ import annotations

import unittest
from http import HTTPStatus
from unittest.mock import patch

from image_gen import server


class _StatusHandler(server.Handler):
    def _authorized(self) -> bool:
        return True

    def _send_json(self, payload, status: int = HTTPStatus.OK) -> None:
        self.response = (payload, status)

    def _send_error_json(self, status: int, message: str, code: str = "error") -> None:
        self.response = ({"error": {"message": message, "code": code}}, status)


class _GenerateHandler(server.Handler):
    def _send_json(self, payload, status: int = HTTPStatus.OK) -> None:
        self.response = (payload, status)

    def _send_error_json(self, status: int, message: str, code: str = "error") -> None:
        self.response = ({"error": {"message": message, "code": code}}, status)


class ImageStatusRouteTests(unittest.TestCase):
    def test_models_status_delegates_to_shared_three_engine_inventory(self) -> None:
        rows = [
            {
                "modelName": "qwen-image-edit-2511",
                "bigFilesSource": "comfyui",
                "pointedFiles": ["/models/qwen.gguf", "/models/qwen-te.safetensors"],
                "smallPiecesReady": True,
            },
            {
                "modelName": "flux2-klein-9b",
                "bigFilesSource": "comfyui",
                "pointedFiles": ["/models/flux2.safetensors", "/models/qwen3.safetensors"],
                "smallPiecesReady": True,
            },
            {
                "modelName": "z-image-turbo",
                "bigFilesSource": None,
                "pointedFiles": [],
                "smallPiecesReady": False,
            },
        ]
        handler = _StatusHandler.__new__(_StatusHandler)
        handler.path = "/models/status"

        with patch("image_gen.model_inventory.build_model_status", return_value=rows) as build_status:
            handler.do_GET()

        build_status.assert_called_once_with()
        self.assertEqual(handler.response, ({"models": rows}, HTTPStatus.OK))


class ImageGenerateRouteTests(unittest.TestCase):
    def test_use_lora_payload_is_forwarded_to_pipeline(self) -> None:
        handler = _GenerateHandler.__new__(_GenerateHandler)
        with patch("image_gen.server.generate_image", return_value="ZmFrZQ==") as generate:
            handler._handle_generate({"model": "krea2-turbo", "prompt": "水墨山水", "use_lora": True})

        generate.assert_called_once()
        self.assertIs(generate.call_args.kwargs["use_lora"], True)
        self.assertEqual(handler.response[1], HTTPStatus.OK)

    def test_use_lora_defaults_to_false(self) -> None:
        handler = _GenerateHandler.__new__(_GenerateHandler)
        with patch("image_gen.server.generate_image", return_value="ZmFrZQ==") as generate:
            handler._handle_generate({"model": "krea2-turbo", "prompt": "水墨山水"})

        self.assertIs(generate.call_args.kwargs["use_lora"], False)

    def test_reference_urls_are_forwarded_in_order_with_four_image_cap(self) -> None:
        handler = _GenerateHandler.__new__(_GenerateHandler)
        refs = [f"data:image/png;base64,cmVm{index}" for index in range(5)]
        refs.append("https://example.invalid/ignored.png")
        with patch("image_gen.server.generate_image", return_value="ZmFrZQ==") as generate:
            handler._handle_generate({"model": "comfyui-bridge", "prompt": "编辑", "image_urls": refs})

        kwargs = generate.call_args.kwargs
        self.assertEqual(kwargs["reference_image_b64"], refs[0])
        self.assertEqual(kwargs["reference_images_b64"], refs[:4])

    def test_bridge_error_codes_map_to_service_unavailable_and_gateway_timeout(self) -> None:
        handler = _GenerateHandler.__new__(_GenerateHandler)
        for code, expected in (("bridge-unreachable", HTTPStatus.SERVICE_UNAVAILABLE), ("bridge-timeout", HTTPStatus.GATEWAY_TIMEOUT)):
            with self.subTest(code=code), patch(
                "image_gen.server.generate_image",
                side_effect=server.PipelineError(code, "bridge error"),
            ):
                handler._handle_generate({"model": "comfyui-bridge", "prompt": "编辑"})
            self.assertEqual(handler.response[1], expected)
            self.assertEqual(handler.response[0]["error"]["code"], code)

    def test_bridge_download_is_a_noop_when_service_and_templates_are_ready(self) -> None:
        handler = _GenerateHandler.__new__(_GenerateHandler)
        with patch("image_gen.server.comfyui_models_dir", return_value=None), patch(
            "image_gen.engines.comfyui_bridge.resolve_big_files",
            return_value={"source": "comfyui-service", "cache_dir": "http://127.0.0.1:8000"},
        ), patch(
            "image_gen.engines.comfyui_bridge.small_pieces_status",
            return_value={"ready": True, "missing": [], "snapshot_dirs": {}},
        ):
            handler._handle_download({"model": "comfyui-bridge"})

        self.assertEqual(handler.response[1], HTTPStatus.OK)
        self.assertIn("无需下载", handler.response[0]["message"])


if __name__ == "__main__":
    unittest.main()
