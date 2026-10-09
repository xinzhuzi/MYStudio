#!/usr/bin/env python3
"""qi21_apipe_thinking_ab_1007.py — [4013] MyQi21ApiPE 思考档位 A/B 实弹(1007)

用法:
  python3 qi21_apipe_thinking_ab_1007.py off     # 关闭档全链(直调节点 rewrite,生产输入全真)
  python3 qi21_apipe_thinking_ab_1007.py xhigh   # 默认(xhigh)档全链(历史行为对照)
  python3 qi21_apipe_thinking_ab_1007.py raw     # 原始对照:none vs 不发参数(token 级数字)
  python3 qi21_apipe_thinking_ab_1007.py low     # 低档原始探针(reasoning_tokens 实测)

直调仓库源节点(不经引擎——引擎未重启时生产仍跑旧 py,本脚本绕开该限制);
教材/色卡/风格走节点真源热读,型底座取 qi21_bases.json types[0](人物);
Windows 9B 实弹(api_url 只指远程,避免本地兜底混淆档位归因)。
"""
from __future__ import annotations

import io
import json
import sys
import time
import urllib.request
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))  # apps/backend=engines 包根
from engines.comfyui.my_nodes.nodes import my_qi21_api_pe as apipe  # noqa: E402

WIN = "http://192.168.0.101:1234"
MODEL_9B = "qwen3.5-9b-uncensored-hauhaucs-aggressive"
SUBJ = ("一位筑基后期的年轻女修，青玉色道袍束月白腰带，腰侧悬暗红剑穗长剑，"
        "左手轻按剑鞘，目光平视前方，衣袂被山风微微掀起。")


def _bases_type_person() -> tuple[str, str]:
    p = apipe._daojie_data("qi21_bases.json")
    t = json.loads(p.read_text(encoding="utf-8"))["types"][0]
    return str(t.get("positive_text") or ""), str(t.get("negative_text") or "")


def node_arm(effort: str) -> None:
    pos_base, neg_base = _bases_type_person()
    kw = dict(正向提示词=SUBJ, 负向提示词="", 类型句正向=pos_base, 类型句负向=neg_base,
              画幅宽=1216, 画幅高=1664, 透明模式=False,
              api_url=WIN, model=MODEL_9B, timeout_sec=600)
    if effort != "默认(xhigh)":
        kw["thinking_effort"] = effort
    buf = io.StringIO()
    t0 = time.time()
    with redirect_stdout(buf):
        out = apipe.MyQi21ApiPE().rewrite(**kw)
    wall = time.time() - t0
    pos, neg = out["result"][0], out["result"][1]
    colors = apipe._subject_colors(SUBJ, False)
    stages = apipe._subject_stages(SUBJ)
    parts = [p_ for p_ in apipe._PART_TOKENS if p_ in SUBJ]
    anchors = colors + stages + parts
    kept = [a for a in anchors if a in pos.replace(" ", "")]
    print(f"[档位={effort}] 状态={out['ui']['api_pe_status'][0]}")
    print(f"  正向 {len(pos)} 字 / 负向 {len(neg)} 字 / 全链耗时 {wall:.0f}s")
    print(f"  锚点保全 {len(kept)}/{len(anchors)}: {'全保' if len(kept)==len(anchors) else '丢:' + ','.join(a for a in anchors if a not in kept)}")
    print("  节点日志尾:")
    for line in buf.getvalue().strip().splitlines()[-6:]:
        print("    " + line)


def _raw(extra: dict, max_tokens: int = 3000) -> dict:
    payload = {"model": MODEL_9B,
               "messages": [{"role": "user", "content": "用一句话介绍水墨画的留白。"}],
               "max_tokens": max_tokens, "temperature": 0.7}
    payload.update(extra)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(WIN + "/v1/chat/completions",
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.time()
    r = json.loads(opener.open(req, timeout=600).read())
    m = (r.get("choices") or [{}])[0].get("message", {})
    det = (r.get("usage") or {}).get("completion_tokens_details") or {}
    return {"wall": time.time() - t0,
            "reasoning_tok": det.get("reasoning_tokens", 0),
            "content_len": len((m.get("content") or "").strip())}


def raw_arm() -> None:
    for tag, extra in (("不发参数(=xhigh)", {}),
                       ("reasoning_effort=none", {"reasoning_effort": "none"}),
                       ("reasoning_effort=low", {"reasoning_effort": "low"})):
        s = _raw(extra)
        print(f"[{tag:<22}] 耗时 {s['wall']:>5.0f}s | 思考 {s['reasoning_tok']:>5} tok | 正文 {s['content_len']:>4} 字")


def low_arm() -> None:
    s = _raw({"reasoning_effort": "low"})
    print(f"[low 探针] 耗时 {s['wall']:.0f}s | 思考 {s['reasoning_tok']} tok | 正文 {s['content_len']} 字"
          f" → {'简短思考=生效' if 0 < s['reasoning_tok'] < 800 else '未衰减或未思考,档位存疑'}")


if __name__ == "__main__":
    arm = sys.argv[1] if len(sys.argv) > 1 else "off"
    if arm == "off":
        node_arm("关闭")
    elif arm == "xhigh":
        node_arm("默认(xhigh)")
    elif arm == "raw":
        raw_arm()
    elif arm == "low":
        low_arm()
    else:
        print(__doc__)
