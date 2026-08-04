from __future__ import annotations

from collections.abc import Mapping
from http import HTTPStatus
from pathlib import Path
import re
from typing import Any

from .catalog import get_model
from .engine import synthesize_to_wav
from .model_cache import find_cached_model


_RETRYABLE_ERROR_CODES = {
    "deadline_exceeded",
    "gateway_timeout",
    "rate_limit",
    "temporarily_unavailable",
    "timeout",
    "transient_http",
    "transient_provider",
    "transient_transport",
}
_NESTED_ERROR_FIELDS = (
    "response",
    "error",
    "detail",
    "data",
    "body",
    "cause",
    "__cause__",
    "__context__",
)


def _payload_alias(payload: dict, snake_key: str, camel_key: str) -> Any:
    if snake_key in payload and payload[snake_key] is not None:
        return payload[snake_key]
    return payload.get(camel_key)


def _error_field(value: Any, names: tuple[str, ...]) -> Any:
    if isinstance(value, Mapping):
        for name in names:
            if name in value:
                return value[name]
        return None
    for name in names:
        field = getattr(value, name, None)
        if field is not None:
            return field
    return None


def _error_nodes(exc: Exception) -> list[Any]:
    nodes: list[Any] = []
    pending: list[Any] = [exc]
    seen: set[int] = set()
    while pending:
        value = pending.pop(0)
        marker = id(value)
        if marker in seen:
            continue
        seen.add(marker)
        nodes.append(value)
        for field in _NESTED_ERROR_FIELDS:
            child = _error_field(value, (field,))
            if child is None or isinstance(child, (str, bytes, int, float, bool)):
                continue
            pending.append(child)
    return nodes


