#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ch001 视频段发车门检查(R8)——只读脚本(契约:.trellis/tasks/11-25-ch001-closeout-
regen-thumb-video/design.md §3.7 与 implement.md Task 10 Step 2)。

四道门(退出码 0 = 四门全过;任一门 FAIL 退出码 1 并打印差什么):

  G1 首帧定稿   19 镜媒体引用都是图且文件在盘;workflow-images/chapter-001/_v3-wip
                之下 */_work/* 与 .trellis/tasks/11-16-storyboard-canonical-line/prd.md
                最近 30 分钟无写入(打印两处最新修改时间);必须带
                --first-frames-approved 才算过(表示用户已看过 19 张首帧并点头——
                机器查不了的那一半);另机检「人审门」(1125 用户令「分镜图必须人审,
                所有出视频的入口都拦」):待发车的镜在存盘里的 imageReview 须为已批准、
                「具名角色各只出现一次」已确认、内容指纹与盘上图片字节一致——缺省查
                试发镜,带 --all-shots 查全部 19 镜(批量阶段)。判据是应用侧
                apps/frontend/lib/studio/storyboard-image-review-gate.ts 的只读镜像;
                应用里每个出视频入口都会拦,这里提前如实报告,免得脚本报全过而应用
                点不动。人审只能用户本人在应用工作台「人审」区点,换图后须重新人审。
  G2 三查       打印试发镜(缺省 S08)的台词、时长、首帧路径与缩略图;断言首帧
                宽高比 16:9(读 PNG IHDR,±1% 容差;S08 定稿 2048×1152 恰 16:9)。
                「缩略图」按两条引擎侧同名上传解释并都打印:画布磁贴
                my-shot-<镜id>.jpg 与 H3 首帧上传名 my-shot-h3-<镜id>.jpg,并报
                告两者在引擎输入目录(LoadImage 清单,只读)是否在册。
  G3 引擎与窗口 /system_stats 可达;/queue 的 running 与 pending 都是 0(打印读数)。
                用户那一半:确认接下来这段时间不跑别的(打印提醒,不机检)。
  G4 回收路径   试发镜当前媒体引用是图(会被生成,而不是被「已有视频」跳过);
                项目目录可写(os.access 写位检查,本脚本保持只读、不做探针写)。

用法:
  python3 -I -B ch001_video_gate_1125.py --shot 8 --first-frames-approved
  python3 -I -B ch001_video_gate_1125.py --shot 8 --first-frames-approved --all-shots   (批量阶段:人审门查全部 19 镜)

防呆:引擎访问恒 build_opener(ProxyHandler({})) 且只读(/system_stats、/queue、
  /object_info);本脚本不写任何文件、不改任何状态。缺 --shot 时按契约试发镜
  S08。退出码:0=四门全过;1=任一门 FAIL;2=环境异常(分镜档/项目目录缺失等)。
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import struct
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime

ENGINE_BASE = "http://192.168.0.101:17000"
MA_ROOT = "/Users/zhengbingjin/Project/IP/MA"
CHAPTER_STORE = os.path.join(MA_ROOT, "store", "studio-workflow", "chapters", "chapter-001")
WIP_DIR = os.path.join(MA_ROOT, "workflow-images", "chapter-001", "_v3-wip")
PRD_PATH = "/Users/zhengbingjin/Project/Github/MYStudio/.trellis/tasks/11-16-storyboard-canonical-line/prd.md"
PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4"
ALL_SHOTS = list(range(1, 20))
FRESH_WINDOW_SEC = 30 * 60
ASPECT_TARGET = 16 / 9
ASPECT_TOLERANCE = 0.01  # ±1%(2048×1152 恰中;给 1920×1080 等同比图留余量)
SHA256_HEX = re.compile(r"^[a-f0-9]{64}$")  # 与应用侧 isValidSha256Hex 同款


def fmt_ts(epoch: float) -> str:
    return datetime.fromtimestamp(epoch).strftime("%Y-%m-%d %H:%M:%S")


def glob_store(pattern):
    return [os.path.join(CHAPTER_STORE, name)
            for name in sorted(os.listdir(CHAPTER_STORE))
            if fnmatch.fnmatch(name, pattern) and ".bak" not in name]


def load_storyboard_rows() -> dict:
    rows = {}
    for path in sorted(glob_store("storyboards-*.json")):
        with open(path, "r", encoding="utf-8") as fh:
            for row in json.load(fh)["state"]["storyboards"]:
                rows[row["id"]] = row
    return rows


def media_ref_local_path(shot: dict) -> str:
    path = (shot.get("mediaRef") or {}).get("path") or ""
    if not path.startswith(f"project-file://{PROJECT_ID}/"):
        raise ValueError("mediaRef.path 非本项目路径:%s" % path[:120])
    rel = urllib.parse.unquote(path.replace(f"project-file://{PROJECT_ID}/", "", 1))
    return os.path.join(MA_ROOT, rel)


def png_dims(path: str):
    with open(path, "rb") as fh:
        data = fh.read(64)
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("不是 PNG:%s" % path)
    return (struct.unpack(">I", data[16:20])[0], struct.unpack(">I", data[20:24])[0])


def engine_json(path: str, timeout: int = 30):
    # 引擎恒只读,恒 build_opener(ProxyHandler({})) 绕本机代理
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(ENGINE_BASE + path, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def engine_loadimage_names():
    info = engine_json("/object_info/LoadImage", timeout=60)
    return info["LoadImage"]["input"]["required"]["image"][0]


def safe_id(shot_id: str) -> str:
    # 与 storyboard-overcomfy shotPreviewNameForId 同款:id.replace(/[^A-Za-z0-9._-]+/g,"_")
    return re.sub(r"[^A-Za-z0-9._-]+", "_", shot_id)


def human_review_issue(shot: dict, local: str):
    """分镜图人审门(只读镜像;判据真源=应用侧 storyboard-image-review-gate.ts 的
    storyboardImageReviewIssues + verifyStoryboardImageBytes)。返回 None=放行,否则一句原因。
    自动结论、VLM 结论在应用里永不计为批准,这里同样不认。"""
    review = shot.get("imageReview")
    if not isinstance(review, dict):
        return "待审(没有人审记录)"
    status = review.get("status")
    if status == "rejected":
        reasons = review.get("reasons") or []
        return "已被人工驳回%s" % ((":" + str(reasons[0])) if reasons else "")
    if status != "approved":
        return "未通过人审(状态 %s)" % status
    if not review.get("singleAppearancePassed"):
        return "人审记录缺「具名角色各只出现一次」确认"
    sha = review.get("contentSha256")
    if not isinstance(sha, str) or not SHA256_HEX.match(sha):
        return "人审记录缺少图片内容指纹"
    with open(local, "rb") as fh:
        actual = hashlib.sha256(fh.read()).hexdigest()  # 应用侧 sha256FromBase64Image=文件原始字节的 SHA-256
    if actual != sha:
        return "图片内容与人审批准时不一致(图已被替换)"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="ch001 视频段发车门检查(只读;契约 design.md §3.7)")
    parser.add_argument("--shot", type=int, default=8, help="试发镜序号(缺省 8,契约 S08)")
    parser.add_argument("--first-frames-approved", action="store_true",
                        help="用户已看过 19 张首帧并点头;缺此旗标 G1 恒 FAIL")
    parser.add_argument("--all-shots", action="store_true",
                        help="批量阶段用:人审门按全部 19 镜查(缺省只查试发镜)")
    args = parser.parse_args()
    if not 1 <= args.shot <= 19:
        print("FAIL 环境异常:--shot %d 不在 1..19" % args.shot, file=sys.stderr)
        return 2

    gates = []  # (name, ok, detail_lines)

    # ── G1 首帧定稿 ──
    g1_lines, g1_ok = [], True
    try:
        rows = load_storyboard_rows()
    except Exception as exc:
        print("FAIL 环境异常:读分镜档失败:%s" % exc, file=sys.stderr)
        return 2
    missing = []
    for i in ALL_SHOTS:
        shot = rows.get("sb-chapter-001-%03d" % i)
        mref = (shot or {}).get("mediaRef") or {}
        kind = mref.get("kind")
        try:
            local = media_ref_local_path(shot)
            on_disk = kind == "image" and os.path.isfile(local)
        except ValueError as exc:
            local, on_disk = "?", False
        if not on_disk:
            missing.append("S%02d(kind=%s, %s)" % (i, kind, os.path.basename(str(local))))
    if missing:
        g1_ok = False
        g1_lines.append("✗ %d 镜媒体引用不是图或文件不在盘:%s" % (len(missing), "; ".join(missing)))
    else:
        g1_lines.append("✓ 19/19 镜媒体引用都是图且文件在盘")

    newest_work, newest_prd = None, None
    for root, _dirs, files in os.walk(WIP_DIR):
        for f in files:
            p = os.path.join(root, f)
            if os.sep + "_work" + os.sep in p:
                mt = os.path.getmtime(p)
                if newest_work is None or mt > newest_work:
                    newest_work = mt
    if os.path.isfile(PRD_PATH):
        newest_prd = os.path.getmtime(PRD_PATH)
    now = time.time()
    g1_lines.append("_v3-wip */_work/* 最新修改:%s(%d 分钟前)"
                    % (fmt_ts(newest_work) if newest_work else "(无文件)",
                       int((now - newest_work) / 60) if newest_work else -1))
    g1_lines.append("11-16 任务档 prd.md 最新修改:%s(%d 分钟前)"
                    % (fmt_ts(newest_prd) if newest_prd else "(缺文件)",
                       int((now - newest_prd) / 60) if newest_prd else -1))
    if newest_work is not None and now - newest_work < FRESH_WINDOW_SEC:
        g1_ok = False
        g1_lines.append("✗ _v3-wip 的 _work 最近 30 分钟内有写入(改图可能还没收笔)")
    if newest_prd is None or now - newest_prd < FRESH_WINDOW_SEC:
        g1_ok = False
        g1_lines.append("✗ 11-16 prd.md 缺失或最近 30 分钟内有写入")
    if args.first_frames_approved:
        g1_lines.append("✓ --first-frames-approved 已带(用户对 19 张首帧点头,机器查不了的那一半)")
    else:
        g1_ok = False
        g1_lines.append("✗ 缺 --first-frames-approved:用户还没点头,不算过")

    # 人审门(1125 用户令):应用里每个出视频入口都会拦,这里提前如实报告
    review_scope = ALL_SHOTS if args.all_shots else [args.shot]
    blocked = []
    for i in review_scope:
        row = rows.get("sb-chapter-001-%03d" % i) or {}
        try:
            local = media_ref_local_path(row)
        except ValueError:
            blocked.append("S%02d(取不到图片路径)" % i)
            continue
        issue = human_review_issue(row, local) if os.path.isfile(local) else "图片文件不在盘"
        if issue:
            blocked.append("S%02d(%s)" % (i, issue))
    if blocked:
        g1_ok = False
        g1_lines.append("✗ 人审门未过:%d/%d 镜没有在应用里通过人审——%s"
                        % (len(blocked), len(review_scope), "; ".join(blocked)))
        g1_lines.append("  (请在应用工作台「人审」区逐镜看图通过;人审只能用户本人点,换图后须重新人审)")
    else:
        g1_lines.append("✓ 人审门:%d/%d 镜的 imageReview 已批准、单次出现已确认、指纹与盘上图片一致"
                        % (len(review_scope), len(review_scope)))
    gates.append(("G1 首帧定稿", g1_ok, g1_lines))

    # ── G2 三查 ──
    g2_lines, g2_ok = [], True
    shot = rows.get("sb-chapter-001-%03d" % args.shot)
    if not shot:
        g2_ok = False
        g2_lines.append("✗ 试发镜 S%02d 分镜行不存在" % args.shot)
    else:
        g2_lines.append("台词:%s" % (shot.get("lines") or "(无)"))
        g2_lines.append("时长:目标 %s 秒(durationTarget);H3 目标 %s µs(h3DurationUs)=%s 秒"
                        % (shot.get("durationTarget"), shot.get("h3DurationUs"),
                           (shot.get("h3DurationUs") or 0) / 1e6))
        try:
            local = media_ref_local_path(shot)
            w, h = png_dims(local)
            ratio = w / h
            g2_lines.append("首帧路径:%s(%d×%d,宽高比 %.4f)" % (local, w, h, ratio))
            if abs(ratio - ASPECT_TARGET) / ASPECT_TARGET > ASPECT_TOLERANCE:
                g2_ok = False
                g2_lines.append("✗ 首帧宽高比 %.4f 偏离 16:9(±1%%)超容差" % ratio)
            else:
                g2_lines.append("✓ 首帧宽高比 16:9 达标(±1%%)")
        except Exception as exc:
            g2_ok = False
            g2_lines.append("✗ 首帧读不出来:%s" % exc)
        sid = safe_id(shot.get("id") or "")
        tile_name = "my-shot-%s.jpg" % sid
        h3_name = "my-shot-h3-%s.jpg" % sid
        try:
            names = set(engine_loadimage_names())
            g2_lines.append("缩略图/首帧上传名(引擎输入目录在册状态,只读):")
            g2_lines.append("  画布磁贴 %s:%s" % (tile_name, "在册" if tile_name in names else "不在册"))
            g2_lines.append("  H3 首帧   %s:%s" % (h3_name, "在册" if h3_name in names else "不在册"))
        except Exception as exc:
            g2_lines.append("(引擎清单取不到,缩略图在册状态未核:%s)" % exc)
        g2_lines.append("(人做的那一半:花 10 秒看一眼首帧与台词内容对不对得上)")
    gates.append(("G2 三查", g2_ok, g2_lines))

    # ── G3 引擎与窗口 ──
    g3_lines, g3_ok = [], True
    try:
        stats = engine_json("/system_stats", timeout=15)
        sysinfo = stats.get("system", {})
        g3_lines.append("✓ /system_stats 可达(os=%s,ComfyUI %s)"
                        % (sysinfo.get("os", "?"), sysinfo.get("comfyui_version", "?")))
        q = engine_json("/queue", timeout=15)
        running = len(q.get("queue_running", []) or [])
        pending = len(q.get("queue_pending", []) or [])
        g3_lines.append("/queue:running=%d pending=%d" % (running, pending))
        if running or pending:
            g3_ok = False
            g3_lines.append("✗ 引擎队列非空,发车前必须 0/0")
        else:
            g3_lines.append("✓ 队列 0/0")
        g3_lines.append("(人做的那一半:确认接下来这段时间不跑别的)")
    except Exception as exc:
        g3_ok = False
        g3_lines.append("✗ 引擎不可达:%s" % exc)
    gates.append(("G3 引擎与窗口", g3_ok, g3_lines))

    # ── G4 回收路径 ──
    g4_lines, g4_ok = [], True
    mref = (shot or {}).get("mediaRef") or {}
    if mref.get("kind") == "image":
        g4_lines.append("✓ 试发镜当前媒体引用是图(会被生成,不会被「已有视频」跳过)")
    else:
        g4_ok = False
        g4_lines.append("✗ 试发镜当前媒体引用 kind=%s(不是图,回收路径不明)" % mref.get("kind"))
    writable = os.access(MA_ROOT, os.W_OK)
    try:
        media_dir = os.path.dirname(media_ref_local_path(shot)) if shot else MA_ROOT
    except ValueError:
        media_dir = MA_ROOT
    writable2 = os.access(media_dir, os.W_OK)
    g4_lines.append("项目目录可写检查(os.access 写位):MA 根=%s,媒体目录=%s"
                    % ("可写" if writable else "不可写", "可写" if writable2 else "不可写"))
    if not (writable and writable2):
        g4_ok = False
        g4_lines.append("✗ 项目目录写位不可写,回收会失败")
    gates.append(("G4 回收路径", g4_ok, g4_lines))

    # ── 汇总 ──
    print("ch001 视频段发车门检查(只读;%s;试发镜 S%02d)"
          % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), args.shot))
    all_ok = True
    for name, ok, lines in gates:
        all_ok = all_ok and ok
        print("")
        print("%s %s" % ("PASS" if ok else "FAIL", name))
        for line in lines:
            print("  %s" % line)
    print("")
    if all_ok:
        print("四门全过:可以发车(用户在 App 分镜面板对 S%02d 点「重生成视频(H3)」)。" % args.shot)
        return 0
    print("有门未过:按上面 FAIL 项补齐后再跑;不要带病发车。")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
