"""DOVER-Mobile 推理架构与 worker 契约测试

可移植性约定:
- 权重路径经 model_cache 解析(MYSTUDIO_VIDEO_QC_MODEL_DIR 或 ~/.mystudio),
  找不到则 skip 而非 fail——CI/其他机器无权重是合法状态。
- 真实视频用例只在权重与测试视频同时存在时运行。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).parent))

_TEST_VIDEO_CANDIDATES = (
    Path("/Users/zhengbingjin/Project/IP/MA/backups/legacy-pipeline/exports/chapter-001/道劫_EP01_断剑夜访道口镇.mp4"),
)


def _cached_weight() -> str | None:
    from video_qc.model_cache import find_cached_video_qc_model

    cached = find_cached_video_qc_model("dover-mobile")
    return cached["file_path"] if cached else None


def _test_video() -> Path | None:
    for candidate in _TEST_VIDEO_CANDIDATES:
        if candidate.is_file():
            return candidate
    return None


@pytest.fixture(scope="module")
def model():
    """Load DOVER-Mobile with cached weights (skip when not downloaded)."""
    weight_path = _cached_weight()
    if weight_path is None:
        pytest.skip("DOVER-Mobile 权重未下载(设置页显式下载后重跑)")
    from video_qc.dover_mobile_arch import DOVERMobileWrapper

    return DOVERMobileWrapper.load(weight_path)


@pytest.fixture(scope="module")
def test_video():
    video = _test_video()
    if video is None:
        pytest.skip("本机无测试成片(道劫 EP01 legacy export)——跳过真实视频用例")
    return str(video)


class TestDoverMobileArch:
    """DOVER-Mobile architecture tests"""

    def test_model_load_keys(self, model):
        """Dual backbones/heads exist and hold loaded parameters."""
        assert sum(p.numel() for p in model.model.parameters()) > 0
        for attr in ("technical_backbone", "aesthetic_backbone",
                     "technical_head", "aesthetic_head"):
            assert hasattr(model.model, attr), f"missing {attr}"

    def test_forward_pass_range(self, model, test_video):
        """Scores from a real video stay in sane ranges (fused is sigmoid → [0,1])."""
        fused, aesthetic, technical = model.score(test_video, fragments=8)

        assert 0 <= fused <= 1, f"Fused score out of range: {fused}"
        assert -5 < aesthetic < 5, f"Aesthetic unexpectedly extreme: {aesthetic}"
        assert -5 < technical < 5, f"Technical unexpectedly extreme: {technical}"

    def test_forward_slice_window_differs(self, model, test_video):
        """Windowed (shot-level) scoring samples a different span than whole-video."""
        whole_fused, _, _ = model.score(test_video, fragments=8)
        slice_fused, _, _ = model.score(test_video, fragments=8, start_s=1.0, duration_s=2.0)

        assert 0 <= slice_fused <= 1
        # Extremely unlikely to be bit-identical when the sampled span differs.
        assert abs(whole_fused - slice_fused) > 1e-9, \
            "slice window should sample different frames than whole-video"

    def test_sample_frames_shape(self, test_video):
        """sample_frames returns (N, C, H, W) normalized to 224x224."""
        from video_qc.dover_mobile_arch import sample_frames

        frames = sample_frames(test_video, fragments=8)

        assert frames.ndim == 4, f"Expected 4D tensor, got {frames.shape}"
        assert frames.shape[1] == 3, f"Expected 3 channels, got {frames.shape[1]}"
        assert frames.shape[2:] == (224, 224), f"Expected 224x224, got {frames.shape[2:]}"

    def test_sampling_window_clamps(self):
        """_sampling_window clamps out-of-range windows instead of crashing."""
        from video_qc.dover_mobile_arch import _sampling_window

        assert _sampling_window(100, None, None) == (0, 100)
        assert _sampling_window(100, 1.0, 1.0) == (24, 48)  # fps=24 default
        lo, hi = _sampling_window(100, 0.5, 0.0)
        assert hi > lo, "zero-duration window must still yield ≥1 frame"
        lo, hi = _sampling_window(100, 99.0, 5.0)  # window fully past the tail
        assert 0 <= lo < hi <= 100, f"past-tail window must clamp to a valid span, got ({lo},{hi})"

    def test_to_clip_batches_matches_official_regrouping(self):
        """Official reshape(C, num_clips, -1, H, W).transpose(0,1): clip k holds
        source frames [k*per_clip, (k+1)*per_clip) — temporal convs stay per-clip."""
        from video_qc.dover_mobile_arch import _to_clip_batches

        frames = torch.arange(96, dtype=torch.float32).reshape(96, 1, 1, 1)
        batched = _to_clip_batches(frames, num_clips=3)

        assert batched.shape == (3, 1, 32, 1, 1)
        for k in range(3):
            for t in range(32):
                assert batched[k, 0, t, 0, 0] == k * 32 + t, "clip regrouping dropped frame order"

        with pytest.raises(ValueError):
            _to_clip_batches(torch.zeros(34, 1, 1, 1), num_clips=3)  # 34 % 3 != 0

    def test_spatial_fragments_mosaic_provenance(self):
        """fragments view: each 32px mosaic cell comes from its source grid cell."""
        import numpy as np
        from unittest.mock import patch

        from video_qc.dover_mobile_arch import _spatial_fragments_view

        # 448×448 source: 7×7 cells of 64px, one 32-frame group.
        # Cell (i,j) filled with constant value i*7+j so provenance is checkable.
        frames = np.zeros((32, 448, 448, 3), dtype=np.uint8)
        for i in range(7):
            for j in range(7):
                frames[:, i * 64:(i + 1) * 64, j * 64:(j + 1) * 64] = i * 7 + j

        with patch("numpy.random.randint", return_value=0):
            mosaic = _spatial_fragments_view(frames)

        assert mosaic.shape == (32, 224, 224, 3)
        for i in range(7):
            for j in range(7):
                cell = mosaic[:, i * 32:(i + 1) * 32, j * 32:(j + 1) * 32]
                assert (cell == i * 7 + j).all(), f"cell ({i},{j}) took the wrong block"

    def test_spatial_fragments_upsamples_small_sources(self):
        """Sources below 224px are bilinear-upsampled so the canvas still fills."""
        import numpy as np

        from video_qc.dover_mobile_arch import _spatial_fragments_view

        frames = np.full((32, 112, 112, 3), 200, dtype=np.uint8)
        mosaic = _spatial_fragments_view(frames)
        assert mosaic.shape == (32, 224, 224, 3)
        # after upsampling every cell samples the same uniform source
        assert mosaic.min() > 150, "upsampled canvas should carry the source signal"

    def test_spatial_fragments_rejects_bad_frame_count(self):
        import numpy as np
        import pytest as _pytest

        from video_qc.dover_mobile_arch import _spatial_fragments_view

        with _pytest.raises(ValueError):
            _spatial_fragments_view(np.zeros((33, 448, 448, 3), dtype=np.uint8))

    def test_grn_layer_normalization(self):
        """GRN preserves shape and stays finite."""
        from video_qc.dover_mobile_arch import GRN

        grn = GRN(dim=64)
        x = torch.randn(2, 64, 16, 64, 64)  # (B, C, T, H, W)

        with torch.no_grad():
            output = grn(x)

        assert output.shape == x.shape, "GRN should preserve shape"
        assert not torch.isnan(output).any(), "Output should not contain NaN"
        assert not torch.isinf(output).any(), "Output should not contain Inf"

    def test_convnextv23d_output_features(self):
        """Backbone pools to (N, C) by default; spatial mode keeps 5D."""
        from video_qc.dover_mobile_arch import ConvNeXtV23D

        backbone = ConvNeXtV23D(depths=(2, 2, 6, 2), dims=(48, 96, 192, 384), drop_path_rate=0.4)
        x = torch.randn(1, 3, 32, 224, 224)

        pooled = backbone.forward_features(x)
        assert pooled.shape == (1, 384), f"Expected (1, 384), got {pooled.shape}"

        spatial = backbone.forward_features(x, return_spatial=True)
        assert spatial.ndim == 5, f"Spatial features must stay 5D, got {spatial.shape}"


class TestDoverScoring:
    """DOVER scoring adapter tests"""

    def test_probe_model_shape(self):
        """Probe is either ready (with file/sizeMb) or blocked with a machine code."""
        from video_qc.dover_scoring import probe_model

        probe = probe_model()

        if probe["status"] == "ready":
            assert "file" in probe and "sizeMb" in probe
            assert probe["sizeMb"] > 40, "DOVER-Mobile weight should be ~41MB"
        else:
            assert probe["status"] == "blocked"
            assert probe["code"] in ("model-not-downloaded", "arch-unavailable")

    def test_score_video_request_format(self, test_video):
        """score_video returns the whole-mode contract fields."""
        from video_qc.dover_scoring import score_video

        result = score_video({"videoPath": test_video, "mode": "whole"})

        for key in ("fused", "aesthetic", "technical", "elapsed"):
            assert key in result, f"Result missing {key}"
        assert 0 <= result["fused"] <= 1, f"Fused out of range: {result['fused']}"

    def test_score_video_slices_mode(self, test_video):
        """slices mode returns whole-video scores plus per-shot fused (fail-closed)."""
        from video_qc.dover_scoring import score_video

        result = score_video({
            "videoPath": test_video,
            "mode": "slices",
            "slices": [
                {"shotId": "shot-1", "startS": 0.5, "durationS": 1.5},
                {"shotId": "shot-2", "startS": 60.0, "durationS": 2.0},
            ],
        })

        assert [s["shotId"] for s in result["slices"]] == ["shot-1", "shot-2"]
        for slice_row in result["slices"]:
            assert 0 <= slice_row["fused"] <= 1
        # 官方口径:slices 响应同时带整片三分 + int 毫秒耗时
        assert 0 <= result["fused"] <= 1
        assert isinstance(result["elapsedMs"], int)

    def test_score_video_invalid_slice_fails_closed(self, test_video):
        """Malformed slice entries raise invalid-slices instead of being skipped."""
        from video_qc.dover_scoring import VideoQcError, score_video

        with pytest.raises(VideoQcError) as exc_info:
            score_video({
                "videoPath": test_video,
                "mode": "slices",
                "slices": [{"shotId": "bad", "startS": 1.0}],  # 缺 durationS
            })
        assert exc_info.value.code == "invalid-slices"


class TestDoverWorkerContract:
    """Verify the Python artifact matches the current Electron controller contract."""

    def test_worker_projects_overall_and_elapsed_ms(self, monkeypatch, tmp_path):
        from video_qc import worker

        request_path = tmp_path / "request.json"
        output_path = tmp_path / "artifact.json"
        request_path.write_text(
            '{"projectId":"p","chapterId":"c","videoPath":"/tmp/v.mp4","mode":"whole"}',
            encoding="utf-8",
        )
        monkeypatch.setattr(
            worker,
            "score_video",
            lambda _request: {"fused": 0.72, "aesthetic": 0.11, "technical": 0.22, "elapsed": 1.234},
        )

        artifact = worker._run(str(request_path), str(output_path))

        assert artifact["overall"] == {"fused": 0.72, "aesthetic": 0.11, "technical": 0.22}
        assert artifact["elapsedMs"] == 1234

    def test_worker_projects_slices(self, monkeypatch, tmp_path):
        from video_qc import worker

        request_path = tmp_path / "request.json"
        request_path.write_text(
            '{"projectId":"p","chapterId":"c","videoPath":"/tmp/v.mp4","mode":"slices",'
            '"slices":[{"shotId":"s1","startS":0,"durationS":2}]}',
            encoding="utf-8",
        )
        monkeypatch.setattr(
            worker,
            "score_video",
            lambda _request: {
                "fused": 0.7, "aesthetic": 0.1, "technical": 0.2,
                "slices": [{"shotId": "s1", "fused": 0.66}],
                "elapsedMs": 2500, "elapsed": 2.5,
            },
        )

        artifact = worker._run(str(request_path), str(tmp_path / "artifact.json"))

        assert artifact["status"] == "accepted"
        assert artifact["slices"] == [{"shotId": "s1", "fused": 0.66}]
        assert artifact["overall"] == {"fused": 0.7, "aesthetic": 0.1, "technical": 0.2}
        assert artifact["elapsedMs"] == 2500


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
