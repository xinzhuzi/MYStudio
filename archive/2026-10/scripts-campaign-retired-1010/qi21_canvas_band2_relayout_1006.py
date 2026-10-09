#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1006 批B·问题3:qi21 装配子图保守渲染预算重排(Trellis 10-06-ai-pe-canvas-fixes)。

背景:multiline 展示框(批A「内容」槽)使实际渲染高度 ≫ 序列化 size,旧布场
(三真源 y=860 与主排仅隔带1)按渲染实况会罩到主排。重排=保守渲染预算:
  - 主排 y=100:[4010](80)/[4011](700)/[4013](1330, 保 540×700)/[4014](2000);
  - 三真源独占带2 y=1010:[4030](700)/[4031](915)/[4032](1130), size [200,420];
  - [4100] 说明卡→(2200,1010)。
真源=两 json(工作流内嵌定义 + 蓝图 definitions),改动逐字一致以保
test_blueprint_definition_matches_host_subgraph(canonical 除 id 全等)。

用法:
  python3 qi21_canvas_band2_relayout_1006.py           # 手术(idempotent;术前 /tmp 备份)
  python3 qi21_canvas_band2_relayout_1006.py --check   # 只跑自检(零写入)

自检四关(ask 1006 批B 钦定):
  ① 矩形零重叠(序列化 pos+size 两两不相交,严格口径=契约同款);
  ② 全连线恒向右(origin.x < target.x;id 为负=虚拟边界豁免);
  ③ 带内 x 严格递增(带0 y<400 / 带2 y>=1000);
  ④ last_link_id >= 实存最大 link id。
另:蓝图↔宿主定义 canonical(除 id)全等。
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"
BACKUP_DIR = Path("/tmp/qi21-relayout-backup-1006")
SG_ID_PREFIX = "96937bbe"  # [6] 文本提示词类型优化子图(两文件同 id)

# 钦定目标态(id → (pos, size));size=None=保持不动
TARGET: dict[int, tuple[list[int], list[int] | None]] = {
    4010: ([80, 100], None),        # 底座(不动)
    4011: ([700, 100], None),       # 装配:x850→700(与 4010 渲染宽570 净距50)
    4013: ([1330, 100], [540, 700]),  # AI扩写:x1400→1330,size 保持 540×700
    4014: ([2000, 100], None),      # 最终输出:x2100→2000
    4030: ([700, 1010], [200, 420]),   # 真源带2·系统提示词
    4031: ([915, 1010], [200, 420]),   # 真源带2·色卡
    4032: ([1130, 1010], [200, 420]),  # 真源带2·美术风格底座
    4100: ([2200, 1010], None),     # 说明卡:y860→1010(随带2)
}
# 手术前置态白名单(旧布场 或 已是目标态=idempotent 重跑)
OLD_POS: dict[int, list[int]] = {
    4010: [80, 100], 4011: [850, 100], 4013: [1400, 100], 4014: [2100, 100],
    4030: [700, 860], 4031: [915, 860], 4032: [1130, 860], 4100: [2200, 860],
}


def _sg_of(doc: dict) -> dict:
    hits = [s for s in doc["definitions"]["subgraphs"] if s["id"].startswith(SG_ID_PREFIX)]
    assert len(hits) == 1, f"应恰 1 个装配子图({SG_ID_PREFIX}…),得 {len(hits)}"
    return hits[0]


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _dump(doc: dict, path: Path) -> None:
    # 与库内两 json 现行格式逐字对齐:2空格缩进/UTF-8 原文/尾换行
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def surgery() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    for path in (WF, BP):
        doc = _load(path)
        sg = _sg_of(doc)
        nodes = {n["id"]: n for n in sg["nodes"]}
        assert sorted(nodes) == sorted(TARGET), \
            f"{path.name}: 子图节点集漂移,得 {sorted(nodes)}(钦定 {sorted(TARGET)})"
        for nid, (pos, size) in TARGET.items():
            n = nodes[nid]
            cur = list(n["pos"])
            assert cur == OLD_POS[nid] or cur == pos, \
                f"{path.name} node{nid} pos={cur} 既非已知旧态 {OLD_POS[nid]} 也非目标 {pos}(人工布场?先核再跑)"
            if cur != pos:
                n["pos"] = list(pos)
            if size is not None and list(n["size"]) != size:
                n["size"] = list(size)
        bak = BACKUP_DIR / path.name
        if not bak.exists():
            shutil.copy2(path, bak)
        _dump(doc, path)
        print(f"[surgery] {path.name}: 8 节点 pos/size 已落目标态(备份 {bak})")


