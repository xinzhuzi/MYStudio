#!/usr/bin/env python3
"""09-16 一次性脚本:K2 图像产线接入新 LoRA
1. 超集 MY-K2_文生图_超集.json:串接 4 件新 LoRA(LoraLoaderModelOnly,默认全旁路)+说明卡追加
2. 新建 MY-K2-文生图_风格参照.json:复制超集,接 style_reference LoRA(默认开)+LoadImage 参考图像素路径
3. 自校验:链路完整性/文件存在性/IP 词扫描/JSON round-trip
用法: python3 k2_lora_integrate_0916.py [--dry]
"""
import json, os, re, sys, uuid

REPO = "/Users/zhengbingjin/Project/Github/MYStudio"
SUPERSET = os.path.join(REPO, "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-K2_文生图_超集.json")
STYLE_WF = os.path.join(REPO, "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-K2-文生图_风格参照.json")
LORAS = "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui/models/loras"
DRY = "--dry" in sys.argv

# 落地 4 件(超集侧) + style_reference(新工作流侧,默认开)
SUP_LORAS = [
    dict(id=67, path="Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors", strength=1.0,
         title="[67] 美学LoRA·细节滑杆 ×1.0(细节增强可叠;默认旁路)", color="#4a89b8", bgcolor="#1f2a33", pos=[1820.0, 240.0]),
    dict(id=68, path="Krea2-画风/Krea2-柔水彩softwatercolor.safetensors", strength=1.0,
         title="[68] 画风LoRA·柔水彩 ×1.0(触发词:art deco watercolor style;默认旁路)", color="#b06a8f", bgcolor="#33202b", pos=[2340.0, 240.0]),
    dict(id=69, path="Krea2-画风/Krea2-暗笔刷darkbrush.safetensors", strength=1.0,
         title="[69] 画风LoRA·暗笔刷 ×1.0(触发词:monochrome ink wash style;默认旁路)", color="#b06a8f", bgcolor="#33202b", pos=[2860.0, 240.0]),
    dict(id=70, path="Krea2-画风/Krea2-复古漫retroanime.safetensors", strength=1.0,
         title="[70] 画风LoRA·复古漫 ×1.0(触发词:purple retro anime style;默认旁路)", color="#b06a8f", bgcolor="#33202b", pos=[3380.0, 240.0]),
]
SR_LORA = dict(id=72, path="Krea2-画风/Krea2-风格参照style_reference.safetensors", strength=1.0,
               title="[72] 风格参照LoRA·style_reference ×1.0(随参考图迁移画风;本流主件)",
               color="#b06a8f", bgcolor="#33202b", pos=[3900.0, 240.0])

NOTE_APPEND = """

## 09-16 新增 LoRA 矩阵(默认全旁路;启用=右键节点 Remove Bypass)
- [67] 细节滑杆DetailSlider | Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors | ×1.0 | 通用 | 细节增强,可与其他LoRA叠加
- [68] 柔水彩softwatercolor | Krea2-画风/Krea2-柔水彩softwatercolor.safetensors | ×1.0 | 通用 | 官方,装饰艺术水彩画风,触发词 art deco watercolor style
- [69] 暗笔刷darkbrush | Krea2-画风/Krea2-暗笔刷darkbrush.safetensors | ×1.0 | 通用 | 官方,单色水墨画风,触发词 monochrome ink wash style
- [70] 复古漫retroanime | Krea2-画风/Krea2-复古漫retroanime.safetensors | ×1.0 | 通用 | 官方,紫调复古动画画风,触发词 purple retro anime style
- 风格参照style_reference(官方,需参考图输入)→ 独立工作流 MY-K2-文生图_风格参照.json(本流放不下)
- 挂账3件(Civitai 创建者要求登录下载,拿到 token 后补):AsianMix v5-CPO(古风亚洲面孔)/Aesthetic Masterpiece v51(提美)/Cinematic Shot(电影感)"""

STYLE_NOTE_APPEND = """

## 风格参照流用法(09-16 新建,自超集复制)
- [71] 选参考图 → [14] 像素路径接入(vae+source_image+target_latent 三线) → [72] style_reference LoRA ×1.0(默认开)
- 提示词描述目标内容,画风跟随参考图迁移;无触发词,参考图 1-2 张,分辨率不匹配自动 fit 重采样
- 其余 LoRA(44/45/67-70)默认旁路;默认速度档 4步/cfg1,质量档=[47]旁路+步数12/cfg5"""

IP_PAT = re.compile(r"道劫|daojie|凡人")


