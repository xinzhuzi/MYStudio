#!/usr/bin/env python3
"""T1: lib/studio/image-workflow.ts(1051行) 机械拆分为目录模块。

按行号区间切片(先通读全文件标定边界),零行为变化:
  graph-build.ts  图构建+节点/边 CRUD+成图状态+私有工具+分层节点
  request.ts      生图请求组装+连续性能力门禁
  writeback.ts    回写 patch+旁路图联动愈合
  index.ts        桶导出,保持 @/lib/studio/image-workflow 旧路径零破坏

用法: python3 split_image_workflow_module.py(仓库根执行;幂等拒绝覆盖)
"""
import sys
from pathlib import Path

SRC = Path("apps/frontend/lib/studio/image-workflow.ts")
OUT_DIR = Path("apps/frontend/lib/studio/image-workflow")

def main() -> None:
    lines = SRC.read_text(encoding="utf-8").splitlines(keepends=True)
    total = len(lines)
    # 行号(1-based,含端点)按通读标定;assert 防漂移
    assert total == 1050, f"source drifted: {total} lines"
    def seg(a: int, b: int) -> str:
        return "".join(lines[a - 1 : b])

    # ---- 区间表(与 2026-08-23 通读版逐段对应) ----
    # graph-build: 类型输入块(24-82 分三段跳过 request 类型 84-105) + StoryboardReference(107-123) + 元数据类型(125)
    gb_types = seg(24, 82) + seg(107, 123) + seg(125, 125)
    gb_creates = seg(134, 585)            # create*/ensure*/add*/update/remove/connect/removeEdge
    gb_status = seg(733, 747)             # setGeneratedImageStatus
    gb_setresult = seg(768, 787)          # setGeneratedImageResult
    gb_helpers = seg(826, 925)            # getGeneratedNode + 私有 find/collapse/isSame/normalize/keys/extract + createId + touchGraph
    gb_layered = seg(927, 1050)           # addStoryboardLayeredNodes(927 起含 doc 注释)

    rq_types = seg(84, 105)               # ImageWorkflowGenerationRequest
    rq_body = seg(586, 731)               # buildRequest + contract + merge + assert

    wb_types = seg(127, 132)              # AssetImageWorkflowPatch
    wb_heal = seg(749, 766)               # ensureStoryboardImageResult(749 起含 doc 注释)
    wb_patches = seg(789, 824)            # build*Patch

    # ---- 私有函数可见性: findPromptNodeForGenerated 与元数据类型需跨文件 → export ----
    def reexport(text: str, name: str) -> str:
        out, seen = [], False
        for line in text.splitlines(keepends=True):
            if line.startswith("function findPromptNodeForGenerated(") and not seen:
                line = line.replace("function findPromptNodeForGenerated(", "export function findPromptNodeForGenerated(", 1)
                seen = True
            out.append(line)
        assert seen, f"{name}: findPromptNodeForGenerated not found"
        return "".join(out)
    gb_helpers = reexport(gb_helpers, "gb_helpers")
    gb_types = gb_types.replace(
        "type StoryboardOrderedReferenceMetadata = ",
        "export type StoryboardOrderedReferenceMetadata = ", 1)
    assert "export type StoryboardOrderedReferenceMetadata" in gb_types

    gb_header = (
        'import type {\n'
        '  ImageWorkflowEdge,\n'
        '  ImageWorkflowGeneratedNode,\n'
        '  ImageWorkflowGraph,\n'
        '  ImageWorkflowNode,\n'
        '  ImageWorkflowNodePosition,\n'
        '  ImageWorkflowPromptNode,\n'
        '  ImageWorkflowReferenceNode,\n'
        '  ImageWorkflowAssetTargetType,\n'
        '  ImageWorkflowTarget,\n'
        '  AssetImageWorkflowContext,\n'
        '  CharacterReferenceViewType,\n'
        '  StoryboardItem,\n'
        '} from "@/types/studio";\n'
        'import {\n'
        '  BACKGROUND_PLATE_NEGATIVE_ANCHORS,\n'
        '  SUBJECT_CUTOUT_NEGATIVE_ANCHORS,\n'
        '  buildBackgroundPlatePrompt,\n'
        '  buildSubjectCutoutPrompt,\n'
        '} from "../layered-generation";\n'
        'import { useAppSettingsStore } from "@/stores/app/app-settings-store";\n'
        'import { buildContinuityPrompt } from "../visual-continuity";\n\n'
    )
    rq_header = (
        'import type {\n'
        '  ImageWorkflowGeneratedNode,\n'
        '  ImageWorkflowGraph,\n'
        '  ImageWorkflowReferenceNode,\n'
        '  CharacterReferenceViewType,\n'
        '} from "@/types/studio";\n'
        'import {\n'
        '  findPromptNodeForGenerated,\n'
        '  getGeneratedNode,\n'
        '  type StoryboardOrderedReferenceMetadata,\n'
        '} from "./graph-build";\n\n'
    )
    wb_header = (
        'import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";\n'
        'import { getGeneratedNode, setGeneratedImageResult } from "./graph-build";\n\n'
    )
    index_header = (
        '// 桶导出:原 lib/studio/image-workflow.ts 拆分(T1),import 路径与符号零破坏。\n'
        '// 职责: graph-build=图构建/节点边CRUD/成图状态;request=生图请求组装/连续性门禁;\n'
        '// writeback=回写patch/旁路图联动愈合。\n'
    )
    exports = (
        'export * from "./graph-build";\n'
        'export * from "./request";\n'
        'export * from "./writeback";\n'
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    targets = {
        OUT_DIR / "graph-build.ts": gb_header + gb_types + "\n" + gb_creates + gb_status + gb_setresult + gb_helpers + gb_layered,
        OUT_DIR / "request.ts": rq_header + rq_types + "\n" + rq_body,
        OUT_DIR / "writeback.ts": wb_header + wb_types + wb_heal + wb_patches,
        OUT_DIR / "index.ts": index_header + exports,
    }
    for path, content in targets.items():
        if path.exists():
            sys.exit(f"refuse to overwrite existing {path}")
        path.write_text(content, encoding="utf-8")
        print(f"wrote {path} ({content.count(chr(10))} lines)")
    print("OK — source left in place; verify then `git rm` it")

if __name__ == "__main__":
    main()
