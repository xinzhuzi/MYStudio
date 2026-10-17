#!/usr/bin/env python3
"""分镜型句多彩升档手术(1010,用户令「好」批准;底座不动=用户令「不动底座」)。

三处(全在型句职责域:细节分配应用句/环境画法应用句/多彩行预算):
①人物细节居首,远景渐虚渐简 → 人物细节密度最高,衣纹配器与须发细节完整呈现
②远景以低对比色面退去,色彩浓淡分明,渐远渐虚 → 远景以色彩分明的成片色面退去,色相对比保持清晰
③传统色中等强度多色相各安其位 → 传统色较高强度多色相并陈,色面饱满
(仅分镜条目;「传统色中等强度多色相各安其位」人物型同文,JSON级scoped不误伤;
措辞避开底座原句;满幅令一行原样保留。)幂等;五路热刷。"""
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
EDITS = [
    ("人物细节居首，远景渐虚渐简", "人物细节密度最高，衣纹配器与须发细节完整呈现"),
    ("远景以低对比色面退去，色彩浓淡分明，渐远渐虚", "远景以色彩分明的成片色面退去，色相对比保持清晰"),
    ("传统色中等强度多色相各安其位", "传统色较高强度多色相并陈，色面饱满"),
]


def main():
    d = json.loads(SRC.read_text(encoding="utf-8"))
    t = next(e for e in d["types"] if e.get("zh") == "分镜剧情图")
    pt = t["positive_text"]
    for old, new in EDITS:
        if new in pt:
            print(f"✓ 幂等命中,跳过:{new[:18]}…")
            continue
        n = pt.count(old)
        assert n == 1, f"锚计数={n}(应恰1):{old[:24]}"
        pt = pt.replace(old, new)
    t["positive_text"] = pt
    SRC.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("✓ 分镜型句三处升档落盘;满幅令行保留:", "环境色面铺满画幅" in pt)

    import hashlib
    md5 = lambda p: hashlib.md5(Path(p).read_bytes()).hexdigest()
    ok = True
    for dst in BRUSH:
        if dst.exists() and dst.stat().st_ino == SRC.stat().st_ino:
            print(f"  ↷ 同inode跳过 {dst}"); continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SRC, dst)
        same = md5(dst) == md5(SRC)
        ok = ok and same
        print(f"  {'✓' if same else '✗'} 已刷 {dst.parent.name[-14:]}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
