#!/usr/bin/env python3
"""qi21 衔接批手术总脚本(2026-10-02,Trellis 10-02-qi21-subgraph-singleport
implement 步6-9 衔接批;design §7;prd ㉔㉕㉖;一个脚本一把,fail-closed 术前
指纹不匹配即中止不写)。

术式:
  ㉔ viggle 1.0 + T8 wv 对齐:
     - 三件加速子图 [7011] LoraLoaderModelOnly strength_model 0.8→1.0
       (用户令「要定在 1.0 上面否则就失去了意义」,推翻 0925 探针定档;
        t2i 有 widgets_values_named 双写同步,i2i/edit 仅位置数组);
     - i2i/edit [7013] T8 wv 两值→三值补 'randomize'(F1 wv 序列化漂移残留
       对齐 t2i 形态 [model_file, seed, control_after_generate])。
  ㉕ SeedVR2 放大尾档(t2i+i2i 主图输出区右端):
     - 四件组 [501]SeedVR2LoadDiTModel(sharp 7B fp8)/[502]SeedVR2LoadVAEModel
       (ema_vae_fp16)/[503]SeedVR2VideoUpscaler(短边2048=2K)/[504]SaveImage
       (MYStudio-2K)——参数真源=qwen21-t2i-seedvr2.json [9][11][12][13] 运行时
       只读深拷贝(该件实弹绿在册 85c4cfb;并行会话件零改动零写);
     - [5] VAEDecode IMAGE 扇出双喂(直出保存 [8] + 放大路 [503]);
     - Ctrl+B 旁路语义=新⑤组框罩四件(框选本组 Ctrl+B→只出 [8] 直出图;
       旁路态 SaveImage 不执行零落盘);
     - 速查卡 [402] 加指引行「放大尾档适合1MP档(道具/人脸/自由),
       4.2MP≈纯插值建议旁路」(分辨率适配裁定=方案2 手动旁路,不加自动判断件)。
  ㉖ rgthree ImageComparer(t2i 专属,用户只点 t2i):
     - [505] ImageComparer (rgthree):image_a←[5] 第三扇出(直出图)/
       image_b←[503] 扇出(2K 图);放输出区尾端(抬高布置=零遮挡几何,见下);
       纯预览件不落盘;⑤组旁路时 b 侧收直出图(ComfyUI bypass 直通语义)。
  布局几何(零左向线+零新增遮挡/交叉,layout_check 实测把守):
     - [8] 原位挡 [5]→放大路横向车道(918×833 大盒),下沉让出车道
       (t2i y1728→2400 / i2i y1500→1900;组框④随扩;size 零动=用户预览展开保真);
     - 加载器对 [501]/[502] 纵叠车道下方(est 高 466/658 驱动 80+ 间距),
       [503]/[504] 居车道右延,[505] 抬高至车道上方(image_a 长线跨 [503] 顶
       净空过,避穿盒);
     - 全部新线恒右向(坑11);links 数组格式随主图现形(列表式)。
  坑清单对照:坑1(wv 形态契约索引禁漂移)/坑3(新线登记 inputs[].link+
     outputs[].links 程序化回填)/坑5(速查卡文案同步+viggle 1.0 引点改写)/
     坑7(术后退役警示)/坑11(新线全单向自查)。
  蓝图:装配子图定义零触碰(手术全在主图+加速子图 wv),仍按坑2 顺序做
     重抽回蓝图(逐字节 no-op 断言)+交 sync --check 锁幂等(步8 域)。

不动项:edit 主图零新增件(用户只点 t2i+i2i 接放大尾档);装配子图拓扑/
IO 槽面/宿主面板零变化;并行会话(10-02 批 5 件+清单 md)零接触;引擎家
零触碰(装机/打包=后续打包轮域);[4020] thinking 预览/PE 英文不动。

回滚:apps/output/linkage-1002/pre/ 术前快照逐字节还原。

用法:python3 apps/build/scripts/qi21_linkage_surgery_1002.py
"""

