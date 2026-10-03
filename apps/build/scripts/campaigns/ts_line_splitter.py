#!/usr/bin/env python3
"""通用 TS 按行段拆分器——file-size-reduction 批量配方。

用法(作为库被各文件专用脚本 import,或 CLI):
  python3 ts_line_splitter.py <src> <plan_json>

plan_json: {
  "modules": [
    {"file": "相对路径", "doc": "模块头注释", "segments": [[a,b], ...],
     "export_names": ["fnA", "typeB"], "extra_imports": ["import x from 'y'"]}
  ],
  "facade_segments": [[a,b]], "facade_reexport_modules": ["m1","m2"]
}
行为:函数体逐字搬移;`function/type/interface/const X =` 前加 export(按
export_names);各模块导入=源文件 import 块按「标识符是否被使用」自动裁剪
+extra_imports+跨模块导入(被引用的已导出符号);门面保留段+从子模块再导出
全部公开符号(保历史 import 面)。
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]


def split_module(src: Path, plan: dict, from_head: bool = True) -> None:
    text = (subprocess.run(["git", "show", f"HEAD:{src.relative_to(REPO)}"],
                           capture_output=True, text=True, cwd=REPO).stdout
            if from_head else src.read_text(encoding="utf-8"))
    lines = text.splitlines(keepends=True)

    def seg(a: int, b: int) -> str:
        return "".join(lines[a - 1: b])

    # 解析源 import 块(支持多行 type import)
    import_block = []
    i = 0
    while i < len(lines):
        l = lines[i]
        if re.match(r"^import ", l):
            stmt = l
            j = i
            while not re.search(r"from ['\"][^'\"]+['\"];", stmt) and j + 1 < len(lines):
                j += 1
                stmt += lines[j]
            if re.match(r"^import (type )?\{", stmt) or re.match(r"^import \w+", stmt):
                import_block.append(stmt)
            i = j + 1
            continue
        if l.strip() and not l.startswith("//") and not l.startswith("/*") and not l.startswith(" *"):
            break
        i += 1

    # 提取 import 语句引入的标识符 → (名字, 整条语句)
    name_to_stmt: dict[str, str] = {}
    for stmt in import_block:
        m = re.search(r"from ['\"]([^'\"]+)['\"];", stmt)
        if not m:
            continue
        br = re.match(r"import (?:type )?\{(.*)\}", stmt.strip(), re.S)
        if br:
            for item in br.group(1).split(","):
                item = item.strip()
                if not item:
                    continue
                name = re.sub(r"^type ", "", item).split(" as ")[-1].strip()
                name_to_stmt[name] = stmt
        else:
            d = re.match(r"import (?:type )?(\w+)", stmt.strip())
            if d:
                name_to_stmt[d.group(1)] = stmt

    all_exported: dict[str, str] = {}  # 名字 → 模块文件 stem
    bodies: dict[str, str] = {}
    for mod in plan["modules"]:
        body = "\n".join(seg(a, b) for a, b in mod["segments"])
        for name in mod.get("export_names", []):
            is_type = name.startswith("type:")
            plain = name[5:] if is_type else name
            # export 化:对声明处加 export 前缀(限词边界)
            body = re.sub(rf"(?m)^(\s*)((?:export )?)((?:async )?function {plain}(?:<[^)]*?>)?\(|type {plain} =|interface {plain} |const {plain}(?::[^=]*)?=|class {plain} )",
                          lambda m: f"{m.group(1)}export {m.group(3)}" if not m.group(2) else m.group(0), body, count=1)
            all_exported[plain] = Path(mod["file"]).stem
        bodies[mod["file"]] = f'/**\n * {mod["doc"]}\n */\n' + body

    # 每模块:自动裁剪 import + 跨模块导入
    for mod in plan["modules"]:
        f = mod["file"]
        body = bodies[f]
        used_names = set(re.findall(r"\b([A-Za-z_]\w*)\b", body))
        needed_stmts: dict[str, list[str]] = {}
        for name, stmt in name_to_stmt.items():
            if name in used_names:
                src_mod = stmt
                needed_stmts.setdefault(stmt, []).append(name)
        # 同一语句多名字 → 合并重写为单条(按语句聚合名字,保持 from)
        import_lines = []
        merged: dict[str, list[str]] = {}
        alias_of: dict[str, str] = {}
        default_stmts = [stmt for stmt, names in needed_stmts.items()
                         if not re.match(r"import (?:type )?\{", stmt.strip())]
        for stmt in default_stmts:
            import_lines.append(stmt.rstrip("\n"))
        needed_stmts = {s: n for s, n in needed_stmts.items()
                        if re.match(r"import (?:type )?\{", s.strip())}
        for stmt, names in needed_stmts.items():
            frm = re.search(r"from ['\"]([^'\"]+)['\"];", stmt).group(1)
            is_type = stmt.lstrip().startswith("import type")
            merged.setdefault((frm, is_type), []).extend(names)
        for stmt in needed_stmts:
            br2 = re.match(r"import (?:type )?\{(.*)\}", stmt.strip(), re.S)
            if br2:
                for item in br2.group(1).split(","):
                    item = item.strip()
                    if not item or " as " not in item:
                        continue
                    orig, alias = [x.strip() for x in item.split(" as ")]
                    alias_of[re.sub(r"^type ", "", alias)] = re.sub(r"^type ", "", orig)
        for (frm, is_type), names in sorted(merged.items()):
            rendered = sorted({(alias_of.get(n, n) + f" as {n}") if n in alias_of else n for n in set(names)})
            import_lines.append(
                f"import {'type ' if is_type else ''}{{ {', '.join(rendered)} }} from \"{frm}\";")
        for extra in mod.get("extra_imports", []):
            import_lines.append(extra)
        # 跨模块:引用了其它模块导出的符号
        cross: dict[str, list[str]] = {}
        for name, stem in all_exported.items():
            if stem == Path(f).stem:
                continue
            if re.search(rf"\b{name}\b", body):
                cross.setdefault(stem, []).append(name)
        for stem, names in sorted(cross.items()):
            import_lines.append(f"import {{ {', '.join(sorted(set(names)))} }} from \"./{stem}\";")
        header = "\n".join(import_lines) + "\n\n"
        target = src.parent / Path(f).name
        target.write_text(header + body, encoding="utf-8")
        print(f"{target.name}: {len((header + body).splitlines())} 行")

    # 门面
    facade = "\n".join(seg(a, b) for a, b in plan["facade_segments"])
    facade_used = set(re.findall(r"\b([A-Za-z_]\w*)\b", facade))
    reexport_lines = []
    for mod in plan["modules"]:
        stem = Path(mod["file"]).stem
        vals = sorted(n for n in set(mod.get("export_names", [])) if not n.startswith("type:"))
        types = sorted(n[5:] for n in set(mod.get("export_names", [])) if n.startswith("type:"))
        if vals:
            reexport_lines.append(f"export {{ {', '.join(vals)} }} from \"./{stem}\";")
        if types:
            reexport_lines.append(f"export type {{ {', '.join(types)} }} from \"./{stem}\";")
    # 门面自身需要的子模块符号(内部使用)
    facade_cross: dict[str, list[str]] = {}
    for name, stem in all_exported.items():
        if name in facade_used:
            facade_cross.setdefault(stem, []).append(name)
    use_lines = []
    for stem, names in sorted(facade_cross.items()):
        use_lines.append(f"import {{ {', '.join(sorted(set(names)))} }} from \"./{stem}\";")
    # 门面保留原 import 块(裁剪)
    keep = []
    for stmt in import_block:
        m = re.search(r"from ['\"]([^'\"]+)['\"];", stmt)
        br = re.match(r"import (?:type )?\{(.*)\}", stmt.strip(), re.S)
        if br and m:
            names = [re.sub(r"^type ", "", x.strip()).split(" as ")[-1].strip()
                     for x in br.group(1).split(",") if x.strip()]
            kept = [n for n in names if n in facade_used or n in all_exported]
            if kept:
                is_type = stmt.lstrip().startswith("import type")
                alias_of2: dict[str, str] = {}
                for item in br.group(1).split(","):
                    item = item.strip()
                    if item and " as " in item:
                        orig, alias = [x.strip() for x in item.split(" as ")]
                        alias_of2[re.sub(r"^type ", "", alias)] = re.sub(r"^type ", "", orig)
                rendered2 = sorted({(alias_of2[n] + f" as {n}") if n in alias_of2 else n for n in set(kept)})
                keep.append(f"import {'type ' if is_type else ''}{{ {', '.join(rendered2)} }} from \"{m.group(1)}\";")
        else:
            d = re.match(r"import (?:type )?(\w+)", stmt.strip())
            if d and (d.group(1) in facade_used or d.group(1) in all_exported):
                keep.append(stmt.rstrip("\n"))
    header = "\n".join(keep + use_lines) + "\n\n"
    src.write_text(header + facade + "\n\n" + "\n".join(reexport_lines) + "\n", encoding="utf-8")
    print(f"{src.name} 门面: {len((header + facade).splitlines())} 行 + 再导出 {len(reexport_lines)} 条")


if __name__ == "__main__":
    src = (Path.cwd() / sys.argv[1]).resolve() if not Path(sys.argv[1]).is_absolute() else Path(sys.argv[1])
    plan = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    split_module(src, plan)
