#!/usr/bin/env python3
"""错题集归总(1126 用户令):docs 下所有错题集文档迁入 docs/错题集/,引用面同步,自检。

动作:
1. docs/comfyui-kb/错题集/作图错题集.md      -> docs/错题集/作图错题集.md
2. docs/prompts/Qwen-Image-2.1/12-毁风格词错题集.md -> docs/错题集/12-毁风格词错题集.md
3. 两份文档内部相对链接按新位置改写(逐处计数断言)
4. 外部引用面同步:docs/README.md、docs/prompts/Qwen-Image-2.1/00-README.md、
   apps/backend/comfyui/my_nodes/nodes/_gongbi_gate.py(报错文案里的路径)
5. 两份文档头部加迁址注记;作图错题集 §九 并行指针改指本目录 Agent运维错题集.md
6. 自检:全仓扫描旧路径残留(白名单外必须为零)+ 迁入文档全部相对链接可解析 + 条数点数

不进 git 暂存区,不提交(用户未令);回滚=把文件移回原路径并逆向套用本表的替换。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OLD_A = REPO / "docs/comfyui-kb/错题集/作图错题集.md"
OLD_B = REPO / "docs/prompts/Qwen-Image-2.1/12-毁风格词错题集.md"
NEW_DIR = REPO / "docs/错题集"
NEW_A = NEW_DIR / "作图错题集.md"
NEW_B = NEW_DIR / "12-毁风格词错题集.md"

# 迁入文档内部链接改写表(旧串 -> 新串, 断言次数)
REWRITE_A = [
    ("](../../prompts/Qwen-Image-2.1/07-主体句写作宪法.md)",
     "](../prompts/Qwen-Image-2.1/07-主体句写作宪法.md)", 1),
    ("](../../prompts/Qwen-Image-2.1/09-图生图指令写作规范.md)",
     "](../prompts/Qwen-Image-2.1/09-图生图指令写作规范.md)", 1),
    ("](../../prompts/Qwen-Image-2.1/12-毁风格词错题集.md)",
     "](12-毁风格词错题集.md)", 3),
    ("](../Q2-1致噪词黑名单-0925.md)", "](../comfyui-kb/Q2-1致噪词黑名单-0925.md)", 1),
    ("](../子图工作流工程契约.md)", "](../comfyui-kb/子图工作流工程契约.md)", 1),
    ("](../画布布局规范.md)", "](../comfyui-kb/画布布局规范.md)", 1),
    ("](../跨镜连续性规范.md)", "](../comfyui-kb/跨镜连续性规范.md)", 1),
]

REWRITE_B = [
    ("](../../comfyui-kb/错题集/作图错题集.md)", "](作图错题集.md)", 1),
    ("](07-主体句写作宪法.md)", "](../prompts/Qwen-Image-2.1/07-主体句写作宪法.md)", 2),
    ("](08-AI扩写提示词优化规范.md)",
     "](../prompts/Qwen-Image-2.1/08-AI扩写提示词优化规范.md)", 1),
    ("](09-图生图指令写作规范.md)",
     "](../prompts/Qwen-Image-2.1/09-图生图指令写作规范.md)", 1),
    ("](11-官方示例对拍产线分析-1017.md)",
     "](../prompts/Qwen-Image-2.1/11-官方示例对拍产线分析-1017.md)", 1),
]

# 外部引用面(文件, 旧串 -> 新串, 断言次数)
EXTERNAL = [
    (REPO / "docs/README.md", [
        ("](./comfyui-kb/错题集/作图错题集.md)", "](./错题集/作图错题集.md)", 1),
        ("](./prompts/Qwen-Image-2.1/12-毁风格词错题集.md)",
         "](./错题集/12-毁风格词错题集.md)", 1),
    ]),
    (REPO / "docs/prompts/Qwen-Image-2.1/00-README.md", [
        ("](12-毁风格词错题集.md)", "](../../错题集/12-毁风格词错题集.md)", 1),
        ("| 毁风格词族错题集(1017 立):",
         "| 毁风格词族错题集(1017 立;1126 迁入 docs/错题集/ 归总):", 1),
    ]),
    (REPO / "apps/backend/comfyui/my_nodes/nodes/_gongbi_gate.py", [
        ("docs/prompts/Qwen-Image-2.1/12-毁风格词错题集.md",
         "docs/错题集/12-毁风格词错题集.md", 1),
    ]),
]

NOTE_A = (
    "# 作图错题集（图片生成全链路）\n"
    "\n"
    "> **迁址(1126)**：自 docs/comfyui-kb/错题集/ 迁入本目录 docs/错题集/"
    "（用户令：全仓错题集文档归总一处）；并行与运维域错题另见"
    " [Agent运维错题集](Agent运维错题集.md)。\n"
    "> **定位**"
)
NOTE_B = (
    "# 12-毁风格词错题集（Q2.1 道劫线）\n"
    "\n"
    "> **迁址(1126)**：自 docs/prompts/Qwen-Image-2.1/ 迁入本目录 docs/错题集/"
    "（用户令：全仓错题集文档归总一处）；系列序号「12-」保留，"
    "对齐原目录 00-README 索引与 _gongbi_gate 报错文案。\n"
    "> **定位**"
)

POINTER_OLD = (
    "已按用户令成册于记忆档 parallel-run-control-mistakes-1123-26 与 "
    "dwf-concurrency-per-provider-key-1123，本篇不重复收录。"
)
POINTER_NEW = (
    "已按用户令成册于本目录 [Agent运维错题集](Agent运维错题集.md)"
    "（源=记忆档 parallel-run-control-mistakes-1123-26 与 "
    "dwf-concurrency-per-provider-key-1123），本篇不重复收录。"
)

# 自检白名单:这些目录允许出现旧路径(历史快照/生成物/备份)
ALLOW_STALE_PREFIX = (
    ".git/", "node_modules/", "apps/release/", "apps/output/",
    ".trellis/",  # 任务档案、research 快照与 bak-1126 备份=历史记录,另案处理
    ".zcode/",
)


def apply(text: str, table, where: str) -> str:
    for old, new, expect in table:
        n = text.count(old)
        if n != expect:
            sys.exit(f"[abort] {where}: 期望 {expect} 处、实见 {n} 处: {old[:60]}...")
        text = text.replace(old, new)
    return text


def main() -> None:
    moved = not OLD_A.exists() and not OLD_B.exists() and NEW_A.exists() and NEW_B.exists()
    if not moved:
        for p in (OLD_A, OLD_B):
            if not p.is_file():
                sys.exit(f"[abort] 源文件不在(可能已迁): {p}")
    NEW_DIR.mkdir(exist_ok=True)
    if not moved:
        for p in (NEW_A, NEW_B):
            if p.exists():
                sys.exit(f"[abort] 目标已存在,不覆盖: {p}")

    # 1+3+5. 读入、改写、迁址注记(先内存改写,再落新路径);已迁移态只做自检
    if moved:
        text_a = NEW_A.read_text(encoding="utf-8")
        text_b = NEW_B.read_text(encoding="utf-8")
    else:
        text_a = apply(OLD_A.read_text(encoding="utf-8"), REWRITE_A, "作图错题集")
    if not moved:
        if POINTER_OLD not in text_a:
            sys.exit("[abort] 作图错题集 §九 并行指针原文未命中")
        text_a = text_a.replace(POINTER_OLD, POINTER_NEW, 1)
        anchor_a = "# 作图错题集（图片生成全链路）\n\n> **定位**"
        if anchor_a not in text_a:
            sys.exit("[abort] 作图错题集 标题锚未命中")
        text_a = text_a.replace(anchor_a, NOTE_A, 1)

        text_b = apply(OLD_B.read_text(encoding="utf-8"), REWRITE_B, "12-毁风格词错题集")
        anchor_b = "# 12-毁风格词错题集（Q2.1 道劫线）\n\n> **定位**"
        if anchor_b not in text_b:
            sys.exit("[abort] 12-毁风格词 标题锚未命中")
        text_b = text_b.replace(anchor_b, NOTE_B, 1)

    if not moved:
        NEW_A.write_text(text_a, encoding="utf-8")
        NEW_B.write_text(text_b, encoding="utf-8")
        OLD_A.unlink()
        OLD_B.unlink()

        # 4. 外部引用面
        for path, table in EXTERNAL:
            t = path.read_text(encoding="utf-8")
            path.write_text(apply(t, table, path.name), encoding="utf-8")
            print(f"[ok] 引用面同步: {path.relative_to(REPO)}")

    # 旧目录若空则移除
    old_dir = REPO / "docs/comfyui-kb/错题集"
    if old_dir.is_dir():
        try:
            old_dir.rmdir()
            print("[ok] 已移除空目录 docs/comfyui-kb/错题集/")
        except OSError:
            print("[warn] docs/comfyui-kb/错题集/ 非空,保留待查")

    # 6a. 链接可解析自检(两份迁入文档)
    import re
    bad = []
    for f in (NEW_A, NEW_B):
        base = f.parent
        for m in re.finditer(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", f.read_text(encoding="utf-8")):
            tgt = m.group(1)
            if tgt.startswith(("http://", "https://", "mailto:")):
                continue
            if not (base / tgt).exists():
                bad.append(f"{f.name} -> {tgt}")
    if bad:
        sys.exit("[abort] 迁入文档存在死链:\n" + "\n".join(bad))
    print("[ok] 迁入文档相对链接全部可解析")

    # 6b. 全仓旧路径残留扫描(白名单外必须为零)
    # 合法历史性提及:
    # - docs/错题集/ 两册的迁址注记与迁移记录(叙述旧位置,非活链接;活链接已另行解析验证)
    # - 本脚本自身的替换表;qi21_grip_terminal_sweep_1019.py=1019 一次性战役工具(留档不改)
    allow_exact = {
        "docs/错题集/作图错题集.md",
        "docs/错题集/README.md",
        "docs/错题集/12-毁风格词错题集.md",
        "apps/build/scripts/mistake_notebook_consolidate_1126.py",
        "apps/build/scripts/qi21_grip_terminal_sweep_1019.py",
    }
    stale: list[str] = []
    needles = ("comfyui-kb/错题集", "prompts/Qwen-Image-2.1/12-毁风格词错题集")
    for root in (REPO / "docs", REPO / "apps", REPO / "Library", REPO / "scripts"):
        if not root.is_dir():
            continue
        for p in root.rglob("*"):
            if p.is_dir() or p.suffix.lower() not in {
                ".md", ".py", ".ts", ".tsx", ".js", ".mjs", ".json", ".sh", ".html"
            }:
                continue
            rel = p.relative_to(REPO).as_posix()
            if any(rel.startswith(pre) for pre in ALLOW_STALE_PREFIX):
                continue
            if rel in allow_exact:
                continue
            try:
                t = p.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for nd in needles:
                if nd in t:
                    stale.append(f"{rel}: {nd}")
    if stale:
        sys.exit("[abort] 白名单外仍有旧路径引用:\n" + "\n".join(stale[:20]))
    print("[ok] 白名单外旧路径引用=0(docs 内零残留;apps/release 与 .trellis 档案在白名单)")

    # 6c. 点数(带数字的逐个数)
    n_a = sum(1 for ln in text_a.splitlines() if ln.startswith("### "))
    n_b = sum(1 for ln in text_b.splitlines() if ln.startswith("## "))
    print(f"[count] 作图错题集 条目(###)= {n_a}")
    print(f"[count] 12-毁风格词错题集 章节(##)= {n_b}")
    print("[done] 错题集归总完成: docs/错题集/{作图错题集,12-毁风格词错题集}")


if __name__ == "__main__":
    main()
