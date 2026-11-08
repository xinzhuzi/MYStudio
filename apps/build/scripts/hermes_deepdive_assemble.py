#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
组装《Hermes 记忆系统深度详解》→ docs/Hermes/hermes-memory-deep-dive.md

结构:
  卷首(定位/两层标注口径/章节核证状态表/阅读指引/目录)
  第 I 部分  = 初版 hermes-memory-report.md §1-§5 + 核证附录
               (机械改名 §1→§A…§5→§E、内节 1.1→A.1 等;每支柱尾部插「详解支撑(详解版)」;
                P11 附修正注;§F 下挂 F.1 初版核证表 + F.2 本版核证状态与修正记录)
  第 II 部分 = chapters/ch01..ch07 逐字收录(章前加「本章核证状态(详解版)」栏,栏为本版所加)

收录保真:写出前对盘上七章全文做逐字子串断言,任何一章不匹配即失败退出(不写半成品)。
核证状态口径以 2026-10-27 工作流交付整合者的章节核证记录为准:
  C1 ok / C2 两瑕 / C3 两瑕 / C4 核证任务失败(未核证) / C5 C6 C7 ok。

用法:python3 apps/build/scripts/hermes_deepdive_assemble.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # apps/build/scripts → 仓库根
DOCS = ROOT / "docs" / "Hermes"
REPORT = DOCS / "hermes-memory-report.md"
OUT = DOCS / "hermes-memory-deep-dive.md"

CHAPTERS: list[dict] = [
    {
        "file": "ch01-runtime.md",
        "status": "✅ 章节核证通过(本轮 ok=true,无问题项)。",
        "banner_extra": "",
    },
    {
        "file": "ch02-store.md",
        "status": (
            "⚠️ 核证有瑕**两处**(本轮核证核出;盘上章文已按核证结论披露/修正——**收录版即修正后文本**,"
            "整合者本轮亲读 §2.1.1/§2.6.2 核对):\n"
            "> ① §2.1.1 原断言「`agent/conversation_compression.py` 会匹配这两个标题检测『目标被清空后残留的块』」"
            "**对被指文件无落点**——核证三轮 grep(标题常量/残留语义/渲染锚)全部零命中,"
            "`MEMORY_BLOCK_HEADERS` 全库仅 `tools/memory_tool_store.py`(定义)与 `tools/memory_tool.py`(导入)两处,"
            "标题文本唯一其他出现是 `tests/agent/test_413_compression.py:631` 测试夹具;原章文系忠实转述 "
            "`memory_tool_store.py:21-22` 的 lockstep 注释,而注释所指行为在当前检出不存在(**注释已过期**)。"
            "现文已改为「注释声称 + 三轮 grep 无落点实证 + 现行 ALWAYS-rebuild 机制」的如实表述。\n"
            "> ② §2.6.2 原文「`:834` 处注释明言压缩边界上缓存本就失效,重抓不付额外代价」**归源失实**——"
            "`agent/system_prompt.py:834` 是代码行 `agent._memory_store.load_from_disk()`,`invalidate_system_prompt` "
            "docstring(:817-827)只说压缩后重载以纳入本会话写入,并无该成本论证文字;「注释明言」内容系原稿自行引申。"
            "现文已明示该行为代码行,并把成本论证落点改指同边界的压缩执行侧。此瑕连带修正初版 P11 措辞(见 §B P11 修正注)。\n"
            "> 核证其余覆盖 28 组引用(超 12 处下限):引文逐字吻合、锚号 "
            "#10877/#10878/#10888/#97316/#103419/#107270/#26045/#42405/#117952/#119668 逐一在位、"
            "盘上 MEMORY.md(含第二条「.」噪声条目)与 USER.md 前三条逐字吻合(以上为核证记录转述)。"
        ),
        "banner_extra": "",
    },
    {
        "file": "ch03-security.md",
        "status": (
            "⚠️ 核证有瑕**两处**(本轮核证核出;盘上章文已按实测修正——**收录版即修正后文本**,"
            "整合者本轮亲读 §3.1.3/§3.5.4 核对):\n"
            "> ① §3.1.3 原称不可见字符集「零宽、双向覆盖等 18 个码点」——核证于检出根实测 "
            "`python3 -c \"from tools.threat_patterns import INVISIBLE_CHARS; …\"` 输出 **count=17**"
            "(源码 `tools/threat_patterns.py:110-112` 两个字符串字面量 8+9),多数错一;行号 :110-112 本身精确。"
            "现文已改为 17 并附实测。\n"
            "> ② §3.5.4 原将 `agent/stream_delivery.py:346-347` 注释引作「…when a tag was split across chunks」——"
            "原文第一分句为「…split across **deltas**」,第二分句逐字吻合,锚 #5719 确在 :350;一词之差,"
            "语义未变但非逐字。现文引文已按原文修正。"
        ),
        "banner_extra": "",
    },
    {
        "file": "ch04-state.md",
        "status": (
            "⚠️ **未核证**——本轮章节核证子代理失败(`WorkflowError: Subagent turn failed: Model creation failed`),"
            "本章无独立核证记录;章内断言(含自述「逐行亲读」与 §4.8 验证记录)一律按**无标注(转引)**对待,"
            "本版整合未复核。盘上文件存在且结构完整(整合者本轮清点:§4.0-§4.8 全节在位、50,297 字节、正常收尾;"
            "截断标记扫描唯一命中为 §4.4 内合法代码示例 `TODO: fix`,非截断)。本章支撑 P1/P2/P4 的**展开细节**相应降级;"
            "三支柱本体主张仍以初版独立核证(✅)为准,不受本章降级影响。"
        ),
        "banner_extra": "",
    },
    {
        "file": "ch05-compression.md",
        "status": "✅ 章节核证通过(本轮 ok=true,无问题项)。",
        "banner_extra": "",
    },
    {
        "file": "ch06-ecosystem.md",
        "status": "✅ 章节核证通过(本轮 ok=true,无问题项)。",
        "banner_extra": "",
    },
    {
        "file": "ch07-deployment.md",
        "status": "✅ 章节核证通过(本轮 ok=true,无问题项)。",
        "banner_extra": "",
    },
]

