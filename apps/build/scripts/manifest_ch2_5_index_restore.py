#!/usr/bin/env python3
"""manifest_ch2_5_index_restore.py — 漫影项目册 chapterIndex 第2-5章索引行恢复(2026-11-15,v2)。

背景:IP/MA 项目册 manifest.json 的 chapterIndex(数组,现 4121 条)缺
chapter-002..005 四条索引行。本脚本只补这 4 条轻索引行——shards、
activeChapterId、其余 chapterIndex 条目一律不动(任务书红线)。

分片现状(2026-11-15 盘上实读,manifest.shards 逐章核账):
- chapter-002:4 条引用,含 novel-chapters-001-7d62f4f2.json(正文可装载);
- chapter-003/004/005:各仅 entity-extractions 一条,三章目录内也无孤儿
  novel 分片文件(ls 实查)→ 装载只信 manifest.shards
  (project-storage.ts:318 loadStudioChapterWorkspace 按 manifest.shards 过滤,
  合并无 novelChapters 则 novelChapter=null),切章 null 回退索引 stub
  (studio-store.ts:376-377)→ 本恢复后第3/4/5章=列表可见但正文空壳。
  此洞在本方案(shards 不许动)内不可修,须 run owner 裁定后续:
  经 App 重导入三章正文(原文在 IP/MA/novel/chapters/chapter-003..005.md)
  或扩案新建/重登记 novel 分片(后者违现行 shards 冻结约束)。

条目构造依据(2026-11-15 盘上实读):
- 字段名与顺序对齐盘上 chapter-006 条目(updatedAt 在 NovelChapter 类型里可选,
  apps/frontend/types/studio.ts:73,按规格省略);
- title=IP/MA/novel/chapters/chapter-00N.md 首行去掉行首「# 」(ch2 另与
  chapters/chapter-002/novel-chapters-001-7d62f4f2.json 的 title 互证一致);
- sourceName 按 chapter-006 惯例「N_<去「第N章：」后的标题>.md」(ch3 分片内嵌
  原始语料路径「5.正文/01.劫起微尘/3_残纹入骨两气缠.md」实证该命名惯例);
- volume=邻章 chapter-001/chapter-006 stubs 同值「第一卷」(脚本内再断言);
- importedAt=chapter-006 真身值 1791851422930(v2 修正:全库审计 4120/4121 条
  均一此值,chapter-001(1779826831041)是独份离群旧批条目,「取 ch001 同批导入」
  依据失实;importedAt 无功能消费方,仅 novel.ts:17/material.ts:23 创建时
  Date.now() 默认;脚本内附全库均一审计前置,漂移即拒跑);
- sourceId=章id;revision=1(对齐 ch006)。

序列化说明(对规格第6步的唯一偏离,已实证):App 写 manifest 用
JSON.stringify(plan.manifest, null, 2)(storage-project-sharded.ts:473)+落盘补
末尾换行;2026-11-15 实测 json.dumps(obj, ensure_ascii=False, indent=2)+"\\n"
与盘上 1678507 字节完全一致,而紧凑式 separators=(",",":") 输出 1298880 字节
(整文件重排 ~38 万字节 churn)。故按规格 stated 目标「对齐 JS JSON.stringify
字节风格」取 indent=2+换行,恢复后与备份的 diff 恰为新增 4 条目;脚本内另有
「重序列化原文件必须逐字节还原」护栏,风格漂移即拒跑,绝不整文件重排。

App 在跑检测(双查+dev 覆盖):入口一次、备份后写盘前一次(缩 TOCTOU 窗口);
模式含安装版(漫影工作室.app,含 Helper)与仓库 dev electron(argv 带 MYStudio
路径)。残余窗口(二次检查与 os.replace 之间的毫秒级)无法在无锁前提下消除,
运维规程兜底:跑本脚本前手动确认漫影 App 完全退出(含 dev 实例)。

用法:python3 apps/build/scripts/manifest_ch2_5_index_restore.py
退出码:0=成功或幂等已恢复;2=漫影App在跑(拒动文件);1=其余一切失败
(含写后自校验不过→已用备份回滚)。
"""

