# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""工作流子图契约测试(09-21 用户令补的回归网:接连两轮线上报错后的亡羊补牢)。

网住两类已在 K2-文生图-道劫 上实弹炸过的伤:
1. **IO 边界线未登记**——inputs/outputs[].linkIds 空 → 画布圆点无线+
   前端转换拿不到子图输出 →「KSampler - model 缺少连接」(09-21 上午)。
2. **路由槽错位**——前端重排槽序后连线没跟名字走(base↔MODEL、人物↔COMBO
   互换,整排错一位)→ 服务端验证拒「Return type mismatch」(09-21 10:58)。

判据走装载器/前端同视角:槽↔线映射按 links[].target_slot 推导
(文件里 inputs[].link 允许为空,装载时会回填——只信 links 数组+槽名,
名字才是服务端 API 的键)。语义对拍单源 daojie_lora_stack.json。
"""
from __future__ import annotations

import json
from pathlib import Path

from engines.comfyui.my_nodes.nodes.my_daojie_route import MyDaojieRoute

_ROOT = Path(__file__).resolve().parents[6]  # …/MYStudio
WORKFLOWS = _ROOT / "apps" / "backend" / "engines" / "comfyui" / "workflows"
DAOJIE_T2I = WORKFLOWS / "1_图片" / "K2图像" / "1_文生图" / "K2-文生图-道劫.json"
STACK_DATA = (Path(__file__).resolve().parents[1] / "nodes" / "daojie_lora_stack.json")

NINE = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]


def _obj(l):
    """子图 link 兼容对象/数组两种格式(旧数组=前六元组)。"""
    return l if isinstance(l, dict) else {"id": l[0], "origin_id": l[1], "origin_slot": l[2],
                                          "target_id": l[3], "target_slot": l[4]}


def _iter_subgraphs():
    for p in sorted(WORKFLOWS.rglob("*.json")):
        if p.name.startswith("."):
            continue
        try:
            wf = json.loads(p.read_text())
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        for sg in (wf.get("definitions") or {}).get("subgraphs", []):
            yield p, sg


def _daojie_subgraph():
    wf = json.loads(DAOJIE_T2I.read_text())
    sg = next(s for s in wf["definitions"]["subgraphs"]
              if any(n["type"] == "MyDaojieRoute" for n in s["nodes"]))
    return sg


def test_subgraph_io_link_ids_registered():
    """每根 -10/-20 边界线必须被对应 IO 槽 linkIds 登记,且登记槽位=线端槽位。"""
    checked = 0
    for p, sg in _iter_subgraphs():
        links = [_obj(l) for l in sg.get("links", [])]
        boundary = [l for l in links if l["origin_id"] == -10 or l["target_id"] == -20]
        if not boundary:
            continue
        reg_in = {lid: i for i, s in enumerate(sg.get("inputs", [])) for lid in (s.get("linkIds") or [])}
        reg_out = {lid: i for i, s in enumerate(sg.get("outputs", [])) for lid in (s.get("linkIds") or [])}
        for l in boundary:
            if l["origin_id"] == -10:
                assert l["id"] in reg_in, (
                    f"{p.name}/{sg.get('name')}: 入口线 {l['id']} 未登记进 inputs[].linkIds"
                    "(=画布圆点无线+转换丢子图输出)")
                assert reg_in[l["id"]] == l["origin_slot"], (
                    f"{p.name}/{sg.get('name')}: 入口线 {l['id']} 登记槽位 {reg_in[l['id']]} ≠ 线端 {l['origin_slot']}")
            if l["target_id"] == -20:
                assert l["id"] in reg_out, f"{p.name}/{sg.get('name')}: 出口线 {l['id']} 未登记进 outputs[].linkIds"
                assert reg_out[l["id"]] == l["target_slot"], (
                    f"{p.name}/{sg.get('name')}: 出口线 {l['id']} 登记槽位 {reg_out[l['id']]} ≠ 线端 {l['target_slot']}")
        checked += 1
    assert checked >= 1, "工作流库里未扫到任何带边界线的子图(扫描器本身可能坏了)"


def test_daojie_route_slots_and_types():
    """路由槽名齐全性+类型对拍:base←入口 base 口(COMBO);九型槽←LoRA 实件(MODEL)。"""
    sg = _daojie_subgraph()
    route = next(n for n in sg["nodes"] if n["type"] == "MyDaojieRoute")
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {_obj(l)["id"]: _obj(l) for l in sg["links"]}

    # 槽名集合 = 服务端 INPUT_TYPES 权威(名字才是 API 键)
    server_names = list(MyDaojieRoute.INPUT_TYPES()["required"]) + list(MyDaojieRoute.INPUT_TYPES()["optional"])
    file_names = [s["name"] for s in route["inputs"]]
    assert sorted(file_names) == sorted(server_names), (
        f"路由槽名与服务端定义不符: 文件={sorted(file_names)} 服务端={sorted(server_names)}")
    # base 输入型必须裸 "COMBO":组合框列表输入在服务端不吃 COMBO 链接
    # (子图边界必然以链接喂型值;列表型→「Return type mismatch」必拒,09-21)。
    assert MyDaojieRoute.INPUT_TYPES()["required"]["base"] == ("COMBO",), (
        "Route.base 应为裸 COMBO 型以接受子图边界链接,改回列表前先读 09-21 根因")
    # 槽序 = 前端装载稳定序(九型在前、base 末位)。铁证 09-21:文件 base 在首位时,
    # 前端装载重排槽序且连线按槽位序号落座 → 整排错一位 → 服务端「Return type
    # mismatch」。宁可锁死这个序,勿按服务端 required-first 写。
    assert file_names == NINE + ["base"], (
        f"路由槽序非装载稳定序(应为 九型…+base 末位): {file_names}")

    # 类型对拍(按 links[].target_slot 推导,同装载器视角)
    for l in links.values():
        if l["target_id"] != route["id"]:
            continue
        slot = route["inputs"][l["target_slot"]]
        origin = nodes.get(l["origin_id"])
        if slot["name"] == "base":
            assert l["origin_id"] == -10 and l["origin_slot"] == 1, (
                f"base 槽必须接入口 base 口(COMBO),现接 {origin and origin.get('title')}(09-21 10:58 报错同款)")
        else:
            assert origin is not None and origin["type"] == "LoraLoaderModelOnly", (
                f"{slot['name']} 槽(MODEL)接了非 LoRA 实件: origin={l['origin_id']}")


def test_daojie_route_lazy_pruning():
    """九条线路槽必须声明 lazy + check_lazy_status 只拉起 base 行(09-21 概念气氛图实弹根修)。

    真前端路径会把子图内 45 件 LoraLoaderModelOnly 全展开进 API 图;九槽不
    lazy 时服务端须全部执行完才选线(单任务 2~5 分钟,九型并行排队,队尾型
    720s 内进不了 history)。lazy 标志一旦被退化抹掉,此伤立即复发——锁死。
    """
    optional = MyDaojieRoute.INPUT_TYPES()["optional"]
    assert sorted(optional) == sorted(NINE), "九型槽集合应与服务端 NINE 一致"
    for zh in NINE:
        assert optional[zh] == ("MODEL", {"lazy": True}), (
            f"槽 {zh} 应为 ('MODEL', {{'lazy': True}}),现 {optional[zh]!r}"
            "(非 lazy=真前端 45 件全执行,09-21 排队超时复发)")
    assert callable(getattr(MyDaojieRoute(), "check_lazy_status", None)), (
        "check_lazy_status 缺失=lazy 输入永远无人拉起,Route 收全 None 必炸")

    node = MyDaojieRoute()
    # 首轮:base 行未执行(全槽 None)→ 只请求 base 槽
    assert node.check_lazy_status(base="概念气氛图", **{zh: None for zh in NINE}) == ["概念气氛图"]
    assert node.check_lazy_status(base="人物", **{zh: None for zh in NINE}) == ["人物"]
    # 二轮:base 行已有值 → 不再请求任何槽(返回 None/=falsy)
    fed = {zh: None for zh in NINE}
    fed["概念气氛图"] = object()
    assert not node.check_lazy_status(base="概念气氛图", **fed)
    # 行为不变:route 路由 base 行模型、未接线仍报错
    m = object()
    out = node.route("概念气氛图", **{**{zh: None for zh in NINE}, "概念气氛图": m})
    assert out[0] is m and "概念气氛图" in out[1]
    try:
        node.route("概念气氛图", **{zh: None for zh in NINE})
    except ValueError as e:
        assert "未接线" in str(e)
    else:
        raise AssertionError("base 行未接线应抛 ValueError( disclosing 已接线路)")


def test_daojie_rows_match_stack_presets():
    """九行内容与 daojie_lora_stack.json 单源预设一比一(on 的件按序、权重一致、行首接入口 model)。"""
    data = json.loads(STACK_DATA.read_text())
    sg = _daojie_subgraph()
    route = next(n for n in sg["nodes"] if n["type"] == "MyDaojieRoute")
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = [_obj(l) for l in sg["links"]]
    by_target = {(l["target_id"], l["target_slot"]): l for l in links}

    def row_of(tail_id):
        """从行尾回溯到行首(经 model 口 in-edge),返回节点序(行首→行尾)。"""
        chain = [nodes[tail_id]]
        while True:
            l = by_target.get((chain[0]["id"], 0))
            if l is None:
                break
            if l["origin_id"] == -10:
                assert l["origin_slot"] == 0, f"行首 {chain[0]['title']} 接的不是入口 model 口"
                return chain  # insert(0,…) 已保证 头→尾 序
            chain.insert(0, nodes[l["origin_id"]])

    for i, t in enumerate(NINE):
        expected = [(d["file"], d["presets"][t]["weight"]) for d in data
                    if (d.get("presets") or {}).get(t, {}).get("on")]
        assert expected, f"{t} 在单源预设里一件都没开,数据面与画布面对拍前提坏了"
        # 该型槽的行尾
        slot_l = by_target.get((route["id"], [s["name"] for s in route["inputs"]].index(t)))
        assert slot_l is not None, f"{t} 槽没接线"
        row = row_of(slot_l["origin_id"])
        got = []
        for n in row:
            named = n.get("widgets_values_named") or {}
            if "lora_name" in named:
                got.append((named["lora_name"], named["strength_model"]))
            else:  # 生成器产物=位置数组 [lora_name, strength_model]
                got.append((n["widgets_values"][0], n["widgets_values"][1]))
        assert got == expected, (
            f"{t} 行与单源预设不符:\n  画布={got}\n  单源={expected}")


def test_route_disclosure_matches_ledger_rows():
    """[86] 披露(09-21 晚用户令)=路线+该型实件清单:九型逐一与台账对拍,链序=文件序。"""
    from engines.comfyui.my_nodes.nodes import my_daojie_route as mod

    data = json.loads(STACK_DATA.read_text())
    for t in NINE:
        on = [d for d in data if (d.get("presets") or {}).get(t, {}).get("on")]
        assert on, f"{t} 台账无开件"
        expect = f"路线={t}线·{len(on)}件 | " + " → ".join(
            f"{d['label']}×{d['presets'][t]['weight']:g}" for d in on)
        got = mod._line_disclosure(t)
        assert got == expect, f"{t} 披露与台账不符:\n  得到={got}\n  应为={expect}"


def test_route_disclosure_fallback_when_ledger_missing(monkeypatch, tmp_path):
    """台账缺席/坏=退回纯路线文案,永不阻断生图。"""
    from engines.comfyui.my_nodes.nodes import my_daojie_route as mod

    monkeypatch.setattr(mod, "_LEDGER", tmp_path / "不存在的台账.json")
    assert mod._line_disclosure("人物") == "路线=人物线(9条真实线路按型分流)"
    (tmp_path / "bad.json").write_text("{bad json", encoding="utf-8")
    monkeypatch.setattr(mod, "_LEDGER", tmp_path / "bad.json")
    assert mod._line_disclosure("场景") == "路线=场景线(9条真实线路按型分流)"


def test_route_disclosure_reflects_bypassed_loaders():
    """09-22 用户令:屏蔽(旁路)件不得进披露——走执行图真链,台账仅作件名映射与兜底。"""
    from engines.comfyui.my_nodes.nodes import my_daojie_route as mod

    prompt = {  # 旁路件(如被屏蔽的服从度)已被转换剔除,不在图里
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "k2.safetensors"}},
        "2": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "lora_name": "Krea2-功能/Krea2-Turbo-4步蒸馏.safetensors", "strength_model": 1, "model": ["1", 0]}},
        "3": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "lora_name": "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors", "strength_model": 0.55, "model": ["2", 0]}},
        "9": {"class_type": "MyDaojieRoute", "inputs": {"base": "美宣", "美宣": ["3", 0]}},
    }
    walked = mod._walk_applied(prompt, "9", "美宣")
    assert walked == [("Krea2-功能/Krea2-Turbo-4步蒸馏.safetensors", 1.0),
                      ("Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors", 0.55)]
    s = mod._line_disclosure("美宣", walked)
    ledger = json.loads(STACK_DATA.read_text())
    turbo = next(d["label"] for d in ledger
                 if d["file"] == "Krea2-功能/Krea2-Turbo-4步蒸馏.safetensors")
    gild = next(d["label"] for d in ledger
                if d["file"] == "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors")
    assert s == f"路线=美宣线·2件 | {turbo}×1 → {gild}×0.55"


def test_route_disclosure_unregistered_file_falls_back_to_stem():
    """台账外真实加载件(手动区接线)按文件名 stem 披露,不丢件。"""
    from engines.comfyui.my_nodes.nodes import my_daojie_route as mod

    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {}},
        "2": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "lora_name": "手动区/未登记件_v9.safetensors", "strength_model": 0.8, "model": ["1", 0]}},
        "9": {"class_type": "MyDaojieRoute", "inputs": {"base": "道具", "道具": ["2", 0]}},
    }
    s = mod._line_disclosure("道具", mod._walk_applied(prompt, "9", "道具"))
    assert s == "路线=道具线·1件 | 未登记件_v9×0.8"


def test_route_disclosure_zero_when_whole_line_bypassed():
    """全线旁路=0 件是真实态(直连底模),不是失败退回。"""
    from engines.comfyui.my_nodes.nodes import my_daojie_route as mod

    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {}},
        "9": {"class_type": "MyDaojieRoute", "inputs": {"base": "人物", "人物": ["1", 0]}},
    }
    assert mod._walk_applied(prompt, "9", "人物") == []
    assert mod._line_disclosure("人物", []) == "路线=人物线·0件(全旁路,直连底模)"


def test_route_without_prompt_keeps_ledger_disclosure():
    """无 hidden 注入(旧路径/离线调用)=原台账口径,永不阻断。"""
    from engines.comfyui.my_nodes.nodes import my_daojie_route as mod

    assert mod._walk_applied(None, None, "人物") is None
    model, applied = mod.MyDaojieRoute().route("人物", 人物="M")
    assert model == "M" and applied.startswith("路线=人物线·")
