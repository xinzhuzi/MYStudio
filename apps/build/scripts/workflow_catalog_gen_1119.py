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
# 插件依赖反推(节点型→插件家族;前缀/子串匹配,未命中=视为 comfy-core 原生不列)
# ---------------------------------------------------------------------------
PLUGIN_MAP: list[tuple[str, str]] = [
    ("My", "自研my-nodes"),
    ("GemTiled", "ItsGemTools"),
    ("ViggleTurbo", "viggle-turbo"),
    ("VNCCS_", "VNCCS_Utils"),
    ("Dapao", "Dapao-Toolbox"),
    ("Goohai", "Goohaitools/ImageLibrary"),
    ("QwenImagePromptOptimizer", "Goohaitools"),
    ("TextEncodeQwenImage21GH", "Goohaitools"),
    ("RestoreQwenImage21GH", "Goohaitools"),
    ("SeeThrough_", "ComfyUI-See-through"),
    ("H3Face", "ComfyUI-H3-FaceRefine"),
    ("ReCaVSR", "ReCaVSR插件"),
    ("RelayVSR", "Comfyui-Relay-VSR"),
    ("Tessera", "TESSERA插件"),
    ("MiniMaxH3NativeAudioLock", "H3-NativeAudioLock"),
    ("MiniMaxH3MotionContext", "H3-Motion-Context"),
    ("ContextLatentTaperNoise", "H3-Context-Noise"),
    ("H3AutoContextSampler", "H3-Motion-Context"),
    ("Remake", "ComfyUI-Viggle-Remake"),
    ("YuE2", "YuE2插件"),
    ("SheetSage2", "YuE2插件"),
    ("T8Drama", "Comfyui-Drama-3"),
    ("AIO_Preprocessor", "controlnet_aux"),
    ("DWPreprocessor", "controlnet_aux"),
    ("Fisher", "Fisher-Pose"),
    ("QwenFreePose", "Fisher-Pose"),
    ("AnyAngle", "Fisher-Pose"),
    ("PoseResult", "Fisher-Pose"),
    ("RB_", "萝卜自研(未装)"),
    ("ModelPreviewOverrideKJ", "nodes_kt"),
    ("NotePlus", "comfy_mtb"),
    ("DF_Text_Box", "Derfuu"),
    ("SetNode", "Custom-Scripts"),
    ("GetNode", "Custom-Scripts"),
    ("QwenImage21SageAttentionT8", "T8系插件"),
    ("BlockCacheT8", "T8系插件"),
    ("SpectrumT8", "T8系插件"),
    ("easy ", "Easy-Use"),
    ("CR ", "Comfyroll"),
    ("Impact", "Impact-Pack"),
    ("Clownshar", "社区件"),
]
PLUGIN_SUBSTR = [("rgthree", "rgthree")]


def _plugin_deps(type_total: dict[str, int]) -> list[str]:
    deps: list[str] = []
    for t in type_total:
        if "(rgthree)" in t:
            deps.append("rgthree")
            continue
        for pre, label in PLUGIN_MAP:
            if t.startswith(pre):
                deps.append(label)
                break
    return sorted(set(deps) - {"comfy-core"})


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
        elif t == "ManualSigmas" and isinstance(wv, list) and wv and isinstance(wv[0], str):
            npts = wv[0].count(",") + 1 if wv[0] else 0
            sink["samplers"].append(f"ManualSigmas σ表{npts}点")
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
            "id": sg.get("id", ""),
            "nodes": len(sg.get("nodes", [])),
            "comp": [f"{t}×{c}" for t, c in s["types"].most_common(6) if t != "Reroute"],
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
        sub_names = {s.get("id"): f"⟨子图:{s['name']}⟩" for s in entry.get("subgraphs") or [] if s.get("id")}
        for t, n, flag, comp in groups:
            comp_s = ""
            if comp:
                top = "、".join(f"{sub_names.get(ct, ct)}×{c}" for ct, c in comp[:6])
                more = f"等{n}件" if len(comp) > 6 else f"{n}件"
                comp_s = f":{top}({more})"
            lines.append(f"- **分组**:{t}{flag}(罩{comp_s or n})")
    subs = entry.get("subgraphs") or []
    if subs:
        for s in subs:
            comp = "、".join(s.get("comp") or [])[:120]
            lines.append(f"- **子图**:{s['name']}({s['nodes']}节点{':' + comp if comp else ''})")
    deps = _plugin_deps(entry.get("type_total") or {})
    if deps:
        lines.append(f"- **插件依赖**:{', '.join(deps)}")
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
    mm = entry.get("mermaid")
    if mm:
        lines.append("")
        lines.append("**主干数据流图**(关键节点+路径压缩;组=分区;边=连线类型):")
        lines.append("")
        lines.append(mm)
    lines.append("")
    return lines


