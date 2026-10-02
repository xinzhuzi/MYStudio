#!/usr/bin/env python3
# 大轮实弹八发汇总器(1002):livefire-report.json → 逻辑八发 ok/detail(主会话报文源)
import json
import sys
from pathlib import Path

R = json.loads(Path("apps/output/biground-1002/fire/livefire-report.json").read_text())
# 逻辑发 → 驱动发 key 映射(⑥=两臂)
GROUPS = [
    ("①直出九型(人物,pe关,直出40步)+懒执行取证(pe关零PE TE)", ["s1-t2i-direct-nine"]),
    ("②PE九型(人物,pe开默认,FunAcc)+PE文证+thinking预览可见文证", ["s2-t2i-pe-nine"]),
    ("③自由型+透明开(pe开)", ["s3-t2i-free-alpha"]),
    ("④道具型跟随(pe关,rgba_default 解析)", ["s4-t2i-prop-follow"]),
    ("⑤pe关×透明(Q4 补强:W1 包裹后过 50 门)", ["s5-t2i-peoff-alpha"]),
    ("⑥㉒头身比对拍(同seed同主体句,锚/去锚两臂)", ["s6-anchored", "s6-baseline"]),
    ("⑦i2i 直出(兼容)", ["s7-i2i-direct"]),
    ("⑧edit 改图(兼容)", ["s8-edit-outfit"]),
]
env = [x for x in R["results"] if x["shot"] == "(env)"]
print("== env ==")
for e in env:
    print(("PASS" if e["pass"] else "FAIL"), e["name"][:90], "|", e["detail"][:80])
print()
out = []
for title, keys in GROUPS:
    checks = [x for x in R["results"] if x["shot"] in keys]
    fails = [x for x in checks if not x["pass"]]
    shots_meta = [R["shots"].get(k, {}) for k in keys]
    secs = sum(s.get("secs") or 0 for s in shots_meta)
    pngs = [Path(s.get("png", "")).name for s in shots_meta if s.get("png")]
    detail = []
    if fails:
        detail.append("红项: " + "; ".join(f"[{x['shot']}] {x['name']}: {x['detail'][:70]}" for x in fails))
    greens = [x for x in checks if x["pass"]]
    detail.append(f"绿 {len(greens)}/{len(checks)} 子检;耗时 {secs}s;图 {pngs}")
    for s in shots_meta:
        a = s.get("alpha") or {}
        if a:
            m = a.get("metrics", {})
            detail.append(f"  {s.get('key')}: alpha={a.get('verdict')};ratio0={m.get('ratio0') or m.get('ratio_alpha0')};corners={m.get('corners')}")
    out.append({"name": title, "ok": len(fails) == 0, "detail": " | ".join(detail)})
    print(("OK " if len(fails) == 0 else "RED"), title)
    for d in detail:
        print("   ", d[:300])
Path("apps/output/biground-1002/fire/shots8-summary.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=1))
print("\nwritten shots8-summary.json")
