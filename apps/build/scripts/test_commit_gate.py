"""test_commit_gate —— commit_gate.sh 自测(R3;design §6;prd AC4)。

两例(design §6 规定):
  1. 无关暂存保护:跑前已有清单外 staged 件 → RED 且该件原样保留(未被 unstage)。
  2. 一致放行:staged 与 pathspec 完全一致 → green,提交成立且恰好含清单件。
外加防御例:pathspec 死路径 → RED(排除 WIP 后 HEAD 死路径事故的机器化)。

全部在 mktemp 临时 git repo 内进行,绝不触碰本仓工作树与暂存区。
"""
from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

GATE = Path(__file__).with_name("commit_gate.sh")


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True, timeout=60)


def make_repo(base: Path) -> Path:
    repo = base / "repo"
    repo.mkdir()
    assert git(repo, "init", "-q", "-b", "main").returncode == 0
    # 本地身份与开关(测试自足:不依赖全局 git config;gpgsign 关防环境签名卡死)
    assert git(repo, "config", "user.email", "gate-test@local").returncode == 0
    assert git(repo, "config", "user.name", "gate-test").returncode == 0
    assert git(repo, "config", "commit.gpgsign", "false").returncode == 0
    return repo


def run_gate(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(GATE), *args], cwd=str(repo),
                          capture_output=True, text=True, timeout=180)


class CommitGateTest(unittest.TestCase):
    def test_unrelated_staging_blocks_red_and_preserved(self):
        """例1:无关暂存保护——RED、不提交、既有暂存原样保留。"""
        with tempfile.TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            (repo / "base.txt").write_text("base\n", encoding="utf-8")
            self.assertEqual(git(repo, "add", "--", "base.txt").returncode, 0)
            self.assertEqual(git(repo, "commit", "-qm", "base").returncode, 0)
            head_before = git(repo, "rev-parse", "HEAD").stdout.strip()
            # 模拟并行会话:与本次 pathspec 无关的件已在暂存区
            (repo / "other.txt").write_text("other\n", encoding="utf-8")
            self.assertEqual(git(repo, "add", "--", "other.txt").returncode, 0)
            # 本次要提交的件(工作树新件,未暂存)
            (repo / "mine.txt").write_text("mine\n", encoding="utf-8")

            proc = run_gate(repo, "-m", "只提 mine", "--", "mine.txt")
            self.assertNotEqual(proc.returncode, 0, "清单外 staged 件在场必须 RED")
            out = proc.stdout + proc.stderr
            self.assertIn("other.txt", out, "差集必须点名无关暂存件")
            self.assertIn("原样保留", out, "必须明示不动既有暂存")
            # 未提交:HEAD 未动
            self.assertEqual(
                git(repo, "rev-parse", "HEAD").stdout.strip(), head_before,
                "RED 时绝不 commit")
            # 既有暂存原样保留:other.txt 仍在 staged 集且内容仍在
            staged = git(repo, "diff", "--cached", "--name-only").stdout.split()
            self.assertIn("other.txt", staged, "既有暂存不得被 unstage")
            self.assertIn("other", git(repo, "diff", "--cached", "--", "other.txt").stdout,
                          "other.txt 暂存内容不得丢失")

    def test_matching_pathspec_commits_green(self):
        """例2:一致放行——green,提交成立且恰好含清单件,HEAD 抽验在场。"""
        with tempfile.TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            (repo / "a.txt").write_text("a\n", encoding="utf-8")
            (repo / "b.txt").write_text("b\n", encoding="utf-8")

            proc = run_gate(repo, "-m", "新增两件", "--", "a.txt", "b.txt")
            self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
            committed = git(repo, "show", "--name-only", "--format=", "HEAD").stdout.split()
            self.assertEqual(sorted(committed), ["a.txt", "b.txt"],
                             "提交必须恰好含 pathspec 件")
            self.assertIn("a.txt |", proc.stdout, "git show HEAD --stat 抽验输出必须在场")
            self.assertIn("b.txt |", proc.stdout, "git show HEAD --stat 抽验输出必须在场")
            self.assertEqual(git(repo, "status", "--porcelain").stdout.strip(), "",
                             "提交后工作树应干净")

    def test_dead_pathspec_red(self):
        """防御例:pathspec 死路径 → RED(git add 失败),不产生提交。"""
        with tempfile.TemporaryDirectory() as tmp:
            repo = make_repo(Path(tmp))
            (repo / "base.txt").write_text("base\n", encoding="utf-8")
            self.assertEqual(git(repo, "add", "--", "base.txt").returncode, 0)
            self.assertEqual(git(repo, "commit", "-qm", "base").returncode, 0)
            head_before = git(repo, "rev-parse", "HEAD").stdout.strip()

            proc = run_gate(repo, "-m", "死路径", "--", "nope.txt")
            self.assertNotEqual(proc.returncode, 0, "死 pathspec 必须 RED")
            self.assertIn("git add 失败", proc.stdout + proc.stderr)
            self.assertEqual(git(repo, "rev-parse", "HEAD").stdout.strip(), head_before,
                             "RED 时绝不 commit")
            self.assertEqual(git(repo, "diff", "--cached", "--name-only").stdout.strip(), "",
                             "暂存区不得留痕")


if __name__ == "__main__":
    unittest.main()
