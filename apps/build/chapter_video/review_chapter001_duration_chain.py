#!/usr/bin/env python3
"""Review the chapter-001 four-level duration chain(提案一,advisory 只读复核).

四级时长链(每级只做本级该做的事,下一级不得照抄上一级数字):
- 第①级 场级预算(导演规划期)=本工具入参 JSON,人工填写预算值+估算依据
  (basis:动作量/对白密度/必要停顿);工具不代算预算、不按场次数平均分配。
- 第②级 成稿复核(剧本生产期)=逐场按实际台词字数×情绪语速折算时长
  (=Σ镜正推值),与场级预算比对;容差=两者取大(5 秒或 10%×预算值),
  偏差取绝对值双向判;超限场给「保留内容并延长/授权精简/调整场次预算」
  三选一决定记录位,只登记不代决;严禁自动加快语速消化超限(提案一原文,
  本模块不存在任何改写路径)。
- 第③级 镜级折算核对(分镜表期)=逐镜 durationSec vs 正推折算值
  ceil(台词字数/语速)+非说话开销(缺省 1.0 秒)。
- 第④级 真实回写(生成期)=h3DurationUs/排轨按帧数真实时长,已有链不动,
  不在本 python 工具边界(前端域)。

数值真源(零第三处镜像,全部经 lint 模块复用其镜像):
- 情绪语速(怒4/平3/悲2)与非说话开销缺省 1.0s:
  lint_chapter001_dialogue_capacity.py:38-59(resolve_rate/resolve_overhead_sec/
  dialogue_chars/is_valid_duration),其镜像真源=apps/frontend/lib/studio/
  storyboard-table.ts:67-81(resolveSpeed/computeDurationSec)。
- 缺有效时长话术:同模块 MISSING_DURATION_REASON。

成稿剧本数据解析先例(只读 import,不改该文件):
- build_chapter001_workflow.py:2503-2508 source_dialogue_units(台词=元组
  index 3);:2541-2556 canonical_storyboard_shots(七元组 场景/画面/角色/
  台词/音效/资产/时长 的逐镜投影)。已知边界:章一成稿数据无情绪字段,
  语速按平3缺省折算(情绪词表在分镜表情态才出现)。

容差与三选一话术出处:docs/research/PIPELINE_METHODS_ABSORPTION_ANALYSIS_
2026-09-28.md:26(提案一「是什么」第 2 条)。

已知边界:成稿复核值只含台词折算与逐镜非说话开销,不含空台词镜时长;
镜级核对按整数秒正推值判(ceil),与 lint 容量门的分数秒口径在半秒边界
可能相差一档(两问不同:此处核对名义时长 vs 正推值,lint 问装不装得下)。
"""

from __future__ import annotations

import argparse
import importlib
import json
import math
import sys
from pathlib import Path
from typing import Any

try:
    from apps.build.chapter_video.lint_chapter001_dialogue_capacity import (
        DEFAULT_NONSPEECH_OVERHEAD_SEC,
        MISSING_DURATION_REASON,
        dialogue_chars,
        is_valid_duration,
        resolve_overhead_sec,
        resolve_rate,
    )
except ModuleNotFoundError:
    from lint_chapter001_dialogue_capacity import (
        DEFAULT_NONSPEECH_OVERHEAD_SEC,
        MISSING_DURATION_REASON,
        dialogue_chars,
        is_valid_duration,
        resolve_overhead_sec,
        resolve_rate,
    )

TOOL_NAME = "review_chapter001_duration_chain"
TOLERANCE_ABS_SEC = 5.0
TOLERANCE_RATIO = 0.10
DECISION_OPTIONS = ["保留内容并延长", "授权精简", "调整场次预算"]
DECISION_NOTE = "人工三选一决定记录位:本工具只登记不代决,严禁自动加快语速消化超限(提案一)"
UNDER_FORWARD_REASON = "镜时长低于正推折算值,台词装不下(正推=ceil(字数/语速)+开销)"
MISSING_SCENE_NO_REASON = "缺场次号无法归场"
EMPTY_DIALOGUE_REASON = "空台词"


def _round6(value: float) -> float:
    """报告数值统一 6 位小数收敛(如 0.1×100 的浮点尾差),不改变判定口径。"""
    return round(float(value), 6)


