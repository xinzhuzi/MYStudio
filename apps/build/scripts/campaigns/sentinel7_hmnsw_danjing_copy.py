#!/usr/bin/env python3
"""单镜.json 复制挂 HMNSFW 写实 LoRA → 7_测试/单镜-成人向.json(sentinel7/h3 役,一次性)。

接线照 1121 A/B 实弹验过的 B 弹:1001(UNET)→1012(pika_turbo)→1099(HMNSFW ×1.0)→1031(sol-attn)。
纪律:原件零改动;三步同步(links 表+节点 inputs/outputs 引用);1099 不得越出「加载模型」组框;写后独立复载全链验证。
"""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SRC = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/单镜.json"
DST = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/7_测试/单镜-成人向.json"
LORA = "HMNSFW-Extreme-Realism.safetensors"
STRENGTH = 1.0

d = json.loads(SRC.read_text(encoding="utf-8"))

# --- 动刀前验靶(断言防呆,打不中即停) ---
nodes = {n["id"]: n for n in d["nodes"]}
assert nodes[1001]["type"] == "UNETLoader", "1001 类型漂移"
assert nodes[1012]["type"] == "LoraLoaderModelOnly", "1012 类型漂移"
assert nodes[1031]["type"] == "BlockSparseAttention", "1031 类型漂移"
assert 1099 not in nodes, "1099 已被占用"
link769 = next(l for l in d["links"] if l[0] == 769)
assert link769[1:] == [1012, 0, 1031, 0, "MODEL"], f"link769 意外: {link769}"
assert nodes[1031]["inputs"][0]["link"] == 769, "1031.model 入线不是 769"
assert 769 in nodes[1012]["outputs"][0]["links"], "1012.MODEL 出线缺 769"
assert not DST.exists(), "目标件已存在,拒绝覆盖"

# --- 新节点:deep-copy 1012 换值(同型结构最保真) ---
n1099 = copy.deepcopy(nodes[1012])
n1099["id"] = 1099
n1099["pos"] = [2130, 1650]
n1099["size"] = [420, 130]
n1099["order"] = 1013
n1099["inputs"][0]["link"] = 886
n1099["outputs"][0]["links"] = [887]
n1099["widgets_values"] = [LORA, STRENGTH]
n1099["widgets_values_named"] = {"lora_name": LORA, "strength_model": STRENGTH}
n1099["properties"].pop("models", None)  # 元数据指向 pika 权重,删掉防误导
n1099["title"] = "HMNSFW 写实 LoRA(一采 i2v 臂叠挂 ×1.0)"

# --- 三步同步之一:links 表 ---
d["links"] = [l for l in d["links"] if l[0] != 769]
d["links"].append([886, 1012, 0, 1099, 0, "MODEL"])
d["links"].append([887, 1099, 0, 1031, 0, "MODEL"])
d["last_link_id"] = max(d["last_link_id"], 887)

# --- 之二/三:节点级引用同步 ---
out1012 = nodes[1012]["outputs"][0]["links"]
out1012[out1012.index(769)] = 886
nodes[1031]["inputs"][0]["link"] = 887
d["nodes"].append(n1099)

# --- 组框罩全检查(1099 须落在「加载模型」组内,免改 bbox) ---
gx, gy, gw, gh = next(g["bounding"] for g in d["groups"] if g["title"] == "加载模型")
x, y = n1099["pos"]
w, h = n1099["size"]
assert gx <= x and y >= gy and x + w <= gx + gw and y + h <= gy + gh, "1099 越出加载模型组框"

DST.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")

# --- 写后独立复载验证 ---
v = json.loads(DST.read_text(encoding="utf-8"))
vn = {n["id"]: n for n in v["nodes"]}
vlinks = {l[0]: l for l in v["links"]}
assert len(v["nodes"]) == 94 and len(v["links"]) == 154, (len(v["nodes"]), len(v["links"]))
assert [vlinks[k] for k in (560, 886, 887)] == [
    [560, 1001, 0, 1012, 0, "MODEL"],
    [886, 1012, 0, 1099, 0, "MODEL"],
    [887, 1099, 0, 1031, 0, "MODEL"],
], "一采 MODEL 链不符"
assert vn[1099]["widgets_values"] == [LORA, STRENGTH], "1099 实参不符"
assert vn[1031]["inputs"][0]["link"] == 887
assert vn[1012]["outputs"][0]["links"].count(886) == 1 and 769 not in vn[1012]["outputs"][0]["links"]
for lid, f, _fs, t, _ts, _ty in v["links"]:
    assert f in vn and t in vn, f"link{lid} 端点缺失"
refs = set()
for n in v["nodes"]:
    for i in n.get("inputs", []):
        if i.get("link") is not None:
            assert i["link"] in vlinks, f"节点{n['id']}入线悬空 {i['link']}"
            refs.add(i["link"])
    for o in n.get("outputs", []):
        for lid in o.get("links") or []:
            assert lid in vlinks, f"节点{n['id']}出线悬空 {lid}"
            refs.add(lid)
orphan = set(vlinks) - refs
assert not orphan, f"links 表孤儿: {orphan}"

# --- 原件零改动终验 ---
src2 = json.loads(SRC.read_text(encoding="utf-8"))
assert len(src2["nodes"]) == 93 and 769 in {l[0] for l in src2["links"]} and 1099 not in src2, "原件被误改!"
print("OK 单镜-成人向.json:94节点/154links,链 1001→1012→1099(HMNSFW×1.0)→1031,无悬空无孤儿,原件零改动")
