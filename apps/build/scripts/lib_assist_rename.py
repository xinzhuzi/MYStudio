#!/usr/bin/env python3
"""lib/assist、stores/assist、panels/assist 三层统一改名为 comfyui,并把 image-studio 按主题拆成四个子目录。

(2026-11-24;任务 11-24-apps-architecture-restructure;用户裁定:三层一起改、拆四个子目录、名字统一为 comfyui)

做什么(规则全部在 lib_assist_rename.map.json,本脚本只负责执行):
  1. 移动:映射表 moves。逐文件的移动(image-studio 拆进 comfy/ h3/ storyboard/ image-gen/,模板进 h3/templates/)
          和整目录的移动(stores/assist → stores/comfyui,components/panels/assist → components/panels/comfyui)。
          用普通改名而不是 git mv:git mv 会立刻把改名放进共享暂存区,别的会话一提交就会把它带走。
  2. 文本改写(对仓库里所有命中规则的文本文件,按顺序):
     a. 手工规则 manual:指定文件里的指定字串。「基地址 + 文件名」拼接出来的路径、文档里目录级的提法。
     b. 文件级规则:按映射表逐个文件生成。带扩展名的写法(…/comfy-execute.ts)和不带扩展名的写法
        (@/…/comfy-execute)各一条,每个文件指向自己的新子目录。
     c. 目录级规则 dir_rules:前面两步之后剩下的目录提法(文档、注释、早已不存在的旧文件名)。
     d. 被移动文件内部的相对引用(./x、./x.json、import("./x")、vi.mock("./x")):按「文件搬去哪了」重算。
        同组不变;跨组变成 ../组名/x;模板变成 ./templates/x.json。指向目录外的相对路径不变(层级深度没变)。

不改的:
  - 历史备注里不带路径的提法(例如 lib/ai 文件头的「2026-08-29 迁自 lib/assist/freedom-*」);
  - 不是路径的名字:项目存储域名 "image-studio"、界面数据属性、事件界面名、样式选择器、标签页代号 freedom;
  - 本脚本、映射表、.trellis 任务档、git 历史。

用法:
  python3 apps/build/scripts/lib_assist_rename.py             演练(默认):只报告,不动盘
  python3 apps/build/scripts/lib_assist_rename.py --report <文件>   把逐文件的改动行写到报告文件
  python3 apps/build/scripts/lib_assist_rename.py --apply     执行;之后再跑一遍应当报告「无事可做」(幂等)
  python3 apps/build/scripts/lib_assist_rename.py --selftest  自测(用一张独立的小映射表在临时 git 仓库里走完全部规则)

执行闸:--apply 时,如果受影响的文件里有未提交的改动(别的会话正在改,或尚未提交),拒绝执行并列出它们。
"""

import argparse
import json
import os
import posixpath
import re
import subprocess
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MAP_PATH = os.path.join(SCRIPT_DIR, "lib_assist_rename.map.json")
FRONTEND = "apps/frontend"  # 别名 @/ 对应的根;路径规则以它为基准书写
SELF_PATHS = {
    "apps/build/scripts/lib_assist_rename.py",
    "apps/build/scripts/lib_assist_rename.map.json",
}
BINARY_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".icns", ".ico", ".mp4", ".wav", ".mp3", ".m4a", ".woff",
              ".woff2", ".ttf", ".safetensors", ".pdf", ".zip", ".gz", ".node", ".bin"}
# 「字母数字」只认 ASCII:路径前后紧挨着中文时也要能匹配
NOT_WORD_BEFORE = r"(?<![A-Za-z0-9_-])"
NOT_NAME_CHAR = r"(?![A-Za-z0-9_.-])"
NOT_STEM_CHAR = r"(?![A-Za-z0-9_./-])"
# 引号里以 ./ 或 ../ 开头的相对引用(不含 ${} 插值)
REL_RE = re.compile(r"(['\"`])(\.{1,2}/[^'\"`\n$]*)\1")


def _git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, check=True)


