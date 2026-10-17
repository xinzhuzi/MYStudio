#!/usr/bin/env python3
"""四型多彩升档手术(1010,用户令「美宣,人物,场景,概念气氛图的类型句也是这样,不要改其他类型」)。

与分镜同款三杠杆,锚串取现行文本(并行会话今晨已升人物/美宣背景句与场景细节句,本手术互补):
细节密度已"密度最高"在场的型不再动①;只翻②低对比/渐虚压制与③多彩行强度档。
不动:道具/人物多视图/高清人脸/表情差分/自由;底座;配比行(非透明冻结句)。幂等;五路热刷。"""
import json
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
SRC = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
BRUSH = [
    Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui/daojie-data/qi21_bases.json"),
    Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/daojie-data/qi21_bases.json"),
    Path("/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
]
EDITS = {
    "人物": [
        ("远景以低对比色面退开，仅存最简轮廓层次", "远景以色彩分明的成片色面退开，保留清晰色相层次"),
        ("传统色中等强度多色相各安其位，宣纸白仅作局部透气净空", "传统色较高强度多色相并陈，色面饱满，宣纸白仅作局部透气净空"),
    ],
    "美宣": [
        ("背景以低对比色面整体退后、笔墨退居其次", "背景以色彩分明的成片色面整体退后、笔墨退居其次"),
        ("远景收入一片低对比虚实", "远景收入成片色相层次"),
        ("传统色中等强度多色相各安其位，宣纸白仅作局部透气净空", "传统色较高强度多色相并陈，色面饱满，宣纸白仅作局部透气净空"),
    ],
    "场景": [
        ("远景只留大形，交给低对比色面，色彩浓淡分明，层层退远、渐淡渐虚", "远景只留大形，交给色彩分明的成片色面，层层退远而色相保持清晰"),
        ("传统色多色相铺陈各安其位，均匀柔光，平涂的底，颜色清透", "传统色较高强度多色相并陈，色面饱满，均匀柔光，平涂的底"),
    ],
    "概念气氛图": [
        ("远处交给低对比色面，层层退远，整体对比低", "远处交给色彩分明的成片色面，层层退远，色相对比保持清晰"),
        ("近处轮廓清楚而细节少", "近处轮廓清楚，主体细节完整呈现"),
        ("少数焦点色可二到三色相各安其位，受控饱和", "焦点色与背景色面多色相并陈各安其位，较高强度、饱和有度"),
    ],
}


def main():
    d = json.loads(SRC.read_text(encoding="utf-8"))
    for zh, pairs in EDITS.items():
        t = next(e for e in d["types"] if e.get("zh") == zh)
        pt = t["positive_text"]
        for old, new in pairs:
            if new in pt:
                print(f"✓ {zh}: 幂等命中跳过")
                continue
            n = pt.count(old)
            assert n == 1, f"[{zh}] 锚计数={n}(应恰1):{old[:26]}"
            pt = pt.replace(old, new)
        t["positive_text"] = pt
        print(f"✓ {zh}: {len(pairs)} 处升档")
    SRC.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    import hashlib
    md5 = lambda p: hashlib.md5(Path(p).read_bytes()).hexdigest()
    ok = True
    for dst in BRUSH:
        if dst.exists() and dst.stat().st_ino == SRC.stat().st_ino:
            print(f"  ↷ 同inode跳过 {dst}"); continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SRC, dst)
        ok = ok and md5(dst) == md5(SRC)
        print(f"  {'✓' if md5(dst)==md5(SRC) else '✗'} 已刷 {dst.parent.name[-14:]}")
    # 卫:低对比全库清点(五型应全无;未动的型本来就没有此词)
    txt = SRC.read_text(encoding="utf-8")
    print("全库「低对比」余数(应0):", txt.count("低对比"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
