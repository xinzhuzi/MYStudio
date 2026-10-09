#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""edit 件 Fun-Acc 默认化手术(1003,Trellis 10-03-edit-fun-acc-4-pe;用户两令:
「如果可以用 Fun-Acc 4 步就用」+「样例换中国的」)。

⚠️ 退役警示(先例=qi21_blueprint_extract_1001/qi21_singleport_surgery_1002):
本脚本一次性手术用途,工作已落地即封存——**勿再运行**(重跑会重复改写历史
表述断言失败而拒绝,或在对的树上做错的事)。import 即退出口径见尾。

改面(edit 一件):
  A. 默认档四处值「1 · 直出40步」→「0 · Fun-Acc 4步」(wv 槽位;Note 文案另行)
  B. [4012] PE启用? PrimitiveBoolean wv [false]→[true](PE开×FunAcc=1003 m1z
     定谳绿;PE关×FunAcc=F3/m2z 白图域)
  C. 样例换中国:[400] 指令→中文单图(背景改水墨,=m1z 实测指令逐字);
     [10]/[11]→daojie-char-1003.png(道劫人物,1002 单口役 f1 产物)
  D. Note [402] 三段改写(样例说明/默认档表述/白图警示定谳翻案)
  E. 蓝图 qi21-提示词类型优化子图-edit.json 的 [4012] wv 同步 false→true
     (子图件蓝图=装配/PE 域;[7] 加速子图无蓝图件,速度 wv 不入蓝图)

