#!/usr/bin/env python3
"""09-21 用户令:7 件 LoRA 以悬空桩入 [90] 子图"手动配置区",接线/强度用户自配。

件:淡彩线描/墨洗SumiWash/水彩湿画/暗笔刷/电影感/美学Masterpiece/Afterlight。
形:mode=4 旁路、零连线(不进九行、不触发出图链),坐标放九行矩阵下方独立组框,
   现有节点/组框/链接一字不动(布局守卫 diff 应=仅 7 桩+1 新组)。
同步:仓库真源 → 装机 Resources 整拷;引擎用户区副本同参注入(克隆其自身节点形状,
   保前端登记字段)。台账 daojie_lora_stack.json 无需动(7 件已在册,桩不入行)。
幂等:7 桩已在(同 id 同件名)=跳过;基底哈希不符=中止。
"""
from __future__ import annotations

import copy
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2] / "backend/engines/comfyui/workflows"
MAIN = REPO / "1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
INSTALLED = Path(
    "/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui/workflows/"
    "1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
)
USERDATA = Path(
    "~/Library/Application Support/漫影工作室/comfyui/ComfyUI/user/default/workflows/"
    "1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
).expanduser()

BASELINE_SHA = "556cfffda3d776d9223accb96abfd642a2399b51997f2b4913cee488a3be9f55"
START_ID = 146
NEW_GROUP_ID = 20
ZONE_Y = 1810
ZONE_X0 = 32
NODE_W, NODE_H, GAP = 340, 100, 60
GROUP_BOX = [ZONE_X0 - 20, 1750, 7 * NODE_W + 6 * GAP + 60, 230]

# (lora文件, 默认强度, 节点标题)
PIECES: list[tuple[str, float, str]] = [
    ("Krea2-画风/Krea2-淡彩线描插画_v1.safetensors", 0.6,
     "手动·画风·淡彩线描 ×0.6(崩点1.0;触发词 watercolor ink illustration style)"),
    ("Krea2-画风/Krea2-墨洗淡彩SumiWash_v1.safetensors", 0.7,
     "手动·画风·墨洗SumiWash ×0.7(崩点1.0;佳区0.6-0.8)"),
    ("Krea2-画风/Krea2-水彩湿画wash_v1.safetensors", 0.6,
     "手动·画风·水彩湿画 ×0.6(写意向,更松)"),
    ("Krea2-画风/Krea2-暗笔刷darkbrush.safetensors", 1.0,
     "手动·画风·暗笔刷 ×1.0(触发词 monochrome ink wash style)"),
    ("Krea2-画风/Krea2-电影感CinematicShot_K2.safetensors", 1.0,
     "手动·质感·电影感 ×1.0(美宣叙事向)"),
    ("Krea2-画风/Krea2-美学Masterpiece_v51.safetensors", 1.0,
     "手动·画风·美学Masterpiece ×1.0(通用美感增强)"),
    ("Krea2-光影/Afterlight_v1.safetensors", 0.8,
     "手动·光影·Afterlight ×0.8(慎开:电影化漂移主因)"),
]
GROUP_TITLE = ("手动配置区·7件悬空桩(自行接线/调强度/解旁路;画风件同开≤1;"
               "淡彩线描/暗笔刷须补触发词;1.0崩点=淡彩线描/墨洗)")


