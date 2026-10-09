#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""道劫九型底座·线描层增补(09-18 线描轮第1步,主会话 escalate 应答裁定 A:上限
800→1000,B 案砍博物馆/纸纹护栏换空间已明文否决;第2步审读修正:「笔性手绘」
倒装六处→「带手绘笔性」人物型范式(含审读未列举的同串第六例·分镜剧情图)+
「不均权」生造词→「、不等权重」,已同步本脚本 SPECS)。

输入权威:docs/prompts/三国望神州_线描.md(五字模型 细稳变构笔;§20 推荐清单全量落负向)。
动作(每型):
  1) positive 在既有线描句之后插入线描句(构/变/笔按型取舍,全角标点、自然成句);
  2) positive 删点名冗余修饰语(不动事实/身份/构图/钉死锚点);
  3) negative 末尾追加 Line Negative 族 9 token(与现有 token 去重门);
  4) docs/prompts/道劫_底座节点_0918.md 九围栏逐字同步 + 附二 L78/L80/L81 口径对齐。
自检:九型定序/开头收尾/钉死关键词/脏词/禁句式/半角标点/色号/CJK 负面/clone 门禁/长度 300-1000。
幂等:已应用则直接退出(检测 negative 尾与围栏一致)。
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
JSON_PATH = ROOT / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
MD_PATH = ROOT / "docs/prompts/道劫_底座节点_0918.md"

NEG_ADD = ("thick anime outline, bold black outline, uniform outline, vector outline, "
           "mechanical linework, cel-shading outline, western comic inking, "
           "sticker-like contour, plastic contour")

# 每型:线描句(插在 INSERT_AFTER 锚后)+点名冗余删除(精确子串,须唯一)
SPECS: dict[str, dict] = {
    "人物": {
        "add": "线条以解释形体为先，五官衣褶结构线随骨相走，细稳基调上转折处轻重提按，墨线带手绘笔性。",
        "after": "线宽连续有节奏、转折衔接干净；",
        "del": ["，清晰视觉焦点", "，立绘资产风格统一", "平静"],
    },
    "场景": {
        "add": "轮廓密度分远近：前中景线条明确可读，远景线弱化淡出，细稳基调上随景深轻重提按，笔性疏朗。",
        "after": "山石皴擦纹理可辨；",
        "del": ["、留白承担视觉呼吸", "，清晰视觉焦点", "，画面干净可读"],
    },
    "道具": {
        "add": "线条以器物构造为先，形制边缘与灵纹转折结构可读，细稳基调上轻重提按分明，带手绘笔性而不板结。",
        "after": "纯静物独立陈列；",
        "del": ["，画面干净可读", "，资产可直接进生产"],
    },
    "美宣": {
        "add": "线条解释五官衣褶与主体结构，随叙事焦点轻重提按，带手绘笔性而有表现力。",
        "after": "线宽连续有节奏；",
        "del": ["，画面干净可读", "，主视觉气质统一"],
    },
    "三视图": {
        "add": "细稳基调上随形体轻重提按，发丝衣褶结构线可读，带手绘笔性、跨格笔意一致。",
        "after": "全身线条结构明确；",
        "del": ["如设定集一页", "，画面干净可读"],
    },
    "高清人脸": {
        "add": "细稳基调上随骨相轻重提按，发丝线轻重有别、不等权重，眉眼神采由手绘笔性带出。",
        "after": "神情贴合角色身份与年龄；",
        "del": ["，画面干净可读", "，头像资产风格统一"],
    },
    "分镜剧情图": {
        "add": "线条解释脸手衣褶与关键物件结构，动作重心处线重略提，带手绘笔性、连贯如连环画笔意。",
        "after": "动作重心真实；",
        "del": ["，画面干净可读", "，镜头语言清晰"],
    },
    "表情差分": {
        "add": "五官发丝衣褶结构线跨格一致，线重随神情轻重提按，细稳基调上带手绘笔性。",
        "after": "微表情层次细腻连贯；",
        "del": ["，画面干净可读", "，表情库资产风格统一"],
    },
    "概念气氛图": {
        "add": "轮廓线少而笔性从容，墨线以手绘笔意轻写，不与墨韵争主导。",
        "after": "细节少而轮廓准，清晰视觉焦点；",
        "del": ["，画面干净可读", "，情绪基调先行"],
    },
}

ORDER = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]
MD_TAIL = "仙道古韵，气韵深远，完成度高的画作。"
DIRTY = ("宣纸", "工笔线描", "工笔白描", "写意泼墨", "xuan", "做旧", "泛黄", "纸纹")
OLD_ANCHORS = ("最佳质量", "杰作", "高细节", "水墨国风", "新中式", "masterpiece", "best quality", "high detail")
PROHIBIT = ("不要", "禁止", "严禁", "避免", "而非")
CLONE_TOKENS = ("cloned", "duplicated", "multiple people", "extra characters", "person", "human figure")
_CJK = re.compile(r"[\u4e00-\u9fff]")
_HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")


def md_fence_lines(lines: list[str], zh: str) -> tuple[int, int]:
    """『## {zh}』标题后首个 ```text 围栏的(内容起,内容止)行号,与契约测试同法。"""
    start = next(i for i, ln in enumerate(lines) if ln.startswith(f"## {zh}"))
    j = next(k for k in range(start, len(lines)) if lines[k].startswith("```text"))
    end = next(k for k in range(j + 1, len(lines)) if lines[k].startswith("```"))
    return j + 1, end


