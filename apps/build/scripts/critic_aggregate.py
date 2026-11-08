#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
P4 全剧汇总器 —— 由 index.tsv + 各章报告问题行 + 连贯性卷报 + failures.tsv
生成 00-总报告.md:判定分布/分数分布/最低100章榜/P0热区Top50/共性病Top10/修复优先级Top20/连贯性摘要/失败附录。
纯本地零 API,可反复重跑(幂等覆盖输出)。

用法:
    python3 critic_aggregate.py --out-root apps/output/daojie-critique-1030 [--top-low 100]
"""
import argparse
import glob
import os
import re
import sys
import time

DISEASE_LEXICON = [
    "人称", "镜头", "拆镜", "不可拍", "可拍性", "说明腔", "对白", "钩子", "逻辑", "动机",
    "称谓", "现代", "灵气", "语速", "节奏", "孤儿场", "OS", "转场", "时长", "配音", "设定",
]
PROBLEM_RE = re.compile(r"^- \[(P[012])\]\s*(.*)$")


def load_index_rows(path: str):
    rows = []
    if not os.path.isfile(path):
        return rows
    with open(path, encoding="utf-8") as f:
        header = None
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            if header is None:
                header = line.split("\t")
                continue
            c = line.split("\t")
            rows.append(dict(zip(header, c)))
    return rows


def disease_counts(reports_dir: str):
    """扫全部章报告的问题行,按病名词典计数并记样例章。"""
    counts = {k: [0, []] for k in DISEASE_LEXICON}
    problem_total = {"P0": 0, "P1": 0, "P2": 0}
    for md in sorted(glob.glob(os.path.join(reports_dir, "chapter-*.md"))):
        ep = os.path.basename(md)[len("chapter-"):os.path.basename(md).rfind(".")]
        with open(md, encoding="utf-8") as f:
            for line in f:
                m = PROBLEM_RE.match(line.strip())
                if not m:
                    continue
                tag, body = m.group(1), m.group(2)
                problem_total[tag] = problem_total.get(tag, 0) + 1
                for k in counts:
                    if k.lower() in body.lower():
                        counts[k][0] += 1
                        if ep not in counts[k][1] and len(counts[k][1]) < 3:
                            counts[k][1].append(ep)
                        break  # 一行只归一类,防重复计数
    return counts, problem_total


def main() -> int:
    ap = argparse.ArgumentParser(description="P4 全剧汇总报告生成")
    ap.add_argument("--out-root", required=True)
    ap.add_argument("--top-low", type=int, default=100, help="分数最低榜条数(默认100)")
    args = ap.parse_args()

    rows = load_index_rows(os.path.join(args.out_root, "index.tsv"))
    if not rows:
        print("错误:index.tsv 无数据,先跑评判", file=sys.stderr)
        return 2
    for r in rows:
        for k in ("score", "p0", "p1", "p2", "citeRate"):
            try:
                r[k] = float(r.get(k) or 0)
            except ValueError:
                r[k] = 0.0
        r["ep_i"] = int(r.get("ep") or 0)

    counts, problem_total = disease_counts(os.path.join(args.out_root, "reports"))

    # 判定分布
    verdicts = {}
    for r in rows:
        v = r.get("verdict") or "未知"
        verdicts[v] = verdicts.get(v, 0) + 1
    # 分数分布(10分桶)
    buckets = {}
    for r in rows:
        b = int(r["score"] // 10) * 10
        buckets[b] = buckets.get(b, 0) + 1
    # 榜单
    by_score = sorted(rows, key=lambda r: (r["score"], -r["p0"], -r["p1"], r["ep_i"]))
    low_n = by_score[: args.top_low]
    p0_hot = sorted(rows, key=lambda r: (-r["p0"], -r["p1"], r["score"], r["ep_i"]))
    p0_hot = [r for r in p0_hot if r["p0"] > 0][:50]
    repair_rank = sorted(rows, key=lambda r: (r["score"], -3 * r["p0"] - r["p1"], r["ep_i"]))[:20]

    cite_vals = [r["citeRate"] for r in rows if r["citeRate"] > 0]

    out = [f"# 道劫剧本评判·全剧总报告", "",
           f"- 生成时间:{time.strftime('%Y-%m-%d %H:%M:%S')} | 章数:{len(rows)} | 引文真实率均值:{sum(cite_vals) / len(cite_vals):.1f}%(有值{len(cite_vals)}章)" if cite_vals else f"- 生成时间:{time.strftime('%Y-%m-%d %H:%M:%S')} | 章数:{len(rows)} | 引文率:暂无", ""]

    out += ["## 一句话结论", "",
            f"共评 {len(rows)} 章:合理 {verdicts.get('合理', 0)} / 基本合理但需打磨 {verdicts.get('基本合理但需打磨', 0)} / 存在结构性问题 {verdicts.get('存在结构性问题', 0)};"
            f"问题总量 P0={problem_total['P0']} P1={problem_total['P1']} P2={problem_total['P2']};"
            f"最低分章节 {low_n[0]['ep'] if low_n else '-'}({low_n[0]['score']:.0f} 分)" if low_n else "", ""]

    out += ["## 判定分布", "", "| 判定 | 章数 |", "|---|---|"]
    for v, n in sorted(verdicts.items(), key=lambda x: -x[1]):
        out.append(f"| {v} | {n} |")

    out += ["", "## 分数分布", "", "```"]
    for b in sorted(buckets):
        out.append(f"{b:>3}-{b + 9:<3} |{'█' * max(1, round(buckets[b] / max(1, len(rows)) * 100))} {buckets[b]}")
    out += ["```"]

    out += ["", f"## 分数最低 {len(low_n)} 章榜", "", "| 章 | 判定 | 总分 | P0 | P1 | P2 | 引文率 |", "|---|---|---|---|---|---|---|"]
    for r in low_n:
        out.append(f"| {r['ep']} | {r.get('verdict', '')} | {r['score']:.0f} | {r['p0']:.0f} | {r['p1']:.0f} | {r['p2']:.0f} | {r['citeRate']:.0f}% |")

    out += ["", f"## P0 热区章节 Top{len(p0_hot)}", "", "| 章 | 判定 | 总分 | P0 | P1 |", "|---|---|---|---|---|"]
    for r in p0_hot:
        out.append(f"| {r['ep']} | {r.get('verdict', '')} | {r['score']:.0f} | {r['p0']:.0f} | {r['p1']:.0f} |")

    top_diseases = sorted(counts.items(), key=lambda kv: -kv[1][0])[:10]
    out += ["", "## 共性病 Top10(问题行关键词计数)", ""]
    if not any(c[0] for _, c in top_diseases):
        out.append("问题行为零——全库无 P0/P1/P2 记录或报告未落盘。")
    for k, (n, eps) in top_diseases:
        if n == 0:
            continue
        out.append(f"- **{k}** ×{n}(样例章:{','.join(eps)})")

    out += ["", "## 修复优先级 Top20(分数×严重度)", "", "| 章 | 总分 | P0 | P1 | 报告 |", "|---|---|---|---|---|"]
    for r in repair_rank:
        report_name = f"chapter-{r['ep_i']:03d}.md"
        report_path = os.path.join(args.out_root, "reports", report_name)
        report_cell = f"[{report_name}](reports/{report_name})" if os.path.isfile(report_path) else f"报告缺失: {report_name}"
        out.append(f"| {r['ep']} | {r['score']:.0f} | {r['p0']:.0f} | {r['p1']:.0f} | {report_cell} |")

    coh_files = sorted(glob.glob(os.path.join(args.out_root, "coherence", "vol-*.md")))
    out += ["", f"## 跨卷连贯性摘要({len(coh_files)} 卷)", ""]
    if not coh_files:
        out.append("(P3 未运行或未产出卷报——全量评判完成后跑 critic_coherence.py)")
    for vf in coh_files:
        with open(vf, encoding="utf-8") as f:
            text = f.read()
        findings = len(re.findall(r"^- \[", text, flags=re.M))
        out.append(f"- {os.path.basename(vf)}:发现 {findings} 条(详见该卷报)")

    fail_path = os.path.join(args.out_root, "failures.tsv")
    out += ["", "## 失败章附录", ""]
    if os.path.isfile(fail_path):
        with open(fail_path, encoding="utf-8") as f:
            fails = [l.strip() for l in f if l.strip()]
        out.append(f"failures.tsv 共 {len(fails)} 行(去重后为待补评章清单):")
        out += ["```", *fails[:50], "```"]
        if len(fails) > 50:
            out.append("…(仅示前50,全量见 failures.tsv)")
    else:
        out.append("无失败章。")

    out += ["", "---", "", "> 本报告由 critic_aggregate.py 自动生成;修复属后续独立任务,本役零改动剧本。"]

    dest = os.path.join(args.out_root, "00-总报告.md")
    with open(dest, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"总报告已生成:{dest}(章数 {len(rows)}/4125)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
