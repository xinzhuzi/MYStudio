#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""archive_engine_logs_v2.py — qi21-9xing-livefire v2 轮(7-9 型补拍)引擎侧日志切片归档(只读源)。

v2 轮时间窗(引擎侧日志锚):
- 窗起:image-prompts-20261006.log 行46(2026-10-06 12:12:43,number=14,7 型 App 画布扫场拍入队
  =v1 归档窗(行10-45)之后首笔;v1 窗止 11:37:23)
- 窗止:归档时点文件末行(行81;含行79=2026-10-06 13:36:33 number=0 引擎重启后他会话新投)
- engine.log(控制台镜像):v1 切片止于行97469,本窗=行97470→末行(行97472=上述 12:12:43 入队镜像行;
  窗内含引擎重启横幅,行号脚本内实测定)

产物(logs/ 下):
- engine-side.image-prompts-20261006.lines46-81.slice.log
- engine-side.engine.console.lines97470-end.slice.log
- archive-manifest-v2.md(v1 manifest 不动,另档)
"""
import hashlib
import os

CAMP = os.path.dirname(os.path.abspath(__file__))
ENGINE_LOGS = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/logs"
IP_LOG = f"{ENGINE_LOGS}/image-prompts-20261006.log"
CON_LOG = f"{ENGINE_LOGS}/engine.log"

IP_START, IP_END = 46, 81   # image-prompts 行窗(含端点;81=归档时点末行)
CON_START = 97470            # engine.log 窗起行(=v1 切片末行 97469 的下一行,无缝续切)
CON_ANCHOR_LINE = 97472      # 锚:该行须为 12:12:43 入队镜像行


def read_lines(path):
    """按 \\n 切行(与 grep/sed 行号同语义;不用 splitlines——控制台日志含 \\r 会使行号错位)。"""
    with open(path, "rb") as f:
        data = f.read()
    parts = data.split(b"\n")
    lines = [p + b"\n" for p in parts[:-1]]
    if parts[-1]:
        lines.append(parts[-1])
    return lines


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main():
    ip_lines = read_lines(IP_LOG)
    assert len(ip_lines) == IP_END, f"image-prompts 行数={len(ip_lines)} 预期{IP_END}(源再被追加则窗须重定)"
    assert ip_lines[IP_START - 1].startswith("[MY出图][入队][2026-10-06 12:12:43]".encode("utf-8")), "行46 不是 12:12:43 入队行"
    assert ip_lines[78].startswith("[MY出图][入队][2026-10-06 13:36:33]".encode("utf-8")), "行79 不是 13:36:33 入队行"
    assert ip_lines[IP_END - 1].startswith("[MY出图][全量JSON]".encode("utf-8")), "行81 不是末块全量JSON 行"
    ip_slice = b"".join(ip_lines[IP_START - 1:IP_END])
    ip_out = f"{CAMP}/logs/engine-side.image-prompts-20261006.lines46-81.slice.log"
    with open(ip_out, "wb") as f:
        f.write(ip_slice)

    con_lines = read_lines(CON_LOG)
    con_end = len(con_lines)
    assert b"got prompt" in con_lines[CON_START - 1], f"engine.log 行{CON_START} 不是 got prompt 行"
    assert con_lines[CON_ANCHOR_LINE - 1].startswith("[MY出图][入队][2026-10-06 12:12:43]".encode("utf-8")), \
        f"engine.log 行{CON_ANCHOR_LINE} 不是 12:12:43 入队行"
    con_slice = b"".join(con_lines[CON_START - 1:con_end])
    con_out = f"{CAMP}/logs/engine-side.engine.console.lines97470-end.slice.log"
    with open(con_out, "wb") as f:
        f.write(con_slice)

    # 窗内引擎重启横幅行号(绝对)——manifest 记账用
    def find_after(lines, needle, after):
        hits = [i + 1 for i, l in enumerate(lines) if needle in l and i + 1 > after]
        return hits

    restart_ver = find_after(con_lines, b"ComfyUI version", CON_START)
    restart_srv = find_after(con_lines, b"Starting server", CON_START)
    ip_src_sha = sha256(open(IP_LOG, "rb").read())
    con_src_sha = sha256(open(CON_LOG, "rb").read())

    manifest = f"""# 引擎侧日志归档 manifest · v2(7-9 型补拍窗)— qi21-9xing-livefire(2026-10-06 v2 收账员)

v1 归档窗见 archive-manifest.md(行10-45 / engine.log 行96875-97469,窗止 11:37:23);本档为 v2 轮续切,无缝续接(v1 切片末行 97469,本窗自 97470 起)。

