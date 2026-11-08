#!/usr/bin/env python3
"""⑦PrunaAI 臂入列档4·默认档 验证器(1108 默认切换终版)

不变量(1108 用户令:默认出图加速=Pruna 普通+mikkoani):
  第1段 结构:加速子图(真源+画布内嵌)含 7110-7113/链 7901(7034→7110)/
    7910(7112→7015.latent_p 槽6)/⑦组;7015 五 latent 槽接线对表;四面档位值
    (宿主 wv+named/子图 widgets[0]/选择件 wv/蓝图根节点)恒=「4 · PrunaAI 6步」;
    两份 def 关键面同步。前史:候列悬空版不变量已随入列废止。
  第2段 默认构建:builder.build_graph(画布现值)=档4 模板——7:7110-7113+7034
    在图,他臂(7045/7040/7028/7011/7012/7010)全剪,latent_p=["7:7112",0]。
  第3段 换档构建:内存改档3 → E 臂物质化(7:7045 在图,7110 剪)——旧默认仍可达。

用法: python3 pruna_arm_validate_1108.py   # 退出 0=三段全绿
"""

import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[3]
SCRIPTS = REPO / "apps/build/scripts"
sys.path.insert(0, str(SCRIPTS))
import qwen21_bridge_template_build as builder  # noqa: E402

SRC = REPO / "apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-加速子图.json"
CANVAS = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
SNAP = pathlib.Path("/tmp/objinfo.json")
SG_ID = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"
MODE4 = "4 · PrunaAI 6步"
MODE3 = "3 · 混动 40步+缓存"
NEW_NODES = (7110, 7111, 7112, 7113)
LORA_FILE = "p_q_image_2.1_6_steps_v0.2.safetensors"
SIGMAS6 = "1.0, 0.925, 0.85, 0.625, 0.375, 0.125"
NOTE_TOKEN = "⑦臂入列档4"


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise SystemExit(f"[pruna-arm] FAIL: {msg}")


def section1() -> list[str]:
    src = json.loads(SRC.read_text(encoding="utf-8"))
    cv = json.loads(CANVAS.read_text(encoding="utf-8"))
    sg_cv = next((s for s in cv["definitions"]["subgraphs"] if s["id"] == SG_ID), None)
    check(sg_cv is not None, "画布缺加速子图 def")
    for tag, sg in (("真源", src["definitions"]["subgraphs"][0]), ("画布", sg_cv)):
        nodes = {n["id"]: n for n in sg["nodes"]}
        for nid in NEW_NODES:
            check(nid in nodes, f"{tag} 缺节点 {nid}")
        links = {l["id"]: l for l in sg["links"]}
        # 新链对表:7901(7034→7110 产线风格栈)/7910(7112→7015.latent_p 槽6)
        check((links[7901]["origin_id"], links[7901]["target_id"]) == (7034, 7110),
              f"{tag} 链7901 应 7034→7110(产线风格栈),得 {links[7901]}")
        check((links[7910]["origin_id"], links[7910]["target_id"], links[7910]["target_slot"])
              == (7112, 7015, 6), f"{tag} 链7910 应 7112→7015:6(latent_p),得 {links[7910]}")
        # 7015 五槽接线
        sel = nodes[7015]
        slot_src = {i["name"]: links[i["link"]]["origin_id"] for i in sel["inputs"]
                    if i.get("name", "").startswith("latent_")}
        check(slot_src == {"latent_turbo": 7031, "latent_viggle": 7024,
                           "latent_direct": 7010, "latent_e": 7045, "latent_p": 7112},
              f"{tag} 7015 latent 槽接线漂移: {slot_src}")
        # 档位值(选择件+子图 widgets)
        check(sel["widgets_values"] == [MODE4], f"{tag} 7015 wv 应 [{MODE4!r}]")
        check(sg["widgets"][0] == MODE4, f"{tag} 子图 widgets[0] 应档4")
        # Note 含入列行;7034 扇出含 7110;7112 输出恰接 7910
        check(NOTE_TOKEN in nodes[7016]["widgets_values"][0], f"{tag} Note7016 缺入列行")
        check(7901 in nodes[7034]["outputs"][0]["links"], f"{tag} 7034 扇出缺 7901(⑦臂)")
        check(nodes[7112]["outputs"][0]["links"] == [7910], f"{tag} 7112 输出应恰 [7910]")
        check(sg["state"]["lastLinkId"] == 7910, f"{tag} lastLinkId 应 7910")
        check(any(g.get("title", "").startswith("⑦") for g in sg.get("groups", [])),
              f"{tag} 缺 ⑦组")
    # 蓝图根节点(宿主镜像)与画布宿主四面档4
    check(src["nodes"][0]["widgets_values"][0] == MODE4, "蓝图根节点 wv[0] 应档4")
    host7 = next(n for n in cv["nodes"] if n["id"] == 7)
    check(host7["widgets_values"][0] == MODE4
          and host7["widgets_values_named"]["速度档位"] == MODE4, "画布宿主[7] 档位应档4(双写)")
    check(cv.get("last_link_id", 0) >= 7910, "画布根 last_link_id 未盖 7910")
    # 两份 def 关键面同步
    a, b = src["definitions"]["subgraphs"][0], sg_cv
    for k in ("nodes", "links", "widgets"):
        check(a[k] == b[k], f"两份 def 的 {k} 不同步")
    return ["结构:⑦臂入列档4(链7901/7910+五槽+四面档位值+⑦组),两份 def 同步"]


