#!/usr/bin/env python3
"""道劫主工作流注入「LoRA 逻辑图解」纯展示子图(09-20)。

背景:09-20 用户要求把 docs/prompts/道劫_LoRA逻辑图解_0920.md 的解说装进
K2-文生图-道劫.json 画布(子图形态;子图能力研究结论 supported=true)。
装机口径:ComfyUI 0.36.0 + 前端 comfyui-frontend-package 1.53.6,UI 工作流
顶层加 definitions.subgraphs[] + 主图放一个 type=子图UUID 的外层节点。
纯展示最稳形态=两侧接口全空 + 零连线 + widgets_values [](库内先例:
K2-无审查全家桶(4K放大+提示词增强).json sg[0] inputs=0、外层节点34
inputs=[];子图内 Note 实锤同文件 :6305)。

做法(幂等,重复运行零变化):
  1. 从解说 md 逐字提取 16 块(总述 + 14 件 + 矩阵),不改写不重述;
  2. 注入 definitions.subgraphs 一个定义(接口/连线全空,内部 16 张
     MarkdownNote 网格)+ 主图外层节点 id=91、mode=4——bypass 使仓库
     ui_to_api(daojie_livefire_0917.py:92-149)按旁路干净跳过 UUID 类型
     节点(mode=0 会对 UUID 类型走 oi[cls] 直接 KeyError,已实证);
  3. [90] 节点标题精简为「[90] LoRA栈·九型驱动(详解见「LoRA 逻辑图解」)」
     (09-20 用户裁定:commit-message 式长注撤走,信息已在图解里);
  4. 已是目标态(外层节点 + 子图定义 + 标题全部 deep-equal)则不写文件
     退出 0;同 UUID 内容不符则整体重写为规范态(自愈)。

外层节点摆位 [7240,280]×[420,320]:组②(LoRA 栈,bounding 右缘 x=7000)
右侧空旷区,不与任何顶层节点 AABB 相交(lint 遮挡判定只看顶层 nodes,
definitions 内部不可见——workflow_graph_lint.py:58-61)。

用法:python3 apps/build/scripts/daojie_lora_subgraph_0920.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]  # apps/build/scripts → 仓库根
WF_PATH = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
           / "K2-文生图-道劫.json")
DOC_PATH = REPO / "docs/prompts/道劫_LoRA逻辑图解_0920.md"

# ── 固定标识(幂等锚:UUID/节点id 均为字面量,重跑不变)──────────────
SUBGRAPH_ID = "5f2c8d9a-3e47-4b1c-9a6d-8e0f2b4c7d15"
SUBGRAPH_NAME = "LoRA 逻辑图解"
OUTER_NODE_ID = 91          # 现用 id 最大 90;91 空闲
OUTER_POS = [7240, 280]     # 组②(bounding [6440,240,560,1360])右侧空旷区
OUTER_SIZE = [420, 320]
TITLE_90 = "[90] LoRA栈·九型驱动(详解见「LoRA 逻辑图解」)"
EXPECTED_PIECES = 14        # 解说 md §二 的件数(防解析漂移的硬闸)

# ── 子图内部版式(独立 id 空间,坐标与主图无关)──────────────────────
# 总述一张横幅;14 件两列网格;矩阵一张宽表。inputNode/outputNode 是子图
# 虚拟边界件(不在 nodes 里),摆在内容外侧不压卡片。
_IN_INPUT_BOUNDING = [0, 40, 128, 48]
_IN_OUTPUT_BOUNDING = [1980, 40, 128, 88]
_SUMMARY_POS, _SUMMARY_SIZE = [200, 40], [1000, 240]
_GRID_COLS = [40, 700]      # 两列 x;列宽 620
_GRID_W, _GRID_H = 620, 260
_GRID_Y0, _GRID_DY = 400, 300
_MATRIX_POS, _MATRIX_SIZE = [40, 2620], [1880, 900]
_NOTE_COLOR, _NOTE_BGCOLOR = "#432", "#653"   # 同主图 [66] 用法速查卡配色


def _fail(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    raise SystemExit(2)


def parse_doc() -> tuple[str, list[dict[str, str]], str]:
    """解说 md → (总述块, 14 件块, 矩阵块),全部逐字取自 md 不改写。

    总述块 = 文首引言(>) + 「## 一、」整节;件块 = 「### 组名」+「**件名**」
    + 正文(组名行随件携带,块内三段皆 md 原文);矩阵块 = 「## 三、」至文末。
    """
    lines = DOC_PATH.read_text(encoding="utf-8").split("\n")

    def idx(prefix: str) -> int:
        for i, ln in enumerate(lines):
            if ln.startswith(prefix):
                return i
        _fail(f"解说 md 缺 {prefix!r} 节:{DOC_PATH}")

    i_quote = idx("> ")
    i_sec2, i_sec3 = idx("## 二、"), idx("## 三、")
    summary = "\n".join(lines[i_quote:i_sec2]).strip()
    if "## 一、" not in summary:
        _fail("总述块未包含「## 一、」节,md 结构与预期不符")

    pieces: list[dict[str, str]] = []
    group: str | None = None
    cur: dict[str, str] | None = None
    for ln in lines[i_sec2 + 1:i_sec3]:
        if ln.startswith("### "):
            group = ln[4:].strip()
        elif ln.startswith("**") and ln.rstrip().endswith("**") and group:
            if cur:
                pieces.append(cur)
            cur = {"group": group, "head": ln.rstrip(), "body": ""}
        elif cur is not None and ln.strip():
            cur["body"] = f"{cur['body']}\n{ln}".strip("\n")
    if cur:
        pieces.append(cur)
    if len(pieces) != EXPECTED_PIECES:
        _fail(f"件块解析得 {len(pieces)} 块,预期 {EXPECTED_PIECES}(md 结构漂移,拒写)")

    matrix = "\n".join(lines[i_sec3:]).strip("\n")
    if "数据单源:daojie_lora_stack.json" not in matrix:
        _fail("矩阵块未含数据单源尾行,md 结构与预期不符")
    return summary, pieces, matrix


def _note(nid: int, pos: list, size: list, text: str) -> dict:
    """子图内 MarkdownNote(字段形对照库内实锤:全家桶.json 子图内 Note :6305)。"""
    return {
        "id": nid, "type": "MarkdownNote", "pos": pos, "size": size,
        "flags": {}, "order": nid - 1, "mode": 0,
        "inputs": [], "outputs": [], "properties": {},
        "widgets_values": [text],
        "color": _NOTE_COLOR, "bgcolor": _NOTE_BGCOLOR,
    }


def build_subgraph(summary: str, pieces: list[dict[str, str]], matrix: str) -> dict:
    inner = [_note(1, _SUMMARY_POS, _SUMMARY_SIZE, summary)]
    for i, p in enumerate(pieces):  # 两列网格,行优先填格
        row, col = divmod(i, len(_GRID_COLS))
        pos = [_GRID_COLS[col], _GRID_Y0 + row * _GRID_DY]
        text = f"### {p['group']}\n\n{p['head']}\n\n{p['body']}"
        inner.append(_note(2 + i, pos, [_GRID_W, _GRID_H], text))
    inner.append(_note(2 + EXPECTED_PIECES, _MATRIX_POS, _MATRIX_SIZE, matrix))
    return {
        "id": SUBGRAPH_ID,
        "version": 1,
        "state": {"lastGroupId": 0, "lastNodeId": 2 + EXPECTED_PIECES,
                  "lastLinkId": 0, "lastRerouteId": 0},
        "revision": 0,
        "config": {},
        "name": SUBGRAPH_NAME,
        "inputNode": {"id": -10, "bounding": _IN_INPUT_BOUNDING},
        "outputNode": {"id": -20, "bounding": _IN_OUTPUT_BOUNDING},
        "inputs": [],           # 纯展示:两侧接口全空,绕开槽序映射/widget 提升
        "outputs": [],
        "widgets": [],
        "nodes": inner,
        "groups": [],
        "links": [],            # 子图内零连线(links 为对象形域,空数组即合规)
        "extra": {},
    }


def build_outer_node() -> dict:
    """主图侧引用子图的节点:type=子图UUID;mode=4 让 ui_to_api 旁路跳过。"""
    return {
        "id": OUTER_NODE_ID, "type": SUBGRAPH_ID,
        "pos": OUTER_POS, "size": OUTER_SIZE,
        "flags": {}, "order": 28, "mode": 4,
        "inputs": [], "outputs": [], "widgets_values": [],
        "title": f"{SUBGRAPH_NAME}(纯展示·双击进入)",
        "properties": {},
        "color": _NOTE_COLOR, "bgcolor": _NOTE_BGCOLOR,
    }


def main() -> int:
    summary, pieces, matrix = parse_doc()
    want_sg = build_subgraph(summary, pieces, matrix)
    want_outer = build_outer_node()

    wf = json.loads(WF_PATH.read_text(encoding="utf-8"))
    defs = wf.setdefault("definitions", {}).setdefault("subgraphs", [])

    # ── 幂等判定:目标态三件套全部 deep-equal 则零改动退出 ──────────
    have_sg = next((s for s in defs if s.get("id") == SUBGRAPH_ID), None)
    have_outer = next((n for n in wf["nodes"] if n.get("id") == OUTER_NODE_ID), None)
    title90 = next((n.get("title") for n in wf["nodes"] if n.get("id") == 90), None)
    if (have_sg == want_sg and have_outer == want_outer
            and title90 == TITLE_90 and wf.get("last_node_id", 0) >= OUTER_NODE_ID):
        print(f"已是目标态,零改动:{WF_PATH.name}(子图 {SUBGRAPH_NAME} × 1,"
              f"外层节点 {OUTER_NODE_ID},[90] 标题已精简)")
        return 0

    # ── 注入/自愈(同 UUID 内容不符 → 重写为规范态)─────────────────
    if have_outer is not None and have_outer.get("type") != SUBGRAPH_ID:
        _fail(f"节点 id {OUTER_NODE_ID} 已被非本子图节点占用"
              f"(type={have_outer.get('type')!r}),拒绝覆盖,请人工核处")
    changed: list[str] = []

    if have_outer != want_outer:
        wf["nodes"] = [n for n in wf["nodes"] if n.get("id") != OUTER_NODE_ID]
        wf["nodes"].append(json.loads(json.dumps(want_outer)))
        changed.append(f"外层子图节点 id={OUTER_NODE_ID} type={SUBGRAPH_ID}(mode=4)")
    if have_sg != want_sg:
        wf["definitions"]["subgraphs"] = [s for s in defs if s.get("id") != SUBGRAPH_ID]
        wf["definitions"]["subgraphs"].append(json.loads(json.dumps(want_sg)))
        changed.append(f"子图定义「{SUBGRAPH_NAME}」(16 张 MarkdownNote,接口/连线全空)")
    if title90 != TITLE_90:
        for n in wf["nodes"]:
            if n.get("id") == 90:
                n["title"] = TITLE_90
                changed.append("[90] 标题精简(长注撤走,详见图解)")
    if wf.get("last_node_id", 0) < OUTER_NODE_ID:
        wf["last_node_id"] = OUTER_NODE_ID
        changed.append(f"last_node_id → {OUTER_NODE_ID}")

    # 序列化口径与原文件逐字节一致:indent=2 + ensure_ascii=False + 无尾换行
    WF_PATH.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ 已写入 {WF_PATH}")
    for c in changed:
        print(f"  - {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
