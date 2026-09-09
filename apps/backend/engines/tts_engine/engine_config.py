"""Constants and configuration for the TTS engine.

Extracted from ``engine.py`` to reduce file size.  Contains model repo IDs,
sample rates, language mappings, and the retryable-engine set.  **Does not**
contain the mutable global model-cache variables — those remain in
``engine.py`` because cross-module ``global`` is not possible in Python.
"""

from __future__ import annotations

KOKORO_REPO_ID = "hexgrad/Kokoro-82M"
KOKORO_SAMPLE_RATE = 24000
KOKORO_LANG_CODES = {
    "en": "a",
    "es": "e",
    "fr": "f",
    "hi": "h",
    "it": "i",
    "pt": "p",
    "ja": "j",
    "zh": "z",
}
KOKORO_DEFAULT_VOICES = {
    "en": "af_heart",
    "es": "ef_dora",
    "fr": "ff_siwis",
    "hi": "hf_alpha",
    "it": "if_sara",
    "pt": "pf_dora",
    "ja": "jf_alpha",
    "zh": "zf_xiaobei",
}

QWEN_MLX_REPOS = {
    "1.7B": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
    "0.6B": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
}
QWEN_PYTORCH_REPOS = {
    "1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    "0.6B": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
}
QWEN_CUSTOM_VOICE_REPOS = {
    "1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "0.6B": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
}
QWEN_CUSTOM_DEFAULT_SPEAKER = "Ryan"
LANGUAGE_CODE_TO_NAME = {
    "zh": "chinese",
    "en": "english",
    "ja": "japanese",
    "ko": "korean",
    "de": "german",
    "fr": "french",
    "ru": "russian",
    "pt": "portuguese",
    "es": "spanish",
    "it": "italian",
}

_RETRYABLE_REAL_ENGINES = {"qwen", "qwen_custom_voice", "kokoro"}
