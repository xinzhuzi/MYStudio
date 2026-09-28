#!/usr/bin/env python3
"""hygiene 组合门禁段——五件只读 lint 统一编排(只组合现有命令,不复制实现)。

出处:2026-09-28 任务 09-28-process-formalization S4-4c(R5.1/R7.2/R7.3;design §1/§3/§12)。
挂 run-quality-gate.mjs hygiene stage(python-tests 段之后);任一子件 RED → 本段红。

子件与平台表(design §12):
  1. scripts_hygiene.py      顶层日期名 lint            [双平台]
  2. docs_freshness_lint.py  台账核账巡检               [双平台]
  3. file_size_gate.py       文件尺寸门禁(纯 check 态) [双平台]
  4. workflow_graph_lint.py  工作流图 lint              [双平台]
  5. docs_current_audit.py   文档链接/命令/路径审计     [仅 darwin;linux 显式 SKIP]

接线裁定(2026-09-28 落定,证据见任务档执行记录):
  - file_size_gate 先验=纯 check(全文零改写路径,scan 只读;默认态即 check,退出码
    语义=超 HARD 线红)→ 无需补 --check 旗标,直接接线;存量 7 件 HARD 已按脚本自身
    口径「须拆分或登记豁免」登记 file-size-gate-exemptions.json(拆分留待专门任务)。
  - workflow_graph_lint 范围=1_图片/Q2-1图像/ 全域(活跃手术域,7 件现库全绿)。
    全树 68 件实测 33 红(API 格式 11 件=格式不匹配如实报错+社区/官方模板 AABB 遮挡
    与必填槽启发式),PRD 约束「生产工作流 JSON 只读」不可修绿存量——先挂 Q2-1 域,
    扩域待专门清债战役。
  - docs_current_audit 不带 --check-links 接线:严格链检查现库 488 缺链(486 集中在
    docs/prompts/krea2官方/ vendored 第三方 README 快照+2 处活文档债),带旗标=门禁
    恒红;先以报告态接线(审计照跑、报告照落),严格化待 vendored 豁免机制清债另案。

用法:
  python3 hygiene_gate.py            # 跑五件,任一 RED 退出 1
  python3 hygiene_gate.py --json     # 同上,另落报告 apps/output/automation/hygiene-gate-report.json
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REPO = SCRIPTS.parents[2]
REPORT_JSON = REPO / "apps/output/automation/hygiene-gate-report.json"
Q21_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
PY = sys.executable or "python3"


def build_checks(platform: str) -> list[dict]:
    q21_files = sorted(str(p) for p in Q21_DIR.rglob("*.json")) if Q21_DIR.exists() else []
    checks = [
        {"name": "scripts-hygiene", "platforms": {"darwin", "linux"},
         "cmd": [PY, str(SCRIPTS / "scripts_hygiene.py"), "--json"]},
        {"name": "docs-freshness", "platforms": {"darwin", "linux"},
         "cmd": [PY, str(SCRIPTS / "docs_freshness_lint.py"), "--json"]},
        {"name": "file-size", "platforms": {"darwin", "linux"},
         "cmd": [PY, str(SCRIPTS / "file_size_gate.py"), "--json"]},
        {"name": "workflow-graph-lint", "platforms": {"darwin", "linux"},
         "cmd": [PY, str(SCRIPTS / "workflow_graph_lint.py"), *q21_files]},
        {"name": "docs-current-audit", "platforms": {"darwin"},
         "cmd": [PY, str(SCRIPTS / "docs_current_audit.py"),
                 "--output", str(REPO / "apps/output/automation/docs-current-audit.json")]},
    ]
    # 平台表/前置条件落定 skip_reason(仅此处判定,run_gate 只认结果)
    for check in checks:
        reason = ""
        if platform not in check["platforms"]:
            reason = f"{check['name']} 平台表={sorted(check['platforms'])},{platform} 段显式跳过"
        elif check["name"] == "workflow-graph-lint" and not q21_files:
            reason = "Q2-1 工作流域不存在(目录缺失)"
        check["skip_reason"] = reason
    return checks


def _forward_output(text: str, failed: bool, keep_first: int = 15, keep_last: int = 2) -> None:
    """转发子件输出;passed 截头尾防刷屏(file-size 117 行 WARN 实测),failed 全文保留。"""
    lines = text.splitlines()
    if failed or len(lines) <= keep_first + keep_last + 1:
        print(text)
        return
    head = lines[:keep_first]
    tail = lines[-keep_last:]
    print("\n".join(head))
    print(f"……(passed 态截断,共 {len(lines)} 行)")
    print("\n".join(tail))


def run_gate(platform: str, as_json: bool) -> dict:
    results = []
    for check in build_checks(platform):
        name, cmd = check["name"], check["cmd"]
        if check.get("skip_reason"):
            reason = check["skip_reason"]
            print(f"[hygiene] SKIP {name}: {reason}")
            results.append({"name": name, "status": "skipped", "exitCode": None,
                            "durationMs": 0, "reason": reason})
            continue
        print(f"[hygiene] RUN {name}: {' '.join(cmd)}")
        started = time.monotonic()
        proc = subprocess.run(cmd, capture_output=True, text=True)
        duration = int((time.monotonic() - started) * 1000)
        status = "passed" if proc.returncode == 0 else "failed"
        _forward_output((proc.stdout or "").strip(), status == "failed")
        if proc.stderr.strip():
            print(f"[stderr] {proc.stderr.strip()}", file=sys.stderr)
        print(f"[hygiene] {status.upper()} {name} (exit={proc.returncode}, {duration}ms)")
        results.append({"name": name, "status": status, "exitCode": proc.returncode,
                        "durationMs": duration, "command": " ".join(cmd)})
    ok = all(r["status"] != "failed" for r in results)
    return {"ok": ok, "platform": platform, "checks": results, "jsonReport": as_json}


def main(argv: list[str]) -> int:
    as_json = "--json" in argv
    platform = "darwin" if sys.platform == "darwin" else "linux"
    report = run_gate(platform, as_json)
    if as_json:
        REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
        REPORT_JSON.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[hygiene] 报告落 {REPORT_JSON.relative_to(REPO).as_posix()}")
    red = [r["name"] for r in report["checks"] if r["status"] == "failed"]
    print(f"[hygiene] 汇总:{'GREEN' if report['ok'] else 'RED ' + ','.join(red)}"
          f"(子件 {len(report['checks'])} 件,失败 {len(red)})")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
