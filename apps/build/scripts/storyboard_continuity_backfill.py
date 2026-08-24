#!/usr/bin/env python3
"""chapter-001 视觉连续性三件套回填(2026-08-24 方案 1)。

背景:当前 82 镜分镜(08-24 修复链重建代)没有 orderedReferenceManifest /
continuityState / visualReview,单镜生产/一键成片被 assertVisualContinuityApproved
整章硬闸拦住,TTS 自动补齐走不到。旧 Python 生图链(promote_chapter001_*)写这三
件套的通道已随旧链退役。

本脚本把前两件(第三件 visualReview 是人审门,刻意留给 UI)按旧代契约回填:

  - orderedReferenceManifest:场景(主 scene-viewpoint + 次 secondary-scene)
    + 角色(canonical,仅有已批准连续性版本者)+ 道具(prop-state,仅有版本者);
    参考 imagePath/referenceImageSha256/contentFingerprint 等逐字段复制自
    continuityAssetVersions 里的已批准版本记录(project-file:// 口径)。
  - continuityState:groupId 按场景资产分组,previousStoryboardId 组内承接;
    characters 取 shotSemantics.visibleCharacters(画面内实体,身份防线:
    画面外角色不入参考)映射到有版本的角色;lighting/palette 承自场景版本。
  - 缺版本的场景(道口镇街巷,13 镜)按旧 v5 圣经目录结构补建自包含版本:
    图复制进 continuity-bibles/,真缩略图 + 真 SHA-256 + 真校验时间戳;
    approval 留空——由用户在审核面板「人工批准该资产」。
  - 指纹算法与 lib/studio/visual-continuity.ts 的 stableSerialize 逐字节等价
    (已对拍历史数据 sourceSemanticsFingerprint);分片写盘复刻
    lib/storage/studio-workflow-shards.ts 的格式/预算/stamp/manifest 原子换。

用法:
  python3 storyboard_continuity_backfill.py            # dry-run:全量推演+审计模拟,零写入
  python3 storyboard_continuity_backfill.py --write    # 写入(应用必须已退出,脚本自查)

幂等:已回填且指纹自洽的镜不动;重复执行输出一致。
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote

PROJECT_NAME = "漫影工作室"
APP_SUPPORT = Path.home() / "Library" / "Application Support" / PROJECT_NAME
REGISTRY = APP_SUPPORT / "projects" / "mystudio-project-store.json"

CHAPTER_ID = "chapter-001"
SHARD_LIMIT_BYTES = 512 * 1024
ENVELOPE_VERSION = 10
SHARD_LAYOUT = "studio-workflow-shards-v1"
STAMP_BACKUP_TAG = "continuity-backfill"
STREET_SCENE_ID = "scene_1787327128050_4rmd8dh"  # 道口镇街巷
STREET_VIEWPOINT = "street-main-axis"
BACKFILL_SOURCE = "chapter001-backfill-20260824-source"

# ---------------------------------------------------------------- 指纹算法 ----
# 与 visual-continuity.ts stableSerialize 逐字节等价:递归键排序(仅 ASCII 键,
# localeCompare==codepoint 序)+ 紧凑分隔符 + 非 ASCII 原样。已对拍历史数据。


def stable(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def compact(value: dict) -> dict:
    return {k: v for k, v in value.items() if v is not None}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def utf8len(s: str) -> int:
    return len(s.encode("utf-8"))


def shard_stamp(content: str) -> str:
    """djb2 over UTF-16 code units(与 studio-workflow-shards.ts charCodeAt 一致)。"""
    data = content.encode("utf-16-le")
    h = 5381
    for i in range(0, len(data), 2):
        unit = data[i] | (data[i + 1] << 8)
        h = ((h << 5) + h + unit) & 0xFFFFFFFF
    return format(h, "08x")


# ------------------------------------------------- visual-continuity 移植 ----

def continuity_asset_content_fingerprint(v: dict) -> str:
    return stable(compact({
        "assetId": v.get("assetId"),
        "versionId": v.get("versionId"),
        "assetKind": v.get("assetKind"),
        "label": v.get("label"),
        "referenceImagePaths": v.get("referenceImagePaths"),
        "referenceImageSha256": v.get("referenceImageSha256"),
        "referenceViewTypes": v.get("referenceViewTypes"),
        "identityAnchors": v.get("identityAnchors"),
        "negativePrompt": v.get("negativePrompt"),
        "wardrobeVersion": v.get("wardrobeVersion"),
        "sceneViewpointId": v.get("sceneViewpointId"),
        "spatialLayout": v.get("spatialLayout"),
        "lightingDesign": v.get("lightingDesign"),
        "colorPalette": v.get("colorPalette"),
        "validFromStoryboardIndex": v.get("validFromStoryboardIndex"),
        "validToStoryboardIndex": v.get("validToStoryboardIndex"),
        "source": v.get("source"),
    }))


def continuity_asset_approval_fingerprint(v: dict, approval: dict) -> str:
    return stable(compact({
        "assetId": v.get("assetId"),
        "versionId": v.get("versionId"),
        "contentFingerprint": approval.get("contentFingerprint"),
        "status": approval.get("status"),
        "reviewer": approval.get("reviewer"),
        "reviewedAt": approval.get("reviewedAt"),
        "reason": approval.get("reason"),
        "evidencePaths": approval.get("evidencePaths"),
        "reviewEvidenceSha256": v.get("reviewEvidenceSha256"),
        "reviewEvidenceVerifiedAt": v.get("reviewEvidenceVerifiedAt"),
    }))


def is_structurally_complete(v: dict) -> bool:
    hashes = v.get("referenceImageSha256")
    if not (
        str(v.get("assetId", "")).strip()
        and str(v.get("versionId", "")).strip()
        and str(v.get("label", "")).strip()
        and str(v.get("source", "")).strip()
        and v.get("referenceImagePaths")
        and all(str(p).strip() for p in v["referenceImagePaths"])
    ):
        return False
    if hashes and not (
        len(hashes) == len(v["referenceImagePaths"])
        and all(re.fullmatch(r"[a-f0-9]{64}", h, re.I) for h in hashes)
    ):
        return False
    if v.get("missingFields"):
        return False
    kind = v.get("assetKind")
    if kind == "character":
        views = v.get("referenceViewTypes") or []
        return bool(
            str(v.get("wardrobeVersion") or "").strip()
            and v.get("identityAnchors")
            and isinstance(v["identityAnchors"].get("uniqueMarks"), list)
            and (v.get("negativePrompt") or {}).get("avoid")
            and len(views) >= 3
            and len(views) == len(v["referenceImagePaths"])
        )
    if kind == "scene":
        return bool(
            str(v.get("sceneViewpointId") or "").strip()
            and str(v.get("spatialLayout") or "").strip()
            and str(v.get("lightingDesign") or "").strip()
            and str(v.get("colorPalette") or "").strip()
        )
    return True


def is_version_approved(v: dict) -> bool:
    approval = v.get("approval")
    if not approval or not is_structurally_complete(v):
        return False
    content_fp = continuity_asset_content_fingerprint(v)
    registered = [p.strip() for p in (v.get("reviewEvidencePaths") or []) if p.strip()]
    safe = [p for p in registered if p.lower().endswith("_thumb.png")]
    approval_ev = [p.strip() for p in approval.get("evidencePaths", []) if p.strip()]
    hashes = v.get("reviewEvidenceSha256") or []
    reviewed_at = approval.get("reviewedAt")
    verified_at = v.get("reviewEvidenceVerifiedAt")
    return bool(
        approval.get("status") == "approved"
        and approval.get("reviewer") == "human"
        and isinstance(reviewed_at, (int, float))
        and reviewed_at > 0
        and len(registered) == len(v["referenceImagePaths"])
        and len(safe) == len(registered)
        and len(approval_ev) == len(safe)
        and approval_ev == safe
        and len(hashes) == len(safe)
        and all(re.fullmatch(r"[a-f0-9]{64}", h, re.I) for h in hashes)
        and isinstance(verified_at, (int, float))
        and verified_at > 0
        and approval.get("contentFingerprint") == content_fp
        and v.get("contentFingerprint") == content_fp
        and v.get("approvalFingerprint") == continuity_asset_approval_fingerprint(v, approval)
    )


def visual_continuity_fingerprint(row: dict) -> str:
    refs = sorted(row.get("orderedReferenceManifest") or [], key=lambda r: r["order"])
    cs = row.get("continuityState")
    style_sha = next(
        (r.get("referenceImageSha256") or [None])[0]
        for r in refs if r.get("referenceRole") == "style-reference"
    ) if any(r.get("referenceRole") == "style-reference" for r in refs) else None
    payload = {
        "prompt": row.get("prompt"),
        "references": [
            compact({
                "order": r.get("order"),
                "assetId": r.get("assetId"),
                "versionId": r.get("versionId"),
                "imagePath": r.get("imagePath"),
                "referenceImagePaths": r.get("referenceImagePaths"),
                "referenceImageSha256": r.get("referenceImageSha256"),
                "referenceViewTypes": r.get("referenceViewTypes"),
                "referenceRole": r.get("referenceRole"),
                "wardrobeVersion": r.get("wardrobeVersion"),
                "sceneViewpointId": r.get("sceneViewpointId"),
                "contentFingerprint": r.get("contentFingerprint"),
            }) for r in refs
        ],
        "continuity": compact({**cs, "inputFingerprint": None}) if cs else None,
        "styleContract": (
            {
                "version": cs.get("styleContractVersion"),
                "fingerprint": cs.get("styleContractFingerprint"),
                "promptAuditVersion": cs.get("promptAuditVersion"),
                "styleReferenceSha256": style_sha,
            } if cs and cs.get("styleContractVersion") else None
        ),
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    return stable(payload)


def visual_review_input_fingerprint(row: dict) -> str:
    media = row.get("mediaRef")
    payload = {
        "continuity": visual_continuity_fingerprint(row),
        "mediaRef": compact({
            "kind": media.get("kind"),
            "path": media.get("path"),
            "contentSha256": media.get("contentSha256"),
            "imageWorkflowId": media.get("imageWorkflowId"),
            "imageWorkflowNodeId": media.get("imageWorkflowNodeId"),
        }) if media else None,
        "imageWorkflowId": row.get("imageWorkflowId"),
        "imageWorkflowNodeId": row.get("imageWorkflowNodeId"),
        "outputVersion": row.get("outputVersion"),
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    return stable(payload)


def source_fingerprint(row: dict) -> str:
    cs = row.get("continuityState")
    payload = {
        "episodeId": row.get("episodeId"),
        "index": row.get("index"),
        "trackKey": row.get("trackKey"),
        "duration": row.get("duration"),
        "prompt": row.get("prompt"),
        "videoDesc": row.get("videoDesc"),
        "assetIds": row.get("assetIds") or [],
        "shouldGenerateImage": row.get("shouldGenerateImage"),
        "orderedReferenceManifest": row.get("orderedReferenceManifest") or [],
        "shotSemantics": row.get("shotSemantics"),
        "cinematic": row.get("cinematic"),
        "continuityState": compact({**cs, "inputFingerprint": None}) if cs else None,
        "lines": row.get("lines"),
        "speakerId": row.get("speakerId"),
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    return stable(payload)


# ------------------------------------------------------------ 审计模拟移植 ----

def audit_issues(rows: list, versions: list) -> list:
    issues = []
    by_key = {f"{v['assetId']}:{v['versionId']}": v for v in versions}
    by_id = {r["id"]: r for r in rows}
    for row in sorted(rows, key=lambda r: r["index"]):
        sid = row["id"]
        refs = sorted(row.get("orderedReferenceManifest") or [], key=lambda r: r["order"])
        # assertOrderedReferences
        if not refs:
            issues.append((sid, "references.missing", "缺少有序视觉参考清单"))
        else:
            seen = set()
            for i, r in enumerate(refs):
                if r["order"] != i + 1:
                    issues.append((sid, "references.order", "参考图顺序必须从 1 连续递增"))
                if not r.get("assetId") or not r.get("imagePath") or r.get("missing"):
                    issues.append((sid, "references.missing", f"第 {r['order']} 个参考图不可用"))
                if not r.get("versionId"):
                    issues.append((sid, "references.version", f"参考资产 {r.get('assetId')} 缺少视觉版本"))
                key = f"{r.get('assetId')}:{r.get('versionId')}"
                if key in seen:
                    issues.append((sid, "references.version", f"重复引用视觉版本 {key}"))
                seen.add(key)
        cs = row.get("continuityState")
        # storyboardContinuityStateIssues
        if not cs:
            issues.append((sid, "continuity.missing", "缺少连续镜头状态"))
        else:
            if not row.get("shotSemantics"):
                issues.append((sid, "continuity.stale", "缺少当前逐镜语义"))
            elif cs.get("sourceSemanticsFingerprint") != stable(row["shotSemantics"]):
                issues.append((sid, "continuity.stale", "逐镜语义指纹不一致"))
            elif cs.get("inputFingerprint") != visual_continuity_fingerprint(row):
                issues.append((sid, "continuity.stale", "连续性输入指纹已失效"))
            # primary scene
            scene_refs = [r for r in refs if r.get("assetKind") == "scene"
                          or r.get("referenceRole") in ("scene-viewpoint", "secondary-scene")]
            primary = [r for r in scene_refs if r.get("referenceRole") == "scene-viewpoint"]
            matching = [r for r in primary
                        if r.get("versionId") == cs.get("sceneVersionId")
                        and r.get("sceneViewpointId") == cs.get("sceneViewpointId")]
            invalid_secondary = [r for r in scene_refs
                                 if r.get("referenceRole") not in ("scene-viewpoint", "secondary-scene")]
            if not (len(primary) == 1 and len(matching) == 1 and not invalid_secondary):
                issues.append((sid, "scene.primary", "主场景必须且只能有一个匹配的 scene-viewpoint"))
            if cs.get("previousStoryboardId"):
                prev = by_id.get(cs["previousStoryboardId"])
                if not prev or (prev.get("continuityState") or {}).get("groupId") != cs.get("groupId") \
                        or prev["index"] >= row["index"]:
                    issues.append((sid, "continuity.previous", "上一镜连续关系无效"))
        if row.get("stale"):
            issues.append((sid, "continuity.stale", row.get("staleReason") or "已过期"))
        review = row.get("visualReview")
        if not review:
            issues.append((sid, "review.missing", "尚未完成视觉审核"))
        elif review.get("status") == "approved":
            issues.extend(approved_review_issues(row, versions))
        elif review.get("status") == "rejected":
            issues.append((sid, "review.rejected", "审核未通过"))
        else:
            issues.append((sid, "review.missing", "等待视觉审核"))
    return issues


def approved_review_issues(row: dict, versions: list) -> list:
    """approvedVisualReviewIssues 移植(仅校验已批准镜;引用批准有效性在此链)。"""
    issues = []
    sid = row["id"]
    review = row["visualReview"]
    if review.get("reviewer") != "human":
        issues.append((sid, "review.human", "必须由人工审核批准"))
    if not review.get("reviewedAt"):
        issues.append((sid, "review.timestamp", "缺少有效人工审核时间"))
    evidence = [p.strip() for p in review.get("evidencePaths", []) if p.strip()]
    if not evidence:
        issues.append((sid, "review.evidence", "缺少审核证据路径"))
    elif len(evidence) != 1 or (row.get("mediaRef", {}).get("path") and evidence[0] != row["mediaRef"]["path"]):
        issues.append((sid, "review.evidence", "审核证据必须精确绑定当前画面"))
    if review.get("inputFingerprint") != visual_review_input_fingerprint(row):
        issues.append((sid, "review.stale", "审核输入已变化"))
    cs = row.get("continuityState") or {}
    for ch in cs.get("characters", []):
        if not any(c.get("characterId") == ch["characterId"] and c.get("passed")
                   for c in review.get("characterChecks", [])):
            issues.append((sid, "review.checks", f"缺少角色 {ch['characterId']} 的通过检查"))
    if cs.get("sceneVersionId") and not any(
        s.get("sceneVersionId") == cs["sceneVersionId"] and s.get("passed")
        for s in review.get("sceneChecks", [])
    ):
        issues.append((sid, "review.checks", f"缺少场景 {cs['sceneVersionId']} 的通过检查"))
    if cs.get("previousStoryboardId") and not any(
        t.get("previousStoryboardId") == cs["previousStoryboardId"] and t.get("passed")
        for t in review.get("transitionChecks", [])
    ):
        issues.append((sid, "review.checks", "缺少与上一镜的相邻镜头通过检查"))
    for r in row.get("orderedReferenceManifest") or []:
        if r.get("referenceRole") == "prop-state" and not any(
            p.get("assetId") == r["assetId"] and (not p.get("versionId") or p["versionId"] == r.get("versionId")) and p.get("passed")
            for p in review.get("propChecks", [])
        ):
            issues.append((sid, "review.checks", f"缺少道具 {r['assetId']} 的通过检查"))
    if (review.get("textWatermarkCheck") or {}).get("passed") is not True:
        issues.append((sid, "review.checks", "缺少文字与水印通过检查"))
    # 引用版本批准有效性
    by_key = {f"{v['assetId']}:{v['versionId']}": v for v in versions}
    for r in sorted(row.get("orderedReferenceManifest") or [], key=lambda x: x["order"]):
        if r.get("referenceRole") == "previous-approved-frame":
            continue
        key = f"{r['assetId']}:{r.get('versionId') or ''}"
        v = by_key.get(key)
        if not v:
            issues.append((sid, "references.approval", f"参考资产 {key} 缺少资产级批准记录"))
            continue
        if not is_version_approved(v):
            issues.append((sid, "references.approval", f"参考资产 {key} 尚未通过有效人工批准"))
            continue
        if r.get("contentFingerprint") != v.get("contentFingerprint") \
                or r.get("approvalFingerprint") != v.get("approvalFingerprint"):
            issues.append((sid, "references.approval", f"参考资产 {key} 的批准指纹已失效"))
    return issues


def hypothetical_approved_review(row: dict) -> dict:
    """预演:构造「用户全勾通过」的审核记录,验证回填数据在审批后零隐藏问题。"""
    cs = row.get("continuityState") or {}
    prev = cs.get("previousStoryboardId")
    media = row.get("mediaRef")
    refs = row.get("orderedReferenceManifest") or []
    return {
        "status": "approved",
        "reasons": [],
        "characterChecks": [{"characterId": c["characterId"], "passed": True} for c in cs.get("characters", [])],
        "sceneChecks": [{"sceneVersionId": cs["sceneVersionId"], "passed": True}] if cs.get("sceneVersionId") else [],
        "propChecks": [
            {"assetId": r["assetId"], "versionId": r.get("versionId"), "passed": True}
            for r in refs if r.get("referenceRole") == "prop-state"
        ],
        "transitionChecks": [{"previousStoryboardId": prev, "passed": True}] if prev else [],
        "textWatermarkCheck": {"passed": True},
        "evidencePaths": [media["path"]] if media and media.get("path") else ["(image-pending)"],
        "reviewer": "human",
        "reviewedAt": int(time.time() * 1000),
        "inputFingerprint": visual_review_input_fingerprint(row),
    }


# ------------------------------------------------------------------- 工具 ----

def project_file_to_abs(root: Path, url: str) -> Path | None:
    if not url or not url.startswith("project-file://"):
        return None
    rest = unquote(url[len("project-file://"):])
    parts = rest.split("/", 1)
    if len(parts) < 2 or not parts[1]:
        return None
    return root / parts[1]


PREFIX_RE = re.compile(r"^(?:监工|管事|老|年轻|小)")
SUFFIX_RE = re.compile(r"(?:OS|V\.S\.)$")


def canon_name(name: str) -> str:
    return SUFFIX_RE.sub("", str(name).strip()).strip()


def match_character(name: str, characters: list) -> dict | None:
    n = canon_name(name)
    for c in characters:
        if c["name"] == n or c["name"] == str(name).strip():
            return c
    for c in characters:
        bare = PREFIX_RE.sub("", c["name"])
        if len(bare) >= 2 and (bare == n or c["name"].endswith(n) or n.endswith(bare)):
            return c
    for c in characters:
        if len(n) >= 2 and (n in c["name"] or c["name"] in n):
            return c
    return None


def match_scenes(names: list, scenes: list) -> list:
    """按行内出现顺序返回去重后的场景库记录(精确名匹配,不模糊吞并)。"""
    out, seen = [], set()
    for n in names:
        for s in scenes:
            if s["name"] == str(n).strip() and s["id"] not in seen:
                out.append(s)
                seen.add(s["id"])
    return out


VIEWPOINT_RULES = [
    ("夜", ("night",)),
    ("归", ("night",)),
    ("醒", ("night",)),
    ("终场", ("night",)),
    ("窗", ("window",)),
    ("柜台", ("counter",)),
    ("大堂", ("counter",)),
    ("灯", ("lamp",)),
    ("书案", ("lamp", "desk")),
    ("课", ("lamp", "desk")),
]

# 场景默认视角:关键词不命中时的语义缺省(塾馆=书案灯轴,斗室=窗轴,大堂=柜台轴)
SCENE_DEFAULT_VIEWPOINT = {
    "scene_1780296482374_jew094y": "school-lamp-desk-axis",
    "scene_1780296482373_ndts8if": "inn-room-window-axis",
    "scene_1780296482373_h8geu0d": "inn-hall-counter-axis",
}


def pick_viewpoint(versions: list, label: str, asset_id: str = "") -> dict:
    if len(versions) == 1:
        return versions[0]
    text = label or ""
    for keyword, tokens in VIEWPOINT_RULES:
        if keyword in text:
            for v in versions:
                vp = v.get("sceneViewpointId") or ""
                if all(t in vp for t in tokens):
                    return v
    hint = SCENE_DEFAULT_VIEWPOINT.get(asset_id)
    if hint:
        for v in versions:
            if v.get("sceneViewpointId") == hint:
                return v
    return versions[0]


# ------------------------------------------------------------------ 主流程 ----

def load_store(root: Path):
    sw = root / "store" / "studio-workflow"
    manifest = json.loads((sw / "manifest.json").read_text(encoding="utf-8"))
    state: dict = {}
    for name in manifest["shards"]:
        env = json.loads((sw / name).read_text(encoding="utf-8"))
        for k, v in env["state"].items():
            if k in state and isinstance(state[k], list) and isinstance(v, list):
                state[k] = state[k] + v
            else:
                state[k] = v
    return sw, manifest, state


def emit_domain_shards(key: str, items: list, *, chapter_dir: str | None, base_slug: str):
    """复刻 planStudioWorkflowShards 的数组域输出(信封格式/512KB 预算/djb2 stamp)。

    章域名 chapters/<id>/<slug>-NNN-<stamp>.json;非章域单片裸名、续片 -002 起。
    返回 [(shard 目录内相对名, 文件内容)]。
    """
    prefix = '{\n  "state": {\n'
    suffix = '\n  },\n  "version": ' + str(ENVELOPE_VERSION) + '\n}'
    wrapper = '    "' + key + '": ['
    close = '\n    ]'

    def total(count: int, parts_bytes: int) -> int:
        inner = utf8len(wrapper) + 1 + parts_bytes + 2 * (count - 1) + utf8len(close)
        return utf8len(prefix) + inner + utf8len(suffix)

    batches: list[list[str]] = [[]]
    bytes_: list[int] = [0]
    for item in items:
        part = "      " + json.dumps(item, ensure_ascii=False, indent=2).replace("\n", "\n" + " " * 6)
        if total(len(batches[-1]) + 1, bytes_[-1] + utf8len(part)) > SHARD_LIMIT_BYTES and batches[-1]:
            batches.append([])
            bytes_.append(0)
        batches[-1].append(part)
        bytes_[-1] += utf8len(part)

    files = []
    for idx, parts in enumerate(batches, start=1):
        inner = wrapper + "\n" + ",\n".join(parts) + close
        body = prefix + inner + suffix
        stamp = shard_stamp(body)  # 与写端一致:stamp 对不含收尾换行的正文计算
        content = body + "\n"
        if chapter_dir is not None:
            name = f"{chapter_dir}/{base_slug}-{idx:03d}-{stamp}.json"
        elif idx == 1:
            name = f"{base_slug}-{stamp}.json"
        else:
            name = f"{base_slug}-{idx:03d}-{stamp}.json"
        files.append((name, content))
    return files


def project_url(root: Path, p: Path) -> str:
    from urllib.parse import quote
    rel = p.relative_to(root)
    return "project-file://" + quote(root.name, safe="") + "/" + "/".join(quote(seg, safe="") for seg in rel.parts)


EVIDENCE_BYTE_LIMIT = 1_000_000  # 旧「单资产安全推广」契约:缩略图严格小于 1MB


def ensure_thumbnail(root: Path, image: Path, report: list) -> tuple[str, str]:
    """在参考图旁生成/复用 *_thumb.png(逐级降采样至 <1MB),返回 (project-file URL, sha256)。"""
    try:
        from PIL import Image
    except ImportError:
        raise RuntimeError("Pillow 不可用,无法生成缩略图证据")
    thumb = image.with_name(image.stem + "_thumb.png")
    if not thumb.is_file() or thumb.stat().st_size >= EVIDENCE_BYTE_LIMIT:
        with Image.open(image) as img:
            img = img.convert("RGB")
            for limit in (768, 640, 512, 384, 256):
                candidate = img.copy()
                candidate.thumbnail((limit, limit))
                candidate.save(thumb, "PNG")
                if thumb.stat().st_size < EVIDENCE_BYTE_LIMIT:
                    break
    if thumb.stat().st_size >= EVIDENCE_BYTE_LIMIT:
        report.append(f"WARN: 缩略图 {thumb.name} {thumb.stat().st_size}B 仍超 1MB 证据上限")
    return project_url(root, thumb), sha256_file(thumb)


def build_street_scene_version(root: Path, scene: dict, template: dict, report: list) -> dict | None:
    """道口镇街巷场景版本:复制场景主图进 bibles,产缩略图+SHA+校验时间;不写 approval。"""
    try:
        from PIL import Image
    except ImportError:
        report.append("FATAL: Pillow 不可用,无法生成缩略图证据")
        return None
    src = project_file_to_abs(root, scene.get("referenceImage"))
    if not src or not src.is_file():
        report.append(f"FATAL: 场景图缺失 {scene.get('referenceImage')}")
        return None
    version_id = f"{STREET_SCENE_ID}:{STREET_VIEWPOINT}:v1"
    rand = hashlib.sha256(f"{version_id}".encode()).hexdigest()[:10]
    vdir = (root / "continuity-bibles" / CHAPTER_ID / "backfill-v1" / "assets" / "scene"
            / f"{STREET_SCENE_ID}-{rand}" / f"{STREET_SCENE_ID}-{STREET_VIEWPOINT}-v1-{hashlib.sha256(version_id.encode()).hexdigest()[:10]}")
    vdir.mkdir(parents=True, exist_ok=True)
    ref_png = vdir / "reference-1.png"
    if not ref_png.is_file():
        shutil.copyfile(src, ref_png)
    ref_url = project_url(root, ref_png)
    thumb_url, thumb_sha = ensure_thumbnail(root, ref_png, report)

    version = copy.deepcopy(template)
    for stale_key in ("approval", "approvalFingerprint", "approved", "structurallyComplete",
                      "contentFingerprint", "reviewStatus", "validFromStoryboardIndex",
                      "validToStoryboardIndex", "missingFields", "identityAnchors",
                      "negativePrompt", "wardrobeVersion", "referenceViewTypes"):
        version.pop(stale_key, None)
    version.update({
        "assetId": STREET_SCENE_ID,
        "versionId": version_id,
        "label": STREET_VIEWPOINT,
        "sceneViewpointId": STREET_VIEWPOINT,
        "referenceImagePaths": [ref_url],
        "referenceImageSha256": [sha256_file(ref_png)],
        "reviewEvidencePaths": [thumb_url],
        "reviewEvidenceSha256": [thumb_sha],
        "reviewEvidenceVerifiedAt": int(time.time() * 1000),
        "spatialLayout": "破败店铺与当铺高柜沿街两侧夹出纵深巷道，人流贴檐而行，暗巷与柴房缺口藏于侧后",
        "lightingDesign": "灰雾低压的阴天漫射光，檐下昏暗、街心偏亮，铜牌与碎银偶作冷高光",
        "colorPalette": "灰褐、烟青、旧木赭与洗白土墙色，铜绿与朱漆牌匾仅作点状焦点",
        "source": BACKFILL_SOURCE,
    })
    version["structurallyComplete"] = is_structurally_complete(version)
    version["contentFingerprint"] = continuity_asset_content_fingerprint(version)
    if not version["structurallyComplete"]:
        report.append("FATAL: 街巷场景版本结构不完整")
        return None
    return version


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="执行写入(默认 dry-run)")
    parser.add_argument("--project", default=None, help="项目根目录(默认注册表活跃项目)")
    args = parser.parse_args()

    if args.project:
        root = Path(args.project)
    else:
        reg = json.loads(REGISTRY.read_text(encoding="utf-8"))["state"]
        pid = reg["activeProjectId"]
        proj = next(p for p in reg["projects"] if p["id"] == pid)
        root = Path(proj["location"])

    if args.write:
        probe = subprocess.run(["pgrep", "-f", "漫影工作室.app"], capture_output=True, text=True)
        if probe.returncode == 0:
            print("FATAL: 漫影工作室正在运行——store 会被内存态覆写。请先退出应用再 --write。")
            return 2

    sw, manifest, state = load_store(root)
    characters = json.loads((root / "store" / "characters.json").read_text(encoding="utf-8"))["state"]["characters"]
    scenes = json.loads((root / "store" / "scenes.json").read_text(encoding="utf-8"))["state"]["scenes"]
    props = json.loads((root / "store" / "props.json").read_text(encoding="utf-8"))["state"]["items"]
    versions = state.get("continuityAssetVersions", [])
    storyboards = sorted([b for b in state.get("storyboards", []) if b["episodeId"] == CHAPTER_ID],
                         key=lambda b: b["index"])
    report: list[str] = []
    print(f"项目: {root}")
    print(f"分镜: {len(storyboards)}(章 {CHAPTER_ID});资产版本: {len(versions)}")

    # 版本有效性体检 + 批准链修复。
    # 背景:08-24 project-file:// 路径归一改写了版本记录的 referenceImagePaths 但
    # 未重算指纹,32 条存量批准全部静默失效(isContinuityAssetVersionApproved 判
    # false)。修复前提=内容同一性:逐张核对磁盘文件 SHA-256 与批准时记录的
    # referenceImageSha256 一致(只是路径表示变了),再重算 content/approval 指纹。
    version_by_asset: dict[str, list] = {}
    for v in versions:
        version_by_asset.setdefault(v["assetId"], []).append(v)
    repaired = 0
    for v in versions:
        if not v.get("approval"):
            continue
        current_fp = continuity_asset_content_fingerprint(v)
        if v.get("contentFingerprint") == current_fp:
            if not is_version_approved(v):
                report.append(f"WARN: 版本 {v['assetId']}/{v['versionId']} 指纹一致但批准链仍失效")
            continue
        for path, expected in zip(v["referenceImagePaths"], v.get("referenceImageSha256") or []):
            f = project_file_to_abs(root, path)
            if not f or not f.is_file():
                report.append(f"FATAL: 版本 {v['assetId']} 参考图缺失 {path}")
                continue
            if sha256_file(f) != expected:
                report.append(f"FATAL: 版本 {v['assetId']} 参考图内容已变化 {path}(拒绝修复批准链)")
        if any(x.startswith("FATAL") for x in report if v["assetId"] in x):
            continue
        v["contentFingerprint"] = current_fp
        v["approval"]["contentFingerprint"] = current_fp
        v["approvalFingerprint"] = continuity_asset_approval_fingerprint(v, v["approval"])
        v["structurallyComplete"] = is_structurally_complete(v)
        # 证据缺失型修复:历史迁移丢弃了不安全的仓库绝对路径致 evidence 清空;
        # 参考图内容已按 SHA 核对,按旧「单资产安全推广」口径重建逐图缩略证据。
        registered = [p.strip() for p in (v.get("reviewEvidencePaths") or []) if p.strip()]
        if len(registered) < len(v["referenceImagePaths"]):
            try:
                thumbs = []
                for p in v["referenceImagePaths"]:
                    f = project_file_to_abs(root, p)
                    if not f or not f.is_file():
                        raise RuntimeError(f"参考图缺失 {p}")
                    thumbs.append(ensure_thumbnail(root, f, report))
                v["reviewEvidencePaths"] = [u for u, _ in thumbs]
                v["reviewEvidenceSha256"] = [s for _, s in thumbs]
                v["reviewEvidenceVerifiedAt"] = int(time.time() * 1000)
                v["approval"]["evidencePaths"] = [u for u, _ in thumbs]
                v["approvalFingerprint"] = continuity_asset_approval_fingerprint(v, v["approval"])
                report.append(f"证据重建: {v['assetId']}/{v['versionId']}")
            except Exception as error:  # noqa: BLE001
                report.append(f"WARN: {v['assetId']} 证据重建失败: {error}")
        v["approved"] = is_version_approved(v)
        if v["approved"]:
            repaired += 1
        else:
            report.append(f"WARN: 版本 {v['assetId']}/{v['versionId']} 修复后仍未通过批准链校验")
    if repaired:
        print(f"批准链修复: {repaired}/{len([v for v in versions if v.get('approval')])} 条版本指纹重算(内容 SHA 已核对)")
    for v in versions:
        if v.get("approval") and not is_version_approved(v):
            report.append(f"WARN: 版本 {v['assetId']}/{v['versionId']} 最终仍未有效批准")
    street_scene = next((s for s in scenes if s["id"] == STREET_SCENE_ID), None)
    if street_scene and STREET_SCENE_ID not in version_by_asset:
        template = next(v for v in versions if v["assetId"] == "scene_1780296482373_avuxou2")
        street = build_street_scene_version(root, street_scene, template, report)
        if street:
            versions.append(street)
            version_by_asset[STREET_SCENE_ID] = [street]
            report.append(f"新增场景版本: 道口镇街巷 {street['versionId']}(待人工批准)")

    scene_lib = {s["id"]: s for s in scenes}
    prop_lib = {p["name"]: p for p in props}

    changed = 0
    skipped = 0
    group_prev: dict[str, str] = {}
    excluded_chars: set = set()
    excluded_props: set = set()

    for row in storyboards:
        names = [str(n).strip() for n in (row.get("associateAssetsNames") or [])]
        matched_scenes = match_scenes(names, scenes)
        if not matched_scenes:
            report.append(f"FATAL: S{row['index']:02d} 无法解析主场景(关联资产: {names})")
            continue
        primary = matched_scenes[0]
        secondary = matched_scenes[1:]
        primary_versions = version_by_asset.get(primary["id"])
        if not primary_versions:
            report.append(f"FATAL: S{row['index']:02d} 主场景 {primary['name']} 无连续性版本")
            continue
        label = (row.get("shotSemantics") or {}).get("sceneViewpointId") or ""
        scene_version = pick_viewpoint(primary_versions, label, primary["id"])
        for sec in secondary:
            if sec["id"] not in version_by_asset:
                report.append(f"WARN: S{row['index']:02d} 次场景 {sec['name']} 无版本,跳过 secondary 引用")
            else:
                secondary_picks.append((sec, pick_viewpoint(version_by_asset[sec["id"]], label, sec["id"])))

        semantics = row.get("shotSemantics") or {}
        secondary_picks: list = []
        char_states = []
        char_refs = []
        seen_chars = set()
        for vc in semantics.get("visibleCharacters") or []:
            c = match_character(vc.get("name", ""), characters)
            if not c:
                report.append(f"WARN: S{row['index']:02d} 语义角色「{vc.get('name')}」无库实体,跳过")
                continue
            cv = version_by_asset.get(c["id"])
            if not cv:
                excluded_chars.add(c["name"])
                continue
            if c["id"] in seen_chars:
                continue
            seen_chars.add(c["id"])
            v = cv[0]
            char_states.append({
                "characterId": c["id"],
                "versionId": v["versionId"],
                "position": vc.get("position", ""),
                "orientation": vc.get("orientation", ""),
                "actionIn": vc.get("actionIn", ""),
                "actionOut": vc.get("actionOut", ""),
            })
            char_refs.append((c, v))

        prop_refs = []
        for n in names:
            p = prop_lib.get(n)
            if not p:
                continue
            pv = version_by_asset.get(p["id"])
            if not pv:
                excluded_props.add(n)
                continue
            if not any(pr[0]["id"] == p["id"] for pr in prop_refs):
                prop_refs.append((p, pv[0]))

        def ref_for(asset: dict, version: dict, role: str, order: int) -> dict:
            ref = {
                "order": order,
                "assetId": asset["id"],
                "assetName": asset["name"],
                "assetKind": "scene" if version["assetKind"] == "scene" else version["assetKind"],
                "imagePath": version["referenceImagePaths"][0],
                "referenceImagePaths": version["referenceImagePaths"],
                "referenceImageSha256": version.get("referenceImageSha256"),
                "referenceViewTypes": version.get("referenceViewTypes") or [],
                "source": version.get("source"),
                "versionId": version["versionId"],
                "referenceRole": role,
                "contentFingerprint": version.get("contentFingerprint"),
                "approved": bool(version.get("approved")),
            }
            if version.get("approvalFingerprint"):
                ref["approvalFingerprint"] = version["approvalFingerprint"]
            if version["assetKind"] == "scene":
                ref["sceneViewpointId"] = version.get("sceneViewpointId")
            else:
                ref["identityAnchors"] = version.get("identityAnchors")
                ref["negativePrompt"] = version.get("negativePrompt")
                ref["wardrobeVersion"] = version.get("wardrobeVersion")
            return compact_ref(ref)

        def compact_ref(ref: dict) -> dict:
            return {k: v for k, v in ref.items() if v is not None}

        refs = [ref_for(primary, scene_version, "scene-viewpoint", 1)]
        order = 2
        for sec, sv in secondary_picks:
            refs.append(ref_for(sec, sv, "secondary-scene", order))
            order += 1
        for c, v in char_refs:
            refs.append(ref_for(c, v, "canonical", order))
            order += 1
        for p, v in prop_refs:
            refs.append(ref_for(p, v, "prop-state", order))
            order += 1

        group_id = f"{CHAPTER_ID}:backfill:{primary['id']}"
        cs = {
            "groupId": group_id,
            "previousStoryboardId": group_prev.get(group_id),
            "sceneVersionId": scene_version["versionId"],
            "sceneViewpointId": scene_version.get("sceneViewpointId"),
            "lighting": scene_version.get("lightingDesign") or "",
            "palette": scene_version.get("colorPalette") or "",
            "actionIn": semantics.get("actionIn") or (char_states[0]["actionIn"] if char_states else ""),
            "actionOut": semantics.get("actionOut") or (char_states[-1]["actionOut"] if char_states else ""),
            "characters": char_states,
            "sourceSemanticsFingerprint": stable(semantics),
            "inputFingerprint": "",
        }
        cs = {k: v for k, v in cs.items() if v is not None}
        group_prev[group_id] = row["id"]

        new_row = dict(row)
        new_row["orderedReferenceManifest"] = refs
        new_row["continuityState"] = cs
        new_row["continuityState"]["inputFingerprint"] = visual_continuity_fingerprint(new_row)
        new_row["sourceFingerprint"] = source_fingerprint(new_row)

        old_ok = (
            row.get("orderedReferenceManifest") == new_row["orderedReferenceManifest"]
            and (row.get("continuityState") or {}).get("inputFingerprint") == new_row["continuityState"]["inputFingerprint"]
            and (row.get("continuityState") or {}).get("sourceSemanticsFingerprint") == cs["sourceSemanticsFingerprint"]
        )
        if old_ok:
            skipped += 1
        else:
            row.clear()
            row.update(new_row)
            changed += 1
        print(f"S{row['index']:02d} {primary['name']}·{scene_version.get('sceneViewpointId')}"
              f" 角色[{','.join(c['name'] for c, _ in char_refs)}]"
              f" 道具[{len(prop_refs)}]"
              f"{' 已就绪(跳过)' if old_ok else ''}")

    # ---- 审计模拟 ----
    issues = audit_issues(storyboards, versions)
    by_code: dict[str, int] = {}
    for _, code, _ in issues:
        by_code[code] = by_code.get(code, 0) + 1
    print("\n== 审计模拟(回填后,人审前)==")
    print("  issue 分布:", by_code or "零问题")
    blocking = [(s, c, m) for s, c, m in issues if c != "review.missing" and c != "references.approval"]
    street_pending = [(s, c, m) for s, c, m in issues if c == "references.approval"]
    if blocking:
        print(f"  ✗ 存在 {len(blocking)} 条人审无法消除的硬问题:")
        for s, c, m in blocking[:20]:
            print(f"    {s} [{c}] {m}")

    # 假想审批预演:有画面的镜全部「用户全勾通过」后,除街巷版本待批外应零问题
    street_shot_ids = {r["id"] for r in storyboards
                       if any(x.get("assetId") == STREET_SCENE_ID for x in r.get("orderedReferenceManifest") or [])}
    preview_fail = 0
    for row in storyboards:
        if not (row.get("mediaRef") or {}).get("path"):
            continue
        with_review = dict(row)
        with_review["visualReview"] = hypothetical_approved_review(row)
        sim = [x for x in approved_review_issues(with_review, versions)
               if not (x[1] == "references.approval" and row["id"] in street_shot_ids
                       and STREET_SCENE_ID in x[2])]
        if sim:
            preview_fail += 1
            for s, c, m in sim[:3]:
                print(f"  预演失败 {s} [{c}] {m}")
    print(f"== 假想审批预演: {'全部通过 ✓' if preview_fail == 0 else f'{preview_fail} 镜存在隐藏问题 ✗'} ==")

    no_image = [r["index"] for r in storyboards if not (r.get("mediaRef") or {}).get("path")]
    street_shots = [r["index"] for r in storyboards
                    if any(x.get("assetId") == STREET_SCENE_ID for x in r.get("orderedReferenceManifest") or [])]
    print(f"\n无画面镜(需先补图): {no_image}")
    print(f"街巷版本待人工批准,涉及镜: {street_shots}")
    print(f"排除角色(无版本,不入参考): {sorted(excluded_chars)}")
    print(f"排除道具(无版本,不入参考): {sorted(excluded_props)}")
    for line in report:
        print(line)

    if not args.write:
        print("\n[dry-run] 未写入。加 --write 执行(需先退出应用)。")
        return 0 if not blocking else 1

    if blocking:
        print("FATAL: 存在硬问题,拒绝写入。")
        return 1

    # ---- 写入 ----
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = root / "store" / f"studio-workflow.bak-{STAMP_BACKUP_TAG}-{stamp}"
    shutil.copytree(sw, backup)
    print(f"备份: {backup}")

    sb_files = emit_domain_shards("storyboards", state.get("storyboards", []),
                                  chapter_dir=f"chapters/{CHAPTER_ID}", base_slug="storyboards")
    av_files = emit_domain_shards("continuityAssetVersions", versions,
                                  chapter_dir=None, base_slug="assets-versions")
    old_sb = [n for n in manifest["shards"] if re.fullmatch(rf"chapters/{CHAPTER_ID}/storyboards-\d+-[0-9a-f]+\.json", n)]
    old_av = [n for n in manifest["shards"] if re.fullmatch(r"assets-versions(-\d+)?-[0-9a-f]+\.json", n)]
    old_av_first_pos = manifest["shards"].index(old_av[0]) if old_av else None

    new_shards: list[str] = []
    sb_inserted = False
    for pos, name in enumerate(manifest["shards"]):
        if name in old_sb:
            if not sb_inserted:
                new_shards.extend(n for n, _ in sb_files)
                sb_inserted = True
            continue
        if name in old_av:
            continue
        if old_av_first_pos is not None and pos == old_av_first_pos:
            new_shards.extend(n for n, _ in av_files)
            continue
        new_shards.append(name)
    if not sb_inserted:
        new_shards.extend(n for n, _ in sb_files)
    if old_av and old_av_first_pos is None:
        new_shards.extend(n for n, _ in av_files)

    for name, content in sb_files + av_files:
        target = sw / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    manifest["shards"] = new_shards
    tmp = sw / "manifest.json.tmp"
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, sw / "manifest.json")
    for orphan in old_sb + old_av:
        (sw / orphan).unlink(missing_ok=True)
    print(f"写入分片: {[n for n, _ in sb_files]} + {[n for n, _ in av_files]}")

    # 写后复验:重读盘上数据,审计应只剩 review.missing(街巷镜另有 references.approval)
    sw2, manifest2, state2 = load_store(root)
    rows2 = [b for b in state2.get("storyboards", []) if b["episodeId"] == CHAPTER_ID]
    issues2 = audit_issues(rows2, state2.get("continuityAssetVersions", []))
    by_code2: dict[str, int] = {}
    for _, code, _ in issues2:
        by_code2[code] = by_code2.get(code, 0) + 1
    print("写后审计:", by_code2)
    residual = [x for x in issues2 if x[1] not in ("review.missing", "references.approval")]
    print("写后残留硬问题:", len(residual))
    return 0 if not residual else 1


if __name__ == "__main__":
    sys.exit(main())
