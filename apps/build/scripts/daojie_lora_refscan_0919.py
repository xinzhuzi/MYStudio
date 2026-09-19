#!/usr/bin/env python3
"""LoRA 全库引用扫描(09-19 治理 R3/R4;决策表数据源,只读不写)。

扫描面(三处,只读):
  A. 仓库工作流库  apps/backend/engines/comfyui/workflows/  全量 json
     - UI 格式(nodes[].widgets_values / widgets_values_named)
     - API/桥格式(graph{node_id:{class_type,inputs}} 递归)
  B. 引擎家用户区  <comfy-home>/ComfyUI/user/default/workflows/  全量 json(同上双格式)
  C. my_nodes 数据面  apps/backend/engines/comfyui/my_nodes/  的 json
     (daojie_loras.json 等以「file」字段携带 lora 路径,按权威口径判存)

判存口径(对 <comfy-home>/models/loras/ 实际文件):
  - LoRA 加载节点(node.type / class_type 名含 "lora",大小写不敏感;如
    LoraLoaderModelOnly / LoraLoader / MyDaojieLoras)= 权威口径:widgets 中
    凡以模型扩展名(.safetensors/.ckpt/.pt/.pt2/.bin/.part)结尾的字符串都是
    lora 引用,目标不在库内即计断链;MyDaojieLoras 类键名引用(「人物」等)
    不是文件引用,不计。
  - 非 LoRA 节点(checkpoint/vae/clip/unet/pack 等)同名扩展名字符串绝大多数
    不是 loras 库引用:仅当其恰好命中库内实体(相对路径或文件名)时计为该件
    引用(pack 内嵌 lora 槽不漏账);未命中的列入「存疑模型串」段供人工核,
    不计断链(离线无法判定其所属模型域)。
  - 数据面 json(my_nodes)= 权威口径。

输出:
  - stdout:逐件「引用计数+引用方(文件:节点)」+ 断链清单 + 存疑模型串 +
    零引用件;末行固定 BROKEN=<n>(引用了不存在文件的节点/数据面条目数)。
  - --json PATH:机读全量结果(台账生成用)。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
HOME_WORKFLOWS = (Path.home() / "Library/Application Support/漫影工作室/comfyui"
                  / "ComfyUI/user/default/workflows")
LORA_DIR = (Path.home() / "Library/Application Support/漫影工作室/comfyui"
            / "models/loras")

REPO_WF = REPO / "apps/backend/engines/comfyui/workflows"
MY_NODES = REPO / "apps/backend/engines/comfyui/my_nodes"

EXTS = (".safetensors", ".ckpt", ".pt", ".pt2", ".bin", ".part")
SKIP_DIRS = {".cache", ".git"}


def build_inventory() -> dict[str, int]:
    """loras/ 实际文件 → {posix 相对路径: 字节大小}。"""
    inv: dict[str, int] = {}
    if not LORA_DIR.is_dir():
        return inv
    for p in sorted(LORA_DIR.rglob("*")):
        if not p.is_file():
            continue
        if any(part in SKIP_DIRS for part in p.relative_to(LORA_DIR).parts):
            continue
        inv[p.relative_to(LORA_DIR).as_posix()] = p.stat().st_size
    return inv


def norm(ref: str) -> str:
    return ref.strip().replace("\\", "/").lstrip("/")


def resolve(ref: str, inv: dict[str, int],
            by_base: dict[str, str]) -> tuple[str, str] | None:
    """返回 (命中方式, 库内相对路径) 或 None(断链)。"""
    r = norm(ref)
    if r in inv:
        return ("exact", r)
    base = r.rsplit("/", 1)[-1]
    if base in by_base:
        return ("basename", by_base[base])
    return None


def is_lora_type(t: str) -> bool:
    return "lora" in str(t).lower()


def ext_strs(seq) -> list[str]:
    if isinstance(seq, list):
        return [v for v in seq if isinstance(v, str) and v.lower().endswith(EXTS)]
    if isinstance(seq, dict):
        return [v for v in seq.values()
                if isinstance(v, str) and v.lower().endswith(EXTS)]
    return []


def label(root_name: str, f: Path, root: Path) -> str:
    rel = f.relative_to(root).as_posix()
    return f"{root_name}:{rel}"


def scan_ui(label_file: str, wf: dict, refs: dict, broken: list,
            unclassified: list) -> None:
    for n in wf.get("nodes", []):
        if not isinstance(n, dict):
            continue
        nid, ntype = n.get("id", "?"), str(n.get("type", "?"))
        title = n.get("title") or ""
        where = f"{label_file} 节点[{nid}]{('<' + title + '>') if title else ''}"
        vals = ext_strs(n.get("widgets_values")) + ext_strs(n.get("widgets_values_named"))
        if not vals:
            continue
        if is_lora_type(ntype):
            for v in vals:
                hit = resolve(v, INV, BY_BASE)
                if hit:
                    refs[hit[1]].append(f"{where}({hit[0]})")
                else:
                    broken.append({"where": where, "type": ntype, "ref": v})
        else:
            for v in vals:
                hit = resolve(v, INV, BY_BASE)
                if hit:
                    refs[hit[1]].append(f"{where}({hit[0]},pack/非loader命中)")
                else:
                    unclassified.append({"where": where, "type": ntype, "ref": v})


def scan_api(label_file: str, wf: dict, refs: dict, broken: list,
             unclassified: list) -> None:
    graph = wf.get("graph")
    if not isinstance(graph, dict):
        return
    for nid, n in graph.items():
        if not isinstance(n, dict):
            continue
        ct = str(n.get("class_type", "?"))
        where = f"{label_file} 节点[{nid}]<{ct}>"
        vals = [v for v in n.get("inputs", {}).values()
                if isinstance(v, str) and v.lower().endswith(EXTS)]
        if not vals:
            continue
        if is_lora_type(ct):
            for v in vals:
                hit = resolve(v, INV, BY_BASE)
                if hit:
                    refs[hit[1]].append(f"{where}({hit[0]})")
                else:
                    broken.append({"where": where, "type": ct, "ref": v})
        else:
            for v in vals:
                hit = resolve(v, INV, BY_BASE)
                if hit:
                    refs[hit[1]].append(f"{where}({hit[0]},api命中)")
                else:
                    unclassified.append({"where": where, "type": ct, "ref": v})


def scan_dataplane(label_file: str, data, refs: dict, broken: list,
                   trail: str = "") -> None:
    """my_nodes 数据面:一切模型扩展名字符串都按 lora 权威口径判存。"""
    if isinstance(data, dict):
        for k, v in data.items():
            scan_dataplane(label_file, v, refs, broken,
                           f"{trail}.{k}" if trail else str(k))
    elif isinstance(data, list):
        for i, v in enumerate(data):
            scan_dataplane(label_file, v, refs, broken, f"{trail}[{i}]")
    elif isinstance(data, str) and data.lower().endswith(EXTS):
        where = f"{label_file} {trail}"
        hit = resolve(data, INV, BY_BASE)
        if hit:
            refs[hit[1]].append(f"{where}({hit[0]})")
        else:
            broken.append({"where": where, "type": "dataplane", "ref": data})


def main() -> int:
    global INV, BY_BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="机读全量结果输出路径")
    args = ap.parse_args()

    INV = build_inventory()
    BY_BASE = {}
    for rel in INV:
        BY_BASE[rel.rsplit("/", 1)[-1]] = rel

    refs: dict[str, list[str]] = defaultdict(list)
    broken: list[dict] = []
    unclassified: list[dict] = []
    scanned_files = 0

    targets = [("repo", REPO_WF, "ui+api"), ("home", HOME_WORKFLOWS, "ui+api"),
               ("mynodes", MY_NODES, "dataplane")]
    for root_name, root, mode in targets:
        if not root.is_dir():
            print(f"[scan] 跳过不存在的扫描根:{root}")
            continue
        for f in sorted(root.rglob("*.json")):
            if any(part in SKIP_DIRS for part in f.relative_to(root).parts):
                continue
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                print(f"[scan] ⚠️ 解析失败 {f}: {e}")
                continue
            scanned_files += 1
            lf = label(root_name, f, root)
            if mode == "dataplane":
                scan_dataplane(lf, data, refs, broken)
                continue
            if isinstance(data, dict):
                scan_ui(lf, data, refs, broken, unclassified)
                scan_api(lf, data, refs, broken, unclassified)
                # 兜底:既无 nodes 也无 graph 的杂形(如嵌入 prompt 的档),
                # 按非权威口径只记命中,不判断链
                if "nodes" not in data and "graph" not in data:
                    def walk(o, path=""):
                        if isinstance(o, dict):
                            for k, v in o.items():
                                walk(v, f"{path}.{k}")
                        elif isinstance(o, list):
                            for i, v in enumerate(o):
                                walk(v, f"{path}[{i}]")
                        elif isinstance(o, str) and o.lower().endswith(EXTS):
                            hit = resolve(o, INV, BY_BASE)
                            if hit:
                                refs[hit[1]].append(f"{lf} {path}({hit[0]},杂形命中)")
                            else:
                                unclassified.append(
                                    {"where": f"{lf} {path}", "type": "杂形", "ref": o})
                    walk(data)

    print(f"[scan] 扫描 json {scanned_files} 个;loras/ 实体 {len(INV)} 件"
          f"({sum(INV.values()) / 1e9:.2f} GB)")
    print()
    print("== 每件引用(文件 | 引用数 | 引用方) ==")
    for rel in sorted(INV):
        rs = refs.get(rel, [])
        print(f"{rel} | {len(rs)}")
        for r in rs:
            print(f"    - {r}")
    print()
    zero = [rel for rel in sorted(INV) if not refs.get(rel)]
    print(f"== 零引用件({len(zero)}) ==")
    for rel in zero:
        print(f"    {rel}  ({INV[rel] / 1e6:.1f} MB)")
    print()
    broken_nodes = sorted({b["where"] for b in broken})
    print(f"== 断链(权威口径引用了不存在文件;{len(broken)} 条引用串 / "
          f"{len(broken_nodes)} 个节点) ==")
    for b in broken:
        print(f"    ✗ {b['where']} → {b['ref']}")
    print()
    print(f"== 存疑模型串(非 LoRA 加载节点、未命中库内实体;不计断链,"
          f"{len(unclassified)} 条) ==")
    for u in unclassified:
        print(f"    ? {u['where']} <{u['type']}> → {u['ref']}")

    if args.json:
        Path(args.json).write_text(json.dumps({
            "inventory": INV,
            "refs": dict(refs),
            "broken": broken,
            "unclassified": unclassified,
            "scanned_files": scanned_files,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n[scan] 机读结果已写 {args.json}")

    print(f"\nBROKEN={len(broken_nodes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
