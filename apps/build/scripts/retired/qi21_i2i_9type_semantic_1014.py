#!/usr/bin/env python3
"""qi21-道劫-i2i 九型语义分型测试(2026-10-14 深夜;首轮扫缺陷修复;1014 T5 guard 下沉)。

首轮缺陷(用户斥「你不知道切换类型吗」):9 型共用一条换袍指令+同一画布=只测了
型底座文本层,没测各型渲染语义(9 张输出长得差不多)。本轮=**每型专属指令**
(直写档 PE 关,指令=型主体句按 i2i 语义适配),逐型发车+机器判据(非黑/透明门)+
云端视觉分型验收(另程)。画幅随输入图=i2i 设计语义,画布恒晏燎元婴正视图。
T5 起:黑屏重试闸下沉发车器(--guard 黑/超时双形态有界重抽),外层两发换种子
循环退役;判据单源=fire.judge_png(img_stat_1014 同式);本扫自留 alpha 终判门。
"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
FIRE = REPO / "apps/build/scripts/qi21_i2i_workflow_fire.py"
OUT = REPO / "apps/output/i2i-fire-1014/sweep9-semantic"

DOC_PATH = REPO / "docs/prompts/道劫_类型主体句示例.md"
# 每型: 引导前缀——人物系指认 <image1> 身份;非人物三型(场景/道具/概念气氛图)
# =「整体替换」引导(1014 定谳:纯空镜/器物句撞人像画布 conditioning=turbo 确定性黑,
# 须显式声明画面整体替换,消指令-画布语义冲突)
TYPES = {
    "人物":     "参照 <image1> 的画幅与构图,重新绘制:",
    "场景":     "将 <image1> 的画面整体替换为如下场景,画面中不得出现人物:",
    "道具":     "将 <image1> 的画面整体替换为如下器物设定图,画面中不得出现人物:",
    "美宣":     "以 <image1> 中的角色为主角重绘美宣:",
    "多视图":   "为 <image1> 中的角色绘制设定图:",
    "高清人脸": "绘制 <image1> 中角色的面容特写:",
    "分镜剧情图": "绘制单格剧情画面:",
    "表情差分": "为 <image1> 中的角色绘制表情差分:",
    "概念气氛图": "将 <image1> 的画面整体替换为如下气氛图:",
}
COMBO = {"多视图": "人物多视图"}
ALPHA_TYPES = {"道具", "多视图", "高清人脸", "表情差分"}


def subject_of(typ):
    import re
    t = DOC_PATH.read_text(encoding="utf-8")
    alias = {"人物多视图": "多视图"}.get(typ, typ)
    m = re.search(rf"## \d+\. [^\n]*?{re.escape(alias)}[^\n]*\n.*?```[a-z]*\n(.*?)\n```", t, re.S)
    return m.group(1).strip() if m else ""


def judge(png):
    """判据单源=fire.judge_png(img_stat_1014.py :19/:23 同式,import 纯模块加载零引擎)。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location("i2i_fire_guarded", str(FIRE))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.judge_png(png)


def engine_up():
    try:
        urllib.request.urlopen("http://127.0.0.1:17001/system_stats", timeout=3)
        return True
    except Exception:
        return False


def ensure_engine():
    """每型前守卫:引擎被并行会话看门狗循环回收时自愈拉起(1014 实弹:扫中途死引擎
    连废六型)。拉起后等 /system_stats 200,上限 ~4 分钟。"""
    for attempt in range(40):
        if engine_up():
            return True
        if attempt == 0:
            ip = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui")
            subprocess.Popen(
                [str(ip / "venv/bin/python"), str(ip / "ComfyUI/main.py"),
                 "--listen", "127.0.0.1", "--port", "17001", "--enable-manager",
                 "--gpu-only", "--reserve-vram", "16", "--use-pytorch-cross-attention",
                 "--input-directory", str(ip / "input"), "--output-directory", str(ip / "output")],
                stdout=open(ip / "logs/engine.log", "ab"), stderr=subprocess.STDOUT,
                start_new_session=True)
        time.sleep(6)
    return False


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    summary = {}
    for typ, lead in TYPES.items():
        if not ensure_engine():
            print(f"[sem] {typ}: FAIL 引擎不可用(拉起超时)", flush=True)
            summary[typ] = "FAIL 引擎不可用"
            continue
        subj = subject_of(typ)
        instr = f"{lead}{subj}" if lead else subj
        d = OUT / typ
        d.mkdir(parents=True, exist_ok=True)
        for stale in d.glob("QI21*.png"):   # 每型发车前清残留(glob 只认当发产物)
            stale.unlink()
        # 黑屏重试闸下沉发车器(--guard 黑/超时双形态有界重抽,重抽 fresh random
        # 禁复用判黑种子),外层两发换种子循环退役;judge 门=guard 后本扫 alpha 终判
        r = subprocess.run(
            [sys.executable, str(FIRE), "--instruction", instr,
             "--type", COMBO.get(typ, typ),
             "--ref1", "yanliao_yuanying_front.png", "--ref2", "yanliao_heti_front.png",
             "--no-pe", "--bypass-upscale", "--guard", "--guard-max", "2",
             "--out", str(d)],
            capture_output=True, text=True, timeout=5400)
        if r.returncode != 0:   # guard 耗尽 exit 1(判黑/超时终局),记 FAIL 不进 glob
            tail = (r.stdout + r.stderr).strip().replace("\n", " | ")[-160:]
            print(f"[sem] {typ}: FAIL guard exit1({tail})", flush=True)
            summary[typ] = "FAIL guard 耗尽(判黑/超时)"
            continue
        imgs = sorted(d.glob("QI21*.png")) if d.exists() else []
        if not imgs:
            print(f"[sem] {typ}: FAIL 无产物", flush=True)
            summary[typ] = "FAIL 无产物"
            continue
        j = judge(imgs[-1])
        nonblack, amin, amax = j["nonblack"], j["amin"], j["amax"]
        alpha_ok = (amax <= 10 or amin <= 10) if typ in ALPHA_TYPES else amin >= 200
        if nonblack >= 0.5 and alpha_ok:
            verdict = (f"PASS 非黑={nonblack:.2f} alpha={amin}-{amax} "
                       f"({'带透' if typ in ALPHA_TYPES else '实体'})")
            print(f"[sem] {typ}: {verdict}", flush=True)
            summary[typ] = verdict
        else:
            verdict = f"BAD 非黑={nonblack:.2f} alpha={amin}-{amax}(guard 过但语义/alpha 终判门未过,入深查清单)"
            print(f"[sem] {typ}: {verdict}", flush=True)
            summary[typ] = verdict
    print(f"[sem] 完成 → {OUT}")
    for typ, v in summary.items():
        print(f"[sem] 总结 {typ}: {v}")


if __name__ == "__main__":
    if "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
        sys.exit(0)
    main()
