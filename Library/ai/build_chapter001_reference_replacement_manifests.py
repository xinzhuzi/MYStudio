"""Build the no-network manifests for the three shot-001 V2 reference repairs."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from Library.ai import chapter001_continuity_asset_candidate as candidate_contract
from Library.ai import daojie_gongbi_v2


TASK_DIR = REPO_ROOT / ".trellis/tasks/07-12-mystudio-chapter001-visual-continuity"
SOURCE_PLAN = TASK_DIR / "research/daojie-gongbi-v2-shot001-reference-replacement-plan-20260722-r01.json"
OUTPUT_PLAN = TASK_DIR / "research/daojie-gongbi-v2-shot001-reference-replacement-plan-20260723-r03.json"
MANIFEST_DIR = TASK_DIR / "research/daojie-gongbi-v2-shot001-reference-replacement-manifests-20260723-r02"
OUTPUT_ROOT = REPO_ROOT / "apps/output/automation/daojie-chapter001-v2-bible-replacements-20260723-r03"
PROMPT_CONTRACT_REVISION = daojie_gongbi_v2.REFERENCE_REPLACEMENT_PROMPT_VERSION


def stable_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _section(prompt: str, name: str) -> str:
    value = daojie_gongbi_v2.extract_prompt_section(prompt, name)
    if not value:
        raise RuntimeError(f"替换计划提示词缺少【{name}】")
    return value


def _safe_asset_text(value: str) -> str:
    rendered = daojie_gongbi_v2.render_prompt_safe_negative_constraints(value)
    return daojie_gongbi_v2.render_prompt_safe_story_facts(rendered)


def _next_candidate_id(candidate_id: str) -> str:
    if not candidate_id.endswith("-r01"):
        raise RuntimeError(f"参考替换源 jobId 不是 r01: {candidate_id}")
    return f"{candidate_id[:-3]}r02"


def _ordered_unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw in values:
        value = raw.strip().strip("。")
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _source_specific_negative_terms(value: str) -> list[str]:
    rendered = _safe_asset_text(value).removeprefix("禁止")
    rendered = rendered.replace("断裂衣摆摆", "断裂衣摆").replace("logo和乱码题字", "logo、乱码题字")
    generic_tokens = (
        "写实摄影",
        "3D/CGI",
        "油画厚涂",
        "赛璐璐平涂",
        "大块灰面",
        "黑白画",
        "单色素描",
        "脏污噪点",
        "文字",
        "水印",
        "签名",
        "logo",
        "乱码题字",
        "衣物不完整",
        "破洞",
        "断裂衣摆",
        "断裂裤脚",
        "污渍",
    )
    return [
        term
        for term in re.split(r"[、，]", rendered)
        if term.strip() and not any(token in term for token in generic_tokens)
    ]


def _reference_scoped_subject(subject: str, asset_kind: str) -> str:
    if asset_kind == "scene":
        scope = "输入旧图仅作空间布局草图，不作为绘画风格样本；从空白暖白宣纸完整重绘。"
    elif asset_kind == "character":
        scope = "输入旧图仅作身份、体型、发型与服装层次参考，不作为绘画风格样本；从空白暖白宣纸完整重绘。"
    else:
        scope = "输入旧图仅作轮廓、尺度与核心识别点参考，不作为绘画风格样本；从空白暖白宣纸完整重绘。"
    return f"{scope}{subject}"


def _compact_medium_lock(asset_kind: str) -> str:
    if asset_kind == "scene":
        return (
            "daojie-gongbi-v2《道劫》2D彩色工笔水墨；媒介规则优先于参考图中的数字渲染。"
            "石阶、栈道、藤筐、船体、木桩与缆绳以细密连续白描和铁线描定形，"
            "再用透明薄层矿物色分染与罩染；远山、河雾和水面降低线条密度，主体密、背景疏。"
            "不得继承参考图的灰白媒介、宽笔刷明暗或颗粒化材质。"
        )
    return (
        "daojie-gongbi-v2《道劫》2D彩色工笔水墨；媒介规则优先于参考图中的数字渲染。"
        "脸、手、发丝、衣缘、接缝、衣褶和脚部以细密连续白描和铁线描定形，"
        "再用透明薄层矿物色分染与罩染，主体密、背景疏。衣物完整可穿，服装边缘、"
        "闭合接缝与裤脚清楚；不得继承参考图的灰白媒介、数字明暗或污损材质。"
    )


def _compact_composition(composition: str, asset_kind: str) -> str:
    first_clause = composition.split("；", 1)[0].strip().rstrip("。")
    if asset_kind == "scene":
        return f"{first_clause}；布局草图中的左右物件关系保持不变，前中远景视线通畅。"
    return (
        f"{first_clause}；三格头顶、肩线、腰线与脚底对齐，"
        "背景为均匀暖白宣纸。"
    )


def _compact_color_lock(asset_color: str, asset_kind: str) -> str:
    if asset_kind == "scene":
        return (
            "可辨彩色满足30%-70%硬范围，目标约30%-40%并形成连续可见色区。"
            "冷色连续可见区使用石青或玉青薄染，落在河面、远山与少量石阶边缘；"
            "暖色连续可见区使用赭石与低亮朱砂薄染，只落在船体、栈道、藤筐和一段傍晚天光。"
            "石阶与地面保持淡墨、纸白，材质差异由清楚线描与平整透明色层表达。"
        )
    clauses = _safe_asset_text(asset_color).split("；")
    asset_clauses: list[str] = []
    for clause in clauses[1:]:
        cleaned = clause.split("，不使用", 1)[0].strip()
        cleaned = cleaned.replace("，朴素且干净", "")
        cleaned = cleaned.replace("完整衣物朴素且干净", "完整衣物保持朴素干净")
        if cleaned:
            asset_clauses.append(cleaned)
    return (
        "可辨彩色满足30%-70%硬范围，目标约30%-40%并形成连续可见色区；"
        "石青或玉青与赭石或朱砂分别形成清楚的冷暖色区，墨线、淡墨与纸白保持主体结构。"
        + "；".join(asset_clauses)
        + "。"
    )


def _compact_light_lock(asset_kind: str) -> str:
    if asset_kind == "scene":
        return (
            "傍晚均匀平光宣纸照明与纸面散射光；淡赭余光只照亮旧木、藤筐和石阶边缘，"
            "河面与远山保留石青薄染，河雾以淡墨留白退远。"
        )
    return (
        "均匀平光宣纸照明与纸面散射光照亮脸、手、脚和衣褶，"
        "阴影轻薄并保留冷暖色层。"
    )


def _compact_negative_lock(source_negative: str, asset_kind: str) -> str:
    common = [
        "写实摄影",
        "3D/CGI",
        "数字概念图",
        "油画厚涂",
        "赛璐璐平涂",
        "宽笔刷明暗塑形",
        "密集碎线或满幅皴点",
        "颗粒化做旧与脏污噪点",
        "全幅褐灰或灰蓝单色覆盖",
    ]
    if asset_kind == "scene":
        specific = [
            "镜面湿面反光",
            "现代船只",
            "人物",
            "额外建筑",
        ]
    else:
        specific = [
            "衣物不完整、破洞或断裂衣摆",
            *_source_specific_negative_terms(source_negative),
        ]
    ending = ["文字", "水印", "签名", "logo", "乱码题字"]
    return "禁止" + "、".join(_ordered_unique([*common, *specific, *ending])) + "。"


def build_compact_prompt(job: dict[str, Any]) -> str:
    old_prompt = str(job["prompt"])
    asset_kind = str(job["assetKind"])
    subject = _reference_scoped_subject(
        _safe_asset_text(_section(old_prompt, "主体事实")),
        asset_kind,
    )
    composition = _compact_composition(
        _safe_asset_text(_section(old_prompt, "构图空间")),
        asset_kind,
    )
    asset_color = _safe_asset_text(_section(old_prompt, "色彩材质"))
    asset_negative = _safe_asset_text(_section(old_prompt, "负面约束"))
    return " ".join((
        f"【主体事实】{subject}",
        f"【媒介层级】{_compact_medium_lock(asset_kind)}",
        f"【构图空间】{composition}",
        f"【色彩材质】{_compact_color_lock(asset_color, asset_kind)}",
        f"【光源】{_compact_light_lock(asset_kind)}",
        f"【反向约束】{_compact_negative_lock(asset_negative, asset_kind)}",
    ))


def build_review_plan(source_plan_path: Path = SOURCE_PLAN) -> dict[str, Any]:
    source_plan = json.loads(source_plan_path.read_text(encoding="utf-8"))
    if source_plan.get("schemaVersion") != "daojie-v2-reference-replacement-plan-v1":
        raise RuntimeError("镜头 001 参考替换源计划 schema 不匹配")
    jobs: list[dict[str, Any]] = []
    for source_job in source_plan.get("jobs") or []:
        job = copy.deepcopy(source_job)
        source_job_id = str(job["jobId"])
        job["sourceJobId"] = source_job_id
        job["jobId"] = _next_candidate_id(source_job_id)
        prompt = build_compact_prompt(job)
        roles = [str(job["referenceRole"])]
        capability = daojie_gongbi_v2.resolve_reference_capability("mikoto", "gpt-image-2", roles)
        audit = {
            **daojie_gongbi_v2.prompt_quality_audit(prompt, roles, capability),
            "promptSha256": candidate_contract.sha256_text(prompt),
        }
        daojie_gongbi_v2.assert_prompt_quality_audit(audit)
        replacement_audit = daojie_gongbi_v2.reference_replacement_prompt_audit(
            prompt,
            str(job["assetKind"]),
        )
        daojie_gongbi_v2.assert_reference_replacement_prompt_audit(replacement_audit)
        output_directory = OUTPUT_ROOT / str(job["jobId"])
        output_file_name = f"{job['jobId']}.png"
        job.update({
            "prompt": prompt,
            "promptSha256": audit["promptSha256"],
            "promptAudit": audit,
            "promptContractRevision": PROMPT_CONTRACT_REVISION,
            "referenceReplacementPromptAudit": replacement_audit,
            "referenceCapability": capability,
            "outputPath": str(output_directory / output_file_name),
            "paidAuthorization": False,
            "requestAllowed": False,
        })
        jobs.append(job)
    if len(jobs) != 3 or len({job["jobId"] for job in jobs}) != 3:
        raise RuntimeError("镜头 001 参考替换计划必须精确包含三个唯一作业")
    return {
        "schemaVersion": "daojie-v2-reference-replacement-plan-v3",
        "promptContractRevision": PROMPT_CONTRACT_REVISION,
        "styleContractVersion": daojie_gongbi_v2.STYLE_CONTRACT_VERSION,
        "styleContractFingerprint": daojie_gongbi_v2.style_contract_fingerprint(),
        "promptAuditVersion": daojie_gongbi_v2.PROMPT_AUDIT_VERSION,
        "sourceProvenance": source_plan.get("sourceProvenance"),
        "sourcePlan": {
            "path": str(source_plan_path.resolve()),
            "sha256": stable_sha256(source_plan_path),
        },
        "promptOrder": [
            "主体事实",
            "媒介层级",
            "构图空间",
            "色彩材质",
            "光源",
            "反向约束",
        ],
        "inputEvidence": source_plan.get("inputEvidence"),
        "providerCapability": source_plan.get("providerCapability"),
        "executionPolicy": {
            **(source_plan.get("executionPolicy") or {}),
            "paidAuthorization": False,
            "requestAllowed": False,
            "generationEndpointCalled": False,
            "maximumRequestsWithoutNewAuthorization": 0,
            "automaticRetry": False,
            "providerFallback": False,
            "productionStoreWrite": False,
            "automaticApproval": False,
            "nextAllowedAction": "逐资产零网络 dry-run；每个真实 POST 仍须新的单次明确授权",
        },
        "jobs": jobs,
    }


def build_candidate_manifest(
    job: dict[str, Any],
    *,
    plan_path: Path,
    plan_sha256: str,
) -> dict[str, Any]:
    output_path = Path(str(job["outputPath"])).resolve()
    reference_path = Path(str(job["referencePath"])).resolve()
    reference_roles = [str(job["referenceRole"])]
    manifest: dict[str, Any] = {
        "schemaVersion": candidate_contract.SCHEMA_VERSION,
        "candidateId": job["jobId"],
        "assetId": job["assetId"],
        "assetKind": job["assetKind"],
        "assetName": job["assetName"],
        "currentVersionId": job["currentVersionId"],
        "plannedVersionId": job["plannedVersionId"],
        "attemptId": f"asset-{job['assetId']}:{job['jobId']}",
        "logicalJob": "daojie-chapter001-continuity-reference-replacement",
        "logicalShot": f"asset:{job['assetId']}",
        "provider": {"providerName": "mikoto", "model": "gpt-image-2"},
        "requestAllowed": False,
        "paidAuthorization": {
            "authorized": False,
            "userStatement": "",
            "scope": "No provider POST, retry, fallback, production-store write, or approval is authorized.",
            "bindingSha256": None,
        },
        "sourcePlan": {
            "path": str(plan_path.resolve()),
            "sha256": plan_sha256,
            "jobId": job["jobId"],
        },
        "outputDirectory": str(output_path.parent),
        "outputFileName": output_path.name,
        "aspectRatio": job["aspectRatio"],
        "resolution": job["resolution"],
        "referenceImages": [str(reference_path)],
        "referenceImageSha256": [job["referenceSha256"]],
        "referenceRoles": reference_roles,
        "referenceInheritance": job["referenceInheritance"],
        "sourceRequirements": [
            f"资产：{job['assetName']} ({job['assetId']})",
            f"当前版本：{job['currentVersionId']}",
            f"目标版本：{job['plannedVersionId']}",
            str(job["referenceInheritance"]),
        ],
        "styleContract": {
            "version": daojie_gongbi_v2.STYLE_CONTRACT_VERSION,
            "fingerprint": daojie_gongbi_v2.style_contract_fingerprint(),
            "sourceProvenance": daojie_gongbi_v2.SOURCE_PROVENANCE,
        },
        "prompt": job["prompt"],
        "promptSha256": job["promptSha256"],
        "promptAudit": job["promptAudit"],
        "promptContractRevision": job["promptContractRevision"],
        "referenceReplacementPromptAudit": job["referenceReplacementPromptAudit"],
        "referenceCapability": job["referenceCapability"],
        "executionPolicy": {
            "serialized": True,
            "singleAttempt": True,
            "nonOverwriting": True,
            "automaticRetry": False,
            "providerFallback": False,
            "productionStoreWrite": False,
            "automaticApproval": False,
        },
    }
    manifest["requestBindingSha256"] = candidate_contract.request_binding_sha256(manifest)
    return manifest


def write_artifacts(
    *,
    output_plan: Path = OUTPUT_PLAN,
    manifest_dir: Path = MANIFEST_DIR,
) -> dict[str, Any]:
    for path in (output_plan, manifest_dir):
        if path.exists():
            raise RuntimeError(f"拒绝覆盖既有参考替换证据: {path}")
    plan = build_review_plan()
    atomic_write_json(output_plan, plan)
    plan_sha256 = stable_sha256(output_plan)
    manifest_paths: list[str] = []
    for job in plan["jobs"]:
        manifest = build_candidate_manifest(job, plan_path=output_plan, plan_sha256=plan_sha256)
        manifest_path = manifest_dir / f"{job['jobId']}.json"
        atomic_write_json(manifest_path, manifest)
        candidate_contract.load_and_validate_manifest(manifest_path, dry_run=True)
        manifest_paths.append(str(manifest_path))
    return {
        "planPath": str(output_plan),
        "planSha256": plan_sha256,
        "manifestPaths": manifest_paths,
        "manifestCount": len(manifest_paths),
        "generationEndpointCalled": False,
        "paidAuthorization": False,
        "requestAllowed": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-plan", type=Path, default=OUTPUT_PLAN)
    parser.add_argument("--manifest-dir", type=Path, default=MANIFEST_DIR)
    args = parser.parse_args()
    print(json.dumps(write_artifacts(output_plan=args.output_plan, manifest_dir=args.manifest_dir), ensure_ascii=False))


if __name__ == "__main__":
    main()