SHORT_STATUS = {
    "ch01-runtime.md": "✅",
    "ch02-store.md": "⚠️ 两瑕(已修)",
    "ch03-security.md": "⚠️ 两瑕(已修)",
    "ch04-state.md": "⚠️ 未核证",
    "ch05-compression.md": "✅",
    "ch06-ecosystem.md": "✅",
    "ch07-deployment.md": "✅",
}

TITLES = {
    "ch01-runtime.md": "第 1 章 记忆运行时与调用链",
    "ch02-store.md": "第二章 内置记忆存储契约:MemoryStore 与 memory 工具",
    "ch03-security.md": "第 3 章 记忆安全链:双向威胁扫描、出口脱敏、流式围栏剥离与审批钉死",
    "ch04-state.md": "第四章 会话状态库工程:state.db 的守卫、边车、检索与自愈",
    "ch05-compression.md": "第 5 章 压缩与长程记忆",
    "ch06-ecosystem.md": "第六章 记忆后端生态与治理:catalog、安装流、迁移自愈与内置薄后端",
    "ch07-deployment.md": "第 7 章 本机部署实况与使用面",
}

# ---------------------------------------------------------------- 第 I 部分:初版正文机械改名

H2_RENAMES = [
    ("## 1. 整体架构与数据流", "## §A 整体架构与数据流"),
    ("## 2. 核心优点盘点", "## §B 核心优点盘点"),
    ("## 3. 生态与工程质量", "## §C 生态与工程质量"),
    ("## 4. 对比定论", "## §D 对比定论"),
    ("## 5. 诚实的局限与未覆盖", "## §E 诚实的局限与未覆盖"),
]
H3_LETTER = {"1": "A", "3": "C", "4": "D", "5": "E"}
INLINE_RENAMES = [
    ("(见 §5)", "(见 §E)"),
    ("(§3.5)", "(§C.5)"),
    ("(§3.4)", "(§C.4)"),
]

