# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""open_receipt_server 收据路由契约测试(LF21:opener mode 收据通道,1015)。

缝(TDD 预约):sanitize_receipt / receipt_print_line / append_receipt 纯函数面
+ handle_open_receipt 请求面(鸭子类型 request,零真服务)
+ install() 挂载面(假 server 模块注入,零引擎依赖,sidecar 直跑)。

跑法:cd apps/backend && python3 -m pytest comfyui/my_nodes/tests/test_open_receipt_server.py -q
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
import types

from comfyui.my_nodes import open_receipt_server as ors

PAYLOAD = {
    "ts": "2026-10-15T08:09:10.000Z",
    "name": "0_分镜/分镜工作流.json",
    "mode": "kept-modified",
    "ok": True,
}


import pytest


@pytest.fixture(autouse=True)
def _isolated_throttle_state():
    """节流状态逐用例隔离(模块级 (mode,name,ok) 连续去重是生产语义,测试间必须清零)。"""
    ors._reset_throttle_state()
    yield
    ors._reset_throttle_state()


def test_01_sanitize_valid_payload_exact_fields():
    assert ors.sanitize_receipt(PAYLOAD) == PAYLOAD


def test_02_sanitize_non_dict_returns_none():
    assert ors.sanitize_receipt(["x"]) is None
    assert ors.sanitize_receipt("kept-modified") is None
    assert ors.sanitize_receipt(None) is None


def test_03_sanitize_requires_nonempty_mode():
    assert ors.sanitize_receipt({**PAYLOAD, "mode": ""}) is None
    body = dict(PAYLOAD)
    body.pop("mode")
    assert ors.sanitize_receipt(body) is None


def test_04_sanitize_caps_lengths_flood_guard():
    out = ors.sanitize_receipt(
        {"mode": "m" * 999, "name": "n" * 9999, "ts": "t" * 999, "ok": True}
    )
    assert out is not None
    assert len(out["mode"]) <= 64
    assert len(out["name"]) <= 512
    assert len(out["ts"]) <= 64


def test_05_receipt_print_line_exact_format():
    line = ors.receipt_print_line(PAYLOAD)
    assert line == (
        "[MY开单] mode=kept-modified "
        "name=0_分镜/分镜工作流.json ts=2026-10-15T08:09:10.000Z"
    )


def test_06_receipt_print_line_strips_newlines_in_name():
    line = ors.receipt_print_line({**PAYLOAD, "name": "a\n[MY开单] 伪造行"})
    assert "\n" not in line  # engine.log 行不可被 payload 内容伪造分段


def test_06b_receipt_print_line_strips_newlines_in_mode():
    # 复核员 finding1 pin(1015):mode 同为必填外部可控字段,须与 name/ts 同闸——
    # 漏闸实证:夹 \n 后 receipt_print_line 输出两行,第二行伪造
    # "[MY开单] mode=library-bound name=伪造.json ts=0 name= ts="。
    # 闸=去换行:注入文本以空格内联保留(惰性),攻击面=行分裂,行不分裂即死。
    line = ors.receipt_print_line({**PAYLOAD, "mode": "named-temp\n[MY开单] mode=library-bound"})
    assert "\n" not in line
    assert line.startswith("[MY开单] mode=named-temp ")  # 真字段存活且恰居行首


def test_06c_sanitize_strips_newlines_in_mode_intake():
    # 进料闸双保险:合法路径(handle_open_receipt→sanitize_receipt)mode 先洗
    # 再落 JSONL/stdout,收据 mode 恒单行洁癖
    out = ors.sanitize_receipt({**PAYLOAD, "mode": "named-temp\n[MY开单] mode=library-bound"})
    assert "\n" not in out["mode"]
    assert "\r" not in out["mode"]


def test_07_append_receipt_writes_jsonl_appends_and_prints(tmp_path, capsys):
    path = ors.append_receipt(PAYLOAD, logs_dir=tmp_path)
    assert path is not None and path.exists()
    assert path.name == f"open-receipts-{time.strftime('%Y%m%d')}.log"
    lines = path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 1
    assert json.loads(lines[0]) == PAYLOAD  # JSONL 行逐字回读
    # 追加不覆写
    ors.append_receipt({**PAYLOAD, "mode": "library-bound"}, logs_dir=tmp_path)
    lines2 = path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines2) == 2
    assert json.loads(lines2[1])["mode"] == "library-bound"
    # stdout 线:引擎 stdout 即 engine.log 同源(仿 [MY出图] 实证线)
    out = capsys.readouterr().out
    assert "[MY开单]" in out
    assert "mode=kept-modified" in out


def test_08_append_receipt_fail_open(tmp_path):
    blocker = tmp_path / "file.txt"
    blocker.write_text("x", encoding="utf-8")
    # 落点挂在普通文件下 → mkdir/open 必炸 → 静默 None,绝不抛
    assert ors.append_receipt(PAYLOAD, logs_dir=blocker / "sub") is None


def _fake_server_module():
    from aiohttp import web

    class _PromptServer:
        instance = types.SimpleNamespace(routes=web.RouteTableDef())

    return types.SimpleNamespace(PromptServer=_PromptServer)


