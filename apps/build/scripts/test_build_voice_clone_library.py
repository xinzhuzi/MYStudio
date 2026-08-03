from __future__ import annotations

import contextlib
import hashlib
import io
import json
import math
import os
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_voice_clone_library import (
    DEFAULT_PYTHON_RUNTIME,
    DEFAULT_TEST_TEXT,
    FileConflictError,
    HumanReviewRequiredError,
    PipelineError,
    _ffmpeg_clean_master,
    _evaluate_generated_sample,
    _build_quality_report,
    _existing_candidate_boundaries,
    _existing_quarantine_reason,
    _emotion_availability,
    _confined_library_path,
    _materialize_from_temp,
    _promote_references,
    _preserve_review_fields,
    _write_bytes_if_absent,
    _validate_local_dependencies,
    atomic_write_json,
    accept_library,
    build_parser,
    build_candidate_boundaries,
    classify_quarantine,
    ensure_file_matches_or_raise,
    find_energy_valleys,
    sensevoice_quarantine_reason,
    split_speech_regions,
    validate_reviewed_references,
    verify_source_sha256,
)


def write_fixture_wav(path: Path, duration: float = 3.2) -> None:
    sample_rate = 24_000
    frames = bytearray()
    for index in range(int(sample_rate * duration)):
        sample = int(4000 * math.sin(2 * math.pi * 220 * index / sample_rate))
        frames.extend(struct.pack("<h", sample))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(bytes(frames))


def write_edge_silence_fixture(path: Path) -> None:
    sample_rate = 24_000
    frames = bytearray()
    sections = ((0.5, False), (2.0, True), (0.5, False), (2.0, True), (0.5, False))
    sample_index = 0
    for duration, voiced in sections:
        for _ in range(int(sample_rate * duration)):
            sample = int(4000 * math.sin(2 * math.pi * 220 * sample_index / sample_rate)) if voiced else 0
            frames.extend(struct.pack("<h", sample))
            sample_index += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(bytes(frames))


def approved_entry(path: str, sha256: str, *, clip_id: str = "calm-001") -> dict:
    return {
        "id": clip_id,
        "path": path,
        "sha256": sha256,
        "emotion": "平静",
        "emotionCode": "calm",
        "sourceRange": {"start": 60.0, "end": 63.2},
        "referenceText": "这是一段已经逐字校正的参考台词。",
        "qualityGate": {"automaticEligible": True, "reasons": []},
        "reviewStatus": "approved",
        "humanReview": {
            "status": "approved",
            "identityConfirmed": True,
            "singleSpeaker": True,
            "noMusicOrOverlap": True,
            "noTruncation": True,
        },
    }


