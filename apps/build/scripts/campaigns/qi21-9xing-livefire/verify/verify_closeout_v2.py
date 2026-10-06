#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_closeout_v2.py — qi21-9xing-livefire 九型全量(v2)收账机器校验。

判定清单落盘:verify/verdict-v2.txt(不覆盖 v1 的 verdict.txt——那是六型账的历史件)。

与 v1(verify_closeout.py,六型)的差异:
  - TYPES 扩到九型(7/8/9 为 v2 轮新拍,prompt_id 取自收账任务书);
  - [A] 7/8/9 型另须 sweep 取代存档 .bak 件在(各型记录 §9 载明);
  - [C] runs/*.json + verify/*.json 全量 json.load 之外,另解析三个 .bak(sweep 存档亦须可解析);
  - [D] 校验对象=本报告 v2(九型实弹总报告.md)引用路径全部存在;
  - [E] prompt_id/终态对账扩到九型;
  - [F] 计数口径守卫扩到九型(ok 型 18/18,型8 透明型 19/19;FAIL 型 18/19)。

四查口径(任务书):[A]每型记录文件齐全(含 .md ①②③③′ 四段标题) [B]图片存在且PNG可解析
[C]raw JSON 可解析 [D]总报告 v2 引用路径全部存在;附查 [E]prompt_id·终态对账 [F]计数口径。

用法(引擎 venv,要 PIL):
  /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/venv/bin/python verify/verify_closeout_v2.py
退出码:0=全绿,1=有红。
"""
import glob
import io
import json
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
    print("FATAL: 需要 PIL(用引擎 venv python 跑)")
    sys.exit(2)

CAMP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # verify/ 的上级=战役目录
REPO = os.path.abspath(os.path.join(CAMP, "..", "..", "..", "..", ".."))  # campaigns 上五级=仓库根
REPORT = os.path.join(CAMP, "九型实弹总报告.md")
VERDICT = os.path.join(CAMP, "verify", "verdict-v2.txt")

# (slug, prompt_id[收账任务书给定], sweep_bak[7-9 型有,1-6 型无])
TYPES = [
    ("type-1-人物", "9c4d3719-5d46-4f91-8dac-eac84336f713", None),
    ("type-2-场景", "c1707be8-c301-44d5-b0d7-6411439d04a3", None),
    ("type-3-道具", "fc46aba4-3c78-493b-8bf5-b82e8def7c7a", None),
    ("type-4-美宣", "ad8280e7-62cf-4cd7-81b7-c266f18a1c6a", None),
    ("type-5-多视图", "c972ae02-8ccb-4678-b663-a19b23f70f1f", None),
    ("type-6-高清人脸", "a00b747a-301e-432b-bd15-819538c072b7", None),
    ("type-7-分镜剧情图", "5b05816c-721e-4d65-a894-1a4d75fbf0d1", "runs/type-7-分镜剧情图.history.appcanvas-sweep-1219.bak"),
    ("type-8-表情差分", "fec5c1d6-5ace-4e62-a9c3-35ccb1df382c", "runs/type-8-表情差分.history.appcanvas-sweep-1226.bak"),
    ("type-9-概念气氛图", "aae7ec8e-c170-4617-b2b6-90fcb31fddc2", "runs/type-9-概念气氛图.history.appcanvas-sweep-1233.bak"),
]

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

results = []  # (判, 分组, 条目, 实测)


def rec(ok, group, item, detail=""):
    results.append((ok, group, item, detail))
    return ok


def rel(p):
    return os.path.relpath(p, CAMP)


def check_file_set():
    for slug, _pid, bak in TYPES:
        expect = [
            f"runs/{slug}.md",
            f"runs/{slug}.json",
            f"runs/{slug}.history.json",
            f"verify/{slug}.postcheck.json",
            f"verify/{slug}.png-prompt-metadata.json",
            f"logs/{slug}.image-prompts.excerpt.log",
            f"logs/{slug}.driver.console.log",
            f"images/{slug}.direct.png",
            f"images/{slug}.2k.png",
        ]
        if slug == "type-1-人物":
            expect += [
                "runs/type-1-人物.attempt1-cache-echo.json",
                "runs/type-1-人物.history.attempt1-cache-echo.json",
                "verify/type-1-人物.cache-collision-diff.json",
                "logs/type-1-人物.driver.console.attempt1.log",
            ]
        if bak:
            expect.append(bak)
        missing = [p for p in expect if not (os.path.isfile(os.path.join(CAMP, p)) and os.path.getsize(os.path.join(CAMP, p)) > 0)]
        rec(not missing, "A 记录齐全", slug,
            f"{len(expect)} 件全在" if not missing else "缺/空:" + ",".join(missing))
        # 记录内容完整性:四段提示词标题在
        md = open(os.path.join(CAMP, f"runs/{slug}.md"), encoding="utf-8").read()
        need_heads = ["### ①", "### ②", "### ③", "### ③′"]
        lack = [h for h in need_heads if h not in md]
        rec(not lack, "A 记录齐全", f"{slug} .md 四段提示词标题",
            "①②③③′ 俱在" if not lack else "缺:" + ",".join(lack))


def check_images():
    for slug, _pid, _bak in TYPES:
        for tag, fname in (("direct", f"images/{slug}.direct.png"), ("2k", f"images/{slug}.2k.png")):
            p = os.path.join(CAMP, fname)
            if not os.path.isfile(p):
                rec(False, "B 图片PNG", f"{slug}.{tag}", "文件不存在")
                continue
            size = os.path.getsize(p)
            rec(size > 0, "B 图片PNG", f"{slug}.{tag} 存在且>0B", f"{size}B")
            with open(p, "rb") as f:
                magic = f.read(8)
            rec(magic == PNG_MAGIC, "B 图片PNG", f"{slug}.{tag} PNG魔数", magic.hex())
            try:
                img = Image.open(p)
                img.load()
                rec(img.format == "PNG", "B 图片PNG", f"{slug}.{tag} PIL可解析",
                    f"mode={img.mode} size={img.size[0]}x{img.size[1]}")
            except Exception as e:  # noqa: BLE001
                rec(False, "B 图片PNG", f"{slug}.{tag} PIL可解析", f"EXC {e}")


def check_json():
    files = sorted(glob.glob(os.path.join(CAMP, "runs", "*.json"))) + \
            sorted(glob.glob(os.path.join(CAMP, "verify", "*.json"))) + \
            sorted(glob.glob(os.path.join(CAMP, "runs", "*.bak")))  # 7/8/9 型 sweep 取代存档(JSON 体)
    for p in files:
        try:
            with open(p, encoding="utf-8") as f:
                json.load(f)
            rec(True, "C rawJSON", rel(p), "json.load OK")
        except Exception as e:  # noqa: BLE001
            rec(False, "C rawJSON", rel(p), f"PARSE-FAIL {e}")


def check_report_paths():
    if not os.path.isfile(REPORT):
        rec(False, "D 报告路径", "九型实弹总报告.md", "总报告未落盘")
        return []
    text = open(REPORT, encoding="utf-8").read()
    pat = re.compile(
        r"(?:apps|docs|images|runs|logs|verify)/[A-Za-z0-9_\-\u4e00-\u9fff/\.\-_]+"
        r"|/Users/[A-Za-z0-9_\-\u4e00-\u9fff/\.\-_]+"
        r"|/tmp/[A-Za-z0-9_\-\u4e00-\u9fff/\.\-_]+"
    )
    tokens = []
    for m in pat.finditer(text):
        t = m.group(0).rstrip(".,;:。;:,)")
        seg = t.rstrip("/").rsplit("/", 1)[-1]
        if not (t.endswith("/") or ("." in seg)):
            continue
        if t not in tokens:
            tokens.append(t)
    bad = []
    for t in tokens:
        if os.path.isabs(t):
            target = t
        elif t.startswith("apps/") or t.startswith("docs/"):
            target = os.path.join(REPO, t)
        else:
            target = os.path.join(CAMP, t)
        if not os.path.exists(target):
            bad.append(t)
    rec(not bad, "D 报告路径", f"九型实弹总报告.md(v2) 引用路径({len(tokens)} 个去重 token)",
        "全部存在" if not bad else "不存在:" + ",".join(bad))
    return tokens


def check_counts():
    """[F] 计数口径守卫:报告 v2 中各型后核计数必须与 postcheck.json 实数一致;
    旧误计数「17/18」零残留(1-6 型勘正史);7-9 型计数(18/18、19/19)亦须在报告。"""
    if not os.path.isfile(REPORT):
        return
    text = open(REPORT, encoding="utf-8").read()
    for slug, _pid, _bak in TYPES:
        pc = json.load(open(os.path.join(CAMP, "verify", slug + ".postcheck.json"), encoding="utf-8"))
        total = len(pc["checks"])
        green = sum(1 for c in pc["checks"] if c["ok"])
        rec(f"{green}/{total}" in text, "F 计数口径", slug,
            f"postcheck {green}/{total} 已在报告中(以 JSON 实数为准)")
    bad_lines = [l for l in text.split("\n") if "17/18" in l and "勘正" not in l]
    rec(not bad_lines, "F 计数口径", "旧误计数清零",
        "非勘正上下文零残留" if not bad_lines else "非勘正行残留:" + " | ".join(bad_lines[:2]))


def check_extra():
    for slug, pid, _bak in TYPES:
        h = json.load(open(os.path.join(CAMP, f"runs/{slug}.history.json"), encoding="utf-8"))
        got = None
        for ev in h["status"]["messages"]:
            if ev[0] == "execution_start":
                got = ev[1]["prompt_id"]
                break
        rec(got == pid, "E prompt_id对账", slug, f"history={got} ask={pid}")
        rec(h["status"]["status_str"] == "success", "E 终态", slug, h["status"]["status_str"])


def main():
    check_file_set()
    check_images()
    check_json()
    check_report_paths()
    check_counts()
    check_extra()

    lines = []
    lines.append("qi21-9xing-livefire 九型全量(v2)收账机器校验判定(verdict-v2.txt)")
    lines.append(f"时点:2026-10-06 v2 收账员;脚本:verify/verify_closeout_v2.py;解释器:{sys.executable}")
    lines.append("四查口径:[A]每型记录文件齐全(含 .md 四段标题;7-9 型含 sweep .bak) [B]图片存在且PNG可解析 [C]raw JSON 可解析(含 .bak) [D]总报告 v2 引用路径全部存在;附查 [E]prompt_id/终态对账(九型) [F]计数口径(九型)")
    lines.append("")
    groups = []
    for ok, g, item, detail in results:
        if g not in groups:
            groups.append(g)
    for g in groups:
        rows = [r for r in results if r[1] == g]
        n_ok = sum(1 for r in rows if r[0])
        lines.append(f"== {g}:{n_ok}/{len(rows)} 绿 ==")
        for ok, _g, item, detail in rows:
            mark = "PASS" if ok else "FAIL"
            lines.append(f"[{mark}] {item} | {detail}")
        lines.append("")
    n_fail = sum(1 for r in results if not r[0])
    overall = "PASS" if n_fail == 0 else "FAIL"
    lines.append(f"总判:{overall}(共 {len(results)} 项,红 {n_fail})")
    with io.open(VERDICT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines[-3:]))
    sys.exit(0 if n_fail == 0 else 1)


if __name__ == "__main__":
    main()
