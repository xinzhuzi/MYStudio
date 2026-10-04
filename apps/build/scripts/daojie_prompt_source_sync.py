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
HOME = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json"
NODES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes"
# 道劫风格全部机读资产(不分 K2/Q2.1 产线;10-04 用户令:四件收拢,道劫=统一规范第一个实验)
PAIRS = {
    "qi21_bases.json": "Q2.1 九型底座真源(lock_layer/types/PE指令/契约/色卡词典)",
    "qi21_strip_lexicon.json": "Q2.1 清筛正则表(pattern;与 qi21_bases#strip_lexicon 内嵌词表并存非重复)",
    "daojie_lora_stack.json": "K2 LoRA 栈序(14条)",
    "daojie_loras.json": "K2 LoRA 台账(9条)",
}


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    check = "--check" in sys.argv
    rc = 0
    for name, desc in PAIRS.items():
        src, dst = HOME / name, NODES / name
        if not src.is_file():
            print(f"✗ 真源缺失: {src}")
            rc = 1
            continue
        if dst.is_file() and sha(src) == sha(dst):
            print(f"✓ 已一致(sha256 {sha(src)[:12]}…): {name} — {desc}")
            continue
        if check:
            print(f"✗ 产物漂移: {name} — 真源 {sha(src)[:12]}… vs 产物 "
                  f"{sha(dst)[:12] if dst.is_file() else '缺失'}… 修复: 本脚本不带 --check 重跑")
            rc = 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        assert sha(src) == sha(dst)
        print(f"✓ 同步完成(sha256 {sha(src)[:12]}…): {name} — {desc}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
