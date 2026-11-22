#!/usr/bin/env python3
"""manifest_ch2_5_index_verify.py — 第2-5章 chapterIndex 恢复的独立终检(2026-11-15,v2)。

与恢复脚本 apps/build/scripts/manifest_ch2_5_index_restore.py 完全独立(不 import、
不共享代码):以「最新 manifest.json.bak-restore-ch2-5-* 备份 ↔ 现 manifest」做
双层对比——
①语义层:除 chapterIndex 外所有顶层键(shards、activeChapterId、layout、
  version……)逐键相等;chapterIndex 恰好多 4 条、新增 id 集合恰为
  {chapter-002..005}、零删除;存量条目按物理序逐条深度相等(序敏感,乱序/挪位
  可检);总数 4125;按 index 排序 1..4125 连续;
②字节层(v2 强化):从备份独立重建「期望恢复后整文件」(自持常量与推导:
  ch006 字段序/卷名/sourceName 惯例自证、importedAt=ch006 真身值+全库均一审计、
  App 写侧风格 indent=2+末尾换行),要求现 manifest 字节与之逐字节相等——
  整文件重排/紧凑化 churn、新条目错值/字段序漂移、插错位、存量物理序被动,
  任一越界即失配。语义检查仍保留,提供可读定位。

本脚本只读,绝不写盘。任一检查不过 → 单行 JSON(ok=false)+ exit 1。

用法:python3 apps/build/scripts/manifest_ch2_5_index_verify.py
"""

from __future__ import annotations
import os

import bisect
import json
import re
import sys
from pathlib import Path

MANIFEST_PATH = Path(os.path.expanduser("~/Project/IP/MA/store/studio-workflow/manifest.json"))
BACKUP_SUFFIX_RE = re.compile(r"^manifest\.json\.bak-restore-ch2-5-(\d+)$")

EXPECTED_NEW_IDS = {"chapter-002", "chapter-003", "chapter-004", "chapter-005"}
EXPECTED_TOTAL = 4125

# 与恢复脚本同源但自持的常量(独立终检的独立 oracle;来源=2026-11-15 盘上实读)
NEW_TITLES = {
    "chapter-002": "第2章：暮色灵猫结替身",
    "chapter-003": "第3章：残纹入骨两气缠",
    "chapter-004": "第4章：扬州三环伏暗潮",
    "chapter-005": "第5章：赤河前夜母符寒",
}
CHAPTER6_FIELD_ORDER = (
    "id", "index", "volume", "title", "sourceName",
    "importedAt", "updatedAt", "sourceId", "revision",
)
ENTRY_FIELD_ORDER = tuple(f for f in CHAPTER6_FIELD_ORDER if f != "updatedAt")
TITLE_PATTERN = re.compile(r"^第(\d+)章：(.+)$")


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def die(detail: str, backup_path: str | None = None) -> "NoReturn":  # type: ignore[valid-type]
    emit({"ok": False, "detail": detail, "backupPath": backup_path})
    sys.exit(1)


def load_text(path: Path, backup_path: str | None) -> str:
    if not path.is_file():
        die(f"文件不存在: {path}", backup_path)
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        die(f"读取失败: {path} ({exc})", backup_path)


def parse_json(text: str, what: str, backup_path: str | None) -> dict:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        die(f"{what} 无法解析为 JSON ({exc})", backup_path)
    if not isinstance(parsed, dict):
        die(f"{what} 不是 JSON 对象", backup_path)
    return parsed


def find_latest_backup() -> Path:
    candidates: list[tuple[int, str, Path]] = []
    for entry in MANIFEST_PATH.parent.iterdir():
        matched = BACKUP_SUFFIX_RE.fullmatch(entry.name)
        if matched:
            candidates.append((int(matched.group(1)), entry.name, entry))
    if not candidates:
        die("找不到任何 manifest.json.bak-restore-ch2-5-* 备份(恢复脚本未跑过?)", None)
    return max(candidates)[2]


def derive_source_name(title: str) -> str:
    matched = TITLE_PATTERN.fullmatch(title)
    if not matched:
        die("title 惯例不匹配,无法构建期望条目", None)
    return f"{int(matched.group(1))}_{matched.group(2)}.md"


