#!/usr/bin/env python3
"""剧本资产提取数据修复(10-20):分片回补 + 别名去污染 + 索引重建 + 库备注别名清理。

背景:10-20 逐章审计发现 132 章 163 条正文实体未独立落地、场景/道具别名未落盘、
共享泛化别名把不同实体并进前者。代码侧 dedupe/索引/入库已修(10-20),本脚本
用同一套新身份规则重放语料,修存量数据。

默认 dry-run(只读项目,只写 evidence 报告);`--apply` 才写项目。写前自动
clonefile 备份(可用 `--no-backup` 关闭,仅供 staging)。不触碰图片/音频/媒体。
"""

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import time
from collections import Counter, defaultdict

KIND_KEYS = {"character": "characters", "scene": "scenes", "prop": "props"}
KIND_ID = {"character": "characterId", "scene": "sceneId", "prop": "assetId"}
KIND_PREFIX = {"character": "char", "scene": "scene", "prop": "prop"}
KIND_LIB_REL = {
    "character": "store/characters.json",
    "scene": "store/scenes.json",
    "prop": "store/props.json",
}
LIB_STATE_KEY = {"character": "characters", "scene": "scenes", "prop": "items"}

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
DEFAULT_PROJECT = "/Users/zhengbingjin/Project/IP/MA"
DEFAULT_CORPUS = os.path.join(
    REPO_ROOT, ".trellis/tasks/10-19-extract-all-c3-audit-runs/research/corpus"
)
DEFAULT_EVIDENCE = os.path.join(
    REPO_ROOT, ".trellis/tasks/10-19-extract-all-c3-audit-runs/research/evidence"
)

APPEARANCE_REL = "store/extraction/entity-appearances.json"
CHAPTERS_REL = "store/studio-workflow/chapters"

MEDIA_EXT_RE = re.compile(
    r"\.(mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|mp4|mov|webm|mkv)$", re.I
)
ALIAS_COLUMN_SPLIT_RE = re.compile(r"[、,，;；/]+")
NAME_COLUMN_SPLIT_RE = re.compile(r"[;；,，]")
TRAILING_PUNCT_RE = re.compile(r"[。.!！?？;；,，、\s]+$")

HARD_JUNK_CHARS = {
    "[叠化]",
    "[叠化]回",
    "[淡出]末帧",
    "叠化收回石室",
    "叠化回星辰台",
    "特写",
    "闪回",
    "花瓣余音",
}

# 纯转场/镜头/声源标记,以及不带具体身份的泛化角色词。别名里出现这些
# token 不携带身份信息,留着只会制造跨实体误配(prompt 已知清单也会被撑爆)。
HARD_GENERIC = {
    "os",
    "画外",
    "画外音",
    "画外声",
    "旁白",
    "独白",
    "闪回",
    "叠化",
    "淡入",
    "淡出",
    "空镜",
    "字幕",
    "特写",
    "近景",
    "中景",
    "远景",
    "全景",
    "俯拍",
    "仰拍",
    "愿影",
    "幻影",
    "回忆",
    "回声",
    "余音",
    "心声",
    "记忆",
    "影像",
    "画面",
    "声音",
    "声响",
    "无词",
    "无台词",
    "仅闻声",
    "不见人",
    "不露面",
    "传讯",
    "传音",
    "传讯符",
    "传音符",
    "传音玉简",
    "传讯玉简",
    "玉简传讯",
    "神识",
    "神识形",
    "识海",
    "识海声",
    "神魂",
    "元神",
    "分身",
    "投影",
    "残魂",
    "虚影",
    "化身",
    "少年",
    "少女",
    "青年",
    "中年",
    "老人",
    "老者",
    "老妇",
    "老妪",
    "妇人",
    "孩子",
    "孩童",
    "弟子",
    "修士",
    "长老",
    "掌柜",
    "管事",
    "执事",
    "士兵",
    "侍卫",
    "侍女",
    "丫鬟",
    "商贩",
    "摊贩",
    "村民",
    "镇民",
    "矿奴",
    "苦力",
    "队长",
    "首领",
    "护卫",
    "随从",
    "仆役",
    "小厮",
    "伙计",
    "学徒",
    "先生",
    "师父",
    "师傅",
    "前辈",
    "道友",
    "仙长",
    "大人",
    "公子",
    "小姐",
    "姑娘",
    "汉子",
    "船夫",
    "车夫",
    "众人",
    "群声",
    "众声",
    "群演",
    "人影",
    "身影",
    "背影",
    "面目",
    "老头子",
    "老儿",
    "老汉",
    "大娘",
    "母亲",
    "父亲",
    "娘",
    "爹",
    "妈妈",
    "爸爸",
    "祖母",
    "祖父",
    "奶奶",
    "爷爷",
    "外婆",
    "外公",
    "阿公",
    "阿婆",
    "婆婆",
    "大婶",
    "大叔",
}


def chapter_number(chapter_id):
    match = re.search(r"(\d+)$", chapter_id or "")
    return int(match.group(1)) if match else 0


def to_half_width(value):
    out = []
    for char in value or "":
        code = ord(char)
        out.append(chr(code - 0xFEE0) if 0xFF01 <= code <= 0xFF5E else char)
    return "".join(out)


def normalize(value):
    return re.sub(r"\s+", "", to_half_width(value or "").lower()).strip()


HARD_JUNK_NORM = {normalize(value) for value in HARD_JUNK_CHARS}


def unique_raw(values):
    out = []
    seen = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def unique_norm(values):
    out = []
    seen = set()
    for value in values:
        token = normalize(value)
        if not token or token in seen:
            continue
        seen.add(token)
        out.append(value.strip() if isinstance(value, str) else value)
    return out


def clean_asset_segment(value):
    text = (value or "").strip()
    if not text:
        return ""
    parts = [part for part in re.split(r"[\\/]", text) if part]
    filename = parts[-1] if parts else text
    return MEDIA_EXT_RE.sub("", filename).strip() or filename


def parse_asset_names(value):
    names = []
    for segment in NAME_COLUMN_SPLIT_RE.split(value or ""):
        cleaned = clean_asset_segment(segment)
        if cleaned:
            names.append(cleaned)
    return unique_norm(names)


def split_alias_column(value):
    return unique_norm(
        [token.strip() for token in ALIAS_COLUMN_SPLIT_RE.split(value or "") if token.strip()]
    )


