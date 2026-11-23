#!/usr/bin/env python3
"""GitNexus 索引新鲜度检查器(0928 立;1123 按实测改口径)。

背景(为什么需要这个门):0928 勘案发现索引落后 HEAD 16 提交期间,AGENTS.md 强制的
impact()/detect_changes() 门禁对最新代码全部失明(新函数 resolve_bridge_token 查无此人)——不查不知道。

1123 勘正:旧口径把「增量 analyze 静默 exit 1 + 中断标记」归因为多会话并发墙,并建议
「重跑直至标记清除」。实测推翻:根因是 gitnexus 1.6.6 在增量写入段的原生崩溃(全文索引
删除旧词条时 SIGBUS,与并发无关,改 1 个文件也会触发),重跑只会再崩并把索引库写坏,
之后所有会话新发起的查询都会崩。2026-11-23 已升级到 1.6.12,隔离副本实测增量刷新
(小提交 / 连续两次 / 删 40 改 30 加 20)全部通过。本脚本的检查项不变,只改了提示文字。

检查三件事(全部零 db 访问、零网络,~3 次 git 调用,毫秒级):
  1. lastCommit vs HEAD:落后 N 提交 = 门禁失明,须刷新;
  2. incrementalInProgress 标记:上次 analyze 没有收尾;
  3. lbug.wal 残留:提示性报告,非独立判据。

用法:
  python3 apps/build/scripts/gitnexus_freshness_check.py
      警告模式(默认):只打印,恒 exit 0 —— husky pre-commit 提交位用,绝不阻塞提交;
  python3 apps/build/scripts/gitnexus_freshness_check.py --strict
      严格模式:落后/中断/无索引/锚点失效时 exit 1 —— 收尾仪式/打包前用。

刷新命令(增量,带本地 onnx embeddings,无需 API key):
  node .gitnexus/run.cjs analyze --embeddings
"""

import argparse
import json
import os
import subprocess
import sys

REFRESH_CMD = "node .gitnexus/run.cjs analyze --embeddings"


def _git(repo_root, *args):
    """跑一次 git,返回 stdout(去尾换行);失败返回 None。"""
    try:
        out = subprocess.run(
            ["git", "-C", repo_root, *args],
            capture_output=True, text=True, timeout=10, check=True,
        )
        return out.stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return None


def main():
    ap = argparse.ArgumentParser(description="GitNexus 索引新鲜度检查(警告或 --strict 拦截)")
    ap.add_argument("--strict", action="store_true",
                    help="落后/中断/无索引时 exit 1(默认仅警告 exit 0)")
    ns = ap.parse_args()

    repo_root = _git(os.getcwd(), "rev-parse", "--show-toplevel")
    if repo_root is None:
        print("⚠️ GitNexus 检查跳过:当前不在 git 仓库内")
        sys.exit(0)

    meta_path = os.path.join(repo_root, ".gitnexus", "meta.json")
    if not os.path.isfile(meta_path):
        msg = "⚠️ GitNexus:本仓库未建索引(.gitnexus/meta.json 不存在)"
        print(msg + (";门禁 impact/detect_changes 不可用 → gitnexus analyze" if ns.strict else ""))
        sys.exit(1 if ns.strict else 0)

    try:
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
    except (json.JSONDecodeError, OSError):
        # meta.json 正在被并发 analyze 写半截也会走到这里——如实报,不猜
        print("⚠️ GitNexus:meta.json 读不出(可能正被 analyze 写入或损坏)→ 稍后重查:" + REFRESH_CMD)
        sys.exit(1 if ns.strict else 0)

    problems = []

    inprog = meta.get("incrementalInProgress")
    if isinstance(inprog, dict) and inprog.get("toWriteCount"):
        problems.append(
            f"存在中断的增量标记 incrementalInProgress(待写 {inprog.get('toWriteCount')} 文件,"
            "上次 analyze 未收尾)"
        )
    interrupted = bool(problems)

    head = _git(repo_root, "rev-parse", "HEAD")
    last = meta.get("lastCommit", "")
    if head and last:
        if head == last:
            pass  # 新鲜
        else:
            count = _git(repo_root, "rev-list", "--count", f"{last}..HEAD")
            if count is None:
                # lastCommit 不在当前历史(rebase/改写) → 锚点失效,等同过期
                problems.append(f"索引锚点 {last[:12]} 不在当前历史(可能 rebase 过)→ 全量刷新")
            else:
                problems.append(f"索引落后 HEAD {count} 提交(门禁对最新代码失明)")
    elif head:
        problems.append("meta.json 缺 lastCommit → 视为过期")

    wal = os.path.join(repo_root, ".gitnexus", "lbug.wal")
    wal_note = ""
    if os.path.isfile(wal):
        size = os.path.getsize(wal)
        if size > 1024 * 1024:
            wal_note = f"(注:lbug.wal {size // 1024}KB 残留;刷新成功后仍在 = 上次没有正常收尾,见 search-sop)"

    if problems:
        for p in problems:
            print(f"⚠️ GitNexus: {p}")
        if interrupted:
            # 中断标记不是「再跑一次就好」:先确认索引库还能不能打开,再决定刷新还是重建。
            # 判定方法见 .claude/knowledge/search-sop.md「GitNexus 索引刷新」一节。
            print("   上次刷新没有收尾。先确认没有 analyze 进程在跑,再用一个新进程试开索引库"
                  "(gitnexus context -r MYStudio <任一符号>):退出码 0 = 库还健康,可以刷新;"
                  "退出码 139 = 库已被写坏,任何新查询都会崩,须按 search-sop 的重建步骤处理。")
        print(f"   刷新: {REFRESH_CMD} {wal_note}".rstrip())
        sys.exit(1 if ns.strict else 0)

    emb = meta.get("stats", {}).get("embeddings", 0)
    print(f"✅ GitNexus 索引新鲜(HEAD {head[:12] if head else '?'},embeddings {emb}){wal_note}")
    sys.exit(0)


if __name__ == "__main__":
    main()
