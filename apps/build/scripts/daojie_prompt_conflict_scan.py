#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""道劫提示词冲突扫描器(任务 10-18-daojie-prompt-conflict-cleanup · D15/D16)。

规格:.trellis/tasks/10-18-daojie-prompt-conflict-cleanup/design.md §7
  - 默认作用域 = D16 管辖面白名单;--scope full 逃生口(恒排除 .trellis 与 apps/output)。
  - 命中归属分桶:按 design.md §2 所有权表内置映射;spec 指南命中归父 T5;
    --rules-only <C列表> 子任务门只计 P0/P1/P2/P3 所有权文件内的命中。
  - 历史区不计:「## 历史口径」标题至下一个同级/更高级标题之间;
    以及含「历史/仅供来源研究/旧口径/已废止」标注的行不计。
  - 行级白名单:已知台账/日期锚/迁移叙述行,逐条带理由;规则误报靠白名单行,不靠放宽正则。
    稳健模式:机器槽名(九型WIDTH/九型HEIGHT 等 API 输入名)与历史/台账/日期锚行按
    **内容正则**识别(勿依赖易漂移行号);现行口径散文一行不得进白名单。
  - 输出:现行区命中列表(file:line:rule)+ 汇总;--json;exit 0=零命中,exit 2=有命中
    (--rules-only 时 exit 2 仅由子任务所有权命中触发);exit 1=用法错误。
  - --tag <任意串>:仅用于输出标注,不改变行为。

用法:
  python3 apps/build/scripts/daojie_prompt_conflict_scan.py [--json] [--rules-only C20,C38]
      [--scope default|full] [--tag TAG] [--root DIR] [PATHS ...]
  PATHS 为显式文件/目录(测试与摸底用),给出时绕过作用域选择,其余规则照常生效。
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

M_DIR = "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng"

# ---------------------------------------------------------------- 作用域(D16)

DEFAULT_SCOPE_GLOBS = [
    f"{M_DIR}/**",
    "docs/prompts/道劫_*.md",
    "docs/prompts/Qwen-Image-2.1/05-*.md",
    "docs/prompts/Qwen-Image-2.1/07-*.md",
    "apps/frontend/lib/studio/daojie-manual-contract.test.ts",
    "apps/frontend/lib/studio/visual-manual-style-tokens*",
    "apps/frontend/lib/ai/daojie-prompt-contract*",
    ".trellis/spec/guides/daojie-manual-code-contract-guide.md",
]

TEXT_SUFFIXES = {".md", ".json", ".ts", ".js", ".txt"}

# 任何走盘遍历都恒剪枝的目录(不在任何作用域内;与 D16 无冲突)。
ALWAYS_PRUNE_DIRS = {".git", "node_modules", ".zcode", "__pycache__", ".DS_Store"}
# D16:apps/output 默认作用域与 full 逃生口都排除;.trellis 仅 full 排除
# (默认作用域白名单显式含 spec 指南一件)。
BOTH_SCOPES_EXCLUDE_PREFIXES = ("apps/output/",)
FULL_EXCLUDE_PREFIXES = (".trellis/",)


def in_default_scope(rel_posix: str) -> bool:
    return any(fnmatch.fnmatch(rel_posix, g) for g in DEFAULT_SCOPE_GLOBS)


# ------------------------------------------------------------ 规则表(§7 首版)

