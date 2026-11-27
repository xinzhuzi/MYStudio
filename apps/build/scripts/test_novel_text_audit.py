"""test_novel_text_audit —— novel_text_audit.py 自测(Task 1 Step 1;design.md §3.1)。

5 章小夹具(implement.md Task 1 Step 1 规定):
  第 1 章 一致;第 2 章 库旧文;第 3 章 索引修订号落后;
  第 4 章 清单登记了两个正文分片;第 5 章 正文文件带事件段而库内无事件。
断言:退出码 2;stats 的「不一致」为 1;metadataMismatches 含第 3 章 revision;
  chaptersWithDuplicateNovelShards 为 {"chapter-004": 1};--json 文件可被 json.load。

本文件的夹具构造器(build_project / mirror_text / make_entry / shard_file_content)
同时被 test_novel_store_align.py import 复用(Task 1 Step 3「用同一个夹具构造器」)。
全部在 tempfile 临时目录内进行,不触任何真实项目库。
"""
from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path


def load_module():
    path = Path(__file__).with_name("novel_text_audit.py")
    spec = importlib.util.spec_from_file_location("novel_text_audit", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载脚本: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MOD = load_module()

# ==========================================================================
# 共用夹具构造器(Task 1 两份单测同一构造器;与 App 的分片信封格式逐字节对称,
# apps/frontend/lib/storage/studio-workflow-shards.ts:197-206,468-478)
# ==========================================================================

DEFAULT_VERSION = 11
SHARD_LAYOUT = "studio-workflow-shards-v1"
FIXTURE_EPOCH_MS = 1_760_000_000_000  # 固定的 updatedAt/importedAt,与 mtime 无关


def shard_file_content(entry: dict, version: int = DEFAULT_VERSION) -> str:
    """单条目 novel-chapters 分片文件内容,与 App 写出逐字节一致:
    '{\n  "state": {\n    "novelChapters": [\n      ' + 条目两空格缩进 JSON
    (首行前 6 个空格,其余每行再加 6 个空格) + '\n    ]\n  },\n  "version": N\n}'
    结尾无换行;非 ASCII 原样。"""
    entry_json = json.dumps(entry, ensure_ascii=False, indent=2)
    indented = "\n      ".join(entry_json.split("\n"))
    return (
        '{\n  "state": {\n    "novelChapters": [\n      '
        + indented
        + '\n    ]\n  },\n  "version": '
        + str(version)
        + "\n}"
    )


def mirror_text(
    title: str,
    body: str,
    *,
    volume: str | None = None,
    source_id: str | None = None,
    revision: int | None = None,
    source_name: str | None = None,
    events: dict | None = None,
) -> str:
    """正文文件全文(与 buildNovelChapterMirror 的 layout 对称:novel.ts:74-101)。"""
    lines = ["# " + title, ""]
    if volume is not None:
        lines.append("> 卷：" + volume)
    if source_id is not None:
        lines.append("> 源ID：" + source_id)
    if revision is not None:
        lines.append("> 修订：" + str(revision))
    if source_name is not None:
        lines.append("> 来源：" + source_name)
    lines += ["", body]
    if events:
        event_lines = ["", "## 事件分析", ""]
        if events.get("eventSummary"):
            event_lines.append("摘要：" + events["eventSummary"])
        if events.get("eventState"):
            event_lines.append("状态：\n" + events["eventState"])
        if events.get("eventRawOutput"):
            event_lines.append("原始输出：" + events["eventRawOutput"])
        lines += event_lines
    return "\n".join(lines)


def make_entry(
    chapter_id: str,
    *,
    index: int,
    title: str,
    source_text: str,
    revision: int = 1,
    volume: str = "第一卷",
    source_name: str | None = None,
    updated_at: int = FIXTURE_EPOCH_MS,
    **extra,
) -> dict:
    """库内章节条目(NovelChapter 形状的夹具子集)。"""
    entry = {
        "id": chapter_id,
        "sourceId": chapter_id,
        "revision": revision,
        "index": index,
        "volume": volume,
        "title": title,
        "sourceText": source_text,
        "importedAt": FIXTURE_EPOCH_MS,
        "updatedAt": updated_at,
    }
    if source_name is not None:
        entry["sourceName"] = source_name
    entry.update(extra)
    return entry


def build_project(
    root: Path,
    chapters: list[dict],
    *,
    version: int = DEFAULT_VERSION,
    active_chapter_id: str | None = None,
    lock_ts_ms: int | None = None,
) -> dict:
    """在临时目录搭一个最小项目库:
    novel/chapters/<章>.md + store/studio-workflow/{manifest.json, chapters/<章>/novel-chapters-*.json}。
    每章 spec:{"id", "mirror"(全文), "index"(可选覆盖,缺省=首个分片条目去 sourceText),
               "shards": [{"entry", "name"(可选,缺省 Mac 风格不带 .json), "raw"(可选,非 JSON 内容)}]}。
    返回 {"root", "store", "manifest", "shard_paths"}。"""
    root = Path(root)
    (root / "novel" / "chapters").mkdir(parents=True, exist_ok=True)
    store = root / "store" / "studio-workflow"
    store.mkdir(parents=True, exist_ok=True)
    registered: list[str] = []
    chapter_index: list[dict] = []
    shard_paths: dict[str, list[str]] = {}
    for spec in chapters:
        chapter_id = spec["id"]
        (root / "novel" / "chapters" / f"{chapter_id}.md").write_text(
            spec["mirror"], encoding="utf-8"
        )
        first_entry = spec["shards"][0]["entry"]
        shard_paths[chapter_id] = []
        for position, shard_spec in enumerate(spec["shards"], start=1):
            name = shard_spec.get("name") or (
                f"chapters/{chapter_id}/novel-chapters-{position:03d}-ab12cd34"
            )
            file_name = name if name.endswith(".json") else name + ".json"
            path = store / file_name
            path.parent.mkdir(parents=True, exist_ok=True)
            if shard_spec.get("raw") is not None:
                path.write_bytes(shard_spec["raw"])
            else:
                path.write_text(
                    shard_file_content(shard_spec["entry"], version), encoding="utf-8"
                )
            registered.append(name)
            shard_paths[chapter_id].append(str(path))
        index_entry = spec.get("index")
        if index_entry is None:
            index_entry = {k: v for k, v in first_entry.items() if k != "sourceText"}
        chapter_index.append(index_entry)
    manifest = {
        "layout": SHARD_LAYOUT,
        "version": version,
        "shards": registered,
        "chapterIndex": chapter_index,
    }
    if active_chapter_id is not None:
        manifest["activeChapterId"] = active_chapter_id
    (store / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if lock_ts_ms is not None:
        (root / "store" / ".storage-write-lock.json").write_text(
            json.dumps({"id": "test-lock", "ts": lock_ts_ms}), encoding="utf-8"
        )
    return {"root": root, "store": store, "manifest": store / "manifest.json", "shard_paths": shard_paths}


# ==========================================================================
# 用例
# ==========================================================================


def five_chapter_specs() -> list[dict]:
    """implement.md Task 1 Step 1 的 5 章夹具。"""
    return [
        {  # 第 1 章:文本与索引元数据全部一致
            "id": "chapter-001",
            "mirror": mirror_text(
                "第1章：一致章",
                "这是第一章的正文。",
                volume="第一卷",
                source_id="chapter-001",
                revision=1,
                source_name="1_一致章.md",
            ),
            "shards": [
                {
                    "entry": make_entry(
                        "chapter-001",
                        index=1,
                        title="第1章：一致章",
                        source_text="这是第一章的正文。",
                        volume="第一卷",
                        source_name="1_一致章.md",
                    )
                }
            ],
        },
        {  # 第 2 章:库旧文(文本不一致;索引元数据与文件头部一致)
            "id": "chapter-002",
            "mirror": mirror_text(
                "第2章：暮色灵猫结替身",
                "新正文：郁澄心买下病猫。",
                volume="第一卷",
                source_id="chapter-002",
                revision=1,
                source_name="2_暮色灵猫结替身.md",
            ),
            "shards": [
                {
                    "entry": make_entry(
                        "chapter-002",
                        index=2,
                        title="第2章：暮色灵猫结替身",
                        source_text="旧正文：候审稿 EP02 · 195 秒。",
                        volume="第一卷",
                        source_name="2_暮色灵猫结替身.md",
                    )
                }
            ],
        },
        {  # 第 3 章:文本一致,索引修订号落后(1 < 文件头部 2)
            "id": "chapter-003",
            "mirror": mirror_text(
                "第3章：修订落后",
                "第三章正文。",
                volume="第一卷",
                source_id="chapter-003",
                revision=2,
                source_name="3_修订落后.md",
            ),
            "shards": [
                {
                    "entry": make_entry(
                        "chapter-003",
                        index=3,
                        title="第3章：修订落后",
                        source_text="第三章正文。",
                        revision=1,
                        volume="第一卷",
                        source_name="3_修订落后.md",
                    )
                }
            ],
        },
        {  # 第 4 章:清单登记了两个正文分片(首个生效,其余为多余)
            "id": "chapter-004",
            "mirror": mirror_text(
                "第4章：多分片",
                "第四章正文。",
                volume="第一卷",
                source_id="chapter-004",
                revision=1,
                source_name="4_多分片.md",
            ),
            "shards": [
                {
                    "entry": make_entry(
                        "chapter-004",
                        index=4,
                        title="第4章：多分片",
                        source_text="第四章正文。",
                        volume="第一卷",
                        source_name="4_多分片.md",
                    )
                },
                {
                    "name": "chapters/chapter-004/novel-chapters-002-deadbeef",
                    "entry": make_entry(
                        "chapter-004",
                        index=4,
                        title="第4章：多分片(多余剧本稿)",
                        source_text="# 道劫 EP04 · 200 秒候审稿",
                        volume="第一卷",
                        source_name="4_多分片.md",
                    ),
                },
            ],
        },
        {  # 第 5 章:正文文件带事件段而库内无事件(文本一致,不算「不一致」)
            "id": "chapter-005",
            "mirror": mirror_text(
                "第5章：事件缺口",
                "第五章正文。",
                volume="第一卷",
                source_id="chapter-005",
                revision=1,
                source_name="5_事件缺口.md",
                events={
                    "eventSummary": "第五章摘要",
                    "eventState": "涉及角色：甲\n情绪：悬疑",
                    "eventRawOutput": "|第5章 第五章摘要|甲|",
                },
            ),
            "shards": [
                {
                    "entry": make_entry(
                        "chapter-005",
                        index=5,
                        title="第5章：事件缺口",
                        source_text="第五章正文。",
                        volume="第一卷",
                        source_name="5_事件缺口.md",
                    )
                }
            ],
        },
    ]


class NovelTextAuditTest(unittest.TestCase):
    def test_five_chapter_fixture_exit_2_with_expected_reconciliation(self):
        """主用例:退出码 2;不一致=1;metadataMismatches 含 ch3 revision;重复分片=ch4×1。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            json_path = Path(tmp) / "audit-out.json"
            build_project(root, five_chapter_specs(), active_chapter_id="chapter-001")
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                code = MOD.main(["--project", str(root), "--json", str(json_path)])
            self.assertEqual(code, 2, "存在不一致应退出 2")
            out = buffer.getvalue()
            self.assertIn("对账结果:", out)
            self.assertIn("不一致分类:", out)
            data = json.loads(json_path.read_text(encoding="utf-8"))  # --json 可被 json.load
            self.assertEqual(data["stats"].get("不一致"), 1, "只有第 2 章文本不一致")
            self.assertEqual(
                data["chaptersWithDuplicateNovelShards"], {"chapter-004": 1}
            )
            rev = [
                m
                for m in data["metadataMismatches"]
                if m["chapterId"] == "chapter-003" and m["field"] == "revision"
            ]
            self.assertTrue(rev, "metadataMismatches 应含第 3 章 revision")
            self.assertEqual(rev[0]["indexValue"], 1)
            self.assertEqual(rev[0]["mirrorValue"], 2)
            self.assertEqual(
                [m["chapterId"] for m in data["mismatches"]],
                ["chapter-002"],
                "文本不一致只有第 2 章",
            )

    def test_fully_consistent_project_exit_0(self):
        """全一致(文本+元数据)→ 退出码 0。"""
        specs = [
            {
                "id": f"chapter-{n:03d}",
                "mirror": mirror_text(
                    f"第{n}章：全同{n}",
                    f"第{n}章正文。",
                    volume="第一卷",
                    source_id=f"chapter-{n:03d}",
                    revision=1,
                    source_name=f"{n}_全同.md",
                ),
                "shards": [
                    {
                        "entry": make_entry(
                            f"chapter-{n:03d}",
                            index=n,
                            title=f"第{n}章：全同{n}",
                            source_text=f"第{n}章正文。",
                            volume="第一卷",
                            source_name=f"{n}_全同.md",
                        )
                    }
                ],
            }
            for n in (1, 2, 3)
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            build_project(root, specs, active_chapter_id="chapter-001")
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                code = MOD.main(["--project", str(root)])
            self.assertEqual(code, 0, "全一致应退出 0")


if __name__ == "__main__":
    unittest.main()
