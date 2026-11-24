#!/usr/bin/env python3
"""multiseg 记账界面图生成器(1123 D17;trellis 11-23-h3-selfdev-workflow-fixes)。

产物:frontend/lib/comfyui/h3/templates/h3-multiseg-template.json
  = 画布件 `2_视频/H3视频/1_漫影自研/一镜到底-分段.json` 原样(67 节点;它本身是
    multiseg_inline_facerefine_build_1118.py 的产物)
  + App 专用三节点(#9 首帧图 / #103 收件箱锚 / #800 人脸参考视觉编码器)
  + 四条线(#9→#101 首帧 / #9→#5012 修脸参考图 / #4100→#103 记账 / #800→#5011)
  + API 对齐覆写(5 个控件位:画布件与执行图取值不同处,界面图取执行图值,见 API_ALIGNED)。

为什么要有它:组装器 buildShotH3MultisegApiWorkflow 发车时克隆本件、填参后作
extraPngInfo.workflow 随任务进引擎,也是台账/产物元数据里「这镜跑的是哪张图」的载体。
1123 前它停在 14 节点的一采时代小图,而实际执行图已是 67 节点(一采+二采+三采+修脸),
排障时打开的图与实跑图差 53 个节点(用户批复 D17①:排障时打开的图就是实际执行的图)。

为什么不能直接拿画布件:画布件是给人手动打开的,本来就没有首帧加载与收件箱锚;
这两个是 App 发车专用的,组装器按固定节点号往里填首帧名与记账信息。

幂等:只读画布件与 API 模板两个输入,产物确定;重放零改写=产物即生成器真身。
同步门 backend/comfyui/tests/test_workflow_template_sync.py 的 multiseg-ui 对按此重放
对账(挂 pretest 与 build-mac 打包前门):画布/API 模板改了而本件没跟上=门禁回正+报红点名。

连线纪律(node-graph 技能):三处挂接(links 表 + 源 outputs[].links + 目标 inputs[].link);
可选输入口追加在 inputs 末尾(前面口的槽位号不动);发号器高水位对齐。

用法(仓库根或 apps 下均可):
  python3 build/scripts/multiseg_ui_template_build.py          # 原地重生成(内容相同则不写)
  python3 build/scripts/multiseg_ui_template_build.py --check   # 只对账:落后=exit 1,不写盘
"""
import argparse
import copy
import json
import sys
from pathlib import Path

APPS = Path(__file__).resolve().parents[2]
CANVAS = APPS / "backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/一镜到底-分段.json"
API = APPS / "frontend/lib/comfyui/h3/templates/h3-multiseg-template.api.json"
OUT = APPS / "frontend/lib/comfyui/h3/templates/h3-multiseg-template.json"

