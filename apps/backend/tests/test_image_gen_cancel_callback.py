# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.

"""Krea2 取消回调的 diffusers 契约测试(不加载模型)。

0dc6724 引入的逐步回调无返回值:diffusers pipeline_flux.py 拿回调返回值
直接 `.pop("latents", ...)`(无 None 保护),第一步去噪后 NoneType.pop
必崩(inference-failed;09-03 装机首跑实锤)。本测试钉住契约:正常路径
必须把 callback_kwargs 原样透传,取消路径照旧抛 RuntimeError。
"""
from __future__ import annotations

import unittest

from image_gen import pipeline
from engines.image_engine.krea2 import _cancel_step_callback


class CancelStepCallbackContractTest(unittest.TestCase):
    def test_normal_path_returns_passthrough_dict(self):
        callback = _cancel_step_callback()
        callback_kwargs = {"latents": object(), "prompt_embeds": object()}
        result = callback(None, 0, 1.0, callback_kwargs)
        self.assertIs(result, callback_kwargs)

    def test_cancelled_path_raises_and_flag_survives(self):
        callback = _cancel_step_callback()
        pipeline._CANCEL_EVENT.set()
        try:
            with self.assertRaises(RuntimeError):
                callback(None, 0, 1.0, {})
        finally:
            pipeline._CANCEL_EVENT.clear()
        # 复位后恢复正常透传
        self.assertIsInstance(callback(None, 0, 1.0, {}), dict)


class UnclothCancelFlagRegressionTest(unittest.TestCase):
    """09-10 P0-1 回归:无衣物入口必须复位残留取消位,在途取消报「已停止」。

    病灶:_handle_uncloth 从不清位也从不检查 _CANCEL_EVENT——上一次在途生成
    被取消后,后续每个 /v1/images/uncloth 在第一个去噪步即抛 generation-cancelled,
    且被误报成 500「无衣物管线失败」。
    """

    def _make_handler(self):
        from image_gen.server import Handler

        handler = object.__new__(Handler)
        captured: dict = {}

        def capture_json(payload, status=200):
            captured["json"] = payload

        def capture_error(status, message, code="error"):
            captured["error"] = {"status": status, "message": message, "code": code}

        handler._send_json = capture_json
        handler._send_error_json = capture_error
        return handler, captured

    def test_uncloth_entry_resets_stale_cancel_flag(self):
        from unittest import mock

        pipeline._CANCEL_EVENT.set()  # 模拟上一次在途生成留下的取消位
        handler, captured = self._make_handler()
        try:
            with mock.patch(
                "image_gen.uncloth_pipeline.run_uncloth_pipeline",
                return_value="ZmFrZQ==",
            ):
                handler._handle_uncloth(
                    {"prompt": "test", "input_image": "data:image/png;base64,xxx", "params": {}}
                )
        finally:
            pipeline._CANCEL_EVENT.clear()
        self.assertIn("json", captured, f"应成功返回,实际: {captured}")
        self.assertEqual(captured["json"]["data"][0]["b64_json"], "ZmFrZQ==")

    def test_uncloth_cancel_during_run_reports_stopped(self):
        from http import HTTPStatus
        from unittest import mock

        def cancelled_run(*_args, **_kwargs):
            pipeline._CANCEL_EVENT.set()
            raise RuntimeError("generation-cancelled")

        handler, captured = self._make_handler()
        try:
            with mock.patch(
                "image_gen.uncloth_pipeline.run_uncloth_pipeline",
                side_effect=cancelled_run,
            ):
                handler._handle_uncloth(
                    {"prompt": "test", "input_image": "data:image/png;base64,xxx", "params": {}}
                )
        finally:
            pipeline._CANCEL_EVENT.clear()
        self.assertEqual(
            captured.get("error", {}).get("code"), "generation-cancelled", f"实际: {captured}"
        )
        self.assertEqual(captured["error"]["status"], HTTPStatus.OK)


if __name__ == "__main__":
    unittest.main()
