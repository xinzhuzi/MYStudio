#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""工作流详解目录生成器(1119 立,用户令:详解 apps/backend/comfyui/workflows/ 全库并可持续迭代)。

产物:docs/comfyui-kb/工作流详解.md
口径:
- 结构面(节点数/链数/分组/子图/模型件/采样参数/输出口)= 从工作流 JSON 自动提取,重跑即刷新;
- 语义面(功能/在役状态/备注)= CURATED 注记表(本脚本内),人工维护;
- 件数核账真源仍是 docs/comfyui-kb/漫影工作流清单.md + workflow_placement_audit.py,本文档不另立计数权威。

用法:
  python3 apps/build/scripts/workflow_catalog_gen_1119.py            # 生成 md
  python3 apps/build/scripts/workflow_catalog_gen_1119.py --json /tmp/wf_catalog.json  # 只出结构 JSON(调试/对账)
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF_ROOT = REPO / "apps/backend/comfyui/workflows"
OUT_MD = REPO / "docs/comfyui-kb/工作流详解.md"

MODEL_EXT = (".safetensors", ".gguf", ".ckpt", ".pt", ".onnx", ".sft", ".bin", ".pth")
ASSET_EXT = (".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".webm", ".wav", ".mp3", ".flac", ".aac")
SAMPLER_TYPES = ("KSampler", "KSamplerAdvanced", "SamplerCustomAdvanced", "H3AutoContextSampler")
OUTPUT_PREFIX_TYPES = (
    "SaveImage", "SaveImageWithAlpha", "SaveImageAdvanced", "SaveVideo", "SaveAudio",
    "SavePSD", "SaveAnimatedWEBP", "SaveWEBM", "VHS_VideoCombine",
)
NOTE_TYPES = ("MarkdownNote", "Note", "NotePlus")
SKIP_HISTOGRAM_TYPES = {"Reroute", "MarkdownNote", "Note", "NotePlus", "PrimitiveNode"}

# ---------------------------------------------------------------------------
# 语义注记表(人工维护区;键=相对 workflows/ 的路径;缺省件自动落「未注记」)
# status: 在役 / 装机在役 / 存档 / 档案 / 测试 / 参照 / 桥模板
# ---------------------------------------------------------------------------
CURATED: dict[str, dict[str, str]] = {}  # 先置空跑结构面,随后分批填注(见 _fill_curated)


def _fill_curated() -> None:
    from workflow_catalog_notes_1119 import CURATED_NOTES  # noqa: PLC0415

    CURATED.update(CURATED_NOTES)


# ---------------------------------------------------------------------------
# 结构提取
# ---------------------------------------------------------------------------

def _is_api_graph(obj) -> bool:
    if not isinstance(obj, dict) or not obj:
        return False
    vals = [v for v in obj.values() if isinstance(v, dict)]
    return bool(vals) and all("class_type" in v for v in vals)


def _classify(doc: dict) -> str:
    if isinstance(doc.get("nodes"), list):
        return "GUI"
    if _is_api_graph(doc):
        return "API"
    graph = doc.get("graph")
    if isinstance(graph, dict) and _is_api_graph(graph):
        return "桥API"
    return "?"


def _walk_widgets(v, hits: list, kinds: set[str]) -> None:
    """递归收集 widgets/inputs 里像模型文件名/关键参数的字符串。"""
    if isinstance(v, str):
        if v.endswith(MODEL_EXT):
            hits.append(v)
            kinds.add("model")
        elif v.lower().endswith(ASSET_EXT):
            hits.append(v)
            kinds.add("asset")
    elif isinstance(v, (list, tuple)):
        for x in v:
            _walk_widgets(x, hits, kinds)
    elif isinstance(v, dict):
        for x in v.values():
            _walk_widgets(x, hits, kinds)


def _node_center_bbox_hit(node: dict, group: dict) -> bool:
    pos = node.get("pos") or [0, 0]
    size = node.get("size") or [0, 0]
    if not isinstance(pos, list) or len(pos) < 2:
        return False
    bb = group.get("bounding") or [0, 0, 0, 0]
    cx, cy = pos[0] + (size[0] if isinstance(size, list) and size else 0) / 2, pos[1] + (size[1] if isinstance(size, list) and len(size) > 1 else 0) / 2
    return bb[0] <= cx <= bb[0] + bb[2] and bb[1] <= cy <= bb[1] + bb[3]


def _new_sink() -> dict:
    return {"types": Counter(), "models": set(), "assets": set(), "my_nodes": set(),
            "samplers": [], "outputs": [], "note_heads": [], "bypassed": 0, "link_total": 0}


def _harvest_nodes(nodes: list, links: list | None, sink: dict) -> None:
    link_count = len(links) if isinstance(links, list) else None
    for nd in nodes:
        t = nd.get("type", "")
        sink["types"][t] += 1
        if t.startswith("My"):
            sink["my_nodes"].add(t)
        wv = nd.get("widgets_values")
        if wv:
            hits: list[str] = []
            kinds: set[str] = set()
            _walk_widgets(wv, hits, kinds)
            for h in hits:
                if h.endswith(MODEL_EXT):
                    sink["models"].add(h)
                else:
                    sink["assets"].add(h)
        if t == "KSampler" and isinstance(wv, list) and len(wv) >= 7:
            # 官方槽序: seed, control, steps, cfg, sampler, scheduler, denoise
            try:
                sink["samplers"].append(
                    f"{wv[2]}步/cfg{wv[3]}/{wv[4]}/{wv[5]}/dn{wv[6]}"
                )
            except (TypeError, IndexError):
                pass
        elif t == "BasicScheduler" and isinstance(wv, list) and len(wv) >= 3:
            # 槽序: scheduler, steps, denoise(SamplerCustomAdvanced 链的步数真身)
            try:
                sink["samplers"].append(f"σ:{wv[1]}步/{wv[0]}/dn{wv[2]}")
            except (TypeError, IndexError):
                pass
        elif t in SAMPLER_TYPES:
            sink["samplers"].append(t)
        if t in OUTPUT_PREFIX_TYPES:
            prefix = None
            if isinstance(wv, list) and wv and isinstance(wv[0], str):
                prefix = wv[0]
            sink["outputs"].append(f"{t}" + (f"→{prefix}" if prefix else ""))
        if t in NOTE_TYPES and isinstance(wv, list) and wv and isinstance(wv[0], str):
            first = ""
            for line in wv[0].splitlines():
                line = line.strip().lstrip("#").strip()
                if line:
                    first = line[:70]
                    break
            if first:
                sink["note_heads"].append(first)
        if nd.get("mode") not in (None, 0):
            sink["bypassed"] += 1
    if link_count is not None:
        sink["link_total"] += link_count


def _scan_scope(doc: dict) -> dict:
    sink = _new_sink()
    _harvest_nodes(doc.get("nodes", []), doc.get("links"), sink)
    groups = []
    for g in doc.get("groups", []):
        members = Counter(nd.get("type", "?") for nd in doc.get("nodes", []) if _node_center_bbox_hit(nd, g))
        members.pop("Reroute", None)
        flag = ""
        if g.get("muted"):
            flag = "(旁路)"
        elif g.get("buried"):
            flag = "(收起)"
        groups.append((g.get("title", "?"), sum(members.values()), flag, members.most_common()))
    subs = []
    for sg in (doc.get("definitions") or {}).get("subgraphs", []):
        s = _new_sink()
        _harvest_nodes(sg.get("nodes", []), sg.get("links"), s)
        subs.append({
            "name": sg.get("name", "?"),
            "nodes": len(sg.get("nodes", [])),
            "groups": [(g.get("title", "?"), sum(1 for nd in sg.get("nodes", []) if _node_center_bbox_hit(nd, g))) for g in sg.get("groups", [])],
            "models": sorted(s["models"]),
        })
    return {
        "nodes": len(doc.get("nodes", [])),
        "links": len(doc.get("links") or []),
        "groups": groups,
        "subgraphs": subs,
        "models": sorted(sink["models"]),
        "assets": sorted(sink["assets"]),
        "my_nodes": sorted(sink["my_nodes"]),
        "samplers": sink["samplers"],
        "outputs": sink["outputs"],
        "note_heads": sink["note_heads"][:3],
        "bypassed": sink["bypassed"],
        "histogram": [(t, c) for t, c in sink["types"].most_common(12) if t not in SKIP_HISTOGRAM_TYPES],
        "type_total": dict(sink["types"]),
    }


def _scan_api(doc: dict) -> dict:
    graph = doc["graph"] if "graph" in doc and _is_api_graph(doc.get("graph")) else doc
    types = Counter()
    models: set[str] = set()
    assets: set[str] = set()
    my_nodes: set[str] = set()
    outputs, samplers = [], []
    node_count = 0
    for nid, spec in graph.items():
        if not isinstance(spec, dict) or "class_type" not in spec:
            continue  # 桥件混排键(schemaVersion/name/inputs/extra_data 等)
        node_count += 1
        ct = spec["class_type"]
        types[ct] += 1
        if ct.startswith("My"):
            my_nodes.add(ct)
        hits: list[str] = []
        _walk_widgets(spec.get("inputs", {}), hits, set())
        for h in hits:
            (models if h.endswith(MODEL_EXT) else assets).add(h)
        if ct in OUTPUT_PREFIX_TYPES:
            p = spec.get("inputs", {}).get("filename_prefix")
            outputs.append(ct + (f"→{p}" if isinstance(p, str) else ""))
        if ct == "KSampler":
            inp = spec.get("inputs", {})
            samplers.append(f"{inp.get('steps')}步/cfg{inp.get('cfg')}/{inp.get('sampler_name')}/{inp.get('scheduler')}/dn{inp.get('denoise')}")
        elif ct == "BasicScheduler":
            inp = spec.get("inputs", {})
            samplers.append(f"σ:{inp.get('steps')}步/{inp.get('scheduler')}/dn{inp.get('denoise')}")
        elif ct in SAMPLER_TYPES:
            samplers.append(ct)
    return {
        "nodes": node_count, "links": None, "groups": [], "subgraphs": [],
        "models": sorted(models), "assets": sorted(assets), "my_nodes": sorted(my_nodes),
        "samplers": samplers, "outputs": outputs,
        "note_heads": [], "bypassed": 0,
        "histogram": [(t, c) for t, c in types.most_common(12) if t not in SKIP_HISTOGRAM_TYPES],
        "type_total": dict(types),
    }


def scan_file(path: Path) -> dict:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        return {"path": str(path.relative_to(WF_ROOT)), "fmt": "?",
                "error": f"{type(exc).__name__}: {exc}"}
    fmt = _classify(doc)
    scope = _scan_scope(doc) if fmt == "GUI" else _scan_api(doc)
    rel = str(path.relative_to(WF_ROOT))
    return {
        "path": rel,
        "fmt": fmt,
        "size": path.stat().st_size,
        **scope,
    }


# ---------------------------------------------------------------------------
# 文档渲染
# ---------------------------------------------------------------------------

def _fmt_entry(entry: dict) -> list[str]:
    cur = CURATED.get(entry["path"], {})
    desc = cur.get("desc", "")
    status = cur.get("status", "")
    extra = cur.get("note", "")
    lines = [f"#### `{Path(entry['path']).name}`"]
    meta = [entry["fmt"]]
    if entry.get("nodes") is not None:
        meta.append(f"{entry['nodes']} 节点")
    if entry.get("links"):
        meta.append(f"{entry['links']} 链")
    if entry.get("subgraphs"):
        meta.append(f"{len(entry['subgraphs'])} 子图")
    if status:
        meta.append(f"【{status}】")
    lines.append(f"- **形态**:{' · '.join(meta)}")
    if desc:
        lines.append(f"- **功能**:{desc}")
    groups = entry.get("groups") or []
    if groups:
        for t, n, flag, comp in groups:
            comp_s = ""
            if comp:
                top = "、".join(f"{ct}×{c}" for ct, c in comp[:6])
                more = f"等{n}件" if len(comp) > 6 else f"{n}件"
                comp_s = f":{top}({more})"
            lines.append(f"- **分组**:{t}{flag}(罩{comp_s or n})")
    subs = entry.get("subgraphs") or []
    if subs:
        gs = ";".join(f"{s['name']}({s['nodes']}节点)" for s in subs)
        lines.append(f"- **子图**:{gs}")
    hist = entry.get("histogram") or []
    if hist:
        lines.append(f"- **节点构成**:{'、'.join(f'{t}×{c}' for t, c in hist[:8])}")
    mys = entry.get("my_nodes") or []
    if mys:
        lines.append(f"- **自研节点**:{', '.join(mys)}")
    models = entry.get("models") or []
    if models:
        show = [m.split("/")[-1].split("\\")[-1] for m in models][:8]
        more = f"(共{len(models)}件)" if len(models) > 8 else ""
        lines.append(f"- **模型/权重**:{', '.join(show)}{more}")
    assets = entry.get("assets") or []
    if assets:
        show = [a.split("/")[-1].split("\\")[-1] for a in assets][:6]
        more = f"(共{len(assets)}件)" if len(assets) > 6 else ""
        lines.append(f"- **输入素材**:{', '.join(show)}{more}")
    if entry.get("samplers"):
        lines.append(f"- **采样**:{'; '.join(entry['samplers'][:6])}")
    if entry.get("outputs"):
        lines.append(f"- **输出口**:{'; '.join(entry['outputs'][:4])}")
    if entry.get("note_heads"):
        lines.append(f"- **Note 要点**:{' / '.join(entry['note_heads'])}")
    if entry.get("bypassed"):
        lines.append(f"- **旁路节点**:{entry['bypassed']} 个(mode≠0,默认不执行)")
    if extra:
        lines.append(f"- **备注**:{extra}")
    lines.append("")
    return lines


DOMAIN_INTRO = {
    "0_分镜": "**分镜域(零实体裁定)**:运行时不生成逐章/逐镜文件,仓库只留一份通用模板,漫影 App 按当前章数据克隆注入直开;单镜视频由组装器现装直开。",
    "1_图片": "**图片域(六引擎联邦)**:Flux.3 / MiniMax(H3-Image)/ MossImage / QwenImage2.1 / SeeThrough / krea2 六家,按引擎分夹、按功能分子夹。产线主力=QwenImage2.1(qi21 道劫三件+通用件),MiniMax=Win 专用,H3 设定卡族双引擎孪生。",
    "2_视频": "**视频域(H3 视频产线)**:1_漫影自研=正典三件(单镜/一镜到底-分段/导演台);2_固定线/3_超分后处理=产线配套;4_模板/5_云端API=官方登记;6_视频重制=Viggle 在役;7_测试=无具体功能存档;8_数字人=萝卜嫁接双件+原件。",
    "3_声音": "**声音域**:Yue2(音乐三线:BGM 纯音乐/出谱/翻唱,各配 -api 桥)+Drama3(配音双件:文生语音/多角色场景)。",
}


def render(entries: list[dict]) -> str:
    from datetime import date

    out: list[str] = [
        "# 漫影工作流详解(逐件目录)",
        "",
        f"> 生成:{date.today().isoformat()} · 生成器=`apps/build/scripts/workflow_catalog_gen_1119.py`(结构面重跑即刷新,语义面改脚本内 CURATED 注记表)。",
        "> 件数核账真源=[漫影工作流清单.md](漫影工作流清单.md)+`apps/build/scripts/workflow_placement_audit.py`,本文档不另立计数权威;分组罩节点数为画布 bbox 近似读数。",
        "",
    ]
    by_domain: dict[str, list[dict]] = {}
    for e in entries:
        by_domain.setdefault(e["path"].split("/")[0], []).append(e)
    for domain in sorted(by_domain):
        out.append(f"## {domain}")
        out.append("")
        out.append(DOMAIN_INTRO.get(domain, ""))
        out.append("")
        # 按子夹分组
        by_sub: dict[str, list[dict]] = {}
        for e in by_domain[domain]:
            parts = e["path"].split("/")
            sub = "/".join(parts[1:-1]) if len(parts) > 2 else "(夹根)"
            by_sub.setdefault(sub, []).append(e)
        for sub in sorted(by_sub):
            if sub != "(夹根)":
                out.append(f"### {domain}/{sub}({len(by_sub[sub])} 件)")
                out.append("")
            for e in sorted(by_sub[sub], key=lambda x: x["path"]):
                out.extend(_fmt_entry(e))
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", metavar="PATH", help="只出结构 JSON 不写 md")
    args = ap.parse_args()
    if not args.json:
        _fill_curated()
    files = sorted(p for p in WF_ROOT.rglob("*.json") if p.name != ".keep.json")
    entries = [scan_file(p) for p in files]
    bad = [e for e in entries if e.get("error")]
    if args.json:
        Path(args.json).write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{len(entries)} 件结构 JSON → {args.json};解析失败 {len(bad)}")
        for e in bad:
            print(f"  !! {e['path']}: {e['error']}", file=sys.stderr)
        return 0 if not bad else 1
    OUT_MD.write_text(render(entries), encoding="utf-8")
    missing = [e["path"] for e in entries if e["path"] not in CURATED]
    print(f"{len(entries)} 件 → {OUT_MD.relative_to(REPO)};未注记 {len(missing)} 件")
    for m in missing:
        print(f"  - {m}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
