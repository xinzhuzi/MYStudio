#!/usr/bin/env python3
"""道劫全本批量入库:Unity 设计树 5.正文 4125 章 → MA 项目 novel/chapters/ 镜像。

格式单一真源 = apps/frontend/lib/studio/novel.ts buildNovelChapterMirror:
  # {title}
  (空行)
  > 卷:{第X卷}
  > 源ID:chapter-NNN(3位零填充,≥1000 自然4位)
  > 修订:1
  > 来源:{原文件名}
  (空行)
  {正文(含章内 # 标题行,剥掉开头细纲引用块)}

用法:
  python3 manying_novel_bulk_import.py            # 干跑(只报数)
  python3 manying_novel_bulk_import.py --write    # 实写
跳过已存在镜像(如 chapter-001.md,含事件分析块,不碰)。源区 审查结果/ 是治理报告非正文,排除。
"""
import os
import re
import sys
import glob

SRC_BASE = "/Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/5.正文"
DST_BASE = "/Users/zhengbingjin/Project/IP/MA/novel/chapters"
CN_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]

REF_BLOCK = re.compile(r"^(?:——|---)\s*\n?\[细纲引用\]\([^)]*\)\s*\n?(?:——|---)\s*\n?", re.S)
TITLE_RE = re.compile(r"^#\s*(第[0-9一二三四五六七八九十百千万]+章[^\n]*)", re.M)
CH_NUM = {"零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def cn_volume(dir_name: str) -> str:
    m = re.match(r"^(\d+)\.", dir_name)
    n = int(m.group(1)) if m else 0
    return f"第{CN_NUM[n] if n < len(CN_NUM) else n}卷"


def main() -> None:
    write = "--write" in sys.argv
    chapters = []  # (num, src_path, vol_dir)
    for d in sorted(glob.glob(os.path.join(SRC_BASE, "*/"))):
        base = os.path.basename(d.rstrip("/"))
        if base == "审查结果":
            continue
        for f in os.listdir(d):
            m = re.match(r"^(\d+)_.+\.md$", f)
            if m:
                chapters.append((int(m.group(1)), os.path.join(d, f), base))
    chapters.sort()
    nums = [n for n, _, _ in chapters]
    assert nums == list(range(1, len(nums) + 1)), f"编号不连续: 共{len(nums)} 首={nums[0]} 尾={nums[-1]}"

    written, skipped, anomalies, total_bytes = 0, 0, [], 0
    for num, src, vol_dir in chapters:
        cid = f"chapter-{num:03d}"
        dst = os.path.join(DST_BASE, f"{cid}.md")
        if os.path.exists(dst):
            skipped += 1
            continue
        text = open(src, encoding="utf-8").read()
        text = REF_BLOCK.sub("", text, count=1).strip()
        hm = TITLE_RE.search(text)
        if not hm:
            anomalies.append(f"{cid}: 章内无标题行({os.path.basename(src)})")
            continue
        title = hm.group(1).strip()
        src_name = os.path.basename(src)
        mirror = (
            f"# {title}\n\n"
            f"> 卷：{cn_volume(vol_dir)}\n"
            f"> 源ID：{cid}\n"
            f"> 修订：1\n"
            f"> 来源：{src_name}\n\n"
            f"{text}\n"
        )
        if write:
            with open(dst, "w", encoding="utf-8") as fh:
                fh.write(mirror)
        written += 1
        total_bytes += len(mirror.encode("utf-8"))

    mode = "实写" if write else "干跑"
    print(f"[{mode}] 源章节 {len(chapters)}(1..{nums[-1]} 连续) | 新写入 {written}({total_bytes // 1024}KB) | 已存在跳过 {skipped} | 异常 {len(anomalies)}")
    for a in anomalies:
        print("  ⚠", a)
    if write:
        final = len([f for f in os.listdir(DST_BASE) if re.match(r"chapter-\d+\.md$", f)])
        print(f"目标目录现共 {final} 个章节镜像")


if __name__ == "__main__":
    main()
