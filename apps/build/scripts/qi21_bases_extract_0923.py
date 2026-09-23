#!/usr/bin/env python3
"""qi21 道劫九选一节点数据提取器(qi21_bases.json 落盘)— 2026-09-23。

从 05 库(docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md,daojie_canon_lib_0923.py
生成的真源)提取九型底座文本,与 canon 画幅档拼成
apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json(节点 MyQi21DaojieBase
热读数据,09-23 造件轮;工作流接线由下一轮做):

  每型条目字段:
    zh              = canon zh(顺序=daojie_bases.json 条目顺序,不 sorted)
    base_text       = 库②层(型底座·美化版)+ 人物系增量四锁B(常量B·§四.4-.7)
                      + ④配色行,换行拼合;①主体句槽与常量A(基础锁)不在其内
                      ——由工作流恒挂层承担(05 库「三步用库」/装配子图口径)
    aspect_ratio    = canon 同型字段逐字(官方枚举串)
    megapixels      = canon 同型字段逐字
    resolution_override = canon 同型字段照抄(仅三视图 3072×1024;W/H 口径=
                      K2 MyDaojieBase:override 直出,否则 MP 按 1024² 计、边长
                      取整 8 倍数——与 [61] ResolutionSelector 一致)

提取纪律:库②④逐字(装配全文围栏切片,零改写);③层结构自检——人物系六型
(人物/美宣/三视图/高清人脸/分镜剧情图/表情差分)装配围栏中段=[§四.1,§四.2,
*常量B,§四.8],非人物系三型=[§四.1,§四.2,§四.8],与库首常量 A/B 围栏逐行
对账,错位即拒(防 05 库改版后静默提错文)。

用法(仓库根):
  python3 apps/build/scripts/qi21_bases_extract_0923.py           # 提取落盘(幂等,重复跑逐字节同输出)
  python3 apps/build/scripts/qi21_bases_extract_0923.py --check   # 守恒校验磁盘文件与 05 库/canon 一致
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
LIB_MD = REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
CANON_BASES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"
OUT = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json"

# 人物系六型(③层加挂常量B 四把全员锁;与 05 库生成器 daojie_canon_lib_0923.py 同表)
RENWU_XI = {"人物", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分"}


def _fail(msg: str):
    raise SystemExit(f"❌ {msg}")


def _fence_after(doc: str, marker: str) -> list:
    """marker 之后首个 ```text 围栏逐行(常量 A/B 提取用)。"""
    i = doc.find(marker)
    if i < 0:
        _fail(f"05 库缺标记: {marker}")
    m = re.search(r"```text\n(.*?)\n```", doc[i:], re.S)
    if not m:
        _fail(f"05 库标记后缺 ```text 围栏: {marker}")
    return m.group(1).split("\n")


def _assembly_lines(doc: str, zh: str) -> list:
    """该型「### {zh}-基础」节装配全文围栏逐行([0]=①槽行,[1]=②,中段=③,[-1]=④)。"""
    m = re.search(rf"^### {re.escape(zh)}-基础\s*$", doc, re.M)
    if not m:
        _fail(f"05 库缺节: ### {zh}-基础")
    nxt = re.search(r"^### ", doc[m.end():], re.M)
    seg = doc[m.end(): m.end() + nxt.start()] if nxt else doc[m.end():]
    fence = re.search(r"```text\n(.*?)\n```", seg, re.S)
    if not fence:
        _fail(f"{zh}: 缺装配全文围栏")
    lines = fence.group(1).split("\n")
    if not (lines[0].startswith("⟨①:") and lines[0].endswith("⟩")):
        _fail(f"{zh}: 装配全文首行非 ⟨①:…⟩ 槽")
    return lines


def build_entries() -> list:
    canon = json.loads(CANON_BASES.read_text(encoding="utf-8"))
    if len(canon) != 9:
        _fail(f"canon 应九型,得 {len(canon)}")
    doc = LIB_MD.read_text(encoding="utf-8")
    const_a = _fence_after(doc, "**常量 A·基础")
    const_b = _fence_after(doc, "**常量 B·人物系增量")
    if len(const_a) != 3 or len(const_b) != 4:
        _fail(f"常量形状异常: A={len(const_a)} 行(应3)、B={len(const_b)} 行(应4)")

    entries = []
    for e in canon:
        zh = e["zh"]
        lines = _assembly_lines(doc, zh)
        base, locks, pal = lines[1], lines[2:-1], lines[-1]
        expect_locks = ([const_a[0], const_a[1], *const_b, const_a[2]]
                        if zh in RENWU_XI else list(const_a))
        if locks != expect_locks:
            _fail(f"「{zh}」③层结构与库首常量不对账(中段 {len(locks)} 行,"
                  f"应 {len(expect_locks)} 行;05 库可能已改版,请先核库再提取)")
        if not re.match(r"^[^=]+=[^=]+$", pal):
            _fail(f"「{zh}」④配色行形状异常: {pal[:40]}…")
        base_text = "\n".join([base, *const_b, pal] if zh in RENWU_XI else [base, pal])
        item = {"zh": zh, "base_text": base_text,
                "aspect_ratio": e["aspect_ratio"], "megapixels": e["megapixels"]}
        if e.get("resolution_override") is not None:
            item["resolution_override"] = e["resolution_override"]
        entries.append(item)
    return entries


def serialize(entries: list) -> str:
    return json.dumps(entries, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="守恒校验磁盘文件与 05 库/canon 一致")
    args = ap.parse_args()

    want = serialize(build_entries())
    if args.check:
        if not OUT.is_file():
            print(f"❌ 缺文件: {OUT}")
            return 1
        if OUT.read_text(encoding="utf-8") != want:
            print(f"❌ 守恒校验未过: {OUT} 与 05 库/canon 提取不一致(重跑提取即同步)")
            return 1
        n_renwu = sum(1 for e in json.loads(want) if e["zh"] in RENWU_XI)
        print(f"✅ 守恒校验全绿:{OUT.name} 九型与 05 库②④层逐字一致、③层结构与常量 A/B "
              f"对账通过、aspect/MP/override 与 canon 逐字一致(人物系 {n_renwu} 型含增量四锁B)。")
        return 0

    if OUT.is_file() and OUT.read_text(encoding="utf-8") == want:
        print(f"已是最新(幂等): {OUT}(九型,与 05 库/canon 一致)")
        return 0
    OUT.write_text(want, encoding="utf-8")
    n_renwu = sum(1 for e in json.loads(want) if e["zh"] in RENWU_XI)
    print(f"生成 → {OUT}(九型 {len(want)} 字符;人物系 {n_renwu} 型 base_text 含增量四锁B;"
          f"结构自检与常量 A/B 对账已通过)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
