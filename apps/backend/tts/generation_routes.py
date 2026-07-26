from __future__ import annotations

from http import HTTPStatus
from pathlib import Path

from .catalog import get_model
from .engine import synthesize_to_wav
from .model_cache import find_cached_model


class GenerationRoutesMixin:
    def handle_generate(self, payload: dict):
        profile_id = payload.get("profile_id") or payload.get("profileId")
        text = (payload.get("text") or "").strip()
        if not profile_id:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "profile_id is required")
            return
        if not text:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "text is required")
            return
        profile = self.state.store.get_profile(profile_id)
        if not profile:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Profile not found")
            return
        engine = payload.get("engine") or profile.get("default_engine") or "qwen"
        model_size = payload.get("model_size") or payload.get("modelSize") or profile.get("default_model_size")
        language = payload.get("language") or profile.get("language") or "zh"
        generation = self.state.store.create_generation(profile_id, text, engine, model_size, language)
        self.state.start_generation(generation["id"], profile_id, text)
        self.state.inference_queue.put(
            (
                self.generate_audio,
                (generation["id"], text, profile, engine, model_size, language, payload.get("seed")),
            )
        )
        self.send_json(generation, status=HTTPStatus.CREATED)

    def generate_audio(
        self,
        generation_id: str,
        text: str,
        profile: dict,
        engine: str,
        model_size: str | None,
        language: str,
        seed: int | None,
    ):
        try:
            output = self.state.store.audio_dir / f"{generation_id}.wav"
            result = synthesize_to_wav(
                output=output,
                text=text,
                profile=profile,
                engine=engine,
                model_size=model_size,
                language=language,
                seed=seed,
            )
            self.state.store.update_generation(
                generation_id,
                status="completed",
                audio_path=str(output),
                duration=result.duration,
                backend=result.backend,
                mocked=1 if result.mocked else 0,
                warning=result.warning,
                error=None,
            )
            self.state.finish_generation(generation_id)
        except Exception as exc:
            self.state.store.update_generation(generation_id, status="failed", error=str(exc))
            self.state.finish_generation(generation_id, str(exc))

    def handle_transcribe(self, payload: dict):
        audio_path = payload.get("audio_path") or payload.get("audioPath")
        if not audio_path:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "audio_path is required")
            return
        if not Path(str(audio_path)).exists():
            self.send_error_json(HTTPStatus.NOT_FOUND, f"Audio file not found: {audio_path}")
            return
        import queue as _queue

        result_queue: _queue.Queue = _queue.Queue()

        def _do_transcribe():
            try:
                import contextlib
                import wave

                duration = 0.0
                try:
                    with contextlib.closing(wave.open(str(audio_path), "r")) as wav:
                        duration = wav.getnframes() / float(wav.getframerate())
                except Exception:
                    duration = 0.0

                try:
                    from mlx_audio.stt import load as load_stt

                    has_mlx = True
                except Exception:
                    has_mlx = False

                if has_mlx:
                    sensevoice_model = get_model("sensevoice-small")
                    use_sensevoice = duration <= 30 and sensevoice_model and find_cached_model(sensevoice_model)
                    if use_sensevoice:
                        if not hasattr(self.state, "_sensevoice") or self.state._sensevoice is None:
                            self.state._sensevoice = load_stt("mlx-community/SenseVoiceSmall")
                        result = self.state._sensevoice.generate(str(audio_path), language="zh", use_itn=True)
                    else:
                        if not hasattr(self.state, "_stt_model") or self.state._stt_model is None:
                            model = load_stt("mlx-community/whisper-large-v3-turbo")
                            if model._processor is None:
                                from transformers import WhisperProcessor

                                model._processor = WhisperProcessor.from_pretrained("openai/whisper-large-v3-turbo")
                            self.state._stt_model = model
                        result = self.state._stt_model.generate(str(audio_path), language="zh")
                else:
                    import torch
                    from transformers import pipeline

                    if not hasattr(self.state, "_stt_pipe") or self.state._stt_pipe is None:
                        device = 0 if torch.cuda.is_available() else -1
                        self.state._stt_pipe = pipeline(
                            "automatic-speech-recognition",
                            model="openai/whisper-large-v3-turbo",
                            device=device,
                            chunk_length_s=30,
                        )
                    result = self.state._stt_pipe(str(audio_path), generate_kwargs={"language": "chinese"})
                if isinstance(result, str):
                    text = result.strip()
                elif isinstance(result, dict):
                    text = result.get("text", "").strip()
                elif hasattr(result, "text"):
                    text = result.text.strip()
                else:
                    text = str(result).strip()
                result_queue.put(("ok", text))
            except Exception as exc:
                result_queue.put(("error", str(exc)))

        self.state.inference_queue.put((_do_transcribe, ()))
        try:
            status, value = result_queue.get(timeout=60)
            if status == "ok":
                self.send_json({"text": value})
            else:
                self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"转录失败: {value}")
        except Exception:
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "转录超时")

    def send_audio(self, generation_id: str):
        generation = self.state.store.get_generation(generation_id)
        if not generation or not generation.get("audio_path"):
            self.send_error_json(HTTPStatus.NOT_FOUND, "Audio not found")
            return
        audio_path = Path(generation["audio_path"])
        if not audio_path.exists():
            self.send_error_json(HTTPStatus.NOT_FOUND, "Audio file missing")
            return
        data = audio_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "app://manying-studio")
        self.end_headers()
        self.wfile.write(data)
