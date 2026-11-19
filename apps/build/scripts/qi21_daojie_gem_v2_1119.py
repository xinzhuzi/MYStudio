#!/usr/bin/env python3
"""道劫⑤b Gem 超分 v2 — 照抄皮肤件「磨皮后续」组结构,只换配方值(1119 用户令)。

结构源=t2i-皮肤-超分.json 8100-8114 13节点(去 face LoRA=12节点):
  零独立加载器(CLIP/VAE/UNET 全吃主链 [1][2][3]);
  SamplerCustomAdvanced 新式采样(RandomNoise+BasicGuider+KSamplerSelect+ManualSigmas);
  零守卫三件(GemTiledUpscale 自己管分辨率)。

配方改动(vs 皮肤件):
  LoRA: turbo r178@1.0 + restore@1.0(去 face@0.5)
  提示词: C 句(通用还原)
  存图: 道劫语义前缀,504 复用
  megapixels: 8.25(用户 4K 帽令)

用法: python3 qi21_daojie_gem_v2_1119.py          # 手术+自验
       python3 qi21_daojie_gem_v2_1119.py --verify  # 只验
"""
from __future__ import annotations
import argparse, copy, json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
T2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json"
I2I = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json"
CANVASES = {"t2i": T2I, "i2i": I2I}

PROMPT_C = ("Restore the illustration: remove blur, noise and compression "
            "artifacts and recover sharp, natural detail, ignoring stray "
            "marks, specks and smudges, keeping the same composition, people "
            "and colors.")
SIGMAS_8STEP = "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"
SAVE_PREFIX = {"t2i": "道劫-文生图-超分-", "i2i": "道劫-图生图-超分-"}
GROUP_TITLE = "道劫·⑤b·Gem分块超分"

# ── 12 新节点(id → 类型+标题+widgets)── 照抄皮肤件,标 #CHANGED 的为配方改动
NODES = {
    8100: ("GemTiledUpscale", "[8100] Gem·分块超分",
           [8.25, 4, 256, 32, 64, False]),  # CHANGED: megapixels 10→8.25(4K帽); tile 4 照抄皮肤
    8101: ("LoraLoaderModelOnly", "[8101] Gem·turbo r178 ×1",
           ["qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors", 1.0]),
    8102: ("LoraLoaderModelOnly", "[8102] Gem·restore ×1.0",
           ["qwen-image-2.1-restore.safetensors", 1.0]),  # CHANGED: 0.5→1.0(清晰生成图)
    8104: ("TextEncodeQwenImage21", "[8104] Gem·提示词编码",
           [PROMPT_C, "", 0]),  # CHANGED: C 句
    8106: ("VAEDecode", "[8106] Gem·解码", None),
    8107: ("GemTiledUpscaleStitch", "[8107] Gem·拼缝",
           [1.0, "translation", 64, 0]),
    8110: ("RandomNoise", "[8110] Gem·噪声", [0, "fixed"]),
    8111: ("BasicGuider", "[8111] Gem·引导器", None),
    8112: ("KSamplerSelect", "[8112] Gem·采样器", ["euler"]),
    8113: ("ManualSigmas", "[8113] Gem·σ表", [SIGMAS_8STEP]),
    8114: ("SamplerCustomAdvanced", "[8114] Gem·采样", None),
}
NEW_IDS = sorted(NODES)

# ── 16 根新线(id 起 8250;入线源=[id,slot],出线目标=[id,slot])──
LINKS = [
    (8250, 1,   0, 8101, 0, "MODEL"),        # [1] UNET → turbo LoRA
    (8251, 8101, 0, 8102, 0, "MODEL"),       # turbo → restore
    (8252, 2,   0, 8104, 0, "CLIP"),         # [2] CLIP → 提示词编码
    (8253, 3,   0, 8104, 4, "VAE"),          # [3] VAE → 提示词编码
    (8254, 7500, 0, 8100, 0, "IMAGE"),       # 洗底输出 → 分块
    (8255, 8100, 0, 8104, 1, "IMAGE"),       # 分块 tiles → 提示词编码 image_1(通过 slot 映射)
    (8256, 8100, 1, 8107, 1, "ITSGEM_TILE_STITCHER"),  # 分块 stitcher → 拼缝
    (8257, 8102, 0, 8111, 0, "MODEL"),       # restore → BasicGuider
    (8258, 8104, 0, 8111, 1, "CONDITIONING"),# 提示词 → BasicGuider
    (8259, 8110, 0, 8114, 0, "NOISE"),       # 噪声 → 采样
    (8260, 8111, 0, 8114, 1, "GUIDER"),      # 引导器 → 采样
    (8261, 8112, 0, 8114, 2, "SAMPLER"),     # 采样器选择 → 采样
    (8262, 8113, 0, 8114, 3, "SIGMAS"),      # σ表 → 采样
    (8263, 8104, 2, 8114, 4, "LATENT"),      # 提示词 latent → 采样
    (8264, 8114, 0, 8106, 0, "LATENT"),      # 采样 → 解码
    (8265, 3,   0, 8106, 1, "VAE"),          # [3] VAE → 解码
    (8266, 8106, 0, 8107, 0, "IMAGE"),       # 解码 → 拼缝
    (8267, 8107, 0, 504,  0, "IMAGE"),       # 拼缝 → [504] 存图
]
LINK_IDS = [l[0] for l in LINKS]

