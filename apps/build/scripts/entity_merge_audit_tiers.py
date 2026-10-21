#!/usr/bin/env python3
"""S3 审计收尾 R1:对 entity_merge_audit.py 的疑似重复对 CSV 做三档分层(后处理,不改审计本体)。

S/M/L 仅为复核优先级,不是身份置信度;字符串信号和共现不能证明同一身份。
分层规则(阈值保持不变):
  S 高优先级: 命中规则含「别名互含」,或 (含「名称包含」且 共现章数>=3),或 (含「编辑距离≤1」且 共现章数>=3)
            → 出人工复核清单(MD+CSV,原始A/B记录保持独立)
  M 中优先级: 非 S 且 [(含「编辑距离≤1」且 共现章数>=1) 或 (含「同首字」且 共现章数>=3)]
            → 按 类别(kind) 分组各抽 20 对样本
  L 低优先级: 其余 → 只出统计(总数+按规则分布+形态标记),不作身份裁定

输入:  CSV 列 = 类别,实体A,A别名,A首章,A章数,实体B,B别名,B首章,B章数,命中规则,共现章数 (utf-8-sig)
输出:  <out_dir>/entity-merge-audit-{high.md,high.csv,medium.md,summary.md,full.csv}

只读生产 CSV;产物仅写 out_dir。用法:
  python3 entity_merge_audit_tiers.py --csv /tmp/grill-s3-test/entity-merge-audit.csv \
      --out-dir .trellis/tasks/10-20-s3-audit-closeout/research
"""
import argparse
import csv
import json
import os
import re
import shutil
import stat
import sys
from collections import Counter, defaultdict

FIELDS = ["类别", "实体A", "A别名", "A首章", "A章数", "实体B", "B别名", "B首章", "B章数", "命中规则", "共现章数"]
SEMANTICS = "review_priority_only"
REVIEW_NOTICE = (
    "S/M/L 仅表示复核优先级，不表示身份置信度；字符串信号和共现不能证明同一身份；"
    "没有独立身份依据时，实体A/B记录保持独立。"
)

R_ALIAS = "别名互含"
R_CONTAIN = "名称包含"
R_EDIT = "编辑距离≤1"
R_HEAD = "同首字"  # 原标签为「同首字+共现≥3章」,规则自带共现>=3 门槛;分层仍按共现列实值判

PAREN_RE = re.compile(r"[（）()]")
OS_RE = re.compile(r"OS$")


def parse_int(s: str) -> int:
    try:
        return int(str(s).strip())
    except (TypeError, ValueError):
        return 0


def rule_has(rule: str, token: str) -> bool:
    return token in rule


def classify(row: dict, cooc: int) -> str:
    """返回 'S' / 'M' / 'L'(S 优先,其次 M,L 兜底)。"""
    rule = row["命中规则"]
    if rule_has(rule, R_ALIAS):
        return "S"
    if rule_has(rule, R_CONTAIN) and cooc >= 3:
        return "S"
    if rule_has(rule, R_EDIT) and cooc >= 3:
        return "S"
    if rule_has(rule, R_EDIT) and cooc >= 1:
        return "M"
    if rule_has(rule, R_HEAD) and cooc >= 3:
        return "M"
    return "L"


def split_aliases(s: str) -> list:
    if not s or s.strip() == "-":
        return []
    return [p for p in (x.strip() for x in s.split("/")) if p]


def pick_keep(row: dict) -> tuple:
    """决定保留实体。依据: 章数多者胜 → 名长(信息量大)者胜 → 无噪声形(括号/OS)者胜 → 字典序(确定性)。"""
    a_name, b_name = row["实体A"].strip(), row["实体B"].strip()
    a_n, b_n = parse_int(row["A章数"]), parse_int(row["B章数"])

    def noise(name: str) -> bool:
        return bool(PAREN_RE.search(name) or OS_RE.search(name))

    keys = [
        (a_n, len(a_name), 0 if noise(a_name) else 1, a_name),
        (b_n, len(b_name), 0 if noise(b_name) else 1, b_name),
    ]
    # max 按 (章数, 名长, 干净, 名) —— 字典序取大保确定性并列时也可复现
    keep_a = keys[0] > keys[1]
    if keep_a:
        return ("A", a_name, b_name, split_aliases(row["A别名"]), split_aliases(row["B别名"]), a_n, b_n)
    return ("B", b_name, a_name, split_aliases(row["B别名"]), split_aliases(row["A别名"]), b_n, a_n)


