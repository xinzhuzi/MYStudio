#!/usr/bin/env python3
"""1109 σ表下沉+④档2K 手术(幂等)——用户令:

A. σ表下沉(两件:t2i-通用 + qi21-道劫-t2i):
   - 宿主[7]面板摘「σ表」widget(widgets_values/named 双轨)
   - 子图边界槽「σ表」删除;origin_id=-10 且 origin_slot>6 的连线槽位随动 -1(型名 idx7→6)
   - [7020] 动态σ表(viggle 支路):nodes 输入摘链(link4309),σ九点官方表固化为
     widget(仿 [7113] 旧格式形)——σ表只活在 viggle 支路内部,固定死
   - [7016] Note 文案随动
B. ④PrunaAI 档默认 2K(仅 t2i-通用):
   - 新节点 [7121] LatentUpscaleBy(nearest-exact ×2)插在边界 latent→[7112] 之间
     → [4] 默认 1024² 经 ×2 = 2048²(2K),长宽比跟随 [4]
   - [7016] Note 补记

幂等:σ表已摘/7121 已在 → 跳过对应步。幸存断言:无悬空链接、面板双轨一致、
7121 接线闭环。退出码 0=手术成功(或已是终态)。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WF = ROOT / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图"
TARGETS = [WF / "t2i-通用.json", WF / "qi21-道劫-t2i.json"]
SIGMA_9PT = "1.0, 0.975, 0.95, 0.925, 0.9, 0.875, 0.75, 0.5, 0.25"
NEW_NODE_ID, NEW_LINK_ID = 7121, 7911


def sg_of(doc: dict) -> dict:
    for sg in doc["definitions"]["subgraphs"]:
        if "加速" in sg.get("name", ""):
            return sg
    raise SystemExit("找不到加速子图")


def surgery(path: Path, with_2k: bool) -> list[str]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    sg = sg_of(doc)
    log: list[str] = [f"== {path.name} (2K={with_2k}) =="]
    names = [s["name"] for s in sg["inputs"]]

    # ── A1. 边界槽 σ表 摘除 + 槽位重排 ─────────────────────────────
    if "σ表" in names:
        idx = names.index("σ表")
        sg["inputs"].pop(idx)
        for l in sg["links"]:
            if l["origin_id"] == -10 and l["origin_slot"] > idx:
                l["origin_slot"] -= 1
        log.append(f"A1 边界槽 σ表(idx={idx})已摘,后续槽位 -1")
    else:
        log.append("A1 边界槽已无 σ表(幂等跳过)")

    # ── A2. [7020] nodes 摘链 + σ表固化 widget ─────────────────────
    n7020 = next(n for n in sg["nodes"] if n["id"] == 7020)
    nodes_in = next(i for i in n7020["inputs"] if i["name"] == "nodes")
    if nodes_in.get("link") is not None:
        dead = nodes_in["link"]
        sg["links"] = [l for l in sg["links"] if l["id"] != dead]
        nodes_in["link"] = None
        log.append(f"A2 [7020] nodes 摘链(link {dead} 删)")
    if n7020.get("widgets_values") != [SIGMA_9PT]:
        n7020["widgets_values"] = [SIGMA_9PT]
        if "widgets_values_named" in n7020:
            n7020["widgets_values_named"] = {"sigma_str": SIGMA_9PT}
        log.append("A2 [7020] σ九点官方表固化 widget")

    # ── A3. 宿主[7]面板摘 σ表(双轨)+ 子图 widgets 双写随动 ─────────
    host = next(n for n in doc["nodes"] if n["id"] == 7)
    if len(host["widgets_values"]) == 3:
        host["widgets_values"] = host["widgets_values"][:2]
        host["widgets_values_named"].pop("σ表", None)
        sg["widgets"] = sg["widgets"][:2]
        log.append("A3 宿主面板/子图 widgets 双轨摘 σ表")

    # ── A4. [7016] Note 文案随动 ───────────────────────────────────
    note = next(n for n in sg["nodes"] if n["id"] == 7016)
    txt = note["widgets_values"][0]
    txt2 = txt.replace(
        "宿主面板=速度档位/seed/σ表",
        "宿主面板=速度档位/seed;σ表已固化 viggle 支路 [7020] 九点官方表(1109 用户令下沉,面板不再外露)",
    )
    if with_2k and "④档2K" not in txt2:
        txt2 += "\n④PrunaAI 档输出=分辨率×2:[7121] LatentUpscaleBy(nearest-exact×2)插边界 latent→[7112];[4] 默认 1024²→出图 2048²(2K),长宽比跟随 [4](1109 用户令)。"
    if txt2 != txt:
        note["widgets_values"] = [txt2]
        log.append("A4 [7016] Note 随动")

    # ── B. ④档 2K:[7121] 插链(仅 t2i-通用) ─────────────────────────
    if with_2k:
        if any(n["id"] == NEW_NODE_ID for n in sg["nodes"]):
            log.append("B [7121] 已在(幂等跳过)")
        else:
            lnk = next(l for l in sg["links"] if l["target_id"] == 7112 and l["target_slot"] == 4)
            boundary_link_id = lnk["id"]
            lnk["target_id"], lnk["target_slot"] = NEW_NODE_ID, 0
            sg["links"].append({
                "id": NEW_LINK_ID, "origin_id": NEW_NODE_ID, "origin_slot": 0,
                "target_id": 7112, "target_slot": 4, "type": "LATENT",
            })
            sg["nodes"].append({
                "id": NEW_NODE_ID, "type": "LatentUpscaleBy",
                "pos": [2470, 4080], "size": [230.0, 130.0], "flags": {},
                "order": 0, "mode": 0, "inputs": [
                    {"name": "samples", "type": "LATENT", "link": boundary_link_id}],
                "outputs": [{"name": "LATENT", "type": "LATENT", "links": [NEW_LINK_ID]}],
                "title": "[7121] ④档2K·潜空间×2", "properties": {"Node name for S&R": "LatentUpscaleBy"},
                "widgets_values": ["nearest-exact", 2, "disabled"],
            })
            n7112 = next(n for n in sg["nodes"] if n["id"] == 7112)
            n7112["inputs"][4]["link"] = NEW_LINK_ID
            log.append(f"B [7121] 插链:边界latent(link{boundary_link_id})→7121→7911→[7112].latent_image")

    # ── 幸存断言 ──────────────────────────────────────────────────
    link_ids = {l["id"] for l in sg["links"]}
    bnames = [s["name"] for s in sg["inputs"]]
    assert "σ表" not in bnames, "边界仍残留 σ表"
    assert len(host["widgets_values"]) == 2, "宿主面板仍三控件"
    assert host["widgets_values"] == sg["widgets"], "面板双轨漂移"
    assert n7020["widgets_values"] == [SIGMA_9PT], "[7020] σ表未固化"
    assert next(i for i in n7020["inputs"] if i["name"] == "nodes")["link"] is None, "[7020] nodes 仍挂链"
    for n in sg["nodes"]:
        for i in n.get("inputs", []):
            assert i.get("link") is None or i["link"] in link_ids, f"[{n['id']}] 输入悬空 link {i.get('link')}"
    if with_2k:
        n7121 = next(n for n in sg["nodes"] if n["id"] == NEW_NODE_ID)
        assert n7121["inputs"][0]["link"] in link_ids and NEW_LINK_ID in link_ids, "7121 接线未闭环"
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return log


def main() -> int:
    for p, w2k in zip(TARGETS, [True, False]):
        for line in surgery(p, w2k):
            print(line)
    print("手术完成,全部幸存断言过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
