#!/usr/bin/env python3
"""台账核账巡检 lint——铁律5「活文档头部维护 最后核账:YYYY-MM-DD」机器化。

出处:2026-09-28 任务 09-28-process-formalization S4-4b(R7.2/research/04 证据B:
字段已在 8+ 文档但无人校验,滞后事故多起)。

口径:
  - 扫描范围 = docs/**/*.md,文件名含「台账」或「清单」者(台账类活文档判据);
  - 「头部」= 文件前 20 行内出现 `最后核账` 字段行(先例:LoRA库存台账/插件链
    故障台账均为第 2 行);冒号全半角兼容(: 或 :);
  - 三态:
      RED  头部缺「最后核账」字段(拦门);
      RED  字段在但日期不可解析——值中找不到 YYYY-MM-DD 或非真实日历日(拦门);
      WARN 距今 > 90 天(报表不拦门——核账节奏是战役驱动,不搞机械期限);
  - 豁免 = docs-freshness-exemptions.json(逐件理由,房子模式沿
    file-size-gate;exempt 为 {仓库相对路径: 理由}),豁免件整件跳过三态;
  - 补字段纪律:登记日期=真核账动作发生日,禁止无脑补当天(任务档 4b 明令)。

用法:
  python3 docs_freshness_lint.py             # 扫现库,RED 退出 1
  python3 docs_freshness_lint.py --json      # 报告落 apps/output/automation/docs-freshness-report.json
  python3 docs_freshness_lint.py --selftest  # 内嵌红绿自测(临时目录夹具,不碰现库)
"""
from __future__ import annotations

import json
import re
import sys
import tempfile
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs"
EXEMPT_JSON = Path(__file__).resolve().parent / "docs-freshness-exemptions.json"
REPORT_JSON = REPO / "apps/output/automation/docs-freshness-report.json"

NAME_RE = re.compile(r"台账|清单")
FIELD_RE = re.compile(r"^最后核账[::]\s*(.+)$", re.MULTILINE)
DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
HEADER_LINES = 20
STALE_DAYS = 90


def parse_field(text: str) -> str | None:
    """从文本头部(前 20 行)取最后核账字段值;缺字段返回 None。"""
    header = "\n".join(text.splitlines()[:HEADER_LINES])
    m = FIELD_RE.search(header)
    return m.group(1).strip() if m else None


def parse_ledger_date(value: str) -> date | None:
    """字段值 → 日历日;找不到 YYYY-MM-DD 或非真实日历日返回 None。"""
    m = DATE_RE.search(value)
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def load_exemptions() -> dict[str, str]:
    if not EXEMPT_JSON.exists():
        return {}
    data = json.loads(EXEMPT_JSON.read_text(encoding="utf-8"))
    exempt = data.get("exempt", {})
    return {k: v for k, v in exempt.items()} if isinstance(exempt, dict) else {}


def check_doc(path: Path, today: date, rel: str) -> dict:
    """单件三态检查。status ∈ pass / RED-missing / RED-unparseable / WARN-stale。"""
    text = path.read_text(encoding="utf-8", errors="replace")
    value = parse_field(text)
    if value is None:
        return {"file": rel, "status": "RED-missing",
                "detail": f"头部前 {HEADER_LINES} 行缺「最后核账」字段"}
    ledger_date = parse_ledger_date(value)
    if ledger_date is None:
        return {"file": rel, "status": "RED-unparseable",
                "detail": f"日期不可解析:字段值={value!r}"}
    age = (today - ledger_date).days
    if age > STALE_DAYS:
        return {"file": rel, "status": "WARN-stale",
                "detail": f"最后核账 {ledger_date.isoformat()} 距今 {age} 天(> {STALE_DAYS})"}
    return {"file": rel, "status": "pass",
            "detail": f"最后核账 {ledger_date.isoformat()} 距今 {age} 天"}


def scan(docs_root: Path = DOCS, today: date | None = None,
         exemptions: dict[str, str] | None = None) -> list[dict]:
    today = today or date.today()
    exemptions = exemptions if exemptions is not None else load_exemptions()
    rows: list[dict] = []
    if not docs_root.exists():
        return [{"file": "<docs 不存在>", "status": "RED-missing", "detail": str(docs_root)}]
    for path in sorted(docs_root.rglob("*.md")):
        if not NAME_RE.search(path.name):
            continue
        # rel 锚 = docs_root 的上级(真源运行时=仓库根,自测夹具=夹具根),豁免键同口径
        rel = path.relative_to(docs_root.parent).as_posix()
        if rel in exemptions:
            rows.append({"file": rel, "status": "exempt",
                         "detail": exemptions[rel]})
            continue
        rows.append(check_doc(path, today, rel))
    return rows


