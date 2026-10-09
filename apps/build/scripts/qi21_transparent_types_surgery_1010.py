#!/usr/bin/env python3
"""透明域配比行收尾手术(1010,用户令「按照你的建议都做」)——多视图+表情差分两处,
与道具(1010晨)/高清人脸(1010晨)同刀同族。至此透明四型配比行全部透明安全化;
非透明五型钦定冻结句不动(带背景域基底语义合法)。幂等;五路热刷。"""
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
EDITS = {  # zh: (旧串, 新串)
    "人物多视图": ("以大面积稳定基底承托，中等强度色作主体层次",
                "色仅落于人物本体，中等强度色作主体层次"),
    "表情差分": ("以稳定基底承托，中等强度色作层次",
               "色仅落于头脸本体，中等强度色作层次"),
}


def main():
    d = json.loads(SRC.read_text(encoding="utf-8"))
    for zh, (old, new) in EDITS.items():
        t = next(e for e in d["types"] if e.get("zh") == zh)
        pt = t["positive_text"]
        if new in pt:
            print(f"✓ {zh}: 已是新版,跳过")
            continue
        n = pt.count(old)
        assert n == 1, f"[{zh}] 锚计数={n}(应恰1),中止"
        t["positive_text"] = pt.replace(old, new)
        print(f"✓ {zh}: 基底承托→{new.split('，')[0]}")
    SRC.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    import hashlib
    md5 = lambda p: hashlib.md5(Path(p).read_bytes()).hexdigest()
    ok = True
    for dst in BRUSH:
        if dst.exists() and dst.stat().st_ino == SRC.stat().st_ino:
            print(f"  ↷ 同inode跳过 {dst}"); continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SRC, dst)
        same = md5(dst) == md5(SRC)
        txt = Path(dst).read_text(encoding="utf-8")
        c_old = txt.count("以大面积稳定基底承托")
        ok = ok and same and c_old == 5  # 7-道具-多视图=5
        print(f"  {'✓' if same else '✗'} 已刷 {dst.parent.name[-14:]} 旧句余={c_old}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
