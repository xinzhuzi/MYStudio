#!/usr/bin/env python3
"""Repair chapter-001 storyboard visual continuity metadata.

The script derives structural continuity metadata from the existing
storyboard image workflows. It does not regenerate images or delete assets.
By default it runs as a dry-run. Use --apply to write the repaired store after
creating a timestamped backup next to the source JSON.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any

try:
    from Library.build_daojie_chapter001_workflow import (
        normalize_continuity_asset_version,
        resolve_storyboard_source,
    )
except ModuleNotFoundError as error:
    if error.name != "Library":
        raise
    from build_daojie_chapter001_workflow import (
        normalize_continuity_asset_version,
        resolve_storyboard_source,
    )


PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec0"
EPISODE_ID = "chapter-001"


def default_store_path() -> Path:
    return (
        Path.home()
        / "Library/Application Support/漫影工作室/projects/_p"
        / PROJECT_ID
        / "studio-workflow-store.json"
    )


def stable_serialize(value: Any) -> str:
    return json.dumps(normalize_json_numbers(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def normalize_json_numbers(value: Any) -> Any:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [normalize_json_numbers(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_json_numbers(nested) for key, nested in value.items()}
    return value


def omit_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: nested for key, nested in value.items() if nested is not None}


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_store(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_store(path: Path, data: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.visual-continuity-{os.getpid()}.tmp")
    with temporary.open("x", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def backup_store(path: Path) -> Path:
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup = path.with_name(f"{path.name}.bak-visual-continuity-{stamp}")
    shutil.copy2(path, backup)
    return backup


def continuity_version_key(version: dict[str, Any]) -> str:
    return f"{version.get('assetId', '')}:{version.get('versionId', '')}"


def load_pending_asset_manifest(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    document = load_store(path)
    raw_versions = document.get("continuityAssetVersions")
    if not isinstance(raw_versions, list) or not raw_versions:
        raise RuntimeError(f"连续性资产 manifest 缺少 continuityAssetVersions: {path}")
    versions: list[dict[str, Any]] = []
    for raw in raw_versions:
        if (
            raw.get("reviewStatus") != "pending"
            or raw.get("approval") is not None
            or raw.get("approved") is not False
        ):
            raise RuntimeError("连续性资产 manifest 只能导入 pending 且未经人工批准的版本")
        enriched = copy.deepcopy(raw)
        reference_paths = [Path(str(value)) for value in enriched.get("referenceImagePaths") or []]
        missing_paths = [value for value in reference_paths if not value.is_file()]
        if missing_paths:
            raise RuntimeError(f"连续性资产参考图不存在: {', '.join(str(value) for value in missing_paths)}")
        if not enriched.get("referenceImageSha256"):
            enriched["referenceImageSha256"] = [
                hashlib.sha256(value.read_bytes()).hexdigest()
                for value in reference_paths
            ]
        version = normalize_continuity_asset_version(enriched)
        if version.get("approved") or not version.get("structurallyComplete"):
            raise RuntimeError(
                f"连续性资产版本不可导入: {version.get('assetId')}/{version.get('versionId')}"
            )
        versions.append(version)
    keys = [continuity_version_key(version) for version in versions]
    if len(keys) != len(set(keys)):
        raise RuntimeError("连续性资产 manifest 存在重复 assetId/versionId")
    return document, versions


def load_project_entity_names(project_dir: Path) -> dict[str, tuple[str, str]]:
    result: dict[str, tuple[str, str]] = {}
    sources = (
        (project_dir / "characters.json", "characters", "character"),
        (project_dir / "scenes.json", "scenes", "scene"),
        (project_dir / "props.json", "items", "prop"),
    )
    for path, state_key, asset_kind in sources:
        if not path.is_file():
            continue
        document = load_store(path)
        records = document.get("state", {}).get(state_key)
        if not isinstance(records, list):
            raise RuntimeError(f"项目资产文件缺少 state.{state_key}: {path}")
        for record in records:
            name = str(record.get("name") or "").strip()
            asset_id = str(record.get("id") or "").strip()
            if name and asset_id:
                result[name] = (asset_id, asset_kind)
    return result


def index_continuity_versions(
    versions: list[dict[str, Any]],
    entities: dict[str, tuple[str, str]],
) -> tuple[
    dict[tuple[str, str], dict[str, Any]],
    dict[str, list[dict[str, Any]]],
    dict[str, list[dict[str, Any]]],
]:
    versions_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    versions_by_id: dict[str, list[dict[str, Any]]] = {}
    for version in versions:
        asset_id = str(version.get("assetId") or "")
        version_id = str(version.get("versionId") or "")
        if not asset_id or not version_id:
            continue
        versions_by_key[(asset_id, version_id)] = version
        versions_by_id.setdefault(asset_id, []).append(version)
    versions_by_name = {
        name: list(versions_by_id.get(asset_id) or [])
        for name, (asset_id, _kind) in entities.items()
        if versions_by_id.get(asset_id)
    }
    return versions_by_key, versions_by_id, versions_by_name


def select_continuity_version(
    reference: dict[str, Any],
    versions_by_key: dict[tuple[str, str], dict[str, Any]],
    versions_by_id: dict[str, list[dict[str, Any]]],
    versions_by_name: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    asset_id = str(reference.get("assetId") or "")
    version_id = str(reference.get("versionId") or "")
    exact = versions_by_key.get((asset_id, version_id))
    if exact is not None:
        return exact

    candidates = list(versions_by_id.get(asset_id) or [])
    if not candidates:
        candidates = list(versions_by_name.get(str(reference.get("assetName") or "")) or [])
    asset_kind = str(reference.get("assetKind") or "")
    candidates = [version for version in candidates if version.get("assetKind") == asset_kind]

    viewpoint_id = str(reference.get("sceneViewpointId") or "")
    if asset_kind == "scene" and viewpoint_id:
        candidates = [version for version in candidates if version.get("sceneViewpointId") == viewpoint_id]
    wardrobe_version = str(reference.get("wardrobeVersion") or "")
    if asset_kind == "character" and wardrobe_version:
        candidates = [version for version in candidates if version.get("wardrobeVersion") == wardrobe_version]
    return candidates[0] if len(candidates) == 1 else None


def apply_available_versions_to_references(
    references: list[dict[str, Any]],
    versions: list[dict[str, Any]],
    entities: dict[str, tuple[str, str]],
) -> tuple[list[dict[str, Any]], dict[tuple[str, str], dict[str, Any]]]:
    versions_by_key, versions_by_id, versions_by_name = index_continuity_versions(versions, entities)
    old_to_new: dict[tuple[str, str], dict[str, Any]] = {}
    updated_references: list[dict[str, Any]] = []
    for reference in references:
        version = select_continuity_version(reference, versions_by_key, versions_by_id, versions_by_name)
        if version is None:
            updated_references.append(reference)
            continue
        old_key = (
            str(reference.get("assetId") or ""),
            str(reference.get("versionId") or ""),
        )
        old_to_new[old_key] = version
        updated_references.append(apply_version_to_reference(reference, version))
    return updated_references, old_to_new


def apply_version_to_reference(
    reference: dict[str, Any],
    version: dict[str, Any],
) -> dict[str, Any]:
    paths = list(version.get("referenceImagePaths") or [])
    updated = {
        **reference,
        "assetId": version["assetId"],
        "assetKind": version["assetKind"],
        "versionId": version["versionId"],
        "imagePath": paths[0],
        "referenceImagePaths": paths,
        "referenceImageSha256": list(version.get("referenceImageSha256") or []),
        "referenceViewTypes": list(version.get("referenceViewTypes") or []),
        "source": version["source"],
        "contentFingerprint": version["contentFingerprint"],
        # An approved Bible version is authoritative for the reference too.
        # Pending versions intentionally remain unapproved, while approved
        # versions carry their exact approval fingerprint so the visual audit
        # can verify the reference against the asset-level approval record.
        "approvalFingerprint": version.get("approvalFingerprint"),
        "approved": version.get("approved") is True,
    }
    optional_fields = (
        "identityAnchors",
        "negativePrompt",
        "wardrobeVersion",
        "sceneViewpointId",
    )
    for field in optional_fields:
        if version.get(field) is not None:
            updated[field] = copy.deepcopy(version[field])
        else:
            updated.pop(field, None)
    return updated


def reset_storyboard_visual_review(storyboard: dict[str, Any], reason: str) -> None:
    continuity = storyboard.get("continuityState") or {}
    references = storyboard.get("orderedReferenceManifest") or []
    storyboard["visualReview"] = {
        "status": "pending",
        "reasons": [reason],
        "characterChecks": [
            {"characterId": item.get("characterId"), "passed": False}
            for item in continuity.get("characters") or []
        ],
        "sceneChecks": [
            {"sceneVersionId": continuity.get("sceneVersionId"), "passed": False}
        ] if continuity.get("sceneVersionId") else [],
        "propChecks": [
            {
                "assetId": item.get("assetId"),
                "versionId": item.get("versionId"),
                "passed": False,
            }
            for item in references
            if item.get("referenceRole") == "prop-state"
        ],
        "transitionChecks": [
            {
                "previousStoryboardId": continuity.get("previousStoryboardId"),
                "passed": False,
            }
        ] if continuity.get("previousStoryboardId") else [],
        "textWatermarkCheck": {"passed": False},
        "reviewer": "automated",
        "reviewedAt": int(dt.datetime.now().timestamp() * 1000),
        "evidencePaths": [storyboard.get("mediaRef", {}).get("path", "")],
    }


def workflow_by_storyboard(image_workflows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for workflow in image_workflows:
        target = workflow.get("target") or {}
        if target.get("kind") == "storyboard" and target.get("id"):
            result[str(target["id"])] = workflow
    return result


def reference_role(asset_type: str) -> str:
    if asset_type == "scene":
        return "scene-viewpoint"
    if asset_type == "prop":
        return "prop-state"
    return "canonical"


def reference_version_id(source: dict[str, Any], title: str) -> str:
    asset_id = str(source.get("id") or title).strip()
    asset_type = str(source.get("assetType") or "asset").strip()
    suffix = "base"
    if asset_type == "scene":
        suffix = "viewpoint-base"
    elif asset_type == "prop":
        suffix = "state-base"
    return f"{asset_type}:{asset_id}:{suffix}"


def ordered_references(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for node in workflow.get("nodes") or []:
        if node.get("type") != "reference":
            continue
        source = node.get("source") or {}
        image_path = str(node.get("imageUrl") or "").strip()
        asset_id = str(source.get("id") or node.get("title") or "").strip()
        asset_type = str(source.get("assetType") or "asset").strip()
        continuity_version_id = str(node.get("continuityVersionId") or "").strip()
        scene_viewpoint_id = str(node.get("sceneViewpointId") or "").strip()
        refs.append(
            {
                "order": len(refs) + 1,
                "assetId": asset_id,
                "assetName": str(node.get("title") or asset_id),
                "assetKind": asset_type,
                "imagePath": image_path,
                "source": "existing-storyboard-image-workflow",
                "versionId": continuity_version_id
                or reference_version_id(source, str(node.get("title") or asset_id)),
                "referenceRole": reference_role(asset_type),
                "sceneViewpointId": scene_viewpoint_id if asset_type == "scene" else None,
                "approved": False,
            }
        )
    for ref in refs:
        if ref.get("sceneViewpointId") is None:
            ref.pop("sceneViewpointId", None)
    return refs


def first_scene_reference(refs: list[dict[str, Any]]) -> dict[str, Any] | None:
    for ref in refs:
        if ref.get("assetKind") == "scene":
            return ref
    return refs[0] if refs else None


def expected_scene_reference(
    project_dir: Path | None,
    scene_name: str,
    viewpoint_id: str,
    order: int,
) -> dict[str, Any] | None:
    if project_dir is None:
        return None
    scenes_path = project_dir / "scenes.json"
    if not scenes_path.is_file():
        return None
    records = load_store(scenes_path).get("state", {}).get("scenes") or []
    matches = [record for record in records if record.get("name") == scene_name]
    if len(matches) != 1:
        return None
    record = matches[0]
    image_path = str(record.get("referenceImage") or "").strip()
    asset_id = str(record.get("id") or "").strip()
    if not asset_id or not image_path or not Path(image_path).is_file():
        return None
    return {
        "order": order,
        "assetId": asset_id,
        "assetName": scene_name,
        "assetKind": "scene",
        "imagePath": image_path,
        "source": "project-scene-contract-repair",
        "versionId": f"{asset_id}:{viewpoint_id}:v1",
        "referenceRole": "scene-viewpoint",
        "sceneViewpointId": viewpoint_id,
        "approved": False,
    }


def character_states(
    refs: list[dict[str, Any]],
    visible_characters: list[dict[str, Any]],
) -> list[dict[str, str]]:
    refs_by_name = {
        str(ref.get("assetName") or ""): ref
        for ref in refs
        if ref.get("assetKind") == "character"
    }
    states: list[dict[str, str]] = []
    for character in visible_characters:
        name = str(character.get("name") or "")
        ref = refs_by_name.get(name)
        if not ref:
            raise RuntimeError(f"当前分镜语义中的出镜角色缺少对应参考: {name}")
        states.append(
            {
                "characterId": str(ref["assetId"]),
                "versionId": str(ref["versionId"]),
                "position": str(character["position"]),
                "orientation": str(character["orientation"]),
                "actionIn": str(character["actionIn"]),
                "actionOut": str(character["actionOut"]),
            }
        )
    return states


def continuity_fingerprint(storyboard: dict[str, Any]) -> str:
    refs = sorted(storyboard.get("orderedReferenceManifest") or [], key=lambda item: item.get("order", 0))
    continuity = copy.deepcopy(storyboard.get("continuityState"))
    if continuity:
        continuity.pop("inputFingerprint", None)
    payload = {
        "prompt": storyboard.get("prompt"),
        "references": [
            omit_none(
                {
                    "order": ref.get("order"),
                    "assetId": ref.get("assetId"),
                    "versionId": ref.get("versionId"),
                    "imagePath": ref.get("imagePath"),
                    "referenceImagePaths": ref.get("referenceImagePaths"),
                    "referenceImageSha256": ref.get("referenceImageSha256"),
                    "referenceViewTypes": ref.get("referenceViewTypes"),
                    "referenceRole": ref.get("referenceRole"),
                    "wardrobeVersion": ref.get("wardrobeVersion"),
                    "sceneViewpointId": ref.get("sceneViewpointId"),
                    "contentFingerprint": ref.get("contentFingerprint"),
                }
            )
            for ref in refs
        ],
        "continuity": continuity,
    }
    return stable_serialize(payload)


def storyboard_source_fingerprint(storyboard: dict[str, Any]) -> str:
    continuity = copy.deepcopy(storyboard.get("continuityState"))
    if continuity:
        continuity.pop("inputFingerprint", None)
    return stable_serialize(
        omit_none(
            {
                "episodeId": storyboard.get("episodeId"),
                "index": storyboard.get("index"),
                "trackKey": storyboard.get("trackKey"),
                "duration": storyboard.get("duration"),
                "prompt": storyboard.get("prompt"),
                "videoDesc": storyboard.get("videoDesc"),
                "assetIds": storyboard.get("assetIds") or [],
                "shouldGenerateImage": storyboard.get("shouldGenerateImage"),
                "orderedReferenceManifest": storyboard.get("orderedReferenceManifest") or [],
                "continuityState": continuity,
                "lines": storyboard.get("lines"),
                "speakerId": storyboard.get("speakerId"),
            }
        )
    )


def align_source_fields(
    storyboards: list[dict[str, Any]],
    align_store: Path | None,
) -> dict[str, dict[str, Any]]:
    if not align_store:
        return {}
    reference = load_store(align_store)
    reference_items = {
        str(item.get("id")): item
        for item in (reference.get("state", {}).get("storyboards") or [])
        if item.get("episodeId") == EPISODE_ID
    }
    changed: dict[str, dict[str, Any]] = {}
    source_keys = [
        "episodeId",
        "index",
        "trackKey",
        "duration",
        "prompt",
        "videoDesc",
        "assetIds",
        "shouldGenerateImage",
        "lines",
        "speakerId",
    ]
    for storyboard in storyboards:
        other = reference_items.get(str(storyboard.get("id")))
        if not other:
            continue
        diff: dict[str, Any] = {}
        for key in source_keys:
            if other.get(key) != storyboard.get(key):
                diff[key] = {"from": storyboard.get(key), "to": other.get(key)}
                if key in other:
                    storyboard[key] = copy.deepcopy(other[key])
                else:
                    storyboard.pop(key, None)
        if diff:
            changed[str(storyboard.get("id"))] = diff
    return changed


def sync_pending_asset_manifest(
    state: dict[str, Any],
    manifest_path: Path,
) -> dict[str, Any]:
    manifest, versions = load_pending_asset_manifest(manifest_path)
    project_dir = Path(str(manifest.get("projectDir") or "")).resolve()
    if not project_dir.is_dir():
        raise RuntimeError(f"连续性资产 manifest 的 projectDir 不存在: {project_dir}")
    entities = load_project_entity_names(project_dir)
    incoming_keys = {continuity_version_key(version) for version in versions}
    state["continuityAssetVersions"] = [
        item
        for item in state.get("continuityAssetVersions") or []
        if continuity_version_key(item) not in incoming_keys
    ] + copy.deepcopy(versions)

    storyboards = sorted(
        [item for item in state.get("storyboards") or [] if item.get("episodeId") == EPISODE_ID],
        key=lambda item: int(item.get("index") or 0),
    )
    directly_changed: list[str] = []
    first_changed_by_group: dict[str, int] = {}
    for storyboard in storyboards:
        references = storyboard.get("orderedReferenceManifest") or []
        old_to_new: dict[tuple[str, str], dict[str, Any]] = {}
        changed = False
        updated_references, old_to_new = apply_available_versions_to_references(
            references,
            versions,
            entities,
        )
        changed = stable_serialize(updated_references) != stable_serialize(references)
        if not changed:
            continue
        storyboard["orderedReferenceManifest"] = updated_references
        continuity = storyboard.get("continuityState") or {}
        for character in continuity.get("characters") or []:
            version = old_to_new.get((
                str(character.get("characterId") or ""),
                str(character.get("versionId") or ""),
            ))
            if version and version.get("assetKind") == "character":
                character["characterId"] = version["assetId"]
                character["versionId"] = version["versionId"]
        primary_scene = next(
            (
                item for item in updated_references
                if item.get("assetKind") == "scene" and item.get("referenceRole") == "scene-viewpoint"
            ),
            None,
        )
        if primary_scene:
            continuity["sceneVersionId"] = primary_scene["versionId"]
            continuity["sceneViewpointId"] = primary_scene.get("sceneViewpointId") or continuity.get("sceneViewpointId")
        storyboard["continuityState"] = continuity
        continuity["inputFingerprint"] = continuity_fingerprint(storyboard)
        storyboard["sourceFingerprint"] = storyboard_source_fingerprint(storyboard)
        storyboard["stale"] = True
        storyboard["staleReason"] = "连续性资产 Bible 已更新，必须重新生成并审核"
        storyboard["staleSince"] = int(dt.datetime.now().timestamp() * 1000)
        reset_storyboard_visual_review(storyboard, "连续性资产 Bible 已更新，必须重新生成并审核")
        storyboard_id = str(storyboard.get("id") or "")
        directly_changed.append(storyboard_id)
        group_id = str(continuity.get("groupId") or "")
        index = int(storyboard.get("index") or 0)
        if group_id:
            first_changed_by_group[group_id] = min(first_changed_by_group.get(group_id, index), index)

    propagated: list[str] = []
    direct_ids = set(directly_changed)
    for storyboard in storyboards:
        continuity = storyboard.get("continuityState") or {}
        group_id = str(continuity.get("groupId") or "")
        first_changed = first_changed_by_group.get(group_id)
        storyboard_id = str(storyboard.get("id") or "")
        if first_changed is None or int(storyboard.get("index") or 0) < first_changed or storyboard_id in direct_ids:
            continue
        storyboard["stale"] = True
        storyboard["staleReason"] = "上游连续镜头引用的资产 Bible 已更新"
        storyboard["staleSince"] = int(dt.datetime.now().timestamp() * 1000)
        reset_storyboard_visual_review(storyboard, "上游连续镜头引用的资产 Bible 已更新")
        propagated.append(storyboard_id)
    return {
        "manifest": str(manifest_path),
        "versions": len(versions),
        "pending": sum(version.get("approved") is not True for version in versions),
        "approved": sum(version.get("approved") is True for version in versions),
        "directlyChangedStoryboards": directly_changed,
        "propagatedStoryboards": propagated,
    }


def canonical_storyboard_asset_ids(storyboard: dict[str, Any]) -> list[str]:
    references = sorted(
        storyboard.get("orderedReferenceManifest") or [],
        key=lambda item: int(item.get("order") or 0),
    )
    return [
        str(reference.get("assetId") or "").strip()
        for reference in references
        if str(reference.get("assetId") or "").strip()
    ]


def align_storyboard_asset_ids(storyboards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for storyboard in storyboards:
        if storyboard.get("episodeId") != EPISODE_ID:
            continue
        canonical_ids = canonical_storyboard_asset_ids(storyboard)
        if not canonical_ids or storyboard.get("assetIds") == canonical_ids:
            continue
        changes.append({
            "storyboardId": storyboard.get("id"),
            "index": storyboard.get("index"),
            "from": copy.deepcopy(storyboard.get("assetIds") or []),
            "to": canonical_ids,
        })
        storyboard["assetIds"] = canonical_ids
        storyboard["sourceFingerprint"] = storyboard_source_fingerprint(storyboard)
    return changes


def sync_script_shot_asset_ids(
    script_document: dict[str, Any],
    storyboards: list[dict[str, Any]],
) -> dict[str, Any]:
    shots = script_document.get("shots")
    if not isinstance(shots, list):
        raise RuntimeError("script.json 缺少顶层 shots 数组")
    chapter_storyboards = [item for item in storyboards if item.get("episodeId") == EPISODE_ID]
    by_id: dict[str, dict[str, Any]] = {}
    by_index: dict[int, list[dict[str, Any]]] = {}
    for storyboard in chapter_storyboards:
        storyboard_id = str(storyboard.get("id") or "")
        if not storyboard_id or storyboard_id in by_id:
            raise RuntimeError(f"Studio store 存在空或重复 storyboard id: {storyboard_id}")
        by_id[storyboard_id] = storyboard
        by_index.setdefault(int(storyboard.get("index") or 0), []).append(storyboard)

    matched_storyboard_ids: set[str] = set()
    changed_shots: list[str] = []
    unmatched_script_shots: list[str] = []
    for shot in shots:
        if shot.get("episodeId") != EPISODE_ID:
            continue
        shot_id = str(shot.get("id") or "")
        storyboard = by_id.get(shot_id)
        if storyboard is None:
            matches = by_index.get(int(shot.get("index") or 0), [])
            storyboard = matches[0] if len(matches) == 1 else None
        if storyboard is None:
            unmatched_script_shots.append(shot_id or f"index:{shot.get('index')}")
            continue
        storyboard_id = str(storyboard["id"])
        matched_storyboard_ids.add(storyboard_id)
        canonical_ids = canonical_storyboard_asset_ids(storyboard)
        if not canonical_ids:
            raise RuntimeError(f"分镜 {storyboard_id} 缺少 canonical orderedReferenceManifest")
        if shot.get("assetIds") != canonical_ids:
            shot["assetIds"] = copy.deepcopy(canonical_ids)
            changed_shots.append(shot_id or storyboard_id)
    return {
        "shots": len([shot for shot in shots if shot.get("episodeId") == EPISODE_ID]),
        "changedShots": changed_shots,
        "unmatchedScriptShots": unmatched_script_shots,
        "missingScriptStoryboards": sorted(set(by_id) - matched_storyboard_ids),
    }


def repair_storyboards(
    state: dict[str, Any],
    review_status: str,
    align_store: Path | None,
    project_dir: Path | None = None,
) -> dict[str, Any]:
    if review_status != "pending":
        raise RuntimeError("结构修复只能写入 pending，禁止自动批准视觉资产或分镜")
    workflows = workflow_by_storyboard(state.get("imageWorkflows") or [])
    source = resolve_storyboard_source(state, EPISODE_ID)
    source_by_index = {
        int(shot.get("index") or 0): shot
        for shot in source.get("shots") or []
    }
    storyboards = sorted(
        [item for item in state.get("storyboards") or [] if item.get("episodeId") == EPISODE_ID],
        key=lambda item: item.get("index", 0),
    )
    existing_versions = list(state.get("continuityAssetVersions") or [])
    entities = load_project_entity_names(project_dir) if project_dir is not None else {}
    aligned_source_fields = align_source_fields(storyboards, align_store)
    previous_by_group: dict[str, str] = {}
    report = {
        "storyboards": len(storyboards),
        "repaired": 0,
        "alignedSourceFields": aligned_source_fields,
        "missingWorkflows": [],
        "missingReferences": [],
        "unapprovedReferences": [],
        "sceneGroupMismatches": [],
        "repairedSceneGroupMismatches": [],
        "durationAlignedToTarget": [],
        "reviewStatus": review_status,
    }
    for storyboard in storyboards:
        previous_continuity = storyboard.get("continuityState") or {}
        previous_input_fingerprint = str(previous_continuity.get("inputFingerprint") or "")
        was_stale = storyboard.get("stale") is True
        previous_stale_reason = str(storyboard.get("staleReason") or "").strip()
        previous_stale_since = storyboard.get("staleSince")
        duration_target = storyboard.get("durationTarget")
        if duration_target is not None and storyboard.get("duration") != duration_target:
            report["durationAlignedToTarget"].append(
                {
                    "storyboardId": storyboard.get("id"),
                    "from": storyboard.get("duration"),
                    "to": duration_target,
                }
            )
            storyboard["renderDuration"] = storyboard.get("duration")
            storyboard["duration"] = duration_target
        workflow = workflows.get(str(storyboard.get("id")))
        if not workflow:
            report["missingWorkflows"].append(storyboard.get("id"))
            continue
        refs = ordered_references(workflow)
        if not refs:
            report["missingReferences"].append(storyboard.get("id"))
            continue
        index = int(storyboard.get("index") or 0)
        source_shot = source_by_index.get(index)
        group = source_shot.get("_continuityGroup") if source_shot else None
        semantics = source_shot.get("shotSemantics") if source_shot else None
        if not isinstance(group, dict) or not isinstance(semantics, dict):
            raise RuntimeError(f"分镜 {index:03d} 缺少当前分镜源的逐镜语义或连续镜头组，拒绝修复旧审核")
        source_assets = {str(name) for name in source_shot.get("assets") or []}
        visible_asset_names = {
            *(str(item["name"]) for item in semantics["visibleCharacters"]),
            *(str(item["name"]) for item in semantics["visibleProps"]),
        }
        if not visible_asset_names.issubset(source_assets):
            raise RuntimeError(f"分镜 {index:03d} 逐镜人物或道具未绑定到当前分镜关联资产")
        scene = next(
            (
                ref for ref in refs
                if ref.get("assetKind") == "scene" and ref.get("assetName") == (group or {}).get("sceneName")
            ),
            None,
        )
        if group and not scene:
            scene_indexes = [
                offset for offset, reference in enumerate(refs)
                if reference.get("assetKind") == "scene"
            ]
            replacement = expected_scene_reference(
                project_dir,
                str(group["sceneName"]),
                str(group["viewpointId"]),
                int(refs[scene_indexes[0]].get("order") or scene_indexes[0] + 1) if scene_indexes else 1,
            )
            if replacement:
                if scene_indexes:
                    replaced = refs[scene_indexes[0]]
                    refs[scene_indexes[0]] = replacement
                else:
                    replaced = None
                    refs.insert(0, replacement)
                    for order, reference in enumerate(refs, 1):
                        reference["order"] = order
                scene = replacement
                report["repairedSceneGroupMismatches"].append({
                    "storyboardId": storyboard.get("id"),
                    "index": index,
                    "expectedScene": group["sceneName"],
                    "replacedScene": (replaced or {}).get("assetName"),
                })
        if not group or not scene:
            report["sceneGroupMismatches"].append(
                {
                    "storyboardId": storyboard.get("id"),
                    "index": index,
                    "expectedScene": (group or {}).get("sceneName"),
                    "actualScenes": [ref.get("assetName") for ref in refs if ref.get("assetKind") == "scene"],
                }
            )
            continue
        for reference in refs:
            if reference.get("assetKind") == "scene":
                reference["referenceRole"] = "scene-viewpoint" if reference is scene else "secondary-scene"
        refs, _old_to_new = apply_available_versions_to_references(refs, existing_versions, entities)
        scene = next(
            (
                reference for reference in refs
                if reference.get("assetKind") == "scene"
                and reference.get("assetName") == group["sceneName"]
                and reference.get("referenceRole") == "scene-viewpoint"
            ),
            None,
        )
        if scene is None:
            report["sceneGroupMismatches"].append(
                {
                    "storyboardId": storyboard.get("id"),
                    "index": index,
                    "expectedScene": group["sceneName"],
                    "actualScenes": [ref.get("assetName") for ref in refs if ref.get("assetKind") == "scene"],
                }
            )
            continue
        scene_version = str(scene["versionId"])
        scene_viewpoint = str(scene.get("sceneViewpointId") or group["viewpointId"])
        unapproved = [ref for ref in refs if ref.get("approved") is not True]
        if unapproved:
            report["unapprovedReferences"].append(
                {
                    "storyboardId": storyboard.get("id"),
                    "references": [ref.get("assetId") for ref in unapproved],
                }
            )
        group_id = str(group["groupId"])
        storyboard["shotSemantics"] = copy.deepcopy(semantics)
        storyboard["orderedReferenceManifest"] = refs
        character_continuity = character_states(refs, semantics["visibleCharacters"])
        storyboard["continuityState"] = {
            "groupId": group_id,
            "previousStoryboardId": previous_by_group.get(group_id),
            "sceneVersionId": scene_version,
            "sceneViewpointId": scene_viewpoint,
            "lighting": "沿用导演计划与本镜现有成图光照",
            "palette": "沿用道劫水墨国风视觉手册",
            "actionIn": semantics["actionIn"],
            "actionOut": semantics["actionOut"],
            "characters": character_continuity,
            "sourceSemanticsFingerprint": stable_serialize(semantics),
            "inputFingerprint": "",
        }
        if not storyboard["continuityState"]["previousStoryboardId"]:
            storyboard["continuityState"].pop("previousStoryboardId")
        storyboard["continuityState"]["inputFingerprint"] = continuity_fingerprint(storyboard)
        continuity_changed = (
            previous_input_fingerprint
            != storyboard["continuityState"]["inputFingerprint"]
        )
        if was_stale or (continuity_changed and storyboard.get("mediaRef", {}).get("path")):
            storyboard["stale"] = True
            storyboard["staleReason"] = previous_stale_reason or "连续性结构已更新，必须重新生成并审核"
            storyboard["staleSince"] = (
                previous_stale_since
                if isinstance(previous_stale_since, int) and previous_stale_since > 0
                else int(dt.datetime.now().timestamp() * 1000)
            )
        else:
            storyboard.pop("stale", None)
            storyboard.pop("staleReason", None)
            storyboard.pop("staleSince", None)
        storyboard["sourceFingerprint"] = storyboard_source_fingerprint(storyboard)
        storyboard["visualReview"] = {
            "status": review_status,
            "reasons": [] if review_status == "approved" else ["等待逐镜视觉复核"],
            "characterChecks": [
                {"characterId": state["characterId"], "passed": review_status == "approved"}
                for state in storyboard["continuityState"]["characters"]
            ],
            "sceneChecks": [{"sceneVersionId": scene_version, "passed": review_status == "approved"}],
            "propChecks": [
                {
                    "assetId": ref.get("assetId"),
                    "versionId": ref.get("versionId"),
                    "passed": False,
                }
                for ref in refs
                if ref.get("referenceRole") == "prop-state"
            ],
            "transitionChecks": [
                {
                    "previousStoryboardId": storyboard["continuityState"].get("previousStoryboardId"),
                    "passed": review_status == "approved",
                }
            ],
            "textWatermarkCheck": {"passed": False},
            "reviewer": "automated",
            "evidencePaths": [],
        }
        previous_by_group[group_id] = str(storyboard.get("id"))
        report["repaired"] += 1
    report["assetIdsAligned"] = align_storyboard_asset_ids(storyboards)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", type=Path, default=default_store_path())
    parser.add_argument("--script", type=Path)
    parser.add_argument("--align-from-store", type=Path)
    parser.add_argument("--asset-manifest", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--review-status", choices=["pending"], default="pending")
    args = parser.parse_args()

    store_path = args.store.expanduser().resolve()
    script_path = (args.script or store_path.parent / "script.json").expanduser().resolve()
    data = load_store(store_path)
    script_data = load_store(script_path)
    before = sha256_text(store_path.read_text(encoding="utf-8"))
    script_before = sha256_text(script_path.read_text(encoding="utf-8"))
    report = repair_storyboards(
        data["state"],
        args.review_status,
        args.align_from_store,
        store_path.parent,
    )
    if args.asset_manifest:
        report["assetSync"] = sync_pending_asset_manifest(data["state"], args.asset_manifest.resolve())
        report["assetIdsAligned"].extend(align_storyboard_asset_ids(data["state"].get("storyboards") or []))
    report["scriptSync"] = sync_script_shot_asset_ids(
        script_data,
        data["state"].get("storyboards") or [],
    )
    if (
        report["scriptSync"]["unmatchedScriptShots"]
        or report["scriptSync"]["missingScriptStoryboards"]
    ):
        raise RuntimeError(
            "studio-workflow-store.json 与 script.json 的 chapter-001 分镜无法一一对应: "
            f"{report['scriptSync']}"
        )
    after_text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    after = sha256_text(after_text)
    script_after_text = json.dumps(script_data, ensure_ascii=False, indent=2) + "\n"
    script_after = sha256_text(script_after_text)
    report["storeChanged"] = before != after
    report["scriptChanged"] = script_before != script_after
    report["changed"] = report["storeChanged"] or report["scriptChanged"]
    report["store"] = str(store_path)
    report["script"] = str(script_path)
    if args.apply and report["changed"]:
        store_backup = backup_store(store_path) if report["storeChanged"] else None
        script_backup = backup_store(script_path) if report["scriptChanged"] else None
        if report["storeChanged"]:
            write_store(store_path, data)
        if report["scriptChanged"]:
            write_store(script_path, script_data)
        report["backup"] = str(store_backup) if store_backup else None
        report["scriptBackup"] = str(script_backup) if script_backup else None
    elif args.apply:
        report["backup"] = None
        report["scriptBackup"] = None
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
