#!/usr/bin/env python3
"""词族语义回归仿真件(0930 修复官 B-2 入仓;只读分析,零改生产代码)。

底稿=/tmp/word_family_sim_0930.py(一轮)+ /tmp/word_family_sim_r2_0930.py(二轮),入仓
改造成常驻语义回归:真源零转录实读,断言「新词族不误伤主体句/画风句/官方头尾/W1 收束句」。
设计依据=q21_optimized_round_0925.mjs 词族二数组注释(263-286 行:D4 设计排除词 light/lit/
weapon 族+禁入 propBanHit 消费面纪律;S10 收束句=qi21_daojie_t2i_0923.py W1_SENT_MD5 互锁)。

真源(全部实读,零转录):
  - 词族三数组+词级微剥层 q21_optimized_round_0925.mjs(17+22+65=104 句子级 + 3 词级)
  - pattern 构造逐字复刻 qi21_daojie_t2i_0923.py(_BG_BAN_ALT+RGBA_STRIP_PATTERN 节,
    cloud 负向前瞻豁免;词级层=第二顶层备选只删词不删句)
  - 生产 widget 对账 qi21-道劫-t2i.json 装配子图 [40:206] RegexReplace(按 type 寻址)
  - 官方头尾 qi21-道劫-t2i.json StringConstant(title 含「官方头句/官方尾句」语义寻址)
  - 四型 base_text qi21_bases.json(rgba_default=True 恰四型)
  - 05 库透明声明句+§一 0930 W1 收束句 docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md

断言组(EXIT=0 判据;任一红=EXIT 1):
  G1 空词族拒      :句子级/词级数组空即拒(负例自测验 SystemExit 语义;mjs 真源空同拒)
  G2 全命中        :合成样张逐词造句,每词**本词形**均被 pattern 命中(防转义/词边界构造坏词
                    静默漏剥);cloud-thunder 豁免负例(豁免位不得命中);es 复数显式补条
                    纪律盘点(s/x/ch/sh 结尾词的标准复数须显式在族)=信息项(现值缺口如
                    实记,补条与否归词族真源轮裁定,本件不修真源)
  G3 画风句 light 不入族:light/lit ∉ 词族全集(D4 设计排除词,MV_STYLE_EN 尾词
                    softly and evenly lit 入族即伤画风句)+ MV_STYLE_EN/MV_BODY_SHARED_EN
                    对全族零命中
  G4 官方头尾不伤  :头句全族零命中;尾句命中恰为公式本体豁免位 {background}(mjs 防呆
                    黑名单注释口径);链序豁免拓扑回验=剥离件上游须为 PE 出文,头/尾/收束句
                    常量消费端全为拼接件,收束拼两入=剥离文+收束句(S10 链序铁律拓扑证)
  G5 收束句不伤(S10 新立):05库 §一 0930 W1 收束句(提取式与生成器同源,md5 与
                    qi21_daojie_t2i_0923.py W1_SENT_MD5_S10 同值互锁)对全族零命中
  G6 主体句零误伤  :四型 base_text(词边界+子串双口径)零命中
  G7 实弹回归(增强;S7 finaltext 为 ignore 域产物,缺席则 skipped 如实记不算红):
                    f1-f4 剥后残余背景词=∅ 且主体标记句存活;r1/r2=D7 关路信息性模拟
                    (注:底稿 r2 的校准1「92 词 pattern 复现 §7.3 bgHits 27/24/25/20」依赖
                    一轮历史中间态词族(53 词版 PE_LIVE_BG_BAN_EXT),真源已扩至 65 词不可
                    从现源还原,入仓件不设该断言,如实注)
  G8 校准0         :构造 pattern 与生产 [40:206] widget 逐字节一致(mjs 真源→t2i 生成器
                    →生产 JSON 三级同源证明)
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MJS = REPO / "apps/build/scripts/q21_optimized_round_0925.mjs"
WF_T2I = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
OUT_S7 = REPO / "apps/output/s7-family-0930"
BASES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json"
LIB05 = REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"

# s10 实弹在档收束句指纹(qi21_daojie_t2i_0923.py W1_SENT_MD5_S10 同值;两处同值互锁,
# 任一端漂移即红——禁静默换句)
W1_SENT_MD5_S10 = "14aa186d7ca6cc119dda5e00d0179753"

# D4 设计排除词(q21_optimized_round_0925.mjs 词族二轮注释:light/lit 入族即伤画风句;
# weapon/sword/staff/polearm/metallic 入族即灭 f4/r2 道具主体;illumination 同理主体形容风险)
DESIGN_EXCLUDED = ["light", "lit", "weapon", "sword", "staff", "polearm", "metallic", "illumination"]

SHOTS = [  # (拍名, 主体标记[全须在剥后存活], 是否门判拍;r1/r2=D7 关路生产剥离件不作用仅模拟)
    ("f1-prop", "f1-prop-finaltext.txt", ["person", "robe"], True),
    ("f2-multiview", "f2-multiview-finaltext.txt", ["hair", "garment"], True),
    ("f3-face", "f3-face-finaltext.txt", ["figure", "robe"], True),
    ("f4-expr", "f4-expr-finaltext.txt", ["figure", "robe"], True),
    ("r1-follow-off", "r1-follow-off-finaltext.txt", ["person", "robe"], False),
    ("r2-force-off-bg", "r2-force-off-bg-finaltext.txt", ["figure", "robe"], False),
]


# ── 真源解析(与 qi21_daojie_t2i_0923.py _js_str_array 同款双防呆) ──────────────
def js_str_array(src: str, name: str) -> list[str]:
    """取 mjs 数组**最后一个** const 定义;注释留档/空数组/单引号形=SystemExit 拒(禁静默)。"""
    matches = list(re.finditer(rf"const {name} = \[(.*?)\];", src, re.S))
    if not matches:
        raise SystemExit(f"词族真源 mjs 缺常量 {name}(q21_optimized_round_0925.mjs)")
    m = matches[-1]
    line_head = src.rfind("\n", 0, m.start()) + 1
    if src[line_head:m.start()].lstrip().startswith("//"):
        raise SystemExit(f"词族真源 {name} 最新定义位于 // 行注释内(疑似旧数组注释留档,禁静默回退旧词族)")
    words = re.findall(r'"([^"]+)"', re.sub(r"//[^\n]*", "", m.group(1)))
    if not words:
        raise SystemExit(f"词族真源 {name} 数组为空或元素非双引号形(形在内容坏,禁静默退化)")
    return words


def js_string_const(src: str, name: str, resolved: dict[str, str] | None = None) -> str:
    """解析 mjs 字符串常量(拼接字面量;标识符引用递归代入,如 MV_BODY_SHARED_EN 尾部
    `+ MV_STYLE_EN`)。"""
    resolved = resolved or {}
    m = re.search(rf"const {name}\s*=\s*(.*?);\n", src, re.S)
    if not m:
        raise SystemExit(f"mjs 缺字符串常量 {name}")
    out = []
    for part in re.split(r"\+", m.group(1)):
        tok = part.strip()
        sm = re.match(r'^"([^"]*)"$', tok)
        if sm:
            out.append(sm.group(1))
        elif tok in resolved:
            out.append(resolved[tok])
        else:
            raise SystemExit(f"常量 {name} 含不可解析片段:{tok[:60]}")
    return "".join(out)


def require_words(words: list[str], tag: str) -> None:
    """G1 空词族拒:空词族构造剥离正则会退化为 \\b(?:)\\b(每词边界命中)把 PE 出文整段
    删光——空即 SystemExit 拒。"""
    if not words:
        raise SystemExit(f"{tag}: 空词族拒(剥离正则退化=整段删光灾难,禁构造)")


def sent_pattern(words: list[str]) -> str:
    """句子级正则(逐字复刻生产构造:w + "s?",cloud 负向前瞻豁免)。"""
    require_words(words, "句子级词族")
    alt = "|".join(
        r"clouds?(?!-thunder)" if w == "cloud" else re.escape(w) + "s?"
        for w in words)
    return r"[^\n。.；;！!？?]*\b(?:" + alt + r")\b[^\n。.；;！!？?]*[。.；;！!？?\n]?"


def word_pattern(words: list[str]) -> str:
    """词级微剥层正则(只删词不删句)。"""
    require_words(words, "词级微剥层")
    return r"\b(?:" + "|".join(re.escape(w) + "s?" for w in words) + r")\b"


def strip_pattern(sent_words: list[str], soft_words: list[str]) -> str:
    """复合剥离正则(与生产 RGBA_STRIP_PATTERN 同构:句子级|词级第二顶层)。"""
    return sent_pattern(sent_words) + "|" + word_pattern(soft_words)


def family_wb_hits(text_lower: str, words: list[str]) -> list[str]:
    return sorted({w for w in words if re.search(rf"\b{re.escape(w)}s?\b", text_lower)})


def main() -> int:
    mjs_src = MJS.read_text(encoding="utf-8")
    mv = js_str_array(mjs_src, "MV_BG_WORDS_BAN")
    ext = js_str_array(mjs_src, "PROP_BG_BAN_EXT")
    live = js_str_array(mjs_src, "PE_LIVE_BG_BAN_EXT")
    soft = js_str_array(mjs_src, "PE_LIVE_SUBJ_SOFT_STRIP")
    sent_words = mv + ext + live
    all_words = sent_words + soft
    pat = strip_pattern(sent_words, soft)
    print(f"词族真源: MV_BG_WORDS_BAN={len(mv)} + PROP_BG_BAN_EXT={len(ext)} + "
          f"PE_LIVE_BG_BAN_EXT={len(live)} = 句子级 {len(sent_words)} 词 + 词级微剥 {len(soft)} 词"
          f"(全集 {len(all_words)})\n")

    reds: list[str] = []
    def gate(name: str, ok: bool, detail: str) -> None:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")
        if not ok:
            reds.append(name)

    # ── G1 空词族拒(负例自测) ─────────────────────────────────────────
    print("═" * 72)
    neg_ok = True
    for fn, tag in ((sent_pattern, "句子级"), (word_pattern, "词级微剥层"), (strip_pattern, "复合(句子级,词级)")):
        try:
            fn([], soft) if fn is strip_pattern else fn([])
            neg_ok = False
            print(f"  [FAIL] 空词族构造未被拒({tag})")
        except SystemExit:
            print(f"  [拒] 空词族构造即 SystemExit({tag})")
    gate("G1 空词族拒(负例自测)", neg_ok, "三构造器空词族全拒" if neg_ok else "存在未拒路径")

    # ── G2 全命中(合成样张逐词本词形;cloud-thunder 豁免负例) ───────────
    print("═" * 72)
    miss_sent = [w for w in sent_words
                 if not re.search(pat, f"a quiet distant {w} appears here.".lower())]
    miss_soft = [w for w in soft
                 if not re.search(word_pattern(soft), f"the robe is {w} in places.")]
    cloud_ok = (re.search(pat, "soft clouds drift past.") is not None
                and re.search(pat, "engraved cloud-thunder patterns coil.") is None)
    gate("G2 全命中(句子级逐词本词形)", not miss_sent,
         f"{len(sent_words)} 词合成样张全命中" if not miss_sent else f"漏命中={miss_sent}")
    gate("G2 全命中(词级微剥逐词)", not miss_soft,
         f"{len(soft)} 词全命中" if not miss_soft else f"漏命中={miss_soft}")
    gate("G2 cloud-thunder 豁免", cloud_ok, "cloud 命中/cloud-thunder 不命中" if cloud_ok else "豁免语义坏")
    # es/ies 复数显式补条纪律盘点(信息项,非判据;t2i 构造器只追加 s?,x/z/ch/sh 结尾
    # 词的标准复数(+es)与辅音+y 结尾词的不规则复数(-y+ies)须显式在族——mjs 词族注释
    # 纪律;缺条不修真源,归词族轮裁定。s 结尾词多为显式复数对成员(单数另条),跳过;
    # 不可数名词(scenery/calligraphy)复数无语义,列示仅完整性)
    es_gap = sorted({w for w in sent_words
                     if not w.endswith("s") and re.search(r"(?:x|z|ch|sh)$", w)
                     and f"{w}es" not in sent_words})
    ies_gap = sorted({w for w in sent_words
                      if re.search(r"[^aeiou]y$", w) and f"{w[:-1]}ies" not in sent_words})
    print(f"  [信息] es 复数补条盘点: 缺条={es_gap or '∅'} | ies 复数补条盘点: 缺条={ies_gap or '∅'}"
          "(标准复数形不被 pattern 覆盖;不可数词复数无语义可豁免;补条归词族真源轮,本件零改真源)")

    # ── G3 画风句 light 不入族 + 全族零命中 ────────────────────────────
    print("═" * 72)
    in_family = [w for w in ("light", "lit") if w in all_words]
    gate("G3 画风句 light 不入族(D4 设计排除)", not in_family,
         "light/lit ∉ 全集" if not in_family else f"违规入族={in_family}")
    excl_ok = all(w not in all_words for w in DESIGN_EXCLUDED)
    gate("G3 D4 设计排除词全数不在族", excl_ok,
         f"{len(DESIGN_EXCLUDED)} 词全不在族" if excl_ok else
         f"违规入族={[w for w in DESIGN_EXCLUDED if w in all_words]}")
    style_en = js_string_const(mjs_src, "MV_STYLE_EN")
    body_en = js_string_const(mjs_src, "MV_BODY_SHARED_EN", {"MV_STYLE_EN": style_en})
    lit_alive = re.search(r"\blit\b", style_en.lower()) is not None  # 画风句自身带 lit(证明排除必要性)
    for tag, txt in (("MV_STYLE_EN", style_en), ("MV_BODY_SHARED_EN", body_en)):
        hits = family_wb_hits(txt.lower(), all_words)
        ok = (not hits) and (lit_alive if tag == "MV_STYLE_EN" else True)
        gate(f"G3 画风句 {tag} 全族零命中", ok,
             f"命中={hits or '∅'}" + (";尾词 lit 在场=排除必要性实证" if tag == "MV_STYLE_EN" else ""))

    # ── G4 官方头尾不伤(生产 JSON 语义寻址零转录) ─────────────────────
    # 尾句 transparent background=公式本体豁免位(q21_optimized_round_0925.mjs 画风句
    # 防呆黑名单注释明文:官方头尾的 background 是公式本体豁免位,只查画风句/身份句);
    # 真正的「不伤」由链序豁免保证=剥离只吃 PE 出文,头尾/收束句在剥离之后拼接。
    print("═" * 72)
    wf = json.loads(WF_T2I.read_text(encoding="utf-8"))
    asm_sg = wf["definitions"]["subgraphs"][0]
    inner = asm_sg["nodes"]
    sg_links = {l["id"]: l for l in asm_sg["links"]}
    by_id = {n["id"]: n for n in inner}
    head = next((n for n in inner if n["type"] == "StringConstant" and "官方头句" in (n.get("title") or "")), None)
    tail = next((n for n in inner if n["type"] == "StringConstant" and "官方尾句" in (n.get("title") or "")), None)
    if not (head and tail):
        gate("G4 官方头尾语义寻址", False, "t2i JSON 未按 title 寻址到官方头/尾句")
    else:
        h_txt, t_txt = str(head["widgets_values"][0]), str(tail["widgets_values"][0])
        h_hits, t_hits = family_wb_hits(h_txt.lower(), all_words), family_wb_hits(t_txt.lower(), all_words)
        gate("G4a 官方头句全族零命中(文本面)", not h_hits, f"命中={h_hits or '∅'} | {h_txt[:60]}…")
        gate("G4b 官方尾句命中恰为公式本体豁免位", t_hits == ["background"],
             f"命中={t_hits}(豁免位={{background}},mjs 防呆黑名单注释口径) | {t_txt[:60]}…")
        # G4c 链序豁免拓扑回验(语义寻址:剥离件上游=PE 出文;头/尾/收束句消费端=拼接件)
        strip_n = next((n for n in inner if n["type"] == "RegexReplace"), None)
        w1_sent = next((n for n in inner if n["type"] == "StringConstant" and "收束句" in (n.get("title") or "")), None)
        w1_cat = next((n for n in inner if n["type"] == "StringConcatenate" and "收束拼" in (n.get("title") or "")), None)
        if not all((strip_n, w1_sent, w1_cat)):
            gate("G4c 链序豁免拓扑寻址", False,
                 "t2i JSON 未按语义寻址到剥离件/收束句/收束拼(S10 W1 四段链缺件?)")
        else:
            def upstream(node, slot_name):
                lk = next(i.get("link") for i in node["inputs"] if i["name"] == slot_name)
                if lk is None:
                    return None
                src_id = sg_links[lk]["origin_id"]
                return by_id.get(src_id)
            strip_src = upstream(strip_n, "string")
            strip_src_ok = strip_src is not None and strip_src["type"] == "QwenImage21_T2IPromptRewrite"
            gate("G4c 剥离件 string 上游=PE 出文(非头/尾/收束句)", strip_src_ok,
                 f"上游={strip_src['type'] if strip_src else '∅'}")
            prot = [("官方头", head), ("官方尾", tail), ("收束句", w1_sent)]
            for tag, nd in prot:
                cons = [by_id.get(l["target_id"]) for l in sg_links.values() if l["origin_id"] == nd["id"]]
                ok = bool(cons) and all(c and c["type"] == "StringConcatenate" for c in cons)
                gate(f"G4c {tag}常量消费端全为拼接件(链序=剥离之后拼接)", ok,
                     "→".join(f"{c['type']}[{c.get('title', '')[:14]}]" for c in cons) or "无消费端")
            cat_a, cat_b = upstream(w1_cat, "string_a"), upstream(w1_cat, "string_b")
            cat_ok = (cat_a is not None and cat_a["id"] == strip_n["id"]
                      and cat_b is not None and cat_b["id"] == w1_sent["id"])
            gate("G4c 收束拼两入=剥离文+收束句(链序铁律拓扑证)", cat_ok,
                 f"string_a={cat_a['type'] if cat_a else '∅'} string_b={cat_b['type'] if cat_b else '∅'}(收束句常量)")

    # ── G5 收束句不伤(S10 W1;提取式与生成器同源+md5 互锁) ─────────────
    print("═" * 72)
    md = LIB05.read_text(encoding="utf-8")
    m_sent = re.search(r"主候选句在案\((The subject[^)]*?)\)", md)
    if not m_sent:
        gate("G5 W1 收束句条款在案", False, "05 库 §一 0930 条款主候选句不在案(真源链断)")
        w1_sentence = ""
    else:
        w1_sentence = m_sent.group(1)
        digest = hashlib.md5(w1_sentence.encode("utf-8")).hexdigest()
        gate("G5 W1 收束句 md5 互锁(与 qi21_daojie_t2i_0923.py W1_SENT_MD5_S10 同值)",
             digest == W1_SENT_MD5_S10, f"md5={digest}")
        hits = family_wb_hits(w1_sentence.lower(), all_words)
        gate("G5 收束句不被词族误伤(107 词词边界零命中)", not hits,
             f"命中={hits or '∅'} | {w1_sentence[:60]}…")

    # ── G6 主体句零误伤(四型 base_text;rgba_default=True 恰四型) ──────
    print("═" * 72)
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    rgba_types = [b["zh"] for b in bases if b.get("rgba_default")]
    for b in bases:
        low = b["base_text"].lower()
        wb = family_wb_hits(low, all_words)
        ss = sorted({w for w in all_words if w in low})
        gate(f"G6 base_text {b['zh']}({len(b['base_text'])}字) 双口径零命中", not wb and not ss,
             f"词边界={wb or '∅'} 子串={ss or '∅'}")
    gate("G6 透明四型集合口径(rgba_default=True)", len(rgba_types) == 4,
         f"四型={rgba_types}" if len(rgba_types) == 4 else f"异常集合={rgba_types}")

    # ── G7 实弹回归(S7 六拍 finaltext;ignore 域产物缺席=skipped 不算红) ─
    print("═" * 72)
    if not OUT_S7.is_dir():
        print(f"[skipped] G7 实弹回归: {OUT_S7} 不在场(ignore 域产物,缺席不算红)")
    else:
        for shot, fname, markers, is_gate in SHOTS:
            f = OUT_S7 / fname
            if not f.is_file():
                print(f"[skipped] G7 {shot}: {fname} 缺席")
                continue
            text = f.read_text(encoding="utf-8")
            out = re.sub(pat, "", text.lower())
            residual = family_wb_hits(out, all_words)
            alive = all(m in out for m in markers)
            tag = "门判" if is_gate else "信息(D7 关路,生产剥离件不作用仅模拟)"
            if is_gate:
                gate(f"G7[{tag} {shot}] 剥后残余背景词=∅", not residual, f"残余={residual or '∅'}")
                gate(f"G7[{tag} {shot}] 主体标记句存活", alive,
                     f"标记 {markers} 全在场" if alive else f"缺 {[m for m in markers if m not in out]}")
            else:
                print(f"  [信息 {shot}] {tag}: 剥后残余={residual or '∅'} 主体存活={alive}(不计门判)")

    # ── G8 校准0(构造 pattern 与生产 widget 逐字节) ───────────────────
    print("═" * 72)
    strip_nodes = [n for n in inner if n["type"] == "RegexReplace"]
    if len(strip_nodes) != 1:
        gate("G8 生产剥离件寻址", False, f"装配域 RegexReplace 应恰 1 件,实得 {len(strip_nodes)}")
    else:
        widget = str(strip_nodes[0]["widgets_values"][1])
        gate("G8 校准0(构造 pattern == 生产 [40:206] widget 逐字节)", pat == widget,
             f"构造 {len(pat)} 字符 vs widget {len(widget)} 字符")

    print("═" * 72)
    print(f"总判: {'全绿' if not reds else '有红=' + ';'.join(reds)}")
    return 0 if not reds else 1


if __name__ == "__main__":
    sys.exit(main())
