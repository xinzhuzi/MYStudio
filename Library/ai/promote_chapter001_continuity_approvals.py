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
from Library.ai.prepare_chapter001_continuity_bibles import (  # noqa: E402
    planned_reference_paths,
    write_new_or_identical,
)


PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec0"
MAX_EVIDENCE_BYTES = 1_000_000
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
CANDIDATE_REVIEW_SCHEMA_VERSION = "daojie-continuity-asset-review-v1"
CANDIDATE_APPROVAL_SCHEMA_VERSION = "daojie-continuity-asset-human-approval-v1"


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


def resolve_record_path(value: Any, label: str) -> Path:
    raw = str(value or "").strip()
    if not raw:
        raise RuntimeError(f"{label}路径为空")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = REPOSITORY_ROOT / path
    return path.resolve()


def validate_bound_file(
    record: Any,
    label: str,
    *,
    expected_path: Path | None = None,
) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise RuntimeError(f"{label}记录无效")
    path = resolve_record_path(record.get("path"), label)
    if expected_path is not None and path != expected_path.resolve():
        raise RuntimeError(f"{label}路径与审核记录不一致")
    if not path.is_file():
        raise RuntimeError(f"{label}文件不存在: {path}")
    expected_hash = str(record.get("sha256") or "").strip().lower()
    if len(expected_hash) != 64 or any(char not in "0123456789abcdef" for char in expected_hash):
        raise RuntimeError(f"{label} SHA-256 无效")
    actual_hash = sha256_path(path)
    if actual_hash != expected_hash:
        raise RuntimeError(f"{label} SHA-256 不匹配")
    return {"path": path, "sha256": actual_hash, "bytes": path.stat().st_size}


def iso_timestamp_ms(value: Any, label: str) -> int:
    raw = str(value or "").strip()
    try:
        timestamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeError(f"{label}不是有效 ISO-8601 时间") from error
    if timestamp.tzinfo is None:
        raise RuntimeError(f"{label}必须包含时区")
    milliseconds = int(timestamp.timestamp() * 1000)
    if milliseconds <= 0:
        raise RuntimeError(f"{label}必须晚于 Unix epoch")
    return milliseconds


def validate_candidate_image(record: Any, label: str) -> dict[str, Any]:
    bound = validate_bound_file(record, label)
    path = bound["path"]
    try:
        with Image.open(path) as image:
            image.load()
            width, height = image.size
            image_format = image.format
    except (OSError, ValueError, UnidentifiedImageError) as error:
        raise RuntimeError(f"{label}无法解码") from error
    if image_format != "PNG" or width <= 0 or height <= 0:
        raise RuntimeError(f"{label}必须是有效 PNG")
    if int(record.get("width") or 0) != width or int(record.get("height") or 0) != height:
        raise RuntimeError(f"{label}尺寸与审核记录不一致")
    if int(record.get("bytes") or 0) != bound["bytes"]:
        raise RuntimeError(f"{label}字节数与审核记录不一致")
    return {**bound, "width": width, "height": height}


