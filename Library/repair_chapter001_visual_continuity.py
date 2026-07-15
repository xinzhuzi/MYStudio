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
    from Library.build_daojie_chapter001_workflow import continuity_group_for_index
except ModuleNotFoundError as error:
    if error.name != "Library":
        raise
    from build_daojie_chapter001_workflow import continuity_group_for_index


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
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def backup_store(path: Path) -> Path:
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = path.with_name(f"{path.name}.bak-visual-continuity-{stamp}")
    shutil.copy2(path, backup)
    return backup


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
                "approved": bool(asset_id and image_path and Path(image_path).exists()),
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


def character_states(refs: list[dict[str, Any]], prompt: str) -> list[dict[str, str]]:
    states: list[dict[str, str]] = []
    for ref in refs:
        if ref.get("assetKind") != "character":
            continue
        states.append(
            {
                "characterId": str(ref["assetId"]),
                "versionId": str(ref["versionId"]),
                "position": "按本镜构图锁定",
                "orientation": "按本镜画面朝向锁定",
                "actionIn": prompt,
                "actionOut": prompt,
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
                    "referenceRole": ref.get("referenceRole"),
                    "wardrobeVersion": ref.get("wardrobeVersion"),
                    "sceneViewpointId": ref.get("sceneViewpointId"),
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


def repair_storyboards(state: dict[str, Any], review_status: str, align_store: Path | None) -> dict[str, Any]:
    workflows = workflow_by_storyboard(state.get("imageWorkflows") or [])
    storyboards = sorted(
        [item for item in state.get("storyboards") or [] if item.get("episodeId") == EPISODE_ID],
        key=lambda item: item.get("index", 0),
    )
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
        "durationAlignedToTarget": [],
        "reviewStatus": review_status,
    }
    for storyboard in storyboards:
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
        unapproved = [ref for ref in refs if ref.get("approved") is not True]
        if unapproved:
            report["unapprovedReferences"].append(
                {
                    "storyboardId": storyboard.get("id"),
                    "references": [ref.get("assetId") for ref in unapproved],
                }
            )
        index = int(storyboard.get("index") or 0)
        group = continuity_group_for_index(index)
        scene = next(
            (
                ref for ref in refs
                if ref.get("assetKind") == "scene" and ref.get("assetName") == (group or {}).get("sceneName")
            ),
            None,
        )
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
        scene_version = str(scene["versionId"])
        scene_viewpoint = str(scene.get("sceneViewpointId") or group["viewpointId"])
        group_id = str(group["groupId"])
        prompt = str(storyboard.get("prompt") or "").strip()
        storyboard["orderedReferenceManifest"] = refs
        storyboard["continuityState"] = {
            "groupId": group_id,
            "previousStoryboardId": previous_by_group.get(group_id),
            "sceneVersionId": scene_version,
            "sceneViewpointId": scene_viewpoint,
            "lighting": "沿用导演计划与本镜现有成图光照",
            "palette": "沿用道劫水墨国风视觉手册",
            "actionIn": prompt,
            "actionOut": prompt,
            "characters": character_states(refs, prompt),
            "inputFingerprint": "",
        }
        if not storyboard["continuityState"]["previousStoryboardId"]:
            storyboard["continuityState"].pop("previousStoryboardId")
        storyboard["continuityState"]["inputFingerprint"] = continuity_fingerprint(storyboard)
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
            "transitionChecks": [
                {
                    "previousStoryboardId": storyboard["continuityState"].get("previousStoryboardId"),
                    "passed": review_status == "approved",
                }
            ],
            "reviewer": "automated",
            "reviewedAt": int(dt.datetime.now().timestamp() * 1000),
            "evidencePaths": [storyboard.get("mediaRef", {}).get("path", "")],
        }
        previous_by_group[group_id] = str(storyboard.get("id"))
        report["repaired"] += 1
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", type=Path, default=default_store_path())
    parser.add_argument("--align-from-store", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--review-status", choices=["pending", "approved"], default="pending")
    args = parser.parse_args()

    data = load_store(args.store)
    before = sha256_text(args.store.read_text(encoding="utf-8"))
    report = repair_storyboards(data["state"], args.review_status, args.align_from_store)
    after_text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    after = sha256_text(after_text)
    report["changed"] = before != after
    report["store"] = str(args.store)
    if args.apply and before != after:
        backup = backup_store(args.store)
        write_store(args.store, data)
        report["backup"] = str(backup)
    elif args.apply:
        report["backup"] = None
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
