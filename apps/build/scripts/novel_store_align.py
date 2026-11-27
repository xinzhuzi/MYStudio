#!/usr/bin/env python3
"""novel_store_align.py — 小说库对齐修复工具(干跑/实写/回滚;design.md §3.2)。

把 store(studio-workflow 分片库)逐章对齐到唯一真源:正文文件 novel/chapters/<章>.md。
正文/头部元数据的解析与对账口径全部复用 novel_text_audit(与 App 逐行对称),
本工具只加「改写」:每章规则见 design.md §3.2 表——
  sourceText/title/volume/sourceId/sourceName/revision 取文件头部与正文(M 缺行则保留原值);
  事件三字段只在 M 对应行非空时取 M;eventTaskState 在 M 带事件段且原值非 running 时置 success;
  updatedAt 取 max(M 文件 mtime 毫秒, 原值);
  索引条目(chapterIndex)同规则但无正文字段;
  例外:库内修订号严格大于文件修订号且正文不同 → 不改写,记 needsReview;
  多余分片(同章第二个起的 novel-chapters-*)从清单除名、文件移入备份目录。

用法:
  python3 novel_store_align.py --project <项目根>                       # 干跑
  python3 novel_store_align.py --project <项目根> --write [--report 路径]  # 实写
  python3 novel_store_align.py --project <项目根> --rollback <备份目录>    # 回滚
标准输出只写 ASCII 汇总行(Win 控制台编码不可靠;备份路径非 ASCII 时以 \\uXXXX 转义呈现,
明细报告 UTF-8 里是原路径);明细写 --report 文件/备份目录内 plan.json。
分片文件写出格式与 App 逐字节一致(studio-workflow-shards.ts:197-206,468-478 的单条目信封);
清单为 JSON.stringify(manifest, null, 2) 等价格式;两者均临时文件写好后原子改名。
备份目录 <项目根>/backups/store/novel-align-<YYYYMMDD-HHMMSS>/,内含 manifest.json、
被改写与被除名分片的原件(保持 studio-workflow/ 下相对路径)、plan.json。
退出码: 0 无待改或实写成功; 2 干跑发现待改; 3 解析异常(实写前中止,未写任何东西);
  4 预检不过(写锁被持有或清单不可解析); 5 校验不过(已自动回滚)。
不碰 novel/drama/、entity-extractions、agent-work-data、storyboards 等一切其它域与清单其它字段。
"""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import time

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

import novel_text_audit  # noqa: E402  对账口径与正文/头部解析的唯一真源

EVENT_MARK = novel_text_audit.EVENT_MARK
LOCK_RELATIVE_PATH = os.path.join("store", ".storage-write-lock.json")
LOCK_STALE_MS = 60_000
SHARD_RE = re.compile(r"^chapters/(chapter-\d+)/novel-chapters-")
META_FIELDS = ("title", "volume", "sourceId", "sourceName")
EVENT_FIELDS = ("eventSummary", "eventState", "eventRawOutput")
# 待改判定只看内容字段;updatedAt 是「被改写的章顺带取较晚者」(design §3.2),
# 不构成独立改写理由——否则 updatedAt 落后于文件 mtime 的全库章都会被算成待改。
CONTENT_FIELDS = (
    "sourceText",
    "title",
    "volume",
    "sourceId",
    "sourceName",
    "revision",
    "eventSummary",
    "eventState",
    "eventRawOutput",
    "eventTaskState",
)


def content_differs(new: dict, old: dict) -> bool:
    return any(new.get(field) != old.get(field) for field in CONTENT_FIELDS)


class ParseAnomaly(Exception):
    """正文文件/分片解析异常(实写前中止,exit 3)。"""


class PrecheckFail(Exception):
    """预检不过(写锁被持有或清单不可解析,exit 4)。"""


class VerifyFail(Exception):
    """校验不过(备份哈希不符/实写后对账不过,exit 5)。"""


# ---------------------------------------------------------------- 基础件


def file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        digest.update(fh.read())
    return digest.hexdigest()


