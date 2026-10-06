#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_closeout.py — qi21-9xing-livefire 收账机器校验(判定落 verify/verdict.txt)。

四查(任务书口径,全为收账时点实测):
  [A] 每型记录文件齐全——每型 8 件套(.md 记录/raw .json/.history.json/后核 .postcheck.json/
      PNG 元数据 .png-prompt-metadata.json/日志摘录 .image-prompts.excerpt.log/驱动控制台
      .driver.console.log/产物图 direct+2k);型1 另加 attempt1 四件(缓存回声存档);
      并核 .md 记录含 ①②③③′ 四段提示词标题(记录内容完整性)。
  [B] 图片存在且 PNG 可解析——每型 2 图:存在、>0 字节、PNG 魔数、PIL 打开(模式/尺寸)。
  [C] raw JSON 可解析——runs/*.json + verify/*.json 全量 json.load(含 attempt1/cache-diff 件)。
  [D] 总报告引用的路径全部存在——从 九型实弹总报告.md 抽路径形 token(反引号/明文均可),
      逐个解析(仓根相对/战役目录相对/绝对路径)验存在。
附查(不改变四查口径,额外对账):
  [E] prompt_id 对账——history.json 内 execution_start prompt_id == 任务书给定 pid(六型);
      postcheck.json 全部可解析且其 checks 数与记录一致;history status_str=success(六型)。

用法:引擎 venv 跑(要 PIL):
  /Users/zhengbingjin/Project/IP/漫影工作室/comfyui/venv/bin/python verify/verify_closeout.py
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
REPO = os.path.abspath(os.path.join(CAMP, "..", "..", "..", "..", ".."))  # apps/build/scripts/campaigns 上五级
REPORT = os.path.join(CAMP, "九型实弹总报告.md")
VERDICT = os.path.join(CAMP, "verify", "verdict.txt")

TYPES = [
    ("type-1-人物", "9c4d3719-5d46-4f91-8dac-eac84336f713"),
    ("type-2-场景", "c1707be8-c301-44d5-b0d7-6411439d04a3"),
    ("type-3-道具", "fc46aba4-3c78-493b-8bf5-b82e8def7c7a"),
    ("type-4-美宣", "ad8280e7-62cf-4cd7-81b7-c266f18a1c6a"),
    ("type-5-多视图", "c972ae02-8ccb-4678-b663-a19b23f70f1f"),
    ("type-6-高清人脸", "a00b747a-301e-432b-bd15-819538c072b7"),
]

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

results = []  # (判, 分组, 条目, 实测)


def rec(ok, group, item, detail=""):
    results.append((ok, group, item, detail))
    return ok


def rel(p):
    return os.path.relpath(p, CAMP)


def check_file_set():
    for slug, _pid in TYPES:
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
        missing = [p for p in expect if not (os.path.isfile(os.path.join(CAMP, p)) and os.path.getsize(os.path.join(CAMP, p)) > 0)]
        rec(not missing, "A 记录齐全", slug,
            "9+件全在" if not missing else "缺/空:" + ",".join(missing))
        # 记录内容完整性:四段提示词标题在
        md = open(os.path.join(CAMP, f"runs/{slug}.md"), encoding="utf-8").read()
        need_heads = ["### ①", "### ②", "### ③", "### ③′"]
        lack = [h for h in need_heads if h not in md]
        rec(not lack, "A 记录齐全", f"{slug} .md 四段提示词标题",
            "①②③③′ 俱在" if not lack else "缺:" + ",".join(lack))


def check_images():
    for slug, _pid in TYPES:
        for tag, fname in (("direct", f"images/{slug}.direct.png"), ("2k", f"images/{slug}.2k.png")):
            p = os.path.join(CAMP, fname)
            if not os.path.isfile(p):
                rec(False, "B 图片PNG", f"{slug}.{tag}", "文件不存在")
                continue
            size = os.path.getsize(p)
            ok = size > 0
            rec(ok, "B 图片PNG", f"{slug}.{tag} 存在且>0B", f"{size}B")
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
            sorted(glob.glob(os.path.join(CAMP, "verify", "*.json")))
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
        # 只认「末段含扩展名」的文件 token 或以 / 结尾的目录 token(滤掉 runs/type- 之类泛指写法)
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
    rec(not bad, "D 报告路径", f"九型实弹总报告.md 引用路径({len(tokens)} 个去重 token)",
        "全部存在" if not bad else "不存在:" + ",".join(bad))
    return tokens


def check_counts():
    """[F] 计数口径守卫(2026-10-06 复核勘正后加):报告中的后核计数必须与 postcheck.json 实数一致,
    且旧误计数「17/18」零残留(失败型实数=19 项/绿 18/红 1,ok 型=18/18)。"""
    if not os.path.isfile(REPORT):
        return
    text = open(REPORT, encoding="utf-8").read()
    for slug, _pid in TYPES:
        pc = json.load(open(os.path.join(CAMP, "verify", slug + ".postcheck.json"), encoding="utf-8"))
        total = len(pc["checks"])
        green = sum(1 for c in pc["checks"] if c["ok"])
        rec(f"{green}/{total}" in text, "F 计数口径", slug,
            f"postcheck {green}/{total} 已在报告中(以 JSON 实数为准)")
    # 旧误计数「17/18」只许以历史引文形态出现在「勘正」标注行内,不得作为现行计数残留
    bad_lines = [l for l in text.split("\n") if "17/18" in l and "勘正" not in l]
    rec(not bad_lines, "F 计数口径", "旧误计数清零",
        "非勘正上下文零残留" if not bad_lines else "非勘正行残留:" + " | ".join(bad_lines[:2]))


def check_extra():
    for slug, pid in TYPES:
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
    lines.append("qi21-9xing-livefire 收账机器校验判定(verdict.txt)")
    lines.append(f"时点:2026-10-06 收账员;脚本:verify/verify_closeout.py;解释器:{sys.executable}")
    lines.append(f"四查口径:[A]每型记录文件齐全(含 .md 四段标题) [B]图片存在且PNG可解析 [C]raw JSON可解析 [D]总报告引用路径全部存在;附查 [E]prompt_id/终态对账")
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