def test_09_install_mounts_post_route_and_is_idempotent(monkeypatch):
    fake = _fake_server_module()
    monkeypatch.setitem(sys.modules, "server", fake)
    monkeypatch.setattr(ors, "_installed", False)
    ors.install()
    routes = list(fake.PromptServer.instance.routes)
    assert len(routes) == 1
    assert routes[0].method == "POST"
    assert routes[0].path == "/my_bridge/open_receipt"
    ors.install()  # 幂等:第二次不重复挂载
    assert len(list(fake.PromptServer.instance.routes)) == 1


def test_10_install_without_server_fail_open(monkeypatch):
    monkeypatch.setitem(sys.modules, "server", None)  # None → import 失败
    monkeypatch.setattr(ors, "_installed", False)
    ors.install()  # 零抛(sidecar 无引擎时挂载失败静默,不挡节点装载)
    assert ors._installed is False


class _Req:
    def __init__(self, body, bad=False):
        self._body = body
        self._bad = bad

    async def json(self):
        if self._bad:
            raise ValueError("not json")
        return self._body


def test_11_handler_ok_returns_200(tmp_path):
    resp = asyncio.run(ors.handle_open_receipt(_Req(dict(PAYLOAD)), logs_dir=tmp_path))
    assert resp.status == 200
    assert json.loads(resp.text) == {"ok": True}
    files = list(tmp_path.glob("open-receipts-*.log"))
    assert len(files) == 1


def test_12_handler_bad_json_400(tmp_path):
    resp = asyncio.run(ors.handle_open_receipt(_Req(None, bad=True), logs_dir=tmp_path))
    assert resp.status == 400
    assert list(tmp_path.glob("open-receipts-*.log")) == []


def test_13_handler_missing_mode_400(tmp_path):
    body = dict(PAYLOAD)
    body.pop("mode")
    resp = asyncio.run(ors.handle_open_receipt(_Req(body), logs_dir=tmp_path))
    assert resp.status == 400
    assert list(tmp_path.glob("open-receipts-*.log")) == []


def test_14_throttle_suppresses_consecutive_same_key_success(tmp_path):
    """节流主语义(LF23 用户令):连续同款 (mode,name,ok=True) 收据=保鲜链 tick
    (约 12 条/分钟),静默计数不落盘;首条恒落盘。"""
    p1 = ors.append_receipt(PAYLOAD, logs_dir=tmp_path)
    assert p1 is not None
    p2 = ors.append_receipt({**PAYLOAD, "ts": "…tick2"}, logs_dir=tmp_path)
    assert p2 is None  # 同款静默
    lines = (tmp_path / f"open-receipts-{time.strftime('%Y%m%d')}.log").read_text(
        encoding="utf-8"
    ).strip().split("\n")
    assert len(lines) == 1


def test_15_throttle_counts_then_flushes_on_mode_change(tmp_path, capsys):
    """静默计数在下一条不同收据兑现:JSONL suppressed 字段+stdout 节流×N 尾注。"""
    ors.append_receipt(PAYLOAD, logs_dir=tmp_path)
    ors.append_receipt({**PAYLOAD, "ts": "t2"}, logs_dir=tmp_path)
    ors.append_receipt({**PAYLOAD, "ts": "t3"}, logs_dir=tmp_path)
    out = capsys.readouterr().out
    path = ors.append_receipt({**PAYLOAD, "mode": "named-temp-refreshed", "ts": "t4"}, logs_dir=tmp_path)
    assert path is not None
    lines = path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 2
    assert json.loads(lines[1])["suppressed"] == 2
    assert "节流×2" in capsys.readouterr().out


def test_16_failures_never_throttled(tmp_path):
    """ok 非 True(失败/未知)恒落盘——信号永不丢。"""
    ors.append_receipt(PAYLOAD, logs_dir=tmp_path)
    assert ors.append_receipt({**PAYLOAD, "ok": False, "ts": "f1"}, logs_dir=tmp_path) is not None
    assert ors.append_receipt({**PAYLOAD, "ok": False, "ts": "f2"}, logs_dir=tmp_path) is not None  # 连续失败也各落
    assert ors.append_receipt(PAYLOAD, logs_dir=tmp_path) is not None  # key 变化(失败→成功)照落
    lines = (tmp_path / f"open-receipts-{time.strftime('%Y%m%d')}.log").read_text(
        encoding="utf-8"
    ).strip().split("\n")
    assert len(lines) == 4


def test_17_engine_restart_clears_throttle(tmp_path):
    """引擎重启天然清零(复位函数语义):重启后首条同款收据恒落盘。"""
    ors.append_receipt(PAYLOAD, logs_dir=tmp_path)
    ors._reset_throttle_state()
    assert ors.append_receipt({**PAYLOAD, "ts": "after-restart"}, logs_dir=tmp_path) is not None
    lines = (tmp_path / f"open-receipts-{time.strftime('%Y%m%d')}.log").read_text(
        encoding="utf-8"
    ).strip().split("\n")
    assert len(lines) == 2


def test_18_ok_none_never_throttled(tmp_path):
    """ok 缺失(未知态)不参与节流——未知恒落盘。"""
    body = dict(PAYLOAD)
    body.pop("ok")
    assert ors.append_receipt(ors.sanitize_receipt(body), logs_dir=tmp_path) is not None
    assert ors.append_receipt(ors.sanitize_receipt(body), logs_dir=tmp_path) is not None
    lines = (tmp_path / f"open-receipts-{time.strftime('%Y%m%d')}.log").read_text(
        encoding="utf-8"
    ).strip().split("\n")
    assert len(lines) == 2
