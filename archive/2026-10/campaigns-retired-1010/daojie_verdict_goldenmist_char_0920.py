#!/usr/bin/env python3
"""用户终审落账 09-20:金雾仙侠两条裁定幂等落库。

裁定1(人物型):87_char_w08「这个风格不错」→ 人物=三件+金雾×0.8(叠加非替换)。
  构成实证(runs_audit):[85]人物三件(细节1/亚洲0.4/鎏金0.3)+功能双件+[87]金雾0.8。
裁定2(场景型):87_scene_w06「这个不错」→ 场景=细节×1+金雾×0.6,**无墨洗**。
  构成实证(runs_audit):[85]仅细节×1(A/B 防双叠热调)+[87]金雾0.6,seed42,1024²。
  原 AI 初评主推「墨洗×0.8」未获用户成图认可 → 场景撤墨洗(降备选);
  概念气氛图墨洗0.7候选保留待终审。

改动面(全部幂等,重跑零变化):
  1. my_nodes/nodes/daojie_loras.json      人物+=金雾0.8;场景=细节+金雾0.6([85]热调)
  2. my_nodes/nodes/daojie_lora_stack.json  goldenmist:人物/设定板=on×0.8;sumiwash:场景=off
  3. my_nodes/nodes/daojie_bases.json       人物 lora_recipe+=金雾0.8;场景撤墨洗
  4. docs/prompts/道劫_九型配方_0919.md      人物行/场景行终审化
  5. docs/prompts/道劫_水墨四件对拍定谳_0919.md §6 用户终审记录
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
NODES = ROOT / "apps/backend/engines/comfyui/my_nodes/nodes"
GM = "Krea2-画风/金雾仙侠GoldenMisty.safetensors"
MARK = "09-20 用户终审"
changed: list[str] = []


def patch(path: Path, fn) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    before = json.dumps(data, ensure_ascii=False)
    fn(data)
    after = json.dumps(data, ensure_ascii=False)
    if after != before:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        changed.append(path.name)


def hot_loras(data):
    ent = next(e for e in data if e["key"] == "人物")
    if not any(l["file"] == GM for l in ent["loras"]):
        ent["loras"].append({"file": GM, "strength_model": 0.8})
    tag = f"金雾×0.8={MARK}(87_char_w08)"
    if tag not in ent["note"]:
        ent["note"] = ent["note"].rstrip("。") + f";{tag}。"


def stack(data):
    slot = next(s for s in data if s["key"] == "goldenmist")
    p = slot["presets"]["人物"]
    if not (p["on"] and abs(p["weight"] - 0.8) < 1e-9):
        p["on"], p["weight"] = True, 0.8
    ps = slot["presets"]["设定板"]  # 契约:设定板档=人物组逐槽复制(测试钉子)
    if not (ps["on"] and abs(ps["weight"] - 0.8) < 1e-9):
        ps["on"], ps["weight"] = True, 0.8
    tag = f"人物叠加×0.8={MARK}"
    if tag not in slot["note"]:
        slot["note"] = slot["note"].rstrip("。") + f";人物=叠加非互换({tag},与鎏金0.3合规同开;设定板档随人物组)。"


def bases(data):
    ent = next(e for e in data if e["key"] == "人物")
    if not any(r["file"] == GM for r in ent.get("lora_recipe", [])):
        ent.setdefault("lora_recipe", []).append({"file": GM, "weight": 0.8, "slot": "goldenmist"})
    sc = next(e for e in data if e["key"] == "场景")
    sc["lora_recipe"] = [r for r in sc.get("lora_recipe", []) if r.get("slot") != "sumiwash"]
    for r in sc["lora_recipe"]:
        if r["file"] == GM:
            r["note"] = f"0.6=终审剂量({MARK} 87_scene_w06,无墨洗构成)"


def hot_scene(data):
    ent = next(e for e in data if e["key"] == "场景")
    ent["loras"] = [l for l in ent["loras"] if "SumiWash" not in l["file"]]
    if not any(l["file"] == GM for l in ent["loras"]):
        ent["loras"].append({"file": GM, "strength_model": 0.6})
    tag = f"金雾×0.6 无墨洗={MARK}(87_scene_w06)"
    if tag not in ent["note"]:
        ent["note"] = ent["note"].rstrip("。") + f";{tag}。"


def stack_scene(data):
    sw = next(s for s in data if s["key"] == "sumiwash")
    if sw["presets"]["场景"]["on"]:
        sw["presets"]["场景"] = {"on": False, "weight": 0.8}
    tag = f"场景出局={MARK}"
    if tag not in sw["note"]:
        sw["note"] = sw["note"].rstrip("。") + f";场景{tag}(87_scene_w06 无墨洗构成获认可,降备选;概念气氛0.7候选保留)。"


patch(NODES / "daojie_loras.json", hot_loras)
patch(NODES / "daojie_loras.json", hot_scene)
patch(NODES / "daojie_lora_stack.json", stack)
patch(NODES / "daojie_lora_stack.json", stack_scene)
patch(NODES / "daojie_bases.json", bases)

mx = ROOT / "docs/prompts/道劫_九型配方_0919.md"
text = mx.read_text(encoding="utf-8")
old_main = "| 人物 | 3:4·4.2(1816×2424) | 细节×1+亚洲面孔×0.4+鎏金×0.3 | 画风槽不开;备选=墨洗轻档 0.4-0.6(可选非首选,§2.2) |"
new_main = "| 人物 | 3:4·4.2(1816×2424) | 细节×1+亚洲面孔×0.4+鎏金×0.3+金雾×0.8 | 画风槽=金雾×0.8(09-20 用户终审 87_char_w08;墨洗轻档 0.4-0.6 降为备选) |"
if old_main in text:
    text = text.replace(old_main, new_main)
    changed.append(mx.name)
elif new_main not in text:
    print(f"[!] 矩阵人物行未匹配,需人工核对:{mx}", file=sys.stderr)
old_scene = "| 场景 | 16:9·4.2(2800×1576) | 细节×1+**墨洗×0.8**+金雾×0.6 | 墨洗主推最佳档(§2.2);金雾 0.6=json 等价剂量(§2.4);免鎏金 | 去噪精修→`K2-去噪精修.json` | 备选画风=淡彩线描 0.5-0.6/湿画 0.6(互斥) |"
new_scene = "| 场景 | 16:9·4.2(2800×1576) | 细节×1+金雾×0.6 | 金雾 0.6=09-20 用户终审(87_scene_w06,无墨洗构成);免鎏金 | 去噪精修→`K2-去噪精修.json` | 备选画风=墨洗 0.6-0.8(终审出局)/淡彩线描 0.5-0.6/湿画 0.6(互斥) |"
if old_scene in text:
    text = text.replace(old_scene, new_scene)
    changed.append(mx.name + "(场景行)")
elif new_scene not in text:
    print(f"[!] 矩阵场景行未匹配,需人工核对:{mx}", file=sys.stderr)
old_concept = "| 概念气氛图 | 16:9·4.2(2800×1576) | 细节×1+**墨洗×0.7**+金雾×0.6 | 墨洗候选首选 0.6-0.8 取中值(§2.2,外推,**本轮实弹=专拍**);金雾 0.6 起步(§2.4) | — | 备选画风=湿画 0.5-0.6(与墨洗二选一) |"
new_concept = "| 概念气氛图 | 16:9·4.2(2800×1576) | 细节×1+金雾×0.6 | 金雾 0.6=09-20 双变体终审落定(0.5-0.6 均过审,取对齐场景剂量);墨洗否票出局 | — | 备选=金雾 0.5(过审变体V2);主体句层遗留:下半部死白/前景松树脱节待改 |"
if old_concept in text:
    text = text.replace(old_concept, new_concept)
    changed.append(mx.name + "(概念气氛行)")
elif new_concept not in text:
    print(f"[!] 矩阵概念气氛行未匹配,需人工核对:{mx}", file=sys.stderr)
mx.write_text(text, encoding="utf-8")

vd = ROOT / "docs/prompts/道劫_水墨四件对拍定谳_0919.md"
vt = vd.read_text(encoding="utf-8")
sec = """

