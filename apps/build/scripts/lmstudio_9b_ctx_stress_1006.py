# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
#!/usr/bin/env python3
"""lmstudio_9b_ctx_stress_1006.py — Windows LM Studio 9B 长提示词"饿死"极限压测。

背景(1006):qi21 [4013] 新提示词(教材 3870 字+装配全文+上下文块)下,九入
实弹 952s(16k 窗贴边),疑"结构性饿死"。本脚本在真机量三条曲线:
  1) 真实新提示词的 prompt_tokens(与 [4013] 组装逐字同构);
  2) prefill 速度(prompt 越长,首 token 前的等待);
  3) decode 速度(tok/s;KV cache 溢出/offload 时崩)。
8192 窗(现状)与 32768 窗(lms load -c 32768 重载)各跑一轮,外加深观察
max_tokens=12000 产线默认预算在两窗下的行为(超窗/截断/空正文)。

用法:
  python3 lmstudio_9b_ctx_stress_1006.py probe                 # 真实提示词 prompt_tokens 校准
  python3 lmstudio_9b_ctx_stress_1006.py bench --fill 8000     # 填充到 ~8k prompt_tokens 档
  python3 lmstudio_9b_ctx_stress_1006.py fullshot              # 真实提示词 + max_tokens=12000 产线弹
  档位循环(32k 窗轮):bench --fill 8000 / 12000 / 16000 / 24000

环境变量:LMS_BASE(默认 http://192.168.0.101:1234)、LMS_MODEL(默认 9B id)。
"""
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request
from pathlib import Path

BASE = os.environ.get("LMS_BASE", "http://192.168.0.101:1234")
MODEL = os.environ.get("LMS_MODEL", "qwen3.5-9b-uncensored-hauhaucs-aggressive")
REPO = Path(__file__).resolve().parents[3]
BASES_JSON = (REPO / "apps/frontend/assets/studio-manuals/art_skills/"
              "daojie_ink_guofeng/json/qi21_bases.json")

