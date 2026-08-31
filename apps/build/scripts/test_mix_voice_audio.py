from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def load_module():
    path = Path(__file__).with_name("mix-voice-audio.py")
    spec = importlib.util.spec_from_file_location("mix_voice_audio", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载脚本: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIX = load_module()


def write_ledger(root: Path, shot_id: str = "sb-1", index: int = 1, data: bytes = b"wav") -> Path:
    relative = f"remotion/audio/chapter-001/shots/{shot_id}/voice/"
    digest = hashlib.sha256(data).hexdigest()
    audio_path = root / relative / f"{digest}.wav"
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    audio_path.write_bytes(data)
    ledger_path = root / "remotion" / "audio-ledger" / "chapter-001.json"
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger_path.write_text(json.dumps({
        "shots": [{
            "shotId": shot_id,
            "manifestIndex": index,
            "shotStartUs": 1_000_000,
            "durationUs": 2_000_000,
            "audio": {"relativePath": relative + f"{digest}.wav", "sha256": digest},
        }],
    }), encoding="utf-8")
    return ledger_path


class MixVoiceAudioTest(unittest.TestCase):
    def test_project_root_uses_explicit_project_and_requires_remotion(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "remotion").mkdir()
            with patch.dict(os.environ, {"MYSTUDIO_PROJECT_DIR": str(root)}, clear=False):
                self.assertEqual(MIX.resolve_project_root(), root.resolve())

    def test_ledger_accepts_current_project_audio_and_verifies_sha(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ledger = write_ledger(root)
            sources = MIX.load_ledger_voice_paths(root, ledger)
            self.assertEqual(sources["sb-1"].path.parent.name, "voice")
            self.assertEqual(sources["index:1"].path, sources["sb-1"].path)

    def test_ledger_rejects_path_escape_and_sha_drift(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ledger = write_ledger(root)
            payload = json.loads(ledger.read_text(encoding="utf-8"))
            payload["shots"][0]["audio"]["relativePath"] = "remotion/audio/../../outside.wav"
            ledger.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "路径越界"):
                MIX.load_ledger_voice_paths(root, ledger)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ledger = write_ledger(root)
            payload = json.loads(ledger.read_text(encoding="utf-8"))
            payload["shots"][0]["audio"]["sha256"] = "0" * 64
            ledger.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "SHA-256 不匹配"):
                MIX.load_ledger_voice_paths(root, ledger)

    def test_ledger_rejects_symlink_escape(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside_temp:
            root = Path(temp)
            outside = Path(outside_temp) / "outside.wav"
            data = b"outside wav"
            outside.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            relative = f"remotion/audio/chapter-001/shots/sb-1/voice/{digest}.wav"
            link = root / relative
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to(outside)
            ledger = root / "remotion" / "audio-ledger" / "chapter-001.json"
            ledger.parent.mkdir(parents=True, exist_ok=True)
            ledger.write_text(json.dumps({
                "shots": [{
                    "shotId": "sb-1",
                    "manifestIndex": 1,
                    "shotStartUs": 0,
                    "durationUs": 1_000_000,
                    "audio": {"relativePath": relative, "sha256": digest},
                }],
            }), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "路径越界"):
                MIX.load_ledger_voice_paths(root, ledger)

    def test_runtime_paths_reject_out_of_project_override(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside_temp:
            root = Path(temp)
            (root / "remotion").mkdir()
            outside = Path(outside_temp) / "ledger.json"
            with patch.dict(os.environ, {"MYSTUDIO_MIX_LEDGER_PATH": str(outside)}, clear=False):
                with self.assertRaisesRegex(RuntimeError, "路径越界"):
                    MIX.resolve_runtime_paths(root, "chapter-001")

    def test_build_voice_clips_aligns_ledger_to_visual_evidence_without_string_guessing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ledger = write_ledger(root)
            sources = MIX.load_ledger_voice_paths(root, ledger)
            clips = MIX.build_voice_clips({
                "clips": [{
                    "trackKind": "video",
                    "startUs": 3_000_000,
                    "durationUs": 4_000_000,
                    "source": {"evidence": {"storyboardId": "sb-1"}},
                }],
            }, sources)
            self.assertEqual([(item[0].shot_id, item[1], item[2]) for item in clips], [
                ("sb-1", 3_000_000, 4_000_000),
            ])

    def test_explicit_voice_clip_requires_matching_ledger_shot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ledger = write_ledger(root)
            sources = MIX.load_ledger_voice_paths(root, ledger)
            with self.assertRaisesRegex(RuntimeError, "无对应 shot"):
                MIX.build_voice_clips({
                    "clips": [{
                        "trackKind": "voice",
                        "id": "voice-unknown",
                        "startUs": 0,
                        "durationUs": 1_000_000,
                        "source": {"evidence": {"storyboardId": "sb-unknown"}},
                    }],
                }, sources)

    def test_explicit_voice_clip_uses_ledger_source_and_plan_timing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            ledger = write_ledger(root)
            sources = MIX.load_ledger_voice_paths(root, ledger)
            clips = MIX.build_voice_clips({
                "clips": [{
                    "trackKind": "voice",
                    "id": "voice-sb-1",
                    "startUs": 2_000_000,
                    "durationUs": 750_000,
                    "source": {"evidence": {"storyboardId": "sb-1"}},
                }],
            }, sources)
            self.assertEqual([(item[0].shot_id, item[1], item[2]) for item in clips], [
                ("sb-1", 2_000_000, 750_000),
            ])


if __name__ == "__main__":
    unittest.main()
