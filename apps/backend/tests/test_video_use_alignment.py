import hashlib
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from video_use.alignment import (
    AlignmentError,
    _merge_zero_length_timings,
    align_audio_text,
    build_canonical_alignment,
    sha256_file,
    sha256_text,
)


class Timing:
    def __init__(self, word: str, start: float, end: float, probability: float = 0.9):
        self.word = word
        self.start = start
        self.end = end
        self.probability = probability


class VideoUseAlignmentTest(unittest.TestCase):
    def test_mlx_alignment_uses_fixed_input_private_heads_and_merges_zero_length_punctuation(self):
        modules = {
            name: ModuleType(name)
            for name in (
                "mlx_audio",
                "mlx_audio.stt",
                "mlx_audio.stt.models",
                "mlx_audio.stt.models.whisper",
                "mlx_audio.stt.models.whisper.audio",
                "mlx_audio.stt.models.whisper.timing",
                "mlx_audio.stt.utils",
            )
        }
        calls = {}
        audio_module = modules["mlx_audio.stt.models.whisper.audio"]
        audio_module.HOP_LENGTH = 160
        audio_module.N_FRAMES = 3000
        audio_module.N_SAMPLES = 480_000

        def pad_or_trim(waveform, length):
            calls["padLength"] = length
            return waveform

        audio_module.pad_or_trim = pad_or_trim
        audio_module.log_mel_spectrogram = lambda waveform, n_mels, padding: calls.update(
            {"melShape": getattr(waveform, "shape", None), "nMels": n_mels, "padding": padding},
        ) or "fixed-mel"
        modules["mlx_audio.stt.utils"].load_audio = lambda _path: SimpleNamespace(shape=(16_000,))

        class FakeTiming:
            def __init__(self, word, start, end, probability):
                self.word = word
                self.start = start
                self.end = end
                self.probability = probability

        timing_module = modules["mlx_audio.stt.models.whisper.timing"]
        timing_module.find_alignment = lambda model, _tokenizer, _tokens, mel, content_frames: calls.update(
            {"mel": mel, "contentFrames": content_frames, "hasPublicHeads": hasattr(model, "alignment_heads")},
        ) or [FakeTiming("甲", 0.0, 0.1, 0.9), FakeTiming("！", 0.1, 0.1, 0.8)]

        def merge_punctuations(timings, _prepended, *, appended):
            calls["mergedPunctuation"] = True
            timings[0].word += timings[1].word
            timings[1].word = ""

        timing_module.merge_punctuations = merge_punctuations

        class FakeTokenizer:
            def encode(self, _text):
                return [1, 2]

        class FakeModel:
            dims = SimpleNamespace(n_mels=80)
            _alignment_heads = "private-heads"

            def get_tokenizer(self, **_kwargs):
                return FakeTokenizer()

        with tempfile.TemporaryDirectory() as tmp:
            audio_path = Path(tmp) / "shot.wav"
            audio_path.write_bytes(b"wav")
            with patch.dict(sys.modules, modules):
                result = align_audio_text(
                    audio_path,
                    "甲！",
                    duration_s=1.0,
                    model_loader=lambda _model, _tokenizer: FakeModel(),
                )

        self.assertEqual(result["text"], "甲！")
        self.assertEqual([word["text"] for word in result["words"]], ["甲！"])
        self.assertEqual(calls["padLength"], 480_000)
        self.assertEqual(calls["mel"], "fixed-mel")
        self.assertEqual(calls["contentFrames"], 100)
        self.assertTrue(calls["hasPublicHeads"])
        self.assertTrue(calls["mergedPunctuation"])

    def test_alignment_preserves_canonical_text_and_builds_sentence_cues(self):
        text = "第一句。第二句！"
        timings = [
            Timing("第", 0.0, 0.1),
            Timing("一", 0.1, 0.2),
            Timing("句", 0.2, 0.3),
            Timing("。", 0.3, 0.35),
            Timing("第", 0.4, 0.5),
            Timing("二", 0.5, 0.6),
            Timing("句", 0.6, 0.7),
            Timing("！", 0.7, 0.75),
        ]

        result = build_canonical_alignment(text, timings, duration_s=1.0)

        self.assertEqual(result["text"], text)
        self.assertEqual("".join(word["text"] for word in result["words"]), text)
        self.assertEqual([cue["text"] for cue in result["sentences"]], ["第一句。", "第二句！"])
        self.assertEqual(result["sentences"][0]["startS"], 0.0)
        self.assertEqual(result["sentences"][1]["endS"], 0.75)

    def test_zero_length_non_punctuation_inherits_next_interval_without_inventing_time(self):
        timings = [Timing("甲", 0.0, 0.1), Timing("乙", 0.1, 0.1), Timing("丙", 0.1, 0.3)]

        normalized = _merge_zero_length_timings(timings)
        result = build_canonical_alignment("甲乙丙", normalized, duration_s=0.5)

        self.assertEqual([word["text"] for word in result["words"]], ["甲", "乙丙"])
        self.assertEqual(result["words"][1]["startS"], 0.1)
        self.assertEqual(result["words"][1]["endS"], 0.3)

    def test_punctuation_only_sentence_attaches_to_previous_cue(self):
        result = build_canonical_alignment(
            "甲？……",
            [Timing("甲？……", 0.0, 0.2)],
            duration_s=0.5,
        )

        self.assertEqual([cue["text"] for cue in result["sentences"]], ["甲？……"])

    def test_alignment_rejects_asr_text_that_would_rewrite_tts_text(self):
        with self.assertRaises(AlignmentError) as context:
            build_canonical_alignment("原文", [Timing("改文", 0.0, 0.2)])
        self.assertEqual(context.exception.code, "canonical-text-mismatch")

    def test_alignment_rejects_non_monotonic_and_out_of_range_timings(self):
        with self.assertRaises(AlignmentError) as overlap:
            build_canonical_alignment("甲乙", [Timing("甲", 0.4, 0.8), Timing("乙", 0.7, 0.9)])
        self.assertEqual(overlap.exception.code, "alignment-not-monotonic")

        with self.assertRaises(AlignmentError) as out_of_range:
            build_canonical_alignment("甲", [Timing("甲", 0.0, 1.1)], duration_s=1.0)
        self.assertEqual(out_of_range.exception.code, "alignment-out-of-range")

    def test_text_hash_is_utf8_stable(self):
        text = "本地 TTS 原文"
        self.assertEqual(sha256_text(text), hashlib.sha256(text.encode("utf-8")).hexdigest())

    def test_wav_path_can_be_hashed_without_loading_the_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            wav_path = Path(tmp) / "shot.wav"
            with wave.open(str(wav_path), "wb") as stream:
                stream.setnchannels(1)
                stream.setsampwidth(2)
                stream.setframerate(16_000)
                stream.writeframes(b"\0\0" * 160)
            self.assertEqual(wav_path.stat().st_size, 364)
            self.assertEqual(len(sha256_file(wav_path)), 64)


if __name__ == "__main__":
    unittest.main()