class VoiceCloneLibraryContractTest(unittest.TestCase):
    def test_cli_defaults_are_validation_only_and_use_approved_test_text(self):
        build_args = build_parser().parse_args(["build"])
        accept_args = build_parser().parse_args(["accept"])

        self.assertFalse(build_args.apply)
        self.assertFalse(accept_args.apply)
        self.assertEqual(
            DEFAULT_TEST_TEXT,
            "你终于来了。我等了很久，也有很多话想当面告诉你。现在，请听我把事情说完。",
        )
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                build_parser().parse_args(["accept", "--test-text", "可替换文本"])

    def test_source_sha256_is_enforced(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.mp3"
            source.write_bytes(b"authorized source")
            expected = hashlib.sha256(source.read_bytes()).hexdigest()

            self.assertEqual(verify_source_sha256(source, expected), expected)
            with self.assertRaises(ValueError):
                verify_source_sha256(source, "0" * 64)

            before = source.read_bytes()
            os.chmod(source, 0o444)
            self.assertEqual(verify_source_sha256(source, expected), expected)
            self.assertEqual(source.read_bytes(), before)

    def test_missing_cached_models_are_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(PipelineError):
                _validate_local_dependencies(DEFAULT_PYTHON_RUNTIME, Path(tmp), require_qwen=False)

    def test_candidate_boundaries_are_deterministic_and_guarded(self):
        silence_intervals = (
            (0.0, 0.8),
            (5.0, 5.7),
            (11.0, 11.8),
            (17.0, 17.6),
            (23.0, 24.0),
        )

        first = build_candidate_boundaries(24.0, silence_intervals)
        second = build_candidate_boundaries(24.0, silence_intervals)

        self.assertEqual(first, second)
        self.assertTrue(first)
        self.assertTrue(all(3.0 <= end - start <= 15.0 for start, end in first))
        self.assertTrue(all(start >= 0.0 and end <= 24.0 for start, end in first))

    def test_clean_master_preserves_source_timeline_and_internal_pause(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.wav"
            target = Path(tmp) / "clean.wav"
            write_edge_silence_fixture(source)

            _ffmpeg_clean_master(source, target)

            with wave.open(str(target), "rb") as handle:
                duration = handle.getnframes() / handle.getframerate()
            self.assertAlmostEqual(duration, 5.5, places=2)

    def test_overlong_region_prefers_energy_valley_near_asr_punctuation(self):
        boundaries = split_speech_regions(
            [(0.0, 22.0)],
            asr_anchors=[
                {"time": 12.1, "punctuation": True, "text": "说完。"},
                {"time": 14.0, "punctuation": False, "text": "下一句"},
            ],
            energy_valleys=[
                {"time": 11.95, "rmsDb": -48.0},
                {"time": 14.0, "rmsDb": -24.0},
            ],
        )

        self.assertEqual(boundaries, [(0.0, 11.95), (11.95, 22.0)])
        self.assertTrue(all(3.0 <= end - start <= 15.0 for start, end in boundaries))

    def test_energy_valleys_detect_internal_low_energy_pause(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.wav"
            write_edge_silence_fixture(source)

            valleys = find_energy_valleys(source, [(0.0, 5.5)])

            self.assertTrue(any(2.0 <= item["time"] <= 2.5 for item in valleys))

    def test_existing_manifest_boundaries_are_reused_as_idempotency_authority(self):
        manifest = {
            "clips": [
                {"id": "b", "sourceRange": {"start": 12.0, "end": 20.0}},
                {"id": "a", "sourceRange": {"start": 0.0, "end": 12.0}},
            ]
        }

        self.assertEqual(
            _existing_candidate_boundaries(manifest),
            [(0.0, 12.0), (12.0, 20.0)],
        )

    def test_existing_quarantine_reason_is_normalized_without_compounding(self):
        clip = {
            "qualityGate": {
                "reasons": [
                    "edge_silence_over_150ms",
                    "edge_silence_over_150ms;edge_silence_over_150ms;sensevoice_event_Laughter",
                ]
            },
            "rejectionReason": "edge_silence_over_150ms;sensevoice_event_Laughter",
        }

        self.assertEqual(_existing_quarantine_reason(clip), "sensevoice_event_Laughter")

    def test_quality_report_lists_automatic_candidates_for_manual_review(self):
        manifest = {
            "schemaVersion": 1,
            "source": {"sha256": "a" * 64},
            "emotionAvailability": {"平静": "pending_review"},
            "clips": [
                {
                    "id": "calm-001",
                    "path": "clips/平静/calm-001.wav",
                    "emotion": "平静",
                    "duration": 6.2,
                    "sourceRange": {"start": 60.0, "end": 66.2},
                    "whisperDraft": "待逐字校正文本",
                    "sensevoiceLabel": "neutral",
                    "sensevoiceEvent": "Speech",
                    "qualityGate": {"automaticEligible": True},
                    "reviewStatus": "pending",
                    "intendedUse": "candidate_reference",
                }
            ],
        }

        report = _build_quality_report(manifest)

        self.assertIn("calm-001", report)
        self.assertIn("clips/平静/calm-001.wav", report)
        self.assertIn("待逐字校正文本", report)

    def test_emotion_availability_preserves_human_approval(self):
        clips = [
            {
                "emotion": "平静",
                "intendedUse": "approved_reference",
                "reviewStatus": "approved",
                "humanReview": {"status": "approved"},
            },
            {
                "emotion": "悲伤",
                "intendedUse": "candidate_reference",
                "reviewStatus": "pending",
                "humanReview": {"status": "pending"},
            },
        ]

        availability = _emotion_availability(clips)

        self.assertEqual(availability["平静"], "approved")
        self.assertEqual(availability["悲伤"], "pending_review")
        self.assertEqual(availability["坚定"], "unavailable")

    def test_recut_metadata_survives_idempotent_rebuild(self):
        new_clip = {"reviewStatus": "pending", "humanReview": {"status": "pending"}}
        old_clip = {
            "reviewStatus": "pending",
            "humanReview": {"status": "pending"},
            "recutAttempt": 1,
            "recutRevision": 2,
            "supersedes": ["mucheng-悲伤-002"],
            "selectionNotes": "user_requested_sad_recut",
        }

        preserved = _preserve_review_fields(new_clip, old_clip)

        self.assertEqual(preserved["recutAttempt"], 1)
        self.assertEqual(preserved["recutRevision"], 2)
        self.assertEqual(preserved["supersedes"], ["mucheng-悲伤-002"])

    def test_quarantine_routes_forbidden_window_and_uncertain_expression(self):
        self.assertEqual(
            classify_quarantine(200.0, 204.0),
            (True, "source_window_192.92_221.26"),
        )
        self.assertEqual(
            classify_quarantine(260.0, 264.0, non_speech_heavy=True),
            (True, "non_speech_heavy"),
        )
        self.assertEqual(
            classify_quarantine(60.0, 64.0, uncertain=True),
            (True, "identity_or_background_uncertain"),
        )
        self.assertEqual(classify_quarantine(60.0, 64.0), (False, ""))
        self.assertEqual(sensevoice_quarantine_reason("BGM"), "sensevoice_event_BGM")
        self.assertEqual(sensevoice_quarantine_reason("Laughter"), "sensevoice_event_Laughter")
        self.assertEqual(sensevoice_quarantine_reason("Speech"), "")

    def test_same_sha_file_is_reused_and_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "artifact.wav"
            target.write_bytes(b"stable bytes")
            expected = hashlib.sha256(target.read_bytes()).hexdigest()

            self.assertEqual(ensure_file_matches_or_raise(target, expected), "reused")
            with self.assertRaises(FileConflictError):
                ensure_file_matches_or_raise(target, "f" * 64)
            self.assertEqual(target.read_bytes(), b"stable bytes")

    def test_copy_rejects_bytes_whose_sha_does_not_match_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "artifact.wav"
            expected = hashlib.sha256(b"expected").hexdigest()

            with self.assertRaises(FileConflictError):
                _write_bytes_if_absent(target, b"different", expected)
            self.assertFalse(target.exists())

    def test_existing_clip_path_cannot_escape_library_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "library"
            with self.assertRaises(FileConflictError):
                _confined_library_path(root, "clips/../escape.wav", subtree="clips")

    def test_symlinked_library_subtree_cannot_escape_library_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "library"
            outside = Path(tmp) / "outside"
            root.mkdir()
            outside.mkdir()
            (root / "clips").symlink_to(outside, target_is_directory=True)
            with self.assertRaises(FileConflictError):
                _confined_library_path(root, "clips/clip.wav", subtree="clips")

    def test_atomic_json_reuses_equal_payload_and_rejects_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "manifest.json"
            payload = {"source": {"sha256": "a" * 64}, "processing": {"sampleRate": 24000}}

            atomic_write_json(target, payload)
            self.assertEqual(atomic_write_json(target, payload), "reused")
            before = target.read_bytes()
            with self.assertRaises(FileConflictError):
                atomic_write_json(target, {"different": True})
            self.assertEqual(target.read_bytes(), before)

    def test_materialize_failure_does_not_replace_existing_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "artifact.wav"
            target.write_bytes(b"existing")

            def failing_producer(temp_path: Path):
                temp_path.write_bytes(b"partial")
                raise RuntimeError("producer failed")

            with self.assertRaises(RuntimeError):
                _materialize_from_temp(target, failing_producer)
            self.assertEqual(target.read_bytes(), b"existing")

    def test_generated_sample_gate_checks_cer_terms_and_repetition(self):
        sample = {
            "backend": "qwen-mlx",
            "mocked": False,
            "audioSha256": "a" * 64,
            "audioMetrics": {"clippingDetected": False},
        }
        passing = _evaluate_generated_sample(
            DEFAULT_TEST_TEXT,
            sample,
            {"whisperDraft": DEFAULT_TEST_TEXT},
        )
        repeated = _evaluate_generated_sample(
            DEFAULT_TEST_TEXT,
            sample,
            {"whisperDraft": "终于终于终于"},
        )

        self.assertTrue(passing["passed"])
        self.assertFalse(repeated["passed"])
        self.assertFalse(repeated["noAbnormalRepetition"])
        self.assertIn("事情", repeated["missingCriticalTerms"])
        missing_mocked = _evaluate_generated_sample(
            DEFAULT_TEST_TEXT,
            {"backend": "qwen-mlx", "audioSha256": "a" * 64, "audioMetrics": {"clippingDetected": False}},
            {"whisperDraft": DEFAULT_TEST_TEXT},
        )
        self.assertFalse(missing_mocked["mockedIsFalse"])
        self.assertFalse(missing_mocked["passed"])

    def test_acceptance_text_is_fixed(self):
        from build_voice_clone_library import accept_library

        with self.assertRaises(ValueError):
            accept_library(
                Path("/missing-source.mp3"),
                Path("/private/tmp/mucheng-i1-fixed-text-probe"),
                python_runtime=Path("/missing-python"),
                models_dir=Path("/missing-models"),
                test_text="可替换文本",
                apply=False,
            )

    def test_accept_fails_closed_without_human_reviewed_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "library-manifest.json"
            manifest.write_text('{"clips": []}', encoding="utf-8")
            with self.assertRaises(HumanReviewRequiredError):
                validate_reviewed_references(manifest)

    def test_accept_report_conflict_is_rejected_before_promotion_or_sidecar(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "library"
            root.mkdir(parents=True)
            (root / "library-manifest.json").write_text(
                json.dumps({"source": {"sha256": "a" * 64}, "references": []}),
                encoding="utf-8",
            )
            (root / "acceptance-report.json").write_text(
                json.dumps(
                    {
                        "manifestSha256": "b" * 64,
                        "testText": DEFAULT_TEST_TEXT,
                        "seed": 42,
                    }
                ),
                encoding="utf-8",
            )
            reference = {
                **approved_entry("clips/平静/calm-001.wav", "c" * 64),
                "sourcePath": root / "clips" / "平静" / "calm-001.wav",
                "targetPath": root / "refs" / "木成-平静.wav",
                "metrics": {"sampleRate": 24_000, "channels": 1},
            }

            with (
                mock.patch("build_voice_clone_library.verify_source_sha256", return_value="a" * 64),
                mock.patch("build_voice_clone_library._validate_local_dependencies"),
                mock.patch("build_voice_clone_library.validate_reviewed_references", return_value=[reference]),
                mock.patch("build_voice_clone_library._promote_references") as promote,
                mock.patch("build_voice_clone_library._start_sidecar") as start_sidecar,
            ):
                with self.assertRaises(FileConflictError):
                    accept_library(
                        Path(tmp) / "source.mp3",
                        root,
                        python_runtime=Path(tmp) / "python",
                        models_dir=Path(tmp) / "models",
                        test_text=DEFAULT_TEST_TEXT,
                        apply=True,
                    )

            promote.assert_not_called()
            start_sidecar.assert_not_called()
            self.assertFalse((root / "refs").exists())
            self.assertFalse((root / "acceptance").exists())

    def test_accept_writes_failure_report_for_sidecar_profile_and_generation_errors(self):
        for failure_stage in ("sidecar_start", "profile_create", "generation"):
            with self.subTest(failure_stage=failure_stage), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp) / "library"
                root.mkdir(parents=True)
                (root / "library-manifest.json").write_text(
                    json.dumps({"source": {"sha256": "a" * 64}, "references": []}),
                    encoding="utf-8",
                )
                reference = {
                    **approved_entry("clips/平静/calm-001.wav", "c" * 64),
                    "sourcePath": root / "clips" / "平静" / "calm-001.wav",
                    "targetPath": root / "refs" / "木成-平静.wav",
                    "metrics": {"sampleRate": 24_000, "channels": 1},
                }
                start_effect = PipelineError("sidecar failed") if failure_stage == "sidecar_start" else None
                profile_effect = PipelineError("profile failed") if failure_stage == "profile_create" else None
                generation_effect = PipelineError("generation failed") if failure_stage == "generation" else None

                with (
                    mock.patch("build_voice_clone_library.verify_source_sha256", return_value="a" * 64),
                    mock.patch("build_voice_clone_library._validate_local_dependencies"),
                    mock.patch("build_voice_clone_library.validate_reviewed_references", return_value=[reference]),
                    mock.patch("build_voice_clone_library._promote_references", return_value=[reference]),
                    mock.patch(
                        "build_voice_clone_library._start_sidecar",
                        side_effect=start_effect,
                        return_value=(mock.Mock(pid=123), "token", "http://127.0.0.1:17594"),
                    ),
                    mock.patch("build_voice_clone_library._stop_sidecar"),
                    mock.patch(
                        "build_voice_clone_library._create_profile",
                        side_effect=profile_effect,
                        return_value={"id": "mucheng-calm"},
                    ),
                    mock.patch(
                        "build_voice_clone_library._generate_sample",
                        side_effect=generation_effect,
                    ),
                ):
                    with self.assertRaises(PipelineError):
                        accept_library(
                            Path(tmp) / "source.mp3",
                            root,
                            python_runtime=Path(tmp) / "python",
                            models_dir=Path(tmp) / "models",
                            test_text=DEFAULT_TEST_TEXT,
                            apply=True,
                        )

                report = json.loads((root / "acceptance-report.json").read_text(encoding="utf-8"))
                self.assertEqual(report["status"], "failed")
                self.assertEqual(report["failure"]["stage"], failure_stage)
                self.assertEqual(report["failure"]["errorType"], "PipelineError")
                self.assertEqual(report["conclusions"]["qwenVoiceCloneQualified"], "automatic_gate_failed")

    def test_reviewed_reference_is_remeasured_and_mapped_to_fixed_refs_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "library"
            audio = root / "clips" / "平静" / "calm-001.wav"
            write_fixture_wav(audio)
            entry = approved_entry("clips/平静/calm-001.wav", hashlib.sha256(audio.read_bytes()).hexdigest())
            manifest = root / "library-manifest.json"
            manifest.write_text(json.dumps({"clips": [entry]}), encoding="utf-8")

            references = validate_reviewed_references(manifest)

            self.assertEqual(len(references), 1)
            self.assertEqual(references[0]["targetPath"], root.resolve() / "refs" / "木成-平静.wav")
            self.assertEqual(references[0]["metrics"]["sampleRate"], 24_000)
            self.assertTrue(references[0]["humanReview"]["identityConfirmed"])
            _promote_references(manifest, references)
            promoted = json.loads(manifest.read_text(encoding="utf-8"))["references"][0]
            self.assertEqual(promoted["sourceRange"], {"start": 60.0, "end": 63.2})

    def test_reviewed_reference_outside_library_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "library"
            outside = Path(tmp) / "outside.wav"
            write_fixture_wav(outside)
            entry = approved_entry(str(outside), hashlib.sha256(outside.read_bytes()).hexdigest())
            root.mkdir(parents=True)
            manifest = root / "library-manifest.json"
            manifest.write_text(json.dumps({"references": [entry]}), encoding="utf-8")

            with self.assertRaises(FileConflictError):
                validate_reviewed_references(manifest)

    def test_reviewed_reference_requires_declared_sha_and_source_range(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "library"
            audio = root / "clips" / "平静" / "calm-001.wav"
            write_fixture_wav(audio)
            entry = approved_entry("clips/平静/calm-001.wav", "")
            manifest = root / "library-manifest.json"
            manifest.parent.mkdir(parents=True, exist_ok=True)
            manifest.write_text(json.dumps({"clips": [entry]}, ensure_ascii=False), encoding="utf-8")

            with self.assertRaises(FileConflictError):
                validate_reviewed_references(manifest)

            entry["sha256"] = hashlib.sha256(audio.read_bytes()).hexdigest()
            entry.pop("sourceRange")
            manifest.write_text(json.dumps({"clips": [entry]}, ensure_ascii=False), encoding="utf-8")
            with self.assertRaises(HumanReviewRequiredError):
                validate_reviewed_references(manifest)


if __name__ == "__main__":
    unittest.main()
