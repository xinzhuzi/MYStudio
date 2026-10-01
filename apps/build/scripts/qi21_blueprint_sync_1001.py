#!/usr/bin/env python3
"""蓝图→t2i 宿主实例 幂等同步(2026-10-01,Trellis 10-01-qi21-assembly-blueprint S6)。

背景:Subgraph Blueprint 拖入画布即深拷贝(isolated copies),改蓝图库不会同步
已放置实例——本脚本就是防「改了蓝图画布没变」事故的唯一通道。

用法:
  python3 qi21_blueprint_sync_1001.py            # 同步+断言
  python3 qi21_blueprint_sync_1001.py --check    # 只检查差异,零写入

同步对象:
  源 = my_nodes/subgraphs/qi21-提示词类型优化子图.json 的 definitions.subgraphs[0]
  目标 = qi21-道劫-t2i.json 的 definitions.subgraphs 里同名定义(宿主[40]所引用)

幂等证明:内容一致时零写入退出(exit 0);--check 时仅报差异不落盘。
注意:宿主 widgets_values(用户面板当前值)永不覆盖,只刷子图定义本体。
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
BLUEPRINT = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
ENGINE_DST = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes/subgraphs")
SG_NAME_PREFIX = "[40] 提示词类型优化子图"


def sha(b): return hashlib.sha256(b).hexdigest()[:16]


def canonical(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    bp = json.loads(BLUEPRINT.read_text())
    bp_sg = bp["definitions"]["subgraphs"][0]
    assert bp_sg["name"].startswith(SG_NAME_PREFIX), "蓝图名漂移"

    d = json.loads(WF.read_text())
    hits = [i for i, s in enumerate(d["definitions"]["subgraphs"])
            if s.get("name", "").startswith(SG_NAME_PREFIX)]
    assert len(hits) == 1, f"宿主定义命中{len(hits)}份(预期1),拒绝同步"
    idx = hits[0]
    host_node = next(n for n in d["nodes"] if n["id"] == 40)
    assert host_node["properties"]["subgraph"] == d["definitions"]["subgraphs"][idx]["id"], "宿主引用与定义id不符"

    old_sg = d["definitions"]["subgraphs"][idx]
    if canonical(old_sg) == canonical(bp_sg):
        print(f"[sync] 一致,零写入(幂等)。蓝图sha={sha(canonical(bp_sg).encode())}")
    else:
        diff_nodes = (len(old_sg.get('nodes', [])), len(bp_sg.get('nodes', [])))
        diff_links = (len(old_sg.get('links', [])), len(bp_sg.get('links', [])))
        if a.check:
            print(f"[check] 有差异: 节点{diff_nodes} 连线{diff_links};--check模式不落盘")
            sys.exit(2)
        # 保留工作流侧定义id(宿主引用不动),其余整体以蓝图为准
        bp_sg_with_id = json.loads(json.dumps(bp_sg, ensure_ascii=False))
        bp_sg_with_id["id"] = old_sg["id"]
        d["definitions"]["subgraphs"][idx] = bp_sg_with_id
        WF.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
        print(f"[sync] 已刷新: 节点{diff_nodes} 连线{diff_links} → 蓝图版(定义id保留)")

    # 引擎家同步(幂等)
    if ENGINE_DST.exists():
        dst_file = ENGINE_DST / BLUEPRINT.name
        if not dst_file.exists() or dst_file.read_bytes() != BLUEPRINT.read_bytes():
            if a.check:
                print("[check] 引擎家蓝图落后")
                sys.exit(2)
            dst_file.write_bytes(BLUEPRINT.read_bytes())
            print("[sync] 引擎家蓝图已刷新(重启引擎后 /global_subgraphs 生效)")
        else:
            print("[sync] 引擎家蓝图一致")
    print("done")


if __name__ == "__main__":
    main()