def atomic_write_text(path: str, text: str) -> None:
    """临时文件 + 原子改名;newline='' 禁止平台换行翻译,保证逐字节格式。"""
    directory = os.path.dirname(os.path.abspath(path))
    handle, tmp = tempfile.mkstemp(dir=directory, prefix=".align-tmp-")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def shard_path(store_dir: str, listed: str) -> str | None:
    return novel_text_audit.shard_path(store_dir, listed)


def load_manifest(store_dir: str) -> dict:
    path = os.path.join(store_dir, "manifest.json")
    try:
        with open(path, encoding="utf-8") as fh:
            manifest = json.load(fh)
    except (OSError, ValueError) as error:
        raise PrecheckFail(f"manifest 不可解析: {error}") from error
    if not isinstance(manifest.get("shards"), list) or not isinstance(manifest.get("chapterIndex"), list):
        raise PrecheckFail("manifest 缺 shards/chapterIndex 数组")
    return manifest


def load_shard_entry(path: str, chapter_id: str) -> tuple[int, dict]:
    """读分片信封,返回 (version, 该章条目);任何不符都算解析异常。"""
    try:
        with open(path, encoding="utf-8") as fh:
            envelope = json.load(fh)
    except (OSError, ValueError) as error:
        raise ParseAnomaly(f"分片文件不可解析 {path}: {error}") from error
    entries = (envelope.get("state") or {}).get("novelChapters")
    if not isinstance(entries, list):
        raise ParseAnomaly(f"分片文件缺 state.novelChapters 数组: {path}")
    for entry in entries:
        if isinstance(entry, dict) and entry.get("id") == chapter_id:
            version = envelope.get("version", 0)
            return (int(version) if isinstance(version, (int, float)) else 0), entry
    raise ParseAnomaly(f"分片文件里没有 {chapter_id} 的条目: {path}")


# ---------------------------------------------------------------- 正文文件解析


def parse_event_section(lines: list[str]) -> dict:
    """解析 `## 事件分析` 段的 摘要：/状态：(多行)/原始输出： 三字段;缺或空 → None。"""
    events = {field: None for field in EVENT_FIELDS}
    start = None
    for position, line in enumerate(lines):
        if line.strip() == EVENT_MARK:
            start = position + 1
            break
    if start is None:
        return events
    total = len(lines)
    cursor = start
    while cursor < total:
        line = lines[cursor]
        if line.startswith("摘要："):
            value = line[len("摘要："):].strip()
            if value:
                events["eventSummary"] = value
            cursor += 1
        elif line.startswith("状态："):
            rest = line[len("状态："):].strip()
            cursor += 1
            buffer = [rest] if rest else []
            while cursor < total and not lines[cursor].startswith("原始输出："):
                buffer.append(lines[cursor])
                cursor += 1
            state = "\n".join(buffer).strip()
            if state:
                events["eventState"] = state
        elif line.startswith("原始输出："):
            value = line[len("原始输出："):].strip()
            if value:
                events["eventRawOutput"] = value
            cursor += 1
        else:
            cursor += 1
    return events


def parse_mirror(markdown: str) -> dict:
    """正文文件 → {title,volume,sourceId,revision,sourceName,body,events,has_event_block}。
    首行不是 `# ` 标题行 → 解析异常(实写前中止)。"""
    lines = markdown.replace("\r\n", "\n").split("\n")
    if not lines or not lines[0].startswith("# "):
        sample = markdown.lstrip()[:30].replace("\n", " ")
        raise ParseAnomaly(f"正文文件首行不是 '# ' 标题行: {sample}")
    head = novel_text_audit.mirror_head(markdown)
    return {
        "title": head.get("title"),
        "volume": head.get("volume"),
        "sourceId": head.get("sourceId"),
        "revision": head.get("revision"),
        "sourceName": head.get("sourceName"),
        "body": novel_text_audit.mirror_body(markdown),
        "events": parse_event_section(lines),
        "has_event_block": any(line.strip() == EVENT_MARK for line in lines),
    }


# ---------------------------------------------------------------- 合并规则


