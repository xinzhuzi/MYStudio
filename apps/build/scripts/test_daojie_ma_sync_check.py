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
PARITY_FIXTURE = MA_SYNC_DIR / "three-track-parity-fixture.json"
DEFAULT_MA_ROOT = Path("/Users/zhengbingjin/Project/Unity/MA")
REGISTERED_SOURCES = [
    "scripts/gongbi/daojie_gongbi_restyle.py",
    "scripts/prompting/finish_locks.py",
    "knowledge/prompt-templates/美术成片风格提示词模板库.md",
    "scripts/prompting/gongbi_contract.py",
    "scripts/prompting/length_policy.py",
]
PALETTE_SOURCES = [
    "scripts/data/三轨选色配料.toml",
    "scripts/data/阵营配色与黄金公式.toml",
]


def run_check(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def make_temp_ma_root(mutations: dict[str, str] | None = None, drop: str | None = None, include_palette: bool = False) -> Path:
    """以真实 MA 技能文件为底本搭建临时工作区,按需做非锚点文本漂移/删文件。"""
    temp_root = Path(tempfile.mkdtemp(prefix="daojie-ma-sync-"))
    skill = temp_root / ".claude" / "skills" / "ma-imagegen"
    real_skill = DEFAULT_MA_ROOT / ".claude" / "skills" / "ma-imagegen"
    KNOWLEDGE_SOURCES = [
        "knowledge/prompt-templates/人物提示词.md",
        "knowledge/prompt-templates/生图资产模板库.md",
    ]
    for rel in REGISTERED_SOURCES + KNOWLEDGE_SOURCES + (PALETTE_SOURCES if include_palette else []):
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
        self.assertEqual(len(report["internal"]["registered_sources"]), 9)
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

    def test_non_anchor_contract_and_length_policy_drift_are_both_detected(self):
        temp_root = make_temp_ma_root(mutations={
            "scripts/prompting/gongbi_contract.py": ("CONTRACT_VERSION", "CONTRACT__VERSION"),
            "scripts/prompting/length_policy.py": ("AUTHOR_TARGET_MIN", "AUTHOR__TARGET_MIN"),
        })
        try:
            result = run_check("--ma-root", str(temp_root), "--json")
            self.assertEqual(result.returncode, 1, result.stdout)
            report = json.loads(result.stdout)
            drift_by_source = {item["source"]: item for item in report["ma_drift"]}
            for source in (
                "scripts/prompting/gongbi_contract.py",
                "scripts/prompting/length_policy.py",
            ):
                self.assertIn(source, drift_by_source)
                self.assertEqual("anchors_intact_text_drifted", drift_by_source[source]["diagnosis"])
                self.assertTrue(drift_by_source[source]["anchors_intact"])
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

    def test_palette_canon_semantic_drift_is_detected(self):
        temp_root = make_temp_ma_root(include_palette=True, mutations={
            "scripts/data/三轨选色配料.toml": ("name = \"宣纸白\"", "name = \"漂白纸\""),
        })
        try:
            result = run_check("--ma-root", str(temp_root), "--json")
            self.assertEqual(result.returncode, 1, result.stdout)
            report = json.loads(result.stdout)
            diagnoses = [d["diagnosis"] for d in report.get("ma_drift", [])]
            kinds = [p["kind"] for p in report["problems"]]
            self.assertIn("palette_canon_source_drifted", diagnoses)
            self.assertIn("palette_canon_semantic_mismatch", kinds)
        finally:
            shutil.rmtree(temp_root)

    def test_knowledge_guidance_source_drift_is_detected(self):
        temp_root = make_temp_ma_root(include_palette=True, mutations={
            "knowledge/prompt-templates/人物提示词.md": ("侧逆光勾铁线描边（点睛色提线）", "被篡改的锚点文本"),
        })
        try:
            result = run_check("--ma-root", str(temp_root), "--json")
            self.assertEqual(result.returncode, 1, result.stdout)
            report = json.loads(result.stdout)
            diagnoses = [d["diagnosis"] for d in report.get("ma_drift", [])]
            self.assertTrue(any("drifted" in str(d) for d in diagnoses), diagnoses)
        finally:
            shutil.rmtree(temp_root)

    def test_palette_canon_clean_when_sources_unchanged(self):
        temp_root = make_temp_ma_root(include_palette=True)
        try:
            result = run_check("--ma-root", str(temp_root), "--json")
            self.assertEqual(result.returncode, 0, result.stdout)
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

    def test_shared_three_track_fixture_matches_ma_compiler_and_length_policy(self):
        if not (DEFAULT_MA_ROOT / ".claude/skills/ma-imagegen").is_dir():
            self.skipTest("本机无 MA 工作区")
        fixture = json.loads(PARITY_FIXTURE.read_text(encoding="utf-8"))
        support_dir = DEFAULT_MA_ROOT / ".claude/skills/ma-imagegen/scripts/cli/support"
        scripts_root = DEFAULT_MA_ROOT / ".claude/skills/ma-imagegen/scripts"
        for path in (support_dir, scripts_root):
            if str(path) not in sys.path:
                sys.path.insert(0, str(path))
        from prompt_bridge_cli import local_prompt_assemble
        from prompting.length_policy import measure_provider_prompt

        for track in fixture["tracks"]:
            result = local_prompt_assemble({
                "mode": "工笔重制",
                "request": {
                    "type": track["maTrack"],
                    "prompt_parts": [fixture["subjectBody"]],
                    "negative_prompt": fixture["negative"],
                    "palette_scheme_id": track["paletteSchemeId"],
                    "has_real_reference": True,
                },
                "defaults": {"style": fixture["contractVersion"], "source_facts": {}, "negative": ""},
            })
            self.assertTrue(result.get("ok"), result)
            prompt = result["assembled_prompt"]
            markers = [
                fixture["subjectBody"],
                "配料方案",
                "风格底座",
                f"TRACK={track['maTrack']}",
                "成片质量",
                "参考图降噪",
                "Avoid:",
            ]
            positions = [prompt.index(marker) for marker in markers]
            self.assertEqual(positions, sorted(positions))
            self.assertEqual(prompt.count("TRACK="), 1)
            self.assertEqual(prompt.count("Avoid:"), 1)

        for length_case in fixture["lengthCases"]:
            total_chars = length_case["totalChars"]
            positive = "x" * (total_chars - len("\nAvoid: ") - 1)
            measured = measure_provider_prompt(positive, "n")
            self.assertEqual(measured["total_chars"], total_chars)
            self.assertEqual(measured["status"], length_case["status"])
            self.assertEqual(measured["ok"], length_case["ok"])


if __name__ == "__main__":
    unittest.main()
