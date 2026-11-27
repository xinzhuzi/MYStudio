"""test_novel_store_align —— novel_store_align.py 自测(Task 1 Step 3;design.md §3.2)。

十种情形(implement.md Task 1 Step 3 规定,全部用 test_novel_text_audit 的同一个夹具构造器):
  1. 干跑退出码 2,夹具内所有文件 sha256 前后不变;
  2. 实写退出码 0,分片 sourceText=正文文件正文,清单四字段=文件头部;分片内容逐字节=App 信封公式;
  3. 多余分片从清单移除、文件入备份目录,备份件哈希=原件;
  4. 备份目录含 manifest.json、plan.json 与每个被改写的分片;
  5. 幂等:再跑 --write 退出码 0 且 pending=0,不新建备份目录;
  6. 写锁 ts 在 60 秒内 → 退出码 4,无任何写入;
  7. --rollback 后清单与分片逐字节回原样,对账工具重新报出原不一致;
  8. 库内修订号>文件修订号且正文不同 → 不改写,needsReview 含该章;
  9. 正文文件带事件段、库内无事件 → 实写后事件三字段取自文件,eventTaskState=success(running 除外);
  10. 登记名带/不带 .json 各能正确读写;分片非 JSON → 退出码 3,无任何写入。

全部在 tempfile 临时目录内进行,不触任何真实项目库。
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import re
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from test_novel_text_audit import (  # 同一个夹具构造器(Task 1 Step 3)
    FIXTURE_EPOCH_MS,
    MOD as AUDIT,
    build_project,
    make_entry,
    mirror_text,
)


def load_module():
    path = Path(__file__).with_name("novel_store_align.py")
    spec = importlib.util.spec_from_file_location("novel_store_align", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载脚本: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MOD = load_module()


# ---------------------------------------------------------------- 夹具


def stale_pair_specs() -> list[dict]:
    """两章夹具:第 1 章一致;第 2 章库旧文(文本/修订号/标题/卷/来源名全部落后于文件头部)。"""
    return [
        {
            "id": "chapter-001",
            "mirror": mirror_text(
                "第1章：一致章",
                "第一章正文。",
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
                        source_text="第一章正文。",
                        volume="第一卷",
                        source_name="1_一致章.md",
                    )
                }
            ],
        },
        {
            "id": "chapter-002",
            "mirror": mirror_text(
                "第2章：新标题",
                "这是修订后的第二章正文。",
                volume="第二卷",
                source_id="chapter-002",
                revision=2,
                source_name="2_新来源.md",
            ),
            "shards": [
                {
                    "entry": make_entry(
                        "chapter-002",
                        index=2,
                        title="第2章：旧标题",
                        source_text="这是 10-13 的旧文,与正文文件不同。",
                        revision=1,
                        volume="第一卷",
                        source_name="2_旧来源.md",
                    )
                }
            ],
        },
    ]


def extra_shard_spec() -> dict:
    """第 2 章的多余分片(剧本稿,登记名排第二个)。"""
    return {
        "name": "chapters/chapter-002/novel-chapters-002-deadbeef",
        "entry": make_entry(
            "chapter-002",
            index=2,
            title="第2章：多余剧本稿",
            source_text="# 道劫 EP02 · 195 秒候审稿",
            volume="第一卷",
            source_name="2_旧来源.md",
        ),
    }


# ---------------------------------------------------------------- 工具函数


def run(argv: list[str]) -> tuple[int, str]:
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = MOD.main(argv)
    return code, buffer.getvalue()


def tree_hashes(root: Path, skip_dirs: tuple[str, ...] = ("backups",)) -> dict[str, str]:
    """root 下全部文件的 sha256(跳过 backups/),用于逐字节前后对比。"""
    out: dict[str, str] = {}
    for base, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        for name in filenames:
            path = Path(base) / name
            out[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def shard_file(store: Path, registered: str) -> Path:
    return store / (registered if registered.endswith(".json") else registered + ".json")


def load_manifest(store: Path) -> dict:
    return json.loads((store / "manifest.json").read_text(encoding="utf-8"))


def read_first_entry(store: Path, registered: str) -> dict:
    data = json.loads(shard_file(store, registered).read_text(encoding="utf-8"))
    return data["state"]["novelChapters"][0]


def backup_dirs(root: Path) -> list[str]:
    base = root / "backups" / "store"
    return sorted(p.name for p in base.iterdir()) if base.is_dir() else []


def chapter_shards(manifest: dict, chapter_id: str) -> list[str]:
    return [s for s in manifest["shards"] if s.startswith(f"chapters/{chapter_id}/novel-chapters-")]


def expected_shard_bytes(original_entry: dict, updates: dict, mirror_mtime_ms: int, version: int = 11) -> str:
    """App 单条目信封公式的独立实现(implement.md Task 1 Step 3 逐字节断言):
    '{\n  "state": {\n    "novelChapters": [\n      ' + 条目两空格缩进 JSON
    (首行前 6 个空格,其余每行再加 6 个空格) + '\n    ]\n  },\n  "version": 11\n}'"""
    expected_entry = dict(original_entry)
    expected_entry.update(updates)
    expected_entry["updatedAt"] = max(FIXTURE_EPOCH_MS, mirror_mtime_ms)
    entry_json = json.dumps(expected_entry, ensure_ascii=False, indent=2)
    return (
        '{\n  "state": {\n    "novelChapters": [\n      '
        + "\n      ".join(entry_json.split("\n"))
        + '\n    ]\n  },\n  "version": '
        + str(version)
        + "\n}"
    )


# ---------------------------------------------------------------- 用例


class NovelStoreAlignTest(unittest.TestCase):
    def test_01_dry_run_exit_2_and_no_file_changes(self):
        """情形 1:干跑退出码 2,夹具内所有文件 sha256 前后不变,不建备份目录。"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            root = tmp_path / "proj"
            report_path = tmp_path / "align-report.json"
            build_project(root, stale_pair_specs(), active_chapter_id="chapter-001")
            before = tree_hashes(root)
            code, out = run(["--project", str(root), "--report", str(report_path)])
            self.assertEqual(code, 2)
            self.assertEqual(tree_hashes(root), before, "干跑不得改任何文件")
            self.assertEqual(backup_dirs(root), [], "干跑不建备份目录")
            self.assertRegex(
                out,
                r"ALIGN mode=dry pending=1 chapters=2 removedShards=0 needsReview=0 exit=2",
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(sorted(report["changedChapters"]), ["chapter-002"])
            self.assertEqual(report["removedShards"], [])
            self.assertEqual(report["needsReview"], {})

    def test_02_write_rewrites_shard_and_index_from_mirror(self):
        """情形 2:实写退出码 0;分片 sourceText=正文文件正文;清单四字段=文件头部;
        分片文件内容逐字节等于 App 单条目信封公式(version 11)。"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            root = tmp_path / "proj"
            specs = stale_pair_specs()
            build_project(root, specs, active_chapter_id="chapter-001")
            code, out = run(["--project", str(root), "--write"])
            self.assertEqual(code, 0)
            self.assertIn("exit=0", out)
            self.assertIn("backupDir=", out)
            store = root / "store" / "studio-workflow"
            manifest = load_manifest(store)
            registered = chapter_shards(manifest, "chapter-002")[0]
            entry = read_first_entry(store, registered)
            self.assertEqual(entry["sourceText"], "这是修订后的第二章正文。")
            index_entry = next(e for e in manifest["chapterIndex"] if e["id"] == "chapter-002")
            self.assertEqual(index_entry["revision"], 2)
            self.assertEqual(index_entry["title"], "第2章：新标题")
            self.assertEqual(index_entry["volume"], "第二卷")
            self.assertEqual(index_entry["sourceName"], "2_新来源.md")
            mirror_mtime_ms = int(os.path.getmtime(root / "novel" / "chapters" / "chapter-002.md") * 1000)
            expected_content = expected_shard_bytes(
                specs[1]["shards"][0]["entry"],
                {
                    "sourceText": "这是修订后的第二章正文。",
                    "title": "第2章：新标题",
                    "volume": "第二卷",
                    "sourceName": "2_新来源.md",
                    "revision": 2,
                },
                mirror_mtime_ms,
            )
            actual = shard_file(store, registered).read_text(encoding="utf-8")
            self.assertEqual(actual, expected_content, "分片文件须逐字节等于 App 单条目信封")

    def test_03_duplicate_shard_removed_to_backup_with_same_hash(self):
        """情形 3:多余分片从清单移除、文件出现在备份目录,备份件哈希=原件。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            specs = stale_pair_specs()
            extra = extra_shard_spec()
            specs[1]["shards"].append(extra)
            build_project(root, specs, active_chapter_id="chapter-001")
            store = root / "store" / "studio-workflow"
            extra_path = shard_file(store, extra["name"])
            extra_hash = hashlib.sha256(extra_path.read_bytes()).hexdigest()
            code, _ = run(["--project", str(root), "--write"])
            self.assertEqual(code, 0)
            manifest = load_manifest(store)
            self.assertEqual(len(chapter_shards(manifest, "chapter-002")), 1, "只保留首个登记分片")
            self.assertFalse(extra_path.exists(), "多余分片文件已移出 store")
            backups = backup_dirs(root)
            self.assertEqual(len(backups), 1)
            backup_copy = root / "backups" / "store" / backups[0] / (
                extra["name"] if extra["name"].endswith(".json") else extra["name"] + ".json"
            )
            self.assertTrue(backup_copy.exists())
            self.assertEqual(
                hashlib.sha256(backup_copy.read_bytes()).hexdigest(), extra_hash, "备份件哈希=原件"
            )
            plan = json.loads(
                (root / "backups" / "store" / backups[0] / "plan.json").read_text(encoding="utf-8")
            )
            self.assertEqual(plan["removedShards"], [{"shard": extra["name"], "sha256": extra_hash}])

    def test_04_backup_dir_contains_manifest_plan_and_changed_shards(self):
        """情形 4:备份目录含 manifest.json、plan.json 与每个被改写的分片。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            build_project(root, stale_pair_specs(), active_chapter_id="chapter-001")
            code, _ = run(["--project", str(root), "--write"])
            self.assertEqual(code, 0)
            backups = backup_dirs(root)
            self.assertEqual(len(backups), 1)
            backup_dir = root / "backups" / "store" / backups[0]
            self.assertTrue((backup_dir / "manifest.json").is_file())
            plan = json.loads((backup_dir / "plan.json").read_text(encoding="utf-8"))
            for key in ("changedChapters", "removedShards", "needsReview"):
                self.assertIn(key, plan)
            store = root / "store" / "studio-workflow"
            for chapter_id, info in plan["changedChapters"].items():
                original = backup_dir / (
                    info["shard"] if info["shard"].endswith(".json") else info["shard"] + ".json"
                )
                self.assertTrue(original.is_file(), f"被改写分片的原件应入备份: {chapter_id}")
                self.assertEqual(
                    hashlib.sha256(original.read_bytes()).hexdigest(), info["beforeSha256"]
                )
                current = shard_file(store, info["shard"])
                self.assertNotEqual(
                    hashlib.sha256(current.read_bytes()).hexdigest(),
                    info["beforeSha256"],
                    "备份存的是改前原件,与现行文件不同",
                )

    def test_05_second_write_idempotent_pending_zero_no_new_backup(self):
        """情形 5:再跑一次 --write 退出码 0 且 pending=0,不新建备份目录。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            build_project(root, stale_pair_specs(), active_chapter_id="chapter-001")
            code, _ = run(["--project", str(root), "--write"])
            self.assertEqual(code, 0)
            first_backups = backup_dirs(root)
            self.assertEqual(len(first_backups), 1)
            code, out = run(["--project", str(root), "--write"])
            self.assertEqual(code, 0)
            self.assertIn("pending=0", out)
            self.assertRegex(
                out, r"ALIGN mode=write pending=0 chapters=2 removedShards=0 needsReview=0 exit=0"
            )
            self.assertEqual(backup_dirs(root), first_backups, "不得新建备份目录")

    def test_06_fresh_write_lock_blocks_with_exit_4_and_no_writes(self):
        """情形 6:写锁文件 ts 在 60 秒内 → 退出码 4,无任何写入。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            build_project(
                root,
                stale_pair_specs(),
                active_chapter_id="chapter-001",
                lock_ts_ms=int(time.time() * 1000),
            )
            before = tree_hashes(root)
            code, _ = run(["--project", str(root), "--write"])
            self.assertEqual(code, 4)
            self.assertEqual(tree_hashes(root), before, "预检不过不得写任何东西")
            self.assertEqual(backup_dirs(root), [])

    def test_07_rollback_restores_original_bytes_and_audit_reports_again(self):
        """情形 7:--rollback 后清单与分片逐字节回原样,对账工具重新报出原来的不一致。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            specs = stale_pair_specs()
            specs[1]["shards"].append(extra_shard_spec())
            build_project(root, specs, active_chapter_id="chapter-001")
            before = tree_hashes(root)
            audit_before = AUDIT.audit(str(root))
            code, out = run(["--project", str(root), "--write"])
            self.assertEqual(code, 0)
            self.assertNotEqual(tree_hashes(root), before, "实写应确实改动了文件")
            match = re.search(r"backupDir=(\S+)", out)
            self.assertIsNotNone(match, "实写汇总行应带 backupDir=")
            code, out = run(["--project", str(root), "--rollback", match.group(1)])
            self.assertEqual(code, 0)
            self.assertIn("exit=0", out)
            self.assertEqual(tree_hashes(root), before, "回滚后逐字节回原样")
            audit_after = AUDIT.audit(str(root))
            self.assertEqual(audit_after["stats"], audit_before["stats"], "对账统计回到修复前")
            self.assertEqual(
                sorted(m["chapterId"] for m in audit_after["mismatches"]),
                sorted(m["chapterId"] for m in audit_before["mismatches"]),
            )
            self.assertEqual(
                sorted((m["chapterId"], m["field"]) for m in audit_after["metadataMismatches"]),
                sorted((m["chapterId"], m["field"]) for m in audit_before["metadataMismatches"]),
            )

    def test_08_newer_store_revision_goes_to_needs_review(self):
        """情形 8:库内修订号>正文文件修订号且正文不同 → 不改写,needsReview 含该章。"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            root = tmp_path / "proj"
            report_path = tmp_path / "align-report.json"
            specs = stale_pair_specs()
            specs[1]["shards"][0]["entry"]["revision"] = 5  # 库内 5 > 文件 2
            build_project(root, specs, active_chapter_id="chapter-001")
            store = root / "store" / "studio-workflow"
            before_hashes = tree_hashes(root)
            code, out = run(["--project", str(root), "--write", "--report", str(report_path)])
            self.assertEqual(code, 0)
            self.assertIn("needsReview=1", out)
            self.assertIn("pending=0", out)
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertIn("chapter-002", report["needsReview"])
            self.assertEqual(report["changedChapters"], {})
            self.assertEqual(tree_hashes(root), before_hashes, "需人工核对章不改写")
            manifest = load_manifest(store)
            entry = read_first_entry(store, chapter_shards(manifest, "chapter-002")[0])
            index_entry = next(e for e in manifest["chapterIndex"] if e["id"] == "chapter-002")
            self.assertEqual(entry["sourceText"], "这是 10-13 的旧文,与正文文件不同。")
            self.assertEqual(entry["revision"], 5)
            self.assertEqual(index_entry["revision"], 5)

    def test_09_events_backfilled_from_mirror_with_task_state_rules(self):
        """情形 9:文件带事件段、库内无事件 → 实写后三字段取自文件,eventTaskState=success;
        原值 running 的章不覆盖任务状态。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            summary = "郁澄心买下病猫,以身试险种替死蛊"
            state_text = "涉及角色：郁澄心、晏燎\n情绪：悬疑+恐怖"
            raw_output = "|第2章 暮色灵猫结替身|郁澄心、晏燎|"
            specs = [
                stale_pair_specs()[0],  # 第 1 章保持一致
                {
                    "id": "chapter-002",
                    "mirror": mirror_text(
                        "第2章：带事件",
                        "第二章正文。",
                        volume="第一卷",
                        source_id="chapter-002",
                        revision=1,
                        source_name="2_带事件.md",
                        events={
                            "eventSummary": summary,
                            "eventState": state_text,
                            "eventRawOutput": raw_output,
                        },
                    ),
                    "shards": [
                        {
                            "entry": make_entry(
                                "chapter-002",
                                index=2,
                                title="第2章：带事件",
                                source_text="第二章正文。",
                                volume="第一卷",
                                source_name="2_带事件.md",
                            )
                        }
                    ],
                },
                {
                    "id": "chapter-003",
                    "mirror": mirror_text(
                        "第3章：运行中",
                        "第三章正文。",
                        volume="第一卷",
                        source_id="chapter-003",
                        revision=1,
                        source_name="3_运行中.md",
                        events={"eventSummary": "第三章摘要", "eventState": "涉及角色：乙"},
                    ),
                    "shards": [
                        {
                            "entry": make_entry(
                                "chapter-003",
                                index=3,
                                title="第3章：运行中",
                                source_text="第三章正文。",
                                volume="第一卷",
                                source_name="3_运行中.md",
                                eventTaskState="running",
                            )
                        }
                    ],
                },
            ]
            build_project(root, specs, active_chapter_id="chapter-001")
            code, _ = run(["--project", str(root), "--write"])
            self.assertEqual(code, 0)
            store = root / "store" / "studio-workflow"
            manifest = load_manifest(store)
            entry2 = read_first_entry(store, chapter_shards(manifest, "chapter-002")[0])
            self.assertEqual(entry2["eventSummary"], summary)
            self.assertEqual(entry2["eventState"], state_text)
            self.assertEqual(entry2["eventRawOutput"], raw_output)
            self.assertEqual(entry2["eventTaskState"], "success")
            index2 = next(e for e in manifest["chapterIndex"] if e["id"] == "chapter-002")
            self.assertEqual(index2["eventSummary"], summary)
            self.assertEqual(index2["eventState"], state_text)
            self.assertEqual(index2["eventRawOutput"], raw_output)
            self.assertEqual(index2["eventTaskState"], "success", "索引条目同样回填事件字段")
            entry3 = read_first_entry(store, chapter_shards(manifest, "chapter-003")[0])
            self.assertEqual(entry3["eventTaskState"], "running", "原值 running 不覆盖")

    def test_10_name_styles_and_unparsable_shard(self):
        """情形 10:登记名带 .json(Win 写法)与不带(Mac 写法)各能正确读写;
        分片内容为非 JSON → 退出码 3,无任何写入。"""
        # (a) Win 写法:登记名带 .json
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            specs = stale_pair_specs()
            specs[1]["shards"][0]["name"] = "chapters/chapter-002/novel-chapters-001-ab12cd34.json"
            build_project(root, specs, active_chapter_id="chapter-001")
            code, _ = run(["--project", str(root), "--write"])
            self.assertEqual(code, 0)
            store = root / "store" / "studio-workflow"
            manifest = load_manifest(store)
            registered = chapter_shards(manifest, "chapter-002")[0]
            self.assertTrue(registered.endswith(".json"))
            entry = read_first_entry(store, registered)
            self.assertEqual(entry["sourceText"], "这是修订后的第二章正文。")
            mirror_mtime_ms = int(os.path.getmtime(root / "novel" / "chapters" / "chapter-002.md") * 1000)
            expected = expected_shard_bytes(
                specs[1]["shards"][0]["entry"],
                {
                    "sourceText": "这是修订后的第二章正文。",
                    "title": "第2章：新标题",
                    "volume": "第二卷",
                    "sourceName": "2_新来源.md",
                    "revision": 2,
                },
                mirror_mtime_ms,
            )
            self.assertEqual(shard_file(store, registered).read_text(encoding="utf-8"), expected)
        # (b) Mac 写法:登记名不带 .json,盘上文件带 .json
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            build_project(root, stale_pair_specs(), active_chapter_id="chapter-001")
            code, _ = run(["--project", str(root), "--write"])
            self.assertEqual(code, 0)
            store = root / "store" / "studio-workflow"
            registered = chapter_shards(load_manifest(store), "chapter-002")[0]
            self.assertFalse(registered.endswith(".json"))
            self.assertTrue(shard_file(store, registered).is_file())
            self.assertEqual(
                read_first_entry(store, registered)["sourceText"], "这是修订后的第二章正文。"
            )
        # (c) 非 JSON 分片 → 退出码 3,无任何写入
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "proj"
            specs = stale_pair_specs()
            specs[1]["shards"][0]["raw"] = b"not-json{{"
            build_project(root, specs, active_chapter_id="chapter-001")
            before = tree_hashes(root)
            code, _ = run(["--project", str(root), "--write"])
            self.assertEqual(code, 3)
            self.assertEqual(tree_hashes(root), before, "解析异常须在写前中止,无任何写入")
            self.assertEqual(backup_dirs(root), [])


if __name__ == "__main__":
    unittest.main()
