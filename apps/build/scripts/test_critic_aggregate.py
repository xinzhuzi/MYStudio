#!/usr/bin/env python3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import critic_aggregate


class DiseaseCountsTests(unittest.TestCase):
    def test_counts_all_matches_but_keeps_three_distinct_examples(self):
        with tempfile.TemporaryDirectory() as tmp:
            reports = Path(tmp)
            chapter_lines = {
                "001": ["- [P0] 节奏问题"] * 5,
                "002": ["- [P1] 节奏问题"],
                "003": ["- [P2] 节奏问题"],
                "004": ["- [P1] 节奏问题"],
                "005": ["- [P1] 节奏与镜头问题"],
            }
            for ep, lines in chapter_lines.items():
                (reports / f"chapter-{ep}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

            counts, totals = critic_aggregate.disease_counts(str(reports))

        self.assertEqual(counts["节奏"][0], 8)
        self.assertEqual(counts["节奏"][1], ["001", "002", "003"])
        self.assertEqual(counts["镜头"][0], 1)
        self.assertEqual(counts["镜头"][1], ["005"])
        self.assertEqual(totals, {"P0": 5, "P1": 3, "P2": 1})

    def test_first_keyword_still_owns_overlap_after_example_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            reports = Path(tmp)
            chapter_lines = {
                "001": ["- [P1] 镜头问题"],
                "002": ["- [P1] 镜头问题"],
                "003": ["- [P1] 镜头问题"],
                "004": ["- [P1] 镜头问题"],
                "005": ["- [P1] 镜头与拆镜问题"],
            }
            for ep, lines in chapter_lines.items():
                (reports / f"chapter-{ep}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

            counts, totals = critic_aggregate.disease_counts(str(reports))

        self.assertEqual(counts["镜头"][0], 5)
        self.assertEqual(counts["镜头"][1], ["001", "002", "003"])
        self.assertEqual(counts["拆镜"][0], 0)
        self.assertEqual(counts["拆镜"][1], [])
        self.assertEqual(totals, {"P0": 0, "P1": 5, "P2": 0})


class AggregateCliTests(unittest.TestCase):
    def run_cli(self, out_root):
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT_DIR / "critic_aggregate.py"), "--out-root", str(out_root)],
            check=False,
            capture_output=True,
            text=True,
        )

    def write_index(self, out_root):
        (out_root / "index.tsv").write_text(
            "ep\tverdict\tverdict_raw\tscore\tp0\tp1\tp2\tciteRate\tsecs\tmodel\tretries\n"
            "1\t合理\t合理\t10\t0\t0\t0\t100\t1\thigh\t0\n"
            "12\t合理\t合理\t20\t0\t0\t0\t100\t1\thigh\t0\n"
            "1000\t合理\t合理\t30\t0\t0\t0\t100\t1\thigh\t0\n",
            encoding="utf-8",
        )

    def test_top20_uses_existing_zero_padded_markdown_links_and_explicit_missing_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_root = Path(tmp)
            reports = out_root / "reports"
            reports.mkdir()
            self.write_index(out_root)
            (reports / "chapter-001.md").write_text("", encoding="utf-8")
            (reports / "chapter-1000.md").write_text("", encoding="utf-8")

            result = self.run_cli(out_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = (out_root / "00-总报告.md").read_text(encoding="utf-8")

        self.assertIn("[chapter-001.md](reports/chapter-001.md)", report)
        self.assertIn("报告缺失: chapter-012.md", report)
        self.assertIn("[chapter-1000.md](reports/chapter-1000.md)", report)
        self.assertNotIn("reports/chapter-012.md)", report)

    def run_with_failures(self, count):
        tmp = tempfile.TemporaryDirectory()
        out_root = Path(tmp.name)
        reports = out_root / "reports"
        reports.mkdir()
        self.write_index(out_root)
        (reports / "chapter-001.md").write_text("", encoding="utf-8")
        (out_root / "failures.tsv").write_text("".join(f"{i}\tfailed\n" for i in range(count)), encoding="utf-8")
        result = self.run_cli(out_root)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = (out_root / "00-总报告.md").read_text(encoding="utf-8")
        return tmp, report

    def test_failures_at_fifty_closes_code_fence_without_omission(self):
        tmp, report = self.run_with_failures(50)
        try:
            section = report.split("## 失败章附录", 1)[1]
            self.assertIn("\n49\tfailed\n```\n", section)
            self.assertNotIn("仅示前50", section)
        finally:
            tmp.cleanup()

    def test_failures_over_fifty_closes_code_fence_before_omission_note(self):
        tmp, report = self.run_with_failures(51)
        try:
            section = report.split("## 失败章附录", 1)[1]
            self.assertIn("\n49\tfailed\n```\n…(仅示前50,全量见 failures.tsv)", section)
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
