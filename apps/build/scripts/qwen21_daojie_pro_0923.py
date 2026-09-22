#!/usr/bin/env python3
"""qwen21-daojie-t2i-pro.json 幂等生成器(09-23,道劫规范化装配版)。

模仿 K2 道劫『一处选型+分件装配』思想,用 Q2-1 侧原生节点落地:

  底座区(四选一链)  [17]-[20] StringConstant = 库四类型首条底座全文(现读
                    docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md),
                    [21]→[22]→[23] 三级核心 ComfySwitchNode 级联(全 false=
                    人物首条默认;懒执行,未选底座不进提示词)。
  主体句区(换槽装配)[24] StringConstant 唯一手写位(默认=首条底座 B 槽预置句,
                    内容恒等)→ [26] 核心 RegexReplace(pattern=⟨B:[^⟩]*⟩,
                    整段角括号连括号替换=库文档『同段换句』拼法的图内自动化)→
                    [25] 拼装开关(false=纯底座直用(默认) / true=B 槽换主体句)。
  承袭              PE 改写组([11][12][14])与 RGBA 开关([15][16])从
                    qwen21-daojie-t2i.json 深拷贝原样保留(类名/参数/懒执行旁路
                    语义不变);[13] 单一 StringConstant 直写位由底座区链取代。

选型依据(09-23 实调研,引擎家 v0.37):
  - 核心无 N 路字符串切换节点——comfy_extras/nodes_logic.py:86 SwitchNode
    (ComfySwitchNode)为二路 MatchType 懒切换,N 选一=链式级联(本脚本采用);
    kjnodes StringConstant 单路常量、Easy-Use "easy string" 单路、Impact/rgthree
    无通用多路 switch,均无更干净先例。
  - comfy_extras/nodes_string.py:373 RegexReplace(核心,text 类)可做换槽装配,
    与库文档「把整段角括号(连括号)换成你的主体句」逐字同义。

自查(写盘后必跑,任一失败退出码 1):json.loads 往返 / link 双向一致 /
横向排版(每条连线 target.x > origin.x)/ group 全 int id / 节点与分组标题带
道劫 / 默认链头与库首条底座全文逐字一致(前 60 字符锚+全文锁)/ 四底座 B 槽
恰一个 / 四底座零 CJK / PE·RGBA 承袭参数 / 无孤儿节点 / 说明 Note 必含要点。

不动 K2 侧任何文件;引擎家 userdata 零写入;不 git。重跑幂等:底座全文从库
文档现读,库更新后重跑即同步(与契约测试 test_qwen21_workflow_contract.py 互锁)。

用法:
    python3 apps/build/scripts/qwen21_daojie_pro_0923.py            # 生成(写盘+自查)
    python3 apps/build/scripts/qwen21_daojie_pro_0923.py --check    # 只查不写
"""
from __future__ import annotations

import copy
import json
import pathlib
import re
import sys

# ── 真源定位(零 cwd 依赖)──────────────────────────────────────────
_SCRIPT = pathlib.Path(__file__).resolve()
_REPO = _SCRIPT.parents[3]  # scripts → build → apps → 仓库根
_Q21_DIR = _REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图"
DAOJIE_JSON = _Q21_DIR / "qwen21-daojie-t2i.json"
PRO_JSON = _Q21_DIR / "qwen21-daojie-t2i-pro.json"
PROMPT_LIB = _REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"

PRO_UUID = "9c2d7f04-6b81-4a3e-b5d0-8e47f1a2c93b"  # 固定值,幂等
# B 主体槽正则(整段角括号连括号替换;每条库底座 B 槽恰一个)
SLOT_B_PATTERN = "⟨B:[^⟩]*⟩"
# 四类型首条底座(库 ### 逐字标题)
BASE_KEYS = ["人物-云台执剑立绘", "场景-山门暮霭空镜", "道具-法剑多视图设定板", "美宣-渡劫一剑横幅"]