# ⛔ 退役警示(2026-10-02 衔接批手术落地后封存,坑7;先例=qi21_blueprint_extract_1001):
# 本脚本手术对象已被 10-02 衔接批终态取代,重跑会把三件工作流打回术前态
# (术前指纹断言会先红拦截=双保险)——封存勿运行。
import sys as _sys  # noqa: E402
print("⛔ 已退役(10-02 衔接批终态在库):本脚本会打回手术,拒绝执行。")
_sys.exit(3)

import copy
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
BP_DIR = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs"
OUT_DIR = REPO / "apps/output/linkage-1002"
LAYOUT_CHECK = REPO / ".agents/skills/node-graph/tools/layout_check.py"
SRC_SEEDVR2 = WF_DIR / "1_文生图" / "qwen21-t2i-seedvr2.json"   # 参数真源(只读)

FILES = {
    "t2i": WF_DIR / "1_文生图" / "qi21-道劫-t2i.json",
    "i2i": WF_DIR / "2_图生图" / "qi21-道劫-i2i.json",
    "edit": WF_DIR / "2_图生图" / "qi21-edit.json",
}
BLUEPRINTS = {
    "t2i": BP_DIR / "qi21-提示词类型优化子图.json",
    "i2i": BP_DIR / "qi21-提示词类型优化子图-i2i.json",
    "edit": BP_DIR / "qi21-提示词类型优化子图-edit.json",
}
ASG_PREFIX = "[6] 文本提示词类型优化子图"
ACC_PREFIX = "道劫·加速子图"

LORA_FILE = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors"
FUNACC_FILE = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors"

# 术前基线(棘轮对照;layout_check 口径)
BASELINE_MAIN = {"t2i": {"crossings": 3, "occlusion": 0},
                 "i2i": {"crossings": 5, "occlusion": 0}}


def die(msg: str) -> None:
    print(f"⛔ {msg}")
    sys.exit(2)


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def get_sg(wf: dict, prefix: str) -> dict:
    hits = [s for s in wf["definitions"]["subgraphs"] if s["name"].startswith(prefix)]
    assert len(hits) == 1, \
        f"应恰 1 个 {prefix!r} 前缀子图,得 {[s['name'] for s in wf['definitions']['subgraphs']]}"
    return hits[0]


def main_nodes(wf: dict) -> dict:
    return {n["id"]: n for n in wf["nodes"]}


def replace_once(text: str, old: str, new: str, tag: str) -> str:
    n = text.count(old)
    assert n == 1, f"速查卡锚 {tag!r} 命中 {n} 处(预期 1),拒绝盲替"
    return text.replace(old, new, 1)


# ══════════════════ 0. 术前快照(fail-closed)══════════════════
PRE = OUT_DIR / "pre"
PRE.mkdir(parents=True, exist_ok=True)
for k, p in FILES.items():
    dst = PRE / p.name
    if not dst.exists():
        shutil.copy2(p, dst)
        back = json.loads(dst.read_text(encoding="utf-8"))
        assert json.dumps(back, ensure_ascii=False) == json.dumps(load(p), ensure_ascii=False), \
            f"{k} 术前快照回读不一致"
print("[pre ] 三件术前快照落 apps/output/linkage-1002/pre/(字节回读校验✓)")

wfs = {k: load(p) for k, p in FILES.items()}