def node(d, nid):
    return next(n for n in d["nodes"] if n["id"] == nid)


def lora_node(spec, mode, order, in_link, out_link, dst_node, dst_slot):
    n = {
        "id": spec["id"], "type": "LoraLoaderModelOnly",
        "pos": spec["pos"], "size": [340, 130], "flags": {},
        "order": order, "mode": mode,
        "inputs": [{"name": "model", "type": "MODEL", "link": in_link}],
        "outputs": [{"name": "MODEL", "type": "MODEL", "links": [out_link], "slot_index": 0}],
        "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
        "widgets_values": [spec["path"], spec["strength"]],
        "widgets_values_named": {"lora_name": spec["path"], "strength_model": spec["strength"]},
        "color": spec["color"], "bgcolor": spec["bgcolor"], "title": spec["title"],
    }
    return n


def chain_insert(d, specs, after_id, dst_id, dst_slot, start_link_id):
    """把 specs 串进 after_id -> dst_id 的 MODEL 线;返回新 last_link_id。"""
    # 原线:after_id.out[0] --(L)--> dst_id.in[dst_slot]
    after = node(d, after_id)
    old_link = next(l for l in d["links"] if l[1] == after_id and l[3] == dst_id and l[5] == "MODEL")
    lid = old_link[0]
    # 第一段:after -> specs[0]
    old_link[3] = specs[0]["id"]
    old_link[4] = 0
    for i, spec in enumerate(specs):
        last = (i == len(specs) - 1)
        if last:
            d["links"].append([start_link_id + i, spec["id"], 0, dst_id, dst_slot, "MODEL"])
        else:
            d["links"].append([start_link_id + i, spec["id"], 0, specs[i + 1]["id"], 0, "MODEL"])
        in_l = lid if i == 0 else start_link_id + i - 1
        d["nodes"].append(lora_node(spec, 4, spec["id"], in_l, start_link_id + i, dst_id, dst_slot))
        lid = start_link_id + i
    # 修 dst 输入槽的 link 号
    dst = node(d, dst_id)
    dst["inputs"][dst_slot]["link"] = start_link_id + len(specs) - 1
    return start_link_id + len(specs) - 1


def validate(d, name):
    errs = []
    ids = [n["id"] for n in d["nodes"]]
    if len(ids) != len(set(ids)):
        errs.append("duplicate node ids")
    link_ids = [l[0] for l in d["links"]]
    if len(link_ids) != len(set(link_ids)):
        errs.append("duplicate link ids")
    byid = {n["id"]: n for n in d["nodes"]}
    for l in d["links"]:
        lid, sn, ss, dn, dsd, typ = l
        if sn not in byid: errs.append(f"link {lid}: src node {sn} missing"); continue
        if dn not in byid: errs.append(f"link {lid}: dst node {dn} missing"); continue
        s, dt = byid[sn], byid[dn]
        if ss >= len(s.get("outputs", [])): errs.append(f"link {lid}: src slot {ss} OOB on {sn}")
        else:
            if lid not in (s["outputs"][ss].get("links") or []):
                errs.append(f"link {lid}: not in src {sn} out links")
            if typ != "*" and s["outputs"][ss]["type"] != typ: errs.append(f"link {lid}: type mismatch src")
        if dsd >= len(dt.get("inputs", [])): errs.append(f"link {lid}: dst slot {dsd} OOB on {dn}")
        else:
            if dt["inputs"][dsd].get("link") != lid: errs.append(f"link {lid}: dst {dn} slot {dsd} link ref mismatch")
            if typ != "*" and dt["inputs"][dsd]["type"] != typ: errs.append(f"link {lid}: type mismatch dst")
    # model 链走查
    chain, cur = [], node(d, 21)["id"]
    while True:
        n = byid[cur]
        chain.append(f"{cur}({n['type']}{'·旁路' if n.get('mode')==4 else ''})")
        nxt = None
        for o in n.get("outputs", []):
            for lid in (o.get("links") or []):
                l = next(x for x in d["links"] if x[0] == lid)
                if l[5] == "MODEL":
                    nxt = l[3]; break
            if nxt: break
        if nxt is None or nxt in [c.split("(")[0] for c in chain]:
            break
        cur = nxt
    # lora 文件存在性
    for n in d["nodes"]:
        if n["type"] == "LoraLoaderModelOnly":
            p = os.path.join(LORAS, n["widgets_values"][0])
            if not os.path.isfile(p): errs.append(f"lora file missing: {n['widgets_values'][0]}")
    raw = json.dumps(d, ensure_ascii=False)
    if IP_PAT.search(raw): errs.append("IP words found!")
    print(f"[{name}] nodes={len(d['nodes'])} links={len(d['links'])} last_node_id={d['last_node_id']} last_link_id={d['last_link_id']}")
    print(f"[{name}] MODEL chain: {' -> '.join(chain)}")
    bypassed = [f"{n['id']}" for n in d['nodes'] if n['type'] == 'LoraLoaderModelOnly' and n.get('mode') == 4]
    on = [f"{n['id']}" for n in d['nodes'] if n['type'] == 'LoraLoaderModelOnly' and n.get('mode', 0) != 4]
    print(f"[{name}] LoraLoaderModelOnly 旁路={bypassed} 启用={on}")
    print(f"[{name}] IP扫描={'零命中' if not IP_PAT.search(raw) else '命中!'}")
    if errs:
        print(f"[{name}] ERRORS:"); [print("  -", e) for e in errs]
        raise SystemExit(1)
    print(f"[{name}] 结构校验 PASS")