def check() -> int:
    fails: list[str] = []
    docs = {}
    for path in (WF, BP):
        doc = _load(path)
        docs[path.name] = doc
        sg = _sg_of(doc)
        nodes = {n["id"]: n for n in sg["nodes"]}

        # 目标态逐字核对
        for nid, (pos, size) in TARGET.items():
            n = nodes[nid]
            if list(n["pos"]) != pos:
                fails.append(f"{path.name} node{nid} pos={n['pos']} != 钦定 {pos}")
            if size is not None and list(n["size"]) != size:
                fails.append(f"{path.name} node{nid} size={n['size']} != 钦定 {size}")

        # ① 矩形零重叠(严格口径=契约 test_no_node_overlap_and_group_budget 同款)
        ids = sorted(nodes)
        for i, a_id in enumerate(ids):
            for b_id in ids[i + 1:]:
                a, b = nodes[a_id], nodes[b_id]
                ax, ay, aw, ah = a["pos"][0], a["pos"][1], a["size"][0], a["size"][1]
                bx, by, bw, bh = b["pos"][0], b["pos"][1], b["size"][0], b["size"][1]
                if ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah:
                    fails.append(f"{path.name} ①重叠 node{a_id}×node{b_id}")

        # ② 全连线恒向右(负 id=虚拟边界豁免)
        links = sg["links"]
        for l in links:
            oid, tid = l["origin_id"], l["target_id"]
            if oid < 0 or tid < 0:
                continue
            ox, tx = nodes[oid]["pos"][0], nodes[tid]["pos"][0]
            if not (ox < tx):
                fails.append(f"{path.name} ②左向线 link{l['id']} {oid}({ox})→{tid}({tx})")

        # ③ 带内 x 严格递增(带0 y<400 / 带2 y>=1000;带1(400-1000)应空)
        bands: dict[int, list[int]] = {}
        for nid, n in nodes.items():
            y = n["pos"][1]
            bands.setdefault(0 if y < 400 else (1 if y < 1000 else 2), []).append(nid)
        if bands.get(1):
            fails.append(f"{path.name} ③带1 非空(渲染净空带):{sorted(bands[1])}")
        for b in (0, 2):
            xs = sorted(nodes[nid]["pos"][0] for nid in bands.get(b, []))
            if not all(x2 > x1 for x1, x2 in zip(xs, xs[1:])):
                fails.append(f"{path.name} ③带{b} x 非严格递增:{xs}")

        # ④ last_link_id >= 实存最大 link id(定义级+顶层;顶层=旧 litegraph
        # 数组形 [id, origin, slot, target, slot, type],定义级=dict 形)
        def _link_id(l):
            return l["id"] if isinstance(l, dict) else l[0]
        for scope, holder in ((f"{path.name}#sg", sg), (path.name, doc)):
            lli = holder.get("last_link_id")
            ids_live = [_link_id(l) for l in holder.get("links", [])]
            if ids_live and (lli is None or lli < max(ids_live)):
                fails.append(f"{scope} ④last_link_id={lli} < 实存最大 {max(ids_live)}")

    # 蓝图↔宿主 canonical(除 id)全等(=契约 test_blueprint_definition_matches_host_subgraph)
    def _canon_no_id(sg: dict) -> str:
        return json.dumps({k: v for k, v in sg.items() if k != "id"},
                          ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    wf_sg, bp_sg = _sg_of(docs[WF.name]), _sg_of(docs[BP.name])
    if _canon_no_id(wf_sg) != _canon_no_id(bp_sg):
        fails.append("蓝图↔宿主子图定义漂移(canonical 除 id 不全等)")

    if fails:
        print("[check] FAIL:")
        for f in fails:
            print("  -", f)
        return 1
    print("[check] PASS:目标态 8 节点/①零重叠/②恒向右/③带内递增+带1空/④last_link_id/蓝图↔宿主全等")
    return 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check())
    surgery()
    sys.exit(check())