# ---------------------------------------------------------------------------
# mermaid 主干数据流图(仅白名单正典件;关键节点+路径压缩,组=mermaid subgraph)
# ---------------------------------------------------------------------------
MERMAID_FILES = {
    "2_视频/H3视频/1_漫影自研/单镜.json",
    "2_视频/H3视频/1_漫影自研/一镜到底-分段.json",
    "2_视频/H3视频/1_漫影自研/导演台.json",
    "1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json",
    "1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json",
    "1_图片/QwenImage2.1/1_文生图/t2i-皮肤-超分.json",
    "1_图片/QwenImage2.1/5_角色设定卡/道劫-角色设定卡-t2i.json",
    "1_图片/MiniMax/5_角色设定卡/道劫-角色设定卡.json",
    "1_图片/MossImage/moss-道劫-t2i.json",
    "2_视频/H3视频/8_数字人/数字人-音频驱动.json",
}

_IMP_EXACT = {
    "ComfySwitchNode", "CreateVideo", "ImageCompositor", "SplitImageWithAlpha",
    "BatchImages", "ConcatenateVideo", "JoinImageWithAlpha", "ColorToMask",
}


def _is_imp(t: str) -> bool:
    return bool(
        t
        and (
            t in _IMP_EXACT
            or t.startswith("My")
            or t.startswith("TextEncode")
            or "Loader" in t
            or "LoraLoader" in t
            or "Save" in t
            or t.startswith("VAEDecode")
            or t.startswith("VAEEncode")
            or t.startswith("KSampler")
            or "SamplerCustom" in t
            or "Conditioning" in t
            or "ReferenceToVideo" in t
            or "ImageToVideo" in t
            or "FreePose" in t
            or len(t) == 36 and t.count("-") == 4  # 子图实例(UUID 型名)
        )
    )


def _mm_label(s: str) -> str:
    return s.replace('"', "'").replace("[", "(").replace("]", ")").replace("|", "/")[:60]


def _mermaid_gui(doc: dict) -> str:
    nodes = {nd["id"]: nd for nd in doc.get("nodes", [])}
    sub_by_id = {sg.get("id"): sg.get("name", "?") for sg in (doc.get("definitions") or {}).get("subgraphs", [])}
    adj: dict[int, list[tuple[int, str]]] = {}
    for lk in doc.get("links") or []:
        # GUI links: [link_id, src_id, src_slot, dst_id, dst_slot, type]
        try:
            _, src, _, dst, _, ltype = lk[:6]
        except (ValueError, TypeError):
            continue
        adj.setdefault(src, []).append((dst, ltype))
    imp = {i for i, nd in nodes.items() if _is_imp(nd.get("type", ""))}
    if len(imp) > 55:
        return ""  # 过大不入图
    edges: set[tuple[int, int, str]] = set()
    for a in imp:
        # BFS 穿过非关键节点找下一个关键节点(路径压缩)
        seen = {a}
        frontier = [a]
        for _ in range(6):
            nxt = []
            for cur in frontier:
                for b, lt in adj.get(cur, []):
                    if b in seen or b not in nodes:
                        continue
                    seen.add(b)
                    if b in imp:
                        edges.add((a, b, lt))
                    else:
                        nxt.append(b)
            frontier = nxt
            if not frontier:
                break
    group_of: dict[int, str] = {}
    for g in doc.get("groups", []):
        for i in imp:
            if i in nodes and _node_center_bbox_hit(nodes[i], g):
                group_of.setdefault(i, g.get("title", "?"))
    by_group: dict[str | None, list[int]] = {}
    for i in imp:
        by_group.setdefault(group_of.get(i), []).append(i)
    lines = ["```mermaid", "graph LR"]
    for si, (g, ids) in enumerate(by_group.items()):
        inner = []
        for i in sorted(ids):
            nd = nodes[i]
            t = nd.get("type", "?")
            label = sub_by_id.get(t, nd.get("title") or t)
            inner.append(f'    n{i}["{i} · {_mm_label(label)}"]')
        if g:
            lines.append(f'    subgraph S{si}["「{_mm_label(g)}」"]')
            lines.extend(inner)
            lines.append("    end")
        else:
            lines.extend(inner)
    for a, b, lt in sorted(edges):
        lines.append(f"    n{a} -->|{lt}| n{b}")
    lines.append("```")
    return "\n".join(lines)


