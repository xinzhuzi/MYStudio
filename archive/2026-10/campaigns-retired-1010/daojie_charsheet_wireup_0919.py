#!/usr/bin/env python3
"""K2-角色设定-道劫.json 九型地基收编改造(09-19;幂等,最小面)。

改造面(设计=任务 design.md;高危文件,改前 git 干净为前提):
  1. 新增 [304] MyDaojieBase:负向=[64]→[304].negative(用户负向)与该型负面
     基线合并→[85];正向=底座正向出(人物/高清人脸 对拍定默认);
  2. 新增 [305] StringConcatenate:[163] VLM caption(前)+[304].positive(殿后)
     →[119].prompt——结构化模板完整性优先(格数漂移=已知弱项,锚不插队头);
  3. 新增 [306] easy showAnything:[90].applied 生效清单显示(审计面,t2i [86] 先例);
  4. [90] preset 专家·全自定义(细节×1+鎏金×0.3 激活,turbo/projector/76 关)
     → 设定板,widgets 保持 14 对全开+默认权(preset 模式下点亮=矩阵);
  5. [53] 补 widgets_values_named(转换器稳健性,t2i [12] 先例);
  6. 说明卡 [301]/[303]/[64] 标题与组①标题同步。

不变量:[164] 恒挂且必先于 ModelPatch(链 90→164→131→120 零改动);
[72] 参考图臂/采样参数/分辨率(1536×1024)零改动。

幂等:全部改动以标记检测,已改即跳过;写盘后跑 workflow_graph_lint。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/2_图生图"
      / "K2-角色设定-道劫.json")
STACK = (REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json")
LINT = REPO / "apps/build/scripts/workflow_graph_lint.py"


def node(wf: dict, nid: int) -> dict:
    return next(n for n in wf["nodes"] if n["id"] == nid)


def set_link(wf: dict, lid: int, src: int, s_slot: int, dst: int, d_slot: int,
             itype: str) -> None:
    """写 links 表(存在即改写)+ 双端登记一致。"""
    entry = [lid, src, s_slot, dst, d_slot, itype]
    for i, l in enumerate(wf["links"]):
        if l[0] == lid:
            wf["links"][i] = entry
            break
    else:
        wf["links"].append(entry)
        wf["links"].sort(key=lambda l: l[0])
    outs = node(wf, src)["outputs"][s_slot]
    outs["links"] = sorted({x for x in (outs.get("links") or []) if x != lid} | {lid})
    node(wf, dst)["inputs"][d_slot]["link"] = lid


def main() -> int:
    wf = json.loads(WF.read_text(encoding="utf-8"))
    ids = {n["id"] for n in wf["nodes"]}
    fresh = not (304 in ids and 305 in ids and 306 in ids)
    slots = {s["key"]: s for s in json.loads(STACK.read_text(encoding="utf-8"))}
    chain = [s for s in json.loads(STACK.read_text(encoding="utf-8"))]

    if not fresh:
        print("幂等段:新节点已在,跳过新增;[90]/说明面重落(终态)")

    if fresh:  # ── 1. [304] MyDaojieBase(负向经 [64] 合并;正向待 [305] 拼接)──
        wf["nodes"].append({
        "id": 304, "type": "MyDaojieBase", "pos": [2400, 1900], "size": [360, 420],
        "flags": {}, "order": 36, "mode": 0,
        "inputs": [
            {"name": "positive", "shape": 7, "type": "STRING", "link": None},
            {"name": "negative", "shape": 7, "type": "STRING", "link": None},
        ],
        "outputs": [
            {"name": "positive", "type": "STRING", "slot_index": 0, "links": None},
            {"name": "negative", "type": "STRING", "slot_index": 1, "links": None},
            {"label": "画幅比例", "name": "aspect", "type": "COMBO",
             "slot_index": 2, "links": None},
            {"label": "百万像素", "name": "megapixels", "type": "FLOAT",
             "slot_index": 3, "links": None},
            {"label": "型", "name": "base", "type": "COMBO", "slot_index": 4,
             "links": None},
        ],
        "title": "[304] 道劫底座·设定板步(默认人物;09-20 对拍定谳 A2 人物 8.5 "
                 "vs B2 高清人脸 8.0,AI 初评待终审;负向=该型负面基线∩[64]"
                 "用户负向合并;正向=底座锚经 [305] 殿后)",
        "properties": {"Node name for S&R": "MyDaojieBase"},
        "widgets_values": ["人物"],
        "widgets_values_named": {"base": "人物"},
        "color": "#4d9e6a", "bgcolor": "#1f2f26",
    })

    # ── 2. [305] StringConcatenate(VLM caption 在前,底座锚殿后)──
        wf["nodes"].append({
        "id": 305, "type": "StringConcatenate", "pos": [2020, 1900], "size": [340, 180],
        "flags": {}, "order": 37, "mode": 0,
        "inputs": [
            {"name": "string_a", "type": "STRING", "widget": {"name": "string_a"},
             "link": None},
            {"name": "string_b", "type": "STRING", "widget": {"name": "string_b"},
             "link": None},
        ],
        "outputs": [{"name": "STRING", "type": "STRING", "slot_index": 0,
                     "links": None}],
        "title": "[305] 底座锚殿后拼接(前=[163] VLM caption,后=[304].positive;"
                 "VLM 块勿 mute——停用须摘本节点线,[119] 回退内嵌模板)",
        "properties": {"Node name for S&R": "StringConcatenate"},
        "widgets_values": ["", "", "\n"],
        "widgets_values_named": {"delimiter": "\n"},
    })

    # ── 3. [306] easy showAnything([90].applied 审计显示,t2i [86] 先例)──
        wf["nodes"].append({
        "id": 306, "type": "easy showAnything", "pos": [1800, 5100], "size": [480, 200],
        "flags": {}, "order": 38, "mode": 0,
        "inputs": [{"label": "输入任何", "name": "anything", "shape": 7, "type": "*",
                    "link": None}],
        "outputs": [{"name": "output", "type": "*", "links": None}],
        "title": "[306] 栈生效清单(设定板档=人物组+turbo急停;[164] 独立恒挂不在栈内)",
        "properties": {"Node name for S&R": "easy showAnything"},
        "widgets_values": ["(待运行)"],
    })

    # ── 4. 连线改写(旧 29/30 改向,新 42-45 登记;幂等=按 lid 覆写)──
        set_link(wf, 30, 64, 0, 304, 1, "STRING")     # [64]→[304].negative(原→[85])
        set_link(wf, 29, 163, 0, 305, 0, "STRING")    # [163]→[305].a(原→[119])
        set_link(wf, 42, 304, 0, 305, 1, "STRING")    # [304].positive→[305].b
        set_link(wf, 43, 304, 1, 85, 3, "STRING")     # [304].negative→[85].prompt
        set_link(wf, 44, 305, 0, 119, 3, "STRING")    # [305]→[119].prompt
        set_link(wf, 45, 90, 1, 306, 0, "*")          # [90].applied→[306]
        wf["last_link_id"] = max(wf["last_link_id"], 45)
        wf["last_node_id"] = max(wf["last_node_id"], 304)

    # ── 5. [90] preset 切设定板 + turbo 急停(09-20 归因定谳)─────────
    # turbo×1 在 10步 LCM 设定板流=文字乱码放大器(A/B vs A2 单变量对拍:
    # 开 turbo 完成度 4/10 乱码重罚,急停后 8/10 与改造前基线同分);
    # enable=false=真关+applied 披露「开关急停」(栈节点既有语义)。
    n90 = node(wf, 90)
    n90["widgets_values"] = ["设定板"] + [
        v for s in chain
        for v in ((s["key"] != "turbo"), s["default_weight"])]
    n90["title"] = ("[90] LoRA栈·设定板档+turbo急停(=人物组去加速:服从度×0.01"
                    "+细节×1+亚洲面孔×0.4+鎏金×0.3;turbo 开=文字乱码放大器"
                    "(09-20 A/B vs A2 单变量定谳);[164] charsheet 件独立恒挂于栈后"
                    "→ModelPatch;权重微调切专家档,原链 -专家模式.json)")

    # ── 6. 说明面同步([53] named/[64]/[119] 题/[301]/[303]/组①)────
    n53 = node(wf, 53)
    if "widgets_values_named" not in n53:
        n53["widgets_values_named"] = dict(zip(
            ["seed", "control_after_generate", "steps", "cfg",
             "sampler_name", "scheduler", "denoise"], n53["widgets_values"]))
    node(wf, 64)["title"] = ("[64] 用户负向槽(→[304] 与该型负面基线合并;"
                             "LCM cfg1 不生效,Raw 40步 cfg3-4 生效)")
    node(wf, 119)["title"] = ("[119] 正向·官方结构化模板(VLM caption 经 [305] "
                              "底座锚殿后;[305] 摘线时回退本内嵌模板+道劫锚)")
    note = node(wf, 301)
    note["widgets_values"] = [
        "输入=[72] 选角色参考图(建议=两步链步1 立绘,t2i 人物型;自动缩放 1024²,"
        "一图六用:VAEEncode/补丁像素线/正负接地/VLM/对比图);前置=插件 "
        "comfyui-krea2edit+comfyui-kjnodes,权重(均引擎在位):底模 "
        "krea2_turbo_bf16/TE qwen3-vl-4b-heretic/VAE qwen_image_vae/"
        "CharacterSheet LoRA DynamicCharacterSheet_krea2_v1(引擎 loras 根,"
        "上游 HF Alissonerdx/CharacterSheet,恒挂=必先于 ModelPatch)"
        "+[90] MyDaojieLoraStack preset=设定板档+turbo急停(=人物组去加速;"
        "turbo 开=文字乱码放大器,09-20 单变量定谳;槽序真源 "
        "my_nodes/nodes/daojie_lora_stack.json)+[304] MyDaojieBase"
        "(型默认人物,负向自动合并该型负面基线;两步链出图逻辑见 "
        "docs/prompts/道劫_角色设定表出图逻辑_0919.md)。"]
    note303 = node(wf, 303)
    note303["widgets_values"] = [
        "[184/162/163] VLM 看图写提示词(已激活 v3 实证,读参考图自动重写身份锁;"
        "需另载 Qwen3-VL 权重)。正向=[163] caption 经 [305] 与 [304].positive "
        "底座锚殿后拼接→[119];**VLM 三件勿 mute**(mute 后 [305] 只剩底座锚,"
        "设定板布局模板丢失)——要停用 VLM 请摘 [305]→[119] 连线,[119] 回退"
        "内嵌官方模板+道劫锚;负向=[64] 用户负向→[304] 与该型负面基线合并"
        "→[85] 同图接地。"]
    for g in wf.get("groups", []):
        if g["title"].startswith("① 模型与道劫 LoRA 栈"):
            g["title"] = ("① 模型与道劫 LoRA 栈([90] 设定板档=人物组五件;"
                          "charsheet [164] 独立恒挂,官方挂法=栈出→[164]→"
                          "ModelPatch;[304] 底座负向合并;原 8 件链副本 "
                          "-专家模式.json)")

    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ 改造落盘:{WF.name}(节点 {len(wf['nodes'])},链 {len(wf['links'])};"
          f"[90] 设定板档点亮:" + "+".join(
              f"{s['key']}×{s['default_weight']:g}" for s in chain
              if s["presets"]["设定板"]["on"]) + ")")
    import subprocess
    rc = subprocess.run([sys.executable, str(LINT), str(WF)]).returncode
    return rc


if __name__ == "__main__":
    sys.exit(main())
