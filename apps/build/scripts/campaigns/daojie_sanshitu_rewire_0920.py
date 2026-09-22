#!/usr/bin/env python3
"""道劫 t2i 分辨率接线重接 09-20(三视图 A 案根修,幂等)。

背景:三视图 21:9·4.2MP 大画幅「多个重复」二连否,A 案(1536×512 先例直填)
终审转正。[61] ResolutionSelector 的 COMBO 枚举无 3:1 档,故 [80] MyDaojieBase
新增 WIDTH/HEIGHT 直出(型带 resolution_override 直出该值,否则公式自算与
[61] 逐字节一致)。本脚本把 [53] EmptySD3LatentImage 的 width/height 输入
从 [61] 改接到 [80] 新增两出;[61] 旁路保留作手动档。

对象:K2-文生图-道劫.json 与 K2-文生图-道劫-专家模式.json(按类型定位节点,
不写死 id)。幂等:[53] 已吃 [80] 输出则跳过。
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[3] / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
TARGETS = [HERE / "K2-文生图-道劫.json", HERE / "K2-文生图-道劫-专家模式.json"]


def rewire(path: Path) -> str:
    doc = json.loads(path.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in doc["nodes"]}
    by_type = {}
    for n in doc["nodes"]:
        by_type.setdefault(n["type"], []).append(n)
    base = by_type.get("MyDaojieBase", [None])[0]
    sel = by_type.get("ResolutionSelector", [None])[0]
    latents = by_type.get("EmptySD3LatentImage", [])
    latent = next((n for n in latents if n.get("mode", 0) == 0), latents[0] if latents else None)
    assert base and sel and latent, f"{path.name} 缺节点: base={bool(base)} sel={bool(sel)} latent={bool(latent)}"

    links = {l[0]: l for l in doc["links"]}

    def input_link_from(node, name):
        for i in node.get("inputs", []):
            if i["name"] == name:
                lid = i.get("link")
                return i, (links.get(lid) if lid is not None else None)
        return None, None

    _, w_src = input_link_from(latent, "width")
    if w_src and w_src[1] == base["id"]:
        return f"{path.name}: 已接线(幂等跳过)"

    # 1) [80] 追加 width/height 两出
    out_names = [o["name"] for o in base.get("outputs", [])]
    if "width" not in out_names:
        base["outputs"].append({"name": "width", "type": "INT", "links": [], "slot_index": len(out_names)})
    if "height" not in out_names:
        base["outputs"].append({"name": "height", "type": "INT", "links": [], "slot_index": len(out_names) + 1})
    w_out = next(o for o in base["outputs"] if o["name"] == "width")
    h_out = next(o for o in base["outputs"] if o["name"] == "height")

    # 2) 断开 61→53 旧线,接 80→53 新线
    next_id = max(links) + 1 if links else 1
    for in_name, out_obj in (("width", w_out), ("height", h_out)):
        inp, old = input_link_from(latent, in_name)
        assert inp is not None, f"{path.name} latent 缺 {in_name} 输入"
        if old is not None:
            doc["links"] = [l for l in doc["links"] if l[0] != old[0]]
            for so in sel.get("outputs", []):
                if old[0] in (so.get("links") or []):
                    so["links"].remove(old[0])
        inp["link"] = next_id
        slot_in = next(idx for idx, i in enumerate(latent.get("inputs", [])) if i["name"] == in_name)
        doc["links"].append([next_id, base["id"], out_obj["slot_index"], latent["id"], slot_in, "INT"])
        out_obj.setdefault("links", []).append(next_id)
        next_id += 1

    # 3) [61] 旁路+题注(保留手动档用途)
    sel["mode"] = 4
    title = sel.get("title") or "分辨率"
    if "已退位" not in title:
        sel["title"] = title + "(已退位——[80] 直出 WH;断线可作手动档)"

    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return f"{path.name}: [53] {w_src[1] if w_src else '?'}→[80],[61] 旁路"


for t in TARGETS:
    print(rewire(t))
