#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
P2-P4 全量战役编排器 —— 无人值守链:9 波全量评判(逐波 --batch + 引文回查)→ P3 连贯性 42 卷 → P4 总报告。
幂等:每波/每卷/每章均可断点续跑;单波失败不塌整役(记入 campaign.log,链尾统一补跑一轮)。

用法(发车由主会话在试产门绿后执行,nohup 后台):
    nohup python3 apps/build/scripts/critic_campaign.py \
        --drama "/Users/zhengbingjin/Project/IP/MA/novel/drama" \
        --out-root apps/output/daojie-critique-1030 --model high \
        >> apps/output/daojie-critique-1030/campaign.log 2>&1 &

    python3 critic_campaign.py --status --out-root apps/output/daojie-critique-1030   # 只看进度
"""
import argparse
import glob
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CRITIC = os.path.join(HERE, "screenplay_critic.py")
CITE = os.path.join(HERE, "critic_citation_check.py")
COH = os.path.join(HERE, "critic_coherence.py")
AGG = os.path.join(HERE, "critic_aggregate.py")
DRAMA_DEFAULT = "/Users/zhengbingjin/Project/IP/MA/novel/drama"
WAVES = [(1, 500), (501, 1000), (1001, 1500), (1501, 2000), (2001, 2500),
         (2501, 3000), (3001, 3500), (3501, 4000), (4001, 4125)]
SUMMARY_RE = re.compile(r"SUMMARY done=(\d+) new=(\d+) skip=(\d+) fail=(\d+)")


def log(msg: str) -> None:
    print(f"[{time.strftime('%m-%d %H:%M:%S')}] {msg}", flush=True)


def run_tool(args_list, timeout_s: int) -> subprocess.CompletedProcess:
    """跑一个子工具,超时不杀链(超时波记失败继续)。"""
    try:
        return subprocess.run([sys.executable, *args_list], capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired as e:
        return subprocess.CompletedProcess(args_list, returncode=124, stdout=str(e.stdout or ""), stderr=f"TIMEOUT after {timeout_s}s")


def tail(text: str, n: int = 400) -> str:
    return text.strip().splitlines()[-5:] if text and text.strip() else ["(无输出)"]


def failed_eps_in(out_root: str, lo: int, hi: int):
    """failures.tsv 里落在 [lo,hi] 的章号(含历史行,重跑幂等无害)。"""
    path = os.path.join(out_root, "failures.tsv")
    eps: list = []
    if not os.path.isfile(path):
        return eps
    with open(path, encoding="utf-8") as f:
        next(f, None)
        for line in f:
            c = line.split("\t")
            if c and c[0].strip().isdigit() and lo <= int(c[0]) <= hi:
                eps.append(c[0].strip())
    return sorted(set(eps))


def phase_p2(drama: str, out_root: str, model: str) -> int:
    fails = []
    for i, (lo, hi) in enumerate(WAVES, 1):
        log(f"== P2 波{i}/9 章{lo}-{hi} 发车 ==")
        r = run_tool([CRITIC, drama, "--batch", "--range", f"{lo}-{hi}", "--model", model, "--out-root", out_root], timeout_s=11 * 3600)
        m = SUMMARY_RE.search(r.stdout or "")
        log(f"波{i} batch exit={r.returncode} SUMMARY={m.group(0) if m else '(无)'}")
        if m and int(m.group(4)) > 0:
            for line in tail(r.stdout):
                log(f"  | {line}")
        if r.returncode != 0:
            log(f"波{i} batch 失败:exit={r.returncode}\n  stderr尾:{'\n  '.join(tail(r.stderr))}")
            fails.append((lo, hi))
            continue
        c = run_tool([CITE, out_root], timeout_s=600)
        log(f"波{i} 引文回查 exit={c.returncode} 尾:{tail(c.stdout, 1)[0]}")
        # 散点失败章(batch exit=0 但个别章落账)补评一轮——API 闪断期必然出现,不补则留缺口
        missing = failed_eps_in(out_root, lo, hi)
        if missing:
            log(f"波{i} 散点失败 {len(missing)} 章,补评一轮")
            r2 = run_tool([CRITIC, drama, "--batch", "--range", f"{lo}-{hi}", "--model", model, "--out-root", out_root], timeout_s=11 * 3600)
            m2 = SUMMARY_RE.search(r2.stdout or "")
            log(f"波{i} 补评 exit={r2.returncode} SUMMARY={m2.group(0) if m2 else '(无)'}")
            if r2.returncode == 0:
                run_tool([CITE, out_root], timeout_s=600)
        time.sleep(30)
    if fails:
        log(f"P2 收尾:失败波 {len(fails)} 个,统一补跑一轮")
        for lo, hi in fails:
            r = run_tool([CRITIC, drama, "--batch", "--range", f"{lo}-{hi}", "--model", model, "--out-root", out_root], timeout_s=11 * 3600)
            m = SUMMARY_RE.search(r.stdout or "")
            log(f"补跑 {lo}-{hi} exit={r.returncode} SUMMARY={m.group(0) if m else '(无)'}")
            if r.returncode == 0:
                run_tool([CITE, out_root], timeout_s=600)
    # 终扫:全库幂等补齐任何缺章(4125/4125 的硬保证)
    log("P2 收尾:全库 1-4125 幂等终扫(补齐任何缺章)")
    r = run_tool([CRITIC, drama, "--batch", "--range", "1-4125", "--model", model, "--out-root", out_root], timeout_s=12 * 3600)
    m = SUMMARY_RE.search(r.stdout or "")
    log(f"终扫 exit={r.returncode} SUMMARY={m.group(0) if m else '(无)'}")
    if r.returncode == 0:
        run_tool([CITE, out_root], timeout_s=900)
    return r.returncode


def phase_p3(drama: str, out_root: str, model: str) -> int:
    log("== P3 连贯性 42 卷发车 ==")
    r = run_tool([COH, "--drama", drama, "--out-root", out_root, "--range", "1-4125", "--window", "100", "--model", model], timeout_s=6 * 3600)
    log(f"P3 exit={r.returncode} 尾:{'\n'.join(tail(r.stdout, 3))}")
    return r.returncode


def phase_p4(out_root: str) -> int:
    log("== P4 汇总总报告 ==")
    r = run_tool([AGG, "--out-root", out_root], timeout_s=600)
    log(f"P4 exit={r.returncode} 尾:{'\n'.join(tail(r.stdout, 2))}")
    return r.returncode


def status(out_root: str) -> None:
    idx = os.path.join(out_root, "index.tsv")
    rows = 0
    if os.path.isfile(idx):
        with open(idx, encoding="utf-8") as f:
            rows = sum(1 for l in f if l.strip()) - 1
    vols = len(glob.glob(os.path.join(out_root, "coherence", "vol-*.md")))
    rep = len(glob.glob(os.path.join(out_root, "reports", "chapter-*.md")))
    log(f"STATUS index行={rows} 报告md={rep}/4125 连贯性卷={vols}/42 总报告={'有' if os.path.isfile(os.path.join(out_root, '00-总报告.md')) else '无'}")


def main() -> int:
    ap = argparse.ArgumentParser(description="P2-P4 全量战役编排(幂等,可断点续跑)")
    ap.add_argument("--drama", default=DRAMA_DEFAULT)
    ap.add_argument("--out-root", required=True)
    ap.add_argument("--model", choices=["high", "medium", "low"], default="high")
    ap.add_argument("--phases", default="p2,p3,p4", help="如 p2,p3,p4 或只跑 p3")
    ap.add_argument("--status", action="store_true", help="只报进度不干活")
    args = ap.parse_args()

    if args.status:
        status(args.out_root)
        return 0

    log(f"全量战役发车 drama={args.drama} out_root={args.out_root} model={args.model} phases={args.phases}")
    phases = [p.strip() for p in args.phases.split(",") if p.strip()]
    rc = 0
    if "p2" in phases:
        rc |= phase_p2(args.drama, args.out_root, args.model)
    # 缺章防跑闸:报告不足 4100 时 P3/P4 不跑(防令牌/网络故障期出早产总报告;恢复后重发本编排器即幂等续全)
    rep_n = len(glob.glob(os.path.join(args.out_root, "reports", "chapter-*.md")))
    if ("p3" in phases or "p4" in phases) and rep_n < 4100:
        log(f"缺章防跑闸:报告仅 {rep_n}/4125——P3/P4 暂不跑;令牌/网络恢复后重发本编排器即可续全(幂等)")
        rc |= 1
    else:
        if "p3" in phases:
            rc |= phase_p3(args.drama, args.out_root, args.model)
        if "p4" in phases:
            rc |= phase_p4(args.out_root)
    status(args.out_root)
    log(f"全量战役收车 exit={rc}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
