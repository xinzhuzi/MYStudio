#!/usr/bin/env python3
"""qi21 三件装配子图单口手术总脚本(2026-10-02,Trellis 10-02-qi21-subgraph-singleport
implement 步2-3;一个脚本一把三件,fail-closed 术前指纹不匹配即中止不写;
⛔ 已退役:手术终态在库,重跑会打回术前态,勿运行——横幅拦截见文件头常量后)。

术式(prd R1-R7 / design §1-§2,防坑 1-5/7/11 逐条嵌):
  ① 删双编码+闸门:t2i 删 [4016]RGBA编码+[4017]输出选择(12→10 节点);
     i2i 删主路对 [4016][4017]+单路对 [172][173](19→15 节点,两对同款塌缩);
     edit 零删件([4016]=EDIT_TE1 单参考编码功能件保留,无闸门无冗余)。
  ② 单口重接(坑11):[4015]/[171] 单编码独挑双 cond;[4014]/[153] 输出槽面改单口
     「进编码文本」(与件 RETURN_NAMES 同步);t2i 残线 link57(旧槽1→[4016])随删;
     i2i [153] 两线改靶([4016]:4/[172]:3→[4015]:4/[171]:3)+prompt 预览出口改接
     [153]:0(预览=实况,同款 R1);i2i [4014].透明模式 断线(择文上位件禁透明包裹,
     透明边界唯一驻 [153]);新线全单向自查(脚本内 leftward 断言)。
  ③ [4011] 改名「底料拼合」(t2i/i2i;edit 无装配器)。
  ④ 装配子图横向四带(t2i=R4 四带:i 上说明 y120/ii 主链 y600/iii PE y1050/
     iv 画幅 y1500;i2i/edit 同构带序)+IO 圆点就近散布(坑4:勿全钉左列,
     画幅类圆点近最底带)。
  ⑤ 加速子图横向三横排(R7/⑨形态,FunAcc 顶/viggle 中/直出底+seed 寄生带+选择件
     右端;t2i/edit 对齐 i2i 基准,i2i 已是形态零坐标改动,edit IO 就近散布)。
  ⑥ wv 新形同步(坑1):三件 [4014]/[153] wv=7 值形(头2空串占位+pe开关+透明+头/尾/W1)
     断言在册,契约 QI21_SG_SEL_WV 索引口径禁漂移。
  ⑦ links 对象格式+linkIds(坑3):子图 links 恒对象格式断言;删改线后程序化重建
     节点 inputs[].link/outputs[].links 与 -10/-20 槽 linkIds(残留已删线 id=坏登记)。
  ⑧ 说明卡/速查卡文案同步(坑5:删件引点盘清,research/citation-inventory 档在册):
     t2i [4100] 段说明卡+t2i [402] 速查卡 3 行+i2i [402] 2 行。
  ⑨ 蓝图抽离(坑2:先抽离回蓝图再 sync 锁幂等,顺序颠倒=手术被打回):
     工作流装配定义逐字深拷贝→三蓝图 definitions.subgraphs[0](extract 脚本已退役,
     抽离逻辑内聚本脚本;宿主投影/面板零变化不动)。
  ⑩ [4020] thinking 预览原样保留(连线零改动,仅坐标随带①归位;Q2 裁定);
     PE 英文不动(Out of Scope)。

不动项(裁定):主图零波及(装配/加速子图 IO 槽面/宿主面板全不变);
并行会话(10-02 批 5 件+清单 md)零接触;引擎家零触碰(装机/打包=步4-5 域)。

回滚:apps/output/singleport-1002/pre/ 术前快照逐字节还原。

用法:python3 apps/build/scripts/qi21_singleport_surgery_1002.py
"""

import copy
import json
import shutil
import subprocess
import sys
from pathlib import Path

# ⛔ 退役警示(2026-10-02 手术落地后封存,坑7;先例=qi21_blueprint_extract_1001):
# 本脚本手术对象已被 10-02 单口化终态取代,重跑会把三件工作流/三蓝图打回术前态
# ——封存勿运行(术前指纹断言亦会先红拦截,横幅双保险)。
print("⛔ 已退役(10-02 单口化终态在库):本脚本会打回手术,拒绝执行。")
sys.exit(3)

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
BP_DIR = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs"
OUT_DIR = REPO / "apps/output/singleport-1002"
LAYOUT_CHECK = REPO / ".agents/skills/node-graph/tools/layout_check.py"

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
    assert len(hits) == 1, f"应恰 1 个 {prefix!r} 前缀子图,得 {[s['name'] for s in wf['definitions']['subgraphs']]}"
    return hits[0]