def build_expected(backup: dict, backup_path: str) -> tuple[str, list[dict]]:
    """从备份独立重建期望恢复态:4 条期望条目 + 期望整文件字节(App 写侧风格)。

    只依赖备份自证(ch001/ch006 stub、全库均一审计),不依赖、不 import 恢复脚本。
    任何前提失实 → die(终检拒绝在失实前提下宣判 ok)。
    """
    index = backup.get("chapterIndex")
    if not isinstance(index, list):
        die("备份 chapterIndex 不是数组", backup_path)
    ids = [e.get("id") if isinstance(e, dict) else None for e in index]
    if None in ids or len(set(ids)) != len(ids):
        die("备份 chapterIndex 条目异常(非对象或 id 重复)", backup_path)
    indexes = [e.get("index") for e in index]
    if not all(isinstance(n, int) for n in indexes) or indexes != sorted(indexes):
        die("备份 chapterIndex 物理序非严格升序,无法定位期望插入位", backup_path)

    try:
        stub1 = next(e for e in index if e["id"] == "chapter-001")
        stub6 = next(e for e in index if e["id"] == "chapter-006")
    except StopIteration:
        die("备份缺 chapter-001/chapter-006 stub,无法推导期望条目", backup_path)
    if tuple(stub6.keys()) != CHAPTER6_FIELD_ORDER:
        die("备份 chapter-006 字段序与 2026-11-15 盘上现形不符,oracle 前提失实", backup_path)
    if stub1.get("volume") != stub6.get("volume") or not isinstance(stub1.get("volume"), str):
        die("备份 ch001/ch006 volume 不一致,卷名推断前提失实", backup_path)
    if derive_source_name(stub6["title"]) != stub6.get("sourceName"):
        die("备份 chapter-006 sourceName 自证失败,命名惯例前提失实", backup_path)
    imported_at = stub6.get("importedAt")
    if not isinstance(imported_at, int):
        die("备份 chapter-006 importedAt 非整数", backup_path)
    outliers = [e["id"] for e in index if e.get("importedAt") != imported_at]
    if len(outliers) != 1 or outliers[0] != "chapter-001":
        die(
            f"备份 importedAt 全库均一审计不过(outliers={outliers[:5]}),"
            "期望条目取值依据(ch006 真身值)失实",
            backup_path,
        )

    volume = stub1["volume"]
    entries: list[dict] = []
    for chapter_id in ("chapter-002", "chapter-003", "chapter-004", "chapter-005"):
        title = NEW_TITLES[chapter_id]
        number = int(re.fullmatch(r"chapter-(\d+)", chapter_id).group(1))
        entry: dict = {}
        for field in ENTRY_FIELD_ORDER:
            if field == "id":
                entry[field] = chapter_id
            elif field == "index":
                entry[field] = number
            elif field == "volume":
                entry[field] = volume
            elif field == "title":
                entry[field] = title
            elif field == "sourceName":
                entry[field] = derive_source_name(title)
            elif field == "importedAt":
                entry[field] = imported_at
            elif field == "sourceId":
                entry[field] = chapter_id
            elif field == "revision":
                entry[field] = 1
        entries.append(entry)

    expected_tree = dict(backup)
    new_index = list(index)
    index_values = [e["index"] for e in new_index]
    for entry in entries:
        position = bisect.bisect_right(index_values, entry["index"])
        new_index.insert(position, entry)
        index_values.insert(position, entry["index"])
    expected_tree["chapterIndex"] = new_index
    # App 写侧字节风格:JSON.stringify(x, null, 2) + 末尾换行(恢复脚本同款,独立复写)
    expected_raw = json.dumps(expected_tree, ensure_ascii=False, indent=2) + "\n"
    return expected_raw, entries


