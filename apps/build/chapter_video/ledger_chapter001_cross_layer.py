#!/usr/bin/env python3
"""Cross-layer version-discipline ledger for chapter-001 (提案五②「依赖账本」).

按成果记四字段——当前草稿/最新确认版本/直接依据版本/下游影响清单——对任意成果
(``frame:*``/``asset:*``/下游产物 ``h3-clip|tts-audio|tts-job|prompt:*``)可查;
JSONL+JSON 快照落盘 ``apps/output/automation/``(paid ledger 落盘先例
generate_chapter001_continuity_sample.py:33)。

口径与真源:
- 「已过期-禁止使用」标记真源=promote_chapter001_storyboard_continuity 在推广
  提交时写入分镜的 ``downstreamExpiry``(additive;不删除、不自动重写旧产物);
  本工具只读生产 store,不写生产 store。
- 分镜帧「最新确认版本」证据=mediaRef 位于 ``approved-revisions/``(只有人工
  批准推广会写入该目录);草稿=store 当前帧状态。
- 下游产物无独立人工确认环节→latestConfirmedVersion 恒 None,其有效性随所属
  分镜确认版本对齐(由 downstreamExpiry 判定);directBasisVersion 优先取过期
  标记里的 basedOnOutputVersion(生产时的依据版本),无标记按当前分镜版本记。
- 零误伤:list_expired_downstream 只读显式标记,未标产物绝不列入。
- 本工具永不读取 provider 凭据、不调用网络、不改生产 store;落盘为确定性快照
  (无时间戳,重建重写逐字节一致)。

依据:docs/research/PIPELINE_METHODS_ABSORPTION_ANALYSIS_2026-09-28.md 提案五
「落点提案/验收口径」;docs/comfyui-kb/跨镜连续性规范.md §六。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
try:
    from apps.build.chapter_video.path_resolver import resolve_project_dir
    from apps.build.chapter_video.pipeline.promote_chapter001_storyboard_continuity import (
        DOWNSTREAM_EXPIRY_FIELD,
        EXPIRED_FORBIDDEN_USE,
        atomic_write,
        collect_downstream_artifacts,
        stable_json_bytes,
    )
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from path_resolver import resolve_project_dir
    from pipeline.promote_chapter001_storyboard_continuity import (
        DOWNSTREAM_EXPIRY_FIELD,
        EXPIRED_FORBIDDEN_USE,
        atomic_write,
        collect_downstream_artifacts,
        stable_json_bytes,
    )


LEDGER_SCHEMA_VERSION = "chapter_video-cross-layer-ledger-v1"
FOUR_FIELDS = ("currentDraft", "latestConfirmedVersion", "directBasisVersion", "downstreamImpact")
DEFAULT_LEDGER_DIR = REPOSITORY_ROOT / "apps/output/automation"
DEFAULT_LEDGER_JSONL = DEFAULT_LEDGER_DIR / "chapter001-cross-layer-ledger.jsonl"
DEFAULT_LEDGER_JSON = DEFAULT_LEDGER_DIR / "chapter001-cross-layer-ledger.json"


def load_store(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"store 根节点必须是对象: {path}")
    return value


def _storyboards(store: dict[str, Any]) -> list[dict[str, Any]]:
    state = store.get("state") or store
    storyboards = state.get("storyboards")
    if not isinstance(storyboards, list):
        raise RuntimeError("store 缺少 state.storyboards 数组")
    return [item for item in storyboards if isinstance(item, dict)]


def _asset_versions(store: dict[str, Any]) -> list[dict[str, Any]]:
    state = store.get("state") or store
    versions = state.get("continuityAssetVersions")
    if not isinstance(versions, list):
        return []
    return [item for item in versions if isinstance(item, dict)]


def _expiry_of(storyboard: dict[str, Any]) -> dict[str, Any] | None:
    expiry = storyboard.get(DOWNSTREAM_EXPIRY_FIELD)
    if isinstance(expiry, dict) and expiry.get("status") == EXPIRED_FORBIDDEN_USE:
        return expiry
    return None


def downstream_artifact_summary(entry: dict[str, Any]) -> dict[str, Any]:
    """下游产物当前引用摘要(按 kind;只读已记录字段,不新增推断)。"""
    kind = str(entry.get("kind") or "")
    if kind == "h3-clip":
        media = entry.get("mediaRef") or {}
        return {"path": media.get("path"), "contentSha256": media.get("contentSha256")}
    if kind == "tts-audio":
        audio = entry.get("audioRef") or {}
        return {"path": audio.get("path"), "contentSha256": audio.get("contentSha256")}
    if kind == "tts-job":
        return {
            "inputFingerprint": entry.get("inputFingerprint"),
            "shotRevision": entry.get("shotRevision"),
            "status": entry.get("status"),
            "attempt": entry.get("attempt"),
        }
    if kind == "prompt":
        summary = dict(entry)
        summary.pop("kind", None)
        return summary
    return {"kind": kind}


def frame_confirmed_output_version(storyboard: dict[str, Any]) -> int | None:
    """分镜帧最新确认版本:mediaRef 位于 approved-revisions 且版本>=1 才算已确认。"""
    media = storyboard.get("mediaRef")
    if not isinstance(media, dict):
        return None
    path = str(media.get("path") or "")
    version = int(storyboard.get("outputVersion") or 0)
    if version >= 1 and "/approved-revisions/" in path:
        return version
    return None


def _frame_downstream_impact(storyboard: dict[str, Any]) -> list[dict[str, Any]]:
    storyboard_id = str(storyboard.get("id") or "")
    impact: list[dict[str, Any]] = []
    expired_kinds: set[str] = set()
    expiry = _expiry_of(storyboard)
    if expiry is not None:
        for entry in expiry.get("artifacts") or []:
            if not isinstance(entry, dict):
                continue
            kind = str(entry.get("kind") or "")
            expired_kinds.add(kind)
            impact.append({
                "artifactId": f"{kind}:{storyboard_id}",
                "kind": kind,
                "status": EXPIRED_FORBIDDEN_USE,
                "basedOnOutputVersion": expiry.get("basedOnOutputVersion"),
            })
    for entry in collect_downstream_artifacts(storyboard):
        kind = str(entry.get("kind") or "")
        if kind in expired_kinds:
            continue
        impact.append({
            "artifactId": f"{kind}:{storyboard_id}",
            "kind": kind,
            "status": "in-use",
        })
    return impact


def build_frame_record(storyboard: dict[str, Any]) -> dict[str, Any]:
    storyboard_id = str(storyboard.get("id") or "")
    media = storyboard.get("mediaRef") or {}
    continuity = storyboard.get("continuityState") or {}
    manifest = [
        item for item in storyboard.get("orderedReferenceManifest") or []
        if isinstance(item, dict)
    ]
    confirmed = frame_confirmed_output_version(storyboard)
    return {
        "artifactId": f"frame:{storyboard_id}",
        "artifactKind": "storyboard-frame",
        "episodeId": storyboard.get("episodeId"),
        "currentDraft": {
            "outputVersion": int(storyboard.get("outputVersion") or 0),
            "mediaRefPath": media.get("path"),
            "contentSha256": media.get("contentSha256"),
            "stale": storyboard.get("stale"),
            "staleReason": storyboard.get("staleReason"),
        },
        "latestConfirmedVersion": (
            {
                "outputVersion": confirmed,
                "evidence": "mediaRef 位于 approved-revisions(人工批准推广写入)",
            }
            if confirmed is not None
            else None
        ),
        "directBasisVersion": {
            "sceneVersionId": continuity.get("sceneVersionId"),
            "sceneViewpointId": continuity.get("sceneViewpointId"),
            "previousStoryboardId": continuity.get("previousStoryboardId"),
            "referenceVersions": [
                {
                    "assetId": item.get("assetId"),
                    "versionId": item.get("versionId"),
                    "approved": item.get("approved"),
                }
                for item in manifest
            ],
        },
        "downstreamImpact": _frame_downstream_impact(storyboard),
    }


def build_downstream_record(
    storyboard: dict[str, Any],
    entry: dict[str, Any],
) -> dict[str, Any]:
    storyboard_id = str(storyboard.get("id") or "")
    kind = str(entry.get("kind") or "")
    expired_kinds = {
        str(item.get("kind") or "")
        for item in (_expiry_of(storyboard) or {}).get("artifacts") or []
        if isinstance(item, dict)
    }
    expiry = _expiry_of(storyboard)
    is_expired = kind in expired_kinds
    if is_expired and expiry is not None:
        direct_basis = {
            "storyboardId": storyboard_id,
            "outputVersion": expiry.get("basedOnOutputVersion"),
            "basis": "downstreamExpiry.basedOnOutputVersion",
        }
    else:
        direct_basis = {
            "storyboardId": storyboard_id,
            "outputVersion": int(storyboard.get("outputVersion") or 0),
            "basis": "当前分镜版本(无过期标记)",
        }
    return {
        "artifactId": f"{kind}:{storyboard_id}",
        "artifactKind": kind,
        "episodeId": storyboard.get("episodeId"),
        "currentDraft": downstream_artifact_summary(entry),
        # 下游产物无独立人工确认环节;有效性随所属分镜确认版本对齐
        "latestConfirmedVersion": None,
        "directBasisVersion": direct_basis,
        "downstreamImpact": [],
        "status": EXPIRED_FORBIDDEN_USE if is_expired else "in-use",
    }


def build_asset_records(store: dict[str, Any]) -> list[dict[str, Any]]:
    storyboards = _storyboards(store)
    records: list[dict[str, Any]] = []
    asset_ids: list[str] = []
    versions_by_asset: dict[str, list[dict[str, Any]]] = {}
    for version in _asset_versions(store):
        asset_id = str(version.get("assetId") or "")
        if not asset_id:
            continue
        if asset_id not in versions_by_asset:
            versions_by_asset[asset_id] = []
            asset_ids.append(asset_id)
        versions_by_asset[asset_id].append(version)
    for asset_id in asset_ids:
        versions = versions_by_asset[asset_id]
        pending = [v for v in versions if not v.get("approved")]
        confirmed = [v for v in versions if v.get("approved")]
        basis = confirmed[-1] if confirmed else (pending[-1] if pending else None)
        approval = (confirmed[-1] or {}).get("approval") or {} if confirmed else {}
        records.append({
            "artifactId": f"asset:{asset_id}",
            "artifactKind": "continuity-asset",
            "currentDraft": (
                {
                    "versionId": pending[-1].get("versionId"),
                    "contentFingerprint": pending[-1].get("contentFingerprint"),
                }
                if pending
                else None
            ),
            "latestConfirmedVersion": (
                {
                    "versionId": confirmed[-1].get("versionId"),
                    "approvalFingerprint": confirmed[-1].get("approvalFingerprint"),
                    "reviewedAt": approval.get("reviewedAt"),
                }
                if confirmed
                else None
            ),
            "directBasisVersion": {
                "referenceImageSha256": (basis or {}).get("referenceImageSha256") or [],
                "source": (basis or {}).get("source"),
            },
            "downstreamImpact": [
                {
                    "storyboardId": str(storyboard.get("id") or ""),
                    "referenceVersionId": reference.get("versionId"),
                    "approved": reference.get("approved"),
                }
                for storyboard in storyboards
                for reference in storyboard.get("orderedReferenceManifest") or []
                if isinstance(reference, dict)
                and str(reference.get("assetId") or "") == asset_id
            ],
        })
    return records


def build_ledger(store: dict[str, Any]) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    for storyboard in _storyboards(store):
        records.append(build_frame_record(storyboard))
        for entry in collect_downstream_artifacts(storyboard):
            records.append(build_downstream_record(storyboard, entry))
    records.extend(build_asset_records(store))
    return {"schemaVersion": LEDGER_SCHEMA_VERSION, "records": records}


def query_artifact(records: list[dict[str, Any]], artifact_id: str) -> dict[str, Any]:
    """四字段对任意成果可查;查无此成果即报错(不静默)。"""
    for record in records:
        if record.get("artifactId") == artifact_id:
            return record
    raise RuntimeError(f"账本查无此成果: {artifact_id}")


def list_expired_downstream(store: dict[str, Any]) -> list[dict[str, Any]]:
    """机检列出全部「已过期-禁止使用」下游项;零误伤=只读显式标记,未标不列。"""
    result: list[dict[str, Any]] = []
    for storyboard in _storyboards(store):
        expiry = _expiry_of(storyboard)
        if expiry is None:
            continue
        storyboard_id = str(storyboard.get("id") or "")
        for entry in expiry.get("artifacts") or []:
            if not isinstance(entry, dict):
                continue
            kind = str(entry.get("kind") or "")
            result.append({
                "storyboardId": storyboard_id,
                "artifactId": f"{kind}:{storyboard_id}",
                "kind": kind,
                "status": EXPIRED_FORBIDDEN_USE,
                "basedOnOutputVersion": expiry.get("basedOnOutputVersion"),
                "supersededByOutputVersion": expiry.get("supersededByOutputVersion"),
                "summary": downstream_artifact_summary(entry),
            })
    return result


def write_ledger(
    ledger_payload: dict[str, Any],
    jsonl_path: Path,
    json_path: Path,
) -> dict[str, Any]:
    """确定性快照落盘:JSONL(每行一成果)+JSON 索引;重建重写逐字节一致。"""
    records = ledger_payload.get("records") or []
    jsonl_bytes = "".join(
        json.dumps(record, ensure_ascii=False) + "\n" for record in records
    ).encode("utf-8")
    atomic_write(jsonl_path, jsonl_bytes)
    atomic_write(json_path, stable_json_bytes(ledger_payload))
    return {
        "records": len(records),
        "jsonl": str(jsonl_path),
        "json": str(json_path),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="chapter-001 跨层依赖账本:按成果记四字段,只读生产 store",
    )
    parser.add_argument("--store", type=Path)
    parser.add_argument("--artifact", help="查询单个成果(如 frame:sb-chapter-001-001)")
    parser.add_argument(
        "--list-expired", action="store_true", help="机检列出全部「已过期-禁止使用」下游项"
    )
    parser.add_argument("--jsonl", type=Path, default=DEFAULT_LEDGER_JSONL)
    parser.add_argument("--json", type=Path, default=DEFAULT_LEDGER_JSON)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    store_path = (
        args.store or resolve_project_dir() / "studio-workflow-store.json"
    ).expanduser().resolve()
    store = load_store(store_path)
    if args.artifact:
        record = query_artifact(build_ledger(store)["records"], args.artifact)
        print(json.dumps(record, ensure_ascii=False, indent=2))
        return
    if args.list_expired:
        print(json.dumps(list_expired_downstream(store), ensure_ascii=False, indent=2))
        return
    summary = write_ledger(build_ledger(store), args.jsonl, args.json)
    summary["expiredDownstream"] = len(list_expired_downstream(store))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
