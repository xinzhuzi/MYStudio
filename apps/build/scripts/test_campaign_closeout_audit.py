#!/usr/bin/env python3
"""campaign_closeout_audit.py 回归网(铁律 8 机检化,10-05)。"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent / "campaign_closeout_audit.py"
sys.path.insert(0, str(SCRIPT.parent))
import campaign_closeout_audit as cca  # noqa: E402


# ---------- 纯函数 ----------

def test_parse_ledger_checkbox_and_sections():
    text = "# 标题\n## Phase A\n- [x] A1 已完\n- [ ] A2 (候令:等 push 令)\n### S6\n* [X] 大写X也算勾\n- [ ] A3 裸未勾\n正文无框行\n"
    rows = cca.parse_ledger(text)
    assert [(r[2], r[3][:2]) for r in rows] == [(True, "A1"), (False, "A2"), (True, "大写"), (False, "A3")]
    assert rows[1][1] == "Phase A" and rows[3][1] == "S6"
    assert rows[0][0] == 3  # 行号


def test_classify_unchecked_four_tags():
    assert cca.classify_unchecked("I6 实弹 (候令:等九发窗口同跑)") == "候令"
    assert cca.classify_unchecked("九型重跑 (候窗:7-8h 专用窗口)") == "候窗"
    assert cca.classify_unchecked("xxx 欠账 yyy") == "欠账"
    assert cca.classify_unchecked("I6 实弹未做") == "欠账"  # 无标注未勾=欠账


def test_find_task_implement_active_then_archive(tmp_path, monkeypatch):
    (tmp_path / "t1").mkdir(); (tmp_path / "t1/implement.md").write_text("- [x] ok")
    arch = tmp_path / "archive/2026-10"; arch.mkdir(parents=True)
    (arch / "t2").mkdir(); (arch / "t2/implement.md").write_text("- [x] ok")
    monkeypatch.setattr(cca, "TASKS", tmp_path)
    assert cca.find_task_implement("t1") == tmp_path / "t1/implement.md"
    assert cca.find_task_implement("t2") == arch / "t2/implement.md"
    assert cca.find_task_implement("t3") is None


def test_find_tmp_evidence(tmp_path, monkeypatch):
    (tmp_path / "i6-evidence").mkdir(); (tmp_path / "notes.txt").touch()
    extra = tmp_path / "fire-report.json"; extra.touch()
    hits = cca.find_tmp_evidence([extra, tmp_path / "gone"])
    assert "i6-evidence" in hits and str(extra) in hits
    assert all("notes.txt" not in h for h in hits)


# ---------- 集成:临时 git 仓 + run_checks ----------

@pytest.fixture()
def git_repo(tmp_path, monkeypatch):
    monkeypatch.setattr(cca, "REPO", tmp_path)
    def g(*args):
        return subprocess.run(["git", "-C", str(tmp_path), *args], capture_output=True, text=True)
    g("init", "-q", "-b", "main"); g("config", "user.email", "t@t"); g("config", "user.name", "t")
    (tmp_path / "a.txt").write_text("1")
    g("add", "-A"); g("commit", "-qm", "c1")
    bare = tmp_path.parent / (tmp_path.name + "-bare.git")
    subprocess.run(["git", "clone", "-q", "--bare", str(tmp_path), str(bare)], capture_output=True)
    g("remote", "add", "origin", str(bare)); g("fetch", "-q", "origin")
    g("branch", "--set-upstream-to=origin/main", "main")
    return tmp_path


@pytest.fixture()
def outside_tmp(tmp_path):
    """仓外临时取证位(建在仓内会污染 ②工作树 判定)。"""
    t = tmp_path.parent / (tmp_path.name + "-tmp")
    t.mkdir()
    return t


def test_run_checks_full_lifecycle(git_repo, monkeypatch, outside_tmp):
    # 复位:临时取证位与进程面全空,工作树干净,已推平
    monkeypatch.setattr(cca, "TMP", outside_tmp)
    monkeypatch.setattr(cca, "pgrep_pids", lambda p: [])
    r = cca.run_checks(None, [])
    assert r["verdict"] == "green"

    # 工作树脏 → ②红;未 push → ②warn(候令);引擎活 → ④红;证据残留 → ③红
    (git_repo / "b.txt").write_text("dirty")
    (git_repo / "a.txt").write_text("2")
    subprocess.run(["git", "-C", str(git_repo), "add", "-A"], capture_output=True)
    subprocess.run(["git", "-C", str(git_repo), "commit", "-qm", "c2"])
    monkeypatch.setattr(cca, "pgrep_pids", lambda p: ["123"] if p == cca.ENGINE_MARK else [])
    (outside_tmp / "zz-evidence").mkdir()
    r = cca.run_checks(None, [])
    by = {c["check"]: c["status"] for c in r["checks"]}
    assert by["②git账面·工作树"] == "green"  # 已提交归账
    assert by["②git账面·未push"] == "warn"
    assert by["③易失证据回收"] == "red"
    assert by["④资源收摊·引擎"] == "red"
    assert by["④资源收摊·App"] == "green"
    assert r["verdict"] == "red"


def test_task_ledger_red_on_untagged(tmp_path, monkeypatch):
    home = tmp_path / "tasks"; (home / "10-09-x").mkdir(parents=True)
    (home / "10-09-x/implement.md").write_text(
        "## Phase I\n- [x] I1\n- [ ] I2 (候令:等F4终审)\n- [ ] I3 (候窗:打包窗口)\n- [ ] I6 实弹\n")
    monkeypatch.setattr(cca, "TASKS", home)
    monkeypatch.setattr(cca, "REPO", tmp_path)  # git 面在无仓时报 warn 不炸
    monkeypatch.setattr(cca, "TMP", tmp_path)
    monkeypatch.setattr(cca, "pgrep_pids", lambda p: [])
    r = cca.run_checks("10-09-x", [])
    c1 = next(c for c in r["checks"] if c["check"] == "①任务档对拍")
    assert c1["status"] == "red" and "I6 实弹" in c1["detail"] and "候令1" in c1["detail"] and "候窗1" in c1["detail"]


# ---------- CLI 端到端(进程内,吃 monkeypatch) ----------

def test_cli_json_exit_codes(git_repo, monkeypatch, outside_tmp, capsys):
    monkeypatch.setattr(cca, "TMP", outside_tmp)
    monkeypatch.setattr(cca, "pgrep_pids", lambda p: [])
    monkeypatch.setattr(sys, "argv", ["audit", "--json"])
    assert cca.main() == 0
    assert json.loads(capsys.readouterr().out)["verdict"] in ("green", "warn")
    # 任务档不存在 → ①红 → exit 2
    monkeypatch.setattr(sys, "argv", ["audit", "--json", "--task", "不存在档"])
    assert cca.main() == 2
    assert json.loads(capsys.readouterr().out)["verdict"] == "red"