SUPPORT = {
    1: "- **详解支撑(详解版)**:逐跳时序与边车盖章/回放细节=**第 1 章 §1.4(T2/T3)**(章核证 ✅);写路两条 UPDATE(行寻址/位置寻址)与回放侧字节稳定两条保证=**第 4 章 §4.3**(章核证 ⚠️ 未核证);压缩拷贝对边车的逐字节保留(辅)=**第 5 章 §5.5**(章核证 ✅)。",
    2: "- **详解支撑(详解版)**:WAL 守卫规则逐条(全部带事故锚)与决策流、WAL-reset 易感窗数学=**第 4 章 §4.2**;本机库只读佐证(journal_mode、SQLite 3.51.0 落易感窗但运行时版本未验证)=**第 4 章 §4.8**(两处章核证均 ⚠️ 未核证)。",
    3: "- **详解支撑(详解版)**:运行时插入点=**第 1 章 §1.4-T6**(章核证 ✅);压缩全景十阶段、checkpoint v2 五个失败分支与「失败宁可不长压缩」兑现路径=**第 5 章 §5.1、§5.4**(章核证 ✅)。",
    4: "- **详解支撑(详解版)**:检索路由 cjk→trigram→LIKE 三级降级、cjk_unicode61 分词器实现、fail-open 与分块自适应重建=**第 4 章 §4.4-4.6**(章核证 ⚠️ 未核证);被压轮次的档案存活(软归档仍可 session_search)=**第 5 章 §5.6.4**(章核证 ✅)。",
    5: "- **详解支撑(详解版)**:九出口运行时接线=**第 1 章 §1.6.2**(章核证 ✅);脱敏链逐环、递归容器走查与 learned-set 二次屏蔽、九出口逐个点名、fail-closed 小结=**第 3 章 §3.4**(章核证 ⚠️ 两瑕已修)。",
    6: "- **详解支撑(详解版)**:三门(`_PREFETCH_GATE`/`_BACKGROUND_GATE`/超时守护)与后台线程模型=**第 1 章 §1.3.2、§1.3.3**(章核证 ✅)。",
    7: "- **详解支撑(详解版)**:存储契约侧守门段(审批门与后台删除门)=**第 2 章 §2.3.6**(章核证 ⚠️ 两瑕已修);威胁模型、暂存 pin、重放校验、无人值守 fail-closed 删除门=**第 3 章 §3.6**(章核证 ⚠️ 两瑕已修)。",
    8: "- **详解支撑(详解版)**:加载期净化 `_sanitize` 的 [BLOCKED] 占位/原文双轨=**第 2 章 §2.6.3**(章核证 ⚠️ 两瑕已修);威胁规则库三元组与 scope 累积、写入侧拒写四落点、流式围栏剥离状态机=**第 3 章 §3.1-3.3、§3.5**(章核证 ⚠️ 两瑕已修)。",
    9: "- **详解支撑(详解版)**:预算口径(含分隔符 join)、超限文案原文、终态检查豁免与整理熔断、memory 工具完整契约=**第 2 章 §2.2、§2.3**(章核证 ⚠️ 两瑕已修)。",
    10: "- **详解支撑(详解版)**:归属三闸运行时接线与 teardown 有界排水=**第 1 章 §1.6.4、§1.6.5**(章核证 ✅);本机多 profile 配置面=**第 7 章 §7.1、§7.5**(章核证 ✅)。",
    11: "- **详解支撑(详解版)**:冻结快照抓取点/使用点/刷新边界与加载期净化=**第 2 章 §2.6**(章核证 ⚠️ 两瑕已修,含下述修正注);压缩边界与快照协同(辅)=**第 5 章 §5.6**(章核证 ✅);本机内建层实体=**第 7 章 §7.2.5**(章核证 ✅)。",
    12: "- **详解支撑(详解版)**:catalog 字段全表、安装流(SHA 钉死/树外 provenance/kill list)、left-core 迁移自愈与指数退避、内置薄后端、记忆插件全量清点(71 主目+13 邻接)=**第 6 章 §6.1-6.6**(章核证 ✅);本机实际安装与 provenance 物证=**第 7 章 §7.3**(章核证 ✅)。",
}

P11_NOTE = (
    "\n\n> **P11 修正注(本版,承接初版 P11 内的修正注 1027,以本注为准)**:初版 P11 证据句"
    "「(`system_prompt.py:834`,注释明言该点缓存本就失效)」与核证附录同款括注「(:834,缓存本就失效处)」"
    "**归源失实**——第 2 章核证亲核:`:834` 是代码行 `agent._memory_store.load_from_disk()`,"
    "`invalidate_system_prompt` 的 docstring 只说压缩后重载以纳入本会话写入,并无「缓存本就失效、重抓不付额外代价」"
    "的成本论证;该论证文字在同一边界的**压缩执行侧**(第 2 章现文指认 `conversation_compression.py:3101-3102`/`:3118`,"
    "此指认随第 2 章 ⚠️ 章级状态)。**P11 结论不受影响**:冻结快照 docstring 逐字命中、`_system_prompt_snapshot` 四点机制、"
    "快照仅 agent 初始化与上下文重建边界两处重抓,均与初版核证记录一致(不在第 2 章核证两瑕之内)。"
)

