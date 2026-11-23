#!/usr/bin/env python3
"""1123 绝对路径可移植化:跟踪文件内用户主目录绝对路径 → 可移植形态。

按文件类型分别处理:
- .py   tokenize 只改字符串字面量:值字符串 → os.path.expanduser("~/..."),
        文档串/独立串/注释 → 文案改 "~";缺 import os 自动补。
- .mjs  字符串字面量 → path.join(os.homedir(), "...");缺 require 自动补。
- .md   file:// 链接去仓库绝对前缀改仓库相对;`~` 定义句改文案;其余 → "~"。
- .json 字符串值 → "~"。
- 其余(.sh/.ts)报告人工处理。

幂等:可重复运行,已改造文件无 HOME 前缀则跳过。
"""
import ast
import io
import json
import os
import re
import subprocess
import sys
import tokenize

HOME = "/Users/" "zhengbingjin"  # 拆写:本文件自身不入残留检查
REPO_URL_PREFIX = HOME + "/Project/Github/MYStudio/"


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True)
    if result.returncode not in (0, 1):  # git grep 无命中返回 1
        raise RuntimeError(result.stderr.strip())
    return result.stdout


def ensure_import_os(text: str) -> str:
    if re.search(r"^\s*(?:import os\b|import os,|from os import)", text, re.M):
        return text
    lines = text.splitlines(keepends=True)
    i = 0
    while i < len(lines) and (lines[i].startswith("#!") or re.match(r"#.*coding[:=]", lines[i])):
        i += 1
    future = [j for j, ln in enumerate(lines) if re.match(r"\s*from __future__ import", ln)]
    if future:
        lines.insert(future[-1] + 1, "import os\n")
    else:
        lines.insert(i, "import os\n")
    return "".join(lines)


def py_transform(path: str, text: str) -> tuple[str, list[str]]:
    notes: list[str] = []
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, SyntaxError) as exc:
        return text, [f"TOKENIZE_FAIL {path}: {exc}"]

    lines = text.splitlines(keepends=True)
    starts = [0]
    for ln in lines:
        starts.append(starts[-1] + len(ln))

    def off(pos):
        return starts[pos[0] - 1] + pos[1]

    sig = [t for t in toks if t.type not in (tokenize.NL, tokenize.COMMENT, tokenize.ENCODING)]
    pos_of = {id(t): i for i, t in enumerate(sig)}
    edits: list[tuple[int, int, str]] = []
    used_expanduser = False

    for t in toks:
        if t.type not in (tokenize.STRING, tokenize.COMMENT):
            continue
        if HOME not in t.string:
            continue
        start, end = off(t.start), off(t.end)
        if t.type == tokenize.COMMENT:
            edits.append((start, end, t.string.replace(HOME, "~")))
            continue
        i = pos_of.get(id(t))
        prev_t = sig[i - 1] if i is not None and i > 0 else None
        next_t = sig[i + 1] if i is not None and i + 1 < len(sig) else None
        is_prose = (
            (prev_t is None or prev_t.type in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENCODING))
            and (next_t is None or next_t.type in (tokenize.NEWLINE, tokenize.ENDMARKER))
        )
        if is_prose:
            edits.append((start, end, t.string.replace(HOME, "~")))
            continue
        if (prev_t is not None and prev_t.type == tokenize.STRING) or (
            next_t is not None and next_t.type == tokenize.STRING
        ):
            notes.append(f"ADJACENT_CONCAT {path}:{t.start[0]} 需人工")
            continue
        edits.append((start, end, "os.path.expanduser(" + t.string.replace(HOME, "~") + ")"))
        used_expanduser = True

    if not edits:
        return text, notes
    new = text
    for start, end, repl in sorted(edits, key=lambda e: e[0], reverse=True):
        new = new[:start] + repl + new[end:]
    if used_expanduser:
        new = ensure_import_os(new)
    try:
        ast.parse(new)
    except SyntaxError as exc:
        return text, notes + [f"AST_FAIL {path}:{exc.lineno} 已回滚"]
    return new, notes


def mjs_transform(path: str, text: str) -> tuple[str, list[str]]:
    notes: list[str] = []
    pattern = re.compile(r"(['\"])" + re.escape(HOME) + r"([^'\"\n]*)\1")
    if HOME not in text:
        return text, notes
    esm = re.search(r"^\s*import\s", text, re.M) is not None

    def repl(m: re.Match) -> str:
        quote, rest = m.group(1), m.group(2).lstrip("/")
        if esm:
            return "join(homedir(), " + quote + rest + quote + ")"
        return (
            "require('node:path').join(require('node:os').homedir(), "
            + quote + rest + quote + ")"
        )

    new = pattern.sub(repl, text)
    if new == text:
        return text, notes
    if esm:
        prelude = []
        if not re.search(r"import\s*\{[^}]*\bhomedir\b[^}]*\}\s*from\s*['\"](?:node:)?os['\"]", new) and not re.search(
            r"\b(?:const|let|var)\s+homedir\b|\bfunction\s+homedir\b", new
        ):
            prelude.append('import { homedir } from "node:os";')
        if not re.search(r"import\s*\{[^}]*\bjoin\b[^}]*\}\s*from\s*['\"](?:node:)?path['\"]", new) and not re.search(
            r"\b(?:const|let|var)\s+join\b|\bfunction\s+join\b", new
        ):
            prelude.append('import { join } from "node:path";')
        if prelude:
            lines = new.splitlines(keepends=True)
            i = 0
            while i < len(lines) and (lines[i].startswith("#!") or lines[i].strip() in ("'use strict';", '"use strict";')):
                i += 1
            lines[i:i] = [p + "\n" for p in prelude]
            new = "".join(lines)
    return new, notes


def md_transform(path: str, text: str) -> tuple[str, list[str]]:
    new = text.replace("(`~` = `" + HOME + "`)", "(`~` = 用户主目录)")
    new = new.replace("file://" + REPO_URL_PREFIX, "")
    new = new.replace(HOME, "~")
    return new, []


def json_transform(path: str, text: str) -> tuple[str, list[str]]:
    new = text.replace(HOME, "~")
    try:
        json.loads(new)
    except json.JSONDecodeError as exc:
        return text, [f"JSON_FAIL {path}: {exc} 已回滚"]
    return new, []


TRANSFORMS = {
    ".py": py_transform,
    ".mjs": mjs_transform,
    ".md": md_transform,
    ".json": json_transform,
}


def main() -> int:
    files = [f for f in git("grep", "-l", "-F", HOME).splitlines() if f]
    changed, skipped, notes = [], [], []
    for path in files:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        transform = TRANSFORMS.get(os.path.splitext(path)[1])
        if transform is None:
            skipped.append(path)
            continue
        new, file_notes = transform(path, text)
        notes.extend(file_notes)
        if new != text:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(new)
            changed.append(path)
    print(f"changed={len(changed)} skipped={len(skipped)} notes={len(notes)}")
    for n in notes:
        print("  " + n)
    for s in skipped:
        print("  SKIP(人工) " + s)
    return 1 if notes else 0


if __name__ == "__main__":
    sys.exit(main())
