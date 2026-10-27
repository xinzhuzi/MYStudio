#!/usr/bin/env python3
"""H3 单镜模板 API 化(PRD 10-27-storyboard-h3-dual-channel §5.1 一期 + §14.1.2 二期 multiseg 适配;幂等可重跑)。

三种用法:
  ① 缺省(或 --preset i2v31):旧行为零变(h3-shot-template.json → h3-shot-template.api.json,
     UI 31/API 27)。二期幂等红线(§14.1.2):参数化后重跑须与既有产物逐字节一致。
  ② --preset multiseg:读 repo 原 UI 件 h3-autocontext-multiseg.json → 四针内存适配
     (§14.1.1:加 MyShot 锚 103/加首帧锚 9 LoadImage→101.first_frame/五段前缀占位/
     双旁路出厂 mode=4;repo 原件零改)→ 写适配 UI 件 h3-multiseg-template.json →
     object_info 键序转换 → 产 h3-multiseg-template.api.json(12+2=14 节点)。
  ③ FastH3 通道(10-27 windows-fasth3-mainline W3 参数化):--src/--dst/--ui-count/--api-count
     指到 repo 库 fasth3-单镜视频-i2v.json → 前端 fasth3-shot-template.api.json(27/23)。
     与 --preset 互斥。

object_info 键序来源(三级,前者优先;仅 --preset 两态享第三级回落):
  1. --object-info-file <path> 引擎 /object_info JSON dump(如 tests/fixtures/fasth3_object_info_snapshot.json);
  2. 引擎在驾 http://127.0.0.1:17001/object_info 直取;
  3. 引擎不在驾 → 离线键序 fixture h3_object_info_order_1027.json(键序真源与正确性判据见该件
     _provenance;i2v31 预设对其实锚产物的逐字节 diff 即其回归锁)。

转换算法照 apps/output/bili_h3_unlimited_segments_1025/canvas2api_fire.py:
object_info required+optional 键序;连接口 link 回溯,widget 口依序消费 widgets_values。
该参考件面向旧前端格式(widgets 不进 inputs 数组);h3-shot-template.json 是引擎 0.42
新前端格式,三处适配(引擎源码 comfy_api/latest/_io.py get_finalized_class_inputs 口径实钉):
1. 新格式 inputs 数组含 widget 口条目(link=None 且带 widget 键)——原算法 `lid is None: continue`
   会把这类口整字段丢弃(如 14.value/9.image),改为:带 widget 键且未连线 → 依序消费 widgets_values;
   无 widget 键且未连线(如 16.last_frame/23.values.b 这类 optional 连接口)→ 跳过不消费。
2. link 化的 widget 口(如 16.prompt/16.width/16.height/16.length/17.preview_frames,既带 widget 键又带 link)
   在 widgets_values 留鬼影槽位——走 link 回溯时 widx 照 +1 跳过鬼影槽,后续 widget 对齐不错位。
3. 分组口(autogrow,如 ComfyMathExpression 的 values → values.a/values.b)API 键=平铺成员名,
   从节点 inputs 条目按分组前缀展开。
4. 动态组合组(COMFY_DYNAMICCOMBO_V3,如 BlockSparseAttention.selection / SaveVideo.format):object_info
   required 只列组名,成员键(如 selection.keep_percent)不在平铺键序里;裸消费路径(widgets 不进
   inputs 数组)按组值选中 option 后展开其 inputs.required 成员为 `<组名>.<成员>` 依序消费
   (canvas 已有同名前缀条目的路径不受影响,仍走条目分支——SaveVideo.format/format.codec 惯例即此,
   与旧线实弹口径一致)。旧行为零变:旧模板类无动态组合组裸消费路径。
另:MarkdownNote 等 UI 专属节点不在 object_info,跳过(i2v31:UI 31−4 note=API 27;multiseg 12+2=14)。

MyShot 直连 SaveVideo(4) 的 video 口在模板里未连(组装器 connectVideoWriteback 组装时补),
本脚本先在画布数据上做同源补连再转换,api.json 出厂即含 video=["4",0](回收链硬校验依赖;
i2v31 锚=100,multiseg 适配锚=103)。

产物校验(§5.1 三层之前两层,第③层 480P 实弹归 P3/§14.4.3 候令清单):
① API 节点数 = --api-count / 预设钉数;
② 锚字段语义:i2v31=14.value str / 20.value number / 9.image str / 4.filename_prefix str /
   16.width+16.height 在位 / 100 class_type=MyShot 且 video=["4",0] / 16.prompt=["14",0] /
   16.first_frame=["9",0] / 16.length=["23",1];
   multiseg=100.long_prompt str / 100.width+height number(960×544) / 100.clip_tag=段1 / 100.fps=24 /
   4.filename_prefix 五段占位 / 9.image str / 103 MyShot video=["4",0] / 101.first_frame=["9",0] /
   101.parameter=["100",0](§14.1.2 ②)。

用法:
    cd apps && uv run python build/scripts/h3_template_to_api_1027.py --preset i2v31
    cd apps && uv run python build/scripts/h3_template_to_api_1027.py --preset multiseg
    cd apps && uv run python build/scripts/h3_template_to_api_1027.py \
        --src backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-i2v.json \
        --dst frontend/lib/assist/image-studio/fasth3-shot-template.api.json \
        --ui-count 27 --api-count 23 \
        --object-info-file backend/comfyui/tests/fixtures/fasth3_object_info_snapshot.json
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
import urllib.request
from pathlib import Path

ENGINE_OBJECT_INFO = "http://127.0.0.1:17001/object_info"
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SRC = REPO_ROOT / "apps/frontend/lib/assist/image-studio/h3-shot-template.json"
DEFAULT_DST = REPO_ROOT / "apps/frontend/lib/assist/image-studio/h3-shot-template.api.json"
MULTISEG_REPO_SRC = REPO_ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/1_分段视频/h3-autocontext-multiseg.json"
MULTISEG_UI_DST = REPO_ROOT / "apps/frontend/lib/assist/image-studio/h3-multiseg-template.json"
MULTISEG_API_DST = REPO_ROOT / "apps/frontend/lib/assist/image-studio/h3-multiseg-template.api.json"
OFFLINE_ORDER_FIXTURE = Path(__file__).resolve().parent / "h3_object_info_order_1027.json"

DEFAULT_UI_NODE_COUNT = 31
DEFAULT_API_NODE_COUNT = 27  # 31 − 4 MarkdownNote(31/32/47/101,UI 专属)
MULTISEG_EXPECTED_UI_NODE_COUNT = 14  # repo 12 + 适配新增 9 LoadImage + 103 MyShot
MULTISEG_EXPECTED_API_NODE_COUNT = 14  # 无 note 类,UI 节点全进 API(API 格式无 mode,9/103 恒含)
# multiseg 适配出厂占位(§14.1.1 针1/针3;占位 shot_id/前缀过 MyShot 五段校验,M6)
MULTISEG_PLACEHOLDER_PREFIX = "video/漫影/chapter-001/shot-001/ambient"
# repo 原件 12 节点面(§14.1.1 实读钉;适配前校验,漂移即停)
MULTISEG_REPO_NODE_IDS = {34, 41, 21, 7, 13, 100, 101, 6, 2, 102, 36, 4}


def fetch_object_info() -> dict:
    with urllib.request.urlopen(ENGINE_OBJECT_INFO, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"), strict=False)


def load_offline_order_fixture() -> dict:
    raw = json.loads(OFFLINE_ORDER_FIXTURE.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def load_object_info(object_info_file: Path | None, allow_fixture: bool) -> tuple[dict, str]:
    """三级来源:--object-info-file → 引擎直取 → 离线键序 fixture(仅预设两态回落)。"""
    if object_info_file is not None:
        return json.loads(object_info_file.read_text(encoding="utf-8")), f"--object-info-file {object_info_file.name}"
    try:
        return fetch_object_info(), "引擎直取 http://127.0.0.1:17001/object_info"
    except Exception as exc:  # noqa: BLE001 - 探活失败即回落,任何异常形态同待遇
        if not allow_fixture:
            raise
        print(f"[warn] 引擎不在驾({exc});回落离线键序 fixture {OFFLINE_ORDER_FIXTURE.name}"
              "(i2v31 预设对既有实锚产物的逐字节 diff 即其正确性判据)")
        return load_offline_order_fixture(), f"离线键序 fixture {OFFLINE_ORDER_FIXTURE.name}"


def connect_video_writeback(canvas: dict, anchor_id: int = 100) -> int:
    """与 h3-shot-video-workflow.ts connectVideoWriteback 同源:SaveVideo(4) 出 0 口 → MyShot video 口。
    返回新连线 id(i2v31 锚=100;multiseg 适配锚=103)。
    旧格式存档的 SaveVideo 常无 outputs 条目(multiseg repo 件实况)——按 links 数组
    回建出口条目再挂新连线,画布语义与转换均不受影响。"""
    nodes = {n["id"]: n for n in canvas["nodes"]}
    save, anchor = nodes[4], nodes[anchor_id]
    if any(i.get("name") == "video" for i in anchor.get("inputs") or []):
        return int(canvas.get("last_link_id") or 0)
    links = canvas.setdefault("links", [])
    next_link_id = max([int(canvas.get("last_link_id") or 0)] + [int(l[0]) for l in links]) + 1
    links.append([next_link_id, 4, 0, anchor_id, 0, "VIDEO"])
    if not save.get("outputs"):
        existing = [int(l[0]) for l in links if l[1] == 4 and l[2] == 0 and int(l[0]) != next_link_id]
        save["outputs"] = [{"name": "video", "type": "VIDEO", "links": existing}]
    out = save["outputs"][0]
    out["links"] = [*(out.get("links") or []), next_link_id]
    anchor["inputs"] = [{"name": "video", "type": "VIDEO", "link": next_link_id}, *(anchor.get("inputs") or [])]
    canvas["last_link_id"] = next_link_id
    return next_link_id


def _multiseg_pin_nodes() -> tuple[dict, dict]:
    """针1/针2 节点形状复用 h3-shot-template.json 的 100 号 MyShot 与 9 号 LoadImage(§14.1.1)。"""
    source = json.loads(DEFAULT_SRC.read_text(encoding="utf-8"))
    anchor = copy.deepcopy(next(n for n in source["nodes"] if n["id"] == 100))
    anchor.update({"id": 103, "order": 103, "pos": [2660, 320], "mode": 4,
                   "widgets_values": ["shot-001", "S01", "multiseg 批量适配占位", "图✓"]})
    first_frame = copy.deepcopy(next(n for n in source["nodes"] if n["id"] == 9))
    first_frame.update({"id": 9, "order": 9, "pos": [1180, 560], "mode": 4})
    first_frame["outputs"][0]["links"] = []  # 原件指回 i2v 模板连线,重置后由针2 接 multiseg 连线
    return anchor, first_frame


def adapt_multiseg(canvas: dict) -> dict:
    """四针内存适配(§14.1.1;repo 原件零改,适配仅落在内存/产物件)。"""
    nodes = {n["id"]: n for n in canvas["nodes"]}
    if set(nodes) != MULTISEG_REPO_NODE_IDS:
        raise SystemExit(f"multiseg repo template drift: 节点面不符,实为 {sorted(nodes)}")
    links = canvas.setdefault("links", [])
    next_link = max(int(l[0]) for l in links) + 1

    # 针2:加首帧锚 9 LoadImage → 101.first_frame(按 name 匹配追加输入条目,禁按序号硬编码)
    anchor, first_frame = _multiseg_pin_nodes()
    canvas["nodes"] = [*canvas["nodes"], first_frame, anchor]
    sampler = nodes[101]
    if any(i.get("name") == "first_frame" for i in sampler.get("inputs") or []):
        raise SystemExit("multiseg adapt drift: 101.first_frame 已存在(repo 原件已变?)")
    sampler["inputs"] = [*sampler.get("inputs", []), {"name": "first_frame", "type": "IMAGE", "link": next_link}]
    first_frame["outputs"][0]["links"] = [next_link]
    links.append([next_link, 9, 0, 101, len(sampler["inputs"]) - 1, "IMAGE"])
    first_frame_link = next_link

    # 针1:加 MyShot 锚 103 ← SaveVideo(4) 出 0 口(connectVideoWriteback 同款形态)
    video_link = connect_video_writeback(canvas, anchor_id=103)

    # 针3:五段前缀默认(占位值过 MyShot 五段校验;真实值组装器逐镜注入)
    nodes[4]["widgets_values"][0] = MULTISEG_PLACEHOLDER_PREFIX

    # 针4:双旁路出厂已随针1/针2 节点形状落(mode=4;组装器注入时激活 mode=0)
    canvas["last_node_id"] = 103
    if first_frame_link != 15 or video_link != 16:
        raise SystemExit(f"multiseg adapt drift: 适配连线号漂移(first_frame={first_frame_link}/video={video_link},PRD §14.1.1 钉 15/16)")
    return canvas


def assert_multiseg_ui(canvas: dict) -> None:
    """multiseg 适配 UI 件校验(§14.1.1 四针;repo 原件研究路=P3-5 回归保护,零改由脚本只读 repo 件保证)。"""
    nodes = {n["id"]: n for n in canvas["nodes"]}
    if len(nodes) != MULTISEG_EXPECTED_UI_NODE_COUNT:
        raise SystemExit(f"multiseg UI contract: {len(nodes)} nodes != {MULTISEG_EXPECTED_UI_NODE_COUNT}")
    if nodes[9]["type"] != "LoadImage" or nodes[9]["mode"] != 4:
        raise SystemExit("multiseg UI contract: 节点 9 须为旁路(mode=4)LoadImage")
    if nodes[103]["type"] != "MyShot" or nodes[103]["mode"] != 4:
        raise SystemExit("multiseg UI contract: 节点 103 须为旁路(mode=4)MyShot")
    if nodes[103]["widgets_values"][:2] != ["shot-001", "S01"]:
        raise SystemExit("multiseg UI contract: 103 占位 shot_id/label 坏")
    if nodes[4]["widgets_values"][0] != MULTISEG_PLACEHOLDER_PREFIX:
        raise SystemExit("multiseg UI contract: 4.filename_prefix 五段占位坏")
    if {i["name"]: i["link"] for i in nodes[101]["inputs"]}.get("first_frame") != 15:
        raise SystemExit("multiseg UI contract: 101.first_frame 连线坏(须 link 15←9)")
    if {i["name"]: i["link"] for i in nodes[103]["inputs"]}.get("video") != 16:
        raise SystemExit("multiseg UI contract: 103.video 连线坏(须 link 16←4)")
    if 16 not in (nodes[4]["outputs"][0].get("links") or []):
        raise SystemExit("multiseg UI contract: SaveVideo 出口缺 link 16")
    # 原厂值保真(§14.1.1「其余出厂值全保原厂」):H3Parameter 关键 widget 抽钉
    w = nodes[100]["widgets_values"]
    if not (isinstance(w[0], str) and w[1] == "Clip_Tag" and w[2] == "段1" and w[6] == 960 and w[7] == 544 and w[9] == 24):
        raise SystemExit("multiseg UI contract: H3Parameter 出厂 widget 漂移")


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

    def expand_dynamic_combo(name: str, spec: object) -> None:
        """COMFY_DYNAMICCOMBO_V3 组:组值已消费后,按选中 option 的 inputs.required
        成员依序消费为 `<组名>.<成员>`(object_info 平铺键序不含成员键,canvas 新格式
        也不给成员条目——不展开则后续 widget 整体错位一位;成员有 canvas 条目的路径
        走不到这里,由条目分支处理,旧行为零变)。"""
        if not (isinstance(spec, list) and spec and spec[0] == "COMFY_DYNAMICCOMBO_V3"):
            return
        options = spec[1].get("options", []) if len(spec) > 1 and isinstance(spec[1], dict) else []
        chosen = next((o for o in options if isinstance(o, dict) and o.get("key") == inputs.get(name)), None)
        members = (chosen or {}).get("inputs", {}).get("required", {}) or {}
        for member in members:
            consume_widget(f"{name}.{member}")

    order = list(spec_input.get("required", {}).keys()) + list(spec_input.get("optional", {}).keys())
    for name in order:
        spec = spec_input.get("required", {}).get(name) or spec_input.get("optional", {}).get(name)
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
        expand_dynamic_combo(name, spec)
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


def assert_multiseg_contract(api: dict) -> None:
    """multiseg API 产物锚断言(§14.1.2 ②;第③层实弹归 §14.4.3 候令清单)。"""
    def node(nid: str) -> dict:
        if nid not in api:
            raise SystemExit(f"multiseg api contract: node {nid} missing")
        return api[nid]

    n100, n4, n9, n103, n101 = node("100"), node("4"), node("9"), node("103"), node("101")
    assert n100["class_type"] == "H3Parameter", "100 class_type 坏(须 H3Parameter)"
    assert isinstance(n100["inputs"].get("long_prompt"), str) and n100["inputs"]["long_prompt"], "100.long_prompt 锚坏(须非空 str)"
    for key in ("width", "height"):
        value = n100["inputs"].get(key)
        assert isinstance(value, (int, float)) and not isinstance(value, bool), f"100.{key} 锚坏(须 number)"
    assert n100["inputs"].get("clip_tag") == "段1", "100.clip_tag 锚坏(须 '段1')"
    assert n100["inputs"].get("fps") == 24, "100.fps 锚坏(须 24)"
    assert n4["class_type"] == "SaveVideo" and isinstance(n4["inputs"].get("filename_prefix"), str), "4.filename_prefix 锚坏"
    assert n4["inputs"]["filename_prefix"] == MULTISEG_PLACEHOLDER_PREFIX, "4.filename_prefix 五段占位坏"
    assert n9["class_type"] == "LoadImage" and isinstance(n9["inputs"].get("image"), str), "9.image 锚坏"
    assert n103["class_type"] == "MyShot" and n103["inputs"].get("video") == ["4", 0], "103 MyShot video 直连坏"
    for key in ("shot_id", "label", "description", "media_status"):
        assert key in n103["inputs"], f"103.{key} 缺"
    assert n103["inputs"].get("shot_id") == "shot-001", "103.shot_id 占位坏"
    assert n101["class_type"] == "H3AutoContextSampler", "101 class_type 坏"
    assert n101["inputs"].get("first_frame") == ["9", 0], "101.first_frame 链坏(首帧潜空间锚)"
    assert n101["inputs"].get("parameter") == ["100", 0], "101.parameter 链坏"


def main() -> None:
    parser = argparse.ArgumentParser(description="H3/FastH3 单镜模板 UI→API 化(缺省=旧 h3-shot-template 行为零变)")
    parser.add_argument("--preset", choices=["i2v31", "multiseg"], default=None,
                        help="预设:i2v31=旧行为零变(缺省等价);multiseg=四针适配产双件(§14.1.1/§14.1.2)")
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC, help="UI 模板路径(缺省=旧 h3-shot-template.json;与 --preset 互斥)")
    parser.add_argument("--dst", type=Path, default=DEFAULT_DST, help="API 输出路径(缺省=旧 h3-shot-template.api.json;与 --preset 互斥)")
    parser.add_argument("--ui-count", type=int, default=DEFAULT_UI_NODE_COUNT, help="期望 UI 节点数(缺省 31)")
    parser.add_argument("--api-count", type=int, default=DEFAULT_API_NODE_COUNT, help="期望 API 节点数(缺省 27)")
    parser.add_argument("--object-info-file", type=Path, default=None,
                        help="离线 object_info JSON(如 tests/fixtures/fasth3_object_info_snapshot.json;缺省=在线拉引擎,再缺=预设两态回落键序 fixture)")
    opts = parser.parse_args()
    if opts.preset is not None and (opts.src != DEFAULT_SRC or opts.dst != DEFAULT_DST
                                     or opts.ui_count != DEFAULT_UI_NODE_COUNT or opts.api_count != DEFAULT_API_NODE_COUNT):
        raise SystemExit("--preset 与 --src/--dst/--ui-count/--api-count 互斥(预设自带路径与节点数)")

    if opts.preset == "multiseg":
        oi, source = load_object_info(opts.object_info_file, allow_fixture=True)
        canvas = adapt_multiseg(json.loads(MULTISEG_REPO_SRC.read_text(encoding="utf-8")))
        assert_multiseg_ui(canvas)
        MULTISEG_UI_DST.write_text(json.dumps(canvas, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        api, skipped = convert(canvas, oi)
        if skipped:
            raise SystemExit(f"multiseg api contract: 出现 UI-only 节点(预期零): {skipped}")
        if len(api) != MULTISEG_EXPECTED_API_NODE_COUNT:
            raise SystemExit(f"multiseg api contract: {len(api)} nodes != {MULTISEG_EXPECTED_API_NODE_COUNT}")
        assert_multiseg_contract(api)
        MULTISEG_API_DST.write_text(json.dumps(api, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"OK: {MULTISEG_UI_DST.relative_to(REPO_ROOT)} ({len(canvas['nodes'])} UI nodes, repo 原件零改)")
        print(f"OK: {MULTISEG_API_DST.relative_to(REPO_ROOT)} ({len(api)} nodes)")
        print("anchors: 100.long_prompt(str) 100.width/height(number 960×544) 100.clip_tag=段1 100.fps=24 "
              "4.filename_prefix(五段) 9.image(str) 103.MyShot(video→[4,0]) 101.first_frame→[9,0] 101.parameter→[100,0]")
        print(f"object_info: {source}")
        return

    # 缺省/--preset i2v31/FastH3 通用路径(旧行为零变;i2v31 预设享离线键序回落)
    allow_fixture = opts.preset == "i2v31"
    oi, source = load_object_info(opts.object_info_file, allow_fixture)
    # 相对路径(相对 cwd)与 REPO_ROOT 报告路径对齐:统一 resolve 成绝对路径
    src, dst = opts.src.resolve(), opts.dst.resolve()

    canvas = json.loads(src.read_text(encoding="utf-8"))
    ui_count = len(canvas["nodes"])
    if ui_count != opts.ui_count:
        raise SystemExit(f"template drift: {src.name} UI nodes {ui_count} != {opts.ui_count}")
    connect_video_writeback(canvas, anchor_id=100)
    api, skipped = convert(canvas, oi)
    if len(api) != opts.api_count:
        raise SystemExit(f"api contract: {len(api)} nodes != {opts.api_count} (skipped UI-only: {skipped})")
    assert_contract(api)
    dst.write_text(json.dumps(api, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"OK: {dst.relative_to(REPO_ROOT)} ({len(api)} nodes; src={src.name}; UI-only skipped: {', '.join(skipped)})")
    print("anchors: 14.value(str) 20.value(number) 9.image(str) 4.filename_prefix(str) 16.width/16.height 100.MyShot(video→[4,0])")
    print(f"object_info: {source}")


if __name__ == "__main__":
    sys.exit(main())