OVERVIEW_TABLE = """| 支柱 | 一句话主张 | 详解支撑(章§节) | 支撑章核证状态 |
|---|---|---|---|
| P1 | api_content 边车逐轮回放一致性 | 1§1.4(T2/T3)、4§4.3、5§5.5(辅) | 1✅;4⚠️未核证;5✅ |
| P2 | 会话库 WAL 所有权纪律(绝不在线降级) | 4§4.2、4§4.8 | 4⚠️未核证 |
| P3 | 压缩前记忆检查点 fail-closed | 1§1.4-T6、5§5.1/5.4 | 1✅;5✅ |
| P4 | CJK 双字 FTS+fail-open+让路式重建 | 4§4.4-4.6、5§5.6.4 | 4⚠️未核证;5✅ |
| P5 | 外部 provider 九出口强制脱敏 fail-closed | 1§1.6.2、3§3.4 | 1✅;3⚠️两瑕已修 |
| P6 | 卡死后端进程级熔断门 _StuckCallGate | 1§1.3.2/1.3.3 | 1✅ |
| P7 | 记忆写审批+TOCTOU 防偷换钉死 | 2§2.3.6、3§3.6 | 2/3⚠️两瑕已修 |
| P8 | 双向威胁扫描+流式围栏剥离 | 2§2.6.3、3§3.1-3.3/3.5 | 2/3⚠️两瑕已修 |
| P9 | 硬限额+显式整理协议(不静默压缩) | 2§2.2-2.3 | 2⚠️两瑕已修 |
| P10 | 多 profile 记忆归属隔离 | 1§1.6.4-1.6.5、7§7.1/7.5 | 1✅;7✅ |
| P11 | 冻结快照注入:轮中写盘不改提示字节 | 2§2.6(含修正注)、5§5.6(辅)、7§7.2.5 | 2⚠️两瑕已修;5/7✅ |
| P12 | 插件生态信任模型与记忆后端治理 | 6§6.1-6.6、7§7.3 | 6✅;7✅ |"""


def build_part1(report_text: str) -> str:
    lines = report_text.split("\n")
    i_body = next(i for i, ln in enumerate(lines) if ln.startswith("## 1. 整体架构与数据流"))
    i_app = next(i for i, ln in enumerate(lines) if ln.startswith("## 核证附录"))
    body = lines[i_body:i_app]
    appendix = lines[i_app:]

    # --- 机械改名(标题 + 文内交叉引用)---
    out: list[str] = []
    for ln in body:
        replaced = None
        for old, new in H2_RENAMES:
            if ln.startswith(old):
                replaced = new + ln[len(old):]
                break
        if replaced is None:
            m = re.match(r"^### ([135])\.(\d+) (.*)$", ln)
            if m:
                replaced = f"### {H3_LETTER[m.group(1)]}.{m.group(2)} {m.group(3)}"
            else:
                replaced = ln
        for old, new in INLINE_RENAMES:
            replaced = replaced.replace(old, new)
        out.append(replaced)
    body = out

    # --- 每支柱尾部插「详解支撑」(P11 另附修正注)---
    pillar_re = re.compile(r"^### P(\d+)\|")
    insert_count = 0
    result: list[str] = []
    i = 0
    while i < len(body):
        ln = body[i]
        result.append(ln)
        m = pillar_re.match(ln)
        if m:
            pno = int(m.group(1))
            j = i + 1
            while j < len(body) and not (pillar_re.match(body[j]) or body[j].startswith("## ")):
                result.append(body[j])
                j += 1
            k = len(result) - 1
            while k >= 0 and result[k].strip() == "":
                k -= 1
            insert = SUPPORT[pno] + (P11_NOTE if pno == 11 else "")
            result.insert(k + 1, insert)
            insert_count += 1
            i = j
            continue
        i += 1
    if insert_count != 12:
        raise SystemExit(f"[FATAL] 支柱支撑插入数 {insert_count} != 12,中止")
    body = result

    # --- 核证附录 → F.1;去掉「(终稿完。)」---
    appendix = list(appendix)
    appendix[0] = "### F.1 支柱主张与独立核证结论(12/12 holds=true,保留自初版)"
    while appendix and appendix[-1].strip() == "":
        appendix.pop()
    if appendix[-1].strip().startswith("*(终稿完。)*"):
        appendix.pop()
        while appendix and appendix[-1].strip() == "":
            appendix.pop()

    part1 = []
    part1.append("# 第 I 部分 结论定谳与十二支柱")
    part1.append("")
    part1.append(
        "> 本部分**原样保留**初版(`hermes-memory-report.md`)§1-§5 与核证附录的结论定谳与 12 支柱骨架"
        "(断言级核证状态 ✅核证/✅抽验/无标注 原样);仅做机械改名——初版 §1→§A、§2→§B、§3→§C、§4→§D、§5→§E,"
        "内节号随改(1.1→A.1、3.4→C.4 等),文内交叉引用同步;每条支柱尾部新增「**详解支撑(详解版)**」条目"
        "(挂接第 II 部分代码级展开的章§节与支撑章核证状态),P11 另附修正注。支柱-章节速查:"
    )
    part1.append("")
    part1.append(OVERVIEW_TABLE)
    part1.append("")
    part1.append("---")
    part1.append("")
    part1.extend(body)
    part1.append("")
    part1.append("## §F 核证附录")
    part1.append("")
    part1.append("> F.1 为初版核证附录原文(机械改名);F.2 为本版核证状态与修正记录。")
    part1.append("")
    part1.extend(appendix)
    part1.append("")
    part1.append(F2_SECTION)
    return "\n".join(part1)


