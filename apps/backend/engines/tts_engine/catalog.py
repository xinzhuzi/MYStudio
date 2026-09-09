from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TtsModel:
    model_name: str
    display_name: str
    engine: str
    hf_repo_id: str
    model_size: str | None
    size_mb: int
    languages: tuple[str, ...]
    purpose: str
    description: str
    supports_instruct: bool = False


QWEN_LANGUAGES = ("zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it")

TTS_MODELS: tuple[TtsModel, ...] = (
    TtsModel(
        "qwen-tts-1.7B",
        "Qwen TTS 1.7B",
        "qwen",
        "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
        "1.7B",
        3500,
        QWEN_LANGUAGES,
        "voiceClone",
        "Qwen3-TTS base model for multilingual voice cloning.",
    ),
    TtsModel(
        "qwen-tts-0.6B",
        "Qwen TTS 0.6B",
        "qwen",
        "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
        "0.6B",
        1200,
        QWEN_LANGUAGES,
        "voiceClone",
        "Lightweight Qwen3-TTS model for local narrator generation.",
    ),
    TtsModel(
        "qwen-custom-voice-1.7B",
        "Qwen CustomVoice 1.7B",
        "qwen_custom_voice",
        "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        "1.7B",
        3500,
        QWEN_LANGUAGES,
        "presetVoice",
        "Qwen3-TTS preset voices with instruct-based style control.",
        True,
    ),
    TtsModel(
        "qwen-custom-voice-0.6B",
        "Qwen CustomVoice 0.6B",
        "qwen_custom_voice",
        "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        "0.6B",
        1200,
        QWEN_LANGUAGES,
        "presetVoice",
        "Lightweight Qwen CustomVoice preset model.",
        True,
    ),
    TtsModel(
        "luxtts",
        "LuxTTS",
        "luxtts",
        "YatharthS/LuxTTS",
        None,
        300,
        ("en",),
        "voiceClone",
        "ZipVoice based high-speed English cloning model.",
    ),
    TtsModel(
        "chatterbox-tts",
        "Chatterbox TTS",
        "chatterbox",
        "ResembleAI/chatterbox",
        None,
        3200,
        ("zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it", "ar", "hi"),
        "voiceClone",
        "Resemble AI multilingual cloning engine.",
    ),
    TtsModel(
        "chatterbox-turbo",
        "Chatterbox Turbo",
        "chatterbox_turbo",
        "ResembleAI/chatterbox-turbo",
        None,
        1500,
        ("en",),
        "voiceClone",
        "Smaller English Chatterbox engine for faster local cloning.",
    ),
    TtsModel(
        "tada-1b",
        "TADA 1B",
        "tada",
        "HumeAI/tada-1b",
        "1B",
        4000,
        ("en",),
        "voiceClone",
        "HumeAI English speech-language model for coherent narration.",
    ),
    TtsModel(
        "tada-3b-ml",
        "TADA 3B Multilingual",
        "tada",
        "HumeAI/tada-3b-ml",
        "3B",
        8000,
        ("en", "ar", "zh", "de", "es", "fr", "it", "ja", "pl", "pt"),
        "longAudio",
        "HumeAI multilingual long-form speech model.",
    ),
    TtsModel(
        "kokoro",
        "Kokoro 82M",
        "kokoro",
        "hexgrad/Kokoro-82M",
        None,
        350,
        ("en", "es", "fr", "hi", "it", "pt", "ja", "zh"),
        "presetVoice",
        "Small preset-voice engine suitable for fast previews.",
    ),
    TtsModel(
        "sensevoice-small",
        "SenseVoice Small",
        "sensevoice",
        "mlx-community/SenseVoiceSmall",
        None,
        200,
        ("zh", "en", "ja", "ko"),
        "stt",
        "阿里达摩院短音频识别模型，5秒内音频识别极准。",
    ),
    TtsModel(
        "whisper-large-v3-turbo",
        "Whisper Large V3 Turbo",
        "whisper",
        "mlx-community/whisper-large-v3-turbo",
        None,
        1600,
        QWEN_LANGUAGES,
        "stt",
        "OpenAI Whisper 最强语音识别模型，用于智能识别音频说话内容。",
    ),
    TtsModel(
        "whisper-small",
        "Whisper Small",
        "whisper",
        "mlx-community/whisper-small",
        None,
        500,
        QWEN_LANGUAGES,
        "stt",
        "轻量 Whisper 模型，识别速度快。",
    ),
)


def get_model(model_name: str) -> TtsModel | None:
    return next((model for model in TTS_MODELS if model.model_name == model_name), None)


def model_to_dict(model: TtsModel) -> dict:
    return {
        "model_name": model.model_name,
        "display_name": model.display_name,
        "engine": model.engine,
        "hf_repo_id": model.hf_repo_id,
        "model_size": model.model_size,
        "size_mb": model.size_mb,
        "languages": list(model.languages),
        "purpose": model.purpose,
        "description": model.description,
        "supports_instruct": model.supports_instruct,
    }
