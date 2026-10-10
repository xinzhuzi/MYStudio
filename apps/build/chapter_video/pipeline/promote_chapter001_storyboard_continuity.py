#!/usr/bin/env python3
"""Promote explicitly scoped, human-approved chapter-001 continuity frames.

跨层版本纪律(提案五①,2026-09-29):推广提交=上游分镜新版本的人工确认动作。
此时依赖旧版的下游产物(该镜旧 H3 片/TTS 音频/提示词引用)显式标
``downstreamExpiry``=「已过期-禁止使用」——不删除、不自动重写旧产物,清除只能
经下一次人工确认的推广(语义照分镜 stale 三件套「显式标记+人工确认」形态,
源=docs/research/PIPELINE_METHODS_ABSORPTION_ANALYSIS_2026-09-28.md 提案五
与 docs/comfyui-kb/跨镜连续性规范.md §六)。下游产物清单真源
=分镜上的既有引用字段(mediaRef kind=video/audioRef/ttsJob/prompt+videoDesc),
未记录的产物绝不标(零误伤)。资产批准推广(promote_chapter001_continuity_approvals)
不是分镜版本确认,不产生本标记。

受影响区间重算(§六/§七P5,2026-09-29):``affected_continuity_interval``=
repair/promote 共用纯函数——下界=被改镜,上界=首个入场状态不再依赖被改镜的镜头
(依赖判据=continuityState.previousStoryboardId 同组链+keyframes origin
legacy-shot 回接,两类既有数据)。关键帧过期语义:依赖旧首/尾帧的关键帧标
``status``=「已过期-禁止使用」(与 A3 下游标记同词表同一语义,per-keyframe 显式
标记);提升计划拦未标记的旧帧回接依赖(不得旧图配新镜清单),修复链负责区间内
显式标记后放行。
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from PIL import Image


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
try:
    from apps.build.chapter_video.path_resolver import resolve_project_dir
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from path_resolver import resolve_project_dir

EXPECTED_SHOTS = list(range(1, 44))

EXPIRED_FORBIDDEN_USE = "已过期-禁止使用"
DOWNSTREAM_EXPIRY_FIELD = "downstreamExpiry"


def collect_downstream_artifacts(storyboard: dict[str, Any]) -> list[dict[str, Any]]:
    """盘点分镜上已记录的下游产物(该镜旧 H3 片/TTS 音频/提示词引用)。

    零误伤口径:只收分镜上**实际存在**的引用字段——未记录的产物不列、不标。
    字段真源=真实生产 store 形态(audioRef/prompt/videoDesc 43/43,ttsJob 任务
    记录,视频镜 mediaRef kind=video)+前端 StoryboardItem 可选字段
    (apps/frontend/types/studio-storyboard-types.ts:147-164)。
    """
    artifacts: list[dict[str, Any]] = []
    media_ref = storyboard.get("mediaRef")
    if isinstance(media_ref, dict) and media_ref.get("kind") == "video":
        # 该镜旧 H3 片:推广会把首帧引用换成新确认图,旧片引用完整留存于标记内
        artifacts.append({"kind": "h3-clip", "mediaRef": copy.deepcopy(media_ref)})
    audio_ref = storyboard.get("audioRef")
    if isinstance(audio_ref, dict) and audio_ref.get("kind") == "audio":
        artifacts.append({"kind": "tts-audio", "audioRef": copy.deepcopy(audio_ref)})
    tts_job = storyboard.get("ttsJob")
    if isinstance(tts_job, dict):
        artifacts.append({
            "kind": "tts-job",
            "shotRevision": tts_job.get("shotRevision"),
            "inputFingerprint": tts_job.get("inputFingerprint"),
            "status": tts_job.get("status"),
            "attempt": tts_job.get("attempt"),
        })
    prompt = storyboard.get("prompt")
    video_desc = storyboard.get("videoDesc")
    prompt_present = isinstance(prompt, str) and bool(prompt)
    video_desc_present = isinstance(video_desc, str) and bool(video_desc)
    if prompt_present or video_desc_present:
        entry: dict[str, Any] = {"kind": "prompt"}
        if prompt_present:
            entry["promptSha256"] = sha256_bytes(prompt.encode("utf-8"))
        if video_desc_present:
            entry["videoDescSha256"] = sha256_bytes(video_desc.encode("utf-8"))
        artifacts.append(entry)
    return artifacts


def mark_downstream_expiry(
    storyboard: dict[str, Any],
    update: dict[str, Any],
    reviewed_at_ms: int,
) -> dict[str, Any] | None:
    """推广提交时把依赖旧版的下游产物显式标「已过期-禁止使用」。

    只新增标记:不删除、不自动重写旧产物(引用字段与文件原样保留);只在
    outputVersion 实际推进时标(幂等重放 targetVersion<=current 不标);清除只经
    下一次人工确认的推广(clearPolicy)。
    """
    artifacts = update.get("downstreamArtifacts") or []
    if not artifacts:
        return None
    current_version = int(update["currentOutputVersion"])
    target_version = int(update["targetOutputVersion"])
    if target_version <= current_version:
        return None
    storyboard_id = str(update["storyboardId"])
    expiry = {
        "status": EXPIRED_FORBIDDEN_USE,
        "since": reviewed_at_ms,
        "basedOnOutputVersion": current_version,
        "supersededByOutputVersion": target_version,
        "reason": (
            f"分镜 {storyboard_id} 人工批准推广已确认新版本 outputVersion="
            f"{target_version}(旧版={current_version});下列依赖旧版的下游产物标"
            f"「{EXPIRED_FORBIDDEN_USE}」——不删除、不自动重写,重做须人工确认"
            "(语义照分镜 stale 三件套「显式标记+人工确认」形态)"
        ),
        "artifacts": copy.deepcopy(artifacts),
        "clearPolicy": "human-confirmed-repromotion-only",
    }
    storyboard[DOWNSTREAM_EXPIRY_FIELD] = expiry
    return expiry


def downstream_expiry_summary(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """推广报告里的机检过期清单:只列实际推进版本且确有下游产物的镜。"""
    summary: list[dict[str, Any]] = []
    for update in plan["updates"]:
        artifacts = update.get("downstreamArtifacts") or []
        if not artifacts:
            continue
        if int(update["targetOutputVersion"]) <= int(update["currentOutputVersion"]):
            continue
        summary.append({
            "storyboardId": update["storyboardId"],
            "index": int(update["index"]),
            "basedOnOutputVersion": int(update["currentOutputVersion"]),
            "supersededByOutputVersion": int(update["targetOutputVersion"]),
            "artifactKinds": [item["kind"] for item in artifacts],
        })
    return summary


def _legacy_keyframe_target_indexes(storyboard: dict[str, Any]) -> set[int]:
    targets: set[int] = set()
    for keyframe in storyboard.get("keyframes") or []:
        if not isinstance(keyframe, dict):
            continue
        origin = keyframe.get("origin") or {}
        if origin.get("kind") != "legacy-shot":
            continue
        try:
            targets.add(int(origin.get("legacyIndex")))
        except (TypeError, ValueError):
            continue
    return targets


def legacy_dependent_keyframes(
    storyboard: dict[str, Any],
    changed_indexes: set[int],
) -> list[dict[str, Any]]:
    """回接旧镜的关键帧(origin.kind=legacy-shot 且 legacyIndex 命中被改镜集)。

    既有数据形态(apps/frontend/types/studio.ts:159-172 StoryboardKeyframe),
    不造新数据;「回接可沿旧审结论」仅在目标镜未改版时成立。
    """
    dependents: list[dict[str, Any]] = []
    for keyframe in storyboard.get("keyframes") or []:
        if not isinstance(keyframe, dict):
            continue
        origin = keyframe.get("origin") or {}
        if origin.get("kind") != "legacy-shot":
            continue
        try:
            target = int(origin.get("legacyIndex"))
        except (TypeError, ValueError):
            continue
        if target in changed_indexes:
            dependents.append(keyframe)
    return dependents


def old_frame_dependent_keyframes(
    storyboard: dict[str, Any],
    changed_indexes: set[int],
) -> list[dict[str, Any]]:
    """依赖旧首/尾帧的关键帧:回接被改镜的帧 + 首帧镜像(不变式 I1,path 同源)。"""
    dependents = list(legacy_dependent_keyframes(storyboard, changed_indexes))
    marked_identity = {id(keyframe) for keyframe in dependents}
    old_path = str((storyboard.get("mediaRef") or {}).get("path") or "")
    for keyframe in storyboard.get("keyframes") or []:
        if not isinstance(keyframe, dict) or id(keyframe) in marked_identity:
            continue
        path = str((keyframe.get("mediaRef") or {}).get("path") or "")
        if path and old_path and path == old_path:
            dependents.append(keyframe)
    return dependents


def mark_keyframes_expired(
    storyboard: dict[str, Any],
    keyframes: list[dict[str, Any]],
    *,
    reason: str,
    since_ms: int,
) -> list[str]:
    """把关键帧显式标「已过期-禁止使用」(与 A3 下游标记同词表同一语义)。

    只新增标记字段,不删除关键帧引用、不改写帧文件;新帧须另存版本重接。
    """
    for keyframe in keyframes:
        keyframe["status"] = EXPIRED_FORBIDDEN_USE
        keyframe["expiredReason"] = reason
        keyframe["expiredSince"] = since_ms
    return [str(keyframe.get("frameId") or "") for keyframe in keyframes]


def affected_continuity_interval(
    storyboards: list[dict[str, Any]],
    changed_storyboard_id: str,
) -> dict[str, Any]:
    """§六受影响区间(稳定上界):下界=被改镜;上界=首个入场状态不再依赖被改镜的镜头。

    依赖判据(两类既有数据,repair/promote 共用):①continuityState.
    previousStoryboardId 同组链;②keyframes origin legacy-shot 回接区间内旧镜。
    上界镜头本身不入区间(其后不重算、不重审)。
    """
    ordered = sorted(
        (item for item in storyboards if isinstance(item, dict)),
        key=lambda item: int(item.get("index") or 0),
    )
    changed = next(
        (item for item in ordered if str(item.get("id") or "") == str(changed_storyboard_id)),
        None,
    )
    if changed is None:
        raise RuntimeError(f"受影响区间下界分镜不存在: {changed_storyboard_id}")
    changed_index = int(changed.get("index") or 0)
    group = str((changed.get("continuityState") or {}).get("groupId") or "")
    changed_id = str(changed.get("id") or "")
    affected_ids = [changed_id]
    affected_indexes = {changed_index}
    evidence: list[dict[str, Any]] = [{"storyboardId": changed_id, "via": "changed-shot"}]
    upper_id: str | None = None
    for candidate in ordered:
        if int(candidate.get("index") or 0) <= changed_index:
            continue
        candidate_id = str(candidate.get("id") or "")
        continuity = candidate.get("continuityState") or {}
        previous_id = str(continuity.get("previousStoryboardId") or "")
        chained = bool(
            group
            and str(continuity.get("groupId") or "") == group
            and previous_id
            and previous_id in affected_ids
        )
        legacy_linked = bool(_legacy_keyframe_target_indexes(candidate) & affected_indexes)
        if chained:
            evidence.append({"storyboardId": candidate_id, "via": "previousStoryboardId"})
        elif legacy_linked:
            evidence.append({"storyboardId": candidate_id, "via": "legacy-keyframe"})
        else:
            upper_id = candidate_id
            break
        affected_ids.append(candidate_id)
        affected_indexes.add(int(candidate.get("index") or 0))
    return {
        "changedStoryboardId": changed_id,
        "lowerShotId": changed_id,
        "affectedShotIds": affected_ids,
        "upperShotId": upper_id,
        "dependencyEvidence": evidence,
    }


def unexpired_legacy_dependency_conflicts(
    storyboards_by_id: dict[str, dict[str, Any]],
    changed_indexes: set[int],
    exempt_ids: set[str],
) -> list[str]:
    """提升门禁(P5):未标「已过期-禁止使用」的旧帧回接依赖,机检列出(不得旧图配新镜清单)。"""
    conflicts: list[str] = []
    for storyboard_id, storyboard in storyboards_by_id.items():
        if storyboard_id in exempt_ids:
            continue
        for keyframe in legacy_dependent_keyframes(storyboard, changed_indexes):
            if keyframe.get("status") == EXPIRED_FORBIDDEN_USE:
                continue
            origin = keyframe.get("origin") or {}
            conflicts.append(
                f"{storyboard_id}#{keyframe.get('frameId')}"
                f"(回接旧镜 {origin.get('legacyIndex')})"
            )
    return sorted(conflicts)


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
    path = REPOSITORY_ROOT / "apps/build/chapter_video/generate_chapter001_continuity_sample.py"
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


def expected_report_shots(selected_shot: int | None) -> list[int]:
    if selected_shot is None:
        return EXPECTED_SHOTS
    if selected_shot not in EXPECTED_SHOTS:
        raise RuntimeError("--shot 必须是 chapter-001 的 1-43 镜")
    return [selected_shot]


def validate_report(
    report_path: Path,
    selected_shot: int | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    report = load_json(report_path)
    expected_shots = expected_report_shots(selected_shot)
    expected_mode = "full-chapter" if selected_shot is None else "selected-shots"
    if report.get("mode") != expected_mode or report.get("status") != "completed":
        if selected_shot is None:
            raise RuntimeError("只允许推广 completed 的 full-chapter 连续性报告")
        raise RuntimeError(f"--shot {selected_shot} 只允许对应的 completed selected-shots 报告")
    if [int(value) for value in report.get("shots") or []] != expected_shots:
        if selected_shot is None:
            raise RuntimeError("全章推广报告必须精确覆盖 1-43 镜")
        raise RuntimeError(f"单镜推广报告 shots 必须精确等于 [{selected_shot}]")
    expected_count = len(expected_shots)
    if (
        int(report.get("generatedImages") or 0) != expected_count
        or int(report.get("reusedImages") or 0) != 0
        or report.get("mutatedProductionProject") is not False
    ):
        raise RuntimeError(
            f"推广报告必须证明 {expected_count} 张全新生成、零复用且未修改生产项目"
        )
    entries = sorted(report.get("entries") or [], key=lambda item: int(item.get("index") or 0))
    if [int(item.get("index") or 0) for item in entries] != expected_shots:
        raise RuntimeError(f"推广 entries 必须是精确且唯一的镜头集合: {expected_shots}")
    if selected_shot is not None:
        expected_storyboard_id = f"sb-chapter-001-{selected_shot:03d}"
        if report.get("ok") is not True or entries[0].get("storyboardId") != expected_storyboard_id:
            raise RuntimeError(f"单镜推广报告 identity 无效: {expected_storyboard_id}")
        if [int(value) for value in report.get("approvedShots") or []] != expected_shots:
            raise RuntimeError(f"单镜推广报告 approvedShots 必须精确等于 [{selected_shot}]")
        if report.get("awaitingApprovalShot") is not None:
            raise RuntimeError("单镜推广报告仍有等待人工批准的镜头")
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


def build_promotion_plan(
    report_path: Path,
    store_path: Path,
    project: Path,
    selected_shot: int | None = None,
) -> dict[str, Any]:
    report, entries, _approvals = validate_report(report_path, selected_shot)
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
    if len(storyboards_by_id) != 43:
        raise RuntimeError(
            f"生产 store 必须保留完整 43 镜: store={len(storyboards_by_id)}"
        )
    if selected_shot is None and set(entry_ids) != set(storyboards_by_id):
        raise RuntimeError(
            f"生产 store 与全章推广报告镜头不一致: store={len(storyboards_by_id)}, report={len(set(entry_ids))}"
        )
    missing_entry_ids = [storyboard_id for storyboard_id in entry_ids if storyboard_id not in storyboards_by_id]
    if missing_entry_ids:
        raise RuntimeError(f"生产 store 缺少推广目标: {missing_entry_ids}")
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
            # dry-run 即预览将过期的下游产物清单(显式标记+人工确认:确认前可见)
            "downstreamArtifacts": collect_downstream_artifacts(storyboard),
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
    # P5 受影响区间(§六稳定上界):计划即给出区间证据;提升门禁拦旧帧回接依赖
    changed_indexes = {int(update["index"]) for update in updates}
    update_ids = {str(update["storyboardId"]) for update in updates}
    conflicts = unexpired_legacy_dependency_conflicts(
        storyboards_by_id, changed_indexes, update_ids
    )
    if conflicts:
        raise RuntimeError(
            f"依赖旧帧的关键帧未标「{EXPIRED_FORBIDDEN_USE}」,拒绝提升"
            f"(不得旧图配新镜清单;请先经修复链显式标记后重试): {'; '.join(conflicts)}"
        )
    affected_intervals = [
        affected_continuity_interval(
            list(storyboards_by_id.values()), str(update["storyboardId"])
        )
        for update in updates
    ]
    return {
        "ok": True,
        "dryRun": True,
        "reportPath": str(report_path),
        "reportSha256": sha256_file(report_path),
        "storePath": str(store_path),
        "storeSha256": sha256_bytes(store_payload),
        "project": str(project),
        "backupRoot": str(project / "backups" / "visual-continuity"),
        "backupStoreFilename": "studio-workflow-store.json",
        "alreadyApplied": already_applied,
        "shots": len(updates),
        "generatedImages": report["generatedImages"],
        "reusedImages": report["reusedImages"],
        "affectedIntervals": affected_intervals,
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

    expiry_marked_at_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    changed_indexes = {int(update["index"]) for update in plan["updates"]}
    expired_keyframes: list[dict[str, Any]] = []
    for update, _destination, _source_payload, _existed in update_payloads:
        storyboard = storyboards_by_id[str(update["storyboardId"])]
        # 先取旧帧依赖(首帧镜像以替换前 mediaRef 为准),再覆盖首帧字段
        dependent_keyframes = old_frame_dependent_keyframes(storyboard, changed_indexes)
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
        mark_downstream_expiry(storyboard, update, expiry_marked_at_ms)
        if dependent_keyframes:
            frame_ids = mark_keyframes_expired(
                storyboard,
                dependent_keyframes,
                reason=(
                    f"分镜 {update['storyboardId']} 已人工确认新版本 outputVersion="
                    f"{int(update['targetOutputVersion'])}"
                    f"(旧版={int(update['currentOutputVersion'])});本帧依赖旧首/尾帧,"
                    f"标「{EXPIRED_FORBIDDEN_USE}」——新帧须另存版本重接,不得旧图配新镜清单"
                ),
                since_ms=expiry_marked_at_ms,
            )
            expired_keyframes.append({
                "storyboardId": str(update["storyboardId"]),
                "frameIds": frame_ids,
            })

    result_store_payload = stable_json_bytes(store)
    result_store_sha256 = sha256_bytes(result_store_payload)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_dir = Path(plan["backupRoot"]) / (
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
        "downstreamExpiry": downstream_expiry_summary(plan),
        "expiredKeyframes": expired_keyframes,
    }
    created_directories: list[Path] = []
    staged_paths: list[Path] = []
    committed_new_paths: list[Path] = []
    try:
        backup_path = backup_dir / str(plan["backupStoreFilename"])
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
    parser.add_argument(
        "--shot",
        type=int,
        choices=EXPECTED_SHOTS,
        help="显式推广 selected-shots 报告中的一个镜头；省略时仅接受完整 1-43 镜报告",
    )
    parser.add_argument("--project", type=Path)
    parser.add_argument("--store", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--human-confirmed", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project = (args.project or resolve_project_dir()).resolve()
    store_path = (args.store or (project / "studio-workflow-store.json")).resolve()
    plan = build_promotion_plan(
        args.report.resolve(),
        store_path,
        project,
        selected_shot=args.shot,
    )
    if args.human_confirmed and not args.apply:
        raise RuntimeError("--human-confirmed 只能与 --apply 同时使用")
    result = apply_promotion(plan, args.human_confirmed) if args.apply else plan
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
