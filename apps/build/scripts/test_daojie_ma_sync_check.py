from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "daojie-ma-sync-check.py"
REPO_ROOT = Path(__file__).resolve().parents[3]
MANUAL_DIR = REPO_ROOT / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng"
MA_SYNC_DIR = MANUAL_DIR / "ma_sync"
DEFAULT_MA_ROOT = Path("/Users/zhengbingjin/Project/Unity/MA")
REGISTERED_SOURCES = [
    "scripts/gongbi/daojie_gongbi_restyle.py",
    "scripts/prompting/finish_locks.py",
    "knowledge/prompt-templates/美术成片风格提示词模板库.md",
]


def run_check(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def make_temp_ma_root(mutations: dict[str, str] | None = None, drop: str | None = None) -> Path:
    """以真实 MA 技能文件为底本搭建临时工作区,按需做非锚点文本漂移/删文件。"""
    temp_root = Path(tempfile.mkdtemp(prefix="daojie-ma-sync-"))
    skill = temp_root / ".claude" / "skills" / "ma-imagegen"
    real_skill = DEFAULT_MA_ROOT / ".claude" / "skills" / "ma-imagegen"
    for rel in REGISTERED_SOURCES:
        target = skill / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        text = (real_skill / rel).read_text(encoding="utf-8")
        if mutations and rel in mutations:
            text = text.replace(mutations[rel][0], mutations[rel][1])
            assert text != (real_skill / rel).read_text(encoding="utf-8"), f"mutation no-op for {rel}"
        if drop != rel:
            target.write_text(text, encoding="utf-8")
    return temp_root


class DaojieMaSyncCheckTests(unittest.TestCase):
    def test_help_exits_zero_with_usage(self):
        result = run_check("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("--ma-root", result.stdout)
        self.assertIn("--json", result.stdout)

    def test_internal_consistency_passes_without_ma_root(self):
        result = run_check("--json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report["ok"])
        self.assertEqual(len(report["internal"]["registered_sources"]), 3)
        self.assertEqual(report["internal"]["contract_version"], "ma-gongbi-v1")

    def test_real_ma_workspace_reports_no_drift(self):
        if not (DEFAULT_MA_ROOT / ".claude/skills/ma-imagegen").is_dir():
            self.skipTest("本机无 MA 工作区")
        result = run_check("--ma-root", str(DEFAULT_MA_ROOT), "--json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report["ok"])
        self.assertEqual(report["ma_drift"], [])

    def test_non_anchor_text_drift_is_detected_with_module_attribution(self):
        temp_root = make_temp_ma_root(mutations={
            "scripts/prompting/finish_locks.py": ("def ", "def  # drifted"),
        })
        try:
            result = run_check("--ma-root", str(temp_root), "--json")
            self.assertEqual(result.returncode, 1, result.stdout)
            report = json.loads(result.stdout)
            drift = report["ma_drift"]
            self.assertEqual(len(drift), 1)
            self.assertEqual(drift[0]["source"], "scripts/prompting/finish_locks.py")
            self.assertEqual(drift[0]["diagnosis"], "anchors_intact_text_drifted")
            self.assertTrue(drift[0]["anchors_intact"])
            self.assertIn(drift[0]["expected_sha256"][:12], drift[0]["expected_sha256"])
            self.assertNotEqual(drift[0]["actual_sha256"], drift[0]["expected_sha256"])
            self.assertIn("finish.quality", drift[0]["affected_modules"])
        finally:
            shutil.rmtree(temp_root)

    def test_missing_anchor_reports_stale_snapshot(self):
        anchors = json.loads((MA_SYNC_DIR / "lock-anchors.json").read_text(encoding="utf-8"))
        anchor_to_break = anchors["locks"][0]["maAnchors"][0]
        temp_root = make_temp_ma_root(mutations={
            "scripts/gongbi/daojie_gongbi_restyle.py": (anchor_to_break, "已被移除的锚点文本"),
        })
        try:
            result = run_check("--ma-root", str(temp_root), "--json")
            self.assertEqual(result.returncode, 1, result.stdout)
            report = json.loads(result.stdout)
            drift = report["ma_drift"][0]
            self.assertEqual(drift["diagnosis"], "snapshot_stale_anchors_missing")
            self.assertIn(anchor_to_break, drift["missing_anchors"])
        finally:
            shutil.rmtree(temp_root)

    def test_missing_ma_source_is_reported(self):
        temp_root = make_temp_ma_root(drop="scripts/prompting/finish_locks.py")
        try:
            result = run_check("--ma-root", str(temp_root), "--json")
            self.assertEqual(result.returncode, 1, result.stdout)
            report = json.loads(result.stdout)
            kinds = [p["kind"] for p in report["problems"]]
            self.assertIn("ma_source_missing", kinds)
        finally:
            shutil.rmtree(temp_root)

    def test_check_is_read_only(self):
        temp_root = make_temp_ma_root(mutations={
            "scripts/prompting/finish_locks.py": ("def ", "def  # drifted"),
        })
        try:
            files = sorted(p for p in temp_root.rglob("*") if p.is_file())
            before = [(p, p.stat().st_mtime_ns, p.stat().st_size) for p in files]
            snapshot_files = sorted(MA_SYNC_DIR.glob("*.json")) + [
                MANUAL_DIR / "prefix.md",
                MANUAL_DIR / "art_prompt/art_storyboard_video.md",
            ]
            snapshot_before = [(p, p.read_bytes()) for p in snapshot_files]
            run_check("--ma-root", str(temp_root))
            after = [(p, p.stat().st_mtime_ns, p.stat().st_size) for p in files]
            snapshot_after = [(p, p.read_bytes()) for p in snapshot_files]
            self.assertEqual(before, after)
            self.assertEqual(snapshot_before, snapshot_after)
        finally:
            shutil.rmtree(temp_root)

    def test_human_report_is_not_json_by_default(self):
        result = run_check()
        self.assertEqual(result.returncode, 0)
        self.assertIn("同步检查", result.stdout)
        self.assertIn("只读", result.stdout)


if __name__ == "__main__":
    unittest.main()
