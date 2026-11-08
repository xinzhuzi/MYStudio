#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21-道劫-i2i.json 布局优化落盘手术(10-21 用户令「优化其布局,美化节点布局」).

只动布局面(node pos / 组框 bounding),拓扑/连线/widget/提示词零触碰:
  1. 拓扑指纹断言:剥 pos/size 序列化面外全等(节点序/links/widgets/标题);
  2. 左向线断言:全 scope 恒 0(契约 test_horizontal_layout 硬门);
  3. 子图蓝图镜像:[6]/加速/超分 三蓝图随宿主坐标同刷(保蓝图自身 id/state);
  4. 组框重算:按原组框成员(中心点在盒内)以 ⑤ 公式重罩;
  5. fail-closed:任一断言红即退出零落盘;备份落 apps/output/bak/i2i-layout-1021/。

用法: python3 apps/build/scripts/qi21_i2i_layout_polish_1021.py [--src /tmp/i2i_optimized.json]
"""
import copy
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF_REL = "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
BP_REL = {
    "[6] 文本提示词类型优化子图": "apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json",
    "道劫·加速子图": "apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-加速子图-i2i.json",
    "道劫·超分·SeedVR2": "apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-超分-SeedVR2.json",
}
CHECKER = REPO / ".zcode/skills/node-graph/tools/layout_check.py"
BAK = REPO / "apps/output/bak/i2i-layout-1021"

sys.path.insert(0, str(REPO / ".zcode/skills/node-graph/tools"))
from workflow_layout import est_size  # noqa: E402


def _fingerprint(wf: dict) -> str:
    """剥布局面(pos/size/组框/子图 IO pos)后的 canonical 序列化。"""
    w = copy.deepcopy(wf)
    for n in w.get("nodes", []):
        n.pop("pos", None)
        n.pop("size", None)
    w.pop("groups", None)
    for sg in (w.get("definitions", {}).get("subgraphs") or []):
        for n in sg.get("nodes", []):
            n.pop("pos", None)
            n.pop("size", None)
        sg.pop("groups", None)
        for io in (sg.get("inputs") or []) + (sg.get("outputs") or []):
            io.pop("pos", None)
    return json.dumps(w, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _center(n: dict):
    p = n["pos"]
    w, h = est_size(n)
    return p[0] + w / 2, p[1] + h / 2


def _regroup(wf_src: dict, wf_dst: dict) -> None:
    """按原组框成员重算 bounding(⑤ 公式:minX-30,minY-50,+60,+80;est 盒罩全)。"""
    def regroup(nodes_src, nodes_dst, groups_src):
        out = []
        dst_by_id = {n["id"]: n for n in nodes_dst}
        for g in (groups_src or []):
            bx = g["bounding"]
            members = [dst_by_id[n["id"]] for n in nodes_src
                       if n["id"] in dst_by_id
                       and bx[0] <= _center(n)[0] <= bx[0] + bx[2]
                       and bx[1] <= _center(n)[1] <= bx[1] + bx[3]]
            if not members:
                out.append(g)
                continue
            xs0 = [m["pos"][0] for m in members]
            rights = [m["pos"][0] + est_size(m)[0] for m in members]
            ys0 = [m["pos"][1] for m in members]
            bots = [m["pos"][1] + est_size(m)[1] for m in members]
            x0, y0 = min(xs0), min(ys0)
            x1, y1 = max(rights), max(bots)
            ng = dict(g)
            ng["bounding"] = [x0 - 30, y0 - 50, (x1 - x0) + 60, (y1 - y0) + 80]
            out.append(ng)
        return out

    wf_dst["groups"] = regroup(wf_src["nodes"], wf_dst["nodes"], wf_src.get("groups"))
    src_sgs = {sg["name"]: sg for sg in wf_src["definitions"]["subgraphs"]}
    for sg in wf_dst["definitions"]["subgraphs"]:
        s = src_sgs[sg["name"]]
        sg["groups"] = regroup(s["nodes"], sg["nodes"], s.get("groups"))


def main() -> int:
    src_path = Path("/tmp/i2i_final_candidate.json")
    if "--src" in sys.argv:
        src_path = Path(sys.argv[sys.argv.index("--src") + 1])
    wf_path = REPO / WF_REL
    src = json.loads(src_path.read_text(encoding="utf-8"))
    dst = json.loads(wf_path.read_text(encoding="utf-8"))

    # ── 断言1:拓扑指纹全等 ──
    fp_src, fp_dst = _fingerprint(src), _fingerprint(dst)
    assert fp_src == fp_dst, "拓扑指纹漂移:优化件与本件在 pos/size 外不一致,拒绝落盘"

    # ── 应用坐标(主图+子图节点,保留1位小数) ──
    src_nodes = {n["id"]: n for n in src["nodes"]}
    for n in dst["nodes"]:
        n["pos"] = [round(v, 1) for v in src_nodes[n["id"]]["pos"]]
        if "size" in src_nodes[n["id"]]:
            n["size"] = src_nodes[n["id"]]["size"]
    src_sgs = {sg["name"]: sg for sg in src["definitions"]["subgraphs"]}
    for sg in dst["definitions"]["subgraphs"]:
        s = src_sgs[sg["name"]]
        s_nodes = {n["id"]: n for n in s["nodes"]}
        for n in sg["nodes"]:
            n["pos"] = [round(v, 1) for v in s_nodes[n["id"]]["pos"]]
            if "size" in s_nodes[n["id"]]:
                n["size"] = s_nodes[n["id"]]["size"]
        # 子图 IO pos 随候选(③ 双侧钉轨:输入左列/输出右列)
        for key in ("inputs", "outputs"):
            for io_d, io_s in zip(sg.get(key) or [], s.get(key) or []):
                if io_s.get("pos"):
                    io_d["pos"] = [round(v, 1) for v in io_s["pos"]]

    # ── 组框重算(成员归属按 repo 原坐标判) ──
    wf_repo_pre = json.loads(wf_path.read_text(encoding="utf-8"))
    _regroup(wf_repo_pre, dst)

    # ── 断言2:左向线恒 0 + 落盘前权威复核 ──
    tmp = Path("/tmp/i2i_layout_candidate.json")
    tmp.write_text(json.dumps(dst, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    r = subprocess.run([sys.executable, str(CHECKER), str(tmp)],
                       capture_output=True, text=True, cwd=str(REPO))
    bad = []
    for line in r.stdout.splitlines():
        if line.startswith("[") and ("leftward" in line or "negative_region" in line):
            bad.append(line)
    assert not bad, "左向线/负区违例:\n" + "\n".join(bad)
    print("权威 layout_check(候选件):")
    for line in r.stdout.splitlines():
        if line.startswith("[") or line.startswith("LAYOUT"):
            print("  " + line)

    # ── 蓝图镜像(保蓝图自身 id/state/其余随宿主) ──
    BAK.mkdir(parents=True, exist_ok=True)
    stamp = {"wf": wf_path, "bps": []}
    for sg in dst["definitions"]["subgraphs"]:
        bp_rel = BP_REL.get(sg["name"])
        if not bp_rel:
            continue
        bp_path = REPO / bp_rel
        bp = json.loads(bp_path.read_text(encoding="utf-8"))
        bp_sg = next(s for s in bp["definitions"]["subgraphs"] if s["name"] == sg["name"])
        keep = {k: bp_sg[k] for k in ("id", "state") if k in bp_sg}
        shutil.copy2(bp_path, BAK / bp_path.name)
        idx = bp["definitions"]["subgraphs"].index(bp_sg)
        bp["definitions"]["subgraphs"][idx] = {**sg, **keep}
        bp_path.write_text(json.dumps(bp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        stamp["bps"].append(bp_path)
        print(f"蓝图镜像: {bp_rel}")

    shutil.copy2(wf_path, BAK / wf_path.name)
    wf_path.write_text(json.dumps(dst, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"落盘: {WF_REL}")
    print(f"备份: {BAK}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
