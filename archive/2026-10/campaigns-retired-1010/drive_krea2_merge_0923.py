#!/usr/bin/env python3
"""融合外置盘 Krea2/krea2-retired-0923 → Krea2/models 并去重(09-23)。

背景:09-23 本地退役的 Krea2 系模型已备份到外置盘 krea2-retired-0923(带 sha256 manifest,
exit.txt=ALL OK manifest=24);用户随后把整个文件夹挪进外置盘 Krea2/ 下(卷名=真名不入公开仓,
完整路径见本地档案 ~/.zcode/mystudio-local/external-drive-path.txt),要求融合不重复。

规则(先验证再动手):
- 重复判定=目标同路径且字节数一致 → 对 models/ 现存件算 sha256 与退役 manifest 比对,
  一致才删退役副本;不一致→改名 .CONFLICT-retired0923 保留双份并大声报告,零丢失。
- 独缺件=os.rename 同盘搬入(瞬时,零拷贝)。
- 台账:融合后写 Krea2/manifest-retired-0923.jsonl,24 件全部记录最终路径+sha256(重复件标注
  kept=existing,便于日后字节对账)。
- 清理:._* 与 .DS_Store 苹果渣;搬空后移除 krea2-retired-0923 空壳。

用法:python3 drive_krea2_merge_0923.py [--dry]
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

# 外置盘真实卷名不入公开仓:优先环境变量,默认读本地档案首行(=盘根绝对路径)
ROOT = os.environ.get(
    "MYSTUDIO_EXTERNAL_DRIVE_ROOT",
    (Path.home() / ".zcode/mystudio-local/external-drive-path.txt")
    .read_text(encoding="utf-8").splitlines()[0].strip(),
) + "/AI/Krea2"
SRC = os.path.join(ROOT, "krea2-retired-0923")
MODELS = os.path.join(ROOT, "models")
MANIFEST = os.path.join(SRC, "manifest.jsonl")
LEDGER = os.path.join(ROOT, "manifest-retired-0923.jsonl")

DRY = "--dry" in sys.argv


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb", buffering=1024 * 1024) as f:
        while True:
            chunk = f.read(8 * 1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def rmdir_if_empty(path: str) -> bool:
    """自底向上移除空目录树;非空则原样保留。"""
    if not os.path.isdir(path):
        return False
    for name in sorted(os.listdir(path)):
        rmdir_if_empty(os.path.join(path, name))
    if not os.listdir(path):
        if not DRY:
            os.rmdir(path)
        return True
    return False


def main() -> int:
    if not os.path.isdir(SRC):
        print(f"FATAL: 源目录不存在 {SRC}")
        return 1
    records = []
    with open(MANIFEST, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    print(f"退役 manifest 载入 {len(records)} 件;模式={'DRY-RUN' if DRY else 'EXECUTE'}\n")

    ledger, moved, deduped, conflicts, moved_bytes, freed_bytes = [], 0, 0, 0, 0, 0

    for rec in records:
        rel, exp_bytes, exp_sha = rec["relpath"], rec["bytes"], rec["sha256"]
        src = os.path.join(SRC, rel)
        dst = os.path.join(MODELS, rel)
        if not os.path.isfile(src):
            print(f"!! 退役件缺失,跳过: {rel}")
            continue
        actual = os.path.getsize(src)
        if actual != exp_bytes:
            print(f"!! 退役件字节与 manifest 不符 {actual}!={exp_bytes},跳过: {rel}")
            continue

        if os.path.exists(dst):
            dst_bytes = os.path.getsize(dst)
            if dst_bytes == exp_bytes:
                dst_sha = sha256_of(dst)
                if dst_sha == exp_sha:
                    tag = "kept=existing,retired-copy-removed"
                    if not DRY:
                        os.remove(src)
                    deduped += 1
                    freed_bytes += exp_bytes
                else:
                    conflict = dst + ".CONFLICT-retired0923"
                    if not DRY:
                        os.rename(src, conflict)
                    tag = "HASH-CONFLICT,both-kept"
                    conflicts += 1
                ledger.append({"relpath": f"models/{rel}", "bytes": exp_bytes,
                               "sha256": exp_sha, "note": tag})
                print(f"{'DEDUPE' if tag.startswith('kept') else 'CONFLICT'}: models/{rel} ({exp_bytes:,}B) {tag}")
            else:
                conflict = dst + ".CONFLICT-retired0923"
                if not DRY:
                    os.rename(src, conflict)
                ledger.append({"relpath": f"models/{os.path.basename(conflict)}",
                               "bytes": exp_bytes, "sha256": exp_sha,
                               "note": "SIZE-CONFLICT,both-kept"})
                conflicts += 1
                print(f"CONFLICT(尺寸): {rel} models侧{dst_bytes:,}B vs 退役{exp_bytes:,}B → 双保留")
        else:
            if not DRY:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                os.rename(src, dst)
            moved += 1
            moved_bytes += exp_bytes
            ledger.append({"relpath": f"models/{rel}", "bytes": exp_bytes,
                           "sha256": exp_sha, "note": "moved-from-retired-0923"})
            print(f"MOVE: models/{rel} ({exp_bytes:,}B)")

    # 苹果渣清理:源树内 ._*/.DS_Store + models 树内同名 AppleDouble
    junk = []
    for base in (SRC, MODELS):
        for dirpath, _dirs, files in os.walk(base):
            for name in files:
                if name.startswith("._") or name == ".DS_Store":
                    junk.append(os.path.join(dirpath, name))
    for j in junk:
        if not DRY:
            os.remove(j)
    print(f"\nJUNK 清理 {len(junk)} 件: " + "; ".join(os.path.relpath(j, ROOT) for j in junk))

    # 源目录余物检查(应只剩 manifest.jsonl / exit.txt / 空目录 / 冲突件)
    leftovers = []
    for dirpath, _dirs, files in os.walk(SRC):
        for name in files:
            leftovers.append(os.path.relpath(os.path.join(dirpath, name), SRC))
    print(f"源树余物: {leftovers}")

    if not DRY:
        # ExFAT listdir 顺序不定,必须集合比较(首跑按列表序比较没命中,壳靠手工补清)
        shell_clean = set(leftovers) == {"exit.txt", "manifest.jsonl"}
        if shell_clean:
            os.remove(os.path.join(SRC, "exit.txt"))
        with open(LEDGER, "w", encoding="utf-8") as f:
            for row in ledger:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        if shell_clean:
            os.remove(MANIFEST)  # 24 条已全量并入 LEDGER,不留重复
            rmdir_if_empty(SRC)

    src_gone = not os.path.exists(SRC)
    print(f"\n=== 汇总(mode={'DRY' if DRY else 'EXEC'}) ===")
    print(f"搬入 models/: {moved} 件 / {moved_bytes:,}B")
    print(f"去重删除退役副本: {deduped} 件 / 释放 {freed_bytes:,}B")
    print(f"冲突双保留: {conflicts} 件")
    print(f"台账落盘: {LEDGER if not DRY else '(dry 不落盘)'}")
    print(f"源壳 krea2-retired-0923 已移除: {'是' if src_gone else '否(dry/有余物)'}")

    # 终态对账:models 树逐文件字节数与件数
    total_files, total_bytes = 0, 0
    for dirpath, _dirs, files in os.walk(MODELS):
        for name in files:
            if name.startswith("._") or name == ".DS_Store":
                continue
            total_files += 1
            total_bytes += os.path.getsize(os.path.join(dirpath, name))
    print(f"models/ 终态: {total_files} 件 / {total_bytes:,}B")
    return 0 if conflicts == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
