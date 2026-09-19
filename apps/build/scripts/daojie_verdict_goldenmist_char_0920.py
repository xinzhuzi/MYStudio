#!/usr/bin/env python3
"""用户终审落账 09-20:人物型画风槽 = 金雾仙侠 ×0.8(终审图 87_char_w08)。

用户裁定(09-20):~/Downloads/daojie_lora_ab_0919/87_char_w08.png「这个风格不错」。
该跑构成(runs_audit.json 实证):[85]按型人物三件(细节×1+亚洲×0.4+鎏金×0.3)
+ 功能双件(Turbo×1/服从度×0.01)+ [87]金雾×0.8,seed=42,1024²,4步cfg1。
即用户认可的是金雾 0.8 叠加在现人物配方之上(非替换鎏金)。
启停纪律核对:金雾=「1」,鎏金 0.3=「半件」→ 画风同开 ≤1+鎏金半件,合规。

改动面(全部幂等,重跑零变化):
  1. my_nodes/nodes/daojie_loras.json      人物.loras += 金雾×0.8(热调文件,[85]即时生效)
  2. my_nodes/nodes/daojie_lora_stack.json  goldenmist.presets[人物] = on×0.8([90]栈节点)
  3. my_nodes/nodes/daojie_bases.json       人物.lora_recipe += {金雾, 0.8, slot=goldenmist}
  4. docs/prompts/道劫_九型配方_0919.md      人物行主配方/画风槽列终审化
  5. docs/prompts/道劫_水墨四件对拍定谳_0919.md 追加 §6 用户终审记录
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


patch(NODES / "daojie_loras.json", hot_loras)
patch(NODES / "daojie_lora_stack.json", stack)
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
vd.write_text(vt, encoding="utf-8")

print("改动文件:", ", ".join(changed) if changed else "无(已幂等)")