class Rules:
    """由映射表编译出的全部规则。"""

    def __init__(self, mapping):
        self.manual = mapping.get("manual", [])
        self.file_moves = [m for m in mapping["moves"] if not m.get("dir")]
        self.dir_moves = [m for m in mapping["moves"] if m.get("dir")]
        self.filemap = {m["from"]: m["to"] for m in self.file_moves}
        assert len(self.filemap) == len(self.file_moves), "映射表里有重复的 from"
        # 文件级规则按「旧目录」分组生成;一个组内名称长的排前面,避免短名字先匹配
        by_old = {}
        for m in self.file_moves:
            old_dir = posixpath.dirname(posixpath.relpath(m["from"], FRONTEND))
            by_old.setdefault(old_dir, {})[posixpath.basename(m["from"])] = posixpath.dirname(posixpath.relpath(m["to"], FRONTEND))
        self.file_rules = []  # [(类别, 正则, 替换函数)]
        for old_dir, table in sorted(by_old.items()):
            full = sorted(table, key=len, reverse=True)
            stems = sorted({n[:-3] for n in full if n.endswith((".ts", ".tsx")) and not n.endswith(".test.ts")}, key=len, reverse=True)
            base = NOT_WORD_BEFORE + re.escape(old_dir) + "/"
            self.file_rules.append(("文件级·全名", re.compile(base + "(" + "|".join(map(re.escape, full)) + ")" + NOT_NAME_CHAR),
                                    lambda mo, t=table: t[mo.group(1)] + "/" + mo.group(1)))
            if stems:
                self.file_rules.append(("文件级·不带扩展名", re.compile(base + "(" + "|".join(map(re.escape, stems)) + ")" + NOT_STEM_CHAR),
                                        lambda mo, t=table: t[mo.group(1) + ".ts"] + "/" + mo.group(1)))
        # 目录级规则:只做前缀替换,后面不能紧跟字母数字、下划线或连字符(避免误伤 stores/assistant 之类)
        self.dir_rules = [(d["old"], re.compile(NOT_WORD_BEFORE + re.escape(d["old"]) + r"(?![A-Za-z0-9_-])"), d["new"])
                          for d in mapping.get("dir_rules", [])]
        assert self.file_rules and self.dir_rules, "映射表缺 moves 或 dir_rules"

    def transform(self, rel, text):
        """对一个文件的内容套用 a/b/c 三类规则。返回 (新内容, 计数字典)。"""
        counts = {}
        for i, mr in enumerate(self.manual):
            if mr["file"] != rel:
                continue
            n = text.count(mr["old"])
            if n:
                text = text.replace(mr["old"], mr["new"])
                counts[("手工规则", i)] = n
        for kind, regex, repl in self.file_rules:
            text, n = regex.subn(repl, text)
            if n:
                counts[(kind, regex.pattern[:48])] = n
        for old, regex, new in self.dir_rules:
            text, n = regex.subn(new, text)
            if n:
                counts[("目录级规则", old)] = n
        return text, counts

    def needs_review(self, rel, line):
        """这一行只靠文件级规则改不动(仍含目录级旧串,或命中手工规则)→ 改动要人工复核。"""
        after, _ = self.transform_file_only(rel, line)
        return any(regex.search(after) for _, regex, _ in self.dir_rules) or any(mr["file"] == rel and mr["old"] in line for mr in self.manual)

    def transform_file_only(self, rel, text):
        counts = {}
        for kind, regex, repl in self.file_rules:
            text, n = regex.subn(repl, text)
            if n:
                counts[kind] = n
        return text, counts

    def rewrite_relative(self, text, old_rel, new_rel):
        """被移动文件内部的相对引用按新位置重算。只动「解析后确实指向另一个被移动文件」的引用。"""
        old_dir, new_dir = posixpath.dirname(old_rel), posixpath.dirname(new_rel)
        changed = 0

        def sub(mo):
            nonlocal changed
            spec = mo.group(2)
            ext = posixpath.splitext(spec)[1]
            for cand in (spec, spec + ".ts", spec + ".tsx", spec + ".json", spec + ".js", spec + "/index.ts", spec + "/index.tsx"):
                target = posixpath.normpath(posixpath.join(old_dir, cand))
                if target in self.filemap:
                    new_target = self.filemap[target]
                    if not ext:  # 原来没写扩展名 → 新的也不写
                        new_target = posixpath.splitext(new_target)[0]
                    rel = posixpath.relpath(new_target, new_dir)
                    if not rel.startswith("."):
                        rel = "./" + rel
                    if rel != spec:
                        changed += 1
                    return mo.group(1) + rel + mo.group(1)
            return mo.group(0)  # 指向目录外、或不是被移动的文件:不变

        return REL_RE.sub(sub, text), changed


