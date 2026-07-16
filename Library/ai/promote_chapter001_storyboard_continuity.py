#!/usr/bin/env python3
"""Promote fully human-approved chapter-001 continuity frames without auto-approval."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from PIL import Image


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROJECT = Path.home() / "Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0"
EXPECTED_SHOTS = list(range(1, 44))


def load_json(path: Path) -> dict[str, Any]:
    return load_json_bytes(path, path.read_bytes())


def load_json_bytes(path: Path, payload: bytes) -> dict[str, Any]:
    value = json.loads(payload.decode("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"JSON 根必须是对象: {path}")
    return value


def stable_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_sample_module():
    path = REPOSITORY_ROOT / "Library/generate_chapter001_continuity_sample.py"
    spec = importlib.util.spec_from_file_location("chapter001_storyboard_promotion_source", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载逐镜批准契约: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def project_file_url(project: Path, target: Path) -> str:
    relative = target.relative_to(project)
    encoded_relative = "/".join(quote(part, safe="") for part in relative.parts)
    return f"project-file://{quote(project.name, safe='')}/{encoded_relative}"


def validate_thumbnail(entry: dict[str, Any]) -> dict[str, Any]:
    thumbnail = entry.get("transferThumbnail") or {}
    path = Path(str(thumbnail.get("path") or ""))
    if not path.is_file() or not path.name.endswith("_thumb.png"):
        raise RuntimeError(f"分镜 {entry.get('index')} 缺少独立 _thumb.png: {path}")
    actual_bytes = path.stat().st_size
    actual_sha256 = sha256_file(path)
    with Image.open(path) as image:
        image.load()
        width, height = image.size
        image_format = image.format
    if (
        image_format != "PNG"
        or width <= 0
        or height <= 0
        or width > 768
        or height > 768
        or actual_bytes <= 0
        or actual_bytes >= 1_000_000
        or int(thumbnail.get("width") or 0) != width
        or int(thumbnail.get("height") or 0) != height
        or int(thumbnail.get("bytes") or 0) != actual_bytes
        or thumbnail.get("sha256") != actual_sha256
    ):
        raise RuntimeError(f"分镜 {entry.get('index')} 缩略图证据无效: {thumbnail}")
    return {
        "path": str(path),
        "width": width,
        "height": height,
        "bytes": actual_bytes,
        "sha256": actual_sha256,
    }


def validate_report(report_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    report = load_json(report_path)
    if report.get("mode") != "full-chapter" or report.get("status") != "completed":
        raise RuntimeError("只允许推广 completed 的 full-chapter 连续性报告")
    if [int(value) for value in report.get("shots") or []] != EXPECTED_SHOTS:
        raise RuntimeError("全章推广报告必须精确覆盖 1-43 镜")
    if (
        int(report.get("generatedImages") or 0) != 43
        or int(report.get("reusedImages") or 0) != 0
        or report.get("mutatedProductionProject") is not False
    ):
        raise RuntimeError("全章推广报告必须证明 43 张全新生成且未修改生产项目")
    entries = sorted(report.get("entries") or [], key=lambda item: int(item.get("index") or 0))
    if [int(item.get("index") or 0) for item in entries] != EXPECTED_SHOTS:
        raise RuntimeError("全章推广 entries 必须是 43 个唯一镜头")
    approvals_path = report_path.parent / "human-approvals.json"
    approvals = load_json(approvals_path)
    sample = load_sample_module()
    for entry in entries:
        index = int(entry["index"])
        output_path = Path(str(entry.get("outputPath") or ""))
        if not output_path.is_file():
            raise RuntimeError(f"分镜 {index:03d} 原图不存在: {output_path}")
        output_sha256 = sha256_file(output_path)
        if entry.get("outputSha256") != output_sha256:
            raise RuntimeError(f"分镜 {index:03d} outputSha256 已失效")
        if not sample.valid_human_approval(approvals, index, entry):
            raise RuntimeError(f"分镜 {index:03d} 缺少当前输出的有效人工批准")
        validate_thumbnail(entry)
    return report, entries, approvals


def pending_visual_review(entry: dict[str, Any], media_path: str) -> dict[str, Any]:
    continuity = entry.get("continuityState") or {}
    manifest = entry.get("referenceManifest") or []
    return {
        "status": "pending",
        "reasons": ["已推广逐镜人工批准成图，等待产品视觉终审"],
        "characterChecks": [
            {"characterId": item["characterId"], "passed": False}
            for item in continuity.get("characters") or []
            if item.get("characterId")
        ],
        "sceneChecks": [
            {"sceneVersionId": continuity.get("sceneVersionId"), "passed": False}
        ],
        "propChecks": [
            {"assetId": item.get("assetId"), "versionId": item.get("versionId"), "passed": False}
            for item in manifest
            if item.get("referenceRole") == "prop-state"
        ],
        "transitionChecks": ([{
            "previousStoryboardId": continuity.get("previousStoryboardId"),
            "passed": False,
        }] if continuity.get("previousStoryboardId") else []),
        "textWatermarkCheck": {"passed": False},
        "reviewer": "automated",
        "reviewedAt": int(datetime.now(timezone.utc).timestamp() * 1000),
        "evidencePaths": [media_path],
        "inputFingerprint": "",
    }


def promoted_media_ref(update: dict[str, Any]) -> tuple[dict[str, Any], str, str]:
    flow_id = f"storyboard-flow-chapter-001-{int(update['index']):03d}"
    generated_node_id = f"gen-{flow_id}"
    return ({
        "kind": "image",
        "path": update["projectUrl"],
        "contentSha256": update["sourceSha256"],
        "imageWorkflowId": flow_id,
        "imageWorkflowNodeId": generated_node_id,
    }, flow_id, generated_node_id)


def storyboard_matches_promotion(
    storyboard: dict[str, Any],
    update: dict[str, Any],
    *,
    require_output_version: bool = True,
) -> bool:
    media_ref, flow_id, generated_node_id = promoted_media_ref(update)
    review = storyboard.get("visualReview") or {}
    version_matches = (
        int(storyboard.get("outputVersion") or 0) == int(update.get("targetOutputVersion") or 0)
        if require_output_version
        else int(storyboard.get("outputVersion") or 0) > 0
    )
    return bool(
        storyboard.get("mediaRef") == media_ref
        and storyboard.get("imageWorkflowId") == flow_id
        and storyboard.get("imageWorkflowNodeId") == generated_node_id
        and storyboard.get("orderedReferenceManifest") == update["referenceManifest"]
        and storyboard.get("continuityState") == update["continuityState"]
        and version_matches
        and storyboard.get("stale") is False
        and review.get("status") in {"pending", "approved"}
        and review.get("evidencePaths") == [update["projectUrl"]]
    )


def build_promotion_plan(report_path: Path, store_path: Path, project: Path) -> dict[str, Any]:
    report, entries, _approvals = validate_report(report_path)
    store_payload = store_path.read_bytes()
    store = load_json_bytes(store_path, store_payload)
    state = store.get("state") or store
    storyboards = state.get("storyboards") or []
    storyboards_by_id = {
        str(item.get("id")): item
        for item in storyboards
        if item.get("episodeId") == "chapter-001" and item.get("id")
    }
    entry_ids = [str(item.get("storyboardId") or "") for item in entries]
    if len(storyboards_by_id) != 43 or set(entry_ids) != set(storyboards_by_id):
        raise RuntimeError(
            f"生产 store 与推广报告镜头不一致: store={len(storyboards_by_id)}, report={len(set(entry_ids))}"
        )
    updates = []
    for entry in entries:
        index = int(entry["index"])
        source = Path(str(entry["outputPath"]))
        output_sha256 = sha256_file(source)
        destination = (
            project
            / "workflow-images/storyboards/chapter-001/approved-revisions"
            / f"shot-{index:03d}-{output_sha256[:12]}.png"
        )
        storyboard = storyboards_by_id[str(entry["storyboardId"])]
        updates.append({
            "index": index,
            "storyboardId": entry["storyboardId"],
            "source": str(source),
            "sourceSha256": output_sha256,
            "destination": str(destination),
            "projectUrl": project_file_url(project, destination),
            "thumbnail": validate_thumbnail(entry),
            "referenceManifest": copy.deepcopy(entry.get("referenceManifest") or []),
            "continuityState": copy.deepcopy(entry.get("continuityState") or {}),
            "currentOutputVersion": int(storyboard.get("outputVersion") or 0),
        })
    promoted_flags = [
        storyboard_matches_promotion(
            storyboards_by_id[str(update["storyboardId"])],
            update,
            require_output_version=False,
        )
        for update in updates
    ]
    if any(promoted_flags) and not all(promoted_flags):
        raise RuntimeError("生产 store 只完成了部分镜头推广，拒绝继续覆盖")
    already_applied = all(promoted_flags)
    for update in updates:
        update["targetOutputVersion"] = (
            update["currentOutputVersion"]
            if already_applied
            else update["currentOutputVersion"] + 1
        )
    return {
        "ok": True,
        "dryRun": True,
        "reportPath": str(report_path),
        "reportSha256": sha256_file(report_path),
        "storePath": str(store_path),
        "storeSha256": sha256_bytes(store_payload),
        "project": str(project),
        "alreadyApplied": already_applied,
        "shots": len(updates),
        "generatedImages": report["generatedImages"],
        "reusedImages": report["reusedImages"],
        "updates": updates,
    }


def write_new_or_identical(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != payload:
            raise RuntimeError(f"拒绝覆盖不同内容: {path}")
        return
    atomic_write(path, payload)


def atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def promotion_report_path(plan: dict[str, Any]) -> Path:
    return Path(plan["reportPath"]).parent / (
        f"storyboard-promotion-{plan['reportSha256'][:12]}.json"
    )


def ensure_directory(path: Path, created_directories: list[Path]) -> None:
    missing: list[Path] = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    if not current.is_dir():
        raise RuntimeError(f"父路径不是目录: {current}")
    for directory in reversed(missing):
        directory.mkdir()
        created_directories.append(directory)


def stage_payload(
    target: Path,
    payload: bytes,
    created_directories: list[Path],
) -> Path:
    ensure_directory(target.parent, created_directories)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{target.name}.promotion.", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        return Path(temp_name)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise


def preflight_update_payloads(
    plan: dict[str, Any],
) -> list[tuple[dict[str, Any], Path, bytes, bool]]:
    project = Path(plan["project"]).resolve()
    approved_root = (
        project / "workflow-images/storyboards/chapter-001/approved-revisions"
    ).resolve()
    payloads: list[tuple[dict[str, Any], Path, bytes, bool]] = []
    for update in plan["updates"]:
        source = Path(update["source"])
        source_payload = source.read_bytes()
        if sha256_bytes(source_payload) != update["sourceSha256"]:
            raise RuntimeError(f"推广源图已变化: {source}")
        destination = Path(update["destination"])
        try:
            destination.resolve().relative_to(approved_root)
        except ValueError as error:
            raise RuntimeError(f"推广目标越出批准目录: {destination}") from error
        existed = destination.exists()
        if existed and destination.read_bytes() != source_payload:
            raise RuntimeError(f"拒绝覆盖不同内容: {destination}")
        payloads.append((update, destination, source_payload, existed))
    return payloads


def existing_application(
    plan: dict[str, Any],
    store: dict[str, Any],
    store_sha256: str,
    report_path: Path,
) -> dict[str, Any] | None:
    if not report_path.is_file():
        return None
    report = load_json(report_path)
    state = store.get("state") or store
    storyboards_by_id = {
        str(item.get("id")): item for item in state.get("storyboards") or []
    }
    if not all(
        str(update["storyboardId"]) in storyboards_by_id
        and storyboard_matches_promotion(storyboards_by_id[str(update["storyboardId"])], update)
        for update in plan["updates"]
    ):
        return None
    if (
        report.get("applied") is not True
        or report.get("reportSha256") != plan["reportSha256"]
        or report.get("resultStoreSha256") != store_sha256
        or int(report.get("promotedImages") or 0) != len(plan["updates"])
    ):
        return None
    return {
        **report,
        "alreadyApplied": True,
        "promotionReport": str(report_path),
    }


def apply_promotion(plan: dict[str, Any], human_confirmed: bool) -> dict[str, Any]:
    if not human_confirmed:
        raise RuntimeError("写入推广必须显式提供 --human-confirmed")
    store_path = Path(plan["storePath"])
    store_payload = store_path.read_bytes()
    store_sha256 = sha256_bytes(store_payload)
    store = load_json_bytes(store_path, store_payload)
    state = store.get("state") or store
    storyboards_by_id = {str(item.get("id")): item for item in state.get("storyboards") or []}
    update_payloads = preflight_update_payloads(plan)
    report_path = promotion_report_path(plan)
    already_applied = existing_application(plan, store, store_sha256, report_path)
    if already_applied is not None:
        return already_applied
    if store_sha256 != plan["storeSha256"]:
        raise RuntimeError("生产 store 在 dry-run 后已变化，拒绝推广")
    if plan.get("alreadyApplied"):
        raise RuntimeError("store 显示已推广，但缺少匹配的推广报告")
    if report_path.exists():
        raise RuntimeError(f"拒绝覆盖不匹配的推广报告: {report_path}")

    for update, _destination, _source_payload, _existed in update_payloads:
        storyboard = storyboards_by_id[str(update["storyboardId"])]
        media_ref, flow_id, generated_node_id = promoted_media_ref(update)
        storyboard["mediaRef"] = media_ref
        storyboard["imageWorkflowId"] = flow_id
        storyboard["imageWorkflowNodeId"] = generated_node_id
        storyboard["orderedReferenceManifest"] = copy.deepcopy(update["referenceManifest"])
        storyboard["continuityState"] = copy.deepcopy(update["continuityState"])
        storyboard["outputVersion"] = int(update["targetOutputVersion"])
        storyboard["stale"] = False
        storyboard.pop("staleReason", None)
        storyboard.pop("staleSince", None)
        storyboard["visualReview"] = pending_visual_review(update, update["projectUrl"])

    result_store_payload = stable_json_bytes(store)
    result_store_sha256 = sha256_bytes(result_store_payload)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_dir = Path(plan["project"]) / "visual-continuity-backups" / (
        f"storyboard-promotion-{timestamp}-{plan['storeSha256'][:12]}"
    )
    applied = {
        **{key: value for key, value in plan.items() if key != "updates"},
        "dryRun": False,
        "applied": True,
        "alreadyApplied": False,
        "promotedAt": datetime.now(timezone.utc).isoformat(),
        "backupDir": str(backup_dir),
        "promotedImages": len(plan["updates"]),
        "approvedStoryboards": 0,
        "pendingStoryboards": len(plan["updates"]),
        "resultStoreSha256": result_store_sha256,
        "promotionReport": str(report_path),
    }
    created_directories: list[Path] = []
    staged_paths: list[Path] = []
    committed_new_paths: list[Path] = []
    try:
        backup_path = backup_dir / "studio-workflow-store.json"
        staged_backup = stage_payload(backup_path, store_payload, created_directories)
        staged_paths.append(staged_backup)
        staged_images: list[tuple[Path, Path]] = []
        for _update, destination, source_payload, existed in update_payloads:
            if existed:
                continue
            staged_image = stage_payload(destination, source_payload, created_directories)
            staged_paths.append(staged_image)
            staged_images.append((staged_image, destination))
        staged_report = stage_payload(report_path, stable_json_bytes(applied), created_directories)
        staged_paths.append(staged_report)
        staged_store = stage_payload(store_path, result_store_payload, created_directories)
        staged_paths.append(staged_store)

        if store_path.read_bytes() != store_payload:
            raise RuntimeError("生产 store 在提交前已变化，拒绝推广")

        os.replace(staged_backup, backup_path)
        staged_paths.remove(staged_backup)
        committed_new_paths.append(backup_path)
        for staged_image, destination in staged_images:
            os.replace(staged_image, destination)
            staged_paths.remove(staged_image)
            committed_new_paths.append(destination)
        os.replace(staged_report, report_path)
        staged_paths.remove(staged_report)
        committed_new_paths.append(report_path)
        os.replace(staged_store, store_path)
        return applied
    except Exception:
        for path in reversed(committed_new_paths):
            path.unlink(missing_ok=True)
        raise
    finally:
        for path in staged_paths:
            path.unlink(missing_ok=True)
        for directory in reversed(created_directories):
            try:
                directory.rmdir()
            except OSError:
                pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--project", type=Path, default=DEFAULT_PROJECT)
    parser.add_argument("--store", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--human-confirmed", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project = args.project.resolve()
    store_path = (args.store or (project / "studio-workflow-store.json")).resolve()
    plan = build_promotion_plan(args.report.resolve(), store_path, project)
    if args.human_confirmed and not args.apply:
        raise RuntimeError("--human-confirmed 只能与 --apply 同时使用")
    result = apply_promotion(plan, args.human_confirmed) if args.apply else plan
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
