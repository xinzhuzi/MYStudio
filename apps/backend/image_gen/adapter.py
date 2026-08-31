"""Typed, file-backed boundary for explicit local image generation."""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import os
import time
from pathlib import Path
from typing import Any

from .model_cache import (
    IMAGE_MODELS,
    QWEN_IMAGE_EDIT_MODEL,
    find_cached_image_model_for_spec,
    hf_snapshot_dir,
    resolve_image_model_name,
)
from .engines import ALL_ENGINES as _ALL_ENGINES
from .pipeline import PipelineError, generate_image

_ENGINE_BY_LAYOUT = {e.LAYOUT: e for e in _ALL_ENGINES}

FIXED_WIDTH = 1920
FIXED_HEIGHT = 1080
SUPPORTED_FIELDS = frozenset(
    {
        "schemaVersion",
        "projectId",
        "shotId",
        "model",
        "prompt",
        "negativePrompt",
        "referenceImages",
        "controlNet",
        "outputPath",
        "mediaRoot",
        "width",
        "height",
        "seed",
        "frozen",
        "runtimeEvidence",
    }
)
REFERENCE_ROLES = frozenset({"character", "scene", "prop", "style"})


class ImageGenerationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _request_fingerprint(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _resolve_media_root(value: dict[str, Any]) -> Path:
    raw_root = value.get("mediaRoot") or os.environ.get("MYSTUDIO_IMAGE_MEDIA_ROOT")
    if not isinstance(raw_root, str) or not raw_root.strip():
        raise ImageGenerationError("invalid-media-root", "mediaRoot 必须是非空绝对路径")
    root = Path(raw_root).expanduser()
    if not root.is_absolute():
        raise ImageGenerationError("invalid-media-root", "mediaRoot 必须是绝对路径")
    return root.resolve()


def _confined_output_path(value: dict[str, Any], media_root: Path) -> Path:
    output_path = Path(value["outputPath"]).expanduser()
    if not output_path.is_absolute():
        raise ImageGenerationError("invalid-output-path", "outputPath 必须是绝对路径")
    resolved_output = output_path.resolve()
    if resolved_output == media_root or not resolved_output.is_relative_to(media_root):
        raise ImageGenerationError("invalid-output-path", "outputPath 必须位于 mediaRoot 内")
    return resolved_output


def _validate_reference_inputs(value: dict[str, Any]) -> None:
    references = value.get("referenceImages", [])
    if not isinstance(references, list):
        raise ImageGenerationError("invalid-reference", "referenceImages 必须是数组")
    for item in references:
        if not isinstance(item, dict) or set(item) != {"path", "role"}:
            raise ImageGenerationError("invalid-reference", "每个 referenceImages 项必须只有 path 和 role")
        if not isinstance(item["path"], str) or not item["path"].strip():
            raise ImageGenerationError("invalid-reference", "参考图 path 必须是非空字符串")
        if item["role"] not in REFERENCE_ROLES:
            raise ImageGenerationError("invalid-reference-role", f"不支持的参考图角色: {item['role']}")

    control_net = value.get("controlNet")
    if control_net is None:
        return
    if not isinstance(control_net, dict) or not set(control_net).issubset({"type", "path", "strength"}):
        raise ImageGenerationError("invalid-control-net", "controlNet 只允许 type、path、strength")
    if control_net.get("type") not in {"depth", "canny"}:
        raise ImageGenerationError("invalid-control-net", "controlNet.type 必须是 depth 或 canny")
    if "path" in control_net and (
        not isinstance(control_net["path"], str) or not control_net["path"].strip()
    ):
        raise ImageGenerationError("invalid-control-net", "controlNet.path 必须是非空字符串")
    if "strength" in control_net and (
        isinstance(control_net["strength"], bool)
        or not isinstance(control_net["strength"], (int, float))
        or not 0 <= float(control_net["strength"]) <= 1
    ):
        raise ImageGenerationError("invalid-control-net", "controlNet.strength 必须在 0 到 1 之间")


def validate_request(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ImageGenerationError("invalid-request", "请求必须是 JSON 对象")
    unknown = set(value) - SUPPORTED_FIELDS
    if unknown:
        raise ImageGenerationError("invalid-request", f"请求包含未知字段: {', '.join(sorted(unknown))}")
    if value.get("schemaVersion") != 1:
        raise ImageGenerationError("invalid-schema-version", "只支持 schemaVersion=1")
    required = ("projectId", "shotId", "model", "prompt", "outputPath")
    if any(not isinstance(value.get(key), str) or not value[key].strip() for key in required):
        raise ImageGenerationError("invalid-request", "projectId、shotId、model、prompt 和 outputPath 必须是非空字符串")
    if value["model"] not in IMAGE_MODELS and resolve_image_model_name(value["model"]) not in IMAGE_MODELS:
        raise ImageGenerationError("unknown-model", f"未知图像模型: {value['model']}")
    value = {**value, "model": resolve_image_model_name(value["model"])}
    if value.get("frozen") is True or os.environ.get("MYSTUDIO_IMAGE_GENERATION_FROZEN") == "1":
        raise ImageGenerationError("image-generation-frozen", "图像生成已冻结")
    if "frozen" in value and not isinstance(value["frozen"], bool):
        raise ImageGenerationError("invalid-request", "frozen 必须是布尔值")
    if "negativePrompt" in value and not isinstance(value["negativePrompt"], str):
        raise ImageGenerationError("invalid-request", "negativePrompt 必须是字符串")
    if "seed" in value and (
        isinstance(value["seed"], bool) or not isinstance(value["seed"], int)
    ):
        raise ImageGenerationError("invalid-request", "seed 必须是整数")
    if "runtimeEvidence" in value and not isinstance(value["runtimeEvidence"], dict):
        raise ImageGenerationError("invalid-request", "runtimeEvidence 必须是对象")
    _validate_reference_inputs(value)
    media_root = _resolve_media_root(value)
    resolved_output = _confined_output_path(value, media_root)
    if value.get("width", FIXED_WIDTH) != FIXED_WIDTH or value.get("height", FIXED_HEIGHT) != FIXED_HEIGHT:
        raise ImageGenerationError("invalid-dimensions", "本地生图输出必须是 1920x1080")
    normalized = dict(value)
    normalized["schemaVersion"] = 1
    normalized["mediaRoot"] = str(media_root)
    normalized["outputPath"] = str(resolved_output)
    return normalized


def _missing_dependencies(model_name: str = QWEN_IMAGE_EDIT_MODEL) -> list[str]:
    spec = IMAGE_MODELS.get(model_name, {})
    layout = str(spec.get("layout", ""))
    checks = (("torch", "torch"), ("diffusers", "diffusers"), ("PIL", "pillow"))
    if "pointed" in layout:
        checks += (("transformers", "transformers"), ("safetensors", "safetensors"))
    if layout == "qwen-pointed":
        checks += (("accelerate", "accelerate"), ("gguf", "gguf"))
    return [label for module, label in checks if importlib.util.find_spec(module) is None]


def _small_pieces_status_for_layout(layout: str) -> dict[str, Any] | None:
    engine = _ENGINE_BY_LAYOUT.get(layout)
    if engine is None:
        return None
    return engine.small_pieces_status(hf_snapshot_dir)


def probe_model(model_name: str = QWEN_IMAGE_EDIT_MODEL) -> dict[str, Any]:
    model_name = resolve_image_model_name(model_name)
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        return {"status": "blocked", "code": "unknown-model", "message": f"未知图像模型: {model_name}"}
    # Probe pointed layouts even when their large ComfyUI files are absent. The
    # result is intentionally consumed below only after the legacy Qwen
    # model-not-downloaded gate, preserving its existing error precedence.
    small_pieces = _small_pieces_status_for_layout(str(spec.get("layout", "")))
    cached = find_cached_image_model_for_spec(spec)
    if not cached:
        engine = _ENGINE_BY_LAYOUT.get(spec.get("layout", ""))
        hint = engine.COMFY_MAIN_FILE if engine else ""
        message = f"图像模型 {spec['label']} 未就绪"
        if hint:
            message += f":需 ComfyUI models 目录下存在 {hint}"
        return {"status": "blocked", "code": "model-not-downloaded", "message": message}
    missing = _missing_dependencies(model_name)
    capabilities = {
        "textToImage": not missing,
        "controlNet": False,
        "ipAdapter": False,
        "realEsrgan": False,
    }
    if missing:
        return {
            "status": "blocked",
            "code": "dependencies-missing",
            "message": f"本地生图依赖未安装: {', '.join(missing)}",
            "dependencies": missing,
            "capabilities": capabilities,
        }
    if small_pieces is not None and not small_pieces["ready"]:
        return {
            "status": "blocked",
            "code": "small-pieces-missing",
            "message": f"{spec['label']} 小件未补齐,请前往设置页补齐小件",
            "capabilities": capabilities,
        }
    return {
        "status": "ready",
        "model": model_name,
        "modelRevision": str(cached.get("revision") or cached["repo_id"]),
        "backend": "diffusers-qwen-edit" if spec.get("layout") == "qwen-pointed" else "diffusers",
        "sizeMb": cached["size_mb"],
        "capabilities": capabilities,
    }


def generate_artifact(request: object) -> dict[str, Any]:
    value = validate_request(request)
    model = value["model"]
    if value.get("referenceImages") or value.get("controlNet"):
        raise ImageGenerationError(
            "capability-unavailable",
            "当前本地 sidecar 尚未接线 ControlNet/IP-Adapter 参考能力",
        )
    probe = probe_model(model)
    if probe["status"] != "ready":
        raise ImageGenerationError(str(probe["code"]), str(probe["message"]))
    try:
        raw = generate_image(model, value["prompt"], negative_prompt=value.get("negativePrompt"), seed=value.get("seed"))
    except PipelineError as exc:
        raise ImageGenerationError(exc.code, exc.message) from exc
    try:
        from PIL import Image
        from io import BytesIO

        image = Image.open(BytesIO(base64.b64decode(raw, validate=True))).convert("RGB")
        image.thumbnail((FIXED_WIDTH, FIXED_HEIGHT))
        canvas = Image.new("RGB", (FIXED_WIDTH, FIXED_HEIGHT))
        canvas.paste(image, ((FIXED_WIDTH - image.width) // 2, (FIXED_HEIGHT - image.height) // 2))
        output_path = _confined_output_path(value, Path(value["mediaRoot"]))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = output_path.with_name(f"{output_path.name}.{os.getpid()}.tmp")
        canvas.save(temporary, format="PNG")
        temporary.replace(output_path)
    except ImageGenerationError:
        raise
    except Exception as exc:
        raise ImageGenerationError("output-write-failed", f"无法写入生成图片: {exc}") from exc
    digest = hashlib.sha256(output_path.read_bytes()).hexdigest()
    return {
        "schemaVersion": 1,
        "projectId": value["projectId"],
        "shotId": value["shotId"],
        "status": "accepted",
        "model": model,
        "modelRevision": probe["modelRevision"],
        "backend": probe.get("backend", "diffusers"),
        "upscaleBackend": "none",
        "referenceEvidence": {"requested": [], "accepted": []},
        "requestFingerprint": _request_fingerprint(value),
        "outputPath": str(output_path.resolve()),
        "outputSha256": digest, "width": FIXED_WIDTH, "height": FIXED_HEIGHT,
        "mediaRef": {"kind": "image", "path": str(output_path.resolve()), "contentSha256": digest},
        "generatedAt": int(time.time() * 1000),
    }
