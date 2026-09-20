#!/usr/bin/env python3
"""道劫 t2i [66] 速查卡重写为九型×配方矩阵(09-19 九型配方 R4)。

对象=K2-文生图-道劫.json 节点 66(MarkdownNote 用法速查)。

做法:卡头部(正向/七段公式/场景模板/纪律六条/负向说明)人工 curated 段
逐字保留;自「## LoRA 栈」起整段重生成——
  · LoRA 栈节:机制说明(沿用)+按型点亮改为指向矩阵;
  · 参数速查节:步数档改 v3 口径(速4=turbo 参考图档/质12=关turbo槽+cfg5,09-20 用户裁定:加速件效果不理想,正式图必走质档);
  · 九型×配方矩阵节:脚本自 daojie_bases.json 单源生成
    (型/画幅·像素/LoRA 组 件×权重/步数档/主路/辅路·后处理)。

对拍(三方一致,零差异才写盘通过):
  卡矩阵 ↔ daojie_bases.json lora_recipe ↔ daojie_lora_stack.json 预设
  ——逐型逐件对(件↔开关↔权重);卡内互斥纪律行=常量锚。

幂等:重跑重生成同文(纯函数);lint 复跑(workflow_graph_lint)。
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
      / "K2-文生图-道劫.json")
BASES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
STACK = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json"
LINT = REPO / "apps/build/scripts/workflow_graph_lint.py"

CARD_HEAD_ANCHOR = "## LoRA 栈"   # 自此起整段重生成

STACK_HEAD = """## LoRA 栈([90] 单节点 14 槽·九型驱动;09-19 等价性双跑已锚:默认组=原常开链逐字节等价)
- **preset=跟随底座型(默认,勿手改)**:[80] 选型→自动点亮该型 LoRA 组(见下方九型×配方矩阵),换型只在 [80] 一处
- 每槽「××开」=急停开关:**关=真关**(跳过加载,比权重 0 快;压过矩阵点亮,applied 清单会披露);「××权重」=预设模式下只读参考,微调请切「专家·全自定义」
- **专家·全自定义=14 槽全手拨**(默认全开!互斥纪律:画风件同开 ≤1(+鎏金半件),三画风同开=崩源)
- 槽位/链序/按型预设真源=my_nodes/nodes/daojie_lora_stack.json(热改即时生效):**新增 LoRA 只改数据文件,工作流零改动**;链序=文件序(加速→服从度→细节→亚洲面孔→鎏金→光影→电影感→identity→暗笔刷→美学→淡彩线描→墨洗→湿画→金雾),链序敏感勿重排
- 水墨四件按 09-19 对拍定谳点亮(场景/分镜/概念气氛,数值=矩阵);人物系画风槽默认关,备选件(identity/暗笔刷/美学/湿画)恒关;手开淡彩线描须在 [50] 补触发词 watercolor ink illustration style、暗笔刷补 monochrome ink wash style
- 质感件默认旁路,按需开:[46]光影 ×0.8/[78]电影感 ×1.0(槽内权重可调);[19] identity 编辑件恒关(跑 t2i 会支配整图)
- 原画布链(14 件 LoraLoader+[85] 按型节点+[88] 分组旁路器)整段存同目录「K2-文生图-道劫-专家模式.json」,随时可切回"""

PARAMS_HEAD = """## 参数速查
- 日常档=速度档 **4步**/cfg1+加速槽开([90] turbo;2K 约3.5分钟/张;cfg1 下负向不生效)
- 定稿档=质量档 **12步**(v3 配方口径;关加速槽 [90] turbo 急停。原 8 步口径实测 2K 约7.5分钟/张,12步按比例更久;要负向生效把 [12] cfg 拉到 5)
- 分辨率=[80] 选型自动跟随(道具/高清人脸 1024×1024;其余型 4.2MP≈2K 级。MP 口径=[61] 节点按 1MP=1024×1024 计,4.2 实际≈440万像素);要快须先断开 [61] 左侧两条输入线,再把 MP 拖小"""


def fmt_w(w: float) -> str:
    return f"{w:g}"


def short_label(slot: dict) -> str:
    """槽短名(卡内展示+对拍键):「画风·」前缀族取后段(四件水墨互区分),
    其余取「·」前段;全库唯一性由 test 侧 lbl 映射保证。"""
    label = str(slot["label"])
    head, sep, tail = label.partition("·")
    return tail if sep and head == "画风" else head


def build_matrix(bases: list, slots: list) -> tuple[str, dict]:
    """生成九型×配方矩阵表;返回(表文本, 卡内配方解析结果 供对拍)。"""
    slot_by_file = {s["file"]: s for s in slots}
    parsed: dict[str, dict[str, float]] = {}
    rows = ["| 型 | 画幅·像素 | LoRA 组(件×权重,画风槽=09-19 对拍定谳 v0.2 待用户终审) | 步数档(速/质) | 主路 | 辅路(入口·denoise)/后处理 |",
            "|---|---|---|---|---|---|"]
    for e in bases:
        zh = e["zh"]
        recipe = e["lora_recipe"]
        pairs = []
        for item in recipe:
            slot = slot_by_file[item["file"]]
            pairs.append((short_label(slot), item["slot"], float(item["weight"])))
        parsed[zh] = {k: w for _lbl, k, w in pairs}
        lora_cell = "+".join(f"{lbl}×{fmt_w(w)}" for lbl, _k, w in pairs) or "纯全局链"
        aspect = e["aspect_ratio"].split(" (")[0]
        mp = e["megapixels"]
        ov = e.get("resolution_override")
        if isinstance(ov, list) and len(ov) == 2:
            mp_cell = f"{ov[0]}×{ov[1]} 直填(先例,A案终审)"
        else:
            mp_cell = f"{aspect}·{mp:g}MP" + ("(1024²)" if mp == 1.0 else "")
        steps = e["steps_hint"]
        # 09-20 裁定:速档=turbo 参考图档;质档=关 turbo 槽+12 步+cfg5(负向复活)
        steps_cell = f"速{steps['fast']}(turbo·参考图)/质{steps['quality']}(关turbo+cfg5)"
        routes = e.get("i2i_routes") or []
        route_cell = ";".join(
            f"{r['name']}→{r['entry']}" + (f"·dn{fmt_w(r['denoise'])}" if "denoise" in r else "")
            for r in routes) or "—"
        post = e.get("postprocess", "")
        cell = (route_cell + ";" + post) if route_cell != "—" else post
        rows.append(f"| {zh} | {mp_cell} | {lora_cell} | {steps_cell} | 本图 t2i | {cell} |")
    return "\n".join(rows), parsed


MATRIX_HEAD = """## 九型×配方矩阵([80] 选型→WIDTH/HEIGHT 直出([61] 退位旁路,三视图 1536×512 直填)+[90] 自动点亮;单源=daojie_bases.json v3)
[50] 主体句仍按型改写(场景/概念气氛**不留人物主体**——其负向已禁 person;人物/美宣按七段公式写主体)。
配方数值=09-19 水墨四件对拍定谳 v0.2(**待用户终审刷新**;改值=热改 daojie_bases.json/daojie_lora_stack.json 即时生效,勿手改卡)。
互斥纪律:淡彩线描/墨洗/湿画三画风同开 ≤1;金雾与鎏金=场景互换、人物禁同开;人物系备选=墨洗轻档 0.4-0.6(可选非首选)。"""


def build_card(bases: list, slots: list) -> tuple[str, dict]:
    old = json.loads(WF.read_text(encoding="utf-8"))
    card = next(n for n in old["nodes"] if n["id"] == 66)["widgets_values"][0]
    head_end = card.index(CARD_HEAD_ANCHOR)
    head = card[:head_end].rstrip("\n")
    matrix, parsed = build_matrix(bases, slots)
    new_card = "\n\n".join([head, STACK_HEAD, PARAMS_HEAD, MATRIX_HEAD, matrix]) + "\n"
    # 手动画幅口径尾注(单源解释,不属矩阵数据)
    new_card += """
