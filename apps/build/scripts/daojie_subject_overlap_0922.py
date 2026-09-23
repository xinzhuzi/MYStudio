#!/usr/bin/env python3
"""主体句 × 底座 重叠审计(09-22 立)。

背景:09-22 用户裁定「底座=纯美术风格,结构归主体句」。三视图实测暴露:
主体句与该型底座存在整块重复(六格枚举双写)。历史成因:09-20 裁定21把逐格
点名写进三视图底座,而 §5 例句(09-19)自带同款枚举,两份共存至今。

本脚本=发放/取用任一型主体句前的强制预检:
  1) 单型检查: --base 三视图 --subject "……"  → 列出与该型底座的重复块
  2) 全量审计: --audit → 用《道劫_九型主体句示例》九句对照各自底座出欠账表

判定:与底座出现 ≥10 字公共子串 = 重复块(方向一致=加权冗余;措辞分歧=潜在
冲突源),发放前须去重或明示接受。已净型(如道具)应恒零重复。
"""
import argparse
import difflib
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
DOC = REPO / "docs/prompts/道劫_九型主体句示例.md"
MIN_BLOCK = 10


def base_positive(name: str) -> str:
    d = json.loads(BASES.read_text(encoding="utf-8"))
    for e in d:
        if name in (e.get("zh", "") + e.get("key", "") + e.get("purpose", "")):
            return e["positive"]
    raise SystemExit(f"未找到型 {name}")


def doc_sentences() -> dict:
    res, cur, in_fence, buf = {}, None, False, []
    for line in DOC.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^## \d+\. (.+?)[(（]", line)
        if m:
            cur, in_fence, buf = m.group(1), False, []
            continue
        if cur is None:
            continue
        if line.strip().startswith("```"):
            if in_fence and buf:
                res[cur] = "".join(buf)
                cur, in_fence, buf = None, False, []
            else:
                in_fence = True
            continue
        if in_fence:
            buf.append(line)
    return res


def overlaps(subject: str, base: str) -> list:
    """主体句每个子句与底座全文的最长公共子串(≥MIN_BLOCK 记重复块)。"""
    found = []
    for clause in re.split(r"[；。]", subject):
        clause = clause.strip()
        if len(clause) < MIN_BLOCK:
            continue
        m = difflib.SequenceMatcher(None, clause, base).find_longest_match(0, len(clause), 0, len(base))
        if m.size >= MIN_BLOCK:
            found.append((clause[:24] + "…", clause[m.a:m.a + m.size], m.size))
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base")
    ap.add_argument("--subject")
    ap.add_argument("--audit", action="store_true")
    a = ap.parse_args()
    if a.audit:
        print(f"{'型':6} 重复块数 最大块  首个重复块(主体句子句 | 与底座公共串)")
        for name, sent in doc_sentences().items():
            ov = overlaps(sent, base_positive(name))
            head = (ov[0][1][:18] + "…") if ov else "—"
            mx = max((o[2] for o in ov), default=0)
            print(f"{name:8} {len(ov):4} {mx:6}  {head}")
    elif a.base and a.subject:
        ov = overlaps(a.subject, base_positive(a.base))
        if not ov:
            print(f"✅ {a.base}:与底座零重复(≥{MIN_BLOCK}字公共子串),可发放")
        for clause, common, size in ov:
            print(f"⚠️ {a.base} 重复块 {size}字:「{common}」(主体句:{clause})")
    else:
        ap.error("用 --audit 或 --base 型名 --subject 句子")


if __name__ == "__main__":
    main()
