#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""edit viggle 臂换血 9步双段官方形 + img2img 步数统一 9(役号 1016edit9)。

用户令(1016):「edit/img2img 的 viggle 要统一 9 步」。

edit 方案=整簇换血(不逐节点手搓):以 i2i 蓝图的 9步双段子图定义(已含官方铁律形
σ表=1016sigma 产物)为源,深拷贝进 edit 工作流子图定义,做四点本地化:
  ① 去实验臂:删 [7027] Fix×0.5 + 其两线(283/284),补 -10.0→[7011] 直连线(新 id 4410);
  ② 去重:Turbo 臂噪声/采样器 4405/4406 改挂共享 [7017]/[7018],删 [7032]/[7033]+4409;
  ③ 默认档保 edit 现值:「0 · Turbo 8步」(宿主 wv/named/子图 widgets/内部 [7015] 四面);
  ④ def.id 保 edit 原 uuid(宿主 type 引用不变);宿主实例 inputs 收敛为 i2i 新式
     (仅 5 连线口按名接管原 link 号;速度档位/seed/σ表 全走 widgets 三值)。
顶层 MarkdownNote(402)加速段:viggle 6步直跑字样改 9步双段官方形。
蓝图再抽取:复用 qi21_accel_turbo_1016._extract_blueprint(同口径 canonical 可比)。

img2img:顶层 [7] KSampler steps 6→9(dn0.6 不动)+ 标题/Note 两处 6步 字样随源
(off-distribution 警示保留——LoRA 满噪蒸馏轨迹训练是事实,与步数无关)。