RULES = [
    {
        "id": "anime_neg",
        "c_ids": ["C01", "C03", "C05"],
        "regex": r"anime style|cel shading|cel-shaded|no cartoon",
        "files": "**",
        "note": "负向语境禁动画/赛璐璐词族(C01 分镜帧负向注入、C03 导演模板、C05 反向规避)",
    },
    {
        "id": "ink_line",
        "c_ids": ["C20"],
        "regex": r"浓墨或焦墨",
        "files": "**",
        "note": "墨线旧口径(C20)",
    },
    {
        "id": "no_color_line",
        "c_ids": ["C20"],
        "regex": r"禁止彩色线条|禁彩色线条",
        "files": "**",
        "note": "禁彩色线条旧禁项(C20)",
    },
    {
        "id": "gongbi_unified",
        "c_ids": ["C21"],
        "regex": r"工笔重彩国风画法|以丰富多彩的工笔重彩为主",
        "files": "**",
        "note": "工笔重彩仍作统一画法(C21)",
    },
    {
        "id": "low_contrast",
        "c_ids": ["C22"],
        "regex": r"低对比",
        "files": "**",
        "note": "低对比基线语境(C22;非基线语境误报走行级白名单)",
    },
    {
        "id": "likbai_first",
        "c_ids": ["C23"],
        "regex": r"留白是一级",
        "files": "**",
        "note": "留白一级条件全局铁律(C23)",
    },
    {
        "id": "multiview_quad",
        "c_ids": ["C10", "C30"],
        "regex": r"1:1\s*四区|1632",
        "files": "**",
        "note": "多视图 1:1 四区/1632 旧口径(C10 真源、C30 文档)",
    },
    {
        "id": "ink_wash",
        "c_ids": ["C02"],
        "regex": r"ink wash",
        "files": "**",
        "note": "正向英文 token 旧水墨口径(C02)",
    },
    {
        "id": "yuanjing_danmo",
        "c_ids": ["C24"],
        "regex": r"远景淡墨晕染",
        "files": "**",
        "note": "远景淡墨晕染被写为必须(C24)",
    },
    {
        "id": "zhimian_touqi",
        "c_ids": ["C26"],
        "regex": r"纸面透气",
        "files": "**",
        "note": "纸面透气旧职责句(C26)",
    },
    {
        "id": "nine_types",
        "c_ids": ["C38"],
        "regex": r"九型",
        "files": "**",
        "note": "型数「九型」残留(C38:仅现行口径指称行报,历史叙述/台账/日期锚行入行级白名单)",
    },
]

# ------------------------------------------- 命中归属(§2 所有权表内置映射)

SUBGRAPH_GLOB = "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图*.json"
T2I_DIR = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图"

OWNERSHIP = [
    ("P0", f"{M_DIR}/art_prompt/art_storyboard_video.md"),
    ("P0", f"{M_DIR}/ma_sync/lock-anchors.json"),
    ("P0", f"{M_DIR}/ma_sync/LOCK_SNAPSHOT.md"),
    ("P0", "apps/frontend/lib/studio/daojie-manual-contract.test.ts"),
    ("P1", f"{M_DIR}/json/qi21_bases.json"),
    ("P1", f"{T2I_DIR}/qi21-道劫-t2i.json"),
    ("P1", f"{T2I_DIR}/qwen21-道劫-t2i-api.json"),
    ("P1", SUBGRAPH_GLOB),
    ("P1", "apps/backend/engines/comfyui/my_nodes/tests/*"),
    ("P1", "apps/backend/engines/comfyui/tests/test_qwen21_workflow_contract.py"),
    ("P1", "apps/frontend/lib/ai/daojie-prompt-contract.test.ts"),
    ("P1", "apps/build/scripts/qi21_conflict_snapshot_sync.py"),
    ("P2", f"{M_DIR}/prefix.md"),
    ("P2", f"{M_DIR}/README.md"),
    ("P2", f"{M_DIR}/style_guide/*.md"),
    ("P2", f"{M_DIR}/art_prompt/art_character.md"),
    ("P2", f"{M_DIR}/art_prompt/art_scene.md"),
    ("P2", f"{M_DIR}/art_prompt/art_scene_derivative.md"),
    ("P2", f"{M_DIR}/driector_skills/*.md"),
    ("P2", f"{M_DIR}/json/prompt_layering.json"),
    ("P2", f"{M_DIR}/json/daojie_lora_stack.json"),
    ("P2", f"{M_DIR}/json/README.md"),
    ("P2", f"{M_DIR}/ma_sync/runtime-contract.json"),
    ("P3", f"{M_DIR}/art_prompt/art_subject_ten_types.md"),
    ("P3", "docs/prompts/道劫_类型主体句示例.md"),
    ("P3", "docs/prompts/道劫_类型配方.md"),
    ("P3", "docs/prompts/Qwen-Image-2.1/07-主体句写作宪法.md"),
    ("P3", "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"),
    # design §7:「.trellis/spec/guides/* 归父 T5」
    ("T5", ".trellis/spec/guides/*"),
]