def nmap(sg: dict) -> dict:
    return {n["id"]: n for n in sg["nodes"]}


def link_by_id(sg: dict) -> dict:
    return {l["id"]: l for l in sg["links"]}


def drop_links(sg: dict, ids: list[int], expect: dict[str, tuple]) -> None:
    """删线(fail-closed:先逐根断言现形态=expect[linkid]=(origin,slot,target,slot))。"""
    lm = link_by_id(sg)
    for lid in ids:
        key = str(lid)
        assert key in expect, f"术前指纹缺 link{lid} 期望形态"
        l = lm.get(lid)
        assert l is not None, f"link{lid} 不在册(期望 {expect[key]})"
        got = (l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"])
        assert got == expect[key], f"link{lid} 形态漂移:期望 {expect[key]} 得 {got}"
    sg["links"] = [l for l in sg["links"] if l["id"] not in ids]


def relink(sg: dict, lid: int, origin: tuple | None, target: tuple | None,
           expect: tuple) -> None:
    """改线源/靶(fail-closed:先断言现形态)。origin/target=(id, slot) 或 None=不动。"""
    l = link_by_id(sg)[lid]
    got = (l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"])
    assert got == expect, f"link{lid} 改前形态漂移:期望 {expect} 得 {got}"
    if origin is not None:
        l["origin_id"], l["origin_slot"] = origin
    if target is not None:
        l["target_id"], l["target_slot"] = target


def delete_nodes(sg: dict, ids: list[int]) -> None:
    have = {n["id"] for n in sg["nodes"]}
    assert set(ids) <= have, f"删件缺员:期望删 {ids},缺 {sorted(set(ids) - have)}"
    sg["nodes"] = [n for n in sg["nodes"] if n["id"] not in ids]


def set_single_output(node: dict, port_name: str, keep_links_from_slot: int) -> None:
    """MyQi21PromptSelect 节点输出槽面改单口(保留 keep 槽位 dict 与其 links 集合,
    仅改名+裁掉多余槽;slot_index 重排为 0)。"""
    outs = node.get("outputs", [])
    assert len(outs) >= 2, f"[{node['id']}] 应为两口形才做单口化,得 {len(outs)} 口"
    keep = copy.deepcopy(outs[keep_links_from_slot])
    keep["name"] = port_name
    keep["slot_index"] = 0
    keep.pop("links", None)  # links 由 rebuild_refs 程序化重建
    node["outputs"] = [keep]


def rebuild_refs(sg: dict) -> None:
    """从 sg.links 程序化重建节点端引用与 IO 槽 linkIds(坑3:删改线后残留=坏登记)。
    只触碰 inputs[].link / outputs[].links / -10,-20 槽 linkIds 三处,槽声明其余字段不动。"""
    for n in sg["nodes"]:
        for inp in n.get("inputs", []):
            inp["link"] = None          # 无连线槽保持 "link": null 形态(前端序列化惯例)
        for out in n.get("outputs", []):
            out["links"] = []
    for io in ("inputs", "outputs"):
        for slot in sg.get(io, []):
            slot["linkIds"] = []
    nm = nmap(sg)
    for l in sg["links"]:
        oid, oslot, tid, tslot = l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"]
        if oid == -10:
            sg["inputs"][oslot].setdefault("linkIds", []).append(l["id"])
        else:
            nm[oid]["outputs"][oslot]["links"].append(l["id"])
        if tid == -20:
            sg["outputs"][tslot].setdefault("linkIds", []).append(l["id"])
        else:
            nm[tid]["inputs"][tslot]["link"] = l["id"]


def set_pos(sg: dict, pos_map: dict[int, tuple[float, float]]) -> None:
    nm = nmap(sg)
    for nid, (x, y) in pos_map.items():
        assert nid in nm, f"布局缺件 [{nid}]"
        nm[nid]["pos"] = [x, y]


def set_io_pos(sg: dict, kind: str, pos_map: dict[str, tuple[float, float]]) -> None:
    for slot in sg[kind]:
        assert slot["name"] in pos_map, f"{kind} 槽 {slot['name']!r} 无就近坐标"
        slot["pos"] = list(pos_map[slot["name"]])


def replace_text_once(node: dict, old: str, new: str, tag: str) -> None:
    """说明卡/速查卡文案精确替换(fail-closed:待替串必须恰出现一次)。"""
    txt = node["widgets_values"][0]
    assert txt.count(old) == 1, f"{tag}:待替串出现 {txt.count(old)} 次(应恰 1):{old[:60]}…"
    node["widgets_values"][0] = txt.replace(old, new)


def leftward_check(sg: dict, tag: str) -> int:
    """坑11:全量线单向自查(tx>ox;边界端点用 IO 槽 pos)。返回违禁数(应 0)。"""
    nm = nmap(sg)
    bad = 0
    for l in sg["links"]:
        oid, oslot, tid, tslot = l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"]
        if oid == -10:
            ox = float(sg["inputs"][oslot]["pos"][0])
        else:
            ox = float(nm[oid]["pos"][0])
        if tid == -20:
            tx = float(sg["outputs"][tslot]["pos"][0])
        else:
            tx = float(nm[tid]["pos"][0])
        if not tx > ox:
            bad += 1
            print(f"  ⚠ {tag} link{l['id']} [{oid}]:{oslot}→[{tid}]:{tslot} 左向/同列 "
                  f"(ox={ox} tx={tx})")
    return bad


# ══════════════════ t2i(12→10 节点)══════════════════

T2I_DROP_LINKS = [99, 4, 100, 19, 57, 59]
T2I_DROP_EXPECT = {
    "99":  (-10, 0, 4016, 0),   # clip→[4016]
    "4":   (-10, 1, 4016, 2),   # vae→[4016]
    "100": (4015, 0, 4017, 0),  # 主编码→闸门
    "19":  (4016, 0, 4017, 1),  # RGBA编码→闸门
    "57":  (4014, 1, 4016, 3),  # 旧两口槽1 残线→[4016].prompt
    "59":  (4010, 3, 4017, 2),  # 透明值→闸门 switch
}
T2I_POS = {
    # 带① 上说明带 y=120([4100]+[4020] 横排;[4020] 贴 [4013] 上方=thinking 线近竖直,
    #   避免横穿 [4014] 遮挡走廊)
    4100: (1400, 120), 4020: (2200, 120),
    # 带② 主链 y=600([4011]→[4014]→[4015] 同轴;[4010] 下沉带④=裁量:
    #   R4 原文 [4010] 在主链左端,但其三扇出(BASE→[4011]/透明值→[4014]/W,H→[4018])
    #   在四带全右向约束下结构性必遮挡([4010]:3→[4014] 水平穿 [4011] 实测在案),
    #   依布局规范优先级 1/2(线不交叉>线不遮>横向叙事)源件下沉最底带左端,
    #   BASE/透明上行供主链,四带带序与横向铁律保持)
    4011: (900, 600), 4014: (2600, 600), 4015: (4000, 600),
    # 带③ PE 横排 y=1120([4019]→[4013];[4012] 移带右端=其扇出 [4014]/[4018] 双线
    #   右向短接,勿置左端致长线横穿 [4013] 盒,实测在案;净距 1024→1120=96≥80)
    4019: (300, 1150), 4013: (1600, 1150),
    # [4012] 独立行 y1650(带③下浮):与 [4013](503 宽)同行摆不下(gap<200 且
    # [4013] 三出线全穿 [4012] 盒,实测在案);y1650=扇出 [4014]/[4018] 双线右向
    4012: (1900, 1660),
    # 带④ 最底带([4010] 底座源件 y1900 + [4018] 画幅建议器 y1800;width/height 右出;
    #   [4010] 左置 x160=其 BASE/透明上行线避开 [4013] 盒 y 域,实测在案)
    4010: (160, 2000), 4018: (2900, 1900),
}
T2I_IN_POS = {
    "clip": (3860, 540), "vae": (3860, 560),        # 近 [4015](主链右段)
    "主体句": (820, 540),                             # 近 [4011]
    "型选择": (80, 1960), "透明": (80, 1980),          # 近 [4010](带④左端)
    "PE启用?": (1820, 1620),                          # 近 [4012](带③下浮行)
    # 手动宽/高圆点置 [4018] 左下(坑4 就近+避 [4010]→[4018] W/H 水平走廊:
    # 圆点在上方时双线必穿走廊 3 对/根,实测在案)
    "手动宽": (2750, 2140), "手动高": (2770, 2160),
}
T2I_OUT_POS = {
    "positive": (5100, 540), "negative": (5100, 560),  # 近 [4015] 右
    # 最终文本圆点=最右上带(output_rightmost ≥max_node_x−50;线贴 [4015] 顶上方走廊过)
    "最终文本": (5060, 520),
    "width": (4460, 1860), "height": (4460, 1880),      # 近 [4018](最底带,坑4)
}
# 加速子图横向三横排(⑨形态=i2i 基准:FunAcc 顶/viggle 中/直出底;seed 寄生带)
T2I_ACC_POS = {
    7013: (1400, 140), 7011: (800, 900), 7012: (1400, 900),
    7010: (1400, 1660), 7014: (80, 1300), 7015: (2100, 900),
}
T2I_ACC_IN_POS = {
    "model": (-36, 480), "positive": (-36, 660), "negative": (-36, 760),
    "latent": (-36, 1300), "速度档位": (2020, 860), "seed": (-36, 1270),
}
T2I_ACC_OUT_POS = {"LATENT": (2900, 980)}


def surgery_t2i(wf: dict) -> None:
    sg = get_sg(wf, ASG_PREFIX)
    ids = {n["id"] for n in sg["nodes"]}
    assert ids == {4010, 4011, 4012, 4013, 4014, 4015, 4016, 4017, 4018, 4019, 4020, 4100}, \
        f"t2i 装配术前节点集漂移:{sorted(ids)}"
    nm = nmap(sg)
    # ② 删双编码+闸门
    delete_nodes(sg, [4016, 4017])
    drop_links(sg, T2I_DROP_LINKS, T2I_DROP_EXPECT)
    # 单口重接:positive 出口正源=主编码直出(闸门退役,选择已前置进 [4014] 文本)
    relink(sg, 20, origin=(4015, 0), target=None,
           expect=(4017, 0, -20, 0))
    # [4014] 输出槽面单口化(槽0 最终文本→进编码文本,裁槽1;link45/102 已在槽0)
    sel = nm[4014]
    assert [o["name"] for o in sel["outputs"]] == ["最终文本", "透明文本"], \
        f"t2i [4014] 输出槽名漂移:{[o['name'] for o in sel['outputs']]}"
    set_single_output(sel, "进编码文本", 0)
    # ③ [4011] 改名
    assert nm[4011]["title"] == "[4011] 装配全文件·自研", nm[4011]["title"]
    nm[4011]["title"] = "[4011] 底料拼合·自研"
    # ④ 四带坐标+IO 就近
    set_pos(sg, T2I_POS)
    set_io_pos(sg, "inputs", T2I_IN_POS)
    set_io_pos(sg, "outputs", T2I_OUT_POS)
    # ⑦ 引用重建(linkIds 清残留)
    rebuild_refs(sg)
    # ⑧ 说明卡/速查卡文案(坑5)
    replace_text_once(
        nm[4100],
        "4010 底座/4011 装配/4012 PE启用?/4013 PE改写/4014 合成器/4015 主编码/4016 RGBA编码/4017 输出选择/4018 画幅建议器/4019 PE专属TE/4020 PE思考预览",
        "4010 底座/4011 底料拼合/4012 PE启用?/4013 PE改写/4014 合成器·单口/4015 主编码·独挑/4018 画幅建议器/4019 PE专属TE/4020 PE思考预览(10-02 单口化:双编码+输出选择塌缩,[4014] 单口「进编码文本」直喂 [4015],透明/非透明选择边界迁入合成器)",
        "t2i [4100] 段号清单")
    replace_text_once(
        nm[4100],
        "prompt 槽接 [4011] MyQi21PromptAssembly 输出口0「装配全文」",
        "prompt 槽接 [4011] MyQi21PromptAssembly(底料拼合)输出口0「装配全文」",
        "t2i [4100] [4013] 段")
    main402 = {n["id"]: n for n in wf["nodes"] if n["id"] == 402}
    note402 = main402[402]
    replace_text_once(
        note402,
        "纯 BOOLEAN 跨子图边界直布 [4014] 合成器与 [4017] 输出选择,子图内零自选转换层",
        "纯 BOOLEAN 跨子图边界直布 [4014] 合成器(10-02 单口化:透明模式参与文本计算,选择边界在合成器内,双编码+输出选择已塌缩),子图内零自选转换层",
        "t2i [402] L18 机制行")
    replace_text_once(
        note402,
        "子图内 [4011] 装配全文件(MyQi21PromptAssembly:主体句+BASE+锁层A→装配全文;Q1=B+ 唯一真源)",
        "子图内 [4011] 底料拼合(MyQi21PromptAssembly:主体句+BASE+锁层A→装配全文;Q1=B+ 唯一真源)",
        "t2i [402] L21 装配行")
    replace_text_once(
        note402,
        "→官方头尾包裹=透明文本→[4016] RGBA编码;透明关+PE 开=[4014] 口0 最终文本直喂 [4015] 主编码吃带背景完整文(禁剥离)",
        "→官方头尾包裹=进编码文本→[4015] 主编码独挑(10-02 单口化:双编码+输出选择塌缩,预览=实况);透明关=[4014] 单口「进编码文本」直喂 [4015] 主编码吃带背景完整文(禁剥离)",
        "t2i [402] L44 公式行")
    # ⑤ 加速三横排+IO 就近
    acc = get_sg(wf, ACC_PREFIX)
    set_pos(acc, T2I_ACC_POS)
    set_io_pos(acc, "inputs", T2I_ACC_IN_POS)
    set_io_pos(acc, "outputs", T2I_ACC_OUT_POS)


# ══════════════════ i2i(19→15 节点)══════════════════

I2I_DROP_LINKS = [2, 4, 7, 8, 57, 27, 58, 36, 37, 38, 34, 33, 39, 64, 15, 31]
I2I_DROP_EXPECT = {
    "2":  (-10, 0, 4016, 0),   "4":  (-10, 1, 4016, 2),
    "7":  (-10, 2, 4016, 1),   "8":  (-10, 3, 4016, 3),
    "57": (4015, 0, 4017, 0),  "27": (4016, 0, 4017, 1),
    "58": (180, 0, 4017, 2),
    "36": (-10, 0, 172, 0),    "37": (-10, 1, 172, 2),
    "38": (-10, 2, 172, 1),
    "34": (172, 0, 173, 1),    "33": (171, 0, 173, 0),
    "39": (180, 0, 173, 2),
    "64": (180, 0, 4014, 3),   # 择文①禁透明包裹:透明边界唯一驻 [153](单口件语义)
    "15": (4011, 0, 4015, 4),  # 主编码改吃 [153] 进编码文本(旧=装配全文)
    "31": (4011, 0, 171, 3),   # 单图编码同款改吃
}
I2I_POS = {
    # 带① y=100/300 常量双行([21]/[24] 上行+[23]/[25] 下行:单行横排时
    #   [21]→[24] 跳连必穿 [23]、[24]→[4013] 必穿 [25],双行错位实测根治)
    21: (200, 100), 24: (1150, 100), 23: (600, 300), 25: (1150, 420),
    # 带② 主链 y=640:[4014]择文→[4011]装配→[153]透明包裹→[4015]主编码;
    #   y640=image_1 长线贴 [4014] 顶上方过(600 时穿盒,实测在案);[171] 单图编码次行
    4014: (2900, 640), 4011: (3800, 640), 153: (4800, 640),
    4015: (6200, 640), 171: (6200, 1340),
    # 带③ PE 横排 y=1200([4012]→[4019]→[4013]→[27])
    4012: (300, 1200), 4019: (1100, 1200), 4013: (1900, 1200), 27: (2500, 1200),
    # 带④ 底座+RGBA 选择 y=1900
    4010: (3400, 1900), 180: (4100, 1900),
}
I2I_IN_POS = {
    "clip": (6100, 580), "vae": (6100, 600),            # 近 [4015]/[171]
    "image_1": (1050, 90), "image_2": (1070, 110),      # 近 [25](最左消费点)
    "指令": (1050, 40),                                  # [24] 与 [4014] 左上(双消费就近)
    "型选择": (3300, 1860), "RGBA透明": (4000, 1860),     # 近 [4010]/[180](带④)
    "PE启用?": (220, 1160),                              # 近 [4012](带③)
}
I2I_OUT_POS = {
    "positive": (7000, 580), "negative": (7000, 600), "latent": (7000, 640),
    "positive_single": (7000, 1380),                     # 近 [171]
    # prompt 圆点=[4015]/[171] 间走廊(output_rightmost ≥6150;预览=实况近 [153])
    "prompt": (6180, 1190),
}


def surgery_i2i(wf: dict) -> None:
    sg = get_sg(wf, ASG_PREFIX)
    ids = {n["id"] for n in sg["nodes"]}
    assert ids == {21, 23, 24, 25, 27, 153, 171, 172, 173, 180, 4010, 4011, 4012,
                   4013, 4014, 4015, 4016, 4017, 4019}, \
        f"i2i 装配术前节点集漂移:{sorted(ids)}"
    nm = nmap(sg)
    # ① 删两对双编码+闸门(主路 [4016][4017]+单路 [172][173])
    delete_nodes(sg, [4016, 4017, 172, 173])
    drop_links(sg, I2I_DROP_LINKS, I2I_DROP_EXPECT)
    # ② 单口重接:两出口正源=单编码直出;[153] 两线改靶;prompt 预览出口改接 [153](实况)
    relink(sg, 23, origin=(4015, 0), target=None, expect=(4017, 0, -20, 0))
    relink(sg, 40, origin=(171, 0), target=None, expect=(173, 0, -20, 3))
    relink(sg, 20, origin=(153, 0), target=(4015, 4), expect=(153, 1, 4016, 4))
    relink(sg, 35, origin=(153, 0), target=(171, 3), expect=(153, 1, 172, 3))
    relink(sg, 25, origin=(153, 0), target=None, expect=(4011, 0, -20, 4))
    # 输出槽面单口化([4014] 槽0;[153] 槽1 透明文本两线已迁,保留其 links 集合=迁线后重建)
    sel1, sel2 = nm[4014], nm[153]
    assert [o["name"] for o in sel1["outputs"]] == ["最终文本", "透明文本"]
    assert [o["name"] for o in sel2["outputs"]] == ["最终文本", "透明文本"]
    set_single_output(sel1, "进编码文本", 0)
    set_single_output(sel2, "进编码文本", 1)   # i2i [153] 旧生效口=槽1,线已改自槽0 出
    # ③ [4011] 改名
    assert nm[4011]["title"] == "[4011] 装配全文件·自研", nm[4011]["title"]
    nm[4011]["title"] = "[4011] 底料拼合·自研"
    # ④ 四带坐标+IO 就近
    set_pos(sg, I2I_POS)
    set_io_pos(sg, "inputs", I2I_IN_POS)
    set_io_pos(sg, "outputs", I2I_OUT_POS)
    # ⑦ 引用重建
    rebuild_refs(sg)
    # ⑧ 速查卡文案(坑5)
    note402 = {n["id"]: n for n in wf["nodes"] if n["id"] == 402}[402]
    replace_text_once(
        note402,
        "子图行4 单参考编码族([171] 主编码/[172] RGBA 编码/[173] RGBA 镜像开关,均仅 image_1、词源与行3 同源、RGBA 开关同宿主面板槽6)产出 positive_single",
        "子图行4 单参考编码 [171] 单编码独挑(10-02 单口化:主路 [4016][4017]+单路 [172][173] 双编码+双开关塌缩,透明/非透明选择已在 [153] 合成器内前置,词源与行3 同源)产出 positive_single",
        "i2i [402] L55 修复接线行")
    replace_text_once(
        note402,
        "开关布尔=其输出双扇出 [4017]/[173]",
        "开关布尔=其输出单扇出 [153] 透明包裹器(10-02 单口化:透明模式参与文本计算,双编码+双开关已塌缩)",
        "i2i [402] L59 RGBA 句式行")
    # ⑤ 加速子图:i2i 已是 ⑨ 三横排形态(1001 落地)——零坐标改动,仅复核
    acc = get_sg(wf, ACC_PREFIX)
    assert {n["id"] for n in acc["nodes"]} == {7010, 7011, 7012, 7013, 7014, 7015}, \
        "i2i 加速子图节点集漂移"


# ══════════════════ edit(11 节点,零删件)══════════════════

EDIT_POS = {
    # 带① y=100/300 常量双行(同 i2i:消 [21]→[24] 跳连穿 [23]/[24]→[4013] 穿 [25])
    21: (200, 100), 24: (1150, 100), 23: (600, 300), 25: (1150, 420),
    # 带② 主链 y=640:[4014]→[4015] 主编码;[4016] 单图编码沉 y1800(EDIT_TE1 功能件
    #   保留;上浮 y1340 时 image_1 长线必穿 [4014] 盒,实测在案;y1800=线贴盒底上方过)
    4014: (2900, 640), 4015: (4300, 640), 4016: (4300, 1800),
    # 带③ PE 横排 y=1200
    4012: (300, 1200), 4019: (1100, 1200), 4013: (1900, 1200), 27: (2500, 1200),
}
EDIT_IN_POS = {
    "clip": (4200, 580), "vae": (4200, 600),
    "image_1": (1050, 90), "image_2": (1070, 110),
    "指令": (1050, 40), "PE启用?": (220, 1160),
}
EDIT_OUT_POS = {
    "positive": (5400, 580), "negative": (5400, 600), "latent": (5400, 640),
    "positive_single": (5400, 1840),                      # 近 [4016](最底行)
}
# 加速三横排对齐 i2i 基准(edit 现已是 ⑨ 形态,坐标归一+IO 就近)
EDIT_ACC_POS = {
    7013: (1400, 140), 7011: (800, 900), 7012: (1400, 900),
    7010: (1400, 1660), 7014: (80, 1300), 7015: (2100, 900),
}
EDIT_ACC_IN_POS = {
    "model": (-36, 480), "positive": (-36, 1560), "positive_single": (-36, 600),
    "negative": (-36, 760), "latent": (-36, 1300), "速度档位": (2020, 860),
    "seed": (-36, 1270),
}
EDIT_ACC_OUT_POS = {"latent": (2900, 980)}


def surgery_edit(wf: dict) -> None:
    sg = get_sg(wf, ASG_PREFIX)
    ids = {n["id"] for n in sg["nodes"]}
    assert ids == {21, 23, 24, 25, 27, 4012, 4013, 4014, 4015, 4016, 4019}, \
        f"edit 装配术前节点集漂移:{sorted(ids)}"
    nm = nmap(sg)
    # ② 单口槽面同步(连线零改动:link20/21 本就自槽0 出;裁闲置槽1)
    sel = nm[4014]
    assert [o["name"] for o in sel["outputs"]] == ["最终文本", "透明文本"]
    set_single_output(sel, "进编码文本", 0)
    # ④ 带状坐标+IO 就近
    set_pos(sg, EDIT_POS)
    set_io_pos(sg, "inputs", EDIT_IN_POS)
    set_io_pos(sg, "outputs", EDIT_OUT_POS)
    rebuild_refs(sg)
    # ⑤ 加速三横排+IO 就近
    acc = get_sg(wf, ACC_PREFIX)
    set_pos(acc, EDIT_ACC_POS)
    set_io_pos(acc, "inputs", EDIT_ACC_IN_POS)
    set_io_pos(acc, "outputs", EDIT_ACC_OUT_POS)


# ══════════════════ 术后校验(⑥⑦+坑11)══════════════════

SEL_WV_SHAPE = ["", "", bool, bool, str, str, str]  # 7 值形:2 占位+pe开关+透明+头/尾/W1


def verify(wf: dict, tag: str, expect_nodes: dict[str, int], expect_links: dict[str, int],
           sel_ids: list[int]) -> None:
    asg = get_sg(wf, ASG_PREFIX)
    acc = get_sg(wf, ACC_PREFIX)
    # 对象格式(坑3)
    for l in asg["links"] + acc["links"]:
        assert isinstance(l, dict) and {"origin_id", "origin_slot", "target_id", "target_slot"} <= set(l), \
            f"{tag} link{l.get('id')} 非对象格式"
    # 节点/线计数
    assert len(asg["nodes"]) == expect_nodes["asg"], \
        f"{tag} 装配节点数 {len(asg['nodes'])} ≠ {expect_nodes['asg']}"
    assert len(asg["links"]) == expect_links["asg"], \
        f"{tag} 装配连线数 {len(asg['links'])} ≠ {expect_links['asg']}"
    # wv 7 值形(坑1)+单口槽面
    nm = nmap(asg)
    for nid in sel_ids:
        wv = nm[nid]["widgets_values"]
        assert len(wv) == 7, f"{tag} [{nid}] wv 应 7 值形,得 {len(wv)}"
        assert wv[0] == "" and wv[1] == "", f"{tag} [{nid}] wv 头部占位应空串"
        assert isinstance(wv[2], bool) and isinstance(wv[3], bool), f"{tag} [{nid}] wv[2:4] 应布尔"
        outs = nm[nid]["outputs"]
        assert len(outs) == 1 and outs[0]["name"] == "进编码文本", \
            f"{tag} [{nid}] 应单口「进编码文本」"
    # linkIds 重建对拍(每 IO 槽 linkIds 与 links 数组一致)
    for sg in (asg, acc):
        want_in = {}
        want_out = {}
        for l in sg["links"]:
            if l["origin_id"] == -10:
                want_in.setdefault(l["origin_slot"], []).append(l["id"])
            if l["target_id"] == -20:
                want_out.setdefault(l["target_slot"], []).append(l["id"])
        for i, slot in enumerate(sg["inputs"]):
            assert sorted(slot.get("linkIds", [])) == sorted(want_in.get(i, [])), \
                f"{tag} {sg['name'][:4]} 入槽{i} {slot['name']} linkIds 漂移"
        for i, slot in enumerate(sg["outputs"]):
            assert sorted(slot.get("linkIds", [])) == sorted(want_out.get(i, [])), \
                f"{tag} {sg['name'][:4]} 出槽{i} {slot['name']} linkIds 漂移"
        # 节点端引用对拍
        nm2 = nmap(sg)
        for l in sg["links"]:
            if l["target_id"] != -20:
                assert nm2[l["target_id"]]["inputs"][l["target_slot"]].get("link") == l["id"], \
                    f"{tag} link{l['id']} 靶端引用未登记"
            if l["origin_id"] != -10:
                assert l["id"] in nm2[l["origin_id"]]["outputs"][l["origin_slot"]].get("links", []), \
                    f"{tag} link{l['id']} 源端引用未登记"
    # 零左向线(坑11)
    bad = leftward_check(asg, f"{tag}·装配") + leftward_check(acc, f"{tag}·加速")
    assert bad == 0, f"{tag} 左向线 {bad} 根(铁律:恒向右)"
    # [4020] thinking 预览连线原样(Q2 裁定)
    if tag == "t2i":
        l201 = link_by_id(asg).get(201)
        assert l201 and (l201["origin_id"], l201["origin_slot"], l201["target_id"],
                         l201["target_slot"]) == (4013, 3, 4020, 0), "t2i [4020] 预览线被误动"


def run_layout_check(path: Path) -> dict:
    proc = subprocess.run([sys.executable, str(LAYOUT_CHECK), "--json", str(path)],
                          capture_output=True, text=True)
    line = next((l for l in reversed((proc.stdout or "").splitlines())
                 if l.startswith("LAYOUT_CHECK_JSON:")), None)
    assert line, f"layout_check 无契约行:{proc.stderr[:400]}"
    payload = json.loads(line[len("LAYOUT_CHECK_JSON:"):])
    return {s["name"]: s.get("counts", {"crossings": s.get("crossings")})
            for s in payload.get("scopes", [])}


# ══════════════════ 蓝图抽离(坑2)══════════════════

def refresh_blueprint(wf_path: Path, bp_path: Path) -> None:
    """工作流装配定义逐字深拷贝→蓝图 definitions.subgraphs[0](extract 先例口径:
    id 一并保留;根投影/面板零变化不动;sync 幂等比较除 id 归一已兼容)。"""
    wf = load(wf_path)
    bp = load(bp_path)
    wdef = get_sg(wf, ASG_PREFIX)
    assert bp["definitions"]["subgraphs"][0]["name"] == wdef["name"], "蓝图/工作流定义名不匹配"
    bp["definitions"]["subgraphs"][0] = copy.deepcopy(wdef)
    save(bp_path, bp)


# ══════════════════ main ═══════════════════

def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "pre").mkdir(exist_ok=True)
    (OUT_DIR / "post").mkdir(exist_ok=True)

    wfs = {k: load(p) for k, p in FILES.items()}
    for k, p in FILES.items():
        shutil.copy2(p, OUT_DIR / "pre" / p.name)
        print(f"[pre ] 快照 {k} → {OUT_DIR / 'pre' / p.name}")

    surgery_t2i(wfs["t2i"])
    surgery_i2i(wfs["i2i"])
    surgery_edit(wfs["edit"])
    print("[surg] 三件手术完成:t2i 12→10 / i2i 19→15 / edit 11(零删件,槽面+布局)")

    verify(wfs["t2i"], "t2i", {"asg": 10}, {"asg": 26}, [4014])
    verify(wfs["i2i"], "i2i", {"asg": 15}, {"asg": 34}, [4014, 153])
    verify(wfs["edit"], "edit", {"asg": 11}, {"asg": 26}, [4014])
    # i2i 择文①透明模式断线在册(透明边界唯一驻 [153];保持连线则主体句被错误包裹)
    nm = nmap(get_sg(wfs["i2i"], ASG_PREFIX))
    assert nm[4014]["inputs"][3]["name"] == "透明模式" and nm[4014]["inputs"][3]["link"] is None, \
        "i2i [4014].透明模式 应断线(None)"
    assert nm[153]["inputs"][3]["link"] is not None, "i2i [153].透明模式 应保持连线"
    print("[vrfy] 对象格式/计数/wv 7值形/单口槽面/linkIds 重建/零左向 全绿")

    for k, p in FILES.items():
        save(p, wfs[k])
        shutil.copy2(p, OUT_DIR / "post" / p.name)
        print(f"[post] 写回+快照 {k}")

    for k in FILES:
        refresh_blueprint(FILES[k], BLUEPRINTS[k])
    print("[bp  ] 三蓝图抽离完成(工作流→蓝图,坑2 顺序:先抽离再 sync 锁幂等)")

    print("\n[audit] layout_check(audit 口径)三件九 scope:")
    for k, p in FILES.items():
        counts = run_layout_check(p)
        for scope, c in sorted(counts.items()):
            print(f"  {k} {scope[:40]:<42} crossings={c.get('crossings')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
