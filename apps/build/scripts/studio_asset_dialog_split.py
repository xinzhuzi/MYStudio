#!/usr/bin/env python3
"""StudioAssetDetailDialog 专批:处理器族抽自定义钩子(自由变量自动编目)。

从 git HEAD 重建。段=[handlers 区];自动求段内自由变量(排除本地声明/
模块导入/JS 保留字),生成 useStudioAssetDialogActions(ctx) 钩子模块,
门面组件内以同名解构调用替换原段——JSX 与状态区零改动。
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "apps" / "frontend" / "components" / "panels" / "assets" / "StudioAssetDetailDialog.tsx"

original = subprocess.run(["git", "show", "HEAD:apps/frontend/components/panels/assets/StudioAssetDetailDialog.tsx"],
                          capture_output=True, text=True, cwd=REPO).stdout
lines = original.splitlines(keepends=True)
HA, HB = 207, 653          # 处理器区(abs)
segment = "".join(lines[HA - 1: HB])

# 模块导入名(钩子模块自行导入,不算 ctx)
imported = set()
for m in re.finditer(r"import (?:type )?\{([^}]*)\} from", original):
    for item in m.group(1).split(","):
        name = re.sub(r"^type ", "", item.strip()).split(" as ")[-1].strip()
        if name:
            imported.add(name)
for m in re.finditer(r"^import (?:type )?(\w+)", original, re.M):
    imported.add(m.group(1))

RESERVED = {"async", "await", "return", "if", "else", "try", "catch", "finally", "const", "let",
            "function", "new", "typeof", "void", "for", "of", "in", "true", "false", "null",
            "undefined", "throw", "window", "document", "console", "Math", "JSON", "Date",
            "Promise", "Array", "Object", "Boolean", "Number", "String", "setTimeout", "URL",
            "process", "navigator", "Set", "Map", "File", "Blob", "Error", "event", "e"}

declared = set(re.findall(r"(?:const|let|var|function)\s+(\w+)", segment))
refs = set(re.findall(r"\b([A-Za-z_]\w*)\b", segment))
free = sorted((refs - declared - imported - RESERVED)
              - {"handlePolishPrompt", "handleSave", "handleDelete", "copyText",
                 "handleOneClickGenerateAssetImage", "handleRegenerate", "handleOpenSource",
                 "handleOpenFolder", "handleAddImage", "handleReplaceImage", "handleRemoveImage",
                 "handleTranscribe"})   # 段内顶层导出目标(本地声明)

ctx_type = "\n".join(f"  {name}: any;" for name in free)
ctx_destructure = "\n".join(f"  const {{ {name} }} = ctx;" for name in free)
hook_module = (
    '""'
    '/**\n'
    ' * 资产详情对话框动作钩子——生成/替换/删除/转写/打开等全部处理器。\n'
    ' * 08-31 file-size-reduction 专批拆出,处理器体逐字保留;自由变量经 ctx 注入。\n'
    ' */\n'
    'import { toast } from "sonner";\n'
    'import { getAssetDisplayName, getAssetOperationError, updateImagesAfterReplacingMainImage } from "./studio-asset-detail-utils";\n'
    'import { saveGeneratedAssetImageToLibrary, persistGeneratedAssetPromptToLibrary } from "./studio-asset-generation-persistence";\n\n'
    "// eslint-disable-next-line @typescript-eslint/no-explicit-any\n"
    "export function useStudioAssetDialogActions(ctx: {\n"
    + ctx_type + "\n"
    "}) {\n"
    + ctx_destructure + "\n\n"
    + segment.rstrip() + "\n\n"
    "  return {\n"
    "    handlePolishPrompt, handleSave, handleDelete, copyText,\n"
    "    handleOneClickGenerateAssetImage, handleRegenerate, handleOpenSource,\n"
    "    handleOpenFolder, handleAddImage, handleReplaceImage, handleRemoveImage,\n"
    "    handleTranscribe,\n"
    "  };\n"
    "}\n"
)
(SRC.parent / "studio-asset-detail-actions.ts").write_text(hook_module, encoding="utf-8")

call_block = (
    "  const {\n"
    "    handlePolishPrompt, handleSave, handleDelete, copyText,\n"
    "    handleOneClickGenerateAssetImage, handleRegenerate, handleOpenSource,\n"
    "    handleOpenFolder, handleAddImage, handleReplaceImage, handleRemoveImage,\n"
    "    handleTranscribe,\n"
    "  } = useStudioAssetDialogActions({\n"
    + "".join(f"    {name},\n" for name in free)
    + "  });\n"
)
facade = "".join(lines[:HA - 1]) + call_block + "".join(lines[HB:])
facade = facade.replace(
    'import { Skeleton } from "@/components/ui/skeleton";',
    'import { Skeleton } from "@/components/ui/skeleton";\nimport { useStudioAssetDialogActions } from "./studio-asset-detail-actions";',
    1,
)
if "useStudioAssetDialogActions" not in facade.split("\n")[0:60].__str__():
    # 兜底:插在首个 import 之后
    first_import = re.search(r"^import .*$", facade, re.M)
    facade = facade.replace(first_import.group(0), first_import.group(0) + f'\nimport {{ useStudioAssetDialogActions }} from "./studio-asset-detail-actions";', 1)
SRC.write_text(facade, encoding="utf-8")
print(f"自由变量 {len(free)} 个: {free}")
print(f"门面 {len(facade.splitlines())} 行 | 钩子模块 {len(hook_module.splitlines())} 行")
