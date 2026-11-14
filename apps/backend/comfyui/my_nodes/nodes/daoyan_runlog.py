# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台运行日志(11-13-director-console-remake 阶段3.5,1114)。

RunLog=双落点记录器:引擎控制台 print(``[daoyan]`` 前缀+时间戳,flush=
my_styles_server.py 装载横幅同款纪律)+章目录 ``video/导演台/{chapter}/
run-log.txt`` 逐行 append(与章草片/章终片同章目录,director_executor
OUT_DIR_ROOT 先例;不撞 list_output 的镜级 prefix glob——run-log.txt 非
p1-draft/p2-final/p3-recavsr 前缀)。

粒度=逐镜×逐阶段×(开始/结束/耗时/产物/错误),每行可独立回答审计一个
gap(1114 可观测审计 fusedBlocks)。纯 pathlib 零引擎依赖=tmp_path 可测;
文件每次 append 现开现关(utf-8,免句柄生命周期,采样中途取消安全)。
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any

PREFIX = "[daoyan]"
LOG_NAME = "run-log.txt"
TIME_FMT = "%H:%M:%S"


def _stamp() -> str:
    return time.strftime(TIME_FMT)


def fmt_value(value: Any) -> str:
    """kv 值规格:bool→true/false(行规格 save=true|false 口径);
    tuple→(6,3);list→[a,b];None→-;其余 str()。"""
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, tuple)):
        inner = ",".join(fmt_value(v) for v in value)
        return f"[{inner}]" if isinstance(value, list) else f"({inner})"
    return str(value)


class RunLog:
    """双落点记录器(控制台+章目录 run-log.txt)。"""

    def __init__(self, chapter: str, out_dir, echo: bool = True):
        self.chapter = str(chapter)
        self.out_dir = Path(out_dir)
        self.path = self.out_dir / "video/导演台" / self.chapter / LOG_NAME
        self.echo = echo
        self._t0: dict[tuple[str, str], float] = {}
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def __call__(self, msg) -> str:
        line = f"{_stamp()} {msg}"
        if self.echo:
            print(f"{PREFIX} {line}", flush=True)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        return line

    def stage(self, seg_id, stage, event, **kv) -> str:
        """结构化阶段行:「<seg> <stage> <event> k=v … [耗时=…]」。

        event=开始 记起点;event=结束 自动补耗时(同 (seg,stage) 键配对)。
        """
        parts = [str(seg_id), str(stage), str(event)]
        parts += [f"{k}={fmt_value(v)}" for k, v in kv.items()]
        key = (str(seg_id), str(stage))
        if str(event) == "开始":
            self._t0[key] = time.monotonic()
        elif str(event) == "结束" and key in self._t0:
            parts.append(f"耗时={time.monotonic() - self._t0.pop(key):.1f}s")
        return self(" ".join(parts))

    def context(self, **kv):
        """带前缀的子记录器(镜/阶段上下文复用同一记录器与文件)。"""
        prefix = " ".join(f"{k}={fmt_value(v)}" for k, v in kv.items())
        parent = self

        class _Sub:
            def __call__(self, msg) -> str:
                return parent((prefix + " " + str(msg)).strip())

            def stage(self, seg_id, stage, event, **kw) -> str:
                return parent.stage(f"{prefix} {seg_id}", stage, event, **kw)

        return _Sub()


class NullRunLog:
    """空记录器:Hooks.open_run_log 缺省时垫位(既有测试构造零破坏)。"""

    chapter = ""

    def __call__(self, msg) -> str:
        return str(msg)

    def stage(self, seg_id, stage, event, **kv) -> str:
        return " ".join(str(x) for x in (seg_id, stage, event))

    def context(self, **kv):  # noqa: ARG002 - 前缀仅占位
        return self