def _apply_head_and_events(target: dict, mirror: dict, mtime_ms: int) -> None:
    for field in META_FIELDS:
        if mirror.get(field) is not None:
            target[field] = mirror[field]
    if mirror.get("revision") is not None:
        target["revision"] = mirror["revision"]
    events = mirror["events"]
    for field in EVENT_FIELDS:
        if events.get(field):
            target[field] = events[field]
    if mirror["has_event_block"] and target.get("eventTaskState") != "running":
        target["eventTaskState"] = "success"
    old_ts = target.get("updatedAt")
    old_ms = old_ts if isinstance(old_ts, (int, float)) else 0
    target["updatedAt"] = max(old_ms, mtime_ms)


def merged_store_entry(entry: dict, mirror: dict, mtime_ms: int) -> dict:
    new = dict(entry)
    new["sourceText"] = mirror["body"]
    _apply_head_and_events(new, mirror, mtime_ms)
    return new


def merged_index_entry(entry: dict, mirror: dict, mtime_ms: int) -> dict:
    new = dict(entry)
    _apply_head_and_events(new, mirror, mtime_ms)
    return new


def brief(entry: dict) -> dict:
    text = entry.get("sourceText") or ""
    return {
        "sourceText": text[:40],
        "sourceTextLength": len(text),
        "title": entry.get("title"),
        "volume": entry.get("volume"),
        "sourceName": entry.get("sourceName"),
        "revision": entry.get("revision"),
        "eventSummary": entry.get("eventSummary"),
    }


# ---------------------------------------------------------------- 预检与计划