F2_SECTION = """### F.2 本版(详解版)核证状态与修正记录

| 项 | 状态 |
|---|---|
| 第 1 章(运行时) | ✅ 章节核证通过(本轮 ok=true,无问题项) |
| 第 2 章(存储契约) | ⚠️ 两瑕:①§2.1.1「conversation_compression.py 匹配两标题」断言对被指文件无落点(store 的 lockstep 注释已过期);②§2.6.2「:834 注释明言缓存本就失效」归源失实(:834 为代码行,docstring 无成本论证)。核证其余覆盖 28 组引用:引文逐字吻合、锚号 10 枚在位、盘上样例吻合。**盘上章文已按核证结论披露/修正,收录版即修正后文本**(整合者本轮亲读 §2.1.1/§2.6.2 核对) |
| 第 3 章(安全链) | ⚠️ 两瑕:①INVISIBLE_CHARS 实测 17 非 18;②§3.5.4 引文一词之差(chunks≠deltas,原文为 deltas)。**盘上章文已按实测修正,收录版即修正后文本**(整合者本轮亲读 §3.1.3/§3.5.4 核对) |
| 第 4 章(状态库) | ⚠️ **未核证**——章节核证子代理失败(WorkflowError: Subagent turn failed: Model creation failed),无独立核证记录;盘上文件存在且结构完整(整合者清点:§4.0-4.8 全节在位、50,297 字节、正常收尾),章内断言按「无标注(转引)」对待。本章支撑 P1/P2/P4 的展开细节相应降级;三支柱本体仍以初版独立核证(✅)为准 |
| 第 5 章(压缩) | ✅ 章节核证通过(本轮 ok=true,无问题项) |
| 第 6 章(生态治理) | ✅ 章节核证通过(本轮 ok=true,无问题项) |
| 第 7 章(本机部署) | ✅ 章节核证通过(本轮 ok=true,无问题项) |
| 初版 P11 措辞 | 「(system_prompt.py:834,注释明言该点缓存本就失效)」及附录同款括注按第 2 章核证结论修正——:834 是代码行;成本论证注释在同边界压缩执行侧。见 §B P11 修正注;**P11 结论(快照两处重抓、轮中写盘不改提示字节)不受影响** |
| 收录保真(第 II 部分) | 组装脚本生成时对盘上七章做逐字子串校验(7/7 通过方才写出);各章前「本章核证状态(详解版)」栏为本版所加,章内正文零改写 |"""

# ---------------------------------------------------------------- 卷首 + 第 II 部分