幂等 fail-closed;备份 .bak-1016edit9;禁删除文件;JSON 往返断言。
用法:python3 qi21_edit9_img2img9_1016.py [--check]
"""

from __future__ import annotations

import argparse
import copy
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/engines/comfyui"
WF = BASE / "workflows/1_图片/Q2-1图像"
BP = BASE / "my_nodes/subgraphs"
CAMPAIGN = "1016edit9"

NEW9 = "1.0, 0.975, 0.95, 0.925, 0.9, 0.875, 0.75, 0.5, 0.25"
EDIT_DEFAULT = "0 · Turbo 8步"

EDIT_WF = WF / "2_图生图/qi21-edit.json"
EDIT_BP = BP / "qi21-道劫-加速子图-edit.json"
I2I_BP = BP / "qi21-道劫-加速子图-i2i.json"
IMG2IMG_WF = WF / "2_图生图/qi21-道劫-img2img.json"

EDIT_NOTE_OLD = ("viggle 支路 [7012]=6(官方荐档,1002 考据;原 359 系 TE-Speed 时代值)"
                 "/Turbo 支路 8 步=[7030] 官方σ表")
EDIT_NOTE_NEW = ("viggle 支路=9 步双段([7012] 段A 采样器·7 步蒸馏 [7019] + 段B 底模收尾 2 步"
                 " [7022]-[7024];σ表 [7020] 官方铁律形 9 点,宿主面板「σ表」可改;SplitSigmas=7;"
                 "1002 考据的 6 步直跑形 1016 统一为 9 步双段)/Turbo 支路 8 步=[7030] 官方σ表")

IMG_NOTE_REPLACES = [
    ("[7] = **6 步/cfg1/euler/simple/seed fixed 0/denoise", "[7] = **9 步/cfg1/euler/simple/seed fixed 0/denoise"),
    ("(6步×dn0.6≈10 步表", "(9步×dn0.6≈低噪尾段约5.4档;1016 统一 viggle 恒 9 步;原 6步×dn0.6≈10 步表"),
]
IMG_TITLE_OLD = "viggle6步·dn0.6"
IMG_TITLE_NEW = "viggle9步·dn0.6"


def _fail(msg: str) -> None:
    print(f"[{CAMPAIGN}] FAIL {msg}")
    sys.exit(1)


def _load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def _save(p: Path, doc: dict, had_nl: bool) -> None:
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    if had_nl:
        text += "\n"
    json.loads(text)  # 往返断言
    p.write_text(text, encoding="utf-8")


def _accel_sg(doc: dict) -> tuple[dict, dict]:
    host = None
    for n in doc.get("nodes", []):
        if "加速" in str(n.get("title", "")) or "加速" in str(n.get("type", "")):
            host = n
    if host is None:
        _fail("找不到加速子图宿主实例")
    for sg in doc.get("definitions", {}).get("subgraphs", []):
        if sg.get("id") == host.get("type"):
            return host, sg
    _fail("找不到加速子图定义")


def _already(doc: dict) -> bool:
    _, sg = _accel_sg(doc)
    return any(n.get("id") == 7021 and n.get("type") == "SplitSigmas" for n in sg.get("nodes", []))


def surgery_edit(check: bool) -> None:
    raw = EDIT_WF.read_bytes()
    had_nl = raw.endswith(b"\n")
    doc = json.loads(raw)
    if _already(doc):
        print(f"[{CAMPAIGN}] edit:已施,跳过")
    else:
        src = _load(I2I_BP)["definitions"]["subgraphs"][0]
        new = copy.deepcopy(src)
        keep_id = _accel_sg(doc)[1]["id"]
        # ① 去实验臂 7027 + 283/284;补 -10.0→7011 直连
        new["nodes"] = [n for n in new["nodes"] if n.get("id") != 7027]
        new["links"] = [l for l in new["links"] if l.get("id") not in (283, 284)]
        new["links"].append({"id": 4410, "origin_id": -10, "origin_slot": 0,
                             "target_id": 7011, "target_slot": 0, "type": "MODEL"})
        # ② Turbo 臂噪声/采样器改挂共享 7017/7018;删 7032/7033+4409
        for l in new["links"]:
            if l.get("id") == 4405:
                l["origin_id"] = 7017
            if l.get("id") == 4406:
                l["origin_id"] = 7018
        new["nodes"] = [n for n in new["nodes"] if n.get("id") not in (7032, 7033)]
        new["links"] = [l for l in new["links"] if l.get("id") != 4409]
        # ③ 默认档四面=Turbo;σ表 widgets 三面
        new["widgets"] = [EDIT_DEFAULT, 0, NEW9]
        for n in new["nodes"]:
            if n.get("id") == 7015:
                n["widgets_values"] = [EDIT_DEFAULT]
        new["id"] = keep_id
        st = new.setdefault("state", {})
        st["lastNodeId"] = max(st.get("lastNodeId") or 0, 7031)
        st["lastLinkId"] = max(st.get("lastLinkId") or 0, 4410)
        # 换血宿主所在文档:def 替换(除 id 外全字段)
        host, old_sg = _accel_sg(doc)
        for k in [k for k in old_sg.keys() if k != "id"]:
            old_sg[k] = copy.deepcopy(new[k])
        # 宿主实例:inputs 收敛 5 连线口(按名接管原 link);widgets 三值
        links_by_name = {i["name"]: i.get("link") for i in (host.get("inputs") or [])}
        host["inputs"] = [
            {"name": nm, "type": tp, "link": links_by_name.get(nm)}
            for nm, tp in (("model", "MODEL"), ("positive", "CONDITIONING"),
                           ("negative", "CONDITIONING"), ("positive_single", "CONDITIONING"),
                           ("latent", "LATENT"))
        ]
        host["widgets_values"] = [EDIT_DEFAULT, 0, NEW9]
        host["widgets_values_named"] = {"速度档位": EDIT_DEFAULT, "seed": 0, "σ表": NEW9}
        doc["last_link_id"] = max(doc.get("last_link_id") or 0, 4410)
        # 顶层 Note 402 加速段随源
        text_key = "widgets_values"
        for n in doc.get("nodes", []):
            if "Note" in str(n.get("type", "")) and n.get("id") == 402:
                wv = n.get(text_key)
                if isinstance(wv, list) and wv and EDIT_NOTE_OLD in str(wv[0]):
                    wv[0] = str(wv[0]).replace(EDIT_NOTE_OLD, EDIT_NOTE_NEW)
                    named = n.get("widgets_values_named") or {}
                    if "text" in named:
                        named["text"] = str(named["text"]).replace(EDIT_NOTE_OLD, EDIT_NOTE_NEW)
        if check:
            print(f"[{CAMPAIGN}] edit:--check 只读模式,不落盘(未施态)")
            return
        bak = EDIT_WF.with_name(EDIT_WF.name + f".bak-{CAMPAIGN}")
        if not bak.exists():
            shutil.copy2(EDIT_WF, bak)
        _save(EDIT_WF, doc, had_nl)
        print(f"[{CAMPAIGN}] edit:手术落盘(备份 {bak.name})")
        doc = _load(EDIT_WF)  # 重载后再抽蓝图
    # 蓝图再抽取(复用战役同口径)
    sys.path.insert(0, str(REPO / "apps/build/scripts"))
    import qi21_accel_turbo_1016 as camp
    cfg = camp.FORMS["edit"]
    bp_doc = camp._extract_blueprint("edit", doc, cfg)
    if check:
        cur = _load(EDIT_BP)
        a = {k: v for k, v in cur["definitions"]["subgraphs"][0].items() if k != "id"}
        b = {k: v for k, v in bp_doc["definitions"]["subgraphs"][0].items() if k != "id"}
        print(f"[{CAMPAIGN}] edit 蓝图 canonical 一致: {json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)}")
        return
    bak = EDIT_BP.with_name(EDIT_BP.name + f".bak-{CAMPAIGN}")
    if not bak.exists():
        shutil.copy2(EDIT_BP, bak)
    EDIT_BP.write_text(json.dumps(bp_doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"[{CAMPAIGN}] edit:蓝图再抽取落盘")


def surgery_img2img(check: bool) -> None:
    raw = IMG2IMG_WF.read_bytes()
    had_nl = raw.endswith(b"\n")
    doc = json.loads(raw)
    hit = 0
    for n in doc.get("nodes", []):
        if n.get("type") == "KSampler" and n.get("id") == 7:
            wv = n.get("widgets_values")
            if isinstance(wv, list) and len(wv) >= 4 and wv[2] == 6:
                wv[2] = 9
                hit += 1
            ttl = str(n.get("title", ""))
            if IMG_TITLE_OLD in ttl:
                n["title"] = ttl.replace(IMG_TITLE_OLD, IMG_TITLE_NEW)
                hit += 1
    for n in doc.get("nodes", []):
        if "Note" in str(n.get("type", "")):
            wv = n.get("widgets_values")
            named = n.get("widgets_values_named") or {}
            for old, new in IMG_NOTE_REPLACES:
                if isinstance(wv, list) and wv and old in str(wv[0]):
                    wv[0] = str(wv[0]).replace(old, new)
                    hit += 1
                if "text" in named and old in str(named["text"]):
                    named["text"] = str(named["text"]).replace(old, new)
    print(f"[{CAMPAIGN}] img2img:命中 {hit} 处(steps/标题/Note)")
    if check or hit == 0:
        return
    bak = IMG2IMG_WF.with_name(IMG2IMG_WF.name + f".bak-{CAMPAIGN}")
    if not bak.exists():
        shutil.copy2(IMG2IMG_WF, bak)
    _save(IMG2IMG_WF, doc, had_nl)
    print(f"[{CAMPAIGN}] img2img:落盘(备份 {bak.name})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    check = ap.parse_args().check
    surgery_edit(check)
    surgery_img2img(check)
    print(f"[{CAMPAIGN}] {'--check 清点毕' if check else '手术完成'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
