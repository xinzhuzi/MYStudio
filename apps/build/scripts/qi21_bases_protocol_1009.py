#!/usr/bin/env python3
# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""[4032]→[4013] 单线四段协议·卡文重对(1009;技能纪律:值变必重对)。

两处 [4032] widgets_values 重对:
  apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json(装配子图)
  apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json(t2i工作流)
旧值四槽(风格工艺件/底色背景件/透明承载件/负向词表)逐字节断言后原样保留,
尾追第五值=四段协议文(与 my_qi21_bases_text.py pieces 分支主口同公式逐字);
size 560×620→560×760 同批落刀(第五框 +120px;子图内六节点矩形零重叠已验)。

串级手术(不重序列化整文件,diff 最小化):每处旧串恰 1 次命中断言(零/多命中
abort,铁律);协议文断言两文件均零在场(防重复追加);--check 只验不写。

用法:python3 apps/build/scripts/qi21_bases_protocol_1009.py [--check]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
CARDS = (
    REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
    REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
)

# 与 my_qi21_bases_text.py pieces 分支 output() 同公式(真源字段现值,strip 后四段各占一行)
def build_protocol(asb: dict) -> str:
    st = str(asb.get("positive_style_text") or "").strip()
    gd = str(asb.get("positive_ground_text") or "").strip()
    rg = str(asb.get("rgba_text") or "").strip()
    ng = str(asb.get("negative_text") or "").strip()
    assert st and gd and rg, "真源缺拆分字段——旧库不产协议文,卡文重对无意义"
    return (f"【风格工艺件】{st}\n【底色背景件】{gd}\n"
            f"【透明承载件】{rg}\n【负向词表】{ng}")


def old_values(node: dict) -> list[str]:
    wv = node.get("widgets_values")
    assert isinstance(wv, list) and len(wv) == 4, f"[4032] widgets_values 应恰4项,得 {len(wv) if isinstance(wv, list) else type(wv)}"
    assert all(isinstance(v, str) for v in wv), "[4032] widgets_values 应全字符串"
    return wv


def surgery(raw: str, label: str, proto: str, wv4: list[str], dry: bool) -> str:
    # ── 断言1:旧四值各恰 1 次命中(零/多命中 abort)──
    sers = [json.dumps(v, ensure_ascii=False) for v in wv4]
    for i, ser in enumerate(sers):
        n = raw.count(ser)
        assert n == 1, f"{label} 旧值[{i}] 命中 {n} 次(应恰1)——abort 不写"
    # ── 断言2:四值依序相邻(防串位)──
    p0, p3 = raw.find(sers[0]), raw.find(sers[3])
    assert 0 < p0 < p3, f"{label} 旧值首尾次序异常"
    # ── 断言3:协议文零在场(防重复追加)──
    proto_ser = json.dumps(proto, ensure_ascii=False)
    assert raw.count(proto_ser) == 0 and raw.count("【风格工艺件】") == 0, \
        f"{label} 协议文已在场——重复跑?abort"
    # ── 断言4:size 560×620 恰 1 次(第五框 +120px 同批落刀)──
    import re
    size_pat = re.compile(r'"size":\s*\[\s*560,\s*620\s*\]')
    assert len(size_pat.findall(raw)) == 1, f"{label} size 560×620 命中≠1——abort"
    # ── 手术A:负向值(第4值)后追第五值(继承其缩进)──
    at = raw.find(sers[3]) + len(sers[3])
    tail = raw[at:]
    close = tail.find("]")
    assert close > 0, f"{label} 找不到 widgets_values 收括号"
    indent = tail[:close][tail[:close].rfind("\n"):]
    assert indent.strip() == "", f"{label} 收括号前非纯缩进: {indent!r}"
    new_raw = raw[:at] + "," + indent + proto_ser + tail[close:]
    # ── 手术B:size 落刀 560×620→560×760 ──
    new_raw = size_pat.sub('"size": [\n              560,\n              760\n            ]', new_raw, count=1)
    # ── 终验:重解析合法+新值恰1+五项逐字节──
    d2 = json.loads(new_raw)
    s2 = d2["definitions"]["subgraphs"][0]
    n2 = [x for x in s2["nodes"] if x.get("id") == 4032][0]
    wv5 = n2["widgets_values"]
    assert len(wv5) == 5, f"{label} 写后应恰5项,得 {len(wv5)}"
    for i in range(4):
        assert wv5[i] == wv4[i], f"{label} 写后旧值[{i}] 漂移"
    assert wv5[4] == proto, f"{label} 写后协议文逐字节不符"
    assert new_raw.count(proto_ser) == 1, f"{label} 协议文命中≠1"
    print(f"[{'CHECK' if dry else 'APPLY'}] {label}: 四旧值逐字节✓ + 协议文{len(proto)}字尾追✓ + size 560×760✓")
    return new_raw


def main() -> int:
    dry = "--check" in sys.argv
    asb = json.loads(BASES.read_text(encoding="utf-8"))["art_style_base"]
    proto = build_protocol(asb)
    print(f"协议文 {len(proto)} 字(风格{len(str(asb['positive_style_text']).strip())}"
          f"/底色{len(str(asb['positive_ground_text']).strip())}"
          f"/透明{len(str(asb['rgba_text']).strip())}"
          f"/负向{len(str(asb['negative_text']).strip())})")
    for card in CARDS:
        raw = card.read_text(encoding="utf-8")
        d = json.loads(raw)
        node = [x for x in d["definitions"]["subgraphs"][0]["nodes"] if x.get("id") == 4032][0]
        wv4 = old_values(node)
        # 逐字节断言:卡文旧值=真源对应字段现值(剥壳后 byte==byte)
        assert wv4[0] == str(asb.get("positive_style_text") or ""), f"{card.name} [0]≠真源风格工艺件"
        assert wv4[1] == str(asb.get("positive_ground_text") or ""), f"{card.name} [1]≠真源底色背景件"
        assert wv4[2] == str(asb.get("rgba_text") or ""), f"{card.name} [2]≠真源透明承载件"
        assert wv4[3] == str(asb.get("negative_text") or ""), f"{card.name} [3]≠真源负向词表"
        new_raw = surgery(raw, card.name, proto, wv4, dry)
        if not dry:
            card.write_text(new_raw, encoding="utf-8")
    print("DONE" if not dry else "CHECK-ONLY(未写盘)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
