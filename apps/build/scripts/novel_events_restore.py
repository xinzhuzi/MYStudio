#!/usr/bin/env python3
"""novel_events_restore.py —— 单章事件字段恢复工具(11-26-novel-script-data-alignment 收尾补件)。

场景:某章原有的事件分析在库内丢失(清单索引条目与正文分片条目的事件字段为空、正文文件无
事件段),但一份旧清单备份里还留着完整字段。本工具把该章**原有**的事件分析恢复回三处存放位:
  1) 清单 chapterIndex 该章条目:eventTaskState/eventSummary/eventState/eventAnalysis/
     eventRawOutput 五字段(+updatedAt 取当前时间),其余键不动;
  2) 该章清单顺序第一个 novel-chapters 分片里的章节条目:同五字段(+updatedAt);
  3) 该章正文文件末尾追加 `## 事件分析` 段(摘要/状态/原始输出;与 novel.ts
     buildNovelChapterMirror 同形),正文与头部逐字节不变。
其余字段、其余章一律不动。只恢复原有内容,不新造:源里五字段不全即拒写。

用法:
  python3 novel_events_restore.py --project <项目根> --chapter chapter-003 --source <源.json> [--write] [--report <路径>]
  python3 novel_events_restore.py --project <项目根> --rollback <备份目录>

源 JSON 两种形态:
  ① 完整清单(含 chapterIndex)——取其中该章条目;
  ② {"<章ID>": {五字段…}}。

退出码:0=无需处理,或已写入并校验通过;2=干跑,有待写;3=源或前置不合预期(未写);
        4=校验失败(已自动回滚)或写锁被占;1=工具错误。
实写顺序:备份 → 写分片 → 写正文文件 → 写清单(最后、原子替换) → 校验,不过即自动回滚。
"""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import json
import os
import shutil
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

import novel_events_import  # noqa: E402  首个正文分片定位复用
import novel_store_align  # noqa: E402  预检/清单/分片/原子写/异常复用
import novel_text_audit  # noqa: E402  对账口径唯一真源

FIELDS = ("eventTaskState", "eventSummary", "eventState", "eventAnalysis", "eventRawOutput")
EVENT_MARK = novel_text_audit.EVENT_MARK
MIRROR_RELATIVE_DIR = os.path.join("novel", "chapters")
SECTION_MARKS = ("摘要：", "状态：", "原始输出：")

PrecheckFail = novel_store_align.PrecheckFail
ParseAnomaly = novel_store_align.ParseAnomaly
VerifyFail = novel_store_align.VerifyFail


class SourceError(Exception):
    """源条目或前置条件不合预期(exit 3)。"""


# ---------------------------------------------------------------- 源


def load_source(path: str, chapter_id: str) -> dict:
    """取源里该章的五字段并校验形态;不全/不合预期即抛 SourceError。"""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    entry = None
    if isinstance(data, dict) and isinstance(data.get("chapterIndex"), list):
        entry = next(
            (item for item in data["chapterIndex"] if isinstance(item, dict) and item.get("id") == chapter_id),
            None,
        )
    elif isinstance(data, dict) and isinstance(data.get(chapter_id), dict):
        entry = data[chapter_id]
    if entry is None:
        raise SourceError(f"源里没有该章条目: {chapter_id}")
    picked: dict = {}
    for field in FIELDS:
        if field not in entry:
            raise SourceError(f"源条目缺字段: {field}")
        picked[field] = entry[field]
    if picked["eventTaskState"] != "success":
        raise SourceError(f"源条目 eventTaskState != success: {picked['eventTaskState']!r}")
    for field in ("eventSummary", "eventState"):
        if not (isinstance(picked[field], str) and picked[field].strip()):
            raise SourceError(f"源条目 {field} 为空或不是字符串")
    if "\n" in picked["eventSummary"]:
        raise SourceError("源摘要含换行")
    for mark in SECTION_MARKS:
        if mark in picked["eventSummary"] or mark in picked["eventState"]:
            raise SourceError(f"源摘要/状态撞段标记: {mark}")
    if not isinstance(picked["eventAnalysis"], dict) or not picked["eventAnalysis"]:
        raise SourceError("源条目 eventAnalysis 不是非空对象")
    if not isinstance(picked["eventRawOutput"], str):
        raise SourceError("源条目 eventRawOutput 不是字符串")
    return picked


# ---------------------------------------------------------------- 计划


def build_event_block(fields: dict) -> str:
    lines = [f"摘要：{fields['eventSummary']}", "状态：", *fields["eventState"].split("\n")]
    if fields["eventRawOutput"]:
        lines.append(f"原始输出：{fields['eventRawOutput']}")
    return f"{EVENT_MARK}\n\n" + "\n".join(lines)


