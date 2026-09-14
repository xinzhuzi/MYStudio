#!/usr/bin/env python3
"""漫影工作流库海量造桩(09-12 workflow-single-open AC4)。

在指定引擎家(MYSTUDIO_COMFYUI_HOME)的「漫影/1_图片/分镜/0_工作流主线/」
生成 N 个章节主线文件(最小合法工作流 JSON,带 ManyingStage 节点),用于
侧栏海量渲染验证(用户预告 4125 章)。幂等:已存在的章节文件跳过。
章节号四位零垫(chapter-0001),搜索"chapter-041"命中 0410-0419。

用法:
  MYSTUDIO_COMFYUI_HOME=/tmp/manying-bulk-home \
    python3 apps/build/scripts/manying_workflows_bulk_fixture.py [N] [--clean]

⚠ 只造临时家做验证,严禁指到装机引擎家。
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from engines.comfyui import manifest as cm  # noqa: E402

MAINLINE_DIR = "漫影/1_图片/分镜/0_工作流主线"


def build_graph() -> dict:
    return {
        "last_node_id": 1,
        "last_link_id": 0,
        "nodes": [{
            "id": 1, "type": "ManyingStage", "pos": [0, 0], "size": [210, 100],
            "flags": {}, "order": 1, "mode": 0, "inputs": [], "outputs": [],
            "properties": {}, "widgets_values": ["剧本"],
        }],
        "links": [], "groups": [], "config": {},
        "extra": {"manyingPipeline": True}, "version": 0.4,
    }


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    count = int(args[0]) if args else 4200
    root = cm.workflows_dir() / MAINLINE_DIR
    if "--clean" in sys.argv:
        if root.exists():
            shutil.rmtree(root)
        print(f"已清空 {root}")
        return
    root.mkdir(parents=True, exist_ok=True)
    created = skipped = 0
    payload = json.dumps(build_graph(), ensure_ascii=False)
    for i in range(1, count + 1):
        path = root / f"MY-分镜工作流 · chapter-{i:04d}.json"
        if path.exists():
            skipped += 1
            continue
        path.write_text(payload, encoding="utf-8")
        created += 1
    print(f"造桩完成:新建 {created} / 跳过 {skipped};目录={root}")


if __name__ == "__main__":
    main()
