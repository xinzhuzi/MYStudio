#!/usr/bin/env python3
"""㉒ 头身比锚轮·05 库行级手术 — 2026-10-02(10-01-qi21-usetest-batch ㉒)。

canon_lib BEAUTIFIED 五型(人物/美宣/多视图/高清人脸/表情差分)已加头身比锚句
(本脚本上游真源),本脚本把磁盘 05 库对应五型②层行做**单源替换**(import 现
BEAUTIFIED,零双写)+装配字符数行现算刷新+§六 append-only 台账一条。

为什么不重跑 build_doc 全量生成:0930 轮以来 05 库 §一使用规矩(0929 硬约束段
尾刷新/0930 W1 收束句段)与 §六台账(0930 三条)为 append-only 手改区,canon_lib
build_doc() 不含它们(6b2d9f0/5b1d1cc/b45ac4e 先例,--check 只结构校验故绿)——
全量重生成会抹 7020 字符在账增量。行级手术+--check 逐字对拍=本轮路径。

守恒门(手术后必跑,本脚本末尾自动):
  python3 apps/build/scripts/daojie_canon_lib.py --check     # ②③④逐字=BEAUTIFIED
  python3 apps/build/scripts/daojie_canon_lib.py --overlap   # 主体句×底座零重复

用法(仓库根):python3 apps/build/scripts/qi21_headbody_anchor_surgery_1002.py
幂等:锚句已在(②层行==BEAUTIFIED 现值)即零写入退出 0。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_canon_lib as cl  # noqa: E402  (单源:新②层句身只写在 BEAUTIFIED)

LIB = cl.OUT  # docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md
ANCHOR_TYPES = ["人物", "美宣", "多视图", "高清人脸", "表情差分"]

LEDGER = (
    "- **1002 头身比锚轮(已落账,经本生成器;10-01-qi21-usetest-batch ㉒,用户质询「这个人物"
    "图你好像身材比例没有调整好吧,为啥我看起来这个人物超过了九头身?」)**:人物系五型(人物/美宣/"
    "多视图/高清人脸/表情差分)②层底座各加头身比锚句——作画基准入账=写实成人 7~7.5 头身、时尚插画 "
    "8 封顶、九头身+=超模风格化极端;AI 模型默认爱拉长下肢,比例无锚即逐图随机飘(1002 实查:人物型"
    "底座 base_text 头身/腿/身形零命中,锁层A/B 零,主体句例文零——v5.1「纯画法零物象」层天然缺人体"
    "比例维度)。**锚句措辞**(口径=约七头半/解剖写实/下肢不过度拉长,纯画法语言,与「自然直立」站姿锁"
    "同级):人物/美宣/多视图(全身可见三型)=「头身比约七头半，解剖比例写实，下肢不过度拉长」;高清"
    "人脸/表情差分(特写/半身两型,画面无下肢)=「头身比约七头半，解剖比例写实，头颈肩比例合度」(第三"
    "短句按取景适配,攻击特写大头长颈窄肩病;全局比例先验仍由前两短句承担)。插位=各型②层人体域句组末"
    "(人物=「全身入画」后并句;美宣=「笔墨比主体更简」后;多视图=「同一人跨张同一」后;人脸=「同一人"
    "跨张同一」后;表情=「同一人跨格完全相同」后),画法句(运笔…)起句不被打断。分镜剧情图不锚(叙事画面"
    "人物取景自由,非立像定骨图——型格差异,如实注);场景/道具/概念气氛图不锚(非人物系)。**落盘**:"
    "①canon_lib BEAUTIFIED 五型同笔(真源,附注释块);②05 库五型②层行单源替换(import BEAUTIFIED,"
    "行级手术零重生成——§一/§六 0930 append-only 增量在手改侧,重跑 build_doc 会抹账,0930 轮以来既定"
    "路径;手术脚本 qi21_headbody_anchor_surgery_1002.py 幂等)+装配字符数行现算刷新;③提取器 "
    "qi21_bases_extract_0923.py 补十档(自由档尾条常量化——06e6149 自由档入库时提取器漏同步,"
    "--check 红账自彼起,本轮补齐恢复守恒)→qi21_bases.json 重提取(五型 base_text 带锚句+自由档"
    "保留);④工作流零改动(BASE 真源=qi21_bases.json 热读,MyQi21DaojieBase mtime 签名穿透缓存即"
    "热更);⑤覆盖矩阵零新行(头身比锚非 canon 骨干/九锁口径,核验域=②层句身+--check ②③④逐字对拍)。"
    "**验证**:同 seed 前后对照(头身比目测)留实弹员;词效未验前锚句为静默底座常量,负面结果如实记。**"
)


def fence_span(doc: str, zh: str) -> tuple[int, int, list[str]]:
    """该型「### {zh}-基础」节装配围栏(起止偏移+逐行);围栏唯一性由 --check 结构门兜底。"""
    m = re.search(rf"^### {re.escape(zh)}-基础\s*$", doc, re.M)
    if not m:
        raise SystemExit(f"❌ 05 库缺节: ### {zh}-基础")
    nxt = re.search(r"^### ", doc[m.end():], re.M)
    seg = doc[m.end(): m.end() + nxt.start()] if nxt else doc[m.end():]
    fm = re.search(r"```text\n(.*?)\n```", seg, re.S)
    if not fm:
        raise SystemExit(f"❌ {zh}: 缺装配全文围栏")
    start = m.end() + fm.start(1)
    end = m.end() + fm.end(1)
    return start, end, fm.group(1).split("\n")