CHILD_BUCKETS = {"P0", "P1", "P2", "P3"}


def owner_of(rel_posix: str) -> str:
    for bucket, pattern in OWNERSHIP:
        if fnmatch.fnmatch(rel_posix, pattern):
            return bucket
    # §2 表外文件(visual-manual-style-tokens*.ts 源码、art_character_derivative.md 等)
    # 与一切未映射命中:归父(T5)桶——子任务门不计,默认/全量门照报。
    return "T5"


# ------------------------------------------------ 行级白名单(误报/台账/日期锚)
# 依据:research/audit-1018-conflicts.md C38 增补节 + L1 基线点验(Step 5)。
# 误报一律加白名单行,不放宽正则。
#
# 稳健模式(L1 收口,P1 手术员上报):对机器槽名与历史/台账/日期锚行用
# **内容正则**识别(勿依赖易漂移的行号);现行口径散文一行不得进白名单。

LINE_WHITELIST: dict[str, dict[int, str]] = {
    f"{M_DIR}/README.md": {
        27: "C38 日期锚历史句(2026-09-19 九型配方任务落地;audit C38 白名单)",
    },
    f"{M_DIR}/style_guide/07_九型配方.md": {
        66: "C38 实弹台账路径(audit C38 白名单)",
        67: "C38 实弹台账路径(audit C38 白名单)",
    },
    f"{M_DIR}/json/README.md": {
        42: "C38 「九型→十型」迁移叙述(audit C38 白名单)",
    },
    f"{M_DIR}/ma_sync/LOCK_SNAPSHOT.md": {
        24: "C38 1017 快照台账行(audit C38 白名单,不改写)",
        25: "C38 1017 快照台账行(audit C38 白名单,不改写)",
        26: "C38 1017 快照台账行(audit C38 白名单,不改写)",
        27: "C38 1017 快照台账行(audit C38 白名单,不改写)",
    },
    # ---- L1 基线点验(Step 5)追加的明确误报,逐条带理由:
    f"{M_DIR}/style_guide/00_总纲.md": {
        152: "C22 误报:现行裁定行的否定语境(「不以淡墨淡彩和低对比作为全局要求」),非低对比基线条款",
    },
    "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md": {
        17: "C22 误报:09-23 美化版台账行,括注引用《三国望神州》v2.2 词汇表,非本库现行条款",
    },
}

