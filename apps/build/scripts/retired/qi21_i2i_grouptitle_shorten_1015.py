#!/usr/bin/env python3
"""qi21-道劫-i2i 组框标题瘦身(2026-10-15,用户令「又臭又长→缩短,明确」)。

口径:
  - 布局策略明文「组框标题 ≤20 字」回归;工程台账/机制细节一律退役出标题
    (历史详情已住 git 史+漫影工作流清单行;操作信息(⑤整组旁路 Ctrl+B/
    4.2MP 插值警示/唯一手写位等)经核已在 [402] 用法速查全覆盖=零信息丢失)。
  - 契约锚 4 处全为 startswith 前缀匹配(:4065 ②指令外露带/:4074 ②图像·/
    :3932 道劫·加速区/:4781 道劫·⑤SeedVR2放大尾档),瘦身标题保前缀=零迁移。
  - 子图组标题零契约锚,自由瘦身;加速子图内五框去冗余「道劫·加速子图·」前缀。

fail-closed:术前 md5 字节锚+15 组标题前缀锚不符即零写入;术后组数/组 id/
零重叠/节点连线数零变+回读终验;幂等拦停 exit 3。
"""
import json
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
INSTALL = Path("/Applications/漫影工作室.app/Contents/Resources/backend/engines/"
               "comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")
SG6_PREFIX = "[6] 文本提示词类型优化子图"

PRE_MD5 = "8dec66120263b23f9f6b477a80f48f22"

# (域, 旧标题唯一前缀, 新标题)
PLAN = [
    ("root", "道劫·①加载器(", "道劫·①加载器"),
    ("root", "道劫·②图像·装配主链(", "道劫·②图像·装配主链"),
    ("root", "道劫·②指令外露带(", "道劫·②指令外露带"),
    ("root", "道劫·加速区③(", "道劫·加速区③"),
    ("root", "道劫·④输出(", "道劫·④输出"),
    ("root", "道劫·⑤SeedVR2放大尾档", "道劫·⑤SeedVR2放大尾档·2K"),
    ("sg6", "PE看图改写链(", "PE看图改写链(带0/1)"),
    ("sg6", "装配主链(", "装配主链(带2)"),
    ("sg6", "双图编码线(", "双图编码线(带3上)"),
    ("sg6", "单图编码线(", "单图编码线(带3下)"),
    ("xsg", "道劫·加速子图·①Fun-Acc 支路", "①Fun-Acc 支路(4步)"),
    ("xsg", "道劫·加速子图·②viggle", "②viggle 9步双段"),
    ("xsg", "道劫·加速子图·③原生出图支路", "③原生出图(40步)"),
    ("xsg", "道劫·加速子图·④seed 单源", "④seed 单源"),
    ("xsg", "道劫·加速子图·⑤档位选择", "⑤档位选择"),
]


def fail(m, code=2):
    print(f"[gt] FAIL: {m}")
    sys.exit(code)


def md5(p: Path) -> str:
    import hashlib
    return hashlib.md5(p.read_bytes()).hexdigest()


def overlap(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def main():
    if not WF.exists():
        fail("真源缺失")
    import hashlib
    cur = hashlib.md5(WF.read_bytes()).hexdigest()
    if cur != PRE_MD5:
        try:
            d = json.loads(WF.read_text(encoding="utf-8"))
            root_titles = {g["title"] for g in d["groups"]}
            if all(t in root_titles for _, _, t in PLAN[:6]) \
                    and not any("(" in t and not t.endswith(")") for t in root_titles):
                print("[gt] 已术后形态,幂等拦停")
                sys.exit(3)
        except Exception:
            pass
        fail(f"术前 md5 字节锚不符(期望 {PRE_MD5},得 {cur})")

    wf = json.loads(WF.read_text(encoding="utf-8"))
    sg6 = next(s for s in wf["definitions"]["subgraphs"] if s["name"].startswith(SG6_PREFIX))
    xsg = next(s for s in wf["definitions"]["subgraphs"] if "加速" in s["name"])
    scopes = {"root": wf["groups"], "sg6": sg6["groups"], "xsg": xsg["groups"]}

    n_nodes, n_links = len(wf["nodes"]), len(wf["links"])

    # ── 术前:15 前缀锚各恰一击 ──
    for scope, old_prefix, _ in PLAN:
        hits = [g for g in scopes[scope] if g["title"].startswith(old_prefix)]
        if len(hits) != 1:
            fail(f"[{scope}] 前缀锚「{old_prefix[:20]}」应恰一击,得 {len(hits)}")

    # ── 备份 ──
    bak = WF.with_suffix(".json.bak-1015gt")
    shutil.copy2(WF, bak)
    print(f"[gt] 备份 → {bak.name}")

    # ── 动刀:标题整体替换为新短标题(前缀保留=4 契约锚零迁移) ──
    for scope, old_prefix, new_title in PLAN:
        g = next(g for g in scopes[scope] if g["title"].startswith(old_prefix))
        g["title"] = new_title

    # ── 术后终验 ──
    if len(wf["nodes"]) != n_nodes or len(wf["links"]) != n_links:
        fail("节点/连线数被误伤(标题刀应零拓扑变)")
    all_titles = [g["title"] for g in wf["groups"]] + \
        [g["title"] for s in wf["definitions"]["subgraphs"] for g in s.get("groups", [])]
    if len(all_titles) != len(set(all_titles)):
        fail("组标题互异被破坏")
    for scope_name, groups in (("主图", wf["groups"]),
                               *((s["name"][:10], s["groups"]) for s in wf["definitions"]["subgraphs"] if s.get("groups"))):
        for g in groups:
            if not isinstance(g.get("id"), int):
                fail(f"[{scope_name}] 组 {g['title']!r} 丢 int id")
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                if overlap(groups[i]["bounding"], groups[j]["bounding"]):
                    fail(f"[{scope_name}] 组框重叠回潮")
    for _, _, t in PLAN:
        if len(t) > 20:
            fail(f"新标题「{t}」超 20 字口径({len(t)})")

    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    r = json.loads(WF.read_text(encoding="utf-8"))
    if len(r["nodes"]) != n_nodes or len(r["links"]) != n_links:
        fail("回读件数不符")
    print(f"[gt] 完成:15 组标题瘦身(root6+装配子图4+加速子图5);拓扑零变;"
          f"md5 {md5(WF)}")

    if INSTALL.exists():
        shutil.copy2(WF, INSTALL)
        if md5(INSTALL) != md5(WF):
            fail("装机副本 md5 对账失败")
        print(f"[gt] 装机副本同步 md5 同")


if __name__ == "__main__":
    main()