# 组装器运行时要填参数的节点号与类型(h3-shot-video-workflow.ts MULTISEG_REQUIRED_NODES + getNode 调用)
FILL_POINTS = {4: "SaveVideo", 9: "LoadImage", 100: "H3Parameter", 101: "H3AutoContextSampler", 103: "MyShot"}
# MyShot 收件箱锚的四个字段(控件序=引擎节点定义序;值取 API 模板同名键)
MYSHOT_FIELDS = ("shot_id", "label", "description", "media_status")
# App 专用节点在新界面图里的位置(写死,保证产物确定)。坐标按下列约束搜出来的空位(1124 视觉复检后定版):
# ① 在各自组框内、不压组框标题带(上缘留 40)② 不压任何画布件节点(间距 30)③ pos≥80 不入负区
# ④ 零左向线(画布件生成器同款契约:来源节点须整个在目标节点左侧)。
# #9 与加载器同类放「① 加载模型」组;#800 须在 #5011 左侧(落 #5002 正下方);#103 须在 #4100 右侧
# (「终档组」组框随之加宽把它罩住,见 GROUP_WIDEN)。
NEW_NODE_POS = {9: [440, 80], 103: [17383, 960], 800: [11300, 1130]}
NODE_SIZE = {9: [290, 330], 103: [360, 300], 800: [340, 58]}
# 需要加宽以罩住 App 专用节点的画布件组框:组框 id → 节点号。界面图里该组框只改宽度,其余组框原样。
GROUP_WIDEN = {17: 103}
# 组框标题带高度(节点上缘不得落在这条带里)
GROUP_TITLE_BAND = 40
# 节点间距/节点与组框内缘的留白
GROUP_PAD = 30
NEW_LINK_COUNT = 4
# 新增连线:(源节点, 源输出口, 目标节点, 目标输入口, 类型);连线号接在画布件高水位之后顺序发
SPECS = [
    (9, 0, 101, "first_frame", "IMAGE"),
    (9, 0, 5012, "ref_images.ref_image_0", "IMAGE"),
    (4100, 0, 103, "video", "VIDEO"),
    (800, 0, 5011, "identity_clip_vision", "CLIP_VISION"),
]
# 画布件没声明、需要追加的可选输入口(追加在 inputs 末尾;shape=7 可选,照画布件同类口的写法)
APPENDED_INPUTS = {
    (101, "first_frame"): {"name": "first_frame", "type": "IMAGE", "shape": 7},
    (5011, "identity_clip_vision"): {"name": "identity_clip_vision", "type": "CLIP_VISION", "shape": 7},
}
# API 对齐覆写:画布件与 API 模板(=App 实际执行的图)在下列控件位上取值不同,各有来历——
# 界面图是「排障时打开的图」,执行的是什么就显示什么,故一律取 API 模板值;画布件本身不动。
#   #5011 画布=0.28/insightface(1118 收尾役有意分策:布线密度无余量,免 CLIPVision 装载器);
#         执行图=0.0/clip_vision(+identity_clip_vision←#800,画布件无此口)
#   #5023/#5025 画布=8/none;执行图=auto/auto(母本 sancai_inline_facerefine_build_1118 两表如此,
#         单镜同款;属产线取值,候用户裁定,本件不改产线)
# 位号=该节点 widgets_values 下标,由真实前端控件清单实证(multiseg_ui_canvas_probe.mjs
# 加载导出后与执行图逐参数对拍钉死;位号错=探针红)。
API_ALIGNED = {  # 节点号: ((控件位, API 输入键), ...)
    5011: ((11, "identity_threshold"), (16, "identity_model")),
    5023: ((1, "bit_depth"), (3, "chroma_subsampling")),
    5025: ((1, "bit_depth"), (3, "chroma_subsampling")),
}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def die(msg: str) -> None:
    print(f"[ABORT] {msg}")
    sys.exit(1)


def app_nodes(api: dict) -> list:
    """App 专用三节点(画布件里没有,内容由本函数定)。#9/#103 出厂旁路 mode=4:
    画布直开不执行占位首帧、不往收件箱写占位记账;组装器发车时置 0 激活。"""
    first_frame_name = api.get("9", {}).get("inputs", {}).get("image")
    if not first_frame_name:
        die("API 模板里没有 #9 LoadImage,或没有 image")
    clip_name = api.get("800", {}).get("inputs", {}).get("clip_name")
    if not clip_name:
        die("API 模板里没有 #800 CLIPVisionLoader,或没有 clip_name")
    anchor_fields = [api.get("103", {}).get("inputs", {}).get(key) for key in MYSHOT_FIELDS]
    if any(value is None for value in anchor_fields):
        die(f"API 模板 #103 MyShot 缺字段: {MYSHOT_FIELDS}")
    return [
        {
            "id": 9, "type": "LoadImage", "pos": list(NEW_NODE_POS[9]), "size": list(NODE_SIZE[9]), "flags": {},
            "mode": 4,
            "inputs": [
                {"localized_name": "图像", "name": "image", "type": "COMBO",
                 "widget": {"name": "image"}, "link": None},
                {"localized_name": "选择文件上传", "name": "upload", "type": "IMAGEUPLOAD",
                 "widget": {"name": "upload"}, "link": None},
            ],
            "outputs": [
                {"localized_name": "图像", "name": "IMAGE", "type": "IMAGE", "links": []},
                {"localized_name": "遮罩", "name": "MASK", "type": "MASK", "links": []},
            ],
            "properties": {
                "Node name for S&R": "LoadImage",
                "ue_properties": {"widget_ue_connectable": {}, "version": "7.8", "input_ue_unconnectable": {}},
                "cnr_id": "comfy-core", "ver": "0.33.2",
            },
            "widgets_values": [first_frame_name, "image"],
            "widgets_values_named": {"image": first_frame_name, "upload": "image"},
        },
        {
            "id": 103, "type": "MyShot", "pos": list(NEW_NODE_POS[103]), "size": list(NODE_SIZE[103]), "flags": {},
            "mode": 4,
            "inputs": [{"name": "video", "type": "VIDEO", "link": None}],
            "outputs": [], "title": "漫影单镜锚卡",
            "properties": {"Node name for S&R": "MyShot", "myPreview": first_frame_name},
            "widgets_values": anchor_fields,
        },
        {
            # 修脸链的人脸参考视觉编码器。形状照仓内现成的 CLIPVisionLoader 画布节点
            # (官方-fisher-pose-无限姿势.json:带完整输入口条目与核心节点属性标识)
            "id": 800, "type": "CLIPVisionLoader", "pos": list(NEW_NODE_POS[800]), "size": list(NODE_SIZE[800]), "flags": {},
            "mode": 0,
            "inputs": [
                {"localized_name": "clip_name", "name": "clip_name", "type": "COMBO",
                 "widget": {"name": "clip_name"}, "link": None},
            ],
            "outputs": [
                {"localized_name": "CLIP_VISION", "name": "CLIP_VISION", "type": "CLIP_VISION", "links": []},
            ],
            "properties": {"cnr_id": "comfy-core", "Node name for S&R": "CLIPVisionLoader"},
            "widgets_values": [clip_name],
        },
    ]


