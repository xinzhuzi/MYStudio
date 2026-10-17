#!/usr/bin/env python3
"""九型语义产物·本机 VL 判定(2026-10-14;zai 视觉额度耗尽后的本地验收链)。
判定器=本机 mlx-vlm Qwen3-VL-8B(127.0.0.1:8080,OpenAI 兼容);判据=每型语义清单。
用法:python3 vl_judge_1014.py → 打印逐型判定+落 sweep9-semantic/vl_verdicts.md"""
import base64
import json
import urllib.request
from pathlib import Path

OUT = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/i2i-fire-1013")
DIRECT = OUT / "semantic_direct"
VL = "http://127.0.0.1:8080/v1/chat/completions"
MODEL = "Qwen/Qwen3-VL-8B-Instruct"

# (目录, 语义验收清单)
CASES = [
    (OUT / "sweep9-semantic/人物", "1)是否单人全身立绘?2)是否工笔线描+淡彩画风?3)是否有金纹长袍元素?4)是否彩色正常成图?"),
    (OUT / "sweep9-semantic/场景", "1)是否空镜场景(山水/祭坛/环境)而无人物?2)是否有工笔画风层次?3)是否彩色正常成图?"),
    (DIRECT / "道具", "1)画面主体是否为单件器物(如剑)居中?2)是否没有人?3)背景是否干净/透明?"),
    (OUT / "sweep9-semantic/美宣", "1)是否美宣海报式构图(角色+戏剧张力)?2)是否彩色正常成图?"),
    (OUT / "sweep9-semantic/多视图", "1)是否同角色的多视图设定图(约四个视图/两行布局)?2)视图间角色是否一致?"),
    (OUT / "sweep9-semantic/高清人脸", "1)是否头肩部面容特写(五官清晰)?2)是否单人?"),
    (DIRECT / "分镜剧情图", "1)是否单格叙事画面(人物+动作/场景叙事)?2)是否彩色正常成图?"),
    (OUT / "sweep9-semantic/表情差分", "1)是否三行三列九宫格表情差分表?2)各格是否同角色不同表情?"),
    (DIRECT / "概念气氛图", "1)是否气氛向概念画面(环境/灵光/古殿等)而非单人立绘?2)是否彩色正常成图?"),
]


def ask(png: Path, rubric: str) -> str:
    b64 = base64.b64encode(png.read_bytes()).decode()
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "image_url",
             "image_url": {"url": f"data:image/png;base64,{b64}"}},
            {"type": "text", "text": f"看图回答验收问题,逐项简答: {rubric}\n最后一行给出总判定:通过 或 不通过"},
        ]}],
        "max_tokens": 600, "temperature": 0.1,
    }).encode()
    req = urllib.request.Request(VL, data=body, headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=300))
    return r["choices"][0]["message"]["content"].strip()


def latest_png(d: Path):
    return sorted(d.glob("QI21*.png"))[-1]


def main():
    lines = ["# 九型语义产物·本机 VL 判定(Qwen3-VL-8B 本地)", ""]
    for d, rubric in CASES:
        typ = d.name
        try:
            png = latest_png(d)
        except StopIteration:
            lines += [f"## {typ}", "无产物", ""]
            print(f"[vl] {typ}: 无产物", flush=True)
            continue
        try:
            ans = ask(png, rubric)
        except Exception as e:
            ans = f"判定器异常: {e}"
        lines += [f"## {typ}", f"图: {png.name}", "", ans, ""]
        print(f"[vl] {typ}: {ans.splitlines()[-1] if ans else '空'}", flush=True)
    out = OUT / "sweep9-semantic/vl_verdicts.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[vl] 报告 → {out}")


if __name__ == "__main__":
    main()
