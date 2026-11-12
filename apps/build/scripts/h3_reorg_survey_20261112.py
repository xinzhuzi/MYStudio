#!/usr/bin/env python3
"""H3视频域重组前普查:逐件节点指纹(只读)。

输出: apps/build/scripts/h3_reorg_survey_20261112.json (全量)
      stdout 摘要表(每件一行)
"""
import json
import os
import sys
import collections

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "..", "..", "backend", "comfyui", "workflows", "2_视频", "H3视频")
ROOT = os.path.normpath(ROOT)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "h3_reorg_survey_20261112.json")

LOADER_HINTS = ("Loader", "LoadCheckpoint", "LoadImage", "LoadVideo", "LoadAudio")


def extract(rel, path):
    info = {"path": rel, "bytes": os.path.getsize(path)}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:  # noqa: BLE001
        info["error"] = f"{type(e).__name__}: {e}"
        return info
    nodes = data.get("nodes", [])
    if isinstance(nodes, dict):
        nodes = list(nodes.values())
    info["title"] = data.get("name", "")
    info["n_nodes"] = len(nodes)
    info["n_links"] = len(data.get("links", []))
    hist = collections.Counter()
    models, loras, images, videos, audios = [], [], [], [], []
    sampler_bits = []
    for n in nodes:
        t = n.get("type", "?")
        hist[t] += 1
        wv = n.get("widgets_values")
        if wv is None:
            continue
        flat = wv if isinstance(wv, list) else [wv]
        strs = [w for w in flat if isinstance(w, str)]
        if "LoraLoader" in t or t.endswith("LoraLoader"):
            loras.extend(strs[:2])
        elif "CheckpointLoader" in t or "UnetLoader" in t or "VAELoader" in t or "CLIPLoader" in t:
            models.extend(strs[:2])
        elif t in ("LoadImage", "ImageLoader") or "LoadImage" in t:
            if strs:
                images.append(strs[0])
        elif "LoadVideo" in t or "VHS_LoadVideo" in t:
            if strs:
                videos.append(strs[0])
        elif "LoadAudio" in t or "VE_LoadAudio" in t:
            if strs:
                audios.append(strs[0])
        if any(k in t for k in ("KSampler", "SamplerCustom", "BasicScheduler", "CFGGuider")):
            nums = [w for w in flat if isinstance(w, (int, float))]
            sampler_bits.append(f"{t}:{nums[:4]}")
    info["classes_top"] = hist.most_common(8)
    info["models"] = sorted(set(models))[:8]
    info["loras"] = sorted(set(loras))[:10]
    info["inputs"] = {"image": images[:3], "video": videos[:2], "audio": audios[:2]}
    info["samplers"] = sampler_bits[:4]
    # 组(group)标记
    groups = data.get("groups", [])
    info["groups"] = [g.get("title", "") for g in groups][:12] if isinstance(groups, list) else []
    return info


def main():
    rows = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames.sort()
        for fn in sorted(filenames):
            if not fn.endswith(".json"):
                rows.append({"path": os.path.relpath(os.path.join(dirpath, fn), ROOT),
                             "note": "NON_JSON"})
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, ROOT)
            rows.append(extract(rel, p))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    print(f"# total files: {len(rows)}  -> {OUT}")
    for r in rows:
        if "note" in r:
            print(f"{r['path']}  [NON_JSON]")
            continue
        if "error" in r:
            print(f"{r['path']}  [ERROR {r['error']}]")
            continue
        m = ",".join(r["models"]) or "-"
        l = ",".join(r["loras"]) or "-"
        cls = ",".join(f"{c}x{n}" for c, n in r["classes_top"][:5])
        print(f"\n== {r['path']}  ({r['bytes']}B, {r['n_nodes']} nodes)")
        print(f"   title: {r['title']}")
        print(f"   classes: {cls}")
        print(f"   models: {m}")
        print(f"   loras: {l}")
        if any(r["inputs"].values()):
            print(f"   inputs: {r['inputs']}")
        if r["groups"]:
            print(f"   groups: {' | '.join(r['groups'][:6])}")


if __name__ == "__main__":
    sys.exit(main())