手动改画幅/MP 须先断开 [53] 左侧两条 [80] 输入线(断线后回落 [53] widget 旧值);[63] 12带重平衡全1.0=中性,同图可调淡彩浓度。"""
    return new_card, parsed


def crosscheck(card: str, parsed: dict, bases: list, slots: list) -> None:
    """三方对拍:卡矩阵 ↔ bases ↔ 栈预设,逐型逐件零差异(任一不符即抛)。"""
    # 1) 卡文本里矩阵行逐行回读,与脚本解析结果一致(行在卡内=对拍对象在场)
    for zh, want in parsed.items():
        row = next((ln for ln in card.splitlines()
                    if ln.startswith(f"| {zh} |")), None)
        assert row is not None, f"矩阵缺行:{zh}"
        lora_cell = row.split("|")[3].strip()
        got = {}
        for part in lora_cell.split("+"):
            lbl, _, w = part.strip().rpartition("×")
            got[lbl] = float(w)
        lbl_to_key = {short_label(s): s["key"] for s in slots}
        got_keys = {lbl_to_key[lbl]: w for lbl, w in got.items()}
        assert got_keys == want, (zh, "卡↔bases 不一致", got_keys, want)
    # 2) bases ↔ 栈预设一比一(件↔开关↔权重;全局件恒挂不入配方)
    stack_by_file = {s["file"]: s for s in slots}
    for e in bases:
        zh = e["zh"]
        want = {i["file"]: float(i["weight"]) for i in e["lora_recipe"]}
        assert parsed[zh] == {stack_by_file[f]["key"]: w for f, w in want.items()}, zh
        for s in slots:
            on, w = s["presets"][zh]["on"], s["presets"][zh]["weight"]
            if s["key"] in ("turbo", "projector"):
                assert on, (zh, s["key"], "全局件恒挂")
            elif s["file"] in want:
                assert on and abs(w - want[s["file"]]) < 1e-9, (zh, s["key"])
            else:
                assert not on, (zh, s["key"], "bases 未列却点亮")
    # 3) 卡内纪律锚在场(互斥/定谳版本口径)
    for anchor in ("三画风同开 ≤1", "待用户终审刷新", "单源=daojie_bases.json"):
        assert anchor in card, f"卡缺纪律锚:{anchor}"


def main() -> int:
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    slots = json.loads(STACK.read_text(encoding="utf-8"))
    new_card, parsed = build_card(bases, slots)
    crosscheck(new_card, parsed, bases, slots)

    doc = json.loads(WF.read_text(encoding="utf-8"))
    node66 = next(n for n in doc["nodes"] if n["id"] == 66)
    node66["widgets_values"][0] = new_card
    named = node66.get("widgets_values_named")
    if isinstance(named, dict) and "text" in named:  # 前端 named 锚双写面,同步同文
        named["text"] = new_card
    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    # 写后复跑:盘上文件重对拍(防写坏)+ lint
    doc2 = json.loads(WF.read_text(encoding="utf-8"))
    node66b = next(n for n in doc2["nodes"] if n["id"] == 66)
    card2 = node66b["widgets_values"][0]
    assert card2 == new_card
    named2 = node66b.get("widgets_values_named")
    if isinstance(named2, dict):
        assert named2.get("text") == new_card, "widgets_values_named.text 未同步"
    crosscheck(card2, parsed, bases, slots)
    r = subprocess.run([sys.executable, str(LINT), str(WF)], capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip())
    if r.returncode != 0:
        print("✗ lint 未过", file=sys.stderr)
        return 2
    print("OK [66] 速查卡=九型×配方矩阵(三方对拍零差异:卡↔daojie_bases↔daojie_lora_stack)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
