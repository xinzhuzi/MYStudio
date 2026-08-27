"""VLM Review worker — CLI entry point for visual consistency checking.

Usage:
  python -m vlm_review.worker --probe
  python -m vlm_review.worker --run --input request.json --output artifact.json

Blocked results still write the full artifact JSON and exit with code 2.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from .adapter import MODEL_NAME, REVIEW_TIMEOUT_SECONDS, VlmReviewError, review_image
from .model_cache import (
    DEFAULT_VLM_MODEL,
    detect_hardware_profile,
    evaluate_availability,
    find_cached_vlm_model,
    scan_vlm_model_inventory,
)

TOOL_VERSION = "vlm-review/1.0.0"


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{__import__('os').getpid()}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _blocked(request: dict[str, Any], code: str, message: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "projectId": str(request.get("projectId", "unknown")),
        "shotId": str(request.get("shotId", "unknown")),
        "status": "blocked",
        "model": MODEL_NAME,
        "code": code,
        "message": message,
        "checks": {},
        "reasons": [],
        "inferenceMs": 0,
        "inputSha256": "",
        "toolVersion": TOOL_VERSION,
        "generatedAt": int(time.time() * 1000),
    }


def _probe() -> dict[str, Any]:
    """Probe runtime dependencies + hardware + model availability."""
    profile = detect_hardware_profile()
    availability = evaluate_availability(profile)
    model_dir = find_cached_vlm_model()
    inventory = scan_vlm_model_inventory()
    try:
        import mlx_vlm  # noqa: F401
        mlx_vlm_ok = True
        mlx_vlm_version = getattr(mlx_vlm, "__version__", "unknown")
    except ImportError:
        mlx_vlm_ok = False
        mlx_vlm_version = None
    return {
        "status": "ready" if (availability["status"] == "ready" and mlx_vlm_ok and model_dir) else "blocked",
        "hardwareProfile": profile,
        "availability": availability,
        "mlxVlmAvailable": mlx_vlm_ok,
        "mlxVlmVersion": mlx_vlm_version,
        "modelDir": model_dir,
        "modelInventory": inventory,
        "toolVersion": TOOL_VERSION,
        "code": None if model_dir else "model-not-downloaded",
        "message": None if model_dir else "VLM 模型未下载",
    }


def _run(input_path: str, output_path: str) -> dict[str, Any]:
    request = _read_json(Path(input_path))
    if not request:
        return _blocked({}, "input-read-failed", f"无法读取输入请求: {input_path}")

    generated = str(request.get("generatedImagePath", ""))
    references_raw = request.get("referenceImages", [])
    if isinstance(references_raw, list):
        reference_paths = [
            str(item.get("path", "")) for item in references_raw if isinstance(item, dict) and item.get("path")
        ]
    else:
        reference_paths = []

    expected_content = str(request.get("expectedContent", ""))
    expected_characters = list(request.get("expectedCharacters", []))

    if not generated:
        return _blocked(request, "missing-paths", "generatedImagePath 必须提供")

    try:
        result = review_image(
            generated_path=generated,
            reference_paths=reference_paths,
            expected_content=expected_content,
            expected_characters=expected_characters,
        )
    except VlmReviewError as exc:
        return _blocked(request, exc.code, exc.message)
    except Exception as exc:
        return _blocked(request, "unexpected-error", str(exc)[:300])

    return {
        "schemaVersion": 1,
        "projectId": str(request.get("projectId", "unknown")),
        "shotId": str(request.get("shotId", "unknown")),
        **result,
        "toolVersion": TOOL_VERSION,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="VLM Review worker")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--input", type=str)
    parser.add_argument("--output", type=str)
    args = parser.parse_args()

    if args.version:
        print(TOOL_VERSION)
        return

    if args.probe:
        print(json.dumps(_probe(), ensure_ascii=False, indent=2))
        return

    if args.run and args.input and args.output:
        result = _run(args.input, args.output)
        _write_json(Path(args.output), result)
        print(json.dumps(result, ensure_ascii=False))
        if result.get("status") == "blocked":
            sys.exit(2)
        return

    print("Usage: --probe | --run --input <req.json> --output <artifact.json>", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
