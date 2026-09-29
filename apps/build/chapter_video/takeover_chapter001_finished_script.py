#!/usr/bin/env python3
"""Take over a user-supplied finished script(提案四「成稿剧本接管」,两轮制).

Round1(默认)只产「接管检查报告」,不生成任何生产物:实际读取范围/场次与
对白识别情况/完整性疑点/已明确的角色场景道具/逐场尚缺的生产资料清单
(角色状态表/场次制片表/时长初估/资产需求/连续性依据/镜头清单——提案四
:122 六项;裸剧本默认逐场全缺,可经 --materials 登记已有项)。

Round2(--confirm)仅在用户确认「剧本内容不变,只补生产资料」后运行:按
最短路由逐场标注(可直接进分镜/先补资产/先补表演节拍),缺什么列什么,
不强迫重跑前序阶段。路由映射(工具启发式,advisory):六项齐→可直接进
分镜;缺资产侧(角色状态表/场次制片表/资产需求)→先补资产(资产先于
表演节拍);资产侧齐缺表演侧(时长初估/连续性依据/镜头清单)→先补表演
节拍。

两条铁律(提案四 :125,工单约束①):
- 外部成稿剧本=锁定事实源,只读——全程逐字节可比,报告内嵌 sha256 前后
  相等断言(lockVerification),剧本文件 chmod 0444 亦照常完成;
- 任何剧情改动只能另行走剧本修订并另存版本,接管流程无权改写——本模块
  对剧本零写入路径;Round2 校验 Round1 记录的 sha256,剧本变了拒绝接管
  (exit 1)并要求重走 Round1。

时长初估项口径与 A2 工具对齐(工单约束④):容差数值经 import
review_chapter001_duration_chain 复用(同对象,不另立数值),条目说明互引
其字段名(budgetSec/reviewSec/deviationSec/verdict)。

输入格式:JSON(裸行数组或 {shots:[...]};行=dict 或七元组——七元组解析
先例=build_chapter001_workflow.py:2503-2508 source_dialogue_units,台词=
元组 index 3)或纯文本(场次标题认「1-1 …」与「第X场…」,对白认
「说话人:内容」,先例=source_script_body 的 "1-1 " 标记 :2483-2486 与
parse_storyboard_speech 的冒号切分 :2690-2696)。

报告落盘:apps/output/automation/chapter001-takeover-round{1,2}-report.json
(工单约束③,兄弟先例=generate_chapter001_continuity_sample.py:33)。
退出码:0=报告产出;1=Round2 因剧本内容变化拒绝接管;2=输入/用法错误。
App 独立入口不在本轮(提案四【待拍板】,工单约束②排除)。

出处:docs/research/PIPELINE_METHODS_ABSORPTION_ANALYSIS_2026-09-28.md
:119-143(提案四「是什么/落点提案/验收口径」)。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    from apps.build.chapter_video.review_chapter001_duration_chain import (
        TOLERANCE_ABS_SEC,
        TOLERANCE_RATIO,
    )
except ModuleNotFoundError:
    from review_chapter001_duration_chain import (
        TOLERANCE_ABS_SEC,
        TOLERANCE_RATIO,
    )

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_ROUND1_REPORT_PATH = (
    REPO_ROOT / "apps/output/automation/chapter001-takeover-round1-report.json"
)
DEFAULT_ROUND2_REPORT_PATH = (
    REPO_ROOT / "apps/output/automation/chapter001-takeover-round2-report.json"
)

# 尚缺生产资料清单(提案四 :122;时长初估项互引 A2 工具字段,数值 import 复用)。
MATERIAL_ITEMS = [
    {
        "key": "characterStateSheet",
        "label": "角色状态表",
        "note": "逐场出镜角色的状态基线(装束/伤势/持物),供分镜与连续性对表",
    },
    {
        "key": "sceneProductionSheet",
        "label": "场次制片表",
        "note": "逐场时间/地点/出镜名单/道具清单,制片调度用",
    },
    {
        "key": "durationEstimate",
        "label": "时长初估",
        "note": (
            "经 A2 工具 apps/build/chapter_video/review_chapter001_duration_chain.py 落地:"
            "场级预算入参(sceneNo/budgetSec/basis)→成稿复核四元组"
            f"(budgetSec/reviewSec/deviationSec/verdict),容差=max({TOLERANCE_ABS_SEC} 秒,"
            f"{TOLERANCE_RATIO}×预算值)——数值经 import 复用,不另立"
        ),
    },
    {
        "key": "assetRequirements",
        "label": "资产需求",
        "note": "逐场新资产/复用资产清单,先于生成前备齐",
    },
    {
        "key": "continuityBasis",
        "label": "连续性依据",
        "note": "跨镜状态延续的依据记录(衔接镜/回看镜的锚点)",
    },
    {
        "key": "shotList",
        "label": "镜头清单",
        "note": "逐镜画面/台词/时长清单,分镜表的前体",
    },
]
MATERIAL_KEYS = [item["key"] for item in MATERIAL_ITEMS]
ASSET_SIDE_KEYS = {"characterStateSheet", "sceneProductionSheet", "assetRequirements"}
ROUTE_READY = "可直接进分镜"
ROUTE_ASSET = "先补资产"
ROUTE_PERFORMANCE = "先补表演节拍"

TEXT_SCENE_HEADER_PATTERN = re.compile(r"^\s*(?:\d+\s*[-‐]\s*\d+|第?[一二三四五六七八九十百\d]+\s*场)\s*[:：]?\s*(.*)$")
TEXT_DIALOGUE_PATTERN = re.compile(r"^\s*([^:：「【\s][^:：「【]{0,11})\s*[:：]\s*(\S.*)$")
TUPLE_FIELDS = ("scene", "desc", "speaker", "text", "sound", "assets", "duration")  # 台词=index 3(先例 :2503-2508)


def _normalize_json_rows(rows: list[Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """把 JSON 行(dict 或七元组)归一为 {sceneNo,scene,speaker,text,assets};返回 (行, 疑点)。"""
    normalized: list[dict[str, Any]] = []
    concerns: list[dict[str, Any]] = []
    scene_numbers: dict[str, int] = {}
    for index, row in enumerate(rows, 1):
        if isinstance(row, dict):
            scene = str(row.get("scene") or "").strip()
            text = row.get("text") if isinstance(row.get("text"), str) else (
                row.get("lines") if isinstance(row.get("lines"), str) else ""
            )
            assets = row.get("assets") or []
        elif isinstance(row, (list, tuple)):
            if len(row) != len(TUPLE_FIELDS):
                concerns.append({
                    "kind": "tupleArity",
                    "detail": f"第 {index} 行元组列数 {len(row)}≠{len(TUPLE_FIELDS)}(先例七元组),该行跳过",
                })
                continue
            scene = str(row[0] or "").strip()
            text = row[3] if isinstance(row[3], str) else ""
            assets = row[5] or []
        else:
            concerns.append({"kind": "rowType", "detail": f"第 {index} 行既非对象也非元组,该行跳过"})
            continue
        if not scene:
            scene_number = row[1] if isinstance(row, dict) and isinstance(row.get("sceneNo"), int) else None
            scene = f"未命名场{index}"
        else:
            scene_number = scene_numbers.setdefault(scene, len(scene_numbers) + 1)
        if isinstance(row, dict) and isinstance(row.get("sceneNo"), int):
            scene_number = row["sceneNo"]
        normalized.append({
            "sceneNo": scene_number,
            "scene": scene,
            "speaker": str(row.get("speaker") if isinstance(row, dict) else row[2] or "").strip(),
            "text": (text or "").strip(),
            "assets": [str(item) for item in assets] if isinstance(assets, list) else ([str(assets)] if assets else []),
        })
    return normalized, concerns


def _analyze_text_lines(lines: list[str]) -> dict[str, Any]:
    """纯文本识别:场次标题(1-1/第X场)与对白(说话人:内容);未识别行计疑点。"""
    scenes: list[str] = []
    speakers: list[str] = []
    dialogue_units = 0
    unrecognized = 0
    concerns: list[dict[str, Any]] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        header = TEXT_SCENE_HEADER_PATTERN.match(stripped)
        dialogue = TEXT_DIALOGUE_PATTERN.match(stripped)
        if header and not dialogue:
            name = header.group(1).strip().split()[0] if header.group(1).strip() else stripped
            scenes.append(name)
            continue
        if dialogue:
            speakers.append(dialogue.group(1).strip())
            dialogue_units += 1
            continue
        unrecognized += 1
    if not scenes:
        concerns.append({"kind": "noSceneHeaders", "detail": "未识别到场次标题(认「1-1 …」或「第X场…」),需人工确认场次划分"})
    if dialogue_units == 0:
        concerns.append({"kind": "noDialogue", "detail": "未识别到对白行(认「说话人:内容」),需人工确认对白标记"})
    if unrecognized:
        concerns.append({"kind": "unrecognizedLines", "detail": f"{unrecognized} 行未识别为场次/对白(旁白/动作行?),需人工分类"})
    return {
        "format": "text",
        "scenes": scenes,
        "speakers": speakers,
        "dialogueUnits": dialogue_units,
        "props": [],
        "concerns": concerns,
    }


def _analyze_json_rows(rows: list[Any]) -> dict[str, Any]:
    normalized, concerns = _normalize_json_rows(rows)
    scenes: list[str] = []
    scene_numbers: dict[str, int] = {}
    speakers: list[str] = []
    props: list[str] = []
    dialogue_units = 0
    for row in normalized:
        if row["scene"] not in scene_numbers:
            scene_numbers[row["scene"]] = len(scene_numbers) + 1
            scenes.append(row["scene"])
        if row["sceneNo"] is None:
            row["sceneNo"] = scene_numbers[row["scene"]]
        if row["text"]:
            dialogue_units += 1
            if row["speaker"]:
                speakers.append(row["speaker"])
        props.extend(row["assets"])
    if dialogue_units == 0:
        concerns.append({"kind": "noDialogue", "detail": "JSON 行中无任何台词字段(text/lines),需人工确认"})
    return {
        "format": "json",
        "scenes": scenes,
        "speakers": speakers,
        "dialogueUnits": dialogue_units,
        "props": sorted(set(props)),
        "rows": normalized,
        "concerns": concerns,
    }


def _present_keys(materials: dict[str, Any] | None, scene_no: int) -> set[str]:
    if not isinstance(materials, dict):
        return set()
    present = {key for key in materials.get("global") or [] if key in MATERIAL_KEYS}
    per_scene = materials.get("scenes") or {}
    if isinstance(per_scene, dict):
        present |= {
            key for key in per_scene.get(str(scene_no)) or [] if key in MATERIAL_KEYS
        }
    return present


def _missing_items(present: set[str]) -> list[dict[str, Any]]:
    return [
        {"key": item["key"], "label": item["label"], "status": "present" if item["key"] in present else "missing", "note": item["note"]}
        for item in MATERIAL_ITEMS
    ]


def _route_for(missing_keys: list[str]) -> tuple[str, str]:
    if not missing_keys:
        return ROUTE_READY, "六项生产资料齐备,可直接进分镜"
    labels = {
        item["key"]: item["label"] for item in MATERIAL_ITEMS if item["key"] in missing_keys
    }
    asset_missing = [labels[key] for key in MATERIAL_KEYS if key in missing_keys and key in ASSET_SIDE_KEYS]
    performance_missing = [labels[key] for key in MATERIAL_KEYS if key in missing_keys and key not in ASSET_SIDE_KEYS]
    if asset_missing:
        reason = "缺资产侧生产资料:" + "、".join(asset_missing) + "(资产就绪前不进表演节拍)"
        if performance_missing:
            reason += ";另有表演侧缺项:" + "、".join(performance_missing) + "待资产补齐后处理"
        return ROUTE_ASSET, reason
    return ROUTE_PERFORMANCE, "资产侧齐备,缺表演侧生产资料:" + "、".join(performance_missing)


def analyze_script(
    rows: list[Any],
    format: str = "json",
    materials: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Round1/2 共用分析(纯读,零改写):识别情况/疑点/已明确实体/逐场缺项/最短路由。

    Round1 报告剔除 perSceneRoutes(路由标注属 Round2);本函数全量返回供测试
    与 Round2 复用。
    """
    if format == "text":
        analysis = _analyze_text_lines(list(rows))
        scene_entries = [
            {"sceneNo": number, "scene": name} for number, name in enumerate(analysis["scenes"], 1)
        ]
    else:
        analysis = _analyze_json_rows(list(rows))
        scene_numbers: dict[str, int] = {}
        scene_entries = []
        for row in analysis["rows"]:
            if row["scene"] not in scene_numbers:
                scene_numbers[row["scene"]] = row["sceneNo"] if isinstance(row["sceneNo"], int) else len(scene_numbers) + 1
                scene_entries.append({"sceneNo": scene_numbers[row["scene"]], "scene": row["scene"]})

    missing_materials = []
    routes = []
    for entry in scene_entries:
        present = _present_keys(materials, entry["sceneNo"])
        items = _missing_items(present)
        missing_materials.append({
            "sceneNo": entry["sceneNo"],
            "scene": entry["scene"],
            "missingItems": items,
        })
        missing_keys = [item["key"] for item in items if item["status"] == "missing"]
        route, reason = _route_for(missing_keys)
        routes.append({
            "sceneNo": entry["sceneNo"],
            "scene": entry["scene"],
            "route": route,
            "missingKeys": missing_keys,
            "routeReason": reason,
        })

    return {
        "recognition": {
            "format": analysis["format"],
            "scenes": len(analysis["scenes"]),
            "sceneList": list(analysis["scenes"]),
            "dialogueUnits": analysis["dialogueUnits"],
        },
        "integrityConcerns": analysis["concerns"],
        "identified": {
            "characters": sorted(set(analysis["speakers"])),
            "scenes": list(analysis["scenes"]),
            "props": analysis["props"],
        },
        "missingProductionMaterials": missing_materials,
        "perSceneRoutes": routes,
        "noProductionArtifacts": True,
        "sourceOfTruth": {
            "proposal": "docs/research/PIPELINE_METHODS_ABSORPTION_ANALYSIS_2026-09-28.md:119-143 提案四",
            "scriptLock": "外部成稿剧本=锁定事实源只读:全程逐字节可比,报告内嵌 sha256 前后相等;剧情改动只能走剧本修订另存版本,接管产物中不可见",
            "materialsList": "尚缺生产资料六项(角色状态表/场次制片表/时长初估/资产需求/连续性依据/镜头清单),裸剧本默认逐场全缺,--materials 登记已有项",
            "durationEstimateAlignment": "时长初估项互引 A2 review_chapter001_duration_chain(budgetSec/reviewSec/deviationSec/verdict;容差数值 import 复用不另立)",
            "routePolicy": "最短路由:六项齐→可直接进分镜;缺资产侧→先补资产;资产侧齐缺表演侧→先补表演节拍;缺什么列什么,不强迫重跑前序阶段",
            "noProductionArtifacts": "Round1/Round2 都只产报告,不生成分镜/资产/时长等任何生产物",
            "excluded": "是否增设 App 独立入口属提案四【待拍板】,不在本轮",
            "exitCodes": "0=报告产出;1=Round2 因剧本内容变化拒绝接管;2=输入/用法错误",
        },
    }


