from __future__ import annotations

import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from video_qc import dover_scoring, model_cache, worker
from video_qc import dover_mobile_arch as arch
from video_qc.dover_scoring import VideoQcError


class VideoQcModelCacheTest(unittest.TestCase):
    def test_pinned_sha_is_enforced(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            name = "dover-mobile"
            spec = model_cache.VIDEO_QC_MODELS[name]
            target = Path(temp) / spec["file"]
            target.write_bytes(b"known-dover-test-weight")
            digest = model_cache.file_sha256(target)
            with (
                patch.dict("os.environ", {"MYSTUDIO_VIDEO_QC_MODEL_DIR": temp}),
                patch.object(model_cache, "model_candidate_dirs", return_value=[Path(temp)]),
                patch.dict(model_cache.VIDEO_QC_MODELS, {name: {**spec, "sha256": digest}}),
            ):
                cached = model_cache.find_cached_video_qc_model(name)
                self.assertIsNotNone(cached)
                self.assertEqual(model_cache.verify_model_sha256(name), (True, str(target)))
                self.assertEqual(model_cache.is_video_qc_model_downloaded(name)[0], True)
                target.write_bytes(b"tampered")
                self.assertIsNone(model_cache.find_cached_video_qc_model(name))
                self.assertEqual(model_cache.verify_model_sha256(name), (False, str(target)))

    def test_unknown_model_fails_closed(self) -> None:
        self.assertIsNone(model_cache.find_cached_video_qc_model("not-a-model"))
        self.assertEqual(model_cache.verify_model_sha256("not-a-model"), (False, "unknown-model"))
        self.assertEqual(model_cache.is_video_qc_model_downloaded("not-a-model"), (False, None))


class DoverProbeAndScoringTest(unittest.TestCase):
    def test_probe_reports_each_gate_and_ready_evidence(self) -> None:
        with patch.object(dover_scoring, "find_cached_video_qc_model", return_value=None):
            self.assertEqual(dover_scoring.probe_model()["code"], "model-not-downloaded")
        cached = {"file_path": "/tmp/dover.pth", "size_mb": 40.81, "sha256": "a" * 64}
        with (
            patch.object(dover_scoring, "find_cached_video_qc_model", return_value=cached),
            patch.object(dover_scoring, "_arch_available", return_value=False),
        ):
            self.assertEqual(dover_scoring.probe_model()["code"], "arch-unavailable")
        with (
            patch.object(dover_scoring, "find_cached_video_qc_model", return_value=cached),
            patch.object(dover_scoring, "_arch_available", return_value=True),
        ):
            self.assertEqual(
                dover_scoring.probe_model(),
                {"status": "ready", "file": "/tmp/dover.pth", "sizeMb": 40.81},
            )

    def test_invalid_mode_and_missing_video_are_stable_errors(self) -> None:
        ready = {"status": "ready", "file": "/tmp/dover.pth", "sizeMb": 40.81}
        with patch.object(dover_scoring, "probe_model", return_value=ready):
            with self.assertRaisesRegex(VideoQcError, "whole\\|slices") as invalid_mode:
                dover_scoring.score_video({"videoPath": "/tmp/v.mp4", "mode": "invalid"})
            self.assertEqual(invalid_mode.exception.code, "invalid-mode")
            with self.assertRaises(VideoQcError) as missing_video:
                dover_scoring.score_video({"mode": "whole"})
            self.assertEqual(missing_video.exception.code, "missing-video-path")

    def test_whole_and_slices_use_the_same_official_scorer(self) -> None:
        ready = {"status": "ready", "file": "/tmp/dover.pth", "sizeMb": 40.81}
        fake_model = object()
        with tempfile.TemporaryDirectory() as temp:
            video = Path(temp) / "video.mp4"
            video.write_bytes(b"video-placeholder")
            with (
                patch.object(dover_scoring, "probe_model", return_value=ready),
                patch.object(arch, "load_model", return_value=fake_model),
                patch.object(
                    arch,
                    "score_frames",
                    side_effect=[(0.72, -0.04, 0.12), (0.61, -0.08, 0.09), (0.83, 0.01, 0.15)],
                ) as score_frames,
            ):
                result = dover_scoring.score_video({
                    "videoPath": str(video),
                    "mode": "slices",
                    "slices": [
                        {"shotId": "s1", "startS": 0.0, "durationS": 1.5},
                        {"shotId": "s2", "startS": 1.5, "durationS": 2.0},
                    ],
                })
        self.assertEqual(
            {key: result[key] for key in ("fused", "aesthetic", "technical")},
            {"fused": 0.72, "aesthetic": -0.04, "technical": 0.12},
        )
        self.assertTrue(all(math.isfinite(result[key]) for key in ("fused", "aesthetic", "technical")))
        self.assertEqual([row["shotId"] for row in result["slices"]], ["s1", "s2"])
        self.assertEqual(score_frames.call_count, 3)
        self.assertEqual(score_frames.call_args_list[1].kwargs, {"start_s": 0.0, "duration_s": 1.5})
        self.assertIsInstance(result["elapsedMs"], int)

    def test_invalid_slice_fails_closed(self) -> None:
        ready = {"status": "ready", "file": "/tmp/dover.pth", "sizeMb": 40.81}
        with tempfile.TemporaryDirectory() as temp:
            video = Path(temp) / "video.mp4"
            video.write_bytes(b"video-placeholder")
            with patch.object(dover_scoring, "probe_model", return_value=ready):
                with self.assertRaises(VideoQcError) as invalid_slice:
                    dover_scoring.score_video({
                        "videoPath": str(video),
                        "mode": "slices",
                        "slices": [{"shotId": "s1", "startS": 0, "durationS": 0}],
                    })
        self.assertEqual(invalid_slice.exception.code, "invalid-slices")


class DoverOfficialContractTest(unittest.TestCase):
    def test_official_fusion_only_bounds_fused_score(self) -> None:
        self.assertAlmostEqual(arch.fuse_scores(0.1107, -0.08285), 0.5, places=7)
        self.assertGreaterEqual(arch.fuse_scores(-100.0, -100.0), 0.0)
        self.assertLessEqual(arch.fuse_scores(100.0, 100.0), 1.0)

    def test_official_temporal_sampler_shapes(self) -> None:
        with patch.object(arch.np.random, "randint", return_value=0):
            technical = arch.UnifiedFrameSampler(32, 3, 2)(240)
            aesthetic = arch.UnifiedFrameSampler(1, 32, 2, 1)(240)
        self.assertEqual(technical.shape, (96,))
        self.assertEqual(aesthetic.shape, (32,))
        self.assertTrue(((technical >= 0) & (technical < 240)).all())
        self.assertTrue(((aesthetic >= 0) & (aesthetic < 240)).all())

    def test_channels_last_norm_and_spatial_head_contract(self) -> None:
        layer = arch.LayerNorm(4)
        normalized = layer(arch.torch.randn(1, 2, 3, 3, 4))
        self.assertEqual(tuple(normalized.shape), (1, 2, 3, 3, 4))

        head = arch.VQAHead(in_channels=4, hidden_channels=2, dropout_ratio=0.0, pre_pool=False)
        scores = head(arch.torch.randn(2, 4, 2, 3, 3))
        self.assertEqual(tuple(scores.shape), (2, 1, 2, 3, 3))

    def test_dual_view_forward_routes_each_branch(self) -> None:
        class IdentityBackbone(arch.nn.Module):
            def forward(self, value, **_kwargs):
                return value

        class MeanHead(arch.nn.Module):
            def forward(self, value):
                return value.mean(dim=1, keepdim=True)

        model = arch.DOVERMobile(backbone_dims=(4, 8, 16, 32))
        model.technical_backbone = IdentityBackbone()
        model.aesthetic_backbone = IdentityBackbone()
        model.technical_head = MeanHead()
        model.aesthetic_head = MeanHead()
        outputs = model({
            "technical": arch.torch.ones(3, 3, 4, 4, 4),
            "aesthetic": arch.torch.full((1, 3, 4, 4, 4), 2.0),
        })
        self.assertEqual(set(outputs), {"technical", "aesthetic"})
        self.assertAlmostEqual(outputs["technical"].mean().item(), 1.0)
        self.assertAlmostEqual(outputs["aesthetic"].mean().item(), 2.0)

    def test_score_frames_preserves_time_window(self) -> None:
        class FakeWrapper:
            def score(self, video_path: str, *, start_s=None, duration_s=None):
                self.args = (video_path, start_s, duration_s)
                return 0.7, -0.1, 0.2

        wrapper = FakeWrapper()
        self.assertEqual(
            arch.score_frames(wrapper, "/tmp/v.mp4", start_s=1.25, duration_s=2.5),
            (0.7, -0.1, 0.2),
        )
        self.assertEqual(wrapper.args, ("/tmp/v.mp4", 1.25, 2.5))

    def test_license_notice_is_shipped(self) -> None:
        license_path = Path(arch.__file__).with_name("DOVER_LICENSE.txt")
        self.assertTrue(license_path.is_file())
        self.assertIn("S-Lab License 1.0", license_path.read_text(encoding="utf-8"))


class VideoQcWorkerContractTest(unittest.TestCase):
    def test_worker_emits_nested_controller_contract(self) -> None:
        result = {
            "fused": 0.72,
            "aesthetic": -0.04,
            "technical": 0.12,
            "elapsed": 1.4,
        }
        with tempfile.TemporaryDirectory() as temp:
            request_path = Path(temp) / "request.json"
            request_path.write_text(
                json.dumps({"projectId": "p", "chapterId": "c", "videoPath": "/tmp/v.mp4", "mode": "whole"}),
                encoding="utf-8",
            )
            with patch.object(worker, "score_video", return_value=result):
                artifact = worker._run(str(request_path), str(Path(temp) / "artifact.json"))
        self.assertEqual(artifact["status"], "accepted")
        self.assertEqual(artifact["overall"], {"fused": 0.72, "aesthetic": -0.04, "technical": 0.12})
        self.assertEqual(artifact["elapsedMs"], 1400)
        self.assertNotIn("fused", artifact)

    def test_worker_preserves_blocked_error_and_bad_input(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            bad_input = Path(temp) / "bad.json"
            bad_input.write_text("{", encoding="utf-8")
            artifact = worker._run(str(bad_input), str(Path(temp) / "artifact.json"))
            self.assertEqual((artifact["status"], artifact["code"]), ("blocked", "input-read-failed"))

            request = Path(temp) / "request.json"
            request.write_text(json.dumps({"projectId": "p", "chapterId": "c"}), encoding="utf-8")
            with patch.object(worker, "score_video", side_effect=VideoQcError("score-failed", "boom")):
                blocked = worker._run(str(request), str(Path(temp) / "artifact.json"))
            self.assertEqual((blocked["code"], blocked["message"]), ("score-failed", "boom"))
