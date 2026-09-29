#!/usr/bin/env python3
"""Precheck chapter-001 keyframe mobility(提案三「静图可动性预检」,advisory).

五维检查(提案三 :92-94;以词表+元数据可判据落地,机检判不了的维度如实标
「需人工」,不硬造语义判据):
1. 天然可动元素:发丝/衣摆/水面/烟火/旗幡类词表命中(提案原文五例+同类
   自驱元素);
2. 景深层次:前景/中景/背景/纵深类词表——命中=描述有层次证据,未命中=需人工;
3. 遮挡关系:语义维度机检不动,恒标需人工;文本命中(遮挡/交叠类)仅登记证据;
4. 动作空间:贴边/截断类判据命中=受限;无人物镜(personFree)=不适用;
   人物镜无命中=文本无法证运动余量→需人工;
5. 脆弱元素锁定:文字/边框/版式类词表命中=必须先锁定;锁定与否无法从元数据
   机检→需人工。

三态裁定(提案三 :96):可动 / 仅微动(只配环境痕迹级运动)/ 不动——
「不动」也是合法答案,书面理由必附词表零命中扫描证据,非默认值;静图保持
静止本身就是一种交付。

铁律(工单约束②):预检 advisory 不拦不删——本模块零改写输入、零删除、
零阻断;退出码只是信号:0=全部可动,1=存在仅微动/不动待人工确认(advisory),
2=输入错误。接线方(automate-chapter001-video.mjs 开关位)对非零退出只登记
不拦链。

输入:分镜 store 的关键帧元数据+逐镜语义/描述。读取惯例参照 chapter_video
兄弟脚本:store 行形态=build_chapter001_workflow.parse_storyboard_table
(:2697-2798)的 15/14 列行(desc/action/sound/assets/shotSemantics…);
最新 storyboardTable 工件过滤镜像 latest_storyboard_work(:2567-2580);
生成器模块按文件路径只读加载镜像 generate_chapter001_continuity_sample.py
:40-46 load_generator(不改该文件)。已知边界:像素级可动性判据不在
python 机检范围(需人工);词表扫描是保守证据,人可改判。

报告落盘:apps/output/automation/precheck-chapter001-keyframe-mobility-report.json
(落盘先例=generate_chapter001_continuity_sample.py:33 apps/output/automation/)。

出处:docs/research/PIPELINE_METHODS_ABSORPTION_ANALYSIS_2026-09-28.md:84-114
(提案三「是什么」/「落点提案」/「验收口径」python 可达部分:入队前每镜留
三态裁定与五维检查记录、「不动」有书面理由)。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Callable

REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATOR_PATH = REPO_ROOT / "apps/build/chapter_video/build_chapter001_workflow.py"
DEFAULT_REPORT_PATH = (
    REPO_ROOT / "apps/output/automation/precheck-chapter001-keyframe-mobility-report.json"
)
DEFAULT_EPISODE_ID = "chapter-001"

# 天然可动元素:提案三五例(发丝/衣摆/水面/烟火/旗幡)+同类「自己会动」元素。
NATURAL_MOVABLE_HINTS = [
    "发丝", "长发", "衣摆", "衣袖", "裙摆", "披风",
    "水面", "波纹", "涟漪",
    "烟火", "火焰", "烛火", "灯火",
    "旗幡", "旌旗", "旗帜",
    "雾", "烟", "云", "雨", "落雪", "飞雪", "风沙", "落叶",
]
# 景深层次证据词(描述里提及层次/纵深)。
DEPTH_HINTS = ["前景", "中景", "背景", "远景", "纵深", "层次"]
# 遮挡关系提及词(只登记证据;判定恒归人工)。
OCCLUSION_MENTION_HINTS = ["遮挡", "交叠", "重叠", "遮住", "挡住"]
# 动作空间受限判据(提案三 :93 肢体被构图卡死——贴边、截断)。
ACTION_CONSTRAINT_HINTS = ["贴边", "截断", "卡边", "半身", "局部出画", "肢体出画"]
# 脆弱元素(提案三 :94 画面内文字、边框、版式类必须先锁定)。
FRAGILE_HINTS = ["文字", "题字", "匾额", "招牌", "字迹", "边框", "画框", "版式", "字幕", "书法", "碑文", "告示"]

VERDICT_LABELS = {"movable": "可动", "microMotionOnly": "仅微动", "static": "不动"}
SCANNED_FIELDS = [
    "desc", "action", "sound", "assets",
    "shotSemantics.actionIn", "shotSemantics.actionOut",
    "shotSemantics.visibleCharacters(position/orientation/actionIn/actionOut)",
    "shotSemantics.visibleProps(name/state)",
]


def _scan_hints(text: str, hints: list[str]) -> list[str]:
    """词表扫描:按 hints 顺序返回命中的词(去重保序)。"""
    return [hint for hint in hints if hint in text]


def _row_scan_text(row: dict[str, Any]) -> str:
    """把一镜的语义/描述字段拼成扫描文本(只读拼接,零改写)。"""
    parts: list[str] = [
        str(row.get("desc") or ""),
        str(row.get("action") or ""),
        str(row.get("sound") or ""),
        " ".join(str(item) for item in row.get("assets") or []),
    ]
    semantics = row.get("shotSemantics")
    if isinstance(semantics, dict):
        parts.append(str(semantics.get("actionIn") or ""))
        parts.append(str(semantics.get("actionOut") or ""))
        for character in semantics.get("visibleCharacters") or []:
            if isinstance(character, dict):
                parts.append(" ".join(str(character.get(key) or "") for key in ("name", "position", "orientation", "actionIn", "actionOut")))
        for prop in semantics.get("visibleProps") or []:
            if isinstance(prop, dict):
                parts.append(" ".join(str(prop.get(key) or "") for key in ("name", "position", "state")))
    return " ".join(part for part in parts if part)


def _has_person(row: dict[str, Any]) -> bool:
    semantics = row.get("shotSemantics")
    if not isinstance(semantics, dict):
        return True  # 语义缺失时按有人镜保守处理(动作空间转需人工)
    if semantics.get("personFree") is True:
        return False
    return bool(semantics.get("visibleCharacters"))


def check_dimensions(row: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """五维检查:每维返回 {status, 命中证据, needsHuman};机检不动的如实标需人工。"""
    text = _row_scan_text(row)
    movable_matched = _scan_hints(text, NATURAL_MOVABLE_HINTS)
    depth_matched = _scan_hints(text, DEPTH_HINTS)
    occlusion_mentions = _scan_hints(text, OCCLUSION_MENTION_HINTS)
    constraint_matched = _scan_hints(text, ACTION_CONSTRAINT_HINTS)
    fragile_matched = _scan_hints(text, FRAGILE_HINTS)

    if not _has_person(row):
        action_space = {
            "status": "notApplicable",
            "matched": [],
            "needsHuman": False,
            "reason": "无人物镜(personFree),无肢体动作空间问题",
        }
    elif constraint_matched:
        action_space = {
            "status": "constrained",
            "matched": constraint_matched,
            "needsHuman": False,
            "reason": "肢体贴边/截断类判据命中,构图卡死运动余量",
        }
    else:
        action_space = {
            "status": "needsHuman",
            "matched": [],
            "needsHuman": True,
            "reason": "人物镜但无受限判据命中,文本元数据无法证实肢体运动余量",
        }

    if fragile_matched:
        fragile = {
            "status": "present",
            "matched": fragile_matched,
            "lockVerified": None,
            "needsHuman": True,
            "reason": "脆弱元素(文字/边框/版式类)必须先锁定;锁定与否无法从元数据机检",
        }
    else:
        fragile = {"status": "none", "matched": [], "lockVerified": None, "needsHuman": False}

    return {
        "naturalMovable": {
            "status": "hit" if movable_matched else "none",
            "matched": movable_matched,
            "scannedFields": list(SCANNED_FIELDS),
            "needsHuman": False,
        },
        "depthLayers": {
            "status": "hit" if depth_matched else "none",
            "matched": depth_matched,
            "needsHuman": not depth_matched,
            "reason": None if depth_matched else "描述无前景/背景/纵深证据,层次是否支撑纵深运动需人工判",
        },
        "occlusion": {
            "status": "needsHuman",
            "mentions": occlusion_mentions,
            "needsHuman": True,
            "reason": "遮挡关系是语义维度,机检不动;文本命中仅登记证据(提案三 :93)",
        },
        "actionSpace": action_space,
        "fragileElements": fragile,
    }


def judge_verdict(dimensions: dict[str, dict[str, Any]]) -> tuple[str, str, list[str]]:
    """三态裁定+书面理由。返回 (verdict, writtenReason, humanReviewDimensions)。

    可动=有天然可动元素证据且无脆弱未锁定/动作空间受限;
    仅微动=有运动证据但受限(脆弱元素未锁定验证/肢体空间受限)→只配环境痕迹级运动;
    不动=天然可动元素词表零命中——书面理由必附扫描证据,非默认值。
    """
    constrained_reasons: list[str] = []
    if dimensions["actionSpace"]["status"] == "constrained":
        constrained_reasons.append(
            f"动作空间受限({'、'.join(dimensions['actionSpace']['matched'])})"
        )
    if dimensions["fragileElements"]["status"] == "present":
        constrained_reasons.append(
            f"脆弱元素未锁定验证({'、'.join(dimensions['fragileElements']['matched'])})"
        )
    movable_matched = dimensions["naturalMovable"]["matched"]
    human_dimensions = sorted(
        name for name, dim in dimensions.items() if dim.get("needsHuman")
    )

    if movable_matched and not constrained_reasons:
        verdict = "movable"
        reason = (
            f"天然可动元素命中({'、'.join(movable_matched)});"
            "无脆弱元素未锁定与动作空间受限证据"
        )
    elif movable_matched and constrained_reasons:
        verdict = "microMotionOnly"
        reason = (
            f"有运动证据({'、'.join(movable_matched)})但{'与'.join(constrained_reasons)}"
            "——只配环境痕迹级运动"
        )
    else:
        verdict = "static"
        reason = (
            "天然可动元素词表零命中(扫描:"
            + "+".join(SCANNED_FIELDS[:4])
            + f"等,词表={len(NATURAL_MOVABLE_HINTS)}词);按词表证据暂判不动——"
            "静图保持静止本身是一种交付(提案三 :96)"
        )
    if human_dimensions:
        reason += ";待人工复核维度:" + "、".join(human_dimensions)
    return verdict, reason, human_dimensions


def precheck_keyframe_mobility(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """对逐镜关键帧元数据跑五维检查+三态裁定,返回只读报告(零改写输入)。"""
    records: list[dict[str, Any]] = []
    counts = {"movable": 0, "microMotionOnly": 0, "static": 0}
    total = 0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        total += 1
        dimensions = check_dimensions(row)
        verdict, reason, human_dimensions = judge_verdict(dimensions)
        counts[verdict] += 1
        records.append(
            {
                "index": row.get("index"),
                "sceneNo": row.get("sceneNo"),
                "verdict": verdict,
                "verdictLabel": VERDICT_LABELS[verdict],
                "writtenReason": reason,
                "needsHumanReview": bool(human_dimensions),
                "humanReviewDimensions": human_dimensions,
                "dimensions": dimensions,
            }
        )
    return {
        "tool": "precheck_chapter001_keyframe_mobility",
        "advisory": True,
        "shots": total,
        "verdictCounts": counts,
        "records": records,
        "sourceOfTruth": {
            "proposal": "docs/research/PIPELINE_METHODS_ABSORPTION_ANALYSIS_2026-09-28.md:84-114 提案三",
            "advisory": "预检 advisory 不拦不删(非阻断报告);三态裁定是词表+元数据证据的机检建议,人可改判",
            "naturalMovableWords": "天然可动元素词表=提案三五例(发丝/衣摆/水面/烟火/旗幡)+同类自驱元素",
            "actionSpaceRule": "动作空间判据=贴边/截断类词表命中;人物镜无命中时无法从文本证运动余量→需人工",
            "occlusionRule": "遮挡关系为语义维度,机检不动,恒标需人工(命中提及仅作证据登记)",
            "fragileRule": "脆弱元素(文字/边框/版式类)命中即须先锁定;锁定与否无法从元数据机检→需人工",
            "staticRule": "不动=天然可动元素词表零命中;书面理由必附扫描证据,非默认值;静图保持静止本身是一种交付",
            "keyframeMetadataScope": "关键帧元数据=store 分镜表行(desc/action/sound/assets/出镜语义);像素级可动性不在 python 机检范围",
            "exitCodes": "0=全部可动;1=存在仅微动/不动待人工确认(advisory);2=输入错误",
        },
    }


def latest_storyboard_markdown(state: dict[str, Any], episode_id: str = DEFAULT_EPISODE_ID) -> str | None:
    """取最新 storyboardTable 工件正文(镜像 latest_storyboard_work 契约,
    build_chapter001_workflow.py:2567-2580:key+episodeId+非空 data 过滤,
    updatedAt/createdAt/id 排序取最新)。"""
    works = [
        work
        for work in state.get("agentWorkData", [])
        if work.get("key") == "storyboardTable"
        and work.get("episodeId") == episode_id
        and isinstance(work.get("data"), str)
        and work.get("data", "").strip()
    ]
    if not works:
        return None
    return sorted(
        works,
        key=lambda work: (
            work.get("updatedAt", 0) or 0,
            work.get("createdAt", 0) or 0,
            str(work.get("id") or ""),
        ),
    )[-1]["data"]


def load_workflow_module() -> Any:
    """按文件路径只读加载生成器模块(镜像 generate_chapter001_continuity_sample.py
    :40-46 load_generator;不改该文件)。重依赖(numpy/PIL/本地故事档案),
    只在需要解析真实 store 表时加载。"""
    spec = importlib.util.spec_from_file_location("chapter001_workflow", GENERATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载生成器: {GENERATOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rows_from_state(
    state: dict[str, Any],
    episode_id: str = DEFAULT_EPISODE_ID,
    parse_rows: Callable[..., list[dict[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    """从 store state 提取分镜行:最新 storyboardTable 正文→行解析。

    parse_rows 缺省只读复用生成器的 parse_storyboard_table
    (build_chapter001_workflow.py:2697-2798);可注入替身以便无档案环境测试。
    """
    markdown = latest_storyboard_markdown(state, episode_id)
    if markdown is None:
        raise RuntimeError(f"{episode_id} 的 store 中没有可用 storyboardTable 工件")
    if parse_rows is None:
        parse_rows = load_workflow_module().parse_storyboard_table
    return parse_rows(markdown, episode_id)


def _fail(message: str) -> int:
    print(f"输入错误: {message}", file=sys.stderr)
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "静图可动性预检(只读 advisory):五维检查+三态裁定(可动/仅微动/不动),"
            "「不动」必附书面理由;报告落 apps/output/automation/,不拦不删。"
        ),
    )
    parser.add_argument("--store", type=Path, default=None, help="studio-workflow-store.json 路径(缺省经生成器模块自解析)")
    parser.add_argument("--rows-json", type=Path, default=None, help="分镜行 JSON(裸数组或 {rows:[...]};测试/离线入口)")
    parser.add_argument("--output", type=Path, default=DEFAULT_REPORT_PATH, help="报告落盘路径")
    args = parser.parse_args(argv)

    source: dict[str, Any]
    if args.rows_json is not None:
        try:
            document = json.loads(args.rows_json.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            return _fail(f"无法读取 rows JSON({args.rows_json}): {exc}")
        rows = document.get("rows") if isinstance(document, dict) else document
        if not isinstance(rows, list):
            return _fail("rows JSON 根节点必须是数组或 {rows: [...]} 对象")
        source = {"kind": "rows-json", "path": str(args.rows_json)}
    else:
        store_path = args.store
        if store_path is None:
            try:
                store_path = load_workflow_module().STORE
            except (ImportError, OSError, RuntimeError, KeyError) as exc:
                return _fail(f"无法定位默认 store({exc});请显式传 --store 或 --rows-json")
        try:
            state = json.loads(Path(store_path).read_text(encoding="utf-8"))
            rows = rows_from_state(state)
        except (OSError, ValueError, RuntimeError) as exc:
            return _fail(f"无法从 store 提取分镜行({store_path}): {exc}")
        source = {"kind": "store", "path": str(store_path)}

    report = precheck_keyframe_mobility(rows)
    report["source"] = source
    report["reportPath"] = str(args.output)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    has_attention = report["verdictCounts"]["microMotionOnly"] > 0 or report["verdictCounts"]["static"] > 0
    return 1 if has_attention else 0


if __name__ == "__main__":
    raise SystemExit(main())
