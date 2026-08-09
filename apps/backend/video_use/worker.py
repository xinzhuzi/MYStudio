from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

from . import __version__
from .adapter import VideoUseAdapterError, run_pinned_adapter
from .alignment import AlignmentError

UPSTREAM_COMMIT = "92c2b34e44c205cbc2acae7f6ca7c1c219d5dd66"
UPSTREAM_SOURCE_URL = "https://github.com/browser-use/video-use"
UPSTREAM_MANIFEST_NAME = "mystudio-video-use-manifest.json"
REQUIRED_HELPERS = (
    "helpers/render.py",
    "helpers/grade.py",
    "helpers/timeline_view.py",
    "helpers/pack_transcripts.py",
)


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


def _profile_upstream_root(profile_path: str | None) -> str:
    if not profile_path:
        return ""
    profile = _read_json(Path(profile_path))
    value = profile.get("upstreamRoot") if profile else None
    return value.strip() if isinstance(value, str) else ""


def _resolve_upstream_root(upstream_root: str | None, profile_path: str | None) -> str:
    explicit = (upstream_root or "").strip()
    if explicit:
        return explicit
    from_profile = _profile_upstream_root(profile_path)
    if from_profile:
        return from_profile
    return os.environ.get("MYSTUDIO_VIDEO_USE_UPSTREAM_ROOT", "").strip()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _inspect_upstream(
    upstream_root: str | None,
    profile_path: str | None = None,
) -> dict[str, Any]:
    configured_root = _resolve_upstream_root(upstream_root, profile_path)
    if not configured_root:
        return {"ready": False, "status": "needs-upstream", "code": "upstream-runtime-missing", "message": "pinned video-use upstream is not prepared"}
    root = Path(configured_root).expanduser()
    if not root.is_absolute():
        return {"ready": False, "status": "blocked", "code": "upstream-root-not-absolute", "message": "video-use upstream root 必须是绝对路径", "upstreamRoot": str(root)}
    if not root.is_dir():
        return {"ready": False, "status": "needs-upstream", "code": "upstream-root-missing", "message": "pinned video-use upstream 目录不存在", "upstreamRoot": str(root)}
    profile = _read_json(Path(profile_path)) if profile_path else None
    if profile and profile.get("sourceCommit") != UPSTREAM_COMMIT:
        return {"ready": False, "status": "blocked", "code": "profile-commit-mismatch", "message": "video-use profile marker 的 sourceCommit 与固定 commit 不一致", "upstreamRoot": str(root)}
    manifest_path = root / UPSTREAM_MANIFEST_NAME
    manifest = _read_json(manifest_path)
    if not manifest:
        return {"ready": False, "status": "blocked", "code": "upstream-manifest-missing", "message": f"缺少 {UPSTREAM_MANIFEST_NAME}，拒绝信任未核验 checkout", "upstreamRoot": str(root)}
    if manifest.get("schemaVersion") != 1 or manifest.get("sourceUrl") != UPSTREAM_SOURCE_URL or manifest.get("sourceCommit") != UPSTREAM_COMMIT:
        return {"ready": False, "status": "blocked", "code": "upstream-manifest-mismatch", "message": "video-use upstream manifest 的 schema/source/commit 不匹配", "upstreamRoot": str(root), "manifestPath": str(manifest_path)}
    helper_hashes = manifest.get("helperSha256")
    if not isinstance(helper_hashes, dict):
        return {"ready": False, "status": "blocked", "code": "upstream-helper-hash-missing", "message": "upstream manifest 缺少 helperSha256", "upstreamRoot": str(root), "manifestPath": str(manifest_path)}
    helper_paths: dict[str, str] = {}
    for relative_path in REQUIRED_HELPERS:
        helper = root / relative_path
        declared_hash = helper_hashes.get(relative_path)
        if not helper.is_file():
            return {"ready": False, "status": "blocked", "code": "upstream-helper-missing", "message": f"缺少固定 video-use helper: {relative_path}", "upstreamRoot": str(root), "manifestPath": str(manifest_path), "helperPaths": helper_paths}
        if not isinstance(declared_hash, str) or len(declared_hash) != 64 or declared_hash.lower() != _sha256(helper):
            return {"ready": False, "status": "blocked", "code": "upstream-helper-hash-mismatch", "message": f"video-use helper SHA-256 不匹配: {relative_path}", "upstreamRoot": str(root), "manifestPath": str(manifest_path), "helperPaths": helper_paths}
        helper_paths[relative_path] = str(helper)
    return {"ready": True, "status": "ready", "code": "upstream-ready", "message": "pinned upstream helpers 已通过 commit/schema/hash 校验", "upstreamRoot": str(root), "manifestPath": str(manifest_path), "helperPaths": helper_paths}


