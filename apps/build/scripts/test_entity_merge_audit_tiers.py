"""Real CLI regressions for review-only audit tiers; fixtures remain in task research."""

import csv
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
SCRIPT = SCRIPTS_DIR / "entity_merge_audit_tiers.py"
RESEARCH_DIR = (
    SCRIPTS_DIR.parents[2]
    / ".trellis/tasks/10-20-trellis-audit-remediation/research"
)
FIELDS = [
    "类别", "实体A", "A别名", "A首章", "A章数", "实体B", "B别名", "B首章", "B章数",
    "命中规则", "共现章数",
]
FORBIDDEN_GUIDANCE = (
    "建议保留名", "并入名", "合并后别名全集", "保留首章", "并入首章", "保留名裁定",
    "主线实体", "同一实体强信号", "短名疑为", "疑为错别字", "别名互含直判",
    "高置信", "中置信", "低置信", "合并建议",
)


def make_row(name_a, name_b, rule, cooccurrences, aliases_a="-", aliases_b="-"):
    return dict(zip(FIELDS, [
        "character", name_a, aliases_a, "chapter-001", "0100", name_b, aliases_b,
        "chapter-007", "0004", rule, str(cooccurrences),
    ]))


class AuditTiersCliTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix="audit-rule-test-", dir=RESEARCH_DIR))
        self.rows = [
            make_row("晏燎", "鲁械", "别名互含", 6, "鲁械/独孤剑尘"),
            make_row("晏燎", "独孤剑尘", "别名互含", 0, "鲁械/独孤剑尘"),
            make_row("顾川", "顾川之母", "名称包含", 4, "阿川", "川母"),
            make_row("李慕白", "李幕白", "编辑距离≤1", 3),
            make_row("王大山", "王二小", "同首字+共现≥3章", 3),
            make_row("李慕白", "李幕白", "编辑距离≤1", 1),
            make_row("丁一", "丁三", "编辑距离≤1", 0),
        ]

    def write_input(self, rows=None, path=None, fields=None):
        path = path or self.directory / "input.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=FIELDS if fields is None else fields)
            writer.writeheader()
            writer.writerows(self.rows if rows is None else rows)
        return path

    def run_cli(self, source=None, output=None, extra_args=()):
        source = source or self.write_input()
        output = output or self.directory / "output"
        stats_path = self.directory / "stats.json"
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--csv", str(source), "--out-dir", str(output),
             "--stats-json", str(stats_path), *extra_args],
            capture_output=True, text=True, check=False,
        )
        (self.directory / "stdout.txt").write_text(result.stdout, encoding="utf-8")
        (self.directory / "stderr.txt").write_text(result.stderr, encoding="utf-8")
        return result, output, stats_path

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")

    def test_outputs_never_infer_identity_or_direct_merges(self):
        result, output, stats_path = self.run_cli()
        self.assert_success(result)
        texts = [result.stdout, stats_path.read_text(encoding="utf-8")]
        texts.extend(path.read_text(encoding="utf-8-sig") for path in output.iterdir())
        for text in texts:
            for phrase in FORBIDDEN_GUIDANCE:
                with self.subTest(phrase=phrase):
                    self.assertNotIn(phrase, text)
        for path in output.glob("*.md"):
            text = path.read_text(encoding="utf-8")
            self.assertIn("复核优先级", text)
            self.assertIn("不能证明同一身份", text)

    def test_high_csv_preserves_raw_ab_fields_without_picking_a_primary(self):
        result, output, _ = self.run_cli()
        self.assert_success(result)
        with (output / "entity-merge-audit-high.csv").open(
            encoding="utf-8-sig", newline=""
        ) as stream:
            reader = csv.DictReader(stream)
            self.assertEqual(reader.fieldnames, FIELDS + ["复核原因"])
            actual = list(reader)
        expected = sorted(self.rows[:4], key=lambda row: (
            -int(row["共现章数"]), row["类别"], row["实体A"], row["实体B"],
        ))
        self.assertEqual([{key: row[key] for key in FIELDS} for row in actual], expected)
        for row in actual:
            self.assertIn("不能证明同一身份", row["复核原因"])
        alias_row = next(row for row in actual if row["实体B"] == "鲁械")
        self.assertIn("污染", alias_row["复核原因"])
        family_row = next(row for row in actual if row["实体B"] == "顾川之母")
        self.assertIn("亲属", family_row["复核原因"])

    def test_markdown_explains_alias_pollution_family_and_cooccurrence(self):
        result, output, _ = self.run_cli()
        self.assert_success(result)
        high = (output / "entity-merge-audit-high.md").read_text(encoding="utf-8")
        for phrase in ("污染", "亲属", "母子", "共现", "保持独立", "不能证明同一身份"):
            self.assertIn(phrase, high)
        medium = (output / "entity-merge-audit-medium.md").read_text(encoding="utf-8")
        self.assertIn("王大山", medium)
        self.assertIn("王二小", medium)
        self.assertIn("不能证明同一身份", medium)

    def test_full_copy_is_real_lossless_and_input_unchanged(self):
        rows = self.rows + [self.rows[0]]
        source = self.write_input(rows)
        digest_before = hashlib.sha256(source.read_bytes()).hexdigest()
        result, output, stats_path = self.run_cli(source=source)
        self.assert_success(result)
        full = output / "entity-merge-audit-full.csv"
        self.assertTrue(full.is_file())
        self.assertEqual(full.read_bytes(), source.read_bytes())
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), digest_before)
        with full.open(encoding="utf-8-sig", newline="") as stream:
            self.assertEqual(list(csv.DictReader(stream)), rows)
        stats = json.loads(stats_path.read_text(encoding="utf-8"))
        self.assertEqual(stats["total"], len(rows))
        self.assertEqual(stats["high"] + stats["medium"] + stats["low"], len(rows))

    def test_total_is_dynamic_and_stats_keys_and_tier_counts_stay_compatible(self):
        for count in (1, len(self.rows)):
            with self.subTest(count=count):
                source = self.write_input(self.rows[:count], self.directory / f"{count}.csv")
                result, output, stats_path = self.run_cli(
                    source=source, output=self.directory / f"output-{count}"
                )
                self.assert_success(result)
                stats = json.loads(stats_path.read_text(encoding="utf-8"))
                stdout = json.loads(result.stdout)
                self.assertEqual(stats["total"], count)
                self.assertEqual(stdout["total"], count)
                self.assertEqual(sum(stdout[tier] for tier in ("S", "M", "L")), count)
                self.assertTrue({
                    "total", "high", "medium", "low", "medium_kind_counts",
                    "high_kind_counts", "low_kind_counts", "label_head_mismatch",
                }.issubset(stats))
                self.assertTrue({
                    "total", "S", "M", "L", "M_by_kind", "label_head_mismatch", "outputs",
                }.issubset(stdout))
                self.assertTrue(all(Path(path).is_file() for path in stdout["outputs"]))
                for path in output.glob("*.md"):
                    text = path.read_text(encoding="utf-8")
                    self.assertNotIn("64,109", text)
                    self.assertNotIn("64109", text)
                high = (output / "entity-merge-audit-high.md").read_text(encoding="utf-8")
                self.assertIn(f"全量 {count:,} 对", high)
                if count == len(self.rows):
                    self.assertEqual((stats["high"], stats["medium"], stats["low"]), (4, 2, 1))

    def test_full_copy_same_path_or_file_alias_never_rewrites_input(self):
        for alias in ("same-path", "symlink", "hardlink"):
            with self.subTest(alias=alias):
                output = self.directory / alias
                full = output / "entity-merge-audit-full.csv"
                source = self.write_input(path=full if alias == "same-path" else output / "input.csv")
                if alias == "symlink":
                    full.symlink_to(source)
                elif alias == "hardlink":
                    os.link(source, full)
                os.utime(source, ns=(1_600_000_000_000_000_000, 1_600_000_000_000_000_000))
                before = source.stat()
                original = source.read_bytes()
                result, _, _ = self.run_cli(source=source, output=output)
                self.assert_success(result)
                self.assertEqual(source.read_bytes(), original)
                self.assertEqual(source.stat().st_mtime_ns, before.st_mtime_ns)
                self.assertEqual(source.stat().st_ino, before.st_ino)
                self.assertTrue(full.samefile(source))
                if alias == "symlink":
                    self.assertTrue(full.is_symlink())

    def assert_full_link_rejected(self, link_kind):
        source = self.write_input()
        output = self.directory / "output"
        output.mkdir()
        victim = self.directory / "unrelated.csv"
        if link_kind != "dangling-symlink":
            victim.write_bytes(b"unrelated data must not change\n")
        full = output / "entity-merge-audit-full.csv"
        if link_kind == "hardlink":
            os.link(victim, full)
        else:
            full.symlink_to(victim)
        protected = [source]
        if victim.exists():
            protected.append(victim)
        for name in ("high.csv", "high.md", "medium.md", "summary.md"):
            report = output / f"entity-merge-audit-{name}"
            report.write_bytes(b"existing report must not change\n")
            protected.append(report)
        stats_path = self.directory / "stats.json"
        stats_path.write_bytes(b"existing stats must not change\n")
        protected.append(stats_path)
        for path in protected:
            os.utime(path, ns=(1_600_000_000_000_000_000, 1_600_000_000_000_000_000))
        snapshots = {path: (path.read_bytes(), path.stat()) for path in protected}
        link_before = full.lstat()
        result, _, _ = self.run_cli(source=source, output=output)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("FATAL", result.stderr)
        self.assertIn("entity-merge-audit-full.csv", result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertEqual(result.stdout, "")
        for path, (original, before) in snapshots.items():
            with self.subTest(path=path.name):
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(path.stat().st_mtime_ns, before.st_mtime_ns)
                self.assertEqual(path.stat().st_ino, before.st_ino)
        self.assertEqual(full.lstat().st_ino, link_before.st_ino)
        self.assertEqual(full.lstat().st_mtime_ns, link_before.st_mtime_ns)
        if link_kind == "hardlink":
            self.assertTrue(full.samefile(victim))
        else:
            self.assertTrue(full.is_symlink())
            self.assertEqual(full.readlink(), victim)
        if link_kind == "dangling-symlink":
            self.assertFalse(victim.exists())

    def test_full_copy_rejects_symlink_to_unrelated_file_before_exports(self):
        self.assert_full_link_rejected("symlink")

    def test_full_copy_rejects_hardlink_to_unrelated_file_before_exports(self):
        self.assert_full_link_rejected("hardlink")

    def test_full_copy_rejects_dangling_symlink_without_creating_target(self):
        self.assert_full_link_rejected("dangling-symlink")

    def test_full_copy_regular_output_can_be_updated_on_second_run(self):
        source = self.write_input()
        original = source.read_bytes()
        result, output, _ = self.run_cli(source=source)
        self.assert_success(result)
        full = output / "entity-merge-audit-full.csv"
        self.assertEqual(full.read_bytes(), original)
        before = full.stat()
        shorter_source = self.write_input(self.rows[:1], self.directory / "shorter.csv")
        result, _, stats_path = self.run_cli(source=shorter_source, output=output)
        self.assert_success(result)
        self.assertEqual(full.read_bytes(), shorter_source.read_bytes())
        self.assertEqual(full.stat().st_ino, before.st_ino)
        self.assertEqual(full.stat().st_nlink, 1)
        self.assertFalse(full.is_symlink())
        self.assertEqual(source.read_bytes(), original)
        self.assertEqual(json.loads(stats_path.read_text(encoding="utf-8"))["total"], 1)

    def test_medium_full_csv_reference_resolves_to_complete_input(self):
        result, output, _ = self.run_cli(extra_args=("--sample-per-kind", "1"))
        self.assert_success(result)
        medium = (output / "entity-merge-audit-medium.md").read_text(encoding="utf-8")
        self.assertIn("`entity-merge-audit-full.csv`", medium)
        self.assertIn("抽样 1 对", medium)
        full = output / "entity-merge-audit-full.csv"
        self.assertTrue(full.is_file())
        with full.open(encoding="utf-8-sig", newline="") as stream:
            self.assertEqual(list(csv.DictReader(stream)), self.rows)

    def test_cli_help_has_review_only_semantics_and_existing_flags(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--help"],
            capture_output=True, text=True, check=False,
        )
        self.assert_success(result)
        for flag in ("--csv", "--out-dir", "--stats-json", "--sample-per-kind"):
            self.assertIn(flag, result.stdout)
        self.assertIn("复核优先级", result.stdout)
        for phrase in FORBIDDEN_GUIDANCE:
            self.assertNotIn(phrase, result.stdout)

    def test_invalid_header_is_rejected_without_writing_reports(self):
        source = self.write_input(rows=[], fields=list(reversed(FIELDS)))
        original = source.read_bytes()
        result, output, stats_path = self.run_cli(source=source)
        self.assertEqual(result.returncode, 2)
        self.assertIn("表头不符", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertFalse(output.exists())
        self.assertFalse(stats_path.exists())
        self.assertEqual(source.read_bytes(), original)

    def test_empty_input_still_rejected(self):
        result, output, stats_path = self.run_cli(source=self.write_input(rows=[]))
        self.assertEqual(result.returncode, 2)
        self.assertIn("零数据行", result.stderr)
        self.assertFalse(output.exists())
        self.assertFalse(stats_path.exists())


if __name__ == "__main__":
    unittest.main()
