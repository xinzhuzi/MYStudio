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
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps


REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATOR_PATH = REPO_ROOT / "Library/build_daojie_chapter001_workflow.py"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "apps/output/automation/daojie-chapter001-continuity-sample"


def load_generator():
    spec = importlib.util.spec_from_file_location("daojie_chapter001_workflow", GENERATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载生成器: {GENERATOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def selected_continuity_groups(generator, shots: list[int]) -> list[dict[str, Any]]:
    if shots != sorted(set(shots)):
        raise RuntimeError("连续性镜头必须按升序且不能重复")
    selected = set(shots)
    groups: list[dict[str, Any]] = []
    covered: set[int] = set()
    for group in generator.CHAPTER_CONTINUITY_GROUPS:
        group_shots = [index for index in shots if group["start"] <= index <= group["end"]]
        if not group_shots:
            continue
        expected = list(range(group_shots[0], group_shots[-1] + 1))
        if group_shots != expected:
            raise RuntimeError(f"连续镜头组 {group['groupId']} 只能选择连续镜头")
        covered.update(group_shots)
        groups.append({
            "groupId": group["groupId"],
            "start": group["start"],
            "end": group["end"],
            "sceneName": group["sceneName"],
            "viewpointId": group["viewpointId"],
            "shots": group_shots,
        })
    if covered != selected:
        missing = sorted(selected - covered)
        raise RuntimeError(f"镜头缺少连续组定义: {missing}")
    return groups


def invalidate_restart_state(
    generator,
    shots: list[int],
    entries_by_index: dict[int, dict[str, Any]],
    approvals: dict[str, Any],
    restart_index: int,
) -> tuple[dict[int, dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    if restart_index not in shots:
        raise RuntimeError(f"重跑镜头 {restart_index:03d} 不在本次连续性范围内")
    group = generator.continuity_group_for_index(restart_index)
    if not group:
        raise RuntimeError(f"重跑镜头 {restart_index:03d} 缺少连续镜头组")
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


def continuity_payload(generator, index: int, prompt: str, image_assets: list[dict[str, Any]], existing: dict[str, Any]):
    return generator.build_storyboard_continuity_payload(index, prompt, image_assets, existing)


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


def human_approval_fingerprint(record: dict[str, Any]) -> str:
    payload = {
        key: record.get(key)
        for key in (
            "storyboardId", "index", "status", "reviewer", "reviewedAt",
            "reason", "evidencePath", "outputPath", "outputSha256",
        )
        if record.get(key) is not None
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def valid_human_approval(
    approvals: dict[str, Any],
    index: int,
    entry: dict[str, Any],
) -> dict[str, Any] | None:
    record = (approvals.get("approvals") or {}).get(str(index))
    if not isinstance(record, dict):
        return None
    output_path = Path(str(entry.get("outputPath") or ""))
    evidence_path = Path(str(record.get("evidencePath") or ""))
    transfer_thumbnail = entry.get("transferThumbnail") or {}
    transfer_thumbnail_path = Path(str(transfer_thumbnail.get("path") or ""))
    valid = bool(
        record.get("status") == "approved"
        and record.get("reviewer") == "human"
        and int(record.get("reviewedAt") or 0) > 0
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
    )
    return record if valid else None


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
        status = (
            "dry-run" if dry_run
            else "completed" if group_shots and len(approved) == len(group_shots)
            else "awaiting-human-approval" if len(generated) > len(approved)
            else "in-progress" if generated
            else "pending"
        )
        progress.append({
            **group,
            "generatedShots": generated,
            "approvedShots": approved,
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


def approve_generated_shot(
    output_dir: Path,
    index: int,
    human_confirmed: bool,
    reason: str,
) -> dict[str, Any]:
    if not human_confirmed:
        raise RuntimeError("写入人工批准必须显式提供 --human-confirmed")
    report_path = output_dir / "report.json"
    report = load_json_file(report_path, None)
    if not isinstance(report, dict):
        raise RuntimeError(f"连续性 pilot 报告不存在: {report_path}")
    entry = next((item for item in report.get("entries") or [] if int(item.get("index") or 0) == index), None)
    if not entry:
        raise RuntimeError(f"分镜 {index:03d} 尚未生成，不能人工批准")
    output_path = Path(str(entry.get("outputPath") or ""))
    thumbnail = entry.get("transferThumbnail") or {}
    evidence_path = Path(str(thumbnail.get("path") or ""))
    if not output_path.is_file() or not evidence_path.is_file():
        raise RuntimeError(f"分镜 {index:03d} 缺少原图或独立审核缩略图")
    if not evidence_path.name.endswith("_thumb.png") or evidence_path.stat().st_size >= 1_000_000:
        raise RuntimeError(f"分镜 {index:03d} 审核证据未通过缩略图硬门")
    record = {
        "storyboardId": str(entry["storyboardId"]),
        "index": index,
        "status": "approved",
        "reviewer": "human",
        "reviewedAt": int(datetime.now(timezone.utc).timestamp() * 1000),
        "reason": reason.strip() or None,
        "evidencePath": str(evidence_path),
        "outputPath": str(output_path),
        "outputSha256": stable_sha256(output_path),
    }
    record["approvalFingerprint"] = human_approval_fingerprint(record)
    approvals_path = output_dir / "human-approvals.json"
    approvals = load_json_file(approvals_path, {"approvals": {}})
    approvals.setdefault("approvals", {})[str(index)] = record
    atomic_write_json(approvals_path, approvals)
    configured_shots = [int(value) for value in report.get("shots") or []]
    entries_by_index = {int(item["index"]): item for item in report.get("entries") or []}
    completed = bool(configured_shots) and all(
        shot in entries_by_index and valid_human_approval(approvals, shot, entries_by_index[shot])
        for shot in configured_shots
    )
    report["status"] = "completed" if completed else "ready-for-next-shot"
    report["humanApprovals"] = list((approvals.get("approvals") or {}).values())
    report["groups"] = build_group_progress(
        report.get("groups") or [],
        entries_by_index,
        approvals,
    )
    atomic_write_json(report_path, report)
    return {
        "ok": True,
        "status": report["status"],
        "approvedShot": index,
        "approval": record,
        "report": str(report_path),
        "approvals": str(approvals_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shots", type=parse_shots)
    parser.add_argument("--full-chapter", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--resume-existing", action="store_true")
    parser.add_argument("--restart-from-shot", type=int)
    parser.add_argument("--approve-shot", type=int)
    parser.add_argument("--human-confirmed", action="store_true")
    parser.add_argument("--approval-reason", default="")
    args = parser.parse_args()

    if args.full_chapter and args.shots:
        raise RuntimeError("--full-chapter 与 --shots 不能同时使用")
    configured_shots = list(range(1, 44)) if args.full_chapter else (args.shots or parse_shots("6-12"))

    output_dir = args.output_dir.resolve()
    if args.approve_shot is not None:
        print(json.dumps(approve_generated_shot(
            output_dir,
            args.approve_shot,
            args.human_confirmed,
            args.approval_reason,
        ), ensure_ascii=False))
        return
    if args.resume_existing:
        raise RuntimeError("连续性 pilot 禁止 --resume-existing；恢复必须依赖逐镜人工批准台账")
    report_path = output_dir / "report.json"
    if output_dir.exists() and not report_path.is_file() and any(output_dir.iterdir()):
        raise RuntimeError(f"连续性 pilot 输出目录非空且没有可验证报告: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    generator = load_generator()
    selected_groups = selected_continuity_groups(generator, configured_shots)
    store = generator.load_json(generator.STORE)
    state = store.setdefault("state", {})
    source = generator.resolve_storyboard_source(state, generator.EPISODE_ID)
    shots = source["shots"]
    catalog = generator.build_asset_catalog(state)
    existing = existing_storyboards(state, generator.EPISODE_ID)
    config = generator.storyboard_image_provider_config()
    existing_versions = {
        f"{item.get('assetId', '')}:{item.get('versionId', '')}": item
        for item in state.get("continuityAssetVersions") or []
    }
    previous_report = load_json_file(report_path, {})
    if previous_report and [int(value) for value in previous_report.get("shots") or []] != configured_shots:
        raise RuntimeError("连续性 pilot 恢复时 shots 与既有报告不一致")
    entries_by_index = {
        int(item["index"]): item
        for item in previous_report.get("entries") or []
    }
    approvals_path = output_dir / "human-approvals.json"
    approvals = load_json_file(approvals_path, {"approvals": {}})
    superseded_entries = list(previous_report.get("supersededEntries") or [])
    if args.restart_from_shot is not None:
        if args.dry_run:
            raise RuntimeError("--restart-from-shot 不能与 --dry-run 同时使用")
        if not previous_report:
            raise RuntimeError("重跑前必须存在可验证的连续性报告")
        entries_by_index, approvals, superseded = invalidate_restart_state(
            generator,
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
        image_assets = generator.resolve_image_assets(scene, assets, catalog)
        manifest, versions, continuity_state = continuity_payload(
            generator,
            index,
            prompt,
            image_assets,
            existing.get(index, {}),
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
        references = continuity_references(generator, image_assets, manifest)
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
            references.append(previous_reference)
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
                "continuityState": continuity_state,
            },
            references,
        )
        audit = generator.build_storyboard_prompt_audit(
            {"id": f"sb-{generator.EPISODE_ID}-{index:03d}", "index": index},
            final_prompt,
            references,
            prompt,
        )
        generator.assert_storyboard_prompt_audit(audit)
        output_path = next_revision_output_path(output_dir, index)
        if not args.dry_run:
            if output_path.exists():
                raise RuntimeError(f"拒绝覆盖已有连续性 pilot 图片: {output_path}")
            prepared = [generator.prepare_storyboard_model_reference_image(item["imageUrl"]) for item in references]
            result_url = generator.request_storyboard_image_generation(final_prompt, prepared, config)
            generator.save_generated_image_url(result_url, output_path)
            transfer_thumbnail = generator.create_storyboard_transfer_thumbnail(output_path)
        else:
            transfer_thumbnail = None
        entries_by_index[index] = {
            "index": index,
            "storyboardId": f"sb-{generator.EPISODE_ID}-{index:03d}",
            "outputPath": str(output_path),
            "outputSha256": stable_sha256(output_path) if output_path.exists() else None,
            "transferThumbnail": transfer_thumbnail,
            "prompt": final_prompt,
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
    completed = len(entries) == len(configured_shots) and len(approved_indexes) == len(configured_shots)
    status = "dry-run" if args.dry_run else "completed" if completed else "awaiting-human-approval"
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
    report = {
        "ok": True,
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
        },
        "mode": "full-chapter" if args.full_chapter else "selected-shots",
        "shots": configured_shots,
        "groups": build_group_progress(selected_groups, entries_by_index, approvals, args.dry_run),
        "processedImages": len(generated_paths),
        "generatedImages": len(generated_paths),
        "reusedImages": 0,
        "storyboardTransferThumbnails": transfer_thumbnails,
        "contactSheet": str(contact_sheet) if generated_paths else None,
        "mutatedProductionProject": False,
        "resumeExisting": False,
        "humanApprovals": list((approvals.get("approvals") or {}).values()),
        "approvedShots": approved_indexes,
        "continuityAssetVersions": planned_versions,
        "assetApprovalSummary": asset_approval_summary,
        "supersededEntries": superseded_entries,
        "entries": entries,
    }
    atomic_write_json(report_path, report)
    print(json.dumps({
        "ok": True,
        "status": status,
        "awaitingApprovalShot": awaiting_index,
        "dryRun": args.dry_run,
        "processedImages": len(generated_paths),
        "generatedImages": len(generated_paths),
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