# 行级白名单·稳健模式:globs=None 表示全局;regex 命中即整行不计。
# 依据:P1 手术员上报(paths 门 8 所有权文件残留 38 命中不可由 P1 修)+
# L1 逐行复核原文(契约测试 22 行 + 预填图 16 行 + api 2 行,全部对上)。
LINE_WHITELIST_PATTERNS = [
    {
        "globs": None,  # 全局:机器标识符(大写 ASCII 后缀)无现行散文误伤面
        "regex": r"九型WIDTH|九型HEIGHT",
        "reason": "机器槽名:MyQi21WhSuggest 节点 API 输入名"
                  "(my_nodes/nodes/my_qi21_wh_suggest.py INPUT_TYPES/入参,my_qi21_api_pe.py tooltip 同引用;"
                  "预填图与契约测试按槽名接线)。改名=连线/参数变更被 D4 禁止,节点源码不在子任务所有权;"
                  "如需改名须另开任务(节点源码+三图+契约测试四点联动)",
    },
    {
        "globs": (
            "apps/backend/engines/comfyui/tests/*",
            "apps/backend/engines/comfyui/my_nodes/tests/*",
        ),
        "regex": r"九型 ?W/H|九型W←|九型H←|九型宽高",
        "reason": "九型WIDTH/HEIGHT 槽名简称的接线/画幅直通叙述(机器槽名语境,非型数指称)",
    },
    {
        "globs": (
            "apps/backend/engines/comfyui/tests/*",
            "apps/backend/engines/comfyui/my_nodes/tests/*",
        ),
        "regex": (
            r"DNA:ink wash|旧 pro 件|九型底座常量|九型装配移植|子图收窄=九型|契约同步三笔"
            r"|九型→十型|三态件退役|恒九型|低对比色面→|for token in .*九型"
        ),
        "reason": "历史/台账/日期锚叙述行:docstring 沿革、1015 九型→十型迁移台账"
                  "(同类=已白名单 json/README.md:42)、锚随源改名履历(低对比色面→色彩分明)、"
                  "[4100] 说明卡 token 钉(说明卡非提示词字符串叶子,不在 D4 换血域)",
    },
    {
        # 整件历史口径文档(1018 战役终盘裁定):三件均自带时效头注且均先于 1018 底座转档——
        # LoRA逻辑图解=[2026-10-10 注]K2/Krea2 线休眠、全文按历史口径阅读;
        # 底座节点_0918=[1016 Qwen 使用边界]+[1004 身份勘正「本篇=K2 侧历史记录,勿据本篇改数值」];
        # 角色设定表_0919=[1016 Qwen 使用边界]+[1010 结构注「双性文档,所指 K2 链休眠,后半按历史口径阅读」]。
        # D3 规则3:已带历史标注的段落不改写;命中行为历史叙述与 LoRA 功能触发短语
        # (monochrome ink wash style 等),非现行口径散文。
        "globs": (
            "docs/prompts/道劫_LoRA逻辑图解.md",
            "docs/prompts/道劫_底座节点_0918.md",
            "docs/prompts/道劫_角色设定表出图逻辑_0919.md",
        ),
        "regex": r"九型|ink wash",
        "reason": "整件历史口径(K2/Krea2 线休眠,头注自注历史阅读,1018 前档):"
                  "D3 规则3 不改写;LoRA 触发词短语属功能标识",
    },
]

LINE_WHITELIST_PATTERNS_COMPILED = [
    {**entry, "re": re.compile(entry["regex"])} for entry in LINE_WHITELIST_PATTERNS
]


def line_pattern_whitelisted(rel_posix: str, raw: str) -> bool:
    """稳健模式白名单:globs=None 全局生效,否则按仓库相对路径 glob 圈定。"""
    for pattern in LINE_WHITELIST_PATTERNS_COMPILED:
        globs = pattern["globs"]
        if globs is not None and not any(
            fnmatch.fnmatch(rel_posix, g) for g in globs
        ):
            continue
        if pattern["re"].search(raw):
            return True
    return False

# ------------------------------------------------------------ 历史区识别(§7)

ANNOTATION_MARKERS = ("历史", "仅供来源研究", "旧口径", "已废止")

_HEADING_RE = re.compile(r"^(#{1,6})\s*(.*?)\s*$")