def _probe(
    profile_path: str | None = None,
    upstream_root: str | None = None,
    ffmpeg_path: str | None = None,
    ffprobe_path: str | None = None,
) -> int:
    inspection = _inspect_upstream(upstream_root, profile_path)
    payload = {
        "schemaVersion": 1,
        "status": inspection["status"],
        "code": inspection["code"],
        "workerVersion": __version__,
        "upstreamCommit": UPSTREAM_COMMIT,
        "upstreamReady": bool(inspection["ready"]),
        "upstreamRoot": inspection.get("upstreamRoot"),
        "manifestPath": inspection.get("manifestPath"),
        "helperPaths": inspection.get("helperPaths", {}),
        "profilePath": profile_path,
        "ffmpegPath": ffmpeg_path,
        "ffprobePath": ffprobe_path,
        "message": inspection["message"],
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0 if inspection["ready"] else 2


def _probe_alignment() -> int:
    """Check both local Whisper model and tokenizer snapshots without loading MLX."""
    from .alignment import ALIGNMENT_MODEL_REPO, ALIGNMENT_TOKENIZER_REPO, AlignmentError, _snapshot_for_repo

    try:
        model_snapshot = _snapshot_for_repo(ALIGNMENT_MODEL_REPO)
        tokenizer_snapshot = _snapshot_for_repo(ALIGNMENT_TOKENIZER_REPO)
    except AlignmentError as error:
        payload = {
            "schemaVersion": 1,
            "status": "blocked",
            "code": error.code,
            "modelRepo": ALIGNMENT_MODEL_REPO,
            "tokenizerRepo": ALIGNMENT_TOKENIZER_REPO,
            "message": str(error),
        }
        print(json.dumps(payload, ensure_ascii=False))
        return 2
    payload = {
        "schemaVersion": 1,
        "status": "ready",
        "code": "alignment-model-ready",
        "modelRepo": ALIGNMENT_MODEL_REPO,
        "tokenizerRepo": ALIGNMENT_TOKENIZER_REPO,
        "modelSnapshot": str(model_snapshot),
        "tokenizerSnapshot": str(tokenizer_snapshot),
        "message": "本地 Whisper 模型与 tokenizer 已准备",
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def _run(
    input_path: Path,
    output_path: Path,
    profile_path: str | None = None,
    upstream_root: str | None = None,
    ffmpeg_path: str | None = None,
    ffprobe_path: str | None = None,
    alignment_path: str | None = None,
) -> int:
    try:
        request = json.loads(input_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        _write_json(output_path, {"schemaVersion": 1, "status": "blocked", "code": "invalid-input", "message": str(error)})
        return 2
    if not isinstance(request, dict):
        _write_json(output_path, {"schemaVersion": 1, "status": "blocked", "code": "invalid-input", "message": "request must be an object"})
        return 2
    inspection = _inspect_upstream(upstream_root, profile_path)
    if not inspection["ready"]:
        _write_json(output_path, {
            "schemaVersion": 1,
            "status": inspection["status"] if inspection["status"] != "needs-upstream" else "blocked",
            "code": inspection["code"],
            "message": f"{inspection['message']}; no artifact was generated",
            "upstreamCommit": UPSTREAM_COMMIT,
        })
        return 2
    if not alignment_path:
        _write_json(output_path, {
            "schemaVersion": 1,
            "status": "blocked",
            "code": "alignment-missing",
            "message": "video-use 正式阶段必须提供 ready alignment artifact",
            "upstreamCommit": UPSTREAM_COMMIT,
        })
        return 2
    alignment_file = Path(alignment_path).expanduser()
    if not alignment_file.is_absolute():
        _write_json(output_path, {
            "schemaVersion": 1,
            "status": "blocked",
            "code": "alignment-path-not-absolute",
            "message": "alignment artifact 路径必须是绝对路径",
            "upstreamCommit": UPSTREAM_COMMIT,
        })
        return 2
    alignment = _read_json(alignment_file)
    if alignment is None:
        _write_json(output_path, {
            "schemaVersion": 1,
            "status": "blocked",
            "code": "alignment-invalid",
            "message": f"无法读取 alignment artifact: {alignment_path}",
            "upstreamCommit": UPSTREAM_COMMIT,
        })
        return 2
    try:
        artifact = run_pinned_adapter(
            request,
            alignment,
            upstream_root=Path(str(inspection["upstreamRoot"])),
            ffmpeg_path=str(ffmpeg_path or ""),
            ffprobe_path=str(ffprobe_path or ""),
            artifact_path=output_path,
            now_ms=int(time.time() * 1000),
        )
    except (VideoUseAdapterError, AlignmentError) as error:
        _write_json(output_path, {
            "schemaVersion": 1,
            "status": "blocked",
            "code": error.code,
            "message": str(error),
            "projectId": request.get("projectId"),
            "chapterId": request.get("chapterId"),
            "revision": request.get("revision"),
            "upstreamCommit": UPSTREAM_COMMIT,
        })
        return 2
    except Exception as error:
        _write_json(output_path, {
            "schemaVersion": 1,
            "status": "blocked",
            "code": "adapter-failed",
            "message": f"video-use adapter 失败: {error}",
            "projectId": request.get("projectId"),
            "chapterId": request.get("chapterId"),
            "revision": request.get("revision"),
            "upstreamCommit": UPSTREAM_COMMIT,
        })
        return 2
    if artifact.get("status") != "pending" or artifact.get("stage") != "awaiting-review":
        _write_json(output_path, {
            "schemaVersion": 1,
            "status": "blocked",
            "code": "artifact-not-reviewable",
            "message": "video-use adapter 必须返回 awaiting-review/pending artifact，等待用户确认",
            "projectId": request.get("projectId"),
            "chapterId": request.get("chapterId"),
            "revision": request.get("revision"),
            "upstreamCommit": UPSTREAM_COMMIT,
        })
        return 2
    _write_json(output_path, artifact)
    return 0


def _align(
    input_path: Path,
    output_path: Path,
    model_path: str | None = None,
    tokenizer_path: str | None = None,
) -> int:
    """Run canonical local MLX alignment before the video-use adapter.

    This command intentionally does not inspect or download the pinned
    video-use checkout. It only reuses the managed Python and already-cached
    Whisper model/tokenizer; missing cache entries are a blocking result.
    """

    try:
        request = json.loads(input_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        _write_json(output_path, {"schemaVersion": 1, "status": "blocked", "code": "invalid-input", "message": str(error)})
        return 2
    if not isinstance(request, dict):
        _write_json(output_path, {"schemaVersion": 1, "status": "blocked", "code": "invalid-input", "message": "request must be an object"})
        return 2
    try:
        from .alignment import AlignmentError, align_chapter

        result = align_chapter(
            request,
            model_path=Path(model_path).expanduser() if model_path else None,
            tokenizer_path=Path(tokenizer_path).expanduser() if tokenizer_path else None,
        )
    except AlignmentError as error:
        _write_json(output_path, {
            "schemaVersion": 1,
            "status": "blocked",
            "code": error.code,
            "message": str(error),
            "projectId": request.get("projectId"),
            "chapterId": request.get("chapterId"),
            "revision": request.get("revision"),
        })
        return 2
    except Exception as error:
        _write_json(output_path, {
            "schemaVersion": 1,
            "status": "blocked",
            "code": "alignment-failed",
            "message": f"MLX 原文强制对齐失败: {error}",
        })
        return 2
    _write_json(output_path, result)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="MYStudio video-use worker boundary")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--probe-alignment", action="store_true")
    parser.add_argument("--align", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--alignment-model")
    parser.add_argument("--alignment-tokenizer")
    parser.add_argument("--alignment")
    parser.add_argument("--profile")
    parser.add_argument("--upstream-root")
    parser.add_argument("--ffmpeg")
    parser.add_argument("--ffprobe")
    args = parser.parse_args()
    if args.probe:
        return _probe(args.profile, args.upstream_root, args.ffmpeg, args.ffprobe)
    if args.probe_alignment:
        return _probe_alignment()
    if args.align and args.input and args.output:
        return _align(Path(args.input), Path(args.output), args.alignment_model, args.alignment_tokenizer)
    if args.run and args.input and args.output:
        return _run(
            Path(args.input),
            Path(args.output),
            args.profile,
            args.upstream_root,
            args.ffmpeg,
            args.ffprobe,
            args.alignment,
        )
    parser.error("必须指定 --probe，或 --align/--run --input <path> --output <path>")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