def _mermaid_api(doc: dict) -> str:
    graph = doc["graph"] if isinstance(doc.get("graph"), dict) else doc
    items = [(k, v) for k, v in graph.items() if isinstance(v, dict) and "class_type" in v]
    if not items or len(items) > 30:
        return ""
    by_id = {k: v for k, v in items}
    lines = ["```mermaid", "graph LR"]
    for k, v in items:
        lines.append(f'    n{k}["{k} · {_mm_label(v["class_type"])}"]')
    for k, v in items:
        for slot, val in (v.get("inputs") or {}).items():
            if isinstance(val, list) and val and str(val[0]) in by_id:
                lines.append(f'    n{val[0]} -->|{slot}| n{k}')
    lines.append("```")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 族谱聚类(桥件配对 + 子图蓝图共用 + 节点构成余弦相似)
# ---------------------------------------------------------------------------
BRIDGE_ALIASES = {
    "qwen21-道劫-t2i-api": "qi21-道劫-t2i",
    "qwen21-道劫-i2i-api": "qi21-道劫-i2i",
}


def _cosine(a: dict[str, int], b: dict[str, int]) -> float:
    import math

    dot = sum(a.get(k, 0) * b.get(k, 0) for k in set(a) | set(b))
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def _build_families(entries: list[dict]) -> list[str]:
    out = ["## 族谱与共性总览(自动聚类,人工复核后再采信)", ""]
    # ① 桥件配对
    stems = {}
    for e in entries:
        p = e["path"]
        stem = p.rsplit("/", 1)[-1][:-5]
        stems[stem] = p
    pairs = []
    for stem, p in stems.items():
        base = None
        if stem.endswith("-api"):
            base = BRIDGE_ALIASES.get(stem) or stem[:-4]
        if base and base in stems:
            pairs.append((p, stems[base]))
    if pairs:
        out.append("**桥件配对**(GUI 画布件 ↔ API 直投面,改画布件须同步重生成桥):")
        for a, b in pairs:
            out.append(f"- `{a}` ↔ `{b}`")
        out.append("")
    # ② 子图蓝图共用族
    blueprint: dict[str, list[str]] = {}
    for e in entries:
        for s in e.get("subgraphs") or []:
            if s.get("name") and s.get("name") != "New Subgraph" and s.get("nodes", 0) >= 5:
                blueprint.setdefault(s["name"], []).append(e["path"])
    shared = {k: v for k, v in blueprint.items() if len(v) > 1}
    if shared:
        out.append("**子图蓝图共用族**(同名子图=同构蓝图,一处改须全家同步;蓝图真源=my_nodes/subgraphs/):")
        for name in sorted(shared, key=lambda k: -len(shared[k])):
            out.append(f"- 「{name}」×{len(set(shared[name]))}:" + ";".join(f"`{p}`" for p in sorted(set(shared[name]))))
        out.append("")
    # ③ 余弦相似族(≥0.75 并查集聚类)
    parent = list(range(len(entries)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    idx = {e["path"]: i for i, e in enumerate(entries)}
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            if entries[i]["path"].split("/")[0] != entries[j]["path"].split("/")[0]:
                continue
            if _cosine(entries[i].get("type_total") or {}, entries[j].get("type_total") or {}) >= 0.75:
                parent[find(i)] = find(j)
    clusters: dict[int, list[str]] = {}
    for i, e in enumerate(entries):
        clusters.setdefault(find(i), []).append(e["path"])
    fams = [sorted(v) for v in clusters.values() if len(v) > 1]
    fams.sort(key=lambda v: (-len(v), v[0]))
    if fams:
        out.append("**结构相似族**(节点构成余弦 ≥0.75 并查集聚类;=同血缘/克隆/孪生线索,非等价声明;仅列最大 14 族,全量用 --json 对账):")
        for fam in fams[:14]:
            out.append(f"- ({len(fam)}件):" + ";".join(f"`{Path(p).name}`" for p in fam))
        out.append("")
    return out


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
    out.extend(_build_families(entries))
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
    for e in entries:
        if e["path"] in MERMAID_FILES and not e.get("error"):
            doc = json.loads((WF_ROOT / e["path"]).read_text(encoding="utf-8"))
            mm = _mermaid_gui(doc) if e["fmt"] == "GUI" else _mermaid_api(doc)
            if mm:
                e["mermaid"] = mm
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