# 禁 env 代理(Clash 截流局域网之防,同 curl --noproxy '*')
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def post(payload: dict, timeout: int = 900) -> tuple[dict, float]:
    req = urllib.request.Request(
        BASE + "/v1/chat/completions", data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.perf_counter()
    raw = _opener.open(req, timeout=timeout).read()
    return json.loads(raw), time.perf_counter() - t0


def build_payload(fill_chars: int = 0, max_tokens: int = 384, nonce: bool = False) -> dict:
    """与 my_qi21_api_pe.py 组装同构:system=教材+/no_think;user=装配三层+ctx块。"""
    data = json.loads(BASES_JSON.read_text(encoding="utf-8"))
    textbook = (data.get("expand_instruction") or {}).get("system_prompt_zh") or ""
    style = (data.get("lock_layer") or {}).get("positive_text") or ""
    lock_neg = (data.get("lock_layer") or {}).get("negative_text") or ""
    types = data.get("types") or []
    # 型底座:挑人物立绘类(positive 最长的立绘型),与实弹案一致
    cands = [t for t in types if isinstance(t, dict) and t.get("positive_text")]
    base_type = max(cands, key=lambda t: len(t.get("positive_text", "")))
    base_pos, base_neg = base_type["positive_text"], base_type.get("negative_text", "")
    subj = ("玄青道袍的年轻修士立于断崖古松之下,左手按剑,负手望向天际压城的"
            "墨色雷云,衣袂与发带被罡风掀起。")
    direct = f"{subj}\n{base_pos}\n{style}"
    neg_tokens, seen = [], set()
    for src in (base_neg, lock_neg):
        for tok in (x.strip() for x in __import__("re").split(r"[,，\n]", src) if x.strip()):
            if tok not in seen:
                seen.add(tok)
                neg_tokens.append(tok)
    fill = ""
    if fill_chars > 0:
        unit = ("补充上下文材料:山门石阶三百级,两侧铁链悬灯,灯罩青铜饕餮纹,"
                "阶前石兽风化残缺;远景云海翻涌,墨色浓淡分五层,近景松针根根"
                "可数,剑穗朱砂色微褪。")
        reps = max(0, fill_chars // len(unit) + (1 if fill_chars % len(unit) else 0))
        fill = "\n" + "\n".join(f"(上下文材料{i + 1}){unit}" for i in range(reps))
    ctx = ["--- 画面上下文(色卡用词与画风基调参考) ---",
           "[正稿结构] 主体句\n型底座\n美术风格底座 三层(基底即上文)",
           "[负面词清单] " + ", ".join(neg_tokens) +
           "(逐条精炼合并去重后写进 negative_prompt,可补通用负面,不丢条目)",
           "[画幅] 1024×1024(按此纵横比组织画面描述)",
           "[透明] 关:常规成图"]
    if nonce:
        # 防前缀缓存:产线每发主体句不同,此行模拟「本发唯一」
        ctx.append(f"[批次] {time.time_ns():x}")
    user = direct + fill + "\n\n" + "\n".join(ctx) + "\n/no_think"
    return {"model": MODEL,
            "messages": [{"role": "system", "content": textbook + "\n/no_think"},
                         {"role": "user", "content": user}],
            "temperature": 0.7, "max_tokens": max_tokens,
            "chat_template_kwargs": {"enable_thinking": False}}


def report(label: str, resp: dict, wall: float, prefill_s: float | None) -> None:
    u = resp.get("usage") or {}
    pt, ct = u.get("prompt_tokens", 0), u.get("completion_tokens", 0)
    ch = (resp.get("choices") or [{}])[0]
    fin = ch.get("finish_reason")
    msg = ch.get("message") or {}
    content, reasoning = msg.get("content") or "", str(msg.get("reasoning_content") or "")
    decode_s = max(wall - (prefill_s or 0), 0.01)
    line = (f"[{label}] prompt={pt}tok completion={ct}tok "
            f"(思考{u.get('completion_tokens_details', {}).get('reasoning_tokens', 0)}) "
            f"finish={fin} 墙钟={wall:.1f}s")
    if prefill_s is not None:
        line += f" prefill≈{prefill_s:.1f}s({pt / max(prefill_s, 0.01):.0f}tok/s)"
        if ct:
            line += f" decode≈{ct / decode_s:.1f}tok/s"
    print(line)
    print(f"    正文{len(content)}字/思考{len(reasoning)}字 | 正文头80:{content[:80]!r}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe")
    b = sub.add_parser("bench")
    b.add_argument("--fill", type=int, default=0, help="填充到目标 prompt_tokens(0=真实提示词)")
    b.add_argument("--max-tokens", type=int, default=384)
    b.add_argument("--fresh", action="store_true", help="user 尾加 nonce 防前缀缓存(冷测)")
    sub.add_parser("fullshot").add_argument("--fresh", action="store_true")
    args = ap.parse_args()

    if args.cmd == "probe":
        # 先 max_tokens=1 量 prompt_tokens 与纯 prefill
        pl = build_payload(0, max_tokens=1)
        r1, w1 = post(pl, timeout=600)
        report("probe(真实新提示词, prefill-only)", r1, w1, None)
        return

    if args.cmd == "bench":
        target = args.fill
        fill_chars = 0
        if target:
            # 校准:先发一发拿基线 prompt_tokens,再按中文字≈token 估填充,迭代两轮
            t0 = time.perf_counter()
            r0, _ = post(build_payload(0, max_tokens=1), timeout=600)
            print(f"    (校准首发冷 prefill: {time.perf_counter() - t0:.1f}s)")
            base_pt = (r0.get("usage") or {}).get("prompt_tokens", 0)
            per_char = 1.0  # Qwen 中文近 1 字 1 token,迭代会收敛
            fill_chars = max(0, int((target - base_pt) / per_char))
            r1, _ = post(build_payload(fill_chars, max_tokens=1), timeout=600)
            pt1 = (r1.get("usage") or {}).get("prompt_tokens", 0)
            if abs(pt1 - target) > target * 0.08:
                fill_chars = max(0, int(fill_chars * (target - base_pt) / max(pt1 - base_pt, 1)))
                r1, _ = post(build_payload(fill_chars, max_tokens=1), timeout=600)
                pt1 = (r1.get("usage") or {}).get("prompt_tokens", 0)
            prefill1 = None  # 校准那发的时间不干净(紧邻),正式计另行
        else:
            r1, _ = post(build_payload(0, max_tokens=1), timeout=600)
            pt1 = (r1.get("usage") or {}).get("prompt_tokens", 0)

        # 正式两发:prefill-only 计时 + decode 计时(同 prompt,max_tokens=384)
        t0 = time.perf_counter()
        rp, wp = post(build_payload(fill_chars, max_tokens=1, nonce=args.fresh), timeout=900)
        prefill_s = time.perf_counter() - t0
        rd, wd = post(build_payload(fill_chars, max_tokens=args.max_tokens, nonce=args.fresh), timeout=900)
        report(f"bench fill→{pt1}tok", rp, wp, prefill_s)
        report(f"bench fill→{pt1}tok mt={args.max_tokens}", rd, wd, prefill_s)
        return

    if args.cmd == "fullshot":
        pl = build_payload(0, max_tokens=12000, nonce=args.fresh)
        r, w = post(pl, timeout=1200)
        report("fullshot(真实新提示词+12000产线预算)", r, w, None)
        return


if __name__ == "__main__":
    main()
