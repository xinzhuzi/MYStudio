"""Unit tests for engine.py pure utility functions and uncovered adapters.

These tests supplement test_tts_contract.py by covering functions that
previously had no direct test protection: split_text_into_chunks,
_join_wavs, _write_float_wav, resolve_emotion_capability edge cases,
_custom_voice_request/_custom_voice_instruct, _adapt_mlx_generation_results
error branches, and the kokoro/qwen-mlx/qwen-pytorch (non-custom-voice)
adapters.
"""

from __future__ import annotations

import struct
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np

import tts.engine as engine_module
from tts.engine import (
    SynthesisResult,
    _adapt_mlx_generation_results,
    _custom_voice_instruct,
    _custom_voice_request,
    _join_wavs,
    _write_float_wav,
    resolve_emotion_capability,
    split_text_into_chunks,
)


class SplitTextIntoChunksTest(unittest.TestCase):
    def test_empty_text_raises(self):
        with self.assertRaises(ValueError):
            split_text_into_chunks("")

    def test_whitespace_only_raises(self):
        with self.assertRaises(ValueError):
            split_text_into_chunks("   \n\t ")

    def test_short_text_returns_single_chunk(self):
        result = split_text_into_chunks("hello", 800)
        self.assertEqual(result, ["hello"])

    def test_splits_on_sentence_boundary(self):
        text = "第一句。第二句。第三句。"
        # Force small max to trigger splitting
        result = split_text_into_chunks(text, 5)
        self.assertGreater(len(result), 1)
        self.assertEqual("".join(result).replace("。", ""), text.replace("。", ""))

    def test_splits_on_clause_boundary_when_no_sentence(self):
        text = "part one；part two；part three"
        result = split_text_into_chunks(text, 12)
        self.assertGreater(len(result), 1)

    def test_hard_splits_when_no_delimiter(self):
        text = "abcdefghij"
        result = split_text_into_chunks(text, 4)
        self.assertGreater(len(result), 1)
        self.assertEqual("".join(result), text)

    def test_invalid_max_chars_raises(self):
        with self.assertRaises(ValueError):
            split_text_into_chunks("text", 0)


class JoinWavsTest(unittest.TestCase):
    def _write_test_wav(self, path: Path, samples: bytes, sample_rate: int = 24000):
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(samples)

    def test_single_part_copies_directly(self):
        with tempfile.TemporaryDirectory() as tmp:
            part = Path(tmp) / "part.wav"
            output = Path(tmp) / "out.wav"
            samples = struct.pack("<2h", 100, -100)
            self._write_test_wav(part, samples)
            duration = _join_wavs([part], output, 50)
            self.assertEqual(duration, 2 / 24000)
            with wave.open(str(output), "rb") as wav:
                self.assertEqual(wav.getnframes(), 2)

    def test_multiple_parts_with_crossfade(self):
        with tempfile.TemporaryDirectory() as tmp:
            parts = []
            for i in range(2):
                p = Path(tmp) / f"part-{i}.wav"
                self._write_test_wav(p, struct.pack("<4h", 100, 200, 300, 400))
                parts.append(p)
            output = Path(tmp) / "out.wav"
            duration = _join_wavs(parts, output, crossfade_ms=0)
            self.assertGreater(duration, 0)
            with wave.open(str(output), "rb") as wav:
                self.assertGreater(wav.getnframes(), 4)

    def test_empty_parts_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.wav"
            with self.assertRaises(RuntimeError):
                _join_wavs([], output, 50)


