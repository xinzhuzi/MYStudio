# 1009 Mac 27B MLX 回落路由短路回归锁:该服务(content 恒空/答案全落
# reasoning_content,reasoning_effort=none 亦不改道)命中时,思考尾已含完整
# rewritten_prompt 信封=免加预算重试直接采用;思考尾无信封=旧重试路原样保留。
# 加载纪律:importlib.util.spec_from_file_location 直载 nodes/ 文件
# (不 import my_nodes 包,同 test_my_qi21_api_pe 勿 import 化禁令)。
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

_NODE = Path(__file__).resolve().parents[1] / "nodes" / "my_qi21_api_pe.py"
_spec = importlib.util.spec_from_file_location("my_qi21_api_pe_sc", _NODE)
api_pe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(api_pe)

# 主体句只带境界词(金丹中期)——过短/色词/部件检不触发,自检首稿即零违例;
# "金丹"虽撞色字模式簇,正文含"金丹中期"即簇内命中过检。
_SUBJ = "金丹中期剑修"
_LONG = "金丹中期剑修立于大殿," + "云纹自梁间垂落而气象端凝," * 30 + "收束。"


class _FakeResp:
    """无 readline → 节点走整块 JSON 兼容口(2008 mock/旧 opener 同款)。"""

    def __init__(self, payload: dict):
        self._data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def read(self, n=-1):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeOpener:
    """计数 opener:探活(字符串 URL)与 POST(Request)分别记账,POST 逐次弹应答。"""

    def __init__(self, posts):
        self._posts = list(posts)
        self.probes = 0
        self.post_bodies = []

    def open(self, req, timeout=None):
        if isinstance(req, str):
            self.probes += 1
            return _FakeResp({"data": []})
        self.post_bodies.append(json.loads(req.data.decode("utf-8")))
        if not self._posts:
            raise RuntimeError("FakeOpener 应答耗尽")
        return _FakeResp(self._posts.pop(0))


def _msg(content="", reasoning=""):
    return {"choices": [{"message": {"content": content, "reasoning_content": reasoning}}]}


def _rewrite(monkeypatch, opener):
    monkeypatch.setattr(api_pe, "_LAN_OPENER", opener, raising=True)
    node = api_pe.MyQi21ApiPE()
    return node.rewrite(
        正向提示词=_SUBJ, 类型句正向=None, 负向提示词=None,
        画幅宽=1024, 画幅高=1024, 透明模式=False,
        系统提示词="只输出JSON", 色卡="",
        api_url="http://127.0.0.1:1234", model="qwen3.8-27b-uncensored-mlx",
        temperature=0.7, max_tokens=12000, timeout_sec=30, thinking_effort="关闭")


def test_reasoning_envelope_skips_retry_1009(monkeypatch, capsys):
    """Mac 路由(content 空/答案在 reasoning):思考尾含完整信封→恰一发 POST,
    免加预算重试,终稿=信封正文(而非回退装配正稿)。"""
    envelope = '{"rewritten_prompt": "' + _LONG + '"}'
    opener = _FakeOpener(posts=[_msg(content="", reasoning=envelope)])
    got = _rewrite(monkeypatch, opener)
    out = capsys.readouterr().out
    assert len(opener.post_bodies) == 1, \
        f"思考尾含完整信封应免重试(恰1发POST),实发 {len(opener.post_bodies)}"
    assert "免重试直接采用" in out and "加预算重试一次" not in out
    assert got["result"][0] == _LONG, "终稿应=思考尾信封正文(剥取路),非回退装配文"
    assert got["ui"]["api_pe_status"][0].startswith("AI扩写OK:qwen3.8-27b-uncensored-mlx")


def test_reasoning_without_envelope_keeps_retry_1009(monkeypatch, capsys):
    """思考尾无信封(真·思考吃光预算形态):旧加预算重试路原样保留——重试稿
    带正文则采用重试稿(共2发POST)。"""
    retry_envelope = '{"rewritten_prompt": "' + _LONG + '"}'
    opener = _FakeOpener(posts=[
        _msg(content="", reasoning="让我想想该怎么扩写这一段……"),
        _msg(content=retry_envelope, reasoning=""),
    ])
    got = _rewrite(monkeypatch, opener)
    out = capsys.readouterr().out
    assert len(opener.post_bodies) == 2, \
        f"思考尾无信封应走旧重试路(共2发POST),实发 {len(opener.post_bodies)}"
    assert "加预算重试一次" in out
    assert got["result"][0] == _LONG, "重试稿带正文时应采用重试稿"


