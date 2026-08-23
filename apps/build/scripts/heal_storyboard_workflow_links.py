#!/usr/bin/env python3
"""T5: 分镜挂图→工作流成图断链主动愈合(一次性,离线跑,参照 direct_storyboard_images.py 风格)。

形态: 分镜 mediaRef 有图,对应工作流的 generated 节点 resultUrl 全空(旁路直写
store 导致 UI 双态不一致;2026-08-23 审计道劫 4 镜: 57/58/60/62)。
逻辑复刻 lib/studio/image-workflow/writeback.ts ensureStoryboardImageResult +
setGeneratedImageResult: 首个无结果 generated 节点补挂 mediaRef.path。

不动: 「分镜有图但从未建流」(17 镜,63+)——非断链,分镜面板展示不受影响,
逐镜进流时自然建。manifest 不动(stamp 命名非内容哈希,分片集合不变)。

用法: python3 heal_storyboard_workflow_links.py [--apply]   # 默认 dry-run
前置: 应用必须未运行(分片增量写轮换,离线写才安全);自动整目录备份。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path("/Users/zhengbingjin/Project/IP/MA")
STORE_DIR = PROJECT_ROOT / "store" / "studio-workflow"


def load_shards(manifest_shards: set[str] | None = None) -> list[Path]:
    """只取 manifest 列出的活分片。store 树内嵌有历史备份目录(bak-*,manifest
    不列,应用不读)——无过滤会误改备份快照(08-23 实证:4 工作流双写)。"""
    files: list[Path] = []
    for root, _dirs, names in os.walk(STORE_DIR):
        for name in names:
            if not name.endswith(".json") or name == "manifest.json":
                continue
            path = Path(root) / name
            if manifest_shards is not None:
                rel = path.relative_to(STORE_DIR).as_posix()
                if rel not in manifest_shards:
                    continue
            files.append(path)
    return files


def manifest_shard_names() -> set[str] | None:
    try:
        manifest = json.loads((STORE_DIR / "manifest.json").read_text(encoding="utf-8"))
        return set(manifest.get("shards") or [])
    except Exception:
        return None


def collect_state(shards: list[Path]) -> tuple[dict, dict]:
    sb_by_id: dict[str, dict] = {}
    wf_by_storyboard: dict[str, dict] = {}
    wf_by_id: dict[str, dict] = {}
    for shard in shards:
        try:
            data = json.loads(shard.read_text(encoding="utf-8"))
        except Exception:
            continue
        state = data.get("state", data)
        if not isinstance(state, dict):
            continue
        for sb in state.get("storyboards") or []:
            if isinstance(sb, dict) and sb.get("id"):
                sb_by_id[sb["id"]] = sb
        for wf in state.get("imageWorkflows") or []:
            if not isinstance(wf, dict) or not wf.get("id"):
                continue
            wf_by_id[wf["id"]] = wf
            target = wf.get("target") or {}
            if target.get("kind") == "storyboard" and target.get("id"):
                wf_by_storyboard[target["id"]] = wf
    return sb_by_id, {**wf_by_id, **wf_by_storyboard}


def find_broken(sb_by_id: dict, wf_lookup: dict) -> list[dict]:
    broken = []
    for sid, sb in sb_by_id.items():
        media = sb.get("mediaRef") or {}
        if media.get("kind") != "image" or not media.get("path"):
            continue
        wf = wf_lookup.get(sid) or wf_lookup.get(media.get("imageWorkflowId") or sb.get("imageWorkflowId", ""))
        if not wf:
            continue
        gens = [n for n in wf.get("nodes", []) if n.get("type") == "generated"]
        if gens and not any(n.get("resultUrl") for n in gens):
            broken.append({"storyboard": sid, "index": sb.get("index"), "workflow": wf["id"], "path": media["path"]})
    return sorted(broken, key=lambda item: item["index"] or 0)


def heal(shards: list[Path], broken: list[dict], sb_by_id: dict, apply: bool) -> int:
    target_wf_ids = {item["workflow"] for item in broken}
    healed = 0
    for shard in shards:
        try:
            data = json.loads(shard.read_text(encoding="utf-8"))
        except Exception:
            continue
        state = data.get("state", data)
        if not isinstance(state, dict):
            continue
        workflows = state.get("imageWorkflows")
        if not isinstance(workflows, list):
            continue
        changed = False
        for wf in workflows:
            if not isinstance(wf, dict) or wf.get("id") not in target_wf_ids:
                continue
            sid = (wf.get("target") or {}).get("id")
            sb = sb_by_id.get(sid) or {}
            media_path = (sb.get("mediaRef") or {}).get("path")
            if not media_path:
                continue
            node = next((n for n in wf.get("nodes", []) if n.get("type") == "generated" and not n.get("resultUrl")), None)
            if node is None:
                continue
            now = int(time.time() * 1000)
            node["resultUrl"] = media_path
            node["status"] = "ready"
            node["updatedAt"] = now
            node["generatedAt"] = now
            node.pop("errorReason", None)
            wf["updatedAt"] = now
            changed = True
            healed += 1
            print(f"heal: 分镜{sb.get('index')} {sid} -> {wf['id']} node {node['id']}")
        if changed and apply:
            shard.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return healed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="实写(默认 dry-run)")
    args = parser.parse_args()

    running = subprocess.run(["pgrep", "-f", "漫影工作室"], capture_output=True, text=True)
    if running.returncode == 0:
        sys.exit("应用正在运行——分片增量写会轮换文件名,必须退出应用后离线跑")

    active = manifest_shard_names()
    if active is None:
        sys.exit("manifest 读取失败——拒跑")
    shards = load_shards(active)
    sb_by_id, wf_lookup = collect_state(shards)
    broken = find_broken(sb_by_id, wf_lookup)
    print(f"审计: 分镜 {len(sb_by_id)}, 断链 {len(broken)} 镜")
    for item in broken:
        print(f"  分镜{item['index']} {item['storyboard']} -> {item['workflow']}")
    if not broken:
        print("无可愈合项")
        return

    if not args.apply:
        print("dry-run 结束(未写盘);加 --apply 执行")
        return

    backup = STORE_DIR.parent / f"studio-workflow.bak-heal-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copytree(STORE_DIR, backup)
    print(f"备份: {backup}")

    healed = heal(shards, broken, sb_by_id, apply=True)
    print(f"已补挂 {healed} 镜")

    # 复扫验证
    shards2 = load_shards(active)
    sb2, wf2 = collect_state(shards2)
    remain = find_broken(sb2, wf2)
    print(f"复扫: 剩余断链 {len(remain)} 镜")
    if remain:
        sys.exit("仍有断链——检查备份回滚: 备份目录见上")


if __name__ == "__main__":
    main()
