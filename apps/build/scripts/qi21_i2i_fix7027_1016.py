#!/usr/bin/env python3
"""qi21-道劫-i2i 补挂 [7027] Fix v2.0·viggle实验臂(2026-10-16,用户令:自 t2i 转入)。

刀:i2i 加速子图 viggle 链前挂同款——-10 model → [7027] Fix×0.5(可旁路) → [7011]
turbo LoRA → 段A(替换原 -10→7011 直连 link246;新线 283/284)。位 (400,1300) 居
②组框左下空带(组框零动,200 间距合规)。[402] viggle 段补一句。装机数据级直同步。
fail-closed:术前 md5 锚+link246 形态锚;术后 coherence+左向+回读;幂等 exit 3。
"""
import json, shutil, sys, hashlib
from pathlib import Path
REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
T2I = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
INSTALL = Path("/Applications/漫影工作室.app/Contents/Resources/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")
PRE_MD5 = "e50bb8b676e60d89336e55ef8db70541"
NOTE_ADD = ("→[7019] cfg1 引导(段A 7步turbo)", "")

def fail(m, code=2):
    print(f"[f27] FAIL: {m}"); sys.exit(code)

def md5(p): return hashlib.md5(p.read_bytes()).hexdigest()

def main():
    cur = md5(WF)
    wf = json.loads(WF.read_text(encoding="utf-8"))
    sg = next(s for s in wf["definitions"]["subgraphs"] if "加速" in s["name"])
    if any(n["id"] == 7027 for n in sg["nodes"]):
        print("[f27] 已术后形态,幂等拦停"); sys.exit(3)
    if cur != PRE_MD5: fail(f"术前 md5 锚不符:{cur}")
    l246 = next((l for l in sg["links"] if l["id"] == 246), None)
    if l246 != {"id": 246, "origin_id": -10, "origin_slot": 0,
                "target_id": 7011, "target_slot": 0, "type": "MODEL"}:
        fail(f"link246 术前形态锚不符:{l246}")
    t2i = json.loads(T2I.read_text(encoding="utf-8"))
    src = next(n for n in next(s for s in t2i["definitions"]["subgraphs"] if "加速" in s["name"])["nodes"]
               if n["id"] == 7027)
    bak = WF.with_suffix(".json.bak-1016f27")
    shutil.copy2(WF, bak)
    n7 = json.loads(json.dumps(src))
    n7["pos"], n7["order"] = [400, 1300], 18
    n7["inputs"][0]["link"] = 283
    n7["outputs"][0]["links"] = [284]
    sg["nodes"].append(n7)
    sg["links"] = [l for l in sg["links"] if l["id"] != 246] + [
        {"id": 283, "origin_id": -10, "origin_slot": 0, "target_id": 7027, "target_slot": 0, "type": "MODEL"},
        {"id": 284, "origin_id": 7027, "origin_slot": 0, "target_id": 7011, "target_slot": 0, "type": "MODEL"},
    ]
    ns = {n["id"]: n for n in sg["nodes"]}
    ns[7011]["inputs"][0]["link"] = 284
    pin = sg["inputs"][0]
    pin["linkIds"] = [i for i in pin.get("linkIds", []) if i != 246] + [283]
    sg["state"]["lastNodeId"] = 7027
    sg["state"]["lastLinkId"] = 284
    wf["last_node_id"] = max(wf.get("last_node_id", 0), 7027)   # 全局 id 空间:根分配器同抬
    wf["last_link_id"] = max(wf.get("last_link_id", 0), 284)
    # [402] viggle 段补一句
    note = next(n for n in wf["nodes"] if n["id"] == 402)["widgets_values"]
    anchor = "→[7021] SplitSigmas(step=7)切段"
    add = ("链头前挂 [7027] Fix v2.0 实验臂(qwen2.1-detail-fix-2.0 ×0.5,官方荐 1.0;"
           "默认开可旁路=框选 Ctrl+B;1016 自 t2i 同款转入)→[7011] turbo LoRA")
    if "Fix v2.0 实验臂" not in note[0]:
        if anchor not in note[0]: fail("[402] viggle 段锚句缺失")
        note[0] = note[0].replace(anchor, add + anchor, 1)
    # 终验
    ids = [l["id"] for l in sg["links"]]
    if len(ids) != len(set(ids)): fail("子图线 id 重复")
    for l in sg["links"]:
        ox = sg["inputs"][l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 else ns[l["origin_id"]]["pos"][0]
        tx = sg["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 else ns[l["target_id"]]["pos"][0]
        if tx <= ox: fail(f"子图左向线 link{l['id']}")
    if ns[7027]["widgets_values"] != ["qwen2.1-detail-fix-2.0.safetensors", 0.5]:
        fail("[7027] widget 不符")
    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    r = json.loads(WF.read_text(encoding="utf-8"))
    rs = next(s for s in r["definitions"]["subgraphs"] if "加速" in s["name"])
    if not any(n["id"] == 7027 for n in rs["nodes"]): fail("回读不符")
    print(f"[f27] 完成:[7027] Fix×0.5 前挂 viggle 链(283/284 替 246);md5 {md5(WF)}")
    if INSTALL.exists():
        shutil.copy2(WF, INSTALL)
        if md5(INSTALL) != md5(WF): fail("装机对账失败")
        print("[f27] 装机同步 md5 同")
if __name__ == "__main__":
    main()
