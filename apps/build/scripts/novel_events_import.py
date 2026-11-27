#!/usr/bin/env python3
"""novel_events_import.py — 事件轴导入工具(build 生成载荷 / apply 写入;design.md §4.2,Task 14)。

build:解析 Unity「当代主剧情事件轴」的卷表文件(`<数字>.<卷名>.md`)里以 `| <ID> |` 开头、
  恰 9 格的表行,按映射规则 v1(research/06 §3,只搬现成字段、不新造)生成载荷 JSON:
    eventSummary   = 剧情概要,去掉 markdown 加粗标记 **,其余不改(各列同样去 **)
    eventState     = 涉及角色：/事件类型：/时间：/境界：/地点：/情绪：六行;
                     情绪取「扩展方向」里所有 [情绪:…] 标签值,多个用「、」连,没有则省略该行
    eventTaskState = "success"
  行级校验,任一不过即中止(退出 3):摘要非空、不含换行、不以 摘要：/状态：/原始输出： 开头;
  状态各行不以这三个标记开头;表行格数 ≠9、ID 重复、ID 1..N 有缺 → 中止。
  第 1–3 章不进载荷(保留既有的模型分析结果)。

apply:把载荷写入项目库(两台机器各跑一遍)。每章三处,缺任何一处都算这一章失败:
  1. 库内正文分片条目(清单顺序第一个 novel-chapters-* 分片)补 eventSummary/eventState/
     eventTaskState,updatedAt 取当前时间,其余字段不动;
  2. 清单 chapterIndex 条目同样三个字段 + updatedAt;
  3. 正文文件末尾追加事件段(原文件内容逐字节保留在前,只在末尾追加;头部元数据与修订号不动)。
  该章条目已有非空事件摘要、或正文文件已含 `## 事件分析` → 不写这一章,记入 skipped
  (防重复导入、防覆盖)。写入顺序:分片 → 正文文件 → 清单(最后、原子替换)。
  备份 <项目根>/backups/store/novel-events-<时间戳>/:manifest.json、被改写的全部分片原件、
  novel-chapters-before.tar(追加前的正文文件原样打包)、plan.json。
  校验:逐章读回三处字段=载荷;正文文件=备份件+恰一段事件段;库内正文仍等于正文文件正文
  (对账口径,前提=对齐工具 Tasks 2/3 已跑、全库一致);第 1–3 章的分片/索引条目/正文文件哈希
  与改前相同。任一不过 → 用备份恢复清单、分片与正文文件(退出 5)。
  --rollback <备份目录>:按 plan.json 恢复清单与分片、按 tar 恢复正文文件。

退出码:build 0 成功 / 3 事件表不合预期;
       apply 0 成功(含无可写章) / 2 干跑有待写 / 3 载荷不合预期或解析异常 /
       4 预检不过 / 5 校验不过(已自动回滚)。
标准输出只写 ASCII 汇总行(Win 控制台编码不可靠;备份路径非 ASCII 时以 \\uXXXX 转义呈现),
明细写 --report 文件与备份目录内 plan.json(UTF-8)。只用标准库;
预检/清单/分片读写/原子写全部复用 novel_store_align 与 novel_text_audit(口径唯一)。
"""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
import time

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

import novel_store_align  # noqa: E402  预检/清单/分片/原子写/异常复用
import novel_text_audit  # noqa: E402  对账口径唯一真源

RULE = "v1"
VOLUME_FILE_RE = re.compile(r"^(\d+)\..+\.md$")
ROW_RE = re.compile(r"^\|\s*(\d+)\s*\|")
CELL_COUNT = 9
SECTION_MARKS = ("摘要：", "状态：", "原始输出：")
EMOTION_TAG_RE = re.compile(r"\[情绪:([^\]]*)\]")
FIRST_IMPORT_CHAPTER = 4  # 第 1–3 章不进载荷、不写入
PROTECTED_INDICES = (1, 2, 3)  # 第 1–3 章哈希与改前逐一比对
EVENT_FIELDS = ("eventSummary", "eventState", "eventTaskState")
EVENT_MARK = novel_text_audit.EVENT_MARK
MIRROR_RELATIVE_DIR = os.path.join("novel", "chapters")


