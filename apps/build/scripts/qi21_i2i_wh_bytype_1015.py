#!/usr/bin/env python3
"""qi21-道劫-i2i 画幅按型联动手术(2026-10-15,用户令方案一+「自由=画幅随输入图」)。

语义设计(1015 定稿):
  [6] 子图内加 [4018] MyQi21WhSuggest(九型WIDTH/HEIGHT←[4010].WIDTH/HEIGHT 闲置两出;
      手动宽/高成对优先)→出线经边界新槽「画幅W/画幅H」出子图→根图 [4] 空潜
      width/height 改吃该两线(原 widget 1024 退役为摆设值)。
  [19] 画幅双路开关语义升级=false 画幅随输入图(现默认,零行为变化)/true=按型画幅
      空潜(自由型 WhSuggest 输出 992×992=1:1@1.0MP≈画幅随输入图等价——用户令「自由
      这一列就是画幅随输入图,可作为图生图使用的」)。
  顺手根治:[402]「画幅随输入图,不随型」旧口径句改为三态新口径。

fail-closed:术前断言(拓扑/锚指纹)不符即零写入;术后 coherence+回读终验;幂等拦停 exit 3。
契约锚随迁:本脚本不动测试(执行工程师在 workflow 面另行随批)。
"""
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
SG_PREFIX = "[6] 文本提示词类型优化子图"

WH_ID = 4018
SG_OUT_W, SG_OUT_H = 5, 6          # 新边界输出槽序(prompt 后追加)
ROOT_LINK_W, ROOT_LINK_H = 229, 230
LAST_NODE = 4018


def fail(m, code=2):
    print(f"[wh] FAIL: {m}")
    sys.exit(code)


