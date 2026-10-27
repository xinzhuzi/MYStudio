#!/usr/bin/env python3
"""H3 单镜模板 API 化(PRD 10-27-storyboard-h3-dual-channel §5.1,一次性脚本,幂等可重跑)。

读 UI 模板 apps/frontend/lib/assist/image-studio/h3-shot-template.json →
产 API 格式模板 apps/frontend/lib/assist/image-studio/h3-shot-template.api.json({nodeId: {class_type, inputs}})。

转换算法照 apps/output/bili_h3_unlimited_segments_1025/canvas2api_fire.py:
object_info required+optional 键序;连接口 link 回溯,widget 口依序消费 widgets_values。
该参考件面向旧前端格式(widgets 不进 inputs 数组);本模板是引擎 0.42 新前端格式,
三处适配(引擎源码 comfy_api/latest/_io.py get_finalized_class_inputs 口径实钉):
1. 新格式 inputs 数组含 widget 口条目(link=None 且带 widget 键)——原算法 `lid is None: continue`
   会把这类口整字段丢弃(如 14.value/9.image),改为:带 widget 键且未连线 → 依序消费 widgets_values;
   无 widget 键且未连线(如 16.last_frame/23.values.b 这类 optional 连接口)→ 跳过不消费。
2. link 化的 widget 口(如 16.prompt/16.width/16.height/16.length/17.preview_frames,既带 widget 键又带 link)
   在 widgets_values 留鬼影槽位——走 link 回溯时 widx 照 +1 跳过鬼影槽,后续 widget 对齐不错位。
3. 分组口(autogrow,如 ComfyMathExpression 的 values → values.a/values.b)API 键=平铺成员名,
   从节点 inputs 条目按分组前缀展开。
另:MarkdownNote 等 UI 专属节点不在 object_info,跳过(UI 31 节点 − 4 note = API 27 节点)。

MyShot(100) 直连 SaveVideo(4) 的 video 口在模板里未连(组装器 connectVideoWriteback 组装时补),
本脚本先在画布数据上做同源补连再转换,api.json 出厂即含 100.video=["4",0](回收链硬校验依赖)。

产物校验(§5.1 三层之前两层,第③层 480P 实弹归 P3):
① API 节点数 = 27;
② 锚字段语义:14.value str / 20.value number / 9.image str / 4.filename_prefix str /
   16.width+16.height 在位(出厂=ResolutionSelector link,组装器按档直填覆盖)/ 100 class_type=MyShot
   且 video=["4",0] / 16.prompt=["14",0] / 16.first_frame=["9",0] / 16.length=["23",1]。

用法:cd apps && uv run python build/scripts/h3_template_to_api_1027.py(引擎在驾 http://127.0.0.1:17001)
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ENGINE_OBJECT_INFO = "http://127.0.0.1:17001/object_info"
REPO_ROOT = Path(__file__).resolve().parents[3]
SRC = REPO_ROOT / "apps/frontend/lib/assist/image-studio/h3-shot-template.json"
DST = REPO_ROOT / "apps/frontend/lib/assist/image-studio/h3-shot-template.api.json"

EXPECTED_UI_NODE_COUNT = 31
EXPECTED_API_NODE_COUNT = 27  # 31 − 4 MarkdownNote(31/32/47/101,UI 专属)


def fetch_object_info() -> dict:
    with urllib.request.urlopen(ENGINE_OBJECT_INFO, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"), strict=False)


def connect_video_writeback(canvas: dict) -> None:
    """与 h3-shot-video-workflow.ts connectVideoWriteback 同源:SaveVideo(4) 出 0 口 → MyShot(100) video 口。"""
    nodes = {n["id"]: n for n in canvas["nodes"]}
    save, anchor = nodes[4], nodes[100]
    if any(i.get("name") == "video" for i in anchor.get("inputs") or []):
        return
    links = canvas.setdefault("links", [])
    next_link_id = max([int(canvas.get("last_link_id") or 0)] + [int(l[0]) for l in links]) + 1
    links.append([next_link_id, 4, 0, 100, 0, "VIDEO"])
    out = save["outputs"][0]
    out["links"] = [*(out.get("links") or []), next_link_id]
    anchor["inputs"] = [{"name": "video", "type": "VIDEO", "link": next_link_id}, *(anchor.get("inputs") or [])]
    canvas["last_link_id"] = next_link_id


def convert_node(node: dict, spec_input: dict, link_map: dict) -> dict:
    """单节点 UI→API:object_info required+optional 键序;连接口 link 回溯,widget 口依序消费 widgets_values。"""
    entries = {i["name"]: i for i in node.get("inputs") or []}
    widgets = node.get("widgets_values") or []
    inputs: dict[str, object] = {}
    widx = 0

    def resolve_link(entry: dict) -> None:
        src_node, src_slot = link_map[entry["link"]]
        inputs[entry["name"]] = [str(src_node), src_slot]

    def consume_widget(name: str) -> None:
        nonlocal widx
        if widx < len(widgets):
            inputs[name] = widgets[widx]
            widx += 1

    order = list(spec_input.get("required", {}).keys()) + list(spec_input.get("optional", {}).keys())
    for name in order:
        entry = entries.get(name)
        if entry is not None:
            if entry.get("link") is not None:
                resolve_link(entry)
                if "widget" in entry:
                    widx += 1  # link 化 widget 的鬼影槽位
            elif "widget" in entry:
                consume_widget(name)
            # 无 widget 键且未连线 = optional 连接口缺省 → 跳过
            continue
        members = [e for n, e in entries.items() if n.startswith(name + ".")]
        if members:
            for member in members:  # 分组口(autogrow)按平铺成员名展开
                if member.get("link") is not None:
                    resolve_link(member)
                elif "widget" in member:
                    consume_widget(member["name"])
            continue
        consume_widget(name)  # 旧格式:widget 不进 inputs 数组,依序消费
    return {"class_type": node["type"], "inputs": inputs}


def convert(canvas: dict, oi: dict) -> tuple[dict, list[str]]:
    link_map = {l[0]: (l[1], l[2]) for l in canvas["links"]}
    api: dict[str, dict] = {}
    skipped: list[str] = []
    for node in canvas["nodes"]:
        ct = node["type"]
        if ct not in oi:
            skipped.append(f'{node["id"]}:{ct}')
            continue
        api[str(node["id"])] = convert_node(node, oi[ct]["input"], link_map)
    return dict(sorted(api.items(), key=lambda kv: int(kv[0]))), skipped


def assert_contract(api: dict) -> None:
    def node(nid: str) -> dict:
        if nid not in api:
            raise SystemExit(f"api contract: node {nid} missing")
        return api[nid]

    n14, n20, n9, n4, n16, n100 = node("14"), node("20"), node("9"), node("4"), node("16"), node("100")
    assert n14["class_type"] == "PrimitiveStringMultiline" and isinstance(n14["inputs"].get("value"), str) and n14["inputs"]["value"], "14.value 锚坏"
    assert n20["class_type"] == "PrimitiveFloat" and isinstance(n20["inputs"].get("value"), (int, float)) and not isinstance(n20["inputs"]["value"], bool), "20.value 锚坏(须 number)"
    assert n9["class_type"] == "LoadImage" and isinstance(n9["inputs"].get("image"), str), "9.image 锚坏"
    assert n4["class_type"] == "SaveVideo" and isinstance(n4["inputs"].get("filename_prefix"), str), "4.filename_prefix 锚坏"
    assert n16["class_type"] == "MiniMaxH3ImageToVideo", "16 class_type 坏"
    assert n16["inputs"].get("prompt") == ["14", 0], "16.prompt 链坏"
    assert n16["inputs"].get("first_frame") == ["9", 0], "16.first_frame 链坏"
    assert n16["inputs"].get("length") == ["23", 1], "16.length 链坏"
    assert "width" in n16["inputs"] and "height" in n16["inputs"], "16.width/height 锚缺"
    assert n100["class_type"] == "MyShot" and n100["inputs"].get("video") == ["4", 0], "100 MyShot video 直连坏"
    for key in ("shot_id", "label", "description", "media_status"):
        assert key in n100["inputs"], f"100.{key} 缺"


def main() -> None:
    canvas = json.loads(SRC.read_text(encoding="utf-8"))
    ui_count = len(canvas["nodes"])
    if ui_count != EXPECTED_UI_NODE_COUNT:
        raise SystemExit(f"template drift: UI nodes {ui_count} != {EXPECTED_UI_NODE_COUNT}")
    oi = fetch_object_info()
    connect_video_writeback(canvas)
    api, skipped = convert(canvas, oi)
    if len(api) != EXPECTED_API_NODE_COUNT:
        raise SystemExit(f"api contract: {len(api)} nodes != {EXPECTED_API_NODE_COUNT} (skipped UI-only: {skipped})")
    assert_contract(api)
    DST.write_text(json.dumps(api, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"OK: {DST.relative_to(REPO_ROOT)} ({len(api)} nodes; UI-only skipped: {', '.join(skipped)})")
    print("anchors: 14.value(str) 20.value(number) 9.image(str) 4.filename_prefix(str) 16.width/16.height 100.MyShot(video→[4,0])")


if __name__ == "__main__":
    sys.exit(main())
