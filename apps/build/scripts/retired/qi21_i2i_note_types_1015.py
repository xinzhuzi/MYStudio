#!/usr/bin/env python3
"""qi21-道劫-i2i [402] 透明锚三型效果增补(1015 役任务⑤;文本级零接线)。

1015 役任务④三型 A/B 实弹判读(收据=apps/output/i2i-fire-1014/anchor-probe/<型>/):
- 人物多视图 6 对 A<B(2:3)、表情差分 6 对 A<B(1:3)→ 分支④,1015 裁定=不回写
  效果句、不推荐透明锚;
- 高清人脸 6 对轮 A>B 非 sweep(1/0+5 双黑 tie)→ 分支②补至 10 对整跑 → A=B(1:1)
  → 分支③降措辞;
- 三型败因双侧同为全透明塌缩(α=[0,0],塌缩率 50-90%),锚增益仅实证于道具型
  (T7 10/10 vs 0/10,文字已在库=增补非回写)。

手术=「效果」行后追加「三型增补」一行(数字+带透+对数+分型结论+定谳句+收据路径);
道具 T7 句与统计局限句原样保留(历史台账不改写);纯文本级:零接线零蓝图侧,
除 [402] widgets_values[0] 外全文档 canonical 前后不变,蓝图文件零写入(md5 断言)。

fail-closed:术前断言不满足即 exit 2 零写入;幂等:已增补形态 exit 3 零写入。
用法:python3 qi21_i2i_note_types_1015.py [--wf 副本路径(拦停验证用)]
"""
import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"

SHA_WF = "859b696310334598"   # 术前字节锚(任务②洗底后本会话实锚;漂移即拦停)
SHA_BP = "07d2806fd2713337"   # 蓝图只读锚(全程零写入)
NOTE_ID = 402
SECTION_ANCHOR = "### 透明参考锚配方"
EFFECT_ANCHOR = "- **效果**:"
T7_TOKEN = "锚侧 10/10 过、无锚侧 0/10 全纯黑屏"   # 增补非回写:道具句必须原样保留
ADD_TOKEN = "三型增补(1015"
APPEND_LINE = (
    "- **三型增补(1015 役任务④实弹;1015 裁定)**:人物多视图 6 对,A 锚侧 2/6 过(带透 2)、"
    "B 无锚侧 3/6 过(带透 3);表情差分 6 对,A 1/6 过(带透 1)、B 3/6 过(带透 3)——两型 A<B,"
    "不推荐透明锚;高清人脸 10 对,A 1/10 过(带透 1)、B 1/10 过(带透 1),A=B 中性降措辞。"
    "三型败因双侧同为全透明塌缩(α=[0,0],塌缩率 50-90%),定谳:透明锚增益仅实证于道具型"
    "(单物+大面积透明留白,10/10 vs 0/10),此类三型交付用「1 · 原生出图」档;统计口径=样本量小"
    "方向性信号非定谳(塌缩主导);收据=apps/output/i2i-fire-1014/anchor-probe/<型>/receipt.json"
    "(人物多视图/高清人脸/表情差分)。"
)


def fail(msg, code=2):
    print(f"[note1015] FAIL: {msg}")
    sys.exit(code)


def load(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        fail(f"{p.name} 非 JSON:{e}")


def sha16(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def note_text(doc: dict) -> str:
    n = next((n for n in doc["nodes"] if n["id"] == NOTE_ID), None)
    if n is None or n.get("type") != "MarkdownNote":
        fail(f"[{NOTE_ID}] 缺失或非 MarkdownNote")
    return n["widgets_values"][0]


def canon_wo_note(doc: dict) -> str:
    """除 [402] 文本外全文档 canonical(零接线校验态)。"""
    d = copy.deepcopy(doc)
    next(n for n in d["nodes"] if n["id"] == NOTE_ID)["widgets_values"][0] = ""
    return json.dumps(d, sort_keys=True, ensure_ascii=False)


def full_form(txt: str) -> bool:
    return ADD_TOKEN in txt and "1/10 过(带透 1)" in txt and "不推荐透明锚" in txt


def pre_assert(wf_path: Path, txt: str):
    got = sha16(wf_path)
    if got != SHA_WF:
        fail(f"术前字节锚不符:sha256[:16]={got} 预期 {SHA_WF}(现场漂移禁为过门放宽)")
    if SECTION_ANCHOR not in txt:
        fail(f"缺节锚「{SECTION_ANCHOR}」")
    if EFFECT_ANCHOR not in txt:
        fail(f"缺效果行锚「{EFFECT_ANCHOR}」")
    if T7_TOKEN not in txt:
        fail("道具 T7 效果句不在案(增补非回写前提破坏,拒续)")


def surgery(doc: dict, txt: str):
    i = txt.find(EFFECT_ANCHOR)
    eol = txt.find("\n", i)
    if eol < 0:
        fail("效果行行尾未找到")
    nxt = next(n for n in doc["nodes"] if n["id"] == NOTE_ID)
    nxt["widgets_values"][0] = txt[:eol + 1] + APPEND_LINE + "\n" + txt[eol + 1:]


def coherence(doc: dict, txt_before: str, canon_before: str, label: str):
    txt = note_text(doc)
    for tok in (ADD_TOKEN, T7_TOKEN, SECTION_ANCHOR,
                "人物多视图 6 对", "高清人脸 10 对", "表情差分 6 对",
                "不推荐透明锚", "anchor-probe/<型>/receipt.json", "1 · 原生出图"):
        if tok not in txt:
            fail(f"[{label}] [402] 缺 token:{tok!r}")
    if len(txt) <= len(txt_before):
        fail(f"[{label}] [402] 文本应增长")
    if canon_wo_note(doc) != canon_before:
        fail(f"[{label}] [402] 外文档被脏写(应 canonical 不变=零接线)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wf", type=Path, default=WF, help="工作流路径(副本拦停验证用)")
    args = ap.parse_args()
    wf_path = args.wf.resolve()
    print(f"[note1015] 目标:wf={wf_path}(蓝图={BP.name} 只读校验态)")
    bp_sha = sha16(BP) if wf_path == WF.resolve() else None

    doc = load(wf_path)
    txt = note_text(doc)
    canon_before = canon_wo_note(doc)

    if full_form(txt):
        print("[note1015] 已增补形态,幂等拦停(零写入)")
        sys.exit(3)
    if ADD_TOKEN in txt:
        fail("增补 token 半套在场(部分术后拦停)")
    pre_assert(wf_path, txt)
    print("[note1015] 术前断言全绿(sha/节锚/效果行/道具 T7 句在案)")

    surgery(doc, txt)
    coherence(doc, txt, canon_before, "内存")
    bak = wf_path.with_suffix(wf_path.suffix + ".bak-1015t5")
    bak.write_text(wf_path.read_text(encoding="utf-8"), encoding="utf-8")
    wf_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    reread = load(wf_path)
    coherence(reread, txt, canon_before, f"回读:{wf_path.name}")
    if bp_sha is not None and sha16(BP) != bp_sha:
        fail("蓝图文件被意外改写(md5 前后不一致)")
    print(f"[note1015] 落盘+回读终验绿:{wf_path.name}(备份 {bak.name});"
          f"蓝图只读校验态绿({BP.name} sha16={SHA_BP})。")


if __name__ == "__main__":
    main()