v2 轮窗口(引擎侧收据日志锚):**2026-10-06 12:12:43 → 13:36:33**;
九型产线三发(7/8/9 型)窗口 **12:50:38(型7 排队)→ 13:31:40(型9 终态,runs/type-7/8/9-*.md §2)**。
窗内事件:7-9 型被取代的三发 App 画布扫场拍(12:12/12:19/12:26)→ 扫场/实验其余投递 → **九型产线三发(12:50:38/13:07:50/13:24:32)** → 工作流真源被他会话改(mtime 13:31:02)→ **引擎重启**(~13:33,横幅 engine.log 行{restart_ver[0] if restart_ver else '?'}「ComfyUI version」/行{restart_srv[0] if restart_srv else '?'}「Starting server」;pid 92224@17000 → 32378@17001)→ 重启后他会话新投一发(number=0,13:36:33,已完成)。

| 归档件(本仓 logs/) | 引擎侧源(只读) | 切片 | 字节 | sha256 | 行数 |
|---|---|---|---|---|---|
| engine-side.image-prompts-20261006.lines46-81.slice.log | {IP_LOG}(归档时点全件 sha256={ip_src_sha},{len(ip_lines)} 行) | 行46-81(=窗内全部 12 次入队块,逐笔见下) | {len(ip_slice)} | {sha256(ip_slice)} | {ip_slice.count(chr(10).encode())} |
| engine-side.engine.console.lines97470-end.slice.log | {CON_LOG}(归档时点全件 sha256={con_src_sha},{len(con_lines)} 行) | 行{CON_START}-{con_end}(窗起=v1 切片末行次行;窗止=归档时点末行;含引擎重启横幅) | {len(con_slice)} | {sha256(con_slice)} | {con_slice.count(chr(10).encode())} |

切片法:逐字节按行窗拷贝(`python3 archive_engine_logs_v2.py`,行首锚断言通过后落盘),零改源文件。
复取命令(幂等,行窗以归档时点为准):
- `sed -n '46,81p' <引擎家>/logs/image-prompts-20261006.log > engine-side.image-prompts-20261006.lines46-81.slice.log`
- `sed -n '97470,{con_end}p' <引擎家>/logs/engine.log > engine-side.engine.console.lines97470-end.slice.log`

行窗锚(引擎侧 image-prompts-20261006.log,窗内 12 次入队逐笔):
行46 number=14 4945120e(12:12:43,7 型扫场拍→被取代,.bak 存档)/ 行49 number=15 91ea95a6(12:19:25,8 型扫场拍→被取代)/
行52 number=16 2bb4e36f(12:26:29,9 型扫场拍→被取代)/ 行55 number=17 587301c1(12:27:48,他会话投递)/
行58 number=18 8317cb37(12:33:35,他会话投递;type-10-自由 图件 12:40 落位与之相合,自由不在九型,FACTS §6.3)/
行61 number=19 bc1375a6(12:38:37,他会话投递)/ 行64 number=20 3d9fd517(12:40:27,他会话投递)/
行67 number=21 9ff2981b(12:43:11,他会话投递;runs/exp-pe-sysprompt-transparent/ 实验时窗相合)/
行70 number=22 5b05816c(**12:50:38,型7 分镜剧情图 产线拍**)/ 行73 number=23 fec5c1d6(**13:07:50,型8 表情差分 产线拍**)/
行76 number=24 aae7ec8e(**13:24:32,型9 概念气氛图 产线拍**)/ 行79 number=0 3a451e34(13:36:33,引擎重启后他会话新投;序号归零=重启证据)。
(7/8/9 型产线拍 pid 与收账任务书逐字一致;三发扫场拍 pid 与 runs/type-7/8/9-*.md 头部「本拍取代注记」逐字一致;「他会话投递」四笔+重启后一笔不属九型账,pid 原样列,不作归因推测。)
"""
    with open(f"{CAMP}/logs/archive-manifest-v2.md", "w", encoding="utf-8") as f:
        f.write(manifest)

    print("ip_slice bytes:", len(ip_slice), "sha256:", sha256(ip_slice), "lines:", ip_slice.count(b"\n"))
    print("con_slice bytes:", len(con_slice), "sha256:", sha256(con_slice), "lines:", con_slice.count(b"\n"))
    print("restart banner abs lines: ComfyUI version ->", restart_ver, "Starting server ->", restart_srv)


if __name__ == "__main__":
    main()