## 6. 用户终审记录(09-20 起)

- **金雾 ×0.8 · 人物型 = 用户认可**(`~/Downloads/daojie_lora_ab_0919/87_char_w08.png`「这个风格不错」)。构成实证:人物三件(细节×1+亚洲×0.4+鎏金×0.3)+功能双件+金雾×0.8,seed=42,1024²。金雾 0.8 叠加于现配方(非替换鎏金);与「87 上限 0.8」初评吻合。已落库:daojie_loras/daojie_lora_stack/daojie_bases 三数据面 + 矩阵人物行(墨洗人物备选降级)。其余三件与其余型待续审。
"""
if "## 6. 用户终审记录" not in vt:
    vt += sec
    changed.append(vd.name)
bullet2 = "- **金雾 ×0.6 · 场景型 = 用户认可**(`~/Downloads/daojie_lora_ab_0919/87_scene_w06.png`「这个不错」)。构成实证:[85] 仅细节×1(A/B 防双叠热调)+[87]金雾×0.6,seed=42,1024²——**无墨洗**。据此场景配方撤墨洗(AI 初评主推「墨洗×0.8」降备选),三面对齐为 细节×1+金雾×0.6;概念气氛图墨洗 0.7 候选保留待终审。\n"
if "场景型 = 用户认可" not in vt:
    vt = vt.rstrip("\n") + "\n" + bullet2
    changed.append(vd.name + "(裁定2)")
bullet3 = "- **概念气氛图 = 否票后双变体均过审(「都可以」)**:原配方(细节+墨洗0.7+金雾0.6)被否,视觉诊断定谳墨洗=主犯(闷灰/水渍边/楼阁轮廓洗软,水彩湿画与界画相克)、金雾0.6=从犯(光斑粒子/滤镜感);V1(细节+金雾0.6)与 V2(细节+金雾0.5)双变体实弹均获认可 → **落定 V1(0.6,对齐场景已认可剂量),金雾 0.5-0.6 为该型可用区间**。墨洗自此九型预设全关,成为纯库存件(去留归台账勾选门)。非 LoRA 层遗留(下半部死白/前景松树脱节=主体句构图层)记录在案,本轮不动。\n"
if "概念气氛图 = 否票后双变体均过审" not in vt:
    vt = vt.rstrip("\n") + "\n" + bullet3
    changed.append(vd.name + "(裁定3)")
vd.write_text(vt, encoding="utf-8")

print("改动文件:", ", ".join(changed) if changed else "无(已幂等)")
