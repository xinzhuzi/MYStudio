"""test_novel_events_restore —— novel_events_restore.py 自测(11-26-novel-script-data-alignment 收尾补件)。

六条用例:
  1. 干跑只报数不写(退出码 2,pending=1);
  2. 实写后三处都有该章原有事件字段、正文与头部逐字节不变、全库对账 0 不一致、其余章不动;
  3. 重复恢复记 skipped(退出码 0),正文文件不再变;
  4. --rollback 按备份目录还原三处原件(哈希逐件相等);
  5. 源条目五字段不全即拒写(退出码 3),盘面零改动;
  6. 源为完整清单形态(含 chapterIndex)时同样取到该章条目。

夹具:项目库用 test_novel_text_audit.build_project(Task 1 同一夹具构造器)。
全部在 tempfile 临时目录内进行,不触真实项目库。
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from test_novel_text_audit import build_project, make_entry, mirror_text

import novel_text_audit as AUDIT


def load_module():
    path = Path(__file__).with_name("novel_events_restore.py")
    spec = importlib.util.spec_from_file_location("novel_events_restore", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载脚本: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MOD = load_module()


# ---------------------------------------------------------------- 夹具

CH3_TITLE = "第3章：残纹入骨两气缠"
CH3_BODY = "# 第3章：残纹入骨两气缠\n\n晏燎盘膝而坐，两气在经脉里相互纠缠。"
CH4_BODY = "# 第4章：测试章\n\n第四章正文。"
FIELDS = {
    "eventTaskState": "success",
    "eventSummary": "晏燎体内血祭残纹入骨，两气相互纠缠侵蚀，勉强稳住。",
    "eventState": "涉及角色：晏燎\n主线关系：强\n信息密度：高",
    "eventAnalysis": {
        "sourceId": "chapter-003",
        "chapterLabel": "第3章 残纹入骨两气缠",
        "characters": ["晏燎"],
        "coreEvent": "晏燎体内血祭残纹入骨，两气相互纠缠侵蚀，勉强稳住。",
    },
    "eventRawOutput": "| 第3章 残纹入骨两气缠 | 晏燎 | 晏燎体内血祭残纹入骨，两气相互纠缠侵蚀，勉强稳住。 | 强 | 高 |",
}


def build_case(root: Path) -> dict:
    ch3 = make_entry("chapter-003", index=3, title=CH3_TITLE, source_text=CH3_BODY, source_name="3_残纹入骨两气缠.md")
    ch4 = make_entry("chapter-004", index=4, title="第4章：测试章", source_text=CH4_BODY)
    return build_project(
        root,
        [
            {
                "id": "chapter-003",
                "mirror": mirror_text(CH3_TITLE, CH3_BODY, volume="第一卷", source_id="chapter-003", revision=1, source_name="3_残纹入骨两气缠.md"),
                "shards": [{"entry": ch3}],
            },
            {
                "id": "chapter-004",
                "mirror": mirror_text("第4章：测试章", CH4_BODY, volume="第一卷", source_id="chapter-004", revision=1),
                "shards": [{"entry": ch4}],
            },
        ],
    )


def write_source(path: Path, fields: dict) -> Path:
    path.write_text(json.dumps({"chapter-003": fields}, ensure_ascii=False), encoding="utf-8")
    return path


def run(argv: list[str]) -> tuple[int, str, str]:
    out_buf, err_buf = io.StringIO(), io.StringIO()
    with redirect_stdout(out_buf), redirect_stderr(err_buf):
        code = MOD.main(argv)
    return code, out_buf.getvalue(), err_buf.getvalue()


def sha(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def snapshot(built: dict) -> dict:
    root = Path(built["root"])
    return {
        "manifest": sha(root / "store/studio-workflow/manifest.json"),
        "shard3": sha(built["shard_paths"]["chapter-003"][0]),
        "shard4": sha(built["shard_paths"]["chapter-004"][0]),
        "mirror3": sha(root / "novel/chapters/chapter-003.md"),
        "mirror4": sha(root / "novel/chapters/chapter-004.md"),
    }


class EventsRestoreTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.built = build_case(self.root / "project")
        self.source = write_source(self.root / "source.json", FIELDS)

    def tearDown(self):
        self._tmp.cleanup()

    def argv(self, *extra: str) -> list[str]:
        return ["--project", str(self.built["root"]), "--chapter", "chapter-003", "--source", str(self.source), *extra]

    def test_dry_run_reports_pending_without_writing(self):
        before = snapshot(self.built)
        code, out, _ = run(self.argv())
        self.assertEqual(code, 2)
        self.assertIn("mode=dry", out)
        self.assertIn("pending=1", out)
        self.assertEqual(snapshot(self.built), before)

    def test_write_restores_three_places_and_keeps_body(self):
        root = Path(self.built["root"])
        mirror_path = root / "novel/chapters/chapter-003.md"
        mirror_before = mirror_path.read_bytes()
        before = snapshot(self.built)
        code, out, _ = run(self.argv("--write"))
        self.assertEqual(code, 0, out)
        self.assertIn("pending=1", out)
        manifest = json.loads((root / "store/studio-workflow/manifest.json").read_text(encoding="utf-8"))
        index3 = next(e for e in manifest["chapterIndex"] if e["id"] == "chapter-003")
        for field, value in FIELDS.items():
            self.assertEqual(index3.get(field), value, field)
        shard3 = json.loads(Path(self.built["shard_paths"]["chapter-003"][0]).read_text(encoding="utf-8"))
        store3 = shard3["state"]["novelChapters"][0]
        for field, value in FIELDS.items():
            self.assertEqual(store3.get(field), value, field)
        self.assertEqual(store3["sourceText"], CH3_BODY)
        mirror_after = mirror_path.read_bytes()
        self.assertTrue(mirror_after.startswith(mirror_before))
        text = mirror_after.decode("utf-8")
        self.assertIn("## 事件分析", text)
        self.assertIn("摘要：" + FIELDS["eventSummary"], text)
        self.assertIn("状态：\n" + FIELDS["eventState"], text)
        self.assertIn("原始输出：" + FIELDS["eventRawOutput"], text)
        report = AUDIT.audit(str(root))
        self.assertEqual(report["mismatches"], [])
        self.assertEqual(report.get("metadataMismatches", []), [])
        # 其余章不动(第 4 章索引条目无事件字段,正文分片与正文文件哈希不变)
        index4 = next(e for e in manifest["chapterIndex"] if e["id"] == "chapter-004")
        self.assertNotIn("eventSummary", index4)
        after = snapshot(self.built)
        self.assertEqual(after["shard4"], before["shard4"])
        self.assertEqual(after["mirror4"], before["mirror4"])
        self.assertEqual(len(manifest["chapterIndex"]), 2)
        # 备份目录三处原件齐全
        backup_dir = next(line.split("=", 1)[1] for line in out.splitlines() if line.startswith("backupDir="))
        for name in ("manifest.json", "plan.json"):
            self.assertTrue((Path(backup_dir) / name).is_file(), name)
        self.assertEqual(sha(Path(backup_dir) / "novel/chapters/chapter-003.md"), hashlib.sha256(mirror_before).hexdigest())

    def test_rerun_is_skipped(self):
        code, out, _ = run(self.argv("--write"))
        self.assertEqual(code, 0, out)
        mirror_path = Path(self.built["root"]) / "novel/chapters/chapter-003.md"
        after_first = sha(mirror_path)
        code2, out2, _ = run(self.argv("--write"))
        self.assertEqual(code2, 0, out2)
        self.assertIn("skipped=1", out2)
        self.assertEqual(sha(mirror_path), after_first)

    def test_rollback_restores_originals(self):
        before = snapshot(self.built)
        code, out, _ = run(self.argv("--write"))
        self.assertEqual(code, 0, out)
        self.assertNotEqual(snapshot(self.built), before)
        backup_dir = next(line.split("=", 1)[1] for line in out.splitlines() if line.startswith("backupDir="))
        code2, out2, _ = run(["--project", str(self.built["root"]), "--rollback", backup_dir])
        self.assertEqual(code2, 0, out2)
        self.assertEqual(snapshot(self.built), before)

    def test_source_missing_field_is_rejected(self):
        incomplete = dict(FIELDS)
        incomplete.pop("eventAnalysis")
        source = write_source(self.root / "incomplete.json", incomplete)
        before = snapshot(self.built)
        code, _, err = run(["--project", str(self.built["root"]), "--chapter", "chapter-003", "--source", str(source), "--write"])
        self.assertEqual(code, 3)
        self.assertEqual(snapshot(self.built), before)

    def test_source_manifest_form(self):
        manifest_form = self.root / "manifest-form.json"
        entry = {"id": "chapter-003", "index": 3, "title": CH3_TITLE, **FIELDS}
        manifest_form.write_text(json.dumps({"chapterIndex": [entry]}, ensure_ascii=False), encoding="utf-8")
        code, out, _ = run(["--project", str(self.built["root"]), "--chapter", "chapter-003", "--source", str(manifest_form)])
        self.assertEqual(code, 2, out)
        self.assertIn("pending=1", out)


if __name__ == "__main__":
    unittest.main()
