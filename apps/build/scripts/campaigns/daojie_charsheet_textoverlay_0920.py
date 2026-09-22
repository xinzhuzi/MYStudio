#!/usr/bin/env python3
"""设定表无文字模板+汉字标注节点接线(09-20 案一;两工作流同改)。

背景:K2 底模画面内汉字不可行(09-20 CN 对照实弹定谳),官方模板 VISIBLE TEXT
段锁 English only。用户裁定案一=程序叠加:模板改「画面零文字」,
新增 [307] MyCharsheetLabels 自研节点(左栏程序叠真汉字:姓名/字段/朱印)
插 [54] VAEDecode→[29] SaveImage 之间。

本脚本幂等:
  · 模板四段替换([184] VLM 指令×2 段 + [119] 回退内嵌×2 段;已含新句=跳过);
  · [307] 接线(l37 改道 54→307,新链 307→29;已存在 [307]=跳过)。
用法:python3 apps/build/scripts/daojie_charsheet_textoverlay_0920.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WFS = [REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/2_图生图"
       / "K2-角色设定-道劫.json",
       REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/2_图生图"
       / "K2-角色设定-道劫-专家模式.json"]

OLD_VISIBLE = ("All labels must be English only. Keep labels short and legible. "
               "Do not invent lore paragraphs.")
NEW_VISIBLE = ("Do not render any text, letters, numbers, labels, captions, or "
               "written characters anywhere on the sheet. Keep every zone free of "
               "typography — all labels are applied in post-production.")
# [184] 为双栏排版指令文档(few-shot 示例×3),句中会被硬折行吞空白/截尾
# ("Keep labelsvent lore paragraphs." 形态),精确串只能命中单栏区——
# 故全量替换走宽容正则:句首锚定+行内吃残尾;\s* 容折行。
RE_OLD_VISIBLE = re.compile(
    r'All labels must be English only\.[^\n]{0,120}')
RE_OLD_COLUMN = re.compile(
    r'the exact name "[^"]{0,120}", ENTITY TYPE, CORE MOOD, and VISUAL SIGNATURE '
    r'in compact readable\s*English\s*\.[^\n]{0,40}')
# 双栏折行吞字符的残缺形态("the exact name "<Na, and VISUAL ... readableEnglish."——
# 句中字符被删):锚定首尾、中间全容忍(句内无换行,{} 上下限兜住不跨段)
RE_OLD_COLUMN_BROKEN = re.compile(
    r'the exact name .{0,60}and VISUAL SIGNATURE in compact.{0,30}English\s*\.')
NEW_COLUMN = ("completely empty — clean background paper with generous white "
              "space; no text, no labels, no typography "
              "(metadata is applied in post-production).")

FIELDS_DEFAULT = ("筑基后期 · 剑修\n青云门 · 内门弟子\n佩剑『听澜』\n"
                  "青玉道袍 · 素银簪\n眉目沉静 藏三分锋")


def node_text(n: dict) -> str | None:
    named = n.get("widgets_values_named") or {}
    if isinstance(named.get("value"), str):
        return named["value"]
    wv = n.get("widgets_values")
    if wv and isinstance(wv[0], str):
        return wv[0]
    return None


def set_node_text(n: dict, new: str) -> None:
    named = n.get("widgets_values_named")
    if isinstance(named, dict) and isinstance(named.get("value"), str):
        named["value"] = new
    else:
        n["widgets_values"][0] = new


def retarget(wf: dict, new_nid: int = 307) -> bool:
    """[54]→[29] 改道 [54]→[307]→[29];已存在 [307]=False(幂等)。"""
    if any(n["id"] == new_nid for n in wf["nodes"]):
        return False
    links = wf["links"]
    l37 = next(l for l in links if l[:2] == [37, 54] and l[3] == 29)
    new_link_id = max(l[0] for l in links) + 1
    l37[3], l37[4] = new_nid, 0                       # 54→307
    links.append([new_link_id, new_nid, 0, 29, 0, "IMAGE"])  # 307→29
    n29 = next(n for n in wf["nodes"] if n["id"] == 29)
    n29["inputs"][0]["link"] = new_link_id
    wf["nodes"].append({
        "id": new_nid, "type": "MyCharsheetLabels",
        "pos": [4770, 760], "size": [330, 430], "flags": {}, "mode": 0,
        "inputs": [{"name": "image", "type": "IMAGE", "link": 37}],
        "outputs": [{"name": "image", "type": "IMAGE", "links": [new_link_id],
                     "slot_index": 0}],
        "title": "设定表·汉字标注",
        "properties": {"Node name for S&R": "MyCharsheetLabels"},
        "widgets_values": ["青珣", FIELDS_DEFAULT, "苹方(简体)", 92, 40, "墨黑", "道劫"],
        "order": n29.get("order", 28)})
    return True


def main() -> int:
    for path in WFS:
        wf = json.loads(path.read_text(encoding="utf-8"))
        print(f"== {path.name}")
        for nid in (184, 119):
            n = next((x for x in wf["nodes"] if x["id"] == nid), None)
            if n is None:
                continue
            txt = node_text(n)
            if txt is None:
                print(f"  [{nid}] 无长文本,跳过")
                continue
            hits = 0
            txt, n_vis = RE_OLD_VISIBLE.subn(NEW_VISIBLE, txt)
            hits += n_vis
            txt, n_col = RE_OLD_COLUMN.subn(NEW_COLUMN, txt)
            hits += n_col
            txt, n_broken = RE_OLD_COLUMN_BROKEN.subn(NEW_COLUMN, txt)
            hits += n_broken
            if hits == 0 and NEW_VISIBLE in txt:
                print(f"  [{nid}] 已是无文字版,跳过")
            elif hits == 0:
                print(f"  [{nid}] ⚠ 未命中任何 English 段(模板漂移?)")
                return 1
            else:
                set_node_text(n, txt)
                print(f"  [{nid}] 替换 {hits} 段")
        wired = retarget(wf)
        print(f"  [307] {'已接线(54→307→29)' if wired else '已存在,跳过'}")
        path.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