FRONT = """# Hermes 记忆系统深度详解(Deep Dive)

- 日期:2026-10-27
- **定位**:本文是《Hermes 记忆系统深度研究:优点盘点与价值判断》(`docs/Hermes/hermes-memory-report.md`,下称**初版**)的**详解版终稿**,独立成篇。**初版=结论速览**(12 支柱主张、业界定位、对比定谳,10 分钟读完);**本版=实现细节**——第 I 部分原样保留初版的结论定谳与 12 支柱骨架(断言级核证状态原样),每条支柱挂接「详解支撑」指向代码级展开;第 II 部分逐字收录七章代码级详解(运行时逐跳时序/存储契约/安全五闸/状态库 WAL·FTS/压缩链/生态治理清点/本机部署实况)。
- **证据标注,两层口径**:
  - **断言级(沿用初版约定,作用于第 I 部分及各章内文)**:**✅核证**=初版独立核证路在 `~/.hermes/hermes-agent` 检出亲核命中,行号以核证记录为准;**✅抽验**=初稿撰写时逐行抽验命中(13 处);**无标注**=勘察交接材料转引、未逐条复核。
  - **章级(本版新增,作用于第 II 部分整章,见下表)**:✅通过=本轮章节核证 ok=true 且无问题项;⚠️两瑕(已修)=核证核出两处问题、盘上章文已按核证结论披露/修正(收录版即修正后文本);⚠️未核证=核证任务失败、无独立核证记录,章内断言按「无标注(转引)」对待。
- 初版卷首「核证总况」(保留):**12 条支柱主张经独立核证 12/12 全部成立(holds=true)**,其中两处措辞按核证 note 修正(P2 macOS 类目、P10 引用范围),一处证据强度如实降级(P4 性能数字属注释声称、未复跑)。
- **章节核证总况(本版)**:七章中**四章通过**(第 1/5/6/7 章)、**两章各两瑕且已修**(第 2/3 章,收录版即修正后文本)、**一章未核证**(第 4 章,核证子代理失败)。章节核证另带出一处对初版 P11 的措辞修正(§B P11 修正注,**以本版为准**)。
- **整合者本轮亲做**:初版全文亲读;七章 `ls` 清点(7 件齐);第 2/3 章四处核证问题落点(§2.1.1/§2.6.2/§3.1.3/§3.5.4)亲读比对——盘上现文均已含修正表述;第 4 章结构清点(§4.0-§4.8 全节在位、50,297 字节、正常收尾;截断标记扫描唯一命中为 §4.4 内合法代码示例 `TODO: fix`,非截断);第 II 部分收录保真=组装脚本生成时对盘上七章逐字子串校验(7/7)。**未做**:未运行任何 Hermes 代码或测试;未复核第 II 部分其余全部引用;未复跑各章自附「实测/本机佐证/验证记录」(均为各章撰写时执行的检查)。
- 初版研究与本版整合均未运行任何 Hermes 代码或测试;材料中「实测」字样均为各章/各路撰写时执行,本版转引。

## 阅读指引

| 你想要… | 读哪里 |
|---|---|
| 10 分钟拿结论(好在哪、差在哪、怎么定谳) | §D 对比定论 + §B 支柱总览速查表 |
| 看懂一轮对话里记忆怎么流转 | §A 架构与数据流 → 深入:第 1 章 §1.4 逐跳时序(T0-T7) |
| 核对某条支柱的代码证据 | §B 该支柱「详解支撑」→ 第 II 部分对应章§节 |
| 评估这套系统的安全面 | 第 3 章(五道闸门),配套第 2 章 §2.6.3 |
| 借鉴工程实现去复用 | 各章末复用清单(§1.7/§2.7/§3.7/§4.7/§5.12/§6.6) |
| 知道本机实际装了什么、开了什么 | 第 7 章 |
| 只想查一个机制(如 WAL、FTS、审批 pin、熔断门) | §B 支柱总览速查表 → 直达对应章§节 |
| 分辨哪些内容经独立核证 | 卷首两层标注口径 + 下表 + §F.2 |

## 章节核证状态(第 II 部分)

章节核证=独立核证环节对 `~/.hermes/hermes-agent` 检出的逐章核证(引文逐字比对、行号落点、实测复跑;第 2 章记录显示覆盖 28 组引用、下限 12 组);各章记录以 ok/problems 交付整合,本表如实转录。**口径:章核证状态作用于整章;章内断言级标注为各章自述,整合未复跑。**

| 章 | 文件 | 标题 | 章节核证状态 |
|---|---|---|---|
| 1 | ch01-runtime.md | 记忆运行时与调用链 | ✅ 通过(ok=true,无问题项) |
| 2 | ch02-store.md | 内置记忆存储契约:MemoryStore 与 memory 工具 | ⚠️ 两瑕(断言无落点/归源失实);盘上章文已披露/修正,收录版即修正后文本 |
| 3 | ch03-security.md | 记忆安全链:双向威胁扫描、出口脱敏、流式围栏剥离与审批钉死 | ⚠️ 两瑕(常量值 18→17/引文一词之差);盘上章文已修正,收录版即修正后文本 |
| 4 | ch04-state.md | 会话状态库工程:state.db 的守卫、边车、检索与自愈 | ⚠️ 未核证(核证子代理失败:`WorkflowError: Subagent turn failed: Model creation failed`);章内断言按无标注(转引)对待 |
| 5 | ch05-compression.md | 压缩与长程记忆 | ✅ 通过(ok=true,无问题项) |
| 6 | ch06-ecosystem.md | 记忆后端生态与治理:catalog、安装流、迁移自愈与内置薄后端 | ✅ 通过(ok=true,无问题项) |
| 7 | ch07-deployment.md | 本机部署实况与使用面 | ✅ 通过(ok=true,无问题项) |

- **第 2 章两瑕**(核证记录转述):①§2.1.1 断言「`agent/conversation_compression.py` 会匹配这两个标题检测『目标被清空后残留的块』」——核证三轮 grep(MEMORY_BLOCK_HEADERS|USER PROFILE|your personal notes;MEMORY|leftover|emptied;personal notes|PROFILE|memory_tool|_render_block|═)全部零命中;`MEMORY_BLOCK_HEADERS` 全库仅 `tools/memory_tool_store.py:24`(定义)与 `tools/memory_tool.py:44`(导入),标题文本唯一其他出现是 `tests/agent/test_413_compression.py:631` 测试夹具;`memory_tool_store.py:21-22` 的 lockstep 注释确实如此声称(原章文忠实转述了注释),但注释所指行为在当前检出(249,759 字节)中不存在——**断言对被指文件无落点**。②§2.6.2 称「`:834` 处注释明言压缩边界上缓存本就失效,重抓不付额外代价」——实际 `agent/system_prompt.py:834` 是代码行 `agent._memory_store.load_from_disk()`;`invalidate_system_prompt` docstring(:817-827)只说压缩后重载以纳入本会话写入,并无该成本论证文字;「注释明言」的内容系章节自行引申。**两处均已在盘上章文披露/修正**(整合者本轮亲读核对:§2.1.1 现文自证 grep 零命中并判 lockstep 注释过期、改述现行 ALWAYS-rebuild 机制;§2.6.2 现文明示 :834 为代码行、成本论证落点改指压缩执行侧)。瑕②连带修正初版 P11 措辞(§B P11 修正注)。
- **第 3 章两瑕**:①§3.1.3 称不可见字符集「零宽、双向覆盖等 18 个码点」(INVISIBLE_CHARS,行号 :110-112 本身精确)——核证于检出根实测 `python3 -c "from tools.threat_patterns import INVISIBLE_CHARS; …"` 输出 count=17(源码两字符串字面量 8+9=17),多数错一;②§3.5.4 将 `agent/stream_delivery.py:346-347` 注释引作「…when a tag was split across chunks」——原文第一分句为「…split across **deltas**」,第二分句逐字吻合,锚 #5719 确在 :350;一词之差,语义未变但非逐字。**两处均已在盘上章文修正**(整合者本轮亲读核对:§3.1.3 现文写 17 并附实测;§3.5.4 现文引文为 deltas)。
- **第 4 章(未核证)**:本轮章节核证子代理失败(`WorkflowError: Subagent turn failed: Model creation failed`),无独立核证记录。盘上文件存在且结构完整(整合者清点,见卷首);章内断言按「无标注(转引)」对待。本章支撑 P1/P2/P4 的**展开细节**相应降级;三支柱本体主张仍以初版独立核证(✅)为准,不受影响。

## 目录

- **第 I 部分 结论定谳与十二支柱**(初版骨架,断言级核证状态原样;每支柱附「详解支撑」)
  - §A 整体架构与数据流
  - §B 核心优点盘点:十二支柱(P1…P12;含支柱-章节速查表与 P11 修正注)
  - §C 生态与工程质量
  - §D 对比定论:Hermes 记忆系统是不是「目前最好的工具」
  - §E 诚实的局限与未覆盖
  - §F 核证附录(F.1 初版 12/12 核证表;F.2 本版核证状态与修正记录)
- **第 II 部分 七章代码级详解**(逐字收录,各章前有「本章核证状态」栏)
  - 第 1 章 记忆运行时与调用链 ✅
  - 第二章 内置记忆存储契约:MemoryStore 与 memory 工具 ⚠️ 两瑕(已修)
  - 第 3 章 记忆安全链:双向威胁扫描、出口脱敏、流式围栏剥离与审批钉死 ⚠️ 两瑕(已修)
  - 第四章 会话状态库工程:state.db 的守卫、边车、检索与自愈 ⚠️ 未核证
  - 第 5 章 压缩与长程记忆 ✅
  - 第六章 记忆后端生态与治理:catalog、安装流、迁移自愈与内置薄后端 ✅
  - 第 7 章 本机部署实况与使用面 ✅"""