def main() -> int:
    raw = JSON_PATH.read_text(encoding="utf-8")
    data = json.loads(raw)
    md_text = MD_PATH.read_text(encoding="utf-8")

    # 幂等门:negative 已带新尾且围栏==json → 已应用
    already = all(e["negative"].endswith(NEG_ADD) for e in data) and all(
        "\n".join(md_text.splitlines()[slice(*md_fence_lines(md_text.splitlines(), e["zh"]))]) == e["positive"]
        for e in data)
    if already:
        print("已应用,幂等退出")
        return 0

    # 格式回写一致性门(防整文件重排)
    assert json.dumps(data, ensure_ascii=False, indent=2) + "\n" == raw, \
        "JSON 现格式与 indent=2 回写不一致,拒绝盲写"

    assert [e["zh"] for e in data] == ORDER, "九型定序漂移"
    report: list[str] = []
    for e in data:
        zh = e["zh"]
        spec = SPECS[zh]
        pos, neg = e["positive"], e["negative"]

        for d in spec["del"]:  # 冗余删除:必须唯一命中
            assert pos.count(d) == 1, f"「{zh}」删除锚非唯一/缺失: {d!r}(count={pos.count(d)})"
            pos = pos.replace(d, "", 1)
        anchor = spec["after"]
        assert pos.count(anchor) == 1, f"「{zh}」插入锚非唯一/缺失: {anchor!r}"
        pos = pos.replace(anchor, anchor + spec["add"], 1)

        toks = [t.strip() for t in neg.split(",")]
        add_toks = [t.strip() for t in NEG_ADD.split(",")]
        assert not [t for t in add_toks if t in toks], f"「{zh}」新增负面与现有 token 撞车"
        neg = neg + ", " + NEG_ADD

        # ── 卫生与锚点门(镜像契约测试) ──
        assert pos.startswith("现代修仙游戏"), f"「{zh}」定性句开头漂移"
        assert pos.endswith("。"), f"「{zh}」须全角句号收尾(直拼前提)"
        for ch in ",;:!?()":
            assert ch not in pos, f"「{zh}」半角标点 {ch!r}"
        low = pos.lower()
        for w in DIRTY + OLD_ANCHORS + PROHIBIT:
            assert w not in low, f"「{zh}」positive 违禁词 {w!r}"
        assert not _HEX_COLOR_DUMMY(pos), f"「{zh}」色号残留"
        assert not _CJK.search(neg), f"「{zh}」negative 中文残留"
        if zh in ("三视图", "表情差分"):
            for t in CLONE_TOKENS:
                assert t not in neg.lower(), f"「{zh}」clone 门禁撞 {t!r}"
        if zh == "人物":
            assert pos.startswith("现代修仙游戏的角色立绘资产")
            for kw in ("单人立像", "六成", "两至四条"):
                assert kw in pos, f"人物增量锚缺 {kw}"
            assert not pos.endswith(MD_TAIL) and not pos.startswith("一幅")

        total = len(pos) + len(neg)
        assert 300 <= total <= 1000, f"「{zh}」长度 {total} 越界(300-1000)"
        e["positive"], e["negative"] = pos, neg
        report.append(f"{zh}: pos {len(pos)} + neg {len(neg)} = {total}")

    # ── JSON 落盘 ──
    JSON_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # ── md 九围栏逐字同步(改前围栏==改前 positive 已由格式门+上方幂等门间接覆盖,此处直换) ──
    lines = md_text.splitlines()
    for e in data:
        s, t = md_fence_lines(lines, e["zh"])
        lines[s:t] = [e["positive"]]
    md_text = "\n".join(lines) + ("\n" if not md_text.endswith("\n") else "")

    # ── 附二口径对齐(L81 长度上限扩容 + L78 同口径 + L80 线描护栏记载) ──
    old81 = "- **长度口径(09-18 硬纪律)**:每型 positive＋negative 合计 300-800 字符,超限压 token、不足补信息,生成脚本逐型断言。"
    new81 = ("- **长度口径(09-18 硬纪律;同日线描层扩容)**:每型 positive＋negative 合计 300-1000 字符"
             "(上限原 800,线描句＋Line 负面族增补所致),超限压 token、不足补信息,生成脚本逐型断言。")
    assert md_text.count(old81) == 1, "L81 长度口径行未唯一命中"
    md_text = md_text.replace(old81, new81, 1)

    old78 = "(先腾 300-800 长度)"
    assert md_text.count(old78) == 1, "L78 长度口径括注未唯一命中"
    md_text = md_text.replace(old78, "(先腾 300-1000 长度)", 1)

    old80tail = "防误伤工笔白描线描 DNA 本身。"
    add80 = ("**线描护栏(09-18 线描层)**:九型 negative 增列 Line Negative 族九 token"
             "(thick anime outline/bold black outline/uniform outline/vector outline/mechanical linework/"
             "cel-shading outline/western comic inking/sticker-like contour/plastic contour,"
             "docs/prompts/三国望神州_线描.md §20 推荐清单全量),防动漫粗描边、矢量轮廓与机械勾边;"
             "mechanical linework 属「机械感」缺陷方向词、非本体词,不入上方护栏禁区。")
    assert md_text.count(old80tail) == 1, "L80 护栏禁区行尾未唯一命中"
    md_text = md_text.replace(old80tail, old80tail + add80, 1)

    MD_PATH.write_text(md_text, encoding="utf-8")

    print("九型落点(pos+neg):")
    for r in report:
        print(" ", r)
    print("JSON+md 围栏+附二(L78/L80/L81) 已同步")
    return 0


def _HEX_COLOR_DUMMY(s: str) -> bool:
    return bool(_HEX.search(s))


if __name__ == "__main__":
    sys.exit(main())
