#!/usr/bin/env python3
"""Video QC worker CLI — mirrors the depth_estimation/upscale worker pattern.

Usage:
  python -m video_qc.worker --probe
  python -m video_qc.worker --version
  python -m video_qc.worker --run --input <request.json> --output <artifact.json>
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
from .dover_scoring import DEFAULT_MODEL, VideoQcError, probe_model, score_video

TOOL_VERSION = f"video-qc@{__version__}"


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
        "chapterId": str(request.get("chapterId", "unknown")),
        "status": "blocked",
        "model": str(request.get("model", DEFAULT_MODEL)),
        "mode": str(request.get("mode", "whole")),
        "code": code,
        "message": message,
        "toolVersion": TOOL_VERSION,
        "generatedAt": int(time.time() * 1000),
    }


def _probe() -> dict[str, Any]:
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

    try:
        result = score_video(request)
    except VideoQcError as exc:
        return _blocked(request, exc.code, exc.message)
    except Exception as exc:  # noqa: BLE001 — worker 边界统一兜底
        return _blocked(request, "unexpected-error", str(exc))

    base = {
        "schemaVersion": 1,
        "projectId": str(request.get("projectId", "unknown")),
        "chapterId": str(request.get("chapterId", "unknown")),
        "status": "accepted",
        "model": str(request.get("model", DEFAULT_MODEL)),
        "mode": str(request.get("mode", "whole")),
        "toolVersion": TOOL_VERSION,
        "elapsedMs": int(result.get("elapsedMs", round(float(result.get("elapsed", 0.0)) * 1000))),
        "generatedAt": int(time.time() * 1000),
    }

    if str(request.get("mode", "whole")) == "slices":
        # 低基线归因:slices 请求的 artifact 同时带整片 overall + per-shot 分数
        base["slices"] = [
            {"shotId": str(item["shotId"]), "fused": float(item["fused"])}
            for item in result.get("slices", [])
        ]
        base["overall"] = {
            "fused": float(result["fused"]),
            "aesthetic": float(result["aesthetic"]),
            "technical": float(result["technical"]),
        }
        return base

    base["overall"] = {
        "fused": float(result["fused"]),
        "aesthetic": float(result["aesthetic"]),
        "technical": float(result["technical"]),
    }
    return base


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio chapter video QC worker")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--probe", action="store_true", help="Probe runtime readiness")
    group.add_argument("--version", action="store_true", help="Print tool version")
    group.add_argument("--run", action="store_true", help="Run video scoring")
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
