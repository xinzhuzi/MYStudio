#!/usr/bin/env python3
"""Generate a non-destructive chapter-001 continuity sample.

The runner reuses the production Daojie prompt/reference builders, writes only
to apps/output/automation, and never mutates the real project store or images.
Provider credentials are read from the existing MYSTUDIO_IMAGE_* environment
contract and are never written to the report.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps

try:
    from Library.ai import daojie_gongbi_v2
except ModuleNotFoundError:
    from ai import daojie_gongbi_v2


REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATOR_PATH = REPO_ROOT / "Library/build_daojie_chapter001_workflow.py"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "apps/output/automation/daojie-chapter001-continuity-sample"
DEFAULT_PAID_REQUEST_LEDGER = REPO_ROOT / "apps/output/automation/daojie-chapter001-paid-image-request-ledger.jsonl"
WATERMARK_TEST_VARIANT = (
    "【水印复测硬约束】最终画面的任何像素均不得包含平台标识、角标、半透明标志、"
    "签名、文字水印或 logo；不得以裁剪、遮挡、涂抹或留白规避该要求。"
)


def load_generator():
    spec = importlib.util.spec_from_file_location("daojie_chapter001_workflow", GENERATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载生成器: {GENERATOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def dry_run_provider_config(generator) -> dict[str, Any]:
    manifest = daojie_gongbi_v2.load_reference_capability_manifest()
    verified = [
        item for item in manifest["capabilities"]
        if isinstance(item, dict) and item.get("status") == "verified"
    ]
    if len(verified) != 1:
        raise RuntimeError(
            "零网络 dry-run 必须在能力清单中恰好找到一个 verified provider/model；"
            f"当前数量={len(verified)}"
        )
    capability = verified[0]
    return generator.with_daojie_gongbi_v2_contract({
        "providerName": capability["providerName"],
        "model": capability["model"],
        "aspectRatio": "16:9",
        "resolution": "1K",
        "asyncMode": False,
        "requestMode": capability.get("requestMode") or generator.REQUEST_MODE_GENERATIONS_JSON,
        "dryRunCapabilityOnly": True,
    })


def parse_shots(value: str) -> list[int]:
    indexes: set[int] = set()
    for part in value.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            start_text, end_text = token.split("-", 1)
            start, end = int(start_text), int(end_text)
            if start > end:
                raise argparse.ArgumentTypeError(f"镜头范围倒置: {token}")
            indexes.update(range(start, end + 1))
        else:
            indexes.add(int(token))
    if not indexes or min(indexes) < 1 or max(indexes) > 43:
        raise argparse.ArgumentTypeError("镜头范围必须位于 1..43")
    return sorted(indexes)


def parse_review_checks(values: list[str]) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    for value in values:
        field, separator, raw_status = str(value).partition("=")
        field = field.strip()
        status = raw_status.strip().lower()
        if not separator or field not in daojie_gongbi_v2.HUMAN_REVIEW_CHECKLIST_FIELDS:
            raise RuntimeError("--review-check 必须是受支持的 项目=true|false")
        if status not in {"true", "false"} or field in checks:
            raise RuntimeError("--review-check 必须为不重复的 项目=true|false")
        checks[field] = status == "true"
    return checks


def generation_attempt_id(output_dir: Path, index: int, output_path: Path) -> str:
    output_scope = hashlib.sha256(str(output_dir.resolve()).encode("utf-8")).hexdigest()[:12]
    return f"{output_scope}:shot-{index:03d}:{output_path.stem}"


def generation_failure_status(request_event: dict[str, Any] | None) -> str:
    if str((request_event or {}).get("status") or "").upper() == "COMPLETED":
        return "provider-completed-local-failure"
    return "failed-or-ambiguous"


def selected_continuity_groups(source_shots: list[dict[str, Any]], shots: list[int]) -> list[dict[str, Any]]:
    if shots != sorted(set(shots)):
        raise RuntimeError("连续性镜头必须按升序且不能重复")
    source_by_index = {int(shot.get("index") or 0): shot for shot in source_shots}
    groups: list[dict[str, Any]] = []
    selected_by_group: dict[str, list[int]] = {}
    group_by_id: dict[str, dict[str, Any]] = {}
    for index in shots:
        source_shot = source_by_index.get(index)
        if not source_shot:
            raise RuntimeError(f"分镜 {index:03d} 不在当前分镜源中")
        group = source_shot.get("_continuityGroup")
        if not isinstance(group, dict) or not group.get("groupId"):
            raise RuntimeError(f"分镜 {index:03d} 缺少由当前分镜源推导的连续镜头组")
        group_id = str(group["groupId"])
        selected_by_group.setdefault(group_id, []).append(index)
        group_by_id[group_id] = group
    for group_id, group_shots in selected_by_group.items():
        group = group_by_id[group_id]
        expected = list(range(group_shots[0], group_shots[-1] + 1))
        if group_shots != expected:
            raise RuntimeError(f"连续镜头组 {group['groupId']} 只能选择连续镜头")
        groups.append({
            "groupId": group["groupId"],
            "start": group["start"],
            "end": group["end"],
            "sceneName": group["sceneName"],
            "viewpointId": group["viewpointId"],
            "shots": group_shots,
        })
    return groups


def invalidate_restart_state(
    source_shots: list[dict[str, Any]],
    shots: list[int],
    entries_by_index: dict[int, dict[str, Any]],
    approvals: dict[str, Any],
    restart_index: int,
) -> tuple[dict[int, dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    if restart_index not in shots:
        raise RuntimeError(f"重跑镜头 {restart_index:03d} 不在本次连续性范围内")
    source_shot = next((shot for shot in source_shots if int(shot.get("index") or 0) == restart_index), None)
    group = source_shot.get("_continuityGroup") if source_shot else None
    if not isinstance(group, dict):
        raise RuntimeError(f"重跑镜头 {restart_index:03d} 缺少由当前分镜源推导的连续镜头组")
    affected = {
        index for index in shots
        if restart_index <= index <= group["end"]
    }
    next_entries = dict(entries_by_index)
    next_approvals = json.loads(json.dumps(approvals))
    current_approvals = next_approvals.setdefault("approvals", {})
    superseded: list[dict[str, Any]] = []
    for index in sorted(affected):
        entry = next_entries.pop(index, None)
        approval = current_approvals.pop(str(index), None)
        if entry:
            superseded.append({**entry, "approval": approval})
    return next_entries, next_approvals, superseded


def next_revision_output_path(output_dir: Path, index: int) -> Path:
    base = output_dir / f"shot-{index:03d}.png"
    if not base.exists():
        return base
    revision = 2
    while True:
        candidate = output_dir / f"shot-{index:03d}-r{revision:02d}.png"
        if not candidate.exists():
            return candidate
        revision += 1


def apply_watermark_test_variant(final_prompt: str, enabled: bool) -> str:
    if not enabled:
        return final_prompt
    return f"{final_prompt} {WATERMARK_TEST_VARIANT}".strip()


def required_previous_selected_shot(
    continuity_state: dict[str, Any],
    shots: list[int],
    index: int,
) -> int | None:
    previous_storyboard_id = str(continuity_state.get("previousStoryboardId") or "")
    if not previous_storyboard_id:
        return None
    previous_index = index - 1
    if previous_index not in shots:
        return None
    expected_id = f"sb-chapter-001-{previous_index:03d}"
    if previous_storyboard_id != expected_id:
        raise RuntimeError(
            f"分镜 {index:03d} 连续关系应承接 {expected_id}，实际为 {previous_storyboard_id}"
        )
    return previous_index


def merge_planned_continuity_versions(
    planned: dict[str, dict[str, Any]],
    versions: list[dict[str, Any]],
) -> None:
    for version in versions:
        key = f"{version.get('assetId', '')}:{version.get('versionId', '')}"
        previous = planned.get(key)
        if previous and previous.get("contentFingerprint") != version.get("contentFingerprint"):
            raise RuntimeError(f"连续性资产版本 {key} 在不同镜头间发生内容指纹冲突")
        planned[key] = version


def stable_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def existing_storyboards(state: dict[str, Any], episode_id: str) -> dict[int, dict[str, Any]]:
    return {
        int(item.get("index") or 0): item
        for item in state.get("storyboards") or []
        if item.get("episodeId") == episode_id and int(item.get("index") or 0) > 0
    }


def continuity_payload(
    generator,
    index: int,
    prompt: str,
    image_assets: list[dict[str, Any]],
    existing: dict[str, Any],
    existing_versions_by_key: dict[str, dict[str, Any]] | None = None,
    shot_semantics: dict[str, Any] | None = None,
    continuity_group: dict[str, Any] | None = None,
):
    return generator.build_storyboard_continuity_payload(
        index,
        prompt,
        image_assets,
        existing,
        existing_versions_by_key,
        shot_semantics,
        continuity_group,
    )


def continuity_references(generator, image_assets: list[dict[str, Any]], manifest: list[dict[str, Any]]):
    assets = generator.apply_continuity_manifest_to_image_assets(image_assets, manifest)
    return generator.collect_storyboard_reference_images(assets)


def build_contact_sheet(image_paths: list[Path], output_path: Path) -> None:
    thumb_size = (480, 270)
    label_height = 38
    columns = 2
    rows = (len(image_paths) + columns - 1) // columns
    sheet = Image.new("RGB", (thumb_size[0] * columns, (thumb_size[1] + label_height) * rows), "#eee9df")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for offset, path in enumerate(image_paths):
        image = Image.open(path).convert("RGB")
        image = ImageOps.fit(image, thumb_size, method=Image.Resampling.LANCZOS)
        x = (offset % columns) * thumb_size[0]
        y = (offset // columns) * (thumb_size[1] + label_height)
        sheet.paste(image, (x, y))
        draw.text((x + 12, y + thumb_size[1] + 10), path.stem, fill="#171717", font=font)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, quality=92)


def load_json_file(path: Path, fallback: Any) -> Any:
    if not path.is_file():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.continuity.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def append_generation_attempt(path: Path, record: dict[str, Any]) -> None:
    """Append a provider-attempt event without persisting credentials."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()


