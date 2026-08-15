import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from video_use.adapter import (
    HYPERFRAMES_DECORATIVE_TEMPLATES,
    _build_overlay_slots,
    VideoUseAdapterError,
    _tool_env,
    _validate_rendered_output,
    build_edl_payload,
    run_pinned_adapter,
)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class VideoUseAdapterTest(unittest.TestCase):
    def test_overlay_slots_follow_mood_rules_and_fallback_deterministically(self):
        request = {
            "boundaryIntents": [
                {"fromShotId": "shot-001", "toShotId": "shot-002", "moodWord": "战斗"},
            ],
        }
        edl = {"ranges": [
            {"source": "shot-001", "start": 0.0, "end": 0.5},
            {"source": "shot-002", "start": 0.0, "end": 0.7},
            {"source": "shot-003", "start": 0.0, "end": 0.2},
        ]}
        with patch("video_use.adapter.print") as log:
            slots = _build_overlay_slots(request, edl)
        self.assertEqual(slots[0]["templateId"], "lens-flare")
        self.assertEqual(slots[0]["moodWord"], "战斗")
        self.assertEqual(slots[1]["templateId"], "lens-flare")
        self.assertEqual(slots[2]["templateId"], HYPERFRAMES_DECORATIVE_TEMPLATES[2])
        self.assertTrue(log.called)
        self.assertEqual([slot["startUs"] for slot in slots], [0, 500_000, 1_200_000])

    def test_overlay_slots_follow_transition_overlap_timing(self):
        edl = {"ranges": [
            {"source": "shot-001", "start": 0.0, "end": 0.5},
            {"source": "shot-002", "start": 0.0, "end": 0.7},
            {"source": "shot-003", "start": 0.0, "end": 0.2},
        ]}
        artifact_edl = [
            {"shotId": "shot-001", "timelineStartS": 0.0, "transitionToNext": {"effectId": "fade", "durationUs": 200_000}},
            {"shotId": "shot-002", "timelineStartS": 0.5},
            {"shotId": "shot-003", "timelineStartS": 1.2},
        ]
        with patch("video_use.adapter.print"):
            slots = _build_overlay_slots({}, edl, artifact_edl)
        self.assertEqual([slot["startUs"] for slot in slots], [0, 300_000, 1_000_000])

    def test_overlay_slot_durations_respect_transition_gap_and_decorative_cap(self):
        edl = {"ranges": [
            {"source": "shot-001", "start": 0.0, "end": 5.0},
            {"source": "shot-002", "start": 0.0, "end": 4.0},
        ]}
        artifact_edl = [
            {"shotId": "shot-001", "timelineStartS": 0.0, "transitionToNext": {"effectId": "fade", "durationUs": 1_000_000}},
            {"shotId": "shot-002", "timelineStartS": 5.0},
        ]
        with patch("video_use.adapter.print"):
            slots = _build_overlay_slots({}, edl, artifact_edl)
        self.assertEqual([slot["startUs"] for slot in slots], [0, 4_000_000])
        previous_end = 0
        for slot in slots:
            self.assertGreaterEqual(slot["startUs"], previous_end)
            self.assertLessEqual(slot["durationUs"], 1_100_000)
            previous_end = slot["startUs"] + slot["durationUs"]

    def _fixtures(self, root: Path) -> tuple[dict, dict]:
        shots = []
        aligned_shots = []
        for index, (shot_id, text, duration_us) in enumerate(
            (("shot-001", "甲乙。", 500_000), ("shot-002", "丙丁！", 700_000)),
            start=1,
        ):
            video = root / f"{shot_id}.mp4"
            audio = root / f"{shot_id}.wav"
            video_bytes = f"video-{index}".encode("utf-8")
            audio_bytes = f"audio-{index}".encode("utf-8")
            video.write_bytes(video_bytes)
            audio.write_bytes(audio_bytes)
            text_sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
            shots.append({
                "shotId": shot_id,
                "videoPath": str(video),
                "audioPath": str(audio),
                "ttsSpokenText": text,
                "sourceSha256": sha256_bytes(video_bytes),
                "audioSha256": sha256_bytes(audio_bytes),
                "textSha256": text_sha,
                "durationUs": duration_us,
            })
            aligned_shots.append({
                "shotId": shot_id,
                "ttsSpokenText": text,
                "audioSha256": sha256_bytes(audio_bytes),
                "textSha256": text_sha,
                "words": [
                    {"id": f"{shot_id}-w1", "text": text[0], "startS": 0.0, "endS": 0.2, "confidence": 0.9},
                    {"id": f"{shot_id}-w2", "text": text[1], "startS": 0.2, "endS": 0.4, "confidence": 0.8},
                    {"id": f"{shot_id}-w3", "text": text[2], "startS": 0.4, "endS": 0.45, "confidence": 0.9},
                ],
                "sentences": [{"text": text, "startS": 0.0, "endS": 0.45, "confidence": 0.866}],
            })
        request = {
            "schemaVersion": 1,
            "projectId": "project-1",
            "chapterId": "chapter-1",
            "revision": 3,
            "mode": "editable-edl",
            "shots": shots,
            "sourceSha256": "a" * 64,
            "audioSha256": "b" * 64,
            "textSha256": "c" * 64,
            "grade": "auto",
        }
        alignment = {
            "schemaVersion": 1,
            "status": "ready",
            "projectId": "project-1",
            "chapterId": "chapter-1",
            "revision": 3,
            "shots": aligned_shots,
        }
        return request, alignment

    def test_build_edl_writes_canonical_transcripts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request, alignment = self._fixtures(root)
            edl, edl_path = build_edl_payload(request, alignment, root / "edit")

            self.assertEqual(edl_path.name, "edl.json")
            self.assertEqual([entry["source"] for entry in edl["ranges"]], ["shot-001", "shot-002"])
            self.assertEqual(edl["total_duration_s"], 1.2)
            transcript = json.loads((root / "edit" / "transcripts" / "shot-001.json").read_text(encoding="utf-8"))
            self.assertEqual(transcript["text"], "甲乙。")
            self.assertEqual(transcript["words"][0]["start"], 0.0)

    def test_tool_env_preserves_shared_ffmpeg_paths_and_macos_dylibs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ffmpeg = root / "tools" / "ffmpeg"
            ffprobe = root / "tools" / "ffprobe"
            ffmpeg.parent.mkdir(parents=True)
            ffmpeg.write_text("", encoding="utf-8")
            ffprobe.write_text("", encoding="utf-8")
            with patch.dict("os.environ", {"PATH": "/system/bin", "DYLD_LIBRARY_PATH": "/system/lib"}, clear=True), patch(
                "video_use.adapter.sys.platform", "darwin"
            ):
                env = _tool_env(str(ffmpeg), str(ffprobe))

            self.assertEqual(env["MYSTUDIO_FFMPEG_PATH"], str(ffmpeg))
            self.assertEqual(env["MYSTUDIO_FFPROBE_PATH"], str(ffprobe))
            self.assertTrue(env["PATH"].split(":")[:2] == [str(ffmpeg.parent), str(ffprobe.parent)])
            self.assertTrue(env["DYLD_LIBRARY_PATH"].split(":")[:2] == [str(ffmpeg.parent), str(ffprobe.parent)])

    def test_rendered_duration_tolerance_scales_only_with_segment_frame_quantization(self):
        _validate_rendered_output(Path("/tmp/preview.mp4"), 173.708, ["video", "audio"], 172.947, segment_count=43)
        with self.assertRaisesRegex(VideoUseAdapterError, "输出时长与 EDL 不一致"):
            _validate_rendered_output(Path("/tmp/preview.mp4"), 176.0, ["video", "audio"], 172.947, segment_count=43)

    def test_execute_adapter_shifts_alignment_to_chapter_timeline(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request, alignment = self._fixtures(root)
            upstream = root / "upstream"
            (upstream / "helpers").mkdir(parents=True)
            (upstream / "helpers" / "render.py").write_text("# render", encoding="utf-8")
            (upstream / "helpers" / "timeline_view.py").write_text("# timeline", encoding="utf-8")
            ffmpeg = root / "ffmpeg"
            ffprobe = root / "ffprobe"
            ffmpeg.write_text("", encoding="utf-8")
            ffprobe.write_text("", encoding="utf-8")

            helper_calls = []

            def fake_helper(_helper, args, *, cwd, env):
                helper_calls.append(list(args))
                output = Path(args[args.index("-o") + 1])
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(b"generated")

            with patch("video_use.adapter._run_helper", side_effect=fake_helper), patch(
                "video_use.adapter._probe_output", return_value=(1.2, ["video", "audio"])
            ), patch("video_use.adapter._probe_media_duration", return_value=1.0):
                artifact = run_pinned_adapter(
                    request,
                    alignment,
                    upstream_root=upstream,
                    ffmpeg_path=str(ffmpeg),
                    ffprobe_path=str(ffprobe),
                    artifact_path=root / "artifact.json",
                    now_ms=123,
                )

            self.assertEqual(artifact["status"], "pending")
            self.assertEqual(artifact["stage"], "awaiting-review")
            self.assertEqual(artifact["alignment"][1]["startUs"], 500_000)
            self.assertEqual(artifact["subtitles"][1]["startUs"], 500_000)
            self.assertEqual(artifact["selfEval"]["passed"], True)
            self.assertIn("--no-loudnorm", helper_calls[0])
            self.assertNotIn("--no-loudnorm", helper_calls[-1])

    def test_flat_mode_records_clean_mp4_sha_separately_from_burned_preview(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request, alignment = self._fixtures(root)
            request["mode"] = "flat-shot-mp4"
            upstream = root / "upstream"
            (upstream / "helpers").mkdir(parents=True)
            for name in ("render.py", "timeline_view.py"):
                (upstream / "helpers" / name).write_text("# helper", encoding="utf-8")
            ffmpeg = root / "ffmpeg"
            ffprobe = root / "ffprobe"
            ffmpeg.write_text("", encoding="utf-8")
            ffprobe.write_text("", encoding="utf-8")

            def fake_helper(_helper, args, *, cwd, env):
                output = Path(args[args.index("-o") + 1])
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(b"flat-generated" if "--no-subtitles" in args else b"preview-generated")

            with patch("video_use.adapter._run_helper", side_effect=fake_helper), patch(
                "video_use.adapter._probe_output", return_value=(1.2, ["video", "audio"])
            ), patch("video_use.adapter._probe_media_duration", return_value=1.0):
                artifact = run_pinned_adapter(
                    request,
                    alignment,
                    upstream_root=upstream,
                    ffmpeg_path=str(ffmpeg),
                    ffprobe_path=str(ffprobe),
                    artifact_path=root / "artifact.json",
                    now_ms=123,
                )

            self.assertEqual(artifact["mode"], "flat-shot-mp4")
            self.assertNotEqual(artifact["flatShotMp4Path"], artifact["preview"]["path"])
            self.assertEqual(artifact["flatShotMp4Sha256"], sha256_bytes(b"flat-generated"))

    def test_default_policy_blocks_video_shorter_than_tts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request, alignment = self._fixtures(root)
            request["shots"] = request["shots"][:1]
            alignment["shots"] = alignment["shots"][:1]
            (root / "ffmpeg").write_text("", encoding="utf-8")
            (root / "ffprobe").write_text("", encoding="utf-8")
            with patch("video_use.adapter._probe_media_duration", side_effect=[0.5, 0.8]):
                with self.assertRaisesRegex(VideoUseAdapterError, "视频短于 TTS 音频") as raised:
                    run_pinned_adapter(
                        request,
                        alignment,
                        upstream_root=root,
                        ffmpeg_path=str(root / "ffmpeg"),
                        ffprobe_path=str(root / "ffprobe"),
                        artifact_path=root / "artifact.json",
                        now_ms=123,
                    )
            self.assertEqual(raised.exception.code, "input-duration-mismatch")

    def test_explicit_padding_records_derived_evidence_and_recomputes_input_sha(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request, alignment = self._fixtures(root)
            request["shots"] = request["shots"][:1]
            alignment["shots"] = alignment["shots"][:1]
            request["derivedInputPolicy"] = "pad-video-to-audio"
            upstream = root / "upstream"
            (upstream / "helpers").mkdir(parents=True)
            for name in ("render.py", "timeline_view.py"):
                (upstream / "helpers" / name).write_text("# helper", encoding="utf-8")
            ffmpeg = root / "ffmpeg"
            ffprobe = root / "ffprobe"
            ffmpeg.write_text("", encoding="utf-8")
            ffprobe.write_text("", encoding="utf-8")
            helper_calls = []

            def fake_helper(_helper, args, *, cwd, env):
                helper_calls.append(list(args))
                output = Path(args[args.index("-o") + 1])
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(b"generated")

            def fake_derive(_source, derived, _target, *, ffmpeg_path, ffprobe_path, env):
                derived.parent.mkdir(parents=True, exist_ok=True)
                derived.write_bytes(b"derived-video")
                self.assertEqual(env["MYSTUDIO_FFMPEG_PATH"], str(ffmpeg))
                self.assertEqual(env["MYSTUDIO_FFPROBE_PATH"], str(ffprobe))
                return 0.833

            with patch("video_use.adapter._probe_media_duration", side_effect=[0.5, 0.8]), patch(
                "video_use.adapter._derive_video_to_audio", side_effect=fake_derive
            ), patch("video_use.adapter._run_helper", side_effect=fake_helper), patch(
                "video_use.adapter._probe_output", return_value=(0.8, ["video", "audio"])
            ):
                artifact = run_pinned_adapter(
                    request,
                    alignment,
                    upstream_root=upstream,
                    ffmpeg_path=str(ffmpeg),
                    ffprobe_path=str(ffprobe),
                    artifact_path=root / "artifact.json",
                    now_ms=123,
                )

            self.assertEqual(len(artifact["derivedInputs"]), 1)
            derived = artifact["derivedInputs"][0]
            self.assertEqual(derived["derivation"], "ffmpeg-tpad-clone-apad")
            self.assertTrue(Path(derived["derivedPath"]).is_file())
            self.assertEqual(artifact["edl"][0]["durationS"], 0.8)
            self.assertNotEqual(artifact["sourceSha256"], request["sourceSha256"])

    def test_source_sha_drift_blocks_before_derivation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            request, alignment = self._fixtures(root)
            request["shots"] = request["shots"][:1]
            alignment["shots"] = alignment["shots"][:1]
            request["shots"][0]["sourceSha256"] = "b" * 64
            (root / "ffmpeg").write_text("", encoding="utf-8")
            (root / "ffprobe").write_text("", encoding="utf-8")
            with self.assertRaisesRegex(VideoUseAdapterError, "视频 SHA-256 不匹配") as raised:
                run_pinned_adapter(
                    request,
                    alignment,
                    upstream_root=root,
                    ffmpeg_path=str(root / "ffmpeg"),
                    ffprobe_path=str(root / "ffprobe"),
                    artifact_path=root / "artifact.json",
                    now_ms=123,
                )
            self.assertEqual(raised.exception.code, "source-sha-mismatch")

    def test_missing_or_short_derived_file_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.mp4"
            source.write_bytes(b"source")
            target = root / "derived.mp4"
            with patch("video_use.adapter._probe_media_duration", return_value=0.5), patch(
                "video_use.adapter.subprocess.run", return_value=None
            ):
                with self.assertRaisesRegex(VideoUseAdapterError, "派生视频文件不存在") as raised:
                    from video_use.adapter import _derive_video_to_audio
                    _derive_video_to_audio(source, target, 0.8, ffmpeg_path="/shared/ffmpeg", ffprobe_path="/shared/ffprobe", env={})
            self.assertEqual(raised.exception.code, "derived-input-missing")

            def fake_run(*_args, **_kwargs):
                target.write_bytes(b"short")

            with patch("video_use.adapter._probe_media_duration", side_effect=[0.5, 0.6]), patch(
                "video_use.adapter.subprocess.run", side_effect=fake_run
            ):
                with self.assertRaisesRegex(VideoUseAdapterError, "仍短于 TTS 音频") as raised:
                    from video_use.adapter import _derive_video_to_audio
                    _derive_video_to_audio(source, target, 0.8, ffmpeg_path="/shared/ffmpeg", ffprobe_path="/shared/ffprobe", env={})
            self.assertEqual(raised.exception.code, "derived-input-duration-insufficient")


if __name__ == "__main__":
    unittest.main()
