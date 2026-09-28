"""test_preflight_gate —— preflight_gate.py 自测(R7.1;design §10;prd AC9)。

三态用例(design §10 规定)+ --force/--json 覆盖:
  1. 死路径:不存在 → RED,后续段 skipped(不吞)。
  2. 新鲜 mtime:刚写的已提交文件 → 静默窗 RED;--force 越过=exit 0 且记档 forced。
  3. 干净:已提交+mtime 回拨 40min+无改动 → 全 PASS exit 0。
  外加 git 脏态红:已提交文件回拨 mtime 后再改动 → RED 带 dirtyLines。

全部在 mktemp 临时 git repo/临时目录内进行;REPORT_JSON 打桩到临时路径,
不污染 apps/output/automation/ 正式报告位。
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def load_module():
    path = Path(__file__).with_name("preflight_gate.py")
    spec = importlib.util.spec_from_file_location("preflight_gate", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载脚本: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MOD = load_module()


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True, timeout=60)


def make_repo_with_file(base: Path, name: str = "shared.txt") -> tuple[Path, Path]:
    """临时 git repo + 一个已提交文件;返回 (repo, file)。mtime 由调用方拨。"""
    repo = base / "repo"
    repo.mkdir()
    assert git(repo, "init", "-q", "-b", "main").returncode == 0
    assert git(repo, "config", "user.email", "pf-test@local").returncode == 0
    assert git(repo, "config", "user.name", "pf-test").returncode == 0
    assert git(repo, "config", "commit.gpgsign", "false").returncode == 0
    target = repo / name
    target.write_text("initial\n", encoding="utf-8")
    assert git(repo, "add", "--", name).returncode == 0
    assert git(repo, "commit", "-qm", "init").returncode == 0
    return repo, target


def backdate(path: Path, minutes: int = 40) -> None:
    import time
    old = time.time() - minutes * 60
    import os
    os.utime(path, (old, old))


class PreflightGateTest(unittest.TestCase):
    def _run(self, argv: list[str]) -> tuple[int, dict, Path]:
        """打桩 REPORT_JSON 到临时路径跑 main,返回 (exit, 报告 dict, 报告路径)。"""
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "preflight-report.json"
            with patch.object(MOD, "REPORT_JSON", report):
                code = MOD.main([*argv, "--json"])
            return code, json.loads(report.read_text(encoding="utf-8")), report

    def test_dead_path_red(self):
        """态1:死路径 → RED,静默窗/git 记 skipped(不吞)。"""
        code, data, _ = self._run(["/no/such/preflight-dead-path-xyz.txt"])
        self.assertEqual(code, 1)
        self.assertFalse(data["ok"])
        checks = data["paths"][0]["checks"]
        self.assertEqual(checks["existence"]["status"], "failed")
        self.assertIn("死路径", checks["existence"]["reason"])
        self.assertEqual(checks["silence"]["status"], "skipped")
        self.assertEqual(checks["git"]["status"], "skipped")

    def test_fresh_mtime_red_then_force_pass(self):
        """态2:刚提交的文件(mtime=now)→ 静默窗 RED;--force 越过=exit 0 记档。"""
        with tempfile.TemporaryDirectory() as tmp:
            _, target = make_repo_with_file(Path(tmp))
            code, data, _ = self._run([str(target)])
            self.assertEqual(code, 1)
            self.assertFalse(data["ok"])
            silence = data["paths"][0]["checks"]["silence"]
            self.assertEqual(silence["status"], "failed")
            self.assertIn("静默窗", silence["reason"])
            # --force 越过:存在性/git 均绿的前提下仅静默窗被越,exit 0 + 记档
            code2, data2, _ = self._run([str(target), "--force"])
            self.assertEqual(code2, 0)
            self.assertTrue(data2["ok"])
            self.assertTrue(data2["forced"], "--force 越过必须记入 JSON")
            self.assertEqual(data2["paths"][0]["status"], "forced")
            self.assertEqual(data2["paths"][0]["checks"]["silence"]["status"], "forced")

    def test_clean_green(self):
        """态3:已提交 + mtime 回拨 40min + 无改动 → 全 PASS exit 0。"""
        with tempfile.TemporaryDirectory() as tmp:
            _, target = make_repo_with_file(Path(tmp))
            backdate(target, minutes=40)
            code, data, _ = self._run([str(target)])
            self.assertEqual(code, 0)
            self.assertTrue(data["ok"])
            checks = data["paths"][0]["checks"]
            self.assertEqual(checks["existence"]["status"], "passed")
            self.assertEqual(checks["silence"]["status"], "passed")
            self.assertEqual(checks["git"]["status"], "passed")

    def test_git_dirty_red_with_diff_evidence(self):
        """外加态:git 脏态 → RED 带 dirtyLines(只报不碰)。"""
        with tempfile.TemporaryDirectory() as tmp:
            _, target = make_repo_with_file(Path(tmp))
            backdate(target, minutes=40)
            target.write_text("parallel-session edit\n", encoding="utf-8")  # 未提交改动
            code, data, _ = self._run([str(target)])
            self.assertEqual(code, 1)
            git_check = data["paths"][0]["checks"]["git"]
            self.assertEqual(git_check["status"], "failed")
            self.assertTrue(any("shared.txt" in line for line in git_check["dirtyLines"]),
                            "差集行必须点名脏件")
            self.assertIn("shared.txt", git_check["diffStat"],
                          "diff HEAD --stat 摘要必须带改动件(工作树 vs HEAD)")

    def test_out_of_repo_path_git_na_not_red(self):
        """外加态:仓库外路径(如引擎家)→ git 段 not_applicable,不因无仓判红。"""
        with tempfile.TemporaryDirectory() as tmp:
            outside = Path(tmp) / "engine-home-like.txt"
            outside.write_text("x\n", encoding="utf-8")
            backdate(outside, minutes=40)
            code, data, _ = self._run([str(outside)])
            self.assertEqual(code, 0, "仓库外路径不应因 git 段判红")
            self.assertEqual(data["paths"][0]["checks"]["git"]["status"],
                             "not_applicable")

    def test_relative_path_from_subdir_cwd_detects_dirty(self):
        """回归(2026-09-29 修复):调用 cwd≠仓库根时相对 pathspec 须按调用方 cwd
        解析——首版把原始相对路径交给 `git -C <root>`,git 按根解析致脏件静默漏判
        (假 GREEN exit 0),传 `.` 反向放大为全仓范围。"""
        import os
        orig_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            repo, target = make_repo_with_file(Path(tmp), name="f.txt")
            backdate(target, minutes=40)
            target.write_text("parallel-session edit\n", encoding="utf-8")  # 脏
            (repo / "sub").mkdir()
            os.chdir(repo / "sub")  # 模拟调用 cwd=仓库子目录(保持空目录=干净)
            try:
                result = MOD.check_git(pathlib.Path("../f.txt"))
                self.assertEqual(result["status"], "failed",
                                 "子目录 cwd 的相对路径脏件必须判红(修复前假 GREEN)")
                self.assertTrue(any("f.txt" in line for line in result["dirtyLines"]))
                # 反向放大回归:`.` 须按调用方 cwd 收敛(=sub/),不放大为全仓
                dot_result = MOD.check_git(pathlib.Path("."))
                self.assertEqual(dot_result["status"], "passed",
                                 "'.'=sub/(干净)不应放大为全仓把 repo/f.txt 判红")
            finally:
                os.chdir(orig_cwd)

    def test_repo_root_resolves_to_git_toplevel(self):
        """回归锁:REPO 必须是 git 仓库根(首版 parents[2]=apps/ 致报告落
        apps/apps/…,relative_to 打印还掩盖了错位)。"""
        script_dir = Path(__file__).resolve().parent
        toplevel = subprocess.run(
            ["git", "-C", str(script_dir), "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=60).stdout.strip()
        self.assertNotEqual(toplevel, "", "测试环境必须在本 git 仓库内")
        self.assertEqual(MOD.REPO, Path(toplevel),
                         "REPO 必须解析为仓库根,否则报告落错位")
        self.assertEqual(
            MOD.REPORT_JSON,
            Path(toplevel) / "apps" / "output" / "automation"
            / "preflight-report.json",
            "报告必须落仓库 apps/output/automation/ 正位")


if __name__ == "__main__":
    unittest.main()