class WriteFloatWavTest(unittest.TestCase):
    def test_writes_mono_pcm16(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.wav"
            samples = np.array([0.5, -0.5, 1.0, -1.0], dtype=np.float32)
            _write_float_wav(output, samples, 24000)
            with wave.open(str(output), "rb") as wav:
                self.assertEqual(wav.getnchannels(), 1)
                self.assertEqual(wav.getsampwidth(), 2)
                self.assertEqual(wav.getframerate(), 24000)
                self.assertEqual(wav.getnframes(), 4)

    def test_clips_super_range_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.wav"
            samples = np.array([2.0, -2.0], dtype=np.float32)
            _write_float_wav(output, samples, 24000)
            with wave.open(str(output), "rb") as wav:
                data = wav.readframes(2)
                values = struct.unpack("<2h", data)
                self.assertEqual(values[0], 32767)
                self.assertEqual(values[1], -32767)


class ResolveEmotionCapabilityTest(unittest.TestCase):
    def test_not_requested_when_nothing_passed(self):
        cap, warning = resolve_emotion_capability("qwen")
        self.assertEqual(cap, "not-requested")
        self.assertIsNone(warning)

    def test_applied_for_qwen_custom_voice(self):
        cap, _ = resolve_emotion_capability("qwen_custom_voice", emotion="紧张")
        self.assertEqual(cap, "applied")

    def test_metadata_only_for_qwen(self):
        cap, warning = resolve_emotion_capability("qwen", voice_style="紧张风格")
        self.assertEqual(cap, "metadata-only")
        self.assertIsNotNone(warning)

    def test_metadata_only_for_kokoro(self):
        cap, _ = resolve_emotion_capability("kokoro", emotion="悲伤")
        self.assertEqual(cap, "metadata-only")

    def test_unsupported_for_unknown_engine(self):
        cap, _ = resolve_emotion_capability("luxtts", emotion="兴奋")
        self.assertEqual(cap, "unsupported")


class CustomVoiceInstructTest(unittest.TestCase):
    def test_none_when_no_instruct_or_emotion(self):
        self.assertIsNone(_custom_voice_instruct({}, None, None))

    def test_combines_profile_and_dynamic(self):
        result = _custom_voice_instruct(
            {"instruct": "保持冷静"},
            "紧张",
            "快速",
        )
        self.assertIn("保持冷静", result)
        self.assertIn("逐镜情绪：紧张", result)
        self.assertIn("逐镜风格：快速", result)

    def test_dynamic_only(self):
        result = _custom_voice_instruct({}, "紧张", None)
        self.assertEqual(result, "逐镜情绪：紧张")


class CustomVoiceRequestTest(unittest.TestCase):
    def test_builds_request_with_defaults(self):
        req = _custom_voice_request("hello", {}, "zh", None, None)
        self.assertEqual(req["text"], "hello")
        self.assertEqual(req["language"], "Chinese")
        self.assertEqual(req["speaker"], "Ryan")
        self.assertNotIn("instruct", req)

    def test_includes_instruct_when_present(self):
        req = _custom_voice_request("hello", {"preset_voice_id": "Bob"}, "en", "紧张", None)
        self.assertEqual(req["speaker"], "Bob")
        self.assertEqual(req["language"], "English")
        self.assertIn("instruct", req)
        self.assertIn("逐镜情绪：紧张", req["instruct"])


class AdaptMlxGenerationResultsTest(unittest.TestCase):
    def test_collects_audio_chunks(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.wav"
            results = [
                SimpleNamespace(audio=np.array([0.1, 0.2], dtype=np.float32), sample_rate=24000),
                SimpleNamespace(audio=np.array([0.3, 0.4], dtype=np.float32), sample_rate=24000),
            ]
            result = _adapt_mlx_generation_results(output, results)
            self.assertEqual(result.backend, "qwen-custom-voice")
            self.assertFalse(result.mocked)
            self.assertEqual(result.duration, 4 / 24000)

    def test_raises_on_mismatched_sample_rate(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.wav"
            results = [
                SimpleNamespace(audio=np.array([0.1], dtype=np.float32), sample_rate=24000),
                SimpleNamespace(audio=np.array([0.2], dtype=np.float32), sample_rate=22050),
            ]
            with self.assertRaises(RuntimeError):
                _adapt_mlx_generation_results(output, results)

    def test_raises_on_empty_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.wav"
            results = [SimpleNamespace(audio=None, sample_rate=24000)]
            with self.assertRaises(RuntimeError):
                _adapt_mlx_generation_results(output, results)

    def test_raises_on_invalid_sample_rate(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "out.wav"
            results = [SimpleNamespace(audio=np.array([0.1], dtype=np.float32), sample_rate=0)]
            with self.assertRaises(RuntimeError):
                _adapt_mlx_generation_results(output, results)


class GenerateKokoroTest(unittest.TestCase):
    """Cover _generate_kokoro by mocking the kokoro library."""

    def setUp(self):
        # Reset global state before each test
        engine_module._kokoro_model = None
        engine_module._kokoro_pipelines.clear()

    def tearDown(self):
        engine_module._kokoro_model = None
        engine_module._kokoro_pipelines.clear()

    def test_loads_model_and_generates_audio(self):
        fake_model = MagicMock()
        fake_pipeline = MagicMock()
        fake_pipeline.return_value = [SimpleNamespace(audio=np.array([0.1, 0.2], dtype=np.float32))]

        fake_kokoro = types_module = type("kokoro", (), {"KModel": MagicMock(return_value=fake_model), "KPipeline": MagicMock(return_value=fake_pipeline)})
        fake_torch = MagicMock()
        fake_torch.cuda.is_available.return_value = False

        with patch.dict("sys.modules", {"kokoro": fake_kokoro, "torch": fake_torch}):
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "out.wav"
                result = engine_module._generate_kokoro(output, "hello", {"language": "en"}, "en", 42)
                self.assertEqual(result.backend, "kokoro")
                self.assertFalse(result.mocked)
                self.assertGreater(result.duration, 0)
                self.assertTrue(output.exists())
                # Model was cached
                self.assertIsNotNone(engine_module._kokoro_model)


class GenerateQwenMlxTest(unittest.TestCase):
    """Cover _generate_qwen_mlx (non-custom-voice) by mocking mlx_audio."""

    def setUp(self):
        engine_module._qwen_model = None
        engine_module._qwen_backend = None
        engine_module._qwen_model_size = None

    def tearDown(self):
        engine_module._qwen_model = None
        engine_module._qwen_backend = None
        engine_module._qwen_model_size = None

    def test_loads_and_generates(self):
        fake_model = MagicMock()
        fake_model.generate.return_value = iter([
            SimpleNamespace(audio=np.array([0.1, 0.2], dtype=np.float32), sample_rate=24000),
        ])

        fake_mlx_audio = type("mlx_audio", (), {})
        fake_mlx_audio.tts = type("tts", (), {"load": MagicMock(return_value=fake_model)})

        with patch.dict("sys.modules", {"mlx_audio": fake_mlx_audio, "mlx_audio.tts": fake_mlx_audio.tts}):
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "out.wav"
                ref_audio = Path(tmp) / "ref.wav"
                _write_float_wav(ref_audio, np.array([0.1], dtype=np.float32), 24000)
                result = engine_module._generate_qwen_mlx(output, "hello", str(ref_audio), "ref text", "0.6B", "zh", None)
                self.assertEqual(result.backend, "qwen-mlx")
                self.assertFalse(result.mocked)
                self.assertTrue(output.exists())

    def test_raises_on_empty_audio(self):
        fake_model = MagicMock()
        fake_model.generate.return_value = iter([])

        fake_mlx_audio = type("mlx_audio", (), {})
        fake_mlx_audio.tts = type("tts", (), {"load": MagicMock(return_value=fake_model)})

        with patch.dict("sys.modules", {"mlx_audio": fake_mlx_audio, "mlx_audio.tts": fake_mlx_audio.tts}):
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "out.wav"
                ref_audio = Path(tmp) / "ref.wav"
                _write_float_wav(ref_audio, np.array([0.1], dtype=np.float32), 24000)
                with self.assertRaises(RuntimeError):
                    engine_module._generate_qwen_mlx(output, "hello", str(ref_audio), "ref", "0.6B", "zh", None)


class GenerateQwenPytorchTest(unittest.TestCase):
    """Cover _generate_qwen_pytorch (non-custom-voice) by mocking qwen_tts/torch."""

    def setUp(self):
        engine_module._qwen_model = None
        engine_module._qwen_backend = None
        engine_module._qwen_model_size = None

    def tearDown(self):
        engine_module._qwen_model = None
        engine_module._qwen_backend = None
        engine_module._qwen_model_size = None

    def test_loads_and_generates(self):
        fake_model = MagicMock()
        fake_model.create_voice_clone_prompt.return_value = "prompt"
        fake_model.generate_voice_clone.return_value = ([np.array([0.1, 0.2], dtype=np.float32)], 24000)

        fake_qwen_tts = type("qwen_tts", (), {})
        fake_qwen_tts.Qwen3TTSModel = MagicMock()
        fake_qwen_tts.Qwen3TTSModel.from_pretrained.return_value = fake_model

        fake_torch = MagicMock()
        fake_torch.cuda.is_available.return_value = False
        fake_torch.float32 = "float32"

        with patch.dict("sys.modules", {"qwen_tts": fake_qwen_tts, "torch": fake_torch}):
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "out.wav"
                ref_audio = Path(tmp) / "ref.wav"
                _write_float_wav(ref_audio, np.array([0.1], dtype=np.float32), 24000)
                result = engine_module._generate_qwen_pytorch(output, "hello", str(ref_audio), "ref", "0.6B", "zh", None)
                self.assertEqual(result.backend, "qwen-pytorch")
                self.assertFalse(result.mocked)
                self.assertTrue(output.exists())

    def test_raises_on_empty_audio(self):
        fake_model = MagicMock()
        fake_model.create_voice_clone_prompt.return_value = "prompt"
        fake_model.generate_voice_clone.return_value = ([], 24000)

        fake_qwen_tts = type("qwen_tts", (), {})
        fake_qwen_tts.Qwen3TTSModel = MagicMock()
        fake_qwen_tts.Qwen3TTSModel.from_pretrained.return_value = fake_model

        fake_torch = MagicMock()
        fake_torch.cuda.is_available.return_value = False
        fake_torch.float32 = "float32"

        with patch.dict("sys.modules", {"qwen_tts": fake_qwen_tts, "torch": fake_torch}):
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "out.wav"
                ref_audio = Path(tmp) / "ref.wav"
                _write_float_wav(ref_audio, np.array([0.1], dtype=np.float32), 24000)
                with self.assertRaises(RuntimeError):
                    engine_module._generate_qwen_pytorch(output, "hello", str(ref_audio), "ref", "0.6B", "zh", None)


if __name__ == "__main__":
    unittest.main()
