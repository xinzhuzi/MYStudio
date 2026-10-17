#!/usr/bin/env python3
"""道具型配比行透明安全手术(1010,用户令「道具这块有问题,需要重新针对提示词进行优化」)。

病灶(实弹双证):配比行「以大面积稳定基底承托」在透明道具域被 PE 实例化——
手测道具终稿「镜身主体以大面积稳定的玄色基底承托,辅以石青/玉青薄透罩染」
(外来色+器物底色化);高清人脸手测同族发作(透明率 5.4%)。

手术:仅道具一份,「以大面积稳定基底承托」→「色仅落于器物本体」(肯定式/零色名/
透明安全);其余六型钦定冻结句一字不动(场景/概念等带背景型基底语义合法)。
五路热刷:真源→引擎家daojie-data(热读生效位)→IP引擎家→IP MA→装机包Resources。
幂等:NEW 已在=_no-op。
"""
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
OLD_CLAUSE = "以大面积稳定基底承托，中等强度色作主体层次"
NEW_CLAUSE = "色仅落于器物本体，中等强度色作主体层次"


def main():
    raw = SRC.read_text(encoding="utf-8")
    d = json.loads(raw)
    t = next(e for e in d["types"] if e.get("zh") == "道具")
    pt = t["positive_text"]

    if NEW_CLAUSE in pt:
        print("幂等命中:道具已是新版,无需手术")
    else:
        n = pt.count(OLD_CLAUSE)
        assert n == 1, f"道具 positive_text 内锚计数={n}(应恰1),中止"
        old_line = next(l for l in pt.split("\n") if "主体设色配比" in l)
        t["positive_text"] = pt.replace(OLD_CLAUSE, NEW_CLAUSE)
        new_line = next(l for l in t["positive_text"].split("\n") if "主体设色配比" in l)
        out = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
        SRC.write_text(out, encoding="utf-8")
        print("══ 旧配比行(道具):"); print(" ", old_line)
        print("══ 新配比行(道具):"); print(" ", new_line)

    # 热刷五路(真源为源;同 inode 副本自动跳过)
    import os
    src_stat = SRC.stat()
    for dst in BRUSH:
        if dst.exists() and (dst.stat().st_ino, dst.stat().st_dev) == (src_stat.st_ino, src_stat.st_dev):
            print(f"  ↷ 同 inode 跳过: {dst}")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SRC, dst)
        print(f"  ✓ 已刷: {dst}")

    # 验收:全副本 md5 一致 + 新句恰1处 + 旧句 7→6
    import hashlib
    md5 = lambda p: hashlib.md5(Path(p).read_bytes()).hexdigest()
    ok = True
    targets = [SRC] + BRUSH
    for p in targets:
        txt = Path(p).read_text(encoding="utf-8")
        c_new = txt.count(NEW_CLAUSE)
        c_old = txt.count("以大面积稳定基底承托")
        same = md5(p) == md5(SRC)
        print(f"  {'✓' if same and c_new == 1 and c_old == 6 else '✗'} {p.name}@{p.parent.name[-16:]} md5同={same} 新句={c_new} 旧句={c_old}")
        ok = ok and same and c_new == 1 and c_old == 6
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