# ══════════════════ 1. ㉔ viggle 1.0 + T8 wv 对齐 ══════════════════
for k, wf in wfs.items():
    acc = get_sg(wf, ACC_PREFIX)
    nm = {n["id"]: n for n in acc["nodes"]}
    lora, t8 = nm[7011], nm[7013]
    # 术前指纹(fail-closed)
    assert lora["type"] == "LoraLoaderModelOnly" and lora["widgets_values"] == [LORA_FILE, 0.8], \
        f"{k}: [7011] 术前指纹漂移,得 {lora.get('widgets_values')}"
    assert t8["type"] == "T8QwenImage21FunAccPDD4Step", f"{k}: [7013] 件型漂移"
    # viggle 1.0(用户令 1002 衔接批㉔,推翻 0925 探针 0.8)
    lora["widgets_values"][1] = 1.0
    if "widgets_values_named" in lora:
        assert lora["widgets_values_named"] == {"lora_name": LORA_FILE, "strength_model": 0.8}
        lora["widgets_values_named"]["strength_model"] = 1.0
    # T8 wv 三值形(i2i/edit 两值→补 control_after_generate='randomize',对齐 t2i/F1 口径)
    if k in ("i2i", "edit"):
        assert t8["widgets_values"] == [FUNACC_FILE, 0], \
            f"{k}: [7013] 术前 wv 漂移,得 {t8['widgets_values']}"
        t8["widgets_values"] = [FUNACC_FILE, 0, "randomize"]
    else:
        assert t8["widgets_values"] == [FUNACC_FILE, 0, "randomize"], \
            "t2i: [7013] 应已是三值形(指纹)"
    print(f"[㉔  ] {k}: [7011] strength 0.8→1.0"
          + (" + [7013] wv 两值→三值补 randomize" if k in ("i2i", "edit") else "([7013] 三值形指纹✓)"))

# ══════════════════ 2. ㉕ 模板抽取(参数真源只读)══════════════════
src = load(SRC_SEEDVR2)
src_nodes = {n["id"]: n for n in src["nodes"]}
TEMPLATES = {}
for sid, nid, title in ((9, 501, "[501] SeedVR2 DiT加载(sharp 7B fp8)"),
                        (11, 502, "[502] SeedVR2 VAE加载(ema fp16)"),
                        (12, 503, "[503] SeedVR2放大(短边2048=2K档)"),
                        (13, 504, "[504] 放大保存(2K·MYStudio-2K)")):
    t = copy.deepcopy(src_nodes[sid])
    t["id"] = nid
    t["title"] = title
    for i in t.get("inputs", []):
        i["link"] = None
    for o in t.get("outputs", []):
        if o.get("links"):
            o["links"] = None
    TEMPLATES[nid] = t
assert TEMPLATES[503]["widgets_values"][2] == 2048, "放大件 resolution 术前指纹应 2048(短边2K)"
assert TEMPLATES[504]["widgets_values"] == ["MYStudio-2K"], "2K 保存件前缀指纹应 MYStudio-2K"
print("[㉕  ] 四件模板自 qwen21-t2i-seedvr2.json 只读抽取✓(DiT/VAE/放大2048/存MYStudio-2K)")

# ══════════════════ 3. 主图手术(t2i / i2i)══════════════════
def wire(wf: dict, lid: int, oid: int, oslot: int, tid: int, tslot: int, typ: str) -> None:
    """新线登记(坑3:links 数组+两端节点 inputs[].link/outputs[].links 双侧回填)。"""
    wf["links"].append([lid, oid, oslot, tid, tslot, typ])
    onode, tnode = main_nodes(wf)[oid], main_nodes(wf)[tid]
    oi = onode["outputs"][oslot]
    oi["links"] = [lid] if not oi.get("links") else list(oi["links"]) + [lid]
    ti = tnode["inputs"][tslot]
    assert ti.get("link") is None, f"靶槽已占线:link{lid}→{tid}:{tslot}"
    ti["link"] = lid
    # 坑11:新线全单向自查(起点 x < 终点 x)
    assert tnode["pos"][0] > onode["pos"][0], \
        f"左向线:link{lid} {onode['pos']}→{tnode['pos']}"


def place(node: dict, pos: list, order: int) -> dict:
    node["pos"] = pos
    node["order"] = order
    return node


