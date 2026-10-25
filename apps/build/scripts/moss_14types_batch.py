#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""moss_14types_batch.py -- MOSS-Image 14 档全类型跑批（moss-win-campaign T6）。

真源链：主体句 14 句=本仓 .trellis/tasks/10-25-moss-win-campaign/implement.md §T6.4
（grill 定稿）；型文/底座/画幅/透明归属=apps/frontend/assets/studio-manuals/
art_skills/daojie_ink_guofeng/json/qi21_bases.json；发车=Windows
E:\\IP\\tools\\moss-1025\\moss_fire_win.py；验收=引擎 venv python + PIL。

拼接口径（implement.md §T6.2 偏离契约声明清单）：主体句 → 型文(剥离中文透明
声明句) → 美术风格底座；自由型仅主体句；负面=发车器默认官方五词；PE 扩写
跳过（明记偏离）；透明路三层判据（transparent-pass/alpha-missing/
pseudo-transparency-artifact），底色四角取样。

用法（Windows）：
  D:\\Python312\\python.exe E:\\IP\\MYStudio\\apps\\build\\scripts\\moss_14types_batch.py
输出：进度行 -> E:\\IP\\tmp\\logs\\moss_14types_batch.log（stdout 亦同）
汇总：E:\\IP\\tools\\moss-1025\\receipts\\14types\\summary_14types.json
"""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"E:\IP\MYStudio")
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
LAUNCHER_DIR = Path(r"E:\IP\tools\moss-1025")
LAUNCHER = LAUNCHER_DIR / "moss_fire_win.py"
VENV_PY = Path(r"E:\IP\漫影工作室\comfyui\venv\Scripts\python.exe")
PY312 = Path(r"D:\Python312\python.exe")
LOG = Path(r"E:\IP\tmp\logs\moss_14types_batch.log")
SUMMARY_DIR = LAUNCHER_DIR / "receipts" / "14types"
# 引擎落盘实况（1025 跑批取证）：filename_prefix "moss/14types" → ComfyUI 以 moss
# 为子目录、14types_ 为文件名前缀 → output/moss/ 平铺 14types_00001_.png
ENGINE_OUT_FLAT = Path(r"E:\IP\漫影工作室\comfyui\output\moss")
STABLE_LOW, STABLE_HIGH = 93.8, 108.3  # s/MP 前役 t2i 8 发稳定带
EXC_LIMIT = 2 * STABLE_HIGH  # 216 s/MP
# 历史未跑尺寸（首发豁免，implement.md §T6.3）
SEEN_SIZES = {(1024, 1280), (1024, 1536), (1680, 1248), (1536, 1024), (1024, 1248)}

# 握剑三锁段(晏燎.json 海报指令真源逐字提取,1025 用户抓人物海报手/武器崩坏后补入:
# 跑批 v1 主体句"手持三尺长剑"抽象持械零硬锁=违反源系统质量硬锁必带进新产物纪律)
SWORD_LOCK = ("右手为五指实握剑柄的稳固握拳，掌心贴直柄，指节清晰可数，手指无张开悬空与错位；"
              "剑首、剑柄、剑格、剑刃至剑尖一线贯通，剑身笔直如铸，通体无一丝弧度；"
              "手臂与衣袖自然避让以保持剑身笔直；剑尖指向屏幕左下方；手腕与手背结构自然。")

# 主体句 grill 定稿+1025 手部崩坏修正（implement.md §T6.4，序号即型档案 types 下标+1）
SUBJECTS = {
    1: ("青年剑修全身立绘，玄青道袍束发戴冠，站姿挺拔，全身完整入画，纯白简洁底色。"
        "他右手垂持一柄笔直长剑：" + SWORD_LOCK),
    2: "云海之上的上古剑冢，万千断剑插满黑色山岩，雾气缭绕，雪后清晨冷色调，人眼平视广角空镜",
    3: "一柄青铜古剑水平居中平放，剑身铭文泛幽蓝灵光，正侧面平视单件器物，纯白简洁底色",
    4: "修仙大战史诗场面，青年剑修御剑冲向天际巨影，金色灵气撕裂乌云，电影级横向构图",
    5: "同一青年剑修设定图，左侧一幅较大头肩特写，右侧正面、正九十度侧面、背面三幅全身像并排等宽等高，服装结构逐项一致，纯白简洁底色",
    6: "青年剑修面部特写，剑眉星目面容坚毅，皮肤质感细腻，柔和正面光，纯白简洁底色",
    7: "雨夜山门前青年剑修单膝跪地，长者伸手扶起，雨水沿屋檐滴落，单格叙事电影感",
    8: ("青年剑修面部九宫格表情差分，三行三列，自左上至右下依次为平静（眉平唇闭）、怒目（眉竖目睁嘴角下压）、"
        "咧笑（眉展眼弯嘴角上扬）、蹙眉（眉心聚拢唇抿）、垂泪（眼睑低垂眼角湿润）、咬牙（唇紧齿咬颊紧）、"
        "惊愕（眉扬目圆唇张）、睥睨（眼睑半掩目光斜上）、失神（目光涣散唇微启），九格取景一致，纯白简洁底色"),
    9: "夜半时分幽暗洞窟深处一盏青灯，孤独寂静情绪，暗部留白，焦点色仅灯火青蓝与暖橙",
    10: "炼气期青年剑修完整角色设定板，主视觉立绘加正侧背三视图，横排五枚圆形色样与来源资料栏，横向排版，纯白简洁底色",
    11: "修仙者洞府室内立体剖面，等距微缩，整石凿成的修炼室，丹炉蒲团灵泉布局清晰",
    12: "青年剑修统一人脸基准底版，剑眉星目面容坚毅（与高清人脸同锚保跨图同脸），光洁的头颅，取景止颈根，严格正面对称，纯白简洁底色",
    13: "青年剑修全身素体定妆底版，零衣物零配饰零鞋履，发型依型文（草绳高束成髻），标准直立站姿，纯白简洁底色",
    14: "一株发光灵草生长在悬浮石台上，夜色，萤光点点",
}
# 内容过滤预案 b 版主体句（仅高危型，implement.md §T6.5）
SUBJECTS_B = {
    8: "青年剑修面部九宫格表情练习图，三行三列，九格取景一致，依次表现安静、严肃、开心、忧愁、认真、坚定、惊讶、高傲、发呆九种神态，每格眉眼嘴角变化清晰，纯白简洁底色",
    12: "青年剑修统一头像基准底版，剑眉星目面容坚毅，光洁的头颅，取景止颈根，严格正面对称，纯白简洁底色",
    13: "青年剑修全身体态定妆基版，未着衣装配饰鞋履，黑色长发束髻依型文，标准直立站姿，纯白简洁底色",
}
FREE_INDEX = 14  # types[13] zh=自由：仅主体句，无型文无底座

_transparent_re = re.compile(r"[^。；\n]*透明[^。；\n]*[。；]?")


def log(msg: str) -> None:
    safe = msg.encode("ascii", "backslashreplace").decode("ascii")
    line = "[%s] %s" % (time.strftime("%H:%M:%S"), safe)
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def parse_ratio(text: str) -> float:
    m = re.search(r"(\d+)\s*:\s*(\d+)", text or "")
    if not m:
        raise ValueError("bad aspect_ratio: %r" % (text,))
    return int(m.group(1)) / int(m.group(2))


def size_for(mp: float, ratio: float) -> tuple[int, int]:
    area = mp * 1024 * 1024
    w = max(16, int(round(math.sqrt(area * ratio) / 16)) * 16)
    h = max(16, int(round(math.sqrt(area / ratio) / 16)) * 16)
    return w, h


def strip_transparent_sentences(text: str) -> tuple[str, list[str]]:
    """剥离型文中的中文透明声明句（契约口径：透明开剔除；本批链路无 alpha）。"""
    kept, stripped = [], []
    for seg in re.split(r"(?<=[。；])", text or ""):
        seg = seg.strip()
        if not seg:
            continue
        if "透明" in seg and ("底图" in seg or "背景" in seg or "通道" in seg):
            stripped.append(seg)
        else:
            kept.append(seg)
    return "".join(kept), stripped


def verify_image(path: Path) -> dict:
    """验收算法与前役 moss_verify_win.py 逐字同口径（numpy 全量 4 邻域拉普拉斯核
    方差 + alpha 全量占比），另补四角底色取样；venv python 含 numpy/PIL。"""
    code = (
        "import json,sys,os;import numpy as np;from PIL import Image;"
        "im=Image.open(sys.argv[1]);w,h=im.size;mode=im.mode;"
        "a=im.convert('RGBA');arr=np.asarray(a,dtype=np.uint8);"
        "alpha_ratio=float((arr[:,:,3]<255).mean());"
        "corners=[tuple(int(x) for x in arr[y,x,:3]) for y,x in ((3,3),(3,w-4),(h-4,3),(h-4,w-4))];"
        "g=np.asarray(im.convert('L'),dtype=np.float64);gp=np.pad(g,1,mode='edge');"
        "lap=(gp[:-2,1:-1]+gp[2:,1:-1]+gp[1:-1,:-2]+gp[1:-1,2:]-4.0*gp[1:-1,1:-1]);"
        "lapvar=float(lap.var());"
        "print(json.dumps({'w':w,'h':h,'mode':mode,'alpha_pct':round(alpha_ratio*100,2),"
        "'corners':corners,'lapvar':round(lapvar,2)}))"
    )
    out = subprocess.run([str(VENV_PY), "-c", code, str(path)],
                         capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        return {"error": (out.stderr or "")[-300:]}
    return json.loads(out.stdout.strip().splitlines()[-1])


def engine_health() -> dict:
    """Step 0 前置：queue 空 + SLG 节点在册（双实例并存时确认活实例健康）。"""
    import urllib.request
    out = {"queue_empty": None, "slg_node": None}
    try:
        with urllib.request.urlopen("http://127.0.0.1:17000/queue", timeout=15) as r:
            q = json.loads(r.read().decode("utf-8"))
        out["queue_empty"] = not (q.get("queue_running") or q.get("queue_pending"))
    except Exception as e:
        out["queue_error"] = str(e)[:150]
    try:
        with urllib.request.urlopen(
                "http://127.0.0.1:17000/object_info/SkipLayerGuidanceDiTSimple", timeout=15) as r:
            out["slg_node"] = bool(json.loads(r.read().decode("utf-8")))
    except Exception as e:
        out["slg_error"] = str(e)[:150]
    return out


def main() -> int:
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    types = bases["types"]
    style_base = (bases.get("art_style_base") or {}).get("positive_text", "")
    assert len(types) == 14, "expect 14 types, got %d" % len(types)
    health = engine_health()
    log("engine health: %s" % json.dumps(health))
    if not health.get("queue_empty") or not health.get("slg_node"):
        log("ABORT: engine not healthy (queue_empty=%s slg=%s) -- resolve dual-instance/node state first"
            % (health.get("queue_empty"), health.get("slg_node")))
        return 2
    summary = []
    log("batch start: 14 types, style_base %d chars" % len(style_base))

    # 启动对拍表
    for i, t in enumerate(types, 1):
        w, h = size_for(float(t.get("megapixels", 1.0)), parse_ratio(t.get("aspect_ratio", "")))
        log("plan %02d %-6s %dx%d rgba=%s" % (i, t.get("zh", "?"), w, h, bool(t.get("rgba_default"))))

    consecutive_exc = 0
    for i, t in enumerate(types, 1):
        zh = t.get("zh", "?")
        w, h = size_for(float(t.get("megapixels", 1.0)), parse_ratio(t.get("aspect_ratio", "")))
        body, stripped = strip_transparent_sentences(t.get("positive_text", "") or "")
        if stripped:
            log("strip %02d: %d sentence(s) removed" % (i, len(stripped)))
        subject = SUBJECTS[i]
        if i == FREE_INDEX:
            prompt = subject
        else:
            parts = [subject, body]
            if style_base:
                parts.append(style_base)
            prompt = "\n".join(p for p in parts if p)

        SUMMARY_DIR.mkdir(parents=True, exist_ok=True)
        pa = SUMMARY_DIR / ("prompt_%02d_a.txt" % i)
        pb = SUMMARY_DIR / ("prompt_%02d_b.txt" % i)
        pa.write_text(prompt, encoding="utf-8")
        if i in SUBJECTS_B:
            if i == FREE_INDEX:
                pb.write_text(SUBJECTS_B[i], encoding="utf-8")
            else:
                pb_body, _ = strip_transparent_sentences(t.get("positive_text", "") or "")
                pb.write_text("\n".join(x for x in [SUBJECTS_B[i], pb_body, style_base] if x), encoding="utf-8")

        seed = int.from_bytes(os.urandom(4), "big") % 2**31
        test_id = "14types-%02d" % i
        new_size = (w, h) not in SEEN_SIZES
        entry = {"id": i, "zh": zh, "w": w, "h": h, "seed": seed, "rgba": bool(t.get("rgba_default")),
                 "stripped": len(stripped), "new_size": new_size}

        for attempt, pf in (("a", pa), ("b", pb)):
            if attempt == "b" and i not in SUBJECTS_B:
                break
            cmd = [str(PY312), str(LAUNCHER), "--workflow", "moss-t2i.json", "--test", test_id,
                   "--prompt-file", str(pf), "--width", str(w), "--height", str(h),
                   "--seed", str(seed), "--lora", "on", "--prefix", "moss/14types"]
            log("fire %02d %s attempt=%s %dx%d seed=%d" % (i, zh, attempt, w, h, seed))
            t0 = time.time()
            r = subprocess.run(cmd, cwd=str(LAUNCHER_DIR), capture_output=True,
                               text=True, timeout=2400)
            wall = time.time() - t0
            entry["wall_s"] = round(wall, 1)
            ok = r.returncode == 0
            if not ok:
                entry["fail_signature"] = ("launcher_exit_%d: " % r.returncode) + (r.stdout or "")[-200:] + (r.stderr or "")[-200:]
                log("fire %02d attempt=%s FAILED exit=%d" % (i, attempt, r.returncode))
                continue

            # 找 receipt（launcher 实名=<test_id>-<prompt_uuid>.json，glob 取最新）
            rcpt = None
            cands = sorted(LAUNCHER_DIR.glob("receipts/%s*.json" % test_id),
                           key=lambda p: p.stat().st_mtime)
            if cands:
                rcpt = cands[-1]
            img_path = None
            if rcpt is not None:
                entry["receipt"] = rcpt.name
                try:
                    rj = json.loads(rcpt.read_text(encoding="utf-8"))
                    # launcher receipt 实名键=files([{filename,bytes},...])；兼容旧假设
                    files = rj.get("files") or rj.get("outputs") or rj.get("images") or []
                    if files and isinstance(files, list):
                        fn = files[0].get("filename") if isinstance(files[0], dict) else files[0]
                        if fn:
                            # 引擎落盘=filename_prefix "moss/14types" → output/moss/ 平铺 14types_*.png
                            img_path = ENGINE_OUT_FLAT / str(fn)
                except Exception as e:
                    entry["receipt_parse_error"] = str(e)[:200]
            # 优先级 2：launcher collect 收集位（最可靠，前役同机制）
            if img_path is None or not img_path.exists():
                launcher_out = LAUNCHER_DIR / "out" / test_id
                cands = sorted(launcher_out.glob("*.png"), key=lambda p: p.stat().st_mtime) if launcher_out.exists() else []
                img_path = cands[-1] if cands else img_path
            # 优先级 3：引擎 output/moss 平铺兜底
            if img_path is None or not img_path.exists():
                cands = sorted(ENGINE_OUT_FLAT.glob("%s_*.png" % test_id), key=lambda p: p.stat().st_mtime) if ENGINE_OUT_FLAT.exists() else []
                img_path = cands[-1] if cands else None

            if img_path is None or not img_path.exists():
                entry["fail_signature"] = "no_output_image"
                log("fire %02d attempt=%s FAILED no image" % (i, attempt))
                continue

            entry["image"] = img_path.name
            entry["bytes"] = img_path.stat().st_size
            v = verify_image(img_path)
            entry["verify"] = v
            if "error" in v:
                log("verify %02d error: %s" % (i, v["error"][:120]))
                entry["status"] = "verify-error"
                break
            mp = (w * h) / (1024 * 1024)
            s_per_mp = wall / mp
            entry["s_per_mp"] = round(s_per_mp, 1)
            exc = s_per_mp > EXC_LIMIT
            entry["time_exc"] = exc
            if exc and not (new_size and attempt == "a"):
                consecutive_exc += 1
            else:
                consecutive_exc = 0
            lap = v.get("lapvar", 0)
            alpha_pct = v.get("alpha_pct", 0.0)
            if entry["rgba"] and alpha_pct > 1.0:
                entry["alpha_state"] = "transparent-pass"
            elif _looks_pseudo(img_path, v):
                entry["alpha_state"] = "pseudo-transparency-artifact"
            else:
                entry["alpha_state"] = "alpha-missing"
                entry["corners"] = v.get("corners")
            if lap < 30:
                entry["low_detail"] = True
            entry["status"] = "pass"
            log("done %02d %s wall=%.0fs %.1f s/MP exc=%s lapvar=%s alpha=%s%% state=%s" % (
                i, zh, wall, s_per_mp, exc, lap, alpha_pct, entry["alpha_state"]))
            break

        entry.setdefault("status", "fail")
        summary.append(entry)
        if consecutive_exc >= 2:
            log("STOP-LINE: 2 consecutive non-exempt time exceptions")
            break
        with open(SUMMARY_DIR / "summary_14types.json", "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=1)

    with open(SUMMARY_DIR / "summary_14types.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    npass = sum(1 for s in summary if s.get("status") == "pass")
    log("batch end: %d/%d pass" % (npass, len(summary)))
    return 0


def _looks_pseudo(img_path: Path, v: dict) -> bool:
    """伪透明 spot-check（启发式，如实记录供目检复核）：alpha≈0 且四角同色且
    lapvar 显著偏高（棋盘格/灰阶伪透明纹嫌疑）。"""
    try:
        corners = v.get("corners", [])
        same = len({tuple(c) for c in corners}) <= 2
        return bool(same and v.get("lapvar", 0) > 400)
    except Exception:
        return False


if __name__ == "__main__":
    sys.exit(main())