def append_event_section(text: str, fields: dict) -> str:
    """正文文件末尾追加事件段;原内容逐字节保留在前。"""
    if text.endswith("\n\n"):
        separator = ""
    elif text.endswith("\n"):
        separator = "\n"
    else:
        separator = "\n\n"
    return text + separator + build_event_block(fields)


def build_plan(project: str, chapter_id: str, fields: dict, now_ms: int) -> tuple[dict, dict, str]:
    """算该章三处写入计划。返回 (plan, manifest, store_dir);plan["pending"] 为空即无需处理。"""
    store_dir = os.path.join(project, "store", "studio-workflow")
    manifest = novel_store_align.load_manifest(store_dir)
    plan: dict = {"chapter": chapter_id, "pending": {}, "skipped": "", "missing": ""}
    shard_name = novel_events_import.first_shard_names(manifest).get(chapter_id)
    if shard_name is None:
        plan["missing"] = "清单无该章正文分片登记"
        return plan, manifest, store_dir
    shard_p = novel_store_align.shard_path(store_dir, shard_name)
    if shard_p is None:
        plan["missing"] = f"分片文件缺失: {shard_name}"
        return plan, manifest, store_dir
    version, store_entry = novel_store_align.load_shard_entry(shard_p, chapter_id)
    index_by_id = {entry.get("id"): entry for entry in manifest["chapterIndex"]}
    index_entry = index_by_id.get(chapter_id)
    if index_entry is None:
        plan["missing"] = "清单 chapterIndex 无该章条目"
        return plan, manifest, store_dir
    mirror_path = os.path.join(project, MIRROR_RELATIVE_DIR, f"{chapter_id}.md")
    if not os.path.isfile(mirror_path):
        plan["missing"] = "正文文件缺失"
        return plan, manifest, store_dir
    if store_entry.get("eventSummary") or index_entry.get("eventSummary"):
        plan["skipped"] = "条目已有事件摘要"
        return plan, manifest, store_dir
    with open(mirror_path, "rb") as fh:
        mirror_bytes = fh.read()
    try:
        mirror_text = mirror_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ParseAnomaly(f"正文文件不是有效 UTF-8: {mirror_path}: {error}") from error
    if any(line.strip() == EVENT_MARK for line in mirror_text.split("\n")):
        plan["skipped"] = "正文文件已含事件分析段"
        return plan, manifest, store_dir
    new_store_entry = dict(store_entry)
    new_index_entry = dict(index_entry)
    for field in FIELDS:
        new_store_entry[field] = fields[field]
        new_index_entry[field] = fields[field]
    new_store_entry["updatedAt"] = now_ms
    new_index_entry["updatedAt"] = now_ms
    new_mirror_text = append_event_section(mirror_text, fields)
    plan["pending"] = {
        "shard": shard_name,
        "shardPath": shard_p,
        "shardVersion": version,
        "shardBeforeSha256": novel_store_align.file_sha256(shard_p),
        "newStoreEntry": new_store_entry,
        "newIndexEntry": new_index_entry,
        "mirrorPath": mirror_path,
        "mirrorBeforeBytes": mirror_bytes,
        "mirrorBeforeSha256": hashlib.sha256(mirror_bytes).hexdigest(),
        "newMirrorText": new_mirror_text,
        "newMirrorSha256": hashlib.sha256(new_mirror_text.encode("utf-8")).hexdigest(),
    }
    return plan, manifest, store_dir


def public_plan(plan: dict, source: str) -> dict:
    """报告结构(--report 文件与备份目录 plan.json 同构,剥掉大字段)。"""
    pending = plan["pending"]
    summary = {}
    if pending:
        entry = pending["newStoreEntry"]
        summary = {
            "shard": pending["shard"],
            "shardBeforeSha256": pending["shardBeforeSha256"],
            "mirrorBeforeSha256": pending["mirrorBeforeSha256"],
            "newMirrorSha256": pending["newMirrorSha256"],
            "fields": {field: entry[field] for field in FIELDS},
        }
    return {
        "chapter": plan["chapter"],
        "source": source,
        "pending": summary,
        "skipped": plan["skipped"],
        "missing": plan["missing"],
    }


# ---------------------------------------------------------------- 写入/校验/回滚


def make_backup_dir(project: str) -> str:
    base = os.path.join(project, "backups", "store")
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = os.path.join(base, f"novel-events-restore-{stamp}")
    suffix = 0
    while os.path.exists(backup_dir):
        suffix += 1
        backup_dir = os.path.join(base, f"novel-events-restore-{stamp}-{suffix}")
    os.makedirs(backup_dir)
    return backup_dir