# ---- t2i ----
wf = wfs["t2i"]
nm = main_nodes(wf)
# 术前指纹:[5]/[8] 输出区现状 + [5] 单扇出
assert nm[5]["type"] == "VAEDecode" and nm[5]["outputs"][0]["links"] == [11], "t2i [5] 术前指纹漂移"
assert nm[8]["type"] == "SaveImage" and nm[8]["inputs"][0]["link"] == 11, "t2i [8] 术前指纹漂移"
assert round(nm[8]["pos"][0]) == 6010 and round(nm[8]["pos"][1]) == 1728, \
    f"t2i [8] 术前位置漂移 {nm[8]['pos']}"
# [8] 下沉让出横向车道(size 零动=用户预览展开保真)
nm[8]["pos"] = [nm[8]["pos"][0], 2400.0]
# 四件组+对比件落位
wf["nodes"] += [
    place(copy.deepcopy(TEMPLATES[501]), [7150, 1900], 12),
    place(copy.deepcopy(TEMPLATES[502]), [7150, 2450], 13),
    place(copy.deepcopy(TEMPLATES[503]), [7870, 1760], 14),
    place(copy.deepcopy(TEMPLATES[504]), [8430, 1760], 15),
]
comparer = {
    "id": 505, "type": "ImageComparer (rgthree)", "pos": [8430, 1200],
    "size": [420, 460], "flags": {}, "order": 16, "mode": 0,
    "inputs": [
        {"name": "image_a", "type": "IMAGE", "link": None},
        {"name": "image_b", "type": "IMAGE", "link": None},
    ],
    "outputs": [{"name": "IMAGES", "type": "IMAGE", "links": None}],
    "title": "[505] 直出×2K对比·ImageComparer",
    "properties": {"Node name for S&R": "ImageComparer (rgthree)"},
    "widgets_values": ["rgthree.compare."],
}
wf["nodes"].append(comparer)
# 新线 202-207:[5]三扇出(直出存/放大/对比a)+放大链+对比b
wire(wf, 202, 5, 0, 503, 0, "IMAGE")     # [5].IMAGE → [503].image
wire(wf, 203, 501, 0, 503, 1, "SEEDVR2_DIT")
wire(wf, 204, 502, 0, 503, 2, "SEEDVR2_VAE")
wire(wf, 205, 503, 0, 504, 0, "IMAGE")   # [503].IMAGE → [504].images
wire(wf, 206, 5, 0, 505, 0, "IMAGE")     # [5].IMAGE → [505].image_a(第三扇出)
wire(wf, 207, 503, 0, 505, 1, "IMAGE")   # [503].IMAGE → [505].image_b
wf["last_link_id"] = 207
assert wf["last_node_id"] >= 505, "last_node_id 应≥505"
# 组框:④扩 bounding 罩下沉 [8]+改题;⑤新立(罩四件,不罩 [505]=旁路语义纯净)
g4 = next(g for g in wf["groups"] if g["id"] == 5)
assert g4["title"].startswith("道劫·④输出"), "t2i 组框④术前指纹漂移"
g4["title"] = "道劫·④输出([5]VAEDecode→[8]直出保存;[5]另扇出→⑤放大尾档)"
g4["bounding"] = [g4["bounding"][0], g4["bounding"][1], g4["bounding"][2], 1650]
wf["groups"].append({
    "id": 6,
    "title": "道劫·⑤SeedVR2放大尾档·2K([501]DiT+[502]VAE→[503]短边2048→[504]存MYStudio-2K;"
             "可整组旁路:框选本组Ctrl+B→只出[8]直出图;适合1MP档,4.2MP≈纯插值建议旁路)",
    "bounding": [7050, 1700, 1860, 1500], "color": "#b58b2a", "flags": {},
})
print("[㉕㉖] t2i:四件组+[505]对比件+6 线+[8]下沉+组框④⑤落位")

# ---- i2i ----
wf = wfs["i2i"]
nm = main_nodes(wf)
assert nm[5]["type"] == "VAEDecode" and nm[5]["outputs"][0]["links"] == [38], "i2i [5] 术前指纹漂移"
assert nm[8]["type"] == "SaveImage" and nm[8]["inputs"][0]["link"] == 38, "i2i [8] 术前指纹漂移"
assert round(nm[8]["pos"][0]) == 10460 and round(nm[8]["pos"][1]) == 1500, \
    f"i2i [8] 术前位置漂移 {nm[8]['pos']}"