def scan_text(rel_posix: str, text: str, rules: list[dict]) -> list[dict]:
    """逐行扫描一个文本:历史小节/标注行/行级白名单不计,其余按规则表报命中。

    历史小节 = 标题文本以「历史口径」开头的小节,至下一个同级或更高级标题为止。
    """
    hits: list[dict] = []
    history_level: int | None = None  # 开放中的历史小节标题层级
    for lineno, raw in enumerate(text.splitlines(), start=1):
        stripped = raw.strip()
        heading = _HEADING_RE.match(stripped)
        if heading:
            level, title = len(heading.group(1)), heading.group(2)
            if history_level is not None and level <= history_level:
                history_level = None
            if title.startswith("历史口径"):
                history_level = level
                continue  # 历史小节标题行本身不计
        if history_level is not None:
            continue  # 历史小节内不计
        if any(marker in raw for marker in ANNOTATION_MARKERS):
            continue  # 标注行不计
        wl = LINE_WHITELIST.get(rel_posix)
        if wl and lineno in wl:
            continue  # 行级白名单(行号锚)不计
        if line_pattern_whitelisted(rel_posix, raw):
            continue  # 行级白名单(稳健模式:槽名/台账行内容正则)不计
        for rule in rules:
            if re.search(rule["regex"], raw):
                hits.append(
                    {
                        "file": rel_posix,
                        "line": lineno,
                        "rule": rule["id"],
                        "c_ids": list(rule["c_ids"]),
                        "owner": owner_of(rel_posix),
                        "text": raw.strip()[:160],
                    }
                )
    return hits


def collect_files(root: Path, scope: str, explicit: list[str]) -> list[Path]:
    if explicit:
        files: list[Path] = []
        for p in explicit:
            path = Path(p)
            if path.is_dir():
                files.extend(
                    f for f in sorted(path.rglob("*")) if f.is_file() and f.suffix in TEXT_SUFFIXES
                )
            elif path.is_file():
                files.append(path)
            else:
                raise SystemExit(f"[scan] 路径不存在: {p}")
        return files

    files = []
    for dirpath, dirnames, filenames in Path(root).walk():
        rel_dir = Path(dirpath).relative_to(root).as_posix()

        def _rel(name: str) -> str:
            return name if rel_dir == "." else f"{rel_dir}/{name}"

        excluded = BOTH_SCOPES_EXCLUDE_PREFIXES
        if scope == "full":
            excluded = excluded + FULL_EXCLUDE_PREFIXES
        dirnames[:] = sorted(
            d
            for d in dirnames
            if d not in ALWAYS_PRUNE_DIRS and not _rel(d).startswith(excluded)
        )
        for name in sorted(filenames):
            rel = _rel(name)
            if rel.startswith(excluded):
                continue
            if scope != "full" and not in_default_scope(rel):
                continue
            if Path(dirpath, name).suffix in TEXT_SUFFIXES:
                files.append(Path(dirpath, name))
    return files


def normalize_c_token(token: str) -> str:
    token = token.strip().upper()
    if not token:
        raise ValueError("空 C 编号")
    if not token.startswith("C"):
        token = "C" + token
    if not re.fullmatch(r"C\d+", token):
        raise ValueError(f"非法 C 编号: {token!r}")
    return f"C{int(token[1:]):02d}"


def parse_rules_only(arg: str) -> list[str]:
    tokens = [normalize_c_token(t) for t in re.split(r"[,\s]+", arg.strip()) if t]
    if not tokens:
        raise ValueError("--rules-only 不能为空")
    known = {c for rule in RULES for c in rule["c_ids"]}
    unknown = [t for t in tokens if t not in known]
    if unknown:
        raise ValueError(f"未知 C 编号(规则表首版无此编号): {', '.join(unknown)}")
    return tokens