def build_reason(row: dict, cooc: int) -> str:
    rule = row["命中规则"]
    parts = []
    if rule_has(rule, R_ALIAS):
        parts.append("别名互含(可能来自别名污染或提取错误,需回查来源)")
    if rule_has(rule, R_CONTAIN):
        name_a, name_b = row["实体A"].strip(), row["实体B"].strip()
        if name_a in name_b:
            parts.append(f"名称包含(「{name_b}」含「{name_a}」,需排查亲属称谓等关系)")
        elif name_b in name_a:
            parts.append(f"名称包含(「{name_a}」含「{name_b}」,需排查亲属称谓等关系)")
        else:
            parts.append("名称包含(别名面包含)")
    if rule_has(rule, R_EDIT):
        parts.append("编辑距离≤1(仅表示字符相近,需核对原文和独立身份依据)")
    if rule_has(rule, R_HEAD):
        parts.append("同首字(仅名称首字相同)")
    return ";".join(parts + [f"共现 {cooc} 章(仅反映共同出场)", REVIEW_NOTICE])


def noise_flags(row: dict) -> list:
    flags = []
    names = [row["实体A"].strip(), row["实体B"].strip()]
    if any(PAREN_RE.search(n) for n in names):
        flags.append("含括号(提取噪声)")
    if any(OS_RE.search(n) for n in names):
        flags.append("OS 结尾(视角标注混入)")
    if any(len(n) <= 1 for n in names):
        flags.append("单字名")
    return flags


