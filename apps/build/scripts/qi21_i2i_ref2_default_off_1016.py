#!/usr/bin/env python3
"""qi21-道劫-i2i 默认单参考收口(2026-10-16,用户令:「[17] 默认也不开启,默认只开 1 个参考图」)。

刀:[11] 参考图2·LoadImage + [17] 参考预缩·Scale 翻 mode 0→4(与第三对 [12]+[18]
同款成对旁路手法;接线原样保留,旁路=执行图缺席)。默认行为=仅 image_1 单参考。
[402]「参考图三槽」默认口径句随刀。
fail-closed:术前 md5 锚;术后 mode 矩阵+回读;幂等 exit 3。装机直同步(数据级,免打包)。
"""
import json, shutil, sys, hashlib
from pathlib import Path
WF = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")
INSTALL = Path("/Applications/漫影工作室.app/Contents/Resources/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")
PRE_MD5 = "bbc973ee2cd342c71c827b9d4c92200e"
NOTE_SUBS = [
    ("- image_2 = clothing_light_blue_denim_shirt.png(参考/衬衫)",
     "- image_2 = clothing_light_blue_denim_shirt.png(参考/衬衫,**默认旁路态 Ctrl+B**——1016 起默认仅开 image_1 单参考;要用第二参考=选中 [11]+[17] 解旁路)"),
    ("- image_3 = [12] 占位空图,**默认旁路态(Ctrl+B)**——默认行为=双参考不变;要用第三张参考=选中 [12]+[18] 按 Ctrl+B 解旁路→选图→跑;",
     "- image_3 = [12] 占位空图,**默认旁路态(Ctrl+B)**——默认行为=单参考(仅 image_1);要用第三张参考=选中 [12]+[18] 按 Ctrl+B 解旁路→选图→跑;"),
]
def fail(m, code=2):
    print(f"[r2off] FAIL: {m}"); sys.exit(code)
def md5(p): return hashlib.md5(p.read_bytes()).hexdigest()
def main():
    cur = md5(WF)
    wf = json.loads(WF.read_text(encoding="utf-8"))
    nn = {n["id"]: n for n in wf["nodes"]}
    if nn[11].get("mode", 0) == 4 and nn[17].get("mode", 0) == 4:
        print("[r2off] 已术后形态,幂等拦停"); sys.exit(3)
    if cur != PRE_MD5: fail(f"术前 md5 锚不符:{cur}")
    if nn[11].get("mode", 0) != 0 or nn[17].get("mode", 0) != 0:
        fail("[11]/[17] 术前应 mode 0")
    bak = WF.with_suffix(".json.bak-1016r2")
    shutil.copy2(WF, bak)
    nn[11]["mode"] = 4; nn[17]["mode"] = 4
    note = nn[402]["widgets_values"]
    for old, new in NOTE_SUBS:
        if old not in note[0]: fail(f"[402] 锚句缺失:{old[:30]}")
        note[0] = note[0].replace(old, new)
    want = {10: 0, 16: 0, 11: 4, 17: 4, 12: 4, 18: 4, 505: 4}
    got = {i: nn[i].get("mode", 0) for i in want}
    if got != want: fail(f"mode 矩阵不符:{got}")
    if len(wf["links"]) != 48: fail("根线数被误伤")
    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    r = json.loads(WF.read_text(encoding="utf-8"))
    rn = {n["id"]: n for n in r["nodes"]}
    if rn[11].get("mode") != 4 or rn[17].get("mode") != 4: fail("回读不符")
    print(f"[r2off] 完成:[11]+[17] 默认旁路(默认=单参考);md5 {md5(WF)}")
    if INSTALL.exists():
        shutil.copy2(WF, INSTALL)
        if md5(INSTALL) != md5(WF): fail("装机 md5 对账失败")
        print("[r2off] 装机同步 md5 同(数据级直同步,免打包)")
if __name__ == "__main__":
    main()
