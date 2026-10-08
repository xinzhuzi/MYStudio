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
    assert list(opt) == ["系统提示词", "色卡", "美术风格底座-正向", "美术风格底座-负向", "正向提示词", "负向提示词", "类型句正向", "类型句负向", "画幅宽", "画幅高", "透明模式"], \
        f"optional 槽序漂移(1006 十轮十槽),得 {list(opt)}"
    for k in ("系统提示词", "色卡", "美术风格底座-正向", "美术风格底座-负向", "类型句正向", "正向提示词", "负向提示词", "类型句负向"):
        assert opt[k][0] == "STRING" and opt[k][1].get("forceInput") is True, \
            f"{k} 应 forceInput 纯槽(1006 六轮:带名连线点)"
    assert opt["透明模式"][0] == "BOOLEAN" and opt["透明模式"][1].get("forceInput") is True
    assert req["api_url"][1]["default"] == "http://192.168.0.101:1234"
    assert req["model"][1]["default"] == "qwen3.5-9b-uncensored-hauhaucs-aggressive"


def test_passthrough_when_service_unreachable():
    """LM Studio 不可达→透传 {ui, result}=PE关同效不炸产线(1006 四轮双载荷)。"""
    node = api_pe.MyQi21ApiPE()
    got = node.rewrite(正向提示词="测试主体句原样透传", 类型句正向="BASE层",
                       **{"美术风格底座-正向": None, "美术风格底座-负向": None}, 色卡=None, 类型句负向="模糊", api_url="http://127.0.0.1:9",
                       model="x", temperature=0.7, max_tokens=256, timeout_sec=10)
    pos, neg = got["result"][0], got["result"][1]
    assert pos.startswith("测试主体句原样透传\nBASE层\n风格底座"), \
        f"不可达应输出自装配三层正稿(恒有输出),得头40={pos[:40]!r}"
    assert "模糊" in neg and "水印" in neg, \
        f"降级负向=型负面+美术风格底座负面+外部负向 三源合并,得头60={neg[:60]!r}"
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
    思考控制改走顶层 reasoning_effort,接线见 thinking_effort 档位)。
    1008 S2 终裁:教材不再载负向职责——negative_prompt/负面清单引用彻底移除,
    输出契约收敛单键 rewritten_prompt(负向键存在则忽略)。"""
    text = api_pe._build_system(None, None)
    assert not text.rstrip().endswith("/no_think"), "/no_think 已退役(1007)"
    assert "八步工作法" in text and "rewritten_prompt" in text
    assert "negative_prompt" not in text, "教材不得再载负向职责/负面清单引用(1008 终裁)"
    assert "负面清单生成" not in text, "负面清单生成节已删(模型输入已无负面清单)"
    assert "300-800字" in text and "软参考" in text, "字数=软参考(1008 方案②,非硬线)"
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
    assert len(style) > 300 and "淡墨" in colors, "art_style_base 与 color_lexicon 热读在场"
    import inspect
    sig = inspect.signature(node.rewrite)
    for k in ("正向提示词", "负向提示词", "类型句正向", "类型句负向", "画幅宽", "画幅高",
              "透明模式", "系统提示词", "色卡"):
        assert k in sig.parameters, f"{k} 须进签名(七轮十入,装配内置)"
    # 1008 底座双槽(连字符键不能作形参)走 **kw 通路
    assert any(p.kind == p.VAR_KEYWORD for p in sig.parameters.values()), "底座双槽连字符键须 **kw 通路"


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


def test_cloud_key_runtime_takes_priority_1007(monkeypatch):
    """1007 UI 控件通道:运行时 key(_RUNTIME_KEY,引擎内存)>env>钥匙串;
    控件值不进 INPUT_TYPES(key 永不落工作流),路由注册在无 server 环境静默跳过。"""
    monkeypatch.setattr(api_pe, "_RUNTIME_KEY", "runtime-key", raising=False)
    monkeypatch.setenv("MYSTUDIO_QI21_PE_KEY", "env-key")
    api_pe._CLOUD_KEY_CACHE = None
    try:
        assert api_pe._cloud_key() == "runtime-key"
    finally:
        api_pe._RUNTIME_KEY = None
        api_pe._CLOUD_KEY_CACHE = None
        monkeypatch.delenv("MYSTUDIO_QI21_PE_KEY", raising=False)
    # 路由注册函数在无 PromptServer 环境可安全调用(单测直载即此形态)
    api_pe._register_key_route()  # 不抛即过


def test_cloud_targets_builtin_local_guaranteed_1007night():
    """1007夜脏图役补强+用户令「不用本地接,用 Windows 的 LM Studio 接」:
    云端模式目标链=云端在前+api_url列表+内置兜底对(恒 Windows 9B)强制链尾
    去重——api_url 被填成云端地址(00011 实弹形态)时 9B 仍在链;
    Mac 本机 27B(127.0.0.1:1234)不进兜底。"""
    # 00011 形态:api_url 填了云端 anthropic 口,本地列表被挤掉
    urls, models = api_pe._cloud_targets(
        "https://open.bigmodel.cn/api/anthropic", "GLM-5.3")
    assert urls[0] == api_pe._CLOUD_URL.rstrip("/") and models[0] == api_pe._CLOUD_MODEL, \
        "云端永远打头"
    assert "http://192.168.0.101:1234" in urls, \
        f"内置 Windows 9B 必须兜底在场(00011 实弹:云端429+本地不在链=透传=脏图),得 {urls}"
    assert "http://127.0.0.1:1234" not in urls, \
        f"Mac 本机 27B 出局(1007夜用户令「不用本地接」),得 {urls}"
    i = urls.index("http://192.168.0.101:1234")
    assert models[i] == "qwen3.5-9b-uncensored-hauhaucs-aggressive", "内置对 URL/model 配对"
    assert urls[-1] == "http://192.168.0.101:1234", "内置兜底=Windows 9B 钉链尾"

    # api_url 留空:恰云端+Windows 9B 两条
    urls2, models2 = api_pe._cloud_targets(None, None)
    assert urls2 == [api_pe._CLOUD_URL.rstrip("/"), "http://192.168.0.101:1234"], \
        f"空 api_url 应恰云端+Windows 9B,得 {urls2}"
    assert models2 == [api_pe._CLOUD_MODEL, "qwen3.5-9b-uncensored-hauhaucs-aggressive"]

    # api_url 本来就含 Windows 9B:去重不双插
    urls3, _ = api_pe._cloud_targets("http://192.168.0.101:1234", "m1")
    assert urls3.count("http://192.168.0.101:1234") == 1, "内置对去重"
    assert len(urls3) == 2, f"应恰云端+Windows 9B,得 {urls3}"


def test_sanitize_negative_strips_dirty_words_1008():
    """1007 立「解决脏问题」/1008 S1 根修(负向解耦终裁):扩写自补的构图景深词
    (远处/背景等)按整词剥,其余负面词逐条保留不改写;全脏输入清洗后返回空串
    (旧=回传原文,脏词泄漏进负向编码器的缺陷就此根修);空串原样;中英文逗号同规。"""
    dirty = "模糊, 水印, 远处，背景, 写实油画, 远景, 景深"
    out = api_pe._sanitize_negative(dirty)
    for w in api_pe._NEG_DIRTY_WORDS:
        assert w not in out.split(", "), f"{w} 应被整词剥除"
    assert "模糊" in out and "水印" in out and "写实油画" in out
    # 全脏=空串,不回传原文(中英文逗号两式);合法词原样保留零改写
    assert api_pe._sanitize_negative("远处,背景") == ""
    assert api_pe._sanitize_negative("远处，背景") == ""
    assert api_pe._sanitize_negative("远景，近景，中景，景深") == ""
    assert api_pe._sanitize_negative("") == ""
    assert api_pe._sanitize_negative("模糊") == "模糊"