def md_escape(s: str) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def copy_full_csv(source: str, destination: os.PathLike[str]) -> None:
    """保留输入别名免写,其他目标仅经已校验的普通单链接句柄复制。"""
    with open(source, "rb") as input_stream:
        source_info = os.fstat(input_stream.fileno())
        try:
            existing_info = os.lstat(destination)
        except FileNotFoundError:
            existing_info = None
        if existing_info is not None:
            alias_info = existing_info
            if stat.S_ISLNK(existing_info.st_mode):
                try:
                    alias_info = os.stat(destination)
                except FileNotFoundError:
                    pass
            if os.path.samestat(source_info, alias_info):
                return
            if stat.S_ISLNK(existing_info.st_mode):
                raise ValueError("拒绝非输入文件的符号链接(含悬挂链接)")
            if not stat.S_ISREG(existing_info.st_mode) or existing_info.st_nlink != 1:
                raise ValueError("目标必须是普通单链接文件,拒绝多硬链接或非普通文件")
        flags = os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        if existing_info is None:
            flags |= os.O_CREAT | os.O_EXCL
        with os.fdopen(os.open(destination, flags, 0o666), "wb") as output_stream:
            destination_info = os.fstat(output_stream.fileno())
            if os.path.samestat(source_info, destination_info):
                return
            if not stat.S_ISREG(destination_info.st_mode) or destination_info.st_nlink != 1:
                raise ValueError("目标句柄必须是普通单链接文件,拒绝写入")
            if existing_info is not None and not os.path.samestat(existing_info, destination_info):
                raise ValueError("目标在校验期间发生变化,拒绝写入")
            output_stream.truncate(0)
            shutil.copyfileobj(input_stream, output_stream)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", required=True, help="审计输出 CSV(utf-8-sig)")
    ap.add_argument("--out-dir", required=True, help="产物目录")
    ap.add_argument("--sample-per-kind", type=int, default=20, help="M 档每 kind 抽样对数(默认 20)")
    ap.add_argument("--stats-json", default="", help="可选:额外落一份数据统计 JSON")
    args = ap.parse_args()

    rows, tiers = [], {"S": [], "M": [], "L": []}
    rule_counter = {"S": Counter(), "M": Counter(), "L": Counter()}
    kind_counter = {"S": Counter(), "M": Counter(), "L": Counter()}
    cooc_buckets = {"S": Counter(), "M": Counter(), "L": Counter()}
    noise_counter = Counter()
    label_head_mismatch = 0  # 标签含 同首字+共现≥3 但共现实值 <3 的行数(核账用)

    with open(args.csv, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != FIELDS:
            print(f"FATAL: 表头不符 {reader.fieldnames}", file=sys.stderr)
            return 2
        for row in reader:
            cooc = parse_int(row["共现章数"])
            if rule_has(row["命中规则"], R_HEAD) and cooc < 3:
                label_head_mismatch += 1
            t = classify(row, cooc)
            rows.append((row, cooc, t))
            tiers[t].append((row, cooc))
            rule_counter[t][row["命中规则"]] += 1
            kind_counter[t][row["类别"]] += 1
            cooc_buckets[t]["=0" if cooc == 0 else ("1-2" if cooc < 3 else ">=3")] += 1
            if t == "L":
                fl = noise_flags(row)
                noise_counter[";".join(fl) if fl else "无显性噪声标记(仅弱规则/零共现)"] += 1

    total = len(rows)
    if total == 0:
        print("FATAL: 零数据行", file=sys.stderr)
        return 2

    from pathlib import Path

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    full_csv = out / "entity-merge-audit-full.csv"
    try:
        copy_full_csv(args.csv, full_csv)
    except (OSError, ValueError) as error:
        print(f"FATAL: full CSV 输出被拒绝或复制失败 {full_csv}: {error}", file=sys.stderr)
        return 2

    # ---------- S 档: 人工复核清单 ----------
    s_rows = sorted(tiers["S"], key=lambda rc: (-rc[1], rc[0]["类别"], rc[0]["实体A"], rc[0]["实体B"]))
    high_csv = out / "entity-merge-audit-high.csv"
    with open(high_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(FIELDS + ["复核原因"])
        for row, cooc in s_rows:
            w.writerow([row[field] for field in FIELDS] + [build_reason(row, cooc)])

    high_md = out / "entity-merge-audit-high.md"
    with open(high_md, "w", encoding="utf-8") as f:
        f.write("# S 档·高复核优先级——人工复核清单\n\n")
        f.write(f"- {REVIEW_NOTICE}\n")
        f.write(f"- 源: `{args.csv}`(全量 {total:,} 对,三档分层见 summary)\n")
        f.write("- 排序规则: 命中规则含「别名互含」;或 (名称包含 且 共现≥3);或 (编辑距离≤1 且 共现≥3)\n")
        f.write(f"- 本档 **{len(s_rows)} 对**;配套机读 CSV: `entity-merge-audit-high.csv`\n")
        f.write("- 别名互含可能来自别名污染或提取错误，必须回查原文；别名表本身不是独立身份依据。\n")
        f.write("- 名称包含可能来自亲属称谓(如母子)，亲属关系不是同一身份；不能用亲属替代本人。\n")
        f.write("- 同首字、字符相近与共同出场只触发复核；共现也可能发生在不同人物之间。章数、名长不决定身份。\n\n")
        f.write("| # | " + " | ".join(FIELDS + ["复核原因"]) + " |\n")
        f.write("|" + "---|" * (len(FIELDS) + 2) + "\n")
        for i, (row, cooc) in enumerate(s_rows, 1):
            values = [str(i)] + [row[field] for field in FIELDS] + [build_reason(row, cooc)]
            f.write("| " + " | ".join(md_escape(value) for value in values) + " |\n")

    # ---------- M 档: 抽检样本 ----------
    med_md = out / "entity-merge-audit-medium.md"
    with open(med_md, "w", encoding="utf-8") as f:
        f.write("# M 档·中复核优先级——人工抽检样本\n\n")
        f.write(f"- {REVIEW_NOTICE}\n")
        f.write("- 排序规则: 非 S 且 [(编辑距离≤1 且 共现≥1);或 (同首字 且 共现≥3)]\n")
        f.write(f"- 本档 **{len(tiers['M'])} 对**(kind 分布: " +
                ", ".join(f"{k}={v}" for k, v in sorted(kind_counter['M'].items())) + ")\n")
        f.write(f"- 抽样方法: 每 kind 按(共现章数降序, 实体A, 实体B)排序取前 {args.sample_per_kind} 对(确定性抽样,非随机)\n")
        f.write(f"- 深查入口: 全量对在 `entity-merge-audit-full.csv`(本目录);S 档见 `entity-merge-audit-high.md`\n\n")
        for kind in sorted(kind_counter["M"]):
            pool = [rc for rc in tiers["M"] if rc[0]["类别"] == kind]
            pool.sort(key=lambda rc: (-rc[1], rc[0]["实体A"], rc[0]["实体B"]))
            sample = pool[: args.sample_per_kind]
            f.write(f"## {kind}({kind_counter['M'][kind]} 对,抽样 {len(sample)} 对)\n\n")
            f.write("| # | 实体A | A别名 | A首章 | A章数 | 实体B | B别名 | B首章 | B章数 | 命中规则 | 共现章数 |\n")
            f.write("|---|---|---|---|---|---|---|---|---|---|---|\n")
            for i, (row, cooc) in enumerate(sample, 1):
                f.write(f"| {i} | {md_escape(row['实体A'])} | {md_escape(row['A别名'])} | {md_escape(row['A首章'])} | "
                        f"{md_escape(row['A章数'])} | {md_escape(row['实体B'])} | {md_escape(row['B别名'])} | "
                        f"{md_escape(row['B首章'])} | {md_escape(row['B章数'])} | {md_escape(row['命中规则'])} | {cooc} |\n")
            f.write("\n")

    # ---------- L 档 + 总览 ----------
    sum_md = out / "entity-merge-audit-summary.md"
    with open(sum_md, "w", encoding="utf-8") as f:
        f.write("# 实体审计·三档复核优先级总览(L 档统计)\n\n")
        f.write(f"- {REVIEW_NOTICE}\n")
        f.write(f"- 源 CSV: `{args.csv}`;全量副本: `entity-merge-audit-full.csv`\n")
        f.write(f"- 总对数 **{total:,}**;分层: S={len(tiers['S']):,} / M={len(tiers['M']):,} / L={len(tiers['L']):,}"
                f"(S+M+L={len(tiers['S']) + len(tiers['M']) + len(tiers['L']):,},守恒={len(tiers['S']) + len(tiers['M']) + len(tiers['L']) == total})\n\n")
        f.write("## 三档总览\n\n| 档 | 对数 | 占比 | character | scene | prop | 共现=0 | 共现1-2 | 共现≥3 |\n|---|---|---|---|---|---|---|---|---|\n")
        for t, label in (("S", "S 高复核优先级"), ("M", "M 中复核优先级"), ("L", "L 低复核优先级")):
            k = kind_counter[t]
            cb = cooc_buckets[t]
            f.write(f"| {label} | {len(tiers[t]):,} | {len(tiers[t]) / total:.1%} | {k.get('character', 0):,} | "
                    f"{k.get('scene', 0):,} | {k.get('prop', 0):,} | {cb.get('=0', 0):,} | {cb.get('1-2', 0):,} | {cb.get('>=3', 0):,} |\n")
        f.write("\n## L 档·按命中规则分布(复合标签原样)\n\n| 命中规则 | 对数 |\n|---|---|\n")
        for rule, n in rule_counter["L"].most_common():
            f.write(f"| {md_escape(rule)} | {n:,} |\n")
        f.write("\n## L 档·噪声类型分布(按实体名形态标记,一对可命中多标记则按组合计)\n\n| 噪声标记 | 对数 |\n|---|---|\n")
        for flag, n in noise_counter.most_common():
            f.write(f"| {md_escape(flag)} | {n:,} |\n")
        f.write("\n## 复核排序规则(阈值保持不变)\n\n")
        f.write("- S: 别名互含;或 名称包含+共现≥3;或 编辑距离≤1+共现≥3\n")
        f.write("- M(非S): 编辑距离≤1+共现≥1;或 同首字+共现≥3\n")
        f.write("- L: 其余，仅汇总统计；低优先级不等于身份已裁定或无需核验\n\n")
        f.write(f"## 核账备注\n\n- 标签含「同首字+共现≥3章」但共现实值<3 的行: {label_head_mismatch}\n")
        f.write("- L 档仅统计形态标记与共现分布，不据此确认噪声或身份。\n")

    if args.stats_json:
        with open(args.stats_json, "w", encoding="utf-8") as f:
            json.dump({
                "total": total,
                "high": len(tiers["S"]), "medium": len(tiers["M"]), "low": len(tiers["L"]),
                "medium_kind_counts": dict(kind_counter["M"]),
                "high_kind_counts": dict(kind_counter["S"]),
                "low_kind_counts": dict(kind_counter["L"]),
                "label_head_mismatch": label_head_mismatch,
                "semantics": SEMANTICS,
            }, f, ensure_ascii=False, indent=2)

    print(json.dumps({
        "total": total, "S": len(tiers["S"]), "M": len(tiers["M"]), "L": len(tiers["L"]),
        "M_by_kind": dict(kind_counter["M"]),
        "label_head_mismatch": label_head_mismatch,
        "semantics": SEMANTICS,
        "outputs": [str(high_md), str(high_csv), str(med_md), str(sum_md), str(full_csv)],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
