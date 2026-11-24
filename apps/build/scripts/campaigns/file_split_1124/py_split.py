#!/usr/bin/env python3
"""py_split.py —— Python 超线文件拆分工具(2026-11-24 超线文件拆分;TS 版见 ts_split.mjs)。

    python3 py_split.py analyze <文件> [--min N] [--class 类名]
        列出顶层语句:序号、种类、名字、行范围、行数;每个名字被哪些顶层语句引用、它引用了哪些本文件顶层名字。
        --min N 只列行数 ≥ N 的;--class 类名 改列该类的方法(行范围、行数、引用的本文件顶层名字、方法间调用)。
    python3 py_split.py uses <文件> 名字1,名字2
        列这些顶层名字各自被哪些顶层语句引用(定位搬走后会断的地方)。
    python3 py_split.py move-range <文件> --to <新文件> --lines 起-止[,起-止…] --doc "模块说明" [--reexport 名字,…|*]
        把原文件指定行段(须恰好是若干条完整的顶层语句,各段两头只能是空行/注释)原样搬到同目录新模块,
        多段按原顺序拼接;新模块只补它用到的导入;原文件去掉各段、换成 from .新模块 import …。
        默认不修剪原文件的导入(可能仍是外部引用的转出口);--prune 才修剪「因搬移才变得没人用」的导入名。
        --reexport:原文件自身已不直接使用、但外部仍经「原模块.名字」访问的名字,一并转出口;
                    写 * 表示行段内全部名字都转出口。
        --allow-origin-deps:允许搬走的代码依赖留在原文件里的名字(新模块用 from .原模块 import … 取;
                    仅当原文件不会在初始化途中导入新模块时可用)。
        --lazy:原文件不在顶部 import 新模块,改用模块级 __getattr__ 访问时转出(新模块要用到原文件里的
                    定义、外部又要经原文件访问新模块名字时用;此模式下原文件自身不得再直接用这些名字)。
        搬走的代码若还依赖留在原文件里的名字(会循环导入)→ 拒绝并列出,不写盘。
    python3 py_split.py verify <文件> <新文件> 起-止[,起-止…]
        对照 HEAD 版原文件核对:新文件原样包含该行段;原文件=HEAD 去掉该段+导入块(其余差异逐行列出)。

依赖口径按 Python 作用域规则算:函数参数/局部变量/推导式变量/类属性的同名遮蔽不算引用本文件顶层名字;
类体里直接用的名字算,类里的方法用到的名字按全局查(类作用域对方法不可见)。
"""
import ast
import sys

SCOPE_NODES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda,
               ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)


def _binds_in(node, out):
    """这个作用域体内直接绑定的名字(不深入嵌套作用域;嵌套函数/类只绑定其名字)。"""
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.add(child.name)
            continue
        if isinstance(child, ast.Lambda):
            continue
        if isinstance(child, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            # 推导式自成作用域;仅首个可迭代对象在外层求值
            if child.generators:
                _binds_in(child.generators[0].iter, out)
            continue
        if isinstance(child, ast.Name) and isinstance(child.ctx, (ast.Store, ast.Del)):
            out.add(child.id)
        elif isinstance(child, ast.arg):
            out.add(child.arg)
        elif isinstance(child, (ast.Import, ast.ImportFrom)):
            for alias in child.names:
                out.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(child, ast.ExceptHandler) and child.name:
            out.add(child.name)
        elif isinstance(child, (ast.Global, ast.Nonlocal)):
            out.update(child.names)
        _binds_in(child, out)


def scope_bindings(node):
    """一个作用域节点自身绑定的名字(参数+体)。"""
    out = set()
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        args = node.args
        for a in (*args.posonlyargs, *args.args, *args.kwonlyargs):
            out.add(a.arg)
        if args.vararg:
            out.add(args.vararg.arg)
        if args.kwarg:
            out.add(args.kwarg.arg)
        body = [node.body] if isinstance(node, ast.Lambda) else node.body  # lambda 体是单个表达式
    elif isinstance(node, ast.ClassDef):
        for base in node.bases:
            _binds_in(base, out)
        for kw in node.keywords:
            _binds_in(kw.value, out)
        body = node.body
    else:  # 推导式
        out = set()
        for gen in node.generators:
            _binds_in(gen.target, out)
            for cond in gen.ifs:
                _binds_in(cond, out)
        body = []
    for stmt in body:
        if isinstance(stmt, (ast.Global, ast.Nonlocal)):
            # 声明的名字按外层解析,不算本作用域绑定
            for name in stmt.names:
                out.discard(name)
            continue
        _binds_in(stmt, out)
    return out


def module_loads(root, top_names):
    """root 体内对「本文件顶层名字」的引用(按作用域规则,被局部绑定遮蔽的不算)。"""
    used = set()

    def walk(node, stack):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, SCOPE_NODES):
                bound = scope_bindings(child)
                walk(child, stack + [(bound, isinstance(child, ast.ClassDef))])
                continue
            if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Load):
                name = child.id
                shadowed = False
                for index in range(len(stack) - 1, -1, -1):
                    bound, is_class = stack[index]
                    if is_class and index != len(stack) - 1:
                        continue  # 类作用域对其内嵌套的函数/推导式不可见
                    if name in bound:
                        shadowed = True
                        break
                if not shadowed and name in top_names:
                    used.add(name)
            walk(child, stack)

    walk(root, [])
    return used


