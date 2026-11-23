#!/usr/bin/env python3
"""1123 R1/D18-A:multiseg 终档前缀 × my_shot 路径解析 × writeback faceRefined。

背景(review-after-glm-1123.md R1):组装器曾写 4100=`${prefix}-p-final`,第 5 段
带后缀致 MyShot 策略校验炸/丢 h3-baked;D18-A 裁定=文件名保留 `_修脸`,
my_shot.parse_video_prefix 校验前剥离并置 face_refined,消费端拿恒干净 policy。

前缀字符串与 vitest(h3-shot-video-workflow.test.ts「1123 R1/D18-A 修脸命名」)
的组装器产出断言同款钉死——TS 侧断言产出口,本测断言引擎侧解析口,两口同串。
"""
import sys
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/comfyui

from my_nodes.nodes.my_shot import parse_video_prefix  # noqa: E402
from my_nodes.bridge import writeback  # noqa: E402

SHOT = "sb-chapter-001-001"
BASE = f"video/漫影/chapter-001/{SHOT}"


class TestParseVideoPrefix(unittest.TestCase):
    def test_pure_policy_passes(self):
        for policy in ("full", "ambient"):
            sub, pol, fr = parse_video_prefix(f"{BASE}/{policy}", SHOT)
            self.assertEqual((sub, pol, fr), (BASE, policy, False))

    def test_refine_suffix_stripped(self):
        for policy in ("full", "ambient"):
            sub, pol, fr = parse_video_prefix(f"{BASE}/{policy}_修脸", SHOT)
            self.assertEqual((sub, pol, fr), (BASE, policy, True))

    def test_rejects_double_suffix_and_bare_chinese(self):
        for bad in ("full_修脸_修脸", "全", ""):
            with self.assertRaises(RuntimeError):
                parse_video_prefix(f"{BASE}/{bad}" if bad else f"{BASE}/", SHOT)

    def test_legacy_pfinal_strips_to_ascii_not_error(self):
        # review 拒绝清单含 full-p-final_修脸,但 D18-A 书面规格=「剥完走原 ASCII 校验」,
        # 剥后 full-p-final 合法→不炸(仅落 ambient 兜底);组装器已不再产出该形态,行为如档
        sub, pol, fr = parse_video_prefix(f"{BASE}/full-p-final_修脸", SHOT)
        self.assertEqual((pol, fr), ("full-p-final", True))

    def test_rejects_wrong_shape(self):
        for bad in (f"video/_validation/chapter-001/{SHOT}/full",          # 隔离前缀(实弹摘 MyShot 的原因)
                    f"video/漫影/chapter-001/other-shot/full",             # shot 不匹配
                    f"video/漫影/chapter-001/{SHOT}/a/b",                  # 非 5 段
                    None):
            with self.assertRaises(RuntimeError):
                parse_video_prefix(bad, SHOT)


class TestAssemblerProducedPrefixes(unittest.TestCase):
    """组装器四种产出(faceRefine 关/开 × policy full/ambient)全过解析——与 vitest 同串。"""

    def test_four_assembler_combos(self):
        for refine in (False, True):
            for policy in ("full", "ambient"):
                prefix = f"{BASE}/{policy}" + ("_修脸" if refine else "")
                sub, pol, fr = parse_video_prefix(prefix, SHOT)
                self.assertEqual(pol, policy, "消费端拿到恒干净 policy(h3-baked 判定不受修脸影响)")
                self.assertEqual(fr, refine)


class TestDeliverVideoFaceRefined(unittest.TestCase):
    def _capture(self, **kwargs):
        captured = {}
        def fake_post(payload, label):
            captured["payload"] = payload
            return {"accepted": True, "id": "w-1"}
        with mock.patch.object(writeback, "_post", side_effect=fake_post):
            writeback.deliver_video(SHOT, "AAAA", BASE, "full", **kwargs)
        return captured["payload"]

    def test_default_no_key(self):
        meta = self._capture()["meta"]
        self.assertNotIn("faceRefined", meta)

    def test_true_sets_key(self):
        meta = self._capture(face_refined=True)["meta"]
        self.assertIs(meta.get("faceRefined"), True)


if __name__ == "__main__":
    unittest.main()
