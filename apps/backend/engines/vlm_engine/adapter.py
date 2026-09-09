"""VLM Review adapter — Qwen3-VL via mlx-vlm for visual consistency checking.

Unlike upscale (which NEVER falls back silently), the VLM review adapter
returns status="blocked" with a specific error code when the model is missing
or inference fails — the caller treats blocked as "skip review, proceed"
per the fail-open discipline.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any

from .model_cache import DEFAULT_VLM_MODEL, find_cached_vlm_model

MODEL_NAME = DEFAULT_VLM_MODEL
REVIEW_TIMEOUT_SECONDS = 30

# Module-level cache: model loaded once per process (cold load ~30-60s)
_model_cache: dict[str, tuple[Any, Any]] = {}


class VlmReviewError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_model(model_dir: str) -> tuple[Any, Any]:
    """Load mlx-vlm model; cached across calls within the same process."""
    if model_dir in _model_cache:
        return _model_cache[model_dir]
    try:
        from mlx_vlm import load
        model, processor = load(model_dir)
        _model_cache[model_dir] = (model, processor)
        return model, processor
    except ImportError as exc:
        raise VlmReviewError("mlx-vlm-missing", f"mlx-vlm 未安装: {exc}")
    except Exception as exc:
        raise VlmReviewError("model-load-failed", f"模型加载失败: {exc}")


def _build_review_prompt(
    expected_content: str,
    expected_characters: list[str],
    reference_count: int,
) -> str:
    return f"""你是动画分镜图的质量审核员。第一张图是生成的分镜图,后续{reference_count}张是资产参考图。

请对比分镜图与参考图,逐项判断:

1. character_ok: 分镜图中出现的角色是否与角色参考图的形象一致(脸型、体型、发型)?
2. costume_ok: 角色穿着的服装是否与参考图一致(颜色、款式、材质)?
3. scene_ok: 画面中的场景是否与场景参考图匹配(布局、色调、氛围)?
4. prop_ok: 画面中的道具是否与参考图中的道具匹配(位置、状态)?
5. text_watermark_ok: 画面中是否有不该出现的文字、水印或杂乱元素?
6. noise_clean_ok: 画面是否干净(无斑驳噪点、霉斑、杂色颗粒;正常的水墨笔触和飞白不算噪点)?

期望画面内容:{expected_content}
期望出现的角色:{", ".join(expected_characters) if expected_characters else "无特定角色"}

请严格用以下 JSON 格式回答(不要添加其他文字):
{{"character_ok": true或false, "costume_ok": true或false, "scene_ok": true或false,
  "prop_ok": true或false, "text_watermark_ok": true或false, "noise_clean_ok": true或false,
  "reasons": ["中文理由1", "中文理由2"]}}"""


def _parse_vlm_json(response: str) -> dict[str, Any]:
    """Parse VLM response text → checks dict; tolerant of markdown fences."""
    text = response.strip()
    # Strip markdown code fences
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    # Find JSON object
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < 0:
        raise VlmReviewError("vlm-parse-failed", f"VLM 响应不含 JSON: {text[:200]}")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise VlmReviewError("vlm-parse-failed", f"VLM JSON 解析失败: {exc}")
    checks: dict[str, Any] = {}
    for key in ("character_ok", "costume_ok", "scene_ok", "prop_ok", "text_watermark_ok", "noise_clean_ok"):
        checks[key] = bool(data.get(key, True))  # 默认 True(缺项不误杀)
    checks["reasons"] = [str(r) for r in data.get("reasons", []) if str(r).strip()]
    return checks


def review_image(
    generated_path: str,
    reference_paths: list[str],
    expected_content: str = "",
    expected_characters: list[str] | None = None,
    model_dir: str | None = None,
) -> dict[str, Any]:
    """VLM visual consistency review. Returns the artifact field dict."""
    started = time.time()
    expected_characters = expected_characters or []

    # Model discovery
    if model_dir is None:
        model_dir = find_cached_vlm_model()
        if not model_dir:
            return {
                "status": "blocked",
                "code": "model-not-downloaded",
                "message": "VLM 模型未下载,请在设置→插件设置→视觉审核中下载",
                "generatedAt": int(time.time() * 1000),
            }

    gen = Path(generated_path)
    if not gen.is_file():
        return {
            "status": "blocked",
            "code": "input-not-found",
            "message": f"成图不存在: {generated_path}",
            "generatedAt": int(time.time() * 1000),
        }

    input_sha = _sha256(gen)

    try:
        model, processor = _load_model(model_dir)
        from mlx_vlm import generate as mlx_generate
        from mlx_vlm.prompt_utils import apply_chat_template

        images = [str(gen)] + [str(Path(p)) for p in reference_paths if Path(p).is_file()]
        if len(images) < 2:
            return {
                "status": "blocked",
                "code": "no-reference-images",
                "message": "无有效参考图,比对无意义",
                "inputSha256": input_sha,
                "generatedAt": int(time.time() * 1000),
            }

        raw_prompt = _build_review_prompt(
            expected_content, expected_characters, len(images) - 1
        )

        # mlx-vlm 需要经 chat template 生成图片占位符(num_images 告知有几张图)
        prompt = apply_chat_template(
            processor, model.config,
            prompt=raw_prompt,
            add_generation_prompt=True,
            num_images=len(images),
        )

        result = mlx_generate(
            model, processor, prompt=prompt, image=images, max_tokens=512
        )
        # mlx-vlm 0.6.x returns GenerationResult(需 .text 取字符串)
        response = result.text if hasattr(result, 'text') else str(result)
        checks = _parse_vlm_json(response)
        reasons = checks.pop("reasons", [])

        all_ok = all(
            checks[k]
            for k in ("character_ok", "costume_ok", "scene_ok", "prop_ok", "text_watermark_ok", "noise_clean_ok")
        )
        return {
            "status": "accepted" if all_ok else "rejected",
            "model": MODEL_NAME,
            "checks": checks,
            "reasons": reasons,
            "inferenceMs": round((time.time() - started) * 1000),
            "inputSha256": input_sha,
            "generatedAt": int(time.time() * 1000),
        }
    except VlmReviewError:
        raise
    except Exception as exc:
        return {
            "status": "blocked",
            "code": "inference-failed",
            "message": str(exc)[:300],
            "inputSha256": input_sha,
            "generatedAt": int(time.time() * 1000),
        }
