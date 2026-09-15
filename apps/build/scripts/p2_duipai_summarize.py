#!/usr/bin/env python
"""P2 对拍结果汇总器:读 results_master.json 输出报告用 markdown 表。

用法: p2_duipai_summarize.py [--results-dir /tmp/p2_duipai] [--stage p2a|p2b-assets|p2b-downstream|all]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def fmt_call(cid: str, r: dict) -> str:
    if r.get("status") != "ok":
        errs = "; ".join(a.get("error", "")[:80] for a in r.get("attempts", []) if not a.get("ok"))
        return f"| {cid} | {r.get('kind','')} | {r.get('seed','')} | FAIL | — | — | — | {errs} |"
    e = r.get("engine", {})
    outs = r.get("outputs", [])
    path = outs[0]["abs"] if outs else "—"
    return (f"| {cid} | {r.get('kind','')} | {r.get('seed','')} | ok | {r.get('wall_s','—')} | "
            f"{e.get('cpu_max','—')} | {e.get('rss_max_mb','—')} | `{path}` |")


def stage_table(stage: str, data: dict) -> str:
    lines = [f"### {stage} 调用明细",
             "| 调用 | 组 | seed | 状态 | 墙钟s | CPU峰值% | RSS峰值MB | 产物 |",
             "|---|---|---|---|---|---|---|---|"]
    for cid in sorted(k for k in data if k != "_meta"):
        lines.append(fmt_call(cid, data[cid]))
    oks = [r for r in data.values() if r.get("status") == "ok" and r != "_meta"]
    if oks and isinstance(list(data.values())[0], dict):
        walls = [r["wall_s"] for r in oks if "wall_s" in r]
        if walls:
            lines.append(f"\n- 成功 {len(oks)}/{len([k for k in data if k != '_meta'])},墙钟合计 {sum(walls):.0f}s,"
                         f"均值 {sum(walls)/len(walls):.0f}s,最大 {max(walls):.0f}s")
        cpum = [r.get("engine", {}).get("cpu_max") for r in oks if r.get("engine", {}).get("cpu_max") is not None]
        rssm = [r.get("engine", {}).get("rss_max_mb") for r in oks if r.get("engine", {}).get("rss_max_mb") is not None]
        if cpum:
            lines.append(f"- CPU 峰值全程最大 {max(cpum)}%;RSS 峰值全程最大 {max(rssm)}MB" if rssm else "")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results-dir", type=Path, default=Path("/tmp/p2_duipai"))
    ap.add_argument("--stage", default="all")
    args = ap.parse_args()
    master = args.results_dir / "results_master.json"
    data = json.loads(master.read_text())
    stages = [args.stage] if args.stage != "all" else [k for k in data if k != "_meta"]
    for st in stages:
        print(stage_table(st, data.get(st, {})))
        print()


if __name__ == "__main__":
    main()
