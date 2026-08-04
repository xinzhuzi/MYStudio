#!/usr/bin/env python3
"""聚合 reverify-7-findings workflow 的 journal.jsonl,输出 7 条 finding 的最终 verdict + 修订建议摘要。"""
import json
import sys
from pathlib import Path
from collections import defaultdict

JOURNAL = Path("/Users/zhengbingjin/.claude/projects/-Users-zhengbingjin-Project-Github-MYStudio/a175aac5-5d3c-487e-b7ea-2bd990c17cbc/subagents/workflows/wf_ba8d51e8-358/journal.jsonl")
OUT = Path("/Users/zhengbingjin/Project/Github/MYStudio/.trellis/tasks/08-04-artifact-output-management/research/plan-reverify-7.md")

FINDINGS_META = {
    "DEP-2": ("high", "Slice 5/6 ordering: deterministic-plan gate depends on Slice 6 transforms?"),
    "CONTR-12": ("medium", "AC 'switching chapter clears selection' has no dedicated step"),
    "DEP-3": ("medium", "Slice 3 gate 'classified OR blockers' is subjective disjunction"),
    "DEP-4": ("medium", "No slice covers Phase 3.3 spec-update for C1/C2/C3 net-new infra"),
    "DEP-5": ("low", "Slice 4 gate 'useful in read-only mode' not objectively verifiable"),
    "DEP-7": ("low", "Slice 1 baseline tests not proven to currently PASS"),
    "VERIF-6": ("low", "Electron main-process test pattern not named in plan"),
}

def main():
    votes = defaultdict(list)
    with JOURNAL.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("type") != "result":
                continue
            val = rec.get("result")
            if not isinstance(val, dict) or "findingId" not in val:
                continue
            votes[val["findingId"]].append(val)

    lines = []
    lines.append("# 7 条未验证 finding 定向重跑结果(2026-08-04)")
    lines.append("")
    lines.append("> 每条 2 个独立 skeptic(视角A 规划完备性 / 视角B 失败场景真实性),共 14 agent,0 error。")
    lines.append("> verdict: 2 票 real = CONFIRMED;0 票 = REFUTED;1 票 = SPLIT。")
    lines.append("")
    counts = {"CONFIRMED": 0, "REFUTED": 0, "SPLIT": 0}
    for fid in ["DEP-2", "CONTR-12", "DEP-3", "DEP-4", "DEP-5", "DEP-7", "VERIF-6"]:
        sev, title = FINDINGS_META[fid]
        vs = votes.get(fid, [])
        reals = sum(1 for v in vs if v.get("isReal"))
        if not vs:
            verdict = "NO_VOTES"
        elif reals == len(vs):
            verdict = "CONFIRMED"
        elif reals == 0:
            verdict = "REFUTED"
        else:
            verdict = "SPLIT"
        counts[verdict] = counts.get(verdict, 0) + 1
        lines.append(f"## {fid} — {verdict} (声称 {sev})")
        lines.append("")
        lines.append(f"**{title}**")
        lines.append("")
        lines.append(f"realVotes: {reals}/{len(vs)}")
        lines.append("")
        for i, v in enumerate(vs, 1):
            lines.append(f"### Vote {i}: isReal={v.get('isReal')} confidence={v.get('confidence')}")
            lines.append("")
            sev_a = v.get("severityAssessment", "")
            if sev_a:
                lines.append(f"**严重度评估**: {sev_a}")
                lines.append("")
            reasoning = v.get("reasoning", "")
            if reasoning:
                lines.append(f"**理由**:")
                lines.append("")
                # 缩进长理由,截断到 ~1500 字符避免爆炸
                r = reasoning if len(reasoning) <= 1600 else reasoning[:1600] + " …[截断]"
                lines.append(r)
                lines.append("")
            fix = v.get("recommendedFix", "")
            if fix and v.get("isReal"):
                lines.append(f"**建议修法**:")
                lines.append("")
                fx = fix if len(fix) <= 1200 else fix[:1200] + " …[截断]"
                lines.append(fx)
                lines.append("")
            refu = v.get("refutationAttempted", "")
            if refu:
                lines.append(f"**对立论证(为何成立/不成立)**:")
                lines.append("")
                rf = refu if len(refu) <= 1200 else refu[:1200] + " …[截断]"
                lines.append(rf)
                lines.append("")
        lines.append("---")
        lines.append("")

    header = []
    header.append("# 7 条未验证 finding 定向重跑结果(2026-08-04)")
    header.append("")
    header.append("> 每条 2 个独立 skeptic(视角A 规划完备性 / 视角B 失败场景真实性),共 14 agent,0 error。")
    header.append("> verdict: 2 票 real = CONFIRMED;0 票 = REFUTED;1 票 = SPLIT。")
    header.append("")
    header.append("## 摘要")
    header.append("")
    header.append(f"- CONFIRMED: {counts.get('CONFIRMED', 0)}")
    header.append(f"- REFUTED: {counts.get('REFUTED', 0)}")
    header.append(f"- SPLIT: {counts.get('SPLIT', 0)}")
    header.append("")
    header.append("## 逐条结论")
    header.append("")
    header.append("| ID | 声称严重度 | verdict | realVotes | 一句话 |")
    header.append("|---|---|---|---|---|")
    for fid in ["DEP-2", "CONTR-12", "DEP-3", "DEP-4", "DEP-5", "DEP-7", "VERIF-6"]:
        sev, title = FINDINGS_META[fid]
        vs = votes.get(fid, [])
        reals = sum(1 for v in vs if v.get("isReal"))
        if not vs:
            verdict = "NO_VOTES"
        elif reals == len(vs):
            verdict = "CONFIRMED"
        elif reals == 0:
            verdict = "REFUTED"
        else:
            verdict = "SPLIT"
        header.append(f"| {fid} | {sev} | {verdict} | {reals}/{len(vs)} | {title[:50]} |")
    header.append("")
    header.append("---")
    header.append("")

    OUT.write_text("\n".join(header + lines[7:]))  # skip the duplicate early header lines
    print(f"written: {OUT}")
    print(f"votes parsed: {sum(len(v) for v in votes.values())}")
    print(f"CONFIRMED={counts.get('CONFIRMED',0)} REFUTED={counts.get('REFUTED',0)} SPLIT={counts.get('SPLIT',0)}")
    for fid in ["DEP-2", "CONTR-12", "DEP-3", "DEP-4", "DEP-5", "DEP-7", "VERIF-6"]:
        vs = votes.get(fid, [])
        reals = sum(1 for v in vs if v.get("isReal"))
        print(f"  {fid}: {reals}/{len(vs)} real")

if __name__ == "__main__":
    main()