def parse_corpus(corpus_dir):
    chapters = defaultdict(list)
    paths = sorted(
        os.path.join(corpus_dir, name)
        for name in os.listdir(corpus_dir)
        if name.startswith("batch-") and name.endswith(".txt")
    )
    for path in paths:
        current = None
        with open(path, encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.rstrip("\n")
                if line.startswith("### "):
                    current = line[4:].strip()
                    continue
                if not current or not line.startswith("|") or not line.endswith("|"):
                    continue
                fields = line[1:-1].split("|")
                if len(fields) != 5:
                    continue
                kind = fields[0].strip().lower()
                if kind not in KIND_KEYS:
                    continue
                names = parse_asset_names(fields[1])
                if not names:
                    continue
                aliases = unique_norm(names[1:] + split_alias_column(fields[2]))
                aliases = [alias for alias in aliases if normalize(alias) != normalize(names[0])]
                chapters[current].append(
                    {
                        "kind": kind,
                        "name": names[0],
                        "aliases": aliases,
                        "note": fields[4].strip(),
                    }
                )
    return chapters


def row_key(item):
    return "{}:{}".format(item["kind"], normalize(item["name"]))


def build_batch_lookup(items):
    owners = defaultdict(set)
    for item in items:
        owner = row_key(item)
        for alias in item["aliases"]:
            token = normalize(alias)
            if token:
                owners["{}:{}".format(item["kind"], token)].add(owner)
    return owners


def is_unambiguous_alias(item, token, owners):
    bucket = owners.get("{}:{}".format(item["kind"], token))
    if not bucket:
        return False
    self_key = row_key(item)
    foreign = [owner for owner in bucket if owner != self_key]
    return len(foreign) == 1


def is_unclaimed_alias(item, token, owners):
    bucket = owners.get("{}:{}".format(item["kind"], token))
    if not bucket:
        return True
    self_key = row_key(item)
    return all(owner == self_key for owner in bucket)


def find_batch_match(merged, item, owners):
    name_token = normalize(item["name"])
    if not name_token:
        return None
    same_kind = [candidate for candidate in merged if candidate["kind"] == item["kind"]]
    for candidate in same_kind:
        if normalize(candidate["name"]) == name_token:
            return candidate
    if is_hard_generic(name_token):
        return None
    if is_unambiguous_alias(item, name_token, owners):
        matches = [
            candidate
            for candidate in same_kind
            if any(normalize(alias) == name_token for alias in candidate["aliases"])
        ]
        if len(matches) == 1:
            return matches[0]
    alias_tokens = {
        normalize(alias)
        for alias in item["aliases"]
        if normalize(alias) and not is_hard_generic(normalize(alias))
    }
    if not alias_tokens:
        return None
    matches = [
        candidate
        for candidate in same_kind
        if normalize(candidate["name"]) in alias_tokens
        and is_unclaimed_alias(item, normalize(candidate["name"]), owners)
    ]
    return matches[0] if len(matches) == 1 else None


def dedupe_clusters(items):
    owners = build_batch_lookup(items)
    merged = []
    for item in items:
        existing = find_batch_match(merged, item, owners)
        if existing:
            existing["aliases"] = [
                alias
                for alias in unique_norm(
                    existing["aliases"] + [item["name"]] + item["aliases"]
                )
                if normalize(alias) != normalize(existing["name"])
            ]
            if not existing.get("note") and item.get("note"):
                existing["note"] = item["note"]
            continue
        merged.append(
            {
                "kind": item["kind"],
                "name": item["name"],
                "aliases": unique_norm(item["aliases"]),
                "note": item.get("note", ""),
            }
        )
    return merged


def load_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json_atomic(path, payload, minified=False):
    tmp_path = "{}.tmp-repair-{}".format(path, os.getpid())
    with open(tmp_path, "w", encoding="utf-8") as handle:
        if minified:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp_path, path)


def load_shards(chapters_dir):
    shards = {}
    if not os.path.isdir(chapters_dir):
        return shards
    for name in sorted(os.listdir(chapters_dir)):
        if not name.startswith("chapter-"):
            continue
        chapter_dir = os.path.join(chapters_dir, name)
        files = [
            os.path.join(chapter_dir, item)
            for item in os.listdir(chapter_dir)
            if item.startswith("entity-extractions-") and item.endswith(".json")
        ]
        if len(files) != 1:
            continue
        envelope = load_json(files[0])
        batches = envelope.get("state", {}).get("entityExtractions", [])
        if len(batches) != 1:
            continue
        shards[name] = {"path": files[0], "envelope": envelope, "batch": batches[0]}
    return shards


def record_id(kind, record):
    return record.get(KIND_ID[kind]) or ""


def record_name(record):
    return record.get("name") or ""


def record_aliases(record):
    aliases = record.get("aliases")
    return [alias for alias in aliases if isinstance(alias, str)] if isinstance(aliases, list) else []


def is_hard_generic(token):
    return (
        not token
        or len(token) < 2
        or token in HARD_GENERIC
    )


def build_library_indexes(libraries):
    canon = {kind: defaultdict(list) for kind in KIND_KEYS}
    by_id = {kind: {} for kind in KIND_KEYS}
    for kind, entries in libraries.items():
        for entry in entries:
            name = entry.get("name") or ""
            token = normalize(name)
            if not token:
                continue
            canon[kind][token].append(entry)
            entry_id = entry.get("id")
            if entry_id:
                by_id[kind][entry_id] = entry
    return canon, by_id


def link_cluster_to_library(kind, cluster, lib_canon):
    same_name = lib_canon[kind].get(normalize(cluster["name"]))
    if same_name:
        return same_name[0]
    hits = {}
    for alias in cluster["aliases"]:
        for entry in lib_canon[kind].get(normalize(alias), []):
            entry_id = entry.get("id")
            if entry_id:
                hits[entry_id] = entry
    if len(hits) == 1:
        return next(iter(hits.values()))
    return None


def build_generic_tokens(clusters_by_chapter, threshold):
    owners = defaultdict(set)
    for clusters in clusters_by_chapter.values():
        for cluster in clusters:
            primary = normalize(cluster["name"])
            for alias in cluster["aliases"]:
                token = normalize(alias)
                if token:
                    owners[(cluster["kind"], token)].add(primary)
    generic = {kind: set() for kind in KIND_KEYS}
    for (kind, token), names in owners.items():
        if len(names) >= threshold:
            generic[kind].add(token)
    return generic


def ambiguous_note_tokens(clusters_by_chapter, threshold=2):
    owners = defaultdict(set)
    for clusters in clusters_by_chapter.values():
        for cluster in clusters:
            primary = normalize(cluster["name"])
            for alias in cluster["aliases"]:
                token = normalize(alias)
                if token:
                    owners[(cluster["kind"], token)].add(primary)
    return {
        (kind, token)
        for (kind, token), names in owners.items()
        if len(names) >= threshold
    }