PART2_HEADER = """# 第 II 部分 七章代码级详解(全文收录)

> **收录原则**:以下七章为盘上章文(`docs/Hermes/chapters/ch01-runtime.md` … `ch07-deployment.md`)**逐字收录、零改写**——组装脚本对本文件生成时做过逐字子串校验(7/7 通过方才写出);各章前的「本章核证状态(详解版)」栏为本版所加,章内正文一字未动。各章的路径约定(相对 `~/.hermes/hermes-agent` 检出)、支柱编号、「实测/本机佐证/验证记录」均为各章撰写时自述,本版整合未复跑。章级核证状态总表见卷首。"""

END_NOTE = """---

*(详解版完。第 I 部分=初版骨架+详解支撑挂接;第 II 部分=七章逐字收录。组装工具:`apps/build/scripts/hermes_deepdive_assemble.py`;收录保真:盘上七章逐字子串校验 7/7 通过。)*"""


def build_part2() -> str:
    chunks = [PART2_HEADER]
    for ch in CHAPTERS:
        path = DOCS / "chapters" / ch["file"]
        text = path.read_text(encoding="utf-8").strip()
        banner = (
            "> **本章核证状态(详解版)**:"
            + ch["status"]
            + "\n>\n> **收录来源**:`docs/Hermes/chapters/"
            + ch["file"]
            + "`,逐字收录、零改写。"
        )
        chunks.append("\n---\n\n" + banner + "\n\n" + text + "\n")
    return "\n".join(chunks)


