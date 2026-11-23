#!/usr/bin/env python3
"""GitNexus 索引新鲜度与完整性检查器(0928 立;1123 改口径;1124 按内容判断并改刷新方式)。

背景(为什么需要这个门):0928 勘案发现索引落后 HEAD 16 提交期间,AGENTS.md 强制的
impact()/detect_changes() 门禁对最新代码全部失明(新函数 resolve_bridge_token 查无此人)——不查不知道。

1123 勘正:旧口径把「增量 analyze 静默 exit 1 + 中断标记」归因为多会话并发墙,并建议
「重跑直至标记清除」。实测推翻:根因是 gitnexus 1.6.6 在增量写入段的原生崩溃,重跑只会再崩。
同日升级到 1.6.12,当时据「退出码 0、无崩溃」判断增量刷新安全——这个判断是错的。

1124 经过(三个口径,现行的是最后一个):
  * 00:41 在 gitnexus 1.6.12 上跑增量,索引被写坏:索引范围内无并发写入、被收文件全部是合法 UTF-8,
    File 表 6,648 行里 5,879 行的 id 与 filePath 变成空串,Const 表 4,661 行、Method 表 3,757 行同样,
    Function 表正文出现非法字符,全文索引两张表没建成。上游 #3421、#3958 是同一类问题。
    「新进程试开库退出码 0」只说明库能打开,不代表内容完好——所以有了下面的完整性检查。
  * 「过期」改按内容判断,不再只比提交号。索引收录的是磁盘上的文件,索引器在 meta.json 里
    记了每个被收录文件的内容哈希(SHA-256)。本机同时有二十来个会话在提交,只比提交号的话
    重建一结束就「落后」,而一次重建要 10–35 分钟,永远追不上;提交号落后但被收录的文件内容
    都没变,索引就是最新的。
  * 增量刷新只在「实测完好」的版本上用,版本逐个登记在 VERIFIED_INCREMENTAL_VERSIONS,不看版本号大小
    (预发布版之间代码差异可能很大)。2026-11-24 对 1.6.13-rc.96(数据库组件 0.21.1)实测完好:隔离副本
    五轮(改 1 / 增 2 删 3 / 改 39 增 10 删 20 / 空增量 / 带原子开关改 1)与真仓库一轮,每轮之后各表
    编号为空的行都是 0、全文索引无失败、语义向量不丢。证据只有六轮,所以:每次刷新之后都跑一遍
    --strict;检查报损坏时全量重建。
  * 没登记的版本:1.6.12 的增量会把索引写坏;1.6.6 的增量原生崩溃;1.6.13-rc.252(数据库组件 0.22.0,
    2026-11-24 04:50 由另一会话装到本机)的全量重建在本机死锁——两个仓库各复现一次,进程停在建库之后
    CPU 归零、不再结束,其增量刷新因此未能验证。要放行一个新版本:先在隔离副本里实测,通过后登记。
  * 本脚本会同时核对「建索引的工具」与「当前安装的工具」,两者都在清单里才提示增量。只看前者不够:
    工具被换掉之后,真正去写索引的是当前安装的那个。

检查(全部只读):
  1. 内容比对:meta.fileHashes 里的每个文件,逐个重算 SHA-256;文件没了算「删」,内容不同算「改」;
     索引之后新出现、应当被收录的文件算「新增」。
  2. 完整性(两次只读 COUNT 查询,约 1 秒):apps/ 下的文件节点数不应少于 git 跟踪的源码文件数;
     不应有 id 或路径为空的 File 行(1.6.12 写坏事故的直接特征)。
  3. 中文切分设置是否一致:索引是用 GITNEXUS_FTS_CJK_SEGMENTATION=bigram 建的,刷新它的进程
     也必须带同一个设置,否则工具会先做一次全量重建把模式翻回去(11-24 实测 23 分钟)。
  4. 增量刷新的保护:索引元数据里记着建索引的工具版本,再读一次当前安装的工具版本;两者不都在
     实测清单里时,不提示增量,只提示全量重建。
  5. incrementalInProgress 标记:上次 analyze 没有收尾。
  6. lbug.wal 残留:提示性报告,非独立判据。

用法:
  python3 apps/build/scripts/gitnexus_freshness_check.py
      警告模式(默认):只打印,恒 exit 0 —— husky pre-commit 提交位用,绝不阻塞提交;
  python3 apps/build/scripts/gitnexus_freshness_check.py --strict
      严格模式:内容过期/索引损坏/设置不一致/中断/无索引时 exit 1 —— 收尾仪式/打包前用。

刷新命令(--index-only 是不让工具在刷新结束时往仓库里重写说明文件和技能文件,那些文件里的指引
已经按本机实况改正;GITNEXUS_ATOMIC_INCREMENTAL=1 是让增量先写副本、完成后再整体替换,中途失败
不伤现有库):
  GITNEXUS_FTS_CJK_SEGMENTATION=bigram GITNEXUS_ATOMIC_INCREMENTAL=1 \
    node .gitnexus/run.cjs analyze --embeddings 0 --index-only
      增量刷新,2026-11-24 实测 37 秒(改 1 件);只处理变过的文件,语义向量保留
  GITNEXUS_FTS_CJK_SEGMENTATION=bigram node .gitnexus/run.cjs analyze --force --embeddings 0 --index-only
      全量重建,例行约 10 分钟;首次建索引或向量缓存不可用时约 23–35 分钟
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

BIGRAM_ENV = "GITNEXUS_FTS_CJK_SEGMENTATION=bigram"
FULL_CMD = f"{BIGRAM_ENV} node .gitnexus/run.cjs analyze --force --embeddings 0 --index-only"
INCR_CMD = (f"{BIGRAM_ENV} GITNEXUS_ATOMIC_INCREMENTAL=1 "
            "node .gitnexus/run.cjs analyze --embeddings 0 --index-only")
REFRESH_CMD = INCR_CMD
# 增量刷新「实测完好」的版本,逐个登记。预发布版之间代码差异可能很大,不能按版本号大小放行:
#   1.6.13-rc.96  —— 2026-11-24:隔离副本五轮 + 真仓库一轮,各表编号为空的行都是 0、全文索引无失败
# 没登记的版本一律不提示增量:1.6.12 的增量会把索引写坏(上游 #3421、#3958),1.6.6 的增量原生崩溃。
VERIFIED_INCREMENTAL_VERSIONS = {"1.6.13-rc.96"}
# 已知有问题的版本(实测)。当前安装的工具命中时,本脚本不给刷新命令,只给警告:
#   1.6.13-rc.252 —— 全量重建在本机死锁(2026-11-24,两个仓库各复现一次:进程停在建库之后 CPU 归零、不结束)
KNOWN_BAD_VERSIONS = {
    "1.6.13-rc.252": "全量重建在本机死锁(2026-11-24 两个仓库各复现一次,进程停在建库之后 CPU 归零、不结束)",
}
ENV_NOTE = (f"   刷新进程必须带 {BIGRAM_ENV}:索引是用这个设置建的(中文关键词检索),不带的话工具会先做一次"
            "全量重建把设置翻回去。")


def _indexer_version(meta):
    """建这个索引的工具版本号(原始字符串,如 '1.6.13-rc.252');没有记录时返回空串。"""
    return str((meta.get("runnerIdentity") or {}).get("cliVersion") or "").strip()


def _installed_version():
    """当前安装的 gitnexus 的版本号(真正去执行刷新的就是它);取不到返回空串。"""
    try:
        out = subprocess.run(["gitnexus", "--version"], capture_output=True, text=True, timeout=20).stdout
    except (subprocess.SubprocessError, OSError):
        return ""
    m = re.search(r"(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)", out)
    return m.group(1) if m else ""


def _incremental_allowed(indexer_version, installed_version):
    """只有「建索引的工具」和「当前安装的工具」都在实测清单里,才提示增量刷新。

    索引是谁建的、谁来写,两者都要验过:2026-11-24 另一个会话把全局工具从 rc.96 换成 rc.252 时,
    只看「索引是 1.6.13 建的」就会对一个没验证过的版本放行增量。任一侧读不出版本号时不允许。
    """
    return indexer_version in VERIFIED_INCREMENTAL_VERSIONS and installed_version in VERIFIED_INCREMENTAL_VERSIONS


MAX_FILE_BYTES = 512 * 1024  # 索引器跳过超过 512KB 的文件
# 点开头的目录、vendor、测试夹具等是索引器的默认排除,不参与「新增」判断
EXCLUDED_PARTS = {".git", ".gitnexus", "node_modules", "vendor", "fixtures", "__tests__", "__pycache__",
                  "dist", "out", "output", "release", "coverage", ".vite", "build", "target", ".next"}
SOURCE_EXTS = (".ts", ".tsx", ".py", ".mjs", ".cjs", ".js", ".jsx", ".sh", ".ps1", ".swift", ".rs",
               ".c", ".cpp", ".h", ".hpp", ".java", ".go", ".rb", ".sql", ".json", ".md", ".yaml",
               ".yml", ".toml", ".css", ".scss", ".html", ".txt", ".vue", ".svelte")


def _git(repo_root, *args, stdin=None):
    """跑一次 git,返回 stdout bytes;失败返回 None。"""
    try:
        out = subprocess.run(
            ["git", "-C", repo_root, *args],
            input=stdin, capture_output=True, timeout=60, check=True,
        )
        return out.stdout
    except (subprocess.SubprocessError, OSError):
        return None


def _git_text(repo_root, *args):
    out = _git(repo_root, *args)
    return out.decode("utf-8", "surrogateescape").strip() if out is not None else None


def _file_count(repo_root, where):
    """索引里满足条件的 File 节点数(一次只读 COUNT 查询)。取不到返回 None。

    查询里不要写 < 或 >:命令行入口会把带这两个符号的查询弄坏(多出一层引号)。
    """
    query = f"MATCH (f:File) WHERE {where} RETURN count(f)"
    try:
        proc = subprocess.run(
            ["gitnexus", "cypher", "-r", "MYStudio", query],
            capture_output=True, text=True, timeout=60, cwd=repo_root,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    if proc.returncode != 0:
        return None
    out = proc.stdout
    # 1.6.12 起输出前面有一行标题;真正的 JSON 从 {"markdown" 那段开始
    i = out.find('{\n  "markdown"')
    if i < 0:
        i = out.find("{")
    j = out.rfind("}")
    try:
        cell = json.loads(out[i:j + 1])["markdown"].split("\n")[-1].strip().strip("| ").strip()
        return int(cell)
    except (ValueError, KeyError, IndexError):
        return None


def _indexable(rel):
    """路径是否属于索引器默认会考虑的范围(粗判,只用于「新增」候选)。"""
    parts = rel.split("/")
    if any(p in EXCLUDED_PARTS for p in parts[:-1]):
        # 名为 build 的目录默认被跳过,唯独 apps/build 由仓库根 .gitnexusignore 放开
        if not rel.startswith("apps/build/") or any(p in EXCLUDED_PARTS - {"build"} for p in parts[:-1]):
            return False
    if any(p.startswith(".") for p in parts[:-1]):
        return False
    return rel.lower().endswith(SOURCE_EXTS)


def _content_drift(repo_root, meta, last_commit, head):
    """返回 (改过的文件, 被删的文件, 新出现的文件)。取不到 fileHashes 时返回 None。"""
    hashes = meta.get("fileHashes")
    if not isinstance(hashes, dict) or not hashes:
        return None
    changed, deleted = [], []
    for rel, digest in hashes.items():
        try:
            with open(os.path.join(repo_root, rel), "rb") as f:
                data = f.read()
        except OSError:
            deleted.append(rel)
            continue
        if hashlib.sha256(data).hexdigest() != digest:
            changed.append(rel)
    # 新增:索引之后才出现的文件。两个来源——索引那次提交之后新增的已跟踪文件,和未跟踪、未被忽略的文件
    raw = _git(repo_root, "ls-files", "-z", "--others", "--exclude-standard", "--", "apps", "docs")
    candidates = set(p.decode("utf-8", "surrogateescape") for p in raw.split(b"\0") if p) if raw is not None else set()
    if last_commit and head and last_commit != head:
        raw = _git(repo_root, "diff", "--name-only", "-z", "--diff-filter=A", f"{last_commit}..{head}")
        if raw is not None:
            candidates.update(p.decode("utf-8", "surrogateescape") for p in raw.split(b"\0") if p)
    candidates = sorted(p for p in candidates if p not in hashes and _indexable(p))
    # apps/build/scripts/campaigns 被 .gitignore 忽略、却被索引器按类型收录,上面的「未忽略」取不到它,单独补上
    added = [p for p in candidates
             if os.path.isfile(os.path.join(repo_root, p))
             and os.path.getsize(os.path.join(repo_root, p)) <= MAX_FILE_BYTES]
    return changed, deleted, added


def main():
    ap = argparse.ArgumentParser(description="GitNexus 索引新鲜度与完整性检查(警告或 --strict 拦截)")
    ap.add_argument("--strict", action="store_true",
                    help="内容过期/索引损坏/中断/无索引时 exit 1(默认仅警告 exit 0)")
    ns = ap.parse_args()

    repo_root = _git_text(os.getcwd(), "rev-parse", "--show-toplevel")
    if repo_root is None:
        print("⚠️ GitNexus 检查跳过:当前不在 git 仓库内")
        sys.exit(0)

    meta_path = os.path.join(repo_root, ".gitnexus", "meta.json")
    if not os.path.isfile(meta_path):
        msg = "⚠️ GitNexus:本仓库未建索引(.gitnexus/meta.json 不存在)"
        print(msg + (f";门禁 impact/detect_changes 不可用 → {REFRESH_CMD}" if ns.strict else ""))
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
            f"存在中断的刷新标记 incrementalInProgress(待写 {inprog.get('toWriteCount')} 文件,上次 analyze 未收尾)"
        )

    head = _git_text(repo_root, "rev-parse", "HEAD")
    last = meta.get("lastCommit", "") or ""
    behind = None  # None = 提交号已对齐或无法判断
    if head and last:
        if head != last:
            behind = _git_text(repo_root, "rev-list", "--count", f"{last}..HEAD")
            if behind is None:
                # lastCommit 不在当前历史(rebase/改写) → 锚点失效,等同过期
                problems.append(f"索引锚点 {last[:12]} 不在当前历史(可能 rebase 过)→ 全量刷新")
    elif head:
        problems.append("meta.json 缺 lastCommit → 视为过期")

    drift = _content_drift(repo_root, meta, last, head) if not problems else None
    samples = []
    if drift is not None:
        changed, deleted, added = drift
        if changed or deleted or added:
            total = len(changed) + len(deleted) + len(added)
            problems.append(
                f"索引建立之后有 {total} 个文件变过(改 {len(changed)} / 删 {len(deleted)} / 新增 {len(added)}),"
                "这些改动不在索引里(按文件查不到或查到旧内容,改前影响分析会漏报)"
            )
            samples = (changed + deleted + added)[:5]

    wal = os.path.join(repo_root, ".gitnexus", "lbug.wal")
    wal_note = ""
    if os.path.isfile(wal):
        size = os.path.getsize(wal)
        if size > 1024 * 1024:
            wal_note = f"(注:lbug.wal {size // 1024}KB 残留;刷新成功后仍在 = 上次没有正常收尾,见 search-sop)"

    integrity = _check_index_integrity(repo_root, _tracked_source_count(repo_root))
    emb = meta.get("stats", {}).get("embeddings", 0)
    indexed = str(meta.get("indexedAt") or "")[:19].replace("T", " ")
    indexer_version = _indexer_version(meta)
    installed_version = _installed_version()
    incremental_ok = _incremental_allowed(indexer_version, installed_version)
    version_text = indexer_version or "读不出"
    bad_installed = KNOWN_BAD_VERSIONS.get(installed_version, "")

    # 索引不是用 bigram 建的 → 中文关键词检索不生效。这是索引本身的状态,任何时候都报。
    if meta.get("cjkSegmentation", "none") != "bigram":
        integrity.append(
            "⚠️ GitNexus:索引不是用中文切分(bigram)建的,中文关键词检索会返回 0 条。"
            + (f"带 {BIGRAM_ENV} 做一次全量重建即可开启:{FULL_CMD}" if not bad_installed
               else "需要一次全量重建才能开启,但当前安装的工具版本有已知问题,先看下方警告。")
        )

    if problems:
        for p in problems:
            print(f"⚠️ GitNexus: {p}")
        for p in samples:
            print(f"      {p}")
        if any("incrementalInProgress" in p for p in problems):
            # 中断不等于「再跑一次就好」。库能打开也不代表内容完好:2026-11-24 实测
            # 试开库退出码 0,同时 File 表已有 5,879 行被写坏。先看下方完整性结果再决定怎么恢复。
            print("   上次刷新没有收尾。下方若报「编号或路径是空的」或 apps/ 下文件节点过少,索引已被写坏,只能全量重建;"
                  "若完整性正常,再跑一次刷新即可。")
        if bad_installed:
            # 工具本身有已知问题:给出的任何刷新命令都可能把人带进坑里,所以只警告
            print(f"⛔ 当前安装的 gitnexus {installed_version} 有已知问题:{bad_installed}。"
                  "现在不要刷新索引(全量重建与增量都不要跑)。"
                  "先把工具换回实测完好的版本,再按本脚本的提示刷新;"
                  "详见 .claude/knowledge/search-sop.md「GitNexus 索引刷新」。")
        elif integrity:
            # 索引坏了、设置不对:只给全量重建
            print(f"   刷新(全量重建,例行约 10 分钟,向量缓存不可用时约 23–35 分钟;期间查询不受影响): {FULL_CMD} {wal_note}".rstrip())
        elif incremental_ok:
            print(f"   刷新(增量,2026-11-24 实测 37 秒;期间查询不受影响): {INCR_CMD} {wal_note}".rstrip())
            print("   跑完后再跑一遍本脚本确认完整性(它认得出索引被写坏的特征)。")
        else:
            print(f"   刷新(全量重建,例行约 10 分钟;期间查询不受影响): {FULL_CMD} {wal_note}".rstrip())
            print(f"   只做全量重建:增量刷新只在实测完好的版本上用——建索引的工具与当前安装的工具都要在清单里。"
                  f"建索引的工具 {version_text};当前安装的工具 {installed_version or '读不出'};"
                  f"实测清单 {'、'.join(sorted(VERIFIED_INCREMENTAL_VERSIONS))}。")
            print("   换了新版本想恢复用增量:先在隔离副本里实测,通过后把版本号登记进本脚本的 VERIFIED_INCREMENTAL_VERSIONS。")
        if os.environ.get("GITNEXUS_FTS_CJK_SEGMENTATION", "").strip().lower() != "bigram":
            # 只在索引过期、需要刷新时提一句:检查进程(如提交钩子)本身不需要带这个变量,
            # 每次提交都报就成了噪音;而要拿上面那条命令去刷新时,变量已经在命令里。
            print(ENV_NOTE)
        for note in integrity:
            print(note)
        sys.exit(1 if ns.strict else 0)

    if bad_installed:
        print(f"⛔ 当前安装的 gitnexus {installed_version} 有已知问题:{bad_installed}。索引现在可用,但过期后先别刷新,"
              "先把工具换回实测完好的版本;详见 .claude/knowledge/search-sop.md「GitNexus 索引刷新」。")
    if behind is not None:
        print(f"✅ GitNexus 索引内容是最新的(提交号落后 {behind} 笔,但被收录的文件在建立索引({indexed}Z)之后没有变过;"
              f"embeddings {emb}){wal_note}")
    else:
        print(f"✅ GitNexus 索引新鲜(HEAD {head[:12] if head else '?'},embeddings {emb},"
              f"建索引的工具 {version_text}){wal_note}")
    for note in integrity:
        print(note)
    if integrity:
        sys.exit(1 if ns.strict else 0)


def _tracked_source_count(repo_root):
    """git 跟踪的、索引器应当收录的源码文件数(不含点开头目录、vendor、测试夹具)。"""
    out = _git_text(repo_root, "ls-files", "--", "apps")
    if out is None:
        return None
    code_ext = (".ts", ".tsx", ".py", ".mjs", ".cjs", ".js", ".jsx", ".sh", ".ps1")
    n = 0
    for path in out.split("\n"):
        if not path:
            continue
        if path.startswith(".") or "/vendor/" in path or "/fixtures/" in path or "/__tests__/" in path:
            continue
        if path.lower().endswith(code_ext):
            n += 1
    return n


def _check_index_integrity(repo_root, tracked):
    """索引「新鲜」只说明内容对得上,不代表库本身完好。返回提示文字列表;正常或无法判断时为空。

    两次真实事故(索引自报新鲜或能正常打开):
      - 2026-11-23:apps/ 下的文件节点只剩 323 个(健康时 6,000 以上),按文件查全是空。
        这里拿「apps/ 下的文件节点数」和 git 跟踪的源码数比:健康时前者不小于后者。
        不能用「文件节点总数」判断:写坏的行也计在总数里,总数并不低。
      - 2026-11-24:增量刷新把 File 表 5,879 行的 id 与 filePath 写成空串。
    """
    notes = []
    apps_indexed = _file_count(repo_root, "f.filePath STARTS WITH 'apps/'")
    if tracked is not None and apps_indexed is not None and apps_indexed < tracked:
        notes.append(
            f"⚠️ GitNexus:索引里 apps/ 下的文件节点只有 {apps_indexed} 个,少于 git 跟踪的源码文件 {tracked} 个;"
            "索引不完整(按文件查会是空,改前影响分析会漏报)。"
        )
    broken = _file_count(repo_root, "f.id = '' OR f.filePath = ''")
    if broken:
        notes.append(
            f"⚠️ GitNexus:索引里有 {broken} 个文件节点的编号或路径是空的(正常应为 0),索引已被写坏。"
        )
    if notes:
        notes.append(f"   恢复办法只有全量重建(索引被写坏后约 23–35 分钟;期间查询不受影响): {FULL_CMD}")
        notes.append(ENV_NOTE)
    return notes


if __name__ == "__main__":
    main()