def assign_clusters(kind, clusters, records, generic_tokens):
    assignments = {}
    used = set()
    for cluster_index, cluster in enumerate(clusters):
        name_token = normalize(cluster["name"])
        candidates = [
            index
            for index, record in enumerate(records)
            if index not in used and normalize(record_name(record)) == name_token
        ]
        if candidates:
            assignments[cluster_index] = candidates[0]
            used.add(candidates[0])
    for cluster_index, cluster in enumerate(clusters):
        if cluster_index in assignments:
            continue
        name_token = normalize(cluster["name"])
        if name_token in generic_tokens[kind] or is_hard_generic(name_token):
            continue
        candidates = [
            index
            for index, record in enumerate(records)
            if index not in used
            and any(normalize(alias) == name_token for alias in record_aliases(record))
        ]
        if len(candidates) == 1:
            assignments[cluster_index] = candidates[0]
            used.add(candidates[0])
    for cluster_index, cluster in enumerate(clusters):
        if cluster_index in assignments:
            continue
        alias_tokens = {normalize(alias) for alias in cluster["aliases"] if normalize(alias)}
        candidates = []
        for index, record in enumerate(records):
            if index in used:
                continue
            name_token = normalize(record_name(record))
            if (
                name_token in alias_tokens
                and name_token not in generic_tokens[kind]
                and not is_hard_generic(name_token)
            ):
                candidates.append(index)
        if len(candidates) == 1:
            assignments[cluster_index] = candidates[0]
            used.add(candidates[0])
    return assignments, used


def clean_alias_list(
    kind,
    record_name_value,
    cluster,
    chapter_primary_tokens,
    linked_ids,
    lib_canon,
    generic_tokens,
):
    candidates = []
    if normalize(cluster["name"]) != normalize(record_name_value):
        candidates.append(cluster["name"])
    candidates.extend(cluster["aliases"])
    cleaned = []
    seen = set()
    for alias in candidates:
        token = normalize(alias)
        if not token or token == normalize(record_name_value) or token in seen:
            continue
        if token in generic_tokens[kind] or is_hard_generic(token):
            continue
        if token in chapter_primary_tokens[kind] and token != normalize(cluster["name"]):
            continue
        canonical_entries = lib_canon[kind].get(token)
        if canonical_entries:
            entry_ids = {entry.get("id") for entry in canonical_entries}
            if not (entry_ids & linked_ids):
                continue
        seen.add(token)
        cleaned.append(alias)
    return cleaned


def next_chapter_scoped_id(kind, chapter_id, used_ids, record_ids):
    prefix = KIND_PREFIX[kind]
    pattern = re.compile(r"^{}-{}-(\d+)$".format(re.escape(prefix), re.escape(chapter_id)))
    max_suffix = 0
    for value in list(used_ids) + list(record_ids):
        match = pattern.match(value or "")
        if match:
            max_suffix = max(max_suffix, int(match.group(1)))
    candidate = max_suffix + 1
    while True:
        value = "{}-{}-{}".format(prefix, chapter_id, candidate)
        if value not in used_ids:
            return value
        candidate += 1


def build_trusted_aliases(clusters_by_chapter, lib_canon, min_chapters=2):
    """只认语料里跨至少两章成对出现的别名,且排除泛化角色词。

    库备注与单章语料都可能把「玄清子」这类独立角色写进别人的别名栏;
    单章声明不足以建立全库挂靠,阈值 2 起才认。
    """
    claims = {kind: {} for kind in KIND_KEYS}

    def add_claim(kind, entry_id, token, chapter_id):
        per_entry = claims[kind].setdefault(entry_id, {})
        per_entry.setdefault(token, set()).add(chapter_id)

    for chapter_id, clusters in clusters_by_chapter.items():
        for cluster in clusters:
            kind = cluster["kind"]
            name_token = normalize(cluster["name"])
            if not name_token:
                continue
            canonical = [
                entry
                for entry in lib_canon[kind].get(name_token, [])
                if entry.get("id")
            ]
            if len(canonical) == 1:
                for alias in cluster["aliases"]:
                    token = normalize(alias)
                    if token and not is_hard_generic(token):
                        add_claim(kind, canonical[0]["id"], token, chapter_id)
            for alias in cluster["aliases"]:
                token = normalize(alias)
                if not token or is_hard_generic(token):
                    continue
                alias_entries = [
                    entry
                    for entry in lib_canon[kind].get(token, [])
                    if entry.get("id")
                ]
                if (
                    len(alias_entries) == 1
                    and normalize(alias_entries[0]["name"]) != name_token
                ):
                    add_claim(kind, alias_entries[0]["id"], name_token, chapter_id)
    return {
        kind: {
            entry_id: {
                token
                for token, chapters in tokens.items()
                if len(chapters) >= min_chapters
            }
            for entry_id, tokens in claims[kind].items()
        }
        for kind in KIND_KEYS
    }


def normalize_flashback_records(kind, records, clusters_of_kind, lib_canon, stats):
    if kind != "character":
        return records
    cluster_tokens = {normalize(cluster["name"]) for cluster in clusters_of_kind}
    drop = set()
    for index, record in enumerate(records):
        match = re.match(r"^闪回(.+)$", record_name(record))
        if not match:
            continue
        suffix = match.group(1)
        token = normalize(suffix)
        if token not in cluster_tokens:
            continue
        entries = [
            entry for entry in lib_canon[kind].get(token, []) if entry.get("id")
        ]
        if len(entries) != 1:
            continue
        existing = next(
            (
                other
                for other, candidate in enumerate(records)
                if other != index and normalize(record_name(candidate)) == token
            ),
            None,
        )
        if existing is not None:
            records[existing]["aliases"] = unique_norm(
                records[existing].get("aliases", [])
                + record_aliases(record)
                + [record_name(record)]
            )
            if not records[existing].get("note") and record.get("note"):
                records[existing]["note"] = record["note"]
            drop.add(index)
            stats["flashback_merged"] += 1
        else:
            record["name"] = suffix
            record[KIND_ID[kind]] = entries[0]["id"]
            stats["flashback_renamed"] += 1
    if drop:
        records = [record for index, record in enumerate(records) if index not in drop]
    return records