def align_to_api(out: dict, api: dict) -> None:
    """画布件与执行图取值不同的控件位,界面图改取 API 模板值(节点在、位在、键是标量,缺一即停)。"""
    for nid, positions in API_ALIGNED.items():
        node = next((n for n in out["nodes"] if n["id"] == nid), None)
        wv = node.get("widgets_values") if node else None
        if node is None or not isinstance(wv, list):
            die(f"画布件缺 #{nid} 或其 widgets_values,API 对齐覆写无处落")
        for index, key in positions:
            value = api.get(str(nid), {}).get("inputs", {}).get(key)
            if index >= len(wv) or value is None or isinstance(value, list):
                die(f"#{nid} 控件位 {index} 不在,或 API 模板 #{nid}.{key} 不是标量")
            wv[index] = value


def build(canvas: dict, api: dict) -> dict:
    out = copy.deepcopy(canvas)
    align_to_api(out, api)
    for extra in app_nodes(api):
        if any(n["id"] == extra["id"] for n in out["nodes"]):
            die(f"画布件已占用节点号 #{extra['id']},与 App 专用针撞号(须改 App 节点号或画布件)")
        out["nodes"].append(extra)
        extra["order"] = len(out["nodes"]) - 1
    nodes = {n["id"]: n for n in out["nodes"]}

    # 四条线(三处挂接);可选口画布件没声明的,追加在 inputs 末尾
    next_link = max([l[0] for l in out["links"]] + [out.get("last_link_id", 0)]) + 1
    for src, sslot, dst, iname, itype in SPECS:
        d = nodes[dst]
        inp = next((i for i in d.get("inputs", []) if i.get("name") == iname), None)
        if inp is None:
            template = APPENDED_INPUTS.get((dst, iname))
            if template is None:
                die(f"#{dst}({d['type']}) 没有输入口 {iname},也不在可追加清单里")
            d.setdefault("inputs", []).append({**copy.deepcopy(template), "link": None})
            inp = d["inputs"][-1]
        if inp.get("link") is not None:
            die(f"#{dst}.{iname} 已被占用(link {inp['link']})")
        if inp.get("type") != itype:
            die(f"#{dst}.{iname} 类型 {inp.get('type')} != {itype}")
        lid = next_link
        next_link += 1
        slot = d["inputs"].index(inp)
        out["links"].append([lid, src, sslot, dst, slot, itype])
        inp["link"] = lid
        s_out = nodes[src].setdefault("outputs", [])[sslot]
        if s_out.get("links") is None:
            s_out["links"] = []
        s_out["links"].append(lid)

    out["last_node_id"] = max(nodes)
    out["last_link_id"] = max(l[0] for l in out["links"])
    # 组框加宽:落在画布件组框右缘之外的 App 专用节点,把所属组框加宽罩住(只改宽度,位置/标题不动)
    groups_by_id = {g["id"]: g for g in out.get("groups", [])}
    for gid, nid in GROUP_WIDEN.items():
        if gid not in groups_by_id:
            die(f"画布件没有组框 #{gid},无法为 #{nid} 加宽")
        need = nodes[nid]["pos"][0] + nodes[nid]["size"][0] + GROUP_PAD - groups_by_id[gid]["bounding"][0]
        if groups_by_id[gid]["bounding"][2] < need:
            groups_by_id[gid]["bounding"][2] = need
    return out


