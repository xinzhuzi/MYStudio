#!/usr/bin/env python3
"""章节镜像 → 分片库直导:把 novel/chapters/*.md 的章节写进 studio-workflow 分片库
(manifest.chapterIndex 轻索引 + chapters/<id>/novel-chapters-* 全文分片),
使 App 重启后章节列表/选章拿全文走正规水合路径(窗口化 v1:内存只挂轻索引+活动章)。

⚠ 必须在 App 完全关闭时执行——运行中的周期性自愈保存会覆盖外部 manifest 改动。
格式真源:storage-project-sharded.ts(水合:chapterIndex→轻条目+活动章物化)
        studio-workflow-shards.ts(窗口化写/归档章分片名抄录)
        章记录信封模板:chapters/chapter-001/novel-chapters-001-d81c44a6.json

用法:
  python3 manying_novel_store_import.py            # 干跑
  python3 manying_novel_store_import.py --write    # 实写(manifest 先备份到 backups/store/)
"""
import hashlib
import json
import os
import re
import sys
import time

MA = "/Users/zhengbingjin/Project/IP/MA"
MIRRORS = os.path.join(MA, "novel/chapters")
STORE = os.path.join(MA, "store/studio-workflow")
MANIFEST = os.path.join(STORE, "manifest.json")
BACKUP_DIR = os.path.join(MA, "backups/store")


def parse_mirror(path: str):
    text = open(path, encoding="utf-8").read()
    # 行锚定 meta 组:>[^\n]*\n 逐行匹配——旧写法 >.*\n 在 re.S 下 . 吞换行,meta 组会吞掉正文只剩尾部(livefire9 旁获实锤:ch002 sourceText 仅 98 字)
    m = re.match(r"^#\s+(第[^\n]+)\n\n((?:>[^\n]*\n)+)\n(.*)$", text, re.S)
    if not m:
        return None
    title, meta_raw, body = m.group(1).strip(), m.group(2), m.group(3).strip()
    vol = re.search(r"^>\s*卷：(.+)$", meta_raw, re.M)
    sid = re.search(r"^>\s*源ID：(.+)$", meta_raw, re.M)
    rev = re.search(r"^>\s*修订：(\d+)$", meta_raw, re.M)
    src = re.search(r"^>\s*来源：(.+)$", meta_raw, re.M)
    return {
        "title": title,
        "volume": vol.group(1).strip() if vol else "正文卷",
        "sourceId": sid.group(1).strip() if sid else None,
        "revision": int(rev.group(1)) if rev else 1,
        "sourceName": src.group(1).strip() if src else os.path.basename(path),
        "sourceText": body,
    }


