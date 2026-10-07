# 1006 API版PE(MyQi21ApiPE)单测:形状对上游+容错透传+JSON剥壳+教材热读。
# 加载纪律:importlib.util.spec_from_file_location 直载 nodes/ 文件(不 import
# my_nodes 包,同 test_my_qi21_prompt_select 勿 import 化禁令)。
from __future__ import annotations

import importlib.util
from pathlib import Path

_NODE = Path(__file__).resolve().parents[1] / "nodes" / "my_qi21_api_pe.py"
_spec = importlib.util.spec_from_file_location("my_qi21_api_pe_uut", _NODE)
api_pe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(api_pe)

# 1006 实测答文样例(27B 真身输出形:前后噪声+单行 JSON)
_SAMPLE = ('\n\n{"rewritten_prompt": "竖构图，写实东方仙侠插画风格画面中，一位筑基后期的'
           '年轻女修独自伫立在山门石阶最上一级", "negative_prompt": "模糊, 水印", '
           '"wh_ratio": "2:3"}')


def test_shape_matches_upstream_five_ports():
    """五口与上游 QwenImage21_T2IPromptRewrite 逐口同名(换 type 即接,出线零动)。"""
    node = api_pe.MyQi21ApiPE()
    # 1006 三轮:双口出(正向/负向;wh_ratio/thinking/parse_ok 退役)
    assert node.RETURN_TYPES == ("STRING", "STRING", "BOOLEAN", "INT", "INT")
    assert node.RETURN_NAMES == ("正向提示词", "负向提示词", "透明模式", "画幅宽", "画幅高")
    req = node.INPUT_TYPES()["required"]
    # 1006 七轮:装配内置——配置槽;1007 增 thinking_effort(尾插保旧工作流
    # widgets_values 位序不漂移);上下文/正负/型/画幅全在 optional
    assert list(req) == ["api_url", "model", "temperature", "max_tokens", "timeout_sec", "thinking_effort"], \
        f"required 应恰六配置槽(1007 增思考档位),得 {list(req)}"
    opt = node.INPUT_TYPES()["optional"]
    # 1006 批C 七路直连:九入序=系统提示词/色卡/美术风格底座/型底座/正向提示词/
    # 负向提示词/透明模式(与两 json [4013] inputs 槽序互锁;型底座←[4010].0/
    # 正向←边界 -10.0/负向←边界 -10.2 三外部原文参考路)
    assert list(opt) == ["系统提示词", "色卡", "美术风格底座", "正向提示词", "负向提示词", "类型句正向", "类型句负向", "画幅宽", "画幅高", "透明模式"], \
        f"optional 槽序漂移(1006 十轮十槽),得 {list(opt)}"
    for k in ("系统提示词", "色卡", "美术风格底座", "类型句正向", "正向提示词", "负向提示词", "类型句负向"):
        assert opt[k][0] == "STRING" and opt[k][1].get("forceInput") is True, \
            f"{k} 应 forceInput 纯槽(1006 六轮:带名连线点)"
    assert opt["透明模式"][0] == "BOOLEAN" and opt["透明模式"][1].get("forceInput") is True
    assert req["api_url"][1]["default"] == "http://192.168.0.101:1234,http://127.0.0.1:1234"
    assert req["model"][1]["default"] == "qwen3.5-9b-uncensored-hauhaucs-aggressive,qwen3.8-27b-uncensored-mlx"


def test_passthrough_when_service_unreachable():
    """LM Studio 不可达→透传 {ui, result}=PE关同效不炸产线(1006 四轮双载荷)。"""
    node = api_pe.MyQi21ApiPE()
    got = node.rewrite(正向提示词="测试主体句原样透传", 类型句正向="BASE层",
                       美术风格底座=None, 色卡=None, 类型句负向="模糊", api_url="http://127.0.0.1:9",
                       model="x", temperature=0.7, max_tokens=256, timeout_sec=10)
    pos, neg = got["result"][0], got["result"][1]
    assert pos.startswith("测试主体句原样透传\nBASE层\n风格底座"), \
        f"不可达应输出自装配三层正稿(恒有输出),得头40={pos[:40]!r}"
    assert "模糊" in neg and "水印" in neg, \
        f"降级负向=型负面+锁层负面+外部负向 三源合并,得头60={neg[:60]!r}"
    assert got["ui"]["api_pe_pos"][0] == pos and got["ui"]["api_pe_neg"][0] == neg, \
        "ui 载荷须与 result 同文(JS 展示框回填源)"


