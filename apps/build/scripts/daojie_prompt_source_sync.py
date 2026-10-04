#!/usr/bin/env python3
"""道劫提示词真源单向同步:daojie_ink_guofeng/json/(唯一真源家) → my_nodes/nodes/(引擎分发产物)。

家规见 apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/README.md:
引擎节点按同目录相对路径读 qi21_bases.json,产物必须随 my_nodes 部署走;
人只改真源,改后跑本脚本;契约测试锁两份逐字节一致,禁手改产物。

用法:
  python3 apps/build/scripts/daojie_prompt_source_sync.py           # 同步(真源→产物)
  python3 apps/build/scripts/daojie_prompt_source_sync.py --check   # 只验不一致即红(门禁用)
"""
import hashlib
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
DST = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    if not SRC.is_file():
        print(f"✗ 真源缺失: {SRC}")
        return 1
    if DST.is_file() and sha(SRC) == sha(DST):
        print(f"✓ 已一致(sha256 {sha(SRC)[:12]}…): {DST.relative_to(REPO)}")
        return 0
    if "--check" in sys.argv:
        print(f"✗ 产物漂移: 真源 {sha(SRC)[:12]}… vs 产物 {sha(DST)[:12] if DST.is_file() else '缺失'}…\n"
              f"  修复: python3 apps/build/scripts/daojie_prompt_source_sync.py")
        return 1
    DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SRC, DST)
    assert sha(SRC) == sha(DST)
    print(f"✓ 同步完成(sha256 {sha(SRC)[:12]}…): {DST.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
