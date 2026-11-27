#!/usr/bin/env python3
"""小说正文对账工具(只读):逐章比对「store 分片里的正文」与「正文文件 novel/chapters/<章>.md 的正文」,
另比对索引条目(chapterIndex)的修订号/标题/卷/来源名与正文文件头部(design.md §3.1)。

真源口径(1127 用户裁定):novel/chapters/<章>.md = 小说正文唯一真源。
正文提取规则与 App 的 parseNovelChapterMirrorBody 逐行对称
(apps/frontend/lib/studio/novel.ts):`# 标题` → 空行 → `> ` 元数据块 → 空行 → 正文,
正文截断到 `## 事件分析` 段之前,去尾部空白。

store 取数规则与 App 加载器对称:只认 manifest.shards 登记的分片(孤儿分片不读),
同章多个分片按 manifest 顺序取**第一个**生效
(storage-project-sharded.ts readMergedShards 的 find / project-storage.ts
loadStudioChapterWorkspace 的 [0])。兼容登记名带/不带 .json 后缀(Mac 不带,Win 带)。

元数据比对(1127 研究档 01 §8):索引条目的 revision/title/volume/sourceName
与正文文件头部 `# 标题`、`> 卷：`、`> 修订：`、`> 来源：` 逐字段比对,
不符处记入 metadataMismatches;文件头部缺该行则跳过该字段不比对。
事件段缺口(正文文件带事件段而索引条目无事件)只计入 stats,不算「不一致」。

用法:
  python3 novel_text_audit.py --project ~/Project/IP/MA            # 只打印汇总
  python3 novel_text_audit.py --project ~/Project/IP/MA --json out.json  # 另存完整明细
退出码: 0=全部一致; 2=存在不一致(文本或元数据,供门禁脚本判断); 1=工具自身错误。
"""
import argparse
import collections
import datetime
import json
import os
import re
import sys

EVENT_MARK = "## 事件分析"

HEAD_FIELD_BY_MARK = {
    "卷": "volume",
    "源ID": "sourceId",
    "修订": "revision",
    "来源": "sourceName",
}


def mirror_body(markdown: str) -> str:
    lines = markdown.replace("\r\n", "\n").split("\n")
    cursor = 0
    if (lines[cursor] if cursor < len(lines) else "").startswith("# "):
        cursor += 1
    if (
        cursor < len(lines)
        and lines[cursor].strip() == ""
        and cursor + 1 < len(lines)
        and lines[cursor + 1].startswith("> ")
    ):
        cursor += 1
    while cursor < len(lines) and lines[cursor].startswith("> "):
        cursor += 1
    if cursor < len(lines) and lines[cursor].strip() == "":
        cursor += 1
    body = "\n".join(lines[cursor:])
    idx = body.find("\n" + EVENT_MARK)
    if idx >= 0:
        body = body[:idx]
    elif body.startswith(EVENT_MARK):
        body = ""
    return body.rstrip()


def mirror_head(markdown: str) -> dict:
    """解析正文文件头部:`# 标题` + 连续 `> ` 元数据块。
    返回 {title?, volume?, sourceId?, revision?, sourceName?};缺该行则缺该键,
    revision 为 int。元数据块的扫描在第一行正文处停住(正文里偶见的 `> ` 引文行不误吞)。"""
    lines = markdown.replace("\r\n", "\n").split("\n")
    head: dict = {}
    if lines and lines[0].startswith("# "):
        title = lines[0][2:].strip()
        if title:
            head["title"] = title
    for line in lines[1:]:
        if line.strip() == "":
            continue
        matched = re.match(r"^> (卷|源ID|修订|来源)：(.*)$", line)
        if matched:
            key = HEAD_FIELD_BY_MARK[matched.group(1)]
            value = matched.group(2).strip()
            if key == "revision":
                if value.isdigit():
                    head[key] = int(value)
            elif value:
                head[key] = value
        elif line.startswith("> "):
            continue
        else:
            break
    return head


def metadata_mismatch_fields(chapter_id: str, index_entry: dict, head: dict) -> list[dict]:
    """索引条目 vs 正文文件头部,逐字段比对(revision/title/volume/sourceName)。
    文件头部缺该行(mirror 值 None)则跳过该字段。"""
    out: list[dict] = []
    for field in ("revision", "title", "volume", "sourceName"):
        mirror_value = head.get(field)
        if mirror_value is None:
            continue
        index_value = index_entry.get(field)
        if index_value != mirror_value:
            out.append(
                {
                    "chapterId": chapter_id,
                    "field": field,
                    "indexValue": index_value,
                    "mirrorValue": mirror_value,
                }
            )
    return out


def mirror_meta(markdown: str) -> dict:
    head = markdown[:600]
    revision = re.search(r"^> 修订：(\d+)$", head, re.M)
    return {
        "revision": int(revision.group(1)) if revision else None,
        "has_event_block": ("\n" + EVENT_MARK) in ("\n" + markdown),
    }


def shard_path(store_dir: str, listed: str) -> str | None:
    for candidate in (os.path.join(store_dir, listed), os.path.join(store_dir, listed + ".json")):
        if os.path.isfile(candidate):
            return candidate
    return None


def classify(store_text: str, body: str) -> str:
    if store_text.lstrip().startswith("# ") and re.search(r"\n> (卷|源ID|修订|来源)：", store_text[:200]):
        return "store正文混入元数据块"
    if re.search(r"候审稿|EP\d+\s*[·:：]|\d+\s*秒", store_text[:120]):
        return "store正文是剧本稿"
    return "内容不一致"


