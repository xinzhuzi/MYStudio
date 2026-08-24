#!/usr/bin/env python3
"""道劫 ma-gongbi-v1 同步守护(只读)。

校验 MYStudio 道劫手册 ma_sync 快照(lock-anchors.json + runtime-contract.json)的内部一致性,
并在显式提供 --ma-root 时直连 MA ma-imagegen 工作区重算完整 SHA-256,报告漂移:
- 锚点仍在但非锚点文本已变化(SHA 漂移、锚点齐备);
- 锚点缺失(手册/MA 快照过期);
- MA 工作区文件缺失。

默认只读,不修改任何文件;发现漂移时报告精确来源、期望/实际 SHA 与受影响模块。
退出码:0=一致,1=发现漂移/不一致,2=用法/内部错误。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
MANUAL_DIR = REPO_ROOT / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng"
MA_SYNC_DIR = MANUAL_DIR / "ma_sync"
MA_SKILL_SUBDIR = ".claude/skills/ma-imagegen"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(value: Any) -> str:
    """与 apps/frontend/lib/studio/remotion/canonical-json.ts 对齐:递归键排序 + 紧凑 JS stringify。"""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def check_internal_consistency(report: dict[str, Any]) -> None:
    """MA 工作区不存在时也必须通过的部分:快照结构、登记 SHA 与运行时合同互相咬合。"""
    problems = report["problems"]

    lock_path = MA_SYNC_DIR / "lock-anchors.json"
    contract_path = MA_SYNC_DIR / "runtime-contract.json"
    for path in (lock_path, contract_path):
        if not path.is_file():
            problems.append({"kind": "missing_snapshot_file", "path": str(path.relative_to(REPO_ROOT))})
            return

    anchors = load_json(lock_path)
    contract = load_json(contract_path)

    # lock-anchors.json 结构与手册锚点
    registered: dict[str, str] = {}
    for source in anchors.get("maSources", []):
        rel = str(source.get("path", ""))
        sha = str(source.get("sha256", ""))
        if not rel or len(sha) != 64:
            problems.append({"kind": "invalid_registered_source", "source": rel or "<empty>"})
            continue
        registered[rel.rsplit("ma-imagegen/", 1)[-1]] = sha

    for lock in anchors.get("locks", []):
        manual_file = lock.get("manualFile")
        manual_path = MANUAL_DIR / str(manual_file or "")
        if not manual_path.is_file():
            problems.append({"kind": "missing_manual_file", "manualFile": manual_file})
            continue
        manual_text = manual_path.read_text(encoding="utf-8")
        for anchor_text in lock.get("manualAnchors", []):
            if anchor_text not in manual_text:
                problems.append({
                    "kind": "manual_anchor_missing",
                    "lock": lock.get("name"),
                    "manualFile": manual_file,
                    "anchor": anchor_text,
                })

    # runtime-contract.json:合同指纹 + 来源指纹与登记快照咬合
    expected_contract_sha = str(contract.get("contractSha256", ""))
    fingerprint = {k: v for k, v in contract.items() if k != "contractSha256"}
    actual_contract_sha = sha256_bytes(canonical_json(fingerprint).encode("utf-8"))
    if expected_contract_sha != actual_contract_sha:
        problems.append({
            "kind": "runtime_contract_sha_mismatch",
            "expected": expected_contract_sha,
            "actual": actual_contract_sha,
            "path": str(contract_path.relative_to(REPO_ROOT)),
        })

    contract_sources = {s["path"]: s["sha256"] for s in contract.get("maSources", [])}
    for rel, sha in registered.items():
        if rel not in contract_sources:
            problems.append({"kind": "runtime_contract_missing_source", "source": rel})
        elif contract_sources[rel] != sha:
            problems.append({
                "kind": "runtime_contract_source_sha_mismatch",
                "source": rel,
                "expected": sha,
                "actual": contract_sources[rel],
            })

    for module_id, module in contract.get("modules", {}).items():
        source = module.get("source", {})
        rel = str(source.get("path", ""))
        sha = str(source.get("sha256", ""))
        if contract_sources.get(rel) != sha:
            problems.append({
                "kind": "module_source_sha_mismatch",
                "module": module_id,
                "source": rel,
                "registered_in_maSources": contract_sources.get(rel),
                "module_claims": sha,
            })

    report["internal"] = {
        "registered_sources": registered,
        "contract_version": contract.get("contractVersion"),
        "contract_sha256": actual_contract_sha,
    }


def check_ma_workspace(report: dict[str, Any], ma_root: Path) -> None:
    """直连 MA 工作区:重算完整 SHA,区分「锚点仍在但文本漂移」与「锚点缺失」。"""
    problems = report["problems"]
    skill_root = ma_root / MA_SKILL_SUBDIR
    if not skill_root.is_dir():
        problems.append({"kind": "ma_skill_root_missing", "path": str(skill_root)})
        return

    anchors = load_json(MA_SYNC_DIR / "lock-anchors.json")
    lock_by_source: dict[str, list[str]] = {}
    for lock in anchors.get("locks", []):
        idx = lock.get("sourceIndex")
        sources = anchors.get("maSources", [])
        if isinstance(idx, int) and 0 <= idx < len(sources):
            rel = str(sources[idx].get("path", "")).rsplit("ma-imagegen/", 1)[-1]
            lock_by_source.setdefault(rel, []).extend(lock.get("maAnchors", []))

    drift: list[dict[str, Any]] = []
    for rel, expected_sha in report.get("internal", {}).get("registered_sources", {}).items():
        actual_path = skill_root / rel
        if not actual_path.is_file():
            problems.append({"kind": "ma_source_missing", "source": rel, "path": str(actual_path)})
            continue
        actual_sha = sha256_bytes(actual_path.read_bytes())
        if actual_sha == expected_sha:
            continue
        actual_text = actual_path.read_text(encoding="utf-8")
        expected_anchors = lock_by_source.get(rel, [])
        missing_anchors = [a for a in expected_anchors if a not in actual_text]
        drift.append({
            "source": rel,
            "expected_sha256": expected_sha,
            "actual_sha256": actual_sha,
            "anchors_intact": not missing_anchors,
            "missing_anchors": missing_anchors,
            "diagnosis": (
                "anchors_intact_text_drifted"
                if not missing_anchors
                else "snapshot_stale_anchors_missing"
            ),
            "affected_modules": [
                module_id
                for module_id, module in load_json(MA_SYNC_DIR / "runtime-contract.json")
                .get("modules", {})
                .items()
                if module.get("source", {}).get("path") == rel
            ],
        })
    report["ma_drift"] = drift


def build_report(ma_root: Path | None) -> dict[str, Any]:
    report: dict[str, Any] = {"ok": True, "problems": [], "ma_root": str(ma_root) if ma_root else None}
    check_internal_consistency(report)
    if ma_root is not None:
        check_ma_workspace(report, ma_root)
    report["ok"] = not report["problems"] and not report.get("ma_drift")
    return report


def human_report(report: dict[str, Any]) -> str:
    lines = []
    status = "一致" if report["ok"] else "发现漂移/不一致"
    lines.append(f"道劫 ma-gongbi-v1 同步检查: {status}")
    internal = report.get("internal") or {}
    if internal:
        lines.append(f"  合同版本: {internal.get('contract_version')}  合同 SHA: {internal.get('contract_sha256')}")
        lines.append(f"  登记来源: {len(internal.get('registered_sources', {}))} 份")
    for problem in report["problems"]:
        lines.append(f"  [problem] {json.dumps(problem, ensure_ascii=False)}")
    for item in report.get("ma_drift", []):
        lines.append(
            f"  [drift] {item['source']}: 期望 {item['expected_sha256'][:12]}… 实际 {item['actual_sha256'][:12]}… "
            f"诊断={item['diagnosis']} 受影响模块={item['affected_modules'] or []}"
        )
        for anchor in item.get("missing_anchors", []):
            lines.append(f"          缺失锚点: {anchor}")
    lines.append("  只读检查完成,未修改任何文件。")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="道劫 ma-gongbi-v1 同步守护(只读):校验 MYStudio 快照内部一致性;--ma-root 提供后直连 MA 重算完整 SHA。",
    )
    parser.add_argument(
        "--ma-root",
        type=Path,
        default=None,
        help="MA 仓库根目录(含 .claude/skills/ma-imagegen);不提供时仅做 MYStudio 内部一致性校验。",
    )
    parser.add_argument("--json", action="store_true", help="输出结构化 JSON 报告(默认人类可读)。")
    args = parser.parse_args(argv)

    try:
        report = build_report(args.ma_root)
    except Exception as exc:  # noqa: BLE001 - 顶层兜底,报告后以 2 退出
        if args.json:
            print(json.dumps({"ok": False, "fatal": str(exc)}, ensure_ascii=False))
        else:
            print(f"检查失败: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(human_report(report))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