def _build(wf: dict):
    info = json.loads(SNAP.read_text(encoding="utf-8"))
    return builder.build_graph(workflow=wf, info=info, force_upscale=True)


def section2() -> list[str]:
    wf = json.loads(CANVAS.read_text(encoding="utf-8"))
    graph, meta = _build(wf)
    check(meta["档"] == MODE4, f"默认构建 meta.档 应档4,得 {meta['档']}")
    sel = graph["7:7015"]["inputs"]
    check(sel["mode"] == MODE4 and sel["latent_p"] == ["7:7112", 0],
          f"默认构建选择器漂移: mode={sel.get('mode')} latent_p={sel.get('latent_p')}")
    lora = graph["7:7110"]
    check(lora["class_type"] == "ViggleTurboLora"
          and lora["inputs"]["lora_name"] == LORA_FILE
          and lora["inputs"]["strength"] == 1.0
          and lora["inputs"]["model"] == ["7:7034", 0], "默认构建 7110 ⑦臂件不合规")
    check(graph["7:7113"]["inputs"]["nodes"] == SIGMAS6, "默认构建六步σ表漂移")
    for gone in ("7:7045", "7:7040", "7:7028", "7:7011", "7:7012", "7:7010"):
        check(gone not in graph, f"默认构建不应含他臂件 {gone}")
    return [f"默认构建=档4:7110-7113+7034 在图({len(graph)} 节点),他臂全剪"]


def section3() -> list[str]:
    wf = json.loads(CANVAS.read_text(encoding="utf-8"))
    host7 = next(n for n in wf["nodes"] if n["id"] == 7)
    host7["widgets_values"][0] = MODE3
    host7["widgets_values_named"]["速度档位"] = MODE3
    graph, meta = _build(wf)
    check(meta["档"] == MODE3, f"换档构建 meta.档 应档3,得 {meta['档']}")
    check("7:7045" in graph and "7:7040" in graph, "换档3 应物质化 E 臂")
    check("7:7110" not in graph and "7:7112" not in graph, "换档3 不应含 ⑦臂")
    return ["换档构建=档3:E 臂可达(旧默认保留),⑦臂剪枝"]


# ── 1108 拉齐轮:i2i/edit 同构校验(结构面;构建面 i2i 走 builder,edit 无桥模板仅结构)──
REPO = REPO  # noqa
I2I = dict(bp=REPO / "apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-加速子图-i2i.json",
           canvas=REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
           uuid="b3f5a1c2-9d4e-4f60-8a7b-5c6d7e8f9a0b", host=7, build=True)
EDIT = dict(bp=REPO / "apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-加速子图-edit.json",
            canvas=REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json",
            uuid="7b1f3a92-2b5c-4d3e-8f41-6c8d9e0f1a02", host=7, build=False)

def section4(job) -> list[str]:
    tag = "i2i" if job["build"] else "edit"
    src = json.loads(job["bp"].read_text(encoding="utf-8"))
    cv = json.loads(job["canvas"].read_text(encoding="utf-8"))
    sg_cv = next(s for s in cv["definitions"]["subgraphs"] if s["id"] == job["uuid"])
    for label, sg in (("真源", src["definitions"]["subgraphs"][0]), ("画布", sg_cv)):
        nodes = {n["id"]: n for n in sg["nodes"]}
        links = {l["id"]: l for l in sg["links"]}
        for nid in NEW_NODES:
            check(nid in nodes, f"{tag} {label} 缺节点 {nid}")
        check((links[7901]["origin_id"], links[7901]["target_id"]) == (7034, 7110), f"{tag} {label} 链7901")
        check((links[7910]["origin_id"], links[7910]["target_id"]) == (7112, 7015), f"{tag} {label} 链7910")
        sel = nodes[7015]
        check(any(i.get("name") == "latent_p" and i.get("link") == 7910 for i in sel["inputs"]), f"{tag} {label} latent_p 槽")
        check(sel["widgets_values"] == [MODE4] and sg["widgets"][0] == MODE4, f"{tag} {label} 档位四面")
        check(7903 in (links and {l["id"]: l for l in sg["links"]}) and links[7903]["origin_id"] == -10, f"{tag} {label} 条件=边界 positive_single")
    host = next(n for n in cv["nodes"] if n["id"] == job["host"])
    check(host["widgets_values"][0] == MODE4, f"{tag} 宿主档位")
    if job["build"]:
        wf = json.loads(job["canvas"].read_text(encoding="utf-8"))
        graph, meta = _build(wf)
        check(meta["档"] == MODE4 and graph["7:7015"]["inputs"]["mode"] == MODE4, f"{tag} 默认构建档4")
        check(graph["7:7015"]["inputs"]["latent_p"] == ["7:7112", 0] and "7:7045" not in graph, f"{tag} 默认构建⑦臂物质化")
    return [f"{tag}:⑦臂入列+档位四面{'+默认构建' if job['build'] else '(结构面)'} 全对表"]

if __name__ == "__main__":
    for i, fn in ((1, section1), (2, section2), (3, section3)):
        print(f"[pruna-arm] 第{i}段 PASS: {fn()[0]}")
    for job in (I2I, EDIT):
        print(f"[pruna-arm] 拉齐 PASS: {section4(job)[0]}")
    print("[pruna-arm] 三段+拉齐全绿")