NOTE_TEXT = (
    "## 道劫 · Qwen-Image-2.1 文生图 PRO(规范化装配版)\n\n"
    "K2 道劫『一处选型+分件装配』思想的 Q2-1 原生节点落地:底座区四选一链 + 主体句区换槽装配 + "
    "PE/RGBA 双开关承袭。提示词真源=docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md(16 条底座,画布即贴)。\n\n"
    "### 底座区怎么换(四选一)\n"
    "- [17]-[20] 四个 StringConstant=库四类型首条底座全文(人物-云台执剑立绘/场景-山门暮霭空镜/"
    "道具-法剑多视图设定板/美宣-渡劫一剑横幅),槽位 ⟨A/B/C⟩ 原样保留——不换也成立,槽内已预置可用默认主体。\n"
    "- 换型:[21]→[22]→[23] 三级开关级联。全 false=人物首条(默认);[21] true=场景;[22] true=道具;"
    "[23] true=美宣(懒执行,未选底座不进提示词)。\n"
    "- 其余 12 条底座:从库文档复制全文,整段贴进 [17]-[20] 任一节点即可(换贴不换结构)。\n"
    "- 换型后把 [4] 分辨率同步切档:人物 3:4 / 场景 16:9 / 道具 1:1 / 美宣 21:9(库文档对接点表同口径)。\n\n"
    "### 主体句怎么拼([24] 唯一手写位)\n"
    "- 拼法=库文档『同段换句』,不是 K2 的尾接直拼:Q2.1 宪法恒单段(Keep it to one paragraph),"
    "主体内容长在底座槽位里。\n"
    "- [25] 拼装开关 false(默认)=纯底座直用;true=把 [24] 全文经 [26] RegexReplace 换进当前底座的 "
    "⟨B:…⟩ 主体槽(整段角括号连括号替换,与库文档换槽手工等价)。\n"
    "- [24] 默认=首条底座 B 槽预置句(对首条内容恒等——装配时 B 槽角括号随换句一并消解,与库文档"
    "『连括号一起换』同义);写主体句只写主体与画面,不重复风格词(ink-wash 全篇只在锚定句点名一次)。\n"
    "- 换槽四不碰:不碰句首位置短语/光照句与总结句/不写比例分辨率像素/不加质量词与指令腔;"
    "A/C/D 槽进阶=直接改底座节点本文。\n"
    "- 禁混一句:任何将进 [6] 编码节点的文本含 CJK 即违规(画内引号文字与 PE 种子句除外)——"
    "K2 中文围栏句、质量词、比例词禁入(库文档禁混条款)。\n\n"
    "### PE 与 RGBA 何时开\n"
    "- [14] 提示词开关:false=直写(默认,上面的装配链);true=PE 扩写([12] 短句种子→官方宪法英文长文,"
    "懒执行——旁路时 PE 模型不加载)。PE 路与直写/装配路二选一。\n"
    "- [16] RGBA 开关:false=普通(默认);true=透明底——官方包裹句式原文:"
    "This is an RGBA format image with transparency. [your description]. "
    "The image has an alpha channel and a transparent background. 透明路出图必须存 PNG 才保 alpha。\n"
    "- 起草/改写提示词唤取技能 qwen-image-2-1-prompter。\n\n"
    "### 参数圣经\n"
    "- cfg 恒 1(负向不生效,负向槽留空);步数 25 起手(官方 40-50);分辨率走 [4],宽高宜 32 倍数;"
    "seed fixed 可复现;风格终审=用户。\n"
    "- 生成脚本=apps/build/scripts/qwen21_daojie_pro_0923.py(幂等;底座全文从库文档现读,重跑即同步)。\n"
)


# ── 库文档解析 ─────────────────────────────────────────────────────
def _entry_base(md: str, heading: str) -> str:
    m = re.search(rf"^### {re.escape(heading)}\s*$", md, re.M)
    if not m:
        raise SystemExit(f"库文档缺条目标题: ### {heading}")
    fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S)
    if not fence:
        raise SystemExit(f"条目 {heading} 缺 ```text 底座围栏")
    return fence.group(1)


