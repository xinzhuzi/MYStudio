#!/usr/bin/env python3
# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""qi21 透明声明句字段化手术(1108 根治役 S1,idempotent)。

背景(PRD=.trellis/tasks/11-08-qi21-assembly-structify/prd.md):
透明语义全英文承载(rgba.head_en/tail_en,由 MyQi21FinalOutput 程序化包裹),
型文正文里的中文透明声明句(「图为带透明通道…背景透明」)是靠剥除器正则猜结构的
病灶根源——1108 实弹两轮丢层事故(分号连句糊死/整层吞没)后止血为句界三符号+存活
断言,本手术把声明句从 qi21_bases.json 真源正文逐型精确退役,剥除器对正文的正则
匹配面归零(保留为 legacy 数据副本兜底)。

句式三态(逐型精确,非盲正则):
  独立句   [道具/人物多视图/高清人脸/表情差分] positive_text(+道具/高清人脸/表情差分
           rgba_positive):整句删除;
  分号糊死 [人脸基准] positive_text:「…；图为…；设定图…」——只删声明分句,
           两侧正文保留(1108 事故同型,等价于现行剥除器输出);
  混合句   [无衣物定妆] positive_text:「图为…背景全透明，人物主体边缘干净完整，
           四周为纯透明空边」——声明半句删除,画幅内容保留并改状态中性措辞
           「四周留出空边」(对齐其 rgba_positive 既有措辞;隔离语义由
           rgba.subject_isolation 英文承载)。

用法:
  python3 apps/build/scripts/qi21_decl_fieldize_1108.py           # DRY_RUN(默认):只验不写
  python3 apps/build/scripts/qi21_decl_fieldize_1108.py --apply   # 写真源
  python3 apps/build/scripts/qi21_decl_fieldize_1108.py --apply --sync  # 写真源+同步本地镜像副本

幂等:片段已不在且无标记残留=已手术,跳过;片段不在但标记仍在=数据形态漂移,硬失败
候人工(禁盲切)。回写格式=json.dumps(ensure_ascii=False, indent=2)+'\\n'
(roundtrip 实证零噪声)。
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TRUTH = (ROOT / "apps/frontend/assets/studio-manuals/art_skills/"
         "daojie_ink_guofeng/json/qi21_bases.json")

MARKERS = ("带透明通道", "背景透明")

# 手术片段表:(型zh, 字段, 旧片段, 新片段)——旧片段在目标字段内恰出现一次,
# DRY_RUN 逐条验数;「新片段为空串」=整句删除。
SURGERY: tuple[tuple[str, str, str, str], ...] = (
    # ── [道具] positive_text:行内独立句(句在「…薄透罩染轻敷。」同行的行尾,句后
    # 换行属正文行界)——只删句不删 \n,删 \n 会把正文两行熔成一行(首版笔误,
    # 下方 REPAIR 项为已施熔行副本修复)
    ("道具", "positive_text",
     "图为带透明通道的 RGBA 透明底图，背景透明。", ""),
    ("道具", "positive_text",
     "薄透罩染轻敷。主体设色配比：", "薄透罩染轻敷。\n主体设色配比："),
    # ── [道具] rgba_positive:行内独立句
    ("道具", "rgba_positive",
     "图为带透明通道的RGBA透明底图，背景透明。", ""),
    # ── [人物多视图] positive_text:独立行(声明句独占一行,删行)
    ("人物多视图", "positive_text",
     "图为带透明通道的RGBA透明底图，背景透明。\n", ""),
    # ── [高清人脸] 两字段
    ("高清人脸", "positive_text",
     "图为带透明通道的RGBA透明底图，背景透明。\n", ""),
    ("高清人脸", "rgba_positive",
     "图为带透明通道的RGBA透明底图，背景透明。", ""),
    # ── [表情差分] 两字段
    ("表情差分", "positive_text",
     "图为带透明通道的RGBA透明底图，背景透明。\n", ""),
    ("表情差分", "rgba_positive",
     "图为带透明通道的RGBA透明底图，背景透明。", ""),
    # ── [人脸基准] positive_text:分号糊死(1108 事故同型)——只删声明分句,两侧保留
    ("人脸基准", "positive_text",
     "图为带透明通道的RGBA透明底图，背景透明；", ""),
    # ── [人脸基准] rgba_positive:行内独立句
    ("人脸基准", "rgba_positive",
     "图为带透明通道的RGBA透明底图，背景透明。", ""),
    # ── [无衣物定妆] positive_text:混合句拆分——声明半句删,画幅内容保留改中性措辞
    ("无衣物定妆", "positive_text",
     "图为带透明通道的RGBA透明底素材图，背景全透明，人物主体边缘干净完整，四周为纯透明空边。",
     "人物主体边缘干净完整，四周留出空边。"),
    # ── [无衣物定妆] rgba_positive:行内独立句
    ("无衣物定妆", "rgba_positive",
     "图为带透明通道的RGBA透明底图，背景透明。", ""),
)

