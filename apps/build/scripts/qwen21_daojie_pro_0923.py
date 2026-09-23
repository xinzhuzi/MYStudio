#!/usr/bin/env python3
"""qwen21-daojie-t2i-pro.json 幂等生成器(09-23,道劫九型分层装配版;同日四选一版升级重写)。

镜像 K2『一处切换四处扇出』规范机制的 Q2-1 原生落地,按 05-道劫规范提示词库
(canon 九型·甲案全中文,四层装配)分层装配:

  底座区(九型选一链)  [17]-[23][25][26] 九个 StringConstant=库九型
                      「②型底座+④配色行」(型底座逐字=daojie_bases.json 该型
                      positive;人物系六型另含常量B·人物系增量四锁,随型走);
                      [28]→[35] 八级核心 ComfySwitchNode 级联(二路开关链式
                      级联=九选一,全 false=①人物默认;懒执行,未选底座不进提示词)。
  装配区(四层成链)    [24] 主体句槽(①层·唯一手写位,默认=库人物型例一)→
                      [37][38] 核心 StringConcatenate(delimiter="\n",换行分层)
                      把 主体句+型底座级联输出+[36] 通用锁层常量A(③层·库首节
                      全文·全九型恒挂,不随型)接成一段 → [14] 提示词开关 →
                      [6] TextEncode prompt;[27] easy showAnything 装配预览。
  承袭                PE 改写组([11][12][14])与 RGBA 开关([15][16])从
                      qwen21-daojie-t2i.json 深拷贝原样保留(类名/参数/懒执行
                      旁路语义/画布位置零改动);[13] 单一 StringConstant 直写位
                      由底座区+装配区链取代。

选型依据(09-23 实调研,引擎家 v0.37 源码+仓库在库件自察):
  - 拼接节点=核心 StringConcatenate(comfy_extras/nodes_string.py:39,
    string_a/string_b/delimiter 三槽,delimiter="\n" 即库文档『换行分层』装配);
    仓库在库先例=1_图片/K2图像/2_图生图/K2-角色设定-道劫.json [305](序列化口径
    照抄:转换输入保留占位槽+widgets_values 三槽+widgets_values_named delimiter);
    RegexReplace(前四选一版换 ⟨B:…⟩ 槽用)随旧结构退役——甲案四层装配=主体句
    领头换行分层,无槽可换,纯拼接即装配。
  - 九选一=八级 ComfySwitchNode 链(核心无 N 路字符串切换,nodes_logic.py:86
    SwitchNode 二路 MatchType 懒切换,链式级联;前版三级级联同骨扩至八级)。

层次序注(如实):画布装配行序=①主体句→②型底座→(人物系增量锁)→④配色行→
③通用锁层(常量A);库文档直写件行序=①②③(§四.1→§四.2→增量锁→§四.8)④。
层内容零差异(常量A/B 与②④逐字取自库文档),仅行序不同——锁层常量恒挂不可拆、
增量锁随型走故居型底座常量内,Library §一明示 pro 结构由工作流侧落位。

自查(写盘后必跑,任一失败退出码 1):json.loads 往返 / link 双向一致 / 横向
排版(每条连线 target.x > origin.x)/ group 全 int id / 节点与分组标题带道劫 /
九底座两两唯一 / 默认链头=①人物底座(穿八级开关全 false)/ 默认装配全文=库
人物型四层内容(逐字组合锁)/ 常量A 恒挂在链 / PE·RGBA 承袭参数 / 无孤儿节点
(MarkdownNote 与 easy showAnything 显示型端点豁免)/ 说明 Note 必含要点。

不动 K2 侧任何文件;引擎家 userdata 零写入;不 git。重跑幂等:九底座/锁层/
主体句默认全文从库文档与 daojie_bases.json 现读,库更新后重跑即同步(与契约
测试 test_qwen21_workflow_contract.py 互锁)。

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
BASES_JSON = _REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"

PRO_UUID = "9c2d7f04-6b81-4a3e-b5d0-8e47f1a2c93b"  # 固定值,幂等

# 人物系六型(库 §二:常量B 加挂型;与库各型装配全文实测交叉核验)
CHAR_TYPES = ["人物", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分"]
# ④配色行映射(库 §一映射表;冲突时以角色/场景设定事实为准)
COLOR_MAP = {
    "人物": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "场景": "场景青绿=宣纸白+淡墨+石绿+石青+赭石",
    "道具": "道具旧金=宣纸白+浓墨+旧金+暗玉青",
    "美宣": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "三视图": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "高清人脸": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "分镜剧情图": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "表情差分": "人物淡雅=宣纸白+浓墨+石青+玉青+旧金",
    "概念气氛图": "场景青绿=宣纸白+淡墨+石绿+石青+赭石",
}

NOTE_TEXT = (
    "## 道劫 · Qwen-Image-2.1 文生图 PRO(九型分层装配版)\n\n"
    "K2 道劫『一处选型+分件装配』思想的 Q2-1 原生落地:九型底座选型链 + 通用锁层恒挂 + 主体句槽换行拼接 + "
    "PE/RGBA 双开关承袭。提示词真源=docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md(canon 九型·甲案全中文四层装配)。\n\n"
    "### 底座区怎么换(九型选一)\n"
    "- [17]-[23][25][26] 九个 StringConstant=库九型「型底座+配色行」全文(①人物/②场景/③道具/④美宣/⑤三视图/"
    "⑥高清人脸/⑦分镜剧情图/⑧表情差分/⑨概念气氛图;型底座逐字=daojie_bases.json 该型 positive;"
    "人物系六型另含常量B·人物系增量四锁,随型走)。\n"
    "- 换型:[28]→[35] 八级开关级联,一处切换逐级右行:全 false=①人物(默认);[28] true=②场景;[29] true=③道具;"
    "[30] true=④美宣;[31] true=⑤三视图;[32] true=⑥高清人脸;[33] true=⑦分镜剧情图;[34] true=⑧表情差分;"
    "[35] true=⑨概念气氛图(懒执行,未选底座不进提示词)。\n"
    "- 换型后把 [4] 分辨率同步切档(档位=ResolutionSelector 真实 combo 值;MP=canon daojie_bases.json):\n"
    "  人物 3:4 (Portrait Standard)·4.2MP / 场景 16:9 (Widescreen)·4.2MP / 道具 1:1 (Square)·1.0MP / "
    "美宣 21:9 (Ultrawide)·4.2MP / 三视图 21:9 (Ultrawide)·4.2MP(canon 另带 3072×1024 单图直出 override,"
    "须断开 [4]→[5] 连线手改宽高) / 高清人脸 1:1 (Square)·1.0MP / 分镜剧情图 16:9 (Widescreen)·4.2MP / "
    "表情差分 1:1 (Square)·4.2MP / 概念气氛图 16:9 (Widescreen)·4.2MP。\n"
    "- 警示(手贴 vs 重跑):手贴底座只活在画布件——生成脚本重跑会把九底座/锁层/主体句默认全量重置回库文档现读值"
    "(真源=库文档与 daojie_bases.json),手贴内容被静默覆盖;要长久保留,先回写库文档再重跑,或重跑前另存画布件。\n\n"
    "### 装配区怎么拼([24] 唯一手写位)\n"
    "- 拼法=库文档四层装配『主体句领头+换行分层』:[37][38] 核心 StringConcatenate(delimiter=\\n)把 [24] 主体句 + "
    "当前型底座(含配色行/人物系增量锁)+ [36] 通用锁层常量A(库首节全文,全九型恒挂不随型)逐层接成一段进 [6] 编码。\n"
    "- 层次序注:画布装配行序=①主体句→②型底座→(人物系增量锁)→④配色行→③通用锁层;库文档直写件行序="
    "①②③(内嵌增量锁)④——层内容零差异,仅行序不同(锁层常量恒挂不可拆,增量锁随型走故居底座常量内)。\n"
    "- [24] 默认=库人物型例一主体句;换型后 [24] 须同步换成本型主体句(各型例句见库文档;场景/概念气氛图不写人——"
    "空镜句尾可明写「空镜无人」);主体句只写主体与画面,不重复风格词,全角标点,质量词/比例词/否定式禁入"
    "(库文档主体句纪律五则)。\n"
    "- 跑图前过目 [27] 装配预览(接 [38] 输出):显示将进 [6] 的最终文本,确认再跑。\n"
    "- 甲案围栏:本链为甲案全中文直书(中文合法);与 PE/乙案英文长文禁混——[14] true 时走 [12] PE 改写路"
    "(中文种子句进、英文长文出),与本链二选一(库文档禁混条款一)。\n\n"
    "### PE 与 RGBA 何时开\n"
    "- [14] 提示词开关:false=直写(默认,上面的装配链);true=PE 扩写([12] 短句种子→官方宪法英文长文,"
    "懒执行——旁路时 PE 模型不加载)。\n"
    "- [16] RGBA 开关:false=普通(默认);true=透明底——官方包裹句式原文:"
    "This is an RGBA format image with transparency. [your description]. "
    "The image has an alpha channel and a transparent background. 透明路出图必须存 PNG 才保 alpha。\n"
    "- 起草/改写提示词唤取技能 qwen-image-2-1-prompter。\n\n"
    "### 参数圣经\n"
    "- cfg 恒 1(负向不生效,负向槽留空);步数 25 起手(官方 40-50);分辨率走 [4],宽高宜 32 倍数;"
    "seed fixed 可复现;风格终审=用户。\n"
    "- 生成脚本=apps/build/scripts/qwen21_daojie_pro_0923.py(幂等;九底座/锁层/主体句默认从库文档与 "
    "daojie_bases.json 现读,重跑即同步)。\n"
)


# ── 真源解析(库文档 × daojie_bases.json 双向互锁)────────────────
def load_truth() -> dict:
    """返回 {types:[{zh,aspect,mp,base,middle_is_char,subject,color,constant_text}], const_a}。

    提取口径(与库文档 §二/§三逐字互锁,任一不符即 SystemExit):
      每型装配全文 fence = ⟨①:…⟩ / ②型底座 / ③锁层中间行 / ④配色行;
      ② == bases json positive;④ == COLOR_MAP 该型行;
      ③ 人物系=A1+A2+常量B四段+A3,非人物系=A1+A2+A3;
      常量A/B = 库 §二 第 2/3 个 text fence(第 1 个是 §一 装配顺序示意块)。
    """
    md = PROMPT_LIB.read_text(encoding="utf-8")
    bases = json.loads(BASES_JSON.read_text(encoding="utf-8"))
    zh_order = [b["zh"] for b in bases]
    headings = re.findall(r"^### (.+?)-基础\s*$", md, re.M)
    if headings != zh_order:
        raise SystemExit(f"库 ### 九型标题与 daojie_bases.json zh 顺序不一致: {headings} vs {zh_order}")

    head = md.split("## 三、")[0]
    fences = re.findall(r"```text\n(.*?)\n```", head, re.S)
    if len(fences) < 3:
        raise SystemExit("库 §二 常量围栏不足(应含 装配顺序块+常量A+常量B)")
    const_a, const_b = fences[1], fences[2]
    a_lines, b_lines = const_a.split("\n"), const_b.split("\n")

    types = []
    for zh, canon in zip(zh_order, bases):
        m = re.search(rf"^### {zh}-基础\s*$", md, re.M)
        if not m:
            raise SystemExit(f"库文档缺条目: ### {zh}-基础")
        fence = re.search(r"```text\n(.*?)\n```", md[m.end():], re.S)
        if not fence:
            raise SystemExit(f"条目 {zh} 缺 ```text 装配全文围栏")
        lines = fence.group(1).split("\n")
        subject_wrapped, base_line, middle, color = lines[0], lines[1], lines[2:-1], lines[-1]
        if not (subject_wrapped.startswith("⟨①:") and subject_wrapped.endswith("⟩")):
            raise SystemExit(f"条目 {zh} 首行非 ⟨①:…⟩ 主体槽")
        if base_line != canon["positive"]:
            raise SystemExit(f"条目 {zh} ②型底座与 daojie_bases.json positive 不逐字一致")
        if color != COLOR_MAP[zh]:
            raise SystemExit(f"条目 {zh} ④配色行与 §一映射表不一致")
        want_middle = a_lines[:2] + b_lines + a_lines[2:] if zh in CHAR_TYPES else a_lines
        if middle != want_middle:
            raise SystemExit(f"条目 {zh} ③锁层中间行与常量A/B 组合不一致(甲案互锁破)")
        constant_text = "\n".join([base_line] + (b_lines if zh in CHAR_TYPES else []) + [color])
        types.append({
            "zh": zh,
            "aspect": canon["aspect_ratio"],
            "mp": canon["megapixels"],
            "subject": subject_wrapped[len("⟨①:"):-len("⟩")],
            "base": base_line,
            "constant_text": constant_text,
        })
    # 唯一性:九底座两两不同(②型底座两两不同)
    if len({t["constant_text"] for t in types}) != 9 or len({t["base"] for t in types}) != 9:
        raise SystemExit("九型底座常量两两不唯一")
    return {"types": types, "const_a": const_a}


# ── 节点工厂(序列化口径承旧版/在库件)────────────────────────────
def _string_constant(nid: int, title: str, text: str, pos: list, links: list[int], size: list) -> dict:
    return {
        "id": nid, "type": "StringConstant", "title": f"[{nid}] 道劫·{title}",
        "pos": pos, "size": size, "flags": {}, "order": 0, "mode": 0,
        "inputs": [],
        "outputs": [{"name": "STRING", "type": "STRING", "links": links}],
        "properties": {"Node name for S&R": "StringConstant"},
        "widgets_values": [text],
    }


def _switch(nid: int, title: str, false_link: int, true_link: int, out_links: list[int], pos: list) -> dict:
    return {
        "id": nid, "type": "ComfySwitchNode", "title": f"[{nid}] 道劫·{title}",
        "pos": pos, "size": [380, 120], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "on_false", "shape": 7, "type": "STRING", "link": false_link},
            {"name": "on_true", "shape": 7, "type": "STRING", "link": true_link},
            {"name": "switch", "type": "BOOLEAN", "widget": {"name": "switch"}, "link": None},
        ],
        "outputs": [{"name": "output", "type": "STRING", "links": out_links}],
        "properties": {"Node name for S&R": "ComfySwitchNode"},
        "widgets_values": [False],
    }


def _concatenate(nid: int, title: str, a_link: int, b_link: int, out_links: list[int], pos: list) -> dict:
    """核心 StringConcatenate;序列化口径照抄在库先例 K2-角色设定-道劫.json [305]
    (转换输入保留占位槽 + widgets_values 三槽 + widgets_values_named delimiter)。"""
    return {
        "id": nid, "type": "StringConcatenate", "title": f"[{nid}] 道劫·{title}",
        "pos": pos, "size": [380, 180], "flags": {}, "order": 0, "mode": 0,
        "inputs": [
            {"name": "string_a", "type": "STRING", "widget": {"name": "string_a"}, "link": a_link},
            {"name": "string_b", "type": "STRING", "widget": {"name": "string_b"}, "link": b_link},
        ],
        "outputs": [{"name": "STRING", "type": "STRING", "links": out_links}],
        "properties": {"Node name for S&R": "StringConcatenate"},
        "widgets_values": ["", "", "\n"],
        "widgets_values_named": {"delimiter": "\n"},
    }


# ── pro 件构建(从 daojie 骨架深拷贝,承袭面原样)──────────────────
# 型常量 id(库顺序①-⑨;[24]=主体句槽/[27]=装配预览预留,故⑧⑨用 25/26)
CONST_IDS = [17, 18, 19, 20, 21, 22, 23, 25, 26]
SWITCH_IDS = [28, 29, 30, 31, 32, 33, 34, 35]  # 选型①-⑧(⑧=九选一汇总)
LOCK_ID, CONCAT1_ID, CONCAT2_ID = 36, 37, 38
SUBJECT_ID, PREVIEW_ID = 24, 27
_CN = "①②③④⑤⑥⑦⑧⑨"


def build_pro(daojie: dict, truth: dict) -> dict:
    g = copy.deepcopy(daojie)
    g["id"] = PRO_UUID
    g["nodes"] = [n for n in g["nodes"] if n["id"] != 13]  # [13] 单常量直写位由底座区+装配区取代
    by_id = {n["id"]: n for n in g["nodes"]}
    types = truth["types"]

    # [4] 分辨率:默认跟①人物 canon 档(3:4·4.2MP);九型联动表入 Note
    by_id[4]["title"] = "[4] 道劫·分辨率选择(九型画幅联动,档位表见 Note;默认①人物 3:4·4.2MP)"
    by_id[4]["widgets_values"] = [types[0]["aspect"], types[0]["mp"], 8]

    # [10] 说明 Note 换九型装配版用法
    by_id[10]["title"] = "[10] 道劫·PRO 用法速查(九型选一×分层装配)"
    by_id[10]["size"] = [900, 1240]
    by_id[10]["widgets_values"] = [NOTE_TEXT]

    # ── 底座区:九型常量列 + 八级选型级联 ──
    # 常量列 x=-5000;行高:人物系(含常量B)500,场景系 260;行距=上行底+80
    const_pos, y = [], 1900
    for t in types:
        h = 500 if t["zh"] in CHAR_TYPES else 260
        const_pos.append([-5000, y, h])
        y += h + 80
    # 级联横排 y=1900,自 x=-4400 起步距 420(九常量在左,链逐级右行)
    switch_pos = {sid: [-4400 + 420 * i, 1900] for i, sid in enumerate(SWITCH_IDS)}

    nodes: list[dict] = []
    links: list[list] = []

    # 选型级联真值表(便于人审;link id 方案:偶数=on_false 链,奇数=on_true 链):
    #   S_k.on_false ← C①(k=1,默认路)/ S_{k-1}.output(k≥2);S_k.on_true ← C{k+2}型
    #   S_k.output → S_{k+1}.on_false(k≤7);S8.output → 拼接①.string_b(末梢 36)
    for i, sid in enumerate(SWITCH_IDS):
        if i == 0:
            links.append([20, CONST_IDS[0], 0, sid, 0, "STRING"])              # C①人物 → S1.on_false
        else:
            links.append([20 + 2 * i, SWITCH_IDS[i - 1], 0, sid, 0, "STRING"])  # 前级 → S_k.on_false
        links.append([21 + 2 * i, CONST_IDS[i + 1], 0, sid, 1, "STRING"])       # C{k+2}型 → S_k.on_true
    links.append([36, SWITCH_IDS[-1], 0, CONCAT1_ID, 1, "STRING"])              # 级联末梢 → 拼接①.string_b
    # 校验链 id 无碰撞且连续 20..36
    assert [l[0] for l in links] == list(range(20, 37)), [l[0] for l in links]

    # 型常量(输出线=其 on_true 线;①人物=S1.on_false 线 20)
    for i, (t, cid) in enumerate(zip(types, CONST_IDS)):
        zh_num = _CN[i]
        extra = "+人物系增量锁" if t["zh"] in CHAR_TYPES else ""
        title = (f"底座{zh_num}{t['zh']}(型底座+配色行{extra};"
                 f"画幅{t['aspect'].split(' ')[0]}·{t['mp']}MP)")
        out_link = 20 if i == 0 else 21 + 2 * (i - 1)
        pos = const_pos[i]
        nodes.append(_string_constant(cid, title, t["constant_text"], pos[:2], [out_link], [440, pos[2]]))

    # 八级选型开关
    for i, sid in enumerate(SWITCH_IDS):
        false_link = 20 + 2 * i
        true_link = 21 + 2 * i
        out_links = [36] if i == len(SWITCH_IDS) - 1 else [20 + 2 * (i + 1)]
        label = "九选一汇总" if i == len(SWITCH_IDS) - 1 else f"选型{_CN[i]}"
        chain_lbl = "①人物" if i == 0 else f"①-{_CN[i]}"
        title = (f"{label}(false={chain_lbl} / true={_CN[i + 1]}{types[i + 1]['zh']})"
                 if i < len(SWITCH_IDS) - 1 else
                 f"{label}(false={chain_lbl} / true=⑨概念气氛图)")
        nodes.append(_switch(sid, title, false_link, true_link, out_links, switch_pos[sid]))

    # ── 装配区:主体句槽 + 通用锁层常量 + 两级拼接 + 预览 ──
    nodes.append(_string_constant(
        SUBJECT_ID, "主体句槽(①层·唯一手写位;默认=库人物型例一)",
        types[0]["subject"], [-960, 2440], [37], [460, 300]))
    nodes.append(_string_constant(
        LOCK_ID, "通用锁层常量A(③层·库首节全文·全九型恒挂)",
        truth["const_a"], [-960, 3140], [39], [440, 400]))
    nodes.append(_concatenate(
        CONCAT1_ID, "装配拼接①([24]主体句+底座级联;delimiter=\\n)",
        37, 36, [38], [-440, 2440]))
    nodes.append(_concatenate(
        CONCAT2_ID, "装配拼接②(+[36]通用锁层;delimiter=\\n)",
        38, 39, [40, 41], [0, 2440]))

    # 预览 [27](easy showAnything,承前版骨;显示型端点,契约不计孤儿)
    nodes.append({
        "id": PREVIEW_ID, "type": "easy showAnything",
        "title": "[27] 道劫·装配预览(接[38];跑图前过目将进[6]的最终文本)",
        "pos": [460, 2440], "size": [480, 230], "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"label": "输入任何", "name": "anything", "shape": 7, "type": "*", "link": 41}],
        "outputs": [{"name": "output", "type": "*", "links": None}],
        "properties": {"Node name for S&R": "easy showAnything"},
        "widgets_values": [""],
    })

    # order 顺序编号(底座区→装配区)
    for order, n in enumerate(nodes, start=16):
        n["order"] = order
    g["nodes"].extend(nodes)

    # links:骨架 1-19(除 14 随 [13] 拆除)+ 级联/装配段 20-41
    g["links"] = [l for l in g["links"] if l[0] != 14]
    g["links"].extend(links)
    g["links"].extend([
        [37, SUBJECT_ID, 0, CONCAT1_ID, 0, "STRING"],   # 主体句 → 拼接①.string_a
        [38, CONCAT1_ID, 0, CONCAT2_ID, 0, "STRING"],   # 拼接① → 拼接②.string_a
        [39, LOCK_ID, 0, CONCAT2_ID, 1, "STRING"],      # 锁层A → 拼接②.string_b
        [40, CONCAT2_ID, 0, 14, 0, "STRING"],           # 拼接② → [14] 提示词开关.on_false
        [41, CONCAT2_ID, 0, PREVIEW_ID, 0, "STRING"],   # 拼接② → [27] 预览
    ])
    # [14] on_false 改接装配链末梢(原接 [13])
    by_id[14]["inputs"][0]["link"] = 40

    # 分组:底座区/装配区(group id 全 int;标题带道劫)
    g["groups"] = [grp for grp in g["groups"] if grp["id"] not in (4, 5)]
    g["groups"].extend([
        {"id": 4,
         "title": ("道劫·底座区·九型选型链([17]-[23][25][26]=库九型「型底座+配色行」"
                   "(人物系六型含常量B增量锁,随型走);[28]→[35] 八级 ComfySwitchNode 级联,"
                   "全 false=①人物默认)"),
         "bounding": [-5080, 1820, 4060, y - 1820 + 80], "color": "#4d9e6a", "flags": {}},
        {"id": 5,
         "title": ("道劫·装配区([24] 主体句槽=①层唯一手写位;[36] 通用锁层常量A恒挂=③层;"
                   "[37][38] StringConcatenate 换行拼接;[27] 预览)"),
         "bounding": [-1020, 2380, 2000, 1280], "color": "#a1309b", "flags": {}},
    ])

    g["last_node_id"] = CONCAT2_ID
    g["last_link_id"] = 41
    return g


# ── 自查(与契约测试同口径谓词)────────────────────────────────────
def self_check(pro: dict, truth: dict) -> list[str]:
    errs: list[str] = []
    nodes = {n["id"]: n for n in pro["nodes"]}
    links = {l[0]: l for l in pro["links"]}
    types = truth["types"]

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

    # 4. 底座区/装配区分组在位
    titles = " | ".join(grp["title"] for grp in pro["groups"])
    if "底座区" not in titles:
        errs.append("缺底座区分组")
    if "装配区" not in titles:
        errs.append("缺装配区分组")

    # 5. 九底座:两两唯一 + 逐字=库「型底座(+增量锁)+配色行」;人物系含常量B、场景系不含
    const_texts = [nodes[cid]["widgets_values"][0] for cid in CONST_IDS]
    if len(set(const_texts)) != 9:
        errs.append("九型底座常量两两不唯一")
    for t, cid, text in zip(types, CONST_IDS, const_texts):
        if text != t["constant_text"]:
            errs.append(f"底座[{cid}]{t['zh']} 与库装配层不逐字一致")
        has_b = "衣褶/裙摆：使用宽幅平静布面" in text
        if (t["zh"] in CHAR_TYPES) != has_b:
            errs.append(f"底座[{cid}]{t['zh']} 常量B增量锁挂载错型(人物系六型应含)")
    # 锁层常量A 恒挂在链且逐字=库首节常量
    if nodes[LOCK_ID]["widgets_values"][0] != truth["const_a"]:
        errs.append("[36] 通用锁层常量A 与库首节常量不逐字一致")

    # 6. 级联九路:八级开关全 false;S1.on_false=C①;S_k.on_true=C{k+2}型;末梢→拼接①
    for i, sid in enumerate(SWITCH_IDS):
        sw = nodes[sid]
        if sw["widgets_values"][0] is not False:
            errs.append(f"[{sid}] 选型开关默认非 false")
        false_src = nodes[links[sw["inputs"][0]["link"]][1]]
        want_false = nodes[CONST_IDS[0]] if i == 0 else nodes[SWITCH_IDS[i - 1]]
        if false_src["id"] != want_false["id"]:
            errs.append(f"[{sid}].on_false 上游应为 {'C①' if i == 0 else f'前级[{SWITCH_IDS[i-1]}]'}")
        true_src = nodes[links[sw["inputs"][1]["link"]][1]]
        if true_src["id"] != CONST_IDS[i + 1]:
            errs.append(f"[{sid}].on_true 上游应为型常量[{CONST_IDS[i + 1]}]")

    # 7. 默认链(全 false)=①人物:装配三源={C①, 主体句, 锁层A};默认装配全文组合锁
    origins = _resolve_default_origins(pro)
    if sorted(origins) != sorted([CONST_IDS[0], SUBJECT_ID, LOCK_ID]):
        errs.append(f"默认装配三源应=[{CONST_IDS[0]}]底座/[{SUBJECT_ID}]主体句/[{LOCK_ID}]锁层, 实得 {sorted(origins)}")
    assembled = "\n".join([nodes[SUBJECT_ID]["widgets_values"][0],
                           nodes[CONST_IDS[0]]["widgets_values"][0],
                           nodes[LOCK_ID]["widgets_values"][0]])
    want = "\n".join([types[0]["subject"], types[0]["constant_text"], truth["const_a"]])
    if assembled != want:
        errs.append("默认装配全文与库人物型四层组合不逐字一致")
    if nodes[SUBJECT_ID]["widgets_values"][0] != types[0]["subject"]:
        errs.append("[24] 主体句槽默认值≠库人物型例一")

    # 8. 拼接节点:恰 2 个 StringConcatenate,delimiter=\n,接线=a/b 就位;RegexReplace 已退役
    concats = [n for n in pro["nodes"] if n["type"] == "StringConcatenate"]
    if len(concats) != 2:
        errs.append(f"应恰 2 个 StringConcatenate, 得 {len(concats)}")
    for c in concats:
        if c["widgets_values"][2] != "\n" or c.get("widgets_values_named", {}).get("delimiter") != "\n":
            errs.append(f"[{c['id']}] delimiter 应为 \\n(换行分层)")
    if [n for n in pro["nodes"] if n["type"] == "RegexReplace"]:
        errs.append("RegexReplace 应随旧四选一结构退役(甲案装配=纯拼接)")
    if nodes[CONCAT2_ID]["type"] != "StringConcatenate":
        errs.append("[38] 应为 StringConcatenate")
    else:
        if nodes[links[nodes[CONCAT2_ID]["inputs"][0]["link"]][1]]["id"] != CONCAT1_ID:
            errs.append("[38].string_a 上游应为拼接①")
        if nodes[links[nodes[CONCAT2_ID]["inputs"][1]["link"]][1]]["id"] != LOCK_ID:
            errs.append("[38].string_b 上游应为锁层常量A")
        pe_switch = nodes[14]
        if links[pe_switch["inputs"][0]["link"]][1] != CONCAT2_ID:
            errs.append("[14].on_false 应接装配链末梢 [38]")

    # 9. PE/RGBA 承袭:类名/参数/默认旁路;开关总数=10(八级联+PE+RGBA)全 false
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
    switches = [n for n in pro["nodes"] if n["type"] == "ComfySwitchNode"]
    if len(switches) != 10:
        errs.append(f"ComfySwitchNode 应恰 10 个(八级联+PE+RGBA), 得 {len(switches)}")
    if not all(s["widgets_values"][0] is False for s in switches):
        errs.append("存在默认非 false 的开关")

    # 10. 无孤儿节点(SaveImage 向上可达;MarkdownNote/easy showAnything 显示型端点豁免)
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
    orphans = sorted(i for i in nodes if i not in seen
                     and nodes[i]["type"] not in ("MarkdownNote", "easy showAnything"))
    if orphans:
        errs.append(f"孤儿节点: {orphans}")

    # 11. 说明 Note 必含要点(与共享契约同口径 + 九型版要点)
    note = next(n for n in pro["nodes"] if n["type"] == "MarkdownNote")["widgets_values"][0]
    for token in ("cfg 恒 1", "RGBA format image with transparency", "qwen-image-2-1-prompter",
                  "05-道劫规范提示词库.md", "九型", "空镜无人", "重置回库文档现读值", "[27]"):
        if token not in note:
            errs.append(f"说明 Note 缺要点: {token!r}")
    if note.lstrip().startswith("# "):
        errs.append("说明 Note 以一级大标题开幅(禁横幅)")
    return errs


def _resolve_default_origins(pro: dict) -> dict:
    """默认直写路(全开关 false)的 StringConstant 源集合:穿拼接节点取全支路。"""
    nodes = {n["id"]: n for n in pro["nodes"]}
    links = {l[0]: l for l in pro["links"]}
    main_te = next(n for n in pro["nodes"]
                   if n["type"] == "TextEncodeQwenImage21"
                   and any(i["name"] == "prompt" and i.get("link") for i in n["inputs"]))
    stack = [nodes[links[next(i["link"] for i in main_te["inputs"] if i["name"] == "prompt")][1]]]
    origins, hops = {}, 0
    while stack:
        node = stack.pop()
        if node["id"] in origins:
            continue
        origins[node["id"]] = node
        hops += 1
        if hops > 60:
            raise SystemExit("默认链解析超限(疑似环)")
        if node["type"] == "ComfySwitchNode":
            if node["widgets_values"][0] is not False:
                raise SystemExit(f"默认链中途开关非 false: [{node['id']}]")
            stack.append(nodes[links[node["inputs"][0]["link"]][1]])
        elif node["type"] == "StringConcatenate":
            for inp in node["inputs"]:
                if inp.get("link") is not None:
                    stack.append(nodes[links[inp["link"]][1]])
    return {nid: n for nid, n in origins.items() if n["type"] == "StringConstant"}


def main() -> int:
    check_only = "--check" in sys.argv
    truth = load_truth()
    daojie = json.loads(DAOJIE_JSON.read_text(encoding="utf-8"))
    pro = build_pro(daojie, truth)
    errs = self_check(pro, truth)
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

    # 写盘后复读自查(磁盘态为准):json.loads 往返 + 全谓词
    if PRO_JSON.is_file():
        disk = json.loads(PRO_JSON.read_text(encoding="utf-8"))
        disk_errs = self_check(disk, truth)
        if disk_errs:
            for e in disk_errs:
                print(f"FAIL(磁盘态): {e}", file=sys.stderr)
            return 1
    else:
        print("FAIL: pro 件未在位", file=sys.stderr)
        return 1

    n_nodes = len(disk["nodes"])
    n_links = len(disk["links"])
    zh_list = " ".join(t["zh"] for t in truth["types"])
    print(f"PASS: {n_nodes} 节点 / {n_links} 链 / {len(disk['groups'])} 组;九型={zh_list};"
          f"默认=①人物(三源[17][24][36]组合逐字锁);横向/双向/group int/道劫字号/九底座唯一/零孤儿全绿")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