def verify() -> dict:
    backup_path_obj = find_latest_backup()
    backup_path = str(backup_path_obj)
    backup_raw = load_text(backup_path_obj, backup_path)
    current_raw = load_text(MANIFEST_PATH, backup_path)
    backup = parse_json(backup_raw, "备份 manifest", backup_path)
    current = parse_json(current_raw, "现 manifest", backup_path)

    reasons: list[str] = []

    # ① 语义层:除 chapterIndex 外所有键逐键相等(键集+键值)
    keys_ok = set(backup.keys()) == set(current.keys()) and all(
        backup[k] == current[k] for k in backup if k != "chapterIndex"
    )
    if not keys_ok:
        reasons.append("除 chapterIndex 外存在其他顶层键差异")

    # ② chapterIndex:恰好多 4 条、新增 id 集合恰为 2-5 章、零删除、总数 4125
    ci_backup = backup.get("chapterIndex")
    ci_current = current.get("chapterIndex")
    if not isinstance(ci_backup, list) or not isinstance(ci_current, list):
        die("chapterIndex 不是数组", backup_path)
    current_ids = [e.get("id") if isinstance(e, dict) else None for e in ci_current]
    backup_ids = [e.get("id") if isinstance(e, dict) else None for e in ci_backup]
    if None in current_ids or len(set(current_ids)) != len(current_ids):
        die("现 chapterIndex 条目异常(非对象或 id 重复)", backup_path)
    added = set(current_ids) - set(backup_ids)
    removed = set(backup_ids) - set(current_ids)
    diff_ok = (
        len(ci_current) - len(ci_backup) == 4
        and added == EXPECTED_NEW_IDS
        and not removed
        and len(ci_current) == EXPECTED_TOTAL
    )
    if not diff_ok:
        reasons.append(
            f"chapterIndex 差值/新增集/总数不符(diff={len(ci_current) - len(ci_backup)},"
            f"added={sorted(added)},removed={sorted(removed)},total={len(ci_current)})"
        )

    # ③ 存量条目物理序敏感对比:剔除新增 4 条后须与备份逐条深度相等且同序
    kept = [e for e in ci_current if e.get("id") not in EXPECTED_NEW_IDS]
    sequence_preserved = kept == ci_backup
    if not sequence_preserved:
        reasons.append("存量条目内容或物理序被改动(序敏感对比不等)")

    # ④ 按 index 排序 1..4125 连续
    numbers = sorted(e.get("index") for e in ci_current if isinstance(e.get("index"), int))
    contiguous = numbers == list(range(1, EXPECTED_TOTAL + 1))
    if not contiguous:
        reasons.append("按 index 排序后非 1..4125 连续")

    # ⑤ activeChapterId 未动
    active_untouched = backup.get("activeChapterId") == current.get("activeChapterId")
    if not active_untouched:
        reasons.append("activeChapterId 有变")

    # ⑥ 字节层 oracle:现 manifest 须与「备份+4 期望条目」独立重建逐字节相等
    expected_raw, _entries = build_expected(backup, backup_path)
    byte_match = current_raw == expected_raw
    if not byte_match:
        first_diff = next(
            (
                i for i, (a, b) in enumerate(zip(current_raw, expected_raw)) if a != b
            ),
            min(len(current_raw), len(expected_raw)),
        )
        reasons.append(
            f"字节层与独立重建期望不符(首个差异位 {first_diff};"
            "整文件重排/新条目错值或字段序漂移/插位错误之一越界)"
        )

    only_chapter_index_changed = keys_ok and sequence_preserved and byte_match
    ok = bool(diff_ok and contiguous and active_untouched and only_chapter_index_changed)
    if ok:
        detail = (
            "恢复面恰为 chapterIndex +chapter-002..005 四条,字节层与独立重建期望逐字节一致,"
            "总数 4125 且 1..4125 连续,其余键(shards/activeChapterId/layout/version 等)与备份逐键相等"
        )
    else:
        detail = "终检未过:" + ";".join(reasons) if reasons else "终检未过:未知差异"

    return {
        "ok": ok,
        "total": len(ci_current),
        "contiguous": contiguous,
        "onlyChapterIndexChanged": only_chapter_index_changed,
        "backupPath": backup_path,
        "activeUntouched": active_untouched,
        "detail": detail,
    }


def main() -> None:
    result = verify()
    emit(result)
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
