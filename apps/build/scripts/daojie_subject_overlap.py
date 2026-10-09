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
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
NODES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes"
sys.path.insert(0, str(NODES))
# 1009 主体句规范自查与 ApiPE 自检同源(环境词表/正负撞词口径不另抄)
from my_qi21_api_pe import _ENV_TOKENS, _pos_neg_clash  # noqa: E402
# 1009 修:旧 K2 侧 my_nodes/nodes/daojie_bases.json 已随 1004 真源集中化并入
# daojie_ink_guofeng 家(qi21_bases.json),旧路径 FileNotFoundError=预检门失效。
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
DOC = REPO / "docs/prompts/道劫_九型主体句示例.md"
MIN_BLOCK = 10
# 1009 主体句规范(10-09-qi21-prompt-layer-conflict D11):场景型 8–14 个方位短语
SCENE_POSITIONS = (8, 14)
POSITION_TOKENS = (
    "左上角", "右上角", "左下角", "右下角", "左上方", "右上方", "左下方", "右下方",
    "画面左侧", "画面右侧", "画面中央", "画面上方", "画面下方",
    "左侧", "右侧", "中央", "正中", "中心", "上方", "下方", "顶部", "底部",
    "左缘", "右缘", "上缘", "下缘", "前景", "中景", "远景", "近处", "远处", "两侧",
)


def type_entry(name: str) -> dict:
    d = json.loads(BASES.read_text(encoding="utf-8"))
    for e in d["types"]:
        if name in (e.get("zh", "") + e.get("key", "") + e.get("purpose", "")):
            return e
    raise SystemExit(f"未找到型 {name}")


def base_positive(name: str) -> str:
    return type_entry(name)["positive_text"]


def count_positions(subject: str) -> int:
    """方位短语计数:长词优先,命中即剥除,防「画面中央」再记「中央」。"""
    n, probe = 0, subject
    for tok in sorted(POSITION_TOKENS, key=len, reverse=True):
        n += probe.count(tok)
        probe = probe.replace(tok, "|")
    return n


def subject_lint(subject: str, entry: dict) -> list:
    """主体句规范三项:场景方位数、透明型环境/背景词、撞本型负向词。"""
    v = []
    if entry.get("zh") == "场景":
        n = count_positions(subject)
        lo, hi = SCENE_POSITIONS
        if not lo <= n <= hi:
            v.append(f"方位短语 {n} 个(场景须 {lo}–{hi})")
    if entry.get("rgba_default") is True:
        v += [f"透明型环境词:{t}" for t in ("背景",) + _ENV_TOKENS if t in subject]
    neg = [x.strip() for x in re.split(r"[,，\n]", entry.get("negative_text") or "") if x.strip()]
    v += _pos_neg_clash(subject, neg)
    return v


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
    ap.add_argument("--json", action="store_true", help="--audit 时输出 JSON(重叠块+规范违例)")
    a = ap.parse_args()
    bad = 0
    if a.audit:
        rows = {}
        for name, sent in doc_sentences().items():
            ov = overlaps(sent, base_positive(name))
            lint = subject_lint(sent, type_entry(name))
            bad += len(lint)
            rows[name] = {"overlaps": [o[1] for o in ov], "max_block": max((o[2] for o in ov), default=0),
                          "lint": lint}
        if a.json:
            print(json.dumps(rows, ensure_ascii=False, indent=1))
            return 2 if bad else 0
        print(f"{'型':6} 重复块数 最大块  首个重复块(主体句子句 | 与底座公共串)")
        for name, r in rows.items():
            head = (r["overlaps"][0][:18] + "…") if r["overlaps"] else "—"
            print(f"{name:8} {len(r['overlaps']):4} {r['max_block']:6}  {head}")
            for v in r["lint"]:
                print(f"   ❌ 规范:{v}")
    elif a.base and a.subject:
        ov = overlaps(a.subject, base_positive(a.base))
        if not ov:
            print(f"✅ {a.base}:与底座零重复(≥{MIN_BLOCK}字公共子串),可发放")
        for clause, common, size in ov:
            print(f"⚠️ {a.base} 重复块 {size}字:「{common}」(主体句:{clause})")
        lint = subject_lint(a.subject, type_entry(a.base))
        bad = len(lint)
        for v in lint:
            print(f"❌ {a.base} 主体句规范:{v}")
    else:
        ap.error("用 --audit 或 --base 型名 --subject 句子")
    return 2 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