def test_envelope_from_reasoning_recovery_chain_1009():
    """思考尾恢复链四态:干净信封直取/裸换行信封正则补转义取出/围栏+丢括修边/
    纯思考无信封返None。"""
    clean = '{"rewritten_prompt": "' + _LONG + '"}'
    assert api_pe._envelope_from_reasoning(clean)["rewritten_prompt"] == _LONG
    # Mac 路由实弹非法细节:串内裸换行(json 严格模式拒收)——正则路容之
    raw_nl = '{"rewritten_prompt": "金丹中期剑修立于大殿,\n' + "云纹自梁间垂落," * 28 + '"}'
    assert api_pe._balanced_json(raw_nl) is None, "前置:裸换行确实过不了平衡解析"
    got = api_pe._envelope_from_reasoning(raw_nl)
    assert got and "金丹中期剑修立于大殿," in got["rewritten_prompt"] \
        and got["rewritten_prompt"].count("云纹自梁间垂落") == 28
    # 围栏+丢 { 修边:思考里带 ```json 皮
    fenced = "想想……\n```json\n" + '"rewritten_prompt": "' + _LONG + '"}'
    got2 = api_pe._envelope_from_reasoning(fenced)
    assert got2 and got2["rewritten_prompt"] == _LONG
    # 纯思考无信封 → None
    assert api_pe._envelope_from_reasoning("我需要构思一下画面……") is None
    assert api_pe._envelope_from_reasoning("") is None


def test_raw_newline_envelope_shortcircuit_end_to_end_1009(monkeypatch, capsys):
    """端到端:Mac 路由裸换行信封(平衡解析必败形态)——短路免重试+终稿=补转义
    解出的信封正文(非回退装配文)。"""
    raw_nl = '{"rewritten_prompt": "金丹中期剑修立于大殿,\n' + "云纹自梁间垂落," * 60 + '"}'
    opener = _FakeOpener(posts=[_msg(content="", reasoning=raw_nl)])
    got = _rewrite(monkeypatch, opener)
    out = capsys.readouterr().out
    assert len(opener.post_bodies) == 1, "裸换行信封应免重试"
    assert "免重试直接采用" in out
    assert got["result"][0].startswith("金丹中期剑修立于大殿,")
    assert got["ui"]["api_pe_status"][0].startswith("AI扩写OK:")


def test_quality_retry_reasoning_envelope_accepted_1009(monkeypatch, capsys):
    """质量补发路同规:首稿缺境界词→补发;补发稿信封落 reasoning 且带裸换行
    (Mac 路由形态)→_envelope_from_reasoning 取出→零违例收稿(非拒收回退)。"""
    bad = '{"rewritten_prompt": "' + _LONG.replace("金丹中期剑修", "剑修", 1) + '"}'
    fixed_raw_nl = '{"rewritten_prompt": "金丹中期剑修立于大殿,\\n' + "云纹自梁间垂落," * 60 + '"}'
    opener = _FakeOpener(posts=[
        _msg(content="", reasoning=bad),          # 首稿:reasoning 信封但丢境界词
        _msg(content="", reasoning=fixed_raw_nl),  # 补发稿:裸换行信封含境界词
    ])
    got = _rewrite(monkeypatch, opener)
    out = capsys.readouterr().out
    assert len(opener.post_bodies) == 2, "首稿违例应恰补发一次"
    assert "同模型补发一次" in out and "拒收" not in out
    assert got["ui"]["api_pe_status"][0].startswith("AI扩写OK:"), \
        f"补发稿零违例应收稿,得 {got['ui']['api_pe_status'][0]}"
    assert got["result"][0].startswith("金丹中期剑修立于大殿,")
