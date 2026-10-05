#!/usr/bin/env python3
"""战役清账审计(10-05 立,铁律 8「战役清账门」的机检化;规矩全文=.claude/CLAUDE.md 铁律 8)。

清账四查(退出码:0=无红可收官(warn=候令/候窗项已列明);2=有红,须清账;1=用法错):
  ①任务档对拍(--task):implement.md 全部 checkbox 逐行结清——
      未勾行内标注(候令…)/(候窗…)=合法悬置(warn);未标注未勾 或 行含「欠账」=欠账判红。
      归档后的档(.trellis/tasks/archive/*/<name>)同样可查。
  ②git 账面:工作树 M/未跟踪件>0=红(未归账);未 push>0=warn(push 候令=用户门);无上游=warn。
  ③易失证据回收:/tmp 顶层名含 evidence/-proof/取证 的残留=红(重启即丢);--evidence 显式声明的
      临时取证位仍存在=红。仓库/任务档内的证据不算(只查易失位)。
  ④资源收摊:引擎进程(ComfyUI/main.py)活着=红(自起引擎须收摊);漫影 App 活着=warn(可能用户自开)。

用法:
  python3 apps/build/scripts/campaign_closeout_audit.py [--task <任务目录名>] [--evidence <路径>]… [--json]
收官口径:exit 0 才可自称「收官/全清/终态」;exit 2 只能称「阶段边界」,逐红项清账后复跑。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TASKS = REPO / ".trellis/tasks"
TMP = Path("/tmp")
ENGINE_MARK = "ComfyUI/main.py"
APP_MARK = "漫影工作室.app/Contents/MacOS"
EVIDENCE_NAME_PAT = re.compile(r"evidence|-proof|取证", re.IGNORECASE)
TAG_PENDING_USER = "候令"
TAG_PENDING_WINDOW = "候窗"
TAG_DEBT = "欠账"


def find_task_implement(task: str) -> Path | None:
    """任务目录名 → implement.md 路径(活跃区优先,归档区兜底)。"""
    for base in (TASKS, *sorted(TASKS.glob("archive/*"))):
        p = base / task / "implement.md"
        if p.exists():
            return p
    return None


def parse_ledger(text: str) -> list[tuple[int, str, bool, str]]:
    """implement.md → [(行号, 所属节标题, 是否勾选, 行文本)] 的 checkbox 清单。"""
    out: list[tuple[int, str, bool, str]] = []
    section = "(档首)"
    for i, raw in enumerate(text.splitlines(), 1):
        if raw.lstrip().startswith("#"):
            section = raw.lstrip().lstrip("#").strip() or section
            continue
        m = re.match(r"^\s*[-*]\s+\[( |x|X)\]\s*(.*)$", raw)
        if m:
            out.append((i, section, m.group(1).lower() == "x", m.group(2).strip()))
    return out


def classify_unchecked(text: str) -> str:
    """未勾行 → 四标分类:候令/候窗=合法悬置,其余(含显式「欠账」)=欠账。"""
    if TAG_PENDING_USER in text:
        return TAG_PENDING_USER
    if TAG_PENDING_WINDOW in text:
        return TAG_PENDING_WINDOW
    return TAG_DEBT


def find_tmp_evidence(extra: list[Path]) -> list[str]:
    """/tmp 顶层模式命中 + 显式声明且仍存在的取证位。"""
    hits = [p.name for p in TMP.iterdir() if EVIDENCE_NAME_PAT.search(p.name)] if TMP.exists() else []
    hits += [str(e) for e in extra if e.exists()]
    return sorted(set(hits))


def git_lines(*args: str) -> list[str]:
    r = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True)
    return [l for l in r.stdout.splitlines() if l.strip()] if r.returncode == 0 else []


def pgrep_pids(pattern: str) -> list[str]:
    r = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    return r.stdout.split()


def run_checks(task: str | None, evidence: list[Path]) -> dict:
    checks: list[dict] = []

    def add(name: str, status: str, detail: str = "") -> None:
        checks.append({"check": name, "status": status, "detail": detail})

    # ① 任务档对拍
    if not task:
        add("①任务档对拍", "skip", "未指定 --task(只查②③④)")
    else:
        impl = find_task_implement(task)
        if impl is None:
            add("①任务档对拍", "red", f"任务档不存在:{task}(活跃区与 archive/* 均未命中)")
        else:
            rows = parse_ledger(impl.read_text(encoding="utf-8"))
            unchecked = [(n, sec, t) for n, sec, done, t in rows if not done]
            if not rows:
                add("①任务档对拍", "warn", f"{impl.name} 零 checkbox(纯散文档,语义判断走人工)")
            elif not unchecked:
                add("①任务档对拍", "green", f"{len(rows)} 项全勾")
            else:
                pend_user = [t for _, _, t in unchecked if classify_unchecked(t) == TAG_PENDING_USER]
                pend_win = [t for _, _, t in unchecked if classify_unchecked(t) == TAG_PENDING_WINDOW]
                debt = [(n, sec, t) for n, sec, t in unchecked if classify_unchecked(t) == TAG_DEBT]
                parts = []
                if debt:
                    parts.append(f"欠账{len(debt)}:" + ";".join(f"L{n}[{sec}] {t[:40]}" for n, sec, t in debt[:6]))
                if pend_user:
                    parts.append(f"候令{len(pend_user)}(等用户令)")
                if pend_win:
                    parts.append(f"候窗{len(pend_win)}(等物理窗口)")
                add("①任务档对拍", "red" if debt else "warn", " | ".join(parts) or "全部悬置已标注")

    # ② git 账面
    dirty = git_lines("status", "--porcelain")
    add("②git账面·工作树", "green" if not dirty else "red",
        "" if not dirty else f"{len(dirty)} 件未归账:" + ";".join(d[:60] for d in dirty[:6]))
    if git_lines("rev-parse", "--abbrev-ref", "@{u}"):
        unpushed = git_lines("log", "@{u}..HEAD", "--oneline")
        add("②git账面·未push", "green" if not unpushed else "warn",
            "" if not unpushed else f"{len(unpushed)} 笔候令(push 按用户令):" + ";".join(u[:50] for u in unpushed[:5]))
    else:
        add("②git账面·未push", "warn", "无上游分支,未查 push")

    # ③ 易失证据回收
    ev = find_tmp_evidence(evidence)
    add("③易失证据回收", "green" if not ev else "red",
        "" if not ev else "临时位残留(重启即丢):" + ";".join(ev[:8]))

    # ④ 资源收摊
    eng = pgrep_pids(ENGINE_MARK)
    add("④资源收摊·引擎", "green" if not eng else "red",
        "" if not eng else f"引擎未收摊 pid={','.join(eng)}(自起引擎干完即停)")
    app = pgrep_pids(APP_MARK)
    add("④资源收摊·App", "green" if not app else "warn",
        "" if not app else f"漫影 App 在跑 pid={','.join(app)}(用户自开则忽略;自起则收)")

    verdict = "red" if any(c["status"] == "red" for c in checks) else (
        "warn" if any(c["status"] == "warn" for c in checks) else "green")
    return {"verdict": verdict, "repo": str(REPO), "task": task, "checks": checks}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", help="任务目录名(如 10-04-chinese-negative-cfg4),查①任务档对拍")
    parser.add_argument("--evidence", type=Path, action="append", default=[],
                        help="显式声明的临时取证位(可反复传;仍存在=红)")
    parser.add_argument("--json", action="store_true", help="仅输出 JSON(workflow 收尾 phase 断言用)")
    opts = parser.parse_args()
    report = run_checks(opts.task, opts.evidence)
    if opts.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        icon = {"green": "✅", "warn": "🟡", "red": "🔴", "skip": "⏭️"}
        for c in report["checks"]:
            line = f'{icon[c["status"]]} {c["check"]}' + (f' :: {c["detail"]}' if c["detail"] else "")
            print(line)
        print(f'结论:{report["verdict"]} → ' + ("可称收官" if report["verdict"] != "red" else "只能称阶段边界,逐红项清账后复跑"))
    return 2 if report["verdict"] == "red" else 0


if __name__ == "__main__":
    sys.exit(main())
