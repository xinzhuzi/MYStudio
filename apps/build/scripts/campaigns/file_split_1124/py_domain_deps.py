#!/usr/bin/env python3
"""py_domain_deps.py —— 盘一个类里各「域」(方法行段)对模块级名字的依赖(2026-11-24 超线文件拆分)。

    python3 py_domain_deps.py <文件> --class 类名 --domain 名字:起行-止行 [--domain …]…

为什么要盘:Python 函数体里的名字在「函数所在模块」里查;测试常用
monkeypatch.setattr(模块, "名字", …) 打桩。把方法搬到别的文件后,再在原模块上打桩
对它就不生效了——所以每个方法组用到哪些「本模块自定义的顶层名字」、哪些名字被多个组
共用,决定了一刀能不能切下去。
"""
import ast
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from py_split import module_loads, stmt_names  # noqa: E402


def main():
    args = sys.argv[1:]
    path, class_name, domains = args[0], None, []
    i = 1
    while i < len(args):
        if args[i] == "--class":
            class_name = args[i + 1]; i += 2
        elif args[i] == "--domain":
            label, rng = args[i + 1].split(":")
            a, b = rng.split("-")
            domains.append((label, int(a), int(b))); i += 2
        else:
            i += 1
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    imported, defined = set(), {}
    for s in tree.body:
        if isinstance(s, (ast.Import, ast.ImportFrom)):
            imported.update(stmt_names(s))
        else:
            for n in stmt_names(s):
                defined[n] = s.lineno
    cls = next(s for s in tree.body if isinstance(s, ast.ClassDef) and s.name == class_name)
    methods = [m for m in cls.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
    cls_attrs = {n.id for m in cls.body if isinstance(m, ast.Assign) for t in m.targets for n in ast.walk(t) if isinstance(n, ast.Name)}
    use = {label: set() for label, *_ in domains}
    per = []
    for m in methods:
        dom = next((label for label, a, b in domains if a <= m.lineno <= b), None)
        names = module_loads(m, set(defined)) & set(defined)
        per.append((dom, m, names))
        if dom:
            use[dom] |= names
    total = len(methods)
    print(f"# {path} → class {class_name}:{total} 个方法;模块自定义顶层名字 {len(defined)} 个")
    for label, a, b in domains:
        ms = [m for d, m, _ in per if d == label]
        print(f"\n[{label}] 第 {a}-{b} 行,{len(ms)} 个方法,共 {sum(m.end_lineno - m.lineno + 1 for m in ms)} 行")
        print(f"  用到的模块级自定义名字({len(use[label])}): {', '.join(sorted(use[label]))}")
    all_names = set().union(*use.values())
    shared = {n: [label for label in use if n in use[label]] for n in sorted(all_names)}
    multi = {n: ls for n, ls in shared.items() if len(ls) >= 2}
    print(f"\n被两个及以上域共用的名字({len(multi)}):")
    for n, ls in multi.items():
        print(f"  {n}(定义于第 {defined[n]} 行): {ls}")
    orphans = [m.name for d, m, _ in per if d is None]
    if orphans:
        print(f"\n不在任何域里的方法: {orphans}")


if __name__ == "__main__":
    main()
