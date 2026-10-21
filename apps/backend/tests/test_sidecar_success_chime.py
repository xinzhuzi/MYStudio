"""sidecar 出图完成提示音(1021 用户令:出图必响一声,只响成功)。

契约:渲染层带 X-Manying-Chime-Suppress=1 时 sidecar 跳过(渲染层已自响
防双响);直连脚本/引擎侧 JS 不带头,成功即 afplay(仅 macOS,1s 节流)。
"""

from email.message import Message

from image_gen import server as image_server

_SUPPRESS = image_server._CHIME_SUPPRESS_HEADER


def _headers(value):
    msg = Message()
    if value is not None:
        msg[_SUPPRESS] = value
    return msg


def test_suppress_header_skips_chime():
    assert image_server.should_play_success_chime(_headers("1")) is False
    assert image_server.should_play_success_chime(_headers(" 1 ")) is False


def test_missing_or_nonone_header_plays():
    assert image_server.should_play_success_chime(_headers(None)) is True
    assert image_server.should_play_success_chime(_headers("0")) is True
    assert image_server.should_play_success_chime(_headers("true")) is True


def test_play_chime_throttles_within_window(monkeypatch):
    calls = []
    monkeypatch.setattr(image_server, "_last_chime_monotonic", 0.0)
    monkeypatch.setattr(image_server.subprocess, "Popen", lambda *a, **k: calls.append(a))
    clock = {"now": 100.0}
    monkeypatch.setattr(image_server.time, "monotonic", lambda: clock["now"])

    image_server.play_generation_success_chime()
    image_server.play_generation_success_chime()  # 节流窗内,不响
    clock["now"] = 101.5
    image_server.play_generation_success_chime()  # 出窗再响

    assert len(calls) == 2
    assert calls[0][0] == ["afplay", "/System/Library/Sounds/Glass.aiff"]
