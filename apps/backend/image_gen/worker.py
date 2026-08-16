"""JSON-only worker boundary for the local image sidecar."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from . import __version__
from .adapter import ImageGenerationError, _request_fingerprint, generate_artifact, probe_model

TOOL_VERSION = f"image-gen@{__version__}"


def _write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def _blocked(request: dict[str, Any], code: str, message: str) -> dict[str, Any]:
    safe_request = request if isinstance(request, dict) else {}
    try:
        fingerprint = _request_fingerprint(safe_request)
    except (TypeError, ValueError):
        fingerprint = ""
    return {
        "schemaVersion": 1,
        "projectId": str(safe_request.get("projectId", "unknown")),
        "shotId": str(safe_request.get("shotId", "unknown")),
        "status": "blocked",
        "model": str(safe_request.get("model", "")),
        "modelRevision": "",
        "backend": "diffusers",
        "upscaleBackend": "none",
        "referenceEvidence": {"requested": [], "accepted": []},
        "requestFingerprint": fingerprint,
        "code": code,
        "message": message,
        "outputPath": "",
        "outputSha256": "",
        "width": 0,
        "height": 0,
        "mediaRef": {"kind": "image", "path": "", "contentSha256": ""},
        "toolVersion": TOOL_VERSION,
        "generatedAt": int(time.time() * 1000),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio image generation worker")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--probe", action="store_true")
    group.add_argument("--run", action="store_true")
    group.add_argument("--version", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.version:
        print(json.dumps({"toolVersion": TOOL_VERSION, "python": sys.version.split()[0]})); return
    if args.probe:
        print(json.dumps({**probe_model(), "toolVersion": TOOL_VERSION}, ensure_ascii=False)); return
    if not args.input or not args.output:
        print(json.dumps(_blocked({}, "missing-args", "--run 需要 --input 和 --output"), ensure_ascii=False)); sys.exit(2)
    try:
        request = json.loads(Path(args.input).read_text(encoding="utf-8"))
        if not isinstance(request, dict):
            request = {}
            raise ImageGenerationError("input-read-failed", "请求必须是 JSON 对象")
        artifact = generate_artifact(request)
        artifact.setdefault("toolVersion", TOOL_VERSION)
        artifact.setdefault("generatedAt", int(time.time() * 1000))
    except ImageGenerationError as exc:
        artifact = _blocked(request if "request" in locals() else {}, exc.code, exc.message)
    except Exception as exc:
        artifact = _blocked(request if "request" in locals() else {}, "input-read-failed", str(exc))
    _write(Path(args.output), artifact)
    print(json.dumps(artifact, ensure_ascii=False))
    if artifact["status"] != "accepted": sys.exit(2)


if __name__ == "__main__":
    main()