def load_library() -> tuple[list[str], str]:
    md = PROMPT_LIB.read_text(encoding="utf-8")
    bases = [_entry_base(md, key) for key in BASE_KEYS]
    first_heading = re.search(r"^### (.+)$", md, re.M).group(1)
    if first_heading != BASE_KEYS[0]:
        raise SystemExit(f"库首条漂移: 期望 {BASE_KEYS[0]!r}, 实得 {first_heading!r}")
    return bases, md


# ── pro 件构建(从 daojie 骨架深拷贝,承袭面原样)──────────────────
def _string_constant(nid: int, title: str, text: str, pos: list, links: list[int]) -> dict:
    return {
        "id": nid, "type": "StringConstant", "title": f"[{nid}] 道劫·{title}",
        "pos": pos, "size": [440, 400], "flags": {}, "order": 16 + nid - 17, "mode": 0,
        "inputs": [],
        "outputs": [{"name": "STRING", "type": "STRING", "links": links}],
        "properties": {"Node name for S&R": "StringConstant"},
        "widgets_values": [text],
    }


def _switch(nid: int, title: str, false_link: int, true_link: int, out_links: list[int], pos: list, size: list) -> dict:
    return {
        "id": nid, "type": "ComfySwitchNode", "title": f"[{nid}] 道劫·{title}",
        "pos": pos, "size": size, "flags": {}, "order": 16 + nid - 17, "mode": 0,
        "inputs": [
            {"name": "on_false", "shape": 7, "type": "STRING", "link": false_link},
            {"name": "on_true", "shape": 7, "type": "STRING", "link": true_link},
            {"name": "switch", "type": "BOOLEAN", "widget": {"name": "switch"}, "link": None},
        ],
        "outputs": [{"name": "output", "type": "STRING", "links": out_links}],
        "properties": {"Node name for S&R": "ComfySwitchNode"},
        "widgets_values": [False],
    }


