#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 三件一次到位大轮手术(2026-10-02,Trellis 10-01-qi21-usetest-batch
implement 步骤 4-8 / design §1-§2)。

基线=用户手改后 t2i(git 工作区现态,禁打回)+ i2i/edit 1001 同构手术后态。
一次落六手术+配套:⑫编号重映射/⑬PE TE 迁子图+更名[6]/⑭槽序重排/⑯出槽清理
(含 rgba_default 删)/⑰tooltip(件层批已落,本轮零迁)/⑱默认档 FunAcc/㉑PE启用?
节点化/⑤⑧标题双名/Q4 pe关透明包W1(件层批已落)/Q5 thinking 预览/viggle 步数
官方考据 6 步/web 扩展锚改+⑲防抖/蓝图三目标重抽/layout baseline 重立/旧手术
脚本退役警示。

分步(每步独立断言,fail-closed 任一断言不过=不落盘退出):
  STEP1 手改基线盘点:git diff t2i 全量 → research/baseline-manual.md
  STEP2 三件编号重映射(design §1 表+基线实况核差补漏;id/连线/文字引用全链)
  STEP3 ⑬ PE TE 迁子图(4019)+pe_clip 槽撤;㉑ [4012] PE启用? 立+扇出+PE开关槽撤
  STEP4 ⑭ 连线槽位按 research/slot-map.md 重迁(三件全);⑯ 型名槽清+rgba_default
        迁透明值后删;i2i/edit 宿主 inputs 同款 UI 对齐
  STEP5 ⑤⑧ 标题全量表(官方「功能·类型」/自研「功能·自研」);Q5 [4020] thinking
  STEP6 ⑱ 默认档值(四处双写)+viggle 6 步(官方考据)+Note 三件改写
  STEP7 web 扩展 qi21-panel-linkage.js 重写(锚 [4012]/型选择+⑲防抖)
  STEP8 蓝图三目标重抽+sync 锚改+layout baseline 重立+旧手术脚本退役警示
        +引擎家同步(件层连带 my_qi21_base 四出由人工 Edit 随批,见 assertions)