def list_files(repo):
    """git 跟踪的 + 未跟踪且未被忽略的文件。"""
    out = _git(repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard").stdout
    seen, files = set(), []
    for raw in out.split(b"\0"):
        if not raw:
            continue
        p = raw.decode("utf-8", "surrogateescape")
        if p not in seen:
            seen.add(p)
            files.append(p)
    return files


def dirty_files(repo):
    out = _git(repo, "status", "--porcelain", "--untracked-files=all", "-z").stdout
    return {e.decode("utf-8", "surrogateescape")[3:].strip().strip('"') for e in out.split(b"\0") if e}


def is_text_file(path):
    if os.path.splitext(path)[1].lower() in BINARY_EXT:
        return False
    try:
        with open(path, "rb") as f:
            head = f.read(8000)
    except OSError:
        return False
    return b"\0" not in head


def read_text(full):
    return open(full, "rb").read().decode("utf-8", "surrogateescape")


def plan(repo, rules):
    """只读:算出要做的移动与改写。返回 (待移动, [(文件, 计数)], 改动行 [(文件, 是否需人工复核, 原行, 新行)])。"""
    planned = []
    for m in rules.file_moves + rules.dir_moves:
        src, dst = os.path.join(repo, m["from"]), os.path.join(repo, m["to"])
        if os.path.exists(src):
            if os.path.exists(dst):
                raise SystemExit(f"源与目标同时存在,停手: {m['from']} / {m['to']}")
            planned.append(m)
        elif not os.path.exists(dst):
            raise SystemExit(f"源与目标都不存在,停手: {m['from']} / {m['to']}")
    lines = []
    edits = []
    for rel in list_files(repo):
        if rel in SELF_PATHS or rel.startswith(".trellis/"):
            continue
        full = os.path.join(repo, rel)
        if not os.path.isfile(full) or os.path.islink(full) or not is_text_file(full):
            continue
        text = read_text(full)
        new, counts = rules.transform(rel, text)
        n_rel = 0
        if rel in rules.filemap:
            new, n_rel = rules.rewrite_relative(new, rel, rules.filemap[rel])
            if n_rel:
                counts[("相对引用重算", "")] = n_rel
        if new != text:
            edits.append((rel, counts))
            for a, b in zip(text.split("\n"), new.split("\n")):
                if a != b:
                    lines.append((rel, rules.needs_review(rel, a), a.strip(), b.strip()))
    return planned, edits, lines


def apply(repo, rules, planned, edits, report):
    for m in planned:
        src, dst = os.path.join(repo, m["from"]), os.path.join(repo, m["to"])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        os.rename(src, dst)
        d = os.path.dirname(src)  # 旧目录空了就删,由内向外
        while os.path.isdir(d) and not os.listdir(d) and os.path.relpath(d, repo) not in (".", ""):
            os.rmdir(d)
            d = os.path.dirname(d)
    print(f"已移动 {len(planned)} 项")
    moved_prefixes = [(m["from"], m["to"]) for m in planned]

    def new_path(rel):
        for a, b in moved_prefixes:
            if rel == a or rel.startswith(a + "/"):
                return b + rel[len(a):]
        return rel

    out, total = [], 0
    for rel, _counts in edits:
        target = new_path(rel)
        full = os.path.join(repo, target)
        text = read_text(full)
        new, counts = rules.transform(rel, text)
        n_rel = 0
        if rel in rules.filemap:
            new, n_rel = rules.rewrite_relative(new, rel, rules.filemap[rel])
        if new == text:
            continue
        with open(full, "wb") as f:
            f.write(new.encode("utf-8", "surrogateescape"))
        total += sum(counts.values()) + n_rel
        for a, b in zip(text.split("\n"), new.split("\n")):
            if a != b:
                out.append(f"{target}\n  - {a.strip()[:300]}\n  + {b.strip()[:300]}\n")
    print(f"已改写 {total} 处")
    if report is not None:
        with open(report, "w", encoding="utf-8") as f:
            f.write("\n".join(out))
    return total


def selftest():
    """用一张独立的小映射表,在临时 git 仓库里把全部规则走一遍,再验证幂等。"""
    repo = tempfile.mkdtemp(prefix="lib-assist-rename-selftest-")
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t")
    _git(repo, "config", "user.name", "t")
    S = "apps/frontend/lib/assist/image-studio/"
    C = "apps/frontend/lib/comfyui/"
    mapping = {
        "moves": [
            {"from": S + "comfy-execute.ts", "to": C + "comfy/comfy-execute.ts"},
            {"from": S + "comfy-execute.test.ts", "to": C + "comfy/comfy-execute.test.ts"},
            {"from": S + "__snapshots__/comfy-execute.test.ts.snap", "to": C + "comfy/__snapshots__/comfy-execute.test.ts.snap"},
            {"from": S + "h3-shot.ts", "to": C + "h3/h3-shot.ts"},
            {"from": S + "h3-shot.test.ts", "to": C + "h3/h3-shot.test.ts"},
            {"from": S + "h3-template.json", "to": C + "h3/templates/h3-template.json"},
            {"from": S + "h3-template.api.json", "to": C + "h3/templates/h3-template.api.json"},
            {"from": S + "run-uncloth.ts", "to": C + "image-gen/run-uncloth.ts"},
            {"from": "apps/frontend/lib/assist/model-display-names.ts", "to": "apps/frontend/lib/ai/model-display-names.ts"},
            {"from": "apps/frontend/stores/assist", "to": "apps/frontend/stores/comfyui", "dir": True},
            {"from": "apps/frontend/components/panels/assist", "to": "apps/frontend/components/panels/comfyui", "dir": True},
        ],
        "manual": [{"file": "apps/backend/t.py", "old": '"frontend/lib/assist/image-studio"', "new": '"frontend/lib/comfyui/h3/templates"'}],
        "dir_rules": [
            {"old": "lib/assist/image-studio", "new": "lib/comfyui"},
            {"old": "stores/assist", "new": "stores/comfyui"},
            {"old": "panels/assist", "new": "panels/comfyui"},
        ],
    }
    rules = Rules(mapping)
    W = lambda p, s: (os.makedirs(os.path.dirname(os.path.join(repo, p)), exist_ok=True),
                      open(os.path.join(repo, p), "w", encoding="utf-8", newline="").write(s))
    W(S + "comfy-execute.ts", 'import x from "@/lib/assist/image-studio/h3-shot";\nexport const x = 1;\n')
    W(S + "comfy-execute.test.ts", 'vi.mock("./comfy-execute");\nimport { x } from "./comfy-execute";\n')
    W(S + "__snapshots__/comfy-execute.test.ts.snap", "// snap\n")
    W(S + "h3-shot.ts", 'import t from "./h3-template.json";\nimport api from "./h3-template.api.json";\nimport { x } from "./comfy-execute";\n'
                        'import { y } from "@/lib/assist/image-studio/run-uncloth";\nexport const z = "../../../components/outside";\n')
    W(S + "h3-shot.test.ts", 'import { z } from "./h3-shot";\nimport tpl from "./h3-template.json";\n')
    W(S + "h3-template.json", "{}\n")
    W(S + "h3-template.api.json", "{}\n")
    W(S + "run-uncloth.ts", 'import { x } from "./comfy-execute";\nexport const surface = "image-studio";\n')
    W("apps/frontend/lib/assist/model-display-names.ts", "export const names = 1;\n")
    W("apps/frontend/lib/ai/c.ts", 'import { names } from "@/lib/assist/model-display-names";\n// 迁自 lib/assist/freedom-*,历史备注不改\n')
    W("apps/frontend/lib/ai/d.ts", 'import { x } from "../../lib/assist/image-studio/comfy-execute.ts";\r\n')
    W("apps/frontend/stores/assist/s.ts", "export const s = 1;\n")
    W("apps/frontend/stores/assist/s.test.ts", 'import { s } from "./s";\n')
    W("apps/frontend/components/panels/assist/index.tsx", 'export { P } from "./p/P";\n')
    W("apps/frontend/components/panels/assist/p/P.tsx", 'import { s } from "../../../../stores/assist/s";\nexport const P = 1;\n')
    W("apps/frontend/components/Layout.tsx", 'const P = lazy(() => import("@/components/panels/assist"));\nconst f = "freedom";\n')
    W("apps/frontend/components/orbs/a.tsx", 'import { useFreedomStore } from "@/stores/assist/s";\nconst d = "stores/assistant-x";\n')
    W("apps/backend/t.py", 'FRONTEND = ROOT / "frontend/lib/assist/image-studio"\nAPI = FRONTEND / "h3-template.api.json"\n')
    W("apps/build/scripts/x.py", "P = 'apps/frontend/lib/assist/image-studio/h3-shot.ts'\nQ = 'frontend/lib/assist/image-studio/workflow-migrate-batch.ts'\n")
    W("docs/a.md", "住在lib/assist/image-studio/见`stores/assist`、`panels/assist` 同名。\n")
    W("apps/build/scripts/lib_assist_rename.py", "old = 'lib/assist/image-studio'  # 自身不改\n")
    W("apps/build/scripts/lib_assist_rename.map.json", '{"old": "lib/assist/image-studio"}\n')
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "c1")
    planned, edits, lines = plan(repo, rules)
    assert len(planned) == len(mapping["moves"]), (len(planned), len(mapping["moves"]))
    # 需人工复核的行 = 命中手工规则的 1 行 + 靠目录级规则改的 5 行(两条目录提法、三行 stores/panels 的别名导入)
    assert sum(1 for r, review, _, _ in lines if review) == 6, [(r, a) for r, review, a, _ in lines if review]
    apply(repo, rules, planned, edits, None)
    R = lambda p: open(os.path.join(repo, p), encoding="utf-8", newline="").read()
    assert R(C + "comfy/comfy-execute.ts") == 'import x from "@/lib/comfyui/h3/h3-shot";\nexport const x = 1;\n'
    assert R(C + "comfy/comfy-execute.test.ts") == 'vi.mock("./comfy-execute");\nimport { x } from "./comfy-execute";\n'   # 同组相对引用不变
    assert R(C + "comfy/__snapshots__/comfy-execute.test.ts.snap") == "// snap\n"
    assert R(C + "h3/h3-shot.ts") == ('import t from "./templates/h3-template.json";\nimport api from "./templates/h3-template.api.json";\n'
                                     'import { x } from "../comfy/comfy-execute";\nimport { y } from "@/lib/comfyui/image-gen/run-uncloth";\n'
                                     'export const z = "../../../components/outside";\n')   # 模板进 templates、跨组加 ../、指向目录外的不变
    assert R(C + "h3/h3-shot.test.ts") == 'import { z } from "./h3-shot";\nimport tpl from "./templates/h3-template.json";\n'
    assert R(C + "image-gen/run-uncloth.ts") == 'import { x } from "../comfy/comfy-execute";\nexport const surface = "image-studio";\n'   # 不是路径的名字不改
    assert R("apps/frontend/lib/ai/c.ts") == 'import { names } from "@/lib/ai/model-display-names";\n// 迁自 lib/assist/freedom-*,历史备注不改\n'
    assert R("apps/frontend/lib/ai/d.ts") == 'import { x } from "../../lib/comfyui/comfy/comfy-execute.ts";\r\n'
    assert R("apps/frontend/stores/comfyui/s.test.ts") == 'import { s } from "./s";\n'
    assert R("apps/frontend/components/panels/comfyui/p/P.tsx") == 'import { s } from "../../../../stores/comfyui/s";\nexport const P = 1;\n'
    assert R("apps/frontend/components/panels/comfyui/index.tsx") == 'export { P } from "./p/P";\n'
    assert R("apps/frontend/components/Layout.tsx") == 'const P = lazy(() => import("@/components/panels/comfyui"));\nconst f = "freedom";\n'
    assert R("apps/frontend/components/orbs/a.tsx") == 'import { useFreedomStore } from "@/stores/comfyui/s";\nconst d = "stores/assistant-x";\n'   # 相近名字不误伤
    assert R("apps/backend/t.py") == 'FRONTEND = ROOT / "frontend/lib/comfyui/h3/templates"\nAPI = FRONTEND / "h3-template.api.json"\n'
    assert R("apps/build/scripts/x.py") == "P = 'apps/frontend/lib/comfyui/h3/h3-shot.ts'\nQ = 'frontend/lib/comfyui/workflow-migrate-batch.ts'\n"
    assert R("docs/a.md") == "住在lib/comfyui/见`stores/comfyui`、`panels/comfyui` 同名。\n"   # 紧挨中文也能匹配
    assert "'lib/assist/image-studio'" in R("apps/build/scripts/lib_assist_rename.py")
    for gone in ("apps/frontend/lib/assist", "apps/frontend/stores/assist", "apps/frontend/components/panels/assist"):
        assert not os.path.exists(os.path.join(repo, gone)), f"旧目录没清: {gone}"
    staged = _git(repo, "status", "--porcelain").stdout.decode()
    assert not any(l and l[:1] in "RMA" for l in staged.split("\n")), f"普通改名不该动暂存区: {staged[:200]}"
    planned2, edits2, _ = plan(repo, rules)
    assert not planned2 and not edits2, "第二次演练应当无事可做"
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "c2")
    names = _git(repo, "diff", "--name-status", "-M", "HEAD~1", "HEAD").stdout.decode()
    renamed = "".join(l for l in names.split("\n") if l.startswith("R"))
    assert "h3-template.api.json" in renamed and "model-display-names.ts" in renamed, f"git 没有识别成改名(历史会断): {names[:300]}"
    print("selftest 通过:三层改名、四组拆分、同组/跨组/模板的相对引用、指向目录外不变、别名式、字符串路径、"
          "分段基地址(手工规则)、目录级提法、紧挨中文、相近名字不误伤、非路径名不改、历史备注保留、自身不改、"
          "快照随迁、CRLF 保留、不动暂存区、git 识别为改名、幂等")


