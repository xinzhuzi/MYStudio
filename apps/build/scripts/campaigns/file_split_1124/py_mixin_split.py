#!/usr/bin/env python3
"""py_mixin_split.py —— 把一个大类的方法按「域」原样搬到几个混入类(2026-11-24 超线文件拆分)。

    python3 py_mixin_split.py <原文件> --class 类名
        --domain 新模块名:新类名:起-止行  (可多个;按方法 def 行落在哪段归哪个域)
        --keep 方法名,…                    (留在原类的方法;有 global 语句的必须留)
        --dynamic 名字,…                   (测试会在原模块上整个替换的名字:搬走的方法里改经 别名.名字 取)
        --alias 别名  (默认 service)       (--dynamic 名字里含 time 时慎用:会把所有 time.x 都改写)
        --doc 新模块名=一句话说明  (可多个)  --dry 只检查不写盘

做法:
  · 各域行段内的方法(连装饰器、紧贴其上的缩进注释)逐字搬进同目录新模块的顶层类,缩进不变;
  · 搬走的方法要用到、定义在原文件里的名字——
      导入语句绑定的:按原样在新模块再导入一份;
      原文件自定义的普通名字:导入时绑定(from .原模块 import …);
      --dynamic 名单里的、以及定义在原类之后的名字:改写成 别名.名字,调用时才到原模块取,
      测试在原模块上打桩的效果与搬出前相同;
  · 原类改成多基类组装;新模块的导入紧跟原文件最后一条顶层导入之后。
前置检查不过即停、不写盘:行段切到方法中间、有 global/nonlocal 的方法被搬走、被搬走的方法里
给别名名赋过值、搬走的方法引用了原文件里查不到来源的名字。
"""
import ast
import builtins
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from py_split import _imports_for, scope_bindings, stmt_names  # noqa: E402

SCOPE_KINDS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda,
               ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)


def scope_aware_refs(root, wanted):
    """root 里对 wanted 名字的引用(按作用域规则,被局部绑定遮蔽的不算)→ [(lineno, col, end_col, name)]。"""
    out = []

    def walk(node, stack):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, SCOPE_KINDS):
                walk(child, stack + [(scope_bindings(child), isinstance(child, ast.ClassDef))])
                continue
            if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Load) and child.id in wanted:
                shadowed = False
                for i in range(len(stack) - 1, -1, -1):
                    bound, is_class = stack[i]
                    if is_class and i != len(stack) - 1:
                        continue
                    if child.id in bound:
                        shadowed = True
                        break
                if not shadowed:
                    out.append((child.lineno, child.col_offset, child.end_col_offset, child.id))
            walk(child, stack)

    walk(root, [])
    return out


