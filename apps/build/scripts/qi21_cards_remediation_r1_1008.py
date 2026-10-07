#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 补救第 1 轮 1008(复核发现清偿):i2i/edit 两卡 5+5 处对账修补+
画布件清偿+[4014]/[153] RGBA widget 英文旧值刷 canon 中文+库件同批。

前情:第二役脚本(qi21_cards_refresh_i2i_edit_1008.py,02:05 已 APPLY)
完成卡文主体手术+三副本部署;复核(第 1 轮)在其余稿里坐实十处散病:
- i2i 卡 5 处:结构债后果预判「恒真」与引擎校验层矛盾(实为提交期拒单/
  掉线恒关,引擎家 execution.py validate_inputs 实读);生成器点名
  [4016]/[4017] 零命中+「59 处」复现不出(实测方括号 72 处);SeedVR2
  段「4.2MP 六型」过期(canon 实查 {4.2:7,1.0:3});主图骨架①误列
  [4019](实住 [6] 子图内);行 4「九型装配的合体」(canon types=10)。
- edit 卡 5 处:resolution「上限 2048」(引擎 nodes_qwen.py schema
  max=4096 实锚);「装配子图 9 件 census」(ASG_IDS 实数 11 件);
  「支路1 viggle」「支路2 Fun-Acc」编号与档号 0=Fun-Acc/2=viggle 打架
  (SPEED_MODES 实锚);「关「PE开关」」(现役控件名「PE启用?」)。
- 画布件:i2i [4010] title「底座九选一」(十档);i2i/edit 组框①滞留
  「PE-I2I 专属TE[4019]→[6].pe_clip」([6] 边界无 pe_clip 槽);edit
  组框②「面板=指令/PE开关」。
- widget 活值:i2i [4014]/[153](工作流+子图库件)+edit [4014](工作流
  +子图库件)槽4/5/6 仍是 10-04 中文化前英文旧值(运行期实例值覆盖
  default,实际拼英文头尾)=ABSENT 退役串在工作流内非卡文位置真残留;
  刷成 canon rgba 节中文现值(head/tail/w1_closing 热读)。

落点(五树指纹扫描 1008 本役产,动前):
- i2i/edit 工作流:仓库+装机+构建三副本(引擎家 user/default/workflows
  零副本=repo: 只读合并态,零播种);
- 子图库件 i2i/-edit 两件:仓库+装机+构建+引擎家 custom_nodes 四副本;
- 英文头/尾句同串他线命中(qwen21-t2i/qwen21-daotu/官方模板/K2 线
  canon_lib 与 05 库/MA 树 canon 备档键)=非本域,不动;t2i.json 命中
  为卡文退役点名形(合法)+并行在途禁碰区,不动。
- 历史手术脚本(第二役 qi21_cards_refresh_i2i_edit_1008.py 等)含旧串
  =已执行留档,不动。

