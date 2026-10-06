#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""archive_engine_logs.py — qi21-9xing-livefire 收账:引擎侧日志按本役时间窗切片归档(只读源文件)。

本役时间窗(引擎侧日志锚):
- 窗起:image-prompts-20261006.log 行10(2026-10-06 09:08:07,型1 首拍=缓存回声拍 f3539410 入队)
- 窗止:同文件行43(2026-10-06 11:37:23,型6 wh探针2 d53b7e88 入队)所在块=行43-45,窗收行45(=当日该日志末行,全量JSON 行)
- engine.log(服务端控制台镜像,行内大多无时间戳)按行号窗切片:
  窗起=行96875(=上述 09:08:07 入队行,经 grep -n 定位),窗止=文件末行(文件 mtime 11:37,窗后无写入)

产物(logs/ 下):
- engine-side.image-prompts-20261006.lines10-45.slice.log  ← 收据日志逐字节切片
- engine-side.engine.console.lines96875-end.slice.log      ← 控制台镜像逐字节切片
- archive-manifest.md                                      ← 源/行窗/字节数/sha256/复取命令
"""
import hashlib

CAMP = "/Users/zhengbingjin/Project/Github/MYStudio/apps/build/scripts/campaigns/qi21-9xing-livefire"
ENGINE_LOGS = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs"
IP_LOG = f"{ENGINE_LOGS}/image-prompts-20261006.log"
CON_LOG = f"{ENGINE_LOGS}/engine.log"

IP_RANGE = (10, 45)          # image-prompts 行窗(含端点)
CON_START = 96875            # engine.log 窗起行(09:08:07 入队行)


def read_lines(path):
    """按 \\n 切行(与 grep/sed 行号同语义;不用 splitlines——控制台日志含 \\r 会使行号错位)。"""
    with open(path, "rb") as f:
        data = f.read()
    parts = data.split(b"\n")
    lines = [p + b"\n" for p in parts[:-1]]
    if parts[-1]:
        lines.append(parts[-1])
    return lines


def slice_lines(lines, start, end=None):
    """1-based 闭区间切片;end=None → 至末行。"""
    stop = len(lines) if end is None else end
    return b"".join(lines[start - 1:stop])


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main():
    ip_lines = read_lines(IP_LOG)
    assert len(ip_lines) == 45, f"image-prompts 行数={len(ip_lines)} 预期45(源被追加则窗须重定)"
    assert ip_lines[9].startswith("[MY出图][入队][2026-10-06 09:08:07]".encode("utf-8")), "行10 不是 09:08:07 入队行"
    assert ip_lines[42].startswith("[MY出图][入队][2026-10-06 11:37:23]".encode("utf-8")), "行43 不是 11:37:23 入队行"
    assert ip_lines[44].startswith("[MY出图][全量JSON]".encode("utf-8")), "行45 不是末块全量JSON 行"
    ip_slice = slice_lines(ip_lines, *IP_RANGE)
    ip_out = f"{CAMP}/logs/engine-side.image-prompts-20261006.lines10-45.slice.log"
    with open(ip_out, "wb") as f:
        f.write(ip_slice)

    con_lines = read_lines(CON_LOG)
    assert con_lines[CON_START - 1].startswith("[MY出图][入队][2026-10-06 09:08:07]".encode("utf-8")), \
        f"engine.log 行{CON_START} 不是 09:08:07 入队行"
    con_slice = slice_lines(con_lines, CON_START)
    con_out = f"{CAMP}/logs/engine-side.engine.console.lines96875-end.slice.log"
    with open(con_out, "wb") as f:
        f.write(con_slice)

    ip_src_sha = sha256(open(IP_LOG, "rb").read())
    con_src_sha = sha256(open(CON_LOG, "rb").read())
    manifest = f"""# 引擎侧日志归档 manifest — qi21-9xing-livefire(2026-10-06 收账员)

本役实弹时间窗(引擎侧日志锚):**2026-10-06 09:08:07 → 11:37:23**(型1 首拍缓存回声拍入队 → 型6 wh探针2 入队);
产线拍窗口 09:19:53(型1)→ 11:22:03(型6 终态,runs/type-*.md §2)。

| 归档件(本仓 logs/) | 引擎侧源(只读) | 切片 | 字节 | sha256 | 行数 |
|---|---|---|---|---|---|
| engine-side.image-prompts-20261006.lines10-45.slice.log | {ENGINE_LOGS}/image-prompts-20261006.log(全件 sha256={ip_src_sha},45 行,mtime 2026-10-06 11:37) | 行10-45(=窗内全部 12 次入队块:型1 attempt1 f3539410 + 产线拍 6 发 + wh 探针 5 发;行1-9 为 00:11-00:38 前役三次拍,不在本役窗) | {len(ip_slice)} | {sha256(ip_slice)} | 36 |
| engine-side.engine.console.lines96875-end.slice.log | {ENGINE_LOGS}/engine.log(全件 sha256={con_src_sha},97469 行,mtime 2026-10-06 11:37;控制台镜像大多行无时间戳) | 行96875-97469(窗起行=09:08:07 入队行,窗止=文件末行;文件 mtime=11:37,窗后无写入) | {len(con_slice)} | {sha256(con_slice)} | 595 |

切片法:逐字节按行窗拷贝(`python3 archive_engine_logs.py`,行首锚断言通过后落盘),零改源文件。
复取命令(幂等):
- `sed -n '10,45p' <引擎家>/logs/image-prompts-20261006.log > engine-side.image-prompts-20261006.lines10-45.slice.log`
- `sed -n '96875,$p' <引擎家>/logs/engine.log > engine-side.engine.console.lines96875-end.slice.log`

行窗锚(引擎侧 image-prompts-20261006.log,本役 12 次入队逐笔):
行10 f3539410(09:08:07 型1 attempt1 缓存回声拍)/ 行13 9c4d3719(09:19:53 型1)/ 行16 c1707be8(09:37:35 型2)/
行19 b3a04803(09:58:53 型2 wh探针)/ 行22 fc46aba4(10:08:32 型3)/ 行25 97878877(10:23:41 型3 wh探针)/
行28 ad8280e7(10:31:23 型4)/ 行31 ac5735bc(10:43:40 型4 wh探针)/ 行34 c972ae02(10:56:55 型5)/
行37 a00b747a(11:15:50 型6)/ 行40 d021e881(11:34:28 型6 wh探针1)/ 行43 d53b7e88(11:37:23 型6 wh探针2)。
(序号序列 0,0,0,1,2,3,4,5,6,7,9,10,11,12,13 缺 8=服务端序号器口径,runs/type-5/6 记录 §5/§9 已记,如实。)
"""
    with open(f"{CAMP}/logs/archive-manifest.md", "w") as f:
        f.write(manifest)

    print("ip_slice bytes:", len(ip_slice), "sha256:", sha256(ip_slice))
    print("con_slice bytes:", len(con_slice), "sha256:", sha256(con_slice))
    # 复核:切片行数(image-prompts 切片=36 行;engine.console 切片=595 行)
    print("ip slice lines:", ip_slice.count(b"\n"))
    print("con slice lines:", con_slice.count(b"\n"))


if __name__ == "__main__":
    main()
