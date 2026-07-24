"""Validate paid-safe Daojie chapter-001 continuity asset manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from Library.ai import daojie_gongbi_v2


SCHEMA_VERSION = "daojie-continuity-asset-candidate-v2"
ALLOWED_ASSET_KINDS = {"scene", "character", "prop"}
AUTOMATION_ROOT = (REPO_ROOT / "apps/output/automation").resolve()
HEX_SHA256 = re.compile(r"^[a-f0-9]{64}$")
SAFE_PNG_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*\.png$", re.IGNORECASE)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _required_string(manifest: dict[str, Any], field: str) -> str:
    value = str(manifest.get(field) or "").strip()
    if not value:
        raise RuntimeError(f"连续性资产候选清单缺少 {field}")
    return value


def _inside_automation_root(path: Path) -> bool:
    try:
        path.relative_to(AUTOMATION_ROOT)
    except ValueError:
        return False
    return True


def request_binding_payload(manifest: dict[str, Any]) -> dict[str, Any]:
    """Return the immutable fields covered by one future paid authorization."""
    provider = manifest.get("provider") or {}
    style_contract = manifest.get("styleContract") or {}
    capability = manifest.get("referenceCapability") or {}
    source_plan = manifest.get("sourcePlan") or {}
    return {
        "schemaVersion": manifest.get("schemaVersion"),
        "candidateId": manifest.get("candidateId"),
        "assetId": manifest.get("assetId"),
        "assetKind": manifest.get("assetKind"),
        "plannedVersionId": manifest.get("plannedVersionId"),
        "attemptId": manifest.get("attemptId"),
        "logicalJob": manifest.get("logicalJob"),
        "logicalShot": manifest.get("logicalShot"),
        "providerName": provider.get("providerName"),
        "model": provider.get("model"),
        "requestMode": capability.get("requestMode"),
        "promptSha256": manifest.get("promptSha256"),
        "referenceImages": manifest.get("referenceImages"),
        "referenceImageSha256": manifest.get("referenceImageSha256"),
        "referenceRoles": manifest.get("referenceRoles"),
        "outputDirectory": manifest.get("outputDirectory"),
        "outputFileName": manifest.get("outputFileName"),
        "aspectRatio": manifest.get("aspectRatio"),
        "resolution": manifest.get("resolution"),
        "promptContractRevision": manifest.get("promptContractRevision"),
        "styleContractVersion": style_contract.get("version"),
        "styleContractFingerprint": style_contract.get("fingerprint"),
        "referenceCapabilityFingerprint": capability.get("fingerprint"),
        "sourcePlanSha256": source_plan.get("sha256"),
    }


def request_binding_sha256(manifest: dict[str, Any]) -> str:
    return sha256_text(canonical_json(request_binding_payload(manifest)))


def validate_manifest(
    manifest: dict[str, Any],
    *,
    manifest_path: Path,
    dry_run: bool,
) -> dict[str, Any]:
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeError("连续性资产候选清单 schema 不匹配")

    for field in (
        "assetId",
        "assetName",
        "candidateId",
        "plannedVersionId",
        "attemptId",
        "logicalJob",
        "logicalShot",
        "prompt",
        "promptSha256",
        "outputDirectory",
        "outputFileName",
        "aspectRatio",
        "resolution",
    ):
        _required_string(manifest, field)

    asset_kind = str(manifest.get("assetKind") or "")
    if asset_kind not in ALLOWED_ASSET_KINDS:
        raise RuntimeError(f"连续性资产候选 assetKind 不受支持: {asset_kind}")
    if not SAFE_PNG_NAME.fullmatch(str(manifest["outputFileName"])):
        raise RuntimeError("连续性资产候选 outputFileName 必须是安全的 .png 文件名")

    output_directory = Path(str(manifest["outputDirectory"])).expanduser().resolve()
    if not _inside_automation_root(output_directory):
        raise RuntimeError("连续性资产候选输出目录必须位于 apps/output/automation")
    output_path = (output_directory / str(manifest["outputFileName"])).resolve()
    if output_path.parent != output_directory:
        raise RuntimeError("连续性资产候选 outputFileName 逃逸输出目录")

    prompt = str(manifest["prompt"])
    prompt_sha256 = sha256_text(prompt)
    if manifest.get("promptSha256") != prompt_sha256:
        raise RuntimeError("连续性资产候选 promptSha256 与提示词正文不匹配")

    reference_images = manifest.get("referenceImages")
    reference_hashes = manifest.get("referenceImageSha256")
    reference_roles = manifest.get("referenceRoles")
    if not all(isinstance(value, list) for value in (reference_images, reference_hashes, reference_roles)):
        raise RuntimeError("连续性资产候选参考图、SHA 与角色必须是数组")
    if not (len(reference_images) == len(reference_hashes) == len(reference_roles)):
        raise RuntimeError("连续性资产候选参考图、SHA 与角色数量不一致")
    if not reference_images:
        raise RuntimeError("V2 参考替换资产至少需要一张已绑定的参考图")
    for index, (raw_path, expected_sha256) in enumerate(zip(reference_images, reference_hashes), start=1):
        reference_path = Path(str(raw_path)).expanduser()
        if not reference_path.is_absolute() or not reference_path.is_file():
            raise RuntimeError(f"连续性资产候选参考图 {index} 不存在或不是绝对路径")
        if reference_path.suffix.lower() != ".png":
            raise RuntimeError(f"连续性资产候选参考图 {index} 必须是 PNG")
        if not HEX_SHA256.fullmatch(str(expected_sha256 or "")):
            raise RuntimeError(f"连续性资产候选参考图 {index} 缺少合法 SHA-256")
        if sha256_file(reference_path) != expected_sha256:
            raise RuntimeError(f"连续性资产候选参考图 {index} SHA-256 不匹配")
        try:
            with Image.open(reference_path) as image:
                if image.format != "PNG":
                    raise RuntimeError(f"连续性资产候选参考图 {index} 实际格式不是 PNG")
                image.verify()
        except (OSError, UnidentifiedImageError) as error:
            raise RuntimeError(f"连续性资产候选参考图 {index} 无法解码") from error

    provider = manifest.get("provider") or {}
    provider_name = str(provider.get("providerName") or "").strip()
    model = str(provider.get("model") or "").strip()
    if not provider_name or not model:
        raise RuntimeError("连续性资产候选缺少已审阅的 provider/model")
    expected_capability = daojie_gongbi_v2.resolve_reference_capability(
        provider_name,
        model,
        reference_roles,
    )
    if manifest.get("referenceCapability") != expected_capability:
        raise RuntimeError("连续性资产候选 referenceCapability 不是当前本地精确能力记录")
    daojie_gongbi_v2.assert_reference_capability(expected_capability, reference_roles)

    expected_style_contract = {
        "version": daojie_gongbi_v2.STYLE_CONTRACT_VERSION,
        "fingerprint": daojie_gongbi_v2.style_contract_fingerprint(),
        "sourceProvenance": daojie_gongbi_v2.SOURCE_PROVENANCE,
    }
    if manifest.get("styleContract") != expected_style_contract:
        raise RuntimeError("连续性资产候选 styleContract 不是当前本地 V2 合同")
    expected_prompt_audit = {
        **daojie_gongbi_v2.prompt_quality_audit(prompt, reference_roles, expected_capability),
        "promptSha256": prompt_sha256,
    }
    if manifest.get("promptAudit") != expected_prompt_audit:
        raise RuntimeError("连续性资产候选 promptAudit 与当前提示词或 V2 规则不匹配")
    daojie_gongbi_v2.assert_prompt_quality_audit(expected_prompt_audit)
    expected_prompt_contract_revision = daojie_gongbi_v2.REFERENCE_REPLACEMENT_PROMPT_VERSION
    if manifest.get("promptContractRevision") != expected_prompt_contract_revision:
        raise RuntimeError("连续性资产候选 promptContractRevision 不是当前参考替换合同")
    expected_replacement_audit = daojie_gongbi_v2.reference_replacement_prompt_audit(
        prompt,
        asset_kind,
    )
    if manifest.get("referenceReplacementPromptAudit") != expected_replacement_audit:
        raise RuntimeError(
            "连续性资产候选 referenceReplacementPromptAudit 与当前提示词或替换规则不匹配"
        )
    daojie_gongbi_v2.assert_reference_replacement_prompt_audit(expected_replacement_audit)

    source_plan = manifest.get("sourcePlan") or {}
    source_plan_path = Path(str(source_plan.get("path") or "")).expanduser()
    if not source_plan_path.is_absolute() or not source_plan_path.is_file():
        raise RuntimeError("连续性资产候选缺少可读取的绝对 sourcePlan 路径")
    if source_plan.get("jobId") != manifest.get("candidateId"):
        raise RuntimeError("连续性资产候选 sourcePlan.jobId 与 candidateId 不匹配")
    if source_plan.get("sha256") != sha256_file(source_plan_path):
        raise RuntimeError("连续性资产候选 sourcePlan SHA-256 不匹配")
    try:
        source_plan_value = json.loads(source_plan_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeError("连续性资产候选 sourcePlan 不是合法 JSON") from error
    source_jobs = [
        item
        for item in source_plan_value.get("jobs") or []
        if isinstance(item, dict) and item.get("jobId") == manifest.get("candidateId")
    ]
    if len(source_jobs) != 1:
        raise RuntimeError("连续性资产候选 sourcePlan 未包含唯一对应 job")
    source_job = source_jobs[0]
    source_manifest_fields = {
        "assetId": manifest.get("assetId"),
        "assetKind": manifest.get("assetKind"),
        "assetName": manifest.get("assetName"),
        "currentVersionId": manifest.get("currentVersionId"),
        "plannedVersionId": manifest.get("plannedVersionId"),
        "prompt": manifest.get("prompt"),
        "promptSha256": manifest.get("promptSha256"),
        "promptContractRevision": manifest.get("promptContractRevision"),
        "referenceReplacementPromptAudit": manifest.get("referenceReplacementPromptAudit"),
        "referencePath": reference_images[0] if len(reference_images) == 1 else None,
        "referenceSha256": reference_hashes[0] if len(reference_hashes) == 1 else None,
        "referenceRole": reference_roles[0] if len(reference_roles) == 1 else None,
        "outputPath": str(output_path),
        "aspectRatio": manifest.get("aspectRatio"),
        "resolution": manifest.get("resolution"),
    }
    if any(source_job.get(field) != value for field, value in source_manifest_fields.items()):
        raise RuntimeError("连续性资产候选执行输入与 sourcePlan 对应 job 不一致")

    binding_sha256 = request_binding_sha256(manifest)
    if manifest.get("requestBindingSha256") != binding_sha256:
        raise RuntimeError("连续性资产候选 requestBindingSha256 与执行输入不匹配")

    paid_authorization = manifest.get("paidAuthorization") or {}
    authorized = paid_authorization.get("authorized") is True
    request_allowed = manifest.get("requestAllowed") is True
    if request_allowed != authorized:
        raise RuntimeError("连续性资产候选 requestAllowed 与 paidAuthorization 不一致")
    if authorized:
        if not str(paid_authorization.get("userStatement") or "").strip():
            raise RuntimeError("连续性资产候选缺少明确的用户付费授权原文")
        if not str(paid_authorization.get("scope") or "").strip():
            raise RuntimeError("连续性资产候选缺少付费授权范围")
        if paid_authorization.get("bindingSha256") != binding_sha256:
            raise RuntimeError("连续性资产候选付费授权未绑定当前执行输入")
    elif paid_authorization.get("bindingSha256") not in (None, ""):
        raise RuntimeError("未授权资产候选不得携带授权 bindingSha256")
    if not dry_run and not authorized:
        raise RuntimeError("连续性资产候选真实生成缺少当前执行输入的单次付费授权")

    return {
        **manifest,
        "manifestPath": str(manifest_path.resolve()),
        "outputDirectory": str(output_directory),
        "outputPath": str(output_path),
        "requestBindingSha256": binding_sha256,
        "paidAuthorizationVerified": authorized,
        "requestAllowed": request_allowed and not dry_run,
    }


def load_and_validate_manifest(path: Path, *, dry_run: bool) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError(f"连续性资产候选清单不存在: {path}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"连续性资产候选清单不是合法 JSON: {path}") from error
    if not isinstance(manifest, dict):
        raise RuntimeError("连续性资产候选清单顶层必须是对象")
    return validate_manifest(manifest, manifest_path=path, dry_run=dry_run)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(load_and_validate_manifest(args.manifest, dry_run=args.dry_run), ensure_ascii=False))


if __name__ == "__main__":
    main()