def verify(new: dict, canvas: dict, api: dict) -> list:
    problems = []
    nodes = {n["id"]: n for n in new["nodes"]}
    link_ids = {l[0] for l in new["links"]}
    # 结构:端点存在 / 三处挂接一致 / 槽位号 / 无孤儿引用
    for l in new["links"]:
        if l[1] not in nodes or l[3] not in nodes:
            problems.append(f"link{l[0]} 端点不存在")
            continue
        dst_in = nodes[l[3]].get("inputs") or []
        if l[4] >= len(dst_in) or dst_in[l[4]].get("link") != l[0]:
            problems.append(f"link{l[0]} 目标槽位号与 inputs[].link 不一致")
        src_links = ((nodes[l[1]].get("outputs") or [])[l[2]:l[2] + 1] or [{}])[0].get("links") or []
        if l[0] not in src_links:
            problems.append(f"link{l[0]} 源输出口未登记")
    for n in new["nodes"]:
        for i in n.get("inputs", []):
            if i.get("link") is not None and i["link"] not in link_ids:
                problems.append(f"#{n['id']}.{i.get('name')} 引用了不存在的 link {i['link']}")
        for o in n.get("outputs", []):
            for lid in o.get("links") or []:
                if lid not in link_ids:
                    problems.append(f"#{n['id']}.{o.get('name')} 输出口登记了不存在的 link {lid}")
    # 画布件存量节点零改动(类型/模式/坐标/参数;输入条目数只许多出追加的可选口;
    # 参数只在 API_ALIGNED 登记的控件位上不同于画布件,且必须等于 API 模板值)
    appended = {dst: sum(1 for (d, _) in APPENDED_INPUTS if d == dst) for dst, _ in APPENDED_INPUTS}
    cn = {n["id"]: n for n in canvas["nodes"]}
    for nid, c_node in cn.items():
        n = nodes.get(nid)
        if n is None:
            problems.append(f"画布件 #{nid} 在新界面图里丢失")
            continue
        if n.get("pos") != c_node.get("pos") or n.get("type") != c_node["type"] \
                or n.get("mode", 0) != c_node.get("mode", 0):
            problems.append(f"画布件 #{nid} 的坐标/类型/模式被改动")
        aligned = {index: key for index, key in API_ALIGNED.get(nid, ())}
        cv, nv = c_node.get("widgets_values") or [], n.get("widgets_values") or []
        if len(cv) != len(nv) or any(nv[i] != v for i, v in enumerate(cv) if i not in aligned):
            problems.append(f"画布件 #{nid} 的参数被改动(API 对齐位之外须与画布件一致)")
        for index, key in aligned.items():
            if index >= len(nv) or nv[index] != api.get(str(nid), {}).get("inputs", {}).get(key):
                problems.append(f"#{nid} 控件位 {index} 未取 API 模板 {key} 的值")
        if len(n.get("inputs", [])) != len(c_node.get("inputs", [])) + appended.get(nid, 0):
            problems.append(f"画布件 #{nid} 输入条目数变了")
    # 画布件原有连线逐条不变(含槽位号);连线总数=画布件+新增
    old_links = {l[0]: l for l in canvas["links"]}
    new_links = {l[0]: l for l in new["links"]}
    for lid, l in old_links.items():
        if new_links.get(lid) != l:
            problems.append(f"画布件原有 link{lid} 被改动")
    if len(new["links"]) != len(canvas["links"]) + NEW_LINK_COUNT:
        problems.append(f"连线数应为画布件 {len(canvas['links'])}+{NEW_LINK_COUNT},实为 {len(new['links'])}")
    # 与 API 模板同源:节点集合 = API 节点 + 画布件专有;API 每个节点类型一致、每条连线都存在
    ak = set(api)
    nk = {str(i) for i in nodes}
    canvas_only = {str(n["id"]) for n in canvas["nodes"]} - ak
    if nk != ak | canvas_only:
        problems.append(f"节点集合不符:多出 {sorted(nk - ak - canvas_only)} / 缺少 {sorted((ak | canvas_only) - nk)}")
    for k, v in api.items():
        if k in nk and nodes[int(k)]["type"] != v["class_type"]:
            problems.append(f"#{k} 类型与 API 模板不一致")
    api_edges = {(str(val[0]), k, name) for k, v in api.items() for name, val in v["inputs"].items()
                 if isinstance(val, list)}
    ui_edges = {(str(l[1]), str(l[3]), nodes[l[3]]["inputs"][l[4]]["name"]) for l in new["links"]}
    missing = api_edges - ui_edges
    if missing:
        problems.append(f"API 模板的连线在界面图里缺失: {sorted(missing)[:6]}")
    # 组装器填参数位齐全;发号器高水位
    for nid, typ in FILL_POINTS.items():
        if nid not in nodes or nodes[nid]["type"] != typ:
            problems.append(f"组装器填参数位 #{nid}({typ}) 缺失或类型不符")
    if new["last_link_id"] < max(link_ids) or new["last_node_id"] < max(nodes):
        problems.append("发号器高水位低于图内最大 id")
    # 新增节点的位置:不压任何节点(间距 GROUP_PAD);落在某个组框内且不压组框标题带;不在负区
    def box(n):
        x, y = n["pos"]
        w, h = n.get("size", [220, 120])
        return (x, y, x + w, y + h)
    def near(a, b):
        return a[0] < b[2] + GROUP_PAD and b[0] < a[2] + GROUP_PAD and a[1] < b[3] + GROUP_PAD and b[1] < a[3] + GROUP_PAD
    for nid in NEW_NODE_POS:
        b = box(nodes[nid])
        others = [k for k, v in nodes.items() if k != nid and near(b, box(v))]
        if others:
            problems.append(f"新增 #{nid} 压到节点 {others}(或间距不足 {GROUP_PAD})")
        covered = any(g["bounding"][0] + GROUP_PAD <= b[0] and b[2] <= g["bounding"][0] + g["bounding"][2] - GROUP_PAD
                      and g["bounding"][1] + GROUP_TITLE_BAND <= b[1] and b[3] <= g["bounding"][1] + g["bounding"][3] - GROUP_PAD
                      for g in new.get("groups", []))
        if not covered:
            problems.append(f"新增 #{nid} 不在任何组框内(或压组框边缘/标题带)")
        if b[0] < 80 or b[1] < 80:
            problems.append(f"新增 #{nid} 落在负区")
    # 零左向线(画布件生成器同款契约):新增连线的来源节点须整个在目标节点左侧
    for src, _, dst, iname, _ in SPECS:
        if nodes[src]["pos"][0] + nodes[src].get("size", [220, 120])[0] >= nodes[dst]["pos"][0]:
            problems.append(f"新增连线 #{src}→#{dst}.{iname} 是左向线(来源须在目标左侧)")
    # 组框:与画布件逐个相同,只有 GROUP_WIDEN 登记的组框只许宽度变大
    cg = {g["id"]: g for g in canvas.get("groups", [])}
    ng = {g["id"]: g for g in new.get("groups", [])}
    if set(cg) != set(ng):
        problems.append("组框集合与画布件不一致")
    for gid, g0 in cg.items():
        g1 = ng.get(gid)
        if g1 is None:
            continue
        diff = {k for k in set(g0) | set(g1) if g0.get(k) != g1.get(k)}
        if gid not in GROUP_WIDEN:
            if diff:
                problems.append(f"组框 #{gid} 被改动:{sorted(diff)}")
            continue
        if diff - {"bounding"}:
            problems.append(f"组框 #{gid} 除宽度外被改动:{sorted(diff - {'bounding'})}")
        b0, b1 = g0["bounding"], g1["bounding"]
        if b1[2] < b0[2] or [b1[0], b1[1], b1[3]] != [b0[0], b0[1], b0[3]]:
            problems.append(f"组框 #{gid} 只许加宽,不许移动/改高")
    return problems


