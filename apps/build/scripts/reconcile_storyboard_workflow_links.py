#!/usr/bin/env python3
"""分镜↔工作流软性错位对齐(08-24 晚,镜15/59 类:工作流持有更新版,分镜挂旧版)。

规则(与产品单镜生成回写口径一致):
1. 对每个已生成分镜,若其工作流 generated 节点 resultUrl 指向的文件存在且
   生成时间戳更新,则把分镜 mediaRef.path 对齐到 resultUrl(state=ready);
2. 顺带清理 store 中指向不存在文件的 evidencePaths/reviewEvidencePaths 死条目(数组元素级);
3. 备份被改文件(bak-align-<ts>),--dry 预演。须退出应用执行。
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import unquote

ROOT = Path("/Users/zhengbingjin/Project/IP/MA")
STORE = ROOT / "store/studio-workflow"
PID = "49dce4c1-64b1-42de-85c2-9f266698aec4"
ABS = re.compile(r"^file:///Users/|^/Users/")


def gen_ts(url: str) -> int:
    parts = unquote(url).split("-")
    for seg in reversed(parts):
        if seg.isdigit() and len(seg) == 13:
            return int(seg)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true")
    args = parser.parse_args()

    shards = sorted(STORE.glob("chapters/*/storyboards-*.json"))
    wf_graphs: dict[str, dict] = {}
    for f in sorted(STORE.glob("chapters/*/image-workflows-*.json")):
        for g in json.loads(f.read_text())["state"]["imageWorkflows"]:
            wf_graphs[g["id"]] = g

    aligned = skipped = 0
    changed: list[Path] = []
    for shard in shards:
        data = json.loads(shard.read_text())
        state = data["state"]
        dirty = False
        for s in state.get("storyboards", []):
            mr = s.get("mediaRef")
            if not (isinstance(mr, dict) and mr.get("kind") == "image"):
                continue
            g = wf_graphs.get(mr.get("imageWorkflowId"))
            if not g:
                continue
            node = next((n for n in g.get("nodes", []) if n.get("id") == mr.get("imageWorkflowNodeId")), None)
            ru = node.get("resultUrl") if node else None
            if not ru or ru == mr.get("path"):
                continue
            rel = unquote(ru.split(f"project-file://{PID}/")[-1]) if ru.startswith("project-file") else None
            if not rel or not (ROOT / rel).is_file():
                skipped += 1
                print(f"[跳过] 镜{s['index']}: resultUrl 文件缺失")
                continue
            if gen_ts(ru) > gen_ts(mr.get("path", "")):
                print(f"[对齐] 镜{s['index']}: mediaRef -> resultUrl 新版")
                mr["path"] = ru
                s["state"] = "ready"
                aligned += 1
                dirty = True
            else:
                skipped += 1
        if dirty:
            changed.append(shard)
            if not args.dry:
                shard.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    # 死证据条目清理(数组元素级,只删指向不存在文件的绝对路径项)
    dead_dropped = 0
    for f in sorted(STORE.glob("assets-versions-*.json")):
        data = json.loads(f.read_text())
        dirty = False
        def clean_versions(versions):
            nonlocal dead_dropped, dirty
            for v in versions:
                for key in ("evidencePaths", "reviewEvidencePaths"):
                    arr = v.get(key)
                    if not isinstance(arr, list):
                        continue
                    keep = []
                    for item in arr:
                        if isinstance(item, str) and ABS.match(item) and not Path(unquote(item[7:] if item.startswith('file://') else item)).is_file():
                            dead_dropped += 1
                            dirty = True
                            continue
                        keep.append(item)
                    v[key] = keep
                ap = v.get("approval")
                if isinstance(ap, dict) and isinstance(ap.get("evidencePaths"), list):
                    keep = []
                    for item in ap["evidencePaths"]:
                        if isinstance(item, str) and ABS.match(item) and not Path(unquote(item[7:] if item.startswith('file://') else item)).is_file():
                            dead_dropped += 1
                            dirty = True
                            continue
                        keep.append(item)
                    ap["evidencePaths"] = keep
        clean_versions(data.get("state", data).get("continuityAssetVersions", []))
        if dirty:
            changed.append(f)
            if not args.dry:
                f.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    if not args.dry and changed:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = STORE.parent / f"studio-workflow.bak-align-{stamp}"
        for f in changed:
            dest = backup / f.relative_to(STORE)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dest)
        print(f"备份 {len(changed)} 个文件 -> {backup}")
    print(("完成: " if not args.dry else "[dry] ") + f"对齐 {aligned} 镜;死证据清理 {dead_dropped} 条;跳过 {skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
