# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""数字人两件节点叠压修复(1118 批次③):只移实压节点,不改拓扑/组框。

音频驱动: 119/131/144 存桥latent 与同段 保存 叠 y40~110 → 下移到 2750/2850/2850。
无限时长: 解码音频压噪声 90px(×3)→y1930;存桥latent 压 保存/音轨接力(×3)→y2680。
"""
import json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[3]
D = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/8_数字人"
PLANS = {
 "数字人-音频驱动.json": {119:[520,2750], 131:[2490,2850], 144:[4460,2850]},
 "无限时长-循环拼接.json": {113:[520,1930],117:[520,2560],122:[2490,1700],
                            128:[2490,2680],135:[4460,1700],141:[4460,2680]},
}
def dump(d, ind, nl): return json.dumps(d, ensure_ascii=False, indent=ind) + nl
def read(p):
    raw = p.read_text(encoding="utf-8"); d = json.loads(raw)
    for ind in (1,2,4):
        for nl in ("","\n"):
            if dump(d, ind, nl) == raw: return raw, d, ind, nl
    raise AssertionError(p.name + ": 格式未知")
def main(argv):
    assert len(argv)==2 and argv[1] in ("--check","--apply")
    for name, moves in PLANS.items():
        p = D/name; raw, d, ind, nl = read(p)
        cur = {n["id"]: n["pos"] for n in d["nodes"]}
        done = all(cur[i]==pos for i,pos in moves.items())
        if done: print("done ", name); continue
        if argv[1]=="--check": print("plan ", name); continue
        for n in d["nodes"]:
            if n["id"] in moves: n["pos"] = list(moves[n["id"]])
        p.write_text(dump(d, ind, nl), encoding="utf-8"); print("apply", name)
if __name__ == "__main__": main(sys.argv)
