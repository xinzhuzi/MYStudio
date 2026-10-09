#!/usr/bin/env python3
"""civitai 多连接分段下载器(09-19,装机流水线下载提速件)。

背景:单连接经代理/直连均被压在 ~110-210KB/s,单次 15 分钟装不下三件 217MB 级
LoRA;实测 6 连接 Range 并行聚合 ~380-400KB/s(CDN 按 IP 聚合限速,代理直连同效)。
用法:
    python3 civitai_parallel_dl_0919.py <versionId> <dest 绝对路径> [连接数=6]
特性:
- Range 分段并行 + 段级重试(段文件字节数精确校验后才拼接);
- 复用既有 .part 前缀(串行尝试已拉到的字节不浪费);
- 直连优先、失败段自动换本机代理重试;
- 终检:safetensors 头(小端 u64 头长)+ 总字节数,过了才原子落位。
"""
from __future__ import annotations

import os
import re
import struct
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import secrets_loader  # noqa: E402  凭据出库装载器(09-24)

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
# token/代理已出库(09-24):环境变量 CIVITAI_TOKEN/CIVITAI_PROXY 优先,否则读
# 本地 ~/.zcode/mystudio-secrets/civitai_token.json(泄漏旧值须轮换后填入)
TOKEN = secrets_loader.get_civitai_token()
PROXY = secrets_loader.get_proxy()  # 未配置=空串,纯直连


def total_size(ver: str) -> int:
    url = f"https://civitai.com/api/download/models/{ver}?token={TOKEN}"
    p = subprocess.run(["curl", "-sL", "-m", "30", "-A", UA, "-r", "0-0",
                        "-D", "-", "-o", "/dev/null", url],
                       capture_output=True, text=True)
    m = re.search(r"[Cc]ontent-[Rr]ange:\s*bytes\s+0-0/(\d+)", p.stdout)
    if not m:
        raise RuntimeError(f"取总长失败: {p.stdout[-300]} {p.stderr[-200]}")
    return int(m.group(1))


def fetch_segment(ver: str, path: Path, s: int, e: int, tries: int = 6) -> None:
    url = f"https://civitai.com/api/download/models/{ver}?token={TOKEN}"
    want = e - s + 1
    for attempt in range(1, tries + 1):
        via_proxy = attempt % 2 == 0          # 奇数轮直连,偶数轮走代理(未配代理则全程直连)
        cmd = ["curl", "-sL", "-m", "600", "-A", UA, "-r", f"{s}-{e}",
               "-o", str(path)]
        if via_proxy and PROXY:
            cmd[1:1] = ["-x", PROXY]
        subprocess.run(cmd, capture_output=True)
        if path.exists() and path.stat().st_size == want:
            return
        time.sleep(min(2 * attempt, 15))
    raise RuntimeError(f"段 {s}-{e} 重试 {tries} 次仍不完整 "
                       f"(want {want}, got {path.stat().st_size if path.exists() else 0})")


def download(ver: str, dest: Path, threads: int) -> None:
    if dest.exists() and dest.stat().st_size > 150 * 1024 * 1024:
        print(f"SKIP {dest.name} 已存在")
        return
    total = total_size(ver)
    part = dest.with_suffix(".part")
    prefix = part.stat().st_size if part.exists() else 0
    print(f"GET {dest.name} 总 {total}B,前缀复用 {prefix}B,剩余 {total - prefix}B",
          flush=True)
    remain = total - prefix
    if remain <= 0:
        _finalize(part, dest, total)
        return
    step = -(-remain // threads)
    segs = []
    procs = []
    for i in range(threads):
        s = prefix + i * step
        e = min(prefix + (i + 1) * step, total) - 1
        if s > e:
            break
        seg = dest.with_suffix(f".seg{i}")
        if not (seg.exists() and seg.stat().st_size == e - s + 1):
            procs.append((i, s, e))
        segs.append(seg)
    for round_no in range(2):                 # 最多两波,第二波补拉残段
        running = []
        for i, s, e in procs:
            seg = dest.with_suffix(f".seg{i}")
            if seg.exists() and seg.stat().st_size == e - s + 1:
                continue
            url = f"https://civitai.com/api/download/models/{ver}?token={TOKEN}"
            cmd = ["curl", "-sL", "-m", "900", "-A", UA, "-r", f"{s}-{e}",
                   "-o", str(seg), url]
            running.append(subprocess.Popen(cmd, stdout=subprocess.DEVNULL))
        for p in running:
            p.wait()
        if all((dest.with_suffix(f".seg{i}").exists() and
                dest.with_suffix(f".seg{i}").stat().st_size == e - s + 1)
               for i, s, e in procs):
            break
    for i, s, e in procs:                     # 残段串行精修
        fetch_segment(ver, dest.with_suffix(f".seg{i}"), s, e)
    with open(part, "ab") as out:             # 前缀已在前,续写各段
        for seg in segs:
            with open(seg, "rb") as f:
                while True:
                    buf = f.read(1 << 20)
                    if not buf:
                        break
                    out.write(buf)
    for seg in segs:
        seg.unlink(missing_ok=True)
    _finalize(part, dest, total)


def _finalize(part: Path, dest: Path, total: int) -> None:
    size = part.stat().st_size
    with open(part, "rb") as f:
        header_len = struct.unpack("<Q", f.read(8))[0]
    if size != total or not (0 < header_len < 10 * 1024 * 1024):
        raise RuntimeError(f"{dest.name} 终检失败: size={size}/{total} header={header_len}")
    os.replace(part, dest)
    print(f"INSTALLED {dest.name} {size} bytes", flush=True)


if __name__ == "__main__":
    ver, dest = sys.argv[1], Path(sys.argv[2])
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 6
    download(ver, dest, n)