from __future__ import annotations

import bisect
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

MANIFEST_PATH = Path(os.path.expanduser("~/Project/IP/MA/store/studio-workflow/manifest.json"))
BACKUP_PREFIX = "manifest.json.bak-restore-ch2-5-"
# 安装版 argv 含 .app 路径(含 Electron Helper);dev 主进程 argv0 含仓库内 electron 路径
APP_PGREP_PATTERNS = (
    "漫影工作室.app",
    "MYStudio.*[Ee]lectron",
    "[Ee]lectron.*MYStudio",
)

NEW_IDS = ("chapter-002", "chapter-003", "chapter-004", "chapter-005")
EXPECTED_TOTAL_BEFORE = 4121
EXPECTED_TOTAL_AFTER = 4125
EXPECTED_MISSING_BEFORE = {2, 3, 4, 5}

# 原文首行标题(novel/chapters/chapter-00N.md 首行实读,已去「# 」)
NEW_TITLES = {
    "chapter-002": "第2章：暮色灵猫结替身",
    "chapter-003": "第3章：残纹入骨两气缠",
    "chapter-004": "第4章：扬州三环伏暗潮",
    "chapter-005": "第5章：赤河前夜母符寒",
}

# 字段名与顺序=盘上 chapter-006 条目去掉 updatedAt;写前断言 ch006 现形仍如此
CHAPTER6_FIELD_ORDER = (
    "id", "index", "volume", "title", "sourceName",
    "importedAt", "updatedAt", "sourceId", "revision",
)
ENTRY_FIELD_ORDER = tuple(f for f in CHAPTER6_FIELD_ORDER if f != "updatedAt")

TITLE_PATTERN = re.compile(r"^第(\d+)章：(.+)$")


def emit(payload: dict) -> None:
    """单行 JSON 到 stdout(紧凑分隔符,对齐规格示例字形)。"""
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def die(reason: str, code: int = 1, **extra) -> "NoReturn":  # type: ignore[valid-type]
    payload = {"ok": False, "reason": reason}
    payload.update(extra)
    emit(payload)
    sys.exit(code)


def serialize(obj: object) -> str:
    """App 写侧字节风格:JSON.stringify(x, null, 2) + 落盘末尾换行(见模块 docstring)。"""
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def load_manifest_raw() -> str:
    if not MANIFEST_PATH.is_file():
        die("manifest-not-found", path=str(MANIFEST_PATH))
    return MANIFEST_PATH.read_text(encoding="utf-8")


def chapter_number(chapter_id: object) -> int | None:
    if not isinstance(chapter_id, str):
        return None
    matched = re.fullmatch(r"chapter-(\d+)", chapter_id)
    return int(matched.group(1)) if matched else None


def derive_source_name(title: str) -> str:
    """「第N章：<名>」→「N_<名>.md」(chapter-006 惯例,写前以 ch006 自证)。"""
    matched = TITLE_PATTERN.fullmatch(title)
    if not matched:
        die("title-convention-mismatch", title=title)
    return f"{int(matched.group(1))}_{matched.group(2)}.md"


