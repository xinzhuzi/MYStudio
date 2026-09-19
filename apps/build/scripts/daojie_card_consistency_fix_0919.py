#!/usr/bin/env python3
"""道劫 T2I [66] 速查卡口径一致性修复 09-19(深度审查两条 medium + 一处同构)。

对象:apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json

审查问题与修法(纪律行=用户 09-19 明示裁定文本,一律不动):
  M1 卡上半段 [46] 行仍写「默认旁路」,与节点 mode=0 及纪律行「质感双件常开」
     相反 → 改常开口径;
  M2 [76] 题挂「画风·」且激活,但纪律行画风件枚举(68/69/70/73/77)不含 76,
     按卡分类=73+76 两枚画风件同开违反「一次一枚」;卡 09-18 段 [76] 行强度
     ×1.0 失真(widget=0.4)→ 节点题前缀改「面孔·」(依据=库内一贯说明「古风
     亚洲面孔」),卡行改 ×0.4 并注明常开不占画风件名额;修后激活画风件仅 73;
  同构(未点名,顺手修):卡 09-18 段 [78] 行仍挂「画风·」+「水墨慎用」,与
     节点新题「质感·电影感」+纪律行「质感双件」同类打架 → 前缀与口径同步。

修后账:常开=46+78(质感双件)+76(面孔);功能件 47+67+81 满编;画风件
(68/69/70/73/77)一次一枚、激活中仅 73 —— 7 件激活全有归属,强度数字全对上。
幂等:锚不在场即拒绝;自检:账目逐项断言 + json.load + lint(不跑 pytest)。
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

WF = pathlib.Path(__file__).resolve().parents[2] / "backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
LINT = pathlib.Path(__file__).resolve().parent / "workflow_graph_lint.py"

# (旧锚, 新文, 说明)——每个锚必须恰命中一次
REPLACES = [
    # M1:上半段 [46] 行 默认旁路 → 常开(09-19 裁定)
    ("- [46] 光影Afterlight ×0.8 默认旁路(摄影向;水墨/画意防污染,要光影再开)",
     "- [46] 光影Afterlight ×0.8 常开(质感双件之一;09-19 用户裁定,摄影向暖金逆光)"),
    # M2:09-18 段 [76] 行 画风·×1.0 → 面孔·×0.4 常开口径
    ("- [76] 画风·AsianMix v4 TQD | Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors | ×1.0 | 古风亚洲面孔",
     "- [76] 面孔·AsianMix v4 TQD | Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors | ×0.4 | 古风亚洲面孔(常开;面孔件,不占画风件一次一枚名额)"),
    # 同构:09-18 段 [78] 行 画风·/水墨慎用 → 质感·/常开口径
    ("- [78] 画风·电影感CinematicShot | Krea2-画风/Krea2-电影感CinematicShot_K2.safetensors | ×1.0 | 电影感(摄影逻辑,道劫水墨慎用)",
     "- [78] 质感·电影感CinematicShot | Krea2-画风/Krea2-电影感CinematicShot_K2.safetensors | ×1.0 | 电影感(质感双件之一;09-19 用户裁定常开)"),
]
NODE_TITLE_76 = ("[76] 画风·AsianMix ×0.4", "[76] 面孔·AsianMix ×0.4")


def die(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(2)


def main() -> int:
    doc = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in doc["nodes"]}
    card = nodes[66]["widgets_values"][0]

    # 幂等:已应用(新题+三新行全在场)→ 跳过改动,仅走统一复验
    already = (nodes[76].get("title") == NODE_TITLE_76[1]
               and all(new in card for _, new in REPLACES))
    if not already:
        # ── 前置断言:节点实态与审查描述一致 ─────────────────
        for nid, mode, strength in ((46, 0, 0.8), (73, 0, 0.3), (76, 0, 0.4), (78, 0, 1)):
            n = nodes[nid]
            if n["mode"] != mode or n["widgets_values"][1] != strength:
                die(f"前置不符:节点 {nid} 实态 {n['mode']}/{n['widgets_values'][1]}")

        # ── M2:节点 [76] 题前缀 画风· → 面孔· ──────────────
        if nodes[76]["title"] != NODE_TITLE_76[0]:
            die(f"前置不符:[76] 题锚不匹配:{nodes[76]['title']!r}")
        nodes[76]["title"] = NODE_TITLE_76[1]

        # ── 卡文三处替换(锚唯一)──────────────────────────
        for old, new in REPLACES:
            if card.count(old) != 1:
                die(f"卡文锚不唯一或缺席({card.count(old)} 次):{old[:40]}…")
            card = card.replace(old, new)
        nodes[66]["widgets_values"][0] = card

        WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    # ── 自检:账目逐项断言(卡 ↔ 节点 ↔ 纪律行)──────────────
    chk = json.loads(WF.read_text(encoding="utf-8"))
    cn = {n["id"]: n for n in chk["nodes"]}
    c = cn[66]["widgets_values"][0]
    assert cn[76]["title"] == "[76] 面孔·AsianMix ×0.4"
    assert "默认旁路(摄影向" not in c and "光影Afterlight ×0.8 常开" in c
    assert "×0.4 | 古风亚洲面孔(常开" in c and "[76] 画风·" not in c
    assert "[78] 质感·电影感" in c and "[78] 画风·" not in c
    # 纪律行(用户明示)未动
    assert "纪律(09-19 修订):质感双件(46光影+78电影感)常开=用户09-19裁定;功能件 47+67+81=3 枚满编;画风件(68/69/70/73/77)仍一次一枚" in c
    # 账目:激活 7 件归属=质感 46/78 + 功能 47/67/81 + 画风 73(一枚)+ 面孔 76
    active = sorted((n for n in chk["nodes"]
                     if n["type"] == "LoraLoaderModelOnly" and n["mode"] == 0),
                    key=lambda n: n["pos"][0])
    active = [n["id"] for n in active]
    assert active == [47, 81, 67, 46, 78, 73, 76], active
    # 强度:卡行数字 ↔ widget 实态逐一对照
    for nid, s in ((46, 0.8), (76, 0.4), (78, 1)):
        assert cn[nid]["widgets_values"][1] == s
    assert "AsianMix_v4_TQD.safetensors | ×0.4" in c and "Afterlight ×0.8" in c

    # ── 自检:lint 复跑(改的是卡文与 title,图结构应仍绿)────
    r = subprocess.run([sys.executable, str(LINT), str(WF)], capture_output=True, text=True)
    print(r.stdout.strip())
    assert r.returncode == 0, "lint 复跑未绿"
    print(f"✓ 修复完成并自校验通过:{WF}")
    print(f"  激活集 {active} = 质感46/78 + 功能47/67/81 + 画风73(一枚) + 面孔76")
    return 0


if __name__ == "__main__":
    sys.exit(main())
