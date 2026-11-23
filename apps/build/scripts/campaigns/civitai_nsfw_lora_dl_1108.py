#!/usr/bin/env python3
"""civitai_nsfw_lora_dl_1108.py — Arekejoker 姿势包 4 件 NSFW LoRA 下载器(1108)。

先例: apps/build/scripts/campaigns/civitai_parallel_dl_0919.py(ba5cc30 实弹配方)——
Range 分段并行(CDN 按 IP 聚合限速,单连接仅 ~110-210KB/s)+ 段级重试 + 前缀复用 +
safetensors 头终检(小端 u64 头长)。本件相对 0919 的修订(1108 实弹教训):

- 令牌绝不入脚本:从环境变量 CIVITAI_TOKEN 读(运行时由记忆档
  civitai-apikey-0917.md 提取后注入,用途=模型下载);
- 段级追加续传:重试不再 `-o` 截断整段重拉(慢速日 106MB 段在超时窗内拉不完会
  截断-重拉死循环),改为自算剩余子区间 (s+got)-e 追加写;响应先落 .curltmp,
  仅当 206+字节数相符才并入段(代理拥塞回 5xx 错误页会被盲追加污染段)。
  注: curl `-C -` 与 `-r` 组合实测越界追加(2,559,563B>2,097,152B),不可用;
- 段文件名内嵌区间戳 .seg.<start>-<end>.part:并发数或前缀变化→段界变化→
  旧段不会被误当同区间续传(1108 实弹事故:6→4 线程复用旧段名,seg1 起整体
  错位,尺寸全对 sha 全炸,终检拦截;首差异字节恰为新段界 20985970);
- 直连优先、7897 代理奇偶轮换兜底(1108 实测:直连单连接 335KB/s,代理同刻仅
  ~24KB/s 且被并发连接吃满;0919 时代两者同效,今日不同,故反转主次);
- 幂等可重跑:目标已存在且 sha256 对上 API 元数据(hashes.SHA256,大写键;
  files[].sha256 小写键恒为 null——0919 时代未留意,1108 实测定谳)即跳过;
  manifest.json 写前重读合并,支持多进程按名称过滤子串并发分头下载不同件
  (不同件 seg 文件名不同,零冲突);
- thesealpacas 上游真名 `NSFW Qwen by TheseAlpacas V2.safetensors`,按 vendored
  qwen21-nsfw-pose-skill/install/setup.md §LoRA 表「文件名需与表格一致」约定,
  装机侧改名 `thesealpacas-nsfw-v2.safetensors`;
- 目标清单内嵌 versionId/size/sha256(Civitai 公开元数据,2026-11-08 经
  /api/v1/model-versions/<id> 带 token+7897+浏览器 UA 实取,存档
  .zcode/tmp/nsfw-lora-1108/meta/plan.json)。

用法:
    CIVITAI_TOKEN=<key> python3 civitai_nsfw_lora_dl_1108.py [下载目录] [名称过滤子串]
    # 下载目录缺省 = <repo>/.zcode/tmp/nsfw-lora-1108/;过滤子串匹配装机名(如
    # thesealpacas / posture / L22-31 / v1.3-fine),供多进程并发分头下载。
环境: CIVITAI_DL_THREADS 覆盖每件分段并发数(缺省 6)。
产出: 目录内 4 个 .safetensors + manifest.json(含逐件 sha256 比对结果,不含令牌)。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
PROXY = "http://127.0.0.1:7897"
THREADS = int(os.environ.get("CIVITAI_DL_THREADS", "6"))
SEG_TIMEOUT = 600          # 单段单次 curl 上限(秒);超时即续传下一轮,不丢已得字节
SEG_TRIES = 10             # 段级追加续传尝试上限

# (装机名, versionId, 上游文件名, 期望字节数, Civitai hashes.SHA256)
PLAN = [
    ("qwen2_1-femaledVaginus-nsfw-v1_3-fine_L22-31.safetensors", 3388157,
     "qwen2_1-femaledVaginus-nsfw-v1_3-fine_L22-31.safetensors",
     637587392, "4E1B8DB3EF339AAE3B5D2EF6D9B5C0261329559B6DA790481535EBBA9DE77685"),
    ("qwen2_1-femaledVaginus-nsfw-v1.3-fine.safetensors", 3386403,
     "qwen2_1-femaledVaginus-nsfw-v1.3-fine.safetensors",
     637587392, "085453E5E9996911B59B3A4548AE48A289B6130F5D21A4CFE4BCA9ABD9963CEE"),
    ("thesealpacas-nsfw-v2.safetensors", 3357315,
     "NSFW Qwen by TheseAlpacas V2.safetensors",
     79744352, "83ABA822AD8EE10A1E836828F5088259D93BCE7B5F3419B46DBC0258C2BE46A9"),
    ("nsfw-posture-v3.safetensors", 3388118,
     "nsfw-posture-v3.safetensors",
     83943880, "8E4D3F830B61AE1E2A3D5A9FFF1B6596F7A8EF79ADDAEC9363444D6B90EFE950"),
]


def token() -> str:
    tok = os.environ.get("CIVITAI_TOKEN", "").strip()
    if not tok:
        sys.exit("缺 CIVITAI_TOKEN(运行时由记忆档 civitai-apikey-0917.md 提取注入;勿硬编码)")
    return tok


def dl_url(ver: str) -> str:
    # 令牌只进进程内存与远端 URL,不落任何文件
    return f"https://civitai.com/api/download/models/{ver}?token={token()}"


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for buf in iter(lambda: f.read(1 << 22), b""):
            h.update(buf)
    return h.hexdigest().upper()


def total_size(ver: str) -> int:
    """ranged GET 探总长(HEAD 403 是假阴性,记忆档 0917 附带鉴权实弹教训)。"""
    p = subprocess.run(["curl", "-sL", "-m", "30", "-A", UA, "-x", PROXY,
                        "-r", "0-0", "-D", "-", "-o", "/dev/null", dl_url(ver)],
                       capture_output=True, text=True)
    m = re.search(r"[Cc]ontent-[Rr]ange:\s*bytes\s+0-0/(\d+)", p.stdout)
    if not m:
        raise RuntimeError(f"取总长失败 v{ver}: {p.stdout[-300]} {p.stderr[-200:]}")
    return int(m.group(1))


def fetch_segment(ver: str, path: Path, s: int, e: int) -> None:
    """段级追加续传(1108 二次修订版):

    - 每轮只拉剩余子区间 (s+got)-e;响应先落 .curltmp,经 `-w` 回传
      http_code+size_download,**仅当 206 且字节数相符才追加**——代理拥塞时
      7897 会回 5xx HTML 错误页,盲追加会把垃圾字节混进段里(尺寸照齐、
      sha 必炸,1108 实弹见过);非 206 一律丢弃重试;
    - curl `-C -` 与 `-r` 组合实测越界追加(2,559,563B>2,097,152B),不可用,
      故自算子区间追加;
    - got>want(历史脏段)删段重种,自愈。"""
    want = e - s + 1
    last_err = ""
    for attempt in range(1, SEG_TRIES + 1):
        got = path.stat().st_size if path.exists() else 0
        if got == want:
            return
        if got > want:
            path.unlink()
            got = 0
        via_proxy = attempt % 2 == 0     # 奇数轮直连(1108 实测快),偶数轮代理兜底
        tmp = path.with_suffix(path.suffix + ".curltmp")
        cmd = ["curl", "-sL", "-m", str(SEG_TIMEOUT), "-A", UA,
               "-r", f"{s + got}-{e}", "-o", str(tmp),
               "-w", "%{http_code} %{size_download}", dl_url(ver)]
        if via_proxy:
            cmd[1:1] = ["-x", PROXY]
        try:
            cp = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=SEG_TIMEOUT + 30)
        except subprocess.TimeoutExpired:
            tmp.unlink(missing_ok=True)
            last_err = f"curl 超时(第 {attempt} 轮)"
            continue
        code, _, dl_size = (cp.stdout or "").strip().partition(" ")
        got_tmp = tmp.stat().st_size if tmp.exists() else 0
        if code == "206" and got_tmp > 0 and str(got_tmp) == dl_size:
            with open(path, "ab") as out, open(tmp, "rb") as f:
                for buf in iter(lambda: f.read(1 << 20), b""):
                    out.write(buf)
        tmp.unlink(missing_ok=True)
        got = path.stat().st_size if path.exists() else 0
        if got == want:
            return
        last_err = f"第 {attempt} 轮 http={code} tmp={got_tmp}B(声报 {dl_size}) got={got}/{want}"
        time.sleep(min(2 * attempt, 15))
    raise RuntimeError(f"段 {s}-{e} 追加续传 {SEG_TRIES} 轮未齐: {last_err}")


def download(ver: str, dest: Path, threads: int) -> None:
    total = total_size(ver)
    part = dest.with_suffix(".safetensors.part")
    prefix = part.stat().st_size if part.exists() else 0
    print(f"  GET v{ver} 总 {total}B,前缀复用 {prefix}B,剩余 {total - prefix}B", flush=True)
    remain = total - prefix
    if remain > 0:
        step = -(-remain // threads)
        segs = []
        for i in range(threads):
            s = prefix + i * step
            e = min(prefix + (i + 1) * step, total) - 1
            if s > e:
                break
            # 段名内嵌区间戳:并发数/前缀变→段界变→旧段文件不会被误当同区间续传
            # (1108 实弹事故:6→4 线程复用旧 seg 名,seg1 起整体错位,尺寸全对
            #  sha 全炸,终检才拦住;详见首差异字节=段界 20985970 的法证)
            seg = dest.with_name(f"{dest.name}.seg.{s}-{e}.part")
            segs.append((seg, s, e))
        with ThreadPoolExecutor(max_workers=threads) as ex:
            for fut in [ex.submit(fetch_segment, ver, seg, s, e) for seg, s, e in segs]:
                fut.result()
        with open(part, "ab") as out:         # 前缀在前,续拼各段
            for seg, _, _ in segs:
                with open(seg, "rb") as f:
                    for buf in iter(lambda: f.read(1 << 20), b""):
                        out.write(buf)
        for seg, _, _ in segs:
            seg.unlink(missing_ok=True)
    size = part.stat().st_size
    with open(part, "rb") as f:               # safetensors 头终检(0919 同款)
        header_len = struct.unpack("<Q", f.read(8))[0]
    if size != total or not (0 < header_len < 10 * 1024 * 1024):
        raise RuntimeError(f"{dest.name} 终检失败: size={size}/{total} header={header_len}")
    os.replace(part, dest)


def save_manifest(path: Path, inst: str, rec: dict) -> None:
    """写前重读合并——允许多进程并发分头下载不同件而不互踩 manifest。"""
    merged = json.loads(path.read_text()) if path.exists() else {}
    merged[inst] = rec
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=1))


def main() -> None:
    repo = Path(__file__).resolve().parents[3]
    outdir = Path(sys.argv[1]) if len(sys.argv) > 1 else repo / ".zcode/tmp/nsfw-lora-1108"
    flt = sys.argv[2] if len(sys.argv) > 2 else ""
    outdir.mkdir(parents=True, exist_ok=True)
    manifest_path = outdir / "manifest.json"
    for inst, ver, upstream, size, sha in PLAN:
        if flt and flt not in inst:
            continue
        dest = outdir / inst
        rec = {"versionId": ver, "upstreamName": upstream, "expectBytes": size,
               "apiSha256": sha, "dest": str(dest)}
        if dest.exists():
            got = sha256_file(dest)
            rec.update(localSha256=got, bytes=dest.stat().st_size,
                       status="SKIP" if got == sha and dest.stat().st_size == size else "REDOWNLOAD")
            if rec["status"] == "SKIP":
                print(f"SKIP {inst}(sha 对上 API 元数据)", flush=True)
                save_manifest(manifest_path, inst, rec)
                continue
        print(f"DL {inst}(v{ver}, 上游名 {upstream})", flush=True)
        t0 = time.time()
        download(str(ver), dest, THREADS)
        got = sha256_file(dest)
        ok = got == sha and dest.stat().st_size == size
        rec.update(localSha256=got, bytes=dest.stat().st_size,
                   status="OK" if ok else "SHA_MISMATCH", seconds=round(time.time() - t0, 1))
        save_manifest(manifest_path, inst, rec)
        print(f"  {'OK' if ok else 'SHA_MISMATCH'} {inst} {dest.stat().st_size}B "
              f"sha={got[:12]}... ({rec['seconds']}s)", flush=True)
    bad = [k for k, v in (json.loads(manifest_path.read_text())
                          if manifest_path.exists() else {}).items()
           if k in {p[0] for p in PLAN} and v.get("status") not in ("OK", "SKIP")]
    if bad:
        sys.exit("未过件: " + ", ".join(bad))
    print("全部目标件 OK/SKIP(API sha256 比对)")


if __name__ == "__main__":
    main()
