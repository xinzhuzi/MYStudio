#!/usr/bin/env python3
"""道劫漫剧剧本全本迁移(1018):Unity MA Design → IP/MA novel/drama 一一对应。

源 = /Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/6.长剧/卷XX_*/
      第N章_漫剧.md  (4125 份已生成剧本,10-16~10-18 批量生成役产物,内容零改动)
目标 = /Users/zhengbingjin/Project/IP/MA/novel/drama/chapter-NNN_漫剧.md
      (NNN 与 novel/chapters/chapter-NNN.md 同 ID 空间:%03d 零填充,>999 自然宽)

规则:只迁移不重生成;逐份 md5 校验;目标已存在且同 md5=幂等跳过,
不同=冲突即停不覆盖;章号必须恰为 1..4125 无缺无重(与章节家核账)。
源目录保留不动(是否撤源另令)。
"""
from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path

SRC = Path("/Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/6.长剧")
DST = Path("/Users/zhengbingjin/Project/IP/MA/novel/drama")
CHAPTERS = Path("/Users/zhengbingjin/Project/IP/MA/novel/chapters")
EXPECT = set(range(1, 4126))
PAT = re.compile(r"^第(\d+)章_漫剧\.md$")


def md5(p: Path) -> str:
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    src: dict[int, Path] = {}
    for p in SRC.rglob("*.md"):
        m = PAT.match(p.name)
        if not m:
            print(f"!! 非规范文件名,跳过: {p}")
            continue
        n = int(m.group(1))
        if n in src:
            print(f"!! 章号重复 {n}: {src[n]} 与 {p}")
            return 2
        src[n] = p

    missing = EXPECT - set(src)
    extra = set(src) - EXPECT
    if missing or extra:
        print(f"!! 章号不齐: 缺 {sorted(missing)[:10]}{'...' if len(missing) > 10 else ''} / 多 {sorted(extra)[:10]}")
        return 2

    chapter_ids = {int(m.group(1)) for p in CHAPTERS.glob("chapter-*.md")
                   if (m := re.match(r"^chapter-(\d{3,})\.md$", p.name))}
    if chapter_ids != EXPECT:
        print(f"!! 章节家核账不平: chapters={len(chapter_ids)}")
        return 2

    DST.mkdir(parents=True, exist_ok=True)
    copied = skipped = 0
    for n in sorted(src):
        s = src[n]
        d = DST / f"chapter-{n:03d}_漫剧.md"
        if d.exists():
            if md5(d) == md5(s):
                skipped += 1
                continue
            print(f"!! 冲突不覆盖: {d} 已存在且内容不同")
            return 3
        shutil.copy2(s, d)
        if md5(d) != md5(s):
            print(f"!! 拷贝校验失败: {s}")
            return 3
        copied += 1

    total = len(list(DST.glob("chapter-*_漫剧.md")))
    print(f"迁移完成: 新拷 {copied} / 幂等跳过 {skipped} / 目标在册 {total} / 源 4125 保留不动")
    return 0 if total == 4125 else 4


if __name__ == "__main__":
    sys.exit(main())
