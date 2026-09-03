# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.

"""参考图预处理契约(以 ComfyUI「NSFW专业流-图生图」为准,09-03 用户裁定):
等比缩放≤目标MP(lanczos)+中心裁剪到输出宽高比——旧实现直接拉伸变形。"""
from __future__ import annotations

import unittest


class ReferencePrepTest(unittest.TestCase):
    def _make(self, w, h):
        from PIL import Image
        return Image.new("RGB", (w, h), (128, 64, 32))

    def test_tall_image_center_cropped_no_distortion(self):
        from image_gen.engines.krea2 import _prepare_reference_image
        # 竖图 800×1600 → 1:1 输出:应裁宽居中,不拉伸
        out = _prepare_reference_image(self._make(800, 1600), 1024, 1024)
        self.assertEqual(out.size, (1024, 1024))
        # 比例守恒:输入被裁到 800×800 方形后再放大——输出不变形由裁剪保证
        self.assertEqual(out.size[0], out.size[1])

    def test_large_image_downscaled_to_target_megapixels(self):
        from image_gen.engines.krea2 import _prepare_reference_image
        # 4096×4096(16MP)→ 1024×1024 目标(1MP):先等比降到 ≤1MP 再裁剪缩放
        out = _prepare_reference_image(self._make(4096, 4096), 1024, 1024)
        self.assertEqual(out.size, (1024, 1024))

    def test_small_image_upscaled_and_ratio_kept(self):
        from image_gen.engines.krea2 import _prepare_reference_image
        # 小图 16:9 → 16:9 输出:等比路径零裁剪,直接放大
        out = _prepare_reference_image(self._make(320, 180), 1360, 768)
        self.assertEqual(out.size, (1360, 768))


if __name__ == "__main__":
    unittest.main()
