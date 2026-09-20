"""HTTP contract tests for the local image-generation sidecar."""

from __future__ import annotations

import signal
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


class _ComfyHandler(_GenerateHandler):
    def _authorized(self) -> bool:
        return True


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
    def test_bridge_actions_forward_explicit_origin(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        with patch("engines.comfyui.bridge_actions.submit", return_value={"id": 1}) as submit:
            handler._comfy("POST", "/comfy/bridge/actions", {
                "kind": "generate-images", "note": "test", "originProjectId": "project-a", "originEpisodeId": "episode-1",
            }, {})
        submit.assert_called_once_with("generate-images", "test", origin_project_id="project-a", origin_episode_id="episode-1")

    def test_bridge_actions_missing_origin_is_rejected_by_real_submit(self) -> None:
        from engines.comfyui import bridge_actions
        handler = _ComfyHandler.__new__(_ComfyHandler)
        bridge_actions.reset_for_tests()
        handler._comfy("POST", "/comfy/bridge/actions", {"kind": "generate-images"}, {})
        self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
        self.assertEqual(bridge_actions.list_since(0)["items"], [])

    def test_bridge_actions_missing_episode_is_rejected_by_real_submit(self) -> None:
        from engines.comfyui import bridge_actions
        handler = _ComfyHandler.__new__(_ComfyHandler)
        bridge_actions.reset_for_tests()
        handler._comfy("POST", "/comfy/bridge/actions", {
            "kind": "generate-images", "originProjectId": "project-a",
        }, {})
        self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
        self.assertEqual(bridge_actions.list_since(0)["items"], [])

    def test_action_ack_route_preserves_restarted_and_foreign_actions(self) -> None:
        from engines.comfyui import bridge_actions
        handler = _ComfyHandler.__new__(_ComfyHandler)
        bridge_actions.reset_for_tests()
        bridge_actions.submit("generate-images", origin_project_id="project-a", origin_episode_id="episode-1")
        old_queue = bridge_actions.list_since(0)["queueId"]
        bridge_actions.reset_for_tests()
        foreign = bridge_actions.submit("generate-images", origin_project_id="project-a", origin_episode_id="episode-1")
        selected = bridge_actions.submit("generate-images", origin_project_id="project-b", origin_episode_id="episode-1")
        queue = bridge_actions.list_since(0)["queueId"]
        handler._comfy("POST", "/comfy/bridge/actions/ack", {"queueId": old_queue, "ids": [foreign["id"]]}, {})
        self.assertEqual(handler.response[0], {"deleted": 0, "ackMode": "exact"})
        handler._comfy("POST", "/comfy/bridge/actions/ack", {"queueId": queue, "ids": [selected["id"]]}, {})
        self.assertEqual(handler.response[0], {"deleted": 1, "ackMode": "exact"})
        self.assertEqual([item["id"] for item in bridge_actions.list_since(0)["items"]], [foreign["id"]])
        bridge_actions.reset_for_tests()

    def test_bridge_exact_ack_routes_forward_only_selected_ids(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        with patch("engines.comfyui.bridge_inbox.ack", return_value=1) as ack:
            handler._comfy("POST", "/comfy/bridge/writebacks/ack", {"ids": [3], "upTo": 99}, {})
        ack.assert_called_once_with(ids=[3])
        self.assertEqual(handler.response, ({"deleted": 1, "ackMode": "exact"}, HTTPStatus.OK))
        with patch("engines.comfyui.bridge_actions.ack", return_value=1) as ack:
            handler._comfy("POST", "/comfy/bridge/actions/ack", {"queueId": "epoch", "ids": [3], "upTo": 99}, {})
        ack.assert_called_once_with(queue_id="epoch", ids=[3])
        self.assertEqual(handler.response, ({"deleted": 1, "ackMode": "exact"}, HTTPStatus.OK))

    def test_bridge_ack_routes_reject_missing_or_invalid_ids_without_deletion(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        for queue in ("writebacks", "actions"):
            module = "bridge_inbox" if queue == "writebacks" else "bridge_actions"
            for payload in ({"upTo": 99}, {"ids": None}, {"ids": [True]}, {"ids": [1, "2"]}):
                with self.subTest(queue=queue, payload=payload), patch(f"engines.comfyui.{module}.ack") as ack:
                    handler._comfy("POST", f"/comfy/bridge/{queue}/ack", payload, {})
                self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
                ack.assert_not_called()

    def test_bridge_accepts_video_writeback_shape(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        payload = {
            "shotTarget": "sb-chapter-001-001",
            "videoB64": "bXA0",
            "meta": {
                "kind": "video",
                "subfolder": "video/漫影/chapter-001/sb-chapter-001-001",
                "policy": "ambient",
            },
        }
        with patch("engines.comfyui.bridge_inbox.append", return_value=9) as append:
            handler._comfy("POST", "/comfy/bridge/writeback", payload, {})

        append.assert_called_once()
        self.assertEqual(append.call_args.args[2], "videoB64")
        self.assertEqual(handler.response, ({"accepted": True, "id": 9}, HTTPStatus.OK))

    def test_bridge_rejects_mixed_or_unscoped_video_payload(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        with patch("engines.comfyui.bridge_inbox.append") as append:
            handler._comfy(
                "POST",
                "/comfy/bridge/writeback",
                {"imageB64": "png", "videoB64": "mp4"},
                {},
            )
        self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
        append.assert_not_called()

        for subfolder in ("video/漫影_S01", "video/ComfyUI/chapter-001/sb-1"):
            with self.subTest(subfolder=subfolder), patch("engines.comfyui.bridge_inbox.append") as append:
                handler._comfy(
                    "POST",
                    "/comfy/bridge/writeback",
                    {
                        "videoB64": "mp4",
                        "meta": {"kind": "video", "subfolder": subfolder, "policy": "ambient"},
                    },
                    {},
                )
            self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
            append.assert_not_called()

        with patch("engines.comfyui.bridge_inbox.append") as append:
            handler._comfy(
                "POST",
                "/comfy/bridge/writeback",
                {"videoB64": "mp4", "meta": {"kind": "video", "policy": "ambient"}},
                {},
            )
        self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
        append.assert_not_called()

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
            "engines.image_engine.comfyui_bridge.resolve_big_files",
            return_value={"source": "comfyui-service", "cache_dir": "http://127.0.0.1:17598"},
        ), patch(
            "engines.image_engine.comfyui_bridge.small_pieces_status",
            return_value={"ready": True, "missing": [], "snapshot_dirs": {}},
        ):
            handler._handle_download({"model": "comfyui-bridge"})

        self.assertEqual(handler.response[1], HTTPStatus.OK)
        self.assertIn("无需下载", handler.response[0]["message"])


class ShutdownSequenceTests(unittest.TestCase):
    """退出收摊顺序契约(09-14 生命周期审计 P3):放端口 → 停引擎 → 释放锁。"""

    class _FakeServer:
        def __init__(self, calls: list) -> None:
            self._calls = calls

        def shutdown(self) -> None:
            self._calls.append("shutdown")

        def server_close(self) -> None:
            self._calls.append("server_close")

    class _FakeManager:
        def __init__(self, calls: list, fail: bool = False) -> None:
            self._calls = calls
            self._fail = fail

        def stop(self) -> dict:
            self._calls.append("engine_stop")
            if self._fail:
                raise RuntimeError("boom")
            return {"running": False, "stopped": True}

    def test_shutdown_releases_port_then_stops_engine_then_releases_lock(self) -> None:
        calls: list = []
        manager = self._FakeManager(calls)

        def fake_release() -> None:
            calls.append("release_lock")

        with patch("engines.comfyui.engine_manager.engine_manager", return_value=manager), \
                patch("engines.comfyui.engine_manager.release_engine_lock", fake_release):
            events = server._shutdown_sequence(self._FakeServer(calls), log=lambda *_: None)

        self.assertEqual(events, ["port-released", "engine-stopped"])
        self.assertEqual(calls, ["shutdown", "server_close", "engine_stop", "release_lock"])

    def test_shutdown_survives_engine_stop_failure(self) -> None:
        """停引擎抛错:不弃守后续步(锁释放),进程仍能干净退出。"""
        calls: list = []
        logged: list = []
        manager = self._FakeManager(calls, fail=True)

        def fake_release() -> None:
            calls.append("release_lock")

        with patch("engines.comfyui.engine_manager.engine_manager", return_value=manager), \
                patch("engines.comfyui.engine_manager.release_engine_lock", fake_release):
            events = server._shutdown_sequence(self._FakeServer(calls), log=logged.append)

        self.assertEqual(events, ["port-released"])
        self.assertEqual(calls, ["shutdown", "server_close", "engine_stop", "release_lock"])
        self.assertTrue(any("停引擎失败" in line for line in logged))

    def test_shutdown_signals_cover_term_int_and_hup(self) -> None:
        sigs = server._shutdown_signals()
        self.assertIn(signal.SIGTERM, sigs)
        self.assertIn(signal.SIGINT, sigs)
        if hasattr(signal, "SIGHUP"):
            self.assertIn(signal.SIGHUP, sigs)


class CancelRouteTests(unittest.TestCase):
    """服务端真取消路由(09-02):置位 pipeline 取消事件并应答 ok。"""

    def test_cancel_route_sets_event_and_responds(self) -> None:
        handler = _StatusHandler.__new__(_StatusHandler)
        handler.path = "/v1/images/cancel"
        payload_holder = {}

        class _Reader:
            def __call__(self):
                payload_holder["called"] = True
                return {}

        handler._read_json = _Reader()
        from image_gen import pipeline
        pipeline._CANCEL_EVENT.clear()
        try:
            with patch("image_gen.pipeline.cancel_generation") as cancel_mock:
                handler.do_POST()
            cancel_mock.assert_called_once_with()
            self.assertEqual(
                handler.response,
                ({"ok": True, "cancelled": True}, HTTPStatus.OK),
            )
        finally:
            pipeline._CANCEL_EVENT.clear()


if __name__ == "__main__":
    unittest.main()