nm[8]["pos"] = [nm[8]["pos"][0], 1900.0]
wf["nodes"] += [
    place(copy.deepcopy(TEMPLATES[501]), [11050, 1600], 22),
    place(copy.deepcopy(TEMPLATES[502]), [11050, 2150], 23),
    place(copy.deepcopy(TEMPLATES[503]), [11560, 1475], 24),
    place(copy.deepcopy(TEMPLATES[504]), [12160, 1475], 25),
]
wire(wf, 201, 5, 0, 503, 0, "IMAGE")
wire(wf, 202, 501, 0, 503, 1, "SEEDVR2_DIT")
wire(wf, 203, 502, 0, 503, 2, "SEEDVR2_VAE")
wire(wf, 204, 503, 0, 504, 0, "IMAGE")
wf["last_link_id"] = 204
g4 = next(g for g in wf["groups"] if g["id"] == 5)
assert g4["title"].startswith("道劫·④输出"), "i2i 组框④术前指纹漂移"
g4["title"] = "道劫·④输出([5]解码→[8]直出保存;[5]另扇出→⑤放大尾档)"
g4["bounding"] = [9940, 1375, 1000, 980]
wf["groups"].append({
    "id": 6,
    "title": "道劫·⑤SeedVR2放大尾档·2K([501]DiT+[502]VAE→[503]短边2048→[504]存MYStudio-2K;"
             "可整组旁路:框选本组Ctrl+B→只出[8]直出图;适合1MP档,4.2MP≈纯插值建议旁路)",
    "bounding": [10950, 1375, 1660, 1500], "color": "#a88040", "flags": {},
})
print("[㉕  ] i2i:四件组+4 线+[8]下沉+组框④⑤落位(edit 零新增件=用户令只点 t2i+i2i)")

# ══════════════════ 4. 速查卡文案(坑5)══════════════════
def patch_card(wf: dict, patches: list[tuple[str, str]], tag: str) -> None:
    note = next(n for n in wf["nodes"] if n["id"] == 402)
    assert note["type"] == "MarkdownNote"
    t = note["widgets_values"][0]
    for old, new in patches:
        t = replace_once(t, old, new, f"{tag}:{old[:24]}")
    note["widgets_values"][0] = t


VIGGLE_NOTE = ("1002 衔接批㉔用户令「要定在 1.0 上面否则就失去了意义」(推翻 0925 探针定档 "
               "0.8=flatMAD 2.52→1.75;「目前暂时」=可视效果再调)")
