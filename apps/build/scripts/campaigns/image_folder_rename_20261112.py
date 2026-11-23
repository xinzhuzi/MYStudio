#!/usr/bin/env python3
"""1_图片 五夹改名(1112 用户令)+活面同步。

改名(用户令,逐对亲裁;第六夹 MiniMax 未点名不动):
    Flux3图像 → Flux.3     K2图像 → krea2      MOSS图像 → MossImage
    Q2-1图像 → QwenImage2.1    SeeThrough图像 → SeeThrough

同步策略(分拣依据=全仓引用面扫描+活/历史分拣):
  B 裸名组  = 生产代码/测试/构建设施/技能活文档:五对裸名替换
              (这些文件只谈当前树;裸换覆盖路径段与结构列举两种形态)
  A 段名组  = docs 参考文档:仅 `1_图片/<旧>` 路径段替换(保守,叙述里的
              裸品牌词如「K2 提示词模板」不误伤)
  清单     = 漫影工作流清单.md 自「## 现存文件清单」起,仅 `|`/`#`/`>`
              开头行(表格/标题/块注=当前态)裸换;普通段落(构成史等
              历史实录)不动;顶部账目区整段不动
  不动清单 = 带日期一次性战役脚本(risk#8 历史实录)、.trellis 任务档、
              .zcode 会话工件、runs/campaigns、retired/、参考_*/档案
              历史档、外部项目路径(krea2.py:27 ~/Project/ComfyUI 等)、
              manying_workflow_library_reorg.py(引擎家旧树清理器,手工
              2 处 target 另改)

幂等:旧夹不存在+新夹在位 → 跳过 git mv;文件替换按「旧名计数==0」自证。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/comfyui/workflows"
IMG = WF / "1_图片"
LEDGER = REPO / "docs/comfyui-kb/漫影工作流清单.md"

RENAMES: list[tuple[str, str]] = [
    ("Flux3图像", "Flux.3"),
    ("K2图像", "krea2"),
    ("MOSS图像", "MossImage"),
    ("Q2-1图像", "QwenImage2.1"),
    ("SeeThrough图像", "SeeThrough"),
]

# B 裸名组(生产代码/测试/构建设施/技能活文档)
BARE_FILES = [
    "apps/backend/comfyui/tests/test_qwen21_workflow_contract.py",
    "apps/backend/comfyui/tests/test_bfs_workflow_cpu_contract.py",
    "apps/backend/comfyui/tests/test_comfy_manifest_bridge_workflows.py",
    "apps/backend/comfyui/tests/test_daojie_handsfix_contract.py",
    "apps/backend/comfyui/tests/test_daojie_workflow_contract.py",
    "apps/backend/comfyui/tests/test_flux3_daojie_workflow_contract.py",
    "apps/backend/comfyui/tests/test_moss_daojie_workflow_contract.py",
    "apps/backend/comfyui/tests/test_qi21_daojie_pose_workflow_contract.py",
    "apps/backend/comfyui/tests/test_superset_v3_contract.py",
    "apps/backend/tests/test_image_gen_qwen21.py",
    "apps/backend/comfyui/my_nodes/tests/test_workflow_subgraph_contract.py",
    "apps/backend/comfyui/my_nodes/tests/test_line_mode_server.py",
    "apps/backend/comfyui/my_nodes/web/my_module_policy.js",
    "apps/backend/engines/image_engine/comfyui_bridge.py",
    "apps/frontend/lib/studio/engine-line/family-catalog.ts",
    "apps/frontend/lib/studio/workflow-prompt-parser.ts",
    "apps/frontend/lib/assist/image-studio/workflow-export-comfy.ts",
    "apps/frontend/lib/assist/image-studio/comfy-workflow-import.test.ts",
    "apps/frontend/lib/assist/image-studio/comfy-workflow-library.test.ts",
    "apps/frontend/components/panels/assist/comfy-canvas/my-module-policy.test.ts",
    "apps/frontend/components/panels/settings/McpSettingsTab.test.tsx",
    "apps/build/scripts/workflow_gate.py",
    "apps/build/scripts/hygiene_gate.py",
    "apps/build/scripts/comfy-canvas-verify.mjs",
    "apps/build/scripts/daojie_lora_refclose.py",
    "apps/build/scripts/workflow_layout_baseline.json",
    "apps/build/scripts/ep01_moss_regen_20261112.py",  # 并行域仅路径段随迁(模板读取行)
    ".agents/skills/krea2edit-prompts/SKILL.md",
    ".agents/skills/comfyui/machine.md",
    "AGENTS.md",
]

# A 段名组(docs 参考文档:仅路径段)
SEGMENT_FILES = [
    "docs/krea2.md",
    "docs/comfyui-kb/LoRA库存台账.md",
    "docs/comfyui-kb/参数速查.md",
    "docs/comfyui-kb/qi21-vae-cpu-fp32.md",
    "docs/prompts/道劫_类型配方.md",
    "docs/prompts/道劫_角色设定表出图逻辑_0919.md",
    "docs/prompts/Qwen-Image-2.1/13-换装七模板-社区Goohai参考.md",
]


def bare_replace(text: str) -> str:
    for old, new in RENAMES:
        text = text.replace(old, new)
    return text


def segment_replace(text: str) -> str:
    for old, new in RENAMES:
        text = text.replace(f"1_图片/{old}", f"1_图片/{new}")
    return text


def ledger_replace(text: str) -> str:
    """现存清单区:|/#/> 开头行裸换;其余行原样(历史实录)。"""
    marker = "## 现存文件清单"
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit("FAIL 清单缺「## 现存文件清单」锚")
    head, body = text[:idx], text[idx:]
    out_lines = []
    for line in body.split("\n"):
        if line.startswith(("|", "#", ">")):
            line = bare_replace(line)
        out_lines.append(line)
    return head + "\n".join(out_lines)