def test_balanced_json_strips_noise():
    """答文剥壳:前后噪声里的单行 JSON 能取出;纯垃圾返 None。"""
    obj = api_pe._balanced_json(_SAMPLE)
    assert obj and obj["wh_ratio"] == "2:3" and "筑基后期" in obj["rewritten_prompt"]
    assert api_pe._balanced_json("完全不是JSON的答文") is None


def test_system_prompt_hotread_with_patches():
    """教材热读:真源在场时含中文教材标记。
    1007 起 /no_think 尾巴退役(五探实弹:文本软开关被 aggressive finetune 无视;
    思考控制改走顶层 reasoning_effort,接线见 thinking_effort 档位)。"""
    text = api_pe._build_system(None, None)
    assert not text.rstrip().endswith("/no_think"), "/no_think 已退役(1007)"
    assert "八步工作法" in text and "negative_prompt" in text
    assert "色卡全库" in text and "透明模式" in text and "冲突裁决" in text and "八步工作法" in text, \
        "十一轮合并教材=原文八步+色卡42色+透明+裁决序"


def test_registered_in_node_mappings():
    """注册面:__init__.py NODE_CLASS_MAPPINGS/DISPLAY 双挂。"""
    root = Path(__file__).resolve().parents[1]
    src = (root / "__init__.py").read_text(encoding="utf-8")
    assert '"MyQi21ApiPE": MyQi21ApiPE' in src, "NODE_CLASS_MAPPINGS 缺注册"
    assert '"MyQi21ApiPE": "漫影 API扩写PE"' in src, "DISPLAY 缺注册"


def test_full_context_assembly_1006r2():
    """二轮全上下文:色卡/风格热读进系统提示与用户消息;禁复述铁律在场。"""
    node = api_pe.MyQi21ApiPE()
    text = api_pe._build_system(None, None)
    assert "色卡全库" in text and "透明模式" in text and "冲突裁决" in text and "八步" in text, \
        "十一轮教材=原文八步+42色+透明+裁决"
    assert "八步工作法" in text, "JSON 输出铁律必须在(结构化解析)"
    assert "色卡" in text, "色卡块必须进系统提示(词表+落点纪律)"
    style, colors = api_pe._context_materials()
    assert len(style) > 300 and "淡墨" in colors, "lock_layer 与 color_lexicon 热读在场"
    import inspect
    sig = inspect.signature(node.rewrite)
    for k in ("正向提示词", "负向提示词", "类型句正向", "类型句负向", "画幅宽", "画幅高",
              "透明模式", "系统提示词", "色卡", "美术风格底座"):
        assert k in sig.parameters, f"{k} 须进签名(七轮十入,装配内置)"


def test_chat_url_suffix_rules_1007():
    """1007 云端支持:端点拼接三态——LM Studio 补 /v1/、v4 系只补 /chat/、全 URL 原样。"""
    assert api_pe._chat_url("http://192.168.0.101:1234") == \
        "http://192.168.0.101:1234/v1/chat/completions"
    assert api_pe._chat_url("http://127.0.0.1:1234") == \
        "http://127.0.0.1:1234/v1/chat/completions"
    assert api_pe._chat_url("https://open.bigmodel.cn/api/paas/v4") == \
        "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    assert api_pe._chat_url("https://x.example/v1") == \
        "https://x.example/v1/chat/completions"
    assert api_pe._chat_url("https://x.example/api/v4/chat/completions") == \
        "https://x.example/api/v4/chat/completions"


def test_cloud_key_env_priority_1007(monkeypatch):
    """1007 云端鉴权:env 优先于钥匙串;key 永不落工作流/文档(无控件承载)。"""
    monkeypatch.setenv("MYSTUDIO_QI21_PE_KEY", "env-key-123")
    api_pe._CLOUD_KEY_CACHE = None
    try:
        assert api_pe._cloud_key() == "env-key-123"
    finally:
        api_pe._CLOUD_KEY_CACHE = None
    # 无 env 时走钥匙串兜底(测机上真有一条,只验形态:非空 str 或空串皆合法)
    monkeypatch.delenv("MYSTUDIO_QI21_PE_KEY", raising=False)
    v = api_pe._cloud_key()
    assert isinstance(v, str)
    api_pe._CLOUD_KEY_CACHE = None
    # 控件面零新增:云端凭证不进 INPUT_TYPES(key 明文禁令)
    assert "api_key" not in node_required_keys()


def node_required_keys():
    return list(api_pe.MyQi21ApiPE.INPUT_TYPES()["required"])
