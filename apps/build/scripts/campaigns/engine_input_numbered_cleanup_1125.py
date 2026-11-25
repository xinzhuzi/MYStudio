#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""引擎输入目录带序号旧副本清理(R6)——一次性运维脚本(契约:design.md §3.6)。

背景:引擎没有「按文件名删输入文件」的接口(证据档 §6),只能走文件级删除。
    这是不可逆操作,清单要先给用户过目(Task 8 Step 2 用户门,脚本不越过它)。

模式:
  --list(缺省)  只读。读引擎 object_info/LoadImage 文件清单,挑出名字匹配
                 ^my-shot-.*\\(\\d+\\)\\.(jpg|jpeg|png)$ 的条目;文件大小从 Windows 侧
                 目录列目录只读取得(ssh Get-ChildItem,引擎 API 不给大小);打印
                 数量 / 总字节 / 按用途(h3 前缀、磁贴)分布 / 前 20 个样例 / 基名文件
                 数量;完整清单写到 apps/output/engine-input-cleanup-1125/numbered-
                 copies.json(UTF-8 带 BOM)。
  --delete --confirm <数量>
                 数量必须等于(当场重取的)清单条数才继续。做法:把清单(UTF-8 带
                 BOM)scp 到 E:/IP/tmp/,在 Windows 上用 PowerShell 按「逐个精确文件
                 名」Remove-Item -LiteralPath,目录固定 E:\\IP\\漫影工作室\\comfyui\\
                 ComfyUI\\input;删完重读引擎清单断言带序号条目为 0、基名文件数量与
                 删前相同;最后删掉两端的临时文件。

防呆(任一不过→中止,退出码 2,一项不删):
  - 引擎队列必须 0/0(/queue 的 running 与 pending 都是 0);
  - 清单里出现不带序号的基名(正则不中)、路径分隔符(/ 或 \\)或「..」→ 中止;
  - --confirm 数量 != 当场重取的清单条数 → 中止;
  - 清单里的名字必须能在 Windows 目录列目录里找到(逐名核对在盘)→ 否则中止;
  - 不接受通配删除:PowerShell 侧逐名 -LiteralPath,无任何通配符路径。

退出码:0=成功;2=防呆不过;1=意外异常。本脚本对引擎恒只读(GET /object_info、
GET /queue),唯一写动作是 --delete 的文件级删除,且必须过上述全部防呆与用户门。
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ENGINE_BASE = "http://192.168.0.101:17000"
WIN_HOST = "zbj@192.168.0.101"
WIN_DIR_PS = "E:\\IP\\漫影工作室\\comfyui\\ComfyUI\\input"   # PowerShell -LiteralPath 用
WIN_TMP_DIR = "E:/IP/tmp"                                    # scp 目标(正斜杠)
OUT_DIR = "/Users/zhengbingjin/Project/Github/MYStudio/apps/output/engine-input-cleanup-1125"
OUT_JSON = os.path.join(OUT_DIR, "numbered-copies.json")
NUMBERED_RE = re.compile(r"^my-shot-.*\(\d+\)\.(jpg|jpeg|png)$")
SAFE_NAME_RE = re.compile(r"^[^/\\]+$")


def numbered_base(name: str) -> str:
    """带序号名 → 基名(连「(N)」前的空格一起去掉,免得对不上真基名)。"""
    return re.sub(r"\s*\(\d+\)(\.(?:jpg|jpeg|png))$", r"\1", name)
PURPOSE_H3_MARK = "-h3-"
SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6"]


class GuardFail(Exception):
    """防呆不过:打印原因,退出码 2,一项不动。"""