def validate_candidate_review(
    review_path: Path,
    asset_id: str,
    evidence_paths: list[Path],
) -> dict[str, Any]:
    review_path = review_path.expanduser().resolve()
    review = load_json_object(review_path, "连续性资产候选审核记录")
    if review.get("schemaVersion") != CANDIDATE_REVIEW_SCHEMA_VERSION:
        raise RuntimeError("连续性资产候选审核 schemaVersion 无效")
    if review.get("status") != "pending-human-review":
        raise RuntimeError("连续性资产候选必须处于 pending-human-review")
    if review.get("assetId") != asset_id:
        raise RuntimeError("连续性资产候选 assetId 与请求不一致")
    if review.get("productionStoreMutated") is not False or review.get("assetApproved") is not False:
        raise RuntimeError("连续性资产候选审核记录已声明生产写入或批准")
    if (review.get("providerRequest") or {}).get("status") != "completed":
        raise RuntimeError("连续性资产候选缺少已完成 provider 请求证据")

    candidate = review.get("reviewCandidate")
    if not isinstance(candidate, dict) or candidate.get("kind") != "non-destructive-tight-crop":
        raise RuntimeError("连续性资产候选必须是已登记的非破坏裁切图")
    candidate_file = validate_candidate_image(candidate, "连续性资产候选图")
    thumbnail = candidate.get("thumbnail")
    if not isinstance(thumbnail, dict):
        raise RuntimeError("连续性资产候选缺少审核缩略图")
    thumbnail_path = resolve_record_path(thumbnail.get("path"), "连续性资产候选缩略图")
    requested_evidence = [path.expanduser().resolve() for path in evidence_paths]
    if requested_evidence != [thumbnail_path]:
        raise RuntimeError("人工批准必须使用候选记录登记的唯一审核缩略图")
    evidence = validate_review_evidence(requested_evidence)
    if evidence[0]["sha256"] != str(thumbnail.get("sha256") or "").lower():
        raise RuntimeError("连续性资产候选缩略图 SHA-256 不匹配")
    for field in ("width", "height", "bytes"):
        if int(thumbnail.get(field) or 0) != int(evidence[0][field]):
            raise RuntimeError(f"连续性资产候选缩略图 {field} 与审核记录不一致")

    color_audit = candidate.get("colorAudit")
    if not isinstance(color_audit, dict) or color_audit.get("status") != "pass":
        raise RuntimeError("连续性资产候选未通过 V2 色彩门")
    ratio = float(color_audit.get("chromaticPixelRatio") or -1)
    band = color_audit.get("chromaticBand")
    if band != [0.3, 0.7] or not 0.3 <= ratio <= 0.7:
        raise RuntimeError("连续性资产候选色彩比例不在 0.30-0.70")
    audit_path = resolve_record_path(color_audit.get("reportPath"), "连续性资产候选色彩报告")
    audit = load_json_object(audit_path, "连续性资产候选色彩报告")
    if (
        audit.get("status") != "pass"
        or audit.get("failedGates") != []
        or float(audit.get("chromaticPixelRatio") or -1) != ratio
        or audit.get("chromaticBand") != band
    ):
        raise RuntimeError("连续性资产候选色彩报告与审核记录不一致")

    semantic = review.get("semanticAssessment") or {}
    required_true = ("flatVermilionImprint", "basketSideCompatible", "shipBowCompatible")
    required_false = ("isPedestalOrPhysicalFireTotem", "containsReadableText", "containsWatermark")
    if any(semantic.get(field) is not True for field in required_true):
        raise RuntimeError("连续性资产候选语义正向检查未通过")
    if any(semantic.get(field) is not False for field in required_false):
        raise RuntimeError("连续性资产候选语义负向检查未通过")
    return {
        "review": review,
        "reviewPath": review_path,
        "reviewSha256": sha256_path(review_path),
        "candidate": candidate_file,
        "evidence": evidence,
    }


def validate_candidate_approval_record(
    approval_record_path: Path,
    candidate_review: dict[str, Any],
    asset_id: str,
) -> dict[str, Any]:
    path = approval_record_path.expanduser().resolve()
    record = load_json_object(path, "连续性资产人工批准记录")
    review = candidate_review["review"]
    if record.get("schemaVersion") != CANDIDATE_APPROVAL_SCHEMA_VERSION:
        raise RuntimeError("连续性资产人工批准 schemaVersion 无效")
    if record.get("status") != "approved" or record.get("reviewer") != "human":
        raise RuntimeError("连续性资产人工批准记录未获人工 approved")
    if not str(record.get("userStatement") or "").strip():
        raise RuntimeError("连续性资产人工批准记录缺少用户原话")
    if (
        record.get("assetId") != asset_id
        or record.get("candidateId") != review.get("candidateId")
    ):
        raise RuntimeError("连续性资产人工批准记录与候选不一致")
    scope = record.get("scope") or {}
    if (
        scope.get("approveCandidateOnly") is not True
        or scope.get("allowNonOverwritingContinuityVersionPromotion") is not True
        or scope.get("allowStoryboardVisualApproval") is not False
        or scope.get("allowAdditionalPaidRequest") is not False
    ):
        raise RuntimeError("连续性资产人工批准范围无效")
    review_binding = validate_bound_file(
        record.get("reviewRecord"),
        "人工批准绑定的审核记录",
        expected_path=candidate_review["reviewPath"],
    )
    if review_binding["sha256"] != candidate_review["reviewSha256"]:
        raise RuntimeError("人工批准绑定的审核记录 SHA-256 不一致")
    approved_image = validate_bound_file(
        record.get("approvedImage"),
        "人工批准绑定的候选图",
        expected_path=candidate_review["candidate"]["path"],
    )
    if approved_image["sha256"] != candidate_review["candidate"]["sha256"]:
        raise RuntimeError("人工批准绑定的候选图 SHA-256 不一致")
    review_evidence = validate_bound_file(
        record.get("reviewEvidence"),
        "人工批准绑定的审核缩略图",
        expected_path=Path(candidate_review["evidence"][0]["path"]),
    )
    if review_evidence["sha256"] != candidate_review["evidence"][0]["sha256"]:
        raise RuntimeError("人工批准绑定的审核缩略图 SHA-256 不一致")
    return {
        "record": record,
        "path": path,
        "sha256": sha256_path(path),
        "reviewedAt": iso_timestamp_ms(record.get("recordedAt"), "人工批准 recordedAt"),
    }


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