def sha_of(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def build_stub(template: dict, idx: int, lora_file: str, strength: float, title: str,
               max_order: int) -> dict:
    n = copy.deepcopy(template)
    n["id"] = START_ID + idx
    n["pos"] = [ZONE_X0 + idx * (NODE_W + GAP), ZONE_Y]
    n["size"] = [NODE_W, NODE_H]
    n["mode"] = 4  # 旁路:接线前/后都不改变现状,用户解旁路才生效
    n["title"] = title
    n["order"] = max_order + 1 + idx
    n["widgets_values"] = [lora_file, strength]
    named = n.get("widgets_values_named")
    if isinstance(named, dict):
        named["lora_name"] = lora_file
        named["strength_model"] = strength
    for i in n.get("inputs", []):
        if i.get("name") == "model":
            i["link"] = None
    for o in n.get("outputs", []):
        if o.get("name") == "MODEL":
            o["links"] = []
    return n


def overlaps(nodes: list[dict]) -> list[tuple]:
    rects = [(x["id"], *x["pos"], x["pos"][0] + x["size"][0], x["pos"][1] + x["size"][1])
             for x in nodes if x.get("pos") and x.get("size")]
    bad = []
    for a in range(len(rects)):
        for b in range(a + 1, len(rects)):
            A, B = rects[a], rects[b]
            if A[1] < B[3] and B[1] < A[3] and A[2] < B[4] and B[2] < A[4]:
                bad.append((A[0], B[0]))
    return bad


def inject(path: Path, label: str) -> bool:
    raw = path.read_text(encoding="utf-8")
    wf = json.loads(raw)
    sg = wf["definitions"]["subgraphs"][0]
    existing_files = {json.dumps(n.get("widgets_values", [""])[0]) for n in sg["nodes"]}
    already = all(json.dumps(f) in existing_files for f, _, _ in PIECES)
    if already and any(n.get("id") == START_ID for n in sg["nodes"]):
        print(f"[skip] {label}: 7 桩已注入")
        return False
    if label == "仓库真源":
        cur = sha_of(path)
        if cur != BASELINE_SHA:
            raise SystemExit(f"[abort] {label} 哈希 {cur[:12]}… ≠ 基底,文件又被动过,先重取指纹!")
    taken_ids = {n["id"] for n in sg["nodes"]}
    if any(START_ID + i in taken_ids for i in range(len(PIECES))):
        raise SystemExit(f"[abort] {label}: id 146-152 已被占用,勿盲写")
    tpl = next(n for n in sg["nodes"] if n["type"] == "LoraLoaderModelOnly")
    max_order = max((n.get("order", 0) for n in sg["nodes"]), default=0)
    stubs = [build_stub(tpl, i, f, s, t, max_order) for i, (f, s, t) in enumerate(PIECES)]
    sg["nodes"].extend(stubs)
    gtpl = copy.deepcopy(sg["groups"][0])
    gtpl.update({"id": NEW_GROUP_ID, "title": GROUP_TITLE, "bounding": GROUP_BOX,
                 "color": "#4a3a5a"})
    sg["groups"].append(gtpl)
    st = sg.setdefault("state", {})
    st["lastNodeId"] = max(st.get("lastNodeId", 0), START_ID + len(PIECES) - 1)
    st["lastGroupId"] = max(st.get("lastGroupId", 0), NEW_GROUP_ID)
    # 布局自检:全子图零重叠 + 新组不与既有组相交 + 7 桩全在新组内
    bad = overlaps(sg["nodes"])
    if bad:
        raise SystemExit(f"[abort] {label} 注入后出现节点重叠: {bad}")
    bx, by, bw, bh = GROUP_BOX
    for s_ in stubs:
        x, y = s_["pos"]
        assert bx <= x and by <= y and x + NODE_W <= bx + bw and y + NODE_H <= by + bh
    for g in sg["groups"][:-1]:
        gx, gy, gw, gh = g["bounding"]
        assert not (bx < gx + gw and gx < bx + bw and by < gy + gh and gy < by + bh), \
            f"新组与既有组'{g.get('title')}'相交"
    out = json.dumps(wf, ensure_ascii=False, indent=2)
    if raw.endswith("\n"):
        out += "\n"
    path.write_text(out, encoding="utf-8")
    print(f"[ok] {label}: 注入 7 桩(id {START_ID}-{START_ID + 6})+ 组{NEW_GROUP_ID},零新增链接")
    return True


def main() -> int:
    changed = inject(MAIN, "仓库真源")
    if changed:
        shutil.copyfile(MAIN, INSTALLED)
        print("[ok] 装机 Resources 已整拷同步")
    else:
        print("[skip] 装机(仓库未变)")
    if USERDATA.exists():
        inject(USERDATA, "引擎用户副本")
    else:
        print("[skip] 引擎用户副本不存在")
    print(f"[info] 仓库新哈希 = {sha_of(MAIN)[:16]}…")
    return 0


if __name__ == "__main__":
    sys.exit(main())
