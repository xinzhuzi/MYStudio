#!/usr/bin/env python3
"""qi21 R 命名统一批 splice 手术(2026-10-08;design.md §4/implement.md R 批)。

一次手术四域:
  A. 数据真源 qi21_bases.json:键 lock_layer→art_style_base(顶层键+layer_contract
     assembly_order/principles/segments 子键+color_lexicon 引用)·types[].key 冗余双键
     删除(九型删,自由本缺)·教材 system_prompt_zh 单 token 术语退役(锁层A→美术风格底座)
     ·顶层 7 节 _doc 中文自注释(6 对象节内嵌+_doc_types 顶层伴键;下划线前缀=注释键
     程序永不读)。
  B. prompt_layering.json:lock_layer 引用三处+assembly_line 对齐现行代码(旧引
     _LOCK_A_NEG=1005 前历史值)+engine_json 死路径勘误(nodes/ 副本 1005 已删)+
     顶层各节 _doc(同规格)。
  C. 节点 py+测试+活工具(py/test/scripts):.get("lock_layer")→art_style_base、
     _load_lock_layer→_load_art_style_base、lock_layer_positive/negative→
     art_style_base_*、_LOCK_A→_STYLE_BASE(_LOCK_A_NEG 历史名保护)、
     my_daojie_base:203 双读改单读 zh、术语退役(锁层A/通用锁层/常量A→美术风格底座
     系;节点输入名「锁层A全文」=显示名类,保护不动——命名登记表在案)。
  D. 工作流/蓝图卡文+治理文档:t2i/i2i/两蓝图卡文 lock_layer 技术引用与旧术语;
     05库现行规则句/标题/表格头(§六台账+三段带日期出处记录=史,保护不动);
     08宪法 mermaid;00-README/定制代码地图/漫影工作流清单(带日期台账行保护)/
     NODE_LIBRARY/custom-author。

铁律:旧串锚断言(逐对计数,fail-closed)+语义自检(改后回读断言)+改前副本已入
backups/r/。执行:python3 qi21_rename_r_1008.py [--dry]。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
DRY = "--dry" in sys.argv

# ─────────────────────────────────────────────────────────────────
# 通用:带保护的术语退役规则序(顺序敏感)
# ─────────────────────────────────────────────────────────────────
W = "\u0001WIDGET\u0001"      # 锁层A全文(节点输入名,显示名类)保护占位
OLDNEG = "\u0001OLDNEG\u0001"  # _LOCK_A_NEG(已退役历史标识符,注释留史)保护占位

TERM_RULES = [
    ("锁层A全文", W),                 # 1 保护:输入名/形参名/蓝图 inputs 名不动
    ("_LOCK_A_NEG", OLDNEG),          # 2 保护:退役标识符留史
    ("_LOCK_A", "_STYLE_BASE"),       # 3 装配器 import 快照变量(OLDNEG 已摘,无腐蚀)
    ("_load_lock_layer", "_load_art_style_base"),
    ("lock_layer_positive", "art_style_base_positive"),
    ("lock_layer_negative", "art_style_base_negative"),
    ("通用锁层常量A", "美术风格底座常量"),
    ("通用锁层", "美术风格底座"),
    ("锁层A负面", "美术风格底座负面"),
    ("锁层A", "美术风格底座"),
    ("锁层负面", "美术风格底座负面"),
    ("锁层常量", "美术风格底座常量"),
    ("常量A", "美术风格底座常量"),
    ("锁层", "美术风格底座"),           # 兜底:bare 锁层(③层锁层/中文锁层/③锁层)
    ("lock_layer", "art_style_base"),
    (OLDNEG, "_LOCK_A_NEG"),
    (W, "锁层A全文"),
]


def apply_rules(text: str, rules=TERM_RULES) -> tuple[str, dict]:
    counts: dict[str, int] = {}
    for old, new in rules:
        n = text.count(old)
        if n:
            text = text.replace(old, new)
            counts[old] = n
    return text, counts


def text_surgery(path: Path, specific: list, rules_on: bool = True,
                 protect_spans: list = ()) -> None:
    """文本手术:specific=[(旧,新,期望次数)];rules_on=再跑术语规则序;
    protect_spans=[(起标,止标)] 之间原文不动(历史台账/带日期记录)。"""
    raw = path.read_text(encoding="utf-8")
    orig = raw
    for old, new, expect in specific:
        got = raw.count(old)
        assert got == expect, f"[锚] {path.name}:期望 {expect!r}×{expect},得 ×{got}: {old[:60]!r}"
        raw = raw.replace(old, new)
    if rules_on:
        # 保护段先摘出
        keeps: list[str] = []
        for a, b in protect_spans:
            assert a in raw and b in raw, f"[锚] {path.name}:保护段标记缺失 {a[:20]!r}/{b[:20]!r}"
            i, j = raw.index(a), raw.index(b) + len(b)
            keeps.append(raw[i:j])
            raw = raw[:i] + f"\u0002KEEP{len(keeps)-1}\u0002" + raw[j:]
        raw, counts = apply_rules(raw)
        for idx, k in enumerate(keeps):
            raw = raw.replace(f"\u0002KEEP{idx}\u0002", k)
    else:
        counts = {}
    assert raw != orig or (not specific and not counts), f"[锚] {path.name}:零改动?"
    if not DRY:
        path.write_text(raw, encoding="utf-8")
    total = sum(counts.values()) or sum(e for _, _, e in specific)
    print(f"  [text] {path.name}:specific {len(specific)} 对"
          f"{'+rules(' + str(sum(counts.values())) + ')' if rules_on and counts else ''} 落盘" if not DRY
          else f"  [dry ] {path.name}:specific {len(specific)} 对 rules {sum(counts.values())} 处")


# ═════════════════════════════════════════════════════════════════
# A. qi21_bases.json(结构手术)
# ═════════════════════════════════════════════════════════════════
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
PRE = REPO / ".trellis/tasks/10-04-qi21-prompt-cleanup/backups/r/qi21_bases.json.pre"


def surgery_bases() -> None:
    raw = BASES.read_text(encoding="utf-8")
    pre = json.loads(PRE.read_text(encoding="utf-8"))
    data = json.loads(raw)
    assert list(data.keys()) == ["lock_layer", "rgba", "expand_instruction",
                                 "strip_lexicon", "types", "layer_contract",
                                 "color_lexicon"], f"[锚] 顶层键序意外: {list(data.keys())}"
    # A1 顶层键改名(保位)
    data = {("art_style_base" if k == "lock_layer" else k): v for k, v in data.items()}
    # A2 types[].key 冗余双键删除(九型有/自由缺)
    with_key = [t.get("zh") for t in data["types"] if "key" in t]
    assert len(with_key) == 9 and data["types"][9]["zh"] == "自由" \
        and "key" not in data["types"][9], f"[锚] types[].key 形态意外: {with_key}"
    for t in data["types"]:
        t.pop("key", None)
    # A3 layer_contract 引用与子键
    lc = data["layer_contract"]
    ao = lc["assembly_order"]
    assert ao["positive"][2] == "lock_layer.positive_text" \
        and ao["negative"][0] == "lock_layer.negative_text", "[锚] assembly_order 意外"
    ao["positive"][2] = "art_style_base.positive_text"
    ao["negative"][0] = "art_style_base.negative_text"
    assert "lock_layer" in lc["principles"]["p1_var"], "[锚] p1_var 意外"
    lc["principles"]["p1_var"] = lc["principles"]["p1_var"].replace(
        "lock_layer", "art_style_base")
    segs = lc["segments"]
    assert len(segs) == 8 and all("lock_layer" in s for s in segs), "[锚] segments 形态意外"
    for s in segs:
        s["art_style_base"] = s.pop("lock_layer")
    # A4 color_lexicon 引用
    cl = data["color_lexicon"]
    assert cl["scope_rule"].count("lock_layer") == 2, "[锚] scope_rule 引用数意外"
    cl["scope_rule"] = cl["scope_rule"].replace("lock_layer", "art_style_base")
    n_inuse = 0
    for e in cl["entries"].values():
        lu = e.get("in_use", [])
        for i, v in enumerate(lu):
            if "lock_layer" in v:
                lu[i] = v.replace("lock_layer", "art_style_base")
                n_inuse += 1
    assert n_inuse == 4, f"[锚] in_use 引用数意外: {n_inuse}"
    # A5 教材单 token 术语退役([4030] 双刷随本脚本工作流段)
    sp = data["expand_instruction"]["system_prompt_zh"]
    assert sp.count("(主体句+型底座+锁层A)") == 1, "[锚] 教材锁层A token 意外"
    data["expand_instruction"]["system_prompt_zh"] = sp.replace(
        "(主体句+型底座+锁层A)", "(主体句+型底座+美术风格底座)")
    # A6 _doc 中文自注释(6 对象节内嵌首键+_doc_types 顶层伴键置于 types 前)
    DOC = "改法入口=README§字段字典"
    data["art_style_base"] = {"_doc": f"美术风格底座——全十档恒挂的画风锁:画种/线条/罩染/表面工艺/平光契约(positive_text)与全局负面词(negative_text);{DOC}", **data["art_style_base"]}
    data["rgba"] = {"_doc": f"RGBA透明包裹句——透明路头尾句(中英)与W1收束句;head_en/tail_en=i2i/edit 英文路现役消费勿清;{DOC}", **data["rgba"]}
    data["expand_instruction"] = {"_doc": f"扩写指令——[4013] AI扩写的系统提示词教材(system_prompt_zh,八步宪法原文永不删改)与语言规则替换表;1008 负向解耦后输出契约只要求正向键;{DOC}", **data["expand_instruction"]}
    data["strip_lexicon"] = {"_doc": f"清筛词表——PE出文词族剥离正则(en/zh/大小写不敏感);消费方=最终文本合成器透明路;{DOC}", **data["strip_lexicon"]}
    data["layer_contract"] = {"_doc": f"分层契约(内联精简版)——八段公式×三层职责(主体句/类型句/美术风格底座)的引擎侧内联;完整版=同目录 prompt_layering.json;{DOC}", **data["layer_contract"]}
    data["color_lexicon"] = {"_doc": f"色卡词典——在用词↔MA编号+hex 映射/五职责/冲突裁决序;hex 只供人工审稿对表,禁入任何 prompt 正文;{DOC}", **data["color_lexicon"]}
    nd = {}
    for k, v in data.items():
        if k == "types":
            nd["_doc_types"] = f"类型句(十档)——九型+自由的型底座数组:每型 zh 显示名/画幅档/透明默认/型级正负提示词/LoRA 配方等(逐字段释义=README§字段字典;zh=显示名兼唯一选型键,旧冗余 key 字段 1008 R 批删除)"
        nd[k] = v
    data = nd
    out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if not DRY:
        BASES.write_text(out, encoding="utf-8")
    # 语义自检:回读
    rt = json.loads(BASES.read_text(encoding="utf-8")) if not DRY else json.loads(out)
    assert "lock_layer" not in json.dumps(rt, ensure_ascii=False), "[检] 残留 lock_layer"
    a = rt["art_style_base"]
    assert a["positive_text"] == pre["lock_layer"]["positive_text"] \
        and a["negative_text"] == pre["lock_layer"]["negative_text"], "[检] 底座正负全文被误改"
    assert len(rt["types"]) == 10 and not any("key" in t for t in rt["types"]), "[检] types 形态"
    assert [t["zh"] for t in rt["types"]] == [t["zh"] for t in pre["types"]], "[检] 型序漂移"
    assert rt["expand_instruction"]["system_prompt_zh"].count("美术风格底座)") == 1, "[检] 教材 token"
    assert "_doc" in a and "_doc_types" in rt, "[检] _doc 缺席"
    print(f"  [json ] qi21_bases.json:键改名+key删9+segments7+引用9+教材1+_doc7 "
          f"{'落盘' if not DRY else '(dry)'}")


# ═════════════════════════════════════════════════════════════════
# B. prompt_layering.json(结构手术)
# ═════════════════════════════════════════════════════════════════
PL = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/prompt_layering.json"


def surgery_pl() -> None:
    data = json.loads(PL.read_text(encoding="utf-8"))
    ts = data["truth_sources"]
    assert ts["engine_json"] == "apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json", \
        "[锚] engine_json 现值意外"
    ts["engine_json"] = "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
    assert ts["assembly_line"] == 'return (f"{主体句}\\n{BASE}\\n{锁层A全文}", _LOCK_A_NEG)', \
        "[锚] assembly_line 现值意外"
    ts["assembly_line"] = 'return (f"{主体句}\\n{BASE}\\n{锁层A全文}", negative)'
    ts["manual"] = ts["manual"].replace("qi21_bases.json#lock_layer(精简内联版)",
                                        "qi21_bases.json#layer_contract(精简内联版)") \
        if "#lock_layer" in ts["manual"] else ts["manual"]
    ao = data["assembly_order"]
    assert ao["positive_slot"][2] == "美术风格底座(lock_layer.positive_text)" \
        and ao["negative_slot"][0] == "美术风格底座负面(lock_layer.negative_text)", "[锚] 槽序现值意外"
    ao["positive_slot"][2] = "美术风格底座(art_style_base.positive_text)"
    ao["negative_slot"][0] = "美术风格底座负面(art_style_base.negative_text)"
    assert data["layers"]["style_base"]["anchor"] == "qi21_bases.json#lock_layer", "[锚] anchor 意外"
    data["layers"]["style_base"]["anchor"] = "qi21_bases.json#art_style_base"
    # _doc(对象节内嵌;字符串/数组节=顶层 _doc_<名> 伴键置于该节前)
    DOCS = {
        "schema_version": "版本号——本契约 schema 标签,结构大改时才动",
        "title": "标题——本文件一句话定位(八段公式→三层分配契约)",
        "updated": "更新日——最近一次内容修订日(YYYY-MM-DD)",
        "what_this_is": "本文件是什么——完整版三层分配契约自我说明:美术风格底座/类型句/主体句各写什么",
        "truth_sources": "真源登记——装配实现代码/引擎侧内联/手册版指针(路径即权威,改层职责先对这里)",
        "assembly_order": "装配顺序——正负两槽层序与排序理由(每图变的在最前,越往后越稳定)",
        "principles": "三判据——变不变/三级拆解/插槽单向供货,层职责裁决总纲",
        "layers": "三层定义——style_base(美术风格底座,锚=qi21_bases.json#art_style_base)/type_base(类型句)/subject_sentence(主体句)各自的 owns 职责与 forbidden 禁区",
        "segment_matrix": "八段矩阵——八段公式逐段×三层职责归属表(hand_written_per_image=该段是否每图手写)",
        "light_mood_asymmetry": "光与氛围不对称律——光锁类型放参数(底座锁光型),氛围不锁归主体句",
        "cross_rules": "跨层规则——同声/肯定式/覆盖/去重预检/同源五条跨层纪律",
        "known_gaps": "已知缺口——历史留痕与挂账项(~~删除线~~=已清),勿当现行规则引用",
        "color_fusion": "色彩融合——MA 42 色卡与多彩行预算的对接契约(轨道映射/份数制/hex 禁令/冲突裁决序)",
        "subject_constitution": "主体句宪法指针——宪法文档路径与收拢说明(机读真源仍住本家,宪法只引用)",
    }
    OBJ_SECTIONS = {"truth_sources", "assembly_order", "principles", "layers",
                    "light_mood_asymmetry", "color_fusion", "subject_constitution"}
    nd = {}
    for k, v in data.items():
        if k in OBJ_SECTIONS:
            nd[k] = {"_doc": DOCS[k], **v}
        else:
            nd[f"_doc_{k}"] = DOCS[k]
            nd[k] = v
    data = nd
    out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if not DRY:
        PL.write_text(out, encoding="utf-8")
    rt = json.loads(PL.read_text(encoding="utf-8")) if not DRY else json.loads(out)
    assert "lock_layer" not in json.dumps(rt, ensure_ascii=False), "[检] prompt_layering 残留"
    assert rt["layers"]["style_base"]["anchor"].endswith("#art_style_base"), "[检] anchor"
    print(f"  [json ] prompt_layering.json:引用3+assembly_line+engine_json勘误+_doc14 "
          f"{'落盘' if not DRY else '(dry)'}")


# ═════════════════════════════════════════════════════════════════
# C/D. 文本手术表(specific 对+术语规则序)
# ═════════════════════════════════════════════════════════════════
N = REPO / "apps/backend/engines/comfyui/my_nodes"
WFD = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"

TEXT_JOBS: list[dict] = [
    # ── 节点 py ──
    dict(path=N / "nodes/my_daojie_base.py", specific=[
        ('if isinstance(e, dict) and base in (e.get("zh"), e.get("key")):',
         '# 1008 R 批:types[].key 冗余双键删除(九型 key≡zh 同值),选型单读 zh\n'
         '        if isinstance(e, dict) and base == e.get("zh"):', 1),
    ]),
    dict(path=N / "nodes/my_qi21_prompt_assembly.py", specific=[
        ("_LOCK_A = _load_lock_layer()[\"positive\"]",
         "_STYLE_BASE = _load_lock_layer()[\"positive\"]", 1),
        ('"锁层A全文": ("STRING", {"multiline": True, "default": _LOCK_A,',
         '"锁层A全文": ("STRING", {"multiline": True, "default": _STYLE_BASE,', 1),
        ("锁层A全文: str = _LOCK_A)", "锁层A全文: str = _STYLE_BASE)", 1),
        # _LOCK_A 其余裸引用若在(注释),交规则序兜底前先精准换两处历史快照句
    ]),
    dict(path=N / "nodes/my_qi21_api_pe.py", specific=[
        ("lock_neg = str((_load_bases_node().get(\"lock_layer\") or {})",
         "style_base_neg = str((_load_bases_node().get(\"lock_layer\") or {})", 1),
        ('            lock_neg = ""', '            style_base_neg = ""', 1),
        ("for src in (类型句负向, lock_neg, 负向提示词):",
         "for src in (类型句负向, style_base_neg, 负向提示词):", 1),
    ]),
    dict(path=N / "nodes/my_qi21_subject_select.py", specific=[]),
    dict(path=N / "nodes/my_qi21_base.py", specific=[]),
    dict(path=N / "__init__.py", specific=[]),
    dict(path=N / "nodes/my_qi21_bases_text.py", specific=[
        ("  美术风格底座 = lock_layer.positive_text(锁层A全文)",
         "  美术风格底座 = art_style_base.positive_text(装配器参数面旧名「锁层A全文」)", 1),
    ]),
    dict(path=N / "nodes/my_qi21_final_output.py", specific=[]),
    dict(path=N / "nodes/my_qi21_prompt_select.py", specific=[]),
    # ── 测试 ──
    dict(path=N / "tests/test_my_daojie_base.py", specific=[]),
    dict(path=N / "tests/test_my_nodes.py", specific=[]),
    dict(path=N / "tests/test_my_qi21_api_pe.py", specific=[]),
    dict(path=N / "tests/test_my_qi21_base.py", specific=[]),
    dict(path=N / "tests/test_my_qi21_prompt_assembly.py", specific=[
        ('data["lock_layer"]["negative_text"] = "热改锁层负面甲，热改锁层负面乙"',
         'data["art_style_base"]["negative_text"] = "热改底座负面甲，热改底座负面乙"', 1),
        ('assert got == "型负面, 热改锁层负面甲，热改锁层负面乙"',
         'assert got == "型负面, 热改底座负面甲，热改底座负面乙"', 1),
        ('["lock_layer"]["negative_text"]', '["art_style_base"]["negative_text"]', 2),
    ]),
    dict(path=REPO / "apps/backend/engines/comfyui/tests/test_qwen21_workflow_contract.py",
         specific=[
             ('.get("lock_layer", {}).get("positive_text", "")',
              '.get("art_style_base", {}).get("positive_text", "")', 1),
             ('bases["lock_layer"]["negative_text"]',
              'bases["art_style_base"]["negative_text"]', 1),
         ]),
    # ── 活工具 ──
    dict(path=REPO / "apps/build/scripts/lmstudio_9b_ctx_stress_1006.py", specific=[]),
    dict(path=REPO / "apps/build/scripts/daojie-t2i-app-e2e.mjs", specific=[]),
    dict(path=REPO / "apps/build/scripts/qi21_blueprint_sync_1001.py", specific=[
        (r'one(r"\*\*常量 A·基础[^*]*\*\*:\s*\n\n```text\n(.*?)\n```"',
         r'one(r"\*\*美术风格底座常量·基础[^*]*\*\*:\s*\n\n```text\n(.*?)\n```"', 1),
    ]),
    dict(path=REPO / "apps/build/scripts/test_qi21_blueprint_sync_1001.py", specific=[]),
    # ── 工作流+蓝图(卡文;[4030] 教材快照与 json 同步换 token)──
    dict(path=N / "subgraphs/qi21-提示词类型优化子图.json", specific=[
        ("[4032] 美术风格底座:lock_layer.positive_text 热读",
         "[4032] 美术风格底座:art_style_base.positive_text 热读", 2),
        ("(主体句+型底座+锁层A)时=**润炼模式**",
         "(主体句+型底座+美术风格底座)时=**润炼模式**", 1),
        ("收录范围=lock_layer色板词汇表", "收录范围=art_style_base色板词汇表", 1),
        ("『赭黄土色』为lock_layer复合词", "『赭黄土色』为art_style_base复合词", 1),
        ("在用:lock_layer词汇表", "在用:art_style_base词汇表", 4),
    ]),
    dict(path=WFD / "1_文生图/qi21-道劫-t2i.json", specific=[
        ("[4032] 美术风格底座:lock_layer.positive_text 热读",
         "[4032] 美术风格底座:art_style_base.positive_text 热读", 2),
        ("(主体句+型底座+锁层A)时=**润炼模式**",
         "(主体句+型底座+美术风格底座)时=**润炼模式**", 1),
        ("收录范围=lock_layer色板词汇表", "收录范围=art_style_base色板词汇表", 1),
        ("『赭黄土色』为lock_layer复合词", "『赭黄土色』为art_style_base复合词", 1),
        ("在用:lock_layer词汇表", "在用:art_style_base词汇表", 4),
        ("装配自动降级两段拼=主体句+锁层A)+画幅兜底",
         "装配自动降级两段拼=主体句+美术风格底座)+画幅兜底", 2),
        ("装配器参数面(锁层A/头尾句/W1)改后", "装配器参数面(美术风格底座/头尾句/W1)改后", 2),
        ("锁层A负面(lock_layer.negative_text 热读)",
         "美术风格底座负面(art_style_base.negative_text 热读)", 2),
        ("④配色行→③通用锁层;库文档", "④配色行→③美术风格底座;库文档", 2),
        ("锁层A=③层库首节全文", "美术风格底座=③层库首节全文", 2),
        ("+ 锁层A负面(自动),去重合并喂", "+ 美术风格底座负面(自动),去重合并喂", 2),
        ("主体句PE扩写+型底座+锁层A三层拼装全在内",
         "主体句PE扩写+型底座+美术风格底座三层拼装全在内", 1),
    ]),
    dict(path=N / "subgraphs/qi21-提示词类型优化子图-i2i.json", specific=[
        ("(择文+BASE+锁层A)→[153]", "(择文+BASE+美术风格底座)→[153]", 1),
    ]),
    dict(path=WFD / "2_图生图/qi21-道劫-i2i.json", specific=[
        ("自由=无型底座仍挂锁层A);i2i 09-24", "自由=无型底座仍挂美术风格底座);i2i 09-24", 1),
        ("+通用锁层常量A(③层,库首节全文,全十档恒挂;[4011] 参数面 715 字与 qi21_bases.json lock_layer.positive_text 逐字一致=1007 负向式清退版)",
         "+美术风格底座常量(③层,库首节全文,全十档恒挂;[4011] 参数面 715 字与 qi21_bases.json art_style_base.positive_text 逐字一致=1007 负向式清退版)", 1),
        ("BASE 空串仍挂锁层A)——子图内", "BASE 空串仍挂美术风格底座)——子图内", 1),
        ("(择文+BASE+锁层A)→[153]", "(择文+BASE+美术风格底座)→[153]", 1),
    ]),
    # ── 治理文档 ──
    dict(path=REPO / "docs/prompts/Qwen-Image-2.1/08-AI扩写提示词优化规范.md", specific=[]),
    dict(path=REPO / "docs/prompts/Qwen-Image-2.1/00-README.md", specific=[]),
    dict(path=REPO / "docs/comfyui-kb/定制代码地图.md", specific=[]),
    dict(path=REPO / ".agents/skills/comfyui/NODE_LIBRARY/custom-author.md", specific=[]),
    # 漫影工作流清单:main() 行级保护特判(带日期「现状」台账行不动)
    dict(path=REPO / "docs/comfyui-kb/漫影工作流清单.md", specific=[]),
]

# 05库:§六台账(## 六、起)+带日期记录段保护;标题/围栏标签先行精准对
DOC05 = REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
DOC05_SPECIFIC = [
    ("## 二、通用锁层常量(供工作流恒挂层直接取用)",
     "## 二、美术风格底座常量(供工作流恒挂层直接取用)", 1),
    ("**常量 A·基础(", "**美术风格底座常量·基础(", 1),
    ("**常量 A-Neg·通用负面词(", "**美术风格底座常量·通用负面词(", 1),
    ("负向真文=daojie_ink_guofeng/json/qi21_bases.json#lock_layer.negative_text",
     "负向真文=daojie_ink_guofeng/json/qi21_bases.json#art_style_base.negative_text", 1),
]


def surgery_05() -> None:
    raw = DOC05.read_text(encoding="utf-8")
    for old, new, expect in DOC05_SPECIFIC:
        got = raw.count(old)
        assert got == expect, f"[锚] 05库:期望×{expect} 得×{got}: {old[:50]!r}"
        raw = raw.replace(old, new)
    # 保护段:§六台账整节 + 两枚带日期头部 bullet + 多视图型带日期出处行 + §六前空行保险
    lines = raw.split("\n")
    protected_idx: set[int] = set()
    # §六(演进与待裁定)整节
    try:
        six = next(i for i, l in enumerate(lines) if l.startswith("## 六、"))
        protected_idx.update(range(six, len(lines)))
    except StopIteration:
        raise SystemExit("[锚] 05库缺 §六")
    # 带日期记录:头部 0925 两 bullet + 多视图出处(150 行段,按锚词定位其整行)
    for i, l in enumerate(lines):
        if l.startswith("- **0925 军令摘噪轮**") or l.startswith("- **0925 四令多彩轮"):
            protected_idx.add(i)
        if "84.02%)/叠中文三层装配 0%" in l:
            protected_idx.add(i)
    head = [l for i, l in enumerate(lines) if i not in protected_idx]
    kept = [l for i, l in enumerate(lines) if i in protected_idx]
    new_head, counts = apply_rules("\n".join(head))
    # protected 行原样回拼:按原行号序还原整体
    head_out = new_head.split("\n")
    # protected 行在 head 中被移除;重建:逐行迭代原始 lines,protected 用 kept 依序回填
    ki = 0
    out_lines = []
    hi = 0
    for i, l in enumerate(lines):
        if i in protected_idx:
            out_lines.append(kept[ki]); ki += 1
        else:
            out_lines.append(head_out[hi]); hi += 1
    assert ki == len(kept) and hi == len(head_out), "[锚] 05库保护段回拼计数不符"
    out = "\n".join(out_lines)
    assert "锁层" in out or "常量A" in out, "[锚] 05库规则序零命中?"  # §六史仍在=必命中
    if not DRY:
        DOC05.write_text(out, encoding="utf-8")
    print(f"  [doc  ] 05-道劫规范提示词库.md:specific 4 对+规则序 {sum(counts.values())} 处"
          f"(§六台账+带日期记录 3 行保护) {'落盘' if not DRY else '(dry)'}")


def main() -> None:
    print(f"== R 批 splice {'[DRY]' if DRY else ''} ==")
    surgery_bases()
    surgery_pl()
    for job in TEXT_JOBS:
        if job["path"].name == "漫影工作流清单.md":
            # 该文件仅保护「现状」台账行:改用行级保护(带日期台账行不动)
            raw = job["path"].read_text(encoding="utf-8")
            lines = raw.split("\n")
            prot = {i for i, l in enumerate(lines)
                    if l.startswith("| 现状(") or "起步=09-23 三件" in l}
            head = [l for i, l in enumerate(lines) if i not in prot]
            kept = [l for i, l in enumerate(lines) if i in prot]
            new_head, counts = apply_rules("\n".join(head))
            hl = new_head.split("\n")
            out_lines, ki, hi = [], 0, 0
            for i, l in enumerate(lines):
                if i in prot:
                    out_lines.append(kept[ki]); ki += 1
                else:
                    out_lines.append(hl[hi]); hi += 1
            out = "\n".join(out_lines)
            if not DRY:
                job["path"].write_text(out, encoding="utf-8")
            print(f"  [doc  ] 漫影工作流清单.md:规则序 {sum(counts.values())} 处"
                  f"(现状台账行保护) {'落盘' if not DRY else '(dry)'}")
            continue
        text_surgery(job["path"], job["specific"],
                     protect_spans=job.get("protect_spans", ()))
    surgery_05()
    print("== 完成 ==")


if __name__ == "__main__":
    main()