class EventTableError(Exception):
    """事件表/载荷不合预期(exit 3)。"""


PrecheckFail = novel_store_align.PrecheckFail
ParseAnomaly = novel_store_align.ParseAnomaly
VerifyFail = novel_store_align.VerifyFail


# ---------------------------------------------------------------- build:事件表解析


def validate_event_text(summary: str, state: str) -> None:
    """摘要与事件状态的行级校验(违反即 EventTableError):
    摘要非空、不含换行、不以段标记开头;状态各行不以段标记开头。"""
    if not isinstance(summary, str) or not summary.strip():
        raise EventTableError("剧情概要为空")
    if "\n" in summary:
        raise EventTableError("剧情概要含换行")
    for mark in SECTION_MARKS:
        if summary.startswith(mark):
            raise EventTableError(f"剧情概要以段标记「{mark}」开头")
    for line in state.split("\n"):
        for mark in SECTION_MARKS:
            if line.startswith(mark):
                raise EventTableError(f"事件状态行以段标记「{mark}」开头: {line[:30]}")


def strip_bold(value: str) -> str:
    """去掉 markdown 加粗标记 **,其余字符不动(映射规则 v1)。"""
    return value.replace("**", "")


def parse_volume_file(path: str) -> list[tuple[int, list[str]]]:
    """一份卷表 → [(章号, 9 格原值)]。行不以 `| <ID> |` 开头则忽略;格数 ≠9 → 中止。"""
    rows: list[tuple[int, list[str]]] = []
    with open(path, encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            line = line.rstrip("\n").rstrip("\r")
            if not ROW_RE.match(line):
                continue
            parts = line.split("|")
            cells = [part.strip() for part in parts[1:-1]]
            if len(cells) != CELL_COUNT:
                raise EventTableError(
                    f"{os.path.basename(path)}:{line_no} 表行格数为 {len(cells)},应为 {CELL_COUNT}"
                )
            rows.append((int(cells[0]), cells))
    return rows


def build_entry(index: int, cells: list[str]) -> dict:
    """映射规则 v1:一行 9 格 → 一条载荷条目(只搬现成字段,不新造)。"""
    _id, year, realm, rtype, _title, chars, summary, expansion, geo = cells
    entry = {
        "id": f"chapter-{index:03d}",
        "index": index,
        "eventSummary": strip_bold(summary),
        "eventState": "\n".join(
            [
                f"涉及角色：{strip_bold(chars)}",
                f"事件类型：{strip_bold(rtype)}",
                f"时间：{strip_bold(year)}",
                f"境界：{strip_bold(realm)}",
                f"地点：{strip_bold(geo)}",
            ]
            + (
                ["情绪：" + "、".join(EMOTION_TAG_RE.findall(strip_bold(expansion)))]
                if EMOTION_TAG_RE.findall(strip_bold(expansion))
                else []
            )
        ),
        "eventTaskState": "success",
    }
    validate_event_text(entry["eventSummary"], entry["eventState"])
    return entry


def collect_axis_rows(axis_dir: str) -> tuple[list[tuple[int, list[str]]], list[dict]]:
    """读事件轴目录全部卷表 → (按章号排序的全部行, 卷文件元数据 [{name, sha256}])。"""
    names = sorted(
        (name for name in os.listdir(axis_dir) if VOLUME_FILE_RE.match(name)),
        key=lambda name: int(VOLUME_FILE_RE.match(name).group(1)),
    )
    if not names:
        raise EventTableError(f"目录里没有卷表文件(<数字>.<卷名>.md): {axis_dir}")
    rows: list[tuple[int, list[str]]] = []
    files_meta: list[dict] = []
    for name in names:
        path = os.path.join(axis_dir, name)
        rows.extend(parse_volume_file(path))
        files_meta.append({"name": name, "sha256": novel_store_align.file_sha256(path)})
    return rows, files_meta


def check_ids_complete(rows: list[tuple[int, list[str]]]) -> None:
    """ID 1..N 无缺无重,否则中止(design.md §4.2:合计 N 行、无缺无重)。"""
    ids = [row_id for row_id, _ in rows]
    if not ids:
        raise EventTableError("卷表里没有 | <ID> | 数据行")
    seen: dict[int, int] = {}
    for row_id in ids:
        seen[row_id] = seen.get(row_id, 0) + 1
    duplicated = sorted(row_id for row_id, count in seen.items() if count > 1)
    if duplicated:
        sample = ", ".join(str(row_id) for row_id in duplicated[:5])
        raise EventTableError(f"章号重复 {len(duplicated)} 个(示例: {sample})")
    max_id = max(ids)
    missing = sorted(set(range(1, max_id + 1)) - set(ids))
    if missing:
        sample = ", ".join(str(row_id) for row_id in missing[:5])
        raise EventTableError(f"章号缺失 {len(missing)} 个(示例: {sample})")
    if min(ids) < 1:
        raise EventTableError("章号出现 <1 的值")


def cmd_build(args: argparse.Namespace) -> int:
    axis_dir = os.path.abspath(os.path.expanduser(args.event_axis))
    if not os.path.isdir(axis_dir):
        raise EventTableError(f"事件轴目录不存在: {axis_dir}")
    rows, files_meta = collect_axis_rows(axis_dir)
    check_ids_complete(rows)
    entries = [build_entry(row_id, cells) for row_id, cells in sorted(rows)]
    payload_entries = [entry for entry in entries if entry["index"] >= FIRST_IMPORT_CHAPTER]
    payload = {
        "rule": RULE,
        "source": {"dir": axis_dir, "files": files_meta},
        "entries": payload_entries,
    }
    out_path = os.path.abspath(os.path.expanduser(args.out))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    novel_store_align.atomic_write_text(
        out_path, json.dumps(payload, ensure_ascii=False, indent=1)
    )
    print(
        f"EVENTS build rows={len(rows)} entries={len(payload_entries)} "
        f"files={len(files_meta)} exit=0"
    )
    return 0


# ---------------------------------------------------------------- apply:载荷校验


def load_payload(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError) as error:
        raise EventTableError(f"载荷不可解析 {path}: {error}") from error
    if not isinstance(payload, dict) or payload.get("rule") != RULE:
        raise EventTableError("载荷缺 rule 或 rule != v1")
    entries = payload.get("entries")
    if not isinstance(entries, list) or not entries:
        raise EventTableError("载荷 entries 缺失或为空")
    seen: set[str] = set()
    last_index = 0
    for item in entries:
        if not isinstance(item, dict):
            raise EventTableError("载荷条目不是对象")
        index = item.get("index")
        chapter_id = item.get("id")
        if (
            not isinstance(index, int)
            or isinstance(index, bool)
            or index < FIRST_IMPORT_CHAPTER
        ):
            raise EventTableError(f"载荷条目 index 不合预期: {chapter_id} index={index!r}")
        if chapter_id != f"chapter-{index:03d}":
            raise EventTableError(f"载荷条目 id 与 index 不一致: {chapter_id!r} index={index}")
        if chapter_id in seen:
            raise EventTableError(f"载荷重复条目: {chapter_id}")
        if index <= last_index:
            raise EventTableError(f"载荷条目未按章号升序: {chapter_id}")
        seen.add(chapter_id)
        last_index = index
        for field in EVENT_FIELDS:
            if field not in item:
                raise EventTableError(f"载荷条目缺 {field}: {chapter_id}")
        if item["eventTaskState"] != "success":
            raise EventTableError(f"载荷条目 eventTaskState != success: {chapter_id}")
        validate_event_text(item["eventSummary"], item["eventState"])
    return payload


# ---------------------------------------------------------------- apply:计划


def first_shard_names(manifest: dict) -> dict[str, str]:
    """清单顺序第一个 novel-chapters-* 分片,按章(App 读端 [0] 同口径)。"""
    first: dict[str, str] = {}
    for name in manifest["shards"]:
        match = novel_store_align.SHARD_RE.match(name)
        if match and match.group(1) not in first:
            first[match.group(1)] = name
    return first


def append_event_section(text: str, entry: dict) -> str:
    """正文文件末尾追加事件段;原内容逐字节保留在前(design.md §4.2 模板)。"""
    if text.endswith("\n\n"):
        separator = ""
    elif text.endswith("\n"):
        separator = "\n"
    else:
        separator = "\n\n"
    block = (
        f"{EVENT_MARK}\n\n摘要：{entry['eventSummary']}\n状态：\n{entry['eventState']}"
    )
    return text + separator + block


def build_apply_plan(project: str, payload: dict, now_ms: int) -> tuple[dict, dict, dict]:
    """逐载荷条目算三处写入计划。返回 (plan, manifest, store_dir)。
    plan.pending[章] = 写入详情;skipped[章] = 原因;missing[章] = 缺什么。"""
    store_dir = os.path.join(project, "store", "studio-workflow")
    manifest = novel_store_align.load_manifest(store_dir)
    shards = first_shard_names(manifest)
    index_by_id = {entry.get("id"): entry for entry in manifest["chapterIndex"]}
    plan: dict = {"pending": {}, "skipped": {}, "missing": {}}
    for entry in payload["entries"]:
        chapter_id = entry["id"]
        shard_name = shards.get(chapter_id)
        if shard_name is None:
            plan["missing"][chapter_id] = "清单无该章正文分片登记"
            continue
        shard_p = novel_store_align.shard_path(store_dir, shard_name)
        if shard_p is None:
            plan["missing"][chapter_id] = f"分片文件缺失: {shard_name}"
            continue
        version, store_entry = novel_store_align.load_shard_entry(shard_p, chapter_id)
        index_entry = index_by_id.get(chapter_id)
        if index_entry is None:
            plan["missing"][chapter_id] = "清单 chapterIndex 无该章条目"
            continue
        mirror_path = os.path.join(project, MIRROR_RELATIVE_DIR, f"{chapter_id}.md")
        if not os.path.isfile(mirror_path):
            plan["missing"][chapter_id] = "正文文件缺失"
            continue
        if store_entry.get("eventSummary") or index_entry.get("eventSummary"):
            plan["skipped"][chapter_id] = "条目已有事件摘要"
            continue
        try:
            with open(mirror_path, "rb") as fh:
                mirror_bytes = fh.read()
            mirror_text = mirror_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ParseAnomaly(f"正文文件不是有效 UTF-8: {mirror_path}: {error}") from error
        if any(line.strip() == EVENT_MARK for line in mirror_text.split("\n")):
            plan["skipped"][chapter_id] = "正文文件已含事件分析段"
            continue
        new_store_entry = dict(store_entry)
        new_index_entry = dict(index_entry)
        for field in EVENT_FIELDS:
            new_store_entry[field] = entry[field]
            new_index_entry[field] = entry[field]
        new_store_entry["updatedAt"] = now_ms
        new_index_entry["updatedAt"] = now_ms
        new_mirror_text = append_event_section(mirror_text, entry)
        plan["pending"][chapter_id] = {
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


def protected_first_three(plan: dict, manifest: dict, project: str, store_dir: str) -> dict:
    """第 1–3 章改前指纹(分片文件/正文文件 sha256 + 索引条目规范 JSON sha256),供校验。"""
    shards = first_shard_names(manifest)
    index_by_id = {entry.get("id"): entry for entry in manifest["chapterIndex"]}
    out: dict = {}
    for index in PROTECTED_INDICES:
        chapter_id = f"chapter-{index:03d}"
        record: dict = {"shard": shards.get(chapter_id)}
        shard_p = novel_store_align.shard_path(store_dir, record["shard"]) if record["shard"] else None
        record["shardSha256"] = novel_store_align.file_sha256(shard_p) if shard_p else None
        mirror_path = os.path.join(project, MIRROR_RELATIVE_DIR, f"{chapter_id}.md")
        record["mirrorSha256"] = (
            novel_store_align.file_sha256(mirror_path) if os.path.isfile(mirror_path) else None
        )
        entry = index_by_id.get(chapter_id)
        record["indexSha256"] = (
            hashlib.sha256(
                json.dumps(entry, ensure_ascii=False, sort_keys=True).encode("utf-8")
            ).hexdigest()
            if entry is not None
            else None
        )
        out[chapter_id] = record
    return out


def public_plan(plan: dict, payload: dict, protected: dict) -> dict:
    """报告结构(--report 文件与备份目录 plan.json 同构,剥掉内部键)。"""
    pending = {}
    targets = {}
    for chapter_id, info in plan["pending"].items():
        entry = info["newStoreEntry"]
        pending[chapter_id] = {
            "shard": info["shard"],
            "shardBeforeSha256": info["shardBeforeSha256"],
            "mirrorBeforeSha256": info["mirrorBeforeSha256"],
            "newMirrorSha256": info["newMirrorSha256"],
            "eventSummary": entry["eventSummary"],
            "eventState": entry["eventState"],
            "eventTaskState": entry["eventTaskState"],
        }
    for chapter_id, entry in [(e["id"], e) for e in payload["entries"]]:
        targets[chapter_id] = {
            "shard": chapter_id in plan["pending"],
            "index": chapter_id in plan["pending"],
            "file": chapter_id in plan["pending"],
        }
    return {
        "rule": RULE,
        "entries": len(payload["entries"]),
        "pending": pending,
        "skipped": dict(plan["skipped"]),
        "missing": dict(plan["missing"]),
        "targets": targets,
        "protectedFirstThree": protected,
    }


# ---------------------------------------------------------------- apply:备份/写入/校验/回滚


def make_backup_dir(project: str) -> str:
    base = os.path.join(project, "backups", "store")
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = os.path.join(base, f"novel-events-{stamp}")
    suffix = 0
    while os.path.exists(backup_dir):
        suffix += 1
        backup_dir = os.path.join(base, f"novel-events-{stamp}-{suffix}")
    os.makedirs(backup_dir)
    return backup_dir


def _backup_one(backup_dir: str, store_dir: str, path: str, expected_sha: str) -> None:
    relative = os.path.relpath(path, store_dir)
    destination = os.path.join(backup_dir, relative)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    shutil.copy2(path, destination)
    if novel_store_align.file_sha256(destination) != expected_sha:
        raise VerifyFail(f"backup hash mismatch: {relative}")


def write_mirror_tar(tar_path: str, plan: dict) -> None:
    """追加前的正文文件原样打包(novel/chapters/<章>.md;确定性 mtime=0)。"""
    with tarfile.open(tar_path, "w") as tar:
        for chapter_id, info in sorted(plan["pending"].items()):
            arcname = f"{MIRROR_RELATIVE_DIR}/{chapter_id}.md".replace(os.sep, "/")
            data = info["mirrorBeforeBytes"]
            info_header = tarfile.TarInfo(name=arcname)
            info_header.size = len(data)
            info_header.mtime = 0
            info_header.mode = 0o644
            tar.addfile(info_header, io.BytesIO(data))


def run_write(project: str, plan: dict, manifest: dict, store_dir: str, protected: dict, payload: dict) -> str | None:
    """备份 → 写分片 → 写正文文件 → 写清单(最后、原子替换) → 校验;不过即自动回滚。"""
    pending = plan["pending"]
    if not pending:
        return None
    backup_dir = make_backup_dir(project)
    manifest_path = os.path.join(store_dir, "manifest.json")
    shutil.copy2(manifest_path, os.path.join(backup_dir, "manifest.json"))
    for info in pending.values():
        _backup_one(backup_dir, store_dir, info["shardPath"], info["shardBeforeSha256"])
    write_mirror_tar(os.path.join(backup_dir, "novel-chapters-before.tar"), plan)
    with open(os.path.join(backup_dir, "plan.json"), "w", encoding="utf-8") as fh:
        json.dump(public_plan(plan, payload, protected), fh, ensure_ascii=False, indent=1)
    # 第 2 步:写分片(原子,原名覆写)
    for info in pending.values():
        novel_store_align.atomic_write_text(
            info["shardPath"],
            novel_store_align.dump_shard_file(info["newStoreEntry"], info["shardVersion"]),
        )
    # 第 3 步:写正文文件(原子追加)
    for info in pending.values():
        novel_store_align.atomic_write_text(info["mirrorPath"], info["newMirrorText"])
    # 第 4 步:写清单(章条目原位替换,数组长度与顺序不变;最后落盘)
    new_manifest = copy.deepcopy(manifest)
    for position, entry in enumerate(new_manifest["chapterIndex"]):
        info = pending.get(entry.get("id"))
        if info is not None:
            new_manifest["chapterIndex"][position] = info["newIndexEntry"]
    novel_store_align.atomic_write_text(
        manifest_path, novel_store_align.dump_manifest(new_manifest)
    )
    # 第 5 步:校验,不过即回滚
    problems = verify_written(project, store_dir, plan, manifest, protected, payload)
    if problems:
        restore_backup(project, backup_dir)
        raise VerifyFail("; ".join(problems))
    return backup_dir


def verify_written(project: str, store_dir: str, plan: dict, manifest_before: dict,
                   protected: dict, payload: dict) -> list[str]:
    """逐章读回三处字段=载荷;正文文件=备份件+恰一段事件段;库内正文=正文文件正文
    (对账口径);第 1–3 章指纹与改前相同;清单分片登记与章数不变;全库对账干净。"""
    problems: list[str] = []
    pending = plan["pending"]
    payload_map = {entry["id"]: entry for entry in payload["entries"]}
    with open(os.path.join(store_dir, "manifest.json"), encoding="utf-8") as fh:
        manifest_after = json.load(fh)
    if len(manifest_after["chapterIndex"]) != len(manifest_before["chapterIndex"]):
        problems.append("chapterIndex length changed")
    if manifest_after["shards"] != manifest_before["shards"]:
        problems.append("manifest shards list changed")
    index_after = {entry.get("id"): entry for entry in manifest_after["chapterIndex"]}
    for chapter_id, info in pending.items():
        expected = payload_map[chapter_id]
        shard_p = novel_store_align.shard_path(store_dir, info["shard"])
        if shard_p is None:
            problems.append(f"{chapter_id} shard file missing after write")
            continue
        try:
            _version, store_entry = novel_store_align.load_shard_entry(shard_p, chapter_id)
        except ParseAnomaly as error:
            problems.append(f"{chapter_id} shard unparsable after write: {error}")
            continue
        for field in EVENT_FIELDS:
            if store_entry.get(field) != expected[field]:
                problems.append(f"{chapter_id} shard {field} != payload")
        index_entry = index_after.get(chapter_id)
        if index_entry is None:
            problems.append(f"{chapter_id} index entry missing after write")
        else:
            for field in EVENT_FIELDS:
                if index_entry.get(field) != expected[field]:
                    problems.append(f"{chapter_id} index {field} != payload")
        try:
            with open(info["mirrorPath"], "rb") as fh:
                actual_bytes = fh.read()
        except OSError as error:
            problems.append(f"{chapter_id} mirror unreadable after write: {error}")
            continue
        if actual_bytes != info["newMirrorText"].encode("utf-8"):
            problems.append(f"{chapter_id} mirror bytes != planned append")
        if hashlib.sha256(actual_bytes).hexdigest() != info["newMirrorSha256"]:
            problems.append(f"{chapter_id} mirror sha mismatch")
        actual_text = actual_bytes.decode("utf-8", errors="replace")
        section_count = sum(
            1 for line in actual_text.split("\n") if line.strip() == EVENT_MARK
        )
        if section_count != 1:
            problems.append(f"{chapter_id} mirror event sections = {section_count}, expect 1")
        if store_entry.get("sourceText") != novel_text_audit.mirror_body(actual_text):
            problems.append(f"{chapter_id} store text != mirror body after append")
    for chapter_id, record in protected.items():
        shard_p = (
            novel_store_align.shard_path(store_dir, record["shard"]) if record["shard"] else None
        )
        current_shard_sha = novel_store_align.file_sha256(shard_p) if shard_p else None
        if current_shard_sha != record["shardSha256"]:
            problems.append(f"{chapter_id} shard hash changed")
        mirror_path = os.path.join(project, MIRROR_RELATIVE_DIR, f"{chapter_id}.md")
        current_mirror_sha = (
            novel_store_align.file_sha256(mirror_path) if os.path.isfile(mirror_path) else None
        )
        if current_mirror_sha != record["mirrorSha256"]:
            problems.append(f"{chapter_id} mirror hash changed")
        entry = index_after.get(chapter_id)
        current_index_sha = (
            hashlib.sha256(
                json.dumps(entry, ensure_ascii=False, sort_keys=True).encode("utf-8")
            ).hexdigest()
            if entry is not None
            else None
        )
        if current_index_sha != record["indexSha256"]:
            problems.append(f"{chapter_id} index entry changed")
    report = novel_text_audit.audit(project)
    if report["mismatches"]:
        problems.append(f"text mismatches remain: {len(report['mismatches'])} chapters")
    if report["metadataMismatches"]:
        problems.append(f"metadata mismatches remain: {len(report['metadataMismatches'])} fields")
    return problems


def atomic_write_bytes(path: str, data: bytes) -> None:
    """二进制原子写(临时文件 + 原子改名),用于回滚恢复正文文件。"""
    directory = os.path.dirname(os.path.abspath(path))
    handle, tmp = tempfile.mkstemp(dir=directory, prefix=".events-tmp-")
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def restore_backup(project: str, backup_dir: str) -> int:
    """按 plan.json 恢复清单与分片(备份原件),按 novel-chapters-before.tar 恢复正文文件。
    返回恢复件数;哈希不符即 VerifyFail。"""
    plan_path = os.path.join(backup_dir, "plan.json")
    manifest_backup = os.path.join(backup_dir, "manifest.json")
    if not (os.path.isfile(plan_path) and os.path.isfile(manifest_backup)):
        raise ParseAnomaly(f"backup dir missing plan.json/manifest.json: {backup_dir}")
    with open(plan_path, encoding="utf-8") as fh:
        plan = json.load(fh)
    store_dir = os.path.join(project, "store", "studio-workflow")
    shutil.copy2(manifest_backup, os.path.join(store_dir, "manifest.json"))
    restored = 0
    pending = plan.get("pending", {})
    for chapter_id, info in pending.items():
        shard_name = info["shard"]
        source = None
        for candidate in (
            os.path.join(backup_dir, shard_name),
            os.path.join(backup_dir, shard_name + ".json"),
        ):
            if os.path.isfile(candidate):
                source = candidate
                break
        if source is None:
            raise VerifyFail(f"backup shard file missing: {chapter_id} {shard_name}")
        destination = os.path.join(
            store_dir, shard_name if shard_name.endswith(".json") else shard_name + ".json"
        )
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(source, destination)
        if novel_store_align.file_sha256(destination) != info["shardBeforeSha256"]:
            raise VerifyFail(f"restored shard hash mismatch: {chapter_id}")
        restored += 1
    tar_path = os.path.join(backup_dir, "novel-chapters-before.tar")
    if not os.path.isfile(tar_path):
        raise ParseAnomaly(f"backup dir missing novel-chapters-before.tar: {backup_dir}")
    with tarfile.open(tar_path) as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            if not re.fullmatch(r"novel/chapters/chapter-\d{3,4}\.md", member.name.replace(os.sep, "/")):
                raise VerifyFail(f"unexpected tar member: {member.name}")
            chapter_id = os.path.basename(member.name)[:-3]
            data = tar.extractfile(member).read()
            if hashlib.sha256(data).hexdigest() != pending[chapter_id]["mirrorBeforeSha256"]:
                raise VerifyFail(f"restored mirror hash mismatch: {member.name}")
            atomic_write_bytes(os.path.join(project, member.name), data)
            restored += 1
    return restored


# ---------------------------------------------------------------- CLI


def cmd_apply(args: argparse.Namespace) -> int:
    project = os.path.abspath(os.path.expanduser(args.project))
    payload = load_payload(os.path.abspath(os.path.expanduser(args.payload)))
    novel_store_align.precheck(project)
    now_ms = int(time.time() * 1000)
    plan, manifest, store_dir = build_apply_plan(project, payload, now_ms)
    protected = protected_first_three(plan, manifest, project, store_dir)
    if args.report:
        report_path = os.path.abspath(os.path.expanduser(args.report))
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as fh:
            json.dump(public_plan(plan, payload, protected), fh, ensure_ascii=False, indent=1)
    pending = len(plan["pending"])
    skipped = len(plan["skipped"])
    missing = len(plan["missing"])
    if args.write:
        backup_dir = run_write(project, plan, manifest, store_dir, protected, payload)
        line = f"EVENTS mode=write pending={pending} skipped={skipped} missing={missing}"
        if backup_dir:
            line += f" backupDir={backup_dir}"
        print(line + " exit=0")
        return 0
    exit_code = 2 if pending else 0
    print(f"EVENTS mode=dry pending={pending} skipped={skipped} missing={missing} exit={exit_code}")
    return exit_code


def cmd_rollback(args: argparse.Namespace) -> int:
    project = os.path.abspath(os.path.expanduser(args.project))
    novel_store_align.precheck(project)
    restored = restore_backup(project, os.path.abspath(os.path.expanduser(args.rollback)))
    print(f"EVENTS mode=rollback restored={restored} exit=0")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="解析事件轴卷表,生成载荷 JSON")
    build.add_argument("--event-axis", required=True, help="事件轴目录(十份卷表所在)")
    build.add_argument("--out", required=True, help="载荷输出路径(JSON)")

    apply_cmd = sub.add_parser("apply", help="把载荷写入项目库(干跑/实写)")
    apply_cmd.add_argument("--project", required=True, help="项目根(含 novel/ 与 store/studio-workflow/)")
    apply_cmd.add_argument("--payload", required=True, help="载荷 JSON 路径")
    apply_cmd.add_argument("--write", action="store_true", help="实写(缺省=干跑)")
    apply_cmd.add_argument("--report", help="明细报告路径(UTF-8)")
    apply_cmd.add_argument("--rollback", metavar="BACKUP_DIR", help="按备份目录回滚")

    args = parser.parse_args(argv)
    try:
        if args.command == "build":
            return cmd_build(args)
        if args.rollback:
            return cmd_rollback(args)
        return cmd_apply(args)
    except EventTableError as error:
        print(f"EVENTS_ERROR event-table: {error}", file=sys.stderr)
        return 3
    except ParseAnomaly as error:
        print(f"EVENTS_ERROR parse-anomaly: {error}", file=sys.stderr)
        return 3
    except PrecheckFail as error:
        print(f"EVENTS_ERROR precheck: {error}", file=sys.stderr)
        return 4
    except VerifyFail as error:
        print(f"EVENTS_ERROR verify: {error}", file=sys.stderr)
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
