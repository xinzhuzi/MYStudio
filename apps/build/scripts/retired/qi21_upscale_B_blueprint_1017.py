# -*- coding: utf-8 -*-
"""qi21 超分四法·B 像素超分+低denoise i2i 精修 子图蓝图施工器(1017 超分四法子图役·施工员B)。

真源任务:.trellis/tasks/10-17-upscale-four-ways-subgraphs/design.md §2.1/§3.2/§3.5/§5
蓝图=官方 Subgraph Blueprints 迷你工作流(先例 qi21-道劫-加速子图.json 同形):
  top keys 七件全 + definitions.subgraphs[0] 完整定义(内部 nodes/-10/-20/linkIds/sg.widgets)。

用法:
  python3 qi21_upscale_B_blueprint_1017.py            # 幂等重建(字节稳定;变更前后 diff 应为空)
  python3 qi21_upscale_B_blueprint_1017.py --check    # 只校验在盘文件==重建产物,不符退出 1
  python3 qi21_upscale_B_blueprint_1017.py --live     # 附加活体 object_info 校验(引擎口现读 manifest)

纪律:工作流 JSON 是唯一写点的「同刀双刷」由后续接线役手术脚本承担(qi21_upscale_subgraph_1017.py,
design §5);本件只产独立蓝图文件(拖入画布=独立副本),不碰任何工作流。
"""
from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-道劫-超分-像素精修.json"

SG_UUID = "bde98f0d-bdc3-506c-8e4f-c3ff4782c3f5"  # uuid5(URL, manying.local/subgraph/qi21-upscale-B-pixel-1017);开工实测与 6 既有定义 uuid 零碰撞
SG_NAME = "道劫·超分·B像素精修"
HOST_TITLE = "超分·B像素精修"  # design §3.1 A 先例式(法字母前缀,无宿主 id——t2i/i2i 宿主 id 分件不同)
NS = "https://manying.local/subgraph/qi21-upscale-B-pixel-1017"


