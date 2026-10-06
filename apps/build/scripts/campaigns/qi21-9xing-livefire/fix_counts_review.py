#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_counts_review.py — 复核勘正:三份失败型记录的后核计数 17/18 → 18/19(以 postcheck.json 实数为准)。

依据(2026-10-06 12:1x 复核):
  verify/type-3-道具.postcheck.json / type-5-多视图 / type-6-高清人脸 实测均 checks=19、绿 18、红 1
  (唯一红=「透明门:四角 alpha<=8(FACTS rgba_default 型)」;ok=False/exit=1 与「透明门红」属实)。
  记录原写「17/18」系计数笔误(分子分母均错),三处就地勘正:首行结果括号、§8 标题、§10 后核行;
  并在各记录 §9 勘误清单末尾追加勘正条(记录自带勘误惯例;勘正条内引用的旧值「17/18」保留不改)。
ok 型(1/2/4)记录的 18/18 与其 JSON 实数(checks=18、绿 18)相符,不动。
幂等:勘正条已在且正文无残留「17/18」时零改退出。
(v1 有「replace 后被原 lines join 覆写」bug 致首跑只插了勘正条;v2 逐行处理修复。)
"""
import json

SLUGS = ["type-3-道具", "type-5-多视图", "type-6-高清人脸"]
MARK = "后核计数勘正(2026-10-06 12:1x 复核收账)"

for slug in SLUGS:
    path = f"runs/{slug}.md"
    pc = json.load(open(f"verify/{slug}.postcheck.json", encoding="utf-8"))
    total = len(pc["checks"])
    green = sum(1 for c in pc["checks"] if c["ok"])
    red = total - green
    assert (total, green, red) == (19, 18, 1), (slug, total, green, red)

    lines = open(path, encoding="utf-8").read().split("\n")
    has_bullet = any(MARK in l for l in lines)

    # ① 逐行替换:勘正条行(引用旧值)跳过,其余行 17/18 → 18/19
    n_fix = 0
    for i, l in enumerate(lines):
        if MARK in l:
            continue
        if "17/18" in l:
            lines[i] = l.replace("17/18", f"{green}/{total}")
            n_fix += 1

    # ② 勘正条(幂等:已在则不重复插)
    inserted = False
    if not has_bullet:
        bullet = (
            f"- **{MARK}**:本记录首行结果括号/§8 标题/§10 后核行原写「17/18」系计数笔误"
            f"——经对 `verify/{slug}.postcheck.json` 实数复核:checks=19 项、绿 18、红 1(唯一红=透明门「四角 alpha<=8(FACTS rgba_default 型)」;"
            f"ok=False/exit=1 与「透明门红」判定属实),正确计数=**18/19**;三处已就地勘正(ok 型 1/2/4 记录的 18/18 与其 JSON 实数相符,不受影响)。"
        )
        idx10 = next(i for i, l in enumerate(lines) if l.startswith("## 10."))
        j = idx10 - 1
        while j >= 0 and lines[j].strip() == "":
            j -= 1
        lines.insert(j + 1, bullet)
        inserted = True

    # ③ 终态自检:正文(除勘正条行)不得残留 17/18
    residue = [i for i, l in enumerate(lines) if "17/18" in l and MARK not in l]
    assert not residue, (slug, "残留 17/18 行号", residue)

    open(path, "w", encoding="utf-8").write("\n".join(lines))
    print(f"{slug}: 替换 {n_fix} 处;勘正条{'新插' if inserted else '已在(保留)'};零残留 ✓")

print("done")