def _is_scene_no(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def shot_forward_sec(shot: dict[str, Any]) -> float | None:
    """第③级正推折算:ceil(台词字数/语速)+非说话开销(镜像 computeDurationSec)。

    空台词镜返回 None(无台词无可折算,由调用方记 skipped)。
    语速与开销数值一律复用 lint 模块,本文件零第三处镜像。
    """
    chars = dialogue_chars(shot)
    if chars == 0:
        return None
    rate = resolve_rate(shot.get("emotion"))
    overhead_sec = resolve_overhead_sec(shot)
    return _round6(math.ceil(chars / rate) + overhead_sec)


def scene_four_tuple(budget_sec: Any, review_sec: float) -> dict[str, Any]:
    """第②级四元组{预算值/成稿复核值/偏差/容差判定}+容差值。

    容差=两者取大(5 秒或 10%×预算值),偏差取绝对值双向判
    (成稿长于或短于预算超限都须人裁)。预算缺失/非法时降级登记
    (verdict=missingBudget/invalidBudget,容差与偏差留 None),不猜测。
    """
    review = _round6(review_sec)
    if budget_sec is None:
        return {
            "budgetSec": None,
            "reviewSec": review,
            "deviationSec": None,
            "toleranceSec": None,
            "verdict": "missingBudget",
        }
    if not is_valid_duration(budget_sec):
        return {
            "budgetSec": budget_sec,
            "reviewSec": review,
            "deviationSec": None,
            "toleranceSec": None,
            "verdict": "invalidBudget",
        }
    budget = float(budget_sec)
    tolerance_sec = _round6(max(TOLERANCE_ABS_SEC, TOLERANCE_RATIO * budget))
    deviation_sec = _round6(review - budget)
    verdict = "withinTolerance" if abs(deviation_sec) <= tolerance_sec else "overLimit"
    return {
        "budgetSec": budget,
        "reviewSec": review,
        "deviationSec": deviation_sec,
        "toleranceSec": tolerance_sec,
        "verdict": verdict,
    }


def adapt_workflow_shots(canonical_shots: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """把 canonical_storyboard_shots 投影适配为本工具/lint 契约的镜输入。

    先例(build_chapter001_workflow.py:2541-2556):text=台词(元组 index 3)、
    duration=名义时长;适配为 lines/durationSec。无情绪字段→语速按平3缺省;
    非字符串台词按空台词处理(dialogue_chars 语义)。
    """
    adapted: list[dict[str, Any]] = []
    for index, shot in enumerate(canonical_shots or [], 1):
        if not isinstance(shot, dict):
            continue
        text = shot.get("text")
        adapted.append(
            {
                "storyboardId": f"chapter-001-shot-{index}",
                "sceneNo": shot.get("sceneNo"),
                "speaker": shot.get("speaker"),
                "lines": text if isinstance(text, str) else "",
                "durationSec": shot.get("duration"),
            }
        )
    return adapted


def load_workflow_shots() -> list[dict[str, Any]]:
    """缺省成稿来源:只读 import build_chapter001_workflow(不改该文件)。

    解析先例=source_dialogue_units(:2503-2508)/canonical_storyboard_shots
    (:2541-2556)。该模块属重依赖(numpy/PIL/本地故事档案),只在缺省路径
    懒加载;不可导入时给出明确错误,请改传成稿剧本 JSON 文件。
    """
    workflow: Any = None
    for module_name in (
        "apps.build.chapter_video.build_chapter001_workflow",
        "build_chapter001_workflow",
    ):
        try:
            workflow = importlib.import_module(module_name)
            break
        except (ImportError, OSError):
            continue
    if workflow is None:
        raise RuntimeError(
            "无法只读 import build_chapter001_workflow(成稿剧本解析先例模块,"
            "重依赖 numpy/PIL/本地故事档案);请显式传入成稿剧本 JSON 文件路径"
        )
    return adapt_workflow_shots(workflow.canonical_storyboard_shots())


def source_of_truth() -> dict[str, str]:
    """每级真源声明(验收口径:任何一级的数字能向上追溯到它的真源)。"""
    return {
        "sceneBudget": "第①级 场级预算=入参 JSON 人工填写(含估算依据 basis);本工具不代算预算、不按场次数平均分配",
        "sceneReview": "第②级 成稿复核值=Σ镜正推值 ceil(台词字数/语速)+非说话开销;超限场只登记人工三选一决定位,不代决",
        "shotForward": "第③级 镜级正推折算=ceil(字数/语速)+开销,数值经 apps/build/chapter_video/lint_chapter001_dialogue_capacity.py:38-59 复用(镜像真源 apps/frontend/lib/studio/storyboard-table.ts:67-81)",
        "rate": "情绪语速 怒4/平3/悲2 字每秒:lint 模块 resolve_rate(storyboard-table.ts:70-75 镜像),本文件零第三处镜像",
        "nonspeechOverhead": f"非说话开销缺省 {DEFAULT_NONSPEECH_OVERHEAD_SEC} 秒,逐镜可经 nonspeechOverheadSec 覆写:lint 模块 resolve_overhead_sec",
        "tolerance": "场级容差=max(5 秒, 10%×预算值),偏差取绝对值双向判(docs/research/PIPELINE_METHODS_ABSORPTION_ANALYSIS_2026-09-28.md:26 提案一)",
        "level4RealWriteback": "第④级 真实回写(h3DurationUs/排轨按帧数真实时长)已有链不动,不在本 python 工具边界",
    }


def review_duration_chain(
    shots: list[dict[str, Any]], scene_budgets: list[dict[str, Any]]
) -> dict[str, Any]:
    """跑四级时长链第②③级复核,返回只读 JSON 报告(零改写输入)。

    镜输入契约(与 lint 同):{storyboardId, sceneNo, lines, durationSec?,
    emotion?, nonspeechOverheadSec?};场预算契约:{sceneNo, budgetSec, basis?}。
    报告含:逐场四元组(超限场带三选一决定记录位)、逐镜
    {forwardSec, durationSec, deltaSec, verdict}、违例清单、链路断口登记
    (missingBudget/invalidBudget/budgetWithoutScript/missingSceneNo)与逐级真源声明。
    """
    report: dict[str, Any] = {
        "tool": TOOL_NAME,
        "advisory": True,
        "shotsTotal": 0,
        "scenes": [],
        "shots": [],
        "skippedShots": [],
        "violations": [],
        "budgetWithoutScript": [],
        "sourceOfTruth": source_of_truth(),
    }
    budgets: dict[int, dict[str, Any]] = {}
    for entry in scene_budgets or []:
        if not isinstance(entry, dict):
            continue
        scene_no = entry.get("sceneNo")
        if _is_scene_no(scene_no):
            budgets[scene_no] = entry

    scene_acc: dict[int, dict[str, Any]] = {}
    for shot in shots or []:
        if not isinstance(shot, dict):
            continue
        report["shotsTotal"] += 1
        storyboard_id = shot.get("storyboardId")
        scene_no = shot.get("sceneNo")
        chars = dialogue_chars(shot)
        record: dict[str, Any] = {
            "storyboardId": storyboard_id,
            "sceneNo": scene_no,
            "dialogueChars": chars,
            "rate": None,
            "overheadSec": None,
            "forwardSec": None,
            "durationSec": None,
            "deltaSec": None,
            "verdict": None,
            "reason": None,
        }
        if not _is_scene_no(scene_no):
            record["verdict"] = "missingSceneNo"
            record["reason"] = MISSING_SCENE_NO_REASON
            report["violations"].append(
                {
                    "storyboardId": storyboard_id,
                    "sceneNo": scene_no,
                    "kind": "missingSceneNo",
                    "reason": MISSING_SCENE_NO_REASON,
                }
            )
            report["shots"].append(record)
            continue
        acc = scene_acc.setdefault(scene_no, {"review": 0.0, "breakdown": [], "shotCount": 0, "skipped": 0})
        acc["shotCount"] += 1
        if chars == 0:
            record["verdict"] = "skippedEmptyDialogue"
            record["reason"] = EMPTY_DIALOGUE_REASON
            acc["skipped"] += 1
            report["skippedShots"].append({"storyboardId": storyboard_id, "reason": EMPTY_DIALOGUE_REASON})
            report["shots"].append(record)
            continue
        rate = resolve_rate(shot.get("emotion"))
        overhead_sec = resolve_overhead_sec(shot)
        forward = _round6(math.ceil(chars / rate) + overhead_sec)
        record["rate"] = rate
        record["overheadSec"] = overhead_sec
        record["forwardSec"] = forward
        acc["review"] += forward
        acc["breakdown"].append({"storyboardId": storyboard_id, "forwardSec": forward})
        duration = shot.get("durationSec")
        if not is_valid_duration(duration):
            record["verdict"] = "missingDuration"
            record["reason"] = MISSING_DURATION_REASON
            report["violations"].append(
                {
                    "storyboardId": storyboard_id,
                    "sceneNo": scene_no,
                    "kind": "missingDuration",
                    "reason": MISSING_DURATION_REASON,
                    "forwardSec": forward,
                    "durationSec": duration,
                }
            )
        else:
            duration_sec = float(duration)
            delta_sec = _round6(duration_sec - forward)
            record["durationSec"] = duration_sec
            record["deltaSec"] = delta_sec
            if delta_sec < 0:
                record["verdict"] = "underForward"
                record["reason"] = UNDER_FORWARD_REASON
                report["violations"].append(
                    {
                        "storyboardId": storyboard_id,
                        "sceneNo": scene_no,
                        "kind": "underForward",
                        "reason": UNDER_FORWARD_REASON,
                        "forwardSec": forward,
                        "durationSec": duration_sec,
                        "deltaSec": delta_sec,
                    }
                )
            else:
                record["verdict"] = "fits"
        report["shots"].append(record)

    for scene_no in sorted(scene_acc):
        acc = scene_acc[scene_no]
        entry = budgets.get(scene_no)
        budget_sec = entry.get("budgetSec") if entry is not None else None
        scene: dict[str, Any] = {
            "sceneNo": scene_no,
            **scene_four_tuple(budget_sec, acc["review"]),
            "shotCount": acc["shotCount"],
            "skippedShots": acc["skipped"],
            "shotForwardBreakdown": acc["breakdown"],
        }
        if entry is not None and isinstance(entry.get("basis"), (dict, str)):
            scene["basis"] = entry["basis"]
        if scene["verdict"] == "overLimit":
            scene["decision"] = None
            scene["decisionOptions"] = list(DECISION_OPTIONS)
            scene["decisionNote"] = DECISION_NOTE
        report["scenes"].append(scene)
    report["budgetWithoutScript"] = sorted(no for no in budgets if no not in scene_acc)
    return report


def _load_json_document(path: Path, collection_key: str, what: str) -> list[Any]:
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    items = document.get(collection_key) if isinstance(document, dict) else document
    if not isinstance(items, list):
        raise ValueError(f"{what} JSON 根节点必须是数组或 {{{collection_key}: [...]}} 对象")
    return items


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "四级时长链 python 复核(只读 advisory):场级预算入参→成稿复核(容差=max(5秒,10%))"
            "→镜级语速折算核对;超限场给人工三选一决定记录位,不代决、不改写任何输入。"
        ),
    )
    parser.add_argument(
        "budget_json",
        type=Path,
        help="场级预算 JSON 文件路径;根节点可为裸场次数组或 {scenes: [...]} 对象(每场 {sceneNo, budgetSec, basis?})",
    )
    parser.add_argument(
        "script_json",
        nargs="?",
        type=Path,
        default=None,
        help=(
            "成稿剧本 JSON 文件路径(裸分镜数组或 {shots: [...]});"
            "缺省时只读 import build_chapter001_workflow 解析先例模块取章一成稿"
        ),
    )
    args = parser.parse_args(argv)
    try:
        budgets = _load_json_document(args.budget_json, "scenes", "场级预算")
        shots = (
            _load_json_document(args.script_json, "shots", "成稿剧本")
            if args.script_json is not None
            else load_workflow_shots()
        )
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"输入错误: {exc}", file=sys.stderr)
        return 2
    report = review_duration_chain(shots, budgets)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    findings = (
        bool(report["violations"])
        or bool(report["budgetWithoutScript"])
        or any(scene["verdict"] != "withinTolerance" for scene in report["scenes"])
    )
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
