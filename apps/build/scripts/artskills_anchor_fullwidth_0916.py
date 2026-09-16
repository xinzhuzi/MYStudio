#!/usr/bin/env python3
"""art_skills 全库『质量锚定』行标点全角化(09-16 用户裁定「统一全角化」)。

背景:工笔锚定半角→全角经引擎实弹对照验证改善出图(X 系消融,工笔先例
e309ef5);用户裁定其余 47 风格家族统一。转换规则严格复刻工笔实证文本:
  - `,` → `，` 当且仅当逗号后不紧跟空格(组分隔符 `), (` 保持 ASCII)
  - `:` → `：`(全库实测 100% 为 `:1.xx` 权重冒号,零异类)
  - 其余字节零改动;『反向规避』行不动(无裁定,工笔负向亦保持半角先例)

门禁(任一不过退出码 1):
  G1 工笔行=全角冻结形态(防二次漂移)
  G2 转换后行内残留 ASCII 逗号必后随空格;零残留 ASCII 冒号
  G3 权重数字逐位守恒(转换前后数字串完全一致)
  G4 字符集变化仅限 ,/: → ，/：(内容字符零增删)
  G5 每文件仅『质量锚定』一行变化(或零变化=已收敛)
  G6 反向规避行逐字节不变
幂等:重复运行零字节变化。装机镜像(Resources/studio-manuals)同步+字节核对。
"""
from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ART = REPO / "apps/frontend/assets/studio-manuals/art_skills"
INSTALLED = Path(
    "/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills"
)

ROW = re.compile(r"^(\|\s*质量锚定\s*\|)(.*?)(\|\s*)$", re.M)
NEG_ROW = re.compile(r"^(\|\s*反向规避\s*\|)(.*?)(\|\s*)$", re.M)


def convert_cell(cell: str) -> str:
    out: list[str] = []
    for i, ch in enumerate(cell):
        if ch == "," and (i + 1 >= len(cell) or cell[i + 1] != " "):
            out.append("，")
        elif ch == ":":
            out.append("：")
        else:
            out.append(ch)
    return "".join(out)


def digits(s: str) -> list[str]:
    return re.findall(r"\d+", s)


def sha(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()[:16]


def process(dry: bool = False) -> int:
    changed: list[tuple[str, str, str]] = []  # (dir, before_sha, after_sha)
    failures: list[str] = []

    for prefix in sorted(ART.rglob("prefix.md")):
        text = prefix.read_text(encoding="utf-8")
        m = ROW.search(text)
        if not m:
            continue  # VARIANT 级无此行,不属本战役
        neg = NEG_ROW.search(text)
        neg_before = neg.group(0) if neg else ""
        cell_before = m.group(2)
        cell_after = convert_cell(cell_before)

        # G4 字符集纪律
        if set(cell_after) - set(cell_before) - {"，", "："} or set(cell_before) - set(cell_after) - {",", ":"}:
            failures.append(f"G4 {prefix.parent.name}: 字符集越界变化")

        # G3 权重数字守恒
        if digits(cell_before) != digits(cell_after):
            failures.append(f"G3 {prefix.parent.name}: 权重数字漂移")

        if cell_after == cell_before:
            continue  # 已收敛(工笔先例/幂等二跑)

        new_text = text[: m.start(2)] + cell_after + text[m.end(2):]
        # G5 仅一行变化
        before_lines = text.split("\n")
        after_lines = new_text.split("\n")
        if len(before_lines) != len(after_lines) or sum(
            1 for a, b in zip(before_lines, after_lines) if a != b
        ) != 1:
            failures.append(f"G5 {prefix.parent.name}: 变化行数≠1")
        # G6 负向行不变
        neg_after = NEG_ROW.search(new_text)
        if (neg_after.group(0) if neg_after else "") != neg_before:
            failures.append(f"G6 {prefix.parent.name}: 反向规避行被改动")

        if not dry and not failures:
            prefix.write_text(new_text, encoding="utf-8")
        changed.append((prefix.parent.name, sha(cell_before), sha(cell_after)))

    # G2 残留纪律(全库复查)
    for prefix in sorted(ART.rglob("prefix.md")):
        m = ROW.search(prefix.read_text(encoding="utf-8"))
        if not m:
            continue
        cell = m.group(2)
        for c in re.finditer(r",(?![ ])", cell):
            failures.append(f"G2 {prefix.parent.name}: 残留紧邻逗号 …{cell[max(0,c.start()-8):c.start()+8]}…")
        if ":" in cell:
            failures.append(f"G2 {prefix.parent.name}: 残留ASCII冒号")

    # G1 工笔冻结形态
    gongbi = (ART / "2d_gongbi/prefix.md").read_text(encoding="utf-8")
    if "画中人物容颜清丽，五官精致柔和" not in ROW.search(gongbi).group(2):  # 09-17 宣纸禁用(审查批)
        failures.append("G1 工笔全角冻结形态缺失")

    print(f"[{'DRY' if dry else 'CONVERT'}] 转换 {len(changed)} 个风格锚定行")
    for name, b, a in changed:
        print(f"  {name}: {b} → {a}")

    if failures:
        print("FAILURES:")
        for f in failures:
            print(" ", f)
        return 1
    print("过门: G1工笔冻结/G2零残留/G3数字守恒/G4字符集/G5单行/G6负向不动 — 全绿")
    return 0


def sync_installed() -> int:
    if not INSTALLED.is_dir():
        print(f"装机镜像不存在,跳过同步: {INSTALLED}")
        return 0
    # openrsync --relative 哑火(2.6.9 参数坑,0916 实弹),改逐文件拷贝
    synced = 0
    for p in ART.rglob("prefix.md"):
        dst = INSTALLED / p.relative_to(ART)
        if dst.exists():
            shutil.copy2(p, dst)
            synced += 1
    # 字节核对(装机侧存在的文件;IP 域如 daojie_ink_guofeng 不随包分发,跳过)
    checked = bad = missing = 0
    for p in ART.rglob("prefix.md"):
        dst = INSTALLED / p.relative_to(ART)
        if not dst.exists():
            missing += 1
            continue
        checked += 1
        if p.read_bytes() != dst.read_bytes():
            bad += 1
            if bad <= 5:
                print("装机镜像字节不一致:", p.relative_to(ART))
    if bad:
        return 1
    total = len(list(ART.rglob("prefix.md")))
    print(f"装机镜像同步+字节核对一致(核对 {checked} 文件,装机侧不存在跳过 {missing},仓库共 {total})")
    return 0


if __name__ == "__main__":
    dry = "--dry" in sys.argv
    code = process(dry=dry)
    if code or dry:
        sys.exit(code)
    sys.exit(sync_installed())