def build_pro(daojie: dict, bases: list[str], subject_default: str) -> dict:
    g = copy.deepcopy(daojie)
    g["id"] = PRO_UUID
    g["nodes"] = [n for n in g["nodes"] if n["id"] != 13]  # [13] 单常量直写位由底座区链取代
    by_id = {n["id"]: n for n in g["nodes"]}

    # [4] 分辨率:默认跟首条底座(人物 3:4)
    by_id[4]["title"] = "[4] 道劫·分辨率选择(跟底座类型切档:人物3:4/场景16:9/道具1:1/美宣21:9)"
    by_id[4]["widgets_values"] = ["3:4 (Portrait Standard)", 1, 8]

    # [10] 说明 Note 换 PRO 用法速查
    by_id[10]["title"] = "[10] 道劫·PRO 用法速查(底座四选一×主体句换槽)"
    by_id[10]["size"] = [900, 1120]
    by_id[10]["widgets_values"] = [NOTE_TEXT]

    # [14] 提示词开关 on_false 改接底座装配链末梢 [25](link 30)
    by_id[14]["inputs"][0]["link"] = 30

    # 新节点:[17]-[20] 底座常量 / [21]-[23] 选型级联 / [24] 主体句 / [25] 拼装开关 / [26] 换槽装配
    base_titles = [
        "底座①人物-云台执剑立绘(库首条·默认;画幅3:4)",
        "底座②场景-山门暮霭空镜(画幅16:9)",
        "底座③道具-法剑多视图设定板(画幅1:1)",
        "底座④美宣-渡劫一剑横幅(画幅21:9)",
    ]
    base_pos = [[-3540, 2000], [-3540, 2480], [-3540, 2960], [-3540, 3440]]
    new_nodes = [
        _string_constant(17, base_titles[0], bases[0], base_pos[0], [20]),
        _string_constant(18, base_titles[1], bases[1], base_pos[1], [21]),
        _string_constant(19, base_titles[2], bases[2], base_pos[2], [23]),
        _string_constant(20, base_titles[3], bases[3], base_pos[3], [25]),
        _switch(21, "底座选型①(false=①人物 / true=②场景)", 20, 21, [22], [-3020, 2000], [360, 120]),
        _switch(22, "底座选型②(false=选型① / true=③道具)", 22, 23, [24], [-2600, 2000], [360, 120]),
        _switch(23, "底座选型③·四选一汇总(false=选型② / true=④美宣)", 24, 25, [26, 29], [-2180, 2000], [360, 120]),
        _string_constant(24, "主体句区(唯一手写位;默认=首条B槽预置句,内容恒等)", subject_default, [-2160, 2440], [27]),
        _switch(25, "拼装开关(false=纯底座 / true=[24]换进B槽)", 29, 28, [30], [-1200, 2000], [380, 140]),
        {
            "id": 26, "type": "RegexReplace", "title": "[26] 道劫·底座×主体句装配(B槽换句;pattern=⟨B:[^⟩]*⟩)",
            "pos": [-1700, 2000], "size": [420, 170], "flags": {}, "order": 25, "mode": 0,
            "inputs": [
                {"name": "string", "type": "STRING", "widget": {"name": "string"}, "link": 26},
                {"name": "replace", "type": "STRING", "widget": {"name": "replace"}, "link": 27},
            ],
            "outputs": [{"name": "STRING", "type": "STRING", "links": [28]}],
            "properties": {"Node name for S&R": "RegexReplace"},
            # 序列化口径照抄在库 Yue2 件:转换输入保留占位槽,全部 widget 按序 7 槽
            "widgets_values": ["", SLOT_B_PATTERN, "", True, False, False, 0],
        },
    ]
    # [24] 主体句区尺寸微调(单句不需要 400 高)
    new_nodes[7]["size"] = [460, 300]
    g["nodes"].extend(new_nodes)

    # 新 links:[lid, origin, oslot, target, tslot, type](旧 link 14 随 [13] 移除)
    g["links"] = [l for l in g["links"] if l[0] != 14]
    g["links"].extend([
        [20, 17, 0, 21, 0, "STRING"],
        [21, 18, 0, 21, 1, "STRING"],
        [22, 21, 0, 22, 0, "STRING"],
        [23, 19, 0, 22, 1, "STRING"],
        [24, 22, 0, 23, 0, "STRING"],
        [25, 20, 0, 23, 1, "STRING"],
        [26, 23, 0, 26, 0, "STRING"],
        [27, 24, 0, 26, 1, "STRING"],
        [28, 26, 0, 25, 1, "STRING"],
        [29, 23, 0, 25, 0, "STRING"],
        [30, 25, 0, 14, 0, "STRING"],
    ])

    # 分组:底座区 / 主体句区(group id 全 int)
    g["groups"].extend([
        {"id": 4, "title": "道劫·底座区·四选一链([17]-[20]=库四类型首条;[21]→[22]→[23] 级联,全 false=人物首条默认)",
         "bounding": [-3600, 1920, 1880, 2000], "color": "#4d9e6a", "flags": {}},
        {"id": 5, "title": "道劫·主体句区([24] 唯一手写位;[26] RegexReplace 换B槽;[25] false=纯底座/true=装配)",
         "bounding": [-2220, 1940, 1480, 940], "color": "#a1309b", "flags": {}},
    ])

    g["last_node_id"] = 26
    g["last_link_id"] = 30
    return g