def audit(project: str) -> dict:
    store_dir = os.path.join(project, "store", "studio-workflow")
    with open(os.path.join(store_dir, "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    first_shard: dict[str, str] = {}
    duplicates: dict[str, int] = collections.Counter()
    for name in manifest["shards"]:
        match = re.match(r"^chapters/(chapter-\d+)/novel-chapters-", name)
        if not match:
            continue
        chapter_id = match.group(1)
        if chapter_id in first_shard:
            duplicates[chapter_id] += 1
        else:
            first_shard[chapter_id] = name

    stats: collections.Counter = collections.Counter()
    mismatches: list[dict] = []
    metadata_mismatches: list[dict] = []
    index = {entry["id"]: entry for entry in manifest["chapterIndex"]}
    for chapter_id, entry in index.items():
        mirror_file = os.path.join(project, "novel", "chapters", f"{chapter_id}.md")
        if not os.path.isfile(mirror_file):
            stats["正文文件缺失"] += 1
            continue
        if chapter_id not in first_shard:
            stats["store无登记分片"] += 1
            continue
        path = shard_path(store_dir, first_shard[chapter_id])
        if path is None:
            stats["store分片文件缺失"] += 1
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                state = json.load(fh).get("state") or {}
        except (OSError, ValueError):
            stats["store分片解析失败"] += 1
            continue
        store_chapter = next(
            (item for item in state.get("novelChapters") or [] if item.get("id") == chapter_id), None
        ) or {}
        with open(mirror_file, encoding="utf-8", errors="replace") as fh:
            markdown = fh.read()
        meta = mirror_meta(markdown)
        head = mirror_head(markdown)
        metadata_mismatches.extend(metadata_mismatch_fields(chapter_id, entry, head))
        body = mirror_body(markdown)
        store_text = store_chapter.get("sourceText")
        if not isinstance(store_text, str) or not store_text:
            stats["store正文为空"] += 1
        elif store_text == body:
            stats["一致"] += 1
        elif store_text.strip() == body.strip():
            stats["一致(仅首尾空白差)"] += 1
        else:
            stats["不一致"] += 1
            mismatches.append(
                {
                    "chapterId": chapter_id,
                    "kind": classify(store_text, body),
                    "storeTextLength": len(store_text),
                    "mirrorBodyLength": len(body),
                    "storeRevision": store_chapter.get("revision"),
                    "mirrorRevision": meta["revision"],
                    "mirrorMtime": datetime.datetime.fromtimestamp(os.path.getmtime(mirror_file)).strftime(
                        "%Y-%m-%d %H:%M"
                    ),
                    "storeShard": first_shard[chapter_id],
                    "storeShardMtime": datetime.datetime.fromtimestamp(os.path.getmtime(path)).strftime(
                        "%Y-%m-%d %H:%M"
                    ),
                    "storeHead": store_text[:40].replace("\n", "⏎"),
                    "mirrorHead": body[:40].replace("\n", "⏎"),
                    "duplicateShards": duplicates.get(chapter_id, 0),
                }
            )
        if meta["has_event_block"] and not (entry.get("eventSummary") or entry.get("eventState")):
            stats["正文带事件段而索引无事件"] += 1

    mirror_files = [name for name in os.listdir(os.path.join(project, "novel", "chapters")) if name.endswith(".md")]
    mirror_by_day_rev: collections.Counter = collections.Counter()
    event_blocks = 0
    for name in mirror_files:
        with open(os.path.join(project, "novel", "chapters", name), encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        meta = mirror_meta(text)
        day = datetime.datetime.fromtimestamp(
            os.path.getmtime(os.path.join(project, "novel", "chapters", name))
        ).strftime("%m-%d")
        mirror_by_day_rev[f"{day}/修订{meta['revision']}"] += 1
        event_blocks += 1 if meta["has_event_block"] else 0

    return {
        "project": project,
        "auditedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "manifest": {
            "chapterIndex": len(manifest["chapterIndex"]),
            "shards": len(manifest["shards"]),
            "activeChapterId": manifest.get("activeChapterId"),
        },
        "stats": dict(stats),
        "chaptersWithDuplicateNovelShards": dict(duplicates),
        "mirrorFiles": len(mirror_files),
        "mirrorByDayRevision": dict(sorted(mirror_by_day_rev.items())),
        "mirrorWithEventBlock": event_blocks,
        "mismatches": mismatches,
        "metadataMismatches": metadata_mismatches,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, help="项目根(含 novel/ 与 store/studio-workflow/)")
    parser.add_argument("--json", help="完整明细另存路径")
    args = parser.parse_args(argv)
    try:
        report = audit(os.path.expanduser(args.project))
    except (OSError, ValueError, KeyError) as error:
        print(f"AUDIT_ERROR: {error!r}", file=sys.stderr)
        return 1
    if args.json:
        os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=1)
    kinds: collections.Counter = collections.Counter(item["kind"] for item in report["mismatches"])
    metadata_kinds: collections.Counter = collections.Counter(
        item["field"] for item in report["metadataMismatches"]
    )
    print("项目:", report["project"], "| 对账时间:", report["auditedAt"])
    print("manifest:", report["manifest"])
    print("对账结果:", report["stats"])
    print("不一致分类:", dict(kinds))
    print("元数据不一致(索引 vs 正文文件头部):", dict(metadata_kinds) or "无")
    print("同章多分片(多余个数):", report["chaptersWithDuplicateNovelShards"] or "无")
    print("正文文件:", report["mirrorFiles"], "| 修改日/修订号分布:", report["mirrorByDayRevision"])
    print("正文文件带事件分析段:", report["mirrorWithEventBlock"])
    if args.json:
        print("明细已存:", args.json)
    return 2 if (report["mismatches"] or report["metadataMismatches"]) else 0


if __name__ == "__main__":
    sys.exit(main())
