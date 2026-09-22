#!/usr/bin/env python3
# 出处:2026-09-23 编码器收尾战役产物(09-23-0922-te-closeout);幂等,重跑零变化。
"""对齐 6 件 K2 工作流的陈旧编码器笔记到现行权重口径。

09-22 换装战役把 K2 线 TE/VAE 全量换成官方 Engineer-V1 + HDR VAE,但 6 件工作流
的 MarkdownNote 还写着旧口径(TE qwen3-vl-4b-heretic / VAE qwen_image_vae /
「仍走 Heretic 无审查 TE」)。本脚本做**字节级外科替换**,只动笔记文本所在的
字节,JSON 结构零重排(diff 最小);替换后重解析验证合法性。

替换表(needle → replacement,期望出现次数=0 时视为已对齐,幂等跳过):
  qwen3-vl-4b-heretic     → Krea2-Engineer-V1-bf16
  qwen_image_vae(旧名)   → qwen_image_HDR_vae_fp32_comfy
  仍走 Heretic 无审查 TE  → TE=官方 Krea2-Engineer-V1

用法:
  python3 note_encoder_align_0923.py           # 执行对齐
  python3 note_encoder_align_0923.py --check   # 只验不写(0=全部已对齐)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2] / "backend/engines/comfyui/workflows"

TARGETS = [
    "1_图片/K2图像/1_文生图/K2-三视图.json",
    "1_图片/K2图像/1_文生图/K2-宫格生图.json",
    "1_图片/K2图像/2_图生图/K2-NSFW专业流-图生图.json",
    "1_图片/K2图像/2_图生图/K2-角色换装.json",
    "1_图片/K2图像/2_图生图/K2-角色设定-道劫.json",
    "1_图片/K2图像/2_图生图/K2-角色设定-道劫-专家模式.json",
]

RULES = [
    ("qwen3-vl-4b-heretic", "Krea2-Engineer-V1-bf16"),
    ("qwen_image_vae", "qwen_image_HDR_vae_fp32_comfy"),
    ("仍走 Heretic 无审查 TE", "TE=官方 Krea2-Engineer-V1"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只验不写")
    args = ap.parse_args()

    dirty = False
    for rel in TARGETS:
        p = REPO / rel
        raw = p.read_bytes()
        counts: dict[str, int] = {}
        for needle, repl in RULES:
            n = raw.count(needle.encode())
            counts[needle] = n
            if n and not args.check:
                raw = raw.replace(needle.encode(), repl.encode())
                dirty = True
        # 合法性验证:替换后必须仍是合法 JSON
        json.loads(raw)
        if n_any := any(counts.values()):
            if args.check:
                dirty = True
            else:
                p.write_bytes(raw)
                dirty = True
        status = "已对齐(零残留)" if not n_any else (
            "check:发现残留" if args.check else f"已替换并写回 {counts}"
        )
        print(f"{rel}  {status}")
        if any(counts.values()) and args.check:
            dirty = True

    if not args.check and dirty:
        print("\n对齐完成;重跑本脚本应报零残留(幂等)。")
    elif args.check:
        print("\n" + ("存在残留,需执行对齐" if dirty else "全部已对齐"))
    return (1 if dirty else 0) if args.check else 0


if __name__ == "__main__":
    sys.exit(main())