def engine_opener():
    # 本机代理一律绕开:Python 恒 build_opener(ProxyHandler({}))
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def engine_json(path: str, timeout: int = 30):
    with engine_opener().open(ENGINE_BASE + path, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def engine_loadimage_names() -> list:
    info = engine_json("/object_info/LoadImage", timeout=60)
    names = info["LoadImage"]["input"]["required"]["image"][0]
    if not isinstance(names, list):
        raise GuardFail("object_info/LoadImage 应答结构变了(image 不是清单)")
    return names


def engine_queue_counts():
    q = engine_json("/queue", timeout=30)
    return len(q.get("queue_running", []) or []), len(q.get("queue_pending", []) or [])


def guard_queue_empty():
    running, pending = engine_queue_counts()
    if running or pending:
        raise GuardFail("引擎队列非空(running=%d pending=%d),有任务在跑时不删" % (running, pending))
    print("防呆:引擎队列 0/0 ✓")


def guard_entry_safety(entries):
    """逐条防呆:带序号正则全匹配、无路径分隔符、无「..」;不接受通配删除。"""
    for name in entries:
        if not NUMBERED_RE.fullmatch(name):
            raise GuardFail("清单出现不带序号/不合规条目:%r" % name)
        if not SAFE_NAME_RE.fullmatch(name):
            raise GuardFail("条目含路径分隔符:%r" % name)
        if ".." in name:
            raise GuardFail("条目含「..」:%r" % name)


def win_ps(script: str, timeout: int = 120) -> str:
    """经 ssh 在 Windows 上跑 PowerShell(EncodedCommand,UTF-16-LE,中文路径无损)。"""
    enc = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    r = subprocess.run(
        ["ssh", *SSH_OPTS, WIN_HOST, "powershell -NoProfile -EncodedCommand " + enc],
        capture_output=True, timeout=timeout,
    )
    if r.returncode != 0:
        raise GuardFail("Windows PowerShell 失败(rc=%d):%s"
                        % (r.returncode, r.stderr.decode("utf-8-sig", "replace")[-400:]))
    return r.stdout.decode("utf-8-sig", "replace")


def win_list_numbered_sizes() -> dict:
    """Windows 侧只读列目录:带序号 my-shot 文件名 → 字节数。"""
    ps = (
        "$ErrorActionPreference='Stop';"
        "$d='E:\\IP\\漫影工作室\\comfyui\\ComfyUI\\input';"
        "Get-ChildItem -LiteralPath $d -File | "
        "Where-Object { $_.Name -match '^my-shot-.*\\(\\d+\\)\\.(jpg|jpeg|png)$' } | "
        "ForEach-Object { Write-Output ($_.Name + \"`t\" + $_.Length) }"
    )
    out = win_ps(ps)
    sizes = {}
    for line in out.splitlines():
        line = line.strip()
        if not line or "\t" not in line:
            continue
        name, _, size = line.rpartition("\t")
        sizes[name] = int(size)
    return sizes


def collect(engine_names=None):
    """取清单(只读)。返回 (numbered_entries, base_count, myshot_total, stats)。"""
    names = engine_names if engine_names is not None else engine_loadimage_names()
    myshot = [n for n in names if n.startswith("my-shot-")]
    numbered = [n for n in myshot if NUMBERED_RE.fullmatch(n)]
    guard_entry_safety(numbered)
    base_files = [n for n in myshot if not NUMBERED_RE.fullmatch(n)]
    base_names = {numbered_base(n) for n in numbered}
    sizes = win_list_numbered_sizes()
    missing = [n for n in numbered if n not in sizes]
    if missing:
        raise GuardFail("清单里 %d 个条目在 Windows 目录里找不到(列目录与引擎清单不一致):%r"
                        % (len(missing), missing[:5]))
    entries = [{"name": n, "bytes": sizes[n],
                "purpose": "h3" if PURPOSE_H3_MARK in n else "tile",
                "base": numbered_base(n)}
               for n in sorted(numbered)]
    return entries, base_files, base_names, myshot


def print_report(entries, base_files, base_names, myshot):
    total = sum(e["bytes"] for e in entries)
    h3 = [e for e in entries if e["purpose"] == "h3"]
    tile = [e for e in entries if e["purpose"] == "tile"]
    print("带序号副本:%d 个,共 %d 字节(%.2f MB)"
          % (len(entries), total, total / (1024 * 1024)))
    print("按用途:h3 前缀 %d 个(%d 字节) / 磁贴 %d 个(%d 字节)"
          % (len(h3), sum(e["bytes"] for e in h3), len(tile), sum(e["bytes"] for e in tile)))
    print("基名文件数量(不带序号的 my-shot 文件,删除后应保留):%d" % len(base_files))
    print("涉及不同基名:%d(其中 %d 个基名当前只有带序号副本、无基名文件)"
          % (len(base_names), len(base_names - set(base_files))))
    print("my-shot 文件总数(引擎清单):%d" % len(myshot))
    print("前 20 个样例:")
    for e in entries[:20]:
        print("  %s(%d 字节,%s)" % (e["name"], e["bytes"], e["purpose"]))


def write_list_json(entries, base_files):
    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + "Z",
        "engine": ENGINE_BASE,
        "engineDir": WIN_DIR_PS,
        "regex": NUMBERED_RE.pattern,
        "count": len(entries),
        "totalBytes": sum(e["bytes"] for e in entries),
        "byPurpose": {
            "h3": {"count": sum(1 for e in entries if e["purpose"] == "h3"),
                   "bytes": sum(e["bytes"] for e in entries if e["purpose"] == "h3")},
            "tile": {"count": sum(1 for e in entries if e["purpose"] == "tile"),
                     "bytes": sum(e["bytes"] for e in entries if e["purpose"] == "tile")},
        },
        "baseNameFilesKept": len(base_files),
        "entries": entries,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    tmp = OUT_JSON + ".tmp-%d" % os.getpid()
    # UTF-8 带 BOM(契约口径;PowerShell Get-Content -Encoding UTF8 亦按 BOM 识别)
    with open(tmp, "w", encoding="utf-8-sig", newline="\n") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, OUT_JSON)
    return payload


def cmd_list() -> int:
    guard_queue_empty()  # 只读前置盘查:队列状态一并打印
    entries, base_files, base_names, myshot = collect()
    print_report(entries, base_files, base_names, myshot)
    payload = write_list_json(entries, base_files)
    print("完整清单已写:%s(%d 条,%d 字节)"
          % (OUT_JSON, payload["count"], payload["totalBytes"]))
    print("只读结束,未改动任何文件。删除须等用户过目清单后另下指令(--delete --confirm <数量>)。")
    return 0


