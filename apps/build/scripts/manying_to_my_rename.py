#!/usr/bin/env python3
"""09-14 一次性改名脚本:engines/comfyui 域 manying → my 标识符收敛。

用法(repo 根):python3 apps/build/scripts/manying_to_my_rename.py [--dry-run]

规则按序整串替换;保留清单(令牌 manying-local-image、请求头 X-Manying-*、
模板 id manying_t2i*、品牌 manying-studio、家目录 ~/.manying-dev、资产 source
manying-local、TTS 域 MANYING_TTS_* 等)不落任何规则,天然不动。
文件/目录级 git mv 已先行;本脚本只做内容层。
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]

# ── 文件集 ──────────────────────────────────────────────────────────────
BACKEND_PY = sorted((REPO / "apps/backend/engines/comfyui").rglob("*.py")) + [
    REPO / "apps/backend/image_gen/server.py",
]
WEB_JS = [
    p for p in sorted((REPO / "apps/backend/engines/comfyui/my_nodes/web").rglob("*.js"))
    if "vendor" not in p.parts  # markdown-it 等 vendor 不动
]
FRONTEND = [
    REPO / "apps/frontend/lib/assist/image-studio/storyboard-pipeline-comfy.ts",
    REPO / "apps/frontend/lib/assist/image-studio/storyboard-pipeline-comfy.test.ts",
    REPO / "apps/frontend/lib/assist/image-studio/storyboard-overview-comfy.ts",
    REPO / "apps/frontend/lib/assist/image-studio/storyboard-overview-comfy.test.ts",
    REPO / "apps/frontend/lib/assist/image-studio/storyboard-overview-sync.ts",
    REPO / "apps/frontend/lib/assist/image-studio/workflow-export-comfy.ts",
    REPO / "apps/frontend/lib/assist/image-studio/workflow-export-comfy.test.ts",
    REPO / "apps/frontend/lib/assist/image-studio/workflow-migrate-batch.test.ts",
    REPO / "apps/frontend/lib/assist/image-studio/workflow-migrate-batch.live.test.ts",
    REPO / "apps/frontend/lib/assist/image-studio/h3-shot-video-workflow.ts",
    REPO / "apps/frontend/lib/assist/image-studio/h3-shot-video-workflow.test.ts",
    REPO / "apps/frontend/lib/assist/image-studio/comfy-sidecar-bridge.ts",
    REPO / "apps/frontend/lib/assist/image-studio/comfy-sidecar-bridge.test.ts",
    REPO / "apps/frontend/components/panels/assist/comfy-canvas/ComfyCanvasStudio.tsx",
    REPO / "apps/frontend/components/panels/assist/comfy-canvas/ComfyCanvasStudio.test.tsx",
    REPO / "apps/frontend/components/panels/assist/comfy-canvas/ComfyCanvasSwap.tsx",
    REPO / "apps/frontend/components/panels/assist/comfy-canvas/my-module-policy.test.ts",
    REPO / "apps/frontend/components/panels/assist/comfy-canvas/my-login-cloak.test.ts",
    REPO / "apps/frontend/components/panels/assist/ComfyWorkspace.tsx",
    REPO / "apps/frontend/components/panels/studio/index.tsx",
    REPO / "apps/frontend/components/panels/settings/comfy-engine/comfy-engine-contract.ts",
    REPO / "apps/frontend/components/panels/settings/comfy-engine/mock-comfy-engine-client.ts",
    REPO / "apps/build/scripts/cdp-daojie-krea2-ink-e2e.mjs",
]
# 模板 JSON:仅数据键与节点名,禁止文件名前缀规则(值引用真实 input 文件)
TEMPLATE_JSON = [
    REPO / "apps/frontend/lib/assist/image-studio/MY-h3-shot-template.json",
    REPO / "apps/frontend/lib/assist/image-studio/MY-h3-shot-template_ref2va.json",
]

# ── 通用规则(顺序敏感:长的/具体的在前)────────────────────────────────
COMMON_RULES = [
    # 类名(节点类映射键 + TS 生成器 + JS 判型 + 测试)
    ("ManyingPrompt", "MyPrompt"),
    ("ManyingReference", "MyReference"),
    ("ManyingGenerated", "MyGenerated"),
    ("ManyingCloudImage", "MyCloudImage"),
    ("ManyingStage", "MyStage"),
    ("ManyingShot", "MyShot"),
    # 数据属性键(Preview2 先于 Preview)
    ("manyingPreview2", "myPreview2"),
    ("manyingPreview", "myPreview"),
    ("manyingStage", "myStage"),
    ("manyingOverview", "myOverview"),
    ("manyingPipeline", "myPipeline"),
    # 扩展名/锚点(shots 先于 shot)
    ("manying_nodes", "my_nodes"),
    ("manying_module_policy", "my_module_policy"),
    ("manying.stage.render", "my.stage.render"),
    ("manying.stage", "my.stage"),
    ("manying.shots", "my.shots"),
    ("manying.shot", "my.shot"),
    ("manying.sidebar", "my.sidebar"),
    ("manying.render", "my.render"),
    # DOM/CSS/状态标记
    ("manying-stage", "my-stage"),
    ("manying-canvas-hints", "my-canvas-hints"),
    ("manying-dragon", "my-dragon"),
    ("manyingTab", "myTab"),
    ("manyingOpenSub", "myOpenSub"),
    ("manying.canvasHints", "my.canvasHints"),
    ("__manying", "__my"),
    # JS 标识符
    ("manyingScope", "myScope"),
    ("manyingLoginCloak", "myLoginCloak"),
    ("MANYING_LOGIN_CLOAK_SOURCE", "MY_LOGIN_CLOAK_SOURCE"),
    ("MANYING_STORE_BASE", "MY_STORE_BASE"),
    ("MANYING_WORKFLOW_PREFIX", "MY_WORKFLOW_PREFIX"),
    ("MANYING_LOGO_ICON", "MY_LOGO_ICON"),
    ("filterUserDataWorkflowEntriesDropManying", "filterUserDataWorkflowEntriesDropMy"),
    ("openManyingWorkflow", "openMyWorkflow"),
    ("manyingWorkflowRow", "myWorkflowRow"),
    ("[manying]", "[my]"),
    # 端点(asar 同体契约)
    ("/comfy/manying/", "/comfy/my/"),
    ("ComfyManyingSyncReply", "ComfyMySyncReply"),
    ("syncManyingNodes", "syncMyNodes"),
    ("manyingNodes", "myNodes"),
]

# Python 侧附加(模块/函数/常量/ui 键)
PY_RULES = COMMON_RULES + [
    ("sync_manying_nodes", "sync_my_nodes"),
    ("manying_source_dir", "my_source_dir"),
    ("manying_sync_state", "my_sync_state"),
    ("MANYING_DIR", "MY_DIR"),
    ("manying_nodes", "my_nodes"),
    ("manying-nodes", "my-nodes"),
    ("manying_generated", "my_generated"),
    ("manying_prompt", "my_prompt"),
    ("manying_stage", "my_stage"),
    ("manying_shot", "my_shot"),
    ('"MANYING_FLOW"', '"MY_FLOW"'),
    ("MANYING_FLOW", "MY_FLOW"),
    ('"manying"', '"my"'),
    ("_manying_takeover", "_my_takeover"),
    ("_manying_get_auth_header", "_my_get_auth_header"),
    ("manying-write-probe", "my-write-probe"),
    ("manying-ref-", "my-ref-"),
]

# 前端 TS 附加(文件名前缀 + API 图节点键 + 登录掩码文件名)
TS_RULES = COMMON_RULES + [
    ("manying-shot-", "my-shot-"),
    ("manying-asset-", "my-asset-"),
    ("manying-ref-", "my-ref-"),
    ("manying_generated", "my_generated"),
    ("manying_prompt", "my_prompt"),
    ("manying_login_cloak", "my_login_cloak"),
    ("manying-comfy-models", "my-comfy-models"),
]

# 模板 JSON 只允许数据键/节点名
JSON_RULES = [
    ("ManyingShot", "MyShot"),
    ("ManyingStage", "MyStage"),
    ("ManyingPrompt", "MyPrompt"),
    ("ManyingGenerated", "MyGenerated"),
    ("ManyingReference", "MyReference"),
    ("ManyingCloudImage", "MyCloudImage"),
    ('"manyingPreview"', '"myPreview"'),
]


def apply(content: str, rules: list[tuple[str, str]]) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}
    for old, new in rules:
        n = content.count(old)
        if n:
            counts[f"{old} → {new}"] = n
            content = content.replace(old, new)
    return content, counts


def main() -> int:
    dry = "--dry-run" in sys.argv
    plan = [
        ("backend-py", BACKEND_PY, PY_RULES),
        ("web-js", WEB_JS, COMMON_RULES),
        ("frontend", FRONTEND, TS_RULES),
        ("template-json", TEMPLATE_JSON, JSON_RULES),
    ]
    missing = [str(p) for _, paths, _ in plan for p in paths if not p.is_file()]
    if missing:
        print("缺文件:\n  " + "\n  ".join(missing))
        return 1
    for label, paths, rules in plan:
        for path in paths:
            text = path.read_text(encoding="utf-8")
            new, counts = apply(text, rules)
            if not counts:
                continue
            rel = path.relative_to(REPO)
            print(f"[{label}] {rel}")
            for rule, n in counts.items():
                print(f"    {n:>3} × {rule}")
            if not dry:
                path.write_text(new, encoding="utf-8")
    print("DONE" + (" (dry-run)" if dry else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
