import json
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from video_use import worker


class VideoUseWorkerTest(unittest.TestCase):
    def test_probe_fails_closed_without_pinned_upstream(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch("builtins.print") as printer:
                self.assertEqual(worker._probe(), 2)
            payload = json.loads(printer.call_args.args[0])
            self.assertEqual(payload["status"], "needs-upstream")

    def test_run_writes_blocked_record_instead_of_fake_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_path = root / "input.json"
            output_path = root / "output.json"
            input_path.write_text(json.dumps({"projectId": "p1"}), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(worker._run(input_path, output_path), 2)
            result = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["code"], "upstream-runtime-missing")

    def _prepared_upstream(self, root: Path) -> Path:
        upstream = root / "upstream"
        helper_paths = (
            "helpers/render.py",
            "helpers/grade.py",
            "helpers/timeline_view.py",
            "helpers/pack_transcripts.py",
        )
        hashes = {}
        for relative_path in helper_paths:
            helper = upstream / relative_path
            helper.parent.mkdir(parents=True, exist_ok=True)
            helper.write_text(f"# {relative_path}\n", encoding="utf-8")
            hashes[relative_path] = hashlib.sha256(helper.read_bytes()).hexdigest()
        (upstream / worker.UPSTREAM_MANIFEST_NAME).write_text(json.dumps({
            "schemaVersion": 1,
            "sourceUrl": worker.UPSTREAM_SOURCE_URL,
            "sourceCommit": worker.UPSTREAM_COMMIT,
            "helperSha256": hashes,
        }), encoding="utf-8")
        return upstream

    def test_probe_blocks_mismatched_commit_before_worker_enablement(self):
        with tempfile.TemporaryDirectory() as tmp:
            upstream = Path(tmp) / "upstream"
            upstream.mkdir()
            (upstream / worker.UPSTREAM_MANIFEST_NAME).write_text(json.dumps({
                "schemaVersion": 1,
                "sourceUrl": worker.UPSTREAM_SOURCE_URL,
                "sourceCommit": "0" * 40,
                "helperSha256": {},
            }), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                with patch("builtins.print") as printer:
                    self.assertEqual(worker._probe(upstream_root=str(upstream)), 2)
            payload = json.loads(printer.call_args.args[0])
            self.assertEqual(payload["code"], "upstream-manifest-mismatch")

    def test_probe_blocks_missing_required_helper(self):
        with tempfile.TemporaryDirectory() as tmp:
            upstream = Path(tmp) / "upstream"
            upstream.mkdir()
            (upstream / worker.UPSTREAM_MANIFEST_NAME).write_text(json.dumps({
                "schemaVersion": 1,
                "sourceUrl": worker.UPSTREAM_SOURCE_URL,
                "sourceCommit": worker.UPSTREAM_COMMIT,
                "helperSha256": {},
            }), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                with patch("builtins.print") as printer:
                    self.assertEqual(worker._probe(upstream_root=str(upstream)), 2)
            payload = json.loads(printer.call_args.args[0])
            self.assertEqual(payload["code"], "upstream-helper-missing")

    def test_validated_upstream_requires_alignment_before_adapter(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            upstream = self._prepared_upstream(root)
            input_path = root / "input.json"
            output_path = root / "output.json"
            input_path.write_text(json.dumps({"projectId": "p1"}), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(worker._run(
                    input_path,
                    output_path,
                    upstream_root=str(upstream),
                    profile_path=None,
                    ffmpeg_path="/shared/ffmpeg",
                    ffprobe_path="/shared/ffprobe",
                ), 2)
            result = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(result["code"], "alignment-missing")

    def test_run_writes_adapter_artifact_after_alignment(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            upstream = self._prepared_upstream(root)
            input_path = root / "input.json"
            alignment_path = root / "alignment.json"
            output_path = root / "output.json"
            request = {"projectId": "p1", "chapterId": "c1", "revision": 1}
            input_path.write_text(json.dumps(request), encoding="utf-8")
            alignment_path.write_text(json.dumps({"status": "ready"}), encoding="utf-8")
            artifact = {"status": "pending", "stage": "awaiting-review", "schemaVersion": 1}
            with patch.dict(os.environ, {}, clear=True), patch(
                "video_use.worker.run_pinned_adapter", return_value=artifact
            ) as adapter:
                self.assertEqual(worker._run(
                    input_path,
                    output_path,
                    upstream_root=str(upstream),
                    ffmpeg_path="/shared/ffmpeg",
                    ffprobe_path="/shared/ffprobe",
                    alignment_path=str(alignment_path),
                ), 0)
            self.assertEqual(json.loads(output_path.read_text(encoding="utf-8")), artifact)
            adapter.assert_called_once()

    def test_adapter_failure_is_persisted_as_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            upstream = self._prepared_upstream(root)
            input_path = root / "input.json"
            alignment_path = root / "alignment.json"
            output_path = root / "output.json"
            input_path.write_text(json.dumps({"projectId": "p1"}), encoding="utf-8")
            alignment_path.write_text(json.dumps({"status": "ready"}), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True), patch(
                "video_use.worker.run_pinned_adapter",
                side_effect=worker.VideoUseAdapterError("shared-tool-missing", "共享 FFmpeg/ffprobe 文件不存在"),
            ):
                self.assertEqual(worker._run(
                    input_path,
                    output_path,
                    upstream_root=str(upstream),
                    ffmpeg_path="/shared/ffmpeg",
                    ffprobe_path="/shared/ffprobe",
                    alignment_path=str(alignment_path),
                ), 2)
            result = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["code"], "shared-tool-missing")

    def test_profile_marker_can_supply_upstream_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            upstream = self._prepared_upstream(root)
            profile_path = root / "profile.json"
            profile_path.write_text(json.dumps({"sourceCommit": worker.UPSTREAM_COMMIT, "upstreamRoot": str(upstream)}), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                with patch("builtins.print") as printer:
                    self.assertEqual(worker._probe(profile_path=str(profile_path)), 0)
            payload = json.loads(printer.call_args.args[0])
            self.assertEqual(payload["status"], "ready")
            self.assertEqual(payload["upstreamRoot"], str(upstream))

    def test_profile_marker_without_commit_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            upstream = self._prepared_upstream(root)
            profile_path = root / "profile.json"
            profile_path.write_text(json.dumps({"upstreamRoot": str(upstream)}), encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                with patch("builtins.print") as printer:
                    self.assertEqual(worker._probe(profile_path=str(profile_path)), 2)
            payload = json.loads(printer.call_args.args[0])
            self.assertEqual(payload["code"], "profile-commit-mismatch")