def _backup_one(backup_dir: str, store_dir: str, path: str, expected_sha: str) -> None:
    relative = os.path.relpath(path, store_dir)
    destination = os.path.join(backup_dir, relative)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    shutil.copy2(path, destination)
    if novel_store_align.file_sha256(destination) != expected_sha:
        raise VerifyFail(f"backup hash mismatch: {relative}")


def verify_written(project: str, store_dir: str, plan: dict, manifest_before: dict, chapter_id: str) -> list[str]:
    """重读三处逐一比对 + 全库对账 + 章数不变。返回问题清单(空=通过)。"""
    problems: list[str] = []
    pending = plan["pending"]
    manifest_path = os.path.join(store_dir, "manifest.json")
    manifest = novel_store_align.load_manifest(store_dir)
    index_entry = next((item for item in manifest["chapterIndex"] if item.get("id") == chapter_id), None)
    if index_entry != pending["newIndexEntry"]:
        problems.append("index entry differs after write")
    version, store_entry = novel_store_align.load_shard_entry(pending["shardPath"], chapter_id)
    if store_entry != pending["newStoreEntry"] or version != pending["shardVersion"]:
        problems.append("store entry differs after write")
    with open(pending["mirrorPath"], "rb") as fh:
        mirror_bytes = fh.read()
    if not mirror_bytes.startswith(pending["mirrorBeforeBytes"]):
        problems.append("mirror prefix changed")
    if hashlib.sha256(mirror_bytes).hexdigest() != pending["newMirrorSha256"]:
        problems.append("mirror content differs after write")
    before_others = [e for e in manifest_before["chapterIndex"] if e.get("id") != chapter_id]
    after_others = [e for e in manifest["chapterIndex"] if e.get("id") != chapter_id]
    if before_others != after_others or len(manifest["chapterIndex"]) != len(manifest_before["chapterIndex"]):
        problems.append("other index entries changed")
    if manifest.get("shards") != manifest_before.get("shards"):
        problems.append("shards list changed")
    report = novel_text_audit.audit(project)
    if report["mismatches"]:
        problems.append(f"text mismatches: {len(report['mismatches'])} chapters")
    if report.get("metadataMismatches"):
        problems.append(f"metadata mismatches: {len(report['metadataMismatches'])} fields")
    return problems


def restore_backup(project: str, backup_dir: str) -> int:
    """按备份目录还原三处原件(清单/分片/正文文件);备份里没有的件不动。返回还原件数。"""
    if not os.path.isdir(backup_dir):
        raise VerifyFail(f"备份目录不存在: {backup_dir}")
    store_dir = os.path.join(project, "store", "studio-workflow")
    restored = 0
    manifest_backup = os.path.join(backup_dir, "manifest.json")
    if os.path.isfile(manifest_backup):
        novel_store_align.atomic_write_text(
            os.path.join(store_dir, "manifest.json"),
            open(manifest_backup, encoding="utf-8").read(),
        )
        restored += 1
    plan_path = os.path.join(backup_dir, "plan.json")
    mirror_rel = None
    if os.path.isfile(plan_path):
        with open(plan_path, encoding="utf-8") as fh:
            plan = json.load(fh)
        chapter_id = plan.get("chapter") or ""
        if chapter_id:
            mirror_rel = os.path.join(MIRROR_RELATIVE_DIR, f"{chapter_id}.md").replace(os.sep, "/")
    for root, _dirs, files in os.walk(backup_dir):
        for name in files:
            relative = os.path.relpath(os.path.join(root, name), backup_dir)
            uniform = relative.replace(os.sep, "/")
            if name in ("manifest.json", "plan.json"):
                continue
            if mirror_rel and uniform == mirror_rel:
                novel_store_align.atomic_write_text(
                    os.path.join(project, mirror_rel),
                    open(os.path.join(root, name), encoding="utf-8").read(),
                )
                restored += 1
                continue
            if uniform.startswith("chapters/"):
                novel_store_align.atomic_write_text(
                    os.path.join(store_dir, relative),
                    open(os.path.join(root, name), encoding="utf-8").read(),
                )
                restored += 1
    return restored


