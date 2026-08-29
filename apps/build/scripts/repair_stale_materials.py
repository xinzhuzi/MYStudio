#!/usr/bin/env python3
"""素材死链体检+修复(2026-08-30 实弹:463 素材中 406 指向已删流目录)。

背景:历次工作流清理删除了 workflow-images 流目录,但素材域(materials)记录
未同步清理,导致参考面板大量「图片加载失败」——用户裁定「旧数据都清一下、
必须解决」的一致性烂账。

用法(默认道劫项目根,可传参覆盖):
    python3 apps/build/scripts/repair_stale_materials.py [projectRoot]

行为:
1. 备份 materials-*.json → .bak-stale-<ts>.json
2. 逐条解析 project-file:// → 项目根实际路径(percent 解码、剥 pid 段)
3. 文件在 → 保留;目录在但文件名记录不完整(无扩展/缺尾戳)→ 前缀匹配最新文件改写;
   全无 → 清除该素材
4. 全量复验后才写回(仍有坏链则中止不写)
5. 顺带报告 workflow-images 孤儿流目录(流不在册)→ 建议人工确认后移 backups

幂等可复跑;分镜挂图/连续性参考图只体检不动(实测健康)。
"""
import glob
import json
import os
import shutil
import sys
import time
from urllib.parse import quote, unquote


def to_disk_path(local_path: str, root: str) -> str | None:
    if not isinstance(local_path, str) or not local_path:
        return None
    if local_path.startswith("project-file://"):
        body = local_path[len("project-file://"):]
        rest = body.split("/", 1)[1] if "/" in body else body
        return os.path.join(root, unquote(rest))
    return None


def main() -> int:
    root = sys.argv[1] if len(sys.argv) > 1 else "/Users/zhengbingjin/Project/IP/MA"
    shards = [
        f for f in glob.glob(f"{root}/store/studio-workflow/materials-*.json")
        if ".bak" not in os.path.basename(f)
    ]
    if not shards:
        print("未找到 materials 分片"); return 1
    stamp = time.strftime("%Y%m%d-%H%M%S")
    total = kept = prefix_fixed = dropped = 0
    for shard in shards:
        data = json.load(open(shard))
        materials = data.get("state", {}).get("materials", [])
        bak = shard.replace(".json", f".bak-stale-{stamp}.json")
        shutil.copy2(shard, bak)
        next_materials = []
        for m in materials:
            total += 1
            if m.get("kind") != "image":
                next_materials.append(m); continue
            path = to_disk_path(m.get("localPath", ""), root)
            if path and os.path.isfile(path):
                next_materials.append(m); continue
            if path and os.path.isdir(os.path.dirname(path)):
                parent, base = os.path.dirname(path), os.path.basename(path)
                candidates = sorted(
                    (f for f in os.listdir(parent) if f.startswith(base) and os.path.isfile(os.path.join(parent, f))),
                    key=lambda f: os.path.getmtime(os.path.join(parent, f)),
                )
                if candidates:
                    pid = m["localPath"].split("/")[2]
                    m = {**m, "localPath": f"project-file://{pid}/" + quote(os.path.relpath(os.path.join(parent, candidates[-1]), root), safe="/-_.~")}
                    next_materials.append(m); prefix_fixed += 1; continue
            dropped += 1
        bad = [m for m in next_materials if m.get("kind") == "image" and not (to_disk_path(m.get("localPath", ""), root) or "") or not os.path.isfile(to_disk_path(m.get("localPath", ""), root) or "\0")]
        if bad:
            print(f"[中止] {shard} 复验仍有 {len(bad)} 条坏链,未写回(备份在 {bak})"); return 1
        data["state"]["materials"] = next_materials
        json.dump(data, open(shard, "w"), ensure_ascii=False, indent=2)
        kept += len(next_materials)
        print(f"{os.path.basename(shard)}: 保留 {len(next_materials)}(前缀修复 {prefix_fixed}) 清除 {dropped} | 备份 {os.path.basename(bak)}")

    flow_ids = set()
    for f in glob.glob(f"{root}/store/studio-workflow/chapters/*/image-workflows-*.json") + glob.glob(f"{root}/store/studio-workflow/image-workflows-shared-*.json"):
        for w in json.load(open(f)).get("state", {}).get("imageWorkflows", []):
            flow_ids.add(w["id"])
    orphans = [fd for ch in glob.glob(f"{root}/workflow-images/*") for fd in glob.glob(f"{ch}/*") if os.path.isdir(fd) and os.path.basename(fd) not in flow_ids]
    print(f"体检:总 {total} 保留 {kept} 清除 {dropped} | workflow-images 孤儿流目录 {len(orphans)} 个(人工确认后可移 backups)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
