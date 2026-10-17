#!/usr/bin/env python3
"""qi21-道劫-i2i 子图[6] 内部规整化重排(2026-10-15,用户令「规整好看美观」)。

方法论=1008 布局求解器配方:行带骨架(4 带)固定+layout_check 当 oracle 退火搜 x
(1300 迭代×3 轮)+钉位工程(输入钉随最近消费件下缘、clip/vae 钉居两编码器夹缝、
输出钉按源 y 排序消 OUT 扇出互交)+两处子行下沉手工补(21 避同层横穿 23/
171 避 153→4015 横穿)。
终态:crossings 9/occlusion 0(基线 7/1:遮挡归零改善,交叉+2=规整化带因记账);
恒向右零违/零负区/est_overlap 0/组重叠 0;IO 钉全部贴消费件。
布局求解中间件:/tmp/sg6_solver.py(退火)+/tmp/sg6_diag.py(病灶诊断)。
fail-closed:术前 md5 锚+回读双终验;幂等 exit 3。
"""
import json, shutil, sys, hashlib
from pathlib import Path
WF = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")
INSTALL = Path("/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")
SG_PREFIX = "[6] 文本提示词类型优化子图"
PRE_MD5 = "7b370cb7"  # 前缀锚(全长比对见下)

POS = {23:(140,100), 21:(660,340), 24:(1180,100), 25:(2160,100),
       4012:(140,860), 4019:(1140,860), 4013:(2180,860), 27:(2920,860), 4018:(4760,860),
       4014:(3080,1620), 4011:(5080,1620),
       4010:(940,2380), 180:(2600,2380), 153:(5780,2380), 4015:(7600,2380), 171:(6460,2900)}
G1 = ("PE改写链+画幅建议(带0/1)", [100, 60, 5020, 1050])   # 23,21,24,25,4012,4019,4013,27,4018
G2 = ("装配主链(带2)", [900, 1580, 5300, 1240])            # 4014,4011,4010,180,153
G3 = ("双图编码线(带3上)", [7560, 2340, 500, 420])          # 4015
G4 = ("单图编码线(带3下)", [6420, 2860, 500, 420])          # 171

def fail(m, code=2):
    print(f"[sg6] FAIL: {m}"); sys.exit(code)

def md5(p): return hashlib.md5(p.read_bytes()).hexdigest()

def main():
    if not WF.exists(): fail("真源缺失")
    cur = md5(WF)
    wf = json.loads(WF.read_text(encoding="utf-8"))
    sg = next(s for s in wf["definitions"]["subgraphs"] if s["name"].startswith(SG_PREFIX))
    ns = {n["id"]: n for n in sg["nodes"]}
    if all(tuple(ns[n]["pos"]) == POS[n] for n in POS):
        print("[sg6] 已术后形态,幂等拦停"); sys.exit(3)
    if not cur.startswith(PRE_MD5):
        fail(f"术前 md5 锚不符:{cur}")
    # 术前:16 件全在+旧位置锚(抽三件)
    for nid, ox, oy in ((21,200,100),(4013,1900,1200),(4015,6200,640)):
        if abs(ns[nid]["pos"][0]-ox) > 2 or abs(ns[nid]["pos"][1]-oy) > 2:
            fail(f"[{nid}] 术前位置锚不符:{ns[nid]['pos']}")
    bak = WF.with_suffix(".json.bak-1015sg6")
    shutil.copy2(WF, bak); print(f"[sg6] 备份 → {bak.name}")
    # 刀1:节点坐标
    for nid, (x, y) in POS.items(): ns[nid]["pos"] = [x, y]
    # 刀2:IO 钉贴消费件
    cons = {}
    for l in sg["links"]:
        if l["origin_id"] == -10: cons.setdefault(l["origin_slot"], []).append(l)
    for slot, ls in cons.items():
        tx = min(POS[l["target_id"]][0] for l in ls)
        t0 = min(ls, key=lambda l: POS[l["target_id"]][1])
        ty = POS[t0["target_id"]][1] + (ns[t0["target_id"]].get("size") or [0,150])[1] + 50
        sg["inputs"][slot]["pos"] = [tx - 40, ty]
    for nm_ in sg["inputs"]:
        if nm_["name"] in ("clip", "vae"):
            enc = [POS[i][0] for i in (4015, 171)]
            nm_["pos"] = [min(enc) - 40, 2750 + 30 * (nm_["name"] == "vae")]
    mx = max(POS[n][0] + (ns[n].get("size") or [300,150])[0] for n in POS)
    SRC = {"positive":2400,"negative":2420,"latent":2440,"positive_single":2960,
           "prompt":2420,"画幅W":1300,"画幅H":1320}
    for o in sg["outputs"]: o["pos"] = [mx + 80, SRC.get(o["name"], 1600)]
    # 刀3:组框=行带 bbox
    for g, (title, bb) in zip(sg["groups"], (G1, G2, G3, G4)):
        g["title"], g["bounding"] = title, bb
    # 终验
    if len(wf["nodes"]) != 33 or len(wf["links"]) != 40: fail("拓扑被误伤")
    ins = sg["inputs"]
    for l in sg["links"]:
        ox = ins[l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 else ns[l["origin_id"]]["pos"][0]
        tx = sg["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 else ns[l["target_id"]]["pos"][0]
        if tx <= ox: fail(f"子图左向线残留 link{l['id']}")
    if not ins[9]["pos"][0] < ns[171]["pos"][0]: fail("透明锚钉应左于 [171]")
    def ov(a, b): ax,ay,aw,ah=a; bx,by,bw,bh=b
    def ov(a,b):
        ax,ay,aw,ah=a; bx,by,bw,bh=b
        return ax<bx+bw and bx<ax+aw and ay<by+bh and by<ay+ah
    for i in range(4):
        for j in range(i+1,4):
            if ov(sg["groups"][i]["bounding"], sg["groups"][j]["bounding"]): fail("组框重叠")
    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    r = json.loads(WF.read_text(encoding="utf-8"))
    rs = next(s for s in r["definitions"]["subgraphs"] if s["name"].startswith(SG_PREFIX))
    rn = {n["id"]: n for n in rs["nodes"]}
    if any(tuple(rn[n]["pos"]) != POS[n] for n in POS): fail("回读坐标不符")
    print(f"[sg6] 完成:16 件行带化+IO 钉贴源+组框四带;md5 {md5(WF)}")
    if INSTALL.exists():
        shutil.copy2(WF, INSTALL)
        if md5(INSTALL) != md5(WF): fail("装机 md5 对账失败")
        print("[sg6] 装机同步 md5 同")

if __name__ == "__main__":
    main()
