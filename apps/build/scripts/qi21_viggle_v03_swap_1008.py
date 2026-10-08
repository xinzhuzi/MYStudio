#!/usr/bin/env python3
"""qi21 viggle turbo v0.2.1→v0.3 换件手术(1008;用户令『LoRA 形态直接换文件』)。

范围=仓库真源三个工作流 JSON 内的 LoraLoader 文件名字符串(字节级替换,
零 JSON 重排;恰 N 命中断言 fail-closed):
  1_文生图/qi21-道劫-t2i.json   恰 4 处(7011 list+named 双槽 + [402]Note 双槽)
  2_图生图/qi21-edit.json       恒 2 处
  2_图生图/qi21-道劫-i2i.json   恒 2 处
不碰:3_社区模板/社区-编辑生图整合-TE.json(其 viggle=v0.1 4step r64,采样
调度 4 步制,换 v0.3(6 步制)会错配;留待其自身轮次)。
改前副本=apps/build/scripts/backups/qi21_viggle_v03_1008/。
前置:静默门 mtime≥30min;引擎装新件 Qwen-Image-2.1-viggle-turbo-v0.3-
6step-lora-r256.safetensors 已落 loras(md5 面验)。
后续:pytest 契约门 → canvas_deploy.mjs 热覆盖 → blueprint --check → audit。
"""
import shutil
import sys
import time
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
BAK = REPO / "apps/build/scripts/backups/qi21_viggle_v03_1008"

OLD = "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors"
NEW = "Qwen-Image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors"

# (相对路径, 恰N命中)
TARGETS = [
    ("1_文生图/qi21-道劫-t2i.json", 4),
    ("2_图生图/qi21-edit.json", 2),
    ("2_图生图/qi21-道劫-i2i.json", 2),
]


def main() -> None:
    # 静默门:改前 mtime 距今 ≥30 分钟
    for rel, _n in TARGETS:
        p = WF / rel
        age = time.time() - p.stat().st_mtime
        assert age >= 1800, f"[静默门] {rel} 距上次修改仅 {age/60:.0f} 分钟,可能有并行会话在写,拦停"

    # 新件必须在引擎家 loras 在位(否则换完引用=加载断)
    engine_home = Path.home() / "Project/IP/漫影工作室/comfyui/models/loras"
    assert (engine_home / NEW).exists(), f"[前置] 引擎家缺 {NEW}"
    assert (engine_home / OLD).exists(), "[前置] 旧件 v0.2.1 保留在位(回滚基线)"

    BAK.mkdir(parents=True, exist_ok=True)
    for rel, expect_n in TARGETS:
        p = WF / rel
        text = p.read_text(encoding="utf-8")
        n = text.count(OLD)
        assert n == expect_n, f"[恰N拦停] {rel} 期望 {expect_n} 处,实为 {n} 处"
        assert NEW not in text, f"[拦停] {rel} 已含 v0.3 串(重复手术?)"
        shutil.copy2(p, BAK / p.name)
        new_text = text.replace(OLD, NEW)
        assert new_text.count(NEW) == expect_n, f"[后验] {rel} 替换后计数不符"
        assert new_text.count(OLD) == 0, f"[后验] {rel} 残留旧串"
        p.write_text(new_text, encoding="utf-8")
        print(f"[OK] {rel}: {expect_n} 处 v0.2.1-r256 → v0.3-r256(副本={BAK}/{p.name})")

    # TE 模板必须原样(范围外)
    te = WF / "3_社区模板/社区-编辑生图整合-TE.json"
    assert "viggle-turbo-v0.2.1" not in te.read_text(encoding="utf-8"), "[范围外] TE 出现 v0.2.1=异常"
    print("[OK] TE 模板未动(仍为 v0.1 4step r64,范围外)")
    print("[完] 仓库真源手术毕,进入契约测试+热覆盖阶段")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        sys.exit(1)
