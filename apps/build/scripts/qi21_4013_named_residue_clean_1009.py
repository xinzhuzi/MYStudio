#!/usr/bin/env python3
# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""qi21 [4013] MyQi21ApiPE widgets_values_named 外来残留清除手术(1009)。

病灶(1009 实测定谳):[4013] 换装自旧官方 PE 件时,widgets_values_named 槽滞留了
旧件的控件名表(prompt/top_p/max_new_tokens/seed…),与本件六控件
(api_url/model/temperature/max_tokens/timeout_sec/thinking_effort)全对不上——
双槽序列化机制下同名键(temperature=1)有从命名槽复活压掉 positional 真值
(0.7)的前科([4100] 判例);其余 29 节点 named 键均与自身控件一致,唯 4013 错位。

修法:按全文件自身惯例**双写正确 named 槽**(不删键)——键=INPUT_TYPES 声明序,
值=同节点 widgets_values 现值逐位镜像。文本面手术:恰一处正则命中才替换
(fail-closed),除该块外全文件字节不动(布局/连线/linkIds 零波及)。

目标六副本(仓库真源=唯一编辑位;其余四份经 canvas_deploy 热覆盖对齐,本脚本
仅对已漂移副本直接同款手术,幂等可重跑):
  workflows:t2i 仓库 / 装机 / 引擎家用户区
  蓝图  :qi21-提示词类型优化子图 仓库 / 装机 / 引擎家 custom_nodes(回种源,不清则 sync 复灌)

纪律:静默门(目标 mtime 距今≥30min 才动手)+改后结构指纹(节点/连线/组框计数
不变、widgets_values 不变、仅 named 一键变化)+幂等(已清洁=跳过)。
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

HOME = Path.home()
REPO = Path(__file__).resolve().parents[3]
WF_REL = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BP_REL = "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"
APP_RES = Path("/Applications/漫影工作室.app/Contents/Resources/backend")
ENG_HOME = HOME / "Project/IP/漫影工作室/comfyui/ComfyUI"

TARGETS = [
    Path(REPO) / WF_REL,
    APP_RES / WF_REL.removeprefix("apps/backend/"),
    ENG_HOME / "user/default/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    Path(REPO) / BP_REL,
    APP_RES / BP_REL.removeprefix("apps/backend/"),
    ENG_HOME / "custom_nodes/my-nodes/subgraphs/qi21-提示词类型优化子图.json",
]

# 旧官方 PE 件控件名表指纹(九键全量,全文件唯一;[^{}]* 锁死单层平字典)
BAD_RE = re.compile(
    r'"widgets_values_named"\s*:\s*\{[^{}]*?"prompt"\s*:\s*""[^{}]*?'
    r'"max_new_tokens"\s*:\s*16256[^{}]*?"control_after_generate"\s*:\s*"randomize"'
    r'[^{}]*?"thinking_effort"[^{}]*?\}')
GOOD_KEYS = ["api_url", "model", "temperature", "max_tokens", "timeout_sec", "thinking_effort"]
SILENCE_SEC = 30 * 60


def _find_apipe(doc: dict) -> tuple[dict, str]:
    """定位 MyQi21ApiPE 节点(根图或子图定义),返回(节点, 所在域描述)。"""
    def walk(nodes, where):
        for n in nodes:
            if isinstance(n, dict) and n.get("type") == "MyQi21ApiPE":
                return n, where
        return None
    hit = walk(doc.get("nodes", []), "根图")
    if hit:
        return hit
    for sd in (doc.get("definitions") or {}).get("subgraphs", []):
        hit = walk(sd.get("nodes", []), f"子图[{sd.get('name', '')}]")
        if hit:
            return hit
    raise SystemExit("  [中止] 找不到 MyQi21ApiPE 节点")


def _fingerprint(doc: dict) -> tuple:
    """结构指纹:节点/连线/组框计数(根+各子图)。"""
    fps = [len(doc.get("nodes", [])), len(doc.get("links", [])), len(doc.get("groups", []))]
    for sd in (doc.get("definitions") or {}).get("subgraphs", []):
        fps += [len(sd.get("nodes", [])), len(sd.get("links", []))]
    return tuple(fps)


def surgery(path: Path) -> bool:
    label = str(path)
    if not path.is_file():
        print(f"[跳过] 缺席(基线零回灌设计内): {label}")
        return True
    age = time.time() - path.stat().st_mtime
    if age < SILENCE_SEC:
        print(f"[中止] 静默门未过(mtime 距今 {age/60:.0f}min<30min,疑有并行写入): {label}")
        return False
    raw = path.read_text(encoding="utf-8")
    doc = json.loads(raw)
    node, where = _find_apipe(doc)
    wv = node.get("widgets_values")
    if not isinstance(wv, list) or len(wv) != len(GOOD_KEYS):
        print(f"  [中止] widgets_values 形状异常({wv!r}): {label}")
        return False
    hits = BAD_RE.findall(raw)
    named_now = node.get("widgets_values_named")
    if not hits:
        if isinstance(named_now, dict) and list(named_now) == GOOD_KEYS:
            print(f"[已清洁] 幂等跳过: {label}")
            return True
        print(f"  [中止] 残留指纹未命中且非已清洁态(人工核查): {label}")
        return False
    if len(hits) != 1:
        print(f"  [中止] 残留指纹命中 {len(hits)} 处(应恰1,fail-closed): {label}")
        return False
    # 缩进承袭:取残留块自身的键缩进与闭括号缩进,新块同款
    m = BAD_RE.search(raw)
    block = m.group(0)
    lines = block.split("\n")
    key_indent = re.match(r"\s*", lines[1]).group(0)
    close_indent = re.match(r"\s*", lines[-1]).group(0)
    new_lines = ['"widgets_values_named": {']
    for i, (k, v) in enumerate(zip(GOOD_KEYS, wv)):
        comma = "," if i < len(GOOD_KEYS) - 1 else ""  # 承袭原格式:末键前各行带尾逗号
        new_lines.append(f'{key_indent}"{k}": {json.dumps(v, ensure_ascii=False)}{comma}')
    new_lines.append(close_indent + "}")
    new_raw = raw[:m.start()] + "\n".join(new_lines) + raw[m.end():]
    # 改后结构指纹:可解析+计数不变+widgets_values 不变+仅 named 一键变化
    doc2 = json.loads(new_raw)
    assert _fingerprint(doc2) == _fingerprint(doc), "结构指纹漂移"
    node2, _ = _find_apipe(doc2)
    assert node2["widgets_values"] == wv, "widgets_values 漂移"
    assert list(node2["widgets_values_named"]) == GOOD_KEYS, "named 键序异常"
    assert json.dumps(node2["widgets_values_named"], ensure_ascii=False) == \
        json.dumps(dict(zip(GOOD_KEYS, wv)), ensure_ascii=False), "named 值未镜像 widgets_values"
    path.write_text(new_raw, encoding="utf-8")
    print(f"[已修] {where} 4013 named 残留→六键镜像({label})")
    return True


def main() -> int:
    rc = 0
    for p in TARGETS:
        if not surgery(p):
            rc = 1
    print("手术完成" if rc == 0 else "存在未过门目标(见上)", f"exit={rc}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