def main() -> None:
    write = "--write" in sys.argv
    refix = "--refix" in sys.argv
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    existing = {e["id"] for e in manifest.get("chapterIndex", [])}
    listed = set(manifest.get("shards", []))

    now = int(time.time() * 1000)
    todo, anomalies = [], []
    for name in sorted(os.listdir(MIRRORS)):
        m = re.match(r"^chapter-(\d+)\.md$", name)
        if not m:
            continue
        cid = f"chapter-{int(m.group(1)):03d}"
        if cid in existing:
            continue
        parsed = parse_mirror(os.path.join(MIRRORS, name))
        if not parsed:
            anomalies.append(f"{cid}: 镜像格式解析失败")
            continue
        todo.append((cid, int(m.group(1)), parsed))

    todo.sort(key=lambda t: t[1])
    print(f"[{'实写' if write else '干跑'}] 待入索引 {len(todo)} 章 | 已在索引 {len(existing)} | 异常 {len(anomalies)}")
    for a in anomalies:
        print("  ⚠", a)

    # --refix:修正既有分片的截断 sourceText(保留 App 写入的事件分析等字段,只换文本字段)
    if refix:
        fixed, skipped = 0, 0
        for entry in manifest["chapterIndex"]:
            cid = entry["id"]
            if cid == "chapter-001":
                continue  # 人工导入的原生章,勿动
            mirror_path = os.path.join(MIRRORS, f"{cid}.md")
            if not os.path.exists(mirror_path):
                continue
            parsed = parse_mirror(mirror_path)
            if not parsed:
                anomalies.append(f"{cid}: refix 镜像解析失败")
                continue
            old_names = [s for s in manifest["shards"] if re.match(rf"^chapters/{cid}/novel-chapters-", s)]
            old_path = os.path.join(STORE, old_names[0]) if old_names else None
            old_record = None
            if old_path and os.path.exists(old_path):
                try:
                    old_record = json.load(open(old_path, encoding="utf-8"))["state"]["novelChapters"][0]
                except Exception as e:
                    anomalies.append(f"{cid}: 旧分片读取失败 {e}")
            record = {
                "id": cid,
                "index": entry["index"],
                "volume": parsed["volume"],
                "title": parsed["title"],
                "sourceText": parsed["sourceText"],
                "sourceName": parsed["sourceName"],
                "importedAt": entry.get("importedAt", now),
                "updatedAt": now,
            }
            if parsed["sourceId"]:
                record["sourceId"] = parsed["sourceId"]
            if parsed["revision"]:
                record["revision"] = parsed["revision"]
            # 保留 App 后写入的事件分析等非文本字段(ch002 已有事件分析,不能丢)
            if old_record:
                for k, v in old_record.items():
                    if k.startswith("event") and v:
                        record[k] = v
            if old_record and old_record.get("sourceText") == record["sourceText"]:
                skipped += 1
                continue
            payload = json.dumps({"state": {"novelChapters": [record]}, "version": "11"}, ensure_ascii=False)
            digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:8]
            shard_name = f"chapters/{cid}/novel-chapters-{entry['index']:03d}-{digest}.json"
            shard_path = os.path.join(STORE, shard_name)
            if write:
                os.makedirs(os.path.dirname(shard_path), exist_ok=True)
                with open(shard_path, "w", encoding="utf-8") as fh:
                    fh.write(payload)
                for old in old_names:
                    if old != shard_name and old in manifest["shards"]:
                        manifest["shards"].remove(old)
                    old_f = os.path.join(STORE, old)
                    if old != shard_name and os.path.exists(old_f):
                        os.remove(old_f)
                if shard_name not in manifest["shards"]:
                    manifest["shards"].append(shard_name)
                entry["title"] = record["title"]
                entry["volume"] = record["volume"]
                entry["sourceName"] = record["sourceName"]
                entry["updatedAt"] = now
            fixed += 1
        print(f"[refix{'实写' if write else '干跑'}] 需修正 {fixed} 章 | 已正确跳过 {skipped}")
        if write and fixed:
            with open(MANIFEST, "w", encoding="utf-8") as fh:
                json.dump(manifest, fh, ensure_ascii=False, indent=1)
            print(f"manifest 已更新;shards 现共 {len(manifest['shards'])}")
        return

    if not todo or not write:
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    bak = os.path.join(BACKUP_DIR, f"manifest-pre-bulk-import-{time.strftime('%Y%m%d-%H%M%S')}.json")
    with open(bak, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f"manifest 备份 → {bak}")

    for cid, idx, p in todo:
        record = {
            "id": cid,
            "index": idx,
            "volume": p["volume"],
            "title": p["title"],
            "sourceText": p["sourceText"],
            "sourceName": p["sourceName"],
            "importedAt": now,
            "updatedAt": now,
        }
        if p["sourceId"]:
            record["sourceId"] = p["sourceId"]
        if p["revision"]:
            record["revision"] = p["revision"]
        payload = json.dumps({"state": {"novelChapters": [record]}, "version": "11"}, ensure_ascii=False)
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:8]
        shard_name = f"chapters/{cid}/novel-chapters-{idx:03d}-{digest}.json"
        shard_path = os.path.join(STORE, shard_name)
        os.makedirs(os.path.dirname(shard_path), exist_ok=True)
        with open(shard_path, "w", encoding="utf-8") as fh:
            fh.write(payload)
        if shard_name not in listed:
            manifest["shards"].append(shard_name)
            listed.add(shard_name)
        manifest["chapterIndex"].append({
            "id": cid,
            "index": idx,
            "volume": p["volume"],
            "title": p["title"],
            "sourceName": p["sourceName"],
            "importedAt": now,
            "updatedAt": now,
        })

    manifest["chapterIndex"].sort(key=lambda e: e["index"])
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f"写入 {len(todo)} 章分片+索引;chapterIndex 现共 {len(manifest['chapterIndex'])};shards 现共 {len(manifest['shards'])}")


if __name__ == "__main__":
    main()
