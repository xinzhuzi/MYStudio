#!/usr/bin/env python3
"""单镜.json 四采修脸臂拆帧源改吃二采 p2 出片口(1118 门禁红根修,幂等 fail-closed)。

门禁实录:test_facerefine_inline_arm_1118 红(节点数 85≠86+5002 源 4002≠3053);multiseg 件
同臂口径本就是 5002←3053(二采出片口)+契约 test_facerefine_group_inline_bypass 钉同款——本轮
令单镜.json 对齐:link 795 改源 [4002]→[3053](4002 仍喂 5100.on_false=p3 直通,极性不动)。

改动面(拓扑手术,非布局-only):
  画布  link 795 origin 4002→3053 + 双端槽簿记(4002.out0.links 除名 795 / 3053.out0.links 挂 795)
        + README 9999 臂拓扑行「5002 拆 4002」→「5002 拆 3053(二采 p2 出片)」
  API   h3-three-stage-template.api.json g["5002"].inputs.video ["4002",0]→["3053",0]
  棘轮  拓扑变更=合法重立基线(OPTIMIZATION ④):baseline 键按实测现值重钉(升/降皆如实)

守门:链数不变、links 表仅 795 一行变源、节点字段仅 4002/3053 出槽 links 与 9999 README 变、
      恒向右(3053.x=5793<5002.x=7200)、est 四零不破(overlap/spacing/negative/leftward)、
      生成器 sancai_inline_facerefine_build_1118.py WIRING/API_NEW/README/check 已同步同源。
用法:
  python3 apps/build/scripts/sancai_facerefine_p2source_1118.py           # 施治+守门+棘轮
  python3 apps/build/scripts/sancai_facerefine_p2source_1118.py --verify  # 只跑守门断言
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".zcode/skills/node-graph/tools"))
from layout_check import CHECK_KEYS, check_workflow  # noqa: E402

WF = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/单镜.json"
API = REPO / "apps/frontend/lib/comfyui/h3/templates/h3-three-stage-template.api.json"
BASELINE = REPO / "apps/build/scripts/workflow_layout_baseline.json"

LID = 795
OLD_SRC, NEW_SRC = 4002, 3053
README_OLD = "- **臂拓扑**:5002 拆 4002(帧①+音轨②)"
README_NEW = "- **臂拓扑**:5002 拆 3053(二采 p2 出片·帧①+音轨②)"


def die(msg: str) -> None:
    print(f"[FAIL] {msg}")
    raise SystemExit(1)


def apply_canvas(d: dict) -> dict:
    nodes = {n["id"]: n for n in d["nodes"]}
    l795 = next((l for l in d["links"] if l[0] == LID), None)
    if l795 is None:
        die(f"link {LID} 不在册")
    if l795[1] == NEW_SRC:
        return d                                     # 已施治,幂等
    expected = [LID, OLD_SRC, 0, 5002, 0, "VIDEO"]
    if l795 != expected:
        die(f"link {LID} 现值 {l795} 非预期前置形态 {expected}")
    l795[1] = NEW_SRC
    o4 = nodes[OLD_SRC]["outputs"][0]
    o3 = nodes[NEW_SRC]["outputs"][0]
    if LID not in (o4.get("links") or []) or o4.get("name") != "VIDEO" or o3.get("name") != "VIDEO":
        die("出槽簿记前置不符(4002.out0 应挂 795 / 双方槽名 VIDEO)")
    o4["links"].remove(LID)
    o3.setdefault("links", []).append(LID)
    md = nodes[9999]["widgets_values"]
    if md[0].count(README_OLD) != 1:
        die(f"README 臂拓扑行待替串出现 {md[0].count(README_OLD)} 次(应恰 1)")
    md[0] = md[0].replace(README_OLD, README_NEW)
    return d


def apply_api(a: dict) -> dict:
    v = a.get("5002", {}).get("inputs", {}).get("video")
    if v == ["3053", 0]:
        return a
    if v != ["4002", 0]:
        die(f"API g['5002'].video 现值 {v} 非预期 ['4002',0] 前置形态")
    a["5002"]["inputs"]["video"] = ["3053", 0]
    return a


def gate(d_before: dict, d_after: dict, cb: dict, ca: dict) -> None:
    if d_after == d_before:
        assert all(ca[k] == cb[k] for k in CHECK_KEYS), "幂等态读数漂移"
    else:
        assert d_after["links"] != d_before["links"] and len(d_after["links"]) == len(d_before["links"])
        diff = [i for i, (x, y) in enumerate(zip(d_before["links"], d_after["links"])) if x != y]
        assert diff == [[i for i, l in enumerate(d_before["links"]) if l[0] == LID][0]], \
            f"links 表变动行 {diff} 应恰为 link {LID} 一行"
        nb = {n["id"]: copy.deepcopy(n) for n in d_before["nodes"]}
        na = {n["id"]: copy.deepcopy(n) for n in d_after["nodes"]}
        for nid in nb:
            if nid in (OLD_SRC, NEW_SRC, 9999):
                continue
            assert nb[nid] == na[nid], f"节点 {nid} 被意外改动"
        for nid in (OLD_SRC, NEW_SRC):
            b, a = nb[nid], na[nid]
            assert b["outputs"][1:] == a["outputs"][1:] and b["inputs"] == a["inputs"]
            bl, al = b["outputs"][0].get("links"), a["outputs"][0].get("links")
            assert sorted(x for x in bl if x != LID) == sorted(x for x in al if x != LID) \
                and (LID not in bl) and (LID in al) if nid == NEW_SRC else (LID in bl) and (LID not in al), \
                f"{nid} 出槽簿记变动超预期"
    assert ca["est_overlap"] == 0 and ca["est_spacing"] == 0 and ca["negative_region"] == 0 \
        and ca["leftward"] == 0 and ca["group_overlap"] == 0, "est 四零被破"
    nodes = {n["id"]: n for n in d_after["nodes"]}
    l795 = next(l for l in d_after["links"] if l[0] == LID)
    assert nodes[l795[3]]["pos"][0] > nodes[l795[1]]["pos"][0], "新源左向线"
    print(f"  [守门] 链数 {len(d_after['links'])} 不变;仅 link {LID} 改源 {OLD_SRC}→{NEW_SRC};"
          f"est 四零保持;恒向右({NEW_SRC}.x < 5002.x)")


def ratchet(ca: dict) -> None:
    b = json.loads(BASELINE.read_text(encoding="utf-8"))
    key = str(WF.relative_to(REPO))
    scope = b["files"].setdefault(key, {}).setdefault("scopes", {}).setdefault("main", {})
    old = (scope.get("crossings"), scope.get("occlusion"))
    scope["crossings"], scope["occlusion"] = ca["crossings"], ca["occlusion"]
    BASELINE.write_text(json.dumps(b, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    note = "降" if (ca["crossings"], ca["occlusion"]) <= old else "升(拓扑变更重立基线,OPTIMIZATION ④)"
    print(f"  [棘轮] baseline {key} main {old} → ({ca['crossings']}, {ca['occlusion']}) [{note}]")


def main() -> int:
    verify_only = "--verify" in sys.argv
    d_before = json.loads(WF.read_text(encoding="utf-8"))
    a_before = json.loads(API.read_text(encoding="utf-8"))
    cb = check_workflow(d_before)[0]["counts"]
    d_after = apply_canvas(copy.deepcopy(d_before))
    a_after = apply_api(copy.deepcopy(a_before))
    ca = check_workflow(d_after)[0]["counts"]
    print(f"[读数] 施治前后 crossings {cb['crossings']}→{ca['crossings']} / "
          f"occlusion {cb['occlusion']}→{ca['occlusion']} / est_spacing {cb['est_spacing']}→{ca['est_spacing']}")
    gate(d_before, d_after, cb, ca)

    if d_after == d_before and a_after == a_before:
        print("[幂等] 画布+API 均已在目标态,零字节改动")
    elif verify_only:
        print("[VERIFY] 目标态未落盘(--verify)")
        return 0
    else:
        WF.write_text(json.dumps(d_after, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        API.write_text(json.dumps(a_after, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[落盘] {WF.relative_to(REPO)}(link {LID} 改源+槽簿记+README)+ {API.relative_to(REPO)}(g5002.video)")
    if not verify_only:
        ratchet(ca)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