def _coerce_status(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _coerce_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes", "1"}:
            return True
        if normalized in {"false", "no", "0"}:
            return False
    return None


def _generation_failure_metadata(exc: Exception) -> tuple[bool, str]:
    nodes = _error_nodes(exc)
    status = _coerce_status(
        next(
            (
                _error_field(node, ("status", "status_code", "statusCode", "http_status"))
                for node in nodes
                if _error_field(node, ("status", "status_code", "statusCode", "http_status")) is not None
            ),
            None,
        )
    )
    raw_code = next(
        (
            _error_field(node, ("error_code", "errorCode", "code", "type"))
            for node in nodes
            if _error_field(node, ("error_code", "errorCode", "code", "type")) is not None
        ),
        None,
    )
    error_code = raw_code.strip() if isinstance(raw_code, str) else None
    explicit_retryable = next(
        (
            _coerce_bool(_error_field(node, ("retryable", "is_retryable", "temporary")))
            for node in nodes
            if _coerce_bool(_error_field(node, ("retryable", "is_retryable", "temporary"))) is not None
        ),
        None,
    )
    normalized_code = error_code.lower() if error_code else None
    retryable = (
        explicit_retryable
        if explicit_retryable is not None
        else isinstance(exc, (TimeoutError, ConnectionError))
        or (isinstance(status, int) and (status in {408, 429} or status >= 500))
        or normalized_code in _RETRYABLE_ERROR_CODES
    )
    if error_code:
        return bool(retryable), error_code
    if retryable:
        return True, "transient_http" if status is not None else "transient_transport"
    return False, "synthesis_failed"


class GenerationRoutesMixin:
    def handle_cancel_generation(self, generation_id: str):
        generation = self.state.store.get_generation(generation_id)
        if not generation:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Generation not found", code="generation_not_found")
            return
        canceled = generation["status"] in {"queued", "generating"}
        if canceled:
            generation = self.state.store.cancel_generation(generation_id) or generation
            self.state.finish_generation(generation_id)
        self.send_json({**generation, "canceled": canceled})

    def handle_generate(self, payload: dict):
        if not isinstance(payload, dict):
            self.send_error_json(
                HTTPStatus.BAD_REQUEST,
                "JSON body must be an object",
                code="invalid_payload",
            )
            return
        raw_profile_id = _payload_alias(payload, "profile_id", "profileId")
        if raw_profile_id is None or raw_profile_id == "":
            self.send_error_json(
                HTTPStatus.BAD_REQUEST,
                "profile_id is required",
                code="profile_id_required",
            )
            return
        if not isinstance(raw_profile_id, str) or not raw_profile_id.strip():
            self.send_error_json(
                HTTPStatus.BAD_REQUEST,
                "profile_id is invalid",
                code="profile_id_invalid",
            )
            return
        profile_id = raw_profile_id.strip()
        raw_text = payload.get("text")
        if raw_text is None or raw_text == "":
            self.send_error_json(
                HTTPStatus.BAD_REQUEST,
                "text is required",
                code="text_required",
            )
            return
        if not isinstance(raw_text, str):
            self.send_error_json(
                HTTPStatus.BAD_REQUEST,
                "text is invalid",
                code="text_invalid",
            )
            return
        text = raw_text.strip()
        if not text:
            self.send_error_json(
                HTTPStatus.BAD_REQUEST,
                "text is required",
                code="text_required",
            )
            return
        profile = self.state.store.get_profile(profile_id)
        if not profile:
            self.send_error_json(
                HTTPStatus.NOT_FOUND,
                "Profile not found",
                code="profile_not_found",
            )
            return
        raw_model_size = _payload_alias(payload, "model_size", "modelSize")
        for field_name, field_value in (
            ("engine", payload.get("engine")),
            ("model_size", raw_model_size),
            ("language", payload.get("language")),
        ):
            if field_value is not None and not isinstance(field_value, str):
                self.send_error_json(
                    HTTPStatus.BAD_REQUEST,
                    f"{field_name} is invalid",
                    code=f"{field_name}_invalid",
                )
                return
        engine = payload.get("engine") or profile.get("default_engine") or "qwen"
        model_size = raw_model_size or profile.get("default_model_size")
        language = payload.get("language") or profile.get("language") or "zh"
        try:
            scope = self._parse_generation_scope(payload, profile)
            generation, action = self.state.store.create_or_reuse_generation(
                profile_id=profile_id,
                text=text,
                engine=engine,
                model_size=model_size,
                language=language,
                project_id=scope["project_id"],
                chapter_id=scope["chapter_id"],
                shot_id=scope["shot_id"],
                shot_revision=scope["shot_revision"],
                input_fingerprint=scope["input_fingerprint"],
                reference_audio_sha256=scope["reference_audio_sha256"],
                emotion=scope["emotion"],
                voice_style=scope["voice_style"],
                generation_kind=scope["generation_kind"],
                seed=scope["seed"],
                retry_failed=scope["retry_failed"],
            )
        except ValueError as exc:
            status = HTTPStatus.CONFLICT if str(exc) == "fingerprint_collision" else HTTPStatus.BAD_REQUEST
            self.send_error_json(status, str(exc), code=str(exc))
            return
        should_enqueue = action in {"created", "restarted"} or (
            generation["status"] == "generating"
            and not self.state.is_generation_active(generation["id"])
        )
        if should_enqueue:
            self.state.start_generation(generation["id"], profile_id, text)
            self.state.inference_queue.put(
                (
                    self.generate_audio,
                    (
                        generation["id"],
                        text,
                        profile,
                        engine,
                        model_size,
                        language,
                        scope["seed"],
                        scope["emotion"],
                        scope["voice_style"],
                    ),
                )
            )
        response = {**generation, "reused": action == "reused", "resumed": action == "reused" and should_enqueue}
        self.send_json(response, status=HTTPStatus.OK if action == "reused" else HTTPStatus.CREATED)

    @staticmethod
    def _parse_generation_scope(payload: dict, profile: dict) -> dict:
        input_fingerprint = _payload_alias(payload, "input_fingerprint", "inputFingerprint")
        project_id = _payload_alias(payload, "project_id", "projectId")
        chapter_id = _payload_alias(payload, "chapter_id", "chapterId")
        shot_id = _payload_alias(payload, "shot_id", "shotId")
        shot_revision = _payload_alias(payload, "shot_revision", "shotRevision")
        reference_audio_sha256 = _payload_alias(payload, "reference_audio_sha256", "referenceAudioSha256")
        emotion = GenerationRoutesMixin._read_optional_text(payload, "emotion", "emotion")
        voice_style = GenerationRoutesMixin._read_optional_text(payload, "voice_style", "voiceStyle")
        generation_kind = _payload_alias(payload, "generation_kind", "generationKind")
        seed = payload.get("seed")
        retry_failed = payload.get("retry") is True
        scope_values = (project_id, chapter_id, shot_id, shot_revision)
        if generation_kind is not None and generation_kind != "storyboard-shot":
            raise ValueError("generation_kind_invalid")
        if generation_kind == "storyboard-shot" and (
            input_fingerprint is None or any(value is None for value in scope_values)
        ):
            raise ValueError("storyboard_scope_required")
        if shot_revision is not None and (not isinstance(shot_revision, int) or isinstance(shot_revision, bool) or shot_revision < 1):
            raise ValueError("shot_revision_invalid")
        if seed is not None and (not isinstance(seed, int) or isinstance(seed, bool)):
            raise ValueError("seed_invalid")
        if reference_audio_sha256 is not None and (
            not isinstance(reference_audio_sha256, str)
            or not re.fullmatch(r"[a-f0-9]{64}", reference_audio_sha256)
        ):
            raise ValueError("reference_audio_sha256_invalid")
        if input_fingerprint is None and all(value is None for value in scope_values):
            return {
                "project_id": None,
                "chapter_id": None,
                "shot_id": None,
                "shot_revision": None,
                "input_fingerprint": None,
                "reference_audio_sha256": None,
                "emotion": emotion,
                "voice_style": voice_style,
                "generation_kind": None,
                "seed": seed,
                "retry_failed": retry_failed,
            }
        if not isinstance(input_fingerprint, str) or not re.fullmatch(r"[a-f0-9]{64}", input_fingerprint):
            raise ValueError("input_fingerprint_invalid")
        for label, value in (
            ("project_id", project_id),
            ("chapter_id", chapter_id),
            ("shot_id", shot_id),
        ):
            if not isinstance(value, str) or not value.strip() or re.search(r"[\\/\x00]", value):
                raise ValueError(f"{label}_invalid")
        if profile.get("reference_audio_path") and reference_audio_sha256 is None:
            raise ValueError("reference_audio_sha256_required")
        return {
            "project_id": project_id,
            "chapter_id": chapter_id,
            "shot_id": shot_id,
            "shot_revision": shot_revision,
            "input_fingerprint": input_fingerprint,
            "reference_audio_sha256": reference_audio_sha256,
            "emotion": emotion,
            "voice_style": voice_style,
            "generation_kind": generation_kind,
            "seed": seed,
            "retry_failed": retry_failed,
        }

    @staticmethod
    def _read_optional_text(payload: dict, snake_key: str, camel_key: str) -> str | None:
        value = payload.get(snake_key) if snake_key in payload else payload.get(camel_key)
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError(f"{snake_key}_invalid")
        value = value.strip()
        return value or None

    def generate_audio(
        self,
        generation_id: str,
        text: str,
        profile: dict,
        engine: str,
        model_size: str | None,
        language: str,
        seed: int | None,
        emotion: str | None = None,
        voice_style: str | None = None,
    ):
        output: Path | None = None
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
                emotion=emotion,
                voice_style=voice_style,
            )
            updated = self.state.store.update_generation_if_status(
                generation_id,
                expected_status="generating",
                status="completed",
                audio_path=str(output),
                duration=result.duration,
                backend=result.backend,
                mocked=1 if result.mocked else 0,
                warning=result.warning,
                emotion_capability=result.emotion_capability,
                emotion_warning=result.emotion_warning,
                error=None,
            )
            if updated is None:
                try:
                    output.unlink(missing_ok=True)
                except OSError:
                    pass
                self.state.finish_generation(generation_id)
                return
            self.state.finish_generation(generation_id)
        except Exception as exc:
            if output is not None:
                try:
                    output.unlink(missing_ok=True)
                except OSError:
                    pass
            retryable, error_code = _generation_failure_metadata(exc)
            updated = self.state.store.update_generation_if_status(
                generation_id,
                expected_status="generating",
                status="failed",
                error=str(exc),
                retryable=1 if retryable else 0,
                error_code=error_code,
            )
            self.state.finish_generation(generation_id, str(exc) if updated is not None else None)

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
