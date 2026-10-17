#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
docs_archive_cleanup_1010.py —— 文档过时审计定谳·时点性历史文档归档战役

用途:
    2026-10-10 文档过时审计定谳后,将 27 件时点性历史文档移入各自域的档案目录
    (融合/panels/comfyui-kb/prompts/assets/guides/local 域用「档案/」,research 域并入
    既有「archive/」),并把活文档区指向它们的 markdown 链接与仓库相对路径字符串
    改写到新位置。纯文档战役,零代码改动。

身份: 一次性战役脚本(役毕留档,勿扩展复用)。日期: 2026-10-10。

模式:
    --check        (默认)干跑,零写盘。stdout 输出单行 JSON:
                   {moves, skipped, src_missing:[], dst_exists:[], internal_links,
                    inbound_files:[]}
                   - moves/skipped 为计数;src_missing/dst_exists 为异常清单;
                   - internal_links = 被移文件内部需改写的引用总数(markdown 链接命中
                     任一旧 src + 旧路径字符串出现次数);
                   - inbound_files = 活文档区中引用任一旧 src 的文件(相对仓库根,
                     已排除被移件自身/冻结件/排除区)。
    --apply        执行移动与改写:被 git 跟踪件用 git mv,未跟踪件用 shutil.move;
                   目标父目录不存在则创建;幂等(src 缺且 dst 在 → 计 skipped)。
                   移动后先改写被移文件内部引用,再改写活文档区入站引用。
    --verify-links 扫活文档区全部 .md,抽取相对 markdown 链接(http/https/#/mailto/data:
                   跳过,%xx 解码后判定)验证目标存在;坏链分两组输出:
                   moved_related(解析目标命中本清单旧 src 或新 dst,exit 1)与
                   preexisting(与本役无关,不影响退出码)。定位是 apply 后的收口验收。

铁律(违反即 bug):
    - 幂等,可安全重跑;绝不删除文件;
    - 绝不 git commit/push —— git 子命令仅允许 git mv 与 git ls-files;
    - 绝不触碰 .trellis/tasks/、.zcode/、campaigns/、apps/backend/engines/comfyui/workflows/;
    - 活文档区 = docs/ 全部 .md + .claude/ + .agents/ + .trellis/spec/ 下的 .md +
      根 README.md/README_EN.md/AGENTS.md + apps/ 下全部 .md;
      排除 .trellis/tasks/、apps 的 out/release/output/node_modules、任何 档案//archive/
      目录内文件;FROZEN 四件已冻结勿动,仅避让(不迁移、不改写、不扫链);
    - 改写仅限链接目标与旧路径字符串(%xx 编码形式解码判定,回写一律未编码中文路径),
      保留 #fragment,不得改变文件其它内容;字节级不动未命中的文件(含换行风格)。
