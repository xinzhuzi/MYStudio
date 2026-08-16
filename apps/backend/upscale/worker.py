#!/usr/bin/env python3
"""Upscale worker CLI — mirrors the depth_estimation worker pattern.

Usage:
  python -m upscale.worker --probe
  python -m upscale.worker --version
  python -m upscale.worker --run --input <request.json> --output <artifact.json>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from . import __version__
from .adapter import UpscaleError, probe_model, upscale_image
from .model_cache import DEFAULT_UPSCALE_MODEL

TOOL_VERSION = f"upscale@{__version__}"


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _blocked(request: dict[str, Any], code: str, message: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "projectId": str(request.get("projectId", "unknown")),
        "shotId": str(request.get("shotId", "unknown")),
        "status": "blocked",
        "model": str(request.get("model", DEFAULT_UPSCALE_MODEL)),
        "method": "",
        "scale": 0,
        "inputSha256": "0" * 64,
        "outputSha256": "0" * 64,
        "outputPath": "",
        "width": 0,
        "height": 0,
        "toolVersion": TOOL_VERSION,
        "generatedAt": int(time.time() * 1000),
        "code": code,
        "message": message,
    }


def _probe() -> dict[str, Any]:
    """Probe the runtime and model availability."""
    model_probe = probe_model()
    return {
        "status": "ready" if model_probe.get("status") == "ready" else "blocked",
        "toolVersion": TOOL_VERSION,
        "model": model_probe,
        "python": sys.version.split()[0],
    }


def _run(input_path: str, output_path: str) -> dict[str, Any]:
    request = _read_json(Path(input_path))
    if not request:
        return _blocked({}, "input-read-failed", f"无法读取输入请求: {input_path}")

    model = str(request.get("model", DEFAULT_UPSCALE_MODEL))
    input_image = str(request.get("inputImagePath", ""))
    output_image = str(request.get("outputImagePath", ""))

    if not input_image or not output_image:
        return _blocked(request, "missing-paths", "inputImagePath 和 outputImagePath 必须提供")

    try:
        result = upscale_image(input_image, output_image, model)
    except UpscaleError as exc:
        return _blocked(request, exc.code, exc.message)
    except Exception as exc:
        return _blocked(request, "unexpected-error", str(exc))

    return {
        "schemaVersion": 1,
        "projectId": str(request.get("projectId", "unknown")),
        "shotId": str(request.get("shotId", "unknown")),
        "status": "accepted",
        "model": model,
        "method": "super_res",
        "scale": result["scale"],
        "inputSha256": result["inputSha256"],
        "outputSha256": result["outputSha256"],
        "outputPath": result["outputPath"],
        "width": result["width"],
        "height": result["height"],
        "outputBytes": result["outputBytes"],
        "elapsedSeconds": result["elapsedSeconds"],
        "toolVersion": TOOL_VERSION,
        "generatedAt": int(time.time() * 1000),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio image upscale worker")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--probe", action="store_true", help="Probe runtime readiness")
    group.add_argument("--version", action="store_true", help="Print tool version")
    group.add_argument("--run", action="store_true", help="Run image upscale")
    parser.add_argument("--input", type=str, help="Path to request JSON")
    parser.add_argument("--output", type=str, help="Path to write artifact JSON")
    args = parser.parse_args()

    if args.version:
        print(json.dumps({"toolVersion": TOOL_VERSION, "python": sys.version.split()[0]}))
        return

    if args.probe:
        print(json.dumps(_probe(), ensure_ascii=False))
        return

    if args.run:
        if not args.input or not args.output:
            print(json.dumps(_blocked({}, "missing-args", "--run 需要 --input 和 --output")))
            sys.exit(2)
        artifact = _run(args.input, args.output)
        _write_json(Path(args.output), artifact)
        if artifact["status"] != "accepted":
            sys.exit(2)
        return


if __name__ == "__main__":
    main()