def promote_human_approved_candidate(
    store_path: Path,
    review_path: Path,
    approval_record_path: Path,
    asset_id: str,
    version_id: str,
    evidence_paths: list[Path],
    *,
    reason: str | None = None,
    apply: bool = False,
    human_confirmed: bool = False,
) -> dict[str, Any]:
    if apply and not human_confirmed:
        raise RuntimeError("真实写入必须同时提供 --apply 与 --human-confirmed")
    asset_id = asset_id.strip()
    version_id = version_id.strip()
    if not asset_id or not version_id:
        raise RuntimeError("assetId 和 versionId 不能为空")
    expected_version_id = f"{asset_id}:base:v1"
    if version_id != expected_version_id:
        raise RuntimeError(f"当前道具运行时只接受精确版本键 {expected_version_id}")

    candidate_review = validate_candidate_review(review_path, asset_id, evidence_paths)
    human_approval = validate_candidate_approval_record(
        approval_record_path,
        candidate_review,
        asset_id,
    )
    store_path = store_path.expanduser().resolve()
    store = load_json_object(store_path, "Studio workflow store")
    state = store.get("state")
    if not isinstance(state, dict):
        raise RuntimeError("Studio workflow store 缺少 state 对象")
    versions = state.get("continuityAssetVersions")
    if not isinstance(versions, list):
        raise RuntimeError("Studio workflow store 缺少 state.continuityAssetVersions 数组")
    existing = [
        item for item in versions
        if isinstance(item, dict)
        and item.get("assetId") == asset_id
        and item.get("versionId") == version_id
    ]
    if existing:
        raise RuntimeError(f"store 已存在 {asset_id}/{version_id}，拒绝覆盖")

    candidate = candidate_review["candidate"]
    source_path = Path(candidate["path"])
    bible_root = store_path.parent / "continuity-bibles/chapter-001/v5"
    planned_version = {
        "assetId": asset_id,
        "versionId": version_id,
        "assetKind": "prop",
        "referenceImagePaths": [str(source_path)],
    }
    target_path = planned_reference_paths(bible_root, planned_version)[0]
    if target_path.exists() and sha256_path(target_path) != candidate["sha256"]:
        raise RuntimeError(f"拒绝覆盖已有不同连续性资产: {target_path}")

    reviewed_at = int(human_approval["reviewedAt"])
    evidence = candidate_review["evidence"]
    version: dict[str, Any] = {
        "assetId": asset_id,
        "versionId": version_id,
        "assetKind": "prop",
        "label": "chapter-001-base",
        "referenceImagePaths": [str(target_path)],
        "referenceImageSha256": [candidate["sha256"]],
        "reviewEvidencePaths": [item["path"] for item in evidence],
        "reviewEvidenceSha256": [item["sha256"] for item in evidence],
        "reviewEvidenceVerifiedAt": reviewed_at,
        "reviewStatus": "approved",
        "approval": None,
        "approvalFingerprint": None,
        "approved": False,
        "source": f"human-approved-candidate:{candidate_review['review'].get('candidateId')}",
    }
    version = normalize_continuity_asset_version(version)
    approval_reason = str(reason or human_approval["record"].get("userStatement") or "").strip()
    approval: dict[str, Any] = {
        "status": "approved",
        "reviewer": "human",
        "reviewedAt": reviewed_at,
        "evidencePaths": [item["path"] for item in evidence],
        "contentFingerprint": version["contentFingerprint"],
    }
    if approval_reason:
        approval["reason"] = approval_reason
    version["approval"] = approval
    version["approvalFingerprint"] = continuity_asset_approval_fingerprint(version, approval)
    version["approved"] = True
    version["reviewStatus"] = "approved"
    version = normalize_continuity_asset_version(version)
    version["reviewStatus"] = "approved"
    if not version.get("approved"):
        raise RuntimeError("候选资产人工批准未通过运行时指纹校验")

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
    state["continuityAssetVersions"].append(version)
    reference_updates = 0
    for storyboard in storyboards:
        for reference in storyboard.get("orderedReferenceManifest") or []:
            if reference.get("assetId") == asset_id and reference.get("versionId") == version_id:
                reference.update({
                    "imagePath": str(target_path),
                    "referenceImagePaths": [str(target_path)],
                    "referenceImageSha256": [candidate["sha256"]],
                    "contentFingerprint": version["contentFingerprint"],
                    "approvalFingerprint": version["approvalFingerprint"],
                    "approved": True,
                })
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
        raise RuntimeError("候选资产批准不得修改分镜 visualReview 或 stale 状态")

    before_bytes = store_path.read_bytes()
    after_bytes = json_bytes(store)
    target_existed = target_path.exists()
    report: dict[str, Any] = {
        "dryRun": not apply,
        "changed": before_bytes != after_bytes,
        "store": str(store_path),
        "candidateReview": str(candidate_review["reviewPath"]),
        "candidateReviewSha256": candidate_review["reviewSha256"],
        "humanApprovalRecord": str(human_approval["path"]),
        "humanApprovalRecordSha256": human_approval["sha256"],
        "assetId": asset_id,
        "versionId": version_id,
        "contentFingerprint": version["contentFingerprint"],
        "approvalFingerprint": version["approvalFingerprint"],
        "canonicalReference": {
            "sourcePath": str(source_path),
            "targetPath": str(target_path),
            "sha256": candidate["sha256"],
            "targetExistedBefore": target_existed,
        },
        "reviewEvidence": evidence,
        "orderedReferenceUpdates": reference_updates,
        "storyboardReviewsChanged": 0,
        "staleFlagsCleared": 0,
        "assetDatabaseMutated": False,
        "beforeSha256": hashlib.sha256(before_bytes).hexdigest(),
        "afterSha256": hashlib.sha256(after_bytes).hexdigest(),
        "backup": None,
    }
    if apply:
        backup = backup_store(store_path)
        write_new_or_identical(target_path, source_path.read_bytes())
        if sha256_path(target_path) != candidate["sha256"]:
            raise RuntimeError("写入后的连续性资产 SHA-256 不匹配")
        atomic_write_json(store_path, store)
        report["backup"] = str(backup)
        report["backupSha256"] = sha256_path(backup)
        report["writtenSha256"] = sha256_path(store_path)
        report["canonicalReference"]["targetCreated"] = not target_existed
    return report


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
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest", type=Path)
    source.add_argument("--candidate-review", type=Path)
    parser.add_argument("--human-approval-record", type=Path)
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--version-id", required=True)
    parser.add_argument("--evidence", type=Path, action="append", required=True)
    parser.add_argument("--reason")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--human-confirmed", action="store_true")
    args = parser.parse_args()
    if args.candidate_review:
        if args.human_approval_record is None:
            parser.error("--candidate-review 必须同时提供 --human-approval-record")
        report = promote_human_approved_candidate(
            args.store,
            args.candidate_review,
            args.human_approval_record,
            args.asset_id,
            args.version_id,
            args.evidence,
            reason=args.reason,
            apply=args.apply,
            human_confirmed=args.human_confirmed,
        )
    else:
        if args.human_approval_record is not None:
            parser.error("--human-approval-record 仅用于 --candidate-review")
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