"""

import argparse
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
from urllib.parse import unquote

# ---------------------------------------------------------------------------
# 仓库根:本脚本位于 apps/build/scripts/ 下
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, os.pardir, os.pardir))

# 待移清单(27 件,src→dst,仓库相对 posix 路径)
MOVES = [
    ("docs/融合/FFmpeg_AI开源漫剧短视频自动化计划.md", "docs/融合/档案/FFmpeg_AI开源漫剧短视频自动化计划.md"),
    ("docs/融合/MYStudio_Toonflow_工作流全链路追溯矩阵.md", "docs/融合/档案/MYStudio_Toonflow_工作流全链路追溯矩阵.md"),
    ("docs/融合/MYStudio_Toonflow_工作流缺口与分目标推进计划.md", "docs/融合/档案/MYStudio_Toonflow_工作流缺口与分目标推进计划.md"),
    ("docs/融合/Toonflow_MYStudio_分镜差异审计.md", "docs/融合/档案/Toonflow_MYStudio_分镜差异审计.md"),
    ("docs/融合/模板系统与ComfyUI集成方案.md", "docs/融合/档案/模板系统与ComfyUI集成方案.md"),
    ("docs/融合/第一章自动成片与多角色口播Trellis计划.md", "docs/融合/档案/第一章自动成片与多角色口播Trellis计划.md"),
    ("docs/融合/部署打包与工程化手册.md", "docs/融合/档案/部署打包与工程化手册.md"),
    ("docs/融合/配置中心升级与供应商能力方案.md", "docs/融合/档案/配置中心升级与供应商能力方案.md"),
    ("docs/research/EFFECT_GAPS_HANDOFF_2026-08-19.md", "docs/research/archive/EFFECT_GAPS_HANDOFF_2026-08-19.md"),
    ("docs/research/EFFECT_UPGRADE_PROMPT_2026-08-18.md", "docs/research/archive/EFFECT_UPGRADE_PROMPT_2026-08-18.md"),
    ("docs/research/H3_COMIC_DRAMA_ECOSYSTEM_RESEARCH_2026-09-14.md", "docs/research/archive/H3_COMIC_DRAMA_ECOSYSTEM_RESEARCH_2026-09-14.md"),
    ("docs/research/LAYER_SEPARATION_HANDOFF_2026-08-19.md", "docs/research/archive/LAYER_SEPARATION_HANDOFF_2026-08-19.md"),
    ("docs/research/LOCAL_IMAGE_GEN_ARCHITECTURE_PLAN_2026-08-31.md", "docs/research/archive/LOCAL_IMAGE_GEN_ARCHITECTURE_PLAN_2026-08-31.md"),
    ("docs/research/REFERENCES_MISSING_COMPILE_GATE_EVALUATION_2026-09-29.md", "docs/research/archive/REFERENCES_MISSING_COMPILE_GATE_EVALUATION_2026-09-29.md"),
    ("docs/research/UNIFIED_SEARCH_PLAN_2026-08-21.md", "docs/research/archive/UNIFIED_SEARCH_PLAN_2026-08-21.md"),
    ("docs/panels/ASSIST_WORKBENCH_GUIDE.md", "docs/panels/档案/ASSIST_WORKBENCH_GUIDE.md"),
    ("docs/panels/ASSIST_WORKBENCH_OPERATIONS.md", "docs/panels/档案/ASSIST_WORKBENCH_OPERATIONS.md"),
    ("docs/panels/ASSIST_WORKBENCH_PARAMETER_REFERENCE.md", "docs/panels/档案/ASSIST_WORKBENCH_PARAMETER_REFERENCE.md"),
    ("docs/comfyui-kb/DMAD-4步LoRA转制与单镜线换档-1003.md", "docs/comfyui-kb/档案/DMAD-4步LoRA转制与单镜线换档-1003.md"),
    ("docs/comfyui-kb/Q2-1中文PE六层破案与产线修复-1005.md", "docs/comfyui-kb/档案/Q2-1中文PE六层破案与产线修复-1005.md"),
    ("docs/comfyui-kb/albucore冲突解决-1003.md", "docs/comfyui-kb/档案/albucore冲突解决-1003.md"),
    ("docs/comfyui-kb/参考_提示词工程/社区skill归档说明-1001.md", "docs/comfyui-kb/参考_提示词工程/档案/社区skill归档说明-1001.md"),
    ("docs/comfyui-kb/参考_提示词工程/社区skill归档说明-1003.md", "docs/comfyui-kb/参考_提示词工程/档案/社区skill归档说明-1003.md"),
    ("docs/prompts/Qwen-Image-2.1/04-道劫风格适配.md", "docs/prompts/Qwen-Image-2.1/档案/04-道劫风格适配.md"),
    ("docs/assets/PROPS_LIBRARY_OPERATIONS.md", "docs/assets/档案/PROPS_LIBRARY_OPERATIONS.md"),
    ("docs/guides/CINEMATIC_PLAYBOOK.md", "docs/guides/档案/CINEMATIC_PLAYBOOK.md"),
    ("docs/local/minimax-h3-local-setup-plan.md", "docs/local/档案/minimax-h3-local-setup-plan.md"),
]
OLD_TO_NEW = dict(MOVES)
RELATED_PATHS = set(OLD_TO_NEW) | set(OLD_TO_NEW.values())  # verify-links 分组用

# 已冻结勿动(仅供避让):不迁移、不改写、不扫链
FROZEN = [
    "docs/prompts/道劫_新提示词包_0917.md",
    "docs/prompts/道劫_底座节点_0918.md",
    "docs/comfyui-kb/K2服饰LoRA调研_0919.md",
    "docs/research/PIPELINE_METHODS_ABSORPTION_ANALYSIS_2026-09-28.md",
]

# 排除规则(活文档区成员判定;目录段=路径中除最后一段外的各段)
GLOBAL_EXCLUDE_DIR_SEGS = {".git", ".zcode", "__pycache__", "档案", "archive", "campaigns"}
APPS_EXCLUDE_DIR_SEGS = {"out", "release", "output", "node_modules"}
NEVER_TOUCH_PREFIXES = (
    ".trellis/tasks/",
    ".zcode/",
    "campaigns/",
    "apps/backend/engines/comfyui/workflows/",
)
ROOT_MD_FILES = ("README.md", "README_EN.md", "AGENTS.md")
WALK_ROOTS = ("docs", ".claude", ".agents", ".trellis/spec", "apps")

# ---------------------------------------------------------------------------
# markdown 链接抽取/改写(inline 链接 + 引用式定义;title 保留;#fragment 保留)
INLINE_RE = re.compile(
    r"(?P<pre>\[[^\]]*\]\()(?P<ws>\s*)"
    r"(?:(?P<ang><[^>]*>)|(?P<bare>[^)\s>]+))"
    r"(?P<tail>\s*(?:\"[^\"]*\")?\s*\))"
)
REFDEF_RE = re.compile(
    r"(?P<pre>^[ \t]{0,3}\[[^\]]+\]:[ \t]*)"
    r"(?:(?P<ang><[^>]*>)|(?P<bare>\S+))",
    re.M,
)
SCHEME_SKIP = ("http://", "https://", "mailto:", "data:")


def abs_of(rel: str) -> str:
    return os.path.join(REPO_ROOT, *rel.split("/"))


def load_text(path: str) -> str:
    # newline='' + surrogateescape:字节级忠实读入(保留 CJK/原换行风格/非常规字节)
    with open(path, "r", encoding="utf-8", errors="surrogateescape", newline="") as f:
        return f.read()


def save_text(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", errors="surrogateescape", newline="") as f:
        f.write(text)


def is_live(rel: str) -> bool:
    """活文档区成员判定(含全部排除规则与冻结避让)。"""
    if rel in FROZEN:
        return False
    for pref in NEVER_TOUCH_PREFIXES:
        if rel.startswith(pref):
            return False
    parts = rel.split("/")
    dirs = parts[:-1]
    if any(seg in GLOBAL_EXCLUDE_DIR_SEGS for seg in dirs):
        return False
    if parts[0] == "apps" and any(seg in APPS_EXCLUDE_DIR_SEGS for seg in dirs):
        return False
    return True


def collect_live_md_files() -> list:
    """活文档区全部 .md(仓库相对 posix 路径,排序去重)。"""
    found = []
    for root_name in WALK_ROOTS:
        base = os.path.join(REPO_ROOT, root_name)
        if not os.path.isdir(base):
            continue
        prune = set(GLOBAL_EXCLUDE_DIR_SEGS) | {"__pycache__"}
        if root_name == "apps":
            prune |= APPS_EXCLUDE_DIR_SEGS
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in prune]
            for fn in filenames:
                if not fn.endswith(".md"):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), REPO_ROOT).replace(os.sep, "/")
                if is_live(rel):
                    found.append(rel)
    for name in ROOT_MD_FILES:
        if os.path.isfile(abs_of(name)) and is_live(name):
            found.append(name)
    return sorted(set(found))


# ---------------------------------------------------------------------------
def map_link_target(token: str, resolve_dir: str, generate_dir: str):
    """单个链接目标映射:按 resolve_dir(旧位置目录)解析,命中任一旧 src 则
    返回按 generate_dir(新位置目录)出发的未编码相对路径(保留 #fragment);
    未命中返回 None。"""
    target, sep, frag = token.partition("#")
    if not target:
        return None
    if target.lower().startswith(SCHEME_SKIP):
        return None
    decoded = unquote(target)  # %xx URL 编码形式解码后判定
    joined = decoded if not resolve_dir else resolve_dir + "/" + decoded
    resolved = posixpath.normpath(joined)
    new_abs = OLD_TO_NEW.get(resolved)
    if new_abs is None:
        return None
    rel = posixpath.relpath(new_abs, generate_dir if generate_dir else ".")
    return rel + (sep + frag if sep else "")


def _repl_factory(resolve_dir: str, generate_dir: str, counter: list):
    def repl(m: "re.Match") -> str:
        gd = m.groupdict()  # inline 与 refdef 两组捕获不同,tail/ws 仅 inline 有
        token = gd.get("ang")
        if token is not None:
            token = token[1:-1]
        else:
            token = gd["bare"]
        new = map_link_target(token, resolve_dir, generate_dir)
        if new is None or new == token:  # 未命中,或幂等重跑时已是目标形态 → 原样保留
            return m.group(0)
        counter[0] += 1
        return m.group("pre") + (gd.get("ws") or "") + new + (gd.get("tail") or "")
    return repl


def rewrite_markdown_links(text: str, resolve_dir: str, generate_dir: str):
    """改写文本中命中旧 src 的 markdown 链接目标。返回(新文本, 命中数)。"""
    counter = [0]
    repl = _repl_factory(resolve_dir, generate_dir, counter)
    text = INLINE_RE.sub(repl, text)
    text = REFDEF_RE.sub(repl, text)
    return text, counter[0]


def replace_plain_paths(text: str):
    """正文中的仓库相对路径字符串(形如 docs/融合/xxx.md)凡等于任一旧 src,
    直接替换为新仓库相对路径。前边界放行两种形态:独立串(前一字符非路径字符)与
    `<repo-root>/` 占位符前缀(前两字符为 `>/`);其余更长路径的子串(apps/docs/…、
    URL 路径等)一律不命中。后边界守卫同理。返回(新文本, 替换数)。"""
    total = 0
    for old, new in MOVES:
        pat = re.compile(
            r"(?:(?<![A-Za-z0-9_.\-/])|(?<=>/))"
            + re.escape(old)
            + r"(?![A-Za-z0-9_.\-/])"
        )
        text, n = pat.subn(new, text)
        total += n
    return text, total


def scan_file_refs(text: str, base_dir: str):
    """干跑用:统计该文本中命中旧 src 的引用数(链接 + 路径字符串),不改文本。"""
    _, h_links = rewrite_markdown_links(text, base_dir, base_dir)
    _, h_plain = replace_plain_paths(text)
    return h_links + h_plain


# ---------------------------------------------------------------------------
def git_tracked(rel: str) -> bool:
    r = subprocess.run(
        ["git", "ls-files", "--", rel], cwd=REPO_ROOT, capture_output=True, text=True
    )
    if r.returncode != 0:
        raise RuntimeError(f"git ls-files 失败({rel}): {r.stderr.strip()}")
    return bool(r.stdout.strip())


def git_mv(src_rel: str, dst_rel: str) -> None:
    r = subprocess.run(
        ["git", "mv", "--", src_rel, dst_rel], cwd=REPO_ROOT, capture_output=True, text=True
    )
    if r.returncode != 0:
        raise RuntimeError(f"git mv 失败({src_rel} → {dst_rel}): {r.stderr.strip()}")


def plan_moves():
    """幂等计划:返回(moves, skipped, src_missing, dst_exists),元素为 (old,new)/old。"""
    moves, skipped, src_missing, dst_exists = [], [], [], []
    for old, new in MOVES:
        s_exists = os.path.exists(abs_of(old))
        d_exists = os.path.exists(abs_of(new))
        if s_exists and d_exists:
            dst_exists.append(old)
        elif s_exists:
            moves.append((old, new))
        elif d_exists:
            skipped.append((old, new))  # 已迁移过(幂等重跑)
        else:
            src_missing.append(old)
    return moves, skipped, src_missing, dst_exists


# ---------------------------------------------------------------------------
def cmd_check() -> int:
    moves, skipped, src_missing, dst_exists = plan_moves()
    internal_links = 0
    for old, new in moves + skipped:
        # 被移件内部引用:内容在现存位置(src 优先),按旧位置解析、按新位置生成
        path = abs_of(old) if os.path.exists(abs_of(old)) else abs_of(new)
        if not os.path.exists(path):
            continue
        text = load_text(path)
        _, h = rewrite_markdown_links(text, posixpath.dirname(old), posixpath.dirname(new))
        _, hp = replace_plain_paths(text)
        internal_links += h + hp
    inbound_files = []
    for rel in collect_live_md_files():
        if rel in OLD_TO_NEW:  # 被移件自身不算入站引用
            continue
        if scan_file_refs(load_text(abs_of(rel)), posixpath.dirname(rel)):
            inbound_files.append(rel)
    print(json.dumps({
        "moves": len(moves),
        "skipped": len(skipped),
        "src_missing": src_missing,
        "dst_exists": dst_exists,
        "internal_links": internal_links,
        "inbound_files": sorted(inbound_files),
    }, ensure_ascii=False))
    return 1 if (src_missing or dst_exists) else 0


def cmd_apply() -> int:
    moves, skipped, src_missing, dst_exists = plan_moves()
    if src_missing or dst_exists:
        print(json.dumps({
            "error": "清单与仓库现状不符,拒绝执行(不移动任何文件)",
            "src_missing": src_missing,
            "dst_exists": dst_exists,
        }, ensure_ascii=False))
        return 2

    git_mv_n = shutil_n = 0
    for old, new in moves:
        dst_abs = abs_of(new)
        parent = os.path.dirname(dst_abs)
        if parent:
            os.makedirs(parent, exist_ok=True)  # 目标父目录不存在则创建
        if git_tracked(old):
            git_mv(old, new)
            git_mv_n += 1
        else:
            shutil.move(abs_of(old), dst_abs)
            shutil_n += 1

    # b) 被移件内部引用改写(含幂等补刀:上次运行若在移动后中断,重跑补齐)
    internal_rewrites = 0
    internal_files = []
    for old, new in MOVES:
        path = abs_of(new)
        if not os.path.exists(path):
            continue
        text = load_text(path)
        t, h = rewrite_markdown_links(text, posixpath.dirname(old), posixpath.dirname(new))
        t, hp = replace_plain_paths(t)
        if t != text:
            save_text(path, t)
            internal_rewrites += h + hp
            internal_files.append(new)

    # c) 活文档区入站引用改写
    inbound_rewrites = 0
    inbound_rewritten = []
    for rel in collect_live_md_files():
        if rel in OLD_TO_NEW:
            continue
        text = load_text(abs_of(rel))
        base = posixpath.dirname(rel)
        t, h = rewrite_markdown_links(text, base, base)
        t, hp = replace_plain_paths(t)
        if t != text:
            save_text(abs_of(rel), t)
            inbound_rewrites += h + hp
            inbound_rewritten.append(rel)

    print(json.dumps({
        "moved": len(moves),
        "skipped": len(skipped),
        "git_mv": git_mv_n,
        "shutil_move": shutil_n,
        "internal_rewrites": internal_rewrites,
        "internal_files": internal_files,
        "inbound_rewrites": inbound_rewrites,
        "inbound_rewritten": sorted(inbound_rewritten),
    }, ensure_ascii=False))
    return 0


def cmd_verify_links() -> int:
    live = collect_live_md_files()
    moved_related, preexisting = [], []
    for rel in live:
        text = load_text(abs_of(rel))
        base = posixpath.dirname(rel)
        for m in INLINE_RE.finditer(text):
            token = m.group("ang")
            token = token[1:-1] if token is not None else m.group("bare")
            _classify_link(token, base, rel, moved_related, preexisting)
        for m in REFDEF_RE.finditer(text):
            token = m.group("ang")
            token = token[1:-1] if token is not None else m.group("bare")
            _classify_link(token, base, rel, moved_related, preexisting)
    print(json.dumps({
        "scanned": len(live),
        "moved_related": moved_related,
        "preexisting": preexisting,
        "preexisting_count": len(preexisting),
    }, ensure_ascii=False))
    return 1 if moved_related else 0


def _classify_link(token, base, rel, moved_related, preexisting):
    target = token.partition("#")[0]
    if not target or target.lower().startswith(SCHEME_SKIP):
        return
    decoded = unquote(target)
    if decoded.startswith("/"):  # 仓库根绝对式链接按仓库根解析
        resolved = posixpath.normpath(decoded.lstrip("/"))
    else:
        resolved = posixpath.normpath(base + "/" + decoded if base else decoded)
    if os.path.exists(abs_of(resolved)):
        return
    entry = {"file": rel, "link": token, "resolved": resolved}
    if resolved in RELATED_PATHS:
        moved_related.append(entry)
    else:
        preexisting.append(entry)


# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="2026-10-10 文档归档战役:27 件时点性历史文档移入档案目录并改写引用(一次性脚本)"
    )
    g = parser.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true", help="干跑(默认):零写盘,输出计划 JSON")
    g.add_argument("--apply", action="store_true", help="执行移动与引用改写(幂等)")
    g.add_argument("--verify-links", action="store_true",
                   help="验证活文档区相对链接目标存在;moved_related 坏链非空则 exit 1")
    args = parser.parse_args(argv)
    if args.apply:
        return cmd_apply()
    if args.verify_links:
        return cmd_verify_links()
    return cmd_check()


if __name__ == "__main__":
    sys.exit(main())