def render(doc: dict) -> str:
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只对账不写盘:产物与盘上不同=exit 1")
    args = ap.parse_args()
    canvas, api = load(CANVAS), load(API)
    new = build(canvas, api)
    problems = verify(new, canvas, api)
    print(f"界面图:{len(new['nodes'])} 节点 / {len(new['links'])} 连线 / {len(new.get('groups', []))} 组框"
          f" = 画布件 {len(canvas['nodes'])} 节点 + App 专用 {len(NEW_NODE_POS)} 节点;"
          f"画布件 {len(canvas['links'])} 连线 + 新增 {NEW_LINK_COUNT} 条;API 对齐覆写 "
          f"{sum(len(p) for p in API_ALIGNED.values())} 个控件位({sorted(API_ALIGNED)})")
    if problems:
        print("[结构复核未过]")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print("[结构复核通过] 画布件存量节点除 API 对齐位外零改动;连线三处挂接一致;与 API 模板节点集合、连线集合一致")
    text = render(new)
    on_disk = OUT.read_text(encoding="utf-8") if OUT.exists() else None
    if on_disk == text:
        print(f"[一致] {OUT.relative_to(APPS)} 即生成器真身")
        sys.exit(0)
    if args.check:
        print(f"[落后] {OUT.relative_to(APPS)} 与生成器产物不同(未写盘;去掉 --check 重生成)")
        sys.exit(1)
    OUT.write_text(text, encoding="utf-8")
    if OUT.read_text(encoding="utf-8") != text:
        die("写后回读与预期不一致")
    print(f"[已重生成并回读一致] {OUT.relative_to(APPS)}")
