#!/usr/bin/env python3
"""scripts 目录卫生 lint——顶层禁带日期文件名(铁律5 机器化)。

出处:2026-09-28 任务 09-28-process-formalization S4-4a(R5.1);双口径正则承
2026-09-22 清整战役 repo_dated_artifacts_reorg.py 的 DATE_RE(MMDD 式 + YYYYMMDD 式),
月份窗由战役回看窗 08-12 放宽为全月 01-12(常驻 lint 不再限定 2026 下半年存量)。

口径:
  - 扫描范围 = apps/build/scripts/ **顶层文件**(子目录不扫:campaigns/ 为归档区,
    日期名合法;__pycache__/.zcode 同理不入口径);
  - 日期模式(对去扩展名 stem 匹配,日期后不得再跟数字):
      MMDD 式    [-_](0[1-9]|1[0-2])[0-9]{2}(?![0-9])   例 _0923 / -0924
      YYYYMMDD 式 [-_]202[0-9]{5}(?![0-9])               例 _20260920
    注:四位数恰落 01-12 月形(如 _1234)会命中——常驻脚本名带此类数字串同样
    该改名,宁报不漏;五位数(端口号 _17002 等)不命中;
  - gitignored 件不入口径(承战役注释「gitignored 件不在 git 口径内」,如
    build_mac_tail_0919.log);git 不可用时保守视为未忽略(照报);
  - 豁免 = scripts-hygiene-exemptions.json(逐件理由,房子模式沿
    file-size-gate-exemptions.json;差异:exempt 为 {文件名: 理由} 以承载逐件理由)。

用法:
  python3 scripts_hygiene.py             # 扫现库,命中 RED 退出 1
  python3 scripts_hygiene.py --json      # 机器可读输出
  python3 scripts_hygiene.py --selftest  # 内嵌红绿自测(临时目录夹具,不碰现库)
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
EXEMPT_JSON = SCRIPTS_DIR / "scripts-hygiene-exemptions.json"

# 双口径:MMDD 式(全月)+ YYYYMMDD 式;对 stem 匹配,日期后不得再跟数字。
DATE_MMDD = r"[-_](0[1-9]|1[0-2])[0-9]{2}(?![0-9])"
DATE_YMD = r"[-_]202[0-9]{5}(?![0-9])"
DATE_RE = re.compile(DATE_MMDD + "|" + DATE_YMD)


def is_gitignored(path: Path) -> bool:
    """git check-ignore 判定;git 不可用/非 git 环境保守返回 False(照报不漏)。"""
    try:
        r = subprocess.run(
            ["git", "-C", str(path.parent), "check-ignore", "-q", str(path)],
            capture_output=True, text=True, timeout=10,
        )
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def load_exemptions(exempt_json: Path = EXEMPT_JSON) -> dict[str, str]:
    if not exempt_json.exists():
        return {}
    data = json.loads(exempt_json.read_text(encoding="utf-8"))
    exempt = data.get("exempt", {})
    return {k: v for k, v in exempt.items()} if isinstance(exempt, dict) else {}


def scan(directory: Path = SCRIPTS_DIR,
         exemptions: dict[str, str] | None = None,
         ignore_check=None) -> list[dict]:
    """扫描目录顶层文件,返回命中(带日期名且未豁免)清单。

    ignore_check: 可注入的 gitignored 判定(自测用;默认 is_gitignored)。
    """
    exemptions = exemptions if exemptions is not None else load_exemptions()
    ignore_check = ignore_check or is_gitignored
    hits: list[dict] = []
    if not directory.exists():
        return [{"file": "<目录不存在>", "pattern": "", "reason": str(directory)}]
    for entry in sorted(directory.iterdir()):
        if not entry.is_file():
            continue  # 子目录不扫(campaigns/ 归档区日期名合法)
        if DATE_RE.search(entry.stem):
            if entry.name in exemptions:
                continue
            if ignore_check(entry):
                continue
            hit_pattern = "YYYYMMDD" if re.search(DATE_YMD, entry.stem) else "MMDD"
            hits.append({"file": entry.name, "pattern": hit_pattern})
    return hits


def _selftest() -> int:
    failures: list[str] = []

    def expect(cond: bool, label: str) -> None:
        print(("PASS" if cond else "FAIL"), "-", label)
        if not cond:
            failures.append(label)

    with tempfile.TemporaryDirectory(prefix="scripts-hygiene-selftest-") as td:
        root = Path(td)
        (root / "resident_tool.py").write_text("# 常驻稳定名\n", encoding="utf-8")
        (root / "dated_0928.py").write_text("# 假件:MMDD 尾缀\n", encoding="utf-8")
        (root / "dated-20260928.py").write_text("# 假件:YYYYMMDD\n", encoding="utf-8")
        (root / "exempted_0928.py").write_text("# 豁免件\n", encoding="utf-8")
        (root / "ignored_0928.py").write_text("# gitignored 件\n", encoding="utf-8")
        (root / "campaigns").mkdir()
        (root / "campaigns" / "archived_0916.py").write_text("# 归档件\n", encoding="utf-8")
        (root / "port_17002.py").write_text("# 五位端口数不命中\n", encoding="utf-8")

        hits = scan(root,
                    exemptions={"exempted_0928.py": "自测豁免"},
                    ignore_check=lambda p: p.name == "ignored_0928.py")
        names = {h["file"] for h in hits}
        expect(names == {"dated_0928.py", "dated-20260928.py"},
               f"命中恰为两假件(campaigns 豁免/豁免清单/ignored/端口数均不红): {sorted(names)}")
        patterns = {h["file"]: h["pattern"] for h in hits}
        expect(patterns.get("dated_0928.py") == "MMDD", "MMDD 口径标注正确")
        expect(patterns.get("dated-20260928.py") == "YYYYMMDD", "YYYYMMDD 口径标注正确")

    # 正则单元口径(直接锚定双口径边界,防回归)
    expect(bool(DATE_RE.search("qi21_daojie_t2i_0923")), "战役存量形 _0923 命中")
    expect(bool(DATE_RE.search("daojie_hands_evidence_20260920")), "YYYYMMDD 存量形命中")
    expect(not DATE_RE.search("qi21_install_accept_17002"), "纯五位数(17002)不命中")
    expect(not DATE_RE.search("manying_workflow_library_reorg"), "常驻稳定名不命中")
    expect(not DATE_RE.search("x_09234"), "日期后跟数字(五连数)不命中")

    print(f"selftest: {len(failures)} failure(s)")
    return 1 if failures else 0


def main(argv: list[str]) -> int:
    if "--selftest" in argv:
        return _selftest()
    hits = scan()
    as_json = "--json" in argv
    if as_json:
        print(json.dumps({"ok": not hits, "hits": hits,
                          "exempt_count": len(load_exemptions())},
                         ensure_ascii=False, indent=1))
    else:
        print("口径:apps/build/scripts/ 顶层文件名禁带日期(MMDD/YYYYMMDD 双口径,"
              "承 09-22 清整战役;campaigns/ 归档区与 gitignored 件不入口径)")
        if hits:
            print(f"\nRED({len(hits)} 个,须改名或登记豁免 scripts-hygiene-exemptions.json):")
            for h in hits:
                print(f"  [{h['pattern']}]  {h['file']}")
        else:
            print("现库绿:顶层零日期名命中。")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
