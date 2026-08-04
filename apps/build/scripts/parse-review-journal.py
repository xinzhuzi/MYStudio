#!/usr/bin/env python3
"""Parse workflow journal.jsonl, extract structured review findings + verify verdicts,
emit a consolidated markdown report. No AI in the loop."""
import json, sys, os
from collections import defaultdict

JDIR = sys.argv[1] if len(sys.argv) > 1 else \
  "/Users/zhengbingjin/.claude/projects/-Users-zhengbingjin-Project-Github-MYStudio/a175aac5-5d3c-487e-b7ea-2bd990c17cbc/subagents/workflows/wf_a3c9ef02-727"
OUT = sys.argv[2] if len(sys.argv) > 2 else \
  "/Users/zhengbingjin/Project/Github/MYStudio/.trellis/tasks/08-04-artifact-output-management/research/plan-adversarial-review.md"

jpath = os.path.join(JDIR, "journal.jsonl")
rows = []
with open(jpath, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except Exception:
            pass

# Each journal entry: find the agent() return value (structured payload).
# We look for entries that carry a label or a result with findings/verdicts.
reviews = {}   # dimension -> {findings:[...]}
verdicts = {}  # (dimension, id) -> verdict dict
labels = {}    # agentId -> label
errors = []

def walk(obj):
    """Recursively find dicts with keys 'findings' or 'verdicts'."""
    found = []
    if isinstance(obj, dict):
        if "findings" in obj and isinstance(obj["findings"], list):
            found.append(("findings", obj))
        if "verdicts" in obj and isinstance(obj["verdicts"], list):
            found.append(("verdicts", obj))
        for v in obj.values():
            found.extend(walk(v))
    elif isinstance(obj, list):
        for v in obj:
            found.extend(walk(v))
    return found

def infer_dim(label):
    if not label:
        return None
    for d in ["contract-consistency","transaction-correctness","slice-ordering","safety-boundary","testability-fixture"]:
        if d in label:
            return d
    # from verify label format verify:DIM:ID
    if label.startswith("verify:") or label.startswith("review:"):
        parts = label.split(":")
        if len(parts) >= 2:
            return parts[1]
    return None

# collect structured results per agent
per_agent = {}  # agentId -> list of (kind, payload)
for r in rows:
    aid = r.get("agentId") or r.get("agent_id")
    lbl = r.get("label") or r.get("meta",{}).get("label") if isinstance(r.get("meta"),dict) else None
    if lbl and aid:
        labels[aid] = lbl
    res = r.get("result") or r.get("value") or r.get("return")
    if res is None:
        continue
    if isinstance(res, str):
        try:
            res = json.loads(res)
        except Exception:
            res = None
    if res is None:
        continue
    found = walk(res)
    if found:
        per_agent.setdefault(aid, []).extend(found)
    if r.get("error") or r.get("status") == "error":
        errors.append({"agentId": aid, "label": lbl, "error": str(r.get("error"))[:300]})

# Map findings by dimension (review agents) and verdicts by id (verify agents)
findings_by_dim = defaultdict(list)
verdict_by_id = {}
for aid, items in per_agent.items():
    lbl = labels.get(aid, "")
    dim = infer_dim(lbl)
    for kind, payload in items:
        if kind == "findings":
            for f in payload["findings"]:
                f.setdefault("_dim", dim or f.get("dimension"))
                findings_by_dim[f["_dim"]].append(f)
        elif kind == "verdicts":
            for v in payload["verdicts"]:
                vid = v.get("id")
                if vid:
                    verdict_by_id.setdefault(vid, []).append((dim, v))

# Dedup verdicts: keep the one with highest confidence / isReal precedence
CONF_RANK = {"high":3,"medium":2,"low":1}
def pick_verdict(vs):
    def key(t):
        v = t[1]
        return (1 if v.get("isReal") else 0, CONF_RANK.get(v.get("confidence","low"),0))
    vs_sorted = sorted(vs, key=key, reverse=True)
    return vs_sorted[0]

SEV_ORDER = {"critical":0,"high":1,"medium":2,"low":3}

# Build confirmed/refuted
all_findings = []
for dim, fs in findings_by_dim.items():
    for f in fs:
        fid = f.get("id")
        v = None
        if fid and fid in verdict_by_id:
            v = pick_verdict(verdict_by_id[fid])[1]
        f["_verdict"] = v
        f["_dim"] = dim
        all_findings.append(f)

# A finding is "confirmed" if it has a verdict with isReal True.
# A finding with NO verdict means its verify agent failed (429) -> mark UNVERIFIED.
confirmed = [f for f in all_findings if f.get("_verdict") and f["_verdict"].get("isReal")]
refuted = [f for f in all_findings if f.get("_verdict") and not f["_verdict"].get("isReal")]
unverified = [f for f in all_findings if not f.get("_verdict")]

confirmed.sort(key=lambda f:(SEV_ORDER.get(f.get("severity","low"),9), f["_dim"] or "", f.get("id","")))
refuted.sort(key=lambda f:(f.get("id","")))
unverified.sort(key=lambda f:(SEV_ORDER.get(f.get("severity","low"),9), f["_dim"] or "", f.get("id","")))

def fmt_finding(f, with_verdict=True):
    out = []
    out.append(f"### {f.get('id','?')} — {f.get('title','(no title)')}")
    meta = f"- **severity**: {f.get('severity','?')} | **dimension**: {f.get('_dim','?')}"
    if f.get("where"):
        meta += f" | **where**: {f.get('where')}"
    out.append(meta)
    out.append(f"**problem**: {f.get('problem','')}")
    if with_verdict and f.get("_verdict"):
        v = f["_verdict"]
        out.append(f"**verdict**: {'REAL' if v.get('isReal') else 'REFUTED'} (confidence: {v.get('confidence','?')})")
        if v.get("reasoning"):
            out.append(f"- reasoning: {v['reasoning']}")
        fix = v.get("refinedFix") or f.get("fix")
        if fix:
            out.append(f"**fix**: {fix}")
    else:
        if f.get("fix"):
            out.append(f"**proposed fix**: {f.get('fix')}")
    return "\n".join(out)

lines = []
lines.append("# 规划对抗性审查报告(动态工作流,2026-08-04)")
lines.append("")
lines.append(f"> 5 维度审查 × 逐条对抗验证。源 journal: `{os.path.basename(JDIR)}/journal.jsonl`。")
lines.append(f"> 审查产出 {len(all_findings)} 条 findings;{len(confirmed)} 条经对抗验证为 REAL,**{len(unverified)} 条因 API 限流未完成验证(需人工复核或重跑)**,{len(refuted)} 条被反驳。")
lines.append("")
lines.append("## 摘要(按严重度,REAL 且已验证)")
sev_counts = defaultdict(int)
for f in confirmed:
    sev_counts[f.get("severity","low")] += 1
lines.append("")
lines.append(f"- critical: {sev_counts['critical']}")
lines.append(f"- high: {sev_counts['high']}")
lines.append(f"- medium: {sev_counts['medium']}")
lines.append(f"- low: {sev_counts['low']}")
lines.append(f"- UNVERIFIED(限流,需复核): {len(unverified)}")
lines.append("")

if confirmed:
    lines.append("## ✅ 已确认 REAL(必须 task.py start 前修)")
    lines.append("")
    for f in confirmed:
        lines.append(fmt_finding(f))
        lines.append("")

if unverified:
    lines.append("## ⚠️ 未验证(API 限流,verify agent 失败)")
    lines.append("")
    lines.append("> 这些 findings 的 review 通过了,但对抗验证 agent 因 429 限流失败。**不能假定它们为真**——按严重度人工抽查,或限流恢复后重跑只验证这些 id。")
    lines.append("")
    for f in unverified:
        lines.append(fmt_finding(f, with_verdict=False))
        lines.append("")

if refuted:
    lines.append("## ❌ 已反驳(不需修)")
    lines.append("")
    for f in refuted:
        lines.append(fmt_finding(f))
        lines.append("")

if errors:
    lines.append("## Agent 错误记录(限流)")
    lines.append("")
    for e in errors[:20]:
        lines.append(f"- `{e.get('label','?')}`: {e.get('error','')[:200]}")
    lines.append("")

with open(OUT, "w", encoding="utf-8") as fp:
    fp.write("\n".join(lines))

print(f"wrote {OUT}")
print(f"findings={len(all_findings)} confirmed={len(confirmed)} refuted={len(refuted)} unverified={len(unverified)} errors={len(errors)}")
for sev in ["critical","high","medium","low"]:
    print(f"  confirmed {sev}: {sev_counts[sev]}")