def _uid(kind: str, name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{NS}/{kind}/{name}"))


# ── 边界契约(design §2.1 B 行:类型化槽序 + widget 槽序;输出单槽 image IMAGE) ──
INPUTS = [
    ("image", "IMAGE"),
    ("model", "MODEL"),
    ("positive", "CONDITIONING"),
    ("negative", "CONDITIONING"),
    ("vae", "VAE"),
    ("seed", "INT"),          # widget → 宿主控件
    ("步数", "INT"),           # widget → 宿主控件
    ("目标兆像素", "FLOAT"),    # widget → 宿主控件(design §2.1 表名;§3.2「目标兆_pixels」为同槽笔误)
    ("denoise", "FLOAT"),     # widget → 宿主控件
]
WIDGET_VALUES = [0, 4, 5.57, 0.30]  # design §3.2 宿主 widgets_values 逐字(seed/步数/目标兆像素/denoise)

UE = {"widget_ue_connectable": {}, "version": "7.8", "input_ue_unconnectable": {}}


def _node(nid, ntype, pos, size, title, ins, outs, wv, wvn, order, cnr=False):
    props = {"Node name for S&R": ntype, "ue_properties": UE}
    if cnr:
        props = {"Node name for S&R": ntype, "cnr_id": "comfy-core", "ue_properties": UE}
    n = {
        "id": nid, "type": ntype, "pos": pos, "size": size, "flags": {}, "order": order,
        "mode": 0, "inputs": ins, "outputs": outs, "title": title, "properties": props,
        "widgets_values": wv, "widgets_values_named": wvn,
    }
    return n


def _in_(name, typ, link=None, widget=False):
    e = {"name": name, "type": typ}
    if widget:
        e["widget"] = {"name": name}
    e["link"] = link
    return e


def _out(name, typ, links):
    return {"name": name, "type": typ, "links": links}


def _link(lid, o, os_, t, ts, typ):
    return {"id": lid, "origin_id": o, "origin_slot": os_, "target_id": t, "target_slot": ts, "type": typ}


def build() -> dict:
    # ── 线表(id 7210-7226;独立文件 id 分轨,避让宿主图 44xx 段) ──
    # 端点槽号=序列化 inputs 数组下标(GUI 惯例:连线槽在前+已转换 widget 槽按逻辑位;control_after_generate 恒不序列化——仓内 16 例 gap 实证)
    L = {
        "model_feed":   _link(7210, 7201, 0, 7202, 0, "UPSCALE_MODEL"),
        "image_in":     _link(7211, -10, 0, 7202, 1, "IMAGE"),
        "x4_up":        _link(7212, 7202, 0, 7203, 0, "IMAGE"),
        "mp_in":        _link(7213, -10, 7, 7203, 2, "FLOAT"),
        "seed_in":      _link(7214, -10, 5, 7204, 0, "INT"),
        "to_encode":    _link(7215, 7203, 0, 7205, 0, "IMAGE"),
        "vae_enc":      _link(7216, -10, 4, 7205, 1, "VAE"),
        "ks_model":     _link(7217, -10, 1, 7206, 0, "MODEL"),
        "ks_pos":       _link(7218, -10, 2, 7206, 1, "CONDITIONING"),
        "ks_neg":       _link(7219, -10, 3, 7206, 2, "CONDITIONING"),
        "ks_latent":    _link(7220, 7205, 0, 7206, 3, "LATENT"),
        "ks_seed":      _link(7221, 7204, 0, 7206, 4, "INT"),
        "ks_steps":     _link(7222, -10, 6, 7206, 5, "INT"),
        "ks_denoise":   _link(7223, -10, 8, 7206, 9, "FLOAT"),
        "to_decode":    _link(7224, 7206, 0, 7207, 0, "LATENT"),
        "vae_dec":      _link(7225, -10, 4, 7207, 1, "VAE"),
        "image_out":    _link(7226, 7207, 0, -20, 0, "IMAGE"),
    }

    nodes = [
        # 7201 ESRGAN 放大模型加载(design §3.2 wv 逐字;model_name 活体 combo 成员)
        _node(7201, "UpscaleModelLoader", [220, 260], [270, 100], "[7201] ESRGAN放大模型(anime6B)",
              [_in_("model_name", "COMBO", None, widget=True)],
              [_out("UPSCALE_MODEL", "UPSCALE_MODEL", [7210])],
              ["RealESRGAN_x4plus_anime_6B.pth"],
              {"model_name": "RealESRGAN_x4plus_anime_6B.pth"}, 1),
        # 7202 ×4 像素超分(先例 K2-SeedVR2降噪后4K.json [9] 同形;零 widget)
        _node(7202, "ImageUpscaleWithModel", [620, 260], [270, 80], "[7202] ×4像素超分",
              [_in_("upscale_model", "UPSCALE_MODEL", 7210), _in_("image", "IMAGE", 7211)],
              [_out("IMAGE", "IMAGE", [7212])],
              None, None, 2),
        # 7203 回缩到目标兆像素(wv=["lanczos",5.57,32];resolution_steps=32=i2i[16] 在役值,megapixels 由边界线喂)
        _node(7203, "ImageScaleToTotalPixels", [1020, 260], [270, 130], "[7203] 回缩·目标兆像素",
              [_in_("image", "IMAGE", 7212),
               _in_("upscale_method", "COMBO", None, widget=True),
               _in_("megapixels", "FLOAT", 7213, widget=True),
               _in_("resolution_steps", "INT", None, widget=True)],
              [_out("IMAGE", "IMAGE", [7215])],
              ["lanczos", 5.57, 32],
              {"upscale_method": "lanczos", "megapixels": 5.57, "resolution_steps": 32}, 3),
        # 7204 seed 单源(加速子图 7014 同形:value←边界 seed;wv=[0,"fixed"])
        _node(7204, "PrimitiveInt", [220, 620], [270, 90], "[7204] seed单源",
              [_in_("value", "INT", 7214, widget=True)],
              [_out("INT", "INT", [7221])],
              [0, "fixed"], {"value": 0, "fixed": "fixed"}, 4, cnr=True),
        # 7205 分块 VAE 编码(wv=[512,64,64,8]=活体默认)
        _node(7205, "VAEEncodeTiled", [1420, 260], [270, 130], "[7205] 分块VAE编码",
              [_in_("pixels", "IMAGE", 7215), _in_("vae", "VAE", 7216),
               _in_("tile_size", "INT", None, widget=True),
               _in_("overlap", "INT", None, widget=True),
               _in_("temporal_size", "INT", None, widget=True),
               _in_("temporal_overlap", "INT", None, widget=True)],
              [_out("LATENT", "LATENT", [7220])],
              [512, 64, 64, 8],
              {"tile_size": 512, "overlap": 64, "temporal_size": 64, "temporal_overlap": 8}, 5),
        # 7206 低denoise i2i 精修(wv=[0,"fixed",4,1,"euler","simple",0.30];cfg=1 §3.5 统一裁决;
        #        seed/steps/denoise 三 widget 吃边界线,槽位=数组下标 4/5/9)
        _node(7206, "KSampler", [1820, 260], [302.31739744199706, 262], "[7206] 低denoise i2i精修",
              [_in_("model", "MODEL", 7217),
               _in_("positive", "CONDITIONING", 7218),
               _in_("negative", "CONDITIONING", 7219),
               _in_("latent_image", "LATENT", 7220),
               _in_("seed", "INT", 7221, widget=True),
               _in_("steps", "INT", 7222, widget=True),
               _in_("cfg", "FLOAT", None, widget=True),
               _in_("sampler_name", "COMBO", None, widget=True),
               _in_("scheduler", "COMBO", None, widget=True),
               _in_("denoise", "FLOAT", 7223, widget=True)],
              [_out("LATENT", "LATENT", [7224])],
              [0, "fixed", 4, 1, "euler", "simple", 0.30],
              {"seed": 0, "control_after_generate": "fixed", "steps": 4, "cfg": 1,
               "sampler_name": "euler", "scheduler": "simple", "denoise": 0.30}, 6),
        # 7207 分块 VAE 解码(出图→-20)
        _node(7207, "VAEDecodeTiled", [2220, 260], [270, 130], "[7207] 分块VAE解码",
              [_in_("samples", "LATENT", 7224), _in_("vae", "VAE", 7225),
               _in_("tile_size", "INT", None, widget=True),
               _in_("overlap", "INT", None, widget=True),
               _in_("temporal_size", "INT", None, widget=True),
               _in_("temporal_overlap", "INT", None, widget=True)],
              [_out("IMAGE", "IMAGE", [7226])],
              [512, 64, 64, 8],
              {"tile_size": 512, "overlap": 64, "temporal_size": 64, "temporal_overlap": 8}, 7),
    ]

    link_ids = [l["id"] for l in L.values()]
    assert len(link_ids) == len(set(link_ids)) == 17

    sg_inputs = []
    for i, (name, typ) in enumerate(INPUTS):
        lids = [l["id"] for l in L.values() if l["origin_id"] == -10 and l["origin_slot"] == i]
        assert lids, f"边界槽 {name} 无边界线(=宿主控件/连线点失去来源)"
        sg_inputs.append({"id": _uid("input", name), "name": name, "type": typ,
                          "linkIds": lids, "pos": [104, 424 + 20 * i]})
    sg_outputs = [{
        "id": _uid("output", "image"), "name": "image", "type": "IMAGE",
        "linkIds": [l["id"] for l in L.values() if l["target_id"] == -20],
        "pos": [2644, 284],
    }]

    mirror_inputs = []
    for name, typ in INPUTS:
        if name in ("seed", "步数", "目标兆像素", "denoise"):
            mirror_inputs.append({"name": name, "type": typ, "widget": {"name": name}, "link": None})
        else:
            mirror_inputs.append({"name": name, "type": typ, "link": None})

    sg = {
        "id": SG_UUID,
        "version": 1,
        "state": {"lastGroupId": 0, "lastNodeId": 7207, "lastLinkId": 7226, "lastRerouteId": 0},
        "revision": 1,
        "config": {"defaultIOState": {}},
        "name": SG_NAME,
        "inputNode": {"id": -10, "bounding": [80, 400, 128, 188]},   # 9 槽=424+20*8=584 → 高 188(加速 8 槽=168 同式)
        "outputNode": {"id": -20, "bounding": [2620, 260, 128, 68]},
        "inputs": sg_inputs,
        "outputs": sg_outputs,
        "widgets": list(WIDGET_VALUES),  # sg.widgets 与宿主/镜像 widgets_values 同序镜像双写
        "nodes": nodes,
        "groups": [],
        "links": [L[k] for k in sorted(L, key=lambda k: L[k]["id"])],
        "extra": {"ue_links": [], "links_added_by_ue": []},
        "category": "漫影",
    }

    mirror = {
        "id": 1,
        "type": SG_UUID,
        "pos": [0, 0],
        "size": [560, 520],
        "flags": {},
        "order": 0,
        "mode": 0,
        "properties": {"subgraph": SG_UUID, "previewExposures": []},
        "inputs": mirror_inputs,
        "outputs": [{"name": "image", "type": "IMAGE", "links": []}],
        "widgets_values": list(WIDGET_VALUES),
        "title": HOST_TITLE,
        "widgets_values_named": dict(zip([n for n, _ in INPUTS if n in ("seed", "步数", "目标兆像素", "denoise")], WIDGET_VALUES)),
    }

    return {
        "revision": 1,
        "last_node_id": 1,
        "last_link_id": 7226,
        "nodes": [mirror],
        "links": [],
        "version": 0.4,
        "info": {"category": "漫影", "name": SG_NAME},
        "definitions": {"subgraphs": [sg]},
    }


def structural_checks(d: dict) -> None:
    """结构与六同步纪律自检(fail-closed;= test_workflow_subgraph_contract.py 同视角 + 蓝图三锚)。"""
    assert set(d.keys()) == {"revision", "last_node_id", "last_link_id", "nodes", "links",
                             "version", "info", "definitions"}, f"top keys 漂: {set(d.keys())}"
    assert d["version"] == 0.4 and d["links"] == [] and len(d["nodes"]) == 1
    sg = d["definitions"]["subgraphs"][0]
    assert sg["id"] == d["nodes"][0]["type"] == d["nodes"][0]["properties"]["subgraph"]

    ids = [n["id"] for n in sg["nodes"]]
    assert -10 not in ids and -20 not in ids, "-10/-20 禁入 nodes"
    assert len(ids) == len(set(ids)) == 7 and set(ids) == {7201, 7202, 7203, 7204, 7205, 7206, 7207}
    byid = {n["id"]: n for n in sg["nodes"]}
    links = sg["links"]
    assert all(isinstance(l, dict) for l in links), "子图 links 必用对象格式"
    lids = [l["id"] for l in links]
    assert len(lids) == len(set(lids))
    assert d["last_link_id"] == max(lids) == sg["state"]["lastLinkId"]

    # 线端点/槽位/双向一致
    for l in links:
        o, t = l["origin_id"], l["target_id"]
        assert o in ids or o == -10, f"线 {l['id']} origin {o} 不存在"
        assert t in ids or t == -20, f"线 {l['id']} target {t} 不存在"
        if o != -10:
            outs = byid[o]["outputs"]
            assert 0 <= l["origin_slot"] < len(outs) and l["id"] in outs[l["origin_slot"]]["links"], \
                f"线 {l['id']} origin_slot {l['origin_slot']} 与节点 {o} outputs 不符"
            assert l["type"] == outs[l["origin_slot"]]["type"], f"线 {l['id']} type 与 origin 出口不符"
        if t != -20:
            ins = byid[t]["inputs"]
            assert 0 <= l["target_slot"] < len(ins), f"线 {l['id']} target_slot 越界"
            assert ins[l["target_slot"]]["link"] == l["id"], \
                f"线 {l['id']} 未回填进 {t}.inputs[{l['target_slot']}].link"
            assert l["type"] == ins[l["target_slot"]]["type"], f"线 {l['id']} type 与 target 槽型不符"
        if o == -10:
            assert l["origin_slot"] < len(sg["inputs"]), "-10 槽越界"
        if t == -20:
            assert l["target_slot"] < len(sg["outputs"]), "-20 槽越界"

    # 边界线 linkIds 登记 + 槽位一致(test_subgraph_io_link_ids_registered 同判据)
    reg_in = {lid: i for i, s in enumerate(sg["inputs"]) for lid in s["linkIds"]}
    reg_out = {lid: i for i, s in enumerate(sg["outputs"]) for lid in s["linkIds"]}
    for l in links:
        if l["origin_id"] == -10:
            assert l["id"] in reg_in and reg_in[l["id"]] == l["origin_slot"], \
                f"入口线 {l['id']} 未按槽位登记 inputs[].linkIds"
        if l["target_id"] == -20:
            assert l["id"] in reg_out and reg_out[l["id"]] == l["target_slot"], \
                f"出口线 {l['id']} 未按槽位登记 outputs[].linkIds"

    # 镜像双写三锚(widgets 同序逐字/输入序镜像/标题)
    m = d["nodes"][0]
    assert m["widgets_values"] == sg["widgets"], "镜像 widgets_values ≠ sg.widgets(同序镜像双写破)"
    assert [i["name"] for i in m["inputs"]] == [s["name"] for s in sg["inputs"]]
    assert [i["type"] for i in m["inputs"]] == [s["type"] for s in sg["inputs"]]
    for i, s in zip(m["inputs"], sg["inputs"]):
        if s["name"] in ("seed", "步数", "目标兆像素", "denoise"):
            assert i.get("widget", {}).get("name") == s["name"], f"widget 槽 {s['name']} 缺 widget 描述"
        else:
            assert "widget" not in i, f"连线槽 {s['name']} 不应带 widget 描述"
    # 宿主控件值数=widget 槽数;sg.widgets 逐字=设计值
    assert len(sg["widgets"]) == 4 and sg["widgets"] == [0, 4, 5.57, 0.30]

    # DAG:每内部节点从源(-10 边界 + 无入线的自足加载件)可达、可流到 -20;无孤立件
    adj = {}
    for l in links:
        adj.setdefault(l["origin_id"], []).append(l["target_id"])
    has_in = {l["target_id"] for l in links}
    roots = {-10} | {i for i in ids if i not in has_in}  # 加载件(UpscaleModelLoader)合法无父
    seen, stack = set(roots), list(roots)
    while stack:
        x = stack.pop()
        for y in adj.get(x, []):
            if y not in seen:
                seen.add(y)
                stack.append(y)
    assert seen >= set(ids), f"有内部节点从源不可达(孤立件): {set(ids) - seen}"
    assert all(n in has_in or n in roots for n in ids)
    back, stack2 = set(), [7207]
    radj = {}
    for l in links:
        radj.setdefault(l["target_id"], []).append(l["origin_id"])
    while stack2:
        x = stack2.pop()
        for y in radj.get(x, []):
            if y not in back:
                back.add(y)
                stack2.append(y)
    assert -20 in seen and -10 in back, "-10→…→-20 不连通"

    # 与三工作流既有 id 域零碰撞(未来嵌入安全余量;接线役仍须现读查撞)
    wf_root = ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
    for rel in ("1_文生图/qi21-道劫-t2i.json", "2_图生图/qi21-道劫-i2i.json", "2_图生图/qi21-edit.json"):
        w = json.loads((wf_root / rel).read_text())
        rn = {n["id"] for n in w["nodes"]}
        rl = {l["id"] if isinstance(l, dict) else l[0] for l in w["links"]}
        for s in w.get("definitions", {}).get("subgraphs", []):
            rn |= {n["id"] for n in s["nodes"]}
            rl |= {l["id"] if isinstance(l, dict) else l[0] for l in s["links"]}
        clash_n = rn & set(ids)
        clash_l = rl & set(lids)
        assert not clash_n and not clash_l, f"{rel} 撞 id:{clash_n} 撞线:{clash_l}"


def live_checks(d: dict) -> None:
    """活体 object_info 对拍:节点类在场+combo 值成员+widget 值域(引擎口现读 manifest,铁律禁硬编码)。

    combo 两代序列化并容(V3 实测 2026-10-17):旧=list 直挂 v[0];新=("${'COMBO'}", {"options":[…]})。
    """
    import urllib.request
    manifest = json.loads((Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json").read_text())
    port = manifest["engine"]["port"]
    def oi(name):
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/object_info/{name}", timeout=10) as r:
            return json.load(r)[name]
    def combo_options(entry):
        t0, det = entry[0], (entry[1] if len(entry) > 1 else {})
        if isinstance(t0, list):
            return t0
        if t0 == "COMBO" and isinstance(det, dict):
            return det.get("options") or []
        return None
    sg = d["definitions"]["subgraphs"][0]
    for n in sg["nodes"]:
        info = oi(n["type"])  # 节点类在场(缺=服务端验证拒)
        req = info["input"]["required"]
        for e in n["inputs"]:
            assert e["name"] in req, f"{n['type']}.{e['name']} 不在活体 required"
            t0 = req[e["name"]][0]
            if isinstance(t0, list) or t0 == "COMBO":
                assert e["type"] == "COMBO", f"{n['type']}.{e['name']} 应序列化为 COMBO"
            else:
                assert e["type"] == t0, f"{n['type']}.{e['name']} 型 {e['type']} ≠ 活体 {t0}"
        # combo 值成员
        if n["type"] == "UpscaleModelLoader":
            assert n["widgets_values"][0] in combo_options(req["model_name"]), "model_name 非活体 combo 成员"
        if n["type"] == "ImageScaleToTotalPixels":
            assert n["widgets_values"][0] in combo_options(req["upscale_method"]), "upscale_method 非活体成员"
        if n["type"] == "KSampler":
            assert n["widgets_values"][4] in combo_options(req["sampler_name"])
            assert n["widgets_values"][5] in combo_options(req["scheduler"])
        # widget 值域
        if n["type"] == "ImageScaleToTotalPixels":
            det = req["megapixels"][1]
            assert det["min"] <= n["widgets_values"][1] <= det["max"]
        if n["type"] == "KSampler":
            assert req["denoise"][1]["min"] <= n["widgets_values"][6] <= req["denoise"][1]["max"]
    print(f"[live] 活体 object_info 对拍全过(port={port})")


def main() -> int:
    d = build()
    structural_checks(d)
    text = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
    if "--check" in sys.argv:
        on_disk = OUT.read_text() if OUT.exists() else None
        if on_disk != text:
            print("[check] 在盘文件 ≠ 重建产物(漂移)", file=sys.stderr)
            return 1
        print("[check] 在盘蓝图与重建产物逐字节一致")
    else:
        OUT.write_text(text)
        print(f"[apply] 写出 {OUT} ({len(text)}B)")
    if "--live" in sys.argv:
        live_checks(d)
    print("[ok] 结构自检全过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
