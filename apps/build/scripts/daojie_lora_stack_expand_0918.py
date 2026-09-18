#!/usr/bin/env python3
"""道劫工作流 LoRA 全量扩架(09-18 用户令「下载的 lora 都展示在里面,合理布局」)。

在库 16 件 K2 LoRA,流内已有 10 件 → 新增 6 件([74]-[79],全部默认旁路 mode=4):
  74 NSFW·Krea2 NSFW V4 / 75 NSFW·krea2_nsfw_v2 / 76 画风·AsianMix v4 TQD
  77 画风·美学Masterpiece v51 / 78 画风·电影感CinematicShot / 79 画风·风格参照style_reference
模型链改道:…70→73→74→75→76→77→78→79→12(原 73→12 的 link 42 改喂 74,
新增 link 49-54 串到 12)。布局=LoRA 栈下方新起一行;组框② bounding 下扩。
[66] 卡:挂账行改「已到位」+ 追加全量架说明。幂等:[74] 已在即退出 0。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-K2_文生图_道劫.json"

NEW = [
    # (id, 文件名, 展示名, 类别色)
    (74, "Krea2-NSFW/Krea 2 NSFW V4.safetensors", "[74] NSFW·Krea2 NSFW V4 ×1.0(破限档;默认旁路)", "nsfw"),
    (75, "Krea2-NSFW/krea2_nsfw_v2.safetensors", "[75] NSFW·krea2_nsfw_v2 ×1.0(破限档·旧版;默认旁路)", "nsfw"),
    (76, "Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors", "[76] 画风·AsianMix v4 TQD ×1.0(古风亚洲面孔;默认旁路)", "style"),
    (77, "Krea2-画风/Krea2-美学Masterpiece_v51.safetensors", "[77] 画风·美学Masterpiece v51 ×1.0(提美;默认旁路)", "style"),
    (78, "Krea2-画风/Krea2-电影感CinematicShot_K2.safetensors", "[78] 画风·电影感CinematicShot ×1.0(电影感·摄影逻辑,水墨慎用;默认旁路)", "style"),
    (79, "Krea2-画风/Krea2-风格参照style_reference.safetensors", "[79] 画风·风格参照style_reference ×1.0(需参考图输入,完整用法见 MY-K2-文生图_风格参照;默认旁路)", "style"),
]
COLORS = {
    "nsfw": ("#8a5fb0", "#2c2438"),
    "style": ("#b06a8f", "#33202b"),
}

CARD_NEW_SECTION = (
    "\n\n## 09-18 全量 LoRA 架(在库 16 件全展示,新增 6 件默认旁路)\n"
    "- [74] NSFW·Krea2 NSFW V4 | Krea2-NSFW/Krea 2 NSFW V4.safetensors | ×1.0 | 破限档(破限件 44/45/74/75 同族一次一枚)\n"
    "- [75] NSFW·krea2_nsfw_v2 | Krea2-NSFW/krea2_nsfw_v2.safetensors | ×1.0 | 破限档·旧版\n"
    "- [76] 画风·AsianMix v4 TQD | Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors | ×1.0 | 古风亚洲面孔\n"
    "- [77] 画风·美学Masterpiece v51 | Krea2-画风/Krea2-美学Masterpiece_v51.safetensors | ×1.0 | 提美\n"
    "- [78] 画风·电影感CinematicShot | Krea2-画风/Krea2-电影感CinematicShot_K2.safetensors | ×1.0 | 电影感(摄影逻辑,道劫水墨慎用)\n"
    "- [79] 画风·风格参照style_reference | Krea2-画风/Krea2-风格参照style_reference.safetensors | ×1.0 | 需参考图输入,完整用法=MY-K2-文生图_风格参照.json\n"
    "- 纪律重申:同时激活越多越崩;画风件(68/69/70/73/76/77/78)一次一枚;破限件(44/45/74/75)按需"
)
CARD_OLD_LINE_PREFIX = "- 挂账3件"
CARD_NEW_LINE = "- 挂账3件已到位(09-18 token 下载):AsianMix v4 TQD[76]/美学Masterpiece v51[77]/电影感CinematicShot[78]"


def main() -> int:
    doc = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in doc["nodes"]}
    if 74 in nodes:
        print("已扩架([74] 在场),幂等退出")
        return 0

    lora_nodes = [n for n in doc["nodes"] if n["type"] == "LoraLoaderModelOnly"]
    # 布局:LoRA 栈下方新起一行,左对齐栈区,间距 480
    row_y = max(n["pos"][1] + n.get("size", [0, 130])[1] for n in lora_nodes) + 100
    row_x0 = min(n["pos"][0] for n in lora_nodes if n["pos"][0] > 1200)  # 栈区左缘

    # ── 模型链改道:73→12 的 link 42 改喂 74,新增 49-54 串到 12 ──
    links = {l[0]: l for l in doc["links"]}
    tail = [l for l in doc["links"] if l[1] == 73 and l[2] == 0 and l[3] == 12]
    assert len(tail) == 1, f"73→12 链应恰有一条,实际 {len(tail)}"
    tail_id = tail[0][0]
    tail[0][3], tail[0][4] = 74, 0  # 73 → 74
    n12 = nodes[12]
    m_in = next(i for i, ent in enumerate(n12["inputs"]) if ent.get("name") == "model")
    prev_link = tail_id
    next_ids = [nid for nid, *_ in NEW]
    for i, (nid, fname, title, cat) in enumerate(NEW):
        out_link = 49 + i if i < len(NEW) - 1 else None
        # 最后一件的输出链号:接到 12 的新链
        if i == len(NEW) - 1:
            out_link = 49 + i
        color, bgcolor = COLORS[cat]
        nodes[nid] = {
            "id": nid,
            "type": "LoraLoaderModelOnly",
            "pos": [row_x0 + 480 * i, row_y],
            "size": [460, 130],
            "flags": {},
            "order": nid,
            "mode": 4,
            "inputs": [{"name": "model", "type": "MODEL", "link": prev_link}],
            "outputs": [{"name": "MODEL", "type": "MODEL", "links": [out_link], "slot_index": 0}],
            "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
            "widgets_values": [fname, 1.0],
            "widgets_values_named": {"lora_name": fname, "strength_model": 1.0},
            "color": color,
            "bgcolor": bgcolor,
            "title": title,
        }
        doc["nodes"].append(nodes[nid])
        # 下一链:本件输出 → 下一件输入;最后一件 → 12
        dst = next_ids[i + 1] if i + 1 < len(NEW) else 12
        new_link_id = 49 + i
        doc["links"].append([new_link_id, nid, 0, dst, 0, "MODEL"])
        prev_link = new_link_id
    n12["inputs"][m_in]["link"] = prev_link  # 12.model ← 79 输出链
    nodes[73]["outputs"][0]["links"] = [tail_id]

    doc["last_node_id"] = max(n["id"] for n in doc["nodes"])
    doc["last_link_id"] = max(l[0] for l in doc["links"])

    # ── 组框② 下扩盖住新行 ──
    for g in doc.get("groups", []):
        if str(g.get("title", "")).startswith("②"):
            b = g["bounding"]
            b[3] = max(b[3], row_y + 100 - b[1])
            break

    # ── [66] 卡:挂账行改到位 + 追加全量架说明(widgets_values 与 named 同步) ──
    card = nodes[66]
    for key in ("widgets_values", "widgets_values_named"):
        holder = card[key] if key == "widgets_values" else card[key]
        if key == "widgets_values":
            text = holder[0]
            lines = [CARD_NEW_LINE if ln.startswith(CARD_OLD_LINE_PREFIX) else ln for ln in text.split("\n")]
            text = "\n".join(lines)
            if "[74]" not in text:
                text += CARD_NEW_SECTION
            holder[0] = text
        else:
            text = holder.get("text", "")
            lines = [CARD_NEW_LINE if ln.startswith(CARD_OLD_LINE_PREFIX) else ln for ln in text.split("\n")]
            text = "\n".join(lines)
            if "[74]" not in text:
                text += CARD_NEW_SECTION
            holder["text"] = text

    # ── 收尾自检:链序/无重复/JSON 合法 ──
    chain = {l[1]: l[3] for l in doc["links"] if l[5] == "MODEL" and l[2] == 0}
    expect_chain = {21: 19, 19: 44, 44: 45, 45: 46, 46: 47, 47: 67, 67: 68, 68: 69,
                    69: 70, 70: 73, 73: 74, 74: 75, 75: 76, 76: 77, 77: 78, 78: 79, 79: 12}
    assert chain == expect_chain, f"模型链不符: {chain}"
    ids = [l[0] for l in doc["links"]]
    assert len(ids) == len(set(ids)), "link id 重复"
    names = [w["lora_name"] for n in doc["nodes"] if n["type"] == "LoraLoaderModelOnly"
             for w in [n.get("widgets_values_named") or {}] if w.get("lora_name")]
    assert len(names) == len(set(names)) == 16, f"LoRA 件数应 16 且不重复,实际 {len(names)}"

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"扩架完成:+6 件([74]-[79])默认旁路,模型链 73→74→…→79→12,新行 y={row_y:.0f},"
          f"节点 {len(doc['nodes'])},link 最大 {doc['last_link_id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
