# Voicebox TTS Sidecar Notice

This sidecar is a cropped, MYStudio-specific TTS runtime inspired by and API-compatible with the TTS subset of `jamiepine/voicebox`.

The model catalog, route names, task/progress shape, and supported TTS engine set preserve the Voicebox TTS integration surface:

- Qwen3-TTS
- Qwen CustomVoice
- LuxTTS
- Chatterbox
- Chatterbox Turbo
- TADA
- Kokoro

Non-TTS Voicebox domains are intentionally excluded from this copy: STT/transcription, MCP, Stories, Captures, Personality LLM, Tauri frontend, and CUDA backend management.