def _fail(message: str) -> int:
    print(f"输入错误: {message}", file=sys.stderr)
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "成稿剧本接管两轮制(只读):Round1 产接管检查报告(逐场缺项清单),"
            "Round2 --confirm 在剧本内容不变的前提下按最短路由逐场标注;剧本零改写。"
        ),
    )
    parser.add_argument("script_path", type=Path, help="用户自带成稿剧本文件(JSON 或纯文本)")
    parser.add_argument("--materials", type=Path, default=None, help="已有生产资料登记 JSON:{global:[key...]},{scenes:{'1':[key...]}}")
    parser.add_argument("--confirm", action="store_true", help="Round2:用户确认剧本内容不变只补生产资料后运行")
    parser.add_argument("--round1", type=Path, default=DEFAULT_ROUND1_REPORT_PATH, help="Round2 校验用的 Round1 报告路径")
    parser.add_argument("--output", type=Path, default=None, help="报告落盘路径(缺省按轮次落 apps/output/automation/)")
    args = parser.parse_args(argv)

    try:
        raw = args.script_path.read_bytes()
    except OSError as exc:
        return _fail(f"无法读取剧本文件({args.script_path}): {exc}")
    sha256_before = hashlib.sha256(raw).hexdigest()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        return _fail(f"剧本不是 UTF-8 文本: {exc}")
    if not text.strip():
        return _fail("剧本为空文件,无可接管内容")

    try:
        document = json.loads(text)
    except ValueError:
        document = None
        if args.script_path.suffix.lower() == ".json":
            return _fail(f"剧本文件以 .json 命名但不是有效 JSON({args.script_path});如为纯文本请改用 .txt 后缀")
    if document is not None:
        rows = document if isinstance(document, list) else document.get("shots") if isinstance(document, dict) else None
        if not isinstance(rows, list):
            return _fail("JSON 剧本根节点必须是行数组或 {shots: [...]} 对象")
        rows_input: list[Any] = rows
        fmt = "json"
        lines_count = None
    else:
        rows_input = text.splitlines()
        fmt = "text"
        lines_count = len(rows_input)

    materials = None
    if args.materials is not None:
        try:
            materials = json.loads(args.materials.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            return _fail(f"无法读取生产资料登记 JSON({args.materials}): {exc}")
        if not isinstance(materials, dict):
            return _fail("生产资料登记 JSON 必须是 {global:[...],scenes:{...}} 对象")

    analysis = analyze_script(rows_input, format=fmt, materials=materials)
    try:
        sha256_after = hashlib.sha256(args.script_path.read_bytes()).hexdigest()
    except OSError as exc:
        return _fail(f"锁定复核失败,无法重读剧本({args.script_path}): {exc}")
    script_block = {
        "path": str(args.script_path),
        "bytes": len(raw),
        "sha256": sha256_before,
        "readRange": {
            "bytes": len(raw),
            "chars": len(text),
            "lines": lines_count,
            "fullFile": True,
            "encoding": "utf-8",
        },
        "format": fmt,
        "lockedFactsSource": True,
        "lockVerification": {
            "sha256Before": sha256_before,
            "sha256After": sha256_after,
            "equal": sha256_before == sha256_after,
        },
    }

    if not args.confirm:
        report = {key: value for key, value in analysis.items() if key != "perSceneRoutes"}
        report["round"] = 1
        report["advisory"] = True
        report["script"] = script_block
        output_path = args.output or DEFAULT_ROUND1_REPORT_PATH
    else:
        try:
            round1_report = json.loads(args.round1.read_text(encoding="utf-8"))
            recorded_sha256 = round1_report["script"]["sha256"]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            return _fail(f"无法读取 Round1 报告({args.round1}),请先运行 Round1: {exc}")
        if recorded_sha256 != sha256_before:
            print(
                "剧本内容已变化(与 Round1 记录的 sha256 不符)——接管只认「内容不变,只补生产资料」;"
                "须重走 Round1;剧情改动请另行走剧本修订并另存版本,接管流程无权改写",
                file=sys.stderr,
            )
            return 1
        report = dict(analysis)
        report["round"] = 2
        report["advisory"] = True
        report["script"] = script_block
        report["confirm"] = {
            "round1ReportPath": str(args.round1),
            "round1Sha256": recorded_sha256,
            "currentSha256": sha256_before,
            "contentUnchanged": True,
        }
        output_path = args.output or DEFAULT_ROUND2_REPORT_PATH

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
