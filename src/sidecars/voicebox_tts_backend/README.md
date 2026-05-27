# MYStudio Voicebox TTS Backend

Development runner:

```bash
PYTHONPATH=src/sidecars/voicebox_tts_backend python3 -m manying_voicebox_tts.main --host 127.0.0.1 --port 17593 --data-dir /tmp/manying-tts
```

Routes kept for MYStudio:

- `GET /health`
- `GET /profiles`
- `POST /profiles`
- `POST /generate`
- `GET /generate/{id}/status`
- `GET /audio/{id}`
- `GET /models/status`
- `POST /models/download`
- `GET /models/progress/{model_name}`
- `POST /models/download/cancel`
- `DELETE /models/{model_name}`
- `GET /tasks/active`

Engine modes:

- `MANYING_TTS_ENGINE_MODE=auto` tries a real adapter when available, then falls back to deterministic mock WAV with `mocked=1`.
- `MANYING_TTS_ENGINE_MODE=mock` always writes deterministic mock WAV for UI and queue testing.
- `MANYING_TTS_ENGINE_MODE=real` requires a real adapter and fails instead of silently mocking.

Current real adapter coverage: Kokoro, Qwen voice cloning, and Qwen CustomVoice preset voices. LuxTTS, Chatterbox, Chatterbox Turbo, and TADA are cataloged/downloadable but still need their Voicebox engine adapters migrated.

To enable Kokoro real inference in development:

```bash
pip install -r src/sidecars/voicebox_tts_backend/requirements.txt
pip install -r src/sidecars/voicebox_tts_backend/requirements-kokoro.txt
MANYING_TTS_ENGINE_MODE=real PYTHONPATH=src/sidecars/voicebox_tts_backend python3 -m manying_voicebox_tts.main --host 127.0.0.1 --port 17593 --data-dir /tmp/manying-tts
```

To enable Qwen real inference on macOS Apple Silicon:

```bash
pip install -r src/sidecars/voicebox_tts_backend/requirements.txt
pip install -r src/sidecars/voicebox_tts_backend/requirements-qwen-mlx.txt
MANYING_TTS_ENGINE_MODE=real MANYING_TTS_QWEN_BACKEND=mlx PYTHONPATH=src/sidecars/voicebox_tts_backend python3 -m manying_voicebox_tts.main --host 127.0.0.1 --port 17593 --data-dir /tmp/manying-tts
```

To enable Qwen CustomVoice preset voices:

```bash
pip install -r src/sidecars/voicebox_tts_backend/requirements.txt
pip install -r src/sidecars/voicebox_tts_backend/requirements-qwen-pytorch.txt
MANYING_TTS_ENGINE_MODE=real PYTHONPATH=src/sidecars/voicebox_tts_backend python3 -m manying_voicebox_tts.main --host 127.0.0.1 --port 17593 --data-dir /tmp/manying-tts
```
