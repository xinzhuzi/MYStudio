#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 卡片对账刷新 1008(用户令「更新/优化一下」):[402] 用法速查中段对齐
1006 API版PE 现役机制 + [4100] 段说明卡四处实数/流向修正。

背景:逐条对账定谳(1008)——[4100] 结构全对但 27B 兜底/2516字/739字/
width/height 流向四点过期;[402] 骨架对但「装配怎么拼/画幅怎么定/透明怎么定/
PE 改写/负面线/[401] 预览/宿主面板四槽」仍停在 1005/1006 旧机制,与 [4100]
互相矛盾(即 [402] 两节旧机制清偿役的未清尾巴)。

落点(五树指纹扫描 1008 产):数据副本 8 件——仓库×2(t2i 工作流+子图库件)、
装机×2、构建产物×2、引擎家×2(user/default 工作流+custom_nodes 子图);
历史手术脚本(campaigns)与 comfy.log 含旧串=留档不动;MA 树零命中。

DRY_RUN=1 只验串不写盘(默认 apply)。
"""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF_REL = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
SG_REL = "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"

WF_TARGETS = [
    REPO / WF_REL,
    Path("/Applications/漫影工作室.app/Contents/Resources") / WF_REL.replace("apps/backend/", "backend/", 1),
    REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources" / WF_REL.replace("apps/backend/", "backend/", 1),
    Path.home() / "Library/Application Support/漫影工作室/comfyui/ComfyUI/user/default/workflows" / WF_REL.split("workflows/", 1)[1],
]
SG_TARGETS = [
    REPO / SG_REL,
    Path("/Applications/漫影工作室.app/Contents/Resources") / SG_REL.replace("apps/backend/", "backend/", 1),
    REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources" / SG_REL.replace("apps/backend/", "backend/", 1),
    Path.home() / "Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes/subgraphs" / Path(SG_REL).name,
]

DRY = os.environ.get("DRY_RUN", "") == "1"

# ── [402] 三节整节重写(切片=[节头, 下一节头)) ────────────────────────────
SEC_D_OLD_HDR = "### 画幅怎么定(大白话:PE 开=自动,PE 关=可手动)"
SEC_D_NEW = """### 画幅怎么定(大白话:AI 恒开=AI 建议,手动宽高随时可盖)
- **画幅链(1006 API版PE)**:[4013] AI扩写出「画幅宽/画幅高」(以 [4010] 型默认画幅为语境)→[6] width/height 出口→主图 [4018] 画幅建议器(联动开关恒关=原样直通件;MyQi21WhSuggest,1004 迁出子图)→直驱 [4] 空潜;AI 全挂透传=[4010] 型默认画幅原样。
- **想手动**:主图 [4018] 画幅建议器「手动宽」「手动高」两个数字框填成对值(**两个都非 0 才生效、优先生效(8 倍数);只填一个会报错,不猜不代选**;都留 0=跟 AI 建议/型默认;真控件住 [4018] 面板,[6] 面板无同名控件)。
- 旧机制退役注:wh_ratio 出口/「画幅联动开关」联动路(4.2MP 公式)/PE启用? 扇出均随 1006 换装退役——[4018] 联动开关恒关,现役身份=AI/型宽高原样直通件。"""

SEC_F_OLD_HDR = "### 装配怎么拼([400] 唯一手写位;最终文本经 [6] positive/negative 出口过目 [401] 提示词预览)"
SEC_F_NEW = """### 装配怎么拼([400]/[404] 唯一手写位;终稿经 [6] positive/negative 出口在 [401] 双框过目)
- 现役拼法(1006 API版PE,装配内置):[400] 正向主体句+[404] 负向主体句+[4010] 五口(类型句正/负+画幅宽/高+透明值)与三真源([4030] 系统提示词/[4031] 色卡/[4032] 美术风格底座)全进 [4013] AI扩写(MyQi21ApiPE 十入五出;内置三层装配=主体句\\n类型句\\n美术风格底座,逐字复刻旧 [4011] 格式,自由型 BASE 空=两段拼;AI 在装配全文上润炼,三路原文只并入「画面上下文」参考块)→出「正向提示词/负向提示词/透明模式/画幅宽/画幅高」——正/负/透明进 [4014] 最终输出(MyQi21FinalOutput:透明开=RGBA官方头句+正向终稿+W1收束句+官方尾句包裹,无词族剥离;双口「进编码正向文本/进编码负向文本」)→[6] positive/negative 出口(STRING,1004 编码迁出子图)到主图 [4015] 主编码/[4015N] 负向编码;画幅宽/高另路直出 [6] width/height(见画幅节)。
- 负面三源=[4010].负面词(型负面)+锁层A负面(lock_layer.negative_text 热读)+[404] 手写,去重合并喂 [4013] 精炼(不丢条目;AI 全挂=合并直写兜底)。
- AI 全挂(LM Studio 不在/超时/空正文)=透传自装配三层恒有输出(正稿=内置装配原文,负稿=三源合并),产线不炸。
- 层次序注:画布装配行序=①主体句→②型底座→(人物系增量锁)→④配色行→③通用锁层;库文档直写件行序=①②③(内嵌增量锁)④——层内容零差异,仅行序不同(锁层常量恒挂不可拆,增量锁随型走在 BASE 内;锁层A=③层库首节全文,全型恒挂不随型,参数面大框可编辑)。
- 甲案围栏(1006 后语义):装配全文恒中文三层,AI 润炼出中文终稿——旧「英文改写态」与 [4012]/[4021] 互斥路由随官方 PE 退役;禁混条款由真源教材把守。"""

SEC_G_OLD_HDR = "### PE 改写([4013]=QwenImage21_T2IPromptRewrite 官方件+pe_t2i;英文长文出;默认开路;pp=1.5 已定档;1005 用户令回官方设计)"
SEC_G_NEW = """### AI 扩写([4013]=MyQi21ApiPE;中文终稿出;LM Studio Windows 远程 9B;1006 换装+1007 终裁)
- 扩写大脑=Windows LM Studio 9B(qwen3.5-9b-uncensored;api_url 面板可改;**1007夜终裁:恒 Windows 远程 9B,Mac 本机 27B 出局**);api_key 控件填=云端 GLM 优先、云端挂回落本地逐个改写(留空=恒本地,key 永不查);服务不在/超时/空正文=透传自装配三层(恒有输出,不炸产线)。
- 教材真源=qi21_bases.json expand_instruction 节热读(v9,3118字);三真源 [4030]/[4031]/[4032] 连线进 [4013](不连=真源热读兜底);最终编码=主图 [4015]/[4015N] 吃 [2] 主TE不变([4019] 扩写TE 已退役,引擎不载 pe_t2i 的 18GB)。
- thinking_effort 档位:默认「关闭」=reasoning_effort none 硬关(确定性零思考 token,全链 ~40s 内含自检补发);「思考(xhigh)」=模型模板原生档(思考量随机,全链 21s~300s+ 波动)。
- [4013] 输入=十入全上下文(三真源+外部正负手写+[4010] 五口),改写对象=装配全文;宪法=05 库 §一/§六「PE 种子纪律」。
- 起草/改写提示词唤取技能 qwen-image-2-1-prompter。
- 旧机制退役注:QwenImage21_T2IPromptRewrite 官方件/pe_t2i 检查点/英文铁幕补丁/[4012] PE开关(PE启用?)/[4021] 路由均退役留档。"""

# ── [402] 精准替换对(除标注 optional 外,必须恰好命中 1 次) ─────────────────
PAIRS_402 = [
    # A. 简介追加 1006 换装现役块
    ("**1003 手改回灌:布局/位置经用户手定为新标准(结构零增删,生效参数零变化)**(②层底座=09-23 美化版,型名/顺序对齐 qi21_bases.json,原 daojie_bases.json 已并入)。",
     "**1003 手改回灌:布局/位置经用户手定为新标准(结构零增删,生效参数零变化)**(②层底座=09-23 美化版,型名/顺序对齐 qi21_bases.json,原 daojie_bases.json 已并入)。**1006 API版PE 换装:装配子图 10→7 节点=6 功能件+[4100]([4011]/[4012]/[4021]/[4020]/[4019] 退役,三层装配内置 [4013];AI 恒开无 PE 开关,宿主面板三槽=正向/负向/型选择;[4013]=MyQi21ApiPE 十入五出)**。"),
    # B. 换型 bullet 1:[4010] 现役五出
    ("子图内 [4010] 底座九选一(MyQi21DaojieBase:BASE=②层底座+人物系增量四锁B+④配色行逐字=05 库/宽高随型直出/磁盘热读)按选型出 BASE 与 WIDTH/HEIGHT(型档分辨率直出)",
     "子图内 [4010] 底座十选一(MyQi21DaojieBase:BASE=②层底座+人物系增量四锁B+④配色行逐字=05 库/磁盘热读)按选型出五口 BASE/WIDTH/HEIGHT/负面词/透明值(型档分辨率直出),五口全喂 [4013] AI扩写"),
    # C. 分辨率 bullet
    ("- **分辨率**:PE 开=画幅自动跟 PE 建议(见画幅节);PE 关=跟所选型默认画幅,或在面板「手动宽/手动高」填成对非 0 值(0=跟型)。主图 [4018] 画幅建议器 width/height 直驱 [4] 空潜宽高([6] width/height 出口=九型原样直通喂 [4018],1004 迁出子图;九型档=qi21_bases.json 的 aspect/MP/override;多视图=Q2.1侧分档 3:4 Portrait 4.2MP 分张产线)——[4] 面板 1024×1024=**摆设值不生效**(实际由 [4018] 供给)。",
     "- **分辨率**:AI 扩写恒开,画幅跟 [4013] 出的「画幅宽/画幅高」([4010] 型默认画幅作语境;AI 全挂透传=跟型默认)。主图 [4018] 画幅建议器 width/height 直驱 [4] 空潜宽高([6] width/height 出口=[4013] 宽高直通,1004 迁出子图;九型默认档=qi21_bases.json 的 aspect/MP/override;多视图=Q2.1侧分档 3:4 Portrait 4.2MP 分张产线);想盖=[4018] 面板「手动宽/手动高」填成对非 0 值(8 倍数,优先生效;0=跟 AI/型)——[4] 面板 1024×1024=**摆设值不生效**(实际由 [4018] 供给)。"),
    # E1. 透明机制 bullet
    ("- 机制(1001 ④⑥⑦ 落地):旧「RGBA透明」三态控件(跟随型/强制开/强制关)与子图内 [210] 三态选择件已退役——透明布尔唯一来源=底座件 [4010] 第4出「透明值」(⑯ 后四出:BASE/WIDTH/HEIGHT/透明值)(型≠自由=该型 rgba_default;自由型=面板「透明」布尔经 [4010].透明覆盖 直通),纯 BOOLEAN 直布 [4014] 合成器(透明模式参与文本计算,选择边界在合成器内;1004 复拆双编码=主图 [4015]/[4015N]),子图内零自选转换层;透明图必须存 PNG 才保 alpha。",
     "- 机制(1006 API版PE):透明布尔来源=底座件 [4010] 第5出「透明值」(五出:BASE/WIDTH/HEIGHT/负面词/透明值;型≠自由=该型 rgba_default,自由型=[4010] 面板「透明覆盖」widget 直通)→喂 [4013]「透明模式」入槽(AI 按此出透明模式:开=透明素材图勿虚构背景)→[4013] 透明模式出口→[4014] 合成器(透明包裹边界在合成器内;编码在主图 [4015]/[4015N]),子图内零自选转换层;旧三态控件/[210]/线314 直布已退役;透明图必须存 PNG 才保 alpha。"),
    # E2. 自由型透明 bullet
    ("- **「自由」型**:面板出现「透明」开关(true/false,默认 false)手动定;切到九型时该开关自动隐藏(面板布尔值保留不丢,切回自由型还在)。",
     "- **「自由」型**:透明在子图内 [4010] 面板「透明覆盖」widget 手动定(默认 false;九型下被忽略=按型默认,不用管)。"),
    # H. 负面线说明
    ("- **cfg=4 下负面提示词真实参与采样**:中文负面词(PE 关=装配器负面词直写/PE 开=官方 PE 负面槽为空壳,同走直写(案B 直写优先恒生效))经主图 [4015N] 负向编码",
     "- **cfg=4 下负面提示词真实参与采样**:负向终稿=[4013] AI 精炼的「负向提示词」(负面三源合并喂 AI 不丢条目;AI 全挂=三源合并直写兜底)经主图 [4015N] 负向编码"),
    # I1. 参数圣经·分辨率
    ("(1004 迁出子图;宽高恒 8 倍数;PE 开=[6] wh_ratio 出口喂 PE 建议/PE 关=跟型或手动宽高);seed=加速子图宿主面板「seed」;风格终审=用户。",
     "(1004 迁出子图;宽高恒 8 倍数;[6] width/height=[4013] AI 出宽高直通,手动宽高成对非 0 可盖);seed=加速子图宿主面板「seed」;风格终审=用户。"),
    # I3a. RGBA 公式·透明开包裹对象
    ("透明开=中文头句+「 」+装配全文+「 」+W1收束句",
     "透明开=中文头句+「 」+正向终稿(AI 润炼稿;全挂=装配原文)+「 」+W1收束句"),
    # I3b. RGBA 公式·透明关
    ("透明关=装配全文原样直喂 [4015] 主编码(1004 迁出子图);负向=负面词直写原样(不包裹不剥离);透明值自动跟型=[4010] 透明值输出→线314→[4014] 透明模式(九型按型默认,自由型=面板透明开关,见「透明怎么定」节)。",
     "透明关=正向终稿原样直喂 [4015] 主编码(1004 迁出子图);负向=负向终稿原样(不包裹不剥离);透明值自动跟型=[4010] 透明值→[4013](AI 出透明模式)→[4014] 透明模式(九型按型默认,自由型=[4010]「透明覆盖」,见「透明怎么定」节)。"),
    # I4. [401] 预览 bullet
    ("- [401] 最终提示词预览:接 [6] positive 出口(=最终文本 STRING,1004 出口改型)=将进编码的最终文本;跑图前过目。",
     "- [401] 提示词预览(正向+负向):接 [6] positive+negative 双出口;执行后「正向终稿」「负向终稿」两框分区显示(1007深夜二轮:合并框退役),跑图后读框对账。"),
    # J1. 底部双预览
    ("- [401] 正负双预览:运行一次后节点上显示正/负合并终稿(1005 ㊈ 显示通道)",
     "- [401] 正负双预览:运行一次后节点上「正向终稿」「负向终稿」两框分区显示(1007深夜二轮:合并框退役)"),
    # J2. 底部三层合并
    ("- 负面词三层合并:[404]你写的 + [4010]型负面(自动) + 锁层A负面(自动),去重后进负向编码",
     "- 负面词三层合并:[404]你写的 + [4010]型负面(自动) + 锁层A负面(自动),去重合并喂 [4013] AI 精炼(挂=直写)→进负向编码"),
]

# ── [4100] 精准替换对 ────────────────────────────────────────────────────
PAIRS_4100 = [
    ("[4100] 装配子图段说明卡(1006 十一轮终态)",
     "[4100] 装配子图段说明卡(1006 十一轮终态·1008 对账刷新)"),
    ("qi21_bases.json 热读,2516字(八步工作法+色卡选题+透明模式+润炼铁律)",
     "qi21_bases.json 热读,3118字·v9(八步工作法+色卡选题+透明模式+润炼铁律)"),
    ("[4031] 色卡:42色全库(10在用+32备选,含hex/五职责/冲突裁决序)",
     "[4031] 色卡:42色全库(在用10词,含hex/五职责/冲突裁决序)"),
    ("lock_layer.positive_text 热读,739字画风锁",
     "lock_layer.positive_text 热读,715字画风锁(v5.1 否定式清偿后)"),
    ("大脑:LM Studio(远程9B优先→本地27B兜底→全挂自装配三层恒有输出)",
     "大脑:LM Studio Windows 远程9B(1007夜终裁:恒9B,Mac本机27B出局;api_key 填=云端GLM优先、挂了回落本地)→全挂自装配三层恒有输出"),
    ("[4013] AI扩写(装配+润炼) → 正/负终稿+画幅+透明 → [4014] 最终输出\n[4014] → RGBA透明包裹 → 子图出口(positive/negative/width/height) → 主图编码",
     "[4013] AI扩写(装配+润炼) → 正/负/透明 → [4014] 最终输出(画幅宽/高不走[4014],直连子图出口)\n[4014] → RGBA透明包裹 → 子图出口(positive/negative) → 主图编码\n[4013] 画幅宽/高 → 子图出口(width/height) → 主图[4018]→[4]"),
]

NEW_ANCHORS = ["1008 对账刷新", "3118字·v9", "715字画风锁", "恒9B,Mac本机27B出局",
               "AI 恒开=AI 建议", "MyQi21ApiPE 十入五出", "正/负合并终稿不存在占位"]


def fail(msg):
    print("ABORT:", msg)
    sys.exit(1)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def card_text_mutate(node, pairs, sec_pairs, label):
    """双槽同改:ComfyUI 新序列化同时存 widgets_values(列表)与
    widgets_values_named(字典)两份卡文——只改其一=旧文从命名槽复活
    (1008 实弹:首轮复扫 [402] 整卡旧串全在 named 槽;[4100] named 槽更
    滞留 1004 老卡 662 字)。双槽不一致时以能吃下全部配对的现役版为基准,
    术后双槽逐字镜像。"""
    holders = []
    wv = node.get("widgets_values")
    if isinstance(wv, list):
        holders += [(wv, i) for i, v in enumerate(wv)
                    if isinstance(v, str) and len(v) > 300]
    wvn = node.get("widgets_values_named")
    if isinstance(wvn, dict):
        holders += [(wvn, k) for k, v in wvn.items()
                    if isinstance(v, str) and len(v) > 300]
    if not holders:
        fail(f"{label}: 卡文槽定位失败(无 >300 字串槽)")
    raws = [cont[key] for cont, key in holders]

    def transform(t: str) -> str:
        for old, new in sec_pairs:
            start = t.find(old)
            if start < 0:
                raise ValueError(f"节头未命中 {old[:40]!r}")
            end = t.find("\n### ", start)
            if end < 0:
                end = t.find("\n## ", start)
            if end < 0:
                end = len(t)
            t = t[:start] + new + t[end:]
        for old, new in pairs:
            c = t.count(old)
            if c != 1:
                raise ValueError(f"配对命中 {c} 次(须1): {old[:50]!r}")
            t = t.replace(old, new)
        return t

    outs = []
    try:
        for (cont, key), raw in zip(holders, raws):
            outs.append((cont, key, transform(raw)))
        if len({o[2] for o in outs}) == 1:
            for cont, key, t in outs:
                cont[key] = t
            if len(holders) > 1:
                print(f"  {label}: 双槽({len(holders)})同改一致 ✓")
            return outs[0][2]
    except ValueError:
        pass
    # 回退:命名槽滞留旧版(如 [4100] named=1004 老卡)——以唯一能吃下全部
    # 探串的现役版为基准,术后双槽逐字镜像
    probes = [o for o, _ in sec_pairs] + [o for o, _ in pairs]
    bases = [r for r in set(raws) if all(p in r for p in probes)]
    if len(bases) != 1:
        fail(f"{label}: 双槽互异且基准不唯一 lens={sorted(map(len, set(raws)))}")
    t = transform(bases[0])
    for cont, key in holders:
        cont[key] = t
    print(f"  {label}: 命名槽滞留旧版(lens={sorted(map(len, raws))})→镜像现役版 ✓")
    return t


def load_wf(p):
    d = json.loads(p.read_text(encoding="utf-8"))
    n402 = [n for n in d["nodes"] if n.get("id") == 402]
    sg = [s for s in d["definitions"]["subgraphs"] if "文本提示词" in (s.get("name") or "")]
    if len(n402) != 1 or len(sg) != 1:
        fail(f"{p}: 定位 402/子图 失败")
    n4100 = [n for n in sg[0]["nodes"] if n.get("id") == 4100]
    if len(n4100) != 1:
        fail(f"{p}: 定位 4100 失败")
    return d, n402[0], n4100[0]


def main():
    # ── 前置:八副本现 md5 家族一致(防覆写异版) ──
    for fam, name in ((WF_TARGETS, "工作流"), (SG_TARGETS, "子图")):
        sigs = {md5(p) for p in fam if p.exists()}
        missing = [str(p) for p in fam if not p.exists()]
        if missing:
            fail(f"{name}家族缺副本: {missing}")
        if len(sigs) != 1:
            for p in fam:
                print("  ", md5(p), p)
            fail(f"{name}家族副本不一致,先查明再动")
    print("[pre] 八副本两家族 md5 各自一致 ✓")

    # ── 手术(仓库两件) ──
    d, n402, n4100 = load_wf(WF_TARGETS[0])
    t402 = card_text_mutate(n402, PAIRS_402,
                            [(SEC_D_OLD_HDR, SEC_D_NEW), (SEC_F_OLD_HDR, SEC_F_NEW),
                             (SEC_G_OLD_HDR, SEC_G_NEW)], "[402]")
    t4100a = card_text_mutate(n4100, PAIRS_4100, [], "[4100/t2i]")

    sg = json.loads(SG_TARGETS[0].read_text(encoding="utf-8"))
    sub = sg["definitions"]["subgraphs"]
    if len(sub) != 1:
        fail("子图库件 definitions 数异常")
    n4100b = [n for n in sub[0]["nodes"] if n.get("id") == 4100]
    if len(n4100b) != 1:
        fail("子图库件定位 4100 失败")
    t4100b = card_text_mutate(n4100b[0], PAIRS_4100, [], "[4100/库]")
    if t4100a != t4100b:
        fail("两处 [4100] 术后文本不一致")

    if DRY:
        print(f"[dry] 验串全过:402={len(t402)}字 4100={len(t4100a)}字(未写盘)")
        return

    WF_TARGETS[0].write_text(
        json.dumps(d, ensure_ascii=False, indent=2, separators=(",", ": ")),
        encoding="utf-8")
    SG_TARGETS[0].write_text(
        json.dumps(sg, ensure_ascii=False, indent=2, separators=(",", ": ")),
        encoding="utf-8")
    print("[write] 仓库两件已落盘")

    # ── 同步其余六副本 ──
    for src, dsts in ((WF_TARGETS[0], WF_TARGETS[1:]), (SG_TARGETS[0], SG_TARGETS[1:])):
        for dst in dsts:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            if md5(dst) != md5(src):
                fail(f"同步校验失败: {dst}")
    print("[sync] 装机/构建/引擎家 六副本已同 md5 ✓")

    # ── 终验:JSON 可解析 + 新锚在场 ──
    for p in (*WF_TARGETS, *SG_TARGETS):
        json.loads(p.read_text(encoding="utf-8"))
    blob = WF_TARGETS[0].read_text(encoding="utf-8") + SG_TARGETS[0].read_text(encoding="utf-8")
    for a in NEW_ANCHORS[:-1]:
        if a not in blob:
            fail(f"新锚缺失: {a}")
    print("[verify] 8 件 JSON 合法 + 新锚全在 ✓")


if __name__ == "__main__":
    main()