def load_generation_attempt_events(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    events: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"生成尝试账本第 {line_number} 行无法解析") from error
        if not isinstance(value, dict) or not value.get("attemptId"):
            raise RuntimeError(f"生成尝试账本第 {line_number} 行缺少 attemptId")
        events.append(value)
    return events


def summarize_generation_attempts(path: Path) -> dict[str, Any]:
    events = load_generation_attempt_events(path)
    latest: dict[str, dict[str, Any]] = {}
    for event in events:
        latest[str(event["attemptId"])] = event
    statuses: dict[str, int] = {}
    for event in latest.values():
        status = str(event.get("status") or "unknown")
        statuses[status] = statuses.get(status, 0) + 1
    return {
        "path": str(path) if path.is_file() else None,
        "events": events,
        "attemptCount": len(latest),
        "statusCounts": statuses,
        "openAttemptIds": sorted(
            attempt_id
            for attempt_id, event in latest.items()
            if event.get("status") == "started"
        ),
    }


def summarize_reference_capabilities(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarize per-shot V2 evidence without treating a dry run as provider proof."""
    blocked_shots: list[int] = []
    reason_counts: dict[str, int] = {}
    bindings: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in entries:
        capability = entry.get("referenceCapability") or {}
        roles = list(entry.get("referenceRoles") or [])
        index = int(entry.get("index") or 0)
        reason = ""
        try:
            daojie_gongbi_v2.assert_reference_capability(capability, roles)
        except RuntimeError as error:
            reason = str(error)
            blocked_shots.append(index)
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
        binding = (
            str(capability.get("providerName") or "unconfigured"),
            str(capability.get("model") or "unconfigured"),
        )
        bindings.setdefault(binding, {
            "providerName": binding[0],
            "model": binding[1],
            "status": capability.get("status") or "unverified",
            "acceptedReferenceRoleOrder": capability.get("referenceRoleOrder"),
            "supportedReferenceCount": capability.get("supportedReferenceCount"),
            "requestMode": capability.get("requestMode"),
            "referenceTransportStrategy": capability.get("referenceTransportStrategy"),
            "evidence": capability.get("evidence"),
            "transportEvidence": capability.get("transportEvidence"),
            "semanticRoleEvidence": daojie_gongbi_v2.reference_semantic_role_evidence(capability),
            "styleReference": capability.get("styleReference"),
            "requestedRoleOrders": [],
            "requestedSourceReferenceCounts": [],
            "requestedProviderReferenceCounts": [],
            "blockingReasons": [],
        })
        binding_report = bindings[binding]
        if roles not in binding_report["requestedRoleOrders"]:
            binding_report["requestedRoleOrders"].append(roles)
        transport = entry.get("referenceTransport") or {}
        source_count = transport.get("sourceReferenceCount")
        provider_count = transport.get("providerReferenceCount")
        if isinstance(source_count, int) and source_count not in binding_report["requestedSourceReferenceCounts"]:
            binding_report["requestedSourceReferenceCounts"].append(source_count)
        if isinstance(provider_count, int) and provider_count not in binding_report["requestedProviderReferenceCounts"]:
            binding_report["requestedProviderReferenceCounts"].append(provider_count)
        if reason and reason not in binding_report["blockingReasons"]:
            binding_report["blockingReasons"].append(reason)
    return {
        "schemaVersion": daojie_gongbi_v2.REFERENCE_CAPABILITY_SCHEMA_VERSION,
        "styleContractVersion": daojie_gongbi_v2.STYLE_CONTRACT_VERSION,
        "status": "ready" if entries and not blocked_shots else "blocked",
        "requestAllowed": bool(entries) and not blocked_shots,
        "shotCount": len(entries),
        "verifiedShotCount": len(entries) - len(blocked_shots),
        "blockedShotIndexes": blocked_shots,
        "blockingReasons": reason_counts,
        "providerModels": list(bindings.values()),
    }


def summarize_reference_visual_audits(entries: list[dict[str, Any]]) -> dict[str, Any]:
    blocked = []
    reason_counts: dict[str, int] = {}
    for entry in entries:
        audit = entry.get("referenceVisualAudit") or {}
        if audit.get("status") == "pass":
            continue
        index = int(entry.get("index") or 0)
        blocked.append(index)
        for reason in audit.get("failedGates") or ["missing_reference_visual_audit"]:
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
    return {
        "schemaVersion": "daojie-reference-visual-audit-summary-v1",
        "status": "blocked" if blocked else "ready",
        "requestAllowed": bool(entries) and not blocked,
        "shotCount": len(entries),
        "blockedShotIndexes": blocked,
        "blockingReasons": reason_counts,
    }


def latest_paid_request_event(path: Path, attempt_id: str) -> dict[str, Any] | None:
    """Read the latest redacted cross-output provider event for one attempt."""
    if not path.is_file():
        return None
    latest = None
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"付费请求账本第 {line_number} 行无法解析") from error
        if isinstance(event, dict) and event.get("attemptId") == attempt_id:
            latest = event
    return latest


def human_approval_fingerprint(record: dict[str, Any]) -> str:
    payload = {
        key: record.get(key)
        for key in (
            "storyboardId", "index", "status", "reviewer", "reviewedAt",
            "reason", "evidencePath", "outputPath", "outputSha256", "reviewChecklist",
        )
        if record.get(key) is not None
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def valid_human_review(
    approvals: dict[str, Any],
    index: int,
    entry: dict[str, Any],
    expected_status: str,
) -> dict[str, Any] | None:
    record = (approvals.get("approvals") or {}).get(str(index))
    if not isinstance(record, dict):
        return None
    output_path = Path(str(entry.get("outputPath") or ""))
    evidence_path = Path(str(record.get("evidencePath") or ""))
    transfer_thumbnail = entry.get("transferThumbnail") or {}
    transfer_thumbnail_path = Path(str(transfer_thumbnail.get("path") or ""))
    requires_v2_checklist = entry.get("styleContractVersion") == daojie_gongbi_v2.STYLE_CONTRACT_VERSION
    valid = bool(
        record.get("status") == expected_status
        and record.get("reviewer") == "human"
        and int(record.get("reviewedAt") or 0) > 0
        and (expected_status != "rejected" or bool(str(record.get("reason") or "").strip()))
        and output_path.is_file()
        and Path(str(record.get("outputPath") or "")).resolve() == output_path.resolve()
        and record.get("outputSha256") == entry.get("outputSha256")
        and evidence_path.is_file()
        and evidence_path.name.endswith("_thumb.png")
        and evidence_path.resolve() == transfer_thumbnail_path.resolve()
        and evidence_path.stat().st_size < 1_000_000
        and evidence_path.stat().st_size == int(transfer_thumbnail.get("bytes") or 0)
        # Older synthetic reports may omit the thumbnail hash; derive it from
        # the verified evidence file while keeping the hash check deterministic.
        and stable_sha256(evidence_path) == transfer_thumbnail.get("sha256", stable_sha256(evidence_path))
        and record.get("outputSha256") == stable_sha256(output_path)
        and record.get("approvalFingerprint") == human_approval_fingerprint(record)
        and (
            expected_status != "approved"
            or not requires_v2_checklist
            or daojie_gongbi_v2.is_complete_approved_review_checklist(record.get("reviewChecklist"))
        )
    )
    return record if valid else None


def valid_human_approval(
    approvals: dict[str, Any],
    index: int,
    entry: dict[str, Any],
) -> dict[str, Any] | None:
    return valid_human_review(approvals, index, entry, "approved")


def valid_human_rejection(
    approvals: dict[str, Any],
    index: int,
    entry: dict[str, Any],
) -> dict[str, Any] | None:
    return valid_human_review(approvals, index, entry, "rejected")


def build_group_progress(
    groups: list[dict[str, Any]],
    entries_by_index: dict[int, dict[str, Any]],
    approvals: dict[str, Any],
    dry_run: bool = False,
) -> list[dict[str, Any]]:
    progress: list[dict[str, Any]] = []
    for group in groups:
        group_shots = [int(index) for index in group.get("shots") or []]
        generated = [
            index for index in group_shots
            if index in entries_by_index
            and Path(str(entries_by_index[index].get("outputPath") or "")).is_file()
        ]
        approved = [
            index for index in generated
            if valid_human_approval(approvals, index, entries_by_index[index])
        ]
        rejected = [
            index for index in generated
            if valid_human_rejection(approvals, index, entries_by_index[index])
        ]
        status = (
            "dry-run" if dry_run
            else "rejected" if rejected
            else "completed" if group_shots and len(approved) == len(group_shots)
            else "awaiting-human-approval" if len(generated) > len(approved)
            else "in-progress" if generated
            else "pending"
        )
        progress.append({
            **group,
            "generatedShots": generated,
            "approvedShots": approved,
            "rejectedShots": rejected,
            "remainingShots": [index for index in group_shots if index not in approved],
            "status": status,
        })
    return progress


def previous_approved_frame_manifest(
    generator,
    previous_index: int,
    previous_entry: dict[str, Any],
    approval: dict[str, Any],
    order: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if previous_entry.get("styleContractVersion") != daojie_gongbi_v2.STYLE_CONTRACT_VERSION:
        raise RuntimeError("V2 pilot 不得将旧风格镜头作为上一镜连续性参考")
    if (previous_entry.get("colorAudit") or {}).get("status") != "pass":
        raise RuntimeError("V2 pilot 上一镜缺少通过的色彩审计证据")
    output_path = Path(str(previous_entry["outputPath"]))
    output_sha256 = stable_sha256(output_path)
    storyboard_id = f"sb-{generator.EPISODE_ID}-{previous_index:03d}"
    manifest = {
        "order": order,
        "assetId": storyboard_id,
        "assetName": "上一镜人工批准成图",
        "assetKind": "prop",
        "imagePath": str(output_path),
        "referenceImagePaths": [str(output_path)],
        "referenceImageSha256": [output_sha256],
        "source": "chapter001-continuity-pilot-human-approval",
        "versionId": f"{storyboard_id}:{output_sha256}",
        "referenceRole": "previous-approved-frame",
        "contentFingerprint": output_sha256,
        "approvalFingerprint": approval["approvalFingerprint"],
        "approved": True,
        "styleContractVersion": daojie_gongbi_v2.STYLE_CONTRACT_VERSION,
        "styleContractFingerprint": previous_entry.get("styleContractFingerprint"),
    }
    reference = {
        "assetId": storyboard_id,
        "assetType": "asset",
        "title": "上一镜人工批准成图",
        "imageUrl": str(output_path),
        "evidence": str(approval["evidencePath"]),
        "sourceName": "上一镜人工批准成图",
        "aliases": [],
        "versionId": manifest["versionId"],
        "referenceRole": "previous-approved-frame",
        "contentFingerprint": output_sha256,
    }
    return manifest, reference


def record_human_review(
    output_dir: Path,
    index: int,
    human_confirmed: bool,
    reason: str,
    review_status: str,
    review_checklist: dict[str, bool] | None = None,
) -> dict[str, Any]:
    if review_status not in {"approved", "rejected"}:
        raise RuntimeError(f"不支持的人工审核状态: {review_status}")
    if not human_confirmed:
        raise RuntimeError("写入人工审核结论必须显式提供 --human-confirmed")
    normalized_reason = reason.strip()
    if review_status == "rejected" and not normalized_reason:
        raise RuntimeError("拒绝分镜必须提供非空审核原因")
    report_path = output_dir / "report.json"
    report = load_json_file(report_path, None)
    if not isinstance(report, dict):
        raise RuntimeError(f"连续性 pilot 报告不存在: {report_path}")
    entry = next((item for item in report.get("entries") or [] if int(item.get("index") or 0) == index), None)
    if not entry:
        raise RuntimeError(f"分镜 {index:03d} 尚未生成，不能写入人工审核结论")
    requires_v2_checklist = entry.get("styleContractVersion") == daojie_gongbi_v2.STYLE_CONTRACT_VERSION
    normalized_checklist = daojie_gongbi_v2.normalize_review_checklist(review_checklist)
    if (
        review_status == "approved"
        and requires_v2_checklist
        and not daojie_gongbi_v2.is_complete_approved_review_checklist(normalized_checklist)
    ):
        raise RuntimeError("V2 分镜批准必须确认线描、色彩、衣物、干净度、连续性、文字和水印全部通过")
    output_path = Path(str(entry.get("outputPath") or ""))
    thumbnail = entry.get("transferThumbnail") or {}
    evidence_path = Path(str(thumbnail.get("path") or ""))
    if not output_path.is_file() or not evidence_path.is_file():
        raise RuntimeError(f"分镜 {index:03d} 缺少原图或独立审核缩略图")
    if not evidence_path.name.endswith("_thumb.png") or evidence_path.stat().st_size >= 1_000_000:
        raise RuntimeError(f"分镜 {index:03d} 审核证据未通过缩略图硬门")
    approvals_path = output_dir / "human-approvals.json"
    approvals = load_json_file(approvals_path, {"approvals": {}})
    records = approvals.setdefault("approvals", {})
    if str(index) in records:
        raise RuntimeError(f"分镜 {index:03d} 已有人工审核结论，拒绝覆盖")
    record = {
        "storyboardId": str(entry["storyboardId"]),
        "index": index,
        "status": review_status,
        "reviewer": "human",
        "reviewedAt": int(datetime.now(timezone.utc).timestamp() * 1000),
        "reason": normalized_reason or None,
        "evidencePath": str(evidence_path),
        "outputPath": str(output_path),
        "outputSha256": stable_sha256(output_path),
    }
    if requires_v2_checklist:
        record["reviewChecklist"] = normalized_checklist
    record["approvalFingerprint"] = human_approval_fingerprint(record)
    records[str(index)] = record
    atomic_write_json(approvals_path, approvals)
    configured_shots = [int(value) for value in report.get("shots") or []]
    entries_by_index = {int(item["index"]): item for item in report.get("entries") or []}
    completed = bool(configured_shots) and all(
        shot in entries_by_index and valid_human_approval(approvals, shot, entries_by_index[shot])
        for shot in configured_shots
    )
    rejected_indexes = [
        shot for shot in configured_shots
        if shot in entries_by_index and valid_human_rejection(approvals, shot, entries_by_index[shot])
    ]
    approved_indexes = [
        shot for shot in configured_shots
        if shot in entries_by_index and valid_human_approval(approvals, shot, entries_by_index[shot])
    ]
    awaiting_approval_shot = next(
        (
            shot for shot in configured_shots
            if shot in entries_by_index
            and not valid_human_approval(approvals, shot, entries_by_index[shot])
            and not valid_human_rejection(approvals, shot, entries_by_index[shot])
        ),
        None,
    )
    review_records = list(records.values())
    report["status"] = "rejected" if rejected_indexes else "completed" if completed else "ready-for-next-shot"
    report["awaitingApprovalShot"] = awaiting_approval_shot
    report["humanReviews"] = review_records
    report["humanApprovals"] = [item for item in review_records if item.get("status") == "approved"]
    report["humanRejections"] = [item for item in review_records if item.get("status") == "rejected"]
    report["approvedShots"] = approved_indexes
    report["rejectedShots"] = rejected_indexes
    report["groups"] = build_group_progress(
        report.get("groups") or [],
        entries_by_index,
        approvals,
    )
    atomic_write_json(report_path, report)
    return {
        "ok": True,
        "status": report["status"],
        "reviewedShot": index,
        "review": record,
        "report": str(report_path),
        "approvals": str(approvals_path),
    }


def approve_generated_shot(
    output_dir: Path,
    index: int,
    human_confirmed: bool,
    reason: str,
    review_checklist: dict[str, bool] | None = None,
) -> dict[str, Any]:
    result = record_human_review(output_dir, index, human_confirmed, reason, "approved", review_checklist)
    result["approvedShot"] = result.pop("reviewedShot")
    result["approval"] = result.pop("review")
    return result


def reject_generated_shot(
    output_dir: Path,
    index: int,
    human_confirmed: bool,
    reason: str,
    review_checklist: dict[str, bool] | None = None,
) -> dict[str, Any]:
    result = record_human_review(output_dir, index, human_confirmed, reason, "rejected", review_checklist)
    result["rejectedShot"] = result.pop("reviewedShot")
    result["rejection"] = result.pop("review")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shots", type=parse_shots)
    parser.add_argument("--full-chapter", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--resume-existing", action="store_true")
    parser.add_argument("--restart-from-shot", type=int)
    parser.add_argument(
        "--watermark-test-variant",
        action="store_true",
        help="为一次明确授权的重跑追加可审计的无水印硬约束",
    )
    parser.add_argument(
        "--confirm-paid-retry",
        action="store_true",
        help="明确确认 --restart-from-shot 会产生新的付费生图请求",
    )
    parser.add_argument(
        "--confirm-paid-request",
        action="store_true",
        help="明确确认本次连续性 pilot 会提交新的付费生图请求",
    )
    parser.add_argument("--approve-shot", type=int)
    parser.add_argument("--reject-shot", type=int)
    parser.add_argument("--human-confirmed", action="store_true")
    parser.add_argument("--approval-reason", default="")
    parser.add_argument("--rejection-reason", default="")
    parser.add_argument(
        "--review-check",
        action="append",
        default=[],
        help="V2 人工审稿项，重复传入 linework/colorBalance/clothingIntegrity/cleanliness/continuity/text/watermark=true|false",
    )
    args = parser.parse_args()

    if args.full_chapter and args.shots:
        raise RuntimeError("--full-chapter 与 --shots 不能同时使用")
    if args.restart_from_shot is not None and not args.confirm_paid_retry:
        raise RuntimeError(
            "--restart-from-shot 是新的付费重跑，必须同时显式提供 --confirm-paid-retry"
        )
    if args.confirm_paid_retry and args.restart_from_shot is None:
        raise RuntimeError("--confirm-paid-retry 只能与 --restart-from-shot 一起使用")
    if args.watermark_test_variant and args.restart_from_shot is None and not args.dry_run:
        raise RuntimeError("--watermark-test-variant 只能与 --restart-from-shot 一起使用")
    if args.confirm_paid_request and args.dry_run:
        raise RuntimeError("--confirm-paid-request 不能与 --dry-run 一起使用")
    if args.approve_shot is not None and args.reject_shot is not None:
        raise RuntimeError("--approve-shot 与 --reject-shot 不能同时使用")
    configured_shots = list(range(1, 44)) if args.full_chapter else (args.shots or parse_shots("6-12"))

    output_dir = args.output_dir.resolve()
    review_checklist = parse_review_checks(args.review_check)
    if args.approve_shot is not None:
        print(json.dumps(approve_generated_shot(
            output_dir,
            args.approve_shot,
            args.human_confirmed,
            args.approval_reason,
            review_checklist,
        ), ensure_ascii=False))
        return
    if args.reject_shot is not None:
        print(json.dumps(reject_generated_shot(
            output_dir,
            args.reject_shot,
            args.human_confirmed,
            args.rejection_reason,
            review_checklist,
        ), ensure_ascii=False))
        return
    if args.resume_existing:
        raise RuntimeError("连续性 pilot 禁止 --resume-existing；恢复必须依赖逐镜人工批准台账")
    if not args.dry_run and args.approve_shot is None and not args.confirm_paid_request:
        raise RuntimeError(
            "连续性 pilot 付费请求已硬阻断；必须先明确提供 --confirm-paid-request，不能因恢复或换目录自动重跑"
        )
    report_path = output_dir / "report.json"
    generation_attempts_path = output_dir / "generation-attempts.jsonl"
    if output_dir.exists() and not report_path.is_file() and any(output_dir.iterdir()):
        raise RuntimeError(f"连续性 pilot 输出目录非空且没有可验证报告: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    previous_report = load_json_file(report_path, {})
    if previous_report and [int(value) for value in previous_report.get("shots") or []] != configured_shots:
        raise RuntimeError("连续性 pilot 恢复时 shots 与既有报告不一致")
    entries_by_index = {
        int(item["index"]): item
        for item in previous_report.get("entries") or []
    }
    approvals_path = output_dir / "human-approvals.json"
    approvals = load_json_file(approvals_path, {"approvals": {}})
    rejected_indexes = [
        index for index, entry in entries_by_index.items()
        if valid_human_rejection(approvals, index, entry)
    ]
    if rejected_indexes and not args.dry_run and args.restart_from_shot is None:
        blocked = ", ".join(f"{index:03d}" for index in sorted(rejected_indexes))
        raise RuntimeError(
            f"分镜 {blocked} 已人工拒绝；禁止自动付费重试。"
            "新的生成必须另行使用 --restart-from-shot、--confirm-paid-retry 和 --confirm-paid-request"
        )

    generator = load_generator()
    store = generator.load_json(generator.STORE)
    state = store.setdefault("state", {})
    source = generator.resolve_storyboard_source(state, generator.EPISODE_ID)
    shots = source["shots"]
    selected_groups = selected_continuity_groups(shots, configured_shots)
    catalog = generator.build_asset_catalog(state)
    existing = existing_storyboards(state, generator.EPISODE_ID)
    config = generator.storyboard_image_provider_config()
    if args.dry_run and not config:
        config = dry_run_provider_config(generator)
    if not args.dry_run:
        missing_provider_fields = [
            field for field in ("baseUrl", "apiKey", "model", "aspectRatio", "resolution")
            if not str(config.get(field) or "").strip()
        ]
        if missing_provider_fields:
            raise RuntimeError(
                "连续性 pilot 付费模式缺少真实 provider 配置；"
                "必须通过 provider-configured wrapper 启动: "
                + ",".join(missing_provider_fields)
            )
    paid_request_ledger = Path(
        os.environ.get("MYSTUDIO_IMAGE_PAID_REQUEST_LEDGER", str(DEFAULT_PAID_REQUEST_LEDGER))
    ).expanduser().resolve()
    config["paidRequestLedgerPath"] = str(paid_request_ledger)
    config["paidAuthorization"] = bool(args.confirm_paid_request)
    existing_versions = {
        f"{item.get('assetId', '')}:{item.get('versionId', '')}": item
        for item in state.get("continuityAssetVersions") or []
    }
    superseded_entries = list(previous_report.get("supersededEntries") or [])
    if args.restart_from_shot is not None:
        if args.dry_run:
            raise RuntimeError("--restart-from-shot 不能与 --dry-run 同时使用")
        if not previous_report:
            raise RuntimeError("重跑前必须存在可验证的连续性报告")
        entries_by_index, approvals, superseded = invalidate_restart_state(
            shots,
            configured_shots,
            entries_by_index,
            approvals,
            args.restart_from_shot,
        )
        superseded_at = datetime.now(timezone.utc).isoformat()
        superseded_entries.extend({
            **item,
            "supersededAt": superseded_at,
            "supersededReason": f"从分镜 {args.restart_from_shot:03d} 重跑同组下游",
        } for item in superseded)
        previous_report.update({
            "status": "ready-for-restart",
            "restartFromShot": args.restart_from_shot,
            "entries": [entries_by_index[index] for index in configured_shots if index in entries_by_index],
            "humanApprovals": list((approvals.get("approvals") or {}).values()),
            "supersededEntries": superseded_entries,
        })
        atomic_write_json(approvals_path, approvals)
        atomic_write_json(report_path, previous_report)
    next_index: int | None = None
    awaiting_index: int | None = None
    if not args.dry_run:
        for index in configured_shots:
            entry = entries_by_index.get(index)
            if entry is None:
                next_index = index
                break
            output_path = Path(str(entry.get("outputPath") or ""))
            if not output_path.is_file() or stable_sha256(output_path) != entry.get("outputSha256"):
                raise RuntimeError(f"分镜 {index:03d} 已有 pilot 证据失效，拒绝静默复用")
            if not valid_human_approval(approvals, index, entry):
                awaiting_index = index
                break

    planned_versions_by_key: dict[str, dict[str, Any]] = {}
    target_indexes = configured_shots if args.dry_run else [next_index] if next_index is not None and awaiting_index is None else []
    for index in target_indexes:
        shot = shots[index - 1]
        scene, prompt, _speaker, _text, _sound, assets, _duration = generator.shot_tuple(shot)
        image_assets = generator.resolve_continuity_image_assets(shot, catalog)
        manifest, versions, continuity_state = continuity_payload(
            generator,
            index,
            prompt,
            image_assets,
            existing.get(index, {}),
            existing_versions,
            shot.get("shotSemantics"),
            shot.get("_continuityGroup"),
        )
        merged_versions = []
        for version in versions:
            key = f"{version['assetId']}:{version['versionId']}"
            merged_versions.append(generator.preserve_valid_continuity_asset_approval(
                version,
                existing_versions.get(key),
            ))
        versions = merged_versions
        merge_planned_continuity_versions(planned_versions_by_key, versions)
        versions_by_key = {
            f"{version['assetId']}:{version['versionId']}": version
            for version in versions
        }
        for reference in manifest:
            version = versions_by_key[f"{reference['assetId']}:{reference['versionId']}"]
            reference["contentFingerprint"] = version["contentFingerprint"]
            reference["approvalFingerprint"] = version.get("approvalFingerprint")
            reference["approved"] = version["approved"]
        unapproved_versions = [item for item in versions if item.get("approved") is not True]
        if unapproved_versions and not args.dry_run:
            details = "、".join(
                f"{item.get('assetId')}({','.join(item.get('missingFields') or ['未批准'])})"
                for item in unapproved_versions
            )
            raise RuntimeError(f"分镜 {index:03d} 连续性资产版本未批准: {details}")
        source_references = continuity_references(generator, image_assets, manifest)
        # Resolve capacity only after a valid predecessor has been appended.
        previous_index = required_previous_selected_shot(
            continuity_state,
            configured_shots,
            index,
        )
        if not args.dry_run and previous_index is not None:
            previous_entry = entries_by_index.get(previous_index)
            if not previous_entry:
                raise RuntimeError(f"分镜 {index:03d} 缺少上一镜 {previous_index:03d} 生成证据")
            approval = valid_human_approval(approvals, previous_index, previous_entry)
            if not approval:
                raise RuntimeError(f"分镜 {index:03d} 的上一镜 {previous_index:03d} 尚未人工批准")
            previous_manifest, previous_reference = previous_approved_frame_manifest(
                generator,
                previous_index,
                previous_entry,
                approval,
                len(manifest) + 1,
            )
            manifest.append(previous_manifest)
            source_references.append(previous_reference)
        source_reference_capability = generator.storyboard_reference_capability(config, source_references)
        references, reference_transport = generator.build_storyboard_reference_transport(
            source_references,
            source_reference_capability,
            output_dir / "reference-bundles",
        )
        request_config = generator.with_storyboard_v2_reference_contract(config, references)
        reference_capability = request_config.get("referenceCapability")
        reference_visual_audit = generator.build_storyboard_reference_visual_audit(
            references,
            expected_time_of_day=generator.storyboard_time_of_day(index),
        )
        if not args.dry_run:
            generator.assert_storyboard_reference_visual_audit(reference_visual_audit)
        if args.watermark_test_variant:
            continuity_state["generationVariant"] = "watermark-test-v1"
        continuity_state["referenceTransport"] = {
            key: reference_transport[key]
            for key in (
                "schemaVersion",
                "strategy",
                "sourceReferenceCount",
                "providerReferenceCount",
                "supportedReferenceCount",
                "requiredReduction",
                "remainingReduction",
                "bundleCount",
                "sourceReductionCount",
                "fingerprint",
            )
        }
        continuity_state["inputFingerprint"] = generator.build_visual_continuity_fingerprint(
            prompt,
            manifest,
            continuity_state,
        )
        final_prompt = generator.build_storyboard_image_prompt(
            {
                "id": f"sb-{generator.EPISODE_ID}-{index:03d}",
                "index": index,
                "sceneNo": shot.get("sceneNo", 1),
                "prompt": prompt,
                "shotSemantics": shot.get("shotSemantics"),
                "continuityState": continuity_state,
            },
            references,
            enforce_v2_reference_compatibility=not args.dry_run,
        )
        final_prompt = apply_watermark_test_variant(final_prompt, args.watermark_test_variant)
        audit = generator.build_storyboard_prompt_audit(
            {
                "id": f"sb-{generator.EPISODE_ID}-{index:03d}",
                "index": index,
                "referenceCapability": reference_capability,
                "shotSemantics": shot.get("shotSemantics"),
            },
            final_prompt,
            references,
            prompt,
        )
        if not args.dry_run:
            generator.assert_storyboard_prompt_audit(audit)
        request_blocked = (
            reference_visual_audit.get("status") != "pass"
            or (audit.get("v2") or {}).get("status") != "pass"
            or audit.get("missingVisibleRoleReferences")
            or audit.get("missingLeadingVisualCharacters")
            or (audit.get("aliasOwnership") or {}).get("status") != "pass"
        )
        if request_blocked:
            prepared_references = []
            reference_preflight = {
                "schemaVersion": generator.MODEL_REFERENCE_PREFLIGHT_SCHEMA_VERSION,
                "status": "not-run",
                "reason": "blocked-by-prompt-or-reference-visual-audit",
                "referenceCount": 0,
                "generationEndpointCalled": False,
            }
        else:
            # The same transfer payload is reused by a real POST after every local gate passes.
            prepared_references, reference_preflight = generator.prepare_storyboard_model_reference_images(references)
        output_path = next_revision_output_path(output_dir, index)
        if not args.dry_run:
            if output_path.exists():
                raise RuntimeError(f"拒绝覆盖已有连续性 pilot 图片: {output_path}")
            attempt_id = generation_attempt_id(output_dir, index, output_path)
            logical_job = "daojie-chapter001-continuity-full" if args.full_chapter else "daojie-chapter001-continuity-pilot"
            logical_shot = f"sb-{generator.EPISODE_ID}-{index:03d}"
            config["singleAttempt"] = True
            config["attemptId"] = attempt_id
            config["logicalJob"] = logical_job
            config["logicalShot"] = logical_shot
            request_config = generator.with_storyboard_v2_reference_contract(config, references)
            append_generation_attempt(generation_attempts_path, {
                "attemptId": attempt_id,
                "index": index,
                "storyboardId": logical_shot,
                "outputPath": str(output_path),
                "provider": config.get("providerName") or generator.storyboard_image_generation_provider(),
                "model": config.get("model"),
                "aspectRatio": config.get("aspectRatio"),
                "resolution": config.get("resolution"),
                "asyncMode": config.get("asyncMode") is True,
                "paidRequestLedgerPath": str(paid_request_ledger),
                "logicalJob": logical_job,
                "logicalShot": logical_shot,
                "generationVariant": continuity_state.get("generationVariant"),
                "startedAt": datetime.now(timezone.utc).isoformat(),
                "status": "started",
            })
            try:
                result_url = generator.request_storyboard_image_generation(final_prompt, prepared_references, request_config)
                generator.save_generated_image_url(result_url, output_path)
                color_audit = generator.audit_daojie_gongbi_v2_output(output_path)
                transfer_thumbnail = generator.create_storyboard_transfer_thumbnail(output_path)
            except Exception as error:
                request_event = latest_paid_request_event(paid_request_ledger, attempt_id)
                append_generation_attempt(generation_attempts_path, {
                    "attemptId": attempt_id,
                    "index": index,
                    "storyboardId": logical_shot,
                    "outputPath": str(output_path),
                    "finishedAt": datetime.now(timezone.utc).isoformat(),
                    "status": generation_failure_status(request_event),
                    "request": request_event,
                    "error": str(error)[:1000],
                })
                raise
            append_generation_attempt(generation_attempts_path, {
                "attemptId": attempt_id,
                "index": index,
                "storyboardId": logical_shot,
                "outputPath": str(output_path),
                "outputSha256": stable_sha256(output_path),
                "transferThumbnail": transfer_thumbnail,
                "request": config.get("_lastPaidRequest") or latest_paid_request_event(paid_request_ledger, attempt_id),
                "generationVariant": continuity_state.get("generationVariant"),
                "finishedAt": datetime.now(timezone.utc).isoformat(),
                "status": "completed",
            })
        else:
            transfer_thumbnail = None
            color_audit = {
                "version": daojie_gongbi_v2.COLOR_AUDIT_VERSION,
                "status": "not-run",
                "reason": "dry-run-no-output-image",
            }
        entries_by_index[index] = {
            "index": index,
            "storyboardId": f"sb-{generator.EPISODE_ID}-{index:03d}",
            "outputPath": str(output_path),
            "outputSha256": stable_sha256(output_path) if output_path.exists() else None,
            "transferThumbnail": transfer_thumbnail,
            "generationVariant": continuity_state.get("generationVariant"),
            "styleContractVersion": continuity_state.get("styleContractVersion"),
            "styleContractFingerprint": continuity_state.get("styleContractFingerprint"),
            "sourceReferenceRoles": generator.storyboard_reference_roles(source_references),
            "referenceRoles": request_config.get("referenceRoles") or [],
            "referenceCapability": reference_capability,
            "referenceTransport": reference_transport,
            "referenceVisualAudit": reference_visual_audit,
            "modelReferencePreflight": reference_preflight,
            "colorAudit": color_audit,
            "prompt": final_prompt,
            "promptSha256": hashlib.sha256(final_prompt.encode("utf-8")).hexdigest(),
            "providerPromptPolicy": "exact-reviewed-v2",
            "referenceManifest": manifest,
            "continuityState": continuity_state,
            "assetVersionsApproved": all(item.get("approved") is True for item in versions),
            "promptAudit": audit,
        }

    entries = [entries_by_index[index] for index in configured_shots if index in entries_by_index]
    generated_paths = [Path(str(entry["outputPath"])) for entry in entries if Path(str(entry["outputPath"])).is_file()]
    transfer_thumbnails = [
        {"storyboardId": entry["storyboardId"], **entry["transferThumbnail"]}
        for entry in entries
        if entry.get("transferThumbnail")
    ]
    contact_sheet = output_dir / "contact-sheet.jpg"
    if generated_paths:
        build_contact_sheet(generated_paths, contact_sheet)
    approved_indexes = [
        index for index in configured_shots
        if index in entries_by_index and valid_human_approval(approvals, index, entries_by_index[index])
    ]
    rejected_indexes = [
        index for index in configured_shots
        if index in entries_by_index and valid_human_rejection(approvals, index, entries_by_index[index])
    ]
    completed = len(entries) == len(configured_shots) and len(approved_indexes) == len(configured_shots)
    reference_visual_summary = summarize_reference_visual_audits(entries)
    blocked_indexes = sorted(set(
        reference_visual_summary["blockedShotIndexes"]
        + [
            int(entry.get("index") or 0)
            for entry in entries
            if (entry.get("promptAudit") or {}).get("v2", {}).get("status") != "pass"
            or (entry.get("promptAudit") or {}).get("missingLeadingVisualCharacters")
            or (entry.get("promptAudit") or {}).get("missingVisibleRoleReferences")
        ]
    ))
    status = (
        "blocked" if blocked_indexes
        else "dry-run" if args.dry_run
        else "rejected" if rejected_indexes
        else "completed" if completed
        else "awaiting-human-approval"
    )
    awaiting_index = awaiting_index or (next_index if next_index in entries_by_index else None)
    planned_versions = sorted(
        planned_versions_by_key.values(),
        key=lambda item: (str(item.get("assetKind") or ""), str(item.get("assetId") or ""), str(item.get("versionId") or "")),
    )
    asset_approval_summary = {
        "approved": sum(item.get("approved") is True for item in planned_versions),
        "pending": sum((item.get("approval") or {}).get("status") not in {"approved", "rejected"} for item in planned_versions),
        "rejected": sum((item.get("approval") or {}).get("status") == "rejected" for item in planned_versions),
        "structurallyIncomplete": sum(item.get("structurallyComplete") is not True for item in planned_versions),
    }
    generation_attempts = summarize_generation_attempts(generation_attempts_path)
    report = {
        "ok": not blocked_indexes,
        "status": status,
        "awaitingApprovalShot": awaiting_index,
        "dryRun": args.dry_run,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "project": str(generator.PROJECT),
        "sourceKind": source["kind"],
        "provider": {
            "name": config.get("providerName") or generator.storyboard_image_generation_provider(),
            "baseUrl": config.get("baseUrl"),
            "model": config.get("model"),
            "aspectRatio": config.get("aspectRatio"),
            "resolution": config.get("resolution"),
            "asyncMode": config.get("asyncMode") is True,
            "requestMode": config.get("requestMode") or generator.REQUEST_MODE_GENERATIONS_JSON,
            "promptPolicy": "exact-reviewed-v2",
        },
        "asyncMode": config.get("asyncMode") is True,
        "generationEndpointCalled": not args.dry_run,
        "singleAttempt": config.get("singleAttempt") is True,
        "paidRequestLedgerPath": str(paid_request_ledger),
        "paidAuthorization": bool(args.confirm_paid_request),
        "mode": "full-chapter" if args.full_chapter else "selected-shots",
        "shots": configured_shots,
        "groups": build_group_progress(selected_groups, entries_by_index, approvals, args.dry_run),
        "processedImages": len(generated_paths),
        "generatedImages": len(generated_paths),
        "generationAttemptCount": generation_attempts["attemptCount"],
        "generationAttemptStatusCounts": generation_attempts["statusCounts"],
        "openGenerationAttemptIds": generation_attempts["openAttemptIds"],
        "generationAttempts": generation_attempts["events"],
        "reusedImages": 0,
        "storyboardTransferThumbnails": transfer_thumbnails,
        "referenceCapabilityReport": summarize_reference_capabilities(entries),
        "referenceVisualAuditReport": reference_visual_summary,
        "blockedShotIndexes": blocked_indexes,
        "contactSheet": str(contact_sheet) if generated_paths else None,
        "mutatedProductionProject": False,
        "resumeExisting": False,
        "humanReviews": list((approvals.get("approvals") or {}).values()),
        "humanApprovals": [
            item for item in (approvals.get("approvals") or {}).values()
            if item.get("status") == "approved"
        ],
        "humanRejections": [
            item for item in (approvals.get("approvals") or {}).values()
            if item.get("status") == "rejected"
        ],
        "approvedShots": approved_indexes,
        "rejectedShots": rejected_indexes,
        "continuityAssetVersions": planned_versions,
        "assetApprovalSummary": asset_approval_summary,
        "supersededEntries": superseded_entries,
        "entries": entries,
    }
    atomic_write_json(report_path, report)
    print(json.dumps({
        "ok": not blocked_indexes,
        "status": status,
        "awaitingApprovalShot": awaiting_index,
        "dryRun": args.dry_run,
        "processedImages": len(generated_paths),
        "generatedImages": len(generated_paths),
        "generationAttemptCount": generation_attempts["attemptCount"],
        "generationAttemptStatusCounts": generation_attempts["statusCounts"],
        "openGenerationAttemptIds": generation_attempts["openAttemptIds"],
        "reusedImages": 0,
        "thumbnailCount": len(transfer_thumbnails),
        "report": str(report_path),
        "contactSheet": str(contact_sheet) if generated_paths else None,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise
