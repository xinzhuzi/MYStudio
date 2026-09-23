#!/usr/bin/env python3
"""道劫 canon 九型提示词库(甲案·全库中文)生成器 + 守恒自检 — 2026-09-23.

生成 docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md:
  型录与顺序 = daojie_bases.json 九型 zh;每型一节(标题「### {zh}-基础」),恰 9 节。
  四层装配逐层成文(三层取材原文照抄零蒸馏,research/09-甲案小样装配规格 同则):
    ①主体句槽 ⟨①:…⟩(预置例一;每型 2 条示例)
    ②型底座(daojie_bases.json 该型 positive 全文照抄)
    ③通用锁层(prefix.md §四.1/.2/.8 三段全文;人物系六型再并 §四.4-.7 四把全员锁;
      提取只去「（硬,…)」类元语言括注与 markdown 符号,正文一字不动)
    ④配色职责行(prefix.md 配色五职责节「精选方案示例」对应型原文一行)
  库首附完整通用锁层常量(基础常量 + 人物系增量常量,供工作流恒挂层直接取用);
  文末覆盖矩阵(canon 18 骨干 + 八锁 × 九型,字面在场核验,未覆盖项如实标注)
  + 禁混条款五则 + 自查记录。

用法:
  python3 apps/build/scripts/daojie_canon_lib_0923.py           # 生成(幂等,逐字节稳定)
  python3 apps/build/scripts/daojie_canon_lib_0923.py --check   # 对磁盘文件守恒校验
  python3 apps/build/scripts/daojie_canon_lib_0923.py --verify-jia  # ③锁层与 round5-jia 实拍装配逐字对齐
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
PREFIX = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/prefix.md"
OUT = REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
JIA_DIR = Path.home() / "Downloads/qwen21-e2e-0923/round5-jia"
OVERLAP_SCRIPT = REPO / "apps/build/scripts/daojie_subject_overlap_0922.py"

# ── ①主体句示例(例一优先取《道劫_九型主体句示例.md》原文;例二取甲案句或本库新写) ──
SUBJECTS = {
    "人物": (
        "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门石阶最上一级，右手轻按剑柄未拔，视线越过阶下云海望向远处，晨光自左侧斜照，衣袂被山风微微掀起。",
        "一位青岩剑宗的女剑修，二十余岁，气质清冷出尘，墨黑长发及腰半束，素色道袍长裙，腰束石青丝绦，左手按剑立于身前，目光沉静望向画外，全身立绘。",
        ("《道劫_九型主体句示例》§1 原文", "甲案①主体句(research/09-甲案小样装配规格,round5-jia 实拍句)"),
    ),
    "场景": (
        "暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。",
        "春日山间灵溪谷谷口，晨雾未散，溪上架一座旧木桥，空镜无人。",
        ("《道劫_九型主体句示例》§2 原文", "甲案①主体句(round5-jia 实拍句)"),
    ),
    "道具": (
        "一柄传承千年的青铜剑，剑身暗金底色上盘绕细密云雷纹，剑格铸成兽首衔环，剑柄缠深红丝绳，穗尾垂一枚带裂纹的灵玉；细节特写一格聚焦剑身近格处的旧伤裂纹与缠绕其上的金色修补纹。",
        "一只随身丹药葫芦，枣红漆葫芦身、腰部束编织草绳，木塞雕成小蘑菇顶，肩部一圈青灰釉到肩即止；细节特写一格聚焦葫芦口一缕将散未散的药香烟气与釉线止口。",
        ("《道劫_九型主体句示例》§3 原文", "本库新写(四宫格正/侧/背/细节 + 材质灵纹)"),
    ),
    "美宣": (
        "雷劫降临的至暗时刻，白衣剑修独立孤峰之巅，周身剑气化作淡金色光罩，九道紫雷自翻墨般的劫云中劈落，他在最后一瞬反身拔剑迎击，衣袍与剑穗在罡风中猎猎狂舞；远景群山在雷光明灭中沉浮。",
        "宗门大比收官的黄昏，获胜的黑衣少年剑修独立演武台中央收剑入鞘，台下同门抱拳致意，暮色里旌旗与衣袂同向翻卷；神态基调：锋芒内敛的沉静。",
        ("《道劫_九型主体句示例》§4 原文", "本库新写(叙事瞬间+神态基调,事件=大比收官)"),
    ),
    "三视图": (
        "同一位青年刀修的角色转面设定板：横幅六格等分，从左到右依次为上半身像、正面全身、侧面全身、背面全身、正斜侧面全身、背斜侧面全身；第一格上半身像画面底缘止于腰部，其余五格皆为头顶至脚底的全身画像；各全身格同一自然站姿，双手拢袖，神情中性沉静，腰侧佩刀；玄色劲装束袖束腰，长发高束马尾，六格同一人。",
        "同一位蓝衫女修的角色转面设定板：横幅六格等分，从左到右依次为上半身像、正面全身、侧面全身、背面全身、正斜侧面全身、背斜侧面全身；第一格上半身像画面底缘止于腰部，其余五格皆为头顶至脚底的全身画像；各全身格同一自然站姿，双手拢袖，神情中性沉静；月白长裙束靛蓝腰带，黑发绾单髻只插一支素银簪，六格同一人。",
        ("《道劫_九型主体句示例》§5 原文(09-22 v2.1 六格规范)", "本库新写(按 v2.1 规范换角色四件套:服化/发型/配饰)"),
    ),
    "高清人脸": (
        "一位筑基后期的年轻女修面容特写：眉目沉静中带一点锋芒，长发半束只簪一支素银簪，几缕碎发垂在颊边；头顶至锁骨、正面平视，神情沉静，柔和顶光勾勒面部立体轮廓。",
        "一位青岩剑宗的女剑修，二十余岁，气质清冷出尘，墨黑长发及腰半束，面容特写：眉目清冷，目光沉静望向画外，几缕碎发垂在颊边；神情沉静，柔和顶光勾勒面部轮廓。",
        ("《道劫_九型主体句示例》§6 原文", "本库新写(锚法示范:身份段逐字搬运人物例二+特写取景段)"),
    ),
    "分镜剧情图": (
        "山雨欲来的渡口，老船工收篙回望，身后的少年修士第一次背起行囊离乡；乌云压江，渡口一盏灯笼是画面唯一的暖色，两人的目光都投向江雾深处若隐若现的仙山轮廓。",
        "初雪初霁的清晨，边城城门半开，一支风尘商队鱼贯入城，领头的老驼师勒缰回望清点驼货，守门的年轻卒长倚矛抬头相迎；门洞灯笼是画面唯一暖色，众人目光投向城内长街深处的炊烟。",
        ("《道劫_九型主体句示例》§7 原文", "本库新写(事件=入城,动作到动词精度)"),
    ),
    "表情差分": (
        "同一位红衣女修的九宫格表情差分，九格情绪与五官状态——沉静：双目平和微垂、眉舒展、唇线平直；含笑：眼角弯起、嘴角上扬轻抿、眉梢微挑；怒：剑眉倒竖、怒目圆睁、牙关紧咬嘴角下压；哀：眉梢下垂呈八字、眼睑低垂含泪光、嘴角下弯；惧：眉毛高挑向眉心收拢、双眼圆睁、唇微张发颤；凌厉：双眼眯起、眉峰锐利下压、嘴角紧抿；惊讶：眉毛高高挑起、双眼睁大、唇微张成小圆；害羞：双颊染红晕、眼帘低垂、嘴角含羞轻抿；决然：目光坚定直视、眉宇紧锁、嘴角平直；各格头部角度与光源方向保持一致。",
        "同一位红衣女修的单表情半身像：沉静——双目平和微垂、眉舒展、鼻颊放松、唇线平直、头正颌收，幅度克制；头部角度与光源方向与基准拍保持一致。",
        ("《道劫_九型主体句示例》§8 原文(九宫格快览直出版)", "本库新写(生产路单发表情版,裁定13 五官全覆盖物理描述)"),
    ),
    "概念气氛图": (
        "千年一次的灵潮涨落之夜，悬浮的碎裂古殿群沐浴在青蓝色灵光中，万千萤火状灵尘随气流缓缓升腾；画面九成留给静谧的夜与雾，只余殿群一角与一株横生孤松的剪影。",
        "深山寒夜，一点灯火，孤寂而安宁的守候。",
        ("《道劫_九型主体句示例》§9 原文", "甲案①主体句(round5-jia 实拍句)"),
    ),
}

# ── 每型节内文案(适用场景一句 / 留白档 / 主体句规范) ──────────────────────
SECTION_PROSE = {
    "人物": dict(
        scene="3:4 竖幅单人全身立绘与角色定妆图——换装、换姿态、换朝代不换型,角色资产的第一张定骨图。",
        liubai="中(手册点名:角色立绘=中)",
        spec="按七段公式写身份境界、气质五官、服饰、动作视线与构图方位——动作写到动词精度(手持何物、遮/扶/按何处、身体与视线朝向谁),神色基调由角色设定择一;服饰历史向按朝代实名+身份+地位+成套点名,同画面朝代统一(汉唐宋明历代均可);底色色相按设定指定(②层默认暖白系浅净平涂;魔道/邪道设定走手册暗色分支,④配色行换「人物魔道」);全身从头到脚入画。",
    ),
    "场景": dict(
        scene="16:9 空镜 hero shot(人眼平视),无人物——地点资产与剧情画面的背景定调图。",
        liubai="很高(手册点名:山水/概念=很高)",
        spec="写地点、季节、时段,并按场景点名留白载体(天空/水面/雪地/雾气/烟霭/暗部择一);底色色相按时段天候指定(②层只锁浅净);不写人——该型人物由负向纪律承担,Q2.1 cfg=1 负向不参与采样,故由①层「不写人」约定承担(空镜句尾可明写「空镜无人」)。",
    ),
    "道具": dict(
        scene="1:1 四宫格器物设定板(正/侧/背/细节特写)——武器、法器、丹药、符牌等物品资产,出图后可裁单格作物品图。",
        liubai="中(推定:手册四档未点名设定板,按资产属性归立绘系——本库判断,非手册原文)",
        spec="写器物名、材质、灵纹;四宫格=正/侧/背/细节特写,细节格给到一个放大点(旧伤、纹样、釉线、烟气);底色色相可由设定指定(②层只锁浅净,裁切需浅净底);灵金寒芒内蕴、灵玉温润、丹瓷釉面古朴等质感词按器物择用。",
    ),
    "美宣": dict(
        scene="21:9 长卷(或 16:9/4:5 人物向)主视觉——渡劫、对峙、大比等叙事瞬间的海报定调图,可拉高视觉强度。",
        liubai="高(手册「剧情图=高」;战斗演出镜头按「战斗=低中」+X6 豁免口径)",
        spec="写叙事瞬间与神态基调——具体事件(对峙、谋划、入城、渡劫等)由主体句枚举、由设定选定,动作到动词精度;战斗演出可临时拉高视觉强度(X6 豁免:高饱和特效大作合法),但线条与传统色体系不变;金色只作烫金/旧金点缀,不作视觉主角。",
    ),
    "三视图": dict(
        scene="21:9 横幅角色转面设定板(正侧背布局),单图直出——canon 另带 resolution_override 3072×1024(每全身像≥1024px)。",
        liubai="中(推定:设定板/立绘系归档——本库判断,非手册原文)",
        spec="写角色身份与基础服化;恰六格逐格点名(09-20 裁定21 六形态定界+09-22 v2.1 规范):上半身像(底缘止腰)、正面全身、侧面全身、背面全身、正斜侧面全身、背斜侧面全身——视图序正斜在前、背斜在后;枚举一次、全肯定式,不写「三视图」三字(防诱导三格),砍计数断言与对齐指令;各全身格同一自然站姿,双手拢袖(手部规避方案A纪律);角色锁定四件套(发型/瞳色/服装/配饰);验收=像素带检测恰 6 格+零预设视觉判同人与无重复;多格同人合法,负向禁 clone/多人类 token(契约门禁)。",
    ),
    "高清人脸": dict(
        scene="1:1 方形头像特写,面部是画面焦点——出图后按 UI 圆/方裁切即得头像。",
        liubai="中(推定:立绘系特写归档——本库判断,非手册原文)",
        spec="写角色气质与五官设定;锚法(09-20 用户终审 V2 胜出)=人物句身份段**原样搬运**+特写取景段——同角色出人脸时,身份段逐字取自该角色的立绘主体句,这是 t2i 直出同脸的第一道锚(生产级同脸走 i2i 裁切精修 K2-人脸精修-道劫,denoise 0.35,A/B 档 0.25 更保身份)。",
    ),
    "分镜剧情图": dict(
        scene="16:9 单格叙事帧(叙事画面,非格子页、非分镜实体流)——剧情图与成片模板骨架的直出图,可加连环画媒介层(九型中唯一)。",
        liubai="高(手册点名:剧情图=高)",
        spec="写事件、动作、地点物件——事件与动作给到动词精度;多人剧情图合法(不挂 extra people 类负向);可复用成片模板 03/07/21/26 骨架;可整句追加连环画媒介层「中国连环画风格,白描线条细稳有笔性,平涂设色,线条像画出来而非勾边,传统设色淡而非旧」+「连环画分镜式构图」;duplicated/cloned 类负向仅禁用于多格同人型,本单格型不受该门禁约束(同一人无叙事理由重复出现,克隆属生成缺陷仍压);不走漫影分镜实体流(分镜域零实体口径,不产逐章逐镜文件)。",
    ),
    "表情差分": dict(
        scene="同角色表情差分资产——生产路=单表情单发+后期拼板;九宫格直出仅快览(②层 canon 底座=快览版式,1:1 九宫格上限 9,>9 走每表情整图流)。",
        liubai="中(推定:设定板系归档——本库判断,非手册原文)",
        spec="硬规则(09-20 裁定13):情绪名必须逐个配五官全覆盖物理描述(眉/眼/鼻颊/唇/头下颌五项逐项)+幅度放大词——只有情绪名=无效提示(K2 无法直接识别情绪词且会滑回沉静默认脸)。两路:快览路=一句点名九情绪(例一);生产路=单表情单发(例二)——每句只写一个情绪+五官物理描述,各拍头部角度与光源方向保持一致,拼板由后期承担,格名文字后期再加(生成期负向已压 text);活模板=apps/build/scripts/campaigns/daojie_emotion_compose_0920.py 九句。",
    ),
    "概念气氛图": dict(
        scene="16:9/21:9 自由构图氛围稿——立项定调用,情绪方向+少数焦点色,恒不做跨图一致性要求。",
        liubai="很高(手册点名:山水/概念=很高)",
        spec="写情绪方向与少数焦点色(衣带、灯火、符纸),并按场景点名留白载体(天空/水面/雪地/雾气/烟霭/暗部择一);底色色相按情绪色指定(②层只锁浅净、对比低);不写人;若焦点载体必须是人(如衣带属人),建议临时加挂人物系增量四锁(手册全员锁口径;甲案基准装配未挂,主体=灯火)。",
    ),
}

# 人物系六型(③层加挂 §四.4-.7 四把全员锁);非人物系=场景/道具/概念气氛图
RENWU_XI = {"人物", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分"}

# ④配色行映射(手册「精选方案示例」行名)
PALETTE_NAME = {
    "人物": "人物淡雅", "场景": "场景青绿", "道具": "道具旧金", "美宣": "人物淡雅",
    "三视图": "人物淡雅", "高清人脸": "人物淡雅", "分镜剧情图": "人物淡雅",
    "表情差分": "人物淡雅", "概念气氛图": "场景青绿",
}
PALETTE_PROV = {
    "人物": "甲案点名", "场景": "甲案点名", "概念气氛图": "甲案点名(概念同场景系)",
    "道具": "名称直配(手册精选方案行名与型名对应)",
}
PALETTE_DARK = "人物魔道=冷灰底+铁黑+靛蓝+暗赭+血朱砂(仅法印)"

# ── 通用锁层提取(与 research/09-jia_assemble.py 同则) ────────────────────

def strip_meta(t: str) -> str:
    """仅去「（硬,…)」类元语言括注与 markdown 符号,正文一字不动(甲案规格§剔除项)。"""
    t = re.sub(r"（硬[^）]*）", "", t)
    t = t.replace("（自动携带）", "")
    t = t.replace("**", "").replace("__", "")
    return t.strip()


def extract_lock_sections(md: str) -> dict:
    secs, cur = {}, None
    for ln in md.splitlines():
        m = re.match(r"^###\s+(\d)\.\s+", ln)
        if m:
            cur = m.group(1)
            secs[cur] = []
            continue
        if cur is None:
            continue
        if ln.startswith("###") or ln.startswith("## ") or ln.startswith("---"):
            cur = None
            continue
        if ln.strip():
            secs[cur].append(ln.strip())
    return {k: "\n".join(v) for k, v in secs.items()}


def extract_palette_row(md: str, name: str) -> str:
    """「精选方案示例」行按 ； 分段取 name=… 原文一段;段内「。」后尾注截去。"""
    for ln in md.splitlines():
        if "精选方案示例" in ln:
            body = ln.lstrip("> ").split("精选方案示例（色名组合，非硬约束）：", 1)[1]
            for part in body.split("；"):
                if part.startswith(name + "="):
                    return part.split("。", 1)[0].strip()
    raise SystemExit(f"配色行未找到: {name}")


def build_layers(bases_json: list, md: str) -> dict:
    secs = extract_lock_sections(md)
    assert set(secs) == set("12345678"), f"§四节抽取不齐: {sorted(secs)}"
    locks_common = [strip_meta(secs[k]) for k in ("1", "2", "8")]
    locks_renwu = [strip_meta(secs[k]) for k in ("1", "2", "4", "5", "6", "7", "8")]
    out = {}
    for e in bases_json:
        zh = e["zh"]
        out[zh] = dict(
            entry=e,
            locks=locks_renwu if zh in RENWU_XI else locks_common,
            pal=extract_palette_row(md, PALETTE_NAME[zh]),
        )
    return out


def assembly(zh: str, layers: dict, subject: str) -> str:
    return "\n".join([f"⟨①:{subject}⟩", layers[zh]["entry"]["positive"], *layers[zh]["locks"], layers[zh]["pal"]])


# ── 覆盖矩阵(字面在场核验,与 09-jia_assemble.py 同表;变体/不适用如实标注) ──

G = [
    ("1", "细墨线勾勒,线有粗细变化", [["细墨线勾勒", "线有粗细变化"]]),
    ("2", "细稳+笔性(带手绘笔性)", [["细稳基调", "手绘笔性"]]),
    ("3", "转折处轻重提按", [["转折处轻重提按"]]),
    ("4", "连续铁线描,线宽连续有节奏", [["连续铁线描", "线宽连续且有节奏"]]),
    ("5", "墨色浓淡分明", [["墨色浓淡分明"]]),
    ("6", "淡墨晕开远景/层层退远/远景淡化",
     [["淡墨晕开远景"], ["淡墨层层退远"], ["远处交给淡墨", "远景淡化"]]),
    ("7", "近处轮廓清楚(而细节少)", [["近处轮廓清楚"]]),
    ("8", "大面积素净暖白底/底色浅净", [["暖白底色"], ["底色浅净"]]),
    ("9", "墨与色落在平涂色场上", [["墨与色落在平涂色场上"]]),
    ("10", "传统色中等强度", [["传统色中等强度"]]),
    ("11", "一小块鲜明的点题色", [["一小块鲜明的点题色"]]),
    ("12", "矿物罩染薄透/颜色清透", [["薄透矿物罩染"], ["颜色清透"]]),
    ("13", "均匀柔光,平涂的底", [["均匀柔光", "平涂的底"]]),
    ("14", "前/中/远三层分开", [["前、中、远三层分开"]]),
    ("15", "中景用色块晕开(场景)", [["中景用色块晕开"]]),
    ("16", "现代修仙游戏的数字绘画资产(第一眼)", [["现代修仙游戏的数字绘画资产"]]),
    ("17", "留白承担(画面/视觉呼吸)", [["留白承担画面"], ["留白承担视觉呼吸"], ["负空间承担"]]),
    ("18", "画面干净可读/生产级清晰度", [["表面干净可读"], ["生产级最终画面清晰度"]]),
]

_SHE_DING = "设定板/特写版式"  # 道具/三视图/高清人脸/表情差分
NOTE = {
    ("1", "概念气氛图"): "◐ 型内变体:细墨线只勾近处轮廓,线有粗细变化(canon positive 原文句式)",
    ("5", "道具"): f"✗ 型底座原文无此句({_SHE_DING},色律=传统色只占一小块)",
    ("5", "三视图"): f"✗ 型底座原文无此句({_SHE_DING},色律=传统色素净)",
    ("5", "高清人脸"): f"✗ 型底座原文无此句({_SHE_DING},色律=传统色微微染开)",
    ("5", "表情差分"): f"✗ 型底座原文无此句({_SHE_DING},色律=各格底色相同)",
    ("6", "道具"): "◐ 通用锁层「淡墨晕染、远景淡化」承担(型底座为设定板,无远景句)",
    ("6", "三视图"): "◐ 通用锁层「淡墨晕染、远景淡化」承担(型底座为设定板,无远景句)",
    ("6", "高清人脸"): "◐ 通用锁层「淡墨晕染、远景淡化」承担(型底座为特写,无远景句)",
    ("6", "表情差分"): "◐ 通用锁层「淡墨晕染、远景淡化」承担(型底座为格子页,无远景句)",
    ("6", "美宣"): "◐ 型内变体:背景用淡墨退去(canon positive 原文;③锁层「远景淡化」在场)",
    ("6", "分镜剧情图"): "◐ 型内变体:远景用淡墨退去(canon positive 原文;③锁层「远景淡化」在场)",
    ("7", "场景"): "✗ 型底座原文无此句;近处由「细墨线勾勒近处」承担线法(甲案同判)",
    ("7", "美宣"): "✗ 型底座原文无此句(「背景用淡墨退去,比主体简」承担近简关系)",
    ("7", "分镜剧情图"): "✗ 型底座原文无此句(「远景用淡墨退去」承担远近关系)",
    ("7", "道具"): f"— {_SHE_DING},近处轮廓概念不适用",
    ("7", "三视图"): f"— {_SHE_DING},近处轮廓概念不适用",
    ("7", "高清人脸"): f"— {_SHE_DING},近处轮廓概念不适用",
    ("7", "表情差分"): f"— {_SHE_DING},近处轮廓概念不适用",
    ("8", "道具"): "◐ canon 原文=摆在浅净底上;③锁层=只用浅净哑光平涂底",
    ("8", "三视图"): "◐ canon 原文=浅净平涂底",
    ("8", "高清人脸"): "◐ canon 原文=纯色平涂底",
    ("8", "表情差分"): "◐ ③锁层承担(②版式句=各格底色相同)",
    ("10", "场景"): "◐ 型内变体:颜色清透(canon positive 原文无「中等强度」;甲案同判)",
    ("10", "概念气氛图"): "◐ 型内变体:对比低(canon positive 原文无「中等强度」;甲案同判)",
    ("10", "道具"): "◐ 型内变体:传统色只占一小块",
    ("10", "三视图"): "◐ 型内变体:传统色素净",
    ("10", "高清人脸"): "◐ 型内变体:传统色微微染开",
    ("10", "表情差分"): "✗ 型底座无色律句(版式骨干型,色律归①主体句与④配色行)",
    ("11", "分镜剧情图"): "◐ canon 原文=一小块点题色(无「鲜明」二字)",
    ("11", "道具"): "◐ 型内变体:传统色只占一小块",
    ("11", "三视图"): "◐ 型内变体:只占一小块",
    ("11", "高清人脸"): "✗ 型底座无点题句(色律=色彩匀净)",
    ("11", "表情差分"): "✗ 型底座无点题句(色律归①主体句与④配色行)",
    ("13", "三视图"): "◐ canon 原文=浅净平涂底,均匀柔光(句序倒装,无「的」)",
    ("13", "高清人脸"): "◐ canon 原文=纯色平涂底,均匀柔光(句序倒装,无「的」)",
    ("14", "人物"): "— 立绘型不适用(research/06 同判)",
    ("14", "美宣"): "— 焦点主体型不适用(同立绘判)",
    ("14", "分镜剧情图"): "◐ canon 原文=前景、中景、远景层层分开",
    ("14", "概念气氛图"): "◐ 近/远两层+远景压住,无「三层」字样(甲案同判)",
    ("14", "道具"): f"— {_SHE_DING},无景深三层要求",
    ("14", "三视图"): f"— {_SHE_DING},无景深三层要求",
    ("14", "高清人脸"): f"— {_SHE_DING},无景深三层要求",
    ("14", "表情差分"): f"— {_SHE_DING},无景深三层要求",
    ("15", "人物"): "— 场景型专属(research/06 同判)",
    ("15", "道具"): "— 场景型专属(research/06 同判)",
    ("15", "美宣"): "— 场景型专属(research/06 同判)",
    ("15", "三视图"): "— 场景型专属(research/06 同判)",
    ("15", "高清人脸"): "— 场景型专属(research/06 同判)",
    ("15", "分镜剧情图"): "— 场景型专属(research/06 同判)",
    ("15", "表情差分"): "— 场景型专属(research/06 同判)",
    ("15", "概念气氛图"): "— 场景型专属(research/06 同判)",
    ("17", "人物"): "✗ 型底座与通用锁层均无「留白承担」字样;暖白底色近义承担(甲案同判)",
    ("17", "美宣"): "✗ 同人物判:暖白底色近义承担",
    ("17", "道具"): "✗ 同人物判:浅净底近义承担",
    ("17", "三视图"): "✗ 同人物判:浅净平涂底近义承担",
    ("17", "高清人脸"): "✗ 同人物判:纯色平涂底近义承担",
    ("17", "分镜剧情图"): "✗ 同人物判:暖白底色近义承担",
    ("17", "表情差分"): "✗ 同人物判:各格底色近义承担",
}


_GM = {g[0]: g for g in G}


def backbone_mark(num: str, zh: str, full: str) -> str:
    for group in _GM[num][2]:
        if all(s in full for s in group):
            return "✔"
    key = (num, zh)
    assert key in NOTE, f"矩阵单元缺注记: {key}(raw ✗ 须有 ◐/✗/— 注记)"
    return NOTE[key]


def matrix_tables(zh_order: list, layers: dict) -> tuple[list, list]:
    rows18 = []
    for num, name, _ in G:
        cells = []
        for zh in zh_order:
            full234 = "\n".join([layers[zh]["entry"]["positive"], *layers[zh]["locks"], layers[zh]["pal"]])
            cells.append(backbone_mark(num, zh, full234))
        rows18.append((num, name, cells))
    secs = extract_lock_sections(PREFIX.read_text(encoding="utf-8"))
    SL = {k: strip_meta(secs[k]) for k in "1245678"}
    rows8 = []
    lock_rows = [
        ("型底座(② positive 全文照抄)", lambda a: "✔"),
        ("风格底座锁(§四.1)", lambda a: "✔" if SL["1"] in a else "✗"),
        ("工笔结构锁(§四.2)", lambda a: "✔" if SL["2"] in a else "✗"),
        ("成片质量锁(§四.8)", lambda a: "✔" if SL["8"] in a else "✗"),
        ("衣褶裙摆锁(§四.4)", lambda a: "✔" if SL["4"] in a else "—"),
        ("衣物完整锁(§四.5)", lambda a: "✔" if SL["5"] in a else "—"),
        ("头发存在锁(§四.6)", lambda a: "✔" if SL["6"] in a else "—"),
        ("鞋靴性别锁(§四.7)", lambda a: "✔" if SL["7"] in a else "—"),
    ]
    for name, fn in lock_rows:
        cells = []
        for zh in zh_order:
            full234 = "\n".join([layers[zh]["entry"]["positive"], *layers[zh]["locks"], layers[zh]["pal"]])
            cells.append(fn(full234))
        rows8.append((name, cells))
    return rows18, rows8


# ── 文档构建 ──────────────────────────────────────────────────────────────

def build_doc() -> str:
    bases_json = json.loads(BASES.read_text(encoding="utf-8"))
    zh_order = [e["zh"] for e in bases_json]
    assert len(zh_order) == 9, f"canon 应九型,得 {len(zh_order)}"
    md_prefix = PREFIX.read_text(encoding="utf-8")
    layers = build_layers(bases_json, md_prefix)
    rows18, rows8 = matrix_tables(zh_order, layers)

    L = []
    A = L.append
    A("# 05 · 道劫规范提示词库(canon 九型·甲案全中文,四层装配)")
    A("")
    A("> **一句话结论**:本库把道劫 canon 九型(`apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json` 的九型 zh 为型录与顺序)量产成 **9 条甲案全中文装配**——每型一节,四层装配逐层成文:**①主体句槽**(⟨①:…⟩,预置例一,每型另给 2 条示例与主体句规范)+**②型底座**(该型 positive 原文照抄)+**③通用锁层**(手册 prefix.md §四.1/2/8 三段全文;人物系六型再并 §四.4-7 四把全员锁;提取只去元语言标注,正文一字不动)+**④配色职责行**(手册「精选方案示例」对应型原文一行);库首附**完整通用锁层常量**供工作流恒挂层直接取用;文末附覆盖矩阵自检(canon 18 骨干+八锁 × 九型,逐项打勾并如实标注未覆盖项)与禁混条款五则。三层取材**零蒸馏零改写**,装配式=09-23 round5-jia 实拍验证的同款机械拼装(三拍装配全文经引擎 /history 全量 JSON 逐字核验,status 全 success;见 research/09-甲案装配全文.md 实拍记录)。")
    A("")
    A("- 基准日:2026-09-23;口径=**甲案(手册直书·全库中文)**——任务令,规格真源 `.trellis/tasks/09-23-qwen-image-21-research/research/09-甲案小样装配规格.md`,双案背景见 research/07 §五(甲=手册为骨/乙=宪法为骨,同题 A/B 已实拍并排于 `~/Downloads/qwen21-e2e-0923/` round5 与 round5-jia,审美判定=用户终审;本轮按任务口径取甲)。")
    A("- 真源四件:①型录/型底座/画幅=`daojie_bases.json`(九型 zh 顺序,positive 字段=锁质词法样张);②通用锁层/配色/留白分档/连环画媒介层=手册 `prefix.md`(仓库副本 `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/prefix.md`,与装机手册家 diff 逐字节一致,09-23 本轮核验);③主体句示例=`docs/prompts/道劫_九型主体句示例.md`;④风格真源与背景=research/06(锁质清单与旧 16 条偏差对照)、07(手册本体 vs 旧 16 条深度对比)、08(LoRA 搜集:Q2.1 水墨工笔 LoRA 生态零件,画风增益全靠底座词法)。")
    A("- 旧库处置:本文件前版(16 条英文长文,人物/场景/道具/美宣各 4)已随本轮甲案重写**整体退役**——其宪法结构达标但手册锁质缺失/降格,六大缺陷模式逐条点名见 research/06 §3.1(纸纹赞美词 16/16 违规、「expressive brushwork」概括顶替、色板塌缩灰白化、「现代游戏资产」第一眼缺席、底色写成 empty paper、工笔硬锁未落地);Q2.1 侧 PE 改写路([14] true)不受本库影响,仍走官方宪法。")
    A("")
    A("---")
    A("")
    A("## 一、用法(四层装配·一处换句)")
    A("")
    A("**装配顺序**(照甲案,各层原文照抄):")
    A("")
    A("```text")
    A("[①主体句·题材正文](七段公式简写,短——本库 ⟨①:…⟩ 槽,唯一手写位)")
    A("+ [②型底座·纯画法锁质](daojie_bases.json 对应型 positive 全文照抄)")
    A("+ [③通用锁层](prefix.md §四.1 风格底座锁 + §四.2 结构锁 + §四.8 成片质量锁 三段全文;")
    A("                人物系六型再并 §四.4 衣褶 + §四.5 衣物完整 + §四.6 头发 + §四.7 鞋靴 四把全员锁)")
    A("+ [④配色职责行](prefix.md 配色五职责节「精选方案示例」对应型原文一行)")
    A("```")
    A("")
    A("**三步用库**:")
    A("")
    A("1. **挑型**:按型录九选一(画幅档/留白档随型,见各型节首),整段复制该型「装配全文」代码块。")
    A("2. **换槽**:把首行 ⟨①:…⟩ 整段角括号(**连括号**)换成你的主体句(参考该型主体句规范与 2 条示例);不换也成立,槽内已预置例一。换完跑重叠预检(见下「主体句纪律」第 5 条)。")
    A("3. **贴画布**:直写件 `qwen21-daojie-t2i.json` **[13] 道劫·直写提示词**([14] 道劫·提示词开关保持 false=直写;round5-jia 三拍即此路);**[4] 道劫·分辨率选择** 切该型画幅档;**换型=整段换装配全文**(②③④随型走),不跨型拼装。pro 装配件 `qwen21-daojie-t2i-pro.json` 的底座区/选型开关为旧 16 条英文库的对接,九路级联改造由工作流侧另行落位(research/07 §六:pro 工作流九路级联/主体句槽复用)。")
    A("")
    A("**长度口径**:手册长度契约 300-800 字符(prefix.md:230)约束的是 ma-gongbi-v1 编译器装配的 LLM 生成路;本库直写槽路无编译器长度门,按 round5-jia 实拍口径(装配全文 1475-2086 字符含换行)整段注入,Q2.1 直写槽不截断(实拍 /history 逐字核验,2086/1475/1481 字符全等)。")
    A("")
    A("**主体句纪律**(五则,取用/新写主体句通用):")
    A("")
    A("1. 主体句**只写主体与画面,不重复风格词**——线条/墨色/设色/完成度 DNA 由②③层自动携带,写风格词=与底座双写。")
    A("2. **场景/概念气氛不写人**(该两型人物交给负向纪律;Q2.1 cfg=1 负向不参与采样,由①层「不写人」约定承担,空镜句尾可明写「空镜无人」)。")
    A("3. **同画面朝代统一**(汉唐宋明历代均可);历史向服饰按朝代实名+身份+地位+成套点名。")
    A("4. **全角标点**。")
    A("5. **发放前强制预检**:`python3 apps/build/scripts/daojie_subject_overlap_0922.py --base 型名 --subject \"句子\"`——与该型底座出现 ≥10 字公共子串即重复块,须去重或明示接受(本库 18 条示例的预检结果见文末自查记录)。")
    A("")
    A("**④配色行映射**(手册「精选方案示例」原文一行,非硬约束;冲突时以角色/场景设定事实为准):")
    A("")
    A("| 型 | ④配色行 | 映射依据 |")
    A("|---|---|---|")
    for zh in zh_order:
        prov = PALETTE_PROV.get(zh, "人物系型本库补位映射(甲案未点名,按型主体=人物归「人物淡雅」)")
        A(f"| {zh} | {layers[zh]['pal']} | {prov} |")
    A("")
    A(f"> 人物系型遇魔道/邪道设定(Source facts 显式启用,手册暗色分支)时,④行换用「{PALETTE_DARK}」。")
    A("")
    A("**表情差分两路**:生产路=**单表情单发+后期拼板**(09-20 裁定13+活模板 daojie_emotion_compose_0920.py,每表情独立整图再拼);九宫格直出仅快览——本库②层 canon 底座=快览版式,单发时主体句只写一格的半身与该表情五官全覆盖描述(见该型节)。")
    A("")
    A("## 二、通用锁层常量(供工作流恒挂层直接取用)")
    A("")
    A("工作流把 ③ 层做恒挂节点时,直接取下面两常量(逐字);**基础常量**全九型恒挂,**人物系增量常量**由人物系六型(人物/美宣/三视图/高清人脸/分镜剧情图/表情差分)加挂在基础常量之后、成片质量锁之前(序=§四.1→§四.2→§四.4→§四.5→§四.6→§四.7→§四.8,甲案同序)。")
    A("")
    secs = extract_lock_sections(md_prefix)
    A("**常量 A·基础(§四.1→§四.2→§四.8,全九型恒挂)**:")
    A("")
    A("```text")
    A("\n".join([strip_meta(secs[k]) for k in ("1", "2", "8")]))
    A("```")
    A("")
    A("**常量 B·人物系增量(§四.4→§四.5→§四.6→§四.7,人物系六型加挂)**:")
    A("")
    A("```text")
    A("\n".join([strip_meta(secs[k]) for k in ("4", "5", "6", "7")]))
    A("```")
    A("")
    A("提取口径:仅去「（硬,…)」类元语言括注与 markdown 符号,正文一字不动(甲案规格§剔除项;round5-jia 实拍装配零蒸馏核验=仅删元语言括注 10 处,其余逐字)。配色行提取=按「；」分段取「型名=」起始段,段内「。」后尾注截去。守恒校验:`python3 apps/build/scripts/daojie_canon_lib_0923.py --check`(### 计数/型名对齐/围栏配对/②③④逐字对齐)。")
    A("")
    A("## 三、九型装配(型录与顺序=daojie_bases.json)")
    A("")
    for zh in zh_order:
        e = layers[zh]["entry"]
        p = SECTION_PROSE[zh]
        s1, s2, (prov1, prov2) = SUBJECTS[zh]
        A(f"### {zh}-基础")
        A("")
        A(f"**适用场景**:{p['scene']}")
        A("")
        ar = e["aspect_ratio"]
        mp = e["megapixels"]
        extra = ""
        if e.get("resolution_override"):
            extra = f"(canon 另带 resolution_override {'×'.join(str(x) for x in e['resolution_override'])},单图直出)"
        A(f"**画幅档**:`{ar}` · {mp}MP(daojie_bases.json {zh} aspect_ratio·megapixels){extra}。**留白档**:{p['liubai']}。")
        A("")
        A("**装配全文**(①槽预置=例一;换主体=整段角括号连括号换句,②③④恒层不动):")
        A("")
        A("```text")
        A(assembly(zh, layers, s1))
        A("```")
        A("")
        A(f"**主体句规范**:{p['spec']}")
        A("")
        A("**示例主体句**:")
        A("")
        A(f"- 例一({prov1}):「{s1}」")
        A(f"- 例二({prov2}):「{s2}」")
        A("")
    A("---")
    A("")
    A("## 四、禁混条款(五则)")
    A("")
    A("1. **两制禁混(甲案中文直书 vs PE/乙案英文长文)**。本库=甲案全中文四层装配;同一拍进 [6] 编码节点的文本只能是其一——[14] false 时 [13] 应为本库中文装配全文,[14] true 时走 [12] PE 改写路(中文种子句进、英文长文出)。英汉两制混拼(如英文长文里粘中文锁层、中文装配尾接英文底座)=违规;画内引号文字不受此限。前版 16 条英文长文库已随本轮重写退役,不得再取作底座或槽句。")
    A("2. **K2 装配结构与 LoRA 栈假设禁入**。K2 道劫=「底座在前+[50] 主体句零分隔符直拼」(道劫_底座节点_0918.md:4)且依赖九型 LoRA 配方;本库甲案=**主体句领头**+②③④层**换行分层**(round5-jia 实拍注入即此式),Q2.1 侧水墨工笔 LoRA 生态零件(research/08)——画风增益全靠四层词法。按 K2 词序拼装、零分隔符直拼、或把 K2 LoRA 配方当本库前提=违规。②层取材唯一真源=daojie_bases.json 该型 positive(与 K2 共享 canon,取的是 positive 字段本身,不是 K2 装配行为)。")
    A("3. **K2 负向 token 串禁粘正向**。Q2.1 件 cfg 恒 1,官方模板 Note 原文「negative_prompt: unused while cfg is 1.」——负向槽留空即可;K2 按型英文负面(thick anime outline 一族)、[64] 中文负向基线、手册五类必含负面词都不得粘进本库装配全文。手册反向规避行的纪律在 Q2.1 由③层正向画法语言承担(禁项→正向转写,如禁纸纹→「画面保持干净平滑:墨与色落在平涂色场上,而非有纹理的纸面」)。")
    A("4. **质量词、比例词与否定式禁入①层**。masterpiece/8K/highly detailed/award-winning/best quality/ultra detailed 六词禁入主体句(本仓加严表,契约测试同表);比例/分辨率/像素数不写正文,画幅走 [4] 分辨率节点;SD 权重语法(如 `(masterpiece:1.2)`)禁(手册同禁);①层题材正文不出现「不要/禁止/严禁」句式——负面要求全进 Negative Prompt 段(手册装配纪律;③层锁文自带禁令属手册原文照抄的自动层,不在此限)。")
    A("5. **题材防漂移三则**。历史向服饰禁只写泛称,按朝代实名+身份+地位+成套点名且同画面朝代统一;场景/气氛类不写人;金色只作烫金/旧金点缀,不作视觉主角(X6:金色过多/体积光/rim light/云海神龙法阵禁——战斗/技能演出镜头豁免,美宣与分镜型的既定口径,线条与传统色体系在镜头间隙保持恒定)。")
    A("")
    A("## 五、覆盖矩阵自检(canon 18 骨干 + 八锁 × 九型)")
    A("")
    A("口径:与甲案矩阵同法(research/09-甲案装配全文.md)——对每型 **②③④恒层装配全文**(①主体句槽是变量层,不入矩阵)做**字面在场核验**;✔=判据字面子串组全中;◐=型内变体(该型 canon positive 原文的变体句式);✗=字面缺席(如有近义承担则注明);—=型内不适用。生成命令:`python3 apps/build/scripts/daojie_canon_lib_0923.py`(矩阵随文档同步再生成,改词即同步)。")
    A("")
    A("**矩阵一:canon 18 骨干 × 九型**")
    A("")
    A("| # | 锁质骨干(research/06 骨干萃取,中文侧) | " + " | ".join(zh_order) + " |")
    A("|---|---|" + "---|" * 9)
    for num, name, cells in rows18:
        A(f"| {num} | {name} | " + " | ".join(cells) + " |")
    A("")
    A("**矩阵二:八锁(②型底座+③通用锁层)× 九型**")
    A("")
    A("| 锁 | " + " | ".join(zh_order) + " |")
    A("|---|" + "---|" * 9)
    for name, cells in rows8:
        A(f"| {name} | " + " | ".join(cells) + " |")
    A("")
    A("> §四.3 身份一致性锁:不适用(t2i 无角色参考图,手册自身条件限定「提供身份参考图时」)。")
    A("> 场景/道具/概念气氛图(非人物系)的四把全员锁(衣褶/衣物/头发/鞋靴)按装配规格仅人物系六型拼装,标「—」=规格使然,非缺失(甲案同判);概念型主体句若写人,可临时加挂常量 B。")
    A("> 未覆盖项汇总(如实):骨干 5(墨色浓淡分明)在道具/三视图/高清人脸/表情差分四型字面缺席;骨干 17(留白承担)在场景/概念气氛图之外七型字面缺席(暖白/浅净底近义承担);骨干 10/11 的「传统色中等强度/一小块鲜明的点题色」在设定板/特写/格子页诸型以 canon 变体句或让渡①④层承担;骨干 7 在设定板四型不适用。以上均为 canon positive 原文照抄的型内事实,本库不做补写(改②层须先改 daojie_bases.json canon)。")
    A("")
    A("**自查记录(生成器实跑)**")
    A("")
    chars = []
    for zh in zh_order:
        full = assembly(zh, layers, SUBJECTS[zh][0])
        chars.append(f"{zh} {len(full.replace(chr(10), ''))}")
    A(f"- 三级标题计数:恰 {len(zh_order)}(『### 型-基础』×9),型名与 daojie_bases.json 九型 zh 逐字对齐、顺序一致;非条目三级标题 0(矩阵/自查小节均用粗体引导,不占 ###)。")
    A(f"- 装配全文字符数(①槽展平为例一,含换行):{'、'.join(chars)}。")
    A("- 围栏配对、### 计数、②③④逐字对齐:`--check` 实跑全绿(校验内容=文件 ### 标题恰为九型『### {型}-基础』序列、每 ```text 围栏闭合、每型装配全文去①槽行后与 ②positive+③锁层+④配色行 逐字节相等、库首两常量与 prefix.md 提取逐字节相等)。".replace("{型}", "型"))
    A("- 主体句重叠预检(18 条示例 × 各自型底座,daojie_subject_overlap_0922.py 同判据 ≥10 字公共子串,生成器逐条实跑):**18/18 零重复**;CLI 抽查(人物例一/表情差分例二/道具例二)三条同绿。")
    A("")
    return "\n".join(L) + "\n"


# ── 校验 ─────────────────────────────────────────────────────────────────

def check() -> int:
    bases_json = json.loads(BASES.read_text(encoding="utf-8"))
    zh_order = [e["zh"] for e in bases_json]
    md_prefix = PREFIX.read_text(encoding="utf-8")
    layers = build_layers(bases_json, md_prefix)
    doc = OUT.read_text(encoding="utf-8")
    errs = []

    headings = re.findall(r"^### (.+)$", doc, re.M)
    expect_headings = [f"{zh}-基础" for zh in zh_order]
    if headings != expect_headings:
        errs.append(f"### 标题不符(应恰 9 型):得 {headings}")
    type_headings = [h for h in headings if h.endswith("-基础")]
    if type_headings != [f"{zh}-基础" for zh in zh_order]:
        errs.append(f"九型节标题/顺序不符:得 {type_headings}")

    fences = re.findall(r"^```", doc, re.M)
    if len(fences) % 2 != 0:
        errs.append(f"围栏不配对:``` 行数 {len(fences)} 为奇数")
    opens = re.findall(r"^```text$", doc, re.M)
    if len(fences) != 2 * len(opens):
        errs.append(f"围栏开口非 ```text:``` 共 {len(fences)},```text 共 {len(opens)}")

    # 每型装配全文:去①槽行后 == ②+③+④
    for zh in zh_order:
        m = re.search(rf"^### {re.escape(zh)}-基础\s*$", doc, re.M)
        if not m:
            errs.append(f"缺节: {zh}")
            continue
        nxt = re.search(r"^### ", doc[m.end():], re.M)
        seg = doc[m.end(): m.end() + nxt.start()] if nxt else doc[m.end():]
        fence = re.search(r"```text\n(.*?)\n```", seg, re.S)
        if not fence:
            errs.append(f"{zh}: 缺装配全文围栏")
            continue
        body = fence.group(1)
        lines = body.split("\n")
        if not (lines[0].startswith("⟨①:") and lines[0].endswith("⟩")):
            errs.append(f"{zh}: 装配全文首行非 ⟨①:…⟩ 槽")
            continue
        expect234 = "\n".join([layers[zh]["entry"]["positive"], *layers[zh]["locks"], layers[zh]["pal"]])
        got234 = "\n".join(lines[1:])
        if got234 != expect234:
            errs.append(f"{zh}: ②③④层与真源不逐字一致")

    # 库首两常量
    secs = extract_lock_sections(md_prefix)
    const_a = "\n".join([strip_meta(secs[k]) for k in ("1", "2", "8")])
    const_b = "\n".join([strip_meta(secs[k]) for k in ("4", "5", "6", "7")])
    fences_all = re.findall(r"```text\n(.*?)\n```", doc, re.S)
    if const_a not in fences_all:
        errs.append("常量 A 与 prefix.md 提取不一致")
    if const_b not in fences_all:
        errs.append("常量 B 与 prefix.md 提取不一致")

    if errs:
        print("❌ 守恒校验未过:")
        for e in errs:
            print("  -", e)
        return 1
    print(f"✅ 守恒校验全绿:### 恰 {len(headings)}(九型『型-基础』节,型名/顺序与 canon 逐字对齐);"
          f"``` 围栏 {len(fences)} 行({len(fences)//2} 对)全配对;九型 ②③④ 层与真源逐字一致;常量 A/B 与手册提取逐字一致。")
    return 0


def verify_jia() -> int:
    """③锁层提取与 round5-jia 实拍装配逐字对齐(实拍真值=~/Downloads/.../jia-*-prompt.txt)。"""
    jia = {
        "人物": ("jia-renwu-prompt.txt",
                 "一位青岩剑宗的女剑修，二十余岁，气质清冷出尘，墨黑长发及腰半束，素色道袍长裙，腰束石青丝绦，左手按剑立于身前，目光沉静望向画外，全身立绘。"),
        "场景": ("jia-changjing-prompt.txt",
                 "春日山间灵溪谷谷口，晨雾未散，溪上架一座旧木桥，空镜无人。"),
        "概念气氛图": ("jia-gainian-prompt.txt",
                     "深山寒夜，一点灯火，孤寂而安宁的守候。"),
    }
    bases_json = json.loads(BASES.read_text(encoding="utf-8"))
    layers = build_layers(bases_json, PREFIX.read_text(encoding="utf-8"))
    rc = 0
    for zh, (fname, subject) in jia.items():
        p = JIA_DIR / fname
        if not p.is_file():
            print(f"⚠️ {zh}: 实拍文件缺失 {p}(跳过)")
            continue
        expect = "\n".join([subject, layers[zh]["entry"]["positive"], *layers[zh]["locks"], layers[zh]["pal"]])
        got = p.read_text(encoding="utf-8")
        # jia 文件以单个换行结尾与否不影响内容比对:按 rstrip("\n") 归一
        if got.rstrip("\n") == expect.rstrip("\n"):
            print(f"✅ {zh}: 与 round5-jia 实拍装配逐字节一致({len(got.rstrip(chr(10)))} 字符)")
        else:
            print(f"❌ {zh}: 与实拍装配不一致")
            rc = 1
    return rc


def overlap_check() -> int:
    """18 条示例 × 各自型底座 重叠预检(daojie_subject_overlap_0922.py 同判据同实现)。"""
    bases_json = json.loads(BASES.read_text(encoding="utf-8"))
    pos = {e["zh"]: e["positive"] for e in bases_json}
    rc = 0
    print("主体句重叠预检(判据=≥10 字公共子串即重复块):")
    for zh, (s1, s2, _) in SUBJECTS.items():
        for tag, s in (("例一", s1), ("例二", s2)):
            found = []
            for clause in re.split(r"[；。]", s):
                clause = clause.strip()
                if len(clause) < 10:
                    continue
                m = difflib.SequenceMatcher(None, clause, pos[zh]).find_longest_match(0, len(clause), 0, len(pos[zh]))
                if m.size >= 10:
                    found.append((clause[m.a:m.a + m.size], m.size))
            if found:
                rc = 1
                for common, size in found:
                    print(f"  ⚠️ {zh}{tag} 重复块 {size}字:「{common}」")
            else:
                print(f"  ✅ {zh}{tag}:与底座零重复")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="守恒校验磁盘文件")
    ap.add_argument("--verify-jia", action="store_true", help="③锁层与 round5-jia 实拍装配对齐")
    ap.add_argument("--overlap", action="store_true", help="18 条示例重叠预检")
    a = ap.parse_args()
    if a.check:
        return check()
    if a.verify_jia:
        return verify_jia()
    if a.overlap:
        return overlap_check()
    doc = build_doc()
    OUT.write_text(doc, encoding="utf-8")
    print(f"生成 → {OUT}({len(doc)} 字符)")
    rc = check()
    rc |= overlap_check()
    return rc


if __name__ == "__main__":
    sys.exit(main())