def precheck(project: str) -> None:
    """写锁缺席/为空/心跳超过 60 秒 → 通过;新鲜 → 拒(exit 4);清单可解析。"""
    lock_path = os.path.join(project, LOCK_RELATIVE_PATH)
    if os.path.isfile(lock_path) and os.path.getsize(lock_path) > 0:
        ts = None
        try:
            with open(lock_path, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                ts = data.get("ts")
        except (OSError, ValueError):
            ts = None
        if isinstance(ts, (int, float)) and (int(time.time() * 1000) - ts) < LOCK_STALE_MS:
            raise PrecheckFail(f"write lock held (fresh ts within {LOCK_STALE_MS}ms): {lock_path}")
    load_manifest(os.path.join(project, "store", "studio-workflow"))


def build_plan(project: str) -> tuple[dict, dict, str, dict]:
    """逐章算改写计划。解析异常抛 ParseAnomaly(实写前中止)。"""
    store_dir = os.path.join(project, "store", "studio-workflow")
    manifest = load_manifest(store_dir)
    first_shard: dict[str, str] = {}
    extra_shards: dict[str, list[str]] = {}
    for name in manifest["shards"]:
        match = SHARD_RE.match(name)
        if not match:
            continue
        chapter_id = match.group(1)
        if chapter_id in first_shard:
            extra_shards.setdefault(chapter_id, []).append(name)
        else:
            first_shard[chapter_id] = name
    plan: dict = {"changedChapters": {}, "removedShards": [], "needsReview": {}}
    for entry in manifest["chapterIndex"]:
        chapter_id = entry.get("id")
        if chapter_id not in first_shard:
            continue
        mirror_path = os.path.join(project, "novel", "chapters", f"{chapter_id}.md")
        if not os.path.isfile(mirror_path):
            plan["needsReview"][chapter_id] = "正文文件缺失,无法对齐"
            continue
        with open(mirror_path, encoding="utf-8", errors="replace") as fh:
            markdown = fh.read()
        mirror = parse_mirror(markdown)
        shard_name = first_shard[chapter_id]
        path = shard_path(store_dir, shard_name)
        if path is None:
            raise ParseAnomaly(f"{chapter_id} 首个登记分片文件缺失: {shard_name}")
        version, store_entry = load_shard_entry(path, chapter_id)
        store_revision = store_entry.get("revision")
        mirror_revision = mirror.get("revision")
        if (
            isinstance(store_revision, int)
            and isinstance(mirror_revision, int)
            and store_revision > mirror_revision
            and store_entry.get("sourceText") != mirror["body"]
        ):
            plan["needsReview"][chapter_id] = (
                f"库内修订号 {store_revision} 大于正文文件修订号 {mirror_revision} 且正文不同,未改写"
            )
            continue
        mtime_ms = int(os.path.getmtime(mirror_path) * 1000)
        new_store_entry = merged_store_entry(store_entry, mirror, mtime_ms)
        new_index_entry = merged_index_entry(entry, mirror, mtime_ms)
        shard_changed = content_differs(new_store_entry, store_entry)
        index_changed = content_differs(new_index_entry, entry)
        if not (shard_changed or index_changed):
            continue
        new_content = dump_shard_file(new_store_entry, version)
        plan["changedChapters"][chapter_id] = {
            "shard": shard_name,
            "shardChanged": shard_changed,
            "indexChanged": index_changed,
            "before": brief(store_entry),
            "after": brief(new_store_entry),
            "beforeSha256": file_sha256(path),
            "afterSha256": hashlib.sha256(new_content.encode("utf-8")).hexdigest(),
            "_version": version,
            "_spath": path,
            "_content": new_content,
            "_newStoreEntry": new_store_entry,
            "_newIndexEntry": new_index_entry,
        }
    for names in extra_shards.values():
        for name in names:
            path = shard_path(store_dir, name)
            if path is None:
                plan["removedShards"].append({"shard": name, "sha256": None, "_spath": None})
            else:
                plan["removedShards"].append(
                    {"shard": name, "sha256": file_sha256(path), "_spath": path}
                )
    # 悬空登记(名字在清单、文件不在盘):整库拷贝/历史除名遗留。App 本就跳过缺失分片,
    # 这里从清单清除并记账(sha256=None,回滚时只恢复清单);只对「计划外」的名字收集。
    planned_names = {p["shard"] for p in plan["removedShards"]}
    planned_names.update(info["shard"] for info in plan["changedChapters"].values())
    for name in manifest["shards"]:
        if name in planned_names:
            continue
        if shard_path(store_dir, name) is None:
            plan["removedShards"].append(
                {"shard": name, "sha256": None, "_spath": None, "dangling": True}
            )
    totals = {"chapters": len(manifest["chapterIndex"])}
    return plan, manifest, store_dir, totals


def public_plan(plan: dict) -> dict:
    """报告结构(design.md §3.2;--report 文件与 plan.json 同构,剥掉内部键)。"""
    changed = {}
    for chapter_id, info in plan["changedChapters"].items():
        changed[chapter_id] = {
            key: info[key]
            for key in (
                "shard",
                "shardChanged",
                "indexChanged",
                "before",
                "after",
                "beforeSha256",
                "afterSha256",
            )
        }
    removed = [{"shard": item["shard"], "sha256": item["sha256"]} for item in plan["removedShards"]]
    return {
        "changedChapters": changed,
        "removedShards": removed,
        "needsReview": dict(plan["needsReview"]),
    }


# ---------------------------------------------------------------- 备份/写入/校验/回滚


def dump_shard_file(entry: dict, version: int) -> str:
    """单条目 novel-chapters 分片,与 App 写出逐字节一致(结尾无换行,非 ASCII 原样)。"""
    entry_json = json.dumps(entry, ensure_ascii=False, indent=2)
    indented = "\n      ".join(entry_json.split("\n"))
    return (
        '{\n  "state": {\n    "novelChapters": [\n      '
        + indented
        + '\n    ]\n  },\n  "version": '
        + str(int(version))
        + "\n}"
    )


def dump_manifest(manifest: dict) -> str:
    """JSON.stringify(manifest, null, 2) 等价;结尾无换行。"""
    return json.dumps(manifest, ensure_ascii=False, indent=2)


def make_backup_dir(project: str) -> str:
    base = os.path.join(project, "backups", "store")
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = os.path.join(base, f"novel-align-{stamp}")
    suffix = 0
    while os.path.exists(backup_dir):
        suffix += 1
        backup_dir = os.path.join(base, f"novel-align-{stamp}-{suffix}")
    os.makedirs(backup_dir)
    return backup_dir


def _backup_one(backup_dir: str, store_dir: str, registered: str, path: str, expected_sha: str) -> None:
    relative = os.path.relpath(path, store_dir)
    destination = os.path.join(backup_dir, relative)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    shutil.copy2(path, destination)
    if file_sha256(destination) != expected_sha:
        raise VerifyFail(f"backup hash mismatch: {relative}")


def full_verify(project: str, store_dir: str, needs_review_ids: set, expected_index_len: int) -> list[str]:
    """全库重读对账(needsReview 章是刻意保留的不一致,不计数)+ 清单登记分片全部在盘 + 章数不变。"""
    problems: list[str] = []
    report = novel_text_audit.audit(project)
    leftover_text = [m for m in report["mismatches"] if m["chapterId"] not in needs_review_ids]
    if leftover_text:
        problems.append(f"text mismatches remain: {len(leftover_text)} chapters")
    leftover_meta = [m for m in report["metadataMismatches"] if m["chapterId"] not in needs_review_ids]
    if leftover_meta:
        problems.append(f"metadata mismatches remain: {len(leftover_meta)} fields")
    with open(os.path.join(store_dir, "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    if len(manifest["chapterIndex"]) != expected_index_len:
        problems.append("chapterIndex length changed")
    for name in manifest["shards"]:
        if shard_path(store_dir, name) is None:
            problems.append(f"registered shard file missing: {name}")
    return problems


def restore_backup(project: str, backup_dir: str) -> int:
    """按 plan.json 把备份件逐个拷回并校验哈希;清单恢复为备份原件。返回恢复件数。"""
    plan_path = os.path.join(backup_dir, "plan.json")
    manifest_backup = os.path.join(backup_dir, "manifest.json")
    if not (os.path.isfile(plan_path) and os.path.isfile(manifest_backup)):
        raise ParseAnomaly(f"backup dir missing plan.json/manifest.json: {backup_dir}")
    with open(plan_path, encoding="utf-8") as fh:
        plan = json.load(fh)
    store_dir = os.path.join(project, "store", "studio-workflow")
    shutil.copy2(manifest_backup, os.path.join(store_dir, "manifest.json"))
    restored = 0
    for info in plan.get("changedChapters", {}).values():
        _restore_one(backup_dir, store_dir, info["shard"], info["beforeSha256"])
        restored += 1
    for item in plan.get("removedShards", []):
        if item.get("sha256") is None:
            continue  # 悬空登记,无备份件可恢复
        _restore_one(backup_dir, store_dir, item["shard"], item["sha256"])
        restored += 1
    return restored


def _restore_one(backup_dir: str, store_dir: str, registered: str, expected_sha: str) -> None:
    source = None
    for candidate in (os.path.join(backup_dir, registered), os.path.join(backup_dir, registered + ".json")):
        if os.path.isfile(candidate):
            source = candidate
            break
    if source is None:
        raise VerifyFail(f"backup file missing: {registered}")
    destination = os.path.join(
        store_dir, registered if registered.endswith(".json") else registered + ".json"
    )
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    shutil.copy2(source, destination)
    if file_sha256(destination) != expected_sha:
        raise VerifyFail(f"restored hash mismatch: {registered}")


def run_write(project: str, plan: dict, manifest: dict, store_dir: str) -> str | None:
    """备份 → 写分片 → 写清单 → 移除多余分片 → 校验;不过则自动回滚并抛 VerifyFail。"""
    changed = plan["changedChapters"]
    removed = plan["removedShards"]
    if not changed and not removed:
        return None
    backup_dir = make_backup_dir(project)
    manifest_path = os.path.join(store_dir, "manifest.json")
    shutil.copy2(manifest_path, os.path.join(backup_dir, "manifest.json"))
    for info in changed.values():
        _backup_one(backup_dir, store_dir, info["shard"], info["_spath"], info["beforeSha256"])
    for item in removed:
        if item["_spath"] is not None:
            _backup_one(backup_dir, store_dir, item["shard"], item["_spath"], item["sha256"])
    with open(os.path.join(backup_dir, "plan.json"), "w", encoding="utf-8") as fh:
        json.dump(public_plan(plan), fh, ensure_ascii=False, indent=1)
    # 第 2 步:写分片(原子,原名覆写)
    for info in changed.values():
        if info["shardChanged"]:
            atomic_write_text(info["_spath"], info["_content"])
    # 第 3 步:写清单(章条目原位替换,数组长度与顺序不变;多余分片登记名移除;原子改名)
    new_manifest = copy.deepcopy(manifest)
    for position, entry in enumerate(new_manifest["chapterIndex"]):
        info = changed.get(entry.get("id"))
        if info is not None:
            new_manifest["chapterIndex"][position] = info["_newIndexEntry"]
    removed_names = {item["shard"] for item in removed}
    if removed_names:
        new_manifest["shards"] = [name for name in new_manifest["shards"] if name not in removed_names]
    atomic_write_text(manifest_path, dump_manifest(new_manifest))
    for item in removed:
        if item["_spath"] is not None and os.path.exists(item["_spath"]):
            os.remove(item["_spath"])
    # 第 4 步:校验,不过即回滚
    problems = full_verify(
        project, store_dir, set(plan["needsReview"]), len(manifest["chapterIndex"])
    )
    if problems:
        restore_backup(project, backup_dir)
        raise VerifyFail("; ".join(problems))
    return backup_dir


# ---------------------------------------------------------------- CLI


def write_report(plan: dict, report_arg: str) -> None:
    report_path = os.path.abspath(os.path.expanduser(report_arg))
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(public_plan(plan), fh, ensure_ascii=False, indent=1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, help="项目根(含 novel/ 与 store/studio-workflow/)")
    parser.add_argument("--write", action="store_true", help="实写(缺省=干跑)")
    parser.add_argument("--report", help="明细报告路径(UTF-8)")
    parser.add_argument("--rollback", metavar="BACKUP_DIR", help="按备份目录回滚")
    args = parser.parse_args(argv)
    project = os.path.expanduser(args.project)
    try:
        if args.rollback:
            precheck(project)
            restored = restore_backup(project, os.path.expanduser(args.rollback))
            print(f"ALIGN mode=rollback restored={restored} exit=0")
            return 0
        precheck(project)
        plan, manifest, store_dir, totals = build_plan(project)
        pending = len(plan["changedChapters"])
        removed = len(plan["removedShards"])
        review = len(plan["needsReview"])
        if args.report:
            write_report(plan, args.report)
        if args.write:
            backup_dir = run_write(project, plan, manifest, store_dir)
            line = (
                f"ALIGN mode=write pending={pending} chapters={totals['chapters']} "
                f"removedShards={removed} needsReview={review}"
            )
            if backup_dir:
                line += f" backupDir={backup_dir}"
            print(line + " exit=0")
            return 0
        exit_code = 2 if (pending or removed) else 0
        print(
            f"ALIGN mode=dry pending={pending} chapters={totals['chapters']} "
            f"removedShards={removed} needsReview={review} exit={exit_code}"
        )
        return exit_code
    except ParseAnomaly as error:
        print(f"ALIGN_ERROR parse-anomaly: {error}", file=sys.stderr)
        return 3
    except PrecheckFail as error:
        print(f"ALIGN_ERROR precheck: {error}", file=sys.stderr)
        return 4
    except VerifyFail as error:
        print(f"ALIGN_ERROR verify: {error}", file=sys.stderr)
        return 5


if __name__ == "__main__":
    try:
        # Win 控制台编码不可靠:标准输出/错误强制 ASCII(非 ASCII 以 \uXXXX 转义),
        # 明细(含原路径)一律走 --report / plan.json(UTF-8)。
        sys.stdout.reconfigure(encoding="ascii", errors="backslashreplace")
        sys.stderr.reconfigure(encoding="ascii", errors="backslashreplace")
    except (AttributeError, ValueError):
        pass
    sys.exit(main())