def build_report(root: Path, scope_label: str, files: list[Path], hits: list[dict],
                 rules_only: list[str] | None, tag: str | None) -> dict:
    by_owner: dict[str, int] = {}
    by_rule: dict[str, int] = {}
    by_c: dict[str, int] = {}
    for h in hits:
        by_owner[h["owner"]] = by_owner.get(h["owner"], 0) + 1
        by_rule[h["rule"]] = by_rule.get(h["rule"], 0) + 1
        for c in h["c_ids"]:
            by_c[c] = by_c.get(c, 0) + 1
    gate_counted = sum(1 for h in hits if h["owner"] in CHILD_BUCKETS) if rules_only else None
    summary = {
        "total": len(hits),
        "by_owner": dict(sorted(by_owner.items())),
        "by_rule": dict(sorted(by_rule.items())),
        "by_c": dict(sorted(by_c.items())),
        "files_scanned": len(files),
    }
    if rules_only:
        summary["gate_counted_child_owned"] = gate_counted
        summary["gate_excluded_parent_owned"] = len(hits) - gate_counted
    return {
        "meta": {
            "tool": "daojie_prompt_conflict_scan.py",
            "spec": ".trellis/tasks/10-18-daojie-prompt-conflict-cleanup/design.md §7",
            "scope": scope_label,
            "root": str(root),
            "rules_only": rules_only,
            "tag": tag,
        },
        "summary": summary,
        "hits": sorted(hits, key=lambda h: (h["file"], h["line"], h["rule"])),
    }


def print_text(report: dict) -> None:
    meta, summary = report["meta"], report["summary"]
    bits = [f"[daojie-prompt-conflict-scan] scope={meta['scope']} files={summary['files_scanned']}"]
    if meta.get("tag"):
        bits.append(f"tag={meta['tag']}")
    if meta.get("rules_only"):
        bits.append(f"rules_only={','.join(meta['rules_only'])}")
    print(" ".join(bits))
    for h in report["hits"]:
        print(f"{h['file']}:{h['line']}:{h['rule']} [{'|'.join(h['c_ids'])}] owner={h['owner']}")
        print(f"    {h['text']}")
    print(f"汇总: hits={summary['total']} by_owner={summary['by_owner']} by_rule={summary['by_rule']}")
    if meta.get("rules_only"):
        print(
            f"子任务门(rules_only): counted={summary['gate_counted_child_owned']} "
            f"excluded_parent={summary['gate_excluded_parent_owned']}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="道劫提示词冲突扫描器(design.md §7 / D15/D16)")
    parser.add_argument("--json", action="store_true", help="JSON 输出")
    parser.add_argument("--rules-only", dest="rules_only", default=None,
                        help="只计指定 C 编号规则(逗号分隔)且仅计 P0/P1/P2/P3 所有权文件命中")
    parser.add_argument("--scope", choices=["default", "full"], default="default",
                        help="default=D16 管辖面白名单;full=逃生口(恒排除 .trellis 与 apps/output)")
    parser.add_argument("--tag", default=None, help="输出标注旗标,不改变行为")
    parser.add_argument("--root", default=None, help="仓库根(默认:脚本所在仓库)")
    parser.add_argument("paths", nargs="*", help="显式文件/目录(测试与摸底);给出则绕过作用域选择")
    args = parser.parse_args(argv)

    rules_only: list[str] | None = None
    if args.rules_only is not None:
        try:
            rules_only = parse_rules_only(args.rules_only)
        except ValueError as exc:
            print(f"[scan] 用法错误: {exc}", file=sys.stderr)
            return 1

    root = Path(args.root).resolve() if args.root else REPO_ROOT
    active_rules = (
        [r for r in RULES if rules_only and set(r["c_ids"]) & set(rules_only)]
        if rules_only
        else RULES
    )

    try:
        files = collect_files(root, args.scope, args.paths)
    except SystemExit as exc:
        print(f"[scan] {exc}", file=sys.stderr)
        return 1

    hits: list[dict] = []
    for path in files:
        try:
            resolved = path.resolve()
            rel = resolved.relative_to(root).as_posix()
        except ValueError:
            rel = str(path)
        text = path.read_text(encoding="utf-8", errors="replace")
        hits.extend(scan_text(rel, text, active_rules))

    scope_label = "paths" if args.paths else args.scope
    report = build_report(root, scope_label, files, hits, rules_only, args.tag)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_text(report)

    if rules_only:
        return 2 if report["summary"]["gate_counted_child_owned"] > 0 else 0
    return 2 if report["summary"]["total"] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