def run_write(project: str, plan: dict, manifest: dict, store_dir: str, chapter_id: str, source: str) -> str:
    """备份 → 写分片 → 写正文文件 → 写清单(最后、原子替换) → 校验;不过即自动回滚。"""
    pending = plan["pending"]
    backup_dir = make_backup_dir(project)
    manifest_path = os.path.join(store_dir, "manifest.json")
    shutil.copy2(manifest_path, os.path.join(backup_dir, "manifest.json"))
    _backup_one(backup_dir, store_dir, pending["shardPath"], pending["shardBeforeSha256"])
    mirror_rel = os.path.join(MIRROR_RELATIVE_DIR, f"{chapter_id}.md")
    mirror_backup = os.path.join(backup_dir, mirror_rel)
    os.makedirs(os.path.dirname(mirror_backup), exist_ok=True)
    shutil.copy2(pending["mirrorPath"], mirror_backup)
    if novel_store_align.file_sha256(mirror_backup) != pending["mirrorBeforeSha256"]:
        raise VerifyFail("backup hash mismatch: mirror")
    with open(os.path.join(backup_dir, "plan.json"), "w", encoding="utf-8") as fh:
        json.dump(public_plan(plan, source), fh, ensure_ascii=False, indent=1)
    # 写分片
    novel_store_align.atomic_write_text(
        pending["shardPath"],
        novel_store_align.dump_shard_file(pending["newStoreEntry"], pending["shardVersion"]),
    )
    # 写正文文件
    novel_store_align.atomic_write_text(pending["mirrorPath"], pending["newMirrorText"])
    # 写清单(章条目原位替换,数组长度与顺序不变;最后落盘)
    new_manifest = copy.deepcopy(manifest)
    for position, entry in enumerate(new_manifest["chapterIndex"]):
        if entry.get("id") == chapter_id:
            new_manifest["chapterIndex"][position] = pending["newIndexEntry"]
    novel_store_align.atomic_write_text(manifest_path, novel_store_align.dump_manifest(new_manifest))
    # 校验,不过即回滚
    problems = verify_written(project, store_dir, plan, manifest, chapter_id)
    if problems:
        restore_backup(project, backup_dir)
        raise VerifyFail("; ".join(problems))
    return backup_dir


# ---------------------------------------------------------------- CLI


def cmd_apply(args: argparse.Namespace) -> int:
    chapter_id = args.chapter
    fields = load_source(args.source, chapter_id)
    novel_store_align.precheck(args.project)
    now_ms = int(datetime.datetime.now().timestamp() * 1000)
    plan, manifest, store_dir = build_plan(args.project, chapter_id, fields, now_ms)
    pending = 1 if plan["pending"] else 0
    skipped = 1 if plan["skipped"] else 0
    missing = plan["missing"]
    if args.report:
        with open(args.report, "w", encoding="utf-8") as fh:
            json.dump(public_plan(plan, args.source), fh, ensure_ascii=False, indent=1)
    exit_code = 0
    backup_dir = None
    if pending:
        if not args.write:
            exit_code = 2
        else:
            backup_dir = run_write(args.project, plan, manifest, store_dir, chapter_id, args.source)
    mode = "write" if args.write else "dry"
    print(
        f"EVENTS-RESTORE mode={mode} chapter={chapter_id} pending={pending} skipped={skipped} "
        f"missing={missing or 0} exit={exit_code}"
    )
    if backup_dir:
        print(f"backupDir={backup_dir}")
    return exit_code


def cmd_rollback(args: argparse.Namespace) -> int:
    restored = restore_backup(args.project, args.rollback)
    print(f"EVENTS-RESTORE mode=rollback backup={args.rollback} restored={restored} exit=0")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="单章事件字段恢复(三处存放位;带备份、校验、自动回滚)")
    parser.add_argument("--project", required=True, help="项目根(含 novel/ 与 store/studio-workflow/)")
    parser.add_argument("--chapter", help="章 ID,如 chapter-003")
    parser.add_argument("--source", help="源 JSON(完整清单或 {章ID: 五字段})")
    parser.add_argument("--write", action="store_true", help="实写(缺省=干跑)")
    parser.add_argument("--report", help="明细报告路径(UTF-8)")
    parser.add_argument("--rollback", metavar="BACKUP_DIR", help="按备份目录回滚")
    args = parser.parse_args(argv)
    try:
        if args.rollback:
            return cmd_rollback(args)
        if not args.chapter or not args.source:
            parser.error("--chapter 与 --source 必填(或用 --rollback)")
        return cmd_apply(args)
    except SourceError as error:
        print(f"EVENTS-RESTORE 源/前置不合预期(未写): {error}", file=sys.stderr)
        return 3
    except PrecheckFail as error:
        print(f"EVENTS-RESTORE 预检失败(未写): {error}", file=sys.stderr)
        return 4
    except (ParseAnomaly, VerifyFail) as error:
        print(f"EVENTS-RESTORE 校验失败(已回滚): {error}", file=sys.stderr)
        return 4
    except (OSError, ValueError, KeyError) as error:
        print(f"EVENTS-RESTORE 工具错误(未写): {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
