#!/usr/bin/env python3
"""preflight_gate —— 共享真源预检门(三段只读检查;AI 动共享文件/跑生成器前的强制预检)。

出处:2026-09-28 任务 09-28-process-formalization S6.5(R7.1;design §10;prd AC9)。
用法:
  python3 preflight_gate.py <path>... [--regen] [--force] [--json]

三段(逐路径,全只读——本工具零改写):
  1. 存在性:不存在=RED「死路径」(72min 死路径轮询事故的机器化);目录参数存在即可。
  2. 静默窗:mtime 距今<30min=RED「他方可能正在写」(--force 可越并记 JSON);
     ≥30min=PASS。
  3. git 脏态:git status --porcelain -- <path> 非空=RED「有未提交改动(并行会话
     在场),只报不碰」+差集行+git diff HEAD --stat 摘要;路径不在 git 仓库内=记
     not_applicable 不判红(如引擎家路径)。
  死路径时后续段记 skipped(如实呈现,不吞)。

--regen(跑生成器前):三段之外追加打印警示块——「生成器会覆写此文件;若含画布
  手调,先备份对账(0928 覆盖事故)」;只警示,不代执行任何生成/备份。
--json:报告落 apps/output/automation/preflight-report.json。
退出码:任一路径任一段 RED=1;全 PASS(或静默窗被 --force 越过)=0。
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[2]
REPORT_JSON = REPO / "apps" / "output" / "automation" / "preflight-report.json"
SILENCE_WINDOW_MIN = 30
REGEN_HINT = "生成器会覆写此文件;若含画布手调,先备份对账(0928 覆盖事故)"
TAG = "[preflight]"


def _sh(cmd: list[str], cwd: pathlib.Path | None = None,
        timeout_s: float = 60) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None,
                          capture_output=True, text=True, timeout=timeout_s)


# ── 三段检查(每段返回 dict;红灯由段自身 status 表达) ──────────────────────


def check_existence(path: pathlib.Path) -> dict:
    ok = path.exists()
    return {"status": "passed" if ok else "failed",
            **({} if ok else {"reason": "死路径(不存在)——72min 死路径轮询事故的机器化"})}


def check_silence(path: pathlib.Path, now: float, force: bool) -> dict:
    mtime = path.stat().st_mtime
    age_min = max(0.0, (now - mtime) / 60)
    base = {"ageMin": round(age_min, 1), "windowMin": SILENCE_WINDOW_MIN}
    if age_min >= SILENCE_WINDOW_MIN:
        return {"status": "passed", **base}
    reason = (f"mtime 距今 {age_min:.1f}min < {SILENCE_WINDOW_MIN}min"
              "——他方可能正在写(静默窗)")
    if force:
        return {"status": "forced", **base, "reason": reason + ";--force 已越过(记档)"}
    return {"status": "failed", **base, "reason": reason}


def check_git(path: pathlib.Path) -> dict:
    probe = path if path.is_dir() else path.parent
    root_proc = _sh(["git", "-C", str(probe), "rev-parse", "--show-toplevel"])
    if root_proc.returncode != 0:
        return {"status": "not_applicable",
                "reason": "路径不在 git 仓库内(如引擎家路径),无脏态可查"}
    root = pathlib.Path(root_proc.stdout.strip())
    status = _sh(["git", "-C", str(root), "status", "--porcelain", "--", str(path)])
    if status.returncode != 0:
        return {"status": "not_applicable",
                "reason": f"git status 不可用:{(status.stderr or '').strip()[:120]}"}
    lines = [l for l in status.stdout.splitlines() if l.strip()]
    if not lines:
        return {"status": "passed"}
    diff = _sh(["git", "-C", str(root), "diff", "HEAD", "--stat", "--", str(path)])
    summary = ("\n".join(diff.stdout.strip().splitlines()[-5:])
               if diff.returncode == 0 else "")
    return {"status": "failed",
            "reason": "有未提交改动(并行会话在场可能),只报不碰",
            "dirtyLines": lines,
            **({"diffStat": summary} if summary else {})}


def check_path(arg: str, *, force: bool, now: float) -> dict:
    """对单个输入路径跑三段,组装逐路径结果(存在性 RED 时后续段 skipped)。"""
    path = pathlib.Path(arg)
    result: dict = {"path": arg, "checks": {}}
    existence = check_existence(path)
    result["checks"]["existence"] = existence
    if existence["status"] == "failed":
        result["checks"]["silence"] = {"status": "skipped", "reason": "死路径,跳过"}
        result["checks"]["git"] = {"status": "skipped", "reason": "死路径,跳过"}
        result["status"] = "failed"
        return result
    silence = check_silence(path, now, force)
    git = check_git(path)
    result["checks"]["silence"] = silence
    result["checks"]["git"] = git
    if any(c["status"] == "failed" for c in (silence, git)):
        result["status"] = "failed"
    elif silence["status"] == "forced":
        result["status"] = "forced"
    else:
        result["status"] = "passed"
    return result


# ── 编排 ────────────────────────────────────────────────────────────────────


def _label(check: dict, name: str) -> str:
    mark = {"passed": "PASS ", "failed": "RED  ", "forced": "FORCE",
            "skipped": "SKIP ", "not_applicable": "N/A  "}[check["status"]]
    reason = check.get("reason")
    extra = f" :: {reason}" if reason else ""
    if name == "静默窗" and "ageMin" in check:
        extra = f" :: 距今 {check['ageMin']}min(窗 {check['windowMin']}min)" + (
            f";{reason}" if reason else "")
    return f"  {name}  {mark}{extra}"


def main(argv: list[str]) -> int:
    regen = "--regen" in argv
    force = "--force" in argv
    as_json = "--json" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if "--help" in argv or not paths:
        print(__doc__)
        return 0 if "--help" in argv else 2
    if force:
        print(f"{TAG} --force 在场:仅越过「静默窗」红灯;存在性/git 脏态红仍拦门")
    now = time.time()
    results = [check_path(p, force=force, now=now) for p in paths]
    for item in results:
        print(f"{TAG} {item['path']} → {item['status'].upper()}")
        for key, name in (("existence", "存在性"), ("silence", "静默窗"),
                          ("git", "git脏态")):
            print(f"{TAG}{_label(item['checks'][key], name)}")
        git_check = item["checks"]["git"]
        if git_check.get("dirtyLines"):
            for line in git_check["dirtyLines"]:
                print(f"{TAG}     {line}")
        if git_check.get("diffStat"):
            for line in git_check["diffStat"].splitlines():
                print(f"{TAG}     {line}")
    if regen:
        print(f"{TAG} ── ⚠ --regen 警示块(跑生成器前)──")
        print(f"{TAG} {REGEN_HINT}:")
        for p in paths:
            print(f"{TAG}   - {p}")
        print(f"{TAG} 本工具不代执行任何生成/备份,只警示。")
    ok = all(item["status"] != "failed" for item in results)
    forced = any(item["status"] == "forced" for item in results)
    summary = ", ".join(f"{item['path']}={item['status']}" for item in results)
    print(f"{TAG} 汇总:{'GREEN' if ok else 'RED'}({summary})")
    if as_json:
        report = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                  "ok": ok, "forced": forced, "regen": regen, "paths": results}
        REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
        REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
        try:  # 仓库外自定义路径(测试打桩)时如实打绝对路径,打印永不崩
            shown: pathlib.Path | str = REPORT_JSON.relative_to(REPO)
        except ValueError:
            shown = REPORT_JSON
        print(f"{TAG} 报告落 {shown}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
