#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
引文回查器 —— 校验评判报告中「」引文逐字出自原章(去标点/空白子串匹配)。
工艺照搬 hand_fix_pipeline 教训(C8/L7):严格解析,非法输入抛错退出,绝不静默放行。

用法:
    python3 critic_citation_check.py <out-root> [--drama <剧本目录>] [--threshold 98]

行为:
    - 遍历 <out-root>/reports/chapter-NNN.md;
    - 只抽取「证据槽位」引文:问题清单行(- [Px] …)的佐证引文字段(第 3 个 — 分隔段)
      与亮点节;问题分析/修改方向/优化建议/评分表里的「」是模型自述语,不属证据,不核验;
    - 去标点/空白(clean)后与对应原章 chapter-NNN_漫剧.md 做 clean 子串匹配;
      匹配双变体:原文直配 + 剥离行首说话人标签(「名(语气):」「SFX(…):」等)后再配
      —— 对白在原章按说话人标签断行,逐字连引须跨标签匹配;
      省略号(……/…)拼接式引文按省略号切段,每一段都必须逐字命中(任何一段转述即整条失败);
    - 问题行佐证字段缺「」引文视为无效条目,计入失败(防泛泛而谈,PRD 验收 1/试产门⑤);
    - 每章写 <out-root>/reports/chapter-NNN.cite.json(率 + 失败引文清单 + clean 字段);
    - 回填 <out-root>/index.tsv 的 citeRate 列(表头须与 screenplay_critic 完全一致);
    - 汇总打印各章率;任一章率 < 阈值(默认 98)→ exit 1;解析非法输入 → exit 2。

