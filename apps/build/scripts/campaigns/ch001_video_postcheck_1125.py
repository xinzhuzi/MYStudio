#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ch001 视频产物规格核对(R8)——只读脚本(契约:.trellis/tasks/11-25-ch001-closeout-
regen-thumb-video/design.md §3.7 与 implement.md Task 10 Step 4/Step 7)。

核对口径:
  - 读分镜行(store/studio-workflow/chapters/chapter-001/storyboards-*.json 非 .bak 分片),
    断言该镜 mediaRef.kind 已变成视频且文件在盘;
  - ffprobe(本机 /opt/homebrew/bin/ffprobe)读三项:
      ① 时长与目标差 ≤0.1 秒——「目标」= 该镜 h3DurationUs/1e6(H3 目标时长,µs)。
        依据:S08 存量 h3DurationUs=7291688µs≈7.292 秒而 durationTarget=7(整秒台词目标),
        H3 出片跟音频走,0.1 秒容差只有对 h3DurationUs 才可能达标;同时打印 durationTarget
        供人眼对照(设计 G2 口径的「时长 7 秒」)。
      ② 分辨率 3840×2220(逐字按契约);
      ③ 有音轨(音频流条数 ≥1,打印条数);
  - --shot N:单镜核对,三项都达标退出码 0,否则 1;
  - --all:19 镜逐镜读数,末行「19/19 通过,失败 0」退出码 0;有失败逐行列出,退出码 1。

用法:
  python3 -I -B ch001_video_postcheck_1125.py --shot 8   # 试发(S08)核对(AC11)
  python3 -I -B ch001_video_postcheck_1125.py --all      # 批量后全量核对(AC12)

防呆:只读(读分镜档、读视频文件元数据);引擎零访问;不写任何文件。退出码:
  0=达标;1=有项不达标;2=环境异常(分镜档缺失、ffprobe 不在、媒体引用不是视频等)。
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import shutil
import subprocess
import sys
import urllib.parse

MA_ROOT = "/Users/zhengbingjin/Project/IP/MA"
CHAPTER_STORE = os.path.join(MA_ROOT, "store", "studio-workflow", "chapters", "chapter-001")
PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4"
ALL_SHOTS = list(range(1, 20))
TARGET_SIZE = (3840, 2220)
DURATION_TOLERANCE_SEC = 0.1
DURATION_TOL_EPS = 1e-9  # 浮点比较用;「差 ≤0.1 秒」含等号


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
        raise ValueError("mediaRef.path 非本项目 project-file:// 路径:%s" % path[:120])
    rel = urllib.parse.unquote(path.replace(f"project-file://{PROJECT_ID}/", "", 1))
    return os.path.join(MA_ROOT, rel)


def ffprobe_json(path: str) -> dict:
    ffprobe = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"
    if not ffprobe:
        raise RuntimeError("ffprobe 不在 PATH(/opt/homebrew/bin 也没有)")
    r = subprocess.run(
        [ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        raise RuntimeError("ffprobe 失败(rc=%d):%s" % (r.returncode, r.stderr[-300:]))
    return json.loads(r.stdout)


def check_shot(rows, i: int):
    """返回 (ok, lines)。只读,不抛环境异常——异常按失败行报告。"""
    lines = []
    sid = "sb-chapter-001-%03d" % i
    shot = rows.get(sid)
    if not shot:
        return False, ["S%02d 分镜行不存在" % i]
    mref = shot.get("mediaRef") or {}
    kind = mref.get("kind")
    target_sec = (shot.get("h3DurationUs") or 0) / 1e6
    duration_target = shot.get("durationTarget")
    if kind != "video":
        return False, ["S%02d ✗ 媒体引用 kind=%s(未变视频)" % (i, kind)]
    try:
        local = media_ref_local_path(shot)
    except ValueError as exc:
        return False, ["S%02d ✗ %s" % (i, exc)]
    if not os.path.isfile(local):
        return False, ["S%02d ✗ 视频文件不在盘:%s" % (i, local)]
    try:
        probe = ffprobe_json(local)
    except Exception as exc:
        return False, ["S%02d ✗ %s" % (i, exc)]
    fmt = probe.get("format", {})
    streams = probe.get("streams", [])
    vstreams = [s for s in streams if s.get("codec_type") == "video"]
    astreams = [s for s in streams if s.get("codec_type") == "audio"]
    try:
        duration = float(fmt.get("duration"))
    except (TypeError, ValueError):
        duration = None
    width = vstreams[0].get("width") if vstreams else None
    height = vstreams[0].get("height") if vstreams else None
    lines.append("S%02d 媒体引用=视频(%d 字节)%s"
                 % (i, os.path.getsize(local), os.path.basename(local)))

    ok = True
    if duration is None:
        ok = False
        lines.append("     ✗ 时长读不出(format.duration 缺失)")
    else:
        diff = duration - target_sec
        lines.append("     时长 %.3f 秒(目标 %.3f=h3DurationUs/1e6,差 %+.3f 秒;"
                     "durationTarget=%s 秒)"
                     % (duration, target_sec, diff, duration_target))
        if abs(diff) > DURATION_TOLERANCE_SEC + DURATION_TOL_EPS:
            ok = False
            lines.append("     ✗ 时长差 %.3f 秒 > 0.1 秒容差" % abs(diff))
    if (width, height) == TARGET_SIZE:
        lines.append("     分辨率 %dx%d ✓" % (width, height))
    else:
        ok = False
        lines.append("     ✗ 分辨率 %sx%s != 3840×2220" % (width, height))
    if len(astreams) >= 1:
        lines.append("     音轨 %d 条 ✓" % len(astreams))
    else:
        ok = False
        lines.append("     ✗ 无音轨")
    return ok, lines


def main() -> int:
    parser = argparse.ArgumentParser(description="ch001 视频产物规格核对(只读;契约 design.md §3.7)")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--shot", type=int, help="单镜核对(如 --shot 8)")
    mode.add_argument("--all", action="store_true", help="19 镜全量核对")
    args = parser.parse_args()
    if args.shot is not None and not 1 <= args.shot <= 19:
        print("环境异常:--shot %d 不在 1..19" % args.shot, file=sys.stderr)
        return 2
    try:
        rows = load_storyboard_rows()
    except Exception as exc:
        print("环境异常:读分镜档失败:%s" % exc, file=sys.stderr)
        return 2
    if not shutil.which("ffprobe") and not os.path.exists("/opt/homebrew/bin/ffprobe"):
        print("环境异常:ffprobe 不可用", file=sys.stderr)
        return 2

    if args.shot is not None:
        ok, lines = check_shot(rows, args.shot)
        print("S%02d 产物核对:%s" % (args.shot, "达标" if ok else "不达标"))
        for line in lines:
            print("  %s" % line)
        return 0 if ok else 1

    passed, failed = [], []
    for i in ALL_SHOTS:
        ok, lines = check_shot(rows, i)
        (passed if ok else failed).append(i)
        for line in lines:
            print(line)
    print("")
    print("%d/%d 通过,失败 %d%s"
          % (len(passed), len(ALL_SHOTS), len(failed),
             "(%s)" % ", ".join("S%02d" % i for i in failed) if failed else ""))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
