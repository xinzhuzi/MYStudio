#!/usr/bin/env python3
"""qwen21-daojie-t2i 桥契约模板生成器(1010 二版)。

用户令:渠道必须跑 qi21-道劫-t2i.json 工作流本体(「目前就是用它来跑才对」,
工作流本体直跑宪法)。从该画布按 fire(qi21_t2i_workflow_fire,9c64dccd)的
展平逻辑生成桥契约模板,并吸收 fire 之后的新增结构:
- detail-fix 双 LoRA:7027(×0.5)挂 viggle 段A(ViggleTurboLora 前),
  7026(×1.0)仅喂直出 KSampler 支路(未选=懒排除);段B(7022)用裸底模;
- seed 单源=PrimitiveInt(7:7014),扇出 RandomNoise/KSampler/FunAcc(后两者未选);
- 双产物:SaveImage(8) 基础图 + SeedVR2 链(501/502/503→504 MYStudio-2K);
- ApiPE 双链回落现值原样保留(Win9B→Mac27B coder390);
- 型=画布现值(当前「人物」);档=画布现值(当前「2 · viggle」9步双段),
  未选支路(FunAcc/直出)懒排除;σ表取宿主面板现值;
- 绑定:prompt→[400]主体句 / negative_prompt→[404] / seed→[7:7014];
  宽高不绑(九型画幅制,4018 手动=0 透传)。

用法:python3 qwen21_bridge_template_build.py [--validate](直发引擎实弹验图)
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CANVAS = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
OUT = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-daojie-t2i.json"
ENGINE = "http://127.0.0.1:17001"

SG6 = "96937bbe-99d1-4f16-a06c-d86b57815d91"
SG7 = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"


def build_graph() -> tuple[dict, dict]:
    wf = json.loads(CANVAS.read_text(encoding="utf-8"))
    root = {n["id"]: n for n in wf["nodes"]}
    sgs = {sg["id"]: sg for sg in wf["definitions"]["subgraphs"]}
    n6 = {n["id"]: n for n in sgs[SG6]["nodes"]}
    n7 = {n["id"]: n for n in sgs[SG7]["nodes"]}

    host6, host7 = root[6], root[7]
    base_type = host6["widgets_values"][0]
    speed = host7["widgets_values"][0]
    sigma_str = host7["widgets_values"][2]
    if "viggle" not in speed:
        raise SystemExit(f"[qwen21-tpl] 画布档位={speed!r} 非 viggle——生成器只支持 viggle 档(产线现档)")

    split_step = n7[7021]["widgets_values"][0]
    fix_viggle = n7[7027]  # ×0.5 → viggle 段A(7027 实验终裁:留链 0.5)
    fix_direct = n7[7026]  # ×1.0 → 直出支路(未选=懒排除,随档位校验保留现值不接线)

    pe_wv = n6[4013]["widgets_values"]
    g = {
        # ── 装配子图[6](现值原样,型=画布现选) ──
        "6:4010": {"class_type": "MyQi21DaojieBase", "inputs": {"base": base_type, "透明覆盖": n6[4010]["widgets_values"][1]}},
        "6:4013": {"class_type": "MyQi21ApiPE", "inputs": {
            "api_url": pe_wv[0], "model": pe_wv[1], "temperature": pe_wv[2],
            "max_tokens": pe_wv[3], "timeout_sec": pe_wv[4], "thinking_effort": pe_wv[5],
            "正向提示词": ["400", 0], "负向提示词": ["404", 0],
            "类型句正向": ["6:4010", 0], "类型句负向": ["6:4010", 3],
            "画幅宽": ["6:4010", 1], "画幅高": ["6:4010", 2], "透明模式": ["6:4010", 4],
            "系统提示词": ["6:4030", 0], "色卡": ["6:4031", 0],
            "美术风格底座-正向": ["6:4032", 0], "美术风格底座-负向": ["6:4032", 1],
        }},
        "6:4014": {"class_type": "MyQi21FinalOutput", "inputs": {
            "正向提示词": ["6:4013", 0], "负向提示词": ["6:4013", 1], "透明模式": ["6:4013", 2]}},
        "6:4030": {"class_type": "MyQi21系统提示词", "inputs": {"内容": n6[4030]["widgets_values"][0]}},
        "6:4031": {"class_type": "MyQi21色卡", "inputs": {"内容": n6[4031]["widgets_values"][0]}},
        "6:4032": {"class_type": "MyQi21美术风格底座", "inputs": {
            "风格工艺件": n6[4032]["widgets_values"][0], "底色背景件": n6[4032]["widgets_values"][1],
            "透明承载件": n6[4032]["widgets_values"][2], "负向词表": n6[4032]["widgets_values"][3]}},
        # ── 根图加载器/输入 ──
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": root[1]["widgets_values"][0], "weight_dtype": root[1]["widgets_values"][1]}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": root[2]["widgets_values"][0], "type": root[2]["widgets_values"][1], "device": root[2]["widgets_values"][2]}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": root[3]["widgets_values"][0]}},
        "400": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": root[400]["widgets_values"][0]}},
        "404": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": root[404]["widgets_values"][0]}},
        "401": {"class_type": "MyQi21PromptPreview", "inputs": {"正向提示词": ["6:4014", 0], "负向提示词": ["6:4014", 1]}},
        "4015": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "prompt": ["6:4014", 0], "negative_prompt": "", "resolution": root[4015]["widgets_values"][2], "clip": ["2", 0]}},
        "4016": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "prompt": ["6:4014", 1], "negative_prompt": "", "resolution": root[4016]["widgets_values"][2], "clip": ["2", 0]}},
        "4018": {"class_type": "MyQi21WhSuggest", "inputs": {
            "九型WIDTH": ["6:4013", 3], "九型HEIGHT": ["6:4013", 4],
            "手动宽": root[4018]["widgets_values"][2], "手动高": root[4018]["widgets_values"][3]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": ["4018", 0], "height": ["4018", 1], "batch_size": root[4]["widgets_values"][2]}},
        # ── 加速子图[7] viggle 9步双段(现档) ──
        "7:7014": {"class_type": "PrimitiveInt", "inputs": {"value": 0}},
        "7:7027": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": ["1", 0], "lora_name": fix_viggle["widgets_values"][0], "strength_model": fix_viggle["widgets_values"][1]}},
        "7:7011": {"class_type": "ViggleTurboLora", "inputs": {
            "model": ["7:7027", 0], "lora_name": n7[7011]["widgets_values"][0], "strength": n7[7011]["widgets_values"][1]}},  # ViggleTurboLora 的强度槽实名 strength(object_info 已验)
        "7:7017": {"class_type": "RandomNoise", "inputs": {"noise_seed": ["7:7014", 0]}},
        "7:7018": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": n7[7018]["widgets_values"][0]}},
        "7:7019": {"class_type": "BasicGuider", "inputs": {"model": ["7:7011", 0], "conditioning": ["4015", 0]}},
        "7:7020": {"class_type": "ViggleTurboSigmas", "inputs": {"latent": ["4", 0], "nodes": sigma_str}},
        "7:7021": {"class_type": "SplitSigmas", "inputs": {"sigmas": ["7:7020", 0], "step": split_step}},
        "7:7012": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["7:7017", 0], "guider": ["7:7019", 0], "sampler": ["7:7018", 0],
            "sigmas": ["7:7021", 0], "latent_image": ["4", 0]}},
        "7:7022": {"class_type": "BasicGuider", "inputs": {"model": ["1", 0], "conditioning": ["4015", 0]}},
        "7:7023": {"class_type": "DisableNoise", "inputs": {}},
        "7:7024": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["7:7023", 0], "guider": ["7:7022", 0], "sampler": ["7:7018", 0],
            "sigmas": ["7:7021", 1], "latent_image": ["7:7012", 0]}},
        "7:7015": {"class_type": "MyQi21SpeedSelect", "inputs": {
            "mode": speed, "latent_viggle": ["7:7024", 0]}},
        # ── 解码与双产物 ──
        "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7:7015", 0], "vae": ["3", 0]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": root[8]["widgets_values"][0]}},
        "501": {"class_type": "SeedVR2LoadDiTModel", "inputs": _widgetize(root[501])},
        "502": {"class_type": "SeedVR2LoadVAEModel", "inputs": _widgetize(root[502])},
        "503": {"class_type": "SeedVR2VideoUpscaler", "inputs": {
            **_widgetize(root[503]), "image": ["5", 0],
            "dit": ["501", 0], "vae": ["502", 0]}},
        "504": {"class_type": "SaveImage", "inputs": {"images": ["503", 0], "filename_prefix": root[504]["widgets_values"][0]}},
    }
    meta = {"型": base_type, "档": speed, "σ表": sigma_str, "split_step": split_step,
            "fix_viggle": fix_viggle["widgets_values"][:2], "fix_direct_未接线": fix_direct["widgets_values"][:2]}
    return g, meta


def _widgetize(node: dict) -> dict:
    """SeedVR2 系节点 widget 名由 object_info 定,生成期在 main() 里按序回填。"""
    return {"__WIDGETS__": node["widgets_values"], "__NODE_TYPE__": node["type"]}


def resolve_widgets(graph: dict) -> dict:
    """把带 __WIDGETS__ 占位的节点按 object_info widget 序展开成实名输入。

    画布序列化两条坑:①seed 类 INT 控件后跟 'fixed'/'randomize' 等伪控件串
    (API 形不存在,跳过);②尾随默认值 widget 不落盘(值尽即停,缺的留给引擎默认)。
    """
    controls = {"fixed", "randomize", "increment", "decrement"}
    for key, node in list(graph.items()):
        payload = node["inputs"].pop("__WIDGETS__", None)
        cls = node["inputs"].pop("__NODE_TYPE__", None)
        if payload is None:
            continue
        order = _widget_order(cls)
        values = list(payload)
        idx = 0
        for name in order:
            existing = node["inputs"].get(name)
            if isinstance(existing, list):
                continue  # 该口已接连线:不消费画布 widget 值,保留连线
            if idx >= len(values):
                break
            value = values[idx]
            if isinstance(value, str) and value in controls:
                idx += 1
                if idx >= len(values):
                    break
                value = values[idx]
            node["inputs"][name] = value
            idx += 1
        if idx < len(values):
            raise SystemExit(f"[qwen21-tpl] {cls} 多余 widget 值未消费: {values[idx:]}")
    return graph


def _widget_order(cls: str) -> list[str]:
    url = f"{ENGINE}/object_info/{urllib.parse.quote(cls)}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        info = json.load(resp)[cls]
    out = []
    for group in ("required", "optional"):
        for name, spec in info["input"].get(group, {}).items():
            extra = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
            if not extra.get("forceInput"):
                out.append(name)
    return out


TEMPLATE = {
    "schemaVersion": 1,
    "name": "qwen21_daojie_t2i",
    "comfyuiVersionMin": "0.3.45",
    "inputs": {
        "prompt": {"node": "400", "field": "value", "class_type": "PrimitiveStringMultiline"},
        "negative_prompt": {"node": "404", "field": "value", "class_type": "PrimitiveStringMultiline"},
        "seed": {"node": "7:7014", "field": "value", "class_type": "PrimitiveInt"},
    },
}


def check_object_info(graph: dict) -> None:
    for node in graph.values():
        cls = node["class_type"]
        url = f"{ENGINE}/object_info/{urllib.parse.quote(cls)}"
        with urllib.request.urlopen(url, timeout=10) as resp:
            info = json.load(resp)[cls]
        known = set()
        for group in ("required", "optional"):
            known.update(info["input"].get(group, {}).keys())
        bad = [k for k in node["inputs"] if k not in known]
        if bad:
            raise SystemExit(f"[qwen21-tpl] {cls} 输入名对不上 object_info: {bad}")


def validate_live(graph: dict) -> None:
    graph = json.loads(json.dumps(graph))
    graph["7:7014"]["inputs"]["value"] = random.randint(1, 2**31 - 1)
    req = urllib.request.Request(
        f"{ENGINE}/prompt",
        data=json.dumps({"prompt": graph, "client_id": "qwen21-tpl-build"}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"[qwen21-tpl] 引擎拒单: {exc.read().decode()[:800]}")
    print(f"[qwen21-tpl] queued {pid}, polling …")
    t0 = time.time()
    while time.time() - t0 < 900:
        time.sleep(10)
        with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=10) as r:
            hist = json.load(r)
        entry = hist.get(pid)
        if not entry:
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            raise SystemExit(f"[qwen21-tpl] 执行失败: {str(status.get('messages'))[:800]}")
        outs = entry.get("outputs", {})
        for node_id in ("504", "8"):
            for out in outs.get(node_id, {}).get("images", []):
                print(f"[qwen21-tpl] 实弹出图 OK(node {node_id}): {out['filename']} ({time.time()-t0:.0f}s)")
                return
        if status.get("status_str") == "success":
            raise SystemExit(f"[qwen21-tpl] 成功但双 SaveImage 均无产物: {str(outs)[:300]}")
    raise SystemExit("[qwen21-tpl] 900s 超时无产物")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate", action="store_true", help="生成后直发引擎实弹验图")
    args = ap.parse_args()
    graph, meta = build_graph()
    graph = resolve_widgets(graph)
    check_object_info(graph)
    template = {**TEMPLATE, "graph": graph}
    OUT.write_text(json.dumps(template, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[qwen21-tpl] 模板已写入 {OUT.relative_to(REPO)}")
    print(f"[qwen21-tpl] 画布现态: {json.dumps(meta, ensure_ascii=False)}")
    if args.validate:
        validate_live(json.loads(json.dumps(template["graph"])))


if __name__ == "__main__":
    main()
