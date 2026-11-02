"""HTTP contract tests for the local image-generation sidecar."""

from __future__ import annotations

import signal
import unittest
from io import BytesIO
from email.message import Message
from http import HTTPStatus
from unittest.mock import Mock, patch

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


class BridgeOriginBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        # 0924 令牌随机化:令牌经 MANYING_LOCAL_IMAGE_TOKEN env 注入(装机
        # 由 electron main 生成 UUID);fail-closed 语义见下方专项测试。
        self._env = patch.dict("os.environ", {"MANYING_LOCAL_IMAGE_TOKEN": "token-1"})
        self._env.start()
        self.addCleanup(self._env.stop)

    def handler(self, origin: str | None) -> _GenerateHandler:
        handler = _GenerateHandler.__new__(_GenerateHandler)
        handler.headers = Message()
        handler.headers["Authorization"] = f"Bearer {server.local_token()}"
        if origin is not None:
            handler.headers["Origin"] = origin
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        return handler

    def test_missing_token_env_fails_closed_for_every_authed_route(self) -> None:
        # 令牌未注入(手工终端起服/异常环境):Bearer/自定义头一律拒,
        # 公开仓库里不存在任何可用令牌字面量
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(server.local_token(), "")
            handler = self.handler(None)
            self.assertFalse(handler._authorized())
            handler.headers["X-Manying-Image-Token"] = "manying-local-image"
            self.assertFalse(handler._authorized())
            handler.headers.replace_header("Authorization", "Bearer manying-local-image")
            self.assertFalse(handler._authorized())

    def test_native_file_renderer_and_local_http_origins_remain_supported(self) -> None:
        for origin in (None, "null", "http://localhost:5173", "http://127.0.0.1:17001", "http://[::1]:5173"):
            with self.subTest(origin=origin):
                handler = self.handler(origin)
                self.assertTrue(handler._authorized())
                handler.do_OPTIONS()
                handler.send_response.assert_called_once_with(HTTPStatus.NO_CONTENT)
                if origin is not None:
                    handler.send_header.assert_any_call("Access-Control-Allow-Origin", origin)
                handler.headers.replace_header("Authorization", "Bearer invalid")
                self.assertFalse(handler._authorized())

    def test_remote_or_malformed_origin_cannot_reach_bridge_even_with_known_token(self) -> None:
        origins = (
            "https://attacker.invalid", "http://localhost.attacker.invalid:5173",
            "http://127.0.0.1.attacker.invalid", "http://attacker.invalid@127.0.0.1:17001",
            "http://127.0.0.1:17001/path", "http://127.0.0.1:0", "http://127.0.0.1:65536",
            "http://127.0.0.1:abc", "http://127.0.0.1:17001?query", "null null", "",
            "http://127.0.0.1:" + "9" * 5000,
        )
        for origin in origins:
            with self.subTest(origin=origin):
                handler = self.handler(origin)
                self.assertFalse(handler._authorized())
                self.assertIsNone(handler._cors_origin())
                handler.path = "/comfy/bridge/actions"
                handler._read_json = Mock(return_value={"kind": "generate-images"})
                handler._comfy = Mock()
                handler.do_POST()
                self.assertEqual(handler.response[1], HTTPStatus.FORBIDDEN)
                handler._read_json.assert_not_called()
                handler._comfy.assert_not_called()
                handler.do_OPTIONS()
                self.assertEqual(handler.response[1], HTTPStatus.FORBIDDEN)
                handler.send_header.assert_not_called()

    def test_json_response_does_not_echo_rejected_origin(self) -> None:
        for origin in ("https://attacker.invalid", "null", "http://127.0.0.1:17001", None):
            with self.subTest(origin=origin):
                handler = self.handler(origin)
                handler.wfile = BytesIO()
                server.Handler._send_json(handler, {"ok": True})
                allowed = [call.args[1] for call in handler.send_header.call_args_list if call.args[0] == "Access-Control-Allow-Origin"]
                self.assertEqual(allowed, [] if origin in (None, "https://attacker.invalid") else [origin])
                handler.send_header.assert_any_call("Vary", "Origin")


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

        # 11-02 S4 起本路由先判远端 sidecar 代理;钉死「未配远端」保本机路径
        # 密封(机器级 remote-engine.json 真值不得渗入契约测)。
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=None,
        ), patch("image_gen.model_inventory.build_model_status", return_value=rows) as build_status:
            handler.do_GET()

        build_status.assert_called_once_with()
        self.assertEqual(handler.response, ({"models": rows}, HTTPStatus.OK))


class ImageGenerateRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        # 1021 出图提示音:不打桩会在 pytest 里真 afplay 放声
        self._chime = patch("image_gen.server.play_generation_success_chime")
        self._chime.start()
        self.addCleanup(self._chime.stop)

    def test_bridge_actions_forward_explicit_origin(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        with patch("comfyui.bridge_actions.submit", return_value={"id": 1}) as submit:
            handler._comfy("POST", "/comfy/bridge/actions", {
                "kind": "generate-images", "note": "test", "originProjectId": "project-a", "originEpisodeId": "episode-1",
            }, {})
        submit.assert_called_once_with("generate-images", "test", origin_project_id="project-a", origin_episode_id="episode-1")

    def test_bridge_actions_missing_origin_is_rejected_by_real_submit(self) -> None:
        from comfyui import bridge_actions
        handler = _ComfyHandler.__new__(_ComfyHandler)
        bridge_actions.reset_for_tests()
        handler._comfy("POST", "/comfy/bridge/actions", {"kind": "generate-images"}, {})
        self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
        self.assertEqual(bridge_actions.list_since(0)["items"], [])

    def test_bridge_actions_missing_episode_is_rejected_by_real_submit(self) -> None:
        from comfyui import bridge_actions
        handler = _ComfyHandler.__new__(_ComfyHandler)
        bridge_actions.reset_for_tests()
        handler._comfy("POST", "/comfy/bridge/actions", {
            "kind": "generate-images", "originProjectId": "project-a",
        }, {})
        self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
        self.assertEqual(bridge_actions.list_since(0)["items"], [])

    def test_action_ack_route_preserves_restarted_and_foreign_actions(self) -> None:
        from comfyui import bridge_actions
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
        with patch("comfyui.bridge_inbox.ack", return_value=1) as ack:
            handler._comfy("POST", "/comfy/bridge/writebacks/ack", {"ids": [3], "upTo": 99}, {})
        ack.assert_called_once_with(ids=[3])
        self.assertEqual(handler.response, ({"deleted": 1, "ackMode": "exact"}, HTTPStatus.OK))
        with patch("comfyui.bridge_actions.ack", return_value=1) as ack:
            handler._comfy("POST", "/comfy/bridge/actions/ack", {"queueId": "epoch", "ids": [3], "upTo": 99}, {})
        ack.assert_called_once_with(queue_id="epoch", ids=[3])
        self.assertEqual(handler.response, ({"deleted": 1, "ackMode": "exact"}, HTTPStatus.OK))

    def test_bridge_ack_routes_reject_missing_or_invalid_ids_without_deletion(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        for queue in ("writebacks", "actions"):
            module = "bridge_inbox" if queue == "writebacks" else "bridge_actions"
            for payload in ({"upTo": 99}, {"ids": None}, {"ids": [True]}, {"ids": [1, "2"]}, {"ids": [2 ** 53]}):
                with self.subTest(queue=queue, payload=payload), patch(f"comfyui.{module}.ack") as ack:
                    handler._comfy("POST", f"/comfy/bridge/{queue}/ack", payload, {})
                self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
                ack.assert_not_called()

    def test_bridge_rejects_poison_writebacks_before_publication(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        valid = {"imageB64": "aGk=", "meta": {"originProjectId": "project-a"}}
        invalid_fields = [
            {"shotTarget": ["S01"]}, {"prompt": {"text": "test"}},
            {"client": ["my-nodes"]}, {"meta": "not-an-object"},
            {"ts": "../../target"}, {"ts": True}, {"ts": -1}, {"ts": 2 ** 53},
            {"imageB64": "not base64!"}, {"imageB64": "aGk"},
        ]
        for fields in invalid_fields:
            with self.subTest(fields=fields), patch("comfyui.bridge_inbox.append") as append:
                handler._comfy("POST", "/comfy/bridge/writeback", {**valid, **fields}, {})
                self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
                append.assert_not_called()

    def test_bridge_rejects_unconsumable_video_metadata_before_publication(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        meta = {
            "kind": "video", "originProjectId": "project-a", "policy": "ambient",
            "subfolder": "video/漫影/chapter-001/sb-chapter-001-001",
        }
        for change in ({"policy": "坏档"}, {"subfolder": "video/漫影/chapter/shot?invalid"}):
            with self.subTest(change=change), patch("comfyui.bridge_inbox.append") as append:
                handler._comfy("POST", "/comfy/bridge/writeback", {
                    "videoB64": "bXA0", "shotTarget": "sb-chapter-001-001", "meta": {**meta, **change},
                }, {})
                self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
                append.assert_not_called()

    def test_bridge_image_legacy_optional_fields_stay_compatible(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        with patch("comfyui.bridge_inbox.append", return_value=7) as append:
            handler._comfy("POST", "/comfy/bridge/writeback", {"imageB64": "aGk="}, {})
        self.assertEqual(handler.response, ({"accepted": True, "id": 7}, HTTPStatus.OK))
        self.assertEqual(append.call_args.args[0]["meta"], {})

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
        with patch("comfyui.bridge_inbox.append", return_value=9) as append:
            handler._comfy("POST", "/comfy/bridge/writeback", payload, {})

        append.assert_called_once()
        self.assertEqual(append.call_args.args[2], "videoB64")
        self.assertEqual(handler.response, ({"accepted": True, "id": 9}, HTTPStatus.OK))

    def test_bridge_rejects_mixed_or_unscoped_video_payload(self) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        with patch("comfyui.bridge_inbox.append") as append:
            handler._comfy(
                "POST",
                "/comfy/bridge/writeback",
                {"imageB64": "png", "videoB64": "mp4"},
                {},
            )
        self.assertEqual(handler.response[1], HTTPStatus.BAD_REQUEST)
        append.assert_not_called()

        for subfolder in ("video/漫影_S01", "video/ComfyUI/chapter-001/sb-1"):
            with self.subTest(subfolder=subfolder), patch("comfyui.bridge_inbox.append") as append:
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

        with patch("comfyui.bridge_inbox.append") as append:
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

    def test_blank_output_and_degraded_codes_map_to_502_and_503(self) -> None:
        # blank-gate-1024 测试 D:空片判废→502、引擎退化→503(贴 bridge 家族映射样式)
        handler = _GenerateHandler.__new__(_GenerateHandler)
        for code, expected in (("bridge-blank-output", HTTPStatus.BAD_GATEWAY), ("engine-degraded", HTTPStatus.SERVICE_UNAVAILABLE)):
            with self.subTest(code=code), patch(
                "image_gen.server.generate_image",
                side_effect=server.PipelineError(code, "门禁文案"),
            ):
                handler._handle_generate({"model": "comfyui-bridge", "prompt": "编辑"})
            self.assertEqual(handler.response[1], expected)
            self.assertEqual(handler.response[0]["error"]["code"], code)
            self.assertEqual(handler.response[0]["error"]["message"], "门禁文案")

    def test_explicit_bridge_cancellation_keeps_existing_http_200_contract(self) -> None:
        handler = _GenerateHandler.__new__(_GenerateHandler)
        with patch("image_gen.server.generate_image", side_effect=server.PipelineError("generation-cancelled", "已停止")):
            handler._handle_generate({"model": "comfyui-bridge", "prompt": "生成中止"})
        self.assertEqual(handler.response, ({"error": {"message": "已停止", "code": "generation-cancelled"}}, HTTPStatus.OK))

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


class ComfyJobCancelRouteTests(unittest.TestCase):
    """POST /comfy/jobs/{id}/cancel(10-27 H3 双通道硬取消 Q2,PRD §14.2.2):
    四态降级,取消永不 5xx——停止是清理性操作,失败只降级不报红。"""

    def _cancel(self, job_id: str):
        handler = _ComfyHandler.__new__(_ComfyHandler)
        handler._comfy("POST", f"/comfy/jobs/{job_id}/cancel", {}, {})
        return handler.response

    def test_unknown_job_returns_404_job_not_found(self):
        self.assertEqual(self._cancel("no-such-job")[1], HTTPStatus.NOT_FOUND)
        self.assertEqual(self._cancel("no-such-job")[0]["error"]["code"], "job-not-found")

    def test_terminal_job_degrades_to_cancelled_false_terminal(self):
        from comfyui.engine_manager import jobs

        for terminal in ("complete", "error"):
            with self.subTest(terminal=terminal), patch("comfyui.execute.forward_engine_job_cancel") as forward:
                job_id = jobs.create("comfy-execute")
                if terminal == "complete":
                    jobs.update(job_id, result={"promptId": "p-1"})
                else:
                    jobs.update(job_id, error="ComfyUI 执行失败")
                self.assertEqual(
                    self._cancel(job_id),
                    ({"cancelled": False, "reason": "terminal"}, HTTPStatus.OK),
                )
                forward.assert_not_called()

    def test_running_job_without_prompt_id_degrades_to_not_submitted(self):
        from comfyui.engine_manager import jobs

        job_id = jobs.create("comfy-execute")  # running + result=None(上传段未提交引擎)
        with patch("comfyui.execute.forward_engine_job_cancel") as forward:
            self.assertEqual(
                self._cancel(job_id),
                ({"cancelled": False, "reason": "not-submitted"}, HTTPStatus.OK),
            )
            forward.assert_not_called()

    def test_running_job_with_prompt_id_forwards_and_passes_cancelled_through(self):
        from comfyui.engine_manager import jobs

        job_id = jobs.create("comfy-execute")
        # 提交段已过:result 带 promptId 且 job 仍 running(complete=False,JobRegistry 实读形状)
        jobs.update(job_id, result={"promptId": "p-run", "nodeErrors": {}, "warnings": []}, complete=False)
        with patch("comfyui.execute.forward_engine_job_cancel", return_value={"cancelled": True}) as forward:
            self.assertEqual(
                self._cancel(job_id),
                ({"cancelled": True, "reason": "forwarded"}, HTTPStatus.OK),
            )
            forward.assert_called_once_with("p-run")

    def test_forward_failure_degrades_to_200_engine_unreachable_never_5xx(self):
        from comfyui.engine_manager import EngineOpError, jobs

        job_id = jobs.create("comfy-execute")
        jobs.update(job_id, result={"promptId": "p-down"}, complete=False)
        with patch("comfyui.execute.forward_engine_job_cancel", side_effect=EngineOpError("引擎没在运行")) as forward:
            self.assertEqual(
                self._cancel(job_id),
                ({"cancelled": False, "reason": "engine-unreachable"}, HTTPStatus.OK),
            )
            forward.assert_called_once_with("p-down")


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

        with patch("comfyui.engine_manager.engine_manager", return_value=manager), \
                patch("comfyui.engine_manager.release_engine_lock", fake_release):
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

        with patch("comfyui.engine_manager.engine_manager", return_value=manager), \
                patch("comfyui.engine_manager.release_engine_lock", fake_release):
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


class EngineProbeRouteTests(unittest.TestCase):
    """GET /comfy/engine/probe(11-02「测试连接」:sidecar 服务端代理探引擎,绕渲染层
    CSP connect-src 不放行 http+局域网 IP 的限制)。"""

    def _probe(self, query: dict) -> None:
        handler = _ComfyHandler.__new__(_ComfyHandler)
        handler._comfy("GET", "/comfy/engine/probe", {}, query)
        return handler  # type: ignore[return-value]

    def test_default_probes_effective_engine_and_reports_version_device(self) -> None:
        import json as _json

        class _Resp:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return _json.dumps({
                    "system": {"comfyui_version": "0.42.0"},
                    "devices": [{"name": "cuda:0 NVIDIA RTX PRO 4000 Blackwell : cudaMallocAsync"}],
                }).encode()

        with patch("comfyui.engine_manager.engine_manager") as em, patch(
            "urllib.request.urlopen", return_value=_Resp()
        ) as urlopen:
            em.return_value.remote_engine_status.return_value = {
                "url": "http://192.168.0.101:17000",
                "effective": "http://192.168.0.101:17000",
                "source": "settings",
            }
            handler = self._probe({})
        urlopen.assert_called_once_with("http://192.168.0.101:17000/system_stats", timeout=10)
        payload, status = handler.response
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["comfyui_version"], "0.42.0")
        self.assertEqual(payload["device"], "NVIDIA RTX PRO 4000 Blackwell")

    def test_explicit_url_param_wins_over_effective(self) -> None:
        import json as _json

        class _Resp:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return _json.dumps({"comfyui_version": "0.42.0", "devices": []}).encode()

        with patch("comfyui.engine_manager.engine_manager") as em, patch(
            "urllib.request.urlopen", return_value=_Resp()
        ) as urlopen:
            em.return_value.remote_engine_status.return_value = {"effective": "http://127.0.0.1:17000", "source": "managed"}
            handler = self._probe({"url": ["http://192.168.0.101:17000/"]})
        urlopen.assert_called_once_with("http://192.168.0.101:17000/system_stats", timeout=10)
        self.assertEqual(handler.response[0]["url"], "http://192.168.0.101:17000/")
        self.assertTrue(handler.response[0]["ok"])

    def test_bad_scheme_is_rejected_without_probe(self) -> None:
        with patch("urllib.request.urlopen") as urlopen:
            handler = self._probe({"url": ["ftp://192.168.0.101:17000"]})
        urlopen.assert_not_called()
        payload, _ = handler.response
        self.assertFalse(payload["ok"])
        self.assertIn("http(s)", payload["error"])

    def test_engine_unreachable_reports_ok_false_with_error(self) -> None:
        from urllib import error as urllib_error

        with patch("comfyui.engine_manager.engine_manager") as em, patch(
            "urllib.request.urlopen", side_effect=urllib_error.URLError("Connection refused")
        ):
            em.return_value.remote_engine_status.return_value = {"effective": "http://192.168.0.101:17000", "source": "settings"}
            handler = self._probe({})
        payload, status = handler.response
        self.assertEqual(status, HTTPStatus.OK)
        self.assertFalse(payload["ok"])
        self.assertIn("Connection refused", payload["error"])


class RemoteSidecarProxyRouteTests(unittest.TestCase):
    """远端 sidecar 代理契约(11-02 S4;C4 修正:远端引擎≠远端 sidecar——代理
    目标=远端引擎 URL 的主机名+固定 sidecar 端口 17595,引擎端口不作数):
    GET /comfy/workflows(H3)与 GET /models/status(H4)远端生效时转发远端
    sidecar 并透传应答;未配远端=本机行为零迁移;远端断=诚实错
    (remote-sidecar-unreachable),绝不静默回落本机库/本机 inventory。
    11-02 S4 复核修:①代理须携带凭据(远端 sidecar 非 /health 全令牌闸且装机
    令牌双机各异——MANYING_REMOTE_IMAGE_TOKEN 优先,缺省转发入站凭据);
    ②远端 401/403=鉴权失败诚实分报(remote-sidecar-auth),不得被 URLError
    兜底误诊成「未运行或不可达」。"""

    REMOTE_ENGINE = "http://192.168.0.101:17000"
    REMOTE_SIDECAR = "http://192.168.0.101:17595"

    class _Resp:
        def __init__(self, payload: dict) -> None:
            import json as _json

            self._body = _json.dumps(payload, ensure_ascii=False).encode()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return self._body

    def _workflows(self, query: dict | None = None, headers: dict | None = None):
        handler = _ComfyHandler.__new__(_ComfyHandler)
        handler.headers = Message()
        for key, value in (headers or {}).items():
            handler.headers[key] = value
        handler._comfy("GET", "/comfy/workflows", {}, query or {})
        return handler

    def _models_status(self, headers: dict | None = None):
        handler = _StatusHandler.__new__(_StatusHandler)
        handler.headers = Message()
        for key, value in (headers or {}).items():
            handler.headers[key] = value
        handler.path = "/models/status"
        handler.do_GET()
        return handler

    @staticmethod
    def _proxied_request(urlopen):
        """断言面:代理恒以 (urllib Request, timeout=10) 单次调用 urlopen。"""
        urlopen.assert_called_once()
        args, kwargs = urlopen.call_args
        assert kwargs == {"timeout": 10}
        return args[0]

    @staticmethod
    def _request_headers(request) -> dict:
        """Request 自定义头小写化快照(urllib 存储键名经 capitalize,比小写键稳)。"""
        return {key.lower(): value for key, value in request.header_items()}

    def test_sidecar_base_takes_remote_host_with_fixed_sidecar_port(self) -> None:
        # C4 核心契约:主机名跟远端引擎走,端口恒 sidecar 17595(≠引擎 17000)
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ):
            self.assertEqual(server._remote_sidecar_base_url(), self.REMOTE_SIDECAR)
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=None,
        ):
            self.assertIsNone(server._remote_sidecar_base_url())

    def test_remote_workflows_forwards_to_remote_sidecar_and_passes_reply_through(self) -> None:
        from urllib.parse import urlencode

        reply = {"workflows": [{"id": "1_图片/krea2-daojie-t2i.json", "nodeCount": 12}]}
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch.dict("os.environ", {server.REMOTE_TOKEN_ENV: ""}), patch(
            "urllib.request.urlopen", return_value=self._Resp(reply)
        ) as urlopen, patch("comfyui.plugin_manager.list_workflows") as list_local:
            handler = self._workflows({"prefix": ["1_图片"], "light": ["1"]})
        expected_query = urlencode({"prefix": ["1_图片"], "light": ["1"]}, doseq=True)
        request = self._proxied_request(urlopen)
        self.assertEqual(
            request.full_url, f"{self.REMOTE_SIDECAR}/comfy/workflows?{expected_query}"
        )
        # 远端令牌未配+入站无凭据=裸请求(403 由远端诚实分报,见专项用例)
        self.assertEqual(self._request_headers(request), {})
        list_local.assert_not_called()  # 远端生效=列表以引擎侧库为准,不读本机库
        self.assertEqual(handler.response, (reply, HTTPStatus.OK))

    def test_local_workflows_unchanged_without_remote_engine(self) -> None:
        reply = {"workflows": [{"id": "1_图片/krea2-daojie-t2i.json"}]}
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=None,
        ), patch("urllib.request.urlopen") as urlopen, patch(
            "comfyui.plugin_manager.list_workflows", return_value=reply
        ) as list_local:
            handler = self._workflows({"prefix": ["1_图片"], "light": ["1"]})
        urlopen.assert_not_called()
        list_local.assert_called_once_with(prefix="1_图片", light=True)
        self.assertEqual(handler.response, (reply, HTTPStatus.OK))

    def test_remote_workflows_unreachable_reports_honest_error_without_local_fallback(self) -> None:
        from urllib import error as urllib_error

        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch(
            "urllib.request.urlopen", side_effect=urllib_error.URLError("Connection refused")
        ) as urlopen, patch("comfyui.plugin_manager.list_workflows") as list_local:
            handler = self._workflows({})
        request = self._proxied_request(urlopen)
        self.assertEqual(request.full_url, f"{self.REMOTE_SIDECAR}/comfy/workflows")
        list_local.assert_not_called()  # 不静默回落本机
        payload, status = handler.response
        self.assertEqual(status, HTTPStatus.BAD_GATEWAY)
        self.assertEqual(payload["error"]["code"], "remote-sidecar-unreachable")
        self.assertIn("远端引擎管理服务未运行", payload["error"]["message"])

    def test_remote_models_status_forwards_to_remote_sidecar(self) -> None:
        reply = {"models": [{"modelName": "qwen-image-edit-2511", "bigFilesSource": "comfyui"}]}
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch("urllib.request.urlopen", return_value=self._Resp(reply)) as urlopen, patch(
            "image_gen.model_inventory.build_model_status"
        ) as build_local:
            handler = self._models_status()
        request = self._proxied_request(urlopen)
        self.assertEqual(request.full_url, f"{self.REMOTE_SIDECAR}/models/status")
        build_local.assert_not_called()  # 库存以引擎侧实况为准
        self.assertEqual(handler.response, (reply, HTTPStatus.OK))

    def test_local_models_status_unchanged_without_remote_engine(self) -> None:
        rows = [
            {
                "modelName": "qwen-image-edit-2511",
                "bigFilesSource": "comfyui",
                "pointedFiles": [],
                "smallPiecesReady": True,
            }
        ]
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=None,
        ), patch("urllib.request.urlopen") as urlopen, patch(
            "image_gen.model_inventory.build_model_status", return_value=rows
        ) as build_local:
            handler = self._models_status()
        urlopen.assert_not_called()
        build_local.assert_called_once_with()
        self.assertEqual(handler.response, ({"models": rows}, HTTPStatus.OK))

    def test_remote_models_status_unreachable_reports_honest_error(self) -> None:
        from urllib import error as urllib_error

        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch(
            "urllib.request.urlopen", side_effect=urllib_error.URLError("timed out")
        ), patch("image_gen.model_inventory.build_model_status") as build_local:
            handler = self._models_status()
        build_local.assert_not_called()  # 不静默回落本机 inventory
        payload, status = handler.response
        self.assertEqual(status, HTTPStatus.BAD_GATEWAY)
        self.assertEqual(payload["error"]["code"], "remote-sidecar-unreachable")
        self.assertIn("远端引擎管理服务未运行", payload["error"]["message"])

    # ── 11-02 S4 复核修:凭据携带与 403 诚实分报 ──────────────────────

    def test_remote_proxy_carries_remote_token_env_credential(self) -> None:
        # 装机令牌双机各异:转发入站(本机)令牌对远端必 403——远端令牌经
        # MANYING_REMOTE_IMAGE_TOKEN 配到 Mac(electron spawn env 透传),优先携带
        reply = {"workflows": []}
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch.dict("os.environ", {server.REMOTE_TOKEN_ENV: "win-side-token"}), patch(
            "urllib.request.urlopen", return_value=self._Resp(reply)
        ) as urlopen:
            handler = self._workflows({}, headers={"X-Manying-Image-Token": "mac-local-token"})
        request = self._proxied_request(urlopen)
        self.assertEqual(
            self._request_headers(request),
            {"x-manying-image-token": "win-side-token"},  # env 优先,不吃本机入站令牌
        )
        self.assertEqual(handler.response, (reply, HTTPStatus.OK))

    def test_remote_proxy_forwards_inbound_credentials_without_env(self) -> None:
        # env 未配(空串)=回落转发入站凭据(双机手工对齐令牌的部署可用)
        reply = {"models": []}
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch.dict("os.environ", {server.REMOTE_TOKEN_ENV: ""}), patch(
            "urllib.request.urlopen", return_value=self._Resp(reply)
        ) as urlopen:
            handler = self._models_status(
                headers={
                    "Authorization": "Bearer mac-local-token",
                    "X-Manying-Image-Token": "mac-local-token",
                }
            )
        request = self._proxied_request(urlopen)
        self.assertEqual(
            self._request_headers(request),
            {
                "authorization": "Bearer mac-local-token",
                "x-manying-image-token": "mac-local-token",
            },
        )
        self.assertEqual(handler.response, (reply, HTTPStatus.OK))

    def test_remote_proxy_403_reports_auth_failure_not_service_down(self) -> None:
        # 远端在跑但拒令牌:403≠「服务未运行」——HTTPError⊂URLError,旧代码被
        # 兜底 except 误诊成 502 unreachable;修后如实分报鉴权失败+配置指引
        from urllib import error as urllib_error

        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch(
            "urllib.request.urlopen",
            side_effect=urllib_error.HTTPError(
                f"{self.REMOTE_SIDECAR}/comfy/workflows", 403, "Forbidden", None, None
            ),
        ), patch("comfyui.plugin_manager.list_workflows") as list_local:
            handler = self._workflows({})
        list_local.assert_not_called()  # 不静默回落本机
        payload, status = handler.response
        self.assertEqual(status, HTTPStatus.FORBIDDEN)
        self.assertEqual(payload["error"]["code"], "remote-sidecar-auth")
        self.assertIn("鉴权失败", payload["error"]["message"])
        self.assertIn(server.REMOTE_TOKEN_ENV, payload["error"]["message"])
        self.assertNotIn("未运行", payload["error"]["message"])

    def test_remote_proxy_other_http_error_reports_actual_status(self) -> None:
        from urllib import error as urllib_error

        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch(
            "urllib.request.urlopen",
            side_effect=urllib_error.HTTPError(
                f"{self.REMOTE_SIDECAR}/models/status", 500, "Internal Server Error", None, None
            ),
        ), patch("image_gen.model_inventory.build_model_status") as build_local:
            handler = self._models_status()
        build_local.assert_not_called()  # 不静默回落本机
        payload, status = handler.response
        self.assertEqual(status, HTTPStatus.BAD_GATEWAY)
        self.assertEqual(payload["error"]["code"], "remote-sidecar-error")
        self.assertIn("HTTP 500", payload["error"]["message"])


if __name__ == "__main__":
    unittest.main()