def main():
    args = sys.argv[1:]
    path = args[0]
    cls_name, domains, keep, dynamic, alias, docs, dry = None, [], set(), set(), "service", {}, False
    i = 1
    while i < len(args):
        a = args[i]
        if a == "--class":
            cls_name = args[i + 1]; i += 2
        elif a == "--domain":
            mod, new_cls, rng = args[i + 1].split(":")
            lo, hi = (int(x) for x in rng.split("-"))
            domains.append({"module": mod, "class": new_cls, "lo": lo, "hi": hi})
            i += 2
        elif a == "--keep":
            keep = set(x for x in args[i + 1].split(",") if x); i += 2
        elif a == "--dynamic":
            dynamic = set(x for x in args[i + 1].split(",") if x); i += 2
        elif a == "--alias":
            alias = args[i + 1]; i += 2
        elif a == "--doc":
            k, v = args[i + 1].split("=", 1); docs[k] = v; i += 2
        elif a == "--dry":
            dry = True; i += 1
        else:
            sys.exit(f"不认识的参数 {a}")
    if not cls_name or not domains:
        sys.exit(__doc__)

    src = open(path, encoding="utf-8").read()
    lines = src.split("\n")
    tree = ast.parse(src)
    module = path.rsplit("/", 1)[-1][:-3]
    cls = next(s for s in tree.body if isinstance(s, ast.ClassDef) and s.name == cls_name)
    if cls.decorator_list or cls.bases or cls.keywords:
        sys.exit("原类带装饰器/基类/关键字参数,未处理")
    index = {}
    for s in tree.body:
        for n in stmt_names(s):
            index.setdefault(n, s)
    top_names = set(index)
    imported = {n for n, s in index.items() if isinstance(s, (ast.Import, ast.ImportFrom))}
    late = {n for n, s in index.items() if s.lineno > cls.end_lineno}     # 定义在原类之后
    module_defs = top_names - imported - late
    rewrite_names = (dynamic | late) & top_names
    if alias in top_names:
        sys.exit(f"别名 {alias!r} 与原文件顶层名字撞名")

    # ── 每个方法一段:起点=装饰器首行或 def 行,再向上收紧贴的缩进注释 ──
    methods = [m for m in cls.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
    others = [s for s in cls.body if not isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))]
    if any(not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant)) for s in others):
        sys.exit(f"类体里有文档串以外的非方法语句: {[ast.unparse(s)[:50] for s in others]}")
    doc_end = (others[0].end_lineno if others else cls.lineno)            # 类文档串末行
    blocks = {}
    for m in methods:
        start = min([m.lineno] + [d.lineno for d in m.decorator_list])
        while start - 1 > doc_end and lines[start - 2].startswith("    #"):
            start -= 1
        blocks[m.name] = (start, m.end_lineno)
    if len(blocks) != len(methods):
        sys.exit("类里有重名方法")

    assigned = {}
    for d in domains:
        for m in methods:
            if d["lo"] <= m.lineno <= d["hi"]:
                if m.name in assigned:
                    sys.exit(f"方法 {m.name} 落在两个域里")
                assigned[m.name] = d
    kept = [m for m in methods if m.name in keep]
    moved = [m for m in methods if m.name in assigned and m.name not in keep]   # --keep 的不算搬走
    leftover = [m.name for m in methods if m.name not in keep and m.name not in assigned]
    if leftover:
        sys.exit(f"这些方法既没划进域也没 --keep: {leftover}")
    unknown_keep = keep - set(blocks)
    if unknown_keep:
        sys.exit(f"--keep 里有不存在的方法: {sorted(unknown_keep)}")
    for m in moved:
        glo = [ast.unparse(s) for s in ast.walk(m) if isinstance(s, (ast.Global, ast.Nonlocal))]
        if glo:
            sys.exit(f"方法 {m.name} 含 global/nonlocal {glo}:搬走会改写错模块的变量,须 --keep 留在原类")
        for n in ast.walk(m):
            if isinstance(n, SCOPE_KINDS) and alias in scope_bindings(n):
                sys.exit(f"方法 {m.name} 第 {n.lineno} 行的作用域给 {alias!r} 赋过值,与别名撞名")
    has_future = any(isinstance(s, ast.ImportFrom) and s.module == "__future__" for s in tree.body)

    # ── 逐域生成新模块 ──
    outputs = []
    total_rewrites = 0
    for d in domains:
        dm = [m for m in moved if assigned[m.name] is d]
        if not dm:
            sys.exit(f"域 {d['module']} 行段内没有方法")
        chunk_lines = ["class _Wrapped:"]
        for m in dm:
            a, b = blocks[m.name]
            if len(chunk_lines) > 1:
                chunk_lines.append("")
            chunk_lines.extend(lines[a - 1:b])
        chunk = "\n".join(chunk_lines) + "\n"
        refs = scope_aware_refs(ast.parse(chunk), top_names)
        used = {r[3] for r in refs}
        unknown = sorted(n for n in used if n not in top_names)
        bind = sorted(n for n in used if n in module_defs and n not in rewrite_names)
        imports, missing = _imports_for([n for n in used if n in imported], index, keep_future=True)
        if missing:
            sys.exit(f"域 {d['module']}: 有名字找不到导入来源 {missing}")
        # 改写:别名.名字(同一行从右往左改,免得列号漂移)
        rewrites = [r for r in refs if r[3] in rewrite_names]
        by_line = {}
        for ln, col, end, name in rewrites:
            by_line.setdefault(ln, []).append((col, end, name))
        for ln, items in by_line.items():
            text = chunk_lines[ln - 1]
            for col, end, name in sorted(items, reverse=True):
                text = text[:col] + f"{alias}.{name}" + text[end:]
            chunk_lines[ln - 1] = text
        total_rewrites += len(rewrites)
        ast.parse("\n".join(chunk_lines))                    # 改写后仍须是合法 Python
        body = "\n".join(chunk_lines[1:]) + "\n"
        need_alias = bool(rewrites)
        if rewrite_names & used and not rewrites and need_alias is False:
            need_alias = False
        header = [
            f'"""{d["module"]}.py — {docs.get(d["module"], "")}',
            "",
            f"本模块的类由 {module}.{cls_name} 混入组合而成:方法体自 {cls_name} 逐字搬出(1124 超线文件拆分),对外接口不变。",
            "",
            "两点约定:",
            f"- 须在 {module} 之后导入(类体里用到的名字在 {module} 初始化时才就绪;单独先导入本模块会循环导入失败);",
            f"- 测试会在 {module} 上整个替换的名字、以及定义在原类之后的名字,一律经 `{alias}.<名字>` 取(调用时才查),",
            f"  在 {module} 上打桩的效果与搬出前相同。",
            '"""',
            "",
        ]
        import_lines = []
        if has_future:
            import_lines.append("from __future__ import annotations")
            import_lines.append("")
        import_lines.extend(imports)
        if need_alias or bind:
            if imports:
                import_lines.append("")
            if need_alias:
                import_lines.append(f"from . import {alias}")
            if bind:
                one = f"from .{module} import {', '.join(bind)}"
                if len(one) <= 99:
                    import_lines.append(one)
                else:
                    import_lines.append(f"from .{module} import (")
                    import_lines.extend(f"    {n}," for n in bind)
                    import_lines.append(")")
        class_doc = f'    """{docs.get(d["module"], "")}"""'
        text = "\n".join(header) + "\n"
        if import_lines:
            text += "\n".join(import_lines) + "\n\n\n"
        text += f"class {d['class']}:\n{class_doc}\n\n" + body
        ast.parse(text)
        outputs.append((d, text, len(dm), len(rewrites), bind, need_alias))
        if dry:
            print(f"[{d['module']}] {len(dm)} 个方法;改写 {len(rewrites)} 处;绑定原文件名字 {len(bind)} 个;需要别名={need_alias}")
            print(f"    导入: {imports}")
            print(f"    改写明细: {sorted({r[3] for r in rewrites})}")

    # ── 原文件:类改成组装,类体只留文档串与 --keep 的方法 ──
    bases = ", ".join(d["class"] for d in domains)
    class_lines = [f"class {cls_name}({bases}):"]
    class_lines.extend(lines[cls.lineno:doc_end])            # 类文档串(原样)
    for m in kept:
        a, b = blocks[m.name]
        class_lines.append("")
        class_lines.extend(lines[a - 1:b])
    last_import_end = max((s.end_lineno for s in tree.body if isinstance(s, (ast.Import, ast.ImportFrom))), default=0)
    head = lines[:cls.lineno - 1]
    while head and not head[-1].strip():
        head.pop()
    import_block = [f"from .{d['module']} import {d['class']}" for d in domains]
    note = [
        "# ── 按域分住的实现(1124 超线文件拆分)─────────────────────────────────────────",
        f"# {cls_name} 的方法按域逐字搬到下列模块的类里,再混入组合成一个类,对外接口不变;留在本类里的",
        f"# 只有类文档串与 {', '.join(sorted(keep)) or '(无)'}。各域模块须在本文件的模块级定义之后导入。",
    ]
    new_src = "\n".join(head) + "\n\n\n" + "\n".join(note + import_block) + "\n\n\n" + "\n".join(class_lines) + "\n" + "\n".join(lines[cls.end_lineno:])
    ast.parse(new_src)
    print(f"✓ {path}:{cls_name} 共 {len(methods)} 个方法 → 搬出 {len(moved)} 个(改写 {total_rewrites} 处引用),留在原类 {len(kept)} 个")
    print(f"    原文件 {len(lines) - 1} → {new_src.count(chr(10))} 行")
    if not dry:
        for d, text, n, r, bind, need_alias in outputs:
            target = path.rsplit("/", 1)[0] + "/" + d["module"] + ".py"
            open(target, "w", encoding="utf-8").write(text)
            print(f"    → {target}: {text.count(chr(10))} 行,{n} 个方法,改写 {r} 处,绑定 {len(bind)} 个名字{'(经别名动态取)' if need_alias else ''}")
        open(path, "w", encoding="utf-8").write(new_src)


if __name__ == "__main__":
    main()
