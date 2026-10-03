#!/usr/bin/env python3
# 出处:2026-09-21 战役产物(布局守卫,五关协议常跑);2026-09-22 带日期文件名清整提升为常驻件,幂等可重跑。
# 2026-10-03 清账退役:K2 产线 0923 已退役,Downloads 老 K2 基底期望过时,本守卫恒 [SKIP] 退 0(详见 main)。
"""道劫 t2i 主线工作流布局守卫(09-21 用户令:布局也不许破坏)——已退役,留档。

【1003 清账退役】K2 产线 0923 已退役,本守卫锚定的 Downloads 老 K2 基底
(K2-文生图-道劫-基底-0922-v5-换装正名.json,~/Downloads/mystudio-baselines/
整目录已清)期望过时——K2 基线检查就此退役:不再比对、不再 FAIL,恒 [SKIP]
退 0。后续 t2i 布局守卫以 engines/comfyui/tests 契约测试为准(qi21 新标准,
见 2026-10-03 de7149b)。

退役前机制(留档):以 ~/Downloads/mystudio-baselines/ 的字节级基底备份为参照,
比对仓库文件 K2-文生图-道劫.json 的**布局指纹**(每个节点 type/pos/size/mode、
每个组框 title/id/bounding/color、子图 IO 槽位);内容性改动不触发,坐标/尺寸/
组框漂移=FAIL。--full 模式连内容都不许变(整哈希)。
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2] / "backend/engines/comfyui/workflows"
MAIN = REPO / "1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
BASELINE = Path.home() / "Downloads/mystudio-baselines/K2-文生图-道劫-基底-0922-v5-换装正名.json"
BASELINE_SHA = "e02e8e8d5dd16f7ac666b033261034708c7f1e58cf6d01ba0b5867654697d80f"
#          v5=0922 换装落定([15]→Krea2-Engineer-V1/[10]→HDR-fp32)+两节点点名式正名,即上值
# 基线沿革:v1=0921-1937(用户手调0.2版,556cfffda3d776d9223accb96abfd642a2399b51997f2b4913cee488a3be9f55)
#          v2=0921 晚(手动配置区 7 桩+组20,f8c36b45130f220faad9a1134c08d6c0072841f239c4ad225bf2594d4ad6a9af)
#          v3=0921 深夜(用户画布终态:场景+美学/湿画/鎏金、人物+Afterlight0.2、道具+湿画/鎏金0.2,f581b8ec…408b)
#          v4=0922 01:00(用户美宣实测终态:美宣8件=asianmix0.2+Afterlight0.2+Masterpiece1+金雾0.8+
#              子图新节点159-161;道具撤湿画/projector0.5;即上值)


def layout_fingerprint(wf: dict) -> list[str]:
    """布局指纹行列表:节点坐标/尺寸/模式 + 组框。与内容(widgets/links)无关。"""
    lines: list[str] = []

    def nodes_of(ns: list[dict], scope: str) -> None:
        for n in sorted(ns, key=lambda x: (isinstance(x.get("id"), str), x.get("id"))):
            pos = n.get("pos")
            size = n.get("size")
            lines.append(
                f"{scope}#{n.get('id')} {n.get('type')} pos={pos} size={size} mode={n.get('mode', 0)}"
            )

    def groups_of(gs: list[dict], scope: str) -> None:
        for g in sorted(gs, key=lambda x: str(x.get("id"))):
            lines.append(
                f"{scope}#group{g.get('id')} title={g.get('title')!r} bounding={g.get('bounding')} color={g.get('color')}"
            )

    nodes_of(wf.get("nodes", []), "外")
    groups_of(wf.get("groups", []), "外")
    for sg in (wf.get("definitions", {}) or {}).get("subgraphs", []):
        nodes_of(sg.get("nodes", []), f"子图{sg.get('name')}")
        groups_of(sg.get("groups", []), f"子图{sg.get('name')}")
        io = sg.get("inputNode"), sg.get("outputNode")
        lines.append(f"子图{sg.get('name')}#IO锚 input={io[0]} output={io[1]}")
        for slot in sg.get("inputs", []) + sg.get("outputs", []):
            lines.append(
                f"子图{sg.get('name')}#槽 {slot.get('name')}({slot.get('type')}) pos={slot.get('pos')}"
            )
    return lines


def main() -> int:
    # 1003 清账退役:K2 产线 0923 已退役,本守卫锚定的 Downloads 老 K2 基底期望
    # 过时(~/Downloads/mystudio-baselines/ 整目录已清,回滚保险完成使命)——
    # K2 基线检查就此退役:不再检查基底存在性/哈希、不再比对布局指纹,恒 [SKIP]
    # 退 0。layout_fingerprint 与基线沿革注释留档仅作历史;t2i 布局守卫由
    # engines/comfyui/tests 契约测试接棒(qi21 新标准)。
    print(
        "[SKIP] K2 基线检查已退役:K2 产线 0923 已退役,1003 清账退役此期望"
        f"(老基底 {BASELINE.name})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