def write_exclusive(path: Path, data: str) -> None:
    """O_EXCL 创建写入,存在即冲突(绝不覆盖任何已有文件)+fsync。"""
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    try:
        os.write(fd, data.encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_replace(target: Path, content: str) -> None:
    """同目录临时文件+fsync+os.replace 原子换新;目录 fsync 尽力而为(失败不翻案:
    文件已原子落位,后续自校验照常把关,不让目录 fsync 失败伪装成「未写入」)。"""
    tmp = target.parent / f".{target.name}.tmp-restore-ch2-5-{os.getpid()}"
    try:
        fd = os.open(tmp, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o644)
        try:
            os.write(fd, content.encode("utf-8"))
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(tmp, target)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise
    try:
        dir_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError:
        pass  # 尽力而为:持久性锦上添花,不改变换新语义


def make_backup(raw: str) -> Path:
    """备份为同目录 manifest.json.bak-restore-ch2-5-<UTC毫秒>;毫秒撞名则等待重试。"""
    for _ in range(200):
        candidate = MANIFEST_PATH.parent / f"{BACKUP_PREFIX}{int(time.time() * 1000)}"
        try:
            write_exclusive(candidate, raw)
            return candidate
        except FileExistsError:
            time.sleep(0.002)
    die("backup-name-collision")


def guard_app_not_running(phase: str) -> None:
    """安装版+dev electron 双模式 pgrep;入口与写盘前各查一次(缩 TOCTOU 窗口)。"""
    for pattern in APP_PGREP_PATTERNS:
        probed = subprocess.run(
            ["pgrep", "-f", pattern], capture_output=True, text=True, check=False
        )
        if probed.returncode == 0:
            die(
                "app-running",
                code=2,
                phase=phase,
                pattern=pattern,
                detail="漫影 App 可能在跑(安装版或 dev 实例,可能持有/覆写 store),拒绝动文件;"
                       "残余毫秒级窗口由运维规程兜底(跑前确认 App 完全退出)",
            )


def post_write_checks(current: dict, entries: list[dict]) -> None:
    """写后重读自校验(规格第7步)。只 raise AssertionError,由调用方统一回滚后 exit 1。"""
    index_now = current.get("chapterIndex")
    if not isinstance(index_now, list) or len(index_now) != EXPECTED_TOTAL_AFTER:
        raise AssertionError(f"total={len(index_now) if isinstance(index_now, list) else None}")
    numbers = sorted(e["index"] for e in index_now)
    if numbers != list(range(1, EXPECTED_TOTAL_AFTER + 1)):
        raise AssertionError(f"index 不连续: head={numbers[:8]}")
    by_id = {e["id"]: e for e in index_now}
    for entry in entries:
        on_disk = by_id.get(entry["id"])
        if on_disk != entry or tuple(on_disk.keys()) != ENTRY_FIELD_ORDER:
            raise AssertionError(f"新增条目与构造不符或字段序漂移: {entry['id']}")


def main() -> None:
    guard_app_not_running("entry")
    raw = load_manifest_raw()

    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as exc:
        die("manifest-unparseable", detail=str(exc))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("chapterIndex"), list):
        die("manifest-shape-unexpected")

    index = manifest["chapterIndex"]
    ids = [e.get("id") for e in index]
    present = [cid for cid in NEW_IDS if cid in ids]

    # 幂等:4 条已全在册 → 一行 JSON 收工
    if len(present) == len(NEW_IDS):
        emit({"ok": True, "already": True})
        return
    if present:
        die("partial-state", present=present, detail="部分在册属异常中间态,不猜测,人工先核")

    # 前置断言:世界必须与方案前提一致,任何漂移立即退出
    if len(index) != EXPECTED_TOTAL_BEFORE:
        die("precondition-total", total=len(index), expected=EXPECTED_TOTAL_BEFORE)
    if len(set(ids)) != len(ids):
        die("precondition-duplicate-ids")
    numbers = {chapter_number(i) for i in ids}
    if None in numbers:
        die("precondition-id-format")
    missing = set(range(1, EXPECTED_TOTAL_AFTER + 1)) - {n for n in numbers if n is not None}
    if missing != EXPECTED_MISSING_BEFORE:
        die("precondition-missing-set", missing=sorted(missing))
    indexes = [e.get("index") for e in index]
    if not all(isinstance(n, int) for n in indexes) or indexes != sorted(indexes):
        die("precondition-order", detail="chapterIndex 物理序须严格按 index 升序(2026-11-15 实况如此)")

    stub1 = next(e for e in index if e.get("id") == "chapter-001")
    stub6 = next(e for e in index if e.get("id") == "chapter-006")
    if tuple(stub6.keys()) != CHAPTER6_FIELD_ORDER:
        die("precondition-ch006-field-order", fields=list(stub6.keys()))
    if stub1.get("volume") != stub6.get("volume") or not isinstance(stub1.get("volume"), str):
        die("precondition-volume-ambiguous", ch1=stub1.get("volume"), ch6=stub6.get("volume"))
    volume = stub1["volume"]
    if derive_source_name(stub6["title"]) != stub6.get("sourceName"):
        die("precondition-sourcename-convention", detail="chapter-006 自证失败,命名惯例已漂移")

    # importedAt=ch006 真身值,前置全库均一审计(2026-11-15 实况:4120/4121 均一,
    # 唯一离群=chapter-001);审计不过=前提失实,拒跑
    imported_at = stub6.get("importedAt")
    if not isinstance(imported_at, int):
        die("precondition-ch006-importedAt")
    outliers = [e.get("id") for e in index if e.get("importedAt") != imported_at]
    if len(outliers) != 1 or outliers[0] != "chapter-001":
        die(
            "precondition-importedat-audit",
            outlier_count=len(outliers),
            outliers=outliers[:5],
            detail="importedAt 全库均一性审计不过,v2 取值依据(ch006 真身值)失实,人工复核",
        )

    # 字节风格护栏:重序列化原文件必须逐字节还原,否则风格已漂移→拒跑(不整文件重排)
    if serialize(manifest) != raw:
        die("precondition-byte-style", detail="重序列化≠盘上字节,App 写侧风格已变,人工复核后再定")

    backup_path = make_backup(raw)
    guard_app_not_running("pre-write")  # 二次检查:备份后、写盘前,缩 TOCTOU 窗口

    entries: list[dict] = []
    for chapter_id in NEW_IDS:
        number = chapter_number(chapter_id)
        entry: dict = {}
        for field in ENTRY_FIELD_ORDER:
            if field == "id":
                entry[field] = chapter_id
            elif field == "index":
                entry[field] = number
            elif field == "volume":
                entry[field] = volume
            elif field == "title":
                entry[field] = NEW_TITLES[chapter_id]
            elif field == "sourceName":
                entry[field] = derive_source_name(NEW_TITLES[chapter_id])
            elif field == "importedAt":
                entry[field] = imported_at
            elif field == "sourceId":
                entry[field] = chapter_id
            elif field == "revision":
                entry[field] = 1
        entries.append(entry)

    # 按 index 数值插到正确排序位(bisect 保序插入),其余条目顺序不动
    index_values = [e["index"] for e in index]
    for entry in entries:
        position = bisect.bisect_right(index_values, entry["index"])
        index.insert(position, entry)
        index_values.insert(position, entry["index"])

    try:
        atomic_replace(MANIFEST_PATH, serialize(manifest))
    except OSError as exc:
        die("write-failed", detail=str(exc), backup=str(backup_path))

    # 写后重读自校验:除 4 条新增外,其余键值与备份态完全一致;任一不过→回滚
    try:
        reread = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        if isinstance(reread, dict):
            post_write_checks(reread, entries)
            if list(reread.keys()) != list(manifest.keys()):
                raise AssertionError("top-level key order drifted")
            for key, before in manifest.items():
                if key != "chapterIndex" and reread.get(key) != before:
                    raise AssertionError(f"key drifted: {key}")
        else:
            raise AssertionError("reread not an object")
    except (AssertionError, json.JSONDecodeError, OSError, TypeError, KeyError, ValueError) as exc:
        rollback_state = "ok"
        try:
            atomic_replace(MANIFEST_PATH, raw)  # 用备份字节原样回滚
        except OSError as rollback_exc:
            rollback_state = f"FAILED: {rollback_exc} —— 备份在 {backup_path},须人工恢复"
        die(
            "postcheck-failed-rolled-back",
            detail=str(exc),
            rollback=rollback_state,
            backup=str(backup_path),
        )

    emit({"ok": True, "backup": str(backup_path), "total": EXPECTED_TOTAL_AFTER})


if __name__ == "__main__":
    main()