def resolve_record_ids(
    kind, chapter_id, records, lib_canon, lib_by_id, trusted_aliases, stats
):
    """按规范名把错挂的库 id 改挂到真身;语料不认可的挂靠降为章内 id。

    存量 1,525 条库挂记录的名字与库条目对不上(旧 known 匹配把模型名挂到
    被污染别名指向的库 id)。处理序:规范名改挂优先;其次认语料里成对出现
    过的真别名;剩下的既非规范名也非可信别名的挂靠一律降级为章内 id,避免
    把「玄清子」这类独立角色继续挂在「晏燎」的库 id 上。
    """
    id_key = KIND_ID[kind]
    used_ids = {record.get(id_key) for record in records if record.get(id_key)}
    for record in records:
        current_id = record.get(id_key)
        if not current_id or current_id not in lib_by_id[kind]:
            continue
        name_token = normalize(record_name(record))
        entry = lib_by_id[kind].get(current_id) or {}
        if name_token == normalize(entry.get("name")):
            continue
        candidates = [
            item
            for item in lib_canon[kind].get(name_token, [])
            if item.get("id")
        ]
        if len(candidates) == 1:
            target_id = candidates[0].get("id")
            if target_id and target_id != current_id:
                record[id_key] = target_id
                stats["id_relinked"] += 1
                stats["id_relinked_rows"].append(
                    (chapter_id, kind, record_name(record), current_id, target_id)
                )
            continue
        if name_token in trusted_aliases[kind].get(current_id, set()):
            continue
        new_id = next_chapter_scoped_id(kind, chapter_id, used_ids, set())
        used_ids.add(new_id)
        record[id_key] = new_id
        stats["id_detached"] += 1
        stats["id_detached_rows"].append(
            (chapter_id, kind, record_name(record), current_id, new_id)
        )

    groups = defaultdict(list)
    for index, record in enumerate(records):
        groups[record.get(id_key) or ""].append(index)
    drop = set()
    for current_id, indexes in groups.items():
        if not current_id or len(indexes) < 2:
            continue
        by_name = defaultdict(list)
        for index in indexes:
            by_name[normalize(record_name(records[index]))].append(index)
        for same_name_indexes in by_name.values():
            if len(same_name_indexes) < 2:
                continue
            keeper = same_name_indexes[0]
            for index in same_name_indexes[1:]:
                records[keeper]["aliases"] = unique_norm(
                    records[keeper].get("aliases", [])
                    + [record_name(records[index])]
                    + record_aliases(records[index])
                )
                if not records[keeper].get("note") and records[index].get("note"):
                    records[keeper]["note"] = records[index]["note"]
                drop.add(index)
                stats["duplicate_id_merged"] += 1
        remaining = [index for index in indexes if index not in drop]
        if len(remaining) < 2:
            continue
        entry = lib_by_id[kind].get(current_id)
        target_name = normalize((entry or {}).get("name") or "")
        keeper = next(
            (
                index
                for index in remaining
                if normalize(record_name(records[index])) == target_name
            ),
            remaining[0],
        )
        for index in remaining:
            if index == keeper:
                continue
            new_id = next_chapter_scoped_id(kind, chapter_id, used_ids, set())
            records[index][id_key] = new_id
            used_ids.add(new_id)
            stats["duplicate_id_split"] += 1
            stats["id_split_rows"].append(
                (chapter_id, kind, record_name(records[index]), current_id, new_id)
            )
    if drop:
        records = [record for index, record in enumerate(records) if index not in drop]
    return records


def repack_record(kind, record):
    if kind == "character":
        return {
            "characterId": record["characterId"],
            "name": record["name"],
            "aliases": record.get("aliases", []),
            **({"note": record["note"]} if record.get("note") else {}),
        }
    if kind == "scene":
        return {
            "sceneId": record["sceneId"],
            "name": record["name"],
            "aliases": record.get("aliases", []),
            **({"note": record["note"]} if record.get("note") else {}),
        }
    return {
        "assetId": record["assetId"],
        "name": record["name"],
        "aliases": record.get("aliases", []),
        **({"note": record["note"]} if record.get("note") else {}),
    }


def resolve_output_duplicate_ids(kind, chapter_id, records, lib_by_id, stats):
    id_key = KIND_ID[kind]
    used_ids = {record.get(id_key) for record in records if record.get(id_key)}
    groups = defaultdict(list)
    for index, record in enumerate(records):
        groups[record.get(id_key) or ""].append(index)
    for current_id, indexes in groups.items():
        if not current_id or len(indexes) < 2:
            continue
        entry = lib_by_id[kind].get(current_id)
        target_name = normalize((entry or {}).get("name") or "")
        keeper = next(
            (
                index
                for index in indexes
                if normalize(record_name(records[index])) == target_name
            ),
            indexes[0],
        )
        for index in indexes:
            if index == keeper:
                continue
            new_id = next_chapter_scoped_id(kind, chapter_id, used_ids, set())
            used_ids.add(new_id)
            records[index][id_key] = new_id
            stats["output_id_split"] += 1
            stats["output_id_split_rows"].append(
                (chapter_id, kind, record_name(records[index]), current_id, new_id)
            )
    return records