# ── 自查(与契约测试同口径谓词)────────────────────────────────────
def self_check(pro: dict, bases: list[str], subject_default: str) -> list[str]:
    errs: list[str] = []
    nodes = {n["id"]: n for n in pro["nodes"]}
    links = {l[0]: l for l in pro["links"]}

    # 1. link 双向一致 + 类型匹配
    for l in pro["links"]:
        lid, oid, oslot, tid, tslot, typ = l
        origin, target = nodes[oid], nodes[tid]
        if typ != origin["outputs"][oslot]["type"]:
            errs.append(f"link{lid}: origin 槽类型不匹配")
        if lid not in (origin["outputs"][oslot].get("links") or []):
            errs.append(f"link{lid}: origin.outputs 未登记")
        if target["inputs"][tslot].get("link") != lid:
            errs.append(f"link{lid}: target.inputs 不匹配")

    # 2. 横向排版:每条连线 target.x > origin.x
    for l in pro["links"]:
        if not nodes[l[3]]["pos"][0] > nodes[l[1]]["pos"][0]:
            errs.append(f"link{l[0]}: 纵向塔违规 {nodes[l[1]]['type']}→{nodes[l[3]]['type']}")

    # 3. group 全 int id + 标题带道劫;节点标题带道劫
    if not pro["groups"]:
        errs.append("分组为空")
    for grp in pro["groups"]:
        if not isinstance(grp.get("id"), int):
            errs.append(f"group {grp.get('title')!r} id 非 int")
        if "道劫" not in grp["title"]:
            errs.append(f"group {grp['title']!r} 缺道劫字号")
    for n in pro["nodes"]:
        if n["type"] != "MarkdownNote" and "道劫" not in (n.get("title") or ""):
            errs.append(f"node{n['id']} 标题缺道劫字号: {n.get('title')!r}")

    # 4. 底座区/主体句区分组在位
    titles = " | ".join(grp["title"] for grp in pro["groups"])
    if "底座区" not in titles:
        errs.append("缺底座区分组")
    if "主体句区" not in titles:
        errs.append("缺主体句区分组")

    # 5. 默认链头=[17],全文与库首条逐字一致(60 字符锚+全文锁)
    head = _resolve_default_origin(pro)
    if head["id"] != 17 or head["type"] != "StringConstant":
        errs.append(f"默认链头应为 [17] StringConstant, 实得 [{head['id']}]{head['type']}")
    else:
        text = head["widgets_values"][0]
        if text != bases[0]:
            errs.append("默认底座与库首条全文不一致")
        if text[:60] != bases[0][:60]:
            errs.append("默认底座前 60 字符与库首条不一致")

    # 6. 四底座 B 槽恰一个;零 CJK;主体句区默认=首条 B 槽预置句
    for i, base in enumerate(bases):
        if re.subn(SLOT_B_PATTERN, "", base)[1] != 1:
            errs.append(f"底座{i + 1} B 槽数 != 1")
        if re.search(r"[\u4e00-\u9fff]", base):
            errs.append(f"底座{i + 1} 含 CJK(禁混)")
    if nodes[24]["widgets_values"][0] != subject_default:
        errs.append("[24] 主体句区默认值漂移")
    if re.search(SLOT_B_PATTERN, bases[0]).group(0) != f"⟨B:{subject_default}⟩":
        errs.append("首条底座 B 槽预置句与主体句区默认不恒等")

    # 7. PE/RGBA 承袭:类名/参数/默认旁路
    pe = [n for n in pro["nodes"] if n["type"] == "QwenImage21_T2IPromptRewrite"]
    if len(pe) != 1 or pe[0]["widgets_values"][1:] != [1.0, 0.95, 20, 1.5, 16256, 42]:
        errs.append("PE 改写组参数漂移")
    pe_clip = [n for n in pro["nodes"] if n["type"] == "CLIPLoader"
               and n["widgets_values"][0] == "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors"]
    if len(pe_clip) != 1:
        errs.append("PE 专属 CLIPLoader 缺失")
    rgba_te = nodes[15]
    p = rgba_te["widgets_values"][0]
    if not (p.startswith("This is an RGBA format image with transparency.")
            and p.endswith("The image has an alpha channel and a transparent background.")):
        errs.append("RGBA 编码默认 prompt 非官方包裹句式")
    for nid in (14, 16, 21, 22, 23, 25):
        if nodes[nid]["widgets_values"][0] is not False:
            errs.append(f"[{nid}] 开关默认非 false")

    # 8. 无孤儿节点(SaveImage 向上可达;MarkdownNote 豁免)
    seen, stack = set(), [9]
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        for inp in nodes[nid].get("inputs", []):
            lid = inp.get("link")
            if lid is not None:
                stack.append(links[lid][1])
    orphans = sorted(i for i in nodes if i not in seen and nodes[i]["type"] != "MarkdownNote")
    if orphans:
        errs.append(f"孤儿节点: {orphans}")

    # 9. 说明 Note 必含要点(与共享契约同口径)
    note = next(n for n in pro["nodes"] if n["type"] == "MarkdownNote")["widgets_values"][0]
    for token in ("cfg 恒 1", "RGBA format image with transparency", "qwen-image-2-1-prompter",
                  "05-道劫规范提示词库.md"):
        if token not in note:
            errs.append(f"说明 Note 缺要点: {token!r}")
    if note.lstrip().startswith("# "):
        errs.append("说明 Note 以一级大标题开幅(禁横幅)")
    return errs