DRY_RUN=1 只验串不写盘(默认 apply)。
"""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
REL_DIR = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图"
I2I_REL = f"{REL_DIR}/qi21-道劫-i2i.json"
EDIT_REL = f"{REL_DIR}/qi21-edit.json"
SG_I2I_REL = "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"
SG_EDIT_REL = "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-edit.json"
CANON = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"

DRY = os.environ.get("DRY_RUN", "") == "1"


def family(rel: str, engine_live: bool = False) -> list[Path]:
    """三常驻副本(仓库/装机/构建);engine_live=True 时含引擎家 custom_nodes 副本。"""
    repo = REPO / rel
    inst = Path("/Applications/漫影工作室.app/Contents/Resources") \
        / rel.replace("apps/backend/", "backend/", 1)
    build = REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources" \
        / rel.replace("apps/backend/", "backend/", 1)
    fam = [repo, inst, build]
    if engine_live:
        fam.append(Path.home() / "Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes/subgraphs"
                   / Path(rel).name)
    return fam


def fail(msg):
    print("ABORT:", msg)
    sys.exit(1)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def check_family(targets, label):
    sigs = {md5(p) for p in targets}
    missing = [str(p) for p in targets if not p.exists()]
    if missing:
        fail(f"{label}家族缺副本: {missing}")
    if len(sigs) != 1:
        for p in targets:
            print("  ", md5(p), p)
        fail(f"{label}家族副本不一致,先查明再动")
    print(f"[pre] {label} {len(targets)} 副本 md5 一致 ✓")


def sync(src: Path, dsts, label):
    for dst in dsts:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        if md5(dst) != md5(src):
            fail(f"同步校验失败: {dst}")
    print(f"[sync] {label} 家族已同 md5 ✓")


# ── [402] 卡文精准替换对(必须恰好命中 1 次;单槽件,单槽即权威) ────────────
PAIRS_I2I = [
    # 1. 结构债后果预判改判(引擎校验层实读:失配连线提交期拒单,非恒真)
    ("rgba_hint 连线(#55,origin_slot=3)在引擎按槽路由下运行时将取到「负面词」字符串,「自动」档恒真=全型恒开透明包裹。是否按型须实弹核验;修法=实例补五出+连线迁槽4(随 1005 案B i2i 推广役同批)。",
     "rgba_hint 连线(#55,origin_slot=3)是 STRING→BOOLEAN 类型失配(引擎 execution.py validate_inputs 按 origin 节点类 RETURN_TYPES 现解析校验,两件均无 VALIDATE_INPUTS 豁免):前端保线=提交期 return_type_mismatch 拒单(整单被拒,比旧注「恒真」更重),前端掉线=rgba_hint 恒 False=透明恒关(与旧注相反)——「恒真」分支不存在;修法=实例补五出+连线迁槽4(随 1005 案B i2i 推广役同批,实弹定谳)。"),
    # 2. 生成器点名清单与计数改实测(0924 生成器 grep 实测:[15]×34+[130]×11+[172]×11+[173]×16=72;4016/4017 零命中)
    ("(内含 [4016]/[4017]/[172]/[173]/[130]/[15] 等 1001-1002 已替已删节点号,grep 命中 59 处)",
     "(内含 [15]/[130]/[172]/[173] 1001-1002 已替已删旧节点号,方括号 grep 实测命中 72 处;[4016]/[4017] 系 10-02 工作流侧旧号不在此生成器内,旧计 59 处复现不出已弃)"),
    # 3. SeedVR2 型数对账(canon types megapixels 实测 {4.2:7, 1.0:3})
    ("(九型实查:4.2MP 六型短边 1376~2096 增益仅 ×1.1~1.3;1.0MP 三型短边 1024 真增益 ×2.0)",
     "(canon 十型实查·1008 对账:4.2MP 七型(表情差分已 1:1@4.2MP)短边 1376~2096 增益仅 ×1.1~1.3;1.0MP 三型(道具/高清人脸/自由)短边 1024 真增益 ×2.0)"),
    # 4. 主图骨架①去 [4019](实住 [6] 装配子图,link#45 直供 [4013])
    ("①加载器([1][2][3][4019]+[9]QwenImage21Cache+[42]MODEL 总线拐)",
     "①加载器([1][2][3]+[9]QwenImage21Cache+[42]MODEL 总线拐;PE-I2I 专属TE[4019] 住 [6] 装配子图内(1003 迁入))"),
    # 5. 行4 十档口径(canon types=10)
    ("+qi21 道劫九型装配的合体;",
     "+qi21 道劫十档装配(九型+自由)的合体;"),
]

PAIRS_EDIT = [
    # 1. resolution 上限改引擎 schema 口径(nodes_qwen.py 实读 max=4096)
    ("官方默认 1024、上限 2048;",
     "官方默认 1024、引擎上限 4096(nodes_qwen.py schema 实锚;2048 系官方模板建议值不在引擎);"),
    # 2. census 实数(ASG_IDS={21,23,24,25,27,4012,4013,4014,4015,4016,4019}=11 件)
    ("装配子图 9 件 census",
     "装配子图 11 件 census"),
    # 3/4. 支路标签去编号冲突(SPEED_MODES 实锚:0=Fun-Acc/1=直出/2=viggle)
    ("- **支路1 viggle**:[7011] 挂",
     "- **viggle 支路(档2「2 · viggle」)**:[7011] 挂"),
    ("- **支路2 Fun-Acc**:[7013] T8",
     "- **Fun-Acc 支路(档0「0 · Fun-Acc 4步」)**:[7013] T8"),
    # 5. 控件名现役形(宿主 [6] wvn 实键=PE启用?)
    ("- 关「PE开关」(直写选配)时",
     "- 关「PE启用?」(直写选配)时"),
]

# ── 画布件替换对 ─────────────────────────────────────────────────────────
TITLE_4010 = ("[4010] 底座九选一·自研", "[4010] 底座十选一·自研")
GROUPS_I2I = [
    ("bf16 三件套[1][2][3]+PE-I2I 专属TE[4019]→[6].pe_clip;[42]MODEL总线拐",
     "bf16 三件套[1][2][3]+[42]MODEL总线拐(PE-I2I 专属TE[4019] 住 [6] 子图内)"),
]
GROUPS_EDIT = [
    ("bf16 三件套[1][2][3]+PE-I2I 专属TE[4019]→[6].pe_clip;[28]VAE总线拐",
     "bf16 三件套[1][2][3]+[28]VAE总线拐(PE-I2I 专属TE[4019] 住 [6] 子图内)"),
    ("面板=指令/PE开关)",
     "面板=指令/PE启用?)"),
]

# ── widget 刷值:canon rgba 中文现值,槽4/5/6 ─────────────────────────────
canon = json.loads(CANON.read_text(encoding="utf-8"))
RGBA = canon["rgba"]
W_EN_HEAD = RGBA["head_en"]          # This is an RGBA format image with transparency.
W_EN_TAIL = RGBA["tail_en"]          # The image has an alpha channel and a transparent background.
W_EN_W1_PREFIX = "The subject reads as a clean flat cutout"
NEW_HEAD = RGBA["head"]              # 这是一张带有透明度的RGBA图像。
NEW_TAIL = RGBA["tail"]              # 该图像具有alpha通道,背景是透明的。
NEW_W1 = RGBA["w1_closing"]          # 主体呈现为干净的平面剪裁…

ANCHORS = {
    "i2i": ["STRING→BOOLEAN 类型失配", "方括号 grep 实测命中 72 处",
            "4.2MP 七型(表情差分已 1:1@4.2MP)", "PE-I2I 专属TE[4019] 住 [6] 装配子图内",
            "道劫十档装配(九型+自由)的合体", "[4010] 底座十选一·自研",
            "(PE-I2I 专属TE[4019] 住 [6] 子图内)"],
    "edit": ["引擎上限 4096", "装配子图 11 件 census",
             "viggle 支路(档2「2 · viggle」)", "Fun-Acc 支路(档0「0 · Fun-Acc 4步」)",
             "关「PE启用?」(直写选配)", "面板=指令/PE启用?)"],
}
ABSENT = {
    "i2i": ["「自动」档恒真", "grep 命中 59 处", "内含 [4016]/[4017]",
            "4.2MP 六型", "①加载器([1][2][3][4019]", "道劫九型装配的合体",
            "[4010] 底座九选一", "PE-I2I 专属TE[4019]→[6].pe_clip"],
    "edit": ["上限 2048", "装配子图 9 件", "**支路1 viggle**", "**支路2 Fun-Acc**",
             "关「PE开关」", "PE-I2I 专属TE[4019]→[6].pe_clip", "面板=指令/PE开关"],
}


def card_text(d):
    return [v for n in d["nodes"] if n.get("id") == 402
            for v in n["widgets_values"] if isinstance(v, str) and len(v) > 300][0]


def subgraph(d):
    return [s for s in d["definitions"]["subgraphs"]
            if "文本提示词" in (s.get("name") or "")][0]


def replace_pairs(text, pairs, label):
    for old, new in pairs:
        c = text.count(old)
        if c != 1:
            fail(f"{label} 配对命中 {c} 次(须1): {old[:50]!r}")
        text = text.replace(old, new)
    return text


def brush_widget(node, label):
    """[4014]/[153] 槽4/5/6 英文旧值→canon 中文;先断言现值=英文旧值特征。"""
    wv = node.get("widgets_values")
    if not isinstance(wv, list) or len(wv) < 7:
        fail(f"{label}: wv 形异常 len={len(wv) if isinstance(wv, list) else '非列表'}")
    if wv[4] != W_EN_HEAD or wv[5] != W_EN_TAIL or not wv[6].startswith(W_EN_W1_PREFIX):
        fail(f"{label}: 槽4/5/6 现值非预期英文旧值(4={wv[4][:30]!r} 6={wv[6][:30]!r})")
    wv[4], wv[5], wv[6] = NEW_HEAD, NEW_TAIL, NEW_W1
    print(f"  {label}: 槽4/5/6 已刷 canon 中文({len(NEW_HEAD)}/{len(NEW_TAIL)}/{len(NEW_W1)}字) ✓")


def process_wf(rel, pairs, groups_pairs, label, anchors, absent):
    targets = family(rel)
    check_family(targets, label)
    p = targets[0]
    d = json.loads(p.read_text(encoding="utf-8"))

    # 1) 卡文(单槽)
    node402 = [n for n in d["nodes"] if n.get("id") == 402]
    if len(node402) != 1 or node402[0].get("type") != "MarkdownNote":
        fail(f"{label}: 定位 [402] MarkdownNote 失败")
    wv = node402[0]["widgets_values"]
    holders = [(wv, i) for i, v in enumerate(wv) if isinstance(v, str) and len(v) > 300]
    wvn = node402[0].get("widgets_values_named")
    if isinstance(wvn, dict):
        holders += [(wvn, k) for k, v in wvn.items() if isinstance(v, str) and len(v) > 300]
    if not holders:
        fail(f"{label}: 卡文槽定位失败")
    texts = [c[k] for c, k in holders]
    if len(set(texts)) != 1:
        fail(f"{label}: 双槽互异(非预期,本役两卡均单槽)")
    new_text = replace_pairs(texts[0], pairs, f"{label}卡文")
    for c, k in holders:
        c[k] = new_text
    print(f"  {label}卡文: {len(holders)} 槽同改({len(new_text)}字) ✓")

    # 2) 组框标题
    for old, new in groups_pairs:
        hits = [g for g in d.get("groups", []) if old in (g.get("title") or "")]
        if len(hits) != 1:
            fail(f"{label} 组框命中 {len(hits)} 件(须1): {old[:40]!r}")
        hits[0]["title"] = hits[0]["title"].replace(old, new)
        print(f"  {label}组框: 已改 ✓")

    # 3) 子图内 [4010] title(i2i)+widget 刷值
    sg = subgraph(d)
    for n in sg["nodes"]:
        if n.get("id") == 4010:
            t = n.get("title") or ""
            if TITLE_4010[0] in t:
                n["title"] = t.replace(*TITLE_4010)
                print(f"  {label}[4010] title: 已改十选一 ✓")
            elif TITLE_4010[1] not in t:
                fail(f"{label}[4010] title 异常: {t!r}")
        if n.get("type") == "MyQi21PromptSelect":
            brush_widget(n, f"{label}[{n.get('id')}]")

    # 4) 终验:新锚全在 / 退役串全无(全文件级,覆盖卡文+title+组框)
    blob = json.dumps(d, ensure_ascii=False)
    for a in anchors:
        if a not in blob:
            fail(f"{label} 新锚缺失: {a!r}")
    for a in absent:
        if a in blob:
            fail(f"{label} 退役串残留: {a!r}")
    print(f"[verify] {label} 新锚 {len(anchors)} 全在 / 退役串 {len(absent)} 全无 ✓")

    if DRY:
        return
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2,
                            separators=(",", ": ")), encoding="utf-8")
    sync(p, targets[1:], label)


def process_sg(rel, label):
    """子图库件:[4010] title + MyQi21PromptSelect widget 刷值(四副本)。"""
    targets = family(rel, engine_live=True)
    check_family(targets, label)
    p = targets[0]
    d = json.loads(p.read_text(encoding="utf-8"))
    subs = d.get("definitions", {}).get("subgraphs", [])
    if len(subs) != 1:
        fail(f"{label}: definitions 数异常 {len(subs)}")
    sg = subs[0]
    for n in sg["nodes"]:
        if n.get("id") == 4010:
            t = n.get("title") or ""
            if TITLE_4010[0] in t:
                n["title"] = t.replace(*TITLE_4010)
                print(f"  {label}[4010] title: 已改十选一 ✓")
            elif TITLE_4010[1] not in t:
                fail(f"{label}[4010] title 异常: {t!r}")
        if n.get("type") == "MyQi21PromptSelect":
            brush_widget(n, f"{label}[{n.get('id')}]")
    blob = json.dumps(d, ensure_ascii=False)
    if W_EN_HEAD in blob or W_EN_TAIL in blob or W_EN_W1_PREFIX in blob:
        fail(f"{label}: 刷值后仍有英文旧值残留")
    if "[4010] 底座九选一" in blob:
        fail(f"{label}: title 九选一残留")
    print(f"[verify] {label} 英文旧值/九选一已清 ✓")
    if DRY:
        return
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2,
                            separators=(",", ": ")), encoding="utf-8")
    sync(p, targets[1:], label)


def main():
    print(f"canon 中文值: head={len(NEW_HEAD)}字 tail={len(NEW_TAIL)}字 w1={len(NEW_W1)}字")
    process_wf(I2I_REL, PAIRS_I2I, GROUPS_I2I, "[i2i]", ANCHORS["i2i"], ABSENT["i2i"])
    process_wf(EDIT_REL, PAIRS_EDIT, GROUPS_EDIT, "[edit]", ANCHORS["edit"], ABSENT["edit"])
    process_sg(SG_I2I_REL, "[库i2i]")
    process_sg(SG_EDIT_REL, "[库edit]")
    if DRY:
        print("[dry] 验串全过(未写盘)")
        return
    for rel in (I2I_REL, EDIT_REL, SG_I2I_REL, SG_EDIT_REL):
        for p in family(rel, engine_live="subgraphs" in rel):
            json.loads(p.read_text(encoding="utf-8"))
    print("[verify] 全家族 JSON 合法 ✓")


if __name__ == "__main__":
    main()
