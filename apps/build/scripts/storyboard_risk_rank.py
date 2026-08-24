#!/usr/bin/env python3
"""分镜内容合理性·风险分级器(L1)——审不过来的量,先分出必须看的。

风险信号(全部机检,来源=08-24 五次事故的高危形态):
  R1 参考≥4        身份混淆高危(参考越多模型越易张冠李戴)
  R2 双工作流并存   代际污染史(26 镜实证)
  R3 清单修正过     associateAssetsNames 与工作流参考不同源(数据修过的镜)
  R4 场景过渡/切换   画面文本含场景桥接词(从X到Y/延续/步入)——场景误挂高发段
  R5 对话对象隐含   台词有「:A：…」对话但画面文本无对话对象名(启发式边界,S10 型)
  R6 无@图绑定句    参考挂了但 prompt 未声明对应(模型自由对应参考)
输出: P0(必检)/P1(抽检~30%)/P2(免检) 三级清单+理由。
用法: python3 storyboard_risk_rank.py [--json]
"""
from __future__ import annotations
import json, re, sys, glob
from pathlib import Path

STORE = Path("/Users/zhengbingjin/Project/IP/MA/store/studio-workflow")

def main() -> None:
    as_json = "--json" in sys.argv
    man = json.loads((STORE / "manifest.json").read_text())
    sbs, wfs = {}, {}
    for shard in man["shards"]:
        d = json.loads((STORE / shard).read_text())
        st = d.get("state", {})
        for sb in st.get("storyboards") or []: sbs[sb.get("id")] = sb
        for wf in st.get("imageWorkflows") or []: wfs[wf.get("id")] = wf
    by_target: dict[str, list] = {}
    for wf in wfs.values():
        t = wf.get("target") or {}
        if t.get("kind") == "storyboard":
            by_target.setdefault(t.get("id"), []).append(wf)
    rows = []
    for sid, sb in sbs.items():
        idx = sb.get("index")
        text = (sb.get("videoDesc") or "") + "\n" + (sb.get("lines") or "")
        names = set(sb.get("associateAssetsNames") or [])
        risks: list[str] = []
        wlist = by_target.get(sid, [])
        # 绑定到当前镜的参考(mediaRef 工作流优先)
        cur = (sb.get("mediaRef") or {}).get("imageWorkflowId") or sb.get("imageWorkflowId")
        wf = wfs.get(cur) if cur else None
        if not wf and wlist:
            wf = wlist[0]
        refs = [n for n in (wf.get("nodes", []) if wf else []) if n.get("type") == "reference"]
        if len(refs) >= 4: risks.append(f"R1参考×{len(refs)}")
        if len(wlist) > 1: risks.append("R2双流")
        # R3 清单与参考不同源(参考人物不在清单且清单人物不在参考)
        ref_titles = {(r.get("title") or "").replace("·分层", "") for r in refs}
        role_ref = {t for t in ref_titles if len(t) >= 2}
        missing_in_refs = [n for n in names if n and not any(n in t or t in n for t in role_ref)]
        extra_in_refs = [t for t in role_ref if not any(t in n or n in t for n in names)]
        if missing_in_refs and extra_in_refs: risks.append(f"R3清单/参考异源")
        if re.search(r"(从.{1,6}(到|进入|步入)|延续到|望向|投向)", text): risks.append("R4场景过渡")
        lines = sb.get("lines") or ""
        speakers = set(re.findall(r"([\u4e00-\u9fa5A-Za-z]{1,6})[：:]", lines))
        if speakers and any(s and s not in text.replace("：", "").replace(":", "") for s in speakers):
            risks.append("R5对话对象边界")
        prompt = next((n.get("prompt") or "" for n in (wf.get("nodes", []) if wf else []) if n.get("type") == "prompt"), "")
        if refs and not re.search(r"@图\d+\s*为", prompt): risks.append("R6无绑定句")
        # 分级: R2(双流)是历史形态且择优已防御——单独出现降 P1;
        # 其余信号(R1/R3-R6)任一出现即 P0(组合更高危)
        hard = [r for r in risks if not r.startswith("R2")]
        grade = "P0" if hard else ("P1" if risks or len(refs) >= 3 else "P2")
        rows.append((grade, idx, risks, len(refs)))
    rows.sort(key=lambda r: (r[0] != "P0", r[0] != "P1", r[1] or 0))
    if as_json:
        print(json.dumps([{"grade": g, "shot": i, "risks": r, "refs": n} for g, i, r, n in rows], ensure_ascii=False))
    else:
        from collections import Counter
        dist = Counter(r[0] for r in rows)
        print(f"82 镜分级: P0必检={dist['P0']} P1抽检={dist['P1']} P2免检={dist['P2']}")
        print("--- P0(人工必检) ---")
        for g, i, r, n in rows:
            if g == "P0": print(f"  S{i:02d} [{','.join(r)}]")
        p1 = [i for g, i, r, n in rows if g == "P1"]
        print(f"--- P1(抽检30%≈{max(1,len(p1)*3//10)}镜): S{p1[0]:02d}-S{p1[-1]:02d} 共{len(p1)} ---")
    sys.exit(0)

if __name__ == "__main__":
    main()
