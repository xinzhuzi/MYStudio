#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
P3 跨章连贯性层 —— 抽取每章「## 剧情梗概」,按卷窗口(默认100章/卷)逐卷调用 API 查:
开头承接断裂 / 人物称呼与设定漂移 / 集末钩子未兑现 / 时间线与世界观矛盾。
输出 <out-root>/coherence/vol-NN.md + summary.tsv;幂等(已有卷文件跳过)。

用法:
    python3 critic_coherence.py --drama <剧本目录> --out-root <产出根> [--range A-B] \
        [--window 100] [--model high] [--dry]
    --dry 只抽梗概不调 API(连通性自检用)。
仅依赖标准库 + screenplay_critic 的 call_api。
"""
import argparse
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from screenplay_critic import DEFAULT_KEY, MODELS, call_api  # noqa: E402

COHERENCE_PROMPT = """你是一名连续剧连贯性审校。输入是按章号顺序排列的多章剧情梗概(每行「[章号] 梗概」)。
只查以下四类跨章问题,每条必须有梗概原文作依据,禁止臆测:
① 承接断裂:上一章结尾与本章开头接不上(场景/人物/事件跳变无交代);
② 称谓与设定漂移:同一人物/势力/规则的名称或设定跨章不一致;
③ 钩子未兑现:上章集末钩子在本章(或随后两章内,若在窗口内)完全无下文;
④ 时间线/世界观矛盾:时序、地理、力量体系前后打架。
输出中文 markdown,每条格式:
- [类型] 章 A(-B) — 发现 — 依据(短引梗概原文)
四类都没有就明说「本卷未发现四类问题」。不许编问题凑数。"""


def extract_synopsis(path: str) -> str:
    """取「## 剧情梗概」节:从标题行之后到下一节(## 或 场次行 N-N)之前。"""
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    out, in_sec = [], False
    for line in lines:
        s = line.rstrip("\n")
        if s.strip() == "## 剧情梗概":
            in_sec = True
            continue
        if in_sec:
            if s.startswith("#") or re.match(r"^\d{1,4}-\d{1,3}\s", s):
                break
            if s.strip():
                out.append(s.strip())
    return "".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description="P3 跨章连贯性:梗概分卷审校")
    ap.add_argument("--drama", required=True, help="剧本目录")
    ap.add_argument("--out-root", required=True, help="产出根目录(与 --batch 一致)")
    ap.add_argument("--range", dest="rng", default="1-4125", help="章范围 A-B(默认 1-4125)")
    ap.add_argument("--window", type=int, default=100, help="每卷章数(默认 100)")
    ap.add_argument("--model", choices=sorted(MODELS), default="high")
    ap.add_argument("--dry", action="store_true", help="只抽梗概不调 API")
    args = ap.parse_args()

    lo, _, hi = args.rng.partition("-")
    lo_i, hi_i = int(lo), int(hi or lo)
    coh_dir = os.path.join(args.out_root, "coherence")
    os.makedirs(coh_dir, exist_ok=True)
    api_key = os.environ.get("CRITIC_API_KEY") or os.environ.get("ZHIPU_API_KEY") or DEFAULT_KEY

    # 逐卷处理
    vol_idx = 0
    done, skipped, empty = 0, 0, 0
    for w_lo in range(lo_i, hi_i + 1, args.window):
        vol_idx += 1
        w_hi = min(w_lo + args.window - 1, hi_i)
        vol_file = os.path.join(coh_dir, f"vol-{vol_idx:02d}.md")
        if os.path.isfile(vol_file) and os.path.getsize(vol_file) > 0:
            skipped += 1
            continue
        # 抽梗概(章号对齐到实际文件)
        entries = []
        for n in range(w_lo, w_hi + 1):
            path = os.path.join(args.drama, f"chapter-{n:03d}_漫剧.md")
            if not os.path.isfile(path):
                continue
            syn = extract_synopsis(path)
            if not syn:
                empty += 1
                syn = "(本章节缺「## 剧情梗概」,记占位)"
            entries.append(f"[{n:04d}] {syn}")
        if not entries:
            print(f"[卷{vol_idx:02d}] {w_lo}-{w_hi} 无章节文件,跳过", flush=True)
            continue
        if args.dry:
            print(f"[卷{vol_idx:02d}] {w_lo}-{w_hi} 抽得 {len(entries)} 段梗概(前80字):{entries[0][:80]}", flush=True)
            done += 1
            continue
        user = f"以下是第 {w_lo}–{w_hi} 章的剧情梗概,请做连贯性审校:\n\n" + "\n".join(entries)
        print(f"[卷{vol_idx:02d}] {w_lo}-{w_hi} 共{len(entries)}章,审校中…", flush=True)
        try:
            report, _retries = call_api(api_key, MODELS[args.model], user, timeout=600)
        except Exception as e:  # noqa: BLE001 单卷失败不塌整役,记录后继续
            print(f"[卷{vol_idx:02d}] 失败:{e}", flush=True)
            continue
        header = (
            f"# 连贯性卷报 vol-{vol_idx:02d}(章 {w_lo}-{w_hi})\n\n"
            f"- 模型:`{MODELS[args.model]}`\n- 生成时间:{time.strftime('%Y-%m-%d %H:%M:%S')}\n- 输入:{len(entries)} 段梗概\n\n---\n\n"
        )
        with open(vol_file, "w", encoding="utf-8") as f:
            f.write(header + report + "\n")
        with open(os.path.join(coh_dir, "summary.tsv"), "a", encoding="utf-8") as f:
            f.write(f"vol-{vol_idx:02d}\t{w_lo}-{w_hi}\t{len(entries)}\t{time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        done += 1
        print(f"[卷{vol_idx:02d}] 完成 → {vol_file}", flush=True)
        time.sleep(2)
    print(f"SUMMARY-Coherence vols_done={done} skipped={skipped} empty_synopsis={empty} dry={args.dry}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
