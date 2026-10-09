#!/usr/bin/env python3
"""qi21 S1 负向解耦手术(2026-10-08,Trellis 10-04-qi21-prompt-cleanup S1+S2 耦合批)。

1008 用户终裁「模型不再管理负向词,只给模型正向词…负向词一路由程序组合,输出到最后」
落地四改(全部带旧串锚断言,fail-closed 不落盘):
  ①输入侧解耦——模型上下文块移除[负面词清单](只留正稿结构/画幅/透明运行约束+色卡);
  ②输出侧确定性——终稿负向恒=三源(型/锁层/外部主体)程序合并·去重·清洗(neg_out),
    模型负向键一律忽略;首稿/重试/拒收回退/透传全路径同值;
  ③清洗根修——_sanitize_negative() 全脏输入返回空串(旧=回传原文泄漏脏词);
  ④零违例接收门——自检清单重构(「负向三源在场」检随解耦退役,对象=模型负向稿
    已不存在)+新增正负撞词检(模型正向稿含负向语料 token=拒收;豁免表=同域合法
    术语,唯一在案=「大气透视」≠负向「透视」机位/形变缺陷义,干跑 A/B/C 三轮
    十型装配文+教材指令词+实弹样例稿零假红);重试稿零违例才收,仍有违例/补发
    失败/重试解析失败=拒收模型稿回退装配 direct 正稿(print 日志+引擎 history
    可查,零新画布口)。

旧「违例更少者胜」接收门(第二稿更少即收/未更优保留第一稿)就此退役——不以
违例变少作为通过条件。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
TARGET = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_api_pe.py"

src = TARGET.read_text(encoding="utf-8")


def splice(old: str, new: str, tag: str) -> None:
    global src
    n = src.count(old)
    assert n == 1, f"[{tag}] 旧串应恰出现 1 次,得 {n} 次(fail-closed)"
    src = src.replace(old, new)
    print(f"[ok] {tag}")


# ── ③ _sanitize_negative 根修:全脏返回空串 ─────────────────────────────────
splice(
    '''    实弹档案:场景终稿负向末尾被 9B 自补「远处」、人物被自补「远处, 背景」
    ——型负面/锁层负面/装配代码三处真源恒无(1007 复核六词零命中),且与
    正向内容词(远景淡墨云海等)直接打架=负向禁画远处/背景,正向又要画。
    剥除=确定性后处理,不依赖模型听话;按整词剥(逗号分词,非子串替换),
    真源负面若未来合法引入这些词须同步修订本表。
    """
    if not neg:
        return neg''',
    '''    实弹档案:场景终稿负向末尾被 9B 自补「远处」、人物被自补「远处, 背景」
    ——型负面/锁层负面/装配代码三处真源恒无(1007 复核六词零命中),且与
    正向内容词(远景淡墨云海等)直接打架=负向禁画远处/背景,正向又要画。
    剥除=确定性后处理,不依赖模型听话;按整词剥(逗号分词,非子串替换),
    真源负面若未来合法引入这些词须同步修订本表。
    1008 解耦终裁后本函数只清洗三源源词合并结果(模型负向键已不采信):
    全脏输入清洗后返回空串(旧=回传原文,脏词泄漏进负向编码器的缺陷就此根修),
    合法词项原样保留不改写。
    """
    if not neg:
        return neg''',
    "sanitize docstring",
)
splice(
    '''        out.append(p)
    return "".join(out) or neg''',
    '''        out.append(p)
    return "".join(out)''',
    "sanitize all-dirty→empty",
)

# ── ④ 自检重构:签名去 neg 参+负向三源在场检退役+撞词检新增 ────────────────
splice(
    '''def _self_check(pos: str, neg: str, neg_tokens: list[str],
                transparent: bool, subj: str) -> list[str]:
    """出稿机器自检(1006 B案:节点自检+有界重试)。
    三检全确定性:①负向三源逐条在场 ②透明开禁指令词/环境词 ③主体句色词逐字在场。
    违例清单非空=可补发;锚点类(云海/匾额等名词)无法确定性判定,不在此检。"""
    v: list[str] = []
    pos_c, neg_c = _squash(pos), _squash(neg)  # 空白归一:"软 3D"与"软3D"判同
    for tok in neg_tokens:
        if _squash(tok) not in neg_c:
            v.append(f"负向缺:{tok}")
    if transparent:''',
    '''# 正负撞词豁免表(语义分组声明,08§8 断言语义纪律):键=负向 token,值=正向
# 同域合法术语组——匹配前先从正向稿剥除豁免词组再检该 token,防假红误杀合法
# 正向稿。干跑三轮(2026-10-08,S1 批在档):A=十型装配正向直写文×三源负向零撞;
# B=教材指令词域,唯一命中=「透视」×「大气透视」(教材第六步关模式明令氛围词,
# 负向「透视」=多视图/表情差分型机位/形变缺陷义,非该氛围词)→立本豁免;
# C=实弹样例稿三件(27B 实弹/透明稿/八步产出长文)带豁免零撞。新豁免须先补干跑。
_CLASH_EXEMPT: dict[str, tuple[str, ...]] = {
    "透视": ("大气透视",),
}


def _pos_neg_clash(pos: str, neg_tokens: list[str]) -> list[str]:
    """正负撞词检(1008 用户令):模型正向稿含负向语料 token=违例拒收。

    负向已由三源程序构造(解耦终裁),正向稿再撞负向 token=同一画面既要求又
    禁画的正负冲突唯一残余面,零违例接收门在此拦死。空白归一两侧同规(同
    C14 配方);豁免词组先剥后检(见 _CLASH_EXEMPT 声明),拆写变体(透视变形/
    透视缩短/广角畸变等)仍被各自原词 token 命中,不因豁免漏网。"""
    pos_c = _squash(pos)
    v: list[str] = []
    for tok in neg_tokens:
        probe = pos_c
        for ex in _CLASH_EXEMPT.get(tok, ()):
            probe = probe.replace(_squash(ex), "")
        if _squash(tok) in probe:
            v.append(f"正负撞词:{tok}")
    return v


def _self_check(pos: str, neg_tokens: list[str],
                transparent: bool, subj: str) -> list[str]:
    """出稿机器自检(1006 B案立;1008 解耦终裁重构为零违例接收门清单)。
    六检全确定性:①透明开禁指令词/环境词残留 ②关模式环境词保留 ③主体句色词
    逐字在场 ④境界词 ⑤部件名词 ⑥正负撞词(_pos_neg_clash)。
    「负向三源在场」检随解耦退役(其对象=模型负向稿,输出侧已不采信,终稿负向
    恒由源词程序构造=结构性不缺词)。违例清单非空=不合格稿,零违例才收;
    锚点类(匾额等普通名词)无法确定性判定,仍不在此检。"""
    v: list[str] = []
    pos_c = _squash(pos)  # 空白归一:"软 3D"与"软3D"判同
    if transparent:''',
    "self_check rebuild head",
)

splice(
    '''    for pt in _PART_TOKENS:
        if pt in subj and pt not in pos_c:
            v.append(f"部件丢:{pt}")
    return v''',
    '''    for pt in _PART_TOKENS:
        if pt in subj and pt not in pos_c:
            v.append(f"部件丢:{pt}")
    v.extend(_pos_neg_clash(pos, neg_tokens))
    return v''',
    "self_check clash wiring",
)

# ── ② neg_out 确定性负向 + ① 上下文移除负面清单 ────────────────────────────
splice(
    '''        neg_fallback = ", ".join(neg_tokens)
        ctx = ["--- 画面上下文(色卡用词与画风基调参考) ---"]
        if style:
            ctx.append("[正稿结构] 主体句\\n型底座\\n美术风格底座 三层(基底即上文)")
        if neg_fallback:
            ctx.append("[负面词清单] " + neg_fallback +
                       "(逐条精炼合并去重后写进 negative_prompt,可补通用负面,不丢条目)")
        if 画幅宽 and 画幅高:''',
    '''        # 1008 负向解耦终裁(用户令「模型不再管理负向词…负向词一路由程序组合,
        # 输出到最后」):①输入侧——负面清单不再送模型,上下文块只留正稿结构/
        # 画幅/透明运行约束(色卡在系统消息侧);②输出侧——终稿负向恒=三源源词
        # 程序合并·去重·清洗(neg_out),模型返回负向键一律忽略,首稿/重试/拒收
        # 回退/透传全路径同值(确定性)。
        neg_out = _sanitize_negative(", ".join(neg_tokens))
        ctx = ["--- 画面上下文(色卡用词与画风基调参考) ---"]
        if style:
            ctx.append("[正稿结构] 主体句\\n型底座\\n美术风格底座 三层(基底即上文)")
        if 画幅宽 and 画幅高:''',
    "ctx decouple + neg_out",
)
splice(
    '''        # 负面三源(型负面+锁层负面热读+外部负向)去重合并——AI 精炼,挂=直出
        try:''',
    '''        # 负面三源(型负面+锁层负面热读+外部负向)去重合并——终稿负向唯一真源
        # (程序构造不进模型,1008 解耦;挂=同值直出)
        try:''',
    "rewrite docstring neg line",
)

# 透传(全目标不可达)路改 neg_out
splice(
    '''            return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [neg_fallback],
                           "api_pe_status": [_status]},
                    "result": (direct, neg_fallback, 透明模式, 画幅宽 or 0, 画幅高 or 0)}''',
    '''            return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [neg_out],
                           "api_pe_status": [_status]},
                    "result": (direct, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}''',
    "passthrough→neg_out",
)

# ── ④ 接收门重构:首稿/重试/拒收回退 ────────────────────────────────────────
splice(
    '''        obj = _balanced_json(content) or _balanced_json(reasoning[-4000:])
        pos = obj.get("rewritten_prompt") if obj else None
        if isinstance(pos, str) and pos.strip():
            neg = obj.get("negative_prompt")
            pos_s, neg_s = pos.strip(), (neg.strip() if isinstance(neg, str) else "")
            neg_s = _sanitize_negative(neg_s or neg_fallback)
            if 透明模式:
                pos_s = _strip_env_parens(_strip_env_sentences(pos_s, subj))
            # 1006 B案(用户拍板):出稿机器自检——①负向三源逐条 ②透明开黑名单
            # ③色词逐字;不过=同模型补发一次(缺什么点什么),两稿取违例更少者。
            v1 = _self_check(pos_s, neg_s, neg_tokens, bool(透明模式), subj)
            if v1:
                print(f"[漫影 API扩写PE] 机器自检 {len(v1)} 项不过({';'.join(v1[:6])}"
                      f"{'…' if len(v1) > 6 else ''})——同模型补发一次")
                try:
                    pl = dict(payload)
                    pl["messages"] = payload["messages"][:-1] + [
                        {"role": "user",
                         "content": payload["messages"][-1]["content"]
                         + "\\n你上一稿机器自检未过,逐项修正后重出完整 JSON(单行,只输出 JSON):"
                         + ";".join(v1[:12])
                         + "。以上缺失词逐字补进对应字段,违禁词从正文删除,"
                           "其余内容与上一稿保持一致,只做最小修正。"}]
                    resp3 = _post(pl)
                    _m3 = (resp3.get("choices") or [{}])[0].get("message", {})
                    _c3 = (_m3.get("content") or "").strip()
                    _r3 = str(_m3.get("reasoning_content") or "")
                    _o3 = _balanced_json(_c3) or _balanced_json(_r3[-4000:])
                    _p3 = _o3.get("rewritten_prompt") if _o3 else None
                    if isinstance(_p3, str) and _p3.strip():
                        _n3 = (_o3.get("negative_prompt")
                               if isinstance(_o3.get("negative_prompt"), str) else "")
                        _n3 = _sanitize_negative(_n3.strip() or neg_fallback)
                        _p3s = _strip_env_parens(_strip_env_sentences(
                            _p3.strip(), subj)) if 透明模式 else _p3.strip()
                        v2 = _self_check(_p3s, _n3, neg_tokens,
                                         bool(透明模式), subj)
                        if len(v2) < len(v1):
                            print(f"[漫影 API扩写PE] 自检重奏效:{len(v1)}→{len(v2)} 项"
                                  f"{('(余:' + ';'.join(v2[:4]) + ')') if v2 else '(全过)'}——取第二稿")
                            pos_s, neg_s, v1 = _p3s, _n3, v2
                        else:
                            print(f"[漫影 API扩写PE] 自检重试未更优({len(v2)}≥{len(v1)})——保留第一稿")
                except Exception as exc:
                    print(f"[漫影 API扩写PE] 自检补发失败({exc})——保留第一稿")
            print(f"[漫影 API扩写PE] 扩写完成:{len(pos_s)}字,"
                  f"耗时 {time.time() - t0:.0f}s(全上下文:系统提示词/色卡/"
                  f"风格/型底座/外部原文/透明)")
            _ok = f"AI扩写OK:{served}"
            if cloud_mode and not served.endswith("(云端)"):
                _ok += "(云端失败→本地回落改写)"
            return {"ui": {"api_pe_pos": [pos_s], "api_pe_neg": [neg_s],
                           "api_pe_status": [_ok]},
                    "result": (pos_s, neg_s, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
        print(f"[漫影 API扩写PE] 答文无 rewritten_prompt(解析失败)——透传原文;"
              f"正文{len(content)}字/思考{len(reasoning)}字,正文头200:{content[:200]!r}")
        return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [neg_fallback],
                       "api_pe_status": ["透传:答文解析失败"]},
                "result": (direct, neg_fallback, 透明模式, 画幅宽 or 0, 画幅高 or 0)}''',
    '''        obj = _balanced_json(content) or _balanced_json(reasoning[-4000:])
        pos = obj.get("rewritten_prompt") if obj else None
        if isinstance(pos, str) and pos.strip():
            # 模型负向键(negative_prompt)一律不采信(1008 解耦):终稿负向恒=neg_out
            pos_s = pos.strip()
            if 透明模式:
                pos_s = _strip_env_parens(_strip_env_sentences(pos_s, subj))
            # 零违例接收门(1008 用户令):自检任一违例=不合格稿——首稿零违例直收;
            # 违例=同模型补发一次(缺什么点什么),重试稿零违例才收;重试仍有违例/
            # 重试解析失败/补发请求失败=拒收模型稿,回退已装配 direct 正稿
            # (拒收可见性=节点 print 日志+引擎 history;零新画布口,恒有输出不炸产线)。
            v1 = _self_check(pos_s, neg_tokens, bool(透明模式), subj)
            if v1:
                print(f"[漫影 API扩写PE] 机器自检 {len(v1)} 项违例({';'.join(v1[:6])}"
                      f"{'…' if len(v1) > 6 else ''})——同模型补发一次(零违例才收)")
                try:
                    pl = dict(payload)
                    pl["messages"] = payload["messages"][:-1] + [
                        {"role": "user",
                         "content": payload["messages"][-1]["content"]
                         + "\\n你上一稿机器自检未过,逐项修正后重出完整 JSON(单行,只输出 JSON):"
                         + ";".join(v1[:12])
                         + "。以上缺失词逐字补进对应字段,违禁词从正文删除,"
                           "其余内容与上一稿保持一致,只做最小修正。"}]
                    resp3 = _post(pl)
                    _m3 = (resp3.get("choices") or [{}])[0].get("message", {})
                    _c3 = (_m3.get("content") or "").strip()
                    _r3 = str(_m3.get("reasoning_content") or "")
                    _o3 = _balanced_json(_c3) or _balanced_json(_r3[-4000:])
                    _p3 = _o3.get("rewritten_prompt") if _o3 else None
                    if not (isinstance(_p3, str) and _p3.strip()):
                        print(f"[漫影 API扩写PE] 拒收:重试稿解析失败(无 rewritten_prompt)"
                              f"——模型稿全部拒收,回退装配正稿(direct {len(direct)}字+"
                              f"三源确定性负向 {len(neg_out)}字);引擎 history 可查本行")
                        return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [neg_out],
                                       "api_pe_status": ["拒收回退:重试解析失败,透传装配正稿"]},
                                "result": (direct, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
                    _p3s = _strip_env_parens(_strip_env_sentences(
                        _p3.strip(), subj)) if 透明模式 else _p3.strip()
                    v2 = _self_check(_p3s, neg_tokens, bool(透明模式), subj)
                    if v2:
                        print(f"[漫影 API扩写PE] 拒收:重试稿仍有 {len(v2)} 项违例"
                              f"({';'.join(v2[:6])};首稿违例={';'.join(v1[:6])})"
                              f"——模型稿全部拒收(违例变少不算过),回退装配正稿"
                              f"(direct {len(direct)}字+三源确定性负向 {len(neg_out)}字);"
                              f"引擎 history 可查本行")
                        return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [neg_out],
                                       "api_pe_status": ["拒收回退:自检违例未清,透传装配正稿"]},
                                "result": (direct, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
                    print(f"[漫影 API扩写PE] 自检重试零违例({len(v1)}→0)——取第二稿")
                    pos_s = _p3s
                except Exception as exc:
                    print(f"[漫影 API扩写PE] 拒收:自检补发失败({exc})"
                          f"——模型稿全部拒收,回退装配正稿(direct {len(direct)}字+"
                          f"三源确定性负向 {len(neg_out)}字);引擎 history 可查本行")
                    return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [neg_out],
                                   "api_pe_status": ["拒收回退:补发失败,透传装配正稿"]},
                            "result": (direct, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
            print(f"[漫影 API扩写PE] 扩写完成:{len(pos_s)}字,"
                  f"耗时 {time.time() - t0:.0f}s(全上下文:系统提示词/色卡/"
                  f"风格/型底座/外部原文/透明;负向=三源程序构造 {len(neg_out)}字)")
            _ok = f"AI扩写OK:{served}"
            if cloud_mode and not served.endswith("(云端)"):
                _ok += "(云端失败→本地回落改写)"
            return {"ui": {"api_pe_pos": [pos_s], "api_pe_neg": [neg_out],
                           "api_pe_status": [_ok]},
                    "result": (pos_s, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}
        print(f"[漫影 API扩写PE] 答文无 rewritten_prompt(解析失败)——透传原文;"
              f"正文{len(content)}字/思考{len(reasoning)}字,正文头200:{content[:200]!r}")
        return {"ui": {"api_pe_pos": [direct], "api_pe_neg": [neg_out],
                       "api_pe_status": ["透传:答文解析失败"]},
                "result": (direct, neg_out, 透明模式, 画幅宽 or 0, 画幅高 or 0)}''',
    "acceptance gate rebuild",
)

# ── 教材热读兜底同批过账(输出契约单键,A3 同量级) ────────────────────────────
splice(
    '''        textbook = ("你是图像提示词扩写专家。把用户的画面需求扩写为一段完整的中文"
                    "画面描述长文(300-800字),观察者口吻;用户固定的名词/数量/颜色/"
                    "位置逐字保留。输出单行 JSON:"
                    '{"rewritten_prompt": "<中文长文>", "negative_prompt": "<中文负面清单>", '
                    '"wh_ratio": "<如 3:4>"}')''',
    '''        textbook = ("你是图像提示词扩写专家。把用户的画面需求扩写为一段完整的中文"
                    "画面描述长文(篇幅软参考300-800字),观察者口吻;用户固定的名词/数量/"
                    "颜色/位置逐字保留。输出单行 JSON:"
                    '{"rewritten_prompt": "<中文长文>"}')''',
    "hot fallback contract",
)

# ── 语义自检(离场/在场标记) ──────────────────────────────────────────────────
MUST_ABSENT = ("[负面词清单]", "两稿取违例更少者", "自检重试未更优", "保留第一稿",
               "neg_s", "_n3", "neg_fallback")
MUST_PRESENT = ("neg_out = _sanitize_negative", "_pos_neg_clash", "_CLASH_EXEMPT",
                "正负撞词:", "拒收", "零违例才收", "return \"\".join(out)")
for mark in MUST_PRESENT:
    assert mark in src, f"[语义自检] 应在场标记缺失:{mark}"
for mark in MUST_ABSENT:
    assert mark not in src, f"[语义自检] 应离场标记残留:{mark}"

# 语法门
import ast  # noqa: E402
ast.parse(src)

TARGET.write_text(src, encoding="utf-8")
print(f"[落盘] {TARGET} ({len(src)} chars)")