# layer_contract.assembly_order.positive[0] 文案随轮更新(声明已从真源退役)
_OLD_CONTRACT_SNIPPET = "types[].positive_text(背景、照明、来源状态规则；透明开剔除中文透明声明)"
_NEW_CONTRACT_SNIPPET = ("types[].positive_text(背景、照明、来源状态规则;1108 声明句字段化:"
                         "型文正文零中文透明声明,透明语义由 [4014] 英文头尾程序化包裹)")

# 本地镜像副本(存在才同步;Win E:\\IP 热读副本收尾单独走 SSH,见 PRD S1)
LOCAL_MIRRORS: tuple[Path, ...] = (
    Path.home() / "Library/Application Support/漫影工作室/comfyui/daojie-data",
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json"),
    ROOT / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json",
    Path("/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json"),
    Path.home() / "Library/Application Support/漫影工作室/skills/art_skills/daojie_ink_guofeng/json",
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _by_zh(types: list, zh: str) -> dict:
    hits = [t for t in types if isinstance(t, dict) and t.get("zh") == zh]
    if len(hits) != 1:
        raise SystemExit(f"[手术] 型 {zh!r} 命中 {len(hits)} 条(应恰 1),数据形态漂移,停")
    return hits[0]


def main() -> int:
    apply = "--apply" in sys.argv
    sync = "--sync" in sys.argv
    if sync and not apply:
        print("[手术] --sync 需与 --apply 同用(先写真源再同步)")
        return 2

    raw = TRUTH.read_bytes()
    before_sha = sha(raw)
    data = json.loads(raw.decode("utf-8"))
    types = data.get("types") or []
    ops_log: list[str] = []

    # ── 逐片段手术(幂等:已施=跳过;漂移=硬失败)──────────────────────────
    for zh, field, old, new in SURGERY:
        entry = _by_zh(types, zh)
        text = entry.get(field) or ""
        if old in text:
            if text.count(old) != 1:
                raise SystemExit(f"[手术] {zh}/{field}: 旧片段出现 {text.count(old)} 次(应恰 1),停")
            entry[field] = text.replace(old, new, 1)
            ops_log.append(f"施术 {zh}/{field}: 删{len(old)}字"
                           + (f" 补「{new[:18]}…」" if new else ""))
        elif any(m in text for m in MARKERS):
            raise SystemExit(
                f"[手术] {zh}/{field}: 目标片段不在但声明标记仍在——数据形态与本脚本"
                "片段表不契(可能已被他改),须人工核后更新片段表,禁盲切")
        else:
            ops_log.append(f"跳过 {zh}/{field}: 已手术(幂等)")

    # ── layer_contract 文案随轮(幂等)──────────────────────────────────
    contract = data.get("layer_contract") or {}
    order_pos = ((contract.get("assembly_order") or {}).get("positive") or [])
    if order_pos and _OLD_CONTRACT_SNIPPET in order_pos[0]:
        order_pos[0] = order_pos[0].replace(_OLD_CONTRACT_SNIPPET, _NEW_CONTRACT_SNIPPET, 1)
        contract["updated"] = "2026-11-08"
        ops_log.append("施术 layer_contract.assembly_order 文案+updated→2026-11-08")
    elif order_pos and "1108 声明句字段化" in order_pos[0]:
        ops_log.append("跳过 layer_contract: 已更新(幂等)")

    # ── 术后校验:全型零标记+正文非空(自由型空=档位语义)──────────────────
    for t in types:
        zh = t.get("zh")
        for f in ("positive_text", "rgba_positive"):
            v = t.get(f) or ""
            bad = [m for m in MARKERS if m in v]
            if bad:
                raise SystemExit(f"[术后校验] {zh}/{f} 仍残留标记 {bad}")
        if zh != "自由" and not (t.get("positive_text") or "").strip():
            raise SystemExit(f"[术后校验] {zh} positive_text 变空(层丢失级,拒写)")

    print(f"[手术] 真源 {TRUTH}")
    for line in ops_log:
        print("  -", line)

    if not apply:
        print("[手术] DRY_RUN:以上为待施清单,未写任何文件(--apply 落盘)")
        return 0

    out = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    TRUTH.write_bytes(out)
    print(f"[手术] 已写真源:sha16 {before_sha} → {sha(out)},大小 {len(raw)} → {len(out)}")

    if sync:
        for base in LOCAL_MIRRORS:
            dst = base / "qi21_bases.json"
            if not dst.is_file():
                print(f"  [sync] 跳过(不在): {dst}")
                continue
            backup = dst.with_suffix(".json.pre-1108.bak")
            if not backup.exists():
                shutil.copy2(dst, backup)
            shutil.copy2(TRUTH, dst)
            same = dst.read_bytes() == out
            print(f"  [sync] {'OK' if same else 'MISMATCH!'} {dst}(备份 {backup.name})")
            if not same:
                return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