def main() -> None:
    report_text = REPORT.read_text(encoding="utf-8")
    part1 = build_part1(report_text)
    part2 = build_part2()

    doc = FRONT + "\n\n---\n\n" + part1 + "\n\n---\n\n" + part2 + "\n" + END_NOTE + "\n"

    # ---- 收录保真校验:盘上七章全文必须是成品逐字子串 ----
    failures = []
    for ch in CHAPTERS:
        raw = (DOCS / "chapters" / ch["file"]).read_text(encoding="utf-8").strip()
        if raw not in doc:
            failures.append(ch["file"])
    # 第 I 部分哨兵:支柱支撑 12 处、改名后节标题在位、修正注在位
    sentinels = [
        "## §A 整体架构与数据流",
        "## §B 核心优点盘点",
        "## §C 生态与工程质量",
        "## §D 对比定论",
        "## §E 诚实的局限与未覆盖",
        "### F.1 支柱主张与独立核证结论",
        "### F.2 本版(详解版)核证状态与修正记录",
        "P11 修正注(本版,承接初版 P11 内的修正注 1027",
    ]
    for s in sentinels:
        if s not in doc:
            failures.append(f"<sentinel> {s}")
    n_support = doc.count("**详解支撑(详解版)**:")
    if n_support != 12:
        failures.append(f"<support-count> {n_support} != 12")
    if failures:
        raise SystemExit(f"[FATAL] 保真校验失败,不写出: {failures}")

    OUT.write_text(doc, encoding="utf-8")
    size = OUT.stat().st_size
    lines = doc.count("\n") + 1
    print(f"[OK] 写出 {OUT.relative_to(ROOT)}")
    print(f"[OK] 字节 {size:,} / 行数 {lines:,}")
    print("[OK] 收录保真:盘上七章逐字子串校验 7/7 通过")
    print(f"[OK] 支柱「详解支撑」挂接 {n_support}/12;哨兵 {len(sentinels)}/{len(sentinels)} 在位")


if __name__ == "__main__":
    main()