门禁:本脚本自带前后断言;跑完 → 契约+全量 pytest → sync --check 三目标。
"""
from __future__ import annotations
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-edit.json"
INSTR = "将<image1>中人物身后的背景改为云雾缭绕的水墨远山,留白取势;人物本体、服饰、兵器与姿态保持完全不变。"
FUNACC, DIRECT = "0 · Fun-Acc 4步", "1 · 直出40步"

def die(msg: str) -> None:
    print(f"❌ {msg}"); sys.exit(3)

def deep_nodes(obj, out: list):
    """递归收集一切带 widgets_values 的节点 dict(主图+definitions 任意嵌套)。"""
    if isinstance(obj, dict):
        if "widgets_values" in obj and isinstance(obj.get("id"), int):
            out.append(obj)
        for v in obj.values():
            deep_nodes(v, out)
    elif isinstance(obj, list):
        for v in obj:
            deep_nodes(v, out)

# ── 前置:可解析即动(处女树 5 处 DIRECT;重跑=半术态 2 处镜像槽;全术态 0)──
raw = WF.read_text()
d = json.loads(raw)
pre_direct = raw.count(DIRECT)
print(f"前置:DIRECT 现存 {pre_direct} 处(5=处女/2=镜像槽残留/0=已全)")

nodes: list[dict] = []
deep_nodes(d, nodes)

# A. 档位 wv 翻转(节点 wv + 宿主 widgets_values_named + 子图定义层 widgets 三类槽,幂等)
flipped = 0
for n in nodes:
    wv = n.get("widgets_values")
    if isinstance(wv, list):
        for i, v in enumerate(wv):
            if v == DIRECT:
                wv[i] = FUNACC; flipped += 1

def _flip_named_widgets(obj, cnt: list):
    """镜像槽:def 级 widgets 数组 / 宿主 widgets_values_named 命名位。"""
    if isinstance(obj, dict):
        w = obj.get("widgets")
        if isinstance(w, list):
            for i, v in enumerate(w):
                if v == DIRECT:
                    w[i] = FUNACC; cnt[0] += 1
        wn = obj.get("widgets_values_named")
        if isinstance(wn, dict):
            for k, v in wn.items():
                if v == DIRECT:
                    wn[k] = FUNACC; cnt[0] += 1
        for v in obj.values():
            _flip_named_widgets(v, cnt)
    elif isinstance(obj, list):
        for v in obj:
            _flip_named_widgets(v, cnt)

_flip_named_widgets(d, [flipped])
post_peek = json.dumps(d, ensure_ascii=False)
if DIRECT in json.dumps([n.get("widgets_values") for n in nodes], ensure_ascii=False):
    die("A 失败:节点 wv 槽仍残留 DIRECT")
if flipped < 1 and FUNACC not in post_peek:
    die("A 失败:未找到任何档位槽")
print(f"A ✓ 档位槽翻转合计 {flipped} 处(节点wv+named+def widgets;幂等重跑=0)")

# B. [4012] PE 默认开
pe_flipped = 0
for n in nodes:
    if n.get("id") == 4012 and n.get("type") == "PrimitiveBoolean":
        wv = n.get("widgets_values")
        if isinstance(wv, list) and wv and wv[0] is False:
            wv[0] = True; pe_flipped += 1
        elif isinstance(wv, list) and wv and wv[0] is True:
            print("B ⚠️ [4012] 已是 true(幂等)")
if pe_flipped == 0 and not any(
    n.get("id") == 4012 and n.get("widgets_values") == [True] for n in nodes
):
    die("B 失败:未找到 [4012] PrimitiveBoolean wv 槽")
print(f"B ✓ [4012] PE启用? 默认开({pe_flipped} 处翻转)")

# C. 样例换中国
c400 = c_img = 0
for n in d["nodes"]:
    if n.get("id") == 400 and n.get("type") == "PrimitiveStringMultiline":
        n["widgets_values"] = [INSTR]; c400 += 1
    elif n.get("id") in (10, 11) and n.get("type") == "LoadImage":
        n["widgets_values"][0] = "daojie-char-1003.png"; c_img += 1
if c400 != 1 or c_img != 2:
    die(f"C 失败:[400]={c400}/1, [10][11]={c_img}/2")
print("C ✓ 中文指令+道劫人物样例(=m1z 实测口径逐字)")

# D. Note [402] 三段改写
note = next((n for n in d["nodes"] if n.get("id") == 402), None)
if not note:
    die("D 失败:无 [402] Note")
t: str = note["widgets_values"][0]
reps = [
    ("**官方换装示例(两张图须先放引擎 input 目录)**\n\n- image_1 = portrait_model_denim.png(编辑画布/人物)\n- image_2 = clothing_light_blue_denim_shirt.png(参考/衬衫)",
     "**道劫样例(中文域;随包种子自动进引擎 input,input_seed 通道)**\n\n- image_1 = daojie-char-1003.png(道劫人物,编辑画布;1002 单口役 f1 产物)\n- image_2 = daojie-char-1003.png(占位同图——默认指令只用 <image1>;要换装/多参考时换自己的参考图)\n- 默认指令(中文单图,与 1003 m1z 实测逐字同):背景改水墨远山,人物服饰兵器姿态不变"),
    ("0=Fun-Acc·4步=[9]Cache→[7013]T8(**本件勿用,见「Fun-Acc×edit 白图警示」**);1=直出 40 步(官方完整档,本件默认)=[9]Cache→[7010]KSampler",
     "0=Fun-Acc·4步=[9]Cache→[7013]T8(**本件默认,须配 PE启用?=开**,见「Fun-Acc×edit 白图警示」);1=直出 40 步(官方完整档)=[9]Cache→[7010]KSampler"),
    ("本件默认=「1 · 直出40步」(1002 R2 修复轮回退 ⑱ 之 edit 推广——Fun-Acc×edit 档位结构性白图,见下方警示)",
     "本件默认=「0 · Fun-Acc 4步」×PE启用?=开(1003 用户令改造:m1z 实测 PE开×FunAcc 真图端到端 250s vs 直出40 514s 快一倍——PE 改写把指令化为英文描述文=FunAcc 蒸馏头训练域)"),
    ("**Fun-Acc×edit 白图警示(1002 R2 修复轮,F3)**:Fun-Acc 支路在 edit 件上实弹两独立 seed(3008/3009)均出全透空白图(1.58M 像素全透,33KB,status=success 无异常=静默坏图;同 seed 重发被节点缓存秒回无法原样重跑);viggle(seed3010)/直出40步(seed3011)同拓扑均绿——Fun-Acc PDD 系 t2i 描述文蒸馏头,对 edit 指令式改图文本分布外崩溃(机理域,节点/接线层无法修复)。**edit 件勿选 0 档**,默认已回退直出40步;t2i/i2i 件的 Fun-Acc 档实弹绿,不受影响。",
     "**Fun-Acc×edit 白图警示(1002 R2 立 F3;1003 中文域复现+定谳翻案)**:死因精确定位=**PE 关×Fun-Acc**(指令直写撞 t2i 描述文蒸馏头分布外崩溃)——两独立 seed(3008/3009 英文指令)与 1003 m2z(中文指令,33KB 全透)三发实锤全透空白图(status=success 静默坏图,同 seed 重发被节点缓存秒回);**PE启用?=开×Fun-Acc=绿**(1003 m1z 道劫中文素材真图,250s)。**用 Fun-Acc 必开 PE,关 PE 请切直出40步**;t2i/i2i 件 Fun-Acc 档不受影响。"),
]
for old, new in reps:
    if old in t:
        t = t.replace(old, new)
    elif new not in t:
        die(f"D 失败:Note 锚未命中(前 40 字):{old[:40]}…")
    # new 已在=上轮已改,幂等跳过
note["widgets_values"][0] = t
print("D ✓ Note 三段改写(样例/默认档/白图警示翻案)")

WF.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
post = WF.read_text()
if post.count(DIRECT) != 0:
    die(f"后验失败:DIRECT 残留 {post.count(DIRECT)} 处")
if "portrait_model_denim" in post or "clothing_light_blue" in post:
    die("后验失败:外国样例名残留")
print(f"✓ 工作流落盘:DIRECT 残留 0;FUNACC 现 {post.count(FUNACC)} 处;外国样例名清零")

# ── E. 蓝图 [4012] 同步 ──
b = json.loads(BP.read_text())
bn: list[dict] = []
deep_nodes(b, bn)
bpe = 0
for n in bn:
    if n.get("id") == 4012 and isinstance(n.get("widgets_values"), list) and n["widgets_values"] and n["widgets_values"][0] is False:
        n["widgets_values"][0] = True; bpe += 1
if bpe == 0 and not any(n.get("id") == 4012 and n.get("widgets_values") == [True] for n in bn):
    die("E 失败:蓝图内未找到 [4012]")
BP.write_text(json.dumps(b, ensure_ascii=False, indent=2) + "\n")
print(f"E ✓ 蓝图 [4012] wv 同步({bpe} 处翻转)")
print("\n手术完成:A档位/B PE默认/C 中文样例/D Note/E 蓝图 全落地。")
