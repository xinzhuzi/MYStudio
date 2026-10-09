#!/usr/bin/env python3
"""高清人脸透明背景词四臂消融·viggle 档(1009 用户令「加速方式要使用 viggle 加速方式」+
「每次生图改变种子值,不能一个种子值用到死;必须跑 qi21-道劫-t2i.json 工作流本体」)。

四臂各自独立随机种子(点火器缺省=每次 random,禁传 --seed 钉死),只改主体句尾部三处:
  A 原句     = 示例库§6 逐字
  B 去光晕句 = 删「暖金顶光的光晕只落在发际与肩线，面部呈暖赭光影，」
  C 去背景句 = 删「背景一角青灰远山剪影淡入薄雾，」
  D 三处全去 = 再删「全图多色相并陈，暖调中等饱和。」
句子变体全部从示例库原文按子串切除派生(带唯一性断言),零手打。
发车=逐臂调 qi21_t2i_workflow_fire.py(加速档=工作流宿主现值 2·viggle,PE=透传,
透明随型默认开);每臂落 PNG+装配文快照;毕后逐臂量 alpha 并写 summary.json。

用法:python3 qi21_hdface_ablation_viggle_1009.py(种子恒随机,无参)
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
FIRE = REPO / "apps/build/scripts/qi21_t2i_workflow_fire.py"
DOC = REPO / "docs/prompts/道劫_九型主体句示例.md"
OUT = REPO / "apps/output/hdface-ablation-viggle-1009"

HALO = "暖金顶光的光晕只落在发际与肩线，面部呈暖赭光影，"
BG = "背景一角青灰远山剪影淡入薄雾，"
WHOLE = "全图多色相并陈，暖调中等饱和。"


def base_sentence() -> str:
    t = DOC.read_text(encoding="utf-8")
    m = re.search(r"## 6\. 高清人脸.*?```(.*?)```", t, re.S)
    assert m, "示例库§6 缺失"
    s = m.group(1).strip()
    for frag in (HALO, BG, WHOLE):
        assert s.count(frag) == 1, f"锚不唯一:{frag}"
    return s


def variants(s: str) -> dict[str, str]:
    b = s.replace(HALO, "", 1)
    c = s.replace(BG, "", 1)
    d = b.replace(BG, "", 1).replace(WHOLE, "", 1)
    assert d.rstrip().endswith("神情沉静，") or d.rstrip().endswith("神情沉静")
    d = d.rstrip()
    if d.endswith("神情沉静，"):
        d = d[:-1] + "。"
    return {"A原句": s, "B去光晕句": b, "C去背景句": c, "D三处全去": d}


def alpha_stats(p: Path) -> dict:
    import numpy as np
    from PIL import Image
    arr = np.array(Image.open(p).convert("RGBA"))
    a = arr[..., 3]
    H, W = a.shape
    transp, semi, opaq = (a < 10), ((a >= 10) & (a < 250)), (a >= 250)
    r = {"透明率": round(transp.mean(), 3), "半透明率": round(semi.mean(), 3),
         "不透明率": round(opaq.mean(), 3),
         "四角min": [int(x.min()) for x in (a[:32, :32], a[:32, -32:], a[-32:, :32], a[-32:, -32:])]}
    if semi.sum() > 300:
        c = arr[..., :3][semi].mean(axis=0)
        r["半透明均色"] = [round(x) for x in c]
        r["色偏"] = "暖(R>>B)" if c[0] - c[2] > 25 else ("青灰(B>R)" if c[2] - c[0] > 10 else "中性")
    ri, gi, bi = arr[..., 0].astype(int), arr[..., 1].astype(int), arr[..., 2].astype(int)
    warm = (ri - bi > 25) & semi
    ys, xs = np.where(warm)
    r["暖色半透明像素"] = int(len(ys))
    if len(ys):
        r["暖色中心"] = [round(ys.mean() / H, 2), round(xs.mean() / W, 2)]
    return r


def engine_port() -> int:
    manifest = Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json"
    return json.loads(manifest.read_text(encoding="utf-8"))["engine"]["port"]


def queue_note() -> None:
    """尾插队策略:不再等队列全空——POST /prompt 天然排尾,引擎串行执行;
    wrapper 一臂一等,任意时刻我方最多占一个队位,不挤占在途弹。"""
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{engine_port()}/queue", timeout=10) as r:
            q = json.load(r)
        print(f"[gate] 尾插队(running={len(q['queue_running'])} pending={len(q['queue_pending'])})", flush=True)
    except Exception as e:
        print(f"[gate] 队列探询失败(不阻塞发车): {e}", flush=True)


def main() -> None:
    import random
    args = argparse.Namespace()
    OUT.mkdir(parents=True, exist_ok=True)
    queue_note()
    vs = variants(base_sentence())
    results, failed = {}, []
    for arm, subj in vs.items():
        out_png = OUT / f"{arm}.png"
        seed = random.randint(1, 2**31 - 1)
        print(f"[arm {arm}] firing seed={seed}(随机) …", flush=True)
        r = subprocess.run([sys.executable, str(FIRE), "--type", "高清人脸",
                            "--subject", subj, "--seed", str(seed), "--out", str(out_png)],
                           capture_output=True, text=True, timeout=1100)
        print(r.stdout[-500:], flush=True)
        if r.returncode != 0 or not out_png.is_file():
            failed.append({"arm": arm, "rc": r.returncode, "stderr": r.stderr[-400:]})
            continue
        seed_used = None
        for ln in r.stdout.splitlines():
            m = re.search(r"seed=(\d+)", ln)
            if m:
                seed_used = int(m.group(1))
        results[arm] = {"png": str(out_png), "装配文": str(out_png.with_suffix(".装配文.txt")),
                        "seed": seed_used, "alpha": alpha_stats(out_png)}
        (OUT / "summary.json").write_text(
            json.dumps({"seed_rule": "每臂独立随机(用户令:每次生图改变种子值)",
                        "results": results, "failed": failed},
                       ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"arms": {k: {"seed": v["seed"], **v["alpha"]} for k, v in results.items()},
                      "failed": [f["arm"] for f in failed]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
