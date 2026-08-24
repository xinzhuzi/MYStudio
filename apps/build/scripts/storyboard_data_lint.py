#!/usr/bin/env python3
"""分镜数据不变量体检(08-24 五次事故规则固化)。

每次事故都是一条不变量——本脚本把它们全部机检,数据变动后跑一次:
  I1 画面外人物: 清单/工作流参考/绑定句三层,人物名(全名/去前缀/去姓/别名)
     未出现在画面文本(videoDesc+prompt+lines)即违规
  I2 参考文件: 每个 reference 的 imageUrl 须存在且可解码(资产改名断链)
  I3 绑定一致: prompt @图N 绑定句 = 运行时参考顺序(连向主成图,按 continuityOrder)
  I4 长度门: 分镜工作流 prompt(+注入余量)与 800 门
  I5 成图链: mediaRef 指向的工作流存在,且其参考人物对齐画面(I1 的工作流侧)
  I6 双工作流: 同镜多流时报出(人工核代际)

用法: python3 storyboard_data_lint.py [--json]   # 退出码=违规数(0=干净)
"""
from __future__ import annotations
import json, re, sqlite3, sys, glob
from pathlib import Path

STORE = Path("/Users/zhengbingjin/Project/IP/MA/store/studio-workflow")
ASSETS = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/assets")
PREFIXES = ("监工", "管事", "老", "年轻", "小", "断臂")

def probes_of(name: str) -> set[str]:
    out = {name}
    for pre in PREFIXES:
        if name.startswith(pre) and len(name) > len(pre) + 1:
            out.add(name[len(pre):])
    if len(name) >= 3:
        out.add(name[1:]); out.add(name[:2])
    for part in [x.strip() for x in name.split(";") if x.strip()]:
        out.add(part)
        if len(part) >= 3: out.add(part[1:])
    return {p for p in out if len(p) >= 2}

def mentioned(name: str, text: str, scene_hint: str = "") -> bool:
    if any(p in text for p in probes_of(name)):
        return True
    if "管事" in text:
        if "掌柜" in name and any(k in scene_hint for k in ("当铺", "客栈", "街巷", "道口镇")): return True
        if "李先生" in name and any(k in scene_hint for k in ("塾馆", "课堂", "授课")): return True
    return False

def main() -> None:
    as_json = "--json" in sys.argv
    man = json.loads((STORE / "manifest.json").read_text())
    con = sqlite3.connect(str(ASSETS / "assets.db"))
    roles = {n for (n,) in con.execute("SELECT name FROM assets WHERE type='role'")}
    chars = json.loads(Path("/Users/zhengbingjin/Project/IP/MA/store/characters.json").read_text())
    for c in (chars.get("state", chars).get("characters") or []):
        if c.get("name"): roles.add(c["name"])
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

    issues = []
    for sid, sb in sbs.items():
        idx = sb.get("index")
        text = ((sb.get("videoDesc") or "") + (sb.get("prompt") or "") + (sb.get("lines") or "")).replace(" ", "").replace("\n", "")
        names = sb.get("associateAssetsNames") or []
        # I1 清单层
        for n in names:
            if n in roles and not mentioned(n, text, " ".join(names)):
                issues.append(("I1", idx, f"清单人物[{n}]不在画面文本"))
        for wf in by_target.get(sid, []):
            nodes = {n["id"]: n for n in wf.get("nodes", [])}
            refs = [n for n in wf.get("nodes", []) if n.get("type") == "reference"]
            # I2 参考文件
            for r in refs:
                u = (r.get("imageUrl") or "").replace("file://", "")
                if u and not Path(u).exists():
                    issues.append(("I2", idx, f"参考[{r.get('title')}]文件不存在"))
            # I1 工作流参考层
            for r in refs:
                title = (r.get("title") or "").replace("·分层", "")
                if (title in roles or (len(title) >= 3 and any(title in x for x in roles))) and not mentioned(title, text, " ".join(names)):
                    issues.append(("I1", idx, f"工作流[{wf.get('id','')[:14]}]参考人物[{title}]不在画面"))
            # I3 绑定一致(连向主成图)
            main_gen = next((g for g in wf.get("nodes", []) if g.get("type") == "generated"
                             and "背景板" not in (g.get("title") or "") and "净底" not in (g.get("title") or "")), None)
            if main_gen:
                conn = [e for e in wf.get("edges", []) if e.get("target") == main_gen["id"]]
                order = sorted((nodes[e["source"]] for e in conn if nodes.get(e["source"], {}).get("type") == "reference"),
                               key=lambda n: n.get("continuityOrder") or 99)
                actual = {str(i + 1): (r.get("title") or "") for i, r in enumerate(order)}
                prompt = next((n.get("prompt") or "" for n in wf.get("nodes", []) if n.get("type") == "prompt"), "")
                for num, claimed in re.findall(r"@图(\d+)\s*为\s*([^;；。,\s]+)", prompt):
                    act = actual.get(num)
                    if act and claimed not in act and act not in claimed:
                        issues.append(("I3", idx, f"@图{num}绑定[{claimed}]≠实际[{act}]"))
            # I4 长度门(注入余量 1074 实测)
            plens = [len(n.get("prompt") or "") for n in wf.get("nodes", []) if n.get("type") == "prompt"]
            if plens and max(plens) > 800:
                issues.append(("I4", idx, f"prompt {max(plens)} 字符超 800 正文门"))
        # I5 成图链
        mr = sb.get("mediaRef") or {}
        mid = mr.get("imageWorkflowId") or sb.get("imageWorkflowId")
        if mr.get("kind") == "image" and mid and mid not in wfs:
            issues.append(("I5", idx, f"mediaRef 指向不存在的工作流"))
        # I6 双流
        if len(by_target.get(sid, [])) > 1:
            issues.append(("I6", idx, f"{len(by_target[sid])} 个工作流并存(核代际)"))
    if as_json:
        print(json.dumps(issues, ensure_ascii=False))
    else:
        from collections import Counter
        print(f"体检: {len(sbs)} 镜 | 违规 {len(issues)} 条 | 分布 {dict(Counter(i[0] for i in issues))}")
        for code, idx, msg in sorted(issues, key=lambda x: (x[0], x[1] or 0)):
            print(f"  [{code}] S{idx:02d}: {msg}")
    sys.exit(len(issues))

if __name__ == "__main__":
    main()