def main():
    wf = json.loads(WF.read_text(encoding="utf-8"))
    sg = next(s for s in wf["definitions"]["subgraphs"] if s["name"].startswith(SG_PREFIX))
    nodes = {n["id"]: n for n in sg["nodes"]}
    root = {n["id"]: n for n in wf["nodes"]}

    # ── 术前断言 ──
    if any(n["id"] == WH_ID for n in sg["nodes"]):
        print("[wh] 已有 [4018],幂等拦停")
        sys.exit(3)
    if [o["name"] for o in sg["outputs"]] != ["positive", "negative", "latent", "positive_single", "prompt"]:
        fail(f"子图输出槽序术前不符:{[o['name'] for o in sg['outputs']]}")
    d4010 = nodes[4010]
    outs = [o["name"] for o in d4010["outputs"]]
    if outs != ["BASE", "WIDTH", "HEIGHT", "负面词", "透明值"]:
        fail(f"[4010] 输出术前不符:{outs}")
    if d4010["outputs"][1].get("links") or d4010["outputs"][2].get("links"):
        fail("[4010] WIDTH/HEIGHT 术前应零消费")
    n4 = root[4]
    if n4["widgets_values"][:2] != [1024, 1024]:
        fail(f"[4] 术前值不符:{n4['widgets_values']}")
    if n4["inputs"][0].get("link") is not None or n4["inputs"][1].get("link") is not None:
        fail("[4] width/height 术前应零接线")

    t2i = json.loads((REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json").read_text(encoding="utf-8"))
    tpl = next(n for n in t2i["nodes"] if n["id"] == 4018)
    if tpl["type"] != "MyQi21WhSuggest":
        fail("t2i [4018] 模板非 MyQi21WhSuggest")

    # ── 子图内:插 [4018](拷 t2i 形态,断链重接)──
    import copy
    wh = copy.deepcopy(tpl)
    wh["id"] = WH_ID
    # 九型宽高 ← [4010].WIDTH(1)/HEIGHT(2);手动宽/高保持 widget
    new_links = []
    lid = 231
    for slot, out_idx in ((0, 1), (1, 2)):
        lid_s = lid
        lid += 1
        new_links.append({"id": lid_s, "origin_id": 4010, "origin_slot": out_idx,
                          "target_id": WH_ID, "target_slot": slot, "type": "INT"})
    for inp in wh["inputs"]:
        if inp["name"] in ("九型WIDTH", "九型HEIGHT"):
            inp["link"] = next(l["id"] for l in new_links
                               if l["target_slot"] == ("九型WIDTH", "九型HEIGHT").index(inp["name"]))
        elif inp["name"] in ("手动宽", "手动高"):
            inp["link"] = None
    # 边界出线:[4018].width/height → -20 槽 5/6
    for k, out_idx in enumerate((0, 1)):
        lid_s = lid; lid += 1
        new_links.append({"id": lid_s, "origin_id": WH_ID, "origin_slot": out_idx,
                          "target_id": -20, "target_slot": SG_OUT_W + k, "type": "INT"})
    wh["pos"] = [1100, 1750]
    sg["nodes"].append(wh)
    sg["links"].extend(new_links)
    for n in sg["nodes"]:
        if n["id"] == 4010:
            for oi, l in ((1, new_links[0]), (2, new_links[1])):
                o = n["outputs"][oi]
                o["links"] = sorted((o.get("links") or []) + [l["id"]])
        if n["id"] == WH_ID:
            for oi, l in ((0, new_links[2]), (1, new_links[3])):
                n["outputs"][oi]["links"] = sorted((n["outputs"][oi].get("links") or []) + [l["id"]])

    # 边界输出槽 5/6 + inputNode/outputNode/出口销无关(出口自动推导)
    import uuid as _u
    for k, (nm, ty) in enumerate((("画幅W", "INT"), ("画幅H", "INT"))):
        sg["outputs"].append({
            "id": f"e8f1a2b3-1015-4c0{k}-8f05-d47c9e21c10{k}",
            "name": nm, "type": ty,
            "linkIds": [new_links[2 + k]["id"]],
            "pos": [6180 + 20 * k, 1210 + 20 * k],
        })
    sg["state"]["lastNodeId"] = max(sg["state"].get("lastNodeId", 0), WH_ID)
    sg["state"]["lastLinkId"] = max(sg["state"].get("lastLinkId", 0), lid - 1)

    # ── 根图:宿主 outputs 补 画幅W/画幅H(镜像);新线 229/230 → [4] ──
    host = root[6]
    host["outputs"].append({"name": "画幅W", "type": "INT", "links": [ROOT_LINK_W]})
    host["outputs"].append({"name": "画幅H", "type": "INT", "links": [ROOT_LINK_H]})
    wf["links"] += [
        [ROOT_LINK_W, 6, 5, 4, 0, "INT"],
        [ROOT_LINK_H, 6, 6, 4, 1, "INT"],
    ]
    n4["inputs"][0]["link"] = ROOT_LINK_W
    n4["inputs"][1]["link"] = ROOT_LINK_H
    wf["last_link_id"] = max(wf.get("last_link_id", 0), ROOT_LINK_H)

    # ── [402] 三段随刀 ──
    note = root[402]["widgets_values"]
    old_seg = "### 输出画幅双路([19] 开关,默认 false=跟随输入图)\n\n- **false(默认)**:latent 取 [6] 子图编码器 latent,跟随 image_1(预缩后)比例。\n- **true**:[4] EmptyLatentImage 自定义宽高(默认 1024×1024);自定义尺寸须贴近 image_1 比例,否则编辑漂移。"
    new_seg = ("### 输出画幅双路([19] 开关,默认 false=跟随输入图;1015 升级=按型画幅)\n\n"
               "- **false(默认)**:latent 取 [6] 子图编码器 latent,跟随 image_1(预缩后)比例——「画幅随输入图」i2i 主语义不变。\n"
               "- **true(按型画幅)**:[4] 空潜宽高改吃 [4018] 画幅建议器(九型WIDTH/HEIGHT←[4010].WIDTH/HEIGHT 闲置两出接通;手动宽/高成对优先,全 0=跟所选型默认)。[4010] 按型出画幅:人物 3:4@1.5MP=1056×1408/道具·自由 1:1@1.0MP=992×992/美宣 21:9/多视图 1:1@1.8MP=1328² 等(1015 用户令:自由型输出≈画幅随输入图等价,「自由这一列就是画幅随输入图」)。\n"
               "- 注意:按型画幅与 image_1 比例差过大时编辑漂移(旧警示继续有效);加速档(viggle)建议画幅贴近 1.0MP 稳定区。")
    if old_seg not in note[0]:
        fail("[402] 画幅双路段锚缺失")
    note[0] = note[0].replace(old_seg, new_seg)

    # ── 术后 coherence ──
    def check(doc, label):
        s = next(s for s in doc["definitions"]["subgraphs"] if s["name"].startswith(SG_PREFIX))
        ns = {n["id"]: n for n in s["nodes"]}
        for l in s["links"]:
            if l["origin_id"] == -10 and s["inputs"][l["origin_slot"]]["type"] != l["type"]:
                fail(f"[{label}] -10 类型失配 线{l['id']}")
            if l["target_id"] == -20:
                if s["outputs"][l["target_slot"]]["type"] != l["type"]:
                    fail(f"[{label}] -20 类型失配 线{l['id']}")
            elif l["target_id"] in ns:
                tgt = ns[l["target_id"]]
                if tgt["inputs"][l["target_slot"]].get("link") != l["id"]:
                    fail(f"[{label}] 线{l['id']} 目标槽未回挂")
        ids = [l["id"] for l in s["links"]]
        if len(ids) != len(set(ids)):
            fail(f"[{label}] 线 id 重复")
    check(wf, "内存")
    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    check(json.loads(WF.read_text(encoding="utf-8")), "回读")
    r = json.loads(WF.read_text(encoding="utf-8"))
    wh2 = next(n for n in next(s for s in r["definitions"]["subgraphs"] if s["name"].startswith(SG_PREFIX))["nodes"] if n["id"] == WH_ID)
    assert wh2["type"] == "MyQi21WhSuggest" and \
        [i["name"] for i in wh2["inputs"]] == ["九型WIDTH", "九型HEIGHT"], \
        f"[4018] 形态不符:{wh2['type']} {wh2['inputs']}"
    assert wh2["widgets_values"] == [0, 0], f"[4018] 手动宽高应全 0:{wh2['widgets_values']}"
    print("[wh] 完成:[4018] WhSuggest 入 [6](九型宽高←[4010] 两出;手动成对优先);边界+宿主 出 画幅W/H;[4] 空潜改吃按型画幅;[402] 三态口径随刀。")


if __name__ == "__main__":
    main()
