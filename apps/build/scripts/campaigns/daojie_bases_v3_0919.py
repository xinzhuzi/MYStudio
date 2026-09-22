#!/usr/bin/env python3
"""daojie_bases.json v3 迁移(09-19 九型配方 C2 单源落库)。

每型新增四个可选字段(老字段零改动,缺省=回退全局链现行为):
  lora_recipe  按型默认点亮 LoRA 组(件×权重;不含全局功能件 turbo/projector,
               设计裁定:常开基建不入按型配方)
  steps_hint   速度档/质量档步数(任务书口径:fast=4·quality=12)
  i2i_routes   辅路(名+工作流入口+关键参数 denoise)
  postprocess  后处理入口提示(文本)

数值来源=docs/prompts/道劫_水墨四件对拍定谳_0919.md §3(v0.2 草案,待用户终审):
  人物系五型(人物/美宣/三视图/高清人脸/表情差分)=现值三件 67×1+76×0.4+73×0.3,
    画风槽默认不开([83]墨洗人物轻档 0.4-0.6 为可选备选,非首选,只记档不点亮);
  场景 = 67×1 + [83]墨洗×0.8(主推最佳档)+ [87]金雾×0.6(json 等价剂量);
  概念气氛图 = 67×1 + [83]墨洗×0.7(0.6-0.8 候选首选中值)+ [87]金雾×0.6(起步);
  分镜剧情图 = 三件 + [82]淡彩线描×0.5(连环画候选,0.5-0.6 下沿,待专拍);
  道具 = 67×1 + 73×0.3(四件水墨全 ○,对拍无证据不点亮)。
互斥纪律:82/83/84 三画风同开 ≤1(09-17);金雾与鎏金场景互换、人物禁同开。

幂等:已有 v3 字段即拒绝(防二次跑叠加);写后自检九型全量字段。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"

V3_VERSION = "v0.2(09-19 对拍初评定谳,待用户终审刷新)"

F_DETAIL = "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors"
F_ASIAN = "Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors"
F_LIUJIN = "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors"
F_TANCAI = "Krea2-画风/Krea2-淡彩线描插画_v1.safetensors"
F_SUMIWASH = "Krea2-画风/Krea2-墨洗淡彩SumiWash_v1.safetensors"
F_GOLDENMIST = "Krea2-画风/金雾仙侠GoldenMisty.safetensors"

TRIO = [
    {"file": F_DETAIL, "weight": 1.0, "slot": "detail"},
    {"file": F_ASIAN, "weight": 0.4, "slot": "asianmix"},
    {"file": F_LIUJIN, "weight": 0.3, "slot": "liujin"},
]
STEPS = {"fast": 4, "quality": 12}

# 九型 v3 增量(键=zh;recipe 只记按型差异件,全局 turbo/projector 不入)
V3 = {
    "人物": {
        "lora_recipe": [dict(e) for e in TRIO],
        "steps_hint": dict(STEPS),
        "i2i_routes": [
            {"name": "高清头像·人物图裁切精修", "entry": "K2-人脸精修-道劫.json",
             "denoise": 0.35},
        ],
        "postprocess": "头像另产:本型出图→K2-人脸精修-道劫(YuNet 裁脸+1.0MP 精修)",
    },
    "场景": {
        "lora_recipe": [
            {"file": F_DETAIL, "weight": 1.0, "slot": "detail"},
            {"file": F_SUMIWASH, "weight": 0.8, "slot": "sumiwash",
             "range": [0.6, 0.8], "note": "四件中墨味增益最大,主推最佳档"},
            {"file": F_GOLDENMIST, "weight": 0.6, "slot": "goldenmist",
             "range": [0.6, 0.8], "note": "0.6=与现 json 剂量等价;与鎏金场景互换非叠加"},
        ],
        "steps_hint": dict(STEPS),
        "i2i_routes": [
            {"name": "去噪精修", "entry": "K2-去噪精修.json"},
        ],
        "postprocess": "K2-去噪精修 按需;备选画风件=[82]淡彩线描×0.5-0.6/[84]湿画×0.6(与墨洗互斥,同开≤1)",
    },
    "道具": {
        "lora_recipe": [
            {"file": F_DETAIL, "weight": 1.0, "slot": "detail"},
            {"file": F_LIUJIN, "weight": 0.3, "slot": "liujin"},
        ],
        "steps_hint": dict(STEPS),
        "i2i_routes": [],
        "postprocess": "四宫格裁单格作物品图;细节特写放大走 K2-SeedVR2修复.json",
    },
    "美宣": {
        "lora_recipe": [dict(e) for e in TRIO],
        "steps_hint": dict(STEPS),
        "i2i_routes": [],
        "postprocess": "K2-SeedVR2修复.json 按需(超分精修)",
    },
    "三视图": {
        "lora_recipe": [dict(e) for e in TRIO],
        "steps_hint": dict(STEPS),
        "i2i_routes": [],
        "postprocess": "裁格(人像特写格/正侧背全身格)",
    },
    "高清人脸": {
        "lora_recipe": [dict(e) for e in TRIO],
        "steps_hint": dict(STEPS),
        "i2i_routes": [
            {"name": "人物图裁切精修", "entry": "K2-人脸精修-道劫.json",
             "denoise": 0.35, "note": "A/B 档 0.25 更保身份"},
        ],
        "postprocess": "出图后按 UI 圆/方裁切即头像;同角色跨图同脸由主体句锚定",
    },
    "分镜剧情图": {
        "lora_recipe": [
            {"file": F_DETAIL, "weight": 1.0, "slot": "detail"},
            {"file": F_ASIAN, "weight": 0.4, "slot": "asianmix"},
            {"file": F_LIUJIN, "weight": 0.3, "slot": "liujin"},
            {"file": F_TANCAI, "weight": 0.5, "slot": "tancai",
             "range": [0.5, 0.6], "note": "连环画候选(场景证据外推,九型实弹专拍)"},
        ],
        "steps_hint": dict(STEPS),
        "i2i_routes": [],
        "postprocess": "可复用成片模板 03/07/21/26 骨架;主体句可追加连环画句",
    },
    "表情差分": {
        "lora_recipe": [dict(e) for e in TRIO],
        "steps_hint": dict(STEPS),
        "i2i_routes": [
            {"name": "人脸变体", "entry": "K2-表情差分-道劫.json",
             "denoise": 0.25, "note": "低去噪保面容;A/B 档 0.35 变化更大"},
        ],
        "postprocess": "格名文字后期再加(生成期负向已压 text)",
    },
    "概念气氛图": {
        "lora_recipe": [
            {"file": F_DETAIL, "weight": 1.0, "slot": "detail"},
            {"file": F_SUMIWASH, "weight": 0.7, "slot": "sumiwash",
             "range": [0.6, 0.8], "note": "洇墨+留白与该型最契合,候选首选(场景证据外推,九型实弹专拍)"},
            {"file": F_GOLDENMIST, "weight": 0.6, "slot": "goldenmist",
             "range": [0.6, 0.8], "note": "0.6 起步"},
        ],
        "steps_hint": dict(STEPS),
        "i2i_routes": [],
        "postprocess": "备选画风件=[84]湿画×0.5-0.6(与墨洗二选一);恒不做跨图一致性要求",
    },
}


def main() -> int:
    entries = json.loads(BASES.read_text(encoding="utf-8"))
    names = [e["zh"] for e in entries]
    if set(names) != set(V3):
        print(f"✗ 九型名不符:json={names} vs 脚本={sorted(V3)}", file=sys.stderr)
        return 2
    for e in entries:
        if "lora_recipe" in e or "steps_hint" in e:
            print(f"✗ 「{e['zh']}」已有 v3 字段,拒绝二次叠加(如需重跑先 git checkout)",
                  file=sys.stderr)
            return 2
    for e in entries:
        patch = V3[e["zh"]]
        assert list(patch) == ["lora_recipe", "steps_hint", "i2i_routes", "postprocess"]
        e["recipe_version"] = V3_VERSION
        e.update(patch)
    BASES.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
                     encoding="utf-8")

    # 自检:九型全量新字段 + 老字段仍在 + 权重域
    back = json.loads(BASES.read_text(encoding="utf-8"))
    assert len(back) == 9
    for e in back:
        for f in ("lora_recipe", "steps_hint", "i2i_routes", "postprocess",
                  "recipe_version"):
            assert f in e, (e["zh"], f)
        for f in ("key", "zh", "purpose", "aspect_ratio", "megapixels",
                  "positive", "negative"):
            assert f in e, (e["zh"], f)
        for it in e["lora_recipe"]:
            assert set(it) >= {"file", "weight"} and it["file"].endswith(".safetensors")
            assert 0 < it["weight"] <= 1.0
        assert e["steps_hint"]["fast"] == 4 and e["steps_hint"]["quality"] == 12
        for r in e["i2i_routes"]:
            assert r["entry"].endswith(".json")
    # 画风互斥:82/83/84 同型同开 ≤1
    trio_files = {F_TANCAI, F_SUMIWASH, "Krea2-画风/Krea2-水彩湿画wash_v1.safetensors"}
    for e in back:
        n = sum(1 for it in e["lora_recipe"] if it["file"] in trio_files)
        assert n <= 1, (e["zh"], "三画风同开>1 违互斥纪律", n)
    print("OK daojie_bases.json v3:九型 lora_recipe/steps_hint/i2i_routes/postprocess 落库,老字段零改动")
    return 0


if __name__ == "__main__":
    sys.exit(main())
