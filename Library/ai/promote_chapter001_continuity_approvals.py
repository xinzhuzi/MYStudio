#!/usr/bin/env python3
"""Promote one explicitly confirmed chapter-001 continuity asset approval.

Dry-run is the default. A real write requires both ``--apply`` and
``--human-confirmed``. The command never approves storyboards or clears stale
state.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from Library.build_daojie_chapter001_workflow import (  # noqa: E402
    continuity_asset_approval_fingerprint,
    continuity_asset_content_fingerprint,
    continuity_asset_structurally_complete,
    normalize_continuity_asset_version,
)


PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec0"
MAX_EVIDENCE_BYTES = 1_000_000
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def default_store_path() -> Path:
    return (
        Path.home()
        / "Library/Application Support/漫影工作室/projects/_p"
        / PROJECT_ID
        / "studio-workflow-store.json"
    )


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_bytes(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def load_json_object(path: Path, label: str) -> dict[str, Any]:
    if not path.is_file():
        raise RuntimeError(f"{label}不存在: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{label}不是有效 JSON: {path}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"{label}根节点必须是对象: {path}")
    return value


def exact_version(
    versions: Any,
    asset_id: str,
    version_id: str,
    label: str,
) -> tuple[int, dict[str, Any]]:
    if not isinstance(versions, list):
        raise RuntimeError(f"{label}缺少 continuityAssetVersions 数组")
    matches = [
        (index, version)
        for index, version in enumerate(versions)
        if isinstance(version, dict)
        and version.get("assetId") == asset_id
        and version.get("versionId") == version_id
    ]
    if len(matches) != 1:
        raise RuntimeError(
            f"{label}中 {asset_id}/{version_id} 精确记录数量应为 1，实际为 {len(matches)}"
        )
    return matches[0]


def validate_content_fingerprint(version: dict[str, Any], label: str) -> str:
    expected = continuity_asset_content_fingerprint(version)
    actual = str(version.get("contentFingerprint") or "")
    if actual != expected:
        raise RuntimeError(f"{label} contentFingerprint 与当前内容不匹配")
    if not continuity_asset_structurally_complete(version):
        raise RuntimeError(f"{label}结构不完整，不能批准")
    return expected


def validate_reference_files(version: dict[str, Any], label: str) -> list[dict[str, Any]]:
    raw_paths = version.get("referenceImagePaths")
    raw_hashes = version.get("referenceImageSha256")
    if not isinstance(raw_paths, list) or not raw_paths:
        raise RuntimeError(f"{label}缺少 canonical reference paths")
    if not isinstance(raw_hashes, list) or len(raw_hashes) != len(raw_paths):
        raise RuntimeError(f"{label}的 reference path/hash 数量不一致")
    evidence: list[dict[str, Any]] = []
    for index, (raw_path, raw_hash) in enumerate(zip(raw_paths, raw_hashes, strict=True), 1):
        path = Path(str(raw_path)).expanduser()
        if not path.is_absolute() or not path.is_file():
            raise RuntimeError(f"{label}第 {index} 张 canonical reference 不存在: {path}")
        expected_hash = str(raw_hash).strip().lower()
        if len(expected_hash) != 64:
            raise RuntimeError(f"{label}第 {index} 张 canonical reference SHA-256 无效")
        actual_hash = sha256_path(path)
        if actual_hash != expected_hash:
            raise RuntimeError(f"{label}第 {index} 张 canonical reference SHA-256 不匹配: {path}")
        evidence.append({"path": str(path), "bytes": path.stat().st_size, "sha256": actual_hash})
    return evidence


def validate_registered_review_evidence(
    version: dict[str, Any],
    label: str,
    reference_count: int,
) -> tuple[list[str], list[str]]:
    raw_paths = version.get("reviewEvidencePaths")
    raw_hashes = version.get("reviewEvidenceSha256")
    if not isinstance(raw_paths, list) or len(raw_paths) != reference_count:
        raise RuntimeError(f"{label}必须为每张 canonical reference 登记一张逐图安全缩略图")
    if not isinstance(raw_hashes, list) or len(raw_hashes) != len(raw_paths):
        raise RuntimeError(f"{label}的审核缩略图 path/hash 数量不一致")
    paths: list[str] = []
    hashes: list[str] = []
    for index, (raw_path, raw_hash) in enumerate(zip(raw_paths, raw_hashes, strict=True), 1):
        path = Path(str(raw_path)).expanduser()
        if not path.is_absolute():
            raise RuntimeError(f"{label}第 {index} 张审核缩略图必须使用绝对路径: {path}")
        expected_hash = str(raw_hash).strip().lower()
        if len(expected_hash) != 64 or any(char not in "0123456789abcdef" for char in expected_hash):
            raise RuntimeError(f"{label}第 {index} 张审核缩略图 SHA-256 无效")
        paths.append(str(path.resolve()))
        hashes.append(expected_hash)
    return paths, hashes


def validate_review_evidence(paths: list[Path]) -> list[dict[str, Any]]:
    if not paths:
        raise RuntimeError("人工批准至少需要一张审核证据缩略图")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw_path in paths:
        path = raw_path.expanduser().resolve()
        if str(path) in seen:
            raise RuntimeError(f"人工审核证据重复: {path}")
        seen.add(str(path))
        if not path.name.endswith("_thumb.png"):
            raise RuntimeError(f"人工审核证据必须是 *_thumb.png: {path}")
        if not path.is_file():
            raise RuntimeError(f"人工审核证据不存在: {path}")
        byte_count = path.stat().st_size
        if byte_count <= 0 or byte_count >= MAX_EVIDENCE_BYTES:
            raise RuntimeError(
                f"人工审核证据必须严格小于 {MAX_EVIDENCE_BYTES} bytes，实际 {byte_count}: {path}"
            )
        with path.open("rb") as handle:
            signature = handle.read(len(PNG_SIGNATURE))
        if signature != PNG_SIGNATURE:
            raise RuntimeError(f"人工审核证据扩展名为 PNG 但内容不是 PNG: {path}")
        try:
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                width, height = image.size
        except (OSError, ValueError, UnidentifiedImageError) as error:
            raise RuntimeError(f"人工审核证据 PNG 无法解码: {path}") from error
        if width <= 0 or height <= 0 or max(width, height) > 768:
            raise RuntimeError(f"人工审核证据最长边必须不超过 768px，实际 {width}x{height}: {path}")
        result.append({
            "path": str(path),
            "width": width,
            "height": height,
            "bytes": byte_count,
            "sha256": sha256_path(path),
        })
    return result


def backup_store(path: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = path.with_name(f"{path.name}.bak-continuity-approval-{stamp}")
    shutil.copy2(path, backup)
    return backup


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.continuity-approval-{os.getpid()}.tmp")
    with temporary.open("xb") as handle:
        handle.write(json_bytes(value))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def promote_human_approval(
    store_path: Path,
    manifest_path: Path,
    asset_id: str,
    version_id: str,
    evidence_paths: list[Path],
    *,
    reason: str | None = None,
    apply: bool = False,
    human_confirmed: bool = False,
    reviewed_at: int | None = None,
) -> dict[str, Any]:
    if apply and not human_confirmed:
        raise RuntimeError("真实写入必须同时提供 --apply 与 --human-confirmed")
    asset_id = asset_id.strip()
    version_id = version_id.strip()
    if not asset_id or not version_id:
        raise RuntimeError("assetId 和 versionId 不能为空")

    store_path = store_path.expanduser().resolve()
    manifest_path = manifest_path.expanduser().resolve()
    store = load_json_object(store_path, "Studio workflow store")
    manifest = load_json_object(manifest_path, "连续性资产 manifest")
    state = store.get("state")
    if not isinstance(state, dict):
        raise RuntimeError("Studio workflow store 缺少 state 对象")

    manifest_index, manifest_version = exact_version(
        manifest.get("continuityAssetVersions"), asset_id, version_id, "manifest"
    )
    store_index, store_version = exact_version(
        state.get("continuityAssetVersions"), asset_id, version_id, "store"
    )
    if (
        manifest_version.get("reviewStatus") != "pending"
        or manifest_version.get("approval") is not None
        or manifest_version.get("approved") is not False
    ):
        raise RuntimeError("manifest 选中版本必须仍为 pending 且未经批准")
    if store_version.get("approval") is not None or store_version.get("approved") is not False:
        raise RuntimeError("store 选中版本已经存在审核结果，拒绝重复推广")

    manifest_fingerprint = validate_content_fingerprint(manifest_version, "manifest 版本")
    store_fingerprint = validate_content_fingerprint(store_version, "store 版本")
    if manifest_fingerprint != store_fingerprint:
        raise RuntimeError("manifest/store contentFingerprint 不一致")
    canonical_references = validate_reference_files(manifest_version, "manifest 版本")
    validate_reference_files(store_version, "store 版本")
    manifest_evidence_paths, manifest_evidence_hashes = validate_registered_review_evidence(
        manifest_version, "manifest 版本", len(canonical_references)
    )
    store_evidence_paths, store_evidence_hashes = validate_registered_review_evidence(
        store_version, "store 版本", len(canonical_references)
    )
    if (
        manifest_evidence_paths != store_evidence_paths
        or manifest_evidence_hashes != store_evidence_hashes
    ):
        raise RuntimeError("manifest/store 登记的逐图安全缩略图不一致")
    requested_evidence_paths = [str(path.expanduser().resolve()) for path in evidence_paths]
    if requested_evidence_paths != manifest_evidence_paths:
        raise RuntimeError("人工批准必须逐张使用 manifest/store 登记的逐图安全缩略图")
    review_evidence = validate_review_evidence(evidence_paths)
    for index, (item, expected_hash) in enumerate(zip(review_evidence, manifest_evidence_hashes, strict=True), 1):
        if item["sha256"] != expected_hash:
            raise RuntimeError(f"第 {index} 张人工审核证据 SHA-256 与登记值不匹配")

    storyboards = state.get("storyboards")
    if not isinstance(storyboards, list):
        raise RuntimeError("Studio workflow store 缺少 state.storyboards 数组")
    storyboard_guard = [
        {
            "id": storyboard.get("id"),
            "visualReview": copy.deepcopy(storyboard.get("visualReview")),
            "stale": storyboard.get("stale"),
            "staleReason": storyboard.get("staleReason"),
            "staleSince": storyboard.get("staleSince"),
        }
        for storyboard in storyboards
    ]

    timestamp = reviewed_at if reviewed_at is not None else int(datetime.now(timezone.utc).timestamp() * 1000)
    if not isinstance(timestamp, int) or isinstance(timestamp, bool) or timestamp <= 0:
        raise RuntimeError("人工审核时间必须是正整数毫秒时间戳")
    approval: dict[str, Any] = {
        "status": "approved",
        "reviewer": "human",
        "reviewedAt": timestamp,
        "evidencePaths": [item["path"] for item in review_evidence],
        "contentFingerprint": store_fingerprint,
    }
    normalized_reason = (reason or "").strip()
    if normalized_reason:
        approval["reason"] = normalized_reason

    promoted = copy.deepcopy(store_version)
    promoted["reviewStatus"] = "approved"
    promoted["reviewEvidenceVerifiedAt"] = timestamp
    promoted["approval"] = approval
    promoted["approvalFingerprint"] = continuity_asset_approval_fingerprint(promoted, approval)
    promoted["approved"] = True
    promoted = normalize_continuity_asset_version(promoted)
    if not promoted.get("approved"):
        raise RuntimeError("生成的人工批准未通过运行时指纹校验")
    if promoted.get("contentFingerprint") != store_fingerprint:
        raise RuntimeError("人工批准推广意外改变了资产内容指纹")

    state["continuityAssetVersions"][store_index] = promoted
    reference_updates = 0
    for storyboard in storyboards:
        for reference in storyboard.get("orderedReferenceManifest") or []:
            if reference.get("assetId") == asset_id and reference.get("versionId") == version_id:
                reference["contentFingerprint"] = promoted["contentFingerprint"]
                reference["approvalFingerprint"] = promoted["approvalFingerprint"]
                reference["approved"] = True
                reference_updates += 1

    after_storyboard_guard = [
        {
            "id": storyboard.get("id"),
            "visualReview": copy.deepcopy(storyboard.get("visualReview")),
            "stale": storyboard.get("stale"),
            "staleReason": storyboard.get("staleReason"),
            "staleSince": storyboard.get("staleSince"),
        }
        for storyboard in storyboards
    ]
    if after_storyboard_guard != storyboard_guard:
        raise RuntimeError("批准推广不得修改分镜 visualReview 或 stale 状态")

    before_bytes = store_path.read_bytes()
    after_bytes = json_bytes(store)
    report: dict[str, Any] = {
        "dryRun": not apply,
        "changed": before_bytes != after_bytes,
        "store": str(store_path),
        "manifest": str(manifest_path),
        "manifestVersionIndex": manifest_index,
        "storeVersionIndex": store_index,
        "assetId": asset_id,
        "versionId": version_id,
        "contentFingerprint": store_fingerprint,
        "approvalFingerprint": promoted["approvalFingerprint"],
        "canonicalReferences": canonical_references,
        "reviewEvidence": review_evidence,
        "orderedReferenceUpdates": reference_updates,
        "storyboardReviewsChanged": 0,
        "staleFlagsCleared": 0,
        "beforeSha256": hashlib.sha256(before_bytes).hexdigest(),
        "afterSha256": hashlib.sha256(after_bytes).hexdigest(),
        "backup": None,
    }
    if apply:
        backup = backup_store(store_path)
        atomic_write_json(store_path, store)
        report["backup"] = str(backup)
        report["backupSha256"] = sha256_path(backup)
        report["writtenSha256"] = sha256_path(store_path)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="安全推广一个已获人工明确确认的第一章连续性资产版本",
    )
    parser.add_argument("--store", type=Path, default=default_store_path())
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--version-id", required=True)
    parser.add_argument("--evidence", type=Path, action="append", required=True)
    parser.add_argument("--reason")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--human-confirmed", action="store_true")
    args = parser.parse_args()
    report = promote_human_approval(
        args.store,
        args.manifest,
        args.asset_id,
        args.version_id,
        args.evidence,
        reason=args.reason,
        apply=args.apply,
        human_confirmed=args.human_confirmed,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
