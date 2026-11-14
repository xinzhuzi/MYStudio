# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""RunLog 双落点测试(11-13-director-console-remake 阶段3.5,1114)。

被测对象 = my_nodes/nodes/daoyan_runlog.py(纯 pathlib 零引擎依赖):
- 双落点:同一条行同时现于 capsys stdout([daoyan] 前缀)与
  tmp run-log.txt(章目录 video/导演台/{chapter}/run-log.txt)
- 行格式:stage() 结构化行(镜id/阶段/事件/kv)+结束行自动补耗时+产物
- context() 子记录器前缀;NullRunLog 空记录器零副作用
"""
from __future__ import annotations

import time

from comfyui.my_nodes.nodes.daoyan_runlog import NullRunLog, RunLog


def test_dual_sink_plain_line(tmp_path, capsys):
    log = RunLog("chapter-b001", tmp_path, echo=True)
    assert log.path == tmp_path / "video/导演台" / "chapter-b001" / "run-log.txt"
    log("hello 导演台")
    out = capsys.readouterr().out
    assert "[daoyan] " in out and "hello 导演台" in out  # 控制台落点
    text = log.path.read_text(encoding="utf-8")
    assert "hello 导演台" in text  # 文件落点


def test_stage_start_end_duration_and_artifact(tmp_path, capsys):
    log = RunLog("c", tmp_path)
    log.stage("第1镜(sb-01)", "一采", "开始", mode="r2v", seed=42, save=True)
    time.sleep(0.02)
    log.stage("第1镜(sb-01)", "一采", "结束", ok=1, 产物="video/x.mp4")
    text = log.path.read_text(encoding="utf-8")
    assert "第1镜(sb-01) 一采 开始 mode=r2v seed=42 save=true" in text
    end = [line for line in text.splitlines() if "结束" in line][0]
    assert "ok=1" in end and "产物=video/x.mp4" in end
    assert "耗时=" in end  # 结束行自动补耗时(同 seg/stage 键配对)
    assert "第1镜(sb-01) 一采 开始" in capsys.readouterr().out  # 双落点


def test_stage_kv_value_formats(tmp_path):
    log = RunLog("c", tmp_path, echo=False)
    log.stage("s1", "二采", "开始", sigma=(12, 3), frames=107, refs=None)
    text = log.path.read_text(encoding="utf-8")
    assert "sigma=(12,3)" in text and "frames=107" in text
    assert "refs=-" in text  # None→-


def test_context_sublogger_prefix(tmp_path):
    log = RunLog("c", tmp_path, echo=False)
    sub = log.context(镜="sb-01", 阶段="一采")
    sub("hello")
    text = log.path.read_text(encoding="utf-8")
    assert "镜=sb-01 阶段=一采 hello" in text


def test_null_log_noop(tmp_path, capsys):
    null = NullRunLog()
    assert null("x") == "x"
    null.stage("s", "一采", "开始", seed=1)
    null.context(镜="a")
    assert capsys.readouterr().out == ""  # 零 console
    assert not list(tmp_path.iterdir())  # 零文件副作用
