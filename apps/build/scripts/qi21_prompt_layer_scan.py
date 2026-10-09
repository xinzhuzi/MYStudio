#!/usr/bin/env python3
"""qi21 提示词三层冲突扫描(10-09-qi21-prompt-layer-conflict 立)。

九型逐型按 [4013] ApiPE 的 direct 口径拼出型文+底座输入(透明型=风格件,
非透明型=风格件+底色件),扫三类违规:
  AC1 对立词对:底座叫「低频/概括/每层可见/不互混」,型文却要「完整细节/铺满/接晕」;
  AC3 透明残留:透明型 PE 输入仍含中文透明声明;
  AC4 元语言/质量词:底座三字段与型文/rgba_positive 出现主体句元语言或质量词。
--clash 另出九型正负撞词报告(AC2,只报告不判红;口径=ApiPE._pos_neg_clash)。

用法:
  python3 apps/build/scripts/qi21_prompt_layer_scan.py --conflicts --clash --json
exit 2=有 AC1/AC3/AC4 违规;0=干净。
"""
import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
NODES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes"

# (规则名, 底座侧词, 型文侧词):两侧各命中任一即为对冲
CONFLICT_PAIRS = (
    ("细节预算对冲", ("低频", "概括形体", "不堆积细碎", "递减细节"), ("完整细节", "细节渲染")),
    ("底色可见对冲铺满", ("每层色罩下保持可见",), ("铺满", "铺到画框边缘")),
    ("不互混对冲接晕", ("不互混",), ("相互接晕",)),
)
META_WORDS = ("按主体句", "遵循主体句", "主体句", "类型句", "第一眼", "生产级", "成片质量")
RGBA_MARKERS = ("带透明通道", "背景透明")
ASB_TEXT_FIELDS = ("positive_text", "positive_style_text", "positive_ground_text")
TYPE_TEXT_FIELDS = ("positive_text", "rgba_positive")


def _default_strip():
    """修后用节点同款句级剔除;修前模块不存在=恒等(扫描即暴露 P5)。"""
    sys.path.insert(0, str(NODES))
    try:
        from _qi21_rgba_text import strip_rgba_decl
        return strip_rgba_decl
    except ImportError:
        return lambda s: s


def _is_rgba(t: dict) -> bool:
    return t.get("rgba_default") is True


def pe_input(t: dict, asb: dict, strip=None) -> str:
    """复刻 ApiPE direct 的型文+底座部分(主体句另算)。"""
    strip = strip or _default_strip()
    base = (t.get("positive_text") or "").strip()
    style = (asb.get("positive_style_text") or "").strip()
    if _is_rgba(t):
        base = strip(base)
    else:
        style += (asb.get("positive_ground_text") or "").strip()
    return f"类型句:{base}\n{style}".strip() if base else style


def _first_hit(text: str, words) -> str | None:
    return next((w for w in words if w in text), None)


def _meta_hits(text: str) -> list[str]:
    """最长优先去重:「按主体句」命中后不再重复记「主体句」。"""
    hits, probe = [], text
    for w in META_WORDS:
        if w in probe:
            hits.append(w)
            probe = probe.replace(w, "")
    return hits


def scan_conflicts(data: dict, strip=None) -> list[dict]:
    strip = strip or _default_strip()
    asb = data.get("art_style_base") or {}
    found = []
    for field in ASB_TEXT_FIELDS:
        for w in _meta_hits(asb.get(field) or ""):
            found.append({"type": "art_style_base", "field": field, "rule": "元语言/质量词", "detail": w})
    ground = asb.get("positive_ground_text") or ""
    for t in data.get("types") or []:
        name = t.get("zh", "?")
        for field in TYPE_TEXT_FIELDS:
            for w in _meta_hits(t.get(field) or ""):
                found.append({"type": name, "field": field, "rule": "元语言/质量词", "detail": w})
        if _is_rgba(t):
            text = pe_input(t, asb, strip)
            for m in RGBA_MARKERS:
                if m in text:
                    found.append({"type": name, "field": "pe_input", "rule": "透明残留", "detail": m})
            continue
        type_text = t.get("positive_text") or ""
        for rule, base_words, type_words in CONFLICT_PAIRS:
            bw, tw = _first_hit(ground, base_words), _first_hit(type_text, type_words)
            if bw and tw:
                found.append({"type": name, "field": "positive_text", "rule": rule, "detail": f"{bw}×{tw}"})
    return found


def _neg_tokens(*sources: str) -> list[str]:
    """同 ApiPE.rewrite 负向三源切词去重口径。"""
    toks, seen = [], set()
    for src in sources:
        for tok in (x.strip() for x in re.split(r"[,，\n]", src or "") if x.strip()):
            if tok not in seen:
                seen.add(tok)
                toks.append(tok)
    return toks


def scan_clash(data: dict, subjects: dict | None = None, strip=None) -> dict:
    sys.path.insert(0, str(NODES))
    from my_qi21_api_pe import _pos_neg_clash
    asb = data.get("art_style_base") or {}
    report = {}
    for t in data.get("types") or []:
        name = t.get("zh", "?")
        # 示例文档型名可能是简称(「多视图」↔「人物多视图」),精确优先、子串回落
        subj = (subjects or {}).get(name) or next(
            (s for k, s in (subjects or {}).items() if k and k in name), "")
        pos = f"主体句:{subj}\n{pe_input(t, asb, strip)}"
        hits = _pos_neg_clash(pos, _neg_tokens(t.get("negative_text") or "", asb.get("negative_text") or ""))
        report[name] = {"count": len(hits), "hits": hits, "with_subject": bool(subj)}
    return report


def exit_code(found: list) -> int:
    return 2 if found else 0


def _doc_subjects() -> dict:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        from daojie_subject_overlap import doc_sentences
        return doc_sentences()
    except (ImportError, OSError):
        return {}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--conflicts", action="store_true", help="AC1/AC3/AC4 违规扫描(决定 exit 码)")
    ap.add_argument("--clash", action="store_true", help="AC2 正负撞词报告(示例文档主体句并入)")
    ap.add_argument("--json", action="store_true", help="JSON 输出")
    ap.add_argument("--bases", default=str(BASES), help="qi21_bases.json 路径(缺省=仓库真源)")
    a = ap.parse_args()
    if not (a.conflicts or a.clash):
        ap.error("至少给 --conflicts 或 --clash")
    data = json.loads(Path(a.bases).read_text(encoding="utf-8"))
    out, found = {"bases": a.bases}, []
    if a.conflicts:
        found = scan_conflicts(data)
        out["conflicts"] = found
    if a.clash:
        out["clash"] = scan_clash(data, _doc_subjects())
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
    else:
        for f in found:
            print(f"❌ {f['type']}.{f['field']} [{f['rule']}] {f['detail']}")
        for name, r in (out.get("clash") or {}).items():
            print(f"撞词 {name}: {r['count']} {' '.join(r['hits'])}")
        print(f"违规 {len(found)} 条" if a.conflicts else "")
    return exit_code(found)


if __name__ == "__main__":
    sys.exit(main())
