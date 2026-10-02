#!/usr/bin/env python3
"""qi21 道劫九选一节点数据提取器(qi21_bases.json 落盘)— 2026-09-23。

从 05 库(docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md,daojie_canon_lib.py
生成的真源)提取九型底座文本,与 canon 画幅档拼成
apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json(节点 MyQi21DaojieBase
热读数据,09-23 造件轮;工作流接线由下一轮做)。**1002 起十档**=九型提取+尾条
「自由」(1001 用户测试批 P1,06e6149 入库时提取器漏同步、1002 头身比锚轮补齐——
见下方 FREE_ENTRY):

  每型条目字段:
    zh              = canon zh(顺序=daojie_bases.json 条目顺序,不 sorted;0927 改名轮起
                      canon 五号型=「多视图」,军令①)
    base_text       = 库②层(型底座·美化版)+ 人物系增量四锁B(常量B·§四.4-.7)
                      + ④配色行,换行拼合;①主体句槽与常量A(基础锁)不在其内
                      ——由工作流恒挂层承担(05 库「三步用库」/装配子图口径)
    aspect_ratio    = canon 同型字段逐字(官方枚举串);**Q2.1侧画幅分档**——多视图型
                      经 Q21_ASPECT_FORK(daojie_canon_lib 单源 import)取 3:4 Portrait
                      Standard 4.2MP 并退役 resolution_override(0927 多视图轮:分张产线
                      与人物型同档;K2 侧 canon aspect/override 合板口径不动=Q2.1侧 fork
                      同摘噪轮先例)
    megapixels      = canon 同型字段逐字(多视图型取 fork 值)
    resolution_override = canon 同型字段照抄(fork 型除外;W/H 口径=K2 MyDaojieBase:
                      override 直出,否则 MP 按 1024² 计、取整 8 倍数——与 [61]
                      ResolutionSelector 一致)
    rgba_default    = 0929 画布治理批 D6 RGBA 型联动布尔:四型透明声明型(道具/
                      多视图/高清人脸/表情差分)=true 其余五型 false;**布尔真源=
                      本脚本 RGBA_DEFAULT_TYPES 常量**(05 库只载声明文字不载布尔,
                      防文档格式漂移带坏机器可读链);提取时与②层透明声明句互锁
                      对账(错位即拒);节点 MyQi21DaojieBase rgba_default 槽热读

提取纪律:库②④逐字(装配全文围栏切片,零改写);③层结构自检——人物系六型
(人物/美宣/多视图/高清人脸/分镜剧情图/表情差分)装配围栏中段=[§四.1,§四.2,
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

# 人物系六型(③层加挂常量B 四把全员锁;与 05 库生成器 daojie_canon_lib.py 同表;
# 0927 改名轮:三视图→多视图)
RENWU_XI = {"人物", "美宣", "多视图", "高清人脸", "分镜剧情图", "表情差分"}

# 0929 画布治理批·D6 RGBA 型联动(用户 0929 拍板四型):rgba_default 布尔真源=本
# 常量(道具/多视图/高清人脸/表情差分=true,其余五型=false)——05 库只载声明文字
# 不载布尔(防文档格式漂移带坏机器可读链);四型集合=0928 扩令透明声明四型
# (canon_lib BEAUTIFIED 挂 TRANSPARENT_DECL 者),提取时与②层声明句互锁对账
# (错位即拒,防名单与库文漂移;真源链=提取器常量→json 字段→节点 rgba_default
# 槽→契约锁,design D6「真源链钉死」)。
RGBA_DEFAULT_TYPES = {"道具", "多视图", "高清人脸", "表情差分"}

# 透明声明句核锚=canon_lib TRANSPARENT_DECL 首段全串(表情差分变体尾「，光源
# 方向九格一致」同前缀)——**全串锚防「透明头皮」光头禁令条款误判**(S0 研究
# research/transparency-fusion.md 注记:人物系的「透明」字样非透明声明)。
_RGBA_DECL_ANCHOR = "图为带透明通道的 RGBA 透明底图"

# 0927 多视图轮·Q2.1侧画幅分档(单源=daojie_canon_lib.Q21_ASPECT_FORK,import 复用
# 防两处漂移——多视图 3:4 Portrait Standard 4.2MP、退役 override;K2 侧 canon 不动)
from daojie_canon_lib import Q21_ASPECT_FORK  # noqa: E402  (同目录单源 import)

# 1002 头身比锚轮补账:十档尾条「自由」(1001 用户测试批 P1,design §2.4;06e6149
# 入库 qi21_bases.json 时本提取器漏同步——十档磁盘态与九型提取器输出不对账,--check
# 红账自彼起)。自由档=无型底座层(base_text 空串,装配自动降级两段拼=主体句+锁层A)
# +画幅兜底 1:1/1.0MP(1024×1024,与 my_qi21_base.py FREE_BASE 兜底同源)+透明手动
# (rgba_default=false,「透明覆盖」面板布尔直通)。条目=06e6149 入库现态逐字冻结
# (真源链=本常量→json 末条→节点 FREE_BASE 判定);05 库不载自由档(九型节外无此型,
# 库②层真源域仅九型——自由=「无型底座」语义,与库九型成文零交叠)。
FREE_ENTRY = {
    "zh": "自由",
    "base_text": "",
    "aspect_ratio": "1:1 (Square)",
    "megapixels": 1.0,
    "rgba_default": False,
}


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
        if zh in Q21_ASPECT_FORK:  # 0927 多视图轮:Q2.1侧画幅分档+退役 override
            item["aspect_ratio"], item["megapixels"] = Q21_ASPECT_FORK[zh]
        elif e.get("resolution_override") is not None:
            item["resolution_override"] = e["resolution_override"]
        # 0929 画布治理批 D6:rgba_default 追加最末(既有键序不动)——与②层透明
        # 声明句互锁对账,错位即拒(防 RGBA_DEFAULT_TYPES 名单与 05 库四型透明
        # 声明漂移;全串锚防「透明头皮」光头禁令条款误判)
        has_decl = _RGBA_DECL_ANCHOR in base_text
        if has_decl != (zh in RGBA_DEFAULT_TYPES):
            _fail(f"「{zh}」rgba_default 与②层透明声明不对账(名单内="
                  f"{zh in RGBA_DEFAULT_TYPES},声明句在场={has_decl});"
                  "RGBA_DEFAULT_TYPES 与 05 库②层透明声明须同笔同步(0928 扩令四型)")
        item["rgba_default"] = zh in RGBA_DEFAULT_TYPES
        entries.append(item)
    # 1002 补账:十档尾条「自由」(1001 用户测试批 P1)——九型提取后追加;键序与
    # 06e6149 入库现态逐字一致(serialize 按插入序,自由档恒最末)
    entries.append(dict(FREE_ENTRY))
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
        n_rgba = sum(1 for e in json.loads(want) if e["rgba_default"])
        print(f"✅ 守恒校验全绿:{OUT.name} 十档(九型+自由尾条)与 05 库②④层逐字一致、"
              f"③层结构与常量 A/B 对账通过、aspect/MP/override 与 canon 逐字一致、"
              f"rgba_default {n_rgba} 型 true 其余 false(与②层透明声明互锁;"
              f"人物系 {n_renwu} 型含增量四锁B;自由档=空底座/1:1 1.0MP/false 尾条)。")
        return 0

    if OUT.is_file() and OUT.read_text(encoding="utf-8") == want:
        print(f"已是最新(幂等): {OUT}(十档=九型+自由,与 05 库/canon 一致)")
        return 0
    OUT.write_text(want, encoding="utf-8")
    n_renwu = sum(1 for e in json.loads(want) if e["zh"] in RENWU_XI)
    n_rgba = sum(1 for e in json.loads(want) if e["rgba_default"])
    print(f"生成 → {OUT}(十档=九型+自由尾条 {len(want)} 字符;人物系 {n_renwu} 型 base_text "
          f"含增量四锁B;rgba_default {n_rgba} 型 true(四型透明声明型,与②层声明互锁"
          f"对账已通过);结构自检与常量 A/B 对账已通过)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
