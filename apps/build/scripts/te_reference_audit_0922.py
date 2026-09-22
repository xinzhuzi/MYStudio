#!/usr/bin/env python3
# 出处:2026-09-23 编码器收尾战役产物(09-23-0922-te-closeout);只读审计,幂等可重跑。
"""文本编码器全库引用审计(真实 widget 引用 vs Note 笔记文本分拣)。

09-22 事故教训:删权重前只查画布、漏了全库 grep,heretic 误删引发 25 件断链。
本脚本是**删除守卫的执行器**:任何 text_encoders/ 权重删除前先跑它,
真实引用非零 = 禁删。输出按「编码器文件 → 消费者工作流 → 节点形态」分组。

分拣口径:
  REAL  = 非 Note 节点的 widgets_values 里出现文件名(含子图定义内节点与子图实例)
  NOTE  = 仅 MarkdownNote/Note 文本提及(文档漂移,不断链,但要修文案)

用法:
  python3 te_reference_audit_0922.py             # 打印报告,退出码 0=无活引用异常
  python3 te_reference_audit_0922.py --json PATH # 另存机器可读报告
  python3 te_reference_audit_0922.py --strict    # 有 NOTE 形态也退出 1(笔记清理验收用)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2] / "backend/engines/comfyui/workflows"

# 审计对象:键=报告名,值=文件名匹配子串(文件名级匹配,防误伤)
TARGETS = {
    "Krea2-Engineer-V1(官方K2 TE, 8.3GB)": ["Krea2-Engineer-V1-bf16.safetensors"],
    "Heretic-32B(去审查VLM, H3线, 15.1GB含mmproj)": [
        "Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-Q4_K_M.gguf",
        "Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-mmproj-f16.gguf",
    ],
    "nvfp4(官方H3 TE)": ["qwen3vl_32b_minimax_h3_nvfp4_awq"],
    "旧4B-heretic(已删,活引用必须为零)": ["qwen3-vl-4b-heretic"],
}

NOTE_TYPES = {"MarkdownNote", "Note"}


def widget_strings(n: dict) -> list[str]:
    """拉取节点全部字符串形态的 widget 值。

    兼容四代存储:widgets_values(list/dict/str)与 widgets_values_named(命名键
    字典,新前端保存形态——三视图实案:笔记文本住 .text)。
    """
    out: list[str] = []
    w = n.get("widgets_values")
    if isinstance(w, list):
        out += [v for v in w if isinstance(v, str)]
    elif isinstance(w, dict):
        out += [v for v in w.values() if isinstance(v, str)]
    elif isinstance(w, str):
        out.append(w)
    named = n.get("widgets_values_named")
    if isinstance(named, dict):
        out += [v for v in named.values() if isinstance(v, str)]
    return out


def audit() -> dict:
    report: dict[str, dict] = {name: {"real": {}, "note": {}} for name in TARGETS}
    files = sorted(REPO.rglob("*.json"))
    for fp in files:
        try:
            d = json.loads(fp.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        rel = str(fp.relative_to(REPO))
        # 三代格式一并收:①UI 格式 nodes[] ②桥模板 graph{id:{class_type,inputs}}
        # ③裸 API prompt 格式(顶层即 id→node)
        candidates: list[tuple[str, list[str], bool]] = []  # (节点类型, 字符串值, 是否笔记)

        def take_ui_nodes(ns: list, is_note: bool = False) -> None:
            for n in ns:
                t = n.get("type", "")
                note = is_note or t in NOTE_TYPES
                candidates.append((t, widget_strings(n), note))

        def walk_subgraphs(container: dict, depth: int = 0) -> None:
            """递归下钻:子图内还可嵌子图定义,单层会漏(三视图实案)。"""
            if depth > 6:
                return
            for sg in (container.get("definitions", {}) or {}).get("subgraphs", []):
                take_ui_nodes(sg.get("nodes", []))
                walk_subgraphs(sg, depth + 1)

        take_ui_nodes(d.get("nodes", []))
        walk_subgraphs(d)
        graph = d.get("graph")
        if isinstance(graph, dict):
            for n in graph.values():
                if isinstance(n, dict) and "class_type" in n:
                    ins = n.get("inputs")
                    vals = [v for v in ins.values() if isinstance(v, str)] if isinstance(ins, dict) else []
                    candidates.append((n["class_type"], vals, False))
        if "nodes" not in d and "graph" not in d and isinstance(d, dict):
            probe = next(iter(d.values()), None)
            if isinstance(probe, dict) and "class_type" in probe:
                for n in d.values():
                    ins = n.get("inputs")
                    vals = [v for v in ins.values() if isinstance(v, str)] if isinstance(ins, dict) else []
                    candidates.append((n.get("class_type", "?"), vals, False))

        for t, vals, is_note in candidates:
            for v in vals:
                for name, needles in TARGETS.items():
                    if any(nd in v for nd in needles):
                        bucket = report[name]["note" if is_note else "real"]
                        bucket.setdefault(rel, []).append(f"[{t}] {v[:80]}")
    return {"workflows_root": str(REPO), "files_scanned": len(files), "targets": report}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="另存机器可读报告到 PATH")
    ap.add_argument("--strict", action="store_true", help="有 NOTE 提及也退出 1")
    args = ap.parse_args()

    r = audit()
    print(f"扫描 {r['files_scanned']} 个工作流文件({r['workflows_root']})\n")
    code = 0
    for name, buckets in r["targets"].items():
        real, note = buckets["real"], buckets["note"]
        print(f"== {name}")
        print(f"   真实引用: {len(real)} 件")
        for rel, hits in sorted(real.items()):
            for h in hits:
                print(f"     - {rel}  {h}")
        if note:
            print(f"   仅笔记提及: {len(note)} 件(文档漂移,断链风险=无)")
            for rel in sorted(note):
                print(f"     - {rel}")
        # 已删文件的活引用=红线;其它编码器真实引用是台账数据,不算异常
        if "已删" in name and real:
            code = 1
        if args.strict and note:
            code = 1
        print()

    if args.json:
        Path(args.json).write_text(json.dumps(r, ensure_ascii=False, indent=2))
        print(f"报告已存 {args.json}")
    print("结论: " + ("PASS" if code == 0 else "FAIL(见上)"))
    return code


if __name__ == "__main__":
    sys.exit(main())