def main():
    raw = open(SUPERSET).read()
    ends_nl = raw.endswith("\n")
    d = json.loads(raw)

    # --- 超集:串 4 件(47 -> 67..70 -> 14 slot0) ---
    chain_insert(d, SUP_LORAS, 47, 14, 0, 39)  # 复用 link38 为第一段,新 39..42
    d["last_node_id"] = max(n["id"] for n in d["nodes"])
    d["last_link_id"] = max(l[0] for l in d["links"])
    md = node(d, 66)
    md["widgets_values"][0] = md["widgets_values"][0] + NOTE_APPEND
    validate(d, "超集")
    if not DRY:
        with open(SUPERSET, "w") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
            if ends_nl: f.write("\n")
        print("written:", SUPERSET)

    # --- 风格参照工作流:复制超集,接 style_reference + LoadImage 像素路径 ---
    d2 = json.loads(json.dumps(d))
    d2["id"] = str(uuid.uuid4())
    # 72 串在 70 -> 14 之间(默认开)
    spec = dict(SR_LORA)
    chain_insert(d2, [spec], 70, 14, 0, 46)
    node(d2, 72)["mode"] = 0
    node(d2, 72)["order"] = 72
    # LoadImage 71
    d2["nodes"].append({
        "id": 71, "type": "LoadImage", "pos": [4420.0, 40.0], "size": [340, 314], "flags": {},
        "order": 71, "mode": 0,
        "inputs": [{"name": "image", "type": "IMAGE", "link": None}],
        "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [44], "slot_index": 0},
                    {"name": "MASK", "type": "MASK", "links": None, "slot_index": 1}],
        "title": "[71] 参考图(风格迁移源)",
        "properties": {"Node name for S&R": "LoadImage", "cnr_id": "comfy-core"},
        "widgets_values": ["example.png", "image"],
        "color": "#4d9e6a", "bgcolor": "#1f2f26",
    })
    # 接线: 10.VAE->14.vae(slot4) | 71.IMAGE->14.source_image(slot5) | 53.LATENT->14.target_latent(slot7)
    d2["links"].append([43, 10, 0, 14, 4, "VAE"])
    d2["links"].append([44, 71, 0, 14, 5, "IMAGE"])
    d2["links"].append([45, 53, 0, 14, 7, "LATENT"])
    n10, n14, n53 = node(d2, 10), node(d2, 14), node(d2, 53)
    n10["outputs"][0]["links"] = [12, 43]
    n14["inputs"][4]["link"] = 43   # vae
    n14["inputs"][5]["link"] = 44   # source_image
    n14["inputs"][7]["link"] = 45   # target_latent
    n14["title"] = "[14] Krea2Edit·参考图接入(像素路径 fit;风格参照流主接线)"
    n53["outputs"][0]["links"] = [9, 16, 45]
    # SaveImage 前缀
    n4 = node(d2, 4)
    n4["widgets_values"] = ["K2风格参照_"]
    n4["widgets_values_named"]["filename_prefix"] = "K2风格参照_"
    # 说明卡追加
    md2 = node(d2, 66)
    md2["widgets_values"][0] = md2["widgets_values"][0] + STYLE_NOTE_APPEND
    d2["last_node_id"] = max(n["id"] for n in d2["nodes"])
    d2["last_link_id"] = max(l[0] for l in d2["links"])
    validate(d2, "风格参照")
    if not DRY:
        with open(STYLE_WF, "w") as f:
            json.dump(d2, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("written:", STYLE_WF)

    print("DONE", "(dry)" if DRY else "")


if __name__ == "__main__":
    main()