三件套:apps/output/biground-1002/{before,after,assertions.txt,*.json}
铁律:禁手工编辑工作流 JSON;手术全程内存态,末尾统一落盘+回读断言。
用法:python3 apps/build/scripts/qi21_biground_surgery_1002.py [--dry]
"""
from __future__ import annotations

import copy
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
T2I = WF_DIR / "1_文生图" / "qi21-道劫-t2i.json"
I2I = WF_DIR / "2_图生图" / "qi21-道劫-i2i.json"
EDIT = WF_DIR / "2_图生图" / "qi21-edit.json"
SUBGRAPHS = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs"
ENGINE_HOME = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui")
ENGINE_MYNODES = ENGINE_HOME / "ComfyUI/custom_nodes/my-nodes"
OUT = REPO / "apps/output/biground-1002"
RESEARCH = REPO / ".trellis/tasks/10-01-qi21-usetest-batch/research"
BASELINE = REPO / "apps/build/scripts/workflow_layout_baseline.json"

WFS = {"t2i": T2I, "i2i": I2I, "edit": EDIT}
NEW_SG_NAME = "[6] 文本提示词类型优化子图(双击进入)"
OLD_SG_PREFIX = "[40] 提示词类型优化子图"
NEW_SG_PREFIX = "[6] 文本提示词类型优化子图"
FUNACC = "0 · Fun-Acc 4步"
PE_SLOT_OLD = {"t2i": 4, "i2i": 7, "edit": 5}   # 旧 -10「PE开关」槽位

_checks: list[str] = []


def ck(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(f"[fail-closed] {msg}")
    _checks.append(f"PASS {msg}")


def jload(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def jdump(p: Path, data) -> None:
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ── 编号重映射表(design §1 + 基线实况核差补漏,口径记档 baseline-manual.md)──
ID_MAPS: dict[str, dict[int, int]] = {
    "t2i": {
        1: 1, 2: 2, 3: 3, 5: 4, 8: 5, 9: 8, 10: 402, 24: 400, 27: 401,
        40: 6, 208: 7, 11: 4019,
        140: 4013, 141: 4011, 142: 4015, 143: 4016, 144: 4017,
        150: 4010, 151: 4018, 152: 4014, 250: 4100,
        7: 7010, 31: 7011, 206: 7012, 198: 7013, 207: 7014, 214: 7015,
    },
    "i2i": {
        1: 1, 2: 2, 3: 3, 4: 10, 5: 11, 7: 9, 9: 5, 10: 8, 11: 402,
        16: 16, 17: 17, 18: 4, 19: 19, 20: 20, 22: 400, 28: 401,
        40: 6, 42: 42, 43: 43, 44: 44, 190: 7, 12: 4019,
        21: 21, 23: 23, 24: 24, 25: 25, 26: 4013, 27: 27,
        141: 4011, 142: 4015, 143: 4016, 144: 4017, 150: 4010, 152: 4014,
        153: 153, 171: 171, 172: 172, 173: 173, 180: 180,
        8: 7010, 31: 7011, 189: 7012, 176: 7013, 191: 7014, 192: 7015,
    },
    "edit": {
        1: 1, 2: 2, 3: 3, 4: 10, 5: 11, 7: 9, 9: 5, 10: 8, 11: 402,
        16: 16, 17: 17, 18: 4, 19: 19, 20: 20, 22: 400, 28: 28, 29: 29,
        40: 6, 58: 7, 12: 4019,
        6: 4015, 21: 21, 23: 23, 24: 24, 25: 25, 26: 4013, 27: 27,
        43: 4016, 152: 4014,
        8: 7010, 31: 7011, 56: 7012, 55: 7013, 57: 7014, 59: 7015,
    },
}

# ⑤⑧ 标题终态全量表:官方件「[号] 功能·类型」/自研件「[号] 功能·自研」
TITLES: dict[str, dict[int, str]] = {
    "t2i": {
        1: "[1] UNETLoader", 2: "[2] 主TE·CLIPLoader", 3: "[3] VAELoader",
        4: "[4] 自动化宽高·EmptyLatentImage", 5: "[5] VAEDecode", 8: "[8] SaveImage",
        400: "[400] 主体句·PrimitiveStringMultiline",
        401: "[401] 最终提示词预览·showAnything",
        402: "[402] 道劫·用法速查",
        6: "[6] 文本提示词类型优化子图", 7: "[7] 加速子图",
        4010: "[4010] 底座九选一·自研", 4011: "[4011] 装配全文件·自研",
        4012: "[4012] PE启用?", 4013: "[4013] PE改写·PromptRewrite",
        4014: "[4014] 最终文本合成器·自研", 4015: "[4015] 主编码·TextEncode",
        4016: "[4016] RGBA编码·TextEncode", 4017: "[4017] 输出选择·SwitchNode",
        4018: "[4018] 画幅建议器·自研", 4019: "[4019] PE专属TE·CLIPLoader",
        4020: "[4020] PE思考·showAnything", 4100: "[4100] 段说明卡",
        7010: "[7010] 直出40步·KSampler", 7011: "[7011] viggle LoRA·LoraLoader",
        7012: "[7012] viggle6步·KSampler", 7013: "[7013] FunAcc4步·FunAccPDD",
        7014: "[7014] seed单源·PrimitiveInt", 7015: "[7015] 出图速度选择·自研",
    },
    "i2i": {
        1: "[1] UNETLoader", 2: "[2] 主TE·CLIPLoader", 3: "[3] VAELoader",
        10: "[10] 参考图1·LoadImage", 11: "[11] 参考图2·LoadImage",
        9: "[9] 模型缓存·QwenImage21Cache", 5: "[5] VAEDecode", 8: "[8] SaveImage",
        402: "[402] 道劫i2i·用法速查",
        16: "[16] 画布预缩·Scale", 17: "[17] 参考预缩·Scale",
        4: "[4] 自动化宽高·EmptyLatentImage",
        19: "[19] 画幅双路开关·PrimitiveBoolean", 20: "[20] latent双路·SwitchNode",
        400: "[400] 指令·PrimitiveStringMultiline",
        401: "[401] 提示词预览·showAnything",
        42: "[42] Reroute", 43: "[43] Reroute", 44: "[44] Reroute",
        6: "[6] 文本提示词类型优化子图", 7: "[7] 加速子图",
        21: "[21] PE模板头·Multiline", 23: "[23] PE模板尾·Multiline",
        24: "[24] PE三段拼装·StringFormat", 25: "[25] PE看图合批·BatchImages",
        27: "[27] PE抽取·RegexExtract",
        4010: "[4010] 底座九选一·自研", 4011: "[4011] 装配全文件·自研",
        4012: "[4012] PE启用?", 4013: "[4013] PE看图改写·TextGenerate",
        4014: "[4014] 择文合成器①·自研", 4015: "[4015] 主编码·TextEncode",
        4016: "[4016] RGBA编码·TextEncode", 4017: "[4017] 输出选择·SwitchNode",
        153: "[153] 透明包裹器②·自研", 171: "[171] 单图编码·TextEncode",
        172: "[172] 透明单图编码·TextEncode",
        173: "[173] 单图输出选择·SwitchNode", 180: "[180] RGBA透明选择·自研",
        4019: "[4019] PE专属TE·CLIPLoader",
        7010: "[7010] 直出40步·KSampler", 7011: "[7011] viggle LoRA·LoraLoader",
        7012: "[7012] viggle6步·KSampler", 7013: "[7013] FunAcc4步·FunAccPDD",
        7014: "[7014] seed单源·PrimitiveInt", 7015: "[7015] 出图速度选择·自研",
    },
    "edit": {
        1: "[1] UNETLoader", 2: "[2] 主TE·CLIPLoader", 3: "[3] VAELoader",
        10: "[10] 参考图1·LoadImage", 11: "[11] 参考图2·LoadImage",
        9: "[9] 模型缓存·QwenImage21Cache", 5: "[5] VAEDecode", 8: "[8] SaveImage",
        402: "[402] 道劫edit·用法速查",
        16: "[16] 画布预缩·Scale", 17: "[17] 参考预缩·Scale",
        4: "[4] 自动化宽高·EmptyLatentImage",
        19: "[19] 画幅双路开关·PrimitiveBoolean", 20: "[20] latent双路·SwitchNode",
        400: "[400] 指令·PrimitiveStringMultiline",
        28: "[28] Reroute", 29: "[29] Reroute",
        6: "[6] 文本提示词类型优化子图", 7: "[7] 加速子图",
        21: "[21] PE模板头·Multiline", 23: "[23] PE模板尾·Multiline",
        24: "[24] PE三段拼装·StringFormat", 25: "[25] PE看图合批·BatchImages",
        27: "[27] PE抽取·RegexExtract",
        4012: "[4012] PE启用?", 4013: "[4013] PE看图改写·TextGenerate",
        4014: "[4014] 最终文本合成器·自研", 4015: "[4015] 主编码·TextEncode",
        4016: "[4016] 单图编码·TextEncode", 4019: "[4019] PE专属TE·CLIPLoader",
        7010: "[7010] 直出40步·KSampler", 7011: "[7011] viggle LoRA·LoraLoader",
        7012: "[7012] viggle6步·KSampler", 7013: "[7013] FunAcc4步·FunAccPDD",
        7014: "[7014] seed单源·PrimitiveInt", 7015: "[7015] 出图速度选择·自研",
    },
}

# -10 子图输入槽终态序(⑬ pe_clip 撤+㉑ PE开关槽撤+PE启用? 立)
SG_INPUTS_NEW: dict[str, list[tuple[str, str]]] = {
    "t2i": [("clip", "CLIP"), ("vae", "VAE"), ("主体句", "STRING"),
            ("型选择", "COMBO"), ("PE启用?", "BOOLEAN"), ("透明", "BOOLEAN"),
            ("手动宽", "INT"), ("手动高", "INT")],
    "i2i": [("clip", "CLIP"), ("vae", "VAE"), ("image_1", "IMAGE"),
            ("image_2", "IMAGE"), ("指令", "STRING"), ("型选择", "COMBO"),
            ("PE启用?", "BOOLEAN"), ("RGBA透明", "COMBO")],
    "edit": [("clip", "CLIP"), ("vae", "VAE"), ("image_1", "IMAGE"),
             ("image_2", "IMAGE"), ("指令", "STRING"), ("PE启用?", "BOOLEAN")],
}
WIDGET_SLOTS = {"t2i": {"主体句", "型选择", "PE启用?", "透明", "手动宽", "手动高"},
                "i2i": {"指令", "型选择", "PE启用?", "RGBA透明"},
                "edit": {"指令", "PE启用?"}}

NODE_INPUT_ORDER = {
    "MyQi21PromptAssembly": ["BASE", "主体句", "锁层A全文"],
    "MyQi21PromptSelect": ["装配全文", "PE出文", "pe开关", "透明模式",
                           "RGBA官方头句", "RGBA官方尾句", "W1收束句"],
    "MyQi21WhSuggest": ["wh_ratio", "九型WIDTH", "九型HEIGHT", "联动开关",
                        "手动宽", "手动高"],
    "MyQi21DaojieBase": ["base", "透明覆盖"],
}
NEW_WIDGET_SLOTS = {
    "MyQi21PromptAssembly": ["主体句", "锁层A全文"],
    "MyQi21PromptSelect": ["pe开关", "透明模式", "RGBA官方头句", "RGBA官方尾句",
                           "W1收束句"],
    "MyQi21WhSuggest": ["联动开关", "手动宽", "手动高"],
    "MyQi21DaojieBase": ["base", "透明覆盖"],
}
# 旧 wv 序候选(基线实况:t2i 手改态=全槽序含残留;i2i/edit=widget 子序;多形态
# 按长度对拍命中,全不中=fail)
WV_OLD_CANDIDATES = {
    ("t2i", "MyQi21PromptAssembly"): [["主体句", "锁层A全文", "BASE"],
                                      ["主体句", "锁层A全文"]],
    ("i2i", "MyQi21PromptAssembly"): [["主体句", "锁层A全文"]],
    ("t2i", "MyQi21PromptSelect"): [["pe开关", "透明模式", "RGBA官方头句",
                                     "RGBA官方尾句", "W1收束句", "装配全文", "PE出文"],
                                    ["pe开关", "透明模式", "RGBA官方头句",
                                     "RGBA官方尾句", "W1收束句"]],
    ("i2i", "MyQi21PromptSelect"): [["pe开关", "透明模式", "RGBA官方头句",
                                     "RGBA官方尾句", "W1收束句"]],
    ("edit", "MyQi21PromptSelect"): [["pe开关", "透明模式", "RGBA官方头句",
                                      "RGBA官方尾句", "W1收束句"]],
    ("t2i", "MyQi21WhSuggest"): [["wh_ratio", "联动开关", "九型WIDTH", "九型HEIGHT",
                                  "手动宽", "手动高"]],
    ("t2i", "MyQi21DaojieBase"): [["base", "透明覆盖"]],
    ("i2i", "MyQi21DaojieBase"): [["base"]],
}
WIDGET_DEFAULTS = {"透明覆盖": False, "手动宽": 0, "手动高": 0, "联动开关": False}

VIGGLE_NOTE = ("viggle 6 步=1002 考据轮官方模型卡荐档(HuggingFace Viggle 官方卡:"
               "viggle-turbo v0.2.1 r256 荐 6 步/cfg 1.0/euler,官方配 BasicGuider+"
               "『Viggle Turbo Sigmas』sigma 表;本仓未挂 sigma 表沿用 simple 调度="
               "已知偏差,画质异常先查此;旧 359 步系 TE-Speed 时代历史值)")


def asm_sg(d: dict) -> dict:
    hits = [s for s in d["definitions"]["subgraphs"]
            if (s.get("name") or "").startswith(OLD_SG_PREFIX)
            or s.get("name") == NEW_SG_NAME]
    ck(len(hits) == 1, f"装配子图定义恰 1 份(实 {len(hits)})")
    return hits[0]


def acc_sg(d: dict) -> dict:
    hits = [s for s in d["definitions"]["subgraphs"] if "加速" in (s.get("name") or "")]
    ck(len(hits) == 1, "加速子图定义恰 1 份")
    return hits[0]


def nmap(sg: dict) -> dict[int, dict]:
    return {n["id"]: n for n in sg["nodes"]}


def by_type(sg: dict, t: str) -> list[dict]:
    return [n for n in sg["nodes"] if n["type"] == t]


# ════════════════════════════════════════════════════════════════════
def step1() -> None:
    print("== STEP1 手改基线盘点 → research/baseline-manual.md")
    diff = subprocess.run(["git", "diff", "HEAD", "--", str(T2I)],
                          cwd=REPO, capture_output=True, text=True, check=True).stdout
    ck(bool(diff), "t2i 手改 diff 非空(git 工作区现态=基线)")
    ins = len([l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")])
    dels = len([l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")])
    md = [
        "# 手改基线盘点(2026-10-02,大轮 STEP1 自动生成)",
        "",
        "> 基线=git 工作区现态 qi21-道劫-t2i.json(用户手改后,禁打回)。",
        f"> diff 规模:+{ins} / -{dels} 行(diff 全量见本档附录)。",
        "",
        "## 手改要点(盘点摘要)",
        "",
        "1. 全节点补 `widgets_values_named`(前端 1.53.6 重存序列化新字段,26 处"
        "——主图 11+装配 9+加速 6;节段字段序整体重排=named 插入所致,语义零变)。",
        "2. t2i 加速宿主 [208] 速度档手改值=`2 · Fun-Acc 4步`(旧档号串;⑱ 迁移时"
        "按语义归一到新串 `0 · Fun-Acc 4步`,slot-map §5 口径)。",
        "3. 装配子图 [141]/[152] inputs 条目与 wv 形态=手改态(尾槽 widget 残留,"
        "⑭ 迁移时收形,slot-map §1/§2 口径)。",
        "4. 布局 pos=手改后用户摆放(基线,手术零打回;装配子图 [150] x=-187 负坐标"
        "=TestCanvasNormalization0925 红根因,大轮 STEP5 归正)。",
        "5. t2i 蓝图落后宿主(blueprint_sync --check 报差异 9/9 节点 30/30 连线"
        "——手改未过账蓝图;STEP8 重抽复锁)。",
        "",
        "## 核差补漏口径(design §1 表 vs 基线实况)",
        "",
        "- 任务第6条已证:`[7012]` 现不存在(编号重映射后才有),viggle 采样器"
        "现 id=t2i[206]/i2i[189]/edit[56];考据结论作用于其 steps widget(359→6)。",
        "- design §1「i2i/edit 同构映射(各自旧 id→同段号)」细化:**同构功能件对齐"
        "段号**(i2i PE 链主件 [26]TextGenerate→[4013];edit 第二编码 [43]→[4016]);"
        "**特有件留原 id**(i2i PE 链辅助 [21][23][24][25][27]/透明第二路 [153]/"
        "单图编码路 [171][172][173]/三态件 [180];edit PE 链辅助;Reroute)。",
        "- 特有件与 t2i 段位冲突者腾位:i2i/edit 主图 LoadImage [4][5]→[10][11]、"
        "Cache [7]→[9](腾出 [4] 空潜/[5] 解码/[7] 加速宿主/[8] 保存 给同构件)。",
        "- i2i 装配子图无画幅建议器([4018] 段缺位)/无说明卡([4100] 段缺位);"
        "edit 无底座件([4010])/无装配件([4011])/无画幅建议器([4018])/无说明卡"
        "——design §1「edit 无底座件则无 4010 段」同款推及。",
        "- design §2.7「IO 8→7」与 prd ㉑「面板 PE 控件由节点外露(同 seed 手法)」"
        "并读:seed 手法=-10 widget 槽+子图内 Primitive 节点;故 -10 终态=撤"
        " pe_clip+撤旧语义 PE开关槽+立「PE启用?」槽,t2i 8 槽/i2i 8 槽/edit 6 槽。",
        "- viggle 步数考据结论(官方模型卡荐 6 步,本仓 359 偏离 60 倍)=改 6;cfg1/"
        "euler 与官方一致保持;sigma 表(官方配 Viggle Turbo Sigmas)本仓未挂="
        "已知偏差记档(速查卡+本档)。",
        "",
        "## 附录:git diff HEAD -- qi21-道劫-t2i.json 全量",
        "",
        "```diff",
        diff,
        "```",
    ]
    RESEARCH.mkdir(parents=True, exist_ok=True)
    (RESEARCH / "baseline-manual.md").write_text("\n".join(md), encoding="utf-8")
    ck((RESEARCH / "baseline-manual.md").stat().st_size > len(diff) * 0.9,
       f"baseline-manual.md 落盘(含 diff 全量,"
       f"{(RESEARCH / 'baseline-manual.md').stat().st_size}B)")


# ════════════════════════════════════════════════════════════════════
def step2(data: dict[str, dict]) -> None:
    print("== STEP2 三件编号重映射(id/连线/文字引用全链)")
    for tag, d in data.items():
        idm = ID_MAPS[tag]
        news = list(idm.values())
        ck(len(news) == len(set(news)), f"[{tag}] 映射目标 id 无内部重复")
        exist = {n["id"] for n in d["nodes"]}
        for sg in d["definitions"]["subgraphs"]:
            exist |= {n["id"] for n in sg["nodes"]}
        ck(exist == set(idm),
           f"[{tag}] 现存节点集与映射表一致"
           f"(多:{sorted(exist - set(idm))} 少:{sorted(set(idm) - exist)})")
        for n in d["nodes"]:
            n["id"] = idm[n["id"]]
        for sg in d["definitions"]["subgraphs"]:
            for n in sg["nodes"]:
                n["id"] = idm[n["id"]]
        for l in d["links"]:
            if l[1] in idm:
                l[1] = idm[l[1]]
            if l[3] in idm:
                l[3] = idm[l[3]]
        for sg in d["definitions"]["subgraphs"]:
            for l in sg["links"]:
                if l["origin_id"] in idm:
                    l["origin_id"] = idm[l["origin_id"]]
                if l["target_id"] in idm:
                    l["target_id"] = idm[l["target_id"]]
        d["last_node_id"] = max(d.get("last_node_id", 0), max(idm.values()))
        pat = re.compile(r"\[(\d+)\]")

        def rewrite_text(s: str) -> str:
            return pat.sub(lambda m: f"[{idm.get(int(m.group(1)), int(m.group(1)))}]", s)

        touched = 0
        for n in d["nodes"]:
            if n["type"] == "MarkdownNote" and n.get("widgets_values"):
                n["widgets_values"] = [rewrite_text(t) if isinstance(t, str) else t
                                       for t in n["widgets_values"]]
                touched += 1
        for sg in d["definitions"]["subgraphs"]:
            for n in sg["nodes"]:
                if n["type"] == "MarkdownNote" and n.get("widgets_values"):
                    n["widgets_values"] = [rewrite_text(t) if isinstance(t, str) else t
                                           for t in n["widgets_values"]]
                    touched += 1
        for g in d.get("groups", []):
            if isinstance(g.get("title"), str):
                g["title"] = rewrite_text(g["title"])
        ck(touched >= 1, f"[{tag}] MarkdownNote 文字引用重写 ≥1(实 {touched})")
        allids = [n["id"] for n in d["nodes"]]
        for sg in d["definitions"]["subgraphs"]:
            allids += [n["id"] for n in sg["nodes"]]
        ck(len(allids) == len(set(allids)),
           f"[{tag}] 术后全文件节点 id 唯一({len(allids)} 件)")
        print(f"  [{tag}] 重映射 {len(idm)} id;Note/组框文字引用已全链改写")


OLD_HOST_WV: dict[str, tuple[list[str], list]] = {}


def snapshot_host_widgets(data: dict[str, dict]) -> None:
    """STEP2 后(-10 重建前)快照宿主旧 widget 序+值(STEP3 重建会抹掉旧序)。"""
    for tag, d in data.items():
        sg = asm_sg(d)
        host = next(n for n in d["nodes"]
                    if n.get("properties", {}).get("subgraph") == sg["id"])
        hin = [s["name"] for s in host.get("inputs") or [] if s.get("widget")]
        wv = host.get("widgets_values")
        if not (hin and len(hin) == len(wv)):
            hin = [i["name"] for i in sg["inputs"]
                   if i["type"] in ("COMBO", "BOOLEAN", "INT")
                   or (i["type"] == "STRING" and i["name"] in ("主体句", "指令"))]
        ck(len(hin) == len(wv),
           f"[{tag}] 宿主旧 widget 序快照对拍({hin} vs wv{wv and len(wv)})")
        OLD_HOST_WV[tag] = (hin, list(wv))
        print(f"  [{tag}] 宿主旧 widget 序快照:{hin}")


# ════════════════════════════════════════════════════════════════════
def step3(data: dict[str, dict]) -> None:
    print("== STEP3 ⑬ PE TE 迁子图(4019)+㉑ [4012] PE启用? 立+扇出+双槽撤")
    NEW_LINK = 200
    for tag, d in data.items():
        sg = asm_sg(d)
        nodes = nmap(sg)
        # 3a. 主图仅剩主 TE;4019 已在装配子图(main() 预挪)
        mains = [n for n in d["nodes"] if n["type"] == "CLIPLoader"]
        ck(len(mains) == 1 and mains[0]["id"] == 2, f"[{tag}] 主图仅 [2] 主TE")
        ck(4019 in nodes and nodes[4019]["type"] == "CLIPLoader",
           f"[{tag}] [4019] PE TE 在装配子图")
        # 3b. PE 链 clip 进线 origin 改 [4019]:0
        pe_in = [l for l in sg["links"] if l["origin_id"] == -10 and l["type"] == "CLIP"
                 and nodes.get(l["target_id"], {}).get("type")
                 in ("QwenImage21_T2IPromptRewrite", "TextGenerate")
                 and l["target_slot"] == 0]
        ck(len(pe_in) == 1, f"[{tag}] PE 链 clip 进线恰 1 条(实 {len(pe_in)})")
        pe_in[0]["origin_id"] = 4019
        pe_in[0]["origin_slot"] = 0
        outs4019 = nodes[4019].get("outputs")
        if outs4019:
            outs4019[0]["links"] = [pe_in[0]["id"]]   # 旧主图 link 引用清除,指向子图内新线
        else:
            nodes[4019]["outputs"] = [{"name": "CLIP", "type": "CLIP",
                                       "links": [pe_in[0]["id"]], "slot_index": 0}]
        # 3c. ㉑ [4012] PrimitiveBoolean(seed 手法:-10「PE启用?」widget 槽→4012.value)
        pe13 = nodes[4013]
        sg_4012 = {
            "id": 4012, "type": "PrimitiveBoolean",
            "pos": [pe13["pos"][0] - 460, pe13["pos"][1] - 320],
            "size": [280, 90], "flags": {}, "order": 0, "mode": 0,
            "inputs": [{"name": "value", "type": "BOOLEAN",
                        "widget": {"name": "value"}, "link": NEW_LINK}],
            "outputs": [{"name": "BOOLEAN", "type": "BOOLEAN", "links": [],
                         "slot_index": 0}],
            "properties": {"Node name for S&R": "PrimitiveBoolean"},
            "widgets_values": [True], "title": TITLES[tag][4012],
        }
        sg["nodes"].append(sg_4012)
        # 旧 -10.PE开关 槽(按槽位)出线改 origin [4012]:0
        pe_sw = [l for l in sg["links"] if l["origin_id"] == -10
                 and l["origin_slot"] == PE_SLOT_OLD[tag] and l["type"] == "BOOLEAN"]
        for l in pe_sw:
            l["origin_id"] = 4012
            l["origin_slot"] = 0
            sg_4012["outputs"][0]["links"].append(l["id"])
        if tag == "t2i":
            ck(len(pe_sw) == 2, f"t2i PE开关扇出恰 2 线(实 {len(pe_sw)}:合成器+画幅联动)")
        else:
            ck(len(pe_sw) == 1, f"[{tag}] PE开关线恰 1(实 {len(pe_sw)})")
        # 3d. -10 inputs 按终态槽序重建(名转移;PE启用? 新槽)
        old_ins = copy.deepcopy(sg["inputs"])
        old_names = [i["name"] for i in old_ins]
        by_name = {i["name"]: i for i in old_ins}
        ck("PE开关" in by_name, f"[{tag}] 原 -10 有「PE开关」槽(㉑ 撤除对象)")
        new_inputs = []
        for k, (nm, tp) in enumerate(SG_INPUTS_NEW[tag]):
            if nm in by_name:
                e = copy.deepcopy(by_name[nm])
                e["name"], e["type"] = nm, tp
            else:
                ck(nm == "PE启用?", f"[{tag}] 新槽仅 PE启用?(实 {nm})")
                e = {"id": f"a1e2c3d4-{9000 + k}-4a0{k:02d}-9e0{k:02d}-7d4a9c31a9{k:02d}",
                     "name": nm, "type": tp, "linkIds": [], "pos": [-216, 104 + 20 * k]}
            new_inputs.append(e)
        sg["inputs"] = new_inputs
        # 既有 -10 出线 origin_slot 按新序重写(旧槽名→新槽位)
        for l in sg["links"]:
            if l["origin_id"] == -10 and l["origin_slot"] < len(old_names):
                nm = old_names[l["origin_slot"]]
                ck(nm in [x[0] for x in SG_INPUTS_NEW[tag]] or nm in ("PE开关", "pe_clip"),
                   f"[{tag}] -10 旧槽 {nm} 在新旧槽表之一")
                if nm in [x[0] for x in SG_INPUTS_NEW[tag]]:
                    l["origin_slot"] = [x[0] for x in SG_INPUTS_NEW[tag]].index(nm)
        # 新线:-10.PE启用? → [4012].value
        pe_idx = [x[0] for x in SG_INPUTS_NEW[tag]].index("PE启用?")
        sg["links"].append({"id": NEW_LINK, "origin_id": -10, "origin_slot": pe_idx,
                            "target_id": 4012, "target_slot": 0, "type": "BOOLEAN"})
        # linkIds 全量重算(与子图 links 双向一致)
        for i in sg["inputs"]:
            i["linkIds"] = [l["id"] for l in sg["links"] if l["origin_id"] == -10
                            and sg["inputs"][l["origin_slot"]]["name"] == i["name"]]
        sg["state"]["lastLinkId"] = max(sg["state"].get("lastLinkId", 0), NEW_LINK)
        sg["state"]["lastNodeId"] = max(sg["state"].get("lastNodeId", 0), 4012)
        # 3e. 主图删死线(旧 pe_clip 宿主连线)
        before = len(d["links"])
        d["links"] = [l for l in d["links"]
                      if not (l[1] == 4019 and l[3] == 6 and l[5] == "CLIP")]
        ck(before - len(d["links"]) == 1, f"[{tag}] 主图 pe_clip 宿主死线恰删 1")
        print(f"  [{tag}] [4019] 迁入+[4012] 扇出 {len(sg_4012['outputs'][0]['links'])} 处;"
              f"-10 终态 {len(sg['inputs'])} 槽")


# ════════════════════════════════════════════════════════════════════
def _reorder_node_inputs(sg: dict, node: dict, ntype: str, tag: str) -> None:
    order = NODE_INPUT_ORDER[ntype]
    old = list(node.get("inputs") or [])
    by_name = {s["name"]: s for s in old}
    TYPE_OF = {"BASE": "STRING", "主体句": "STRING", "锁层A全文": "STRING",
               "装配全文": "STRING", "PE出文": "STRING", "pe开关": "BOOLEAN",
               "透明模式": "BOOLEAN", "RGBA官方头句": "STRING", "RGBA官方尾句": "STRING",
               "W1收束句": "STRING", "wh_ratio": "STRING", "九型WIDTH": "INT",
               "九型HEIGHT": "INT", "联动开关": "BOOLEAN", "手动宽": "INT",
               "手动高": "INT", "base": "COMBO", "透明覆盖": "BOOLEAN"}
    for nm in order:
        if nm not in by_name:
            by_name[nm] = {"name": nm, "type": TYPE_OF[nm], "link": None}
    node["inputs"] = [copy.deepcopy(by_name[nm]) for nm in order]
    for l in sg["links"]:
        if l["target_id"] == node["id"] and l["target_slot"] < len(old):
            nm = old[l["target_slot"]]["name"]
            if nm in order:
                l["target_slot"] = order.index(nm)
    # wv/named 收形(候选旧序按长度对拍)
    cands = WV_OLD_CANDIDATES.get((tag, ntype))
    if cands:
        wv = node.get("widgets_values")
        cand = next((c for c in cands if len(c) == len(wv)), None)
        ck(cand is not None,
           f"{ntype}[{node['id']}] wv 长度 {wv and len(wv)} 无候选对拍"
           f"(候选 {[len(c) for c in cands]})")
        val = dict(zip(cand, wv))
        for nm in NEW_WIDGET_SLOTS[ntype]:
            val.setdefault(nm, WIDGET_DEFAULTS.get(nm, ""))
        node["widgets_values"] = [val[n] for n in NEW_WIDGET_SLOTS[ntype]]
        if "widgets_values_named" in node:
            node["widgets_values_named"] = {n: val[n]
                                            for n in NEW_WIDGET_SLOTS[ntype]}


def step4(data: dict[str, dict]) -> None:
    print("== STEP4 ⑭ 槽序重迁(三件全)+⑯ 型名/rgba_default 删+宿主 UI 对齐")
    for tag, d in data.items():
        sg = asm_sg(d)
        nodes = nmap(sg)
        for ntype in ("MyQi21PromptAssembly", "MyQi21PromptSelect", "MyQi21WhSuggest"):
            for n in by_type(sg, ntype):
                _reorder_node_inputs(sg, n, ntype, tag)
        if 4010 in nodes:
            b = nodes[4010]
            _reorder_node_inputs(sg, b, "MyQi21DaojieBase", tag)
            old_outs = list(b.get("outputs") or [])
            out_by_name = {o["name"]: o for o in old_outs}
            ck(set(out_by_name) <= {"BASE", "WIDTH", "HEIGHT", "型名", "rgba_default",
                                    "透明值"} and "BASE" in out_by_name,
               f"[{tag}] [4010] 旧出槽集对拍(实 {sorted(out_by_name)})")
            tv = copy.deepcopy(out_by_name.get("透明值")
                               or {"name": "透明值", "type": "BOOLEAN", "links": []})
            rg = list(out_by_name.get("rgba_default", {}).get("links") or [])
            tv["links"] = sorted(set(list(tv.get("links") or []) + rg))
            new_outs = [copy.deepcopy(out_by_name["BASE"]),
                        copy.deepcopy(out_by_name["WIDTH"]),
                        copy.deepcopy(out_by_name["HEIGHT"]), tv]
            for i, o in enumerate(new_outs):
                o["slot_index"] = i
            b["outputs"] = new_outs
            for l in sg["links"]:
                if l["origin_id"] == 4010 and l["origin_slot"] < len(old_outs):
                    oldn = old_outs[l["origin_slot"]]["name"]
                    if oldn in ("透明值", "rgba_default"):
                        l["origin_slot"] = 3
                    elif oldn in ("BASE", "WIDTH", "HEIGHT"):
                        l["origin_slot"] = ["BASE", "WIDTH", "HEIGHT"].index(oldn)
            if tag == "i2i":
                hint = [l for l in sg["links"] if l["target_id"] == 180
                        and l["target_slot"] == 1]
                ck(len(hint) == 1 and hint[0]["origin_id"] == 4010
                   and hint[0]["origin_slot"] == 3,
                   "i2i [180].rgba_hint 已迁 [4010].透明值(槽3)")
            if tag == "t2i":
                tvl = [l for l in sg["links"] if l["origin_id"] == 4010
                       and l["origin_slot"] == 3]
                ck(len(tvl) == 2, f"t2i 透明值双扇出两线(实 {len(tvl)})")
        # 宿主 UI 对齐(inputs=-10 镜像;wv/named/子图 widgets 三镜像)
        host = [n for n in d["nodes"] if n["id"] == 6][0]
        old_hin = {s["name"]: s for s in host.get("inputs") or []}
        new_hin = []
        for nm, tp in SG_INPUTS_NEW[tag]:
            if nm in old_hin:
                e = copy.deepcopy(old_hin[nm])
                e["name"], e["type"] = nm, tp
            else:
                e = {"name": nm, "type": tp, "widget": {"name": nm}, "link": None}
            if nm in WIDGET_SLOTS[tag]:
                e["widget"] = {"name": nm}
            else:
                e.pop("widget", None)
            new_hin.append(e)
        host["inputs"] = new_hin
        names = [nm for nm, _ in SG_INPUTS_NEW[tag] if nm in WIDGET_SLOTS[tag]]
        old_names, wv = OLD_HOST_WV[tag]
        ck(len(old_names) == len(wv),
           f"[{tag}] 宿主旧 widget 序长度对拍({old_names} vs wv{len(wv)})")
        val = dict(zip(old_names, wv))
        if "PE开关" in val:
            val["PE启用?"] = val.pop("PE开关")
        host["widgets_values"] = [val[n] for n in names]
        if "widgets_values_named" in host:
            host["widgets_values_named"] = {n: val[n] for n in names}
        sg["widgets"] = [val[n] for n in names]
        print(f"  [{tag}] ⑭ 重排落+⑯ 四出+宿主 {len(new_hin)} 槽对齐;"
              f"widget 序={names}")


# ════════════════════════════════════════════════════════════════════
def step5(data: dict[str, dict]) -> None:
    print("== STEP5 ⑤⑧ 标题全量表+Q5 thinking+更名[6]+负坐标归正")
    for tag, d in data.items():
        titled = 0
        for n in d["nodes"]:
            if n["id"] in TITLES[tag]:
                n["title"] = TITLES[tag][n["id"]]
                titled += 1
        sg = asm_sg(d)
        for n in sg["nodes"]:
            ck(n["id"] in TITLES[tag], f"[{tag}] 装配子图 [{n['id']}] 在标题表")
            n["title"] = TITLES[tag][n["id"]]
            titled += 1
        acc = acc_sg(d)
        for n in acc["nodes"]:
            ck(n["id"] in TITLES[tag], f"[{tag}] 加速子图 [{n['id']}] 在标题表")
            n["title"] = TITLES[tag][n["id"]]
            titled += 1
        sg["name"] = NEW_SG_NAME
        host = [n for n in d["nodes"] if n["id"] == 6][0]
        host["title"] = TITLES[tag][6]
        if tag == "t2i":
            pe = [n for n in sg["nodes"] if n["id"] == 4013][0]
            think_idx = [o["name"] for o in pe["outputs"]].index("thinking")
            pe["outputs"][think_idx]["links"] = \
                list(pe["outputs"][think_idx].get("links") or []) + [201]
            sg["nodes"].append({
                "id": 4020, "type": "easy showAnything",
                "pos": [pe["pos"][0] + 540, pe["pos"][1] + 360],
                "size": [500, 160], "flags": {}, "order": 0, "mode": 0,
                "inputs": [{"name": "anything", "type": "*", "link": 201}],
                "outputs": [{"name": "output", "type": "*", "links": None,
                             "slot_index": 0}],
                "properties": {"Node name for S&R": "easy showAnything"},
                "widgets_values": [""], "title": TITLES[tag][4020],
            })
            sg["links"].append({"id": 201, "origin_id": 4013, "origin_slot": think_idx,
                                "target_id": 4020, "target_slot": 0, "type": "STRING"})
            sg["state"]["lastNodeId"] = max(sg["state"].get("lastNodeId", 0), 4020)
            sg["state"]["lastLinkId"] = max(sg["state"].get("lastLinkId", 0), 201)
        # 布局微调(网格搜索定案,audit 口径:asm crossings 最优;
        # t2i 4010 归正后取 [1200,1300]=基线 28 持平;i2i 4012/4019 最优 77)
        POS_TUNING = {
            "t2i": {4010: [1200, 1300]},
            "i2i": {4012: [100, 900], 4019: [700, 580]},
            "edit": {4012: [1200, 200], 4019: [400, 200]},
        }
        for nid, pos in POS_TUNING[tag].items():
            nn = [n for n in asm_sg(d)["nodes"] + acc_sg(d)["nodes"]
                  + d["nodes"] if n["id"] == nid]
            if nn:
                nn[0]["pos"] = list(pos)
        # 负坐标归正(TestCanvasNormalization0925 红根修;主图 x 与子图 x/y)
        fixed = 0
        for coll in ([d["nodes"]] + [s["nodes"] for s in d["definitions"]["subgraphs"]]):
            for n in coll:
                if n["pos"][0] < 0 or n["pos"][1] < 0:
                    n["pos"] = [max(n["pos"][0] + 300, 20), max(n["pos"][1] + 20, 20)]
                    fixed += 1
        print(f"  [{tag}] title {titled} 件;更名「{NEW_SG_NAME}」;负坐标归正 {fixed} 处")


# ════════════════════════════════════════════════════════════════════
def step6(data: dict[str, dict]) -> None:
    print("== STEP6 ⑱ 默认档 FunAcc(四处双写)+viggle 6 步+Note 改写")
    for tag, d in data.items():
        acc = acc_sg(d)
        host = [n for n in d["nodes"] if n["id"] == 7][0]
        old_mode = host["widgets_values"][0]
        ck(old_mode in ("0 · 直出40步", "2 · Fun-Acc 4步"),
           f"[{tag}] 宿主旧档位串可识别(实 {old_mode!r})")
        host["widgets_values"][0] = FUNACC
        if "widgets_values_named" in host:
            host["widgets_values_named"]["速度档位"] = FUNACC
        acc["widgets"][0] = FUNACC
        sel = [n for n in acc["nodes"] if n["id"] == 7015][0]
        sel["widgets_values"][0] = FUNACC
        if "widgets_values_named" in sel:
            sel["widgets_values_named"]["mode"] = FUNACC
        vig = [n for n in acc["nodes"] if n["id"] == 7012][0]
        ck(vig["widgets_values"][2] == 359,
           f"[{tag}] viggle 旧 steps=359(实 {vig['widgets_values'][2]})")
        vig["widgets_values"][2] = 6
        if "widgets_values_named" in vig:
            vig["widgets_values_named"]["steps"] = 6
        note = [n for n in d["nodes"] if n["type"] == "MarkdownNote"][0]
        txt = note["widgets_values"][0]
        subs = [
            # t2i(带 ** 包裹形态)
            ("首项=默认=「0 · 直出40步」**(0929 拉齐重放;Fun-Acc 仍为主加速=次序第二)",
             "首项=默认=「0 · Fun-Acc 4步」**(1002 用户新令,推翻 0929 拉齐重放;直出40步居二/viggle 居三)"),
            # i2i/edit(无档号形态;长串先于 t2i 短串,防子串先吃)
            ("首项=默认=直出40步=0929 拉齐重放裁定;Fun-Acc 仍为主加速=次序第二",
             "首项=默认=「0 · Fun-Acc 4步」=1002 用户新令(推翻 0929 拉齐重放;直出40步居二)"),
            ("首项=「0 · 直出40步」=默认(0929 拉齐重放;Fun-Acc 仍为主加速=次序第二)",
             "首项=「0 · Fun-Acc 4步」=默认(1002 用户新令,推翻 0929 拉齐重放;直出40步居二/viggle 居三)"),
            ("默认=直出40步=0929 拉齐重放裁定", "默认=Fun-Acc 4步=1002 用户新令(推翻 0929 拉齐重放)"),
            ("关 PE开关=直写选配时", "关 PE启用?=直写选配时"),
            # viggle 三件
            ("viggle359步(KSampler·359步·cfg1;0929 用户改值,原 6=v0.2.1 系卡荐档)",
             f"viggle6步(KSampler·6步·cfg1;{VIGGLE_NOTE})"),
            ("[7012] KSampler 359 步(0929 拉齐值,原 6;cfg 保持 1)",
             f"[7012] KSampler 6 步({VIGGLE_NOTE};cfg 保持 1)"),
            ("[7012]=359", "[7012]=6(官方荐档)"),
            ("[7012] 359 步;模型卡注", "[7012] 6 步;模型卡注"),
            ("viggle 359=0929 拉齐值,原 6=v0.2.1 系卡荐档", VIGGLE_NOTE),
            ("viggle 支路 [7012]=359(0929 拉齐值,原 6)",
             f"viggle 支路 [7012]=6 步({VIGGLE_NOTE})"),
            ("0=直出 40 步(官方完整档)=[9]Cache→[7010]KSampler;1=viggle 359 步=[9]Cache→[7011] LoraLoaderModelOnly(0.8)→[7012]KSampler;2=Fun-Acc·4步=[9]Cache→[7013]T8",
             "0=Fun-Acc·4步=[9]Cache→[7013]T8(默认,1002 ⑱);1=直出 40 步(官方完整档)=[9]Cache→[7010]KSampler;2=viggle 6 步=[9]Cache→[7011] LoraLoaderModelOnly(0.8)→[7012]KSampler"),
            ("[7010] steps=40/[7012] steps=359", "[7010] steps=40/[7012] steps=6"),
            ("steps 359(0929 拉齐改值,原 6=v0.2.1 系卡荐档;cfg 保持 1)",
             "steps 6(1002 考据官方荐档,原 359 步系 TE-Speed 时代历史值;cfg 保持 1)"),
            # ⑬ 迁件+㉑ 节点化三件
            ("clip 由主图 [4019] PE 专属 TE 经 [6].pe_clip 槽一进线供给",
             "clip 由子图内 [4019] PE 专属 TE 直供(1002 ⑬ 迁入,pe_clip 槽撤)"),
            ("[4019] PE CLIPLoader(pe_i2i bf16·type=qwen_image,主图加载器行)经宿主 pe_clip 槽一进线",
             "[4019] PE CLIPLoader(1002 ⑬ 迁入子图,pe_clip 槽撤,直供 [4013])"),
            ("pe_clip 输入(①加载器 [4019] PE CLIPLoader·pe_i2i bf16·type=qwen_image)",
             "PE TE 直供(1002 ⑬ 迁入子图=[4019] PE CLIPLoader·pe_i2i bf16,pe_clip 槽撤)"),
            ("开关经宿主面板「PE开关」暴露(默认开)",
             "开关=[4012]『PE启用?』节点(PrimitiveBoolean,1002 ㉑;宿主面板同名控件外露,扇出合成器)"),
            ("宿主面板「PE开关」默认开(0926 裁定1)",
             "[4012]『PE启用?』节点(PrimitiveBoolean,1002 ㉑;宿主面板同名控件外露)默认开(0926 裁定1)"),
            ("pe开关在 [6] 面板",
             "PE 开关=[4012]『PE启用?』节点(PrimitiveBoolean 单源扇出合成器+画幅建议器;1002 ㉑;面板同名控件外露)"),
            ("面板=主体句/型选择/PE开关/透明(仅自由型)/手动宽高(仅PE关)六控件",
             "面板=主体句/型选择/PE启用?([4012] 节点外露)/透明(仅自由型)/手动宽高(仅PE启用?关)六控件"),
            ("面板四控件=指令/型选择/RGBA透明/PE开关",
             "面板控件=指令/型选择/PE启用?([4012] 节点外露,1002 ㉑)/RGBA透明"),
        ]
        hit = sum(1 for old, new in subs if old in txt and (txt := txt.replace(old, new)) or False) \
            if False else 0
        # (上式不可读,展开:)
        hit = 0
        for old, new in subs:
            if old in txt:
                txt = txt.replace(old, new)
                hit += 1
        note["widgets_values"][0] = txt
        # t2i 主图组框①加载器文字:PE TE 迁子图后主图无双 TE(⑬ 连带)
        for g in d.get("groups", []):
            if isinstance(g.get("title"), str) and "双TE" in g["title"]:
                g["title"] = g["title"].replace(
                    "双TE:[2]主+[4019]PE专属→[6]",
                    "主TE:[2]→[6];PE专属TE已迁装配子图(1002 ⑬)")
        ck(hit >= 3, f"[{tag}] Note 关键替换命中 ≥3(实 {hit})")
        ck(FUNACC in txt, f"[{tag}] Note 含新默认档串")
        residue = [m.start() for m in re.finditer(r"359", txt)]
        allowed = txt.count("359 步系 TE-Speed")
        ck(len(residue) == allowed,
           f"[{tag}] Note 无 359 残留(实 {len(residue)} 处,豁免 {allowed})")
        for n in asm_sg(d)["nodes"]:
            if n["type"] == "MarkdownNote":
                n["widgets_values"][0] = (
                    "[4100] 装配子图段说明卡(1002 大轮终态编号:4010 底座/4011 装配/"
                    "4012 PE启用?/4013 PE改写/4014 合成器/4015 主编码/4016 RGBA编码/"
                    "4017 输出选择/4018 画幅建议器/4019 PE专属TE/4020 PE思考预览;"
                    "机制细节见主图 [402] 速查卡)\n" + n["widgets_values"][0])
        print(f"  [{tag}] 默认档={FUNACC};viggle 359→6;Note 命中 {hit}")


# ════════════════════════════════════════════════════════════════════
WEB_JS = REPO / "apps/backend/engines/comfyui/my_nodes/web/qi21-panel-linkage.js"


def step7(dry: bool = False) -> None:
    print("== STEP7 web 扩展(锚 [4012]/型选择+⑲ 防抖)")
    js = WEB_JS.read_text(encoding="utf-8")
    if "PE启用?" in js and "debounceMs" in js and "[4012]" in js:
        ck(True, "web 扩展已是 1002 大轮新版(幂等重入)")
        return
    ck("PE开关" in js and "hidden" in js, "web 扩展现态锚词对拍(PE开关 时代版本)")
    if not dry:
        WEB_JS.write_text(NEW_WEB_JS, encoding="utf-8")
        new = WEB_JS.read_text(encoding="utf-8")
        ck("PE启用?" in new and "debounceMs" in new and "[4012]" in new,
           "web 扩展新锚([4012] PE启用?)+防抖(debounceMs)落盘")
    else:
        ck("PE启用?" in NEW_WEB_JS and "debounceMs" in NEW_WEB_JS,
           "web 扩展新锚文案备妥(dry 不落盘)")


NEW_WEB_JS = '''// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. COMMERCIAL_LICENSE.md available.
/**
 * qi21 面板联动(qi21-panel-linkage,1001 用户测试批 P3 立;1002 大轮重锚):
 * 装配宿主子图面板上的两组条件控件做纯显隐联动——
 *   ① PE启用?=true(PE 自动给画幅;锚=子图内 [4012] PrimitiveBoolean 的宿主
 *      外露 widget,1002 ㉑ 节点化)→ 隐藏「手动宽/手动高」;false → 显示;
 *   ② 型选择=「自由」→ 显示「透明」布尔;九型 → 隐藏(透明值由底座件
 *      [4010] 出「透明值」按型解析,面板布尔只在自由型有意义)。
 * 边界铁律:**只管显隐不管值**——零值写入,值路由全在执行层;hidden 是纯
 * UI 态,不入 widgets_values 序列化,重开工作流由本扩展按当前值重算。
 *
 * ⑲ 闪现修复(1002 大轮,定位=扩展显隐与前端缩放重绘路径竞态):
 *   - 显隐写(hidden)与布局(computeSize/setDirtyCanvas)**分离**:写 hidden
 *     即时,布局改动合并防抖(trailing 200ms)——缩放期间反复触发只落一次
 *     布局,消灭 combo 选择框闪现(4个/2个)的重复重绘路径;
 *   - 画布缩放静默窗:canvas scale 变化后 400ms 内布局腿让路(缩放中的
 *     computeSize 是闪现放大器);显隐值本身仍即时保持。
 * 生效面与兼容:宿主定位=widget 签名(型选择/PE启用?/透明/手动宽/手动高
 * 五名同存)∧ 子图名含「文本提示词类型优化子图」双保险。
 */
import { app } from "/scripts/app.js";

// 设计钉死值(探针逐值锁):显隐规则与定位签名的唯一真源
export const QI21_PANEL_LINKAGE_TOKENS = Object.freeze({
  tickMs: 400,                                    // 兜底轮询周期(同 autofit 先例)
  debounceMs: 200,                                // ⑲ 布局腿防抖(1002 大轮)
  zoomQuietMs: 400,                               // ⑲ 缩放静默窗(1002 大轮)
  subgraphNameHint: "文本提示词类型优化子图",       // 宿主子图名锚(1002 ⑬ 更名)
  peNodeAnchor: "[4012]",                          // PE启用? 节点锚(1002 ㉑)
  widgetNames: Object.freeze({
    type: "型选择",                                // combo:九型+自由
    pe: "PE启用?",                                 // toggle:true=PE 自动画幅([4012] 外露)
    alpha: "透明",                                 // toggle:仅自由型显示
    manualW: "手动宽",                             // number:仅 PE 关时显示
    manualH: "手动高",                             // number:仅 PE 关时显示
  }),
  freeType: "自由",                                // 型选择里启用透明布尔的唯一档
});

const attached = new WeakSet();

/** 宿主 widget 组:五名同存才返回组,否则 null(签名即门) */
function readWidgets(node) {
  const by = Object.create(null);
  for (const w of node?.widgets ?? []) {
    if (w && w.name) by[w.name] = w;
  }
  const N = QI21_PANEL_LINKAGE_TOKENS.widgetNames;
  for (const k of ["type", "pe", "alpha", "manualW", "manualH"]) {
    if (!by[N[k]]) return null;
  }
  return {
    type: by[N.type], pe: by[N.pe], alpha: by[N.alpha],
    manualW: by[N.manualW], manualH: by[N.manualH],
  };
}

/** 宿主判定:widget 签名 ∧ 子图名/标题锚词(双保险,宁缺勿错伤) */
function isHost(node) {
  if (!readWidgets(node)) return false;
  const hint = QI21_PANEL_LINKAGE_TOKENS.subgraphNameHint;
  const sgName = String(node.subgraph?.name ?? "");
  const title = String(node.title ?? "");
  return sgName.includes(hint) || title.includes(hint);
}

// ⑲:布局腿防抖(每节点一份 pending;缩放静默期内推迟)
const layoutTimers = new WeakMap();
let lastScale = null;
let lastScaleAt = 0;

function zoomQuiet() {
  try {
    const s = app.canvas?.ds?.scale;
    if (typeof s === "number" && s !== lastScale) {
      lastScale = s;
      lastScaleAt = performance.now();
    }
    return performance.now() - lastScaleAt < QI21_PANEL_LINKAGE_TOKENS.zoomQuietMs;
  } catch { return false; }
}

function scheduleLayout(node) {
  if (layoutTimers.has(node)) return;
  const t = setTimeout(() => {
    layoutTimers.delete(node);
    if (zoomQuiet()) { scheduleLayout(node); return; }  // 缩放中=再让一拍
    try { node.computeSize?.(); } catch { /* 布局兜底失败不阻塞显隐 */ }
    node.setDirtyCanvas?.(true, true);
  }, QI21_PANEL_LINKAGE_TOKENS.debounceMs);
  layoutTimers.set(node, t);
}

/** 应用显隐(纯 UI,零值写;⑲:hidden 即时/布局防抖):返回是否有变化 */
function applyLinkage(node) {
  const q = readWidgets(node);
  if (!q) return false;
  const alphaHidden = String(q.type.value) !== QI21_PANEL_LINKAGE_TOKENS.freeType;
  const manualHidden = q.pe.value === true;
  let dirty = false;
  const set = (w, hidden) => {
    if (w.hidden !== hidden) { w.hidden = hidden; dirty = true; }
  };
  set(q.alpha, alphaHidden);
  set(q.manualW, manualHidden);
  set(q.manualH, manualHidden);
  if (dirty) scheduleLayout(node);   // ⑲:布局腿防抖(不再同步 computeSize)
  return dirty;
}

/** 附着:链式包装 onWidgetChanged(即时联动),幂等(重复 attach 零双层) */
function attach(node) {
  attached.add(node);
  const prev = node.onWidgetChanged;
  if (typeof prev === "function" && prev.__qi21PanelLinkage) return;
  const wrapped = function (name, value, oldValue, widget) {
    try { prev?.call(this, name, value, oldValue, widget); } catch { /* 原钩子异常不吞联动 */ }
    try { applyLinkage(this); } catch { /* 联动失败不阻塞宿主 */ }
  };
  wrapped.__qi21PanelLinkage = true;
  node.onWidgetChanged = wrapped;
  applyLinkage(node); // 发现即首轮应用(打开工作流自恢复显隐)
}

app.registerExtension({
  name: "my.qi21.panel.linkage",
  setup() {
    const tick = () => {
      try {
        for (const node of app.graph?._nodes ?? []) {
          if (attached.has(node)) {
            applyLinkage(node); // 兜底:store 投影重建等场景 hidden 丢失即重写
          } else if (isHost(node)) {
            attach(node);       // 发现即附着+首轮应用(打开工作流自恢复)
          }
        }
      } catch { /* 轮询单轮失败静默,下轮再来 */ }
    };
    tick();
    const timer = setInterval(tick, QI21_PANEL_LINKAGE_TOKENS.tickMs);
    addEventListener("pagehide", () => clearInterval(timer), { once: true });
  },
});
'''


# ════════════════════════════════════════════════════════════════════
def rebuild_blueprint(tag: str, d: dict) -> None:
    sg = asm_sg(d)
    host = [n for n in d["nodes"] if n["id"] == 6][0]
    root = {"id": 1, "type": host["type"], "pos": [0, 0],
            "size": host.get("size", [560, 480]), "flags": {}, "order": 0, "mode": 0,
            "properties": copy.deepcopy(host.get("properties", {})),
            "inputs": copy.deepcopy(host.get("inputs") or []),
            "outputs": copy.deepcopy(host.get("outputs") or []),
            "widgets_values": copy.deepcopy(host.get("widgets_values")),
            "title": host.get("title")}
    bp = {"revision": 1, "last_node_id": 1, "last_link_id": 0, "nodes": [root],
          "links": [], "version": 0.4,
          "definitions": {"subgraphs": [copy.deepcopy(sg)]},
          "info": {"category": "漫影", "name": NEW_SG_PREFIX + ("" if tag == "t2i"
                   else ("(i2i)" if tag == "i2i" else "(edit)"))}}
    name = {"t2i": "qi21-提示词类型优化子图.json",
            "i2i": "qi21-提示词类型优化子图-i2i.json",
            "edit": "qi21-提示词类型优化子图-edit.json"}[tag]
    jdump(SUBGRAPHS / name, bp)


def step8(data: dict[str, dict], dry: bool) -> None:
    print("== STEP8 蓝图重抽+sync 锚改+layout baseline+退役警示+引擎家")
    for tag, d in data.items():
        rebuild_blueprint(tag, d)
    sync = REPO / "apps/build/scripts/qi21_blueprint_sync_1001.py"
    txt = sync.read_text(encoding="utf-8")
    ck('SG_NAME_PREFIX = "[40] 提示词类型优化子图"' in txt, "sync 脚本旧锚在位")
    txt = txt.replace('SG_NAME_PREFIX = "[40] 提示词类型优化子图"',
                      'SG_NAME_PREFIX = "[6] 文本提示词类型优化子图"')
    if not dry:
        sync.write_text(txt, encoding="utf-8")
    # layout baseline 重立(audit 实测;拓扑变更合法重立)
    baseline = jload(BASELINE)
    audit_py = REPO / "apps/build/scripts/qi21_layout_audit_0924.py"
    for tag, p in WFS.items():
        # audit 跑术后内存态(此刻三件尚未落盘,临时文件承载;否则读到旧态)
        probe = OUT / f"audit-probe-{tag}.json"
        jdump(probe, data[tag])
        r = subprocess.run([sys.executable, str(audit_py), str(probe)],
                           capture_output=True, text=True, check=True)
        scopes = {"main": int(re.search(r"主图=(\d+)", r.stdout).group(1))}
        for m in re.finditer(r"== 子图\[(.+?)\]: .*?交叉=(\d+)", r.stdout):
            scopes[f"sub:{m.group(1)}"] = int(m.group(2))
        ck(len(scopes) == 3, f"[{tag}] audit 三 scope 齐({list(scopes)})")
        rel = str(p.relative_to(REPO))
        ck(rel in baseline["files"], f"[{tag}] baseline 条目在位")
        baseline["files"][rel]["scopes"] = {k: {"crossings": v, "occlusion": 0}
                                            for k, v in scopes.items()}
        baseline["files"][rel]["s5Note"] = (
            "1002 大轮拓扑合法重立(Trellis 10-01-qi21-usetest-batch implement 步8:"
            "⑫编号重排/⑬PE TE 迁子图/㉑4012 节点化/⑭槽序重排/⑯出槽清理/Q5 thinking "
            "预览件——节点集与连线集拓扑变更,audit 实测重立;旧值见 git 历史;"
            "自此只降不升,上调须拓扑变更合法重立且理由入档)")
        print(f"  [{tag}] audit scopes={scopes}")
    baseline["rebuiltAt"] = subprocess.run(["date", "+%Y-%m-%dT%H:%M:%S"],
                                           capture_output=True, text=True).stdout.strip()
    if not dry:
        jdump(BASELINE, baseline)
    retired = ["qi21_usertest_surgery_1001.py", "qi21_assembly_surgery_1001.py",
               "qi21_integration_surgery_1001.py", "qi21_integration_surgery_i2i_1001.py",
               "qi21_integration_surgery_edit_1001.py", "qi21_blueprint_extract_1001.py",
               "qi21_blueprint_host_swap_1001.py"]
    guard = ('# ⛔ 退役警示(2026-10-02 大轮 qi21_biground_surgery_1002.py 落地):\n'
             '# 本脚本手术对象已被 1002 大轮终态取代,重跑会把工作流打回旧态——封存勿运行。\n'
             'import sys as _sys  # noqa: E402\n'
             'print("⛔ 已退役(1002 大轮终态在库):本脚本会打回 10-02 手术,拒绝执行。")\n'
             '_sys.exit(3)\n')
    done = []
    for name in retired:
        p = REPO / "apps/build/scripts" / name
        if not p.exists() or "⛔ 退役警示" in p.read_text(encoding="utf-8"):
            continue
        t = p.read_text(encoding="utf-8")
        m = re.search(r'("""(?:.|\n)*?""")', t)
        ck(m, f"{name} docstring 定位")
        if not dry:
            p.write_text(t[:m.end()] + "\n\n" + guard + t[m.end():], encoding="utf-8")
        done.append(name)
    print(f"  退役警示落 {len(done)} 件:{done}")
    if ENGINE_MYNODES.exists() and not dry:
        dst = ENGINE_MYNODES / "web" / WEB_JS.name
        if dst.read_bytes() != WEB_JS.read_bytes():
            dst.write_bytes(WEB_JS.read_bytes())
            print(f"  引擎家 web 扩展已刷新 {dst.name}")
        for tag in data:
            src = SUBGRAPHS / {"t2i": "qi21-提示词类型优化子图.json",
                               "i2i": "qi21-提示词类型优化子图-i2i.json",
                               "edit": "qi21-提示词类型优化子图-edit.json"}[tag]
            d2 = ENGINE_MYNODES / "subgraphs" / src.name
            if d2.read_bytes() != src.read_bytes():
                d2.write_bytes(src.read_bytes())
                print(f"  引擎家蓝图已刷新 {src.name}")


# ════════════════════════════════════════════════════════════════════
def final_verify(data: dict[str, dict]) -> None:
    print("== 终态完整性门")
    for tag, d in data.items():
        sg = asm_sg(d)
        acc = acc_sg(d)
        ck(sg["name"] == NEW_SG_NAME, f"[{tag}] 装配子图名终态")
        ck([(i["name"], i["type"]) for i in sg["inputs"]] == SG_INPUTS_NEW[tag],
           f"[{tag}] -10 槽序=终态表")
        for i in sg["inputs"]:
            live = [l["id"] for l in sg["links"] if l["origin_id"] == -10
                    and l["origin_slot"] < len(sg["inputs"])
                    and sg["inputs"][l["origin_slot"]]["name"] == i["name"]]
            ck(sorted(i["linkIds"]) == sorted(live),
               f"[{tag}] -10.{i['name']} linkIds 双向一致")
        for o in sg["outputs"]:
            live = [l["id"] for l in sg["links"] if l["target_id"] == -20
                    and l["target_slot"] < len(sg["outputs"])
                    and sg["outputs"][l["target_slot"]]["name"] == o["name"]]
            ck(sorted(o.get("linkIds") or []) == sorted(live),
               f"[{tag}] -20.{o['name']} linkIds 双向一致")
        def _lid(l):
            return l["id"] if isinstance(l, dict) else l[0]

        def _t(l):
            return (l["target_id"], l["target_slot"]) if isinstance(l, dict) else (l[3], l[4])

        def _o(l):
            return (l["origin_id"], l["origin_slot"]) if isinstance(l, dict) else (l[1], l[2])

        for scope_nodes, scope_links in ((sg["nodes"], sg["links"]),
                                         (acc["nodes"], acc["links"]),
                                         (d["nodes"], d["links"])):
            for n in scope_nodes:
                for s in n.get("inputs") or []:
                    if s.get("link") is not None:
                        ck(any(_lid(l) == s["link"] and _t(l)[0] == n["id"]
                               for l in scope_links),
                           f"[{tag}] [{n['id']}].{s['name']} 输入线在册")
                for s in n.get("outputs") or []:
                    for lid in (s.get("links") or []):
                        ck(any(_lid(l) == lid and _o(l)[0] == n["id"]
                               for l in scope_links),
                           f"[{tag}] [{n['id']}].{s['name']} 输出线 {lid} 在册")
        if 4010 in nmap(sg):
            ck([o["name"] for o in nmap(sg)[4010]["outputs"]] ==
               ["BASE", "WIDTH", "HEIGHT", "透明值"], f"[{tag}] [4010] 四出")
        host = [n for n in d["nodes"] if n["id"] == 7][0]
        ck(host["widgets_values"][0] == FUNACC and acc["widgets"][0] == FUNACC
           and nmap(acc)[7015]["widgets_values"][0] == FUNACC,
           f"[{tag}] 默认档 {FUNACC} 四处一致")
        ck(nmap(acc)[7012]["widgets_values"][2] == 6, f"[{tag}] viggle steps=6")
        ck(4012 in nmap(sg) and nmap(sg)[4012]["type"] == "PrimitiveBoolean",
           f"[{tag}] [4012] 在位")
        ck(4019 in nmap(sg) and nmap(sg)[4019]["type"] == "CLIPLoader",
           f"[{tag}] [4019] 迁入装配子图")
        ck(not [n for n in d["nodes"] if n["type"] == "CLIPLoader" and n["id"] != 2],
           f"[{tag}] 主图无第二 CLIPLoader")
        if tag == "t2i":
            ck(4020 in nmap(sg), "t2i [4020] thinking 预览在位")
        allids = [n["id"] for n in d["nodes"]]
        for s in d["definitions"]["subgraphs"]:
            allids += [n["id"] for n in s["nodes"]]
        ck(len(allids) == len(set(allids)), f"[{tag}] 全文件 id 唯一({len(allids)})")
        ck(d["last_node_id"] >= max(allids), f"[{tag}] last_node_id≥max id")
        for coll in ([d["nodes"]] + [s["nodes"] for s in d["definitions"]["subgraphs"]]):
            for n in coll:
                ck(n["pos"][0] >= 0 and n["pos"][1] >= 0,
                   f"[{tag}] 节点坐标非负([{n['id']}]{n['pos']})")
        # 三件套统计:装配子图节点数
        print(f"  [{tag}] 终态:装配子图 {len(sg['nodes'])} 节点/{len(sg['links'])} 线;"
              f"加速 {len(acc['nodes'])}/{len(acc['links'])};主图 {len(d['nodes'])}/{len(d['links'])}")


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    data = {tag: jload(p) for tag, p in WFS.items()}
    for tag, d in data.items():
        jdump(OUT / f"before-{tag}.json", d)
    step1()
    step2(data)
    snapshot_host_widgets(data)
    # ⑬ 迁件:[11]/[12]→id 4019 已映射,把节点对象从主图挪进装配子图
    for tag, d in data.items():
        mv = [n for n in d["nodes"] if n["id"] == 4019]
        ck(len(mv) == 1, f"[{tag}] 待迁 PE TE 恰 1 件")
        sg = asm_sg(d)
        pe13 = [n for n in sg["nodes"] if n["id"] == 4013][0]
        mv[0]["pos"] = [pe13["pos"][0] - 30, pe13["pos"][1] - 480]
        d["nodes"].remove(mv[0])
        sg["nodes"].append(mv[0])
    step3(data)
    step4(data)
    step5(data)
    step6(data)
    step7(a.dry)
    step8(data, a.dry)
    final_verify(data)
    if a.dry:
        print(f"[dry] 全步通过(断言 {len(_checks)} 条),未落盘")
        (OUT / "assertions.txt").write_text("\n".join(_checks), encoding="utf-8")
        return
    for tag, d in data.items():
        jdump(WFS[tag], d)
        jdump(OUT / f"after-{tag}.json", d)
        ck(jload(WFS[tag]) == d, f"[{tag}] 落盘回读一致")
    (OUT / "assertions.txt").write_text("\n".join(_checks), encoding="utf-8")
    print(f"[done] 三件落盘+回读一致;断言 {len(_checks)} 条;三件套在 {OUT}")


if __name__ == "__main__":
    main()
