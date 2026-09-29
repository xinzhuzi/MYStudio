"""B4 时长链复核挂钩定向测试(工单完成边界「一物一断」)。

四态动态断言(pytest 驱动 node 实弹 duration-review-hook.mjs):
  ①开关关=零执行(spy spawn 零调用);
  ②开+无预算=登记跳过(零执行+日志含「登记跳过」);
  ③开+有预算=真实 review 脚本跑出报告摘要,exit1 不断链(node 进程正常退);
  ④exit2(输入错误)同样不断链。
另:静态断言 automate mjs 接线形态(默认关 if 块+同域 import,仿 A4)。
"""
import json
import os
import shutil
import subprocess
import textwrap
from pathlib import Path;

import pytest

CHAPTER_VIDEO = Path(__file__).resolve().parent.parent
REPO_ROOT = CHAPTER_VIDEO.parents[2]
HOOK = CHAPTER_VIDEO / "duration-review-hook.mjs"
AUTOMATE_MJS = CHAPTER_VIDEO / "automate-chapter001-video.mjs"
REVIEW_SCRIPT = CHAPTER_VIDEO / "review_chapter001_duration_chain.py"

DRIVER = textwrap.dedent(
    """
    import {{ runDurationChainReview }} from '{hook_url}';
    const calls = [];
    const spy = (cmd, args) => {{ calls.push([cmd, ...args]); return {{ status: 0, stdout: '{{}}', stderr: '' }}; }};
    const logs = [];
    const log = (...a) => logs.push(a.join(' '));
    const opts = {{
      env: JSON.parse(process.env.HOOK_ENV_JSON),
      repoRoot: process.env.HOOK_REPO_ROOT,
      scriptPath: process.env.HOOK_SCRIPT_PATH,
      log,
    }};
    if (process.env.HOOK_MODE === 'spy') opts.spawn = spy;
    const r = runDurationChainReview(opts);
    console.log('RESULT:' + JSON.stringify({{ r, calls, logs }}));
    """
)

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node 不在 PATH")


def run_hook(tmp_path, *, mode, env):
    driver = tmp_path / "hook-driver.mjs"
    driver.write_text(
        DRIVER.format(hook_url=HOOK.as_uri()),
        encoding="utf-8",
    )
    proc = subprocess.run(
        ["node", str(driver)],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=str(tmp_path),
        env={**os.environ, "HOOK_MODE": mode, "HOOK_ENV_JSON": json.dumps(env),
             "HOOK_REPO_ROOT": str(REPO_ROOT), "HOOK_SCRIPT_PATH": str(REVIEW_SCRIPT)},
    )
    assert proc.returncode == 0, f"node 驱动异常退出={proc.returncode}: {proc.stderr[-800:]}"
    line = next(l for l in proc.stdout.splitlines() if l.startswith("RESULT:"))
    return json.loads(line[len("RESULT:"):]), proc


def test_disabled_switch_zero_execution(tmp_path):
    out, _ = run_hook(
        tmp_path,
        mode="spy",
        env={"MYSTUDIO_CHAPTER_VIDEO_DURATION_BUDGET": str(tmp_path / "any.json")},
    )
    assert out["r"] == {"ran": False, "reason": "disabled"}
    assert out["calls"] == [], "开关关必须零执行"


def test_enabled_without_budget_registers_skip(tmp_path):
    missing = tmp_path / "no-such-budget.json"
    out, _ = run_hook(
        tmp_path,
        mode="spy",
        env={
            "MYSTUDIO_CHAPTER_VIDEO_DURATION_REVIEW": "1",
            "MYSTUDIO_CHAPTER_VIDEO_DURATION_BUDGET": str(missing),
        },
    )
    assert out["r"]["ran"] is False
    assert out["r"]["reason"] == "budget-missing"
    assert out["r"]["budgetPath"] == str(missing)
    assert out["calls"] == [], "预算缺位必须零执行"
    assert any("登记跳过" in line for line in out["logs"]), out["logs"]


def test_enabled_with_budget_real_script_summary_chain_continues(tmp_path):
    budget = tmp_path / "budget.json"
    budget.write_text(
        json.dumps([{"sceneNo": 1, "budgetSec": 5}], ensure_ascii=False),
        encoding="utf-8",
    )
    out, proc = run_hook(
        tmp_path,
        mode="real",
        env={
            **os.environ,
            "MYSTUDIO_CHAPTER_VIDEO_DURATION_REVIEW": "1",
            "MYSTUDIO_CHAPTER_VIDEO_DURATION_BUDGET": str(budget),
        },
    )
    assert out["r"]["ran"] is True
    # 真实 review:极小预算对先例成稿必出发现(exit1)或容差内(exit0),两者皆合法;
    # 铁律=无论何码,挂钩正常返回(node 驱动进程 exit0 已在 run_hook 断言)。
    assert out["r"]["exitCode"] in (0, 1), out["r"]
    assert "scenes=" in out["r"]["summary"], out["r"]
    assert any("duration chain review (advisory)" in line for line in out["logs"]), out["logs"]
    assert proc.returncode == 0


def test_exit2_input_error_chain_continues(tmp_path):
    budget = tmp_path / "bad-budget.json"
    budget.write_text('{"scenes": "not-a-list"}', encoding="utf-8")
    out, proc = run_hook(
        tmp_path,
        mode="real",
        env={
            **os.environ,
            "MYSTUDIO_CHAPTER_VIDEO_DURATION_REVIEW": "1",
            "MYSTUDIO_CHAPTER_VIDEO_DURATION_BUDGET": str(budget),
        },
    )
    assert out["r"]["ran"] is True
    assert out["r"]["exitCode"] == 2, out["r"]
    assert any("chain continues" in line for line in out["logs"]), out["logs"]
    assert proc.returncode == 0


def test_automate_mjs_wiring_mirrors_a4_form():
    source = AUTOMATE_MJS.read_text(encoding="utf-8")
    assert "MYSTUDIO_CHAPTER_VIDEO_DURATION_REVIEW === '1'" in source
    assert "const durationReviewEnabled" in source
    assert "if (durationReviewEnabled) {" in source
    assert "runDurationChainReview({ repoRoot, scriptPath: durationChainReviewScript });" in source
    assert "from './duration-review-hook.mjs'" in source
    # A4 孪生开关仍在(形态同源互证)
    assert "MYSTUDIO_CHAPTER_VIDEO_MOBILITY_PRECHECK === '1'" in source
    assert "if (keyframeMobilityPrecheckEnabled) {" in source