def process_chapter(
    chapter_id,
    clusters,
    batch,
    lib_canon,
    lib_by_id,
    trusted_aliases,
    generic_tokens,
    stats,
):
    chapter_primary_tokens = {kind: set() for kind in KIND_KEYS}
    for cluster in clusters:
        chapter_primary_tokens[cluster["kind"]].add(normalize(cluster["name"]))

    output = {}
    record_ids_by_kind = {}
    for kind, batch_key in KIND_KEYS.items():
        clusters_of_kind = [cluster for cluster in clusters if cluster["kind"] == kind]
        records = []
        for record in batch.get(batch_key, []):
            if kind == "character" and normalize(record_name(record)) in HARD_JUNK_NORM:
                stats["junk_dropped"] += 1
                stats["junk_dropped_rows"].append(
                    (chapter_id, kind, record_name(record), record_id(kind, record))
                )
                continue
            records.append(record)
        records = normalize_flashback_records(
            kind, records, clusters_of_kind, lib_canon, stats
        )
        records = resolve_record_ids(
            kind,
            chapter_id,
            records,
            lib_canon,
            lib_by_id,
            trusted_aliases,
            stats,
        )
        record_ids_by_kind[kind] = {
            record_id(kind, record) for record in records if record_id(kind, record)
        }
        assignments, used = assign_clusters(kind, clusters_of_kind, records, generic_tokens)
        cluster_by_record = {record_index: cluster_index for cluster_index, record_index in assignments.items()}

        kind_output = []
        id_to_output = {}
        for record_index, record in enumerate(records):
            if record_index not in used:
                kind_output.append(record)
                stats["unmatched_existing_kept"] += 1
                stats["unmatched_existing_rows"].append(
                    (chapter_id, kind, record_name(record), record_id(kind, record))
                )
                continue
            cluster = clusters_of_kind[cluster_by_record[record_index]]
            current_id = record_id(kind, record)
            linked_ids = {current_id} if current_id in lib_by_id[kind] else set()
            record["aliases"] = clean_alias_list(
                kind,
                record_name(record),
                cluster,
                chapter_primary_tokens,
                linked_ids,
                lib_canon,
                generic_tokens,
            )
            if not record.get("note") and cluster.get("note"):
                record["note"] = cluster["note"]
            kind_output.append(record)
            if current_id:
                id_to_output[current_id] = record
            stats["matched_existing"] += 1

        used_ids = set(record_ids_by_kind[kind])
        for cluster_index, cluster in enumerate(clusters_of_kind):
            if cluster_index in assignments:
                continue
            linked = link_cluster_to_library(kind, cluster, lib_canon)
            if linked is not None:
                name_value = linked.get("name") or cluster["name"]
                new_id = linked.get("id")
                linked_ids = {new_id} if new_id else set()
            else:
                name_value = cluster["name"]
                new_id = None
                linked_ids = set()
            aliases = clean_alias_list(
                kind,
                name_value,
                cluster,
                chapter_primary_tokens,
                linked_ids,
                lib_canon,
                generic_tokens,
            )
            if new_id and new_id in id_to_output:
                existing = id_to_output[new_id]
                existing_token = normalize(record_name(existing))
                compatible = (
                    existing_token == normalize(name_value)
                    or existing_token == normalize(cluster["name"])
                    or existing_token
                    in {normalize(alias) for alias in cluster["aliases"]}
                )
                if compatible:
                    merged_aliases = list(existing.get("aliases", [])) + aliases
                    if existing_token != normalize(cluster["name"]):
                        merged_aliases.append(cluster["name"])
                    existing["aliases"] = unique_norm(merged_aliases)
                    if not existing.get("note") and cluster.get("note"):
                        existing["note"] = cluster["note"]
                    stats["restored_merged_into_linked"] += 1
                    continue
            if not new_id:
                new_id = next_chapter_scoped_id(
                    kind, chapter_id, used_ids, record_ids_by_kind[kind]
                )
            used_ids.add(new_id)
            record = {KIND_ID[kind]: new_id, "name": name_value, "aliases": aliases}
            if cluster.get("note"):
                record["note"] = cluster["note"]
            kind_output.append(record)
            id_to_output[new_id] = record
            stats["restored"] += 1
            stats["restored_by_kind"][kind] += 1
            if linked is not None:
                stats["restored_linked_library"] += 1
            else:
                stats["restored_new_chapter_id"] += 1
            stats["restored_rows"].append(
                (
                    chapter_id,
                    kind,
                    cluster["name"],
                    name_value,
                    new_id,
                    "library" if linked is not None else "chapter",
                    "、".join(aliases),
                )
            )
        kind_output = resolve_output_duplicate_ids(
            kind, chapter_id, kind_output, lib_by_id, stats
        )
        output[kind] = kind_output
    return output


def unique_aliases(name_value, aliases):
    self_token = normalize(name_value)
    out = []
    seen = set()
    for alias in aliases:
        text = (alias or "").strip()
        if not text or text in seen:
            continue
        if normalize(text) == self_token:
            continue
        seen.add(text)
        out.append(text)
    return out


def build_index(output_by_chapter):
    index = {}
    lookup = defaultdict(set)
    for chapter_id in sorted(output_by_chapter, key=chapter_number):
        output = output_by_chapter[chapter_id]
        for kind in ("character", "scene", "prop"):
            for record in output[kind]:
                name_value = record_name(record)
                name_token = normalize(name_value)
                if not name_token:
                    continue
                primary_key = "{}:{}".format(kind, name_token)
                match_key = None
                if primary_key in index:
                    match_key = primary_key
                else:
                    owners = lookup.get(primary_key)
                    if owners and len(owners) == 1:
                        match_key = next(iter(owners))
                if match_key is None:
                    candidates = set()
                    for alias in record_aliases(record):
                        token = normalize(alias)
                        if not token:
                            continue
                        key = "{}:{}".format(kind, token)
                        if key not in index:
                            continue
                        aliases_here = lookup.get(key)
                        if aliases_here:
                            continue
                        candidates.add(key)
                    if len(candidates) == 1:
                        match_key = next(iter(candidates))
                key = match_key or primary_key
                existing = index.get(key)
                importance = record.get("importance")
                if not existing:
                    entry = {
                        "kind": kind,
                        "name": name_value,
                        "aliases": unique_aliases(name_value, record_aliases(record)),
                    }
                    if importance:
                        entry["importance"] = importance
                    entry["firstChapterId"] = chapter_id
                    entry["chapterIds"] = [chapter_id]
                    index[key] = entry
                    for alias in entry["aliases"]:
                        lookup["{}:{}".format(kind, normalize(alias))].add(key)
                    continue
                merged_chapters = sorted(
                    set(existing["chapterIds"] + [chapter_id]), key=chapter_number
                )
                merged_aliases = unique_aliases(
                    existing["name"],
                    existing["aliases"] + [name_value] + record_aliases(record),
                )
                entry = {
                    "kind": existing["kind"],
                    "name": existing["name"],
                    "aliases": merged_aliases,
                }
                ranks = {"npc": 1, "supporting": 2, "protagonist": 3}
                current_importance = existing.get("importance")
                if current_importance and importance:
                    entry["importance"] = (
                        importance
                        if ranks.get(importance, 0) > ranks.get(current_importance, 0)
                        else current_importance
                    )
                elif current_importance or importance:
                    entry["importance"] = importance or current_importance
                entry["firstChapterId"] = (
                    chapter_id
                    if chapter_number(chapter_id) < chapter_number(existing["firstChapterId"])
                    else existing["firstChapterId"]
                )
                entry["chapterIds"] = merged_chapters
                index[key] = entry
                for alias in entry["aliases"]:
                    lookup["{}:{}".format(kind, normalize(alias))].add(key)
    return index


def parse_alias_line(notes):
    first_line = (notes or "").strip().split("\n")[0]
    if not re.match(r"^别名[：:]", first_line):
        return None
    tokens = []
    for token in re.split(r"[、,，;；]", first_line.replace("别名：", "").replace("别名:", "")):
        cleaned = TRAILING_PUNCT_RE.sub("", token).strip()
        if cleaned:
            tokens.append(cleaned)
    return tokens