# 旧节点清除段(上一代 ⑤b 全部 + 旧线段)
OLD_NODE_RANGE = set(range(8100, 8121))  # 8100-8120 全段(涵盖 v1+v2-bug+v2)
OLD_LINK_RANGE = set(range(8217, 8237))  # 8217-8236
OLD_GROUP_ID = 7

def need(cond, msg):
    if not cond:
        print(f"[gem-v2] FAIL: {msg}")
        sys.exit(1)

def load(p):
    return json.loads(p.read_text(encoding="utf-8"))

def save(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def surgery(name: str):
    path = CANVASES[name]
    wf = load(path)
    print(f"[gem-v2] 手术 {name} ({path.name})")

    # ── 1) 清除旧⑤b ──
    old_nodes = [n for n in wf["nodes"] if n["id"] in OLD_NODE_RANGE]  # 全段清
    if old_nodes:
        wf["nodes"] = [n for n in wf["nodes"] if n["id"] not in OLD_NODE_RANGE]
        print(f"  清除旧⑤b节点 {len(old_nodes)} 个")
    wf["links"] = [l for l in wf["links"] if l[0] not in OLD_LINK_RANGE]
    # 清除旧组框
    wf["groups"] = [g for g in wf.get("groups", []) if g.get("id") != OLD_GROUP_ID]
    print(f"  清除旧线+组框")

    nodes = {n["id"]: n for n in wf["nodes"]}

    # ── 2) 添加新节点(结构照抄皮肤件,只改配方) ──
    import copy as _c
    SKIN_PATH = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/t2i-皮肤-超分.json"
    _skin = json.loads(SKIN_PATH.read_text(encoding="utf-8"))
    _skin_nodes = {n["id"]: n for n in _skin["nodes"]}
    base_order = max(n.get("order", 0) for n in wf["nodes"] if isinstance(n.get("order"), int)) + 1
    y_base = 800 if name == "t2i" else 600
    # 1119 布局修正:按皮肤件真尺寸排三行四列(列距≥246/行距≥80,零重叠;
    # 7500→8100 与 8107→504 两根外线恒右向,岛内线由契约豁免集覆盖)
    POS = {
        8100: (9200, y_base),        8101: (9750, y_base),
        8102: (10350, y_base),       8104: (11000, y_base),
        8106: (9200, y_base + 460),  8107: (9750, y_base + 460),
        8110: (10350, y_base + 460), 8111: (11000, y_base + 460),
        8112: (9200, y_base + 800),  8113: (9750, y_base + 800),
        8114: (10350, y_base + 800),
    }
    for i, nid in enumerate(NEW_IDS):
        ntype, title, widgets = NODES[nid]
        # 从皮肤件按 ID 直拷(禁按 type 搜——主链有同型节点会抓错)
        SKIN_MAP = {8100:8100, 8101:8101, 8102:8102, 8104:8104,
                     8106:8106, 8107:8107, 8110:8110, 8111:8111,
                     8112:8112, 8113:8113, 8114:8114}
        tmpl = _c.deepcopy(_skin_nodes[SKIN_MAP[nid]])
        node = tmpl
        node["id"] = nid
        node["title"] = title
        node["pos"] = list(POS[nid])
        node["order"] = base_order + i
        node["mode"] = 0
        if widgets is not None:
            node["widgets_values"] = _c.deepcopy(widgets)
        else:
            node.pop("widgets_values", None)
        node.pop("widgets_values_named", None)
        # 清除所有 link 引用,后面由 LINKS 重建
        for inp in node.get("inputs", []):
            inp["link"] = None
        for out in node.get("outputs", []):
            out["links"] = []
        wf["nodes"].append(node)
    # 按 LINKS 填 link 引用(用槽名匹配,不用槽序)
    nodes = {n["id"]: n for n in wf["nodes"]}
    for l in LINKS:
        lid, src_id, src_slot, tgt_id, tgt_slot, ltype = l
        if src_id in nodes:
            outs = nodes[src_id].get("outputs", [])
            if src_slot < len(outs):
                if lid not in (outs[src_slot].get("links") or []):
                    outs[src_slot]["links"] = (outs[src_slot].get("links") or []) + [lid]
        if tgt_id in nodes:
            ins = nodes[tgt_id].get("inputs", [])
            if tgt_slot < len(ins):
                ins[tgt_slot]["link"] = lid
    print(f"  添加新节点 {len(NEW_IDS)} 个(结构从皮肤件抄)")

    # ── 3) 添加新线 ──
    existing_link_ids = {l[0] for l in wf["links"]}
    for l in LINKS:
        if l[0] not in existing_link_ids:
            wf["links"].append(list(l))
    print(f"  添加新线 {len(LINKS)} 根")

    # ── 4) 改 504 接线+标题+前缀 ──
    nodes = {n["id"]: n for n in wf["nodes"]}
    if 504 in nodes:
        n504 = nodes[504]
        n504["title"] = "[504] 放大保存"
        if n504.get("widgets_values"):
            n504["widgets_values"][0] = SAVE_PREFIX[name]
        # 改 images 输入为 8267(新线)
        for inp in n504.get("inputs", []):
            if inp.get("name") == "images":
                inp["link"] = 8267
        # 添加 8267 到 8107 出扇出
        n8107 = nodes.get(8107)
        if n8107:
            for out in n8107.get("outputs", []):
                if 8267 not in (out.get("links") or []):
                    out["links"] = (out.get("links") or []) + [8267]
        print(f"  504 接线→8107, 标题/前缀改")

    # ── 5) 组框(按节点真尺寸自算 bbox,禁 320/150 估——8104 真宽 428 会漏罩)──
    _new = [n for n in wf["nodes"] if n["id"] in NEW_IDS]
    xs = [n["pos"][0] for n in _new]
    ys = [n["pos"][1] for n in _new]
    xe = [n["pos"][0] + n["size"][0] for n in _new]
    ye = [n["pos"][1] + n["size"][1] for n in _new]
    wf["groups"].append({
        "id": 7, "title": GROUP_TITLE,
        "bounding": [min(xs) - 40, min(ys) - 60, max(xe) - min(xs) + 80, max(ye) - min(ys) + 100],
        "color": "#b58b2a",
    })
    print(f"  组框「{GROUP_TITLE}」")

    # ── 6) 计数器 ──
    wf["last_node_id"] = max(wf["last_node_id"], max(NEW_IDS))
    wf["last_link_id"] = max(wf["last_link_id"], max(LINK_IDS))

    save(path, wf)
    print(f"  写入完成")

def verify(name: str):
    path = CANVASES[name]
    wf = load(path)
    nodes = {n["id"]: n for n in wf["nodes"]}
    links = {l[0]: l for l in wf["links"]}

    # A) 新节点在+类型+widgets
    for nid in NEW_IDS:
        need(nid in nodes, f"{name}: 缺节点 {nid}")
        n = nodes[nid]
        etype, _, ewidgets = NODES[nid]
        need(n["type"] == etype, f"{name}:{nid} type {n['type']}≠{etype}")
        if ewidgets is not None:
            need(n.get("widgets_values") == ewidgets,
                 f"{name}:{nid} widgets 不符: {n.get('widgets_values')}")
        need(n.get("mode", 0) == 0, f"{name}:{nid} mode 应 0")

    # B) 旧节点不在
    for nid in (set(range(8100, 8121)) - set(NEW_IDS)):
        need(nid not in nodes, f"{name}: 旧节点 {nid} 应已删除")

    # C) 全线在+形符
    for l in LINKS:
        need(l[0] in links and tuple(links[l[0]]) == l,
             f"{name}: 线 {l[0]} 缺失或形不符")

    # D) 旧线不在
    for lid in OLD_LINK_RANGE - set(LINK_IDS):
        need(lid not in links, f"{name}: 旧线 {lid} 应已删除")

    # E) 504 接线
    if 504 in nodes:
        n504 = nodes[504]
        for inp in n504.get("inputs", []):
            if inp.get("name") == "images":
                need(inp.get("link") == 8267, f"{name}: 504.images.link 应 8267")
        need(n504.get("title") == "[504] 放大保存", f"{name}: 504 标题不符")
        need(n504.get("widgets_values", [None])[0] == SAVE_PREFIX[name],
             f"{name}: 504 前缀不符")

    # F) 组框:恰一组+题名+真尺寸罩全 11 节点(明文判据转可执行断言,防估宽漏罩回潮)
    grp = [g for g in wf.get("groups", []) if g.get("id") == 7]
    need(len(grp) == 1 and grp[0]["title"] == GROUP_TITLE,
         f"{name}: 组框7 应恰一组且题名 {GROUP_TITLE}")
    bx, by, bw, bh = grp[0]["bounding"]
    inside = [n["id"] for n in wf["nodes"]
              if bx <= n["pos"][0] and by <= n["pos"][1]
              and n["pos"][0] + n["size"][0] <= bx + bw
              and n["pos"][1] + n["size"][1] <= by + bh]
    need(sorted(inside) == sorted(NEW_IDS),
         f"{name}: 组框应恰罩 11 新节点,得 {sorted(inside)}")

    # G) SeedVR 旁路态不变
    need(503 in nodes and nodes[503].get("mode") == 4,
         f"{name}: 503 应在且 mode=4")

    print(f"[gem-v2] verify {name}: PASS")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()
    for name in ("t2i", "i2i"):
        if not args.verify:
            surgery(name)
        verify(name)
    if not args.verify:
        print("[gem-v2] 手术完成。孪生件需重生成。")

if __name__ == "__main__":
    main()