def summarize(rows: list[dict]) -> dict:
    red = [r for r in rows if r["status"].startswith("RED-")]
    warn = [r for r in rows if r["status"] == "WARN-stale"]
    return {"ok": not red, "total": len(rows), "red": len(red), "warn": len(warn),
            "rows": rows}


def _selftest() -> int:
    failures: list[str] = []

    def expect(cond: bool, label: str) -> None:
        print(("PASS" if cond else "FAIL"), "-", label)
        if not cond:
            failures.append(label)

    today = date(2026, 9, 28)
    with tempfile.TemporaryDirectory(prefix="docs-freshness-selftest-") as td:
        # 夹具根带 docs/ 结构,使 rel 路径可对照豁免键(豁免键=夹具内相对路径)
        root = Path(td)
        docs = root / "docs"
        docs.mkdir()
        (docs / "新台账.md").write_text(
            "# 新台账\n最后核账:2026-09-22\n\n正文\n", encoding="utf-8")
        (docs / "旧台账.md").write_text(
            "# 旧台账\n最后核账:2026-06-01\n\n正文\n", encoding="utf-8")
        (docs / "缺字段清单.md").write_text("# 缺字段清单\n\n正文\n", encoding="utf-8")
        (docs / "坏日期台账.md").write_text(
            "# 坏日期台账\n最后核账:2026-13-45\n", encoding="utf-8")
        (docs / "豁免台账.md").write_text(
            "# 豁免台账(刻意静态,不维护字段)\n", encoding="utf-8")
        (docs / "无关.md").write_text("# 无关文档不入口径\n", encoding="utf-8")
        # 深埋字段(第 21 行)= 头部外,按缺字段 RED
        (docs / "深埋台账.md").write_text(
            "# 深埋台账\n" + "\n" * 19 + "最后核账:2026-09-22\n", encoding="utf-8")

        rows = scan(docs, today=today,
                    exemptions={"docs/豁免台账.md": "自测豁免:刻意静态件"})
        by = {r["file"]: r["status"] for r in rows}
        expect(by.get("docs/新台账.md") == "pass", "新台账(6 天前)pass")
        expect(by.get("docs/旧台账.md") == "WARN-stale", "旧台账(>90 天)WARN 不拦门")
        expect(by.get("docs/缺字段清单.md") == "RED-missing", "缺字段清单 RED")
        expect(by.get("docs/坏日期台账.md") == "RED-unparseable", "日历日不可解析 RED")
        expect(by.get("docs/豁免台账.md") == "exempt", "豁免件整件跳过")
        expect("docs/无关.md" not in by, "文件名不含台账|清单者不入口径")
        expect(by.get("docs/深埋台账.md") == "RED-missing", "字段埋在第 21 行=头部外 RED")
        s = summarize(rows)
        expect(s["red"] == 3 and s["warn"] == 1 and s["ok"] is False,
               f"汇总正确(red=3/warn=1/ok=False): {s['red']}/{s['warn']}/{s['ok']}")

    # 冒号全半角兼容 + 值带括号备注仍可取日
    expect(parse_ledger_date("2026-09-22(核账动作=placement audit 全绿)") is not None,
           "值带备注括号仍解析日期")
    expect(parse_field("最后核账:2026-09-22\n") == "2026-09-22", "全角冒号兼容")
    expect(parse_ledger_date("09-22") is None, "非 YYYY-MM-DD 不解析")

    print(f"selftest: {len(failures)} failure(s)")
    return 1 if failures else 0


def main(argv: list[str]) -> int:
    if "--selftest" in argv:
        return _selftest()
    rows = scan()
    summary = summarize(rows)
    as_json = "--json" in argv
    if as_json:
        REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
        REPORT_JSON.write_text(
            json.dumps({"generatedAt": datetime.now().isoformat(), **summary},
                       ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"报告落 {REPORT_JSON.relative_to(REPO).as_posix()}")
    print("口径:docs/** 文件名含「台账|清单」者须头部维护 最后核账:YYYY-MM-DD"
          "(缺字段/日期不可解析=RED;>90 天=WARN 报表不拦门;豁免见 docs-freshness-exemptions.json)")
    for r in rows:
        print(f"  [{r['status']:>16s}]  {r['file']}  — {r['detail']}")
    print(f"合计 {summary['total']} 件:red={summary['red']} warn={summary['warn']}")
    return 1 if not summary["ok"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