def main() -> int:
    tree_before = len([p for p in WF.rglob("*.json")])
    # ── 1. git mv 五夹 ──
    for old, new in RENAMES:
        src, dst = IMG / old, IMG / new
        if dst.exists() and not src.exists():
            print(f"skip(已迁): {old}")
            continue
        if not src.exists():
            print(f"FAIL 源夹缺: {src}", file=sys.stderr)
            return 1
        if dst.exists():
            print(f"FAIL 目标已占位: {dst}", file=sys.stderr)
            return 1
        subprocess.run(["git", "mv", str(src), str(dst)], cwd=REPO, check=True)
        print(f"mv: 1_图片/{old} -> 1_图片/{new}")

    # ── 2. 文件同步 ──
    changed = []
    for rel in BARE_FILES:
        p = REPO / rel
        raw = p.read_text(encoding="utf-8")
        new = bare_replace(raw)
        if new != raw:
            p.write_text(new, encoding="utf-8")
            changed.append(rel)
    for rel in SEGMENT_FILES:
        p = REPO / rel
        raw = p.read_text(encoding="utf-8")
        new = segment_replace(raw)
        if new != raw:
            p.write_text(new, encoding="utf-8")
            changed.append(rel)
    raw = LEDGER.read_text(encoding="utf-8")
    new = ledger_replace(raw)
    if new != raw:
        LEDGER.write_text(new, encoding="utf-8")
        changed.append(str(LEDGER.relative_to(REPO)))
    print(f"synced {len(changed)} files")

    # ── 3. 终态断言 ──
    # 计数语义=本役零漂移(mv 前后守恒),不锚死绝对值:并行会话在途增件
    # (1112 实录:MiniMax/ 官方-H3图像×2 系并行 H3-Image 役 untracked,与
    # 本役无关,账目条目由当事役自落;清单锚盘面真相同理由本役先调账)。
    tree = len([p for p in WF.rglob("*.json")])
    assert tree == tree_before, f"树计数漂移: {tree_before} -> {tree}"
    for old, new in RENAMES:
        assert not (IMG / old).exists(), f"旧夹残留: {old}"
        assert (IMG / new).exists(), f"新夹缺: {new}"
    for rel in BARE_FILES:
        txt = (REPO / rel).read_text(encoding="utf-8")
        for old, _ in RENAMES:
            assert old not in txt, f"B 组残留 {old}: {rel}"
    for rel in SEGMENT_FILES:
        txt = (REPO / rel).read_text(encoding="utf-8")
        for old, _ in RENAMES:
            assert f"1_图片/{old}" not in txt, f"A 组段残留 {old}: {rel}"
    # 清单:现存清单区(锚后)表格/标题/块注行零旧名;锚前的域构成史等
    # 历史实录表不动、允许保留旧名(口径=历史条目实录不改写)
    ledger_txt = LEDGER.read_text(encoding="utf-8")
    body_txt = ledger_txt[ledger_txt.find("## 现存文件清单"):]
    for i, line in enumerate(body_txt.split("\n"), 1):
        if line.startswith(("|", "#", ">")):
            for old, _ in RENAMES:
                assert old not in line, f"清单表行残留 {old} @现存清单区L{i}"
    print(f"OK 五夹就位+{len(changed)} 文件同步+断言全过;全树 {tree} 本役零漂移")
    return 0


if __name__ == "__main__":
    sys.exit(main())