元词白名单:prompt v2 体系自带词汇(判定级/交付侧标记/禁词反例/灵气语汇表)不是剧本引文,
命中白名单按合法计;真正的剧本引文仍须逐字匹配原章。
"""
import argparse
import json
import os
import re
import sys
import time

from screenplay_critic import INDEX_HEADER, load_index, write_index

DEFAULT_DRAMA = "/Users/zhengbingjin/Project/IP/MA/novel/drama"
REPORT_MD_RE = re.compile(r"^chapter-(\d+)\.md$")
BRACKET_RE = re.compile(r"「([^「」]+)」")
PROB_LINE_RE = re.compile(r"^\s*-\s*\[P[012]\]")
CLEAN_RE = re.compile(r"\W+", re.UNICODE)  # 去标点+空白,保留中日韩文字/字母/数字
GAP_RE = re.compile(r"…+|⋯+|。\.{3,}|\.{3,}")  # 省略号:引文内明示跳越的合法写法
# 行首说话人/音效标签:「名(语气):」「OS(名,语气):」「SFX(压抑):」「名:」——对白在原章按标签断行
LINE_TAG_RE = re.compile(r"(?m)^[^\n:：]{1,12}(?:（[^）\n]{0,10}）|\([^)\n]{0,10}\))?[：:][ \t]*")
COL_CITERATE = INDEX_HEADER.index("citeRate")  # 第 8 列(0-based 7)

# 元词白名单(clean 形式):prompt v2 自带、允许出现在「」中的非引文词汇。
# 含:已制作章标记/建议类型词/判定级三选一/OS 标签双式/现代称谓与游戏感禁词反例/灵气动词与三色/氛围 beat。
META_QUOTES = {
    "不追溯重配", "重定步速", "交付侧", "排布类", "补写类", "前移", "取舍", "载体转换",
    "合理", "基本合理但需打磨", "存在结构性问题",
    "OS名", "名OS",
    "市长", "警察", "总裁", "警官", "董事长",
    "发光", "特效", "粒子", "能量波", "光束", "光柱",
    "晕染", "翻涌", "渗透", "交融",
    "朱红", "青绿", "靛蓝",
    "氛围beat", "数字轴以机检为准",
}


def clean_text(text: str) -> str:
    """去标点/空白,只留文字与数字。"""
    return CLEAN_RE.sub("", text)


def evidence_field(line: str) -> str:
    """问题清单行的佐证引文字段(第 3 个分隔段);字段不可辨时回退整行(从严核验)。
    分隔符=单个「—」;引文内的破折号「——」是内容不切分(否则括号被劈开致误判缺引文)。"""
    parts = [p.strip() for p in re.split(r"(?<!—)—(?!—)", line)]
    # 1113 审计#5 修:问题描述自带单破折号动作链(坐起—套褂—…)时 parts[2] 落在
    # 无引号碎片上,原样返回→误报「缺「」引文」(17/485 章中招);字段无「」即视为
    # 不可辨,回退整行从严核验(引文在行内则被整行核到,真缺引文整行也无「」照报)
    if len(parts) >= 4 and "「" in parts[2]:
        return parts[2]
    return line


def extract_quotes(md_text: str):
    """抽取证据槽位引文,返回 (quotes, no_evidence_lines)。
    quotes=问题清单行佐证字段 + 亮点节的「」引文(去重保序);
    问题分析/修改方向/优化建议/评分表中的「」是模型自述语(概括/提案),不属证据,不抽取;
    no_evidence_lines=佐证字段无任何「」引文的问题行(无效条目,计入失败防泛泛而谈)。"""
    quotes = []
    seen = set()
    no_evidence = []
    section = ""
    for line in md_text.splitlines():
        s = line.strip()
        if s.startswith("## "):
            section = s
            continue
        if PROB_LINE_RE.match(line):
            field = evidence_field(line)
            found = False
            for m in BRACKET_RE.finditer(field):
                q = m.group(1).strip()
                cq = clean_text(q)
                if not cq:
                    continue
                found = True
                if cq not in seen:
                    seen.add(cq)
                    quotes.append(q)
            if not found:
                no_evidence.append(line[:60])
        elif section.startswith("## 亮点"):
            for m in BRACKET_RE.finditer(line):
                q = m.group(1).strip()
                cq = clean_text(q)
                if cq and cq not in seen:
                    seen.add(cq)
                    quotes.append(q)
    return quotes, no_evidence


def quote_matches(quote: str, variants: list) -> bool:
    """单条引文判定:整条逐字命中,或为省略号拼接式——按 …… 切段后每一段都必须逐字命中
    (任一变体命中即可;变体=原文直配 + 剥离行首说话人标签,覆盖对白按标签断行的连引)。
    逐段核验保留防幻觉性质:任何一段编造/转述即整条判失败。"""
    if clean_text(quote) in META_QUOTES:
        return True
    frags = [c for c in (clean_text(x) for x in GAP_RE.split(quote)) if c]
    if not frags:
        return False
    return all(any(f in v for v in variants) for f in frags)


def check_chapter(md_text: str, original_text: str, threshold: float) -> dict:
    variants = [
        clean_text(original_text),
        clean_text(LINE_TAG_RE.sub("", original_text)),  # 剥离「名(语气):」类行首标签后再配
    ]
    quotes, no_evidence = extract_quotes(md_text)
    matched = 0
    failures = []
    for q in quotes:
        if quote_matches(q, variants):
            matched += 1
        else:
            failures.append(q)
    failures.extend(f"问题行佐证字段缺「」引文: {p}" for p in no_evidence)
    total = len(quotes) + len(no_evidence)
    rate = round(matched / total * 100, 1) if total else 0.0
    return {
        "total": total,
        "matched": matched,
        "rate": rate,
        "clean": bool(total > 0 and rate >= threshold),
        "failures": failures,
    }


def read_text_strict(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError as e:
        raise RuntimeError(f"读取失败 {path}: {e}")
    except UnicodeDecodeError as e:
        raise RuntimeError(f"编码非法(非 UTF-8){path}: {e}")


def main() -> int:
    ap = argparse.ArgumentParser(description="引文回查器:校验评判报告引文逐字出自原章,回填 index.tsv citeRate")
    ap.add_argument("out_root", help="批量产出根目录(含 reports/ 与 index.tsv)")
    ap.add_argument("--drama", default=DEFAULT_DRAMA, help=f"原章剧本目录(默认 {DEFAULT_DRAMA})")
    ap.add_argument("--threshold", type=float, default=98.0, help="单章引文真实率阈值%%(默认 98,低于即 exit 1)")
    args = ap.parse_args()

    reports_dir = os.path.join(args.out_root, "reports")
    if not os.path.isdir(reports_dir):
        print(f"错误:报告目录不存在 {reports_dir}(先跑 screenplay_critic.py --batch)", file=sys.stderr)
        return 2
    if not os.path.isdir(args.drama):
        print(f"错误:剧本目录不存在 {args.drama}", file=sys.stderr)
        return 2
    index_path = os.path.join(args.out_root, "index.tsv")
    if not os.path.isfile(index_path):
        print(f"错误:index.tsv 不存在 {index_path}(先跑 screenplay_critic.py --batch)", file=sys.stderr)
        return 2
    try:
        index_rows = load_index(index_path)
    except RuntimeError as e:
        print(f"错误:{e}", file=sys.stderr)
        return 2

    eps = []
    for name in os.listdir(reports_dir):
        m = REPORT_MD_RE.match(name)
        if m:
            eps.append((int(m.group(1)), name))
    if not eps:
        print(f"错误:{reports_dir} 下无 chapter-NNN.md 报告", file=sys.stderr)
        return 2
    eps.sort()

    try:
        print(f"[citation-check] out-root={os.path.abspath(args.out_root)} 剧本目录={os.path.abspath(args.drama)}",
              file=sys.stderr)
        pass_n = fail_n = 0
        rates = []
        for ep, name in eps:
            if ep not in index_rows:
                raise RuntimeError(f"EP{ep:03d} 有报告但 index.tsv 无对应行")
            src_name = f"chapter-{ep:03d}_漫剧.md"
            src_path = os.path.join(args.drama, src_name)
            if not os.path.isfile(src_path):
                raise RuntimeError(f"原章文件不存在 {src_path}")
            md_path = os.path.join(reports_dir, name)
            md_text = read_text_strict(md_path)
            if not md_text.strip():
                raise RuntimeError(f"报告为空 {md_path}")
            result = check_chapter(md_text, read_text_strict(src_path), args.threshold)
            cite = {
                "ep": ep, "md": name, "original": src_name,
                "total": result["total"], "matched": result["matched"],
                "rate": result["rate"], "threshold": args.threshold,
                "clean": result["clean"], "failures": result["failures"],
                "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            tmp = os.path.join(reports_dir, f"chapter-{ep:03d}.cite.json.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(cite, f, ensure_ascii=False, indent=2)
            os.replace(tmp, os.path.join(reports_dir, f"chapter-{ep:03d}.cite.json"))

            index_rows[ep][COL_CITERATE] = f"{result['rate']:.1f}"  # 回填 citeRate 列
            rates.append((ep, result["rate"], result["total"], result["matched"]))
            if result["clean"]:
                pass_n += 1
            else:
                fail_n += 1
            line = f"EP{ep:03d} 引文率 {result['rate']:.1f}%({result['matched']}/{result['total']}) clean={result['clean']}"
            if result["failures"]:
                line += " 失败引文示例:" + " | ".join(f[:40] for f in result["failures"][:3])
            print(line)
    except RuntimeError as e:
        print(f"错误:{e}(非法输入,严格停发)", file=sys.stderr)
        return 2

    write_index(index_path, index_rows)
    avg = round(sum(r for _, r, _, _ in rates) / len(rates), 1)
    print(f"CITATION-SUMMARY chapters={len(rates)} pass={pass_n} fail={fail_n} avg={avg:.1f}% "
          f"(阈值 {args.threshold:g}%,index.tsv citeRate 已回填)")
    return 0 if fail_n == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
