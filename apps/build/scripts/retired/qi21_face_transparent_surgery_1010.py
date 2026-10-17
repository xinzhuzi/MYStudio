#!/usr/bin/env python3
"""高清人脸透明漏底三层手术(1010,用户令「认真核查…为什么没有透明背景」;08宪法SOP-1脚本手术)。

病灶(00007实弹,透明率5.4%):终稿「大面积基底选用宣纸白或米白以承托主体」=三层合谋——
①人脸型文「以稳定基底承托」(种子);②教材核心规则教「大面积基底…不得淡化或替代」;
③教材色卡选法「大面积基底 1 席」+透明段只禁「繁杂」背景不禁单色衬底。
附带发现:工作流/蓝图[4030]嵌3071字旧版,真源已3266(v11)——连线值压热读=漂移,一并治。

手术面:
  E1 人脸型文:「以稳定基底承托，中等强度色作层次」→「色仅落于头肩本体，中等强度色作层次」
  E2 教材透明开:加「亦禁铺设单色衬底」
  E3 教材核心规则:「大面积基底」→「大面积基底(仅关模式)」
  E4 教材色卡席:「大面积基底 1 席(」→「背景衬底 1 席(仅关模式;」
  E5 蓝图[4030] widgets_values[0] ← 新真源教材全文(治嵌版漂移;工作流随后走蓝图同步)
锚断言:每处旧串 count==1;表情差分同款「以稳定基底承托」不动(候令)。
"""
import json
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
SRC = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"

JSON_BRUSH = [
    Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui/daojie-data/qi21_bases.json"),
    Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/daojie-data/qi21_bases.json"),
    Path("/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
]
BP_BRUSH = [
    Path("/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"),
    Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes/subgraphs/qi21-提示词类型优化子图.json"),
]


def splice(text, old, new, tag):
    n = text.count(old)
    assert n == 1, f"[{tag}] 锚计数={n}(应恰1),中止"
    return text.replace(old, new)


def main():
    d = json.loads(SRC.read_text(encoding="utf-8"))

    # E1 人脸型文(仅人脸条目;表情差分同款不动)
    face = next(e for e in d["types"] if e.get("zh") == "高清人脸")
    face["positive_text"] = splice(
        face["positive_text"],
        "新增色由色卡选取，以稳定基底承托，中等强度色作层次",
        "新增色由色卡选取，色仅落于头肩本体，中等强度色作层次", "E1人脸型文")

    # E2-E4 教材
    sp_key = "system_prompt_zh"
    d["expand_instruction"][sp_key] = splice(d["expand_instruction"][sp_key],
        "禁虚构任何繁杂背景环境/远景叙事/大气效果(背景将被完全透明化)",
        "禁虚构任何繁杂背景环境/远景叙事/大气效果,亦禁铺设任何单色衬底(背景将被完全透明化)", "E2透明开")
    d["expand_instruction"][sp_key] = splice(d["expand_instruction"][sp_key],
        "大面积基底、罩染、环境语言不得淡化或替代",
        "大面积基底(仅关模式)、罩染、环境语言不得淡化或替代", "E3核心规则")
    d["expand_instruction"][sp_key] = splice(d["expand_instruction"][sp_key],
        "大面积基底 1 席(透明开时无背景",
        "背景衬底 1 席(仅关模式;透明开时无背景", "E4色卡席")

    new_sp = d["expand_instruction"][sp_key]
    # 语义自检(SOP-1):新标记在场/旧病标记离场/结构段完好
    assert "色仅落于头肩本体" in face["positive_text"]
    assert "以稳定基底承托" not in face["positive_text"]
    for must in ("亦禁铺设任何单色衬底", "大面积基底(仅关模式)", "背景衬底 1 席(仅关模式",
                 "## 透明模式", "## 裁决序", "rewritten_prompt"):
        assert must in new_sp, f"教材自检缺标记:{must}"
    SRC.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ 真源:E1-E4 落盘,教材 {len(new_sp)} 字")

    # E5 蓝图[4030]对齐真源(治 3071→新版漂移)
    bpd = json.loads(BP.read_text(encoding="utf-8"))
    n4030 = next(n for n in bpd["definitions"]["subgraphs"][0]["nodes"]
                 if n.get("id") == 4030)
    old_len = len(n4030["widgets_values"][0])
    n4030["widgets_values"][0] = new_sp
    BP.write_text(json.dumps(bpd, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ 蓝图[4030]:{old_len}字 → {len(new_sp)}字(对齐真源)")

    # 热刷
    import hashlib
    md5 = lambda p: hashlib.md5(Path(p).read_bytes()).hexdigest()
    for dst in JSON_BRUSH + BP_BRUSH:
        src = SRC if dst in JSON_BRUSH else BP
        if dst.exists() and dst.stat().st_ino == src.stat().st_ino:
            print(f"  ↷ 同inode跳过 {dst}"); continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        ok = md5(dst) == md5(src)
        print(f"  {'✓' if ok else '✗'} 已刷 {dst}")
        assert ok
    print("✓ JSON×5 + 蓝图×3 全md5一致")


if __name__ == "__main__":
    main()
