#!/usr/bin/env python3
"""Dump Acceptance Criteria checkbox lines + task.json summary for given task dirs.

Usage: python3 apps/build/scripts/trellis-ac-dump.py <task-dir-name> [...]
Read-only helper for Trellis archive precheck (A5 AC matrix).
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
TASKS = os.path.normpath(os.path.join(ROOT, ".trellis", "tasks"))


def dump(task_dir: str) -> None:
    path = os.path.join(TASKS, task_dir)
    tj = os.path.join(path, "task.json")
    prd = os.path.join(path, "prd.md")
    print(f"=== {task_dir} ===")
    if os.path.exists(tj):
        with open(tj, encoding="utf-8") as fh:
            data = json.load(fh)
        keep = {k: data.get(k) for k in ("status", "parent", "subtasks", "branch", "scope", "meta", "notes", "commits", "verification") if k in data}
        print("task.json:", json.dumps(keep, ensure_ascii=False))
    if os.path.exists(prd):
        with open(prd, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        in_ac = False
        for i, line in enumerate(lines, 1):
            if re.match(r"^##\s+Acceptance", line):
                in_ac = True
                continue
            if in_ac and line.startswith("## "):
                in_ac = False
            if in_ac and re.match(r"^\s*- \[[ xX]\]", line):
                print(f"  L{i}: {line.strip()}")
    else:
        print("  (no prd.md)")
    files = sorted(os.listdir(path))
    print("  files:", ", ".join(files))


if __name__ == "__main__":
    for name in sys.argv[1:]:
        dump(name)