def clean_library_notes(libraries, lib_canon, ambiguous, kind, stats):
    changed = 0
    removed = Counter()
    rows = []
    for entry in libraries[kind]:
        notes = entry.get("notes") or ""
        tokens = parse_alias_line(notes)
        if not tokens:
            continue
        entry_id = entry.get("id")
        self_token = normalize(entry.get("name") or "")
        kept = []
        removed_here = []
        seen = set()
        for token in tokens:
            normalized = normalize(token)
            if not normalized or normalized == self_token or normalized in seen:
                removed_here.append(token)
                continue
            if is_hard_generic(normalized):
                removed_here.append(token)
                continue
            if (kind, normalized) in ambiguous:
                removed_here.append(token)
                continue
            canonical_entries = lib_canon[kind].get(normalized)
            if canonical_entries:
                entry_ids = {item.get("id") for item in canonical_entries}
                if entry_id not in entry_ids:
                    removed_here.append(token)
                    continue
            seen.add(normalized)
            kept.append(token)
        if not removed_here:
            continue
        removed.update(removed_here)
        lines = notes.split("\n")
        if kept:
            lines[0] = "别名：" + "、".join(kept)
            new_notes = "\n".join(lines)
        else:
            new_notes = "\n".join(lines[1:])
        entry["notes"] = new_notes
        changed += 1
        rows.append((kind, entry_id, entry.get("name"), "、".join(removed_here)))
    stats["library_notes_changed"] += changed
    stats["library_alias_tokens_removed"] += sum(removed.values())
    stats["library_removed_tokens"].update(removed)
    return rows


