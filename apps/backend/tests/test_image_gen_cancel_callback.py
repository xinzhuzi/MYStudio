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
from image_gen.engines.krea2 import _cancel_step_callback


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


if __name__ == "__main__":
    unittest.main()
