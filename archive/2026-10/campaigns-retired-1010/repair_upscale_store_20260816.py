#!/usr/bin/env python3
"""Repair the first two storyboard upscale writebacks after the black-output bug."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import string
import struct
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit


EXPECTED_STORE_SHA256 = "26eb46eb3ee4b7d0e647a0fc86f16f27518ac6688882f96b5d3fd1d572b9e435"
REVIEW_REASON = "分镜画面或连续性输入已变化，必须重新审核"
DOWNSTREAM_REVIEW_REASON = "上游连续镜头已变化，必须重新审核"


@dataclass(frozen=True)
class Repair:
    storyboard_id: str
    workflow_id: str
    node_id: str
    old_sha256: str
    relative_path: str
    new_sha256: str
    output_bytes: int
    width: int = 6688
    height: int = 3764


REPAIRS = (
    Repair(
        storyboard_id="sb-chapter-001-001",
        workflow_id="storyboard-flow-chapter-001-001",
        node_id="gen-storyboard-flow-chapter-001-001",
        old_sha256="f4b7d5c01bdad837fbdc127af810738901d9e8fe387323d3b06d7a6bb7a5e4a2",
        relative_path=(
            "workflow-images/storyboard-flow-chapter-001-001/"
            "up4x-repair-sb-chapter-001-001-20260816.png"
        ),
        new_sha256="f24e804aaf761298c4f89167e4aed0d178a959f548d31ded538799d35819078e",
        output_bytes=27_559_619,
    ),
    Repair(
        storyboard_id="sb-chapter-001-002",
        workflow_id="storyboard-flow-chapter-001-002",
        node_id="gen-storyboard-flow-chapter-001-002",
        old_sha256="bb7e55f9c81ab75f0eaf62f16c912c4f5100c7eeb69f338081716739314fd4df",
        relative_path=(
            "workflow-images/storyboard-flow-chapter-001-002/"
            "up4x-repair-sb-chapter-001-002-20260816.png"
        ),
        new_sha256="ec943641800871c46e33b2814235e44f133e44c7678263f0bb6d0b4f9f61dcdd",
        output_bytes=28_893_969,
    ),
)


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"not a valid PNG: {path}")
    return struct.unpack(">II", header[16:24])


def require_unique(items: list[dict[str, Any]], key: str, value: str) -> dict[str, Any]:
    matches = [item for item in items if item.get(key) == value]
    if len(matches) != 1:
        raise ValueError(f"expected one {key}={value}, found {len(matches)}")
    return matches[0]


def random_suffix() -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.SystemRandom().choice(alphabet) for _ in range(6))


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9\u4e00-\u9fa5]+", "-", value.strip().lower())
    return normalized.strip("-")[:40] or "material"


def mark_downstream_stale(
    storyboards: list[dict[str, Any]],
    changed: dict[str, Any],
    stale_since: int,
) -> list[str]:
    continuity = changed.get("continuityState")
    if not isinstance(continuity, dict):
        return []
    group_id = continuity.get("groupId")
    changed_index = changed.get("index")
    if not isinstance(group_id, str) or not isinstance(changed_index, (int, float)):
        return []

    changed_ids: list[str] = []
    for storyboard in storyboards:
        downstream = storyboard.get("continuityState")
        if not isinstance(downstream, dict):
            continue
        if downstream.get("groupId") != group_id or storyboard.get("index", -1) <= changed_index:
            continue
        storyboard["stale"] = True
        storyboard["staleReason"] = f"上游连续镜头 {changed['id']} 已变化"
        storyboard["staleSince"] = stale_since
        review = storyboard.get("visualReview")
        if isinstance(review, dict):
            review["status"] = "pending"
            review["reasons"] = [DOWNSTREAM_REVIEW_REASON]
        changed_ids.append(str(storyboard.get("id")))
    return changed_ids


def apply_repair(
    payload: dict[str, Any],
    project_root: Path,
    base_time: int,
) -> dict[str, Any]:
    state = payload.get("state")
    if not isinstance(state, dict) or payload.get("version") != 9:
        raise ValueError("unexpected studio workflow store envelope")

    required_lists = ("storyboards", "imageWorkflows", "materials", "mediaTasks")
    for key in required_lists:
        if not isinstance(state.get(key), list):
            raise ValueError(f"state.{key} must be an array")

    storyboards: list[dict[str, Any]] = state["storyboards"]
    workflows: list[dict[str, Any]] = state["imageWorkflows"]
    materials: list[dict[str, Any]] = state["materials"]
    media_tasks: list[dict[str, Any]] = state["mediaTasks"]
    report_repairs: list[dict[str, Any]] = []

    for offset, repair in enumerate(REPAIRS):
        now = base_time + offset * 10
        image_path = project_root / repair.relative_path
        if not image_path.is_file():
            raise ValueError(f"repair image missing: {image_path}")
        actual_sha = sha256_path(image_path)
        actual_bytes = image_path.stat().st_size
        actual_dimensions = png_dimensions(image_path)
        if actual_sha != repair.new_sha256:
            raise ValueError(f"repair image SHA mismatch for {repair.storyboard_id}: {actual_sha}")
        if actual_bytes != repair.output_bytes:
            raise ValueError(f"repair image size mismatch for {repair.storyboard_id}: {actual_bytes}")
        if actual_dimensions != (repair.width, repair.height):
            raise ValueError(
                f"repair image dimensions mismatch for {repair.storyboard_id}: {actual_dimensions}"
            )

        storyboard = require_unique(storyboards, "id", repair.storyboard_id)
        media_ref = storyboard.get("mediaRef")
        if not isinstance(media_ref, dict) or media_ref.get("kind") != "image":
            raise ValueError(f"unexpected mediaRef for {repair.storyboard_id}")
        if media_ref.get("contentSha256") != repair.old_sha256:
            raise ValueError(f"old media SHA drifted for {repair.storyboard_id}")
        if media_ref.get("imageWorkflowId") != repair.workflow_id:
            raise ValueError(f"workflow id drifted for {repair.storyboard_id}")
        if media_ref.get("imageWorkflowNodeId") != repair.node_id:
            raise ValueError(f"workflow node id drifted for {repair.storyboard_id}")

        old_url = media_ref.get("path")
        parsed = urlsplit(old_url if isinstance(old_url, str) else "")
        if parsed.scheme != "project-file" or not parsed.netloc:
            raise ValueError(f"unexpected project-file URL for {repair.storyboard_id}")
        output_url = f"project-file://{parsed.netloc}/{quote(repair.relative_path, safe='/')}"

        previous_version = storyboard.get("outputVersion")
        if not isinstance(previous_version, int) or previous_version < 0:
            raise ValueError(f"invalid outputVersion for {repair.storyboard_id}")
        storyboard["mediaRef"] = {
            "kind": "image",
            "path": output_url,
            "contentSha256": repair.new_sha256,
            "imageWorkflowId": repair.workflow_id,
            "imageWorkflowNodeId": repair.node_id,
        }
        storyboard["stale"] = False
        storyboard.pop("staleReason", None)
        storyboard.pop("staleSince", None)
        storyboard["outputVersion"] = previous_version + 1
        review = storyboard.get("visualReview")
        if isinstance(review, dict):
            review["status"] = "pending"
            review["reasons"] = [REVIEW_REASON]
        downstream_ids = mark_downstream_stale(storyboards, storyboard, now)

        task_id = f"media-task-{now}-{random_suffix()}"
        if any(task.get("id") == task_id for task in media_tasks):
            raise ValueError(f"generated duplicate media task id: {task_id}")
        source_fingerprint = storyboard.get("sourceFingerprint")
        if not isinstance(source_fingerprint, str) or not source_fingerprint:
            raise ValueError(f"missing source fingerprint for {repair.storyboard_id}")
        media_tasks.append(
            {
                "id": task_id,
                "kind": "storyboardImage",
                "targetId": repair.storyboard_id,
                "episodeId": storyboard.get("episodeId"),
                "provider": "image",
                "inputFingerprint": source_fingerprint,
                "retryCount": 0,
                "status": "success",
                "createdAt": now,
                "updatedAt": now + 1,
                "outputRef": output_url,
                "outputRefs": [output_url, repair.workflow_id, repair.node_id],
                "finishedAt": now + 1,
            }
        )

        filename = image_path.name
        imported_at = now + 2
        material = {
            "id": f"material-{imported_at}-{slugify(filename)}",
            "name": filename,
            "kind": "image",
            "localPath": output_url,
            "sourceName": filename,
            "size": repair.output_bytes,
            "importedAt": imported_at,
        }
        state["materials"] = [
            material,
            *[
                item
                for item in state["materials"]
                if item.get("id") != material["id"] and item.get("localPath") != output_url
            ],
        ]

        workflow = require_unique(workflows, "id", repair.workflow_id)
        nodes = workflow.get("nodes")
        if not isinstance(nodes, list):
            raise ValueError(f"workflow nodes missing for {repair.workflow_id}")
        node = require_unique(nodes, "id", repair.node_id)
        if node.get("type") != "generated":
            raise ValueError(f"unexpected node type for {repair.node_id}")
        generated_at = now + 3
        node["resultUrl"] = output_url
        node.pop("resultMediaId", None)
        node["status"] = "ready"
        node.pop("errorReason", None)
        node["generatedAt"] = generated_at
        node["updatedAt"] = generated_at
        workflow["updatedAt"] = generated_at

        report_repairs.append(
            {
                "storyboardId": repair.storyboard_id,
                "oldUrl": old_url,
                "newUrl": output_url,
                "oldSha256": repair.old_sha256,
                "newSha256": repair.new_sha256,
                "outputBytes": repair.output_bytes,
                "dimensions": [repair.width, repair.height],
                "outputVersion": storyboard["outputVersion"],
                "visualReviewStatus": review.get("status") if isinstance(review, dict) else None,
                "downstreamMarkedStale": downstream_ids,
                "materialId": material["id"],
                "mediaTaskId": task_id,
                "workflowGeneratedAt": generated_at,
            }
        )

    return {
        "repairs": report_repairs,
        "counts": {
            "materials": len(state["materials"]),
            "storyboards": len(storyboards),
            "imageWorkflows": len(workflows),
            "mediaTasks": len(media_tasks),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--store", type=Path, required=True)
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = args.project_root.resolve()
    store = args.store.resolve()
    backup = args.backup.resolve()
    if not project_root.is_dir() or not store.is_file() or not backup.is_file():
        raise ValueError("project root, store, and backup must exist")

    store_sha_before = sha256_path(store)
    backup_sha = sha256_path(backup)
    if store_sha_before != EXPECTED_STORE_SHA256:
        raise ValueError(f"store preimage SHA drifted: {store_sha_before}")
    if backup_sha != store_sha_before:
        raise ValueError(f"backup does not match store preimage: {backup_sha}")

    payload = json.loads(store.read_text(encoding="utf-8"))
    base_time = int(time.time() * 1000)
    result = apply_repair(payload, project_root, base_time)
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    hypothetical_sha = hashlib.sha256(encoded).hexdigest()
    report = {
        "mode": "apply" if args.apply else "dry-run",
        "projectRoot": str(project_root),
        "store": str(store),
        "backup": str(backup),
        "storeSha256Before": store_sha_before,
        "storeSha256After": hypothetical_sha,
        **result,
    }

    if args.apply:
        if sha256_path(store) != store_sha_before:
            raise ValueError("store changed during repair; refusing atomic replacement")
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=f".{store.name}.",
                suffix=".tmp",
                dir=store.parent,
                delete=False,
            ) as handle:
                temp_path = Path(handle.name)
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, store)
            temp_path = None
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink()
        if sha256_path(store) != hypothetical_sha:
            raise ValueError("post-write store SHA does not match encoded payload")
        json.loads(store.read_text(encoding="utf-8"))

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
