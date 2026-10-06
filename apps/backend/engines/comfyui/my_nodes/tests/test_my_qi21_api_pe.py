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
    assert node.RETURN_TYPES == ("STRING", "STRING")
    assert node.RETURN_NAMES == ("正向提示词", "负向提示词")
    req = node.INPUT_TYPES()["required"]
    # 1006 五轮:装配全文(prompt 更名,连 [4011].0)+负面词两主槽
    assert "装配全文" in req and req["装配全文"][0] == "STRING" \
        and req["装配全文"][1].get("forceInput") is True, "装配全文槽必须在场([4011].0 连此处)"
    assert "负面词" in req and req["负面词"][0] == "STRING", "负面词槽必须在场([4011].1)"
    opt = node.INPUT_TYPES()["optional"]
    # 1006 批C 七路直连:九入序=系统提示词/色卡/美术风格底座/型底座/正向提示词/
    # 负向提示词/透明模式(与两 json [4013] inputs 槽序互锁;型底座←[4010].0/
    # 正向←边界 -10.0/负向←边界 -10.2 三外部原文参考路)
    assert list(opt) == ["系统提示词", "色卡", "美术风格底座", "型底座", "正向提示词",
                         "负向提示词", "画幅宽", "画幅高", "型负面", "透明模式",
                         "正向扩写全文", "负向扩写清单"], \
        f"optional 槽序漂移(1006 六轮十二槽),得 {list(opt)}"
    for k in ("系统提示词", "色卡", "美术风格底座", "型底座", "正向提示词", "负向提示词", "型负面"):
        assert opt[k][0] == "STRING" and opt[k][1].get("forceInput") is True, \
            f"{k} 应 forceInput 纯槽(1006 六轮:带名连线点)"
    assert opt["透明模式"][0] == "BOOLEAN" and opt["透明模式"][1].get("default") is False
    assert req["api_url"][1]["default"] == "http://127.0.0.1:1234"
    assert req["model"][1]["default"] == "qwen3.8-27b-uncensored-mlx"


def test_passthrough_when_service_unreachable():
    """LM Studio 不可达→透传 {ui, result}=PE关同效不炸产线(1006 四轮双载荷)。"""
    node = api_pe.MyQi21ApiPE()
    got = node.rewrite(装配全文="测试装配全文原样透传", 负面词=None,
                       系统提示词=None, 色卡=None, 美术风格底座=None,
                       型底座="型底座原文", 正向提示词="外部正向原文",
                       负向提示词="外部负向原文", 透明模式=False,
                       api_url="http://127.0.0.1:9",  # 9口拒绝口,秒败
                       model="x", temperature=0.7, max_tokens=64, timeout_sec=5)
    assert got["result"] == ("测试装配全文原样透传", ""), \
        f"不可达应双口透传(原文,空负向;批C 三外部原文不改变透传形),得 {got!r}"
    assert got["ui"]["api_pe_pos"] == ["测试装配全文原样透传"], \
        "ui 载荷须与 result 同文(JS 展示框回填源)"


def test_balanced_json_strips_noise():
    """答文剥壳:前后噪声里的单行 JSON 能取出;纯垃圾返 None。"""
    obj = api_pe._balanced_json(_SAMPLE)
    assert obj and obj["wh_ratio"] == "2:3" and "筑基后期" in obj["rewritten_prompt"]
    assert api_pe._balanced_json("完全不是JSON的答文") is None


def test_system_prompt_hotread_with_patches():
    """教材热读:含 /no_think 与肯定式纪律补丁;真源在场时含中文教材标记。"""
    text = api_pe._build_system(None, None)
    assert text.rstrip().endswith("/no_think"), "句尾必须 /no_think(思考模式吃预算案)"
    assert "肯定式" in text and "negative_prompt" in text
    assert "锚点权重最高" in text and "外部手写原文" in text, \
        "批C 系统补丁必须在(外部正/负向提示词=锚点权重最高,逐字保留其实体)"


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
    assert "全文润炼铁律" in text, "全文润炼铁律必须在系统提示(五轮)"
    assert "禁止 Markdown 围栏" in text, "JSON 输出铁律必须在(结构化解析)"
    assert "色卡" in text, "色卡块必须进系统提示(词表+落点纪律)"
    style, colors = api_pe._context_materials()
    assert len(style) > 300 and "淡墨" in colors, "lock_layer 与 color_lexicon 热读在场"
    import inspect
    sig = inspect.signature(node.rewrite)
    for k in ("装配全文", "负面词", "系统提示词", "色卡", "美术风格底座",
              "型底座", "正向提示词", "负向提示词", "透明模式"):
        assert k in sig.parameters, f"{k} 须进签名(批C 九入终炼架构)"