def _resolve_default_origin(pro: dict) -> dict:
    """沿 [14].on_false 的 false 支路走到底(等价于默认直写路的最终来源)。"""
    nodes = {n["id"]: n for n in pro["nodes"]}
    links = {l[0]: l for l in pro["links"]}
    main_te = next(n for n in pro["nodes"]
                   if n["type"] == "TextEncodeQwenImage21"
                   and any(i["name"] == "prompt" and i.get("link") for i in n["inputs"]))
    origin = nodes[links[next(i["link"] for i in main_te["inputs"] if i["name"] == "prompt")][1]]
    hops = 0
    while origin["type"] == "ComfySwitchNode":
        hops += 1
        if hops > 10:
            raise SystemExit("默认链解析超限(疑似环)")
        origin = nodes[links[origin["inputs"][0]["link"]][1]]
    return origin


def main() -> int:
    check_only = "--check" in sys.argv
    bases, _ = load_library()
    subject_default = re.search(SLOT_B_PATTERN, bases[0]).group(0)[len("⟨B:"):-len("⟩")]
    daojie = json.loads(DAOJIE_JSON.read_text(encoding="utf-8"))
    pro = build_pro(daojie, bases, subject_default)
    errs = self_check(pro, bases, subject_default)
    if errs:
        for e in errs:
            print(f"FAIL(构建期): {e}", file=sys.stderr)
        return 1

    payload = json.dumps(pro, ensure_ascii=False, indent=2) + "\n"
    if not check_only:
        existing = PRO_JSON.read_text(encoding="utf-8") if PRO_JSON.is_file() else None
        if existing != payload:
            PRO_JSON.write_text(payload, encoding="utf-8")
            print(f"写盘: {PRO_JSON.relative_to(_REPO)}")
        else:
            print(f"在位且一致(幂等跳过): {PRO_JSON.relative_to(_REPO)}")

    # 写盘后复读自查(磁盘态为准)
    if PRO_JSON.is_file():
        disk = json.loads(PRO_JSON.read_text(encoding="utf-8"))
        disk_errs = self_check(disk, bases, subject_default)
        if disk_errs:
            for e in disk_errs:
                print(f"FAIL(磁盘态): {e}", file=sys.stderr)
            return 1
    else:
        print("FAIL: pro 件未在位", file=sys.stderr)
        return 1

    n_nodes = len(disk["nodes"])
    n_links = len(disk["links"])
    print(f"PASS: {n_nodes} 节点 / {n_links} 链 / {len(disk['groups'])} 组;"
          f"默认底座=库首条前60字符锚+全文锁一致;横向/双向/group int/道劫字号/零孤儿全绿")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