def write_csv(path, header, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        for row in rows:
            writer.writerow(row)


def load_flagged_junk(evidence_dir):
    candidates = [
        os.path.join(evidence_dir, "chapter-match-junk.csv"),
        os.path.join(DEFAULT_EVIDENCE, "chapter-match-junk.csv"),
    ]
    path = next((item for item in candidates if os.path.exists(item)), None)
    if not path:
        return set()
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return {
            (row["chapter"], row["kind"], row["name"])
            for row in csv.DictReader(handle)
            if row.get("chapter") and row.get("kind") and row.get("name")
        }


def clone_path(src, dst, is_dir):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if is_dir:
        subprocess.run(["cp", "-Rc", src, dst], check=True)
    else:
        subprocess.run(["cp", "-c", src, dst], check=True)


def create_backup(root, stamp):
    backup_dir = os.path.join(root, "store-backup-{}-pre-entity-repair".format(stamp))
    if os.path.exists(backup_dir):
        raise SystemExit("backup dir already exists: {}".format(backup_dir))
    os.makedirs(backup_dir)
    items = [
        (os.path.join(root, "store/characters.json"), os.path.join(backup_dir, "store/characters.json"), False),
        (os.path.join(root, "store/scenes.json"), os.path.join(backup_dir, "store/scenes.json"), False),
        (os.path.join(root, "store/props.json"), os.path.join(backup_dir, "store/props.json"), False),
        (os.path.join(root, APPEARANCE_REL), os.path.join(backup_dir, APPEARANCE_REL), False),
        (os.path.join(root, CHAPTERS_REL), os.path.join(backup_dir, CHAPTERS_REL), True),
    ]
    for src, dst, is_dir in items:
        if not os.path.exists(src):
            raise SystemExit("backup source missing: {}".format(src))
        clone_path(src, dst, is_dir)
    shard_count = 0
    for name in os.listdir(os.path.join(root, CHAPTERS_REL)):
        chapter_dir = os.path.join(root, CHAPTERS_REL, name)
        if os.path.isdir(chapter_dir):
            shard_count += len(
                [
                    item
                    for item in os.listdir(chapter_dir)
                    if item.startswith("entity-extractions-") and item.endswith(".json")
                ]
            )
    backup_shard_count = 0
    backup_chapters = os.path.join(backup_dir, CHAPTERS_REL)
    for name in os.listdir(backup_chapters):
        chapter_dir = os.path.join(backup_chapters, name)
        if os.path.isdir(chapter_dir):
            backup_shard_count += len(
                [
                    item
                    for item in os.listdir(chapter_dir)
                    if item.startswith("entity-extractions-") and item.endswith(".json")
                ]
            )
    if shard_count != backup_shard_count:
        raise SystemExit(
            "backup shard count mismatch: {} vs {}".format(shard_count, backup_shard_count)
        )
    return backup_dir


def validate(final_shards, clusters_by_chapter, chapter_ids, index, lib_by_id, stats):
    failures = []
    generic_exempt = []
    for chapter_id in chapter_ids:
        clusters = clusters_by_chapter.get(chapter_id, [])
        shard = final_shards.get(chapter_id)
        if not shard:
            failures.append((chapter_id, "missing-shard", "", ""))
            continue
        for cluster in clusters:
            records = shard["batch"].get(KIND_KEYS[cluster["kind"]], [])
            name_token = normalize(cluster["name"])
            found = any(
                normalize(record_name(record)) == name_token
                or any(normalize(alias) == name_token for alias in record_aliases(record))
                for record in records
            )
            if found:
                continue
            if is_hard_generic(name_token) or name_token in stats["generic_tokens"][cluster["kind"]]:
                generic_exempt.append((chapter_id, cluster["kind"], cluster["name"]))
                continue
            failures.append((chapter_id, cluster["kind"], cluster["name"], "cluster-not-in-shard"))

    index_names = set()
    for entry in index.values():
        index_names.add("{}:{}".format(entry["kind"], normalize(entry["name"])))
        for alias in entry["aliases"]:
            index_names.add("{}:{}".format(entry["kind"], normalize(alias)))
    index_failures = []
    duplicate_ids = []
    for chapter_id in chapter_ids:
        shard = final_shards[chapter_id]
        for kind, batch_key in KIND_KEYS.items():
            seen_ids = set()
            for record in shard["batch"].get(batch_key, []):
                name_value = record_name(record)
                key = "{}:{}".format(kind, normalize(name_value))
                if key not in index_names:
                    index_failures.append((chapter_id, kind, name_value, "name-not-in-index"))
                current_id = record_id(kind, record)
                if current_id and current_id in seen_ids:
                    duplicate_ids.append((chapter_id, kind, current_id))
                seen_ids.add(current_id)

    library_id_before = stats["library_id_records_before"]
    library_id_after = 0
    for chapter_id in chapter_ids:
        shard = final_shards[chapter_id]
        for kind, batch_key in KIND_KEYS.items():
            for record in shard["batch"].get(batch_key, []):
                if record_id(kind, record) in lib_by_id[kind]:
                    library_id_after += 1
    intentional_drop = (
        stats["id_detached"]
        + stats["duplicate_id_merged"]
        + stats["duplicate_id_split"]
        + stats["output_id_split"]
    )
    if library_id_after < library_id_before - intentional_drop:
        failures.append(
            ("*", "library-id", str(library_id_before), "dropped-to-{}".format(library_id_after))
        )
    return {
        "cluster_missing": failures,
        "cluster_missing_count": len(failures),
        "generic_alias_exempt": len(generic_exempt),
        "generic_alias_exempt_rows": generic_exempt,
        "index_missing": index_failures,
        "index_missing_count": len(index_failures),
        "duplicate_ids": duplicate_ids,
        "duplicate_id_count": len(duplicate_ids),
        "library_id_records_before": library_id_before,
        "library_id_records_after": library_id_after,
        "library_id_intentional_drop": intentional_drop,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default=DEFAULT_PROJECT)
    parser.add_argument("--corpus", default=DEFAULT_CORPUS)
    parser.add_argument("--evidence-dir", default=DEFAULT_EVIDENCE)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--no-backup", action="store_true")
    parser.add_argument("--generic-threshold", type=int, default=5)
    parser.add_argument("--limit", type=int, default=0, help="debug: only N chapters")
    args = parser.parse_args()

    root = os.path.abspath(args.project_root)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    print("[repair] root={} mode={}".format(root, "apply" if args.apply else "dry-run"))

    libraries = {}
    library_files = {}
    for kind, rel in KIND_LIB_REL.items():
        path = os.path.join(root, rel)
        document = load_json(path)
        libraries[kind] = document["state"][LIB_STATE_KEY[kind]]
        library_files[kind] = document
    lib_canon, lib_by_id = build_library_indexes(libraries)

    raw_corpus = parse_corpus(args.corpus)
    flagged_junk = load_flagged_junk(args.evidence_dir)
    clusters_by_chapter = {}
    junk_rows = []
    for chapter_id, rows in raw_corpus.items():
        cleaned = []
        for row in rows:
            original_name = row["name"]
            action = None
            if row["kind"] == "character":
                token = normalize(row["name"])
                if token in HARD_JUNK_NORM:
                    junk_rows.append((chapter_id, row["kind"], original_name, "dropped", "hard-junk"))
                    action = "dropped"
                else:
                    match = re.match(r"^闪回(.+)$", row["name"])
                    if match and normalize(match.group(1)) in lib_canon["character"]:
                        row = dict(row)
                        row["name"] = match.group(1)
                        row["aliases"] = unique_norm([original_name] + row["aliases"])
                        junk_rows.append(
                            (chapter_id, row["kind"], original_name, "normalized", "flashback-prefix")
                        )
                        action = "normalized"
            if (
                action is None
                and (chapter_id, row["kind"], original_name) in flagged_junk
            ):
                junk_rows.append(
                    (chapter_id, row["kind"], original_name, "kept", "descriptive-scene-keep")
                )
            if action == "dropped":
                continue
            cleaned.append(row)
        clusters_by_chapter[chapter_id] = dedupe_clusters(cleaned)

    generic_tokens = build_generic_tokens(clusters_by_chapter, args.generic_threshold)
    ambiguous_notes = ambiguous_note_tokens(clusters_by_chapter, 2)
    trusted_aliases = build_trusted_aliases(clusters_by_chapter, lib_canon)

    shards = load_shards(os.path.join(root, CHAPTERS_REL))
    chapter_ids = sorted(shards, key=chapter_number)
    if args.limit:
        chapter_ids = chapter_ids[: args.limit]
    missing_corpus = [chapter_id for chapter_id in chapter_ids if chapter_id not in clusters_by_chapter]
    if missing_corpus:
        print("[repair] WARN chapters without corpus rows: {}".format(len(missing_corpus)))

    stats = {
        "junk_dropped": 0,
        "junk_dropped_rows": [],
        "matched_existing": 0,
        "id_relinked": 0,
        "id_relinked_rows": [],
        "id_detached": 0,
        "id_detached_rows": [],
        "flashback_renamed": 0,
        "flashback_merged": 0,
        "output_id_split": 0,
        "output_id_split_rows": [],
        "duplicate_id_merged": 0,
        "duplicate_id_split": 0,
        "id_split_rows": [],
        "unmatched_existing_kept": 0,
        "unmatched_existing_rows": [],
        "restored": 0,
        "restored_by_kind": Counter(),
        "restored_linked_library": 0,
        "restored_new_chapter_id": 0,
        "restored_merged_into_linked": 0,
        "restored_rows": [],
        "library_notes_changed": 0,
        "library_alias_tokens_removed": 0,
        "library_removed_tokens": Counter(),
        "library_id_records_before": 0,
        "generic_tokens": generic_tokens,
    }
    alias_before = 0
    alias_after = 0
    records_before = 0
    records_after = 0
    for chapter_id in chapter_ids:
        shard = shards[chapter_id]
        batch = shard["batch"]
        for kind, batch_key in KIND_KEYS.items():
            for record in batch.get(batch_key, []):
                records_before += 1
                alias_before += len(record_aliases(record))
                if record_id(kind, record) in lib_by_id[kind]:
                    stats["library_id_records_before"] += 1
        output = process_chapter(
            chapter_id,
            clusters_by_chapter.get(chapter_id, []),
            batch,
            lib_canon,
            lib_by_id,
            trusted_aliases,
            generic_tokens,
            stats,
        )
        for kind, batch_key in KIND_KEYS.items():
            batch[batch_key] = output[kind]
        shard["changed"] = True
        for kind, batch_key in KIND_KEYS.items():
            for record in batch.get(batch_key, []):
                records_after += 1
                alias_after += len(record_aliases(record))

    index = build_index(
        {
            chapter_id: {
                kind: shards[chapter_id]["batch"].get(KIND_KEYS[kind], [])
                for kind in KIND_KEYS
            }
            for chapter_id in chapter_ids
        }
    )

    library_rows = []
    for kind in ("character", "scene"):
        library_rows.extend(clean_library_notes(libraries, lib_canon, ambiguous_notes, kind, stats))

    index_path = os.path.join(root, APPEARANCE_REL)
    index_entries_before = len(load_json(index_path)) if os.path.exists(index_path) else 0
    validation = validate(
        shards,
        {chapter_id: clusters_by_chapter.get(chapter_id, []) for chapter_id in chapter_ids},
        chapter_ids,
        index,
        lib_by_id,
        stats,
    )
    validation["junk_dropped"] = stats["junk_dropped"]
    validation["junk_kept"] = len(
        [
            row
            for row in junk_rows
            if row[3] == "kept"
        ]
    )

    summary = {
        "generatedAt": stamp,
        "projectRoot": root,
        "mode": "apply" if args.apply else "dry-run",
        "chapters": len(chapter_ids),
        "corpusChapters": len(clusters_by_chapter),
        "corpusRows": sum(len(rows) for rows in raw_corpus.values()),
        "clusters": sum(len(clusters) for clusters in clusters_by_chapter.values()),
        "recordsBefore": records_before,
        "recordsAfter": records_after,
        "aliasTokensBefore": alias_before,
        "aliasTokensAfter": alias_after,
        "matchedExisting": stats["matched_existing"],
        "restored": stats["restored"],
        "restoredByKind": dict(stats["restored_by_kind"]),
        "restoredLinkedLibrary": stats["restored_linked_library"],
        "restoredNewChapterId": stats["restored_new_chapter_id"],
        "restoredMergedIntoLinked": stats["restored_merged_into_linked"],
        "unmatchedExistingKept": stats["unmatched_existing_kept"],
        "idRelinked": stats["id_relinked"],
        "idDetached": stats["id_detached"],
        "flashbackRenamed": stats["flashback_renamed"],
        "flashbackMerged": stats["flashback_merged"],
        "outputIdSplit": stats["output_id_split"],
        "duplicateIdMerged": stats["duplicate_id_merged"],
        "duplicateIdSplit": stats["duplicate_id_split"],
        "junkDropped": stats["junk_dropped"],
        "junkDroppedRows": len([row for row in junk_rows if row[3] == "dropped"]),
        "junkNormalizedRows": len([row for row in junk_rows if row[3] == "normalized"]),
        "junkKeptRows": len([row for row in junk_rows if row[3] == "kept"]),
        "junkRows": [list(row) for row in junk_rows],
        "genericAliasTokens": {
            kind: len(tokens) for kind, tokens in generic_tokens.items()
        },
        "genericThreshold": args.generic_threshold,
        "libraryNotesChanged": stats["library_notes_changed"],
        "libraryAliasTokensRemoved": stats["library_alias_tokens_removed"],
        "libraryRemovedTop": stats["library_removed_tokens"].most_common(20),
        "indexEntriesBefore": index_entries_before,
        "indexEntriesAfter": len(index),
        "validation": {
            "clusterMissing": validation["cluster_missing_count"],
            "genericAliasExempt": validation["generic_alias_exempt"],
            "indexMissing": validation["index_missing_count"],
            "duplicateIds": validation["duplicate_id_count"],
            "libraryIdRecordsBefore": validation["library_id_records_before"],
            "libraryIdRecordsAfter": validation["library_id_records_after"],
        },
    }

    os.makedirs(args.evidence_dir, exist_ok=True)
    prefix = "entity-repair-{}".format("apply" if args.apply else "dryrun")
    summary_path = os.path.join(args.evidence_dir, "{}-summary-{}.json".format(prefix, stamp))
    with open(summary_path, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    write_csv(
        os.path.join(args.evidence_dir, "{}-restored-{}.csv".format(prefix, stamp)),
        ["chapter", "kind", "corpus_name", "record_name", "record_id", "id_source", "aliases"],
        stats["restored_rows"],
    )
    write_csv(
        os.path.join(args.evidence_dir, "{}-unmatched-{}.csv".format(prefix, stamp)),
        ["chapter", "kind", "name", "record_id"],
        stats["unmatched_existing_rows"],
    )
    write_csv(
        os.path.join(args.evidence_dir, "{}-junk-{}.csv".format(prefix, stamp)),
        ["chapter", "kind", "name", "action", "reason"],
        junk_rows,
    )
    write_csv(
        os.path.join(args.evidence_dir, "{}-library-notes-{}.csv".format(prefix, stamp)),
        ["kind", "id", "name", "removed_tokens"],
        library_rows,
    )
    write_csv(
        os.path.join(args.evidence_dir, "{}-id-relinked-{}.csv".format(prefix, stamp)),
        ["chapter", "kind", "name", "old_id", "new_id"],
        stats["id_relinked_rows"],
    )
    write_csv(
        os.path.join(args.evidence_dir, "{}-id-split-{}.csv".format(prefix, stamp)),
        ["chapter", "kind", "name", "kept_id", "new_id"],
        stats["id_split_rows"],
    )
    write_csv(
        os.path.join(args.evidence_dir, "{}-id-detached-{}.csv".format(prefix, stamp)),
        ["chapter", "kind", "name", "old_id", "new_id"],
        stats["id_detached_rows"],
    )
    write_csv(
        os.path.join(args.evidence_dir, "{}-output-id-split-{}.csv".format(prefix, stamp)),
        ["chapter", "kind", "name", "kept_id", "new_id"],
        stats["output_id_split_rows"],
    )
    with open(
        os.path.join(args.evidence_dir, "{}-validation-{}.json".format(prefix, stamp)),
        "w",
        encoding="utf-8",
    ) as handle:
        json.dump(validation, handle, ensure_ascii=False, indent=2)
    print("[repair] summary: {}".format(summary_path))
    print(json.dumps(summary["validation"], ensure_ascii=False))

    if not args.apply:
        print("[repair] dry-run only; project untouched")
        return

    if not args.no_backup:
        free_bytes = shutil.disk_usage(root).free
        if free_bytes < 5 * 1024 * 1024 * 1024:
            raise SystemExit("free space below 5GiB, abort")
        backup_dir = create_backup(root, stamp)
        print("[repair] backup: {}".format(backup_dir))

    changed_shards = [
        shard
        for chapter_id, shard in shards.items()
        if chapter_id in chapter_ids
    ]
    written = 0
    for shard in changed_shards:
        write_json_atomic(shard["path"], shard["envelope"], minified=False)
        written += 1
    write_json_atomic(os.path.join(root, APPEARANCE_REL), index, minified=True)
    for kind, rel in KIND_LIB_REL.items():
        write_json_atomic(os.path.join(root, rel), library_files[kind], minified=False)
    print(
        "[repair] applied: shards={} indexEntries={} libraryNotesChanged={}".format(
            written, len(index), stats["library_notes_changed"]
        )
    )


if __name__ == "__main__":
    main()