def cmd_delete(confirm: int) -> int:
    guard_queue_empty()
    # 当场重取清单(不信任盘上旧 JSON;--confirm 必须与现状一致)
    entries, base_files, _base_names, _myshot = collect()
    if confirm != len(entries):
        raise GuardFail("--confirm %d != 当场清单条数 %d;数量必须与清单一致才执行" % (confirm, len(entries)))
    guard_entry_safety([e["name"] for e in entries])
    print("删前:带序号 %d 个 / 基名 %d 个" % (len(entries), len(base_files)))

    # 1) 清单(UTF-8 BOM)落 E:/IP/tmp/
    stamp = datetime.now().strftime("%H%M%S")
    remote_name = "engine-input-cleanup-1125-%s.json" % stamp
    local_tmp = os.path.join(OUT_DIR, ".delete-list-%s.json" % stamp)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(local_tmp, "w", encoding="utf-8-sig", newline="\n") as fh:
        json.dump({"dir": WIN_DIR_PS, "names": [e["name"] for e in entries]}, fh,
                  ensure_ascii=False, indent=2)
    scp = subprocess.run(["scp", *SSH_OPTS, local_tmp, "%s:%s/%s" % (WIN_HOST, WIN_TMP_DIR, remote_name)],
                         capture_output=True, timeout=60)
    if scp.returncode != 0:
        raise GuardFail("scp 清单失败(rc=%d):%s" % (scp.returncode, scp.stderr.decode(errors="replace")[-300:]))

    # 2) Windows 侧逐个精确文件名删除(无通配;-LiteralPath)
    ps = (
        "$ErrorActionPreference='Stop';"
        "$payload=Get-Content -LiteralPath 'E:/IP/tmp/%s' -Raw -Encoding UTF8 | ConvertFrom-Json;"
        "$dir='E:\\IP\\漫影工作室\\comfyui\\ComfyUI\\input';"
        "$n=0;"
        "foreach($name in $payload.names){"
        "  if($name -notmatch '^my-shot-.*\\(\\d+\\)\\.(jpg|jpeg|png)$'){ throw ('清单条目不合规: ' + $name) }"
        "  if($name -match '[/\\\\]' -or $name.Contains('..')){ throw ('清单条目含路径符: ' + $name) }"
        "  $p=Join-Path $dir $name;"
        "  Remove-Item -LiteralPath $p -Force;"
        "  $n++"
        "};"
        "Write-Output ('WIN-DELETED ' + $n)"
    ) % remote_name
    out = win_ps(ps, timeout=600)
    deleted = None
    for line in out.splitlines():
        if line.strip().startswith("WIN-DELETED"):
            deleted = int(line.strip().split()[1])
    if deleted != len(entries):
        raise GuardFail("Windows 侧删除计数 %r != 清单 %d" % (deleted, len(entries)))
    print("Windows 侧逐个删除 %d 个" % deleted)

    # 3) 删后复核:引擎清单带序号=0、基名数量不变
    names = engine_loadimage_names()
    myshot2 = [n for n in names if n.startswith("my-shot-")]
    numbered2 = [n for n in myshot2 if NUMBERED_RE.fullmatch(n)]
    base2 = [n for n in myshot2 if not NUMBERED_RE.fullmatch(n)]
    if numbered2:
        raise GuardFail("删后引擎清单仍有带序号条目 %d 个:%r" % (len(numbered2), numbered2[:5]))
    if len(base2) != len(base_files):
        raise GuardFail("删后基名文件数量 %d != 删前 %d" % (len(base2), len(base_files)))
    print("删后:带序号 0 个 / 基名 %d 个" % len(base2))

    # 4) 清理两端临时文件
    win_ps("$ErrorActionPreference='Stop'; Remove-Item -LiteralPath 'E:/IP/tmp/%s' -Force" % remote_name)
    os.remove(local_tmp)
    print("两端临时文件已删(%s 与本地同名件)" % remote_name)
    print("完成:删除带序号副本 %d 个,基名 %d 个原样保留。" % (len(entries), len(base2)))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="引擎输入目录带序号旧副本清理(R6;契约 design.md §3.6)")
    parser.add_argument("--list", dest="mode", action="store_const", const="list",
                        help="只读列清单(缺省行为)")
    parser.add_argument("--delete", dest="mode", action="store_const", const="delete",
                        help="删除(需 --confirm 且数量与清单一致;删除前必须经用户过目清单)")
    parser.add_argument("--confirm", type=int, default=None, help="确认数量(必须等于清单条数)")
    parser.set_defaults(mode="list")
    args = parser.parse_args()
    try:
        if args.mode == "list":
            if args.confirm is not None:
                raise GuardFail("--confirm 只配 --delete 使用")
            return cmd_list()
        if args.confirm is None:
            raise GuardFail("--delete 必须 --confirm <清单里的数量>")
        return cmd_delete(args.confirm)
    except GuardFail as exc:
        print("防呆不过:%s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