def main() -> int:
    doc = LIB.read_text(encoding="utf-8")
    orig = doc
    changed: list[str] = []

    # ① 五型②层行单源替换(lines[1] = BEAUTIFIED[zh] 现值;①槽行 lines[0] 原样保留)
    for zh in ANCHOR_TYPES:
        start, end, lines = fence_span(doc, zh)
        want = cl.BEAUTIFIED[zh]
        if lines[1] == want:
            continue  # 幂等:已同步
        if "头身比约七头半" in lines[1] and lines[1] != want:
            raise SystemExit(f"❌ {zh}: ②层已含锚句但与 BEAUTIFIED 不逐字一致——人工核再动")
        assert lines[0].startswith("⟨①:") and lines[0].endswith("⟩"), f"{zh} ①槽行形状异常"
        doc = doc[:start] + "\n".join([lines[0], want, *lines[2:]]) + doc[end:]
        changed.append(zh)

    # ② 装配字符数行现算刷新(自查记录账随句同步;layers 真源=canon+prefix 现算)
    bases = json_load(cl.BASES)
    layers = cl.build_layers(bases, cl.PREFIX.read_text(encoding="utf-8"))
    zh_order = [e["zh"] for e in bases]
    chars = "、".join(
        f"{zh} {len(cl.assembly(zh, layers, cl.SUBJECTS[zh][0]).replace(chr(10), ''))}"
        for zh in zh_order)
    line_pat = re.compile(r"^- 装配全文字符数\(①槽展平为例一,含换行\):.*$", re.M)
    if not line_pat.search(doc):
        raise SystemExit("❌ 05 库缺「装配全文字符数」自查行")
    doc = line_pat.sub(f"- 装配全文字符数(①槽展平为例一,含换行):{chars}。", doc, count=1)

    # ③ §六 append-only 台账(顶部插,0930 三条同序=最新在上)
    if LEDGER[:60] not in doc:
        head = "## 六、演进与待裁定(09-23 深检吸收轮立账;零围栏零 ###,重跑不漂)\n"
        i = doc.find(head)
        if i < 0:
            raise SystemExit("❌ 05 库缺 §六 标题行")
        j = i + len(head)
        doc = doc[:j] + "\n" + LEDGER + "\n" + doc[j:]

    if doc == orig:
        print("已是最新(幂等):05 库五型②层与 BEAUTIFIED 一致、台账在账。")
        return 0
    LIB.write_text(doc, encoding="utf-8")
    print(f"手术 → {LIB.name}(五型②层锚句:{'、'.join(changed) or '无(已在)'};"
          f"字符数行刷新+§六台账一条)")
    return 0


def json_load(p: Path) -> list:
    import json
    return json.loads(p.read_text(encoding="utf-8"))


if __name__ == "__main__":
    sys.exit(main())
