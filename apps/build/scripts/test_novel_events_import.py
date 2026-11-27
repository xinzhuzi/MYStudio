"""test_novel_events_import —— novel_events_import.py 自测(Task 14 Step 1;design.md §4.2)。

六条用例(implement.md Task 14 Step 1 规定):
  1. build 解析十份表出 4122 条载荷(第 1–3 章不在内);
  2. 缺章/重章即中止;
  3. `**` 去除且其余字符不动;
  4. 摘要为空/含换行/撞段标记即中止;
  5. apply 干跑只报数不写;
  6. apply 实写后「分片条目/索引条目/正文文件末尾」三处都有事件段、正文与头部逐字节不变、
     第 1–3 章哈希不变、重复导入记 skipped、校验不过自动回滚。

夹具:卷表文件按真表格式生成(`| <ID> |` 开头、恰 9 格);
项目库用 test_novel_text_audit.build_project(Task 1 同一夹具构造器)。
全部在 tempfile 临时目录内进行,不触真实事件轴与真实项目库。
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import re
import tarfile
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from test_novel_text_audit import (  # Task 1 的同一夹具构造器
    FIXTURE_EPOCH_MS,
    build_project,
    make_entry,
    mirror_text,
)

import novel_text_audit as AUDIT


def load_module():
    path = Path(__file__).with_name("novel_events_import.py")
    spec = importlib.util.spec_from_file_location("novel_events_import", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载脚本: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MOD = load_module()


# ---------------------------------------------------------------- 夹具


def axis_row(index, *, year=None, realm=None, rtype=None, title=None, chars=None,
             summary=None, expansion=None, geo=None):
    """一行 9 格卷表(ID, 年份, 境界, 类型, 标题, 涉及角色, 剧情概要, 扩展方向, 地理)。"""
    return [
        str(index),
        year or f"第{index}年·冬",
        realm or "凡人",
        rtype or f"类型{index}",
        title or f"**第{index}章标题**",
        chars or f"角色甲、角色乙{index}",
        summary or f"第{index}章概要：情节推进{index}，落点收束。",
        expansion or f"0.8万字｜重点{index}｜[情绪:情绪{index}] [美学:美学{index}]",
        geo or f"地点{index}",
    ]


def volume_md(rows):
    """一份卷表文件全文(与真表格式对称:标题 + 表头 + 分隔行 + 数据行)。"""
    lines = ["# 卷表（测试夹具）", "", "**事件总数**：占位", ""]
    lines.append("| " + " | ".join(("ID", "年份", "境界", "类型", "标题", "涉及角色", "剧情概要", "扩展方向", "地理")) + " |")
    lines.append("| " + " | ".join([":---"] * 9) + " |")
    for cells in rows:
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def write_axis(axis: Path, volumes: dict[int, list]) -> None:
    """按卷号写 `<N>.测试卷<N>.md`。"""
    axis.mkdir(parents=True, exist_ok=True)
    for num, rows in volumes.items():
        (axis / f"{num}.测试卷{num}.md").write_text(volume_md(rows), encoding="utf-8")


def build_payload(axis: Path, out: Path) -> tuple[int, str, str]:
    return run(["build", "--event-axis", str(axis), "--out", str(out)])


def expected_state(entry: dict) -> str:
    return entry["eventState"]


def event_block(entry: dict) -> bytes:
    """追加到正文文件末尾的事件段(与 design.md §4.2 模板逐字对称)。"""
    text = (
        "\n\n## 事件分析\n\n摘要："
        + entry["eventSummary"]
        + "\n状态：\n"
        + entry["eventState"]
    )
    return text.encode("utf-8")


def six_chapter_specs() -> list[dict]:
    """6 章项目夹具:第 1–3 章带既有模型事件(保护对象);第 4–6 章无事件(待导入)。"""
    specs = []
    for n in range(1, 7):
        cid = f"chapter-{n:03d}"
        if n <= 3:
            events = {
                "eventSummary": f"第{n}章模型摘要",
                "eventState": "涉及角色：甲\n主线关系：乙\n情绪强度：中",
                "eventRawOutput": f"|第{n}章 模型|甲|",
            }
            entry = make_entry(
                cid, index=n, title=f"第{n}章：模型分析章", source_text=f"第{n}章正文。",
                volume="第一卷", source_name=f"{n}_模型分析.md",
                eventSummary=events["eventSummary"], eventState=events["eventState"],
                eventRawOutput=events["eventRawOutput"], eventTaskState="ready",
            )
            mirror = mirror_text(
                f"第{n}章：模型分析章", f"第{n}章正文。",
                volume="第一卷", source_id=cid, revision=1, source_name=f"{n}_模型分析.md",
                events=events,
            )
        else:
            entry = make_entry(
                cid, index=n, title=f"第{n}章：待导入", source_text=f"第{n}章正文。",
                volume="第一卷", source_name=f"{n}_待导入.md",
            )
            mirror = mirror_text(
                f"第{n}章：待导入", f"第{n}章正文。",
                volume="第一卷", source_id=cid, revision=1, source_name=f"{n}_待导入.md",
            )
        specs.append({"id": cid, "mirror": mirror, "shards": [{"entry": entry}]})
    return specs


# ---------------------------------------------------------------- 工具函数


def run(argv: list[str]) -> tuple[int, str, str]:
    out_buf, err_buf = io.StringIO(), io.StringIO()
    with redirect_stdout(out_buf), redirect_stderr(err_buf):
        code = MOD.main(argv)
    return code, out_buf.getvalue(), err_buf.getvalue()


def tree_hashes(root: Path, skip_dirs: tuple[str, ...] = ("backups",)) -> dict[str, str]:
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
    return json.loads(shard_file(store, registered).read_text(encoding="utf-8"))["state"]["novelChapters"][0]


def chapter_shards(manifest: dict, chapter_id: str) -> list[str]:
    return [s for s in manifest["shards"] if s.startswith(f"chapters/{chapter_id}/novel-chapters-")]


def backup_dirs(root: Path) -> list[str]:
    base = root / "backups" / "store"
    return sorted(p.name for p in base.iterdir()) if base.is_dir() else []


def index_canon_sha(entry: dict) -> str:
    return hashlib.sha256(
        json.dumps(entry, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def first_three_hashes(root: Path, store: Path) -> dict[str, tuple[str, str, str]]:
    """第 1–3 章的 (分片文件 sha256, 正文文件 sha256, 索引条目规范 JSON sha256)。"""
    manifest = load_manifest(store)
    out = {}
    for n in (1, 2, 3):
        cid = f"chapter-{n:03d}"
        registered = chapter_shards(manifest, cid)[0]
        shard_sha = hashlib.sha256(shard_file(store, registered).read_bytes()).hexdigest()
        mirror_path = root / "novel" / "chapters" / f"{cid}.md"
        mirror_sha = hashlib.sha256(mirror_path.read_bytes()).hexdigest()
        index_entry = next(e for e in manifest["chapterIndex"] if e["id"] == cid)
        out[cid] = (shard_sha, mirror_sha, index_canon_sha(index_entry))
    return out


# ---------------------------------------------------------------- 用例


class NovelEventsImportBuildTest(unittest.TestCase):
    def test_01_build_ten_volumes_4122_entries_excluding_first_three(self):
        """用例 1:十份卷表 4125 行 → 载荷 4122 条;第 1–3 章不在内;source 记录十份文件哈希。"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            axis = tmp_path / "axis"
            out = tmp_path / "payload.json"
            sizes = [413] * 5 + [412] * 5  # 共 4125 行,分十份卷
            volumes = {}
            start = 1
            for num, size in enumerate(sizes, start=1):
                volumes[num] = [axis_row(i) for i in range(start, start + size)]
                start += size
            write_axis(axis, volumes)
            code, out_text, _ = build_payload(axis, out)
            self.assertEqual(code, 0)
            self.assertIn("entries=4122", out_text)
            self.assertIn("rows=4125", out_text)
            self.assertIn("files=10", out_text)
            payload = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(payload["rule"], "v1")
            entries = payload["entries"]
            self.assertEqual(len(entries), 4122)
            self.assertEqual(
                [e["id"] for e in entries],
                [f"chapter-{i:03d}" for i in range(4, 4126)],
                "载荷条目应恰为第 4–4125 章且升序(章 ID=chapter- 三位补零)",
            )
            self.assertFalse(any(e["index"] <= 3 for e in entries))
            self.assertEqual(entries[0], {
                "id": "chapter-004",
                "index": 4,
                "eventSummary": "第4章概要：情节推进4，落点收束。",
                "eventState": (
                    "涉及角色：角色甲、角色乙4\n事件类型：类型4\n时间：第4年·冬\n"
                    "境界：凡人\n地点：地点4\n情绪：情绪4"
                ),
                "eventTaskState": "success",
            })
            self.assertEqual(entries[-1]["id"], "chapter-4125")
            self.assertEqual(entries[-1]["index"], 4125)
            self.assertEqual(payload["source"]["dir"], os.path.abspath(str(axis)))
            files = payload["source"]["files"]
            self.assertEqual([f["name"] for f in files], [f"{n}.测试卷{n}.md" for n in range(1, 11)])
            for meta in files:
                digest = hashlib.sha256((axis / meta["name"]).read_bytes()).hexdigest()
                self.assertEqual(meta["sha256"], digest)

    def test_02_build_aborts_on_missing_or_duplicate_chapter(self):
        """用例 2:缺章(1..6 缺 5)/重章(第 5 章两行) → 中止退出 3,不写载荷。"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            # (a) 缺章
            axis = tmp_path / "axis-gap"
            out = tmp_path / "payload-gap.json"
            write_axis(axis, {1: [axis_row(i) for i in (1, 2, 3, 4, 6)]})
            code, _, err = build_payload(axis, out)
            self.assertEqual(code, 3)
            self.assertIn("EVENTS_ERROR", err)
            self.assertFalse(out.exists(), "中止时不得写出载荷")
            # (b) 重章
            axis2 = tmp_path / "axis-dup"
            out2 = tmp_path / "payload-dup.json"
            rows = [axis_row(i) for i in (1, 2, 3, 4, 5)]
            rows.append(axis_row(5))
            write_axis(axis2, {1: rows})
            code, _, err = build_payload(axis2, out2)
            self.assertEqual(code, 3)
            self.assertIn("EVENTS_ERROR", err)
            self.assertFalse(out2.exists(), "中止时不得写出载荷")

    def test_03_build_strips_bold_and_keeps_other_characters(self):
        """用例 3:`**` 去除且其余字符不动;多情绪标签「、」连;无标签省略情绪行;不新造字段。"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            axis = tmp_path / "axis"
            out = tmp_path / "payload.json"
            summary = (
                "林间空地上，游鸦**背靠**歪脖子松树。「引号」、破折号——、省略号……、"
                "顿号、全角？！与半角?!都保持不动。"
            )
            expected_summary = summary.replace("**", "")
            rows = [
                axis_row(i) for i in (1, 2, 3)
            ] + [
                axis_row(
                    4,
                    year="第**3**年·秋",
                    realm="**炼气三层**",
                    rtype="**配角**",
                    chars="**游鸦**、晏燎",
                    summary=summary,
                    expansion="0.8万字｜**重点**｜[情绪:**燃**] [美学:水浒] [情绪:虐]",
                    geo="**次州**",
                ),
                axis_row(5, expansion="0.8万字｜无情绪标签"),
            ]
            write_axis(axis, {1: rows})
            code, _, _ = build_payload(axis, out)
            self.assertEqual(code, 0)
            payload = json.loads(out.read_text(encoding="utf-8"))
            entries = payload["entries"]
            self.assertEqual([e["id"] for e in entries], ["chapter-004", "chapter-005"])
            entry = entries[0]
            self.assertEqual(entry["eventSummary"], expected_summary)
            self.assertEqual(entry["eventState"], (
                "涉及角色：游鸦、晏燎\n事件类型：配角\n时间：第3年·秋\n"
                "境界：炼气三层\n地点：次州\n情绪：燃、虐"
            ))
            self.assertEqual(entry["eventTaskState"], "success")
            self.assertEqual(
                set(entry.keys()),
                {"id", "index", "eventSummary", "eventState", "eventTaskState"},
                "只搬现成字段,不新造(eventAnalysis/eventRawOutput 等不入载荷)",
            )
            # 无 [情绪:…] 标签 → 省略情绪行
            entry5 = entries[1]
            self.assertEqual(entry5["eventState"], (
                "涉及角色：角色甲、角色乙5\n事件类型：类型5\n时间：第5年·冬\n"
                "境界：凡人\n地点：地点5"
            ))
            self.assertNotIn("情绪：", entry5["eventState"])

    def test_04_abort_on_empty_summary_newline_or_marker_collision(self):
        """用例 4:摘要为空/含换行/撞段标记(摘要：/状态：/原始输出：)即中止;载荷侧同校验。"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            # (a) 摘要为空(整行只有空白)
            axis = tmp_path / "axis-empty"
            out = tmp_path / "payload-empty.json"
            rows = [axis_row(i) for i in (1, 2, 3)] + [axis_row(4, summary="   ")]
            write_axis(axis, {1: rows})
            code, _, err = build_payload(axis, out)
            self.assertEqual(code, 3)
            self.assertIn("EVENTS_ERROR", err)
            self.assertFalse(out.exists())
            # (b) 摘要以「摘要：」开头(撞段标记)
            axis2 = tmp_path / "axis-mark"
            out2 = tmp_path / "payload-mark.json"
            rows2 = [axis_row(i) for i in (1, 2, 3)] + [axis_row(4, summary="摘要：伪造的段标记行")]
            write_axis(axis2, {1: rows2})
            code, _, err = build_payload(axis2, out2)
            self.assertEqual(code, 3)
            self.assertFalse(out2.exists())
            # (c) 校验函数直测:换行/状态行撞标记即拒;正常值放行
            with self.assertRaises(MOD.EventTableError):
                MOD.validate_event_text("第一行\n第二行", "涉及角色：甲")
            with self.assertRaises(MOD.EventTableError):
                MOD.validate_event_text("正常摘要", "涉及角色：甲\n原始输出：撞标记")
            MOD.validate_event_text("正常摘要", "涉及角色：甲\n情绪：虐")  # 不抛即过
            # (d) 载荷侧同校验:摘要含换行的手工载荷 → apply 退出 3,不写库
            root = tmp_path / "proj"
            build_project(root, six_chapter_specs(), active_chapter_id="chapter-001")
            bad_payload = tmp_path / "bad-payload.json"
            bad_payload.write_text(json.dumps({
                "rule": "v1",
                "source": {"dir": "", "files": []},
                "entries": [{
                    "id": "chapter-004", "index": 4,
                    "eventSummary": "第一行\n第二行",
                    "eventState": "涉及角色：甲",
                    "eventTaskState": "success",
                }],
            }, ensure_ascii=False), encoding="utf-8")
            before_bad = tree_hashes(root)
            code, _, err = run(["apply", "--project", str(root), "--payload", str(bad_payload)])
            self.assertEqual(code, 3, "载荷摘要含换行 → 载荷不合预期")
            self.assertIn("EVENTS_ERROR", err)
            self.assertEqual(tree_hashes(root), before_bad, "载荷不合预期不触库")


class NovelEventsImportApplyTest(unittest.TestCase):
    def _prepare(self, tmp_path: Path, specs: list[dict] | None = None):
        root = tmp_path / "proj"
        build_project(root, specs or six_chapter_specs(), active_chapter_id="chapter-001")
        axis = tmp_path / "axis"
        write_axis(axis, {1: [axis_row(i) for i in range(1, 7)]})
        payload = tmp_path / "payload.json"
        code, _, _ = build_payload(axis, payload)
        assert code == 0
        return root, payload

    def test_05_apply_dry_run_only_counts_without_writing(self):
        """用例 5:干跑只报数(pending/skipped/每章三处)退出 2,不写盘不建备份。"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            root, payload = self._prepare(tmp_path)
            report_path = tmp_path / "dry-report.json"
            before = tree_hashes(root)
            code, out, _ = run([
                "apply", "--project", str(root), "--payload", str(payload),
                "--report", str(report_path),
            ])
            self.assertEqual(code, 2, "干跑有待写 → 退出 2")
            self.assertIn("EVENTS mode=dry pending=3 skipped=0 missing=0 exit=2", out)
            self.assertEqual(tree_hashes(root), before, "干跑不得改任何文件")
            self.assertEqual(backup_dirs(root), [], "干跑不建备份目录")
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(sorted(report["pending"]), ["chapter-004", "chapter-005", "chapter-006"])
            self.assertEqual(report["skipped"], {})
            self.assertEqual(report["missing"], {})
            self.assertEqual(
                report["targets"]["chapter-004"],
                {"shard": True, "index": True, "file": True},
                "待写章三处齐备",
            )
            # 第 1–3 章保护指纹必须是真实章对象(与逐字节实测一致):章 ID 格式错位
            # (如四位补零 chapter-0001)会让指纹全为 None,verify 的
            # 「第 1–3 章哈希不变」守卫退化成 None==None 空转。
            protected = report["protectedFirstThree"]
            store = root / "store" / "studio-workflow"
            manifest = load_manifest(store)
            for n in (1, 2, 3):
                cid = f"chapter-{n:03d}"
                record = protected[cid]
                registered = chapter_shards(manifest, cid)[0]
                self.assertEqual(
                    record["shard"], registered, f"{cid} 保护指纹须指向真实分片"
                )
                self.assertEqual(
                    record["shardSha256"],
                    hashlib.sha256(shard_file(store, registered).read_bytes()).hexdigest(),
                )
                mirror_path = root / "novel" / "chapters" / f"{cid}.md"
                self.assertEqual(
                    record["mirrorSha256"],
                    hashlib.sha256(mirror_path.read_bytes()).hexdigest(),
                )
                index_entry = next(
                    e for e in manifest["chapterIndex"] if e["id"] == cid
                )
                self.assertEqual(record["indexSha256"], index_canon_sha(index_entry))
            # (b) 已有事件的章(条目摘要非空 / 正文文件已含事件段)记 skipped
            with tempfile.TemporaryDirectory() as tmp2:
                tmp2_path = Path(tmp2)
                specs = six_chapter_specs()
                specs[4]["shards"][0]["entry"]["eventSummary"] = "已有摘要"  # 第 5 章条目已有事件摘要
                specs[5]["mirror"] = mirror_text(  # 第 6 章正文文件已含事件段
                    "第6章：待导入", "第6章正文。",
                    volume="第一卷", source_id="chapter-006", revision=1, source_name="6_待导入.md",
                    events={"eventSummary": "文件已有摘要", "eventState": "涉及角色：丙"},
                )
                root2, payload2 = self._prepare(tmp2_path, specs)
                before2 = tree_hashes(root2)
                code, out, _ = run(["apply", "--project", str(root2), "--payload", str(payload2)])
                self.assertEqual(code, 2)
                self.assertIn("pending=1", out)
                self.assertIn("skipped=2", out)
                self.assertEqual(tree_hashes(root2), before2, "干跑不改文件")

    def test_06_apply_write_updates_three_places_and_rolls_back_on_verify_fail(self):
        """用例 6:实写三处都有事件段;正文与头部逐字节不变;第 1–3 章哈希不变;
        重复导入记 skipped;校验不过自动回滚。"""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            root, payload = self._prepare(tmp_path)
            store = root / "store" / "studio-workflow"
            manifest_before = load_manifest(store)
            before_tree = tree_hashes(root)
            before_entries = {
                f"chapter-{n:03d}": read_first_entry(store, chapter_shards(manifest_before, f"chapter-{n:03d}")[0])
                for n in range(4, 7)
            }
            before_index_entries = {
                f"chapter-{n:03d}": next(
                    e for e in manifest_before["chapterIndex"] if e["id"] == f"chapter-{n:03d}"
                )
                for n in range(4, 7)
            }
            before_mirrors = {
                f"chapter-{n:03d}": (root / "novel" / "chapters" / f"chapter-{n:03d}.md").read_bytes()
                for n in range(4, 7)
            }
            protected_before = first_three_hashes(root, store)
            payload_map = {e["id"]: e for e in json.loads(payload.read_text(encoding="utf-8"))["entries"]}
            report_path = tmp_path / "write-report.json"
            code, out, _ = run([
                "apply", "--project", str(root), "--payload", str(payload),
                "--write", "--report", str(report_path),
            ])
            self.assertEqual(code, 0)
            self.assertIn("EVENTS mode=write pending=3 skipped=0 missing=0", out)
            self.assertIn("backupDir=", out)
            backups = backup_dirs(root)
            self.assertEqual(len(backups), 1)
            backup_dir = root / "backups" / "store" / backups[0]
            self.assertTrue((backup_dir / "manifest.json").is_file())
            self.assertTrue((backup_dir / "plan.json").is_file())
            self.assertTrue((backup_dir / "novel-chapters-before.tar").is_file())
            with open(backup_dir / "manifest.json", "rb") as fh:
                self.assertEqual(
                    hashlib.sha256(fh.read()).hexdigest(),
                    before_tree["store/studio-workflow/manifest.json"],
                    "备份的清单=改前原件",
                )
            with tarfile.open(backup_dir / "novel-chapters-before.tar") as tar:
                members = {m.name: tar.extractfile(m).read() for m in tar.getmembers() if m.isfile()}
            self.assertEqual(
                set(members),
                {f"novel/chapters/chapter-{n:03d}.md" for n in range(4, 7)},
                "tar 应含 4122 份正文文件(夹具为待写 3 份)的原样内容",
            )
            for cid, data in members.items():
                self.assertEqual(hashlib.sha256(data).hexdigest(), before_tree[cid], "tar 内容=改前正文")
            # 三处写入:分片条目
            manifest_after = load_manifest(store)
            self.assertEqual(
                manifest_after["shards"], manifest_before["shards"], "清单登记名一个不动"
            )
            for n in range(4, 7):
                cid = f"chapter-{n:03d}"
                expected = payload_map[cid]
                entry = read_first_entry(store, chapter_shards(manifest_after, cid)[0])
                self.assertEqual(entry["eventSummary"], expected["eventSummary"])
                self.assertEqual(entry["eventState"], expected["eventState"])
                self.assertEqual(entry["eventTaskState"], "success")
                self.assertNotEqual(entry["updatedAt"], FIXTURE_EPOCH_MS, "updatedAt 取当前时间")
                strip = {"eventSummary", "eventState", "eventTaskState", "updatedAt"}
                self.assertEqual(
                    {k: v for k, v in entry.items() if k not in strip},
                    {k: v for k, v in before_entries[cid].items() if k not in strip},
                    "其余字段不动",
                )
                # 索引条目
                index_entry = next(e for e in manifest_after["chapterIndex"] if e["id"] == cid)
                self.assertEqual(index_entry["eventSummary"], expected["eventSummary"])
                self.assertEqual(index_entry["eventState"], expected["eventState"])
                self.assertEqual(index_entry["eventTaskState"], "success")
                self.assertEqual(
                    {k: v for k, v in index_entry.items() if k not in strip},
                    {k: v for k, v in before_index_entries[cid].items() if k not in strip},
                    "索引条目其余字段不动",
                )
                # 正文文件末尾:原内容逐字节在前,恰一段事件段
                mirror_path = root / "novel" / "chapters" / f"{cid}.md"
                current = mirror_path.read_bytes()
                self.assertEqual(current, before_mirrors[cid] + event_block(expected))
                self.assertEqual(current.count("\n## 事件分析".encode("utf-8")), 1, "恰一段事件段")
                new_text = current.decode("utf-8")
                old_text = before_mirrors[cid].decode("utf-8")
                self.assertEqual(AUDIT.mirror_head(new_text), AUDIT.mirror_head(old_text), "头部逐字节不变")
                self.assertEqual(AUDIT.mirror_body(new_text), AUDIT.mirror_body(old_text), "正文逐字节不变")
            # 第 1–3 章哈希不变
            self.assertEqual(first_three_hashes(root, store), protected_before)
            # (b) 重复导入:干跑 pending=0、skipped=3;实写退出 0 且不新建备份
            code, out, _ = run(["apply", "--project", str(root), "--payload", str(payload)])
            self.assertEqual(code, 0)
            self.assertIn("EVENTS mode=dry pending=0 skipped=3 missing=0 exit=0", out)
            code, out, _ = run(["apply", "--project", str(root), "--payload", str(payload), "--write"])
            self.assertEqual(code, 0)
            self.assertIn("pending=0", out)
            self.assertNotIn("backupDir=", out, "无可写章不建备份目录")
            self.assertEqual(backup_dirs(root), backups, "重复导入不新建备份目录")
            cid = "chapter-004"
            entry = read_first_entry(store, chapter_shards(load_manifest(store), cid)[0])
            self.assertEqual(entry["eventSummary"], payload_map[cid]["eventSummary"], "重复导入不覆盖")
        # (c) 校验不过 → 自动回滚到改前逐字节原样,退出 5
        with tempfile.TemporaryDirectory() as tmp2:
            tmp2_path = Path(tmp2)
            root, payload = self._prepare(tmp2_path)
            before = tree_hashes(root)
            original_audit = AUDIT.audit
            MOD.novel_text_audit.audit = lambda project: {
                "mismatches": [{"chapterId": "chapter-004", "kind": "内容不一致"}],
                "metadataMismatches": [],
            }
            try:
                code, _, err = run(["apply", "--project", str(root), "--payload", str(payload), "--write"])
            finally:
                MOD.novel_text_audit.audit = original_audit
            self.assertEqual(code, 5, "校验不过(已回滚)")
            self.assertIn("EVENTS_ERROR verify:", err)
            self.assertEqual(tree_hashes(root), before, "回滚后逐字节回原样(备份目录除外)")
            store = root / "store" / "studio-workflow"
            manifest = load_manifest(store)
            entry = read_first_entry(store, chapter_shards(manifest, "chapter-004")[0])
            self.assertNotIn("eventSummary", entry, "回滚后条目无事件字段")


if __name__ == "__main__":
    unittest.main()
