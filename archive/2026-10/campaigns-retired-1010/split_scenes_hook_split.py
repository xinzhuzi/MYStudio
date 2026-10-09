#!/usr/bin/env python3
"""split-scenes 专批:三块生成动作抽 useSplitScenesGeneration 钩子。

闭包引用目录=deps 数组+通读人工核验(30 项 ctx);处理器体逐字保留。
幂等:从 git HEAD 重建。
"""
from __future__ import annotations

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "apps" / "frontend" / "components" / "panels" / "director" / "split-scenes.tsx"

original = subprocess.run(["git", "show", "HEAD:apps/frontend/components/panels/director/split-scenes.tsx"],
                          capture_output=True, text=True, cwd=REPO).stdout
lines = original.splitlines(keepends=True)
HA, HB = 452, 717            # 生成动作三块(含注释)
segment = "".join(lines[HA - 1: HB])

CTX = ["splitScenes", "storyboardConfig", "storyboardImage", "defaultStoryboardAspectRatio",
       "defaultStoryboardResolution", "currentStyleId", "getStylePrompt", "getStyleNegativePrompt",
       "getSceneCharacterContexts", "getCharacterReferenceImages", "getSceneIdentityLockLines",
       "buildPromptWithIdentityLock", "processReferenceImagesForApi", "updateSplitSceneImage",
       "updateSplitSceneImageStatus", "updateSplitSceneEndFrame", "updateSplitSceneEndFrameStatus",
       "autoSaveImageToLibrary", "setIsGenerating", "imageAbortRef", "endFrameAbortRef",
       "mergedAbortRef", "getImageFolderId", "mediaProjectId", "addMediaFromUrl",
       "setIsMergedRunning", "startMergedGeneration", "finishMergedGeneration"]

ctx_fields = "\n".join(f"  {n}: any;" for n in CTX)
ctx_destructure = "  const {\n" + "\n".join(f"    {n}," for n in CTX) + "\n  } = ctx;"

hook = (
    "/* eslint-disable @typescript-eslint/no-explicit-any */\n"
    "/**\n"
    " * 分镜生成动作钩子——单图/九宫格合并/尾帧三块生成工厂接线。\n"
    " * 08-31 file-size-reduction 专批拆出,处理器体逐字保留;\n"
    " * 闭包引用经 ctx 注入(目录=原 deps 数组+通读核验);any 为迁移期务实妥协。\n"
    " */\n"
    'import { useMemo, useCallback } from "react";\n'
    'import { toast } from "sonner";\n'
    'import { aiManager } from "@/lib/ai/ai-manager";\n'
    'import { waitForAbortableDelay } from "@/lib/storyboard/image-task-transport";\n'
    'import { persistSceneImage } from "@/lib/utils/image-persist";\n'
    'import { createStoryboardEndFrameGenerator } from "@/components/features/storyboard/storyboard-end-frame-generation";\n'
    'import { createStoryboardSingleImageGenerator } from "@/components/features/storyboard/storyboard-single-image-generation";\n'
    'import { collectOptimizedMergedFrameReferenceImages } from "@/components/features/storyboard/storyboard-merged-reference-utils";\n'
    'import { runStoryboardMergedPages } from "@/components/features/storyboard/storyboard-merged-page-controller";\n'
    'import { createStoryboardMergedPageGenerator } from "./storyboard-merged-page-generation";\n'
    'import {\n'
    '  buildMergedFrameTasks,\n'
    '  isStoryboardSceneCompleted,\n'
    '  paginateMergedFrameTasks,\n'
    '  type MergedFrameTask as GridTask,\n'
    '} from "@/components/features/storyboard/storyboard-merged-grid-utils";\n'
    'import { optimizeReferenceImagesForModel } from "@/components/features/storyboard/storyboard-reference-utils";\n\n'
    "export function useSplitScenesGeneration(ctx: {\n"
    + ctx_fields + "\n"
    "}) {\n"
    + ctx_destructure + "\n\n"
    + segment.rstrip() + "\n\n"
    "  return { handleGenerateSingleImage, handleMergedGenerate, handleGenerateEndFrameImage };\n"
    "}\n"
)
(SRC.parent / "split-scenes-generation.ts").write_text(hook, encoding="utf-8")

call = (
    "  const { handleGenerateSingleImage, handleMergedGenerate, handleGenerateEndFrameImage } = useSplitScenesGeneration({\n"
    + "".join(f"    {n},\n" for n in CTX)
    + "  });\n"
)
facade = "".join(lines[:HA - 1]) + call + "".join(lines[HB:])
facade = facade.replace(
    'import { waitForAbortableDelay } from "@/lib/storyboard/image-task-transport";',
    'import { useSplitScenesGeneration } from "./split-scenes-generation";',
    1,
)
SRC.write_text(facade, encoding="utf-8")
print(f"钩子模块 {len(hook.splitlines())} 行 | 门面 {len(facade.splitlines())} 行 | ctx {len(CTX)} 项")