def main():
    ap = argparse.ArgumentParser(description="lib/assist 等三层改名为 comfyui 并拆四个子目录(默认演练)")
    ap.add_argument("--apply", action="store_true", help="执行移动与改写")
    ap.add_argument("--report", help="把逐文件的改动行写到这个文件")
    ap.add_argument("--selftest", action="store_true", help="自测")
    ns = ap.parse_args()
    if ns.selftest:
        selftest()
        return
    repo = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
    rules = Rules(json.load(open(MAP_PATH, encoding="utf-8")))
    planned, edits, lines = plan(repo, rules)
    by_kind = {}
    for _, c in edits:
        for k, n in c.items():
            by_kind[k[0]] = by_kind.get(k[0], 0) + n
    review = [(r, a, b) for r, yes, a, b in lines if yes]
    print(f"待移动 {len(planned)} 项 | 待改写 {len(edits)} 个文件、共 {sum(by_kind.values())} 处")
    for k, n in sorted(by_kind.items()):
        print(f"  {k:14s} {n:4d} 处")
    print(f"  需人工复核的改动行(目录级规则、手工规则):{len(review)} 行")
    touched = {r for r, _ in edits} | {m["from"] for m in planned}
    clash = sorted(p for p in touched & dirty_files(repo) if p not in SELF_PATHS)
    if clash:
        print(f"⚠️ 受影响文件里有 {len(clash)} 个存在未提交改动(别的会话正在改,或尚未提交):")
        for p in clash[:30]:
            print("   ", p)
    if ns.report:
        with open(ns.report, "w", encoding="utf-8") as f:
            for m in planned:
                f.write(f"移动  {m['from']}  →  {m['to']}\n")
            for rel, c in sorted(edits):
                f.write(f"改写  {sum(c.values()):3d} 处  {rel}\n")
            f.write("\n# 需人工复核的改动行\n")
            for rel, a, b in review:
                f.write(f"{rel}\n  - {a[:300]}\n  + {b[:300]}\n")
            f.write("\n# 全部改动行\n")
            for rel, yes, a, b in lines:
                f.write(f"{rel}\n  - {a[:300]}\n  + {b[:300]}\n")
        print(f"逐文件清单已写到 {ns.report}")
    if not ns.apply:
        print("演练模式,未改动任何文件。加 --apply 执行。")
        return
    if clash:
        raise SystemExit("有受影响文件存在未提交改动,拒绝执行。先等它们提交或与属主协调;确认无碍后重新运行。")
    apply(repo, rules, planned, edits, ns.report)
    planned2, edits2, _ = plan(repo, rules)
    print("复跑演练:", "无事可做(幂等)" if not planned2 and not edits2 else f"仍有待办 {len(planned2)}+{len(edits2)}(异常)")


if __name__ == "__main__":
    main()