def stmt_names(stmt):
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [stmt.name]
    if isinstance(stmt, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
        targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
        out = []
        for t in targets:
            if isinstance(t, ast.Name):
                out.append(t.id)
            elif isinstance(t, ast.Tuple):
                out.extend(e.id for e in t.elts if isinstance(e, ast.Name))
        return out
    if isinstance(stmt, (ast.Import, ast.ImportFrom)):
        return [(a.asname or a.name).split(".")[0] for a in stmt.names]
    return []


def stmt_kind(stmt):
    if isinstance(stmt, (ast.Import, ast.ImportFrom)):
        return "导入"
    if isinstance(stmt, ast.AsyncFunctionDef):
        return "异步函数"
    if isinstance(stmt, ast.FunctionDef):
        return "函数"
    if isinstance(stmt, ast.ClassDef):
        return "类"
    if isinstance(stmt, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
        return "常量"
    return type(stmt).__name__


def load(path):
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src, filename=path)
    return src, tree


def analyze(path, minimum, class_name):
    src, tree = load(path)
    lines = src.count("\n") + (0 if src.endswith("\n") else 1)
    stmts = tree.body
    if class_name:
        cls = next((s for s in stmts if isinstance(s, ast.ClassDef) and s.name == class_name), None)
        if cls is None:
            sys.exit(f"找不到顶层类 {class_name}")
        top_names = set()
        for s in stmts:
            top_names.update(stmt_names(s))
        methods = [s for s in cls.body if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))]
        method_names = {m.name for m in methods}
        print(f"# {path} → class {class_name}:第 {cls.lineno}-{cls.end_lineno} 行,共 {cls.end_lineno - cls.lineno + 1} 行,{len(methods)} 个方法")
        for m in methods:
            n = m.end_lineno - m.lineno + 1
            if n < minimum:
                continue
            uses = module_loads(m, top_names)
            calls = sorted({c.func.attr for c in ast.walk(m) if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute) and c.func.attr in method_names}
                           | {c.func.id for c in ast.walk(m) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name) and c.func.id in method_names})
            decos = "".join(f"@{ast.unparse(d)} " for d in m.decorator_list)
            print(f"{m.lineno:5d}-{m.end_lineno:<5d} {n:4d}行  {decos}{('async ' if isinstance(m, ast.AsyncFunctionDef) else '')}{m.name}")
            if uses:
                print(f"{'':18}用顶层名字: {', '.join(sorted(uses))}")
            if calls:
                print(f"{'':18}调本类方法: {', '.join(calls)}")
        return
    print(f"# {path} 共 {lines} 行,顶层语句 {len(stmts)} 条")
    index = {}
    for i, s in enumerate(stmts):
        for name in stmt_names(s):
            index.setdefault(name, []).append(i)
    users = {}
    uses_of = {}
    for i, s in enumerate(stmts):
        u = module_loads(s, set(index))
        uses_of[i] = u
        for name in u:
            users.setdefault(name, set()).update(index[name])
    for i, s in enumerate(stmts):
        n = s.end_lineno - s.lineno + 1
        if n < minimum:
            continue
        kind = stmt_kind(s)
        names = stmt_names(s)
        label = names[0] if names else ast.unparse(s)[:60].replace("\n", " ")
        if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            decos = "".join(f"@{ast.unparse(d)} " for d in s.decorator_list)
            extra = ""
            if isinstance(s, ast.ClassDef):
                methods = [m for m in s.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
                extra = f"  [{len(methods)} 个方法]"
            label = f"{decos}{label}{extra}"
        ref = " ".join(f"#{j}" for j in sorted(users.get(names[0], set())) if names) if names else ""
        by = " ".join(f"#{j}" for j in sorted(users.get(names[0], set()) - {i})) if names else ""
        print(f"{i:3d} {kind:4s} 第 {s.lineno:4d}-{s.end_lineno:<4d} {n:4d}行  {label[:90]}")
        if names:
            print(f"{'':21}被引用: {by or '-'}")
        if uses_of[i]:
            print(f"{'':21}引用: {', '.join(sorted(uses_of[i]))}")


def uses(path, wanted):
    src, tree = load(path)
    stmts = tree.body
    index = {}
    for i, s in enumerate(stmts):
        for name in stmt_names(s):
            index.setdefault(name, []).append(i)
    for name in wanted:
        print(f"== {name} (定义于 #{index.get(name, ['?'])}) 被引用于:")
        for i, s in enumerate(stmts):
            if i in index.get(name, []):
                continue
            if name in module_loads(s, set(index)):
                print(f"   #{i} {stmt_kind(s)} 第 {s.lineno}-{s.end_lineno} 行  {(stmt_names(s) or [ast.unparse(s)[:60]])[0]}")


def _top_index(tree):
    """顶层名字 → 定义它的顶层语句;以及全部顶层名字。"""
    index = {}
    for s in tree.body:
        for name in stmt_names(s):
            index.setdefault(name, s)
    return index


def _imports_for(names, index, keep_future=False):
    """为给定名字生成导入语句(只认「由导入语句绑定」的名字)。返回 (语句列表, 找不到导入来源的名字)。"""
    by_stmt = {}
    missing = []
    for name in sorted(names):
        stmt = index.get(name)
        if stmt is None or not isinstance(stmt, (ast.Import, ast.ImportFrom)):
            missing.append(name)
            continue
        by_stmt.setdefault(id(stmt), (stmt, []))[1].append(name)
    out = []
    for stmt, wanted in by_stmt.values():
        if isinstance(stmt, ast.Import):
            for alias in stmt.names:
                if (alias.asname or alias.name).split(".")[0] in wanted:
                    out.append(f"import {alias.name}" + (f" as {alias.asname}" if alias.asname else ""))
            continue
        module = "." * stmt.level + (stmt.module or "")
        if stmt.module == "__future__" and not keep_future:
            continue
        order = [(a.asname or a.name) for a in stmt.names]
        # 原样保留别名:原句 from x import y as z 复刻出来仍须是 y as z(只写 z 会导入不存在的名字)
        spelling = {(a.asname or a.name): (a.name if not a.asname else f"{a.name} as {a.asname}") for a in stmt.names}
        picked = [spelling[n] for n in sorted(wanted, key=order.index)]
        one = f"from {module} import {', '.join(picked)}"
        out.append(one if len(one) <= 99 else f"from {module} import (\n" + "".join(f"    {n},\n" for n in picked) + ")")
    return out, missing


def _prune_imports(src, before, protect=()):
    """去掉「因搬移才变得没人引用」的导入名(整条都空则删整条;__future__ 不动)。

    只动 before(搬移前的原文件)里有人用、现在没人用的名字:原文件里本来就没人用的导入
    一律不碰(可能是给外部经「原模块.名字」访问留的转出口,不属于这次拆分的范围);
    protect(本次显式要求的转出口)也不动。
    """
    tree = ast.parse(src)
    names = set()
    for s in tree.body:
        names.update(stmt_names(s))
    used = module_loads(tree, names) | set(protect)
    before_tree = ast.parse(before)
    before_names = set()
    for s in before_tree.body:
        before_names.update(stmt_names(s))
    used_before = module_loads(before_tree, before_names)
    lines = src.split("\n")
    drop = []          # 要删的整段 [start, end) 行号(1 基,含)
    edits = []         # (行号, 新文本)
    for s in tree.body:
        if not isinstance(s, (ast.Import, ast.ImportFrom)) or (isinstance(s, ast.ImportFrom) and s.module == "__future__"):
            continue
        if isinstance(s, ast.Import):
            keep = [a for a in s.names if (a.asname or a.name).split(".")[0] in used or (a.asname or a.name).split(".")[0] not in used_before]
            if len(keep) == len(s.names):
                continue
            if not keep:
                drop.append((s.lineno, s.end_lineno))
                continue
            text = "import " + ", ".join(a.name + (f" as {a.asname}" if a.asname else "") for a in keep)
            edits.append((s.lineno, text))
            if s.end_lineno > s.lineno:
                drop.append((s.lineno + 1, s.end_lineno))
            continue
        keep = [a for a in s.names if (a.asname or a.name) in used or a.name == "*" or (a.asname or a.name) not in used_before]
        if len(keep) == len(s.names):
            continue
        if not keep:
            drop.append((s.lineno, s.end_lineno))
            continue
        module = "." * s.level + (s.module or "")
        picked = [((a.asname or a.name) if not a.name.startswith("*") else a.name) for a in keep]
        one = f"from {module} import {', '.join(picked)}"
        if len(one) <= 99:
            edits.append((s.lineno, one))
            if s.end_lineno > s.lineno:
                drop.append((s.lineno + 1, s.end_lineno))
        else:
            # 括号多行式:只删掉无人引用的名字所在行,其余行原样
            for offset, line in enumerate(lines[s.lineno - 1:s.end_lineno]):
                stripped = line.strip().rstrip(",")
                if stripped and stripped != ")" and stripped not in picked and not stripped.startswith("from "):
                    drop.append((s.lineno + offset, s.lineno + offset))
    if not drop and not edits:
        return src
    for lineno, text in sorted(edits):
        lines[lineno - 1] = text
    killed = set()
    for a, b in drop:
        killed.update(range(a, b + 1))
    out = [line for i, line in enumerate(lines, 1) if i not in killed]
    text = "\n".join(out)
    while "\n\n\n\n" in text:
        text = text.replace("\n\n\n\n", "\n\n\n")
    return text


def _parse_ranges(spec):
    out = []
    for part in spec.split(","):
        a, b = (int(x) for x in part.split("-"))
        out.append((a, b))
    return out


def move_range(path, new_path, spec, doc, reexport, allow_origin=False, lazy=False, prune=False):
    """把 spec(如 "69-370,381-685")各段原样搬到同目录新模块;各段首尾须落在完整顶层语句的边界上。

    allow_origin: 允许搬走的代码依赖留在原文件里的名字——新模块用 from .原模块 import … 取。
                  仅当新模块不会在原文件初始化途中被导入时可用(原文件顶部不 import 新模块)。
    lazy:         原文件不在顶部 import 新模块,而是用模块级 __getattr__ 在访问时转出行段内的名字
                  (新模块要用到原文件里的定义、同时外部又要经原文件访问新模块的名字时用)。
    """
    ranges = _parse_ranges(spec)

    def in_range(n):
        return any(x <= n <= y for x, y in ranges)

    src = open(path, encoding="utf-8").read()
    lines = src.split("\n")
    tree = ast.parse(src)
    index = _top_index(tree)
    top_names = set(index)
    module = path.rsplit("/", 1)[-1][:-3]
    new_module = new_path.rsplit("/", 1)[-1][:-3]
    moved = [st for st in tree.body if in_range(st.lineno) and in_range(st.end_lineno)]
    if not moved:
        sys.exit("行段内没有完整的顶层语句")
    for st in tree.body:
        if st not in moved and any(st.lineno <= y and st.end_lineno >= x for x, y in ranges):
            sys.exit(f"语句 {ast.unparse(st)[:60]!r}(第 {st.lineno}-{st.end_lineno} 行)跨过行段边界")
    # 各段里凡不属于某条顶层语句的行,只允许是空行/注释
    for x, y in ranges:
        covered = set()
        for st in moved:
            if x <= st.lineno and st.end_lineno <= y:
                covered.update(range(st.lineno, st.end_lineno + 1))
        if not covered:
            sys.exit(f"行段 {x}-{y} 内没有完整的顶层语句")
        for lineno in range(x, y + 1):
            stripped = lines[lineno - 1].strip()
            if lineno not in covered and stripped and not stripped.startswith("#"):
                sys.exit(f"第 {lineno} 行既不是空行也不是注释,行段切断了语句: {stripped[:80]}")
    moved_names = set()
    for st in moved:
        moved_names.update(stmt_names(st))
    parts = ["\n".join(lines[x - 1:y]).strip("\n") for x, y in ranges]
    chunk = "\n\n\n".join(parts) + "\n"
    needs = module_loads(ast.parse(chunk), top_names) - moved_names
    imports, missing = _imports_for(needs, index, keep_future=True)
    if missing and not allow_origin:
        sys.exit("搬走的代码仍依赖留在原文件里的名字(会造成循环导入),先别搬或连同依赖一起搬:\n    " + ", ".join(sorted(missing)))
    if missing:
        one = f"from .{module} import {', '.join(sorted(missing))}"
        imports.append(one if len(one) <= 99 else f"from .{module} import (\n" + "".join(f"    {n},\n" for n in sorted(missing)) + ")")
    remaining_tree = ast.parse("\n".join(line for n, line in enumerate(lines, 1) if not in_range(n)))
    still_used = module_loads(remaining_tree, top_names) & moved_names
    unknown = [n for n in reexport if n != "*" and n not in moved_names]
    if unknown:
        sys.exit(f"--reexport 里的名字不在行段内: {unknown}")
    if "*" in reexport:  # 行段内全部名字都转出口:外部经「原模块.名字」访问任何名字都不受影响
        reexport = sorted(moved_names)
    first_line = {n: min(st.lineno for st in moved if n in stmt_names(st)) for n in moved_names}
    exported = sorted(still_used | set(reexport), key=lambda n: first_line[n])
    # 原文件:去掉各段,导入块紧跟最后一条顶层导入;原段位置上多出来的空行收成一个
    last_import_end = max((st.end_lineno for st in tree.body if isinstance(st, (ast.Import, ast.ImportFrom))), default=0)
    head = lines[:last_import_end]
    body = [line for n, line in enumerate(lines, 1) if not in_range(n) and n > last_import_end]
    rel = "." + new_module
    if not lazy:
        one = f"from {rel} import {', '.join(exported)}"
        import_block = [one] if len(one) <= 99 else [f"from {rel} import (", *[f"    {n}," for n in exported], ")"]
    else:
        if still_used:
            sys.exit(f"--lazy 模式下原文件自身不能再直接使用行段内的名字(函数体里的名字查找不走模块 __getattr__): {sorted(still_used)}")
        if not exported:
            sys.exit("--lazy 模式下行段内没有可转出的名字")
        import_block = []
    text = "\n".join(head + import_block + body)
    while "\n\n\n\n" in text:
        text = text.replace("\n\n\n\n", "\n\n\n")
    text = text.rstrip("\n") + "\n"
    if lazy:
        names_literal = ", ".join(f'"{n}"' for n in exported)
        pairs = ", ".join(f'"{n}": {n}' for n in exported)
        from_list = exported[0] if len(exported) == 1 else "(" + ", ".join(exported) + ")"
        text += (
            "\n\n# ── 按需转出口(1124 超线文件拆分)─────────────────────────────────────────────\n"
            f"# 下面这些名字住在 .{new_module};它们要用到本文件里的定义,在本文件顶部 import 会循环导入,\n"
            f"# 故改为访问时再取。外部用法不变:{module}.<名字> / from .{module} import <名字>。\n"
            f'_LAZY_EXPORTS = frozenset({{{names_literal}}})\n'
            "\n\n"
            "def __getattr__(name):\n"
            '    if name in _LAZY_EXPORTS:\n'
            f"        from .{new_module} import {from_list}\n"
            f"        return {{{pairs}}}[name]\n"
            '    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")\n'
        )
    # 默认不修剪导入:被搬走的代码用过的导入,在原文件里可能仍是外部经「原模块.名字」访问的转出口,
    # 修剪会悄悄破坏外部引用(1124 实际踩过:director_executor 的 OUT_DIR_ROOT)。要修剪须显式 --prune,
    # 且先核对外部引用。
    new_src = _prune_imports(text, src, protect=exported) if prune else text
    # 原文件若用 from __future__ import annotations,新模块同样带上:搬走的代码原本就在这个模式下编译
    has_future = any(isinstance(st, ast.ImportFrom) and st.module == "__future__" for st in tree.body)
    imports = [line for line in imports if not line.startswith("from __future__")]
    imports = (["from __future__ import annotations"] if has_future else []) + imports
    new_text = f'"""{doc}"""\n' + "\n" + "\n".join(imports) + ("\n\n\n" if imports else "\n") + chunk
    ast.parse(new_src)
    ast.parse(new_text)      # 两边都必须仍是合法 Python
    open(new_path, "w", encoding="utf-8").write(new_text)
    open(path, "w", encoding="utf-8").write(new_src)
    span = sum(y - x + 1 for x, y in ranges)
    print(f"✓ {path} 行段 {spec}({span} 行,{len(moved)} 条顶层语句)→ {new_path}")
    print(f"    原文件 {len(lines) - 1} → {new_src.count(chr(10))} 行;新文件 {new_text.count(chr(10))} 行")
    print(f"    新模块导入: {imports or '无'}")
    print(f"    原文件{'按需转出' if lazy else '从新模块导入'} {len(exported)} 个名字;其中原文件自身仍在用: {sorted(still_used)}")


def verify(path, new_path, spec):
    """核对搬移是原样的:新文件必须原样包含 HEAD 版原文件的各行段;原文件=HEAD 去掉各段+导入块(其余差异逐行列出)。"""
    import subprocess
    head = subprocess.run(["git", "show", f"HEAD:apps/{path}"], capture_output=True, text=True).stdout
    if not head:
        sys.exit("取不到 HEAD 版原文件")
    hlines = head.split("\n")
    ranges = _parse_ranges(spec)

    def in_range(n):
        return any(x <= n <= y for x, y in ranges)

    new = open(new_path, encoding="utf-8").read().split("\n")
    for x, y in ranges:
        seg = hlines[x - 1:y]
        while seg and not seg[-1].strip():
            seg.pop()
        pos = _find_sublist(new, seg)
        if pos is None:
            sys.exit(f"✗ 新文件里找不到原文件第 {x}-{y} 行的原文")
        print(f"✓ 新文件第 {pos + 1}-{pos + len(seg)} 行与原文件第 {x}-{y} 行逐字一致({len(seg)} 行)")
    now = open(path, encoding="utf-8").read().split("\n")
    # 原文件现在应= HEAD 去掉各段 + 导入块(再去掉因搬移才无人用的导入名);列出不再出现的 HEAD 非注释行
    lost = [l for n, l in enumerate(hlines, 1) if not in_range(n) and l.strip() and not l.strip().startswith("#") and l not in now]
    print(f"  原文件里已不见的 HEAD 非注释行(行段之外,{len(lost)}):")
    for l in lost[:30]:
        print(f"      - {l.strip()[:120]}")
    added = [l for l in now if l.strip() and l not in hlines]
    print(f"  原文件新增的非注释行({len(added)}):")
    for l in added[:60]:
        print(f"      + {l.strip()[:120]}")


def _find_sublist(hay, needle):
    n = len(needle)
    for i in range(len(hay) - n + 1):
        if hay[i:i + n] == needle:
            return i
    return None


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    cmd, path = args[0], args[1]
    if cmd == "analyze" or cmd == "uses":
        minimum, class_name, rest = 1, None, []
        i = 2
        while i < len(args):
            if args[i] == "--min":
                minimum = int(args[i + 1]); i += 2
            elif args[i] == "--class":
                class_name = args[i + 1]; i += 2
            else:
                rest.append(args[i]); i += 1
        if cmd == "analyze":
            analyze(path, minimum, class_name)
        else:
            uses(path, rest[0].split(","))
        return
    if cmd == "move-range":
        new_path, spec, doc, reexport = None, None, None, []
        allow_origin = lazy = prune = False
        i = 2
        while i < len(args):
            if args[i] == "--to":
                new_path = args[i + 1]; i += 2
            elif args[i] == "--lines":
                spec = args[i + 1]; i += 2
            elif args[i] == "--doc":
                doc = args[i + 1]; i += 2
            elif args[i] == "--reexport":
                reexport = [x for x in args[i + 1].split(",") if x]; i += 2
            elif args[i] == "--allow-origin-deps":
                allow_origin = True; i += 1
            elif args[i] == "--lazy":
                lazy = True; i += 1
            elif args[i] == "--prune":
                prune = True; i += 1
            else:
                i += 1
        if not (new_path and spec and doc):
            sys.exit(__doc__)
        move_range(path, new_path, spec, doc, reexport, allow_origin, lazy, prune)
        return
    if cmd == "verify":
        verify(path, args[2], args[3])
        return
    sys.exit(__doc__)


if __name__ == "__main__":
    main()