patch_card(wfs["t2i"], [
    ("(v0.2.1 r256·strength 0.8)", "(v0.2.1 r256·strength 1.0)"),
    ("strength 0.8——0925 探针最优:flatMAD 2.52→1.75 细腻无结构缺陷;8步方案 2.60 无收益+超荐档弃)",
     f"strength 1.0——{VIGGLE_NOTE};8步方案 2.60 无收益+超荐档弃)"),
    ("④输出([5][8]);每画布恰两子图", "④输出([5][8]→⑤放大尾档);每画布恰两子图"),
    ("### 参数圣经",
     "### SeedVR2 放大尾档(⑤组框·2K;1002 衔接批㉕)\n\n"
     "- [5] 解码图双喂:[8] 直出保存 + [503] SeedVR2 放大(短边 2048=2K 档)→[504] 存 MYStudio-2K 前缀;"
     "模型 [501] seedvr2_7b_sharp_fp8_e4m3fn + [502] ema_vae_fp16 已装机(models/SEEDVR2)。\n"
     "- **可整组旁路:框选⑤组框 Ctrl+B → 只出 [8] 直出图**(旁路态放大组零执行零落盘)。\n"
     "- **放大尾档适合 1MP 档(道具/人脸/自由),4.2MP≈纯插值建议旁路**"
     "(九型实查:4.2MP 六型短边 1376~2096 增益仅 ×1.1~1.3;1.0MP 三型短边 1024 真增益 ×2.0)。\n"
     "- [505] ImageComparer (rgthree) 对比件:image_a=[5] 直出图/image_b=[503] 2K 图,"
     "滑帘左右对比细节增益(纯预览不落盘;⑤组旁路时 b 侧收直出图=同图对比)。\n\n"
     "### 参数圣经"),
], "t2i")
patch_card(wfs["i2i"], [
    ("viggle 蒸馏件已装机,strength 0.8=0925 探针最优:flatMAD 2.52→1.75)",
     f"viggle 蒸馏件已装机,strength 1.0={VIGGLE_NOTE})"),
    ("### 提示词起草",
     "### SeedVR2 放大尾档(⑤组框·2K;1002 衔接批㉕)\n\n"
     "- [5] 解码图双喂:[8] 直出保存 + [503] SeedVR2 放大(短边 2048=2K 档)→[504] 存 MYStudio-2K 前缀;"
     "模型 [501] seedvr2_7b_sharp_fp8_e4m3fn + [502] ema_vae_fp16 已装机(models/SEEDVR2)。\n"
     "- **可整组旁路:框选⑤组框 Ctrl+B → 只出 [8] 直出图**(旁路态放大组零执行零落盘)。\n"
     "- **放大尾档适合 1MP 档(道具/人脸/自由),4.2MP≈纯插值建议旁路**"
     "(九型实查:4.2MP 六型短边 1376~2096 增益仅 ×1.1~1.3;1.0MP 三型短边 1024 真增益 ×2.0)。\n\n"
     "### 提示词起草"),
], "i2i")
patch_card(wfs["edit"], [
    ("[7011] LoraLoaderModelOnly(0.8)→[7012]KSampler", "[7011] LoraLoaderModelOnly(1.0)→[7012]KSampler"),
    ("strength 0.8(0925 探针最优:flatMAD 2.52→1.75),steps 6",
     f"strength 1.0({VIGGLE_NOTE}),steps 6"),
], "edit")
print("[坑5 ] 三件速查卡:viggle 1.0 引点改写+t2i/i2i 放大尾档指引段入卡")

# ══════════════════ 5. 蓝图重抽(坑2:先抽离再 sync 锁幂等)══════════════════
for k, p in FILES.items():
    wf, bp = wfs[k], load(BLUEPRINTS[k])
    wdef = get_sg(wf, ASG_PREFIX)
    bdef = bp["definitions"]["subgraphs"][0]
    assert bdef["name"] == wdef["name"], f"{k} 蓝图/工作流定义名不匹配"
    before = json.dumps(bdef, ensure_ascii=False, sort_keys=True)
    bp["definitions"]["subgraphs"][0] = copy.deepcopy(wdef)
    after = json.dumps(bp["definitions"]["subgraphs"][0], ensure_ascii=False, sort_keys=True)
    assert after == before, f"{k} 蓝图重抽应为 no-op(装配子图零触碰),出现差异即手术越界"
    save(BLUEPRINTS[k], bp)
print("[坑2 ] 三蓝图重抽=逐字节 no-op✓(装配子图零触碰自证);幂等由 sync --check 锁(步8)")

# ══════════════════ 6. 落盘+术后自查 ══════════════════
for k, p in FILES.items():
    save(p, wfs[k])
print("[save] 三件落盘(indent2/ensure_ascii=False/尾行,仓库现行格式)")

