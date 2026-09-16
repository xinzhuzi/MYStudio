#!/usr/bin/env python3
"""MY-K2_文生图_超集 负向直通改造 v2(09-15 晚终态,实测定谳)。

v1(已退役):加 64/65 负向链但经 [52] ConditioningZeroOut 归零 + 文案教
「Bypass+CFG 3~5」——cfg=1 设计点下负向数学上不参与,当时属预留开关。

v2(本版,依据 09-15 turbo 实弹 A/B/C/D 对拍):
  实测事实:cfg=1 同种子改负向 → 像素全同(负向零效);
           cfg=3 同种子改负向 → 30.5% 像素差异(负向确凿参与)。
  手术内容:
    1. [52] ConditioningZeroOut 退役(删节点+清链接+清 IO 引用)。
    2. 负向直通:[64]负向提示词 → [60]风格库.negative → [65]负向编码
       → KSampler.negative(不经零化)。
    3. KSampler cfg 默认 1→3(负向生效档);要回纯官方档=手调 cfg 1,
       负向自动失效,无需改线。
    4. 标题改写(实测口径);④组框改题(链路描述去零化)。
    5. [42] MarkdownNote 说明卡退役(09-15 用户裁定:文件名已表达该工作流
       是什么,画布不再放「K2 文生图 · 超集档」说明卡)。
    6. 工作流零侵入(09-15 用户终裁):出图日志纯引擎侧(prompt_log_server
       队列钩子,落 <comfy-home>/logs/),画布不放任何日志节点;若检出
       历史 [67] MyPromptLog 一并摘除恢复直连。
    7. 尺度 LoRA 默认旁路(09-15 深夜工笔画风对账后用户裁定):写实向
       Mystic XXX ×2.0 / pussy ×0.15 与画风线描平涂互斥,默认形态
       mode=4 旁路([19] identity 保留激活);要破限=画布右键节点
       Remove Bypass,无需改线。
  v3(09-16 LoRA 阵容定档,五档矩阵实测后;详见 Trellis 09-16-superset-lora-tier-0916/research/decision.md):
    8. [67] 细节滑杆默认激活 ×1.0(矩阵定档:×0.7 无效/×1.0 增益明显无伪影/×1.3 噪底抬升);
       模型链扩容 45→46→47→67→68→69→70→14,67-70 build-if-missing。
    9. [68/69/70] 画风件保持默认旁路(互斥,一次只开一枚)+触发词 title 固化;
       [66] 速查卡两档口径(速度档=默认 4步/cfg1+47+67×1.0;质量档=旁路47+12步/cfg5+67 保持)。
    10. 历史 [67] MyPromptLog 退役块加 type 守卫——新 [67] 是 LoRA 节点,按 id 退役会误删。
  门(不过即退出码 1):链接双向一致 / 正负两条链端到端 / 无 52 残留 /
  负向直通 KSampler.slot2 / cfg=1(速度档) / 44·45 mode=4 / last_node_id·last_link_id 更新 /
  67 激活×1.0·68/69/70 旁路含触发词·七跳模型链·66 卡两档口径。
  幂等:v3 态重跑零改动;v2/v1 态重跑收敛到 v3。
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-K2_文生图_超集.json"

GREEN = "#4d9e6a"
GREEN_BG = "#1f2f26"

# v3 定档常量(09-16 矩阵实测:×0.7 无效/×1.0 增益明显无伪影/×1.3 噪底抬升)
DETAIL_SLIDER_STRENGTH = 1.0
DETAIL_SLIDER_FILE = "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors"

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


def node(d: dict, nid: int) -> dict:
    hits = [n for n in d["nodes"] if n["id"] == nid]
    if not hits:
        raise SystemExit(f"节点 {nid} 不存在")
    return hits[0]


def out_slot(n: dict, idx: int) -> dict:
    return n["outputs"][idx]


def in_slot(n: dict, idx: int) -> dict:
    return n["inputs"][idx]


def main() -> int:
    d = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in d["nodes"]}

    # ---- widgets named 对齐(v1 遗产,保持) ----
    # 09-15 风格节点迁移(MyStylesLibrary,art_skills 现读)后新形态:widget 只剩 style 一枚,
    # 与 manying_styles_node_migration.py 收敛目标一致(无条件赋值=幂等,互跑皆稳)。
    # 执行序敏感:从旧态(easy stylesSelector)只跑本脚本会产出 type 仍旧的中间红态
    # (styles combo 是文件名集合,不含「2D工笔风」→前端 value not in list),
    # 须以迁移脚本至少跑过一次为收敛条件。
    n60, n63 = node(d, 60), node(d, 63)
    n60["widgets_values"] = ["2D工笔风"]
    n60["widgets_values_named"] = {"style": "2D工笔风"}
    neutral = "1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0"
    n63["widgets_values"] = [1, neutral]
    n63["widgets_values_named"] = {"multiplier": 1, "per_layer_weights": neutral}
    n4, n61 = node(d, 4), node(d, 61)
    if "filename_prefix" in (n4.get("widgets_values_named") or {}):
        n4["widgets_values_named"]["filename_prefix"] = n4["widgets_values"][0]
    if "aspect_ratio" in (n61.get("widgets_values_named") or {}):
        n61["widgets_values_named"] = {
            "aspect_ratio": n61["widgets_values"][0],
            "megapixels": n61["widgets_values"][1],
            "multiple": n61["widgets_values"][2],
        }
    nodes[50]["title"] = "[50] 正向提示词"
    # 09-16 默认句换工笔媒介句(用户裁定"剩下的问题做完";旧水彩句是工笔跑偏主犯①)
    # 09-17 三次修(用户实况裁定:直接拿风格跑,[50]留空):默认空=纯底座风格图,
    # 主体句按需手写(参考66卡正向写法);避免换风格被上一风格主体句污染
    nodes[50]["widgets_values"] = [""]
    nodes[50]["title"] = "[50] 主体句(可选:人物/五官/服装/场景/方位;留空=纯底座风格图)"
    # v3.1(09-16 用户令「按照你的建议去做」):[50] named 对齐 positional 工笔句
    # ——溯源定谳 named 原值是 v1 遗产模板句(v2 脚本 named 对齐名单漏 50 入库),
    # named 优先装载会遮蔽用户裁定的工笔默认句;对齐后画布/API/日志三面同值。
    nodes[50]["widgets_values_named"] = {"value": nodes[50]["widgets_values"][0]}
    nodes[51]["title"] = "[51] 正向编码"
    n60["title"] = "[60] 漫影风格库(art_skills 现读·正负词同注入)"

    # ---- 64/65 存在性(v1 已建;缺失则按 v1 形态补建) ----
    if 64 not in nodes:
        nodes[64] = {
            "id": 64, "type": "PrimitiveStringMultiline", "pos": [40.0, 790.0], "size": [460, 200],
            "flags": {}, "order": 64, "mode": 0, "inputs": [],
            "outputs": [{"name": "STRING", "type": "STRING", "links": [27], "slot_index": 0}],
            "properties": {"Node name for S&R": "PrimitiveStringMultiline"},
            "widgets_values": [""], "color": GREEN, "bgcolor": GREEN_BG,
        }
        d["nodes"].append(nodes[64])
    if 65 not in nodes:
        nodes[65] = {
            "id": 65, "type": "CLIPTextEncode", "pos": [1210.0, 830.0], "size": [430, 230],
            "flags": {}, "order": 65, "mode": 0,
            "inputs": [{"name": "clip", "type": "CLIP", "link": 28}, {"name": "text", "type": "STRING", "link": 29}],
            "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": [30], "slot_index": 0}],
            "properties": {"Node name for S&R": "CLIPTextEncode"},
            "widgets_values": [""], "color": GREEN, "bgcolor": GREEN_BG,
        }
        d["nodes"].append(nodes[65])
    nodes = {n["id"]: n for n in d["nodes"]}

    # ---- [52] 零化退役(v2 核心;幂等:无 52 即跳过) ----
    if 52 in nodes:
        drop = {l[0] for l in d["links"] if l[1] == 52 or l[3] == 52}
        d["links"] = [l for l in d["links"] if l[0] not in drop]
        d["nodes"] = [n for n in d["nodes"] if n["id"] != 52]
        for n in d["nodes"]:
            for o in n.get("outputs", []):
                if isinstance(o.get("links"), list):
                    o["links"] = [i for i in o["links"] if i not in drop]
            for i_ in n.get("inputs", []):
                if i_.get("link") in drop:
                    i_["link"] = None
        nodes = {n["id"]: n for n in d["nodes"]}

    # ---- [67] 出图日志节点退役(幂等:历史遗留摘除;日志纯引擎侧) ----
    # v3 守卫:新 [67] 是细节滑杆 LoRA 节点,仅当日志件(type 匹配)才退役,防误删
    if 67 in nodes and nodes[67].get("type") == "MyPromptLog":
        drop67 = {l[0] for l in d["links"] if l[1] == 67 or l[3] == 67}
        d["links"] = [l for l in d["links"] if l[0] not in drop67]
        d["nodes"] = [n for n in d["nodes"] if n["id"] != 67]
        for n in d["nodes"]:
            for o in n.get("outputs", []):
                if isinstance(o.get("links"), list):
                    o["links"] = [i for i in o["links"] if i not in drop67] or None
            for i_ in n.get("inputs", []):
                if i_.get("link") in drop67:
                    i_["link"] = None
        nodes = {n["id"]: n for n in d["nodes"]}

    # ---- 链接收敛(规范拓扑,签名幂等):负向直通 65→12.2;日志节点串联 ----
    # 64→60.1 负词入风格库 / 15→65.0 TE / 65→12.2 负向直通
    # 60.0→67.0 与 60.1→67.1(风格库正/负出→日志)→ 67→51.1 与 67→65.1(→编码)
    # 20.0→67.3 seed 随行
    CANON = [
        [27, 64, 0, 60, 1, "STRING"],
        [28, 15, 0, 65, 0, "CLIP"],
        [30, 65, 0, 12, 2, "CONDITIONING"],
        [34, 60, 0, 51, 1, "STRING"],
        [35, 60, 1, 65, 1, "STRING"],
    ]
    sig = {(l[1], l[2], l[3], l[4]) for l in CANON}
    dropped = {l[0] for l in d["links"] if (l[1], l[2], l[3], l[4]) in sig}
    d["links"] = [l for l in d["links"] if l[0] not in dropped]
    d["links"].extend([list(c) for c in CANON])
    links = {l[0]: l for l in d["links"]}

    def out_(nid, name): return next(o for o in nodes[nid]["outputs"] if o.get("name") == name)
    def in_(nid, name): return next(i for i in nodes[nid]["inputs"] if i.get("name") == name)
    in_slot(nodes[60], 1)["link"] = 27
    o60p, o60n = out_(60, "positive"), out_(60, "negative")
    o60p["links"] = sorted({x for x in (o60p.get("links") or []) if x not in dropped} | {34})
    o60n["links"] = [35]
    outs15 = out_slot(node(d, 15), 0)
    outs15["links"] = sorted(set(outs15.get("links") or []) | {4, 28})
    out_slot(node(d, 63), 0)["links"] = [23]
    in_slot(nodes[65], 0)["link"] = 28
    in_slot(nodes[65], 1)["link"] = 35
    out_slot(nodes[65], 0)["links"] = [30]
    in_slot(nodes[12], 2)["link"] = 30
    in_(51, "text")["link"] = 34

    # ---- 速度档默认(09-16 用户令"太慢了";raw 缓期):
    # [47] 官方4步蒸馏 LoRA 默认激活 → steps=4/cfg=1(蒸馏件设计点,cfg1 负向自动失效);
    # 质量档=bypass 47 + 手调 steps=12/cfg=5(负向复活)。 ----
    ks = nodes[12]
    ks["widgets_values"][2] = 4
    ks["widgets_values"][3] = 1.0
    ks.setdefault("widgets_values_named", {})["steps"] = 4
    ks.setdefault("widgets_values_named", {})["cfg"] = 1.0

    # ---- [46] Afterlight 光影 + [47] 4步蒸馏加速 + [67-70] v3 阵容:模型链 45→46→47→67→68→69→70→14 ----
    if 46 not in nodes:
        nodes[46] = {
            "id": 46, "type": "LoraLoaderModelOnly", "pos": [-620.0, 640.0], "size": [340, 130],
            "flags": {}, "order": 46, "mode": 4,  # 09-16 用户裁定:默认旁路(工笔/画意实测污染)
            "inputs": [{"name": "model", "type": "MODEL", "link": None}],
            "outputs": [{"name": "MODEL", "type": "MODEL", "links": [], "slot_index": 0}],
            "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
            "widgets_values": ["Krea2-光影/Afterlight_v1.safetensors", 0.8],
            "widgets_values_named": {"lora_name": "Krea2-光影/Afterlight_v1.safetensors", "strength_model": 0.8},
            "color": "#4d9e6a", "bgcolor": "#1f2f26",
        }
        d["nodes"].append(nodes[46])
    if 47 not in nodes:
        nodes[47] = {
            "id": 47, "type": "LoraLoaderModelOnly", "pos": [-620.0, 800.0], "size": [340, 130],
            "flags": {}, "order": 47, "mode": 0,
            "inputs": [{"name": "model", "type": "MODEL", "link": None}],
            "outputs": [{"name": "MODEL", "type": "MODEL", "links": [], "slot_index": 0}],
            "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
            "widgets_values": ["Krea2-功能/Krea2-Turbo-4步蒸馏.safetensors", 1.0],
            "widgets_values_named": {"lora_name": "Krea2-功能/Krea2-Turbo-4步蒸馏.safetensors", "strength_model": 1.0},
            "color": "#c8963e", "bgcolor": "#3a2f1c",
        }
        d["nodes"].append(nodes[47])
    nodes = {n["id"]: n for n in d["nodes"]}
    # ---- v3:[67-70] 新 LoRA 阵容 build-if-missing(缺则按 09-16 定档形态补建) ----
    NEW_LORAS = {
        67: (DETAIL_SLIDER_FILE, 1820, GREEN, GREEN_BG),
        68: ("Krea2-画风/Krea2-柔水彩softwatercolor.safetensors", 2340, "#3a6ea5", "#1c2a3a"),
        69: ("Krea2-画风/Krea2-暗笔刷darkbrush.safetensors", 2860, "#3a6ea5", "#1c2a3a"),
        70: ("Krea2-画风/Krea2-复古漫retroanime.safetensors", 3380, "#3a6ea5", "#1c2a3a"),
    }
    for nid, (fname, x, color, bgcolor) in NEW_LORAS.items():
        if nid not in nodes:
            nodes[nid] = {
                "id": nid, "type": "LoraLoaderModelOnly", "pos": [float(x), 240.0], "size": [340, 130],
                "flags": {}, "order": nid, "mode": 4,
                "inputs": [{"name": "model", "type": "MODEL", "link": None}],
                "outputs": [{"name": "MODEL", "type": "MODEL", "links": [], "slot_index": 0}],
                "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
                "widgets_values": [fname, 1.0],
                "widgets_values_named": {"lora_name": fname, "strength_model": 1.0},
                "color": color, "bgcolor": bgcolor,
            }
            d["nodes"].append(nodes[nid])
    nodes = {n["id"]: n for n in d["nodes"]}
    # 重接模型链(CANON 签名幂等):v3 统一收敛到 45→46→47→67→68→69→70→14
    sig = {(45, 0, 14, 0), (45, 0, 46, 0), (46, 0, 47, 0), (47, 0, 14, 0),
           (47, 0, 67, 0), (67, 0, 68, 0), (68, 0, 69, 0), (69, 0, 70, 0), (70, 0, 14, 0)}
    drop_chain = {l[0] for l in d["links"] if (l[1], l[2], l[3], l[4]) in sig}
    d["links"] = [l for l in d["links"] if l[0] not in drop_chain]
    # 去重(历史双写自愈):同 id 只留一条
    dedup = {}
    for l in d["links"]:
        dedup[l[0]] = l
    d["links"] = [dedup[k] for k in sorted(dedup)]
    d["links"].extend([
        [36, 45, 0, 46, 0, "MODEL"],
        [37, 46, 0, 47, 0, "MODEL"],
        [38, 47, 0, 67, 0, "MODEL"],
        [39, 67, 0, 68, 0, "MODEL"],
        [40, 68, 0, 69, 0, "MODEL"],
        [41, 69, 0, 70, 0, "MODEL"],
        [42, 70, 0, 14, 0, "MODEL"],
    ])
    for n in d["nodes"]:
        for o in n.get("outputs", []):
            if isinstance(o.get("links"), list):
                o["links"] = [i for i in o["links"] if i not in drop_chain] or None
        for i_ in n.get("inputs", []):
            if i_.get("link") in drop_chain:
                i_["link"] = None
    nodes = {n["id"]: n for n in d["nodes"]}
    links = {l[0]: l for l in d["links"]}  # 重建:新增链 36-42 进门禁视野
    for nid, lid_in, lid_out in ((46, 36, 37), (47, 37, 38), (67, 38, 39),
                                 (68, 39, 40), (69, 40, 41), (70, 41, 42)):
        in_slot(nodes[nid], 0)["link"] = lid_in
        out_slot(nodes[nid], 0)["links"] = [lid_out]
    in_slot(nodes[14], 0)["link"] = 42
    out_slot(nodes[45], 0)["links"] = [36]  # 45 → 46(旧 45→14 已摘)
    # 09-16 用户裁定:Afterlight 默认旁路(X系消融:暖金逆光=摄影逻辑,工笔/画意污染)
    nodes[46]["mode"] = 4
    nodes[46]["title"] = "[46] 光影LoRA·Afterlight ×0.8(暖金逆光,摄影向;默认旁路——工笔/画意防污染,要光影再开)"
    nodes[47]["title"] = "[47] 加速LoRA·4步蒸馏 ×1.0(速度档;质量档=旁路+12步/cfg5)"
    # ---- v3 定档:[67] 默认激活×1.0;[68/69/70] 画风件旁路+触发词固化 ----
    nodes[67]["mode"] = 0
    nodes[67]["widgets_values"][1] = DETAIL_SLIDER_STRENGTH
    nodes[67].setdefault("widgets_values_named", {})["strength_model"] = DETAIL_SLIDER_STRENGTH
    nodes[67]["title"] = (f"[67] 细节LoRA·细节滑杆 ×{DETAIL_SLIDER_STRENGTH:g}"
                          "(发丝/织纹细节;速度/质量档常开,想关=旁路)")
    for nid in (68, 69, 70):
        nodes[nid]["mode"] = 4
    nodes[68]["title"] = "[68] 画风LoRA·柔水彩 ×1.0(触发词:art deco watercolor style;默认旁路)"
    nodes[69]["title"] = "[69] 画风LoRA·暗笔刷 ×1.0(触发词:monochrome ink wash style;默认旁路)"
    nodes[70]["title"] = "[70] 画风LoRA·复古漫 ×1.0(触发词:purple retro anime style;默认旁路)"

    # ---- 尺度 LoRA 默认旁路(09-15 用户裁定:画风优先;[19] identity 保留) ----
    for nid, name in ((44, "Mystic XXX v3 ×2.0"), (45, "pussy ×0.15")):
        nodes[nid]["mode"] = 4
        base = nodes[nid]["title"].split("(默认旁路")[0]
        nodes[nid]["title"] = f"{base}(默认旁路)"

    # ---- [66] 速查卡 LoRA 口径同步(幂等:旧句已换则 no-op) ----
    card = nodes[66]["widgets_values"][0]
    card = card.replace(
        "- 力度:收=pussy 降 0.1 或 Mystic 降 1.0;更冲=Mystic 2.5(噪点↑)",
        "- 尺度LoRA(44/45)默认旁路=画风优先;要破限=右键节点 Remove Bypass\n"
        "- 破限档力度:收=pussy 降 0.1 或 Mystic 降 1.0;更冲=Mystic 2.5(噪点↑)",
    )
    # v3 两档口径(矩阵实测 09-16:速度档 ~90s/张,质量档 ~500s/张)
    card = card.replace(
        "- cfg=3=负向生效档;回官方纯档=cfg 调 1(负向自动失效,无需改线)",
        "- 速度档=默认:4步/cfg1+加速[47]+细节[67]×1.0(约90秒/张;cfg1 下负向自动失效)\n"
        "- 质量档=旁路[47]+手调12步/cfg5(负向复活)+细节[67]保持(约500秒/张)",
    )
    if "光影[46]默认旁路" not in card:  # 守卫:新句含旧句前缀,裸 replace 每遍增殖
        card = card.replace(
            "- 速度档=默认:4步/cfg1+加速[47]+细节[67]×1.0(约90秒/张;cfg1 下负向自动失效)",
            "- 速度档=默认:4步/cfg1+加速[47]+细节[67]×1.0(约90秒/张;cfg1 下负向自动失效;光影[46]默认旁路)",
        )
        card = card.replace(
            "- 质量档=旁路[47]+手调12步/cfg5(负向复活)+细节[67]保持(约500秒/张)",
            "- 质量档=旁路[47]+手调12步/cfg5(负向复活)+细节[67]保持(约500秒/张;光影[46]保持旁路)",
        )
    card = card.replace(
        "## 09-16 新增 LoRA 矩阵(默认全旁路;启用=右键节点 Remove Bypass)",
        "## 09-16 新增 LoRA 矩阵([67]默认激活;其余默认旁路,启用=右键节点 Remove Bypass)",
    )
    card = card.replace(
        "- [67] 细节滑杆DetailSlider | Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors"
        " | ×1.0 | 通用 | 细节增强,可与其他LoRA叠加",
        "- [67] 细节滑杆DetailSlider | Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors"
        " | ×1.0(默认激活) | 速度/质量档常开 | 细节增强"
        "(09-16 矩阵定档:×0.7 无效/×1.0 增益明显无伪影/×1.3 噪底抬升)",
    )
    if "一次只开一枚" not in card:  # 守卫:新文本尾部含旧锚点,裸 replace 会每遍增殖
        card = card.replace(
            "- 风格参照style_reference(官方,需参考图输入)",
            "- 画风件[68/69/70]一次只开一枚(互斥,叠加会风格打架);启用须在正向补各自触发词\n"
            "- 风格参照style_reference(官方,需参考图输入)",
        )
    nodes[66]["widgets_values"][0] = card

    # ---- 标题/组框(实测口径) ----
    # 09-17 用户裁「都做」:负面台账 D1/D4 负向词入默认负向(速度档 cfg1 无效,质量档生效)
    _neg64 = nodes[64]["widgets_values"][0]
    if "织物纹理" not in _neg64:
        nodes[64]["widgets_values"][0] = _neg64 + ",织物纹理,布纹底,网格纹底,冷灰底色,灰绿底"
    nodes[64]["title"] = "[64] 负向提示词(质量档 cfg5 生效;速度档 cfg1 自动失效)"
    for g in d["groups"]:
        if g["title"].startswith("④"):
            g["title"] = "④ 提示词链(正/负输入→风格→编码→12带)"
        if g["title"].startswith("②"):
            g["title"] = "② LoRA 栈(尺度44/45+画风68-70+光影46 默认旁路;细节67+加速47 激活)+ 模型补丁"

    # ---- [42] 说明卡退役(幂等:无 42 即跳过;文件名已表达,不再放画布) ----
    # 区分:[42]=工作流身份介绍卡(退役);[66]=用法速查卡(提示词模板+参数,
    # 09-15 用户令「尽量都补全」所建,内容非身份重复——保留,勿删)
    if 42 in nodes:
        assert not any(l[1] == 42 or l[3] == 42 for l in d["links"]), "说明卡意外参与连线"
        d["nodes"] = [n for n in d["nodes"] if n["id"] != 42]
        nodes = {n["id"]: n for n in d["nodes"]}

    # ---- 布局带重排(09-16 晚用户裁定:用户画布手排版为准,存档自引擎用户区抄入;
    # 语义仍收敛 v3.1;脚本 LAYOUT 与用户排布恒等=重跑不再挪动) ----
    # 布局铁律(09-16 用户裁定,须恒守):连线从左向右、从上向下——
    # 数据源在上/左,汇(采样器)在下/右;任何新节点按流向归位,禁逆向走线。
    LAYOUT = {
        4: (4953.212012499255, 535.0097849669764),
        10: (4262.804129108098, 895.848008529777),
        11: (4659.517297886305, 528.3447679391599),
        12: (4247.204681136616, 525.2401847735748),
        14: (3594.2305517917716, 19.35348600320128),
        15: (440, 60),
        19: (1263.5302600093255, -201.48774670904217),
        20: (3936.947086899471, 646.7699037247917),
        21: (40, 60),
        44: (1736.0878756251104, -202.43617287398453),
        45: (2303.53026000933, -201.48774670904217),
        46: (2823.53026000933, -201.48774670904217),
        47: (3264.4587060697118, -198.82287994691634),
        50: (40, 560),
        51: (1210, 560),
        53: (2819.11396393693, 369.1262738337829),
        60: (560, 560),
        61: (2514.532468957106, 376.2808094910938),
        62: (1802.9793729150056, 924.9485120401902),
        63: (1810, 560),
        64: (34.48180735637932, 840.6146950544908),
        65: (1218.3549755209972, 846.1583716990498),
        66: (40, 1620),
        67: (1246.1154629811174, -3.517248750837986),
        68: (1746.1557992129754, 0.6480984580177117),
        69: (2331.2967291343157, 1.3961608138937884),
        70: (2901.1788871375043, 1.8466983691370644),
    }
    for nid, (x, y) in LAYOUT.items():
        if nid in nodes:
            nodes[nid]["pos"] = [x, y]  # 不强转 float:int 坐标保持原表示(与用户存档字节一致)
    GROUPS = {
        "①": (20, 0, 1180, 220, "① 模型加载"),
        "②": (1243.5302600093255, -261.48774670904186, 2895.9444006349963, 569.1638742947723,
              "② LoRA 栈(尺度44/45+画风68-70 默认旁路;细节67+光影46+加速47 激活)+ 模型补丁"),
        "⑤": (2500.0965691247766, 335.1449567708363, 1002.7147633177151, 195.65598278237417,
              "⑤ 画布(分辨率→空潜)"),
        "③": (3910.4674619507646, 457.7595854083443, 1400, 580, "③ 采样与出图"),
        "④": (20, 520, 2400, 660, "④ 提示词链(正/负输入→风格→编码→12带)"),

    }
    # 原地更新组框(标题+bounding),保留既有键序与 id/flags——重建换序会与
    # 采纳脚本(superset_layout_adopt_user_0916)产出字节不一致;缺组才补建。
    rebuilt = []
    for key, (bx, by, bw, bh, t) in GROUPS.items():
        g = next((x for x in d["groups"] if x["title"].startswith(key)), None)
        if g is None:
            g = {"title": t, "bounding": [bx, by, bw, bh], "color": "#35422d",
                 "bgcolor": "#22301f", "font_size": 24, "flags": {}}
            d["groups"].append(g)
        g["title"] = t
        g["bounding"] = [bx, by, bw, bh]
        rebuilt.append(g)
    d["groups"] = rebuilt
    # 标题口径刷新(速度档)
    nodes[64]["title"] = "[64] 负向提示词(速度档 cfg1 下不生效;质量档 cfg5 复活)"
    # 09-16 用户报褶皱:默认负向补防皱封堵(64=用户负向框,workflow 层,非冻结基础词)
    nodes[64]["widgets_values"] = ["文字,水印,签名,多余的手指,畸形的手,褶皱,皱褶,绉纹,杂乱布纹,织物褶皱,横向条纹,色带,条带痕迹"]
    nodes[12]["title"] = "[12] KSampler·速度档(4步/cfg1)"

    d["last_node_id"] = max(n["id"] for n in d["nodes"])
    d["last_link_id"] = max(l[0] for l in d["links"])

    # ================= 结构门 =================
    ids = {n["id"] for n in d["nodes"]}
    check(52 not in ids, "节点52(零化)残留")
    for l in d["links"]:
        check(l[1] in ids and l[3] in ids, f"链接{l[0]} 端点缺失")
        if l[1] in ids and l[3] in ids:
            check(l[0] in (out_slot(nodes[l[1]], l[2]).get("links") or []) if l[2] < len(nodes[l[1]]["outputs"]) else False,
                  f"链接{l[0]} 源端引用缺")
            check(in_slot(nodes[l[3]], l[4]).get("link") == l[0], f"链接{l[0]} 目的端引用缺")
    for n in d["nodes"]:
        for o in n.get("outputs", []):
            for lid in o.get("links") or []:
                check(lid in links and links[lid][1] == n["id"], f"节点{n['id']} 输出悬空线{lid}")
        for i_ in n.get("inputs", []):
            lid = i_.get("link")
            check(lid is None or (lid in links and links[lid][3] == n["id"]), f"节点{n['id']} 输入悬空线{lid}")

    def wired(s, ss, dn, ds):
        return any(l[1] == s and l[2] == ss and l[3] == dn and l[4] == ds for l in d["links"])
    check(wired(50, 0, 60, 0), "正向链断: 50→60")
    check(wired(60, 0, 51, 1), "正向链断: 60→51")
    check(wired(51, 0, 63, 0), "正向链断: 51→63")
    check(wired(63, 0, 12, 1), "正向链断: 63→12.positive")
    check(wired(64, 0, 60, 1), "负向链断: 64→60.negative")
    check(wired(60, 1, 65, 1), "负向链断: 60→65")
    check(wired(65, 0, 12, 2), "负向链断: 65→12.negative(直通,v2 核心)")
    check(wired(15, 0, 51, 0) and wired(15, 0, 65, 0), "TE 双供(51+65)断")
    check(nodes[12]["widgets_values"][3] == 1.0, "cfg≠1(速度档)")
    check(nodes[12]["widgets_values"][2] == 4, "steps≠4(速度档)")
    check(nodes[46].get("mode") == 4, "Afterlight [46] 应默认旁路(09-16 用户裁定,工笔/画意防污染)")
    boxes = {n["id"]: (n["pos"][0], n["pos"][1], n["pos"][0] + n["size"][0], n["pos"][1] + n["size"][1]) for n in d["nodes"]}
    for a in boxes:
        for b in boxes:
            if a < b and boxes[a][0] < boxes[b][2] and boxes[b][0] < boxes[a][2] and boxes[a][1] < boxes[b][3] and boxes[b][1] < boxes[a][3]:
                failures.append(f"AABB 相交: 节点{a}×{b}(布局遮挡)")
    check(nodes[47].get("mode", 0) == 0, "4步蒸馏 [47] 应默认激活")
    check(nodes[44].get("mode") == 4 and nodes[45].get("mode") == 4, "尺度LoRA 44/45 未默认旁路")
    check(nodes[19].get("mode", 0) == 0, "identity LoRA [19] 应保留激活")
    # ---- v3 门禁:67 定档激活 / 68-70 旁路+触发词 / 七跳模型链 / 66 卡两档口径 ----
    check(nodes[67].get("mode", 0) == 0, "细节滑杆 [67] 应默认激活(v3 定档)")
    check(abs(nodes[67]["widgets_values"][1] - DETAIL_SLIDER_STRENGTH) < 1e-9,
          f"细节滑杆强度≠定档×{DETAIL_SLIDER_STRENGTH}")
    check(nodes[67]["widgets_values"][0] == DETAIL_SLIDER_FILE, "[67] lora 文件名漂移")
    for nid, trig in ((68, "art deco watercolor style"),
                      (69, "monochrome ink wash style"),
                      (70, "purple retro anime style")):
        check(nodes[nid].get("mode") == 4, f"画风件 [{nid}] 应默认旁路(互斥,一次只开一枚)")
        check(trig in (nodes[nid].get("title") or ""), f"画风件 [{nid}] title 缺官方触发词")
    for s, dn in ((45, 46), (46, 47), (47, 67), (67, 68), (68, 69), (69, 70), (70, 14)):
        check(wired(s, 0, dn, 0), f"模型链断: {s}→{dn}(v3 七跳)")
    card_txt = nodes[66]["widgets_values"][0]
    check("速度档=默认" in card_txt and "质量档=旁路[47]" in card_txt,
          "[66] 速查卡缺 v3 两档口径")
    check(nodes[50].get("widgets_values_named", {}).get("value") == nodes[50]["widgets_values"][0],
          "[50] named/positional 分裂复发(v3.1 应恒对齐工笔句)")

    if failures:
        print("结构门未过:")
        for f in failures:
            print("  ✗", f)
        return 1

    WF.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"过门: 节点{len(d['nodes'])} 链接{len(d['links'])} 速度档(steps4/cfg1+4步蒸馏) "
          f"Afterlight 旁路(46) 负向直通(65→12.2) 尺度LoRA 44/45 旁路 "
          f"细节滑杆67×{DETAIL_SLIDER_STRENGTH:g}(v3 定档激活) 画风68-70 旁路含触发词")
    return 0


if __name__ == "__main__":
    sys.exit(main())
