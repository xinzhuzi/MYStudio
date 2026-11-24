#!/usr/bin/env python3
"""py_patch_surface.py —— 盘「测试与生产代码在某个模块上访问的全部名字」(2026-11-24 超线文件拆分)。

    python3 py_patch_surface.py <模块点路径,如 remote_ssh.service> <仓根> <测试路径glob>… --prod <生产文件>…

为什么要盘:Python 函数体里的名字在「函数所在模块」里查。测试若用
monkeypatch.setattr(模块, "名字", 新值) 把模块上的名字整个换掉,那么引用该名字的代码一旦搬到
别的文件,这个桩就对它失效——测试变红还算好的,更糟的是行为悄悄不同。
所以拆分前要分清:
  · 名字级打桩(把模块属性换成新值):引用它的代码搬家后必须仍到原模块去取;
  · 对象属性打桩(monkeypatch.setattr(模块.对象, "属性", …)):改的是对象自身,搬到哪都看得见;
  · 只读访问:搬走后在原模块保留转出口即可。
"""
import ast
import collections
import glob
import os
import re
import sys


def module_aliases(tree, package, modname):
    """测试文件里哪些局部名指向该模块:from pkg import mod [as a] / import pkg.mod [as a] / from pkg import pkg_mod…"""
    aliases = {modname: "module"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith(package):
            for alias in node.names:
                if alias.name == modname and node.module == package:
                    aliases[alias.asname or alias.name] = "module"
                elif node.module == f"{package}.{modname}" and not alias.name.startswith("*"):
                    aliases[alias.asname or alias.name] = "member:" + alias.name
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == f"{package}.{modname}":
                    aliases[alias.asname or alias.name] = "module"
                elif alias.name == package and (alias.asname or alias.name) == modname:
                    aliases[alias.asname or alias.name] = "module"
    return aliases


def analyze_test(path, package, modname, dotted):
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    aliases = module_aliases(tree, package, modname)
    patched, reads, dynamic = collections.Counter(), collections.Counter(), []
    patch_call = re.compile(r"^(monkeypatch\.setattr|.*\.patch\.object|.*\.patch|patch|setattr)$")
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and aliases.get(node.value.id) == "module":
            reads[node.attr] += 1
        if isinstance(node, ast.ImportFrom) and node.module == dotted:
            for alias in node.names:
                reads["(from-import)" + alias.name] += 1
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        fname = ast.unparse(node.func)
        if not patch_call.match(fname):
            continue
        args = node.args
        target = args[0] if args else None
        # 字符串目标:patch("pkg.mod.name")
        if isinstance(target, ast.Constant) and isinstance(target.value, str) and target.value.startswith(dotted + "."):
            patched[target.value[len(dotted) + 1:]] += 1
            continue
        if target is None:
            continue
        # 目标是模块本身 → 名字级打桩;目标是「模块.成员」→ 给该对象的属性打桩(不受搬家影响)
        if isinstance(target, ast.Name) and aliases.get(target.id) == "module":
            if len(args) > 1 and isinstance(args[1], ast.Constant):
                patched[args[1].value] += 1
            else:
                dynamic.append(f"{node.lineno}: {ast.unparse(node)[:110]}")
        elif isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and aliases.get(target.value.id) == "module":
            reads[target.attr] += 1  # 被当成对象用,记一次读取
    return patched, reads, dynamic


def main():
    dotted, repo_root = sys.argv[1], sys.argv[2]
    package, _, modname = dotted.rpartition(".")
    rest = sys.argv[3:]
    prod = []
    if "--prod" in rest:
        i = rest.index("--prod")
        prod, rest = rest[i + 1:], rest[:i]
    files = []
    for pattern in rest:
        files.extend(sorted(glob.glob(os.path.join(repo_root, pattern), recursive=True)))
    patched, reads, dynamic, used = collections.Counter(), collections.Counter(), [], []
    for f in files:
        if "/test" not in f and not os.path.basename(f).startswith("test"):
            continue
        try:
            p, r, d = analyze_test(f, package, modname, dotted)
        except SyntaxError:
            continue
        if not p and not r and not any(True for _ in ()):
            text = open(f, encoding="utf-8").read()
            if not re.search(rf"\b{re.escape(package)}\.{modname}\b|from {re.escape(package)} import {modname}\b|import {re.escape(package)}\.{modname}\b", text):
                continue
        if p or r or d:
            used.append(f.replace(repo_root.rstrip("/") + "/", ""))
        patched.update(p); reads.update(r); dynamic.extend(f"{f.split('/')[-1]}:{x}" for x in d)
    print(f"引用 {dotted} 且对其有访问的测试文件: {len(used)}")
    print("\n名字级打桩(把模块上的名字整个换掉)——引用它的代码搬家后必须仍到本模块取:")
    for name, count in sorted(patched.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"   {count:2d}× {name}")
    if dynamic:
        print("   (名字是动态计算的打桩):")
        for line in dynamic:
            print(f"       {line}")
    print("\n只读访问(含 from-import 与把模块成员当对象用):")
    print("   " + ", ".join(f"{name}({count})" for name, count in sorted(reads.items())))
    print("\n生产代码:")
    names = collections.Counter()
    for f in prod:
        src = open(f"{repo_root}/{f}", encoding="utf-8").read()
        tree = ast.parse(src)
        aliases = module_aliases(tree, package, modname)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == dotted:
                for alias in node.names:
                    names["from-import:" + alias.name] += 1
            elif isinstance(node, ast.ImportFrom) and node.module == package:
                for alias in node.names:
                    if alias.name == modname:
                        names["import-module"] += 1
            elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and aliases.get(node.value.id) == "module":
                names["attr:" + node.attr] += 1
            elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("getattr", "setattr", "hasattr")
                  and node.args and isinstance(node.args[0], ast.Name) and aliases.get(node.args[0].id) == "module"
                  and len(node.args) > 1 and isinstance(node.args[1], ast.Constant)):
                names[f"{node.func.id}-dynamic:{node.args[1].value}"] += 1
    print("   " + ", ".join(f"{key}({count})" for key, count in sorted(names.items())) or "   (无)")


if __name__ == "__main__":
    main()