for k in ("t2i", "i2i"):
    wf = load(FILES[k])
    nm = main_nodes(wf)
    links = {l[0]: l for l in wf["links"]}
    # 新件 census
    want = {501: "SeedVR2LoadDiTModel", 502: "SeedVR2LoadVAEModel",
            503: "SeedVR2VideoUpscaler", 504: "SaveImage"}
    for nid, typ in want.items():
        assert nm[nid]["type"] == typ, f"{k} [{nid}] 件型应 {typ}"
    # 扇出登记完整性(坑3):[5] 直出存+放大(+t2i 对比a);[503]→[504](+t2i 对比b)
    out5 = sorted(l[0] for l in wf["links"] if l[1] == 5)
    expect5 = {"t2i": [11, 202, 206], "i2i": [38, 201]}[k]
    assert out5 == expect5, f"{k} [5] 扇出登记 {out5} ≠ {expect5}"
    assert nm[5]["outputs"][0]["links"] == expect5, f"{k} [5].outputs.links 登记漂移"
    # 线-槽双侧登记互锁
    for lid, l in links.items():
        if lid not in ({202, 203, 204, 205, 206, 207} if k == "t2i" else {201, 202, 203, 204}):
            continue
        assert nm[l[3]]["inputs"][l[4]]["link"] == lid, f"{k} link{lid} 靶槽登记缺"
        assert lid in nm[l[1]]["outputs"][l[2]]["links"], f"{k} link{lid} 源槽登记缺"
    # 左向线全图自查(坑11;存量线一并)
    for lid, l in links.items():
        assert nm[l[3]]["pos"][0] > nm[l[1]]["pos"][0], f"{k} 左向线 link{lid}"
    # 计数器
    maxnid = max([n["id"] for n in wf["nodes"]] +
                 [n["id"] for sg in wf["definitions"]["subgraphs"] for n in sg["nodes"]])
    maxlid = max([l[0] for l in wf["links"]] +
                 [l["id"] for sg in wf["definitions"]["subgraphs"] for l in sg["links"]])
    assert wf["last_node_id"] >= maxnid and wf["last_link_id"] >= maxlid, f"{k} 计数器倒挂"
    if k == "t2i":
        assert nm[505]["type"] == "ImageComparer (rgthree)"
        assert nm[505]["inputs"][0]["link"] == 206 and nm[505]["inputs"][1]["link"] == 207
        assert nm[503]["outputs"][0]["links"] == [205, 207]
    print(f"[chk ] {k}:census/扇出/登记/左向/计数器全绿")
# edit 只改 wv,主图零新增
ed = load(FILES["edit"])
assert not [n for n in ed["nodes"] if str(n["type"]).startswith("SeedVR2")], "edit 主图应零 SeedVR2 件"

# ══════════════════ 7. layout_check 棘轮对照 ══════════════════
for k in ("t2i", "i2i"):
    r = subprocess.run([sys.executable, str(LAYOUT_CHECK), str(FILES[k])],
                       capture_output=True, text=True)   # 退出码 1=有违规(存量
    # est_spacing 在册),口径以输出行为准非退出码;2=用法/输入错=致命
    assert r.returncode in (0, 1), f"{k} layout_check 退出码 {r.returncode}:{r.stderr[:200]}"
    line = next(ln for ln in r.stdout.splitlines() if ln.startswith("LAYOUT_CHECK_JSON"))
    m = re.search(r'"main".*?"crossings":(\d+)', line)
    occl = [ln for ln in r.stdout.splitlines() if "occlusion" in ln and ln.startswith("[main]")]
    crossings = int(m.group(1))
    assert crossings <= BASELINE_MAIN[k]["crossings"], \
        f"{k} 主图交叉数 {crossings} > 基线 {BASELINE_MAIN[k]['crossings']}(布局越界,迭代坐标)"
    assert not occl, f"{k} 主图出现遮挡:{occl}"
    print(f"[gate] {k}:主图 crossings={crossings}(基线 {BASELINE_MAIN[k]['crossings']},只降不升✓)"
          f" occlusion=0✓")

print("\n✅ 衔接批手术完成:㉔ viggle 1.0+T8 wv 对齐 / ㉕ SeedVR2 尾档(t2i+i2i) / "
      "㉖ rgthree 对比件(t2i)。后续:契约锚重立→sync --check→全量 pytest→退役警示。")
